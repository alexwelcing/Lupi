/**
 * catalog.mts — one record per molecule page, built from the files the app
 * already ships: the gallery entry, its curated XYZ, the PubChem-checked
 * nomenclature, the reference property sheet and the student prompts.
 *
 * Every number shown on a page comes from here. Jev-judged facets
 * (library-facts.json) are used only to order "More molecules", never shown
 * as facts.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getAtomicNumberBySymbol, getElementSpecBySymbol } from '../../packages/core/src/elements.ts';
import { computeObjectFacts } from '../../packages/core/src/objectFacts/index.ts';
import { computeBonds } from '../../packages/core/src/objectFacts/bonds.ts';
import { molarMass, parsePropertyEvidence, type PropertyEvidence } from '../../packages/core/src/jev/propertyRank.ts';
import { STUDENT_COLLECTION } from '../../packages/ui/src/gallery/studentCollection.ts';
import { hasMoleculePageEntry } from '../../packages/ui/src/moleculePage/pages.ts';
import type { InkDetent, InkKind, InkModel, InkPose } from '../../packages/ui/src/moleculePage/ink.ts';

export interface ElementCount {
  symbol: string;
  name: string;
  count: number;
  color: string;
}

export interface MoleculeRecord {
  id: string;
  /** Display name. */
  name: string;
  /** The gallery title (may differ from the PubChem preferred name). */
  title: string;
  domain: string;
  /** Public path of the coordinate file, e.g. /gallery/curated/popular/caffeine.xyz. */
  file: string;
  sha256: string;
  atoms: number;
  /** The molecular formula when PubChem identity is source-backed. */
  formula?: string;
  /** Hill formula of the drawn coordinates (always present). */
  modelFormula: string;
  /** g/mol, computed from `formula` with the element table's masses. */
  molarMass?: number;
  systematicName?: string;
  aliases: string[];
  pubchemCid?: number;
  sourceUrl?: string;
  geometrySource?: string;
  sheet?: PropertyEvidence;
  prompt?: string;
  topic?: string;
  /** One line about the molecule, from the gallery data or its facts. */
  description: string;
  elements: ElementCount[];
  model: InkModel;
  /** Library facet vector (Jev-judged): ordering only. */
  facets: Record<string, number>;
}

interface GalleryEntry {
  id: string;
  title: string;
  subtitle: string;
  domain: string;
  file: string;
  atoms: string;
  frames?: string;
  available?: boolean;
  route?: string;
  isTrajectory?: boolean;
}

interface NomenclatureEntry {
  preferredName: string;
  systematicName?: string;
  molecularFormula?: string;
  pubchemCid?: number;
  sourceUrl?: string;
  geometrySource: string;
  confidence: string;
  aliases?: string[];
}

const DEG = Math.PI / 180;
/** Turntable elevations searched (degrees) and the band a detent may sit off it. */
const EL_MIN_DEG = -30;
const EL_MAX_DEG = 45;
const EL_STEP_DEG = 0.5;
const EL_PREFERRED_DEG = 15;
const BAND_DEG = 14;
/** Detents closer than this in azimuth are one stop (the first, higher-priority one wins). */
const MERGE_AZ_DEG = 4;
const OPENING_NEAR_DEG = 30;

/** Subtitles written for developers ("for parser checks") are not page copy. */
const DEV_COPY =
  /\b(parser|inspection|checks?|polish|testbed|benchmark|picking|annotation|lighting|smoke|label|restored|quick-load|gallery card|exercise|tuning|mixed atom types)\b/i;
