/**
 * actions.ts — rolling, applying and undoing Remix codes.
 *
 * Every way into Remix ends here: the Play tray, the pill's "Roll again",
 * the M key, a shake, the Remix sheet (typed or pasted codes), a pasted code
 * anywhere on the viewer, a `?remix=` link, the scene deck and the palette.
 *
 * - `rollRemix(source)`: a fresh code under the visitor's preferences (keep
 *   colours, worlds), morphing into its look; one roll in 24 is Foil.
 * - `applyRemixCode(code, source)`: the same for a known code.
 * - `undoRemix()`: back to the look before the last code, morphing.
 *
 * History is per molecule (a WeakMap on the loaded file, like the deck's
 * old one), capped at eight looks.
 */
import { useStore, type AppState } from '../store';
import { remixPatchForCode, rollRemix as rollRemixPatch, snapshotRemix, type RemixSnapshot } from '../sceneRemix';
import { getComfort } from '../motion/comfort';
import { playStore } from '../play/playStore';
import { cue } from '../play/feedback';
import { FOIL_LABEL, remixFoil, type FoilKind, type RemixCode } from './code';
import { lookMorphTarget, morphLook } from './lookMorph';
import { remixStore, type AppliedRemix } from './remixStore';
import { matchesMediaQuery } from '../hooks/useMediaQuery';

export type RemixSource = 'tray' | 'pill' | 'key' | 'shake' | 'sheet' | 'paste' | 'link' | 'deck' | 'palette';

interface HistoryEntry {
  snapshot: RemixSnapshot;
  applied: AppliedRemix | null;
}

const MAX_HISTORY = 8;
const histories = new WeakMap<object, HistoryEntry[]>();
const emptyScene = {};
const historyListeners = new Set<() => void>();

function historyKey(): object {
  return useStore.getState().file ?? emptyScene;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Looks the visitor can step back to on this molecule. */
export function remixHistoryDepth(): number {
  return histories.get(historyKey())?.length ?? 0;
}

/** Listen for history changes (the Undo buttons). */
export function subscribeRemixHistory(listener: () => void): () => void {
  historyListeners.add(listener);
  return () => historyListeners.delete(listener);
}

function notifyHistory(): void {
  for (const listener of Array.from(historyListeners)) listener();
}

function pushHistory(state: AppState): void {
  const key = historyKey();
  const history = histories.get(key) ?? [];
  // Mid-morph the store holds an in-between look: remember where it was going.
  const snapshot = snapshotRemix(state, true);
  const going = lookMorphTarget() as Record<string, unknown> | null;
  if (going) {
    const record = snapshot as unknown as Record<string, unknown>;
    for (const name of Object.keys(record)) if (name in going) record[name] = going[name];
  }
  histories.set(key, [...history.slice(-(MAX_HISTORY - 1)), {
    snapshot,
    applied: remixStore.getState().applied,
  }]);
  notifyHistory();
}

/** The motion pause a reduced-motion visitor keeps on any look. */
function withComfort(patch: RemixSnapshot): RemixSnapshot {
  const reduced = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || getComfort() === 'still') return { ...patch, backgroundMotionPaused: true };
  return patch;
}

/** What screen readers and the pill say about a code. */
export function describeRemix(code: RemixCode, foil: FoilKind | null): string {
  return foil
    ? `Remix ${code.text}: ${FOIL_LABEL[foil]} finish, cosmetic. Atom colours and positions unchanged.`
    : `Remix ${code.text}. Same science, new look.`;
}

function announce(code: RemixCode, foil: FoilKind | null, source: RemixSource, rolled: boolean): void {
  const play = playStore.getState();
  // A drawing carries no foil: under the Illustrate look the finish rests
  // unseen, so the pill does not announce it (it shows when the light does).
  if (foil && useStore.getState().inkStyle === 'off') {
    play.flashText(`✦ ${FOIL_LABEL[foil]} foil · ${code.text}`, 'foil', 3600);
    cue('foil');
  } else {
    play.flashText(source === 'link' ? `Shared look · ${code.text}` : `Remix · ${code.text}`, 'remix', 2600);
    if (rolled) cue('roll');
  }
}

