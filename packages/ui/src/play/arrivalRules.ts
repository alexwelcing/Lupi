/**
 * arrivalRules.ts — when a freshly opened molecule condenses out of a mist.
 *
 * Pure: every input is passed in, so the rules are testable and the driver
 * (PlayLayer) owns reading the page. The arrival is a first-open delight, so
 * it never plays for machine or share traffic (MCP, embeds, batch exports,
 * shared state, saved views), for large or animated files, while the
 * transmission renderer (no impostor graph) or playback is on, under the
 * Still comfort, or for a molecule already seen this session.
 *
 * `?arrival=0` disables it; `?arrival=1` forces it past the session and
 * comfort rules (smoke checks and demos). The mode is `flat` (the drawing
 * inflating into depth) when the home hero handed this very molecule over,
 * otherwise `condense`.
 */
import type { Comfort } from '../motion/comfort';

export type ArrivalMode = 'condense' | 'flat';

/** Above this many atoms the arrival never plays. */
export const ARRIVAL_MAX_ATOMS = 20_000;

/** sessionStorage key: the JSON array of molecule ids that already arrived. */
export const ARRIVAL_SEEN_KEY = 'lupi.arrival.seen';

export interface ArrivalRuleInput {
  natoms: number;
  totalFrames: number;
  transmissionActive: boolean;
  playing: boolean;
  comfort: Comfort;
  /** window.location.hash */
  hash: string;
  /** window.location.search */
  search: string;
  /** window.location.pathname (saved views also live at /view/<slug>). */
  pathname?: string;
  /** Ids that already arrived this session. */
  seenIds: ReadonlySet<string> | readonly string[];
  /** The gallery id, or another stable id of the molecule (its name). */
  galleryId: string | null;
  /** The relay baton (`peekBaton()`), if any. */
  baton?: { galleryId: string; source: string } | null;
}

function hashRoute(hash: string): string {
  const route = hash.replace(/^#/, '').trim();
  return (route.split('?')[0] || '/').toLowerCase();
}

function isSavedViewPath(path: string): boolean {
  return path.startsWith('/view/');
}

function has(ids: ArrivalRuleInput['seenIds'], id: string): boolean {
  return Array.isArray(ids) ? ids.includes(id) : (ids as ReadonlySet<string>).has(id);
}

/** Gates shared by the arrival and Scatter: what the scene and the page allow at all. */
function sceneAllows(input: ArrivalRuleInput): boolean {
  if (!(input.natoms > 0) || input.natoms > ARRIVAL_MAX_ATOMS) return false;
  if (input.totalFrames !== 1) return false;
  if (input.transmissionActive || input.playing) return false;
  const route = hashRoute(input.hash);
  if (route === '/mcp' || route.startsWith('/mcp/') || route.startsWith('/embed')) return false;
  return true;
}

/** The arrival for a molecule that just opened, or null. */
export function shouldPlayArrival(input: ArrivalRuleInput): ArrivalMode | null {
  const params = new URLSearchParams(input.search);
  const flag = params.get('arrival');
  if (flag === '0') return null;
  const forced = flag === '1';

  if (!sceneAllows(input)) return null;
  if (params.has('mcpCommand') || params.get('batchExport') === 'true' || params.has('s')) return null;
  if (isSavedViewPath(hashRoute(input.hash)) || isSavedViewPath((input.pathname ?? '/').toLowerCase())) return null;
  if (!forced) {
    if (input.comfort === 'still') return null;
    if (input.galleryId && has(input.seenIds, input.galleryId)) return null;
  }

  const baton = input.baton;
  if (baton && baton.source === 'hero' && input.galleryId != null && baton.galleryId === input.galleryId) return 'flat';
  return 'condense';
}

/** Scatter (the Play tray's button): the scene gates and comfort, never the session rule. */
export function canPlayScatter(input: ArrivalRuleInput): boolean {
  return sceneAllows(input) && input.comfort !== 'still';
}

/** The ids that already arrived this session (empty when storage is blocked). */
export function readSeenArrivals(): Set<string> {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(ARRIVAL_SEEN_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Remember that `id` arrived this session. */
export function markArrivalSeen(id: string): void {
  try {
    const seen = readSeenArrivals();
    if (seen.has(id)) return;
    seen.add(id);
    sessionStorage.setItem(ARRIVAL_SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    /* storage blocked: the arrival may repeat, which is harmless */
  }
}
