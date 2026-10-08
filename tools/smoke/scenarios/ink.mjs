/**
 * ink.mjs - the Illustrate look's five shadings: Illustrate (flat), Sketch
 * (hatch), Engrave, Halftone and Chalk (LOCAL smoke plugin, not CI; Chalk's
 * own checks are in chalk.mjs).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=ink --backend=both \
 *     --profile=desktop --strict-backend --out=.verify-artifacts/viewer-smoke/ink
 *
 * On caffeine and C60, lit first, then each shading through
 * `lupi.set_viewer { inkStyle }` on the plate its Look uses:
 * 1. The drawing settles (no fade left, `__lupiPlay.ink()` at its weights),
 *    the canvas is painted and differs from the lit view, and a still view
 *    draws no frames (Quiet Idle: nothing in the shading reads time).
 * 2. With bonds hidden, `lupi.export_asset` PNG 1024 × 1024 for Engrave and
 *    Halftone decodes at size with painted pixels. The MCP result carries no
 *    spec, so the shading's place in it is checked through identity: each
 *    shading gets its own specId (renderArtifactAdapter.test.ts checks
 *    `view.ink.shading` itself). Desktop only: the spec and its pixels do
 *    not depend on the device that asks.
 * Every settled view and export is saved for a human to look at; on a phone
 * the close-ups are also saved at the screenshot's own pixels (`-device`:
 * device pixels where CDP returns them; the phone lanes here return CSS
 * size, downsampled by the browser rather than picked pixel by pixel).
 */

const MOLECULES = ['caffeine', 'c60_buckyball'];
/** Each shading, its weight in `__lupiPlay.ink()`, and the plate its Look draws on. */
const SHADINGS = [
  { style: 'flat', weight: null, plate: 'sage-plate' },
  { style: 'hatch', weight: 'hatch', plate: 'paper-plate' },
  { style: 'engrave', weight: 'engrave', plate: 'paper-plate' },
  { style: 'halftone', weight: 'halftone', plate: 'paper-plate' },
  { style: 'chalk', weight: 'chalk', plate: 'sage-plate' },
];
const EXPORTED = ['engrave', 'halftone'];

const fraction = (h, a, b) => h.diffImages(a, b).changed / (a.width * a.height);

function setViewer(page, args) {
  return page.evaluate(async (viewer) => {
    const out = await window.__lupiViewerMcp.execute({ id: `ink-${JSON.stringify(viewer)}`, tool: 'lupi.set_viewer', arguments: viewer });
    return { ok: out.ok, error: out.error ?? null };
  }, args);
}

/** The ink driver's weights for a shading ('off' is lit). */
function weightsFor(style) {
  const weight = SHADINGS.find((shading) => shading.style === style)?.weight;
  return { mix: style === 'off' ? 0 : 1, hatch: 0, engrave: 0, halftone: 0, chalk: 0, ...(weight ? { [weight]: 1 } : {}) };
}

/**
 * Wait until the ink driver has taken `style` as its target (the store
 * reaches it a render after set_viewer returns) and rests there.
 */
function waitInkRest(page, style, maxMs = 90_000) {
  return page
    .waitForFunction((expected) => {
      const ink = window.__lupiPlay?.ink?.();
      // The loop asleep too, so the last drawn frame shows the shading.
      if (!ink || ink.fading || ink.holding || window.__lupiPlay.state().frameDemand?.awake !== false) return null;
      const at = (values) => Object.entries(expected).every(([key, value]) => values[key] === value);
      return at(ink.target) && at(ink) ? ink : null;
    }, weightsFor(style), { timeout: maxMs, polling: 50 })
    .then((handle) => handle.jsonValue(), () => page.evaluate(() => window.__lupiPlay?.ink?.() ?? null));
}

/** Frames drawn over `ms` of a still view. */
async function framesWhileStill(page, ms = 600) {
  const before = (await page.evaluate(() => window.__lupiPlay?.state?.()?.frames ?? null));
  await page.waitForTimeout(ms);
  const after = (await page.evaluate(() => window.__lupiPlay?.state?.()?.frames ?? null));
  return before === null || after === null ? null : after - before;
}

/** The canvas at the screenshot's own pixels (no nearest-pixel crop to CSS size). */
async function captureDevice(page, h, canvas) {
  const box = await canvas.boundingBox();
  const client = await h.cdpFor(page);
  await page.evaluate((text) => {
    const style = document.createElement('style');
    style.id = 'ink-device-capture';
    style.textContent = text;
    document.head.appendChild(style);
    // Two frames, so 1 ms transitions (reduced motion) have hidden the chrome.
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  }, h.HIDE_CHROME_CSS);
  try {
    const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
    const full = h.decodePng(Buffer.from(data, 'base64'));
    const scale = full.width / (page.viewportSize()?.width ?? full.width);
    const rect = { x: Math.floor(box.x * scale), y: Math.floor(box.y * scale), width: Math.floor(box.width * scale), height: Math.floor(box.height * scale) };
    return { image: h.cropImage(full, rect, 1), scale };
  } finally {
    await page.evaluate(() => document.getElementById('ink-device-capture')?.remove());
  }
}

async function exportPng(page, h, label) {
  return h.withTimeout(page.evaluate(async (id) => {
    const out = await window.__lupiViewerMcp.execute({
      id,
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 1024, height: 1024, transparent: false, timeoutMs: 90_000 },
    });
    const asset = out.result?.asset;
    return {
      ok: out.ok,
      error: out.error ?? null,
      dataBase64: asset?.dataBase64 ?? null,
      specId: asset?.specId ?? null,
      artifactDigest: asset?.artifactDigest ?? null,
    };
  }, `ink-export-${label}`), 150_000, `export ${label}`);
}

