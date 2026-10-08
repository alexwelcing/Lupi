/**
 * remix.mjs - Remix codes (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=remix --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/remix
 *
 * On /?sim=caffeine:
 * 1. The Play tray's "Remix ⟳" (a click, a tap on a phone) rolls a code
 *    (r1- and five characters), the pill flashes it, and the look changes in
 *    the MCP state, ending with the code "exact" (the share of changed
 *    pixels is logged, not judged).
 * 2. `__lupiPlay.remix('roll')` starts a morph (read in the same task: a
 *    software renderer can draw the whole 600 ms in one frame) that ends with
 *    the new code exact.
 * 3. A known code, `remix('r1-K7QDM')`, settles exact; then the view goes
 *    still: `state().frames` stops advancing (Quiet Idle).
 * 4. An MCP PNG of the remixed view (default arguments, bonds hidden as the
 *    deterministic raster path requires) succeeds and leaves the live camera
 *    and atom scale where they were.
 * 5. `remix('undo')` steps back to the code from step 2.
 * 6. Under the Illustrate look a Holo code (r1-K03DQ) is still Foil, but the
 *    pill names no finish (no "foil" flash, no foil chip); with ink off the
 *    chip comes back.
 * 7. A reload of /?sim=caffeine&remix=r1-K7QDM opens with that code exact,
 *    the same style fields in `__lupiViewerMcp.state()` as step 3, and no
 *    `remix=` left in the address bar.
 */

const ID = 'caffeine';
const KNOWN = 'r1-K7QDM';
/** A Holo code (fmix32(fnv1a(code)) mod 24 is 0). */
const HOLO = 'r1-K03DQ';
const CODE = /^r1-[0-9A-HJKMNP-TV-Z]{5}$/;
/** The look fields `__lupiViewerMcp.state()` reports. */
const STYLE_FIELDS = ['backgroundPreset', 'postprocessPreset', 'inkStyle', 'colorScheme', 'colorMode', 'colorProperty', 'colormap'];

const mcp = (page, tool, args) => page.evaluate(({ name, input }) => window.__lupiViewerMcp.execute({ id: `remix-${name}`, tool: name, arguments: input }), { name: tool, input: args });
const remix = (page, command) => page.evaluate((value) => window.__lupiPlay?.remix?.(value) ?? null, command);
const style = (page) => page.evaluate((fields) => {
  const state = window.__lupiViewerMcp.state();
  return Object.fromEntries(fields.map((field) => [field, state[field] ?? null]));
}, STYLE_FIELDS);

/** Page-side: every pill flash, stamped. */
function installFlashRecorder() {
  const log = (window.__remixSmoke = { flashes: [] });
  let last = null;
  setInterval(() => {
    const flash = window.__lupiPlay?.state?.().flash ?? null;
    if (flash !== last) {
      last = flash;
      if (flash) log.flashes.push({ t: Math.round(performance.now()), text: flash });
    }
  }, 25);
}

/**
 * Wait until no morph runs (or `ms`); returns the hook's reading then. On
 * SwiftShader WebGPU the frame that swaps a look's colours can take 20 s
 * (pipeline compiles), and the morph ends on the frame after it.
 */
async function morphEnded(page, ms = 60_000) {
  await page.waitForFunction(() => window.__lupiPlay?.remix?.()?.morphing === false, null, { timeout: ms, polling: 100 }).catch(() => {});
  return remix(page);
}

/** Frames drawn over `ms` on a view nobody touches. */
async function idleFrames(page, ms) {
  const before = await page.evaluate(() => window.__lupiPlay.state());
  await page.waitForTimeout(ms);
  const after = await page.evaluate(() => window.__lupiPlay.state());
  return { drawn: after.frames - before.frames, awakeBy: after.frameDemand?.awakeBy ?? null, frameloop: after.frameDemand?.frameloop ?? null };
}

/** The rig's pose and the atom scale: what an export must leave alone. */
const liveView = (page) => page.evaluate(() => ({
  rig: window.__lupiPlay.state().rig,
  atomScale: window.__lupiViewerMcp.state().atomScale,
}));
const samePose = (a, b) => {
  if (!a?.rig || !b?.rig) return false;
  const from = [...a.rig.position, ...a.rig.target];
  const to = [...b.rig.position, ...b.rig.target];
  return from.every((value, i) => Math.abs(value - to[i]) < 1e-4);
};

