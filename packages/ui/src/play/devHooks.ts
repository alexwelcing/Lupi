/**
 * devHooks.ts — `window.__lupiPlay`, the Play layer's handle for local smoke
 * plugins and agents (installed in production too, like __lupiViewerMcp).
 *
 *   __lupiPlay.state()  → { verb, trayOpen, displaced, flash, comfort, rig, motion, firstFrame,
 *                           frames, frameDemand }
 *     `frames` counts the frames the viewer has drawn: read it twice a few
 *     seconds apart on a still view and it should not move (Quiet Idle).
 *     `frameDemand` says what is keeping the loop awake (`awakeBy`).
 *   __lupiPlay.reset()  → emits play.reset (a registered 'reset' hook replaces this default)
 *   __lupiPlay.emit(intent) → emits any intent, exactly as the UI would (lets a
 *                         smoke plugin drive Scatter, Spin or a stroke before
 *                         the pill that emits it exists)
 *   __lupiPlay.poke/flick/catch/scatter/stepDetent(...) once their owner registers them
 *   __lupiPlay.burst(atomIndex), .tug(atomIndex, [dx, dy, dz], holdMs), .heat(level)
 *                         the Play verbs' toys, driven without a pointer
 *   __lupiPlay.viewInset() → { current, target, occluders }: the phone framing
 *                         ({ x, y, scale }: CSS px and zoom-out) that makes room
 *                         for the declared phone sheets and cards, and their ids,
 *                         once the viewer registers it
 *   __lupiPlay.follow() → { moving, followers, displaced, points, maxOffset }:
 *                         the overlays riding display motion (labels, rings, the
 *                         card anchor, measurements, trails); all displaced
 *                         counts are 0 and maxOffset is 0 at rest
 *   __lupiPlay.replay()  → Instant Replay: the offered (or last) moment as a tape
 *                         ({ moment, keys, events, bytes, link }); replay('watch')
 *                         starts a waiting shared replay; replay('moment') offers
 *                         the last 4 s as a moment
 *   __lupiPlay.remix()   → Remix: { code, foil, finish, status, morphing };
 *                         remix('roll') rolls, remix('undo') steps back,
 *                         remix('r1-K7QDM') applies a code
 *   __lupiPlay.ink()    → { mix, hatch, weight, target, holding, fading, arrival }:
 *                         the Illustrate look's live weights and Ink-to-Light state
 *
 * It only reads state and triggers the same intents as the UI; it never
 * writes molecule data.
 *
 * Contract file: additive edits only.
 */
import { emitIntent, lupiFrameStats, type LupiFrameStats, type LupiIntent } from '@atlas/scene';
import { useStore } from '../store';
import { getComfort, type Comfort } from '../motion/comfort';
import { getCameraRig, type Vec3 } from '../camera/rigApi';
import { hasFirstFrame } from '../relay/firstFrame';
import { playStore, type PlayVerb } from './playStore';

export type PlayDevHookName =
  | 'rig'
  | 'motion'
  | 'poke'
  | 'flick'
  | 'catch'
  | 'scatter'
  | 'stepDetent'
  | 'reset'
  | 'frames'
  | 'burst'
  | 'tug'
  | 'heat'
  | 'viewInset'
  | 'follow'
  | 'replay'
  | 'remix'
  | 'ink';

export interface PlayRigState {
  position: Vec3;
  target: Vec3;
  moving: boolean;
  restCount: number;
}

export interface PlayMotionState {
  active: boolean;
  weight: number;
}

export interface PlayFrameDemandState extends LupiFrameStats {
  /** The viewer canvas's frameloop ('demand' unless `?frameloop=always`); null without a canvas. */
  frameloop: string | null;
}

export interface LupiPlayState {
  verb: PlayVerb;
  trayOpen: boolean;
  displaced: boolean;
  flash: string | null;
  comfort: Comfort;
  rig: PlayRigState | null;
  motion: PlayMotionState | null;
  firstFrame: boolean;
  /** Frames the viewer has drawn since the page loaded. */
  frames: number;
  frameDemand: PlayFrameDemandState;
}

type DevHook = (...args: any[]) => any;

