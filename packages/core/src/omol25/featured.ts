import { OMOL25_NEUTRAL_ELEMENTS, omol25Collection } from './collections';
import { OMOL25_CITATION, OMOL25_VIEWER_BOND_RECIPE } from './truth';
import { omolFeaturedPath, omolPickInkPath, omolPickKey, omolStructurePath } from './urls';

export const OMOL25_FEATURED_SCHEMA = 'lupi.omol25-featured.v1' as const;
export const OMOL25_FEATURED_DATASET = 'colabfit/OMol25_neutral_validation' as const;
export const OMOL25_FEATURED_BOND_RECIPE = OMOL25_VIEWER_BOND_RECIPE;

export type OmolShelfId = 'drug-like' | 'amino-acid-ligand' | 'conformers' | 'off-equilibrium' | 'salt-complexes' | 'small';
export const OMOL25_SHELVES: readonly OmolShelfId[] = [
  'drug-like', 'amino-acid-ligand', 'conformers', 'off-equilibrium', 'salt-complexes', 'small',
];
export const OMOL25_SHELF_LABELS: Readonly<Record<OmolShelfId, string>> = {
  'drug-like': 'Drug-like molecules',
  'amino-acid-ligand': 'Amino acid and ligand',
  conformers: 'Conformers',
  'off-equilibrium': 'Off equilibrium',
  'salt-complexes': 'Salt complexes',
  small: 'Small molecules',
};

/** Curation limits for the same-origin featured set (strategy 4.1–4.2). */
export const OMOL25_FEATURED_LIMITS = {
  minAtoms: 12,
  maxAtoms: 120,
  minDistanceA: 0.7,
  maxPicks: 48,
  minHome: 12,
} as const;

export interface OmolFeaturedPickV1 {
  id: string;
  collection: 'neutral-validation';
  dataset: 'colabfit/OMol25_neutral_validation';
  row: number;
  configurationId: string;
  propertyId: string;
  formula: string;
  atoms: number;
  elements: string[];
  shelf: OmolShelfId;
  home: boolean;
  domain: string | null;
  domainLabel: string;
  charge: number;
  spinMultiplicity: number;
  chargeSource: 'record';
  energyEv: number | null;
  maxForceEvPerA: number | null;
  homoLumoGapEv: number | null;
  title: string;
  name: null | { text: string; id: string; url: string; source: 'chembl' | 'pubchem'; formulaMatch: true };
  xyz: string;
  edge: string;
  ink: string;
  sha256: string;
  fetchedAt: string;
  bondRecipe: 'lupi-bonds.molecular.v1';
}

export interface OmolFeaturedFileV1 {
  schema: 'lupi.omol25-featured.v1';
  license: 'CC-BY-4.0';
  citation: string;
  picks: OmolFeaturedPickV1[];
}

/** The landing-safe slice of a pick that `packages/ui/src/landing/omolShelf.data.ts` carries. */
export interface OmolShelfPick {
  id: string;
  title: string;
  formula: string;
  atoms: number;
  elements: string[];
  shelf: string;
  home: boolean;
  domainLabel: string;
  charge: number;
  spinMultiplicity: number;
  file: string;
  ink: string;
}

export function omolShelfPick(pick: OmolFeaturedPickV1): OmolShelfPick {
  return {
    id: pick.id,
    title: pick.title,
    formula: pick.formula,
    atoms: pick.atoms,
    elements: [...pick.elements],
    shelf: pick.shelf,
    home: pick.home,
    domainLabel: pick.domainLabel,
    charge: pick.charge,
    spinMultiplicity: pick.spinMultiplicity,
    file: pick.xyz,
    ink: pick.ink,
  };
}

/** Element symbols and counts of a Hill-style formula, in written order; null when it is not one. */
export function parseOmolFormula(formula: string): Array<[string, number]> | null {
  if (typeof formula !== 'string' || !/^(?:[A-Z][a-z]?\d*)+$/.test(formula)) return null;
  const out: Array<[string, number]> = [];
  const seen = new Set<string>();
  for (const [, symbol, digits] of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (seen.has(symbol)) return null;
    seen.add(symbol);
    const count = digits ? Number(digits) : 1;
    if (!Number.isSafeInteger(count) || count < 1) return null;
    out.push([symbol, count]);
  }
  return out;
}

const NEUTRAL = new Set(OMOL25_NEUTRAL_ELEMENTS);
const SHELVES = new Set<string>(OMOL25_SHELVES);
const NV_ROWS = omol25Collection('neutral-validation').indexedRows;

