/**
 * html.mts — the static HTML of Lupi Daily's pages, filled into the
 * Vite-built template (apps/web/daily.html):
 *
 *   /daily/          today's puzzle, from the visitor's clock
 *   /daily/<date>    one date's puzzle; its card is that day's silhouette
 *   /daily/text      the same game in words (screen readers first)
 *
 * The HTML holds the frame, the empty board and the queue's tokens; it never
 * names an answer (no id in a file name, a meta tag, structured data or the
 * card). The page script (packages/ui/src/daily/page.ts) does the rest.
 */
import {
  DAILY_CARD_PATH,
  DAILY_HOME_PATH,
  DAILY_POOL_PATH,
  DAILY_TEXT_PATH,
  dailyCardPath,
  dailyPagePath,
  dailyPuzzlePath,
  formatLongDate,
  puzzleNumber,
  type DateKey,
} from '../../packages/ui/src/daily/schedule.ts';
import type { DailyPageData } from '../../packages/ui/src/daily/secret.ts';
import { CARD_HEIGHT, CARD_WIDTH } from '../molecule-pages/card.mts';
import { escapeHtml } from '../molecule-pages/html.mts';
import { dailyCardAlt } from './card.mts';

const HEAD_MARK = '<!--lupi:daily-head-->';
const BODY_MARK = '<!--lupi:daily-body-->';

export interface DailyPageContext {
  origin: string;
  tokens: string[];
  appEntry?: string;
  warm?: string[];
  /** The last date with a page. */
  lastPage: DateKey;
  /** Dates whose card was written. */
  cards: Set<DateKey>;
  /** The generic card exists. */
  genericCard: boolean;
  defaultImage: string;
}

export type DailyPageKind = { kind: 'home' } | { kind: 'text' } | { kind: 'date'; date: DateKey; token: string };

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

function topBar(): string {
  return `<a class="mp-skip" href="#dl-guess">Skip to the guess box</a>
<header class="mp-top">
  <a class="mp-brand" href="/">Lupi</a>
  <nav aria-label="Site">
    <a href="${DAILY_HOME_PATH}" aria-current="page">Daily</a>
    <a href="/m/">All molecules</a>
    <a href="/library">Library</a>
  </nav>
</header>`;
}

function footer(): string {
  return `<footer class="mp-foot">
  <span>Lupi · explore molecules in 3D, free and without an account</span>
  <a href="/">Home</a>
  <a href="${DAILY_HOME_PATH}">Daily</a>
  <a href="${DAILY_TEXT_PATH}">Daily as text</a>
  <a href="/m/">All molecules</a>
</footer>`;
}

