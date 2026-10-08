/**
 * morph.mjs - the morph arrival in the real viewer (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=morph --backend=both \
 *     --profile=desktop --strict-backend --out=.verify-artifacts/viewer-smoke/morph
 *
 * On /?sim=c60_buckyball, through the molecule switcher (key 7, type a name,
 * pick the row, as a visitor does):
 * 1. C60 -> caffeine morphs: the arrival is a morph, its plan reports 8
 *    carbons from carbons and 16 atoms from other elements, frames in the
 *    middle differ from C60 before the switch and from the landed caffeine,
 *    and it lands. The frames are saved as morph-c60-caffeine-<n>.png.
 * 2. lupi.export_asset PNG (bonds hidden) while morphs are kept live
 *    (__lupiPlay.morph() replays the last one) has the artifactDigest of the
 *    export at rest.
 * 3. caffeine -> water morphs too (frames saved as morph-caffeine-water-<n>.png).
 * 4. With Motion: Still (prefers-reduced-motion), water -> benzene does not morph.
 * 5. The landed caffeine matches a plain open of caffeine at the same camera.
 * Under --reduced-motion the whole run is Still: the first switch must not morph.
 * On a phone (phone390) the switcher is the command deck's Switch sheet (a
 * tap), which stays open while the molecule switches, so the morph plays
 * under the sheet's view inset; closing it gives the view back.
 * A software renderer presents a few frames a second, so frames are read from
 * a CDP screencast against a page-side timeline of __lupiPlay.state().motion.
 */

const START = 'c60_buckyball';
const HIDE_ID = 'morph-hide-chrome';

