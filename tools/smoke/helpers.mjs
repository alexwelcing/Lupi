/**
 * helpers.mjs - the viewer smoke's page and pixel helpers, shared by the
 * built-in scenarios in tools/verify-viewer-smoke.mjs and the scenario plugins
 * in tools/smoke/scenarios/*.mjs (which receive this module as `h`).
 *
 * Rendering is judged from page screenshots (never readPixels), so every
 * helper holds for WebGPURenderer on WebGPU and on its WebGL2 fallback.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const GALLERY_DATA = resolve(REPO_ROOT, 'packages/ui/src/gallery-data.json');

/** Per-wait timeout (the tool's --timeout) and the app base URL; set by configureHelpers. */
let timeout = 60_000;
let baseUrl = '';

/** Called by the smoke tool once its options and the app URL are known. */
function configureHelpers(options = {}) {
  if (Number.isFinite(options.timeout) && options.timeout > 0) timeout = options.timeout;
  if (typeof options.baseUrl === 'string') baseUrl = options.baseUrl;
}

/** The app base URL: the served app once known, else the page's own URL. */
function baseFor(page) {
  return new URL(baseUrl || page.url());
}

const gallery = loadGallery();

// ---------------------------------------------------------------------------
// Viewer helpers
// ---------------------------------------------------------------------------

