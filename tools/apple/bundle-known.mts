#!/usr/bin/env -S npx tsx
/**
 * bundle-known.mts — the molecules a built molecule is named after (plan
 * §4.5, "Done"): every gallery page and featured OMol25 pick of at most 256
 * atoms that is one connected piece, as its elements and the links
 * lupi-bonds.molecular.v1 perceives in it (forced, as the game plays every
 * molecule). LupiKit matches a built molecule's graph against these, so the
 * app ships graphs, not coordinates:
 *
 *   apps/apple/LupiKit/Sources/LupiData/Resources/known-molecules.json
 *
 *   pnpm exec tsx tools/apple/bundle-known.mts [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOLECULAR_RECIPE_ID, perceiveBonds } from '../../packages/core/src/bonds/index';
import { getElementSpec } from '../../packages/core/src/elements';
import { parseXyzText } from '../../packages/parsers/src/xyzParser';
import { loadMoleculeSite } from '../../scripts/molecule-pages/build.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'apps/apple/LupiKit/Sources/LupiData/Resources/known-molecules.json');
const FEATURED = 'apps/web/public/datasets/omol25/featured.v1.json';
/** Larger structures are never built by hand; the cap keeps the bundle small. */
const MAX_ATOMS = 256;

interface Known {
  id: string;
  name: string;
  source: 'gallery' | 'omol25';
  formula: string;
  z: number[];
  /** [i, j, kind] with i < j; kind 0 covalent, 1 coordination, 2 ionic contact. */
  links: [number, number, number][];
}

interface FeaturedPick {
  id: string;
  collection: string;
  row: number;
  name: string | null;
  title: string;
  xyz: string;
}

function hillFormula(z: number[]): string {
  const counts = new Map<string, number>();
  for (const n of z) {
    const symbol = getElementSpec(n).symbol;
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  const order: string[] = [];
  if (counts.has('C')) {
    order.push('C');
    if (counts.has('H')) order.push('H');
  }
  order.push(...[...counts.keys()].filter((symbol) => !order.includes(symbol)).sort());
  return order.map((symbol) => (counts.get(symbol) === 1 ? symbol : `${symbol}${counts.get(symbol)}`)).join('');
}

/** The molecule's play graph, or null when it is too big or in more than one piece. */
function graphOf(text: string): Pick<Known, 'formula' | 'z' | 'links'> | null {
  const frame = parseXyzText(text, { maxFrames: 1 }).frames[0];
  if (frame.natoms < 1 || frame.natoms > MAX_ATOMS) return null;
  const z = Array.from(frame.types);
  const p = perceiveBonds({
    atomicNumbers: z, positions: frame.positions, natoms: frame.natoms, tolerance: 0.45, recipe: MOLECULAR_RECIPE_ID,
    collectEvidence: false,
  });
  const links: [number, number, number][] = [];
  const parent = z.map((_, k) => k);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let k = 0; k < p.count; k += 1) {
    const i = p.pairs[2 * k];
    const j = p.pairs[2 * k + 1];
    links.push([i, j, p.kinds[k]]);
    parent[find(i)] = find(j);
  }
  const roots = new Set(z.map((_, k) => find(k)));
  if (roots.size !== 1) return null;
  return { formula: hillFormula(z), z, links };
}

export function buildKnown(): { text: string; skipped: string[] } {
  const known: Known[] = [];
  const skipped: string[] = [];
  const site = loadMoleculeSite(ROOT);
  for (const record of site.records) {
    if (!record.file.endsWith('.xyz')) continue;
    const text = fs.readFileSync(path.join(ROOT, 'apps/web/public', record.file), 'utf8');
    const graph = graphOf(text);
    if (!graph) {
      skipped.push(record.id);
      continue;
    }
    known.push({ id: record.id, name: record.name, source: 'gallery', ...graph });
  }
  const featured = JSON.parse(fs.readFileSync(path.join(ROOT, FEATURED), 'utf8')) as { picks: FeaturedPick[] };
  for (const pick of featured.picks) {
    const text = fs.readFileSync(path.join(ROOT, 'apps/web/public', pick.xyz), 'utf8');
    const graph = graphOf(text);
    if (!graph) {
      skipped.push(pick.id);
      continue;
    }
    known.push({ id: `${pick.collection}:${pick.row}`, name: pick.name ?? pick.title, source: 'omol25', ...graph });
  }
  const text = `${JSON.stringify({
    schema: 'lupi.known-molecules.v1',
    generator: 'tools/apple/bundle-known.mts',
    recipe: MOLECULAR_RECIPE_ID,
    maxAtoms: MAX_ATOMS,
    molecules: known,
  })}\n`;
  return { text, skipped };
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { text, skipped } = buildKnown();
  const count = (JSON.parse(text) as { molecules: unknown[] }).molecules.length;
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== text) {
      console.error(`${path.relative(ROOT, OUT)} is stale; run pnpm exec tsx tools/apple/bundle-known.mts`);
      process.exit(1);
    }
    console.log(`${count} known molecules are up to date`);
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    console.log(`wrote ${count} known molecules to ${path.relative(ROOT, OUT)} (skipped ${skipped.join(', ') || 'none'})`);
  }
}
