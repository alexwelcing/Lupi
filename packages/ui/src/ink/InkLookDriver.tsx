/**
 * InkLookDriver — feeds the Illustrate look's shared uniforms (scene
 * `tsl/inkLook.ts`) from the viewer store, inside the Canvas, and plays
 * Ink-to-Light.
 *
 * - The look: `inkStyle` and `inkWeight` set the target every capture
 *   renders (`setInkLookTarget`). A change fades the live drawing toward it
 *   (TOGGLE_MS, the settle token's shape): the ink thins away as the light
 *   comes on, or the lit molecule draws itself in ink. The first value a
 *   viewer opens on is cut, never faded.
 * - Ink-to-Light: a molecule opened from an ink drawing (the home hero, a
 *   molecule page, an ink tile or finder row; the relay baton) first draws
 *   in ink, so the relay's drawing hands over to a drawing at the same pose.
 *   Once the first frame is on screen and the relay has faded, the light
 *   comes on. Any touch, click, wheel or key completes it.
 * - The Light Fuse (INK_FUSE_MS; scene `tsl/inkFuse.ts`, `./fuseHops.ts`):
 *   Ink-to-Light and the UI's own toggles (the Play tray, the palette, `I`)
 *   do not crossfade the whole molecule. The light (or the ink) starts at a
 *   seed atom and travels along the bonds, each atom taking it at its hop
 *   from the seed, with a burning-paper edge. The seed is the atom nearest
 *   the viewer at the centre of the screen for Ink-to-Light, and for a
 *   toggle the selected atom, else the hovered one, else that centre-front
 *   atom. Frames above the listed bond graph's limit, or with bonds hidden,
 *   burn as a spherical wavefront from the seed; above FUSE_HOPS.maxAtoms
 *   the look crossfades as one. A change back while a fuse burns turns its
 *   front round. An agent's `lupi.set_viewer { inkStyle }` and the Looks
 *   grid crossfade (TOGGLE_MS).
 * - Motion: Still cuts every fade and fuse and skips Ink-to-Light (the
 *   molecule opens lit). Gentle keeps the crossfades and runs the fuse at
 *   its pace: they are a change of light, not motion.
 * - Depth cue: the plate colour and the molecule's bounding sphere, so the
 *   drawing's far side fades toward the plate as the ink drawings do.
 * - Quiet Idle: it keeps the loop awake only while it fades, burns or waits to.
 *
 * It never writes the store: the hand-off drawing is display-only, and the
 * capture guard renders exports at the configured look.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { Vector3, type Camera } from 'three';
import {
  INK_FUSE,
  INK_LOOK,
  LUPI_JOB,
  LUPI_PHASE,
  inkLookTarget,
  keepLupiAwake,
  requestLupiFrames,
  setInkFuseHops,
  setInkLookTarget,
} from '@atlas/scene';
import { MOTION, stepResponse } from '@atlas/core/motion';
import { filterPerceivedBonds } from '@atlas/core/bonds';
import type { Frame } from '@atlas/core/types';
import { useStore, type AppState } from '../store';
import { getComfort, glidesAnimate } from '../motion/comfort';
import { peekBaton, type RelayBaton } from '../relay/baton';
import { hasFirstFrame, onFirstFrame } from '../relay/firstFrame';
import { registerPlayDevHook } from '../play/devHooks';
import { inkPlateColor, takeInkFuseRequest } from './illustrate';
import { getPerceivedBonds, resolveFrameRecipe } from '../bonds/perceivedBonds';
import { FUSE_HOPS, centreFrontAtom, computeFuseHops, fuseEdgeParams, type FuseHops, type FuseMode } from './fuseHops';

/** A look change: lit ⇄ ink (ms). */
export const INK_TOGGLE_MS = 480;
/** Ink-to-Light: the light coming on after the hand-off (ms). */
export const INK_LIGHT_ON_MS = 520;
/** Wait after the first frame before the light comes on: the relay's 120 ms crossfade, and a beat. */
export const INK_LIGHT_ON_DELAY_MS = 200;
/** The Light Fuse: the front's whole run, seed to last atom (ms). */
export const INK_FUSE_MS = 1100;
/** Never hold the hand-off drawing longer than this if the first frame never comes. */
const HOLD_MAX_MS = 6_000;

