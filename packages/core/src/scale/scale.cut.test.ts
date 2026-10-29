// The cut's guarantees (scale-spec §9.8) and the frames it stands on (§8):
// budgets hold for any camera, cost follows the footprint and not the count,
// regions are covered exactly once, errors are monotone, hysteresis holds,
// a wrap changes nothing on screen, and the eye-relative error stays sub-pixel.
import { describe, expect, it } from 'vitest';
import {
  buildCut,
  childEpsilon,
  iPhone15ProBudgets,
  stepIndex,
  TAU_MIN,
  TauController,
  type Budgets,
  type Cut,
  type DrawItem,
  type ViewState,
} from './cut';
import {
  add3,
  anchorView,
  applyRigid,
  applySim,
  ascend,
  bodyView,
  childSteps,
  descend,
  Geometries,
  IDENTITY3,
  IDENTITY_RIGID,
  IDENTITY_SIM,
  invertSim,
  len3,
  magnification,
  phi,
  rebase,
  composeSim,
  scale3,
  stepPlacement,
  sub3,
  childToward,
  type BodyFrame,
  type Geometry,
  type Mat3,
  type Similarity,
  type Vec3,
} from './frames';
import {
  bakePartition,
  canonicalPath,
  encodeRecord,
  levelsAlong,
  MemoryStore,
  nodeId,
  Resolver,
  unitExponent,
  type AxisRuns,
  type CrystalNode,
  type Step,
  type Vec3n,
  type View,
} from './index';

const VIEW: ViewState = {
  cameraFromWorld: IDENTITY_RIGID, fovY: (60 * Math.PI) / 180, viewportHeight: 2556, aspect: 1179 / 2556, zNear: 0.05, zFar: 20,
};
const BUDGETS = iPhone15ProBudgets('fair');
// LUPI_SCALE_HEAVY=1 runs more random trials and benchmark frames.
const HEAVY = process.env.LUPI_SCALE_HEAVY === '1';

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SALT: CrystalNode = { kind: 'crystal', structure: 5, termination: 0, a: 11, b: 17, quarter: 92409, cells: [5n, 5n, 5n], capZ: 0, capOffset: 0 };
const saltRec = encodeRecord(SALT);
const A5 = 5n * 4n * 92409n;
const SALT_PERIODS: [Vec3n, Vec3n, Vec3n] = [[A5, 0n, 0n], [0n, A5, 0n], [0n, 0n, A5]];
const GOOGOLPLEX_L = 10n ** 100n - 3n;

function saltRung(levels: bigint, substitution = true) {
  const rec = encodeRecord({
    kind: 'tower', seed: nodeId(saltRec), factor: 10, periods: SALT_PERIODS, levels,
    ...(substitution ? { substitution: { fromZ: 17, toZ: 35, perCopy: 1 } } : {}),
  });
  return { rec, resolver: new Resolver(new MemoryStore([saltRec, rec])) };
}

/** A frame whose world origin is the camera, which sits at `eye` in anchor units and looks along `r`'s −z. */
function frameAt(resolver: Resolver, root: Uint8Array, anchorPath: Step[], sigma: number, eye: Vec3, r: Mat3 = IDENTITY3): BodyFrame {
  const rotated = [0, 1, 2].map((i) => r[3 * i] * eye[0] * sigma + r[3 * i + 1] * eye[1] * sigma + r[3 * i + 2] * eye[2] * sigma) as Vec3;
  return { root, path: [], anchorPath, worldFromAnchor: { r, t: scale3(rotated, -1) }, metresPerAnchorUnit: sigma, resolver };
}

/** A toy at desk distance: the body's longest span `span` metres, its centre `distance` in front of the camera. */
function deskFrame(resolver: Resolver, root: Uint8Array, span = 0.15, distance = 0.5): BodyFrame {
  const g = new Geometries(resolver).of(resolver.root(root));
  const sigma = span / Math.max(...[0, 1, 2].map((a) => g.max[a] - g.min[a]));
  return { root, path: [], anchorPath: [], worldFromAnchor: { r: IDENTITY3, t: sub3([0, 0, -distance], scale3(g.centre, sigma)) }, metresPerAnchorUnit: sigma, resolver };
}

function frames(bodies: BodyFrame[], view: ViewState, budgets: Budgets, n = 6): Cut {
  let cut = buildCut(bodies, view, budgets);
  for (let i = 1; i < n; i += 1) cut = buildCut(bodies, view, budgets, cut);
  return cut;
}

/** The anchor path to level k of a tower whose digits sit `pattern` on each axis (first digit, then the rest). */
function anchorPathTo(L: bigint, k: bigint, digit: (axis: number, index: bigint, count: bigint) => number): Step[] {
  if (k === L) return [];
  const runs = [0, 1, 2].map((a) => {
    const n = levelsAlong(a, L) - levelsAlong(a, k);
    const out: Array<{ digit: number; length: bigint }> = [];
    // Two runs at most per axis: the first digit, then a constant tail.
    if (n >= 1n) out.push({ digit: digit(a, 0n, n), length: 1n });
    if (n >= 2n) {
      const d = digit(a, 1n, n);
      if (out[0].digit === d) out[0].length += n - 1n;
      else out.push({ digit: d, length: n - 1n });
    }
    return out;
  }) as AxisRuns;
  return [{ tag: 'tower', levels: L - k, runs }];
}

