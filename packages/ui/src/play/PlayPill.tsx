/**
 * PlayPill — the one floating pill: [● Play] [status] [stow].
 *
 * - **Play** opens the Play tray (so do `P`, a right click on empty canvas
 *   and the palette's "Open Play", all through `play.toggleTray`). With Poke
 *   latched it reads "Poke ×"; the × goes back to Orbit.
 * - **Status** (`role="status"`), in precedence order:
 *   1. "Illustrative · Reset" while display-only motion has atoms away from
 *      their rest positions (ripple and scatter hold 1.5 s after they end;
 *      the arrival shows only while it runs). The first toy of a session
 *      spells it out: "Illustrative motion, your atoms haven't moved".
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
 * Poke auto-unlatches after 30 s without a stroke, on a file change and
 * under Motion: Still. While latched the viewport gets a thin lime inset.
 */
import { useCallback, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { emitIntent, isCanvasInputSourceActive, onIntent } from '@atlas/scene';
import { useStore } from '../store';
import { MAX_INTERACTIVE_PICKING_ATOMS } from '../deviceCapabilities';
import { MOBILE_MEDIA_QUERY } from '../hooks/useMediaQuery';
import { useComfort } from '../motion/comfort';
import { hasFirstFrame, onFirstFrame } from '../relay/firstFrame';
import { cue } from './feedback';
import { playStore, usePlayStore } from './playStore';
import { PlayTray } from './PlayTray';
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
/** Poke unlatches after this long without a stroke (ms). */
const POKE_IDLE_MS = 30_000;
const LONG_FORM_KEY = 'lupi.play.illustrativeSeen';
const SHORT_LABEL = 'Illustrative';
const LONG_LABEL = 'Illustrative motion, your atoms haven’t moved';

type StatusKind = 'displaced' | 'flash' | 'teach' | 'empty';

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

    let desired: PillStatus;
    if (displaced) desired = { kind: 'displaced', text: h.long ? LONG_LABEL : SHORT_LABEL };
    else if (!isStowed && play.flash && play.flash.until > t) {
      desired = { kind: 'flash', text: play.flash.text, flashKind: play.flash.kind };
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

  // Poke unlatches after 30 s without a stroke, under Still, on a new file,
  // and when the viewer closes.
  useEffect(() => {
    if (verb !== 'poke') return undefined;
    const unlatch = () => playStore.getState().setVerb('orbit');
    let timer = setTimeout(unlatch, POKE_IDLE_MS);
    const off = onIntent('verb.stroke', () => {
      clearTimeout(timer);
      timer = setTimeout(unlatch, POKE_IDLE_MS);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [verb]);
  useEffect(() => {
    if (comfort === 'still' && verb === 'poke') playStore.getState().setVerb('orbit');
  }, [comfort, verb]);
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

  // The thin lime inset edge on the viewport while Poke is latched.
  useEffect(() => {
    if (verb !== 'poke') return undefined;
    const viewport = document.querySelector<HTMLElement>('.lupine-main-viewport');
    if (!viewport) return undefined;
    viewport.setAttribute('data-poke', '');
    return () => viewport.removeAttribute('data-poke');
  }, [verb, file]);

  const resetMotion = () => {
    emitIntent({ type: 'play.reset' });
    cue('reset');
  };

  const poke = verb === 'poke';
  return (
    <div
      className="lupi-play-pill"
      data-lupi-pill=""
      data-stowed={uiStowed}
      data-verb={verb}
      data-tray-open={trayOpen}
      role="group"
      aria-label="Toys and view"
    >
      {!uiStowed && (
        <div className="lupi-play-pill__play" data-poke={poke || undefined}>
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
            <span className="lupi-play-pill__play-label">{poke ? 'Poke' : 'Play'}</span>
          </button>
          {poke && (
            <button
              type="button"
              className="lupi-play-pill__unlatch"
              aria-label="Stop Poke (one finger orbits again)"
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
