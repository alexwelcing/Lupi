/**
 * toys.mjs - WP5 display motion in the real viewer (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=toys --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/toys
 *
 * On /?sim=c60_buckyball&arrival=1 (arrival=1 forces the first-open arrival
 * past the session rule):
 * 1. The arrival is armed before the first frame, the screen shows the mist,
 *    and it lands when its 0.6 s motion clock runs out (the driver's clock
 *    advances by frame time capped at 0.1 s; it ends on the first frame past
 *    the analytic end).
 * 2. A poke ripples the pixels and they return within 0.1 % of the pre-poke
 *    image (under --reduced-motion, Still: a poke does nothing).
 * 3. lupi.export_asset PNG (bonds hidden) with a ripple kept live, and with a
 *    scatter kept live, has the artifactDigest of the export at rest (before
 *    any tap: a selection blocks deterministic export).
 * 4. After a reload, a tap during the arrival lands it synchronously (the
 *    pointerdown sees it live and, after the app's capture-phase listener,
 *    at rest, before any pick) and the tapped atom's card opens.
 * A software renderer presents a few frames a second, so the pixel checks use
 * the frames the screen presented (CDP screencast, wall-clock stamped) inside
 * each effect's window, read from a page-side timeline of __lupiPlay.state().
 */

const ID = 'c60_buckyball';
const HIDE_ID = 'toys-hide-chrome';