async function openStructure({ page, check, outcome }, entry, loadTimeout = timeout) {
  outcome.url = new URL(`?sim=${encodeURIComponent(entry.id)}`, baseFor(page)).href;
  outcome.data.structure = entry;
  await page.goto(outcome.url, { waitUntil: 'commit', timeout });
  let status = null;
  try {
    await page.waitForFunction((expected) => {
      const bridge = window.__lupiViewerMcp;
      if (!bridge || bridge.ready !== true || typeof bridge.status !== 'function') return false;
      const current = bridge.status();
      return current.moleculeLoaded === true && current.atomCount > 0 && (expected == null || current.atomCount === expected);
    }, entry.atoms, { timeout: loadTimeout, polling: 250 });
    status = await page.evaluate(() => window.__lupiViewerMcp.status());
  } catch (error) {
    status = await page.evaluate(() => window.__lupiViewerMcp?.status?.() ?? null).catch(() => null);
    const alert = await rendererAlert(page);
    check(`${entry.id} loads through the MCP bridge`, false, `${alert ? `renderer fallback: ${alert}; ` : ''}status=${JSON.stringify(status)}; ${errorMessage(error).split('\n')[0]}`);
    return null;
  }
  outcome.data.status = status;
  check(`${entry.id} loads (${status.atomCount} atoms)`, entry.atoms == null || status.atomCount === entry.atoms, `expected ${entry.atoms ?? 'any'}`);

  const canvas = await mainCanvas(page);
  if (!canvas) {
    const alert = await rendererAlert(page);
    check('viewer canvas is present', false, alert ? `renderer fallback shown: ${alert}` : 'no visible canvas in the viewer');
    return null;
  }
  const box = await canvas.boundingBox();
  check('viewer canvas is sized', Boolean(box && box.width >= 100 && box.height >= 100), box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no box');
  const alert = await rendererAlert(page);
  if (alert) {
    check('no renderer fallback over the canvas', false, alert);
    return null;
  }
  // Tag the canvas so screenshots can hide every other element by CSS.
  await canvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
  return canvas;
}

async function mainCanvas(page) {
  const selectors = ['.lupine-main-viewport canvas', '#lupi-viewer-canvas canvas', 'canvas#lupi-viewer-canvas'];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        const box = await locator.boundingBox().catch(() => null);
        if (box && box.width >= 100 && box.height >= 100) return locator;
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function rendererAlert(page) {
  // RendererFallback / CanvasErrorBoundary fill the viewport region with a
  // role="alert" banner instead of a canvas.
  return page.evaluate(() => {
    const viewport = document.querySelector('.lupine-main-viewport') ?? document.body;
    const area = Math.max(1, viewport.getBoundingClientRect().width * viewport.getBoundingClientRect().height);
    for (const node of document.querySelectorAll('[role="alert"]')) {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if ((rect.width * rect.height) / area > 0.4) return node.textContent.replace(/\s+/g, ' ').trim().slice(0, 200);
    }
    return null;
  }).catch(() => null);
}

const HIDE_CHROME_CSS = 'body * { visibility: hidden !important; } [data-smoke-main] { visibility: visible !important; }';
const HIDE_ALL_CSS = 'body * { visibility: hidden !important; }';

const cdpSessions = new WeakMap();

async function cdpFor(page) {
  if (!cdpSessions.has(page)) cdpSessions.set(page, await page.context().newCDPSession(page));
  return cdpSessions.get(page);
}

/**
 * Screenshot the viewer canvas region with every other element hidden, at CSS
 * pixel size. Raw CDP capture is used instead of page.screenshot(): software
 * renderers run the viewer at a few frames per second, and Playwright's extra
 * font/caret/animation-frame round trips more than double the capture time.
 * The viewport is captured whole and cropped here: a clipped CDP capture
 * drops the page's emulated device scale factor (the phone profile would run
 * at DPR 1 after its first screenshot).
 */
async function captureCanvas(page, canvas, css = HIDE_CHROME_CSS) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('viewer canvas has no bounding box');
  const viewport = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.max(1, Math.min(Math.floor(box.width), (viewport?.width ?? box.width) - x));
  const height = Math.max(1, Math.min(Math.floor(box.height), (viewport?.height ?? box.height) - y));
  await page.evaluate((text) => {
    let style = document.getElementById('smoke-capture-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'smoke-capture-style';
      document.head.appendChild(style);
    }
    style.textContent = text;
  }, css);
  try {
    const client = await cdpFor(page);
    const { data } = await withTimeout(client.send('Page.captureScreenshot', { format: 'png' }), timeout, 'canvas capture');
    const full = decodePng(Buffer.from(data, 'base64'));
    const image = cropImage(full, { x, y, width, height }, full.width / (viewport?.width ?? full.width));
    return { png: encodePng(image), image };
  } finally {
    await page.evaluate(() => document.getElementById('smoke-capture-style')?.remove()).catch(() => {});
  }
}

/**
 * Wait until two captures 250 ms apart match. A software renderer under load
 * can take longer than that to draw one frame, so two matching captures alone
 * may straddle no frame at all, show an arrival still held under the opening
 * plate (captures hide the page's chrome), or show a frame the WebGPU canvas
 * has not yet replaced on screen: where the viewer reports its Play state
 * (`__lupiPlay`), the view is settled only with no arrival armed or running
 * and no display motion live, and when the frame loop sleeps or at least two
 * frames were drawn between the captures.
 */
async function waitSettled(page, canvas, minForeground, maxMs = 60_000) {
  const started = Date.now();
  let previous = await captureCanvas(page, canvas);
  let previousLoop = await frameLoop(page);
  let frames = 1;
  let lastDiff = null;
  while (Date.now() - started < maxMs) {
    await page.waitForTimeout(250);
    const current = await captureCanvas(page, canvas);
    const loop = await frameLoop(page);
    frames += 1;
    const area = current.image.width * current.image.height;
    lastDiff = diffImages(previous.image, current.image).changed / area;
    const fg = foreground(current.image).fraction;
    const drawn = loop && previousLoop ? loop.rendered - previousLoop.rendered : null;
    const quiet = !loop || (!loop.arriving && !loop.moving && (!loop.awake || (drawn != null && drawn >= 2)));
    previous = current;
    previousLoop = loop;
    if (lastDiff < 0.001 && fg >= minForeground && quiet) {
      return { ...current, meta: { settled: true, ms: Date.now() - started, frames, lastDiff } };
    }
  }
  return { ...previous, meta: { settled: false, ms: Date.now() - started, frames, lastDiff } };
}

/** The viewer's frame loop ({ rendered, awake, arriving, moving }), or null without the Play hooks. */
async function frameLoop(page) {
  return page.evaluate(() => {
    const state = window.__lupiPlay?.state?.();
    const demand = state?.frameDemand;
    if (!demand || !Number.isFinite(demand.rendered)) return null;
    return {
      rendered: demand.rendered,
      awake: demand.awake === true,
      arriving: Boolean(state.motion?.arrival),
      moving: state.motion?.active === true,
    };
  }).catch(() => null);
}

async function assessRender(page, canvas, image, minForeground) {
  const behind = await captureCanvas(page, canvas, HIDE_ALL_CSS);
  const contribution = diffImages(image, behind.image).changed / (image.width * image.height);
  const stats = imageStats(image);
  const fg = foreground(image);
  return {
    size: [image.width, image.height],
    canvasContribution: contribution,
    luminanceStd: stats.luminanceStd,
    distinctColors: stats.distinctColors,
    nonBlank: contribution > 0.002 && stats.luminanceStd > 1 && stats.distinctColors > 4,
    foregroundPixels: fg.count,
    foregroundFraction: fg.fraction,
    foregroundBox: fg.box,
    minForeground,
    hues: fg.hues,
  };
}

async function detectBackend(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-smoke-main]');
    const status = window.__lupiViewerMcp?.status?.() ?? {};
    const declared = status.rendererBackend ?? status.renderBackend ?? status.backend ?? status.renderer?.backend
      ?? canvas?.dataset?.rendererBackend ?? canvas?.dataset?.backend
      ?? canvas?.closest('[data-renderer-backend]')?.getAttribute('data-renderer-backend') ?? null;
    const result = {
      kind: 'unknown',
      source: 'none',
      declared: declared == null ? null : String(declared),
      webGPUSupported: status.webGPUSupported ?? null,
      engine: canvas?.getAttribute('data-engine') ?? null,
      probe: null,
      glRenderer: null,
      glVersion: null,
    };
    if (!canvas) return result;
    // getContext returns the canvas's EXISTING context for the matching type and
    // null for any other type, so this probe never creates or replaces one. It
    // only runs after the canvas has been proven to paint.
    try {
      if (canvas.getContext('webgpu')) result.probe = 'webgpu';
    } catch {
      // 'webgpu' is not a known context type without WebGPU.
    }
    if (!result.probe) {
      try {
        const gl = canvas.getContext('webgl2');
        if (gl) {
          result.probe = 'webgl2';
          const info = gl.getExtension('WEBGL_debug_renderer_info');
          result.glRenderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
          result.glVersion = String(gl.getParameter(gl.VERSION));
        }
      } catch {
        // Ignore.
      }
    }
    if (!result.probe) {
      try {
        if (canvas.getContext('webgl')) result.probe = 'webgl1';
      } catch {
        // Ignore.
      }
    }
    const declaredKind = result.declared?.toLowerCase() ?? '';
    if (declaredKind.includes('webgpu')) {
      result.kind = 'webgpu';
      result.source = 'app';
    } else if (declaredKind.includes('webgl')) {
      result.kind = declaredKind === 'webgl' || declaredKind === 'webgl1' ? 'webgl1' : 'webgl2';
      result.source = 'app';
    } else if (result.probe) {
      result.kind = result.probe;
      result.source = 'canvas-context-probe';
    }
    return result;
  }).catch((error) => ({ kind: 'unknown', source: `error: ${String(error?.message ?? error)}` }));
}

