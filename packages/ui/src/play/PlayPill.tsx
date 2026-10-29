/**
 * PlayPill — the one floating pill: [● Play] [status] [stow].
 *
 * - **Play** opens the Play tray (so do `P`, a right click on empty canvas
 *   and the palette's "Open Play", all through `play.toggleTray`). With a
 *   verb latched it reads "Poke ×", "Tug ×", "Burst ×" or "Heat ×"; the ×
 *   goes back to Orbit. Latching a verb flashes one line on what it does.
 * - **Status** (`role="status"`), in precedence order:
 *   1. "Illustrative · Reset" while display-only motion has atoms away from
 *      their rest positions (ripple, scatter, tug, burst and heat hold 1.5 s
 *      after they end; the arrival shows only while it runs). The first toy
 *      of a session spells it out: "Illustrative motion, your atoms haven't
 *      moved". While atoms are warm a small thermometer reads the Heat level
 *      as an illustrative temperature (300 K at rest).
 *   2. a flash (detent label, "Caught", "Flip!") until it expires;
 *   3. the teaching line on a first visit, from the file's first frame
 *      until the first gesture, an atom tap or 10 s later. It waits for
 *      the frame so that a first visit reads the arrival's label and then
 *      the line, instead of line, label, line again;
 *   4. nothing (the segment collapses).
 *   Each shown text stays at least 1 s, except that the honesty label
 *   always shows at once.
 * - **Stow** keeps the old "Clear view" bucket's exact semantics:
 *   `aria-label` "Stow viewer controls" / "Restore viewer controls",
 *   `aria-pressed`, and "Clear view" / "Restore" (icon only on a phone).
 *
 * A latched verb auto-unlatches after 30 s without a stroke, press or tap,
 * on a file change and under Motion: Still. While latched the viewport gets
 * a thin lime inset (warm while Heat is held).
 *
 * Remix lives in the same pill too:
 * - a roll flashes its code in the status ("Remix · r1-K7QDM"; one in 24
 *   reads "✦ Holo foil · r1-K7QDM" with its chime);
 * - "⟳ Again" for 8 s after a roll rolls the next one;
 * - while a Foil finish is on screen, a small foil chip ("✦ Holo") stays as
 *   the "cosmetic finish" badge and opens the Remix sheet;
 * - under the Illustrate look the finish rests (a drawing carries no foil),
 *   so neither the flash nor the chip names it until the light comes back.
 *
 * Instant Replay lives in the same pill, as one more segment before stow:
 * - "Replay ↗" for 7 s after a moment (a good flick, a detent chain, a flip,
 *   a toy moment); it opens the share sheet (so does R);
 * - on a shared replay link, the status reads "Shared replay" and the segment
 *   is "▶ Watch" (Gentle, or before Standard's autoplay) or "Skip" while it
 *   plays; the end flashes "Your turn · …" (flash kind `turn`).
 */
