export type SceneEnvironmentPreset =
  | 'city'
  | 'studio'
  | 'dawn'
  | 'night'
  | 'warehouse'
  | 'forest'
  | 'apartment'
  | 'park'
  | 'none';

export type DreiEnvironmentPreset = Exclude<SceneEnvironmentPreset, 'none'>;

export const DREI_ENVIRONMENT_ASSET_REVISION = '456060a26bbeb8fdf79326f224b6d99b8bcce736';
export const DREI_ENVIRONMENT_FILES: Record<DreiEnvironmentPreset, string> = {
  apartment: 'lebombo_1k.hdr',
  city: 'potsdamer_platz_1k.hdr',
  dawn: 'kiara_1_dawn_1k.hdr',
  forest: 'forest_slope_1k.hdr',
  night: 'dikhololo_night_1k.hdr',
  park: 'rooitou_park_1k.hdr',
  studio: 'studio_small_03_1k.hdr',
  warehouse: 'empty_warehouse_01_1k.hdr',
};

export interface SceneEnvironmentIdentity {
  preset: DreiEnvironmentPreset;
  assetRevision: string;
  file: string;
  colorSpace: 'srgb-linear';
  pmrem: true;
}

export type SceneEnvironmentAssetIdentity = Omit<SceneEnvironmentIdentity, 'pmrem'>;
export type SceneEnvironmentSpecIdentity =
  | { preset: 'none' }
  | SceneEnvironmentAssetIdentity;

export const LUPI_ENVIRONMENT_IDENTITY_KEY = 'lupiEnvironmentIdentity';

export function environmentAssetIdentity(
  preset: SceneEnvironmentPreset,
): SceneEnvironmentSpecIdentity {
  if (preset === 'none') return { preset: 'none' as const };
  return {
    preset: preset as DreiEnvironmentPreset,
    assetRevision: DREI_ENVIRONMENT_ASSET_REVISION,
    file: DREI_ENVIRONMENT_FILES[preset],
    colorSpace: 'srgb-linear' as const,
  };
}

export function markSceneEnvironmentReady(
  texture: THREE.Texture,
  preset: DreiEnvironmentPreset,
): SceneEnvironmentIdentity {
  const assetIdentity = environmentAssetIdentity(preset) as SceneEnvironmentAssetIdentity;
  const identity: SceneEnvironmentIdentity = {
    ...assetIdentity,
    pmrem: true,
  };
  texture.userData[LUPI_ENVIRONMENT_IDENTITY_KEY] = identity;
  return identity;
}

interface ScenePmremTarget {
  texture: THREE.Texture;
  dispose(): void;
}

interface ScenePmremGenerator {
  compileEquirectangularShader(): void;
  fromEquirectangular(source: THREE.Texture): ScenePmremTarget;
  dispose(): void;
}

/**
 * Allocate and commit a PMREM only from layout-effect time. The source belongs
 * to Drei's loader cache; this transaction owns exactly the generator and the
 * generated target.
 */
export function installSceneEnvironmentPmrem(
  scene: THREE.Scene,
  source: THREE.Texture,
  preset: DreiEnvironmentPreset,
  createGenerator: () => ScenePmremGenerator,
): () => void {
  const previous = scene.environment;
  const generator = createGenerator();
  let target: ScenePmremTarget | null = null;
  try {
    generator.compileEquirectangularShader();
    target = generator.fromEquirectangular(source);
  } finally {
    // The generated target is self-contained; generator shaders can go now.
    generator.dispose();
  }

  const texture = target.texture;
  markSceneEnvironmentReady(texture, preset);
  scene.environment = texture;

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (scene.environment === texture) scene.environment = previous;
    target?.dispose();
    target = null;
  };
}

/** Fail closed unless the scene owns the exact loaded + PMREM'd spec asset. */
export function assertSceneEnvironmentReady(
  environment: THREE.Texture | null,
  expected: unknown,
): void {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    throw new Error('The finalized artifact spec is missing its environment identity.');
  }
  const requested = expected as Record<string, unknown>;
  if (requested.preset === 'none') {
    if (environment !== null) {
      throw new Error('Artifact spec requires no environment, but the scene still has an environment texture.');
    }
    return;
  }
  if (!environment) {
    throw new Error(`Artifact environment ${String(requested.preset)} is not loaded.`);
  }
  const actual = environment.userData[LUPI_ENVIRONMENT_IDENTITY_KEY] as
    | SceneEnvironmentIdentity
    | undefined;
  const image = environment.image as { width?: unknown; height?: unknown } | undefined;
  const hasAtlasDimensions = typeof image?.width === 'number'
    && image.width > 0
    && typeof image.height === 'number'
    && image.height > 0;
  if (
    !actual
    || actual.pmrem !== true
    || environment.mapping !== THREE.CubeUVReflectionMapping
    || environment.colorSpace !== THREE.LinearSRGBColorSpace
    || !hasAtlasDimensions
    || actual.preset !== requested.preset
    || actual.assetRevision !== requested.assetRevision
    || actual.file !== requested.file
    || actual.colorSpace !== requested.colorSpace
  ) {
    throw new Error(
      `Artifact environment ${String(requested.preset)} is not capture-ready with the requested asset revision.`,
    );
  }
}

export function resolveSceneEnvironment(environmentPreset: SceneEnvironmentPreset): DreiEnvironmentPreset | null {
  return environmentPreset === 'none' ? null : environmentPreset;
}
import * as THREE from 'three';
