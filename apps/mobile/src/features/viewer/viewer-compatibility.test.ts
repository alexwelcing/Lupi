import assert from "node:assert/strict";
import test from "node:test";

import {
  checkViewerCompatibility,
  GALLERY_VIEWER_TOOL,
  isSupportedViewerBridgeVersion,
  REQUIRED_VIEWER_TOOLS,
} from "./viewer-compatibility";

test("accepts the supported bridge major with every required mobile tool", () => {
  assert.deepEqual(
    checkViewerCompatibility({
      ready: true,
      version: "0.3.0",
      toolCount: 29,
      toolNames: [...REQUIRED_VIEWER_TOOLS, "lupi.status"],
    }),
    { compatible: true },
  );
});

test("accepts the current dated production bridge contract", () => {
  assert.equal(isSupportedViewerBridgeVersion("2026-07-07.asset-export"), true);
  assert.deepEqual(
    checkViewerCompatibility({
      ready: true,
      version: "2026-07-07.asset-export",
      toolCount: 29,
      toolNames: [...REQUIRED_VIEWER_TOOLS, "lupi.status"],
    }),
    { compatible: true },
  );
});

test("fails closed on unsupported or stale bridge versions", () => {
  assert.equal(
    isSupportedViewerBridgeVersion("2026-07-06.asset-export"),
    false,
  );
  assert.equal(
    isSupportedViewerBridgeVersion("2026-99-99.asset-export"),
    false,
  );
  assert.equal(
    isSupportedViewerBridgeVersion("2099-01-01.breaking-contract"),
    false,
  );
  assert.equal(
    isSupportedViewerBridgeVersion("2026-07-07.asset-export.v2"),
    false,
  );
  const result = checkViewerCompatibility({
    ready: true,
    version: "1.0.0",
    toolNames: [...REQUIRED_VIEWER_TOOLS],
  });
  assert.equal(result.compatible, false);
  assert.match(
    result.message ?? "",
    /expected legacy v0\.x or a dated asset-export release/,
  );
});

test("fails closed when the live viewer is missing a required tool", () => {
  const result = checkViewerCompatibility({
    ready: true,
    version: "0.3.0",
    toolNames: REQUIRED_VIEWER_TOOLS.filter(
      (tool) => tool !== "lupi.encode_view_url",
    ),
  });
  assert.equal(result.compatible, false);
  assert.match(result.message ?? "", /lupi\.encode_view_url/);
});

test("requires the optional gallery command only for gallery loads", () => {
  const status = {
    ready: true,
    version: "2026-07-07.asset-export",
    toolNames: [...REQUIRED_VIEWER_TOOLS],
  };
  assert.deepEqual(checkViewerCompatibility(status), { compatible: true });

  const missing = checkViewerCompatibility(status, [GALLERY_VIEWER_TOOL]);
  assert.equal(missing.compatible, false);
  assert.match(missing.message ?? "", /lupi\.open_gallery_example/);

  assert.deepEqual(
    checkViewerCompatibility(
      {
        ...status,
        toolNames: [...status.toolNames, GALLERY_VIEWER_TOOL],
      },
      [GALLERY_VIEWER_TOOL],
    ),
    { compatible: true },
  );
});
