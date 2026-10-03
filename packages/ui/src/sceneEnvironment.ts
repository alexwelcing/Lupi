import * as THREE from 'three';

export type SceneEnvironmentPreset =
  | 'city'
  | 'studio'
  | 'dawn'
  | 'night'
  | 'warehouse'
  | 'forest'
  | 'softbox'
  | 'park'
  | 'none';

/** Presets backed by a fetched Drei HDRI asset. 'softbox' is generated
 *  procedurally on-device (see studioEnvironment.ts) and 'none' disables IBL,
 *  so neither belongs to the Drei asset universe. */
export type DreiEnvironmentPreset = Exclude<SceneEnvironmentPreset, 'none' | 'softbox'>;

export const DREI_ENVIRONMENT_ASSET_REVISION = '456060a26bbeb8fdf79326f224b6d99b8bcce736';
/**
 * Where Lupi serves the pinned HDRs: the same bytes as drei-assets at
 * DREI_ENVIRONMENT_ASSET_REVISION (Poly Haven, CC0), self-hosted from
 * `apps/web/public/hdri/` (see the NOTICE there). Same origin, so a blocked
 * or slow third-party CDN no longer decides how the molecule is lit.
 */
export const DREI_ENVIRONMENT_ASSET_ROOT = '/hdri/';
/**
 * The upstream copy (the URLs drei's presets use). Tried only when the
 * self-hosted file cannot be loaded, e.g. a page served from another origin
 * without `/hdri/`; the asset identity is the same either way.
 */
export const DREI_ENVIRONMENT_MIRROR_ROOT = `https://raw.githack.com/pmndrs/drei-assets/${DREI_ENVIRONMENT_ASSET_REVISION}/hdri/`;
export const DREI_ENVIRONMENT_FILES: Record<DreiEnvironmentPreset, string> = {
  city: 'potsdamer_platz_1k.hdr',
  dawn: 'kiara_1_dawn_1k.hdr',
  forest: 'forest_slope_1k.hdr',
  night: 'dikhololo_night_1k.hdr',
  park: 'rooitou_park_1k.hdr',
  studio: 'studio_small_03_1k.hdr',
  warehouse: 'empty_warehouse_01_1k.hdr',
};

/**
 * The procedural scientific-studio softbox rig (replaces the retired Drei
 * 'apartment' room HDRI). There is no fetched asset: the identity pins the
 * generator design version instead of a file revision, and the "file" names
 * the procedural recipe. sha1('lupi-scientific-softbox-studio-v1').
 */
export const SOFTBOX_ENVIRONMENT_REVISION = 'fecf2129e6137375f8a071c0b949f02aea986fd9';
export const SOFTBOX_ENVIRONMENT_FILE = 'procedural-scientific-softbox-v1';

/** Presets that resolve to a concrete PMREM texture (everything but 'none'). */
export type TexturedEnvironmentPreset = Exclude<SceneEnvironmentPreset, 'none'>;

