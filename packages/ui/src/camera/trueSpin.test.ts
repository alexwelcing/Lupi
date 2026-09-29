/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { getAtomicNumberBySymbol } from '@atlas/core/elements';
import { computeObjectFacts, type ObjectFactsV1 } from '@atlas/core/objectFacts';
import type { Frame } from '@atlas/core/types';
import { TrueSpinCoast } from './trueSpinCoast';
import { SymmetryDetents } from './symmetryDetents';
import { objectFactsForFile } from './objectFactsForFile';
import type { Vec3 } from './rigApi';

const GALLERY = join(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/public/gallery/curated');

function readXyz(file: string) {
  const lines = readFileSync(join(GALLERY, file), 'utf8').split(/\r?\n/);
  const natoms = Number(lines[0]);
  const atomicNumbers: number[] = [];
  const positions: number[] = [];
  for (const line of lines.slice(2, 2 + natoms)) {
    const [symbol, x, y, z] = line.trim().split(/\s+/);
    atomicNumbers.push(getAtomicNumberBySymbol(symbol) ?? 0);
    positions.push(Number(x), Number(y), Number(z));
  }
  return { atomicNumbers, positions, natoms };
}

function facts(file: string): ObjectFactsV1 {
  const result = computeObjectFacts(readXyz(file));
  if (!result) throw new Error(`no facts for ${file}`);
  return result;
}

const C60 = facts('c60_buckyball.xyz');
const CAFFEINE = facts('popular/caffeine.xyz');
const DEG = Math.PI / 180;

function toWorld(f: ObjectFactsV1, body: Vec3): Vec3 {
  const v = new Vector3(...body).applyQuaternion(new Quaternion(...f.principalQuat));
  return [v.x, v.y, v.z];
}

/** Step `coast` at frame `dt` for `seconds`; the molecule's apparent orientation composes on the right. */
function run(coast: TrueSpinCoast, dt: number, seconds: number, each?: (dq: Quaternion, t: number) => void): Quaternion {
  const out: [number, number, number, number] = [0, 0, 0, 1];
  const q = new Quaternion();
  const dq = new Quaternion();
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i += 1) {
    coast.step(dt, out);
    dq.set(...out);
    q.multiply(dq).normalize();
    each?.(dq, (i + 1) * dt);
  }
  return q;
}

