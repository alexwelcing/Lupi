# Native App Store data inventory

Audited 2026-11-03 against `eca99a5e3b301944c4dce87fa789ddd22eafd4f3` in the isolated `codex/lupi-dual-launch-us` worktree. This is a source and public-document audit, not an App Store privacy submission or attestation of live infrastructure settings. Recheck the final archive and any later source changes.

## Release configuration

`apps/apple/Config/Lupi.xcconfig` sets both Firebase settings empty and optionally includes ignored `Secrets.xcconfig`. That file is absent from this worktree. `CollectionModel` creates `AccountConfiguration` from the built Info.plist; missing configuration produces `.unavailable`. `AccountSections` then displays local collection controls rather than sign-in/sync.

The intended first release therefore has accounts disabled. Inspect **the archive's actual** `LupiFirebaseAPIKey` and `LupiFirebaseProjectID` values before selecting that release's privacy answers; source defaults do not establish the contents of a signed archive. If either configuration or offered account functionality changes, redo the account rows below.

## Observed data flows

| Feature | Device data / outbound request | Storage and recipient | Release privacy implication |
| --- | --- | --- | --- |
| Bundled discovery and 3D preview | Bundled names, formulas, structures; exact queries resolve locally | In-app state and bundled resources | Local processing alone is not Apple's definition of collection |
| Native AR play | Camera frames, planes/mesh, world map, shelf placements, small relocalization image | Local AR session and shelf files; shelf directory excluded from backup; no upload in native paths | Do not declare camera photos, Environment Scanning or location as collected solely because AR uses them locally |
| Collection and preferences | Named trophy records, structures, local IDs, sound/motion preferences | Local JSON and app-owned UserDefaults | No cloud Gameplay Content or account User ID collection in the account-disabled release |
| Online description search | On explicit Find, non-exact text up to 200 UTF-16 code units is POSTed as `{query}` to `https://lupi.live/v1/discovery/molecule` | Lupi Cloudflare Worker then TypeSafe API; no camera, room, collection or account fields included | Search History is the relevant collected-data category; do not select an unconditional "Data Not Collected" answer |
| Public merch registry | GET to fixed `https://lupi.live/commerce/merchandise.v1.json` when opening preview | Ephemeral URLSession without cookies, credentials or local cache; host sees connection metadata | No native account or persistent visitor ID is added; infrastructure access-log settings remain a separate check |
| Physical shop handoff | Variant and campaign/creative references in an external browser link | Shopify store; native app receives no card or order payload | Distinguish external physical checkout from native digital purchases or native purchase-history collection |
| Diagnostic receipt | Device family/OS, build, count/performance/save/tracking facts | Bounded in-memory history; copied only on user action | No automatic diagnostic upload; receiving a support email is a separate user-initiated support flow |
| Support email | Sender address, message, chosen attachments | Support mailbox | Policy must disclose what support receives; do not promise a deletion deadline unsupported by mailbox/provider configuration |
| Optional account code, **disabled in this release** | Apple identity token/nonce; optional name if supplied; Firebase UID; trophy records | Firebase Auth/Firestore; `users/{uid}/trophies/{id}` | If enabled later, User ID and Gameplay Content are linked to account, App Functionality, not tracking; review additional actually requested identity fields |

Source receipts: `LupiData/MoleculeDiscovery.swift:68-108`, `LupiData/MerchandiseClient.swift`, `LupiData/MerchandiseRegistry.swift`, `Lupi/Account/CollectionModel.swift:35-56`, `Lupi/Account/AccountView.swift`, `Lupi/Play/ShelfHost.swift`, `Lupi/Debug/SessionReceipt.swift`; Worker/core files inspected using `git show HEAD:<path>` outside the sparse checkout.

## Search endpoint, provider retention and linked status

The native route is **discovery**, not the web switcher route. `apps/mcp-worker/src/discovery.ts` enforces a 4096-byte body, accepts only `query`, calls the shared TypeSafe client with a 1.5-second deadline, and returns `cache-control: no-store`. It has no application database write, cache write or console logging. `packages/core/src/jev/moleculeDiscovery.ts` sends bounded query text and constant catalogue criteria. The shared client constructs its own bearer/content-type headers; it does not forward the app caller's IP, cookies or account credentials to TypeSafe.

