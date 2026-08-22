/**
 * MCP tool registry for AI control of the Lupi viewer.
 *
 * These tools complement the original browser bridge tools in
 * `mcpViewerBridge.tsx` with fine-grained control over playback, camera,
 * visuals, and state serialization.
 */

import { useStore, type BackgroundBackdropShape, type BackgroundBackdropPattern, type ExportRequest } from '../store';
import {
  assessAsset,
  byteSourceFromUrl,
  envelopeSource,
  trajectorySource,
  type AssessmentContext,
  type AssetEnvelope,
  type AssessmentSource,
} from '@atlas/assessment';
import type { LupiMcpRequest, LupiMcpResponseResult, LupiMcpToolDefinition } from './types';
import { MCP_TOOL_DEFINITIONS } from './toolManifest';
import { LUPI_VIEWER_MCP_VERSION } from './protocol';
import { assertBrowserImageExportIntent } from '../export/renderCaptureState';
import { validateArtifactBytesV1 } from '../export/artifactByteValidation';
import { computeRenderArtifactDigestV1 } from '@atlas/core';
import {
  createBrowserRenderArtifactPlanV1,
  createInlineBrowserDeliveryV1,
} from './renderArtifactAdapter';

/* ─── Helpers ─── */

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Private-network assessment URLs are a local-preview convenience only. */
export function isLocalAssessmentOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function readTuple3(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const nums = value.map((v) => (typeof v === 'string' ? Number(v) : v));
  if (nums.every((n) => typeof n === 'number' && !Number.isNaN(n))) {
    return nums as [number, number, number];
  }
  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max));
}

type ExportAssetFormat = 'png' | 'jpeg' | 'webp' | 'glb';

const DEFAULT_IMAGE_SIZE = 1024;
const MAX_IMAGE_SIZE = 4096;
const DEFAULT_INLINE_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_INLINE_ASSET_BYTES = 128 * 1024 * 1024;

function readBoundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`lupi.export_asset ${field} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function readExportAssetFormat(value: unknown): ExportAssetFormat | undefined {
  const raw = readString(value)?.toLowerCase();
  if (!raw) return undefined;
  if (raw === 'jpg') return 'jpeg';
  return raw === 'png' || raw === 'jpeg' || raw === 'webp' || raw === 'glb'
    ? raw
    : undefined;
}

function extensionForExportAsset(format: ExportAssetFormat) {
  return format === 'jpeg' ? 'jpg' : format;
}

function safeBaseName(value: string) {
  return value
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'lupi-asset';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

interface StoreExportResult {
  blob: Blob;
  filename: string;
  progress: Array<{ phase: string; done: number; total: number }>;
}

export function runStoreExport(request: Partial<ExportRequest>, timeoutMs: number): Promise<StoreExportResult> {
  const state = useStore.getState();
  if (state.exportRequest?.type) {
    throw new Error('An export is already in progress. Wait for it to finish before calling lupi.export_asset again.');
  }

  const progress: StoreExportResult['progress'] = [];
  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    let ownedRequest: ExportRequest | null = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Before the mounted exporter starts, this request is safe to remove
      // (for example when the viewer route is absent). Once encoding starts,
      // GLTFExporter/USDZExporter/toBlob have no reliable abort primitive: keep
      // the exact request as the store lock until that owner completes cleanup.
      // Never clear a newer request that happened to replace this one.
      const currentState = useStore.getState();
      if (!started && currentState.exportRequest === ownedRequest) {
        currentState.clearExportRequest();
      }
      reject(new Error(`Timed out waiting for viewer export after ${timeoutMs} ms. Ensure the 3D viewer route is mounted.`));
    }, timeoutMs);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    state.triggerExport({
      ...request,
      onStart: () => {
        started = true;
      },
      onProgress: (phase, done, total) => {
        progress.push({ phase, done, total });
      },
      onComplete: (success, blob, filename, failure) => {
        finish(() => {
          if (!success || !blob || !filename) {
            reject(new Error(
              failure
                ? `${failure.code}: ${failure.message}`
                : 'Viewer export failed before producing an asset blob.',
            ));
            return;
          }
          resolve({ blob, filename, progress });
        });
      },
    });
    ownedRequest = useStore.getState().exportRequest;
  });
}

/* ─── Tool handlers ─── */

async function handleSetFrame(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const frame = readNumber(request.arguments.frame);
  if (frame === undefined) throw new Error('lupi.set_frame requires a numeric "frame" argument.');
  const state = useStore.getState();
  if (!state.file) throw new Error('No molecule is loaded.');
  const totalFrames = state.file.trajectory.totalFrames;
  const safeFrame = Math.max(0, Math.min(Math.floor(frame), Math.max(0, totalFrames - 1)));
  state.setFrame(safeFrame);
  return { frame: safeFrame };
}

async function handlePlay(): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  if (!state.file) throw new Error('No molecule is loaded.');
  if (!state.playing) state.togglePlay();
  return { playing: true };
}

async function handlePause(): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  if (state.playing) state.togglePlay();
  return { playing: false };
}

async function handleSetPlaybackSpeed(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const speed = readNumber(request.arguments.speed);
  if (speed === undefined) throw new Error('lupi.set_playback_speed requires a numeric "speed" argument.');
  const safeSpeed = clamp(speed, 0.0625, 16);
  useStore.getState().setPlaybackSpeed(safeSpeed);
  return { playbackSpeed: safeSpeed };
}

async function handleSetCameraPreset(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const preset = readString(request.arguments.preset ?? request.arguments.camera);
  if (!preset) throw new Error('lupi.set_camera_preset requires a "preset" argument.');
  const state = useStore.getState();
  if (!state.file) throw new Error('No molecule is loaded.');
  state.setCameraPreset(preset as Parameters<typeof state.setCameraPreset>[0]);
  return { cameraPreset: preset };
}

async function handleSetCamera(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const position = readTuple3(request.arguments.position);
  const target = readTuple3(request.arguments.target);
  const fov = readNumber(request.arguments.fov);
  const state = useStore.getState();
  if (!state.file) throw new Error('No molecule is loaded.');
  if (position && target) {
    state.setCameraState(position, target);
  } else if (position || target || fov !== undefined) {
    throw new Error('lupi.set_camera requires both "position" and "target" tuples, or "fov" alongside a complete camera spec.');
  }
  if (fov !== undefined) {
    useStore.setState({ cameraFov: clamp(fov, 5, 120) });
  }
  return { cameraPosition: state.cameraPosition, cameraTarget: state.cameraTarget, cameraFov: state.cameraFov };
}

async function handleFitCamera(): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  if (!state.file) throw new Error('No molecule is loaded.');
  state.fitCameraView();
  const fittedState = useStore.getState();
  return {
    cameraPosition: fittedState.cameraPosition,
    cameraTarget: fittedState.cameraTarget,
  };
}

async function handleSetBackground(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  const args = request.arguments;
  const patch: Record<string, unknown> = {};

  const preset = readString(args.preset ?? args.backgroundPreset);
  if (preset !== undefined) state.setBackgroundPreset(preset);
  const style = readString(args.style ?? args.backgroundStyle);
  if (style !== undefined) state.setBackgroundStyle(style as Parameters<typeof state.setBackgroundStyle>[0]);
  const motionPaused = readBoolean(args.motionPaused ?? args.backgroundMotionPaused);
  if (motionPaused !== undefined) state.setBackgroundMotionPaused(motionPaused);
  const motionSpeed = readNumber(args.motionSpeed ?? args.backgroundMotionSpeed);
  if (motionSpeed !== undefined) state.setBackgroundMotionSpeed(clamp(motionSpeed, 0, 4));
  const opacity = readNumber(args.opacity ?? args.backgroundOpacity);
  if (opacity !== undefined) state.setBackgroundOpacity(clamp(opacity, 0, 1));
  const brightness = readNumber(args.brightness ?? args.backgroundBrightness);
  if (brightness !== undefined) state.setBackgroundBrightness(clamp(brightness, 0, 2));
  const saturation = readNumber(args.saturation ?? args.backgroundSaturation);
  if (saturation !== undefined) state.setBackgroundSaturation(clamp(saturation, 0, 2));
  const contrast = readNumber(args.contrast ?? args.backgroundContrast);
  if (contrast !== undefined) state.setBackgroundContrast(clamp(contrast, 0, 2));
  const yaw = readNumber(args.yaw ?? args.yawDegrees ?? args.backgroundYawDegrees);
  if (yaw !== undefined) state.setBackgroundYawDegrees(yaw);
  const pitch = readNumber(args.pitch ?? args.pitchDegrees ?? args.backgroundPitchDegrees);
  if (pitch !== undefined) state.setBackgroundPitchDegrees(pitch);
  const shape = readString(args.shape ?? args.backdropShape ?? args.backgroundBackdropShape) as BackgroundBackdropShape | undefined;
  if (shape !== undefined) state.setBackgroundBackdropShape(shape);
  const pattern = readString(args.pattern ?? args.backdropPattern ?? args.backgroundBackdropPattern) as BackgroundBackdropPattern | undefined;
  if (pattern !== undefined) state.setBackgroundBackdropPattern(pattern);
  const radius = readNumber(args.radius ?? args.backdropRadius ?? args.backgroundBackdropRadius);
  if (radius !== undefined) state.setBackgroundBackdropRadius(clamp(radius, 0.25, 5));

  return { backgroundPreset: state.backgroundPreset, ...patch };
}

async function handleSetPostprocess(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  const preset = readString(request.arguments.preset ?? request.arguments.postprocessPreset);
  const intensity = readNumber(request.arguments.intensity ?? request.arguments.postprocessIntensity);
  if (preset !== undefined) state.setPostprocessPreset(preset as Parameters<typeof state.setPostprocessPreset>[0]);
  if (intensity !== undefined) state.setPostprocessIntensity(clamp(intensity, 0, 1));
  return { postprocessPreset: state.postprocessPreset, postprocessIntensity: state.postprocessIntensity };
}

async function handleSetMaterial(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  const preset = readString(request.arguments.preset ?? request.arguments.materialPreset);
  const scene = readString(request.arguments.scene ?? request.arguments.materialScene);
  const intensity = readNumber(request.arguments.intensity ?? request.arguments.materialIntensity);
  const texture = readString(request.arguments.texture ?? request.arguments.atomTexture);

  if (scene !== undefined) state.applyMaterialScene(scene);
  if (preset !== undefined) state.setMaterialPreset(preset as Parameters<typeof state.setMaterialPreset>[0]);
  if (intensity !== undefined) state.setMaterialIntensity(clamp(intensity, 0, 2));
  if (texture !== undefined) state.setAtomTexture(texture as Parameters<typeof state.setAtomTexture>[0]);

  return {
    materialPreset: state.materialPreset,
    materialScene: state.materialScene,
    materialIntensity: state.materialIntensity,
    atomTexture: state.atomTexture,
  };
}

async function handleSetLighting(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  const args = request.arguments;

  const ambient = readNumber(args.ambient ?? args.ambientLightIntensity);
  if (ambient !== undefined) state.setAmbientLightIntensity(clamp(ambient, 0, 2));
  const dir = readNumber(args.dir ?? args.dirLightIntensity);
  if (dir !== undefined) state.setDirLightIntensity(clamp(dir, 0, 2));
  const rim = readNumber(args.rim ?? args.rimLightIntensity);
  if (rim !== undefined) state.setRimLightIntensity(clamp(rim, 0, 2));

  const keyAz = readNumber(args.keyAzimuth ?? args.keyLightAzimuth);
  if (keyAz !== undefined) state.setKeyLightAzimuth(keyAz);
  const keyEl = readNumber(args.keyElevation ?? args.keyLightElevation);
  if (keyEl !== undefined) state.setKeyLightElevation(keyEl);
  const fillAz = readNumber(args.fillAzimuth ?? args.fillLightAzimuth);
  if (fillAz !== undefined) state.setFillLightAzimuth(fillAz);
  const fillEl = readNumber(args.fillElevation ?? args.fillLightElevation);
  if (fillEl !== undefined) state.setFillLightElevation(fillEl);
  const rimAz = readNumber(args.rimAzimuth ?? args.rimLightAzimuth);
  if (rimAz !== undefined) state.setRimLightAzimuth(rimAz);
  const rimEl = readNumber(args.rimElevation ?? args.rimLightElevation);
  if (rimEl !== undefined) state.setRimLightElevation(rimEl);

  const fillColor = readString(args.fillColor ?? args.fillLightColor);
  if (fillColor !== undefined) state.setFillLightColor(fillColor);
  const rimColor = readString(args.rimColor ?? args.rimLightColor);
  if (rimColor !== undefined) state.setRimLightColor(rimColor);

  return {
    ambientLightIntensity: state.ambientLightIntensity,
    dirLightIntensity: state.dirLightIntensity,
    rimLightIntensity: state.rimLightIntensity,
  };
}

async function handleSetFilterShell(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  const args = request.arguments;
  const shape = readString(args.shape ?? args.filterShellShape);
  if (shape !== undefined) state.setFilterShellShape(shape as 'off' | 'sphere' | 'cube');
  const preset = readString(args.preset ?? args.filterShellPreset);
  if (preset !== undefined) state.setFilterShellPreset(preset as 'haze' | 'cryo' | 'prism' | 'graphite');
  const opacity = readNumber(args.opacity ?? args.filterShellOpacity);
  if (opacity !== undefined) state.setFilterShellOpacity(clamp(opacity, 0, 1));
  const radius = readNumber(args.radius ?? args.filterShellRadius);
  if (radius !== undefined) state.setFilterShellRadius(clamp(radius, 0.1, 4));
  return {
    filterShellShape: state.filterShellShape,
    filterShellPreset: state.filterShellPreset,
    filterShellOpacity: state.filterShellOpacity,
    filterShellRadius: state.filterShellRadius,
  };
}

async function handleSetVectorField(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  const fieldId = readString(request.arguments.fieldId ?? request.arguments.vectorField);
  const scale = readNumber(request.arguments.scale ?? request.arguments.vectorScale);
  const density = readNumber(request.arguments.density ?? request.arguments.vectorDensity);
  if (fieldId !== undefined) state.setVectorField(fieldId);
  if (scale !== undefined) state.setVectorScale(clamp(scale, 0.01, 10));
  if (density !== undefined) state.setVectorDensity(clamp(density, 0.01, 1));
  return { vectorField: state.vectorField, vectorScale: state.vectorScale, vectorDensity: state.vectorDensity };
}

async function handleSetAtomVisibility(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  const hiddenTypes = request.arguments.hiddenAtomTypes;
  if (Array.isArray(hiddenTypes)) {
    state.showAllAtomTypes();
    for (const t of hiddenTypes) {
      const n = typeof t === 'string' ? Number(t) : t;
      if (typeof n === 'number' && Number.isFinite(n)) state.toggleAtomType(n);
    }
  }
  const scales = request.arguments.atomTypeScales;
  if (scales && typeof scales === 'object' && !Array.isArray(scales)) {
    for (const [key, value] of Object.entries(scales)) {
      const type = Number(key);
      const scale = typeof value === 'string' ? Number(value) : value;
      if (typeof scale === 'number' && Number.isFinite(scale)) {
        state.setAtomTypeScale(type, clamp(scale, 0.1, 5));
      }
    }
  }
  return { hiddenAtomTypes: Array.from(state.hiddenAtomTypes), atomTypeScales: state.atomTypeScales };
}

async function handleAddAnnotation(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const atomIndex = readNumber(request.arguments.atomIndex);
  const text = readString(request.arguments.text);
  if (atomIndex === undefined || !text) {
    throw new Error('lupi.add_annotation requires numeric "atomIndex" and string "text" arguments.');
  }
  const state = useStore.getState();
  if (!state.file) throw new Error('No molecule is loaded.');
  state.addAnnotation(Math.floor(atomIndex), text);
  return { annotations: state.annotations };
}

async function handleRemoveAnnotation(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const id = readString(request.arguments.id);
  if (!id) throw new Error('lupi.remove_annotation requires an "id" argument.');
  const state = useStore.getState();
  state.removeAnnotation(id);
  return { annotations: state.annotations };
}

async function handleEncodeViewUrl(): Promise<LupiMcpResponseResult> {
  const token = useStore.getState().encodeToURL();
  return { url: `${window.location.origin}${window.location.pathname}?s=${token}` };
}

async function handleResetViewer(): Promise<LupiMcpResponseResult> {
  useStore.getState().reset();
  return { reset: true };
}

async function handleExportAsset(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  if (!state.file) throw new Error('No molecule is loaded. Call lupi.generate_molecule or lupi.load_molecule_url first.');

  const args = request.arguments;
  const rawFormat = args.format ?? args.type;
  const parsedFormat = readExportAssetFormat(rawFormat);
  if (rawFormat !== undefined && !parsedFormat) {
    throw new Error('lupi.export_asset format must be png, jpeg, jpg, webp, or glb. USDZ remains available only as a non-addressed interactive export.');
  }
  const format = parsedFormat ?? 'png';
  const image = format === 'png' || format === 'jpeg' || format === 'webp';
  if (!image) {
    const rasterOnlyField = ['resolution', 'width', 'height', 'transparent', 'fitCamera', 'atomScale']
      .find((field) => args[field] !== undefined);
    if (rasterOnlyField) {
      throw new Error(`lupi.export_asset ${format.toUpperCase()} does not accept raster field ${rasterOnlyField}.`);
    }
  }
  if (args.resolution !== undefined && (
    !args.resolution || typeof args.resolution !== 'object' || Array.isArray(args.resolution)
  )) {
    throw new Error('lupi.export_asset resolution must be an object.');
  }
  const resolution = (args.resolution ?? {}) as Record<string, unknown>;
  const width = readBoundedInteger(args.width ?? resolution.width, DEFAULT_IMAGE_SIZE, 64, MAX_IMAGE_SIZE, 'width');
  const height = readBoundedInteger(args.height ?? resolution.height, width, 64, MAX_IMAGE_SIZE, 'height');
  if (args.transparent !== undefined && typeof args.transparent !== 'boolean') {
    throw new Error('lupi.export_asset transparent must be a boolean.');
  }
  const transparent = args.transparent === true;
  if (image) {
    assertBrowserImageExportIntent(format as 'png' | 'jpeg' | 'webp', transparent);
  }
  if (args.baseName !== undefined && typeof args.baseName !== 'string') {
    throw new Error('lupi.export_asset baseName must be a string.');
  }
  const baseName = safeBaseName((args.baseName as string | undefined) ?? `Lupi-${format}-${state.file.name}`);
  const requestedTimeout = readNumber(args.timeoutMs)
    ?? (readNumber(args.timeoutSeconds) !== undefined ? readNumber(args.timeoutSeconds)! * 1000 : undefined);
  const timeoutMs = clampInt(requestedTimeout ?? (image ? 30_000 : 180_000), 1000, 600_000);
  const maxInlineBytes = readBoundedInteger(
    args.maxInlineBytes ?? args.maxBytes,
    DEFAULT_INLINE_ASSET_BYTES,
    1024,
    MAX_INLINE_ASSET_BYTES,
    'maxInlineBytes',
  );

  let exportRequest: Partial<ExportRequest> = image
    ? {
      type: 'image',
      format: format as 'png' | 'jpeg' | 'webp',
      resolution: { width, height },
      transparent,
      baseName,
    }
    : {
      type: 'glb',
      format: 'glb',
      baseName,
  };

  let plannedCameraPosition = state.cameraPosition;
  let plannedCameraTarget = state.cameraTarget;
  let plannedAtomScale = state.atomScale;
  let shouldFit = false;

  if (image) {
    const currentFrame = state.file.trajectory.frames[state.frame];
    if (!currentFrame) throw new Error(`Frame ${state.frame} is unavailable.`);
    const natoms = currentFrame.natoms;
    if (args.fitCamera !== undefined && typeof args.fitCamera !== 'boolean') {
      throw new Error('lupi.export_asset fitCamera must be a boolean.');
    }
    const desiredFit = args.fitCamera as boolean | undefined;
    shouldFit = desiredFit ?? natoms < 5000;
    if (shouldFit) {
      const { min, max } = state.file.trajectory.globalBounds;
      const center: [number, number, number] = [
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2,
      ];
      const distance = Math.hypot(
        max[0] - min[0],
        max[1] - min[1],
        max[2] - min[2],
      ) * 1.4;
      plannedCameraPosition = [center[0], center[1], center[2] + distance];
      plannedCameraTarget = center;
    }
    if (args.atomScale !== undefined && (
      typeof args.atomScale !== 'number'
      || !Number.isFinite(args.atomScale)
      || args.atomScale < 0.1
      || args.atomScale > 8
    )) {
      throw new Error('lupi.export_asset atomScale must be a finite number from 0.1 through 8.');
    }
    const desiredScale = args.atomScale as number | undefined;
    if (desiredScale !== undefined) {
      plannedAtomScale = clamp(desiredScale, 0.1, 8);
    } else if (natoms < 200) {
      // Always boost small molecules so the asset fills the frame.
      plannedAtomScale = clamp(1.8, 0.1, 8);
    }

  }

  // Validate and finalize the prospective snapshot before mutating the live
  // viewer. Unsupported layers (for example asynchronous raster bonds) must
  // fail without leaving a fitted camera or boosted atom scale behind.
  const planningState = image
    ? {
      ...state,
      cameraPosition: plannedCameraPosition,
      cameraTarget: plannedCameraTarget,
      atomScale: plannedAtomScale,
    }
    : state;
  const filename = `${baseName}-frame${planningState.frame + 1}.${extensionForExportAsset(format)}`;
  const artifactPlan = await createBrowserRenderArtifactPlanV1(planningState, {
    format,
    ...(image
      ? { width, height, transparent }
      : (args.transparent === undefined ? {} : { transparent })),
    delivery: createInlineBrowserDeliveryV1(maxInlineBytes, filename),
  });
  if (image) {
    const liveState = useStore.getState();
    if (shouldFit) liveState.setCameraState(plannedCameraPosition, plannedCameraTarget);
    if (liveState.atomScale !== plannedAtomScale) liveState.setAtomScale(plannedAtomScale);
  }
  const exportState = useStore.getState();
  exportRequest = {
    ...exportRequest,
    artifactSpec: artifactPlan.spec,
    artifactDelivery: artifactPlan.request.delivery,
    specId: artifactPlan.specId,
    rendererFingerprint: artifactPlan.rendererFingerprint,
    artifactKey: artifactPlan.artifactKey,
  };

  const result = await runStoreExport(exportRequest, timeoutMs);
  if (result.blob.size > maxInlineBytes) {
    throw new Error(
      `Exported ${format.toUpperCase()} is ${result.blob.size.toLocaleString()} bytes, above maxInlineBytes ${maxInlineBytes.toLocaleString()}. ` +
      'Retry with a smaller molecule/view or a larger maxInlineBytes value.',
    );
  }

  // A successful exporter callback is not proof of format conformance. Sniff
  // and decode the immutable bytes before computing or returning any claimed
  // artifact identity. This also establishes MIME when Blob.type is empty.
  const validatedArtifact = await validateArtifactBytesV1(result.blob, {
    format,
    ...(image ? { width, height } : {}),
    alpha: image ? (transparent ? 'transparent' : 'opaque') : 'not-applicable',
  });

  const postExportPlan = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
    format,
    ...(image ? { width, height, transparent } : {}),
    delivery: createInlineBrowserDeliveryV1(maxInlineBytes, filename),
  });
  if (
    postExportPlan.specId !== artifactPlan.specId
    || postExportPlan.rendererFingerprint !== artifactPlan.rendererFingerprint
    || postExportPlan.artifactKey !== artifactPlan.artifactKey
  ) {
    throw new Error('Viewer render state changed during export; the unidentifiable bytes were discarded. Retry from a stable view.');
  }

  const mimeType = validatedArtifact.mimeType;
  const artifactDigest = await computeRenderArtifactDigestV1(validatedArtifact.bytes);
  const dataBase64 = bytesToBase64(validatedArtifact.bytes);
  return {
    asset: {
      format,
      filename: result.filename || `${baseName}-frame${exportState.frame + 1}.${extensionForExportAsset(format)}`,
      mimeType,
      byteLength: validatedArtifact.bytes.byteLength,
      width: image ? width : undefined,
      height: image ? height : undefined,
      dataBase64,
      dataUrl: `data:${mimeType};base64,${dataBase64}`,
      contractVersion: artifactPlan.spec.version,
      sourceContentDigest: artifactPlan.spec.source.contentDigest,
      specId: artifactPlan.specId,
      rendererFingerprint: artifactPlan.rendererFingerprint,
      artifactKey: artifactPlan.artifactKey,
      artifactDigest,
    },
    progress: result.progress,
  };
}

async function handleStatus(): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  const frame = state.file?.trajectory.frames[state.frame];
  return {
    ready: true,
    version: LUPI_VIEWER_MCP_VERSION,
    toolCount: MCP_TOOL_DEFINITIONS.length,
    moleculeLoaded: Boolean(state.file),
    atomCount: frame?.natoms ?? 0,
    frame: state.frame,
    playing: state.playing,
  };
}

async function handleAssessAsset(request: LupiMcpRequest): Promise<LupiMcpResponseResult> {
  const args = request.arguments;
  const requestedSource = readString(args.source) ?? (args.url ? 'url' : args.envelope ? 'envelope' : 'active');
  const requestedMode = readString(args.mode) ?? 'fast';
  if (requestedMode !== 'fast') {
    throw new Error(`Browser assessment supports bounded fast mode only (received ${JSON.stringify(requestedMode)}). Use the Node CLI for deep streaming inspection.`);
  }
  let context = args.context && typeof args.context === 'object' && !Array.isArray(args.context)
    ? args.context as AssessmentContext
    : undefined;

  let source: AssessmentSource;
  if (requestedSource === 'active') {
    const state = useStore.getState();
    const file = state.file;
    if (!file) throw new Error('No materialized trajectory is loaded for assessment.');
    const residentFrames = file.trajectory.frames.reduce((count, frame) => count + (frame ? 1 : 0), 0);
    context = {
      ...context,
      metadata: {
        ...context?.metadata,
        lupiTrajectory: {
          totalFrames: file.trajectory.totalFrames,
          residentFrames,
          currentFrame: state.frame,
          residency: file.trajectory.residency?.mode ?? 'complete',
        },
      },
    };
    source = trajectorySource(file.trajectory, {
      name: file.name,
      size: file.size,
      sidecars: { thermo: Boolean(file.thermo), profiles: Boolean(file.profiles?.length) },
    });
  } else if (requestedSource === 'url') {
    const url = readString(args.url);
    if (!url) throw new Error('lupi.assess_asset requires "url" when source is "url".');
    source = byteSourceFromUrl(url, {
      timeoutMs: 5_000,
      maxBytes: 128 * 1024,
      allowPrivate: isLocalAssessmentOrigin(window.location.origin),
    });
  } else if (requestedSource === 'envelope') {
    if (!args.envelope || typeof args.envelope !== 'object' || Array.isArray(args.envelope)) {
      throw new Error('lupi.assess_asset requires an object "envelope" when source is "envelope".');
    }
    source = envelopeSource(args.envelope as AssetEnvelope);
  } else {
    throw new Error(`Unsupported assessment source: ${requestedSource}`);
  }

  const assessed = await assessAsset(source, context, { mode: 'fast' });
  return { assessment: assessed.report, execution: assessed.execution };
}

/* ─── Registry ─── */

export const LUPI_MCP_TOOLS: LupiMcpToolDefinition[] = [
  { name: 'lupi.status', description: 'Report MCP bridge readiness and viewer health.', handler: handleStatus },
  { name: 'lupi.assess_asset', description: 'Run a bounded fast assessment of a materialized Lupi asset without rendering or external scientific lookups.', handler: handleAssessAsset },
  { name: 'lupi.set_frame', description: 'Jump to a specific trajectory frame.', handler: handleSetFrame },
  { name: 'lupi.play', description: 'Start trajectory playback.', handler: handlePlay },
  { name: 'lupi.pause', description: 'Pause trajectory playback.', handler: handlePause },
  { name: 'lupi.set_playback_speed', description: 'Set playback speed multiplier.', handler: handleSetPlaybackSpeed },
  { name: 'lupi.set_camera_preset', description: 'Apply a named camera preset (top, side, front, iso, free).', handler: handleSetCameraPreset },
  { name: 'lupi.set_camera', description: 'Set camera position, target, and/or FOV directly.', handler: handleSetCamera },
  { name: 'lupi.fit_camera', description: 'Fit the camera to the loaded molecule bounds.', handler: handleFitCamera },
  { name: 'lupi.set_background', description: 'Set background preset, style, motion, and adjustments.', handler: handleSetBackground },
  { name: 'lupi.set_postprocess', description: 'Set the postprocess preset and intensity.', handler: handleSetPostprocess },
  { name: 'lupi.set_material', description: 'Set material preset, scene, intensity, and atom texture.', handler: handleSetMaterial },
  { name: 'lupi.set_lighting', description: 'Set lighting intensities, angles, and colors.', handler: handleSetLighting },
  { name: 'lupi.set_filter_shell', description: 'Set the filter shell shape, preset, opacity, and radius.', handler: handleSetFilterShell },
  { name: 'lupi.set_vector_field', description: 'Set the active vector field glyph layer.', handler: handleSetVectorField },
  { name: 'lupi.set_atom_visibility', description: 'Hide atom types or scale per-type radii.', handler: handleSetAtomVisibility },
  { name: 'lupi.add_annotation', description: 'Add an etched annotation to a specific atom.', handler: handleAddAnnotation },
  { name: 'lupi.remove_annotation', description: 'Remove an annotation by id.', handler: handleRemoveAnnotation },
  { name: 'lupi.encode_view_url', description: 'Serialize the current viewer state to a shareable URL.', handler: handleEncodeViewUrl },
  { name: 'lupi.export_asset', description: 'Render the active viewer as an inline PNG/JPEG/WebP image or deterministic GLB model asset.', handler: handleExportAsset },
  { name: 'lupi.reset_viewer', description: 'Reset the viewer to default state.', handler: handleResetViewer },
];

export const LUPI_MCP_TOOL_MAP = new Map(LUPI_MCP_TOOLS.map((t) => [t.name, t]));

export function listLupiMcpTools() {
  return MCP_TOOL_DEFINITIONS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}
