/**
 * FoilDriver — feeds the impostors' Foil finish (scene `tsl/atomFoil.ts`)
 * from the Remix store, inside the Canvas.
 *
 * - A new finish (a Foil roll, a shared Foil code, a finish the visitor
 *   picked) is revealed by one ~900 ms sweep across the molecule from the
 *   key-light side: a bright band passes and leaves the finish behind.
 * - No finish: it fades out in ~300 ms.
 * - Motion: Still shows and hides it in one cut (no sweep, no band).
 *
 * The sweep's extent is the molecule's bounding sphere in model space, from
 * the file's first frame. Only the shared uniforms are written; the capture
 * and recording guards keep every artifact free of it. Quiet Idle: it keeps
 * the loop awake only while a sweep or a fade runs.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import {
  ATOM_FOIL,
  FOIL_FINISH_ID,
  LUPI_JOB,
  LUPI_PHASE,
  keepLupiAwake,
  requestLupiFrames,
  setLupiFoilSweepDirection,
} from '@atlas/scene';
import type { Frame } from '@atlas/core/types';
import { useStore } from '../store';
import { getComfort } from '../motion/comfort';
import { remixStore, shownFinish, type RemixState } from './remixStore';
import type { FoilKind } from './code';

/** The reveal sweep and the fade-out (ms). */
export const FOIL_SWEEP_MS = 900;
const FOIL_FADE_OUT_MS = 300;

interface FoilAnimation {
  finish: FoilKind | null;
  /** What revealed the finish (a code, by when it landed, or the visitor's choice). */
  reveal: string | null;
  /** performance.now() when the current sweep or fade began; null at rest. */
  sweepStart: number | null;
  fadeStart: number | null;
}

/** The molecule's bounding sphere (model space) from a frame's positions. */
function boundsOf(frame: Frame | undefined): { center: [number, number, number]; radius: number } | null {
  const positions = frame?.positions;
  if (!positions || positions.length < 3) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = Math.max(0.5, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  return { center, radius };
}

const keyWorld = new THREE.Vector3();
const keyView = new THREE.Vector3();

function keyLightWorld(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return keyWorld.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

export function FoilDriver(): null {
  const { camera } = useThree();
  const anim = useRef<FoilAnimation>({ finish: null, reveal: null, sweepStart: null, fadeStart: null });
  const trajectory = useStore((state) => state.file?.trajectory ?? null);

  // The sweep's extent follows the molecule.
  useEffect(() => {
    const bounds = boundsOf(trajectory?.frames[0]);
    if (bounds) {
      ATOM_FOIL.uFoilCenter.value.set(...bounds.center);
      ATOM_FOIL.uFoilRadius.value = bounds.radius;
    }
  }, [trajectory]);

  // Quiet Idle: draw while a sweep or a fade runs.
  useEffect(
    () => keepLupiAwake('atom-foil', () => anim.current.sweepStart !== null || anim.current.fadeStart !== null),
    [],
  );

  // The finish on screen follows the Remix store.
  useEffect(() => {
    const apply = (state: RemixState) => {
      const finish = shownFinish(state);
      // Each new Foil code sweeps again, even with the same finish as before.
      const reveal = !finish ? null : state.chosenFinish ? `chosen:${finish}` : `code:${state.applied?.at ?? 0}`;
      const a = anim.current;
      if (finish === a.finish && reveal === a.reveal) return;
      a.reveal = reveal;
      const still = getComfort() === 'still';
      if (finish) {
        a.finish = finish;
        a.fadeStart = null;
        ATOM_FOIL.uFoilFinish.value = FOIL_FINISH_ID[finish];
        ATOM_FOIL.uFoilLevel.value = 1;
        ATOM_FOIL.uFoilSweep.value = still ? 1 : 0;
        a.sweepStart = still ? null : performance.now();
      } else {
        a.finish = null;
        a.sweepStart = null;
        if (still) {
          ATOM_FOIL.uFoilLevel.value = 0;
          ATOM_FOIL.uFoilFinish.value = 0;
          a.fadeStart = null;
        } else {
          a.fadeStart = performance.now();
        }
      }
      requestLupiFrames();
    };
    apply(remixStore.getState());
    const off = remixStore.subscribe((state) => apply(state));
    return () => {
      off();
      ATOM_FOIL.uFoilFinish.value = 0;
      ATOM_FOIL.uFoilLevel.value = 0;
      ATOM_FOIL.uFoilSweep.value = 1;
      requestLupiFrames();
    };
  }, []);

  useFrame(
    () => {
      const a = anim.current;
      if (a.sweepStart === null && a.fadeStart === null) return;
      const t = performance.now();
      if (a.sweepStart !== null) {
        // From the key-light side, as the light sits on screen right now.
        const state = useStore.getState();
        keyView.copy(keyLightWorld(state.keyLightAzimuth, state.keyLightElevation)).transformDirection(camera.matrixWorldInverse);
        setLupiFoilSweepDirection(-keyView.x, -keyView.y);
        const p = Math.min(1, (t - a.sweepStart) / FOIL_SWEEP_MS);
        ATOM_FOIL.uFoilSweep.value = p;
        if (p >= 1) a.sweepStart = null;
      }
      if (a.fadeStart !== null) {
        const p = Math.min(1, (t - a.fadeStart) / FOIL_FADE_OUT_MS);
        ATOM_FOIL.uFoilLevel.value = 1 - p;
        if (p >= 1) {
          a.fadeStart = null;
          ATOM_FOIL.uFoilFinish.value = 0;
          ATOM_FOIL.uFoilLevel.value = 0;
        }
      }
    },
    { phase: LUPI_PHASE.uniforms, id: LUPI_JOB.atomFoil },
  );

  return null;
}
