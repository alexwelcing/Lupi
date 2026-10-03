/**
 * replayStore.ts — Instant Replay's state for the Play pill and the sheet.
 *
 * - `offer`: a moment just happened (a good flick, a detent chain, a flip, a
 *   toy moment); the pill shows "Replay ↗" until `until`.
 * - `lastMoment`: the most recent moment, for the R key and the palette.
 * - `incoming`: a shared replay opened from a link (`?replay=`): waiting for
 *   a tap or its autoplay, playing, or done.
 * - `sheet`: the share sheet is open for a moment.
 * - `clipping`: a clip of the moment is being recorded (the sheet shows it).
 *
 * Never persisted, never part of the viewer store, URLs, saved views or MCP.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { MomentGesture, MomentKind, Tape } from './tape';

export interface ReplayMoment {
  id: number;
  moment: MomentKind;
  gesture: MomentGesture | null;
  /** Recorder clock (s): the moment's window. */
  t0: number;
  t1: number;
  /** "your spin", "the burst": how the pill and the sheet name it. */
  noun: string;
  /** performance.now() (ms) when the moment ended. */
  at: number;
}

export interface ReplayOffer extends ReplayMoment {
  /** performance.now() (ms) when the pill stops offering it. */
  until: number;
}

export type IncomingPhase = 'pending' | 'waiting' | 'playing' | 'done';

export interface IncomingReplay {
  tape: Tape;
  phase: IncomingPhase;
  /** The tape has toy events (the replay is illustrative motion). */
  toys: boolean;
  /** performance.now() (ms) when it last finished (the pill offers "Again" a while). */
  endedAt?: number;
}

export interface ReplayState {
  offer: ReplayOffer | null;
  lastMoment: ReplayMoment | null;
  incoming: IncomingReplay | null;
  sheet: ReplayMoment | null;
  clipping: boolean;
  setOffer(offer: ReplayOffer | null): void;
  setLastMoment(moment: ReplayMoment | null): void;
  setIncoming(incoming: IncomingReplay | null): void;
  setIncomingPhase(phase: IncomingPhase): void;
  openSheet(moment: ReplayMoment): void;
  closeSheet(): void;
  setClipping(on: boolean): void;
}

let offerTimer: ReturnType<typeof setTimeout> | null = null;

export const replayStore: StoreApi<ReplayState> = createStore<ReplayState>()((set, get) => ({
  offer: null,
  lastMoment: null,
  incoming: null,
  sheet: null,
  clipping: false,
  setOffer(offer) {
    if (offerTimer !== null) clearTimeout(offerTimer);
    offerTimer = null;
    set({ offer });
    if (offer) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      offerTimer = setTimeout(() => {
        offerTimer = null;
        if (get().offer === offer) set({ offer: null });
      }, Math.max(0, offer.until - now));
    }
  },
  setLastMoment(lastMoment) {
    set({ lastMoment });
  },
  setIncoming(incoming) {
    set({ incoming });
  },
  setIncomingPhase(phase) {
    const incoming = get().incoming;
    if (!incoming || incoming.phase === phase) return;
    const endedAt = phase === 'done' ? (typeof performance !== 'undefined' ? performance.now() : Date.now()) : incoming.endedAt;
    set({ incoming: { ...incoming, phase, endedAt } });
  },
  openSheet(moment) {
    if (offerTimer !== null) clearTimeout(offerTimer);
    offerTimer = null;
    set({ sheet: moment, offer: null });
  },
  closeSheet() {
    if (get().sheet) set({ sheet: null });
  },
  setClipping(clipping) {
    if (get().clipping !== clipping) set({ clipping });
  },
}));

export function useReplayStore<T>(selector: (state: ReplayState) => T): T {
  return useStore(replayStore, selector);
}

/** A shared replay is on screen (waiting for its start, or playing). */
export function isIncomingActive(state: ReplayState = replayStore.getState()): boolean {
  const phase = state.incoming?.phase;
  return phase === 'waiting' || phase === 'playing' || phase === 'pending';
}
