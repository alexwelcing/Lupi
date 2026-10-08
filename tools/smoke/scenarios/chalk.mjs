/**
 * chalk.mjs - Chalk, the Illustrate drawing made for the dark sage plate
 * (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=chalk --backend=both \
 *     --profile=desktop --strict-backend --out=.verify-artifacts/viewer-smoke/chalk
 *
 * On caffeine and C60, on the sage plate, lit, then Illustrate (flat), then
 * Chalk through `lupi.set_viewer { inkStyle }`:
 * 1. Chalk settles at its weight, paints the canvas, differs from the lit
 *    view and from the flat drawing, and a still view draws no frames (Quiet
 *    Idle: neither the strokes nor the board's tooth read time). The
 *    molecule's rim (its outermost pixels against the plate) is light chalk
 *    on the dark plate (the flat drawing's rim is recorded beside it: its
 *    ink is nearly the plate, so its rim reads as the fill inside).
 * 2. With bonds hidden, 1024 × 1024 PNG exports of flat and Chalk decode at
 *    size; Chalk's plate stays dark, its rim is light, and it gets its own
 *    specId (renderArtifactAdapter.test.ts checks view.ink.ink itself).
 * Every settled view and export is saved for a human to look at, with a
 * closer view of Chalk with bonds.
 */

const MOLECULES = ['caffeine', 'c60_buckyball'];
const PLATE = 'sage-plate';

const fraction = (h, a, b) => h.diffImages(a, b).changed / (a.width * a.height);
const luma = (data, i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];

function setViewer(page, args) {
  return page.evaluate(async (viewer) => {
    const out = await window.__lupiViewerMcp.execute({ id: `chalk-${JSON.stringify(viewer)}`, tool: 'lupi.set_viewer', arguments: viewer });
    return { ok: out.ok, error: out.error ?? null };
  }, args);
}

/** The ink driver's weights for a shading ('off' is lit). */
function weightsFor(style) {
  return {
    mix: style === 'off' ? 0 : 1,
    hatch: 0,
    engrave: 0,
    halftone: 0,
    chalk: style === 'chalk' ? 1 : 0,
  };
}

/** Wait until the ink driver has taken `style` as its target and rests there. */
function waitInkRest(page, style, maxMs = 45_000) {
  return page
    .waitForFunction((expected) => {
      const ink = window.__lupiPlay?.ink?.();
      if (!ink || ink.fading || ink.holding) return null;
      const at = (values) => Object.entries(expected).every(([key, value]) => values[key] === value);
      return at(ink.target) && at(ink) ? ink : null;
    }, weightsFor(style), { timeout: maxMs, polling: 50 })
    .then((handle) => handle.jsonValue(), () => page.evaluate(() => window.__lupiPlay?.ink?.() ?? null));
}

/** Frames drawn over `ms` of a still view. */
async function framesWhileStill(page, ms = 600) {
  const before = await page.evaluate(() => window.__lupiPlay?.state?.()?.frames ?? null);
  await page.waitForTimeout(ms);
  const after = await page.evaluate(() => window.__lupiPlay?.state?.()?.frames ?? null);
  return before === null || after === null ? null : after - before;
}

/**
 * The molecule's rim and the plate: the mean luminance (0..255) of the
 * foreground pixels that touch the plate, and of the four corners.
 */
function rimAndPlate(h, image) {
  const { width: w, height: hgt, data } = image;
  const mask = h.foregroundMask(image);
  let sum = 0;
  let count = 0;
  for (let y = 1; y < hgt - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const k = y * w + x;
      if (!mask[k]) continue;
      if (mask[k - 1] && mask[k + 1] && mask[k - w] && mask[k + w]) continue;
      sum += luma(data, k * 4);
      count += 1;
    }
  }
  const corners = [[2, 2], [w - 3, 2], [2, hgt - 3], [w - 3, hgt - 3]]
    .map(([x, y]) => luma(data, (y * w + x) * 4));
  return {
    rim: count > 0 ? sum / count : null,
    rimPixels: count,
    plate: corners.reduce((a, b) => a + b, 0) / corners.length,
  };
}

async function exportPng(page, h, label) {
  return h.withTimeout(page.evaluate(async (id) => {
    const out = await window.__lupiViewerMcp.execute({
      id,
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 1024, height: 1024, transparent: false, timeoutMs: 180_000 },
    });
    const asset = out.result?.asset;
    return {
      ok: out.ok,
      error: out.error ?? null,
      dataBase64: asset?.dataBase64 ?? null,
      specId: asset?.specId ?? null,
      artifactDigest: asset?.artifactDigest ?? null,
    };
  }, `chalk-export-${label}`), 240_000, `export ${label}`);
}

const round = (value) => (value === null ? null : Math.round(value));