/** Shape errors for one featured pick; empty when it is valid. */
export function validateOmolFeaturedPick(value: unknown, label = 'pick'): string[] {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(`${label}: ${message}`);
  if (!isRecord(value)) return [`${label}: not an object`];
  const p = value;

  const row = p.row;
  if (!Number.isSafeInteger(row) || (row as number) < 0 || (row as number) >= NV_ROWS) {
    fail(`row must be an integer in [0, ${NV_ROWS})`);
    return errors;
  }
  const r = row as number;
  if (p.id !== omolPickKey(r)) fail(`id must be ${omolPickKey(r)}`);
  if (p.collection !== 'neutral-validation') fail('collection must be neutral-validation');
  if (p.dataset !== OMOL25_FEATURED_DATASET) fail(`dataset must be ${OMOL25_FEATURED_DATASET}`);
  if (!isToken(p.configurationId)) fail('configurationId must be a non-empty token');
  if (!isToken(p.propertyId)) fail('propertyId must be a non-empty token');

  const formula = typeof p.formula === 'string' ? parseOmolFormula(p.formula) : null;
  if (!formula) fail('formula must be a Hill formula');
  const atoms = p.atoms;
  if (!Number.isInteger(atoms) || (atoms as number) < OMOL25_FEATURED_LIMITS.minAtoms || (atoms as number) > OMOL25_FEATURED_LIMITS.maxAtoms) {
    fail(`atoms must be an integer in [${OMOL25_FEATURED_LIMITS.minAtoms}, ${OMOL25_FEATURED_LIMITS.maxAtoms}]`);
  } else if (formula && formula.reduce((sum, [, n]) => sum + n, 0) !== atoms) {
    fail('atoms must equal the formula atom count');
  }
  if (!Array.isArray(p.elements) || !p.elements.every((e) => typeof e === 'string' && NEUTRAL.has(e))) {
    fail('elements must be neutral-lane element symbols');
  } else if (formula && p.elements.join(',') !== formula.map(([s]) => s).join(',')) {
    fail('elements must list the formula elements in formula order');
  }
  if (typeof p.shelf !== 'string' || !SHELVES.has(p.shelf)) fail(`shelf must be one of ${OMOL25_SHELVES.join(', ')}`);
  if (typeof p.home !== 'boolean') fail('home must be a boolean');
  if (p.domain !== null && !isToken(p.domain)) fail('domain must be a token or null');
  if (!isText(p.domainLabel)) fail('domainLabel must be non-empty text');
  if (!Number.isInteger(p.charge) || Math.abs(p.charge as number) > 10) fail('charge must be an integer with |q| <= 10');
  if (!Number.isInteger(p.spinMultiplicity) || (p.spinMultiplicity as number) < 1 || (p.spinMultiplicity as number) > 11) {
    fail('spinMultiplicity must be an integer in [1, 11]');
  }
  if (p.chargeSource !== 'record') fail('chargeSource must be record');
  for (const key of ['energyEv', 'maxForceEvPerA', 'homoLumoGapEv'] as const) {
    if (p[key] !== null && !(typeof p[key] === 'number' && Number.isFinite(p[key]))) fail(`${key} must be a finite number or null`);
  }
  if (!isText(p.title)) fail('title must be non-empty text');
  if (p.name === null) {
    if (p.title !== p.formula) fail('title must be the Hill formula when there is no approved name');
  } else if (!isRecord(p.name)
    || !isText(p.name.text)
    || !isToken(p.name.id)
    || typeof p.name.url !== 'string' || !p.name.url.startsWith('https://')
    || (p.name.source !== 'chembl' && p.name.source !== 'pubchem')
    || p.name.formulaMatch !== true) {
    fail('name must be null or { text, id, url (https), source chembl|pubchem, formulaMatch: true }');
  }
  if (p.xyz !== omolFeaturedPath(r)) fail(`xyz must be ${omolFeaturedPath(r)}`);
  if (p.edge !== omolStructurePath('neutral-validation', r)) fail(`edge must be ${omolStructurePath('neutral-validation', r)}`);
  if (p.ink !== omolPickInkPath(r)) fail(`ink must be ${omolPickInkPath(r)}`);
  if (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) fail('sha256 must be 64 lowercase hex digits');
  if (typeof p.fetchedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(p.fetchedAt) || !Number.isFinite(Date.parse(p.fetchedAt))) {
    fail('fetchedAt must be an ISO timestamp');
  }
  if (p.bondRecipe !== OMOL25_FEATURED_BOND_RECIPE) fail(`bondRecipe must be ${OMOL25_FEATURED_BOND_RECIPE}`);
  return errors;
}

