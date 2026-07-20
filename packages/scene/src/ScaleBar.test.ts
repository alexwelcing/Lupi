import { describe, expect, it } from 'vitest';
import { formatScaleBarLabel } from './ScaleBar';

describe('formatScaleBarLabel', () => {
  it('uses physical units only for frames that declare angstrom distances', () => {
    expect(formatScaleBarLabel(5, true)).toBe('5 \u00c5');
    expect(formatScaleBarLabel(1000, true)).toBe('1.0 nm');
  });

  it('labels unproven coordinates as source units without metric conversion', () => {
    expect(formatScaleBarLabel(5, false)).toBe('5 source units');
    expect(formatScaleBarLabel(1000, false)).toBe('1000 source units');
  });
});
