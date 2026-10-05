// The page's world (scale-spec §8, §9 on a web canvas): a fixed camera at the
// origin looking down −z, and bodies placed in front of it in metres, each a
// BodyFrame whose anchor rebases as it grows. Zoom, orbit and pan move the
// bodies, never the camera, so every drawn vertex stays near the origin in
// Float32 (§8.5). Flight along the scale axis zooms the picture at a bounded
// rate and makes up the rest with wraps (§8.8).

import {
  addMagnitude,
  anchorView,
  ascend,
  bodyView,
  buildCut,
  canonicalPath,
  childSteps,
  childToward,
  CutCache,
  descend,
  formatMagnitude,
  formulaText,
  KG_PER_MICRO_DALTON,
  massMicroDa,
  scientific,
  Geometries,
  magnification,
  rebase,
  refText,
  resolveRef,
  refFromText,
  Resolver,
  TauController,
  unitExponent,
  writeRef,
  type BodyFrame,
  type Budgets,
  type Cut,
  type DrawItem,
  type Magnitude,
  type Mat3,
  type Step,
  type Vec3,
  type View,
  type ViewState,
} from '@atlas/core/scale';
import { entryByRoot, entryResolver, ION_LAMBDA, type ScaleEntry, type ScaleLandmark } from './catalog';
import {
  lambdaOfMagnification,
  lambdaOfPhi,
  magnificationText,
  phiOfLambda,
  phiOfMagnification,
  type SliderRange,
} from './axis';
import {
  add,
  axisAngle,
  composeSim,
  dot,
  IDENTITY,
  length,
  mulMat,
  mulVec,
  normalize,
  orthonormalize,
  rayBoxFace,
  raySphere,
  scale,
  sub,
  transpose,
  type Sim,
} from './vec';
import { lengthText } from './units';
import { ascendTail, descendTail, digitsAllowWrap, maxAscent, runsCount, towerTail, wrapPeriods } from './wraps';

export const CAMERA = {
  fovY: (50 * Math.PI) / 180,
  /** Where a body's front sits when it is framed, metres from the eye. */
  distance: 0.8,
  zNear: 0.01,
  zFar: 20,
} as const;

/** §8.8 flight, with the page's comfort: Standard or Gentle (halved), Still cuts. */
export const FLIGHT = {
  /** §8.8's cruise, φ/s; the page eases it down near life size (cruiseFor). */
  cruise: 400,
  easing: 4,
  fastBeyond: 8192,
  fastRate: 20.48,
  /** Decades the picture zooms per 60 Hz frame (V). */
  picture: 0.03,
} as const;

/**
 * Target flight speed at φ, φ/s: §8.8's 400 out among the decades of
 * decades and |φ|/20.48 past 8,192, but slower toward life size, so the
 * rungs of the ladder (a googol, 10^30, a billion) pass slowly enough to
 * read. The page's own play constant.
 */
export function cruiseFor(phi: number): number {
  const a = Math.abs(phi);
  if (a > FLIGHT.fastBeyond) return a / FLIGHT.fastRate;
  return Math.min(2 * FLIGHT.cruise, Math.max(6, 0.6 * a));
}

export type Comfort = 'standard' | 'gentle' | 'still';

export interface BodyMotion {
  velocity: Vec3;
  spin: Vec3;
  rest: Vec3;
}

export interface ScaleBody {
  key: string;
  frame: BodyFrame;
  motion: BodyMotion | null;
  /** Digits per axis of the anchor path's tower step when the current dive first wrapped. */
  wrapHead?: bigint[] | null;
}

export interface Viewport {
  /** Drawing-buffer pixels: τ is in device pixels. */
  heightPx: number;
  aspect: number;
}

export interface Hit {
  body: number;
  point: Vec3;
  distance: number;
  /** The surface's outward normal there, world space (absent from inside a box). */
  normal?: Vec3;
}

/** Web budgets (§9.3 is the phone's AR; a page profiles for itself, §9.8.7). */
export function webBudgets(phone: boolean): Budgets {
  // The TypeScript cut costs about 0.04 ms an item on a laptop (§9.8.7 gates it loosely), so items
  // and visits set the frame time; atoms are cheap impostors.
  return phone
    ? { tau: 1.5, visits: 1000, items: 800, instancedAtoms: 30000, engineAtoms: 30000, boxesAndSplats: 4000, materializations: 4, meshBuilds: 1, residentBytes: 48 << 20 }
    : { tau: 1.5, visits: 2400, items: 1600, instancedAtoms: 90000, engineAtoms: 90000, boxesAndSplats: 8000, materializations: 6, meshBuilds: 1, residentBytes: 96 << 20 };
}

const viewHeightAt = (d: number) => 2 * d * Math.tan(CAMERA.fovY / 2);

/** A pleasing three-quarter turn: the front, right and top faces show. */
export const THREE_QUARTER: Mat3 = orthonormalize(mulMat(axisAngle([1, 0, 0], 0.32), axisAngle([0, 1, 0], -0.42)));

/** The world point of an anchor-frame point. */
export function worldOf(frame: BodyFrame, x: Vec3): Vec3 {
  return add(mulVec(frame.worldFromAnchor.r, scale(x, frame.metresPerAnchorUnit)), frame.worldFromAnchor.t);
}