export interface SceneEnvironmentIdentity {
  preset: TexturedEnvironmentPreset;
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

export function environmentAssetUrl(preset: DreiEnvironmentPreset): string {
  return `${DREI_ENVIRONMENT_ASSET_ROOT}${DREI_ENVIRONMENT_FILES[preset]}`;
}

/** Where to load a preset's HDR from, in order: self-hosted first, then the upstream mirror. */
export function environmentAssetUrls(preset: DreiEnvironmentPreset): readonly string[] {
  return [environmentAssetUrl(preset), `${DREI_ENVIRONMENT_MIRROR_ROOT}${DREI_ENVIRONMENT_FILES[preset]}`];
}

export function environmentAssetIdentity(
  preset: SceneEnvironmentPreset,
): SceneEnvironmentSpecIdentity {
  if (preset === 'none') return { preset: 'none' as const };
  if (preset === 'softbox') {
    return {
      preset: 'softbox' as const,
      assetRevision: SOFTBOX_ENVIRONMENT_REVISION,
      file: SOFTBOX_ENVIRONMENT_FILE,
      colorSpace: 'srgb-linear' as const,
    };
  }
  return {
    preset,
    assetRevision: DREI_ENVIRONMENT_ASSET_REVISION,
    file: DREI_ENVIRONMENT_FILES[preset],
    colorSpace: 'srgb-linear' as const,
  };
}

export function markSceneEnvironmentReady(
  texture: THREE.Texture,
  preset: TexturedEnvironmentPreset,
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
  fromEquirectangular(source: THREE.Texture): ScenePmremTarget;
  dispose(): void;
}

/**
 * The smallest equirect source three's PMREMGenerator sizes correctly
 * (three documents 64×32; it derives the cube size from width / 4).
 */
export const PMREM_MIN_SOURCE_WIDTH = 64;
export const PMREM_MIN_SOURCE_HEIGHT = 32;

type PixelArray = Uint8Array | Uint16Array | Float32Array;

function isPixelArray(value: unknown): value is PixelArray {
  return value instanceof Uint8Array || value instanceof Uint16Array || value instanceof Float32Array;
}

/**
 * A tiny equirect (a 1×1 fallback HDR, a truncated download) makes three's
 * PMREMGenerator size its cube from `width / 4` and allocate a degenerate
 * 336×1 atlas. Resample such a data texture (nearest, so a constant stays
 * exactly constant) to the minimum size PMREM handles; larger or non-data
 * sources pass through. The caller disposes `texture` when `owned`.
 */
export function preparePmremSource(source: THREE.Texture): { texture: THREE.Texture; owned: boolean } {
  const image = source.image as { width?: unknown; height?: unknown; data?: unknown } | undefined;
  const width = typeof image?.width === 'number' ? image.width : 0;
  const height = typeof image?.height === 'number' ? image.height : 0;
  if (!(source as THREE.DataTexture).isDataTexture || !isPixelArray(image?.data) || width < 1 || height < 1) {
    return { texture: source, owned: false };
  }
  if (width >= PMREM_MIN_SOURCE_WIDTH && height >= PMREM_MIN_SOURCE_HEIGHT) {
    return { texture: source, owned: false };
  }
  const data = image.data;
  const channels = Math.round(data.length / (width * height));
  if (channels < 1 || channels * width * height !== data.length) return { texture: source, owned: false };

  const outWidth = Math.max(PMREM_MIN_SOURCE_WIDTH, width);
  const outHeight = Math.max(PMREM_MIN_SOURCE_HEIGHT, height);
  const out = new (data.constructor as { new (length: number): PixelArray })(outWidth * outHeight * channels);
  for (let y = 0; y < outHeight; y += 1) {
    const sy = Math.min(height - 1, Math.floor((y * height) / outHeight));
    for (let x = 0; x < outWidth; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x * width) / outWidth));
      const from = (sy * width + sx) * channels;
      const to = (y * outWidth + x) * channels;
      for (let c = 0; c < channels; c += 1) out[to + c] = data[from + c];
    }
  }
  const resized = new THREE.DataTexture(out, outWidth, outHeight, source.format as THREE.PixelFormat, source.type);
  resized.mapping = source.mapping;
  resized.colorSpace = source.colorSpace;
  resized.flipY = source.flipY;
  resized.wrapS = source.wrapS;
  resized.wrapT = source.wrapT;
  resized.minFilter = THREE.LinearFilter;
  resized.magFilter = THREE.LinearFilter;
  resized.generateMipmaps = false;
  resized.needsUpdate = true;
  return { texture: resized, owned: true };
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
  const prepared = preparePmremSource(source);
  const generator = createGenerator();
  let target: ScenePmremTarget | null = null;
  try {
    target = generator.fromEquirectangular(prepared.texture);
  } finally {
    // The generated target is self-contained; generator shaders can go now.
    generator.dispose();
    if (prepared.owned) prepared.texture.dispose();
  }

  const texture = target.texture;
  // A degraded CDN asset (tiny or truncated HDR) can PMREM into a ≤1px atlas.
  // Three injects `1/width` and `1/height` as bare numeric shader defines, so
  // a 1px dimension emits an integer define that strict GLSL drivers reject —
  // failing compilation for EVERY environment-lit material in the scene. Such
  // a probe carries no directional light anyway: keep the previous
  // environment instead of letting CDN health decide product health.
  const image = texture.image as { width?: unknown; height?: unknown } | undefined;
  const atlasWidth = typeof image?.width === 'number' ? image.width : 0;
  const atlasHeight = typeof image?.height === 'number' ? image.height : 0;
  if (!(atlasWidth > 1 && atlasHeight > 1)) {
    console.warn(
      `[SceneLighting] Ignoring degenerate ${atlasWidth}x${atlasHeight} PMREM atlas for environment '${preset}'; keeping the previous environment.`,
    );
    target.dispose();
    return () => {};
  }
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

export function resolveSceneEnvironment(
  environmentPreset: SceneEnvironmentPreset,
): TexturedEnvironmentPreset | null {
  return environmentPreset === 'none' ? null : environmentPreset;
}

/**
 * Presets whose HDR asset failed to load in this page. The viewer renders on
 * without image-based light (the impostor kit falls back to its analytic
 * environment); an artifact that asks for such an environment fails closed
 * instead of waiting for it.
 */
const failedEnvironmentPresets = new Set<TexturedEnvironmentPreset>();

export function markSceneEnvironmentLoadFailed(preset: TexturedEnvironmentPreset): void {
  failedEnvironmentPresets.add(preset);
}

export function clearSceneEnvironmentLoadFailure(preset: TexturedEnvironmentPreset): void {
  failedEnvironmentPresets.delete(preset);
}

export function sceneEnvironmentLoadFailed(expected: unknown): boolean {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return false;
  const preset = (expected as Record<string, unknown>).preset;
  return typeof preset === 'string' && failedEnvironmentPresets.has(preset as TexturedEnvironmentPreset);
}
