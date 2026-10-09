import { describe, expect, it } from 'vitest';
import {
  MORPH_TUNING,
  matchMorph,
  morphFrame,
  planMorph,
  shouldMorph,
  type MorphGateInput,
  type MorphMolecule,
  type MorphVec3,
  type MorphView,
} from './morphMatch';

/** A C60-sized cloud of `count` carbons on a sphere of radius `r`. */
function shell(count: number, r: number, element = 6): MorphMolecule {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const z = 1 - (2 * (i + 0.5)) / count;
    const s = Math.sqrt(1 - z * z);
    const phi = i * 2.399963;
    positions[i * 3] = r * s * Math.cos(phi);
    positions[i * 3 + 1] = r * z;
    positions[i * 3 + 2] = r * s * Math.sin(phi);
  }
  return { positions, elements: new Array(count).fill(element), count };
}

/** Caffeine-like: a small flat cluster of C, N, O and H. */
function cluster(): MorphMolecule {
  const elements = [6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const positions = new Float32Array(elements.length * 3);
  for (let i = 0; i < elements.length; i += 1) {
    const a = i * 0.7;
    const r = 1 + (i % 5) * 0.6;
    positions[i * 3] = r * Math.cos(a);
    positions[i * 3 + 1] = r * Math.sin(a);
    positions[i * 3 + 2] = (i % 3) * 0.2 - 0.2;
  }
  return { positions, elements, count: elements.length };
}

/** A camera at distance `d` along +z from `center`, looking at it. */
function view(center: MorphVec3, radius: number, d = radius * 3): MorphView {
  return {
    eye: [center[0], center[1], center[2] + d],
    right: [1, 0, 0],
    up: [0, 1, 0],
    back: [0, 0, 1],
    perspective: true,
    center,
    radius,
  };
}

/** Each new atom's start (world, Å) from a plan and the new view's frame. */
function starts(plan: NonNullable<ReturnType<typeof planMorph>>, count: number): Float64Array {
  const out = new Float64Array(count * 3);
  const { origin: O, axisX: X, axisY: Y, axisZ: Z } = plan.frame;
  for (let i = 0; i < count; i += 1) {
    const t = [plan.texels[i * 4], plan.texels[i * 4 + 1], plan.texels[i * 4 + 2]];
    for (let k = 0; k < 3; k += 1) out[i * 3 + k] = O[k] + X[k] * t[0] + Y[k] * t[1] + Z[k] * t[2];
  }
  return out;
}

describe('morph matching', () => {
  it('matches identical molecules to themselves with zero offsets', () => {
    const c60 = shell(60, 3.5);
    const v = view([0, 0, 0], 3.5);
    const plan = planMorph({ ...c60, view: v }, { ...c60, view: v })!;
    expect(plan.report).toMatchObject({ atoms: 60, previousAtoms: 60, sameElement: 60, crossElement: 0, budded: 0, vanished: 0, frame: 'depth' });
    const s = starts(plan, 60);
    for (let i = 0; i < 180; i += 1) expect(Math.abs(s[i] - c60.positions[i])).toBeLessThan(1e-4);
  });

  it('prefers the same element, then any element', () => {
    // Two old atoms: a carbon far away and a nitrogen right on top of the new carbon.
    const previous = { points: new Float64Array([5, 0, 0, 0, 0, 0]), elements: [6, 7], count: 2 };
    const next = { points: new Float64Array([0, 0, 0, 5, 0, 0]), elements: [6, 8], count: 2 };
    const match = matchMorph(previous, next);
    expect(Array.from(match.from)).toEqual([0, 1]);
    expect(match.sameElement).toBe(1);
    expect(match.crossElement).toBe(1);
  });

  it('buds new atoms past the supply out of their nearest matched neighbour', () => {
    const previous = { points: new Float64Array([0, 0, 0, 10, 0, 0]), elements: [6, 6], count: 2 };
    const next = {
      points: new Float64Array([0, 0, 0, 10, 0, 0, 0.5, 0, 0, 9.5, 0, 0, 0, 0.4, 0]),
      elements: [6, 6, 1, 1, 1],
      count: 5,
    };
    const match = matchMorph(previous, next);
    expect(Array.from(match.from)).toEqual([0, 1, 0, 1, 0]);
    expect(Array.from(match.budFrom)).toEqual([-1, -1, 0, 1, 0]);
    expect(match.budded).toBe(3);
    expect(match.vanished).toBe(0);
  });

  it('uses each old atom at most once and lets the rest vanish', () => {
    const c60 = shell(60, 3.5);
    const caffeine = cluster();
    const plan = planMorph({ ...c60, view: view([0, 0, 0], 3.5) }, { ...caffeine, view: view([0, 0, 0], 3) })!;
    expect(plan.report).toMatchObject({ atoms: 24, previousAtoms: 60, sameElement: 8, crossElement: 16, budded: 0, vanished: 36 });
    const match = matchMorph(
      { points: new Float64Array(c60.positions), elements: c60.elements, count: 60 },
      { points: new Float64Array(caffeine.positions), elements: caffeine.elements, count: 24 },
    );
    expect(new Set(match.from).size).toBe(24);
  });

  it('starts every atom where the old one was on screen', () => {
    // C60 seen from +z at 12 Å; water seen from +x at 4 Å around another centre.
    const c60 = shell(60, 3.5);
    const water: MorphMolecule = { positions: new Float32Array([0, 0, 0, 0.76, 0.59, 0, -0.76, 0.59, 0]).map((x, i) => x + [10, 2, 0][i % 3]), elements: [8, 1, 1], count: 3 };
    const before = view([0, 0, 0], 3.5, 12);
    const after: MorphView = {
      eye: [14, 2.3, 0],
      right: [0, 0, -1],
      up: [0, 1, 0],
      back: [1, 0, 0],
      perspective: true,
      center: [10, 2.3, 0],
      radius: 0.96,
    };
    const plan = planMorph({ ...c60, view: before }, { ...water, view: after })!;
    expect(plan.report.vanished).toBe(57);
    const s = starts(plan, 3);
    const project = (v: MorphView, p: number[]) => {
      const d = [p[0] - v.eye[0], p[1] - v.eye[1], p[2] - v.eye[2]];
      const z = -(d[0] * v.back[0] + d[1] * v.back[1] + d[2] * v.back[2]);
      return [(d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / z, (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / z];
    };
    // Each start projects (in the new view) where its partner projected (in the old one).
    const match = (i: number) => {
      const target = project(after, [s[i * 3], s[i * 3 + 1], s[i * 3 + 2]]);
      let best = Infinity;
      for (let j = 0; j < 60; j += 1) {
        const source = project(before, [c60.positions[j * 3], c60.positions[j * 3 + 1], c60.positions[j * 3 + 2]]);
        best = Math.min(best, Math.hypot(source[0] - target[0], source[1] - target[1]));
      }
      return best;
    };
    for (let i = 0; i < 3; i += 1) expect(match(i)).toBeLessThan(1e-6);
  });

  it('staggers from the centre out, within the tuned delay', () => {
    const c60 = shell(60, 3.5);
    const caffeine = cluster();
    const plan = planMorph({ ...c60, view: view([0, 0, 0], 3.5) }, { ...caffeine, view: view([0, 0, 0], 3) })!;
    let max = 0;
    for (let i = 0; i < 24; i += 1) {
      const delay = plan.texels[i * 4 + 3];
      expect(delay).toBeGreaterThanOrEqual(0);
      max = Math.max(max, delay);
    }
    expect(max).toBeCloseTo(MORPH_TUNING.maxDelayS, 6);
    // The innermost atom (index 0, radius 1) leaves before the outermost (index 4, radius 3.4).
    expect(plan.texels[3]).toBeLessThan(plan.texels[4 * 4 + 3]);
  });

  it('is deterministic', () => {
    const a = shell(400, 6);
    const b = shell(700, 9);
    for (let i = 0; i < 700; i += 7) (b.elements as number[])[i] = 8;
    const run = () => planMorph({ ...a, view: view([0, 0, 0], 6) }, { ...b, view: view([0, 0, 0], 9) })!;
    const first = run();
    const second = run();
    expect(Array.from(second.texels)).toEqual(Array.from(first.texels));
    expect(second.report).toEqual(first.report);
    expect(first.report.budded).toBe(300);
  });

  it('matches large molecules on the grid in reasonable time', () => {
    const a = shell(20_000, 40);
    const b = shell(15_000, 30);
    const started = performance.now();
    const plan = planMorph({ ...a, view: view([0, 0, 0], 40) }, { ...b, view: view([0, 0, 0], 30) })!;
    const ms = performance.now() - started;
    expect(plan.report.sameElement).toBe(15_000);
    expect(plan.report.vanished).toBe(5_000);
    expect(ms).toBeLessThan(5_000);
  });

  it('falls back to the centre and radius without a usable depth', () => {
    const c60 = shell(60, 3.5);
    const ortho = { ...view([0, 0, 0], 3.5), perspective: false };
    const plan = planMorph({ ...c60, view: ortho }, { ...c60, view: view([0, 0, 0], 3.5) })!;
    expect(plan.mode).toBe('radius');
    expect(morphFrame(ortho, 'radius').scale).toBeCloseTo(3.5, 9);
    const s = starts(plan, 60);
    for (let i = 0; i < 180; i += 1) expect(Math.abs(s[i] - c60.positions[i])).toBeLessThan(1e-4);
  });
});

describe('shouldMorph', () => {
  const base: MorphGateInput = {
    sceneAllows: true,
    arrivalOff: false,
    machine: false,
    drawingHandOff: false,
    savedView: false,
    previous: { natoms: 60, resident: true, sameFile: false },
    natoms: 24,
  };

  it('morphs an in-viewer switch', () => {
    expect(shouldMorph(base)).toBe(true);
  });

  it('never morphs a first open, a large or partial molecule, machine traffic or a hand-off', () => {
    const excluded: Array<Partial<MorphGateInput>> = [
      { previous: null },
      { previous: { natoms: 60, resident: true, sameFile: true } },
      { previous: { natoms: 60, resident: false, sameFile: false } },
      { previous: { natoms: 20_001, resident: true, sameFile: false } },
      { natoms: 20_001 },
      { natoms: 0 },
      { sceneAllows: false },
      { arrivalOff: true },
      { machine: true },
      { drawingHandOff: true },
      { savedView: true },
    ];
    for (const patch of excluded) expect(shouldMorph({ ...base, ...patch })).toBe(false);
  });
});
