/**
 * CameraToys — True Spin and Symmetry Detents on the camera rig, fed by the
 * loaded file's Object Facts.
 *
 * Per file (the key is `file.trajectory`):
 * - at its first frame, remember the opening view (Home) and, when the
 *   browser is idle (≤ 500 ms), compute Object Facts (≤ 2,000 atoms);
 * - register a TrueSpinCoast (the flick coasts on the molecule's inertia)
 *   and, for a single structure, SymmetryDetents (a coast clicks into a face)
 *   on the rig; unregister on file change or unmount. Without facts the rig
 *   keeps its isotropic coast and has no detents.
 *
 * Intents:
 * - `camera.detentStep` (arrow keys): glide to the neighbouring detent on
 *   screen, or 15° about world Y (←/→) or the camera's right (↑/↓) without
 *   one; a repeat during the glide steps on from where that glide is going.
 * - `camera.home`: glide back to the opening view.
 * - `camera.rest` with a detent label, or a key step's arrival: the pill
 *   flashes the detent's name for 1.2 s (`cue('detent')`).
 * - `play.spin` (Motion: Standard only): toss the molecule about its middle
 *   axis; a flip flashes "Flip! · tennis-racket effect" (`spin.flip`,
 *   `cue('flip')`).
 * The `stepDetent(dx = 1, dy = 0)` dev hook appears once this file's toys are
 * in place and steps like the arrow keys ({ label, dir } or null).
 *
 * Toys only ever move the camera through the rig, which writes the store at
 * rest; the molecule, the store's atoms and every capture stay untouched.
 */
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import type { Camera } from 'three';
import { emitIntent, onIntent } from '@atlas/scene';
import type { Frame } from '@atlas/core/types';
import { useStore } from '../store';
import { coastEnabled } from '../motion/comfort';
import { playStore } from '../play/playStore';
import { cue } from '../play/feedback';
import { registerPlayDevHook } from '../play/devHooks';
import { hasFirstFrame, onFirstFrame } from '../relay/firstFrame';
import { getCameraRig, type LupiCameraRigApi, type Vec3 } from './rigApi';
import { objectFactsForFile } from './objectFactsForFile';
import { MOLECULAR_RECIPE_ID } from '@atlas/core/bonds';
import { getPerceivedBonds, molecularBondPairs, resolveFrameRecipe } from '../bonds/perceivedBonds';
import { TRUE_SPIN, TrueSpinCoast } from './trueSpinCoast';
import { SymmetryDetents } from './symmetryDetents';

export interface CameraToysProps {
  frame: Frame;
}

export const CAMERA_TOYS = {
  /** Facts wait at most this long for an idle moment after the first frame (ms). */
  idleTimeoutMs: 500,
  detentFlashMs: 1200,
  flipFlashMs: 1800,
  flipText: 'Flip! · tennis-racket effect',
  /** Arrow-key step without detents (deg). */
  fallbackStepDeg: 15,
  /** Polar limits for the fallback's vertical steps (deg from +Y). */
  minPolarDeg: 1,
  maxPolarDeg: 179,
  /** A key step still in flight for this long is where the next repeat starts (ms). */
  stepChainMs: 1000,
} as const;

const DEG = Math.PI / 180;

interface Toys {
  coast: TrueSpinCoast | null;
  detents: SymmetryDetents | null;
  /** The facts arrived and the models were handed to the rig (if any). */
  ready: boolean;
  /** The rig the models are registered on. */
  rig: LupiCameraRigApi | null;
  opening: { position: Vec3; target: Vec3 } | null;
  /** A key step's destination while its glide runs. */
  step: { dir: Vec3; at: number } | null;
}

function emptyToys(): Toys {
  return { coast: null, detents: null, ready: false, rig: null, opening: null, step: null };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function scheduleIdle(fn: () => void, timeoutMs: number): () => void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: timeoutMs });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 1);
  return () => clearTimeout(id);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function unit(v: Vec3): Vec3 | null {
  const m = Math.hypot(v[0], v[1], v[2]);
  return m > 1e-12 && Number.isFinite(m) ? [v[0] / m, v[1] / m, v[2] / m] : null;
}

