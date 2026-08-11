import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSettingsSections,
  INVALID_SAVED_VIEW_MESSAGE,
} from "./settings-sections";

test("settings owns content handoff, privacy, and diagnostics in native groups", () => {
  const sections = buildSettingsSections();

  assert.deepEqual(
    sections.map((section) => section.id),
    ["open", "privacy", "about"],
  );
  assert.deepEqual(
    sections[0]?.data.map((item) => item.kind),
    ["route", "saved-view"],
  );
  assert.deepEqual(
    sections[1]?.data.map((item) => item.kind),
    ["privacy-note", "privacy-note"],
  );
  assert.deepEqual(
    sections[2]?.data.map((item) => item.kind),
    ["route"],
  );

  const routes = sections
    .flatMap((section) => section.data)
    .filter((item) => item.kind === "route")
    .map((item) => item.route);
  assert.deepEqual(routes, ["/import", "/diagnostics"]);
});

test("primary settings copy is product-facing", () => {
  const copy = buildSettingsSections()
    .flatMap((section) => [
      section.title,
      ...section.data.flatMap((item) => [item.title, item.detail]),
    ])
    .concat(INVALID_SAVED_VIEW_MESSAGE)
    .join(" ");

  assert.doesNotMatch(
    copy,
    /prototype|debug|internal beta|testflight|configured|origin|web wrapper/i,
  );
});
