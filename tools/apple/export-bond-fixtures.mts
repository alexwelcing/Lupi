#!/usr/bin/env -S npx tsx
/**
 * export-bond-fixtures.mts — golden fixtures for LupiKit's Swift ports.
 *
 * Runs the web's own code on a fixed set of inputs and writes what it
 * returns, so `swift test` can check the Swift port pair for pair:
 *
 *   bonds-omol25.json     the 24 committed OMol25 featured picks
 *   bonds-gallery.json    gallery molecules (caffeine, C60, water, benzene, …)
 *   bonds-synthetic.json  the bond unit-test geometries (diborane, ferrocene,
 *                         [Na(H2O)6]+, a 0.35 Å clash, …) and seeded clusters
 *   xyz-parse.json        parser cases: comment keys, layouts, line endings
 *
 * Each bond case runs both recipes (and a few tolerances); each run keeps the
 * pairs, kinds, Float32 distances, counts and removed pairs with reasons.
 *
 *   pnpm exec tsx tools/apple/export-bond-fixtures.mts
 *   pnpm exec tsx tools/apple/export-bond-fixtures.mts --check   # exit 1 when stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DISTANCE_RECIPE_ID,
  MOLECULAR_RECIPE_ID,
  perceiveBonds,
  type BondRecipeId,
  type PerceiveBondsInput,
} from '../../packages/core/src/bonds/index';
import { getAtomicNumberBySymbol } from '../../packages/core/src/elements';
import { parseXyzText } from '../../packages/parsers/src/xyzParser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'apps/apple/LupiKit/Tests/Fixtures/bonds');
const GALLERY = 'apps/web/public/gallery/curated';
const OMOL_FEATURED = 'apps/web/public/datasets/omol25/featured';

/** Gallery inputs: the four the brief names plus a spread of sizes, elements and ring systems. */
const GALLERY_FILES = [
  'popular/caffeine.xyz',
  'c60_buckyball.xyz',
  'popular/water.xyz',
  'popular/benzene.xyz',
  // Both atoms at the origin: the clash floor and d² = 0 path.
  'popular/sodium_chloride.xyz',
  'popular/ethanol.xyz',
  'popular/glucose.xyz',
  'popular/tryptophan.xyz',
  'popular/aspirin.xyz',
  'popular/cholesterol.xyz',
  'popular/atp.xyz',
  'popular/sucrose.xyz',
  'popular/nicotine.xyz',
  'popular/lsd.xyz',
  'popular/nitrous_oxide.xyz',
  'popular/oxygen.xyz',
  'popular/diamond_crystal.xyz',
  'organic/acetonitrile.xyz',
  'organic/nitrobenzene.xyz',
  'organic/bromobutane_1.xyz',
  'organic/dimethyl_sulfide.xyz',
  'organic/acetyl_chloride.xyz',
  'carbon_nanotube.xyz',
  'graphene_ribbon.xyz',
  'water_cluster.xyz',
];

type Atom = [symbol: string, x: number, y: number, z: number];

interface CaseInput {
  name: string;
  source: string;
  /** The file text, for cases that come from a file (the Swift test parses it too). */
  xyz?: string;
  atomicNumbers: number[];
  positions: Float32Array;
  periodic?: boolean;
  chemistry?: unknown;
  tolerances?: number[];
}

// ─── Synthetic geometries (packages/core/src/bonds/perceive.test.ts) ──

const norm = (v: number[]) => Math.hypot(...v);
const scale = (v: number[], s: number) => v.map((c) => c * s);
const add = (a: number[], b: number[]) => a.map((c, i) => c + b[i]);
const TETRAHEDRAL = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((v) => scale(v, 1 / Math.sqrt(3)));
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const at = (symbol: string, v: number[]): Atom => [symbol, v[0], v[1], v[2]];

