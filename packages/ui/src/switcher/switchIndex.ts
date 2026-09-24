import { molarMass, parsePropertyEvidence, type PropertyEvidence } from '@atlas/core';
import { LOCAL_MOLECULES, scoreLocalMolecule, type LocalMolecule } from '../landing/moleculeIndex';
import { elementsFromFormula, omolFacets, omolRecords, omolStructureUrl, type OmolRecord } from '../molecules/providers/omol';
import { openPubChemMolecule, pubchemAutocomplete } from '../molecules/pubchemLoad';
import { openMolecule } from '../viewer/openMolecule';
import propertySheet from './property-sheet.json';
import { facetsOf } from '../library/libraryFacts';

/**
 * Candidate index for the molecule switcher. Everything here is local and
 * deterministic so a result list appears on the first keystroke or element
 * click: the 104 gallery entries are in memory, the 27,697-row OMol25
 * validation index is one same-origin fetch, PubChem names arrive after two
 * characters. Jev only re-orders what this index already found.
 */
export interface SwitchCandidate {
  key: string;
  title: string;
  formula?: string;
  elements: string[];
  atoms: number;
  source: 'gallery' | 'omol' | 'pubchem';
  detail: string;
  /** Static preview art when the gallery has it. */
  image?: string;
  /** Gallery shelf ("Metals & Alloys"), so a judgment can tell a molecule from a material. */
  category?: string;
  /** Reference properties from `property-sheet.json` (gallery entries only). */
  evidence?: PropertyEvidence;
  /** Molar mass computed from the formula, g/mol. */
  molarMass?: number;
  open: () => Promise<void>;
}

const SHEET = (propertySheet as { entries: Record<string, unknown> }).entries;

/** Reference evidence for a gallery id, sanitized the same way the edge does. */
export function galleryEvidence(id: string): PropertyEvidence | undefined {
  return parsePropertyEvidence(SHEET[id]);
}

export interface SwitchQuery {
  query: string;
  elements: string[];
  limit?: number;
}

const GALLERY_LIMIT = 12;
const OMOL_LIMIT = 16;
const PUBCHEM_LIMIT = 6;

function atomsLabel(atoms: number): string {
  if (atoms >= 1_000_000) return `${(atoms / 1_000_000).toFixed(1).replace(/\.0$/, '')}M atoms`;
  if (atoms >= 1000) return `${Math.round(atoms / 1000)}k atoms`;
  return atoms ? `${atoms} atoms` : '';
}

function galleryCandidate(molecule: LocalMolecule): SwitchCandidate {
  const elements = molecule.formula ? elementsFromFormula(molecule.formula) : [];
  return {
    key: `gallery:${molecule.id}`,
    title: molecule.title,
    formula: molecule.formula,
    elements,
    atoms: molecule.atoms,
    source: 'gallery',
    detail: [molecule.formula, atomsLabel(molecule.atoms), molecule.domain].filter(Boolean).join(' · '),
    image: molecule.image,
    category: molecule.domain,
    evidence: galleryEvidence(molecule.id),
    molarMass: molarMass(molecule.formula),
    open: async () => {
      const result = await openMolecule({ kind: 'gallery', id: molecule.id, history: 'push' });
      if (!result.ok) throw new Error(result.message);
    },
  };
}

function omolCandidate(record: OmolRecord): SwitchCandidate {
  return {
    key: `omol:${record.id}`,
    title: record.formula,
    formula: record.formula,
    elements: record.elements,
    atoms: record.natoms,
    source: 'omol',
    detail: `${atomsLabel(record.natoms)} · OMol25 DFT structure`,
    molarMass: molarMass(record.formula),
    open: async () => {
      const result = await openMolecule({ kind: 'url', url: omolStructureUrl(record.id), title: `${record.formula} (OMol25)`, history: 'push' });
      if (!result.ok) throw new Error(result.message);
    },
  };
}

