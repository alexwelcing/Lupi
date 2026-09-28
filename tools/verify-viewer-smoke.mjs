#!/usr/bin/env node
/**
 * verify-viewer-smoke.mjs
 *
 * Dual-backend "it works" smoke for the Lupi viewer. It drives the BUILT app
 * (apps/web/dist, served by tools/serve-web.mjs unless --url is given) in a
 * real Chromium and proves, per backend lane and device profile, that:
 *
 *   home     `/` loads with zero <canvas> elements and creates no WebGL/WebGPU
 *            context (the zero-canvas home rule).
 *   caffeine `/?sim=caffeine` renders a non-blank canvas with visible CPK
 *            atoms; a drag (mouse on desktop, touch on phone) rotates the view;
 *            clicking (tapping) an atom opens the atom-info card.
 *   c60      `/?sim=c60_buckyball` renders a non-blank canvas with atoms.
 *   lattice  a larger crystal-lattice gallery entry (default al_polycrystal,
 *            32,000 atoms) renders.
 *   export   the MCP bridge (window.__lupiViewerMcp) returns a valid PNG of
 *            the requested size from lupi.export_asset with bonds hidden.
 *
 * Every page's uncaught errors fail the run, as do console errors that are not
 * third-party resource noise. Rendering is judged from page screenshots of the
 * viewer canvas with all DOM chrome hidden (never readPixels), so the same
 * checks hold for WebGLRenderer, WebGPURenderer and its WebGL2 fallback.
 *
 * Lanes:
 *   webgl   Chromium without --enable-unsafe-webgpu, so navigator.gpu yields no
 *           adapter (on Linux). A WebGPURenderer app must fall back to WebGL2.
 *           If an adapter is found anyway (macOS/Windows), the lane relaunches
 *           with --disable-webgpu so it still exercises the fallback.
 *   webgpu  Chromium with --enable-unsafe-webgpu (SwiftShader adapter when
 *           headless). Needs a secure context, so the self-started server is
 *           addressed as http://localhost.
 *
 * The tool builds nothing. Build first: pnpm --filter @atlas/web build
 *
 * Artifacts (screenshots, the exported PNG, report.json) are written to
 * .verify-artifacts/viewer-smoke/<run>/ (gitignored). Exit code 0 = pass,
 * 1 = at least one check failed, 2 = setup/usage error.
 */

import { chromium, devices } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DIST_INDEX = resolve(REPO_ROOT, 'apps/web/dist/index.html');
const GALLERY_DATA = resolve(REPO_ROOT, 'packages/ui/src/gallery-data.json');
const DEFAULT_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const ALL_SCENARIOS = ['home', 'caffeine', 'c60', 'lattice', 'export'];
const PROFILE_SCENARIOS = {
  desktop: ['home', 'caffeine', 'c60', 'lattice', 'export'],
  // Export is device-independent bridge work; the phone lane covers layout,
  // touch input, DPR > 1 and the mobile tier instead.
  phone: ['home', 'caffeine', 'c60', 'lattice'],
};

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(`verify-viewer-smoke.mjs - dual-backend viewer smoke (builds nothing)

Usage:
  node tools/verify-viewer-smoke.mjs                      # both backends, both profiles
  node tools/verify-viewer-smoke.mjs --backend=webgl      # WebGL2 lane only
  node tools/verify-viewer-smoke.mjs --url=http://localhost:5173/ --backend=webgpu

Options:
  --url=<url>            Test an already-running app instead of serving apps/web/dist.
  --backend=<b>          webgl | webgpu | both (default: both).
  --profile=<p>          desktop | phone | both (default: both).
  --scenarios=<list>     Comma list from: ${ALL_SCENARIOS.join(', ')} (default: all).
  --lattice=<galleryId>  Larger structure for the lattice scenario (default: al_polycrystal).
  --server=<mode>        serve-web (default, tools/serve-web.mjs) | preview (vite preview).
  --executable=<path>    Chromium binary (default: ${DEFAULT_CHROMIUM} when present,
                         else $PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, else Playwright's own).
  --chrome-args=<a,b>    Extra Chromium flags, comma separated, added to every lane.
  --allow-console=<re>   Treat console errors matching this regular expression as known
                         noise (reported under ignoredConsoleErrors, not failed).
  --strict-backend       Fail when the app's actual renderer backend does not match the
                         lane (e.g. the webgpu lane rendering through WebGL2). Default: report only.
  --reduced-motion       Emulate prefers-reduced-motion: reduce (default: no-preference).
  --retries=<n>          Retry a failed scenario n times in a fresh page (default: 1).
  --timeout=<ms>         Per-wait timeout (default: 60000).
  --out=<dir>            Artifact directory (default: .verify-artifacts/viewer-smoke/<run>).
  --headless=<bool>      Default true.
  --json                 Print the JSON report to stdout instead of human logs.
  --help                 Show this message.

Environment:
  VERIFY_URL             Same as --url.
  VERIFY_TIMEOUT         Same as --timeout.
`);
  process.exit(0);
}

const jsonMode = args.json === true || args.json === 'true';
const timeout = positiveInt(args.timeout ?? process.env.VERIFY_TIMEOUT, 60_000);
const retries = nonNegativeInt(args.retries, 1);
const headless = args.headless === undefined ? true : !/^(false|0|no)$/i.test(String(args.headless));
const strictBackend = args['strict-backend'] === true || args['strict-backend'] === 'true';
const reducedMotion = args['reduced-motion'] === true || args['reduced-motion'] === 'true' ? 'reduce' : 'no-preference';
const externalUrl = process.env.VERIFY_URL || (typeof args.url === 'string' ? args.url : null);
const serverMode = args.server === 'preview' ? 'preview' : 'serve-web';
const latticeId = typeof args.lattice === 'string' ? args.lattice : 'al_polycrystal';
const allowConsole = typeof args['allow-console'] === 'string' ? safeRegExp(args['allow-console']) : null;
const extraChromeArgs = typeof args['chrome-args'] === 'string'
  ? args['chrome-args'].split(',').map((value) => value.trim()).filter(Boolean)
  : [];

const backends = listArg(args.backend, ['webgl', 'webgpu'], 'both');
const profiles = listArg(args.profile, ['desktop', 'phone'], 'both');
const scenarioFilter = typeof args.scenarios === 'string'
  ? args.scenarios.split(',').map((value) => value.trim()).filter(Boolean)
  : ALL_SCENARIOS;
for (const name of scenarioFilter) {
  if (!ALL_SCENARIOS.includes(name)) usageError(`Unknown scenario "${name}". Use: ${ALL_SCENARIOS.join(', ')}`);
}

const runId = stamp();
const ARTIFACTS = typeof args.out === 'string'
  ? resolve(process.cwd(), args.out)
  : resolve(REPO_ROOT, '.verify-artifacts', 'viewer-smoke', runId);
