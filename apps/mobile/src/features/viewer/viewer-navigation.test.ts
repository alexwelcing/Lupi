import assert from "node:assert/strict";
import test from "node:test";

import {
  decideViewerNavigation,
  makeViewerOriginWhitelist,
} from "./viewer-navigation";

const TRUSTED_ORIGIN = "https://lupi.live";

test("routes every WebView navigation through the explicit policy callback", () => {
  assert.deepEqual(makeViewerOriginWhitelist(), ["*"]);
});

test("allows only the exact viewer origin inside the WebView", () => {
  assert.equal(
    decideViewerNavigation({
      trustedOrigin: TRUSTED_ORIGIN,
      url: "https://lupi.live/view/caffeine",
    }),
    "allow",
  );
  assert.equal(
    decideViewerNavigation({
      trustedOrigin: TRUSTED_ORIGIN,
      url: "https://lupi.live.evil.example/view/caffeine",
    }),
    "block",
  );
});

test("opens an external URL only for a top-frame user click", () => {
  assert.equal(
    decideViewerNavigation({
      isTopFrame: true,
      navigationType: "click",
      trustedOrigin: TRUSTED_ORIGIN,
      url: "https://example.org/paper",
    }),
    "open-external",
  );
  assert.equal(
    decideViewerNavigation({
      isTopFrame: true,
      navigationType: "other",
      trustedOrigin: TRUSTED_ORIGIN,
      url: "https://example.org/redirect",
    }),
    "block",
  );
  assert.equal(
    decideViewerNavigation({
      isTopFrame: false,
      navigationType: "click",
      trustedOrigin: TRUSTED_ORIGIN,
      url: "https://example.org/iframe",
    }),
    "block",
  );
});
