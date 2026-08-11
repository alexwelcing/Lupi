import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTrustedShareUrl } from "./viewer-share";

test("allows encoded state only from the configured viewer origin", () => {
  assert.equal(
    normalizeTrustedShareUrl(
      "https://lupi.live/?s=abc123",
      "https://lupi.live",
    ),
    "https://lupi.live/?s=abc123",
  );
  assert.equal(
    normalizeTrustedShareUrl(
      "https://lupi.live.evil.example/?s=abc123",
      "https://lupi.live",
    ),
    null,
  );
  assert.equal(
    normalizeTrustedShareUrl("javascript:alert(1)", "https://lupi.live"),
    null,
  );
});
