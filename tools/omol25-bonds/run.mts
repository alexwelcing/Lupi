#!/usr/bin/env -S npx tsx
/**
 * run.mts — the release-prerequisite validation run for lupi-bonds.molecular.v1
 * (strategy §2.13). A local Node script, not CI.
 *
 * Runs both recipes over every row of colabfit/OMol25_neutral_validation
 * (cached by fetch-rows.mts), checks the hard targets, reports the owner-read
 * distributions and a sensitivity table for each Lupi choice, times the recipe
 * at 350 atoms, runs the gallery no-op diff, and writes
 * packages/core/src/bonds/validation-v1.json.
 *
 *   NODE_USE_ENV_PROXY=1 pnpm exec tsx tools/omol25-bonds/run.mts
 *   pnpm exec tsx tools/omol25-bonds/run.mts --supplementary 0 --out /tmp/v.json
 *
 * --supplementary N also runs the first N rows of colabfit/OMol25_validation
 * (charged, open-shell and transition-metal rows the neutral split lacks) and
 * reports them separately; they are not part of the hard targets.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  BOND_KIND,
  DEFAULT_BOND_TOLERANCE,
  DISTANCE_RECIPE_ID,
  DONOR_RADII,
  HIGH_SPIN_RADII,
  ION_COORDINATION_CAPS,
  ION_RADII,
  MAX_ION_CONTACT_A,
  MOLECULAR_RECIPE_ID,
  REMOVAL_REASON,
  VALENCE_CAPS,
  elementClass,
  ELEMENT_CLASS,
  type PerceiveBondsInput,
  type PerceivedBonds,
} from '../../packages/core/src/bonds/index';
import { MOLECULAR_V1_PARAMS, perceiveBondsWith, type MolecularRecipeParams } from '../../packages/core/src/bonds/perceive';
import { getElementSpec } from '../../packages/core/src/elements';
import { NEUTRAL_VALIDATION, ROOT, loadRows, type OmolRow } from './fetch-rows.mts';
import { runGalleryDiff } from './gallery-diff.mts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const OUT = path.resolve(flag('--out', path.join(ROOT, 'packages/core/src/bonds/validation-v1.json')));
const SUPPLEMENTARY_ROWS = Number(flag('--supplementary', '3000'));
const CLUSTERS = Number(flag('--clusters', '3000'));
const SKIP_SENSITIVITY = argv.includes('--skip-sensitivity');
const TOLERANCE = DEFAULT_BOND_TOLERANCE;
const P99_TARGET_MS = 5;
const CLUSTER_ATOMS = 350;
const MULLIKEN_INTEGRALITY_TOLERANCE = 0.25;
const REASON_NAMES = Object.fromEntries(Object.entries(REMOVAL_REASON).map(([name, code]) => [code, name])) as Record<number, string>;
const HALOGENS = new Set([9, 17, 35, 53]);
const log = (line: string) => console.log(line);

const round = (value: number, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value);
const pct = (part: number, whole: number) => (whole > 0 ? round((100 * part) / whole, 2) : 0);
const symbol = (z: number) => getElementSpec(z).symbol;

function toInput(row: OmolRow): PerceiveBondsInput {
  return {
    atomicNumbers: Int32Array.from(row.z),
    positions: Float32Array.from(row.pos),
    natoms: row.z.length,
    tolerance: TOLERANCE,
  };
}

function hashOutput(hash: ReturnType<typeof createHash>, p: PerceivedBonds): void {
  for (const array of [p.pairs, p.kinds, p.distances, p.excess, p.evidence?.pairs, p.evidence?.reasons, p.evidence?.distances]) {
    if (array) hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  hash.update(JSON.stringify([p.recipe, p.params, p.counts]));
}

/** "i-j-kind" per drawn line, for comparing two outputs of one row. */
function lineKey(p: PerceivedBonds, withKind: boolean): string {
  const parts: string[] = [];
  for (let k = 0; k < p.count; k += 1) parts.push(withKind ? `${p.pairs[2 * k]}-${p.pairs[2 * k + 1]}-${p.kinds[k]}` : `${p.pairs[2 * k]}-${p.pairs[2 * k + 1]}`);
  return parts.join(',');
}

interface Neighbourhood {
  /** Covalent + coordination partners. */
  linked: number[][];
  covalent: number[][];
  contacts: number[][];
}

