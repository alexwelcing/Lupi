/**
 * chrome.mjs - WP6 the one Play pill (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=chrome --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/chrome
 *
 * On /?sim=c60_buckyball:
 * 1. Exactly one [data-lupi-pill], no viewer-gesture-hint, and the stow
 *    button keeps its old names; the status teaches ("Drag to spin ...").
 * 2. With the axes gizmo on, the pill clears the deck, the header capsule
 *    and the gizmo (and sits above the deck on a phone), also while the
 *    first toy's long honesty label shows, and in 844x390 landscape.
 * 3. `p` opens the tray (role=menu, items >= 44 px, inside the viewport);
 *    Escape closes it. The Play segment opens it too.
 * 4. Poke latches from the tray: the pill reads "Poke", the viewport gets
 *    its lime inset, and the x unlatches.
 * 5. A poke labels the pill "Illustrative ... Reset"; Reset clears it.
 * 6. Stow and Restore keep working from the pill.
 * The frames saved along the way are for a human to look at.
 */

const ID = 'c60_buckyball';

/** Page-side: a timeline of the pill's status text and the arrival state. */
function installStatusRecorder() {
  const rec = { log: [], arrival: false };
  window.__chromeRec = rec;
  let last = null;
  const tick = () => {
    const text = document.querySelector('[data-lupi-pill] [role="status"]')?.textContent ?? null;
    if (text !== last) {
      last = text;
      rec.log.push({ t: Math.round(performance.now()), text });
    }
    if (window.__lupiPlay?.state?.().motion?.arrival) rec.arrival = true;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function layout(page) {
  return page.evaluate(() => {
    const box = (selector, fading = false) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none' || (!fading && Number(style.opacity) === 0)) return null;
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    };
    return {
      pill: box('[data-lupi-pill]'),
      deck: box('.lupine-command-deck'),
      header: box('.lupine-status-bar'),
      gizmo: box('[data-testid="axes-gizmo"]'),
      tray: box('[data-lupi-pill] [role="menu"]', true),
      viewport: { w: innerWidth, h: innerHeight },
      status: document.querySelector('[data-lupi-pill] [role="status"]')?.textContent ?? null,
    };
  });
}

const overlaps = (a, b) => Boolean(a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
const round = (b) => (b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}` : 'none');

function checkClear(check, where, l, touch) {
  check(`${where}: the pill is on screen`, Boolean(l.pill) && l.pill.x >= 0 && l.pill.y >= 0 && l.pill.x + l.pill.w <= l.viewport.w && l.pill.y + l.pill.h <= l.viewport.h, round(l.pill));
  check(`${where}: the pill clears the deck, header and axes gizmo`, !overlaps(l.pill, l.deck) && !overlaps(l.pill, l.header) && !overlaps(l.pill, l.gizmo),
    `pill ${round(l.pill)} deck ${round(l.deck)} header ${round(l.header)} gizmo ${round(l.gizmo)}`);
  if (touch && l.pill && l.deck) check(`${where}: the pill sits above the deck`, l.pill.y + l.pill.h <= l.deck.y, `pill bottom ${Math.round(l.pill.y + l.pill.h)} deck top ${Math.round(l.deck.y)}`);
}

/**
 * Wait out the tray's 190 ms open animation (scale 0.96 -> 1, fade in). A
 * software renderer can hold the frame for seconds, so this gives up after
 * 5 s; the measurements below do not depend on it (layout sizes ignore the
 * transform, the tray box ignores the fade).
 */
async function settled(locator) {
  await locator.evaluate((node) => Promise.race([
    Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])).catch(() => {});
}

async function mcp(page, tool, args) {
  return page.evaluate(({ tool: name, args: input }) => window.__lupiViewerMcp.execute({ id: `chrome-${name}`, tool: name, arguments: input }), { tool, args });
}

export default {
  name: 'chrome',
  profiles: ['desktop', 'phone', 'phone390'],
  description: 'One Play pill: no overlap with deck/header/gizmo (incl. 844x390), P opens the tray, Poke latch, honesty label, stow.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome, options } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const still = Boolean(options?.reducedMotion);
    const press = (locator) => (touch ? locator.tap() : locator.click());
    await page.addInitScript(installStatusRecorder);
    const canvas = await h.openStructure(ctx, h.galleryEntry(ID));
    if (!canvas) return;

    // 1. One pill, no hint, the old stow names, and a teaching line.
    const pill = page.locator('[data-lupi-pill]');
    await pill.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    check('exactly one [data-lupi-pill]', (await pill.count()) === 1, `count=${await pill.count()}`);
    check('no viewer-gesture-hint', (await page.getByTestId('viewer-gesture-hint').count()) === 0);
    const stow = page.getByRole('button', { name: 'Stow viewer controls' });
    check('the stow button keeps its name, inside the pill', (await pill.getByRole('button', { name: 'Stow viewer controls' }).count()) === 1 && (await stow.getAttribute('aria-pressed')) === 'false');
    // A software renderer can take longer than the line's 10 s to get here:
    // read the page-side timeline, not the current text.
    await page.waitForFunction(() => window.__chromeRec?.log.some((e) => /Drag to spin/.test(e.text ?? '')), null, { timeout: 12_000 }).catch(() => {});
    const rec = await page.evaluate(() => window.__chromeRec);
    outcome.data.statusLog = rec.log;
    const pickVerb = touch ? /Drag to spin · Tap an atom/ : /Drag to spin · Click an atom/;
    const timeline = rec.log.map((e) => `${e.t}:${JSON.stringify(e.text)}`).join(' ');
    check('the status teaches on a first visit', rec.log.some((e) => pickVerb.test(e.text ?? '')), timeline);
    check(`the teaching line never says ${touch ? 'Click' : 'Tap'} here`, !rec.log.some((e) => (touch ? /Click an atom/ : /Tap an atom/).test(e.text ?? '')), timeline);
    if (rec.arrival) check('the arrival is labelled Illustrative while it runs', rec.log.some((e) => /^Illustrative/.test(e.text ?? '')), 'status timeline in data.statusLog');
    await h.sleep(400);
    await save('pill', await page.screenshot({ scale: 'css' }));

    // 2. Geometry, with the axes gizmo on.
    await mcp(page, 'lupi.set_viewer', { showAxes: true });
    await page.waitForSelector('[data-testid="axes-gizmo"]', { timeout: 10_000 }).catch(() => {});
    await h.sleep(500);
    const base = await layout(page);
    outcome.data.layout = { base };
    checkClear(check, 'portrait', base, touch);

    // 3. `p` opens the tray; Escape closes it; the Play segment opens it.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('p');
    const menu = page.locator('[data-lupi-pill] [role="menu"]');
    const opened = await menu.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
    await settled(menu);
    check('`p` opens the Play tray', opened && (await h.readPlay(page))?.trayOpen === true);
    const trayLayout = await layout(page);
    const items = await menu.locator('[role^="menuitem"]').evaluateAll((nodes) => nodes.map((n) => n.offsetHeight));
    outcome.data.layout.tray = trayLayout.tray;
    check('tray items are at least 44 px tall', items.length >= 9 && items.every((height) => height >= 44), `heights ${items.join(',')}`);
    check('the tray stays inside the viewport', Boolean(trayLayout.tray) && trayLayout.tray.y >= 0 && trayLayout.tray.x + trayLayout.tray.w <= trayLayout.viewport.w, round(trayLayout.tray));
    await save('tray', await page.screenshot({ scale: 'css' }));
    await page.keyboard.press('Escape');
    check('Escape closes the tray', await menu.waitFor({ state: 'detached', timeout: 3_000 }).then(() => true, () => false));
    await press(page.getByRole('button', { name: 'Play: toys and view' }));
    check('the Play segment opens the tray', await menu.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false));

    // 4. Poke latch (disabled under Still).
    const pokeItem = menu.getByRole('menuitemradio', { name: 'Poke' });
    if (still) {
      check('Poke is off under Motion: Still', (await pokeItem.getAttribute('aria-disabled')) === 'true');
      await page.keyboard.press('Escape');
    } else {
      await press(pokeItem);
      const latched = await page.waitForFunction(() => document.querySelector('.lupine-main-viewport')?.hasAttribute('data-poke') === true, null, { timeout: 3_000 }).then(() => true, () => false);
      const label = await pill.locator('.lupi-play-pill__play-label').textContent();
      check('Poke latches: pill reads Poke, lime inset on', latched && label === 'Poke' && (await h.readPlay(page))?.verb === 'poke', `label=${label}`);
      await h.sleep(300);
      await save('poke', await page.screenshot({ scale: 'css' }));
      await press(page.getByRole('button', { name: /Stop Poke/ }));
      const unlatched = await page.waitForFunction(() => !document.querySelector('.lupine-main-viewport')?.hasAttribute('data-poke'), null, { timeout: 3_000 }).then(() => true, () => false);
      check('the x unlatches Poke', unlatched && (await h.readPlay(page))?.verb === 'orbit');
    }

    // 5. The honesty label (the first toy spells it out) and its Reset. A
    //    ripple lasts well under a second (plus a 1.5 s hold), so poke again
    //    right before each step that needs it live.
    if (!still) {
      const labelled = () => page.waitForFunction(() => /^Illustrative/.test(document.querySelector('[data-lupi-pill] [role="status"]')?.textContent ?? ''), null, { timeout: 3_000 }).then(() => true, () => false);
      const poked = await page.evaluate(() => window.__lupiPlay?.poke?.(0) ?? null);
      const shown = await labelled();
      const long = await layout(page);
      outcome.data.layout.illustrative = long;
      check('a poke labels the pill Illustrative with a Reset', Boolean(poked) && shown && (await page.getByRole('button', { name: 'Reset illustrative motion' }).count()) === 1, `status=${JSON.stringify(long.status)}`);
      checkClear(check, 'long honesty label', long, touch);
      await save('illustrative', await page.screenshot({ scale: 'css' }));
      await page.evaluate(() => window.__lupiPlay?.poke?.(10));
      await labelled();
      await press(page.getByRole('button', { name: 'Reset illustrative motion' }));
      const cleared = await page.waitForFunction(() => !/^Illustrative/.test(document.querySelector('[data-lupi-pill] [role="status"]')?.textContent ?? ''), null, { timeout: 1_500 }).then(() => true, () => false);
      check('Reset puts the atoms home and drops the label (no hold)', cleared && (await h.readPlay(page))?.displaced === false);
    }

    // 6. Stow and Restore from the pill.
    await press(stow);
    const restore = page.getByRole('button', { name: 'Restore viewer controls' });
    const stowed = await restore.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false);
    check('stow keeps its semantics (Restore, aria-pressed)', stowed && (await restore.getAttribute('aria-pressed')) === 'true' && (await pill.count()) === 1);
    await h.sleep(500);
    await save('stowed', await page.screenshot({ scale: 'css' }));
    await press(restore);
    check('Restore brings the Play segment back', await page.getByRole('button', { name: 'Play: toys and view' }).waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false));

    // 7. Phone landscape (844x390): the same rules.
    if (touch) {
      await page.setViewportSize({ width: 844, height: 390 });
      await h.sleep(800);
      const land = await layout(page);
      outcome.data.layout.landscape = land;
      checkClear(check, 'landscape 844x390', land, touch);
      await save('landscape', await page.screenshot({ scale: 'css' }));
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.keyboard.press('p');
      await menu.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
      await settled(menu);
      const landTray = await layout(page);
      check('landscape: the tray fits the viewport', Boolean(landTray.tray) && landTray.tray.y >= 0 && landTray.tray.y + landTray.tray.h <= land.viewport.h, round(landTray.tray));
      await save('landscape-tray', await page.screenshot({ scale: 'css' }));
      await page.keyboard.press('Escape');
    }
  },
};
