/**
 * omolPicks.ts — the landing-safe logic behind the home page's OMol25 shelf
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

/** Element counts of a formula as written: a missing subscript is 1, a repeated element adds up (CH3COOH). */
function formulaCounts(text: string): Map<string, number> | null {
  const tokens = formulaTokens(text);
  if (!tokens) return null;
  const counts = new Map<string, number>();
  for (const [symbol, n] of tokens) counts.set(symbol, (counts.get(symbol) ?? 0) + (n ?? 1));
  return counts;
}

/** A formula in the OMol25 index's order: C, then H (with or without carbon), then alphabetical. */
export function omolIndexFormula(text: string): string | null {
  const counts = formulaCounts(text.trim());
  if (!counts) return null;
  const rank = (symbol: string) => (symbol === 'C' ? 0 : symbol === 'H' ? 1 : 2);
  return [...counts.keys()]
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map((symbol) => `${symbol}${counts.get(symbol) === 1 ? '' : counts.get(symbol)}`)
    .join('');
}

export interface OmolPickMatches {
  /** Picks the query names: its exact formula (in any element order), a lone element symbol, or "omol25". */
  named: OmolPick[];
  /** Picks that contain the written formula alongside other elements: never Enter's default. */
  containing: OmolPick[];
}

/**
 * Featured picks a finder query matches. A formula reads as written (no
 * subscript means one), so "CH4" names methane's formula and never a
 * fluorinated ether; a lone symbol ("Br") lists picks with that element.
 * "omol25" (or its start) lists today's picks. At most `limit` in all.
 */
export function findOmolPicks(query: string, picks: readonly OmolPick[] = OMOL_PICKS, limit = OMOL_FINDER_LIMIT): OmolPickMatches {
  const none: OmolPickMatches = { named: [], containing: [] };
  const q = query.trim();
  if (q.length < 2 || limit <= 0) return none;
  if (q.length >= 3 && 'omol25'.startsWith(q.toLowerCase())) return { named: todaysOmolPicks(limit), containing: [] };
  const want = formulaCounts(q);
  if (!want) return none;
  const element = /^[A-Z][a-z]?$/.test(q) ? q : null;
  const named: OmolPick[] = [];
  const containing: OmolPick[] = [];
  for (const pick of picks) {
    const have = formulaCounts(pick.formula);
    if (!have) continue;
    if (element) {
      if (have.has(element)) named.push(pick);
    } else if ([...want].every(([symbol, n]) => have.get(symbol) === n)) {
      (have.size === want.size ? named : containing).push(pick);
    }
  }
  const kept = named.slice(0, limit);
  return { named: kept, containing: containing.slice(0, limit - kept.length) };
}

/** `findOmolPicks` as one list, the named picks first. */
export function matchOmolPicks(query: string, picks: readonly OmolPick[] = OMOL_PICKS, limit = OMOL_FINDER_LIMIT): OmolPick[] {
  const { named, containing } = findOmolPicks(query, picks, limit);
  return [...named, ...containing];
}

/**
 * The Library facet view for a formula: the explicit "Find … in OMol25" link.
 * The index matches its own formula form, so "LiOH" goes as HLiO and
 * "C2H5OH" as C2H6O.
 */
export function omolFormulaHandoffHref(query: string): string {
  const q = query.trim();
  return `/library/omol25?view=facets&q=${encodeURIComponent(omolIndexFormula(q) ?? q)}`;
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