async function canvasPoint(page, canvas, fx, fy) {
  const box = await canvas.boundingBox();
  const preferred = { x: box.x + box.width * fx, y: box.y + box.height * fy };
  // Find a nearby point where the canvas itself wins hit-testing.
  const hit = await page.evaluate(({ px, py, bx, by, bw, bh }) => {
    const main = document.querySelector('[data-smoke-main]');
    const hits = (x, y) => document.elementFromPoint(x, y) === main;
    if (hits(px, py)) return { x: px, y: py };
    for (let r = 20; r < Math.max(bw, bh); r += 20) {
      for (let a = 0; a < 16; a += 1) {
        const x = px + r * Math.cos((a / 16) * Math.PI * 2);
        const y = py + r * Math.sin((a / 16) * Math.PI * 2);
        if (x > bx + 10 && x < bx + bw - 10 && y > by + 10 && y < by + bh - 10 && hits(x, y)) return { x, y };
      }
    }
    return { x: px, y: py };
  }, { px: preferred.x, py: preferred.y, bx: box.x, by: box.y, bw: box.width, bh: box.height });
  return { x: Math.round(hit.x), y: Math.round(hit.y) };
}

async function pickAtom({ page, spec, check, save, outcome }, canvas, image) {
  const box = await canvas.boundingBox();
  const candidates = atomCandidates(image, 8);
  const card = page.locator('[data-testid="atom-info-card"]');
  const tried = [];
  for (const candidate of candidates) {
    const point = { x: Math.round(box.x + candidate.x), y: Math.round(box.y + candidate.y) };
    const onCanvas = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute?.('data-smoke-main') ?? false, point);
    if (!onCanvas) {
      tried.push({ ...point, skipped: 'covered by DOM chrome' });
      continue;
    }
    if (isTouchProfile(spec.profile)) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    // The card follows the pick's frames: on SwiftShader under a shared
    // machine's load that took 4-9 s after the click.
    const shown = await card.first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    tried.push({ ...point, shown });
    if (shown) {
      const info = await card.first().evaluate((node) => ({
        atomIndex: node.getAttribute('data-atom-index'),
        layout: node.getAttribute('data-layout'),
        text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 120),
      }));
      outcome.data.pick = { input: isTouchProfile(spec.profile) ? 'tap' : 'click', tried, card: info };
      await save('picked', await page.screenshot({ scale: 'css' }));
      check(`${isTouchProfile(spec.profile) ? 'tapping' : 'clicking'} an atom opens the atom-info card`, true, `atom #${info.atomIndex} (${info.layout}) after ${tried.length} attempt(s): ${info.text.slice(0, 60)}`);
      return;
    }
  }
  outcome.data.pick = { input: isTouchProfile(spec.profile) ? 'tap' : 'click', tried, candidates: candidates.length };
  await save('pick-failed', await page.screenshot({ scale: 'css' }));
  check(`${isTouchProfile(spec.profile) ? 'tapping' : 'clicking'} an atom opens the atom-info card`, false, `no card after ${tried.length} attempt(s) on ${candidates.length} candidate(s)`);
}

