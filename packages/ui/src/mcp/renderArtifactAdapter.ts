import {
  RENDER_ARTIFACT_SPEC_VERSION_V1,
  RENDER_CAPABILITY_VERSION_V1,
  RENDER_DELIVERY_VERSION_V1,
  RENDER_REQUEST_VERSION_V1,
  RENDERER_FINGERPRINT_VERSION_V1,
  assertRenderCapabilitySupportsSpecV1,
  canonicalizeRenderValueV1,
  computeRenderArtifactDigestV1,
  computeRenderArtifactKeyV1,
  computeRendererFingerprintV1,
  computeRenderSpecIdV1,
  createRenderLayerStateV1,
  validateRenderRequestV1,
  type RenderArtifactKeyV1,
  type RenderArtifactSpecV1,
  type RenderCapabilityV1,
  type RenderDeliveryV1,
  type RenderFormatV1,
  type RenderJsonObjectV1,
  type RenderJsonValueV1,
  type RenderLayerIdV1,
  type RendererFingerprintV1,
  type RenderRequestV1,
  type RenderSpecIdV1,
  type Sha256DigestV1,
} from '@atlas/core';
import { INK_LOOK_COLORS, INK_LOOK_TUNING, inkLookInkHex } from '@atlas/scene';
import { inkPlateColor } from '../ink/illustrate';
import { getBgMedia, BG_PRESETS } from '../backgroundPresets';
import { getDefaultQualityTier } from '../deviceCapabilities';
import { environmentAssetIdentity } from '../sceneEnvironment';
import { captureInkContourToSpec, captureLookToSpec, resolveCaptureLook } from '../export/captureLook';
import {
  SPECIMEN_SHADOW,
  specimenShadowEnabled,
  specimenShadowOpacity,
  specimenShadowResolution,
} from '../specimenShadow';
import type { AppState } from '../store';
import {
  DECODED_RENDER_FRAME_MEDIA_TYPE_V3,
  computeDecodedRenderFrameDigestV3,
} from '../renderArtifactSource';
import {
  BROWSER_RENDERER_ID_V2,
  DETERMINISM_V2,
  MODEL_ENCODER_V2,
  executionClassV2,
  rendererVersionV2,
} from '../export/exportProfileV2';
import {
  getLupiRendererRuntime,
  type LupiBackend,
  type LupiRendererRuntime,
} from '../viewer/createLupiRenderer';
import { LUPI_VIEWER_MCP_VERSION } from './protocol';
import { MOLECULAR_RECIPE_ID } from '@atlas/core/bonds';
import { resolveFrameRecipe } from '../bonds/perceivedBonds';
import { activeTransmissionQualityV1 } from './transmissionRuntime';

export const BROWSER_RENDERER_MODULE_ID_V1 = '@atlas/ui/mcp/renderArtifactAdapter';

/** `view.ink.pipeline`: the impostors' toon fills, analytic silhouette ink and hatching (scene tsl/inkLook.ts). */
export const INK_LOOK_PIPELINE_ID = 'impostor-ink.v1';

const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const BROWSER_SUPPORTED_LAYERS = [
  'background',
  'atoms',
  'vectorGlyphs',
  'bonds',
  'simulationCell',
  'filterShell',
  'moleculeShadow',
  'contactShadows',
  'axes',
] as const;

export const BROWSER_RENDER_CAPABILITY_V1: RenderCapabilityV1 = {
  version: RENDER_CAPABILITY_VERSION_V1,
  formats: {
    png: { enabled: true, alphaModes: ['opaque', 'transparent'], maxWidth: 4096, maxHeight: 4096 },
    jpeg: { enabled: true, alphaModes: ['opaque'], maxWidth: 4096, maxHeight: 4096 },
    webp: { enabled: true, alphaModes: ['opaque', 'transparent'], maxWidth: 4096, maxHeight: 4096 },
    glb: { enabled: true, alphaModes: ['not-applicable'] },
    // Three's stock USDZExporter serializes process-global object allocation
    // ids into archive paths. Until Lupi owns a stable USDZ serializer, the
    // content-addressed artifact lane must fail closed. The ordinary UI export
    // remains available outside this immutable-key contract.
    usdz: { enabled: false, alphaModes: [] },
  },
  layers: createRenderLayerStateV1(BROWSER_SUPPORTED_LAYERS),
};