function neighbourhood(p: PerceivedBonds, natoms: number): Neighbourhood {
  const linked = Array.from({ length: natoms }, () => [] as number[]);
  const covalent = Array.from({ length: natoms }, () => [] as number[]);
  const contacts = Array.from({ length: natoms }, () => [] as number[]);
  for (let k = 0; k < p.count; k += 1) {
    const a = p.pairs[2 * k];
    const b = p.pairs[2 * k + 1];
    if (p.kinds[k] === BOND_KIND.ionicContact) {
      contacts[a].push(b);
      contacts[b].push(a);
      continue;
    }
    linked[a].push(b);
    linked[b].push(a);
    if (p.kinds[k] === BOND_KIND.covalent) {
      covalent[a].push(b);
      covalent[b].push(a);
    }
  }
  return { linked, covalent, contacts };
}

type CapSet = 'v1' | 'classic';

type MultiPartnerH = 'boraneBridge' | 'eta2H2' | 'hydrideBridge' | null;

/**
 * The multi-partner H the strategy allows: a B–H–B bridge, an η²-H₂ hydrogen
 * (its H partner plus metal coordination) or a hydride bridging two metals.
 */
function allowedMultiPartnerH(z: ArrayLike<number>, partners: number[]): MultiPartnerH {
  const metals = partners.filter((b) => elementClass(z[b]) === ELEMENT_CLASS.metal).length;
  const hydrogens = partners.filter((b) => z[b] === 1).length;
  if (partners.length === 2 && partners.every((b) => z[b] === 5)) return 'boraneBridge';
  if (hydrogens === 1 && metals === partners.length - 1) return 'eta2H2';
  if (partners.length === 2 && metals === 2) return 'hydrideBridge';
  return null;
}

/** Over-valent H, C, N, O or halogen. v1: the recipe's caps; classic: H1 C4 N4 O2 halogen 1 (Open Babel–style). */
function overValentAtoms(z: ArrayLike<number>, n: Neighbourhood, caps: CapSet): number[] {
  const out: number[] = [];
  for (let a = 0; a < z.length; a += 1) {
    const za = z[a];
    if (za === 1) {
      const partners = n.linked[a];
      if (partners.length > 1 && (caps === 'classic' || allowedMultiPartnerH(z, partners) === null)) out.push(a);
      continue;
    }
    if (za !== 6 && za !== 7 && za !== 8 && !HALOGENS.has(za)) continue;
    const partners = n.covalent[a];
    if (caps === 'classic') {
      const cap = za === 6 || za === 7 ? 4 : za === 8 ? 2 : 1;
      if (partners.length > cap) out.push(a);
      continue;
    }
    if (partners.length > VALENCE_CAPS[za]) out.push(a);
    else if (za !== 9 && HALOGENS.has(za) && partners.filter((b) => z[b] !== 8 && z[b] !== 9).length > 1) out.push(a);
  }
  return out;
}

/** Covalent fragments (≥ 2 atoms) and how many have a Mulliken sum more than 0.25 from an integer. */
function mullikenIntegrality(row: OmolRow, n: Neighbourhood): { fragments: number; fail: number } {
  if (!row.mulliken || row.mulliken.length !== row.z.length) return { fragments: 0, fail: 0 };
  const seen = new Uint8Array(row.z.length);
  let fragments = 0;
  let fail = 0;
  for (let start = 0; start < row.z.length; start += 1) {
    if (seen[start] || n.linked[start].length === 0) continue;
    let sum = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const a = stack.pop()!;
      sum += row.mulliken[a];
      for (const b of n.linked[a]) {
        if (!seen[b]) {
          seen[b] = 1;
          stack.push(b);
        }
      }
    }
    fragments += 1;
    if (Math.abs(sum - Math.round(sum)) > MULLIKEN_INTEGRALITY_TOLERANCE) fail += 1;
  }
  return { fragments, fail };
}

