import assert from "node:assert/strict";
import test from "node:test";

import { parseMoleculeSearchPayload } from "./lupi-mcp";

test("normalizes the Worker molecule envelope used by live edge search", () => {
  const payload = parseMoleculeSearchPayload({
    query: "copper",
    returned: 1,
    molecules: [
      {
        id: "copper-fcc",
        name: "5,000 Cu FCC lattice",
        formula: "Cu5000",
        tags: ["materials", "fcc"],
        load: {
          molecule: {
            inputType: "procedural",
            input: "5,000 Cu FCC lattice",
            atomCount: 5000,
            element: "Cu",
            lattice: "fcc",
          },
        },
      },
    ],
  });

  assert.deepEqual(payload?.molecules[0]?.load, {
    inputType: "procedural",
    input: "5,000 Cu FCC lattice",
    atomCount: 5000,
    element: "Cu",
    lattice: "fcc",
  });
});

test("keeps the direct load shape used by local molecule summaries", () => {
  const payload = parseMoleculeSearchPayload({
    molecules: [
      {
        id: "water",
        name: "Water",
        formula: "H2O",
        tags: ["small", 3],
        load: { inputType: "template", input: "Water" },
      },
    ],
  });

  assert.deepEqual(payload?.molecules[0], {
    id: "water",
    name: "Water",
    formula: "H2O",
    tags: ["small"],
    load: { inputType: "template", input: "Water" },
  });
});

test("drops malformed search hits instead of passing them into navigation", () => {
  const payload = parseMoleculeSearchPayload({
    molecules: [{ id: "bad", name: "Bad", formula: "?", tags: [], load: {} }],
  });

  assert.deepEqual(payload?.molecules, []);
});

test("drops edge hits above the mobile procedural atom budget", () => {
  const payload = parseMoleculeSearchPayload({
    molecules: [
      {
        id: "million-atoms",
        name: "Million atom lattice",
        formula: "Cu1000000",
        tags: ["large"],
        load: {
          molecule: {
            inputType: "procedural",
            input: "large copper",
            atomCount: 1_000_000,
          },
        },
      },
    ],
  });

  assert.deepEqual(payload?.molecules, []);
});
