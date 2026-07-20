import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  FLAG_COMPRESSED,
  FLAG_LITTLE_ENDIAN,
  FRAME_ENTRY_SIZE,
  HEADER_SIZE,
  writeFrameData,
  writeFrameIndex,
  writeHeader,
} from '@atlas/core/glimbin';
import type { Frame } from '@atlas/core/types';
import { LocalGlimbinSource } from './LocalGlimbinSource';

const FLAGS = FLAG_LITTLE_ENDIAN | FLAG_COMPRESSED;

function makeFrame(natoms = 2): Frame {
  return {
    timestep: 0,
    natoms,
    boxBounds: new Float64Array([0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: Int32Array.from({ length: natoms }, (_, index) => index + 1),
    types: Int32Array.from({ length: natoms }, (_, index) => (index % 2) + 1),
    positions: Float32Array.from({ length: natoms * 3 }, (_, index) => index / 3),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

function makeRawFrameBytes(): Uint8Array {
  return new Uint8Array(writeFrameData(makeFrame(), FLAGS));
}

function makeEqualSizeRawFrameBytes(): { bytes: Uint8Array; natoms: number } {
  const natoms = 29;
  const rawLength = 16 * natoms + ((natoms + 3) & ~3);
  const bytes = new Uint8Array(rawLength);
  let state = 82;
  for (let index = 0; index < bytes.length; index++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    bytes[index] = state >>> 24;
  }
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < natoms; index++) view.setInt32(index * 4, index + 1, true);
  const typesOffset = natoms * 4;
  for (let index = 0; index < natoms; index++) bytes[typesOffset + index] = (index % 2) + 1;
  return { bytes, natoms };
}

function buildFixture(frameBytes: Uint8Array, rawSize: number, natoms = 2): Blob {
  const frameStart = HEADER_SIZE;
  const indexStart = frameStart + frameBytes.byteLength;
  const header = writeHeader({
    version: 2,
    flags: FLAGS,
    totalFrames: 1,
    atomsPerFrame: natoms,
    atomTypes: [1, 2],
    globalBounds: { min: [0, 0, 0], max: [10, 10, 10] },
    boxBounds: new Float64Array([0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    unitStyle: 0,
    frameIndexOffset: BigInt(indexStart),
  });
  const index = writeFrameIndex([{
    offset: BigInt(frameStart),
    compressedSize: frameBytes.byteLength,
    rawSize,
    timestep: 0,
    natoms,
  }]);
  const file = new Uint8Array(indexStart + FRAME_ENTRY_SIZE);
  file.set(new Uint8Array(header));
  file.set(frameBytes, frameStart);
  file.set(new Uint8Array(index), indexStart);
  return new Blob([file]);
}

async function openSource(blob: Blob, events: ConstructorParameters<typeof LocalGlimbinSource>[1] = {}) {
  const source = new LocalGlimbinSource(blob, events);
  await source.open();
  return source;
}

describe('LocalGlimbinSource compressed frames', () => {
  it('decodes gzip successfully', async () => {
    const raw = makeRawFrameBytes();
    const source = await openSource(buildFixture(new Uint8Array(gzipSync(raw)), raw.byteLength));
    const frame = await source.fetchFrame(0);
    expect(Array.from(frame.ids)).toEqual([1, 2]);
  });

  it.each([
    ['bad magic', new Uint8Array(36), /gzip framing/i],
    ['malformed gzip', new Uint8Array([0x1f, 0x8b, 0x08, 0, 1, 2, 3, 4]), /gzip decoding/i],
    ['zstd-shaped input', new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3, 4]), /zstd/i],
  ])('rejects %s and neither emits nor caches', async (_name, encoded, message) => {
    const onError = vi.fn();
    const onFrame = vi.fn();
    const source = await openSource(buildFixture(encoded, 36), { onError, onFrame });
    await expect(source.fetchFrame(0)).rejects.toThrow(message);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onFrame).not.toHaveBeenCalled();
    expect(source.isCached(0)).toBe(false);
  });

  it('rejects a decoded raw-size mismatch', async () => {
    const raw = makeRawFrameBytes();
    const source = await openSource(
      buildFixture(new Uint8Array(gzipSync(raw)), raw.byteLength + 1),
    );
    await expect(source.fetchFrame(0)).rejects.toThrow(/expected .* raw bytes/i);
    expect(source.isCached(0)).toBe(false);
  });

  it('decodes valid gzip when compressedSize equals rawSize', async () => {
    const { bytes: raw, natoms } = makeEqualSizeRawFrameBytes();
    const encoded = new Uint8Array(gzipSync(raw, { level: 9 }));
    expect(encoded.byteLength).toBe(raw.byteLength);
    const source = await openSource(buildFixture(encoded, raw.byteLength, natoms));
    const frame = await source.fetchFrame(0);
    expect(frame.natoms).toBe(natoms);
    expect(Array.from(frame.ids.slice(0, 4))).toEqual([1, 2, 3, 4]);
  });

  it('rejects equal-size invalid compressed bytes instead of treating them as raw', async () => {
    const raw = makeRawFrameBytes();
    const source = await openSource(buildFixture(new Uint8Array(raw.byteLength), raw.byteLength));
    await expect(source.fetchFrame(0)).rejects.toThrow(/gzip framing/i);
    expect(source.isCached(0)).toBe(false);
  });
});