/** An item as a box in camera space (metres), rounded, for comparing cuts. */
function eyeBox(frame: BodyFrame, item: DrawItem): string {
  const toEye = (x: Vec3) => applyRigid(VIEW.cameraFromWorld, applyRigid(frame.worldFromAnchor, scale3(applySim(item.anchorFromItem, x), frame.metresPerAnchorUnit)));
  const lo = toEye(item.extras.min ?? item.centre);
  const hi = toEye(item.extras.max ?? item.centre);
  const round = (v: number) => v.toFixed(7);
  return `${item.kind}:${lo.map(round)}:${hi.map(round)}:${item.extras.atoms ?? ''}`;
}

function usageOf(cut: Cut) {
  let boxes = 0;
  let atoms = 0;
  for (const i of cut.items) {
    if (i.kind === 'box') boxes += 1;
    if (i.kind === 'splats') boxes += i.extras.splats?.length ?? 1;
    if (i.kind === 'atomInstances') atoms += i.extras.atoms ?? 0;
  }
  return { items: cut.items.length, boxes, atoms };
}

describe('§9.8.1 budgets', () => {
  // Inherently heavy: 144 cuts at the device budgets, thousands of visits each for the deep salt,
  // the copper and the baked roots, about 3 s of CPU on its own. Hence its own timeout.
  it('no budget is exceeded and no frame makes more than items + visits pops, over random roots and cameras', () => {
    const rand = prng(981);
    const roots: Array<{ resolver: Resolver; root: Uint8Array }> = [];
    for (const L of [0n, 3n, 6n, 27n, 97n, GOOGOLPLEX_L]) {
      const { rec, resolver } = saltRung(L);
      roots.push({ resolver, root: nodeId(rec) });
    }
    const cu = encodeRecord({ kind: 'crystal', structure: 3, termination: 1, a: 29, b: 0, quarter: 59228, cells: [630n, 630n, 630n], capZ: 0, capOffset: 0 });
    roots.push({ resolver: new Resolver(new MemoryStore([cu])), root: nodeId(cu) });
    const n = 6000;
    const positions = Float32Array.from({ length: 3 * n }, () => rand() * 60);
    const baked = bakePartition(new Uint8Array(n).fill(6), positions);
    roots.push({ resolver: new Resolver(new MemoryStore(baked.records)), root: baked.root });
    const small: Budgets = { ...BUDGETS, visits: 300, items: 200, instancedAtoms: 2000, boxesAndSplats: 150 };
    for (const budgets of [BUDGETS, small]) {
      for (const { resolver, root } of roots) {
        for (let trial = 0; trial < (HEAVY ? 12 : 3); trial += 1) {
          const span = 0.05 + rand() * 3;
          const frame = deskFrame(resolver, root, span, 0.1 + rand() * 1.5);
          frame.worldFromAnchor.t = add3(frame.worldFromAnchor.t, [(rand() - 0.5) * span, (rand() - 0.5) * span, 0]);
          const cut = frames([frame], { ...VIEW, bubble: 0.35 }, budgets, 3);
          const u = usageOf(cut);
          expect(u.items).toBeLessThanOrEqual(budgets.items);
          expect(u.boxes).toBeLessThanOrEqual(budgets.boxesAndSplats);
          expect(u.atoms).toBeLessThanOrEqual(budgets.instancedAtoms);
          expect(cut.pops).toBeLessThanOrEqual(budgets.items + budgets.visits);
          expect(cut.visited).toBeLessThanOrEqual(budgets.visits);
          expect([u.items, u.boxes, u.atoms]).toEqual([cut.used.items, cut.used.boxesAndSplats, cut.used.instancedAtoms]);
        }
      }
    }
  }, HEAVY ? 240_000 : 60_000);
});

describe('§9.3 τ controllers', () => {
  const quiet = { overBudget: false, used: { items: 10, boxesAndSplats: 10, instancedAtoms: 10 }, visited: 10 };
  const period = 1 / 60;

  it('an overBudget cut raises τ for the next frame by 1.25, up to 8', () => {
    const c = new TauController(TAU_MIN.fair, 1.5);
    expect(c.frame(0, period, { ...quiet, overBudget: true }, BUDGETS)).toBeCloseTo(1.875, 12);
    for (let i = 1; i < 40; i += 1) c.frame(i * period, period, { ...quiet, overBudget: true }, BUDGETS);
    expect(c.tau).toBe(8);
  });

  it('0.5 s with every budget under 80 % lowers it by 0.9 per window, down to the thermal minimum', () => {
    const c = new TauController(TAU_MIN.fair, 2);
    let i = 0;
    for (; i <= 30; i += 1) c.frame(i / 60, period, quiet, BUDGETS);
    expect(c.controllers.budget).toBeCloseTo(1.8, 12);
    expect(c.tau).toBe(2); // the frame-time controller waits 2 s
    const busy = { ...quiet, visited: 0.9 * BUDGETS.visits };
    for (const end = i + 60; i < end; i += 1) c.frame(i / 60, period, busy, BUDGETS);
    expect(c.controllers.budget).toBeCloseTo(1.8, 12);
    for (const end = i + 2000; i < end; i += 1) c.frame(i / 60, period, quiet, BUDGETS);
    expect(c.tau).toBe(TAU_MIN.fair);
  });

  it('a dropped frame raises the frame-time controller at the end of its window; 2 s without one lowers it', () => {
    const c = new TauController(TAU_MIN.fair, 1.5);
    const full = { ...quiet, visited: BUDGETS.visits }; // hold the budget controller still
    c.frame(0, period, full, BUDGETS);
    c.frame(3 / 60, period, full, BUDGETS); // a drop
    c.frame(0.5, period, full, BUDGETS);
    expect(c.tau).toBeCloseTo(1.875, 12);
    for (let i = 31; i < 140; i += 1) c.frame(i / 60, period, full, BUDGETS);
    expect(c.tau).toBeCloseTo(1.875, 12);
    for (let i = 140; i < 170; i += 1) c.frame(i / 60, period, full, BUDGETS); // the window ending at 2.5 s
    expect(c.tau).toBeCloseTo(1.875 * 0.95, 12);
    // τ is the larger controller, and a thermal floor lifts both.
    c.setMinimum(TAU_MIN.critical);
    expect(c.tau).toBe(2);
    expect(c.gpuTime(16)).toBeCloseTo(2 * Math.exp(0.5), 12);
  });
});

