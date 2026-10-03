/**
 * session.ts — from a moment to something you can send.
 *
 * - `buildTape(moment)`: the recorder's window as a tape (decimated keys, the
 *   toy inputs and flashes). Under Motion: Still, or for a plain "view", it
 *   is a static pose: the moment's last pose and nothing that moves.
 * - `replayLink(token)`: the live link. It keeps only what opens the same
 *   molecule (`sim`, `load`, `molecule`, a saved view's route) and adds
 *   `replay=`. A molecule with no address (a dropped file, a generated
 *   lattice) has no live link; the clip still works.
 * - The view context the canvas registers (FOV, aspect, frame, the
 *   molecule's centre and radius), so DOM code can build tapes and framings.
 */
import type { Vec3 } from '../camera/rigApi';
import { getComfort } from '../motion/comfort';
import { decimate } from './keyframes';
import { recordedWindow, recorderNow } from './recorder';
import type { ReplayMoment } from './replayStore';
import { encodeTape, isToyEvent, TAPE_MAX_SECONDS, TAPE_VERSION, type Tape } from './tape';

export interface ReplayViewContext {
  /** Vertical FOV (degrees). */
  fov: number;
  /** Canvas width / height. */
  aspect: number;
  /** Current trajectory frame and frame count. */
  frame: number;
  totalFrames: number;
  /** Molecule centre and bounding radius (world). */
  center: Vec3;
  radius: number;
  /** The molecule's display name. */
  name: string;
  /** The molecule's page id (/m/<id>), when it has one. */
  pageId: string | null;
}

let contextGetter: (() => ReplayViewContext | null) | null = null;

/** The canvas registers where the view context comes from; returns the unregister. */
export function registerReplayViewContext(getter: () => ReplayViewContext | null): () => void {
  contextGetter = getter;
  return () => {
    if (contextGetter === getter) contextGetter = null;
  };
}

export function replayViewContext(): ReplayViewContext | null {
  try {
    return contextGetter?.() ?? null;
  } catch {
    return null;
  }
}

/** A `replay=` value longer than this is rebuilt with looser keys (chars). */
const TOKEN_BUDGET = 2600;

export interface BuiltTape {
  tape: Tape;
  token: string;
}

/** The moment as a tape and its `replay=` value; null when nothing was recorded. */
export function buildTape(moment: ReplayMoment): BuiltTape | null {
  const context = replayViewContext();
  const planned = Math.min(TAPE_MAX_SECONDS, Math.max(0, moment.t1 - moment.t0));
  const end = Math.min(moment.t1, recorderNow());
  const window = recordedWindow(moment.t0, Math.max(end, moment.t0 + 1e-3));
  if (!window || window.poses.length === 0) return null;
  const still = getComfort() === 'still' || moment.moment === 'view';
  const base: Omit<Tape, 'keys' | 'events' | 'duration' | 'still'> = {
    version: TAPE_VERSION,
    moment: moment.moment,
    gesture: moment.gesture,
    fov: context?.fov ?? 50,
    aspect: context?.aspect ?? 1,
    frame: context && context.totalFrames > 1 ? context.frame : 0,
  };
  if (still) {
    const last = window.poses[window.poses.length - 1];
    const keys = decimate([{ ...last, t: 0 }]);
    const tape: Tape = { ...base, still: true, duration: 0, keys, events: [] };
    return { tape, token: encodeTape(tape) };
  }
  const events = window.events.filter((event) => event.t <= planned + 1e-3);
  let looseness = 1;
  let built: BuiltTape | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const keys = decimate(window.poses, looseness);
    if (keys.length === 0) return null;
    const tape: Tape = { ...base, still: false, duration: planned, keys, events };
    const token = encodeTape(tape);
    built = { tape, token };
    if (token.length <= TOKEN_BUDGET) break;
    looseness *= 2;
  }
  return built;
}

/** The tape moves toys (its replay and clip are illustrative motion). */
export function tapeHasToys(tape: Tape): boolean {
  return tape.events.some(isToyEvent);
}

/** Query parameters that say which molecule a link opens. */
const SOURCE_PARAMS = ['sim', 'load', 'molecule'] as const;

/** The live link for a `replay=` value, or null when this molecule has no address. */
export function replayLink(token: string, href: string = typeof window !== 'undefined' ? window.location.href : ''): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const params = new URLSearchParams();
  for (const key of SOURCE_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  const hash = url.hash.startsWith('#/view/') ? url.hash.split('?')[0] : '';
  if (!params.toString() && !hash) return null;
  params.set('replay', token);
  return `${url.origin}/?${params.toString()}${hash}`;
}

/** The molecule's own page (/m/<id>) when it has one, for the clip's end card. */
export function moleculePageLabel(context: ReplayViewContext | null): string {
  if (!context?.pageId) return 'lupi.live';
  return `lupi.live/m/${context.pageId}`;
}
