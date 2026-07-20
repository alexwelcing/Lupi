import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Frame } from '@atlas/core/types';
import {
  DumpParseError,
  parseDumpBlobCanonical,
  parseDumpFramesCanonical,
  parseDumpFramesFromBytesCanonical,
} from './dumpStreamParser';

const ORTHOGONAL = `ITEM: TIMESTEP
10
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp ff
-1.0e0 9.0e0
0 10
2 12
ITEM: ATOMS id type xu yu zu vx c_pe
9 2 1.25e0 -2.5e-1 3e2 0.5 -3.2
4 1 4 5 6 -0.25 -3.1
`;

const RESTRICTED_TRICLINIC_SCALED = `ITEM: TIMESTEP
20
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS xy xz yz pp pp pp
0 13 2
2 12.5 -1
3 13 0.5
ITEM: ATOMS id type xs ys zs fx
9 2 0.25 0.5 0.75 1e-3
4 1 0 1 0.5 -2e-3
`;

const ORTHOGONAL_CARTESIAN = ORTHOGONAL.replace('xu yu zu', 'x y z');
const RESTRICTED_TRICLINIC_SCALED_UNWRAPPED = RESTRICTED_TRICLINIC_SCALED
  .replace('xs ys zs', 'xsu ysu zsu');

function bytesInChunks(text: string, chunkSize: number): AsyncIterable<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return {
    async *[Symbol.asyncIterator]() {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      }
    },
  };
}

function canonicalFrame(frame: Frame) {
  return {
    timestep: frame.timestep,
    natoms: frame.natoms,
    boxBounds: Array.from(frame.boxBounds),
    boxTilt: Array.from(frame.boxTilt),
    triclinic: frame.triclinic,
    columns: frame.columns,
    ids: Array.from(frame.ids),
    types: Array.from(frame.types),
    positions: Array.from(frame.positions),
    bonds: Array.from(frame.bonds),
    properties: Array.from(frame.properties, ([name, values]) => [name, Array.from(values)]),
    identity: frame.identity,
  };
}

async function decodeEveryRoute(text: string) {
  const progress: number[] = [];
  const plainText = await parseDumpFramesCanonical(text, {
    onFrameDecoded: (count) => progress.push(count),
  });
  const chunked = await parseDumpFramesFromBytesCanonical(bytesInChunks(text, 7));
  const local = await parseDumpBlobCanonical(new Blob([text]));
  const gzip = await parseDumpBlobCanonical(new Blob([gzipSync(text)]));
  return {
    progress,
    routes: [plainText, chunked, local, gzip].map((frames) => frames.map(canonicalFrame)),
  };
}

