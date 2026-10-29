/**
 * Postprocess presets — directorial looks, not a kitchen sink.
 *
 * Each preset is a coherent recipe: a curated combination of ambient
 * occlusion + Bloom + DOF + Vignette + ToneMapping that's been tuned to read
 * as a single artistic intent. The user picks one and adjusts a single
 * intensity knob that scales the whole look proportionally.
 *
 * ScenePostprocessing renders the recipe as one TSL render pipeline
 * (postPipeline.ts); the values here keep their v9 meaning and scale.
 *
 * Legacy individual sliders still exist under "Advanced" for power users,
 * but they're not the primary UX anymore.
 */

export type PostprocessPresetId =
  | 'paper'      // print-faithful; for journal figures
  | 'studio'     // balanced; the default
  | 'editorial'  // moody dark; for slides on dark backgrounds
  | 'cinematic'  // shallow focus + bloom; for hero shots and trailers
  | 'diagram';   // no postprocess; for explanatory figures

/** Effect-stack parameters at intensity = 1. Intensity scales them. */
export interface PostprocessPresetConfig {
  id: PostprocessPresetId;
  label: string;
  /** One-line essence shown under the title in the gallery. */
  tagline: string;
  /** Performance tier — fast (SSAO+/-Bloom), balanced (+Vignette+ToneMap),
   *  heavy (+DOF). Communicated to the user as a tier badge. */
  performanceTier: 'fast' | 'balanced' | 'heavy';

  /** Ambient occlusion (GTAO, normals reconstructed from depth). `intensity`
   *  is the AO strength (the occlusion exponent: ~1 = subtle, 2+ = heavy,
   *  0 = none); `radius` is the world-space AO radius in scene units (Å) —
   *  sized for contact shadows between touching atoms. */
  ssao: { enabled: boolean; intensity: number; radius: number };
  bloom: { enabled: boolean; intensity: number; threshold: number; smoothing: number };
  dof: {
    enabled: boolean;
    bokehScale: number;
    focalLength: number;
    focusDistance: number;
    focusRange: number;
    auto: boolean;
  };
  vignette: { enabled: boolean; offset: number; darkness: number };
  /** 'neutral' is Khronos PBR Neutral: it keeps CPK hues (the Specimen default). */
  toneMapping: 'neutral' | 'aces' | 'reinhard' | 'none';
  /** MSAA samples for the scene pass when not playing. 0 disables. A graph
   *  that reads depth (AO, DOF) renders without MSAA (postPipeline.ts). */
  multisampling: 0 | 2 | 4 | 8;
  /** HDRI environment for IBL. The atom impostor shader and bond
   *  MeshPhysicalMaterial both sample this — single source of truth.
   *  `null` disables IBL (atoms fall back to neutral grey, bonds get no
   *  envMap). */
  env: {
    drei: 'studio' | 'softbox' | 'city' | 'dawn' | 'forest' | 'lobby' | 'night' | 'park' | 'sunset' | 'warehouse' | null;
  };
}

