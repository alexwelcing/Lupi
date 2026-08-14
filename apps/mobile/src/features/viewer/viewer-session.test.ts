import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmedMoleculeLoadedAfterStatus,
  consumeInitialViewerMessage,
  consumeInitialViewerResponse,
  consumeInitialViewerTimeout,
  executionKeyAfterStatus,
  HISTORY_PERSISTENCE_WARNING,
  INITIAL_VIEWER_COMMAND_TIMEOUT_MS,
  initialViewerCommand,
  isResponseForTimedOutInitialRequest,
  persistLoadedMoleculeSummary,
  shouldAttemptHistoryPersistence,
  shouldExecuteInitialMolecule,
  type PendingInitialViewerRequest,
} from "./viewer-session";
import { MOBILE_MAX_ATOMS, type MoleculeSummary } from "@/src/domain/molecules";

const CAFFEINE: MoleculeSummary = {
  id: "caffeine",
  name: "Caffeine",
  formula: "C8H10N4O2",
  tags: ["organic"],
  load: { inputType: "template", input: "Caffeine" },
};

test("maps gallery entries to the canonical gallery bridge command", () => {
  assert.deepEqual(
    initialViewerCommand({
      inputType: "gallery",
      input: "c60_buckyball",
      atomCount: 60,
    }),
    {
      tool: "lupi.open_gallery_example",
      arguments: {
        id: "c60_buckyball",
        expectedAtomCount: 60,
        maxAtomCount: MOBILE_MAX_ATOMS,
      },
    },
  );
});

test("keeps generated molecule inputs on the generator bridge command", () => {
  assert.deepEqual(
    initialViewerCommand({ inputType: "template", input: "Caffeine" }),
    {
      tool: "lupi.generate_molecule",
      arguments: { inputType: "template", input: "Caffeine" },
    },
  );
});

test("a full viewer reload clears the execution key and replays the selected molecule", () => {
  const moleculeKey = "template:8:caffeine";
  let executionKey: string | null = moleculeKey;

  executionKey = executionKeyAfterStatus(executionKey, { ready: false });
  assert.equal(executionKey, null);
  assert.equal(
    shouldExecuteInitialMolecule({
      bridgeReady: true,
      executionKey,
      hasSavedView: false,
      moleculeKey,
    }),
    true,
  );
});

test("saved views and an already-executed molecule are not replayed", () => {
  const moleculeKey = "template:8:caffeine";
  assert.equal(
    shouldExecuteInitialMolecule({
      bridgeReady: true,
      executionKey: null,
      hasSavedView: true,
      moleculeKey,
    }),
    false,
  );
  assert.equal(
    shouldExecuteInitialMolecule({
      bridgeReady: true,
      executionKey: moleculeKey,
      hasSavedView: false,
      moleculeKey,
    }),
    false,
  );
});

test("only the correlated successful initial response releases one summary for history", () => {
  const pending: PendingInitialViewerRequest = {
    id: "initial-1",
    moleculeKey: "template:8:caffeine",
    summary: CAFFEINE,
    tool: "lupi.generate_molecule",
  };

  const unrelated = consumeInitialViewerResponse(
    pending,
    {
      id: "other",
      ok: true,
      tool: "lupi.generate_molecule",
    },
    pending.moleculeKey,
  );
  assert.equal(unrelated.matched, false);
  assert.equal(unrelated.pending, pending);
  assert.equal(unrelated.summary, undefined);

  const failed = consumeInitialViewerResponse(
    pending,
    {
      error: { message: "load failed" },
      id: "initial-1",
      ok: false,
      tool: "lupi.generate_molecule",
    },
    pending.moleculeKey,
  );
  assert.equal(failed.matched, true);
  assert.equal(failed.pending, null);
  assert.equal(failed.succeeded, false);
  assert.equal(failed.summary, undefined);

  const succeeded = consumeInitialViewerResponse(
    pending,
    {
      id: "initial-1",
      ok: true,
      tool: "lupi.generate_molecule",
    },
    pending.moleculeKey,
  );
  assert.deepEqual(succeeded.summary, CAFFEINE);
  assert.equal(succeeded.pending, null);
  assert.equal(succeeded.succeeded, true);

  const duplicate = consumeInitialViewerResponse(
    succeeded.pending,
    {
      id: "initial-1",
      ok: true,
      tool: "lupi.generate_molecule",
    },
    pending.moleculeKey,
  );
  assert.equal(duplicate.matched, false);
  assert.equal(duplicate.summary, undefined);
});

test("a loaded status message cannot release a summary for history", () => {
  const pending: PendingInitialViewerRequest = {
    id: "initial-1",
    moleculeKey: "template:8:caffeine",
    summary: CAFFEINE,
    tool: "lupi.generate_molecule",
  };
  const resolution = consumeInitialViewerMessage(
    pending,
    {
      status: { moleculeLoaded: true, ready: true },
      type: "status",
    },
    pending.moleculeKey,
  );
  assert.equal(resolution.matched, false);
  assert.equal(resolution.pending, pending);
  assert.equal(resolution.summary, undefined);
});