mkdirSync(ARTIFACTS, { recursive: true });

const executablePath = resolveExecutable();
const gallery = loadGallery();

const report = {
  tool: 'verify-viewer-smoke',
  version: 1,
  runId,
  generatedAt: new Date().toISOString(),
  ok: false,
  url: '',
  server: externalUrl ? 'external' : serverMode,
  artifactsDir: ARTIFACTS,
  environment: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    executablePath: executablePath ?? '(playwright default)',
    browserVersion: null,
    gitCommit: gitCommit(),
    gitDirty: gitDirty(),
    distBuiltAt: existsSync(DIST_INDEX) ? statSync(DIST_INDEX).mtime.toISOString() : null,
  },
  options: {
    backends,
    profiles,
    scenarios: scenarioFilter,
    lattice: latticeId,
    strictBackend,
    reducedMotion,
    retries,
    timeout,
    headless,
    extraChromeArgs,
    allowConsole: allowConsole?.source ?? null,
  },
  lanes: [],
  summary: null,
  failures: [],
  warnings: [],
};

let server = null;
let serverChild = null;

// Never leave a serve-web process behind, whatever happens to this one.
process.on('exit', () => {
  if (serverChild && serverChild.exitCode === null && serverChild.signalCode === null) serverChild.kill('SIGKILL');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => process.exit(130));
}

