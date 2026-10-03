import {
  ACUTE_ANGLE_COS2,
  BOND_TOLERANCE_MAX,
  CLASH_FLOOR_A,
  DEFAULT_BOND_TOLERANCE,
  DONOR_RADII,
  ELEMENT_CLASS,
  HAPTIC_TRIM_RATIO,
  ION_CONTACT_MARGIN_A,
  ION_COORDINATION_CAPS,
  ION_DONOR_PRECEDENCE_A,
  ION_RADII,
  LONG_EXCESS_A,
  METAL_COORDINATION_CAP,
  METAL_HYDRIDE_SLACK_A,
  METAL_METAL_SLACK_A,
  NEAR_MISS_WINDOW_A,
  PARTNER_RULES,
  VALENCE_CAPS,
  covalentRadius,
  elementClass,
  metalRadius,
} from './classes';
import { neighborPairs } from './grid';
import {
  BOND_KIND,
  DISTANCE_RECIPE_ID,
  MOLECULAR_RECIPE_ID,
  REMOVAL_REASON,
  type BondCounts,
  type PerceiveBondsInput,
  type PerceivedBonds,
} from './types';

/** The parameters the strategy names as Lupi's own choices. v1 freezes them. */
export interface MolecularRecipeParams {
  contactMargin: number;
  hapticRatio: number;
  metalMetalSlack: number;
  metalHydrideSlack: number;
  oxygenCap: number;
  /** Added to every ion coordination-number cap. */
  ionCapDelta: number;
}

export const MOLECULAR_V1_PARAMS: Readonly<MolecularRecipeParams> = Object.freeze({
  contactMargin: ION_CONTACT_MARGIN_A,
  hapticRatio: HAPTIC_TRIM_RATIO,
  metalMetalSlack: METAL_METAL_SLACK_A,
  metalHydrideSlack: METAL_HYDRIDE_SLACK_A,
  oxygenCap: VALENCE_CAPS[8],
  ionCapDelta: 0,
});

/** Validation-harness hooks. Production code calls `perceiveBonds`, which uses the frozen v1 values. */
export interface PerceiveBondsOptions {
  params?: Partial<MolecularRecipeParams>;
  /** Grid insertion order, to test that the output does not depend on it. */
  gridInsertionOrder?: ArrayLike<number>;
}

export function clampBondTolerance(tolerance: number | undefined): number {
  if (tolerance === undefined || !Number.isFinite(tolerance)) return DEFAULT_BOND_TOLERANCE;
  return Math.min(BOND_TOLERANCE_MAX, Math.max(0, tolerance));
}

/**
 * Bonds for one frame under a named recipe. Pure, synchronous and
 * deterministic: squared distances in float64 from the float32 inputs, one
 * square root per stretch, no trig, and every sort breaks ties on (i, j).
 *
 * `lupi-bonds.molecular.v1` follows strategy §2.3 step by step; every pair it
 * drops is kept in `evidence` with its reason. `lupi-bonds.distance.v1` is
 * today's viewer rule: every pair with 0 < d ≤ r_i + r_j + τ, all covalent.
 */
export function perceiveBonds(input: PerceiveBondsInput): PerceivedBonds {
  return perceiveBondsWith(input, {});
}

export function perceiveBondsWith(input: PerceiveBondsInput, options: PerceiveBondsOptions): PerceivedBonds {
  const recipe = input.recipe ?? MOLECULAR_RECIPE_ID;
  const tolerance = clampBondTolerance(input.tolerance);
  const collectEvidence = input.collectEvidence ?? true;
  const n = Math.max(0, Math.min(
    Math.floor(Number.isFinite(input.natoms) ? input.natoms : 0),
    input.atomicNumbers.length,
    Math.floor(input.positions.length / 3),
  ));
  return recipe === DISTANCE_RECIPE_ID
    ? perceiveDistance(input, n, tolerance, collectEvidence, options)
    : perceiveMolecular(input, n, tolerance, collectEvidence, { ...MOLECULAR_V1_PARAMS, ...options.params }, options);
}