// ---------------------------------------------------------------------------
// Gestures
//
// Drags pace their moves in real time (16 moves 16 ms apart, each awaited),
// wait until the page has handled the last move, then HOLD STILL for holdMs
// before releasing, so a drag cannot become a coast: the release is holdMs
// after the last move by event.timeStamp and by wall clock. No moves are sent
// during the hold (a real finger or mouse held still sends none either; touch
// moves that do not move are dropped by Chromium anyway).
//
// Flicks release at speed. Every event carries a planned CDP timestamp and is
// dispatched on schedule without waiting for the page, so event.timeStamp
// shows the intended speed even when a software renderer keeps the main
// thread busy and the events arrive in a burst. A rig must therefore measure
// release velocity from event.timeStamp, never from performance.now() at
// handling time.
//
// Touch gestures (touchDrag, touchFlick, pinch, twoFingerDrag) need a context
// with hasTouch (the phone and phone390 profiles).
// ---------------------------------------------------------------------------

const DRAG_STEPS = 16;
const DRAG_STEP_MS = 16;

/** True for the touch device profiles (phone, phone390). */
function isTouchProfile(profile) {
  return profile === 'phone' || profile === 'phone390';
}

/** Epoch milliseconds with sub-millisecond resolution (CDP timestamps are epoch seconds). */
function epochMs() {
  return performance.timeOrigin + performance.now();
}

/** Resolve once the page's main thread has run a frame, i.e. handled the input queued before it. */
async function inputHandled(page) {
  await withTimeout(page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done()))), 5_000, 'input settle').catch(() => {});
}

async function touchEvent(client, type, points, timestampMs) {
  return client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : points.map((point, index) => ({ x: point.x, y: point.y, id: index + 1 })),
    ...(timestampMs == null ? {} : { timestamp: timestampMs / 1000 }),
  });
}

/** Press at start, move by {dx, dy} in 16 steps 16 ms apart, hold still holdMs, release. */
async function mouseDrag(page, start, { dx, dy }, { holdMs = 150 } = {}) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= DRAG_STEPS; i += 1) {
    await page.mouse.move(start.x + (dx * i) / DRAG_STEPS, start.y + (dy * i) / DRAG_STEPS);
    await page.waitForTimeout(DRAG_STEP_MS);
  }
  if (holdMs > 0) {
    await inputHandled(page);
    await page.waitForTimeout(holdMs);
  }
  await page.mouse.up();
}