import { useCallback, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { emitIntent, isCanvasInputSourceActive, onIntent } from '@atlas/scene';
import { useStore } from '../store';
import { MAX_INTERACTIVE_PICKING_ATOMS } from '../deviceCapabilities';
import { MOBILE_MEDIA_QUERY } from '../hooks/useMediaQuery';
import { useComfort } from '../motion/comfort';
import { hasFirstFrame, onFirstFrame } from '../relay/firstFrame';
import { cue } from './feedback';
import { PLAY_VERB_LABEL, heatKelvin, playStore, playVerbHint, usePlayStore } from './playStore';
import { PlayTray } from './PlayTray';
import { isIncomingActive, replayStore, useReplayStore } from '../replay/replayStore';
import { openRemixSheet, rollRemix } from '../remix/actions';
import { FOIL_LABEL } from '../remix/code';
import { shownFinish, useRemixStore } from '../remix/remixStore';
import './playPill.css';

export interface PlayPillProps {
  uiStowed: boolean;
  setUiStowed: Dispatch<SetStateAction<boolean>>;
}

/** Each shown status text stays at least this long (ms). */
const STATUS_MIN_MS = 1000;
/** Ripple and scatter keep their honesty label this long after they end (ms). */
const TOY_HOLD_MS = 1500;
/** The teaching line starts at the first frame and shows at most this long (ms). */
const TEACH_MS = 10_000;
/** A latched verb unlatches after this long without a stroke, press or tap (ms). */
const VERB_IDLE_MS = 30_000;
/** The line that says what a just-latched verb does stays this long (ms). */
const VERB_HINT_MS = 2600;
/** After a shared replay ends, the pill offers "Again" this long (ms). */
const REPLAY_AGAIN_MS = 9000;
/** After a Remix roll, the pill offers "Again" this long (ms). */
const REMIX_AGAIN_MS = 8000;
const LONG_FORM_KEY = 'lupi.play.illustrativeSeen';
const SHORT_LABEL = 'Illustrative';
const LONG_LABEL = 'Illustrative motion, your atoms haven’t moved';

type StatusKind = 'displaced' | 'flash' | 'replay' | 'teach' | 'empty';

interface PillStatus {
  kind: StatusKind;
  text: string;
  flashKind?: string;
}

const EMPTY_STATUS: PillStatus = { kind: 'empty', text: '' };

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

let longFormSeen: boolean | null = null;

function isLongFormSeen(): boolean {
  if (longFormSeen === null) {
    try {
      longFormSeen = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(LONG_FORM_KEY) === '1';
    } catch {
      longFormSeen = false;
    }
  }
  return longFormSeen;
}

function markLongFormSeen(): void {
  longFormSeen = true;
  try {
    sessionStorage.setItem(LONG_FORM_KEY, '1');
  } catch {
    /* storage blocked: the long form may repeat after a reload */
  }
}

/**
 * The status segment: precedence, holds and the 1 s rate limit. It
 * re-evaluates on every play-store change and at the next time boundary (a
 * hold ending, a flash expiring, the teaching deadline, the rate limit).
 */
function usePillStatus(teachText: string, stowed: boolean, teachDeadline: number | null): PillStatus {
  const [status, setStatus] = useState<PillStatus>(EMPTY_STATUS);
  const live = useRef({ teachText, stowed, teachDeadline });
  live.current = { teachText, stowed, teachDeadline };
  const shown = useRef<{ status: PillStatus; at: number }>({ status: EMPTY_STATUS, at: -Infinity });
  const hold = useRef({ until: -Infinity, long: false, resetPending: false });
  /** A Reset lets the next change through at once, without the hold or the rate limit. */
  const forceUntil = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evaluateRef = useRef<() => void>(() => {});

  evaluateRef.current = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const t = now();
    const play = playStore.getState();
    const { teachText: text, stowed: isStowed, teachDeadline: deadline } = live.current;
    const h = hold.current;
    const toyLive = play.displacedSources.some((source) => source !== 'arrival');
    if (toyLive) h.until = Infinity;
    else if (h.until === Infinity) {
      h.until = h.resetPending ? -Infinity : t + TOY_HOLD_MS;
      h.resetPending = false;
    }
    const toyShown = toyLive || t < h.until;
    const displaced = toyShown || play.displacedSources.includes('arrival');
    if (!displaced) h.long = false;
    else if (toyShown && !h.long && !isLongFormSeen()) {
      // The first toy of a session spells it out; an arrival alone is over
      // before the long form could be read.
      h.long = true;
      markLongFormSeen();
    }

    const replay = replayStore.getState();
    const shared = isIncomingActive(replay);
    const sharedPlaying = replay.incoming?.phase === 'playing';
    let desired: PillStatus;
    if (displaced) {
      const label = h.long ? LONG_LABEL : SHORT_LABEL;
      desired = { kind: 'displaced', text: sharedPlaying ? `Shared replay · ${SHORT_LABEL}` : label };
    } else if (!isStowed && play.flash && play.flash.until > t) {
      desired = { kind: 'flash', text: play.flash.text, flashKind: play.flash.kind };
    } else if (shared) {
      desired = { kind: 'replay', text: 'Shared replay' };
    } else if (!isStowed && !play.teachSeen && deadline !== null && t < deadline) {
      desired = { kind: 'teach', text };
    } else desired = EMPTY_STATUS;

    const current = shown.current;
    const boundaries: number[] = [];
    if (desired.kind !== current.status.kind || desired.text !== current.status.text) {
      const urgent = desired.kind === 'displaced' && current.status.kind !== 'displaced';
      if (urgent || t < forceUntil.current || t - current.at >= STATUS_MIN_MS) {
        shown.current = { status: desired, at: t };
        setStatus(desired);
      } else {
        boundaries.push(current.at + STATUS_MIN_MS);
      }
    }
    if (Number.isFinite(h.until) && h.until > t) boundaries.push(h.until);
    if (play.flash && play.flash.until > t) boundaries.push(play.flash.until);
    if (deadline !== null && deadline > t && !play.teachSeen) boundaries.push(deadline);
    if (boundaries.length > 0) {
      const next = Math.min(...boundaries);
      timer.current = setTimeout(() => evaluateRef.current(), Math.max(0, next - t) + 5);
    }
  };

  useEffect(() => {
    const off = playStore.subscribe(() => evaluateRef.current());
    const offReplay = replayStore.subscribe((state, previous) => {
      if (state.incoming !== previous.incoming) evaluateRef.current();
    });
    // Reset puts the atoms home: the label goes with them, no hold.
    const offReset = onIntent('play.reset', () => {
      const h = hold.current;
      if (h.until === Infinity) h.resetPending = true;
      else h.until = -Infinity;
      forceUntil.current = now() + 250;
      evaluateRef.current();
    });
    return () => {
      off();
      offReplay();
      offReset();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  useEffect(() => {
    evaluateRef.current();
  }, [teachText, stowed, teachDeadline]);

  return status;
}

/** A media query, matched synchronously on the first render (no desktop flash on a phone). */
function useMatch(query: string): boolean {
  const read = () => {
    try {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

/** 10 s after the file's first frame (from mount when it already rendered); null until then. */
function useTeachDeadline(): number | null {
  const trajectory = useStore((state) => state.file?.trajectory ?? null);
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    setDeadline(null);
    if (!trajectory) return undefined;
    if (hasFirstFrame(trajectory)) {
      setDeadline(now() + TEACH_MS);
      return undefined;
    }
    return onFirstFrame((key) => {
      if (key === trajectory) setDeadline(now() + TEACH_MS);
    });
  }, [trajectory]);
  return deadline;
}

/** The Heat readout: a tiny thermometer and an illustrative temperature. */
function HeatReadout() {
  const level = usePlayStore((state) => state.heat);
  const heating = usePlayStore((state) => state.heating);
  if (!(level > 0)) return null;
  const kelvin = heatKelvin(level);
  // The bulb fills from the bottom; the column runs y 3 → 11.
  const fill = Math.max(0.08, Math.min(1, level));
  const top = 11 - 8 * fill;
  return (
    <span
      className="lupi-play-pill__heat"
      data-heating={heating || undefined}
      title="Illustrative heat: the jiggle grows the longer you hold. Not a simulation."
      aria-hidden="true"
    >
      <svg className="lupi-play-pill__heat-icon" viewBox="0 0 12 20" width="9" height="15">
        <rect x="3.6" y="1.5" width="4.8" height="12.5" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <rect x="5" y={top} width="2" height={13 - top} rx="1" fill="var(--lupi-heat-fill, #ff9a4a)" />
        <circle cx="6" cy="15.6" r="3.2" fill="var(--lupi-heat-fill, #ff9a4a)" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <span className="lupi-play-pill__heat-k">{kelvin.toLocaleString('en-US')} K</span>
    </span>
  );
}

/**
 * The replay segment: "Replay ↗" after a moment, "▶ Watch" / "Skip" on a
 * shared replay. Null when there is nothing to offer.
 */
function ReplaySegment() {
  const comfort = useComfort();
  const offer = useReplayStore((state) => state.offer);
  const phase = useReplayStore((state) => state.incoming?.phase ?? null);
  const endedAt = useReplayStore((state) => state.incoming?.endedAt ?? null);
  const stillTape = useReplayStore((state) => state.incoming?.tape.still ?? false);
  const sheetOpen = useReplayStore((state) => state.sheet !== null);
  // "Again" for a while after a shared replay ends (until the visitor's own moment).
  const [againOpen, setAgainOpen] = useState(false);
  useEffect(() => {
    if (phase !== 'done' || endedAt === null || stillTape) {
      setAgainOpen(false);
      return undefined;
    }
    const left = REPLAY_AGAIN_MS - (now() - endedAt);
    if (left <= 0) {
      setAgainOpen(false);
      return undefined;
    }
    setAgainOpen(true);
    const timer = setTimeout(() => setAgainOpen(false), left);
    return () => clearTimeout(timer);
  }, [phase, endedAt, stillTape]);
  if (phase === 'waiting') {
    return (
      <button
        type="button"
        className="lupi-play-pill__replay"
        data-replay="watch"
        aria-label="Watch the shared replay"
        title="Watch the moment that was shared with you"
        onClick={() => replayStore.getState().setIncomingPhase('playing')}
      >
        <span className="lupi-play-pill__replay-icon" aria-hidden="true">▶</span>
        <span>Watch</span>
      </button>
    );
  }
  if (phase === 'playing') {
    return (
      <button
        type="button"
        className="lupi-play-pill__replay"
        data-replay="skip"
        aria-label="Skip the shared replay: your turn"
        title="Skip to your turn (any touch does too)"
        onClick={() => replayStore.getState().setIncomingPhase('done')}
      >
        Skip
      </button>
    );
  }
  if (!offer && againOpen && comfort !== 'still') {
    return (
      <button
        type="button"
        className="lupi-play-pill__replay"
        data-replay="again"
        aria-label="Watch the shared replay again"
        title="Watch the shared moment again"
        onClick={() => replayStore.getState().setIncomingPhase('playing')}
      >
        <span className="lupi-play-pill__replay-icon" aria-hidden="true">↺</span>
        <span>Again</span>
      </button>
    );
  }
  if (!offer || sheetOpen) return null;
  // Still sends a still pose link and makes no clip: the offer says Share.
  const still = comfort === 'still';
  return (
    <button
      key={offer.id}
      type="button"
      className="lupi-play-pill__replay"
      data-replay="offer"
      aria-label={still ? 'Share this view as a link (R)' : `Replay ${offer.noun}: share a live link and a clip (R)`}
      title={still ? 'Share this view: a link that opens at this pose (R)' : 'Share that moment: a live link and a 9:16 clip (R)'}
      onClick={() => replayStore.getState().openSheet(offer)}
    >
      <span>{still ? 'Share' : 'Replay'}</span>
      <span className="lupi-play-pill__replay-icon" aria-hidden="true">↗</span>
    </button>
  );
}

/**
 * The Remix segment: "⟳ Again" for a while after a roll, then (with a Foil
 * finish on screen) the finish's chip, which is also its "cosmetic" badge.
 */
function RemixSegment() {
  const rolledAt = useRemixStore((state) => state.rolledAt);
  const applied = useRemixStore((state) => state.applied);
  const chosenFinish = useRemixStore((state) => state.chosenFinish);
  const sheetOpen = useRemixStore((state) => state.sheetOpen);
  // Foil rests under ink (a drawing carries no foil): no chip for a finish that is not drawn.
  const inked = useStore((state) => state.inkStyle !== 'off');
  const finish = inked ? null : shownFinish({ applied, chosenFinish });
  const [againOpen, setAgainOpen] = useState(false);
  useEffect(() => {
    if (rolledAt === null) {
      setAgainOpen(false);
      return undefined;
    }
    const left = REMIX_AGAIN_MS - (now() - rolledAt);
    if (left <= 0) {
      setAgainOpen(false);
      return undefined;
    }
    setAgainOpen(true);
    const timer = setTimeout(() => setAgainOpen(false), left);
    return () => clearTimeout(timer);
  }, [rolledAt]);
  if (sheetOpen) return null;
  if (againOpen) {
    return (
      <button
        key={`again-${rolledAt}`}
        type="button"
        className="lupi-play-pill__remix"
        data-remix="again"
        data-foil={finish ?? undefined}
        aria-label="Roll another look (M)"
        title="Roll another look (M)"
        onClick={() => rollRemix('pill')}
      >
        <span className="lupi-play-pill__remix-icon" aria-hidden="true">⟳</span>
        <span className="lupi-play-pill__remix-label">Again</span>
      </button>
    );
  }
  if (!finish) return null;
  return (
    <button
      type="button"
      className="lupi-play-pill__remix"
      data-remix="foil"
      data-foil={finish}
      aria-label={`${FOIL_LABEL[finish]} finish, cosmetic: atom colours and positions unchanged. Open Remix`}
      title={`${FOIL_LABEL[finish]} · cosmetic finish (atom colours and positions unchanged)`}
      onClick={openRemixSheet}
    >
      <span className="lupi-play-pill__remix-icon" aria-hidden="true">✦</span>
      <span className="lupi-play-pill__remix-label">{FOIL_LABEL[finish]}</span>
    </button>
  );
}

function StowIcon({ stowed }: { stowed: boolean }) {
  return (
    <svg className="lupi-play-pill__stow-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <rect x="2.5" y="2.5" width="15" height="15" rx="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d={stowed ? 'M6.5 11.5 10 8l3.5 3.5' : 'M6.5 8.5 10 12l3.5-3.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlayPill({ uiStowed, setUiStowed }: PlayPillProps) {
  const isMobile = useMatch(MOBILE_MEDIA_QUERY);
  const coarse = useMatch('(hover: none) and (pointer: coarse)');
  const verb = usePlayStore((state) => state.verb);
  const trayOpen = usePlayStore((state) => state.trayOpen);
  const comfort = useComfort();
  const file = useStore((state) => state.file);
  // The Illustrate look: the pill's dot is drawn in ink (no new chrome).
  const inked = useStore((state) => state.inkStyle !== 'off');
  const natoms = file?.trajectory.frames[0]?.natoms ?? 0;
  const trayId = useId();
  const playRef = useRef<HTMLButtonElement | null>(null);

  const canPick = natoms > 0 && natoms <= MAX_INTERACTIVE_PICKING_ATOMS;
  const pickHint = isMobile || coarse ? ' · Tap an atom' : ' · Click an atom';
  const teachText = `Drag to spin${canPick ? pickHint : ''}`;
  const teachDeadline = useTeachDeadline();
  const status = usePillStatus(teachText, uiStowed, teachDeadline);

  const openTray = useCallback(() => {
    const state = useStore.getState();
    if (state.activePanel) state.setActivePanel(null);
    if (state.studyLensOpen) state.setStudyLensOpen(false);
    playStore.getState().setTrayOpen(true);
  }, []);
  const closeTray = useCallback((options?: { restoreFocus?: boolean }) => {
    playStore.getState().setTrayOpen(false);
    if (options?.restoreFocus) playRef.current?.focus({ preventScroll: true });
  }, []);

  // One tray, however it is asked for: the pill, `P`, a right click on the
  // canvas, the palette.
  useEffect(
    () => onIntent('play.toggleTray', () => {
      if (playStore.getState().trayOpen) closeTray();
      else openTray();
    }),
    [openTray, closeTray],
  );

  // Tray and panels are exclusive: a panel or the study lens closes the tray.
  useEffect(
    () => useStore.subscribe(
      (state) => Boolean(state.activePanel) || state.studyLensOpen,
      (covered) => {
        if (covered) playStore.getState().setTrayOpen(false);
      },
    ),
    [],
  );

  // Stowing clears the view: the tray goes too.
  useEffect(() => {
    if (uiStowed) playStore.getState().setTrayOpen(false);
  }, [uiStowed]);

  // The teaching line is done after the first gesture or atom tap. Without a
  // canvas input source (`?controls=orbit`), any press or wheel on the canvas
  // counts.
  useEffect(() => {
    const seen = () => playStore.getState().markTeachSeen();
    const onCanvasInput = (event: Event) => {
      if (isCanvasInputSourceActive()) return;
      const target = event.target as Element | null;
      if (target instanceof HTMLCanvasElement && target.closest('.lupine-main-viewport')) seen();
    };
    const options = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', onCanvasInput, options);
    window.addEventListener('wheel', onCanvasInput, options);
    const offs = [onIntent('camera.gestureStart', seen), onIntent('atom.tap', seen)];
    return () => {
      window.removeEventListener('pointerdown', onCanvasInput, options);
      window.removeEventListener('wheel', onCanvasInput, options);
      for (const off of offs) off();
    };
  }, []);

  // A teaching line that ran its 10 s is done for the session.
  useEffect(() => {
    if (teachDeadline === null) return undefined;
    const timer = setTimeout(() => playStore.getState().markTeachSeen(), Math.max(0, teachDeadline - now()));
    return () => clearTimeout(timer);
  }, [teachDeadline]);

  // A latched verb unlatches after 30 s without a stroke, press or tap,
  // under Still, on a new file, and when the viewer closes.
  useEffect(() => {
    if (verb === 'orbit') return undefined;
    const unlatch = () => playStore.getState().setVerb('orbit');
    let timer = setTimeout(unlatch, VERB_IDLE_MS);
    const keep = () => {
      clearTimeout(timer);
      timer = setTimeout(unlatch, VERB_IDLE_MS);
    };
    const offs = [
      onIntent('verb.stroke', keep),
      onIntent('verb.press', keep),
      onIntent('verb.tap', keep),
      onIntent('canvas.tap', keep),
    ];
    return () => {
      clearTimeout(timer);
      for (const off of offs) off();
    };
  }, [verb]);
  useEffect(() => {
    if (comfort === 'still' && verb !== 'orbit') playStore.getState().setVerb('orbit');
  }, [comfort, verb]);

  // Latching a verb says, once, what one finger does now.
  const touchRef = useRef(false);
  touchRef.current = isMobile || coarse;
  useEffect(() => {
    if (verb === 'orbit') return;
    const play = playStore.getState();
    play.markTeachSeen();
    play.flashText(playVerbHint(verb, touchRef.current), 'info', VERB_HINT_MS);
  }, [verb]);
  useEffect(
    () => useStore.subscribe(
      (state) => state.file,
      () => playStore.getState().setVerb('orbit'),
    ),
    [],
  );
  useEffect(
    () => () => {
      const play = playStore.getState();
      play.setVerb('orbit');
      play.setTrayOpen(false);
    },
    [],
  );

  // The thin lime inset edge on the viewport while a verb is latched
  // (`data-poke` stays for Poke; `data-play-verb` names any verb).
  const heating = usePlayStore((state) => state.heating);
  useEffect(() => {
    if (verb === 'orbit') return undefined;
    const viewport = document.querySelector<HTMLElement>('.lupine-main-viewport');
    if (!viewport) return undefined;
    viewport.setAttribute('data-play-verb', verb);
    if (verb === 'poke') viewport.setAttribute('data-poke', '');
    return () => {
      viewport.removeAttribute('data-play-verb');
      viewport.removeAttribute('data-poke');
    };
  }, [verb, file]);
  useEffect(() => {
    if (!heating) return undefined;
    const viewport = document.querySelector<HTMLElement>('.lupine-main-viewport');
    viewport?.setAttribute('data-heating', '');
    return () => viewport?.removeAttribute('data-heating');
  }, [heating, file]);

  const resetMotion = () => {
    emitIntent({ type: 'play.reset' });
    cue('reset');
  };

  const poke = verb === 'poke';
  const latched = verb !== 'orbit';
  const verbLabel = PLAY_VERB_LABEL[verb];
  return (
    <div
      className="lupi-play-pill"
      data-lupi-pill=""
      data-stowed={uiStowed}
      data-verb={verb}
      data-tray-open={trayOpen}
      data-ink={inked || undefined}
      role="group"
      aria-label="Toys and view"
    >
      {!uiStowed && (
        <div className="lupi-play-pill__play" data-poke={poke || undefined} data-latched={latched || undefined}>
          <button
            ref={playRef}
            type="button"
            className="lupi-play-pill__play-button"
            aria-label="Play: toys and view"
            aria-haspopup="menu"
            aria-expanded={trayOpen}
            aria-controls={trayOpen ? trayId : undefined}
            title="Toys and view (P)"
            onClick={() => (playStore.getState().trayOpen ? closeTray() : openTray())}
          >
            <span className="lupi-play-pill__dot" aria-hidden="true" />
            <span className="lupi-play-pill__play-label">{latched ? verbLabel : 'Play'}</span>
          </button>
          {latched && (
            <button
              type="button"
              className="lupi-play-pill__unlatch"
              aria-label={`Stop ${verbLabel} (one finger orbits again)`}
              title="Back to Orbit"
              onClick={() => playStore.getState().setVerb('orbit')}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      )}

      <div
        className="lupi-play-pill__status"
        data-kind={status.kind}
        data-flash={status.flashKind}
        data-empty={status.kind === 'empty'}
      >
        <span className="lupi-play-pill__status-text" role="status" aria-live="polite">
          {status.text}
        </span>
        {status.kind === 'displaced' && (
          <>
            <HeatReadout />
            <span className="lupi-play-pill__sep" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              className="lupi-play-pill__reset"
              aria-label="Reset illustrative motion"
              onClick={resetMotion}
            >
              Reset
            </button>
          </>
        )}
      </div>

      {!uiStowed && <RemixSegment />}
      {!uiStowed && <ReplaySegment />}

      <button
        type="button"
        className="lupi-play-pill__stow"
        data-stowed={uiStowed}
        aria-label={uiStowed ? 'Restore viewer controls' : 'Stow viewer controls'}
        aria-pressed={uiStowed}
        title={uiStowed ? 'Restore controls' : 'Stow all controls'}
        onClick={() => setUiStowed((value) => !value)}
      >
        <StowIcon stowed={uiStowed} />
        <span className="lupi-play-pill__stow-label">{uiStowed ? 'Restore' : 'Clear view'}</span>
      </button>

      {trayOpen && <PlayTray id={trayId} anchorRef={playRef} onClose={closeTray} />}
    </div>
  );
}
