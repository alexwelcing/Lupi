/**
 * pick.mjs - a core atom is clickable on its own pixels (LOCAL smoke plugin,
 * not CI). GPU truth for the atom picker: what the renderer DREW decides
 * which atom a pixel belongs to, and a click there must pick that atom.
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=pick --backend=both \
 *     --profile=desktop,phone390 --strict-backend --timeout=180000 \
 *     --out=.verify-artifacts/pick
 *
 * On SwiftShader a desktop run takes about 20 minutes and a phone390 run
 * about 10 (the 12,000-atom glass draws at a few seconds a frame).
 * PICK_CASES=atp,lone (any of sio2_glass, atp, lone) runs only those parts.
 *
 * 1. Core atoms among their neighbours: silicon in the gallery SiO2 glass
 *    (desktop: the opening fit and a view 0.6x closer along the same
 *    direction; touch: the closer view only, since SwiftShader draws the
 *    12,000 atoms at DPR 3 slowly) and the phosphorus of ATP (the opening
 *    view, then turned views until enough P shows). Each view is captured
 *    four times: as drawn (A), with the target element hidden (B), with
 *    every other element hidden (C), and restored. A pixel belongs to the
 *    target element when hiding it changes the pixel (A != B) and hiding
 *    everything else does not (A ~ C): the target atom is the front-most
 *    thing drawn there. No colour table and no CPU ray cast decide it; the
 *    GPU does. Chamfer distance transforms of that mask and of "anything
 *    drawn" (A != B or A != C) find points well inside the visible part of
 *    a target disc that also lie well inside the drawn structure (a core
 *    atom with neighbours drawn around it, not one on the outline).
 *    Each point is clicked (desktop) or tapped (touch): the atom card must
 *    name the target element, and the picked atom's centre must lie within
 *    a drawn radius of the pointer ray. On desktop the point is hovered
 *    first: the cursor must be a pointer and the hover glow (the lime rim
 *    the impostor draws on the hovered atom) must land on pixels where the
 *    target element is front-most, at least twice as many as on pixels
 *    where another element is.
 *    ATP also checks the bond rule: a P-O stick is split-coloured per half;
 *    its pixels change under both hides and lose their hue in the capture
 *    that still draws their element (a sphere pixel keeps it). The deepest
 *    such pixel in P's rendered orange must pick P, in O's red O.
 * 2. A lone Si atom (loaded through lupi.generate_molecule) at a known
 *    distance: its silhouette radius is measured from the screenshot
 *    (as drawn, hidden vs shown). A tap a few px outside the silhouette
 *    picks it on touch (near-miss tolerance 14 CSS px); a mouse click the
 *    same distance away does not (5 px), a mouse click 2 px outside does;
 *    a tap far outside picks nothing; a tap on clear background picks
 *    nothing and closes an open card.
 *
 * Interactions are spaced by full settles; between picks the card is closed
 * with Escape and (on a phone) the view inset is allowed to ease back, then
 * the view is checked against the classified capture before the next pick.
 * Debug overlays (target mask tinted, points marked green = right element,
 * magenta = wrong) are saved per view.
 */

const SYMBOL_Z = { H: 1, He: 2, Li: 3, B: 5, C: 6, N: 7, O: 8, F: 9, Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, K: 19, Ca: 20, Cu: 29 };

/** A pixel is "changed" above this max-channel difference (helpers' DIFF_THRESHOLD). */
const CHANGED = 40;
/** A pixel is "the same" at or below this (hiding neighbours moves AO/shadows a little). */
const SAME = 26;
/** Points must be at least this many CSS px inside the visible target region. */
const MIN_INSET_PX = 2.5;
/** Hover glow: changed pixels above this, within this window of the point. */
const GLOW_CHANGED = 18;

/**
 * views: desktop (mouse) and touch lists. `core` is how far (CSS px) beyond
 * the point's own inset the drawn structure must reach on every side, so a
 * point is a CORE atom among neighbours, never one on the outline against
 * the plate. SwiftShader draws the 12,000-atom glass at a few seconds a
 * frame (more at DPR 3), so SiO2 takes few points and one view on a phone.
 */
