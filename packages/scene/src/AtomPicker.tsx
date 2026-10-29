/**
 * <AtomPicker /> — picks the atom under the pointer, as it is drawn.
 *
 * The rule lives in atomPick.ts: the pointer ray against every drawn atom
 * sphere (display radius × atomScale × per-type scale, hidden types and
 * undrawn atoms skipped, the hovered or grabbed atom swollen as the impostor
 * swells it) and every drawn bond; the front-most hit wins, and a bond hit
 * picks the atom whose half was hit. On a miss, a near miss within 5 CSS px
 * of a visible silhouette (8 for a pen, 14 for a finger) picks that atom.
 * Picking is CPU-only, so it behaves the same on the WebGPU backend and the
 * WebGL2 fallback. The pointer is taken from each event's own client
 * coordinates against the renderer's canvas, so a phone tap (which may
 * arrive without a prior pointermove) picks where it landed, through the
 * live projection (the phone view inset included).
 *
 * Input comes from one of two places:
 * - **The intent bus**, while a canvas input source (the Lupi camera rig's
 *   gesture arbiter) is mounted. The arbiter has already told taps from
 *   drags and catches, so every `canvas.tap` picks exactly once, a
 *   `canvas.doubleTap` focuses the atom (or zooms toward empty space), and
 *   `canvas.hover` picks at most once per animation frame.
 * - **Window listeners** (`pointerdown` / `mousemove` / `click`), only while
 *   no canvas input source is active: `?controls=orbit`.
 * The Escape / `m` keys are handled either way.
 *
 * The pick geometry (per-type radii, drawn count, bond adjacency) is built
 * once per frame, look and bond set; a pick itself allocates nothing beyond
 * the canvas rect.
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
  type PointerKind,
} from './intents';
import {
  atomSilhouetteGapPx,
  buildAtomPickGeometry,
  buildPickBondSet,
  pickAtom,
  pickTolerancePx,
  type AtomPickGeometry,
  type AtomPickOptions,
  type AtomPickResult,
  type AtomPickSwell,
  type PickBonds,
} from './atomPick';
import { ATOM_GLOW, ATOM_GLOW_TUNING } from './tsl/atomGlow';

interface AtomPickerProps {
  /** The frame the atom layer draws (interpolatedFrame ?? currentFrame). */
  frame: Frame;
  spatialHash: SpatialHash3D;
  enabled?: boolean;
  /** The atom layer's scale controls: the store's atomScale and per-type scales. */
  atomScale?: number;
  atomTypeScales?: Readonly<Record<number, number>> | null;
  /** Streamed atoms resident so far, and the atom layer's capacity clamp. */
  loadedAtomCount?: number;
  maxAtoms?: number;
  /** The impostor's sub-pixel cull (device px; 0 off). */
  cullPixelRadius?: number;
  /** The impostor swells the hovered and grabbed atom (off for the glass layer). */
  swell?: boolean;
  /** The drawn bonds (they occlude, and a hit picks the atom whose half it is), or null. */
  bonds?: PickBonds | null;
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
const NO_HIDDEN: ReadonlySet<number> = new Set<number>();

// ─── The impostor's swell (atomGlow.ts), read at pick time ──────────

const liveSwell: AtomPickSwell = { hoverAtom: -1, hoverScale: 1, focusAtom: -1, focusScale: 1 };
/** Reused per pick (a pick allocates nothing beyond the canvas rect). */
const pickOptions: AtomPickOptions = { pointerType: 'mouse', swell: null, bufferHeight: 0 };

/** The hover and grab swell the impostor draws right now (1 + max(term) × the master weight). */
function readImpostorSwell(): AtomPickSwell {
  const G = ATOM_GLOW;
  const weight = G.uGlowWeight.value;
  liveSwell.hoverAtom = Math.round(G.uHoverAtom.value);
  liveSwell.hoverScale = 1 + G.uHoverLevel.value * ATOM_GLOW_TUNING.hoverSwell * weight;
  liveSwell.focusAtom = Math.round(G.uFocusAtom.value);
  liveSwell.focusScale = 1 + ATOM_GLOW_TUNING.focusSwell * weight;
  return liveSwell;
}

// ─── The mounted picker, for toys (Tug, Burst) ──────────────────────

type ClientPick = (clientX: number, clientY: number, pointerType?: PointerKind) => number | null;
let activeClientPick: ClientPick | null = null;

/**
 * The atom under a client-space point (CSS px), picked exactly as a tap
 * would pick it (rest positions, what is drawn, the pointer's near-miss
 * tolerance), or null. Null too while no picker is mounted (playback, very
 * large scenes).
 */
