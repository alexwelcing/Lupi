import { expect, test } from 'playwright/test';

/**
 * The molecule switcher replaces the Elements panel: periodic table plus one
 * search box, results on the first keystroke, Enter swaps the structure in
 * place. Locally there is no edge, so the Jev judgment is absent and the
 * deterministic list, the facet filters, and the sorts are the whole feature.
 */
test('switcher swaps the molecule in place from the periodic table and search', async ({ page }) => {
  await page.goto('/?sim=water');
  await expect(page.locator('.lupine-main-viewport canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Switch command' }).click();
  const input = page.getByRole('combobox', { name: 'Switch molecule' });
  await expect(input).toBeFocused();
  await expect(page.locator('.switcher-now strong')).toContainText(/water/i);

  // Element filter: carbon + nitrogen narrows to nitrogenous organics.
  await page.getByRole('button', { name: 'Carbon (C)' }).click();
  await page.getByRole('button', { name: 'Nitrogen (N)' }).click();
  await expect(page.getByRole('button', { name: 'Nitrogen (N)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Periodic table element filter' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'containing C + N' })).toBeVisible();
  // Scoped to the result list: the sort control's <select> has options too.
  const results = page.getByRole('listbox', { name: 'Molecules to switch to' });
  const options = results.getByRole('option');
  expect(await options.count()).toBeGreaterThan(0);
  await expect(options.filter({ hasText: 'Caffeine' })).toBeVisible();

  // Typing narrows further; Enter switches without leaving the viewer.
  await input.fill('caff');
  await expect(options.first()).toContainText('Caffeine');
  await input.press('Enter');
  await expect(page).toHaveURL(/sim=caffeine/, { timeout: 30_000 });
  await expect(page.locator('.switcher-now strong')).toContainText(/caffeine/i, { timeout: 30_000 });
  // The previous molecule is one click away.
  await expect(page.getByRole('button', { name: 'Back to Water' })).toHaveCount(0);
  await input.fill('water');
  await input.press('Enter');
  await expect(page).toHaveURL(/sim=water/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Back to Caffeine' })).toBeVisible();

  // Escape inside the box clears filters instead of closing the panel.
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(page.getByRole('status').filter({ hasText: 'Familiar molecules' })).toBeVisible();
  await expect(page.getByText('best guess by Jev')).toHaveCount(0);

  // Facet filters and sorts come from the checked-in library facts: no Jev needed.
  await page.getByRole('button', { name: /Filter by/ }).click();
  await page.locator('.facet-picker').getByRole('button', { name: /^Metal \d+$/ }).click();
  await expect(page.getByRole('button', { name: 'Remove filter Metal' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('density');
  await expect(options.first()).toContainText('Tungsten');
  await expect(options.first()).toContainText('g/cm³');
  await expect(options.filter({ hasText: 'Caffeine' })).toHaveCount(0);

  // Escape clears the filters and the sort too.
  await input.press('Escape');
  await expect(page.getByRole('button', { name: 'Remove filter Metal' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Familiar molecules' })).toBeVisible();
});
