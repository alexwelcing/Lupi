/**
 * moments.ts — notices The Shot: a moment worth sending.
 *
 * - **A good flick**: a coast that turned at least 1.2 half-turns, or one
 *   that clicked into a named face after a quarter turn.
 * - **A detent chain**: three or more named faces in a row, each within 4.5 s
 *   of the last (flicks or arrow keys).
 * - **A flip**: Spin's tennis-racket flip (or one a flick found itself).
 * - **A toy moment**: a burst, a tug that was pulled, heat held for most of a
 *   second, a scatter, or a good stir of ripples, once the atoms are home.
 *
 * When one settles, the pill offers "Replay ↗" for 7 s. The moment's window
 * runs from just before its gesture to half a second after it came to rest,
 * at most 8 s (the end is kept). It also records what the replay needs that
 * only happens here: the pill's flashes and the toys' inputs.
 */
import { onIntent } from '@atlas/scene';
import { getCameraRig } from '../camera/rigApi';
import { playStore, type PlayFlash } from '../play/playStore';
import { onToyEvent, type ToyEvent } from '../play/toyTape';
import { isRecorderPaused, recordEvent, recorderNow, turnedBetween, type RecordedEvent } from './recorder';
import { replayStore, type ReplayMoment } from './replayStore';
import type { MomentGesture, MomentKind } from './tape';

export const MOMENT = {
  /** How long the pill offers a moment (ms). */
  offerMs: 7000,
  /** Longest moment (s): a longer one keeps its end. */
  maxSeconds: 8,
  /** Lead before the gesture and tail after rest (s). */
  leadS: 0.35,
  tailS: 0.5,
  /** At most this much of the drag before a flick (s). */
  dragLeadS: 1.2,
  /** A coast that turned this far is a moment (rad). */
  flickTurn: 1.2 * Math.PI,
  /** …or this far into a named face. */
  detentTurn: 0.5 * Math.PI,
  chainCount: 3,
  chainGapS: 4.5,
  /** Heat held this long (s) is a moment. */
  heatHeldS: 0.8,
  /** A stir of this many ripples is a moment. */
  stirRipples: 6,
  /** Tug pulls (pointer moves) that make a tug a moment. */
  tugPulls: 4,
} as const;

/** Tug pulls closer than this merge on the tape (s); heat rubs closer than this add up. */
const PULL_MERGE_S = 1 / 30;
const RUB_MERGE_S = 0.1;

const NOUN_BY_GESTURE: Readonly<Record<MomentGesture, string>> = {
  flick: 'your spin',
  drag: 'your spin',
  keys: 'your face hops',
  spin: 'the flip',
  poke: 'the ripples',
  tug: 'the tug',
  burst: 'the burst',
  heat: 'the heat',
  scatter: 'the scatter',
};