const CASES = [
  {
    id: 'sio2_glass',
    symbol: 'Si',
    core: 8,
    desktop: { want: 5, views: [{ name: 'fit', points: 3 }, { name: 'closer', zoom: 0.6, points: 2 }] },
    touch: { want: 3, views: [{ name: 'closer', zoom: 0.6, points: 3 }] },
  },
  {
    id: 'atp',
    symbol: 'P',
    core: 3,
    // P-O bonds are split-coloured: a pixel both hides change (a bond to P)
    // in P's orange is the P half, in O's red the O half.
    bondHalves: {
      view: 'fit',
      other: 'O',
      hue: (r, g, b) => {
        if (r < 90) return null;
        if (g >= 0.3 * r && g <= 0.75 * r && b <= 0.35 * r) return 'P';
        if (g <= 0.22 * r && b <= 0.22 * r) return 'O';
        return null;
      },
    },
    desktop: { want: 4, views: ATP_VIEWS(2) },
    touch: { want: 4, views: ATP_VIEWS(2) },
  },
];

function ATP_VIEWS(points) {
  return [
    { name: 'fit', points },
    { name: 'yaw60', yaw: 60, points },
    { name: 'yaw150', yaw: 150, points },
    { name: 'yaw240', yaw: 240, points },
    { name: 'pitch40', yaw: 30, pitch: 40, points },
    { name: 'pitch-40', yaw: 300, pitch: -40, points },
  ];
}

const LONE = { symbol: 'Si', distance: 22 };

// ---------------------------------------------------------------------------
// Small vector helpers (y-up camera, fov 50, as tap.mjs and camera.mjs)
// ---------------------------------------------------------------------------

const FOV = 50;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / (len(a) || 1));

function rayThrough(rig, box, point) {
  const f = unit(sub(rig.target, rig.position));
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const t = Math.tan((FOV * Math.PI) / 360);
  const nx = ((point.x - box.x) / box.width) * 2 - 1;
  const ny = 1 - ((point.y - box.y) / box.height) * 2;
  return unit(add(add(f, mul(r, nx * t * (box.width / box.height))), mul(u, ny * t)));
}

/** Perpendicular distance (Å) from the pointer ray to a world point in front of the camera. */
function rayMiss(rig, box, point, world) {
  const dir = rayThrough(rig, box, point);
  const d = sub(world, rig.position);
  return dot(d, dir) <= 0 ? Number.POSITIVE_INFINITY : len(cross(d, dir));
}

function rotateAbout(rig, yawDeg = 0, pitchDeg = 0) {
  const offset = sub(rig.position, rig.target);
  const yaw = (yawDeg * Math.PI) / 180;
  let o = [offset[0] * Math.cos(yaw) + offset[2] * Math.sin(yaw), offset[1], -offset[0] * Math.sin(yaw) + offset[2] * Math.cos(yaw)];
  if (pitchDeg) {
    const radius = len(o);
    const flat = Math.hypot(o[0], o[2]) || 1e-9;
    const elevation = Math.atan2(o[1], flat) + (pitchDeg * Math.PI) / 180;
    const clamped = Math.max(-1.3, Math.min(1.3, elevation));
    o = [(o[0] / flat) * Math.cos(clamped) * radius, Math.sin(clamped) * radius, (o[2] / flat) * Math.cos(clamped) * radius];
  }
  return { position: add(rig.target, o), target: rig.target };
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function mcp(page, tool, args = {}) {
  return page.evaluate(({ tool: name, args: body }) => window.__lupiViewerMcp.execute({ id: `pick-${name}-${Date.now()}`, tool: name, arguments: body }), { tool, args });
}

async function atomTable(page) {
  const out = await mcp(page, 'lupi.export_xyz');
  const lines = String(out?.result?.export?.contents ?? '').split('\n');
  const count = Number.parseInt(lines[0], 10) || 0;
  return lines.slice(2, 2 + count).map((line) => {
    const parts = line.trim().split(/\s+/);
    return { symbol: parts[0], position: parts.slice(1, 4).map(Number) };
  });
}

async function viewer(page) {
  return (await mcp(page, 'lupi.viewer_state'))?.result?.viewer ?? {};
}

async function rest(page, h, maxMs = 15_000) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < maxMs) {
    state = await h.readPlay(page);
    if (state?.rig && !state.rig.moving) return state.rig;
    await h.sleep(100);
  }
  return state?.rig ?? null;
}

/** Wait for the phone view inset (the card's room) to be back at identity. */
async function framingAtRest(page, h, maxMs = 15_000) {
  const started = Date.now();
  let framing = null;
  while (Date.now() - started < maxMs) {
    framing = await page.evaluate(() => window.__lupiPlay?.viewInset?.() ?? null).catch(() => null);
    if (!framing) return null;
    const c = framing.current;
    const t = framing.target;
    const identity = (v) => v && Math.abs(v.x) < 0.5 && Math.abs(v.y) < 0.5 && Math.abs(v.scale - 1) < 0.002;
    if (identity(c) && identity(t)) return framing;
    await h.sleep(150);
  }
  return framing;
}

const cardLocator = (page) => page.locator('[data-testid="atom-info-card"]').first();

