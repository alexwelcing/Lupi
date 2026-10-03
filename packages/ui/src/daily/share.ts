/**
 * share.ts — the spoiler-free result: text first, a glyph row as decoration.
 *
 *   Lupi Daily No. 3 · Sat 3 Oct
 *   Solved on clue 3 of 6
 *   🟦🟧🟩⬜⬜⬜
 *   https://lupi.live/daily/2026-10-03
 *
 * The text carries the result; the row repeats it (one square per guess, its
 * colour the guess's warmth, green for the answer, white for clues not
 * needed) and is never the only carrier. Nothing in it names the answer: the
 * link opens the same puzzle, and its card is the silhouette.
 */
import { CLUE_COUNT, formatShortDate, puzzleNumber, type DateKey } from './schedule';
import type { DayRecord } from './store';

/** Warmth bands, shared by the guess rows and the glyph row. */
export function warmthBand(warmth: number): { word: string; glyph: string; band: 'cold' | 'cool' | 'warm' | 'hot' | 'burning' } {
  if (warmth >= 90) return { word: 'Very hot', glyph: '🟥', band: 'burning' };
  if (warmth >= 70) return { word: 'Hot', glyph: '🟧', band: 'hot' };
  if (warmth >= 40) return { word: 'Warm', glyph: '🟨', band: 'warm' };
  if (warmth >= 20) return { word: 'Cool', glyph: '🟦', band: 'cool' };
  return { word: 'Cold', glyph: '🟦', band: 'cold' };
}

export const SOLVED_GLYPH = '🟩';
export const UNUSED_GLYPH = '⬜';

export function glyphRow(record: DayRecord, warmthOf: (key: string) => number, isAnswer: (key: string) => boolean): string {
  const glyphs = record.g.map((key) => (isAnswer(key) ? SOLVED_GLYPH : warmthBand(warmthOf(key)).glyph));
  while (glyphs.length < CLUE_COUNT) glyphs.push(UNUSED_GLYPH);
  return glyphs.join('');
}

/** "Solved on clue 3 of 6" / "Not solved: 6 guesses". */
export function verdictLine(record: DayRecord): string {
  if (record.s === 'won') return record.c === 1 ? 'Solved on the first clue' : `Solved on clue ${record.c ?? record.g.length} of ${CLUE_COUNT}`;
  if (record.r) return 'Answer revealed';
  return `Not solved in ${CLUE_COUNT} guesses`;
}

export interface ShareInput {
  date: DateKey;
  record: DayRecord;
  glyphs: string;
  /** Absolute link to the date's page. */
  url: string;
  streak: number;
}

/** The headline, the verdict and the glyph row (no link). */
export function shareBody({ date, record, glyphs, streak }: Omit<ShareInput, 'url'>): string {
  const lines = [`Lupi Daily No. ${puzzleNumber(date)} · ${formatShortDate(date)}`, verdictLine(record)];
  if (streak >= 2 && record.s === 'won' && !record.p) lines[1] += ` · ${streak}-day streak`;
  lines.push(glyphs);
  return lines.join('\n');
}

/** The whole post, for the clipboard. */
export function shareText(input: ShareInput): string {
  return `${shareBody(input)}\n${input.url}`;
}
