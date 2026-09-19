import { LOCAL_MOLECULES, scoreLocalMolecule, type LocalMolecule } from '../landing/moleculeIndex';
import { elementsFromFormula, omolRecords, omolStructureUrl, type OmolRecord } from '../molecules/providers/omol';
import { openPubChemMolecule, pubchemAutocomplete } from '../molecules/pubchemLoad';
import { openMolecule } from '../viewer/openMolecule';

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
  open: () => Promise<void>;
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

function hasAll(elements: string[], wanted: string[]): boolean {
  return wanted.every((symbol) => elements.includes(symbol));
}

/** Gallery matches, instant. With elements selected, only entries whose formula
 *  is known can qualify, so an unlabeled material never masquerades as a match. */
export function galleryCandidates({ query, elements, limit = GALLERY_LIMIT }: SwitchQuery): SwitchCandidate[] {
  const q = query.trim();
  const pool = LOCAL_MOLECULES.map(galleryCandidate).filter((candidate) => !elements.length || hasAll(candidate.elements, elements));
  if (!q) return pool.slice(0, limit);
  return pool
    .map((candidate, index) => ({ candidate, score: scoreLocalMolecule(LOCAL_MOLECULES.find((m) => `gallery:${m.id}` === candidate.key)!, q), index }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** OMol25 validation matches: formula prefix or element AND-filter, smallest first. */
export async function omolCandidates({ query, elements, limit = OMOL_LIMIT }: SwitchQuery): Promise<SwitchCandidate[]> {
  const q = query.trim();
  const looksLikeFormula = /^[A-Z][A-Za-z0-9]*$/.test(q);
  if (!elements.length && !looksLikeFormula) return [];
  const records = await omolRecords();
  const matches: OmolRecord[] = [];
  for (const record of records) {
    if (elements.length && !hasAll(record.elements, elements)) continue;
    if (q && looksLikeFormula && !record.formula.startsWith(q)) continue;
    matches.push(record);
  }
  matches.sort((a, b) => a.natoms - b.natoms || a.formula.localeCompare(b.formula));
  return matches.slice(0, limit).map(omolCandidate);
}

export async function pubchemCandidates({ query, elements, limit = PUBCHEM_LIMIT }: SwitchQuery): Promise<SwitchCandidate[]> {
  const q = query.trim();
  if (q.length < 2 || elements.length) return [];
  try {
    const names = await pubchemAutocomplete(q, limit);
    return names.map(pubchemCandidate);
  } catch {
    return [];
  }
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