Do not apply the separate web switcher's cache and aggregate log behavior to native discovery. Also do not infer that the absence of a `console.log` means Cloudflare has no request/security/access logs: live observability, Logpush, security and retention settings were not inspected in this audit.

TypeSafe's [Privacy Policy](https://typesafe.ai/legal/privacy-policy) covers API Input, states that Input is not used to train or fine-tune models, and describes retention based on service/business need. Its [DPA](https://typesafe.ai/legal/data-processing), Schedule I section 8, gives purpose-based retention rather than a fixed deletion deadline. Its [Legal documentation](https://docs.typesafe.ai/legal) describes enterprise zero-data-retention as an available option. No Lupi-specific ZDR agreement or deletion SLA was verified. A no-training statement is not a zero-retention statement.

For the current online-search feature, the concrete App Store candidate is **Search History → App Functionality → not used for tracking**. The source sends no explicit end-user account or device identifier to TypeSafe. That is evidence supporting an unlinked design, but final **Data Linked to You** answers also depend on whether hosting/provider records retain an end-user IP or other identifier with the description. Verify the deployed route and applicable log/processor settings before attesting to an unlinked answer. No fictional retention period or completed privacy form is recorded here.

This uncertainty does not require disabling description search: publish the factual policy, retain the feature, and resolve the linked/logging answer using actual service configuration. Do not silently change behavior or select "no data collected" to bypass that work.

## Manifest and App Store answers are separate

The audited `eca99a5` `PrivacyInfo.xcprivacy` describes the source's optional account-capable configuration, declaring account User ID and Gameplay Content. It does **not** yet match the intended account-disabled release's collected-data categories: those account entries overstate that release, while online Search History is absent. Align the release manifest with the actual archived configuration and finalized search classification. A manifest's required-reason API entries do not fill in App Store Connect privacy labels automatically.

The two required-reason declarations remain source-supported:

- `NSPrivacyAccessedAPICategoryUserDefaults` / `CA92.1`: app-owned preferences, sound tuning and last-sync preference.
- `NSPrivacyAccessedAPICategorySystemBootTime` / `35F9.1`: elapsed in-app timers and durations. `A1Probe` exports time relative to its first event; `SessionReceipt` uses ordinary Date timestamps. Raw device boot uptime is not exported by those paths.

No IDFA, advertising SDK, fingerprinting routine, native analytics uploader or cross-company advertising identity appears in the audited native flow. This supports **no native tracking**; it is not a finding about the separate website, Shopify store or every operational log.

Apple's [privacy details](https://developer.apple.com/app-store/app-privacy-details/) distinguish local processing from retained off-device data, require disclosure of partner collection, and distinguish linked identity from tracking. Its [manifest guidance](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests) describes manifest categories; its [required-reason reference](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype) lists the API codes.

## Privacy and support URLs

HTTP observations on 2026-11-03 before the new static pages were published:

| URL | Observed response | Acceptance |
| --- | --- | --- |
| `https://lupi.live/privacy` and `/privacy/` | HTML 200, generic Lupi SPA shell/title | Not a verified native policy page |
| `https://lupi.live/support` and `/support/` | HTML 200, generic Lupi SPA shell/title | Not a verified support/contact page |
| `https://lupi.live/terms` | HTML 200, generic Lupi SPA shell/title | Not a verified terms page |
| `https://loot.lupi.live/policies/privacy-policy` | Redirect to `/password` | Not a public policy destination |
| `https://lupi.live/commerce/merchandise.v1.json` | HTML 200, generic SPA | Native parser correctly withholds offers; current feed is not live JSON |

New reviewable static source is `apps/web/public/privacy/ios/index.html` and `apps/web/public/support/ios/index.html`, intended for `https://lupi.live/privacy/ios/` and `https://lupi.live/support/ios/`. These pages contain no script, analytics, form or third-party asset. They were not published by this audit.

