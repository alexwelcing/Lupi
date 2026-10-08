/**
 * contour.mjs - the Illustrate look's ink contour (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=contour --backend=both \
 *     --profile=desktop --strict-backend --out=.verify-artifacts/viewer-smoke/contour
 *
 * Every view is drawn twice: as the viewer draws it, and with `?contour=0`
 * (postprocess/inkContour.ts), the drawing before the contour.
 * 1. Space-filling caffeine (atom scale 2.6, bonds hidden) in Illustrate:
 *    the contour adds dark ink inside the silhouette (the meeting lines of
 *    the balls) and around it (the outer contour).
 * 2. Ball-and-stick C60 in Illustrate: the contour adds ink where sticks
 *    enter balls and around the cage.
 * 3. Caffeine in Sketch (hatched), for the eye.
 * 4. Exports of view 1 (PNG, bonds hidden): 2048x2048 (one tile at factor 2)
 *    decodes at its size, has another specId than the contour-less export
 *    (its spec records view.ink.contour) and differs from it; 2400x1600 (two
 *    tiles across at factor 2) shows no seam at the tile boundary column; a
 *    transparent 1024x1024 keeps its background clear and its molecule inked.
 */

// The Looks' plates: Illustrate on the sage plate, Sketch on paper.
const SPACE_FILLING = { inkStyle: 'flat', backgroundPreset: 'sage-plate', atomScale: 2.6, showBonds: false };
const BALL_AND_STICK = { inkStyle: 'flat', backgroundPreset: 'sage-plate', showBonds: true };
const SKETCH = { inkStyle: 'hatch', backgroundPreset: 'paper-plate', atomScale: 2.6, showBonds: false };
/** The export's own small-molecule boost would shrink the balls apart; keep them space-filling. */
const EXPORT_ATOM_SCALE = 2.6;

async function open(ctx, h, id, atoms, contour) {
  const { page, check, outcome } = ctx;
  const url = new URL(`?sim=${id}${contour ? '' : '&contour=0'}`, h.baseFor(page)).href;
  outcome.data.urls = [...(outcome.data.urls ?? []), url];
  await page.goto(url, { waitUntil: 'commit' });
  const loaded = await page.waitForFunction((expected) => {
    const status = window.__lupiViewerMcp?.status?.();
    return status?.moleculeLoaded === true && status.atomCount === expected && status.rendererBackend != null;
  }, atoms, { timeout: 60_000, polling: 100 }).then(() => true, () => false);
  if (!check(`${id} loads${contour ? '' : ' with ?contour=0'}`, loaded)) return null;
  const canvas = await h.mainCanvas(page);
  if (!check('viewer canvas is present', Boolean(canvas))) return null;
  await canvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
  return canvas;
}

async function setViewer(page, args) {
  return page.evaluate(async (input) => {
    const out = await window.__lupiViewerMcp.execute({ id: 'contour-view', tool: 'lupi.set_viewer', arguments: input });
    return { ok: out.ok, error: out.error ?? null };
  }, args);
}

/** The view drawn with and without the contour (same camera: the fit on load). */
async function drawPair(ctx, h, id, atoms, view, label) {
  const { page, check, save } = ctx;
  const shots = {};
  for (const contour of [true, false]) {
    const canvas = await open(ctx, h, id, atoms, contour);
    if (!canvas) return null;
    const set = await setViewer(page, view);
    if (!check(`${label}: set_viewer`, set.ok, JSON.stringify(set.error))) return null;
    // The look fades in over about half a second; wait until the screen holds still.
    await page.waitForTimeout(900);
    const settled = await h.waitSettled(page, canvas, 0.02);
    await save(`${label}-${contour ? 'contour' : 'before'}`, settled.png);
    shots[contour ? 'on' : 'off'] = settled.image;
  }
  return shots;
}

