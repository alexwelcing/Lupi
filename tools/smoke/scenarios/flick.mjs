/**
 * flick.mjs - WP10 True Spin and Symmetry Detents (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=flick --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/flick
 *
 * 1. C60: a flick (mouse on desktop, a finger on a phone) coasts, clicks into
 *    a face-on view within 4 s, and the pill flashes its name. The rest view
 *    is within 1° of a ring normal computed here from the gallery xyz, and
 *    the label names that ring (Pentagon for a 5-ring, Hexagon for a 6-ring).
 *    Twice: sideways, then diagonally.
 * 2. ArrowRight hops to a neighbouring face (to the right on screen) and
 *    flashes its name.
 * 3. Home returns to the opening view.
 * 4. Caffeine: Spin (the tray's play.spin intent) flips it by itself within
 *    8 s: "Flip! · tennis-racket effect".
 * Under --reduced-motion (Still) a flick does not coast or click, the arrow
 * still lands face-on (a cut), and Spin does nothing.
 * The pill of this chain may be the stub: the flash is read from
 * window.__lupiPlay.state().flash, recorded page-side every 25 ms.
 */
import { readFileSync } from 'node:fs';

const C60 = 'c60_buckyball';
const CAFFEINE = 'caffeine';
const XYZ = new URL('../../../apps/web/public/gallery/curated/c60_buckyball.xyz', import.meta.url);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
};
const deg = (a, b) => (Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180) / Math.PI;
const viewDir = (rig) => unit(sub(rig.position, rig.target));

/** C60's 12 pentagons and 20 hexagons from the xyz: outward normals through the face centres. */
function c60Faces() {
  const lines = readFileSync(XYZ, 'utf8').split(/\r?\n/);
  const n = Number(lines[0]);
  const p = lines.slice(2, 2 + n).map((line) => line.trim().split(/\s+/).slice(1, 4).map(Number));
  const centre = p.reduce((c, q) => [c[0] + q[0] / n, c[1] + q[1] / n, c[2] + q[2] / n], [0, 0, 0]);
  const adj = p.map((a) => p.map((b, j) => (Math.hypot(...sub(a, b)) < 1.6 && a !== b ? j : -1)).filter((j) => j >= 0));
  const rings = new Map();
  const walk = (path, size) => {
    for (const next of adj[path.at(-1)]) {
      if (path.length === size && next === path[0]) rings.set([...path].sort((a, b) => a - b).join(), [...path]);
      else if (path.length < size && next > path[0] && !path.includes(next)) walk([...path, next], size);
    }
  };
  for (let i = 0; i < n; i += 1) for (const size of [5, 6]) walk([i], size);
  return [...rings.values()].map((ring) => {
    const c = ring.reduce((s, i) => [s[0] + p[i][0] / ring.length, s[1] + p[i][1] / ring.length, s[2] + p[i][2] / ring.length], [0, 0, 0]);
    return { size: ring.length, normal: unit(sub(c, centre)) };
  });
}

/** The face whose normal is nearest a view direction. */
function nearestFace(faces, dir) {
  let best = null;
  for (const face of faces) {
    const off = deg(face.normal, dir);
    if (!best || off < best.off) best = { ...face, off };
  }
  return best;
}

/** Page-side: every change of the rig's moving/restCount and of the flash, stamped with performance.now(). */
function installRecorder() {
  const log = (window.__flickSmoke = { rig: [], flash: [] });
  let lastRig = '';
  let lastFlash = null;
  setInterval(() => {
    const state = window.__lupiPlay?.state?.();
    const rig = state?.rig;
    const key = rig ? `${rig.moving}|${rig.restCount}` : 'none';
    const t = performance.now();
    if (key !== lastRig) {
      lastRig = key;
      log.rig.push({ t, moving: rig?.moving ?? null });
    }
    const flash = state?.flash ?? null;
    if (flash !== lastFlash) {
      lastFlash = flash;
      if (flash) log.flash.push({ t, flash });
    }
  }, 25);
}

