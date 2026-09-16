/**
 * Parser Worker — Off-main-thread LAMMPS file parsing via WASM
 * 
 * Receives: { type: 'parse-dump' | 'parse-log', payload: string }
 * Sends:    { type: 'frames' | 'thermo' | 'progress' | 'error', ... }
 */
// @ts-nocheck

import init, { parseLog } from 'atlas-parsers';
import { parseXyzBytes } from '../xyzParser';
import { parseLammpsDataBytes } from '../lammpsDataParser';
import {
  parseDumpBlobCanonical,
  parseDumpFramesCanonical,
  serializeDumpParseError,
} from '../dumpStreamParser';
import {
  extractFrameDistanceSemantics,
  extractFrameIdentity,
  extractFrameProperties,
  extractFrameTypeSemantics,
  lammpsDataSemantics,
} from './frameTransfer';

let wasmReady = false;

async function ensureWasm() {
  if (!wasmReady) {
    await init();
    wasmReady = true;
  }
}

/** Concatenate decompressed chunks with one linear copy. (The previous
 * implementation rebuilt the buffer byte by byte, scanning the chunk list for
 * every byte — quadratic in file size, minutes for a 100 MB gzip.) */
function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function assertNotHtml(head: string): void {
  const lower = head.trim().toLowerCase();
  if (lower.startsWith('<html') || lower.startsWith('<!doctype html>')) {
    throw new Error('Received HTML instead of molecular data (file not found on server).');
  }
}

/** Read a File object as raw bytes (gzip-aware). No JS string is created for
 * the body, which matters for large XYZ files: a string costs 2 bytes per
 * character in V8 once any non-Latin1 character appears and cannot be
 * transferred. */
