import { describe, expect, it } from 'vitest';
import { extractFrameProperties } from './frameTransfer';

describe('parser worker frame transfer', () => {
  it('serializes canonical Map properties and transfers their backing buffers', () => {
    const vx = new Float32Array([1, 2]);
    const pe = new Float32Array([-3.2, -3.1]);
    const transferables: Transferable[] = [];
    const result = extractFrameProperties(
      { properties: new Map([['vx', vx], ['c_pe', pe]]) },
      transferables,
    );
    expect(result).toEqual([{ name: 'vx', data: vx }, { name: 'c_pe', data: pe }]);
    expect(transferables).toEqual([vx.buffer, pe.buffer]);
  });

  it('retains compatibility with legacy WASM tuple properties', () => {
    const q = new Float32Array([0.1]);
    const transferables: Transferable[] = [];
    expect(extractFrameProperties({ properties: [['q', q]] }, transferables))
      .toEqual([{ name: 'q', data: q }]);
    expect(transferables).toEqual([q.buffer]);
  });
});