/** The settle token's step response, normalised to reach 1 at `durationMs`. */
function fadeProgress(elapsedMs: number, durationMs: number): number {
  if (elapsedMs >= durationMs) return 1;
  const end = stepResponse(MOTION.settle, durationMs / 1000);
  return Math.min(1, stepResponse(MOTION.settle, Math.max(0, elapsedMs) / 1000) / end);
}

/** A baton from an ink drawing: the hero, a molecule page, or an ink tile or finder row. */
export function isDrawingBaton(baton: Pick<RelayBaton, 'source' | 'ink'> | null | undefined): boolean {
  if (!baton) return false;
  return baton.source === 'hero' || baton.source === 'page' || baton.ink === true;
}

interface FadeState {
  fromMix: number;
  fromHatch: number;
  toMix: number;
  toHatch: number;
  /** performance.now() at the fade's first frame; -1 idle; -2 starts on the next frame. */
  start: number;
  duration: number;
  /** Ink-to-Light: the drawing holds until the first frame (and the relay) is done. */
  holding: boolean;
  holdKey: object | null;
  holdSince: number;
  /** When the held drawing lets the light in (performance.now()); -1 not yet known. */
  releaseAt: number;
  /** The fade running is Ink-to-Light (a touch completes it). */
  arrival: boolean;
  /** The Light Fuse running (or the last one). */
  fuse: FuseRun;
}

interface FuseRun {
  running: boolean;
  /** How the last fuse travelled; null before the first. */
  mode: FuseMode | null;
  seed: number | null;
  /** The front, 0 (at the seed) to 1 (past the last atom). */
  progress: number;
  /** +1 burning toward `to`; −1 turned round, back toward `from`. */
  dir: 1 | -1;
  from: number;
  to: number;
  /** performance.now() of the last step; −1 before the first frame. */
  last: number;
  /** A held front (`__lupiPlay.ink('hold', p)`), or null. */
  hold: number | null;
  /** A hold asked for before the fuse starts: the next fuse begins held there. */
  armed: number | null;
  /** How many times slower than INK_FUSE_MS the fuses run (`__lupiPlay.ink('pace', k)`; 1 for visitors). */
  pace: number;
  /** The file the hops belong to. */
  key: object | null;
}

function idleFuse(): FuseRun {
  return { running: false, mode: null, seed: null, progress: 0, dir: 1, from: 0, to: 0, last: -1, hold: null, armed: null, pace: 1, key: null };
}

/** Stop a fuse where it is: the impostors read `uInkMix` alone again. */
function endFuse(fade: FadeState): void {
  if (!fade.fuse.running) return;
  fade.fuse.running = false;
  fade.fuse.hold = null;
  INK_FUSE.uFuseActive.value = 0;
  setInkFuseHops(null);
}

function cutTo(fade: FadeState): void {
  endFuse(fade);
  const target = inkLookTarget();
  INK_LOOK.uInkMix.value = target.mix;
  INK_LOOK.uInkHatch.value = target.hatch;
  fade.start = -1;
  fade.holding = false;
  fade.holdKey = null;
  fade.releaseAt = -1;
  fade.arrival = false;
}

function beginFade(fade: FadeState, durationMs: number, arrival: boolean): void {
  // A crossfade takes over from a fuse where it stands.
  endFuse(fade);
  const target = inkLookTarget();
  if (!glidesAnimate()) {
    cutTo(fade);
    return;
  }
  fade.fromMix = INK_LOOK.uInkMix.value;
  fade.fromHatch = INK_LOOK.uInkHatch.value;
  fade.toMix = target.mix;
  fade.toHatch = target.hatch;
  fade.duration = durationMs;
  fade.arrival = arrival;
  fade.start = fade.fromMix === fade.toMix && fade.fromHatch === fade.toHatch ? -1 : -2;
}

// ─── The Light Fuse ────────────────────────────────────────────────────

