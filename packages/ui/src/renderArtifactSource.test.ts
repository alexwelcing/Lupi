import { describe, expect, it } from 'vitest';
import { detectFrameVectorFields, ensureVectorMagnitude, type Frame } from '@atlas/core';
import {
  canonicalDecodedRenderFrameBytesV1,
  canonicalDecodedRenderFrameBytesV2,
  canonicalDecodedRenderFrameBytesV3,
  computeDecodedRenderFrameDigestV1,
  computeDecodedRenderFrameDigestV2,
  computeDecodedRenderFrameDigestV3,
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
    const sourceOrder = frame({ identity: { kind: 'source-order', unique: true } });
    const synthetic = frame({ identity: { kind: 'synthetic-row', unique: true } });
    const unknown = frame({ identity: { kind: 'unknown', unique: false } });
    const legacyMissing = frame({ identity: undefined });

    expect(canonicalDecodedRenderFrameBytesV1(source)).toEqual(
      canonicalDecodedRenderFrameBytesV1(synthetic),
    );
    expect(await computeDecodedRenderFrameDigestV2(source)).not.toBe(
      await computeDecodedRenderFrameDigestV2(synthetic),
    );
    expect(await computeDecodedRenderFrameDigestV2(source)).not.toBe(
      await computeDecodedRenderFrameDigestV2(sourceOrder),
    );
    expect(await computeDecodedRenderFrameDigestV2(synthetic)).not.toBe(
      await computeDecodedRenderFrameDigestV2(unknown),
    );
    expect(canonicalDecodedRenderFrameBytesV2(legacyMissing)).toEqual(
      canonicalDecodedRenderFrameBytesV2(unknown),
    );
  });

  it('keeps V2 immutable while V3 binds atom-type kind and provenance', async () => {
    const sourceSymbols = frame({
      typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
    });
    const proceduralSymbols = frame({
      typeSemantics: { kind: 'atomic-number', provenance: 'procedural-symbol' },
    });
    const mapped = frame({
      typeSemantics: {
        kind: 'explicit-element-map',
        provenance: 'user-type-map',
        elementMap: { 6: 6, 8: 8 },
      },
    });

    expect(canonicalDecodedRenderFrameBytesV1(sourceSymbols)).toEqual(
      canonicalDecodedRenderFrameBytesV1(proceduralSymbols),
    );
    expect(await computeDecodedRenderFrameDigestV2(sourceSymbols)).toBe(
      await computeDecodedRenderFrameDigestV2(proceduralSymbols),
    );
    expect(await computeDecodedRenderFrameDigestV3(sourceSymbols)).not.toBe(
      await computeDecodedRenderFrameDigestV3(proceduralSymbols),
    );
    expect(await computeDecodedRenderFrameDigestV3(sourceSymbols)).not.toBe(
      await computeDecodedRenderFrameDigestV3(mapped),
    );
  });

  it('sorts explicit element maps and hashes their declared mapping', async () => {
    const left = frame({
      typeSemantics: {
        kind: 'explicit-element-map',
        provenance: 'user-type-map',
        elementMap: Object.fromEntries([[10, 6], [-2, 8]]),
      },
    });
    const reordered = frame({
      typeSemantics: {
        kind: 'explicit-element-map',
        provenance: 'user-type-map',
        elementMap: Object.fromEntries([[-2, 8], [10, 6]]),
      },
    });
    const changed = frame({
      typeSemantics: {
        kind: 'explicit-element-map',
        provenance: 'user-type-map',
        elementMap: Object.fromEntries([[-2, 7], [10, 6]]),
      },
    });

    expect(canonicalDecodedRenderFrameBytesV3(left)).toEqual(
      canonicalDecodedRenderFrameBytesV3(reordered),
    );
    expect(await computeDecodedRenderFrameDigestV3(left)).not.toBe(
      await computeDecodedRenderFrameDigestV3(changed),
    );
  });

  it('V3 binds distance kind and provenance', async () => {
    const declared = frame({
      distanceSemantics: { kind: 'angstrom', provenance: 'source-declared' },
    });
    const conventional = frame({
      distanceSemantics: { kind: 'angstrom', provenance: 'format-convention' },
    });
    const unknown = frame({
      distanceSemantics: { kind: 'unknown', provenance: 'lammps-dump' },
    });

    expect(canonicalDecodedRenderFrameBytesV1(declared)).toEqual(
      canonicalDecodedRenderFrameBytesV1(unknown),
    );
    expect(await computeDecodedRenderFrameDigestV2(declared)).toBe(
      await computeDecodedRenderFrameDigestV2(conventional),
    );
    expect(await computeDecodedRenderFrameDigestV3(declared)).not.toBe(
      await computeDecodedRenderFrameDigestV3(conventional),
    );
    expect(await computeDecodedRenderFrameDigestV3(declared)).not.toBe(
      await computeDecodedRenderFrameDigestV3(unknown),
    );
  });

  it('normalizes missing semantics exactly to explicit legacy opaque and unknown', async () => {
    const missing = frame({
      identity: { kind: 'source-id', unique: true },
      typeSemantics: undefined,
      distanceSemantics: undefined,
    });
    const explicitLegacy = frame({
      identity: { kind: 'source-id', unique: true },
      typeSemantics: { kind: 'opaque', provenance: 'legacy-unknown' },
      distanceSemantics: { kind: 'unknown', provenance: 'legacy-unknown' },
    });

    expect(canonicalDecodedRenderFrameBytesV3(missing)).toEqual(
      canonicalDecodedRenderFrameBytesV3(explicitLegacy),
    );
    expect(await computeDecodedRenderFrameDigestV3(missing)).toBe(
      await computeDecodedRenderFrameDigestV3(explicitLegacy),
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