function pubchemCandidate(name: string): SwitchCandidate {
  return {
    key: `pubchem:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
    title: name,
    elements: [],
    atoms: 0,
    source: 'pubchem',
    detail: 'PubChem compound',
    open: async () => {
      await openPubChemMolecule({ name });
    },
  };
}

const POOL_CACHE: { value: SwitchCandidate[] | null } = { value: null };
function poolCache(): SwitchCandidate[] {
  POOL_CACHE.value ??= LOCAL_MOLECULES.map(galleryCandidate);
  return POOL_CACHE.value;
}

function hasAll(elements: string[], wanted: string[]): boolean {
  return wanted.every((symbol) => elements.includes(symbol));
}

/** A title or formula match this strong is an explicit ask and overrides the
 *  element filter: typing "water" with C and N selected still means water. */
const EXPLICIT_MATCH_SCORE = 75;

/** A typed word that names one of the entry's facets ("metal", "flammable")
 *  is a weak match, so a facet word lists something before Jev answers. */
const FACET_TEXT_SCORE = 20;
function facetTextScore(key: string, query: string): number {
  const q = query.toLowerCase();
  if (q.length < 3) return 0;
  return facetsOf(key).some((facet) => facet.label.toLowerCase().split(/[\s,]+/).some((word) => word.startsWith(q)) || facet.id === q) ? FACET_TEXT_SCORE : 0;
}

/** Gallery matches, instant. With elements selected, only entries whose formula
 *  is known can qualify, so an unlabeled material never masquerades as a match. */
export function galleryCandidates({ query, elements, limit = GALLERY_LIMIT }: SwitchQuery): SwitchCandidate[] {
  const q = query.trim();
  const all = galleryPool();
  const filtered = elements.length ? all.filter((candidate) => hasAll(candidate.elements, elements)) : all;
  if (!q) return filtered.slice(0, limit);
  const byKey = new Map(LOCAL_MOLECULES.map((molecule) => [`gallery:${molecule.id}`, molecule]));
  return all
    .map((candidate, index) => ({ candidate, score: scoreLocalMolecule(byKey.get(candidate.key)!, q) || facetTextScore(candidate.key, q), index }))
    .filter((entry) => entry.score >= EXPLICIT_MATCH_SCORE || (entry.score > 0 && (!elements.length || hasAll(entry.candidate.elements, elements))))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** OMol25 validation matches: formula prefix or element AND-filter, smallest
 *  first. A typed word that is not a formula matches nothing here; names are
 *  the gallery's and PubChem's job. */
export async function omolCandidates({ query, elements, limit = OMOL_LIMIT }: SwitchQuery): Promise<SwitchCandidate[]> {
  const q = query.trim();
  const looksLikeFormula = /^[A-Z][A-Za-z0-9]*$/.test(q);
  if (q && !looksLikeFormula) return [];
  if (!elements.length && !looksLikeFormula) return [];
  const records = await omolRecords();
  const matches: OmolRecord[] = [];
  for (const record of records) {
    if (elements.length && !hasAll(record.elements, elements)) continue;
    if (q && looksLikeFormula && !record.formula.startsWith(q)) continue;
    matches.push(record);
  }
  // Exact formula first, then prefix matches, smallest first within each.
  matches.sort((a, b) => Number(b.formula === q) - Number(a.formula === q) || a.natoms - b.natoms || a.formula.localeCompare(b.formula));
  return matches.slice(0, limit).map(omolCandidate);
}

/** A slow PubChem must never hold the list: past this the names simply do not appear. */
const PUBCHEM_TIMEOUT_MS = 1_500;

export async function pubchemCandidates({ query, elements, limit = PUBCHEM_LIMIT }: SwitchQuery): Promise<SwitchCandidate[]> {
  const q = query.trim();
  if (q.length < 2 || elements.length) return [];
  try {
    const names = await Promise.race([
      pubchemAutocomplete(q, limit),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), PUBCHEM_TIMEOUT_MS)),
    ]);
    return names.map(pubchemCandidate);
  } catch {
    return [];
  }
}

/** Every gallery entry as a candidate, built once. This is the pool Jev
 *  chooses from for class and description queries ("something sweet"), so a
 *  best guess can be a molecule the typed text never matched. */
export function galleryPool(elements: string[] = []): SwitchCandidate[] {
  const pool = poolCache();
  return elements.length ? pool.filter((candidate) => hasAll(candidate.elements, elements)) : pool;
}

export interface ElementCount {
  symbol: string;
  gallery: number;
  omol: number;
}

let countsCache: Promise<ElementCount[]> | null = null;

/** How many switchable structures contain each element, gallery plus the
 *  OMol25 validation slice. Drives the chip order and the table heat. */
export function switchElementCounts(): Promise<ElementCount[]> {
  countsCache ??= (async () => {
    const gallery = new Map<string, number>();
    for (const candidate of galleryPool()) for (const symbol of candidate.elements) gallery.set(symbol, (gallery.get(symbol) ?? 0) + 1);
    let omol = new Map<string, number>();
    try {
      const facets = await omolFacets();
      omol = new Map(facets.elementCounts.map((entry) => [entry.element, entry.count]));
    } catch {
      omol = new Map();
    }
    const symbols = new Set([...gallery.keys(), ...omol.keys()]);
    return [...symbols]
      .map((symbol) => ({ symbol, gallery: gallery.get(symbol) ?? 0, omol: omol.get(symbol) ?? 0 }))
      .sort((a, b) => b.gallery - a.gallery || b.omol - a.omol || a.symbol.localeCompare(b.symbol));
  })();
  return countsCache;
}

/** Merge the three sources, gallery first, without duplicate titles. */
export function mergeCandidates(groups: SwitchCandidate[][], limit: number): SwitchCandidate[] {
  const seen = new Set<string>();
  const merged: SwitchCandidate[] = [];
  for (const group of groups) {
    for (const candidate of group) {
      const dedupe = candidate.title.toLowerCase();
      if (seen.has(dedupe) || seen.has(candidate.key)) continue;
      seen.add(dedupe);
      seen.add(candidate.key);
      merged.push(candidate);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}

export async function findSwitchCandidates(input: SwitchQuery): Promise<SwitchCandidate[]> {
  const limit = input.limit ?? 24;
  const [omol, pubchem] = await Promise.all([omolCandidates(input), pubchemCandidates(input)]);
  return mergeCandidates([galleryCandidates(input), omol, pubchem], limit);
}
