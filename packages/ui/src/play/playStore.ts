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

export type PlayVerb = 'orbit' | 'poke';
export type DisplacedSource = 'arrival' | 'ripple' | 'scatter';

export interface PlayFlash {
  text: string;
  kind: 'detent' | 'catch' | 'flip' | 'info';
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
  setVerb(verb: PlayVerb): void;
  setTrayOpen(open: boolean): void;
  setDisplaced(source: DisplacedSource, on: boolean): void;
  flashText(text: string, kind: PlayFlash['kind'], ms: number): void;
  markTeachSeen(): void;
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