describe('§9.8.2 same footprint, same cost', () => {
  it('the 10⁹, 10¹⁰⁰ and googolplex rungs at the same desk footprint visit and emit within ±10 %', () => {
    const results = [6n, 97n, GOOGOLPLEX_L].map((L) => {
      const { rec, resolver } = saltRung(L);
      const cut = frames([deskFrame(resolver, nodeId(rec), 0.15, 0.4)], VIEW, BUDGETS);
      return [cut.visited, cut.items.length];
    });
    for (const [visited, items] of results) {
      expect(Math.abs(visited - results[0][0])).toBeLessThanOrEqual(Math.ceil(results[0][0] * 0.1));
      expect(Math.abs(items - results[0][1])).toBeLessThanOrEqual(Math.ceil(results[0][1] * 0.1));
    }
  });

  it('inside views at the same atom pixel size draw the identical cut for every rung deep enough', () => {
    const k = 6n;
    const sigma = (0.02 / 2.82) * 10 ** Number(unitExponent(k));
    const cuts = [9n, 27n, 97n, GOOGOLPLEX_L].map((L) => {
      const { rec, resolver } = saltRung(L);
      const anchorPath = anchorPathTo(L, k, (_a, i) => (i === 0n ? 5 : 0));
      const g = new Geometries(resolver).of(resolver.resolve(nodeId(rec), anchorPath));
      const frame = frameAt(resolver, nodeId(rec), anchorPath, sigma, add3(g.centre, [0.37 / sigma, 0.21 / sigma, 0.13 / sigma]));
      const cut = frames([frame], { ...VIEW, bubble: 0.35 }, BUDGETS, 8);
      return { visited: cut.visited, items: cut.items.map((i) => eyeBox(frame, i)).sort() };
    });
    for (const c of cuts) expect(c).toEqual(cuts[0]);
    expect(cuts[0].items.length).toBeGreaterThan(10);
  });
});

/** Every point must lie in exactly one emitted region, or in a region skipped as enclosed. */
/**
 * With `body`, the points are drawn from the body's box and only those in the frustum are checked.
 * Points in a `removed` box must be drawn by nothing.
 */
function coverage(frame: BodyFrame, cut: Cut, root: View, rand: () => number, samples = 400, body?: Geometry, removed: Array<{ min: Vec3; max: Vec3 }> = []) {
  const g = new Geometries(frame.resolver);
  const sigma = frame.metresPerAnchorUnit;
  // Each region's inverse is taken once here, not once per sample: a cut holds thousands of regions.
  const regions = [
    ...cut.items.filter((i) => i.kind !== 'facePlane').map((i) => ({ sim: i.anchorFromItem, min: i.extras.min, max: i.extras.max, atoms: i.extras.atoms !== undefined })),
    ...(cut.skipped ?? []).filter((s) => s.why === 'enclosed').map((s) => ({ sim: s.anchorFromNode, min: s.min, max: s.max, atoms: false })),
  ].flatMap((r) => (r.min && r.max ? [{ fromAnchor: invertSim(r.sim), min: r.min, max: r.max, atoms: r.atoms }] : []));
  const rootGeometry = g.of(root);
  void rootGeometry;
  let checked = 0;
  let doubled = 0;
  let missing = 0;
  let drawnRemoved = 0;
  const camFromAnchor = (x: Vec3) => applyRigid(frame.worldFromAnchor, scale3(x, sigma));
  const anchorFromCam = (c: Vec3): Vec3 => {
    const w = frame.worldFromAnchor;
    const d = sub3(c, w.t);
    return scale3([w.r[0] * d[0] + w.r[3] * d[1] + w.r[6] * d[2], w.r[1] * d[0] + w.r[4] * d[1] + w.r[7] * d[2], w.r[2] * d[0] + w.r[5] * d[1] + w.r[8] * d[2]], 1 / sigma);
  };
  for (let n = 0; n < samples; n += 1) {
    let p: Vec3;
    if (body) {
      p = [0, 1, 2].map((a) => body.min[a] + rand() * (body.max[a] - body.min[a])) as Vec3;
      const c = camFromAnchor(p);
      const tan = Math.tan(VIEW.fovY / 2);
      if (c[2] > -VIEW.zNear || Math.abs(c[1]) > -c[2] * tan || Math.abs(c[0]) > -c[2] * tan * (VIEW.aspect ?? 1)) continue;
    } else {
      // A point in the frustum, up to 6 m away.
      const depth = 0.1 + rand() * 6;
      const x = (rand() * 2 - 1) * Math.tan(VIEW.fovY / 2) * (VIEW.aspect ?? 1) * depth * 0.95;
      const y = (rand() * 2 - 1) * Math.tan(VIEW.fovY / 2) * depth * 0.95;
      p = anchorFromCam([x, y, -depth]);
    }
    let hits = 0;
    let boxHits = 0;
    for (const r of regions) {
      const local = applySim(r.fromAnchor, p);
      if ([0, 1, 2].every((a) => local[a] >= r.min[a] - 1e-9 && local[a] < r.max[a] + 1e-9)) {
        hits += 1;
        if (!r.atoms) boxHits += 1;
      }
    }
    // An atoms item spans its whole box; its atoms leave the removed ones out (checked by the caller).
    if (removed.some((b) => [0, 1, 2].every((a) => p[a] > b.min[a] && p[a] < b.max[a]))) {
      if (boxHits > 0) drawnRemoved += 1;
      continue;
    }
    checked += 1;
    if (hits > 1) doubled += 1;
    if (hits === 0) missing += 1;
  }
  return { checked, doubled, missing, drawnRemoved };
}

