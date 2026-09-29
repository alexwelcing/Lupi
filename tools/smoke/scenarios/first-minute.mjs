/**
 * first-minute.mjs - the whole Buckyball Minute, one visitor, one page
 * (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=first-minute --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/first-minute
 *
 * 1. "/" is still and has no canvas.
 * 2. A held drag on the ink C60 lands on a face and names it.
 * 3. A tap opens the viewer with no dark frame on the way (the sage relay).
 * 4. The 3D cage first draws at the drawing's pose and inflates from flat.
 * 5. A flick coasts into a face-on view and the pill names the face.
 * 6. A tap during a coast catches it ("Caught"), and opens no card.
 * 7. An atom tap ripples, opens the card, keeps the camera still, and the
 *    pill says "Illustrative".
 * 8. Reset drops the label.
 * 9. An MCP PNG export (at the visitor's pose) after all that equals the
 *    export at rest.
 * Under --reduced-motion (Still): no inflate, no coast, no catch, no ripple.
 * The pill's text is recorded page-side (every DOM change), so short flashes
 * are seen even when the software renderer presents a few frames a second.
 */

const STAGE = '.bucky-hero__stage';
const PILL_TEXT = '.lupi-play-pill__status-text';
const CARD = '[data-testid="atom-info-card"]';
const DARK = [[0x02, 0x02, 0x04], [0x06, 0x08, 0x0d], [0x00, 0x00, 0x00]];
const DARK_LIMIT = 0.2;
const POSE_DEG = 5;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a) => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
};
const deg = (a, b) => {
  const [x, y] = [unit(a), unit(b)];
  return (Math.acos(Math.max(-1, Math.min(1, x[0] * y[0] + x[1] * y[1] + x[2] * y[2]))) * 180) / Math.PI;
};
const viewDir = (rig) => unit(sub(rig.position, rig.target));
const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/** Page-side (survives the SPA hand-off): the pill's text, the play state, the first frame. */
function installRecorder(pillSelector) {
  const rec = (window.__fm = { pill: [], play: [], firstFrame: null });
  let lastPill;
  let lastPlay = '';
  const readPill = () => {
    const node = document.querySelector(pillSelector);
    return node ? node.textContent.trim() : null;
  };
  const notePill = () => {
    const text = readPill();
    if (text !== lastPill) {
      lastPill = text;
      rec.pill.push([Date.now(), text]);
    }
  };
  new MutationObserver(notePill).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(() => {
    notePill();
    const s = window.__lupiPlay?.state?.();
    if (!s) return;
    const now = { arrival: s.motion?.arrival ?? null, ripples: s.motion?.ripples ?? 0, flash: s.flash ?? null, moving: s.rig?.moving ?? null };
    const key = JSON.stringify(now);
    if (key !== lastPlay) {
      lastPlay = key;
      rec.play.push([Date.now(), now]);
    }
  }, 25);
  window.addEventListener('lupi:first-frame', () => {
    let baton = null;
    try {
      baton = JSON.parse(sessionStorage.getItem('lupi.relay.baton') ?? 'null')?.baton ?? null;
    } catch {
      /* none */
    }
    rec.firstFrame ??= { t: Date.now(), baton, rig: window.__lupiPlay?.state?.()?.rig ?? null };
  });
}

const readRec = (page) => page.evaluate(() => window.__fm ?? { pill: [], play: [], firstFrame: null });
const pillSince = (rec, t) => rec.pill.filter(([at]) => at >= t).map(([, text]) => text);
const playSince = (rec, t) => rec.play.filter(([at]) => at >= t).map(([, state]) => state);