async function main() {
  let exitCode = 1;
  try {
    const baseUrl = externalUrl ? normalizeBase(externalUrl) : await startServerWithRetries();
    report.url = baseUrl;
    log(`[viewer-smoke] app: ${baseUrl}`);
    log(`[viewer-smoke] artifacts: ${ARTIFACTS}`);

    for (const backend of backends) {
      try {
        report.lanes.push(await runLane(backend, baseUrl));
      } catch (error) {
        // One lane failing to launch must not hide the other lane's result.
        report.failures.push(`${backend}: lane aborted: ${errorMessage(error)}`);
        report.lanes.push({ backend, aborted: errorMessage(error), profiles: [] });
      }
    }

    summarize();
    exitCode = report.failures.length === 0 ? 0 : 1;
  } catch (error) {
    report.failures.push(`setup: ${errorMessage(error)}`);
    log(`[viewer-smoke] SETUP FAILURE ${errorMessage(error)}`);
    exitCode = error?.usage ? 2 : 1;
    summarize();
  } finally {
    await stopServer();
  }

  const reportPath = join(ARTIFACTS, 'report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary();
    log(`[viewer-smoke] report: ${reportPath}`);
    log(`[viewer-smoke] ${exitCode === 0 ? 'PASS' : 'FAIL'}`);
  }
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Lanes and scenarios
// ---------------------------------------------------------------------------

async function runLane(backend, baseUrl) {
  const lane = {
    backend,
    chromiumArgs: laneArgs(backend, false),
    preflight: null,
    actualBackend: null,
    backendMatch: null,
    profiles: [],
  };
  log(`\n[viewer-smoke] === lane ${backend} ===`);
  let browser = await launch(lane.chromiumArgs);
  try {
    report.environment.browserVersion ??= browser.version();
    lane.preflight = await preflight(browser, baseUrl);
    if (backend === 'webgl' && lane.preflight.adapter) {
      // A lane that claims to test the WebGL2 fallback must not have an adapter.
      await browser.close().catch(() => {});
      lane.chromiumArgs = laneArgs(backend, true);
      browser = await launch(lane.chromiumArgs);
      lane.preflight = { ...(await preflight(browser, baseUrl)), escalatedToDisableWebgpu: true };
      warn(`${backend}: a WebGPU adapter was available; relaunched with --disable-webgpu`);
    }
    const preflightOk = backend === 'webgpu' ? Boolean(lane.preflight.adapter) : !lane.preflight.adapter;
    lane.preflight.ok = preflightOk;
    log(`  ${preflightOk ? 'OK ' : 'NO '} preflight: navigator.gpu=${lane.preflight.hasNavigatorGpu} adapter=${lane.preflight.adapter ? describeAdapter(lane.preflight.adapter) : 'none'} secureContext=${lane.preflight.secureContext}`);
    if (!preflightOk) {
      report.failures.push(backend === 'webgpu'
        ? `${backend}: no WebGPU adapter in the webgpu lane (secureContext=${lane.preflight.secureContext}); nothing here would prove the WebGPU backend`
        : `${backend}: a WebGPU adapter is still available in the webgl lane`);
    }

    for (const profile of profiles) {
      const profileResult = { profile, scenarios: [] };
      lane.profiles.push(profileResult);
      for (const name of PROFILE_SCENARIOS[profile]) {
        if (!scenarioFilter.includes(name)) continue;
        profileResult.scenarios.push(await runScenario(browser, { backend, profile, name, baseUrl, lane }));
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (lane.actualBackend) {
    const expected = backend === 'webgpu' ? 'webgpu' : 'webgl2';
    lane.backendMatch = lane.actualBackend.kind === expected;
    const note = `${backend} lane: app rendered through ${lane.actualBackend.kind} (${lane.actualBackend.source})`;
    if (!lane.backendMatch) {
      if (strictBackend) report.failures.push(`${note}; expected ${expected}`);
      else warn(`${note}; expected ${expected} once the app is on WebGPURenderer (report only; pass --strict-backend to enforce)`);
    }
  }
  return lane;
}

function laneArgs(backend, disableWebgpu) {
  const base = ['--enable-unsafe-swiftshader'];
  if (backend === 'webgpu') base.push('--enable-unsafe-webgpu');
  if (backend === 'webgl' && disableWebgpu) base.push('--disable-webgpu');
  return [...base, ...extraChromeArgs];
}

async function launch(chromiumArgs) {
  return chromium.launch({
    headless,
    ...(executablePath ? { executablePath } : {}),
    args: chromiumArgs,
  });
}

async function preflight(browser, baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // A static JSON file keeps the probe on the app origin (same secure-context
    // status as the app) without booting the app itself.
    await page.goto(new URL('browser-mcp-manifest.json', baseUrl).href, { waitUntil: 'commit', timeout });
    return await withTimeout(page.evaluate(async () => {
      const result = { secureContext: window.isSecureContext, hasNavigatorGpu: 'gpu' in navigator, adapter: null, error: null };
      if (!navigator.gpu) return result;
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          const info = adapter.info ?? {};
          result.adapter = {
            vendor: info.vendor ?? '',
            architecture: info.architecture ?? '',
            device: info.device ?? '',
            description: info.description ?? '',
            isFallbackAdapter: adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? null,
          };
        }
      } catch (error) {
        result.error = String(error?.message ?? error);
      }
      return result;
    }), 20_000, 'WebGPU adapter probe');
  } finally {
    await context.close().catch(() => {});
  }
}

async function runScenario(browser, spec) {
  const label = `${spec.backend}/${spec.profile}/${spec.name}`;
  const result = { name: spec.name, ok: false, flaky: false, attempts: [] };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    log(`\n[viewer-smoke] ${label}${attempt ? ` (retry ${attempt})` : ''}`);
    const outcome = await runScenarioAttempt(browser, spec, attempt);
    result.attempts.push(outcome);
    if (outcome.ok) {
      result.ok = true;
      result.flaky = attempt > 0;
      break;
    }
  }
  const last = result.attempts.at(-1);
  if (!result.ok) {
    for (const check of last.checks.filter((entry) => !entry.ok)) {
      report.failures.push(`${label}: ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
    }
    for (const error of last.errors.pageErrors) report.failures.push(`${label}: uncaught page error: ${error}`);
    for (const error of last.errors.consoleErrors) report.failures.push(`${label}: console error: ${error.text}`);
    if (last.exception) report.failures.push(`${label}: ${last.exception}`);
  } else if (result.flaky) {
    warn(`${label} passed only after ${result.attempts.length - 1} retr${result.attempts.length === 2 ? 'y' : 'ies'}`);
  }
  return result;
}

async function runScenarioAttempt(browser, spec, attempt) {
  const started = Date.now();
  const outcome = {
    attempt,
    ok: false,
    durationMs: 0,
    url: '',
    checks: [],
    screenshots: [],
    data: {},
    errors: { pageErrors: [], consoleErrors: [], ignoredConsoleErrors: [], consoleWarnings: {}, failedRequests: [], httpErrors: [] },
    exception: null,
  };
  const check = (name, ok, detail = '', data = undefined) => {
    outcome.checks.push({ name, ok: Boolean(ok), detail, ...(data === undefined ? {} : { data }) });
    log(`  ${ok ? 'OK ' : 'NO '} ${name}${detail ? ` - ${detail}` : ''}`);
    return Boolean(ok);
  };
  const prefix = `${spec.backend}-${spec.profile}-${spec.name}${attempt ? `-retry${attempt}` : ''}`;
  const save = async (step, bytes) => {
    const file = join(ARTIFACTS, `${prefix}-${step}.png`);
    writeFileSync(file, bytes);
    outcome.screenshots.push(file);
    return file;
  };

  const context = await browser.newContext(contextOptions(spec.profile));
  const page = await context.newPage();
  attachDiagnostics(page, spec.baseUrl, outcome.errors);
  await stubThirdParty(page);

  try {
    const ctx = { page, spec, check, save, outcome };
    if (spec.name === 'home') await scenarioHome(ctx);
    else if (spec.name === 'caffeine') await scenarioCaffeine(ctx);
    else if (spec.name === 'c60') await scenarioStructure(ctx, { id: 'c60_buckyball', minForeground: 0.01 });
    else if (spec.name === 'lattice') await scenarioStructure(ctx, { id: latticeId, minForeground: 0.03, loadTimeout: Math.max(timeout, 120_000) });
    else if (spec.name === 'export') await scenarioExport(ctx);
  } catch (error) {
    outcome.exception = errorMessage(error);
    log(`  NO  exception: ${outcome.exception}`);
    try {
      await save('exception', await page.screenshot({ scale: 'css' }));
    } catch {
      // The page may already be gone.
    }
  } finally {
    if (!outcome.exception && outcome.checks.some((entry) => !entry.ok)) {
      // Full page with chrome visible: shows fallbacks, alerts and layout.
      await page.screenshot({ scale: 'css', timeout: 30_000 }).then((bytes) => save('failure', bytes), () => {});
    }
    // Stop the continuous render loop before tearing the context down;
    // software-rendered browsers can otherwise spend a long time closing.
    await page.goto('about:blank', { waitUntil: 'commit', timeout: 10_000 }).catch(() => {});
    await context.close().catch(() => {});
  }

  outcome.durationMs = Date.now() - started;
  outcome.ok = !outcome.exception
    && outcome.checks.length > 0
    && outcome.checks.every((entry) => entry.ok)
    && outcome.errors.pageErrors.length === 0
    && outcome.errors.consoleErrors.length === 0;
  if (outcome.errors.pageErrors.length) log(`  NO  ${outcome.errors.pageErrors.length} uncaught page error(s): ${outcome.errors.pageErrors[0]}`);
  if (outcome.errors.consoleErrors.length) log(`  NO  ${outcome.errors.consoleErrors.length} console error(s): ${outcome.errors.consoleErrors[0].text}`);
  return outcome;
}

async function scenarioHome({ page, check, save, outcome }) {
  // Count every GPU context the landing creates, including detached canvases.
  await page.addInitScript(() => {
    const created = [];
    window.__smokeGpuContexts = created;
    const wrap = (proto) => {
      if (!proto?.getContext) return;
      const original = proto.getContext;
      proto.getContext = function getContext(type, ...rest) {
        const context = original.call(this, type, ...rest);
        if (context && /^(webgl|webgl2|experimental-webgl|webgpu)$/.test(String(type))) created.push(String(type));
        return context;
      };
    };
    wrap(globalThis.HTMLCanvasElement?.prototype);
    wrap(globalThis.OffscreenCanvas?.prototype);
    if (navigator.gpu?.requestAdapter) {
      const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
      navigator.gpu.requestAdapter = (...rest) => {
        created.push('gpu.requestAdapter');
        return requestAdapter(...rest);
      };
    }
  });
  outcome.url = baseFor(page).href;
  await page.goto(outcome.url, { waitUntil: 'load', timeout });
  const heading = page.locator('h1').first();
  await heading.waitFor({ state: 'visible', timeout });
  const headingText = (await heading.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  check('home renders a visible h1', headingText.length > 0, headingText);
  // Let lazy chunks, idle callbacks and intersection observers run.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  // Scroll through the page so lazy sections mount, then return to the top.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(1_500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1_000);
  const state = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    gpuContexts: window.__smokeGpuContexts ?? [],
    bridge: typeof window.__lupiViewerMcp,
  }));
  outcome.data.home = state;
  check('home has zero <canvas> elements', state.canvases === 0, `${state.canvases} canvas`);
  check('home creates no WebGL/WebGPU context', state.gpuContexts.length === 0, state.gpuContexts.length ? state.gpuContexts.join(', ') : 'none');
  await save('home', await page.screenshot({ scale: 'css' }));
}

async function scenarioCaffeine(ctx) {
  const { page, spec, check, save, outcome } = ctx;
  const entry = galleryEntry('caffeine');
  const canvas = await openStructure(ctx, entry);
  if (!canvas) return;

  // (b) non-blank canvas with visible CPK atoms.
  const settled = await waitSettled(page, canvas, 0.01);
  outcome.data.settle = settled.meta;
  await save('render', settled.png);
  const render = await assessRender(page, canvas, settled.image, 0.01);
  outcome.data.render = render;
  check('canvas is non-blank', render.nonBlank, `canvas-contribution=${pct(render.canvasContribution)} luminanceStd=${render.luminanceStd.toFixed(1)}`);
  check('atoms are visible', render.foregroundFraction >= 0.01, `foreground=${pct(render.foregroundFraction)} (${render.foregroundPixels}px, need >= 1%)`);
  check('CPK element colors visible (O red, N blue)', render.hues.red >= 30 && render.hues.blue >= 30, `red=${render.hues.red}px blue=${render.hues.blue}px neutral=${render.hues.neutral}px`);

  // Which renderer backend did the app actually use?
  if (render.nonBlank) {
    const backend = await detectBackend(page);
    outcome.data.backend = backend;
    ctx.spec.lane.actualBackend ??= backend;
    log(`  --  backend: ${backend.kind} via ${backend.source}${backend.engine ? `, data-engine="${backend.engine}"` : ''}${backend.glRenderer ? `, ${backend.glRenderer}` : ''}`);
  }

  // (c) drag-rotate changes the image, beyond any idle motion.
  await page.waitForTimeout(1_000);
  const idle = await captureCanvas(page, canvas);
  const idleDiff = diffImages(settled.image, idle.image);
  const start = await canvasPoint(page, canvas, 0.5, 0.55);
  if (spec.profile === 'phone') await touchDrag(page, start, { dx: 140, dy: 30 });
  else await mouseDrag(page, start, { dx: 220, dy: 40 });
  await page.waitForTimeout(600);
  const rotated = await waitSettled(page, canvas, 0.01, 8_000);
  await save('rotated', rotated.png);
  const rotateDiff = diffImages(settled.image, rotated.image);
  const area = settled.image.width * settled.image.height;
  const needed = Math.max(0.005 * area, 0.2 * render.foregroundPixels, 3 * idleDiff.changed + 200);
  outcome.data.rotate = { input: spec.profile === 'phone' ? 'touch' : 'mouse', start, idleChanged: idleDiff.changed, rotateChanged: rotateDiff.changed, needed: Math.round(needed) };
  check(
    `${spec.profile === 'phone' ? 'touch' : 'mouse'} drag rotates the view`,
    rotateDiff.changed >= needed,
    `changed=${rotateDiff.changed}px idle=${idleDiff.changed}px need>=${Math.round(needed)}px`,
  );

  // (d) clicking/tapping an atom opens the atom-info card.
  await pickAtom(ctx, canvas, rotated.image);
}

async function scenarioStructure(ctx, { id, minForeground, loadTimeout = timeout }) {
  const { page, check, save, outcome } = ctx;
  const entry = galleryEntry(id);
  const canvas = await openStructure(ctx, entry, loadTimeout);
  if (!canvas) return;
  const settled = await waitSettled(page, canvas, minForeground, 30_000);
  outcome.data.settle = settled.meta;
  await save('render', settled.png);
  const render = await assessRender(page, canvas, settled.image, minForeground);
  outcome.data.render = render;
  check('canvas is non-blank', render.nonBlank, `canvas-contribution=${pct(render.canvasContribution)} luminanceStd=${render.luminanceStd.toFixed(1)}`);
  check('atoms are visible', render.foregroundFraction >= minForeground, `foreground=${pct(render.foregroundFraction)} (${render.foregroundPixels}px, need >= ${pct(minForeground)})`);
  if (render.nonBlank) {
    const backend = await detectBackend(page);
    outcome.data.backend = backend;
    ctx.spec.lane.actualBackend ??= backend;
  }
}

async function scenarioExport(ctx) {
  const { page, check, save, outcome } = ctx;
  const entry = galleryEntry('caffeine');
  const canvas = await openStructure(ctx, entry);
  if (!canvas) return;
  await waitSettled(page, canvas, 0.01, 15_000);
  const width = 320;
  const height = 240;
  const response = await withTimeout(page.evaluate(async ({ width: w, height: h }) => {
    const bridge = window.__lupiViewerMcp;
    const hidden = await bridge.execute({ id: 'smoke-hide-bonds', tool: 'lupi.set_viewer', arguments: { showBonds: false } });
    if (!hidden.ok) return { stage: 'set_viewer', ...hidden };
    // Give the scene a frame to drop the bond layer before the snapshot.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const exported = await bridge.execute({
      id: 'smoke-export-png',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: w, height: h, transparent: true, timeoutMs: 30_000 },
    });
    return { stage: 'export_asset', ...exported };
  }, { width, height }), 90_000, 'lupi.export_asset');

  const asset = response?.result?.asset;
  const summary = asset ? { format: asset.format, mimeType: asset.mimeType, byteLength: asset.byteLength, width: asset.width, height: asset.height } : null;
  outcome.data.export = { ok: response?.ok, stage: response?.stage, error: response?.error ?? null, asset: summary, identities: pickIdentities(response?.result) };
  if (!check('bridge export_asset succeeds with bonds hidden', response?.ok === true && asset, response?.ok ? 'ok' : `${response?.stage}: ${response?.error?.code ?? ''} ${response?.error?.message ?? 'no response'}`)) return;

  check('asset declares PNG', asset.format === 'png' && asset.mimeType === 'image/png', `${asset.format} ${asset.mimeType}`);
  const bytes = Buffer.from(String(asset.dataBase64 ?? ''), 'base64');
  const file = await save('asset', bytes);
  check('declared byteLength matches decoded bytes', bytes.length > 0 && bytes.length === asset.byteLength, `${bytes.length} vs ${asset.byteLength}; ${file}`);
  const signatureOk = bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  check('bytes carry the PNG signature', signatureOk);
  if (!signatureOk) return;
  const ihdr = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  check('PNG IHDR matches the requested size', ihdr.width === width && ihdr.height === height, `${ihdr.width}x${ihdr.height}, requested ${width}x${height}`);
  let decoded = null;
  try {
    decoded = decodePng(bytes);
  } catch (error) {
    check('PNG decodes', false, errorMessage(error));
    return;
  }
  let painted = 0;
  for (let i = 3; i < decoded.data.length; i += 4) if (decoded.data[i] > 0) painted += 1;
  const fraction = painted / (decoded.width * decoded.height);
  outcome.data.export.paintedFraction = fraction;
  check('PNG decodes with a painted molecule on a transparent ground', fraction > 0.005 && fraction < 0.99, `painted=${pct(fraction)}`);
}

// ---------------------------------------------------------------------------
// Viewer helpers
// ---------------------------------------------------------------------------

async function openStructure({ page, check, outcome }, entry, loadTimeout = timeout) {
  outcome.url = new URL(`?sim=${encodeURIComponent(entry.id)}`, baseFor(page)).href;
  outcome.data.structure = entry;
  await page.goto(outcome.url, { waitUntil: 'commit', timeout });
  let status = null;
  try {
    await page.waitForFunction((expected) => {
      const bridge = window.__lupiViewerMcp;
      if (!bridge || bridge.ready !== true || typeof bridge.status !== 'function') return false;
      const current = bridge.status();
      return current.moleculeLoaded === true && current.atomCount > 0 && (expected == null || current.atomCount === expected);
    }, entry.atoms, { timeout: loadTimeout, polling: 250 });
    status = await page.evaluate(() => window.__lupiViewerMcp.status());
  } catch (error) {
    status = await page.evaluate(() => window.__lupiViewerMcp?.status?.() ?? null).catch(() => null);
    const alert = await rendererAlert(page);
    check(`${entry.id} loads through the MCP bridge`, false, `${alert ? `renderer fallback: ${alert}; ` : ''}status=${JSON.stringify(status)}; ${errorMessage(error).split('\n')[0]}`);
    return null;
  }
  outcome.data.status = status;
  check(`${entry.id} loads (${status.atomCount} atoms)`, entry.atoms == null || status.atomCount === entry.atoms, `expected ${entry.atoms ?? 'any'}`);

  const canvas = await mainCanvas(page);
  if (!canvas) {
    const alert = await rendererAlert(page);
    check('viewer canvas is present', false, alert ? `renderer fallback shown: ${alert}` : 'no visible canvas in the viewer');
    return null;
  }
  const box = await canvas.boundingBox();
  check('viewer canvas is sized', Boolean(box && box.width >= 100 && box.height >= 100), box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no box');
  const alert = await rendererAlert(page);
  if (alert) {
    check('no renderer fallback over the canvas', false, alert);
    return null;
  }
  // Tag the canvas so screenshots can hide every other element by CSS.
  await canvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
  return canvas;
}

async function mainCanvas(page) {
  const selectors = ['.lupine-main-viewport canvas', '#lupi-viewer-canvas canvas', 'canvas#lupi-viewer-canvas'];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        const box = await locator.boundingBox().catch(() => null);
        if (box && box.width >= 100 && box.height >= 100) return locator;
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function rendererAlert(page) {
  // RendererFallback / CanvasErrorBoundary fill the viewport region with a
  // role="alert" banner instead of a canvas.
  return page.evaluate(() => {
    const viewport = document.querySelector('.lupine-main-viewport') ?? document.body;
    const area = Math.max(1, viewport.getBoundingClientRect().width * viewport.getBoundingClientRect().height);
    for (const node of document.querySelectorAll('[role="alert"]')) {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if ((rect.width * rect.height) / area > 0.4) return node.textContent.replace(/\s+/g, ' ').trim().slice(0, 200);
    }
    return null;
  }).catch(() => null);
}

const HIDE_CHROME_CSS = 'body * { visibility: hidden !important; } [data-smoke-main] { visibility: visible !important; }';
const HIDE_ALL_CSS = 'body * { visibility: hidden !important; }';

const cdpSessions = new WeakMap();

async function cdpFor(page) {
  if (!cdpSessions.has(page)) cdpSessions.set(page, await page.context().newCDPSession(page));
  return cdpSessions.get(page);
}

/**
 * Screenshot the viewer canvas region with every other element hidden, at CSS
 * pixel size. Raw CDP capture is used instead of page.screenshot(): software
 * renderers run the viewer at a few frames per second, and Playwright's extra
 * font/caret/animation-frame round trips more than double the capture time.
 */
async function captureCanvas(page, canvas, css = HIDE_CHROME_CSS) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('viewer canvas has no bounding box');
  const viewport = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.max(1, Math.min(Math.floor(box.width), (viewport?.width ?? box.width) - x));
  const height = Math.max(1, Math.min(Math.floor(box.height), (viewport?.height ?? box.height) - y));
  const dpr = await page.evaluate((text) => {
    let style = document.getElementById('smoke-capture-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'smoke-capture-style';
      document.head.appendChild(style);
    }
    style.textContent = text;
    return window.devicePixelRatio || 1;
  }, css);
  try {
    const client = await cdpFor(page);
    const { data } = await withTimeout(
      client.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 / dpr } }),
      timeout,
      'canvas capture',
    );
    const png = Buffer.from(data, 'base64');
    return { png, image: decodePng(png) };
  } finally {
    await page.evaluate(() => document.getElementById('smoke-capture-style')?.remove()).catch(() => {});
  }
}

async function waitSettled(page, canvas, minForeground, maxMs = 25_000) {
  const started = Date.now();
  let previous = await captureCanvas(page, canvas);
  let frames = 1;
  let lastDiff = null;
  while (Date.now() - started < maxMs) {
    await page.waitForTimeout(250);
    const current = await captureCanvas(page, canvas);
    frames += 1;
    const area = current.image.width * current.image.height;
    lastDiff = diffImages(previous.image, current.image).changed / area;
    const fg = foreground(current.image).fraction;
    previous = current;
    if (lastDiff < 0.001 && fg >= minForeground) {
      return { ...current, meta: { settled: true, ms: Date.now() - started, frames, lastDiff } };
    }
  }
  return { ...previous, meta: { settled: false, ms: Date.now() - started, frames, lastDiff } };
}

async function assessRender(page, canvas, image, minForeground) {
  const behind = await captureCanvas(page, canvas, HIDE_ALL_CSS);
  const contribution = diffImages(image, behind.image).changed / (image.width * image.height);
  const stats = imageStats(image);
  const fg = foreground(image);
  return {
    size: [image.width, image.height],
    canvasContribution: contribution,
    luminanceStd: stats.luminanceStd,
    distinctColors: stats.distinctColors,
    nonBlank: contribution > 0.002 && stats.luminanceStd > 1 && stats.distinctColors > 4,
    foregroundPixels: fg.count,
    foregroundFraction: fg.fraction,
    foregroundBox: fg.box,
    minForeground,
    hues: fg.hues,
  };
}

async function detectBackend(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-smoke-main]');
    const status = window.__lupiViewerMcp?.status?.() ?? {};
    const declared = status.rendererBackend ?? status.renderBackend ?? status.backend ?? status.renderer?.backend
      ?? canvas?.dataset?.rendererBackend ?? canvas?.dataset?.backend
      ?? canvas?.closest('[data-renderer-backend]')?.getAttribute('data-renderer-backend') ?? null;
    const result = {
      kind: 'unknown',
      source: 'none',
      declared: declared == null ? null : String(declared),
      webGPUSupported: status.webGPUSupported ?? null,
      engine: canvas?.getAttribute('data-engine') ?? null,
      probe: null,
      glRenderer: null,
      glVersion: null,
    };
    if (!canvas) return result;
    // getContext returns the canvas's EXISTING context for the matching type and
    // null for any other type, so this probe never creates or replaces one. It
    // only runs after the canvas has been proven to paint.
    try {
      if (canvas.getContext('webgpu')) result.probe = 'webgpu';
    } catch {
      // 'webgpu' is not a known context type without WebGPU.
    }
    if (!result.probe) {
      try {
        const gl = canvas.getContext('webgl2');
        if (gl) {
          result.probe = 'webgl2';
          const info = gl.getExtension('WEBGL_debug_renderer_info');
          result.glRenderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
          result.glVersion = String(gl.getParameter(gl.VERSION));
        }
      } catch {
        // Ignore.
      }
    }
    if (!result.probe) {
      try {
        if (canvas.getContext('webgl')) result.probe = 'webgl1';
      } catch {
        // Ignore.
      }
    }
    const declaredKind = result.declared?.toLowerCase() ?? '';
    if (declaredKind.includes('webgpu')) {
      result.kind = 'webgpu';
      result.source = 'app';
    } else if (declaredKind.includes('webgl')) {
      result.kind = declaredKind === 'webgl' || declaredKind === 'webgl1' ? 'webgl1' : 'webgl2';
      result.source = 'app';
    } else if (result.probe) {
      result.kind = result.probe;
      result.source = 'canvas-context-probe';
    }
    return result;
  }).catch((error) => ({ kind: 'unknown', source: `error: ${String(error?.message ?? error)}` }));
}

async function canvasPoint(page, canvas, fx, fy) {
  const box = await canvas.boundingBox();
  const preferred = { x: box.x + box.width * fx, y: box.y + box.height * fy };
  // Find a nearby point where the canvas itself wins hit-testing.
  const hit = await page.evaluate(({ px, py, bx, by, bw, bh }) => {
    const main = document.querySelector('[data-smoke-main]');
    const hits = (x, y) => document.elementFromPoint(x, y) === main;
    if (hits(px, py)) return { x: px, y: py };
    for (let r = 20; r < Math.max(bw, bh); r += 20) {
      for (let a = 0; a < 16; a += 1) {
        const x = px + r * Math.cos((a / 16) * Math.PI * 2);
        const y = py + r * Math.sin((a / 16) * Math.PI * 2);
        if (x > bx + 10 && x < bx + bw - 10 && y > by + 10 && y < by + bh - 10 && hits(x, y)) return { x, y };
      }
    }
    return { x: px, y: py };
  }, { px: preferred.x, py: preferred.y, bx: box.x, by: box.y, bw: box.width, bh: box.height });
  return { x: Math.round(hit.x), y: Math.round(hit.y) };
}

async function mouseDrag(page, start, { dx, dy }) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = 16;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(start.x + (dx * i) / steps, start.y + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

async function touchDrag(page, start, { dx, dy }) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
    const steps = 16;
    for (let i = 1; i <= steps; i += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start.x + (dx * i) / steps, y: start.y + (dy * i) / steps, id: 1 }],
      });
      await page.waitForTimeout(16);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach().catch(() => {});
  }
}

async function pickAtom({ page, spec, check, save, outcome }, canvas, image) {
  const box = await canvas.boundingBox();
  const candidates = atomCandidates(image, 8);
  const card = page.locator('[data-testid="atom-info-card"]');
  const tried = [];
  for (const candidate of candidates) {
    const point = { x: Math.round(box.x + candidate.x), y: Math.round(box.y + candidate.y) };
    const onCanvas = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute?.('data-smoke-main') ?? false, point);
    if (!onCanvas) {
      tried.push({ ...point, skipped: 'covered by DOM chrome' });
      continue;
    }
    if (spec.profile === 'phone') await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    const shown = await card.first().waitFor({ state: 'visible', timeout: 4_000 }).then(() => true, () => false);
    tried.push({ ...point, shown });
    if (shown) {
      const info = await card.first().evaluate((node) => ({
        atomIndex: node.getAttribute('data-atom-index'),
        layout: node.getAttribute('data-layout'),
        text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 120),
      }));
      outcome.data.pick = { input: spec.profile === 'phone' ? 'tap' : 'click', tried, card: info };
      await save('picked', await page.screenshot({ scale: 'css' }));
      check(`${spec.profile === 'phone' ? 'tapping' : 'clicking'} an atom opens the atom-info card`, true, `atom #${info.atomIndex} (${info.layout}) after ${tried.length} attempt(s): ${info.text.slice(0, 60)}`);
      return;
    }
  }
  outcome.data.pick = { input: spec.profile === 'phone' ? 'tap' : 'click', tried, candidates: candidates.length };
  await save('pick-failed', await page.screenshot({ scale: 'css' }));
  check(`${spec.profile === 'phone' ? 'tapping' : 'clicking'} an atom opens the atom-info card`, false, `no card after ${tried.length} attempt(s) on ${candidates.length} candidate(s)`);
}

// ---------------------------------------------------------------------------
// Page setup and diagnostics
// ---------------------------------------------------------------------------

function contextOptions(profile) {
  const common = { reducedMotion, serviceWorkers: 'block' };
  if (profile === 'phone') {
    const { defaultBrowserType: _ignored, ...pixel } = devices['Pixel 7'];
    return { ...pixel, ...common };
  }
  // The release-smoke desktop size: software renderers manage a few frames a
  // second here, so a larger viewport only slows every capture down.
  return { viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1, ...common };
}

const NEUTRAL_HDR = Buffer.concat([
  Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n', 'ascii'),
  Buffer.from([128, 128, 128, 129]),
]);

async function stubThirdParty(page) {
  // Same stubs as the Playwright suites: optional third-party enhancements must
  // never decide whether the viewer works. Lupi's own assets are never stubbed.
  // Route promises reject once a page closes mid-request; that is not a finding.
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }).catch(() => {}));
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort().catch(() => {}));
  await page.route('https://raw.githack.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: NEUTRAL_HDR }).catch(() => {}));
}

