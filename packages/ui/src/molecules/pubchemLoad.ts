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
import {
  fetchPubChemMolecule,
  frameFromPubChemMolecule,
  parsePubChemRecord,
  type PubChemCompoundRef,
  type PubChemMolecule,
} from '@atlas/core/pubchem';
import { useStore, type LoadedFile } from '../store';
import { track, ANALYTICS_EVENTS } from '../analytics';

const AUTOCOMPLETE = 'https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound';
const BOUNDS_PAD = 2.0;

/** Approximate public compound count, for the "how big is this" line. */
export const PUBCHEM_COMPOUND_COUNT_LABEL = '100M+';

export type { PubChemCompoundRef } from '@atlas/core/pubchem';

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

export interface PubChemStructure {
  cid: number | null;
  frame: Frame;
  is3d: boolean;
  molecule: PubChemMolecule;
}

/** Compatibility wrapper; the source flags must agree with the caller. */
export function frameFromPubChemRecord(record: unknown, is3d: boolean): PubChemStructure {
  const molecule = parsePubChemRecord(record, { expectedDimension: is3d ? '3d' : '2d' });
  return { cid: molecule.cid, frame: frameFromPubChemMolecule(molecule), is3d: molecule.dimension === '3d', molecule };
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

/** Fetch the 3D conformer (2D fallback) as a viewer frame. */
export async function fetchPubChemCompound(ref: PubChemCompoundRef): Promise<PubChemStructure> {
  const molecule = await fetchPubChemMolecule(ref);
  return { cid: molecule.cid, frame: frameFromPubChemMolecule(molecule), is3d: molecule.dimension === '3d', molecule };
}

export interface OpenPubChemOptions {
  /** How to reflect the compound in the address bar. */
  history?: 'push' | 'replace' | 'none';
  /** Display title; defaults to the CID-matched PubChem title. */
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
  store.setLoading(true, 0);
  store.setError(null);
  try {
    const structure = await fetchPubChemCompound(ref);
    const frame = structure.frame;
    const name = options.title ?? structure.molecule.name;
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
      sourceUrl: pubchemSourceUrl({ cid: structure.molecule.cid }),
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
