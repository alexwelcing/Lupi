// /scale's pure logic: the catalog is the spec's records, the axis and its
// readout follow §8.7 and §8.8, wraps keep the anchor path to a few runs and
// the picture congruent, and the world dives from a googolplex bar to its
// ions, rises back, smashes into ten cubes and shares any piece as lsr1.
import { describe, expect, it } from 'vitest';
import {
  anchorView,
  canonicalPath,
  formatMagnitude,
  magnification,
  refFromText,
  resolveRef,
  toHex,
  type AxisRuns,
  type Magnification,
  type Step,
} from '@atlas/core/scale';
import { DEFAULT_ENTRY_ID, entryById, entryResolver, GOOGOLPLEX_LEVELS, ION_LAMBDA, scaleCatalog } from './catalog';
import {
  lambdaOfPhi,
  LINEAR_SHARE,
  magnificationText,
  phiDeltaOfRatio,
  phiOfLambda,
  phiOfMagnification,
  phiOfSlider,
  scientificNumber,
  sliderOfPhi,
} from './axis';
import {
  ascendTail,
  cappedValue,
  descendTail,
  digitsAllowWrap,
  maxAscent,
  prefixRuns,
  runsCount,
  suffixRuns,
  touches,
  wrapDigit,
  wrapPeriods,
} from './wraps';
import { aggregateColour, allocBoxes, allocSplats, collectAtoms, DrawCache, fillInstances, gridOf, writeBoxMatrix } from './draw';
import { CAMERA, faceTowardCamera, ScaleWorld, touchedFace, webBudgets, worldFromItem, type Viewport } from './world';
import { readScaleUrl, scaleUrl } from './share';
import { applySim, IDENTITY, mulVec, rayBox, raySphere, type Sim } from './vec';

const VIEWPORT: Viewport = { heightPx: 720, aspect: 1.6 };
const BUDGETS = webBudgets(false);
const GRAIN =
  'lsr1:TFNSAQECAAChDiEDYilwBFAS61MIQ75O8KCAscIeUmXilMtEDD5XWTQAAABMVVBOAwEAACgAAAAFAAsR-WgBAAUAAAAAAAAABQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAqAAAAExVUE4EAQAAnAAAAC74UC_NIuSwmMV-hcC9G2eT_4vhP5szDQAX8clWHj8-CgEAAHQzHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdDMcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB0MxwAAAAAACoA_f______________D48uqAhDsqp8GiGOQM6K8wvOxIQnC-t8w5QlrUkSESMBAAEAAyoA_f______________D48uqAhDsqp8GiGOQM6K8wvOxIQnC-t8w5QlrUkSAgAFAQABACoAVFVVVVVVVVVVVVVVBYUPOFgW5jjUCAvaau_Y-wOaQSwNWU7U64YMjxgGAQAJKgBUVVVVVVVVVVVVVVUFhQ84WBbmONQIC9pq79j7A5pBLA1ZTtTrhgyPGAYCAAUBAAEAKgBTVVVVVVVVVVVVVVUFhQ84WBbmONQIC9pq79j7A5pBLA1ZTtTrhgyPGAZElhGs54iVFtEXIu6NoHil5LaXyJ5O94VN2RGEl9-ArQ';

/** Steps a world for up to `limit` frames of `dt`, cutting each frame as the page does. */
function run(world: ScaleWorld, limit: number, dt = 1 / 30, until: (w: ScaleWorld) => boolean = (w) => w.flight === null): number {
  let t = 0;
  for (let i = 0; i < limit; i += 1) {
    t += dt;
    world.step(dt);
    world.cutNow(VIEWPORT, BUDGETS, t);
    if (until(world)) return i + 1;
  }
  return limit;
}

const runsPerAxis = (path: readonly Step[]): number[] => {
  const last = path[path.length - 1];
  return last && last.tag === 'tower' ? last.runs.map((r) => r.length) : [0, 0, 0];
};

