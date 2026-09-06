import { expect, test } from 'playwright/test';

// These checks use the ordinary WebGPU-disabled lane: button physics must not
// depend on the optional shader device. Full GPU pixels have their own test.
test.use({ reducedMotion: 'no-preference', viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1, hasTouch: true });
test.afterEach(async ({ page }) => { await page.goto('about:blank', { waitUntil: 'commit', timeout: 10_000 }); });

test('soft buttons deform and spring back without moving the click target', async ({ page }, info) => {
  await page.goto('/?sim=glucose', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Style command', exact: true }).click();
  const remix = page.getByRole('button', { name: 'Remix scene', exact: true });
  const body = remix.locator('.lupi-action__body');
  // Wait for the containing Style drawer's entrance animation, not a fixed
  // sleep, before measuring whether button physics changes its hit rectangle.
  await remix.click({ trial: true });
  const rect = (await remix.boundingBox())!;
  const read = (key: string) => remix.evaluate((node, name) => Number((node as HTMLElement).style.getPropertyValue(`--action-${name}`)), key);
  await page.mouse.move(rect.x + rect.width - 14, rect.y + rect.height - 14);
  await expect.poll(() => read('x')).toBeGreaterThan(.5);
  await expect(body).not.toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  expect(await remix.boundingBox()).toEqual(rect);
  await expect(remix).not.toHaveAttribute('data-action-moving');
  await page.mouse.down();
  await expect.poll(() => read('press')).toBeGreaterThan(.5);
  expect(await remix.boundingBox()).toEqual(rect);
  expect(await remix.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return document.elementFromPoint(rect.x + 2, rect.y + rect.height / 2) === node;
  })).toBe(true);
  await page.screenshot({ path: info.outputPath('soft-button-pressed.png') });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Undo remix' })).toBeEnabled();
  await page.mouse.move(5, 5);
  await expect(remix).not.toHaveAttribute('data-action-moving');
  expect(await read('press')).toBe(0);
  expect(await read('x')).toBe(0);
  expect(await remix.boundingBox()).toEqual(rect);
  await expect(body).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  // Focus remains on a stationary native button; keyboard activation is native.
  await remix.focus();
  await page.keyboard.down('Space');
  await expect.poll(() => read('press')).toBeGreaterThan(.5);
  await page.keyboard.up('Space');
  await expect(remix).not.toHaveAttribute('data-action-moving');
});

test('phone touch, reduced motion and forced colors preserve stable usable actions', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?sim=glucose', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Style command', exact: true }).click();
  const remix = page.getByRole('button', { name: 'Remix scene', exact: true });
  await remix.tap();
  await expect(page.getByRole('button', { name: 'Undo remix' })).toBeEnabled();
  await expect(remix).not.toHaveAttribute('data-action-moving');
  expect((await remix.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await remix.tap();
  await expect(remix).not.toHaveAttribute('data-action-moving');
  await expect(remix.locator('.lupi-action__body')).toHaveCSS('transform', 'none');
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('soft-buttons-phone.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' });
  await expect(remix.locator('.lupi-action__body')).toBeHidden();
  await remix.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(remix).toBeFocused();
  expect(await remix.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Undo remix' })).toBeEnabled();
  await expect(remix).not.toHaveAttribute('data-action-moving');
});
