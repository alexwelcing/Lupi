/**
 * page.ts — the script of Lupi Daily (/daily/, /daily/<date>, /daily/text).
 *
 * The page is static HTML written at build time (scripts/daily): the frame,
 * the empty board and a small JSON block (#lupi-daily-data) with the queue's
 * tokens. Everything that knows the day happens here, against the visitor's
 * own clock:
 *
 *   1. which puzzle: today's (/daily/), or the page's own date;
 *   2. its drawing and sealed clues (/daily/p/<token>.json) and the names
 *      anyone can guess (/daily/pool.json);
 *   3. the clue ladder: silhouette → it turns → bonds and rings → colours →
 *      a property → the name's letters, each with its written twin;
 *   4. guesses through the type-ahead, each with its warmth (how alike it is
 *      to the answer);
 *   5. the bloom when it is named: paper and ink open into the lit drawing on
 *      the sage plate, the name rises, and "Open in 3D" hands the pose to the
 *      viewer through the relay baton (the /m pages' hand-off);
 *   6. the spoiler-free share, the streak (this device only) and the clock to
 *      the next molecule.
 *
 * The text version (/daily/text) is the same game without the drawing: the
 * written clues carry it, for screen readers and anyone who prefers words.
 *
 * Motion follows the viewer's comfort setting (localStorage 'lupi.motion',
 * else prefers-reduced-motion): Gentle shortens the bloom, Still cuts it.
 * No sound. No React, no three: a few kilobytes of script.
 */
import { inkSvgMarkup, type InkModel, type InkPose } from '../moleculePage/ink';
import { createInkStage, type InkComfort, type InkStage } from '../moleculePage/inkStage';
import { silhouetteSvg } from './art';
import { createCombobox, type Combobox } from './combobox';
import { createDailyPainter, type DailyLook, type DailyPainter } from './painter';
import {
  CLUE_COUNT,
  DAILY_EPOCH,
  DAILY_HOME_PATH,
  DAILY_POOL_PATH,
  addDays,
  dailyPagePath,
  dailyPose,
  dailyPuzzlePath,
  dayNumber,
  daysBetween,
  formatLongDate,
  formatShortDate,
  localDateKey,
  msUntilLocalMidnight,
  puzzleNumber,
  queueIndex,
  type DateKey,
} from './schedule';
import {
  isPageKey,
  openSecret,
  type DailyClue,
  type DailyPageData,
  type DailyPool,
  type DailyPoolEntry,
  type DailyPuzzleFile,
  type DailySecret,
} from './secret';
import { glyphRow, shareBody, shareText, verdictLine, warmthBand } from './share';
import { dailyStats, readDailyStore, readDay, writeDay, type DayRecord } from './store';

const BATON_KEY = 'lupi.relay.baton';
const COMFORT_KEY = 'lupi.motion';
const FLASH_MS = 1600;
const DWELL_MS = 100;

type Relation = 'before' | 'future' | 'early' | 'today' | 'past';

const CLUE_LOOK: DailyLook[] = ['silhouette', 'silhouette', 'outline', 'colour', 'colour', 'colour'];
const CLUE_CAPTION = [
  'Clue 1 of 6 · the silhouette',
  'Clue 2 of 6 · drag it to turn',
  'Clue 3 of 6 · its bonds and rings',
  'Clue 4 of 6 · its colours',
  'Clue 5 of 6 · its colours',
  'Clue 6 of 6 · its colours',
];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

function readComfort(): InkComfort {
  try {
    const stored = localStorage.getItem(COMFORT_KEY);
    if (stored === 'standard' || stored === 'gentle' || stored === 'still') return stored;
  } catch {
    /* storage blocked: follow the OS */
  }
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'still';
  } catch {
    /* no matchMedia */
  }
  return 'standard';
}

function readData(): DailyPageData | null {
  const node = document.getElementById('lupi-daily-data');
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as DailyPageData;
  } catch {
    return null;
  }
}

