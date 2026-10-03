/**
 * <ViewInsetDriver /> — moves the live view out from under phone overlays
 * (the atom card, the panel sheets, Learn, the Play tray; see viewInset.ts).
 *
 * Mounted inside the Canvas. Whenever the declared overlays change, it finds
 * the free area they leave, measures where the molecule is on screen, and
 * eases the camera's projection view offset so the molecule sits in the free
 * area (shrunk to fit when it has to); when the overlays go, it eases back.
 *
 * - The framing is recomputed only when the overlays, the canvas size or the
 *   structure change, never while the visitor turns or zooms, so a gesture
 *   is never fought.
 * - An overlay a canvas tap opens or closes (the atom card) holds the view
 *   for one double-tap window first, so the second tap of a double-tap lands
 *   on what the first one touched. A quick menu (the Play tray) holds a
 *   moment before making room, so a pick that closes it at once moves nothing.
 * - It springs on the motion kernel (MOTION.settle; MOTION.snap while the
 *   visitor drags a sheet, so the molecule rides the sheet) and cuts under
 *   Motion: Still; Gentle still glides, as camera glides do.
 * - A recording cuts it to identity for the length of the video, which
 *   records the canvas.
 * - It only writes the projection: the pose, the store, saved views and the
 *   axes gizmo never see it, and capture copies of the camera clear it.
 * - Quiet Idle: an overlay change requests frames, and the driver keeps the
 *   demand loop awake ('viewInset') while it holds or moves.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { OrthographicCamera, PerspectiveCamera, Vector3, type Camera } from 'three';
import { MOTION, createSpring1, isSettled, springTo, type Spring1 } from '@atlas/core/motion';
import { LUPI_JOB, keepLupiAwake, registerRecordingGuard, requestLupiFrames } from '@atlas/scene';
import { glidesAnimate } from '../motion/comfort';
import { useStore } from '../store';
import { registerPlayDevHook } from '../play/devHooks';
import { GESTURE } from './gestureTokens';
import {
  IDENTITY_FRAMING,
  chromeRects,
  freeArea,
  hasRoom,
  insetFraming,
  isIdentityFraming,
  occluderTracking,
  reportViewFraming,
  subscribeViewOccluders,
  viewFraming,
  viewOccluders,
  type ScreenRect,
  type ViewFraming,
} from './viewInset';

/** A tap-born overlay that appears or goes holds the view this long (ms): one double-tap window, plus a margin. */
const HOLD_MS = GESTURE.doubleTapMs + 60;
/** Within this many CSS px (or this much scale) of its target, the framing lands. */
const LAND_PX = 0.25;
const LAND_SCALE = 0.0005;
/** World padding around the structure's bounds (Å): about one drawn atom radius. */
const SUBJECT_PAD = 1.2;

type OffsetCamera = PerspectiveCamera | OrthographicCamera;

function hasViewOffset(camera: Camera): camera is OffsetCamera {
  return typeof (camera as Partial<OffsetCamera>).setViewOffset === 'function';
}

/** Draw the scene with `framing` on a `width`×`height` canvas (identity clears the offset). */
function applyFraming(camera: Camera, framing: ViewFraming, width: number, height: number): void {
  if (!hasViewOffset(camera)) return;
  if (isIdentityFraming(framing) || !(width > 0) || !(height > 0) || !(framing.scale > 0)) {
    if (camera.view?.enabled) camera.clearViewOffset();
    return;
  }
  // A sub-view of the full image, 1/scale times its size, placed so the
  // canvas centre lands at centre + (x, y) and everything scales about it.
  const k = framing.scale;
  const fx = width / 2 + framing.x;
  const fy = height / 2 + framing.y;
  camera.setViewOffset(width, height, width / 2 - fx / k, height / 2 - fy / k, width / k, height / k);
}

/** The structure's world bounds (all frames). */
export interface SubjectBounds {
  min: ArrayLike<number>;
  max: ArrayLike<number>;
}