export const POSTPROCESS_PRESETS: Record<PostprocessPresetId, PostprocessPresetConfig> = {
  paper: {
    id: 'paper',
    label: 'Paper',
    tagline: 'Soft, true-to-print shading with neutral exposure — reads like a journal figure.',
    performanceTier: 'fast',
    // The baked contact occlusion carries the crevices; GTAO adds the
    // cross-occlusion (bonds, shells) on top, a little lighter than v9.
    ssao: { enabled: true, intensity: 0.85, radius: 1.0 },
    bloom: { enabled: false, intensity: 0, threshold: 0.9, smoothing: 0.3 },
    dof: { enabled: false, bokehScale: 1, focalLength: 0.02, focusDistance: 3, focusRange: 4, auto: false },
    vignette: { enabled: false, offset: 0.5, darkness: 0.3 },
    // Khronos PBR Neutral keeps CPK hue and saturation (ACES shifts them).
    toneMapping: 'neutral',
    multisampling: 4,
    env: { drei: 'softbox' }, // neutral procedural studio
  },
  studio: {
    id: 'studio',
    label: 'Studio',
    tagline: 'Balanced studio light with a subtle glow and soft shadows. The everyday default.',
    performanceTier: 'fast',
    ssao: { enabled: true, intensity: 1.2, radius: 1.2 },
    bloom: { enabled: true, intensity: 0.18, threshold: 0.85, smoothing: 0.3 },
    dof: { enabled: false, bokehScale: 1, focalLength: 0.02, focusDistance: 3, focusRange: 5, auto: false },
    vignette: { enabled: true, offset: 0.4, darkness: 0.4 },
    toneMapping: 'neutral',
    multisampling: 4,
    env: { drei: 'studio' }, // balanced studio HDRI
  },
  editorial: {
    id: 'editorial',
    label: 'Editorial',
    tagline: 'Dark and high-contrast with a heavy vignette and glow. Built to pop on dark slides.',
    performanceTier: 'balanced',
    ssao: { enabled: true, intensity: 2.2, radius: 1.3 },
    bloom: { enabled: true, intensity: 0.45, threshold: 0.7, smoothing: 0.25 },
    dof: { enabled: false, bokehScale: 1, focalLength: 0.02, focusDistance: 3, focusRange: 5, auto: false },
    vignette: { enabled: true, offset: 0.35, darkness: 0.65 },
    toneMapping: 'aces',
    multisampling: 4,
    env: { drei: 'night' }, // moody dark
  },
  cinematic: {
    id: 'cinematic',
    label: 'Cinematic',
    tagline: 'Shallow depth-of-field that tracks the molecule, plus warm bloom. Hero shots and trailers.',
    performanceTier: 'heavy',
    ssao: { enabled: true, intensity: 1.8, radius: 1.3 },
    bloom: { enabled: true, intensity: 0.6, threshold: 0.55, smoothing: 0.2 },
    dof: { enabled: true, bokehScale: 2.1, focalLength: 0.025, focusDistance: 12, focusRange: 8, auto: true },
    vignette: { enabled: true, offset: 0.3, darkness: 0.7 },
    toneMapping: 'aces',
    multisampling: 4,
    env: { drei: 'sunset' }, // warm sunset
  },
  diagram: {
    id: 'diagram',
    label: 'Diagram',
    tagline: 'No effects at all — flat, exact element colors. Best for labeled, schematic figures.',
    performanceTier: 'fast',
    ssao: { enabled: false, intensity: 0, radius: 1.2 },
    bloom: { enabled: false, intensity: 0, threshold: 0.9, smoothing: 0.3 },
    dof: { enabled: false, bokehScale: 1, focalLength: 0.02, focusDistance: 3, focusRange: 4, auto: false },
    vignette: { enabled: false, offset: 0.5, darkness: 0.3 },
    toneMapping: 'none',
    multisampling: 4,
    env: { drei: null }, // flat — disables IBL
  },
};

export const PRESET_ORDER: PostprocessPresetId[] = ['paper', 'studio', 'editorial', 'cinematic', 'diagram'];

/** Phone/low-power presentation keeps color and lighting, without full-screen
 * AO, glow or defocus passes, and without MSAA: phones render near native
 * DPR, and the pipeline's FXAA smooths the impostor silhouettes MSAA cannot
 * (WebGPU never honoured 2 samples anyway; three rounds 2 down to 1). This
 * does not rewrite a saved scene's intent. */
export function reduceForMobile(preset: PostprocessPresetConfig): PostprocessPresetConfig {
  return {
    ...preset,
    ssao: { ...preset.ssao, enabled: false },
    bloom: { ...preset.bloom, enabled: false },
    dof: { ...preset.dof, enabled: false },
    multisampling: 0,
  };
}

/** Apply intensity to a preset. Intensity 0 = effects disabled (preset still
 *  selected); 1 = preset's authored values; values > 1 over-drive. Most
 *  effects scale linearly; vignette darkness is non-linear (eyeball'd). */
