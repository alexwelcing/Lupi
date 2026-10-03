/**
 * <AtomPicker /> — Raycast-based atom selection
 *
 * Uses spatial hash for O(1) closest-atom lookup instead of
 * O(n) iteration through all atoms. Picking is CPU-only, so it behaves the
 * same on the WebGPU backend and the WebGL2 fallback. The pointer is taken
 * from each event's own client coordinates against the renderer's canvas,
 * so a phone tap (which may arrive without a prior pointermove) picks where
 * it landed.
 *
 * Input comes from one of two places:
 * - **The intent bus**, while a canvas input source (the Lupi camera rig's
 *   gesture arbiter) is mounted. The arbiter has already told taps from
 *   drags and catches, so every `canvas.tap` picks exactly once, a
 *   `canvas.doubleTap` focuses the atom (or zooms toward empty space), and
 *   `canvas.hover` picks at most once per animation frame.
 * - **Window listeners** (`pointerdown` / `mousemove` / `click`), only while
 *   no canvas input source is active: `?controls=orbit` and the testbed.
 * The Escape / `m` keys are handled either way.
 *
 * The march reuses module-scope scratch vectors: a pick allocates nothing
 * beyond the canvas rect.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import { SpatialHash3D } from './SpatialHash';
import {
  emitIntent,
  isCanvasInputSourceActive,
  onIntent,
  subscribeCanvasInputSource,
} from './intents';

interface AtomPickerProps {
  frame: Frame;
  spatialHash: SpatialHash3D;
  enabled?: boolean;
  radius?: number;
  onHover?: (atomIndex: number | null) => void;
  /** A tap or click on the canvas: the picked atom (null on empty space) and whether Shift was held. */
  onClick?: (atomIndex: number | null, info?: { shiftKey: boolean }) => void;
  onSelect?: (indices: number[]) => void; // Multi-select
  selectionMode?: 'single' | 'add' | 'remove' | 'measure';
  maxMeasureAtoms?: number;
  hiddenAtomTypes?: ReadonlySet<number>;
}

export interface PickedAtom {
  index: number;
  distance: number;
  worldPosition: THREE.Vector3;
}

/** A double-tap on empty space zooms this factor (distance) toward the point. */
const DOUBLE_TAP_ZOOM = 0.6;
const MARCH_STEP = 0.5; // Check every 0.5 Angstrom
const MARCH_MAX = 1000; // Maximum search distance
const SOFT_PICK_PX = 15; // 15px forgiveness zone

// ─── The march (module scope: no allocation per pick) ────────────────

const scratchRaycaster = new THREE.Raycaster();
const scratchPointer = new THREE.Vector2();
const scratchSample = new THREE.Vector3();
const scratchAtom = new THREE.Vector3();
const NO_HIDDEN: ReadonlySet<number> = new Set<number>();
const NO_VALUES = new Float32Array(0);

/** Per-pick state read by `visitNear`; reset at the start of every pick. */
const march = {
  positions: NO_VALUES as ArrayLike<number>,
  types: NO_VALUES as ArrayLike<number>,
  hidden: NO_HIDDEN,
  camera: null as THREE.Camera | null,
  ray: scratchRaycaster.ray,
  halfWidth: 0,
  halfHeight: 0,
  worldRadius: 0,
  sliceSolid: -1,
  sliceSolidDist: 0,
  soft: -1,
  softScreen: 0,
};