/** The catalog's generic "X molecular structure (formula) — source." line: the generated one says more. */
const GENERIC_COPY = /molecular structure \(/i;

const round = (value: number, digits = 3) => {
  const r = Number(value.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

function wrap(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

interface ParsedAtom {
  symbol: string;
  x: number;
  y: number;
  z: number;
}

function normalizeSymbol(raw: string): string {
  const letters = raw.replace(/[^A-Za-z]/g, '');
  return letters.slice(0, 1).toUpperCase() + letters.slice(1, 2).toLowerCase();
}

/** The first frame of a plain element-symbol XYZ. */
function parseXyz(source: string, id: string): ParsedAtom[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const count = Number(lines[0]?.trim());
  if (!Number.isInteger(count) || count <= 0) throw new Error(`${id}: bad XYZ atom count`);
  const atoms: ParsedAtom[] = [];
  for (const line of lines.slice(2, count + 2)) {
    const [rawSymbol, ...values] = line.trim().split(/\s+/);
    const symbol = normalizeSymbol(rawSymbol ?? '');
    const [x, y, z] = values.map(Number);
    if (![x, y, z].every(Number.isFinite) || !getElementSpecBySymbol(symbol)) {
      throw new Error(`${id}: bad XYZ atom line "${line}"`);
    }
    atoms.push({ symbol, x, y, z });
  }
  if (atoms.length !== count) throw new Error(`${id}: XYZ declares ${count} atoms, has ${atoms.length}`);
  return atoms;
}

/** Hill order: C, H, then the rest alphabetically (all alphabetical without carbon). */
function hillFormula(counts: Map<string, number>): string {
  const symbols = [...counts.keys()];
  const hasCarbon = counts.has('C');
  symbols.sort((a, b) => {
    if (hasCarbon) {
      const rank = (s: string) => (s === 'C' ? 0 : s === 'H' ? 1 : 2);
      const delta = rank(a) - rank(b);
      if (delta) return delta;
    }
    return a.localeCompare(b);
  });
  return symbols.map((s) => `${s}${counts.get(s)! > 1 ? counts.get(s) : ''}`).join('');
}

/** Drawn radius (Å): the viewer's ball-and-stick radius, lighter, with small hydrogens. */
function drawRadius(symbol: string): number {
  if (symbol === 'H') return 0.2;
  const spec = getElementSpecBySymbol(symbol)!;
  return round(0.9 * Math.min(0.7, Math.max(0.3, spec.radius * 0.5)), 3);
}

function shortLabel(label: string): string {
  return label.replace(' · planar', '');
}

interface Candidate extends InkDetent {
  priority: number;
  kind: string;
}

/** Projected spread of the atoms seen along `pose`: how much of the molecule the view shows. */
function spread(points: number[][], pose: InkPose): number {
  const sa = Math.sin(pose.azimuth);
  const ca = Math.cos(pose.azimuth);
  const se = Math.sin(pose.elevation);
  const ce = Math.cos(pose.elevation);
  let total = 0;
  for (const [x, y, z] of points) {
    const u = x * ca - z * sa;
    const v = -se * sa * x + ce * y - se * ca * z;
    total += u * u + v * v;
  }
  return total;
}

/** The turntable, its detents and the opening pose, from Object Facts' view detents. */
function turntable(points: number[][], atomicNumbers: number[]): { detents: InkDetent[]; opening: InkPose } {
  const facts = computeObjectFacts({
    atomicNumbers,
    positions: points.flat(),
    natoms: points.length,
  });
  const candidates: Candidate[] = (facts?.detents ?? []).map((d, priority) => ({
    azimuth: Math.atan2(d.dir[0], d.dir[2]),
    elevation: Math.asin(Math.max(-1, Math.min(1, d.dir[1]))),
    label: shortLabel(d.label),
    kind: d.kind,
    priority,
  }));

  let best: { el: number; gap: number; count: number; tie: number; onCircle: Candidate[] } | null = null;
  for (let el = EL_MIN_DEG; el <= EL_MAX_DEG + 1e-9; el += EL_STEP_DEG) {
    const near = candidates.filter((c) => Math.abs(c.elevation - el * DEG) <= BAND_DEG * DEG);
    // One stop per azimuth: the higher-priority detent wins a crowd.
    const onCircle: Candidate[] = [];
    for (const c of [...near].sort((a, b) => a.priority - b.priority)) {
      if (onCircle.some((o) => Math.abs(wrap(o.azimuth - c.azimuth)) < MERGE_AZ_DEG * DEG)) continue;
      onCircle.push(c);
    }
    if (onCircle.length < 2) continue;
    onCircle.sort((a, b) => a.azimuth - b.azimuth);
    let gap = 0;
    for (let i = 0; i < onCircle.length; i += 1) {
      const next = i + 1 < onCircle.length ? onCircle[i + 1].azimuth : onCircle[0].azimuth + 2 * Math.PI;
      gap = Math.max(gap, next - onCircle[i].azimuth);
    }
    const gapDeg = Math.round((gap / DEG) * 1000) / 1000;
    const tie = Math.abs(el - EL_PREFERRED_DEG);
    if (
      !best ||
      gapDeg < best.gap ||
      (gapDeg === best.gap && (onCircle.length > best.count || (onCircle.length === best.count && tie < best.tie)))
    ) {
      best = { el, gap: gapDeg, count: onCircle.length, tie, onCircle };
    }
  }

  if (!best) {
    // No turntable passes two detents: a free spin at 15°, opening on the widest view.
    const elevation = EL_PREFERRED_DEG * DEG;
    let opening: InkPose = { azimuth: OPENING_NEAR_DEG * DEG, elevation };
    let widest = -Infinity;
    for (let deg = -180; deg < 180; deg += 5) {
      const pose = { azimuth: deg * DEG, elevation };
      const s = spread(points, pose) * (1 - 1e-4 * Math.abs(wrap((deg - OPENING_NEAR_DEG) * DEG)));
      if (s > widest) {
        widest = s;
        opening = pose;
      }
    }
    return { detents: [], opening: { azimuth: round(opening.azimuth, 6), elevation: round(opening.elevation, 6) } };
  }

  const detents: InkDetent[] = best.onCircle.map((c) => ({
    azimuth: round(wrap(c.azimuth), 6),
    elevation: round(c.elevation, 6),
    label: c.label,
  }));
  // Open on the detent that shows the most of the molecule; faces win a near-tie.
  let opening = detents[0];
  let widest = -Infinity;
  best.onCircle.forEach((c, i) => {
    const face = c.kind === 'ring-face' || c.kind === 'plane-face' ? 1.04 : 1;
    const near = 1 - 0.02 * (Math.abs(wrap(c.azimuth - OPENING_NEAR_DEG * DEG)) / Math.PI);
    const s = spread(points, c) * face * near;
    if (s > widest) {
      widest = s;
      opening = detents[i];
    }
  });
  return { detents, opening: { azimuth: opening.azimuth, elevation: opening.elevation } };
}

function describe(entry: GalleryEntry, record: Omit<MoleculeRecord, 'description'>): string {
  const subtitle = entry.subtitle.replace(/\s+/g, ' ').trim();
  if (subtitle && !DEV_COPY.test(subtitle) && !GENERIC_COPY.test(subtitle)) return subtitle;
  if (!record.formula) return `${record.name}: a ${record.atoms}-atom coordinate model (${record.modelFormula}).`;
  const systematic =
    record.systematicName && record.systematicName.toLowerCase() !== record.name.toLowerCase()
      ? `, systematic name ${record.systematicName}`
      : '';
  const geometry = record.geometrySource?.replace(/ exported to XYZ$/i, '').replace(/ from PubChem 2D$/, ' of the PubChem 2D structure') ?? 'coordinate model';
  return `${record.name} (${record.formula})${systematic}: drawn from a ${record.atoms}-atom ${geometry}.`;
}

export interface CatalogOptions {
  repoRoot: string;
  /** The web app's public directory (coordinate files live here). */
  publicDir?: string;
}

export function buildMoleculeCatalog({ repoRoot, publicDir }: CatalogOptions): MoleculeRecord[] {
  const pub = publicDir ?? path.join(repoRoot, 'apps/web/public');
  const gallery = readJson<GalleryEntry[]>(path.join(repoRoot, 'packages/ui/src/gallery-data.json'));
  const nomenclature = readJson<{ entries: Record<string, NomenclatureEntry> }>(
    path.join(repoRoot, 'packages/ui/src/gallery-nomenclature.json'),
  ).entries;
  const sheet = readJson<{ entries: Record<string, unknown> }>(
    path.join(repoRoot, 'packages/ui/src/switcher/property-sheet.json'),
  ).entries;
  const libraryFacts = readJson<{ entries: Record<string, { facts?: Record<string, number> }> }>(
    path.join(repoRoot, 'packages/ui/src/library/library-facts.json'),
  ).entries;
  const prompts = new Map<string, { prompt: string; topic: string }>(
    STUDENT_COLLECTION.map((entry) => [entry.id, { prompt: entry.prompt, topic: entry.topic }]),
  );

  const records: MoleculeRecord[] = [];
  for (const entry of gallery) {
    if (!hasMoleculePageEntry(entry)) continue;
    try {
      records.push(buildRecord(entry));
    } catch (error) {
      // One bad file loses its page, never the deploy.
      console.warn(`[molecule-pages] skipped ${entry.id}: ${(error as Error).message}`);
    }
  }
  return records;

  function buildRecord(entry: GalleryEntry): MoleculeRecord {
    const source = fs.readFileSync(path.join(pub, entry.file), 'utf8');
    const atoms = parseXyz(source, entry.id);
    const sha256 = createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');

    // Centre on the bounds centre: the viewer fits its camera target there.
    const centre = (['x', 'y', 'z'] as const).map((axis) => {
      const values = atoms.map((atom) => atom[axis]);
      return (Math.min(...values) + Math.max(...values)) / 2;
    });
    const points = atoms.map((atom) => [atom.x - centre[0], atom.y - centre[1], atom.z - centre[2]]);
    const atomicNumbers = atoms.map((atom) => getAtomicNumberBySymbol(atom.symbol) ?? 6);

    const counts = new Map<string, number>();
    for (const atom of atoms) counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1);
    const modelFormula = hillFormula(counts);

    const kindIndex = new Map<string, number>();
    const kinds: InkKind[] = [];
    for (const symbol of counts.keys()) {
      kindIndex.set(symbol, kinds.length);
      kinds.push({ s: symbol, c: getElementSpecBySymbol(symbol)!.color, r: drawRadius(symbol) });
    }
    const k = atoms.map((atom) => kindIndex.get(atom.symbol)!);
    const radius = Math.max(
      ...points.map((p, i) => Math.hypot(p[0], p[1], p[2]) + kinds[k[i]].r),
    );
    const bonds = computeBonds(atomicNumbers, points.flat(), points.length).pairs.flat();
    const { detents, opening } = turntable(points, atomicNumbers);

    const model: InkModel = {
      p: points.flat().map((value) => round(value)),
      k,
      kinds,
      b: bonds,
      radius: round(radius),
      detents,
      opening,
    };

    const names = nomenclature[entry.id];
    const sourceBacked = names?.confidence === 'source-backed';
    const formula = sourceBacked ? names?.molecularFormula : undefined;
    const elements: ElementCount[] = [...counts.entries()]
      .map(([symbol, count]) => {
        const spec = getElementSpecBySymbol(symbol)!;
        return { symbol, name: spec.name, count, color: spec.color };
      })
      .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));

    const partial: Omit<MoleculeRecord, 'description'> = {
      id: entry.id,
      name: names?.preferredName && sourceBacked ? names.preferredName : entry.title,
      title: entry.title,
      domain: entry.domain,
      file: `/${entry.file}`,
      sha256,
      atoms: atoms.length,
      formula,
      modelFormula,
      molarMass: formula ? molarMass(formula) : undefined,
      systematicName: sourceBacked ? names?.systematicName : undefined,
      aliases: sourceBacked ? (names?.aliases ?? []) : [],
      pubchemCid: sourceBacked ? names?.pubchemCid : undefined,
      sourceUrl: sourceBacked ? names?.sourceUrl : undefined,
      geometrySource: names?.geometrySource,
      sheet: parsePropertyEvidence(sheet[entry.id]),
      prompt: prompts.get(entry.id)?.prompt,
      topic: prompts.get(entry.id)?.topic,
      elements,
      model,
      facets: libraryFacts[`gallery:${entry.id}`]?.facts ?? {},
    };
    return { ...partial, description: describe(entry, partial) };
  }
}

/** Up to `limit` other pages, nearest by library facets, shared elements and shelf. */
export function relatedMolecules(record: MoleculeRecord, all: MoleculeRecord[], limit = 6): MoleculeRecord[] {
  const norm = (facets: Record<string, number>) => Math.sqrt(Object.values(facets).reduce((s, v) => s + v * v, 0)) || 1;
  const mine = record.facets;
  const myNorm = norm(mine);
  const myElements = new Set(record.elements.map((e) => e.symbol));
  return all
    .filter((other) => other.id !== record.id)
    .map((other) => {
      let dot = 0;
      for (const [facet, value] of Object.entries(other.facets)) dot += (mine[facet] ?? 0) * value;
      const cosine = dot / (myNorm * norm(other.facets));
      const shared = other.elements.filter((e) => myElements.has(e.symbol)).length;
      const union = new Set([...myElements, ...other.elements.map((e) => e.symbol)]).size || 1;
      const score = cosine + 0.35 * (shared / union) + (other.domain === record.domain ? 0.15 : 0);
      return { other, score };
    })
    .sort((a, b) => b.score - a.score || a.other.id.localeCompare(b.other.id))
    .slice(0, limit)
    .map((entry) => entry.other);
}

