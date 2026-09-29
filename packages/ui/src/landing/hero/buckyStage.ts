/**
 * buckyStage.ts — the framework-free ink C60 used by the home hero and the
 * relay stage.
 *
 * One <svg> with 90 <line> bonds and 60 <circle> atoms, projected
 * orthographically from a camera at (azimuth, elevation) about world +Y — the
 * viewer's own camera convention, so the pose carries into 3D — and painted
 * back to front. The atoms share one radial gradient in CPK carbon whose
 * highlight follows the viewer's world-fixed key light (azimuth 40°,
 * elevation 45°), so the drawing is lit the way the 3D cage will be.
 *
 * Nothing moves until it is touched: requestAnimationFrame runs only while a
 * drag is drawing or a release is settling. A drag turns it 1:1; a release
 * coasts on the flick's speed and clicks onto the nearest hexagon or pentagon
 * (exactly face-on, see c60Hero.data.ts), then reports the face. A press on a
 * moving ball catches it. Under the Still comfort level it cuts straight to
 * the face; with coasting off (Gentle) it settles without a throw.
 *
 * Imports only `math`, `@atlas/core/motion` and `motion/comfort` (plus its
 * data): no three, no React, no parsers, so the landing page stays light.
 */
import { wrapAngle } from 'math';
import { MOTION, createSpring1, isSettled, springTo } from '@atlas/core/motion';
import { coastEnabled, getComfort } from '../../motion/comfort';
import { C60_HERO, type C60HeroDetent } from './c60Hero.data';

export type Vec3 = [number, number, number];

/** Radians; camera azimuth about world +Y and elevation. */
export interface BuckyPose {
  azimuth: number;
  elevation: number;
}

export interface BuckyStage {
  setPose(pose: BuckyPose): void;
  getPose(): BuckyPose;
  /** The molecule's apparent spin about world +Y (rad/s). */
  getBodyOmegaY(): number;
  /** Unit direction from the target to the camera, normalize(position − target) (the baton's `viewDir`). */
  viewDir(): Vec3;
  destroy(): void;
}

export interface BuckyStageOptions {
  size: number;
  pose?: BuckyPose;
  interactive: boolean;
  onTap?(): void;
  /** The ball came to rest face-on: 'Hexagon' or 'Pentagon'. */
  onDetent?(label: string): void;
  /** Total degrees turned by hand so far (drags only: a release's coast and settle do not count). */
  onSpinDegrees?(total: number): void;
  /** After every redraw (a drag, a coast, a settle, setPose): the relay mirrors the pose into the baton. */
  onPoseChange?(): void;
}

/** What the stage is doing, mirrored on the host as `data-bucky-state` (the smoke plugin reads it). */
export type BuckyStageState = 'rest' | 'drag' | 'coast' | 'approach' | 'click';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** viewBox units; the SVG scales to the host box. */
const VIEW = 200;
const CENTER = VIEW / 2;
/** Share of the box the ball's diameter fills. */
const FILL = 0.84;
/** Drawn atom radius and bond width (Å): a light ball-and-stick. */
const ATOM_R = 0.34;
const BOND_W = 0.14;
/** Bonds sort just behind atoms at the same depth, so every bond tucks under its atoms. */
const BOND_DEPTH_BIAS = 0.35;

const CARBON = '#909090';
const PLATE = '#101817';

