/**
 * fuse.mjs - the Light Fuse: ink turns to light along the molecule's own
 * bonds (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=fuse --backend=both \
 *     --profile=desktop --strict-backend --out=.verify-artifacts/viewer-smoke/fuse
 *
 * For C60 and caffeine, opened lit:
 * 1. References: the lit view, and the plain ink view reached through
 *    lupi.set_viewer { inkStyle } (an agent's change crossfades: no fuse).
 * 2. Clicking an atom selects it; the `I` key then fuses from that atom
 *    (__lupiPlay.ink().fuse names it, mode 'graph'). The frames the screen
 *    presented while it burned (CDP screencast, started before the key) are
 *    part lit and part ink (each pixel is classified near the lit or near the
 *    ink reference), the inked share grows, and the end matches the plain
 *    ink view. A software renderer presents a frame or two a second, so this
 *    fuse runs six times slower (__lupiPlay.ink('pace', 6)).
 * 3. A filmstrip of the light coming on from the selected atom: `I` again,
 *    with the front held at 0, 0.2 ... 0.8 (__lupiPlay.ink('hold', p), armed
 *    before the key), then the end. Saved as
 *    <backend>-desktop-fuse-filmstrip-<id>.png.
 * 4. C60 only, bonds hidden and no selection: lupi.export_asset taken with
 *    the front held halfway has the artifactDigest of the export taken after
 *    the fuse (captures render the configured look, never a fuse).
 * 5. Quiet Idle: once the fuse is over the frame counter stands still.
 * 6. Ink-to-Light: a tap on the home hero opens C60 in ink, and the light
 *    comes on as a fuse (mode 'graph', arrival) from the centre-front atom,
 *    ending lit.
 * Under Motion: Still (--reduced-motion) no fuse burns: the toggle cuts the
 * look between two frames each way, the end still matches the ink view, and
 * the hero opens C60 lit, with no Ink-to-Light (steps 3 and 4 have no fuse
 * to hold).
 * On a phone (phone390) the toggle is the Play tray's Look row (Ink, Lit)
 * instead of the `I` key, and the hero takes a tap. The atom is picked
 * before the references are drawn: the phone's atom card makes room, so the
 * molecule sits lower while it is open, and the fuse burns under that view
 * inset.
 */

const MOLECULES = ['c60_buckyball', 'caffeine'];
const HIDE_ID = 'fuse-hide-chrome';

const ink = (page, ...args) => page.evaluate((a) => window.__lupiPlay?.ink?.(...a) ?? null, args);

/**
 * The UI's ink toggle: the `I` key on the desktop; on a phone the Play
 * tray's Look row, Ink or Lit (DOM clicks, as a tap runs them: the chrome is
 * hidden from the screenshots while the fuse is filmed).
 */
async function toggleLook(page, h, touch) {
  if (!touch) {
    await page.keyboard.press('i');
    return;
  }
  const opened = await page.evaluate(() => {
    const button = document.querySelector('[data-lupi-pill] button[aria-haspopup="menu"]');
    if (!document.querySelector('[data-lupi-pill] [role="menu"]')) button?.click();
    return Boolean(button);
  });
  if (!opened) throw new Error('the Play pill is missing');
  await page.waitForFunction(() => Boolean(document.querySelector('[data-lupi-pill] [role="menu"]')), null, { timeout: 8_000 });
  await page.evaluate(() => {
    const label = window.__lupiViewerMcp.state().inkStyle === 'off' ? 'Ink' : 'Lit';
    const items = [...document.querySelectorAll('[data-lupi-pill] [role="menu"] [role="menuitemradio"]')];
    items.find((item) => item.textContent.trim() === label)?.click();
  });
  await h.sleep(50);
}

async function mcp(page, tool, args) {
  return page.evaluate(({ name, input }) => window.__lupiViewerMcp.execute({ id: `fuse-${name}`, tool: name, arguments: input }), { name: tool, input: args });
}