/** The hero's state and a fingerprint of the drawing. */
function readHero(page) {
  return page.evaluate((selector) => {
    const stage = document.querySelector(selector);
    const circles = stage ? [...stage.querySelectorAll('circle')] : [];
    return {
      state: stage?.dataset.buckyState ?? null,
      detent: stage?.dataset.buckyDetent ?? null,
      coords: circles.slice(0, 6).map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`).join(' '),
      canvases: document.querySelectorAll('canvas').length,
    };
  }, STAGE);
}

/** Every presented frame (CDP screencast, wall-clock stamped) until stop() is awaited. */
async function recordScreen(page, h) {
  const client = await h.cdpFor(page);
  const frames = [];
  const onFrame = ({ data, metadata, sessionId }) => {
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    frames.push({ at: Number.isFinite(metadata?.timestamp) ? metadata.timestamp * 1000 : Date.now(), data });
  };
  client.on('Page.screencastFrame', onFrame);
  const { width, height } = page.viewportSize();
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: width, maxHeight: height });
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
    if (DARK.some(([r, g, b]) => Math.abs(data[i] - r) <= 10 && Math.abs(data[i + 1] - g) <= 10 && Math.abs(data[i + 2] - b) <= 10)) dark += 1;
  }
  return dark / (image.width * image.height);
}

async function rest(page, h, maxMs = 10_000) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < maxMs) {
    state = await h.readPlay(page);
    if (state?.rig && !state.rig.moving) return state.rig;
    await h.sleep(50);
  }
  return state?.rig ?? null;
}

async function exportDigest(page, h, label) {
  return h.withTimeout(page.evaluate(async (id) => {
    const out = await window.__lupiViewerMcp.execute({
      id,
      tool: 'lupi.export_asset',
      // fitCamera false: at the visitor's own (settled, level) pose, not the tool's front fit.
      arguments: { format: 'png', width: 256, height: 256, transparent: false, fitCamera: false, timeoutMs: 45_000 },
    });
    return { ok: out.ok, error: out.error ?? null, digest: out.result?.asset?.artifactDigest ?? null };
  }, `first-minute-${label}`), 120_000, `export ${label}`);
}

/** A client point on the canvas away from the molecule (for a tap that picks nothing). */
async function emptyPoint(page, h, canvas, image) {
  const box = await canvas.boundingBox();
  const fg = h.foreground(image).box;
  const left = fg ? fg[0] : image.width / 2;
  const fx = Math.max(0.04, (left / 2) / image.width);
  return h.canvasPoint(page, canvas, fx, 0.5).then((p) => ({ ...p, margin: Math.round(left - (p.x - box.x)) }));
}

export default {
  name: 'first-minute',
  profiles: ['desktop', 'phone', 'phone390'],
  description: 'The Buckyball Minute end to end: still "/", hero drag, sage relay, hero pose, flick, catch, atom ripple, Reset, clean export.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome, options } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const still = Boolean(options.reducedMotion);
    const data = (outcome.data.firstMinute = { still });
    const tap = (p) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));

    // 1. "/" is still until touched, with no canvas.
    outcome.url = h.baseFor(page).href;
    await page.goto(outcome.url, { waitUntil: 'load', timeout: options.timeout });
    await page.locator(STAGE).waitFor({ state: 'visible', timeout: options.timeout });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const a = await readHero(page);
    await page.waitForTimeout(600);
    const b = await readHero(page);
    check('1. "/" is still and has no canvas', a.coords === b.coords && b.state === 'rest' && b.canvases === 0, `state=${b.state}, ${b.canvases} canvas`);
    await save('1-home', await page.screenshot({ scale: 'css' }));

    // 2. A held drag on the hero lands on a face.
    let box = await page.locator(STAGE).boundingBox();
    const from = { x: box.x + box.width * 0.3, y: box.y + box.height / 2 };
    const drag = { dx: box.width * 0.4, dy: 0 };
    if (touch) await h.touchDrag(page, from, drag);
    else await h.mouseDrag(page, from, drag);
    const landed = await page
      .waitForFunction((selector) => {
        const stage = document.querySelector(selector);
        return stage?.dataset.buckyState === 'rest' && stage.dataset.buckyDetent ? stage.dataset.buckyDetent : null;
      }, STAGE, { timeout: 4_000, polling: 50 })
      .then((handle) => handle.jsonValue(), () => null);
    const dragged = await readHero(page);
    check('2. a hero drag lands on a face', Boolean(landed) && /Hexagon|Pentagon/.test(landed) && dragged.coords !== b.coords, `face=${landed}`);

    // 3. A tap opens the viewer through the sage relay: no dark frame.
    await page.evaluate(installRecorder, PILL_TEXT);
    const stop = await recordScreen(page, h);
    await page.waitForTimeout(150);
    box = await page.locator(STAGE).boundingBox();
    const tapAt = Date.now();
    await tap({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    const reached = await page
      .waitForFunction(() => Boolean(window.__fm?.firstFrame), null, { timeout: options.timeout, polling: 100 })
      .then(() => true, () => false);
    await page.waitForTimeout(450);
    const frames = await stop();
    let rec = await readRec(page);
    if (!check('3. the viewer draws its first frame', reached && rec.firstFrame, reached ? `${rec.firstFrame.t - tapAt} ms after the tap` : 'no first frame')) return;
    const firstAt = rec.firstFrame.t;
    let worst = { dark: 0, at: null, data: null };
    let scanned = 0;
    let lastAt = -Infinity;
    for (const frame of frames) {
      if (frame.at < tapAt || frame.at > firstAt + 300 || frame.at - lastAt < 50) continue;
      lastAt = frame.at;
      scanned += 1;
      const dark = darkFraction(h.decodePng(Buffer.from(frame.data, 'base64')));
      if (dark >= worst.dark) worst = { dark, at: Math.round(frame.at - tapAt), data: frame.data };
    }
    data.relay = { tapToFirstFrameMs: firstAt - tapAt, scanned, worstDark: worst.dark, worstAtMs: worst.at };
    check('3. no dark frame from the tap to the first 3D frame', scanned >= 3 && worst.dark <= DARK_LIMIT, `${scanned} frames; darkest ${h.pct(worst.dark)} at +${worst.at} ms`);
    const cover = frames.filter((f) => f.at < firstAt).at(-1);
    if (cover) await save('3-relay', Buffer.from(cover.data, 'base64'));
    if (worst.dark > DARK_LIMIT) await save('3-darkest', Buffer.from(worst.data, 'base64'));

    // 4. The cage first draws at the drawing's pose and inflates from flat.
    const handed = rec.firstFrame.baton?.viewDir ?? null;
    const atFirst = rec.firstFrame.rig ?? (await h.readPlay(page))?.rig;
    const poseOff = handed && atFirst ? deg(viewDir(atFirst), handed) : null;
    check(`4. the cage first draws at the hero pose (≤ ${POSE_DEG}°)`, poseOff !== null && poseOff <= POSE_DEG, poseOff === null ? 'no baton or rig' : `${poseOff.toFixed(2)}° from the baton`);
    const canvas = await h.mainCanvas(page);
    if (!check('4. the viewer canvas is present', Boolean(canvas))) return;
    await canvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
    ctx.spec.lane.actualBackend ??= await h.detectBackend(page);
    const toys = await page
      .waitForFunction(() => typeof window.__lupiPlay?.stepDetent === 'function', null, { timeout: 20_000, polling: 100 })
      .then(() => true, () => false);
    await h.waitSettled(page, canvas, 0.01, 30_000);
    rec = await readRec(page);
    const arrivals = [...new Set(playSince(rec, tapAt).map((s) => s.arrival).filter(Boolean))];
    data.arrivals = arrivals;
    if (still) check('4. Still: no arrival', arrivals.length === 0, arrivals.join(', ') || 'none');
    else check('4. the hero hands over a flat inflate', arrivals.some((m) => /flat/.test(m)), arrivals.join(', ') || 'none');
    check('4. camera toys are in place (Object Facts)', toys);
    await save('4-3d', await page.screenshot({ scale: 'css' }));

    // 5. A flick coasts into a face and the pill names it.
    const start = await h.canvasPoint(page, canvas, 0.45, 0.55);
    const before = await rest(page, h);
    const t5 = Date.now();
    const throwBy = touch ? { dx: 100, dy: 0 } : { dx: 120, dy: 0 };
    if (touch) await h.touchFlick(page, start, throwBy, { ms: 100 });
    else await h.mouseFlick(page, start, throwBy, { ms: 100 });
    await h.sleep(still ? 600 : 300);
    const flung = await rest(page, h);
    await h.sleep(400);
    rec = await readRec(page);
    const pill5 = pillSince(rec, t5);
    const label = pill5.find((text) => /face-on/.test(text ?? '')) ?? null;
    data.flick = { turned: before && flung ? deg(viewDir(before), viewDir(flung)) : null, pill: pill5 };
    await save('5-flick', await page.screenshot({ scale: 'css' }));
    if (still) check('5. Still: a flick does not coast into a face', !label && Boolean(flung), `pill ${JSON.stringify(pill5)}`);
    else check('5. a flick lands on a face with its label on the pill', /^(Pentagon face-on · 5-fold|Hexagon face-on · 3-fold) axis$/.test(label ?? ''), `pill ${JSON.stringify(pill5)}`);

    // 6. A tap during a coast catches it (the brisk fling a release makes, from the rig itself).
    const shot = await h.captureCanvas(page, canvas);
    const cbox = await canvas.boundingBox();
    const atom = h.atomCandidates(shot.image, 6).map((c) => ({ x: Math.round(cbox.x + c.x), y: Math.round(cbox.y + c.y) }))[0] ?? start;
    if (!still) {
      await h.sleep(2_500); // the pill shows each text at least 1 s: let the face label come and go first
      const t6 = Date.now();
      await page.evaluate(() => window.__lupiPlay?.flick?.([0, 18, 0]));
      const coasting = (await h.readPlay(page))?.rig?.moving === true;
      await tap(atom);
      const caught = await h.readPlay(page);
      await h.sleep(1_000);
      const card = await page.locator(CARD).first().isVisible().catch(() => false);
      rec = await readRec(page);
      data.catch = { coasting, flash: caught?.flash ?? null, pill: pillSince(rec, t6), card };
      check('6. a tap during a coast catches it ("Caught" on the pill)', coasting && caught?.flash === 'Caught' && pillSince(rec, t6).includes('Caught'), JSON.stringify(data.catch));
      check('6. the catching tap opens no card', !card);
    }

    // 7. An atom tap ripples, opens the card and keeps the camera still.
    const hidden = await page.evaluate(async () => {
      const out = await window.__lupiViewerMcp.execute({ id: 'fm-hide-bonds', tool: 'lupi.set_viewer', arguments: { showBonds: false } });
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      return out.ok;
    });
    check('7. bonds hide for the raster exports', hidden);
    const rig7 = await rest(page, h);
    if (!touch) await page.mouse.move(cbox.x + 4, cbox.y + cbox.height / 2);
    await page.waitForTimeout(600);
    const atRest = await exportDigest(page, h, 'rest');
    check('7. the export at rest succeeds', atRest.ok && Boolean(atRest.digest), JSON.stringify(atRest.error));
    const rig7a = await rest(page, h);
    const plain = await h.captureCanvas(page, canvas);
    const t7 = Date.now();
    await h.pickAtom(ctx, canvas, plain.image);
    const reset = page.locator('button[aria-label="Reset illustrative motion"]');
    const resetShown = still ? false : await reset.first().isVisible().catch(() => false);
    const rig7b = await rest(page, h);
    rec = await readRec(page);
    const pill7 = pillSince(rec, t7);
    const rippled = playSince(rec, t7).some((s) => s.ripples > 0);
    data.tap = { pill: pill7, rippled, rigs: [rig7, rig7a, rig7b], camera: rig7 && rig7b ? maxDiff([...rig7.position, ...rig7.target], [...rig7b.position, ...rig7b.target]) : null };
    check('7. the export and the atom tap keep the camera still', data.tap.camera !== null && data.tap.camera < 1e-6, `moved ${data.tap.camera}`);
    if (still) {
      check('7. Still: no ripple, no label', !rippled && !pill7.some((text) => /Illustrative/.test(text ?? '')), JSON.stringify(pill7));
    } else {
      check('7. the atom tap ripples', rippled);
      check('7. the pill says "Illustrative"', pill7.some((text) => /^Illustrative/.test(text ?? '')), JSON.stringify(pill7));
      await save('7-illustrative', await page.screenshot({ scale: 'css' }));

      // 8. Reset puts the atoms home and drops the label.
      if (!resetShown) await page.evaluate(() => window.__lupiPlay?.poke?.(0));
      const t8 = Date.now();
      await reset.first().click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(400);
      rec = await readRec(page);
      const text8 = await page.locator(PILL_TEXT).first().textContent().catch(() => null);
      const motion8 = (await h.readPlay(page))?.motion;
      data.reset = { resetShown, pill: pillSince(rec, t8), now: text8, motion: motion8 };
      check('8. Reset drops the label and the ripple', !/Illustrative/.test(text8 ?? '') && (motion8?.ripples ?? 0) === 0, JSON.stringify(data.reset));
    }

    // 9. After all that, an MCP PNG equals the export at rest.
    const empty = await emptyPoint(page, h, canvas, plain.image);
    await tap(empty);
    const cardGone = await page.locator(CARD).first().waitFor({ state: 'hidden', timeout: 4_000 }).then(() => true, () => false);
    check('9. a tap on empty canvas closes the card', cardGone, `tap ${empty.x},${empty.y} (${empty.margin}px left of the cage)`);
    if (!touch) await page.mouse.move(cbox.x + 4, cbox.y + cbox.height / 2);
    await page.waitForTimeout(600);
    const after = await exportDigest(page, h, 'after');
    data.exports = { atRest, after };
    check('9. the MCP PNG after the minute equals the rest export', Boolean(atRest.digest) && after.ok && after.digest === atRest.digest, `${atRest.digest} vs ${after.digest} ${JSON.stringify(after.error)}`);
    await save('9-end', await page.screenshot({ scale: 'css' }));
  },
};