/** Moving time after `since` (first moving sample to the next rest) and the flashes since then. */
async function recorded(page, since) {
  return page.evaluate((from) => {
    const log = window.__flickSmoke ?? { rig: [], flash: [] };
    const rig = log.rig.filter((e) => e.t >= from);
    const start = rig.find((e) => e.moving);
    const end = start && rig.find((e) => e.t > start.t && e.moving === false);
    return {
      movedMs: start && end ? end.t - start.t : null,
      flashes: log.flash.filter((e) => e.t >= from).map((e) => ({ ms: Math.round(e.t - from), flash: e.flash })),
    };
  }, since);
}

async function rest(page, h, maxMs = 10_000) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < maxMs) {
    state = await h.readPlay(page);
    if (state?.rig && !state.rig.moving) return { rig: state.rig, timedOut: false };
    await h.sleep(50);
  }
  return { rig: state?.rig ?? null, timedOut: true };
}

/** Open a structure and wait until its camera toys are in place (the stepDetent hook appears). */
async function open(ctx, h, id) {
  const canvas = await h.openStructure(ctx, h.galleryEntry(id));
  if (!canvas) return null;
  await h.waitSettled(ctx.page, canvas, 0.01);
  const ready = await ctx.page
    .waitForFunction(() => typeof window.__lupiPlay?.stepDetent === 'function', null, { timeout: 20_000, polling: 100 })
    .then(() => true, () => false);
  ctx.check(`${id}: camera toys registered after the first frame`, ready);
  await ctx.page.evaluate(installRecorder);
  const opening = (await rest(ctx.page, h)).rig;
  return ready ? { canvas, opening } : null;
}

