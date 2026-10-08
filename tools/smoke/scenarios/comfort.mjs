/**
 * comfort.mjs - Motion comfort for the Light Fuse and the morph arrival
 * (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=comfort --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/comfort
 *
 * One page, opened on C60. Each comfort level in turn is chosen in the Play
 * tray's Motion row (a tap on a phone), then:
 * 1. The level holds: `__lupiPlay.state().comfort` reads it.
 * 2. The tray's Ink: Standard and Gentle burn a Light Fuse along the bonds
 *    (mode 'graph'). Its front runs at the same pace at both (a change of
 *    look is not motion): the drawn frames bound its run (the last frame
 *    still burning and the frame it ended on, timed by
 *    `frameDemand.lastFrameAgoMs`) around INK_FUSE_MS x the smoke pace
 *    (`ink('pace', 20)`: a loaded software renderer draws a frame every few
 *    seconds). Still burns no fuse and fades nothing: the look cuts to ink
 *    between two frames.
 * 3. The tray's Lit brings the light back the same way.
 * 4. A switch through the molecule switcher (key 7 on the desktop; on a
 *    phone the command deck's Switch sheet, which stays open, so the morph
 *    plays under its view inset): Standard morphs over 0.9 s at full travel,
 *    Gentle over 0.55 s at half the travel (`state().motion.feel`), and it
 *    lands when the display-motion clock has run that long: the clock steps
 *    with the wall but at most 0.1 s a drawn frame (PlayLayer MAX_STEP_S),
 *    so the frames' own times give its reading at each frame. Still does not
 *    morph and nothing moves: the new molecule cuts in.
 * 5. Quiet Idle once it is over: the frame counter stands still.
 * The switches: Standard C60 -> caffeine, Gentle caffeine -> benzene, Still
 * benzene -> water. Mid-fuse and mid-morph frames are saved for the eye.
 * The level is chosen in the page, so --reduced-motion only changes where
 * it starts.
 */

const START = 'c60_buckyball';
/** The fuse's whole run at the visitor's pace (ink/InkLookDriver.tsx INK_FUSE_MS). */
const INK_FUSE_MS = 1100;
/** The morph's length (s) and travel per level (play/PlayLayer.tsx MORPH_D, arrivalFeel). */
const MORPH_FEEL = { standard: { duration: 0.9, weight: 1 }, gentle: { duration: 0.55, weight: 0.5 } };
const LEVELS = [
  { level: 'standard', label: 'Standard', to: { title: 'Caffeine', atoms: 24 } },
  { level: 'gentle', label: 'Gentle', to: { title: 'Benzene', atoms: 12 } },
  { level: 'still', label: 'Still', to: { title: 'Water', atoms: 3 } },
];
const HIDE_ID = 'comfort-hide-chrome';

