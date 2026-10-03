/**
 * build.mts — every artifact of Lupi Daily, for the build
 * (scripts/generate-daily-pages.mts writes them into apps/web/dist) and the
 * dev server (apps/web/vite.config.ts serves them on request).
 *
 *   /daily/               dist/daily/index.html   today's puzzle (the visitor's clock)
 *   /daily/text           dist/daily/text.html    the same game in words
 *   /daily/<date>         dist/daily/<date>.html  No. 1 (2026-10-01) to DAILY_PAGES_AHEAD days past the build
 *   /daily/pool.json      every guessable name
 *   /daily/schedule.json  the tokens in queue order (the home page's Daily card reads it)
 *   /daily/p/<token>.json one molecule's drawing and sealed clues (55 files, reused every pass)
 *   /og/daily.jpg         the generic card
 *   /og/daily/<date>.jpg  a date's card, DAILY_CARDS_BEHIND days before the build to DAILY_CARDS_AHEAD after
 *
 * Tokens are a salted hash of the gallery id, so no file name names an answer.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { InkModel } from '../../packages/ui/src/moleculePage/ink.ts';
import {
  DAILY_EPOCH,
  addDays,
  dailyPose,
  dayNumber,
  daysBetween,
  isDateKey,
  localDateKey,
  queueIndex,
  type DateKey,
} from '../../packages/ui/src/daily/schedule.ts';
import {
  DAILY_SCHEMA,
  sealSecret,
  type DailyPool,
  type DailyPuzzleFile,
  type DailySecret,
} from '../../packages/ui/src/daily/secret.ts';
import { appEntryFrom, loadMoleculeSite, viewerChunks, type MoleculeSite } from '../molecule-pages/build.mts';
import type { MoleculeRecord } from '../molecule-pages/catalog.mts';
import { dailyCardSvg, dailyGenericCardSvg, rasterizeDailyCard } from './card.mts';
import { dailyClues, dailyPool, warmthTable } from './clues.mts';
import { renderDailyPage, type DailyPageContext, type DailyPageKind } from './html.mts';
import { DAILY_DECOYS, DAILY_QUEUE, DAILY_SALT } from './queue.mts';

/** Date pages are written this far past the build; later share links fall back to /daily/. */
export const DAILY_PAGES_AHEAD = 120;
/** Cards for recent days (chats re-fetch an unfurl now and then) … */
export const DAILY_CARDS_BEHIND = 14;
/** … and for the days until the next deploy is likely. */
export const DAILY_CARDS_AHEAD = 60;

export interface DailySite {
  molecules: MoleculeSite;
  /** The curated queue, in order. */
  queue: MoleculeRecord[];
  tokens: string[];
  pool: DailyPool;
  /** token → puzzle file */
  files: Map<string, DailyPuzzleFile>;
  origin: string;
}

export function dailyToken(id: string): string {
  return createHash('sha256').update(`${DAILY_SALT}:${id}`).digest('hex').slice(0, 12);
}

/** The model as the client sees it: element symbols replaced by opaque labels. */
function clearModel(model: InkModel): InkModel {
  return { ...model, kinds: model.kinds.map((kind, i) => ({ ...kind, s: `k${i}` })) };
}

export function loadDailySite(repoRoot: string, molecules: MoleculeSite = loadMoleculeSite(repoRoot)): DailySite {
  const queue: MoleculeRecord[] = [];
  const seen = new Set<string>();
  for (const id of DAILY_QUEUE) {
    const record = molecules.byId.get(id);
    if (!record) {
      console.warn(`[daily] queue entry ${id} has no molecule page; skipped`);
      continue;
    }
    if (seen.has(id)) throw new Error(`[daily] ${id} is in the queue twice`);
    seen.add(id);
    queue.push(record);
  }
  if (queue.length === 0) throw new Error('[daily] the queue is empty');

  const { entries, candidates } = dailyPool(molecules.records, DAILY_DECOYS);
  const tokens: string[] = [];
  const files = new Map<string, DailyPuzzleFile>();
  for (const record of queue) {
    const token = dailyToken(record.id);
    tokens.push(token);
    const secret: DailySecret = {
      id: record.id,
      name: record.name,
      accept: [record.id],
      clues: dailyClues(record),
      warm: warmthTable(record.id, candidates),
    };
    files.set(token, { schema: DAILY_SCHEMA, model: clearModel(record.model), secret: sealSecret(secret, token) });
  }
  return { molecules, queue, tokens, pool: { schema: DAILY_SCHEMA, entries }, files, origin: molecules.origin };
}

/** The record and pose of one date's puzzle (null before No. 1). */
export function puzzleFor(site: DailySite, key: DateKey): { record: MoleculeRecord; token: string; day: number } | null {
  const day = dayNumber(key);
  const index = queueIndex(day, site.queue.length);
  if (index < 0) return null;
  return { record: site.queue[index], token: site.tokens[index], day };
}

export function buildToday(): DateKey {
  const forced = process.env.LUPI_DAILY_TODAY;
  if (forced && isDateKey(forced)) return forced;
  return localDateKey();
}

export interface DailyWindow {
  pages: DateKey[];
  cards: DateKey[];
  lastPage: DateKey;
}

export function dailyWindow(today: DateKey): DailyWindow {
  const lastPage = addDays(today, DAILY_PAGES_AHEAD);
  const pages: DateKey[] = [];
  for (let key = DAILY_EPOCH; daysBetween(key, lastPage) >= 0; key = addDays(key, 1)) pages.push(key);
  const firstCard = daysBetween(DAILY_EPOCH, addDays(today, -DAILY_CARDS_BEHIND)) > 0 ? addDays(today, -DAILY_CARDS_BEHIND) : DAILY_EPOCH;
  const lastCard = addDays(today, DAILY_CARDS_AHEAD);
  const cards: DateKey[] = [];
  for (let key = firstCard; daysBetween(key, lastCard) >= 0; key = addDays(key, 1)) cards.push(key);
  return { pages, cards, lastPage };
}

