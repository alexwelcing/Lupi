/**
 * settings.mjs - WP9 Sound, Haptics and Motion in Settings (LOCAL smoke
 * plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=settings --backend=both \
 *     --profile=desktop,phone390 --strict-backend --out=.verify-artifacts/viewer-smoke/settings
 *
 * On /?sim=c60_buckyball, with every AudioContext construction counted:
 * 1. Nothing makes a sound by default: no AudioContext after the load and a
 *    Play-tray Reset.
 * 2. The palette's "Open settings" opens the Settings panel. Sound and
 *    Haptics start off; Motion starts on Standard (Still under reduced
 *    motion).
 * 3. Sound on answers with a click; Motion Gentle reaches the toys.
 * 4. After a reload both persist, the page stays silent until touched, the
 *    tray shows Gentle, a tray Reset now clicks, and the tray's Settings...
 *    reopens the panel with Sound on and Gentle checked.
 */

const ID = 'c60_buckyball';

/** Page-side: count AudioContexts (every Web Audio sound starts with one). */
function installAudioCounter() {
  const counter = { created: 0 };
  window.__settingsAudio = counter;
  const wrap = (name) => {
    const Original = window[name];
    if (typeof Original !== 'function') return;
    window[name] = class extends Original {
      constructor(...args) {
        super(...args);
        counter.created += 1;
      }
    };
  };
  wrap('AudioContext');
  wrap('webkitAudioContext');
}

const audioCount = (page) => page.evaluate(() => window.__settingsAudio?.created ?? -1);

async function waitForBridge(page, atoms) {
  return page.waitForFunction((expected) => {
    const status = window.__lupiViewerMcp?.status?.();
    return Boolean(status?.moleculeLoaded && status.atomCount === expected);
  }, atoms, { timeout: 60_000, polling: 250 }).then(() => true, () => false);
}

/** The Settings panel's rows as the visitor reads them. */
async function readRows(panel) {
  const checked = async (locator) => (await locator.count()) === 1 ? locator.getAttribute('aria-checked') : 'missing';
  return {
    sound: await checked(panel.getByRole('switch', { name: 'Sound', exact: true })),
    haptics: await checked(panel.getByRole('switch', { name: 'Haptics', exact: true })),
    hapticsDisabled: await panel.getByRole('switch', { name: 'Haptics', exact: true }).isDisabled().catch(() => null),
    motion: await panel.getByRole('radiogroup', { name: 'Motion' }).getByRole('radio', { checked: true }).allTextContents(),
  };
}

export default {
  name: 'settings',
  profiles: ['desktop', 'phone', 'phone390'],
  description: 'Settings: silent by default, palette opens it, Sound on and Motion Gentle persist across a reload.',

  async run(ctx, h) {
    const { page, spec, check, save, outcome, options } = ctx;
    const touch = h.isTouchProfile(spec.profile);
    const press = (locator) => (touch ? locator.tap() : locator.click());
    const defaultMotion = options?.reducedMotion ? 'Still' : 'Standard';
    const entry = h.galleryEntry(ID);
    await page.addInitScript(installAudioCounter);
    const canvas = await h.openStructure(ctx, entry);
    if (!canvas) return;
    const pill = page.locator('[data-lupi-pill]');
    const menu = pill.locator('[role="menu"]');
    const panel = page.getByRole('region', { name: 'Settings command panel' });
    const openTray = async () => {
      await press(page.getByRole('button', { name: 'Play: toys and view' }));
      return menu.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
    };

    // 1. Silent by default, even for a cue.
    await openTray();
    await press(menu.getByRole('menuitem', { name: 'Reset' }));
    await h.sleep(300);
    check('no AudioContext by default (load + a tray Reset)', (await audioCount(page)) === 0, `created=${await audioCount(page)}`);

    // 2. The palette opens Settings; the defaults.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Control+k');
    const search = page.getByPlaceholder('Search commands, views, and actions...');
    const paletteOpen = await search.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
    if (paletteOpen) await search.fill('settings');
    const item = page.locator('button.lupine-menu-item', { hasText: 'Open settings' });
    if (paletteOpen && (await item.count()) > 0) await press(item.first());
    const opened = await panel.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
    check('the palette\'s "Open settings" opens Settings', paletteOpen && opened);
    if (!opened) return;
    const initial = await readRows(panel);
    outcome.data.initial = initial;
    check('Sound and Haptics start off', initial.sound === 'false' && initial.haptics === 'false', JSON.stringify(initial));
    check(`Motion starts on ${defaultMotion}`, initial.motion.length === 1 && initial.motion[0] === defaultMotion, JSON.stringify(initial.motion));

    // 3. Sound on (it answers with a click), Motion Gentle.
    await press(panel.getByRole('switch', { name: 'Sound', exact: true }));
    await press(panel.getByRole('radio', { name: 'Gentle' }));
    await h.sleep(300);
    const changed = await readRows(panel);
    const play = await h.readPlay(page);
    outcome.data.changed = { ...changed, comfort: play?.comfort ?? null };
    check('Sound switches on and answers with a click', changed.sound === 'true' && (await audioCount(page)) > 0, `created=${await audioCount(page)}`);
    check('Motion Gentle reaches the toys', changed.motion[0] === 'Gentle' && play?.comfort === 'gentle', JSON.stringify(outcome.data.changed));
    await save('settings', await page.screenshot({ scale: 'css' }));

    // 4. Reload: both persist, and the page stays silent until touched.
    await page.reload({ waitUntil: 'commit' });
    const back = await waitForBridge(page, entry.atoms);
    check('the viewer reloads', back);
    if (!back) return;
    await h.sleep(800);
    check('a reload with Sound on stays silent until touched', (await audioCount(page)) === 0, `created=${await audioCount(page)}`);
    const trayOpen = await openTray();
    const gentleInTray = trayOpen ? await menu.getByRole('menuitemradio', { name: 'Gentle' }).getAttribute('aria-checked') : null;
    check('the tray shows Motion Gentle after the reload', gentleInTray === 'true' && (await h.readPlay(page))?.comfort === 'gentle', `aria-checked=${gentleInTray}`);
    await save('tray-reloaded', await page.screenshot({ scale: 'css' }));
    if (trayOpen) await press(menu.getByRole('menuitem', { name: 'Reset' }));
    await h.sleep(300);
    check('with Sound on, a tray Reset clicks', (await audioCount(page)) > 0, `created=${await audioCount(page)}`);
    if (await openTray()) await press(menu.getByRole('menuitem', { name: /^Settings/ }));
    const reopened = await panel.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
    const persisted = reopened ? await readRows(panel) : null;
    outcome.data.persisted = persisted;
    check('the tray\'s Settings… reopens Settings', reopened);
    check('Sound on and Motion Gentle persist across the reload', persisted?.sound === 'true' && persisted.motion[0] === 'Gentle', JSON.stringify(persisted));
    check('Haptics stays off', persisted?.haptics === 'false', JSON.stringify(persisted));
    await h.sleep(300);
    await save('settings-reloaded', await page.screenshot({ scale: 'css' }));
  },
};