/** Page-side: record __lupiPlay motion changes, pointerdowns, and hide the chrome while asked. */
function installRecorder(hideCss) {
  const toys = { log: [], downs: [], ticks: [], frames: 0, hideCss };
  window.__toys = toys;
  const now = () => performance.timeOrigin + performance.now();
  const read = () => {
    const state = window.__lupiPlay?.state?.() ?? null;
    return { arrival: state?.motion?.arrival ?? null, ripples: state?.motion?.ripples ?? 0, active: state?.motion?.active ?? false, firstFrame: state?.firstFrame ?? false };
  };
  let last = '';
  const tick = () => {
    toys.frames += 1;
    if (toys.ticks.length < 20_000) toys.ticks.push(now());
    const canvas = document.querySelector('.lupine-main-viewport canvas');
    if (canvas && !canvas.hasAttribute('data-smoke-main')) canvas.setAttribute('data-smoke-main', '1');
    const state = read();
    const key = JSON.stringify(state);
    if (key !== last) {
      last = key;
      toys.log.push({ t: now(), ...state });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Capture phase, registered before the app: the state the pointerdown met.
  window.addEventListener('pointerdown', () => toys.downs.push({ t: now(), before: read().arrival }), { capture: true });
  // Bubble phase: after every capture-phase listener (the app's cancel), before any click.
  window.addEventListener('pointerdown', () => {
    const down = toys.downs[toys.downs.length - 1];
    if (down) down.after = read().arrival;
  });
  const hide = () => {
    const style = document.createElement('style');
    style.id = 'toys-hide-chrome';
    style.textContent = hideCss;
    document.head.appendChild(style);
  };
  let keep = false;
  try {
    keep = sessionStorage.getItem('toys-show-chrome') === '1';
  } catch {
    /* storage blocked */
  }
  if (keep) return;
  if (document.head) hide();
  else document.addEventListener('DOMContentLoaded', hide, { once: true });
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

/** Crop presented frames to the canvas box. */
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

async function open(ctx, h, reload = false, navigated = false) {
  const { page, check, outcome } = ctx;
  outcome.url = new URL(`?sim=${ID}&arrival=1`, h.baseFor(page)).href;
  if (navigated) reload = true;
  else if (reload) await page.reload({ waitUntil: 'commit' });
  else await page.goto(outcome.url, { waitUntil: 'commit' });
  const loaded = await page.waitForFunction(() => {
    const status = window.__lupiViewerMcp?.status?.();
    return status?.moleculeLoaded === true && status.atomCount === 60;
  }, null, { timeout: 60_000, polling: 100 }).then(() => true, () => false);
  if (!check(`C60 loads with ?arrival=1${reload ? ' (reload)' : ''}`, loaded)) return null;
  const canvas = await h.mainCanvas(page);
  if (!check('viewer canvas is present', Boolean(canvas))) return null;
  await canvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
  return canvas;
}

const fraction = (h, a, b) => h.diffImages(a, b).changed / (a.width * a.height);

async function exportDigest(page, h, label) {
  return h.withTimeout(page.evaluate(async (id) => {
    const out = await window.__lupiViewerMcp.execute({
      id,
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256, transparent: false, timeoutMs: 45_000 },
    });
    return { ok: out.ok, error: out.error ?? null, digest: out.result?.asset?.artifactDigest ?? null };
  }, `toys-${label}`), 120_000, `export ${label}`);
}

/** Export while a toy is re-kicked on a timer; samples every frame whether motion was live. */
async function exportUnderToy(page, h, kind) {
  await page.evaluate((toy) => {
    const toys = window.__toys;
    toys.samples = [];
    let n = 0;
    const kick = () => (toy === 'ripple' ? window.__lupiPlay?.poke?.((n++ * 7) % 60) : window.__lupiPlay?.scatter?.());
    kick();
    toys.kicker = setInterval(kick, toy === 'ripple' ? 150 : 400);
    const sample = () => {
      if (!toys.kicker) return;
      toys.samples.push(window.__lupiPlay?.state?.()?.motion?.active === true);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, kind);
  try {
    const result = await exportDigest(page, h, kind);
    return { ...result, samples: await page.evaluate(() => window.__toys.samples) };
  } finally {
    await page.evaluate(() => {
      clearInterval(window.__toys.kicker);
      window.__toys.kicker = null;
    });
  }
}

/**
 * When the driver's motion clock (frame time, capped at 0.1 s per frame)
 * reaches `seconds` after `from`, replayed on the recorder's frame ticks.
 */
function clockReaches(ticks, from, seconds) {
  let clock = 0;
  let previous = from;
  for (const t of ticks) {
    if (t <= from) continue;
    clock += Math.min(0.1, (t - previous) / 1000);
    previous = t;
    if (clock >= seconds) return t;
  }
  return null;
}

export default {
  name: 'toys',
  profiles: ['desktop', 'phone390'],
  description: 'C60 condenses on arrival, a touch lands it, a poke ripples, exports stay at rest.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome, options } = ctx;
    const still = options.reducedMotion;
    await page.addInitScript(installRecorder, h.HIDE_CHROME_CSS);

    // 1. The arrival on a first open (chrome hidden from the first paint).
    const stop1 = await screencast(page, h);
    let canvas = await open(ctx, h);
    if (!canvas) {
      await stop1();
      return;
    }
    await page.waitForFunction(() => window.__lupiPlay?.state?.()?.motion?.arrival === null, null, { timeout: 30_000, polling: 100 }).catch(() => {});
    await page.waitForTimeout(1_000);
    const presented = await cropFrames(page, canvas, await stop1(), h);
    const { log: log1, ticks } = await page.evaluate(() => ({ log: window.__toys.log, ticks: window.__toys.ticks }));
    const armed = log1.find((entry) => entry.arrival === 'armed condense') ?? null;
    const released = log1.find((entry) => entry.arrival === 'condense') ?? null;
    const landed = released ? log1.find((entry) => entry.t > released.t && entry.arrival === null) ?? null : null;
    const rest = presented.at(-1);
    const mistFrames = presented.filter((f) => armed && landed && f.at >= armed.t && f.at < landed.t);
    const mist = mistFrames.map((f) => fraction(h, f.image, rest.image));
    const t0 = armed?.t ?? presented[0]?.at ?? 0;
    // The driver lands it on the first frame whose motion clock passes 0.6 s;
    // the recorder sees that one frame later.
    const due = released ? clockReaches(ticks, released.t, 0.6) : null;
    const tickGap = (t) => {
      const i = ticks.findIndex((tick) => tick >= t);
      return i > 0 ? ticks[i] - ticks[i - 1] : 0;
    };
    const lateTicks = due != null && landed ? ticks.filter((tick) => tick > due && tick < landed.t).length : null;
    outcome.data.arrival = {
      log: log1.slice(0, 10).map((entry) => ({ ...entry, t: Math.round(entry.t - t0) })),
      dueMs: due == null ? null : Math.round(due - t0),
      lateTicks,
      frameAtDueMs: due == null ? null : Math.round(tickGap(due)),
      presentedMs: presented.map((f) => Math.round(f.at - t0)),
      mist: mist.map(h.pct),
    };
    if (rest) await save('rest', h.encodePng(rest.image));
    const top = mistFrames[mist.indexOf(Math.max(0, ...mist))];
    if (top) await save('mist', h.encodePng(top.image));
    check('the arrival is armed before the first frame', Boolean(armed) && armed.firstFrame === false, JSON.stringify(armed));
    check(
      'the arrival lands when its 0.6 s motion clock runs out',
      due != null && landed != null && landed.t >= due && lateTicks <= 1,
      `landed ${landed && released ? Math.round(landed.t - released.t) : '?'} ms after release (wall), due ${due && released ? Math.round(due - released.t) : '?'} ms, ${lateTicks} late tick(s)`,
    );
    check('the screen shows the mist while the arrival is live', mist.some((d) => d > 0.01), `${mistFrames.length} presented frame(s) while live, max change ${h.pct(Math.max(0, ...mist))} vs the landed image`);

    // 2. A poke ripples the pixels, then they return.
    await setChromeHidden(page, true, h.HIDE_CHROME_CSS);
    const stop2 = await screencast(page, h);
    // A pre-poke frame: a loaded software renderer can present under 1 fps.
    for (let waited = 0; stop2.count() === 0 && waited < 15_000; waited += 100) await page.waitForTimeout(100);
    await page.waitForTimeout(600);
    const poke = await page.evaluate(() => ({ at: performance.timeOrigin + performance.now(), result: window.__lupiPlay?.poke?.(0) ?? null }));
    await page.waitForFunction(() => window.__lupiPlay?.state?.()?.motion?.active === false, null, { timeout: 20_000, polling: 50 }).catch(() => {});
    const quiet = await page.evaluate(() => performance.timeOrigin + performance.now());
    await page.waitForTimeout(1_200);
    const rippleFrames = await cropFrames(page, canvas, await stop2(), h);
    await setChromeHidden(page, false, '');
    if (still) {
      check('Still: a poke does not move anything', poke.result === null, JSON.stringify(poke.result));
    } else {
      const before = rippleFrames.filter((f) => f.at < poke.at).at(-1);
      const during = rippleFrames.filter((f) => f.at >= poke.at && f.at <= quiet);
      const after = rippleFrames.filter((f) => f.at > quiet + 300).at(-1) ?? rippleFrames.at(-1);
      const deltas = before ? during.map((f) => fraction(h, f.image, before.image)) : [];
      const back = before && after ? fraction(h, after.image, before.image) : 1;
      outcome.data.ripple = { poke: poke.result, liveMs: Math.round(quiet - poke.at), duringMs: during.map((f) => Math.round(f.at - poke.at)), deltas: deltas.map(h.pct), back: h.pct(back) };
      const peak = during[deltas.indexOf(Math.max(0, ...deltas))];
      if (peak) await save('ripple', h.encodePng(peak.image));
      if (before) await save('pre-poke', h.encodePng(before.image));
      check('a poke ripples the pixels', Boolean(poke.result) && deltas.some((d) => d > 0.002), `${during.length} presented frame(s) while live (${Math.round(quiet - poke.at)} ms), max change ${h.pct(Math.max(0, ...deltas))}`);
      check('the pixels return within 0.1 % of the pre-poke image', Boolean(before && after) && back <= 0.001, `changed=${h.pct(back)}`);
    }

    // 3. Exports never contain toy motion (no selection or hover yet).
    const hidden = await page.evaluate(async () => {
      const out = await window.__lupiViewerMcp.execute({ id: 'toys-hide-bonds', tool: 'lupi.set_viewer', arguments: { showBonds: false } });
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      return out.ok;
    });
    check('bonds hide for the raster export', hidden);
    await page.waitForTimeout(500);
    const atRest = await exportDigest(page, h, 'rest');
    if (still) {
      check('the export at rest succeeds', atRest.ok && Boolean(atRest.digest), JSON.stringify(atRest.error));
    } else {
      const midRipple = await exportUnderToy(page, h, 'ripple');
      const midScatter = await exportUnderToy(page, h, 'scatter');
      const liveFrames = (run) => `${run.samples.filter(Boolean).length}/${run.samples.length} frames live`;
      outcome.data.exports = { atRest, midRipple: { ...midRipple, samples: liveFrames(midRipple) }, midScatter: { ...midScatter, samples: liveFrames(midScatter) } };
      check('a ripple stays live through its export', midRipple.samples.length > 0 && midRipple.samples.every(Boolean), liveFrames(midRipple));
      check('a scatter stays live through its export', midScatter.samples.length > 0 && midScatter.samples.every(Boolean), liveFrames(midScatter));
      check('export mid-ripple has the artifactDigest of the export at rest', Boolean(atRest.ok && midRipple.ok && atRest.digest) && midRipple.digest === atRest.digest, `${atRest.digest} vs ${midRipple.digest} ${JSON.stringify(midRipple.error)}`);
      check('export mid-scatter has the artifactDigest of the export at rest', Boolean(atRest.ok && midScatter.ok && atRest.digest) && midScatter.digest === atRest.digest, `${atRest.digest} vs ${midScatter.digest} ${JSON.stringify(midScatter.error)}`);
    }

    // 4. After a reload, a tap during the arrival lands it before the pick, and picks.
    // A reloaded page is warm and lands its arrival fast, so tap the moment it
    // is live (armed or condensing), before any other wait; the recorder says
    // which state the pointerdown met. The chrome stays visible (real hit testing).
    const candidates = h.atomCandidates(rest.image, 8);
    const box = await canvas.boundingBox();
    const target = candidates[0] ? { x: Math.round(box.x + candidates[0].x), y: Math.round(box.y + candidates[0].y) } : null;
    await page.evaluate(() => sessionStorage.setItem('toys-show-chrome', '1'));
    await page.reload({ waitUntil: 'commit' });
    const live = await page.waitForFunction(() => Boolean(window.__lupiPlay?.state?.()?.motion?.arrival), null, { timeout: 60_000, polling: 10 }).then(() => true, () => false);
    if (target && h.isTouchProfile(spec.profile)) await page.touchscreen.tap(target.x, target.y);
    else if (target) await page.mouse.click(target.x, target.y);
    canvas = await open(ctx, h, false, true);
    if (!canvas) return;
    const downs = await page.evaluate(() => window.__toys.downs);
    outcome.data.cancel = { live, target, downs };
    const down = downs[0];
    check('a pointerdown during the arrival lands it before any pick', live && Boolean(down?.before) && down?.after === null, JSON.stringify(down ?? null));
    const card = page.locator('[data-testid="atom-info-card"]').first();
    const shown = await card.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false);
    if (shown) {
      check('the tapped atom\'s card opens', true, `atom #${await card.getAttribute('data-atom-index')}`);
      await save('tapped', await page.screenshot({ scale: 'css' }));
    } else {
      await h.pickAtom(ctx, canvas, rest.image);
    }
  },
};
