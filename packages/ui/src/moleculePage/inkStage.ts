/**
 * inkStage.ts — the spinnable ink drawing on a molecule page (/m/<id>).
 *
 * The home hero's stage (landing/hero/buckyStage.ts) generalised to any small
 * molecule: one <svg> of ink lines and CPK-lit circles laid out by ink.ts,
 * projected from a camera at (azimuth, elevation) about world +Y, the viewer's
 * own convention, so the pose carries into 3D.
 *
 * Nothing moves until it is touched: requestAnimationFrame runs only while a
 * drag is drawing or a release is settling. A drag turns it 1:1; a release
 * coasts on the flick's speed and clicks onto the nearest turntable detent
 * (a ring or plane face-on, or a principal axis, from Object Facts at build
 * time), then names it. A press on a moving drawing catches it. Under the
 * Still comfort level it cuts straight to the detent; with coasting off
 * (Gentle) it settles without a throw. A molecule with no detents on its
 * turntable coasts to rest wherever friction leaves it.
 *
 * Imports only `math`, `@atlas/core/motion` and ink.ts: no three, no React.
 * The comfort level is passed in, so the page can read the viewer's setting
 * without the app's store.
 */
import { wrapAngle } from 'math';
import { MOTION, createSpring1, isSettled, springTo } from '@atlas/core/motion';
import { INK_PLATE, INK_BOND, INK_VIEW, InkLayout, inkGradientStops, type InkDetent, type InkModel, type InkPose } from './ink';

export type InkComfort = 'standard' | 'gentle' | 'still';

export interface InkStage {
  setPose(pose: InkPose): void;
  /** Turn dragging, keys and taps on or off (the drawing stays where it is). */
  setInteractive(on: boolean): void;
  /** Paint the current pose again (after the painter changed what it shows). */
  redraw(): void;
  getPose(): InkPose;
  /** The molecule's apparent spin about world +Y (rad/s). */
  getBodyOmegaY(): number;
  /** Unit direction from the target to the camera, normalize(position − target). */
  viewDir(): [number, number, number];
  /** Step to the next detent (+1: the way a leftward drag turns it). */
  hop(dir: 1 | -1): void;
  destroy(): void;
}

/**
 * What the stage paints with. The stage owns the pose, the motion and the
 * pointer; a painter owns the nodes. The default is the lit ink drawing
 * (createLitInkPainter); the Daily paints silhouettes and outlines with the
 * same motion.
 */
export interface InkPainter {
  /** The node mounted in the host; pointer events pass through it to the host. */
  readonly root: SVGElement | HTMLElement;
  /** Paint `layout`, already laid out for the stage's pose. */
  draw(layout: InkLayout): void;
}

export interface InkStageOptions {
  model: InkModel;
  pose?: InkPose;
  interactive: boolean;
  /** Prefix for gradient ids (unique per document). */
  idPrefix: string;
  /** Paints the drawing; the lit ink drawing when omitted. */
  painter?: InkPainter;
  comfort?: () => InkComfort;
  onTap?(): void;
  /** The drawing came to rest on a detent. */
  onDetent?(label: string): void;
  /** Total degrees turned by hand so far. */
  onSpinDegrees?(total: number): void;
  onPoseChange?(): void;
}

export type InkStageState = 'rest' | 'drag' | 'coast' | 'approach' | 'click';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COAST_PROJECT_S = 0.35;
const COAST_MIN_OMEGA = 0.8;
const COAST_TAU_MIN = 0.08;
const COAST_TAU_MAX = 1.1;
/** Without detents a throw decays with this time constant and simply stops. */
const FREE_COAST_TAU = 0.45;
const CLICK_ZONE = (6 * Math.PI) / 180;
const VELOCITY_WINDOW_MS = 80;
const HELD_STILL_MS = 60;
const MAX_OMEGA = 40;
const SETTLE_EPS = 1e-4;
const SETTLE_VEL_EPS = 5e-3;
const LAND_EPS = 1.7e-3;
const LAND_VEL_EPS = 0.02;
const FREE_STOP_OMEGA = 0.01;
const TAP_SLOP_TOUCH = 8;
const TAP_SLOP_MOUSE = 3;
const EDGE_GUARD_PX = 24;
const HOP_MIN = (1 * Math.PI) / 180;
/** Arrow keys turn a molecule with no detents by this much. */
const FREE_HOP = Math.PI / 6;
const TWO_PI = Math.PI * 2;
const SAMPLE_COUNT = 16;

