import { useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { viewportAspectFromSize } from '../cameraFit';

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

  // Sync continuously during flythrough preview + keep clipping planes generous
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
  });

  // Sync with presets
  useEffect(() => {
    const unsub = useStore.subscribe(
      (s) => s.cameraPreset,
      () => {
        const { cameraPosition, cameraTarget } = useStore.getState();
        camera.position.set(...cameraPosition);
        camera.lookAt(...cameraTarget);
        applyPerspectiveProjection();
        if (controls && controls.target) {
          controls.target.set(...cameraTarget);
          controls.update();
        }
      }
    );
    return unsub;
  }, [camera, controls, applyPerspectiveProjection]);

  useEffect(() => {
    const applyStoredCamera = () => {
      const { cameraPosition, cameraTarget, cameraFov } = useStore.getState();
      camera.position.set(...cameraPosition);
      camera.lookAt(...cameraTarget);
      applyPerspectiveProjection(cameraFov);
      if (controls && controls.target) {
        controls.target.set(...cameraTarget);
        controls.update();
      }
    };
    const unsubs = [
      useStore.subscribe((s) => s.cameraPosition, applyStoredCamera),
      useStore.subscribe((s) => s.cameraTarget, applyStoredCamera),
      useStore.subscribe((s) => s.cameraFov, applyStoredCamera),
    ];
    return () => unsubs.forEach((unsub) => unsub());
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
    if (file && (!hadViewportAspect || (aspectChanged && state.cameraPreset !== 'free'))) {
      useStore.getState().fitCameraView();
    }
  }, [file, size.width, size.height]);

  void fileId;

  return null;
}
