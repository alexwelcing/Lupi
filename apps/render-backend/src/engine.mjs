import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

sharp.cache(false);
sharp.concurrency(1);

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_BROWSER_PNG_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_BYTES = 32 * 1024 * 1024;
const BROWSER_BACKGROUND_PRESET = 'void';

let browser = null;
let page = null;
let laneTail = Promise.resolve();
let active = false;
let queued = 0;

export class RendererDeadlineError extends Error {
  constructor(message = 'The render exceeded its overall deadline.') {
    super(message);
    this.name = 'RendererDeadlineError';
    this.code = 'RENDER_DEADLINE_EXCEEDED';
  }
}

export class BrowserRenderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserRenderError';
    this.code = code;
  }
}

function remainingMs(deadlineAt) {
  return Math.max(0, deadlineAt - Date.now());
}

function assertTimeRemaining(deadlineAt) {
  if (remainingMs(deadlineAt) < 1) throw new RendererDeadlineError();
}

async function withinDeadline(promise, deadlineAt, label, onTimeout = shutdownRenderer) {
  const timeoutMs = remainingMs(deadlineAt);
  if (timeoutMs < 1) throw new RendererDeadlineError();
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          void onTimeout();
          reject(new RendererDeadlineError(`${label} exceeded the render deadline.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function viewerUrl() {
  const port = Number(process.env.VIEWER_PORT || 4173);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('VIEWER_PORT must be an integer from 1 through 65535.');
  }
  return `http://127.0.0.1:${port}/#/mcp`;
}

async function ensurePage(deadlineAt) {
  assertTimeRemaining(deadlineAt);
  if (page && !page.isClosed()) return page;

  await shutdownRenderer();
  browser = await chromium.launch({
    headless: true,
    timeout: remainingMs(deadlineAt),
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu-sandbox',
      '--renderer-process-limit=1',
      // Headless WebGPU can render interactively but does not provide a
      // dependable canvas readback for export_asset. The immutable PNG lane
      // deliberately uses the proven WebGL/SwiftShader capture path.
      '--disable-webgpu',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const browserContext = await browser.newContext({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const localViewerOrigin = new URL(viewerUrl()).origin;
  await browserContext.route('**/*', async (route) => {
    const requested = new URL(route.request().url());
    if (requested.origin === localViewerOrigin || requested.protocol === 'data:' || requested.protocol === 'blob:') {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
  page = await browserContext.newPage();
  page.once('crash', () => {
    page = null;
  });
  await page.goto(viewerUrl(), {
    waitUntil: 'domcontentloaded',
    timeout: remainingMs(deadlineAt),
  });
  await page.waitForFunction(
    () => window.__lupiViewerMcp?.ready === true && window.__lupiViewerMcpReady === true,
    undefined,
    { timeout: remainingMs(deadlineAt) },
  );
  return page;
}

function bridgeFailure(response, tool) {
  const error = response?.error;
  const message = typeof error === 'string'
    ? error
    : typeof error?.message === 'string'
      ? error.message
      : typeof error?.error === 'string'
        ? error.error
        : `The ${tool} bridge command failed.`;
  return new BrowserRenderError('VIEWER_COMMAND_FAILED', message.slice(0, 500));
}

async function executeBridgeTool(viewerPage, jobId, stage, tool, args, deadlineAt) {
  const id = `${jobId}:${stage}`;
  const timeoutMs = remainingMs(deadlineAt);
  const response = await withinDeadline(
    viewerPage.evaluate(async ({ request, timeoutMs: pageTimeoutMs }) => {
      const driver = window.__lupiViewerMcp;
      if (!driver?.ready || typeof driver.execute !== 'function') {
        throw new Error('The typed Lupi viewer bridge is not ready.');
      }
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error(`Viewer command deadline exceeded after ${pageTimeoutMs} ms.`)),
          pageTimeoutMs,
        );
      });
      try {
        return await Promise.race([driver.execute(request), deadline]);
      } finally {
        window.clearTimeout(timer);
      }
    }, {
      request: { id, tool, arguments: args },
      timeoutMs,
    }),
    deadlineAt,
    tool,
  );
  if (!response || typeof response !== 'object') {
    throw new BrowserRenderError('INVALID_VIEWER_RECEIPT', `${tool} returned no typed response.`);
  }
  if (response.id !== id || response.tool !== tool) {
    throw new BrowserRenderError('INVALID_VIEWER_RECEIPT', `${tool} returned a mismatched response identity.`);
  }
  if (response.ok !== true) throw bridgeFailure(response, tool);
  return response;
}

async function settleViewer(viewerPage, deadlineAt) {
  await withinDeadline(
    viewerPage.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })),
    deadlineAt,
    'viewer frame settlement',
  );
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(MAX_BROWSER_PNG_BYTES / 3) * 4 + 4) {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser PNG payload is empty or exceeds the renderer limit.');
  }
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser PNG payload is not canonical padded base64.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_BROWSER_PNG_BYTES || bytes.toString('base64') !== value) {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser PNG payload failed canonical base64 decoding.');
  }
  return bytes;
}

function parsePngHeader(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser export is not a PNG byte stream.');
  }
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser export has no valid PNG IHDR.');
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

function requireReceiptString(receipt, key) {
  if (typeof receipt[key] !== 'string' || !receipt[key] || receipt[key].length > 1024) {
    throw new BrowserRenderError('INVALID_VIEWER_RECEIPT', `The browser export receipt is missing ${key}.`);
  }
  return receipt[key];
}