async function setChromeHidden(page, hidden, css) {
  await page.evaluate(({ on, id, text }) => {
    document.getElementById(id)?.remove();
    if (!on) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = text;
    document.head.appendChild(style);
  }, { on: hidden, id: HIDE_ID, text: css });
}

/** Wait until the look has stopped changing: no fade and no fuse running. */
async function lookAtRest(page, h, maxMs = 15_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const state = await ink(page);
    if (state && !state.fading && !state.fuse?.running && !state.holding) return true;
    await h.sleep(100);
  }
  return false;
}

/** Wait until a fuse is burning (the key reaches the viewer a frame or more after it is pressed). */
async function fuseStarted(page, h, maxMs = 30_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const state = await ink(page);
    if (state?.fuse?.running) return state;
    await h.sleep(50);
  }
  return ink(page);
}

/** Wait until the camera rests and the loop has stopped drawing (Quiet Idle), so a reference is the settled view. */
async function viewAtRest(page, h, maxMs = 30_000) {
  const deadline = Date.now() + maxMs;
  let last = null;
  while (Date.now() < deadline) {
    const play = await h.readPlay(page);
    const frames = play?.frames ?? null;
    if (play && play.rig?.moving !== true && frames !== null && frames === last) return true;
    last = frames;
    await h.sleep(700);
  }
  return false;
}

/**
 * Each frame against the lit and ink references: of the pixels where the two
 * differ clearly, the share that sits near the lit one and near the ink one
 * (the projection onto lit→ink below 0.3, above 0.7).
 */
function classify(frame, lit, inked) {
  let considered = 0;
  let nearLit = 0;
  let nearInk = 0;
  const { data } = frame;
  for (let i = 0; i < data.length; i += 4) {
    const dr = inked.data[i] - lit.data[i];
    const dg = inked.data[i + 1] - lit.data[i + 1];
    const db = inked.data[i + 2] - lit.data[i + 2];
    const span = dr * dr + dg * dg + db * db;
    if (span < 40 * 40) continue;
    considered += 1;
    const t = ((data[i] - lit.data[i]) * dr + (data[i + 1] - lit.data[i + 1]) * dg + (data[i + 2] - lit.data[i + 2]) * db) / span;
    if (t < 0.3) nearLit += 1;
    else if (t > 0.7) nearInk += 1;
  }
  return { considered, lit: considered ? nearLit / considered : 0, ink: considered ? nearInk / considered : 0 };
}

/** Start a CDP screencast; the returned stop resolves every presented frame as { at (epoch ms), png }. */
async function screencast(page, h) {
  const client = await h.cdpFor(page);
  const frames = [];
  const onFrame = ({ data, metadata, sessionId }) => {
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    frames.push({ at: Number.isFinite(metadata?.timestamp) ? metadata.timestamp * 1000 : Date.now(), png: Buffer.from(data, 'base64') });
  };
  client.on('Page.screencastFrame', onFrame);
  const viewport = page.viewportSize();
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, ...(viewport ? { maxWidth: viewport.width, maxHeight: viewport.height } : {}) });
  return async () => {
    await h.sleep(150);
    client.off('Page.screencastFrame', onFrame);
    await client.send('Page.stopScreencast').catch(() => {});
    return frames.sort((a, b) => a.at - b.at);
  };
}

/** The molecule's box in an image (pixels away from the corner's plate), with a margin. */
function moleculeBox(image, margin = 16) {
  const { width, height, data } = image;
  const plate = [data[0], data[1], data[2]];
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (Math.abs(data[i] - plate[0]) + Math.abs(data[i + 1] - plate[1]) + Math.abs(data[i + 2] - plate[2]) < 60) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width, height };
  const x = Math.max(0, minX - margin);
  const y = Math.max(0, minY - margin);
  return { x, y, width: Math.min(width, maxX + margin + 1) - x, height: Math.min(height, maxY + margin + 1) - y };
}

