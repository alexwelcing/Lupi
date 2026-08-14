import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const checker = resolve(process.cwd(), "scripts/check-expo-dependencies.mjs");

test("accepts the installed Expo SDK dependency map", () => {
  const result = spawnSync(process.execPath, [checker], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Expo dependency compatibility passed/);
});

test("rejects an installed version outside the Expo SDK dependency map", () => {
  const result = spawnSync(process.execPath, [checker], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      LUPI_EXPO_DEPENDENCY_TEST_OVERRIDE: "expo-constants@0.0.0",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /expo-constants@0\.0\.0 - expected/);
});
