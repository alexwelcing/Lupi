import { expect, test, type Locator, type Page } from 'playwright/test';

const CAFFEINE_ASSET = '/gallery/curated/popular/caffeine.xyz';
const NEUTRAL_HDR = Buffer.concat([
  Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n', 'ascii'),
  Buffer.from([128, 128, 128, 129]),
]);

async function preparePage(page: Page) {
  // The app has system-font fallbacks; a third-party font CDN must never hold
  // the product gate open or decide whether a deployment is healthy.
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, route => route.abort());
  // The reflection map is an optional third-party enhancement. Supply a tiny,
  // deterministic neutral HDR so that CDN health cannot decide product health.
  await page.route('https://raw.githack.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    body: NEUTRAL_HDR,
  }));
}

async function expectViewerReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Close dataset' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('viewer-tool-rail')).toBeVisible({ timeout: 30_000 });

  const canvas = page.locator('.lupine-main-viewport canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const bounds = await canvas.boundingBox();
    return Boolean(bounds && bounds.width > 100 && bounds.height > 100);
  }, { timeout: 30_000 }).toBe(true);
}

async function expectPressed(control: Locator) {
  await expect(control).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
}

async function releaseRenderer(page: Page) {
  // End the continuous WebGL render loop before Playwright tears down the
  // context; software-rendered CI browsers can otherwise spend the timeout in
  // browser shutdown after every assertion has already passed.
  await page.goto('about:blank', { waitUntil: 'commit', timeout: 10_000 });
}

test('@deployed-smoke deployed Worker reports its web assets ready', async ({ request }) => {
  test.skip(process.env.UI_TEST_EXPECT_HEALTH !== 'true', 'Only the Cloudflare Worker exposes /health');

  await expect(async () => {
    const response = await request.get('/health');
    expect(response.status()).toBe(200);
    const health = await response.json();
    expect(health).toMatchObject({
      ready: true,
      bindings: { webAssets: true },
    });
  }).toPass({
    intervals: [1_000, 2_000, 5_000, 10_000],
    timeout: 90_000,
  });
});

test('@deployed-smoke a visitor can discover caffeine and enter the viewer', async ({ page }) => {
  await preparePage(page);
  await page.goto('/', { waitUntil: 'commit' });

  await expect(page.getByRole('heading', { level: 1, name: 'Explore matter in 3D.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search molecules and materials' });
  await expect(search).toBeVisible();
  await search.fill('caffeine');

  const matches = page.getByRole('region', { name: 'Matching examples' });
  await expect(matches).toBeVisible();
  await matches.getByRole('button', { name: /^Caffeine\b/ }).click();

  await expect(page).toHaveURL(/[?&]sim=caffeine(?:&|$)/);
  await expectViewerReady(page);
  await releaseRenderer(page);
});

test('@deployed-smoke viewer settings are usable and learning tools are discoverable', async ({ page }) => {
  await preparePage(page);
  await page.goto(`/?load=${encodeURIComponent(CAFFEINE_ASSET)}`, { waitUntil: 'commit' });
  await expectViewerReady(page);

  const tools = page.getByTestId('viewer-tool-rail');
  await tools.getByRole('button', { name: 'Style' }).click();

  const structurePanel = page.getByRole('region', { name: 'Structure tool panel' });
  await expect(structurePanel).toBeVisible();
  await expect(structurePanel.getByTestId('viewer-controls-drawer')).toBeVisible();

  const occupiedSpace = structurePanel.getByTestId('quick-view-space');
  await occupiedSpace.click();
  await expectPressed(occupiedSpace);

  await structurePanel.getByRole('button', { name: 'Background' }).click();
  const backgroundPanel = page.getByRole('region', { name: 'Background tool panel' });
  await expect(backgroundPanel).toBeVisible();

  const warmBackground = backgroundPanel.getByRole('button', { name: 'Warm' });
  await warmBackground.click();
  await expectPressed(warmBackground);

  await expect(page.getByRole('button', { name: 'Camera view: Free' })).toBeVisible();
  await expect(page.getByTestId('study-lens-toggle')).toBeVisible();
  await releaseRenderer(page);
});

test.describe('mobile viewer', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test('keeps the primary viewer settings reachable on a phone', async ({ page }) => {
    await preparePage(page);
    await page.goto(`/?load=${encodeURIComponent(CAFFEINE_ASSET)}`, { waitUntil: 'commit' });

    await expect(page.getByRole('navigation', { name: 'Viewer navigation' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Style controls' }).click();

    const drawer = page.getByTestId('viewer-controls-drawer');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Background' }).click();
    await expect(drawer.getByRole('button', { name: 'Warm' })).toBeVisible();

    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(drawer).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await releaseRenderer(page);
  });
});
