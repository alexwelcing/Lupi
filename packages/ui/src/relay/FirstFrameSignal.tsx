/**
 * FirstFrameSignal — inside the Canvas: marks a file's first real frame and
 * hands the relay stage over to the live view.
 *
 * Group-1 body (the integrator's): the marking job alone, so the arrival
 * release (play chain) and CameraToys' Object Facts (camera chain) have a
 * real signal in their worktrees before the relay lands. The relay WP adds
 * the hero-baton camera and the relay hand-off here, and keeps this marking
 * job: other chains depend on it.
 *
 * - The key is the loaded file's `trajectory` object.
 * - A frame counts when a tagged atoms mesh (impostor or transmission) has
 *   instances; the second such rendered frame marks it (the first can still
 *   be a backend warm-up on WebGL2).
 * - Fallback: 4 s after the file is set, whatever was drawn.
 */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber/webgpu';
import type { Object3D } from 'three/webgpu';
import {
  LUPI_ARTIFACT_ATOMS_LAYER,
  LUPI_ARTIFACT_LAYER_KEY,
  LUPI_JOB,
  LUPI_PHASE,
} from '@atlas/scene';
import { useStore } from '../store';
import { hasFirstFrame, markFirstFrame } from './firstFrame';

const FIRST_FRAME_FALLBACK_MS = 4000;
const FRAMES_TO_MARK = 2;

type MaybeInstanced = Object3D & {
  isInstancedMesh?: boolean;
  count?: number;
  geometry?: { instanceCount?: number };
};

function drawsAtoms(root: Object3D): boolean {
  let found = false;
  root.traverse((object) => {
    if (found || object.userData?.[LUPI_ARTIFACT_LAYER_KEY] !== LUPI_ARTIFACT_ATOMS_LAYER) return;
    const mesh = object as MaybeInstanced;
    const instances = mesh.isInstancedMesh ? (mesh.count ?? 0) : (mesh.geometry?.instanceCount ?? 0);
    if (object.visible && instances > 0) found = true;
  });
  return found;
}

export function FirstFrameSignal(): null {
  const trajectory = useStore((state) => state.file?.trajectory ?? null);
  const counted = useRef<{ key: object | null; frames: number }>({ key: null, frames: 0 });

  useEffect(() => {
    if (!trajectory) return undefined;
    const timer = setTimeout(() => markFirstFrame(trajectory), FIRST_FRAME_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [trajectory]);

  useFrame(
    (state) => {
      const key = useStore.getState().file?.trajectory;
      if (!key || hasFirstFrame(key)) return;
      const count = counted.current;
      if (count.key !== key) {
        count.key = key;
        count.frames = 0;
      }
      if (!drawsAtoms(state.scene)) return;
      count.frames += 1;
      if (count.frames >= FRAMES_TO_MARK) markFirstFrame(key);
    },
    { phase: LUPI_PHASE.capture, id: LUPI_JOB.firstFrame },
  );

  return null;
}