function luma(data, i) {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

/**
 * Pixels the contour inked: clearly darker with it than without it, and dark
 * (ink on paper reads mid-grey once the depth cue fades it). Interior ones
 * lie at least `inset` px inside the molecule's mask (the meeting lines).
 */
function inkAdded(h, on, off, inset = 6) {
  const { width: w, height: hgt } = on;
  const mask = h.foregroundMask(off);
  // Distance-limited erosion of the foreground mask (box, `inset` px).
  const inside = new Uint8Array(w * hgt);
  for (let y = inset; y < hgt - inset; y += 1) {
    for (let x = inset; x < w - inset; x += 1) {
      let all = 1;
      for (let dy = -inset; dy <= inset && all; dy += inset) {
        for (let dx = -inset; dx <= inset; dx += inset) {
          if (!mask[(y + dy) * w + x + dx]) { all = 0; break; }
        }
      }
      inside[y * w + x] = all;
    }
  }
  let added = 0;
  let interior = 0;
  let foreground = 0;
  for (let p = 0; p < w * hgt; p += 1) {
    if (mask[p]) foreground += 1;
    const i = p * 4;
    const a = luma(on.data, i);
    const b = luma(off.data, i);
    if (a < 130 && b - a > 35) {
      added += 1;
      if (inside[p]) interior += 1;
    }
  }
  return { added, interior, foreground, interiorShare: interior / Math.max(1, foreground) };
}

async function exportPng(page, h, width, height, label, transparent = false) {
  return h.withTimeout(page.evaluate(async ({ w, hgt, scale, id, clear }) => {
    const out = await window.__lupiViewerMcp.execute({
      id,
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: w, height: hgt, transparent: clear, atomScale: scale, timeoutMs: 170_000 },
    });
    return {
      ok: out.ok,
      error: out.error ?? null,
      specId: out.result?.asset?.specId ?? null,
      digest: out.result?.asset?.artifactDigest ?? null,
      base64: out.result?.asset?.dataBase64 ?? null,
    };
  }, { w: width, hgt: height, scale: EXPORT_ATOM_SCALE, id: `contour-${label}`, clear: transparent }), 200_000, `export ${label}`);
}

/** Mean absolute RGB difference between columns `a` and `b` of an image. */
function columnStep(image, a, b) {
  let sum = 0;
  for (let y = 0; y < image.height; y += 1) {
    const i = (y * image.width + a) * 4;
    const j = (y * image.width + b) * 4;
    sum += Math.abs(image.data[i] - image.data[j]) + Math.abs(image.data[i + 1] - image.data[j + 1])
      + Math.abs(image.data[i + 2] - image.data[j + 2]);
  }
  return sum / (image.height * 3);
}

