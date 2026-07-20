import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { decompressGlimbinFrame } from './decompressGlimbinFrame';
import { StreamingLoader } from './StreamingLoader';

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

function makeRawFrameBytes(frame = makeFrame()): Uint8Array {
  return new Uint8Array(writeFrameData(frame, FLAGS));
}

/** A deterministic, valid 29-atom frame whose level-9 gzip is 496 bytes,
 * exactly equal to the raw record length. */
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

function buildFixture(
  frameBytes: Uint8Array,
  declaredRawSize: number,
  natoms = 2,
): Uint8Array {
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
    rawSize: declaredRawSize,
    timestep: 0,
    natoms,
  }]);
  const file = new Uint8Array(indexStart + FRAME_ENTRY_SIZE);
  file.set(new Uint8Array(header), 0);
  file.set(frameBytes, frameStart);
  file.set(new Uint8Array(index), indexStart);
  return file;
}

function installFetchMock(file: Uint8Array): void {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    if (init?.method === 'HEAD') {
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => name === 'Content-Length' ? String(file.byteLength) : null },
      } as unknown as Response;
    }
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    const match = /bytes=(\d+)-(\d+)/.exec(range ?? '');
    if (!match) throw new Error('test fetch mock: missing Range header');
    const slice = file.slice(Number(match[1]), Number(match[2]) + 1);
    return {
      ok: true,
      status: 206,
      statusText: 'Partial Content',
      arrayBuffer: async () => slice.buffer,
    } as unknown as Response;
  }));
}

async function openLoader(file: Uint8Array, events: ConstructorParameters<typeof StreamingLoader>[1] = {}) {
  installFetchMock(file);
  const loader = new StreamingLoader('https://example.test/data.glimbin', events);
  await loader.fetchHeader();
  await loader.fetchIndex();
  return loader;
}

afterEach(() => vi.unstubAllGlobals());

describe('StreamingLoader compressed frames', () => {
  it('bounds declared and decoded raw frame sizes before allocating untrusted output', async () => {
    const encoded = new Uint8Array(gzipSync(new Uint8Array(1024)));
    await expect(decompressGlimbinFrame(encoded.buffer, 512 * 1024 * 1024 + 1))
      .rejects.toThrow(/invalid glimbin raw frame size/i);
    await expect(decompressGlimbinFrame(encoded.buffer, 1))
      .rejects.toThrow(/exceeded its declared raw size/i);
  });

  it('decodes gzip and emits/caches the parsed frame', async () => {
    const raw = makeRawFrameBytes();
    const encoded = new Uint8Array(gzipSync(raw));
    const onError = vi.fn();
    const onFrame = vi.fn();
    const loader = await openLoader(buildFixture(encoded, raw.byteLength), { onError, onFrame });

    const frame = await loader.fetchFrame(0);

    expect(Array.from(frame.ids)).toEqual([1, 2]);
    expect(Array.from(frame.positions)).toEqual(Array.from(makeFrame().positions));
    expect(onError).not.toHaveBeenCalled();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(loader.isCached(0)).toBe(true);
  });

  it.each([
    ['bad magic', new Uint8Array(36), /gzip framing/i],
    ['malformed gzip', new Uint8Array([0x1f, 0x8b, 0x08, 0, 1, 2, 3, 4]), /gzip decoding/i],
    ['zstd-shaped input', new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3, 4]), /zstd/i],
  ])('rejects %s, reports once, and never emits or caches', async (_name, encoded, message) => {
    const onError = vi.fn();
    const onFrame = vi.fn();
    const loader = await openLoader(buildFixture(encoded, 36), { onError, onFrame });

    await expect(loader.fetchFrame(0)).rejects.toThrow(message);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onFrame).not.toHaveBeenCalled();
    expect(loader.isCached(0)).toBe(false);
  });

  it('rejects a decoded raw-size mismatch without emitting or caching', async () => {
    const raw = makeRawFrameBytes();
    const onError = vi.fn();
    const onFrame = vi.fn();
    const loader = await openLoader(
      buildFixture(new Uint8Array(gzipSync(raw)), raw.byteLength + 1),
      { onError, onFrame },
    );

    await expect(loader.fetchFrame(0)).rejects.toThrow(/expected .* raw bytes/i);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onFrame).not.toHaveBeenCalled();
    expect(loader.isCached(0)).toBe(false);
  });

  it('decodes valid gzip even when compressedSize equals rawSize', async () => {
    const { bytes: raw, natoms } = makeEqualSizeRawFrameBytes();
    const encoded = new Uint8Array(gzipSync(raw, { level: 9 }));
    expect(encoded.byteLength).toBe(raw.byteLength);
    const loader = await openLoader(buildFixture(encoded, raw.byteLength, natoms));

    const frame = await loader.fetchFrame(0);

    expect(frame.natoms).toBe(natoms);
    expect(Array.from(frame.ids.slice(0, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(frame.types.slice(0, 4))).toEqual([1, 2, 1, 2]);
  });

  it('rejects equal-size declared-compressed bytes instead of treating them as raw', async () => {
    const raw = makeRawFrameBytes();
    const invalid = new Uint8Array(raw.byteLength);
    const loader = await openLoader(buildFixture(invalid, invalid.byteLength));

    await expect(loader.fetchFrame(0)).rejects.toThrow(/gzip framing/i);
    expect(loader.isCached(0)).toBe(false);
  });

  it('preserves abort cancellation without reporting corrupt data', async () => {
    const raw = makeRawFrameBytes();
    const onError = vi.fn();
    const onFrame = vi.fn();
    const loader = await openLoader(buildFixture(new Uint8Array(gzipSync(raw)), raw.byteLength), {
      onError,
      onFrame,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(loader.fetchFrame(0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(onError).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
    expect(loader.isCached(0)).toBe(false);
  });

  it('observes malformed-stream writer and reader failures without an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      const encoded = new Uint8Array([0x1f, 0x8b, 0x08, 0, 1, 2, 3, 4]);
      const loader = await openLoader(buildFixture(encoded, 36));
      await expect(loader.fetchFrame(0)).rejects.toThrow(/gzip decoding/i);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });
});