function water(o: number[]): Atom[] {
  const e = scale(o, 1 / norm(o));
  const helper = Math.abs(e[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const f0 = add(helper, scale(e, -(helper[0] * e[0] + helper[1] * e[1] + helper[2] * e[2])));
  const f = scale(f0, 1 / norm(f0));
  const half = (104.5 / 2) * (Math.PI / 180);
  return [
    at('O', o),
    at('H', add(o, scale(add(scale(e, Math.cos(half)), scale(f, Math.sin(half))), 0.96))),
    at('H', add(o, scale(add(scale(e, Math.cos(half)), scale(f, -Math.sin(half))), 0.96))),
  ];
}

function ferrocene(): Atom[] {
  const atoms: Atom[] = [['Fe', 0, 0, 0]];
  for (const z of [1.66, -1.66]) {
    for (let k = 0; k < 5; k += 1) {
      const t = (2 * Math.PI * k) / 5;
      atoms.push(['C', 1.22 * Math.cos(t), 1.22 * Math.sin(t), z]);
    }
    for (let k = 0; k < 5; k += 1) {
      const t = (2 * Math.PI * k) / 5;
      atoms.push(['H', 2.3 * Math.cos(t), 2.3 * Math.sin(t), z]);
    }
  }
  return atoms;
}

const diborane = (): Atom[] => [
  ['B', 0.885, 0, 0], ['B', -0.885, 0, 0], ['H', 0, 0.99, 0], ['H', 0, -0.99, 0],
  ['H', 1.485, 0, 1.03], ['H', 1.485, 0, -1.03], ['H', -1.485, 0, 1.03], ['H', -1.485, 0, -1.03],
];

function cisplatin(): Atom[] {
  const atoms: Atom[] = [['Pt', 0, 0, 0], ['N', 2.05, 0, 0], ['N', 0, 2.05, 0], ['Cl', -2.32, 0, 0], ['Cl', 0, -2.32, 0]];
  const amine = (n: number[], e: number[], u: number[], v: number[]) => {
    for (let k = 0; k < 3; k += 1) {
      const t = (2 * Math.PI * k) / 3;
      const side = add(scale(u, Math.cos(t)), scale(v, Math.sin(t)));
      atoms.push(at('H', add(n, scale(add(scale(e, 0.334), scale(side, 0.943)), 1.01))));
    }
  };
  amine([2.05, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  amine([0, 2.05, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  return atoms;
}

function potassiumSulfonate(): Atom[] {
  const [d1, d2, d3, d4] = TETRAHEDRAL;
  return [at('S', [0, 0, 0]), at('O', scale(d1, 1.45)), at('O', scale(d2, 1.45)), at('O', scale(d3, 1.45)),
    at('C', scale(d4, 1.77)), at('K', [3.319, 0, 0])];
}

function potassiumInTwelveWaters(): Atom[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const vertices = [
    [0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi],
    [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0],
    [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1],
  ].map((v) => scale(v, 1 / norm(v)));
  return [['K', 0, 0, 0], ...vertices.map((v, k) => at('O', scale(v, 2.8 + 0.01 * k)))];
}

function iodineHeptafluoride(): Atom[] {
  const atoms: Atom[] = [['I', 0, 0, 0], ['F', 0, 0, 1.79], ['F', 0, 0, -1.79]];
  for (let k = 0; k < 5; k += 1) {
    const t = (2 * Math.PI * k) / 5;
    atoms.push(['F', 1.86 * Math.cos(t), 1.86 * Math.sin(t), 0]);
  }
  return atoms;
}

/** A rock-salt Na4Cl4 cube at the crystal's 2.82 Å, as the app's salt starter. */
function saltCube(): Atom[] {
  const atoms: Atom[] = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
    atoms.push([(x + y + z) % 2 === 0 ? 'Na' : 'Cl', 2.82 * x, 2.82 * y, 2.82 * z]);
  }
  return atoms;
}

/** mulberry32, as the web's fuzz tests. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_ELEMENTS = ['H', 'H', 'H', 'H', 'C', 'C', 'C', 'N', 'O', 'O', 'F', 'S', 'P', 'Cl', 'Br', 'I', 'B', 'Si', 'Xe', 'Li', 'Na', 'K', 'Mg', 'Ca', 'Fe', 'Mn', 'Pt', 'Zn', 'Ar'];

function randomCluster(seed: number, count: number, box: number): { atoms: Atom[]; tolerance: number } {
  const rand = prng(seed);
  const atoms: Atom[] = [];
  for (let k = 0; k < count; k += 1) {
    atoms.push([FUZZ_ELEMENTS[Math.floor(rand() * FUZZ_ELEMENTS.length)], rand() * box, rand() * box, rand() * box]);
  }
  return { atoms, tolerance: rand() < 0.5 ? 0.45 : rand() * 1.5 };
}

function fromAtoms(name: string, atoms: Atom[], tolerances?: number[]): CaseInput {
  return {
    name,
    source: 'synthetic',
    atomicNumbers: atoms.map(([symbol]) => {
      const z = getAtomicNumberBySymbol(symbol);
      if (z === undefined) throw new Error(`unknown symbol ${symbol}`);
      return z;
    }),
    positions: Float32Array.from(atoms.flatMap(([, x, y, z]) => [x, y, z])),
    tolerances,
  };
}

function fromFile(relative: string, name: string, tolerances?: number[]): CaseInput {
  const xyz = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  const frame = parseXyzText(xyz, { maxFrames: 1 }).frames[0];
  return {
    name,
    source: relative,
    xyz,
    atomicNumbers: Array.from(frame.types),
    positions: frame.positions,
    periodic: frame.periodic,
    chemistry: frame.chemistry ?? null,
    tolerances,
  };
}

// ─── Runs ─────────────────────────────────────────────────────────────

const f32 = (values: ArrayLike<number>) => Array.from(values, (v) => Math.fround(v));

function runCase(input: CaseInput) {
  const tolerances = input.tolerances ?? [0.45];
  const runs = [];
  for (const recipe of [MOLECULAR_RECIPE_ID, DISTANCE_RECIPE_ID] as BondRecipeId[]) {
    for (const tolerance of tolerances) {
      const bondInput: PerceiveBondsInput = {
        atomicNumbers: input.atomicNumbers,
        positions: input.positions,
        natoms: input.atomicNumbers.length,
        tolerance,
        recipe,
      };
      const p = perceiveBonds(bondInput);
      runs.push({
        recipe,
        tolerance,
        appliedTolerance: p.params.tolerance,
        count: p.count,
        pairs: Array.from(p.pairs),
        kinds: Array.from(p.kinds),
        distances: f32(p.distances),
        counts: p.counts,
        evidence: p.evidence
          ? { pairs: Array.from(p.evidence.pairs), reasons: Array.from(p.evidence.reasons) }
          : null,
      });
    }
  }
  return {
    name: input.name,
    source: input.source,
    ...(input.xyz !== undefined ? { xyz: input.xyz } : {}),
    ...(input.periodic !== undefined ? { periodic: input.periodic } : {}),
    ...(input.chemistry !== undefined ? { chemistry: input.chemistry } : {}),
    atomicNumbers: input.atomicNumbers,
    positions: f32(input.positions),
    runs,
  };
}

function fixtureFile(description: string, inputs: CaseInput[]) {
  return {
    schema: 'lupi.apple-fixtures.bonds.v1',
    generator: 'tools/apple/export-bond-fixtures.mts',
    description,
    cases: inputs.map(runCase),
  };
}

// ─── XYZ parser cases ─────────────────────────────────────────────────

const PARSE_CASES: Array<{ name: string; xyz: string; maxFrames?: number }> = [
  { name: 'plain', xyz: '3\nwater\nO 0 0 0.1173\nH 0 0.7572 -0.4692\nH 0 -0.7572 -0.4692\n' },
  { name: 'crlf-bom', xyz: '﻿2\r\nhydrogen\r\nH 0 0 0\r\nH 0.7414 0 0\r\n' },
  { name: 'atomic-numbers-and-case', xyz: '3\n\n8 0 0 0\nh 0.96 0 0\n+1 -0.24 0.93 0\n' },
  { name: 'charge-multiplicity', xyz: '2\ncharge=-1 multiplicity=2 data_id=elytes\nO 0 0 0\nH 0.97 0 0\n' },
  { name: 'spin-multiplicity-alias', xyz: '1\nspin_multiplicity=3 spin=1\nO 0 0 0\n' },
  { name: 'bare-spin-ignored', xyz: '1\nspin=2\nO 0 0 0\n' },
  { name: 'charge-source-only', xyz: '1\ncharge_source=split-definition\nC 0 0 0\n' },
  { name: 'charge-out-of-range', xyz: '1\ncharge=99 multiplicity=0\nC 0 0 0\n' },
  { name: 'charge-decimal-integer', xyz: '1\ncharge=1.0 multiplicity="2"\nNa 0 0 0\n' },
  { name: 'unknown-charge-source', xyz: '1\ncharge=0 charge_source=guess\nC 0 0 0\n' },
  { name: 'lattice-periodic', xyz: '1\nLattice="3.6 0 0 0 3.6 0 0 0 3.6" Properties=species:S:1:pos:R:3\nCu 0 0 0\n' },
  { name: 'lattice-malformed', xyz: '1\nLattice="1 2 3"\nCu 0 0 0\n' },
  {
    name: 'properties-layout',
    xyz: '2\nProperties=id:I:1:species:S:1:pos:R:3:forces:R:3 energy=-1.5\n1 C 0 0 0 0.1 0.2 0.3\n2 O 1.2 0 0 0 0 0\n',
  },
  { name: 'properties-generic-r3', xyz: '1\nProperties=element:S:1:xyz:R:3\nN 1 2 3\n' },
  { name: 'timestep-key', xyz: '1\nstep=42\nHe 0 0 0\n' },
  { name: 'timestep-bare', xyz: '1\n7\nHe 0 0 0\n' },
  { name: 'quoted-values', xyz: "1\nname='hello world' charge = 2 comment=\"a b\"\nFe 0 0 0\n" },
  {
    name: 'omol25-record',
    xyz: fs.readFileSync(path.join(ROOT, OMOL_FEATURED, 'omol25_nv_1008.xyz'), 'utf8'),
  },
  {
    name: 'multi-frame',
    xyz: '2\nframe one\nH 0 0 0\nH 0.74 0 0\n\n\n2\nframe two charge=0\nH 0 0 0\nH 0.80 0 0\n',
  },
  { name: 'multi-frame-first-only', xyz: '1\na\nH 0 0 0\n1\nb\nH 1 1 1\n', maxFrames: 1 },
  { name: 'scientific-coordinates', xyz: '2\n\nC 1.5e0 -2.25E-1 +3.\nC .5 1e-3 123456789.123456789\n' },
  { name: 'trailing-count-only', xyz: '1\nx\nC 0 0 0\n5' },
  { name: 'error-unknown-element', xyz: '1\n\nQq 0 0 0\n' },
  { name: 'error-atomic-number-range', xyz: '1\n\n119 0 0 0\n' },
  { name: 'error-bad-count', xyz: 'three\n\nC 0 0 0\n' },
  { name: 'error-short-row', xyz: '1\n\nC 0 0\n' },
  { name: 'error-bad-coordinate', xyz: '1\n\nC 0 0 1abc\n' },
  { name: 'error-truncated', xyz: '3\n\nC 0 0 0\n' },
  { name: 'error-empty', xyz: '\n\n' },
];

function parseCases() {
  return {
    schema: 'lupi.apple-fixtures.xyz-parse.v1',
    generator: 'tools/apple/export-bond-fixtures.mts',
    cases: PARSE_CASES.map(({ name, xyz, maxFrames }) => {
      try {
        const { frames } = parseXyzText(xyz, maxFrames ? { maxFrames } : {});
        return {
          name,
          xyz,
          ...(maxFrames ? { maxFrames } : {}),
          frames: frames.map((frame) => ({
            atomicNumbers: Array.from(frame.types),
            positions: f32(frame.positions),
            periodic: frame.periodic ?? false,
            timestep: frame.timestep,
            chemistry: frame.chemistry ?? null,
            sourceRecord: frame.sourceRecord
              ? { ...frame.sourceRecord, dataset: undefined }
              : null,
          })),
          error: null,
        };
      } catch (error) {
        return { name, xyz, frames: [], error: (error as Error).message };
      }
    }),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────

export function buildFixtures(): Record<string, unknown> {
  const omol = fs.readdirSync(path.join(ROOT, OMOL_FEATURED))
    .filter((name) => name.endsWith('.xyz'))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((name) => fromFile(`${OMOL_FEATURED}/${name}`, name.replace(/\.xyz$/, '')));
  if (omol.length !== 24) throw new Error(`expected 24 OMol25 featured picks, found ${omol.length}`);

  const gallery = GALLERY_FILES.map((file) => fromFile(
    `${GALLERY}/${file}`,
    path.basename(file, '.xyz'),
    file === 'popular/caffeine.xyz' ? [0.45, 0, 1.0, 9, -1] : undefined,
  ));

  const synthetic: CaseInput[] = [
    fromAtoms('diborane', diborane()),
    fromAtoms('ferrocene', ferrocene(), [0.45, 0.2, 1.2]),
    fromAtoms('sodium-hexaaqua', [['Na', 0, 0, 0], ...AXES.flatMap((d) => water(scale(d, 2.42)))]),
    fromAtoms('clash-0.35', [['C', 0, 0, 0], ['H', 0.35, 0, 0]]),
    fromAtoms('water', [['O', 0, 0, 0.1173], ['H', 0, 0.7572, -0.4692], ['H', 0, -0.7572, -0.4692]]),
    fromAtoms('methane', [at('C', [0, 0, 0]), ...TETRAHEDRAL.map((d) => at('H', scale(d, 1.09)))]),
    fromAtoms('hydrogen', [['H', 0, 0, 0], ['H', 0.74, 0, 0]]),
    fromAtoms('eta2-dihydrogen-tungsten', [['W', 0, 0, 0], ['H', -0.41, 0, 1.84], ['H', 0.41, 0, 1.84]]),
    fromAtoms('crowded-hh', [['C', 0, 0, 0], ['H', 1.09, 0, 0], ['H', 2.09, 0, 0], ['C', 3.18, 0, 0]]),
    fromAtoms('stretched-ch', [['C', 0, 0, 0], ['H', 1.09, 0, 0], ['C', 2.5, 0, 0]]),
    fromAtoms('perchlorate', [['Cl', 0, 0, 0], ...TETRAHEDRAL.map((d) => at('O', scale(d, 1.44)))]),
    fromAtoms('hexafluorophosphate', [['P', 0, 0, 0], ...AXES.map((d) => at('F', scale(d, 1.6)))]),
    fromAtoms('iodine-heptafluoride', iodineHeptafluoride()),
    fromAtoms('chlorine-between-carbons', [['C', -1.78, 0, 0], ['Cl', 0, 0, 0], ['C', 1.95, 0, 0]]),
    fromAtoms('potassium-sulfonate', potassiumSulfonate()),
    fromAtoms('potassium-twelve-waters', potassiumInTwelveWaters()),
    fromAtoms('francium-iodide', [['Fr', 0, 0, 0], ['I', 4.3, 0, 0]]),
    fromAtoms('lithium-near-carbon', [['Li', 0, 0, 0], ['C', 2.1, 0, 0]]),
    fromAtoms('cisplatin', cisplatin()),
    fromAtoms('salt-cube', saltCube()),
    fromAtoms('xenon-difluoride', [['Xe', 0, 0, 0], ['F', 2.0, 0, 0], ['F', -2.0, 0, 0], ['C', 0, 2.1, 0]]),
    fromAtoms('single-atom', [['C', 0, 0, 0]]),
    fromAtoms('far-flung', [['C', 0, 0, 0], ['H', 1.09, 0, 0], ['C', 900, 0, 0], ['O', 901.2, 0, 0], ['N', 0, -800, 400]]),
    ...[1, 2, 3, 4, 5].map((seed) => {
      const { atoms } = randomCluster(seed, 80, 8);
      return fromAtoms(`cluster-${seed}`, atoms, [0.45]);
    }),
    ...Array.from({ length: 20 }, (_, k) => 100 + k).map((seed) => {
      const { atoms, tolerance } = randomCluster(seed, 40 + (seed % 5) * 20, 6 + (seed % 4));
      return fromAtoms(`fuzz-${seed}`, atoms, [tolerance]);
    }),
  ];

  return {
    'bonds-omol25.json': fixtureFile('The 24 OMol25 featured picks (apps/web/public/datasets/omol25/featured).', omol),
    'bonds-gallery.json': fixtureFile('Gallery molecules (apps/web/public/gallery/curated).', gallery),
    'bonds-synthetic.json': fixtureFile('The bond unit-test geometries and seeded mulberry32 clusters.', synthetic),
    'xyz-parse.json': parseCases(),
  };
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = buildFixtures();
  const check = process.argv.includes('--check');
  let stale = false;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(OUT_DIR, name);
    const text = `${JSON.stringify(value)}\n`;
    if (check) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (current !== text) {
        console.error(`${path.relative(ROOT, file)} is stale`);
        stale = true;
      }
    } else {
      fs.writeFileSync(file, text);
      const cases = (value as { cases: unknown[] }).cases.length;
      console.log(`wrote ${path.relative(ROOT, file)} (${cases} cases, ${(text.length / 1024).toFixed(0)} KB)`);
    }
  }
  if (stale) {
    console.error('run pnpm exec tsx tools/apple/export-bond-fixtures.mts');
    process.exit(1);
  }
}
