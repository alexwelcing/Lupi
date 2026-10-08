/**
 * PlayLayer — the display-motion driver inside the Canvas: the arrival (a
 * first open condenses out of a seeded mist, or the hero's flat drawing
 * inflates; a switch from another molecule morphs: its atoms flow into the
 * new one), the poke ripple, stirring with Poke, Scatter, and the latched
 * verbs Tug (drag an atom; its neighbourhood follows on springs and twangs
 * home), Burst (a tap pops the atoms outward and they spring back) and Heat
 * (hold to jiggle; the jiggle grows with hold time and cools on release).
 *
 * It only writes the shared uniforms of `@atlas/scene`'s displayMotion (one
 * write moves every atom and bond material) and `playStore.displaced`. It
 * never touches `frame.positions`, the viewer store, URLs, saved views or MCP
 * state, and every capture render sees the motion at zero (displayMotion's
 * capture guard; the recording guard below suspends it for video).
 *
 * - One job in `lupi-uniforms` advances `uMotionNow`, ends each effect at its
 *   analytic end with its weight set to exactly 0, and sets the master weight
 *   to 0 when nothing is live (the materials' `If` gate then skips it all).
 * - The arrival is armed in a layout effect on the file (before the first
 *   render): `t0` follows the clock, so the first frame already shows the
 *   mist. It releases on the file's first frame (+120 ms behind the relay
 *   stage), or 4.5 s after arming.
 * - Any pointerdown, key or wheel lands the arrival instantly, synchronously
 *   in the capture phase, before any pick (`installArrivalCancel`).
 * - The morph: every drawn frame remembers what the screen showed (the
 *   molecule, whether it was whole, the camera). When a switch brings another
 *   molecule (both at most 20,000 atoms, not MCP, not a relay hand-off, not
 *   Still), the arrival is a morph: on the new file's first frame the plan
 *   (morphMatch.ts) gives each new atom a start where a matched old atom was
 *   on screen, and the atoms fly home on the arrival's clock. Until it is
 *   released the start frame follows the live camera, so the old shape stays
 *   where the screen showed it.
 *
 * It also installs `window.__lupiPlay` (ref-counted; the canvas's
 * FrameDemandDriver installs it too) and registers the `motion`, `poke` and
 * `scatter` dev hooks. `reset` keeps the
 * default (it emits `play.reset`, which this layer and every other toy hear).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import { resolveAtomicNumber } from '@atlas/core';
import { MOTION, type MotionToken } from '@atlas/core/motion';
import {
  ARRIVAL_MODE,
  ATOM_GLOW,
  BURST_SLOTS,
  DISPLAY_MOTION,
  DISPLAY_MOTION_TUNING,
  LUPI_JOB,
  LUPI_PHASE,
  RIPPLE_SLOTS,
  burstPeak,
  burstSlotUniforms,
  isDisplayMotionSuspended,
  keepLupiAwake,
  onIntent,
  pickAtomAtClient,
  registerRecordingGuard,
  requestLupiFrames,
  resetLupiDisplayMotion,
  rippleSlotUniforms,
  setDisplayMorph,
  setDisplayMotionSuspended,
} from '@atlas/scene';
import { useStore } from '../store';
import type { Vec3 } from '../camera/rigApi';
import { displayMotionScale, getComfort, subscribeComfort, type Comfort } from '../motion/comfort';
import { isRelayActive, peekBaton } from '../relay/baton';
import { mcpActiveWithin } from '../mcp/activity';
import { hasFirstFrame, onFirstFrame } from '../relay/firstFrame';
import { cue } from './feedback';
import { installPlayDevHooks, registerPlayDevHook } from './devHooks';
import { heatKelvin, playStore } from './playStore';
import { emitToyEvent, registerToyReplaySink, type ToyEvent } from './toyTape';
import {
  canPlayScatter,
  markArrivalSeen,
  readSeenArrivals,
  shouldPlayArrival,
  type ArrivalRuleInput,
} from './arrivalRules';
import {
  morphFrame,
  planMorph,
  shouldMorph,
  type MorphPlan,
  type MorphReport,
  type MorphVec3,
  type MorphView,
} from './morphMatch';

export interface PlayLayerProps {
  frame: Frame;
  center: Vec3;
  transmissionActive: boolean;
  playing: boolean;
}

type LiveMode =
  | typeof ARRIVAL_MODE.condense
  | typeof ARRIVAL_MODE.flat
  | typeof ARRIVAL_MODE.scatter
  | typeof ARRIVAL_MODE.morph;

/** Arrival duration D (s) at Standard and Gentle. */
const ARRIVAL_D = { standard: 0.6, gentle: 0.3 } as const;
/**
 * The morph: D (s) and spring at Standard (the settle token, critically
 * damped: it leaves softly and glides home) and Gentle (half the travel on
 * the glide token, half the stagger). The stagger (morphMatch.ts) fits inside
 * D, so every atom is home before the end fade.
 */
const MORPH_D = { standard: 0.9, gentle: 0.55 } as const;
/** Behind the relay stage the release waits for its hand-off fade. */
const RELAY_RELEASE_MS = 120;
/**
 * The release fallback when no first frame is reported. Until the first-frame
 * mark a plate covers the canvas (the relay stage, or FirstFrameOverlay on a
 * fresh canvas), and the mark can wait for the bonds, so an earlier release
 * would play the arrival unseen. FirstFrameSignal marks within 4 s anyway.
 */
const RELEASE_FALLBACK_MS = 4500;
/** Poke ripple amplitude at Standard (Å); Gentle halves it, Still skips it. */
const POKE_AMPLITUDE = DISPLAY_MOTION_TUNING.rippleAmplitude;
/** Stirring (Poke latched): amplitude, and at most one ripple per 60 ms and 10 px. */
const STROKE_AMPLITUDE = 0.2;
const STROKE_MIN_MS = 60;
const STROKE_MIN_PX = 10;
const MODE_NAMES = ['none', 'condense', 'flat', 'scatter', 'morph'] as const;
/**
 * The motion clock advances by the frame time, capped at 0.1 s: a hitch (a
 * shader compile right after the first frame, a slow device) slows the
 * effect down instead of skipping it. At 10 fps and above it is wall time.
 */
const MAX_STEP_S = 0.1;

/** A length that scales with the molecule radius R, clamped (Å). */
interface RadiusScaled {
  scale: number;
  min: number;
  max: number;
}

function byRadius(rule: RadiusScaled, radius: number): number {
  return Math.min(rule.max, Math.max(rule.min, rule.scale * radius));
}

interface SpringFeel {
  omega: number;
  zeta: number;
}

/**
 * Tug: the grabbed neighbourhood rides a stiff core spring and a softer halo
 * spring; held, they follow the finger with a little lag; released, they
 * swing home past rest (under-damped) and settle. Gentle releases damped.
 */
