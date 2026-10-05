#!/usr/bin/env -S npx tsx
/**
 * bundle-starters.mts — the molecules the app ships with, so play works
 * offline on first launch. Copies gallery XYZ files where the gallery has
 * the molecule and writes the rest from experimental geometries, then a
 * manifest with each file's Hill formula and sha256:
 *
 *   apps/apple/LupiKit/Sources/LupiData/Resources/starters/<id>.xyz
 *   apps/apple/LupiKit/Sources/LupiData/Resources/starters/starters.json
 *
 *   pnpm exec tsx tools/apple/bundle-starters.mts [--check]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getElementSpec } from '../../packages/core/src/elements';
import { parseXyzText } from '../../packages/parsers/src/xyzParser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'apps/apple/LupiKit/Sources/LupiData/Resources/starters');
const GALLERY = 'apps/web/public/gallery/curated';

type Atom = [symbol: string, x: number, y: number, z: number];

interface StarterSpec {
  id: string;
  name: string;
  /** A gallery file, copied byte for byte. */
  gallery?: string;
  /** Or atoms written here, with where the geometry comes from. */
  atoms?: Atom[];
  geometry?: string;
}

const DEG = Math.PI / 180;

/** NH3: r(N–H) 1.012 Å, ∠HNH 106.7° (NIST CCCBDB experimental geometry). */
function ammonia(): Atom[] {
  const r = 1.012;
  const angle = 106.7 * DEG;
  // Three H on a cone about +z: the H–H chord fixes the cone's opening.
  const chord = 2 * r * Math.sin(angle / 2);
  const radial = chord / Math.sqrt(3);
  const height = Math.sqrt(r * r - radial * radial);
  const atoms: Atom[] = [['N', 0, 0, 0]];
  for (let k = 0; k < 3; k += 1) {
    const t = (2 * Math.PI * k) / 3;
    atoms.push(['H', radial * Math.cos(t), radial * Math.sin(t), -height]);
  }
  return atoms;
}

/** CH4: r(C–H) 1.087 Å, tetrahedral (NIST CCCBDB experimental geometry). */
function methane(): Atom[] {
  const s = 1.087 / Math.sqrt(3);
  return [['C', 0, 0, 0], ['H', s, s, s], ['H', s, -s, -s], ['H', -s, s, -s], ['H', -s, -s, s]];
}

/** A rock-salt Na4Cl4 cube at 2.820 Å, half NaCl's 5.640 Å lattice constant. */
function saltCube(): Atom[] {
  const a = 2.82;
  const atoms: Atom[] = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
    atoms.push([(x + y + z) % 2 === 0 ? 'Na' : 'Cl', a * x - a / 2, a * y - a / 2, a * z - a / 2]);
  }
  return atoms;
}

const STARTERS: StarterSpec[] = [
  {
    id: 'hydrogen',
    name: 'Hydrogen',
    atoms: [['H', -0.3707, 0, 0], ['H', 0.3707, 0, 0]],
    geometry: 'r(H-H) 0.7414 A, NIST CCCBDB experimental',
  },
  { id: 'water', name: 'Water', gallery: 'popular/water.xyz' },
  {
    id: 'carbon_dioxide',
    name: 'Carbon dioxide',
    atoms: [['C', 0, 0, 0], ['O', 1.16, 0, 0], ['O', -1.16, 0, 0]],
    geometry: 'r(C=O) 1.160 A linear, NIST CCCBDB experimental',
  },
  { id: 'methane', name: 'Methane', atoms: methane(), geometry: 'r(C-H) 1.087 A Td, NIST CCCBDB experimental' },
  { id: 'ammonia', name: 'Ammonia', atoms: ammonia(), geometry: 'r(N-H) 1.012 A, HNH 106.7 deg, NIST CCCBDB experimental' },
  { id: 'ethanol', name: 'Ethanol', gallery: 'popular/ethanol.xyz' },
  { id: 'benzene', name: 'Benzene', gallery: 'popular/benzene.xyz' },
  { id: 'caffeine', name: 'Caffeine', gallery: 'popular/caffeine.xyz' },
  { id: 'c60_buckyball', name: 'Buckminsterfullerene', gallery: 'c60_buckyball.xyz' },
  { id: 'glucose', name: 'Glucose', gallery: 'popular/glucose.xyz' },
  { id: 'salt_cluster', name: 'Salt cluster', atoms: saltCube(), geometry: 'rock-salt Na4Cl4, Na-Cl 2.820 A (a = 5.640 A)' },
  { id: 'tryptophan', name: 'Tryptophan', gallery: 'popular/tryptophan.xyz' },
  // M0's slice breaks it at its O–O bond (plan §8), and the gallery has no copy.
  {
    id: 'hydrogen_peroxide',
    name: 'Hydrogen peroxide',
    atoms: [['O', 0.7247, 0, 0], ['O', -0.7247, 0, 0], ['H', 0.8233, -0.7, -0.6676], ['H', -0.8233, -0.6175, 0.7446]],
    geometry: 'PubChem CID 784 3D conformer, r(O-O) 1.449 A',
  },
];

