import { expect, test, type Locator, type Page } from 'playwright/test';

const CAFFEINE_ASSET = '/gallery/curated/popular/caffeine.xyz';
const TRAJECTORY_ID = 'this_is_water';
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
  await expect(page.getByRole('toolbar', { name: 'Viewer commands' })).toBeVisible({ timeout: 30_000 });

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

  const commands = page.getByRole('toolbar', { name: 'Viewer commands' });
  await commands.getByRole('button', { name: 'Visuals command' }).click();

  const visualsPanel = page.getByRole('region', { name: 'Visuals command panel' });
  await expect(visualsPanel).toBeVisible();
  await visualsPanel.getByRole('button', { name: 'Structure controls' }).click();

  const occupiedSpace = visualsPanel.getByTestId('model-preset-space');
  await occupiedSpace.click();
  await expectPressed(occupiedSpace);

  await visualsPanel.getByRole('button', { name: 'Scene controls' }).click();

  const warmBackground = visualsPanel.getByRole('button', { name: 'Warm' });
  await warmBackground.click();
  await expectPressed(warmBackground);

  await commands.getByRole('button', { name: 'Camera command' }).click();
  await expect(page.getByRole('region', { name: 'Camera command panel' })).toBeVisible();

  await commands.getByRole('button', { name: 'Learn command' }).click();
  await expect(page.getByTestId('study-lens-panel')).toBeVisible();
  await releaseRenderer(page);
});

test('@deployed-smoke a missing saved view has a visible retryable state', async ({ page }) => {
  await preparePage(page);
  const missingSlug = `playwright-missing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/#/view/${missingSlug}`, { waitUntil: 'commit' });

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 30_000 });
  if (process.env.UI_TEST_EXPECT_HEALTH === 'true') {
    await expect(page.getByRole('heading', { name: 'View not found' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: /View not found|could not be opened/i })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Retry' }).click();
  const retryStatus = page.getByRole('status').filter({ hasText: /Retry completed/ });
  await expect(retryStatus).toBeVisible({ timeout: 30_000 });
  if (process.env.UI_TEST_EXPECT_HEALTH === 'true') {
    await expect(retryStatus).toContainText('view still not found');
  }
});

test('@deployed-smoke URL MCP commands require deliberate execution', async ({ page }) => {
  await preparePage(page);
  const command = JSON.stringify({
    id: 'playwright-caffeine',
    tool: 'lupi.generate_molecule',
    arguments: { inputType: 'template', input: 'Caffeine' },
  });
  await page.goto(`/?mcpCommand=${encodeURIComponent(command)}#/mcp`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true);
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => window.__lupiViewerMcp?.status().moleculeLoaded)).toBe(false);

  const responses = await page.evaluate(async (payload) => {
    const driver = window.__lupiViewerMcp!;
    return driver.executeBatch(driver.parseCommand(payload));
  }, command);
  expect(responses[0]?.ok).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__lupiViewerMcp?.status().moleculeLoaded)).toBe(true);
  await releaseRenderer(page);
});

test('@deployed-smoke unsafe automatic molecule links fail visibly without a fetch', async ({ page }) => {
  await preparePage(page);
  const unsafeUrl = 'https://169.254.169.254/latest/meta-data.xyz';
  let unsafeRequests = 0;
  page.on('request', request => {
    if (request.url() === unsafeUrl) unsafeRequests += 1;
  });
  await page.goto(`/?load=${encodeURIComponent(unsafeUrl)}`, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: /molecule link could not be opened/i })).toBeVisible({ timeout: 30_000 });
  expect(unsafeRequests).toBe(0);
  await expect(page.getByRole('link', { name: /explore trusted examples/i })).toBeVisible();
});