test("status can demote a confirmed load but cannot promote an uncorrelated molecule", () => {
  assert.equal(
    confirmedMoleculeLoadedAfterStatus(false, {
      atomCount: 21,
      moleculeLoaded: true,
      ready: true,
    }),
    false,
  );
  assert.equal(
    confirmedMoleculeLoadedAfterStatus(true, {
      atomCount: 21,
      moleculeLoaded: true,
      ready: true,
    }),
    true,
  );
  assert.equal(
    confirmedMoleculeLoadedAfterStatus(true, {
      moleculeLoaded: false,
      ready: true,
    }),
    false,
  );
  assert.equal(
    confirmedMoleculeLoadedAfterStatus(true, { ready: false }),
    false,
  );
});

test("the initial command timeout is bounded and consumes only the active correlated request", () => {
  assert.ok(INITIAL_VIEWER_COMMAND_TIMEOUT_MS >= 5_000);
  assert.ok(INITIAL_VIEWER_COMMAND_TIMEOUT_MS <= 30_000);
  const pending: PendingInitialViewerRequest = {
    id: "initial-1",
    moleculeKey: "template:8:caffeine",
    summary: CAFFEINE,
    tool: "lupi.generate_molecule",
  };

  assert.deepEqual(
    consumeInitialViewerTimeout(pending, pending.id, pending.moleculeKey),
    { pending: null, timedOut: true },
  );
  assert.deepEqual(
    consumeInitialViewerTimeout(pending, "newer-request", pending.moleculeKey),
    { pending, timedOut: false },
  );
  assert.deepEqual(
    consumeInitialViewerTimeout(pending, pending.id, "template:5:water"),
    { pending, timedOut: false },
  );
  assert.equal(
    isResponseForTimedOutInitialRequest(
      {
        id: pending.id,
        ok: true,
        tool: pending.tool,
      },
      pending.id,
    ),
    true,
  );
  assert.equal(
    isResponseForTimedOutInitialRequest(
      {
        id: "newer-request",
        ok: true,
        tool: pending.tool,
      },
      pending.id,
    ),
    false,
  );
});

test("an id match with the wrong bridge tool fails closed", () => {
  const resolution = consumeInitialViewerResponse(
    {
      id: "initial-1",
      moleculeKey: "template:8:caffeine",
      summary: CAFFEINE,
      tool: "lupi.generate_molecule",
    },
    {
      id: "initial-1",
      ok: true,
      tool: "lupi.open_gallery_example",
    },
    "template:8:caffeine",
  );
  assert.equal(resolution.matched, true);
  assert.equal(resolution.succeeded, false);
  assert.equal(resolution.summary, undefined);
  assert.match(resolution.errorMessage ?? "", /invalid response/i);
});

test("a response pending for a previous molecule cannot release its summary", () => {
  const resolution = consumeInitialViewerResponse(
    {
      id: "initial-1",
      moleculeKey: "template:8:caffeine",
      summary: CAFFEINE,
      tool: "lupi.generate_molecule",
    },
    {
      id: "initial-1",
      ok: true,
      tool: "lupi.generate_molecule",
    },
    "template:5:water",
  );
  assert.equal(resolution.matched, false);
  assert.equal(resolution.pending, null);
  assert.equal(resolution.summary, undefined);
});

test("history persistence is attempted once and resolves failures to a nonfatal warning", async () => {
  let attempts = 0;
  const warning = await persistLoadedMoleculeSummary(CAFFEINE, async () => {
    attempts += 1;
    throw new Error("storage unavailable");
  });
  assert.equal(attempts, 1);
  assert.equal(warning, HISTORY_PERSISTENCE_WARNING);

  const success = await persistLoadedMoleculeSummary(CAFFEINE, async () => {
    attempts += 1;
  });
  assert.equal(attempts, 2);
  assert.equal(success, null);
});

test("history persistence is attempted at most once per active molecule identity", () => {
  let attemptedMoleculeKey: string | null = null;
  const caffeineKey = "template:8:caffeine";
  assert.equal(
    shouldAttemptHistoryPersistence(
      attemptedMoleculeKey,
      caffeineKey,
      CAFFEINE,
    ),
    true,
  );
  attemptedMoleculeKey = caffeineKey;
  assert.equal(
    shouldAttemptHistoryPersistence(
      attemptedMoleculeKey,
      caffeineKey,
      CAFFEINE,
    ),
    false,
  );
  assert.equal(
    shouldAttemptHistoryPersistence(
      attemptedMoleculeKey,
      "template:5:water",
      CAFFEINE,
    ),
    true,
  );
  assert.equal(
    shouldAttemptHistoryPersistence(null, caffeineKey, undefined),
    false,
  );
});
