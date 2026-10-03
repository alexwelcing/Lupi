/**
 * After the molecule pages: the ink drawings of the featured OMol25 picks,
 * written into apps/web/dist from the committed same-origin XYZ files.
 *
 *   /og/omol25/<key>-ink.svg   the drawing at its opening pose (home shelf,
 *                              Library shelves, finder and switcher tiles)
 *   /og/omol25/<key>-ink.json  its model (ink.ts InkModel, with `bk` kinds)
 *
 * The lines are lupi-bonds.molecular.v1 at τ 0.45, perceived on the parser's
 * Float32 coordinates, so a tile shows the graph the viewer draws for the
 * file: covalent sticks, dashed metal coordination, dotted ionic contacts.
 * The pose is the /m catalog's turntable, its ring faces taken from the same
 * graph. OMol25 supplies no bonds; none of these lines is source data.
 *
 *   tsx scripts/omol25-picks/build.mts
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOND_KIND, DEFAULT_BOND_TOLERANCE, MOLECULAR_RECIPE_ID, perceiveBonds } from '../../packages/core/src/bonds/index.ts';
import { getAtomicNumberBySymbol, getElementSpecBySymbol } from '../../packages/core/src/elements.ts';
import { omolTitle, type OmolFeaturedFileV1, type OmolFeaturedPickV1 } from '../../packages/core/src/omol25/index.ts';
import { inkSvgMarkup, type InkKind, type InkModel } from '../../packages/ui/src/moleculePage/ink.ts';
import { drawRadius, turntable } from '../molecule-pages/catalog.mts';

const FEATURED_FILE = 'apps/web/public/datasets/omol25/featured.v1.json';
const PUBLIC_DIR = 'apps/web/public';
const OUT_DIR = 'og/omol25';

const round = (value: number, digits = 3) => {
  const r = Number(value.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

interface PickAtoms {
  symbols: string[];
  atomicNumbers: number[];
  /** As the viewer's XYZ parser holds them, so the perceived graph matches. */
  positions: Float32Array;
}

/** The atom block of an edge-format XYZ (count, comment, `El x y z` lines). */
export function parsePickXyz(text: string, id: string): PickAtoms {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const count = Number(lines[0]?.trim());
  if (!Number.isInteger(count) || count <= 0) throw new Error(`${id}: bad XYZ atom count`);
  const symbols: string[] = [];
  const atomicNumbers: number[] = [];
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const [symbol, ...values] = (lines[i + 2] ?? '').trim().split(/\s+/);
    const z = getAtomicNumberBySymbol(symbol ?? '');
    const xyz = values.slice(0, 3).map(Number);
    if (!z || !getElementSpecBySymbol(symbol) || xyz.length < 3 || !xyz.every(Number.isFinite)) {
      throw new Error(`${id}: bad XYZ atom line ${i + 3}`);
    }
    symbols.push(symbol);
    atomicNumbers.push(z);
    positions.set(xyz, 3 * i);
  }
  return { symbols, atomicNumbers, positions };
}

/** One pick's drawing model: perceived bonds with kinds, catalog radii and turntable pose. */
export function pickInkModel(atoms: PickAtoms): InkModel {
  const { symbols, atomicNumbers, positions } = atoms;
  const natoms = symbols.length;
  const perceived = perceiveBonds({
    atomicNumbers,
    positions,
    natoms,
    tolerance: DEFAULT_BOND_TOLERANCE,
    recipe: MOLECULAR_RECIPE_ID,
    collectEvidence: false,
  });

  // Centre on the bounds centre: the viewer fits its camera target there.
  const centre = [0, 1, 2].map((axis) => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < natoms; i += 1) {
      min = Math.min(min, positions[3 * i + axis]);
      max = Math.max(max, positions[3 * i + axis]);
    }
    return (min + max) / 2;
  });
  const points = Array.from({ length: natoms }, (_, i) => [0, 1, 2].map((axis) => positions[3 * i + axis] - centre[axis]));

  const kindIndex = new Map<string, number>();
  const kinds: InkKind[] = [];
  for (const symbol of symbols) {
    if (kindIndex.has(symbol)) continue;
    kindIndex.set(symbol, kinds.length);
    kinds.push({ s: symbol, c: getElementSpecBySymbol(symbol)!.color, r: drawRadius(symbol) });
  }
  const k = symbols.map((symbol) => kindIndex.get(symbol)!);
  const radius = Math.max(...points.map((p, i) => Math.hypot(p[0], p[1], p[2]) + kinds[k[i]].r));

  // Ring faces and symmetry follow covalent and coordination lines, never contacts.
  const framePairs: number[] = [];
  for (let b = 0; b < perceived.count; b += 1) {
    if (perceived.kinds[b] === BOND_KIND.ionicContact) continue;
    framePairs.push(perceived.pairs[2 * b], perceived.pairs[2 * b + 1]);
  }
  const { detents, opening } = turntable(points, atomicNumbers, framePairs);

  return {
    p: points.flat().map((value) => round(value)),
    k,
    kinds,
    b: Array.from(perceived.pairs.subarray(0, 2 * perceived.count)),
    bk: Array.from(perceived.kinds.subarray(0, perceived.count)),
    radius: round(radius),
    detents,
    opening,
  };
}

export function pickInkSvg(pick: Pick<OmolFeaturedPickV1, 'title'>, model: InkModel): string {
  return `${inkSvgMarkup(model, model.opening, {
    idPrefix: 'ink',
    title: `${omolTitle(pick.title)}, ink drawing`,
    attrs: { width: '400', height: '400' },
  })}\n`;
}

export interface PickInkReport {
  drawings: number;
  failures: string[];
}

/** Write every pick's drawing and model under `<distRoot>/og/omol25/`. */
export function writeOmolPickInk(repoRoot: string, distRoot: string): PickInkReport {
  const file = JSON.parse(fs.readFileSync(path.join(repoRoot, FEATURED_FILE), 'utf8')) as OmolFeaturedFileV1;
  const outDir = path.join(distRoot, OUT_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  const failures: string[] = [];
  let drawings = 0;
  for (const pick of file.picks) {
    try {
      const text = fs.readFileSync(path.join(repoRoot, PUBLIC_DIR, pick.xyz), 'utf8');
      const sha = createHash('sha256').update(text, 'utf8').digest('hex');
      if (sha !== pick.sha256) failures.push(`${pick.id}: XYZ sha256 ${sha} does not match its receipt ${pick.sha256}`);
      const model = pickInkModel(parsePickXyz(text, pick.id));
      const ink = path.join(distRoot, pick.ink);
      fs.writeFileSync(ink, pickInkSvg(pick, model));
      fs.writeFileSync(ink.replace(/\.svg$/, '.json'), JSON.stringify(model));
      drawings += 1;
    } catch (error) {
      failures.push(`${pick.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { drawings, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const started = Date.now();
  const report = writeOmolPickInk(repoRoot, path.join(repoRoot, 'apps/web/dist'));
  for (const failure of report.failures) console.warn(`[omol25-picks] ${failure}`);
  console.log(`Drew ${report.drawings} OMol25 pick ink drawings in ${Date.now() - started} ms.`);
}
