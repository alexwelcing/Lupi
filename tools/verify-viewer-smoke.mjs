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
 *            atoms; a drag (mouse on desktop, touch on the phones) that holds
 *            still before release rotates the view; clicking (tapping) an atom
 *            opens the atom-info card.
 *   c60      `/?sim=c60_buckyball` renders a non-blank canvas with atoms.
 *   lattice  a larger crystal-lattice gallery entry (default al_polycrystal,
 *            32,000 atoms) renders.
 *   export   the MCP bridge (window.__lupiViewerMcp) returns a valid PNG of
 *            the requested size from lupi.export_asset with bonds hidden.
 *   testbed  each `/?testbed&case=<id>` harness case (--cases) reports ready,
 *            its assertions pass, its backend matches the lane, and every
 *            probe pixel (median of a 3x3 patch) matches its expectation. In
 *            the webgpu lane the plate case also runs with &renderer=webgl2.
 *   churn    (desktop) the viewer canvas unmounts and remounts five times in
 *            one document (history navigation away from ?sim=caffeine and
 *            Back): at most one <canvas> per visit, no device-lost or
 *            context-lost console message.
 *   fallback a separate browser with neither WebGPU nor WebGL shows the
 *            renderer fallback screen without an uncaught error (console
 *            errors from the canvas error boundary are allowed here only).
 *
 * Scenario plugins: every tools/smoke/scenarios/*.mjs whose name does not
 * start with `_` is imported at startup and runs like a built-in scenario
 * (listed by --help, selected by --scenarios, reported in report.json). See
 * tools/smoke/scenarios/_example.mjs for the shape; plugins get the shared
 * helpers of tools/smoke/helpers.mjs as their second argument.
 *
 * Profiles: desktop (1024x640, DPR 1, mouse), phone (Pixel 7, touch) and
 * phone390 (390x844, DPR 3, iPhone 13 user agent, touch; the phone scenario
 * list). --profile=both is desktop + phone, --profile=all adds phone390.
 *
 * --level=boot reduces the viewer scenarios to: structure loads, canvas
 * mounted and sized, no fallback screen, backend recorded. --level=full
 * (default) adds the pixel, input and export checks.
 *
 * Every page's uncaught errors fail the run, as do console errors that are not
 * third-party resource noise. Rendering is judged from page screenshots of the
 * viewer canvas with all DOM chrome hidden (never readPixels), so the same
 * checks hold for WebGLRenderer, WebGPURenderer and its WebGL2 fallback.
 *
 * Lanes (Chromium flags from tools/lib/browser-lanes.mjs):
 *   webgl   no WebGPU adapter, so WebGPURenderer runs its WebGL2 backend.
 *   webgpu  a SwiftShader WebGPU adapter (with the Vulkan flags that keep the
 *           device alive). Needs a secure context, so the self-started server
 *           is addressed as http://localhost.
 *   nogpu   neither WebGPU nor WebGL; runs only the fallback scenario.
 *
 * The tool builds nothing. Build first: pnpm --filter @atlas/web build
 *
 * Artifacts (screenshots, the exported PNG, report.json) are written to
 * .verify-artifacts/viewer-smoke/<run>/ (gitignored). Exit code 0 = pass,
 * 1 = at least one check failed, 2 = setup/usage error.
 */

import { chromium, devices } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LANE_ARGS, chromiumExecutable } from './lib/browser-lanes.mjs';
import * as smokeHelpers from './smoke/helpers.mjs';
import {
  PNG_SIGNATURE,
  assessRender,
  baseFor,
  canvasPoint,
  captureCanvas,
  configureHelpers,
  decodePng,
  detectBackend,
  diffImages,
  errorMessage,
  galleryEntry,
  isTouchProfile,
  mainCanvas,
  mouseDrag,
  openStructure,
  pct,
  pickAtom,
  rendererAlert,
  sleep,
  touchDrag,
  waitSettled,
  withTimeout,
} from './smoke/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DIST_INDEX = resolve(REPO_ROOT, 'apps/web/dist/index.html');
const SCENARIO_DIR = resolve(__dirname, 'smoke', 'scenarios');