/** Page-side: record every change of the arrival and the morph report, per frame. */
function installRecorder() {
  const rec = { log: [], ticks: 0, last: '' };
  window.__morph = rec;
  const now = () => performance.timeOrigin + performance.now();
  const tick = () => {
    rec.ticks += 1;
    const state = window.__lupiPlay?.state?.() ?? null;
    rec.frames = state?.frames ?? 0;
    const motion = state?.motion ?? null;
    const morph = motion?.morph ?? null;
    const entry = {
      arrival: motion?.arrival ?? null,
      active: motion?.active ?? false,
      morph: morph ? { running: morph.running, planned: morph.planned } : null,
    };
    const key = JSON.stringify(entry);
    if (key !== rec.last) {
      rec.last = key;
      rec.log.push({ t: now(), tick: rec.ticks, ...entry, report: motion?.lastMorph ?? null });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
  const stop = async () => {
    await h.sleep(150);
    client.off('Page.screencastFrame', onFrame);
    await client.send('Page.stopScreencast').catch(() => {});
    return frames.sort((a, b) => a.at - b.at);
  };
  stop.count = () => frames.length;
  return stop;
}

async function cropFrames(page, canvas, frames, h) {
  const box = await canvas.boundingBox();
  const viewport = page.viewportSize();
  return frames.map(({ at, png }) => {
    const full = h.decodePng(png);
    const scale = full.width / (viewport?.width ?? full.width);
    const rect = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.floor(box.width), height: Math.floor(box.height) };
    return { at, image: h.cropImage(full, rect, scale) };
  });
}

const fraction = (h, a, b) => h.diffImages(a, b).changed / (a.width * a.height);

/** Open the switcher (key 7; on a phone the deck's Switch sheet) and wait for the row that switches to `title`. */
async function findRow(page, title, touch) {
  const open = await page.evaluate(() => Boolean(document.querySelector('input[aria-label="Switch molecule"]')));
  if (!open && touch) await page.getByRole('button', { name: 'Switch command', exact: true }).tap();
  else if (!open) await page.keyboard.press('7');
  const input = page.locator('input[aria-label="Switch molecule"]').first();
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill(title.toLowerCase());
  const row = page.locator(`button[aria-label="Switch to ${title}"]`).first();
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  return row;
}

/**
 * Switch to `title` through the switcher row, recording the screen and the
 * motion timeline until the arrival has landed (or, without one, until the
 * viewer has drawn `quietFrames` more frames after the load: a loaded
 * software renderer can take seconds a frame, and the page's own
 * requestAnimationFrame keeps ticking while the GPU is busy, so drawn
 * frames count, not wall time or page ticks).
 */
async function switchTo(ctx, h, canvas, title, atoms, { quietFrames = 12 } = {}) {
  const { page, spec } = ctx;
  await findRow(page, title, h.isTouchProfile(spec.profile));
  await page.evaluate(() => {
    window.__morph.log = [];
    window.__morph.last = '';
  });
  // What the screen shows before the switch (chrome hidden, the switcher open).
  const before = await h.captureCanvas(page, canvas);
  await setChromeHidden(page, true, h.HIDE_CHROME_CSS);
  const stop = await screencast(page, h);
  // Two presented frames, so the screencast already shows the chrome hidden.
  for (let waited = 0; stop.count() < 2 && waited < 20_000; waited += 100) await page.waitForTimeout(100);
  await page.waitForTimeout(400);
  // A DOM click: the row's own handler, as a tap would run it (the row is hidden from the screenshots).
  const clickedAt = await page.evaluate((label) => {
    document.querySelector(`button[aria-label="Switch to ${label}"]`)?.click();
    return performance.timeOrigin + performance.now();
  }, title);
  const loaded = await page.waitForFunction((n) => window.__lupiViewerMcp?.status?.()?.atomCount === n, atoms, { timeout: 60_000, polling: 50 }).then(() => true, () => false);
  const loadFrame = await page.evaluate(() => window.__lupiPlay?.state?.()?.frames ?? 0);
  // Landed: the log saw an arrival and then none; or no arrival for quietFrames drawn frames.
  await page.waitForFunction(({ from, quiet }) => {
    const log = window.__morph.log;
    const arrived = log.some((entry) => entry.arrival);
    const last = log.at(-1);
    if (arrived) return Boolean(last) && last.arrival === null;
    return (window.__lupiPlay?.state?.()?.frames ?? 0) - from > quiet;
  }, { from: loadFrame, quiet: quietFrames }, { timeout: 180_000, polling: 100 }).catch(() => {});
  await page.waitForTimeout(1_500);
  const frames = await cropFrames(page, canvas, await stop(), h);
  await setChromeHidden(page, false, '');
  const log = await page.evaluate(() => window.__morph.log);
  const ticks = await page.evaluate(() => window.__morph.ticks);
  return { loaded, clickedAt, before: before.image, frames, log, ticks };
}

/** The frames of one switch: before it, while the morph shows, and landed. */
function morphWindow(run, h) {
  const { frames, log } = run;
  const armed = log.find((entry) => entry.arrival === 'armed morph') ?? null;
  const released = log.find((entry) => entry.arrival === 'morph') ?? null;
  const landed = released ? log.find((entry) => entry.t > released.t && entry.arrival === null) ?? null : null;
  const before = { at: run.clickedAt, image: run.before };
  const from = armed?.t ?? released?.t ?? null;
  const live = from != null && landed ? frames.filter((f) => f.at > from && f.at < landed.t) : [];
  const rest = frames.at(-1);
  // The frames that show the morph itself: neither the old molecule nor the landed one.
  const between = live.filter((f) => fraction(h, f.image, before.image) > 0.01 && fraction(h, f.image, rest.image) > 0.01);
  return { armed, released, landed, before, live, between, rest, report: landed?.report ?? released?.report ?? null };
}

/** Up to `n` frames: before the switch, evenly spread morph frames, landed. */
function strip(win, n) {
  const pick = [win.before];
  const mid = win.between;
  const inner = Math.min(Math.max(0, n - 2), mid.length);
  for (let i = 0; i < inner; i += 1) {
    const at = mid[Math.round((i * (mid.length - 1)) / Math.max(1, inner - 1))];
    if (!pick.includes(at)) pick.push(at);
  }
  pick.push(win.rest);
  return pick;
}

async function exportDigest(page, h, label) {
  return h.withTimeout(page.evaluate(async (id) => {
    const out = await window.__lupiViewerMcp.execute({
      id,
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256, transparent: false, timeoutMs: 45_000 },
    });
    return { ok: out.ok, error: out.error ?? null, digest: out.result?.asset?.artifactDigest ?? null };
  }, `morph-${label}`), 120_000, `export ${label}`);
}

