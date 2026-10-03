/**
 * clues.mts — the written clue ladder and the warmth table, from a molecule
 * page's record (scripts/molecule-pages/catalog.mts). Every number comes from
 * the coordinate file, its PubChem-checked formula or the reference property
 * sheet, as on the /m pages. The library facets (Jev-judged) only order the
 * warmth, never appear as facts.
 *
 *   1  Size and shape    "24 atoms, flat, about 9 × 7 Å."           (silhouette)
 *   2  Elements          "Made of carbon, hydrogen, nitrogen and oxygen." (it turns)
 *   3  Rings and bonds   "Two rings, a hexagon and a pentagon, fused." (outline)
 *   4  Formula           "Its formula: C₈H₁₀N₄O₂"                   (colours)
 *   5  At 25 °C          "A solid that melts at 235 °C …"
 *   6  Name              "8 letters, starting with C"  C _ _ _ _ _ _ _
 */
import { getAtomicNumberBySymbol, getElementSpecBySymbol } from '../../packages/core/src/elements.ts';
import { molarMass } from '../../packages/core/src/jev/propertyRank.ts';
import { computeBonds } from '../../packages/core/src/objectFacts/bonds.ts';
import { jacobiEigenSymmetric3 } from '../../packages/core/src/objectFacts/jacobi.ts';
import { findRingFaces } from '../../packages/core/src/objectFacts/rings.ts';
import type { DailyClue, DailyPoolEntry } from '../../packages/ui/src/daily/secret.ts';
import type { MoleculeRecord } from '../molecule-pages/catalog.mts';
import type { DailyDecoy } from './queue.mts';

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const RING_NAMES: Record<number, [string, string, string]> = {
  3: ['triangle', 'triangles', 'triangular'],
  4: ['square', 'squares', 'square'],
  5: ['pentagon', 'pentagons', 'pentagonal'],
  6: ['hexagon', 'hexagons', 'hexagonal'],
  7: ['heptagon', 'heptagons', 'heptagonal'],
  8: ['octagon', 'octagons', 'octagonal'],
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const numberWord = (n: number) => (n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n));

/** "a, b and c" */
function listAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function fmtLength(value: number): string {
  if (value < 3) return value.toFixed(1);
  return String(Math.round(value));
}

/** Principal extents (Å, centre to centre), largest first. */
function extents(p: number[]): [number, number, number] {
  const n = p.length / 3;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i += 1) {
    cx += p[3 * i];
    cy += p[3 * i + 1];
    cz += p[3 * i + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (let i = 0; i < n; i += 1) {
    const x = p[3 * i] - cx;
    const y = p[3 * i + 1] - cy;
    const z = p[3 * i + 2] - cz;
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  const { vectors } = jacobiEigenSymmetric3([
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz],
  ]);
  const spans = vectors.map((axis) => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const d = (p[3 * i] - cx) * axis[0] + (p[3 * i + 1] - cy) * axis[1] + (p[3 * i + 2] - cz) * axis[2];
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    return max - min;
  });
  spans.sort((a, b) => b - a);
  return [spans[0], spans[1], spans[2]];
}