function relationOf(key: DateKey, today: DateKey): Relation {
  if (dayNumber(key) < 0) return 'before';
  const delta = daysBetween(today, key);
  if (delta > 1) return 'future';
  if (delta === 1) return 'early';
  if (delta === 0) return 'today';
  return 'past';
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** C8H10N4O2 → C<sub>8</sub>H<sub>10</sub>… as nodes. */
function formulaNode(formula: string): HTMLElement {
  const span = el('span', 'dl-formula');
  for (const [, letters, digits] of formula.matchAll(/([^\d]+)(\d*)/g)) {
    span.appendChild(document.createTextNode(letters));
    if (digits) span.appendChild(el('sub', undefined, digits));
  }
  return span;
}

function moleculeHref(id: string): string {
  return `/m/${encodeURIComponent(id)}`;
}

function countdownText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(connection?.saveData || /2g/.test(connection?.effectiveType ?? ''));
}

export function mountDailyPage(): void {
  const found = readData();
  if (!found) return;
  const data: DailyPageData = found;
  const root = document.documentElement;
  root.classList.add('dl-js');
  const comfort = readComfort();
  root.dataset.comfort = comfort;
  const textMode = data.mode === 'text';

  const today = localDateKey();
  const key: DateKey = data.date ?? today;
  const relation = relationOf(key, today);
  const day = dayNumber(key);

  // ── Nodes ─────────────────────────────────────────────────────────
  const kicker = byId<HTMLElement>('dl-kicker');
  const title = byId<HTMLHeadingElement>('dl-title');
  const sub = byId<HTMLElement>('dl-sub');
  const stageHost = byId<HTMLElement>('dl-stage');
  const caption = byId<HTMLElement>('dl-caption');
  const banner = byId<HTMLElement>('dl-banner');
  const form = byId<HTMLFormElement>('dl-form');
  const input = byId<HTMLInputElement>('dl-guess');
  const options = byId<HTMLUListElement>('dl-options');
  const status = byId<HTMLElement>('dl-status');
  const live = byId<HTMLElement>('dl-live');
  const cluesList = byId<HTMLOListElement>('dl-clues');
  const guessesList = byId<HTMLOListElement>('dl-guesses');
  const result = byId<HTMLElement>('dl-result');
  const statsHost = byId<HTMLElement>('dl-stats');
  const weekHost = byId<HTMLElement>('dl-week');
  const yesterdayHost = byId<HTMLElement>('dl-yesterday');

  if (kicker && relation !== 'before') kicker.textContent = `Lupi Daily · No. ${puzzleNumber(key)} · ${formatLongDate(key).replace(/ \d{4}$/, '')}`;

  /** A short line under the box, and (optionally longer) words for screen readers. */
  const say = (visible: string, spoken: string = visible) => {
    if (status) status.textContent = visible;
    if (live) {
      live.textContent = '';
      // A fresh node read: the same sentence twice is still announced.
      window.setTimeout(() => {
        if (live) live.textContent = spoken;
      }, 30);
    }
  };

  // ── Game state ────────────────────────────────────────────────────
  let model: InkModel | null = null;
  let secret: DailySecret | null = null;
  let token = '';
  let pool: DailyPoolEntry[] = [];
  let poolByKey = new Map<string, DailyPoolEntry>();
  let record: DayRecord | null = null;
  let stage: InkStage | null = null;
  let painter: DailyPainter | null = null;
  let combobox: Combobox | null = null;
  let practiceAccepted = relation !== 'past';
  let pose: InkPose | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let warmed = false;
  let opening = false;

  const over = () => Boolean(record && record.s !== 'play');
  /** The clue on show: the next guess's number while playing. */
  const clueNumber = () => {
    if (!record) return 1;
    if (record.s === 'play') return Math.min(CLUE_COUNT, record.g.length + 1);
    return CLUE_COUNT;
  };
  const isAnswer = (k: string) => Boolean(secret?.accept.includes(k));
  const warmthOf = (k: string) => (isAnswer(k) ? 100 : (secret?.warm[k] ?? 0));
  const nameOf = (k: string) => poolByKey.get(k)?.n ?? k;
  const save = () => {
    if (record) writeDay(key, record);
  };

  // ── Viewer hand-off ───────────────────────────────────────────────
  const warm = () => {
    if (warmed || !data.appEntry || saveData()) return;
    warmed = true;
    const add = (rel: string, href: string) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      if (rel === 'prefetch' && href.endsWith('.js')) link.as = 'script';
      document.head.appendChild(link);
    };
    add('modulepreload', data.appEntry);
    for (const href of data.warm ?? []) add('prefetch', href);
  };

  const openIn3D = () => {
    if (!secret || opening) return;
    opening = true;
    warm();
    root.dataset.opening = '';
    try {
      const baton = {
        galleryId: secret.id,
        source: 'page',
        viewDir: stage?.viewDir() ?? null,
        bodyOmegaY: stage?.getBodyOmegaY() ?? 0,
        t: 0,
      };
      sessionStorage.setItem(BATON_KEY, JSON.stringify({ baton, savedAt: Date.now() }));
    } catch {
      /* storage blocked: the viewer opens at its own fitted pose */
    }
    window.location.assign(`/?sim=${encodeURIComponent(secret.id)}`);
  };

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    opening = false;
    delete root.dataset.opening;
  });

  // ── Banner ────────────────────────────────────────────────────────
  function showBanner(message: string, verbs: Array<{ label: string; href?: string; primary?: boolean; act?: () => void }> = []): void {
    if (!banner) return;
    banner.replaceChildren();
    const p = el('p');
    p.innerHTML = message;
    banner.appendChild(p);
    if (verbs.length) {
      const row = el('div', 'dl-banner__verbs');
      for (const verb of verbs) {
        const node = verb.href ? el('a', 'mp-verb') : el('button', 'mp-verb');
        if (verb.primary) node.classList.add('mp-verb--primary');
        node.textContent = verb.label;
        if (verb.href) (node as HTMLAnchorElement).href = verb.href;
        else (node as HTMLButtonElement).type = 'button';
        if (verb.act) node.addEventListener('click', verb.act);
        row.appendChild(node);
      }
      banner.appendChild(row);
    }
    banner.hidden = false;
  }

  function hideBanner(): void {
    if (banner) banner.hidden = true;
  }

  const todayVerb = () => ({ label: `Play today’s · No. ${puzzleNumber(today)}`, href: DAILY_HOME_PATH, primary: true });

  // ── Stage ─────────────────────────────────────────────────────────
  function stageLabel(): string {
    if (!secret) return 'Today’s mystery molecule';
    if (over()) return `${secret.name}, ink drawing. Drag or use the arrow keys to turn it; press Enter to open it in 3D.`;
    const n = clueNumber();
    const look = n >= 4 ? 'in colour' : n === 3 ? 'drawn as bonds and rings' : 'silhouette';
    return n >= 2
      ? `The mystery molecule, ${look}. Drag or use the arrow keys to turn it.`
      : `The mystery molecule, ${look}.`;
  }

  function setCaption(text: string): void {
    if (caption) caption.textContent = text;
  }

  function restingCaption(): string {
    if (!secret) return '';
    if (over()) return 'Drag to turn · tap to open in 3D';
    return CLUE_CAPTION[clueNumber() - 1];
  }

  function flash(label: string): void {
    if (over() || clueNumber() >= 3) {
      setCaption(label);
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => setCaption(restingCaption()), FLASH_MS);
    }
  }

  function mountStage(initial: DailyLook): void {
    if (textMode || !stageHost || !model || !pose) return;
    painter = createDailyPainter(model, 'dl', initial);
    stage = createInkStage(stageHost, {
      model,
      pose,
      interactive: false,
      idPrefix: 'dl',
      painter,
      comfort: () => comfort,
      onTap: () => {
        if (over()) openIn3D();
      },
      onDetent: flash,
      onSpinDegrees: (total) => {
        if (over() && total >= 30) warm();
      },
    });
    stageHost.dataset.live = '';
  }

  function syncStage(): void {
    if (!stageHost || !stage || !painter) return;
    const n = clueNumber();
    const turnable = over() || n >= 2;
    stage.setInteractive(turnable);
    stageHost.tabIndex = turnable ? 0 : -1;
    stageHost.dataset.turnable = turnable ? 'true' : 'false';
    stageHost.setAttribute('aria-label', stageLabel());
    painter.setLook(over() ? 'lit' : CLUE_LOOK[n - 1]);
    setCaption(restingCaption());
  }

  // ── Clues ─────────────────────────────────────────────────────────
  function clueBody(clue: DailyClue): HTMLElement {
    const p = el('p', 'dl-clue__text', clue.text);
    if (clue.formula) {
      p.appendChild(document.createTextNode(' '));
      p.appendChild(formulaNode(clue.formula));
    }
    if (clue.pattern) {
      const pattern = el('span', 'dl-pattern', clue.pattern);
      pattern.setAttribute('aria-hidden', 'true');
      p.appendChild(document.createTextNode(' '));
      p.appendChild(pattern);
    }
    return p;
  }

  function renderClues(fresh = false): void {
    if (!cluesList || !secret) return;
    cluesList.replaceChildren();
    const shown = over() ? CLUE_COUNT : clueNumber();
    secret.clues.slice(0, CLUE_COUNT).forEach((clue, i) => {
      const li = el('li', 'dl-clue');
      const open = i < shown;
      li.dataset.state = open ? (fresh && i === shown - 1 && i > 0 ? 'new' : 'open') : 'locked';
      li.appendChild(el('span', 'dl-clue__n', String(i + 1)));
      const body = el('div', 'dl-clue__body');
      body.appendChild(el('strong', 'dl-clue__title', open ? clue.title : `Clue ${i + 1}`));
      if (open) body.appendChild(clueBody(clue));
      else body.appendChild(el('p', 'dl-clue__text', `Opens after your ${ORDINALS[i - 1]} guess.`));
      li.appendChild(body);
      cluesList.appendChild(li);
    });
  }

  // ── Guesses ───────────────────────────────────────────────────────
  function renderGuesses(fresh: boolean): void {
    if (!guessesList || !record) return;
    guessesList.replaceChildren();
    guessesList.hidden = record.g.length === 0;
    const last = record.g.length - 1;
    record.g.forEach((k, i) => {
      const li = el('li', 'dl-guess');
      if (fresh && i === last) li.dataset.fresh = '';
      const right = isAnswer(k);
      const warmth = warmthOf(k);
      const band = warmthBand(warmth);
      li.dataset.band = right ? 'solved' : band.band;
      li.appendChild(el('span', 'dl-guess__n', String(i + 1)));
      const name = over() && isPageKey(k) ? el('a', 'dl-guess__name', nameOf(k)) : el('span', 'dl-guess__name', nameOf(k));
      if (name instanceof HTMLAnchorElement) name.href = moleculeHref(k);
      li.appendChild(name);
      const meter = el('span', 'dl-guess__meter');
      meter.setAttribute('aria-hidden', 'true');
      const fill = el('i');
      fill.style.setProperty('--w', `${right ? 100 : Math.max(4, warmth)}%`);
      meter.appendChild(fill);
      li.appendChild(meter);
      li.appendChild(el('span', 'dl-guess__word', right ? 'That’s it' : `${band.word} · ${warmth}°`));
      guessesList.appendChild(li);
    });
  }

  // ── Title ─────────────────────────────────────────────────────────
  function renderTitle(animate: boolean): void {
    if (!title) return;
    if (!over() || !secret || textMode) {
      if (!textMode) {
        title.removeAttribute('aria-label');
        title.textContent = 'Who’s that molecule?';
      }
      return;
    }
    title.replaceChildren();
    title.setAttribute('aria-label', secret.name);
    title.classList.toggle('dl-title--rise', animate && comfort !== 'still');
    // Letters rise one by one; a word never breaks across lines.
    let index = 0;
    secret.name.split(' ').forEach((word, w) => {
      if (w > 0) title.appendChild(document.createTextNode(' '));
      const wordNode = el('span', 'dl-word');
      wordNode.setAttribute('aria-hidden', 'true');
      for (const char of word) {
        const span = el('span', 'dl-letter', char);
        span.style.setProperty('--i', String(index));
        index += 1;
        wordNode.appendChild(span);
      }
      title.appendChild(wordNode);
    });
    if (sub) sub.textContent = record?.s === 'won' ? 'You named it.' : `It was ${secret.name}.`;
  }

  // ── Result ────────────────────────────────────────────────────────
  function renderResult(focus: boolean): void {
    if (!result || !record || !secret) return;
    if (!over()) {
      result.hidden = true;
      return;
    }
    const s = secret;
    const r = record;
    result.replaceChildren();
    const head = el('h2', 'dl-result__head', verdictLine(r));
    head.tabIndex = -1;
    result.appendChild(head);
    if (textMode) {
      // The drawing and the rising name say it on the picture page; here, words do.
      const p = el('p', 'dl-result__answer');
      p.append(r.s === 'won' ? 'The molecule: ' : 'It was ');
      const a = el('a', undefined, s.name);
      a.href = moleculeHref(s.id);
      p.append(a, '.');
      result.appendChild(p);
    }
    const glyphs = glyphRow(r, warmthOf, isAnswer);
    if (!r.r) {
      const row = el('p', 'dl-glyphs', glyphs);
      row.setAttribute('aria-hidden', 'true');
      result.appendChild(row);
    }
    if (r.p && !r.r) result.appendChild(el('p', 'dl-note', 'Played after its day: practice, not counted in your streak.'));

    const verbs = el('div', 'mp-verbs dl-verbs');
    const open = el('a', 'mp-verb mp-verb--primary', 'Open in 3D');
    open.href = `/?sim=${encodeURIComponent(s.id)}`;
    open.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openIn3D();
    });
    let dwell: ReturnType<typeof setTimeout> | null = null;
    open.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') dwell = setTimeout(warm, DWELL_MS);
    });
    open.addEventListener('pointerleave', () => {
      if (dwell) clearTimeout(dwell);
    });
    open.addEventListener('pointerdown', warm);
    open.addEventListener('focus', warm);
    verbs.appendChild(open);

    const shareStatus = el('p', 'mp-status');
    shareStatus.setAttribute('role', 'status');
    shareStatus.setAttribute('aria-live', 'polite');
    if (!r.r) {
      const share = el('button', 'mp-verb', 'Share result');
      share.type = 'button';
      share.addEventListener('click', () => shareResult(glyphs, shareStatus));
      verbs.appendChild(share);
    }
    const about = el('a', 'mp-verb', `About ${s.name}`);
    about.href = moleculeHref(s.id);
    verbs.appendChild(about);
    result.appendChild(verbs);
    result.appendChild(shareStatus);

    if (relation === 'today' || relation === 'early') {
      const next = el('p', 'dl-next');
      const tick = () => {
        const ms = msUntilLocalMidnight();
        next.replaceChildren();
        if (localDateKey() !== today) {
          next.append('A new molecule is ready. ');
          const a = el('a', undefined, 'Play it');
          a.href = DAILY_HOME_PATH;
          next.append(a);
          if (countdownTimer) clearInterval(countdownTimer);
          return;
        }
        next.append('Next molecule in ');
        next.appendChild(el('b', undefined, countdownText(ms)));
      };
      tick();
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = setInterval(tick, 30_000);
      result.appendChild(next);
    } else {
      const next = el('p', 'dl-next');
      const a = el('a', undefined, `Play today’s · No. ${puzzleNumber(today)}`);
      a.href = DAILY_HOME_PATH;
      next.appendChild(a);
      result.appendChild(next);
    }
    result.hidden = false;
    if (focus) head.focus({ preventScroll: false });
  }

  function shareResult(glyphs: string, out: HTMLElement): void {
    if (!record) return;
    const url = `${data.origin}${daysBetween(key, data.lastPage) >= 0 ? dailyPagePath(key) : DAILY_HOME_PATH}`;
    const streak = dailyStats(today).streak;
    const input = { date: key, record, glyphs, url, streak };
    const tell = (text: string) => {
      out.textContent = text;
    };
    const coarse = (() => {
      try {
        return window.matchMedia('(pointer: coarse)').matches;
      } catch {
        return false;
      }
    })();
    if (coarse && typeof navigator.share === 'function') {
      navigator.share({ text: shareBody(input), url }).catch((error: unknown) => {
        if ((error as DOMException)?.name !== 'AbortError') tell('Could not open the share sheet.');
      });
      return;
    }
    const text = shareText(input);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => tell('Result copied. It never names the molecule, so paste it anywhere.'),
        () => tell(text),
      );
      return;
    }
    tell(text);
  }

  // ── Form ──────────────────────────────────────────────────────────
  function syncForm(): void {
    if (!form) return;
    const playable = Boolean(record && record.s === 'play' && practiceAccepted && secret);
    form.hidden = !playable;
    if (input) {
      input.disabled = !playable;
      const n = clueNumber();
      input.placeholder = n === 1 ? 'Name a molecule…' : `Guess ${n} of ${CLUE_COUNT}…`;
    }
  }

  function renderAll(opts: { fresh?: boolean; animateTitle?: boolean; focusResult?: boolean } = {}): void {
    syncStage();
    renderClues(opts.fresh);
    renderGuesses(Boolean(opts.fresh || opts.animateTitle));
    renderTitle(Boolean(opts.animateTitle));
    syncForm();
    renderResult(Boolean(opts.focusResult));
    renderStats();
    renderWeek();
  }

  function bloom(): void {
    if (!stageHost) return;
    stageHost.dataset.bloom = '';
    setTimeout(() => {
      if (stageHost) delete stageHost.dataset.bloom;
    }, 1600);
  }

  function guess(entry: DailyPoolEntry): void {
    if (!record || !secret || record.s !== 'play') return;
    if (record.g.includes(entry.k)) {
      say(`You already guessed ${entry.n}.`);
      return;
    }
    if (record.g.length === 0 && relation === 'past') record.p = 1;
    record.g.push(entry.k);
    combobox?.clear();
    if (isAnswer(entry.k)) {
      record.s = 'won';
      record.c = record.g.length;
      record.n = secret.name;
      record.id = secret.id;
      save();
      bloom();
      renderAll({ animateTitle: true, focusResult: true });
      say(`Yes! ${secret.name}. ${verdictLine(record)}.`);
      return;
    }
    const band = warmthBand(warmthOf(entry.k));
    if (record.g.length >= CLUE_COUNT) {
      record.s = 'lost';
      record.c = CLUE_COUNT;
      record.n = secret.name;
      record.id = secret.id;
      save();
      bloom();
      renderAll({ animateTitle: true, focusResult: true });
      say(`Not ${entry.n}. It was ${secret.name}.`);
      return;
    }
    save();
    renderAll({ fresh: true });
    const n = clueNumber();
    const clue = secret.clues[n - 1];
    say(
      `Not ${entry.n} · ${band.word.toLowerCase()}. Clue ${n} is open.`,
      `Not ${entry.n}: ${band.word.toLowerCase()}. Clue ${n}, ${clue.title}: ${clue.text}${clue.formula ? ` ${clue.formula}` : ''}`,
    );
    input?.focus();
  }

  function reveal(): void {
    if (!secret) return;
    record = { t: token, g: record?.g ?? [], s: 'lost', c: CLUE_COUNT, n: secret.name, id: secret.id, p: 1, r: 1 };
    save();
    hideBanner();
    bloom();
    renderAll({ animateTitle: true, focusResult: true });
  }

  // ── Stats, week, yesterday ────────────────────────────────────────
  function renderStats(): void {
    if (!statsHost) return;
    const stats = dailyStats(today);
    statsHost.replaceChildren();
    statsHost.appendChild(el('h2', undefined, 'Your Daily'));
    const numbers = el('dl', 'dl-numbers');
    const add = (label: string, value: string) => {
      const box = el('div');
      box.append(el('dt', undefined, label), el('dd', undefined, value));
      numbers.appendChild(box);
    };
    add('Played', String(stats.played));
    add('Solved', stats.played ? `${Math.round((100 * stats.won) / stats.played)}%` : '–');
    if (stats.streak > 0) add('Streak', String(stats.streak));
    add('Best streak', String(stats.best));
    statsHost.appendChild(numbers);

    const max = Math.max(1, ...stats.byClue.slice(1), stats.lost);
    const dist = el('ol', 'dl-dist');
    dist.setAttribute('aria-label', 'Solved on each clue');
    const thisClue = record && !record.p && record.s === 'won' ? record.c : null;
    for (let clue = 1; clue <= CLUE_COUNT; clue += 1) {
      const li = el('li');
      if (clue === thisClue) li.dataset.today = '';
      const count = stats.byClue[clue];
      li.setAttribute('aria-label', `Clue ${clue}: ${count}`);
      li.append(el('span', 'dl-dist__k', String(clue)));
      const bar = el('span', 'dl-dist__bar');
      bar.style.setProperty('--w', `${(100 * count) / max}%`);
      bar.appendChild(el('b', undefined, String(count)));
      li.appendChild(bar);
      dist.appendChild(li);
    }
    if (stats.lost) {
      const li = el('li', 'dl-dist__lost');
      li.setAttribute('aria-label', `Not solved: ${stats.lost}`);
      li.append(el('span', 'dl-dist__k', '✕'));
      const bar = el('span', 'dl-dist__bar');
      bar.style.setProperty('--w', `${(100 * stats.lost) / max}%`);
      bar.appendChild(el('b', undefined, String(stats.lost)));
      li.appendChild(bar);
      dist.appendChild(li);
    }
    statsHost.appendChild(dist);
    statsHost.appendChild(el('p', 'dl-note', 'Kept on this device only. A day counts when you solve it on the day.'));
  }

  function renderWeek(): void {
    if (!weekHost) return;
    const store = readDailyStore();
    weekHost.replaceChildren();
    weekHost.appendChild(el('h2', undefined, 'This week'));
    const list = el('ol', 'dl-week');
    const end = daysBetween(today, key) > 0 ? key : today;
    for (let offset = -6; offset <= 0; offset += 1) {
      const date = addDays(end, offset);
      if (dayNumber(date) < 0) continue;
      const rec = store.days[date];
      const li = el('li');
      const state = !rec || rec.s === 'play' ? (rec ? 'open' : 'none') : rec.r ? 'revealed' : rec.s;
      const linkable = daysBetween(date, data.lastPage) >= 0;
      const node = linkable ? el('a') : el('span');
      if (node instanceof HTMLAnchorElement) node.href = date === today && data.date === null ? DAILY_HOME_PATH : dailyPagePath(date);
      node.className = 'dl-day';
      node.dataset.state = state;
      if (date === key) node.setAttribute('aria-current', 'page');
      const label = formatShortDate(date);
      const outcome =
        state === 'won' ? `solved on clue ${rec?.c ?? '?'}` : state === 'lost' ? 'not solved' : state === 'revealed' ? 'answer shown' : state === 'open' ? 'in progress' : 'not played';
      node.setAttribute('aria-label', `${label}, No. ${puzzleNumber(date)}: ${outcome}`);
      node.append(el('span', 'dl-day__w', label.slice(0, 2)), el('span', 'dl-day__d', label.split(' ')[1]));
      li.appendChild(node);
      list.appendChild(li);
    }
    weekHost.appendChild(list);
  }

  async function loadYesterday(): Promise<void> {
    if (!yesterdayHost || relation !== 'today') return;
    const yKey = addDays(key, -1);
    const yDay = dayNumber(yKey);
    if (yDay < 0) return;
    const yToken = data.tokens[queueIndex(yDay, data.tokens.length)];
    if (!yToken) return;
    let file: DailyPuzzleFile;
    try {
      file = await fetchJson<DailyPuzzleFile>(dailyPuzzlePath(yToken));
    } catch {
      return;
    }
    const ySecret = openSecret(file.secret, yToken);
    if (!ySecret) return;
    const yRecord = readDay(yKey);
    const played = Boolean(yRecord && yRecord.t === yToken && yRecord.s !== 'play');
    const yPose = dailyPose(file.model, yDay, data.tokens.length);

    yesterdayHost.replaceChildren();
    yesterdayHost.appendChild(el('h2', undefined, 'Yesterday'));
    const tile = el('button', 'dl-yday');
    tile.type = 'button';
    const art = el('span', 'dl-yday__art');
    art.setAttribute('aria-hidden', 'true');
    const paper = el('span', 'dl-yday__paper');
    paper.innerHTML = textMode ? '' : silhouetteSvg(file.model, yPose, { width: '100%', height: '100%' });
    const lit = el('span', 'dl-yday__lit');
    art.append(paper, lit);
    const text = el('span', 'dl-yday__text');
    const label = el('strong', undefined, `No. ${puzzleNumber(yKey)} · ${formatShortDate(yKey)}`);
    const line = el('span', undefined, played ? verdictLine(yRecord!) : 'Tap to see what it was');
    text.append(label, line);
    if (!textMode) tile.appendChild(art);
    tile.appendChild(text);
    tile.setAttribute('aria-expanded', 'false');
    const more = el('p', 'dl-yday__more');
    more.hidden = true;

    const open = (animate: boolean) => {
      if (tile.getAttribute('aria-expanded') === 'true') return;
      tile.setAttribute('aria-expanded', 'true');
      if (!textMode) {
        lit.innerHTML = inkSvgMarkup(file.model, yPose, { idPrefix: 'dl-yday', attrs: { width: '100%', height: '100%' } });
        tile.dataset.revealed = animate ? 'bloom' : 'still';
      }
      line.textContent = `It was ${ySecret.name}${played ? ` · ${verdictLine(yRecord!).toLowerCase()}` : ''}`;
      more.replaceChildren();
      const about = el('a', undefined, `About ${ySecret.name}`);
      about.href = moleculeHref(ySecret.id);
      more.append(about);
      if (!played && daysBetween(yKey, data.lastPage) >= 0) {
        more.append(' · ');
        const replay = el('a', undefined, 'Play it anyway');
        replay.href = dailyPagePath(yKey);
        more.append(replay);
      }
      more.hidden = false;
    };
    tile.addEventListener('click', () => open(comfort !== 'still'));
    yesterdayHost.append(tile, more);
    yesterdayHost.hidden = false;
    if (played) open(false);
  }

  // ── Start ─────────────────────────────────────────────────────────
  renderStats();
  renderWeek();

  if (relation === 'before') {
    showBanner(`Lupi Daily begins on <strong>${formatLongDate(DAILY_EPOCH)}</strong>.`);
    setCaption('');
    return;
  }
  if (relation === 'future') {
    showBanner(`No peeking. No. ${puzzleNumber(key)} opens on <strong>${formatLongDate(key)}</strong>.`, [todayVerb()]);
    setCaption('');
    return;
  }

  token = data.tokens[queueIndex(day, data.tokens.length)] ?? '';
  if (!token) return;

  Promise.all([fetchJson<DailyPuzzleFile>(dailyPuzzlePath(token)), fetchJson<DailyPool>(DAILY_POOL_PATH)])
    .then(([file, poolFile]) => {
      const opened = openSecret(file.secret, token);
      if (!opened) throw new Error('sealed clues did not open');
      model = file.model;
      secret = opened;
      pool = poolFile.entries;
      poolByKey = new Map(pool.map((entry) => [entry.k, entry]));
      pose = dailyPose(file.model, day, data.tokens.length);

      const stored = readDay(key);
      record = stored && stored.t === token ? stored : null;
      // A puzzle already begun (on its day or as practice) simply carries on.
      if (record) practiceAccepted = true;

      if (input && options) {
        combobox = createCombobox({
          input,
          list: options,
          entries: pool,
          isUsed: (k) => Boolean(record?.g.includes(k)),
          onCommit: guess,
        });
      }
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const entry = combobox?.resolve() ?? null;
        if (!entry) {
          say(input?.value.trim() ? 'Pick a molecule from the list.' : 'Type the name of a molecule.');
          return;
        }
        guess(entry);
      });

      mountStage(record && record.s !== 'play' ? 'lit' : CLUE_LOOK[Math.min(CLUE_COUNT, (record?.g.length ?? 0) + 1) - 1]);
      if (!record) record = { t: token, g: [], s: 'play' };

      if (relation === 'past' && !practiceAccepted) {
        showBanner(`This was the puzzle for <strong>${formatLongDate(key)}</strong>.`, [
          todayVerb(),
          {
            label: 'Play this one',
            act: () => {
              practiceAccepted = true;
              hideBanner();
              syncForm();
              input?.focus();
            },
          },
          { label: 'Show the answer', act: reveal },
        ]);
      } else if (relation === 'past') {
        showBanner(`This was the puzzle for <strong>${formatLongDate(key)}</strong>.`, over() ? [todayVerb()] : []);
      } else if (relation === 'early') {
        showBanner(`It’s already <strong>${formatLongDate(key)}</strong> somewhere, so this puzzle is open early. It counts for that day.`);
      }
      renderAll();
      if (sub && !over() && !textMode) sub.textContent = 'Six clues. One molecule. The same for everyone today.';
      void loadYesterday();
    })
    .catch(() => {
      showBanner('This puzzle could not load. Check the connection and try again.', [
        { label: 'Try again', primary: true, act: () => window.location.reload() },
      ]);
    });
}