function visitNear(index: number): void {
  const m = march;
  if (m.hidden.size > 0 && m.hidden.has(m.types[index])) return;
  const x = m.positions[index * 3];
  const y = m.positions[index * 3 + 1];
  const z = m.positions[index * 3 + 2];
  scratchAtom.set(x, y, z);

  // 1. World-space intersection (Solves the zoomed-in bug)
  const distToRay = m.ray.distanceToPoint(scratchAtom);

  // 2. Screen-space intersection (Solves the zoomed-out bug)
  scratchAtom.project(m.camera!);
  const dxPixels = (scratchAtom.x - scratchPointer.x) * m.halfWidth;
  const dyPixels = (scratchAtom.y - scratchPointer.y) * m.halfHeight;
  const screenDistPixels = Math.hypot(dxPixels, dyPixels);

  // Must be in front of the camera (NDC z < 1.0)
  if (!(scratchAtom.z < 1.0)) return;
  if (distToRay < m.worldRadius) {
    if (m.sliceSolid < 0 || distToRay < m.sliceSolidDist) {
      m.sliceSolid = index;
      m.sliceSolidDist = distToRay;
    }
  } else if (screenDistPixels < SOFT_PICK_PX) {
    // Only record soft hits if we haven't hit a solid target yet
    if (m.sliceSolid < 0 && (m.soft < 0 || screenDistPixels < m.softScreen)) {
      m.soft = index;
      m.softScreen = screenDistPixels;
    }
  }
}

interface PickRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The atom under a client-space point (CSS px, as on pointer events), or -1.
 * A 0.5 Å march along the pointer ray: the first slice with an atom within
 * `radius·1.2` of the ray wins (closest to the ray); failing that, the atom
 * nearest on screen within 15 px.
 */
function pickAtomIndex(
  camera: THREE.Camera,
  rect: PickRect,
  clientX: number,
  clientY: number,
  frame: Frame,
  spatialHash: SpatialHash3D,
  radius: number,
  hidden: ReadonlySet<number>,
): number {
  if (!(rect.width > 0) || !(rect.height > 0)) return -1;
  scratchPointer.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  scratchRaycaster.setFromCamera(scratchPointer, camera);
  const ray = scratchRaycaster.ray;
  const m = march;
  m.positions = frame.positions;
  m.types = frame.types;
  m.hidden = hidden;
  m.camera = camera;
  m.ray = ray;
  m.halfWidth = rect.width / 2;
  m.halfHeight = rect.height / 2;
  m.worldRadius = radius * 1.2;
  m.soft = -1;
  m.softScreen = 0;
  let hit = -1;
  for (let t = 0; t < MARCH_MAX; t += MARCH_STEP) {
    ray.at(t, scratchSample);
    m.sliceSolid = -1;
    m.sliceSolidDist = 0;
    spatialHash.forEachNear(scratchSample.x, scratchSample.y, scratchSample.z, radius, visitNear);
    if (m.sliceSolid >= 0) {
      hit = m.sliceSolid; // Found the closest solid hit, stop marching!
      break;
    }
  }
  if (hit < 0) hit = m.soft;
  // Hold no frame or camera between picks.
  m.camera = null;
  m.positions = NO_VALUES;
  m.types = NO_VALUES;
  m.hidden = NO_HIDDEN;
  return hit;
}

// ─── The mounted picker, for toys (Tug, Burst) ──────────────────────

type ClientPick = (clientX: number, clientY: number) => number | null;
let activeClientPick: ClientPick | null = null;

/**
 * The atom under a client-space point (CSS px), picked exactly as a tap
 * would pick it (rest positions, hidden types skipped), or null. Null too
 * while no picker is mounted (playback, very large scenes).
 */
export function pickAtomAtClient(clientX: number, clientY: number): number | null {
  if (!activeClientPick) return null;
  try {
    return activeClientPick(clientX, clientY);
  } catch (error) {
    console.error('[lupi] atom pick threw', error);
    return null;
  }
}

/**
 * True when a pointer event belongs to the viewer canvas: its target is the
 * canvas, or one of the canvas's own wrapper elements (R3F connects events,
 * and OrbitControls captures the pointer, on the Canvas wrapper, so the
 * pointerup/click after a press lands there), and the point is on the canvas.
 * Clicks on UI panels over the canvas are not.
 */
