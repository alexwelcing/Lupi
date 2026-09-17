/**
 * PubChem fast path — type-ahead names and direct compound loads with no
 * viewer/MCP dependency, so the landing page (which must not import the 3D
 * stack) can drop a visitor straight into any of PubChem's 100M+ compounds.
 *
 *   - `pubchemAutocomplete(prefix)`: PubChem's dictionary autocomplete
 *     endpoint returns matching compound names for a 2-3 letter prefix in a
 *     single round trip.
 *   - `fetchPubChemCompound(name | cid)`: the PUG REST JSON record (3D
 *     conformer first, 2D fallback) parsed straight into a viewer `Frame`,
 *     including PubChem's own bond list as source topology.
 *   - `openPubChemMolecule(name)`: load it into the store and reflect the
 *     compound in the URL (`?molecule=<name>`), the same deep link the
 *     viewer restores on reload.
 */

import type { Frame, Trajectory } from '@atlas/core/types';
import { getElementSpec } from '@atlas/core';
import { useStore, type LoadedFile } from '../store';
import { track, ANALYTICS_EVENTS } from '../analytics';

const PUG = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const AUTOCOMPLETE = 'https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound';
const BOUNDS_PAD = 2.0;

/** Approximate public compound count, for the "how big is this" line. */
export const PUBCHEM_COMPOUND_COUNT_LABEL = '100M+';

export interface PubChemCompoundRef {
  name?: string;
  cid?: number;
}

export function pubchemSourceUrl(ref: PubChemCompoundRef): string {
  return ref.cid !== undefined
    ? `pubchem://cid/${ref.cid}`
    : `pubchem://name/${encodeURIComponent((ref.name ?? '').trim().toLowerCase())}`;
}

const autocompleteCache = new Map<string, Promise<string[]>>();

/** Compound names starting with `prefix` (case-insensitive), cached per prefix. */
export function pubchemAutocomplete(prefix: string, limit = 8): Promise<string[]> {
  const key = prefix.trim().toLowerCase();
  if (key.length < 2 || typeof fetch !== 'function') return Promise.resolve([]);
  const cacheKey = `${key}|${limit}`;
  const cached = autocompleteCache.get(cacheKey);
  if (cached) return cached;
  const request = fetch(`${AUTOCOMPLETE}/${encodeURIComponent(key)}/json?limit=${limit}`)
    .then(async (response) => {
      if (!response.ok) return [] as string[];
      const json = (await response.json()) as { dictionary_terms?: { compound?: unknown } };
      const terms = json?.dictionary_terms?.compound;
      return Array.isArray(terms) ? terms.filter((t): t is string => typeof t === 'string') : [];
    })
    .catch(() => [] as string[]);
  autocompleteCache.set(cacheKey, request);
  return request;
}

interface PubChemRecord {
  PC_Compounds?: Array<{
    id?: { id?: { cid?: number } };
    atoms?: { aid?: number[]; element?: number[] };
    bonds?: { aid1?: number[]; aid2?: number[]; order?: number[] };
    coords?: Array<{ conformers?: Array<{ x?: number[]; y?: number[]; z?: number[] }> }>;
  }>;
}

export interface PubChemStructure {
  cid: number | null;
  frame: Frame;
  is3d: boolean;
}

