/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getAtomicNumberBySymbol } from '../elements';
import {
  BOND_KIND,
  CLASH_FLOOR_A,
  DISTANCE_RECIPE_ID,
  DONOR_RADII,
  ELEMENT_CLASS,
  ION_RADII,
  MAX_ION_CONTACT_A,
  MOLECULAR_RECIPE_ID,
  REMOVAL_REASON,
  VALENCE_CAPS,
  covalentRadius,
  elementClass,
  filterPerceivedBonds,
  metalRadius,
  perceiveBonds,
  type PerceiveBondsInput,
  type PerceivedBonds,
} from './index';
import { perceiveBondsWith } from './perceive';

const GALLERY = join(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/public/gallery/curated');

type Atom = [symbol: string, x: number, y: number, z: number];

function molecule(atoms: Atom[], tolerance?: number): PerceiveBondsInput {
  return {
    atomicNumbers: atoms.map(([symbol]) => {
      const z = getAtomicNumberBySymbol(symbol);
      if (z === undefined) throw new Error(`unknown symbol ${symbol}`);
      return z;
    }),
    positions: Float32Array.from(atoms.flatMap(([, x, y, z]) => [x, y, z])),
    natoms: atoms.length,
    tolerance,
  };
}

function readXyz(file: string): PerceiveBondsInput {
  const lines = readFileSync(join(GALLERY, file), 'utf8').split(/\r?\n/);
  const natoms = Number(lines[0]);
  return molecule(lines.slice(2, 2 + natoms).map((line) => {
    const [symbol, x, y, z] = line.trim().split(/\s+/);
    return [symbol, Number(x), Number(y), Number(z)];
  }));
}

/** Bonds of one kind as "i-j" strings. */
function bonds(p: PerceivedBonds, kind?: number): string[] {
  const out: string[] = [];
  for (let k = 0; k < p.count; k += 1) {
    if (kind === undefined || p.kinds[k] === kind) out.push(`${p.pairs[2 * k]}-${p.pairs[2 * k + 1]}`);
  }
  return out;
}

function partners(p: PerceivedBonds, atom: number, kind?: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < p.count; k += 1) {
    if (kind !== undefined && p.kinds[k] !== kind) continue;
    if (p.pairs[2 * k] === atom) out.push(p.pairs[2 * k + 1]);
    else if (p.pairs[2 * k + 1] === atom) out.push(p.pairs[2 * k]);
  }
  return out;
}

function removed(p: PerceivedBonds, reason?: number): string[] {
  const e = p.evidence!;
  const out: string[] = [];
  for (let k = 0; k < e.reasons.length; k += 1) {
    if (reason === undefined || e.reasons[k] === reason) out.push(`${e.pairs[2 * k]}-${e.pairs[2 * k + 1]}`);
  }
  return out;
}

const norm = (v: number[]) => Math.hypot(...v);
const scale = (v: number[], s: number) => v.map((c) => c * s);
const add = (a: number[], b: number[]) => a.map((c, i) => c + b[i]);
const TETRAHEDRAL = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((v) => scale(v, 1 / Math.sqrt(3)));
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const at = (symbol: string, v: number[]): Atom => [symbol, v[0], v[1], v[2]];

/** A water whose O sits at `o` with both H pointing away from the origin. */
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

function diborane(): Atom[] {
  return [
    ['B', 0.885, 0, 0],
    ['B', -0.885, 0, 0],
    ['H', 0, 0.99, 0],
    ['H', 0, -0.99, 0],
    ['H', 1.485, 0, 1.03],
    ['H', 1.485, 0, -1.03],
    ['H', -1.485, 0, 1.03],
    ['H', -1.485, 0, -1.03],
  ];
}

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

/** K⁺ chelated by two O of a methanesulfonate; the S sits 3.32 Å from K, inside its contact cutoff. */
function potassiumSulfonate(): Atom[] {
  const [d1, d2, d3, d4] = TETRAHEDRAL;
  return [
    at('S', [0, 0, 0]),
    at('O', scale(d1, 1.45)),
    at('O', scale(d2, 1.45)),
    at('O', scale(d3, 1.45)),
    at('C', scale(d4, 1.77)),
    at('K', [3.319, 0, 0]),
  ];
}

