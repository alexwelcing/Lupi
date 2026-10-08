/**
 * replayclip.mjs - Instant Replay's clip, rendered frame by frame (LOCAL
 * smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=replayclip --backend=both \
 *     --profile=desktop --strict-backend --out=.verify-artifacts/viewer-smoke/replayclip
 *
 * SwiftShader draws a 1080x1920 clip frame (2x supersampled, with the look)
 * in tens of seconds, so the plugin asks for the clip at a quarter of the size
 * (`replay('clip-scale', 0.25)`: 270x480), which exercises the same path in
 * minutes. REPLAYCLIP_SCALE=1 runs it at full size.
 *
 * On /?sim=c60_buckyball:
 * 1. A mouse flick coasts into a moment and the pill offers "Replay ↗" (or,
 *    after two tries, `replay('moment')` offers the last 4 s).
 * 2. "Replay ↗" opens the sheet, which makes the 9:16 clip. The plugin
 *    watches the viewer canvas while it does: its size (drawing buffer and
 *    CSS box) must never change.
 * 3. When the sheet says the clip is ready, `__lupiPlay.replay('clip')` says
 *    how it was made: WebCodecs (frame by frame) with the codec string, the
 *    frame count and the time per frame. The clip's bytes are fetched from
 *    the sheet's <video> and written next to the screenshots.
 * 4. The bytes are an MP4: top-level ftyp, moov and mdat; one sample per
 *    1/30 s of the clip (duration x 30, within 1); ffprobe (when installed)
 *    decodes the same number of frames at the clip's size. ffmpeg (when
 *    installed) saves the first, a middle and the last frame (the end card)
 *    as PNG for a human. The report also records which of the four codecs
 *    the browser can encode at 1080x1920.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ID = 'c60_buckyball';
const FPS = 30;
const ENCODE_TIMEOUT_MS = 30 * 60_000;
/** The clip's codec ladder at 1080x1920 (replay/clipEncoder.ts). */
const LADDER_1080 = ['avc1.640028', 'avc1.42E028', 'vp09.00.40.08', 'av01.0.08M.08'];
const SCALE = Number(process.env.REPLAYCLIP_SCALE) > 0 ? Math.min(1, Number(process.env.REPLAYCLIP_SCALE)) : 0.25;