/** Page-side: every animation frame, the look, the fuse and the arrival, stamped. */
function installRecorder() {
  const rec = { log: [], on: false };
  window.__comfort = rec;
  const tick = () => {
    if (rec.on) {
      const play = window.__lupiPlay;
      const ink = play?.ink?.() ?? null;
      const state = play?.state?.() ?? null;
      const motion = state?.motion ?? null;
      rec.log.push({
        // Epoch ms, as the CDP screencast stamps its frames.
        t: performance.timeOrigin + performance.now(),
        frames: state?.frames ?? null,
        // When the last drawn frame ran (epoch ms): the time the fuse stepped on.
        frameAt: state?.frameDemand?.lastFrameAgoMs >= 0 ? performance.timeOrigin + performance.now() - state.frameDemand.lastFrameAgoMs : null,
        mix: ink ? Math.round(ink.mix * 1000) / 1000 : null,
        fading: ink?.fading ?? null,
        fuse: ink?.fuse ? { running: ink.fuse.running, progress: ink.fuse.progress, mode: ink.fuse.mode } : null,
        arrival: motion?.arrival ?? null,
        active: motion?.active ?? null,
        feel: motion?.feel ?? null,
        atoms: window.__lupiViewerMcp?.status?.()?.atomCount ?? null,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const recorder = {
  start: (page) => page.evaluate(() => {
    window.__comfort.log = [];
    window.__comfort.on = true;
  }),
  stop: (page) => page.evaluate(() => {
    window.__comfort.on = false;
    return window.__comfort.log;
  }),
};

const ink = (page, ...args) => page.evaluate((a) => window.__lupiPlay?.ink?.(...a) ?? null, args);

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
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return async () => {
    await h.sleep(150);
    client.off('Page.screencastFrame', onFrame);
    await client.send('Page.stopScreencast').catch(() => {});
    return frames.sort((a, b) => a.at - b.at);
  };
}

/** A presented frame cropped to the canvas at the device's own pixels. */
function deviceCrop(h, page, png, box) {
  const full = h.decodePng(png);
  const scale = full.width / (page.viewportSize()?.width ?? full.width);
  const rect = { x: Math.floor(box.x * scale), y: Math.floor(box.y * scale), width: Math.floor(box.width * scale), height: Math.floor(box.height * scale) };
  return h.encodePng(h.cropImage(full, rect, 1));
}

/** Wait until the look has stopped changing: no fade and no fuse running. */
async function lookAtRest(page, h, maxMs = 90_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const state = await ink(page);
    if (state && !state.fading && !state.fuse?.running && !state.holding) return true;
    await h.sleep(100);
  }
  return false;
}

/** Wait until nothing moves: no arrival, the rig at rest, and the frame counter still. */
async function viewAtRest(page, h, maxMs = 60_000) {
  const deadline = Date.now() + maxMs;
  let last = null;
  while (Date.now() < deadline) {
    const play = await h.readPlay(page);
    const frames = play?.frames ?? null;
    if (play && play.motion?.arrival == null && play.rig?.moving !== true && frames !== null && frames === last) return true;
    last = frames;
    await h.sleep(700);
  }
  return false;
}

/** Open the Play tray (the pill's "Play" button). */
async function openTray(page, touch) {
  const pill = page.getByRole('button', { name: 'Play: toys and view' });
  const menu = page.locator('[data-lupi-pill] [role="menu"]');
  if (!(await menu.isVisible().catch(() => false))) {
    if (touch) await pill.tap();
    else await pill.click();
  }
  // A loaded software renderer can hold the main thread for seconds a frame.
  await menu.waitFor({ state: 'visible', timeout: 30_000 });
  return menu;
}

async function closeTray(page) {
  const menu = page.locator('[data-lupi-pill] [role="menu"]');
  if (await menu.isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
}

/** Motion: <label> in the tray. */
async function chooseComfort(page, touch, label) {
  const menu = await openTray(page, touch);
  const item = menu.getByRole('menuitemradio', { name: label, exact: true });
  if (touch) await item.tap();
  else await item.click();
  await closeTray(page);
}

/** Look: Lit or Ink in the tray (it closes the tray). */
async function chooseLook(page, touch, label) {
  const menu = await openTray(page, touch);
  const item = menu.getByRole('menuitemradio', { name: label, exact: true });
  if (touch) await item.tap({ noWaitAfter: true });
  else await item.click({ noWaitAfter: true });
}

/** The switcher: key 7 on the desktop, the command deck's Switch sheet on a phone. */
async function openSwitcher(page, touch) {
  const input = page.locator('input[aria-label="Switch molecule"]').first();
  if (!(await input.isVisible().catch(() => false))) {
    if (touch) await page.getByRole('button', { name: 'Switch command', exact: true }).tap();
    else await page.keyboard.press('7');
  }
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  return input;
}

async function closeSwitcher(page, touch) {
  const input = page.locator('input[aria-label="Switch molecule"]').first();
  if (!(await input.isVisible().catch(() => false))) return;
  if (touch) await page.getByRole('button', { name: 'Switch command', exact: true }).tap();
  else await page.keyboard.press('Escape');
  await input.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
}

/**
 * The fuse's run as the drawn frames saw it. The front steps on the wall
 * clock, once per drawn frame, from the frame it starts on (progress 0) to
 * the first frame at or past its whole run, so the run lies between the
 * last burning frame and the frame it ended on, whatever the frame rate:
 * `{ atLeast, below }` ms bounds it (null when the frames do not show it).
 */
function fuseRun(log) {
  const frames = [];
  for (const row of log) {
    if (row.frameAt === null || row.frames === null) continue;
    if (frames.length && frames.at(-1).frames === row.frames) continue;
    frames.push(row);
  }
  let first = -1;
  for (let i = 0; i < frames.length; i += 1) if (frames[i].fuse?.running && frames[i].fuse.progress === 0) first = i;
  if (first < 0) return { atLeast: null, below: null, frames: frames.length };
  let end = -1;
  for (let i = first + 1; i < frames.length; i += 1) {
    if (!frames[i].fuse?.running) {
      end = i;
      break;
    }
  }
  if (end < 0) return { atLeast: null, below: null, frames: frames.length };
  const start = frames[first].frameAt;
  return {
    atLeast: Math.round(frames[end - 1].frameAt - start),
    below: Math.round(frames[end].frameAt - start),
    frames: end - first + 1,
  };
}

/** The display-motion clock steps at most this far a drawn frame (ms; play/PlayLayer.tsx MAX_STEP_S). */
const MOTION_STEP_MS = 100;

/**
 * The morph as the drawn frames saw it: the display-motion clock's run from
 * the frame it was released on to the last frame still morphing, and to
 * the frame it landed on (ms).
 */
function morphRun(log) {
  const frames = [];
  for (const row of log) {
    if (row.frameAt === null || row.frames === null) continue;
    if (frames.length && frames.at(-1).frames === row.frames) continue;
    frames.push(row);
  }
  const released = frames.findIndex((row) => row.arrival === 'morph');
  if (released < 0) return { before: null, landed: null, frames: frames.length };
  let clock = 0;
  let before = null;
  for (let i = released + 1; i < frames.length; i += 1) {
    const step = Math.min(MOTION_STEP_MS, Math.max(0, frames[i].frameAt - frames[i - 1].frameAt));
    if (frames[i].arrival === null) return { before, landed: Math.round(clock + step), frames: i - released + 1 };
    clock += step;
    before = Math.round(clock);
  }
  return { before, landed: null, frames: frames.length - released };
}

/** A look change as the recorder saw it. */
function lookChange(log) {
  const mixes = log.map((row) => row.mix).filter((mix) => mix !== null);
  return {
    fused: log.some((row) => row.fuse?.running),
    modes: [...new Set(log.filter((row) => row.fuse?.running).map((row) => row.fuse.mode))],
    faded: log.some((row) => row.fading),
    between: mixes.filter((mix) => mix > 0.001 && mix < 0.999).length,
    first: mixes[0] ?? null,
    last: mixes.at(-1) ?? null,
    run: fuseRun(log),
  };
}

/** Frames drawn over `ms` of a view nobody touches. */
async function idleFrames(page, h, ms = 1_500) {
  const before = (await h.readPlay(page))?.frames ?? null;
  await h.sleep(ms);
  const after = (await h.readPlay(page))?.frames ?? null;
  return before === null || after === null ? null : after - before;
}

async function fuseStep(ctx, h, { level, label }, look, touch, pace) {
  const { page, check, save } = ctx;
  const to = look === 'Ink' ? 1 : 0;
  const box = await page.locator('[data-smoke-main]').boundingBox();
  await setChromeHidden(page, false);
  await recorder.start(page);
  const stop = level === 'still' ? null : await screencast(page, h);
  await chooseLook(page, touch, look);
  // The change lands: the look reaches its target and rests.
  await page.waitForFunction((target) => {
    const state = window.__lupiPlay?.ink?.();
    return state && state.target.mix === target && state.mix === target && !state.fading && !state.fuse?.running;
  }, to, { timeout: 120_000, polling: 100 }).catch(() => {});
  await h.sleep(400);
  const log = await recorder.stop(page);
  const frames = stop ? await stop() : [];
  const seen = lookChange(log);
  const expectedMs = INK_FUSE_MS * pace;
  const drawn = log.length ? (log.at(-1).frames ?? 0) - (log[0].frames ?? 0) : 0;
  const summary = { ...seen, expectedMs, drawn, rows: log.length };
  if (level === 'still') {
    check(`${label}: ${look} burns no fuse and fades nothing`, !seen.fused && !seen.faded, JSON.stringify(summary));
    check(`${label}: ${look} cuts (no frame between the looks)`, seen.between === 0 && seen.last === to, JSON.stringify(summary));
  } else {
    check(`${label}: ${look} burns a Light Fuse along the bonds`, seen.fused && seen.modes.includes('graph') && seen.last === to, JSON.stringify(summary));
    // 30 ms for the rounding of lastFrameAgoMs and the frame's own work.
    const { atLeast, below } = seen.run;
    check(
      `${label}: the fuse runs at its pace (INK_FUSE_MS x ${pace})`,
      atLeast !== null && below !== null && atLeast < expectedMs + 30 && below > expectedMs - 30,
      `burning at ${atLeast} ms, ended by ${below} ms over ${seen.run.frames} drawn frames; expected ${expectedMs} ms`,
    );
    // A frame from the middle of the burn, for the eye.
    if (box && frames.length > 2) {
      const middle = frames[Math.floor(frames.length / 2)];
      await save(`${level}-fuse-${look.toLowerCase()}-mid`, deviceCrop(h, page, middle.png, box));
    }
  }
  return summary;
}

async function switchStep(ctx, h, { level, label, to }, touch) {
  const { page, check, save } = ctx;
  const input = await openSwitcher(page, touch);
  await input.fill(to.title.toLowerCase());
  const row = page.locator(`button[aria-label="Switch to ${to.title}"]`).first();
  const found = await row.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
  if (!check(`${label}: the switcher lists ${to.title}`, found)) return null;
  const inset = await page.evaluate(() => window.__lupiPlay?.viewInset?.() ?? null);
  const canvas = page.locator('[data-smoke-main]');
  const box = await canvas.boundingBox();
  await setChromeHidden(page, true, h.HIDE_CHROME_CSS);
  const stop = await screencast(page, h);
  await h.sleep(500);
  await recorder.start(page);
  // A DOM click: the row's own handler, as a tap would run it (the row is hidden from the screenshots).
  await page.evaluate((title) => document.querySelector(`button[aria-label="Switch to ${title}"]`)?.click(), to.title);
  await page.waitForFunction((n) => window.__lupiViewerMcp?.status?.()?.atomCount === n, to.atoms, { timeout: 60_000, polling: 50 }).catch(() => {});
  // Landed: an arrival seen and then none; or, without one, a dozen drawn frames after the load.
  const loadFrame = (await h.readPlay(page))?.frames ?? 0;
  await page.waitForFunction((from) => {
    const log = window.__comfort.log;
    const arrived = log.some((row) => row.arrival);
    if (arrived) return log.at(-1)?.arrival === null;
    return (window.__lupiPlay?.state?.()?.frames ?? 0) - from > 12;
  }, loadFrame, { timeout: 180_000, polling: 100 }).catch(() => {});
  await h.sleep(1_000);
  const log = await recorder.stop(page);
  const frames = await stop();
  await setChromeHidden(page, false);
  const arrivals = [...new Set(log.map((row) => row.arrival))];
  const released = log.find((row) => row.arrival === 'morph') ?? null;
  const landed = released ? log.find((row) => row.t > released.t && row.arrival === null) ?? null : null;
  const feel = log.find((row) => row.feel)?.feel ?? null;
  // Drawn-frame spacing while it ran: the granularity of the landing time.
  const drawnAt = [];
  for (const row of log) if (row.frames !== null && (drawnAt.length === 0 || drawnAt.at(-1).frames !== row.frames)) drawnAt.push(row);
  const gaps = drawnAt.slice(1).map((row, i) => row.t - drawnAt[i].t).sort((a, b) => a - b);
  const frameGap = gaps.length ? gaps[gaps.length - 1] : null;
  const lastedMs = released && landed ? Math.round(landed.t - released.t) : null;
  const clock = morphRun(log);
  const summary = { arrivals, feel, lastedMs, clock, frameGapMs: frameGap === null ? null : Math.round(frameGap), inset: inset?.target ?? null, occluders: inset?.occluders ?? null };
  check(`${label}: ${to.title} loads through the switcher`, log.some((row) => row.atoms === to.atoms), JSON.stringify(summary));
  if (level === 'still') {
    check(`${label}: the switch does not morph and nothing moves`, !arrivals.some((a) => a?.includes('morph')) && !log.some((row) => row.active), JSON.stringify(summary));
  } else {
    const want = MORPH_FEEL[level];
    check(`${label}: the switch morphs and lands`, Boolean(released && landed), JSON.stringify(summary));
    check(
      `${label}: the morph runs ${want.duration} s at travel ${want.weight}`,
      Boolean(feel) && Math.abs(feel.duration - want.duration) < 1e-6 && Math.abs(feel.weight - want.weight) < 1e-6,
      JSON.stringify(feel),
    );
    // One clock step of slack each way: the release falls between two frames.
    const ms = want.duration * 1000;
    check(
      `${label}: it lands after ${want.duration} s of the motion clock`,
      clock.before !== null && clock.landed !== null && clock.before < ms + 30 && clock.landed > ms - MOTION_STEP_MS - 30,
      `still morphing at ${clock.before} ms, landed by ${clock.landed} ms over ${clock.frames} drawn frames (${lastedMs} ms of wall time, frames up to ${summary.frameGapMs} ms apart)`,
    );
    if (box && released && landed) {
      const during = frames.filter((frame) => frame.at >= released.t && frame.at <= landed.t);
      const pick = during[Math.floor(during.length / 2)] ?? null;
      if (pick) await save(`${level}-morph-mid`, deviceCrop(h, page, pick.png, box));
    }
  }
  await closeSwitcher(page, touch);
  return summary;
}

export default {
  name: 'comfort',
  profiles: ['desktop', 'phone390'],
  description: 'Motion comfort: at Standard and Gentle the Light Fuse runs at one pace and the morph at full or half travel; at Still neither runs and the look and molecule cut.',

  async run(ctx, h) {
    const { page, spec, check, outcome } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    await page.addInitScript(installRecorder);
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        /* storage blocked: nothing remembered either */
      }
    });
    // The static server has no edge Worker: Jev's switch judgment answers as unconfigured.
    await page.route('**/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":false}' }).catch(() => {}));
    const canvas = await h.openStructure(ctx, h.galleryEntry(START));
    if (!canvas) return;
    await lookAtRest(page, h);
    await viewAtRest(page, h);
    // A loaded software renderer draws a frame every few seconds: slow the
    // fuse (to 22 s) so several frames fall inside it and bound its run.
    const pace = 20;
    await ink(page, 'pace', pace);
    outcome.data.pace = pace;
    outcome.data.dpr = await page.evaluate(() => {
      const node = document.querySelector('[data-smoke-main]');
      return node ? Math.round((node.width / node.getBoundingClientRect().width) * 100) / 100 : null;
    });

    for (const step of LEVELS) {
      const data = (outcome.data[step.level] = {});
      await chooseComfort(page, touch, step.label);
      const comfort = (await h.readPlay(page))?.comfort ?? null;
      check(`${step.label}: the tray's Motion row sets ${step.level}`, comfort === step.level, String(comfort));
      await viewAtRest(page, h);

      data.toInk = await fuseStep(ctx, h, step, 'Ink', touch, pace);
      await lookAtRest(page, h);
      await viewAtRest(page, h);
      data.toLit = await fuseStep(ctx, h, step, 'Lit', touch, pace);
      await lookAtRest(page, h);
      await viewAtRest(page, h);

      data.morph = await switchStep(ctx, h, step, touch);
      await viewAtRest(page, h);
      const idle = await idleFrames(page, h);
      data.idle = idle;
      check(`${step.label}: a still view draws no frames once it is over`, idle !== null && idle <= 1, `frames ${idle}`);
    }
    await ink(page, 'pace', 1);
  },
};