describe('lupi-bonds.molecular.v1: organic', () => {
  it('water, methane and caffeine get their covalent bonds and nothing else', () => {
    const w = perceiveBonds(molecule([['O', 0, 0, 0.1173], ['H', 0, 0.7572, -0.4692], ['H', 0, -0.7572, -0.4692]]));
    expect(bonds(w)).toEqual(['0-1', '0-2']);
    expect(w.counts).toMatchObject({ covalent: 2, coordination: 0, ionicContact: 0, removed: 0, fragments: 1 });

    const m = perceiveBonds(molecule([at('C', [0, 0, 0]), ...TETRAHEDRAL.map((d) => at('H', scale(d, 1.09)))]));
    expect(bonds(m)).toEqual(['0-1', '0-2', '0-3', '0-4']);

    const c = perceiveBonds(readXyz('popular/caffeine.xyz'));
    expect(c.recipe).toBe(MOLECULAR_RECIPE_ID);
    expect(c.counts.covalent).toBe(25);
    expect(c.counts.removed).toBe(0);
    expect(c.counts.fragments).toBe(1);
  });

  it('the distance recipe on caffeine is exactly r_i + r_j + 0.45 over every pair', () => {
    const input = readXyz('popular/caffeine.xyz');
    const expected: string[] = [];
    for (let i = 0; i < input.natoms; i += 1) {
      for (let j = i + 1; j < input.natoms; j += 1) {
        let d2 = 0;
        for (let a = 0; a < 3; a += 1) d2 += (input.positions[3 * j + a] - input.positions[3 * i + a]) ** 2;
        const cut = covalentRadius(input.atomicNumbers[i]) + covalentRadius(input.atomicNumbers[j]) + 0.45;
        if (d2 > 0 && d2 <= cut * cut) expected.push(`${i}-${j}`);
      }
    }
    const p = perceiveBonds({ ...input, recipe: DISTANCE_RECIPE_ID });
    expect(p.recipe).toBe(DISTANCE_RECIPE_ID);
    expect(bonds(p)).toEqual(expected);
    expect(Array.from(p.kinds).every((k) => k === BOND_KIND.covalent)).toBe(true);
    expect(bonds(perceiveBonds(input))).toEqual(expected);
  });
});

describe('lupi-bonds.molecular.v1: hydrogen', () => {
  it('keeps H₂', () => {
    const p = perceiveBonds(molecule([['H', 0, 0, 0], ['H', 0.74, 0, 0]]));
    expect(bonds(p)).toEqual(['0-1']);
  });

  it('η²-H₂ on a metal keeps its H–H and two coordination lines', () => {
    const p = perceiveBonds(molecule([['W', 0, 0, 0], ['H', -0.41, 0, 1.84], ['H', 0.41, 0, 1.84]]));
    expect(bonds(p, BOND_KIND.covalent)).toEqual(['1-2']);
    expect(bonds(p, BOND_KIND.coordination)).toEqual(['0-1', '0-2']);
    expect(p.counts.bridgingH).toBe(0);
  });

  it('drops a crowded H–H between two C–H (hydrogen-pair)', () => {
    const p = perceiveBonds(molecule([['C', 0, 0, 0], ['H', 1.09, 0, 0], ['H', 2.09, 0, 0], ['C', 3.18, 0, 0]]));
    expect(bonds(p)).toEqual(['0-1', '2-3']);
    expect(removed(p, REMOVAL_REASON.hydrogenPair)).toEqual(['1-2']);
  });

  it('drops a stretched second C–H (hydrogen-single-partner)', () => {
    const p = perceiveBonds(molecule([['C', 0, 0, 0], ['H', 1.09, 0, 0], ['C', 2.5, 0, 0]]));
    expect(bonds(p)).toEqual(['0-1']);
    expect(removed(p, REMOVAL_REASON.hydrogenSinglePartner)).toEqual(['1-2']);
  });

  it('diborane: B–B removed as a bridged pair, two B–H–B bridges, four bonds per B', () => {
    const p = perceiveBonds(molecule(diborane()));
    expect(removed(p, REMOVAL_REASON.bridgedPair)).toEqual(['0-1']);
    expect(removed(p)).toEqual(['0-1']);
    expect(partners(p, 2, BOND_KIND.covalent)).toEqual([0, 1]);
    expect(partners(p, 3, BOND_KIND.covalent)).toEqual([0, 1]);
    expect(partners(p, 0, BOND_KIND.covalent)).toHaveLength(4);
    expect(partners(p, 1, BOND_KIND.covalent)).toHaveLength(4);
    expect(p.counts.bridgingH).toBe(2);
    expect(p.counts.covalent).toBe(8);
  });
});

