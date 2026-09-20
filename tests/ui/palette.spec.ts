import { expect, test } from 'playwright/test';

/**
 * The command palette asks the edge to interpret text its own action list
 * cannot match. The edge is mocked here: locally there is no Worker, and the
 * point under test is the browser contract — ask only after no match, label
 * the answer as inference, execute only on explicit selection, and go quiet
 * for the session once the edge says it is not configured.
 */
test('palette offers a labeled Jev suggestion and runs it only on selection', async ({ page }) => {
  const asked: string[] = [];
  await page.route('**/v1/viewer/command', async (route) => {
    const body = route.request().postDataJSON() as { text: string };
    asked.push(body.text);
    const semantic = /above/i.test(body.text);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        semantic
          ? { configured: true, model: 'jev-1.13.0', decision: { action: 'top', command: { tool: 'lupi.set_camera_preset', arguments: { preset: 'top' } }, confidence: 0.97, source: 'jev' } }
          : { configured: true, model: 'jev-1.13.0', decision: { action: null, reason: 'unsupported-or-multiple', source: 'jev' } },
      ),
    });
  });

  await page.goto('/?sim=water');
  await expect(page.locator('.lupine-main-viewport canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true);
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('Search commands, views, and actions...');
  await expect(input).toBeFocused();

  // A matching action never asks the edge.
  await input.fill('camera top');
  await expect(page.getByRole('button', { name: /Camera top view/ })).toBeVisible();
  expect(asked).toEqual([]);

  // Unsupported text stays a plain "no match".
  await input.fill('explain what bonds are');
  await expect(page.getByRole('status').filter({ hasText: 'No commands match' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => asked.length).toBe(1);

  // Semantic text becomes one labeled, code-owned suggestion.
  await input.fill('look at it from above');
  const suggestion = page.getByRole('button', { name: /Camera top view/ });
  await expect(suggestion).toBeVisible({ timeout: 10_000 });
  await expect(suggestion).toContainText('Jev · 97% · inferred');
  expect(await page.evaluate(() => window.__lupiViewerMcp?.state().cameraPreset)).not.toBe('top');
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__lupiViewerMcp?.state().cameraPreset), { timeout: 10_000 }).toBe('top');
  await expect(input).toHaveCount(0);
});

test('palette stops asking once the edge reports Jev is not configured', async ({ page }) => {
  let calls = 0;
  await page.route('**/v1/viewer/command', async (route) => {
    calls += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: false }) });
  });
  await page.goto('/?sim=water');
  await expect(page.locator('.lupine-main-viewport canvas')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('Search commands, views, and actions...');
  await input.fill('look at it from above');
  await expect(page.getByRole('status').filter({ hasText: 'No commands match' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => calls).toBe(1);
  await input.fill('look at it from the side');
  await expect(page.getByRole('status').filter({ hasText: 'No commands match' })).toBeVisible();
  await page.waitForTimeout(600);
  expect(calls).toBe(1);
});