export interface BrowserRenderAdapterOptionsV1 {
  format: RenderFormatV1;
  width?: number;
  height?: number;
  transparent?: boolean;
  delivery: RenderDeliveryV1;
  /**
   * Exact 40-hex repository SHA. Tests and pinned development verifiers may
   * provide this explicitly; production normally receives it from Vite.
   */
  buildSha?: string;
  /**
   * Test/embedded runtimes may provide the renderer record instead of the
   * viewer canvas's (`getLupiRendererRuntime()`); its backend picks the
   * execution class.
   */
  rendererRuntime?: LupiRendererRuntime;
  fetchAssetBytes?: (url: string) => Promise<ArrayBuffer>;
}

export interface BrowserRenderArtifactPlanV1 {
  request: RenderRequestV1;
  spec: RenderArtifactSpecV1;
  specId: RenderSpecIdV1;
  rendererFingerprint: RendererFingerprintV1;
  artifactKey: RenderArtifactKeyV1;
  buildIdentity: BrowserBuildIdentityV1;
}

export interface BrowserBuildIdentityV1 {
  readonly buildId: string;
  readonly gitSha: string | null;
  readonly durability: 'durable-release' | 'non-durable-development';
  readonly source:
    | 'vite-production-sha'
    | 'adapter-pinned-development'
    | 'vite-pinned-development'
    | 'unversioned-development';
}

export interface BrowserBuildIdentityEnvironmentV1 {
  readonly production: boolean;
  readonly injectedSha?: string;
  readonly adapterSha?: string;
}

/**
 * Release artifact identity is permitted only with an exact Git SHA. Local
 * Vite/test sessions remain usable, but their fingerprint is explicitly
 * marked non-durable instead of presenting a module URL as a release id.
 */
export function resolveBrowserBuildIdentityV1(
  environment: BrowserBuildIdentityEnvironmentV1,
): BrowserBuildIdentityV1 {
  const adapterSha = normalizeBuildSha(environment.adapterSha, 'buildSha');
  const injectedSha = normalizeBuildSha(environment.injectedSha, 'VITE_LUPI_BUILD_SHA');
  if (adapterSha && injectedSha && adapterSha !== injectedSha) {
    throw new Error('buildSha must match the VITE_LUPI_BUILD_SHA compiled into this browser bundle.');
  }
  const gitSha = adapterSha ?? injectedSha;

  if (environment.production) {
    if (adapterSha) {
      throw new Error(
        'Production browser artifact identity must come from build-time VITE_LUPI_BUILD_SHA injection.',
      );
    }
    if (!gitSha) {
      throw new Error(
        'Production browser artifact export requires VITE_LUPI_BUILD_SHA to be an exact 40-hex Git SHA.',
      );
    }
    return {
      buildId: gitSha,
      gitSha,
      durability: 'durable-release',
      source: 'vite-production-sha',
    };
  }

  if (gitSha) {
    return {
      buildId: gitSha,
      gitSha,
      durability: 'non-durable-development',
      source: adapterSha ? 'adapter-pinned-development' : 'vite-pinned-development',
    };
  }

  return {
    buildId: 'non-durable-development',
    gitSha: null,
    durability: 'non-durable-development',
    source: 'unversioned-development',
  };
}

/**
 * Snapshot the exact semantics the V2 capture engine renders (a render-target
 * readback of the raw scene; exportProfileV2.ts). DOM-only overlays are
 * intentionally absent. Active layers which cannot yet be represented
 * deterministically fail instead of receiving a false identity.
 */