describe('§9.8.3 coverage', () => {
  const rand = prng(983);
  /** A solid tower of one rock-salt cell per copy. */
  function cellTower(f: number, levels: bigint) {
    const cell: CrystalNode = { kind: 'crystal', structure: 5, termination: 0, a: 11, b: 17, quarter: 92409, cells: [1n, 1n, 1n], capZ: 0, capOffset: 0 };
    const cellRec = encodeRecord(cell);
    const p = 4n * 92409n;
    const rec = encodeRecord({ kind: 'tower', seed: nodeId(cellRec), factor: f, periods: [[p, 0n, 0n], [0n, p, 0n], [0n, 0n, p]], levels });
    return { rec, resolver: new Resolver(new MemoryStore([cellRec, rec])) };
  }
  for (const f of [2, 10, 16]) {
    const L = f === 2 ? 30n : f === 10 ? 12n : 10n;
    // Anchors of the three level shapes: (f,1,1), (f,f,1), (f,f,f).
    for (const shapeLevel of [1n, 2n, 3n]) {
      it(`f = ${f}: the camera inside an anchor of shape ${['(f,1,1)', '(f,f,1)', '(f,f,f)'][Number(shapeLevel) - 1]} sees every region exactly once`, () => {
        const { rec, resolver } = cellTower(f, L);
        const k = (f === 2 ? 15n : 6n) + shapeLevel - 1n;
        const anchorPath = anchorPathTo(L, k, (_a, i, n) => (i === 0n && n > 1n ? 1 : Math.floor(f / 2)));
        const anchor = resolver.resolve(nodeId(rec), anchorPath);
        const g = new Geometries(resolver).of(anchor);
        const width = Math.min(...[0, 1, 2].map((a) => g.max[a] - g.min[a]));
        const sigma = 25 / width; // the anchor is 25 m across its narrowest side (§8.4)
        const eye = add3(g.centre, [0.31 / sigma, -0.17 / sigma, 0.11 / sigma]);
        const frame = frameAt(resolver, nodeId(rec), anchorPath, sigma, eye);
        const budgets = { ...BUDGETS, items: 1e6, boxesAndSplats: 1e6, instancedAtoms: 1e7, visits: 1e6 };
        const cut = frames([frame], { ...VIEW, bubble: 0.35 }, budgets, 4);
        const last = buildCut([frame], { ...VIEW, bubble: 0.35 }, budgets, cut, { debug: true });
        const c = coverage(frame, last, anchor, rand);
        expect([c.doubled, c.missing]).toEqual([0, 0]);
        expect(last.overBudget).toBe(false);
      });
    }
  }

  it('an anchor inside a group starts from the group\'s other children too: a 2 × 2 slab of copper is covered once', () => {
    const cu = encodeRecord({ kind: 'crystal', structure: 3, termination: 0, a: 29, b: 0, quarter: 59228, cells: [40n, 40n, 40n], capZ: 0, capOffset: 0 });
    const w = (4 * 40 * 59228) / 65536;
    const slab = encodeRecord({
      kind: 'group',
      children: [[0, 0], [w, 0], [0, w], [w, w]].map(([x, y]) => ({ id: nodeId(cu), rotation: [0, 0, 0, 1] as [number, number, number, number], translation: [x, y, 0] as [number, number, number] })),
    });
    const resolver = new Resolver(new MemoryStore([cu, slab]));
    // The anchor: a 10³-cell box of child 0, at its +x face; the camera inside it, looking +x.
    const anchorPath: Step[] = [{ tag: 'child', index: 0 }, { tag: 'cells', octants: [3, 5] }];
    const anchor = resolver.resolve(nodeId(slab), anchorPath);
    const g = new Geometries(resolver).of(anchor);
    const sigma = 0.1 / ((4 * 59228) / 65536); // a cell is 10 cm
    const eye: Vec3 = [g.max[0] - 0.3 / sigma, g.centre[1], g.centre[2]];
    const turn: Mat3 = [0, 0, -1, 0, 1, 0, 1, 0, 0];
    const frame = frameAt(resolver, nodeId(slab), anchorPath, sigma, eye, turn);
    const budgets = { ...BUDGETS, items: 1e6, boxesAndSplats: 1e6, instancedAtoms: 1e7, visits: 1e6 };
    const view = { ...VIEW, bubble: 0.35 };
    const cut = buildCut([frame], view, budgets, frames([frame], view, budgets, 3), { debug: true });
    const box = new Geometries(resolver).of(resolver.root(nodeId(slab)));
    // The slab's box in the anchor's units: the anchor is child 0's box at offset lo × cell.
    const offset = anchor.type === 'box' ? anchor.box.lo.map((x) => Number(x) * ((4 * 59228) / 65536)) : [0, 0, 0];
    const inAnchor = { ...box, min: sub3(box.min, offset as Vec3), max: sub3(box.max, offset as Vec3) };
    const c = coverage(frame, cut, anchor, rand, 3000, inAnchor);
    expect([c.doubled, c.missing]).toEqual([0, 0]);
    expect(c.checked).toBeGreaterThan(100);
    // Child 1 lies ahead of the camera; without the group's other children it would be a hole.
    expect(cut.items.some((i) => i.path[0]?.tag === 'child' && i.path[0].index === 1)).toBe(true);
  });

  it('an edited copper box draws none of what it removed and the rest exactly once', () => {
    const cu = encodeRecord({ kind: 'crystal', structure: 3, termination: 0, a: 29, b: 0, quarter: 59228, cells: [40n, 40n, 40n], capZ: 0, capOffset: 0 });
    const removed: Step[][] = [[{ tag: 'cells', octants: [0, 7] }], [{ tag: 'cells', octants: [3, 5, 6] }], [{ tag: 'cells', octants: [7] }]];
    const edit = encodeRecord({ kind: 'edit', base: nodeId(cu), removed });
    const resolver = new Resolver(new MemoryStore([cu, edit]));
    const bare = resolver.root(nodeId(cu));
    const cell = (4 * 59228) / 65536;
    const boxes = removed.map((path) => {
      const v = resolver.walk(bare, path);
      if (v.type !== 'box') throw new Error('box expected');
      return { min: v.box.lo.map((x) => Number(x) * cell) as Vec3, max: v.box.hi.map((x) => Number(x) * cell) as Vec3 };
    });
    const root = resolver.root(nodeId(edit));
    const g = new Geometries(resolver).of(root);
    for (const [span, distance] of [[0.4, 0.6], [0.4, 0.35]]) {
      const frame = deskFrame(resolver, nodeId(edit), span, distance);
      // From +z: octant 7's hole faces the camera; the other two removals are cavities inside.
      const budgets = { ...BUDGETS, items: 1e6, boxesAndSplats: 1e6, instancedAtoms: 1e7, visits: 1e6, materializations: 1e6 };
      const cut = buildCut([frame], VIEW, budgets, frames([frame], VIEW, budgets, 3), { debug: true });
      const c = coverage(frame, cut, root, rand, 1500, g, boxes);
      expect([c.doubled, c.missing, c.drawnRemoved]).toEqual([0, 0, 0]);
      expect(c.checked).toBeGreaterThan(300);
      expect(cut.overBudget).toBe(false);
      // No atom drawn lies in a removed box. Counted, then asserted once: an expect per atom
      // (tens of thousands) cost most of this test's time.
      let atoms = 0;
      let atomsInRemoved = 0;
      for (const item of cut.items.filter((i) => i.extras.atoms !== undefined)) {
        const leaf = resolver.materialize(resolver.resolve(nodeId(edit), item.path));
        const indices = item.extras.atomIndices ?? Array.from(leaf.z, (_z, i) => i);
        for (const i of indices) {
          const x = applySim(item.anchorFromItem, [leaf.positions[3 * i], leaf.positions[3 * i + 1], leaf.positions[3 * i + 2]]);
          if (boxes.some((b) => [0, 1, 2].every((a) => x[a] > b.min[a] && x[a] < b.max[a]))) atomsInRemoved += 1;
          atoms += 1;
        }
      }
      expect(atomsInRemoved).toBe(0);
      expect(atoms).toBeGreaterThan(0);
    }
  });

  // Inherently heavy: 24 cuts of a 45-level tower refining up to the item budget as the camera
  // closes in, about 3.5 s of CPU on its own. Hence its own timeout.
  it('a water grown by Grow ×2 is drawn exactly once as the camera approaches, monotone and within budgets (scale-spec §9.2: not gradual)', () => {
    // §9.8.3's "at most twice the items per halving" cannot hold here: a non-solid level's ε is the
    // same at every level (§9.2), so every copy within ε·σ·K/τ of the eye refines at once.
    const water = encodeRecord({ kind: 'leaf', z: Uint8Array.from([8, 1, 1]), positions: Float32Array.from([0, 0, 0, 0.2774, 0.8929, 0.2544, 0.6068, -0.2383, -0.7169]) });
    const grown = encodeRecord({ kind: 'tower', seed: nodeId(water), factor: 2, periods: [[190501n, 0n, 0n], [0n, 224869n, 0n], [0n, 0n, 214389n]], levels: 45n });
    const resolver = new Resolver(new MemoryStore([water, grown]));
    const g = new Geometries(resolver).of(resolver.root(nodeId(grown)));
    const sigma = 3 / Math.max(...[0, 1, 2].map((a) => g.max[a] - g.min[a]));
    const counts: number[] = [];
    for (let d = 1.6; d > 0.03; d /= 2) {
      const eye: Vec3 = [g.centre[0], g.centre[1], g.max[2] + d / sigma];
      const frame = frameAt(resolver, nodeId(grown), [], sigma, eye);
      const budgets = { ...BUDGETS, materializations: 1e6 };
      const cut = buildCut([frame], VIEW, budgets, frames([frame], VIEW, budgets, 3), { debug: true });
      expect(cut.items.length).toBeLessThanOrEqual(BUDGETS.items);
      // The part of the body in view is drawn exactly once, before and after the ball refines.
      const c = coverage(frame, cut, resolver.root(nodeId(grown)), rand, 300, g);
      expect([c.doubled, c.missing]).toEqual([0, 0]);
      expect(c.checked).toBeGreaterThan(20);
      counts.push(cut.items.length);
    }
    for (let i = 1; i < counts.length; i += 1) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    // Outside that ball (ε·σ·K/τ ≈ 0.2 m here) the block stays a handful of boxes.
    expect(counts.slice(0, 3).every((c) => c <= 8)).toBe(true);
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0]);
  }, 60_000);
});

