import assert from "node:assert/strict";
import test from "node:test";

import {
  MOBILE_MAX_ATOMS,
  moleculeFromRouteParams,
  moleculeRouteParams,
  moleculeSummaryFromRouteParams,
  normalizeMoleculeSummary,
  STARTER_MOLECULES,
} from "./molecules";
import {
  MOBILE_GALLERY_ATOM_COUNTS,
  MOBILE_GALLERY_IDS,
} from "./mobile-gallery";

const GALLERY_MOLECULE = {
  id: "c60_buckyball",
  name: "Buckminsterfullerene",
  formula: "C60",
  tags: ["Nanomaterials"],
  load: {
    inputType: "gallery" as const,
    input: "c60_buckyball",
    atomCount: 60,
  },
} satisfies import("./molecules").MoleculeSummary;

test("the curated native gallery is bounded and contains no duplicate IDs", () => {
  assert.equal(MOBILE_GALLERY_IDS.length, 24);
  assert.equal(new Set(MOBILE_GALLERY_IDS).size, MOBILE_GALLERY_IDS.length);
  for (const atomCount of Object.values(MOBILE_GALLERY_ATOM_COUNTS)) {
    assert.ok(Number.isSafeInteger(atomCount));
    assert.ok(atomCount > 0 && atomCount <= MOBILE_MAX_ATOMS);
  }
});

test("molecule route params round-trip the procedural starter", () => {
  const copper = STARTER_MOLECULES.find(
    (molecule) => molecule.id === "copper-fcc",
  );
  assert.ok(copper);

  const params = moleculeRouteParams(copper);
  assert.deepEqual(moleculeFromRouteParams(params), copper.load);
  assert.deepEqual(moleculeSummaryFromRouteParams(params), copper);
});

test("molecule route params fail safely to caffeine", () => {
  assert.deepEqual(moleculeFromRouteParams({}), {
    inputType: "template",
    input: "Caffeine",
  });
});

test("gallery route params round-trip only curated IDs with their canonical atom count", () => {
  assert.deepEqual(
    moleculeFromRouteParams(moleculeRouteParams(GALLERY_MOLECULE)),
    GALLERY_MOLECULE.load,
  );
  assert.equal(normalizeMoleculeSummary(GALLERY_MOLECULE)?.id, "c60_buckyball");
  assert.deepEqual(
    moleculeSummaryFromRouteParams(moleculeRouteParams(GALLERY_MOLECULE)),
    GALLERY_MOLECULE,
  );

  assert.deepEqual(
    moleculeFromRouteParams({
      inputType: "gallery",
      input: "billion_atom_block",
      atomCount: "1",
    }),
    { inputType: "template", input: "Caffeine" },
  );
  assert.deepEqual(
    moleculeFromRouteParams({
      inputType: "gallery",
      input: "c60_buckyball",
      atomCount: "59",
    }),
    { inputType: "template", input: "Caffeine" },
  );
});

test("route summaries fail closed when metadata is missing, malformed, or oversized", () => {
  const params = moleculeRouteParams(GALLERY_MOLECULE);
  assert.equal(
    moleculeSummaryFromRouteParams({ ...params, moleculeFormula: undefined }),
    null,
  );
  assert.equal(
    moleculeSummaryFromRouteParams({ ...params, moleculeTags: "{bad-json" }),
    null,
  );
  assert.equal(
    moleculeSummaryFromRouteParams({
      ...params,
      moleculeName: "x".repeat(161),
    }),
    null,
  );
  assert.equal(
    moleculeSummaryFromRouteParams({
      ...params,
      moleculeTags: JSON.stringify(["x".repeat(49)]),
    }),
    null,
  );
  assert.equal(
    moleculeSummaryFromRouteParams({
      ...params,
      atomCount: "59",
    }),
    null,
  );
  assert.equal(
    moleculeSummaryFromRouteParams({
      ...params,
      moleculeId: "spoofed-gallery-id",
    }),
    null,
  );
});

test("route encoding omits unsafe summary metadata while retaining a bounded load request", () => {
  const params = moleculeRouteParams({
    ...GALLERY_MOLECULE,
    name: "x".repeat(161),
  });
  assert.equal(params.moleculeName, undefined);
  assert.equal(params.moleculeTags, undefined);
  assert.deepEqual(moleculeFromRouteParams(params), GALLERY_MOLECULE.load);
  assert.equal(moleculeSummaryFromRouteParams(params), null);
});

test("route encoding clamps otherwise valid tags to the metadata budget", () => {
  const tags = Array.from({ length: 12 }, (_, index) => `tag-${index}`);
  const params = moleculeRouteParams({ ...GALLERY_MOLECULE, tags });
  assert.deepEqual(JSON.parse(params.moleculeTags ?? "null"), tags.slice(0, 8));
  assert.equal(moleculeSummaryFromRouteParams(params)?.tags.length, 8);
});

test("procedural routes and catalog hits fail closed above the mobile atom cap", () => {
  assert.deepEqual(
    moleculeFromRouteParams({
      inputType: "procedural",
      input: "oversized lattice",
      atomCount: String(MOBILE_MAX_ATOMS + 1),
    }),
    { inputType: "template", input: "Caffeine" },
  );

  assert.equal(
    normalizeMoleculeSummary({
      id: "oversized",
      name: "Oversized lattice",
      formula: "Cu1000000",
      tags: ["procedural"],
      load: {
        molecule: {
          inputType: "procedural",
          input: "oversized lattice",
          atomCount: 1_000_000,
          element: "Cu",
          lattice: "fcc",
        },
      },
    }),
    null,
  );
});
