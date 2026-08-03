/**
 * SceneLighting — the molecule's authored 3-point rig plus the HDRI
 * environment, made XR-aware.
 *
 * Outside AR (desktop preview + VR skybox) this behaves exactly as before:
 * an ambient term, a key directional, and — for small systems — fill / rim
 * lights, with a PMREM <Environment> for image-based reflections.
 *
 * In an immersive-ar session where WebXR light-estimation is live
 * (arLightEstimationActive), two things change so the *real* surroundings —
 * e.g. a campfire — drive the look:
 *   - the static rig is pulled right down, so the estimated light + reflections
 *     dominate instead of being washed out by a fixed studio rig;
 *   - the static <Environment> is dropped entirely, because XRLightEstimation
 *     owns scene.environment with the live reflection map and the two must not
 *     fight over it.
 */
import { useLayoutEffect } from 'react';
import { useEnvironment } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import * as THREE from 'three';
import { useStore } from './store';
import {
  installSceneEnvironmentPmrem,
  resolveSceneEnvironment,
  type DreiEnvironmentPreset,
} from './sceneEnvironment';
import { installScientificStudioEnvironment } from './studioEnvironment';

// Lighting rig radius (meters) — matches the legacy inline placement in App.
const RIG_RADIUS = 11.18;
const DEG = Math.PI / 180;

// How far the static rig is pulled down once the real world is lighting the
// scene. Not zero, so the molecule never goes fully black if the estimate is
// extremely dark; the light probe + reflections carry the rest.
const AR_AMBIENT_FACTOR = 0.15;
const AR_KEY_FACTOR = 0.1;

/**
 * Load the exact Drei preset asset, prefilter it explicitly for the custom atom
 * BRDF, and tag the resulting CubeUV texture with its immutable asset identity.
 * Suspense controls loading; the tag controls correctness. Export never treats
 * an untagged/old environment as capture-ready.
 */
function LupiEnvironment({ preset }: { preset: DreiEnvironmentPreset }) {
  const source = useEnvironment({ preset });
  const { gl, scene } = useThree();
  useLayoutEffect(() => installSceneEnvironmentPmrem(
    scene,
    source,
    preset,
    () => new THREE.PMREMGenerator(gl),
  ), [gl, preset, scene, source]);

  return null;
}

/**
 * The procedural scientific-studio softbox rig. Nothing to fetch and nothing
 * to suspend on: the emissive rig scene is built on-device and PMREM-baked
 * exactly once per install; after that it costs the same as any static
 * environment texture.
 */
function LupiSoftboxEnvironment() {
  const { gl, scene } = useThree();
  useLayoutEffect(() => installScientificStudioEnvironment(
    scene,
    () => new THREE.PMREMGenerator(gl),
  ), [gl, scene]);

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
  const mode = useXR(s => s.mode);
  const estimationActive = useStore(s => s.arLightEstimationActive);
  const isAR = mode === 'immersive-ar';
  const arLit = isAR && estimationActive;

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

  const ambient = arLit ? ambientLightIntensity * AR_AMBIENT_FACTOR : ambientLightIntensity;
  const key = arLit ? dirLightIntensity * AR_KEY_FACTOR : dirLightIntensity;

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
      {!isAR && finalEnv === 'softbox' && <LupiSoftboxEnvironment />}
      {!isAR && finalEnv && finalEnv !== 'softbox' && <LupiEnvironment preset={finalEnv} />}
    </>
  );
}