/** Turn a PUG REST JSON record into a viewer frame. Exported for tests. */
export function frameFromPubChemRecord(record: PubChemRecord, is3d: boolean): PubChemStructure {
  const compound = record.PC_Compounds?.[0];
  const elements = compound?.atoms?.element;
  const aids = compound?.atoms?.aid;
  const conformer = compound?.coords?.[0]?.conformers?.[0];
  if (!compound || !Array.isArray(elements) || !conformer || !Array.isArray(conformer.x) || !Array.isArray(conformer.y)) {
    throw new Error('PubChem returned a record without atom coordinates.');
  }
  const natoms = elements.length;
  if (natoms === 0 || conformer.x.length < natoms || conformer.y.length < natoms) {
    throw new Error('PubChem record is missing coordinates for some atoms.');
  }
  const zs = Array.isArray(conformer.z) && conformer.z.length >= natoms ? conformer.z : null;

  const ids = new Int32Array(natoms);
  const types = new Int32Array(natoms);
  const positions = new Float32Array(natoms * 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const aidToIndex = new Map<number, number>();
  for (let i = 0; i < natoms; i++) {
    const atomicNumber = elements[i];
    if (!Number.isInteger(atomicNumber) || atomicNumber < 1 || atomicNumber > 118) {
      throw new Error(`PubChem atom ${i + 1} has an unsupported element ${String(atomicNumber)}.`);
    }
    ids[i] = i + 1;
    types[i] = atomicNumber;
    const x = Number(conformer.x[i]);
    const y = Number(conformer.y[i]);
    const z = zs ? Number(zs[i]) : 0;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    aidToIndex.set(Array.isArray(aids) && Number.isInteger(aids[i]) ? aids[i] : i + 1, i);
  }

  // PubChem's connection table is real source topology, not an inferred guide.
  const bondPairs: number[] = [];
  const aid1 = compound.bonds?.aid1;
  const aid2 = compound.bonds?.aid2;
  if (Array.isArray(aid1) && Array.isArray(aid2)) {
    for (let k = 0; k < Math.min(aid1.length, aid2.length); k++) {
      const a = aidToIndex.get(aid1[k]);
      const b = aidToIndex.get(aid2[k]);
      if (a !== undefined && b !== undefined && a !== b) bondPairs.push(a, b);
    }
  }

  const frame: Frame = {
    timestep: 0,
    natoms,
    boxBounds: new Float64Array([
      minX - BOUNDS_PAD, maxX + BOUNDS_PAD,
      minY - BOUNDS_PAD, maxY + BOUNDS_PAD,
      minZ - BOUNDS_PAD, maxZ + BOUNDS_PAD,
    ]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids,
    types,
    positions,
    bonds: Int32Array.from(bondPairs),
    properties: new Map(),
    identity: { kind: 'synthetic-row', unique: true },
    typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
    distanceSemantics: { kind: 'angstrom', provenance: 'source-declared' },
  };
  const cid = compound.id?.id?.cid;
  return { cid: Number.isInteger(cid) ? (cid as number) : null, frame, is3d };
}

/** Hill-order formula from atomic numbers (C, H first, then alphabetical). */
export function formulaFromTypes(types: Int32Array): string {
  const counts = new Map<string, number>();
  for (let i = 0; i < types.length; i++) {
    const symbol = getElementSpec(types[i]).symbol;
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  const symbols = Array.from(counts.keys()).sort();
  const ordered = counts.has('C')
    ? ['C', ...(counts.has('H') ? ['H'] : []), ...symbols.filter((s) => s !== 'C' && s !== 'H')]
    : symbols;
  return ordered.map((s) => `${s}${counts.get(s)! > 1 ? counts.get(s) : ''}`).join('');
}

function recordPath(ref: PubChemCompoundRef): string {
  if (ref.cid !== undefined) return `compound/cid/${ref.cid}`;
  return `compound/name/${encodeURIComponent((ref.name ?? '').trim())}`;
}

/** Fetch the 3D conformer (2D fallback) as a viewer frame. */
export async function fetchPubChemCompound(ref: PubChemCompoundRef): Promise<PubChemStructure> {
  if (ref.cid === undefined && !(ref.name ?? '').trim()) throw new Error('A compound name or CID is required.');
  const base = `${PUG}/${recordPath(ref)}/record/JSON`;
  const attempts: Array<{ url: string; is3d: boolean }> = [
    { url: `${base}/?record_type=3d`, is3d: true },
    { url: base, is3d: false },
  ];
  let lastStatus = 0;
  for (const attempt of attempts) {
    const response = await fetch(attempt.url);
    if (!response.ok) {
      lastStatus = response.status;
      if (response.status === 404) continue;
      throw new Error(`PubChem lookup failed: ${response.status} ${response.statusText}`);
    }
    return frameFromPubChemRecord((await response.json()) as PubChemRecord, attempt.is3d);
  }
  throw new Error(
    lastStatus === 404
      ? `PubChem has no structure named "${ref.name ?? ref.cid}". Try another spelling.`
      : 'PubChem lookup failed.',
  );
}

function titleCase(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
}

export interface OpenPubChemOptions {
  /** How to reflect the compound in the address bar. */
  history?: 'push' | 'replace' | 'none';
  /** Display title; defaults to the capitalized name. */
  title?: string;
}

/**
 * Load a PubChem compound into the viewer store. Resolves once the frame is
 * active; rejects with a readable message (also surfaced through the store).
 */
export async function openPubChemMolecule(
  ref: PubChemCompoundRef,
  options: OpenPubChemOptions = {},
): Promise<{ name: string; atomCount: number; cid: number | null }> {
  const store = useStore.getState();
  const sourceUrl = pubchemSourceUrl(ref);
  store.setLoading(true, 0);
  store.setError(null);
  try {
    const structure = await fetchPubChemCompound(ref);
    const frame = structure.frame;
    const name = options.title ?? titleCase(ref.name ?? `PubChem CID ${ref.cid}`);
    const trajectory: Trajectory = {
      frames: [frame],
      totalFrames: 1,
      atomTypes: Array.from(new Set(Array.from(frame.types))).sort((a, b) => a - b),
      globalBounds: {
        min: [frame.boxBounds[0] + BOUNDS_PAD, frame.boxBounds[2] + BOUNDS_PAD, frame.boxBounds[4] + BOUNDS_PAD],
        max: [frame.boxBounds[1] - BOUNDS_PAD, frame.boxBounds[3] - BOUNDS_PAD, frame.boxBounds[5] - BOUNDS_PAD],
      },
    };
    const file: LoadedFile = {
      name,
      size: frame.natoms * 16,
      trajectory,
      thermo: null,
      sourceUrl,
    };
    syncMoleculeUrl(ref, options.history ?? 'push');
    useStore.getState().setActiveCardId(null);
    useStore.getState().setFile(file);
    track(ANALYTICS_EVENTS.MOLECULE_LOADED, { source: 'pubchem', frames: 1 });
    return { name, atomCount: frame.natoms, cid: structure.cid };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useStore.getState().setError(message);
    throw error;
  }
}

function syncMoleculeUrl(ref: PubChemCompoundRef, mode: 'push' | 'replace' | 'none'): void {
  if (mode === 'none' || typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('sim');
  url.searchParams.delete('load');
  url.searchParams.set('molecule', ref.cid !== undefined ? `cid:${ref.cid}` : (ref.name ?? '').trim());
  if (mode === 'replace') window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
}

/** Parse the `?molecule=` deep-link value back into a compound reference. */
export function parseMoleculeParam(value: string | null | undefined): PubChemCompoundRef | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const cid = /^cid:(\d+)$/i.exec(trimmed);
  if (cid) return { cid: Number(cid[1]) };
  return { name: trimmed.slice(0, 200) };
}
