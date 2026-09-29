/**
 * camera.mjs - WP3 Lupi camera rig on C60 (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=camera --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/camera
 *
 * 1. A held drag turns the view, and the pose does not move once it is
 *    released (no coast). The store (read back through lupi.encode_view_url)
 *    holds that rest pose.
 * 2. A flick keeps turning after release and comes to rest in under 4 s.
 *    Under --reduced-motion (Still) it does not coast at all.
 * 3. A tap during the coast catches it: the image freezes, the pill reads
 *    "Caught", and no atom card opens.
 * 4. Desktop: a wheel zoom over an off-centre point keeps the world point
 *    under the cursor where it was (zoom toward the cursor).
 *    Touch: a lime ring marks the finger, a pinch zooms in and a two-finger
 *    drag pans without turning.
 * The rig state comes from window.__lupiPlay.state().rig; screen positions
 * are computed here from that pose (fov 50, y-up), as the viewer's camera does.
 * SwiftShader presents 2–3 frames a second, so "after release" checks wait for
 * the rig's rest (its next frames) instead of a fixed few hundred ms.
 */

const ID = 'c60_buckyball';
const FOV = 50;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const deg = (r) => (r * 180) / Math.PI;
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));
const viewDir = (rig) => unit(sub(rig.position, rig.target));
const distance = (rig) => len(sub(rig.position, rig.target));
const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/** Camera basis of a y-up look-at pose. */
function basis(rig) {
  const f = unit(sub(rig.target, rig.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f) };
}

/** World point on the target plane under a client point. */
function unproject(rig, box, point) {
  const { f, r, u } = basis(rig);
  const t = Math.tan((FOV * Math.PI) / 360);
  const nx = ((point.x - box.x) / box.width) * 2 - 1;
  const ny = 1 - ((point.y - box.y) / box.height) * 2;
  const dir = unit(add(add(f, mul(r, nx * t * (box.width / box.height))), mul(u, ny * t)));
  const along = dot(sub(rig.target, rig.position), f) / dot(dir, f);
  return add(rig.position, mul(dir, along));
}

/** Client point of a world point. */
function project(rig, box, world) {
  const { f, r, u } = basis(rig);
  const t = Math.tan((FOV * Math.PI) / 360);
  const d = sub(world, rig.position);
  const z = dot(d, f);
  return {
    x: box.x + ((dot(d, r) / (z * t * (box.width / box.height)) + 1) / 2) * box.width,
    y: box.y + ((1 - dot(d, u) / (z * t)) / 2) * box.height,
  };
}

/**
 * Page-side: log every frame on which the rig's `moving` or `restCount`
 * changes (performance.now() stamps), so durations are frame-accurate even
 * when polling from here is slower than the renderer.
 */