describe('§9.8.4 monotone error', () => {
  it('ε(parent) ≥ every child ε, in the parent units, for every view a walk generates', () => {
    const rand = prng(984);
    const cases: Array<{ resolver: Resolver; root: Uint8Array }> = [];
    const { rec, resolver } = saltRung(9n);
    cases.push({ resolver, root: nodeId(rec) });
    const water = encodeRecord({ kind: 'leaf', z: Uint8Array.from([8, 1, 1]), positions: Float32Array.from([0, 0, 0, 0.2774, 0.8929, 0.2544, 0.6068, -0.2383, -0.7169]) });
    const grown = encodeRecord({ kind: 'tower', seed: nodeId(water), factor: 2, periods: [[190501n, 0n, 0n], [0n, 224869n, 0n], [0n, 0n, 214389n]], levels: 12n });
    cases.push({ resolver: new Resolver(new MemoryStore([water, grown])), root: nodeId(grown) });
    const cu = encodeRecord({ kind: 'crystal', structure: 3, termination: 1, a: 29, b: 0, quarter: 59228, cells: [40n, 30n, 20n], capZ: 0, capOffset: 0 });
    cases.push({ resolver: new Resolver(new MemoryStore([cu])), root: nodeId(cu) });
    const n = 20000;
    const baked = bakePartition(new Uint8Array(n).fill(6), Float32Array.from({ length: 3 * n }, () => rand() * 80));
    cases.push({ resolver: new Resolver(new MemoryStore(baked.records)), root: baked.root });
    let checked = 0;
    const larger: Array<[number, number]> = [];
    for (const { resolver, root } of cases) {
      const ctx = { resolver, geometries: new Geometries(resolver) };
      for (let walk = 0; walk < 6; walk += 1) {
        let v: View = resolver.root(root);
        for (let depth = 0; depth < 40; depth += 1) {
          const kids = childSteps(v);
          if (kids.length === 0) break;
          const parentEpsilon = childEpsilon(ctx, v);
          for (const c of kids) {
            const w = resolver.step(v, c.step);
            const child = childEpsilon(ctx, w) * c.placement.s * (1 - 1e-12);
            if (!(parentEpsilon >= child)) larger.push([parentEpsilon, child]);
            checked += 1;
          }
          v = resolver.step(v, kids[Math.floor(rand() * kids.length)].step);
        }
      }
    }
    expect(larger).toEqual([]);
    expect(checked).toBeGreaterThan(100);
  });
});