export function pickAtomAtClient(clientX: number, clientY: number, pointerType?: PointerKind): number | null {
  if (!activeClientPick) return null;
  try {
    return activeClientPick(clientX, clientY, pointerType);
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

/** The pointer kind of a legacy click (a PointerEvent in current browsers; a mouse otherwise). */
function pointerKindOf(event: MouseEvent): PointerKind {
  const kind = (event as PointerEvent).pointerType;
  return kind === 'touch' || kind === 'pen' ? kind : 'mouse';
}

export function AtomPicker({
  frame,
  spatialHash,
  enabled = true,
  atomScale = 1,
  atomTypeScales = null,
  loadedAtomCount,
  maxAtoms,
  cullPixelRadius = 0,
  swell = true,
  bonds = null,
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

  // The bond index costs O(bonds): build it only when the bonds or positions
  // change, never on a look change (atom scale, type scales, hidden types).
  const positions = frame.positions;
  const natoms = frame.natoms;
  const bondSet = useMemo(
    () => (bonds ? buildPickBondSet(bonds, positions, natoms) : null),
    [bonds, positions, natoms],
  );

  // What is drawn: per-type radii, the drawn count, the cull and the bonds.
  const geometry = useMemo<AtomPickGeometry>(
    () => buildAtomPickGeometry({
      frame,
      loadedAtomCount,
      maxAtoms,
      atomScale,
      atomTypeScales,
      hiddenAtomTypes: hiddenTypes,
      cullPixelRadius,
      bondSet,
    }),
    [frame, loadedAtomCount, maxAtoms, atomScale, atomTypeScales, hiddenTypes, cullPixelRadius, bondSet],
  );

  // Listeners live across renders and read the latest props from here.
  const latest = useRef({ frame, spatialHash, geometry, swell, onHover, onClick, onSelect, selectionMode, maxMeasureAtoms });
  latest.current = { frame, spatialHash, geometry, swell, onHover, onClick, onSelect, selectionMode, maxMeasureAtoms };

  const hoveredRef = useRef<number | null>(null);
  const selectedRef = useRef<Set<number>>(new Set());
  const measureAtomsRef = useRef<number[]>([]); // For measurement mode

  // One picker toolkit for both input paths (stable for the component's life).
  const picker = useMemo(() => {
    const canvasOf = () => get().renderer?.domElement as HTMLCanvasElement | undefined;
    const result: AtomPickResult = { index: -1, via: 'miss', t: Number.NaN };

    /** The atom under a client point, or null. */
    const pick = (clientX: number, clientY: number, pointerType: PointerKind = 'mouse'): number | null => {
      const canvas = canvasOf();
      result.via = 'unavailable';
      if (!canvas) return null;
      const p = latest.current;
      pickOptions.pointerType = pointerType;
      pickOptions.swell = p.swell ? readImpostorSwell() : null;
      pickOptions.bufferHeight = canvas.height;
      const index = pickAtom(
        p.geometry,
        p.spatialHash,
        get().camera,
        canvas.getBoundingClientRect(),
        clientX,
        clientY,
        pickOptions,
        result,
      );
      return index >= 0 ? index : null;
    };

    /** How far (CSS px) a client point lies outside an atom's drawn silhouette (+Infinity if not drawn). */
    const gapTo = (atomIndex: number, clientX: number, clientY: number): number => {
      const canvas = canvasOf();
      if (!canvas) return Infinity;
      const p = latest.current;
      pickOptions.swell = p.swell ? readImpostorSwell() : null;
      pickOptions.bufferHeight = canvas.height;
      return atomSilhouetteGapPx(
        p.geometry,
        get().camera,
        canvas.getBoundingClientRect(),
        clientX,
        clientY,
        atomIndex,
        pickOptions,
      );
    };

    const setHovered = (index: number | null) => {
      if (index === hoveredRef.current) return;
      hoveredRef.current = index;
      latest.current.onHover?.(index);
    };

    /** A tap or click at a client point: pick once (or take `picked`), report it, then select. */
    const tap = (
      clientX: number,
      clientY: number,
      shiftKey: boolean,
      pointerType: PointerKind = 'mouse',
      picked?: number | null,
    ): number | null => {
      const p = latest.current;
      const index = picked !== undefined ? picked : pick(clientX, clientY, pointerType);
      // A stale hash over a huge frame says nothing about the point: not a
      // miss, so the selection and a half-finished measurement stay.
      if (index === null && picked === undefined && result.via === 'unavailable') return null;
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
        // A tap on empty canvas clears the selection (and, in measure mode,
        // a half-finished measurement).
        selectedRef.current = new Set();
        measureAtomsRef.current = [];
        p.onSelect?.([]);
      }
      return index;
    };

    return { pick, gapTo, setHovered, tap };
  }, [get]);

  useEffect(() => {
    measureAtomsRef.current = [];
    selectedRef.current = new Set();
  }, [frame, selectionMode]);

  // Toys pick by the same rule (`pickAtomAtClient`).
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
      onIntent('canvas.tap', ({ clientX, clientY, shiftKey, pointerType }) => {
        lastTap = { index: picker.tap(clientX, clientY, shiftKey, pointerType) };
      }),
      onIntent('canvas.doubleTap', ({ clientX, clientY, pointerType }) => {
        let index = picker.pick(clientX, clientY, pointerType);
        const first = lastTap;
        lastTap = null;
        // Affinity: a second tap that lands just off the first tap's atom
        // (within the pointer's near-miss tolerance of its silhouette) is
        // still on it, even where another atom is drawn there.
        if (
          first
          && first.index !== null
          && first.index !== index
          && picker.gapTo(first.index, clientX, clientY) <= pickTolerancePx(pointerType)
        ) {
          index = first.index;
        }
        if (first && first.index !== index) {
          // Two quick taps on different things (two atoms, or an atom and
          // empty space) are two taps, not a double-tap.
          lastTap = { index: picker.tap(clientX, clientY, false, pointerType, index) };
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

  // ── Legacy path: window listeners (`?controls=orbit`). ──
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
      picker.tap(e.clientX, e.clientY, e.shiftKey, pointerKindOf(e));
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
