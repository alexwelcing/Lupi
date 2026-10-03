import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchOmol25Collections,
  fetchOmol25Page,
  Omol25RequestError,
} from "./omol25-client";
import {
  omol25MoleculeSummary,
  omol25StructureUrl,
  parseOmol25RowKey,
  type Omol25Collection,
} from "./omol25";

const ORIGIN = "https://lupi.live";
const COLLECTION: Omol25Collection = {
  id: "neutral-train",
  label: "Neutral train",
  description: "Complete public neutral training split.",
  repository: "colabfit/OMol25_train_neutral",
  indexedRows: 34_335_828,
  estimatedRows: 34_335_828,
  coverage: "complete",
};
const ROW = {
  rowIndex: 7,
  formula: "H2O",
  atomCount: 3,
  elements: ["H", "O"],
  method: "DFT",
  loadUrl: "/v1/datasets/omol25/neutral-train/structures/7.xyz",
  coordinateProvenance: "source",
  bondTopology: "not-provided",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("loads the public collection manifest and keeps exact coverage labels", async () => {
  const result = await fetchOmol25Collections(ORIGIN, undefined, (async (
    url: string | URL | Request,
  ) => {
    assert.equal(String(url), `${ORIGIN}/v1/datasets/omol25`);
    return jsonResponse({
      id: "omol25",
      collections: [
        COLLECTION,
        { ...COLLECTION, id: "all-train-preview", coverage: "indexed-preview" },
      ],
    });
  }) as typeof fetch);
  assert.equal(result[0]?.coverage, "complete");
  assert.equal(result[1]?.coverage, "indexed-preview");
});

test("rejects a preview mislabeled as complete", async () => {
  await assert.rejects(
    fetchOmol25Collections(ORIGIN, undefined, (async () =>
      jsonResponse({
        id: "omol25",
        collections: [COLLECTION, { ...COLLECTION, id: "all-train-preview" }],
      })) as typeof fetch),
    Omol25RequestError,
  );
});

test("sends bounded formula search and accepts only matching source row URLs", async () => {
  const page = await fetchOmol25Page(
    ORIGIN,
    COLLECTION,
    { offset: 0, query: " H2O ", searchMode: "formula" },
    (async (url: string | URL | Request) => {
      const requested = new URL(String(url));
      assert.equal(requested.searchParams.get("formula"), "H2O");
      assert.equal(requested.searchParams.get("query"), null);
      assert.equal(requested.searchParams.get("limit"), "20");
      return jsonResponse({
        dataset: "neutral-train",
        coverage: "complete",
        indexedRows: COLLECTION.indexedRows,
        offset: 0,
        matchedRows: 1,
        rows: [ROW],
      });
    }) as typeof fetch,
  );
  assert.equal(page.rows[0]?.rowIndex, 7);
  assert.equal(
    page.rows[0]?.loadUrl,
    omol25StructureUrl(ORIGIN, "neutral-train/7"),
  );
  assert.deepEqual(omol25MoleculeSummary("neutral-train", page.rows[0]!).load, {
    inputType: "omol25",
    input: "neutral-train/7",
    atomCount: 3,
  });
});

test("rejects URL substitution, wrong collection, oversized row, and non-source topology", async () => {
  const changes = [
    { row: { ...ROW, loadUrl: "https://elsewhere.example/7.xyz" } },
    { row: { ...ROW, atomCount: 1001 } },
    { row: { ...ROW, bondTopology: "inferred" } },
    { dataset: "neutral-validation", row: ROW },
  ];
  for (const change of changes) {
    await assert.rejects(
      fetchOmol25Page(
        ORIGIN,
        COLLECTION,
        { offset: 0, query: "", searchMode: "text" },
        (async () =>
          jsonResponse({
            dataset: change.dataset ?? "neutral-train",
            coverage: "complete",
            indexedRows: COLLECTION.indexedRows,
            offset: 0,
            rows: [change.row],
          })) as typeof fetch,
      ),
      Omol25RequestError,
    );
  }
});

test("keeps a warming index distinct from a failed request", async () => {
  await assert.rejects(
    fetchOmol25Page(
      ORIGIN,
      COLLECTION,
      { offset: 0, query: "water", searchMode: "text" },
      (async () => jsonResponse({ status: "warming" }, 202)) as typeof fetch,
    ),
    (error: unknown) =>
      error instanceof Omol25RequestError && error.kind === "warming",
  );
});

test("row keys are canonical and cannot carry arbitrary paths or large indexes", () => {
  assert.deepEqual(parseOmol25RowKey("neutral-train/7"), {
    collection: "neutral-train",
    rowIndex: 7,
  });
  for (const input of [
    "neutral-train/07",
    "neutral-train/../../x",
    "other/7",
    "neutral-train/100000000",
    "neutral-train/-1",
  ]) {
    assert.equal(parseOmol25RowKey(input), null);
  }
});