interface PassMetrics {
  rows: number;
  multiBondHRows: number;
  multiBondHRowsIncludingBridges: number;
  bridgedBoraneRows: number;
  allowedMultiPartnerH: Record<string, number>;
  overValentRows: number;
  overValentRowsClassicCaps: number;
  overValentByElement: Record<string, number>;
  covalentIonSticks: number;
  saltRows: number;
  saltRowsWithIonSticks: number;
  hydrogenPairRows: number;
  ions: number;
  ionsWithContact: number;
  isolatedIons: number;
  ionContactHistogram: Record<string, Record<string, number>>;
  contactPartners: Record<string, number>;
  kinds: Record<string, number>;
  removedByReason: Record<string, number>;
  clashRows: number;
  longBondRows: number;
  longBonds: number;
  nearMiss: number;
  ionCarbonCloseRows: number;
  bridgingH: number;
  mullikenFragments: number;
  mullikenFail: number;
  /** The same, over rows with no s-block ion (Mulliken under-reports the ions' charge). */
  mullikenFragmentsNoIon: number;
  mullikenFailNoIon: number;
  multiFragmentRows: number;
  /** Per row: non-integral covalent fragments, and the removal reasons that fired. */
  rowMullikenFails: number[];
  rowReasons: string[][];
  rowHasIon: boolean[];
  rowKeys: string[];
  digest: string;
}

function runPass(
  inputs: PerceiveBondsInput[],
  rows: OmolRow[],
  recipe: typeof MOLECULAR_RECIPE_ID | typeof DISTANCE_RECIPE_ID,
  params: Partial<MolecularRecipeParams> = {},
  shuffleGrid = false,
): PassMetrics {
  const m: PassMetrics = {
    rows: inputs.length,
    multiBondHRows: 0,
    multiBondHRowsIncludingBridges: 0,
    bridgedBoraneRows: 0,
    allowedMultiPartnerH: {},
    overValentRows: 0,
    overValentRowsClassicCaps: 0,
    overValentByElement: {},
    covalentIonSticks: 0,
    saltRows: 0,
    saltRowsWithIonSticks: 0,
    hydrogenPairRows: 0,
    ions: 0,
    ionsWithContact: 0,
    isolatedIons: 0,
    ionContactHistogram: {},
    contactPartners: {},
    kinds: { covalent: 0, coordination: 0, ionicContact: 0 },
    removedByReason: {},
    clashRows: 0,
    longBondRows: 0,
    longBonds: 0,
    nearMiss: 0,
    ionCarbonCloseRows: 0,
    bridgingH: 0,
    mullikenFragments: 0,
    mullikenFail: 0,
    mullikenFragmentsNoIon: 0,
    mullikenFailNoIon: 0,
    multiFragmentRows: 0,
    rowMullikenFails: [],
    rowReasons: [],
    rowHasIon: [],
    rowKeys: [],
    digest: '',
  };
  const hash = createHash('sha256');
  inputs.forEach((input, r) => {
    let order: number[] | undefined;
    if (shuffleGrid) {
      order = Array.from({ length: input.natoms }, (_, k) => k);
      let seed = (r + 1) * 2654435761;
      for (let k = order.length - 1; k > 0; k -= 1) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        const j = seed % (k + 1);
        [order[k], order[j]] = [order[j], order[k]];
      }
    }
    const p = perceiveBondsWith({ ...input, recipe }, { params, gridInsertionOrder: order });
    hashOutput(hash, p);
    m.rowKeys.push(lineKey(p, true));
    const z = input.atomicNumbers;
    const n = neighbourhood(p, input.natoms);

    let multiH = false;
    let multiHAll = false;
    let borane = false;
    let hh = false;
    for (let a = 0; a < input.natoms; a += 1) {
      if (z[a] !== 1) continue;
      const partners = n.linked[a];
      if (partners.length > 1) {
        multiHAll = true;
        const allowed = recipe === MOLECULAR_RECIPE_ID ? allowedMultiPartnerH(z, partners) : null;
        if (allowed) m.allowedMultiPartnerH[allowed] = (m.allowedMultiPartnerH[allowed] ?? 0) + 1;
        if (allowed === 'boraneBridge') borane = true;
        if (!allowed) multiH = true;
      }
      if (n.covalent[a].some((b) => z[b] === 1)) hh = true;
    }
    if (multiH) m.multiBondHRows += 1;
    if (multiHAll) m.multiBondHRowsIncludingBridges += 1;
    if (borane) m.bridgedBoraneRows += 1;
    if (hh) m.hydrogenPairRows += 1;

    const over = overValentAtoms(z, n, 'v1');
    if (over.length) m.overValentRows += 1;
    for (const a of over) m.overValentByElement[symbol(z[a])] = (m.overValentByElement[symbol(z[a])] ?? 0) + 1;
    if (overValentAtoms(z, n, 'classic').length) m.overValentRowsClassicCaps += 1;

    let salt = false;
    let sticks = 0;
    for (let a = 0; a < input.natoms; a += 1) {
      if (elementClass(z[a]) !== ELEMENT_CLASS.ion) continue;
      salt = true;
      m.ions += 1;
      sticks += n.linked[a].length;
      const contacts = n.contacts[a].length;
      const el = symbol(z[a]);
      m.ionContactHistogram[el] ??= {};
      m.ionContactHistogram[el][contacts] = (m.ionContactHistogram[el][contacts] ?? 0) + 1;
      if (contacts > 0) m.ionsWithContact += 1;
      if (contacts === 0 && n.linked[a].length === 0) m.isolatedIons += 1;
      for (const b of n.contacts[a]) m.contactPartners[symbol(z[b])] = (m.contactPartners[symbol(z[b])] ?? 0) + 1;
    }
    if (salt) m.saltRows += 1;
    if (sticks > 0) m.saltRowsWithIonSticks += 1;
    m.covalentIonSticks += sticks;

    m.kinds.covalent += p.counts.covalent;
    m.kinds.coordination += p.counts.coordination;
    m.kinds.ionicContact += p.counts.ionicContact;
    p.evidence?.reasons.forEach((reason) => {
      m.removedByReason[REASON_NAMES[reason]] = (m.removedByReason[REASON_NAMES[reason]] ?? 0) + 1;
    });
    if (p.counts.clashes) m.clashRows += 1;
    if (p.counts.long) m.longBondRows += 1;
    m.longBonds += p.counts.long;
    m.nearMiss += p.counts.nearMiss;
    if (p.counts.ionCarbonClose) m.ionCarbonCloseRows += 1;
    m.bridgingH += p.counts.bridgingH;
    const covalentFragments = mullikenIntegrality(rows[r], n);
    m.mullikenFragments += covalentFragments.fragments;
    m.mullikenFail += covalentFragments.fail;
    if (!salt) {
      m.mullikenFragmentsNoIon += covalentFragments.fragments;
      m.mullikenFailNoIon += covalentFragments.fail;
    }
    if (covalentFragments.fragments > 1) m.multiFragmentRows += 1;
    m.rowMullikenFails.push(covalentFragments.fail);
    m.rowReasons.push([...new Set(Array.from(p.evidence?.reasons ?? [], (reason) => REASON_NAMES[reason]))]);
    m.rowHasIon.push(salt);
  });
  m.digest = hash.digest('hex');
  return m;
}

