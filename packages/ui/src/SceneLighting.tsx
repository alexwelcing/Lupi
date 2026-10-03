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
import { useEffect, useLayoutEffect, useState } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import { PMREMGenerator } from 'three/webgpu';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { requestLupiFrames } from '@atlas/scene';
import { useStore } from './store';
import {
  clearSceneEnvironmentLoadFailure,
  environmentAssetUrls,
  installSceneEnvironmentPmrem,
  markSceneEnvironmentLoadFailed,
  resolveSceneEnvironment,
  type DreiEnvironmentPreset,
} from './sceneEnvironment';
import {
  installScientificStudioEnvironment,
  scientificStudioRigFor,
  type StudioRigAngles,
} from './studioEnvironment';

// Lighting rig radius (meters) — matches the legacy inline placement in App.
const RIG_RADIUS = 11.18;
const DEG = Math.PI / 180;

/**
 * The pinned HDRs, one download per preset for the page's lifetime. Each
 * preset tries the self-hosted file, then the upstream mirror (the same
 * bytes). A failed download leaves the cache, so choosing the preset again
 * retries it.
 */
const environmentSources = new Map<DreiEnvironmentPreset, Promise<THREE.DataTexture>>();

async function loadFirstEnvironmentSource(urls: readonly string[]): Promise<THREE.DataTexture> {
  let lastError: unknown = new Error('No environment URL');
  for (const url of urls) {
    try {
      const texture = await new HDRLoader().loadAsync(url);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      return texture;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function loadEnvironmentSource(preset: DreiEnvironmentPreset): Promise<THREE.DataTexture> {
  let pending = environmentSources.get(preset);
  if (!pending) {
    pending = loadFirstEnvironmentSource(environmentAssetUrls(preset));
    pending.catch(() => environmentSources.delete(preset));
    environmentSources.set(preset, pending);
  }
  return pending;
}

/**
 * Load the exact Drei preset asset (the pinned drei-assets HDR, through
 * three's HDRLoader rather than drei's deprecated RGBELoader path), prefilter
 * it explicitly for the custom atom BRDF, and tag the resulting CubeUV texture
 * with its immutable asset identity. The tag controls correctness: export
 * never treats an untagged/old environment as capture-ready.
 *
 * The download runs beside the scene rather than through Suspense: until it
 * arrives the molecule renders with the analytic environment, and a failed
 * download (offline, a missing file on both the self-hosted path and the
 * mirror) leaves it that way instead of taking the canvas into its error
 * boundary.
 */
function LupiEnvironment({ preset }: { preset: DreiEnvironmentPreset }) {
  const { renderer, scene } = useThree();
  const [source, setSource] = useState<{ preset: DreiEnvironmentPreset; texture: THREE.DataTexture } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadEnvironmentSource(preset).then(
      (texture) => {
        if (cancelled) return;
        clearSceneEnvironmentLoadFailure(preset);
        setSource({ preset, texture });
      },
      (error: unknown) => {
        if (cancelled) return;
        markSceneEnvironmentLoadFailed(preset);
        requestLupiFrames();
        console.warn(
          `[SceneLighting] Environment '${preset}' could not be loaded; rendering without image-based light.`,
          error instanceof Error ? error.message : String(error),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [preset]);

  useLayoutEffect(() => {
    if (!source || source.preset !== preset) return undefined;
    const uninstall = installSceneEnvironmentPmrem(
      scene,
      source.texture,
      preset,
      () => new PMREMGenerator(renderer),
    );
    // The PMREM lands outside React's props: draw it (and again on removal).
    requestLupiFrames();
    return () => {
      uninstall();
      requestLupiFrames();
    };
  }, [renderer, preset, scene, source]);

  return null;
}

/**
 * The procedural scientific-studio softbox rig (the Specimen rig). Nothing to
 * fetch and nothing to suspend on: the emissive rig scene is built on-device
 * and PMREM-baked once per install (and again when a light moves); after that
 * it costs the same as any static environment texture.
 */
function LupiSoftboxEnvironment({ angles }: { angles: StudioRigAngles }) {
  const { renderer, scene } = useThree();
  const {
    keyAzimuth, keyElevation, fillAzimuth, fillElevation, rimAzimuth, rimElevation,
  } = angles;
  // Re-baked (a five-panel scene, a few milliseconds) when a light moves, so
  // the softbox catchlight follows the key the atoms are lit by. The layout
  // effect lands it in the same commit as the light uniforms; on-demand frames
  // are woken both when the bake lands and when it is uninstalled.
  useLayoutEffect(() => {
    const uninstall = installScientificStudioEnvironment(
      scene,
      () => new PMREMGenerator(renderer),
      scientificStudioRigFor({ keyAzimuth, keyElevation, fillAzimuth, fillElevation, rimAzimuth, rimElevation }),
    );
    requestLupiFrames();
    return () => {
      uninstall();
      requestLupiFrames();
    };
  }, [renderer, scene, keyAzimuth, keyElevation, fillAzimuth, fillElevation, rimAzimuth, rimElevation]);

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
      {finalEnv === 'softbox' && (
        <LupiSoftboxEnvironment
          angles={{
            keyAzimuth: keyLightAzimuth,
            keyElevation: keyLightElevation,
            fillAzimuth: fillLightAzimuth,
            fillElevation: fillLightElevation,
            rimAzimuth: rimLightAzimuth,
            rimElevation: rimLightElevation,
          }}
        />
      )}
      {finalEnv && finalEnv !== 'softbox' && <LupiEnvironment preset={finalEnv} />}
    </>
  );
}