function attachDiagnostics(page, baseUrl, errors) {
  const appOrigin = new URL(baseUrl).origin;
  page.on('pageerror', (error) => {
    errors.pageErrors.push(String(error?.stack ?? error?.message ?? error).split('\n').slice(0, 4).join(' | '));
  });
  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = message.text();
    const location = message.location()?.url ?? '';
    if (type === 'warning') {
      const key = text.replace(/0x[0-9a-f]+/gi, '0x…').slice(0, 160);
      errors.consoleWarnings[key] = (errors.consoleWarnings[key] ?? 0) + 1;
      return;
    }
    const ignored = ignoredConsoleError(text, location, appOrigin);
    if (ignored) errors.ignoredConsoleErrors.push({ text, location, reason: ignored });
    else errors.consoleErrors.push({ text, location });
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'failed';
    // Navigating away (about:blank at teardown) aborts in-flight requests.
    if (failure === 'net::ERR_ABORTED') return;
    errors.failedRequests.push({ url: request.url().slice(0, 200), failure });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.httpErrors.push({ url: response.url().slice(0, 200), status: response.status() });
  });
}

function ignoredConsoleError(text, location, appOrigin) {
  // Third-party resource failures are environment noise (the stubs above abort
  // fonts); a failure on Lupi's own origin still fails the run.
  if (/^Failed to load resource/.test(text) && location && !location.startsWith(appOrigin)) return 'third-party resource';
  if (allowConsole?.test(text)) return `--allow-console ${allowConsole.source}`;
  return null;
}