const TUG = {
  /** Gaussian falloff radius around the grab point. */
  falloff: { scale: 0.42, min: 1.6, max: 6 } as RadiusScaled,
  /** The rubber-band limit: displacement saturates as L·tanh(d / L). */
  limit: { scale: 0.9, min: 2.5, max: 10 } as RadiusScaled,
  held: { core: { omega: 30, zeta: 0.8 }, halo: { omega: 16, zeta: 0.7 } },
  release: { core: { omega: 24, zeta: 0.25 }, halo: { omega: 15, zeta: 0.28 } },
  releaseGentle: { core: { omega: 20, zeta: 0.8 }, halo: { omega: 13, zeta: 0.85 } },
  /** The neighbourhood widens as it stretches: falloff × (1 + widen · stretch / limit). */
  widen: 0.35,
  /** At rest below these (Å, Å/s): the tug ends with its weight exactly 0. */
  restX: 2e-3,
  restV: 2e-2,
  /** Spring integration substep (s). */
  substepS: 1 / 240,
} as const;

/** Burst: amplitude and falloff follow the molecule; a quick pop and a soft spring home. */
const BURST = {
  amplitude: { scale: 0.6, min: 1.5, max: 6 } as RadiusScaled,
  falloff: { scale: 0.8, min: 3, max: 14 } as RadiusScaled,
  omega: 9,
  zeta: 0.42,
  zetaGentle: 0.75,
  /** The summed push is bounded at this multiple of one burst's amplitude. */
  boundScale: 1.6,
} as const;

/**
 * Heat: the level rises toward 1 while held (time constant rampS; rubbing
 * adds rubPerPx per pixel) and cools on release (coolS). The jiggle grows
 * as √level (thermal amplitude goes as √T); the pill reads the level as an
 * illustrative temperature.
 */
const HEAT = {
  amplitude: 0.42,
  rampS: 2.2,
  coolS: 0.55,
  rubPerPx: 0.0011,
  restLevel: 0.003,
  /** The pill's readout updates at most this often (ms). */
  readoutMs: 90,
} as const;

const M = DISPLAY_MOTION;

// ─── The driver (module state: the uniforms are module singletons) ──────

interface LiveArrival {
  mode: LiveMode;
  armed: boolean;
  /** Motion-clock second from which the offset is exactly zero (set on release). */
  end: number;
}

const driver = {
  /** The motion clock (s): advanced per frame while anything is live, 0 while idle. */
  clock: 0,
  /** performance.now() of the last frame job (ms), or -1. */
  lastWall: -1,
  arrival: null as LiveArrival | null,
  /** Motion-clock end of each ripple slot; < 0 is empty. */
  slotEnds: new Array<number>(RIPPLE_SLOTS).fill(-1),
  nextSlot: 0,
  /** Centre and radius (Å) of the scene the effects run in. */
  center: [0, 0, 0] as Vec3,
  radius: 1,
  lastStroke: { t: -Infinity, x: 0, y: 0 },
  /** The morph armed or running, or null. */
  morph: null as MorphRun | null,
};

// ─── The morph arrival ─────────────────────────────────────────────────

/** A molecule as the screen showed it: the morph's source. */
interface ShownMolecule {
  frame: Frame;
  /** Every atom was resident (a streamed file may still be filling in). */
  resident: boolean;
  view: MorphView;
}

interface MorphRun {
  from: ShownMolecule;
  to: Frame;
  center: Vec3;
  /** Planned on the new file's first frame, when the live camera shows the new view. */
  plan: MorphPlan | null;
}

/** What the last drawn frame showed (rewritten every frame). */
let shown: ShownMolecule | null = null;
/** The last switch that morphed: `__lupiPlay.morph()` plays it again. */
let lastMorph: { from: ShownMolecule; to: Frame } | null = null;
/** The last morph's plan report, for `__lupiPlay.state().motion.morph`. */
let lastMorphReport: (MorphReport & { planMs: number }) | null = null;

const axisX = new THREE.Vector3();
const axisY = new THREE.Vector3();
const axisZ = new THREE.Vector3();