const scratchPoint = new Vector3();
/** At most this many atoms are projected to find the molecule on screen (an even sample of bigger files). */
const SUBJECT_SAMPLES = 4096;

/**
 * Projects world points through the camera's own projection, without any view
 * offset, into client px, and grows a box around them. `add` returns false
 * for a point behind the camera (the molecule surrounds it).
 */
class ScreenBox {
  left = Infinity;
  top = Infinity;
  right = -Infinity;
  bottom = -Infinity;
  nearest = Infinity;
  private readonly width: number;
  private readonly height: number;

  constructor(
    private readonly camera: Camera,
    private readonly canvas: ScreenRect,
  ) {
    this.width = canvas.right - canvas.left;
    this.height = canvas.bottom - canvas.top;
  }

  add(x: number, y: number, z: number): boolean {
    const camera = this.camera;
    const view = scratchPoint.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    let ndcX: number;
    let ndcY: number;
    if (camera instanceof PerspectiveCamera) {
      const depth = -view.z;
      if (!(depth > 1e-6)) return false;
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360) / (camera.zoom || 1);
      ndcY = view.y / depth / tanHalf;
      ndcX = view.x / depth / (tanHalf * (this.width / this.height));
      this.nearest = Math.min(this.nearest, depth);
    } else if (camera instanceof OrthographicCamera) {
      const zoom = camera.zoom || 1;
      const dx = (camera.right - camera.left) / (2 * zoom);
      const dy = (camera.top - camera.bottom) / (2 * zoom);
      if (!(dx > 0) || !(dy > 0)) return false;
      ndcX = (view.x - (camera.right + camera.left) / 2) / dx;
      ndcY = (view.y - (camera.top + camera.bottom) / 2) / dy;
    } else {
      return false;
    }
    const px = this.canvas.left + ((ndcX + 1) / 2) * this.width;
    const py = this.canvas.top + ((1 - ndcY) / 2) * this.height;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    this.left = Math.min(this.left, px);
    this.right = Math.max(this.right, px);
    this.top = Math.min(this.top, py);
    this.bottom = Math.max(this.bottom, py);
    return true;
  }

  /** CSS px a world length `pad` spans at the nearest point seen (the largest it gets on screen). */
  padPx(pad: number): number {
    const camera = this.camera;
    if (camera instanceof PerspectiveCamera && Number.isFinite(this.nearest)) {
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360) / (camera.zoom || 1);
      return (pad / (this.nearest * tanHalf)) * (this.height / 2);
    }
    if (camera instanceof OrthographicCamera) {
      const dy = (camera.top - camera.bottom) / (2 * (camera.zoom || 1));
      return dy > 0 ? (pad / dy) * (this.height / 2) : 0;
    }
    return 0;
  }

  rect(padPx = 0): ScreenRect | null {
    if (!(this.right >= this.left) || !(this.bottom >= this.top)) return null;
    return {
      left: this.left - padPx,
      top: this.top - padPx,
      right: this.right + padPx,
      bottom: this.bottom + padPx,
    };
  }
}

/**
 * The molecule's screen rectangle (client px) at identity framing: the
 * frame's atoms (an even sample of big files) through the camera's own
 * projection, padded by about one drawn atom; the padded world bounds when the
 * frame's coordinates are not at hand. Null when part of it is behind the
 * camera (the molecule surrounds it) or nothing is known; the whole canvas
 * then stands in.
 */