interface DetentTarget {
  detent: InkDetent | null;
  azimuth: number;
  elevation: number;
}

function unwrapNear(azimuth: number, near: number): number {
  return azimuth + TWO_PI * Math.round((near - azimuth) / TWO_PI);
}

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

export function createInkStage(host: HTMLElement, opts: InkStageOptions): InkStage {
  const model = opts.model;
  const layout = new InkLayout(model);
  const detents: InkDetent[] = [...model.detents].sort((a, b) => a.azimuth - b.azimuth);
  const comfort = opts.comfort ?? (() => 'standard' as InkComfort);
  const coastEnabled = () => comfort() === 'standard';

  function nearestDetent(azimuth: number, elevation: number): DetentTarget {
    if (detents.length === 0) return { detent: null, azimuth, elevation };
    let best = detents[0];
    let bestAz = unwrapNear(best.azimuth, azimuth);
    for (let i = 1; i < detents.length; i += 1) {
      const candidate = unwrapNear(detents[i].azimuth, azimuth);
      if (Math.abs(candidate - azimuth) < Math.abs(bestAz - azimuth)) {
        best = detents[i];
        bestAz = candidate;
      }
    }
    return { detent: best, azimuth: bestAz, elevation: best.elevation };
  }

  function nextDetent(from: number, dir: 1 | -1, elevation: number): DetentTarget {
    if (detents.length === 0) return { detent: null, azimuth: from + dir * FREE_HOP, elevation };
    let best = detents[0];
    let bestStep = Infinity;
    for (const detent of detents) {
      let step = ((detent.azimuth - from) * dir) % TWO_PI;
      if (step < 0) step += TWO_PI;
      if (step <= HOP_MIN) step += TWO_PI;
      if (step < bestStep) {
        bestStep = step;
        best = detent;
      }
    }
    return { detent: best, azimuth: from + dir * bestStep, elevation: best.elevation };
  }

  // ── DOM ───────────────────────────────────────────────────────────
  const painter = opts.painter ?? createLitInkPainter(model, opts.idPrefix);
  const root = painter.root;
  root.style.display = 'block';
  root.style.pointerEvents = 'none';
  root.style.overflow = 'visible';

  // ── Pose and motion ───────────────────────────────────────────────
  const initial = opts.pose ?? model.opening;
  let az = initial.azimuth;
  let el = initial.elevation;
  let state: InkStageState = 'rest';
  const azSpring = createSpring1(az);
  const elSpring = createSpring1(el);
  let targetAz = az;
  let targetEl = el;
  let targetLabel: string | null = null;
  let coastTau = COAST_PROJECT_S;
  let freeCoast = false;
  let spun = 0;
  let frame = 0;
  let lastTime = 0;
  let destroyed = false;

  function setState(next: InkStageState): void {
    state = next;
    host.dataset.inkState = next;
  }

  function draw(): void {
    layout.update({ azimuth: az, elevation: el });
    painter.draw(layout);
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
    if (targetLabel) host.dataset.inkDetent = targetLabel;
    draw();
    if (announce && targetLabel) opts.onDetent?.(targetLabel);
  }

  function advance(dt: number): void {
    if (state === 'coast') {
      const remaining = (targetAz - az) * Math.exp(-dt / coastTau);
      az = targetAz - remaining;
      azSpring.value = az;
      azSpring.velocity = remaining / coastTau;
      if (!freeCoast && Math.abs(remaining) < CLICK_ZONE) setState('click');
    } else if (state === 'approach') {
      springTo(azSpring, targetAz, MOTION.settle, dt);
      az = azSpring.value;
      if (Math.abs(targetAz - az) < CLICK_ZONE) setState('click');
    } else if (state === 'click') {
      springTo(azSpring, targetAz, MOTION.click, dt);
      az = azSpring.value;
    }
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
    if (freeCoast && state === 'coast') {
      if (Math.abs(azSpring.velocity) < FREE_STOP_OMEGA && isSettled(el, elSpring.velocity, targetEl, LAND_EPS, LAND_VEL_EPS)) {
        lastTime = 0;
        targetAz = az;
        land(false);
        return;
      }
    } else if (
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
    targetEl = target.elevation;
    targetLabel = target.detent?.label ?? null;
    freeCoast = target.detent === null;
    const distance = targetAz - az;
    if (Math.abs(distance) < SETTLE_EPS && Math.abs(targetEl - el) < SETTLE_EPS && Math.abs(omega) < SETTLE_VEL_EPS) {
      stop();
      land(false);
      return;
    }
    delete host.dataset.inkDetent;
    if (comfort() === 'still') {
      stop();
      land(true);
      return;
    }
    azSpring.value = az;
    azSpring.velocity = omega;
    elSpring.value = el;
    if (freeCoast) {
      coastTau = FREE_COAST_TAU;
      setState('coast');
      schedule();
      return;
    }
    const tau = omega !== 0 ? distance / omega : 0;
    if (Math.abs(distance) < CLICK_ZONE) {
      setState('click');
    } else if (Math.abs(omega) >= COAST_MIN_OMEGA && tau >= COAST_TAU_MIN && tau <= COAST_TAU_MAX) {
      coastTau = tau;
      setState('coast');
    } else {
      setState('approach');
    }
    schedule();
  }

  function release(omega: number): void {
    const v = coastEnabled() ? Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, omega)) : 0;
    if (detents.length === 0) {
      if (v === 0) {
        setState('rest');
        draw();
        return;
      }
      // A friction coast that stops where it stops (Still never throws: v is 0 there).
      glideTo({ detent: null, azimuth: az + v * FREE_COAST_TAU, elevation: el }, v);
      return;
    }
    glideTo(nearestDetent(az + v * COAST_PROJECT_S, el), v);
  }

  function hop(dir: 1 | -1): void {
    const wasMoving = moving();
    const from = wasMoving ? targetAz : az;
    const target = nextDetent(from, dir, el);
    if (target.detent === null) {
      // No detents: a fixed turn, settled by the click spring.
      targetAz = target.azimuth;
      targetEl = el;
      targetLabel = null;
      freeCoast = false;
      if (comfort() === 'still') {
        stop();
        land(false);
        return;
      }
      azSpring.value = az;
      azSpring.velocity = wasMoving ? azSpring.velocity : 0;
      setState('approach');
      schedule();
      return;
    }
    glideTo(target, wasMoving ? azSpring.velocity : 0);
  }

  // ── Pointer ───────────────────────────────────────────────────────
  let pointerId: number | null = null;
  let pointerType = 'mouse';
  let pressing: 'press' | 'drag' | 'scroll' | null = null;
  let caught = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let gain = Math.PI / 300;
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
      stop();
      azSpring.velocity = 0;
      elSpring.velocity = 0;
      setState('rest');
    }
    const width = host.getBoundingClientRect().width;
    gain = Math.PI / Math.max(1, width || 300);
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
        if (dy > TAP_SLOP_TOUCH) pressing = 'scroll';
        return;
      }
      pressing = 'drag';
      setState('drag');
      delete host.dataset.inkDetent;
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
      release(0);
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
      hop(event.key === 'ArrowRight' ? -1 : 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) opts.onTap?.();
    }
  }

  // ── Mount ─────────────────────────────────────────────────────────
  host.replaceChildren(root);
  setState('rest');
  const opening = nearestDetent(az, el);
  if (opening.detent && Math.abs(opening.azimuth - az) < SETTLE_EPS && Math.abs(opening.elevation - el) < SETTLE_EPS) {
    host.dataset.inkDetent = opening.detent.label;
  }
  draw();
  let listening = false;
  function setInteractive(on: boolean): void {
    if (on === listening || destroyed) return;
    listening = on;
    if (on) {
      host.style.touchAction = 'pan-y';
      host.addEventListener('pointerdown', onPointerDown);
      host.addEventListener('pointermove', onPointerMove);
      host.addEventListener('pointerup', onPointerUp);
      host.addEventListener('pointercancel', onPointerCancel);
      host.addEventListener('lostpointercapture', onLostCapture);
      host.addEventListener('keydown', onKeyDown);
      return;
    }
    if (pointerId !== null) {
      try {
        if (host.hasPointerCapture?.(pointerId)) host.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
    }
    pointerId = null;
    pressing = null;
    caught = false;
    host.removeEventListener('pointerdown', onPointerDown);
    host.removeEventListener('pointermove', onPointerMove);
    host.removeEventListener('pointerup', onPointerUp);
    host.removeEventListener('pointercancel', onPointerCancel);
    host.removeEventListener('lostpointercapture', onLostCapture);
    host.removeEventListener('keydown', onKeyDown);
  }
  setInteractive(opts.interactive);

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
      delete host.dataset.inkDetent;
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
    hop,
    setInteractive,
    redraw() {
      if (!destroyed) draw();
    },
    destroy() {
      setInteractive(false);
      destroyed = true;
      stop();
      root.remove();
      delete host.dataset.inkState;
      delete host.dataset.inkDetent;
    },
  };
}