test('@deployed-smoke browser origin can discover the edge MCP tools', async ({ page }) => {
  test.skip(process.env.UI_TEST_EXPECT_HEALTH !== 'true', 'Only deployed Worker origins expose /mcp');
  await page.goto('/', { waitUntil: 'commit' });
  const result = await page.evaluate(async () => {
    const rpc = async (id: string, method: string, params: Record<string, unknown> = {}) => {
      const response = await fetch('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      return { status: response.status, body: await response.json() };
    };
    const initialize = await rpc('browser-init', 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'lupi-playwright', version: '1' },
    });
    const tools = await rpc('browser-tools', 'tools/list');
    return { initialize, tools };
  });
  expect(result.initialize.status).toBe(200);
  expect(result.initialize.body).toMatchObject({ jsonrpc: '2.0', id: 'browser-init' });
  expect(result.tools.status).toBe(200);
  expect(result.tools.body).toMatchObject({ jsonrpc: '2.0', id: 'browser-tools' });
  expect(Array.isArray((result.tools.body as { result?: { tools?: unknown[] } }).result?.tools)).toBe(true);
});

test('desktop playback retains a frame overlay and all five speed controls', async ({ page }) => {
  await preparePage(page);
  await page.goto(`/?sim=${TRAJECTORY_ID}`, { waitUntil: 'commit' });
  await expectViewerReady(page);

  await expect(page.getByTestId('playback-status')).toContainText('Frame');
  const speeds = page.getByTestId('desktop-playback-speeds');
  await expect(speeds.getByRole('button')).toHaveCount(5);
  for (const speed of [0.25, 0.5, 1, 2, 4]) {
    await expect(speeds.getByRole('button', { name: `Set playback speed ${speed}×` })).toBeVisible();
  }
  await expect(page.getByTestId('mobile-playback-speed')).toHaveCount(0);
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

    const commands = page.getByRole('toolbar', { name: 'Viewer commands' });
    await expect(commands).toBeVisible({ timeout: 30_000 });

    const stowControls = page.getByRole('button', { name: 'Stow viewer controls' });
    await expect.poll(async () => {
      const [bucketBox, commandsBox] = await Promise.all([
        stowControls.boundingBox(),
        commands.boundingBox(),
      ]);
      return bucketBox !== null
        && commandsBox !== null
        && bucketBox.y + bucketBox.height <= commandsBox.y;
    }).toBe(true);

    await stowControls.click();
    await expect(commands).toHaveCSS('pointer-events', 'none');
    await page.getByRole('button', { name: 'Restore viewer controls' }).click();
    await expect(commands).toHaveCSS('pointer-events', 'auto');
    await commands.getByRole('button', { name: 'Visuals command' }).click();

    const visualsPanel = page.getByRole('region', { name: 'Visuals command panel' });
    await expect(visualsPanel).toBeVisible();
    await visualsPanel.getByRole('button', { name: 'Structure controls' }).click();
    await expect(visualsPanel.getByTestId('model-preset-space')).toBeVisible();

    await visualsPanel.getByRole('button', { name: 'Scene controls' }).click();
    await expect(visualsPanel.getByRole('button', { name: 'Warm' })).toBeVisible();

    await visualsPanel.getByRole('button', { name: 'Close Visuals panel' }).click();
    await expect(visualsPanel).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await releaseRenderer(page);
  });

  test('mobile playback uses one touch-safe cycling speed chip without a duplicate frame overlay', async ({ page }) => {
    await preparePage(page);
    await page.goto(`/?sim=${TRAJECTORY_ID}`, { waitUntil: 'commit' });

    await expect(page.getByRole('toolbar', { name: 'Viewer commands' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('transport-frame-readout')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('playback-status')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('desktop-playback-speeds')).toHaveCount(0);

    const speedChip = page.getByTestId('mobile-playback-speed');
    await expect(speedChip).toHaveCSS('touch-action', 'manipulation');
    await expect(speedChip).toHaveAccessibleName('Playback speed 1×. Tap to cycle speed.');
    for (const speed of [2, 4, 0.25, 0.5, 1]) {
      await speedChip.click();
      await expect(speedChip).toHaveAccessibleName(`Playback speed ${speed}×. Tap to cycle speed.`);
    }

    await releaseRenderer(page);
  });
});