export function momentNoun(moment: MomentKind, gesture: MomentGesture | null): string {
  if (moment === 'chain') return gesture === 'keys' ? 'your face hops' : 'your face chain';
  if (moment === 'flip') return 'the flip';
  if (moment === 'view') return 'this view';
  return gesture ? NOUN_BY_GESTURE[gesture] : 'that moment';
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

let momentSeq = 0;

/** Offer a moment on the pill (and remember it for R). */
export function offerMoment(moment: MomentKind, gesture: MomentGesture | null, t0: number, t1: number): ReplayMoment | null {
  const store = replayStore.getState();
  if (isRecorderPaused() || store.sheet || store.clipping || store.incoming?.phase === 'playing') return null;
  const start = Math.max(t0, t1 - MOMENT.maxSeconds);
  if (!(t1 > start)) return null;
  momentSeq += 1;
  const at = nowMs();
  const entry: ReplayMoment = { id: momentSeq, moment, gesture, t0: start, t1, noun: momentNoun(moment, gesture), at };
  store.setLastMoment(entry);
  store.setOffer({ ...entry, until: at + MOMENT.offerMs });
  return entry;
}

interface ToyEpisode {
  start: number;
  bursts: number;
  tugPulls: number;
  tugGrabs: number;
  heatOnAt: number | null;
  heatHeld: number;
  scatters: number;
  ripples: number;
  pokes: number;
  gesture: MomentGesture | null;
}

function toyGesture(event: ToyEvent): MomentGesture | null {
  switch (event.kind) {
    case 'burst':
      return 'burst';
    case 'tugGrab':
    case 'tugPull':
      return 'tug';
    case 'heatOn':
    case 'heatRub':
      return 'heat';
    case 'scatter':
      return 'scatter';
    case 'poke':
    case 'ripple':
      return 'poke';
    default:
      return null;
  }
}

const GESTURE_RANK: Readonly<Record<string, number>> = { poke: 1, heat: 2, tug: 3, burst: 4, scatter: 5 };

function toyEpisodeCounts(toy: ToyEpisode): boolean {
  return (
    toy.bursts > 0 ||
    toy.scatters > 0 ||
    (toy.tugGrabs > 0 && toy.tugPulls >= MOMENT.tugPulls) ||
    toy.heatHeld >= MOMENT.heatHeldS ||
    toy.ripples >= MOMENT.stirRipples ||
    toy.pokes >= 3
  );
}

function toToyRecord(event: ToyEvent, t: number): RecordedEvent {
  return { ...event, t } as RecordedEvent;
}

/**
 * Watch the viewer for moments and record the flashes and toy inputs.
 * Returns the uninstall.
 */
export function installMomentDetector(): () => void {
  let gestureAt: number | null = null;
  let keyStepAt: number | null = null;
  let flingAt: number | null = null;
  let spinAt: number | null = null;
  let flipAt: number | null = null;
  let detents: Array<{ t: number; start: number; gesture: MomentGesture }> = [];
  let toy: ToyEpisode | null = null;
  let lastPull: RecordedEvent | null = null;
  let lastRub: (RecordedEvent & { kind: 'heatRub' }) | null = null;
  let pendingRest: ReturnType<typeof setTimeout> | null = null;
  /** The last detent a chain offer already covers (no second offer for the same chain). */
  let chainOfferedThrough = -Infinity;
  /** A toy moment that ended while the camera still coasted: offered at its rest. */
  let deferredToy: { start: number; gesture: MomentGesture | null } | null = null;

  /** Where the gesture that led to now began. */
  const episodeStart = (now: number): { start: number; gesture: MomentGesture } => {
    if (flingAt !== null) {
      const drag = gestureAt !== null && gestureAt <= flingAt && flingAt - gestureAt < 4 ? gestureAt : flingAt;
      const fromSpin = spinAt !== null && Math.abs(flingAt - spinAt) < 0.3;
      return { start: Math.max(drag, flingAt - MOMENT.dragLeadS) - MOMENT.leadS, gesture: fromSpin ? 'spin' : 'flick' };
    }
    if (keyStepAt !== null && now - keyStepAt < 3) return { start: keyStepAt - MOMENT.leadS, gesture: 'keys' };
    if (gestureAt !== null && now - gestureAt < 6) return { start: gestureAt - MOMENT.leadS, gesture: 'drag' };
    return { start: now - 1.2, gesture: 'drag' };
  };

  const evaluateRest = (now: number, detentLabel: string | null) => {
    const { start, gesture } = episodeStart(now);
    const end = now + MOMENT.tailS;
    const chainTail: typeof detents = [];
    for (let i = detents.length - 1; i >= 0; i -= 1) {
      const next = chainTail[0];
      if (next && next.t - detents[i].t > MOMENT.chainGapS) break;
      if (!next && now - detents[i].t > MOMENT.chainGapS) break;
      chainTail.unshift(detents[i]);
    }
    const lastDetent = chainTail[chainTail.length - 1];
    let offered = false;
    if (chainTail.length >= MOMENT.chainCount && now - lastDetent.t < 1.5) {
      if (lastDetent.t > chainOfferedThrough) {
        chainOfferedThrough = lastDetent.t;
        const keys = chainTail.every((entry) => entry.gesture === 'keys');
        offered = offerMoment('chain', keys ? 'keys' : 'flick', chainTail[0].start, end) !== null;
      }
    } else if (flingAt !== null) {
      const turned = turnedBetween(flingAt, now);
      if (flipAt !== null && flipAt >= flingAt - 0.05) {
        offered = offerMoment('flip', spinAt !== null && Math.abs(flingAt - spinAt) < 0.3 ? 'spin' : 'flick', start, end) !== null;
      } else if (turned >= MOMENT.flickTurn || (detentLabel && turned >= MOMENT.detentTurn)) {
        offered = offerMoment('flick', gesture, start, end) !== null;
      }
    }
    // Toys that settled while the camera still turned: the moment is both.
    if (deferredToy && !offered) offerMoment('toy', deferredToy.gesture, Math.min(deferredToy.start, start), end);
    deferredToy = null;
    flingAt = null;
    flipAt = null;
    spinAt = null;
    gestureAt = null;
  };

  const onFlash = (flash: PlayFlash | null, previous: PlayFlash | null) => {
    if (!flash || flash === previous) return;
    if (flash.kind !== 'detent' && flash.kind !== 'flip' && flash.kind !== 'catch') return;
    const t = recorderNow();
    recordEvent({ t, kind: 'label', flash: flash.kind, text: flash.text });
    if (flash.kind === 'detent' && !isRecorderPaused()) {
      const { start, gesture } = episodeStart(t);
      detents.push({ t, start, gesture: gesture === 'keys' ? 'keys' : 'flick' });
      detents = detents.filter((entry) => t - entry.t < 20);
      // Arrow-key hops rest without a fling: judge the chain here.
      if (flingAt === null && gesture === 'keys') {
        const chain: typeof detents = [];
        for (let i = detents.length - 1; i >= 0; i -= 1) {
          const next = chain[0];
          if (next && next.t - detents[i].t > MOMENT.chainGapS) break;
          chain.unshift(detents[i]);
        }
        if (chain.length >= MOMENT.chainCount) {
          chainOfferedThrough = t;
          offerMoment('chain', chain.every((entry) => entry.gesture === 'keys') ? 'keys' : 'flick', chain[0].start, t + MOMENT.tailS);
        }
        keyStepAt = null;
      }
    }
  };

  const onToy = (event: ToyEvent) => {
    if (isRecorderPaused()) return;
    const t = recorderNow();
    // Pointer-rate inputs merge on the tape: the latest pull wins, rubs add up.
    if (event.kind === 'tugPull' && lastPull && t - lastPull.t < PULL_MERGE_S) {
      Object.assign(lastPull, { d: event.d });
    } else if (event.kind === 'heatRub' && lastRub && t - lastRub.t < RUB_MERGE_S) {
      lastRub.amount = Math.min(0.255, lastRub.amount + event.amount);
    } else {
      const record = toToyRecord(event, t);
      recordEvent(record);
      lastPull = record.kind === 'tugPull' ? record : lastPull;
      lastRub = record.kind === 'heatRub' ? (record as RecordedEvent & { kind: 'heatRub' }) : lastRub;
    }
    if (event.kind === 'reset') return;
    if (!toy) {
      toy = {
        start: t,
        bursts: 0,
        tugPulls: 0,
        tugGrabs: 0,
        heatOnAt: null,
        heatHeld: 0,
        scatters: 0,
        ripples: 0,
        pokes: 0,
        gesture: null,
      };
    }
    const g = toyGesture(event);
    if (g && (!toy.gesture || (GESTURE_RANK[g] ?? 0) >= (GESTURE_RANK[toy.gesture] ?? 0))) toy.gesture = g;
    switch (event.kind) {
      case 'burst':
        toy.bursts += 1;
        break;
      case 'tugGrab':
        toy.tugGrabs += 1;
        break;
      case 'tugPull':
        toy.tugPulls += 1;
        break;
      case 'heatOn':
        toy.heatOnAt = t;
        break;
      case 'heatOff':
        if (toy.heatOnAt !== null) toy.heatHeld += t - toy.heatOnAt;
        toy.heatOnAt = null;
        break;
      case 'scatter':
        toy.scatters += 1;
        break;
      case 'ripple':
        toy.ripples += 1;
        break;
      case 'poke':
        toy.pokes += 1;
        break;
      default:
        break;
    }
  };

  const endToyEpisode = () => {
    const episode = toy;
    toy = null;
    if (!episode || isRecorderPaused()) return;
    const t = recorderNow();
    if (episode.heatOnAt !== null) episode.heatHeld += t - episode.heatOnAt;
    if (!toyEpisodeCounts(episode)) return;
    // The camera still coasting: offer at its rest, with the toys in the window.
    if (getCameraRig()?.isMoving()) {
      deferredToy = { start: episode.start - MOMENT.leadS, gesture: episode.gesture };
      return;
    }
    offerMoment('toy', episode.gesture, episode.start - MOMENT.leadS, t + 0.4);
  };

  const offs = [
    onIntent('camera.gestureStart', () => {
      gestureAt = recorderNow();
    }),
    onIntent('camera.detentStep', () => {
      keyStepAt = recorderNow();
    }),
    onIntent('camera.fling', () => {
      flingAt = recorderNow();
      flipAt = null;
    }),
    onIntent('play.spin', () => {
      spinAt = recorderNow();
    }),
    onIntent('spin.flip', () => {
      flipAt = recorderNow();
    }),
    onIntent('camera.rest', ({ detentLabel, userMoved }) => {
      if (isRecorderPaused()) return;
      const t = recorderNow();
      if (!userMoved && flingAt === null) return;
      // Let the detent's flash land first (CameraToys flashes on this same intent).
      if (pendingRest !== null) clearTimeout(pendingRest);
      pendingRest = setTimeout(() => {
        pendingRest = null;
        evaluateRest(t, detentLabel);
      }, 0);
    }),
    playStore.subscribe((state, previous) => {
      if (state.flash !== previous.flash) onFlash(state.flash, previous.flash);
      const wasLive = previous.displacedSources.some((source) => source !== 'arrival');
      const live = state.displacedSources.some((source) => source !== 'arrival');
      if (wasLive && !live) endToyEpisode();
    }),
    onToyEvent(onToy),
  ];

  return () => {
    for (const off of offs) off();
    if (pendingRest !== null) clearTimeout(pendingRest);
  };
}
