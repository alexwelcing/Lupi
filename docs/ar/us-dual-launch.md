# Free native Lupi and US physical merchandise

The release connects a useful free SwiftUI/RealityKit app to physical Lupi merchandise. Molecular exploration and AR supply the native experience. A relevant optional offer opens Shopify checkout; buying merchandise never unlocks native features. The merchandise launch serves the United States. App Store distribution territories remain a separate submission setting.

Use two acquisition paths: exploration campaigns lead to the free app, and product campaigns lead directly to the matching shop offer. Measure installs, native engagement, app-to-shop handoffs, paid orders, refunds and contribution separately. An install is not merchandise revenue, and a recorded campaign source is not proof of incremental sales.

## Offer handoff

The bundled `LupiKit` merchandise registry starts empty, with `storefrontPublic: false`. The remote registry lives at `https://lupi.live/commerce/merchandise.v1.json`; its source is `apps/web/public/commerce/merchandise.v1.json`. Adding that source file does not establish production deployment.

Populate a ready offer only after checking the exact native molecule, current print artifact digest, Shopify product and physical variant, supplier SKU mapping, sample acceptance, price, US shipping and checkout. Reuse the existing exact-version Artiste gates. A shared molecule name never transfers an older design's production approval. The registry's `ready` assertion does not replace those checks.

The native reader accepts only the fixed first-party registry endpoint and validated HTTPS product links on `loot.lupi.live`. Handoff URLs select the exact verified variant and carry stable campaign/creative references with `utm_source=lupi-ios` and `utm_medium=app`. They carry no account, device or visitor identifier. Missing, stale, invalid or closed offers are hidden. Remote updates avoid an app release for each catalog change; expiry requires the offer evidence to be refreshed operationally.

The shipped empty feed intentionally produces no shop call to action while the storefront and physical offers remain unverified. The native experience works without a feed, network connection or merchandise purchase. Keep app analytics aggregate; Shopify and the selected ad integrations own their separately configured consent and purchase measurement.

## Acceptance

| Gate | Required receipt |
| --- | --- |
| Core behavior | Current Swift package tests and actual Apple SDK device/Simulator builds |
| Native interaction | Camera-free preview, offline discovery, cancellation, collection and settings exercised in the Simulator |
| Physical AR | Tracking, placement, throws/collisions, interruption recovery, room-map restore, audio, haptics and accessibility checked on a physical iPhone |
| Privacy | Required-reason manifest in the built bundle; App Store labels verified against actual account sync, descriptions sent to Lupi/Jev and provider retention |
| Distribution | Signed distribution archive, correct bundle/version, screenshots, support/privacy URLs, age rating and App Store Connect submission metadata |
| Commerce | Public storefront, approved exact offer, US delivery quote, paid order, supplier acceptance and refund reconciliation |
| Release | App Review and storefront deployment verified independently |

At the owner's November 3 direction, continue without physical-device testing for now. Do not infer physical AR, audio or haptics acceptance from a Simulator or an unsigned SDK build. Existing deferred M3b engine work is a separate scope; outstanding release-affecting AR behavior stays visible in `status.md`.

Before submission, explain the physical-goods checkout in review notes and provide working public support/privacy URLs. The app must be complete and useful independently of the shop. Apple's current guidelines distinguish physical goods, native functionality and integrated AR; submission is not approval.

Sources: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [required-reason APIs](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype), [App Store privacy details](https://developer.apple.com/app-store/app-privacy-details/).