describe('§9.8.5 hysteresis', () => {
  it('with ρ unchanged, no item flips between consecutive frames', () => {
    const { rec, resolver } = saltRung(6n);
    const frame = deskFrame(resolver, nodeId(rec), 0.6, 0.35);
    let cut = buildCut([frame], VIEW, BUDGETS);
    const history: string[][] = [];
    const budgets = { ...BUDGETS, materializations: 1e6 };
    for (let i = 0; i < 6; i += 1) {
      cut = buildCut([frame], VIEW, budgets, cut);
      history.push([...cut.refined].sort());
    }
    for (let i = 2; i < history.length; i += 1) expect(history[i]).toEqual(history[i - 1]);
  });
  it('a node refined last frame stays refined while ρ ≥ τ/2, and coarsens below it', () => {
    const { rec, resolver } = saltRung(3n);
    const near = deskFrame(resolver, nodeId(rec), 0.15, 0.3);
    const refinedNear = buildCut([near], VIEW, BUDGETS);
    expect(refinedNear.refined.size).toBeGreaterThan(0);
    const key = [...refinedNear.refined][0];
    // Find a distance where the root's ρ sits between τ/2 and τ: refined only with history.
    let found = false;
    for (let d = 0.3; d < 50 && !found; d *= 1.15) {
      const frame = deskFrame(resolver, nodeId(rec), 0.15, d);
      const fresh = buildCut([frame], VIEW, BUDGETS);
      const held = buildCut([frame], VIEW, BUDGETS, refinedNear);
      if (!fresh.refined.has(key) && held.refined.has(key)) found = true;
    }
    expect(found).toBe(true);
  });
});

describe('§9.8.6 flight: a wrap changes no item', () => {
  it('moving the anchor down a whole period (3 levels) with the same worldFromAnchor and σ draws the same eye-space boxes', () => {
    const { rec, resolver } = saltRung(GOOGOLPLEX_L);
    const root = nodeId(rec);
    // A dive into the low-x face: x digits at the face (0), y and z through the middle (⌊f/2⌋ = 5).
    const digit = (a: number) => (a === 0 ? 0 : 5);
    for (const k of [300n, 120n]) {
      const before = anchorPathTo(GOOGOLPLEX_L, k, digit);
      const after = anchorPathTo(GOOGOLPLEX_L, k - 3n, digit);
      const g = new Geometries(resolver);
      const anchorBefore = resolver.resolve(root, before);
      const geometry = g.of(anchorBefore);
      const sigma = 30 / Math.min(...[0, 1, 2].map((a) => geometry.max[a] - geometry.min[a]));
      // The camera 2 m outside the low-x face, looking +x.
      const turn: Mat3 = [0, 0, -1, 0, 1, 0, 1, 0, 0];
      const eye: Vec3 = [-2 / sigma, geometry.centre[1], geometry.centre[2]];
      const a = frameAt(resolver, root, before, sigma, eye, turn);
      const b = frameAt(resolver, root, after, sigma, eye, turn);
      const ca = frames([a], VIEW, BUDGETS, 3);
      const cb = frames([b], VIEW, BUDGETS, 3);
      expect(cb.items.map((i) => eyeBox(b, i)).sort()).toEqual(ca.items.map((i) => eyeBox(a, i)).sort());
      expect(ca.items.length).toBeGreaterThan(1);
    }
  });
});

