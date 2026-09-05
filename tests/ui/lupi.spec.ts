import { expect, test, type Locator, type Page } from 'playwright/test';

// Keep this release-only verifier aligned with the native catalog shipped in
// the signed development build without pulling the entire Expo workspace into
// the Cloudflare web/worker release branch.
const MOBILE_GALLERY_ATOM_COUNTS = {
  lupine_sphere_grid: 1_513,
  caffeine: 24,
  aspirin: 21,
  dopamine: 22,
  serotonin: 25,
  glucose: 24,
  ethanol: 9,
  water: 3,
  sodium_chloride: 2,
  acetone: 10,
  phenol: 13,
  nitrobenzene: 14,
  ethyl_acetate: 14,
  c60_buckyball: 60,
  cnt_6_6: 96,
  graphene_ribbon: 112,
  diamond_crystal: 512,
  sio2_glass: 12_000,
  cuzr_melt: 13_500,
  this_is_water: 450,
  oscillation_timeseries: 1_000,
  z1_science_path_16: 51,
  z1_science_path_27: 87,
  elliott_gst_crystallization: 4_096,
} as const;

const CAFFEINE_ASSET = '/gallery/curated/popular/caffeine.xyz';
const SPHERE_GRID_ASSET = '/generated/lupine-wiki/sphere-grid.lammpstrj';
const TRAJECTORY_ID = 'this_is_water';
const NEUTRAL_HDR = Buffer.concat([
  Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n', 'ascii'),
  Buffer.from([128, 128, 128, 129]),
]);

async function preparePage(page: Page) {
  // The app has system-font fallbacks; a third-party font CDN must never hold
  // the product gate open or decide whether a deployment is healthy.
  await page.route('https://fonts.googleapis.com/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/css',
      body: '',
    }),
  );
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  // The reflection map is an optional third-party enhancement. Supply a tiny,
  // deterministic neutral HDR so that CDN health cannot decide product health.
  await page.route('https://raw.githack.com/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: NEUTRAL_HDR,
    }),
  );
}

async function expectViewerReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Return to Lupi home' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('toolbar', { name: 'Viewer commands' })).toBeVisible({ timeout: 30_000 });

  const canvas = page.locator('.lupine-main-viewport canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const bounds = await canvas.boundingBox();
        return Boolean(bounds && bounds.width > 100 && bounds.height > 100);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function expectPressed(control: Locator) {
  await expect(control).toHaveAttribute('aria-pressed', 'true', {
    timeout: 30_000,
  });
}

async function expectHitTestable(panel: Locator) {
  // toBeVisible cannot detect an ancestor clipping the panel away (for example
  // paint containment on the status bar), so assert the opened menu actually
  // wins hit-testing at its own on-screen coordinates.
  await expect
    .poll(() =>
      panel.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const probe = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + Math.min(24, rect.height / 2),
        );
        return probe !== null && element.contains(probe);
      }),
    )
    .toBe(true);
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

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Small structures. Big discoveries.',
    }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Find an example' });
  await expect(search).toBeVisible();
  await search.fill('caffeine');

  await page.getByRole('link', { name: 'Explore Caffeine', exact: true }).click();

  await expect(page).toHaveURL(/[?&]sim=caffeine(?:&|$)/);
  await expectViewerReady(page);
  await releaseRenderer(page);
});

test('@deployed-smoke viewer settings are usable and learning tools are discoverable', async ({ page }) => {
  await preparePage(page);
  await page.goto(`/?load=${encodeURIComponent(CAFFEINE_ASSET)}`, {
    waitUntil: 'commit',
  });
  await expectViewerReady(page);

  const commands = page.getByRole('toolbar', { name: 'Viewer commands' });
  await commands.getByRole('button', { name: 'Style command' }).click();

  const visualsPanel = page.getByRole('region', {
    name: 'Style command panel',
  });
  await expect(visualsPanel).toBeVisible();
  await expect.poll(async () => {
    const model = await page.locator('.lupine-main-viewport canvas').boundingBox();
    const panel = await visualsPanel.boundingBox();
    return !!model && !!panel && model.x + model.width <= panel.x;
  }).toBe(true);
  const paper = visualsPanel.getByRole('button', { name: 'Paper look', exact: true });
  await paper.click();
  await expectPressed(paper);
  await visualsPanel.getByRole('button', { name: 'All visual mods', exact: true }).click();
  await visualsPanel.getByText('Structure guides', { exact: true }).click();
  const bonds = visualsPanel.getByRole('checkbox', { name: 'Bond guides' });
  await bonds.uncheck();
  await expect(bonds).not.toBeChecked();

  await commands.getByRole('button', { name: 'Camera command' }).click();
  await expect(page.getByRole('region', { name: 'Camera command panel' })).toBeVisible();

  await commands.getByRole('button', { name: 'Learn command' }).click();
  await expect(page.getByTestId('study-lens-panel')).toBeVisible();
  await releaseRenderer(page);
});