/** One finger: touch at start, move by {dx, dy} in 16 steps 16 ms apart, hold still holdMs, lift. */
async function touchDrag(page, start, { dx, dy }, { holdMs = 150 } = {}) {
  const points = (i) => [{ x: start.x + (dx * i) / DRAG_STEPS, y: start.y + (dy * i) / DRAG_STEPS }];
  await touchStroke(page, points, { holdMs });
}

/** Two fingers `gap` px apart (horizontally) move together by {dx, dy}, hold still holdMs, lift. */
async function twoFingerDrag(page, start, { dx, dy }, { gap = 80, holdMs = 150 } = {}) {
  const points = (i) => {
    const x = start.x + (dx * i) / DRAG_STEPS;
    const y = start.y + (dy * i) / DRAG_STEPS;
    return [{ x: x - gap / 2, y }, { x: x + gap / 2, y }];
  };
  await touchStroke(page, points, { holdMs });
}

/**
 * Two fingers centred on `center`, `fromPx` apart, spread (or close) to `toPx`
 * apart over `ms`, hold still holdMs, lift. `angle` (degrees) turns the finger
 * axis from horizontal.
 */
async function pinch(page, center, { fromPx = 80, toPx = 220, ms = 256, holdMs = 150, angle = 0 } = {}) {
  const steps = Math.max(4, Math.round(ms / DRAG_STEP_MS));
  const ux = Math.cos((angle * Math.PI) / 180);
  const uy = Math.sin((angle * Math.PI) / 180);
  const points = (i) => {
    const half = (fromPx + ((toPx - fromPx) * i) / steps) / 2;
    return [{ x: center.x - ux * half, y: center.y - uy * half }, { x: center.x + ux * half, y: center.y + uy * half }];
  };
  await touchStroke(page, points, { holdMs, steps, stepMs: ms / steps });
}

/** Touch down at points(0), move through points(1..steps) in real time, hold, lift. */
async function touchStroke(page, points, { holdMs = 150, steps = DRAG_STEPS, stepMs = DRAG_STEP_MS } = {}) {
  const client = await cdpFor(page);
  await touchEvent(client, 'touchStart', points(0));
  for (let i = 1; i <= steps; i += 1) {
    await touchEvent(client, 'touchMove', points(i));
    await page.waitForTimeout(stepMs);
  }
  if (holdMs > 0) {
    await inputHandled(page);
    await page.waitForTimeout(holdMs);
  }
  await touchEvent(client, 'touchEnd', []);
}

/**
 * Play timed events (`at` ms from now) on schedule with planned timestamps,
 * without waiting for the page between them; resolves when all are acknowledged.
 */
async function playTimed(events, send) {
  const origin = epochMs();
  const pending = [];
  for (const event of events) {
    const wait = origin + event.at - epochMs();
    if (wait > 1) await sleep(wait);
    pending.push(send(event, origin + event.at));
  }
  await Promise.all(pending);
}

function flickPlan(start, { dx, dy }, ms) {
  const steps = Math.max(4, Math.round(ms / DRAG_STEP_MS));
  const plan = [{ type: 'down', at: 0, x: start.x, y: start.y }];
  for (let i = 1; i <= steps; i += 1) plan.push({ type: 'move', at: (ms * i) / steps, x: start.x + (dx * i) / steps, y: start.y + (dy * i) / steps });
  // Lift half a frame after the last move: released at full speed.
  plan.push({ type: 'up', at: ms + 8, x: start.x + dx, y: start.y + dy });
  return plan;
}