/** Side by side, one row. */
function filmstrip(h, images) {
  const width = images.reduce((sum, image) => sum + image.width, 0);
  const height = Math.max(...images.map((image) => image.height));
  const data = new Uint8Array(width * height * 4);
  let x0 = 0;
  for (const image of images) {
    for (let y = 0; y < image.height; y += 1) {
      data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), (y * width + x0) * 4);
    }
    x0 += image.width;
  }
  return h.encodePng({ width, height, data });
}

async function exportDigest(page, h, label) {
  return h.withTimeout(page.evaluate(async (id) => {
    const out = await window.__lupiViewerMcp.execute({
      id,
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256, transparent: false, timeoutMs: 45_000 },
    });
    return { ok: out.ok, error: out.error ?? null, digest: out.result?.asset?.artifactDigest ?? null };
  }, `fuse-${label}`), 120_000, `export ${label}`);
}

async function runMolecule(ctx, h, id) {
  const { page, spec, check, save, outcome } = ctx;
  const touch = h.isTouchProfile(spec.profile);
  const data = (outcome.data[id] = {});
  const canvas = await h.openStructure(ctx, h.galleryEntry(id));
  if (!canvas) return;
  await lookAtRest(page, h);
  await viewAtRest(page, h);

  // 1. References (on a phone, with the atom card open: it moves the molecule).
  let lit = await h.waitSettled(page, canvas, 0.01);
  if (touch) {
    await h.pickAtom(ctx, canvas, lit.image);
    await viewAtRest(page, h);
    data.inset = await page.evaluate(() => window.__lupiPlay?.viewInset?.() ?? null);
    lit = await h.waitSettled(page, canvas, 0.01);
  }
  await save(`${id}-lit`, lit.png);
  const toInk = await mcp(page, 'lupi.set_viewer', { inkStyle: 'flat' });
  const afterMcp = await ink(page);
  check(`${id}: an agent's inkStyle change crossfades, no fuse`, toInk.ok && afterMcp?.fuse?.running === false, JSON.stringify(afterMcp?.fuse));
  await lookAtRest(page, h);
  await viewAtRest(page, h);
  const inked = await h.waitSettled(page, canvas, 0.01);
  await save(`${id}-ink`, inked.png);
  await mcp(page, 'lupi.set_viewer', { inkStyle: 'off' });
  await lookAtRest(page, h);
  await h.waitSettled(page, canvas, 0.01);

  // 2. Select an atom, then `I`: the fuse from it, sampled as presented.
  if (!touch) await h.pickAtom(ctx, canvas, lit.image);
  const picked = Number.parseInt(outcome.data.pick?.card?.atomIndex ?? '', 10);
  data.picked = Number.isFinite(picked) ? picked : null;
  await lookAtRest(page, h);
  if (ctx.options.reducedMotion) {
    await stillToggles(ctx, h, id, canvas, { lit, inked, touch, data });
    return;
  }
  const box = await canvas.boundingBox();
  const viewport = page.viewportSize();
  await setChromeHidden(page, true, h.HIDE_CHROME_CSS);
  await h.sleep(300);
  // A fuse paced for the lane's frame rate (SwiftShader WebGPU presents a frame every second or two).
  await ink(page, 'pace', spec.backend === 'webgpu' ? 20 : 6);
  const stop = await screencast(page, h);
  await h.sleep(400);
  const pressedAt = Date.now();
  await toggleLook(page, h, touch);
  const burning = await fuseStarted(page, h);
  await lookAtRest(page, h, 60_000);
  await h.sleep(600);
  const frames = (await stop()).filter((frame) => frame.at >= pressedAt - 300);
  await ink(page, 'pace', 1);
  await setChromeHidden(page, false);
  const started = await ink(page);
  data.started = started?.fuse ?? null;
  check(`${id}: ${touch ? "the tray's Ink" : 'the I key'} fuses from the selected atom`, burning?.fuse?.running === true && started?.fuse?.seed === data.picked && started.fuse.progress === 1, `fuse ${JSON.stringify(started?.fuse)} picked #${data.picked}`);
  check(`${id}: the fuse follows the bond graph`, started?.fuse?.mode === 'graph', String(started?.fuse?.mode));
  const crop = ({ png }) => {
    const full = h.decodePng(png);
    const scale = full.width / (viewport?.width ?? full.width);
    return h.cropImage(full, { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.floor(box.width), height: Math.floor(box.height) }, scale);
  };
  const timeline = frames.map((frame) => ({ t: Math.round(frame.at - pressedAt), ...classify(crop(frame), lit.image, inked.image) }));
  data.timeline = timeline;
  const mixed = timeline.filter((row) => row.lit >= 0.08 && row.ink >= 0.08);
  const shown = timeline.map((row) => `${row.t}ms lit ${h.pct(row.lit)} ink ${h.pct(row.ink)}`).join('; ');
  check(`${id}: frames presented mid-fuse are part lit and part ink`, mixed.length > 0, `${frames.length} frames: ${shown}`);
  const first = timeline[0];
  const last = timeline.at(-1);
  check(`${id}: the inked share grows over the fuse`, Boolean(first && last) && last.ink > first.ink + 0.5, first && last ? `${h.pct(first.ink)} -> ${h.pct(last.ink)}` : 'no frames');
  const middle = mixed[Math.floor(mixed.length / 2)];
  if (middle) await save(`${id}-mid-fuse`, h.encodePng(crop(frames[timeline.indexOf(middle)])));
  const end = await h.waitSettled(page, canvas, 0.01);
  await save(`${id}-fused-ink`, end.png);
  const endDiff = h.diffImages(end.image, inked.image).changed / (end.image.width * end.image.height);
  const endClass = classify(end.image, lit.image, inked.image);
  check(`${id}: the end of the fuse matches the plain ink view`, endClass.ink > 0.95 && endDiff < 0.03, `changed ${h.pct(endDiff)}, near ink ${h.pct(endClass.ink)}`);
  const after = await ink(page);
  check(`${id}: __lupiPlay.ink().fuse reports the finished fuse`, after?.fuse?.running === false && after.fuse.progress === 1 && after.fuse.seed === data.picked, JSON.stringify(after?.fuse));

  // 3. The light coming on from the same atom, held at steps for a filmstrip.
  const strip = [];
  await ink(page, 'hold', 0);
  await toggleLook(page, h, touch);
  await fuseStarted(page, h);
  for (const p of [0, 0.2, 0.4, 0.6, 0.8]) {
    await ink(page, 'hold', p);
    const held = await h.waitSettled(page, canvas, 0.01, 8_000);
    strip.push(held.image);
  }
  const heldState = await ink(page);
  data.held = heldState?.fuse ?? null;
  const steps = strip.map((image) => classify(image, lit.image, inked.image));
  data.steps = steps;
  const partly = steps.slice(1).some((step) => step.lit >= 0.05 && step.ink >= 0.05);
  const shownSteps = steps.map((step, i) => `${(i * 0.2).toFixed(1)}: lit ${h.pct(step.lit)} ink ${h.pct(step.ink)}`).join('; ');
  check(`${id}: a held fuse stands at its front (light partly on)`, heldState?.fuse?.held === true && heldState.fuse.running === true && partly, shownSteps);
  // Held at 0 the drawing is whole (the post recipe is already back, so it is not the plain ink view).
  const spreads = steps.every((step, i) => i === 0 || step.lit >= steps[i - 1].lit - 0.01) && steps[0].ink > 0.8;
  check(`${id}: the light spreads as the front advances`, spreads, shownSteps);
  await ink(page, 'release');
  await lookAtRest(page, h);
  const lightOn = await h.waitSettled(page, canvas, 0.01);
  strip.push(lightOn.image);
  const around = moleculeBox(lit.image);
  await save(`filmstrip-${id}`, filmstrip(h, strip.map((image) => h.cropImage(image, around, 1))));
  const litAgain = classify(lightOn.image, lit.image, inked.image);
  check(`${id}: the light fuse ends lit`, litAgain.lit > 0.95, `near lit ${h.pct(litAgain.lit)}`);

  // 5. Quiet Idle once it is over (the selection pulse rests after 2.4 s).
  await h.sleep(3_000);
  const framesA = (await h.readPlay(page))?.frames ?? null;
  await h.sleep(1_500);
  const framesB = (await h.readPlay(page))?.frames ?? null;
  check(`${id}: no frames drawn once the fuse is over`, framesA !== null && framesB !== null && framesB - framesA <= 2, `${framesA} -> ${framesB}`);
}