/**
 * The lit ink drawing: CPK circles shaded by one radial gradient per element,
 * ink bond lines, painted back to front (the /m pages and the home hero's
 * look). Nodes are made once; a draw only moves them, and reorders the DOM
 * only when the painter's order changed.
 */
export function createLitInkPainter(model: InkModel, idPrefix: string, opts: { rim?: string } = {}): InkPainter {
  const atomCount = model.k.length;
  const bondCount = model.b.length / 2;
  const itemCount = atomCount + bondCount;
  const rim = opts.rim ?? INK_PLATE;
  const root = svg('svg', {
    viewBox: `0 0 ${INK_VIEW} ${INK_VIEW}`,
    width: '100%',
    height: '100%',
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'ink-stage',
  });
  const defs = svg('defs', {});
  const gradients: SVGRadialGradientElement[] = [];
  for (const kind of model.kinds) {
    const gradient = svg('radialGradient', { id: `${idPrefix}-${kind.s}`, cx: '0.5', cy: '0.5', r: '0.5', fx: '0.4', fy: '0.35' });
    for (const [offset, color] of inkGradientStops(kind.c)) gradient.appendChild(svg('stop', { offset, 'stop-color': color }));
    gradients.push(gradient);
    defs.appendChild(gradient);
  }
  root.appendChild(defs);
  const group = svg('g', { stroke: INK_BOND, 'stroke-linecap': 'round' });
  root.appendChild(group);

  const items: SVGElement[] = [];
  const circles: SVGCircleElement[] = [];
  const lines: SVGLineElement[] = [];
  for (let i = 0; i < atomCount; i += 1) {
    const kind = model.kinds[model.k[i]];
    const circle = svg('circle', { fill: `url(#${idPrefix}-${kind.s})`, stroke: rim, 'stroke-width': '0.6' });
    circles.push(circle);
    items.push(circle);
  }
  for (let b = 0; b < bondCount; b += 1) {
    const line = svg('line', {});
    lines.push(line);
    items.push(line);
  }
  const shown = new Int32Array(itemCount).fill(-1);
  let widthSet = false;

  return {
    root,
    draw(layout) {
      if (!widthSet) {
        group.setAttribute('stroke-width', layout.bondWidth.toFixed(2));
        widthSet = true;
      }
      for (let i = 0; i < atomCount; i += 1) {
        const circle = circles[i];
        circle.setAttribute('cx', layout.cx[i].toFixed(2));
        circle.setAttribute('cy', layout.cy[i].toFixed(2));
        circle.setAttribute('r', layout.r[i].toFixed(2));
        circle.setAttribute('opacity', layout.opacity[i].toFixed(3));
      }
      for (let b = 0; b < bondCount; b += 1) {
        const line = lines[b];
        line.setAttribute('x1', layout.x1[b].toFixed(2));
        line.setAttribute('y1', layout.y1[b].toFixed(2));
        line.setAttribute('x2', layout.x2[b].toFixed(2));
        line.setAttribute('y2', layout.y2[b].toFixed(2));
        line.setAttribute('stroke-opacity', layout.bondOpacity[b].toFixed(3));
      }
      const fx = layout.lightX.toFixed(3);
      const fy = layout.lightY.toFixed(3);
      for (const gradient of gradients) {
        gradient.setAttribute('fx', fx);
        gradient.setAttribute('fy', fy);
      }
      reorder(group, items, shown, layout.order);
    },
  };
}

/** Painter's order, back to front; the DOM is touched only when it changed. */
export function reorder(group: SVGElement, items: SVGElement[], shown: Int32Array, order: number[]): void {
  let changed = false;
  for (let k = 0; k < order.length; k += 1) {
    if (shown[k] !== order[k]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  for (let k = 0; k < order.length; k += 1) {
    shown[k] = order[k];
    group.appendChild(items[order[k]]);
  }
}