export async function createBrowserRenderArtifactPlanV1(
  state: AppState,
  options: BrowserRenderAdapterOptionsV1,
): Promise<BrowserRenderArtifactPlanV1> {
  const file = state.file;
  if (!file) throw new Error('No molecule is loaded.');
  const frame = file.trajectory.frames[state.frame];
  if (!frame) throw new Error(`Frame ${state.frame} is unavailable.`);
  if (state.loadedAtomCount < frame.natoms || state.isStreamingFrames) {
    throw new Error('Artifact export requires a fully decoded current frame.');
  }
  if (state.playing) {
    throw new Error('Pause trajectory playback before creating a deterministic artifact.');
  }
  if (state.flythroughPreview) {
    throw new Error('Stop flythrough preview before creating a deterministic artifact.');
  }
  if (state.anomalyTracking) {
    throw new Error('Disable anomaly camera tracking before creating a deterministic artifact.');
  }
  if (state.ghostFile) {
    throw new Error('The V1 browser artifact contract cannot export an active comparison trajectory.');
  }
  if (state.annotations.length > 0) {
    throw new Error('The V1 browser artifact contract cannot yet capture annotations and trail history completely.');
  }
  if (state.showKnowledgeLabels && state.knowledgeLabels.length > 0) {
    throw new Error('The V1 browser artifact contract cannot yet capture DOM knowledge labels completely.');
  }

  const raster = options.format === 'png' || options.format === 'jpeg' || options.format === 'webp';
  if (!raster && options.transparent !== undefined) {
    throw new Error(`${options.format.toUpperCase()} does not accept the raster transparent field.`);
  }
  const alpha = raster ? (options.transparent ? 'transparent' : 'opaque') : 'not-applicable';
  const contentDigest = await computeDecodedRenderFrameDigestV3(frame);
  const layers: Record<RenderLayerIdV1, boolean> = { ...createRenderLayerStateV1() };
  const view: Record<string, RenderJsonValueV1> = {};
  if (raster) {
    const cameraPlanes = canonicalArtifactCameraPlanesV1(state);
    view.camera = {
      position: [...state.cameraPosition],
      target: [...state.cameraTarget],
      fov: state.cameraFov,
      near: cameraPlanes.near,
      far: cameraPlanes.far,
    };
    view.lighting = {
      ambient: state.ambientLightIntensity,
      directional: state.dirLightIntensity,
      rim: state.rimLightIntensity,
      keyAzimuth: state.keyLightAzimuth,
      keyElevation: state.keyLightElevation,
      fillAzimuth: state.fillLightAzimuth,
      fillElevation: state.fillLightElevation,
      rimAzimuth: state.rimLightAzimuth,
      rimElevation: state.rimLightElevation,
      fillColor: state.fillLightColor,
      rimColor: state.rimLightColor,
      environment: environmentAssetIdentity(state.environmentPreset),
    };
    // The viewer's configured look, as the capture applies it (never the
    // phone budget, so the spec does not depend on the device): the
    // 'viewer-look' recipe, or the raw-scene literal when it is empty
    // (export/captureLook.ts). Transparent output records no bloom, depth of
    // field or vignette, because the capture does not apply them.
    const look = resolveCaptureLook(state, { transparent: alpha === 'transparent' });
    view.postprocess = captureLookToSpec(look);
    // The Illustrate look shades the impostors themselves (scene
    // tsl/inkLook.ts); recorded only while it is on, so every lit spec keeps
    // its identity. The capture renders the configured look, never a fade.
    if (state.inkStyle !== 'off') {
      view.ink = {
        pipeline: INK_LOOK_PIPELINE_ID,
        shading: state.inkStyle,
        weight: Number(state.inkWeight.toPrecision(6)),
        // The drawing's ink: chalk under Chalk (its outlines and contour).
        ink: inkLookInkHex(state.inkStyle),
        paper: INK_LOOK_COLORS.paper,
        shade: INK_LOOK_COLORS.shade,
        // The far side fades toward the plate (transparent output too).
        plate: inkPlateColor(state.backgroundPreset),
        depthCue: INK_LOOK_TUNING.depthCue,
      };
    }
    // The look's screen-space contour (creases, steps, the outer contour),
    // which the capture inks over the assembled image. A contour-less ink
    // spec is the drawing before it, so the two never share a specId.
    if (view.ink && look.inkContour) {
      (view.ink as Record<string, RenderJsonValueV1>).contour = captureInkContourToSpec(look.inkContour);
    }
  }

  layers.atoms = true;
  const sharedAtomState = {
    scale: state.atomScale,
    hiddenTypes: [...state.hiddenAtomTypes].sort((a, b) => a - b),
    typeScales: sortedNumericRecord(state.atomTypeScales),
    colorSource: state.atomColorSource,
    colorMode: state.colorMode,
    colorProperty: state.colorProperty,
    colormap: state.colormap,
    uniformColor: state.uniformAtomColor,
    elementColorOverrides: sortedNumericRecord(state.elementColorOverrides),
    materialPreset: state.materialPreset,
    roughness: state.surfaceRoughness,
    polish: state.surfacePolish,
    propertyRange: [...state.propRange],
  };
  view.atoms = raster
    ? {
      ...sharedAtomState,
      propertyEmissionStrength: state.propertyEmissionStrength,
      materialIntensity: state.materialIntensity,
      texture: state.atomTexture,
      clearcoat: state.surfaceClearcoat,
    }
    : {
      ...sharedAtomState,
      geometryPolicy: options.format === 'usdz' ? 'usdz-ar-framed-v1' : 'glb-world-space-v1',
    };

  if (raster && alpha === 'opaque') {
    layers.background = true;
    view.background = await canonicalBackgroundState(state, options.fetchAssetBytes);
  }

  if (raster && state.vectorField) {
    layers.vectorGlyphs = true;
    view.vectorGlyphs = {
      field: state.vectorField,
      scale: state.vectorScale,
      density: state.vectorDensity,
      colormap: state.colormap,
    };
  }

  if (raster && mayRenderAtomClusters(state, frame.natoms)) {
    throw new Error('Move the camera closer before export; visible far-LOD clusters are not yet snapshot-addressable.');
  }

  if (state.showBonds) {
    if (raster) {
      throw new Error('Hide bonds before deterministic raster export; the live asynchronous bond result is not snapshot-addressable yet.');
    }
    layers.bonds = true;
    // Which graph the export draws: source pairs, or the recipe Lupi infers with.
    const recipe = resolveFrameRecipe(frame, {
      profile: state.bondProfile,
      frameCount: file.trajectory.totalFrames ?? file.trajectory.frames.length,
    });
    const provenance: RenderJsonObjectV1 = recipe === 'source' || recipe === null
      ? { topology: 'source-frame-v1' }
      : recipe === MOLECULAR_RECIPE_ID
        ? { topology: 'molecular-inference-v1', recipe, contacts: state.showBondContacts }
        : { topology: 'covalent-inference-v1', recipe };
    view.bonds = {
      ...provenance,
      tolerance: state.bondTolerance,
      atomColorSource: state.atomColorSource,
      atomColorMode: state.colorMode,
      colorProperty: state.colorProperty,
      colormap: state.colormap,
      uniformColor: state.uniformAtomColor,
      elementColorOverrides: sortedNumericRecord(state.elementColorOverrides),
      materialPreset: state.materialPreset,
      roughness: state.surfaceRoughness,
      polish: state.surfacePolish,
      execution: 'cpu-export-v1',
    };
  }

  if (raster && state.showCell) layers.simulationCell = true;

  const shellVisible = raster && state.filterShellShape !== 'off' && state.filterShellOpacity > 0;
  if (shellVisible) {
    layers.filterShell = true;
    view.filterShell = {
      shape: state.filterShellShape,
      preset: state.filterShellPreset,
      opacity: state.filterShellOpacity,
      radiusScale: state.filterShellRadius,
    };
    layers.moleculeShadow = true;
    view.moleculeShadow = {
      opacity: 0.5,
      keyAzimuth: state.keyLightAzimuth,
      keyElevation: state.keyLightElevation,
    };
  } else if (raster && state.postprocessPreset !== 'diagram' && specimenShadowEnabled(frame.natoms)) {
    // The Specimen floor shadow, exactly as the viewer draws it
    // (specimenShadow.ts); its lean follows `view.lighting`.
    layers.contactShadows = true;
    view.contactShadows = {
      blur: SPECIMEN_SHADOW.blur,
      opacity: specimenShadowOpacity(state.postprocessPreset),
      resolution: specimenShadowResolution(frame.natoms),
      color: SPECIMEN_SHADOW.color,
    };
  }

  const selected = [...state.selectedAtoms].sort((a, b) => a - b);
  const neighbors = [...state.highlightedNeighbors].sort((a, b) => a - b);
  if (raster && (selected.length > 0 || state.hoveredAtom !== null || neighbors.length > 0 || state.measurement !== null)) {
    throw new Error('Clear coordinate measurements, selection, hover, and neighbor markers before deterministic export.');
  }

  if (raster && state.showAxes) {
    layers.axes = true;
    view.axes = {
      kind: 'canvas-overlay-v1',
      alignment: 'bottom-left',
      radiusPolicy: '11pct-clamped-18-42',
      axisColors: ['#ff4060', '#40ff80', '#4080ff'],
      labelColor: 'white',
    };
  }

  const dimensions = raster
    ? { width: requireRasterDimension(options.width, 'width'), height: requireRasterDimension(options.height, 'height') }
    : {};
  const spec: RenderArtifactSpecV1 = {
    version: RENDER_ARTIFACT_SPEC_VERSION_V1,
    source: {
      kind: 'content' as const,
      mediaType: DECODED_RENDER_FRAME_MEDIA_TYPE_V3,
      contentDigest,
    },
    format: options.format,
    ...dimensions,
    alpha,
    frame: state.frame,
    layers,
    view,
  };

  const request = validateRenderRequestV1({
    version: RENDER_REQUEST_VERSION_V1,
    spec,
    delivery: options.delivery,
  });
  assertRenderCapabilitySupportsSpecV1(BROWSER_RENDER_CAPABILITY_V1, spec);
  const specId = await computeRenderSpecIdV1(spec);
  const buildIdentity = resolveBrowserBuildIdentityV1({
    production: import.meta.env.PROD,
    injectedSha: import.meta.env.VITE_LUPI_BUILD_SHA,
    adapterSha: options.buildSha,
  });
  const rendererRuntime = requireRendererRuntimeV2(options.rendererRuntime);
  const rendererFingerprint = await computeRendererFingerprintV1({
    version: RENDERER_FINGERPRINT_VERSION_V1,
    renderer: BROWSER_RENDERER_ID_V2,
    rendererVersion: rendererVersionV2(LUPI_VIEWER_MCP_VERSION, rendererRuntime.three),
    buildId: buildIdentity.buildId,
    executionClass: executionClassV2(rendererRuntime.backend),
    runtime: browserRendererRuntimeV2(rendererRuntime),
    determinism: {
      ...DETERMINISM_V2,
      modelEncoder: MODEL_ENCODER_V2,
      buildIdentity: {
        durability: buildIdentity.durability,
        source: buildIdentity.source,
        gitSha: buildIdentity.gitSha,
      },
    },
    capability: BROWSER_RENDER_CAPABILITY_V1,
  });
  const artifactKey = await computeRenderArtifactKeyV1({ specId, rendererFingerprint });
  return { request, spec, specId, rendererFingerprint, artifactKey, buildIdentity };
}