function quantiles(samples: number[]): { samples: number; p50: number; p95: number; p99: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { samples: sorted.length, p50: round(at(0.5), 3), p95: round(at(0.95), 3), p99: round(at(0.99), 3), max: round(sorted[sorted.length - 1], 3) };
}

function timeCalls(inputs: PerceiveBondsInput[]): number[] {
  for (const input of inputs.slice(0, 200)) perceiveBondsWith({ ...input, recipe: MOLECULAR_RECIPE_ID }, {});
  return inputs.map((input) => {
    const t0 = process.hrtime.bigint();
    perceiveBondsWith({ ...input, recipe: MOLECULAR_RECIPE_ID }, {});
    return Number(process.hrtime.bigint() - t0) / 1e6;
  });
}

/**
 * 350-atom clusters packed from consecutive rows: each molecule's bounding
 * box is shelved 2.5 Å from its neighbours, the last molecule is cut to make
 * exactly 350 atoms. Dense enough that intermolecular pairs reach the grid.
 */
function clusters(rows: OmolRow[], count: number): PerceiveBondsInput[] {
  const out: PerceiveBondsInput[] = [];
  let next = 0;
  for (let c = 0; c < count; c += 1) {
    const z: number[] = [];
    const pos: number[] = [];
    let x = 0, y = 0, zc = 0, rowDepth = 0, layerHeight = 0;
    while (z.length < CLUSTER_ATOMS) {
      const row = rows[next % rows.length];
      next += 1;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let a = 0; a < row.z.length; a += 1) {
        for (let k = 0; k < 3; k += 1) {
          min[k] = Math.min(min[k], row.pos[3 * a + k]);
          max[k] = Math.max(max[k], row.pos[3 * a + k]);
        }
      }
      const size = max.map((v, k) => v - min[k]);
      if (x > 0 && x + size[0] > 24) {
        x = 0;
        y += rowDepth + 2.5;
        rowDepth = 0;
      }
      if (y > 0 && y + size[1] > 24) {
        y = 0;
        zc += layerHeight + 2.5;
        layerHeight = 0;
      }
      for (let a = 0; a < row.z.length && z.length < CLUSTER_ATOMS; a += 1) {
        z.push(row.z[a]);
        pos.push(row.pos[3 * a] - min[0] + x, row.pos[3 * a + 1] - min[1] + y, row.pos[3 * a + 2] - min[2] + zc);
      }
      x += size[0] + 2.5;
      rowDepth = Math.max(rowDepth, size[1]);
      layerHeight = Math.max(layerHeight, size[2]);
    }
    out.push({ atomicNumbers: Int32Array.from(z), positions: Float32Array.from(pos), natoms: CLUSTER_ATOMS, tolerance: TOLERANCE });
  }
  return out;
}

