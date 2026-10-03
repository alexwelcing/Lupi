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
 *   comes on (LIGHT_ON_MS). Any touch, click, wheel or key completes it.
 * - Motion: Still cuts every fade and skips Ink-to-Light (the molecule opens
 *   lit). Gentle keeps the crossfades: they are a change of light, not
 *   motion.
 * - Quiet Idle: it keeps the loop awake only while it fades or waits to.
 *
 * It never writes the store: the hand-off drawing is display-only, and the
 * capture guard renders exports at the configured look.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import {
  INK_LOOK,
  LUPI_JOB,
  LUPI_PHASE,
  inkLookTarget,
  keepLupiAwake,
  requestLupiFrames,
  setInkLookTarget,
} from '@atlas/scene';
import { MOTION, stepResponse } from '@atlas/core/motion';
import { useStore } from '../store';
import { getComfort, glidesAnimate } from '../motion/comfort';
import { peekBaton, type RelayBaton } from '../relay/baton';
import { hasFirstFrame, onFirstFrame } from '../relay/firstFrame';
import { registerPlayDevHook } from '../play/devHooks';

/** A look change: lit ⇄ ink (ms). */
export const INK_TOGGLE_MS = 480;
/** Ink-to-Light: the light coming on after the hand-off (ms). */
export const INK_LIGHT_ON_MS = 520;
/** Wait after the first frame before the light comes on: the relay's 120 ms crossfade, and a beat. */
export const INK_LIGHT_ON_DELAY_MS = 200;
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
}

function cutTo(fade: FadeState): void {
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

export function InkLookDriver(): null {
  const inkStyle = useStore((s) => s.inkStyle);
  const inkWeight = useStore((s) => s.inkWeight);
  const trajectory = useStore((s) => s.file?.trajectory ?? null);
  const domElement = useThree((s) => (s.renderer as unknown as { domElement?: HTMLElement } | null)?.domElement ?? null);
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
  });
  const lookSeen = useRef(false);

  // The configured look: the capture target at once; the live drawing fades to it.
  useLayoutEffect(() => {
    const fade = fadeRef.current;
    const target = inkLookTarget();
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
    } else {
      beginFade(fade, INK_TOGGLE_MS, false);
    }
    requestLupiFrames();
  }, [inkStyle]);

  useLayoutEffect(() => {
    const weight = Number.isFinite(inkWeight) && inkWeight > 0 ? inkWeight : 1;
    setInkLookTarget({ ...inkLookTarget(), weight });
    INK_LOOK.uInkWeight.value = weight;
    requestLupiFrames();
  }, [inkWeight]);

  // Ink-to-Light: a molecule handed over from an ink drawing opens in ink.
  useLayoutEffect(() => {
    if (!trajectory) return undefined;
    const fade = fadeRef.current;
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
      return fade.start !== -1 || (fade.holding && fade.releaseAt >= 0);
    }),
    [],
  );

  useEffect(
    () => registerPlayDevHook('ink', () => {
      const fade = fadeRef.current;
      return {
        mix: INK_LOOK.uInkMix.value,
        hatch: INK_LOOK.uInkHatch.value,
        weight: INK_LOOK.uInkWeight.value,
        target: inkLookTarget(),
        holding: fade.holding,
        fading: fade.start !== -1,
        arrival: fade.arrival,
      };
    }),
    [],
  );

  // Leaving the viewer: the next one opens on its own look, cut, not faded.
  useEffect(() => () => {
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
        beginFade(fade, INK_LIGHT_ON_MS, true);
      }
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