export function createInlineBrowserDeliveryV1(
  maxInlineBytes: number,
  filename?: string,
): RenderDeliveryV1 {
  return {
    version: RENDER_DELIVERY_VERSION_V1,
    inline: true,
    maxInlineBytes,
    sync: true,
    ...(filename ? { filename } : {}),
  };
}

async function canonicalBackgroundState(
  state: AppState,
  fetchAssetBytes = defaultFetchAssetBytes,
): Promise<RenderJsonObjectV1> {
  const preset = BG_PRESETS[state.backgroundPreset];
  if (!preset) throw new Error(`Unknown background preset ${state.backgroundPreset}.`);
  if (preset.procedural) {
    throw new Error('Animated procedural backgrounds must be replaced with a static background before deterministic export.');
  }
  const media = getBgMedia(preset);
  if (media.kind === 'video') {
    throw new Error('Pause-to-phase video backgrounds are not supported by the browser artifact contract.');
  }
  if (media.kind !== 'gradient') {
    throw new Error(
      'Image backgrounds are not supported by the V2 browser artifact profile until capture can apply immutable image bytes directly; '
      + 'use a gradient background preset or request transparent output.',
    );
  }
  const mediaState: RenderJsonObjectV1 = { kind: media.kind, projection: media.projection };
  const usesBackdropMesh = state.backgroundBackdropShape !== 'dome'
    || state.backgroundBackdropPattern !== 'image';
  if (usesBackdropMesh) {
    throw new Error(
      'Backdrop-mesh backgrounds are not supported by the V2 browser artifact profile; use the default dome/image gradient projection.',
    );
  }
  // The viewer draws an adjusted gradient through the live backdrop mesh
  // (AppBackground), which the capture cannot apply from the spec. Failing
  // keeps the export identical to what the viewer shows (owner override O5).
  const adjusted = state.backgroundOpacity !== 1
    || state.backgroundBrightness !== 1
    || state.backgroundSaturation !== 1
    || state.backgroundContrast !== 1
    || state.backgroundYawDegrees !== 0
    || state.backgroundPitchDegrees !== 0;
  if (adjusted) {
    throw new Error(
      'Adjusted backgrounds (opacity, brightness, saturation, contrast, yaw or pitch) are not supported by the V2 browser artifact profile; '
      + 'reset the background adjustments or request transparent output.',
    );
  }
  const canonicalState: RenderJsonObjectV1 = {
    top: preset.top,
    bottom: preset.bottom,
    media: mediaState,
    style: state.backgroundStyle,
    projectionMode: usesBackdropMesh ? 'backdrop-mesh' : 'scene-background',
    ...(usesBackdropMesh ? {
      opacity: state.backgroundOpacity,
      brightness: state.backgroundBrightness,
      saturation: state.backgroundSaturation,
      contrast: state.backgroundContrast,
      yawDegrees: state.backgroundYawDegrees,
      pitchDegrees: state.backgroundPitchDegrees,
      backdropShape: state.backgroundBackdropShape,
      backdropPattern: state.backgroundBackdropPattern,
      ...(state.backgroundBackdropShape === 'dome'
        ? { backdropRadius: 5000 }
        : { backdropRadius: state.backgroundBackdropRadius }),
    } : {}),
  };
  void fetchAssetBytes;
  const dataDigest = await digestCanonicalState(canonicalState);
  return { ...canonicalState, dataDigest };
}