const PROFILES = ['desktop', 'phone', 'phone390'];
const PLUGIN_LANES = ['webgl', 'webgpu'];
const BUILTIN_SCENARIOS = ['home', 'caffeine', 'c60', 'lattice', 'export', 'testbed', 'churn', 'fallback'];
const BUILTIN_PROFILE_SCENARIOS = {
  desktop: ['home', 'caffeine', 'c60', 'lattice', 'export', 'testbed', 'churn', 'fallback'],
  // Export and churn are device-independent; the phone lane covers layout,
  // touch input, DPR > 1 and the mobile tier instead.
  phone: ['home', 'caffeine', 'c60', 'lattice', 'testbed', 'fallback'],
  phone390: ['home', 'caffeine', 'c60', 'lattice', 'testbed', 'fallback'],
};
/** Scenario plugins from tools/smoke/scenarios/*.mjs, by name. */
const PLUGINS = new Map((await loadPlugins()).map((plugin) => [plugin.name, plugin]));
const ALL_SCENARIOS = [...BUILTIN_SCENARIOS, ...PLUGINS.keys()];
const PROFILE_SCENARIOS = Object.fromEntries(PROFILES.map((profile) => [
  profile,
  [...BUILTIN_PROFILE_SCENARIOS[profile], ...[...PLUGINS.values()].filter((plugin) => plugin.profiles.includes(profile)).map((plugin) => plugin.name)],
]));
/** Scenarios that run in a backend lane; `fallback` has its own no-GPU lane. */
const LANE_SCENARIOS = ALL_SCENARIOS.filter((name) => name !== 'fallback');
const LEVELS = ['boot', 'full'];
const CHURN_ROUNDS = 5;
/** The testbed plate (#101817) and the §5.15 probe judgements. */
const PLATE_RGB = [16, 24, 23];

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(`verify-viewer-smoke.mjs - dual-backend viewer smoke (builds nothing)

Usage:
  node tools/verify-viewer-smoke.mjs                      # both backends, both profiles
  node tools/verify-viewer-smoke.mjs --backend=webgl      # WebGL2 lane only
  node tools/verify-viewer-smoke.mjs --url=http://localhost:5173/ --backend=webgpu
  node tools/verify-viewer-smoke.mjs --scenarios=testbed --cases=plate --strict-backend

Options:
  --url=<url>            Test an already-running app instead of serving apps/web/dist.
  --backend=<b>          webgl (alias webgl2) | webgpu | both (default: both).
  --profile=<p>          desktop | phone | phone390 | both | all, or a comma list (default: both).
                         both = desktop,phone; all = desktop,phone,phone390. phone390 is
                         390x844 at DPR 3 with an iPhone 13 user agent and touch.
  --scenarios=<list>     Comma list from: ${ALL_SCENARIOS.join(', ')} (default: all,
                         plugins included).
  --level=<l>            boot | full (default: full). boot: the viewer scenarios check only
                         that the structure loads, the canvas mounts and the backend is recorded.
  --cases=<list>         Testbed cases for the testbed scenario, comma separated, or all
                         (default: all). <id>@webgl2 adds &renderer=webgl2 and expects WebGL2.
  --lattice=<galleryId>  Larger structure for the lattice scenario (default: al_polycrystal).
  --server=<mode>        serve-web (default, tools/serve-web.mjs) | preview (vite preview).
  --executable=<path>    Chromium binary (default: Chromium 1194 when present, else
                         $PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, else Playwright's own).
  --chrome-args=<a,b>    Extra Chromium flags, comma separated, added to the backend lanes.
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

Scenario plugins (tools/smoke/scenarios/*.mjs; names starting with _ are skipped):
${describePlugins()}

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

const backends = listArg(typeof args.backend === 'string' ? args.backend.replace(/\bwebgl2\b/g, 'webgl') : args.backend, ['webgl', 'webgpu'], 'both');
const profiles = profileArg(args.profile);
const scenarioFilter = typeof args.scenarios === 'string'
  ? args.scenarios.split(',').map((value) => value.trim()).filter(Boolean)
  : ALL_SCENARIOS;
for (const name of scenarioFilter) {
  if (!ALL_SCENARIOS.includes(name)) usageError(`Unknown scenario "${name}". Use: ${ALL_SCENARIOS.join(', ')}`);
}
const level = typeof args.level === 'string' ? args.level : 'full';
if (!LEVELS.includes(level)) usageError(`Unknown level "${level}". Use: ${LEVELS.join(', ')}`);
/** Handed to every scenario (built-in and plugin) as ctx.options. */
const scenarioOptions = Object.freeze({ level, reducedMotion: reducedMotion === 'reduce', strictBackend, timeout });
const casesArg = typeof args.cases === 'string' && args.cases !== 'all'
  ? args.cases.split(',').map((value) => value.trim()).filter(Boolean)
  : 'all';

const runId = stamp();
const ARTIFACTS = typeof args.out === 'string'
  ? resolve(process.cwd(), args.out)
  : resolve(REPO_ROOT, '.verify-artifacts', 'viewer-smoke', runId);
mkdirSync(ARTIFACTS, { recursive: true });

const executablePath = chromiumExecutable(typeof args.executable === 'string' ? args.executable : null);
configureHelpers({ timeout });

const report = {
  tool: 'verify-viewer-smoke',
  version: 2,
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
    level,
    cases: casesArg,
    lattice: latticeId,
    strictBackend,
    reducedMotion,
    retries,
    timeout,
    headless,
    extraChromeArgs,
    allowConsole: allowConsole?.source ?? null,
    plugins: [...PLUGINS.values()].map(({ name, file, profiles: only, lanes }) => ({ name, file, profiles: only, lanes })),
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
    configureHelpers({ baseUrl });
    log(`[viewer-smoke] app: ${baseUrl}`);
    log(`[viewer-smoke] artifacts: ${ARTIFACTS}`);

    const lanes = scenarioFilter.some((name) => LANE_SCENARIOS.includes(name)) ? [...backends] : [];
    if (scenarioFilter.includes('fallback')) lanes.push('nogpu');
    for (const backend of lanes) {
      try {
        report.lanes.push(backend === 'nogpu' ? await runFallbackLane(baseUrl) : await runLane(backend, baseUrl));
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
// Scenario plugins
// ---------------------------------------------------------------------------

/**
 * Import every tools/smoke/scenarios/*.mjs whose name does not start with `_`.
 * Each default-exports { name, profiles, lanes?, description?, run(ctx, h) }
 * (see _example.mjs). A missing directory means no plugins; a plugin that
 * fails to load or has the wrong shape is a usage error.
 */
async function loadPlugins() {
  if (!existsSync(SCENARIO_DIR)) return [];
  const files = readdirSync(SCENARIO_DIR).filter((file) => file.endsWith('.mjs') && !file.startsWith('_')).sort();
  const plugins = [];
  for (const file of files) {
    const path = join(SCENARIO_DIR, file);
    const label = relative(REPO_ROOT, path);
    let plugin;
    try {
      plugin = (await import(pathToFileURL(path).href)).default;
    } catch (error) {
      usageError(`scenario plugin ${label} failed to load: ${errorMessage(error)}`);
    }
    const problem = pluginProblem(plugin, plugins);
    if (problem) usageError(`scenario plugin ${label}: ${problem}`);
    const lanes = plugin.lanes == null ? null : [...new Set(plugin.lanes.map((lane) => (lane === 'webgl2' ? 'webgl' : lane)))];
    plugins.push({
      name: plugin.name,
      profiles: [...new Set(plugin.profiles)],
      lanes,
      description: typeof plugin.description === 'string' ? plugin.description : '',
      run: plugin.run,
      file: label,
    });
  }
  return plugins;
}

async function runPlugin(ctx) {
  await PLUGINS.get(ctx.spec.name).run(ctx, smokeHelpers);
  // Plugin-only runs still prove the lane's backend (--strict-backend judges it
  // per lane): record what the viewer canvas the plugin opened rendered through.
  if (!ctx.spec.lane.actualBackend) {
    const backend = await detectBackend(ctx.page);
    if (backend.kind !== 'unknown') ctx.spec.lane.actualBackend = { ...backend, source: `${backend.source} (plugin ${ctx.spec.name})` };
  }
}

function pluginProblem(plugin, loaded) {
  if (!plugin || typeof plugin !== 'object') return 'no default export object';
  if (typeof plugin.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(plugin.name)) return `name must match /^[a-z0-9][a-z0-9_-]*$/i (got ${JSON.stringify(plugin.name)})`;
  if (BUILTIN_SCENARIOS.includes(plugin.name)) return `name "${plugin.name}" is a built-in scenario`;
  const twin = loaded.find((other) => other.name === plugin.name);
  if (twin) return `name "${plugin.name}" is already used by ${twin.file}`;
  if (!Array.isArray(plugin.profiles) || plugin.profiles.length === 0 || !plugin.profiles.every((profile) => PROFILES.includes(profile))) {
    return `profiles must be a non-empty array of ${PROFILES.join(', ')} (got ${JSON.stringify(plugin.profiles)})`;
  }
  if (plugin.lanes != null && (!Array.isArray(plugin.lanes) || plugin.lanes.length === 0 || !plugin.lanes.every((lane) => [...PLUGIN_LANES, 'webgl2'].includes(lane)))) {
    return `lanes, when given, must be a non-empty array of ${PLUGIN_LANES.join(', ')} (got ${JSON.stringify(plugin.lanes)})`;
  }
  if (typeof plugin.run !== 'function') return 'run(ctx, h) must be a function';
  return null;
}

function describePlugins() {
  if (PLUGINS.size === 0) return '  (none)';
  const width = Math.max(...[...PLUGINS.keys()].map((name) => name.length));
  return [...PLUGINS.values()].map((plugin) => {
    const where = `${plugin.profiles.join(',')}; lanes ${(plugin.lanes ?? PLUGIN_LANES).join(',')}`;
    return `  ${plugin.name.padEnd(width)}  ${where}  (${plugin.file})${plugin.description ? `\n  ${' '.repeat(width)}  ${plugin.description}` : ''}`;
  }).join('\n');
}

/** --profile: both (default) = desktop,phone; all = every profile; or a comma list. */
function profileArg(value) {
  if (value === undefined || value === true || value === 'both') return ['desktop', 'phone'];
  if (value === 'all') return [...PROFILES];
  const list = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  for (const item of list) if (!PROFILES.includes(item)) usageError(`Unknown profile "${item}"; use ${PROFILES.join(', ')}, both or all`);
  return [...new Set(list)];
}

// ---------------------------------------------------------------------------
// Lanes and scenarios
// ---------------------------------------------------------------------------

async function runLane(backend, baseUrl) {
  const lane = {
    backend,
    chromiumArgs: laneArgs(backend),
    preflight: null,
    actualBackend: null,
    backendMatch: null,
    profiles: [],
  };
  log(`\n[viewer-smoke] === lane ${backend} ===`);
  const browser = await launch(lane.chromiumArgs);
  try {
    report.environment.browserVersion ??= browser.version();
    lane.preflight = await preflight(browser, baseUrl);
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
        if (!scenarioFilter.includes(name) || !LANE_SCENARIOS.includes(name)) continue;
        if (PLUGINS.get(name)?.lanes?.includes(backend) === false) continue;
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

function laneArgs(backend) {
  return [...(backend === 'webgpu' ? LANE_ARGS.webgpu : LANE_ARGS.webgl2), ...extraChromeArgs];
}

/** The fallback scenario in a browser with neither WebGPU nor WebGL. */
async function runFallbackLane(baseUrl) {
  const lane = { backend: 'nogpu', chromiumArgs: [...LANE_ARGS.noGpu], preflight: null, actualBackend: null, backendMatch: null, profiles: [] };
  log('\n[viewer-smoke] === lane nogpu ===');
  const browser = await launch(lane.chromiumArgs);
  try {
    report.environment.browserVersion ??= browser.version();
    lane.preflight = await preflight(browser, baseUrl);
    lane.preflight.ok = !lane.preflight.adapter;
    log(`  ${lane.preflight.ok ? 'OK ' : 'NO '} preflight: navigator.gpu=${lane.preflight.hasNavigatorGpu} adapter=${lane.preflight.adapter ? describeAdapter(lane.preflight.adapter) : 'none'}`);
    if (!lane.preflight.ok) report.failures.push('nogpu: a WebGPU adapter is available in the no-GPU lane');
    for (const profile of profiles) {
      if (!PROFILE_SCENARIOS[profile].includes('fallback')) continue;
      lane.profiles.push({ profile, scenarios: [await runScenario(browser, { backend: 'nogpu', profile, name: 'fallback', baseUrl, lane })] });
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return lane;
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
  // Screenshots and waits without their own timeout take --timeout, not
  // Playwright's 30 s: a page screenshot waits for a composited frame, which
  // a loaded software renderer can take longer than that to give.
  context.setDefaultTimeout(timeout);
  const page = await context.newPage();
  // Actions (boundingBox, tap) wait as long as any other wait: a software
  // renderer compiling a new shader can hold the main thread past 30 s.
  page.setDefaultTimeout(timeout);
  attachDiagnostics(page, spec.baseUrl, outcome.errors, spec.name);
  await stubThirdParty(page);

  try {
    const ctx = { page, spec, check, save, outcome, options: scenarioOptions, log };
    if (spec.name === 'home') await scenarioHome(ctx);
    else if (spec.name === 'caffeine') await scenarioCaffeine(ctx);
    else if (spec.name === 'c60') await scenarioStructure(ctx, { id: 'c60_buckyball', minForeground: 0.01 });
    else if (spec.name === 'lattice') await scenarioStructure(ctx, { id: latticeId, minForeground: 0.03, loadTimeout: Math.max(timeout, 120_000) });
    else if (spec.name === 'export') await scenarioExport(ctx);
    else if (spec.name === 'testbed') await scenarioTestbed(ctx);
    else if (spec.name === 'churn') await scenarioChurn(ctx);
    else if (spec.name === 'fallback') await scenarioFallback(ctx);
    else if (PLUGINS.has(spec.name)) await runPlugin(ctx);
    else throw new Error(`no runner for scenario "${spec.name}"`);
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
  // The landing must not fetch the three/R3F stack (the zero-canvas home rule).
  const viewerChunks = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/vendor-(three|react-three)[^/]*\.js$/.test(path)) viewerChunks.push(path.split('/').pop());
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
  outcome.data.home.viewerChunks = viewerChunks;
  check('home requests no vendor-three* or vendor-react-three* chunk', viewerChunks.length === 0, viewerChunks.length ? viewerChunks.join(', ') : 'none');
  await save('home', await page.screenshot({ scale: 'css' }));
}

async function scenarioCaffeine(ctx) {
  const { page, spec, check, save, outcome } = ctx;
  const entry = galleryEntry('caffeine');
  const canvas = await openStructure(ctx, entry);
  if (!canvas) return;
  if (level === 'boot') return recordBackend(ctx);

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
  // Hold still before release so the drag cannot turn into a coast.
  if (isTouchProfile(spec.profile)) await touchDrag(page, start, { dx: 140, dy: 30 }, { holdMs: 150 });
  else await mouseDrag(page, start, { dx: 220, dy: 40 }, { holdMs: 150 });
  await page.waitForTimeout(600);
  const rotated = await waitSettled(page, canvas, 0.01, 8_000);
  await save('rotated', rotated.png);
  const rotateDiff = diffImages(settled.image, rotated.image);
  const area = settled.image.width * settled.image.height;
  const needed = Math.max(0.005 * area, 0.2 * render.foregroundPixels, 3 * idleDiff.changed + 200);
  outcome.data.rotate = { input: isTouchProfile(spec.profile) ? 'touch' : 'mouse', start, idleChanged: idleDiff.changed, rotateChanged: rotateDiff.changed, needed: Math.round(needed) };
  check(
    `${isTouchProfile(spec.profile) ? 'touch' : 'mouse'} drag rotates the view`,
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
  if (level === 'boot') return recordBackend(ctx);
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
  if (level === 'boot') return recordBackend(ctx);
  await waitSettled(page, canvas, 0.01, 15_000);
  const width = 320;
  const height = 240;
  // The tool's 30 s default is sized for a GPU; on SwiftShader under a shared
  // machine's load a small export took from 10 s to over 90 s.
  const exportTimeoutMs = 300_000;
  const response = await withTimeout(page.evaluate(async ({ width: w, height: h, timeoutMs }) => {
    const bridge = window.__lupiViewerMcp;
    const hidden = await bridge.execute({ id: 'smoke-hide-bonds', tool: 'lupi.set_viewer', arguments: { showBonds: false } });
    if (!hidden.ok) return { stage: 'set_viewer', ...hidden };
    // Give the scene a frame to drop the bond layer before the snapshot.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const exported = await bridge.execute({
      id: 'smoke-export-png',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: w, height: h, transparent: true, timeoutMs },
    });
    return { stage: 'export_asset', ...exported };
  }, { width, height, timeoutMs: exportTimeoutMs }), exportTimeoutMs + 60_000, 'lupi.export_asset');

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

/** Boot level: the backend the app reports for the mounted viewer canvas. */
async function recordBackend({ page, spec, check, outcome }) {
  // WebGPURenderer initializes asynchronously; the runtime record follows it.
  await page.waitForFunction(() => Boolean(window.__lupiRenderer?.backend), null, { timeout: 15_000, polling: 250 }).catch(() => {});
  const backend = await detectBackend(page);
  outcome.data.backend = backend;
  spec.lane.actualBackend ??= backend;
  log(`  --  backend: ${backend.kind} via ${backend.source}`);
  if (strictBackend) {
    const expected = spec.backend === 'webgpu' ? 'webgpu' : 'webgl2';
    check(`app renders through ${expected}`, backend.kind === expected, `${backend.kind} via ${backend.source}`);
  }
}

async function scenarioTestbed(ctx) {
  const cases = await testbedCases(ctx);
  if (!cases) return;
  ctx.outcome.data.testbed = [];
  for (const item of cases) ctx.outcome.data.testbed.push(await runTestbedCase(ctx, item));
}

/** The requested cases; `all` reads the router's list from `/?testbed`. */
async function testbedCases({ page, spec, check }) {
  let ids = casesArg;
  if (ids === 'all') {
    await page.goto(new URL('?testbed', baseFor(page)).href, { waitUntil: 'commit', timeout });
    const listed = await page.waitForFunction(
      () => (window.__lupiHarness?.ready === true ? window.__lupiHarness.cases : null),
      null,
      { timeout, polling: 100 },
    ).then((handle) => handle.jsonValue(), () => null);
    if (!check('testbed lists its cases', Array.isArray(listed) && listed.length > 0, Array.isArray(listed) ? listed.join(', ') : 'no window.__lupiHarness.cases')) return null;
    ids = listed;
  }
  const items = ids.map((id) => {
    const [caseId, variant = null] = id.split('@');
    return { id, caseId, variant, forced: variant === 'webgl2' };
  });
  // The reference case also proves ?renderer=webgl2 in the WebGPU lane.
  if (spec.backend === 'webgpu' && items.some((item) => item.caseId === 'plate' && !item.variant) && !items.some((item) => item.id === 'plate@webgl2')) {
    items.push({ id: 'plate@webgl2', caseId: 'plate', variant: 'webgl2', forced: true });
  }
  return items;
}

async function runTestbedCase({ page, spec, check, save, outcome }, item) {
  const label = item.id;
  const result = { id: label, url: '', ready: false };
  if (item.variant && !item.forced) {
    check(`${label}: known case variant`, false, `use <id> or <id>@webgl2, not @${item.variant}`);
    return result;
  }
  result.url = new URL(`?testbed&case=${encodeURIComponent(item.caseId)}${item.forced ? '&renderer=webgl2' : ''}`, baseFor(page)).href;
  outcome.url ||= result.url;
  await page.goto(result.url, { waitUntil: 'commit', timeout });
  const harness = await page.waitForFunction(
    (id) => {
      const state = window.__lupiHarness;
      return state && state.case === id && state.ready === true ? state : null;
    },
    item.caseId,
    { timeout, polling: 100 },
  ).then((handle) => handle.jsonValue(), () => null);
  if (!harness) {
    const current = await page.evaluate(() => window.__lupiHarness ?? null).catch(() => null);
    const alert = await rendererAlert(page);
    check(`${label}: harness reports ready`, false, `${alert ? `renderer fallback: ${alert}; ` : ''}state=${JSON.stringify(current)?.slice(0, 300)}`);
    return result;
  }
  result.ready = true;
  result.backend = harness.backend;
  result.assertions = harness.assertions;
  check(`${label}: harness reports ready`, true);

  const expected = item.forced || spec.backend !== 'webgpu' ? 'webgl2' : 'webgpu';
  if (!item.forced) spec.lane.actualBackend ??= { kind: harness.backend ?? 'unknown', source: 'testbed harness' };
  if (strictBackend || item.forced) check(`${label}: backend is ${expected}`, harness.backend === expected, `harness.backend=${harness.backend}`);
  else if (harness.backend !== expected) warn(`${spec.backend}/${spec.profile}/testbed ${label}: backend ${harness.backend}, expected ${expected} (report only; pass --strict-backend to enforce)`);
  for (const assertion of harness.assertions) check(`${label}: ${assertion.name}`, assertion.pass, assertion.detail ?? '');

  const canvas = page.locator('#lupi-testbed-canvas canvas').first();
  if (!(await canvas.isVisible().catch(() => false))) {
    check(`${label}: testbed canvas is visible`, false);
    return result;
  }
  await canvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
  const shot = await waitSettled(page, canvas, 0, 10_000);
  result.screenshot = await save(`case-${label.replace(/[^a-z0-9-]+/gi, '-')}`, shot.png);
  result.probes = harness.probes.map((probe) => judgeProbe(shot.image, probe));
  for (const probe of result.probes) check(`${label}: probe ${probe.name}`, probe.pass, probe.detail);
  return result;
}

/** A §5.15 probe: the median of the 3x3 patch at (x, y) CSS pixels of the canvas. */
function judgeProbe(image, probe) {
  const x = Math.round(probe.x);
  const y = Math.round(probe.y);
  const base = { name: probe.name, x, y, expect: probe.expect };
  if (!(x >= 1 && y >= 1 && x < image.width - 1 && y < image.height - 1)) {
    return { ...base, rgb: null, pass: false, detail: `(${x},${y}) is outside the ${image.width}x${image.height} canvas` };
  }
  const rgb = [0, 1, 2].map((channel) => {
    const values = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) values.push(image.data[((y + dy) * image.width + (x + dx)) * 4 + channel]);
    }
    values.sort((a, b) => a - b);
    return values[4];
  });
  const pass = probeMatches(rgb, probe.expect);
  return { ...base, rgb, pass, detail: `(${x},${y}) rgb=${rgb.join(',')} expect ${describeExpectation(probe.expect)}` };
}

function probeMatches([r, g, b], expect) {
  const near = (target, tol) => Math.abs(r - target[0]) <= tol && Math.abs(g - target[1]) <= tol && Math.abs(b - target[2]) <= tol;
  if (expect === 'plate') return near(PLATE_RGB, 6);
  if (expect === 'not-plate') return !near(PLATE_RGB, 12);
  if (Array.isArray(expect?.rgb)) return near(expect.rgb, Number(expect.tol ?? 0));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  switch (expect?.family) {
    case 'C': return max - min < 40 && (r + g + b) / 3 >= 60 && (r + g + b) / 3 <= 200;
    case 'O': return r > g + 40 && r > b + 40;
    case 'N': return b > r + 30 && b >= g;
    case 'H': return min >= 170;
    case 'S': return r > 150 && g > 120 && b < 110;
    default: return false;
  }
}

function describeExpectation(expect) {
  if (typeof expect === 'string') return expect;
  if (Array.isArray(expect?.rgb)) return `rgb ${expect.rgb.join(',')} ±${expect.tol ?? 0}`;
  if (expect?.family) return `family ${expect.family}`;
  return JSON.stringify(expect);
}

const LOST_MESSAGE = /device(?: was)? lost|lost the device|context[ _-]?lost|webglcontextlost/i;

/**
 * Mount and unmount the viewer canvas CHURN_ROUNDS times in one document: from
 * `?sim=caffeine`, push `/library` (the molecule closes and the canvas
 * unmounts), wait past LupiCanvas's deferred renderer disposal, then go Back.
 */
async function scenarioChurn(ctx) {
  const { page, check, save, outcome } = ctx;
  const lost = [];
  page.on('console', (message) => {
    if (LOST_MESSAGE.test(message.text())) lost.push(`${message.type()}: ${message.text().slice(0, 200)}`);
  });
  const entry = galleryEntry('caffeine');
  const first = await openStructure(ctx, entry);
  if (!first) return;
  const visits = [];
  for (let round = 1; round <= CHURN_ROUNDS; round += 1) {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/library');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const unmounted = await page.waitForFunction(() => !document.querySelector('.lupine-main-viewport canvas'), null, { timeout: 20_000, polling: 100 })
      .then(() => true, () => false);
    // R3F tears the root down after 500 ms and LupiCanvas disposes the
    // renderer 250 ms later.
    await page.waitForTimeout(1_200);
    const away = await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, runtime: window.__lupiRenderer?.backend ?? null }));
    await page.evaluate(() => window.history.back());
    const remounted = await page.waitForFunction((expected) => {
      const status = window.__lupiViewerMcp?.status?.();
      const canvas = document.querySelector('.lupine-main-viewport canvas');
      return Boolean(status?.moleculeLoaded && (expected == null || status.atomCount === expected) && canvas && window.__lupiRenderer?.backend);
    }, entry.atoms, { timeout, polling: 250 }).then(() => true, () => false);
    const visit = await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, runtime: window.__lupiRenderer?.backend ?? null }));
    visits.push({ round, unmounted, awayCanvases: away.canvases, awayRuntime: away.runtime, remounted, canvases: visit.canvases, runtime: visit.runtime });
    log(`  --  round ${round}: away unmounted=${unmounted} canvases=${away.canvases}; back remounted=${remounted} canvases=${visit.canvases} runtime=${visit.runtime}`);
    if (!remounted) break;
  }
  outcome.data.churn = { visits, lost };
  const complete = visits.length === CHURN_ROUNDS && visits.every((visit) => visit.unmounted && visit.remounted);
  check(`viewer canvas unmounts and remounts ${CHURN_ROUNDS} times`, complete, visits.map((visit) => `${visit.round}:${visit.unmounted ? 'u' : '-'}${visit.remounted ? 'm' : '-'}`).join(' '));
  check('at most one <canvas> on every viewer visit', visits.every((visit) => visit.canvases <= 1), visits.map((visit) => visit.canvases).join(','));
  check('the renderer is released while away', visits.every((visit) => visit.awayCanvases === 0 && visit.awayRuntime === null), visits.map((visit) => `${visit.awayCanvases}/${visit.awayRuntime ?? '-'}`).join(','));
  check('no device-lost or context-lost console message', lost.length === 0, lost.slice(0, 3).join(' | ') || 'none');
  if (!complete) return;
  const canvas = await mainCanvas(page);
  if (!check('viewer canvas is present after churn', Boolean(canvas))) return;
  await canvas.evaluate((node) => node.setAttribute('data-smoke-main', '1'));
  if (level === 'boot') return recordBackend(ctx);
  const settled = await waitSettled(page, canvas, 0.01, 20_000);
  await save('render', settled.png);
  const render = await assessRender(page, canvas, settled.image, 0.01);
  outcome.data.render = render;
  check('canvas is non-blank after churn', render.nonBlank, `canvas-contribution=${pct(render.canvasContribution)} luminanceStd=${render.luminanceStd.toFixed(1)}`);
  await recordBackend(ctx);
}

/** No WebGPU and no WebGL: the viewer shows RendererFallback instead of a canvas. */
async function scenarioFallback({ page, check, save, outcome }) {
  outcome.url = new URL('?sim=caffeine', baseFor(page)).href;
  await page.goto(outcome.url, { waitUntil: 'commit', timeout });
  const fallback = page.locator('[data-testid="renderer-fallback"]').first();
  const shown = await fallback.waitFor({ state: 'visible', timeout }).then(() => true, () => false);
  const text = shown ? (await fallback.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  outcome.data.fallback = { shown, text, canvases };
  check('renderer fallback screen is shown', shown, text);
  check('no <canvas> remains behind the fallback', canvases === 0, `${canvases} canvas`);
  await save('fallback', await page.screenshot({ scale: 'css' }));
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
  if (profile === 'phone390') {
    // The 390 px one-thumb phone: iPhone 13 screen and user agent, with the
    // full 844 px height (no simulated Safari toolbar).
    return {
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: devices['iPhone 13'].userAgent,
      ...common,
    };
  }
  // The release-smoke desktop size: software renderers manage a few frames a
  // second here, so a larger viewport only slows every capture down.
  return { viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1, ...common };
}

async function stubThirdParty(page) {
  // Same stubs as the Playwright suites: optional third-party enhancements must
  // never decide whether the viewer works. Lupi's own assets are never stubbed.
  // Route promises reject once a page closes mid-request; that is not a finding.
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }).catch(() => {}));
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort().catch(() => {}));
}

function attachDiagnostics(page, baseUrl, errors, scenario) {
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
    const ignored = ignoredConsoleError(text, location, appOrigin, scenario);
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

function ignoredConsoleError(text, location, appOrigin, scenario) {
  // Third-party resource failures are environment noise (the stubs above abort
  // fonts); a failure on Lupi's own origin still fails the run.
  if (/^Failed to load resource/.test(text) && location && !location.startsWith(appOrigin)) return 'third-party resource';
  // Without WebGPU or WebGL the renderer fails to start by design; React and
  // the canvas error boundary log that on the way to the fallback screen.
  if (scenario === 'fallback') return 'fallback scenario: error-boundary logging is expected';
  if (allowConsole?.test(text)) return `--allow-console ${allowConsole.source}`;
  return null;
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
    const rendered = lane.backend === 'nogpu' ? 'no renderer expected' : `app rendered through ${actual}`;
    log(`  lane ${lane.backend}: ${rendered}; adapter=${lane.preflight?.adapter ? describeAdapter(lane.preflight.adapter) : 'none'}`);
    for (const profile of lane.profiles) {
      const line = profile.scenarios.map((scenario) => `${scenario.name}:${scenario.ok ? (scenario.flaky ? 'flaky' : 'ok') : 'FAIL'}`).join(' ');
      log(`    ${profile.profile.padEnd(7)} ${line}`);
    }
  }
  for (const warning of report.warnings) log(`  warning: ${warning}`);
  for (const failure of report.failures) log(`  FAIL ${failure}`);
  if (report.summary) log(`  ${report.summary.passed}/${report.summary.scenarios} scenarios passed, ${report.summary.checks - report.summary.failedChecks}/${report.summary.checks} checks`);
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

function warn(message) {
  report.warnings.push(message);
  log(`  !!  ${message}`);
}

function log(...values) {
  if (!jsonMode) console.log(...values);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Run last, so every module-level constant above is initialised.
await main();