describe('§9.8.7 cost', () => {
  it('a buildCut of 8,192 visits stays bounded (the 4 ms device bound is the Swift release benchmark)', () => {
    const cu = encodeRecord({ kind: 'crystal', structure: 3, termination: 0, a: 29, b: 0, quarter: 59228, cells: [4000n, 4000n, 4000n], capZ: 0, capOffset: 0 });
    const resolver = new Resolver(new MemoryStore([cu]));
    const g = new Geometries(resolver).of(resolver.root(nodeId(cu)));
    const sigma = 2 / (g.max[0] - g.min[0]);
    const frame: BodyFrame = {
      root: nodeId(cu), path: [], anchorPath: [], resolver, metresPerAnchorUnit: sigma,
      worldFromAnchor: { r: IDENTITY3, t: sub3([0.2, 0.1, -0.3], scale3([g.centre[0], g.centre[1], g.max[2]], sigma)) },
    };
    // A 4,000³ box, so the octree has more than 8,192 visible nodes; no
    // materializations: the benchmark times the traversal, which §9.8.7 bounds.
    const budgets = { ...BUDGETS, tau: 0.02, items: 1e6, boxesAndSplats: 1e6, instancedAtoms: 1e7, materializations: 0 };
    let cut = frames([frame], VIEW, budgets, 2);
    const t0 = performance.now();
    const runs = HEAVY ? 20 : 5;
    for (let i = 0; i < runs; i += 1) cut = buildCut([frame], VIEW, budgets, cut);
    const ms = (performance.now() - t0) / runs;
    expect(cut.visited).toBe(8192);
    console.info(`buildCut at 8,192 visits: ${ms.toFixed(1)} ms per frame`);
    expect(ms).toBeLessThan(Number(process.env.LUPI_CUT_MS ?? 400));
  }, 60000);
});

describe('§9.4, §9.5 exposed atoms and the neighbourhood', () => {
  it('a seed copy at a corner of a salt cube draws 488 of its ions, one in a face 200, and an enclosed one is skipped', () => {
    const { rec, resolver } = saltRung(3n);
    const cut = frames([deskFrame(resolver, nodeId(rec), 0.4, 1.2)], VIEW, { ...BUDGETS, instancedAtoms: 1e7, items: 1e5, visits: 1e5, materializations: 1e6 }, 4);
    const counts = new Set(cut.items.filter((i) => i.kind === 'atomInstances').map((i) => i.extras.atoms));
    expect(counts.has(488)).toBe(true);
    expect(counts.has(200)).toBe(true);
    expect(counts.has(1000)).toBe(false);
  });
  it('±1 on digit runs carries and borrows through runs in O(runs)', () => {
    const runs = [{ digit: 4, length: 1n }, { digit: 9, length: 10n ** 100n }];
    expect(stepIndex(runs, 10, 1)).toEqual([{ digit: 5, length: 1n }, { digit: 0, length: 10n ** 100n }]);
    expect(stepIndex([{ digit: 5, length: 1n }, { digit: 0, length: 10n ** 100n }], 10, -1)).toEqual(runs);
    expect([stepIndex([{ digit: 9, length: 5n }], 10, 1), stepIndex([{ digit: 0, length: 5n }], 10, -1)]).toEqual([null, null]);
  });
});

