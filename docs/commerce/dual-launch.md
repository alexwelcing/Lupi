# Free Lupi app and US physical merchandise

One story connects the launch: **look closer at a familiar molecule, explore it in Lupi, and optionally choose a physical object carrying its design.** The free app is useful independently of a purchase. Exploration campaigns lead toward the app; product campaigns lead toward an exact, ready physical offer. Measure these acquisition lanes separately.

This is a staging foundation, not a public launch or permission to spend. Native version 0.1.0 build 4 stays frozen. The shared web registry is [`apps/web/public/launch/campaigns.json`](../../apps/web/public/launch/campaigns.json), schema `lupi.launch.v1`; its initial `app.public` is false. The native merchandise feed remains `storefrontPublic: false` with no offers. A generated page or registry entry does not establish App Store availability, storefront publication or fulfillment readiness.

## Product priority

| Campaign / native molecule | Role | Current product evidence |
| --- | --- | --- |
| `us26-caffeine-01` / `caffeine` | First-drop readiness candidate; coffee ritual and gift recognition | Current Quiet Capsule candidates are the **Comfort Colors 1717 tee, Black**, and **Richardson 256 Umpqua cap, Charcoal/White**. Exact artwork, merchandising and ad artifacts passed their recorded reviews. Supplier review, account SKU/stock mapping, physical sample and landed-margin acceptance are missing. |
| `us26-water-01` / `water` | Next-drop candidate | Quiet **Gooten 16 oz Can Glass Only, Clear**, without lid or straw. Its artwork, merchandising and ad artifacts passed their recorded reviews. Supplier, sample and US landed-cost/checkout gates remain open; historical Shopify water matches are drafts. |
| `us26-c60-01` / `c60_buckyball` | Exploration only | No matching current merchandise or artwork approval. Use the app's illustrative geometric model; show no purchase link. |

Caffeine is the current active-catalog/native-starter overlap, but the older active Molecular Hat, First Cup cap, 6 a.m. hoodie and 6 a.m. glass are **different print identities** from these Quiet Capsule candidates. Do not reuse their product bindings as proof that the new designs can ship. Copy edits do not approve imagery or transfer an earlier artifact's approval to a new composition. See [creative briefs](creative-briefs.md).

## Move by readiness

| Phase | Required exit before moving on |
| --- | --- |
| Stage | Preview `/launch/`, each molecule page and its four registered placement pages. Confirm copy, disclosure, US scope, closed purchase state and working support/privacy routes. Before paid Reddit traffic, verify accessible website terms, privacy and contact/about information. No live campaign or public availability claim follows from this phase. |
| Open the app lane | Verify the actual US App Store listing and downloadable build. Only then enable its public App Store CTA. Physical AR, audio and haptics QA remains separately deferred; use verified camera-free preview footage for initial creative. |
| Open one product lane | Match molecule → exact artwork digest → Shopify product/physical variant → account-specific supplier SKU. Pass supplier availability/review and physical sample acceptance. Verify the supported US address coverage, shipping charge/timing, checkout, paid acceptance order, supplier acceptance, support/returns route and published policies. Then publish only that exact offer and refresh its expiry evidence. |
| Run a bounded paid test | Name the owner, verified offer/placement, measurement coverage, private cost sheet, maximum affordable loss and review condition before any spend. Confirm ad and landing availability agree; complete the platform's review. |
| Ramp or repair | Increase spend only when paid orders, contribution after costs, delivery performance and support capacity justify the next increment. Pause affected routes when supplier, checkout, price/shipping, feed freshness or measurement fails. |

Schedule phases after their gates pass. Preserve separate App Review, web deployment, storefront and fulfillment acceptance; see [native release boundaries](../ar/us-dual-launch.md).

