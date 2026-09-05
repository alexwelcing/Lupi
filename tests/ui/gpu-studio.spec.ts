import { expect, test } from 'playwright/test';

test('GPU Studio fails clearly without WebGPU, preserves the viewer and returns focus', async ({
  page,
}) => {
  await page.goto('/?sim=glucose');
  const launch = page.getByRole('button', { name: 'Open GPU Studio' });
  await expect(launch).toBeVisible();
  await launch.click();
  const dialog = page.getByRole('dialog', { name: 'Same molecule. Different light.' });
  await expect(dialog).toHaveAttribute('data-status', 'unavailable', { timeout: 30_000 });
  await expect(dialog).toContainText(/WebGPU is unavailable/);
  await expect(dialog.getByRole('button', { name: 'Rotate', exact: true })).toBeDisabled();
  await expect(dialog.locator('canvas')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launch).toBeFocused();
  await expect(page.locator('.lupine-main-viewport canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Learn command' }).click();
  await expect(page.getByRole('complementary', { name: 'Study Guide' })).toBeVisible();
  await launch.click();
  await expect(dialog).toHaveAttribute('data-status', 'unavailable');
  await dialog.getByRole('button', { name: 'Return to my molecule' }).click();
  await expect(launch).toBeFocused();
});

test('GPU Studio launch and fallback reflow at 320px with increased text spacing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/?sim=glucose');
  await page.getByRole('button', { name: 'Open GPU Studio' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAttribute('data-status', 'unavailable', { timeout: 30_000 });
  await page.addStyleTag({
    content:
      '.gpu-studio * { line-height:1.5!important; letter-spacing:.12em!important; word-spacing:.16em!important; }',
  });
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Back to viewer' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Return to my molecule' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