async function cardIndex(page) {
  const card = cardLocator(page);
  if (!(await card.isVisible().catch(() => false))) return null;
  const value = await card.getAttribute('data-atom-index').catch(() => null);
  return value == null ? null : Number(value);
}

/** Wait until the card is visible (returns its index) or maxMs passes (null). */
async function waitCard(page, h, maxMs) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const index = await cardIndex(page);
    if (index != null) return index;
    await h.sleep(120);
  }
  return null;
}

async function closeCard(page, h) {
  await page.keyboard.press('Escape');
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (!(await cardLocator(page).isVisible().catch(() => false))) return true;
    await h.sleep(120);
  }
  return false;
}

async function onCanvas(page, point) {
  return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute?.('data-smoke-main') ?? false, point);
}

async function cursorAt(page, h, point, wanted, maxMs = 6_000) {
  const started = Date.now();
  let cursor = null;
  while (Date.now() - started < maxMs) {
    cursor = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element ? getComputedStyle(element).cursor : null;
    }, point);
    if (cursor === wanted) break;
    await h.sleep(100);
  }
  return cursor;
}

async function press(page, touch, point) {
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

// ---------------------------------------------------------------------------
// Pixel helpers (CSS-px canvas captures)
// ---------------------------------------------------------------------------

function maxDiffAt(a, b, i) {
  const j = i * 4;
  return Math.max(Math.abs(a.data[j] - b.data[j]), Math.abs(a.data[j + 1] - b.data[j + 1]), Math.abs(a.data[j + 2] - b.data[j + 2]));
}

/**
 * owned: the target element is front-most (A != B, A ~ C); other: another
 * element is (A != C, A ~ B); drawn: some atom or bond is (A != B or A != C).
 */
function classify(A, B, C) {
  const n = A.width * A.height;
  const owned = new Uint8Array(n);
  const other = new Uint8Array(n);
  const drawn = new Uint8Array(n);
  let ownedCount = 0;
  for (let i = 0; i < n; i += 1) {
    const dB = maxDiffAt(A, B, i);
    const dC = maxDiffAt(A, C, i);
    if (dB > CHANGED || dC > CHANGED) drawn[i] = 1;
    if (dB > CHANGED && dC <= SAME) {
      owned[i] = 1;
      ownedCount += 1;
    } else if (dC > CHANGED && dB <= SAME) other[i] = 1;
  }
  return { owned, other, drawn, ownedCount };
}

/** Chamfer (3-4) distance, in px, from each mask pixel to the nearest non-mask pixel (outside the image counts as non-mask). */
function chamfer(mask, w, h) {
  const d = new Float32Array(w * h);
  const BIG = 1e9;
  for (let i = 0; i < w * h; i += 1) d[i] = mask[i] ? BIG : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < w * h; i += 1) d[i] /= 3;
  return d;
}

/**
 * Deepest points of the mask, spread apart, away from the image border, and
 * at least `core` px deeper inside the drawn structure than inside their own
 * region (a core atom among neighbours).
 */
function deepPoints(dist, depth, w, h, { minInset, core, limit, margin = 14, spread = 18 }) {
  const scored = [];
  for (let y = margin; y < h - margin; y += 1) {
    for (let x = margin; x < w - margin; x += 1) {
      const v = dist[y * w + x];
      if (v >= minInset && depth[y * w + x] >= v + core) scored.push({ x, y, inset: v, depth: depth[y * w + x] });
    }
  }
  scored.sort((a, b) => b.inset - a.inset || Math.hypot(a.x - w / 2, a.y - h / 2) - Math.hypot(b.x - w / 2, b.y - h / 2));
  const picked = [];
  for (const candidate of scored) {
    if (picked.every((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) > Math.max(spread, 2 * other.inset))) picked.push(candidate);
    if (picked.length >= limit) break;
  }
  return picked;
}

function changedFraction(a, b) {
  let changed = 0;
  for (let i = 0; i < a.width * a.height; i += 1) if (maxDiffAt(a, b, i) > CHANGED) changed += 1;
  return changed / (a.width * a.height);
}