/** An anchor-frame point of a world point. */
export function anchorOf(frame: BodyFrame, p: Vec3): Vec3 {
  return scale(mulVec(transpose(frame.worldFromAnchor.r), sub(p, frame.worldFromAnchor.t)), 1 / frame.metresPerAnchorUnit);
}

/** worldFromItem for a cut item, binary64. */
export function worldFromItem(frame: BodyFrame, item: DrawItem): Sim {
  const w: Sim = { s: frame.metresPerAnchorUnit, r: frame.worldFromAnchor.r, t: frame.worldFromAnchor.t };
  return composeSim(w, item.anchorFromItem);
}

const maxExtent = (min: Vec3, max: Vec3) => Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

/**
 * A node's size for "what is in view": the geometric mean of its sides, so a
 * cube's slab (f, f, 1) reads smaller than the cube though their longest
 * sides match.
 */
const meanExtent = (min: Vec3, max: Vec3) => Math.cbrt(Math.max(max[0] - min[0], 0) * Math.max(max[1] - min[1], 0) * Math.max(max[2] - min[2], 0));

/**
 * A body framed in front of the camera: its node's longest side spans
 * `fill` of the smaller view dimension, its centre `distance` away.
 */
export function framedBody(
  resolver: Resolver, root: Uint8Array, path: Step[], anchorPath: Step[], opts: { aspect: number; fill?: number; rotation?: Mat3; distance?: number },
): BodyFrame {
  const g = new Geometries(resolver);
  const view = resolver.walk(resolver.resolve(root, path), anchorPath);
  const geo = g.of(view);
  const distance = opts.distance ?? CAMERA.distance;
  const h = viewHeightAt(distance);
  const span = (opts.fill ?? 0.5) * Math.min(h, h * opts.aspect);
  const lo = sub(geo.min, [geo.rAtom, geo.rAtom, geo.rAtom]);
  const hi = add(geo.max, [geo.rAtom, geo.rAtom, geo.rAtom]);
  const sigma = span / Math.max(maxExtent(lo, hi), 1e-30);
  const r = opts.rotation ?? THREE_QUARTER;
  const t = sub([0, 0, -distance], mulVec(r, scale(geo.centre, sigma)));
  return { root, path, anchorPath, worldFromAnchor: { r, t }, metresPerAnchorUnit: sigma, resolver };
}

let bodyKeys = 0;
const newKey = () => `b${(bodyKeys += 1)}`;

export interface Readout {
  title: string;
  count: string;
  /** §5.5's scientific mass of everything shown, in kg. */
  mass: string;
  pieceCount: string;
  pieceFormula: string;
  /** The piece's longest side. */
  pieceSize: string;
  magnification: string;
  drawn: string;
}

export class ScaleWorld {
  entry: ScaleEntry | null;
  title: string;
  resolver: Resolver;
  bodies: ScaleBody[];
  range: SliderRange;
  landmarks: ScaleLandmark[];
  comfort: Comfort = 'standard';
  /**
   * Flight toward a φ, zooming about `focus` (world). `lead` runs ahead
   * along the axis at the flight speed; the picture follows it at V per
   * frame and wraps make up whole periods of the gap (§8.8).
   */
  flight: { target: number; speed: number; focus: Vec3; lead: number } | null = null;
  /** The last zoom or tap point: rebasing descends toward it. */
  focus: Vec3 | null = null;
  /** A shared piece just opened: it is the piece in view until anything moves. */
  sharedPiece: Step[] | null = null;
  cut: Cut | null = null;
  private cutCache = new CutCache();
  readonly tau = new TauController(1.0, 1.5);
  /** Set by anything that moves a body; the next frame cuts again. */
  dirty = true;
  /** Anchors (body key + path) of the last cut, to know when atoms re-upload. */
  version = 0;
  private geometries: Geometries;
  private home: ScaleBody[];

  private constructor(opts: { entry: ScaleEntry | null; title: string; resolver: Resolver; bodies: ScaleBody[]; landmarks: ScaleLandmark[] }) {
    this.entry = opts.entry;
    this.title = opts.title;
    this.resolver = opts.resolver;
    this.bodies = opts.bodies;
    this.landmarks = opts.landmarks;
    this.geometries = new Geometries(opts.resolver);
    this.home = opts.bodies.map((b) => ({ ...b, frame: { ...b.frame } }));
    const top = phiOfMagnification(magnification(this.home[0].frame));
    const ion = phiOfLambda(ION_LAMBDA);
    this.range = { phiMin: Math.min(top, ion - 1), phiMax: Math.max(ion, top + 0.5) };
  }

  static fromEntry(entry: ScaleEntry, aspect: number): ScaleWorld {
    const resolver = entryResolver(entry);
    const frame = framedBody(resolver, entry.root, [], [], { aspect, fill: 0.55 });
    return new ScaleWorld({ entry, title: entry.title, resolver, bodies: [{ key: newKey(), frame, motion: null }], landmarks: entry.landmarks });
  }

