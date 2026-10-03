/**
 * relay.mjs - no splash between a tap and the 3D view
 * (packages/ui/src/relay). LOCAL check.
 *
 * Hero: a tap on the ink C60 raises the sage relay; the drawing still turns
 * under it while the viewer loads; no recorded frame from the tap to the first
 * 3D frame is dark (> 20 % of pixels within ΔRGB 10 of #020204, #06080d or
 * #000); the relay is gone (or inert) within 300 ms of the first frame; the
 * cage first draws along the baton's view direction (≤ 5°); an atom tap then
 * opens its card. Deep link: /?sim=c60_buckyball never shows the home H1 and
 * no frame from the first paint to the first 3D frame is dark. Desktop also
 * opens a wall tile, whose preview grows into the same stage.
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=relay --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/relay
 */

const DARK = [
  [0x02, 0x02, 0x04],
  [0x06, 0x08, 0x0d],
  [0x00, 0x00, 0x00],
];
const DARK_DELTA = 10;
const DARK_LIMIT = 0.2;
const SAMPLE_MS = 50;
const GONE_MS = 300;
const POSE_DEG = 5;
const RELAY = '[data-lupi-relay]';

/** Record every presented frame (CDP screencast) until the returned stop() is awaited. */
async function recordScreen(page, h) {
  const client = await h.cdpFor(page);
  const frames = [];
  const onFrame = ({ data, metadata, sessionId }) => {
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    frames.push({ at: Number.isFinite(metadata?.timestamp) ? metadata.timestamp * 1000 : Date.now(), data });
  };
  client.on('Page.screencastFrame', onFrame);
  const viewport = page.viewportSize();
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: viewport.width, maxHeight: viewport.height });
  return async () => {
    client.off('Page.screencastFrame', onFrame);
    await client.send('Page.stopScreencast').catch(() => {});
    return frames.sort((a, b) => a.at - b.at);
  };
}

function darkFraction(image) {
  const { data } = image;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    for (const [dr, dg, db] of DARK) {
      if (Math.abs(r - dr) <= DARK_DELTA && Math.abs(g - dg) <= DARK_DELTA && Math.abs(b - db) <= DARK_DELTA) {
        dark += 1;
        break;
      }
    }
  }
  return dark / (image.width * image.height);
}

/** The frames between `from` and `to` (wall ms), one per SAMPLE_MS, each with its dark fraction. */
function scanFrames(h, frames, from, to) {
  const picked = [];
  let last = -Infinity;
  let before = null;
  for (const frame of frames) {
    if (frame.at < from) {
      before = frame; // what was on screen at `from`
      continue;
    }
    if (frame.at > to) break;
    if (frame.at - last >= SAMPLE_MS) {
      picked.push(frame);
      last = frame.at;
    }
  }
  if (before) picked.unshift(before);
  let worst = { fraction: 0, t: null, frame: null };
  for (const frame of picked) {
    frame.dark = darkFraction(h.decodePng(Buffer.from(frame.data, 'base64')));
    if (frame.dark >= worst.fraction) worst = { fraction: frame.dark, t: Math.round(frame.at - from), frame };
  }
  return { count: picked.length, worst, picked };
}

function frameAt(frames, at) {
  let shown = null;
  for (const frame of frames) {
    if (frame.at > at) break;
    shown = frame;
  }
  return shown;
}

/** Page-side log (Date.now(), same clock as the screencast): relay added / ending / removed and the first frame. */
async function installRelayLog(page) {
  await page.evaluate((selector) => {
    const log = [];
    window.__relayLog = log;
    window.__relayAtFirstFrame = null;
    const note = (what) => log.push([Date.now(), what]);
    const attrs = new MutationObserver(() => note('ending'));
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && node.matches(selector)) {
            note('added');
            attrs.observe(node, { attributes: true, attributeFilter: ['data-ending'] });
          }
        }
        for (const node of record.removedNodes) if (node.nodeType === 1 && node.matches(selector)) note('removed');
      }
    }).observe(document.body, { childList: true });
    window.addEventListener('lupi:first-frame', () => {
      note('first-frame');
      let baton = null;
      try {
        baton = JSON.parse(sessionStorage.getItem('lupi.relay.baton') ?? 'null')?.baton ?? null;
      } catch {
        /* none */
      }
      window.__relayAtFirstFrame = { baton, relayUp: Boolean(document.querySelector(`${selector}:not([data-ending])`)) };
    });
  }, RELAY);
}