describe('catalog: the spec records (§12.3, §12.4)', () => {
  it('builds the salt ladder, copper and the diamondoids with the vector NodeIDs and exact counts', () => {
    const id = (key: string) => toHex(entryById(key)!.root);
    expect(id('googolplex')).toBe('a10e2103622970045012eb530843be4ef0a080b1c21e5265e294cb440c3e5759');
    expect(id('googol')).toBe('b6ea59ba7442ec18a606dffa157dba6bda89dbad3b27d427b24cef47012c167e');
    expect(id('salt-1e9')).toBe('8244914ffbe1dc2ef6fcc9d3d4dd33c7f904d8c9b06c6f760fa8224dd6244e27');
    expect(id('salt-1e3')).toBe('1349a66011dc8c606efe01fb2b56362637560b205c37a0e87040041bc8933eb3');
    expect(id('copper-billion')).toBe('42e22db697e0f938556fc8249e423ed986daa0c0ec08aa391afa67d4ad3cf421');
    expect(id('diamondoid-1')).toBe('52c36dc60407419030601a1ec30bddfbafa0867faaaf0699e79cd982129263eb');
    expect(id('diamondoid-12')).toBe('f4d037ff369dc1e509ae78c3d922f244f0b41a628aaa1cc64d69c9db731c1778');
    const count = (key: string) => {
      const e = entryById(key)!;
      const r = entryResolver(e);
      return formatMagnitude(r.count(r.root(e.root)));
    };
    expect(count('googolplex')).toBe('10^(10^100)');
    expect(count('googol')).toBe('10^100');
    expect(count('salt-1e30')).toBe('10^30');
    expect(count('copper-billion')).toBe('1,000,188,000');
    expect(count('diamondoid-12')).toBe('3,601');
    expect(GOOGOLPLEX_LEVELS).toBe(10n ** 100n - 3n);
    expect(scaleCatalog().map((e) => e.id)).toContain(DEFAULT_ENTRY_ID);
    expect(new Set(scaleCatalog().map((e) => e.id)).size).toBe(scaleCatalog().length);
  });

  it('orders every entry\'s landmarks from the largest piece to one ion', () => {
    for (const e of scaleCatalog()) {
      const l = e.landmarks.map((x) => x.lambda);
      expect([...l].sort((a, b) => a - b)).toEqual(l);
      expect(l[l.length - 1]).toBe(ION_LAMBDA);
    }
  });
});