/** Press at start and throw the pointer by {dx, dy} in `ms`, releasing at speed. */
async function mouseFlick(page, start, { dx, dy }, { ms = 120 } = {}) {
  const client = await cdpFor(page);
  await page.mouse.move(start.x, start.y);
  const type = { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' };
  await playTimed(flickPlan(start, { dx, dy }, ms), (event, at) => client.send('Input.dispatchMouseEvent', {
    type: type[event.type],
    x: event.x,
    y: event.y,
    button: 'left',
    buttons: event.type === 'up' ? 0 : 1,
    clickCount: event.type === 'move' ? 0 : 1,
    timestamp: at / 1000,
  }));
}

/** One finger thrown by {dx, dy} in `ms`, lifting at speed. */
async function touchFlick(page, start, { dx, dy }, { ms = 120 } = {}) {
  const client = await cdpFor(page);
  const type = { down: 'touchStart', move: 'touchMove', up: 'touchEnd' };
  await playTimed(flickPlan(start, { dx, dy }, ms), (event, at) => touchEvent(client, type[event.type], [event], at));
}

// ---------------------------------------------------------------------------
// Frames and play state
// ---------------------------------------------------------------------------

/**
 * What the screen showed, every `every` ms for `ms`: floor(ms / every) + 1
 * full-viewport PNG Buffers (CSS-pixel size, DOM chrome visible; decode with
 * decodePng()).
 *
 * Frames come from a CDP screencast, so every frame the page presents is seen
 * at the rate it presents them (software renderers manage a few per second;
 * polled screenshots would add seconds each). The timeline starts at the first
 * presented frame; slot i holds the latest frame presented at or before
 * i * every ms, so a page that presents nothing new repeats its last frame.
 * Each Buffer carries `t` (the slot, ms) and `frameT` (when the frame it shows
 * was presented, ms, <= t): count distinct `frameT` values for distinct frames.
 * One sampleFrames per page at a time.
 */
async function sampleFrames(page, { ms = 500, every = 50 } = {}) {
  const client = await cdpFor(page);
  const step = Math.max(1, every);
  const count = Math.max(1, Math.floor(ms / step) + 1);
  const presented = [];
  let wake = null;
  const onFrame = ({ data, metadata, sessionId }) => {
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const at = Number.isFinite(metadata?.timestamp) ? metadata.timestamp * 1000 : Date.now();
    presented.push({ at, png: Buffer.from(data, 'base64') });
    wake?.();
  };
  const nextFrame = (maxMs) => new Promise((done) => {
    const timer = setTimeout(done, maxMs);
    wake = () => {
      clearTimeout(timer);
      done();
    };
  });
  const viewport = page.viewportSize();
  client.on('Page.screencastFrame', onFrame);
  try {
    await client.send('Page.startScreencast', {
      format: 'png',
      everyNthFrame: 1,
      ...(viewport ? { maxWidth: viewport.width, maxHeight: viewport.height } : {}),
    });
    if (presented.length === 0) await nextFrame(Math.min(timeout, 15_000));
    if (presented.length === 0) {
      // Nothing presented yet: seed the timeline with a forced capture.
      const { data } = await withTimeout(client.send('Page.captureScreenshot', { format: 'png' }), timeout, 'frame capture');
      presented.push({ at: Date.now(), png: Buffer.from(data, 'base64') });
    }
    const origin = presented[0].at;
    const end = origin + (count - 1) * step;
    while (Date.now() < end) await nextFrame(end - Date.now());
    // Frames reach us a few ms after they are presented.
    await sleep(100);
  } finally {
    wake = null;
    client.off('Page.screencastFrame', onFrame);
    await client.send('Page.stopScreencast').catch(() => {});
  }
  presented.sort((a, b) => a.at - b.at);
  const origin = presented[0].at;
  const frames = [];
  let shown = 0;
  for (let i = 0; i < count; i += 1) {
    const t = i * step;
    while (shown + 1 < presented.length && presented[shown + 1].at - origin <= t) shown += 1;
    const source = presented[shown].png;
    const png = Buffer.from(source.buffer, source.byteOffset, source.length);
    png.t = t;
    png.frameT = Math.round(presented[shown].at - origin);
    frames.push(png);
  }
  return frames;
}

/** The Play store's state (window.__lupiPlay.state()), or null when it is absent. */
async function readPlay(page) {
  return page.evaluate(() => window.__lupiPlay?.state?.() ?? null).catch(() => null);
}

/**
 * Emit a Lupi intent exactly as the UI would (window.__lupiPlay.emit), e.g.
 * { type: 'play.spin' } before the pill that emits it exists. Resolves false
 * when the Play hooks are absent.
 */
async function playEmit(page, intent) {
  return page
    .evaluate((value) => {
      const play = window.__lupiPlay;
      if (typeof play?.emit !== 'function') return false;
      play.emit(value);
      return true;
    }, intent)
    .catch(() => false);
}

// ---------------------------------------------------------------------------
// Pixel analysis (pure Node; screenshots only, never readPixels)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'PLTE') palette = chunk;
    else if (type === 'tRNS') transparency = chunk;
    else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (bitDepth=${bitDepth}, interlace=${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colorType ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = value & 0xff;
    }
    previous = out;
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i += 1, j += channels) {
    let r;
    let g;
    let b;
    let alpha = 255;
    if (colorType === 0 || colorType === 4) {
      r = g = b = pixels[j];
      if (colorType === 4) alpha = pixels[j + 1];
    } else if (colorType === 3) {
      const index = pixels[j];
      r = palette[index * 3];
      g = palette[index * 3 + 1];
      b = palette[index * 3 + 2];
      if (transparency && index < transparency.length) alpha = transparency[index];
    } else {
      r = pixels[j];
      g = pixels[j + 1];
      b = pixels[j + 2];
      if (colorType === 6) alpha = pixels[j + 3];
    }
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = alpha;
  }
  return { width, height, data };
}

