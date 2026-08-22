import assert from "node:assert/strict";
import test from "node:test";

import {
  makeBridgeBootstrapScript,
  makeBridgeExecutionScript,
  makeBridgeProbeScript,
  makeViewerRequest,
  parseViewerSurfaceMessage,
} from "./viewer-bridge";

test("viewer messages validate known bridge shapes", () => {
  assert.deepEqual(
    parseViewerSurfaceMessage(
      JSON.stringify({
        type: "status",
        status: { ready: true, toolCount: 29 },
      }),
    ),
    { type: "status", status: { ready: true, toolCount: 29 } },
  );
  assert.equal(parseViewerSurfaceMessage("{not-json"), null);
  assert.equal(
    parseViewerSurfaceMessage(JSON.stringify({ type: "status", status: {} })),
    null,
  );
  assert.deepEqual(
    parseViewerSurfaceMessage(
      JSON.stringify({
        type: "probe",
        id: "resume-1",
        status: { ready: false },
      }),
    ),
    { type: "probe", id: "resume-1", status: { ready: false } },
  );
  assert.deepEqual(
    parseViewerSurfaceMessage(
      JSON.stringify({
        type: "error",
        source: "web-runtime",
        message: "Maximum update depth exceeded.",
        stack: "at ViewerApp",
      }),
    ),
    {
      type: "error",
      source: "web-runtime",
      message: "Maximum update depth exceeded.",
      stack: "at ViewerApp",
    },
  );
  assert.deepEqual(
    parseViewerSurfaceMessage(
      JSON.stringify({
        documentEpoch: 4,
        type: "status",
        status: { ready: true },
      }),
    ),
    { documentEpoch: 4, type: "status", status: { ready: true } },
  );
  assert.equal(
    parseViewerSurfaceMessage(
      JSON.stringify({
        documentEpoch: -1,
        type: "status",
        status: { ready: true },
      }),
    ),
    null,
  );
});

test("bootstrap forwards synchronous and rejected web runtime failures with diagnostics", () => {
  const script = makeBridgeBootstrapScript(7);
  assert.match(script, /source: 'web-runtime'/);
  assert.match(script, /unhandledrejection/);
  assert.match(script, /error\.stack/);
  assert.match(script, /documentEpoch = 7/);
  assert.match(script, /documentEpoch: documentEpoch/);
});

test("probe scripts preserve request and document correlation without running a tool", () => {
  const script = makeBridgeProbeScript("resume-1", 8);
  assert.match(script, /resume-1/);
  assert.match(script, /type: 'probe'/);
  assert.match(script, /bridge\.status/);
  assert.doesNotMatch(script, /bridge\.execute/);
  assert.match(script, /documentEpoch = 8/);
});

test("execution scripts preserve request identity and escape markup", () => {
  const request = makeViewerRequest("lupi.add_annotation", {
    text: "</script><b>active</b>",
    atomIndex: 2,
  });
  const script = makeBridgeExecutionScript(request, 9);

  assert.match(script, new RegExp(request.id));
  assert.match(script, /lupi\.add_annotation/);
  assert.doesNotMatch(script, /<\/script>/i);
  assert.match(script, /\\u003c/);
  assert.match(script, /toolNames/);
  assert.match(script, /documentEpoch = 9/);
});

test("same-tool requests keep distinct correlation ids within one clock tick", () => {
  const first = makeViewerRequest("lupi.generate_molecule");
  const second = makeViewerRequest("lupi.generate_molecule");
  assert.notEqual(first.id, second.id);
});
