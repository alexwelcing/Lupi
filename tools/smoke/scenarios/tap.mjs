/**
 * tap.mjs - WP4 tap grammar and picking on C60 (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=tap --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/tap
 *
 * 1. A tap on an atom opens its card (the built-in pickAtom check) and the
 *    camera does not move at all.
 * 2. Desktop: the cursor is a pointer over an atom and a grab hand off it.
 * 3. A double-tap on empty space zooms 40 % toward that point (the point
 *    under the finger stays put) and its first tap closes the card.
 * 4. Back at the opening pose, a double-tap on the atom glides to it: the
 *    atom ends at the centre, at most 12 Å away, seen from the same direction
 *    (the desktop card sits beside the atom, so the second tap reaches it).
 *
 * Double-taps are sent with planned CDP timestamps 120 ms apart, so the
 * 300 ms window holds even when a software renderer handles them late.
 * Poses come from window.__lupiPlay.state().rig; screen positions are
 * computed from them (fov 50, y-up), as in camera.mjs.
 */

const ID = 'c60_buckyball';
const FOV = 50;
const FOCUS_MAX = 12;

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

function basis(rig) {
  const f = unit(sub(rig.target, rig.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f) };
}

/** The unit ray through a client point. */
function rayThrough(rig, box, point) {
  const { f, r, u } = basis(rig);
  const t = Math.tan((FOV * Math.PI) / 360);
  const nx = ((point.x - box.x) / box.width) * 2 - 1;
  const ny = 1 - ((point.y - box.y) / box.height) * 2;
  return unit(add(add(f, mul(r, nx * t * (box.width / box.height))), mul(u, ny * t)));
}

/** World point on the target plane under a client point. */
function unproject(rig, box, point) {
  const { f } = basis(rig);
  const dir = rayThrough(rig, box, point);
  return add(rig.position, mul(dir, dot(sub(rig.target, rig.position), f) / dot(dir, f)));
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

/** Poll until the rig is mounted and at rest. */
async function rest(page, h, maxMs = 8_000) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < maxMs) {
    state = await h.readPlay(page);
    if (state?.rig && !state.rig.moving) return { state, timedOut: false };
    await h.sleep(50);
  }
  return { state, timedOut: true };
}

/** Atom positions of the active frame, through lupi.export_xyz. */
async function atomPositions(page) {
  const out = await page.evaluate(() => window.__lupiViewerMcp.execute({ id: 'tap-xyz', tool: 'lupi.export_xyz', arguments: {} }));
  const lines = String(out?.result?.export?.contents ?? '').split('\n');
  const count = Number.parseInt(lines[0], 10) || 0;
  return lines.slice(2, 2 + count).map((line) => line.trim().split(/\s+/).slice(1, 4).map(Number));
}

/**
 * A client point on the bare canvas whose pointer ray passes > 3 Å from every
 * atom (the picker's solid radius is 2.4 Å), nearest the canvas edge middle.
 */
async function emptyPoint(page, box, rig, atoms) {
  const fractions = [[0.12, 0.3], [0.88, 0.3], [0.12, 0.7], [0.88, 0.7], [0.12, 0.12], [0.88, 0.12], [0.5, 0.1], [0.5, 0.9], [0.12, 0.88], [0.88, 0.88]];
  for (const [fx, fy] of fractions) {
    const point = { x: Math.round(box.x + box.width * fx), y: Math.round(box.y + box.height * fy) };
    const dir = rayThrough(rig, box, point);
    const clear = atoms.every((a) => {
      const d = sub(a, rig.position);
      return dot(d, dir) <= 0 || len(cross(d, dir)) > 3;
    });
    if (!clear) continue;
    const onCanvas = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute?.('data-smoke-main') ?? false, point);
    if (onCanvas) return point;
  }
  return null;
}

/** Two taps (or clicks) at one point, 120 ms apart by event.timeStamp. */
async function doubleTap(page, h, touch, point) {
  const client = await h.cdpFor(page);
  if (!touch) await page.mouse.move(point.x, point.y);
  const clock = () => performance.timeOrigin + performance.now();
  const origin = clock();
  const plan = [
    { at: 0, down: true, count: 1 },
    { at: 40, down: false, count: 1 },
    { at: 120, down: true, count: 2 },
    { at: 160, down: false, count: 2 },
  ];
  const sent = [];
  for (const step of plan) {
    const wait = origin + step.at - clock();
    if (wait > 1) await h.sleep(wait);
    const timestamp = (origin + step.at) / 1000;
    sent.push(touch
      ? client.send('Input.dispatchTouchEvent', {
        type: step.down ? 'touchStart' : 'touchEnd',
        touchPoints: step.down ? [{ x: point.x, y: point.y, id: 1 }] : [],
        timestamp,
      })
      : client.send('Input.dispatchMouseEvent', {
        type: step.down ? 'mousePressed' : 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: step.down ? 1 : 0,
        clickCount: step.count,
        timestamp,
      }));
  }
  await Promise.all(sent);
}

async function cursorAt(page, point, wanted, maxMs = 4_000) {
  const started = Date.now();
  let cursor = null;
  while (Date.now() - started < maxMs) {
    cursor = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element ? getComputedStyle(element).cursor : null;
    }, point);
    if (cursor === wanted) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  return cursor;
}

