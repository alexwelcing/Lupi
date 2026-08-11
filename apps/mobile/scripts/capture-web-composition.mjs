import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { chromium } from "playwright";

const appDirectory = path.resolve(import.meta.dirname, "..");
const distDirectory = path.join(appDirectory, "dist");
const artifactsRoot = path.join(
  appDirectory,
  ".verify-artifacts",
  "mobile-web-composition",
);
const recentMoleculesKey = "lupi.mobile.recent-molecules.v1";
const evidenceClassification = "web-composition-only";
const evidenceDisclaimer =
  "Expo web rendered in Playwright at iPhone-sized CSS viewports. This is composition feedback, not native iOS, device, AR, development-build, or TestFlight proof.";
const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XqFDPwAAAABJRU5ErkJggg==",
  "base64",
);

const profiles = [
  {
    id: "iphone-se",
    label: "iPhone SE (3rd generation)",
    viewport: { height: 667, width: 375 },
  },
  {
    id: "iphone-15",
    label: "iPhone 15",
    viewport: { height: 852, width: 393 },
  },
  {
    id: "iphone-15-pro-max",
    label: "iPhone 15 Pro Max",
    viewport: { height: 932, width: 430 },
  },
];

const seededRecents = [
  {
    formula: "C8H10N4O2",
    id: "caffeine",
    load: { atomCount: 24, input: "caffeine", inputType: "gallery" },
    name: "Caffeine",
    tags: ["organic", "alkaloid"],
  },
  {
    formula: "C60",
    id: "c60_buckyball",
    load: { atomCount: 60, input: "c60_buckyball", inputType: "gallery" },
    name: "Buckminsterfullerene",
    tags: ["carbon", "nanomaterial"],
  },
];

const scenarios = [
  {
    checks: [
      labelCheck("gallery-root", "Lupi molecular gallery"),
      labelCheck("gallery-search", "Search gallery"),
      textCheck("gallery-count", "24 structures"),
      roleCheck("gallery-featured-heading", "heading", "Featured"),
      labelCheck("gallery-filter", "Filter gallery"),
      textCheck("gallery-caffeine-card", "Caffeine"),
    ],
    description: "Unfiltered Gallery first fold with curated palette previews.",
    id: "gallery-default",
    path: "/",
    recentMolecules: [],
    title: "Gallery — default",
  },
  {
    checks: [
      textCheck("library-section", "Recent Structures"),
      textCheck("library-empty-heading", "No recent structures"),
      labelCheck("library-browse-action", "Browse the molecule gallery"),
    ],
    description: "Library empty state with browser storage explicitly cleared.",
    id: "library-empty",
    path: "/library",
    recentMolecules: [],
    title: "Library — empty",
  },
  {
    checks: [
      labelCheck("library-count", "2 recent structures"),
      labelCheck("library-caffeine", "Open Caffeine, C8H10N4O2"),
      labelCheck("library-buckyball", "Open Buckminsterfullerene, C60"),
      labelCheck("library-clear", "Clear recent structures"),
    ],
    description: "Library populated with two deterministic valid recents.",
    id: "library-populated",
    path: "/library",
    recentMolecules: seededRecents,
    title: "Library — populated",
  },
  {
    checks: [
      textCheck("settings-open-section", "Open Content"),
      labelCheck("settings-open-xyz", "Open XYZ File"),
      labelCheck("settings-saved-input", "Saved view slug or URL"),
      labelCheck("settings-saved-open", "Open saved view"),
      textCheck("settings-privacy-section", "Privacy"),
      textCheck("settings-local-data", "On This iPhone"),
      textCheck("settings-about-section", "About"),
      labelCheck("settings-diagnostics", "About & Diagnostics"),
    ],
    description:
      "Settings grouped rows and saved-view input in pristine state.",
    id: "settings-default",
    path: "/settings",
    recentMolecules: [],
    title: "Settings — default",
  },
];

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const selectedProfiles = options.quick
  ? profiles.filter((profile) => profile.id === "iphone-15")
  : options.profileIds.length
    ? options.profileIds.map((id) => {
        const profile = profiles.find((candidate) => candidate.id === id);
        if (!profile) {
          throw new Error(
            `Unknown profile "${id}". Expected one of: ${profiles.map((item) => item.id).join(", ")}`,
          );
        }
        return profile;
      })
    : profiles;

await requireExport();