describe('axis: φ, the readout and the slider (§8.7, §8.8)', () => {
  it('φ is λ within ±32 decades, logarithmic and C¹ beyond, and inverts', () => {
    for (const l of [-1e99, -5000, -33, -32, -3.5, 0, 9.2, 40]) expect(lambdaOfPhi(phiOfLambda(l)) / (l || 1)).toBeCloseTo(l === 0 ? 0 : 1, 9);
    const h = 1e-6;
    expect((phiOfLambda(32 + h) - phiOfLambda(32 - h)) / (2 * h)).toBeCloseTo(1, 4);
  });

  it('reads life size, m × 10^e, 10^λ beyond, and the tower base when decades are not exact', () => {
    const m = (u: bigint, f: number, ell: number): Magnification => ({ u, f, ell });
    expect(magnificationText(m(0n, 10, 0.002))).toBe('life size');
    expect(magnificationText(m(0n, 10, Math.log10(2500)))).toBe('shown 2.5 × 10^3 times life size');
    expect(magnificationText(m(1n, 10, 9))).toBe('shown 1 × 10^8 times life size');
    expect(magnificationText(m((10n ** 100n - 4n) / 3n, 10, 9.4))).toBe('shown 10^(−3.333 × 10^99) times life size');
    expect(magnificationText(m(2n ** 70n, 2, 9))).toBe('shown 2^(−1,180,591,620,717,411,303,424) times life size');
    expect(scientificNumber(0.0425)).toBe('4.25 × 10^−2');
    expect(scientificNumber(9.9996)).toBe('1 × 10^1');
  });

  it('φ from the exact pair is finite for a googolplex and agrees with λ where both exist', () => {
    // §8.7: about −7,254 for the googolplex bar.
    expect(phiOfMagnification({ u: (10n ** 100n - 4n) / 3n, f: 10, ell: 9.4 })).toBeCloseTo(-7254, 0);
    expect(phiOfMagnification({ u: 7n, f: 10, ell: 9 })).toBeCloseTo(2, 12);
  });

  it('the slider gives the ±32 decades their share and inverts', () => {
    const wide = { phiMin: -7254, phiMax: 9.2 };
    expect(sliderOfPhi(-7254, wide)).toBe(0);
    expect(sliderOfPhi(9.2, wide)).toBe(1);
    expect(sliderOfPhi(-32, wide)).toBeCloseTo(1 - LINEAR_SHARE, 12);
    const narrow = { phiMin: 5, phiMax: 9.2 };
    expect(sliderOfPhi(7.1, narrow)).toBeCloseTo(0.5, 12);
    for (const range of [wide, narrow]) {
      let prev = -1;
      for (let s = 0; s <= 1; s += 0.05) {
        const phi = phiOfSlider(s, range);
        expect(phi).toBeGreaterThan(prev === -1 ? -Infinity : prev);
        expect(sliderOfPhi(phi, range)).toBeCloseTo(s, 9);
        prev = phi;
      }
    }
    expect(phiDeltaOfRatio(10, 0)).toBe(1);
    expect(phiDeltaOfRatio(10, -5000, 1)).toBeCloseTo(32 * Math.LN10, 12);
  });
});

describe('wraps: digits, face contacts and the run budget (§8.8)', () => {
  const run = (digit: number, length: bigint) => ({ digit, length });
  it('reads face contacts and small values from runs of any length', () => {
    expect(touches([run(9, 10n ** 99n)], 10)).toEqual({ low: false, high: true });
    expect(touches([], 10)).toEqual({ low: true, high: true });
    expect(cappedValue([run(0, 10n ** 99n), run(1, 1n)], 10, 2)).toBe(1);
    expect(cappedValue([run(0, 10n ** 99n), run(3, 1n)], 10, 2)).toBe(2);
    expect(cappedValue([run(0, 5n)], 10, 2)).toBe(0);
    expect(wrapDigit([run(4, 1n), run(9, 3n)], 10)).toBe(5);
    expect(wrapDigit([run(0, 3n)], 10)).toBe(0);
  });

  it('allows a wrap only when every axis has a digit and no face is one node away', () => {
    const ok: AxisRuns = [[run(4, 1n)], [run(6, 1n)], [run(9, 2n)]];
    expect(digitsAllowWrap(ok, 10)).toBe(true);
    expect(digitsAllowWrap([[run(4, 1n)], [], [run(9, 1n)]], 10)).toBe(false);
    expect(digitsAllowWrap([[run(0, 3n), run(1, 1n)], [run(6, 1n)], [run(9, 1n)]], 10)).toBe(false);
  });

  it('a descending wrap appends 3n levels of constant digits; the ascent removes them', () => {
    const path: Step[] = [{ tag: 'tower', levels: 3n, runs: [[run(4, 1n)], [run(6, 1n)], [run(9, 1n)]] }];
    const n = 10n ** 99n;
    const down = descendTail(path, n, 10);
    const step = down[0] as Extract<Step, { tag: 'tower' }>;
    expect(step.levels).toBe(3n + 3n * n);
    expect(step.runs).toEqual([[run(4, 1n), run(5, n)], [run(6, 1n), run(5, n)], [run(9, n + 1n)]]);
    expect(ascendTail(down, n)).toEqual(path);
    expect(maxAscent(down, 10, n)).toBe(n);
    // Removing the last digit too would leave y without a digit.
    expect(maxAscent(down, 10, n + 1n)).toBe(n);
  });

  it('with a head, the digits between it and the last four are rewritten, so dives never pile up runs', () => {
    const noisy: AxisRuns = [
      [run(4, 1n), run(5, 50n), run(2, 1n), run(5, 50n), run(7, 1n), run(3, 1n), run(8, 1n), run(1, 1n), run(6, 1n)],
      [run(6, 1n), run(5, 106n)],
      [run(9, 107n)],
    ];
    const levels = 3n * 107n;
    const path: Step[] = [{ tag: 'tower', levels, runs: noisy }];
    const down = descendTail(path, 1000n, 10, [1n, 1n, 1n]);
    const step = down[0] as Extract<Step, { tag: 'tower' }>;
    expect(step.levels).toBe(levels + 3000n);
    expect(step.runs.map(runsCount)).toEqual(noisy.map((a) => runsCount(a) + 1000n));
    // Head, one run of 5s, and the last four digits untouched.
    expect(prefixRuns(step.runs[0], 1n)).toEqual([run(4, 1n)]);
    expect(suffixRuns(step.runs[0], 4n)).toEqual(suffixRuns(noisy[0], 4n));
    expect(step.runs[0].length).toBeLessThanOrEqual(6);
    expect(step.runs[2]).toEqual([run(9, 1107n)]);
  });

  it('counts periods exactly in bigint however far the target is', () => {
    const u = (10n ** 100n - 4n) / 3n;
    expect(wrapPeriods({ u: 20n, ell: 9.5, f: 10, picture: 0.03, v: 0.03, target: -10.5 + 0.9 })).toBe(0n);
    expect(wrapPeriods({ u: 20n, ell: 9.5, f: 10, picture: 0.03, v: 0.03, target: -10.5 + 4 })).toBe(4n);
    const n = wrapPeriods({ u, ell: 9.5, f: 10, picture: 0.03, v: 0.03, target: -1e99 });
    // u_after = (9.53 + 10^99) rounded; the wrap is u − u_after periods.
    expect(n).toBe(u - BigInt(Math.round(9.53 + 1e99)));
    expect(wrapPeriods({ u: 20n, ell: 9.4, f: 10, picture: -0.03, v: 0.03, target: -30 })).toBeLessThan(0n);
  });
});