Reddit reviews the destination as well as the ad, including policy/contact links. [Reddit ad review guidance](https://business.reddithelp.com/articles/Knowledge/About-Reddits-ad-review-process)

## Links and measurement

Owned pages are `/launch/{caffeine|water|c60}/`, with source `lupi`, medium `owned`, creative `owned`. Registered pages add `/{placementId}/`:

| Placement ID | Source | Medium |
| --- | --- | --- |
| `youtube-orbit-a` | `youtube` | `paid-video` |
| `reddit-detail-a` | `reddit` | `paid-social` |
| `instagram-carousel-a` | `instagram` | `paid-social` |
| `creator-cr01-a` | `creator-cr01` | `creator` |

Use the registry's campaign ID as `utm_campaign` and its placement creative as `utm_content`. Preserve only registered context on the exact Shopify variant link. These are static placement labels, not visitor IDs. A creator link reused across platforms identifies that creator placement; it does not establish which platform caused a sale. Native build 4 retains its existing `lupi-ios` / `app` handoff and cannot recover the original acquisition source after installation.

App Store campaign attribution links require the provider token generated in App Store Connect. A verified public listing can use its plain App Store URL before that token is available. Stage campaign tokens of at most 30 characters, but do not invent a provider token. Apple's current guidance says new apps may need live analytics before campaign generation is available; small metrics can be withheld. Treat these as unknown. `/us/` in a link does not enforce US availability. [Apple campaign links](https://developer.apple.com/help/app-store-connect-analytics/acquisition/campaign-links)

Count verified landing loads and outbound actions in aggregate, without Lupi cookies, persistent visitor IDs, fingerprinting or session replay. Count events only after deployed flow verification. Keep Apple downloads, Shopify paid orders/refunds and ad-platform reports as separate series. Do not infer unique visitors, cross-visit conversion or a person-level install-to-purchase path. Shopify's standard session reports use cookies, campaign reports omit returns, and reported sales are not payment receipts. [Shopify marketing reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/marketing-reports)

Use authenticated paid-order state and linked refunds as money truth, excluding test/unpaid orders. Report how many paid orders have recorded campaign context; leave missing attribution unknown. This work adds no consent system, pixels, enhanced conversions, customer match keys or new ad technology.

## Spend from contribution

Keep actual business costs in a private operating sheet, outside this public repository. Calculate per-order contribution before acquisition from net receipts excluding tax, less production, shipping paid, payment/platform fees, creator commission, refunds/reships and a documented allowance for unsettled returns. Replace allowances with actual costs as outcomes settle; avoid double counting.

Campaign contribution then subtracts ad spend, creator flat fees, samples and attributable creative cost. Product gross margin alone is insufficient; Shopify cost data also needs to exist at sale time for its profit reports. [Shopify profit reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/profit-reports)

Use observed purchase conversion to diagnose a route, with compatible denominators and stated coverage. Use realized contribution and fulfillment evidence to decide whether it can afford more acquisition. No fixed CVR target, assumed lifetime value, channel budget split or calendar ramp is established here.

## Build and operate the landing

The web build runs `scripts/generate-launch-pages.mjs` and writes 16 registered pages. Each page loads the shared public manifest and uses the existing own-host audience tracker. The Worker reserves the namespace; unknown campaigns return 404, and a missing generated document cannot masquerade as the viewer through SPA fallback.

Run the lightweight behavior checks without reinstalling the full viewer toolchain:

```sh
node --test apps/web/src/launch.test.mjs apps/mcp-worker/tests/launch.node.mjs
node scripts/generate-launch-pages.mjs
```

After an accepted product is ready, publish its exact, time-bounded offer through `apps/web/public/commerce/merchandise.v1.json`. This feed is shared with native build 4. Campaign pages reject closed, stale, malformed or ambiguous offers and refresh before a shop handoff. The page downloads at most 128 KiB, sends no credentials and follows no feed redirects. Never turn on a readiness flag to bypass missing supplier/sample/checkout evidence.

Only after the app is actually available in the US App Store should `app.public` change to true. Rebuild and deploy the complete web artifact when changing the launch manifest. App Store publication, shop availability and campaign spend remain independent gates.

The explicit page actions are `molecule_open`, `app_store_open`, `merchandise_intent` (a purchase-CTA attempt) and `merchandise_open` (a current validated destination was handed to the browser). Neither shop action establishes a loaded Shopify page, checkout or paid order. Own-host analytics deliberately do not receive raw query parameters. Live deployment and collector delivery must be verified before reporting these as measured.

A creator placement such as `creator-cr01-a` is an unassigned public campaign label. Register its actual approved creator/creative and disclosure before distribution. No outreach, ad account activation, supplier purchase or public storefront opening is performed by this foundation.