/** Ion-free rows where v1 leaves more non-integral fragments than the distance recipe, and which rules fired there. */
function mullikenSplitAttribution(v1Pass: PassMetrics, distancePass: PassMetrics) {
  let rowsWorse = 0;
  let rowsBetter = 0;
  const reasons: Record<string, number> = {};
  for (let r = 0; r < v1Pass.rows; r += 1) {
    if (v1Pass.rowHasIon[r]) continue;
    if (v1Pass.rowMullikenFails[r] < distancePass.rowMullikenFails[r]) rowsBetter += 1;
    if (v1Pass.rowMullikenFails[r] <= distancePass.rowMullikenFails[r]) continue;
    rowsWorse += 1;
    for (const reason of v1Pass.rowReasons[r]) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return { rowsWorse, rowsBetter, reasonsInWorseRows: reasons };
}

function changedRows(a: PassMetrics, b: PassMetrics): number {
  let changed = 0;
  for (let r = 0; r < a.rowKeys.length; r += 1) if (a.rowKeys[r] !== b.rowKeys[r]) changed += 1;
  return changed;
}

function summary(m: PassMetrics) {
  return {
    multiBondHRows: m.multiBondHRows,
    overValentRows: m.overValentRows,
    covalentIonSticks: m.covalentIonSticks,
    ionicContacts: m.kinds.ionicContact,
    ionsWithContactPct: pct(m.ionsWithContact, m.ions),
    isolatedIons: m.isolatedIons,
    meanContactsPerIon: m.ions ? round(m.kinds.ionicContact / m.ions, 3) : 0,
    covalent: m.kinds.covalent,
    coordination: m.kinds.coordination,
    removedByReason: m.removedByReason,
    mullikenIntegralityFailPct: pct(m.mullikenFail, m.mullikenFragments),
  };
}

const SENSITIVITY: Record<keyof MolecularRecipeParams, number[]> = {
  contactMargin: [0.25, 0.35, 0.45],
  hapticRatio: [1.10, 1.15, 1.20],
  oxygenCap: [2, 3],
  ionCapDelta: [-2, 0, 2],
  metalMetalSlack: [0.15, 0.25, 0.35],
  metalHydrideSlack: [0.20, 0.30, 0.40],
};

function sensitivity(inputs: PerceiveBondsInput[], rows: OmolRow[], baseline: PassMetrics) {
  const table: Record<string, Array<Record<string, unknown>>> = {};
  for (const [key, values] of Object.entries(SENSITIVITY) as Array<[keyof MolecularRecipeParams, number[]]>) {
    table[key] = values.map((value) => {
      const isV1 = MOLECULAR_V1_PARAMS[key] === value;
      const m = isV1 ? baseline : runPass(inputs, rows, MOLECULAR_RECIPE_ID, { [key]: value });
      return { value, v1: isV1, rowsChangedVsV1: isV1 ? 0 : changedRows(baseline, m), rowsChangedVsV1Pct: isV1 ? 0 : pct(changedRows(baseline, m), m.rows), ...summary(m) };
    });
    log(`  sensitivity ${key}: ${table[key].map((r) => `${r.value}→${r.rowsChangedVsV1} rows`).join(', ')}`);
  }
  return table;
}

function handCheck(rows: OmolRow[], inputs: PerceiveBondsInput[], indices: number[]) {
  const out: Record<string, unknown> = {};
  for (const r of indices) {
    if (!inputs[r]) continue;
    const p = perceiveBondsWith({ ...inputs[r], recipe: MOLECULAR_RECIPE_ID }, {});
    const z = inputs[r].atomicNumbers;
    const ionContacts: Record<string, string[]> = {};
    const removed: Record<string, string[]> = {};
    for (let k = 0; k < p.count; k += 1) {
      if (p.kinds[k] !== BOND_KIND.ionicContact) continue;
      const [a, b] = [p.pairs[2 * k], p.pairs[2 * k + 1]];
      const ion = elementClass(z[a]) === ELEMENT_CLASS.ion ? a : b;
      const donor = ion === a ? b : a;
      (ionContacts[`${symbol(z[ion])}${ion}`] ??= []).push(`${symbol(z[donor])}${donor} ${p.distances[k].toFixed(2)} Å`);
    }
    const e = p.evidence!;
    for (let k = 0; k < e.reasons.length; k += 1) {
      const [a, b] = [e.pairs[2 * k], e.pairs[2 * k + 1]];
      (removed[REASON_NAMES[e.reasons[k]]] ??= []).push(`${symbol(z[a])}${a}–${symbol(z[b])}${b} ${e.distances[k].toFixed(2)} Å`);
    }
    out[r] = {
      formula: rows[r].formula,
      atoms: rows[r].z.length,
      dataId: rows[r].dataId,
      counts: p.counts,
      ionContacts,
      removed,
    };
  }
  return out;
}

// ─── Main ───────────────────────────────────────────────────────────

const started = Date.now();
log(`loading ${NEUTRAL_VALIDATION}…`);
const rows = await loadRows({ log, concurrency: 4 });
const truncatedRows = rows.filter((row) => row.truncated).length;
const inputs = rows.map(toInput);
log(`${rows.length} rows (${truncatedRows} with truncated cells)`);

log('lupi-bonds.molecular.v1, pass 1…');
const v1 = runPass(inputs, rows, MOLECULAR_RECIPE_ID);
log('lupi-bonds.molecular.v1, pass 2…');
const v1Again = runPass(inputs, rows, MOLECULAR_RECIPE_ID);
log('lupi-bonds.molecular.v1, shuffled grid insertion…');
const v1Shuffled = runPass(inputs, rows, MOLECULAR_RECIPE_ID, {}, true);
const deterministic = v1.digest === v1Again.digest && v1.digest === v1Shuffled.digest;
log('lupi-bonds.distance.v1…');
const distance = runPass(inputs, rows, DISTANCE_RECIPE_ID);

let pairsChanged = 0;
const distancePairs = inputs.map((input) => lineKey(perceiveBondsWith({ ...input, recipe: DISTANCE_RECIPE_ID }, {}), false));
inputs.forEach((input, r) => {
  if (lineKey(perceiveBondsWith({ ...input, recipe: MOLECULAR_RECIPE_ID }, {}), false) !== distancePairs[r]) pairsChanged += 1;
});
const rowsChanged = changedRows(v1, distance);

log('timing…');
const rowTimes = quantiles(timeCalls(inputs));
const clusterInputs = clusters(rows, CLUSTERS);
const clusterTimes = quantiles(timeCalls(clusterInputs));
log(`  rows p50/p95/p99 ${rowTimes.p50}/${rowTimes.p95}/${rowTimes.p99} ms; 350-atom clusters ${clusterTimes.p50}/${clusterTimes.p95}/${clusterTimes.p99} ms`);

const sensitivityTable = SKIP_SENSITIVITY ? null : sensitivity(inputs, rows, v1);

let supplementary: Record<string, unknown> | null = null;
if (SUPPLEMENTARY_ROWS > 0) {
  const dataset = 'colabfit/OMol25_validation';
  log(`supplementary: first ${SUPPLEMENTARY_ROWS} rows of ${dataset}…`);
  const extraRows = await loadRows({ dataset, limit: SUPPLEMENTARY_ROWS, log, concurrency: 4 });
  const extraInputs = extraRows.map(toInput);
  const extra = runPass(extraInputs, extraRows, MOLECULAR_RECIPE_ID);
  const extraDistance = runPass(extraInputs, extraRows, DISTANCE_RECIPE_ID);
  const large = extraInputs.filter((input) => input.natoms >= 300);
  const metalRows = extraRows.filter((row) => row.z.some((z) => elementClass(z) === ELEMENT_CLASS.metal)).length;
  supplementary = {
    dataset,
    rows: extraRows.length,
    note: 'Charged, open-shell and transition-metal rows the neutral split lacks; reported only, not a release target.',
    chargedRows: extraRows.filter((row) => row.charge !== null && row.charge !== 0).length,
    openShellRows: extraRows.filter((row) => row.spin !== null && row.spin > 1).length,
    metalRows,
    saltRows: extra.saltRows,
    molecular: {
      multiBondHRows: extra.multiBondHRows,
      allowedMultiPartnerH: extra.allowedMultiPartnerH,
      bridgedBoraneRows: extra.bridgedBoraneRows,
      overValentRows: extra.overValentRows,
      overValentByElement: extra.overValentByElement,
      covalentIonSticks: extra.covalentIonSticks,
      kinds: extra.kinds,
      ionsWithContactPct: pct(extra.ionsWithContact, extra.ions),
      isolatedIons: extra.isolatedIons,
      removedByReason: extra.removedByReason,
      clashRows: extra.clashRows,
      mullikenIntegralityFailPct: pct(extra.mullikenFail, extra.mullikenFragments),
    },
    distance: {
      multiBondHRowsPct: pct(extraDistance.multiBondHRows, extraDistance.rows),
      overValentRowsPct: pct(extraDistance.overValentRows, extraDistance.rows),
      saltRowsWithIonSticksPct: pct(extraDistance.saltRowsWithIonSticks, extraDistance.saltRows),
      mullikenIntegralityFailPct: pct(extraDistance.mullikenFail, extraDistance.mullikenFragments),
    },
    rowsChangedPct: pct(changedRows(extra, extraDistance), extra.rows),
    timingRowsOf300PlusAtoms: large.length ? quantiles(timeCalls(large)) : null,
    sensitivity: SKIP_SENSITIVITY ? null : sensitivity(extraInputs, extraRows, extra),
  };
}

log('gallery diff…');
const gallery = runGalleryDiff();

const hard = {
  multiBondH: v1.multiBondHRows,
  overValent: v1.overValentRows,
  covalentIonSticks: v1.covalentIonSticks,
  deterministic,
  p99Ms: clusterTimes.p99,
};
const pass = hard.multiBondH === 0 && hard.overValent === 0 && hard.covalentIonSticks === 0 && deterministic && hard.p99Ms <= P99_TARGET_MS;

const receipt = {
  schema: 'lupi.bonds-validation.v1',
  recipe: MOLECULAR_RECIPE_ID,
  dataset: NEUTRAL_VALIDATION,
  rows: rows.length,
  generatedAt: new Date().toISOString(),
  tolerance: TOLERANCE,
  pass,
  targets: { multiBondH: 0, overValent: 0, covalentIonSticks: 0, deterministic: true, p99Ms: P99_TARGET_MS },
  hard,
  definitions: {
    multiBondH: 'rows with an H bonded (covalent or coordination) to more than one partner, except the strategy\'s B–H–B bridges, η²-H₂ hydrogens and hydrides bridging two metals (counted in reported.allowedMultiPartnerH)',
    overValent: 'rows with an H, C, N, O or halogen over the v1 cap (H 1, with the same allowed exceptions; C 4; N 4; O 3; F 1; Cl/Br/I ≤ 7 and ≤ 1 non-O/F partner)',
    covalentIonSticks: 'covalent or coordination lines touching Li, Na, K, Rb, Cs, Fr, Mg, Ca, Sr, Ba or Ra',
    deterministic: 'sha256 over every row output (pairs, kinds, lengths, excess, evidence, counts) equal on a second run and with a shuffled grid insertion order',
    p99Ms: `p99 of one perceiveBonds call on ${CLUSTERS} clusters of ${CLUSTER_ATOMS} atoms packed from neutral-validation rows (Node ${process.version})`,
  },
  parameters: {
    ...MOLECULAR_V1_PARAMS,
    covalentRadii: 'Cordero 2008 (Pyykkö fallback), the viewer table',
    highSpinRadii: Object.fromEntries(Object.entries(HIGH_SPIN_RADII).map(([z, r]) => [symbol(Number(z)), r])),
    ionRadii: { source: 'Shannon 1976 effective ionic radii, CN6', values: Object.fromEntries(Object.entries(ION_RADII).map(([z, r]) => [symbol(Number(z)), r])) },
    donorRadii: {
      source: 'Lupi choice from published anion radii: O, F, Cl, Br, I, S Shannon 1976 CN6; N Shannon CN4; P Pauling',
      values: Object.fromEntries(Object.entries(DONOR_RADII).map(([z, r]) => [symbol(Number(z)), r])),
    },
    maxIonContactA: round(MAX_ION_CONTACT_A, 4),
    ionCoordinationCaps: Object.fromEntries(Object.entries(ION_COORDINATION_CAPS).map(([z, cap]) => [symbol(Number(z)), cap])),
  },
  reported: {
    ionContactHistogram: v1.ionContactHistogram,
    ions: v1.ions,
    isolatedIons: v1.isolatedIons,
    ionsWithContactPct: pct(v1.ionsWithContact, v1.ions),
    contactPartners: v1.contactPartners,
    saltRows: v1.saltRows,
    mullikenIntegralityFailPct: pct(v1.mullikenFail, v1.mullikenFragments),
    mullikenFragments: v1.mullikenFragments,
    mullikenIntegralityFailPctDistanceRecipe: pct(distance.mullikenFail, distance.mullikenFragments),
    mullikenIntegralityFailPctRowsWithoutIons: pct(v1.mullikenFailNoIon, v1.mullikenFragmentsNoIon),
    mullikenIntegralityFailPctRowsWithoutIonsDistanceRecipe: pct(distance.mullikenFailNoIon, distance.mullikenFragmentsNoIon),
    mullikenSplitRowsWithoutIons: mullikenSplitAttribution(v1, distance),
    mullikenNote: 'Share of covalent fragments (≥ 2 atoms, joined by covalent or coordination lines) whose Mulliken sum is more than 0.25 from an integer. Mulliken under-reports s-block charges (Ca often +1.2–1.5), so a correctly separated salt counter-ion leaves a non-integral anion; rows without ions isolate the split itself.',
    rowsChangedPct: pct(rowsChanged, rows.length),
    rowsChanged,
    rowsWithDifferentPairsPct: pct(pairsChanged, rows.length),
    p50Ms: clusterTimes.p50,
    p95Ms: clusterTimes.p95,
    timing350Atoms: clusterTimes,
    timingRows: rowTimes,
    kinds: v1.kinds,
    removedByReason: v1.removedByReason,
    bridgedBoraneRows: v1.bridgedBoraneRows,
    allowedMultiPartnerH: v1.allowedMultiPartnerH,
    bridgingH: v1.bridgingH,
    longBondRows: v1.longBondRows,
    longBonds: v1.longBonds,
    nearMissPairs: v1.nearMiss,
    clashRows: v1.clashRows,
    ionCarbonCloseRows: v1.ionCarbonCloseRows,
    multiFragmentRows: v1.multiFragmentRows,
    truncatedRows,
    baselineDistanceRecipe: {
      multiBondHRowsPct: pct(distance.multiBondHRows, distance.rows),
      hydrogenPairRowsPct: pct(distance.hydrogenPairRows, distance.rows),
      overValentRowsPct: pct(distance.overValentRows, distance.rows),
      overValentRowsClassicCapsPct: pct(distance.overValentRowsClassicCaps, distance.rows),
      saltRowsWithIonSticksPct: pct(distance.saltRowsWithIonSticks, distance.saltRows),
      covalentIonSticks: distance.covalentIonSticks,
      covalent: distance.kinds.covalent,
    },
  },
  handCheck: handCheck(rows, inputs, [273, 1239, 196, 357, 0, 1008, 245]),
  sensitivity: sensitivityTable,
  supplementary,
  gallery: {
    files: gallery.files,
    identicalPairs: gallery.identicalPairs,
    definition: 'gallery-data.json .xyz entries of ≤ 2,000 atoms: lupi-bonds.distance.v1 gives the same pairs as the viewer\'s CPU rule on every frame (up to 50 per file)',
    autoRecipe: gallery.autoRecipe,
    molecularIdenticalFiles: gallery.molecularIdenticalFiles,
    molecularChangedFiles: gallery.molecularChangedFiles,
    otherXyzContent: gallery.otherXyzContent,
  },
  changes: [] as string[],
  runSeconds: 0,
};
receipt.runSeconds = Math.round((Date.now() - started) / 1000);

fs.writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
log(`\nwrote ${path.relative(ROOT, OUT)}`);
log(`hard: ${JSON.stringify(hard)} → ${pass ? 'PASS' : 'FAIL'}`);
log(`ions with ≥1 contact: ${receipt.reported.ionsWithContactPct}% of ${v1.ions}; isolated ${v1.isolatedIons}`);
log(`rows changed vs distance: ${receipt.reported.rowsChangedPct}%; baseline ${JSON.stringify(receipt.reported.baselineDistanceRecipe)}`);
log(`gallery: ${gallery.files} files, identicalPairs ${gallery.identicalPairs}`);
if (!pass) process.exitCode = 1;
