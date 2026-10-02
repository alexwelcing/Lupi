/**
 * <CameraFocus /> - brings a chosen atom to the centre of the view.
 *
 * - A selection made off the canvas (a panel, search, Learn, a knowledge
 *   label) glides to the atom. A canvas tap never moves the camera: the
 *   picker marks its selection (`markCanvasSelection`), and any selection
 *   made within 500 ms of a `canvas.tap` intent counts as the tap's (this
 *   covers the measure tool, which selects without the mark).
 * - `camera.focusAtom` (a double-tap on an atom) always glides.
 *
 * The focus keeps the current view direction, re-centres the target on the
 * atom and closes the distance to at most 12 Å. With the Lupi camera rig it
 * is one `rig.glideTo`; without it (`?controls=orbit`) a spring job runs in
 * the `update` phase (`lupi/camera-focus`: after input and controls, before
 * the canonical/uniform phases and the default render), frame-rate
 * independent and allocation-free.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import { LUPI_JOB, onIntent } from '@atlas/scene';
import { MOTION, createSpring3, springTo3, type Spring3 } from '@atlas/core/motion';
import type { Frame } from '@atlas/core/types';
import { useStore } from './store';
import { getCameraRig, type Vec3 } from './camera/rigApi';
import { consumeCanvasSelection } from './camera/selectionSource';

const MAX_FOCUS_DISTANCE = 12;
/** A selection this soon after a canvas tap is the tap's own. */
const CANVAS_TAP_WINDOW_MS = 500;
/** The legacy spring job stops within this of its goal (Å). */
const SETTLE_EPSILON = 1e-3;

interface CameraFocusProps {
  frame: Frame;
  enabled?: boolean;
}

interface LegacyFocus {
  goal: Vec3;
  target: Spring3;
  position: Spring3;
}

const scratchDir = new THREE.Vector3();
const scratchGoal: Vec3 = [0, 0, 0];

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function copyInto(out: Vec3, v: THREE.Vector3): Vec3 {
  out[0] = v.x;
  out[1] = v.y;
  out[2] = v.z;
  return out;
}

export function CameraFocus({ frame, enabled = true }: CameraFocusProps) {
  const selectedAtoms = useStore(s => s.selectedAtoms);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const invalidate = useThree((state) => state.invalidate);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const legacyRef = useRef<LegacyFocus | null>(null);
  const previousAtomRef = useRef<number | null>(null);
  const seenSelectionRef = useRef<readonly number[] | null>(null);
  const lastCanvasTapRef = useRef(Number.NEGATIVE_INFINITY);

  const focus = useCallback((atomIndex: number, userMoved: boolean) => {
    const f = frameRef.current;
    if (!enabledRef.current || !(atomIndex >= 0) || atomIndex >= f.natoms) return;
    const ax = f.positions[atomIndex * 3];
    const ay = f.positions[atomIndex * 3 + 1];
    const az = f.positions[atomIndex * 3 + 2];
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)) return;

    const rig = getCameraRig();
    if (rig) {
      legacyRef.current = null;
      const { position, target } = rig.pose();
      let dx = position[0] - target[0];
      let dy = position[1] - target[1];
      let dz = position[2] - target[2];
      let distance = Math.hypot(dx, dy, dz);
      if (!(distance > 1e-9)) {
        dx = 0;
        dy = 0;
        dz = 1;
        distance = 1;
      }
      const reach = Math.min(distance, MAX_FOCUS_DISTANCE) / distance;
      rig.glideTo(
        { target: [ax, ay, az], position: [ax + dx * reach, ay + dy * reach, az + dz * reach] },
        { userMoved },
      );
      invalidate();
      return;
    }

    const orbitTarget = (controls as { target?: THREE.Vector3 } | null)?.target;
    if (!orbitTarget) return;
    legacyRef.current = {
      goal: [ax, ay, az],
      target: createSpring3([orbitTarget.x, orbitTarget.y, orbitTarget.z]),
      position: createSpring3([camera.position.x, camera.position.y, camera.position.z]),
    };
    invalidate();
  }, [camera, controls, invalidate]);

  // Canvas taps mark the selection they make as theirs.
  useEffect(() => onIntent('canvas.tap', () => {
    lastCanvasTapRef.current = now();
  }), []);

  useEffect(() => onIntent('camera.focusAtom', ({ atomIndex }) => focus(atomIndex, true)), [focus]);

  useEffect(() => {
    if (!enabled) legacyRef.current = null;
  }, [enabled]);

  useEffect(() => {
    // Only a change of selection decides anything.
    if (seenSelectionRef.current === selectedAtoms) return;
    seenSelectionRef.current = selectedAtoms;
    const fromCanvas = consumeCanvasSelection() || now() - lastCanvasTapRef.current <= CANVAS_TAP_WINDOW_MS;
    lastCanvasTapRef.current = Number.NEGATIVE_INFINITY;

    if (selectedAtoms.length !== 1) {
      legacyRef.current = null;
      previousAtomRef.current = null;
      return;
    }
    const atomIndex = selectedAtoms[0];
    if (atomIndex === previousAtomRef.current) return;
    previousAtomRef.current = atomIndex;
    if (fromCanvas) return;
    focus(atomIndex, false);
  }, [selectedAtoms, focus]);

  // Without the rig: springs on the orbit target and (beyond 12 Å) the camera.
  useFrame((_, delta) => {
    const job = legacyRef.current;
    if (!job || !controls) return;
    const orbitControls = controls as { target?: THREE.Vector3; update?: () => void };
    const orbitTarget = orbitControls.target;
    if (!orbitTarget) return;
    const dt = Number.isFinite(delta) && delta > 0 ? delta : 0;

    // Follow whatever else moved the target or camera since the last frame
    // (a user drag keeps working); the springs keep their velocity.
    copyInto(job.target.value, orbitTarget);
    springTo3(job.target, job.goal, MOTION.glide, dt);
    orbitTarget.set(job.target.value[0], job.target.value[1], job.target.value[2]);

    const currentDistance = camera.position.distanceTo(orbitTarget);
    if (currentDistance > MAX_FOCUS_DISTANCE) {
      scratchDir.copy(camera.position).sub(orbitTarget).normalize();
      scratchGoal[0] = orbitTarget.x + scratchDir.x * MAX_FOCUS_DISTANCE;
      scratchGoal[1] = orbitTarget.y + scratchDir.y * MAX_FOCUS_DISTANCE;
      scratchGoal[2] = orbitTarget.z + scratchDir.z * MAX_FOCUS_DISTANCE;
      copyInto(job.position.value, camera.position);
      springTo3(job.position, scratchGoal, MOTION.glide, dt);
      camera.position.set(job.position.value[0], job.position.value[1], job.position.value[2]);
    }

    orbitControls.update?.();
    // Keep the render loop alive while focusing (frameloop is "demand" when idle).
    invalidate();

    const targetOff = Math.hypot(
      orbitTarget.x - job.goal[0],
      orbitTarget.y - job.goal[1],
      orbitTarget.z - job.goal[2],
    );
    if (targetOff < SETTLE_EPSILON && camera.position.distanceTo(orbitTarget) <= MAX_FOCUS_DISTANCE + SETTLE_EPSILON) {
      orbitTarget.set(job.goal[0], job.goal[1], job.goal[2]);
      orbitControls.update?.();
      useStore.getState().setCameraState(
        [camera.position.x, camera.position.y, camera.position.z],
        [orbitTarget.x, orbitTarget.y, orbitTarget.z],
      );
      legacyRef.current = null;
    }
  }, { phase: 'update', id: LUPI_JOB.cameraFocus });

  return null;
}
