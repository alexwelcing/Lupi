/**
 * sheets.mjs - phone sheets make room for the molecule (LOCAL smoke plugin,
 * not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=sheets --backend=both \
 *     --profile=phone,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/sheets
 *
 * On /?sim=caffeine, phone held upright, for each of Learn, Style, Data,
 * Camera, Export and Switch (a tap on the command deck) and Settings (the
 * Play tray's "Settings…"):
 * 1. The panel opens as a bottom sheet and `__lupiPlay.viewInset()` lists an
 *    occluder for it and heads for a framing that is not the identity.
 * 2. Once the view has eased, the molecule's drawn bounds (judged from a
 *    canvas screenshot with the chrome hidden) sit above the sheet's top
 *    edge, and moved up from where they were.
 * 3. Closing the panel (the same deck tap; Settings' close button) drops the
 *    occluder, eases the framing back to the identity, and the molecule
 *    returns to where it was.
 * 4. The canvas never resizes: same CSS box, same drawing-buffer size, and
 *    no ResizeObserver callback on it after the load.
 * A page screenshot of each open sheet is saved for a human to look at.
 */

const ID = 'caffeine';
/** Molecule bounds may poke this far past the sheet's top edge (CSS px; the fit keeps a 12 px gap). */
const EDGE_SLACK = 6;
/** Back where it was after closing (CSS px). */
const RETURN_SLACK = 8;

const PANELS = [
  { name: 'Learn', deck: 'Learn command', region: '#viewer-study-panel' },
  { name: 'Style', deck: 'Style command', region: '#viewer-command-panel' },
  { name: 'Data', deck: 'Data command', region: '#viewer-command-panel' },
  { name: 'Camera', deck: 'Camera command', region: '#viewer-command-panel' },
  { name: 'Export', deck: 'Export command', region: '#viewer-command-panel' },
  { name: 'Switch', deck: 'Switch command', region: '#viewer-command-panel' },
  { name: 'Settings', tray: /^Settings/, region: '#viewer-command-panel', close: 'Close Settings panel' },
];

/** Page-side: count resizes of the viewer canvas after the load. */
function watchCanvasResizes(selector) {
  const canvas = document.querySelector(selector);
  const log = (window.__sheetsSmoke = { resizes: 0, sizes: [] });
  if (!canvas) return;
  let first = true;
  new ResizeObserver((entries) => {
    if (first) {
      first = false;
      return;
    }
    for (const entry of entries) {
      log.resizes += 1;
      log.sizes.push([Math.round(entry.contentRect.width), Math.round(entry.contentRect.height)]);
    }
  }).observe(canvas);
}

const framing = (page) => page.evaluate(() => window.__lupiPlay?.viewInset?.() ?? null);
const canvasSize = (page) => page.evaluate(() => {
  const canvas = document.querySelector('[data-smoke-main]');
  const box = canvas?.getBoundingClientRect();
  return canvas ? { css: [Math.round(box.width), Math.round(box.height)], buffer: [canvas.width, canvas.height] } : null;
});

/** Wait until the framing has reached its target (or `ms`). */
async function eased(page, ms = 20_000) {
  await page.waitForFunction(() => {
    const view = window.__lupiPlay?.viewInset?.();
    if (!view) return true;
    const { current: c, target: t } = view;
    return Math.abs(c.x - t.x) < 0.5 && Math.abs(c.y - t.y) < 0.5 && Math.abs(c.scale - t.scale) < 0.005;
  }, null, { timeout: ms, polling: 100 }).catch(() => {});
  // A frame or two for the canvas to show it.
  await page.waitForTimeout(400);
}

/** The molecule's drawn bounds on the canvas (CSS px, canvas coordinates). */
async function drawn(page, h, canvas) {
  const { image } = await h.captureCanvas(page, canvas);
  const fg = h.foreground(image);
  if (!fg.box) return null;
  const [x0, y0, x1, y1] = fg.box;
  return { box: fg.box, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, height: y1 - y0, fraction: fg.fraction };
}

const round = (value) => Math.round(value * 10) / 10;

