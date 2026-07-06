import { useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';

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
  const { camera, controls } = useThree((s) => ({ camera: s.camera, controls: s.controls as any }));
  const flythroughPreview = useStore(s => s.flythroughPreview);

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

  // NOTE: the initial camera fit on file load has moved to the store's
  // setFile action (via fitCameraView) and the file-load completion paths,
  // so this component no longer watches file/center/distance dependencies.
  void fileId;

  return null;
}