function shapeClue(record: MoleculeRecord): DailyClue {
  const p = record.model.p;
  const [a, b, c] = extents(p);
  // Hydrogens stick out of a flat ring system (caffeine's methyls); the skeleton decides "flat".
  const heavy: number[] = [];
  record.model.k.forEach((kind, i) => {
    if (record.model.kinds[kind].s !== 'H') heavy.push(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
  });
  const core = heavy.length >= 18 ? extents(heavy) : null;
  const atoms = `${record.atoms} atoms`;
  let text: string;
  if (b < 0.4) text = `${atoms} in a straight line, about ${fmtLength(a)} Å end to end.`;
  else if (c < 0.45) text = `${atoms}, all in one flat plane, about ${fmtLength(a)} × ${fmtLength(b)} Å.`;
  else if (core && core[2] < 0.45) text = `${atoms} around a flat core, about ${fmtLength(a)} × ${fmtLength(b)} Å.`;
  else if (a / Math.max(c, 0.1) < 1.35) text = `${atoms}, roughly round, about ${fmtLength(a)} Å across.`;
  else if (a / Math.max(b, 0.1) > 2.2) text = `${atoms}, long and thin, about ${fmtLength(a)} Å long.`;
  else text = `${atoms}, not flat, about ${fmtLength(a)} × ${fmtLength(b)} × ${fmtLength(c)} Å.`;
  return { title: 'Size and shape', text };
}

/** Hill order: carbon, hydrogen, then the rest alphabetically. */
function hillRank(symbol: string, hasCarbon: boolean): string {
  if (hasCarbon && symbol === 'C') return '0';
  if (hasCarbon && symbol === 'H') return '1';
  return `2${symbol}`;
}

function elementsClue(record: MoleculeRecord): DailyClue {
  const hasCarbon = record.elements.some((e) => e.symbol === 'C');
  const names = [...record.elements]
    .sort((x, y) => hillRank(x.symbol, hasCarbon).localeCompare(hillRank(y.symbol, hasCarbon)))
    .map((e) => e.name.toLowerCase());
  const text = names.length === 1 ? `Made of ${names[0]} only.` : `Made of ${listAnd(names)}: ${numberWord(names.length)} elements.`;
  return { title: 'Elements', text: capitalize(text) };
}

function ringsClue(record: MoleculeRecord): DailyClue {
  const { model } = record;
  const n = model.k.length;
  const z = model.k.map((kind) => getAtomicNumberBySymbol(model.kinds[kind].s) ?? 6);
  const graph = computeBonds(z, model.p, n);
  const rel = Float64Array.from(model.p);
  const faces = findRingFaces(rel, graph, { planarTolerance: 50, planeNormal: null, fallbackNormal: [0, 0, 1] });
  const heavy = z.filter((value) => value !== 1).length;
  const hydrogens = n - heavy;
  const heavyText = heavy === 1 ? 'only one atom heavier than hydrogen' : `${heavy} atoms heavier than hydrogen`;

  if (faces.length === 0) {
    if (heavy <= 1) return { title: 'Rings and bonds', text: `No rings, and ${heavyText}.` };
    const heavyNeighbours = (i: number) => graph.adjacency[i].filter((j) => z[j] !== 1).length;
    const branched = z.some((value, i) => value !== 1 && heavyNeighbours(i) >= 3);
    return {
      title: 'Rings and bonds',
      text: `No rings: ${heavyText}, in ${branched ? 'a branched' : 'one unbranched'} chain. ${graph.pairs.length} bonds in all.`,
    };
  }

  const bySize = new Map<number, number>();
  for (const face of faces) bySize.set(face.size, (bySize.get(face.size) ?? 0) + 1);
  const sizes = [...bySize.entries()].sort((p, q) => p[0] - q[0]);
  const parts = sizes.map(([size, count]) => {
    const [one, many] = RING_NAMES[size] ?? [`${size}-ring`, `${size}-rings`, `${size}-membered`];
    return count === 1 ? `a ${one}` : `${numberWord(count)} ${many}`;
  });

  let joined = '';
  if (faces.length > 1) {
    // Rings sharing two or more atoms are fused; one component means all of them are.
    const parent = faces.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    let fusedPairs = 0;
    for (let i = 0; i < faces.length; i += 1) {
      const set = new Set(faces[i].atoms);
      for (let j = i + 1; j < faces.length; j += 1) {
        if (faces[j].atoms.filter((atom) => set.has(atom)).length >= 2) {
          fusedPairs += 1;
          parent[find(i)] = find(j);
        }
      }
    }
    const components = new Set(faces.map((_, i) => find(i))).size;
    const inRing = new Set(faces.flatMap((face) => face.atoms));
    const euler = n - graph.pairs.length + faces.length;
    if (components === 1 && inRing.size === n && euler === 2) joined = ', closed into a cage';
    else if (components === 1 && inRing.size === n && euler === 0) joined = ', rolled into a tube';
    else if (components === 1) joined = faces.length === 2 ? ', fused together' : ', all fused together';
    else if (fusedPairs > 0) joined = ', some of them fused';
    else joined = faces.length === 2 ? ', apart from each other' : ', none of them touching';
  }
  let list: string;
  if (faces.length === 1) list = `One ring: ${parts[0]}`;
  else if (sizes.length === 1) {
    const adjective = RING_NAMES[sizes[0][0]]?.[2] ?? `${sizes[0][0]}-membered`;
    list = `${capitalize(numberWord(faces.length))} ${adjective} rings`;
  } else list = `${capitalize(numberWord(faces.length))} rings: ${listAnd(parts)}`;
  const tail = hydrogens === 0 ? ' No hydrogen at all.' : ` ${capitalize(heavyText)}.`;
  return { title: 'Rings and bonds', text: `${list}${joined}.${tail}` };
}

function formulaClue(record: MoleculeRecord): DailyClue {
  return { title: 'Formula', text: 'Its formula:', formula: record.formula ?? record.modelFormula };
}

const WATER_WORDS: Record<string, string> = {
  miscible: 'mixes completely with water',
  soluble: 'dissolves in water',
  slightly: 'barely dissolves in water',
  insoluble: 'does not dissolve in water',
  reacts: 'reacts with water',
};

const fmtTemp = (value: number) => `${Number(value.toFixed(1)).toLocaleString('en-US')} °C`;

function propertyClue(record: MoleculeRecord): DailyClue {
  const sheet = record.sheet;
  const grams = record.molarMass ?? molarMass(record.formula ?? record.modelFormula);
  const mass = grams ? `Molar mass ${grams.toFixed(2)} g/mol.` : '';
  if (!sheet?.phase) {
    const shelf = record.topic ? `On Lupi’s “${record.topic}” shelf.` : `On Lupi’s ${record.domain} shelf.`;
    return { title: 'Weight', text: [mass, shelf].filter(Boolean).join(' ') };
  }
  const bits: string[] = [];
  if (sheet.phase === 'solid' && sheet.meltingPoint !== undefined) bits.push(`melts at ${fmtTemp(sheet.meltingPoint)}`);
  else if (sheet.phase !== 'solid' && sheet.boilingPoint !== undefined) bits.push(`boils at ${fmtTemp(sheet.boilingPoint)}`);
  else if (sheet.meltingPoint !== undefined) bits.push(`${sheet.phase === 'solid' ? 'melts' : 'freezes'} at ${fmtTemp(sheet.meltingPoint)}`);
  if (sheet.water && WATER_WORDS[sheet.water] && record.id !== 'water') bits.push(WATER_WORDS[sheet.water]);
  const head = `A ${sheet.phase} at 25 °C`;
  const text = bits.length ? `${head} that ${listAnd(bits)}.` : `${head}.`;
  return { title: 'At room temperature', text: [text, mass].filter(Boolean).join(' ') };
}

/** "C _ _ _ _ _ _ _": leading non-letters and the first letter shown, every later letter hidden. */
export function namePattern(name: string): { pattern: string; text: string } {
  const words = name.trim().split(/\s+/);
  let shownFirst = false;
  let first = '';
  const tokens = words.map((word) =>
    [...word]
      .map((char) => {
        if (/[A-Za-z]/.test(char)) {
          if (!shownFirst) {
            shownFirst = true;
            first = char.toUpperCase();
            return char;
          }
          return '_';
        }
        return char;
      })
      .join(' '),
  );
  const letters = words.map((word) => (word.match(/[A-Za-z]/g) ?? []).length);
  const total = letters.reduce((sum, value) => sum + value, 0);
  const text =
    words.length === 1
      ? `Its name has ${total} letters and starts with ${first}.`
      : `Its name is ${numberWord(words.length)} words (${letters.join(' + ')} letters) and starts with ${first}.`;
  return { pattern: tokens.join('   '), text };
}

function nameClue(record: MoleculeRecord): DailyClue {
  const { pattern, text } = namePattern(record.name);
  return { title: 'Name', text, pattern };
}

export function dailyClues(record: MoleculeRecord): DailyClue[] {
  return [shapeClue(record), elementsClue(record), ringsClue(record), formulaClue(record), propertyClue(record), nameClue(record)];
}

// ── The pool and warmth ──────────────────────────────────────────────

export interface WarmthCandidate {
  key: string;
  elements: Set<string>;
  atoms: number;
  facets: Record<string, number>;
  domain?: string;
}

export function parseFormula(formula: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [, symbol, digits] of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    counts.set(symbol, (counts.get(symbol) ?? 0) + (digits ? Number(digits) : 1));
  }
  return counts;
}

