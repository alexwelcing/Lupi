import { describe, expect, it } from 'vitest';
import { MOTION } from '@atlas/core/motion';
import { stepResponse } from '@atlas/core/motion/stepResponse';
import { DISPLAY_MOTION_TUNING, ARRIVAL_MODE } from './displayMotion';
import {
  displayOffsetTwin,
  pcgHash,
  pcgHashUint,
  restTwinState,
  twinStepResponse,
  type DisplayMotionTwinState,
  type TwinVec3,
} from './displayMotionTwin';

/** three r186 Hash.js transcribed with BigInt arithmetic mod 2^32 (an independent reference). */
function referenceHash(seed: number): number {
  const M = 0xffffffffn;
  const state = (BigInt(seed >>> 0) * 747796405n + 2891336453n) & M;
  const word = (((state >> ((state >> 28n) + 4n)) ^ state) * 277803737n) & M;
  return Number(((word >> 22n) ^ word) & M);
}

/** A C60-sized cloud of points on a sphere of radius 3.5 Å. */
function shell(count: number): TwinVec3[] {
  const points: TwinVec3[] = [];
  for (let i = 0; i < count; i += 1) {
    const z = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - z * z);
    const phi = i * 2.399963;
    points.push([3.5 * r * Math.cos(phi), 3.5 * z, 3.5 * r * Math.sin(phi)]);
  }
  return points;
}

function arrivalState(mode: number, elapsed: number): DisplayMotionTwinState {
  const state = restTwinState();
  state.motionWeight = 1;
  state.arrivalWeight = 1;
  state.arrivalMode = mode;
  state.arrivalT0 = 10;
  state.now = 10 + elapsed;
  state.arrivalRadius = 3.5;
  state.arrivalSeed = 12345;
  state.arrivalOmega = 2 / MOTION.land.smoothTime;
  state.arrivalZeta = MOTION.land.dampingRatio;
  return state;
}

const norm = (v: TwinVec3) => Math.hypot(...v);
/** Exactly zero (either sign). */
const zero = (v: TwinVec3) => v.every((x) => x === 0);
const atoms = shell(60);

describe('display motion twin', () => {
  it('mirrors three r186 PCG hash exactly', () => {
    const seeds = [0, 1, 2, 3, 7, 42, 255, 256, 65535, 65536, 12345, 0x7fffffff, 0x80000000, 0xdeadbeef, 0xfffffffe, 0xffffffff, 2654435769, 2246822507, 1234567890, 3000000000];
    for (const seed of seeds) {
      expect(pcgHashUint(seed)).toBe(referenceHash(seed));
      const h = pcgHash(seed);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it('mirrors the core step response for every token', () => {
    for (const token of Object.values(MOTION)) {
      const omega = 2 / token.smoothTime;
      for (let i = 0; i <= 60; i += 1) {
        const t = i * 0.02;
        expect(twinStepResponse(omega, token.dampingRatio, t)).toBeCloseTo(stepResponse(token, t), 9);
      }
    }
  });

  it('is exactly zero at weight 0 and from t0 + D on', () => {
    for (const mode of [ARRIVAL_MODE.condense, ARRIVAL_MODE.flat]) {
      for (const p of atoms) {
        expect(zero(displayOffsetTwin(arrivalState(mode, 0.6), p))).toBe(true);
        expect(zero(displayOffsetTwin(arrivalState(mode, 2), p))).toBe(true);
        const idle = arrivalState(mode, 0.2);
        idle.motionWeight = 0;
        expect(zero(displayOffsetTwin(idle, p))).toBe(true);
      }
    }
    const scatter = arrivalState(ARRIVAL_MODE.scatter, DISPLAY_MOTION_TUNING.scatterRiseS + 0.6);
    for (const p of atoms) expect(zero(displayOffsetTwin(scatter, p))).toBe(true);
  });

  it('starts in the cloud and condenses bottom-up', () => {
    const cloud = DISPLAY_MOTION_TUNING.cloudScale * 3.5;
    for (const p of atoms) {
      const off = displayOffsetTwin(arrivalState(ARRIVAL_MODE.condense, 0), p);
      expect(norm([p[0] + off[0], p[1] + off[1], p[2] + off[2]])).toBeLessThanOrEqual(cloud + 1e-9);
    }
    const bottom = atoms.filter((p) => p[1] < -3);
    const top = atoms.filter((p) => p[1] > 3);
    const mean = (list: TwinVec3[], t: number) =>
      list.reduce((sum, p) => sum + norm(displayOffsetTwin(arrivalState(ARRIVAL_MODE.condense, t), p)), 0) / list.length;
    expect(mean(bottom, 0.15)).toBeLessThan(mean(top, 0.15) * 0.5);
  });

  it('flat starts every atom on the centre plane', () => {
    const state = arrivalState(ARRIVAL_MODE.flat, 0);
    for (const p of atoms) {
      const off = displayOffsetTwin(state, p);
      expect(Math.abs(p[2] + off[2])).toBeLessThan(1e-9);
    }
  });

  it('ripples are finite at the poked atom and bounded by 0.3 Å', () => {
    const state = restTwinState();
    state.motionWeight = 1;
    state.rippleWeight = 1;
    const origin = atoms[7];
    for (let slot = 0; slot < 4; slot += 1) {
      state.ripples[slot] = {
        a: [origin[0], origin[1], origin[2], slot * 0.01],
        b: [DISPLAY_MOTION_TUNING.rippleAmplitude * 3, 20, 36, 0.28],
      };
    }
    let peak = 0;
    for (let i = 0; i < 80; i += 1) {
      state.now = i * 0.0125;
      expect(zero(displayOffsetTwin(state, origin))).toBe(true);
      for (const p of atoms) {
        const off = displayOffsetTwin(state, p);
        expect(off.every(Number.isFinite)).toBe(true);
        peak = Math.max(peak, norm(off));
      }
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThanOrEqual(0.3 + 1e-12);
  });
});