function isViewerCanvasEvent(event: MouseEvent, canvas: HTMLCanvasElement): boolean {
  const target = event.target;
  if (target === canvas) return true;
  const container = canvas.parentElement;
  if (target !== container && target !== container?.parentElement) return false;
  const rect = canvas.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

export function AtomPicker({
  frame,
  spatialHash,
  enabled = true,
  radius = 2.0,
  onHover,
  onClick,
  onSelect,
  selectionMode = 'single',
  maxMeasureAtoms = 4,
  hiddenAtomTypes,
}: AtomPickerProps) {
  const get = useThree((state) => state.get);
  const hiddenAtomTypesKey = hiddenAtomTypes ? Array.from(hiddenAtomTypes).sort((a, b) => a - b).join(',') : '';
  const hiddenTypes = useMemo(
    () => (hiddenAtomTypes && hiddenAtomTypes.size > 0 ? new Set(hiddenAtomTypes) : NO_HIDDEN),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hiddenAtomTypesKey],
  );

  // Listeners live across renders and read the latest props from here.
  const latest = useRef({ frame, spatialHash, radius, hiddenTypes, onHover, onClick, onSelect, selectionMode, maxMeasureAtoms });
  latest.current = { frame, spatialHash, radius, hiddenTypes, onHover, onClick, onSelect, selectionMode, maxMeasureAtoms };

  const hoveredRef = useRef<number | null>(null);
  const selectedRef = useRef<Set<number>>(new Set());
  const measureAtomsRef = useRef<number[]>([]); // For measurement mode

  // One picker toolkit for both input paths (stable for the component's life).
  const picker = useMemo(() => {
    const canvasOf = () => get().renderer?.domElement as HTMLCanvasElement | undefined;

    /** The atom under a client point, or null. */
    const pick = (clientX: number, clientY: number): number | null => {
      const canvas = canvasOf();
      if (!canvas) return null;
      const p = latest.current;
      const index = pickAtomIndex(
        get().camera,
        canvas.getBoundingClientRect(),
        clientX,
        clientY,
        p.frame,
        p.spatialHash,
        p.radius,
        p.hiddenTypes,
      );
      return index >= 0 ? index : null;
    };

    const setHovered = (index: number | null) => {
      if (index === hoveredRef.current) return;
      hoveredRef.current = index;
      latest.current.onHover?.(index);
    };

    /** A tap or click at a client point: pick once, report it, then select. */
    const tap = (clientX: number, clientY: number, shiftKey: boolean): number | null => {
      const p = latest.current;
      const index = pick(clientX, clientY);
      p.onClick?.(index, { shiftKey });

      if (index !== null) {
        const selected = selectedRef.current;
        switch (p.selectionMode) {
          case 'single':
            selected.clear();
            selected.add(index);
            break;
          case 'add':
            selected.add(index);
            break;
          case 'remove':
            selected.delete(index);
            break;
          case 'measure': {
            // Repeated clicks do not create zero-length segments. Once the
            // requested arity is full, the oldest endpoint rolls off so the
            // user can refine a measurement without clearing the tool.
            const measure = measureAtomsRef.current;
            if (measure.includes(index)) return index;
            measure.push(index);
            if (measure.length > p.maxMeasureAtoms) measure.shift();
            selectedRef.current = new Set(measure);
            p.onSelect?.(measure.slice());
            return index;
          }
        }
        p.onSelect?.(Array.from(selected));
      } else if (p.selectionMode === 'single' || p.selectionMode === 'measure') {
        // We missed all atoms but hit the canvas. Clear selection!
        selectedRef.current = new Set();
        measureAtomsRef.current = [];
        p.onSelect?.([]);
      }
      return index;
    };

    return { pick, setHovered, tap };
  }, [get]);

  useEffect(() => {
    measureAtomsRef.current = [];
    selectedRef.current = new Set();
  }, [frame, selectionMode]);

  // Toys pick through the same march (`pickAtomAtClient`).
  useEffect(() => {
    if (!enabled) return undefined;
    const pick = picker.pick;
    activeClientPick = pick;
    return () => {
      if (activeClientPick === pick) activeClientPick = null;
    };
  }, [enabled, picker]);

  // Which input path is live: the intent bus while a canvas input source is mounted.
  const [intentInput, setIntentInput] = useState(isCanvasInputSourceActive);
  useEffect(() => {
    setIntentInput(isCanvasInputSourceActive());
    return subscribeCanvasInputSource(setIntentInput);
  }, []);

  // Keyboard shortcuts (either path).
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectedRef.current = new Set();
        measureAtomsRef.current = [];
        latest.current.onSelect?.([]);
      }
      if (e.key === 'm' && !e.metaKey && !e.ctrlKey) {
        // Toggle measurement mode
        measureAtomsRef.current = [];
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);

  // ── Intent path: the gesture arbiter already told taps from drags. ──
  useEffect(() => {
    if (!enabled || !intentInput) return;
    let lastTap: { index: number | null } | null = null;
    // Hover: the latest point, picked at most once per animation frame.
    let hoverLive = false;
    let hoverX = 0;
    let hoverY = 0;
    let hoverPending = false;
    let hoverFrame = 0;

    const pickHover = () => {
      if (!hoverPending) return;
      hoverPending = false;
      if (hoverLive) picker.setHovered(picker.pick(hoverX, hoverY));
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        pickHover();
      });
    };
    const requestHover = () => {
      hoverPending = true;
      if (!hoverFrame) pickHover();
    };

    const offs = [
      onIntent('canvas.tap', ({ clientX, clientY, shiftKey }) => {
        lastTap = { index: picker.tap(clientX, clientY, shiftKey) };
      }),
      onIntent('canvas.doubleTap', ({ clientX, clientY }) => {
        const index = picker.pick(clientX, clientY);
        const first = lastTap;
        lastTap = null;
        if (first && first.index !== index) {
          // Two quick taps on different things (two atoms, or an atom and
          // empty space) are two taps, not a double-tap.
          lastTap = { index: picker.tap(clientX, clientY, false) };
          return;
        }
        if (index !== null) emitIntent({ type: 'camera.focusAtom', atomIndex: index });
        else emitIntent({ type: 'camera.zoomToward', clientX, clientY, factor: DOUBLE_TAP_ZOOM });
      }),
      onIntent('canvas.hover', ({ clientX, clientY }) => {
        hoverLive = true;
        hoverX = clientX;
        hoverY = clientY;
        requestHover();
      }),
      onIntent('canvas.hoverEnd', () => {
        hoverLive = false;
        hoverPending = false;
        picker.setHovered(null);
      }),
      // A press starts a gesture: the last hover point goes stale until the
      // mouse moves again.
      onIntent('camera.gestureStart', () => {
        hoverLive = false;
      }),
      // The camera came to rest under a still cursor (a wheel zoom, a glide):
      // what is under it now?
      onIntent('camera.rest', () => {
        if (hoverLive) requestHover();
      }),
    ];
    return () => {
      for (const off of offs) off();
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      picker.setHovered(null);
    };
  }, [enabled, intentInput, picker]);

  // ── Legacy path: window listeners (`?controls=orbit`, the testbed). ──
  useEffect(() => {
    if (!enabled || intentInput) return;
    const canvasOf = () => get().renderer?.domElement as HTMLCanvasElement | undefined;
    // Pointer down tracking for distinguishing clicks from drags
    let downX = 0;
    let downY = 0;

    const handlePointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const handleMouseMove = (e: MouseEvent) => {
      // If the user is dragging the mouse (orbiting the camera), skip expensive raymarching!
      if (e.buttons > 0) return;
      const canvas = canvasOf();
      if (!canvas) return;
      // Hover only over the viewer canvas, not through UI panels above it;
      // leaving the canvas clears the hover.
      if (!isViewerCanvasEvent(e, canvas)) {
        picker.setHovered(null);
        return;
      }
      picker.setHovered(picker.pick(e.clientX, e.clientY));
    };

    const handleClick = (e: MouseEvent) => {
      const canvas = canvasOf();
      // Strictly isolate viewer canvas clicks (prevent UI panel clicks from triggering deselection)
      if (!canvas || !isViewerCanvasEvent(e, canvas)) return;
      // Distinguish click from drag (especially on mobile)
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      picker.tap(e.clientX, e.clientY, e.shiftKey);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick);
    };
  }, [enabled, intentInput, get, picker]);

  return null;
}