/** The CSS-pixel rectangle `rect` of an image captured at `scale` image pixels per CSS pixel. */
function cropImage(source, rect, scale) {
  const data = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row += 1) {
    const sy = Math.min(source.height - 1, Math.floor((rect.y + row + 0.5) * scale));
    for (let column = 0; column < rect.width; column += 1) {
      const sx = Math.min(source.width - 1, Math.floor((rect.x + column + 0.5) * scale));
      const from = (sy * source.width + sx) * 4;
      data.set(source.data.subarray(from, from + 4), (row * rect.width + column) * 4);
    }
  }
  return { width: rect.width, height: rect.height, data };
}

/** RGBA8 image to PNG (filter 0, zlib). */
function encodePng(image) {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let row = 0; row < image.height; row += 1) {
    Buffer.from(image.data.buffer, image.data.byteOffset + row * stride, stride).copy(raw, row * (stride + 1) + 1);
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const DIFF_THRESHOLD = 40;

function diffImages(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { changed: a.width * a.height, sizeMismatch: true };
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    if (d > DIFF_THRESHOLD) changed += 1;
  }
  return { changed };
}

function imageStats(image) {
  let sum = 0;
  let sumSq = 0;
  const colors = new Set();
  const count = image.width * image.height;
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += lum;
    sumSq += lum * lum;
    if (colors.size < 4096) colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
  }
  const mean = sum / count;
  return { luminanceMean: mean, luminanceStd: Math.sqrt(Math.max(0, sumSq / count - mean * mean)), distinctColors: colors.size };
}

/**
 * Background model: a Coons patch through the median colours of a thin band
 * along each edge (smoothed over neighbouring rows/columns). It reproduces
 * flat plates and linear/bilinear gradients exactly, so pixels far from it
 * are the rendered structure.
 */
function backgroundModel(image, band = 6, window = 8) {
  const { width: w, height: h, data } = image;
  const median = (values) => {
    values.sort((x, y) => x - y);
    return values[values.length >> 1] ?? 0;
  };
  const edge = (length, sample) => {
    const out = new Float32Array(length * 3);
    for (let k = 0; k < length; k += 1) {
      const channels = [[], [], []];
      for (let m = Math.max(0, k - window); m <= Math.min(length - 1, k + window); m += 1) {
        for (let t = 0; t < band; t += 1) {
          const index = sample(m, t) * 4;
          channels[0].push(data[index]);
          channels[1].push(data[index + 1]);
          channels[2].push(data[index + 2]);
        }
      }
      for (let c = 0; c < 3; c += 1) out[k * 3 + c] = median(channels[c]);
    }
    return out;
  };
  const left = edge(h, (y, t) => y * w + t);
  const right = edge(h, (y, t) => y * w + (w - 1 - t));
  const top = edge(w, (x, t) => t * w + x);
  const bottom = edge(w, (x, t) => (h - 1 - t) * w + x);
  const corner = (c) => [
    (left[c] + top[c]) / 2,
    (right[c] + top[(w - 1) * 3 + c]) / 2,
    (left[(h - 1) * 3 + c] + bottom[c]) / 2,
    (right[(h - 1) * 3 + c] + bottom[(w - 1) * 3 + c]) / 2,
  ];
  const corners = [corner(0), corner(1), corner(2)];
  return (x, y, c) => {
    const u = w > 1 ? x / (w - 1) : 0;
    const v = h > 1 ? y / (h - 1) : 0;
    const [c00, c10, c01, c11] = corners[c];
    return (1 - u) * left[y * 3 + c] + u * right[y * 3 + c]
      + (1 - v) * top[x * 3 + c] + v * bottom[x * 3 + c]
      - ((1 - u) * (1 - v) * c00 + u * (1 - v) * c10 + (1 - u) * v * c01 + u * v * c11);
  };
}

