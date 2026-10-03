import { useCallback, useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import { shallow } from 'zustand/shallow';
import { LUPI_JOB } from '@atlas/scene';
import { useStore } from '../store';
import { viewportAspectFromSize } from '../cameraFit';
import { consumeCameraGlideRequest, getCameraRig } from '../camera/rigApi';
import { glidesAnimate } from '../motion/comfort';

type Vec3 = [number, number, number];

function within(v: THREE.Vector3, a: Vec3, eps = 1e-6): boolean {
  return Math.abs(v.x - a[0]) <= eps && Math.abs(v.y - a[1]) <= eps && Math.abs(v.z - a[2]) <= eps;
}

const scratchForward = new THREE.Vector3();
const scratchToTarget = new THREE.Vector3();

/** True when the live camera already shows this store pose (the rig wrote it at rest). */
function liveMatchesStore(camera: THREE.Camera, target: THREE.Vector3 | undefined, position: Vec3, storeTarget: Vec3): boolean {
  if (!within(camera.position, position)) return false;
  if (target) return within(target, storeTarget);
  scratchToTarget.set(storeTarget[0] - position[0], storeTarget[1] - position[1], storeTarget[2] - position[2]);
  const length = scratchToTarget.length();
  if (length < 1e-9) return true;
  scratchForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  return scratchForward.dot(scratchToTarget) / length > 1 - 1e-9;
}

export function CameraManager({
  fileId,
  center,
  distance,
  near,
}: {
  fileId?: string;
  center: [number, number, number];
  distance: number;
  near: number;
}) {
  const { camera, controls, size } = useThree((s) => ({
    camera: s.camera,
    controls: s.controls as any,
    size: s.size,
  }));
  const flythroughPreview = useStore(s => s.flythroughPreview);
  const file = useStore(s => s.file);
  const previousLayoutHadStyle = useRef(false);

  const applyPerspectiveProjection = useCallback((nextFov?: number) => {
    if (camera instanceof THREE.PerspectiveCamera) {
      const camDist = Math.hypot(
        camera.position.x - center[0],
        camera.position.y - center[1],
        camera.position.z - center[2],
      );
      const minFar = Math.max(10000, distance * 100, camDist * 20);
      const fovChanged = Number.isFinite(nextFov) && Math.abs(camera.fov - nextFov!) > 1e-4;
      const nearChanged = Math.abs(camera.near - near) > 1e-4;
      const farChanged = camera.far < minFar;
      if (fovChanged || nearChanged || farChanged) {
        if (fovChanged) camera.fov = nextFov!;
        camera.near = near;
        camera.far = minFar;
        camera.updateProjectionMatrix();
      }
    }
  }, [camera, center, distance, near]);

  // Sync continuously during flythrough preview + keep clipping planes generous.
  // An `update`-phase job: after controls, before the default render.
  useFrame(() => {
    if (flythroughPreview) {
      const state = useStore.getState();
      camera.position.set(...state.cameraPosition);
      camera.lookAt(...state.cameraTarget);
      applyPerspectiveProjection(state.cameraFov);

      if (controls && controls.target) {
        controls.target.set(...state.cameraTarget);
        controls.update();
      }
      return;
    }

    applyPerspectiveProjection();
  }, { phase: 'update', id: LUPI_JOB.cameraSync });

  // One subscription for the whole store camera. Store writes stay instant
  // snaps (MCP, saved views, URL decode, gallery loads, the resize refit),
  // except UI writes wrapped in withCameraGlide(), which the rig animates.
  // The rig's own write at rest already matches the live camera: projection only.
  useEffect(() => {
    const unsub = useStore.subscribe(
      (s) => [s.cameraPosition, s.cameraTarget, s.cameraFov, s.cameraPreset] as const,
      () => {
        const { cameraPosition, cameraTarget, cameraFov } = useStore.getState();
        const animate = consumeCameraGlideRequest();
        const target = controls?.target as THREE.Vector3 | undefined;
        if (liveMatchesStore(camera, target, cameraPosition, cameraTarget)) {
          applyPerspectiveProjection(cameraFov);
          return;
        }
        const rig = getCameraRig();
        if (animate && rig && controls?.enabled !== false && glidesAnimate()) {
          applyPerspectiveProjection(cameraFov);
          rig.glideTo({ position: cameraPosition, target: cameraTarget });
          return;
        }
        camera.position.set(...cameraPosition);
        camera.lookAt(...cameraTarget);
        applyPerspectiveProjection(cameraFov);
        if (target) {
          target.set(...cameraTarget);
          controls.update();
        }
      },
      { equalityFn: shallow },
    );
    return unsub;
  }, [camera, controls, applyPerspectiveProjection]);

  // R3F owns the real Canvas layout and updates this size on every resize.
  // Install camera subscriptions above before fitting: store mutations then
  // reach the mounted Three camera on the same tick. The first usable Canvas
  // measurement corrects the provisional pre-mount fit; later orientation
  // changes refit named presets but respect a user-positioned free camera.
  useEffect(() => {
    const viewportAspect = viewportAspectFromSize(size.width, size.height);
    const state = useStore.getState();
    const hadViewportAspect =
      Number.isFinite(state.cameraViewportAspect) &&
      state.cameraViewportAspect > 0;
    const aspectChanged =
      !hadViewportAspect ||
      Math.abs(state.cameraViewportAspect - viewportAspect) > 1e-4;
    state.setCameraViewportAspect(viewportAspect);
    // A file already present at the first Canvas measurement was provisionally
    // fit against a square viewport. Correct it once. Afterwards setFile uses
    // the stored real aspect itself; metadata/streaming file replacements do
    // not refit, and orientation changes respect a user-positioned free camera.
    // Opening/closing the desktop Style column changes the actual canvas
    // rectangle. Refit in the same viewing direction so the model stays useful
    // beside it. (Phone sheets float over a full-bleed canvas and never resize
    // it; the display-only view inset makes their room.) Unrelated free-camera
    // viewport changes remain untouched.
    const styleLayoutChanged = aspectChanged && (state.activePanel === 'studio' || previousLayoutHadStyle.current);
    if (file && (!hadViewportAspect || styleLayoutChanged || (aspectChanged && state.cameraPreset !== 'free'))) {
      useStore.getState().fitCameraView();
    }
    previousLayoutHadStyle.current = state.activePanel === 'studio';
  }, [file, size.width, size.height]);

  void fileId;

  return null;
}