export default {
  name: 'contour',
  profiles: ['desktop'],
  description: 'Illustrate draws meeting lines and an outer contour, live and in tiled exports, without seams.',

  async run(ctx, h) {
    const { page, check, save, outcome } = ctx;
    outcome.data.contour = {};
    // Every load starts from the defaults: no look remembered on the device
    // from the previous load (a new molecule keeps an Illustrate look).
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* storage blocked: nothing remembered either */
      }
    });

    // 1. Space-filling caffeine.
    const filled = await drawPair(ctx, h, 'caffeine', 24, SPACE_FILLING, 'caffeine-filled');
    if (!filled) return;
    const filledInk = inkAdded(h, filled.on, filled.off);
    outcome.data.contour.caffeine = filledInk;
    check(
      'space-filling caffeine: the contour inks meeting lines inside the silhouette',
      filledInk.interior > 150 && filledInk.interiorShare > 0.002,
      `interior ${filledInk.interior} px (${h.pct(filledInk.interiorShare)} of the molecule), all ${filledInk.added} px`,
    );
    check('space-filling caffeine: the contour adds ink overall', filledInk.added > filledInk.interior, `${filledInk.added} px`);

    // 2. Ball-and-stick C60.
    const cage = await drawPair(ctx, h, 'c60_buckyball', 60, BALL_AND_STICK, 'c60');
    if (!cage) return;
    const cageInk = inkAdded(h, cage.on, cage.off, 3);
    outcome.data.contour.c60 = cageInk;
    check('ball-and-stick C60: the contour adds ink', cageInk.added > 300, `${cageInk.added} px, interior ${cageInk.interior} px`);

    // 3. Sketch, for the eye.
    const sketch = await drawPair(ctx, h, 'caffeine', 24, SKETCH, 'caffeine-sketch');
    if (!sketch) return;
    const sketchInk = inkAdded(h, sketch.on, sketch.off);
    outcome.data.contour.sketch = sketchInk;
    check('Sketch caffeine: the contour adds ink', sketchInk.added > 150, `${sketchInk.added} px`);

    // 4. Exports of the space-filling view, without and then with the contour.
    if (!(await open(ctx, h, 'caffeine', 24, false))) return;
    await setViewer(page, SPACE_FILLING);
    await page.waitForTimeout(900);
    const before = await exportPng(page, h, 2048, 2048, 'before-2048');
    check('export 2048 without the contour', before.ok, JSON.stringify(before.error));

    if (!(await open(ctx, h, 'caffeine', 24, true))) return;
    await setViewer(page, SPACE_FILLING);
    await page.waitForTimeout(900);
    const square = await exportPng(page, h, 2048, 2048, 'contour-2048');
    if (!check('export 2048 with the contour', square.ok, JSON.stringify(square.error))) return;
    const squareImage = h.decodePng(Buffer.from(square.base64, 'base64'));
    check('2048 export decodes at its size', squareImage.width === 2048 && squareImage.height === 2048, `${squareImage.width}x${squareImage.height}`);
    check(
      'the contour export has its own specId (view.ink.contour)',
      Boolean(square.specId && before.specId && square.specId !== before.specId),
      `${square.specId} vs ${before.specId}`,
    );
    if (before.ok && before.base64) {
      const beforeImage = h.decodePng(Buffer.from(before.base64, 'base64'));
      const exportInk = inkAdded(h, squareImage, beforeImage, 12);
      outcome.data.contour.export2048 = exportInk;
      check('the 2048 export draws the contour', exportInk.interior > 600, `interior ${exportInk.interior} px, all ${exportInk.added} px`);
      await save('export-2048-before', h.encodePng(h.cropImage(beforeImage, { x: 512, y: 512, width: 1024, height: 1024 }, 1)));
    }
    await save('export-2048-contour', h.encodePng(h.cropImage(squareImage, { x: 512, y: 512, width: 1024, height: 1024 }, 1)));

    const wide = await exportPng(page, h, 2400, 1600, 'contour-2400');
    if (!check('export 2400x1600 with the contour', wide.ok, JSON.stringify(wide.error))) return;
    const wideImage = h.decodePng(Buffer.from(wide.base64, 'base64'));
    check('2400x1600 export decodes at its size', wideImage.width === 2400 && wideImage.height === 1600, `${wideImage.width}x${wideImage.height}`);
    // Two tiles of 1200 output px across: the boundary is between columns 1199 and 1200.
    const seam = columnStep(wideImage, 1199, 1200);
    const steps = [];
    for (let x = 1100; x < 1300; x += 1) if (x !== 1199) steps.push(columnStep(wideImage, x, x + 1));
    steps.sort((a, b) => a - b);
    const typical = steps[Math.floor(steps.length / 2)];
    const busiest = steps[steps.length - 1];
    outcome.data.contour.seam = { seam, typical, busiest };
    check(
      'no tile seam at the 2400x1600 boundary column',
      seam <= Math.max(busiest, typical * 3, 0.5),
      `step ${seam.toFixed(3)} at x=1199|1200, median ${typical.toFixed(3)}, max elsewhere ${busiest.toFixed(3)}`,
    );
    await save('export-2400-seam', h.encodePng(h.cropImage(wideImage, { x: 1000, y: 400, width: 400, height: 800 }, 1)));

    // Transparent output: the contour inks the molecule and leaves the background clear.
    const clear = await exportPng(page, h, 1024, 1024, 'contour-transparent', true);
    if (!check('transparent export with the contour', clear.ok, JSON.stringify(clear.error))) return;
    const clearImage = h.decodePng(Buffer.from(clear.base64, 'base64'));
    let opaque = 0;
    let inked = 0;
    for (let i = 0; i < clearImage.data.length; i += 4) {
      if (clearImage.data[i + 3] === 255) {
        opaque += 1;
        if (luma(clearImage.data, i) < 40) inked += 1;
      }
    }
    const corners = [0, 1023, 1023 * 1024, 1024 * 1024 - 1].map((p) => clearImage.data[p * 4 + 3]);
    outcome.data.contour.transparent = { opaque, inked, corners };
    check(
      'transparent export: clear background, inked molecule',
      corners.every((alpha) => alpha === 0) && opaque > 1000 && inked > 500,
      `corner alpha ${corners.join(',')}, ${opaque} opaque px, ${inked} of them ink`,
    );
    await save('export-transparent', h.encodePng(clearImage));
  },
};