/** The view A with the target mask tinted cyan and each point marked (green ok, magenta wrong, yellow untested). */
function overlay(h, A, owned, points) {
  const data = new Uint8ClampedArray(A.data);
  for (let i = 0; i < A.width * A.height; i += 1) {
    if (!owned[i]) continue;
    data[i * 4] = (data[i * 4] + 0) >> 1;
    data[i * 4 + 1] = (data[i * 4 + 1] + 255) >> 1;
    data[i * 4 + 2] = (data[i * 4 + 2] + 255) >> 1;
  }
  for (const point of points) {
    const colour = point.ok === true ? [40, 255, 40] : point.ok === false ? [255, 0, 255] : [255, 255, 0];
    for (let k = -6; k <= 6; k += 1) {
      for (const [x, y] of [[point.x + k, point.y], [point.x, point.y + k]]) {
        if (x < 0 || y < 0 || x >= A.width || y >= A.height || Math.abs(k) < 2) continue;
        const j = (y * A.width + x) * 4;
        data[j] = colour[0];
        data[j + 1] = colour[1];
        data[j + 2] = colour[2];
      }
    }
  }
  return h.encodePng({ width: A.width, height: A.height, data });
}

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

export default {
  name: 'pick',
  profiles: ['desktop', 'phone', 'phone390'],
  description: 'A core atom (SiO2 Si, ATP P) is picked on its own drawn pixels; hover glows it; near-miss tolerance per pointer; background picks nothing.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome, log } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const verb = touch ? 'tapping' : 'clicking';
    const data = (outcome.data.picking = { cases: [], lone: null });

    const only = process.env.PICK_CASES ? new Set(process.env.PICK_CASES.split(',').map((value) => value.trim())) : null;
    let canvas = null;
    for (const testCase of CASES.filter((entry) => !only || only.has(entry.id))) {
      const plan = touch ? testCase.touch : testCase.desktop;
      const record = { id: testCase.id, symbol: testCase.symbol, views: [], points: [] };
      data.cases.push(record);
      canvas = await h.openStructure(ctx, h.galleryEntry(testCase.id));
      if (!canvas) return;
      const box = await canvas.boundingBox();
      await h.waitSettled(page, canvas, 0.002, 90_000);
      const opening = await rest(page, h);
      const atoms = await atomTable(page);
      const state = await viewer(page);
      const atomScale = Number(state.atomScale) || 1;
      const zs = [...new Set(atoms.map((atom) => SYMBOL_Z[atom.symbol]).filter(Number.isFinite))];
      const targetZ = SYMBOL_Z[testCase.symbol];
      record.atomScale = atomScale;
      record.elements = zs;
      if (!check(`${testCase.id} has ${testCase.symbol} atoms with known types`, zs.includes(targetZ) && zs.length >= 2 && opening, `types ${zs.join(',')}; rig ${opening ? 'ok' : 'missing'}`)) continue;

      // Desktop: the mouse rests over DOM chrome (not the canvas), so nothing is hovered.
      const park = touch ? null : await page.evaluate(() => {
        const main = document.querySelector('[data-smoke-main]');
        for (const [x, y] of [[40, 36], [window.innerWidth - 40, 40], [40, window.innerHeight - 30]]) {
          const element = document.elementFromPoint(x, y);
          if (element && element !== main && element !== document.body && element !== document.documentElement) return { x, y };
        }
        return null;
      });
      const parkMouse = async () => {
        if (park) await page.mouse.move(park.x, park.y);
      };
      await parkMouse();

      for (const view of plan.views) {
        if (record.points.filter((pt) => pt.ok !== null).length >= plan.want) break;
        const viewRecord = { name: view.name };
        record.views.push(viewRecord);
        let pose = opening;
        if (view.zoom || view.yaw || view.pitch) {
          pose = rotateAbout(opening, view.yaw ?? 0, view.pitch ?? 0);
          if (view.zoom) pose = { position: add(pose.target, mul(sub(pose.position, pose.target), view.zoom)), target: pose.target };
        }
        await mcp(page, 'lupi.set_camera', { position: pose.position, target: pose.target });
        await mcp(page, 'lupi.set_atom_visibility', { hiddenAtomTypes: [] });
        await parkMouse();
        const A = await h.waitSettled(page, canvas, 0.002, 90_000);
        const rig = await rest(page, h);
        await mcp(page, 'lupi.set_atom_visibility', { hiddenAtomTypes: [targetZ] });
        const B = await h.waitSettled(page, canvas, 0.0005, 90_000);
        await mcp(page, 'lupi.set_atom_visibility', { hiddenAtomTypes: zs.filter((z) => z !== targetZ) });
        const C = await h.waitSettled(page, canvas, 0.0002, 90_000);
        await mcp(page, 'lupi.set_atom_visibility', { hiddenAtomTypes: [] });
        const A2 = await h.waitSettled(page, canvas, 0.002, 90_000);
        const restored = changedFraction(A.image, A2.image);
        viewRecord.settled = [A, B, C, A2].map((capture) => capture.meta.settled);
        viewRecord.settleMs = [A, B, C, A2].map((capture) => capture.meta.ms);
        viewRecord.restored = restored;
        viewRecord.rig = rig;
        const { width: w, height: hh } = A.image;
        const cls = classify(A.image, B.image, C.image);
        const dist = chamfer(cls.owned, w, hh);
        const depth = chamfer(cls.drawn, w, hh);
        let maxInset = 0;
        for (let i = 0; i < dist.length; i += 1) if (dist[i] > maxInset) maxInset = dist[i];
        const points = deepPoints(dist, depth, w, hh, { minInset: MIN_INSET_PX, core: testCase.core, limit: view.points });
        viewRecord.ownedPixels = cls.ownedCount;
        viewRecord.maxInsetPx = Number(maxInset.toFixed(2));
        viewRecord.candidates = points.map((p) => ({ x: p.x, y: p.y, inset: Number(p.inset.toFixed(2)), depth: Number(p.depth.toFixed(1)) }));
        await save(`${testCase.id}-${view.name}-A`, A.png);
        log(`[pick] ${spec.backend}/${spec.profile} ${testCase.id} ${view.name}: ${cls.ownedCount} ${testCase.symbol}-front-most px, max inset ${maxInset.toFixed(1)} px, ${points.length} point(s), restored diff ${h.pct(restored)}, settle ms ${viewRecord.settleMs.join('/')}`);
        if (restored > 0.003) {
          viewRecord.skipped = 'the restored view does not match the classified one';
          await save(`${testCase.id}-${view.name}-A2`, A2.png);
          continue;
        }
        // The glow's pixels are judged by what is front-most there (no dilation:
        // at a 5 px disc a dilated mask would swallow the neighbours).
        const ownedNear = cls.owned;
        const otherNear = cls.other;
        let base = A2.image;

        for (const p of points) {
          const point = { x: Math.round(box.x + p.x), y: Math.round(box.y + p.y) };
          const startedAt = Date.now();
          const attempt = { view: view.name, x: point.x, y: point.y, inset: Number(p.inset.toFixed(2)), depth: Number(p.depth.toFixed(1)), ok: null };
          record.points.push(attempt);
          if (!(await onCanvas(page, point))) {
            attempt.skipped = 'covered by DOM chrome';
            continue;
          }
          if (!touch) {
            // Hover: the cursor and the impostor's glow.
            await page.mouse.move(point.x, point.y);
            attempt.cursor = await cursorAt(page, h, point, 'pointer');
            const H = await h.waitSettled(page, canvas, 0.002, 30_000);
            const win = Math.max(28, Math.round(6 * p.inset));
            let changed = 0;
            let onTarget = 0;
            let onOther = 0;
            let nearest = Number.POSITIVE_INFINITY;
            for (let y = Math.max(0, p.y - win); y < Math.min(hh, p.y + win); y += 1) {
              for (let x = Math.max(0, p.x - win); x < Math.min(w, p.x + win); x += 1) {
                const i = y * w + x;
                if (maxDiffAt(base, H.image, i) <= GLOW_CHANGED) continue;
                changed += 1;
                if (ownedNear[i]) onTarget += 1;
                else if (otherNear[i]) onOther += 1;
                nearest = Math.min(nearest, Math.hypot(x - p.x, y - p.y));
              }
            }
            attempt.hover = { changed, onTarget, onOther, nearestPx: Number.isFinite(nearest) ? Number(nearest.toFixed(1)) : null, settled: H.meta.settled };
            attempt.hoverOk = attempt.cursor === 'pointer' && changed >= 4 && onTarget > 2 * onOther && nearest <= 2 * p.inset + 3;
            if (!attempt.hoverOk) await save(`${testCase.id}-${view.name}-hover-${record.points.length}`, H.png);
          }
          // On a phone the press must land with the view inset at rest (no card open).
          if (touch) {
            const framing = await framingAtRest(page, h, 5_000);
            attempt.framingAtPress = !framing || (Math.abs(framing.current.x) < 0.5 && Math.abs(framing.current.y) < 0.5 && Math.abs(framing.current.scale - 1) < 0.002);
          }
          await press(page, touch, point);
          const index = await waitCard(page, h, 20_000);
          attempt.picked = index;
          attempt.symbol = index == null ? null : atoms[index]?.symbol ?? '?';
          attempt.ok = attempt.symbol === testCase.symbol;
          if (index != null && atoms[index] && rig && attempt.framingAtPress !== false) {
            attempt.rayMissA = Number(rayMiss(rig, box, point, atoms[index].position).toFixed(3));
          }
          if (!attempt.ok) await save(`${testCase.id}-${view.name}-wrong-${record.points.length}`, await page.screenshot({ scale: 'css' }));
          if (index != null) await closeCard(page, h);
          await parkMouse();
          if (touch) attempt.framing = await framingAtRest(page, h);
          await rest(page, h);
          const back = await h.waitSettled(page, canvas, 0.002, 60_000);
          attempt.returned = Number(changedFraction(base, back.image).toFixed(5));
          if (attempt.returned > 0.003) {
            log(`[pick] view did not return after a pick (${h.pct(attempt.returned)} changed); re-classifying is out of scope, stopping this view`);
            await save(`${testCase.id}-${view.name}-not-returned`, back.png);
            break;
          }
          base = back.image;
          attempt.ms = Date.now() - startedAt;
        }

        // Bond halves: a click on the P half of a P-O stick picks P, on its O half O.
        const halves = testCase.bondHalves;
        if (halves && view.name === halves.view && !record.bondHalves) {
          record.bondHalves = [];
          const masks = { [testCase.symbol]: new Uint8Array(w * hh), [halves.other]: new Uint8Array(w * hh) };
          // A stick half: its element's hue in A, changed by both hides, and that
          // hue gone where the element is still drawn (C keeps the target, B
          // keeps the other): a sphere pixel whose shading moved with a
          // neighbour's contact occlusion keeps its hue there; a stick shows
          // what is behind it.
          const hueAt = (image, i) => halves.hue(image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]);
          for (let i = 0; i < w * hh; i += 1) {
            if (maxDiffAt(A.image, B.image, i) <= CHANGED || maxDiffAt(A.image, C.image, i) <= CHANGED) continue;
            const hue = hueAt(A.image, i);
            if (!hue || !masks[hue]) continue;
            const keeps = hue === testCase.symbol ? C.image : B.image;
            if (hueAt(keeps, i) !== hue) masks[hue][i] = 1;
          }
          for (const [symbol, mask] of Object.entries(masks)) {
            const halfDist = chamfer(mask, w, hh);
            const [q] = deepPoints(halfDist, halfDist, w, hh, { minInset: 1.5, core: Number.NEGATIVE_INFINITY, limit: 1 });
            const entry = { half: symbol, ok: null };
            record.bondHalves.push(entry);
            if (!q) continue;
            const point = { x: Math.round(box.x + q.x), y: Math.round(box.y + q.y) };
            Object.assign(entry, { x: point.x, y: point.y, inset: Number(q.inset.toFixed(2)) });
            if (!(await onCanvas(page, point))) {
              entry.skipped = 'covered by DOM chrome';
              continue;
            }
            if (touch) await framingAtRest(page, h, 5_000);
            await press(page, touch, point);
            const index = await waitCard(page, h, 20_000);
            entry.picked = index;
            entry.symbol = index == null ? null : atoms[index]?.symbol ?? '?';
            entry.ok = entry.symbol === symbol;
            if (!entry.ok) await save(`${testCase.id}-${view.name}-bond-${symbol}-wrong`, await page.screenshot({ scale: 'css' }));
            if (index != null) await closeCard(page, h);
            await parkMouse();
            if (touch) await framingAtRest(page, h);
            await rest(page, h);
            await h.waitSettled(page, canvas, 0.002, 60_000);
          }
          await save(`${testCase.id}-${view.name}-bond-halves`, overlay(h, A.image, masks[testCase.symbol], record.bondHalves.filter((entry) => entry.x != null)));
        }
        await save(`${testCase.id}-${view.name}-points`, overlay(h, A.image, cls.owned, record.points.filter((pt) => pt.view === view.name)));
      }

      const tried = record.points.filter((pt) => pt.ok !== null);
      const right = tried.filter((pt) => pt.ok);
      const describe = (pt) => `(${pt.x},${pt.y}) inset ${pt.inset}px -> ${pt.picked == null ? 'nothing' : `#${pt.picked} ${pt.symbol}`}`;
      log(`[pick] ${spec.backend}/${spec.profile} ${testCase.id}: ${tried.map((pt) => `${pt.view}(${pt.x},${pt.y}) in${pt.inset}/core${pt.depth} -> ${pt.symbol ?? 'none'}${pt.hover ? ` hover ${pt.hover.onTarget}/${pt.hover.onOther}` : ''} ${pt.ms ?? '?'}ms`).join('; ')}`);
      check(
        `${testCase.id}: ${testCase.symbol} pixels well inside drawn discs are found`,
        tried.length >= Math.min(2, plan.want),
        `${tried.length} point(s) tried over ${record.views.length} view(s); views ${record.views.map((v) => `${v.name}:${v.ownedPixels ?? '-'}px/inset ${v.maxInsetPx ?? '-'}`).join(', ')}`,
      );
      check(
        `${testCase.id}: ${verb} on ${testCase.symbol}'s own pixels picks ${testCase.symbol}`,
        tried.length > 0 && right.length === tried.length,
        `${right.length}/${tried.length} right${tried.length > right.length ? `; wrong: ${tried.filter((pt) => !pt.ok).map(describe).join('; ')}` : ''}`,
      );
      const bound = 0.75 * atomScale * 1.1;
      const rayOk = right.filter((pt) => pt.rayMissA != null);
      check(
        `${testCase.id}: the picked atom lies under the pointer`,
        rayOk.length > 0 && rayOk.every((pt) => pt.rayMissA <= bound),
        `ray-to-centre ${rayOk.map((pt) => pt.rayMissA).join(', ')} Å (bound ${bound.toFixed(2)} Å)`,
      );
      if (testCase.bondHalves) {
        const halves = record.bondHalves ?? [];
        const describeHalf = (entry) => `${entry.half} half${entry.x != null ? ` (${entry.x},${entry.y}) inset ${entry.inset}px` : ' not found'} -> ${entry.picked == null ? 'nothing' : `#${entry.picked} ${entry.symbol}`}`;
        check(
          `${testCase.id}: ${verb} a ${testCase.symbol}-${testCase.bondHalves.other} bond picks the atom of the half under the pointer`,
          halves.length === 2 && halves.every((entry) => entry.ok === true),
          halves.map(describeHalf).join('; ') || 'no bond pixels',
        );
      }
      if (!touch) {
        const hovered = tried.filter((pt) => pt.hover);
        check(
          `${testCase.id}: hovering ${testCase.symbol}'s own pixels shows a pointer and glows that ${testCase.symbol}`,
          hovered.length > 0 && hovered.every((pt) => pt.hoverOk),
          hovered.map((pt) => `${pt.cursor}:${pt.hover.onTarget}/${pt.hover.onOther}@${pt.hover.nearestPx}`).join('; '),
        );
      }
    }

    // ── 2. A lone atom: the near-miss tolerance per pointer, and empty space. ──
    if (only && !only.has('lone')) return;
    if (!canvas) {
      canvas = await h.openStructure(ctx, h.galleryEntry('atp'));
      if (!canvas) return;
    }
    const lone = (data.lone = {});
    const loaded = await mcp(page, 'lupi.generate_molecule', { inputType: 'xyz', input: `1\nlone ${LONE.symbol}\n${LONE.symbol} 0 0 0` });
    lone.load = { ok: loaded?.ok, error: loaded?.error ?? null };
    const ready = await page.waitForFunction(() => window.__lupiViewerMcp.status().atomCount === 1, null, { timeout: 60_000, polling: 250 }).then(() => true, () => false);
    if (!check('a lone Si atom loads through lupi.generate_molecule', ready && loaded?.ok, JSON.stringify(lone.load))) return;
    await mcp(page, 'lupi.set_camera', { position: [0, 0, LONE.distance], target: [0, 0, 0] });
    await h.sleep(500);
    const loneBox = await canvas.boundingBox();
    const park = touch ? null : await page.evaluate(() => {
      const main = document.querySelector('[data-smoke-main]');
      for (const [x, y] of [[40, 36], [window.innerWidth - 40, 40]]) {
        const element = document.elementFromPoint(x, y);
        if (element && element !== main && element !== document.body && element !== document.documentElement) return { x, y };
      }
      return null;
    });
    if (park) await page.mouse.move(park.x, park.y);
    const L = await h.waitSettled(page, canvas, 0.0005, 60_000);
    await mcp(page, 'lupi.set_atom_visibility', { hiddenAtomTypes: [SYMBOL_Z[LONE.symbol]] });
    const L0 = await h.waitSettled(page, canvas, 0, 60_000);
    await mcp(page, 'lupi.set_atom_visibility', { hiddenAtomTypes: [] });
    const L2 = await h.waitSettled(page, canvas, 0.0005, 60_000);
    await save('lone', L2.png);
    const { width: lw, height: lh } = L.image;
    // The drawn disc: pixels the atom changes (bright ones; the floor shadow below is darker).
    let sx = 0;
    let sy = 0;
    let n = 0;
    const disc = new Uint8Array(lw * lh);
    for (let i = 0; i < lw * lh; i += 1) {
      if (maxDiffAt(L.image, L0.image, i) <= CHANGED) continue;
      const lum = (j) => 0.2126 * j.data[i * 4] + 0.7152 * j.data[i * 4 + 1] + 0.0722 * j.data[i * 4 + 2];
      if (lum(L.image) <= lum(L0.image)) continue;
      disc[i] = 1;
      sx += i % lw;
      sy += Math.floor(i / lw);
      n += 1;
    }
    if (!check('the lone atom is drawn', n > 50, `${n} px`)) return;
    const cx = Math.round(sx / n);
    const cy = Math.round(sy / n);
    const extent = (dx, dy) => {
      let r = 0;
      for (let k = 0; k < Math.max(lw, lh); k += 1) {
        const x = cx + dx * k;
        const y = cy + dy * k;
        if (x < 0 || y < 0 || x >= lw || y >= lh) break;
        if (disc[y * lw + x]) r = k;
      }
      return r + 0.5;
    };
    const extents = { left: extent(-1, 0), right: extent(1, 0), up: extent(0, -1) };
    const radius = [extents.left, extents.right, extents.up].sort((a, b) => a - b)[1];
    lone.disc = { cx, cy, radius, extents, area: n, areaRadius: Number(Math.sqrt(n / Math.PI).toFixed(2)) };
    const client = (dx) => ({ x: Math.round(loneBox.x + cx - (radius + dx)), y: Math.round(loneBox.y + cy) });
    const results = (lone.taps = []);
    const tryAt = async (label, point, { expectPick, mouse = !touch }) => {
      const result = { label, x: point.x, y: point.y, onCanvas: await onCanvas(page, point) };
      results.push(result);
      if (!result.onCanvas) return result;
      if (mouse) {
        await page.mouse.move(point.x, point.y);
        result.cursor = await cursorAt(page, h, point, expectPick ? 'pointer' : 'grab', 4_000);
      }
      await press(page, !mouse, point);
      result.picked = await waitCard(page, h, expectPick ? 20_000 : 6_000);
      result.ok = expectPick ? result.picked === 0 : result.picked == null;
      if (result.picked != null) await closeCard(page, h);
      if (park) await page.mouse.move(park.x, park.y);
      if (touch) await framingAtRest(page, h);
      await h.waitSettled(page, canvas, 0.0005, 30_000);
      return result;
    };
    // Clear background: the canvas point farthest from the atom that the canvas owns.
    const corner = await h.canvasPoint(page, canvas, 0.12, 0.3);
    const far = Math.hypot(corner.x - (loneBox.x + cx), corner.y - (loneBox.y + cy));
    const background = far > radius + 60 ? corner : await h.canvasPoint(page, canvas, 0.85, 0.3);
    const bg = await tryAt('clear background', background, { expectPick: false });
    check(`${verb} clear background picks nothing`, bg.onCanvas && bg.ok, JSON.stringify(bg));
    if (touch) {
      const outside = await tryAt('touch, silhouette + 22 px', client(22), { expectPick: false });
      check('a tap 22 px outside the silhouette picks nothing (touch tolerance 14 px)', outside.onCanvas && outside.ok, JSON.stringify(outside));
      const nearMiss = await tryAt('touch, silhouette + 8 px', client(8), { expectPick: true });
      check('a tap 8 px outside a lone atom\'s silhouette picks it (touch tolerance 14 px)', nearMiss.onCanvas && nearMiss.ok, JSON.stringify(nearMiss));
    } else {
      const outside = await tryAt('mouse, silhouette + 9 px', client(9), { expectPick: false });
      check('a click 9 px outside the silhouette picks nothing (mouse tolerance 5 px) and the cursor stays a grab hand', outside.onCanvas && outside.ok && outside.cursor === 'grab', JSON.stringify(outside));
      const nearMiss = await tryAt('mouse, silhouette + 2 px', client(2), { expectPick: true });
      check('a click 2 px outside a lone atom\'s silhouette picks it (mouse tolerance 5 px) with a pointer cursor', nearMiss.onCanvas && nearMiss.ok && nearMiss.cursor === 'pointer', JSON.stringify(nearMiss));
    }
    // With a card open, a tap on clear background closes it.
    const inside = { x: Math.round(loneBox.x + cx), y: Math.round(loneBox.y + cy) };
    await press(page, touch, inside);
    const opened = await waitCard(page, h, 20_000);
    if (touch) await framingAtRest(page, h).catch(() => null);
    await h.sleep(400);
    await press(page, touch, background);
    const closedAt = Date.now();
    let closed = false;
    while (Date.now() - closedAt < 15_000) {
      if (!(await cardLocator(page).isVisible().catch(() => false))) {
        closed = true;
        break;
      }
      await h.sleep(150);
    }
    lone.closeByBackground = { opened, closed };
    check('a tap on the atom opens its card and a tap on clear background closes it', opened === 0 && closed, JSON.stringify(lone.closeByBackground));
    await save('lone-end', (await h.captureCanvas(page, canvas)).png);
  },
};