/** The camera's on-screen axes in world space (its matrix columns). */
function screenAxes(camera: Camera): { right: Vec3; up: Vec3 } {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  return {
    right: unit([e[0], e[1], e[2]]) ?? [1, 0, 0],
    up: unit([e[4], e[5], e[6]]) ?? [0, 1, 0],
  };
}

/** `view` turned by the arrow: azimuth about world +Y (dx), polar toward +Y (dy), clamped off the poles. */
function fallbackStep(view: Vec3, dx: number, dy: number): Vec3 {
  const step = CAMERA_TOYS.fallbackStepDeg * DEG;
  const polar = Math.acos(Math.max(-1, Math.min(1, view[1])));
  const azimuth = Math.atan2(view[0], view[2]) + dx * step;
  const next = Math.max(CAMERA_TOYS.minPolarDeg * DEG, Math.min(CAMERA_TOYS.maxPolarDeg * DEG, polar - dy * step));
  const s = Math.sin(next);
  return [s * Math.sin(azimuth), Math.cos(next), s * Math.cos(azimuth)];
}

function flashDetent(label: string): void {
  playStore.getState().flashText(label, 'detent', CAMERA_TOYS.detentFlashMs);
  cue('detent');
}

function onFlip(): void {
  emitIntent({ type: 'spin.flip' });
  playStore.getState().flashText(CAMERA_TOYS.flipText, 'flip', CAMERA_TOYS.flipFlashMs);
  cue('flip');
}

/**
 * A molecular frame's covalent and coordination pairs (the drawn graph,
 * before display filters); undefined keeps Object Facts' own distance bonds.
 */
function factsBondPairs(frame: Frame, frameCount: number): Int32Array | undefined {
  const { bondProfile, bondTolerance } = useStore.getState();
  if (resolveFrameRecipe(frame, { profile: bondProfile, frameCount }) !== MOLECULAR_RECIPE_ID) return undefined;
  const perceived = getPerceivedBonds(frame, { recipe: MOLECULAR_RECIPE_ID, tolerance: bondTolerance });
  return perceived ? molecularBondPairs(perceived) : undefined;
}

function captureDisabled(): boolean {
  return useStore.getState().measurementTool != null;
}

function register(toys: Toys): void {
  const rig = getCameraRig();
  toys.ready = true;
  toys.rig = rig;
  if (!rig) return;
  rig.setCoastModel(toys.coast);
  rig.setDetentProvider(toys.detents);
}

/** One arrow-key hop: glide to the neighbouring detent (or 15°); returns where it goes. */
function stepDetent(toys: Toys, camera: Camera, dx: number, dy: number): { label: string | null; dir: Vec3 } | null {
  const rig = getCameraRig();
  if (!rig || (dx === 0 && dy === 0)) return null;
  const pose = rig.pose();
  const offset = sub(pose.position, pose.target);
  const distance = Math.hypot(offset[0], offset[1], offset[2]);
  const current = unit(offset);
  if (!current || !(distance > 0)) return null;
  // A repeat while a key step is still gliding steps on from its destination.
  const chained = toys.step && rig.isMoving() && now() - toys.step.at < CAMERA_TOYS.stepChainMs ? toys.step.dir : null;
  const view = chained ?? current;
  const detents = toys.rig === rig ? toys.detents : null;
  let dir: Vec3 | null = null;
  let label: string | null = null;
  if (detents) {
    const { right, up } = screenAxes(camera);
    const hit = detents.step(view, right, up, dx, dy);
    if (hit) {
      dir = unit(hit.dir);
      label = hit.label;
    }
  }
  if (!dir) dir = fallbackStep(view, dx, dy);
  const target = pose.target;
  const position: Vec3 = [target[0] + dir[0] * distance, target[1] + dir[1] * distance, target[2] + dir[2] * distance];
  const step = { dir, at: now() };
  toys.step = step;
  rig.glideTo(
    { position, target },
    {
      userMoved: true,
      onDone: () => {
        if (toys.step === step) toys.step = null;
        if (label) flashDetent(label);
      },
    },
  );
  return { label, dir };
}