function baseFor(page) {
  return new URL(report.url || page.url());
}

// ---------------------------------------------------------------------------
// Pixel analysis (pure Node; screenshots only, never readPixels)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'PLTE') palette = chunk;
    else if (type === 'tRNS') transparency = chunk;
    else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (bitDepth=${bitDepth}, interlace=${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colorType ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = value & 0xff;
    }
    previous = out;
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i += 1, j += channels) {
    let r;
    let g;
    let b;
    let alpha = 255;
    if (colorType === 0 || colorType === 4) {
      r = g = b = pixels[j];
      if (colorType === 4) alpha = pixels[j + 1];
    } else if (colorType === 3) {
      const index = pixels[j];
      r = palette[index * 3];
      g = palette[index * 3 + 1];
      b = palette[index * 3 + 2];
      if (transparency && index < transparency.length) alpha = transparency[index];
    } else {
      r = pixels[j];
      g = pixels[j + 1];
      b = pixels[j + 2];
      if (colorType === 6) alpha = pixels[j + 3];
    }
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = alpha;
  }
  return { width, height, data };
}

const DIFF_THRESHOLD = 40;

function diffImages(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { changed: a.width * a.height, sizeMismatch: true };
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    if (d > DIFF_THRESHOLD) changed += 1;
  }
  return { changed };
}

