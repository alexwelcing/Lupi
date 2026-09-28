/**
 * SceneLighting — the molecule's authored 3-point rig plus the HDRI
 * environment: an ambient term, a key directional, and — for small systems —
 * fill / rim lights, with a PMREM environment for image-based reflections.
 *
 * The PMREM comes from three/webgpu's PMREMGenerator, driven by the
 * WebGPURenderer (WebGPU, or its WebGL2 backend), and becomes
 * `scene.environment`: a CubeUV texture that node materials read directly and
 * that the impostor kit samples through `pmremTexture` (plan-final D13).
 */
import { useLayoutEffect } from 'react';
import { useLoader, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import { PMREMGenerator } from 'three/webgpu';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { useStore } from './store';
import {
  environmentAssetUrl,
  installSceneEnvironmentPmrem,
  resolveSceneEnvironment,
  type DreiEnvironmentPreset,
} from './sceneEnvironment';
import { installScientificStudioEnvironment } from './studioEnvironment';

// Lighting rig radius (meters) — matches the legacy inline placement in App.
const RIG_RADIUS = 11.18;
const DEG = Math.PI / 180;

/**
 * Load the exact Drei preset asset (the pinned drei-assets HDR, through
 * three's HDRLoader rather than drei's deprecated RGBELoader path), prefilter
 * it explicitly for the custom atom BRDF, and tag the resulting CubeUV texture
 * with its immutable asset identity. Suspense controls loading; the tag
 * controls correctness. Export never treats an untagged/old environment as
 * capture-ready.
 */
function LupiEnvironment({ preset }: { preset: DreiEnvironmentPreset }) {
  const source = useLoader(HDRLoader, environmentAssetUrl(preset));
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.LinearSRGBColorSpace;
  const { renderer, scene } = useThree();
  useLayoutEffect(() => installSceneEnvironmentPmrem(
    scene,
    source,
    preset,
    () => new PMREMGenerator(renderer),
  ), [renderer, preset, scene, source]);

  return null;
}

/**
 * The procedural scientific-studio softbox rig. Nothing to fetch and nothing
 * to suspend on: the emissive rig scene is built on-device and PMREM-baked
 * exactly once per install; after that it costs the same as any static
 * environment texture.
 */
function LupiSoftboxEnvironment() {
  const { renderer, scene } = useThree();
  useLayoutEffect(() => installScientificStudioEnvironment(
    scene,
    () => new PMREMGenerator(renderer),
  ), [renderer, scene]);

  return null;
}

function polarToCartesian(azimuthDeg: number, elevationDeg: number) {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return [
    RIG_RADIUS * Math.cos(el) * Math.sin(az),
    RIG_RADIUS * Math.sin(el),
    RIG_RADIUS * Math.cos(el) * Math.cos(az),
  ] as const;
}

export function SceneLighting() {
  const ambientLightIntensity = useStore(s => s.ambientLightIntensity);
  const dirLightIntensity = useStore(s => s.dirLightIntensity);
  const keyLightAzimuth = useStore(s => s.keyLightAzimuth);
  const keyLightElevation = useStore(s => s.keyLightElevation);
  const fillLightAzimuth = useStore(s => s.fillLightAzimuth);
  const fillLightElevation = useStore(s => s.fillLightElevation);
  const rimLightAzimuth = useStore(s => s.rimLightAzimuth);
  const rimLightElevation = useStore(s => s.rimLightElevation);
  const fillLightColor = useStore(s => s.fillLightColor);
  const rimLightColor = useStore(s => s.rimLightColor);
  const file = useStore(s => s.file);
  const environmentPreset = useStore(s => s.environmentPreset);

  const ambient = ambientLightIntensity;
  const key = dirLightIntensity;

  const [kx, ky, kz] = polarToCartesian(keyLightAzimuth, keyLightElevation);
  const [fx, fy, fz] = polarToCartesian(fillLightAzimuth, fillLightElevation);
  const [rx, ry, rz] = polarToCartesian(rimLightAzimuth, rimLightElevation);

  // Fill + rim are skipped for very large systems (perf) — preserved verbatim.
  const firstFramePositions = file?.trajectory?.frames?.[0]?.positions?.length;
  const smallSystem = !firstFramePositions || firstFramePositions / 3 <= 50000;

  // Static HDRI environment is owned by the material scene recipe. Look presets
  // only affect post-processing, so choosing "Direct Only" truly disables IBL.
  const finalEnv = resolveSceneEnvironment(environmentPreset);

  return (
    <>
      <ambientLight intensity={ambient} />
      <directionalLight position={[kx, ky, kz]} intensity={key} />
      {smallSystem && (
        <>
          <directionalLight position={[fx, fy, fz]} intensity={key * 0.3} color={fillLightColor} />
          <directionalLight position={[rx, ry, rz]} intensity={key * 0.15} color={rimLightColor} />
        </>
      )}
      {finalEnv === 'softbox' && <LupiSoftboxEnvironment />}
      {finalEnv && finalEnv !== 'softbox' && <LupiEnvironment preset={finalEnv} />}
    </>
  );
}