const readLog = (page) => page.evaluate(() => ({ log: window.__relayLog ?? [], atFirstFrame: window.__relayAtFirstFrame ?? null }));
const firstAfter = (log, what, since) => log.find(([t, w]) => w === what && t >= since)?.[0] ?? null;

async function waitFirstFrame(page, timeout) {
  return page
    .waitForFunction(() => (window.__relayLog ?? []).some(([, w]) => w === 'first-frame'), null, { timeout, polling: 100 })
    .then(() => true, () => false);
}

async function readCameraDir(page) {
  return page.evaluate(async () => {
    const rig = window.__lupiPlay?.state?.()?.rig;
    let position = rig?.position;
    let target = rig?.target;
    if (!position) {
      const response = await window.__lupiViewerMcp?.execute({ id: 'relay-camera', tool: 'lupi.set_camera', arguments: {} });
      position = response?.result?.cameraPosition;
      target = response?.result?.cameraTarget;
    }
    if (!position || !target) return null;
    const d = position.map((v, i) => v - target[i]);
    const n = Math.hypot(...d);
    return d.map((v) => v / n);
  });
}

function angleDeg(a, b) {
  if (!a || !b) return null;
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

async function viewerCanvas(page, h) {
  const canvas = await h.mainCanvas(page);
  if (canvas) await canvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
  return canvas;
}

/** The hand-off checks shared by every path: dark frames, the relay's exit, no stray layer. */
async function checkHandOff(ctx, h, label, { frames, from, firstFrameAt, log }) {
  const { check, save, outcome } = ctx;
  const scan = scanFrames(h, frames, from, firstFrameAt + GONE_MS);
  outcome.data[`${label}-frames`] = { count: scan.count, worstDark: scan.worst.fraction, worstAtMs: scan.worst.t, darkSeries: scan.picked.map((f) => Number(f.dark.toFixed(3))) };
  check(
    `${label}: no dark frame until the first 3D frame`,
    scan.count >= 3 && scan.worst.fraction <= DARK_LIMIT,
    `${scan.count} frames over ${Math.round(firstFrameAt - from)} ms; darkest ${h.pct(scan.worst.fraction)} at +${scan.worst.t} ms`,
  );
  if (scan.worst.frame && scan.worst.fraction > DARK_LIMIT) await save(`${label}-darkest`, Buffer.from(scan.worst.frame.data, 'base64'));
  const last = frameAt(frames, firstFrameAt - 1);
  if (last) await save(`${label}-last-cover`, Buffer.from(last.data, 'base64'));
  // The first picture with nothing over the cage (a software renderer can hold the fade up).
  const removed = log ? firstAfter(log, 'removed', firstFrameAt) : null;
  const after = frameAt(frames, (removed ?? firstFrameAt + GONE_MS) + 120);
  if (after) await save(`${label}-3d`, Buffer.from(after.data, 'base64'));
  if (log) {
    const ending = firstAfter(log, 'ending', firstFrameAt) ?? removed;
    check(`${label}: the relay is gone within ${GONE_MS} ms of the first frame`, ending !== null && ending - firstFrameAt <= GONE_MS, ending === null ? 'still up' : `inert after ${ending - firstFrameAt} ms, removed after ${removed === null ? '?' : removed - firstFrameAt} ms`);
  }
}

async function heroPath(ctx, h) {
  const { page, spec, check, save, outcome, options } = ctx;
  const touch = h.isTouchProfile(spec.profile);
  await page.goto(h.baseFor(page).href, { waitUntil: 'load', timeout: options.timeout });
  const hero = page.locator('.bucky-hero__stage');
  await hero.waitFor({ state: 'visible', timeout: options.timeout });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await installRelayLog(page);
  const stop = await recordScreen(page, h);
  await page.waitForTimeout(150);

  const box = await hero.boundingBox();
  const tapAt = Date.now();
  if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const tapBaton = await page.evaluate(() => JSON.parse(sessionStorage.getItem('lupi.relay.baton') ?? 'null')?.baton ?? null);
  const relayUp = await page.locator(RELAY).first().waitFor({ state: 'attached', timeout: 2_000 }).then(() => true, () => false);
  check('a hero tap raises the sage relay', relayUp && (await page.locator(`${RELAY} .lupi-relay__stage[data-kind="hero"] circle`).count()) === 60, relayUp ? 'relay with the ink C60' : 'no relay');

  // The drawing still turns under the relay while the viewer loads (a held drag: no coast).
  let turned = null;
  let dragged = false;
  const stage = page.locator(`${RELAY}:not([data-ending]) .lupi-relay__stage`);
  await page.waitForTimeout(400);
  const stageBox = await stage.boundingBox().catch(() => null);
  if (stageBox) {
    const start = { x: stageBox.x + stageBox.width * 0.3, y: stageBox.y + stageBox.height / 2 };
    const drag = { dx: stageBox.width * 0.35, dy: 0 };
    dragged = await (touch ? h.touchDrag(page, start, drag) : h.mouseDrag(page, start, drag)).then(() => true, () => false);
    turned = await page
      .waitForFunction((selector) => {
        const node = document.querySelector(`${selector}:not([data-ending]) .lupi-relay__stage`);
        return node ? node.dataset.buckyState === 'rest' && JSON.parse(sessionStorage.getItem('lupi.relay.baton') ?? 'null')?.baton : null;
      }, RELAY, { timeout: 3_000, polling: 50 })
      .then((handle) => handle.jsonValue(), () => null);
  }

  const reached = await waitFirstFrame(page, options.timeout);
  const { log, atFirstFrame } = await readLog(page);
  const firstFrameAt = firstAfter(log, 'first-frame', tapAt);
  await page.waitForTimeout(GONE_MS + 150);
  const frames = await stop();
  check('the viewer draws its first frame', reached && firstFrameAt !== null, reached ? `${firstFrameAt - tapAt} ms after the tap` : 'no first frame');
  if (!reached || firstFrameAt === null) return;
  outcome.data.hero = { tapToFirstFrameMs: firstFrameAt - tapAt, log: log.map(([t, w]) => `${t - tapAt}:${w}`), tapBaton, turnedBaton: turned, atFirstFrame };
  const early = frameAt(frames, tapAt + 150);
  if (early) await save('hero-relay', Buffer.from(early.data, 'base64'));
  const ringShot = firstFrameAt - tapAt > 1_800 ? frameAt(frames, tapAt + 1_700) : null;
  if (ringShot) await save('hero-ring', Buffer.from(ringShot.data, 'base64'));
  await checkHandOff(ctx, h, 'hero', { frames, from: tapAt, firstFrameAt, log });

  const handed = atFirstFrame?.baton ?? turned ?? tapBaton;
  if (dragged) {
    // The pose the cage takes over at is the one the visitor left under the relay.
    const moved = angleDeg(handed?.viewDir, tapBaton?.viewDir);
    check('turning the drawing under the relay moves the baton', moved !== null && moved > 5, `${moved?.toFixed(1)}° from the tap pose${turned ? ', settled on a face' : ''}`);
  }
  const dir = await readCameraDir(page);
  const off = angleDeg(dir, handed?.viewDir);
  outcome.data.hero.cameraDir = dir;
  check(`the cage first draws at the drawing's pose (≤ ${POSE_DEG}°)`, off !== null && off <= POSE_DEG, off === null ? 'no camera or baton' : `${off.toFixed(2)}° from the baton`);

  const canvas = await viewerCanvas(page, h);
  if (!check('hero: the viewer canvas is present', Boolean(canvas))) return;
  const settled = await h.waitSettled(page, canvas, 0.01, 30_000);
  await h.pickAtom(ctx, canvas, settled.image);
  ctx.spec.lane.actualBackend ??= await h.detectBackend(page);
  const stray = await page.locator(RELAY).count();
  check('hero: no relay layer left behind', stray === 0, `${stray} layer(s)`);
}

async function tilePath(ctx, h) {
  const { page, check, save, outcome, options } = ctx;
  await page.goto(h.baseFor(page).href, { waitUntil: 'load', timeout: options.timeout });
  const tile = page.locator('.wall-grid a[href="/m/caffeine"]');
  await tile.scrollIntoViewIfNeeded({ timeout: options.timeout });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await installRelayLog(page);
  const stop = await recordScreen(page, h);
  await page.waitForTimeout(150);
  const tapAt = Date.now();
  await tile.click();
  const grown = await page.locator(`${RELAY} .lupi-relay__stage img`).first().waitFor({ state: 'attached', timeout: 2_000 }).then(() => true, () => false);
  check('a wall tile grows its preview into the relay', grown, grown ? 'preview on the sage stage' : 'no relay preview');
  const reached = await waitFirstFrame(page, options.timeout);
  const { log } = await readLog(page);
  const firstFrameAt = firstAfter(log, 'first-frame', tapAt);
  await page.waitForTimeout(GONE_MS + 150);
  const frames = await stop();
  if (!check('tile: the viewer draws its first frame', reached && firstFrameAt !== null, reached ? `${firstFrameAt - tapAt} ms` : 'none')) return;
  outcome.data.tile = { tapToFirstFrameMs: firstFrameAt - tapAt, log: log.map(([t, w]) => `${t - tapAt}:${w}`) };
  const early = frameAt(frames, tapAt + 150);
  if (early) await save('tile-relay', Buffer.from(early.data, 'base64'));
  await checkHandOff(ctx, h, 'tile', { frames, from: tapAt, firstFrameAt, log });
  await page.waitForTimeout(300);
  check('tile: no relay layer left behind', (await page.locator(RELAY).count()) === 0);
}

async function deepLinkPath(ctx, h) {
  const { page, check, outcome, options } = ctx;
  await page.addInitScript(() => {
    window.__sawHomeTitle = false;
    window.__relayLog = [];
    const watch = new MutationObserver(() => {
      if (document.getElementById('home-title')) window.__sawHomeTitle = true;
    });
    watch.observe(document, { childList: true, subtree: true });
    window.addEventListener('lupi:first-frame', () => window.__relayLog.push([Date.now(), 'first-frame']));
  });
  const stop = await recordScreen(page, h);
  const from = Date.now();
  await page.goto(new URL('?sim=c60_buckyball', h.baseFor(page)).href, { waitUntil: 'commit', timeout: options.timeout });
  const reached = await waitFirstFrame(page, options.timeout);
  const { log } = await readLog(page);
  const firstFrameAt = firstAfter(log, 'first-frame', from);
  await page.waitForTimeout(GONE_MS + 150);
  const frames = await stop();
  const saw = await page.evaluate(() => window.__sawHomeTitle);
  check('/?sim=c60_buckyball never shows the home H1', saw === false, saw ? '#home-title appeared' : 'no #home-title');
  if (!check('deep link: the viewer draws its first frame', reached && firstFrameAt !== null)) return;
  outcome.data.deepLink = { navToFirstFrameMs: firstFrameAt - from };
  const plate = frameAt(frames, Math.max(from, firstFrameAt - 400));
  if (plate) await ctx.save('deeplink-plate', Buffer.from(plate.data, 'base64'));
  // Frames before the new document's first paint still show the previous page.
  const firstPaint = frames.find((f) => f.at > from + 50)?.at ?? from;
  await checkHandOff(ctx, h, 'deep link', { frames, from: firstPaint, firstFrameAt, log: null });
  const left = await page.evaluate(() => document.querySelectorAll('[data-lupi-relay], .lupi-plate').length);
  check('deep link: the sage plate is gone after the first frame', left === 0, `${left} plate(s)`);
}

export default {
  name: 'relay',
  profiles: ['desktop', 'phone', 'phone390'],
  description: 'Sage from tap (hero, tile) or deep link to the first 3D frame: no dark frame, pose carried, relay gone in 300 ms.',

  async run(ctx, h) {
    const { spec } = ctx;
    ctx.outcome.url = h.baseFor(ctx.page).href;
    await heroPath(ctx, h);
    if (!h.isTouchProfile(spec.profile)) await tilePath(ctx, h);
    await deepLinkPath(ctx, h);
  },
};
