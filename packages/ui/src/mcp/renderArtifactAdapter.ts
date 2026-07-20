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
import { getBgMedia, BG_PRESETS } from '../backgroundPresets';
import { getDefaultQualityTier } from '../deviceCapabilities';
import { environmentAssetIdentity } from '../sceneEnvironment';
import { REVISION as THREE_REVISION } from 'three';
import type { AppState } from '../store';
import {
  DECODED_RENDER_FRAME_MEDIA_TYPE_V1,
  computeDecodedRenderFrameDigestV1,
} from '../renderArtifactSource';
import { LUPI_VIEWER_MCP_VERSION } from './protocol';

export const BROWSER_RENDERER_VERSION_V1 = 'lupi-browser-webgl.v1';
export const BROWSER_RENDERER_MODULE_ID_V1 = '@atlas/ui/mcp/renderArtifactAdapter';

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
  /** Test/embedded runtimes may provide a previously probed execution class. */
  rendererRuntime?: RenderJsonObjectV1;
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
 * Snapshot the exact browser-framebuffer semantics supported by V1.
 * DOM-only overlays are intentionally absent. Active layers which cannot yet
 * be represented deterministically fail instead of receiving a false identity.
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
  if (state.arLightEstimationActive) {
    throw new Error('Live AR light estimation cannot be assigned a deterministic browser artifact identity.');
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
  const contentDigest = await computeDecodedRenderFrameDigestV1(frame);
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
    // ExportManager renders the raw scene directly. The interactive
    // EffectComposer is intentionally bypassed, so these are fixed applied
    // export semantics rather than the current UI postprocess controls.
    view.postprocess = {
      pipeline: 'raw-scene',
      toneMapping: 'none',
      multisampling: 0,
      outputColorSpace: 'srgb',
    };
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
    view.bonds = {
      topology: frame.bonds.length > 0 ? 'source-frame-v1' : 'covalent-inference-v1',
      sourceBondCount: frame.bonds.length / 2,
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
  } else if (raster && state.postprocessPreset !== 'diagram') {
    layers.contactShadows = true;
    view.contactShadows = {
      blur: 2.4,
      opacity: state.postprocessPreset === 'cinematic' ? 0.55 : 0.32,
      resolution: 1024,
      color: '#04060c',
    };
  }

  const selected = [...state.selectedAtoms].sort((a, b) => a - b);
  const neighbors = [...state.highlightedNeighbors].sort((a, b) => a - b);
  if (raster && (selected.length > 0 || state.hoveredAtom !== null || neighbors.length > 0)) {
    throw new Error('Clear animated selection, hover, and neighbor markers before deterministic export.');
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
      mediaType: DECODED_RENDER_FRAME_MEDIA_TYPE_V1,
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
  const rendererFingerprint = await computeRendererFingerprintV1({
    version: RENDERER_FINGERPRINT_VERSION_V1,
    renderer: BROWSER_RENDERER_VERSION_V1,
    rendererVersion: `three-r${THREE_REVISION};bridge-${LUPI_VIEWER_MCP_VERSION}`,
    buildId: buildIdentity.buildId,
    executionClass: 'browser-webgl-main-thread',
    runtime: options.rendererRuntime ?? browserRendererRuntimeV1(),
    determinism: {
      pixelRatio: 1,
      alphaContext: true,
      preserveDrawingBuffer: true,
      outputColorSpace: 'srgb',
      rendererToneMapping: 'none',
      postprocessPipeline: 'raw-scene-bypassed',
      rasterEncoder: 'browser-canvas-native',
      modelEncoder: `three-exporters-r${THREE_REVISION}`,
      axesOverlay: 'canvas-overlay-v1',
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
    throw new Error('Pause-to-phase video backgrounds are not supported by the V1 artifact contract.');
  }
  if (media.kind !== 'gradient') {
    throw new Error(
      'Image backgrounds are not supported by the V1 browser artifact profile until capture can apply immutable image bytes directly.',
    );
  }
  const mediaState: RenderJsonObjectV1 = { kind: media.kind, projection: media.projection };
  const usesBackdropMesh = state.backgroundBackdropShape !== 'dome'
    || state.backgroundBackdropPattern !== 'image';
  if (usesBackdropMesh) {
    throw new Error(
      'Backdrop-mesh backgrounds are not supported by the V1 browser artifact profile; use the default dome/image gradient projection.',
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

export function browserRendererRuntimeV1(): RenderJsonObjectV1 {
  const runtime: Record<string, RenderJsonValueV1> = {
    threeRevision: THREE_REVISION,
    // Build identity already addresses the source tree. A semantic module id
    // stays stable across Vite ports, hostnames, and local checkout paths.
    moduleId: BROWSER_RENDERER_MODULE_ID_V1,
    browserUserAgent: typeof navigator === 'undefined' ? 'unavailable' : navigator.userAgent,
    platform: typeof navigator === 'undefined' ? 'unavailable' : navigator.platform,
  };
  if (typeof document === 'undefined') return runtime;

  // R3F applies Canvas DOM props to its wrapper; the actual WebGL canvas is a
  // descendant. Probe the context Three owns, never the wrapper element.
  const canvas = document.querySelector<HTMLCanvasElement>('#lupi-viewer-canvas canvas');
  if (!canvas) return { ...runtime, webgl: { status: 'canvas-unavailable' } };
  try {
    const gl = canvas.getContext('webgl2');
    if (!gl) return { ...runtime, webgl: { status: 'webgl2-unavailable' } };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const attributes = gl.getContextAttributes();
    runtime.webgl = {
      status: 'ready',
      version: String(gl.getParameter(gl.VERSION)),
      shadingLanguageVersion: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
      vendor: String(gl.getParameter(gl.VENDOR)),
      renderer: String(gl.getParameter(gl.RENDERER)),
      unmaskedVendor: debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : 'unavailable',
      unmaskedRenderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unavailable',
      alpha: attributes?.alpha ?? null,
      antialias: attributes?.antialias ?? null,
      premultipliedAlpha: attributes?.premultipliedAlpha ?? null,
      preserveDrawingBuffer: attributes?.preserveDrawingBuffer ?? null,
    };
  } catch (error) {
    runtime.webgl = {
      status: 'probe-failed',
      error: error instanceof Error ? error.name : 'unknown',
    };
  }
  return runtime;
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