/**
 * Apply a code's look and make it the code on screen. It morphs, except
 * from a link (the arrival is the motion) or with `instant`.
 */
export function applyRemixCode(
  code: RemixCode,
  source: RemixSource,
  options: { instant?: boolean; rolled?: boolean } = {},
): AppliedRemix {
  const state = useStore.getState();
  pushHistory(state);
  const patch = withComfort(remixPatchForCode(code, state));
  const foil = remixFoil(code);
  const applied: AppliedRemix = { code, patch, foil, at: now() };
  remixStore.getState().setApplied(applied);
  if (foil) remixStore.getState().markFound(foil);
  // A roll opens the pill's "Again" window; a typed, pasted or linked code does not.
  remixStore.getState().setRolledAt(options.rolled ? now() : null);
  morphLook(patch, options.instant || source === 'link' ? { duration: 0 } : {});
  announce(code, foil, source, Boolean(options.rolled));
  return applied;
}

/** Roll a fresh code under the visitor's preferences and apply it. */
export function rollRemix(source: RemixSource): AppliedRemix {
  const state = useStore.getState();
  const prefs = remixStore.getState();
  const { code } = rollRemixPatch(state, prefs.worlds, Math.random, !prefs.keepColors);
  return applyRemixCode(code, source, { rolled: true });
}

/** Step back to the look before the last code (morphing). False when there is none. */
export function undoRemix(): boolean {
  const key = historyKey();
  const history = histories.get(key) ?? [];
  const previous = history.at(-1);
  if (!previous) return false;
  histories.set(key, history.slice(0, -1));
  notifyHistory();
  remixStore.getState().setApplied(previous.applied);
  remixStore.getState().setRolledAt(null);
  morphLook(previous.snapshot);
  playStore.getState().flashText(previous.applied ? `Back to ${previous.applied.code.text}` : 'Previous look', 'remix', 1800);
  return true;
}

/** How the look on screen relates to the last code: exactly it, tweaked, or replaced. */
export type RemixCodeStatus = 'exact' | 'edited' | 'gone';

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * A code stays on screen while its backdrop and recipe do; tweaking a light
 * or a slider marks it edited, and a new backdrop or recipe (a Look, a new
 * molecule's opening look, a saved view) retires it, and its Foil with it.
 */
export function remixCodeStatus(state: AppState, applied: AppliedRemix | null): RemixCodeStatus {
  if (!applied) return 'gone';
  const patch = applied.patch as Record<string, unknown>;
  const current = state as unknown as Record<string, unknown>;
  if (!same(current.backgroundPreset, patch.backgroundPreset) || !same(current.materialScene, patch.materialScene)) return 'gone';
  for (const key of Object.keys(patch)) {
    if (key === 'backgroundMotionPaused') continue;
    if (!same(current[key], patch[key])) return 'edited';
  }
  return 'exact';
}

/** The code a link can carry: only while the look on screen is exactly it. */
export function shareableRemixCode(): RemixCode | null {
  const applied = remixStore.getState().applied;
  if (!applied) return null;
  return remixCodeStatus(useStore.getState(), applied) === 'exact' ? applied.code : null;
}

/** Open the Remix sheet (codes, finishes, shake); closes the Play tray. */
export function openRemixSheet(): void {
  playStore.getState().setTrayOpen(false);
  // A phone shows one sheet at a time: opened from the Style sheet's deck,
  // the Remix sheet takes its place rather than stacking over it.
  if (matchesMediaQuery('(max-width: 640px)') && useStore.getState().activePanel) {
    useStore.getState().setActivePanel(null);
  }
  remixStore.getState().setSheetOpen(true);
}

export function closeRemixSheet(): void {
  remixStore.getState().setSheetOpen(false);
}