/** Page-side: every size the viewer canvas has while the clip is made. */
function watchCanvasSize() {
  const canvas = document.querySelector('canvas[data-smoke-main]') ?? document.querySelector('canvas');
  const log = (window.__clipSmoke = { sizes: [], samples: 0, watching: true });
  const sample = () => {
    if (!log.watching || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const size = `${canvas.width}x${canvas.height} css ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    log.samples += 1;
    if (log.sizes.at(-1) !== size) log.sizes.push(size);
  };
  sample();
  log.timer = setInterval(sample, 40);
}

/** The top-level MP4 boxes, and the stsz sample count and stsd entry of the first track. */
function readMp4(bytes) {
  const boxes = (start, end) => {
    const found = [];
    let at = start;
    while (at + 8 <= end) {
      const size = bytes.readUInt32BE(at);
      const type = bytes.toString('latin1', at + 4, at + 8);
      if (size < 8) break;
      found.push({ type, start: at + 8, end: at + size });
      at += size;
    }
    return found;
  };
  const top = boxes(0, bytes.length);
  let range = { start: 0, end: bytes.length };
  const path = ['moov', 'trak', 'mdia', 'minf', 'stbl'];
  for (const type of path) {
    const next = boxes(range.start, range.end).find((box) => box.type === type);
    if (!next) return { top: top.map((box) => box.type), samples: -1, entry: '' };
    range = next;
  }
  const inner = boxes(range.start, range.end);
  const stsz = inner.find((box) => box.type === 'stsz');
  const stsd = inner.find((box) => box.type === 'stsd');
  return {
    top: top.map((box) => box.type),
    samples: stsz ? bytes.readUInt32BE(stsz.start + 8) : -1,
    entry: stsd ? bytes.toString('latin1', stsd.start + 12, stsd.start + 16) : '',
  };
}

function hasTool(name) {
  return spawnSync(name, ['-version'], { stdio: 'ignore' }).status === 0;
}

export default {
  name: 'replayclip',
  profiles: ['desktop'],
  description: 'Instant Replay clip rendered frame by frame: WebCodecs MP4, one frame per 1/30 s, the canvas never resizes.',

  async run(ctx, h) {
    const { page, check, save, outcome, log } = ctx;
    const canvas = await h.openStructure(ctx, h.galleryEntry(ID));
    if (!canvas) return;
    const hooked = await page.waitForFunction(() => typeof window.__lupiPlay?.replay === 'function', null, { timeout: 15_000 }).then(() => true, () => false);
    check('__lupiPlay.replay is registered', hooked);
    if (!hooked) return;
    await h.waitSettled(page, canvas, 0.01, 30_000);
    await page.waitForFunction(() => window.__lupiPlay?.state?.().displaced === false, null, { timeout: 15_000 }).catch(() => {});
    // Which of the clip's codecs this browser can encode at 1080x1920 (the sheet takes the first).
    const support = await page.evaluate(async (codecs) => {
      if (typeof VideoEncoder !== 'function') return null;
      const answers = {};
      for (const codec of codecs) {
        const config = { codec, width: 1080, height: 1920, bitrate: 8_000_000, framerate: 30, ...(codec.startsWith('avc1') ? { avc: { format: 'avc' } } : {}) };
        answers[codec] = await VideoEncoder.isConfigSupported(config).then((result) => result.supported === true, () => false);
      }
      return answers;
    }, LADDER_1080);
    outcome.data.codecSupport = support;
    log(`    WebCodecs at 1080x1920: ${support ? Object.entries(support).map(([codec, ok]) => `${codec} ${ok ? 'yes' : 'no'}`).join(', ') : 'none'}`);

    // 1. A moment from a flick.
    const start = await h.canvasPoint(page, canvas, 0.45, 0.55);
    const offer = page.locator('[data-lupi-pill] [data-replay="offer"]');
    let source = null;
    for (const throwBy of [{ dx: 120, dy: 0 }, { dx: 200, dy: -40 }]) {
      await h.mouseFlick(page, start, throwBy, { ms: 100 });
      await h.sleep(300);
      await page.waitForFunction(() => window.__lupiPlay?.state?.().rig?.moving === false, null, { timeout: 20_000, polling: 100 }).catch(() => {});
      if (await offer.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false)) {
        source = `flick ${JSON.stringify(throwBy)}`;
        break;
      }
    }
    if (!source) {
      await page.evaluate(() => window.__lupiPlay.replay('moment'));
      source = "replay('moment') fallback";
    }
    outcome.data.source = source;
    const moment = await page.evaluate(() => window.__lupiPlay.replay());
    outcome.data.moment = moment;
    check('a moment is offered', Boolean(moment?.moment), `${source}; ${moment?.moment}, ${moment?.keys} keys, ${moment?.events} events`);

    // 2. The sheet makes the clip; the canvas is watched all along.
    outcome.data.scale = await page.evaluate((scale) => window.__lupiPlay.replay('clip-scale', scale), SCALE);
    await page.evaluate(watchCanvasSize);
    const started = Date.now();
    if (await offer.isVisible().catch(() => false)) await offer.click({ noWaitAfter: true, timeout: 60_000 });
    else await page.keyboard.press('r');
    const sheet = page.locator('[data-lupi-replay-sheet]');
    const opened = await sheet.first().waitFor({ state: 'visible', timeout: 120_000 }).then(() => true, () => false);
    check('the Replay sheet opens', opened);
    if (!opened) return;
    await h.sleep(1500);
    await save('developing', await page.screenshot({ scale: 'css', timeout: 120_000 }));

    let lastNote = '';
    let lastLogged = 0;
    const deadline = Date.now() + ENCODE_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await page.locator('[data-lupi-replay-sheet][data-clip-encoder]').count() > 0;
      const note = await page.locator('.lupi-replay-sheet__clip-note').first().textContent({ timeout: 60_000 }).catch(() => '');
      if (note && note !== lastNote && Date.now() - lastLogged > 30_000) {
        lastNote = note;
        lastLogged = Date.now();
        log(`    ${Math.round((Date.now() - started) / 1000)} s: ${note}`);
      }
      if (ready || /didn’t record|can’t record|Another export/.test(note ?? '')) break;
      await h.sleep(2_000);
    }
    const encodeWallMs = Date.now() - started;
    const sizes = await page.evaluate(() => {
      const log = window.__clipSmoke;
      log.watching = false;
      clearInterval(log.timer);
      return { sizes: log.sizes, samples: log.samples };
    });
    outcome.data.canvas = sizes;
    check('the clip is ready', ready, lastNote);
    const readyShot = await save('ready', await page.screenshot({ scale: 'css', timeout: 120_000 }));
    const dir = dirname(readyShot);
    check('the viewer canvas never changes size while the clip is made', sizes.sizes.length === 1, `${sizes.samples} samples: ${sizes.sizes.join(' -> ')}`);
    if (!ready) return;

    // 3. How it was made, and its bytes.
    const report = await page.evaluate(() => window.__lupiPlay.replay('clip'));
    outcome.data.report = report;
    outcome.data.encodeWallMs = encodeWallMs;
    log(`    clip: ${JSON.stringify(report)}`);
    check('the clip is rendered frame by frame (WebCodecs)', report?.encoder === 'webcodecs', `${report?.encoder} ${report?.codec}`);
    check('the codec is recorded', typeof report?.codec === 'string' && /^(avc1|vp09|av01)\./.test(report.codec), report?.codec);
    check('the clip is 9:16 at the asked scale', report?.width === Math.max(2, Math.round((1080 * SCALE) / 2) * 2) && report?.height === Math.max(2, Math.round((1920 * SCALE) / 2) * 2),
      `${report?.width}x${report?.height} at scale ${SCALE}`);
    outcome.data.h264 = typeof report?.codec === 'string' && report.codec.startsWith('avc1');
    if (report?.msPerFrame) log(`    ${report.frames} frames in ${(report.ms / 1000).toFixed(1)} s: ${report.msPerFrame} ms per frame (${report.backend}; render ${report.split?.render} ms, compose ${report.split?.compose} ms, encode ${report.split?.encode} ms)`);
    const encoded = await page.evaluate(async () => {
      const video = document.querySelector('[data-lupi-replay-sheet] video');
      if (!video?.src) return null;
      const buffer = await (await fetch(video.src)).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { base64: btoa(binary) };
    });
    check('the sheet holds the clip', Boolean(encoded?.base64));
    if (!encoded?.base64) return;
    const bytes = Buffer.from(encoded.base64, 'base64');
    const file = join(dir, `${ctx.spec.backend}-${ctx.spec.profile}-replayclip.mp4`);
    writeFileSync(file, bytes);
    outcome.data.file = file;

    // 4. The MP4 itself.
    const mp4 = readMp4(bytes);
    outcome.data.mp4 = { bytes: bytes.length, ...mp4 };
    const expected = Math.round((report.duration ?? 0) * FPS);
    check('the file is MP4: ftyp, moov, mdat', ['ftyp', 'moov', 'mdat'].every((box) => mp4.top.includes(box)), mp4.top.join(' '));
    check('one sample per 1/30 s of the clip (duration x 30, within 1)', Math.abs(mp4.samples - expected) <= 1 && mp4.samples === report.frames,
      `${mp4.samples} samples, ${report.duration?.toFixed(3)} s x 30 = ${expected}, encoder said ${report.frames}`);
    check('the sample entry matches the codec', mp4.entry === report.codec.slice(0, 4), `${mp4.entry} for ${report.codec}`);

    if (hasTool('ffprobe')) {
      const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
        'stream=codec_name,width,height,nb_read_frames,r_frame_rate,duration', '-of', 'json', file], { encoding: 'utf8' });
      const stream = probe.status === 0 ? JSON.parse(probe.stdout).streams?.[0] : null;
      outcome.data.ffprobe = stream ?? probe.stderr;
      check(`ffprobe decodes every frame at ${report.width}x${report.height}`, stream && Number(stream.nb_read_frames) === report.frames && stream.width === report.width && stream.height === report.height,
        stream ? `${stream.codec_name} ${stream.width}x${stream.height} ${stream.nb_read_frames} frames at ${stream.r_frame_rate}, ${stream.duration} s` : probe.stderr.slice(0, 200));
    }
    if (hasTool('ffmpeg')) {
      const middle = Math.floor(report.frames / 2);
      for (const [step, frame] of [['first', 0], ['middle', middle], ['last', report.frames - 1]]) {
        const png = join(dir, `${ctx.spec.backend}-${ctx.spec.profile}-replayclip-frame-${step}.png`);
        const run = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-vframes', '1', png]);
        if (run.status === 0) outcome.screenshots.push(png);
        else log(`    ffmpeg could not extract frame ${frame}: ${String(run.stderr).slice(0, 200)}`);
      }
    }
  },
};
