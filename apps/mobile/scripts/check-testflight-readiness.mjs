import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(appDirectory, "..", "..");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const strictRelease = process.argv.includes("--release");
const failures = [];
const warnings = [];
const passes = [];

const app = readJson("app.json").expo;
const eas = readJson("eas.json");
const packageJson = readJson("package.json");
const rootPackageJson = JSON.parse(
  readFileSync(join(repositoryDirectory, "package.json"), "utf8"),
);
const corePackageJson = JSON.parse(
  readFileSync(
    join(repositoryDirectory, "packages", "core", "package.json"),
    "utf8",
  ),
);
const easIgnore = readFileSync(join(repositoryDirectory, ".easignore"), "utf8");
const visualWorkflow = readFileSync(
  join(appDirectory, ".eas", "workflows", "mobile-visual.yml"),
  "utf8",
);
const visualFlow = readFileSync(
  join(appDirectory, ".maestro", "visual", "caffeine-ready.yml"),
  "utf8",
);
const viewerHealthScript = readFileSync(
  join(
    appDirectory,
    ".maestro",
    "visual",
    "scripts",
    "capture-viewer-health.js",
  ),
  "utf8",
);
const arSurfaceSource = readFileSync(
  join(appDirectory, "src", "features", "ar", "molecule-ar-surface.native.tsx"),
  "utf8",
);