/** Deterministic unit vectors. */
function directions(count: number, seed = 7): Vec3[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out: Vec3[] = [];
  while (out.length < count) {
    const v: Vec3 = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const m = Math.hypot(...v);
    if (m > 0.1 && m <= 1) out.push([v[0] / m, v[1] / m, v[2] / m]);
  }
  return out;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angleDeg = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / DEG;

describe('TrueSpinCoast', () => {
  it('caffeine about its middle axis flips (tennis racket), conserving energy when undamped', () => {
    let flips = 0;
    const coast = new TrueSpinCoast(CAFFEINE, { dissipation: false, onFlip: () => (flips += 1) });
    coast.begin(toWorld(CAFFEINE, [0.01, 3, 0]));
    const e0 = coast.energy();
    run(coast, 1 / 60, 20);
    expect(flips).toBeGreaterThanOrEqual(2);
    expect(coast.flips()).toBe(flips);
    expect(Math.abs(coast.energy() / e0 - 1)).toBeLessThan(1e-3);
  });

  it('ends at the same orientation at 30, 60 and 120 Hz', () => {
    const end = [1 / 30, 1 / 60, 1 / 120].map((dt) => {
      const coast = new TrueSpinCoast(CAFFEINE, { dissipation: false });
      coast.begin(toWorld(CAFFEINE, [0.01, 3, 0]));
      return run(coast, dt, 20);
    });
    expect(end[0].angleTo(end[1]) / DEG).toBeLessThan(0.5);
    expect(end[1].angleTo(end[2]) / DEG).toBeLessThan(0.5);
  });

  it('C60 keeps its spin axis (a spherical top) and coasts to rest', () => {
    const coast = new TrueSpinCoast(C60);
    const omega: Vec3 = [1.2, -4, 2.5];
    const axis = new Vector3(...omega).normalize();
    coast.begin(omega);
    let worst = 0;
    run(coast, 1 / 60, 4, (dq) => {
      const v = new Vector3(dq.x, dq.y, dq.z);
      if (v.lengthSq() > 1e-18) worst = Math.max(worst, v.normalize().angleTo(axis) / DEG);
    });
    expect(worst).toBeLessThan(0.5);
    expect(coast.isRunning()).toBe(false);
  });

  it('a casual caffeine flick off every axis does not flip', () => {
    for (const dir of directions(40, 3)) {
      if (dir.some((c) => Math.abs(c) < 0.3)) continue; // well off every axis
      let flips = 0;
      const coast = new TrueSpinCoast(CAFFEINE, { onFlip: () => (flips += 1) });
      coast.begin(toWorld(CAFFEINE, [dir[0] * 5, dir[1] * 5, dir[2] * 5]));
      run(coast, 1 / 60, 6);
      expect(flips).toBe(0);
    }
  });

  it('Spin on caffeine flips within 6 s', () => {
    for (const seed of [1, 2, 3]) {
      let firstFlip = Number.POSITIVE_INFINITY;
      const coast = new TrueSpinCoast(CAFFEINE, { seed });
      coast.begin(coast.armSpin([0, 0, 1]));
      expect(coast.isSpinning()).toBe(true);
      run(coast, 1 / 60, 6, (_dq, t) => {
        if (coast.flips() > 0) firstFlip = Math.min(firstFlip, t);
      });
      expect(firstFlip).toBeLessThan(6);
    }
  });
});

describe('SymmetryDetents', () => {
  const detents = new SymmetryDetents(C60);

  it('C60: every rest direction captures a face within 24°', () => {
    expect(detents.captureRadiusDeg).toBe(24);
    for (const view of directions(1000)) {
      const hit = detents.capture(view, null);
      expect(hit).not.toBeNull();
      expect(hit!.label).toMatch(/^(Pentagon face-on · 5-fold axis|Hexagon face-on · 3-fold axis)$/);
      expect(angleDeg(hit!.dir, view)).toBeLessThanOrEqual(24);
    }
  });

  it('never captures behind the motion', () => {
    const views = directions(500, 11);
    const pushes = directions(500, 23);
    views.forEach((view, i) => {
      const p = pushes[i];
      const radial = dot(p, view);
      const velocity: Vec3 = [p[0] - radial * view[0], p[1] - radial * view[1], p[2] - radial * view[2]];
      const hit = detents.capture(view, velocity);
      if (hit) expect(dot(hit.dir, velocity)).toBeGreaterThanOrEqual(-1e-9);
    });
  });

  it('a measurement tool disables capture', () => {
    let measuring = true;
    const guarded = new SymmetryDetents(C60, { captureDisabled: () => measuring });
    const view = C60.detents[0].dir;
    expect(guarded.capture(view, null)).toBeNull();
    measuring = false;
    expect(guarded.capture(view, null)?.label).toBe(C60.detents[0].label);
  });

  it('step(+1, 0) goes to a detent to the right on screen, and away from the current one', () => {
    for (const view of directions(200, 5)) {
      if (Math.abs(view[1]) > 0.95) continue;
      const right = new Vector3(0, 1, 0).cross(new Vector3(...view)).normalize();
      const up = new Vector3(...view).cross(right).normalize();
      const r: Vec3 = [right.x, right.y, right.z];
      const u: Vec3 = [up.x, up.y, up.z];
      const hit = detents.step(view, r, u, 1, 0);
      expect(hit).not.toBeNull();
      expect(dot(hit!.dir, r)).toBeGreaterThan(0);
      expect(angleDeg(hit!.dir, view)).toBeGreaterThan(4);
      const upHit = detents.step(view, r, u, 0, 1);
      expect(upHit && dot(upHit.dir, u)).toBeGreaterThan(0);
    }
  });
});

describe('objectFactsForFile', () => {
  const frameOf = (atomicNumbers: number[], positions: number[]): Frame =>
    ({
      natoms: atomicNumbers.length,
      types: Int32Array.from(atomicNumbers),
      positions: Float32Array.from(positions),
      typeSemantics: { kind: 'atomic-number', provenance: 'xyz-element-token' },
    }) as unknown as Frame;

  it('maps types through the frame semantics (C60 gets its 32 faces)', () => {
    const { atomicNumbers, positions } = readXyz('c60_buckyball.xyz');
    const f = objectFactsForFile(frameOf(atomicNumbers, positions));
    expect(f?.rotor).toBe('spherical');
    expect(f?.detents).toHaveLength(32);
    expect(f?.provenance.unresolvedElements).toBe(0);
  });

  it('a 3,000-atom frame gets no facts', () => {
    const n = 3000;
    const positions = Array.from({ length: 3 * n }, (_, i) => (i % 3) * 1.5 + Math.floor(i / 3) * 0.01);
    expect(objectFactsForFile(frameOf(new Array(n).fill(6), positions))).toBeNull();
  });
});
