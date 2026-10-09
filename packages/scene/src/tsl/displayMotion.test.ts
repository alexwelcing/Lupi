import { describe, expect, it } from 'vitest';
import { MOTION } from '@atlas/core/motion';
import { stepResponse } from '@atlas/core/motion/stepResponse';
import { DISPLAY_MOTION_TUNING, ARRIVAL_MODE, MORPH_TEXEL_STRIDE, type DisplayMorphData } from './displayMotion';
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

describe('display motion twin: the morph arrival', () => {
  // The new molecule: the shell's first 24 points; each starts from a point
  // of the old frame (a scaled, shifted copy of another shell point) after a
  // delay that grows with the index.
  const count = 24;
  const positions = new Float32Array(count * 3);
  const texels = new Float32Array(count * MORPH_TEXEL_STRIDE);
  for (let i = 0; i < count; i += 1) {
    positions.set(atoms[i], i * 3);
    const from = atoms[(i * 7 + 3) % atoms.length];
    texels.set([from[0] / 12, from[1] / 12, (from[2] - 1) / 12, 0.006 * i], i * MORPH_TEXEL_STRIDE);
  }
  const morph: DisplayMorphData = { positions, count, texels };
  const rest = (i: number): TwinVec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];

  /** A morph 0.9 s long on the settle token, in a view frame turned about y and scaled by its depth (12 Å). */
  function morphState(elapsed: number, gentle = false): DisplayMotionTwinState {
    const state = restTwinState();
    const token = gentle ? MOTION.glide : MOTION.settle;
    state.motionWeight = 1;
    state.arrivalWeight = gentle ? 0.5 : 1;
    state.arrivalMode = ARRIVAL_MODE.morph;
    state.arrivalT0 = 3;
    state.now = 3 + elapsed;
    state.arrivalDuration = gentle ? 0.55 : 0.9;
    state.arrivalOmega = 2 / token.smoothTime;
    state.arrivalZeta = token.dampingRatio;
    state.arrivalDelayScale = gentle ? 0.5 : 1;
    const c = Math.cos(0.4) * 12;
    const s = Math.sin(0.4) * 12;
    state.morphOrigin = [0.5, -0.25, 1];
    state.morphAxisX = [c, 0, -s];
    state.morphAxisY = [0, 12, 0];
    state.morphAxisZ = [s, 0, c];
    state.morphCount = count;
    state.morph = morph;
    return state;
  }

  /** The morph term transcribed independently: the core step response, the texel carried into the view. */
  function reference(state: DisplayMotionTwinState, i: number): TwinVec3 {
    const t = Array.from(texels.subarray(i * MORPH_TEXEL_STRIDE, (i + 1) * MORPH_TEXEL_STRIDE));
    const start = [0, 1, 2].map((k) => state.morphOrigin[k] + state.morphAxisX[k] * t[0] + state.morphAxisY[k] * t[1] + state.morphAxisZ[k] * t[2]);
    const elapsed = state.now - state.arrivalT0;
    const token = { smoothTime: 2 / state.arrivalOmega, dampingRatio: state.arrivalZeta };
    const left = 1 - stepResponse(token, Math.max(elapsed - t[3] * state.arrivalDelayScale, 0));
    const D = state.arrivalDuration;
    const x = Math.min(1, Math.max(0, (elapsed - (D - DISPLAY_MOTION_TUNING.endFadeS)) / DISPLAY_MOTION_TUNING.endFadeS));
    const fade = 1 - x * x * (3 - 2 * x);
    const p = rest(i);
    return [0, 1, 2].map((k) => (start[k] - p[k]) * left * fade * state.arrivalWeight) as TwinVec3;
  }

  it('mirrors the GPU formula at every sampled time', () => {
    for (const gentle of [false, true]) {
      for (const elapsed of [0, 0.02, 0.05, 0.1, 0.17, 0.25, 0.4, 0.6, 0.8, 0.85, 0.88]) {
        const state = morphState(elapsed, gentle);
        for (let i = 0; i < count; i += 1) {
          const twin = displayOffsetTwin(state, rest(i));
          const ref = reference(state, i);
          for (let k = 0; k < 3; k += 1) expect(twin[k]).toBeCloseTo(ref[k], 9);
        }
      }
    }
  });

  it('starts every atom exactly at its texel and lands it exactly at rest', () => {
    const start = morphState(0);
    for (let i = 0; i < count; i += 1) {
      const off = displayOffsetTwin(start, rest(i));
      const t = texels.subarray(i * MORPH_TEXEL_STRIDE);
      const at = [0, 1, 2].map((k) => rest(i)[k] + off[k]);
      const want = [0, 1, 2].map((k) => start.morphOrigin[k] + start.morphAxisX[k] * t[0] + start.morphAxisY[k] * t[1] + start.morphAxisZ[k] * t[2]);
      for (let k = 0; k < 3; k += 1) expect(at[k]).toBeCloseTo(want[k], 9);
      expect(zero(displayOffsetTwin(morphState(0.9), rest(i)))).toBe(true);
      expect(zero(displayOffsetTwin(morphState(2), rest(i)))).toBe(true);
      const idle = morphState(0.3);
      idle.motionWeight = 0;
      expect(zero(displayOffsetTwin(idle, rest(i)))).toBe(true);
    }
  });

  it('leaves points that are not this morph\'s atoms at rest', () => {
    const state = morphState(0.1);
    expect(zero(displayOffsetTwin(state, [9, 9, 9]))).toBe(true);
    // An index past the texture's count never morphs, as on the GPU.
    state.morphCount = 10;
    expect(zero(displayOffsetTwin(state, rest(12)))).toBe(true);
    expect(zero(displayOffsetTwin(state, rest(3)))).toBe(false);
    state.morph = null;
    expect(zero(displayOffsetTwin(state, rest(3)))).toBe(true);
  });
});
