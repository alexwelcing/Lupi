import { expect, test, type Page } from 'playwright/test';

// release-smoke-v1: bounded deployment checks, also included in full CI.
// Keep this file self-contained: release receipts hash it and playwright.config.mjs.
// Full visual matrices, high-resolution exports and security regressions stay in CI.
const NEUTRAL_HDR = Buffer.concat([
  Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n', 'ascii'),
  Buffer.from([128, 128, 128, 129]),
]);

test.use({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1 });

test.beforeEach(async ({ page }) => {
  // Only optional third-party enhancements are stubbed, never Lupi assets/APIs.
  await page.route('https://fonts.googleapis.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.route('https://raw.githack.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: NEUTRAL_HDR }));
});

test.afterEach(async ({ page }) => {
  // Stop the continuous renderer even on failure, before software-WebGL teardown.
  if (!page.isClosed()) await page.goto('about:blank', { waitUntil: 'commit', timeout: 10_000 });
});

async function ready(page: Page, atomCount: number) {
  await expect(page.getByRole('toolbar', { name: 'Viewer commands' })).toBeVisible();
  await expect(page.locator('.lupine-main-viewport canvas')).toBeVisible();
  await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true);
  await expect.poll(() => page.evaluate(() => window.__lupiViewerMcp!.state().atomCount)).toBe(atomCount);
}

test('release: Worker health', async ({ request }) => {
  test.skip(process.env.UI_TEST_EXPECT_HEALTH !== 'true', 'Local static server has no Worker health endpoint');
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ ready: true, bindings: { webAssets: true } });
});

test('release: desktop discovery, learning, menus and PNG', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { level: 1, name: 'Small structures. Big discoveries.' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find an example' }).fill('caffeine');
  await page.getByRole('link', { name: 'Explore Caffeine', exact: true }).click();
  await expect(page).toHaveURL(/[?&]sim=caffeine(?:&|$)/);
  await ready(page, 24);
  await page.getByRole('button', { name: 'Learn command', exact: true }).click();
  await expect(page.getByTestId('study-lens-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Learn command', exact: true }).click();
  for (const [button, panel] of [
    ['lupi-save-view-button', 'lupi-save-view-panel'],
    ['lupi-agent-dock-button', 'lupi-agent-dock-panel'],
  ]) {
    await page.getByTestId(button).click();
    const menu = page.getByTestId(panel);
    await expect(menu).toBeVisible();
    await expect.poll(() => menu.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + 24));
    })).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
  // One small real artifact checks rendering/encoding; CI retains the full
  // color/alpha matrix and the ordinary UI's 2160px download test.
  const response = await page.evaluate(async () => {
    const bridge = window.__lupiViewerMcp!;
    const hidden = await bridge.execute({ id: 'release-bonds', tool: 'lupi.set_viewer', arguments: { showBonds: false } });
    if (!hidden.ok) throw new Error(JSON.stringify(hidden.error));
    return bridge.execute({ id: 'release-png', tool: 'lupi.export_asset', arguments: { format: 'png', width: 256, height: 192, transparent: true } });
  });
  expect(response.ok, JSON.stringify(response.error)).toBe(true);
  const asset = response.result!.asset as { dataBase64: string; byteLength: number };
  const bytes = Buffer.from(asset.dataBase64, 'base64');
  expect(bytes.length).toBe(asset.byteLength);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([256, 192]);
  const painted = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) opaque++;
    return opaque;
  }, asset.dataBase64);
  expect(painted).toBeGreaterThan(100);
  expect(painted).toBeLessThan(256 * 192);
  await testInfo.attach('release-caffeine.png', { body: bytes, contentType: 'image/png' });
  expect(errors).toEqual([]);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test('release: phone scene, atom-color Remix and undo', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?sim=glucose', { waitUntil: 'commit' });
    await ready(page, 24);
    const read = () => page.evaluate(() => window.__lupiViewerMcp!.state());
    const before = await read();
    const style = page.getByRole('button', { name: 'Style command', exact: true });
    await style.click();
    const sheet = page.getByRole('region', { name: 'Style command panel' });
    await expect.poll(async () => {
      const model = await page.locator('.lupine-main-viewport canvas').boundingBox();
      const panel = await sheet.boundingBox();
      return !!model && !!panel && model.height >= 200 && model.y + model.height <= panel.y;
    }).toBe(true);
    const remix = page.getByRole('button', { name: 'Remix scene', exact: true });
    const bounds = await remix.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('checkbox', { name: 'Keep atom colors' })).not.toBeChecked();
    await remix.click();
    await expect.poll(async () => (await read()).colorScheme).toBe('colorway');
    const after = await read();
    expect(after.colormap).not.toBe(before.colormap);
    for (const key of ['fileName', 'atomCount', 'frame', 'showBonds', 'atomScale'] as const) expect(after[key]).toEqual(before[key]);
    await page.screenshot({ path: testInfo.outputPath('phone-remix.png') });
    await page.getByRole('button', { name: 'Undo remix' }).click();
    await expect.poll(async () => (await read()).colormap).toBe(before.colormap);
    expect((await read()).colorScheme).toBe(before.colorScheme);
    await page.getByRole('button', { name: 'Close Style panel' }).click();
    await expect(style).toBeFocused();
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test('release: saved-view recovery and unsafe-link rejection', async ({ page }) => {
  await page.goto(`/#/view/release-missing-${Date.now()}`, { waitUntil: 'commit' });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: process.env.UI_TEST_EXPECT_HEALTH === 'true' ? 'View not found' : /View not found|could not be opened/i })).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Retry completed/ })).toBeVisible();
  const unsafeUrl = 'https://169.254.169.254/latest/meta-data.xyz';
  let requests = 0;
  page.on('request', request => { if (request.url() === unsafeUrl) requests++; });
  // Never contact the unsafe target if the guard regresses; the attempted
  // request still counts and fails the assertion.
  await page.route(unsafeUrl, route => route.abort());
  await page.goto(`/?load=${encodeURIComponent(unsafeUrl)}`, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: /molecule link could not be opened/i })).toBeVisible();
  expect(requests).toBe(0);
  await expect(page.getByRole('link', { name: /explore trusted examples/i })).toBeVisible();
});