check(app.name === "Lupi", "App name is Lupi");
check(app.slug === "lupi", "Expo slug is lupi");
check(app.owner === "alexwelcing", "Expo owner is pinned to alexwelcing");
check(
  UUID_PATTERN.test(app.extra?.eas?.projectId ?? ""),
  "EAS project UUID is linked",
);
check(
  app.ios?.bundleIdentifier === "live.lupi.app",
  "iOS bundle identifier is live.lupi.app",
);
check(
  /^\d+\.\d+\.\d+$/.test(app.version ?? ""),
  "Marketing version is three-part numeric",
);
check(app.version === packageJson.version, "Expo and package versions match");
check(
  app.ios?.buildNumber === undefined,
  "Local iOS build number is omitted when EAS version source is remote",
);
check(app.ios?.supportsTablet === false, "The first candidate is iPhone-only");
check(
  app.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false,
  "Export compliance declaration is explicit",
);
check(
  eas.cli?.appVersionSource === "remote",
  "EAS owns the authoritative build number",
);
check(
  eas.cli?.version === ">= 20.3.0",
  "EAS CLI minimum supports the Expo visual workflow",
);
check(
  app.runtimeVersion?.policy === "fingerprint",
  "EAS Update runtime version follows the native fingerprint",
);
check(
  app.updates?.url === `https://u.expo.dev/${app.extra?.eas?.projectId}`,
  "EAS Update URL is pinned to this Expo project",
);
check(
  packageJson.dependencies?.expo === "~55.0.28",
  "Expo framework is pinned to SDK 55",
);
check(
  packageJson.dependencies?.["@expo/metro-runtime"] === "~55.0.12" &&
    packageJson.dependencies?.["expo-router"] === "~55.0.17",
  "Expo Router and Metro runtime match SDK 55",
);
check(
  packageJson.dependencies?.["expo-dev-client"] === "~55.0.37",
  "Expo development client matches SDK 55",
);
check(
  packageJson.dependencies?.["expo-updates"] === "~55.0.26",
  "EAS Update matches SDK 55",
);
check(
  packageJson.devDependencies?.["expo-mcp"] === "~0.2.1",
  "Expo MCP local capabilities stay pinned for the SDK 55 checkpoint",
);
check(
  packageJson.dependencies?.["@reactvision/react-viro"] === "2.57.5",
  "Native AR renderer uses the Expo 55-57 compatible Viro release",
);
check(
  rootPackageJson.pnpm?.packageExtensions?.["@reactvision/react-viro@2.57.5"]
    ?.dependencies?.["@expo/config-plugins"] === "55.0.11",
  "Viro config-plugin resolution is explicit for strict pnpm installs",
);
check(
  rootPackageJson.pnpm?.packageExtensions?.["babel-preset-expo@55.0.24"]
    ?.dependencies?.["expo-router"] === "55.0.17",
  "Expo Router Babel discovery is explicit for strict pnpm installs",
);
const buildPropertiesPlugin = app.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
);
check(
  packageJson.dependencies?.["expo-build-properties"] === "~55.0.16" &&
    buildPropertiesPlugin?.[1]?.ios?.deploymentTarget === "17.6",
  "SDK 55 build properties preserve the ViroKit iOS deployment target",
);
check(
  packageJson.dependencies?.["expo-font"] === "~55.0.8" &&
    app.plugins?.includes("expo-font") === true &&
    app.plugins?.includes("expo-sqlite") === true &&
    app.plugins?.includes("expo-web-browser") === true,
  "SDK 55 native peer dependencies and config plugins are explicit",
);
check(
  packageJson.dependencies?.["@atlas/core"] === "workspace:^" &&
    corePackageJson.exports?.["./elements"] === "./src/elements.ts",
  "Native AR uses the canonical bounded element-color and radius table",
);
check(
  !("newArchEnabled" in app),
  "SDK 55 omits the removed New Architecture opt-out",
);
check(
  !("edgeToEdgeEnabled" in (app.android ?? {})),
  "SDK 55 omits the removed Android edge-to-edge switch",
);
const viroPlugin = app.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "@reactvision/react-viro",
);
check(
  viroPlugin?.[1]?.provider === "none" &&
    viroPlugin?.[1]?.ios?.includeARCore === false &&
    viroPlugin?.[1]?.ios?.includeSemantics === false,
  "Native AR disables cloud, location, and semantic providers in the first release",
);
check(
  arSurfaceSource.includes('provider="none"'),
  "Native AR runtime disables Viro cloud and geospatial providers",
);
check(
  app.plugins?.includes("./plugins/with-viro-camera-only") === true,
  "Viro privacy sanitizer runs after the native AR plugin",
);
check(
  /place and interact with molecules/i.test(
    app.ios?.infoPlist?.NSCameraUsageDescription ?? "",
  ),
  "Native AR camera permission explains room placement",
);
check(
  [
    "NSMicrophoneUsageDescription",
    "NSPhotoLibraryUsageDescription",
    "NSPhotoLibraryAddUsageDescription",
    "NSLocationWhenInUseUsageDescription",
  ].every((key) => app.ios?.infoPlist?.[key] === undefined),
  "Static iOS configuration requests no microphone, photo, or location access",
);
check(
  app.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads ===
    false &&
    app.ios?.infoPlist?.NSAppTransportSecurity
      ?.NSAllowsArbitraryLoadsInWebContent === undefined,
  "Production iOS configuration preserves App Transport Security HTTPS enforcement",
);
check(
  eas.build?.development?.developmentClient === true &&
    eas.build?.development?.distribution === "internal" &&
    eas.build?.development?.channel === "development",
  "Development profile builds a dedicated Expo client on its own channel",
);
check(
  eas.build?.["development-simulator"]?.ios?.simulator === true &&
    eas.build?.["development-simulator"]?.withoutCredentials === true,
  "Development simulator profile is unsigned and simulator-only",
);
check(
  eas.build?.["visual-ios"]?.ios?.simulator === true &&
    eas.build?.["visual-ios"]?.withoutCredentials === true &&
    eas.build?.["visual-ios"]?.channel === "visual" &&
    eas.build?.["visual-ios"]?.env?.APP_VARIANT === "development" &&
    eas.build?.["visual-ios"]?.env?.EXPO_PUBLIC_VISUAL_QA === "1",
  "Visual iOS profile is a deterministic unsigned development-identity fixture",
);
check(
  eas.build?.["visual-android"]?.android?.buildType === "apk" &&
    eas.build?.["visual-android"]?.channel === "visual" &&
    eas.build?.["visual-android"]?.env?.EXPO_PUBLIC_VISUAL_QA === "1",
  "Visual Android profile produces an installable deterministic fixture",
);
check(
  visualWorkflow.includes("profile: visual-ios") &&
    visualWorkflow.includes("device_identifier: iPhone 16 Plus") &&
    visualWorkflow.includes("maestro_version: 2.7.0") &&
    visualWorkflow.includes("LUPI_VIEWER_HEALTH_URL: https://lupi.live/health"),
  "Visual workflow pins its iOS fixture, device, Maestro, and viewer-health identity",
);
check(
  visualFlow.includes("lupi-dev://__visual?scenario=viewer-caffeine-ready") &&
    visualFlow.includes("id: visual-qa-ready-viewer-caffeine-ready") &&
    visualFlow.includes(
      "${MAESTRO_TESTS_DIR}/visual/ios/${MAESTRO_DEVICE_UDID}/shard-${MAESTRO_SHARD_INDEX}/caffeine-ready",
    ) &&
    visualFlow.includes("lupi-dev://__visual?scenario=ar-caffeine-intro") &&
    visualFlow.includes(
      "${MAESTRO_TESTS_DIR}/visual/ios/${MAESTRO_DEVICE_UDID}/shard-${MAESTRO_SHARD_INDEX}/ar-caffeine-intro",
    ) &&
    visualFlow.includes("scripts/capture-viewer-health.js"),
  "Maestro retains correlated viewer and camera-free native AR screenshots",
);
check(
  viewerHealthScript.includes("LUPI_VISUAL_VIEWER_IDENTITY") &&
    viewerHealthScript.includes("health.ready !== true") &&
    viewerHealthScript.includes("releaseTag"),
  "Maestro records the exact ready remote viewer identity beside the screenshot",
);
check(
  eas.build?.production?.distribution === "store",
  "Production uses App Store distribution",
);
check(
  eas.build?.production?.autoIncrement === true,
  "Production build numbers auto-increment",
);
check(
  eas.build?.production?.environment === "production",
  "Production uses the EAS production environment",
);
check(
  eas.build?.production?.channel === "production" &&
    eas.build?.production?.env?.APP_VARIANT === "production" &&
    eas.build?.production?.env?.EXPO_PUBLIC_VISUAL_QA === "0",
  "Production channel uses the production identity with visual QA disabled",
);
check(
  eas.build?.production?.node === "20.19.4",
  "SDK 55 checkpoint builds pin supported Node 20.19.4",
);
check(
  eas.build?.development?.ios?.image === "sdk-55" &&
    eas.build?.development?.android?.image === "sdk-55" &&
    eas.build?.["development-simulator"]?.ios?.image === "sdk-55" &&
    eas.build?.["visual-ios"]?.ios?.image === "sdk-55" &&
    eas.build?.["visual-android"]?.android?.image === "sdk-55" &&
    eas.build?.preview?.ios?.image === "sdk-55" &&
    eas.build?.preview?.android?.image === "sdk-55" &&
    eas.build?.production?.ios?.image === "sdk-55" &&
    eas.build?.production?.android?.image === "sdk-55",
  "Every EAS platform profile pins the SDK 55 builder image",
);
check(
  eas.build?.production?.env?.EXPO_PUBLIC_LUPI_WEB_URL === "https://lupi.live",
  "Production viewer origin is explicitly https://lupi.live",
);
for (const requiredRule of [
  "*",
  "!.npmrc",
  "!pnpm-lock.yaml",
  "!pnpm-workspace.yaml",
  "!apps/mobile/app/**",
  "!apps/mobile/.eas/**",
  "!apps/mobile/.maestro/**",
  "!apps/mobile/assets/**",
  "!apps/mobile/src/**",
  "!apps/mobile/plugins/**",
  "!packages/core/src/elements.ts",
  "apps/mobile/node_modules/",
  "apps/mobile/dist-*/",
]) {
  check(
    easIgnore.split(/\r?\n/u).includes(requiredRule),
    `.easignore contains the required ${requiredRule} rule`,
  );
}