const CLASH2 = CLASH_FLOOR_A * CLASH_FLOOR_A;
const { hydrogen: H, covalent: COV, ion: ION, metal: METAL, inert: INERT } = ELEMENT_CLASS;
const KIND_COVALENT = BOND_KIND.covalent;
const KIND_COORDINATION = BOND_KIND.coordination;
const KIND_CONTACT = BOND_KIND.ionicContact;
/** A metal–H candidate before step 3 decides whether it becomes coordination. */
const KIND_METAL_H = 3;

function emptyCounts(): BondCounts {
  return {
    covalent: 0, coordination: 0, ionicContact: 0,
    long: 0, removed: 0, nearMiss: 0, clashes: 0,
    fragments: 0, bridgingH: 0, ionCarbonClose: 0,
  };
}

/** Removed pairs, sorted by (i, j) at the end. */
class Evidence {
  readonly i: number[] = [];
  readonly j: number[] = [];
  readonly reason: number[] = [];
  readonly d: number[] = [];
  push(i: number, j: number, reason: number, d: number): void {
    this.i.push(i);
    this.j.push(j);
    this.reason.push(reason);
    this.d.push(d);
  }
  finish(): NonNullable<PerceivedBonds['evidence']> {
    const order = this.i.map((_, k) => k).sort((a, b) => this.i[a] - this.i[b] || this.j[a] - this.j[b]);
    const pairs = new Int32Array(order.length * 2);
    const reasons = new Uint8Array(order.length);
    const distances = new Float32Array(order.length);
    order.forEach((k, m) => {
      pairs[2 * m] = this.i[k];
      pairs[2 * m + 1] = this.j[k];
      reasons[m] = this.reason[k];
      distances[m] = this.d[k];
    });
    return { pairs, reasons, distances };
  }
}

/** Connected components over the given pairs, isolated atoms included. */
function countFragments(n: number, pairI: ArrayLike<number>, pairJ: ArrayLike<number>, count: number): number {
  const parent = new Int32Array(n);
  for (let a = 0; a < n; a += 1) parent[a] = a;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  let components = n;
  for (let k = 0; k < count; k += 1) {
    const a = find(pairI[k]);
    const b = find(pairJ[k]);
    if (a === b) continue;
    if (a < b) parent[b] = a;
    else parent[a] = b;
    components -= 1;
  }
  return components;
}

function perceiveDistance(
  input: PerceiveBondsInput,
  n: number,
  tolerance: number,
  collectEvidence: boolean,
  options: PerceiveBondsOptions,
): PerceivedBonds {
  const { atomicNumbers, positions } = input;
  const rcov = new Float64Array(n);
  let maxR = 0;
  for (let a = 0; a < n; a += 1) {
    rcov[a] = covalentRadius(atomicNumbers[a]);
    if (rcov[a] > maxR) maxR = rcov[a];
  }
  const reach = Math.max(CLASH_FLOOR_A, 2 * maxR + tolerance + NEAR_MISS_WINDOW_A);
  const near = neighborPairs(positions, n, reach, options.gridInsertionOrder);
  const counts = emptyCounts();
  const keep: number[] = [];
  const dist: number[] = [];
  for (let k = 0; k < near.count; k += 1) {
    const d2 = near.d2[k];
    if (d2 < CLASH2) counts.clashes += 1;
    const sum = rcov[near.i[k]] + rcov[near.j[k]];
    const cut = sum + tolerance;
    if (d2 > 0 && d2 <= cut * cut) {
      const d = Math.sqrt(d2);
      keep.push(k);
      dist.push(d);
      if (d - sum > LONG_EXCESS_A) counts.long += 1;
    } else if (d2 > cut * cut) {
      const window = cut + NEAR_MISS_WINDOW_A;
      if (d2 <= window * window) counts.nearMiss += 1;
    }
  }
  const count = keep.length;
  const pairs = new Int32Array(count * 2);
  const pairI = new Int32Array(count);
  const pairJ = new Int32Array(count);
  const distances = new Float32Array(count);
  const excess = new Float32Array(count);
  keep.forEach((k, m) => {
    const a = near.i[k];
    const b = near.j[k];
    pairs[2 * m] = a;
    pairs[2 * m + 1] = b;
    pairI[m] = a;
    pairJ[m] = b;
    distances[m] = dist[m];
    excess[m] = dist[m] - (rcov[a] + rcov[b]);
  });
  counts.covalent = count;
  counts.fragments = countFragments(n, pairI, pairJ, count);
  return {
    recipe: DISTANCE_RECIPE_ID,
    params: { tolerance, contactMargin: 0, clashFloor: 0, longExcess: LONG_EXCESS_A },
    count,
    pairs,
    kinds: new Uint8Array(count),
    distances,
    excess,
    evidence: collectEvidence
      ? { pairs: new Int32Array(0), reasons: new Uint8Array(0), distances: new Float32Array(0) }
      : null,
    counts,
  };
}

