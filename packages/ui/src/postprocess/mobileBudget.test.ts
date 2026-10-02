import { describe, expect, it } from 'vitest';
import { resolveActivePostprocess } from './controls';
import { POSTPROCESS_PRESETS, postStructure, postStructureKey, reduceForMobile, reduceForPlayback, scenePassSamples } from './presets';

describe('mobile postprocess budget', () => {
  it('does not re-enable multisampling during trajectory playback', () => {
    expect(reduceForMobile(reduceForPlayback(POSTPROCESS_PRESETS.studio)).multisampling).toBe(0);
  });
  it.each(Object.values(POSTPROCESS_PRESETS))('bounds $id without mutating authored intent', preset => {
    const before = structuredClone(preset);
    const mobile = reduceForMobile(preset);
    expect(mobile.ssao.enabled).toBe(false);
    expect(mobile.bloom.enabled).toBe(false);
    expect(mobile.dof.enabled).toBe(false);
    expect(mobile.multisampling).toBe(0);
    expect(mobile.toneMapping).toBe(preset.toneMapping);
    expect(preset).toEqual(before);
  });
  it.each(Object.values(POSTPROCESS_PRESETS))('keeps the $id pipeline structure across play/pause (no rebuild)', preset => {
    for (const reduced of [false, true]) {
      const input = { presetId: preset.id, intensity: 1, overrides: null, reduced };
      const paused = resolveActivePostprocess({ ...input, playing: false });
      const playing = resolveActivePostprocess({ ...input, playing: true });
      expect(postStructureKey(postStructure(playing))).toBe(postStructureKey(postStructure(paused)));
      expect(scenePassSamples(playing)).toBe(0);
      expect(scenePassSamples(paused)).toBe(paused.ssao.enabled || paused.dof.enabled || reduced ? 0 : preset.multisampling);
    }
  });
});
