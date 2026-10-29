/**
 * schedule.ts — which mystery molecule belongs to which day.
 *
 * Every visitor gets the same molecule on the same calendar date, keyed by
 * the visitor's own local date (puzzles roll over at local midnight, as
 * Wordle's do). The queue is a curated list of gallery molecules, known to
 * the client only as opaque tokens in curated order (scripts/daily/queue.mts
 * holds the names; the client never ships them). The first pass through the
 * queue runs in the curated order; every later pass is a seeded shuffle, and
 * no molecule ever plays two days running across a pass boundary.
 *
 * Pure: no DOM, no storage. Shared by the build (pages, cards), the /daily
 * page and the home page's Daily card.
 */
import type { InkModel, InkPose } from '../moleculePage/ink';

/** A calendar date, YYYY-MM-DD. */
export type DateKey = string;

/** Lupi Daily No. 1. */
export const DAILY_EPOCH: DateKey = '2026-10-01';
/** Wrong guesses allowed is CLUE_COUNT − 1: the sixth wrong guess ends the game. */
export const CLUE_COUNT = 6;

const DAY_MS = 86_400_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string') return false;
  const match = KEY_RE.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The visitor's local calendar date. */
export function localDateKey(now: Date = new Date()): DateKey {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function ordinal(key: DateKey): number {
  const match = KEY_RE.exec(key);
  if (!match) return NaN;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
}

function keyFromOrdinal(value: number): DateKey {
  const date = new Date(value * DAY_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Days from No. 1 (0 on the epoch; negative before it). */
export function dayNumber(key: DateKey): number {
  return ordinal(key) - ordinal(DAILY_EPOCH);
}

/** The puzzle's public number (No. 1 on the epoch). */
export function puzzleNumber(key: DateKey): number {
  return dayNumber(key) + 1;
}

export function addDays(key: DateKey, days: number): DateKey {
  return keyFromOrdinal(ordinal(key) + days);
}

export function daysBetween(from: DateKey, to: DateKey): number {
  return ordinal(to) - ordinal(from);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parts(key: DateKey): { weekday: number; day: number; month: number; year: number } {
  const date = new Date(ordinal(key) * DAY_MS);
  return { weekday: date.getUTCDay(), day: date.getUTCDate(), month: date.getUTCMonth(), year: date.getUTCFullYear() };
}

/** "Saturday 3 October 2026": fixed English, the same in the build and every browser. */
export function formatLongDate(key: DateKey): string {
  const p = parts(key);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** "Sat 3 Oct". */
export function formatShortDate(key: DateKey): string {
  const p = parts(key);
  return `${WEEKDAYS[p.weekday].slice(0, 3)} ${p.day} ${MONTHS[p.month].slice(0, 3)}`;
}

/** Milliseconds until the visitor's next local midnight. */
export function msUntilLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - now.getTime());
}

// ── Seeded order ─────────────────────────────────────────────────────

/** FNV-1a, 32-bit. */
export function fnv1a(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: a small, fast, seeded generator in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cycles = new Map<string, number[]>();

/** The queue order of one pass (cycle 0 is the curated order). */
function cycleOrder(cycle: number, length: number): number[] {
  const memo = `${length}:${cycle}`;
  const known = cycles.get(memo);
  if (known) return known;
  const order = Array.from({ length }, (_, i) => i);
  if (cycle > 0 && length > 1) {
    const random = mulberry32(fnv1a(`lupi-daily:cycle:${cycle}`));
    for (let i = length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // Never the same molecule two days running across the pass boundary.
    const previous = cycleOrder(cycle - 1, length);
    if (order[0] === previous[length - 1]) [order[0], order[1]] = [order[1], order[0]];
  }
  cycles.set(memo, order);
  return order;
}

/** Index into the curated queue for a day number, or -1 before the epoch. */
export function queueIndex(day: number, length: number): number {
  if (!Number.isFinite(day) || day < 0 || length <= 0) return -1;
  const cycle = Math.floor(day / length);
  return cycleOrder(cycle, length)[day % length];
}

/**
 * The pose the day's silhouette opens on. The first pass opens on the
 * molecule's own page pose (its most telling view); later passes turn the
 * same molecule to a seeded face, so a repeat is a new picture.
 */
export function dailyPose(model: InkModel, day: number, length: number): InkPose {
  if (length <= 0 || day < length) return model.opening;
  const random = mulberry32(fnv1a(`lupi-daily:pose:${day}`));
  if (model.detents.length > 0) {
    const detent = model.detents[Math.floor(random() * model.detents.length)];
    return { azimuth: detent.azimuth, elevation: detent.elevation };
  }
  return { azimuth: model.opening.azimuth + (random() - 0.5) * Math.PI, elevation: model.opening.elevation };
}

// ── Paths ────────────────────────────────────────────────────────────

/** The page for one date (never names the answer). */
export function dailyPagePath(key: DateKey): string {
  return `/daily/${key}`;
}

/** Today's puzzle, from the visitor's clock. */
export const DAILY_HOME_PATH = '/daily/';
/** The same game as text, for screen readers. */
export const DAILY_TEXT_PATH = '/daily/text';
/** Every guessable name. */
export const DAILY_POOL_PATH = '/daily/pool.json';
/** The generic share card (/daily/ and the text route). */
export const DAILY_CARD_PATH = '/og/daily.jpg';

/** One molecule's drawing and sealed clues, by token. */
export function dailyPuzzlePath(token: string): string {
  return `/daily/p/${token}.json`;
}

/** The date's share card: the day's silhouette, prebuilt for a window around each deploy. */
export function dailyCardPath(key: DateKey): string {
  return `/og/daily/${key}.jpg`;
}
