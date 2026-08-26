import assert from "node:assert/strict";
import test from "node:test";

import { STARTER_MOLECULES } from "@/src/domain/molecules";

import { createRecentMoleculeRepository } from "./recent-molecules-repository";

test("concurrent successful loads serialize their recent-history writes", async () => {
  let serialized: string | null = null;
  const repository = createRecentMoleculeRepository({
    async getItem() {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return serialized;
    },
    async setItem(_key, value) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      serialized = value;
    },
    removeItem() {
      serialized = null;
    },
  });
  const caffeine = STARTER_MOLECULES[0];
  const benzene = STARTER_MOLECULES[1];
  assert.ok(caffeine && benzene);

  await Promise.all([repository.record(caffeine), repository.record(benzene)]);

  assert.deepEqual(
    (await repository.get()).map((molecule) => molecule.id),
    [benzene.id, caffeine.id],
  );
});

test("a failed mutation does not poison later history writes", async () => {
  let serialized: string | null = null;
  let failNextWrite = true;
  const repository = createRecentMoleculeRepository({
    getItem: () => serialized,
    setItem(_key, value) {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("simulated storage failure");
      }
      serialized = value;
    },
    removeItem() {
      serialized = null;
    },
  });
  const caffeine = STARTER_MOLECULES[0];
  const benzene = STARTER_MOLECULES[1];
  assert.ok(caffeine && benzene);

  await assert.rejects(
    repository.record(caffeine),
    /simulated storage failure/,
  );
  await repository.record(benzene);

  assert.deepEqual(
    (await repository.get()).map((molecule) => molecule.id),
    [benzene.id],
  );
});
