/**
 * omolShelf.ts — the landing-safe logic behind the home page's OMol25 shelf
 * and the finder's OMol25 rows: which featured picks show today, which picks
 * a typed query matches, when a query is formula-shaped enough to hand off to
 * the Library, and opening a pick.
 *
 * Imports only the generated pick data, the pure OMol25 helpers, the Daily
 * date helpers and the one-shot entry mark: no three, no analytics session,
 * no network. The viewer loader is imported only when a pick is opened.
 */
import { OMOL25_NEUTRAL_ELEMENTS, omolTitle } from '@atlas/core/omol25';
import { markOpenEntry, type OpenEntry } from '../analytics/openEntry';
import { dayNumber, localDateKey } from '../daily/schedule';
import type { ViewerOpenResult } from '../viewer/openTypes';
import { OMOL_PICKS, type OmolPick } from './omolShelf.data';

export type { OmolPick } from './omolShelf.data';

export const OMOL_SHELF_SIZE = 6;
export const OMOL_FINDER_LIMIT = 3;
export const OMOL_PICK_FAILURE = 'That pick didn’t open. Try again, or browse OMol25.';
/** The same sentence as molecules/randomOmol.ts, which loads only on a tap. */
export const OMOL_SURPRISE_FAILURE = 'OMol25’s host didn’t answer. Try again, or open a pick.';

/**
 * The day's picks: `home[(dayNumber·6 + i) mod N]`. Consecutive windows of
 * six walk the home list (which the builder interleaves by shelf), so every
 * home pick comes round and a day's six span the shelves. Asking for fewer
 * than six gives the first of that day's six.
 */
export function omolShelfForDay(picks: readonly OmolPick[], day: number, n = OMOL_SHELF_SIZE): OmolPick[] {
  const home = picks.filter((pick) => pick.home);
  const count = home.length;
  if (count === 0) return [];
  const start = Number.isFinite(day) ? Math.trunc(day) * OMOL_SHELF_SIZE : 0;
  return Array.from({ length: Math.min(n, count) }, (_, i) => home[(((start + i) % count) + count) % count]);
}

/** Today's picks on this visitor's calendar (the same day boundary as Lupi Daily). */
export function todaysOmolPicks(n = OMOL_SHELF_SIZE, now: Date = new Date()): OmolPick[] {
  return omolShelfForDay(OMOL_PICKS, dayNumber(localDateKey(now)), n);
}

const FORMULA_RE = /^(?:[A-Z][a-z]?\d*)+$/;
const NEUTRAL = new Set(OMOL25_NEUTRAL_ELEMENTS);

function formulaTokens(text: string): Array<[string, number | null]> | null {
  if (!FORMULA_RE.test(text)) return null;
  return [...text.matchAll(/([A-Z][a-z]?)(\d*)/g)].map(([, symbol, digits]) => [symbol, digits ? Number(digits) : null]);
}

/**
 * A query worth a "Find … in OMol25" handoff: written as a formula of at least
 * two OMol25 neutral-lane elements, with a digit or mixed case so plain
 * capitals ("HI", "DNA") read as words, not formulas.
 */
export function isFormulaShapedForOmol(query: string): boolean {
  const q = query.trim();
  const tokens = formulaTokens(q);
  if (!tokens || tokens.length < 2) return false;
  if (!tokens.every(([symbol]) => NEUTRAL.has(symbol))) return false;
  return /\d/.test(q) || (/[a-z]/.test(q) && /[A-Z]/.test(q));
}

function elementCount(formula: string, symbol: string): number {
  let total = 0;
  for (const [, s, digits] of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (s === symbol) total += digits ? Number(digits) : 1;
  }
  return total;
}

/**
 * Featured picks a finder query names: an exact formula first, then picks
 * that contain every element written (with the count, when one is given).
 * "omol25" (or its start) lists today's picks. Never more than `limit`.
 */
export function matchOmolPicks(query: string, picks: readonly OmolPick[] = OMOL_PICKS, limit = OMOL_FINDER_LIMIT): OmolPick[] {
  const q = query.trim();
  if (q.length < 2 || limit <= 0) return [];
  if (q.length >= 3 && 'omol25'.startsWith(q.toLowerCase())) return todaysOmolPicks(limit);
  const tokens = formulaTokens(q);
  if (!tokens) return [];
  const exact: OmolPick[] = [];
  const partial: OmolPick[] = [];
  for (const pick of picks) {
    if (pick.formula === q) exact.push(pick);
    else if (tokens.every(([symbol, n]) => {
      const have = elementCount(pick.formula, symbol);
      return n === null ? have > 0 : have === n;
    })) partial.push(pick);
  }
  return [...exact, ...partial].slice(0, limit);
}

/** The Library facet view for a formula: the explicit "Find … in OMol25" link. */
export function omolFormulaHandoffHref(query: string): string {
  return `/library/omol25?view=facets&q=${encodeURIComponent(query.trim())}`;
}

/** Plain-link address of a pick: the viewer with the same-origin file. */
export function omolPickHref(pick: OmolPick): string {
  return `/?load=${pick.file}`;
}

export function omolPickTitle(pick: OmolPick): string {
  return omolTitle(pick.title);
}

export function omolPickDetail(pick: OmolPick): string {
  return `${pick.domainLabel} · ${pick.atoms} atoms`;
}

// The neutral-lane elements by atomic number, lightest first.
const BY_Z = ['H', 'Li', 'B', 'C', 'N', 'O', 'F', 'Na', 'Mg', 'Si', 'P', 'S', 'Cl', 'K', 'Ca', 'Br', 'I'];

/** A text mark for a pick when its drawing is not shown: its heaviest element. */
export function omolPickMark(pick: OmolPick): string {
  let mark = 'C';
  let rank = -1;
  for (const symbol of pick.elements) {
    const z = BY_Z.indexOf(symbol);
    if (z > rank) {
      rank = z;
      mark = symbol;
    }
  }
  return mark;
}

/**
 * Open a pick in place: warm the viewer chunks, tag the entry for
 * `molecule_loaded`, then load the same-origin file through the viewer's
 * loader (code-split, so the landing never pays for it before a tap).
 */
export async function openOmolPick(
  pick: OmolPick,
  entry: OpenEntry,
  prefetchViewer?: () => void,
): Promise<ViewerOpenResult> {
  prefetchViewer?.();
  markOpenEntry(entry);
  const { openMolecule } = await import('../viewer/openMolecule');
  return openMolecule({ kind: 'url', url: pick.file, title: omolPickTitle(pick), history: 'push' });
}

/** "Surprise me": one uniform row of the 34.3M neutral training split, opened in place. */
export async function openOmolSurprise(entry: OpenEntry, prefetchViewer?: () => void): Promise<ViewerOpenResult> {
  prefetchViewer?.();
  markOpenEntry(entry);
  const { openRandomOmol25Molecule } = await import('../molecules/randomOmol');
  return openRandomOmol25Molecule();
}