export function decoyKey(name: string): string {
  return `x-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

const norm = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Every guessable name: the molecule pages, then the decoys that do not collide with them. */
export function dailyPool(records: MoleculeRecord[], decoys: readonly DailyDecoy[]): { entries: DailyPoolEntry[]; candidates: WarmthCandidate[] } {
  const entries: DailyPoolEntry[] = [];
  const candidates: WarmthCandidate[] = [];
  const taken = new Set<string>();
  for (const record of records) {
    const names = [record.title, ...record.aliases].filter((alias, i, all) => {
      const key = norm(alias);
      return key && key !== norm(record.name) && all.findIndex((other) => norm(other) === key) === i;
    });
    entries.push({ k: record.id, n: record.name, ...(names.length ? { a: names } : {}) });
    taken.add(norm(record.name));
    for (const name of names) taken.add(norm(name));
    candidates.push({
      key: record.id,
      elements: new Set(record.elements.map((e) => e.symbol)),
      atoms: record.atoms,
      facets: record.facets,
      domain: record.domain,
    });
  }
  for (const decoy of decoys) {
    const names = [decoy.name, ...(decoy.aliases ?? [])];
    if (names.some((name) => taken.has(norm(name)))) continue;
    for (const symbol of parseFormula(decoy.formula).keys()) {
      if (!getElementSpecBySymbol(symbol)) throw new Error(`decoy ${decoy.name}: unknown element ${symbol}`);
    }
    for (const name of names) taken.add(norm(name));
    const counts = parseFormula(decoy.formula);
    entries.push({ k: decoyKey(decoy.name), n: decoy.name, ...(decoy.aliases?.length ? { a: [...decoy.aliases] } : {}) });
    candidates.push({
      key: decoyKey(decoy.name),
      elements: new Set(counts.keys()),
      atoms: [...counts.values()].reduce((sum, value) => sum + value, 0),
      facets: Object.fromEntries(decoy.facets.map((facet) => [facet, 0.9])),
    });
  }
  entries.sort((a, b) => a.n.localeCompare(b.n));
  return { entries, candidates };
}

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const value of Object.values(a)) na += value * value;
  for (const value of Object.values(b)) nb += value * value;
  if (!na || !nb) return 0;
  for (const [facet, value] of Object.entries(a)) dot += value * (b[facet] ?? 0);
  return dot / Math.sqrt(na * nb);
}

function similarity(a: WarmthCandidate, b: WarmthCandidate): number {
  const shared = [...a.elements].filter((symbol) => b.elements.has(symbol)).length;
  const union = new Set([...a.elements, ...b.elements]).size || 1;
  const size = 1 - Math.min(1, Math.abs(Math.log(a.atoms / Math.max(1, b.atoms))) / Math.log(30));
  const shelf = a.domain && a.domain === b.domain ? 0.1 : 0;
  return cosine(a.facets, b.facets) + 0.35 * (shared / union) + 0.2 * size + shelf;
}

/** Pool key → warmth 0..99 for one answer: the rank of each guess's likeness, closest 99. */
export function warmthTable(answerKey: string, candidates: WarmthCandidate[]): Record<string, number> {
  const answer = candidates.find((candidate) => candidate.key === answerKey);
  if (!answer) return {};
  const scored = candidates
    .filter((candidate) => candidate.key !== answerKey)
    .map((candidate) => ({ key: candidate.key, score: similarity(answer, candidate) }))
    .sort((p, q) => q.score - p.score || p.key.localeCompare(q.key));
  const last = Math.max(1, scored.length - 1);
  const table: Record<string, number> = {};
  scored.forEach((entry, rank) => {
    table[entry.key] = Math.round(99 * (1 - rank / last));
  });
  return table;
}
