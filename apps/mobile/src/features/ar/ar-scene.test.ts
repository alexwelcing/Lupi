import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_AR_MAX_ATOMS,
  atomDistanceAngstrom,
  moleculeArSceneFromExportResult,
  moleculeArSceneFromXyz,
} from "./ar-scene";

const WATER_XYZ = [
  "3",
  "Water",
  "O 0 0 0",
  "H 0.958 0 0",
  "H -0.239 0.927 0",
].join("\n");

const metadata = {
  bridgeVersion: "2026-07-07.asset-export",
  expectedAtomCount: 3,
  formula: "H2O",
  id: "water",
  moleculeKey: "template:Water",
  name: "Water",
};

test("builds a centered, bounded native AR scene from a correlated XYZ export", () => {
  const scene = moleculeArSceneFromExportResult(
    { export: { contents: WATER_XYZ, format: "xyz" } },
    metadata,
  );

  assert.equal(scene.version, "lupi.ar-scene.v1");
  assert.equal(scene.molecule.atomCount, 3);
  assert.equal(scene.atoms[0].element, "O");
  assert.equal(scene.atoms[0].atomicNumber, 8);
  assert.equal(scene.bonds.length, 2);
  assert.ok(Math.max(...scene.extentMeters) <= 0.320_001);
  assert.ok(scene.atoms.every((atom) => atom.radiusMeters >= 0.006));
  const minimumX = Math.min(
    ...scene.atoms.map((atom) => atom.positionMeters[0]),
  );
  const maximumX = Math.max(
    ...scene.atoms.map((atom) => atom.positionMeters[0]),
  );
  assert.ok(Math.abs(minimumX + maximumX) < 1e-9);
});

test("accepts a 24-atom Caffeine handoff and preserves element identity", () => {
  const rows = [
    "C 1.028 -0.063 -0.111",
    "N 2.396 0.141 -0.069",
    "C 3.081 -0.954 -0.672",
    "N 2.419 -1.972 -1.224",
    "C 1.081 -1.853 -1.092",
    "C 0.316 -2.892 -1.572",
    "O -0.889 -2.770 -1.514",
    "N 0.437 -0.764 -0.589",
    "C 0.888 0.533 1.282",
    "O 2.800 1.108 0.533",
    "C 4.477 0.508 0.398",
    "C 3.064 -0.753 -2.787",
    "C -0.831 -0.416 -0.684",
    "C -1.184 0.962 -0.233",
    "H -0.871 1.712 -0.981",
    "H -0.729 1.251 0.726",
    "H -2.267 1.021 -0.109",
    "H 0.408 -0.117 1.864",
    "H 0.706 1.502 1.762",
    "H 1.965 0.439 1.433",
    "H 4.735 1.445 0.900",
    "H 4.658 0.640 -0.674",
    "H 5.133 -0.261 0.753",
    "H 2.544 -1.599 -3.250",
  ];
  const scene = moleculeArSceneFromXyz(["24", "Caffeine", ...rows].join("\n"), {
    ...metadata,
    expectedAtomCount: 24,
    formula: "C8H10N4O2",
    id: "caffeine",
    name: "Caffeine",
  });

  assert.equal(scene.atoms.length, 24);
  assert.deepEqual(
    [...new Set(scene.atoms.map((atom) => atom.element))].sort(),
    ["C", "H", "N", "O"],
  );
  assert.ok(scene.bonds.length > 10);
});

test("rejects a stale atom-count handoff and structures above the native cap", () => {
  assert.throws(
    () =>
      moleculeArSceneFromXyz(WATER_XYZ, { ...metadata, expectedAtomCount: 4 }),
    /changed while its AR scene was being prepared/,
  );

  const atomRows = Array.from(
    { length: NATIVE_AR_MAX_ATOMS + 1 },
    (_, index) => `C ${index} 0 0`,
  );
  assert.throws(
    () =>
      moleculeArSceneFromXyz(
        [String(atomRows.length), "Too large", ...atomRows].join("\n"),
        { ...metadata, expectedAtomCount: undefined },
      ),
    /supports up to 512 atoms/,
  );
});

test("fails closed on malformed export envelopes and unsupported elements", () => {
  assert.throws(
    () =>
      moleculeArSceneFromExportResult({ export: { format: "glb" } }, metadata),
    /valid XYZ frame/,
  );
  assert.throws(
    () =>
      moleculeArSceneFromXyz("1\nUnknown\nXx 0 0 0", {
        ...metadata,
        expectedAtomCount: 1,
      }),
    /not supported/,
  );
});

test("reports atom-pair distances in angstroms", () => {
  const scene = moleculeArSceneFromXyz(WATER_XYZ, metadata);
  assert.ok(
    Math.abs(atomDistanceAngstrom(scene.atoms[0], scene.atoms[1]) - 0.958) <
      1e-9,
  );
});
