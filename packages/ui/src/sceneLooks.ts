import type { AppState, InkStyle } from './store';
import { POSTPROCESS_PRESETS } from './postprocess/presets';
import { PAPER_PLATE_PRESET_ID, SAGE_PLATE_PRESET_ID } from './backgroundPresets';

export const SCENE_LOOKS = [
  { id: 'studio', label: 'Studio', description: 'Soft light · depth' },
  { id: 'paper', label: 'Paper', description: 'Bright · clear' },
  { id: 'night', label: 'Night', description: 'Dark · sculpted' },
  { id: 'prism', label: 'Prism', description: 'Iridescent · luminous' },
  { id: 'ink', label: 'Illustrate', description: 'Ink · flat colour' },
  { id: 'sketch', label: 'Sketch', description: 'Ink · hatched · paper' },
  { id: 'engrave', label: 'Engrave', description: 'Ink · engraved lines · paper' },
  { id: 'halftone', label: 'Halftone', description: 'Ink · print dots · paper' },
  { id: 'chalk', label: 'Chalk', description: 'Chalk · pastel · dark plate' },
] as const;
export type SceneLookId = typeof SCENE_LOOKS[number]['id'];

/** The Illustrate looks and their shadings (every other Look is lit). */
const INK_LOOKS = [
  ['ink', 'flat'],
  ['sketch', 'hatch'],
  ['engrave', 'engrave'],
  ['halftone', 'halftone'],
  ['chalk', 'chalk'],
] as const satisfies ReadonlyArray<readonly [SceneLookId, Exclude<InkStyle, 'off'>]>;

/** The Illustrate looks' shading (every other Look is lit). */
export function inkStyleForLook(id: SceneLookId): InkStyle {
  return INK_LOOKS.find(([look]) => look === id)?.[1] ?? 'off';
}

/** The Look a molecule opens on for an ink style (a new file keeps an Illustrate look). */
export function lookForInkStyle(style: InkStyle): SceneLookId {
  return INK_LOOKS.find(([, shading]) => shading === style)?.[0] ?? 'studio';
}

/** The ink looks drawn on the paper plate (Illustrate and Chalk keep the sage plate). */
const PAPER_LOOKS: ReadonlySet<SceneLookId> = new Set<SceneLookId>(['sketch', 'engrave', 'halftone']);

/** The post recipe every Look renders through (the Specimen rig). */
const LOOK_POSTPROCESS = 'paper' as const;

/** Presentation only. Never reset color encodings, visibility, bonds or source data.
 * All looks avoid transmission, animated backdrops, bloom and depth of field.
 *
 * Illustrate (flat colour on the sage plate), Sketch (hatched), Engrave
 * (banknote line engraving) and Halftone (print dots), those three on the
 * paper plate, and Chalk (a chalkboard drawing on the sage plate) are the
 * ink drawing's voice in 3D: the same rig and recipe as
 * Studio and Paper, with the impostors' toon shading and ink outlines on
 * (`inkStyle`); the post recipe steps aside while ink is on
 * (postprocess/controls.ts). Every other Look turns ink off.
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
    backgroundPreset: id === 'paper' ? 'white' : id === 'night' ? 'slate' : id === 'prism' ? 'midnight'
      : PAPER_LOOKS.has(id) ? PAPER_PLATE_PRESET_ID : SAGE_PLATE_PRESET_ID,
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
    ambientLightIntensity: id === 'paper' || PAPER_LOOKS.has(id) ? 0.85 : id === 'night' ? 0.4 : 0.6,
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
    inkStyle: inkStyleForLook(id),
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