export function scalePreset(preset: PostprocessPresetConfig, intensity: number): PostprocessPresetConfig {
  const t = Math.max(0, Math.min(2, intensity));
  // At intensity 0, disable everything but tone-mapping (color fidelity).
  const enable = (flag: boolean) => flag && t > 0;
  return {
    ...preset,
    ssao: {
      ...preset.ssao,
      enabled: enable(preset.ssao.enabled),
      intensity: preset.ssao.intensity * t,
    },
    bloom: {
      ...preset.bloom,
      enabled: enable(preset.bloom.enabled),
      intensity: preset.bloom.intensity * t,
    },
    dof: {
      ...preset.dof,
      enabled: enable(preset.dof.enabled),
      bokehScale: preset.dof.bokehScale * t,
    },
    vignette: {
      ...preset.vignette,
      enabled: enable(preset.vignette.enabled),
      darkness: preset.vignette.darkness * Math.min(1.2, t),
    },
  };
}

/** Strip expensive passes for playback. Tone mapping survives because it's
 *  cheap and required for color fidelity; everything else costs frames. */
export function reduceForPlayback(preset: PostprocessPresetConfig): PostprocessPresetConfig {
  // Keep the enabled SET identical to the paused state so the pipeline
  // structure (postStructureKey) is stable — rebuilding the graph on play
  // would recompile it on every play/pause. Instead we only cheapen
  // parameters (uniforms, no rebuild): drop MSAA and soften the expensive
  // passes while the trajectory animates.
  return {
    ...preset,
    ssao: { ...preset.ssao, intensity: preset.ssao.intensity * 0.5 },
    bloom: { ...preset.bloom, intensity: preset.bloom.intensity * 0.6 },
    dof: { ...preset.dof, bokehScale: Math.min(preset.dof.bokehScale, 2) },
    multisampling: 0,
  };
}

/** The part of a config that decides the graph's shape. */
export interface PostStructure {
  ao: boolean;
  bloom: boolean;
  dof: boolean;
  vignette: boolean;
  toneMapping: PostprocessPresetConfig['toneMapping'];
  /** The Illustrate look's ink contour (inkContour.ts), while the drawing shows. */
  contour: boolean;
  /**
   * The look is changing between lit and ink (a fade or a Light Fuse): every
   * stage rests where the pixel's live ink mix is, so the recipe follows the
   * drawing instead of switching at the toggle. Only when there is a stage
   * to rest.
   */
  inkFade: boolean;
}

/**
 * The graph a config needs; `contour` while the Illustrate look is drawn,
 * `inkFade` while it changes (the config is then the lit recipe).
 */
export function postStructure(config: PostprocessPresetConfig, contour = false, inkFade = false): PostStructure {
  const ao = config.ssao.enabled;
  const bloom = config.bloom.enabled;
  const dof = config.dof.enabled;
  const vignette = config.vignette.enabled;
  const toneMapping = config.toneMapping;
  return {
    ao,
    bloom,
    dof,
    vignette,
    toneMapping,
    contour,
    inkFade: inkFade && (ao || bloom || dof || vignette || toneMapping !== 'none'),
  };
}

/** Changes only when the graph must be rebuilt (the set of effects or the tone-mapping mode). */
export function postStructureKey(structure: PostStructure): string {
  return [
    structure.ao ? 'ao' : '_',
    structure.bloom ? 'bl' : '_',
    structure.dof ? 'dof' : '_',
    structure.vignette ? 'vg' : '_',
    structure.toneMapping,
    structure.contour ? 'ink' : '_',
    structure.inkFade ? 'fade' : '_',
  ].join('|');
}

/**
 * True when the graph samples the scene pass's depth (AO, DOF and the ink
 * contour do). Such a graph renders the scene pass without MSAA: the sample
 * count of a depth texture is baked into the shaders that read it, so it
 * cannot follow play/pause, and a multisampled depth read is not portable
 * across backends.
 */
export function postReadsDepth(structure: PostStructure): boolean {
  return structure.ao || structure.dof || structure.contour;
}

/** MSAA samples for the scene pass: the preset's, unless the graph reads depth. */
export function scenePassSamples(config: PostprocessPresetConfig, contour = false): number {
  return postReadsDepth(postStructure(config, contour)) ? 0 : config.multisampling;
}