type FuseState = Pick<
  AppState,
  'file' | 'frame' | 'showBonds' | 'bondProfile' | 'bondTolerance' | 'showBondContacts' | 'hiddenAtomTypes' | 'selectedAtoms' | 'hoveredAtom'
>;

/** Where a fuse starts: the centre-front atom, or for a toggle the selected or hovered atom first. */
type FuseSeed = 'centre' | 'toggle';

/** The drawn bonds the front follows, when they are listed on the CPU (≤ 2,000 atoms); null for a spatial fuse. */
function drawnBondPairs(state: FuseState, frame: Frame): ArrayLike<number> | null {
  if (!state.showBonds || frame.natoms > FUSE_HOPS.graphMaxAtoms) return null;
  const trajectory = state.file?.trajectory;
  const recipe = resolveFrameRecipe(frame, {
    profile: state.bondProfile,
    frameCount: trajectory?.totalFrames ?? trajectory?.frames.length ?? 1,
  });
  if (recipe === null) return null;
  const hidden = new Set(state.hiddenAtomTypes);
  if (recipe === 'source') {
    if (hidden.size === 0) return frame.bonds;
    const kept: number[] = [];
    for (let k = 0; k + 1 < frame.bonds.length; k += 2) {
      const a = frame.bonds[k];
      const b = frame.bonds[k + 1];
      if (!hidden.has(frame.types[a]) && !hidden.has(frame.types[b])) kept.push(a, b);
    }
    return kept;
  }
  const perceived = getPerceivedBonds(frame, { recipe, tolerance: state.bondTolerance });
  if (!perceived) return null;
  return filterPerceivedBonds(perceived, { types: frame.types, hiddenTypes: hidden, showContacts: state.showBondContacts }).pairs;
}

const eyeScratch = new Vector3();
const forwardScratch = new Vector3();

/** The seed atom for a fuse on `frame`. */
function fuseSeed(state: FuseState, frame: Frame, kind: FuseSeed, camera: Camera | null): number {
  const valid = (i: number | null | undefined): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < frame.natoms;
  if (kind === 'toggle') {
    const selected = state.selectedAtoms[state.selectedAtoms.length - 1];
    if (valid(selected)) return selected;
    if (valid(state.hoveredAtom)) return state.hoveredAtom;
  }
  if (camera) {
    const hidden = new Set(state.hiddenAtomTypes);
    camera.getWorldPosition(eyeScratch);
    camera.getWorldDirection(forwardScratch);
    const centre = centreFrontAtom({
      positions: frame.positions,
      natoms: frame.natoms,
      eye: [eyeScratch.x, eyeScratch.y, eyeScratch.z],
      forward: [forwardScratch.x, forwardScratch.y, forwardScratch.z],
      skip: hidden.size > 0 ? (i) => hidden.has(frame.types[i]) : undefined,
    });
    if (centre !== null) return centre;
  }
  return 0;
}

/** The hops for a fuse on the file on screen, or null when it crossfades as one (no frame, or too many atoms). */
function planFuse(kind: FuseSeed, camera: Camera | null): (FuseHops & { key: object }) | null {
  const state = useStore.getState();
  const trajectory = state.file?.trajectory;
  const frame = trajectory?.frames[state.frame];
  if (!trajectory || !frame || !(frame.natoms > 0) || frame.natoms > FUSE_HOPS.maxAtoms) return null;
  if (frame.positions.length < frame.natoms * 3) return null;
  const seed = fuseSeed(state, frame, kind, camera);
  const hops = computeFuseHops({ positions: frame.positions, natoms: frame.natoms, seed, pairs: drawnBondPairs(state, frame) });
  return { ...hops, key: trajectory };
}

/**
 * Start the Light Fuse toward the configured look, or turn a running one
 * round. False when the change should crossfade instead (Still cuts it there;
 * a shading-only change; a frame too large for per-atom hops).
 */
