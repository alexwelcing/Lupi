import type { AppState } from './store';
import { resolveRemixCode, rollRemixCode, type RemixCode } from './remix/code';

/** Presentation keys, separate from the optional atom-palette keys below.
 * Coordinates, bonds, camera, time, selection and visibility never change.
 * Every remix is a Remix code (remix/code.ts): the code names the look, so a
 * roll can be shared, typed back in and reproduced on any device. */
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
export const REMIX_COLOR_KEYS = ['colorScheme', 'atomColorSource', 'colorMode', 'colorProperty', 'colormap'] as const;
export type RemixSnapshot = Pick<AppState, typeof REMIX_KEYS[number]> & Partial<Pick<AppState, typeof REMIX_COLOR_KEYS[number]>>;

export function snapshotRemix(state: AppState, includeColors = true): RemixSnapshot {
  const keys = includeColors ? [...REMIX_KEYS, ...REMIX_COLOR_KEYS] : REMIX_KEYS;
  return Object.fromEntries(keys.map(key => [key, state[key]])) as RemixSnapshot;
}

/**
 * The patch for a Remix code: the code's look plus the viewer's own motion
 * pause (a comfort choice, never part of a look).
 */
export function remixPatchForCode(code: RemixCode, state: Pick<AppState, 'backgroundMotionPaused'>): RemixSnapshot {
  return { ...resolveRemixCode(code), backgroundMotionPaused: state.backgroundMotionPaused } as RemixSnapshot;
}

/**
 * Roll a fresh Remix code that changes the backdrop and recipe (and the
 * palette, when colours are included) and return its code and patch.
 */
export function rollRemix(state: AppState, includeMedia = false, random: () => number = Math.random, includeColors = true): { code: RemixCode; patch: RemixSnapshot } {
  const code = rollRemixCode(state, { colors: includeColors, worlds: includeMedia }, random);
  return { code, patch: remixPatchForCode(code, state) };
}

/** A new look as a patch (the code is in `rollRemix`). */
export function remixScene(state: AppState, includeMedia = false, random: () => number = Math.random, includeColors = true): RemixSnapshot {
  return rollRemix(state, includeMedia, random, includeColors).patch;
}