describe('lupi-bonds.molecular.v1: clashes and hypervalence', () => {
  it('never bonds a 0.35 Å pair and counts it as a clash', () => {
    const p = perceiveBonds(molecule([['C', 0, 0, 0], ['H', 0.35, 0, 0]]));
    expect(p.count).toBe(0);
    expect(p.counts.clashes).toBe(1);
    expect(p.counts.removed).toBe(0);
    expect(removed(p, REMOVAL_REASON.clash)).toEqual(['0-1']);
    expect(CLASH_FLOOR_A).toBe(0.4);
  });

  it('ClO₄⁻ has 4 bonds, PF₆⁻ 6 and IF₇ 7', () => {
    const perchlorate = perceiveBonds(molecule([['Cl', 0, 0, 0], ...TETRAHEDRAL.map((d) => at('O', scale(d, 1.44)))]));
    expect(perchlorate.counts.covalent).toBe(4);
    const hexafluorophosphate = perceiveBonds(molecule([['P', 0, 0, 0], ...AXES.map((d) => at('F', scale(d, 1.6)))]));
    expect(hexafluorophosphate.counts.covalent).toBe(6);
    const heptafluoride: Atom[] = [['I', 0, 0, 0], ['F', 0, 0, 1.79], ['F', 0, 0, -1.79]];
    for (let k = 0; k < 5; k += 1) {
      const t = (2 * Math.PI * k) / 5;
      heptafluoride.push(['F', 1.86 * Math.cos(t), 1.86 * Math.sin(t), 0]);
    }
    const iodine = perceiveBonds(molecule(heptafluoride));
    expect(iodine.counts.covalent).toBe(7);
    expect(iodine.counts.removed).toBe(0);
  });

  it('a Cl between two carbons keeps only the less stretched one (valence cap)', () => {
    const p = perceiveBonds(molecule([['C', -1.78, 0, 0], ['Cl', 0, 0, 0], ['C', 1.95, 0, 0]]));
    expect(bonds(p)).toEqual(['0-1']);
    expect(removed(p, REMOVAL_REASON.valenceCap)).toEqual(['1-2']);
  });
});