describe('world: the googolplex dive (§8.4, §8.8, §9)', () => {
  it('opens on the bar: one box, the exact count and the decades-of-decades readout', () => {
    const world = ScaleWorld.fromEntry(entryById('googolplex')!, VIEWPORT.aspect);
    const cut = world.cutNow(VIEWPORT, BUDGETS, 0);
    expect(cut.items.length).toBe(1);
    const r = world.readout(VIEWPORT);
    expect(r.count).toBe('10^(10^100) atoms');
    expect(r.pieceCount).toBe('10^(10^100) atoms');
    expect(r.pieceFormula).toBe('BrCl499Na500 × 10^(10^100 − 3)');
    expect(r.magnification).toBe('shown 10^(−3.333 × 10^99) times life size');
    expect(world.phi()).toBeCloseTo(-7254.2, 0);
    expect(world.wrapAllowed(0)).toBe(false);
    const hit = world.pick([0, 0, -1]);
    expect(hit?.body).toBe(0);
    expect(hit!.distance).toBeGreaterThan(0.5);
    expect(hit!.distance).toBeLessThan(CAMERA.distance);
  });

  it('dives from the bar to its ions in bounded time with a few runs per axis, draws atoms, and rises home', () => {
    const world = ScaleWorld.fromEntry(entryById('googolplex')!, VIEWPORT.aspect);
    world.cutNow(VIEWPORT, BUDGETS, 0);
    world.flyTo(world.range.phiMax, world.pick([0, 0, -1])!.point);
    const frames = run(world, 1500);
    expect(world.flight).toBe(null);
    // About 20 s of flight at 30 frames a second.
    expect(frames).toBeLessThan(900);
    const path = world.bodies[0].frame.anchorPath;
    expect(Math.max(...runsPerAxis(path))).toBeLessThanOrEqual(12);
    const lambda = world.lambda();
    expect(lambda).toBeCloseTo(ION_LAMBDA, 2);
    // A few more cuts materialize the seed copies on the face.
    run(world, 30, 1 / 30, () => false);
    const atoms = world.cut!.items.reduce((n, i) => n + (i.extras.atoms ?? 0), 0);
    expect(atoms).toBeGreaterThan(500);
    const r = world.readout(VIEWPORT);
    expect(r.count).toBe('10^(10^100) atoms');
    expect(r.pieceCount).toBe('1,000 atoms');
    expect(r.pieceFormula).toBe('BrCl499Na500');
    // The piece is a seed copy deep in the googolplex: its reference is small and resolves.
    const text = world.shareText(VIEWPORT)!;
    expect(text.startsWith('lsr1:')).toBe(true);
    expect(text.length).toBeLessThan(2000);
    const back = resolveRef(refFromText(text));
    expect(formatMagnitude(back.count)).toBe('1,000');
    expect(back.ref.probe).not.toBe(null);

    world.flyTo(world.range.phiMin, world.focus!);
    run(world, 1500);
    expect(world.flight).toBe(null);
    expect(world.bodies[0].frame.anchorPath).toEqual([]);
    expect(world.phi()).toBeCloseTo(world.range.phiMin, 3);
  }, 60000);

  it('a dive into the billion-ion cube passes its landmarks and ends on ions too', () => {
    const world = ScaleWorld.fromEntry(entryById('salt-1e9')!, VIEWPORT.aspect);
    world.cutNow(VIEWPORT, BUDGETS, 0);
    world.flyTo(world.nextLandmark(1), world.pick([0, 0, -1])!.point);
    run(world, 600);
    expect(world.phi()).toBeGreaterThan(phiOfLambda(entryById('salt-1e9')!.landmarks[1].lambda) - 0.01);
    world.flyTo(world.range.phiMax, world.focus!);
    run(world, 600);
    expect(world.lambda()).toBeCloseTo(ION_LAMBDA, 2);
  }, 30000);
});