export function dailyContext(
  site: DailySite,
  opts: { lastPage: DateKey; cards: Set<DateKey>; genericCard: boolean; appEntry?: string; warm?: string[] },
): DailyPageContext {
  return {
    origin: site.origin,
    tokens: site.tokens,
    appEntry: opts.appEntry,
    warm: opts.warm,
    lastPage: opts.lastPage,
    cards: opts.cards,
    genericCard: opts.genericCard,
    defaultImage: site.molecules.defaultImage,
  };
}

/** One page's HTML, or null for a date before No. 1. */
export function dailyPageHtml(site: DailySite, template: string, which: 'home' | 'text' | DateKey, ctx: DailyPageContext): string | null {
  let page: DailyPageKind;
  if (which === 'home' || which === 'text') page = { kind: which };
  else {
    const puzzle = puzzleFor(site, which);
    if (!puzzle) return null;
    page = { kind: 'date', date: which, token: puzzle.token };
  }
  return renderDailyPage(template, page, ctx);
}

export async function dailyCardJpeg(site: DailySite, key: DateKey | null): Promise<Buffer | null> {
  if (key === null) return rasterizeDailyCard(dailyGenericCardSvg(site.origin));
  const puzzle = puzzleFor(site, key);
  if (!puzzle) return null;
  const pose = dailyPose(puzzle.record.model, puzzle.day, site.queue.length);
  return rasterizeDailyCard(dailyCardSvg(key, puzzle.record.model, pose, site.origin));
}

export function dailyPuzzleJson(site: DailySite, token: string): string | null {
  const file = site.files.get(token);
  return file ? JSON.stringify(file) : null;
}

export function dailyPoolJson(site: DailySite): string {
  return JSON.stringify(site.pool);
}

/** The home page's Daily card finds today's silhouette with this (the pages embed the same tokens). */
export function dailyScheduleJson(site: DailySite): string {
  return JSON.stringify({ schema: DAILY_SCHEMA, epoch: DAILY_EPOCH, tokens: site.tokens });
}

export interface DailyReport {
  pages: number;
  cards: number;
  puzzles: number;
  failures: string[];
}

/** Write every artifact into `distRoot` (the built app). */
export async function writeDailySite(repoRoot: string, distRoot: string, today: DateKey = buildToday()): Promise<DailyReport> {
  const site = loadDailySite(repoRoot);
  const templatePath = path.join(distRoot, 'daily.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  const indexPath = path.join(distRoot, 'index.html');
  const appEntry = fs.existsSync(indexPath) ? appEntryFrom(fs.readFileSync(indexPath, 'utf8')) : undefined;
  const report: DailyReport = { pages: 0, cards: 0, puzzles: 0, failures: [] };
  const span = dailyWindow(today);

  const pagesDir = path.join(distRoot, 'daily');
  const puzzlesDir = path.join(pagesDir, 'p');
  const cardsDir = path.join(distRoot, 'og', 'daily');
  for (const dir of [pagesDir, puzzlesDir, cardsDir]) fs.mkdirSync(dir, { recursive: true });

  for (const [token, file] of site.files) {
    fs.writeFileSync(path.join(puzzlesDir, `${token}.json`), JSON.stringify(file));
    report.puzzles += 1;
  }
  fs.writeFileSync(path.join(pagesDir, 'pool.json'), dailyPoolJson(site));
  fs.writeFileSync(path.join(pagesDir, 'schedule.json'), dailyScheduleJson(site));

  // Cards first: a page names its own card only when the card exists.
  const cards = new Set<DateKey>();
  for (const key of span.cards) {
    const jpeg = await dailyCardJpeg(site, key);
    if (jpeg) {
      fs.writeFileSync(path.join(cardsDir, `${key}.jpg`), jpeg);
      cards.add(key);
      report.cards += 1;
    }
  }
  const generic = await dailyCardJpeg(site, null);
  if (generic) {
    fs.writeFileSync(path.join(distRoot, 'og', 'daily.jpg'), generic);
    report.cards += 1;
  }
  if (cards.size < span.cards.length) report.failures.push('some Daily cards failed to rasterise; those pages use the generic card');

  const ctx = dailyContext(site, { lastPage: span.lastPage, cards, genericCard: Boolean(generic), appEntry, warm: viewerChunks(distRoot) });
  fs.writeFileSync(path.join(pagesDir, 'index.html'), dailyPageHtml(site, template, 'home', ctx)!);
  fs.writeFileSync(path.join(pagesDir, 'text.html'), dailyPageHtml(site, template, 'text', ctx)!);
  report.pages += 2;
  for (const key of span.pages) {
    const html = dailyPageHtml(site, template, key, ctx);
    if (!html) continue;
    fs.writeFileSync(path.join(pagesDir, `${key}.html`), html);
    report.pages += 1;
  }

  const sitemapPath = path.join(distRoot, 'sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    const sitemap = fs.readFileSync(sitemapPath, 'utf8');
    const url = `${site.origin}/daily/`;
    if (!sitemap.includes(`<loc>${url}</loc>`)) {
      fs.writeFileSync(sitemapPath, sitemap.replace('</urlset>', `  <url><loc>${url}</loc><changefreq>daily</changefreq></url>\n</urlset>`));
    }
  }

  fs.rmSync(templatePath, { force: true });
  return report;
}