export function CameraToys({ frame }: CameraToysProps): null {
  const camera = useThree((s) => s.camera);
  const trajectory = useStore((s) => s.file?.trajectory ?? null);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const toysRef = useRef<Toys>(emptyToys());

  // Per file: opening view, Object Facts, and the rig registration.
  useEffect(() => {
    if (!trajectory) return undefined;
    const toys: Toys = emptyToys();
    toysRef.current = toys;
    let disposed = false;
    let cancelIdle: () => void = () => {};
    let unhookStep: () => void = () => {};

    const arm = () => {
      if (disposed || toys.opening) return;
      const state = useStore.getState();
      toys.opening = { position: [...state.cameraPosition] as Vec3, target: [...state.cameraTarget] as Vec3 };
      cancelIdle = scheduleIdle(() => {
        if (disposed) return;
        let facts = null;
        try {
          facts = objectFactsForFile(frameRef.current, { bondPairs: factsBondPairs(frameRef.current, trajectory.totalFrames ?? 1) });
        } catch (error) {
          console.error('[lupi] object facts failed', error);
        }
        if (facts && facts.rotor !== 'atom') toys.coast = new TrueSpinCoast(facts, { onFlip });
        const single = (trajectory.totalFrames ?? 1) <= 1;
        if (facts && single && facts.detents.length > 0) {
          toys.detents = new SymmetryDetents(facts, { captureDisabled });
        }
        register(toys);
        unhookStep = registerPlayDevHook('stepDetent', (dx?: number, dy?: number) =>
          stepDetent(toysRef.current, cameraRef.current, Math.sign(dx ?? 1), Math.sign(dy ?? 0)),
        );
      }, CAMERA_TOYS.idleTimeoutMs);
    };
    const offFirstFrame = onFirstFrame((key) => {
      if (key === trajectory) arm();
    });
    if (hasFirstFrame(trajectory)) arm();

    return () => {
      disposed = true;
      offFirstFrame();
      cancelIdle();
      unhookStep();
      const rig = toys.rig;
      if (rig && getCameraRig() === rig) {
        rig.setCoastModel(null);
        rig.setDetentProvider(null);
      }
      toys.coast?.stop();
      if (toysRef.current === toys) toysRef.current = emptyToys();
    };
  }, [trajectory]);

  // Intents, for as long as the toys are mounted.
  useEffect(() => {
    const cleanups = [
      onIntent('camera.detentStep', ({ dx, dy }) => {
        stepDetent(toysRef.current, cameraRef.current, dx, dy);
      }),
      onIntent('camera.home', () => {
        const toys = toysRef.current;
        const rig = getCameraRig();
        if (!rig || !toys.opening) return;
        toys.step = null;
        rig.glideTo(toys.opening, { userMoved: false });
      }),
      onIntent('camera.rest', ({ detentLabel }) => {
        if (detentLabel) flashDetent(detentLabel);
      }),
      onIntent('camera.gestureStart', () => {
        const toys = toysRef.current;
        toys.step = null;
        // A rig that mounted again since the facts arrived gets them too.
        if (toys.ready && getCameraRig() !== toys.rig) register(toys);
      }),
      onIntent('play.spin', () => {
        if (!coastEnabled()) return;
        const toys = toysRef.current;
        const rig = getCameraRig();
        if (!rig) return;
        if (toys.ready && rig !== toys.rig) register(toys);
        toys.step = null;
        const coast = toys.rig === rig ? toys.coast : null;
        if (!coast) {
          rig.fling([0, TRUE_SPIN.spinOmega, 0]);
          return;
        }
        const pose = rig.pose();
        rig.fling(coast.armSpin(unit(sub(pose.position, pose.target))));
        coast.disarmSpin();
      }),
    ];
    return () => {
      for (const cleanup of cleanups.reverse()) cleanup();
    };
  }, []);

  return null;
}