function imageStats(image) {
  let sum = 0;
  let sumSq = 0;
  const colors = new Set();
  const count = image.width * image.height;
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += lum;
    sumSq += lum * lum;
    if (colors.size < 4096) colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
  }
  const mean = sum / count;
  return { luminanceMean: mean, luminanceStd: Math.sqrt(Math.max(0, sumSq / count - mean * mean)), distinctColors: colors.size };
}

/**
 * Background model: a Coons patch through the median colours of a thin band
 * along each edge (smoothed over neighbouring rows/columns). It reproduces
 * flat plates and linear/bilinear gradients exactly, so pixels far from it
 * are the rendered structure.
 */
function backgroundModel(image, band = 6, window = 8) {
  const { width: w, height: h, data } = image;
  const median = (values) => {
    values.sort((x, y) => x - y);
    return values[values.length >> 1] ?? 0;
  };
  const edge = (length, sample) => {
    const out = new Float32Array(length * 3);
    for (let k = 0; k < length; k += 1) {
      const channels = [[], [], []];
      for (let m = Math.max(0, k - window); m <= Math.min(length - 1, k + window); m += 1) {
        for (let t = 0; t < band; t += 1) {
          const index = sample(m, t) * 4;
          channels[0].push(data[index]);
          channels[1].push(data[index + 1]);
          channels[2].push(data[index + 2]);
        }
      }
      for (let c = 0; c < 3; c += 1) out[k * 3 + c] = median(channels[c]);
    }
    return out;
  };
  const left = edge(h, (y, t) => y * w + t);
  const right = edge(h, (y, t) => y * w + (w - 1 - t));
  const top = edge(w, (x, t) => t * w + x);
  const bottom = edge(w, (x, t) => (h - 1 - t) * w + x);
  const corner = (c) => [
    (left[c] + top[c]) / 2,
    (right[c] + top[(w - 1) * 3 + c]) / 2,
    (left[(h - 1) * 3 + c] + bottom[c]) / 2,
    (right[(h - 1) * 3 + c] + bottom[(w - 1) * 3 + c]) / 2,
  ];
  const corners = [corner(0), corner(1), corner(2)];
  return (x, y, c) => {
    const u = w > 1 ? x / (w - 1) : 0;
    const v = h > 1 ? y / (h - 1) : 0;
    const [c00, c10, c01, c11] = corners[c];
    return (1 - u) * left[y * 3 + c] + u * right[y * 3 + c]
      + (1 - v) * top[x * 3 + c] + v * bottom[x * 3 + c]
      - ((1 - u) * (1 - v) * c00 + u * (1 - v) * c10 + (1 - u) * v * c01 + u * v * c11);
  };
}

