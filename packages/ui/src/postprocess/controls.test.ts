import { describe, expect, it } from 'vitest';
import { resolveEffects, sanitizeEffectOverrides } from './controls';
import { POSTPROCESS_PRESETS, reduceForMobile, scalePreset } from './presets';

describe('live effect controls', () => {
  it('drives the actual compositor config, not legacy flags', () => {
    const config = resolveEffects('paper', { preset: 'paper', shadows: false, glow: true, glowStrength: .8, focus: true, autofocus: false, focusDistance: 42, vignette: true, toneMapping: 'reinhard' });
    expect(config.ssao.enabled).toBe(false);
    expect(config.bloom).toMatchObject({ enabled: true, intensity: .8 });
    expect(config.dof).toMatchObject({ enabled: true, auto: false, focusDistance: 42 });
    expect(config.toneMapping).toBe('reinhard');
    expect(scalePreset(config, .5).bloom.intensity).toBe(.4);
    expect(reduceForMobile(config).bloom.enabled).toBe(false);
    expect(config.bloom.enabled).toBe(true);
  });
  it('does not leak one recipe overrides into a different recipe', () => {
    expect(resolveEffects('paper', { preset: 'cinematic', glow: true })).toBe(POSTPROCESS_PRESETS.paper);
  });
  it('sanitizes shared input and rejects unknown recipes', () => {
    expect(sanitizeEffectOverrides({ preset: '__proto__', glow: true })).toBeNull();
    expect(sanitizeEffectOverrides({ preset: 'paper', glow: 'yes', glowStrength: Infinity, shadowStrength: -5, focusDistance: 999999, toneMapping: 'bad', unknown: 123 }))
      .toEqual({ preset: 'paper', shadowStrength: 0, focusDistance: 10000 });
  });
});
