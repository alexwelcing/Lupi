/**
 * playStore.ts — the Play layer's own state (verb, tray, displaced toys,
 * status flash, teaching line). A vanilla zustand store, never persisted and
 * never part of the viewer store, URLs, saved views or MCP state. Only
 * `teachSeen` is mirrored to sessionStorage.
 *
 * Contract file: additive edits only.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type PlayVerb = 'orbit' | 'poke' | 'tug' | 'burst' | 'heat';
export type DisplacedSource = 'arrival' | 'ripple' | 'scatter' | 'tug' | 'burst' | 'heat';

/** The one-finger verbs in tray order. */
export const PLAY_VERBS: ReadonlyArray<PlayVerb> = ['orbit', 'poke', 'tug', 'burst', 'heat'];

/** Each verb's name on the pill and in the tray. */
export const PLAY_VERB_LABEL: Readonly<Record<PlayVerb, string>> = {
  orbit: 'Orbit',
  poke: 'Poke',
  tug: 'Tug',
  burst: 'Burst',
  heat: 'Heat',
};

/** What a latched verb does, shown once on the pill as it latches. */
export function playVerbHint(verb: PlayVerb, touch: boolean): string {
  switch (verb) {
    case 'poke':
      return touch ? 'Drag to stir · Tap an atom to ring it' : 'Drag to stir · Click an atom to ring it';
    case 'tug':
      return 'Drag an atom · Let go and it springs back';
    case 'burst':
      return touch ? 'Tap to pop · Drag still turns' : 'Click to pop · Drag still turns';
    case 'heat':
      return touch ? 'Hold to warm it · Rub to heat faster' : 'Hold the button to warm it · Rub to heat faster';
    default:
      return '';
  }
}

/** Heat readout: a temperature-like scale from room temperature (illustrative). */
export const HEAT_ROOM_K = 300;
export const HEAT_SPAN_K = 1500;

/** The illustrative temperature for a heat level 0..1, rounded to 10 K. */
export function heatKelvin(level: number): number {
  const clamped = level > 0 ? Math.min(1, level) : 0;
  return Math.round((HEAT_ROOM_K + HEAT_SPAN_K * clamped) / 10) * 10;
}

export interface PlayFlash {
  text: string;
  /** `turn`: a shared replay handed the view over ("Your turn · flick it"). */
  kind: 'detent' | 'catch' | 'flip' | 'info' | 'turn';
  /** performance.now() (ms) when the flash expires. */
  until: number;
}

export interface PlayState {
  verb: PlayVerb;
  trayOpen: boolean;
  displacedSources: DisplacedSource[];
  /** True while any display-only motion has atoms away from their rest positions. */
  displaced: boolean;
  flash: PlayFlash | null;
  /** Mirrored to sessionStorage 'lupi.play.teachSeen'. */
  teachSeen: boolean;
  /** Heat level 0..1 while atoms are warm (0 at rest); the pill reads it as a temperature. */
  heat: number;
  /** True while the finger or button that heats is down. */
  heating: boolean;
  setVerb(verb: PlayVerb): void;
  setTrayOpen(open: boolean): void;
  setDisplaced(source: DisplacedSource, on: boolean): void;
  flashText(text: string, kind: PlayFlash['kind'], ms: number): void;
  markTeachSeen(): void;
  setHeat(level: number, heating: boolean): void;
}

const TEACH_SEEN_KEY = 'lupi.play.teachSeen';

function readTeachSeen(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(TEACH_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;

export const playStore: StoreApi<PlayState> = createStore<PlayState>()((set, get) => ({
  verb: 'orbit',
  trayOpen: false,
  displacedSources: [],
  displaced: false,
  flash: null,
  teachSeen: readTeachSeen(),
  heat: 0,
  heating: false,
  setVerb(verb) {
    if (get().verb !== verb) set({ verb });
  },
  setTrayOpen(open) {
    if (get().trayOpen !== open) set({ trayOpen: open });
  },
  setDisplaced(source, on) {
    const sources = get().displacedSources;
    const has = sources.includes(source);
    if (on === has) return;
    const next = on ? [...sources, source] : sources.filter((s) => s !== source);
    set({ displacedSources: next, displaced: next.length > 0 });
  },
  flashText(text, kind, ms) {
    const flash: PlayFlash = { text, kind, until: now() + Math.max(0, ms) };
    set({ flash });
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      if (get().flash === flash) set({ flash: null });
    }, Math.max(0, ms));
  },
  setHeat(level, heating) {
    const heat = level > 0 ? Math.min(1, level) : 0;
    const state = get();
    if (state.heat !== heat || state.heating !== heating) set({ heat, heating });
  },
  markTeachSeen() {
    if (get().teachSeen) return;
    set({ teachSeen: true });
    try {
      sessionStorage.setItem(TEACH_SEEN_KEY, '1');
    } catch {
      /* storage blocked */
    }
  },
}));

export function usePlayStore<T>(selector: (state: PlayState) => T): T {
  return useStore(playStore, selector);
}