export interface LupiPlayDevApi {
  state(): LupiPlayState;
  reset(): void;
  emit(intent: LupiIntent): void;
  poke?: DevHook;
  flick?: DevHook;
  catch?: DevHook;
  scatter?: DevHook;
  stepDetent?: DevHook;
  burst?: DevHook;
  tug?: DevHook;
  heat?: DevHook;
  viewInset?: DevHook;
  follow?: DevHook;
  replay?: DevHook;
  remix?: DevHook;
  /** The Illustrate look: `{ mix, hatch, weight, target, holding, fading, arrival }` (ink/InkLookDriver.tsx). */
  ink?: DevHook;
}

declare global {
  interface Window {
    __lupiPlay?: LupiPlayDevApi;
  }
}

const hooks = new Map<PlayDevHookName, DevHook>();
type ExposedHookName =
  | 'poke'
  | 'flick'
  | 'catch'
  | 'scatter'
  | 'stepDetent'
  | 'burst'
  | 'tug'
  | 'heat'
  | 'viewInset'
  | 'follow'
  | 'replay'
  | 'remix'
  | 'ink';
const EXPOSED: ReadonlyArray<ExposedHookName> = [
  'poke',
  'flick',
  'catch',
  'scatter',
  'stepDetent',
  'burst',
  'tug',
  'heat',
  'viewInset',
  'follow',
  'replay',
  'remix',
  'ink',
];
let installs = 0;
let api: LupiPlayDevApi | null = null;

function callHook<T>(name: PlayDevHookName): T | null {
  const hook = hooks.get(name);
  if (!hook) return null;
  try {
    return (hook() as T) ?? null;
  } catch (error) {
    console.error(`[lupi] __lupiPlay ${name} hook threw`, error);
    return null;
  }
}

function readRig(): PlayRigState | null {
  const fromHook = callHook<PlayRigState>('rig');
  if (fromHook) return fromHook;
  const rig = getCameraRig();
  if (!rig) return null;
  const pose = rig.pose();
  return {
    position: [...pose.position] as Vec3,
    target: [...pose.target] as Vec3,
    moving: rig.isMoving(),
    restCount: rig.restCount(),
  };
}

export function readPlayState(): LupiPlayState {
  const play = playStore.getState();
  const trajectory = useStore.getState().file?.trajectory;
  return {
    verb: play.verb,
    trayOpen: play.trayOpen,
    displaced: play.displaced,
    flash: play.flash ? play.flash.text : null,
    comfort: getComfort(),
    rig: readRig(),
    motion: callHook<PlayMotionState>('motion'),
    firstFrame: trajectory ? hasFirstFrame(trajectory) : false,
    frames: lupiFrameStats().rendered,
    frameDemand: callHook<PlayFrameDemandState>('frames') ?? { ...lupiFrameStats(), frameloop: null },
  };
}

const defaultReset = (): void => emitIntent({ type: 'play.reset' });

function syncExposedHooks(): void {
  if (!api) return;
  for (const name of EXPOSED) {
    const hook = hooks.get(name);
    if (hook) api[name] = hook;
    else delete api[name];
  }
  api.reset = hooks.get('reset') ?? defaultReset;
}

/** Install `window.__lupiPlay` (ref-counted); returns the uninstall. */
export function installPlayDevHooks(): () => void {
  if (typeof window === 'undefined') return () => {};
  installs += 1;
  if (installs === 1) {
    api = {
      state: readPlayState,
      reset: defaultReset,
      emit: (intent: LupiIntent) => emitIntent(intent),
    };
    syncExposedHooks();
    window.__lupiPlay = api;
  }
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    installs -= 1;
    if (installs === 0) {
      if (window.__lupiPlay === api) delete window.__lupiPlay;
      api = null;
    }
  };
}

/** Register a named hook (`rig` and `motion` feed state(); `reset` replaces the default; the rest are exposed as methods). */
export function registerPlayDevHook(name: PlayDevHookName, fn: DevHook): () => void {
  hooks.set(name, fn);
  syncExposedHooks();
  return () => {
    if (hooks.get(name) === fn) {
      hooks.delete(name);
      syncExposedHooks();
    }
  };
}