const fixed = (value: number) => {
  const text = value.toFixed(6);
  return text === '-0.000000' ? '0.000000' : text;
};

function hillFormula(symbols: string[]): string {
  const counts = new Map<string, number>();
  for (const symbol of symbols) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  const order: string[] = [];
  if (counts.has('C')) {
    order.push('C');
    if (counts.has('H')) order.push('H');
  }
  order.push(...[...counts.keys()].filter((symbol) => !order.includes(symbol)).sort());
  return order.map((symbol) => (counts.get(symbol) === 1 ? symbol : `${symbol}${counts.get(symbol)}`)).join('');
}

export function buildStarters(): Record<string, string> {
  const files: Record<string, string> = {};
  const entries = STARTERS.map((spec) => {
    let text: string;
    let source: string;
    if (spec.gallery) {
      source = `${GALLERY}/${spec.gallery}`;
      text = fs.readFileSync(path.join(ROOT, source), 'utf8');
    } else {
      source = 'tools/apple/bundle-starters.mts';
      const atoms = spec.atoms!;
      text = [
        String(atoms.length),
        `${spec.name.toLowerCase()} | source=lupi-starter geometry="${spec.geometry}"`,
        ...atoms.map(([symbol, x, y, z]) => `${symbol} ${fixed(x)} ${fixed(y)} ${fixed(z)}`),
        '',
      ].join('\n');
    }
    // Every starter must read back through the web's parser.
    const frame = parseXyzText(text, { maxFrames: 1 }).frames[0];
    const symbols = Array.from(frame.types, (z) => getElementSpec(z).symbol);
    const file = `${spec.id}.xyz`;
    files[file] = text;
    return {
      id: spec.id,
      name: spec.name,
      formula: hillFormula(symbols),
      atoms: frame.natoms,
      file,
      source,
      ...(spec.geometry ? { geometry: spec.geometry } : {}),
      sha256: createHash('sha256').update(text).digest('hex'),
    };
  });
  files['starters.json'] = `${JSON.stringify({
    schema: 'lupi.starters.v1',
    generator: 'tools/apple/bundle-starters.mts',
    starters: entries,
  }, null, 2)}\n`;
  return files;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = buildStarters();
  const check = process.argv.includes('--check');
  let stale = false;
  if (!check) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(OUT_DIR, name);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
        console.error(`${path.relative(ROOT, file)} is stale`);
        stale = true;
      }
    } else {
      fs.writeFileSync(file, text);
    }
  }
  if (check) {
    const extra = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((name) => !(name in files)) : [];
    for (const name of extra) console.error(`${name} is not a starter`);
    if (stale || extra.length > 0) {
      console.error('run pnpm exec tsx tools/apple/bundle-starters.mts');
      process.exit(1);
    }
    console.log(`${Object.keys(files).length - 1} starters are up to date`);
  } else {
    console.log(`wrote ${Object.keys(files).length - 1} starters and starters.json to ${path.relative(ROOT, OUT_DIR)}`);
  }
}
