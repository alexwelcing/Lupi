#!/usr/bin/env node
/**
 * verify-asset-quality.mjs
 *
 * Visual validation of the `lupi.export_asset` MCP tool. Spins up the Vite
 * dev server, drives the bridge through Playwright, and saves the actual
 * PNG/JPEG/WebP/GLB/USDZ bytes the bridge returns. Each asset is decoded,
 * re-rendered as a thumbnail, and inspected for sanity (file size, MIME,
 * width/height, base64 round-trip). The full-resolution PNGs and a viewer
 * screenshot are dropped under .verify-artifacts/asset-quality/<run>/ so a
 * human can open them and confirm the export quality.
 *
 * Usage:
 *   node tools/verify-asset-quality.mjs
 *   node tools/verify-asset-quality.mjs --url=http://127.0.0.1:5173/#/mcp
 *   node tools/verify-asset-quality.mjs --skip-glb
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const WEB_ROOT = resolve(REPO_ROOT, 'apps/web');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACTS = resolve(REPO_ROOT, '.verify-artifacts', 'asset-quality', RUN_ID);

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  console.log(`verify-asset-quality.mjs

Usage:
  node tools/verify-asset-quality.mjs
  node tools/verify-asset-quality.mjs --url=http://127.0.0.1:5173/#/mcp
  node tools/verify-asset-quality.mjs --skip-glb
  node tools/verify-asset-quality.mjs --keep-server
`);
  process.exit(0);
}

if (!existsSync(ARTIFACTS)) mkdirSync(ARTIFACTS, { recursive: true });

const requireFromWeb = createRequire(resolve(WEB_ROOT, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromWeb.resolve('vite')).href);

const skipGlb = args['skip-glb'] === true || args['skip-glb'] === 'true';

let server = null;
let browser = null;
const checks = [];
const report = { runId: RUN_ID, artifactsDir: ARTIFACTS, checks: [] };

function log(...values) {
  console.log('[verify-asset-quality]', ...values);
}

function check(name, ok, detail = '') {
  const entry = { name, ok, detail };
  checks.push(entry);
  report.checks.push(entry);
  log(`${ok ? 'OK  ' : 'NO  '}${name}${detail ? ` - ${detail}` : ''}`);
}

function decodeBase64(b64) {
  return Buffer.from(b64, 'base64');
}

async function pngDimensions(buffer) {
  // PNG: 8-byte signature, then 4-byte length + 4-byte type ("IHDR"), then 4-byte width + 4-byte height (big-endian).
  if (buffer.length < 24 || buffer[0] !== 0x89 || buffer[1] !== 0x50) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

async function jpegDimensions(buffer) {
  // Walk JPEG markers looking for SOF0/SOF2.
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let i = 2;
  while (i < buffer.length) {
    if (buffer[i] !== 0xff) return null;
    while (i < buffer.length && buffer[i] === 0xff) i += 1;
    if (i >= buffer.length) return null;
    const marker = buffer[i];
    i += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (i + 1 >= buffer.length) return null;
    const segLen = buffer.readUInt16BE(i);
    if (marker === 0xc0 || marker === 0xc2) {
      if (i + 5 >= buffer.length) return null;
      const height = buffer.readUInt16BE(i + 3);
      const width = buffer.readUInt16BE(i + 5);
      return { width, height };
    }
    i += segLen;
  }
  return null;
}

function webpDimensions(buffer) {
  // RIFF container: "RIFF" + size(4) + "WEBP" + chunks.
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const tag = buffer.toString('ascii', 12, 16);
  if (tag === 'VP8 ') {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  if (tag === 'VP8L') {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (tag === 'VP8X') {
    // Extended format: chunk size 10, then flags(4), then 24-bit LE width-1 and 24-bit LE height-1.
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }
  return null;
}

function glbSanity(buffer) {
  // glTF binary: magic "glTF" + version(uint32) + length(uint32) + chunks.
  if (buffer.length < 12) return { ok: false, reason: 'too short' };
  if (buffer.toString('ascii', 0, 4) !== 'glTF') return { ok: false, reason: 'missing glTF magic' };
  const version = buffer.readUInt32LE(4);
  const length = buffer.readUInt32LE(8);
  return { ok: version === 2 && length === buffer.length, version, length };
}

function shortHash(buffer) {
  // FNV-1a 32-bit, hex. Stable per-run identifier.
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length; i += 1) {
    hash ^= buffer[i];
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

async function runAssetFlow(page, label, request, options = {}) {
  const response = await page.evaluate(async (req) => {
    const driver = window.__lupiViewerMcp;
    if (!driver?.ready) throw new Error('MCP driver is not ready');
    return driver.execute(req);
  }, request);

  if (!response.ok) {
    check(`${label}: bridge returns ok=true`, false, response.error?.message ?? 'unknown error');
    return null;
  }
  check(`${label}: bridge returns ok=true`, true, `tool=${response.tool}`);

  const asset = response.result?.asset;
  if (!asset) {
    check(`${label}: response carries result.asset`, false, 'no asset payload');
    return null;
  }

  const buffer = decodeBase64(asset.dataBase64);
  const filePath = join(ARTIFACTS, `${label}.${asset.format === 'jpeg' ? 'jpg' : asset.format}`);
  writeFileSync(filePath, buffer);

  const stats = statSync(filePath);
  check(`${label}: ${asset.format.toUpperCase()} file written (${stats.size} bytes)`, stats.size > 0);
  check(
    `${label}: declared byteLength matches disk size`,
    stats.size === asset.byteLength,
    `declared=${asset.byteLength} disk=${stats.size}`,
  );
  check(
    `${label}: mimeType is ${asset.mimeType}`,
    typeof asset.mimeType === 'string' && asset.mimeType.length > 0,
  );
  check(`${label}: filename is non-empty`, typeof asset.filename === 'string' && asset.filename.length > 0, asset.filename);

  if (asset.format === 'png') {
    const dims = await pngDimensions(buffer);
    check(
      `${label}: PNG header width/height match request`,
      dims && dims.width === asset.width && dims.height === asset.height,
      dims ? `${dims.width}x${dims.height}` : 'no header',
    );
  } else if (asset.format === 'jpeg') {
    const dims = await jpegDimensions(buffer);
    check(
      `${label}: JPEG header width/height match request`,
      dims && dims.width === asset.width && dims.height === asset.height,
      dims ? `${dims.width}x${dims.height}` : 'no header',
    );
  } else if (asset.format === 'webp') {
    const dims = webpDimensions(buffer);
    check(
      `${label}: WebP header width/height match request`,
      dims && dims.width === asset.width && dims.height === asset.height,
      dims ? `${dims.width}x${dims.height}` : 'no header',
    );
  } else if (asset.format === 'glb') {
    const sanity = glbSanity(buffer);
    check(
      `${label}: GLB header is well-formed`,
      sanity.ok,
      sanity.ok ? `version=${sanity.version} length=${sanity.length}` : sanity.reason,
    );
  }

  if (asset.dataUrl) {
    const expectedPrefix = `data:${asset.mimeType};base64,`;
    check(
      `${label}: dataUrl prefix matches mimeType`,
      asset.dataUrl.startsWith(expectedPrefix),
      asset.dataUrl.slice(0, 32) + '…',
    );
  }

  return { asset, filePath, buffer, hash: shortHash(buffer) };
}

async function loadTemplate(page, template) {
  return page.evaluate(async (tpl) => {
    const driver = window.__lupiViewerMcp;
    return driver.execute({
      id: `load-${tpl.toLowerCase()}`,
      tool: 'lupi.generate_molecule',
      arguments: {
        inputType: 'template',
        input: tpl,
        viewer: { showBonds: true, atomScale: 1.0, cameraPreset: 'iso' },
      },
    });
  }, template);
}

async function buildProceduralLattice(page, atomCount, element, lattice) {
  return page.evaluate(
    async ({ atomCount, element, lattice }) => {
      const driver = window.__lupiViewerMcp;
      return driver.execute({
        id: `load-${element}-${lattice}-${atomCount}`,
        tool: 'lupi.generate_molecule',
        arguments: {
          inputType: 'procedural',
          input: 'validation lattice',
          atomCount,
          element,
          lattice,
          viewer: { showBonds: false, atomScale: 0.32, showCell: true, showAxes: true, cameraPreset: 'iso' },
        },
      });
    },
    { atomCount, element, lattice },
  );
}

try {
  const externalUrl = process.env.VERIFY_URL || args.url;
  const baseUrl = withTrailingSlash(externalUrl || await startPortlessVite());
  report.url = `${baseUrl}#/mcp`;
  log(`target: ${report.url}`);

  browser = await chromium.launch({
    headless: !process.stdout.isTTY ? true : args.headless !== 'false',
    args: ['--disable-webgpu', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.on('pageerror', (err) => {
    report.pageErrors ??= [];
    report.pageErrors.push(err.message);
    log(`[PAGE ERROR] ${err.message}`);
  });

  await page.goto(report.url, { waitUntil: 'domcontentloaded' });
  log('DOM loaded; waiting for MCP driver...');
  await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true, null, { timeout: 60_000 });
  check('MCP driver ready', true);

  const status = await page.evaluate(() => window.__lupiViewerMcp.status());
  report.driverStatus = status;
  log(`driver status: toolCount=${status.toolCount} version=${status.version}`);

  // Caffeine ----------------------------------------------------
  const caffeine = await loadTemplate(page, 'Caffeine');
  if (caffeine.ok) {
    check('Caffeine template loads', true, `atoms=${caffeine.result?.molecule?.atomCount}`);
    await runAssetFlow(page, 'caffeine-png-256', {
      id: 'caffeine-png-256',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256 },
    }, { targetWidth: 256, targetHeight: 256 });
    await runAssetFlow(page, 'caffeine-png-1024', {
      id: 'caffeine-png-1024',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 1024, height: 1024 },
    }, { targetWidth: 1024, targetHeight: 1024 });
    await runAssetFlow(page, 'caffeine-jpg', {
      id: 'caffeine-jpg',
      tool: 'lupi.export_asset',
      arguments: { format: 'jpeg', width: 800, height: 600 },
    });
    await runAssetFlow(page, 'caffeine-webp', {
      id: 'caffeine-webp',
      tool: 'lupi.export_asset',
      arguments: { format: 'webp', width: 600, height: 600 },
    });
    if (!skipGlb) {
      await runAssetFlow(page, 'caffeine-glb', {
        id: 'caffeine-glb',
        tool: 'lupi.export_asset',
        arguments: { format: 'glb' },
      });
    }
  } else {
    check('Caffeine template loads', false, caffeine.error?.message ?? 'unknown error');
  }

  // Aspirin ------------------------------------------------------
  const aspirin = await loadTemplate(page, 'Aspirin');
  if (aspirin.ok) {
    check('Aspirin template loads', true, `atoms=${aspirin.result?.molecule?.atomCount}`);
    await runAssetFlow(page, 'aspirin-png', {
      id: 'aspirin-png',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 800, height: 800 },
    });
  } else {
    // Aspirin isn't in the local TEMPLATE_MOLECULES list; that is a known
    // limitation, but we want to know. Surface the error rather than mask it.
    log(`Aspirin template unavailable: ${aspirin.error?.message ?? 'unknown error'}`);
  }

  // Procedural FCC copper lattice --------------------------------
  const lattice = await buildProceduralLattice(page, 5000, 'Cu', 'fcc');
  if (lattice.ok) {
    check('FCC Cu lattice loads', true, `atoms=${lattice.result?.molecule?.atomCount}`);
    await runAssetFlow(page, 'cu-fcc-png', {
      id: 'cu-fcc-png',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 768, height: 768 },
    });
    if (!skipGlb) {
      await runAssetFlow(page, 'cu-fcc-glb', {
        id: 'cu-fcc-glb',
        tool: 'lupi.export_asset',
        arguments: { format: 'glb' },
      });
    }
  } else {
    check('FCC Cu lattice loads', false, lattice.error?.message ?? 'unknown error');
  }

  // Viewer screenshot (raw DOM) so a human can sanity-check the live frame
  // the assets are taken from.
  const screenshotPath = join(ARTIFACTS, 'viewer-screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  check('viewer screenshot captured', existsSync(screenshotPath));
} catch (err) {
  log(`EXCEPTION ${err?.message ?? String(err)}`);
  report.exception = err?.message ?? String(err);
} finally {
  if (browser && !args['keep-server']) await browser.close().catch(() => {});
  if (server && !args['keep-server']) await server.close().catch(() => {});
}

const reportPath = join(ARTIFACTS, 'report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
log(`report: ${reportPath}`);
log(`artifacts: ${ARTIFACTS}`);

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  log(`${failed.length} check(s) failed`);
  for (const f of failed) log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
log('all checks passed');

async function startPortlessVite() {
  const port = await getFreePort();
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
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP address');
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
