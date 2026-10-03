/**
 * store.ts — the visitor's Daily history, on this device only.
 *
 * localStorage 'lupi.daily.v1': one record per date played (the guesses, how
 * it ended, and the answer's name once it is over, so the home card can say
 * "Yesterday: caffeine" without fetching anything). Nothing leaves the
 * browser. Streaks count days solved on the day itself (or a day early,
 * across time zones); a puzzle played after its day is practice: kept, shown,
 * never counted. No shaming: a broken streak is simply not shown.
 *
 * Every read and write survives blocked storage (private windows, previews):
 * the game still plays, it just forgets.
 */
import { CLUE_COUNT, addDays, isDateKey, type DateKey } from './schedule';

const STORAGE_KEY = 'lupi.daily.v1';

export type DayStatus = 'play' | 'won' | 'lost';

export interface DayRecord {
  /** The puzzle token this record belongs to (a changed queue resets the day). */
  t: string;
  /** Pool keys guessed, in order. */
  g: string[];
  s: DayStatus;
  /** The clue the game ended on: the winning guess's number, or CLUE_COUNT. */
  c?: number;
  /** The answer, once the game is over. */
  n?: string;
  id?: string;
  /** Played after its day: practice, never in streaks or stats. */
  p?: 1;
  /** Revealed without playing ("Show the answer"). */
  r?: 1;
}

interface StoreV1 {
  v: 1;
  days: Record<DateKey, DayRecord>;
}

function empty(): StoreV1 {
  return { v: 1, days: {} };
}

export function readDailyStore(): StoreV1 {
  try {
    if (typeof localStorage === 'undefined') return empty();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<StoreV1> | null;
    if (!parsed || parsed.v !== 1 || typeof parsed.days !== 'object' || parsed.days === null) return empty();
    const days: Record<DateKey, DayRecord> = {};
    for (const [key, record] of Object.entries(parsed.days)) {
      if (!isDateKey(key) || !record || typeof record !== 'object') continue;
      const r = record as Partial<DayRecord>;
      if (typeof r.t !== 'string' || !Array.isArray(r.g) || (r.s !== 'play' && r.s !== 'won' && r.s !== 'lost')) continue;
      days[key] = {
        t: r.t,
        g: r.g.filter((g): g is string => typeof g === 'string').slice(0, CLUE_COUNT),
        s: r.s,
        ...(typeof r.c === 'number' ? { c: r.c } : {}),
        ...(typeof r.n === 'string' ? { n: r.n } : {}),
        ...(typeof r.id === 'string' ? { id: r.id } : {}),
        ...(r.p ? { p: 1 as const } : {}),
        ...(r.r ? { r: 1 as const } : {}),
      };
    }
    return { v: 1, days };
  } catch {
    return empty();
  }
}

export function readDay(key: DateKey): DayRecord | null {
  return readDailyStore().days[key] ?? null;
}

export function writeDay(key: DateKey, record: DayRecord): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const store = readDailyStore();
    store.days[key] = record;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage blocked or full: the game plays on without memory */
  }
}

export interface DailyStats {
  /** Games finished on their day. */
  played: number;
  won: number;
  /** Consecutive days solved, ending today (or yesterday, while today is open). */
  streak: number;
  best: number;
  /** Wins by the clue they came on: index 1..CLUE_COUNT (index 0 unused). */
  byClue: number[];
  lost: number;
}

function counts(record: DayRecord | undefined): boolean {
  return Boolean(record && !record.p && !record.r && (record.s === 'won' || record.s === 'lost'));
}

export function dailyStats(today: DateKey, store: StoreV1 = readDailyStore()): DailyStats {
  const byClue = new Array<number>(CLUE_COUNT + 1).fill(0);
  let played = 0;
  let won = 0;
  let lost = 0;
  const wins: DateKey[] = [];
  for (const [key, record] of Object.entries(store.days)) {
    if (!counts(record)) continue;
    played += 1;
    if (record.s === 'won') {
      won += 1;
      wins.push(key);
      const clue = Math.min(CLUE_COUNT, Math.max(1, record.c ?? CLUE_COUNT));
      byClue[clue] += 1;
    } else {
      lost += 1;
    }
  }

  const isWin = (key: DateKey) => {
    const record = store.days[key];
    return Boolean(record && counts(record) && record.s === 'won');
  };
  let cursor = today;
  const todays = store.days[today];
  if (!todays || !counts(todays)) cursor = addDays(today, -1);
  let streak = 0;
  while (isWin(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  wins.sort();
  let best = 0;
  let run = 0;
  let previous: DateKey | null = null;
  for (const key of wins) {
    run = previous && addDays(previous, 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }
  return { played, won, streak, best: Math.max(best, streak), byClue, lost };
}