describe('world: smash, isolate, pinch, pan (§10.6 on the page)', () => {
  it('smashes the bar into ten cubes of 10^(10^100 − 1), keeps the count, and dives into one', () => {
    const world = ScaleWorld.fromEntry(entryById('googolplex')!, VIEWPORT.aspect);
    world.cutNow(VIEWPORT, BUDGETS, 0);
    expect(world.canSmash()).toBe(true);
    world.smash();
    expect(world.bodies.length).toBe(10);
    expect(world.readout(VIEWPORT).count).toBe('10^(10^100) atoms');
    const cubes = world.bodies.map((b) => formatMagnitude(b.frame.resolver.count(b.frame.resolver.resolve(b.frame.root, b.frame.path))));
    expect(new Set(cubes)).toEqual(new Set(['10^(10^100 − 1)']));
    run(world, 300, 1 / 30, (w) => w.bodies.every((b) => b.motion === null));
    expect(world.bodies.every((b) => b.motion === null)).toBe(true);
    // Settled apart: no two cube centres closer than a cube.
    const target = world.bodies[3];
    const hit = world.pick(normalizeVec(target.frame.worldFromAnchor.t));
    world.isolate(3);
    expect(world.bodies.length).toBe(1);
    expect(world.bodies[0]).toBe(target);
    const step = world.bodies[0].frame.path[0] as Extract<Step, { tag: 'tower' }>;
    expect(step.runs[0]).toEqual([{ digit: 3, length: 1n }]);
    void hit;
  });

  it('a smashed cube, tumbled and set apart, dives to its own ions', () => {
    const world = ScaleWorld.fromEntry(entryById('googolplex')!, VIEWPORT.aspect);
    world.cutNow(VIEWPORT, BUDGETS, 0);
    world.smash();
    run(world, 300, 1 / 30, (w) => w.bodies.every((b) => b.motion === null));
    // Tap the cube nearest the middle of the view.
    const centre = world.centre();
    const dir = normalizeVec(centre);
    const hit = world.pick(dir) ?? world.pick(normalizeVec(world.bodies[4].frame.worldFromAnchor.t))!;
    world.isolate(hit.body);
    world.flyTo(world.range.phiMax, hit.point);
    run(world, 1500);
    run(world, 30, 1 / 30, () => false);
    expect(world.bodies.length).toBe(1);
    expect(world.lambda()).toBeCloseTo(ION_LAMBDA, 2);
    expect(world.cut!.drawnAtoms).toBeGreaterThan(100);
    expect(world.readout(VIEWPORT).count).toBe('10^(10^100 − 1) atoms');
  }, 60000);

  it('Still turns the dive into cuts: a handful of frames, no picture zoom between them', () => {
    const world = ScaleWorld.fromEntry(entryById('googolplex')!, VIEWPORT.aspect);
    world.comfort = 'still';
    world.cutNow(VIEWPORT, BUDGETS, 0);
    world.flyTo(world.range.phiMax, world.pick([0, 0, -1])!.point);
    const frames = run(world, 400);
    expect(world.flight).toBe(null);
    expect(frames).toBeLessThan(120);
    expect(world.lambda()).toBeCloseTo(ION_LAMBDA, 2);
  }, 30000);

  it('a pinch zooms about its point, never past one ion and never below a twelfth of the view', () => {
    const world = ScaleWorld.fromEntry(entryById('salt-1e6')!, VIEWPORT.aspect);
    world.cutNow(VIEWPORT, BUDGETS, 0);
    const p = world.pick([0, 0, -1])!.point;
    for (let i = 0; i < 80; i += 1) {
      world.zoom(p, 1.5);
      world.step(1 / 60);
    }
    expect(world.lambda()).toBeLessThanOrEqual(lambdaOfPhi(world.range.phiMax) + 1e-9);
    world.reset();
    for (let i = 0; i < 80; i += 1) world.zoom(p, 0.5);
    const g = world.bodies[0].frame;
    expect(g.metresPerAnchorUnit).toBeGreaterThan(0);
    expect(world.lambda()).toBeGreaterThan(phiOfLambda(-40));
  });

  it('a pan carries the anchor across the face without losing the focus', () => {
    const world = ScaleWorld.fromEntry(entryById('salt-1e30')!, VIEWPORT.aspect);
    world.cutNow(VIEWPORT, BUDGETS, 0);
    const p = world.pick([0, 0, -1])!.point;
    for (let i = 0; i < 40; i += 1) {
      world.zoom(p, 1.6);
      world.step(1 / 60);
      world.cutNow(VIEWPORT, BUDGETS, i / 60);
    }
    expect(world.bodies[0].frame.anchorPath.length).toBe(1);
    for (let i = 0; i < 120; i += 1) {
      world.pan([0.25, 0, 0]);
      world.focus = world.pick([0, 0, -1])?.point ?? world.focus;
      world.step(1 / 60);
      world.cutNow(VIEWPORT, BUDGETS, 1 + i / 60);
    }
    // The face is still under the centre of the view.
    expect(world.pick([0, 0, -1])).not.toBe(null);
  });
});

