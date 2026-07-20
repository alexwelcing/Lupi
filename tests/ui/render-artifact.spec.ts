import { createHash } from 'node:crypto';
import { expect, test, type Page } from 'playwright/test';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPORT_WIDTH = 256;
const EXPORT_HEIGHT = 192;
const NEUTRAL_HDR = Buffer.concat([
  Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n', 'ascii'),
  Buffer.from([128, 128, 128, 129]),
]);

type BridgeResponse = {
  ok: boolean;
  error?: { message?: string };
  result?: {
    molecule?: {
      name?: string;
      formula?: string;
      atomCount?: number;
      source?: string;
      inputType?: string;
    };
    asset?: RenderAsset;
    viewer?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

type RenderAsset = {
  format: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  width?: number;
  height?: number;
  dataBase64: string;
  dataUrl: string;
  contractVersion?: string;
  sourceContentDigest?: string;
  specId?: string;
  rendererFingerprint?: string;
  artifactKey?: string;
  artifactDigest?: string;
};

type DecodedRaster = {
  width: number;
  height: number;
  pixelCount: number;
  zeroAlphaPixels: number;
  nonzeroAlphaPixels: number;
  fullyOpaquePixels: number;
  minAlpha: number;
  maxAlpha: number;
  chromaticPixels: number;
  quantizedColorCount: number;
  cornerAlphas: number[];
  cornerRgb: number[][];
};

async function preparePage(page: Page) {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('https://raw.githack.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    body: NEUTRAL_HDR,
  }));
}

async function openMcpViewer(page: Page) {
  await preparePage(page);
  await page.goto('/#/mcp', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true, undefined, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__lupiViewerMcp?.status().toolCount ?? 0)).toBeGreaterThan(0);
}

async function executeTool(
  page: Page,
  tool: string,
  args: Record<string, unknown>,
): Promise<BridgeResponse> {
  const response = await page.evaluate(async ({ toolName, toolArgs }) => {
    const driver = window.__lupiViewerMcp;
    if (!driver?.ready) throw new Error('Lupi browser MCP is not ready');
    const result = await driver.execute({
      id: `playwright-${toolName}-${Date.now()}`,
      tool: toolName,
      arguments: toolArgs,
    });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return result;
  }, { toolName: tool, toolArgs: args });

  const typed = response as unknown as BridgeResponse;
  expect(typed.ok, typed.error?.message ?? `${tool} failed`).toBe(true);
  return typed;
}

function requireAsset(response: BridgeResponse): RenderAsset {
  const asset = response.result?.asset;
  expect(asset, 'lupi.export_asset returned no asset').toBeDefined();
  return asset!;
}

function inspectPngHeader(bytes: Buffer) {
  expect(bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)).toBe(true);
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

async function inspectDecodedRaster(page: Page, asset: RenderAsset): Promise<DecodedRaster> {
  return page.evaluate(async (dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    const image = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create a 2D context for raster inspection');
    context.drawImage(image, 0, 0);
    image.close();

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let zeroAlphaPixels = 0;
    let nonzeroAlphaPixels = 0;
    let fullyOpaquePixels = 0;
    let minAlpha = 255;
    let maxAlpha = 0;
    let chromaticPixels = 0;
    const quantizedColors = new Set<number>();

    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3];
      minAlpha = Math.min(minAlpha, alpha);
      maxAlpha = Math.max(maxAlpha, alpha);
      if (alpha === 0) zeroAlphaPixels += 1;
      if (alpha > 0) nonzeroAlphaPixels += 1;
      if (alpha === 255) fullyOpaquePixels += 1;
      if (alpha > 32 && Math.max(red, green, blue) - Math.min(red, green, blue) >= 18) {
        chromaticPixels += 1;
      }
      if (alpha > 32) {
        quantizedColors.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
      }
    }

    const cornerOffsets = [
      0,
      (canvas.width - 1) * 4,
      (canvas.height - 1) * canvas.width * 4,
      (canvas.height * canvas.width - 1) * 4,
    ];
    return {
      width: canvas.width,
      height: canvas.height,
      pixelCount: canvas.width * canvas.height,
      zeroAlphaPixels,
      nonzeroAlphaPixels,
      fullyOpaquePixels,
      minAlpha,
      maxAlpha,
      chromaticPixels,
      quantizedColorCount: quantizedColors.size,
      cornerAlphas: cornerOffsets.map(offset => pixels[offset + 3]),
      cornerRgb: cornerOffsets.map(offset => [pixels[offset], pixels[offset + 1], pixels[offset + 2]]),
    };
  }, asset.dataUrl);
}

