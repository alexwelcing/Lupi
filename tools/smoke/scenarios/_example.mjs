/**
 * _example.mjs - the shape of a viewer-smoke scenario plugin. The loader
 * skips files whose names start with `_`, so this one never runs; copy it to
 * tools/smoke/scenarios/<name>.mjs to make a real one.
 *
 * Plugins are LOCAL checks, never CI. Keep each one short: one visitor-facing
 * behaviour, a few checks, a few saved frames a human can look at.
 *
 *   node tools/verify-viewer-smoke.mjs --help                 # lists plugins
 *   node tools/verify-viewer-smoke.mjs --scenarios=example --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/example
 *
 * Default export:
 *   name       Unique scenario name, /^[a-z0-9][a-z0-9_-]*$/i, not a built-in.
 *   profiles   Any of 'desktop' | 'phone' | 'phone390'. phone and phone390
 *              are touch profiles (h.isTouchProfile(profile)).
 *   lanes      Optional: 'webgl' | 'webgpu' (default: both backend lanes).
 *   description Optional one line for --help.
 *   run(ctx, h) Async. Throwing records an exception and fails the attempt;
 *              a failed attempt is retried in a fresh page (--retries).
 *
 * ctx (the same object the built-in scenarios get):
 *   page       Playwright page in a fresh context for this profile. It is NOT
 *              navigated yet; h.openStructure(ctx, entry) opens ?sim=<id>.
 *   spec       { backend: 'webgl' | 'webgpu', profile, name, baseUrl, lane }.
 *   check(name, ok, detail?, data?)  Records a check and returns Boolean(ok).
 *              A scenario passes when it recorded at least one check, all of
 *              them passed, and the page logged no uncaught or console error.
 *   save(step, pngBytes)  Writes <backend>-<profile>-<name>-<step>.png into
 *              the run's artifact directory and returns its path.
 *   outcome    The attempt record; put findings in outcome.data.<key> and
 *              they land in report.json.
 *   options    { level: 'boot' | 'full', reducedMotion: boolean,
 *              strictBackend: boolean, timeout: ms }.
 *   log(...)   Human log line (silent under --json).
 *
 * h is tools/smoke/helpers.mjs. The ones plugins use most:
 *   openStructure(ctx, h.galleryEntry(id))  -> canvas locator or null
 *   waitSettled(page, canvas, minForeground, maxMs?)  -> { png, image, meta }
 *   captureCanvas(page, canvas)  -> { png, image } with DOM chrome hidden
 *   assessRender(page, canvas, image, minForeground), diffImages(a, b),
 *   foreground(image), decodePng(bytes), canvasPoint(page, canvas, fx, fy),
 *   pickAtom(ctx, canvas, image)
 *   mouseDrag / touchDrag(page, start, { dx, dy }, { holdMs = 150 })
 *              still hold before release: a drag never becomes a coast
 *   mouseFlick / touchFlick(page, start, { dx, dy }, { ms = 120 })
 *              released at speed (planned CDP timestamps; read event.timeStamp)
 *   pinch(page, center, { fromPx, toPx, ms, holdMs }),
 *   twoFingerDrag(page, start, { dx, dy }, { gap, holdMs })   (CDP touch)
 *   sampleFrames(page, { ms, every })  -> floor(ms / every) + 1 full-viewport
 *              PNG Buffers: what the screen showed at .t ms (screencast; .frameT
 *              says when that frame was presented, so repeats are visible)
 *   readPlay(page)  -> window.__lupiPlay?.state() or null
 *   playEmit(page, intent)  -> emits a Lupi intent as the UI would
 *              (window.__lupiPlay.emit); false when the hooks are absent
 */

export default {
  name: 'example',
  profiles: ['desktop', 'phone', 'phone390'],
  // lanes: ['webgpu'],
  description: 'C60 turns under a held drag; the frames after release are sampled.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome } = ctx;
    const canvas = await h.openStructure(ctx, h.galleryEntry('c60_buckyball'));
    if (!canvas) return; // openStructure already recorded the failing check.
    const before = await h.waitSettled(page, canvas, 0.01);
    await save('before', before.png);

    const start = await h.canvasPoint(page, canvas, 0.5, 0.55);
    if (h.isTouchProfile(spec.profile)) await h.touchDrag(page, start, { dx: 120, dy: 0 });
    else await h.mouseDrag(page, start, { dx: 200, dy: 0 });

    // What the screen showed over the half second after release.
    const frames = await h.sampleFrames(page, { ms: 500, every: 100 });
    const first = h.decodePng(frames[0]);
    const last = h.decodePng(frames.at(-1));
    const drift = h.diffImages(first, last).changed / (first.width * first.height);
    await save('released', frames.at(-1));
    outcome.data.example = { presented: frames.map((frame) => frame.frameT), drift, play: await h.readPlay(page) };

    const after = await h.waitSettled(page, canvas, 0.01, 8_000);
    await save('after', after.png);
    const turned = h.diffImages(before.image, after.image).changed / (after.image.width * after.image.height);
    check('drag turns the molecule', turned > 0.005, `changed=${h.pct(turned)}`);
    check('six frames cover the release', frames.length === 6, `${frames.length} frames, drift ${h.pct(drift)} over 500 ms`);
  },
};
