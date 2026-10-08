/**
 * replay.mjs - Instant Replay, sent and received (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=replay --backend=both \
 *     --profile=desktop --strict-backend --out=.verify-artifacts/viewer-smoke/replay
 *
 * Sending, on /?sim=c60_buckyball:
 * 1. A mouse flick coasts into a named face; once it rests the pill offers
 *    "Replay ↗" and `__lupiPlay.replay()` returns the moment with a link that
 *    carries `sim=c60_buckyball` and `replay=` (100 B to 3 KB of tape). If no
 *    flick turns into a moment in two tries, the check fails and the plugin
 *    falls back to `replay('moment')` for the rest.
 * 2. "Replay ↗" opens the share sheet with the same live link (the sheet is
 *    closed again before its clip is waited for).
 * Receiving, the link opened as a fresh document in the same tab:
 * 3. C60 opens, `replay=` leaves the address bar, and the shared replay goes
 *    pending -> waiting -> playing (Standard autoplays; `replay('watch')`
 *    starts it if it has not after 10 s) -> done, with the camera moving
 *    while it plays.
 * 4. It ends on "Your turn" in the pill.
 * Under Motion: Still (--reduced-motion) a flick does not coast, so the
 * moment is taken with `replay('moment')`: it is a still tape (one key, no
 * events), and the link opens C60 at that pose without playing anything
 * ("Shared view · your turn"; the camera stays put).
 * On a phone (phone390) the flick is a touch flick and the pill and the
 * sheet take taps.
 */

const ID = 'c60_buckyball';

/** Page-side: the shared replay's phases and the pill's flashes, stamped. */
function installReplayRecorder() {
  const log = (window.__replaySmoke = { phases: [], flashes: [], poses: [] });
  let lastPhase;
  let lastFlash = null;
  setInterval(() => {
    const play = window.__lupiPlay;
    const phase = play?.replay?.()?.incoming ?? null;
    const t = Math.round(performance.now());
    if (phase !== lastPhase) {
      lastPhase = phase;
      log.phases.push({ t, phase });
    }
    const state = play?.state?.();
    const flash = state?.flash ?? null;
    if (flash !== lastFlash) {
      lastFlash = flash;
      if (flash) log.flashes.push({ t, text: flash });
    }
    if (phase === 'playing' && state?.rig) log.poses.push({ t, position: state.rig.position });
  }, 50);
}

const replayHook = (page, command) => page.evaluate((value) => window.__lupiPlay?.replay?.(value) ?? null, command);

/** Wait until the camera rig has come to rest (or `ms`). */
async function rigRest(page, ms = 20_000) {
  await page.waitForFunction(() => window.__lupiPlay?.state?.().rig?.moving === false, null, { timeout: ms, polling: 100 }).catch(() => {});
}

