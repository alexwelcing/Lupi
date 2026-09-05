import type { AppState } from './store';

export const SCENE_LOOKS = [
  { id: 'studio', label: 'Studio', description: 'Soft light · depth' },
  { id: 'paper', label: 'Paper', description: 'Bright · clear' },
  { id: 'night', label: 'Night', description: 'Dark · sculpted' },
  { id: 'prism', label: 'Prism', description: 'Iridescent · luminous' },
] as const;
export type SceneLookId = typeof SCENE_LOOKS[number]['id'];

/** Presentation only. Never reset color encodings, visibility, bonds or source data.
 * All looks avoid transmission, animated backdrops, bloom and depth of field.
 * Large scenes retain the cheaper diagram shader path and skip environment maps. */
export function sceneLookPatch(id: SceneLookId, atomCount: number) {
  const large = atomCount >= 25_000;
  return {
    backgroundPreset: id === 'paper' ? 'white' : id === 'night' ? 'slate' : id === 'prism' ? 'midnight' : 'gallery-studio',
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
    environmentPreset: large ? 'none' : 'softbox',
    postprocessPreset: large ? 'diagram' : 'paper',
    postprocessIntensity: 0.9,
    effectOverrides: null,
    filterShellShape: id === 'prism' ? 'sphere' : 'off',
    filterShellPreset: 'prism',
    filterShellOpacity: 0.38,
    filterShellRadius: 1.08,
    ambientLightIntensity: id === 'paper' ? 0.85 : id === 'night' ? 0.4 : 0.6,
    dirLightIntensity: id === 'night' ? 1.65 : 1.35,
    rimLightIntensity: id === 'night' ? 0.4 : 0.25,
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
    toneMapping: large ? 'none' : 'aces',
    ssao: !large,
    bloom: false,
    dof: false,
    autoDepthOfField: false,
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
