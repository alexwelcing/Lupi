import { describe, expect, it } from 'vitest';
import { detectFrameVectorFields, ensureVectorMagnitude, type Frame } from '@atlas/core';
import {
  canonicalDecodedRenderFrameBytesV1,
  canonicalDecodedRenderFrameBytesV2,
  computeDecodedRenderFrameDigestV1,
  computeDecodedRenderFrameDigestV2,
} from './renderArtifactSource';

function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    timestep: 10,
    natoms: 2,
    boxBounds: new Float64Array([0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array([1, 2]),
    types: new Int32Array([6, 8]),
    positions: new Float32Array([0, 0, 0, 1, 2, 3]),
    bonds: new Int32Array([0, 1]),
    properties: new Map([
      ['charge', new Float32Array([-0.2, 0.2])],
      ['speed', new Float32Array([1, 2])],
    ]),
    ...overrides,
  };
}

describe('decoded render frame identity', () => {
  it('is deterministic across property insertion order and normalizes negative zero', async () => {
    const left = frame();
    const right = frame({
      positions: new Float32Array([-0, 0, 0, 1, 2, 3]),
      properties: new Map([
        ['speed', new Float32Array([1, 2])],
        ['charge', new Float32Array([-0.2, 0.2])],
      ]),
    });

    expect(canonicalDecodedRenderFrameBytesV1(left)).toEqual(canonicalDecodedRenderFrameBytesV1(right));
    expect(await computeDecodedRenderFrameDigestV1(left)).toBe(await computeDecodedRenderFrameDigestV1(right));
  });

  it('changes for every decoded structure class that can affect rendering', async () => {
    const original = frame();
    const originalDigest = await computeDecodedRenderFrameDigestV1(original);
    const variants = [
      frame({ ids: new Int32Array([9, 2]) }),
      frame({ types: new Int32Array([29, 8]) }),
      frame({ positions: new Float32Array([0.5, 0, 0, 1, 2, 3]) }),
      frame({ bonds: new Int32Array(0) }),
      frame({ boxBounds: new Float64Array([0, 20, 0, 10, 0, 10]) }),
      frame({ boxTilt: new Float64Array([1, 0, 0]), triclinic: true }),
      frame({ properties: new Map([['charge', new Float32Array([-0.1, 0.2])]]) }),
    ];

    for (const variant of variants) {
      expect(await computeDecodedRenderFrameDigestV1(variant)).not.toBe(originalDigest);
    }
  });

  it('V2 distinguishes source IDs from identical synthetic or unknown row labels', async () => {
    const source = frame({ identity: { kind: 'source-id', unique: true } });
    const synthetic = frame({ identity: { kind: 'synthetic-row', unique: true } });
    const unknown = frame({ identity: { kind: 'unknown', unique: false } });
    const legacyMissing = frame({ identity: undefined });

    expect(canonicalDecodedRenderFrameBytesV1(source)).toEqual(
      canonicalDecodedRenderFrameBytesV1(synthetic),
    );
    expect(await computeDecodedRenderFrameDigestV2(source)).not.toBe(
      await computeDecodedRenderFrameDigestV2(synthetic),
    );
    expect(await computeDecodedRenderFrameDigestV2(synthetic)).not.toBe(
      await computeDecodedRenderFrameDigestV2(unknown),
    );
    expect(canonicalDecodedRenderFrameBytesV2(legacyMissing)).toEqual(
      canonicalDecodedRenderFrameBytesV2(unknown),
    );
  });

  it('does not receive mutable LoadedFile name, size, or source URL metadata', async () => {
    const decoded = frame();
    const first = { name: 'first.xyz', size: 1, sourceUrl: 'https://one.invalid', frame: decoded };
    const second = { name: 'second.xyz', size: 999, sourceUrl: 'https://two.invalid', frame: decoded };

    expect(await computeDecodedRenderFrameDigestV1(first.frame)).toBe(
      await computeDecodedRenderFrameDigestV1(second.frame),
    );
  });

  it('is stable before and after deterministic vector magnitude caching', async () => {
    const decoded = frame({
      properties: new Map([
        ['vx', new Float32Array([3, 0])],
        ['vy', new Float32Array([4, 0])],
        ['vz', new Float32Array([0, 5])],
      ]),
    });
    const before = await computeDecodedRenderFrameDigestV1(decoded);
    const [velocity] = detectFrameVectorFields(decoded);
    expect(ensureVectorMagnitude(decoded, velocity)).toEqual(new Float32Array([5, 5]));
    const after = await computeDecodedRenderFrameDigestV1(decoded);

    expect(after).toBe(before);
  });

  it('still hashes a magnitude property that does not match its source components', async () => {
    const decoded = frame({
      properties: new Map([
        ['vx', new Float32Array([3, 0])],
        ['vy', new Float32Array([4, 0])],
        ['vz', new Float32Array([0, 5])],
        ['|v|', new Float32Array([99, 5])],
      ]),
    });
    const withClaim = await computeDecodedRenderFrameDigestV1(decoded);
    decoded.properties.delete('|v|');
    expect(await computeDecodedRenderFrameDigestV1(decoded)).not.toBe(withClaim);
  });

  it('rejects partial and non-finite decoded data', () => {
    expect(() => canonicalDecodedRenderFrameBytesV1(frame({
      positions: new Float32Array([0, 0, 0]),
    }))).toThrow(/every decoded atom/);
    expect(() => canonicalDecodedRenderFrameBytesV1(frame({
      positions: new Float32Array([Number.NaN, 0, 0, 1, 2, 3]),
    }))).toThrow(/must be finite/);
    expect(() => canonicalDecodedRenderFrameBytesV1(frame({
      bonds: new Int32Array([0]),
    }))).toThrow(/complete atom-index pairs/);
    expect(() => canonicalDecodedRenderFrameBytesV1(frame({
      properties: new Map([['charge', new Float32Array([0.2])]]),
    }))).toThrow(/one Float32 value per atom/);
  });
});
