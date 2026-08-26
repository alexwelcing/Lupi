import assert from "node:assert/strict";
import test from "node:test";

import { STARTER_MOLECULES } from "@/src/domain/molecules";

import { buildLibrarySections } from "./library-sections";

test("library contains recent molecular content only", () => {
  const caffeine = STARTER_MOLECULES[0];
  assert.ok(caffeine);

  const sections = buildLibrarySections({
    status: "ready",
    molecules: [caffeine],
  });
  assert.deepEqual(
    sections.map((section) => section.id),
    ["recents"],
  );
  assert.deepEqual(
    sections[0]?.data.map((item) => item.kind),
    ["recent"],
  );
  assert.equal(sections[0]?.data[0]?.id, `recent:${caffeine.id}`);
});

test("library distinguishes loading, empty, and unavailable history", () => {
  assert.equal(
    buildLibrarySections({ status: "loading" })[0]?.data[0]?.kind,
    "loading",
  );
  assert.equal(
    buildLibrarySections({ status: "ready", molecules: [] })[0]?.data[0]?.kind,
    "empty",
  );

  const failed = buildLibrarySections({
    status: "error",
    message: "Recent structures are unavailable.",
  });
  assert.deepEqual(failed[0]?.data, [
    {
      kind: "history-error",
      id: "history-error",
      message: "Recent structures are unavailable.",
    },
  ]);
});