  /**
   * A shared `lsr1:` reference (§7). A piece of a tower or crystal that
   * touches a root face opens in place, looking at that face, so zooming out
   * shows where it came from; anything else opens as a piece of its own.
   */
  static fromRef(text: string, aspect: number): ScaleWorld {
    const { resolver: refResolver, ref, view } = resolveRef(refFromText(text.trim()));
    const entry = entryByRoot(ref.root);
    const resolver = entry ? entryResolver(entry) : refResolver;
    const face = ref.path.every((s) => s.tag === 'tower' || s.tag === 'cells') ? touchedFace(resolver, ref.root, ref.path) : null;
    let frame: BodyFrame;
    if (face && ref.path.length > 0) {
      frame = framedBody(resolver, ref.root, [], ref.path, { aspect, fill: 0.45, rotation: faceTowardCamera(face) });
    } else {
      frame = framedBody(resolver, ref.root, ref.path, [], { aspect, fill: 0.55 });
    }
    const count = formatMagnitude(resolver.count(view));
    const title = entry ? `${entry.title}: a shared piece` : `A shared piece of ${count} atoms`;
    const world = new ScaleWorld({ entry, title, resolver, bodies: [{ key: newKey(), frame, motion: null }], landmarks: entry?.landmarks ?? [] });
    world.sharedPiece = canonicalPath(ref.path);
    if (entry) {
      // The slider still spans the whole entry, so the piece can be left for its root.
      const top = phiOfMagnification(magnification(framedBody(resolver, entry.root, [], [], { aspect, fill: 0.55 })));
      world.range = { ...world.range, phiMin: Math.min(world.range.phiMin, top) };
    }
    return world;
  }

  // ─── Reading the state ────────────────────────────────────────