const card = (page) => page.locator('[data-testid="atom-info-card"]').first();

export default {
  name: 'tap',
  profiles: ['desktop', 'phone', 'phone390'],
  description: 'Tap grammar on C60: a tap picks without moving the camera, a double-tap glides to the atom, a double-tap on empty space zooms toward it.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const data = (outcome.data.tap = {});
    const canvas = await h.openStructure(ctx, h.galleryEntry(ID));
    if (!canvas) return;
    const settled = await h.waitSettled(page, canvas, 0.01);
    await save('start', settled.png);
    const r0 = await rest(page, h);
    if (!check('the Lupi camera rig is mounted', r0.state?.rig, JSON.stringify(r0.state?.rig ?? null))) return;
    const before = r0.state.rig;
    const atoms = await atomPositions(page);
    const box = await canvas.boundingBox();

    // 1. A tap picks, and the camera stays exactly where it was.
    await h.pickAtom(ctx, canvas, settled.image);
    const pick = outcome.data.pick;
    const tapPoint = pick?.tried?.find((attempt) => attempt.shown);
    if (!tapPoint) return;
    await h.sleep(1_000);
    const after = (await rest(page, h)).state.rig;
    const moved = Math.max(maxDiff(before.position, after.position), maxDiff(before.target, after.target));
    data.tap = { point: tapPoint, atom: pick.card.atomIndex, moved, distance: [distance(before), distance(after)] };
    await save('tap-still', (await h.captureCanvas(page, canvas)).png);
    check(
      'a tap on an atom leaves the camera where it was',
      moved < 1e-6,
      `moved ${moved.toExponential(2)}; distance ${distance(before).toFixed(3)} -> ${distance(after).toFixed(3)} Å`,
    );

    // 2. Desktop cursor: a pointer over an atom, a grab hand off it.
    if (!touch) {
      const empty = await emptyPoint(page, box, after, atoms);
      await page.mouse.move(tapPoint.x + 1, tapPoint.y);
      const over = await cursorAt(page, tapPoint, 'pointer');
      await save('hover', await page.screenshot({ scale: 'css' }));
      const off = empty ? (await page.mouse.move(empty.x, empty.y), await cursorAt(page, empty, 'grab')) : null;
      data.cursor = { over, off, empty };
      check('the cursor is a pointer over an atom and a grab hand off it', over === 'pointer' && off === 'grab', `over=${over}, off=${off}`);
    }

    // 3. A double-tap on empty space zooms 40 % toward it; its first tap closes the card.
    const empty = await emptyPoint(page, box, after, atoms);
    if (!check('an empty spot on the canvas is available', empty)) return;
    const world = unproject(after, box, empty);
    await doubleTap(page, h, touch, empty);
    const zoomedRest = await rest(page, h, 10_000);
    const zoomed = zoomedRest.state.rig;
    const ratio = distance(zoomed) / distance(after);
    const landed = project(zoomed, box, world);
    const drift = Math.hypot(landed.x - empty.x, landed.y - empty.y);
    const cardOpen = await card(page).isVisible().catch(() => false);
    data.zoom = { point: empty, ratio, drift, cardOpen, timedOut: zoomedRest.timedOut };
    await save('zoomed', (await h.captureCanvas(page, canvas)).png);
    check(
      'a double-tap on empty space zooms 40 % toward it',
      Math.abs(ratio - 0.6) < 0.02 && drift < 4 && !zoomedRest.timedOut,
      `distance x${ratio.toFixed(3)}, the point under the ${touch ? 'finger' : 'cursor'} moved ${drift.toFixed(1)} px`,
    );
    check('the tap on empty space closes the atom card', !cardOpen);

    // 4. Back to the opening pose (an MCP camera write is an instant snap),
    // then a double-tap on the atom glides to it.
    await page.evaluate((pose) => window.__lupiViewerMcp.execute({ id: 'tap-reset', tool: 'lupi.set_camera', arguments: pose }), { position: after.position, target: after.target });
    const reset = (await rest(page, h)).state.rig;
    await doubleTap(page, h, touch, tapPoint);
    const focusedRest = await rest(page, h, 10_000);
    const focused = focusedRest.state.rig;
    const focusIndex = Number(await card(page).getAttribute('data-atom-index').catch(() => null));
    const atom = atoms[focusIndex];
    const expected = Math.min(distance(reset), FOCUS_MAX);
    const off = atom ? len(sub(focused.target, atom)) : Number.POSITIVE_INFINITY;
    const turned = deg(angle(viewDir(reset), viewDir(focused)));
    data.focus = { atom: focusIndex, off, from: distance(reset), distance: distance(focused), expected, turned, timedOut: focusedRest.timedOut };
    await save('focused', await page.screenshot({ scale: 'css' }));
    check(
      'a double-tap on an atom glides to it (centred, <= 12 Å, same view direction)',
      off < 0.02 && Math.abs(distance(focused) - expected) < 0.05 && turned < 0.5 && !focusedRest.timedOut,
      `atom #${focusIndex}: target ${off.toFixed(3)} Å off, distance ${distance(reset).toFixed(2)} -> ${distance(focused).toFixed(2)} Å (expected ${expected.toFixed(2)}), turned ${turned.toFixed(2)} deg`,
    );
  },
};
