/**
 * onedrawing.mjs - one drawing everywhere: the SVG ink drawing (the /m
 * pages, the wall's ink tiles, the relay) against the viewer's first ink
 * frame after the hand-off (packages/ui/src/moleculePage/ink.ts,
 * relay/stage.ts, scene/tsl/inkLook.ts). LOCAL check.
 *
 * For C60 and caffeine:
 * 1. /m/<id>: the page's drawing, once the spinnable stage has taken over.
 * 2. The wall's ink tile, as relay.mjs opens it: the relay grows the drawing
 *    to the size the 3D view will draw it. The viewer's chunks wait behind a
 *    gate until the relay's drawing is captured, so the capture never races
 *    the first frame.
 * 3. The viewer's first ink frame at the drawing's pose, held in ink
 *    (__lupiPlay.ink('hold', 0) is armed before the light comes on) and
 *    captured once the arrival has settled; then the configured Illustrate
 *    look (lupi.set_viewer { inkStyle: 'flat' }) at the same pose.
 *
 * It reports how alike the drawing and the 3D frames are, inside the
 * molecule's bounds (the union of both foregrounds, padded): the mean
 * colour difference (0-255, all channels) and the share of pixels within
 * 24 of each other. The numbers are a measure, not a gate: the checks only
 * ask that every picture was taken and the drawing sits where the 3D view
 * draws the molecule.
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=onedrawing --backend=both \
 *     --profile=desktop --strict-backend --out=.verify-artifacts/viewer-smoke/onedrawing
 */

const MOLECULES = ['c60_buckyball', 'caffeine'];
const RELAY = '[data-lupi-relay]';
const NEAR = 24;
const PAD = 6;

/** A CSS-pixel rectangle of the page, captured over CDP at the page's own scale. */
async function captureRect(page, h, rect) {
  const client = await h.cdpFor(page);
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
  const full = h.decodePng(Buffer.from(data, 'base64'));
  const viewport = page.viewportSize();
  const scale = full.width / (viewport?.width ?? full.width);
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.max(1, Math.min(Math.floor(rect.width), (viewport?.width ?? rect.width) - x));
  const height = Math.max(1, Math.min(Math.floor(rect.height), (viewport?.height ?? rect.height) - y));
  return h.cropImage(full, { x, y, width, height }, scale);
}

async function captureViewport(page, h) {
  const viewport = page.viewportSize();
  return captureRect(page, h, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}

/** The two pictures' molecule bounds (their foregrounds' union, padded) and how alike they are inside them. */
function likeness(h, a, b) {
  if (a.width !== b.width || a.height !== b.height) return null;
  const fa = h.foreground(a);
  const fb = h.foreground(b);
  if (!fa.box || !fb.box) return null;
  const box = [
    Math.max(0, Math.min(fa.box[0], fb.box[0]) - PAD),
    Math.max(0, Math.min(fa.box[1], fb.box[1]) - PAD),
    Math.min(a.width - 1, Math.max(fa.box[2], fb.box[2]) + PAD),
    Math.min(a.height - 1, Math.max(fa.box[3], fb.box[3]) + PAD),
  ];
  let sum = 0;
  let near = 0;
  let count = 0;
  let maskSum = 0;
  let maskCount = 0;
  for (let y = box[1]; y <= box[3]; y += 1) {
    for (let x = box[0]; x <= box[2]; x += 1) {
      const i = (y * a.width + x) * 4;
      const dr = Math.abs(a.data[i] - b.data[i]);
      const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
      const mean = (dr + dg + db) / 3;
      sum += mean;
      count += 1;
      if (Math.max(dr, dg, db) <= NEAR) near += 1;
      if (fa.mask[y * a.width + x] || fb.mask[y * a.width + x]) {
        maskSum += mean;
        maskCount += 1;
      }
    }
  }
  // How well the two silhouettes overlap (intersection over union of the foregrounds).
  let both = 0;
  let either = 0;
  for (let k = 0; k < fa.mask.length; k += 1) {
    if (fa.mask[k] && fb.mask[k]) both += 1;
    if (fa.mask[k] || fb.mask[k]) either += 1;
  }
  return {
    box,
    meanDiff: Number((sum / Math.max(1, count)).toFixed(2)),
    meanDiffOnMolecule: Number((maskSum / Math.max(1, maskCount)).toFixed(2)),
    near: Number((near / Math.max(1, count)).toFixed(4)),
    silhouetteIoU: Number((both / Math.max(1, either)).toFixed(4)),
  };
}

/** Where the two foregrounds sit: the centres' offset (share of the larger box's diagonal) and the size ratio. */
function placement(h, a, b) {
  const boxA = h.foreground(a).box;
  const boxB = h.foreground(b).box;
  if (!boxA || !boxB) return null;
  const centre = (box) => [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  const size = (box) => Math.hypot(box[2] - box[0], box[3] - box[1]);
  const [ax, ay] = centre(boxA);
  const [bx, by] = centre(boxB);
  return {
    drawing: boxA,
    frame: boxB,
    offset: Number((Math.hypot(ax - bx, ay - by) / Math.max(size(boxA), size(boxB), 1)).toFixed(4)),
    scale: Number((size(boxA) / Math.max(1, size(boxB))).toFixed(4)),
  };
}

/** Two crops side by side on the plate, with a 6 px seam. */
function sideBySide(h, left, right, box) {
  const rect = { x: box[0], y: box[1], width: box[2] - box[0] + 1, height: box[3] - box[1] + 1 };
  const a = h.cropImage(left, rect, 1);
  const b = h.cropImage(right, rect, 1);
  const gap = 6;
  const width = a.width * 2 + gap;
  const data = new Uint8ClampedArray(width * a.height * 4);
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      let source = null;
      let sx = 0;
      if (x < a.width) {
        source = a;
        sx = x;
      } else if (x >= a.width + gap) {
        source = b;
        sx = x - a.width - gap;
      }
      if (!source) {
        data.set([118, 128, 122, 255], o);
        continue;
      }
      const i = (y * source.width + sx) * 4;
      data.set(source.data.subarray(i, i + 4), o);
    }
  }
  return h.encodePng({ width, height: a.height, data });
}