describe('§8 frames', () => {
  it('rebasing is a change of representation: a node point keeps its world position across descents and ascents', () => {
    const { rec, resolver } = saltRung(27n);
    const root = nodeId(rec);
    const g = new Geometries(resolver);
    const rootGeometry = g.of(resolver.root(root));
    const sigma = 5000 / (rootGeometry.max[0] - rootGeometry.min[0]);
    let frame: BodyFrame = frameAt(resolver, root, [], sigma, rootGeometry.centre);
    const marker = applySim({ s: 1, r: IDENTITY3, t: [0, 0, 0] }, [1.25, 2.5, 3.75]);
    const world = (f: BodyFrame, anchorFromRoot: (x: Vec3) => Vec3) => applyRigid(f.worldFromAnchor, scale3(anchorFromRoot(marker), f.metresPerAnchorUnit));
    const before = world(frame, (x) => x);
    // Descend toward the camera (the world origin) until the anchor is under 40 m wide.
    let depth = 0;
    for (let i = 0; i < 40; i += 1) {
      const next = rebase(frame, [0, 0, 0], g);
      if (next.anchorPath === frame.anchorPath || JSON.stringify(next.anchorPath, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(frame.anchorPath, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) break;
      frame = next;
      depth += 1;
    }
    expect(depth).toBeGreaterThanOrEqual(3);
    const anchor = anchorView(frame);
    expect(g.of(anchor).width * frame.metresPerAnchorUnit).toBeLessThan(40 * 10);
    // Ascend back to the root and compare where the root's origin lands.
    let up = frame;
    while (up.anchorPath.length > 0) up = ascend(up);
    const after = world(up, (x) => x);
    expect(len3(sub3(after, before))).toBeLessThan(1e-9 * len3(before) + 1e-9);
    expect(bodyView(up).type).toBe('level');
  });

  it('a whole step is placed as the composition of its one-level steps', () => {
    const rand = prng(88);
    const { rec, resolver } = saltRung(9n);
    const close = (a: Similarity, b: Similarity) => {
      expect(a.s).toBeCloseTo(b.s, 12);
      for (let i = 0; i < 3; i += 1) expect(a.t[i]).toBeCloseTo(b.t[i], 9);
    };
    for (let trial = 0; trial < 20; trial += 1) {
      const top = resolver.root(nodeId(rec));
      const D = BigInt(1 + Math.floor(rand() * 9));
      // Step by step, choosing random digits, then the same descent as one step.
      let v: View = top;
      let composed: Similarity = IDENTITY_SIM;
      const digits: number[][] = [[], [], []];
      for (let i = 0n; i < D; i += 1n) {
        const kids = childSteps(v);
        const c = kids[Math.floor(rand() * kids.length)];
        if (c.step.tag !== 'tower') throw new Error('tower step expected');
        const axis = c.step.runs.findIndex((r) => r.length > 0);
        digits[axis].push(c.index);
        composed = composeSim(composed, c.placement);
        v = resolver.step(v, c.step);
      }
      const runs = digits.map((d) => d.map((digit) => ({ digit, length: 1n }))) as AxisRuns;
      const whole = stepPlacement(resolver, top, canonicalPath([{ tag: 'tower', levels: D, runs }])[0]);
      close(whole.placement, composed);
    }
    const cu = encodeRecord({ kind: 'crystal', structure: 3, termination: 0, a: 29, b: 0, quarter: 59228, cells: [40n, 30n, 20n], capZ: 0, capOffset: 0 });
    const cr = new Resolver(new MemoryStore([cu]));
    let v: View = cr.root(nodeId(cu));
    let composed: Similarity = IDENTITY_SIM;
    const octants: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const c = childSteps(v)[i % 3];
      composed = composeSim(composed, c.placement);
      octants.push(c.index);
      v = cr.step(v, c.step);
    }
    close(stepPlacement(cr, cr.root(nodeId(cu)), { tag: 'cells', octants }).placement, composed);
  });

  it('a descent through §4.8 picks the child that holds the point', () => {
    const { rec, resolver } = saltRung(6n);
    const g = new Geometries(resolver);
    const v = resolver.root(nodeId(rec));
    const toward = childToward(g, v, [7 * 28.2, 1, 1]);
    expect(toward?.index).toBe(0);
    const frame = descend(frameAt(resolver, nodeId(rec), [], 1, [0, 0, 0]), toward!);
    expect(frame.anchorPath.length).toBe(1);
  });

  it('λ and φ are finite for every v1 tower: the googolplex bar at desk is near −7,254, a tower of levels 2^65535 near −1.45 × 10^6', () => {
    const { rec, resolver } = saltRung(GOOGOLPLEX_L);
    const desk = deskFrame(resolver, nodeId(rec), 0.3, 0.5);
    expect(phi(magnification(desk))).toBeCloseTo(-7254, -1);
    const deep = { u: unitExponent(1n << 65535n), f: 10, ell: 0 };
    const value = phi(deep);
    expect(Number.isFinite(value)).toBe(true);
    expect(value / -1.45e6).toBeCloseTo(1, 2);
  });

  it('eye-relative vertex error stays under 3 × 10⁻³ px in random dives to depth 10¹⁰⁰', () => {
    const rand = prng(986);
    const { rec, resolver } = saltRung(GOOGOLPLEX_L);
    const root = nodeId(rec);
    const pxPerRadian = 1380;
    let worst = 0;
    for (let trial = 0; trial < 20; trial += 1) {
      const k = BigInt(1 + Math.floor(rand() * 200));
      const path = anchorPathTo(GOOGOLPLEX_L, k, (a, i) => (i === 0n ? Math.floor(rand() * 10) : [0, 5, 9][a]));
      const anchor = resolver.resolve(root, path);
      const geometry = new Geometries(resolver).of(anchor);
      const sigma = (20 + rand() * 600) / Math.min(...[0, 1, 2].map((a) => geometry.max[a] - geometry.min[a]));
      const eye = add3(geometry.centre, [(rand() - 0.5) * 3 / sigma, (rand() - 0.5) * 3 / sigma, (rand() - 0.5) * 3 / sigma]);
      const frame = frameAt(resolver, root, path, sigma, eye);
      const cut = buildCut([frame], VIEW, BUDGETS);
      for (const item of cut.items) {
        if (!item.extras.min) continue;
        // modelToEye in binary64, cast once to Float32 (§8.5), applied to a Float32 vertex about c(X).
        const s = frame.metresPerAnchorUnit * item.anchorFromItem.s;
        const c = item.centre;
        const t64 = add3(applyRigid(frame.worldFromAnchor, scale3(applySim(item.anchorFromItem, c), frame.metresPerAnchorUnit)), [0, 0, 0]);
        const t32 = t64.map(Math.fround);
        const s32 = Math.fround(s);
        const vertex = sub3(item.extras.max!, c).map(Math.fround) as Vec3;
        const exact = add3(t64, scale3(vertex, s));
        const cast = [0, 1, 2].map((a) => Math.fround(Math.fround(s32 * vertex[a]) + t32[a])) as Vec3;
        const d = Math.max(len3(exact), VIEW.zNear);
        if (d > VIEW.zFar) continue;
        worst = Math.max(worst, (len3(sub3(cast, exact)) / d) * pxPerRadian);
      }
    }
    expect(worst).toBeLessThan(3e-3);
  });
});