/** Every ink() reading for each animation frame while `act` runs and the look settles. */
async function recordLook(page, h, act) {
  await page.evaluate(() => {
    const rec = (window.__lookSmoke = { rows: [], on: true });
    const tick = () => {
      if (!rec.on) return;
      const state = window.__lupiPlay?.ink?.();
      if (state) rec.rows.push({ mix: state.mix, fading: state.fading, fuse: state.fuse?.running ?? false });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  await lookAtRest(page, h);
  await h.sleep(600);
  return page.evaluate(() => {
    window.__lookSmoke.on = false;
    return window.__lookSmoke.rows;
  });
}

/** Still: the UI toggle cuts both ways (no fuse, no fade, no frame between the looks). */
async function stillToggles(ctx, h, id, canvas, { lit, inked, touch, data }) {
  const { page, check, save } = ctx;
  for (const [label, to, reference] of [['ink', 1, inked], ['lit', 0, lit]]) {
    const rows = await recordLook(page, h, () => toggleLook(page, h, touch));
    const between = rows.filter((row) => row.mix > 0.001 && row.mix < 0.999).length;
    const burned = rows.some((row) => row.fuse || row.fading);
    const last = rows.at(-1)?.mix ?? null;
    data[`still-${label}`] = { rows: rows.length, between, burned, last };
    check(`${id}: Still: the toggle to ${label} cuts (no fuse, no fade)`, !burned && between === 0 && last === to, JSON.stringify(data[`still-${label}`]));
    const shown = await h.waitSettled(page, canvas, 0.01);
    await save(`${id}-still-${label}`, shown.png);
    const near = classify(shown.image, lit.image, inked.image);
    check(`${id}: Still: the ${label} view matches its reference`, (to === 1 ? near.ink : near.lit) > 0.95, `near lit ${h.pct(near.lit)}, near ink ${h.pct(near.ink)}`);
  }
  await h.sleep(3_000);
  const framesA = (await h.readPlay(page))?.frames ?? null;
  await h.sleep(1_500);
  const framesB = (await h.readPlay(page))?.frames ?? null;
  check(`${id}: Still: no frames drawn once the look has cut`, framesA !== null && framesB !== null && framesB - framesA <= 2, `${framesA} -> ${framesB}`);
}

async function exportMidFuse(ctx, h) {
  const { page, spec, check, outcome } = ctx;
  const canvas = await h.openStructure(ctx, h.galleryEntry('c60_buckyball'));
  if (!canvas) return;
  await lookAtRest(page, h);
  const hide = await mcp(page, 'lupi.set_viewer', { showBonds: false });
  check('bonds hidden for a deterministic raster export', hide.ok, JSON.stringify(hide.error));
  await h.waitSettled(page, canvas, 0.01);
  // The fuse with nothing selected starts at the centre-front atom.
  await ink(page, 'hold', 0.5);
  await toggleLook(page, h, h.isTouchProfile(spec.profile));
  await fuseStarted(page, h);
  await h.waitSettled(page, canvas, 0.01, 8_000);
  const held = await ink(page);
  const mid = await exportDigest(page, h, 'mid-fuse');
  const during = await ink(page);
  await ink(page, 'release');
  await lookAtRest(page, h);
  const after = await exportDigest(page, h, 'after-fuse');
  outcome.data.exports = { held: held?.fuse ?? null, during: during?.fuse ?? null, mid, after };
  check('the spatial fuse (bonds hidden) runs from the centre-front atom', held?.fuse?.running === true && held.fuse.mode === 'spatial' && Number.isInteger(held.fuse.seed), JSON.stringify(held?.fuse));
  check('an export taken mid-fuse has the artifactDigest of the export after it', Boolean(mid.ok && after.ok && mid.digest) && mid.digest === after.digest && during?.fuse?.held === true, `${mid.digest} vs ${after.digest} ${JSON.stringify(mid.error ?? after.error)}`);
  // The device remembers the look and the bonds: back to lit, with bonds, for Ink-to-Light.
  await mcp(page, 'lupi.set_viewer', { inkStyle: 'off', showBonds: true });
  await lookAtRest(page, h);
  await viewAtRest(page, h);
}

async function inkToLight(ctx, h) {
  const { page, spec, check, outcome, options } = ctx;
  await page.goto(h.baseFor(page).href, { waitUntil: 'load', timeout: options.timeout });
  const hero = page.locator('.bucky-hero__stage');
  await hero.waitFor({ state: 'visible', timeout: options.timeout });
  // Page side: every change of __lupiPlay.ink().fuse from the tap on.
  await page.evaluate(() => {
    const seen = [];
    window.__fuseLog = seen;
    let last = '';
    setInterval(() => {
      const state = window.__lupiPlay?.ink?.();
      if (!state) return;
      const row = { running: state.fuse?.running, mode: state.fuse?.mode, seed: state.fuse?.seed, arrival: state.arrival, holding: state.holding, mix: Math.round(state.mix * 100) / 100 };
      const key = JSON.stringify(row);
      if (key !== last) {
        last = key;
        seen.push(row);
      }
    }, 20);
  });
  const box = await hero.boundingBox();
  if (h.isTouchProfile(spec.profile)) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const settled = await page.waitForFunction((still) => {
    const log = window.__fuseLog ?? [];
    const state = window.__lupiPlay?.ink?.();
    const opened = window.__lupiViewerMcp?.status?.()?.atomCount === 60 && window.__lupiPlay?.state?.()?.firstFrame === true;
    return (still ? opened : log.some((row) => row.running)) && state && !state.fuse?.running && !state.holding && state.mix === 0;
  }, options.reducedMotion, { timeout: 90_000, polling: 100 }).then(() => true, () => false);
  const log = await page.evaluate(() => window.__fuseLog ?? []);
  outcome.data.inkToLight = { log };
  const burned = log.find((row) => row.running);
  if (options.reducedMotion) {
    check('Still: the hero opens C60 lit, with no Ink-to-Light', settled && !log.some((row) => row.holding || row.running || row.mix > 0), `${spec.backend}: ${JSON.stringify(log.slice(0, 4))}`);
    return;
  }
  check('Ink-to-Light: the hero opens C60 in ink', log.some((row) => row.holding && row.mix === 1), JSON.stringify(log.slice(0, 3)));
  check('Ink-to-Light: the light comes on as a fuse along the bonds', Boolean(burned) && burned.arrival === true && burned.mode === 'graph' && Number.isInteger(burned.seed), JSON.stringify(burned ?? log.at(-1)));
  check('Ink-to-Light: it ends lit', settled, `${spec.backend}: ${JSON.stringify(log.at(-1))}`);
}

export default {
  name: 'fuse',
  profiles: ['desktop', 'phone390'],
  description: 'The Light Fuse: ink turns to light along the bonds from a seed atom (C60, caffeine); exports never see it.',

  async run(ctx, h) {
    for (const id of MOLECULES) await runMolecule(ctx, h, id);
    // Still: no fuse to hold halfway through an export.
    if (!ctx.options.reducedMotion) await exportMidFuse(ctx, h);
    await inkToLight(ctx, h);
  },
};