function foregroundMask(image) {
  const { width: w, height: h, data } = image;
  const bg = backgroundModel(image);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const d = Math.max(
        Math.abs(data[i] - bg(x, y, 0)),
        Math.abs(data[i + 1] - bg(x, y, 1)),
        Math.abs(data[i + 2] - bg(x, y, 2)),
      );
      if (d > DIFF_THRESHOLD) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function foreground(image) {
  const { width: w, height: h, data } = image;
  const mask = foregroundMask(image);
  let count = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const hues = { red: 0, blue: 0, neutral: 0, other: 0 };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r >= 110 && r > 1.8 * g && r > 1.8 * b) hues.red += 1;
      else if (b >= 90 && b > 1.4 * r && b > 1.15 * g) hues.blue += 1;
      else if (Math.max(r, g, b) - Math.min(r, g, b) < 28) hues.neutral += 1;
      else hues.other += 1;
    }
  }
  return {
    mask,
    count,
    fraction: count / (w * h),
    box: count ? [minX, minY, maxX, maxY] : null,
    hues,
  };
}

/** Densest foreground spots (atom bodies), best first, spread apart. */
function atomCandidates(image, limit) {
  const { width: w, height: h } = image;
  const { mask } = foreground(image);
  const integral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y += 1) {
    let row = 0;
    for (let x = 1; x <= w; x += 1) {
      row += mask[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }
  const sum = (x0, y0, x1, y1) => integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
  const radius = 7;
  const scored = [];
  for (let y = radius + 12; y < h - radius - 12; y += 3) {
    for (let x = radius + 12; x < w - radius - 12; x += 3) {
      if (!mask[y * w + x]) continue;
      const score = sum(x - radius, y - radius, x + radius + 1, y + radius + 1);
      scored.push({ x, y, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || Math.hypot(a.x - w / 2, a.y - h / 2) - Math.hypot(b.x - w / 2, b.y - h / 2));
  const picked = [];
  for (const candidate of scored) {
    if (picked.every((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) > 30)) picked.push(candidate);
    if (picked.length >= limit) break;
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function galleryEntry(id) {
  const entry = gallery.get(id);
  const parsed = entry ? Number.parseInt(String(entry.atoms).replace(/,/g, ''), 10) : Number.NaN;
  return { id, title: entry?.title ?? id, atoms: Number.isFinite(parsed) && parsed > 0 && parsed < 50_000_000 ? parsed : null };
}

function loadGallery() {
  try {
    const rows = JSON.parse(readFileSync(GALLERY_DATA, 'utf8'));
    return new Map(rows.map((row) => [row.id, row]));
  } catch {
    return new Map();
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function errorMessage(error) {
  return String(error?.message ?? error);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

export {
  configureHelpers,
  baseFor,
  openStructure,
  mainCanvas,
  rendererAlert,
  HIDE_CHROME_CSS,
  HIDE_ALL_CSS,
  cdpFor,
  captureCanvas,
  waitSettled,
  assessRender,
  detectBackend,
  canvasPoint,
  pickAtom,
  isTouchProfile,
  mouseDrag,
  touchDrag,
  mouseFlick,
  touchFlick,
  pinch,
  twoFingerDrag,
  sampleFrames,
  readPlay,
  playEmit,
  PNG_SIGNATURE,
  decodePng,
  cropImage,
  encodePng,
  DIFF_THRESHOLD,
  diffImages,
  imageStats,
  backgroundModel,
  foregroundMask,
  foreground,
  atomCandidates,
  galleryEntry,
  loadGallery,
  withTimeout,
  pct,
  errorMessage,
  sleep,
};
