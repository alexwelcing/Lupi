/**
 * FirstFrameSignal — inside the Canvas: marks a file's first real frame and
 * hands the relay stage over to the live view.
 *
 * - The key is the loaded file's `trajectory` object.
 * - A frame counts when a tagged atoms mesh (impostor or transmission) has
 *   instances; the second such rendered frame marks it (the first can still
 *   be a backend warm-up on WebGL2). Other chains (the arrival release,
 *   CameraToys' Object Facts) wait on this mark.
 * - With bonds on, the mark also waits for the bonds (they arrive after the
 *   atoms, from the bond worker or the GPU bond pass): at most
 *   BOND_WAIT_FRAMES atom frames or BOND_WAIT_MS, and while the relay still
 *   covers the page up to RELAY_BOND_WAIT_MS whatever the frame rate. The
 *   relay's ink cage has its bonds, so the lit cage it hands over to should
 *   too; the visitor can keep turning the drawing meanwhile. Without the
 *   relay a long wait would only hold a plate over atoms already drawn.
 * - Fallback: 4 s after the file is set, whatever was drawn.
 *
 * The hand-off, when the visitor tapped the home page's drawing:
 * - As the file arrives (a layout effect, before the first render), the
 *   camera takes the baton's view direction from the bounds centre and is
 *   fitted along it (fitCameraView keeps the direction), so the cage first
 *   draws at the pose the drawing showed.
 * - On the marking frame, while the relay covers the page: the latest pose
 *   from the baton (the visitor may have kept turning the drawing) is applied
 *   instantly, the relay ends (a 120 ms crossfade), and 120 ms later a live
 *   spin carries on as a fling of the camera rig. The baton is then spent.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import type { Camera, Object3D } from 'three/webgpu';
import {
  LUPI_ARTIFACT_ATOMS_LAYER,
  LUPI_ARTIFACT_LAYER_KEY,
  LUPI_JOB,
  LUPI_PHASE,
} from '@atlas/scene';
import { useStore } from '../store';
import { getCameraRig } from '../camera/rigApi';
import { endRelay, isRelayActive, peekBaton, takeBaton, type RelayBaton, type Vec3 } from './baton';
import { hasFirstFrame, markFirstFrame } from './firstFrame';

const FIRST_FRAME_FALLBACK_MS = 4000;
const FRAMES_TO_MARK = 2;
/** Without the relay, never wait longer than this for the bonds. */
const BOND_WAIT_FRAMES = 10;
const BOND_WAIT_MS = 600;
/**
 * Under the relay (time only: at 60 fps ten frames are 170 ms, and the bond
 * worker's debounce alone is 150 ms). Measured on SwiftShader the bonds can
 * take seconds; then the hand-off goes ahead without them.
 */
const RELAY_BOND_WAIT_MS = 1500;
/** Rendered frames with the bonds reported, so they are really on screen. */
const BOND_FRAMES_TO_MARK = 2;
/** The relay's crossfade; the spin resumes once the cage is on screen. */
const FLING_DELAY_MS = 120;
/** Slower than this (rad/s) is a drawing at rest, not a spin to carry. */
const FLING_MIN_OMEGA = 0.5;

type MaybeInstanced = Object3D & {
  isInstancedMesh?: boolean;
  count?: number;
  geometry?: { instanceCount?: number };
};

interface OrbitLike {
  target?: { set(x: number, y: number, z: number): unknown };
  update?: () => unknown;
}

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

/** The baton handed over for the molecule now loaded, if any. */
function batonForLoadedCard(): RelayBaton | null {
  const baton = peekBaton();
  return baton && baton.galleryId === useStore.getState().activeCardId ? baton : null;
}

/**
 * Look along `viewDir` (normalize(camera − target)) at the bounds centre,
 * fitted: in the store (the rest pose everyone reads) and on the live camera
 * and controls at once. `camera.up` is left alone.
 */