  /** The body the readouts and flight follow: the one the focus lies on, else the first. */
  focusBody(): number {
    if (this.bodies.length === 1 || !this.focus) return 0;
    let best = 0;
    let bestD = Infinity;
    this.bodies.forEach((b, i) => {
      const g = this.geometries.of(anchorView(b.frame));
      const d = length(sub(worldOf(b.frame, g.centre), this.focus!));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  phi(): number {
    return phiOfMagnification(magnification(this.bodies[this.focusBody()].frame));
  }

  lambda(): number {
    return lambdaOfMagnification(magnification(this.bodies[this.focusBody()].frame));
  }

  totalCount(): Magnitude {
    let total: Magnitude | null = null;
    for (const b of this.bodies) {
      const c = this.resolver.count(bodyView(b.frame));
      total = total ? addMagnitude(total, c) : c;
    }
    return total!;
  }

  /** The exact mass of every body in µDa (§5.3). */
  totalMass(): Magnitude {
    let total: Magnitude | null = null;
    for (const b of this.bodies) {
      const m = massMicroDa(this.resolver.composition(bodyView(b.frame)));
      total = total ? addMagnitude(total, m) : m;
    }
    return total!;
  }

  readout(viewport: Viewport): Readout {
    const piece = this.pieceInView(viewport);
    const pieceView = this.resolver.resolve(this.bodies[piece.body].frame.root, piece.path);
    const cut = this.cut;
    let boxes = 0;
    let atoms = 0;
    for (const item of cut?.items ?? []) {
      if (item.kind === 'box' || item.kind === 'splats') boxes += 1;
      if (item.extras.atoms !== undefined) atoms += item.extras.atoms;
    }
    const parts = [];
    if (boxes) parts.push(`${boxes.toLocaleString('en-US')} ${boxes === 1 ? 'box' : 'boxes'}`);
    if (atoms) parts.push(`${atoms.toLocaleString('en-US')} atoms`);
    const pieceGeometry = this.geometries.of(pieceView);
    const pieceUnit = pieceView.type === 'level' ? { u: unitExponent(pieceView.k), f: pieceView.tower.factor } : { u: 0n, f: 10 };
    return {
      title: this.title,
      count: `${formatMagnitude(this.totalCount())} atoms`,
      mass: `${scientific(this.totalMass(), KG_PER_MICRO_DALTON)} kg`,
      pieceCount: `${formatMagnitude(this.resolver.count(pieceView))} atoms`,
      pieceFormula: formulaText(this.resolver.composition(pieceView)),
      pieceSize: lengthText(maxExtent(pieceGeometry.min, pieceGeometry.max) + 2 * pieceGeometry.rAtom, pieceUnit.u, pieceUnit.f),
      magnification: magnificationText(magnification(this.bodies[piece.body].frame)),
      drawn: parts.length ? `drawing ${parts.join(' and ')}` : 'drawing nothing',
    };
  }

  /**
   * The piece the view is about: from the focus body's anchor, the deepest
   * node on the focus whose longest side still spans half the view, and
   * never above the body's node. Its root and path are what a share link
   * names.
   */
  pieceInView(viewport: Viewport): { body: number; path: Step[] } {
    if (this.sharedPiece) return { body: 0, path: this.sharedPiece };
    const index = this.focusBody();
    let frame = this.bodies[index].frame;
    const focus = this.focus ?? [0, 0, -CAMERA.distance];
    const want = 0.5 * viewHeightAt(Math.max(length(focus), CAMERA.zNear)) * Math.min(1, viewport.aspect);
    const extent = (f: BodyFrame) => {
      const g = this.geometries.of(anchorView(f));
      return meanExtent(g.min, g.max) * f.metresPerAnchorUnit;
    };
    for (let i = 0; i < 64 && frame.anchorPath.length > 0 && extent(frame) < want; i += 1) frame = ascend(frame);
    let view = anchorView(frame);
    let sim: Sim = { s: 1, r: IDENTITY, t: [0, 0, 0] };
    const steps: Step[] = [...frame.anchorPath];
    const local = this.toAnchor(frame, focus);
    for (let i = 0; i < 64; i += 1) {
      // The focus in the current node's units.
      const x = scale(mulVec(transpose(sim.r), sub(local, sim.t)), 1 / sim.s);
      const child = childToward(this.geometries, view, x);
      if (!child) break;
      const next = composeSim(sim, child.placement);
      let w: View;
      try {
        w = this.resolver.step(view, child.step);
      } catch {
        break;
      }
      const g = this.geometries.of(w);
      if (meanExtent(g.min, g.max) * next.s * frame.metresPerAnchorUnit < want) break;
      steps.push(child.step);
      view = w;
      sim = next;
    }
    return { body: index, path: canonicalPath([...frame.path, ...steps]) };
  }

  private toAnchor(frame: BodyFrame, p: Vec3): Vec3 {
    return anchorOf(frame, p);
  }

  /** The `lsr1:` text of the piece in view (§7.2), or null when it cannot be kept. */
  shareText(viewport: Viewport): string | null {
    const piece = this.pieceInView(viewport);
    try {
      return refText(writeRef({ root: this.bodies[piece.body].frame.root, path: piece.path, store: this.resolver.store }));
    } catch {
      return null;
    }
  }

  // ─── Moving ───────────────────────────────────────────────────

  /** A pinch or wheel: the picture scales about `p` at once (fingers one to one), clamped to the entry's range. */
  zoom(p: Vec3, ratio: number): void {
    if (!(ratio > 0) || ratio === 1) return;
    const lambda = this.lambda();
    let r = ratio;
    const maxLambda = lambdaOfPhi(this.range.phiMax);
    if (r > 1 && Number.isFinite(lambda) && lambda + Math.log10(r) > maxLambda) r = 10 ** Math.max(0, maxLambda - lambda);
    if (r < 1) {
      // Never smaller than a twelfth of the view while the body's whole node is the anchor.
      const b = this.bodies[this.focusBody()];
      if (b.frame.anchorPath.length === 0) {
        const g = this.geometries.of(anchorView(b.frame));
        const shown = maxExtent(g.min, g.max) * b.frame.metresPerAnchorUnit;
        const floor = viewHeightAt(CAMERA.distance) / 12;
        if (shown * r < floor) r = Math.min(1, floor / shown);
      }
    }
    if (r === 1) return;
    this.focus = p;
    this.scaleAbout(p, r);
  }

  private scaleAbout(p: Vec3, r: number): void {
    this.sharedPiece = null;
    for (const b of this.bodies) {
      const f = b.frame;
      b.frame = { ...f, worldFromAnchor: { r: f.worldFromAnchor.r, t: add(p, scale(sub(f.worldFromAnchor.t, p), r)) }, metresPerAnchorUnit: f.metresPerAnchorUnit * r };
      if (b.motion) b.motion = { ...b.motion, rest: add(p, scale(sub(b.motion.rest, p), r)) };
    }
    this.dirty = true;
  }

  /** Turns every body about `pivot` (a drag; the camera and lights stay). */
  orbit(pivot: Vec3, yaw: number, pitch: number): void {
    this.sharedPiece = null;
    const turn = mulMat(axisAngle([1, 0, 0], pitch), axisAngle([0, 1, 0], yaw));
    for (const b of this.bodies) {
      const f = b.frame;
      b.frame = {
        ...f,
        worldFromAnchor: { r: orthonormalize(mulMat(turn, f.worldFromAnchor.r)), t: add(pivot, mulVec(turn, sub(f.worldFromAnchor.t, pivot))) },
      };
      if (b.motion) b.motion = { ...b.motion, rest: add(pivot, mulVec(turn, sub(b.motion.rest, pivot))) };
    }
    this.dirty = true;
  }

  /**
   * Slides every body by `delta` (world). With a surface normal the slide is
   * kept in that surface's plane, so sliding over an oblique face never
   * brings it closer: the camera stays outside the body.
   */
  pan(delta: Vec3, normal?: Vec3): void {
    if (normal) delta = sub(delta, scale(normal, dot(normal, delta)));
    this.sharedPiece = null;
    for (const b of this.bodies) {
      b.frame = { ...b.frame, worldFromAnchor: { ...b.frame.worldFromAnchor, t: add(b.frame.worldFromAnchor.t, delta) } };
      if (b.motion) b.motion = { ...b.motion, rest: add(b.motion.rest, delta) };
    }
    if (this.focus) this.focus = add(this.focus, delta);
    this.dirty = true;
  }

  /** The world centre of the bodies, for orbiting at the desk. */
  centre(): Vec3 {
    let c: Vec3 = [0, 0, 0];
    for (const b of this.bodies) {
      const g = this.geometries.of(anchorView(b.frame));
      c = add(c, worldOf(b.frame, g.centre));
    }
    return scale(c, 1 / this.bodies.length);
  }

  /**
   * Whether a drag may turn the bodies about their centre: only while each
   * is whole in front of the camera, so a turn can never swing a face
   * through the eye. Otherwise a drag slides along the surface.
   */
  canOrbit(): boolean {
    return this.bodies.every((b) => {
      if (b.frame.anchorPath.length > 0) return false;
      const g = this.geometries.of(anchorView(b.frame));
      const c = worldOf(b.frame, g.centre);
      return -c[2] > 1.25 * g.radius * b.frame.metresPerAnchorUnit;
    });
  }

  /** Whether every body still shows its whole node (a drag orbits then; zoomed in, it pans). */
  atDesk(): boolean {
    return this.bodies.every((b) => b.frame.anchorPath.length === 0);
  }

  flyTo(phi: number, focus: Vec3): void {
    const target = Math.min(this.range.phiMax, Math.max(this.range.phiMin, phi));
    this.focus = focus;
    this.flight = { target, speed: this.flight?.speed ?? 0, focus, lead: this.flight?.lead ?? this.phi() };
    this.dirty = true;
  }

  stop(): void {
    this.flight = null;
  }

  /** The next landmark beyond the current φ, toward the atoms (+1) or away (−1). */
  nextLandmark(direction: 1 | -1): number {
    const now = this.phi();
    const phis = [...this.landmarks.map((l) => phiOfLambda(l.lambda)), this.range.phiMin, this.range.phiMax]
      .filter((p) => p >= this.range.phiMin && p <= this.range.phiMax)
      .sort((a, b) => a - b);
    if (direction > 0) return phis.find((p) => p > now + 0.25) ?? this.range.phiMax;
    return [...phis].reverse().find((p) => p < now - 0.25) ?? this.range.phiMin;
  }

  /**
   * One frame: smash motion, flight with wraps, then each body's anchor
   * rebases toward the focus (§8.4). Returns whether anything moved.
   */
  step(dt: number): boolean {
    let moved = this.stepMotion(dt);
    if (this.flight) moved = this.stepFlight(dt) || moved;
    if (moved || this.dirty) this.rebaseAll();
    return moved;
  }

  private stepMotion(dt: number): boolean {
    let moved = false;
    for (const b of this.bodies) {
      const m = b.motion;
      if (!m) continue;
      moved = true;
      const f = b.frame;
      const g = this.geometries.of(anchorView(f));
      const centre = worldOf(f, g.centre);
      // A spring toward the rest point, a little under critical damping: the pieces fly, overshoot once and settle.
      const k = 38;
      const c = 2 * Math.sqrt(k) * 0.62;
      const acc = sub(scale(sub(m.rest, centre), k), scale(m.velocity, c));
      const velocity = add(m.velocity, scale(acc, dt));
      const move = scale(velocity, dt);
      const spin = scale(m.spin, Math.exp(-2.6 * dt));
      const angle = length(spin) * dt;
      const turn = angle > 1e-9 ? axisAngle(spin, angle) : IDENTITY;
      const newCentre = add(centre, move);
      const r = orthonormalize(mulMat(turn, f.worldFromAnchor.r));
      // Turn about the body's own centre, then move it.
      const t = sub(newCentre, mulVec(r, scale(g.centre, f.metresPerAnchorUnit)));
      b.frame = { ...f, worldFromAnchor: { r, t } };
      const settled = length(velocity) < 2e-3 && length(sub(m.rest, newCentre)) < 2e-4 && length(spin) < 2e-2;
      b.motion = settled ? null : { ...m, velocity, spin };
    }
    if (moved) this.dirty = true;
    return moved;
  }

  private stepFlight(dt: number): boolean {
    const flight = this.flight!;
    // Keep the focus on the surface: zooming about a point a rounding error off the face would
    // multiply that error by every decade of the dive (36 decades turn 10⁻¹⁶ m into metres).
    const hit = this.pick(normalize(flight.focus));
    if (hit) {
      flight.focus = hit.point;
      this.focus = hit.point;
    }
    const index = this.focusBody();
    const m = magnification(this.bodies[index].frame);
    const phiNow = phiOfMagnification(m);
    if (Math.abs(flight.target - phiNow) < 1e-3) {
      // Near the top, φ cannot tell a cube a few levels down from the whole body (log-log):
      // a flight to the top ends by settling back into the home framing.
      if (flight.target <= this.range.phiMin + 1e-6 && this.settleHome(dt)) return true;
      this.flight = null;
      return false;
    }
    const still = this.comfort === 'still';
    const gentle = this.comfort === 'gentle' ? 0.5 : 1;
    if (!still) {
      const cruise = cruiseFor(flight.lead) * gentle;
      flight.speed += (cruise - flight.speed) * Math.min(1, FLIGHT.easing * dt);
    }
    const ahead = flight.target - flight.lead;
    flight.lead = still ? flight.target : flight.lead + Math.sign(ahead) * Math.min(Math.abs(ahead), flight.speed * dt);
    const lamNow = lambdaOfMagnification(m);
    const lamNext = lambdaOfPhi(flight.lead);
    // V: the picture's own zoom this frame; Still has none, only cuts.
    const v = still ? 0 : FLIGHT.picture * gentle * Math.min(4, dt * 60);
    const want = lamNext - lamNow;
    if (this.bodies.length > 1 && Math.abs(want) > Math.log10(m.f) + Math.max(v, 3)) {
      // A dive past a few decades needs wraps, and wraps need one body: keep the copy at the focus.
      this.isolate(index);
      return true;
    }
    let picture = Math.max(-v, Math.min(v, want));
    // Wraps make up what the picture does not, while nothing at the seed is drawn (§8.8).
    if (this.wrapAllowed(0)) {
      const n = wrapPeriods({ u: m.u, ell: m.ell, f: m.f, picture, target: lamNext, v });
      if (n !== 0n) this.wrap(0, n);
    }
    if (still) {
      // Still turns flight into cuts: the rest of the jump at once, a few decades per frame at most.
      const after = lambdaOfMagnification(magnification(this.bodies[0].frame));
      picture = Math.max(-8, Math.min(8, lamNext - after));
    }
    if (picture !== 0) {
      // Never past the ion end.
      const capped = Math.min(picture, lambdaOfPhi(this.range.phiMax) - this.lambda());
      if (capped !== 0 && Number.isFinite(capped)) this.scaleAbout(flight.focus, 10 ** capped);
    }
    this.dirty = true;
    return true;
  }

  /**
   * The last of a flight to the top: zoom the picture out until the body's
   * node is the anchor again, then ease into the home pose. Returns false
   * once home (or when the bodies are not the home bodies).
   */
  private settleHome(dt: number): boolean {
    const home = this.home[0];
    if (this.bodies.length !== 1 || this.home.length !== 1 || !samePath(this.bodies[0].frame.path, home.frame.path)) return false;
    const body = this.bodies[0];
    if (body.frame.anchorPath.length > 0) {
      this.scaleAbout(this.flight!.focus, 10 ** (-3 * FLIGHT.picture * Math.min(4, dt * 60)));
      return true;
    }
    const a = body.frame;
    const b = home.frame;
    const k = this.comfort === 'still' ? 1 : 1 - Math.exp(-6 * dt);
    const ls = Math.log(a.metresPerAnchorUnit) + (Math.log(b.metresPerAnchorUnit) - Math.log(a.metresPerAnchorUnit)) * k;
    const r = orthonormalize(a.worldFromAnchor.r.map((x, i) => x + (b.worldFromAnchor.r[i] - x) * k) as Mat3);
    const t = add(a.worldFromAnchor.t, scale(sub(b.worldFromAnchor.t, a.worldFromAnchor.t), k));
    body.frame = { ...a, worldFromAnchor: { r, t }, metresPerAnchorUnit: Math.exp(ls) };
    this.dirty = true;
    const done = Math.abs(ls - Math.log(b.metresPerAnchorUnit)) < 1e-3 && length(sub(t, b.worldFromAnchor.t)) < 1e-4;
    if (done) body.frame = { ...b };
    return !done;
  }

  /**
   * §8.8's wrap conditions, on the page: one body, a tower anchor without
   * removals, nothing drawn at or below the seed copies last frame, and an
   * anchor whose neighbourhood is congruent on both sides of the wrap.
   */
  wrapAllowed(index: number): boolean {
    if (this.bodies.length !== 1) return false;
    const frame = this.bodies[index].frame;
    let anchor: View;
    let body: View;
    try {
      body = bodyView(frame);
      anchor = anchorView(frame);
    } catch {
      return false;
    }
    if (anchor.type !== 'level' || anchor.removals.length > 0 || body.removals.length > 0) return false;
    const tail = towerTail(frame.anchorPath);
    if (!tail || !digitsAllowWrap(tail.step.runs, anchor.tower.factor)) return false;
    for (const item of this.cut?.items ?? []) {
      if (item.extras.atoms !== undefined) return false;
      if (item.kind === 'box' && seedOrBelow(this.resolver, frame, item)) return false;
    }
    return true;
  }

  /** Wraps the body's anchor by n periods (descending when n > 0). */
  wrap(index: number, n: bigint): boolean {
    const body = this.bodies[index];
    const anchor = anchorView(body.frame);
    if (anchor.type !== 'level') return false;
    const f = anchor.tower.factor;
    let path: Step[];
    if (n > 0n) {
      // Stay at least a period above the seed: level k − 3n ≥ 1.
      const room = (anchor.k - 1n) / 3n;
      const take = n < room ? n : room;
      if (take <= 0n) return false;
      const tail = towerTail(body.frame.anchorPath);
      if (!body.wrapHead && tail) body.wrapHead = tail.step.runs.map(runsCount);
      path = descendTail(body.frame.anchorPath, take, f, body.wrapHead ?? undefined);
    } else {
      const take = maxAscent(body.frame.anchorPath, f, -n);
      if (take <= 0n) return false;
      path = ascendTail(body.frame.anchorPath, take);
      const tail = towerTail(path);
      if (body.wrapHead && tail) body.wrapHead = tail.step.runs.map((r, a) => (runsCount(r) < body.wrapHead![a] ? runsCount(r) : body.wrapHead![a]));
    }
    body.frame = { ...body.frame, anchorPath: path };
    this.dirty = true;
    return true;
  }

  private rebaseAll(): void {
    for (const b of this.bodies) {
      const focus = this.focus ?? [0, 0, 0];
      let f = b.frame;
      // A pan can carry the focus off the anchor: give way to its parent when the parent would
      // pick another child for it (bounded per frame).
      for (let i = 0; i < 2 && f.anchorPath.length > 0 && !this.anchorHolds(f, focus); i += 1) {
        const up = ascend(f);
        const toward = childToward(this.geometries, anchorView(up), anchorOf(up, focus));
        if (toward && samePath(descend(up, toward).anchorPath, f.anchorPath)) break;
        f = up;
      }
      f = rebase(f, focus, this.geometries);
      if (f !== b.frame) {
        if (!samePath(f.anchorPath, b.frame.anchorPath)) this.version += 1;
        b.frame = f;
      }
    }
  }

  private anchorHolds(f: BodyFrame, p: Vec3): boolean {
    const g = this.geometries.of(anchorView(f));
    const x = anchorOf(f, p);
    return [0, 1, 2].every((a) => {
      const pad = 0.25 * (g.max[a] - g.min[a]) + g.rAtom;
      return x[a] >= g.min[a] - pad && x[a] <= g.max[a] + pad;
    });
  }

  // ─── Cutting ──────────────────────────────────────────────────

  cutNow(viewport: Viewport, budgets: Budgets, time: number): Cut {
    const view: ViewState = {
      cameraFromWorld: { r: IDENTITY, t: [0, 0, 0] },
      fovY: CAMERA.fovY,
      viewportHeight: viewport.heightPx,
      aspect: viewport.aspect,
      zNear: CAMERA.zNear,
      zFar: CAMERA.zFar,
    };
    const b = { ...budgets, tau: this.tau.tau };
    const cut = buildCut(this.bodies.map((x) => x.frame), view, b, this.cut ?? undefined, { cache: this.cutCache });
    this.tau.frame(time, 1 / 60, cut, b);
    this.cut = cut;
    // Leaves materialized in the background need another cut to show.
    this.dirty = cut.requested > cut.materialized;
    return cut;
  }

  // ─── Picking ──────────────────────────────────────────────────

  /** The nearest drawn surface along a ray from the eye (world, unit `dir`). */
  pick(dir: Vec3): Hit | null {
    const origin: Vec3 = [0, 0, 0];
    let best: Hit | null = null;
    for (const item of this.cut?.items ?? []) {
      if (item.kind === 'facePlane') continue;
      const frame = this.bodies[item.body]?.frame;
      if (!frame) continue;
      const w = worldFromItem(frame, item);
      let t: number | null = null;
      let normal: Vec3 | undefined;
      if (item.extras.splats && item.kind === 'splats') {
        for (const s of item.extras.splats) {
          const centre = add(mulVec(w.r, scale(s.centre, w.s)), w.t);
          const hit = raySphere(origin, dir, centre, s.radius * w.s);
          if (hit !== null && (t === null || hit < t)) {
            t = hit;
            normal = normalize(sub(scale(dir, hit), centre));
          }
        }
      } else if (item.extras.min && item.extras.max) {
        const face = rayBoxFace(origin, dir, w, item.extras.min, item.extras.max);
        if (face) {
          t = face.t;
          if (face.axis >= 0) {
            const e: Vec3 = [0, 0, 0];
            e[face.axis] = face.sign;
            normal = normalize(mulVec(w.r, e));
          }
        }
      }
      if (t !== null && (!best || t < best.distance)) best = { body: item.body, point: scale(dir, t), distance: t, normal };
    }
    return best;
  }

  /** A focus for a ray that misses: the point beside the nearest body's centre at its depth. */
  focusFor(dir: Vec3): Vec3 {
    const hit = this.pick(dir);
    if (hit) return hit.point;
    let best: Vec3 = scale(dir, CAMERA.distance);
    let bestAngle = Infinity;
    for (const b of this.bodies) {
      const g = this.geometries.of(anchorView(b.frame));
      const c = worldOf(b.frame, g.centre);
      const d = length(c);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(normalize(c), dir))));
      if (angle < bestAngle) {
        bestAngle = angle;
        best = scale(dir, d);
      }
    }
    return best;
  }

