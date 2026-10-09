import { describe, expect, it } from 'vitest';
import { inkPhase, resolveActivePostprocess, resolveEffects, sanitizeEffectOverrides } from './controls';
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
  it('reads the phase of the Illustrate look from the store and the live drawing', () => {
    expect(inkPhase(false, 0, false)).toBe('lit');
    expect(inkPhase(true, 1, false)).toBe('ink');
    // Toggled, and the driver's fade or fuse not begun, under way, or turned round.
    expect(inkPhase(true, 0, false)).toBe('changing');
    expect(inkPhase(true, 0.4, false)).toBe('changing');
    expect(inkPhase(false, 0.4, false)).toBe('changing');
    // A Light Fuse burns with the live mix anywhere, its ends included.
    expect(inkPhase(true, 1, true)).toBe('changing');
    expect(inkPhase(false, 0, true)).toBe('changing');
    // Ink-to-Light's hand-off drawing: lit in the store, inked on screen.
    expect(inkPhase(false, 1, false)).toBe('changing');
  });
  it('keeps the lit recipe while the look changes, and the cheaper ink graph at rest', () => {
    const input = { presetId: 'studio' as const, intensity: 1, overrides: null, playing: false, reduced: false };
    const lit = resolveActivePostprocess({ ...input, ink: false });
    const inked = resolveActivePostprocess({ ...input, ink: true });
    const changing = postStructure(lit, true, true);
    expect(changing).toEqual({ ao: true, bloom: true, dof: false, vignette: true, toneMapping: 'neutral', contour: true, inkFade: true });
    expect(postStructure(inked, true)).toEqual({ ao: false, bloom: false, dof: false, vignette: false, toneMapping: 'none', contour: true, inkFade: false });
    expect(postStructureKey(changing)).not.toBe(postStructureKey(postStructure(lit, true)));
    expect(postStructureKey(changing)).not.toBe(postStructureKey(postStructure(inked, true)));
    expect(scenePassSamples(lit, true)).toBe(0);
    // A recipe with nothing to rest (Diagram) keeps one graph through the change.
    const diagram = resolveActivePostprocess({ ...input, presetId: 'diagram', ink: false });
    expect(postStructure(diagram, true, true).inkFade).toBe(false);
    expect(postStructureKey(postStructure(diagram, true, true))).toBe(postStructureKey(postStructure(diagram, true)));
    // The phone budget still tone-maps, so it fades.
    expect(postStructure(resolveActivePostprocess({ ...input, reduced: true }), true, true).inkFade).toBe(true);
  });
  it('reads the contour debug switch from the query or the hash route', () => {
    expect(inkContourEnabled('', '')).toBe(true);
    expect(inkContourEnabled('?contour=0', '')).toBe(false);
    expect(inkContourEnabled('', '#/mcp?contour=0')).toBe(false);
    expect(inkContourEnabled('?contour=1', '')).toBe(true);
  });
});
