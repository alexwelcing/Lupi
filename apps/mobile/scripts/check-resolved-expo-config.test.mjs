import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EXPECTED_APP_VERSION,
  EXPECTED_IOS_BUNDLE_IDENTIFIER,
  EXPECTED_IOS_DEPLOYMENT_TARGET,
  EXPECTED_RUNTIME_VERSION_POLICY,
  inspectResolvedProductionConfig,
  inspectResolvedRuntimeVersion,
} from "./check-resolved-expo-config.mjs";

test("accepts the intended camera-only production configuration", () => {
  const result = inspectResolvedProductionConfig(makeConfig());

  assert.deepEqual(result.failures, []);
  assert.equal(result.passes.length, 6);
});

test("rejects a changed app version or runtime policy", () => {
  for (const overrides of [
    { version: "1.0.0" },
    { runtimeVersion: { policy: "fingerprint" } },
    { runtimeVersion: "1.0.1" },
  ]) {
    const result = inspectResolvedProductionConfig(makeConfig(overrides));

    assert.match(
      result.failures.join("\n"),
      /app version is 1\.0\.1|runtime policy is appVersion/u,
    );
  }
});

test("rejects an iOS runtime override that bypasses appVersion", () => {
  const config = makeConfig();
  config.ios.runtimeVersion = { policy: "fingerprint" };

  const result = inspectResolvedProductionConfig(config);
  assert.match(result.failures.join("\n"), /runtime policy is appVersion/u);
});

test("accepts only the deterministic managed app-version runtime", () => {
  const accepted = inspectResolvedRuntimeVersion({
    runtimeVersion: "1.0.1",
    workflow: "managed",
    fingerprintSources: null,
  });
  assert.deepEqual(accepted.failures, []);

  for (const fixture of [
    { runtimeVersion: "1.0.0", workflow: "managed", fingerprintSources: null },
    { runtimeVersion: "1.0.1", workflow: "generic", fingerprintSources: null },
    { runtimeVersion: "1.0.1", workflow: "managed", fingerprintSources: [] },
  ]) {
    assert.notEqual(inspectResolvedRuntimeVersion(fixture).failures.length, 0);
  }
});

test("rejects a missing or incorrect deployment target", () => {
  for (const deploymentTarget of [undefined, "17.5", "18.0"]) {
    const result = inspectResolvedProductionConfig(
      makeConfig({ deploymentTarget }),
    );

    assert.match(result.failures.join("\n"), /deployment target is 17\.6/u);
  }
});

test("rejects a non-production bundle identifier", () => {
  const result = inspectResolvedProductionConfig(
    makeConfig({ bundleIdentifier: "live.lupi.app.dev" }),
  );

  assert.match(
    result.failures.join("\n"),
    /bundle identifier is live\.lupi\.app/u,
  );
});

test("rejects a missing or blank camera usage description", () => {
  for (const cameraUsageDescription of [undefined, "", "   "]) {
    const config = makeConfig();
    config.ios.infoPlist.NSCameraUsageDescription = cameraUsageDescription;
    const result = inspectResolvedProductionConfig(config);

    assert.match(result.failures.join("\n"), /camera usage description/u);
  }
});

test("rejects microphone, photo, and location permission declarations", () => {
  for (const forbiddenKey of [
    "NSMicrophoneUsageDescription",
    "NSPhotoLibraryUsageDescription",
    "NSPhotoLibraryAddUsageDescription",
    "NSLocationWhenInUseUsageDescription",
    "NSLocationAlwaysUsageDescription",
    "NSLocationAlwaysAndWhenInUseUsageDescription",
    "NSLocationTemporaryUsageDescriptionDictionary",
  ]) {
    const config = makeConfig();
    config.ios.infoPlist[forbiddenKey] = "Forbidden fixture";
    const result = inspectResolvedProductionConfig(config);

    assert.match(result.failures.join("\n"), new RegExp(forbiddenKey, "u"));
  }
});

test("rejects the location background mode", () => {
  const config = makeConfig();
  config.ios.infoPlist.UIBackgroundModes = ["location"];
  const result = inspectResolvedProductionConfig(config);

  assert.match(result.failures.join("\n"), /UIBackgroundModes:location/u);
});

function makeConfig(overrides = {}) {
  return {
    version: overrides.version ?? EXPECTED_APP_VERSION,
    runtimeVersion: overrides.runtimeVersion ?? {
      policy: EXPECTED_RUNTIME_VERSION_POLICY,
    },
    ios: {
      bundleIdentifier:
        overrides.bundleIdentifier ?? EXPECTED_IOS_BUNDLE_IDENTIFIER,
      deploymentTarget:
        "deploymentTarget" in overrides
          ? overrides.deploymentTarget
          : EXPECTED_IOS_DEPLOYMENT_TARGET,
      infoPlist: {
        NSCameraUsageDescription: "Use the camera for room-scale AR.",
      },
    },
  };
}
