#!/usr/bin/env node
/**
 * verify-mcp-bridge.mjs
 *
 * End-to-end verification of the Lupi MCP browser bridge using Playwright.
 * Drives the real `window.__lupiViewerMcp` API in a headless Chromium tab,
 * exercises both legacy molecule tools and the new AI-control tool registry,
 * and asserts observable lifecycle events are emitted.
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const WEB_ROOT = resolve(REPO_ROOT, 'apps/web');
const ARTIFACTS = resolve(REPO_ROOT, '.verify-artifacts', 'mcp-bridge');
const requireFromWeb = createRequire(resolve(WEB_ROOT, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromWeb.resolve('vite')).href);

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(`verify-mcp-bridge.mjs

Usage:
  node tools/verify-mcp-bridge.mjs
  node tools/verify-mcp-bridge.mjs --url=http://127.0.0.1:5173/#/mcp --json

Options:
  --url=<url>          Point at an already-running dev server instead of starting Vite.
  --json               Emit a machine-readable report to stdout and suppress human logs.
  --headless=<bool>    Force headless mode (default: true unless stdout is a TTY).
  --timeout=<ms>       Maximum time to wait for bridge readiness (default: 45000).
  --help               Show this message.

Environment:
  VERIFY_URL           Same as --url.
  VERIFY_TIMEOUT       Same as --timeout.
`);
  process.exit(0);
}

const timeout = Number(args.timeout ?? process.env.VERIFY_TIMEOUT ?? 45000);
const headless = args.headless ?? !process.stdout.isTTY;
const externalUrl = process.env.VERIFY_URL || args.url;
const jsonMode = args.json === true || args.json === 'true';
const runId = stamp();

if (!existsSync(ARTIFACTS)) mkdirSync(ARTIFACTS, { recursive: true });

let server = null;
let browser = null;
const failures = [];
const report = {
  generatedAt: new Date().toISOString(),
  url: '',
  checks: [],
  consoleWarnings: [],
  pageErrors: [],
  screenshotPath: null,
};

function log(...values) {
  if (!jsonMode) console.log(...values);
}

function check(name, ok, detail = '') {
  const entry = { name, ok, detail };
  report.checks.push(entry);
  log(`${ok ? '  OK ' : '  NO '} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
}

try {
  const baseUrl = withTrailingSlash(externalUrl || await startPortlessVite());
  report.url = `${baseUrl}#/mcp`;
  log(`[verify-mcp-bridge] -> ${report.url}`);

  browser = await chromium.launch({
    headless,
    args: ['--disable-webgpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() !== 'warning' && msg.type() !== 'error') return;
    if (text.includes('[DEPRECATED] Default export is deprecated')) return;
    if (text.includes('THREE.Clock: This module has been deprecated')) return;
    if (text.includes('GPU stall due to ReadPixels')) return;
    if (text.includes('No WebGPU adapter found')) return;
    if (text.includes('No available adapters')) return;
    if (text.includes('powerPreference option is currently ignored')) return;
    if (text.includes('WebGPU init exceeded')) return;
    report.consoleWarnings.push({ type: msg.type(), text });
    log(`[PAGE ${msg.type()}] ${text}`);
  });
  page.on('pageerror', (err) => {
    report.pageErrors.push(err.message);
    log(`[PAGE ERROR] ${err.message}`);
  });

  // Expose an in-page listener for command-bus lifecycle events so we can
  // assert the bridge is observable, not just synchronous.
  await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout });
  console.log('[verify-mcp-bridge] DOM loaded; waiting for JS bundles...');
  const bodyPreview = await page.locator('body').innerText().catch(() => '');
  console.log(`[verify-mcp-bridge] body preview: ${bodyPreview.slice(0, 500).replace(/\s+/g, ' ')}`);
  await page.evaluate(() => {
    window.__lupiMcpEventLog = [];
    for (const event of ['lupi:mcp:request', 'lupi:mcp:success', 'lupi:mcp:error', 'lupi:mcp:progress']) {
      window.addEventListener(event, (e) => {
        window.__lupiMcpEventLog.push({ type: event, requestId: e.detail?.request?.id ?? e.detail?.requestId });
      });
    }
  });

  await page.waitForFunction(
    () => window.__lupiViewerMcp?.ready === true,
    null,
    { timeout },
  );
  check('MCP driver is ready on window', true);

  const tools = await page.evaluate(() => window.__lupiViewerMcp.tools());
  check(
    'driver exposes the AI-control tool registry',
    tools.some((t) => t.name === 'lupi.set_frame') && tools.some((t) => t.name === 'lupi.encode_view_url'),
    `${tools.length} tools listed`,
  );

  // Status / health endpoint
  try {
    const status = await page.evaluate(() => {
      const driver = window.__lupiViewerMcp;
      return typeof driver.status === 'function' ? driver.status() : null;
    });
    if (status) {
      check(
        'status endpoint reports ready',
        status.ready === true && status.toolCount > 0,
        `ready=${status.ready} toolCount=${status.toolCount}`,
      );
    } else {
      check('status endpoint is available', false, 'window.__lupiViewerMcp.status is not a function');
    }
  } catch (statusErr) {
    check('status endpoint returned without error', false, statusErr?.message ?? String(statusErr));
  }

  // Manifest fetch and consistency check
  try {
    const manifest = await page.evaluate(async (manifestUrl) => {
      const res = await fetch(manifestUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, `${baseUrl}browser-mcp-manifest.json`);
    const liveToolNames = new Set(tools.map((t) => t.name));
    const manifestToolNames = new Set((manifest?.tools ?? []).map((t) => t.name));
    const missing = [...liveToolNames].filter((n) => !manifestToolNames.has(n));
    const extra = [...manifestToolNames].filter((n) => !liveToolNames.has(n));
    check(
      'browser manifest matches live tool registry',
      missing.length === 0 && extra.length === 0,
      `${manifest?.tools?.length ?? 0} manifest tools; ${tools.length} live tools`,
    );
  } catch (manifestErr) {
    check('browser manifest fetch and parse', false, manifestErr?.message ?? String(manifestErr));
  }

  // Error shape check: unsupported tool should return a typed error
  try {
    const errorResult = await page.evaluate(() =>
      window.__lupiViewerMcp.execute({ id: 'verify-error', tool: 'lupi.not_a_real_tool', arguments: {} }),
    );
    check(
      'unsupported tool returns ok:false with error shape',
      errorResult.ok === false &&
        typeof errorResult.error?.code === 'string' &&
        typeof errorResult.error?.message === 'string',
      `ok=${errorResult.ok} code=${errorResult.error?.code}`,
    );
  } catch (err) {
    check('unsupported tool error shape', false, err?.message ?? String(err));
  }

  // Load a molecule through the legacy path.
  const loadResult = await page.evaluate(async () => {
    const driver = window.__lupiViewerMcp;
    return driver.execute({
      id: 'verify-load',
      tool: 'lupi.generate_molecule',
      arguments: { inputType: 'template', input: 'Benzene', viewer: { showBonds: true, atomScale: 1.1 } },
    });
  });
  check(
    'legacy generate_molecule loads a molecule',
    loadResult.ok === true && loadResult.result?.molecule?.atomCount > 0,
    `ok=${loadResult.ok} atoms=${loadResult.result?.molecule?.atomCount ?? 0}`,
  );

  // The legacy load above intentionally exercises live asynchronous bonds.
  // A content-addressed raster must not claim those mutable worker results as
  // snapshot truth, so make the visible layer set deterministic before export.
  const deterministicRasterState = await page.evaluate(async () => {
    const driver = window.__lupiViewerMcp;
    return driver.execute({
      id: 'verify-raster-state',
      tool: 'lupi.set_viewer',
      arguments: { showBonds: false },
    });
  });
  check(
    'viewer can enter deterministic raster state',
    deterministicRasterState.ok === true,
    deterministicRasterState.ok
      ? 'showBonds=false'
      : `ok=false error=${deterministicRasterState.error?.message ?? 'unknown'}`,
  );

  const assetResult = await page.evaluate(async () => {
    const driver = window.__lupiViewerMcp;
    return driver.execute({
      id: 'verify-export-asset',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256, timeoutMs: 20000 },
    });
  });
  check(
    'export_asset returns inline PNG bytes',
    assetResult.ok === true &&
      assetResult.result?.asset?.format === 'png' &&
      assetResult.result?.asset?.mimeType === 'image/png' &&
      typeof assetResult.result?.asset?.dataBase64 === 'string' &&
      assetResult.result.asset.dataBase64.length > 100,
    assetResult.ok
      ? `ok=true bytes=${assetResult.result?.asset?.byteLength ?? 0}`
      : `ok=false error=${assetResult.error?.message ?? 'unknown'}`,
  );

  // Exercise the new AI-control tools via executeBatch.
  // Apply the material scene first; it resets background/postprocess to the
  // scene defaults, so the explicit background/postprocess calls must follow.
  const batchResult = await page.evaluate(async () => {
    const driver = window.__lupiViewerMcp;
    return driver.executeBatch([
      { id: 'v-set-frame', tool: 'lupi.set_frame', arguments: { frame: 5 } },
      { id: 'v-speed', tool: 'lupi.set_playback_speed', arguments: { speed: 2 } },
      { id: 'v-cam', tool: 'lupi.set_camera_preset', arguments: { preset: 'iso' } },
      { id: 'v-mat', tool: 'lupi.set_material', arguments: { scene: 'forge', intensity: 1.1 } },
      { id: 'v-light', tool: 'lupi.set_lighting', arguments: { ambient: 0.6, dir: 0.7 } },
      { id: 'v-bg', tool: 'lupi.set_background', arguments: { preset: 'slate', opacity: 0.8 } },
      { id: 'v-pp', tool: 'lupi.set_postprocess', arguments: { preset: 'diagram', intensity: 0.6 } },
      { id: 'v-url', tool: 'lupi.encode_view_url', arguments: {} },
    ]);
  });

  const allOk = batchResult.every((r) => r.ok);
  check('batch of AI-control tools all succeed', allOk, `${batchResult.length} responses`);

  const state = await page.evaluate(() => window.__lupiViewerMcp.state());
  check('playback speed was updated', state.playbackSpeed === 2, `speed=${state.playbackSpeed}`);
  check('camera preset was updated', state.cameraPreset === 'iso', `preset=${state.cameraPreset}`);
  check('background preset was updated', state.backgroundPreset === 'slate', `background=${state.backgroundPreset}`);
  check('postprocess preset was updated', state.postprocessPreset === 'diagram', `postprocess=${state.postprocessPreset}`);

  const urlResponse = batchResult.find((r) => r.tool === 'lupi.encode_view_url');
  check(
    'encode_view_url returns a shareable URL',
    urlResponse?.ok === true && /^https?:\/\/.*\?s=/.test(urlResponse?.result?.url ?? ''),
    urlResponse?.result?.url ?? 'missing',
  );

  const eventLog = await page.evaluate(() => window.__lupiMcpEventLog ?? []);
  const hasRequestEvent = eventLog.some((e) => e.type === 'lupi:mcp:request');
  const hasSuccessEvent = eventLog.some((e) => e.type === 'lupi:mcp:success');
  check('command bus emitted request events', hasRequestEvent, `${eventLog.filter((e) => e.type === 'lupi:mcp:request').length} events`);
  check('command bus emitted success events', hasSuccessEvent, `${eventLog.filter((e) => e.type === 'lupi:mcp:success').length} events`);

  // Verify postMessage bridge path.
  const postMessageResult = await page.evaluate(async () => {
    const requestId = `verify-postmessage-${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('postMessage timeout')), 8000);
      const handler = (event) => {
        const payload = event.data;
        if (payload?.type !== 'lupi:mcp:response') return;
        if (payload.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(payload);
      };
      window.addEventListener('message', handler);
      window.postMessage(
        { type: 'lupi:mcp:execute', requestId, requests: [{ id: 'v-pm', tool: 'lupi.viewer_state', arguments: {} }] },
        window.location.origin,
      );
    });
  });
  check(
    'postMessage bridge returns a response payload',
    postMessageResult?.type === 'lupi:mcp:response' && postMessageResult?.ok === true,
  );

  const screenshotPath = join(ARTIFACTS, `${runId}-mcp-bridge.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  report.screenshotPath = screenshotPath;
  log(`[verify-mcp-bridge] screenshot: ${screenshotPath}`);
} catch (err) {
  failures.push(err?.message ?? String(err));
  log(`[verify-mcp-bridge] EXCEPTION ${err?.message ?? String(err)}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
}

const reportPath = join(ARTIFACTS, `${runId}-report.json`);
writeFileSync(reportPath, JSON.stringify({ ...report, failures }, null, 2) + '\n');
log(`[verify-mcp-bridge] report: ${reportPath}`);

if (jsonMode) {
  console.log(JSON.stringify({ ...report, failures }, null, 2));
}

if (failures.length || report.pageErrors.length) {
  for (const failure of failures) log(`[verify-mcp-bridge] FAIL ${failure}`);
  for (const error of report.pageErrors) log(`[verify-mcp-bridge] PAGE ERROR ${error}`);
  process.exit(1);
}

log('[verify-mcp-bridge] PASS');

async function startPortlessVite() {
  const port = await getFreePort();
  process.env.VITE_DEV_PORT = String(port);
  server = await createServer({
    root: WEB_ROOT,
    configFile: resolve(WEB_ROOT, 'vite.config.ts'),
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      hmr: false,
    },
    logLevel: 'warn',
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Vite did not expose a TCP address');
  }
  return `http://127.0.0.1:${address.port}/`;
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (!address || typeof address === 'string') reject(new Error('No TCP port allocated'));
        else resolvePort(address.port);
      });
    });
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, raw] = arg.slice(2).split('=');
    parsed[key] = raw === undefined ? true : raw;
  }
  return parsed;
}

function withTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