/** How `camera` shows a molecule centred at `center` (radius `radius`). */
function viewOf(camera: THREE.Camera, center: Vec3, radius: number): MorphView {
  const q = camera.quaternion;
  axisX.set(1, 0, 0).applyQuaternion(q);
  axisY.set(0, 1, 0).applyQuaternion(q);
  axisZ.set(0, 0, 1).applyQuaternion(q);
  const p = camera.position;
  return {
    eye: [p.x, p.y, p.z],
    right: [axisX.x, axisX.y, axisX.z],
    up: [axisY.x, axisY.y, axisY.z],
    back: [axisZ.x, axisZ.y, axisZ.z],
    perspective: (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true,
    center: [center[0], center[1], center[2]],
    radius,
  };
}

/** Atomic numbers per atom (0 where the frame declares no element). */
function elementsOf(frame: Frame): Uint8Array {
  const out = new Uint8Array(frame.natoms);
  const byType = new Map<number, number>();
  for (let i = 0; i < frame.natoms; i += 1) {
    const type = frame.types[i];
    let z = byType.get(type);
    if (z === undefined) {
      z = resolveAtomicNumber(frame, type) ?? 0;
      byType.set(type, z);
    }
    out[i] = z;
  }
  return out;
}

function setVec(target: THREE.Vector3, v: MorphVec3): void {
  target.set(v[0], v[1], v[2]);
}

/** Put the run's start frame in the new view as `camera` shows it now. */
function writeMorphFrame(run: MorphRun, camera: THREE.Camera): void {
  if (!run.plan) return;
  const frame = morphFrame(viewOf(camera, run.center, driver.radius), run.plan.mode);
  setVec(M.uMorphOrigin.value, frame.origin);
  setVec(M.uMorphAxisX.value, frame.axisX);
  setVec(M.uMorphAxisY.value, frame.axisY);
  setVec(M.uMorphAxisZ.value, frame.axisZ);
}

/** Plan the run's starts with the live camera (the new view) and hand them to the GPU. */
function planRun(run: MorphRun, camera: THREE.Camera): void {
  const started = performance.now();
  const from = run.from;
  const plan = planMorph(
    { positions: from.frame.positions, elements: elementsOf(from.frame), count: from.frame.natoms, view: from.view },
    {
      positions: run.to.positions,
      elements: elementsOf(run.to),
      count: run.to.natoms,
      view: viewOf(camera, run.center, driver.radius),
    },
  );
  if (!plan) {
    cancelArrival();
    return;
  }
  run.plan = plan;
  setDisplayMorph({ positions: run.to.positions, count: run.to.natoms, texels: plan.texels });
  writeMorphFrame(run, camera);
  lastMorphReport = { ...plan.report, planMs: Math.round((performance.now() - started) * 10) / 10 };
}

/** A copy of what the screen shows now (the snapshot is rewritten every frame). */
function copyShown(source: ShownMolecule): ShownMolecule {
  const v = source.view;
  return {
    frame: source.frame,
    resident: source.resident,
    view: {
      ...v,
      eye: [...v.eye] as MorphVec3,
      right: [...v.right] as MorphVec3,
      up: [...v.up] as MorphVec3,
      back: [...v.back] as MorphVec3,
      center: [...v.center] as MorphVec3,
    },
  };
}

type V3 = [number, number, number];

interface Spring3 {
  x: V3;
  v: V3;
}

const tug = {
  /** Displaced: held, or springing home. */
  active: false,
  held: false,
  /** The grabbed atom (it glows while held), or −1 for a point in space. */
  atom: -1,
  grab: [0, 0, 0] as V3,
  falloff: 1.6,
  limit: 3,
  /** Comfort scale captured at the grab (Gentle halves). */
  scale: 1,
  gentle: false,
  /** Where the finger's ray met the grab plane at the start. */
  startHit: new THREE.Vector3(),
  /** The finger's (limited, scaled) displacement: the held springs' target. */
  target: [0, 0, 0] as V3,
  core: { x: [0, 0, 0], v: [0, 0, 0] } as Spring3,
  halo: { x: [0, 0, 0], v: [0, 0, 0] } as Spring3,
};

const bursts = {
  /** Motion-clock end of each burst slot; < 0 is empty. */
  ends: new Array<number>(BURST_SLOTS).fill(-1),
  next: 0,
};

const heat = {
  active: false,
  held: false,
  level: 0,
  /** performance.now() of the last readout published to the pill. */
  readoutAt: -Infinity,
  rub: { x: 0, y: 0, live: false },
  /** The last 300 K step that ticked (0: none yet). */
  tickStep: 0,
};

function motionNow(): number {
  return driver.clock;
}

function rippleLive(): boolean {
  return driver.slotEnds.some((end) => end >= 0);
}

function burstLive(): boolean {
  return bursts.ends.some((end) => end >= 0);
}

/** Anything displaced (or armed): the clock runs and the loop stays awake. */
function anyLive(): boolean {
  return driver.arrival !== null || rippleLive() || tug.active || burstLive() || heat.active;
}

function syncDisplaced(): void {
  const store = playStore.getState();
  const mode = driver.arrival?.mode ?? null;
  store.setDisplaced('arrival', mode === ARRIVAL_MODE.condense || mode === ARRIVAL_MODE.flat || mode === ARRIVAL_MODE.morph);
  store.setDisplaced('scatter', mode === ARRIVAL_MODE.scatter);
  store.setDisplaced('ripple', rippleLive());
  store.setDisplaced('tug', tug.active);
  store.setDisplaced('burst', burstLive());
  store.setDisplaced('heat', heat.active);
}

/** The master weight: 1 while anything is live, exactly 0 otherwise or while suspended. */
function syncWeights(): void {
  M.uRippleWeight.value = rippleLive() ? 1 : 0;
  M.uTugWeight.value = tug.active ? 1 : 0;
  M.uBurstWeight.value = burstLive() ? 1 : 0;
  M.uHeatWeight.value = heat.active ? 1 : 0;
  M.uMotionWeight.value = anyLive() && !isDisplayMotionSuspended() ? 1 : 0;
  syncDisplaced();
}

// ─── Tug ────────────────────────────────────────────────────────────

function zero3(out: V3): void {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
}

function stepSpring(s: Spring3, target: V3, feel: SpringFeel, dt: number): void {
  const k = feel.omega * feel.omega;
  const c = 2 * feel.zeta * feel.omega;
  for (let i = 0; i < 3; i += 1) {
    const a = k * (target[i] - s.x[i]) - c * s.v[i];
    s.v[i] += a * dt;
    s.x[i] += s.v[i] * dt;
  }
}

function springAtRest(s: Spring3): boolean {
  return Math.hypot(s.x[0], s.x[1], s.x[2]) < TUG.restX && Math.hypot(s.v[0], s.v[1], s.v[2]) < TUG.restV;
}

/** End the tug at rest: weight exactly 0, the grab glow off. */
function clearTug(): void {
  tug.active = false;
  tug.held = false;
  tug.atom = -1;
  zero3(tug.target);
  zero3(tug.core.x);
  zero3(tug.core.v);
  zero3(tug.halo.x);
  zero3(tug.halo.v);
  M.uTugWeight.value = 0;
  M.uTugCore.value.set(0, 0, 0);
  M.uTugHalo.value.set(0, 0, 0);
  ATOM_GLOW.uFocusAtom.value = -1;
}

function writeTugUniforms(): void {
  const c = tug.core.x;
  const stretch = Math.hypot(c[0], c[1], c[2]);
  const falloff = tug.falloff * (1 + TUG.widen * Math.min(1, stretch / Math.max(tug.limit, 1e-3)));
  M.uTugGrab.value.set(tug.grab[0], tug.grab[1], tug.grab[2], falloff);
  M.uTugCore.value.set(c[0], c[1], c[2]);
  M.uTugHalo.value.set(tug.halo.x[0], tug.halo.x[1], tug.halo.x[2]);
}

/** Advance the tug's springs by dt (s); ends it once released and at rest. */
function advanceTug(dt: number): void {
  if (!tug.active) return;
  const feel = tug.held ? TUG.held : tug.gentle ? TUG.releaseGentle : TUG.release;
  const target: V3 = tug.held ? tug.target : [0, 0, 0];
  let left = dt;
  while (left > 1e-6) {
    const h = Math.min(left, TUG.substepS);
    stepSpring(tug.core, target, feel.core, h);
    stepSpring(tug.halo, target, feel.halo, h);
    left -= h;
  }
  if (!tug.held && springAtRest(tug.core) && springAtRest(tug.halo)) {
    clearTug();
    return;
  }
  writeTugUniforms();
}

/** Let go: the springs swing home (the grab glow goes out). */
function releaseTug(): void {
  if (!tug.held) return;
  tug.held = false;
  ATOM_GLOW.uFocusAtom.value = -1;
  requestLupiFrames();
  cue('release');
  emitToyEvent({ kind: 'tugRelease' });
}

// ─── Burst ──────────────────────────────────────────────────────────

/** Pop the atoms outward from `origin`; returns the slot, or -1. */
function addBurst(origin: Vec3, scale: number, gentle: boolean): number {
  if (!(scale > 0)) return -1;
  const R = driver.radius;
  const amplitude = byRadius(BURST.amplitude, R) * scale;
  const falloff = byRadius(BURST.falloff, R);
  const zeta = gentle ? BURST.zetaGentle : BURST.zeta;
  const slot = bursts.next;
  bursts.next = (slot + 1) % BURST_SLOTS;
  const t0 = motionNow();
  const { a, b } = burstSlotUniforms(slot);
  a.value.set(origin[0], origin[1], origin[2], t0);
  b.value.set(amplitude / burstPeak(BURST.omega, zeta), falloff, BURST.omega, zeta);
  M.uMaxBurst.value = byRadius(BURST.amplitude, R) * BURST.boundScale;
  const c = driver.center;
  const rMax = Math.hypot(origin[0] - c[0], origin[1] - c[1], origin[2] - c[2]) + driver.radius;
  bursts.ends[slot] = t0 + rMax / DISPLAY_MOTION_TUNING.burstSpeed + 7 / (zeta * BURST.omega);
  syncWeights();
  requestLupiFrames();
  return slot;
}

// ─── Heat ───────────────────────────────────────────────────────────

function wallNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

let glassNoticeAt = -Infinity;

/** The refractive-glass renderer has no offset graph: say so (at most every 4 s) instead of doing nothing. */
function glassNotice(): void {
  const t = wallNow();
  if (t - glassNoticeAt < 4000) return;
  glassNoticeAt = t;
  playStore.getState().flashText('Toys rest with Refractive glass', 'info', 1800);
}

/** Tell the pill the heat level (throttled unless `force`). */
function publishHeat(force: boolean): void {
  const t = wallNow();
  if (!force && t - heat.readoutAt < HEAT.readoutMs) return;
  heat.readoutAt = t;
  playStore.getState().setHeat(heat.active ? heat.level : 0, heat.held);
}

/** Cool to rest: weight exactly 0, the tint off, the readout gone. */
function clearHeat(): void {
  heat.active = false;
  heat.held = false;
  heat.level = 0;
  heat.rub.live = false;
  heat.tickStep = 0;
  M.uHeatWeight.value = 0;
  M.uHeatAmplitude.value = 0;
  ATOM_GLOW.uHeatGlow.value = 0;
  publishHeat(true);
}

function writeHeatUniforms(scale: number): void {
  M.uHeatAmplitude.value = HEAT.amplitude * scale * Math.sqrt(heat.level);
  ATOM_GLOW.uHeatGlow.value = heat.level * scale;
}

/** Warm while held, cool while released; ends exactly at rest. */
function advanceHeat(dt: number): void {
  if (!heat.active) return;
  const scale = displayMotionScale();
  if (!(scale > 0)) {
    clearHeat();
    return;
  }
  if (heat.held) {
    heat.level += (1 - heat.level) * (1 - Math.exp(-dt / HEAT.rampS));
    // A soft tick each time it warms past another 300 K (if haptics or sound are on).
    const step = Math.floor(heatKelvin(heat.level) / 300);
    if (step > heat.tickStep) {
      if (heat.tickStep > 0) cue('warm');
      heat.tickStep = step;
    }
  } else {
    heat.level *= Math.exp(-dt / HEAT.coolS);
    if (heat.level < HEAT.restLevel) {
      clearHeat();
      return;
    }
  }
  writeHeatUniforms(scale);
  publishHeat(false);
}

function clearArrival(): void {
  if (driver.morph) {
    driver.morph = null;
    setDisplayMorph(null);
  }
  driver.arrival = null;
  M.uArrivalWeight.value = 0;
  M.uArrivalMode.value = ARRIVAL_MODE.none;
}

/** Land the arrival (or a scatter) instantly; ripples and the verbs keep going. */
export function cancelArrival(): void {
  if (driver.arrival === null && !(M.uArrivalWeight.value > 0)) return;
  clearArrival();
  syncWeights();
  requestLupiFrames();
}

/** Zero everything: arrival, morph, scatter, every ripple and burst, the tug and the heat. */
export function resetDisplayMotion(): void {
  driver.arrival = null;
  driver.morph = null;
  driver.slotEnds.fill(-1);
  driver.nextSlot = 0;
  bursts.ends.fill(-1);
  bursts.next = 0;
  clearTug();
  clearHeat();
  resetLupiDisplayMotion();
  syncDisplaced();
  requestLupiFrames();
}

/**
 * Window capture-phase listeners that land the arrival on any pointerdown,
 * key or wheel, before any pick sees the event. Events inside the relay
 * stage (`[data-lupi-relay]`) do not count.
 */
export function installArrivalCancel(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onInput = (event: Event) => {
    if (driver.arrival === null && !(M.uArrivalWeight.value > 0)) return;
    const target = event.target as Element | null;
    if (target && typeof target.closest === 'function' && target.closest('[data-lupi-relay]')) return;
    cancelArrival();
  };
  const options = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', onInput, options);
  window.addEventListener('keydown', onInput, options);
  window.addEventListener('wheel', onInput, options);
  return () => {
    window.removeEventListener('pointerdown', onInput, options);
    window.removeEventListener('keydown', onInput, options);
    window.removeEventListener('wheel', onInput, options);
  };
}

interface ArrivalFeel {
  duration: number;
  token: MotionToken;
  delayScale: number;
  weight: number;
}

/**
 * Standard: D 0.6 s on MOTION.land (condense and scatter, ≈3 % overshoot) or
 * MOTION.glide (flat). Gentle: half the travel in D 0.3 s with half the
 * stagger, on MOTION.snap (critically damped): MOTION.glide cannot settle
 * inside 0.3 s and would visibly snap in the end fade. The morph: MORPH_D.
 */
function arrivalFeel(mode: LiveMode, comfort: Comfort): ArrivalFeel {
  if (mode === ARRIVAL_MODE.morph) {
    return comfort === 'gentle'
      ? { duration: MORPH_D.gentle, token: MOTION.glide, delayScale: 0.5, weight: 0.5 }
      : { duration: MORPH_D.standard, token: MOTION.settle, delayScale: 1, weight: 1 };
  }
  if (comfort === 'gentle') return { duration: ARRIVAL_D.gentle, token: MOTION.snap, delayScale: 0.5, weight: 0.5 };
  return {
    duration: ARRIVAL_D.standard,
    token: mode === ARRIVAL_MODE.flat ? MOTION.glide : MOTION.land,
    delayScale: 1,
    weight: 1,
  };
}

function viewDirFrom(camera: THREE.Camera, center: Vec3, out: THREE.Vector3): THREE.Vector3 {
  out.set(camera.position.x - center[0], camera.position.y - center[1], camera.position.z - center[2]);
  if (out.lengthSq() < 1e-12) out.set(0, 0, 1);
  return out.normalize();
}

/** Arm an arrival: the first rendered frame already shows the mist (or the flat drawing). */
function armArrival(mode: LiveMode, camera: THREE.Camera, seed: number, comfort: Comfort): void {
  if (mode !== ARRIVAL_MODE.morph && driver.morph) {
    // A scatter replaces a running morph: its starts go.
    driver.morph = null;
    setDisplayMorph(null);
  }
  const feel = arrivalFeel(mode, comfort);
  const now = motionNow();
  driver.arrival = { mode, armed: true, end: Infinity };
  M.uMotionNow.value = now;
  M.uArrivalT0.value = now;
  M.uArrivalMode.value = mode;
  M.uArrivalWeight.value = feel.weight;
  M.uArrivalDuration.value = feel.duration;
  M.uArrivalOmega.value = 2 / Math.max(1e-4, feel.token.smoothTime);
  M.uArrivalZeta.value = feel.token.dampingRatio;
  M.uArrivalDelayScale.value = feel.delayScale;
  M.uArrivalCenter.value.set(driver.center[0], driver.center[1], driver.center[2]);
  M.uArrivalRadius.value = driver.radius;
  M.uArrivalUp.value.copy(camera.up).normalize();
  viewDirFrom(camera, driver.center, M.uArrivalViewDir.value);
  M.uArrivalSeed.value = seed;
  syncWeights();
  requestLupiFrames();
}

/**
 * Arm a morph from what the screen showed into `to`: the layers drawing `to`
 * open their gates now, and the starts are planned on its first frame.
 */
function armMorph(from: ShownMolecule, to: Frame, center: Vec3, camera: THREE.Camera, comfort: Comfort): void {
  driver.morph = { from, to, center: [center[0], center[1], center[2]], plan: null };
  lastMorph = { from, to };
  setDisplayMorph({ positions: to.positions, count: to.natoms, texels: null });
  armArrival(ARRIVAL_MODE.morph, camera, 0, comfort);
}

/** Start the armed arrival's clock (idempotent). */
function releaseArrival(camera: THREE.Camera | null): void {
  const arrival = driver.arrival;
  if (!arrival || !arrival.armed) return;
  const now = motionNow();
  arrival.armed = false;
  const rise = arrival.mode === ARRIVAL_MODE.scatter ? DISPLAY_MOTION_TUNING.scatterRiseS : 0;
  arrival.end = now + rise + M.uArrivalDuration.value;
  M.uArrivalT0.value = now;
  if (camera) viewDirFrom(camera, driver.center, M.uArrivalViewDir.value);
  // The morph's start frame holds from here (any touch lands it anyway).
  if (camera && driver.morph) writeMorphFrame(driver.morph, camera);
  requestLupiFrames();
}

/** Start a ripple in the next round-robin slot; returns the slot, or -1. */
function addRipple(origin: Vec3, amplitude: number): number {
  if (!(amplitude > 0)) return -1;
  const T = DISPLAY_MOTION_TUNING;
  const slot = driver.nextSlot;
  driver.nextSlot = (slot + 1) % RIPPLE_SLOTS;
  const t0 = motionNow();
  const { a, b } = rippleSlotUniforms(slot);
  a.value.set(origin[0], origin[1], origin[2], t0);
  b.value.set(amplitude, T.rippleSpeed, T.rippleOmega, T.rippleZeta);
  const c = driver.center;
  const rMax = Math.hypot(origin[0] - c[0], origin[1] - c[1], origin[2] - c[2]) + driver.radius;
  driver.slotEnds[slot] = t0 + rMax / T.rippleSpeed + 6 / (T.rippleZeta * T.rippleOmega);
  syncWeights();
  requestLupiFrames();
  return slot;
}

const radiusCache = { frame: null as Frame | null, x: NaN, y: NaN, z: NaN, radius: 1 };

/** The farthest atom from `center` (Å), cached per frame and centre. */
function sceneRadius(frame: Frame, center: Vec3): number {
  const cache = radiusCache;
  if (cache.frame === frame && cache.x === center[0] && cache.y === center[1] && cache.z === center[2]) return cache.radius;
  const p = frame.positions;
  let max2 = 0;
  for (let i = 0; i < frame.natoms; i += 1) {
    const dx = p[i * 3] - center[0];
    const dy = p[i * 3 + 1] - center[1];
    const dz = p[i * 3 + 2] - center[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > max2) max2 = d2;
  }
  Object.assign(cache, { frame, x: center[0], y: center[1], z: center[2], radius: Math.max(0.5, Math.sqrt(max2)) });
  return cache.radius;
}

/** Run the next effect around this frame's centre and radius. */
function adoptScene(frame: Frame, center: Vec3): void {
  driver.center = [center[0], center[1], center[2]];
  driver.radius = sceneRadius(frame, center);
}

/** FNV-1a of a molecule id, folded under 2^24 (exact as a float uniform). */
function arrivalSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h ^ (h >>> 24)) & 0xffffff;
}