function headTags(page: DailyPageKind, ctx: DailyPageContext): string {
  const date = page.kind === 'date' ? page.date : null;
  const path = page.kind === 'date' ? dailyPagePath(page.date) : page.kind === 'text' ? DAILY_TEXT_PATH : DAILY_HOME_PATH;
  const url = `${ctx.origin}${path}`;
  const dated = date && ctx.cards.has(date);
  const image = dated ? `${ctx.origin}${dailyCardPath(date!)}` : ctx.genericCard ? `${ctx.origin}${DAILY_CARD_PATH}` : ctx.defaultImage;
  const alt = dailyCardAlt(dated ? date : null);
  const title =
    page.kind === 'date'
      ? `Lupi Daily No. ${puzzleNumber(page.date)} · ${formatLongDate(page.date)}`
      : page.kind === 'text'
        ? 'Lupi Daily, in words: name the mystery molecule from six written clues'
        : 'Lupi Daily: who’s that molecule?';
  const description =
    page.kind === 'text'
      ? 'The text version of Lupi Daily: one mystery molecule a day, six written clues, six guesses. Built for screen readers; your streak is shared with the picture version.'
      : 'One mystery molecule a day, the same for everyone. Name it from its ink silhouette in six clues, watch it bloom into colour, then open it in 3D.';
  const meta = (attr: string, key: string, content: string) => `<meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`;
  const robots = page.kind === 'home' ? 'index,follow,max-image-preview:large' : 'noindex,follow,max-image-preview:large';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url,
    description,
    isPartOf: { '@type': 'WebSite', name: 'Lupi', url: `${ctx.origin}/` },
  };
  const preload = [
    `<link rel="preload" href="${DAILY_POOL_PATH}" as="fetch" crossorigin />`,
    ...(page.kind === 'date' ? [`<link rel="preload" href="${dailyPuzzlePath(page.token)}" as="fetch" crossorigin />`] : []),
  ];
  return [
    `<title>${escapeHtml(`${title} | Lupi`)}</title>`,
    meta('name', 'description', description),
    meta('name', 'robots', robots),
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    meta('property', 'og:site_name', 'Lupi'),
    meta('property', 'og:locale', 'en_US'),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    ...(dated || ctx.genericCard
      ? [meta('property', 'og:image:type', 'image/jpeg'), meta('property', 'og:image:width', String(CARD_WIDTH)), meta('property', 'og:image:height', String(CARD_HEIGHT))]
      : []),
    meta('property', 'og:image:alt', alt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', alt),
    ...preload,
    `<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`,
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}

function howToPlay(text: boolean): string {
  return `<section class="dl-panel dl-how" aria-labelledby="dl-how-h">
      <h2 id="dl-how-h">How to play</h2>
      <ol>
        <li>One mystery molecule a day, the same for everyone. A new one at your midnight.</li>
        <li>Six guesses. Each wrong one opens the next clue: ${
          text
            ? 'its elements, its rings, its formula, a property, then the letters of its name.'
            : 'the silhouette turns, then shows its bonds and rings, its colours, a property and the letters of its name.'
        }</li>
        <li>Every guess gets a warmth: how alike it is to the answer, by elements, size, kind and use.</li>
        <li>Name it${text ? '' : ' and it blooms into colour'}. Share your result without spoiling it, then open it in 3D.</li>
      </ol>
      <p>${
        text
          ? `<a href="${DAILY_HOME_PATH}">Play with the drawing</a>`
          : `<a href="${DAILY_TEXT_PATH}">Play the text version</a>`
      } · <a href="/m/">All molecules</a></p>
      <p><small>Drawings are illustrations of coordinate models. Warmth is Lupi’s likeness score, not a measurement.</small></p>
    </section>`;
}

function board(page: DailyPageKind): string {
  const text = page.kind === 'text';
  const head = text
    ? `<div class="dl-head">
      <p class="mp-kicker" id="dl-kicker">Lupi Daily</p>
      <h1 id="dl-title">Lupi Daily, in words</h1>
      <p class="dl-sub" id="dl-sub">One mystery molecule a day. Six written clues, six guesses. Each wrong guess opens the next clue. Your guesses and streak are shared with <a href="${DAILY_HOME_PATH}">the picture version</a>.</p>
    </div>`
    : `<div class="dl-head">
      <p class="mp-kicker" id="dl-kicker">Lupi Daily</p>
      <h1 id="dl-title">Who’s that molecule?</h1>
      <p class="dl-sub" id="dl-sub">Six clues. One molecule. The same for everyone today.</p>
    </div>`;
  const hero = text
    ? ''
    : `<figure class="dl-hero">
    <div id="dl-stage" class="dl-stage" role="img" aria-label="Today’s mystery molecule, silhouette"><div class="dl-wait" aria-hidden="true">?</div></div>
    <figcaption id="dl-caption" class="dl-caption">Loading today’s silhouette…</figcaption>
  </figure>`;
  return `<main id="main" class="dl-main" data-mode="${text ? 'text' : 'play'}">
  ${hero}
  <div class="dl-play">
    ${head}
    <div id="dl-banner" class="dl-banner" hidden></div>
    <form id="dl-form" class="dl-form" autocomplete="off" hidden>
      <label class="dl-label" for="dl-guess">Your guess</label>
      <div class="dl-combo">
        <input id="dl-guess" name="guess" type="text" placeholder="Name a molecule…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-describedby="dl-status" />
        <button class="mp-verb mp-verb--primary" type="submit">Guess</button>
        <ul id="dl-options" class="dl-options" aria-label="Molecules" hidden></ul>
      </div>
      <p id="dl-status" class="mp-status"></p>
    </form>
    <span id="dl-live" class="dl-sr" role="status" aria-live="polite"></span>
    <section aria-labelledby="dl-clues-h">
      <h2 id="dl-clues-h" class="dl-sr">Clues</h2>
      <ol id="dl-clues" class="dl-clues"></ol>
    </section>
    <ol id="dl-guesses" class="dl-guesses" aria-label="Your guesses" hidden></ol>
    <section id="dl-result" class="dl-result" hidden></section>
  </div>
  <div class="dl-side">
    <section id="dl-stats" class="dl-panel" aria-label="Your Daily"></section>
    <section id="dl-week" class="dl-panel" aria-label="This week"></section>
    <section id="dl-yesterday" class="dl-panel" aria-label="Yesterday" hidden></section>
    ${howToPlay(text)}
  </div>
  <noscript><p class="dl-note">Lupi Daily needs JavaScript: it keeps your guesses on this device and checks them here, so nothing is sent anywhere.</p></noscript>
</main>`;
}

export function dailyPageData(page: DailyPageKind, ctx: DailyPageContext): DailyPageData {
  return {
    mode: page.kind === 'text' ? 'text' : 'play',
    date: page.kind === 'date' ? page.date : null,
    tokens: ctx.tokens,
    origin: ctx.origin,
    appEntry: ctx.appEntry,
    warm: ctx.warm,
    lastPage: ctx.lastPage,
  };
}

export function renderDailyPage(template: string, page: DailyPageKind, ctx: DailyPageContext): string {
  if (!template.includes(HEAD_MARK) || !template.includes(BODY_MARK)) {
    throw new Error('daily.html is missing its lupi:daily-head/body marks');
  }
  const body = `${topBar()}
${board(page)}
${footer()}
<script type="application/json" id="lupi-daily-data">${jsonForScript(dailyPageData(page, ctx))}</script>`;
  return template.replace(HEAD_MARK, headTags(page, ctx).trimStart()).replace(BODY_MARK, body);
}
