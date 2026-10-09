// What /scale can show: the salt ladder (scale-spec §12.4), the capped
// diamondoids and copper's billion (§12.3). Every entry is a handful of
// generator records built here, so the page fetches nothing and a googolplex
// costs the same 168 bytes it costs in the app.

import {
  encodeRecord,
  MemoryStore,
  nodeId,
  Resolver,
  type CrystalNode,
  type NodeID,
  type TowerNode,
  type Vec3n,
} from '@atlas/core/scale';

export type EntryGroup = 'salt' | 'diamondoid' | 'copper';

/** A labelled point on the scale slider: where a cube of that size fills the view. */
export interface ScaleLandmark {
  label: string;
  /** Said when a flight passes it. */
  caption: string;
  /** λ (decimal log of magnification) at which it fills about half the view. */
  lambda: number;
}

export interface ScaleEntry {
  id: string;
  group: EntryGroup;
  /** Short chip label. */
  chip: string;
  title: string;
  blurb: string;
  root: NodeID;
  records: Uint8Array[];
  /** Landmarks for the slider, smallest λ first. */
  landmarks: ScaleLandmark[];
}

/** Salt, Na/Cl rock salt, a = 5.64019 Å (§12.3): 5 × 5 × 5 cells, 1,000 ions. */
export const SALT_SEED: CrystalNode = {
  kind: 'crystal', structure: 5, termination: 0, a: 11, b: 17, quarter: 92409, cells: [5n, 5n, 5n], capZ: 0, capOffset: 0,
};
const SALT_PERIOD = 5n * 4n * 92409n;
export const SALT_PERIODS: [Vec3n, Vec3n, Vec3n] = [[SALT_PERIOD, 0n, 0n], [0n, SALT_PERIOD, 0n], [0n, 0n, SALT_PERIOD]];
/** Edge of one seed copy, Å. */
export const SALT_SEED_EDGE = Number(SALT_PERIOD) / 65536;
export const GOOGOLPLEX_LEVELS = 10n ** 100n - 3n;

export function saltTower(levels: bigint): TowerNode {
  return {
    kind: 'tower', seed: nodeId(encodeRecord(SALT_SEED)), factor: 10, periods: SALT_PERIODS, levels,
    substitution: { fromZ: 17, toZ: 35, perCopy: 1 },
  };
}

/** Copper, fcc, a = 3.615 Å; the web's BillionAtomBlock is 630³ open cells (§3.3.1). */
export const COPPER_BILLION: CrystalNode = {
  kind: 'crystal', structure: 3, termination: 0, a: 29, b: 0, quarter: 59228, cells: [630n, 630n, 630n], capZ: 0, capOffset: 0,
};

/** Capped diamondoid of size m (1 to 12), C/H on {111} faces (§3.3.4). */
export function diamondoid(m: number): CrystalNode {
  const n = BigInt(m);
  return { kind: 'crystal', structure: 4, termination: 2, a: 6, b: 0, quarter: 58438, cells: [n, n, n], capZ: 1, capOffset: 41243 };
}

/**
 * λ at which a salt cube of `copiesPerEdge` = 10^j seed copies per edge is
 * about 0.4 m across at the page's camera distance (camera.ts): one decade
 * per factor of ten in edge.
 */
const saltCubeLambda = (j: number): number => Math.log10(0.4 / SALT_SEED_EDGE) + 10 - j;

/** The salt rungs (§3.4.7), each with the landmarks of the rungs it contains. */
const SALT_RUNGS: Array<{ id: string; chip: string; title: string; levels: bigint; blurb: string }> = [
  {
    id: 'googolplex', chip: '10^(10^100)', title: 'A googolplex of salt', levels: GOOGOLPLEX_LEVELS,
    blurb: 'Ten to the googol ions: a bar of ten cubes, each cube ten slabs, all the way down to a grain of 1,000 ions. Smash it, or dive in.',
  },
  {
    id: 'googol', chip: '10^100', title: 'A googol of salt', levels: 97n,
    blurb: 'Ten to the hundred ions, more than the atoms in the observable universe, as a bar of 33 × 32 × 32 powers of ten.',
  },
  {
    id: 'salt-1e30', chip: '10^30', title: '10^30 ions of salt', levels: 27n,
    blurb: 'A salt cube about 28 m on an edge: a million tonnes.',
  },
  {
    id: 'salt-1e9', chip: 'Billion', title: 'A billion ions of salt', levels: 6n,
    blurb: 'A salt cube 0.28 µm on an edge, a thousand grains of a thousand grains.',
  },
  {
    id: 'salt-1e6', chip: 'Million', title: 'A million ions of salt', levels: 3n,
    blurb: 'Ten by ten by ten grains of 1,000 ions.',
  },
  {
    id: 'salt-1e3', chip: 'Thousand', title: 'A grain of 1,000 ions', levels: 0n,
    blurb: 'Five rock-salt cells on an edge: 500 sodium, 499 chloride and one bromide.',
  },
];