function installRigLog() {
  const log = (window.__cameraSmoke = []);
  let last = '';
  const tick = () => {
    const rig = window.__lupiPlay?.state?.()?.rig;
    const key = rig ? `${rig.moving}|${rig.restCount}` : 'none';
    if (key !== last) {
      last = key;
      log.push({ t: performance.now(), moving: rig?.moving ?? null, restCount: rig?.restCount ?? null });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** How long the rig moved after `since` (page ms): first moving frame to the first rest frame after it. */
async function movedFor(page, since) {
  return page.evaluate((from) => {
    const log = (window.__cameraSmoke ?? []).filter((e) => e.t >= from);
    const start = log.find((e) => e.moving);
    const end = start && log.find((e) => e.t > start.t && e.moving === false);
    return start && end ? { ms: end.t - start.t, entries: log.length } : null;
  }, since);
}

/** Poll until the rig is mounted and at rest. */
async function rest(page, h, maxMs = 8_000) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < maxMs) {
    state = await h.readPlay(page);
    if (state?.rig && !state.rig.moving) return { state, ms: Date.now() - started };
    await h.sleep(50);
  }
  return { state, ms: Date.now() - started, timedOut: true };
}

/** The store camera, through the share URL (rounded to 0.01 there). */
async function storeCamera(page) {
  const out = await page.evaluate(() => window.__lupiViewerMcp.execute({ id: 'camera-url', tool: 'lupi.encode_view_url', arguments: {} }));
  const token = new URL(out?.result?.url ?? 'http://x/').searchParams.get('s');
  if (!token) return null;
  const json = JSON.parse(Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return { position: json.cp3 ?? [0, 0, 50], target: json.ct ?? [0, 0, 0] };
}

async function flick(page, h, touch, start) {
  if (touch) await h.touchFlick(page, start, { dx: 100, dy: 0 }, { ms: 100 });
  else await h.mouseFlick(page, start, { dx: 130, dy: 0 }, { ms: 100 });
}

export default {
  name: 'camera',
  profiles: ['desktop', 'phone', 'phone390'],
  description: 'Lupi camera rig on C60: held drag, flick coast and rest, catch, store truth, zoom toward the pointer, pinch and two-finger pan.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome, options } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const still = Boolean(options?.reducedMotion);
    const data = (outcome.data.camera = { still });
    const canvas = await h.openStructure(ctx, h.galleryEntry(ID));
    if (!canvas) return;
    const settled = await h.waitSettled(page, canvas, 0.01);
    await save('start', settled.png);
    const r0 = await rest(page, h);
    if (!check('the Lupi camera rig is mounted', r0.state?.rig, JSON.stringify(r0.state?.rig ?? null))) return;
    const start = await h.canvasPoint(page, canvas, 0.5, 0.55);
    await page.evaluate(installRigLog);

    // 1. Held drag: turns 1:1, then stays put.
    if (touch) await h.touchDrag(page, start, { dx: 110, dy: 0 });
    else await h.mouseDrag(page, start, { dx: 180, dy: 0 });
    const releasedAt = Date.now();
    const released = (await h.readPlay(page))?.rig;
    await h.sleep(300);
    const heldRest = await rest(page, h, 4_000);
    const held = heldRest.state.rig;
    const restMs = Date.now() - releasedAt;
    const turned = deg(angle(viewDir(r0.state.rig), viewDir(held)));
    const drift = maxDiff(released.position, held.position);
    data.drag = { turnedDeg: turned, released, held, restMs };
    check('a held drag turns the view', turned > 10, `${turned.toFixed(1)} deg`);
    check('a held release does not coast (rest pose = release pose)', drift < 1e-6 && !heldRest.timedOut, `moved ${drift.toExponential(2)} after release, rest after ${restMs} ms`);
    check('one store rest per gesture', held.restCount === r0.state.rig.restCount + 1, `restCount ${r0.state.rig.restCount} -> ${held.restCount}`);
    await save('dragged', (await h.captureCanvas(page, canvas)).png);
    const stored = await storeCamera(page);
    data.store = stored;
    check(
      'the store holds the rest pose (share URL, 0.01 rounding)',
      stored && maxDiff(stored.position, held.position) <= 0.006 && maxDiff(stored.target, held.target) <= 0.006,
      stored ? `position diff ${maxDiff(stored.position, held.position).toFixed(4)}, target diff ${maxDiff(stored.target, held.target).toFixed(4)}` : 'no URL',
    );

    // 2. Flick: coasts, then comes to rest. The screen is recorded from
    // before the flick (a software renderer can acknowledge the flick's
    // events only after the coast is over, so nothing is timed from them).
    const before = (await rest(page, h)).state.rig;
    const pageT0 = await page.evaluate(() => performance.now());
    const recording = h.sampleFrames(page, { ms: 3_500, every: 100 });
    await h.sleep(300);
    await flick(page, h, touch, start);
    const frames = await recording;
    const settle = await rest(page, h, 10_000);
    const coast = await movedFor(page, pageT0);
    const settleMs = coast?.ms ?? Number.POSITIVE_INFINITY;
    const after = settle.state.rig;
    // Distinct presented frames, and the span over which they kept changing.
    const shown = [];
    for (const frame of frames) if (!shown.length || shown.at(-1).frameT !== frame.frameT) shown.push(frame);
    const changes = [];
    for (let i = 1; i < shown.length; i += 1) {
      const a = h.decodePng(shown[i - 1]);
      const b = h.decodePng(shown[i]);
      if (h.diffImages(a, b).changed / (a.width * a.height) > 0.002) changes.push(shown[i].frameT);
    }
    const changeSpan = changes.length > 1 ? changes.at(-1) - changes[0] : 0;
    const coasted = deg(angle(viewDir(before), viewDir(after)));
    data.flick = { settleMs, coastedDeg: coasted, changeSpan, changes, restCount: [before.restCount, after.restCount] };
    if (shown.length > 2) await save('flick-mid', shown[Math.floor(shown.length / 2)]);
    await save('flick-rest', (await h.captureCanvas(page, canvas)).png);
    if (still) {
      check('Still: a flick does not coast', changeSpan <= 250 && !settle.timedOut, `screen changed over ${changeSpan} ms`);
    } else {
      check('a flick keeps turning after release (screen changes over >= 400 ms)', changeSpan >= 400 && settleMs >= 300, `changed over ${changeSpan} ms in ${shown.length} presented frames; the rig moved ${Math.round(settleMs)} ms`);
      check('the flick comes to rest in under 4 s', !settle.timedOut && settleMs < 4_000, `moved for ${Math.round(settleMs)} ms (first moving frame to rest), turned ${coasted.toFixed(0)} deg net`);
      check('the coast ends in one store rest', after.restCount === before.restCount + 1, `restCount ${before.restCount} -> ${after.restCount}`);
    }

    // 3. Catch: a tap during the coast freezes it and picks nothing.
    if (!still) {
      const image = (await h.captureCanvas(page, canvas)).image;
      const box = await canvas.boundingBox();
      const atom = h.atomCandidates(image, 6)
        .map((c) => ({ x: Math.round(box.x + c.x), y: Math.round(box.y + c.y) }))
        .find(Boolean) ?? start;
      // Start the coast through the rig itself (the same fling a release
      // makes), so the tap below is timed against it and not against how
      // late the renderer acknowledges a synthetic flick.
      // A brisk spin, tapped at once: a software renderer at ~1 fps takes
      // only a few frames to slow a coast below the catch speed.
      await page.evaluate(() => window.__lupiPlay?.flick?.([0, 18, 0]));
      const coasting = (await h.readPlay(page))?.rig?.moving === true;
      if (touch) await page.touchscreen.tap(atom.x, atom.y);
      else await page.mouse.click(atom.x, atom.y);
      const caught = await h.readPlay(page);
      await h.sleep(300);
      const a = await h.captureCanvas(page, canvas);
      await h.sleep(600);
      const b = await h.captureCanvas(page, canvas);
      const settled = (await rest(page, h, 4_000)).state;
      const frozen = h.diffImages(a.image, b.image).changed / (a.image.width * a.image.height);
      const card = await page.locator('[data-testid="atom-info-card"]').first().isVisible().catch(() => false);
      const slid = maxDiff(caught.rig.position, settled.rig.position);
      data.catch = { coasting, flash: caught?.flash ?? null, frozen, card, tap: atom, slid };
      await save('caught', await page.screenshot({ scale: 'css' }));
      check('the coast is running when the tap goes in', coasting);
      check('a tap catches the coast ("Caught")', caught?.flash === 'Caught' && slid < 1e-3, `flash=${caught?.flash}, moved ${slid.toExponential(2)} after the tap`);
      check('the caught image is frozen', frozen < 0.0005, `changed ${h.pct(frozen)} from +300 to +900 ms`);
      check('the catching tap opens no atom card', !card);
    }

    // 4. Zoom and pan.
    const r4 = (await rest(page, h)).state.rig;
    const box = await canvas.boundingBox();
    if (!touch) {
      const cursor = await h.canvasPoint(page, canvas, 0.68, 0.4);
      const world = unproject(r4, box, cursor);
      await page.mouse.move(cursor.x, cursor.y);
      await page.mouse.wheel(0, -200);
      const zoomed = (await rest(page, h)).state.rig;
      const landed = project(zoomed, box, world);
      const drift = Math.hypot(landed.x - cursor.x, landed.y - cursor.y);
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const ratio = distance(zoomed) / distance(r4);
      const centreZoomDrift = Math.hypot(cursor.x - centre.x, cursor.y - centre.y) * (1 / ratio - 1);
      data.wheel = { cursor, world, landed, drift, ratio, centreZoomDrift, target: [r4.target, zoomed.target] };
      await save('wheel', (await h.captureCanvas(page, canvas)).png);
      check('the wheel zooms in', ratio < 0.9, `distance x${ratio.toFixed(3)}`);
      check('the point under the cursor stays under it', drift < 4, `${drift.toFixed(1)} px (a centre zoom would move it ${centreZoomDrift.toFixed(0)} px)`);
    } else {
      // A lime ring under a finger (touch marks), then lift.
      const client = await h.cdpFor(page);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
      await h.sleep(120);
      const rings = await page.evaluate(() => document.querySelectorAll('[data-lupi-touch-marks] circle').length);
      await save('touch-mark', await page.screenshot({ scale: 'css' }));
      // Leave as a small held drag, not a tap (a tap would pick an atom).
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 24, y: start.y, id: 1 }] });
      await h.sleep(200);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      check('a lime ring marks the finger', rings >= 1, `${rings} ring(s)`);
      await rest(page, h);

      const centre = await h.canvasPoint(page, canvas, 0.5, 0.5);
      const p0 = (await rest(page, h)).state.rig;
      await h.pinch(page, centre, { fromPx: 80, toPx: 180 });
      const p1 = (await rest(page, h)).state.rig;
      await h.twoFingerDrag(page, centre, { dx: 90, dy: 0 });
      const p2 = (await rest(page, h)).state.rig;
      const ratio = distance(p1) / distance(p0);
      const panned = len(sub(p2.target, p1.target)) / distance(p1);
      const turnedPan = deg(angle(viewDir(p1), viewDir(p2)));
      data.touch = { ratio, panned, turnedPan };
      await save('pinch-pan', (await h.captureCanvas(page, canvas)).png);
      check('a pinch zooms in', ratio < 0.8, `distance x${ratio.toFixed(3)}`);
      check('a two-finger drag pans without turning', panned > 0.05 && turnedPan < 0.5, `target moved ${(panned * 100).toFixed(1)}% of the distance, turned ${turnedPan.toFixed(2)} deg`);
    }
  },
};