async function pageDrawing(ctx, h, id) {
  const { page, check, save, options } = ctx;
  const response = await page.goto(new URL(`/m/${id}`, h.baseFor(page)).href, { waitUntil: 'load', timeout: options.timeout });
  const live = await page.locator('#ink-stage[data-live]').waitFor({ state: 'attached', timeout: 10_000 }).then(() => true, () => false);
  if (!check(`/m/${id}: the spinnable drawing takes over`, response?.ok() && live, `status ${response?.status()}`)) return null;
  const box = await page.locator('#ink-stage').boundingBox();
  const image = await captureRect(page, h, box);
  await save(`${id}-page`, h.encodePng(image));
  const markup = await page.evaluate(() => {
    const svg = document.querySelector('#ink-stage svg');
    return svg ? { bytes: svg.outerHTML.length, nodes: svg.querySelectorAll('*').length } : null;
  });
  return { box, markup };
}

async function handOff(ctx, h, id) {
  const { page, check, save, outcome, options } = ctx;
  await page.goto(h.baseFor(page).href, { waitUntil: 'load', timeout: options.timeout });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  let tile = page.locator(`.wall-grid a[href="/m/${id}"]`);
  if ((await tile.count()) === 0) {
    await page.locator('.wall-more').click().catch(() => {});
    tile = page.locator(`.wall-grid a[href="/m/${id}"]`);
  }
  if (!check(`${id}: the wall has an ink tile`, (await tile.count()) > 0)) return null;
  await tile.scrollIntoViewIfNeeded({ timeout: options.timeout });

  // The viewer's chunks wait until the relay's drawing has been captured.
  let open;
  const gate = new Promise((resolve) => {
    open = resolve;
  });
  const held = async (route) => {
    await gate;
    await route.continue().catch(() => {});
  };
  await page.route('**/assets/**/*.js', held);
  // Keep the 3D view in ink: the light's fuse starts held at 0.
  await page.evaluate(() => {
    window.__firstFrameAt = null;
    window.addEventListener('lupi:first-frame', () => {
      window.__firstFrameAt ??= Date.now();
    });
    const arm = setInterval(() => {
      if (typeof window.__lupiPlay?.ink !== 'function') return;
      window.__lupiPlay.ink('hold', 0);
      clearInterval(arm);
    }, 16);
  });

  // The pointer reaches the tile (its drawing model is fetched), then a tap.
  await tile.hover();
  await page.waitForFunction((path) => performance.getEntriesByType('resource').some((entry) => entry.name.includes(path)), `/og/m/${id}-ink.json`, { timeout: 10_000, polling: 50 }).catch(() => {});
  await tile.click();
  const staged = await page.locator(`${RELAY} .lupi-relay__stage[data-kind="ink"] svg`).first().waitFor({ state: 'attached', timeout: 5_000 }).then(() => true, () => false);
  await page.waitForTimeout(600); // the FLIP (280 ms) and a settle
  const relayUp = await page.locator(`${RELAY}:not([data-ending])`).count();
  // The drawing alone: the relay's ring, face name and Retry stay out of the picture.
  await page.addStyleTag({ content: '.lupi-relay__ring, .lupi-relay__mark, .lupi-relay__face, .lupi-relay__wait { visibility: hidden !important; }' });
  const relay = await captureViewport(page, h);
  const relayStage = await page.evaluate(() => {
    const svg = document.querySelector('[data-lupi-relay] .lupi-relay__stage svg');
    return svg ? { bytes: svg.outerHTML.length, nodes: svg.querySelectorAll('*').length } : null;
  });
  await page.unroute('**/assets/**/*.js', held).catch(() => {});
  open();
  check(`${id}: the relay turns the drawing while the viewer waits`, staged && relayUp > 0, staged ? 'ink stage on the sage relay' : 'no ink stage');
  await save(`${id}-relay`, h.encodePng(relay));

  const reached = await page.waitForFunction(() => window.__firstFrameAt !== null, null, { timeout: options.timeout, polling: 100 }).then(() => true, () => false);
  if (!check(`${id}: the viewer draws its first frame`, reached)) return null;
  await page.locator(RELAY).first().waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  const canvas = await h.mainCanvas(page);
  if (!check(`${id}: the viewer canvas is present`, Boolean(canvas))) return null;
  await canvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
  const canvasBox = await canvas.boundingBox();
  const viewport = page.viewportSize();
  const fills = Math.abs(canvasBox.x) < 1 && Math.abs(canvasBox.y) < 1
    && Math.abs(canvasBox.width - viewport.width) < 2 && Math.abs(canvasBox.height - viewport.height) < 2;
  check(`${id}: the canvas fills the window (the relay is centred on it)`, fills, `${Math.round(canvasBox.width)}x${Math.round(canvasBox.height)} at ${Math.round(canvasBox.x)},${Math.round(canvasBox.y)}`);

  // The first ink frame, at rest: the arrival has settled, the light held off.
  await page.waitForFunction(() => {
    const state = window.__lupiPlay?.ink?.();
    return Boolean(state) && state.fuse?.held === true && state.mix > 0.99;
  }, null, { timeout: 30_000, polling: 100 }).catch(() => {});
  const first = await h.waitSettled(page, canvas, 0.01);
  const inkState = await page.evaluate(() => window.__lupiPlay?.ink?.() ?? null);
  check(`${id}: the hand-off frame is ink (the light held off)`, inkState?.fuse?.held === true && inkState.mix > 0.99, JSON.stringify(inkState?.fuse ?? null));
  await save(`${id}-first-ink`, first.png);

  // The configured Illustrate look at the same pose (no post recipe under it).
  await page.evaluate(() => window.__lupiPlay?.ink?.('release'));
  const set = await page.evaluate(() => window.__lupiViewerMcp.execute({ id: 'onedrawing-ink', tool: 'lupi.set_viewer', arguments: { inkStyle: 'flat' } }));
  check(`${id}: lupi.set_viewer { inkStyle: 'flat' }`, set.ok, JSON.stringify(set.error ?? null));
  await page.waitForFunction(() => {
    const state = window.__lupiPlay?.ink?.();
    return Boolean(state) && !state.fading && !state.fuse?.running && state.mix === 1;
  }, null, { timeout: 30_000, polling: 100 }).catch(() => {});
  const look = await h.waitSettled(page, canvas, 0.01);
  await save(`${id}-ink-look`, look.png);

  const handed = likeness(h, relay, first.image);
  const configured = likeness(h, relay, look.image);
  outcome.data[id] = { relayStage, handOff: handed, inkLook: configured };
  ctx.log(`${id}: drawing vs hand-off frame ${JSON.stringify(handed)}; vs Illustrate ${JSON.stringify(configured)}`);
  // The drawing's bounds against the 3D frame's: centred alike and about as large.
  const placed = placement(h, relay, first.image);
  outcome.data[id].placement = placed;
  check(`${id}: the drawing sits where the 3D view draws the molecule`, Boolean(placed) && placed.offset <= 0.08 && placed.scale >= 0.8 && placed.scale <= 1.25, JSON.stringify(placed));
  if (handed) await save(`${id}-side-by-side`, sideBySide(h, relay, first.image, handed.box));
  if (configured) await save(`${id}-side-by-side-look`, sideBySide(h, relay, look.image, configured.box));
  // Back to lit: the device remembers the look, and the next hand-off must open in ink.
  await page.evaluate(() => window.__lupiViewerMcp.execute({ id: 'onedrawing-lit', tool: 'lupi.set_viewer', arguments: { inkStyle: 'off' } }));
  await page.waitForFunction(() => {
    const state = window.__lupiPlay?.ink?.();
    return Boolean(state) && !state.fading && state.mix === 0;
  }, null, { timeout: 30_000, polling: 100 }).catch(() => {});
  return { handed, configured };
}

export default {
  name: 'onedrawing',
  profiles: ['desktop'],
  description: 'The SVG ink drawing (/m page, ink tile, relay) against the first 3D ink frame at the same pose (C60, caffeine): a likeness measure.',

  async run(ctx, h) {
    ctx.outcome.url = h.baseFor(ctx.page).href;
    for (const id of MOLECULES) {
      const drawn = await pageDrawing(ctx, h, id);
      if (drawn) ctx.outcome.data[`${id}-page`] = drawn;
      await handOff(ctx, h, id);
    }
    ctx.spec.lane.actualBackend ??= await h.detectBackend(ctx.page).catch(() => null);
  },
};