function validateBrowserReceipt(response, width, height) {
  const receipt = response?.result?.asset;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new BrowserRenderError('INVALID_VIEWER_RECEIPT', 'The browser response is missing result.asset.');
  }
  if (receipt.format !== 'png' || receipt.mimeType !== 'image/png') {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser receipt does not describe a PNG.');
  }
  if (receipt.width !== width || receipt.height !== height) {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser receipt dimensions do not match the request.');
  }
  const bytes = decodeCanonicalBase64(receipt.dataBase64);
  if (receipt.byteLength !== bytes.length) {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser receipt byteLength does not match its PNG payload.');
  }
  if (receipt.dataUrl !== `data:image/png;base64,${receipt.dataBase64}`) {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser receipt data URL does not match its PNG payload.');
  }
  const header = parsePngHeader(bytes);
  if (header.width !== width || header.height !== height) {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser PNG dimensions do not match the request.');
  }
  const artifactDigest = requireReceiptString(receipt, 'artifactDigest');
  const actualDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (artifactDigest !== actualDigest) {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'The browser artifact digest does not match its PNG payload.');
  }

  return {
    bytes,
    provenance: {
      provenanceOnly: true,
      byteScope: 'pre-rgb-reencode-provenance-only',
      identifiesResponseAsset: false,
      format: receipt.format,
      filename: requireReceiptString(receipt, 'filename'),
      mimeType: receipt.mimeType,
      width: receipt.width,
      height: receipt.height,
      byteLength: receipt.byteLength,
      contractVersion: requireReceiptString(receipt, 'contractVersion'),
      sourceContentDigest: requireReceiptString(receipt, 'sourceContentDigest'),
      specId: requireReceiptString(receipt, 'specId'),
      rendererFingerprint: requireReceiptString(receipt, 'rendererFingerprint'),
      artifactKey: requireReceiptString(receipt, 'artifactKey'),
      artifactDigest,
    },
  };
}

async function encodeCanonicalOpaquePng(sourceBytes, width, height) {
  const sourceMetadata = await sharp(sourceBytes, { limitInputPixels: width * height }).metadata();
  if (sourceMetadata.format !== 'png' || sourceMetadata.width !== width || sourceMetadata.height !== height) {
    throw new BrowserRenderError('INVALID_VIEWER_ASSET', 'Sharp decoded dimensions do not match the requested PNG dimensions.');
  }
  const { data, info } = await sharp(sourceBytes, { limitInputPixels: width * height })
    .removeAlpha()
    .toColourspace('srgb')
    .png({
      bitdepth: 8,
      palette: false,
      compressionLevel: 9,
      adaptiveFiltering: false,
      force: true,
    })
    .toBuffer({ resolveWithObject: true });
  const header = parsePngHeader(data);
  if (
    info.format !== 'png'
    || info.width !== width
    || info.height !== height
    || header.width !== width
    || header.height !== height
    || header.bitDepth !== 8
    || header.colorType !== 2
  ) {
    throw new BrowserRenderError('PNG_ENCODING_FAILED', 'Sharp did not produce the required 8-bit RGB PNG at exact dimensions.');
  }
  return data;
}

async function renderOnLane(job, deadlineAt) {
  assertTimeRemaining(deadlineAt);
  const viewerPage = await ensurePage(deadlineAt);
  await executeBridgeTool(viewerPage, job.jobId, 'reset', 'lupi.reset_viewer', {}, deadlineAt);
  await executeBridgeTool(
    viewerPage,
    job.jobId,
    'generate',
    'lupi.generate_molecule',
    job.browserMolecule,
    deadlineAt,
  );
  await executeBridgeTool(
    viewerPage,
    job.jobId,
    'viewer',
    'lupi.set_viewer',
    { showBonds: false, showCell: false, showAxes: false },
    deadlineAt,
  );
  await executeBridgeTool(
    viewerPage,
    job.jobId,
    'material',
    'lupi.set_material',
    // Blueprint is the deterministic no-HDRI scene. The default specimen
    // scene otherwise waits on a remote environment map that this sandbox
    // correctly refuses to fetch.
    { scene: 'blueprint' },
    deadlineAt,
  );
  await executeBridgeTool(
    viewerPage,
    job.jobId,
    'background',
    'lupi.set_background',
    { preset: BROWSER_BACKGROUND_PRESET, motionPaused: true, opacity: 1 },
    deadlineAt,
  );
  await settleViewer(viewerPage, deadlineAt);
  const exportResponse = await executeBridgeTool(
    viewerPage,
    job.jobId,
    'export',
    'lupi.export_asset',
    {
      format: 'png',
      width: job.width,
      height: job.height,
      transparent: false,
      fitCamera: true,
      maxInlineBytes: MAX_INLINE_BYTES,
      timeoutMs: Math.max(1000, remainingMs(deadlineAt)),
      baseName: `lupi-${job.jobId}`,
    },
    deadlineAt,
  );
  const browserAsset = validateBrowserReceipt(exportResponse, job.width, job.height);
  const output = await withinDeadline(
    encodeCanonicalOpaquePng(browserAsset.bytes, job.width, job.height),
    deadlineAt,
    'PNG canonicalization',
  );
  return {
    png: output,
    browserReceipt: browserAsset.provenance,
  };
}

/** Serialize every stateful browser render through one page and one lane. */
export function enqueueRender(job, deadlineAt) {
  queued += 1;
  const run = laneTail.then(async () => {
    queued -= 1;
    active = true;
    try {
      return await renderOnLane(job, deadlineAt);
    } catch (error) {
      await shutdownRenderer();
      throw error;
    } finally {
      active = false;
    }
  });
  laneTail = run.catch(() => undefined);
  return run;
}

export function rendererLaneState() {
  return { active, queued };
}

export async function shutdownRenderer() {
  const closingBrowser = browser;
  browser = null;
  page = null;
  if (closingBrowser) {
    try {
      await closingBrowser.close();
    } catch {
      // Shutdown is best effort; a crashed Chromium process is already closed.
    }
  }
}
