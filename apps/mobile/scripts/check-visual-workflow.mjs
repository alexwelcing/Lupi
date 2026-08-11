import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { parse, parseAllDocuments } from "yaml";

const appDirectory = resolve(import.meta.dirname, "..");
const workflowPath = resolve(
  appDirectory,
  ".eas",
  "workflows",
  "mobile-visual.yml",
);
const flowPath = resolve(
  appDirectory,
  ".maestro",
  "visual",
  "caffeine-ready.yml",
);
const healthScriptPath = resolve(
  appDirectory,
  ".maestro",
  "visual",
  "scripts",
  "capture-viewer-health.js",
);

const workflow = parse(readFileSync(workflowPath, "utf8"));
const flowDocuments = parseAllDocuments(readFileSync(flowPath, "utf8"));
const flowHeader = flowDocuments[0]?.toJS();
const flowCommands = flowDocuments[1]?.toJS();
const healthScript = readFileSync(healthScriptPath, "utf8");
const failures = [];

check(
  workflow?.on?.workflow_dispatch !== undefined,
  "workflow is manual-dispatch only",
);
check(
  workflow?.jobs?.build_ios_visual?.type === "build" &&
    workflow.jobs.build_ios_visual.params?.profile === "visual-ios",
  "workflow builds the visual-ios profile",
);
check(
  workflow?.jobs?.capture_native_app?.type === "maestro" &&
    workflow.jobs.capture_native_app.params?.maestro_version === "2.7.0" &&
    workflow.jobs.capture_native_app.params?.device_identifier ===
      "iPhone 16 Plus",
  "workflow pins Maestro and the iOS simulator device",
);
check(
  workflow?.jobs?.capture_native_app?.env?.MAESTRO_APP_ID ===
    "live.lupi.app.dev" &&
    workflow.jobs.capture_native_app.env?.LUPI_VIEWER_BROWSER_MANIFEST_URL ===
      "https://lupi.live/browser-mcp-manifest.json" &&
    workflow.jobs.capture_native_app.env?.LUPI_VIEWER_HEALTH_URL ===
      "https://lupi.live/health",
  "workflow pins the development app and remote viewer identity endpoints",
);
check(
  flowHeader?.appId === "${MAESTRO_APP_ID}",
  "flow consumes the workflow app identity",
);
check(Array.isArray(flowCommands), "Maestro commands parse as a sequence");

const openLink = findCommand("openLink");
check(
  openLink?.link === "lupi-dev://__visual?scenario=viewer-caffeine-ready",
  "flow opens the gated deterministic visual route",
);

const readyWait = findCommand("extendedWaitUntil");
check(
  readyWait?.visible?.id === "visual-qa-ready-viewer-caffeine-ready",
  "flow waits on correlated native readiness rather than a timer",
);

const runScript = findCommand("runScript");
check(
  runScript?.file === "scripts/capture-viewer-health.js" &&
    runScript.env?.viewerBrowserManifestUrl ===
      "${LUPI_VIEWER_BROWSER_MANIFEST_URL}" &&
    runScript.env?.viewerHealthUrl === "${LUPI_VIEWER_HEALTH_URL}",
  "flow records the remote viewer and browser-manifest identities",
);

const screenshot = findCommand("takeScreenshot");
check(
  screenshot?.path ===
    "${MAESTRO_TESTS_DIR}/visual/ios/${MAESTRO_DEVICE_UDID}/shard-${MAESTRO_SHARD_INDEX}/caffeine-ready",
  "flow retains a device- and shard-scoped screenshot artifact",
);

const openLinks = findCommands("openLink");
const screenshots = findCommands("takeScreenshot");
check(
  openLinks.some(
    (command) =>
      command?.link === "lupi-dev://__visual?scenario=ar-caffeine-intro",
  ) &&
    screenshots.some(
      (command) =>
        command?.path ===
        "${MAESTRO_TESTS_DIR}/visual/ios/${MAESTRO_DEVICE_UDID}/shard-${MAESTRO_SHARD_INDEX}/ar-caffeine-intro",
    ),
  "flow retains a deterministic native AR introduction screenshot",
);

