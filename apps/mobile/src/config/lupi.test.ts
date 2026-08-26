import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LUPI_WEB_URL,
  getLupiEmbeddedViewerUrl,
  getLupiSavedViewUrl,
  validateLupiWebBaseUrl,
} from "./lupi";

test("accepts the exact approved HTTPS production origin", () => {
  assert.equal(
    validateLupiWebBaseUrl(" https://lupi.live/ "),
    DEFAULT_LUPI_WEB_URL,
  );
});

test("rejects release origins that could leak imported coordinates", () => {
  assert.throws(
    () => validateLupiWebBaseUrl("http://lupi.live"),
    /require HTTPS/,
  );
  assert.throws(
    () => validateLupiWebBaseUrl("https://preview.lupi.live"),
    /Unapproved/,
  );
  assert.throws(
    () => validateLupiWebBaseUrl("https://lupi.live.evil.example"),
    /Unapproved/,
  );
});

test("rejects credentials, paths, queries, fragments, and malformed explicit values", () => {
  assert.throws(
    () => validateLupiWebBaseUrl("https://user:secret@lupi.live"),
    /credentials/,
  );
  assert.throws(
    () => validateLupiWebBaseUrl("https://lupi.live/view/demo"),
    /path/,
  );
  assert.throws(
    () => validateLupiWebBaseUrl("https://lupi.live?mode=test"),
    /query/,
  );
  assert.throws(() => validateLupiWebBaseUrl("not-a-url"), /absolute URL/);
});

test("allows insecure HTTP only for an explicit local development origin", () => {
  assert.equal(
    validateLupiWebBaseUrl("http://127.0.0.1:5173", { release: false }),
    "http://127.0.0.1:5173",
  );
  assert.throws(
    () =>
      validateLupiWebBaseUrl("http://preview.lupi.live", { release: false }),
    /Development builds require HTTPS/,
  );
});

test("uses the embedded viewer route without mounting the MCP harness", () => {
  const viewerUrl = getLupiEmbeddedViewerUrl();

  assert.equal(viewerUrl, `${DEFAULT_LUPI_WEB_URL}/?load#/embed/mobile`);
  assert.equal(viewerUrl.includes("/#/mcp"), false);
  assert.equal(viewerUrl.includes("?mcp"), false);
});

test("keeps saved-view handoff separate from the embedded viewer route", () => {
  assert.equal(
    getLupiSavedViewUrl("caffeine study"),
    `${DEFAULT_LUPI_WEB_URL}/view/caffeine%20study`,
  );
});