function subjectRect(
  camera: Camera,
  positions: ArrayLike<number> | null | undefined,
  bounds: SubjectBounds | null | undefined,
  canvas: ScreenRect,
): ScreenRect | null {
  if (!(canvas.right > canvas.left) || !(canvas.bottom > canvas.top)) return null;
  camera.updateMatrixWorld();
  const box = new ScreenBox(camera, canvas);
  const atoms = positions ? Math.floor(positions.length / 3) : 0;
  if (positions && atoms > 0) {
    const stride = Math.max(1, Math.ceil(atoms / SUBJECT_SAMPLES));
    for (let atom = 0; atom < atoms; atom += stride) {
      const i = atom * 3;
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (!box.add(x, y, z)) return null;
    }
    const rect = box.rect(box.padPx(SUBJECT_PAD));
    if (rect && rect.right > rect.left && rect.bottom > rect.top) return rect;
  }
  if (!bounds || bounds.min.length < 3 || bounds.max.length < 3) return null;
  const corners = new ScreenBox(camera, canvas);
  for (let corner = 0; corner < 8; corner += 1) {
    const added = corners.add(
      corner & 1 ? bounds.max[0] + SUBJECT_PAD : bounds.min[0] - SUBJECT_PAD,
      corner & 2 ? bounds.max[1] + SUBJECT_PAD : bounds.min[1] - SUBJECT_PAD,
      corner & 4 ? bounds.max[2] + SUBJECT_PAD : bounds.min[2] - SUBJECT_PAD,
    );
    if (!added) return null;
  }
  return corners.rect();
}

/** The positions of the frame on screen, when the store has them. */
function framePositions(): ArrayLike<number> | null {
  const { file, frame } = useStore.getState();
  const frames = file?.trajectory.frames;
  if (!frames?.length) return null;
  const index = Math.min(frames.length - 1, Math.max(0, Math.floor(Number.isFinite(frame) ? frame : 0)));
  const positions = frames[index]?.positions;
  return positions && positions.length >= 3 ? positions : null;
}

interface FramingSprings {
  x: Spring1;
  y: Spring1;
  scale: Spring1;
}

function springsAt(springs: FramingSprings): ViewFraming {
  return { x: springs.x.value, y: springs.y.value, scale: springs.scale.value };
}

function springsRest(springs: FramingSprings, goal: ViewFraming): boolean {
  return (
    springs.x.value === goal.x &&
    springs.y.value === goal.y &&
    springs.scale.value === goal.scale &&
    springs.x.velocity === 0 &&
    springs.y.velocity === 0 &&
    springs.scale.velocity === 0
  );
}

function cutSprings(springs: FramingSprings, goal: ViewFraming): void {
  springs.x.value = goal.x;
  springs.y.value = goal.y;
  springs.scale.value = goal.scale;
  springs.x.velocity = 0;
  springs.y.velocity = 0;
  springs.scale.velocity = 0;
}

function sameFraming(a: ViewFraming, b: ViewFraming): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale;
}

