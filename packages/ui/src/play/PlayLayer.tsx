/**
 * PlayLayer — the display-motion driver inside the Canvas: the arrival (a
 * first open condenses out of a seeded mist, or the hero's flat drawing
 * inflates), the poke ripple, stirring with Poke, and Scatter.
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
 *   stage), or 1 s after arming.
 * - Any pointerdown, key or wheel lands the arrival instantly, synchronously
 *   in the capture phase, before any pick (`installArrivalCancel`).
 *
 * It also installs `window.__lupiPlay` (the only place it is installed) and
 * registers the `motion`, `poke` and `scatter` dev hooks. `reset` keeps the
 * default (it emits `play.reset`, which this layer and every other toy hear).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import { MOTION, type MotionToken } from '@atlas/core/motion';
import {
  ARRIVAL_MODE,
  DISPLAY_MOTION,
  DISPLAY_MOTION_TUNING,
  LUPI_JOB,
  LUPI_PHASE,
  RIPPLE_SLOTS,
  isDisplayMotionSuspended,
  onIntent,
  registerRecordingGuard,
  resetLupiDisplayMotion,
  rippleSlotUniforms,
  setDisplayMotionSuspended,
} from '@atlas/scene';
import { useStore } from '../store';
import type { Vec3 } from '../camera/rigApi';
import { displayMotionScale, getComfort, type Comfort } from '../motion/comfort';
import { isRelayActive, peekBaton } from '../relay/baton';
import { hasFirstFrame, onFirstFrame } from '../relay/firstFrame';
import { cue } from './feedback';
import { installPlayDevHooks, registerPlayDevHook } from './devHooks';
import { playStore } from './playStore';
import {
  canPlayScatter,
  markArrivalSeen,
  readSeenArrivals,
  shouldPlayArrival,
  type ArrivalRuleInput,
} from './arrivalRules';

export interface PlayLayerProps {
  frame: Frame;
  center: Vec3;
  transmissionActive: boolean;
  playing: boolean;
}

type LiveMode = typeof ARRIVAL_MODE.condense | typeof ARRIVAL_MODE.flat | typeof ARRIVAL_MODE.scatter;

/** Arrival duration D (s) at Standard and Gentle. */
const ARRIVAL_D = { standard: 0.6, gentle: 0.3 } as const;
/** Behind the relay stage the release waits for its hand-off fade. */
const RELAY_RELEASE_MS = 120;
/** The release fallback when no first frame is reported. */
const RELEASE_FALLBACK_MS = 1000;
/** Poke ripple amplitude at Standard (Å); Gentle halves it, Still skips it. */
const POKE_AMPLITUDE = DISPLAY_MOTION_TUNING.rippleAmplitude;
/** Stirring (Poke latched): amplitude, and at most one ripple per 60 ms and 10 px. */
const STROKE_AMPLITUDE = 0.2;
const STROKE_MIN_MS = 60;
const STROKE_MIN_PX = 10;
const MODE_NAMES = ['none', 'condense', 'flat', 'scatter'] as const;
/**
 * The motion clock advances by the frame time, capped at 0.1 s: a hitch (a
 * shader compile right after the first frame, a slow device) slows the
 * effect down instead of skipping it. At 10 fps and above it is wall time.
 */
const MAX_STEP_S = 0.1;

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
};

function motionNow(): number {
  return driver.clock;
}

function rippleLive(): boolean {
  return driver.slotEnds.some((end) => end >= 0);
}

function syncDisplaced(): void {
  const store = playStore.getState();
  const mode = driver.arrival?.mode ?? null;
  store.setDisplaced('arrival', mode === ARRIVAL_MODE.condense || mode === ARRIVAL_MODE.flat);
  store.setDisplaced('scatter', mode === ARRIVAL_MODE.scatter);
  store.setDisplaced('ripple', rippleLive());
}

/** The master weight: 1 while anything is live, exactly 0 otherwise or while suspended. */
function syncWeights(): void {
  const ripple = rippleLive();
  M.uRippleWeight.value = ripple ? 1 : 0;
  M.uMotionWeight.value = (driver.arrival !== null || ripple) && !isDisplayMotionSuspended() ? 1 : 0;
  syncDisplaced();
}

function clearArrival(): void {
  driver.arrival = null;
  M.uArrivalWeight.value = 0;
  M.uArrivalMode.value = ARRIVAL_MODE.none;
}

/** Land the arrival (or a scatter) instantly; ripples keep going. */
export function cancelArrival(): void {
  if (driver.arrival === null && !(M.uArrivalWeight.value > 0)) return;
  clearArrival();
  if (!(M.uRippleWeight.value > 0) || isDisplayMotionSuspended()) M.uMotionWeight.value = 0;
  syncDisplaced();
}