function beginFuse(fade: FadeState, kind: FuseSeed, arrival: boolean, camera: Camera | null): boolean {
  if (!glidesAnimate()) return false;
  const target = inkLookTarget();
  const run = fade.fuse;
  if (run.running && run.key === (useStore.getState().file?.trajectory ?? null)) {
    // A change back while it burns: the front turns round, toward the seed.
    if (target.mix === run.from || target.mix === run.to) {
      run.dir = target.mix === run.to ? 1 : -1;
      if (target.mix > 0) INK_LOOK.uInkHatch.value = target.hatch;
      fade.arrival = arrival;
      requestLupiFrames();
      return true;
    }
  }
  endFuse(fade);
  const from = INK_LOOK.uInkMix.value;
  if (from === target.mix) return false;
  const plan = planFuse(kind, camera);
  if (!plan) {
    run.mode = 'uniform';
    run.seed = null;
    run.progress = 1;
    return false;
  }
  const edge = fuseEdgeParams(plan.span, plan.bondLength);
  setInkFuseHops(plan.hops);
  INK_FUSE.uFuseEdge.value = edge.edge;
  INK_FUSE.uFuseNoise.value = edge.noise;
  INK_FUSE.uFuseScale.value = edge.scale;
  INK_FUSE.uFuseFrom.value = from;
  INK_FUSE.uFuseTo.value = target.mix;
  INK_FUSE.uFuseFront.value = 0;
  INK_FUSE.uFuseActive.value = 1;
  // The ink arriving is drawn in its own shading from the first atom on.
  if (target.mix > from) INK_LOOK.uInkHatch.value = target.hatch;
  fade.fuse = {
    running: true,
    mode: plan.mode,
    seed: plan.seed,
    progress: 0,
    dir: 1,
    from,
    to: target.mix,
    last: -1,
    hold: run.armed,
    armed: null,
    pace: run.pace,
    key: plan.key,
  };
  fade.start = -1;
  fade.arrival = arrival;
  requestLupiFrames();
  return true;
}

/** One frame of a running fuse; false when none runs. */
function stepFuse(fade: FadeState, now: number): boolean {
  const run = fade.fuse;
  if (!run.running) return false;
  if (run.hold !== null) run.progress = run.hold;
  else if (run.last >= 0) run.progress = Math.min(1, Math.max(0, run.progress + (run.dir * (now - run.last)) / (INK_FUSE_MS * run.pace)));
  run.last = now;
  const done = run.hold === null && (run.dir === 1 ? run.progress >= 1 : run.progress <= 0);
  if (done) {
    endFuse(fade);
    const target = inkLookTarget();
    INK_LOOK.uInkMix.value = run.dir === 1 ? run.to : run.from;
    INK_LOOK.uInkHatch.value = target.hatch;
    fade.arrival = false;
    return true;
  }
  INK_FUSE.uFuseFront.value = run.progress;
  // Strictly between the two looks while the front is out, so the impostors
  // run both surfaces; each fragment's mix comes from the fuse.
  INK_LOOK.uInkMix.value = run.from + (run.to - run.from) * run.progress;
  return true;
}

