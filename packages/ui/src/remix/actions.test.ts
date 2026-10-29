import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { playStore } from '../play/playStore';
import { applyRemixCode } from './actions';
import { parseRemixCode, remixFoil } from './code';

/** A Holo code: fmix32(fnv1a('r1-K03DQ')) mod 24 is 0. */
function holoCode() {
  const parse = parseRemixCode('r1-K03DQ');
  if (!parse.ok) throw new Error('r1-K03DQ should parse');
  return parse.code;
}

afterEach(() => {
  useStore.setState({ inkStyle: 'off' });
});

describe('applyRemixCode announcements', () => {
  it('names a Foil finish on the pill under the light', () => {
    const code = holoCode();
    expect(remixFoil(code)).toBe('holo');
    applyRemixCode(code, 'paste', { instant: true });
    expect(playStore.getState().flash?.text).toBe('✦ Holo foil · r1-K03DQ');
  });

  it('does not name a finish the Illustrate look hides', () => {
    useStore.setState({ inkStyle: 'flat' });
    applyRemixCode(holoCode(), 'paste', { instant: true });
    expect(playStore.getState().flash?.text).toBe('Remix · r1-K03DQ');
  });
});