function normalizeBuildSha(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!FULL_GIT_SHA_PATTERN.test(normalized)) {
    throw new Error(`${field} must be an exact 40-hex Git SHA.`);
  }
  return normalized;
}

export interface CanonicalArtifactCameraPlanesV1 {
  readonly near: number;
  readonly far: number;
}

/**
 * Reproduce the viewer's projection policy from current source bounds, but
 * return exact planes instead of inheriting CameraManager's historical far
 * value. Both values are part of the artifact spec because they affect depth
 * precision and therefore visible occlusion.
 */
export function canonicalArtifactCameraPlanesV1(
  state: Pick<AppState, 'file' | 'cameraPosition'>,
): CanonicalArtifactCameraPlanesV1 {
  const bounds = state.file?.trajectory.globalBounds;
  if (!bounds) throw new Error('Artifact camera planes require decoded trajectory bounds.');
  const values = [...bounds.min, ...bounds.max, ...state.cameraPosition];
  if (!values.every(Number.isFinite)) {
    throw new Error('Artifact camera planes require finite trajectory bounds and camera position.');
  }

  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  if (dx < 0 || dy < 0 || dz < 0) {
    throw new Error('Artifact camera planes require ordered trajectory bounds.');
  }
  const sceneDistance = Math.hypot(dx, dy, dz) * 1.4;
  const center: readonly [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) * 0.5,
    (bounds.min[1] + bounds.max[1]) * 0.5,
    (bounds.min[2] + bounds.max[2]) * 0.5,
  ];
  const cameraDistance = Math.hypot(
    state.cameraPosition[0] - center[0],
    state.cameraPosition[1] - center[1],
    state.cameraPosition[2] - center[2],
  );
  return {
    near: Math.max(0.01, Math.min(0.1, sceneDistance * 0.002)),
    far: Math.max(10_000, sceneDistance * 100, cameraDistance * 20),
  };
}

