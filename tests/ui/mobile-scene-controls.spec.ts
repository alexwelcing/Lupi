import { expect, test } from 'playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test('phone scene controls leave the model visible and update real looks', async ({ page }, testInfo) => {
  await page.goto('/?sim=glucose');
  const style = page.getByRole('button', { name: 'Style command', exact: true });
  await expect(style).toBeVisible();
  await style.click();
  const sheet = page.getByRole('region', { name: 'Style command panel' });
  await expect(page.getByRole('button', { name: 'Studio look', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const canvas = page.locator('.lupine-main-viewport canvas');
  await expect.poll(async () => {
    const model = await canvas.boundingBox();
    const panel = await sheet.boundingBox();
    return !!model && !!panel && model.y + model.height <= panel.y && model.height >= 200;
  }).toBe(true);
  await expect(page.getByTestId('viewer-gesture-hint')).toBeHidden();
  for (const name of ['Studio look', 'Paper look', 'Night look']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const rect = await button.boundingBox();
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Studio look', exact: true }).click();
  await expect(page.getByText('CPU bond path active', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/GPU bond acceleration unavailable on this device/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('mobile-studio.png') });
  await page.getByRole('button', { name: 'All visual mods', exact: true }).click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('slider', { name: 'Light direction' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('slider', { name: 'Light direction' })).toHaveValue('45');
  await page.getByRole('button', { name: 'Back to looks', exact: true }).click();
  await expect(sheet).toContainText('Custom look');
  await page.getByRole('button', { name: 'Close Style panel' }).click();
  await expect(style).toBeFocused();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Stow viewer controls' }).click();
  await expect(page.getByRole('toolbar', { name: 'Viewer commands' })).toHaveCSS('pointer-events', 'none');
  await page.getByRole('button', { name: 'Restore viewer controls' }).click();
  await style.click();
  await expect(sheet).toBeVisible();
  for (const label of await page.locator('.lupine-command-slot__label').all()) {
    expect(await label.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
});

test('scene sheet reflows at 320px and alongside the model in landscape', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?sim=water');
  await page.getByRole('button', { name: 'Style command', exact: true }).click();
  const sheet = page.getByRole('region', { name: 'Style command panel' });
  await expect(sheet).toBeVisible();
  await page.addStyleTag({ content: '.scene-controls * { line-height:1.5!important; letter-spacing:.12em!important; word-spacing:.16em!important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'All visual mods', exact: true }).click();
  await page.getByText('Structure guides', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Cell / bounding box' }).check();
  await page.getByRole('button', { name: 'Back to looks', exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => {
    const model = await page.locator('.lupine-main-viewport canvas').boundingBox();
    const panel = await sheet.boundingBox();
    return !!model && !!panel && model.x + model.width <= panel.x && model.height >= 200;
  }).toBe(true);
  await page.getByRole('button', { name: 'Paper look', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paper look', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('landscape-paper.png') });
});
