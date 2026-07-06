#!/usr/bin/env node
/**
 * verify-streaming-ux.mjs
 *
 * Browser-level UX smoke for streamed multi-frame playback. This intentionally
 * drives visible controls and DOM affordances instead of only checking parser
 * APIs: users should see a frame-buffer status, be able to scrub, press play,
 * and never land in the canvas "Try Again" fallback during first playback.
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
const ARTIFACTS = resolve(REPO_ROOT, '.verify-artifacts', 'streaming-ux');
const requireFromWeb = createRequire(resolve(WEB_ROOT, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromWeb.resolve('vite')).href);

const args = parseArgs(process.argv.slice(2));
const timeout = Number(args.timeout ?? process.env.VERIFY_TIMEOUT ?? 45000);
const headless = args.headless ?? !process.stdout.isTTY;
const externalUrl = process.env.VERIFY_URL || args.url;
const profile = args.profile === 'mobile' ? 'mobile' : 'desktop';
const viewport = profile === 'mobile'
  ? { width: 390, height: 844 }
  : { width: 1440, height: 900 };
const runId = `${stamp()}-${profile}`;

if (!existsSync(ARTIFACTS)) mkdirSync(ARTIFACTS, { recursive: true });

let server = null;
let browser = null;
const failures = [];
const report = {
  generatedAt: new Date().toISOString(),
  profile,
  url: '',
  states: {},
  consoleWarnings: [],
  pageErrors: [],
  screenshotPath: null,
};

try {
  const baseUrl = withTrailingSlash(externalUrl || await startPortlessVite());
  const target = new URL(baseUrl);
  target.searchParams.set('debug', '1');
  target.searchParams.set('load', '/gallery/trajectories/oscillation_timeseries.glimbin');
  report.url = target.toString();
  console.log(`[verify-streaming-ux] -> ${report.url}`);

  browser = await chromium.launch({
    headless,
    args: ['--disable-webgpu'],
  });

  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: profile === 'mobile',
    hasTouch: profile === 'mobile',
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
    console.log(`[PAGE ${msg.type()}] ${text}`);
  });
  page.on('pageerror', (err) => {
    report.pageErrors.push(err.message);
    console.log(`[PAGE ERROR] ${err.message}`);
  });

  await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction(
    () => window.__atlas?.getState?.().file?.trajectory?.totalFrames > 1,
    null,
    { timeout },
  );

  const status = page.getByTestId('streaming-frame-status');
  await status.waitFor({ state: 'visible', timeout: 10000 });
  const initialStatus = await status.innerText();
  const initialState = await readStreamingState(page);
  report.states.initial = { ...initialState, status: initialStatus };
  check(
    'streaming status is visible while frames warm',
    /Buffered|Buffering/i.test(initialStatus) && initialState.loadedFrames < initialState.totalFrames,
    `${initialStatus}, loaded=${initialState.loadedFrames}/${initialState.totalFrames}`,
  );

  const scrubber = page.getByTestId('frame-scrubber');
  await scrubber.waitFor({ state: 'visible', timeout });
  const targetFrame = initialState.totalFrames - 1;
  await scrubber.fill(String(targetFrame));
  await page.waitForFunction((expected) => {
    const state = window.__atlas?.getState?.();
    return state?.frame >= expected - 0.01;
  }, targetFrame, { timeout });

  const scrubbedStatus = await status.innerText().catch(() => '');
  const scrubbedState = await readStreamingState(page);
  const scrubbedHasTryAgain = await hasTryAgain(page);
  report.states.scrubbed = { ...scrubbedState, status: scrubbedStatus };
  check(
    'scrubbing to a not-yet-warm frame remains recoverable',
    scrubbedState.frame >= targetFrame - 0.01 && !scrubbedHasTryAgain,
    `frame=${scrubbedState.frame}, status=${scrubbedStatus || 'none'}`,
  );

  await page.getByRole('button', { name: /Play\/Pause/i }).click();
  await page.waitForFunction(() => window.__atlas?.getState?.().playing === true, null, { timeout: 10000 });
  await page.waitForTimeout(3500);

  const playbackState = await readStreamingState(page);
  report.states.playback = playbackState;
  check('playback starts from the streamed timeline', playbackState.playing === true);
  check('playback keeps the canvas recovery fallback hidden', !await hasTryAgain(page));
  check('playback keeps a valid frame selected', Number.isFinite(playbackState.frame) && playbackState.frame >= 0);

  const screenshotPath = join(ARTIFACTS, `${runId}-streaming-playback.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  report.screenshotPath = screenshotPath;
  console.log(`[verify-streaming-ux] screenshot: ${screenshotPath}`);
} catch (err) {
  failures.push(err?.message ?? String(err));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
}

const reportPath = join(ARTIFACTS, `${runId}-report.json`);
writeFileSync(reportPath, JSON.stringify({ ...report, failures }, null, 2) + '\n');
console.log(`[verify-streaming-ux] report: ${reportPath}`);

if (failures.length || report.pageErrors.length) {
  for (const failure of failures) console.log(`[verify-streaming-ux] FAIL ${failure}`);
  for (const error of report.pageErrors) console.log(`[verify-streaming-ux] PAGE ERROR ${error}`);
  process.exit(1);
}

console.log('[verify-streaming-ux] PASS');

function check(name, ok, detail = '') {
  console.log(`${ok ? '  OK ' : '  NO '} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
}

async function readStreamingState(page) {
  return page.evaluate(() => {
    const state = window.__atlas.getState();
    const frames = state.file?.trajectory.frames ?? [];
    return {
      frame: state.frame,
      totalFrames: state.file?.trajectory.totalFrames ?? 0,
      loadedFrames: frames.filter(Boolean).length,
      playing: state.playing,
      sourceUrl: state.file?.sourceUrl ?? null,
    };
  });
}

async function hasTryAgain(page) {
  const text = await page.locator('body').innerText();
  return /Try Again/i.test(text);
}

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