export default {
  name: 'chalk',
  profiles: ['desktop'],
  description: 'Chalk draws light on the dark sage plate on caffeine and C60, rests still, and exports with its own specId.',

  async run(ctx, h) {
    const { page, check, save, outcome } = ctx;
    outcome.data.chalk = {};
    for (const id of MOLECULES) {
      const data = { views: {}, exports: {} };
      outcome.data.chalk[id] = data;
      const canvas = await h.openStructure(ctx, h.galleryEntry(id));
      if (!canvas) return;
      // A new molecule keeps the last look (and the device remembers it): start lit, with bonds.
      const reset = await setViewer(page, { inkStyle: 'off', showBonds: true, backgroundPreset: PLATE });
      check(`${id}: opens lit with bonds on the sage plate`, reset.ok, JSON.stringify(reset.error));
      await waitInkRest(page, 'off');
      const lit = await h.waitSettled(page, canvas, 0.01);
      await save(`${id}-lit`, lit.png);

      // 1. Flat, then Chalk, on the sage plate.
      const views = {};
      for (const style of ['flat', 'chalk']) {
        const applied = await setViewer(page, { inkStyle: style, backgroundPreset: PLATE });
        check(`${id}: set_viewer inkStyle ${style}`, applied.ok, JSON.stringify(applied.error));
        const ink = await waitInkRest(page, style);
        const expected = weightsFor(style);
        check(
          `${id}: ${style} rests at its weights`,
          Boolean(ink) && Object.entries(expected).every(([key, value]) => ink[key] === value),
          JSON.stringify(ink && { mix: ink.mix, chalk: ink.chalk, hatch: ink.hatch, engrave: ink.engrave, halftone: ink.halftone }),
        );
        const view = await h.waitSettled(page, canvas, 0.01);
        await save(`${id}-${style}`, view.png);
        views[style] = view;
        const assessed = await h.assessRender(page, canvas, view.image, 0.01);
        const still = await framesWhileStill(page);
        const tones = rimAndPlate(h, view.image);
        data.views[style] = {
          settled: view.meta,
          changed: h.pct(fraction(h, lit.image, view.image)),
          foreground: h.pct(assessed.foregroundFraction),
          distinctColors: assessed.distinctColors,
          stillFrames: still,
          rim: round(tones.rim),
          plate: round(tones.plate),
        };
        if (style !== 'chalk') continue;
        const fromLit = fraction(h, lit.image, view.image);
        const fromFlat = fraction(h, views.flat.image, view.image);
        check(`${id}: chalk paints the canvas`, assessed.nonBlank && assessed.foregroundFraction > 0.01, `fg=${h.pct(assessed.foregroundFraction)} colours=${assessed.distinctColors}`);
        check(`${id}: chalk differs from the lit view`, fromLit > 0.02, `changed=${h.pct(fromLit)}`);
        check(`${id}: chalk differs from the flat drawing`, fromFlat > 0.02, `changed=${h.pct(fromFlat)}`);
        check(`${id}: chalk at rest draws no frames`, still === 0, `frames=${still}`);
        check(
          `${id}: chalk's rim is light on the dark plate`,
          tones.rim !== null && tones.plate < 50 && tones.rim > tones.plate + 70,
          `rim=${round(tones.rim)} plate=${round(tones.plate)} (flat rim=${data.views.flat.rim})`,
        );
      }

      // A closer look at Chalk with bonds, for a human.
      const rig = await page.evaluate(() => window.__lupiPlay?.state?.()?.rig ?? null);
      if (rig?.position && rig?.target) {
        const position = rig.position.map((value, axis) => rig.target[axis] + (value - rig.target[axis]) * 0.5);
        await page.evaluate((pose) => window.__lupiViewerMcp.execute({ id: 'chalk-close', tool: 'lupi.set_camera', arguments: pose }), { position, target: rig.target });
        const close = await h.waitSettled(page, canvas, 0.01);
        await save(`${id}-chalk-close`, close.png);
        await page.evaluate(() => window.__lupiViewerMcp.execute({ id: 'chalk-fit', tool: 'lupi.fit_camera', arguments: {} }));
      }

      // 2. Exports of flat and Chalk (raster bonds fail closed: hide them).
      const hidden = await setViewer(page, { showBonds: false });
      check(`${id}: bonds hide for the raster export`, hidden.ok, JSON.stringify(hidden.error));
      const exported = {};
      for (const style of ['flat', 'chalk']) {
        await setViewer(page, { inkStyle: style, backgroundPreset: PLATE });
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
        const tones = image ? rimAndPlate(h, image) : { rim: null, plate: null, rimPixels: 0 };
        exported[style] = { out, image, tones };
        data.exports[style] = {
          ok: out.ok,
          error: out.error,
          specId: out.specId,
          artifactDigest: out.artifactDigest,
          size: image ? [image.width, image.height] : null,
          painted: h.pct(painted),
          rim: round(tones.rim),
          plate: round(tones.plate),
        };
        check(`${id}: ${style} PNG export succeeds`, out.ok && Boolean(out.dataBase64), JSON.stringify(out.error));
        check(`${id}: ${style} PNG decodes at 1024 × 1024 with painted pixels`, Boolean(image) && image.width === 1024 && image.height === 1024 && painted > 0.02, `painted=${h.pct(painted)}`);
      }
      const chalk = exported.chalk.tones;
      check(
        `${id}: the chalk export has light ink on the dark plate`,
        chalk.rim !== null && chalk.plate < 50 && chalk.rim > chalk.plate + 70,
        `rim=${round(chalk.rim)} plate=${round(chalk.plate)} (flat rim=${round(exported.flat.tones.rim)})`,
      );
      check(
        `${id}: the chalk export has its own specId`,
        Boolean(exported.chalk.out.specId) && Boolean(exported.flat.out.specId) && exported.chalk.out.specId !== exported.flat.out.specId,
        `${exported.flat.out.specId} ${exported.chalk.out.specId}`,
      );
    }
  },
};
