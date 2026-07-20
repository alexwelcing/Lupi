import { afterEach, describe, expect, it, vi } from 'vitest';
import { assembleGlimbinBlob } from '@atlas/core/glimbin';
import type { Frame, Trajectory } from '@atlas/core/types';
import { StreamingLoader } from './StreamingLoader';

function makeTrajectory(): Trajectory & { frames: Frame[] } {
  const frame: Frame = {
    timestep: 25,
    natoms: 2,
    boxBounds: new Float64Array([0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array([1, 2]),
    types: new Int32Array([1, 2]),
    positions: new Float32Array([1, 2, 3, 4, 5, 6]),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
  return {
    frames: [frame],
    totalFrames: 1,
    atomTypes: [1, 2],
    globalBounds: { min: [0, 0, 0], max: [10, 10, 10] },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('StreamingLoader bounded non-Range fallback', () => {
  it('accepts and reuses a full HTTP-200 body when it is under the configured cap', async () => {
    const { blob } = assembleGlimbinBlob(makeTrajectory());
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { headers: { 'Content-Length': String(bytes.byteLength) } });
      }
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Length': String(bytes.byteLength),
          'Accept-Ranges': 'none',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const loader = new StreamingLoader(
      'https://example.test/small.glimbin',
      {},
      4,
      {},
      bytes.byteLength,
    );
    await loader.fetchHeader();
    await loader.fetchIndex();
    const frame = await loader.fetchFrame(0);

    expect(Array.from(frame.positions)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    loader.dispose();
  });

  it('rejects an advertised oversized HTTP-200 body before reading or caching it', async () => {
    const readBody = vi.fn(async () => new ArrayBuffer(1024));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return {
          redirected: false,
          headers: { get: (name: string) => name === 'Content-Length' ? '1024' : null },
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        redirected: false,
        headers: {
          get: (name: string) => name === 'Content-Length'
            ? '1024'
            : name === 'Accept-Ranges' ? 'none' : null,
        },
        body: null,
        arrayBuffer: readBody,
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const secretUrl = 'https://example.test/large.glimbin?token=do-not-leak';
    const loader = new StreamingLoader(secretUrl, {}, 4, {}, 256);
    let message = '';
    try {
      await loader.fetchHeader();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/HTTP 200 without a usable byte range/i);
    expect(message).toMatch(/capped at 256 bytes/i);
    expect(message).toMatch(/enable HTTP Range requests/i);
    expect(message).not.toContain('do-not-leak');
    expect(readBody).not.toHaveBeenCalled();
  });

  it('stops a lengthless HTTP-200 stream as soon as the cap is crossed', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(128));
        if (pulls >= 8) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null);
      }
      return new Response(body, { status: 200, headers: { 'Accept-Ranges': 'none' } });
    }));

    const loader = new StreamingLoader('https://example.test/no-length.glimbin', {}, 4, {}, 256);
    await expect(loader.fetchHeader()).rejects.toThrow(/without a usable byte range/i);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(8);
  });
});