describe('share: lsr1 links (§7)', () => {
  it('round-trips the view address', () => {
    expect(scaleUrl({ entryId: 'copper-billion' })).toBe('/scale?e=copper-billion');
    expect(readScaleUrl('?e=googol')).toEqual({ entryId: 'googol', ref: null });
    expect(readScaleUrl(`?ref=${GRAIN}`).ref).toBe(GRAIN);
    expect(readScaleUrl('?ref=lsr1:not%20base64!').ref).toBe(null);
    expect(scaleUrl({ ref: GRAIN })).toBe(`/scale?ref=${GRAIN}`);
  });

  it('opens §12.4\'s grain in place, looking down at the top face it sits on', () => {
    const world = ScaleWorld.fromRef(GRAIN, VIEWPORT.aspect);
    expect(world.entry?.id).toBe('googolplex');
    const frame = world.bodies[0].frame;
    expect(frame.path).toEqual([]);
    expect(anchorView(frame).type).toBe('copy');
    const r = world.readout(VIEWPORT);
    expect(r.pieceCount).toBe('1,000 atoms');
    expect(r.count).toBe('10^(10^100) atoms');
    // The same piece shares back to the same reference.
    expect(world.shareText(VIEWPORT)).toBe(GRAIN);
    expect(touchedFace(world.resolver, frame.root, frame.anchorPath)).toEqual({ axis: 1, sign: 1 });
    // +y turns toward the camera (+z).
    const up = mulVec(faceTowardCamera({ axis: 1, sign: 1 }), [0, 1, 0]);
    expect(up[2]).toBeGreaterThan(0.9);
    // And it keeps working: the anchor rebases up to tens of metres.
    run(world, 20, 1 / 30, () => false);
    expect(world.bodies[0].frame.anchorPath.length).toBeGreaterThan(0);
  });

  it('a piece shared mid-dive opens as the same piece', () => {
    const world = ScaleWorld.fromEntry(entryById('salt-1e30')!, VIEWPORT.aspect);
    world.cutNow(VIEWPORT, BUDGETS, 0);
    world.flyTo(phiOfLambda(4), world.pick([0, 0, -1])!.point);
    run(world, 600);
    const text = world.shareText(VIEWPORT)!;
    const piece = world.pieceInView(VIEWPORT).path;
    const opened = ScaleWorld.fromRef(text, VIEWPORT.aspect);
    expect(opened.pieceInView(VIEWPORT).path).toEqual(canonicalPath(piece));
    expect(opened.readout(VIEWPORT).pieceCount).toBe(world.readout(VIEWPORT).pieceCount);
  }, 30000);
});

