import { expect, test } from 'playwright/test';

/**
 * The molecule switcher replaces the Elements panel: periodic table plus one
 * search box, results on the first keystroke, Enter swaps the structure in
 * place. Locally there is no edge, so the Jev judgment is absent and the
 * deterministic list is the whole feature.
 */
test('switcher swaps the molecule in place from the periodic table and search', async ({ page }) => {
  await page.goto('/?sim=water');
  await expect(page.locator('.lupine-main-viewport canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Switch command' }).click();
  const input = page.getByRole('combobox', { name: 'Switch molecule' });
  await expect(input).toBeFocused();
  await expect(page.getByText('Now showing')).toBeVisible();

  // Element filter: carbon + nitrogen narrows to nitrogenous organics.
  await page.getByRole('button', { name: 'Carbon, atomic number 6' }).click();
  await page.getByRole('button', { name: 'Nitrogen, atomic number 7' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'containing C + N' })).toBeVisible();
  const options = page.getByRole('option');
  expect(await options.count()).toBeGreaterThan(0);
  await expect(page.getByRole('option').filter({ hasText: 'Caffeine' })).toBeVisible();

  // Typing narrows further; Enter switches without leaving the viewer.
  await input.fill('caff');
  await expect(options.first()).toContainText('Caffeine');
  await input.press('Enter');
  await expect(page).toHaveURL(/sim=caffeine/, { timeout: 30_000 });
  await expect(page.getByText('Now showing')).toBeVisible();
  await expect(page.locator('.switcher-now strong')).toContainText(/caffeine/i, { timeout: 30_000 });

  // Escape inside the box clears filters instead of closing the panel.
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(page.getByRole('status').filter({ hasText: /^\d+\+? matches$/ })).toBeVisible();
  await expect(page.getByText('best guess by Jev')).toHaveCount(0);
});