export default {
  name: 'sheets',
  profiles: ['phone', 'phone390'],
  description: 'Phone sheets: each panel declares its area, the molecule moves above it, closing restores, the canvas never resizes.',

  async run(ctx, h) {
    const { page, check, save, outcome } = ctx;
    const canvas = await h.openStructure(ctx, h.galleryEntry(ID));
    if (!canvas) return;
    const hooked = await page.waitForFunction(() => typeof window.__lupiPlay?.viewInset === 'function', null, { timeout: 15_000 }).then(() => true, () => false);
    check('__lupiPlay.viewInset is registered', hooked);
    if (!hooked) return;
    await h.waitSettled(page, canvas, 0.01, 30_000);
    await page.waitForFunction(() => window.__lupiPlay?.state?.().displaced === false, null, { timeout: 15_000 }).catch(() => {});
    await page.evaluate(watchCanvasResizes, '[data-smoke-main]');
    const canvasBox = await canvas.boundingBox();
    const sizeBefore = await canvasSize(page);
    const baseline = await framing(page);
    const rest = await drawn(page, h, canvas);
    outcome.data.baseline = { framing: baseline, drawn: rest, canvas: sizeBefore };
    check('the molecule is drawn before any sheet', Boolean(rest && rest.fraction > 0.005), JSON.stringify(rest));
    if (!rest) return;
    const baseOccluders = baseline?.occluders ?? [];
    const results = [];
    outcome.data.panels = results;

    for (const panel of PANELS) {
      const result = { panel: panel.name };
      results.push(result);
      if (panel.deck) {
        await page.getByRole('button', { name: panel.deck, exact: true }).tap();
      } else {
        await page.getByRole('button', { name: 'Play: toys and view' }).tap();
        const item = page.locator('[data-lupi-pill] [role="menu"]').getByRole('menuitem', { name: panel.tray });
        if (await item.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false)) await item.tap();
      }
      const region = page.locator(panel.region).first();
      const opened = await region.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
      check(`${panel.name}: the sheet opens`, opened);
      if (!opened) continue;
      await eased(page);
      const open = await framing(page);
      const sheet = await region.boundingBox();
      const moved = await drawn(page, h, canvas);
      const sheetTop = sheet ? sheet.y - canvasBox.y : null;
      Object.assign(result, { framing: open, sheet: sheet && { top: round(sheet.y), height: round(sheet.height) }, drawn: moved });
      await save(`${panel.name.toLowerCase()}-open`, await page.screenshot({ scale: 'css' }));
      const added = (open?.occluders ?? []).filter((id) => !baseOccluders.includes(id));
      check(`${panel.name}: viewInset() lists an occluder for the sheet`, added.length > 0, `occluders ${JSON.stringify(open?.occluders)}`);
      const t = open?.target;
      check(`${panel.name}: the framing makes room`, Boolean(t && (Math.abs(t.y) > 1 || Math.abs(t.x) > 1 || t.scale < 0.99)), JSON.stringify(t));
      check(`${panel.name}: the molecule sits above the sheet`, Boolean(moved && sheetTop !== null && moved.box[3] <= sheetTop + EDGE_SLACK),
        `drawn bottom ${moved?.box[3]} vs sheet top ${sheetTop === null ? 'none' : round(sheetTop)}; drawn ${JSON.stringify(moved?.box)}`);
      check(`${panel.name}: the molecule moved up into the free area`, Boolean(moved && moved.cy < rest.cy - 4), `centre y ${round(rest.cy)} -> ${moved ? round(moved.cy) : 'none'}`);

      // Close it the way it was opened (Settings has no deck button).
      if (panel.close) await page.getByRole('button', { name: panel.close, exact: true }).tap();
      else await page.getByRole('button', { name: panel.deck, exact: true }).tap();
      const closed = await region.waitFor({ state: 'hidden', timeout: 30_000 }).then(() => true, () => false);
      await eased(page);
      const after = await framing(page);
      const back = await drawn(page, h, canvas);
      Object.assign(result, { closedFraming: after, back });
      check(`${panel.name}: closing hides the sheet and drops its occluder`, closed && (after?.occluders ?? []).every((id) => baseOccluders.includes(id)), `occluders ${JSON.stringify(after?.occluders)}`);
      const c = after?.current;
      check(`${panel.name}: closing eases the framing back`, Boolean(c && Math.abs(c.x) < 0.5 && Math.abs(c.y) < 0.5 && Math.abs(c.scale - 1) < 0.005), JSON.stringify(c));
      check(`${panel.name}: the molecule returns`, Boolean(back && Math.abs(back.cx - rest.cx) <= RETURN_SLACK && Math.abs(back.cy - rest.cy) <= RETURN_SLACK),
        `centre ${round(rest.cx)},${round(rest.cy)} -> ${back ? `${round(back.cx)},${round(back.cy)}` : 'none'}`);
    }

    // The canvas never resized.
    const sizeAfter = await canvasSize(page);
    const resizes = await page.evaluate(() => window.__sheetsSmoke ?? { resizes: -1, sizes: [] });
    outcome.data.canvas = { before: sizeBefore, after: sizeAfter, resizes };
    check('the canvas never resizes for a sheet', JSON.stringify(sizeBefore) === JSON.stringify(sizeAfter) && resizes.resizes === 0,
      `before ${JSON.stringify(sizeBefore)}, after ${JSON.stringify(sizeAfter)}, ResizeObserver ${resizes.resizes} ${JSON.stringify(resizes.sizes.slice(0, 4))}`);
  },
};
