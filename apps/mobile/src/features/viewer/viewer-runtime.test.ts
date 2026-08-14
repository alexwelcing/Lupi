import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyViewerRuntimeError,
  isViewerMessageFromActiveDocument,
  makeViewerDocumentUrl,
} from "./viewer-runtime";

test("recovers once from React update-depth failures without showing implementation text", () => {
  const first = classifyViewerRuntimeError(
    "Minified React error #185; visit https://react.dev/errors/185",
    0,
  );
  assert.equal(first.autoReload, true);
  assert.equal(
    first.userMessage,
    "The molecular viewer restarted after a rendering problem.",
  );
  assert.match(first.diagnosticMessage, /#185/);

  const repeated = classifyViewerRuntimeError(
    "Maximum update depth exceeded.",
    1,
  );
  assert.equal(repeated.autoReload, false);
  assert.match(repeated.userMessage, /could not recover/);
});

test("preserves ordinary runtime failures for actionable display", () => {
  assert.deepEqual(
    classifyViewerRuntimeError("WebGL context unavailable.", 0),
    {
      autoReload: false,
      diagnosticMessage: "WebGL context unavailable.",
      userMessage: "WebGL context unavailable.",
    },
  );
});

test("adds stable client identity and a monotonic hard-reload key before the hash route", () => {
  assert.equal(
    makeViewerDocumentUrl("https://lupi.live/?load#/embed/mobile", "abc123", 2),
    "https://lupi.live/?load=&lupiNativeBuild=abc123&lupiReload=2#/embed/mobile",
  );
  assert.equal(
    makeViewerDocumentUrl(
      "https://lupi.live/?load#/embed/mobile",
      undefined,
      0,
    ),
    "https://lupi.live/?load#/embed/mobile",
  );
});

test("accepts only messages stamped by the active WebView document epoch", () => {
  assert.equal(isViewerMessageFromActiveDocument(3, 3), true);
  assert.equal(isViewerMessageFromActiveDocument(2, 3), false);
  assert.equal(isViewerMessageFromActiveDocument(undefined, 3), false);
  assert.equal(isViewerMessageFromActiveDocument(4, 3), false);
});