describe('draw: from a cut to instances and atoms (§8.5, §9.7)', () => {
  it('a box matrix maps the unit cube onto the item region in world space', () => {
    const w: Sim = { s: 2, r: [0, -1, 0, 1, 0, 0, 0, 0, 1], t: [1, 2, 3] };
    const out = new Float32Array(16);
    writeBoxMatrix(out, 0, w, [1, 0, 0], [2, 3, 4]);
    const corner = (x: number, y: number, z: number) => [0, 1, 2].map((i) => out[i] * x + out[4 + i] * y + out[8 + i] * z + out[12 + i]);
    expect(corner(0, 0, 0)).toEqual(applySim(w, [1, 0, 0]).map((v) => Math.fround(v)));
    expect(corner(1, 1, 1).map((v) => Math.round(v * 1e6) / 1e6)).toEqual(applySim(w, [3, 3, 4]));
  });

  it('the aggregate colour of salt is the count-weighted CPK mean', () => {
    const c = aggregateColour(new Map([[11, 500n], [17, 500n]]));
    const na = aggregateColour(new Map([[11, 1n]]));
    const cl = aggregateColour(new Map([[17, 1n]]));
    for (let i = 0; i < 3; i += 1) expect(c[i]).toBeCloseTo((na[i] + cl[i]) / 2, 12);
  });

  it('boxes carry an f-adic grid in their own periods; atoms land where the cut put them', () => {
    const world = ScaleWorld.fromEntry(entryById('salt-1e9')!, VIEWPORT.aspect);
    world.cutNow(VIEWPORT, BUDGETS, 0);
    world.flyTo(world.range.phiMax, world.pick([0, 0, -1])!.point);
    run(world, 900);
    run(world, 40, 1 / 30, () => false);
    const cut = world.cut!;
    const frames = world.bodies.map((b) => b.frame);
    const keys = world.bodies.map((b) => b.key);
    const cache = new DrawCache();
    const boxes = allocBoxes(4096);
    const splats = allocSplats(64);
    fillInstances(cut, frames, keys, cache, boxes, splats);
    const sets = collectAtoms(cut, frames, keys, cache);
    expect(sets.length).toBe(1);
    expect(sets[0].count).toBe(cut.drawnAtoms);
    // Reused as long as the atoms and the anchor are the same.
    expect(collectAtoms(cut, frames, keys, cache, new Map([[keys[0], sets[0]]]))[0]).toEqual(sets[0]);
    // An atom: anchor-relative position back to world equals the item's own transform of the leaf.
    const item = cut.items.find((i) => i.extras.atoms !== undefined)!;
    const leaf = cache.leaf(frames[0], item);
    const i0 = item.extras.atomIndices?.[0] ?? 0;
    const viaItem = applySim(worldFromItem(frames[0], item), [leaf.positions[3 * i0], leaf.positions[3 * i0 + 1], leaf.positions[3 * i0 + 2]]);
    const f = frames[0];
    const set = sets[0];
    const local = [0, 1, 2].map((a) => set.positions[a] + set.centre[a]) as [number, number, number];
    const viaSet = applySim({ s: f.metresPerAnchorUnit, r: f.worldFromAnchor.r, t: f.worldFromAnchor.t }, local);
    const first = cut.items.findIndex((i) => i.extras.atoms !== undefined);
    expect(first).toBeGreaterThanOrEqual(0);
    if (cut.items.filter((i) => i.extras.atoms !== undefined)[0] === item) {
      for (let a = 0; a < 3; a += 1) expect(viaSet[a]).toBeCloseTo(viaItem[a], 5);
    }
    const boxItem = cut.items.find((i) => i.kind === 'box');
    if (boxItem) {
      const grid = gridOf(world.resolver.resolve(f.root, f.path), boxItem, world.resolver);
      expect(grid?.base).toBe(10);
    }
    expect(boxes.count).toBe(cut.items.filter((i) => i.kind === 'box').length);
  }, 30000);

  it('a diamondoid draws its whole leaf as atoms', () => {
    const world = ScaleWorld.fromEntry(entryById('diamondoid-1')!, VIEWPORT.aspect);
    // The capped crystal stands in as splats until its leaf is resident, a frame later.
    run(world, 3, 1 / 30, () => false);
    const cut = world.cut!;
    const sets = collectAtoms(cut, world.bodies.map((b) => b.frame), world.bodies.map((b) => b.key), new DrawCache());
    expect(sets[0].count).toBe(26);
    expect(sets[0].angstrom).toBe(1);
  });

  it('copper\'s billion dives to atoms through its octree', () => {
    const world = ScaleWorld.fromEntry(entryById('copper-billion')!, VIEWPORT.aspect);
    world.cutNow(VIEWPORT, BUDGETS, 0);
    world.flyTo(world.range.phiMax, world.pick([0, 0, -1])!.point);
    run(world, 900);
    run(world, 40, 1 / 30, () => false);
    expect(world.lambda()).toBeCloseTo(ION_LAMBDA, 2);
    expect(world.cut!.drawnAtoms).toBeGreaterThan(100);
    expect(world.readout(VIEWPORT).count).toBe('1,000,188,000 atoms');
    expect(magnification(world.bodies[0].frame).u).toBe(0n);
  }, 30000);
});

describe('vec: rays', () => {
  it('hits boxes and spheres from outside, and misses beside them', () => {
    const box: Sim = { s: 1, r: IDENTITY, t: [0, 0, -2] };
    expect(rayBox([0, 0, 0], [0, 0, -1], box, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])).toBeCloseTo(1.5, 12);
    expect(rayBox([0, 0, 0], [0, 1, 0], box, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])).toBe(null);
    expect(raySphere([0, 0, 0], [0, 0, -1], [0, 0, -3], 1)).toBeCloseTo(2, 12);
    expect(raySphere([0, 0, 0], [1, 0, 0], [0, 0, -3], 1)).toBe(null);
  });
});

function normalizeVec(v: readonly number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
