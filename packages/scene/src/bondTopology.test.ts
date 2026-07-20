import { describe, expect, it } from 'vitest';
import { shouldUseGpuBondInference } from './bondTopology';

describe('bond topology backend ownership', () => {
  it('never sends authoritative source pairs through the GPU inference path', () => {
    const source = new Int32Array([7, 2]);
    expect(shouldUseGpuBondInference(10, source, true)).toBe(false);
    expect(shouldUseGpuBondInference(1_000_000, source, false)).toBe(false);
  });

  it('still honors requested and large-system GPU inference without source pairs', () => {
    expect(shouldUseGpuBondInference(10, new Int32Array(0), true)).toBe(true);
    expect(shouldUseGpuBondInference(200_001, undefined, false)).toBe(true);
    expect(shouldUseGpuBondInference(10, undefined, false)).toBe(false);
  });
});
