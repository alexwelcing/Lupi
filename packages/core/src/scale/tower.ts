// lupi.gen.tower@1 (scale-spec §3.4): level arithmetic, the copy key and the
// dopant substitution. Every quantity is an exact bigint, so a googolplex
// tower costs what its digit runs cost, never its levels.

import { concatBytes, fail } from './bytes';
import { DOMAIN_COPY, leU64, sha256, SplitMix64 } from './hash';
import { stepBytes, type AxisRuns, type Step } from './paths';
import type { NodeID, Substitution, TowerNode } from './records';

/** The axis level k stacks along, for k ≥ 1. */
export const towerAxis = (k: bigint): number => Number((k - 1n) % 3n);

/** Unit exponent of level k: a level-k frame unit is f^u(k) seed units. */
export const unitExponent = (k: bigint): bigint => (k === 0n ? 0n : (k - 1n) / 3n);

/** How many of levels 1…k stack along axis a. */
export function levelsAlong(a: number, k: bigint): bigint {
  if (k < 0n) fail('range', 'negative level');
  if (k < 1n << 50n) return BigInt(Math.floor((Number(k) + 2 - a) / 3));
  return (k + 2n - BigInt(a)) / 3n;
}

/** How many of levels k, k−1, …, k−D+1 stack along axis a. */
export const levelsAlongSpan = (a: number, k: bigint, d: bigint): bigint => levelsAlong(a, k) - levelsAlong(a, k - d);

/** §3.4.5: the copy key of the seed copy that a full descent's step names. */
export function copyKey(towerId: NodeID, fullStep: Step | null): bigint {
  const bytes = fullStep ? stepBytes(fullStep) : new Uint8Array(0);
  return leU64(sha256(concatBytes([DOMAIN_COPY, towerId, bytes])));
}

/** The single tower step from level L to level 0 along the given per-axis digits. */
export function fullTowerStep(levels: bigint, runs: AxisRuns): Step | null {
  return levels === 0n ? null : { tag: 'tower', levels, runs };
}

/**
 * §3.4.6: perCopy atoms of fromZ become toZ, picked by a partial
 * Fisher–Yates shuffle seeded with the copy key. Returns the new elements
 * and the chosen atom indices in pick order.
 */
export function substitute(z: ArrayLike<number>, sub: Substitution, key: bigint): { z: Uint8Array; chosen: number[] } {
  const idx: number[] = [];
  for (let i = 0; i < z.length; i += 1) if (z[i] === sub.fromZ) idx.push(i);
  const m = idx.length;
  if (m < sub.perCopy) fail('validity', 'seed holds fewer than perCopy atoms of fromZ');
  const pool = Array.from({ length: m }, (_, i) => i);
  const g = new SplitMix64(key);
  for (let t = 0; t < sub.perCopy; t += 1) {
    const r = g.next();
    const j = t + Number(r % BigInt(m - t));
    const tmp = pool[t];
    pool[t] = pool[j];
    pool[j] = tmp;
  }
  const out = Uint8Array.from(z);
  const chosen: number[] = [];
  for (let t = 0; t < sub.perCopy; t += 1) {
    out[idx[pool[t]]] = sub.toZ;
    chosen.push(idx[pool[t]]);
  }
  return { z: out, chosen };
}

/** Period vectors as Numbers in Å (each component below 2⁴⁰ Q16, so exact). */
export function periodsAngstrom(t: TowerNode): number[][] {
  return t.periods.map((p) => p.map((v) => Number(v) / 65536));
}
