import { afterEach, describe, expect, it, vi } from 'vitest';
import { assembleGlimbinBlob } from '@atlas/core/glimbin';
import type { Frame, Trajectory } from '@atlas/core/types';
import { LocalGlimbinSource } from './LocalGlimbinSource';
import { StreamingLoader } from './StreamingLoader';

function makeFrame(
  timestep: number,
  boxBounds: number[],
  boxTilt: number[],
  positionBase: number,
): Frame {
  return {
    timestep,
    natoms: 2,
    boxBounds: new Float64Array(boxBounds),
    boxTilt: new Float64Array(boxTilt),
    triclinic: boxTilt.some((value) => value !== 0),
    columns: ['id', 'type', 'x', 'y', 'z', 'vx'],
    ids: new Int32Array([11, 4]),
    types: new Int32Array([2, 1]),
    positions: new Float32Array([
      positionBase, positionBase + 1, positionBase + 2,
      positionBase + 3, positionBase + 4, positionBase + 5,
    ]),
    bonds: new Int32Array(0),
    properties: new Map([['vx', new Float32Array([positionBase / 10, -positionBase / 10])]]),
    identity: { kind: 'source-id', unique: true },
  };
}

function makeNptTrajectory(): Trajectory & { frames: Frame[] } {
  const frames = [
    makeFrame(0, [0, 10, 0, 10, 0, 10], [1.5, 0.5, 0.25], 1),
    makeFrame(50, [-1, 11, 0.5, 9.5, -0.5, 10.5], [-1.75, 0.25, -0.5], 2),
    makeFrame(100, [-2, 12, 1, 9, -1, 11], [0.2, -0.3, 0.4], 3),
  ];
  return {
    frames,
    totalFrames: frames.length,
    atomTypes: [1, 2],
    globalBounds: { min: [-2, -1, -1], max: [12, 11, 11] },
  };
}

function installRangeFetch(file: Uint8Array) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'HEAD') {
      return new Response(null, { headers: { 'Content-Length': String(file.byteLength) } });
    }
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
    if (!match) throw new Error('test server expected a byte Range request');
    const start = Number(match[1]);
    const end = Number(match[2]);
    const body = file.slice(start, end + 1);
    return new Response(body, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(body.byteLength),
        'Content-Range': `bytes ${start}-${end}/${file.byteLength}`,
      },
    });
  }));
}

function expectSameScientificFrame(remote: Frame, local: Frame) {
  expect(remote.timestep).toBe(local.timestep);
  expect(remote.natoms).toBe(local.natoms);
  expect(Array.from(remote.boxBounds)).toEqual(Array.from(local.boxBounds));
  expect(Array.from(remote.boxTilt)).toEqual(Array.from(local.boxTilt));
  expect(remote.triclinic).toBe(local.triclinic);
  expect(remote.columns).toEqual(local.columns);
  expect(Array.from(remote.ids)).toEqual(Array.from(local.ids));
  expect(Array.from(remote.types)).toEqual(Array.from(local.types));
  expect(Array.from(remote.positions)).toEqual(Array.from(local.positions));
  expect(Array.from(remote.bonds)).toEqual(Array.from(local.bonds));
  expect(remote.identity).toEqual(local.identity);
  expect(Array.from(remote.properties.keys())).toEqual(Array.from(local.properties.keys()));
  for (const [name, values] of local.properties) {
    expect(Array.from(remote.properties.get(name) ?? [])).toEqual(Array.from(values));
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('remote GLIMBIN per-frame cell parity', () => {
  it('matches the local v2 reader across a deforming NPT cell and tilt flip', async () => {
    const trajectory = makeNptTrajectory();
    const { blob } = assembleGlimbinBlob(trajectory);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    installRangeFetch(bytes);

    const local = new LocalGlimbinSource(blob);
    await local.open();
    const remote = new StreamingLoader('https://example.test/npt.glimbin');
    await remote.fetchHeader();
    await remote.fetchIndex();

    for (let frameIndex = 0; frameIndex < trajectory.totalFrames; frameIndex += 1) {
      expectSameScientificFrame(
        await remote.fetchFrame(frameIndex),
        await local.fetchFrame(frameIndex),
      );
      expect((await remote.fetchFrame(frameIndex)).identity).toEqual(
        trajectory.frames[frameIndex].identity,
      );
    }

    const first = await remote.fetchFrame(0);
    const second = await remote.fetchFrame(1);
    expect(Array.from(second.boxBounds)).not.toEqual(Array.from(first.boxBounds));
    expect(Array.from(second.boxTilt)).not.toEqual(Array.from(first.boxTilt));
    local.dispose();
    remote.dispose();
  });
});
