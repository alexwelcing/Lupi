/**
 * secret.ts — the Daily's data shapes, and the seal on the answer.
 *
 * A puzzle file (/daily/p/<token>.json) carries the drawing in the clear
 * (coordinates, CPK colours, bonds: what the silhouette and the colour clue
 * draw; element symbols are stripped) and everything that names the answer
 * sealed: the name, the gallery id, the text clues and the warmth table.
 *
 * The seal is an XOR keystream keyed by the token, then base64. It is not
 * security, and cannot be: the page must open it to check a guess. It keeps
 * the answer out of view-source, out of search results and out of anything
 * that scrapes the JSON, as Wordle's word list sat in its bundle. No file
 * name, URL, meta tag or card ever names the answer.
 *
 * Pure: no DOM. Shared by the build (scripts/daily) and the page.
 */
import type { InkModel } from '../moleculePage/ink';
import { fnv1a, mulberry32, type DateKey } from './schedule';

export const DAILY_SCHEMA = 'lupi.daily.v1';

/** One rung of the clue ladder: a visual stage and its written twin. */
export interface DailyClue {
  /** "Size and shape", "Elements", … */
  title: string;
  /** The clue as a sentence (what the text version and screen readers get). */
  text: string;
  /** A formula to typeset with subscripts after the text. */
  formula?: string;
  /** The name with its letters hidden ("C _ _ _ _ _ _ _"), shown in mono. */
  pattern?: string;
}

/** What the seal hides. */
export interface DailySecret {
  /** Gallery id: /m/<id> and the viewer's /?sim=<id>. */
  id: string;
  name: string;
  /** Pool keys that count as the answer (the id and any same-substance entry). */
  accept: string[];
  /** Six clues, in order. */
  clues: DailyClue[];
  /** Pool key → warmth 0..99: how alike that guess is to the answer. */
  warm: Record<string, number>;
}

/** /daily/p/<token>.json */
export interface DailyPuzzleFile {
  schema: typeof DAILY_SCHEMA;
  /** The drawing; `kinds[].s` are opaque labels, not element symbols. */
  model: InkModel;
  /** Sealed DailySecret. */
  secret: string;
}

/** One guessable name (/daily/pool.json). */
export interface DailyPoolEntry {
  /** Key: a gallery id, or `x-<slug>` for a molecule Lupi has no page for. */
  k: string;
  /** Display name. */
  n: string;
  /** Other names that pick the same entry. */
  a?: string[];
}

export interface DailyPool {
  schema: typeof DAILY_SCHEMA;
  entries: DailyPoolEntry[];
}

/** Embedded in every Daily page (#lupi-daily-data). */
export interface DailyPageData {
  mode: 'play' | 'text';
  /** The page's own date (/daily/<date>), or null for today's from the visitor's clock (/daily/). */
  date: DateKey | null;
  /** Puzzle tokens in curated queue order (schedule.ts maps a day to one). */
  tokens: string[];
  /** https://lupi.live */
  origin: string;
  /** The viewer's entry module, warmed before "Open in 3D". */
  appEntry?: string;
  /** The viewer's heavy chunks, prefetched on intent. */
  warm?: string[];
  /** Dates up to this one have a page and card (later share links fall back to /daily/). */
  lastPage: DateKey;
}

/** Gallery ids are never pool keys of decoys. */
export function isPageKey(key: string): boolean {
  return !key.startsWith('x-');
}

function keystream(token: string, length: number): Uint8Array {
  const random = mulberry32(fnv1a(`lupi-daily:seal:${token}`));
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = Math.floor(random() * 256);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function sealSecret(secret: DailySecret, token: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(secret));
  const key = keystream(token, bytes.length);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] ^= key[i];
  return toBase64(bytes);
}

export function openSecret(sealed: string, token: string): DailySecret | null {
  try {
    const bytes = fromBase64(sealed);
    const key = keystream(token, bytes.length);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] ^= key[i];
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<DailySecret>;
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string' || !Array.isArray(parsed.clues)) return null;
    return {
      id: parsed.id,
      name: parsed.name,
      accept: Array.isArray(parsed.accept) ? parsed.accept : [parsed.id],
      clues: parsed.clues,
      warm: parsed.warm ?? {},
    };
  } catch {
    return null;
  }
}
