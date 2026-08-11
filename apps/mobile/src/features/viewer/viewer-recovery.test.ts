import assert from "node:assert/strict";
import test from "node:test";

import {
  contentProcessTerminationMessages,
  shouldProbeViewerOnAppStateChange,
  VIEWER_PROCESS_TERMINATED_MESSAGE,
} from "./viewer-recovery";

test("content-process termination clears readiness before reporting recovery", () => {
  assert.deepEqual(contentProcessTerminationMessages(), [
    { type: "status", status: { ready: false, moleculeLoaded: false } },
    { type: "error", message: VIEWER_PROCESS_TERMINATED_MESSAGE },
  ]);
});

test("the viewer is probed only when the app returns to the foreground", () => {
  assert.equal(shouldProbeViewerOnAppStateChange("background", "active"), true);
  assert.equal(shouldProbeViewerOnAppStateChange("inactive", "active"), true);
  assert.equal(shouldProbeViewerOnAppStateChange("active", "active"), false);
  assert.equal(
    shouldProbeViewerOnAppStateChange("active", "background"),
    false,
  );
});
