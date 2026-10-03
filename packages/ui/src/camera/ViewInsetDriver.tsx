/**
 * <ViewInsetDriver /> — moves the live view out from under the phone atom
 * card (see viewInset.ts).
 *
 * Mounted inside the Canvas. When an overlay docks over the top of the
 * canvas it eases the camera's projection view offset so the camera target
 * sits in the middle of the free band; when the overlay goes, it eases back.
 *
 * - It waits out the double-tap window before it moves, so the second tap
 *   of a double-tap lands on what the first one touched.
 * - It springs on the motion kernel (MOTION.settle) and cuts under Motion:
 *   Still; Gentle still glides, as camera glides do.
 * - A recording cuts it to zero for the length of the video, which records
 *   the canvas.
 * - It only writes the projection: the pose, the store, saved views and the
 *   axes gizmo never see it, and capture copies of the camera clear it.
 * - Quiet Idle: an overlay change requests frames, and the driver keeps the
 *   demand loop awake ('viewInset') while it holds or moves.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import type { Camera, OrthographicCamera, PerspectiveCamera } from 'three';
import { MOTION, createSpring1, isSettled, springTo } from '@atlas/core/motion';
import { LUPI_JOB, keepLupiAwake, registerRecordingGuard, requestLupiFrames } from '@atlas/scene';
import { glidesAnimate } from '../motion/comfort';
import { registerPlayDevHook } from '../play/devHooks';
import { GESTURE } from './gestureTokens';
import {
  FREE_BAND_GAP_PX,
  bottomChromeTop,
  insetShift,
  reportViewShift,
  subscribeTopOccluder,
  topOccluder,
  viewShift,
} from './viewInset';

/** An overlay that appears or goes holds the view this long (ms): one double-tap window, plus a margin. */
const HOLD_MS = GESTURE.doubleTapMs + 60;
/** Within this many CSS px of its target, the shift lands. */
const LAND_PX = 0.25;

type OffsetCamera = PerspectiveCamera | OrthographicCamera;

function hasViewOffset(camera: Camera): camera is OffsetCamera {
  return typeof (camera as Partial<OffsetCamera>).setViewOffset === 'function';
}

/** Draw the scene `shift` CSS px lower on a `width`×`height` canvas (0 clears the offset). */
function applyShift(camera: Camera, shift: number, width: number, height: number): void {
  if (!hasViewOffset(camera)) return;
  if (Math.abs(shift) < 0.01 || !(width > 0) || !(height > 0)) {
    if (camera.view?.enabled) camera.clearViewOffset();
    return;
  }
  camera.setViewOffset(width, height, 0, -shift, width, height);
}

export function ViewInsetDriver() {
  const camera = useThree((s) => s.camera);
  const renderer = useThree((s) => s.renderer);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const state = useRef({
    spring: createSpring1(0),
    target: 0,
    stale: true,
    holdUntil: 0,
    recording: false,
    applied: Number.NaN,
    width: 0,
    height: 0,
  });

  // The overlay appeared, changed size or went: recompute the target.
  useEffect(() => {
    let present = topOccluder() !== null;
    return subscribeTopOccluder(() => {
      const st = state.current;
      const next = topOccluder() !== null;
      // Appearing or going follows a tap: hold for a possible second tap.
      if (next !== present) st.holdUntil = performance.now() + HOLD_MS;
      present = next;
      st.stale = true;
      requestLupiFrames();
    });
  }, []);

  // Keep the demand loop drawing while the shift holds for a second tap or
  // moves; at rest it costs nothing.
  useEffect(
    () =>
      keepLupiAwake('viewInset', () => {
        const st = state.current;
        if (st.stale) return true;
        const goal = st.recording ? 0 : st.target;
        return st.spring.value !== goal || st.spring.velocity !== 0;
      }),
    [],
  );

  useEffect(() => {
    state.current.stale = true;
    invalidate();
  }, [size.width, size.height, invalidate]);

  useEffect(
    () =>
      registerRecordingGuard(() => {
        const st = state.current;
        st.recording = true;
        st.spring.value = 0;
        st.spring.velocity = 0;
        applyShift(camera, 0, st.width, st.height);
        st.applied = 0;
        reportViewShift(0, 0);
        return () => {
          st.recording = false;
          st.stale = true;
          invalidate();
        };
      }),
    [camera, invalidate],
  );

  useEffect(() => registerPlayDevHook('viewInset', () => ({ ...viewShift() })), []);

  // A camera swap or unmount leaves no offset behind.
  useEffect(
    () => () => {
      applyShift(camera, 0, 0, 0);
      state.current.applied = Number.NaN;
      state.current.spring.value = 0;
      state.current.spring.velocity = 0;
      reportViewShift(0, 0);
    },
    [camera],
  );

  useFrame(
    (_, delta) => {
      const st = state.current;
      if (st.stale) {
        st.stale = false;
        const bottom = topOccluder();
        const canvas = renderer?.domElement as HTMLCanvasElement | undefined;
        if (bottom === null || !canvas) st.target = 0;
        else {
          const rect = canvas.getBoundingClientRect();
          st.target = insetShift({
            canvasTop: rect.top,
            canvasHeight: rect.height,
            freeTop: bottom + FREE_BAND_GAP_PX,
            freeBottom: bottomChromeTop(rect) - FREE_BAND_GAP_PX,
          });
        }
      }
      const goal = st.recording ? 0 : st.target;
      const spring = st.spring;
      const resized = st.width !== size.width || st.height !== size.height;
      st.width = size.width;
      st.height = size.height;
      if (spring.value === goal && spring.velocity === 0) {
        if (resized || st.applied !== spring.value) {
          applyShift(camera, spring.value, size.width, size.height);
          st.applied = spring.value;
        }
        reportViewShift(spring.value, goal);
        return;
      }
      reportViewShift(spring.value, goal);
      if (!st.recording && performance.now() < st.holdUntil) {
        invalidate();
        return;
      }
      springTo(spring, goal, MOTION.settle, delta, st.recording || !glidesAnimate());
      if (isSettled(spring.value, spring.velocity, goal, LAND_PX, LAND_PX * 10)) {
        spring.value = goal;
        spring.velocity = 0;
      }
      applyShift(camera, spring.value, size.width, size.height);
      st.applied = spring.value;
      reportViewShift(spring.value, goal);
      if (spring.value !== goal) invalidate();
    },
    { phase: 'update', id: LUPI_JOB.viewInset },
  );

  return null;
}