export function InkLookDriver(): null {
  const inkStyle = useStore((s) => s.inkStyle);
  const inkWeight = useStore((s) => s.inkWeight);
  const trajectory = useStore((s) => s.file?.trajectory ?? null);
  const backgroundPreset = useStore((s) => s.backgroundPreset);
  const atomScale = useStore((s) => s.atomScale);
  const domElement = useThree((s) => (s.renderer as unknown as { domElement?: HTMLElement } | null)?.domElement ?? null);
  const getThree = useThree((s) => s.get);
  const fadeRef = useRef<FadeState>({
    fromMix: 0,
    fromHatch: 0,
    toMix: 0,
    toHatch: 0,
    start: -1,
    duration: INK_TOGGLE_MS,
    holding: false,
    holdKey: null,
    holdSince: 0,
    releaseAt: -1,
    arrival: false,
    fuse: idleFuse(),
  });
  const lookSeen = useRef(false);

  // The configured look: the capture target at once; the live drawing fades to it.
  useLayoutEffect(() => {
    const fade = fadeRef.current;
    const target = inkLookTarget();
    const fromUi = takeInkFuseRequest();
    setInkLookTarget({ mix: inkStyle !== 'off' ? 1 : 0, hatch: inkStyle === 'hatch' ? 1 : 0, weight: target.weight });
    if (!lookSeen.current) {
      // The look a viewer opens on is drawn at once (unless a hand-off holds the drawing).
      lookSeen.current = true;
      if (!fade.holding) cutTo(fade);
    } else if (fade.holding) {
      // A look chosen during the hand-off ends it.
      fade.holding = false;
      fade.holdKey = null;
      beginFade(fade, INK_TOGGLE_MS, false);
    } else if (!(fromUi && beginFuse(fade, 'toggle', false, getThree().camera))) {
      // A toggle from the Lupi UI burns through as a Light Fuse; anything
      // else (an agent, the Looks grid, a link) crossfades.
      beginFade(fade, INK_TOGGLE_MS, false);
    }
    requestLupiFrames();
  }, [inkStyle, getThree]);

  useLayoutEffect(() => {
    const weight = Number.isFinite(inkWeight) && inkWeight > 0 ? inkWeight : 1;
    setInkLookTarget({ ...inkLookTarget(), weight });
    INK_LOOK.uInkWeight.value = weight;
    requestLupiFrames();
  }, [inkWeight]);

  // Depth cue: the plate the far side fades toward, and the molecule's
  // bounding sphere (bounds half-diagonal plus a ball-and-stick radius).
  useLayoutEffect(() => {
    INK_LOOK.uPlateColor.value.set(inkPlateColor(backgroundPreset));
    requestLupiFrames();
  }, [backgroundPreset]);
  useLayoutEffect(() => {
    const bounds = trajectory?.globalBounds;
    if (!bounds) {
      INK_LOOK.uInkRadius.value = 0;
      return;
    }
    INK_LOOK.uInkCenter.value.set(
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    );
    const half = Math.hypot(
      (bounds.max[0] - bounds.min[0]) / 2,
      (bounds.max[1] - bounds.min[1]) / 2,
      (bounds.max[2] - bounds.min[2]) / 2,
    );
    INK_LOOK.uInkRadius.value = half + 0.5 * (Number.isFinite(atomScale) && atomScale > 0 ? atomScale : 1);
    requestLupiFrames();
  }, [trajectory, atomScale]);

  // Ink-to-Light: a molecule handed over from an ink drawing opens in ink.
  useLayoutEffect(() => {
    const fade = fadeRef.current;
    // A fuse burning on the last file's atoms ends where it is going.
    if (fade.fuse.running && fade.fuse.key !== trajectory) cutTo(fade);
    if (!trajectory) return undefined;
    const baton = peekBaton();
    const state = useStore.getState();
    if (!baton || baton.galleryId !== state.activeCardId || !isDrawingBaton(baton)) return undefined;
    if (getComfort() === 'still' || state.inkStyle !== 'off' || hasFirstFrame(trajectory)) return undefined;
    INK_LOOK.uInkMix.value = 1;
    INK_LOOK.uInkHatch.value = 0;
    fade.start = -1;
    fade.holding = true;
    fade.holdKey = trajectory;
    fade.holdSince = performance.now();
    fade.releaseAt = -1;
    fade.arrival = true;
    lookSeen.current = true;
    requestLupiFrames();
    const off = onFirstFrame((key) => {
      if (key !== trajectory || fade.holdKey !== trajectory) return;
      fade.releaseAt = performance.now() + INK_LIGHT_ON_DELAY_MS;
      requestLupiFrames();
    });
    return () => {
      off();
      // Another file arrived before the light came on: no hand-off drawing for it.
      if (fade.holdKey === trajectory) cutTo(fade);
    };
  }, [trajectory]);

  // Any touch, click, wheel or key completes Ink-to-Light.
  useEffect(() => {
    const complete = () => {
      const fade = fadeRef.current;
      if (!fade.arrival) return;
      cutTo(fade);
      requestLupiFrames();
    };
    domElement?.addEventListener('pointerdown', complete);
    domElement?.addEventListener('wheel', complete, { passive: true });
    window.addEventListener('keydown', complete);
    return () => {
      domElement?.removeEventListener('pointerdown', complete);
      domElement?.removeEventListener('wheel', complete);
      window.removeEventListener('keydown', complete);
    };
  }, [domElement]);

  // Quiet Idle: awake while a fade runs or a released hold waits for its moment.
  useEffect(
    () => keepLupiAwake('ink-look', () => {
      const fade = fadeRef.current;
      return fade.start !== -1 || (fade.holding && fade.releaseAt >= 0) || (fade.fuse.running && fade.fuse.hold === null);
    }),
    [],
  );

  useEffect(
    () => registerPlayDevHook('ink', (command?: string, value?: number) => {
      const fade = fadeRef.current;
      // 'hold', p: hold the front at p (0..1), the running fuse's or the next
      // one's (software renderers draw too few frames to catch one in flight);
      // 'release' lets it burn on; 'pace', k runs fuses k times slower (1 again
      // for the visitor's pace).
      if (command === 'hold' && Number.isFinite(value)) {
        const at = Math.min(1, Math.max(0, value as number));
        if (fade.fuse.running) fade.fuse.hold = at;
        else fade.fuse.armed = at;
        requestLupiFrames();
      } else if (command === 'pace' && Number.isFinite(value) && (value as number) > 0) {
        fade.fuse.pace = Math.min(20, Math.max(1, value as number));
      } else if (command === 'release') {
        fade.fuse.armed = null;
        if (fade.fuse.hold !== null) {
          fade.fuse.hold = null;
          fade.fuse.last = -1;
          requestLupiFrames();
        }
      }
      const run = fade.fuse;
      // A frame too large for per-atom hops crossfades as one ('uniform').
      const uniformFade = !run.running && run.mode === 'uniform' && fade.start !== -1;
      const span = fade.toMix - fade.fromMix;
      return {
        mix: INK_LOOK.uInkMix.value,
        hatch: INK_LOOK.uInkHatch.value,
        weight: INK_LOOK.uInkWeight.value,
        target: inkLookTarget(),
        holding: fade.holding,
        fading: fade.start !== -1,
        arrival: fade.arrival,
        fuse: {
          running: run.running || uniformFade,
          seed: run.seed,
          progress: uniformFade && span !== 0 ? (INK_LOOK.uInkMix.value - fade.fromMix) / span : run.progress,
          mode: run.mode,
          held: run.hold !== null,
        },
      };
    }),
    [],
  );

  // Leaving the viewer: the next one opens on its own look, cut, not faded.
  useEffect(() => () => {
    endFuse(fadeRef.current);
    INK_LOOK.uInkMix.value = 0;
    INK_LOOK.uInkHatch.value = 0;
    setInkLookTarget({ mix: 0, hatch: 0, weight: 1 });
    lookSeen.current = false;
  }, []);

  useFrame(
    () => {
      const fade = fadeRef.current;
      const now = performance.now();
      if (fade.holding) {
        const expired = now - fade.holdSince > HOLD_MAX_MS;
        if (!expired && (fade.releaseAt < 0 || now < fade.releaseAt)) return;
        fade.holding = false;
        fade.holdKey = null;
        fade.releaseAt = -1;
        // The light comes on from the atom nearest the viewer at the centre.
        if (!beginFuse(fade, 'centre', true, getThree().camera)) beginFade(fade, INK_LIGHT_ON_MS, true);
      }
      if (stepFuse(fade, now)) return;
      if (fade.start === -1) return;
      if (fade.start === -2) fade.start = now;
      const p = fadeProgress(now - fade.start, fade.duration);
      INK_LOOK.uInkMix.value = fade.fromMix + (fade.toMix - fade.fromMix) * p;
      INK_LOOK.uInkHatch.value = fade.fromHatch + (fade.toHatch - fade.fromHatch) * p;
      if (p >= 1) {
        INK_LOOK.uInkMix.value = fade.toMix;
        INK_LOOK.uInkHatch.value = fade.toHatch;
        fade.start = -1;
        fade.arrival = false;
      }
    },
    { phase: LUPI_PHASE.uniforms, id: LUPI_JOB.inkLook },
  );

  return null;
}
