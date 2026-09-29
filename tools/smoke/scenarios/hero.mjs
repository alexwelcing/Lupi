/**
 * hero.mjs - the ink C60 on "/" (packages/ui/src/landing/hero). LOCAL check.
 *
 * Still until touched and no canvas; the finder in the first viewport; a
 * vertical swipe that starts on the ball scrolls the page; a drag turns it and
 * it settles face-on within 2 s with the face name; a flick coasts, then
 * clicks; no viewer chunk before a real spin; a tap opens C60 in 3D. On
 * desktop, Back returns to the landing inside the viewer, and the ball there
 * opens C60 again.
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=home,hero --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/hero
 */

const STAGE = '.bucky-hero__stage';
const VIEWER_CHUNK = /\/vendor-(three|react-three)[^/]*\.js$/;

/** The hero's state, a fingerprint of the drawing, and the page around it. */
function readHero(page) {
  return page.evaluate((selector) => {
    const stage = document.querySelector(selector);
    const circles = stage ? [...stage.querySelectorAll('circle')] : [];
    return {
      state: stage?.dataset.buckyState ?? null,
      detent: stage?.dataset.buckyDetent ?? null,
      circles: circles.length,
      lines: stage ? stage.querySelectorAll('line').length : 0,
      coords: circles.slice(0, 6).map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`).join(' '),
      flash: [...document.querySelectorAll('.bucky-hero__flash[data-on]')].map((n) => n.textContent.trim()).join('|'),
      canvases: document.querySelectorAll('canvas').length,
      scrollY: window.scrollY,
    };
  }, STAGE);
}

/** Record every state change of the stage (with page time) from now on. */
async function recordStates(page) {
  await page.evaluate((selector) => {
    const stage = document.querySelector(selector);
    window.__heroStates = [];
    window.__heroObserver?.disconnect();
    window.__heroObserver = new MutationObserver(() =>
      window.__heroStates.push([Math.round(performance.now()), stage.dataset.buckyState, stage.dataset.buckyDetent ?? '']),
    );
    window.__heroObserver.observe(stage, { attributes: true, attributeFilter: ['data-bucky-state', 'data-bucky-detent'] });
  }, STAGE);
}

/** Wait until the stage rests on a face; ms from `sinceMs` (page time) to the landing. */
async function waitForFace(page, sinceMs, maxMs = 4_000) {
  const landed = await page
    .waitForFunction(
      () => {
        const last = window.__heroStates?.at(-1);
        return last && last[1] === 'rest' && last[2] ? last : null;
      },
      null,
      { timeout: maxMs, polling: 50 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  const states = await page.evaluate(() => window.__heroStates ?? []);
  return { landed, ms: landed ? Math.round(landed[0] - sinceMs) : null, states: states.map(([t, s, d]) => `${Math.round(t - sinceMs)}:${s}${d ? `/${d}` : ''}`) };
}

async function stageBox(page) {
  const box = await page.locator(STAGE).boundingBox();
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

async function heroShot(page, save, step) {
  const box = await page.locator('.bucky-hero').boundingBox();
  if (!box) return;
  const pad = 12;
  await page.waitForTimeout(350); // past the caption's crossfade
  await save(step, await page.screenshot({ scale: 'css', clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad } }));
}

/** After a tap: ?sim=c60_buckyball, C60 loaded, and a non-blank canvas. */
async function expectViewer(ctx, h, label) {
  const { page, check, save, outcome, options } = ctx;
  const reached = await page.waitForURL(/[?&]sim=c60_buckyball\b/, { timeout: options.timeout }).then(() => true, () => false);
  check(`${label} reaches ?sim=c60_buckyball`, reached, page.url());
  if (!reached) return;
  const loaded = await page
    .waitForFunction(() => {
      const status = window.__lupiViewerMcp?.status?.();
      return status?.moleculeLoaded === true && status.atomCount === 60;
    }, null, { timeout: options.timeout, polling: 250 })
    .then(() => true, () => false);
  check(`${label}: C60 loads in the viewer`, loaded, loaded ? '60 atoms' : 'bridge never reported 60 atoms');
  if (!loaded) return;
  const canvas = await h.mainCanvas(page);
  if (!check(`${label}: viewer canvas is present`, Boolean(canvas))) return;
  await canvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
  const settled = await h.waitSettled(page, canvas, 0.01, 30_000);
  const render = await h.assessRender(page, canvas, settled.image, 0.01);
  outcome.data[`${label.replace(/\W+/g, '-')}-render`] = render;
  await save(label.replace(/\W+/g, '-'), settled.png);
  check(`${label}: canvas is non-blank`, render.nonBlank && render.foregroundFraction >= 0.01, `contribution=${h.pct(render.canvasContribution)} foreground=${h.pct(render.foregroundFraction)}`);
  if (render.nonBlank) ctx.spec.lane.actualBackend ??= await h.detectBackend(page);
}

export default {
  name: 'hero',
  profiles: ['desktop', 'phone', 'phone390'],
  description: 'Ink C60 on "/": still until touched, drag/flick onto a face, vertical swipes scroll, tap opens 3D.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome, options } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const viewerChunks = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (VIEWER_CHUNK.test(path)) viewerChunks.push(path.split('/').pop());
    });
    outcome.url = h.baseFor(page).href;
    await page.goto(outcome.url, { waitUntil: 'load', timeout: options.timeout });
    await page.locator(STAGE).waitFor({ state: 'visible', timeout: options.timeout });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Still until touched, drawn in SVG, no canvas.
    const first = await readHero(page);
    await page.waitForTimeout(600);
    const second = await readHero(page);
    outcome.data.still = first;
    check('hero draws 60 atoms and 90 bonds', first.circles === 60 && first.lines === 90, `${first.circles} circles, ${first.lines} lines`);
    check('hero is still until touched', first.coords === second.coords && second.state === 'rest', `state=${second.state}`);
    check('hero opens face-on', /Hexagon|Pentagon/.test(first.detent ?? ''), `detent=${first.detent}`);
    check('home keeps zero canvases with the hero', second.canvases === 0, `${second.canvases} canvas`);
    const viewport = page.viewportSize();
    const finder = await page.locator('.finder-box input').boundingBox();
    check(
      'the finder is in the first viewport',
      Boolean(finder && finder.y >= 0 && finder.y + finder.height <= viewport.height),
      finder ? `input ${Math.round(finder.y)}-${Math.round(finder.y + finder.height)} of ${viewport.height}` : 'no finder',
    );
    await save('still', await page.screenshot({ scale: 'css' }));

    let box = await stageBox(page);
    if (touch) {
      // A vertical swipe that starts on the ball is the page's.
      const before = await readHero(page);
      await h.touchDrag(page, { x: box.cx + 10, y: box.cy + box.height * 0.3 }, { dx: 0, dy: -180 }, { holdMs: 0 });
      await page.waitForTimeout(600);
      const after = await readHero(page);
      check('a vertical swipe on the hero scrolls the page', after.scrollY - before.scrollY > 40, `scrollY ${before.scrollY} -> ${after.scrollY}`);
      check('a vertical swipe leaves the hero alone', after.coords === before.coords && after.state === 'rest' && !after.flash, `state=${after.state} flash=${after.flash || 'none'}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      box = await stageBox(page);
      // A small turn (< 30°) is not yet intent: the viewer stack stays unloaded.
      await h.touchDrag(page, { x: box.cx - 20, y: box.cy }, { dx: box.width / 10, dy: 0 });
      await page.waitForTimeout(700);
    }
    check('no viewer chunk before a real spin', viewerChunks.length === 0, viewerChunks.join(', ') || 'none');

    // A held drag turns it; released, it settles face-on within 2 s and names the face.
    const beforeDrag = await readHero(page);
    await recordStates(page);
    const start = { x: box.cx - box.width * 0.2, y: box.cy };
    if (touch) await h.touchDrag(page, start, { dx: box.width * 0.4, dy: 0 });
    else await h.mouseDrag(page, start, { dx: box.width * 0.4, dy: 0 });
    const released = await page.evaluate(() => performance.now());
    const drag = await waitForFace(page, released);
    const afterDrag = await readHero(page);
    outcome.data.drag = { ...drag, flash: afterDrag.flash };
    check('a drag turns the hero', afterDrag.coords !== beforeDrag.coords, drag.states.join(' '));
    check('released, it settles face-on within 2 s', drag.landed !== null && drag.ms <= 2_000, `${drag.ms ?? 'never'} ms: ${drag.landed?.[2] ?? 'no face'}`);
    check('the face name flashes', /Hexagon|Pentagon/.test(afterDrag.flash), afterDrag.flash || 'none');
    await heroShot(page, save, 'face');

    // A flick coasts, then clicks onto a face.
    await recordStates(page);
    const flickStart = { x: box.cx - box.width * 0.25, y: box.cy };
    if (touch) await h.touchFlick(page, flickStart, { dx: box.width * 0.45, dy: 0 }, { ms: 120 });
    else await h.mouseFlick(page, flickStart, { dx: box.width * 0.45, dy: 0 }, { ms: 120 });
    const thrown = await page.evaluate(() => performance.now());
    const frames = await h.sampleFrames(page, { ms: 1_200, every: 300 });
    const flick = await waitForFace(page, thrown);
    outcome.data.flick = flick;
    await save('coast', frames[1]);
    if (options.reducedMotion) {
      // Reduced motion is the Still comfort level: no coast, no spring, straight to the face.
      check('under reduced motion a flick cuts straight to a face', flick.landed !== null && !flick.states.some((s) => /:(coast|approach|click)/.test(s)), flick.states.join(' '));
    } else {
      check('a flick coasts, then clicks onto a face', flick.states.some((s) => /:coast/.test(s)) && flick.landed !== null && flick.ms <= 3_000, flick.states.join(' '));
    }
    await heroShot(page, save, 'flick-face');

    if (!touch) {
      // Keyboard: the arrow keys hop faces.
      await page.focus(STAGE);
      await recordStates(page);
      const pressed = await page.evaluate(() => performance.now());
      await page.keyboard.press('ArrowRight');
      const hop = await waitForFace(page, pressed);
      check('ArrowRight hops to the next face', hop.landed !== null, hop.states.join(' '));
    }

    // A tap opens C60 in 3D.
    box = await stageBox(page);
    if (touch) await page.touchscreen.tap(box.cx, box.cy);
    else await page.mouse.click(box.cx, box.cy);
    await expectViewer(ctx, h, 'hero tap');

    if (!touch && page.url().includes('sim=c60_buckyball')) {
      // Back lands on the landing inside the viewer; its ball opens C60 again.
      await page.goBack({ waitUntil: 'commit' });
      const back = await page.locator(STAGE).waitFor({ state: 'visible', timeout: options.timeout }).then(() => true, () => false);
      check('Back shows the hero inside the viewer', back, page.url());
      if (back) {
        await page.focus(STAGE);
        await page.keyboard.press('Enter');
        await expectViewer(ctx, h, 'Enter in the viewer');
      }
    }
  },
};