/** Zero everything: arrival, scatter and every ripple slot. */
export function resetDisplayMotion(): void {
  driver.arrival = null;
  driver.slotEnds.fill(-1);
  driver.nextSlot = 0;
  resetLupiDisplayMotion();
  syncDisplaced();
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
 * inside 0.3 s and would visibly snap in the end fade.
 */
function arrivalFeel(mode: LiveMode, comfort: Comfort): ArrivalFeel {
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
  const live = useRef({ frame, center, camera, renderer, transmissionActive, playing });
  live.current = { frame, center, camera, renderer, transmissionActive, playing };

  useEffect(() => installPlayDevHooks(), []);
  useEffect(() => installArrivalCancel(), []);
  useEffect(
    () => registerRecordingGuard(() => {
      setDisplayMotionSuspended(true);
      return () => setDisplayMotionSuspended(false);
    }),
    [],
  );
  useEffect(() => () => resetDisplayMotion(), []);

  // Arm the arrival before the first render of a newly opened file.
  useLayoutEffect(() => {
    resetDisplayMotion();
    if (!trajectory) return undefined;
    const now = live.current;
    const input = ruleInput(now.frame, trajectory.totalFrames, now.transmissionActive, now.playing);
    const mode = shouldPlayArrival(input);
    if (!mode) return undefined;
    adoptScene(now.frame, now.center);
    // `?arrival=1` forces past Still: play it at Standard then.
    armArrival(
      mode === 'flat' ? ARRIVAL_MODE.flat : ARRIVAL_MODE.condense,
      now.camera,
      arrivalSeed(input.galleryId ?? 'lupi'),
      input.comfort === 'still' ? 'standard' : input.comfort,
    );
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
      return addRipple([p[atomIndex * 3], p[atomIndex * 3 + 1], p[atomIndex * 3 + 2]], POKE_AMPLITUDE * displayMotionScale());
    };

    const scatter = (): boolean => {
      const now = live.current;
      const totalFrames = useStore.getState().file?.trajectory.totalFrames ?? 0;
      const input = ruleInput(now.frame, totalFrames, now.transmissionActive, now.playing);
      if (!canPlayScatter(input)) return false;
      adoptScene(now.frame, now.center);
      // A fresh mist every time.
      armArrival(ARRIVAL_MODE.scatter, now.camera, arrivalSeed(`${input.galleryId ?? 'lupi'}#${Date.now()}`), input.comfort);
      releaseArrival(now.camera);
      return true;
    };

    const stroke = (clientX: number, clientY: number, phase: 'start' | 'move' | 'end') => {
      if (phase === 'end') return;
      const amplitude = STROKE_AMPLITUDE * displayMotionScale();
      if (!(amplitude > 0) || live.current.transmissionActive) return;
      const t = performance.now();
      const last = driver.lastStroke;
      if (phase === 'move' && (t - last.t < STROKE_MIN_MS || Math.hypot(clientX - last.x, clientY - last.y) < STROKE_MIN_PX)) return;
      const { camera: cam, renderer: gl, center: c } = live.current;
      const rect = (gl.domElement as HTMLElement).getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
      ray.setFromCamera(ndc, cam);
      cam.getWorldDirection(normal);
      plane.setFromNormalAndCoplanarPoint(normal, hit.set(c[0], c[1], c[2]));
      if (!ray.ray.intersectPlane(plane, hit)) return;
      driver.lastStroke = { t, x: clientX, y: clientY };
      adoptScene(live.current.frame, c);
      addRipple([hit.x, hit.y, hit.z], amplitude);
    };

    const offs = [
      onIntent('atom.tap', ({ atomIndex }) => {
        if (useStore.getState().measurementTool != null) return;
        if (poke(atomIndex) >= 0) cue('poke');
      }),
      onIntent('verb.stroke', ({ clientX, clientY, phase }) => stroke(clientX, clientY, phase)),
      onIntent('play.scatter', () => {
        scatter();
      }),
      onIntent('play.reset', () => resetDisplayMotion()),
      registerPlayDevHook('motion', () => ({
        active: M.uMotionWeight.value > 0,
        weight: M.uMotionWeight.value,
        arrival: driver.arrival ? `${driver.arrival.armed ? 'armed ' : ''}${MODE_NAMES[driver.arrival.mode]}` : null,
        ripples: driver.slotEnds.filter((end) => end >= 0).length,
        suspended: isDisplayMotionSuspended(),
      })),
      registerPlayDevHook('poke', (atomIndex: number = 0) => {
        const index = Math.trunc(Number(atomIndex));
        const slot = poke(index);
        return slot >= 0 ? { slot, atomIndex: index } : null;
      }),
      registerPlayDevHook('scatter', () => scatter()),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  useFrame(
    () => {
      const wall = performance.now();
      const step = driver.lastWall < 0 ? 0 : Math.min(MAX_STEP_S, Math.max(0, (wall - driver.lastWall) / 1000));
      driver.lastWall = wall;
      if (driver.arrival !== null || rippleLive()) driver.clock += step;
      const now = driver.clock;
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
      if (driver.arrival === null && !rippleLive()) {
        // Idle: rebase the clock so it stays small (float precision).
        driver.clock = 0;
        M.uMotionNow.value = 0;
      } else {
        M.uMotionNow.value = now;
      }
      syncWeights();
    },
    { phase: LUPI_PHASE.uniforms, id: LUPI_JOB.displayMotion },
  );

  return null;
}