describe('lupi-bonds.molecular.v1: s-block ions', () => {
  it('[Na(H₂O)₆]⁺: six dotted contacts, no stick touches Na', () => {
    const atoms: Atom[] = [['Na', 0, 0, 0], ...AXES.flatMap((d) => water(scale(d, 2.42)))];
    const p = perceiveBonds(molecule(atoms));
    expect(p.counts.ionicContact).toBe(6);
    expect(partners(p, 0, BOND_KIND.ionicContact)).toHaveLength(6);
    expect(partners(p, 0, BOND_KIND.covalent)).toEqual([]);
    expect(partners(p, 0, BOND_KIND.coordination)).toEqual([]);
    expect(p.counts.covalent).toBe(12);
    expect(p.counts.fragments).toBe(7);
  });

  it('K⁺ by a sulfonate keeps K···O and drops K···S (donor precedence)', () => {
    const p = perceiveBonds(molecule(potassiumSulfonate()));
    expect(partners(p, 5, BOND_KIND.ionicContact)).toEqual([1, 2]);
    expect(removed(p, REMOVAL_REASON.ionDonorPrecedence)).toEqual(['0-5']);
    expect(partners(p, 5, BOND_KIND.covalent)).toEqual([]);
  });

  it('K⁺ in 12 waters is capped at 10 contacts, keeping the closest', () => {
    const phi = (1 + Math.sqrt(5)) / 2;
    const vertices = [
      [0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi],
      [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0],
      [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1],
    ].map((v) => scale(v, 1 / norm(v)));
    const atoms: Atom[] = [['K', 0, 0, 0], ...vertices.map((v, k) => at('O', scale(v, 2.8 + 0.01 * k)))];
    const p = perceiveBonds(molecule(atoms));
    expect(p.counts.ionicContact).toBe(10);
    expect(removed(p, REMOVAL_REASON.ionCoordinationCap)).toEqual(['0-11', '0-12']);
  });

  it('contacts Fr–I at 4.30 Å, inside the computed 4.35 Å bound', () => {
    expect(MAX_ION_CONTACT_A).toBeCloseTo(4.35, 12);
    const p = perceiveBonds(molecule([['Fr', 0, 0, 0], ['I', 4.3, 0, 0]]));
    expect(bonds(p, BOND_KIND.ionicContact)).toEqual(['0-1']);
  });

  it('a Li 2.1 Å from a carbon gets no line and counts as ionCarbonClose', () => {
    const p = perceiveBonds(molecule([['Li', 0, 0, 0], ['C', 2.1, 0, 0]]));
    expect(p.count).toBe(0);
    expect(p.counts.ionCarbonClose).toBe(1);
  });
});

describe('lupi-bonds.molecular.v1: metals', () => {
  it('ferrocene: ten coordination lines, haptic rings intact, no angle pruning at Fe', () => {
    const p = perceiveBonds(molecule(ferrocene()));
    expect(p.counts.coordination).toBe(10);
    expect(partners(p, 0, BOND_KIND.coordination)).toHaveLength(10);
    expect(p.counts.covalent).toBe(20);
    expect(removed(p, REMOVAL_REASON.acuteAngle).filter((pair) => pair.startsWith('0-'))).toEqual([]);
    expect(removed(p)).toEqual([]);
  });

  it('cisplatin: four coordination lines', () => {
    const p = perceiveBonds(molecule(cisplatin()));
    expect(bonds(p, BOND_KIND.coordination)).toEqual(['0-1', '0-2', '0-3', '0-4']);
    expect(p.counts.covalent).toBe(6);
  });
});

/** mulberry32: a seeded PRNG so fuzz cases are reproducible. */
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

function randomCluster(seed: number, count: number, box: number): PerceiveBondsInput {
  const rand = prng(seed);
  const atoms: Atom[] = [];
  for (let k = 0; k < count; k += 1) {
    atoms.push([FUZZ_ELEMENTS[Math.floor(rand() * FUZZ_ELEMENTS.length)], rand() * box, rand() * box, rand() * box]);
  }
  return molecule(atoms, rand() < 0.5 ? 0.45 : rand() * 1.5);
}

function bytesOf(p: PerceivedBonds): string {
  const e = p.evidence;
  return JSON.stringify({
    recipe: p.recipe,
    params: p.params,
    counts: p.counts,
    arrays: [p.pairs, p.kinds, p.distances, p.excess, e?.pairs, e?.reasons, e?.distances]
      .map((a) => (a ? Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('hex') : null)),
  });
}

