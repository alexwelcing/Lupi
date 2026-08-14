import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPO_GO_EXECUTION_ENVIRONMENT,
  canEnterNativeArRoute,
} from "./ar-build-policy";

test("native AR fails closed in Expo Go", () => {
  assert.equal(canEnterNativeArRoute(EXPO_GO_EXECUTION_ENVIRONMENT), false);
});

test("native AR remains available in standalone and bare development builds", () => {
  assert.equal(canEnterNativeArRoute("standalone"), true);
  assert.equal(canEnterNativeArRoute("bare"), true);
});

test("web and static render environments can use the platform fallback", () => {
  assert.equal(canEnterNativeArRoute(undefined), true);
  assert.equal(canEnterNativeArRoute(null), true);
});
