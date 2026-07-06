/**
 * MCP tool registry for AI control of the Lupi viewer.
 *
 * These tools complement the original browser bridge tools in
 * `mcpViewerBridge.tsx` with fine-grained control over playback, camera,
 * visuals, and state serialization.
 */

import { useStore, type BackgroundBackdropShape, type BackgroundBackdropPattern } from '../store';
import type { LupiMcpRequest, LupiMcpResponseResult, LupiMcpToolDefinition } from './types';
import { MCP_TOOL_DEFINITIONS } from './toolManifest';
import { LUPI_VIEWER_MCP_VERSION } from './protocol';

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

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((v): v is string => typeof v === 'string');
  return strings.length === value.length ? strings : undefined;
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
  return { cameraPosition: state.cameraPosition, cameraTarget: state.cameraTarget };
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

async function handleStatus(): Promise<LupiMcpResponseResult> {
  const state = useStore.getState();
  const frame = state.file?.trajectory.frames[state.frame];
  return {
    ready: true,
    version: LUPI_VIEWER_MCP_VERSION,
    toolCount: LUPI_MCP_TOOLS.length,
    moleculeLoaded: Boolean(state.file),
    atomCount: frame?.natoms ?? 0,
    frame: state.frame,
    playing: state.playing,
  };
}

/* ─── Registry ─── */

export const LUPI_MCP_TOOLS: LupiMcpToolDefinition[] = [
  { name: 'lupi.status', description: 'Report MCP bridge readiness and viewer health.', handler: handleStatus },
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
  { name: 'lupi.reset_viewer', description: 'Reset the viewer to default state.', handler: handleResetViewer },
];

export const LUPI_MCP_TOOL_MAP = new Map(LUPI_MCP_TOOLS.map((t) => [t.name, t]));

export function listLupiMcpTools() {
  return LUPI_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description }));
}
