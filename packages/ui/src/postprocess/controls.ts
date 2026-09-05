import { POSTPROCESS_PRESETS, type PostprocessPresetConfig, type PostprocessPresetId } from './presets';

/** Overrides belong to one recipe. Changing recipes cannot accidentally inherit
 * a different recipe's focus or exposure. Legacy URL flags remain compatible. */
export interface EffectOverrides {
  preset: PostprocessPresetId;
  shadows?: boolean;
  shadowStrength?: number;
  glow?: boolean;
  glowStrength?: number;
  focus?: boolean;
  autofocus?: boolean;
  focusDistance?: number;
  vignette?: boolean;
  vignetteStrength?: number;
  toneMapping?: PostprocessPresetConfig['toneMapping'];
}

export function resolveEffects(id: PostprocessPresetId, overrides: EffectOverrides | null): PostprocessPresetConfig {
  const base = POSTPROCESS_PRESETS[id] ?? POSTPROCESS_PRESETS.studio;
  if (!overrides || overrides.preset !== id) return base;
  return {
    ...base,
    ssao: { ...base.ssao, enabled: overrides.shadows ?? base.ssao.enabled, intensity: overrides.shadowStrength ?? base.ssao.intensity },
    bloom: { ...base.bloom, enabled: overrides.glow ?? base.bloom.enabled, intensity: overrides.glowStrength ?? base.bloom.intensity },
    dof: { ...base.dof, enabled: overrides.focus ?? base.dof.enabled, auto: overrides.autofocus ?? base.dof.auto, focusDistance: overrides.focusDistance ?? base.dof.focusDistance },
    vignette: { ...base.vignette, enabled: overrides.vignette ?? base.vignette.enabled, darkness: overrides.vignetteStrength ?? base.vignette.darkness },
    toneMapping: overrides.toneMapping ?? base.toneMapping,
  };
}

export function sanitizeEffectOverrides(input: unknown): EffectOverrides | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.preset !== 'string' || !Object.hasOwn(POSTPROCESS_PRESETS, value.preset)) return null;
  const result: EffectOverrides = { preset: value.preset as PostprocessPresetId };
  for (const key of ['shadows', 'glow', 'focus', 'autofocus', 'vignette'] as const) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  for (const [key, max] of [['shadowStrength', 4], ['glowStrength', 4], ['focusDistance', 10000], ['vignetteStrength', 1]] as const) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) result[key] = Math.max(0, Math.min(max, value[key]));
  }
  if (value.toneMapping === 'aces' || value.toneMapping === 'reinhard' || value.toneMapping === 'none') result.toneMapping = value.toneMapping;
  return result;
}