async function readFileAsBytes(file: File | string): Promise<Uint8Array> {
  if (typeof file === 'string') return new TextEncoder().encode(file);
  if (file.name.endsWith('.gz')) {
    const ds = new DecompressionStream('gzip');
    const reader = file.stream().pipeThrough(ds).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return concatChunks(chunks);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  assertNotHtml(new TextDecoder().decode(bytes.subarray(0, 64)));
  return bytes;
}

/** Read a File object as text */
async function readFileAsText(file: File): Promise<string> {
  // For gzipped files, decompress first
  if (file.name.endsWith('.gz')) {
    return new TextDecoder().decode(await readFileAsBytes(file));
  }
  const text = await file.text();
  assertNotHtml(text.slice(0, 64));
  return text;
}

/** Per-frame bounds and unique types, computed here so the main thread never
 * rescans every atom of every frame after hydration. */
function frameStats(positions: Float32Array, types: Int32Array, natoms: number) {
  const count = Math.min(natoms, Math.floor(positions.length / 3), types.length);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const typeSet = new Set<number>();
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    typeSet.add(types[i]);
  }
  return {
    bounds: [minX, maxX, minY, maxY, minZ, maxZ],
    types: Array.from(typeSet).sort((a, b) => a - b),
  };
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    if (type === 'parse-dump') {
      const file = payload as File;
      self.postMessage({ type: 'progress', id, total: 0, parsed: 0 });
      const onFrameDecoded = (parsed: number) => {
        self.postMessage({ type: 'progress', id, total: 0, parsed });
      };
      const frames = typeof file === 'string'
        ? await parseDumpFramesCanonical(file, { onFrameDecoded })
        : await parseDumpBlobCanonical(file, { onFrameDecoded });
      const totalFrames = frames.length;

      // Transform WASM output to transferable typed arrays
      const transferables: Transferable[] = [];
      const result = frames.map((f: any, i: number) => {
        self.postMessage({ type: 'progress', id, total: totalFrames, parsed: i + 1 });
        const positions = f.positions;
        const ids = f.ids;
        const types = f.types;
        const bonds = f.bonds;
        const properties = extractFrameProperties(f, transferables);

        if (positions && positions.buffer) transferables.push(positions.buffer);
        if (ids && ids.buffer) transferables.push(ids.buffer);
        if (types && types.buffer) transferables.push(types.buffer);
        if (bonds && bonds.buffer) transferables.push(bonds.buffer);

        return {
          timestep: f.timestep,
          natoms: f.natoms,
          boxBounds: f.boxBounds || f.box_bounds,
          boxTilt: f.boxTilt || f.box_tilt,
          triclinic: f.triclinic,
          columns: f.columns,
          ids,
          types,
          positions,
          bonds,
          properties,
          identity: extractFrameIdentity(f),
          typeSemantics: extractFrameTypeSemantics(f),
          distanceSemantics: extractFrameDistanceSemantics(f),
          stats: frameStats(positions, types, f.natoms),
        };
      });

      self.postMessage({ type: 'frames', id, frames: result }, transferables);

    } else if (type === 'parse-data') {
      // Pure TypeScript byte-level parser (port of wasm/src/data.rs): no WASM
      // init, no whole-file string, typed arrays from the first write.
      const bytes = await readFileAsBytes(payload as File | string);
      const parsed = parseLammpsDataBytes(bytes);
      const f = parsed.frame;
      const semantics = lammpsDataSemantics(parsed.hasCompleteMassMapping);
      const transferables: Transferable[] = [];
      const properties = extractFrameProperties(f, transferables);
      transferables.push(f.positions.buffer, f.ids.buffer, f.types.buffer, f.bonds.buffer);

      self.postMessage({ type: 'frames', id, frames: [{
          timestep: f.timestep,
          natoms: f.natoms,
          boxBounds: f.boxBounds,
          boxTilt: f.boxTilt,
          triclinic: f.triclinic,
          columns: f.columns,
          ids: f.ids,
          types: f.types,
          positions: f.positions,
          bonds: f.bonds,
          properties,
          identity: extractFrameIdentity(f),
          ...semantics,
          stats: parsed.stats,
      }]}, transferables);

    } else if (type === 'parse-xyz') {
      // Pure TypeScript byte-level parser: no WASM init, no whole-file string,
      // typed arrays from the first write, buffers transferred zero-copy.
      const bytes = await readFileAsBytes(payload as File | string);
      self.postMessage({ type: 'progress', id, total: 0, parsed: 0 });
      const parsed = parseXyzBytes(bytes, {
        onFrame: (index) => self.postMessage({ type: 'progress', id, total: 0, parsed: index + 1 }),
      });

      const transferables: Transferable[] = [];
      const result = parsed.frames.map((f, index) => {
        const properties = extractFrameProperties(f, transferables);
        transferables.push(f.positions.buffer, f.ids.buffer, f.types.buffer, f.bonds.buffer);
        return {
          timestep: f.timestep,
          natoms: f.natoms,
          boxBounds: f.boxBounds,
          boxTilt: f.boxTilt,
          triclinic: f.triclinic,
          columns: f.columns,
          ids: f.ids,
          types: f.types,
          positions: f.positions,
          bonds: f.bonds,
          properties,
          identity: f.identity,
          typeSemantics: f.typeSemantics,
          distanceSemantics: f.distanceSemantics,
          stats: parsed.stats[index],
        };
      });

      self.postMessage({ type: 'frames', id, frames: result }, transferables);

    } else if (type === 'parse-log') {
      await ensureWasm();
      const file = payload as File;
      const content = typeof file === 'string' ? file : await readFileAsText(file);
      const thermo = parseLog(content);

      const runs = [];
      for (let r = 0; r < thermo.num_runs; r++) {
        const columns = thermo.getColumns(r);
        const colNames = columns.map((c: any) => String(c));
        const colData: Record<string, Float64Array> = {};
        for (const name of colNames) {
          const data = thermo.getColumn(r, name);
          if (data) colData[name] = data;
        }
        runs.push({ columns: colNames, data: colData, nrows: thermo.getRunLength(r) });
      }

      self.postMessage({ type: 'thermo', id, runs });
    }
  } catch (err: any) {
    const typed = serializeDumpParseError(err);
    self.postMessage({
      type: 'error',
      id,
      message: err.message || String(err),
      ...(typed ?? {}),
    });
  }
};
