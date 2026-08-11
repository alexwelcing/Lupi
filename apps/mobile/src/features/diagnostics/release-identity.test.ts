import assert from "node:assert/strict";
import test from "node:test";

import {
  diagnosticReport,
  parseRemoteHealthIdentity,
  readProjectId,
  readReleaseMetadata,
  softWrapDiagnosticValue,
} from "./release-identity";

test("reads only string release metadata from Expo extra", () => {
  assert.deepEqual(
    readReleaseMetadata({
      release: {
        buildProfile: "production",
        easBuildId: "build-1",
        gitCommit: "abc123",
      },
    }),
    { buildProfile: "production", easBuildId: "build-1", gitCommit: "abc123" },
  );
  assert.deepEqual(readReleaseMetadata({ release: { gitCommit: 123 } }), {});
  assert.equal(readProjectId({ eas: { projectId: "project-1" } }), "project-1");
});

test("adds invisible wrap opportunities without changing a copied report value", () => {
  const value = "38c55c8d-b7dc-4bec-ab5e-1809eda6bf9d";
  assert.equal(softWrapDiagnosticValue(value).replaceAll("\u200B", ""), value);
  assert.match(softWrapDiagnosticValue(value), /\u200B/);
});

test("normalizes the public Worker health identity without copying bindings", () => {
  assert.deepEqual(
    parseRemoteHealthIdentity({
      ready: true,
      name: "lupi-cloudflare-edge",
      version: "1.2.3",
      toolCount: 7,
      release: {
        id: "worker-1",
        tag: "abc123",
        timestamp: "2026-08-09T00:00:00Z",
      },
      bindings: { rendererToken: false },
    }),
    {
      name: "lupi-cloudflare-edge",
      version: "1.2.3",
      toolCount: 7,
      releaseId: "worker-1",
      releaseTag: "abc123",
      releaseTimestamp: "2026-08-09T00:00:00Z",
    },
  );
  assert.equal(parseRemoteHealthIdentity({ ready: false }), null);
});

test("builds a selectable tester report", () => {
  assert.equal(
    diagnosticReport([
      { label: "Version", value: "1.0.0 (1)" },
      { label: "Origin", value: "https://lupi.live" },
    ]),
    "Lupi iPhone diagnostics\nVersion: 1.0.0 (1)\nOrigin: https://lupi.live",
  );
});