export default {
  name: 'flick',
  profiles: ['desktop', 'phone', 'phone390'],
  description: 'True Spin and Symmetry Detents: a C60 flick clicks face-on with its name, ArrowRight hops to the next face, Spin flips caffeine.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome, options } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const still = Boolean(options?.reducedMotion);
    const data = (outcome.data.flick = { still, flicks: [] });
    const faces = c60Faces();
    check('C60 xyz gives 12 pentagons and 20 hexagons', faces.filter((f) => f.size === 5).length === 12 && faces.filter((f) => f.size === 6).length === 20, `${faces.length} rings`);

    const c60 = await open(ctx, h, C60);
    if (!c60) return;
    const { canvas, opening } = c60;
    const start = await h.canvasPoint(page, canvas, 0.45, 0.55);

    // 1. Flicks land face-on, named.
    const throws = touch
      ? [{ dx: 100, dy: 0 }, { dx: 70, dy: -70 }]
      : [{ dx: 120, dy: 0 }, { dx: 90, dy: -80 }]; // ~5 rad/s: 1.5-2 s at 60 fps, well inside 4 s on a loaded SwiftShader
    for (const [i, throwBy] of throws.entries()) {
      const before = (await rest(page, h)).rig;
      const t0 = await page.evaluate(() => performance.now());
      if (touch) await h.touchFlick(page, start, throwBy, { ms: 100 });
      else await h.mouseFlick(page, start, throwBy, { ms: 100 });
      await h.sleep(still ? 600 : 300);
      const settled = await rest(page, h);
      await h.sleep(150);
      const { movedMs, flashes } = await recorded(page, t0);
      const face = nearestFace(faces, viewDir(settled.rig));
      const label = flashes.find((f) => /face-on/.test(f.flash))?.flash ?? null;
      const turned = deg(viewDir(before), viewDir(settled.rig));
      data.flicks.push({ throwBy, movedMs, face, flashes, turned });
      await save(`flick${i + 1}-rest`, await page.screenshot({ scale: 'css' }));
      if (still) {
        check(`Still: flick ${i + 1} does not click into a face (no label)`, !label && !settled.timedOut, `flashes ${JSON.stringify(flashes)}`);
        continue;
      }
      check(`flick ${i + 1} coasts and settles in under 4 s`, movedMs != null && movedMs < 4_000 && turned > 5, `moved ${Math.round(movedMs ?? -1)} ms, turned ${turned.toFixed(1)} deg`);
      check(`flick ${i + 1} rests face-on (within 1 deg of a C60 ring normal)`, face.off < 1, `${face.size}-ring, ${face.off.toFixed(3)} deg off`);
      const expected = face.size === 5 ? /^Pentagon face-on · 5-fold axis$/ : /^Hexagon face-on · 3-fold axis$/;
      check(`flick ${i + 1} flashes the face's name`, label != null && expected.test(label), `label "${label}", ${face.size}-ring`);
    }

    // 2. ArrowRight: the next face to the right.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    const r0 = (await rest(page, h)).rig;
    const face0 = nearestFace(faces, viewDir(r0));
    const right = unit(cross(unit(sub(r0.target, r0.position)), [0, 1, 0]));
    const t1 = await page.evaluate(() => performance.now());
    await page.keyboard.press('ArrowRight');
    await h.sleep(300);
    const r1 = (await rest(page, h)).rig;
    await h.sleep(150);
    const { flashes: keyFlashes } = await recorded(page, t1);
    const face1 = nearestFace(faces, viewDir(r1));
    const hop = deg(face0.normal, face1.normal);
    data.arrow = { from: face0, to: face1, hop, flashes: keyFlashes };
    await save('arrow-right', await page.screenshot({ scale: 'css' }));
    check('ArrowRight lands on another face, face-on', face1.off < 1 && hop > 30, `${face1.size}-ring ${face1.off.toFixed(3)} deg off, ${hop.toFixed(1)} deg from the last`);
    check('ArrowRight goes right on screen', dot(face1.normal, right) > 0, `screen x ${dot(face1.normal, right).toFixed(2)}`);
    check('ArrowRight flashes the new face', keyFlashes.some((f) => (face1.size === 5 ? /^Pentagon/ : /^Hexagon/).test(f.flash)), JSON.stringify(keyFlashes));

    // 3. Home: back to the opening view.
    await page.keyboard.press('Home');
    await h.sleep(300);
    const home = (await rest(page, h)).rig;
    const homeOff = deg(viewDir(home), viewDir(opening));
    const span = (r) => Math.hypot(...sub(r.position, r.target));
    const homeScale = span(home) / span(opening);
    data.home = { off: homeOff, scale: homeScale };
    check('Home returns to the opening view', homeOff < 0.1 && Math.abs(homeScale - 1) < 1e-3, `${homeOff.toFixed(3)} deg off, distance x${homeScale.toFixed(4)}`);

    // 4. Spin flips caffeine.
    const caffeine = await open(ctx, h, CAFFEINE);
    if (!caffeine) return;
    const s0 = (await rest(page, h)).rig;
    const t2 = await page.evaluate(() => performance.now());
    check('the play.spin intent is emitted', await h.playEmit(page, { type: 'play.spin' }));
    const shots = [];
    let flip = null;
    let turned = 0;
    while (!flip && (await page.evaluate(() => performance.now())) - t2 < 8_500) {
      await h.sleep(400);
      if (shots.length < 3 && !still) shots.push(await page.screenshot({ scale: 'css' }));
      const rig = (await h.readPlay(page))?.rig;
      if (rig) turned = Math.max(turned, deg(viewDir(s0), viewDir(rig)));
      flip = (await recorded(page, t2)).flashes.find((f) => /Flip/.test(f.flash)) ?? null;
    }
    for (const [i, png] of shots.entries()) await save(`spin-${i + 1}`, png);
    const spun = await rest(page, h, 15_000);
    const restMs = (await page.evaluate(() => performance.now())) - t2;
    const { flashes: spinFlashes } = await recorded(page, t2);
    data.spin = { flip, flashes: spinFlashes, turned, restMs };
    await save('spin-rest', await page.screenshot({ scale: 'css' }));
    if (still) {
      check('Still: Spin does nothing', !flip && deg(viewDir(s0), viewDir(spun.rig)) < 1e-3, JSON.stringify(spinFlashes));
    } else {
      check('Spin flips caffeine by itself within 8 s ("Flip! · tennis-racket effect")', flip?.flash === 'Flip! · tennis-racket effect' && flip.ms < 8_000, JSON.stringify(spinFlashes));
      check('the spin tumbles the view and comes to rest', turned > 20 && !spun.timedOut, `turned up to ${turned.toFixed(0)} deg, at rest ${Math.round(restMs)} ms after Spin`);
    }
  },
};