function perceiveMolecular(
  input: PerceiveBondsInput,
  n: number,
  tolerance: number,
  collectEvidence: boolean,
  params: MolecularRecipeParams,
  options: PerceiveBondsOptions,
): PerceivedBonds {
  const { atomicNumbers, positions } = input;
  const z = new Int32Array(n);
  const cls = new Uint8Array(n);
  const rcov = new Float64Array(n);
  const rmetal = new Float64Array(n);
  const rion = new Float64Array(n);
  const rdonor = new Float64Array(n).fill(NaN);

  // The search reach is the largest cutoff the elements present can produce.
  let maxCovH = 0;
  let maxCovNonH = 0;
  let maxMetal = 0;
  let maxIon = 0;
  let maxIonCov = 0;
  let maxDonor = 0;
  let hasH = false;
  let hasCovNonH = false;
  let hasMetal = false;
  let hasIon = false;
  let hasDonor = false;
  let hasCarbon = false;
  for (let a = 0; a < n; a += 1) {
    const za = atomicNumbers[a];
    z[a] = za;
    cls[a] = elementClass(za);
    rcov[a] = covalentRadius(za);
    switch (cls[a]) {
      case H:
        hasH = true;
        maxCovH = Math.max(maxCovH, rcov[a]);
        break;
      case COV:
        hasCovNonH = true;
        maxCovH = Math.max(maxCovH, rcov[a]);
        maxCovNonH = Math.max(maxCovNonH, rcov[a]);
        if (za === 6) hasCarbon = true;
        break;
      case METAL:
        hasMetal = true;
        rmetal[a] = metalRadius(za);
        maxMetal = Math.max(maxMetal, rmetal[a]);
        break;
      case ION:
        hasIon = true;
        rion[a] = ION_RADII[za];
        maxIon = Math.max(maxIon, rion[a]);
        maxIonCov = Math.max(maxIonCov, rcov[a]);
        break;
      default:
        break;
    }
    const donor = DONOR_RADII[za];
    if (donor !== undefined) {
      rdonor[a] = donor;
      hasDonor = true;
      maxDonor = Math.max(maxDonor, donor);
    }
  }
  const rH = covalentRadius(1);
  let reach = CLASH_FLOOR_A;
  if (hasH || hasCovNonH) reach = Math.max(reach, 2 * maxCovH + tolerance + NEAR_MISS_WINDOW_A);
  if (hasMetal) {
    reach = Math.max(reach, 2 * maxMetal + params.metalMetalSlack);
    if (hasCovNonH) reach = Math.max(reach, maxMetal + maxCovNonH + tolerance);
    if (hasH) reach = Math.max(reach, maxMetal + rH + params.metalHydrideSlack);
  }
  if (hasIon && hasDonor) reach = Math.max(reach, maxIon + maxDonor + params.contactMargin);
  if (hasIon && hasCarbon) reach = Math.max(reach, maxIonCov + covalentRadius(6) + tolerance);

  const near = neighborPairs(positions, n, reach, options.gridInsertionOrder);
  const counts = emptyCounts();
  const evidence = collectEvidence ? new Evidence() : null;

  // ── Step 1: candidates ────────────────────────────────────────────
  const capacity = near.count;
  const ci = new Int32Array(capacity);
  const cj = new Int32Array(capacity);
  const cd = new Float64Array(capacity);
  const cstretch = new Float64Array(capacity);
  const ckind = new Uint8Array(capacity);
  const alive = new Uint8Array(capacity);
  const bridgingBond = new Uint8Array(capacity);
  const ionNearCarbon = new Uint8Array(n);
  let m = 0;
  const add = (a: number, b: number, d2: number, kind: number) => {
    const d = Math.sqrt(d2);
    ci[m] = a;
    cj[m] = b;
    cd[m] = d;
    cstretch[m] = d / (rcov[a] + rcov[b]);
    ckind[m] = kind;
    alive[m] = 1;
    m += 1;
  };
  for (let k = 0; k < near.count; k += 1) {
    const a = near.i[k];
    const b = near.j[k];
    const d2 = near.d2[k];
    if (d2 < CLASH2) {
      counts.clashes += 1;
      evidence?.push(a, b, REMOVAL_REASON.clash, Math.sqrt(d2));
      continue;
    }
    const ca = cls[a];
    const cb = cls[b];
    if (ca === INERT || cb === INERT) continue;
    if ((ca === H || ca === COV) && (cb === H || cb === COV)) {
      const cut = rcov[a] + rcov[b] + tolerance;
      if (d2 <= cut * cut) add(a, b, d2, KIND_COVALENT);
      else {
        const window = cut + NEAR_MISS_WINDOW_A;
        if (d2 <= window * window) counts.nearMiss += 1;
      }
      continue;
    }
    if (ca === METAL || cb === METAL) {
      let cut = -1;
      let kind: number = KIND_COORDINATION;
      if (ca === METAL && cb === METAL) cut = rmetal[a] + rmetal[b] + params.metalMetalSlack;
      else {
        const metal = ca === METAL ? a : b;
        const ligand = ca === METAL ? b : a;
        if (cls[ligand] === COV) cut = rmetal[metal] + rcov[ligand] + tolerance;
        else if (cls[ligand] === H) {
          cut = rmetal[metal] + rcov[ligand] + params.metalHydrideSlack;
          kind = KIND_METAL_H;
        }
      }
      if (cut > 0 && d2 <= cut * cut) add(a, b, d2, kind);
      continue;
    }
    if (ca === ION || cb === ION) {
      if (ca === ION && cb === ION) continue;
      const ion = ca === ION ? a : b;
      const partner = ca === ION ? b : a;
      if (!Number.isNaN(rdonor[partner])) {
        const cut = rion[ion] + rdonor[partner] + params.contactMargin;
        if (d2 <= cut * cut) add(a, b, d2, KIND_CONTACT);
      }
      if (z[partner] === 6) {
        const cut = rcov[ion] + rcov[partner] + tolerance;
        if (d2 <= cut * cut) ionNearCarbon[ion] = 1;
      }
    }
  }
  const total = m;

  // Per-atom candidate lists (CSR), each in ascending partner order.
  const start = new Int32Array(n + 1);
  for (let k = 0; k < total; k += 1) {
    start[ci[k] + 1] += 1;
    start[cj[k] + 1] += 1;
  }
  for (let a = 0; a < n; a += 1) start[a + 1] += start[a];
  const fill = start.slice(0, n);
  const incident = new Int32Array(2 * total);
  for (let k = 0; k < total; k += 1) {
    incident[fill[ci[k]]++] = k;
    incident[fill[cj[k]]++] = k;
  }
  const other = (k: number, a: number) => (ci[k] === a ? cj[k] : ci[k]);
  const remove = (k: number, reason: number) => {
    alive[k] = 0;
    counts.removed += 1;
    evidence?.push(ci[k], cj[k], reason, cd[k]);
  };
  const aliveOfKind = (a: number, kind: number): number[] => {
    const out: number[] = [];
    for (let p = start[a]; p < start[a + 1]; p += 1) {
      const k = incident[p];
      if (alive[k] && ckind[k] === kind) out.push(k);
    }
    return out;
  };
  const byStretch = (p: number, q: number) => cstretch[p] - cstretch[q] || ci[p] - ci[q] || cj[p] - cj[q];

  // ── Step 2: H–H survives only between two H with no other covalent candidate ──
  const covDegree = new Int32Array(n);
  for (let k = 0; k < total; k += 1) {
    if (ckind[k] !== KIND_COVALENT) continue;
    covDegree[ci[k]] += 1;
    covDegree[cj[k]] += 1;
  }
  for (let k = 0; k < total; k += 1) {
    if (ckind[k] === KIND_COVALENT && z[ci[k]] === 1 && z[cj[k]] === 1
      && (covDegree[ci[k]] !== 1 || covDegree[cj[k]] !== 1)) {
      remove(k, REMOVAL_REASON.hydrogenPair);
    }
  }

  // ── Step 3: one partner per hydrogen (B–H–B bridges, η²-H₂, hydrides) ──
  const bridgingAtom = new Uint8Array(n);
  for (let h = 0; h < n; h += 1) {
    if (cls[h] !== H) continue;
    const covalent = aliveOfKind(h, KIND_COVALENT).sort(byStretch);
    let kept = Math.min(1, covalent.length);
    if (covalent.length >= 2 && z[other(covalent[0], h)] === 5 && z[other(covalent[1], h)] === 5) {
      kept = 2;
      bridgingAtom[h] = 1;
      bridgingBond[covalent[0]] = 1;
      bridgingBond[covalent[1]] = 1;
    }
    for (let p = kept; p < covalent.length; p += 1) remove(covalent[p], REMOVAL_REASON.hydrogenSinglePartner);

    const metalH = aliveOfKind(h, KIND_METAL_H);
    if (kept > 0) {
      const h2Unit = kept === 1 && z[other(covalent[0], h)] === 1;
      for (const k of metalH) {
        if (h2Unit) ckind[k] = KIND_COORDINATION;
        else remove(k, REMOVAL_REASON.hydrogenMetalContact);
      }
    } else {
      metalH.sort(byStretch);
      metalH.forEach((k, p) => {
        if (p < 2) ckind[k] = KIND_COORDINATION;
        else remove(k, REMOVAL_REASON.hydrogenSinglePartner);
      });
      if (metalH.length >= 2) bridgingAtom[h] = 1;
    }
  }

  // ── Step 4: drop B–B / M–M when both atoms bond the same bridging H ──
  const pairIndex = new Map<number, number>();
  for (let k = 0; k < total; k += 1) pairIndex.set(ci[k] * n + cj[k], k);
  for (let h = 0; h < n; h += 1) {
    if (!bridgingAtom[h]) continue;
    const partners: number[] = [];
    for (let p = start[h]; p < start[h + 1]; p += 1) {
      const k = incident[p];
      if (alive[k] && (ckind[k] === KIND_COVALENT || ckind[k] === KIND_COORDINATION)) partners.push(other(k, h));
    }
    if (partners.length !== 2) continue;
    const a = Math.min(partners[0], partners[1]);
    const b = Math.max(partners[0], partners[1]);
    const k = pairIndex.get(a * n + b);
    if (k === undefined || !alive[k]) continue;
    const boranes = z[a] === 5 && z[b] === 5 && ckind[k] === KIND_COVALENT;
    const metals = cls[a] === METAL && cls[b] === METAL && ckind[k] === KIND_COORDINATION;
    if (boranes || metals) remove(k, REMOVAL_REASON.bridgedPair);
  }

  // ── Step 5: acute angle at covalent centres ───────────────────────
  for (let a = 0; a < n; a += 1) {
    if (cls[a] !== COV) continue;
    const bonds = aliveOfKind(a, KIND_COVALENT);
    if (bonds.length < 2) continue;
    bonds.sort(byStretch);
    const ax = positions[3 * a];
    const ay = positions[3 * a + 1];
    const az = positions[3 * a + 2];
    const keptBonds: number[] = [];
    for (const k of bonds) {
      if (!bridgingBond[k]) {
        const o = other(k, a);
        const ux = positions[3 * o] - ax;
        const uy = positions[3 * o + 1] - ay;
        const uz = positions[3 * o + 2] - az;
        const uu = ux * ux + uy * uy + uz * uz;
        let acute = false;
        for (const q of keptBonds) {
          const p = other(q, a);
          const vx = positions[3 * p] - ax;
          const vy = positions[3 * p + 1] - ay;
          const vz = positions[3 * p + 2] - az;
          const dot = ux * vx + uy * vy + uz * vz;
          if (dot > 0 && dot * dot > ACUTE_ANGLE_COS2 * uu * (vx * vx + vy * vy + vz * vz)) {
            acute = true;
            break;
          }
        }
        if (acute) {
          remove(k, REMOVAL_REASON.acuteAngle);
          continue;
        }
      }
      keptBonds.push(k);
    }
  }

  // ── Step 6: valence caps, most stretched first ────────────────────
  const valence = new Int32Array(n);
  const restricted = new Int32Array(n);
  const restrictedPartner = (a: number, partner: number) => {
    const rule = PARTNER_RULES[z[a]];
    return rule !== undefined && !rule.allowed.has(z[partner]);
  };
  const covalentAlive: number[] = [];
  for (let k = 0; k < total; k += 1) {
    if (!alive[k] || ckind[k] !== KIND_COVALENT) continue;
    covalentAlive.push(k);
    valence[ci[k]] += 1;
    valence[cj[k]] += 1;
    if (restrictedPartner(ci[k], cj[k])) restricted[ci[k]] += 1;
    if (restrictedPartner(cj[k], ci[k])) restricted[cj[k]] += 1;
  }
  const cap = (a: number) => {
    if (z[a] === 1) return bridgingAtom[a] ? 2 : 1;
    if (z[a] === 8) return params.oxygenCap;
    return VALENCE_CAPS[z[a]] ?? Infinity;
  };
  const overFor = (a: number, partner: number) => {
    if (valence[a] > cap(a)) return true;
    return restrictedPartner(a, partner) && restricted[a] > PARTNER_RULES[z[a]].limit;
  };
  covalentAlive.sort((p, q) => cstretch[q] - cstretch[p] || ci[p] - ci[q] || cj[p] - cj[q]);
  for (const k of covalentAlive) {
    if (bridgingBond[k]) continue;
    const a = ci[k];
    const b = cj[k];
    if (!overFor(a, b) && !overFor(b, a)) continue;
    remove(k, REMOVAL_REASON.valenceCap);
    valence[a] -= 1;
    valence[b] -= 1;
    if (restrictedPartner(a, b)) restricted[a] -= 1;
    if (restrictedPartner(b, a)) restricted[b] -= 1;
  }

  // ── Step 7: metals — haptic trim, then the coordination cap ───────
  if (hasMetal) {
    const local = new Int32Array(n).fill(-1);
    for (let metal = 0; metal < n; metal += 1) {
      if (cls[metal] !== METAL) continue;
      const bonds = aliveOfKind(metal, KIND_COORDINATION);
      if (bonds.length < 2) continue;
      const partners = bonds.map((k) => other(k, metal));
      partners.forEach((p, idx) => { local[p] = idx; });
      const parent = partners.map((_, idx) => idx);
      const find = (x: number): number => {
        let root = x;
        while (parent[root] !== root) root = parent[root];
        return root;
      };
      partners.forEach((p, idx) => {
        for (const k of aliveOfKind(p, KIND_COVALENT)) {
          const q = local[other(k, p)];
          if (q < 0) continue;
          const ra = find(idx);
          const rb = find(q);
          if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
        }
      });
      const shortest = new Float64Array(partners.length).fill(Infinity);
      const size = new Int32Array(partners.length);
      bonds.forEach((k, idx) => {
        const root = find(idx);
        size[root] += 1;
        if (cd[k] < shortest[root]) shortest[root] = cd[k];
      });
      bonds.forEach((k, idx) => {
        const root = find(idx);
        if (size[root] >= 2 && cd[k] > params.hapticRatio * shortest[root]) remove(k, REMOVAL_REASON.hapticTrim);
      });
      partners.forEach((p) => { local[p] = -1; });
    }
    for (let metal = 0; metal < n; metal += 1) {
      if (cls[metal] !== METAL) continue;
      const bonds = aliveOfKind(metal, KIND_COORDINATION);
      if (bonds.length <= METAL_COORDINATION_CAP) continue;
      bonds.sort(byStretch);
      for (let p = METAL_COORDINATION_CAP; p < bonds.length; p += 1) remove(bonds[p], REMOVAL_REASON.metalCoordinationCap);
    }
  }

  // ── Step 8: ions — donor precedence, then coordination-number caps ──
  if (hasIon) {
    const contactDistance = new Float64Array(n).fill(NaN);
    for (let ion = 0; ion < n; ion += 1) {
      if (cls[ion] !== ION) continue;
      const contacts = aliveOfKind(ion, KIND_CONTACT);
      if (contacts.length === 0) continue;
      for (const k of contacts) contactDistance[other(k, ion)] = cd[k];
      const shadowed = contacts.filter((k) => {
        const donor = other(k, ion);
        for (const b of aliveOfKind(donor, KIND_COVALENT)) {
          const dY = contactDistance[other(b, donor)];
          if (dY < cd[k] - ION_DONOR_PRECEDENCE_A) return true;
        }
        return false;
      });
      for (const k of contacts) contactDistance[other(k, ion)] = NaN;
      for (const k of shadowed) remove(k, REMOVAL_REASON.ionDonorPrecedence);

      const remaining = contacts.filter((k) => alive[k]);
      const limit = ION_COORDINATION_CAPS[z[ion]] + params.ionCapDelta;
      if (remaining.length <= limit) continue;
      const slack = (k: number) => cd[k] - rion[ion] - rdonor[other(k, ion)];
      remaining.sort((p, q) => slack(p) - slack(q) || ci[p] - ci[q] || cj[p] - cj[q]);
      for (let p = Math.max(0, limit); p < remaining.length; p += 1) remove(remaining[p], REMOVAL_REASON.ionCoordinationCap);
    }
  }

  // ── Step 9: counts from the final graph ───────────────────────────
  let count = 0;
  for (let k = 0; k < total; k += 1) if (alive[k]) count += 1;
  const pairs = new Int32Array(count * 2);
  const kinds = new Uint8Array(count);
  const distances = new Float32Array(count);
  const excess = new Float32Array(count);
  const linkI: number[] = [];
  const linkJ: number[] = [];
  const heavyPartners = new Int32Array(n);
  const anyPartners = new Int32Array(n);
  let w = 0;
  for (let k = 0; k < total; k += 1) {
    if (!alive[k]) continue;
    const a = ci[k];
    const b = cj[k];
    const e = cd[k] - (rcov[a] + rcov[b]);
    pairs[2 * w] = a;
    pairs[2 * w + 1] = b;
    kinds[w] = ckind[k];
    distances[w] = cd[k];
    excess[w] = e;
    w += 1;
    if (ckind[k] === KIND_CONTACT) {
      counts.ionicContact += 1;
      continue;
    }
    if (ckind[k] === KIND_COVALENT) {
      counts.covalent += 1;
      if (e > LONG_EXCESS_A) counts.long += 1;
    } else counts.coordination += 1;
    linkI.push(a);
    linkJ.push(b);
    anyPartners[a] += 1;
    anyPartners[b] += 1;
    if (z[b] !== 1) heavyPartners[a] += 1;
    if (z[a] !== 1) heavyPartners[b] += 1;
  }
  counts.fragments = countFragments(n, linkI, linkJ, linkI.length);
  for (let a = 0; a < n; a += 1) {
    if (cls[a] === H && anyPartners[a] === 2 && heavyPartners[a] === 2) counts.bridgingH += 1;
    if (ionNearCarbon[a]) counts.ionCarbonClose += 1;
  }

  return {
    recipe: MOLECULAR_RECIPE_ID,
    params: { tolerance, contactMargin: params.contactMargin, clashFloor: CLASH_FLOOR_A, longExcess: LONG_EXCESS_A },
    count,
    pairs,
    kinds,
    distances,
    excess,
    evidence: evidence ? evidence.finish() : null,
    counts,
  };
}
