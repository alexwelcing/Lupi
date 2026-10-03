/**
 * remixStore.ts — Remix codes' own state: the code on screen, its Foil, the
 * visitor's Remix preferences and the finishes they have found.
 *
 * A vanilla zustand store, never part of the viewer store, URLs, saved views
 * or MCP state. Preferences (keep colours, worlds, shake to roll, show all
 * finishes) and the found finishes are per-device conveniences in
 * localStorage, read and written in try/catch (a private window starts
 * fresh and works the same).
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { FOIL_KINDS, remixFoil, type FoilKind, type RemixCode } from './code';
import type { RemixSnapshot } from '../sceneRemix';

/** What a Remix code's look patch was when it landed (for "edited" and undo). */
export interface AppliedRemix {
  code: RemixCode;
  patch: RemixSnapshot;
  /** The code's own finish (a pure function of the code), or null. */
  foil: FoilKind | null;
  at: number;
}

export type ShakeState = 'off' | 'arming' | 'on' | 'denied' | 'unsupported';

/** A finish the visitor picked: one of the three, `off` (none, even on a Foil code), or null (the code's own). */
export type ChosenFinish = FoilKind | 'off' | null;

export interface RemixState {
  /** The last code applied (cleared when its look is replaced). */
  applied: AppliedRemix | null;
  /** A finish the visitor picked themselves; null follows the code. */
  chosenFinish: ChosenFinish;
  /** Finishes rolled on this device (they stay selectable). */
  found: FoilKind[];
  /** Every finish selectable without rolling it first. */
  showAllFinishes: boolean;
  /** Remix leaves atom colours alone (CPK stays CPK). */
  keepColors: boolean;
  /** Remix may pick a world or a moving field. */
  worlds: boolean;
  /** The visitor turned shake to roll on (it still needs the sensor). */
  shakePreferred: boolean;
  shake: ShakeState;
  sheetOpen: boolean;
  /** performance.now() of the last roll (the pill's "Roll again" window). */
  rolledAt: number | null;
  setApplied(applied: AppliedRemix | null): void;
  setChosenFinish(finish: ChosenFinish): void;
  markFound(finish: FoilKind): void;
  setShowAllFinishes(value: boolean): void;
  setKeepColors(value: boolean): void;
  setWorlds(value: boolean): void;
  setShakePreferred(value: boolean): void;
  setShake(state: ShakeState): void;
  setSheetOpen(open: boolean): void;
  setRolledAt(at: number | null): void;
}

const KEYS = {
  keepColors: 'lupi.remix.keepColors',
  worlds: 'lupi.remix.worlds',
  shake: 'lupi.remix.shake',
  showAll: 'lupi.remix.showAllFinishes',
  found: 'lupi.remix.found',
} as const;

function read(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the in-memory value stands */
  }
}

function readFlag(key: string, fallback: boolean): boolean {
  const value = read(key);
  if (value === '1') return true;
  if (value === '0') return false;
  return fallback;
}

function readFound(): FoilKind[] {
  const value = read(KEYS.found);
  if (!value) return [];
  return value.split(',').filter((item): item is FoilKind => (FOIL_KINDS as readonly string[]).includes(item));
}

export const remixStore: StoreApi<RemixState> = createStore<RemixState>()((set, get) => ({
  applied: null,
  chosenFinish: null,
  found: readFound(),
  showAllFinishes: readFlag(KEYS.showAll, false),
  // The house rule is CPK: a Remix keeps atom colours unless asked.
  keepColors: readFlag(KEYS.keepColors, true),
  worlds: readFlag(KEYS.worlds, false),
  shakePreferred: readFlag(KEYS.shake, false),
  shake: 'off',
  sheetOpen: false,
  rolledAt: null,
  setApplied(applied) {
    if (get().applied !== applied) set({ applied });
  },
  setChosenFinish(finish) {
    if (get().chosenFinish !== finish) set({ chosenFinish: finish });
  },
  markFound(finish) {
    const found = get().found;
    if (found.includes(finish)) return;
    const next = FOIL_KINDS.filter((kind) => kind === finish || found.includes(kind));
    set({ found: next });
    write(KEYS.found, next.join(','));
  },
  setShowAllFinishes(value) {
    set({ showAllFinishes: value });
    write(KEYS.showAll, value ? '1' : '0');
  },
  setKeepColors(value) {
    set({ keepColors: value });
    write(KEYS.keepColors, value ? '1' : '0');
  },
  setWorlds(value) {
    set({ worlds: value });
    write(KEYS.worlds, value ? '1' : '0');
  },
  setShakePreferred(value) {
    set({ shakePreferred: value });
    write(KEYS.shake, value ? '1' : '0');
  },
  setShake(state) {
    if (get().shake !== state) set({ shake: state });
  },
  setSheetOpen(open) {
    if (get().sheetOpen !== open) set({ sheetOpen: open });
  },
  setRolledAt(at) {
    set({ rolledAt: at });
  },
}));

export function useRemixStore<T>(selector: (state: RemixState) => T): T {
  return useStore(remixStore, selector);
}

/** The finish on screen: the visitor's choice (`off` hides it), else the code's own. */
export function shownFinish(state: Pick<RemixState, 'applied' | 'chosenFinish'>): FoilKind | null {
  if (state.chosenFinish === 'off') return null;
  return state.chosenFinish ?? state.applied?.foil ?? null;
}

/** Finishes the visitor may pick directly (found ones, or all with the setting). */
export function selectableFinishes(state: Pick<RemixState, 'found' | 'showAllFinishes'>): FoilKind[] {
  return state.showAllFinishes ? [...FOIL_KINDS] : state.found;
}

/** Re-export for callers that only need the rarity function. */
export { remixFoil };