function saltLandmarks(levels: bigint): ScaleLandmark[] {
  const out: ScaleLandmark[] = [];
  if (levels === GOOGOLPLEX_LEVELS) {
    out.push({ label: '10^(10^100)', caption: 'the whole googolplex', lambda: saltCubeLambda((Number(10n ** 100n) - 1) / 3) });
    for (const k of [60, 30, 10]) out.push({ label: `10^(10^${k})`, caption: `a cube of ten to the 10^${k} ions`, lambda: saltCubeLambda(10 ** k / 3) });
  }
  const rungs: Array<[bigint, string, string]> = [
    [97n, '10^100', 'a googol of ions'],
    [27n, '10^30', 'a million tonnes of salt'],
    [6n, '10^9', 'a billion ions'],
    [3n, '10^6', 'a million ions'],
    [0n, '10^3', 'a grain of 1,000 ions'],
  ];
  for (const [l, label, caption] of rungs) {
    if (l <= levels) out.push({ label, caption, lambda: saltCubeLambda(Math.ceil(Number(l) / 3)) });
  }
  out.push({ label: '1 ion', caption: 'one ion', lambda: ION_LAMBDA });
  return out;
}

/** Where one ion fills about a third of the view: the deepest the page dives. */
export const ION_LAMBDA = 9.2;

let built: ScaleEntry[] | null = null;

export function scaleCatalog(): ScaleEntry[] {
  if (built) return built;
  const seedRecord = encodeRecord(SALT_SEED);
  const salt = SALT_RUNGS.map<ScaleEntry>((rung) => {
    const record = encodeRecord(saltTower(rung.levels));
    return {
      id: rung.id, group: 'salt', chip: rung.chip, title: rung.title, blurb: rung.blurb,
      root: nodeId(record), records: [seedRecord, record], landmarks: saltLandmarks(rung.levels),
    };
  });
  const copper = encodeRecord(COPPER_BILLION);
  const cu: ScaleEntry = {
    id: 'copper-billion', group: 'copper', chip: 'Copper', title: "Copper's billion",
    blurb: 'Fcc copper, 630 cells on an edge: 1,000,188,000 atoms, the block the viewer draws at ?billion-atoms, now from one 52-byte record.',
    root: nodeId(copper), records: [copper],
    landmarks: [
      { label: '10^9', caption: 'a billion copper atoms', lambda: Math.log10(0.4 / (630 * 3.615)) + 10 },
      { label: '10^6', caption: 'a million copper atoms', lambda: Math.log10(0.4 / (63 * 3.615)) + 10 },
      { label: '1 atom', caption: 'one copper atom', lambda: ION_LAMBDA },
    ],
  };
  const diamondoids = Array.from({ length: 12 }, (_, i) => diamondoidEntry(i + 1));
  built = [...salt, cu, ...diamondoids];
  return built;
}

const DIAMONDOID_NAMES: Record<number, string> = { 1: 'Adamantane', 2: 'Decamantane' };

function diamondoidEntry(m: number): ScaleEntry {
  const record = encodeRecord(diamondoid(m));
  const c = (2 * m + 3) * (2 * m + 2) * (2 * m + 1) / 6;
  const h = (2 * m + 2) ** 2;
  const name = DIAMONDOID_NAMES[m] ?? `Diamondoid ${m}`;
  return {
    id: `diamondoid-${m}`, group: 'diamondoid', chip: `C${c}`, title: `${name}, C${c}H${h}`,
    blurb: 'A hydrogen-capped diamond nanocrystal cut on {111} faces: every carbon has at least two carbon neighbours.',
    root: nodeId(record), records: [record],
    landmarks: [{ label: '1 atom', caption: 'one carbon atom', lambda: ION_LAMBDA }],
  };
}

export function entryById(id: string | null | undefined): ScaleEntry | null {
  if (!id) return null;
  return scaleCatalog().find((e) => e.id === id) ?? null;
}

export function entryByRoot(root: NodeID): ScaleEntry | null {
  const hex = toHexId(root);
  return scaleCatalog().find((e) => toHexId(e.root) === hex) ?? null;
}

const toHexId = (id: NodeID): string => Array.from(id, (b) => b.toString(16).padStart(2, '0')).join('');

export const DEFAULT_ENTRY_ID = 'googolplex';

/** One resolver per entry: records, counts and aggregates are memoized in it. */
const resolvers = new Map<string, Resolver>();
export function entryResolver(entry: ScaleEntry): Resolver {
  let r = resolvers.get(entry.id);
  if (!r) {
    r = new Resolver(new MemoryStore(entry.records));
    resolvers.set(entry.id, r);
  }
  return r;
}