const generatedAt = new Date().toISOString();
const runId = generatedAt.replaceAll(":", "-").replaceAll(".", "-");
const outputDirectory = path.join(artifactsRoot, runId);
await mkdir(outputDirectory, { recursive: true });

const packageJson = JSON.parse(
  await readFile(path.join(appDirectory, "package.json"), "utf8"),
);
const exportIndexPath = path.join(distDirectory, "index.html");
const exportIndex = await readFile(exportIndexPath);
const server = await startStaticServer(distDirectory);
const origin = `http://127.0.0.1:${server.port}`;
let browser;
const results = [];

try {
  browser = await chromium.launch({ headless: true });

  for (const profile of selectedProfiles) {
    const context = await browser.newContext({
      colorScheme: "dark",
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      locale: "en-US",
      reducedMotion: "reduce",
      screen: profile.viewport,
      timezoneId: "America/Los_Angeles",
      viewport: profile.viewport,
    });

    await context.route(
      "https://lupi.live/gallery/snapshots/**",
      async (route) => {
        await route.fulfill({
          body: transparentPng,
          contentType: "image/png",
          status: 200,
        });
      },
    );

    for (const scenario of scenarios) {
      const result = await captureScenario({
        context,
        origin,
        outputDirectory,
        profile,
        scenario,
      });
      results.push(result);
      console.log(
        `[${result.passed ? "ok" : "fail"}] ${profile.id} / ${scenario.id}`,
      );
    }

    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}

const passed = results.every((result) => result.passed);
const report = {
  evidence: {
    classification: evidenceClassification,
    disclaimer: evidenceDisclaimer,
    galleryPreviewPolicy:
      "Public Gallery snapshot requests are fulfilled with a transparent pixel so the app's curated palette previews are deterministic. Production thumbnail fidelity is not evaluated.",
  },
  generatedAt,
  results,
  schemaVersion: "lupi.mobile-web-composition-report.v1",
  source: {
    appVersion: packageJson.version,
    exportIndexSha256: sha256(exportIndex),
    platform: "expo-web-playwright-chromium",
  },
  summary: {
    failed: results.filter((result) => !result.passed).length,
    passed: results.filter((result) => result.passed).length,
    profiles: selectedProfiles.length,
    scenarios: scenarios.length,
    total: results.length,
    webHydrationRecoveryWarnings: results.reduce(
      (total, result) =>
        total + result.checks.runtime.webHydrationRecoveryWarnings.length,
      0,
    ),
  },
};
const manifest = {
  evidence: report.evidence,
  generatedAt,
  profiles: selectedProfiles,
  scenarios: scenarios.map((scenario) => ({
    checks: scenario.checks.map(({ id, kind, role, value }) => ({
      id,
      kind,
      ...(role ? { role } : {}),
      value,
    })),
    description: scenario.description,
    id: scenario.id,
    path: scenario.path,
    storageFixture:
      scenario.recentMolecules.length === 0
        ? "recent-molecules-empty"
        : "recent-molecules-caffeine-and-buckyball",
    title: scenario.title,
  })),
  schemaVersion: "lupi.mobile-web-composition-manifest.v1",
};

await writeJson(path.join(outputDirectory, "manifest.json"), manifest);
await writeJson(path.join(outputDirectory, "report.json"), report);
await writeFile(
  path.join(outputDirectory, "index.html"),
  renderHtmlReport(report),
  "utf8",
);

console.log("");
console.log("WEB COMPOSITION ONLY — NOT NATIVE IOS PROOF");
console.log(evidenceDisclaimer);
console.log(`Artifacts: ${outputDirectory}`);
console.log(
  `Result: ${report.summary.passed}/${report.summary.total} profile/scenario captures passed`,
);

if (!passed) process.exitCode = 1;

async function captureScenario({
  context,
  origin,
  outputDirectory: runDirectory,
  profile,
  scenario,
}) {
  const page = await context.newPage();
  const runtime = {
    consoleErrors: [],
    consoleWarnings: [],
    externalRequestFailures: [],
    webHydrationRecoveryWarnings: [],
    localHttpErrors: [],
    localRequestFailures: [],
    pageErrors: [],
  };

  page.on("console", (message) => {
    const entry = { text: message.text(), type: message.type() };
    if (message.type() === "error") runtime.consoleErrors.push(entry);
    if (message.type() === "warning") runtime.consoleWarnings.push(entry);
  });
  page.on("pageerror", (error) => {
    if (isExpoWebHydrationRecovery(error.message)) {
      runtime.webHydrationRecoveryWarnings.push({
        message: error.message,
        rationale:
          "The static Expo web page recovered by replacing mismatched server markup. The semantic, overflow, and screenshot checks run after recovery; native iOS is not implicated or proved.",
      });
    } else {
      runtime.pageErrors.push(error.message);
    }
  });
  page.on("requestfailed", (request) => {
    const entry = {
      errorText: request.failure()?.errorText ?? "unknown",
      method: request.method(),
      url: request.url(),
    };
    if (request.url().startsWith(origin)) {
      runtime.localRequestFailures.push(entry);
    } else {
      runtime.externalRequestFailures.push(entry);
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      runtime.localHttpErrors.push({
        status: response.status(),
        url: response.url(),
      });
    }
  });

  await page.addInitScript(
    ({ key, value }) => {
      globalThis.localStorage.clear();
      if (value) globalThis.localStorage.setItem(key, value);
    },
    {
      key: recentMoleculesKey,
      value: scenario.recentMolecules.length
        ? JSON.stringify(scenario.recentMolecules)
        : null,
    },
  );

  const url = new URL(scenario.path, origin).toString();
  let navigationError = null;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition-duration: 0s !important;
      }
    `,
  });

  const semantics = [];
  for (const check of scenario.checks) {
    semantics.push(await runSemanticCheck(page, check));
  }

  await page.evaluate(async () => {
    await globalThis.document.fonts?.ready;
    globalThis.scrollTo(0, 0);
  });
  await page.waitForTimeout(150);

  const overflow = await page.evaluate(() => {
    const documentElement = globalThis.document.documentElement;
    const body = globalThis.document.body;
    const viewportWidth = documentElement.clientWidth || globalThis.innerWidth;
    const scrollWidth = Math.max(
      documentElement.scrollWidth,
      body?.scrollWidth ?? 0,
    );
    return {
      horizontalOverflowPx: Math.max(0, scrollWidth - viewportWidth),
      passed: scrollWidth - viewportWidth <= 1,
      scrollWidth,
      viewportWidth,
    };
  });

  const screenshotName =
    [evidenceClassification, profile.id, scenario.id].join("__") + ".png";
  const screenshotPath = path.join(runDirectory, screenshotName);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: screenshotPath,
  });
  const screenshot = await readFile(screenshotPath);

  const runtimePassed =
    navigationError === null &&
    runtime.consoleErrors.length === 0 &&
    runtime.localHttpErrors.length === 0 &&
    runtime.localRequestFailures.length === 0 &&
    runtime.pageErrors.length === 0;
  const runtimeCheck = {
    ...runtime,
    classification: runtimePassed
      ? runtime.webHydrationRecoveryWarnings.length
        ? "passed-with-expo-web-hydration-recovery-warning"
        : "passed"
      : "failed",
    navigationError,
    passed: runtimePassed,
  };
  const passed =
    semantics.every((check) => check.passed) &&
    overflow.passed &&
    runtimeCheck.passed;

  await page.close();

  return {
    checks: { overflow, runtime: runtimeCheck, semantics },
    evidenceClassification,
    passed,
    profile: {
      id: profile.id,
      label: profile.label,
      viewport: profile.viewport,
    },
    scenario: {
      description: scenario.description,
      id: scenario.id,
      path: scenario.path,
      title: scenario.title,
    },
    screenshot: {
      byteLength: screenshot.byteLength,
      file: screenshotName,
      sha256: sha256(screenshot),
    },
  };
}

async function runSemanticCheck(page, check) {
  const locator =
    check.kind === "label"
      ? page.getByLabel(check.value, { exact: true })
      : check.kind === "role"
        ? page.getByRole(check.role, { exact: true, name: check.value })
        : page.getByText(check.value, { exact: true });
  let count = 0;
  let visibleCount = 0;
  let error = null;

  try {
    await locator.first().waitFor({ state: "visible", timeout: 10_000 });
    count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      if (await locator.nth(index).isVisible()) visibleCount += 1;
    }
  } catch (caught) {
    count = await locator.count().catch(() => 0);
    error =
      caught instanceof Error ? caught.message.split("\n")[0] : String(caught);
  }

  return {
    count,
    error,
    id: check.id,
    kind: check.kind,
    passed: visibleCount >= 1,
    value: check.value,
    visibleCount,
  };
}

function labelCheck(id, value) {
  return { id, kind: "label", value };
}

function roleCheck(id, role, value) {
  return { id, kind: "role", role, value };
}

function textCheck(id, value) {
  return { id, kind: "text", value };
}

function isExpoWebHydrationRecovery(message) {
  return message.startsWith("Minified React error #418;");
}

async function requireExport() {
  const indexPath = path.join(distDirectory, "index.html");
  try {
    const indexStat = await stat(indexPath);
    if (!indexStat.isFile()) throw new Error("not a file");
  } catch {
    throw new Error(
      `Expo web export is missing at ${indexPath}. Run pnpm export:web before capture.`,
    );
  }
}

function parseArguments(args) {
  const parsed = { help: false, profileIds: [], quick: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
    } else if (argument === "--quick") {
      parsed.quick = true;
    } else if (argument === "--profile") {
      const profileId = args[index + 1];
      if (!profileId) throw new Error("--profile requires a profile id");
      parsed.profileIds.push(profileId);
      index += 1;
    } else if (argument.startsWith("--profile=")) {
      parsed.profileIds.push(argument.slice("--profile=".length));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (parsed.quick && parsed.profileIds.length) {
    throw new Error("Use --quick or --profile, not both.");
  }
  return parsed;
}

function printHelp() {
  console.log(`Capture deterministic Expo-web composition evidence.

Usage:
  node scripts/capture-web-composition.mjs [--quick]
  node scripts/capture-web-composition.mjs --profile iphone-se [--profile iphone-15]

Profiles:
${profiles.map((profile) => `  ${profile.id.padEnd(20)} ${profile.viewport.width}x${profile.viewport.height}`).join("\n")}

The output is web composition evidence only, never native iOS proof.`);
}

async function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }

    const resolved = await resolveStaticFile(root, request.url ?? "/");
    if (!resolved) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": String(resolved.size),
      "Content-Type": contentType(resolved.filePath),
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(resolved.filePath).pipe(response);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not resolve the local visual server port.");
  }

  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    port: address.port,
  };
}

async function resolveStaticFile(root, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(requestUrl, "http://localhost").pathname,
    );
  } catch {
    return null;
  }

  const rawCandidate = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, rawCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  const candidates =
    pathname === "/"
      ? [path.join(root, "index.html")]
      : [
          rawCandidate,
          `${rawCandidate}.html`,
          path.join(rawCandidate, "index.html"),
        ];

  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) {
        return { filePath: candidate, size: candidateStat.size };
      }
    } catch {
      // Continue to the next static route candidate.
    }
  }
  return null;
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderHtmlReport(report) {
  const resultCards = report.results
    .map(
      (result) => `
    <article class="card ${result.passed ? "pass" : "fail"}">
      <header>
        <div>
          <p class="eyebrow">${escapeHtml(result.profile.label)}</p>
          <h2>${escapeHtml(result.scenario.title)}</h2>
        </div>
        <span>${
          result.passed
            ? result.checks.runtime.webHydrationRecoveryWarnings.length
              ? "PASS + WEB WARNING"
              : "PASS"
            : "FAIL"
        }</span>
      </header>
      <img alt="${escapeHtml(`${result.scenario.title} web composition screenshot`)}" src="${escapeHtml(result.screenshot.file)}">
      <p>${escapeHtml(result.scenario.description)}</p>
    </article>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lupi mobile web composition evidence</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { background: #071118; color: #f2f7f8; margin: 0; padding: 32px; }
    .notice { background: #182831; border: 1px solid #d8a94b; border-radius: 16px; max-width: 1000px; padding: 18px; }
    .grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-top: 28px; }
    .card { background: #101d24; border: 1px solid #29404b; border-radius: 18px; overflow: hidden; }
    .card.fail { border-color: #ff7d7d; }
    header { align-items: center; display: flex; justify-content: space-between; padding: 18px; }
    h1, h2, p { margin: 0; }
    h1 { margin-bottom: 10px; }
    h2 { font-size: 20px; }
    .eyebrow { color: #89a8b6; font-size: 12px; margin-bottom: 5px; text-transform: uppercase; }
    img { background: #02080b; display: block; height: auto; width: 100%; }
    article > p { color: #b4c7cf; line-height: 1.5; padding: 18px; }
    span { color: #72e5b2; font-size: 12px; font-weight: 800; }
    .fail span { color: #ff9d9d; }
  </style>
</head>
<body>
  <section class="notice">
    <h1>Web composition evidence only</h1>
    <p><strong>Not native iOS proof.</strong> ${escapeHtml(report.evidence.disclaimer)}</p>
  </section>
  <main class="grid">${resultCards}
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
