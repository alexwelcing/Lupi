import assert from "node:assert/strict";
import test from "node:test";

import { validateXyzDocument } from "./xyz-document";

test("accepts and normalizes a small XYZ structure", () => {
  const result = validateXyzDocument(
    "\uFEFF3\r\nwater\r\nO 0 0 0\r\nH 0.7 0.4 0\r\nH -0.7 0.4 0\r\n",
  );
  assert.equal(result.atomCount, 3);
  assert.equal(result.comment, "water");
  assert.equal(result.text.includes("\r"), false);
});

test("materializes a blank comment so the browser XYZ parser keeps atom row alignment", () => {
  const result = validateXyzDocument("1\n\nH 0 0 0");
  assert.equal(result.comment, "Imported XYZ structure");
  assert.equal(result.text, "1\nImported XYZ structure\nH 0 0 0");
});

test("rejects a truncated XYZ structure", () => {
  assert.throws(
    () => validateXyzDocument("2\nmissing atom\nH 0 0 0"),
    /does not contain that many rows/,
  );
});

test("rejects malformed coordinates", () => {
  assert.throws(
    () => validateXyzDocument("1\nbad coordinate\nH nope 0 0"),
    /not valid XYZ data/,
  );
});

test("rejects finite coordinates that overflow a useful mobile scene", () => {
  assert.throws(
    () => validateXyzDocument("1\nextreme coordinate\nH 1e308 0 0"),
    /not valid XYZ data/,
  );
});
