/**
 * Parser Worker — Off-main-thread LAMMPS file parsing via WASM
 * 
 * Receives: { type: 'parse-dump' | 'parse-log', payload: string }
 * Sends:    { type: 'frames' | 'thermo' | 'progress' | 'error', ... }
 */
// @ts-nocheck

import init, {
  parseLog,
  parseDataFile,
  parseXyzFile,
} from 'atlas-parsers';
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
  xyzFrameMetadata,
} from './frameTransfer';

let wasmReady = false;

async function ensureWasm() {
  if (!wasmReady) {
    await init();
    wasmReady = true;
  }
}

/** Read a File object as text */
async function readFileAsText(file: File): Promise<string> {
  // For gzipped files, decompress first
  if (file.name.endsWith('.gz')) {
    const buffer = await file.arrayBuffer();
    const ds = new DecompressionStream('gzip');
    const reader = new Blob([buffer]).stream().pipeThrough(ds).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return new TextDecoder().decode(
      new Uint8Array(chunks.reduce((a, c) => a + c.length, 0)).map((_, i) => {
        let offset = 0;
        for (const chunk of chunks) {
          if (i < offset + chunk.length) return chunk[i - offset];
          offset += chunk.length;
        }
        return 0;
      })
    );
  }
  const text = await file.text();
  if (text.trim().toLowerCase().startsWith('<html') || text.trim().toLowerCase().startsWith('<!doctype html>')) {
    throw new Error('Received HTML instead of molecular data (file not found on server).');
  }
  return text;
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
        };
      });

      self.postMessage({ type: 'frames', id, frames: result }, transferables);

    } else if (type === 'parse-data') {
      await ensureWasm();
      const file = payload as File;
      const content = typeof file === 'string' ? file : await readFileAsText(file);
      const f = parseDataFile(content);
      
      const transferables: Transferable[] = [];
      const positions = f.positions;
      const ids = f.ids;
      const types = f.types;
      const bonds = f.bonds;
      const properties = extractFrameProperties(f, transferables);
      const hasCompleteMassMapping = properties.some((property) => property.name === 'type_id');
      const semantics = lammpsDataSemantics(hasCompleteMassMapping);

      if (positions && positions.buffer) transferables.push(positions.buffer);
      if (ids && ids.buffer) transferables.push(ids.buffer);
      if (types && types.buffer) transferables.push(types.buffer);
      if (bonds && bonds.buffer) transferables.push(bonds.buffer);

      self.postMessage({ type: 'frames', id, frames: [{
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
          ...semantics,
      }]}, transferables);

    } else if (type === 'parse-xyz') {
      await ensureWasm();
      const file = payload as File;
      const content = typeof file === 'string' ? file : await readFileAsText(file);
      const frames = parseXyzFile(content);
      const metadata = xyzFrameMetadata();

      const transferables: Transferable[] = [];
      const result = frames.map((f: any) => {
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
          ...metadata,
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