describe('lupi-bonds.molecular.v1: properties', () => {
  const cases = [
    readXyz('popular/caffeine.xyz'),
    molecule(diborane()),
    molecule(ferrocene()),
    molecule(potassiumSulfonate()),
    ...[1, 2, 3, 4, 5].map((seed) => randomCluster(seed, 80, 8)),
  ];

  it('is deterministic: the same input twice and a shuffled grid insertion order give byte-equal output', () => {
    for (const input of cases) {
      for (const recipe of [MOLECULAR_RECIPE_ID, DISTANCE_RECIPE_ID] as const) {
        const first = bytesOf(perceiveBonds({ ...input, recipe }));
        expect(bytesOf(perceiveBonds({ ...input, recipe }))).toBe(first);
        const rand = prng(input.natoms * 7919);
        const order = Array.from({ length: input.natoms }, (_, k) => k);
        for (let k = order.length - 1; k > 0; k -= 1) {
          const m = Math.floor(rand() * (k + 1));
          [order[k], order[m]] = [order[m], order[k]];
        }
        expect(bytesOf(perceiveBondsWith({ ...input, recipe }, { gridInsertionOrder: order }))).toBe(first);
      }
    }
  });

  it('fuzz: every pair satisfies its own kind rule, H keeps one partner, no atom is over its cap', () => {
    // Every rule is checked in plain code and the broken ones collected, then asserted once:
    // an expect per pair (thousands across the 60 clusters) cost most of this test's time.
    const broken: string[] = [];
    for (let seed = 100; seed < 160; seed += 1) {
      const input = randomCluster(seed, 40 + (seed % 5) * 20, 6 + (seed % 4));
      const p = perceiveBonds(input);
      const tolerance = p.params.tolerance;
      const z = input.atomicNumbers;
      const check = (ok: boolean, rule: string) => {
        if (!ok) broken.push(`seed ${seed}: ${rule}`);
      };
      const valence = new Map<number, number[]>();
      let previous = -1;
      for (let k = 0; k < p.count; k += 1) {
        const i = p.pairs[2 * k];
        const j = p.pairs[2 * k + 1];
        const pair = `${i}-${j}`;
        check(i < j, `${pair} is not ordered`);
        check(i * input.natoms + j > previous, `${pair} is out of order`);
        previous = i * input.natoms + j;
        let d2 = 0;
        for (let a = 0; a < 3; a += 1) d2 += (input.positions[3 * j + a] - input.positions[3 * i + a]) ** 2;
        check(d2 >= CLASH_FLOOR_A ** 2, `${pair} is under the clash floor`);
        const ci = elementClass(z[i]);
        const cj = elementClass(z[j]);
        const covalentLike = (c: number) => c === ELEMENT_CLASS.hydrogen || c === ELEMENT_CLASS.covalent;
        if (p.kinds[k] === BOND_KIND.covalent) {
          check(covalentLike(ci) && covalentLike(cj), `covalent ${pair} joins a non-covalent class`);
          const cut = covalentRadius(z[i]) + covalentRadius(z[j]) + tolerance;
          check(d2 <= cut * cut, `covalent ${pair} is beyond its cutoff`);
          valence.set(i, [...(valence.get(i) ?? []), j]);
          valence.set(j, [...(valence.get(j) ?? []), i]);
        } else if (p.kinds[k] === BOND_KIND.coordination) {
          const metal = ci === ELEMENT_CLASS.metal ? i : j;
          const other = metal === i ? j : i;
          check(elementClass(z[metal]) === ELEMENT_CLASS.metal, `coordination ${pair} has no metal`);
          const co = elementClass(z[other]);
          const cut = co === ELEMENT_CLASS.metal
            ? metalRadius(z[metal]) + metalRadius(z[other]) + 0.25
            : co === ELEMENT_CLASS.hydrogen
              ? metalRadius(z[metal]) + covalentRadius(1) + 0.3
              : metalRadius(z[metal]) + covalentRadius(z[other]) + tolerance;
          check(([ELEMENT_CLASS.metal, ELEMENT_CLASS.hydrogen, ELEMENT_CLASS.covalent] as number[]).includes(co), `coordination ${pair} has a class-${co} partner`);
          check(d2 <= cut * cut, `coordination ${pair} is beyond its cutoff`);
        } else {
          check(p.kinds[k] === BOND_KIND.ionicContact, `${pair} has kind ${p.kinds[k]}`);
          const ion = ci === ELEMENT_CLASS.ion ? i : j;
          const donor = ion === i ? j : i;
          check(elementClass(z[ion]) === ELEMENT_CLASS.ion, `contact ${pair} has no ion`);
          check(DONOR_RADII[z[donor]] !== undefined, `contact ${pair} has no donor radius`);
          const cut = ION_RADII[z[ion]] + DONOR_RADII[z[donor]] + 0.35;
          check(d2 <= cut * cut, `contact ${pair} is beyond its cutoff`);
          check(Math.sqrt(d2) <= MAX_ION_CONTACT_A, `contact ${pair} is beyond the longest contact`);
        }
      }
      for (const [atom, list] of valence) {
        if (z[atom] === 1) {
          const bridging = list.length === 2 && list.every((b) => z[b] === 5);
          check(list.length === 1 || bridging, `H ${atom} has ${list.length} partners`);
          continue;
        }
        const cap = VALENCE_CAPS[z[atom]];
        if (cap !== undefined) check(list.length <= cap, `atom ${atom} is over its cap`);
        if (z[atom] === 17 || z[atom] === 35 || z[atom] === 53) {
          check(list.filter((b) => z[b] !== 8 && z[b] !== 9).length <= 1, `halogen ${atom} has more than one partner besides O and F`);
        }
      }
      check(p.counts.covalent + p.counts.coordination + p.counts.ionicContact === p.count, 'the kind counts do not add up');
      check(p.counts.removed === p.evidence!.reasons.filter((r) => r !== REMOVAL_REASON.clash).length, 'the removed count does not match the evidence');
    }
    expect(broken).toEqual([]);
  });

  it('covalent output is a subset of the distance recipe at the same tolerance', () => {
    for (let seed = 200; seed < 220; seed += 1) {
      const input = randomCluster(seed, 60, 7);
      const molecular = new Set(bonds(perceiveBonds(input), BOND_KIND.covalent));
      const distance = new Set(bonds(perceiveBonds({ ...input, recipe: DISTANCE_RECIPE_ID })));
      for (const pair of molecular) expect(distance.has(pair)).toBe(true);
    }
  });

  it('clamps the tolerance and skips evidence on request', () => {
    const input = readXyz('popular/caffeine.xyz');
    expect(perceiveBonds({ ...input, tolerance: 9 }).params.tolerance).toBe(1.5);
    expect(perceiveBonds({ ...input, tolerance: -1 }).params.tolerance).toBe(0);
    expect(perceiveBonds({ ...input, tolerance: Number.NaN }).params.tolerance).toBe(0.45);
    const lean = perceiveBonds({ ...input, collectEvidence: false });
    expect(lean.evidence).toBeNull();
    expect(lean.counts).toEqual(perceiveBonds(input).counts);
  });
});

