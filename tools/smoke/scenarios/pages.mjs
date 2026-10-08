/**
 * pages.mjs - the zero-canvas pages: /m, Lupi Daily, /scale and the /play
 * share path (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=pages --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/pages
 *
 * With every <canvas> and every WebGL/WebGPU context counted page-side:
 * 1. /m/ and three /m/<id> pages load with an h1, no ink drawing on them is
 *    broken, the molecule page's ink stage draws its SVG, and none of them
 *    makes a <canvas> or a GPU context before a touch.
 * 2. /daily/ and today's /daily/<date> load with the stage drawn in SVG and
 *    no <canvas> or GPU context; the page fits the screen (the Guess button
 *    included, the stage centred on a phone); one wrong guess (Acetylene,
 *    guessable and never the answer) is listed with its warmth and opens
 *    clue 2.
 * 3. /scale loads and offers its entries and Dive (it is a 3D page, not a
 *    zero-canvas one, and has no h1).
 * 4. /play?sim=c60_buckyball opens C60 in the viewer. The Worker sends people
 *    from /play to /?…; tools/serve-web.mjs serves the app at /play itself,
 *    so either path counts, and the report says which one this server took.
 *    While the deep link opens, the viewer header never shows over the
 *    full-window "Opening…" plate (it arrives with the molecule).
 * Every page loads with no uncaught error and no console error (the smoke
 * tool fails the run on either); errors are also listed per page in
 * report.json under data.pages.
 */

const MOLECULES = ['caffeine', 'c60_buckyball', 'aspirin'];
/** In the Daily's pool as an extra (`x-` key): guessable, never the answer. */
const WRONG_GUESS = 'Acetylene';

/** Page-side: count canvases made (attached or not) and GPU contexts. */
function installCanvasCounter() {
  const counter = { canvases: 0, contexts: [] };
  window.__pagesSmoke = counter;
  const createElement = Document.prototype.createElement;
  Document.prototype.createElement = function patched(name, ...rest) {
    if (String(name).toLowerCase() === 'canvas') counter.canvases += 1;
    return createElement.call(this, name, ...rest);
  };
  const wrap = (proto) => {
    if (!proto?.getContext) return;
    const original = proto.getContext;
    proto.getContext = function getContext(type, ...rest) {
      const context = original.call(this, type, ...rest);
      if (context && /^(webgl|webgl2|experimental-webgl|webgpu)$/.test(String(type))) counter.contexts.push(String(type));
      return context;
    };
  };
  wrap(globalThis.HTMLCanvasElement?.prototype);
  wrap(globalThis.OffscreenCanvas?.prototype);
  if (navigator.gpu?.requestAdapter) {
    const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = (...rest) => {
      counter.contexts.push('gpu.requestAdapter');
      return requestAdapter(...rest);
    };
  }
}

/**
 * Page-side: every frame, whether the viewer header is drawn over the
 * full-window "Opening…" plate (the deep link's plate before the molecule).
 */
function installOpeningRecorder() {
  const log = (window.__openingSmoke = { headerOverPlate: 0, plateFrames: 0 });
  const tick = () => {
    const plate = [...document.querySelectorAll('.lupi-plate')].find((node) => !node.dataset.inViewport && getComputedStyle(node).display !== 'none');
    const header = document.querySelector('.lupine-status-bar');
    if (plate) {
      log.plateFrames += 1;
      const r = header?.getBoundingClientRect();
      const hit = r && r.width > 0 ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      if (hit && header.contains(hit)) log.headerOverPlate += 1;
    }
    if (!window.__lupiPlay?.state?.().firstFrame) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Today's date in the page's own time zone (the Daily rolls over at local midnight). */
const localToday = (page) => page.evaluate(() => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
});

/** What a zero-canvas page shows, read before any touch. */
const readPage = (page, stageSelector) => page.evaluate((stage) => {
  const host = stage ? document.querySelector(stage) : null;
  const svg = host?.querySelector('svg');
  const box = svg?.getBoundingClientRect();
  const inkImages = [...document.querySelectorAll('img[src*="-ink.svg"]')];
  return {
    path: location.pathname,
    h1: document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) ?? '',
    canvasNodes: document.querySelectorAll('canvas').length,
    canvasesMade: window.__pagesSmoke?.canvases ?? -1,
    contexts: window.__pagesSmoke?.contexts ?? [],
    stage: host ? {
      svgs: host.querySelectorAll('svg').length,
      shapes: host.querySelectorAll('circle, ellipse, path, line, polyline, polygon, use').length,
      box: box ? [Math.round(box.width), Math.round(box.height)] : null,
    } : null,
    inkImages: inkImages.length,
    inkLoaded: inkImages.filter((img) => img.complete && img.naturalWidth > 0).length,
    inkBroken: inkImages.filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.getAttribute('src')).slice(0, 4),
    // A phone's layout viewport grows to fit wide content (innerWidth follows), so judge by the screen.
    horizontalScroll: document.documentElement.scrollWidth > Math.min(innerWidth, screen.width) + 1,
    scrollWidth: document.documentElement.scrollWidth,
  };
}, stageSelector);

