import { readFile } from 'node:fs/promises';
import { expect, test } from 'playwright/test';

test('student collection is bounded, has real previews, and recovers from no matches', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Small structures.Big discoveries.');
  const cards = page.locator('.student-card');
  await expect(cards).toHaveCount(12);
  await expect(page.locator('canvas')).toHaveCount(0);
  for (const image of await cards.locator('img').all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
      .toBe(true);
  }
  await page.getByRole('button', { name: 'Start small', exact: true }).click();
  await expect(cards).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Find an example' }).fill('no-such-model');
  await expect(page.getByRole('heading', { name: 'No matching examples' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(cards).toHaveCount(12);
  await expect(page.getByRole('navigation', { name: 'Primary' })).not.toContainText(/research|MLIP/i);
});

test('homepage and learning guide reflow at 320px with increased text spacing', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const path of ['/', '/study/organic-functional-groups']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // WCAG text-spacing stress test: no clipped page-level content or fixed-height prose.
    await page.addStyleTag({
      content:
        '.student-home * { line-height:1.5!important; letter-spacing:.12em!important; word-spacing:.16em!important; } .student-home p { margin-bottom:2em!important; }',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (path !== '/') {
      await expect(page.getByRole('table', { name: 'Three patterns to start with' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to the collection' })).toBeVisible();
    }
  }
});

test('retired research entry points explain the boundary without mounting a renderer', async ({ page }) => {
  for (const path of [
    '/?view=compare',
    '/?tab=research',
    '/#/system/mlip-flywheel',
    '/materials/omol25',
    '/materials/million-atom-viewer',
    '/scenes/1m-copper-lattice',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'This research workspace has retired from Lupi.',
    );
    await expect(page.getByRole('link', { name: 'Explore the learning collection' })).toHaveAttribute(
      'href',
      '/',
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
    await expect(page.locator('canvas')).toHaveCount(0);
  }
});

test('student export emits a real PNG and keeps link sharing in Save', async ({ page }, testInfo) => {
  const neutralHdr = Buffer.concat([
    Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n', 'ascii'),
    Buffer.from([128, 128, 128, 129]),
  ]);
  await page.route('https://raw.githack.com/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: neutralHdr,
    }),
  );
  await page.goto('/?sim=water');
  await expect(page.locator('.lupine-main-viewport canvas')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Elements command' }).click();
  const elementSearch = page.getByRole('searchbox', { name: 'Filter elements' });
  await elementSearch.fill('oxygen');
  await page.getByRole('button', { name: 'O · Oxygen' }).click();
  await elementSearch.fill('nitrogen');
  const nitrogen = page.getByRole('button', { name: 'N · Nitrogen' });
  await nitrogen.click();
  await expect(nitrogen).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Export command' }).click();
  const panel = page.getByTestId('simple-export-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: /copy.*link/i })).toHaveCount(0);
  await expect(page.getByTestId('export-glb')).toBeHidden();
  const downloaded = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('export-png').click();
  const download = await downloaded;
  const destination = testInfo.outputPath('water.png');
  await download.saveAs(destination);
  const bytes = await readFile(destination);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.readUInt32BE(16)).toBe(2160);
  expect(bytes.readUInt32BE(20)).toBe(2160);
  expect(bytes.byteLength).toBeGreaterThan(1000);
  await testInfo.attach('water-export', {
    path: destination,
    contentType: 'image/png',
  });
  await page.goto('about:blank', { waitUntil: 'commit' });
});