const requiredNativeShellScreenshots = [
  "gallery-first-fold",
  "library-empty",
  "settings",
];
check(
  requiredNativeShellScreenshots.every((name) =>
    screenshots.some(
      (command) =>
        command?.path ===
        `\${MAESTRO_TESTS_DIR}/visual/ios/\${MAESTRO_DEVICE_UDID}/shard-\${MAESTRO_SHARD_INDEX}/${name}`,
    ),
  ) &&
    ["gallery-screen", "library-screen", "settings-screen"].every((id) =>
      flowCommands.some(
        (entry) => entry?.extendedWaitUntil?.visible?.id === id,
      ),
    ),
  "flow captures the native Gallery, empty Library, and Settings shell after semantic readiness",
);

check(
  healthScript.includes("LUPI_VISUAL_VIEWER_IDENTITY") &&
    healthScript.includes("LUPI_VISUAL_BROWSER_MANIFEST") &&
    healthScript.includes("health.ready !== true") &&
    healthScript.includes("lupi.open_gallery_example") &&
    healthScript.includes("lupi.assess_asset") &&
    healthScript.includes("expectedToolCount = 30") &&
    healthScript.includes("releaseTag"),
  "health script fails closed and logs the exact 30-tool browser identity",
);

checkHealthScriptContract();

if (failures.length) {
  for (const failure of failures) console.error(`[fail] ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `[ok] Expo visual workflow contract (${flowCommands.length} Maestro commands)`,
  );
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function findCommand(name) {
  if (!Array.isArray(flowCommands)) return undefined;
  const command = flowCommands.find(
    (entry) => entry && typeof entry === "object" && name in entry,
  );
  return command?.[name];
}

function findCommands(name) {
  if (!Array.isArray(flowCommands)) return [];
  return flowCommands
    .filter((entry) => entry && typeof entry === "object" && name in entry)
    .map((entry) => entry[name]);
}

function checkHealthScriptContract() {
  const requiredNames = ["lupi.open_gallery_example", "lupi.assess_asset"];
  const validToolNames = [
    ...requiredNames,
    ...Array.from({ length: 28 }, (_, index) => `lupi.fixture_${index}`),
  ];
  const success = executeHealthScript(validToolNames);

  check(
    success.output.lupiBrowserManifest?.toolCount === 30 &&
      requiredNames.every((name) =>
        success.output.lupiBrowserManifest?.toolNames?.includes(name),
      ) &&
      success.logs.some((line) =>
        line.startsWith("LUPI_VISUAL_BROWSER_MANIFEST "),
      ),
    "health script accepts and records one exact 30-tool browser manifest",
  );

  check(
    throwsContractMismatch(validToolNames.slice(0, 29)) &&
      throwsContractMismatch(
        validToolNames.map((name) =>
          name === "lupi.assess_asset"
            ? "lupi.fixture_missing_assessment"
            : name,
        ),
      ) &&
      throwsContractMismatch([
        ...validToolNames.slice(0, 29),
        validToolNames[0],
      ]),
    "health script rejects short, capability-missing, and duplicate manifests",
  );
}

function executeHealthScript(toolNames) {
  const output = {};
  const logs = [];
  const responses = new Map([
    [
      "https://lupi.live/health",
      {
        ready: true,
        name: "lupi-mcp-worker",
        version: "fixture-release",
        toolCount: 7,
        release: {
          id: "fixture-id",
          tag: "fixture-tag",
          timestamp: "2026-08-10T00:00:00.000Z",
        },
      },
    ],
    [
      "https://lupi.live/browser-mcp-manifest.json",
      {
        schemaVersion: "0.3.0",
        generatedAt: "2026-08-10T00:00:00.000Z",
        tools: toolNames.map((name) => ({ name })),
      },
    ],
  ]);

  runInNewContext(healthScript, {
    console: { log: (line) => logs.push(String(line)) },
    http: {
      get: (url) => {
        const body = responses.get(url);
        return body
          ? { body: JSON.stringify(body), ok: true, status: 200 }
          : { body: "", ok: false, status: 404 };
      },
    },
    json: JSON.parse,
    output,
    viewerBrowserManifestUrl: "https://lupi.live/browser-mcp-manifest.json",
    viewerHealthUrl: "https://lupi.live/health",
  });

  return { logs, output };
}

function throwsContractMismatch(toolNames) {
  try {
    executeHealthScript(toolNames);
    return false;
  } catch (error) {
    return (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.includes("browser manifest contract mismatch")
    );
  }
}
