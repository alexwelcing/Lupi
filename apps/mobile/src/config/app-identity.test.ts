import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVELOPMENT_APP_ID,
  PRODUCTION_APP_ID,
  resolveLupiAppIdentity,
} from "../../app.config";

test("production identity is the fail-closed default", () => {
  assert.deepEqual(resolveLupiAppIdentity(undefined), {
    androidPackage: PRODUCTION_APP_ID,
    iosBundleIdentifier: PRODUCTION_APP_ID,
    name: "Lupi",
    scheme: "lupi",
    variant: "production",
  });
});

test("development identity installs alongside production", () => {
  assert.deepEqual(resolveLupiAppIdentity("development"), {
    androidPackage: DEVELOPMENT_APP_ID,
    iosBundleIdentifier: DEVELOPMENT_APP_ID,
    name: "Lupi Dev",
    scheme: "lupi-dev",
    variant: "development",
  });
});

test("unknown variants fail instead of silently using production identity", () => {
  assert.throws(
    () => resolveLupiAppIdentity("preview-typo"),
    /Unsupported APP_VARIANT/,
  );
});
