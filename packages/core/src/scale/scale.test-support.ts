/// <reference types="node" />
// Shared by the scale tests: massive_1m.glimbin's first frame, decoded with
// the web's glimbin reader and baked once per test process.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseFrameData, parseFrameIndex, parseHeader } from '../glimbin';
import { writePack } from './pack';
import { bakePartition, type PartitionResult } from './partition';

export const MASSIVE_1M = join(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/public/gallery/trajectories/massive_1m.glimbin');

export function readGlimbinFirstFrame(file: string): { z: Uint8Array; positions: Float32Array } {
  const bytes = readFileSync(file);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const header = parseHeader(buf);
  const index = parseFrameIndex(buf.slice(Number(header.frameIndexOffset)), header.totalFrames);
  const entry = index.entries[0];
  let raw = buf.slice(Number(entry.offset), Number(entry.offset) + entry.compressedSize);
  if (header.compressed) {
    const inflated = gunzipSync(new Uint8Array(raw));
    raw = inflated.buffer.slice(inflated.byteOffset, inflated.byteOffset + inflated.byteLength);
  }
  const frame = parseFrameData(raw, entry.natoms, header.flags);
  return { z: Uint8Array.from(frame.types), positions: Float32Array.from(frame.positions) };
}

export interface Massive1m {
  z: Uint8Array;
  positions: Float32Array;
  part: PartitionResult;
  pack: Uint8Array;
  bakeMs: number;
}

let cached: Promise<Massive1m> | null = null;

export function loadMassive1m(): Promise<Massive1m> {
  cached ??= Promise.resolve().then(() => {
    const { z, positions } = readGlimbinFirstFrame(MASSIVE_1M);
    const t0 = performance.now();
    const part = bakePartition(z, positions);
    const bakeMs = performance.now() - t0;
    const pack = writePack(part.records, { roots: [{ name: 'massive_1m', id: part.root }] });
    return { z, positions, part, pack, bakeMs };
  });
  return cached;
}