  // ─── Smash, isolate, reset ────────────────────────────────────

  /** Whether the focus body can break into its children here: a tower level or crystal box seen whole. */
  canSmash(): boolean {
    if (!this.atDesk() || this.flight) return false;
    const b = this.bodies[this.focusBody()];
    const v = bodyView(b.frame);
    return (v.type === 'level' || v.type === 'box') && v.removals.length === 0 && childSteps(v).length > 1;
  }

  /**
   * Smash: the focus body's node becomes its children (a googolplex bar its
   * ten cubes), each its own body, flung apart and settling in a loose row.
   */
  smash(): void {
    if (!this.canSmash()) return;
    const index = this.focusBody();
    const parent = this.bodies[index];
    const view = bodyView(parent.frame);
    const kids = childSteps(view);
    const pg = this.geometries.of(view);
    const centre = worldOf(parent.frame, pg.centre);
    const W: Sim = { s: parent.frame.metresPerAnchorUnit, r: parent.frame.worldFromAnchor.r, t: parent.frame.worldFromAnchor.t };
    let seed = 0x9e3779b9;
    const rand = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return seed / 4294967296;
    };
    const spread = 1.35;
    const pieces: ScaleBody[] = kids.map((c) => {
      const placed = composeSim(W, c.placement);
      const path = canonicalPath([...parent.frame.path, c.step]);
      const frame: BodyFrame = { ...parent.frame, path, anchorPath: [], worldFromAnchor: { r: placed.r, t: placed.t }, metresPerAnchorUnit: placed.s };
      const g = this.geometries.of(bodyView(frame));
      const at = worldOf(frame, g.centre);
      const out = sub(at, centre);
      const rest = add(centre, scale(out, spread));
      const fling = add(scale(normalize(out), 1.1 + 0.6 * rand()), [0.25 * (rand() - 0.5), 0.35 + 0.3 * rand(), 0.25 * (rand() - 0.5)]);
      const spin: Vec3 = [(rand() - 0.5) * 9, (rand() - 0.5) * 9, (rand() - 0.5) * 9];
      return { key: newKey(), frame, motion: this.comfort === 'still' ? null : { velocity: fling, spin, rest } };
    });
    if (this.comfort === 'still') {
      for (const p of pieces) {
        const g = this.geometries.of(bodyView(p.frame));
        const at = worldOf(p.frame, g.centre);
        const delta = scale(sub(at, centre), spread - 1);
        p.frame = { ...p.frame, worldFromAnchor: { ...p.frame.worldFromAnchor, t: add(p.frame.worldFromAnchor.t, delta) } };
      }
    }
    this.bodies.splice(index, 1, ...pieces);
    this.sharedPiece = null;
    this.cut = null;
    this.version += 1;
    this.dirty = true;
  }

  /** Keeps one body (the copy dived into) and lets the others go. */
  isolate(index: number): void {
    const keep = this.bodies[index];
    if (!keep) return;
    keep.motion = null;
    this.bodies = [keep];
    this.cut = null;
    this.version += 1;
    this.dirty = true;
  }

  reset(): void {
    this.sharedPiece = null;
    this.bodies = this.home.map((b) => ({ ...b, key: newKey(), frame: { ...b.frame }, motion: null }));
    this.flight = null;
    this.focus = null;
    this.cut = null;
    this.version += 1;
    this.dirty = true;
  }

  /** Refits the home framing to a new aspect when nothing has moved yet. */
  refit(aspect: number): void {
    if (!this.entry) return;
    const frame = framedBody(this.resolver, this.entry.root, [], [], { aspect, fill: 0.55 });
    this.home = [{ key: newKey(), frame, motion: null }];
    this.reset();
  }
}