function verifyArtifactEnvelope(asset: RenderAsset, bytes: Buffer) {
  expect(asset).toMatchObject({
    format: 'png',
    mimeType: 'image/png',
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    byteLength: bytes.length,
  });
  expect(asset.dataUrl).toBe(`data:image/png;base64,${asset.dataBase64}`);
  expect(asset.contractVersion).toBe('lupi.render-artifact-spec.v1');
  expect(asset.sourceContentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(asset.specId).toMatch(/^spec-sha256:[a-f0-9]{64}$/);
  expect(asset.rendererFingerprint).toMatch(/^renderer-sha256:[a-f0-9]{64}$/);
  expect(asset.artifactKey).toMatch(/^artifact-sha256:[a-f0-9]{64}$/);
  expect(asset.artifactDigest).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);

  const header = inspectPngHeader(bytes);
  expect(header).toMatchObject({ width: EXPORT_WIDTH, height: EXPORT_HEIGHT, bitDepth: 8 });
  expect([2, 6]).toContain(header.colorType);
}

async function releaseRenderer(page: Page) {
  await page.goto('about:blank', { waitUntil: 'commit', timeout: 10_000 });
}

test('@deployed-smoke browser MCP renders identifiable opaque and transparent PNG artifacts', async ({ page }) => {
  await openMcpViewer(page);

  const molecule = await executeTool(page, 'lupi.generate_molecule', {
    inputType: 'template',
    input: 'Water',
    viewer: {
      showBonds: false,
      atomScale: 1.4,
      cameraPreset: 'iso',
      colorScheme: 'element',
    },
  });
  expect(molecule.result?.molecule).toMatchObject({
    name: 'Water',
    formula: 'H2O',
    atomCount: 3,
    source: 'template',
    inputType: 'template',
  });

  await executeTool(page, 'lupi.set_background', { preset: 'slate' });
  await executeTool(page, 'lupi.set_viewer', {
    showBonds: false,
    colorScheme: 'element',
    cameraPreset: 'iso',
  });
  await executeTool(page, 'lupi.set_material', { preset: 'matte', intensity: 0.7, texture: 'none' });
  await executeTool(page, 'lupi.set_lighting', { ambient: 0.7, dir: 1, rim: 0.25 });

  const state = await page.evaluate(() => window.__lupiViewerMcp!.state());
  expect(state).toMatchObject({
    fileName: 'MCP: Water',
    atomCount: 3,
    backgroundPreset: 'slate',
    colorScheme: 'element',
    cameraPreset: 'iso',
  });

  const opaque = requireAsset(await executeTool(page, 'lupi.export_asset', {
    format: 'png',
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    transparent: false,
    baseName: 'playwright-water-opaque',
  }));
  const opaqueBytes = Buffer.from(opaque.dataBase64, 'base64');
  verifyArtifactEnvelope(opaque, opaqueBytes);
  const opaquePixels = await inspectDecodedRaster(page, opaque);
  expect(opaquePixels).toMatchObject({
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    minAlpha: 255,
    maxAlpha: 255,
    zeroAlphaPixels: 0,
    fullyOpaquePixels: opaquePixels.pixelCount,
  });
  expect(opaquePixels.chromaticPixels).toBeGreaterThan(100);
  expect(opaquePixels.quantizedColorCount).toBeGreaterThan(8);
  expect(opaquePixels.cornerRgb.every(rgb => rgb.every(channel => channel < 96))).toBe(true);

  const immediateWhiteResult = await page.evaluate(async (exportArguments) => {
    const driver = window.__lupiViewerMcp;
    if (!driver?.ready) throw new Error('Lupi browser MCP is not ready');

    const setting = await driver.execute({
      id: 'playwright-immediate-white-background',
      tool: 'lupi.set_background',
      arguments: { preset: 'white' },
    });
    // Deliberately issue the export in the same task with no caller-provided
    // requestAnimationFrame, timeout, polling, or UI settlement in between.
    const artifact = await driver.execute({
      id: 'playwright-immediate-white-export',
      tool: 'lupi.export_asset',
      arguments: exportArguments,
    });
    return { setting, artifact };
  }, {
    format: 'png',
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    transparent: false,
    fitCamera: false,
    baseName: 'playwright-water-immediate-white',
  });
  const immediateSetting = immediateWhiteResult.setting as unknown as BridgeResponse;
  const immediateResponse = immediateWhiteResult.artifact as unknown as BridgeResponse;
  expect(immediateSetting.ok, immediateSetting.error?.message ?? 'Immediate background command failed').toBe(true);
  expect(immediateResponse.ok, immediateResponse.error?.message ?? 'Immediate export command failed').toBe(true);

  const immediateWhite = requireAsset(immediateResponse);
  const immediateWhiteBytes = Buffer.from(immediateWhite.dataBase64, 'base64');
  verifyArtifactEnvelope(immediateWhite, immediateWhiteBytes);
  const immediateWhitePixels = await inspectDecodedRaster(page, immediateWhite);
  expect(immediateWhitePixels).toMatchObject({
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    minAlpha: 255,
    maxAlpha: 255,
    zeroAlphaPixels: 0,
    fullyOpaquePixels: immediateWhitePixels.pixelCount,
  });
  const darkCornerMean = opaquePixels.cornerRgb.flat().reduce((sum, channel) => sum + channel, 0) / 12;
  const whiteCornerMean = immediateWhitePixels.cornerRgb.flat().reduce((sum, channel) => sum + channel, 0) / 12;
  expect(
    immediateWhitePixels.cornerRgb.every(rgb => rgb.every(channel => channel > 180)),
    `Immediate white capture corners were ${JSON.stringify(immediateWhitePixels.cornerRgb)}; prior dark corners were ${JSON.stringify(opaquePixels.cornerRgb)}`,
  ).toBe(true);
  expect(whiteCornerMean).toBeGreaterThan(darkCornerMean + 120);
  expect(immediateWhite.sourceContentDigest).toBe(opaque.sourceContentDigest);
  expect(immediateWhite.rendererFingerprint).toBe(opaque.rendererFingerprint);
  expect(immediateWhite.specId).not.toBe(opaque.specId);
  expect(immediateWhite.artifactKey).not.toBe(opaque.artifactKey);
  expect(immediateWhite.artifactDigest).not.toBe(opaque.artifactDigest);

  const immediateMetallicResult = await page.evaluate(async (exportArguments) => {
    const driver = window.__lupiViewerMcp;
    if (!driver?.ready) throw new Error('Lupi browser MCP is not ready');
    const setting = await driver.execute({
      id: 'playwright-immediate-metallic-material',
      tool: 'lupi.set_material',
      arguments: { preset: 'metallic', intensity: 1, texture: 'none' },
    });
    const artifact = await driver.execute({
      id: 'playwright-immediate-metallic-export',
      tool: 'lupi.export_asset',
      arguments: exportArguments,
    });
    return { setting, artifact };
  }, {
    format: 'png',
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    transparent: false,
    fitCamera: false,
    baseName: 'playwright-water-immediate-metallic',
  });
  const immediateMetallicSetting = immediateMetallicResult.setting as unknown as BridgeResponse;
  const immediateMetallicResponse = immediateMetallicResult.artifact as unknown as BridgeResponse;
  expect(
    immediateMetallicSetting.ok,
    immediateMetallicSetting.error?.message ?? 'Immediate material command failed',
  ).toBe(true);
  expect(
    immediateMetallicResponse.ok,
    immediateMetallicResponse.error?.message ?? 'Immediate material export failed',
  ).toBe(true);
  const immediateMetallic = requireAsset(immediateMetallicResponse);
  const immediateMetallicBytes = Buffer.from(immediateMetallic.dataBase64, 'base64');
  verifyArtifactEnvelope(immediateMetallic, immediateMetallicBytes);
  expect(immediateMetallic.sourceContentDigest).toBe(immediateWhite.sourceContentDigest);
  expect(immediateMetallic.rendererFingerprint).toBe(immediateWhite.rendererFingerprint);
  expect(immediateMetallic.specId).not.toBe(immediateWhite.specId);
  expect(immediateMetallic.artifactKey).not.toBe(immediateWhite.artifactKey);
  // PNG bytes contain only captured pixels, not the semantic spec. A changed
  // digest proves the immediate material setting reached the rendered scene.
  expect(immediateMetallic.artifactDigest).not.toBe(immediateWhite.artifactDigest);

  const transparent = requireAsset(await executeTool(page, 'lupi.export_asset', {
    format: 'png',
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    transparent: true,
    baseName: 'playwright-water-transparent',
  }));
  const transparentBytes = Buffer.from(transparent.dataBase64, 'base64');
  verifyArtifactEnvelope(transparent, transparentBytes);
  const transparentPixels = await inspectDecodedRaster(page, transparent);
  expect(transparentPixels).toMatchObject({ width: EXPORT_WIDTH, height: EXPORT_HEIGHT, minAlpha: 0 });
  expect(transparentPixels.maxAlpha).toBeGreaterThan(0);
  expect(transparentPixels.zeroAlphaPixels).toBeGreaterThan(transparentPixels.pixelCount * 0.01);
  expect(transparentPixels.nonzeroAlphaPixels).toBeGreaterThan(100);
  expect(transparentPixels.chromaticPixels).toBeGreaterThan(100);
  expect(transparentPixels.cornerAlphas).toEqual([0, 0, 0, 0]);

  expect(transparent.specId).not.toBe(opaque.specId);
  expect(transparent.artifactKey).not.toBe(opaque.artifactKey);
  expect(transparent.artifactDigest).not.toBe(opaque.artifactDigest);
  await releaseRenderer(page);
});

test.describe('mobile render artifact reachability', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test('@deployed-smoke browser render tooling stays reachable on a phone', async ({ page }) => {
    await openMcpViewer(page);
    const molecule = await executeTool(page, 'lupi.generate_molecule', {
      inputType: 'template',
      input: 'Water',
      viewer: { showBonds: false, cameraPreset: 'iso', colorScheme: 'element' },
    });
    expect(molecule.result?.molecule).toMatchObject({ name: 'Water', formula: 'H2O', atomCount: 3 });

    await expect(page.getByRole('navigation', { name: 'Viewer navigation' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Style controls' }).click();
    await expect(page.getByTestId('viewer-controls-drawer')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      window.__lupiViewerMcp?.tools().some(tool => tool.name === 'lupi.export_asset') ?? false
    ))).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await releaseRenderer(page);
  });
});
