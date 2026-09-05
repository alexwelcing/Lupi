import { describe, expect, it } from 'vitest';
import { POSTPROCESS_PRESETS, reduceForMobile, reduceForPlayback } from './presets';

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
    expect(mobile.multisampling).toBe(2);
    expect(mobile.toneMapping).toBe(preset.toneMapping);
    expect(preset).toEqual(before);
  });
});