Contact `alex@lupinesci.com` is present in this repository's public `apps/lupine-app/public/index.html` and `pricing.html` and publicly listed by the user's [Lupine Library](https://library.lupine.science/articles/mlip-elastic-benchmark-preprint/). It is reused as the requested support contact; this does not establish mailbox delivery or a support response SLA. The pages identify Lupi as the native app and do not claim that Lupine's research app is its implementation.

After publication, GET each exact trailing-slash URL and verify substantive page text and contact link, not just HTTP 200. Add easily accessible native Settings links. Apple [guideline 5.1.1](https://developer.apple.com/app-store/review/guidelines/#privacy) requires the in-app and metadata policy links; [platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information) requires a Support URL leading to real contact information.

## Encryption and review statements

`project.yml` sets `ITSAppUsesNonExemptEncryption: false`. Source uses URLSession HTTPS, Apple Keychain where the optional account is configured, and plain Swift SHA-256 for integrity/nonces. No custom encryption protocol or encrypted messaging/VPN feature was found. Hashing is not evidence of a proprietary encryption protocol. This is source evidence for the ordinary OS-provided HTTPS case described in Apple's [encryption guidance](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations); the archive owner must confirm final linked libraries and answer the actual [export-compliance determination](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).

Review notes should say that Lupi is free, its useful native molecule/AR features do not require a shop purchase, any shop link sells physical goods through browser checkout, accounts are unavailable in the submitted account-disabled build, exact catalogue matching works offline, and online descriptions use TypeSafe/Jev. Do not describe illustrative molecular toy physics as scientific simulation. Physical goods use payment methods outside IAP under [guideline 3.1.3(e)](https://developer.apple.com/app-store/review/guidelines/#goods-and-services-outside-of-the-app).

## Concrete outstanding acceptance

1. Inspect archive Firebase keys and match manifest/App Store categories to that build.
2. Verify actual Cloudflare/provider handling needed to finalize Search History linked status; record any approved retention terms rather than inventing them.
3. Review and publish the concrete static pages, add native links, then verify exact public paths, policy text and contact.
4. Verify the manifest is bundled in the archive and generate Xcode's privacy report.
5. Keep SDK/archive/signing, Simulator interaction, physical AR acceptance, App Store upload, review and public availability as separate outcomes.

## Prepared submission candidate

The follow-up source candidate adds public support/privacy Settings links, excludes the hidden stress HUD and sound lab from Release, and declares online Search History for App Functionality without tracking. It uses Linked=true conservatively while deployed log linkage remains unresolved. Account User ID and Gameplay Content are omitted for this account-disabled candidate. Final archive inspection must check disabled account configuration, the bundled manifest, build identity and signing metadata. Development signing, App Store distribution signing and upload acceptance are separate outcomes. Local inspection scripts and receipts remain in ignored verification artifacts, following the repository's policy against adding verifiers or committed test reports.

## Scientific data credits in the submission binary

The source for build 4 adds offline Settings → Molecule data credits. It credits OMol25 and ColabFit under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), describes Lupi's graph derivation, and retains PubChem, NIST CCCBDB and numeric element-radius citations. This release uses selected numerical geometry/radius facts and Lupi's own presentation; it does not redistribute the NIST database compilation or assume all government-hosted material is public domain. The [U.S. Copyright Office's distinction between facts and their expression](https://copyright.gov/help/faq/faq-protect.html) informs the US-only scope.

The inherited C60 geometry lacked recorded upstream provenance, and PubChem returned no 3D conformer for CID 123591. The source now uses an original regular truncated-icosahedron construction with uniform 1.42 Å edges. Gallery, native bundle, recognition graph and C60 fixture entries identify the model as illustrative rather than DFT or experimental geometry. `tools/apple/generate-c60.py` is its deterministic source; the compound's PubChem identifier does not identify these coordinates.

The earlier build-3 archive predates these changes. Regenerate the Xcode project and produce a clean build-4 archive with the credits before upload. A saved App Store content-rights declaration does not establish that an older binary contains the required attribution.