/** The viewer's key light, lightDirection(40, 45): world-fixed. */
const KEY_LIGHT: Vec3 = (() => {
  const az = (40 * Math.PI) / 180;
  const el = (45 * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
})();

/** Release: a flick aims at az + ω·COAST_PROJECT_S, where a friction coast with this time constant would stop. */
const COAST_PROJECT_S = 0.35;
/** Slower releases settle onto the nearest face without a throw. */
const COAST_MIN_OMEGA = 0.8;
const COAST_TAU_MIN = 0.08;
const COAST_TAU_MAX = 1.1;
/** The last CLICK_ZONE of any approach belongs to the click spring: the tug into the notch. */
const CLICK_ZONE = (6 * Math.PI) / 180;
const VELOCITY_WINDOW_MS = 80;
const HELD_STILL_MS = 60;
const MAX_OMEGA = 40;
/** Already on the face (nothing to animate or announce). */
const SETTLE_EPS = 1e-4;
const SETTLE_VEL_EPS = 5e-3;
/** Close enough to land (0.1°, well under a pixel at any stage size); landing snaps exactly. */
const LAND_EPS = 1.7e-3;
const LAND_VEL_EPS = 0.02;
const TAP_SLOP_TOUCH = 8;
const TAP_SLOP_MOUSE = 3;
/** Touches this close to the viewport's left edge belong to the OS back swipe. */
const EDGE_GUARD_PX = 24;
const HOP_MIN = (1 * Math.PI) / 180;
const TWO_PI = Math.PI * 2;
const SAMPLE_COUNT = 16;

let stageSerial = 0;

/**
 * The host size (px) at which the drawing puts `pxPerAngstrom` screen pixels
 * per Å on the ball: the relay sizes its stage so the drawing matches the
 * viewer's fitted C60 when the lit cage takes over.
 */
export function buckyStageSizeFor(pxPerAngstrom: number): number {
  const unitsPerAngstrom = (CENTER * FILL) / (C60_HERO.radius + ATOM_R);
  return (pxPerAngstrom * VIEW) / unitsPerAngstrom;
}

const DETENTS: readonly C60HeroDetent[] = [...C60_HERO.detents].sort((a, b) => a.azimuth - b.azimuth);

interface DetentTarget {
  detent: C60HeroDetent;
  /** The detent's azimuth, unwrapped next to the pose it is reached from. */
  azimuth: number;
}

/** The copy of `azimuth` + 2πk nearest `near`. */
function unwrapNear(azimuth: number, near: number): number {
  return azimuth + TWO_PI * Math.round((near - azimuth) / TWO_PI);
}

/** The detent whose (unwrapped) azimuth is nearest `azimuth`. */
function nearestDetent(azimuth: number): DetentTarget {
  let best = DETENTS[0];
  let bestAz = unwrapNear(best.azimuth, azimuth);
  for (let i = 1; i < DETENTS.length; i += 1) {
    const candidate = unwrapNear(DETENTS[i].azimuth, azimuth);
    if (Math.abs(candidate - azimuth) < Math.abs(bestAz - azimuth)) {
      best = DETENTS[i];
      bestAz = candidate;
    }
  }
  return { detent: best, azimuth: bestAz };
}

/** The next detent more than a degree beyond `from` in direction `dir` (+1: increasing azimuth). */
function nextDetent(from: number, dir: 1 | -1): DetentTarget {
  let best = DETENTS[0];
  let bestStep = Infinity;
  for (const detent of DETENTS) {
    let step = ((detent.azimuth - from) * dir) % TWO_PI;
    if (step < 0) step += TWO_PI;
    if (step <= HOP_MIN) step += TWO_PI;
    if (step < bestStep) {
      bestStep = step;
      best = detent;
    }
  }
  return { detent: best, azimuth: from + dir * bestStep };
}

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

export function createBuckyStage(host: HTMLElement, opts: BuckyStageOptions): BuckyStage {
  const atomCount = C60_HERO.positions.length / 3;
  const bondCount = C60_HERO.bonds.length / 2;
  const itemCount = atomCount + bondCount;
  const positions = C60_HERO.positions;
  const bonds = C60_HERO.bonds;
  const radius = C60_HERO.radius;
  const scale = (CENTER * FILL) / (radius + ATOM_R);
  const gradientId = `lupi-bucky-ink-${(stageSerial += 1)}`;

  // ── DOM ───────────────────────────────────────────────────────────
  const root = svg('svg', {
    viewBox: `0 0 ${VIEW} ${VIEW}`,
    width: '100%',
    height: '100%',
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'bucky-stage',
  });
  root.style.display = 'block';
  root.style.pointerEvents = 'none';
  root.style.overflow = 'visible';
  const defs = svg('defs', {});
  const gradient = svg('radialGradient', { id: gradientId, cx: '0.5', cy: '0.5', r: '0.5', fx: '0.4', fy: '0.35' });
  for (const [offset, color] of [
    ['0', '#f3f5ef'],
    ['0.2', '#c3c7c3'],
    ['0.58', CARBON],
    ['1', '#3d4644'],
  ] as const) {
    gradient.appendChild(svg('stop', { offset, 'stop-color': color }));
  }
  defs.appendChild(gradient);
  root.appendChild(defs);
  const layer = svg('g', {
    stroke: '#a3aaa6',
    'stroke-linecap': 'round',
    'stroke-width': (BOND_W * scale).toFixed(2),
  });
  root.appendChild(layer);

  const circles: SVGCircleElement[] = [];
  const lines: SVGLineElement[] = [];
  /** Items 0..atomCount-1 are the circles, the rest the lines. */
  const items: SVGElement[] = [];
  for (let i = 0; i < atomCount; i += 1) {
    const circle = svg('circle', { fill: `url(#${gradientId})`, stroke: PLATE, 'stroke-width': '0.6' });
    circles.push(circle);
    items.push(circle);
  }
  for (let b = 0; b < bondCount; b += 1) {
    const line = svg('line', {});
    lines.push(line);
    items.push(line);
  }

  // ── Projection scratch (no per-frame allocation) ──────────────────
  const sx = new Float64Array(atomCount);
  const sy = new Float64Array(atomCount);
  const sz = new Float64Array(atomCount);
  const depth = new Float64Array(itemCount);
  const order: number[] = [];
  for (let i = 0; i < itemCount; i += 1) order.push(i);
  const shown = new Int16Array(itemCount).fill(-1);
  const byDepth = (a: number, b: number) => depth[a] - depth[b];

  // ── Pose and motion ───────────────────────────────────────────────
  const initial = opts.pose ?? { azimuth: C60_HERO.openingAzimuth, elevation: C60_HERO.openingElevation };
  let az = initial.azimuth;
  let el = initial.elevation;
  let state: BuckyStageState = 'rest';
  const azSpring = createSpring1(az);
  const elSpring = createSpring1(el);
  let targetAz = az;
  let targetEl = el;
  let targetLabel: string | null = null;
  let coastTau = COAST_PROJECT_S;
  let spun = 0;
  let frame = 0;
  let lastTime = 0;
  let destroyed = false;

  function setState(next: BuckyStageState): void {
    state = next;
    host.dataset.buckyState = next;
  }

  function draw(): void {
    const sa = Math.sin(az);
    const ca = Math.cos(az);
    const se = Math.sin(el);
    const ce = Math.cos(el);
    // The camera basis of lookAt(viewDir, up +Y): right (x), up (y), and viewDir (z, toward the camera).
    const xx = ca;
    const xz = -sa;
    const yx = -se * sa;
    const yy = ce;
    const yz = -se * ca;
    const zx = ce * sa;
    const zy = se;
    const zz = ce * ca;
    for (let i = 0; i < atomCount; i += 1) {
      const px = positions[3 * i];
      const py = positions[3 * i + 1];
      const pz = positions[3 * i + 2];
      sx[i] = CENTER + scale * (px * xx + pz * xz);
      sy[i] = CENTER - scale * (px * yx + py * yy + pz * yz);
      sz[i] = px * zx + py * zy + pz * zz;
    }
    const span = 2 * radius;
    for (let i = 0; i < atomCount; i += 1) {
      const near = (sz[i] + radius) / span; // 0 at the back, 1 at the front
      depth[i] = sz[i];
      const circle = circles[i];
      circle.setAttribute('cx', sx[i].toFixed(2));
      circle.setAttribute('cy', sy[i].toFixed(2));
      circle.setAttribute('r', (scale * ATOM_R * (0.88 + 0.2 * near)).toFixed(2));
      circle.setAttribute('opacity', (0.3 + 0.7 * near).toFixed(3));
    }
    for (let b = 0; b < bondCount; b += 1) {
      const i = bonds[2 * b];
      const j = bonds[2 * b + 1];
      const mid = (sz[i] + sz[j]) / 2;
      depth[atomCount + b] = mid - BOND_DEPTH_BIAS;
      const line = lines[b];
      line.setAttribute('x1', sx[i].toFixed(2));
      line.setAttribute('y1', sy[i].toFixed(2));
      line.setAttribute('x2', sx[j].toFixed(2));
      line.setAttribute('y2', sy[j].toFixed(2));
      line.setAttribute('stroke-opacity', (0.16 + 0.7 * ((mid + radius) / span)).toFixed(3));
    }
    // The key light on screen: the highlight slides as the ball turns under it.
    const lx = KEY_LIGHT[0] * xx + KEY_LIGHT[2] * xz;
    const ly = KEY_LIGHT[0] * yx + KEY_LIGHT[1] * yy + KEY_LIGHT[2] * yz;
    gradient.setAttribute('fx', (0.5 + 0.3 * lx).toFixed(3));
    gradient.setAttribute('fy', (0.5 - 0.3 * ly).toFixed(3));
    // Painter's order, back to front; the DOM is touched only when it changed.
    order.sort(byDepth);
    let changed = false;
    for (let k = 0; k < itemCount; k += 1) {
      if (shown[k] !== order[k]) {
        changed = true;
        break;
      }
    }
    if (changed) {
      for (let k = 0; k < itemCount; k += 1) {
        shown[k] = order[k];
        layer.appendChild(items[order[k]]);
      }
    }
    opts.onPoseChange?.();
  }

  function schedule(): void {
    if (!frame && !destroyed) frame = requestAnimationFrame(tick);
  }

  function stop(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }

  function moving(): boolean {
    return state === 'coast' || state === 'approach' || state === 'click';
  }

  function reportSpin(delta: number): void {
    if (delta === 0) return;
    spun += Math.abs(delta);
    opts.onSpinDegrees?.((spun * 180) / Math.PI);
  }

  function land(announce: boolean): void {
    az = targetAz;
    el = targetEl;
    azSpring.velocity = 0;
    elSpring.velocity = 0;
    setState('rest');
    if (targetLabel) host.dataset.buckyDetent = targetLabel;
    draw();
    if (announce && targetLabel) opts.onDetent?.(targetLabel);
  }

  function advance(dt: number): void {
    if (state === 'coast') {
      const remaining = (targetAz - az) * Math.exp(-dt / coastTau);
      az = targetAz - remaining;
      azSpring.value = az;
      azSpring.velocity = remaining / coastTau;
      if (Math.abs(remaining) < CLICK_ZONE) setState('click');
    } else if (state === 'approach') {
      springTo(azSpring, targetAz, MOTION.settle, dt);
      az = azSpring.value;
      if (Math.abs(targetAz - az) < CLICK_ZONE) setState('click');
    } else if (state === 'click') {
      springTo(azSpring, targetAz, MOTION.click, dt);
      az = azSpring.value;
    }
    // The face's own elevation: a small nod that seats it exactly face-on.
    springTo(elSpring, targetEl, MOTION.glide, dt);
    el = elSpring.value;
  }

  function tick(now: number): void {
    frame = 0;
    if (destroyed) return;
    if (!moving()) {
      lastTime = 0;
      draw(); // a drag's pending frame
      return;
    }
    const dt = lastTime ? Math.min(0.1, Math.max(0, (now - lastTime) / 1000)) : 1 / 60;
    lastTime = now;
    advance(dt);
    if (
      state === 'click' &&
      isSettled(az, azSpring.velocity, targetAz, LAND_EPS, LAND_VEL_EPS) &&
      isSettled(el, elSpring.velocity, targetEl, LAND_EPS, LAND_VEL_EPS)
    ) {
      lastTime = 0;
      land(true);
      return;
    }
    draw();
    schedule();
  }

  /** Head for `target` from the current pose, leaving with azimuth velocity `omega` (rad/s). */
  function glideTo(target: DetentTarget, omega: number): void {
    targetAz = target.azimuth;
    targetEl = target.detent.elevation;
    targetLabel = target.detent.label;
    const distance = targetAz - az;
    if (Math.abs(distance) < SETTLE_EPS && Math.abs(targetEl - el) < SETTLE_EPS && Math.abs(omega) < SETTLE_VEL_EPS) {
      stop();
      land(false); // already there (a scroll that began on the ball): nothing to announce
      return;
    }
    delete host.dataset.buckyDetent;
    if (getComfort() === 'still') {
      stop();
      land(true);
      return;
    }
    azSpring.value = az;
    azSpring.velocity = omega;
    elSpring.value = el;
    const tau = omega !== 0 ? distance / omega : 0;
    if (Math.abs(distance) < CLICK_ZONE) {
      setState('click');
    } else if (Math.abs(omega) >= COAST_MIN_OMEGA && tau >= COAST_TAU_MIN && tau <= COAST_TAU_MAX) {
      // A friction coast (velocity decaying as e^(−t/τ)) that comes to rest exactly on the face.
      coastTau = tau;
      setState('coast');
    } else {
      setState('approach');
    }
    schedule();
  }

  /** The end of a drag (or a catch) with azimuth velocity `omega`. */
  function release(omega: number): void {
    const v = coastEnabled() ? Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, omega)) : 0;
    glideTo(nearestDetent(az + v * COAST_PROJECT_S), v);
  }

  function hop(dir: 1 | -1): void {
    const wasMoving = moving();
    glideTo(nextDetent(wasMoving ? targetAz : az, dir), wasMoving ? azSpring.velocity : 0);
  }

  // ── Pointer ───────────────────────────────────────────────────────
  let pointerId: number | null = null;
  let pointerType = 'mouse';
  /** press: under the tap slop; drag: turning the ball; scroll: a touch the browser is scrolling with. */
  let pressing: 'press' | 'drag' | 'scroll' | null = null;
  let caught = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let gain = Math.PI / Math.max(1, opts.size);
  const sampleT = new Float64Array(SAMPLE_COUNT);
  const sampleA = new Float64Array(SAMPLE_COUNT);
  let sampleHead = -1;
  let sampleLength = 0;

  function pushSample(t: number, a: number): void {
    sampleHead = (sampleHead + 1) % SAMPLE_COUNT;
    sampleT[sampleHead] = t;
    sampleA[sampleHead] = a;
    sampleLength = Math.min(SAMPLE_COUNT, sampleLength + 1);
  }

  /** Azimuth velocity over the last VELOCITY_WINDOW_MS of input (event.timeStamp); 0 when held still. */
  function sampledOmega(now: number): number {
    if (sampleLength < 2) return 0;
    const lastT = sampleT[sampleHead];
    if (now - lastT > HELD_STILL_MS) return 0;
    let oldest = sampleHead;
    for (let k = 1; k < sampleLength; k += 1) {
      const index = (sampleHead - k + SAMPLE_COUNT) % SAMPLE_COUNT;
      oldest = index;
      if (lastT - sampleT[index] >= VELOCITY_WINDOW_MS) break;
    }
    const seconds = (lastT - sampleT[oldest]) / 1000;
    if (seconds < 0.004) return 0;
    return (sampleA[sampleHead] - sampleA[oldest]) / seconds;
  }

  function onPointerDown(event: PointerEvent): void {
    if (pointerId !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType !== 'mouse' && event.clientX < EDGE_GUARD_PX) return;
    pointerId = event.pointerId;
    pointerType = event.pointerType;
    pressing = 'press';
    startX = lastX = event.clientX;
    startY = event.clientY;
    caught = moving();
    if (caught) {
      // A press on a moving ball stops it dead where it is.
      stop();
      azSpring.velocity = 0;
      elSpring.velocity = 0;
      setState('rest');
    }
    const width = host.getBoundingClientRect().width;
    gain = Math.PI / Math.max(1, width || opts.size);
    sampleLength = 0;
    pushSample(event.timeStamp, az);
    try {
      host.setPointerCapture(event.pointerId);
    } catch {
      /* the pointer is already gone */
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId || !pressing || pressing === 'scroll') return;
    if (pressing === 'press') {
      const dx = Math.abs(event.clientX - startX);
      const dy = Math.abs(event.clientY - startY);
      if (pointerType === 'mouse') {
        if (Math.hypot(dx, dy) <= TAP_SLOP_MOUSE) return;
      } else if (dx <= TAP_SLOP_TOUCH) {
        // Vertical travel is the page's (touch-action: pan-y); it is no longer a tap.
        if (dy > TAP_SLOP_TOUCH) pressing = 'scroll';
        return;
      }
      pressing = 'drag';
      setState('drag');
      delete host.dataset.buckyDetent;
    }
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    if (dx !== 0) {
      const delta = -dx * gain;
      az += delta;
      reportSpin(delta);
      schedule();
    }
    pushSample(event.timeStamp, az);
  }

  function endPointer(event: PointerEvent, cancelled: boolean): void {
    if (event.pointerId !== pointerId) return;
    const was = pressing;
    pointerId = null;
    pressing = null;
    try {
      if (host.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    if (was === 'drag') {
      release(cancelled ? 0 : sampledOmega(event.timeStamp));
    } else if (caught) {
      release(0); // a catch settles onto the nearest face; it does not open the viewer
    } else if (was === 'press' && !cancelled) {
      opts.onTap?.();
    }
    caught = false;
  }

  const onPointerUp = (event: PointerEvent) => endPointer(event, false);
  const onPointerCancel = (event: PointerEvent) => endPointer(event, true);
  const onLostCapture = (event: PointerEvent) => {
    if (event.pointerId === pointerId) endPointer(event, true);
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      // → turns the ball the way a rightward drag does (camera azimuth down).
      hop(event.key === 'ArrowRight' ? -1 : 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) opts.onTap?.();
    }
  }

  // ── Mount ─────────────────────────────────────────────────────────
  host.appendChild(root);
  setState('rest');
  const opening = nearestDetent(az);
  if (Math.abs(opening.azimuth - az) < SETTLE_EPS && Math.abs(opening.detent.elevation - el) < SETTLE_EPS) {
    host.dataset.buckyDetent = opening.detent.label;
  }
  draw();
  if (opts.interactive) {
    host.style.touchAction = 'pan-y';
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerCancel);
    host.addEventListener('lostpointercapture', onLostCapture);
    host.addEventListener('keydown', onKeyDown);
  }

  return {
    setPose(next) {
      stop();
      pointerId = null;
      pressing = null;
      caught = false;
      az = next.azimuth;
      el = next.elevation;
      azSpring.velocity = 0;
      elSpring.velocity = 0;
      delete host.dataset.buckyDetent;
      setState('rest');
      draw();
    },
    getPose() {
      return { azimuth: wrapAngle(az), elevation: el };
    },
    getBodyOmegaY() {
      if (state === 'drag') return -sampledOmega(performance.now());
      return moving() ? -azSpring.velocity : 0;
    },
    viewDir() {
      const c = Math.cos(el);
      return [c * Math.sin(az), Math.sin(el), c * Math.cos(az)];
    },
    destroy() {
      destroyed = true;
      stop();
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerCancel);
      host.removeEventListener('lostpointercapture', onLostCapture);
      host.removeEventListener('keydown', onKeyDown);
      root.remove();
      delete host.dataset.buckyState;
      delete host.dataset.buckyDetent;
    },
  };
}
