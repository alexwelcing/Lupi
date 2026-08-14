import assert from "node:assert/strict";
import test from "node:test";

import { moleculeArSceneFromXyz } from "./ar-scene";
import { ArSessionRepository } from "./ar-session-store";

const scene = moleculeArSceneFromXyz("1\nHydrogen\nH 0 0 0", {
  expectedAtomCount: 1,
  moleculeKey: "template:Hydrogen",
  name: "Hydrogen",
});

test("stores only bounded opaque AR session identifiers", () => {
  let now = 1_000;
  const repository = new ArSessionRepository(() => now, 5_000, 2);
  const first = repository.create(scene);
  now += 1;
  const second = repository.create(scene);
  now += 1;
  const third = repository.create(scene);

  assert.match(third, /^ar-[a-z0-9]+-[a-z0-9]+$/);
  assert.equal(repository.read(first), null);
  assert.equal(repository.read(second), scene);
  assert.equal(repository.read(third), scene);
  assert.equal(repository.read("../not-a-session"), null);
});

test("expires and explicitly removes in-memory molecule data", () => {
  let now = 2_000;
  const repository = new ArSessionRepository(() => now, 100, 3);
  const removable = repository.create(scene);
  repository.remove(removable);
  assert.equal(repository.read(removable), null);

  const expiring = repository.create(scene);
  now += 101;
  assert.equal(repository.read(expiring), null);
});