describe('filterPerceivedBonds', () => {
  it('hiding a type and turning contacts off keeps kinds, distances and sourceIndex aligned', () => {
    const atoms: Atom[] = [['Na', 0, 0, 0], ...AXES.flatMap((d) => water(scale(d, 2.42)))];
    const input = molecule(atoms);
    const p = perceiveBonds(input);
    const check = (drawn: ReturnType<typeof filterPerceivedBonds>) => {
      expect(drawn.pairs).toHaveLength(2 * drawn.count);
      for (let m = 0; m < drawn.count; m += 1) {
        const k = drawn.sourceIndex[m];
        expect([drawn.pairs[2 * m], drawn.pairs[2 * m + 1]]).toEqual([p.pairs[2 * k], p.pairs[2 * k + 1]]);
        expect(drawn.kinds[m]).toBe(p.kinds[k]);
        expect(drawn.distances[m]).toBe(p.distances[k]);
        expect(drawn.excess[m]).toBe(p.excess[k]);
      }
    };
    const types = Int32Array.from(input.atomicNumbers as number[]);
    const all = filterPerceivedBonds(p, { types, showContacts: true });
    expect(all.count).toBe(p.count);
    check(all);
    const noContacts = filterPerceivedBonds(p, { types, showContacts: false });
    expect(noContacts.count).toBe(12);
    expect(Array.from(noContacts.kinds).every((k) => k === BOND_KIND.covalent)).toBe(true);
    check(noContacts);
    const noHydrogen = filterPerceivedBonds(p, { types, hiddenTypes: new Set([1]), showContacts: true });
    expect(noHydrogen.count).toBe(6);
    expect(Array.from(noHydrogen.kinds).every((k) => k === BOND_KIND.ionicContact)).toBe(true);
    check(noHydrogen);
    expect(filterPerceivedBonds(p, { types, hiddenTypes: new Set([1]), showContacts: false }).count).toBe(0);
  });
});
