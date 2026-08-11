import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromApp = createRequire(join(appDirectory, "package.json"));

export const EXPECTED_IOS_BUNDLE_IDENTIFIER = "live.lupi.app";
export const EXPECTED_IOS_DEPLOYMENT_TARGET = "17.6";

/**
 * Resolve the production Expo configuration after native config plugins have
 * evaluated their iOS mods, using this checkout's installed Expo CLI only.
 */
export function resolveProductionExpoConfig() {
  const expoCliPath = requireFromApp.resolve("expo/bin/cli");
  const result = spawnSync(
    process.execPath,
    [expoCliPath, "config", "--type", "introspect", "--json"],
    {
      cwd: appDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        APP_VARIANT: "production",
        CI: "1",
        EAS_BUILD_PROFILE: "production",
        EAS_BUILD_PLATFORM: "ios",
        EXPO_OFFLINE: "1",
        EXPO_PUBLIC_VISUAL_QA: "0",
        NO_COLOR: "1",
      },
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `Expo config resolution exited with status ${result.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Expo config resolution did not return JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function inspectResolvedProductionConfig(config) {
  const failures = [];
  const passes = [];
  const ios = isRecord(config?.ios) ? config.ios : {};
  const infoPlist = isRecord(ios.infoPlist) ? ios.infoPlist : {};

  check(
    ios.bundleIdentifier === EXPECTED_IOS_BUNDLE_IDENTIFIER,
    `Resolved production bundle identifier is ${EXPECTED_IOS_BUNDLE_IDENTIFIER}`,
  );
  check(
    ios.deploymentTarget === EXPECTED_IOS_DEPLOYMENT_TARGET,
    `Resolved production iOS deployment target is ${EXPECTED_IOS_DEPLOYMENT_TARGET}`,
  );
  check(
    typeof infoPlist.NSCameraUsageDescription === "string" &&
      infoPlist.NSCameraUsageDescription.trim().length > 0,
    "Resolved production Info.plist contains a camera usage description",
  );

  const forbiddenUsageKeys = Object.keys(infoPlist).filter((key) =>
    /^NS(?:Location|Microphone|PhotoLibrary)/u.test(key),
  );
  const backgroundModes = Array.isArray(infoPlist.UIBackgroundModes)
    ? infoPlist.UIBackgroundModes
    : [];
  const hasLocationBackgroundMode = backgroundModes.includes("location");

  if (forbiddenUsageKeys.length === 0 && !hasLocationBackgroundMode) {
    passes.push(
      "Resolved production Info.plist requests no microphone, photo, or location access",
    );
  } else {
    const forbiddenEntries = [
      ...forbiddenUsageKeys,
      ...(hasLocationBackgroundMode ? ["UIBackgroundModes:location"] : []),
    ];
    failures.push(
      `Resolved production Info.plist contains forbidden mobile permissions: ${forbiddenEntries.join(", ")}`,
    );
  }

  return { failures, passes };

  function check(condition, message) {
    if (condition) passes.push(message);
    else failures.push(message);
  }
}

if (isMainModule()) {
  try {
    const result = inspectResolvedProductionConfig(
      resolveProductionExpoConfig(),
    );
    for (const message of result.passes) console.log(`[ok] ${message}`);
    for (const message of result.failures) console.error(`[fail] ${message}`);

    if (result.failures.length > 0) process.exitCode = 1;
    else console.log("Resolved production Expo configuration gate passed.");
  } catch (error) {
    console.error(
      `[fail] Could not resolve production Expo configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

function isMainModule() {
  return process.argv[1]
    ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