function applyViewDir(viewDir: Vec3, camera: Camera, controls: OrbitLike | null): void {
  const bounds = useStore.getState().file?.trajectory.globalBounds;
  const length = Math.hypot(viewDir[0], viewDir[1], viewDir[2]);
  if (!bounds || !(length > 1e-6)) return;
  const target: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  useStore.setState({
    cameraPreset: 'free',
    cameraPosition: [
      target[0] + viewDir[0] / length,
      target[1] + viewDir[1] / length,
      target[2] + viewDir[2] / length,
    ],
    cameraTarget: target,
  });
  useStore.getState().fitCameraView();
  const { cameraPosition, cameraTarget } = useStore.getState();
  camera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
  camera.lookAt(cameraTarget[0], cameraTarget[1], cameraTarget[2]);
  camera.updateMatrixWorld();
  if (controls?.target) {
    controls.target.set(cameraTarget[0], cameraTarget[1], cameraTarget[2]);
    controls.update?.();
  }
}

export function FirstFrameSignal(): null {
  const trajectory = useStore((state) => state.file?.trajectory ?? null);
  const get = useThree((state) => state.get);
  const counted = useRef({ key: null as object | null, frames: 0, bondFrames: 0, since: 0 });
  const flingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Mark `key`'s first frame and, when the relay still covers the page, hand over to the live view. */
  const handOff = useCallback((key: object) => {
    if (hasFirstFrame(key)) return;
    const relay = isRelayActive();
    const baton = batonForLoadedCard();
    const three = get();
    if (relay && baton?.viewDir) applyViewDir(baton.viewDir, three.camera, three.controls as unknown as OrbitLike | null);
    markFirstFrame(key);
    if (relay) endRelay();
    if (!baton) return;
    takeBaton();
    const omega = relay ? baton.bodyOmegaY : 0;
    if (Number.isFinite(omega) && Math.abs(omega) > FLING_MIN_OMEGA) {
      if (flingTimer.current) clearTimeout(flingTimer.current);
      flingTimer.current = setTimeout(() => {
        flingTimer.current = null;
        getCameraRig()?.fling([0, omega, 0]);
      }, FLING_DELAY_MS);
    }
  }, [get]);

  // Before the first render of a newly loaded file: start at the drawing's pose.
  useLayoutEffect(() => {
    if (!trajectory) return;
    const baton = batonForLoadedCard();
    if (!baton?.viewDir) return;
    const three = get();
    applyViewDir(baton.viewDir, three.camera, three.controls as unknown as OrbitLike | null);
  }, [trajectory, get]);

  useEffect(() => {
    if (!trajectory) return undefined;
    const timer = setTimeout(() => handOff(trajectory), FIRST_FRAME_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [trajectory, handOff]);

  useEffect(
    () => () => {
      if (flingTimer.current) clearTimeout(flingTimer.current);
    },
    [],
  );

  useFrame(
    (state) => {
      const key = useStore.getState().file?.trajectory;
      if (!key || hasFirstFrame(key)) return;
      const count = counted.current;
      if (count.key !== key) {
        count.key = key;
        count.frames = 0;
        count.bondFrames = 0;
      }
      if (!drawsAtoms(state.scene)) return;
      count.frames += 1;
      if (count.frames === 1) count.since = performance.now();
      if (count.frames < FRAMES_TO_MARK) return;
      const { showBonds, lastBondCount } = useStore.getState();
      const waited = performance.now() - count.since;
      const waitForBonds = isRelayActive()
        ? waited < RELAY_BOND_WAIT_MS
        : count.frames < BOND_WAIT_FRAMES && waited < BOND_WAIT_MS;
      if (showBonds && waitForBonds) {
        if (lastBondCount > 0) count.bondFrames += 1;
        if (count.bondFrames < BOND_FRAMES_TO_MARK) return;
      }
      handOff(key);
    },
    { phase: LUPI_PHASE.capture, id: LUPI_JOB.firstFrame },
  );

  return null;
}