function samePath(a: readonly Step[], b: readonly Step[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return JSON.stringify(a, bigintJson) === JSON.stringify(b, bigintJson);
}

const bigintJson = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/** Whether a box item is a seed copy or below (its level is 0 or it is past the tower step). */
function seedOrBelow(resolver: Resolver, frame: BodyFrame, item: DrawItem): boolean {
  const body = bodyView(frame);
  if (body.type !== 'level') return body.type === 'copy';
  const steps = item.path;
  if (steps.length === 0) return body.k === 0n;
  if (steps.length > 1) return true;
  const s = steps[0];
  if (s.tag !== 'tower') return true;
  void resolver;
  return body.k - s.levels <= 0n;
}

/**
 * The root face a piece touches, for opening a shared piece in place:
 * a tower step's all-0 or all-(f−1) digits, or a box at a crystal face.
 * The camera then looks at that face from outside. Prefers +z, +y, +x.
 */
export function touchedFace(resolver: Resolver, root: Uint8Array, path: readonly Step[]): { axis: number; sign: 1 | -1 } | null {
  let view: View;
  try {
    view = resolver.resolve(root, path);
  } catch {
    return null;
  }
  const faces: Array<{ axis: number; sign: 1 | -1 }> = [];
  if (view.type === 'level' || view.type === 'copy') {
    const f = view.tower.factor;
    view.trail.forEach((runs, axis) => {
      if (runs.length === 0) return;
      if (runs.every((r) => r.digit === f - 1)) faces.push({ axis, sign: 1 });
      if (runs.every((r) => r.digit === 0)) faces.push({ axis, sign: -1 });
    });
  } else if (view.type === 'box') {
    for (let axis = 0; axis < 3; axis += 1) {
      if (view.box.hi[axis] === view.crystal.cells[axis]) faces.push({ axis, sign: 1 });
      if (view.box.lo[axis] === 0n) faces.push({ axis, sign: -1 });
    }
  }
  const order = (x: { axis: number; sign: number }) => (x.sign > 0 ? 0 : 3) + [2, 0, 1][x.axis];
  faces.sort((a, b) => order(a) - order(b));
  return faces[0] ?? null;
}

/** A rotation turning a node face's outward normal toward the camera (+z), with a small tilt so neighbours show depth. */
export function faceTowardCamera(face: { axis: number; sign: 1 | -1 }): Mat3 {
  // Columns: where the node's axes go. The face normal goes to +z.
  let base: Mat3;
  if (face.axis === 2) base = face.sign > 0 ? IDENTITY : axisAngle([0, 1, 0], Math.PI);
  else if (face.axis === 1) base = axisAngle([1, 0, 0], face.sign > 0 ? Math.PI / 2 : -Math.PI / 2);
  else base = axisAngle([0, 1, 0], face.sign > 0 ? -Math.PI / 2 : Math.PI / 2);
  return orthonormalize(mulMat(mulMat(axisAngle([1, 0, 0], 0.18), axisAngle([0, 1, 0], -0.22)), base));
}

/** u(A) of a body's anchor, for drawing atoms in anchor units. */
export function anchorUnit(frame: BodyFrame): { u: bigint; f: number } {
  const a = anchorView(frame);
  return a.type === 'level' ? { u: unitExponent(a.k), f: a.tower.factor } : { u: 0n, f: 10 };
}
