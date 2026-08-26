import assert from "node:assert/strict";
import test from "node:test";

import {
  VIEWER_AR_EXPORT_TOOL,
  consumeViewerArExportResponse,
  type PendingViewerArExport,
} from "./viewer-ar-handoff";

const pending: PendingViewerArExport = {
  id: "ar-request-1",
  metadata: {
    expectedAtomCount: 1,
    moleculeKey: "template:Hydrogen",
    name: "Hydrogen",
  },
  moleculeKey: "template:Hydrogen",
};

test("correlates a successful XYZ response to the active molecule", () => {
  const result = consumeViewerArExportResponse(
    pending,
    {
      id: pending.id,
      ok: true,
      result: { export: { contents: "1\nHydrogen\nH 0 0 0", format: "xyz" } },
      tool: VIEWER_AR_EXPORT_TOOL,
    },
    pending.moleculeKey,
  );

  assert.equal(result.matched, true);
  assert.equal(result.pending, null);
  assert.equal(result.matched && result.scene?.molecule.atomCount, 1);
});

test("ignores an unrelated response without consuming the pending request", () => {
  const result = consumeViewerArExportResponse(
    pending,
    { id: "another-request", ok: true, tool: VIEWER_AR_EXPORT_TOOL },
    pending.moleculeKey,
  );
  assert.deepEqual(result, { matched: false, pending });
});

test("consumes stale-molecule and wrong-tool responses without launching AR", () => {
  const stale = consumeViewerArExportResponse(
    pending,
    { id: pending.id, ok: true, tool: VIEWER_AR_EXPORT_TOOL },
    "template:Water",
  );
  assert.deepEqual(stale, { matched: false, pending: null });

  const wrongTool = consumeViewerArExportResponse(
    pending,
    { id: pending.id, ok: true, tool: "lupi.viewer_state" },
    pending.moleculeKey,
  );
  assert.deepEqual(wrongTool, { matched: false, pending: null });
});

test("surfaces bridge and malformed-export failures without an AR scene", () => {
  const bridgeFailure = consumeViewerArExportResponse(
    pending,
    {
      error: { message: "Unknown element mapping" },
      id: pending.id,
      ok: false,
      tool: VIEWER_AR_EXPORT_TOOL,
    },
    pending.moleculeKey,
  );
  assert.equal(
    bridgeFailure.matched && bridgeFailure.errorMessage,
    "Unknown element mapping",
  );

  const malformed = consumeViewerArExportResponse(
    pending,
    { id: pending.id, ok: true, result: {}, tool: VIEWER_AR_EXPORT_TOOL },
    pending.moleculeKey,
  );
  assert.match(
    malformed.matched ? (malformed.errorMessage ?? "") : "",
    /valid XYZ frame/,
  );
});