const icon = inspectPng(app.icon);
check(
  icon.width === 1024 && icon.height === 1024,
  "iOS icon is exactly 1024x1024",
);
check(
  icon.colorType !== 4 && icon.colorType !== 6,
  "iOS icon has no alpha channel",
);

const splashPath = app.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
)?.[1]?.image;
const splash = inspectPng(splashPath);
check(
  splash.width === 1024 && splash.height === 1024,
  "Splash mark is exactly 1024x1024",
);
check(
  splash.colorType === 4 || splash.colorType === 6,
  "Splash mark has an alpha channel",
);

const ascAppId = eas.submit?.production?.ios?.ascAppId;
if (/^\d+$/.test(ascAppId ?? "")) {
  passes.push("App Store Connect Apple ID is pinned");
} else if (strictRelease) {
  failures.push(
    "App Store Connect Apple ID is not pinned at submit.production.ios.ascAppId",
  );
} else {
  warnings.push(
    "App Store Connect Apple ID remains an external gate; rerun with --release after it is pinned",
  );
}

if (strictRelease) {
  assertTracked(".easignore");
  assertTracked(".npmrc");
  assertTracked(".github/workflows/ci.yml");
  assertTracked("apps/mobile/app.json");
  assertTracked("apps/mobile/eas.json");
  assertTracked("apps/mobile/package.json");
  assertTracked("packages/core/package.json");
  assertTracked("docs/mobile-expo.md");
  assertTracked("docs/mobile-testflight-checklist.md");
  assertTracked("pnpm-lock.yaml");
  try {
    const scopedStatus = execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "--",
        ".easignore",
        ".npmrc",
        ".github/workflows/ci.yml",
        "apps/mobile",
        "docs/mobile-expo.md",
        "docs/mobile-testflight-checklist.md",
        "packages/core/package.json",
        "pnpm-lock.yaml",
      ],
      { cwd: repositoryDirectory, encoding: "utf8" },
    ).trim();
    check(!scopedStatus, "Mobile release scope is clean in Git");
  } catch (error) {
    failures.push(
      `Could not inspect Git release scope: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

for (const message of passes) console.log(`[ok] ${message}`);
for (const message of warnings) console.warn(`[external] ${message}`);
for (const message of failures) console.error(`[fail] ${message}`);

if (failures.length) process.exitCode = 1;
else
  console.log(
    `TestFlight ${strictRelease ? "release" : "source"} configuration gate passed.`,
  );

function check(condition, message) {
  if (condition) passes.push(message);
  else failures.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(join(appDirectory, path), "utf8"));
}

function inspectPng(path) {
  if (typeof path !== "string" || !path)
    throw new Error("PNG path is missing from app config.");
  const bytes = readFileSync(resolve(appDirectory, path));
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    throw new Error(`${path} is not a PNG file.`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  };
}

function assertTracked(path) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", path], {
      cwd: repositoryDirectory,
      stdio: "ignore",
    });
    passes.push(
      `${relative(repositoryDirectory, resolve(repositoryDirectory, path))} is tracked`,
    );
  } catch {
    failures.push(`${path} is not tracked in Git`);
  }
}
