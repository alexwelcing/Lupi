import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSavedViewInput } from "./saved-views";

const BASE_URL = "https://lupi.live";

test("normalizes direct slugs and canonical saved-view URLs", () => {
  assert.equal(
    normalizeSavedViewInput("  Caffeine-Iso  ", BASE_URL),
    "caffeine-iso",
  );
  assert.equal(
    normalizeSavedViewInput("https://lupi.live/view/caffeine-iso", BASE_URL),
    "caffeine-iso",
  );
});

test("rejects lookalike origins, nested paths, and URL state that is not a slug", () => {
  assert.equal(
    normalizeSavedViewInput(
      "https://lupi.live.evil.example/view/caffeine",
      BASE_URL,
    ),
    null,
  );
  assert.equal(
    normalizeSavedViewInput("https://lupi.live/view/caffeine/extra", BASE_URL),
    null,
  );
  assert.equal(
    normalizeSavedViewInput(
      "https://lupi.live/view/caffeine?next=evil",
      BASE_URL,
    ),
    null,
  );
});

test("accepts a configured local viewer origin", () => {
  assert.equal(
    normalizeSavedViewInput(
      "http://192.168.1.42:5173/view/water",
      "http://192.168.1.42:5173",
    ),
    "water",
  );
});