export default {
  name: 'replay',
  profiles: ['desktop', 'phone390'],
  description: 'Instant Replay: a flick offers Replay ↗ with a replay= link; the link plays the moment and ends on Your turn.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome, options } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const still = options.reducedMotion;
    const press = (locator) => (touch ? locator.tap() : locator.click());
    await page.addInitScript(installReplayRecorder);
    const canvas = await h.openStructure(ctx, h.galleryEntry(ID));
    if (!canvas) return;
    const hooked = await page.waitForFunction(() => typeof window.__lupiPlay?.replay === 'function' && typeof window.__lupiPlay?.flick === 'function', null, { timeout: 15_000 }).then(() => true, () => false);
    check('__lupiPlay.replay and .flick are registered', hooked);
    if (!hooked) return;
    await h.waitSettled(page, canvas, 0.01, 30_000);
    // The arrival must have landed: a moment needs the visitor's own gesture.
    await page.waitForFunction(() => window.__lupiPlay?.state?.().displaced === false, null, { timeout: 15_000 }).catch(() => {});

    // 1. A flick that coasts into a face.
    const start = await h.canvasPoint(page, canvas, 0.45, 0.55);
    const offer = page.locator('[data-lupi-pill] [data-replay="offer"]');
    let source = null;
    const throws = [{ dx: 120, dy: 0 }, { dx: 200, dy: -40 }];
    for (const throwBy of throws) {
      if (touch) await h.touchFlick(page, start, throwBy, { ms: 100 });
      else await h.mouseFlick(page, start, throwBy, { ms: 100 });
      await h.sleep(300);
      await rigRest(page);
      const offered = await offer.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false);
      if (offered) {
        source = `flick ${JSON.stringify(throwBy)}`;
        break;
      }
    }
    if (!source) {
      await replayHook(page, 'moment');
      source = "replay('moment') fallback";
    }
    outcome.data.source = source;
    if (!still) check('a flick offers a moment ("Replay ↗" on the pill)', !source.includes('fallback'), source);
    const sent = await replayHook(page);
    outcome.data.sent = sent;
    const link = typeof sent?.link === 'string' ? new URL(sent.link) : null;
    check('replay() returns the moment with a replay= link', Boolean(link && link.searchParams.get('replay') && link.searchParams.get('sim') === ID),
      sent ? `${sent.moment}, ${sent.keys} keys, ${sent.events} events, ${sent.bytes} bytes, ${sent.link?.slice(0, 120)}` : 'null');
    if (still) check('Still: the tape is a still pose (one key, no events)', sent?.keys === 1 && sent.events === 0 && sent.bytes > 0, `${sent?.bytes} bytes, ${sent?.keys} keys, ${sent?.events} events`);
    else check('the tape is small (100 B to 3 KB)', sent?.bytes >= 100 && sent.bytes <= 3_000 && sent.keys > 1, `${sent?.bytes} bytes, ${sent?.keys} keys`);
    await save('offer', await page.screenshot({ scale: 'css' }));

    // 2. The share sheet carries the same live link.
    if (await offer.isVisible().catch(() => false)) {
      await press(offer);
      // The clip records at once (1080x1920 on desktop), which can hold a
      // software renderer's main thread for seconds: wait generously.
      const sheetLink = page.locator('[data-lupi-replay-sheet] input[aria-label="Live link"]');
      const opened = await sheetLink.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
      const value = opened ? await sheetLink.inputValue() : '';
      const recording = await page.locator('[data-lupi-replay-sheet][data-recording]').count();
      outcome.data.sheet = { opened, recording: recording > 0, value: value.slice(0, 160) };
      check('"Replay ↗" opens the share sheet with a replay= live link', opened && value.includes('replay='), value.slice(0, 120));
      await save('sheet', await page.screenshot({ scale: 'css' }));
      await press(page.locator('[data-lupi-replay-sheet] button[aria-label="Close"]').first()).catch(() => {});
      await page.locator('[data-lupi-replay-sheet]').first().waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
    }
    if (!link) return;

    // 3. The link, opened as a fresh document.
    await page.goto('about:blank', { waitUntil: 'commit' });
    const linkUrl = new URL(`${link.pathname}${link.search}`, h.baseFor(page)).href;
    outcome.url = linkUrl;
    await page.goto(linkUrl, { waitUntil: 'commit' });
    const opened = await page.waitForFunction((id) => {
      const status = window.__lupiViewerMcp?.status?.();
      return Boolean(status?.moleculeLoaded && status.atomCount === 60 && new URL(location.href).searchParams.get('sim') === id);
    }, ID, { timeout: 60_000, polling: 250 }).then(() => true, () => false);
    check('the replay link opens C60', opened);
    if (!opened) return;
    const canvasAgain = await h.mainCanvas(page);
    await canvasAgain?.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
    const address = new URL(page.url());
    check('the address bar drops replay= after reading it', !address.searchParams.has('replay'), `${address.pathname}${address.search}`);

    if (still) {
      // Still: the moment opens at its pose, nothing plays, and the pill hands over.
      const done = await page.waitForFunction(() => window.__replaySmoke.phases.at(-1)?.phase === 'done', null, { timeout: 60_000, polling: 250 }).then(() => true, () => false);
      await h.sleep(3_000);
      const log = await page.evaluate(() => window.__replaySmoke);
      const phases = log.phases.map((entry) => entry.phase);
      const rig = await page.evaluate(() => window.__lupiPlay?.state?.().rig ?? null);
      outcome.data.received = { phases: log.phases, flashes: log.flashes, rig };
      check('Still: the shared view opens without playing', done && !phases.includes('playing'), phases.join(' -> '));
      check('Still: the pill says "Shared view · your turn"', log.flashes.some((flash) => /Shared view/.test(flash.text)), log.flashes.map((flash) => flash.text).join(' | '));
      check('Still: the camera rests', rig?.moving === false, JSON.stringify(rig));
      await save('still-view', await page.screenshot({ scale: 'css' }));
      return;
    }
    const playing = await page.waitForFunction(() => window.__replaySmoke.phases.some((entry) => entry.phase === 'playing'), null, { timeout: 10_000, polling: 100 }).then(() => true, () => false);
    if (!playing) await replayHook(page, 'watch');
    outcome.data.autoplay = playing;
    const didPlay = playing || await page.waitForFunction(() => window.__replaySmoke.phases.some((entry) => entry.phase === 'playing'), null, { timeout: 10_000, polling: 100 }).then(() => true, () => false);
    if (didPlay) {
      await h.sleep(600);
      await save('playing', await page.screenshot({ scale: 'css' }));
    }
    // The player steps at most 0.1 s of tape per drawn frame, and a tape
    // recorded on a software renderer runs to the 8 s cap: at a few frames a
    // second the playback takes minutes.
    const done = await page.waitForFunction(() => window.__replaySmoke.phases.at(-1)?.phase === 'done', null, { timeout: 300_000, polling: 250 }).then(() => true, () => false);
    await h.sleep(400);
    const log = await page.evaluate(() => window.__replaySmoke);
    const phases = log.phases.map((entry) => entry.phase);
    const poses = log.poses;
    const travelled = poses.length > 1
      ? Math.hypot(...poses.at(-1).position.map((value, i) => value - poses[0].position[i]))
      : 0;
    outcome.data.received = { phases: log.phases, flashes: log.flashes, poseSamples: poses.length, travelled };
    check('the shared replay goes waiting -> playing -> done', ['waiting', 'playing', 'done'].every((phase) => phases.includes(phase))
      && phases.indexOf('waiting') < phases.indexOf('playing') && phases.indexOf('playing') < phases.lastIndexOf('done'),
      `${phases.join(' -> ')}${playing ? ' (autoplay)' : " (replay('watch'))"}`);
    check('Standard plays it on its own', playing, playing ? 'autoplay' : "needed replay('watch')");
    check('the camera moves while it plays', travelled > 0.05, `${poses.length} samples, travelled ${travelled.toFixed(2)} Å`);
    // 4. "Your turn".
    check('it ends on "Your turn"', done && log.flashes.some((flash) => /^Your turn|your turn/.test(flash.text)), log.flashes.map((flash) => flash.text).join(' | '));
    await save('your-turn', await page.screenshot({ scale: 'css' }));
  },
};