test('@deployed-smoke the save view and account menus open over the viewer', async ({ page }) => {
  await preparePage(page);
  await page.goto(`/?load=${encodeURIComponent(CAFFEINE_ASSET)}`, {
    waitUntil: 'commit',
  });
  await expectViewerReady(page);

  await page.getByTestId('lupi-save-view-button').click();
  const savePanel = page.getByTestId('lupi-save-view-panel');
  await expect(savePanel).toBeVisible();
  await expectHitTestable(savePanel);

  await page.keyboard.press('Escape');
  await expect(savePanel).toBeHidden();

  await page.getByTestId('lupi-agent-dock-button').click();
  const dockPanel = page.getByTestId('lupi-agent-dock-panel');
  await expect(dockPanel).toBeVisible();
  await expectHitTestable(dockPanel);
  await releaseRenderer(page);
});

test('the student style controls change the model without renderer errors', async ({ page }) => {
  await preparePage(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?sim=water');
  await expectViewerReady(page);
  await page.getByRole('button', { name: 'Style command' }).click();
  await page.getByRole('button', { name: 'Paper look', exact: true }).click();
  await expectPressed(page.getByRole('button', { name: 'Paper look', exact: true }));
  await page.getByRole('button', { name: 'All visual mods', exact: true }).click();
  await page.getByText('Structure guides', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Bond guides' }).uncheck();
  await page.getByRole('combobox', { name: 'Color by', exact: true }).selectOption('uniform');
  await expect(page.getByRole('combobox', { name: 'Color by', exact: true })).toHaveValue('uniform');
  await page.getByRole('combobox', { name: 'Color by', exact: true }).selectOption('element');
  await expect(page.getByRole('combobox', { name: 'Color by', exact: true })).toHaveValue('element');
  expect(errors).toEqual([]);
  await releaseRenderer(page);
});

test('a trajectory deep link renders without React console errors', async ({ page }) => {
  await preparePage(page);
  const consoleErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  await page.goto(`/?load=${encodeURIComponent(SPHERE_GRID_ASSET)}`, {
    waitUntil: 'commit',
  });
  await expectViewerReady(page);
  await page.waitForTimeout(1_000);

  expect(consoleErrors).toEqual([]);
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
    await expect(
      page.getByRole('heading', {
        name: /View not found|could not be opened/i,
      }),
    ).toBeVisible();
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
  await page.goto(`/?mcpCommand=${encodeURIComponent(command)}#/mcp`, {
    waitUntil: 'commit',
  });
  await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true);
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => window.__lupiViewerMcp?.status().moleculeLoaded)).toBe(false);

  const responses = await page.evaluate(async payload => {
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
  await page.goto(`/?load=${encodeURIComponent(unsafeUrl)}`, {
    waitUntil: 'commit',
  });
  await expect(page.getByRole('heading', { name: /molecule link could not be opened/i })).toBeVisible({
    timeout: 30_000,
  });
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
  expect(result.initialize.body).toMatchObject({
    jsonrpc: '2.0',
    id: 'browser-init',
  });
  expect(result.tools.status).toBe(200);
  expect(result.tools.body).toMatchObject({
    jsonrpc: '2.0',
    id: 'browser-tools',
  });
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

  test('embedded Expo route loads only the requested molecule without browser chrome or MCP controls', async ({
    page,
  }) => {
    await preparePage(page);
    const runtimeErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', error => runtimeErrors.push(error.message));

    await page.goto('/?load#/embed/mobile', { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true, null, { timeout: 30_000 });

    const embeddedRoot = page.locator('.lupine-app-root[data-embedded-mobile-viewer="true"]');
    await expect(embeddedRoot).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('lupine-mcp-harness')).toHaveCount(0);
    await expect(page.getByTestId('lupine-mcp-open')).toHaveCount(0);
    await expect(page.locator('.lupine-viewer-chrome--header')).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Viewer commands' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stow viewer controls' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Explore matter in 3D.' })).toHaveCount(0);
    expect(await page.evaluate(() => window.__lupiViewerMcp?.status().moleculeLoaded)).toBe(false);

    const responses = await page.evaluate(async () => {
      const driver = window.__lupiViewerMcp!;
      const opened = await driver.execute({
        id: 'expo-embedded-caffeine',
        tool: 'lupi.open_gallery_example',
        arguments: {
          id: 'caffeine',
          expectedAtomCount: 24,
          maxAtomCount: 50_000,
        },
      });
      const viewer = await driver.execute({
        id: 'expo-embedded-camera',
        tool: 'lupi.set_viewer',
        arguments: { cameraPreset: 'iso', showBonds: true },
      });
      const fitted = await driver.execute({
        id: 'expo-embedded-fit',
        tool: 'lupi.fit_camera',
        arguments: {},
      });
      return { opened, viewer, fitted };
    });

    expect(responses.opened.ok).toBe(true);
    expect(responses.viewer.ok).toBe(true);
    expect(responses.fitted.ok).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__lupiViewerMcp?.status().atomCount)).toBe(24);
    await expect
      .poll(() => page.evaluate(() => window.__lupiViewerMcp?.state().fileName))
      .toMatch(/Caffeine/i);
    await expect
      .poll(() => page.evaluate(() => window.__lupiViewerMcp?.status().bondCount))
      .toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(() => window.__lupiViewerMcp?.status().bondSource))
      .toMatch(/cpu|gpu/);
    expect(await page.evaluate(() => window.__lupiViewerMcp?.status().showBondsEffective)).toBe(true);
    expect(await page.evaluate(() => window.__lupiViewerMcp?.state().cameraPreset)).toBe('iso');

    const canvas = page.locator('.lupine-main-viewport canvas');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => {
        const bounds = await canvas.boundingBox();
        return Boolean(bounds && bounds.width >= 360 && bounds.height >= 700);
      })
      .toBe(true);
    await expect(page.getByTestId('lupine-mcp-harness')).toHaveCount(0);
    await expect(page.locator('.lupine-viewer-chrome--header')).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Viewer commands' })).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
    await releaseRenderer(page);
  });

  test('embedded Expo route opens every curated native gallery example without web chrome', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await preparePage(page);
    const runtimeErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', error => runtimeErrors.push(error.message));

    await page.goto('/?load#/embed/mobile', { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true, null, { timeout: 30_000 });

    const examples = Object.entries(MOBILE_GALLERY_ATOM_COUNTS).map(([id, atomCount]) => ({
      id,
      atomCount,
    }));
    expect(examples).toHaveLength(24);
    for (const [index, example] of examples.entries()) {
      if (index > 0) {
        // Native navigation keys the WebView by molecule identity. Reload the
        // embedded document here to exercise the same fresh-renderer boundary.
        await page.goto('/?load#/embed/mobile', { waitUntil: 'commit' });
        await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true, null, { timeout: 30_000 });
      }
      const response = await test.step(`open gallery example ${example.id}`, () =>
        page.evaluate(
          ({ id, expectedAtomCount, requestIndex }) =>
            Promise.race([
              window.__lupiViewerMcp!.execute({
                id: `expo-gallery-${requestIndex}`,
                tool: 'lupi.open_gallery_example',
                arguments: { id, expectedAtomCount, maxAtomCount: 50_000 },
              }),
              new Promise<never>((_, reject) => {
                window.setTimeout(() => reject(new Error(`Timed out opening gallery example ${id}`)), 25_000);
              }),
            ]),
          {
            id: example.id,
            expectedAtomCount: example.atomCount,
            requestIndex: index,
          },
        ));

      expect(response.ok, example.id).toBe(true);
      expect(response.result?.viewer, example.id).toMatchObject({
        atomCount: example.atomCount,
      });
      await expect
        .poll(() => page.evaluate(() => window.__lupiViewerMcp?.status().atomCount), { message: example.id })
        .toBe(example.atomCount);
      const canvas = page.locator('.lupine-main-viewport canvas');
      await expect(canvas, `${example.id} canvas`).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(
          async () => {
            const bounds = await canvas.boundingBox();
            return Boolean(bounds && bounds.width >= 360 && bounds.height >= 700);
          },
          { message: `${example.id} fills the embedded phone viewport` },
        )
        .toBe(true);
      await expect(page.getByTestId('lupine-mcp-harness')).toHaveCount(0);
      await expect(page.locator('.lupine-viewer-chrome--header')).toHaveCount(0);
      await expect(page.getByRole('toolbar', { name: 'Viewer commands' })).toHaveCount(0);
    }
    const rejectedDrift = await page.evaluate(() =>
      window.__lupiViewerMcp!.execute({
        id: 'expo-gallery-drift-check',
        tool: 'lupi.open_gallery_example',
        arguments: { id: 'water', expectedAtomCount: 4, maxAtomCount: 50_000 },
      }),
    );
    expect(rejectedDrift.ok).toBe(false);
    expect(rejectedDrift.error?.message).toMatch(/caller expected 4/i);
    expect(await page.evaluate(() => window.__lupiViewerMcp?.status().atomCount)).toBe(
      examples.at(-1)?.atomCount,
    );
    expect(
      await page.evaluate(() => ({
        hash: window.location.hash,
        search: window.location.search,
      })),
    ).toEqual({
      hash: '#/embed/mobile',
      search: '?load',
    });
    await expect(page.locator('.lupine-main-viewport canvas')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('lupine-mcp-harness')).toHaveCount(0);
    await expect(page.locator('.lupine-viewer-chrome--header')).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Viewer commands' })).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
    await releaseRenderer(page);
  });

  test('keeps the primary viewer settings reachable on a phone', async ({ page }) => {
    await preparePage(page);
    await page.goto(`/?load=${encodeURIComponent(CAFFEINE_ASSET)}`, {
      waitUntil: 'commit',
    });

    const commands = page.getByRole('toolbar', { name: 'Viewer commands' });
    await expect(commands).toBeVisible({ timeout: 30_000 });

    const stowControls = page.getByRole('button', {
      name: 'Stow viewer controls',
    });
    await expect
      .poll(async () => {
        const [bucketBox, commandsBox] = await Promise.all([
          stowControls.boundingBox(),
          commands.boundingBox(),
        ]);
        return bucketBox !== null && commandsBox !== null && bucketBox.y + bucketBox.height <= commandsBox.y;
      })
      .toBe(true);

    await stowControls.click();
    await expect(commands).toHaveCSS('pointer-events', 'none');
    await page.getByRole('button', { name: 'Restore viewer controls' }).click();
    await expect(commands).toHaveCSS('pointer-events', 'auto');
    await commands.getByRole('button', { name: 'Style command' }).click();

    const visualsPanel = page.getByRole('region', {
      name: 'Style command panel',
    });
    await expect(visualsPanel).toBeVisible();
    await expect(visualsPanel.getByRole('button', { name: 'Paper look', exact: true })).toBeVisible();
    await visualsPanel.getByRole('button', { name: 'All visual mods', exact: true }).click();
    await visualsPanel.getByText('Structure guides', { exact: true }).click();
    await expect(visualsPanel.getByRole('checkbox', { name: 'Bond guides' })).toBeVisible();

    await visualsPanel.getByRole('button', { name: 'Close Style panel' }).click();
    await expect(visualsPanel).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await releaseRenderer(page);
  });

  test('mobile playback uses one touch-safe cycling speed chip without a duplicate frame overlay', async ({
    page,
  }) => {
    await preparePage(page);
    await page.goto(`/?sim=${TRAJECTORY_ID}`, { waitUntil: 'commit' });

    await expect(page.getByRole('toolbar', { name: 'Viewer commands' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('transport-frame-readout')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('playback-status')).toHaveCount(0, {
      timeout: 30_000,
    });
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