/** Export while the last morph is replayed on a timer; samples every frame whether motion was live. */
async function exportUnderMorph(page, h) {
  await page.evaluate(() => {
    const rec = window.__morph;
    rec.samples = [];
    rec.kicks = [];
    const kick = () => rec.kicks.push(window.__lupiPlay?.morph?.() ?? null);
    kick();
    rec.kicker = setInterval(kick, 300);
    const sample = () => {
      if (!rec.kicker) return;
      rec.samples.push(window.__lupiPlay?.state?.()?.motion?.active === true);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  try {
    const result = await exportDigest(page, h, 'mid-morph');
    const { samples, kicks } = await page.evaluate(() => ({ samples: window.__morph.samples, kicks: window.__morph.kicks }));
    return { ...result, samples, kicked: kicks.filter(Boolean).length };
  } finally {
    await page.evaluate(() => {
      clearInterval(window.__morph.kicker);
      window.__morph.kicker = null;
    });
  }
}

export default {
  name: 'morph',
  profiles: ['desktop', 'phone390'],
  description: 'Switching molecules morphs the atoms on screen into the new one; exports stay at rest; Still cuts.',

  async run(ctx, h) {
    const { page, check, save, outcome, options } = ctx;
    const still = options.reducedMotion;
    await page.addInitScript(installRecorder);
    // The static server has no edge Worker: Jev's switch judgment and the
    // stage's gist answer as unconfigured, as the Worker does without a key.
    await page.route('**/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":false}' }).catch(() => {}));

    const canvas = await h.openStructure(ctx, h.galleryEntry(START));
    if (!canvas) return;
    // The first open's own arrival lands first.
    await page.waitForFunction(() => window.__lupiPlay?.state?.()?.motion?.arrival === null, null, { timeout: 30_000, polling: 100 }).catch(() => {});
    await h.waitSettled(page, canvas, 0.01, 15_000);

    // 1. C60 -> caffeine.
    const first = await switchTo(ctx, h, canvas, 'Caffeine', 24);
    check('caffeine loads through the switcher', first.loaded);
    const w1 = morphWindow(first, h);
    outcome.data.c60ToCaffeine = {
      log: first.log.map((entry) => ({ ...entry, t: Math.round(entry.t - first.clickedAt) })),
      presented: first.frames.length,
      liveFrames: w1.live.length,
      ticks: first.ticks,
    };
    if (still) {
      check('Still: the switch does not morph', !first.log.some((entry) => entry.arrival?.includes('morph')), JSON.stringify(first.log.map((e) => e.arrival)));
      return;
    }
    // The morph is armed in the commit, before the new file's first frame; the
    // page-side recorder samples per animation frame, so on a fast release it
    // may see the running morph only.
    check('the switch arms a morph', Boolean(w1.armed || w1.released), JSON.stringify(first.log.slice(0, 4).map((e) => e.arrival)));
    check('the morph runs and lands', Boolean(w1.released && w1.landed), `released ${Boolean(w1.released)}, landed ${Boolean(w1.landed)}`);
    const report = w1.report;
    check(
      'the plan matches 8 carbons by element and 16 other atoms (36 vanish)',
      report?.sameElement === 8 && report?.crossElement === 16 && report?.budded === 0 && report?.vanished === 36,
      JSON.stringify(report),
    );
    outcome.data.c60ToCaffeine.mid = w1.live.map((f) => ({
      t: Math.round(f.at - first.clickedAt),
      fromBefore: h.pct(fraction(h, f.image, w1.before.image)),
      fromRest: h.pct(fraction(h, f.image, w1.rest.image)),
    }));
    check(
      'frames in the middle differ from C60 and from the landed caffeine',
      w1.between.length > 0,
      `${w1.between.length}/${w1.live.length} live frame(s) differ from both by more than 1 %`,
    );
    const frames1 = strip(w1, 6);
    for (let i = 0; i < frames1.length; i += 1) await save(`morph-c60-caffeine-${i}`, h.encodePng(frames1[i].image));

    // The landed view, chrome hidden and the switcher closed, for step 5.
    outcome.data.c60ToCaffeine.inset = await page.evaluate(() => window.__lupiPlay?.viewInset?.() ?? null);
    if (h.isTouchProfile(ctx.spec.profile)) {
      await page.getByRole('button', { name: 'Switch command', exact: true }).tap();
      await page.locator('input[aria-label="Switch molecule"]').first().waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
    } else {
      await page.keyboard.press('Escape');
    }
    const landed = await h.waitSettled(page, canvas, 0.01, 15_000);
    const pose = await page.evaluate(() => window.__lupiPlay?.state?.()?.rig ?? null);
    await save('caffeine-landed', landed.png);

    // 2. Exports never contain the morph.
    const hidden = await page.evaluate(async () => {
      const out = await window.__lupiViewerMcp.execute({ id: 'morph-hide-bonds', tool: 'lupi.set_viewer', arguments: { showBonds: false } });
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      return out.ok;
    });
    check('bonds hide for the raster export', hidden);
    await page.waitForTimeout(500);
    const atRest = await exportDigest(page, h, 'rest');
    const midMorph = await exportUnderMorph(page, h);
    const liveFrames = `${midMorph.samples.filter(Boolean).length}/${midMorph.samples.length} frames live, ${midMorph.kicked} morph replay(s)`;
    outcome.data.exports = { atRest, midMorph: { ...midMorph, samples: liveFrames } };
    check('a morph stays live through its export', midMorph.samples.length > 0 && midMorph.samples.every(Boolean) && midMorph.kicked > 0, liveFrames);
    check(
      'export mid-morph has the artifactDigest of the export at rest',
      Boolean(atRest.ok && midMorph.ok && atRest.digest) && midMorph.digest === atRest.digest,
      `${atRest.digest} vs ${midMorph.digest} ${JSON.stringify(midMorph.error)}`,
    );
    // Machine traffic keeps a later switch instant for a moment: let it pass.
    await page.waitForFunction(() => window.__lupiPlay?.state?.()?.motion?.active === false, null, { timeout: 20_000, polling: 100 }).catch(() => {});
    await page.waitForTimeout(2_000);

    // 3. caffeine -> water.
    const second = await switchTo(ctx, h, canvas, 'Water', 3);
    const w2 = morphWindow(second, h);
    outcome.data.caffeineToWater = {
      log: second.log.map((entry) => ({ ...entry, t: Math.round(entry.t - second.clickedAt) })),
      liveFrames: w2.live.length,
      report: w2.report,
    };
    check('caffeine -> water morphs and lands', Boolean(second.loaded && w2.released && w2.landed), JSON.stringify(second.log.slice(0, 4).map((e) => e.arrival)));
    check(
      'water takes its oxygen from an oxygen and 21 atoms vanish',
      w2.report?.sameElement === 3 && w2.report?.vanished === 21,
      JSON.stringify(w2.report),
    );
    const frames2 = strip(w2, 6);
    for (let i = 0; i < frames2.length; i += 1) await save(`morph-caffeine-water-${i}`, h.encodePng(frames2[i].image));

    // 4. Still: no morph.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const comfort = await page.evaluate(() => window.__lupiPlay?.state?.()?.comfort ?? null);
    const third = await switchTo(ctx, h, canvas, 'Benzene', 12, { quietFrames: 6 });
    outcome.data.still = { comfort, log: third.log.map((entry) => ({ ...entry, t: Math.round(entry.t - third.clickedAt) })) };
    check('Still: water -> benzene does not morph', comfort === 'still' && third.loaded && !third.log.some((entry) => entry.arrival?.includes('morph')), `${comfort}: ${JSON.stringify(third.log.map((e) => e.arrival))}`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // 5. The landed caffeine is a plain open of caffeine at the same camera.
    if (!pose) {
      check('the rig reports the landed pose', false);
      return;
    }
    const plainUrl = new URL('?sim=caffeine&arrival=0', h.baseFor(page)).href;
    await page.goto(plainUrl, { waitUntil: 'commit', timeout: 120_000 });
    const plainLoaded = await page.waitForFunction(() => window.__lupiViewerMcp?.status?.()?.atomCount === 24, null, { timeout: 60_000, polling: 100 }).then(() => true, () => false);
    const plainCanvas = plainLoaded ? await h.mainCanvas(page) : null;
    if (!check('a plain open of caffeine loads', Boolean(plainCanvas))) return;
    await plainCanvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
    await h.waitSettled(page, plainCanvas, 0.01, 15_000);
    const placed = await page.evaluate(async (p) => {
      const out = await window.__lupiViewerMcp.execute({ id: 'morph-pose', tool: 'lupi.set_camera', arguments: { position: p.position, target: p.target } });
      return out.ok;
    }, pose);
    check('the plain open takes the landed camera', placed);
    const plain = await h.waitSettled(page, plainCanvas, 0.01, 15_000);
    await save('caffeine-plain', plain.png);
    const differs = fraction(h, plain.image, landed.image);
    outcome.data.plain = { pose, differs: h.pct(differs) };
    check('the landed caffeine matches a plain open of caffeine', differs < 0.005, `changed=${h.pct(differs)}`);
  },
};