describe('canonical LAMMPS dump route parity', () => {
  it.each([
    ['orthogonal Cartesian with numeric properties', ORTHOGONAL_CARTESIAN],
    ['orthogonal unwrapped Cartesian with numeric properties', ORTHOGONAL],
    ['restricted-triclinic scaled coordinates', RESTRICTED_TRICLINIC_SCALED],
    ['restricted-triclinic scaled unwrapped coordinates', RESTRICTED_TRICLINIC_SCALED_UNWRAPPED],
  ])('decodes %s identically as text, chunked bytes, local Blob, and gzip', async (_label, text) => {
    const { routes, progress } = await decodeEveryRoute(text);
    for (const route of routes.slice(1)) expect(route).toEqual(routes[0]);
    expect(progress).toEqual([1]);
  });

  it('uses the official restricted-triclinic bound correction and fractional transform', async () => {
    const [frame] = await parseDumpFramesCanonical(RESTRICTED_TRICLINIC_SCALED);
    expect(frame).toBeDefined();
    expect(Array.from(frame!.boxBounds)).toEqual([0, 13, 2, 12.5, 3, 13]);
    expect(Array.from(frame!.boxTilt)).toEqual([2, -1, 0.5]);
    expect(Array.from(frame!.positions.slice(0, 3))).toEqual([3.75, 7.375, 10.5]);
  });

  it('is unchanged by harmless trailing padding', async () => {
    const base = await parseDumpFramesCanonical(ORTHOGONAL);
    const padded = await parseDumpFramesCanonical(`${ORTHOGONAL}\n\n   \t\r\n`);
    expect(padded.map(canonicalFrame)).toEqual(base.map(canonicalFrame));
  });

  it('drops an unterminated torn final row instead of creating a zero-filled atom', async () => {
    const torn = ORTHOGONAL.trimEnd().replace('4 1 4 5 6 -0.25 -3.1', '4 1 4');
    const routes = await decodeEveryRoute(torn);
    for (const route of routes.routes.slice(1)) expect(route).toEqual(routes.routes[0]);
    expect(routes.routes[0][0].natoms).toBe(1);
    expect(routes.routes[0][0].ids).toEqual([9]);
    expect(routes.routes[0][0].positions).toHaveLength(3);
  });

  it('reports completed frames monotonically without changing decode behavior', async () => {
    const progress: number[] = [];
    const frames = await parseDumpFramesCanonical(
      ORTHOGONAL + RESTRICTED_TRICLINIC_SCALED,
      { onFrameDecoded: (count) => progress.push(count) },
    );
    expect(frames).toHaveLength(2);
    expect(progress).toEqual([1, 2]);
  });

  it('preserves shuffled stable source IDs without equating row order with atom identity', async () => {
    const shuffled = ORTHOGONAL + ORTHOGONAL
      .replace('TIMESTEP\n10', 'TIMESTEP\n11')
      .replace(
        '9 2 1.25e0 -2.5e-1 3e2 0.5 -3.2\n4 1 4 5 6 -0.25 -3.1',
        '4 1 4.5 5 6 -0.25 -3.1\n9 2 1.5 -2.5e-1 3e2 0.5 -3.2',
      );
    const { routes } = await decodeEveryRoute(shuffled);
    for (const route of routes.slice(1)) expect(route).toEqual(routes[0]);
    expect(routes[0].map((frame) => frame.ids)).toEqual([[9, 4], [4, 9]]);
    expect(routes[0].map((frame) => frame.identity)).toEqual([
      { kind: 'source-id', unique: true },
      { kind: 'source-id', unique: true },
    ]);
  });

  it('generates deterministic one-based row IDs but labels them frame-local when id is absent', async () => {
    const noIds = ORTHOGONAL
      .replace('ITEM: ATOMS id type xu yu zu vx c_pe', 'ITEM: ATOMS type xu yu zu vx c_pe')
      .replace('9 2 1.25e0 -2.5e-1 3e2 0.5 -3.2', '2 1.25e0 -2.5e-1 3e2 0.5 -3.2')
      .replace('4 1 4 5 6 -0.25 -3.1', '1 4 5 6 -0.25 -3.1');
    const { routes } = await decodeEveryRoute(noIds);
    for (const route of routes.slice(1)) expect(route).toEqual(routes[0]);
    expect(routes[0][0].ids).toEqual([1, 2]);
    expect(routes[0][0].identity).toEqual({ kind: 'synthetic-row', unique: true });
  });

  it('fails every transport route closed on duplicate source IDs with typed context', async () => {
    const duplicate = ORTHOGONAL.replace('4 1 4 5 6 -0.25 -3.1', '9 1 4 5 6 -0.25 -3.1');
    const routes = [
      () => parseDumpFramesCanonical(duplicate),
      () => parseDumpFramesFromBytesCanonical(bytesInChunks(duplicate, 5)),
      () => parseDumpBlobCanonical(new Blob([duplicate])),
      () => parseDumpBlobCanonical(new Blob([gzipSync(duplicate)])),
    ];
    for (const decode of routes) {
      await expect(decode()).rejects.toMatchObject({
        name: 'DumpParseError',
        code: 'DUPLICATE_ATOM_ID',
        frameIndex: 0,
        timestep: 10,
        atomRow: 2,
        atomId: 9,
      } satisfies Partial<DumpParseError>);
    }
  });

  it.each(['-1', '0', '4.5', '1e0', 'NaN', '2147483648'])(
    'rejects invalid integer source ID %s instead of truncating it',
    async (invalidId) => {
      const invalid = ORTHOGONAL.replace('4 1 4 5 6 -0.25 -3.1', `${invalidId} 1 4 5 6 -0.25 -3.1`);
      await expect(parseDumpFramesCanonical(invalid)).rejects.toMatchObject({
        name: 'DumpParseError',
        code: 'INVALID_ATOM_ID',
        atomRow: 2,
      } satisfies Partial<DumpParseError>);
    },
  );
});