/** The page's query: `search`, then the hash route's own query (as arrivalRules reads it). */
function pageQuery(): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  const query = hash.indexOf('?');
  if (query >= 0) new URLSearchParams(hash.slice(query + 1)).forEach((value, key) => params.set(key, value));
  return params;
}

/** A saved view's route (`/view/<slug>`, in the path or the hash). */
function onSavedViewRoute(): boolean {
  const route = window.location.hash.replace(/^#/, '').split('?')[0].toLowerCase();
  return route.startsWith('/view/') || window.location.pathname.toLowerCase().startsWith('/view/');
}

/** True when the file opening should morph out of what the screen showed (`previous`; `sameFile`: a frame of this file). */
function morphWanted(input: ArrivalRuleInput, previous: ShownMolecule | null, sameFile: boolean): boolean {
  const params = pageQuery();
  const baton = input.baton;
  // The home hero's or a molecule page's drawing inflates flat, as it always has.
  const drawingHandOff = isRelayActive()
    || ((baton?.source === 'hero' || baton?.source === 'page') && baton.galleryId === input.galleryId);
  return shouldMorph({
    sceneAllows: canPlayScatter(input),
    arrivalOff: params.get('arrival') === '0',
    machine: mcpActiveWithin() || params.has('mcpCommand') || params.has('command') || params.get('batchExport') === 'true',
    drawingHandOff,
    savedView: onSavedViewRoute(),
    previous: previous
      ? { natoms: previous.frame.natoms, resident: previous.resident, sameFile }
      : null,
    natoms: input.natoms,
  });
}

function galleryIdOf(): string | null {
  const state = useStore.getState();
  if (state.activeCardId) return state.activeCardId;
  return state.file?.name ? `name:${state.file.name}` : null;
}

function ruleInput(
  frame: Frame,
  totalFrames: number,
  transmissionActive: boolean,
  playing: boolean,
): ArrivalRuleInput {
  return {
    natoms: frame.natoms,
    totalFrames,
    transmissionActive,
    playing,
    comfort: getComfort(),
    hash: window.location.hash,
    search: window.location.search,
    pathname: window.location.pathname,
    seenIds: readSeenArrivals(),
    galleryId: galleryIdOf(),
    baton: peekBaton(),
  };
}

// ─── Component ─────────────────────────────────────────────────────────

export function PlayLayer({ frame, center, transmissionActive, playing }: PlayLayerProps): null {
  const camera = useThree((state) => state.camera);
  const renderer = useThree((state) => state.renderer);
  const trajectory = useStore((state) => state.file?.trajectory ?? null);
  const live = useRef({ frame, center, camera, renderer, transmissionActive, playing, trajectory });
  live.current = { frame, center, camera, renderer, transmissionActive, playing, trajectory };

  useEffect(() => installPlayDevHooks(), []);
  useEffect(() => installArrivalCancel(), []);
  // Quiet Idle: draw every frame while an arrival, ripple, scatter, tug,
  // burst or heat is live (an armed arrival included: it waits on the
  // first-frame mark).
  useEffect(() => keepLupiAwake('display-motion', anyLive), []);
  useEffect(
    () => registerRecordingGuard(({ illustrative }) => {
      // Instant Replay's clip is a picture of the toys: they keep playing.
      if (illustrative) return () => {};
      setDisplayMotionSuspended(true);
      return () => setDisplayMotionSuspended(false);
    }),
    [],
  );
  useEffect(
    () => () => {
      resetDisplayMotion();
      radiusCache.frame = null; // do not keep the last file's Frame alive
      shown = null;
      lastMorph = null;
    },
    [],
  );

  // Arm the arrival before the first render of a newly opened file.
  useLayoutEffect(() => {
    // What the screen showed before this file (the last drawn frame).
    const previous = shown ? copyShown(shown) : null;
    resetDisplayMotion();
    if (!trajectory) return undefined;
    const sameFile = previous !== null && trajectory.frames.includes(previous.frame);
    const now = live.current;
    // This layer's own store subscription can render it with the new file
    // before the scene passes the new frame and centre: take both from the
    // file itself (the scene draws the same frame, centred on its bounds).
    const opened = trajectory.frames[useStore.getState().frame] ?? trajectory.frames[0] ?? now.frame;
    const { min, max } = trajectory.globalBounds;
    const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const input = ruleInput(opened, trajectory.totalFrames, now.transmissionActive, now.playing);
    if (previous && morphWanted(input, previous, sameFile)) {
      // A switch: the atoms on screen flow into the new molecule.
      previous.view.radius = sceneRadius(previous.frame, previous.view.center);
      adoptScene(opened, center);
      armMorph(previous, opened, center, now.camera, input.comfort);
    } else {
      const mode = shouldPlayArrival(input);
      if (!mode) return undefined;
      adoptScene(opened, center);
      // `?arrival=1` forces past Still: play it at Standard then.
      armArrival(
        mode === 'flat' ? ARRIVAL_MODE.flat : ARRIVAL_MODE.condense,
        now.camera,
        arrivalSeed(input.galleryId ?? 'lupi'),
        input.comfort === 'still' ? 'standard' : input.comfort,
      );
    }
    if (input.galleryId) markArrivalSeen(input.galleryId);

    const behindRelay = isRelayActive();
    let relayTimer: ReturnType<typeof setTimeout> | null = null;
    const release = () => releaseArrival(live.current.camera);
    const onFirst = () => {
      if (!behindRelay) release();
      else if (relayTimer === null) relayTimer = setTimeout(release, RELAY_RELEASE_MS);
    };
    const offFirst = onFirstFrame((key) => {
      if (key === trajectory) onFirst();
    });
    if (hasFirstFrame(trajectory)) onFirst();
    const fallback = setTimeout(release, RELEASE_FALLBACK_MS);
    return () => {
      offFirst();
      clearTimeout(fallback);
      if (relayTimer !== null) clearTimeout(relayTimer);
    };
  }, [trajectory]);

  // Opening a panel or the study lens puts everything at rest.
  useEffect(
    () => useStore.subscribe(
      (state) => Boolean(state.activePanel) || state.studyLensOpen,
      (covered) => {
        if (covered) resetDisplayMotion();
      },
    ),
    [],
  );

  // Triggers and dev hooks.
  useEffect(() => {
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane();
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const normal = new THREE.Vector3();

    const poke = (atomIndex: number): number => {
      const { frame: current, center: c, transmissionActive: glass } = live.current;
      // The transmission renderer has no impostor graph: its atoms would stay put.
      if (glass || !(atomIndex >= 0 && atomIndex < current.natoms)) return -1;
      adoptScene(current, c);
      const p = current.positions;
      const slot = addRipple([p[atomIndex * 3], p[atomIndex * 3 + 1], p[atomIndex * 3 + 2]], POKE_AMPLITUDE * displayMotionScale());
      if (slot >= 0) emitToyEvent({ kind: 'poke', atom: atomIndex });
      return slot;
    };

    const scatter = (replaySeed?: number): boolean => {
      const now = live.current;
      const totalFrames = useStore.getState().file?.trajectory.totalFrames ?? 0;
      const input = ruleInput(now.frame, totalFrames, now.transmissionActive, now.playing);
      if (!canPlayScatter(input)) return false;
      adoptScene(now.frame, now.center);
      // A fresh mist every time (a replay brings the sender's).
      const seed = replaySeed ?? arrivalSeed(`${input.galleryId ?? 'lupi'}#${Date.now()}`);
      armArrival(ARRIVAL_MODE.scatter, now.camera, seed, input.comfort);
      releaseArrival(now.camera);
      emitToyEvent({ kind: 'scatter', seed });
      return true;
    };

    /**
     * Where the ray under a client point meets the plane through `through`
     * facing the camera (world space), into `out`; false off the canvas or
     * parallel to the plane.
     */
    const clientToPlane = (clientX: number, clientY: number, through: Vec3, out: THREE.Vector3): boolean => {
      const { camera: cam, renderer: gl } = live.current;
      const rect = (gl.domElement as HTMLElement).getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return false;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
      ray.setFromCamera(ndc, cam);
      cam.getWorldDirection(normal);
      plane.setFromNormalAndCoplanarPoint(normal, hit.set(through[0], through[1], through[2]));
      return ray.ray.intersectPlane(plane, out) !== null;
    };

    /** The atom under a client point (as a tap would pick it), if it is a real atom of this frame. */
    const atomAt = (clientX: number, clientY: number): number => {
      const index = pickAtomAtClient(clientX, clientY);
      return index !== null && index >= 0 && index < live.current.frame.natoms ? index : -1;
    };

    const atomPosition = (index: number): Vec3 => {
      const p = live.current.frame.positions;
      return [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]];
    };

    // Poke latched: stirring leaves a trail of small ripples.
    const stir = (clientX: number, clientY: number, phase: 'start' | 'move' | 'end') => {
      if (phase === 'end') return;
      const amplitude = STROKE_AMPLITUDE * displayMotionScale();
      if (!(amplitude > 0) || live.current.transmissionActive) return;
      const t = performance.now();
      const last = driver.lastStroke;
      if (phase === 'move' && (t - last.t < STROKE_MIN_MS || Math.hypot(clientX - last.x, clientY - last.y) < STROKE_MIN_PX)) return;
      const c = live.current.center;
      if (!clientToPlane(clientX, clientY, c, hit)) return;
      driver.lastStroke = { t, x: clientX, y: clientY };
      adoptScene(live.current.frame, c);
      if (addRipple([hit.x, hit.y, hit.z], amplitude) >= 0) {
        emitToyEvent({ kind: 'ripple', point: [hit.x, hit.y, hit.z], amplitude: STROKE_AMPLITUDE });
      }
    };

    // Tug latched: grab the atom under the finger (or the point in space
    // there) and pull; the neighbourhood follows, and lets go with a twang.
    const tugGrab = (clientX: number, clientY: number, atomIndex: number | null, point?: Vec3): boolean => {
      const { frame: current, center: c, transmissionActive: glass } = live.current;
      const scale = displayMotionScale();
      if (glass) glassNotice();
      if (!(scale > 0) || glass) return false;
      adoptScene(current, c);
      const atom = atomIndex ?? (point ? -1 : atomAt(clientX, clientY));
      let grab: Vec3;
      if (atom >= 0) grab = atomPosition(atom);
      else if (point) grab = [point[0], point[1], point[2]];
      else {
        if (!clientToPlane(clientX, clientY, c, hit)) return false;
        grab = [hit.x, hit.y, hit.z];
      }
      if (!clientToPlane(clientX, clientY, grab, tug.startHit)) tug.startHit.set(grab[0], grab[1], grab[2]);
      // A new grab replaces whatever was still swinging home.
      clearTug();
      tug.active = true;
      tug.held = true;
      tug.atom = atom;
      tug.grab = [grab[0], grab[1], grab[2]];
      tug.falloff = byRadius(TUG.falloff, driver.radius);
      tug.limit = byRadius(TUG.limit, driver.radius);
      tug.scale = scale;
      tug.gentle = getComfort() === 'gentle';
      ATOM_GLOW.uFocusAtom.value = atom;
      writeTugUniforms();
      syncWeights();
      requestLupiFrames();
      if (atom >= 0) cue('grab');
      emitToyEvent({ kind: 'tugGrab', atom, point: [grab[0], grab[1], grab[2]] });
      return true;
    };

    /** Set the held tug's target from a world displacement (rubber-band limited). */
    const tugPullBy = (dx: number, dy: number, dz: number) => {
      const len = Math.hypot(dx, dy, dz);
      const limited = len > 1e-6 ? (tug.limit * Math.tanh(len / tug.limit)) / len : 0;
      const k = limited * tug.scale;
      tug.target[0] = dx * k;
      tug.target[1] = dy * k;
      tug.target[2] = dz * k;
      requestLupiFrames();
      emitToyEvent({ kind: 'tugPull', d: [dx, dy, dz] });
    };

    const tugStroke = (clientX: number, clientY: number, phase: 'start' | 'move' | 'end') => {
      if (phase === 'start') {
        tugGrab(clientX, clientY, null);
        return;
      }
      if (!tug.held) return;
      if (phase === 'end') {
        releaseTug();
        return;
      }
      if (!clientToPlane(clientX, clientY, tug.grab, hit)) return;
      tugPullBy(hit.x - tug.startHit.x, hit.y - tug.startHit.y, hit.z - tug.startHit.z);
    };

    // Burst latched: a tap pops the atoms outward from the tap point.
    const burstAt = (origin: Vec3): boolean => {
      const { frame: current, center: c, transmissionActive: glass } = live.current;
      if (glass) {
        glassNotice();
        return false;
      }
      adoptScene(current, c);
      if (addBurst(origin, displayMotionScale(), getComfort() === 'gentle') < 0) return false;
      emitToyEvent({ kind: 'burst', point: [origin[0], origin[1], origin[2]] });
      return true;
    };

    const burstAtClient = (clientX: number, clientY: number): boolean => {
      const atom = atomAt(clientX, clientY);
      if (atom >= 0) return burstAt(atomPosition(atom));
      if (!clientToPlane(clientX, clientY, live.current.center, hit)) return false;
      return burstAt([hit.x, hit.y, hit.z]);
    };

    // Heat latched: hold to warm (rubbing warms faster), let go to cool.
    const heatStart = (): boolean => {
      if (live.current.transmissionActive) glassNotice();
      if (!(displayMotionScale() > 0) || live.current.transmissionActive) return false;
      heat.held = true;
      heat.active = true;
      syncWeights();
      publishHeat(true);
      requestLupiFrames();
      emitToyEvent({ kind: 'heatOn' });
      return true;
    };

    const heatStop = () => {
      if (!heat.held) return;
      heat.held = false;
      heat.rub.live = false;
      publishHeat(true);
      requestLupiFrames();
      emitToyEvent({ kind: 'heatOff' });
    };

    const heatRub = (clientX: number, clientY: number, phase: 'start' | 'move' | 'end') => {
      const rub = heat.rub;
      if (phase === 'end' || !heat.held) {
        rub.live = false;
        return;
      }
      if (rub.live) {
        const amount = Math.hypot(clientX - rub.x, clientY - rub.y) * HEAT.rubPerPx;
        heat.level = Math.min(1, heat.level + amount);
        if (amount > 0) emitToyEvent({ kind: 'heatRub', amount });
      }
      rub.x = clientX;
      rub.y = clientY;
      rub.live = true;
    };

    const verbNow = () => playStore.getState().verb;

    const offs = [
      onIntent('atom.tap', ({ atomIndex }) => {
        if (useStore.getState().measurementTool != null) return;
        // With Burst latched taps pop (verb.tap below) and never select.
        if (verbNow() === 'burst') return;
        if (poke(atomIndex) >= 0) cue('poke');
      }),
      onIntent('verb.tap', ({ clientX, clientY }) => {
        if (verbNow() !== 'burst') return;
        if (burstAtClient(clientX, clientY)) cue('burst');
      }),
      onIntent('verb.stroke', ({ clientX, clientY, phase }) => {
        switch (verbNow()) {
          case 'poke':
            stir(clientX, clientY, phase);
            break;
          case 'tug':
            tugStroke(clientX, clientY, phase);
            break;
          case 'heat':
            heatRub(clientX, clientY, phase);
            break;
          default:
            // A stroke that began under another verb still lets go.
            if (phase === 'end') releaseTug();
            break;
        }
      }),
      onIntent('verb.press', ({ phase }) => {
        if (phase === 'up') heatStop();
        else if (verbNow() === 'heat') heatStart();
      }),
      // Leaving a verb lets go of whatever it held.
      playStore.subscribe((state, previous) => {
        if (state.verb === previous.verb) return;
        heatStop();
        releaseTug();
      }),
      onIntent('play.scatter', () => {
        scatter();
      }),
      onIntent('play.reset', () => {
        resetDisplayMotion();
        emitToyEvent({ kind: 'reset' });
      }),
      // Instant Replay plays the sender's toy inputs back here, at this
      // view's own Motion comfort.
      registerToyReplaySink({
        play: (event: ToyEvent) => {
          switch (event.kind) {
            case 'poke':
              if (poke(event.atom) >= 0) cue('poke');
              break;
            case 'ripple': {
              const amplitude = event.amplitude * displayMotionScale();
              if (!(amplitude > 0) || live.current.transmissionActive) break;
              adoptScene(live.current.frame, live.current.center);
              addRipple([event.point[0], event.point[1], event.point[2]], amplitude);
              break;
            }
            case 'burst':
              if (burstAt(event.point)) cue('burst');
              break;
            case 'tugGrab': {
              const atom = event.atom >= 0 && event.atom < live.current.frame.natoms ? event.atom : null;
              tugGrab(0, 0, atom, atom === null ? event.point : undefined);
              break;
            }
            case 'tugPull':
              if (tug.held) tugPullBy(event.d[0], event.d[1], event.d[2]);
              break;
            case 'tugRelease':
              releaseTug();
              break;
            case 'heatOn':
              heatStart();
              break;
            case 'heatOff':
              heatStop();
              break;
            case 'heatRub':
              if (heat.held) heat.level = Math.min(1, heat.level + event.amount);
              break;
            case 'scatter':
              scatter(event.seed);
              break;
            case 'reset':
              resetDisplayMotion();
              break;
            default:
              break;
          }
        },
      }),
      // Still stops the arrival, ripples and Scatter already running.
      subscribeComfort((comfort) => {
        if (comfort === 'still') resetDisplayMotion();
      }),
      registerPlayDevHook('motion', () => ({
        active: M.uMotionWeight.value > 0,
        weight: M.uMotionWeight.value,
        arrival: driver.arrival ? `${driver.arrival.armed ? 'armed ' : ''}${MODE_NAMES[driver.arrival.mode]}` : null,
        // The arrival's length (s) and travel (1 Standard, 0.5 Gentle) while one is live.
        feel: driver.arrival ? { duration: M.uArrivalDuration.value, weight: M.uArrivalWeight.value } : null,
        // The morph armed or running (else null) with its plan's counts: new
        // atoms from an old atom of their element, of another, budded.
        morph: driver.morph
          ? { running: driver.arrival?.armed === false, planned: driver.morph.plan !== null, ...(driver.morph.plan ? lastMorphReport : {}) }
          : null,
        lastMorph: lastMorphReport,
        ripples: driver.slotEnds.filter((end) => end >= 0).length,
        bursts: bursts.ends.filter((end) => end >= 0).length,
        tug: tug.active ? { held: tug.held, atom: tug.atom, stretch: Math.hypot(...tug.core.x) } : null,
        heat: heat.active ? { held: heat.held, level: heat.level } : null,
        suspended: isDisplayMotionSuspended(),
      })),
      // __lupiPlay.burst(atomIndex): pop from that atom.
      registerPlayDevHook('burst', (atomIndex: number = 0) => {
        const index = Math.trunc(Number(atomIndex));
        if (!(index >= 0 && index < live.current.frame.natoms)) return null;
        return burstAt(atomPosition(index)) ? { atomIndex: index } : null;
      }),
      // __lupiPlay.tug(atomIndex, [dx, dy, dz], holdMs): grab, pull by the
      // world displacement (Å), let go after holdMs.
      registerPlayDevHook('tug', (atomIndex: number = 0, pull: unknown = [2, 0, 0], holdMs: number = 600) => {
        const index = Math.trunc(Number(atomIndex));
        if (!(index >= 0 && index < live.current.frame.natoms)) return null;
        if (!tugGrab(0, 0, index)) return null;
        const d = Array.isArray(pull) ? pull.map(Number) : [2, 0, 0];
        tugPullBy(d[0] || 0, d[1] || 0, d[2] || 0);
        setTimeout(releaseTug, Math.max(0, Number(holdMs) || 0));
        return { atomIndex: index };
      }),
      // __lupiPlay.heat(level): warm to `level` (0..1) at once, then cool.
      registerPlayDevHook('heat', (level: number = 0.8) => {
        if (!heatStart()) return null;
        heat.level = Math.min(1, Math.max(0, Number(level) || 0));
        heat.held = false;
        publishHeat(true);
        return { level: heat.level };
      }),
      registerPlayDevHook('poke', (atomIndex: number = 0) => {
        const index = Math.trunc(Number(atomIndex));
        const slot = poke(index);
        return slot >= 0 ? { slot, atomIndex: index } : null;
      }),
      registerPlayDevHook('scatter', () => scatter()),
      // __lupiPlay.morph(): play the last switch's morph again (from the
      // molecule as the screen showed it then) while its molecule is on screen.
      registerPlayDevHook('morph', () => {
        const now = live.current;
        const last = lastMorph;
        if (!last || last.to !== now.frame) return null;
        const totalFrames = useStore.getState().file?.trajectory.totalFrames ?? 0;
        const input = ruleInput(now.frame, totalFrames, now.transmissionActive, now.playing);
        if (!canPlayScatter(input)) return null;
        cancelArrival();
        adoptScene(now.frame, now.center);
        armMorph(last.from, now.frame, now.center, now.camera, input.comfort);
        releaseArrival(now.camera);
        return { atoms: now.frame.natoms, previousAtoms: last.from.frame.natoms };
      }),
    ];

    // Keyboard: with a verb latched, Enter plays it on the selected atom (or
    // the middle of the molecule): Poke rings, Burst pops, Tug plucks the
    // atom toward you and lets go, and Heat warms while Enter is held.
    const typingTarget = (target: EventTarget | null): boolean => {
      const el = target as Element | null;
      if (!el || typeof el.closest !== 'function') return false;
      return Boolean(el.closest(
        'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="menuitem"], [role="menuitemradio"], [role="slider"], [role="textbox"], [role="combobox"]',
      ));
    };
    const keyTarget = (): { atom: number; point: Vec3 } => {
      const selected = useStore.getState().selectedAtoms;
      const atom = selected.length > 0 ? selected[0] : -1;
      if (atom >= 0 && atom < live.current.frame.natoms) return { atom, point: atomPosition(atom) };
      const c = live.current.center;
      return { atom: -1, point: [c[0], c[1], c[2]] };
    };
    let keyHeat = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (typingTarget(event.target)) return;
      const verb = verbNow();
      if (verb === 'orbit' || useStore.getState().activePanel) return;
      event.preventDefault();
      if (event.repeat) return;
      const { atom, point } = keyTarget();
      switch (verb) {
        case 'poke':
          if (atom >= 0 && poke(atom) >= 0) cue('poke');
          else if (atom < 0) {
            adoptScene(live.current.frame, live.current.center);
            if (addRipple(point, POKE_AMPLITUDE * displayMotionScale()) >= 0) {
              emitToyEvent({ kind: 'ripple', point: [point[0], point[1], point[2]], amplitude: POKE_AMPLITUDE });
            }
          }
          break;
        case 'burst':
          if (burstAt(point)) cue('burst');
          break;
        case 'tug': {
          if (!tugGrab(0, 0, atom >= 0 ? atom : null, point)) break;
          // Pluck up and to the right on screen (a little toward you), then let go.
          const cam = live.current.camera;
          cam.getWorldDirection(normal);
          const up = new THREE.Vector3().copy(cam.up).normalize();
          const right = new THREE.Vector3().crossVectors(normal, up).normalize();
          const pull = right.multiplyScalar(0.7).addScaledVector(up, 0.55).addScaledVector(normal, -0.3);
          pull.setLength(tug.limit * 0.8);
          tugPullBy(pull.x, pull.y, pull.z);
          setTimeout(releaseTug, 420);
          break;
        }
        case 'heat':
          keyHeat = heatStart();
          break;
        default:
          break;
      }
      playStore.getState().markTeachSeen();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !keyHeat) return;
      keyHeat = false;
      heatStop();
    };
    const onBlur = () => {
      if (!keyHeat) return;
      keyHeat = false;
      heatStop();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      for (const off of offs) off();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useFrame(
    () => {
      const wall = performance.now();
      const step = driver.lastWall < 0 ? 0 : Math.min(MAX_STEP_S, Math.max(0, (wall - driver.lastWall) / 1000));
      driver.lastWall = wall;
      if (anyLive()) driver.clock += step;
      const now = driver.clock;
      const { camera: cam, frame: current, center: c } = live.current;
      // The morph: planned on its first frame (the live camera shows the new
      // view now); while armed, its start frame follows the camera.
      const run = driver.morph;
      if (run && driver.arrival?.mode === ARRIVAL_MODE.morph) {
        if (!run.plan) planRun(run, cam);
        else if (driver.arrival.armed) writeMorphFrame(run, cam);
      }
      const arrival = driver.arrival;
      if (arrival) {
        if (arrival.armed) M.uArrivalT0.value = now;
        else if (now >= arrival.end) clearArrival();
      }
      for (let i = 0; i < RIPPLE_SLOTS; i += 1) {
        const end = driver.slotEnds[i];
        if (end >= 0 && now >= end) {
          driver.slotEnds[i] = -1;
          rippleSlotUniforms(i).a.value.w = -1;
        }
      }
      for (let i = 0; i < BURST_SLOTS; i += 1) {
        const end = bursts.ends[i];
        if (end >= 0 && now >= end) {
          bursts.ends[i] = -1;
          burstSlotUniforms(i).a.value.w = -1;
        }
      }
      advanceTug(step);
      advanceHeat(step);
      if (!anyLive()) {
        // Idle: rebase the clock so it stays small (float precision), and
        // forget the wall time: the loop may sleep now, and the next effect
        // must start at t = 0, not a capped 0.1 s into its motion.
        driver.clock = 0;
        driver.lastWall = -1;
        M.uMotionNow.value = 0;
      } else {
        M.uMotionNow.value = now;
      }
      syncWeights();

      // What the screen shows: the next switch morphs out of it.
      if (live.current.trajectory) {
        shown = {
          frame: current,
          resident: useStore.getState().loadedAtomCount >= current.natoms,
          // The radius is measured only if this molecule is morphed from.
          view: viewOf(cam, c, 0),
        };
      }
    },
    { phase: LUPI_PHASE.uniforms, id: LUPI_JOB.displayMotion },
  );

  return null;
}