export default {
  name: 'ink',
  profiles: ['desktop', 'phone390'],
  description: 'Illustrate, Sketch, Engrave, Halftone and Chalk draw on caffeine and C60, rest still, and export (Engrave, Halftone).',

  async run(ctx, h) {
    const { page, spec, check, save, outcome } = ctx;
    const phone = h.isTouchProfile(spec.profile);
    outcome.data.ink = {};
    for (const id of MOLECULES) {
      const data = { views: {}, exports: {} };
      outcome.data.ink[id] = data;
      const canvas = await h.openStructure(ctx, h.galleryEntry(id));
      if (!canvas) return;
      // A new molecule keeps the last look (and the device remembers it): start lit, with bonds.
      const reset = await setViewer(page, { inkStyle: 'off', showBonds: true });
      check(`${id}: opens lit with bonds`, reset.ok, JSON.stringify(reset.error));
      await waitInkRest(page, 'off');
      const lit = await h.waitSettled(page, canvas, 0.01);
      await save(`${id}-lit`, lit.png);

      // 1. Each shading on its Look's plate, against the lit view.
      for (const { style, plate } of SHADINGS) {
        const applied = await setViewer(page, { inkStyle: style, backgroundPreset: plate });
        check(`${id}: set_viewer inkStyle ${style}`, applied.ok, JSON.stringify(applied.error));
        const ink = await waitInkRest(page, style);
        const expected = weightsFor(style);
        check(
          `${id}: ${style} rests at its weights`,
          Boolean(ink) && Object.entries(expected).every(([key, value]) => ink[key] === value),
          JSON.stringify(ink && { mix: ink.mix, hatch: ink.hatch, engrave: ink.engrave, halftone: ink.halftone, chalk: ink.chalk }),
        );
        const view = await h.waitSettled(page, canvas, 0.01);
        await save(`${id}-${style}`, view.png);
        const assessed = await h.assessRender(page, canvas, view.image, 0.01);
        const changed = fraction(h, lit.image, view.image);
        const still = await framesWhileStill(page);
        data.views[style] = { settled: view.meta, changed: h.pct(changed), foreground: h.pct(assessed.foregroundFraction), distinctColors: assessed.distinctColors, stillFrames: still };
        check(`${id}: ${style} paints the canvas`, assessed.nonBlank && assessed.foregroundFraction > 0.01, `fg=${h.pct(assessed.foregroundFraction)} colours=${assessed.distinctColors}`);
        check(`${id}: ${style} differs from the lit view`, changed > 0.02, `changed=${h.pct(changed)}`);
        check(`${id}: ${style} at rest draws no frames`, still === 0, `frames=${still}`);
      }

      // A closer look at the two print shadings with bonds, for a human.
      const rig = await page.evaluate(() => window.__lupiPlay?.state?.()?.rig ?? null);
      if (rig?.position && rig?.target) {
        const position = rig.position.map((value, axis) => rig.target[axis] + (value - rig.target[axis]) * 0.5);
        await page.evaluate((pose) => window.__lupiViewerMcp.execute({ id: 'ink-close', tool: 'lupi.set_camera', arguments: pose }), { position, target: rig.target });
        for (const style of EXPORTED) {
          await setViewer(page, { inkStyle: style, backgroundPreset: 'paper-plate' });
          await waitInkRest(page, style);
          const close = await h.waitSettled(page, canvas, 0.01);
          await save(`${id}-${style}-close`, close.png);
          if (phone) {
            const device = await captureDevice(page, h, canvas);
            data.deviceScale = device.scale;
            await save(`${id}-${style}-close-device`, h.encodePng(device.image));
          }
        }
      }

      // 2. Exports of the two print shadings (raster bonds fail closed: hide them).
      if (phone) continue;
      const hidden = await setViewer(page, { showBonds: false });
      check(`${id}: bonds hide for the raster export`, hidden.ok, JSON.stringify(hidden.error));
      const specIds = new Set();
      for (const style of EXPORTED) {
        await setViewer(page, { inkStyle: style, backgroundPreset: 'paper-plate' });
        await waitInkRest(page, style);
        const out = await exportPng(page, h, `${id}-${style}`);
        let image = null;
        let painted = 0;
        if (out.ok && out.dataBase64) {
          const bytes = Buffer.from(out.dataBase64, 'base64');
          await save(`${id}-${style}-export`, bytes);
          image = h.decodePng(bytes);
          painted = h.foreground(image).fraction;
        }
        if (out.specId) specIds.add(out.specId);
        data.exports[style] = { ok: out.ok, error: out.error, specId: out.specId, artifactDigest: out.artifactDigest, size: image ? [image.width, image.height] : null, painted: h.pct(painted) };
        check(`${id}: ${style} PNG export succeeds`, out.ok && Boolean(out.dataBase64), JSON.stringify(out.error));
        check(`${id}: ${style} PNG decodes at 1024 × 1024 with painted pixels`, Boolean(image) && image.width === 1024 && image.height === 1024 && painted > 0.02, `painted=${h.pct(painted)}`);
      }
      check(`${id}: Engrave and Halftone exports have their own specId`, specIds.size === EXPORTED.length, [...specIds].join(' '));
    }
  },
};
