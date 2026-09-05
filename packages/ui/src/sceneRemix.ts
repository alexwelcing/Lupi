import { MATERIAL_SCENES } from '@atlas/scene/materials';
import { BG_PRESETS, getBgMedia } from './backgroundPresets';
import type { AppState } from './store';

/** Presentation keys, separate from the optional atom-palette keys below.
 * Coordinates, bonds, camera, time, selection and visibility never change. */
export const REMIX_KEYS = [
  'backgroundPreset', 'backgroundStyle', 'backgroundBackdropShape', 'backgroundBackdropPattern',
  'backgroundOpacity', 'backgroundBrightness', 'backgroundSaturation', 'backgroundContrast',
  'backgroundMotionPaused', 'backgroundMotionSpeed', 'backgroundYawDegrees', 'backgroundPitchDegrees',
  'materialScene', 'materialPreset', 'materialIntensity', 'environmentPreset', 'atomTexture',
  'surfaceRoughness', 'surfacePolish', 'surfaceClearcoat',
  'ambientLightIntensity', 'dirLightIntensity', 'rimLightIntensity',
  'keyLightAzimuth', 'keyLightElevation', 'fillLightAzimuth', 'fillLightElevation',
  'rimLightAzimuth', 'rimLightElevation', 'fillLightColor', 'rimLightColor',
  'filterShellShape', 'filterShellPreset', 'filterShellOpacity', 'filterShellRadius',
  'postprocessPreset', 'postprocessIntensity', 'effectOverrides',
] as const satisfies readonly (keyof AppState)[];
const REMIX_COLOR_KEYS = ['colorScheme', 'atomColorSource', 'colorMode', 'colorProperty', 'colormap'] as const;
export type RemixSnapshot = Pick<AppState, typeof REMIX_KEYS[number]> & Partial<Pick<AppState, typeof REMIX_COLOR_KEYS[number]>>;

export function snapshotRemix(state: AppState, includeColors = true): RemixSnapshot {
  const keys = includeColors ? [...REMIX_KEYS, ...REMIX_COLOR_KEYS] : REMIX_KEYS;
  return Object.fromEntries(keys.map(key => [key, state[key]])) as RemixSnapshot;
}

export function remixScene(state: AppState, includeMedia = false, random: () => number = Math.random, includeColors = true): RemixSnapshot {
  const pick = <T,>(items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  const between = (min: number, max: number) => Math.round((min + random() * (max - min)) * 100) / 100;
  const large = (state.file?.trajectory.frames[0]?.natoms ?? 0) >= 20_000;
  const recipes = MATERIAL_SCENES.filter(scene => scene.id !== state.materialScene && (!large || scene.materialPreset !== 'transmission'));
  const recipe = pick(recipes);
  const backgrounds = Object.entries(BG_PRESETS).filter(([id, bg]) => id !== state.backgroundPreset
    && (includeMedia || getBgMedia(bg).kind === 'gradient'));
  const background = pick(backgrounds)[0];
  return {
    backgroundPreset: background,
    backgroundStyle: pick(['radial', 'spotlight', 'linear'] as const),
    backgroundBackdropShape: 'dome', backgroundBackdropPattern: 'image',
    backgroundOpacity: 1, backgroundBrightness: between(0.8, 1.2),
    backgroundSaturation: between(0.85, 1.25), backgroundContrast: between(0.9, 1.15),
    backgroundMotionPaused: state.backgroundMotionPaused, backgroundMotionSpeed: between(0.35, 0.8),
    backgroundYawDegrees: between(-180, 180), backgroundPitchDegrees: 0,
    materialScene: recipe.id, materialPreset: recipe.materialPreset,
    materialIntensity: between(0.45, 0.95),
    environmentPreset: large ? 'none' : 'softbox',
    atomTexture: pick(['none', 'none', 'scratched', 'noise'] as const),
    surfaceRoughness: between(-0.1, 0.3), surfacePolish: between(0.1, 0.6), surfaceClearcoat: between(0.15, 0.7),
    ambientLightIntensity: between(0.45, 0.85), dirLightIntensity: between(1.1, 2.2), rimLightIntensity: between(0.3, 0.9),
    keyLightAzimuth: between(-90, 90), keyLightElevation: between(25, 70),
    fillLightAzimuth: between(-160, -70), fillLightElevation: between(5, 30),
    rimLightAzimuth: between(110, 180), rimLightElevation: between(20, 60),
    fillLightColor: pick(['#b5d8ff', '#d5b6ff', '#ffe1b8', '#a7eadb']),
    rimLightColor: pick(['#8bdeff', '#ffb7df', '#ffe9bc', '#bbffde']),
    filterShellShape: pick(['sphere', 'sphere', 'off', 'cube'] as const),
    filterShellPreset: pick(['prism', 'cryo', 'haze', 'graphite'] as const),
    filterShellOpacity: between(0.22, 0.45), filterShellRadius: between(1.04, 1.14),
    postprocessPreset: large ? 'diagram' : recipe.postprocessPreset,
    postprocessIntensity: between(0.75, 1.1), effectOverrides: null,
    ...(includeColors ? {
      colorScheme: 'colorway', atomColorSource: 'colormap', colorMode: 'type', colorProperty: null,
      colormap: pick((['viridis', 'plasma', 'inferno', 'coolwarm', 'turbo', 'neon', 'cyberpunk'] as const)
        .filter(palette => palette !== state.colormap)),
    } as const : {}),
  };
}