/** Wait until every ink image on the page has finished loading (or 10 s). */
const inkImagesSettled = (page) => page.waitForFunction(
  () => [...document.querySelectorAll('img[src*="-ink.svg"]')].every((img) => img.complete),
  null,
  { timeout: 10_000, polling: 200 },
).catch(() => {});

export default {
  name: 'pages',
  profiles: ['desktop', 'phone390'],
  description: '/m, /daily (one wrong guess), /scale and /play?sim= load clean; /m and /daily make no canvas or GPU context.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const base = h.baseFor(page);
    await page.addInitScript(installCanvasCounter);

    // Errors per page, beside the tool's own per-scenario list.
    const errors = [];
    let current = '';
    page.on('pageerror', (error) => errors.push({ page: current, kind: 'uncaught', text: String(error?.message ?? error).slice(0, 200) }));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push({ page: current, kind: 'console', text: message.text().slice(0, 200) });
    });
    const pages = [];
    outcome.data.pages = pages;
    outcome.data.pageErrors = errors;

    const open = async (path, stageSelector) => {
      current = path;
      outcome.url = new URL(path, base).href;
      const response = await page.goto(outcome.url, { waitUntil: 'load' });
      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      if (stageSelector) {
        await page.waitForFunction((stage) => (document.querySelector(stage)?.querySelectorAll('circle, ellipse, path, line, use').length ?? 0) > 0, stageSelector, { timeout: 10_000, polling: 200 }).catch(() => {});
      }
      // Scroll through once so lazy ink images load, then back to the top.
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
          window.scrollTo(0, y);
          await new Promise((done) => setTimeout(done, 60));
        }
        window.scrollTo(0, 0);
      });
      await inkImagesSettled(page);
      // Let idle callbacks and lazy work run before reading.
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      const read = { status: response?.status() ?? null, ...(await readPage(page, stageSelector)) };
      pages.push(read);
      return read;
    };
    const zeroCanvas = (label, read) => {
      check(`${label}: no <canvas> and no WebGL/WebGPU context before a touch`,
        read.canvasNodes === 0 && read.canvasesMade === 0 && read.contexts.length === 0,
        `canvas nodes ${read.canvasNodes}, made ${read.canvasesMade}, contexts ${read.contexts.join(', ') || 'none'}`);
    };
    const noErrorsOn = (label, path) => {
      const mine = errors.filter((error) => error.page === path);
      check(`${label}: no uncaught or console error`, mine.length === 0, mine.map((error) => `${error.kind}: ${error.text}`).join(' | ') || 'none');
    };

    // 1. The molecule pages.
    const index = await open('/m/', null);
    check('/m/ loads with a heading', index.status === 200 && index.h1.length > 0, `status ${index.status}, h1 "${index.h1}"`);
    // Lazy tiles a busy renderer has not fetched yet are not failures; a broken one is.
    check('/m/: no ink drawing is broken', index.inkLoaded > 0 && index.inkBroken.length === 0, `${index.inkLoaded}/${index.inkImages} loaded${index.inkBroken.length ? `, broken ${index.inkBroken.join(', ')}` : ''}`);
    check('/m/: no sideways scroll', !index.horizontalScroll, `page ${index.scrollWidth} px wide`);
    zeroCanvas('/m/', index);
    noErrorsOn('/m/', '/m/');
    await save('m-index', await page.screenshot({ scale: 'css' }));

    for (const id of MOLECULES) {
      const path = `/m/${id}`;
      const read = await open(path, '#ink-stage');
      check(`${path} loads with a heading`, read.status === 200 && read.h1.length > 0, `status ${read.status}, h1 "${read.h1}"`);
      check(`${path}: the ink stage draws its SVG`, Boolean(read.stage && read.stage.svgs > 0 && read.stage.shapes > 0 && read.stage.box && read.stage.box[0] > 100 && read.stage.box[1] > 100),
        JSON.stringify(read.stage));
      check(`${path}: no ink drawing is broken`, read.inkBroken.length === 0, `${read.inkLoaded}/${read.inkImages}${read.inkBroken.length ? `, broken ${read.inkBroken.join(', ')}` : ''}`);
      check(`${path}: no sideways scroll`, !read.horizontalScroll, `page ${read.scrollWidth} px wide`);
      zeroCanvas(path, read);
      noErrorsOn(path, path);
      if (id === MOLECULES[0]) await save(`m-${id}`, await page.screenshot({ scale: 'css' }));
    }

    // 2. Lupi Daily: the home page, today's date page and one wrong guess.
    const today = await localToday(page);
    const daily = await open('/daily/', '#dl-stage');
    check('/daily/ loads with a heading', daily.status === 200 && daily.h1.length > 0, `status ${daily.status}, h1 "${daily.h1}"`);
    check('/daily/: the stage draws its SVG', Boolean(daily.stage && daily.stage.svgs > 0 && daily.stage.shapes > 0), JSON.stringify(daily.stage));
    zeroCanvas('/daily/', daily);
    noErrorsOn('/daily/', '/daily/');

    const datePath = `/daily/${today}`;
    const dated = await open(datePath, '#dl-stage');
    check(`${datePath} loads with a heading`, dated.status === 200 && dated.h1.length > 0, `status ${dated.status}, h1 "${dated.h1}"`);
    check(`${datePath}: the stage draws its SVG`, Boolean(dated.stage && dated.stage.svgs > 0 && dated.stage.shapes > 0), JSON.stringify(dated.stage));
    check(`${datePath}: no sideways scroll`, !dated.horizontalScroll, `page ${dated.scrollWidth} px wide`);
    const board = await page.evaluate(() => {
      const right = (selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().right ?? -1);
      const stage = document.querySelector('#dl-stage')?.getBoundingClientRect();
      const main = document.querySelector('.dl-main')?.getBoundingClientRect();
      return {
        screen: Math.min(innerWidth, screen.width),
        guessRight: right('#dl-form .mp-verb'),
        stageWidth: Math.round(stage?.width ?? 0),
        stageOffCentre: stage && main && innerWidth <= 800 ? Math.round(Math.abs((stage.left + stage.right) / 2 - (main.left + main.right) / 2)) : 0,
      };
    });
    outcome.data.dailyBoard = board;
    check(`${datePath}: the Guess button fits the screen`, board.guessRight > 0 && board.guessRight <= board.screen, `button right ${board.guessRight}, screen ${board.screen}`);
    check(`${datePath}: the stage is centred on a phone`, board.stageOffCentre <= 2, `stage ${board.stageWidth} px, ${board.stageOffCentre} px off centre`);
    zeroCanvas(datePath, dated);
    await save('daily-today', await page.screenshot({ scale: 'css' }));

    const input = page.locator('#dl-guess');
    const playable = await input.isEnabled().catch(() => false);
    const cluesBefore = await page.locator('#dl-clues li[data-state="open"], #dl-clues li[data-state="new"]').count();
    if (playable) {
      if (touch) await input.tap();
      else await input.click();
      await input.pressSequentially(WRONG_GUESS, { delay: 30 });
      const listed = await page.locator('#dl-options [role="option"]').first().waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false);
      check(`${datePath}: typing lists matching names`, listed);
      await input.press('Enter');
      await page.locator('#dl-guesses li').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    }
    const guessed = await page.evaluate(() => ({
      guesses: [...document.querySelectorAll('#dl-guesses li')].map((li) => ({ band: li.dataset.band ?? null, text: li.textContent.replace(/\s+/g, ' ').trim() })),
      openClues: document.querySelectorAll('#dl-clues li[data-state="open"], #dl-clues li[data-state="new"]').length,
      placeholder: document.querySelector('#dl-guess')?.getAttribute('placeholder') ?? null,
      status: document.querySelector('#dl-status')?.textContent.trim() ?? '',
      live: document.querySelector('#dl-live')?.textContent.trim() ?? '',
      canvases: document.querySelectorAll('canvas').length,
      contexts: window.__pagesSmoke?.contexts ?? [],
    }));
    outcome.data.dailyGuess = { playable, cluesBefore, ...guessed };
    check(`${datePath}: the guess box is ready`, playable);
    const first = guessed.guesses[0];
    check(`${datePath}: one wrong guess is listed with its warmth`, guessed.guesses.length === 1 && first.text.includes(WRONG_GUESS) && first.band !== 'solved' && /°/.test(first.text),
      JSON.stringify(guessed.guesses));
    check(`${datePath}: the wrong guess opens clue 2`, cluesBefore === 1 && guessed.openClues === 2 && /Guess 2 of/.test(guessed.placeholder ?? ''),
      `open clues ${cluesBefore} -> ${guessed.openClues}, placeholder "${guessed.placeholder}"`);
    check(`${datePath}: still no canvas or GPU context after the guess`, guessed.canvases === 0 && guessed.contexts.length === 0, `canvas ${guessed.canvases}, contexts ${guessed.contexts.join(', ') || 'none'}`);
    noErrorsOn(datePath, datePath);
    await save('daily-guessed', await page.screenshot({ scale: 'css' }));

    // 3. The scale page.
    const scale = await open('/scale', null);
    const scaleUi = await page.getByRole('button', { name: /^Dive/ }).first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    const entries = await page.getByRole('button', { name: 'Copper' }).count();
    check('/scale loads with its entries and Dive', scale.status === 200 && scaleUi && entries > 0, `status ${scale.status}, Dive ${scaleUi}, Copper entry ${entries}`);
    noErrorsOn('/scale', '/scale');
    await save('scale', await page.screenshot({ scale: 'css' }));

    // 4. The share path of a viewer link.
    current = '/play?sim=c60_buckyball';
    outcome.url = new URL(current, base).href;
    await page.addInitScript(installOpeningRecorder);
    await page.goto(outcome.url, { waitUntil: 'commit' });
    const opened = await page.waitForFunction(() => {
      const status = window.__lupiViewerMcp?.status?.();
      return Boolean(status?.moleculeLoaded && status.atomCount === 60);
    }, null, { timeout: 60_000, polling: 250 }).then(() => true, () => false);
    const landed = new URL(page.url());
    outcome.data.play = { path: landed.pathname, search: landed.search };
    check('/play?sim=c60_buckyball opens C60 in the viewer', opened && landed.searchParams.get('sim') === 'c60_buckyball' && ['/', '/play'].includes(landed.pathname),
      `landed on ${landed.pathname}${landed.search}`);
    // Tag the viewer canvas so the lane's backend is judged (--strict-backend).
    if (opened) await (await h.mainCanvas(page))?.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
    const opening = await page.evaluate(() => window.__openingSmoke ?? null);
    outcome.data.play.opening = opening;
    check('the header never shows over the full-window "Opening…" plate', opening?.headerOverPlate === 0,
      `${opening?.headerOverPlate ?? '?'} of ${opening?.plateFrames ?? '?'} plate frames had the header on top`);
    noErrorsOn('/play?sim=c60_buckyball', current);
  },
};
