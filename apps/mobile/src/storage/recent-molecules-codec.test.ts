import assert from "node:assert/strict";
import test from "node:test";

import { STARTER_MOLECULES } from "@/src/domain/molecules";

import {
  decodeRecentMolecules,
  nextRecentMolecules,
} from "./recent-molecules-codec";

test("corrupt and stale persisted values fail closed", () => {
  assert.deepEqual(decodeRecentMolecules("{bad-json"), []);
  assert.deepEqual(decodeRecentMolecules('[null,{"id":"broken"}]'), []);
  const caffeine = STARTER_MOLECULES[0];
  assert.ok(caffeine);
  assert.deepEqual(
    decodeRecentMolecules(
      JSON.stringify([
        {
          ...caffeine,
          name: "x".repeat(161),
        },
      ]),
    ),
    [],
  );
  assert.deepEqual(
    decodeRecentMolecules(
      JSON.stringify([
        {
          ...caffeine,
          tags: ["x".repeat(49)],
        },
      ]),
    ),
    [],
  );
  assert.deepEqual(
    decodeRecentMolecules(
      JSON.stringify([
        {
          id: "spoofed-id",
          name: "Spoofed Gallery Record",
          formula: "H2O",
          tags: ["gallery"],
          load: { inputType: "gallery", input: "water", atomCount: 3 },
        },
      ]),
    ),
    [],
  );
});

test("valid recent molecules survive decode and remain de-duplicated", () => {
  const caffeine = STARTER_MOLECULES[0];
  assert.ok(caffeine);
  assert.deepEqual(
    decodeRecentMolecules(JSON.stringify([caffeine, caffeine])),
    [caffeine],
  );
  assert.deepEqual(nextRecentMolecules([caffeine], caffeine), [caffeine]);
});

test("curated gallery references persist without storing remote source URLs", () => {
  const gallery = {
    id: "c60_buckyball",
    name: "Buckminsterfullerene",
    formula: "C60",
    tags: ["Nanomaterials"],
    load: { inputType: "gallery", input: "c60_buckyball", atomCount: 60 },
  };
  assert.deepEqual(decodeRecentMolecules(JSON.stringify([gallery])), [gallery]);
});
