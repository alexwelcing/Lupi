/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vec3, type Quat, type Vec3 as MathVec3 } from 'math';
import { describe, expect, it } from 'vitest';
import { getAtomicNumberBySymbol } from '../elements';
import { computeBonds } from './bonds';
import { coveringRadiusDeg } from './detents';
import { computeObjectFacts, type ObjectFactsInput, type ObjectFactsV1, type Vec3 } from './index';

const GALLERY = join(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/public/gallery/curated');

function readXyz(file: string): ObjectFactsInput & { atomicNumbers: number[]; positions: number[] } {
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

const count = <T>(items: T[], pick: (item: T) => boolean) => items.filter(pick).length;
const det = ([x, y, z]: [Vec3, Vec3, Vec3]) =>
  x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);

function expectFinite(value: unknown): void {
  if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  else if (Array.isArray(value)) value.forEach(expectFinite);
  else if (value && typeof value === 'object') Object.values(value).forEach(expectFinite);
}

const FIXTURES = [
  'c60_buckyball.xyz',
  'popular/caffeine.xyz',
  'popular/benzene.xyz',
  'popular/water.xyz',
  'popular/nitrous_oxide.xyz',
  'popular/oxygen.xyz',
  'graphene_ribbon.xyz',
];

describe('object facts', () => {
  it.each(FIXTURES)('%s: finite, right-handed axes, principalQuat maps body → axes, detents ≥ 2° apart', (file) => {
    const f = facts(file);
    expectFinite(f);
    expect(det(f.axes)).toBeCloseTo(1, 9);
    f.axes.forEach((axis, i) => {
      const body: MathVec3 = [0, 0, 0];
      body[i] = 1;
      const world = vec3.transformQuat([0, 0, 0], body, f.principalQuat as Quat);
      world.forEach((c, k) => expect(c).toBeCloseTo(axis[k], 9));
    });
    const cos2 = Math.cos((2 * Math.PI) / 180);
    f.detents.forEach((d, i) => {
      f.detents.slice(i + 1).forEach((e) => expect(vec3.dot(d.dir, e.dir)).toBeLessThan(cos2));
    });
  });

  it('C60: spherical top, 90 bonds of 32 faces, Ih rotation axes, labelled face detents, 24° capture', () => {
    const f = facts('c60_buckyball.xyz');
    expect(f.rotor).toBe('spherical');
    expect((f.moments[2] - f.moments[0]) / f.moments[2]).toBeLessThan(1e-3);
    expect(count(f.rings, (r) => r.size === 5)).toBe(12);
    expect(count(f.rings, (r) => r.size === 6)).toBe(20);
    const input = readXyz('c60_buckyball.xyz');
    expect(computeBonds(input.atomicNumbers, input.positions, input.natoms).pairs).toHaveLength(90);
    expect(count(f.symmetryAxes, (a) => a.order === 5)).toBe(6);
    expect(count(f.symmetryAxes, (a) => a.order === 3)).toBe(10);
    expect(count(f.symmetryAxes, (a) => a.order === 2)).toBe(15);
    expect(f.symmetryAxes).toHaveLength(31);
    expect(count(f.detents, (d) => d.label === 'Pentagon face-on · 5-fold axis')).toBe(12);
    expect(count(f.detents, (d) => d.label === 'Hexagon face-on · 3-fold axis')).toBe(20);
    expect(f.detents).toHaveLength(32);
    expect(coveringRadiusDeg(f.detents.map((d) => d.dir))).toBeLessThanOrEqual(23);
    expect(f.captureRadiusDeg).toBe(24);
    expect(f.provenance).toEqual({ method: expect.any(String), tolerance: 0.05, unresolvedElements: 0 });
  });

  it('caffeine: asymmetric top at 481/718/1190, no Cn, principal detents, 12° capture', () => {
    const f = facts('popular/caffeine.xyz');
    expect(f.rotor).toBe('asymmetric');
    [481, 718, 1190].forEach((m, i) => expect(Math.abs(f.moments[i] - m) / m).toBeLessThan(0.01));
    expect(f.symmetryAxes).toEqual([]);
    expect(f.detents.some((d) => d.label.includes('fold'))).toBe(false);
    expect(count(f.detents, (d) => d.kind === 'principal')).toBeGreaterThanOrEqual(4);
    expect(f.captureRadiusDeg).toBe(12);
  });

  it('benzene: oblate planar top, Ic = 2·Ia, 6-fold hexagon face, edge-on detents', () => {
    const f = facts('popular/benzene.xyz');
    expect(f.rotor).toBe('oblate');
    expect(Math.abs(f.moments[2] / (2 * f.moments[0]) - 1)).toBeLessThan(0.02);
    expect(f.planar).toBe(true);
    expect(f.detents.filter((d) => d.label === 'Hexagon face-on · 6-fold axis')).toHaveLength(2);
    expect(count(f.detents, (d) => d.kind === 'plane-edge')).toBe(6);
  });

  it('water has one C2; N2O and O2 are linear', () => {
    const water = facts('popular/water.xyz');
    expect(water.rotor).toBe('asymmetric');
    expect(water.symmetryAxes.map((a) => a.order)).toEqual([2]);
    for (const file of ['popular/nitrous_oxide.xyz', 'popular/oxygen.xyz']) {
      const f = facts(file);
      expect(f.rotor).toBe('linear');
      expect(f.planar).toBe(false);
      expect(f.detents.length).toBeGreaterThan(0);
    }
  });

  it('graphene ribbon is planar to 1e-3 Å', () => {
    const f = facts('graphene_ribbon.xyz');
    expect(f.planar).toBe(true);
    expect(f.planarityRms).toBeLessThan(1e-3);
  });

  it('C60 with 0.2 Å seeded noise claims no axis and labels faces "Ring face-on"', () => {
    const input = readXyz('c60_buckyball.xyz');
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const positions = input.positions.map((p) => p + (rand() * 2 - 1) * 0.2);
    const f = computeObjectFacts({ ...input, positions });
    expect(f?.symmetryAxes).toEqual([]);
    expect(f?.detents.some((d) => d.label.includes('fold'))).toBe(false);
    expect(f?.detents.filter((d) => d.kind === 'ring-face').every((d) => d.label === 'Ring face-on')).toBe(true);
  });

  it('refuses empty and oversized inputs; C60 runs in under 20 ms', () => {
    expect(computeObjectFacts({ atomicNumbers: [], positions: [], natoms: 0 })).toBeNull();
    const big = 2001;
    const grid = Array.from({ length: 3 * big }, (_, i) => (i % 3) * 1.5 + Math.floor(i / 3) * 0.01);
    expect(computeObjectFacts({ atomicNumbers: new Array(big).fill(6), positions: grid, natoms: big })).toBeNull();

    const input = readXyz('c60_buckyball.xyz');
    computeObjectFacts(input);
    const times: number[] = [];
    for (let k = 0; k < 20; k += 1) {
      const t0 = performance.now();
      computeObjectFacts(input);
      times.push(performance.now() - t0);
    }
    expect(times.sort((a, b) => a - b)[10]).toBeLessThan(20);
  });
});