export function ViewInsetDriver({ bounds }: { bounds?: SubjectBounds | null }) {
  const camera = useThree((s) => s.camera);
  const renderer = useThree((s) => s.renderer);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const state = useRef({
    springs: { x: createSpring1(0), y: createSpring1(0), scale: createSpring1(1) } as FramingSprings,
    target: { ...IDENTITY_FRAMING } as ViewFraming,
    stale: true,
    holdUntil: 0,
    recording: false,
    applied: null as ViewFraming | null,
    width: 0,
    height: 0,
  });

  // An overlay appeared, moved, changed size or went: recompute the target.
  useEffect(
    () =>
      subscribeViewOccluders((change) => {
        const st = state.current;
        // A tap opened or closed it: hold for a possible second tap.
        if (change.tapBorn && (change.appeared || change.gone)) st.holdUntil = performance.now() + HOLD_MS;
        // A quick menu opened: make room only if it stays open.
        if (change.appeared && change.lingerMs > 0) {
          st.holdUntil = Math.max(st.holdUntil, performance.now() + change.lingerMs);
        }
        st.stale = true;
        requestLupiFrames();
      }),
    [],
  );

  // A new structure (or a resized canvas) while an overlay is up: frame again.
  useEffect(() => {
    state.current.stale = true;
    invalidate();
  }, [bounds, size.width, size.height, invalidate]);

  // Keep the demand loop drawing while the framing holds for a second tap or
  // moves; at rest it costs nothing.
  useEffect(
    () =>
      keepLupiAwake('viewInset', () => {
        const st = state.current;
        if (st.stale) return true;
        return !springsRest(st.springs, st.recording ? IDENTITY_FRAMING : st.target);
      }),
    [],
  );

  useEffect(
    () =>
      registerRecordingGuard(() => {
        const st = state.current;
        st.recording = true;
        cutSprings(st.springs, IDENTITY_FRAMING);
        applyFraming(camera, IDENTITY_FRAMING, st.width, st.height);
        st.applied = { ...IDENTITY_FRAMING };
        reportViewFraming(IDENTITY_FRAMING, IDENTITY_FRAMING);
        return () => {
          st.recording = false;
          st.stale = true;
          invalidate();
        };
      }),
    [camera, invalidate],
  );

  useEffect(() => registerPlayDevHook('viewInset', () => viewFraming()), []);

  // A camera swap or unmount leaves no offset behind.
  useEffect(
    () => () => {
      applyFraming(camera, IDENTITY_FRAMING, 0, 0);
      const st = state.current;
      st.applied = null;
      cutSprings(st.springs, IDENTITY_FRAMING);
      reportViewFraming(IDENTITY_FRAMING, IDENTITY_FRAMING);
    },
    [camera],
  );

  useFrame(
    (_, delta) => {
      const st = state.current;
      if (st.stale) {
        st.stale = false;
        const overlays = viewOccluders();
        const canvas = renderer?.domElement as HTMLCanvasElement | undefined;
        if (overlays.length === 0 || !canvas) st.target = { ...IDENTITY_FRAMING };
        else {
          const rect = canvas.getBoundingClientRect();
          const canvasRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
          const chrome = chromeRects();
          let free = freeArea(canvasRect, overlays.map((overlay) => overlay.rect), chrome);
          // The atom card over an open sheet can leave no room between them:
          // then the molecule makes room for the sheet alone, under the card.
          if (!hasRoom(free) && overlays.some((overlay) => overlay.tapBorn)) {
            const sheets = overlays.filter((overlay) => !overlay.tapBorn).map((overlay) => overlay.rect);
            const roomy = sheets.length > 0 ? freeArea(canvasRect, sheets, chrome) : null;
            if (hasRoom(roomy)) free = roomy;
          }
          st.target = insetFraming({
            canvas: canvasRect,
            free,
            subject: subjectRect(camera, framePositions(), boundsRef.current, canvasRect),
          });
        }
      }
      const goal = st.recording ? IDENTITY_FRAMING : st.target;
      const springs = st.springs;
      const resized = st.width !== size.width || st.height !== size.height;
      st.width = size.width;
      st.height = size.height;
      if (springsRest(springs, goal)) {
        const now = springsAt(springs);
        if (resized || !st.applied || !sameFraming(st.applied, now)) {
          applyFraming(camera, now, size.width, size.height);
          st.applied = now;
        }
        reportViewFraming(now, goal);
        return;
      }
      reportViewFraming(springsAt(springs), goal);
      if (!st.recording && performance.now() < st.holdUntil) {
        invalidate();
        return;
      }
      const cut = st.recording || !glidesAnimate();
      // Dragging a sheet: the molecule rides it; otherwise it settles.
      const token = occluderTracking() ? MOTION.snap : MOTION.settle;
      springTo(springs.x, goal.x, token, delta, cut);
      springTo(springs.y, goal.y, token, delta, cut);
      springTo(springs.scale, goal.scale, token, delta, cut);
      if (
        isSettled(springs.x.value, springs.x.velocity, goal.x, LAND_PX) &&
        isSettled(springs.y.value, springs.y.velocity, goal.y, LAND_PX) &&
        isSettled(springs.scale.value, springs.scale.velocity, goal.scale, LAND_SCALE)
      ) {
        cutSprings(springs, goal);
      }
      const now = springsAt(springs);
      applyFraming(camera, now, size.width, size.height);
      st.applied = now;
      reportViewFraming(now, goal);
      if (!springsRest(springs, goal)) invalidate();
    },
    { phase: 'update', id: LUPI_JOB.viewInset },
  );

  return null;
}