/** Shape errors for featured.v1.json; empty when it is valid. */
export function validateOmolFeaturedFile(value: unknown): string[] {
  if (!isRecord(value)) return ['file: not an object'];
  const errors: string[] = [];
  if (value.schema !== OMOL25_FEATURED_SCHEMA) errors.push(`file: schema must be ${OMOL25_FEATURED_SCHEMA}`);
  if (value.license !== 'CC-BY-4.0') errors.push('file: license must be CC-BY-4.0');
  if (value.citation !== OMOL25_CITATION) errors.push('file: citation must be OMOL25_CITATION');
  if (!Array.isArray(value.picks)) return [...errors, 'file: picks must be an array'];
  if (value.picks.length > OMOL25_FEATURED_LIMITS.maxPicks) errors.push(`file: at most ${OMOL25_FEATURED_LIMITS.maxPicks} picks`);
  const ids = new Set<unknown>();
  value.picks.forEach((pick, index) => {
    errors.push(...validateOmolFeaturedPick(pick, `picks[${index}]`));
    const id = isRecord(pick) ? pick.id : undefined;
    if (ids.has(id)) errors.push(`picks[${index}]: duplicate id ${String(id)}`);
    ids.add(id);
  });
  return errors;
}

/** Shape errors for the generated landing data (OMOL_PICKS); empty when it is valid. */
export function validateOmolShelfPicks(value: unknown): string[] {
  if (!Array.isArray(value)) return ['OMOL_PICKS must be an array'];
  const errors: string[] = [];
  const ids = new Set<string>();
  value.forEach((pick, index) => {
    const fail = (message: string) => errors.push(`OMOL_PICKS[${index}]: ${message}`);
    if (!isRecord(pick)) { fail('not an object'); return; }
    const match = typeof pick.id === 'string' ? /^omol25_nv_(\d+)$/.exec(pick.id) : null;
    if (!match) { fail('id must be omol25_nv_<row>'); return; }
    const row = Number(match[1]);
    if (ids.has(pick.id as string)) fail(`duplicate id ${pick.id as string}`);
    ids.add(pick.id as string);
    if (!isText(pick.title)) fail('title must be non-empty text');
    const formula = typeof pick.formula === 'string' ? parseOmolFormula(pick.formula) : null;
    if (!formula) fail('formula must be a Hill formula');
    if (!Number.isInteger(pick.atoms) || (formula && formula.reduce((sum, [, n]) => sum + n, 0) !== pick.atoms)) {
      fail('atoms must equal the formula atom count');
    }
    if (!Array.isArray(pick.elements) || !pick.elements.every((e) => typeof e === 'string' && NEUTRAL.has(e))) {
      fail('elements must be neutral-lane element symbols');
    }
    if (typeof pick.shelf !== 'string' || !SHELVES.has(pick.shelf)) fail('unknown shelf');
    if (typeof pick.home !== 'boolean') fail('home must be a boolean');
    if (!isText(pick.domainLabel)) fail('domainLabel must be non-empty text');
    if (!Number.isInteger(pick.charge)) fail('charge must be an integer');
    if (!Number.isInteger(pick.spinMultiplicity) || (pick.spinMultiplicity as number) < 1) fail('spinMultiplicity must be a positive integer');
    if (pick.file !== omolFeaturedPath(row)) fail(`file must be ${omolFeaturedPath(row)}`);
    if (pick.ink !== omolPickInkPath(row)) fail(`ink must be ${omolPickInkPath(row)}`);
  });
  return errors;
}

export interface OmolFeaturedCoverage {
  picks: number;
  home: number;
  elements: string[];
  missingElements: string[];
  shelves: Record<OmolShelfId, number>;
  emptyShelves: OmolShelfId[];
}

/** Curation coverage: elements, shelves and home picks (the build refuses a set that misses any). */
export function omolFeaturedCoverage(picks: ReadonlyArray<Pick<OmolFeaturedPickV1, 'elements' | 'shelf' | 'home'>>): OmolFeaturedCoverage {
  const present = new Set(picks.flatMap((p) => p.elements));
  const shelves = Object.fromEntries(OMOL25_SHELVES.map((s) => [s, 0])) as Record<OmolShelfId, number>;
  for (const p of picks) if (p.shelf in shelves) shelves[p.shelf] += 1;
  return {
    picks: picks.length,
    home: picks.filter((p) => p.home).length,
    elements: OMOL25_NEUTRAL_ELEMENTS.filter((e) => present.has(e)),
    missingElements: OMOL25_NEUTRAL_ELEMENTS.filter((e) => !present.has(e)),
    shelves,
    emptyShelves: OMOL25_SHELVES.filter((s) => shelves[s] === 0),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^\S{1,200}$/.test(value);
}