function foregroundMask(image) {
  const { width: w, height: h, data } = image;
  const bg = backgroundModel(image);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const d = Math.max(
        Math.abs(data[i] - bg(x, y, 0)),
        Math.abs(data[i + 1] - bg(x, y, 1)),
        Math.abs(data[i + 2] - bg(x, y, 2)),
      );
      if (d > DIFF_THRESHOLD) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function foreground(image) {
  const { width: w, height: h, data } = image;
  const mask = foregroundMask(image);
  let count = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const hues = { red: 0, blue: 0, neutral: 0, other: 0 };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r >= 110 && r > 1.8 * g && r > 1.8 * b) hues.red += 1;
      else if (b >= 90 && b > 1.4 * r && b > 1.15 * g) hues.blue += 1;
      else if (Math.max(r, g, b) - Math.min(r, g, b) < 28) hues.neutral += 1;
      else hues.other += 1;
    }
  }
  return {
    mask,
    count,
    fraction: count / (w * h),
    box: count ? [minX, minY, maxX, maxY] : null,
    hues,
  };
}

/** Densest foreground spots (atom bodies), best first, spread apart. */
function atomCandidates(image, limit) {
  const { width: w, height: h } = image;
  const { mask } = foreground(image);
  const integral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y += 1) {
    let row = 0;
    for (let x = 1; x <= w; x += 1) {
      row += mask[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }
  const sum = (x0, y0, x1, y1) => integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
  const radius = 7;
  const scored = [];
  for (let y = radius + 12; y < h - radius - 12; y += 3) {
    for (let x = radius + 12; x < w - radius - 12; x += 3) {
      if (!mask[y * w + x]) continue;
      const score = sum(x - radius, y - radius, x + radius + 1, y + radius + 1);
      scored.push({ x, y, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || Math.hypot(a.x - w / 2, a.y - h / 2) - Math.hypot(b.x - w / 2, b.y - h / 2));
  const picked = [];
  for (const candidate of scored) {
    if (picked.every((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) > 30)) picked.push(candidate);
    if (picked.length >= limit) break;
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function startServerWithRetries() {
  if (!existsSync(DIST_INDEX)) {
    const error = new Error(`No build at ${DIST_INDEX}. Run: pnpm --filter @atlas/web build (this tool builds nothing).`);
    error.usage = true;
    throw error;
  }
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return serverMode === 'preview' ? await startVitePreview() : await startServeWeb();
    } catch (error) {
      lastError = error;
      warn(`server start attempt ${attempt} failed: ${errorMessage(error)}`);
      await stopServer();
    }
  }
  throw new Error(`could not start the ${serverMode} server: ${errorMessage(lastError)}`);
}

async function startServeWeb() {
  const port = await getFreePort();
  const child = spawn(process.execPath, [join(REPO_ROOT, 'tools', 'serve-web.mjs')], {
    cwd: REPO_ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  serverChild = child;
  server = { kind: 'serve-web', close: () => stopChild(child) };
  // http://localhost is a secure context, which WebGPU requires.
  const url = `http://localhost:${port}/`;
  await waitForHttp(url, 30_000, () => (exited ? `serve-web exited (${JSON.stringify(exited)}): ${output.trim().slice(-400)}` : null));
  return url;
}

async function startVitePreview() {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const webRoot = resolve(REPO_ROOT, 'apps/web');
  const requireFromWeb = createRequire(resolve(webRoot, 'package.json'));
  const { preview } = await import(pathToFileURL(requireFromWeb.resolve('vite')).href);
  const port = await getFreePort();
  const instance = await preview({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    preview: { host: '127.0.0.1', port, strictPort: true, open: false },
    logLevel: 'warn',
  });
  server = { kind: 'preview', close: () => instance.close() };
  const url = `http://localhost:${port}/`;
  await waitForHttp(url, 30_000, () => null);
  return url;
}

async function waitForHttp(url, maxMs, earlyExit) {
  const deadline = Date.now() + maxMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const exitReason = earlyExit();
    if (exitReason) throw new Error(exitReason);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        const body = await response.text();
        if (/<html/i.test(body)) return;
        lastError = new Error(`unexpected body from ${url}`);
      } else {
        lastError = new Error(`HTTP ${response.status} from ${url}`);
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`server not ready at ${url} within ${maxMs}ms: ${errorMessage(lastError)}`);
}

async function stopServer() {
  if (!server) return;
  const current = server;
  server = null;
  await Promise.resolve(current.close()).catch(() => {});
}

function stopChild(child) {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    child.kill('SIGTERM');
  });
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

// ---------------------------------------------------------------------------
// Report and utilities
// ---------------------------------------------------------------------------

function summarize() {
  let scenarios = 0;
  let passed = 0;
  let flaky = 0;
  let checks = 0;
  let failedChecks = 0;
  for (const lane of report.lanes) {
    for (const profile of lane.profiles) {
      for (const scenario of profile.scenarios) {
        scenarios += 1;
        if (scenario.ok) passed += 1;
        if (scenario.flaky) flaky += 1;
        const last = scenario.attempts.at(-1);
        checks += last?.checks.length ?? 0;
        failedChecks += last?.checks.filter((entry) => !entry.ok).length ?? 0;
      }
    }
  }
  report.summary = {
    scenarios,
    passed,
    failed: scenarios - passed,
    flaky,
    checks,
    failedChecks,
    actualBackends: Object.fromEntries(report.lanes.map((lane) => [lane.backend, lane.actualBackend?.kind ?? 'unknown'])),
  };
  report.ok = report.failures.length === 0 && scenarios > 0;
}

function printSummary() {
  log('\n[viewer-smoke] summary');
  for (const lane of report.lanes) {
    const actual = lane.actualBackend ? `${lane.actualBackend.kind} (${lane.actualBackend.source})` : 'unknown';
    log(`  lane ${lane.backend}: app rendered through ${actual}; adapter=${lane.preflight?.adapter ? describeAdapter(lane.preflight.adapter) : 'none'}`);
    for (const profile of lane.profiles) {
      const line = profile.scenarios.map((scenario) => `${scenario.name}:${scenario.ok ? (scenario.flaky ? 'flaky' : 'ok') : 'FAIL'}`).join(' ');
      log(`    ${profile.profile.padEnd(7)} ${line}`);
    }
  }
  for (const warning of report.warnings) log(`  warning: ${warning}`);
  for (const failure of report.failures) log(`  FAIL ${failure}`);
  if (report.summary) log(`  ${report.summary.passed}/${report.summary.scenarios} scenarios passed, ${report.summary.checks - report.summary.failedChecks}/${report.summary.checks} checks`);
}

function galleryEntry(id) {
  const entry = gallery.get(id);
  const parsed = entry ? Number.parseInt(String(entry.atoms).replace(/,/g, ''), 10) : Number.NaN;
  return { id, title: entry?.title ?? id, atoms: Number.isFinite(parsed) && parsed > 0 && parsed < 50_000_000 ? parsed : null };
}

function loadGallery() {
  try {
    const rows = JSON.parse(readFileSync(GALLERY_DATA, 'utf8'));
    return new Map(rows.map((row) => [row.id, row]));
  } catch {
    return new Map();
  }
}

function pickIdentities(result) {
  if (!result || typeof result !== 'object') return null;
  const found = {};
  const visit = (value, path, depth) => {
    if (!value || typeof value !== 'object' || depth > 4) return;
    for (const [key, child] of Object.entries(value)) {
      if (['specId', 'rendererFingerprint', 'artifactKey', 'artifactDigest', 'executionClass', 'profile'].includes(key) && typeof child === 'string') found[`${path}${key}`] = child;
      else if (key !== 'dataBase64' && key !== 'dataUrl') visit(child, `${path}${key}.`, depth + 1);
    }
  };
  visit(result, '', 0);
  return found;
}

function resolveExecutable() {
  if (typeof args.executable === 'string') return args.executable;
  if (existsSync(DEFAULT_CHROMIUM)) return DEFAULT_CHROMIUM;
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  return fromEnv || null;
}

function describeAdapter(adapter) {
  return [adapter.vendor, adapter.architecture, adapter.description].filter(Boolean).join(' / ') || 'present';
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function gitDirty() {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim().length > 0;
  } catch {
    return null;
  }
}

function normalizeBase(value) {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/[^/]*$/, '');
  return url.href;
}

function listArg(value, allowed, allToken) {
  if (value === undefined || value === true || value === allToken) return allowed;
  const list = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  for (const item of list) if (!allowed.includes(item)) usageError(`Unknown value "${item}"; use ${allowed.join(', ')} or ${allToken}`);
  return list;
}

function safeRegExp(source) {
  try {
    return new RegExp(source);
  } catch (error) {
    return usageError(`--allow-console is not a valid regular expression: ${errorMessage(error)}`);
  }
}

function usageError(message) {
  console.error(`[viewer-smoke] ${message}`);
  process.exit(2);
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) parsed[arg.slice(2)] = true;
    else parsed[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return parsed;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function errorMessage(error) {
  return String(error?.message ?? error);
}

function warn(message) {
  report.warnings.push(message);
  log(`  !!  ${message}`);
}

function log(...values) {
  if (!jsonMode) console.log(...values);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Run last, so every module-level constant above is initialised.
await main();
