import { describe, expect, it } from 'vitest';
import { resolveActivePostprocess, resolveEffects, sanitizeEffectOverrides } from './controls';
import {
  POSTPROCESS_PRESETS,
  postStructure,
  postStructureKey,
  reduceForMobile,
  scalePreset,
  scenePassSamples,
} from './presets';
import { inkContourEnabled } from './inkContour';

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
  it('adds the ink contour to the graph under the Illustrate look, without MSAA', () => {
    const inked = resolveActivePostprocess({ presetId: 'diagram', intensity: 1, overrides: null, playing: false, reduced: false, ink: true });
    expect(postStructureKey(postStructure(inked, true))).not.toBe(postStructureKey(postStructure(inked)));
    expect(scenePassSamples(inked)).toBe(inked.multisampling);
    expect(scenePassSamples(inked, true)).toBe(0);
  });
  it('reads the contour debug switch from the query or the hash route', () => {
    expect(inkContourEnabled('', '')).toBe(true);
    expect(inkContourEnabled('?contour=0', '')).toBe(false);
    expect(inkContourEnabled('', '#/mcp?contour=0')).toBe(false);
    expect(inkContourEnabled('?contour=1', '')).toBe(true);
  });
});