/**
 * The renderer record the fingerprint needs. The backend is part of the
 * execution class, so an export before the viewer canvas has created its
 * renderer cannot be identified.
 */
function requireRendererRuntimeV2(provided?: LupiRendererRuntime): LupiRendererRuntime {
  const runtime = provided ?? getLupiRendererRuntime();
  if (!runtime) {
    throw new Error(
      'The viewer renderer has not started; its backend (WebGPU or the WebGL2 fallback) is part of the artifact identity.',
    );
  }
  return runtime;
}

/**
 * Runtime facts which can change bytes within an execution class: the GPU
 * (the WebGPU adapter, or the WebGL2 context's renderer strings), the WebGPU
 * compatibility mode, the canvas sample count, the browser, and the
 * transmission quality the viewer mounted. The swizzle-compat retry and the
 * raised buffer limits do not change bytes and are left out.
 */
export function browserRendererRuntimeV2(renderer: LupiRendererRuntime): RenderJsonObjectV1 {
  const runtime: Record<string, RenderJsonValueV1> = {
    backend: renderer.backend,
    threeRevision: renderer.three,
    // Build identity already addresses the source tree. A semantic module id
    // stays stable across Vite ports, hostnames, and local checkout paths.
    moduleId: BROWSER_RENDERER_MODULE_ID_V1,
    browserUserAgent: typeof navigator === 'undefined' ? 'unavailable' : navigator.userAgent,
    platform: typeof navigator === 'undefined' ? 'unavailable' : navigator.platform,
    samples: renderer.samples,
    // The transmission renderer's tier-derived samples/resolution change
    // raster bytes; the mounted viewer reports the effective values so two
    // executions on different tiers never share an artifact key.
    transmission: activeTransmissionQualityV1(),
  };
  if (renderer.backend === 'webgpu') {
    runtime.webgpu = {
      adapter: renderer.adapterInfo ? { ...renderer.adapterInfo } : 'unavailable',
      preferredCanvasFormat: renderer.preferredCanvasFormat ?? 'unavailable',
      compatibilityMode: renderer.compatibilityMode,
    };
    return runtime;
  }
  runtime.webgl2 = probeWebGL2Context(renderer.backend);
  return runtime;
}