export default {
  name: 'remix',
  profiles: ['desktop', 'phone390'],
  description: 'Remix: tray roll, morph, a known code, Quiet Idle, an MCP export that keeps the view, undo, Foil under ink, ?remix= on reload.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome, log } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const press = (locator) => (touch ? locator.tap({ noWaitAfter: true }) : locator.click({ noWaitAfter: true }));
    const area = (image) => image.width * image.height;
    await page.addInitScript(installFlashRecorder);
    const canvas = await h.openStructure(ctx, h.galleryEntry(ID));
    if (!canvas) return;
    const hooked = await page.waitForFunction(() => typeof window.__lupiPlay?.remix === 'function', null, { timeout: 15_000 }).then(() => true, () => false);
    check('__lupiPlay.remix is registered', hooked);
    if (!hooked) return;
    const start = await h.waitSettled(page, canvas, 0.01, 30_000);
    const startStyle = await style(page);
    outcome.data.start = { style: startStyle, remix: await remix(page) };

    // 1. A visitor's roll from the Play tray.
    await press(page.getByRole('button', { name: 'Play: toys and view' }));
    const rollItem = page.getByRole('menuitem', { name: /^Remix: roll/ });
    const trayOpen = await rollItem.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
    check('the Play tray offers Remix ⟳', trayOpen);
    if (!trayOpen) return;
    await press(rollItem);
    const tray = await morphEnded(page);
    const trayStyle = await style(page);
    await page.keyboard.press('Escape').catch(() => {});
    const trayShot = await h.waitSettled(page, canvas, 0.005, 15_000);
    await save('tray-roll', trayShot.png);
    const trayDiff = h.diffImages(start.image, trayShot.image).changed / area(trayShot.image);
    const { flashes } = await page.evaluate(() => window.__remixSmoke);
    outcome.data.trayRoll = { remix: tray, style: trayStyle, changed: trayDiff, flashes };
    check('a tray roll lands a code like r1-XXXXX, exact', CODE.test(tray?.code ?? '') && tray.status === 'exact', JSON.stringify(tray));
    check('the pill flashes the rolled code', flashes.some((flash) => flash.text.includes(tray?.code ?? '?')), flashes.map((flash) => flash.text).join(' | '));
    check('the rolled look changes the MCP style', STYLE_FIELDS.some((field) => trayStyle[field] !== startStyle[field]), JSON.stringify({ startStyle, trayStyle }));
    // The picture is recorded, not judged: a roll can land on a plate close to
    // the sage one (Gallery Studio) with CPK kept, and then few pixels change.
    log(`  --  the tray roll changed ${h.pct(trayDiff)} of the canvas`);

    // 2. A roll morphs.
    const rolling = await remix(page, 'roll');
    const rolled = await morphEnded(page);
    const rolledStyle = await style(page);
    outcome.data.roll = { rolling, rolled, style: rolledStyle };
    check('a roll starts a morph', rolling?.morphing === true && CODE.test(rolling.code ?? ''), JSON.stringify(rolling));
    check('the morph ends with the new code exact', rolled?.code === rolling?.code && rolled.status === 'exact' && rolled.morphing === false, JSON.stringify(rolled));

    // 3. A known code, then a still view.
    const applied = await remix(page, KNOWN);
    const known = await morphEnded(page);
    const knownStyle = await style(page);
    const knownShot = await h.waitSettled(page, canvas, 0.005, 15_000);
    await save('known', knownShot.png);
    await save('known-page', await page.screenshot({ scale: 'css' }));
    outcome.data.known = { applied, known, style: knownStyle };
    check(`${KNOWN} applies and settles exact`, known?.code === KNOWN && known.status === 'exact' && known.morphing === false, JSON.stringify(known));
    // Flashes and the pill's segments settle within a few seconds; then nothing should draw.
    await page.waitForTimeout(3_000);
    const idle = await idleFrames(page, 3_000);
    outcome.data.idle = idle;
    check('Quiet Idle after the morph: no frames drawn over 3 s', idle.drawn === 0, `drew ${idle.drawn}, awakeBy ${JSON.stringify(idle.awakeBy)}, frameloop ${idle.frameloop}`);

    // 4. An MCP export of the remixed view leaves the live view alone.
    await mcp(page, 'lupi.set_viewer', { showBonds: false });
    await page.waitForFunction(() => window.__lupiPlay?.state?.().rig?.moving === false, null, { timeout: 10_000 }).catch(() => {});
    const beforeExport = await liveView(page);
    const exported = await h.withTimeout(mcp(page, 'lupi.export_asset', { format: 'png', width: 256, height: 256, timeoutMs: 60_000 }), 120_000, 'MCP export');
    await page.waitForTimeout(800);
    const afterExport = await liveView(page);
    outcome.data.export = { ok: exported.ok, error: exported.error ?? null, specId: exported.result?.asset?.specId ?? null, before: beforeExport, after: afterExport };
    check('an MCP PNG of the remixed view succeeds', exported.ok === true, exported.error?.message ?? `${exported.result?.asset?.byteLength} bytes`);
    check('the export leaves the live camera where it was', samePose(beforeExport, afterExport), JSON.stringify({ before: beforeExport.rig, after: afterExport.rig }));
    check('the export leaves the atom scale as it was', afterExport.atomScale === beforeExport.atomScale, `${beforeExport.atomScale} -> ${afterExport.atomScale}`);
    await mcp(page, 'lupi.set_viewer', { showBonds: true });

    // 5. Undo steps back to the code from step 2.
    const undone = await remix(page, 'undo');
    const back = await morphEnded(page);
    const backStyle = await style(page);
    outcome.data.undo = { undone, back, style: backStyle };
    check('undo steps back to the rolled code, exact', back?.code === rolled?.code && back.status === 'exact', JSON.stringify(back));
    check('undo restores the rolled look in the MCP state', STYLE_FIELDS.every((field) => backStyle[field] === rolledStyle[field]), JSON.stringify({ rolledStyle, backStyle }));

    // 6. Foil rests under ink, and the pill does not name it.
    await mcp(page, 'lupi.set_viewer', { inkStyle: 'flat' });
    const flashCount = (await page.evaluate(() => window.__remixSmoke.flashes)).length;
    const holo = await remix(page, HOLO);
    await morphEnded(page);
    await page.waitForTimeout(1_200);
    const inkFlashes = (await page.evaluate(() => window.__remixSmoke.flashes)).slice(flashCount).map((flash) => flash.text);
    const chip = page.locator('[data-lupi-pill] [data-remix="foil"]');
    const chipUnderInk = await chip.count();
    await save('holo-under-ink', await page.screenshot({ scale: 'css' }));
    await mcp(page, 'lupi.set_viewer', { inkStyle: 'off' });
    const chipLit = await chip.first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    const chipText = chipLit ? (await chip.first().textContent())?.trim() : null;
    await page.waitForTimeout(600);
    await save('holo-lit', await page.screenshot({ scale: 'css' }));
    outcome.data.foil = { holo, inkFlashes, chipUnderInk, chipLit, chipText };
    check(`${HOLO} is Foil (holo)`, holo?.foil === 'holo', JSON.stringify(holo));
    check('under ink the pill names no finish', chipUnderInk === 0 && !inkFlashes.some((text) => /foil|Holo/i.test(text)),
      `chip ${chipUnderInk}, flashes ${inkFlashes.join(' | ') || 'none'}`);
    check('with the light back the foil chip shows', chipLit && /Holo/.test(chipText ?? ''), `chip "${chipText}"`);

    // 7. ?remix= on a molecule URL applies the same look on a reload.
    const linked = new URL(`?sim=${ID}&remix=${KNOWN}`, h.baseFor(page)).href;
    await page.goto(linked, { waitUntil: 'commit' });
    const reopened = await page.waitForFunction(() => {
      const status = window.__lupiViewerMcp?.status?.();
      return Boolean(status?.moleculeLoaded && status.atomCount > 0 && typeof window.__lupiPlay?.remix === 'function');
    }, null, { timeout: 60_000, polling: 250 }).then(() => true, () => false);
    check('the ?remix= link opens the viewer', reopened);
    if (!reopened) return;
    const canvasAgain = await h.mainCanvas(page);
    await canvasAgain?.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
    const fromLink = await morphEnded(page);
    const linkStyle = await style(page);
    const address = new URL(page.url());
    outcome.data.link = { url: linked, remix: fromLink, style: linkStyle, address: address.search };
    check(`?remix=${KNOWN} opens with that code exact`, fromLink?.code === KNOWN && fromLink.status === 'exact', JSON.stringify(fromLink));
    check(`?remix=${KNOWN} gives the same MCP style as applying it`, STYLE_FIELDS.every((field) => linkStyle[field] === knownStyle[field]), JSON.stringify({ knownStyle, linkStyle }));
    check('the address bar drops remix= after reading it', !address.searchParams.has('remix'), address.search);
    if (canvasAgain) {
      const linkShot = await h.waitSettled(page, canvasAgain, 0.005, 20_000);
      await save('link', linkShot.png);
    }
  },
};
