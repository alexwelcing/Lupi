import type { AppState } from './store';
import { POSTPROCESS_PRESETS } from './postprocess/presets';

export const SCENE_LOOKS = [
  { id: 'studio', label: 'Studio', description: 'Soft light · depth' },
  { id: 'paper', label: 'Paper', description: 'Bright · clear' },
  { id: 'night', label: 'Night', description: 'Dark · sculpted' },
  { id: 'prism', label: 'Prism', description: 'Iridescent · luminous' },
] as const;
export type SceneLookId = typeof SCENE_LOOKS[number]['id'];

/** The post recipe every Look renders through (the Specimen rig). */
const LOOK_POSTPROCESS = 'paper' as const;

/** Presentation only. Never reset color encodings, visibility, bonds or source data.
 * All looks avoid transmission, animated backdrops, bloom and depth of field.
 *
 * The Specimen rig: every Look is one softbox key (az 40, el 45) with a cool
 * fill and a gentle rim card, changing only gains and colours, at every
 * scale. There is no identity switch at 25k atoms any more: the baked contact
 * and density occlusion carry depth where screen-space AO cannot, devices
 * without image-based light draw the same softboxes analytically, and the
 * renderer's own quality tiers drop the per-pixel cost for huge scenes.
 * `atomCount` stays in the signature for callers and URL compatibility. */
export function sceneLookPatch(id: SceneLookId, atomCount: number) {
  void atomCount;
  const post = POSTPROCESS_PRESETS[LOOK_POSTPROCESS];
  return {
    backgroundPreset: id === 'paper' ? 'white' : id === 'night' ? 'slate' : id === 'prism' ? 'midnight' : 'sage-plate',
    backgroundStyle: 'radial',
    backgroundBackdropShape: 'dome',
    backgroundBackdropPattern: 'image',
    backgroundOpacity: 1,
    backgroundBrightness: 1,
    backgroundSaturation: 1,
    backgroundContrast: 1,
    backgroundYawDegrees: 0,
    backgroundPitchDegrees: 0,
    materialScene: 'specimen',
    materialPreset: id === 'prism' ? 'metallic' : 'plastic',
    materialIntensity: id === 'prism' ? 0.6 : 0.35,
    environmentPreset: 'softbox',
    postprocessPreset: LOOK_POSTPROCESS,
    postprocessIntensity: 0.9,
    effectOverrides: null,
    filterShellShape: id === 'prism' ? 'sphere' : 'off',
    filterShellPreset: 'prism',
    filterShellOpacity: 0.38,
    filterShellRadius: 1.08,
    ambientLightIntensity: id === 'paper' ? 0.85 : id === 'night' ? 0.4 : 0.6,
    dirLightIntensity: id === 'night' ? 1.65 : 1.35,
    // A gentle rim on every Look; Night leans on it.
    rimLightIntensity: id === 'night' ? 0.42 : 0.22,
    surfaceRoughness: 0.06,
    surfacePolish: 0.16,
    surfaceClearcoat: 0.12,
    atomTexture: 'none',
    keyLightAzimuth: 40,
    keyLightElevation: 45,
    fillLightAzimuth: -120,
    fillLightElevation: 10,
    rimLightAzimuth: 160,
    rimLightElevation: 30,
    fillLightColor: id === 'prism' ? '#bda9ff' : '#dfe8ef',
    rimLightColor: id === 'prism' ? '#76efff' : '#ffffff',
    // Legacy mirrors of the recipe (PresetLegacyBridge keeps them in sync).
    toneMapping: post.toneMapping,
    ssao: post.ssao.enabled,
    bloom: post.bloom.enabled,
    dof: post.dof.enabled,
    autoDepthOfField: post.dof.auto,
  } satisfies Partial<AppState>;
}

/** A customized/shared scene must not falsely advertise a selected preset. */
export function currentSceneLook(state: AppState): SceneLookId | null {
  const count = state.file?.trajectory.frames[0]?.natoms ?? 0;
  return SCENE_LOOKS.find(({ id }) =>
    Object.entries(sceneLookPatch(id, count)).every(([key, value]) =>
      state[key as keyof AppState] === value,
    ),
  )?.id ?? null;
}