/**
 * On the WebGL2 backend the viewer canvas already holds a WebGL2 context, so
 * `getContext('webgl2')` returns that same context and changes nothing. R3F
 * puts the viewer id on a wrapper; the canvas is its descendant.
 */
function probeWebGL2Context(backend: LupiBackend): RenderJsonObjectV1 {
  if (backend !== 'webgl2' || typeof document === 'undefined') return { status: 'unavailable' };
  const canvas = document.querySelector<HTMLCanvasElement>('#lupi-viewer-canvas canvas');
  if (!canvas) return { status: 'canvas-unavailable' };
  try {
    const gl = canvas.getContext('webgl2');
    if (!gl) return { status: 'context-unavailable' };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      status: 'ready',
      version: String(gl.getParameter(gl.VERSION)),
      shadingLanguageVersion: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
      vendor: String(gl.getParameter(gl.VENDOR)),
      renderer: String(gl.getParameter(gl.RENDERER)),
      unmaskedVendor: debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : 'unavailable',
      unmaskedRenderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unavailable',
    };
  } catch (error) {
    return { status: 'probe-failed', error: error instanceof Error ? error.name : 'unknown' };
  }
}

async function digestCanonicalState(value: unknown): Promise<Sha256DigestV1> {
  return computeRenderArtifactDigestV1(new TextEncoder().encode(canonicalizeRenderValueV1(value)));
}

async function defaultFetchAssetBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not content-address background asset ${url} (${response.status}).`);
  return response.arrayBuffer();
}

function sortedNumericRecord(
  record: Record<number, string | number>,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function requireRasterDimension(value: number | undefined, field: string): number {
  if (!Number.isSafeInteger(value) || value! < 64 || value! > 4096) {
    throw new Error(`${field} must be an integer from 64 through 4096.`);
  }
  return value!;
}

function mayRenderAtomClusters(state: AppState, atomCount: number): boolean {
  if (atomCount < 50_000) return false;
  const { min, max } = state.file!.trajectory.globalBounds;
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const cameraDistance = Math.hypot(
    state.cameraPosition[0] - state.cameraTarget[0],
    state.cameraPosition[1] - state.cameraTarget[1],
    state.cameraPosition[2] - state.cameraTarget[2],
  );
  const qualityTier = getDefaultQualityTier();
  return qualityTier >= 0 && cameraDistance >= diagonal * 3;
}
