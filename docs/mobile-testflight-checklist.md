# Lupi iPhone TestFlight checklist

Status snapshot: **2026-08-14**

This is the gated path from the current `apps/mobile` source to an iPhone
TestFlight acceptance result. It deliberately separates source, local build,
EAS build, App Store Connect, TestFlight, device, and feedback truth.

Expo login, EAS project-link/configuration, remote build-number, and signed
development-build receipts exist. Exact main is
`15eb0b4cfeb1e9583e817599d43003c173f5481d`; focused follow-up branch
`codex/sdk57-patch-alignment` keeps Expo SDK 57.0.12, React Native 0.86.2,
React 19.2.3, version/runtime `1.0.1`, and iOS deployment target `17.6`. Its local
verification ladder and 95-file/1,690,897-byte archive are green, but the final
follow-up SHA is not frozen. Signed SDK 57 internal build
`2960e909-355d-46b0-8394-013786627180`, exact SHA `7cd75aaf`, version/build
`1.0.1 (1)`, was installed on an iPhone 15 Pro running iOS 26.6. That session
proved installation and Viewer interaction, and exposed an interactive
back-swipe conflict now disabled on main. Exact-`82edf614` simulator
workflow `01a0009b-1133-711b-b57a-60f3067a4b6b` passed the complete shell
matrix. The compatible 30-browser-tool/seven-edge-tool bridge is live. No App
Store Connect app, TestFlight build, post-fix device retest, or physical Room AR
receipt is recorded. The post-merge source job also proved that Expo's mutable
online compatibility feed can advance after review; the current follow-up
therefore validates the installed SDK's bundled map while leaving upgrades as
an explicit native-release decision.
A checked item below means only
that its stated evidence was verified; it never stands in for a later gate.

## How to use this checklist

- `[x]` — verified in source or on the named candidate/revision, with the exact
  evidence boundary stated.
- `[ ]` — not complete, or no durable receipt has been attached yet.
- **Owner** names the party that must act or attest.
- **Receipt** names the minimum evidence required to check the item.
- Never paste passwords, private keys, API-key contents, one-time codes,
  recovery codes, or Apple/Expo session tokens into Git, an issue, or this file.
- Promote a gate only when every blocking item in that gate is checked. A local
  export does not prove an EAS build; an EAS build does not prove App Store
  Connect processing; processing does not prove an iPhone acceptance pass.

## Gate summary

| Status | Gate                                            | Owner                 | Promotion evidence                                      |
| ------ | ----------------------------------------------- | --------------------- | ------------------------------------------------------- |
| [x]    | G0 — current source baseline                    | Codex                 | Linked source and source-gate inspection                |
| [ ]    | G1 — local release-candidate preflight          | Codex                 | Final clean SHA and App Store Connect ID remain open    |
| [ ]    | G2 — Expo and Apple inputs authorized           | User                  | Expo link complete; organization/production inputs open |
| [ ]    | G3 — EAS project, signing, and production build | Codex + User          | Earlier dev build exists; integrated/store build open   |
| [ ]    | G4 — App Store Connect and TestFlight           | Codex + User + Apple  | Processed build assigned to an authorized tester group  |
| [ ]    | G5 — physical iPhone acceptance                 | User + Codex          | Device matrix, screenshots/logs, and pass/fail record   |
| [ ]    | G6 — feedback disposition and next candidate    | Product owner + Codex | Triaged feedback and an explicit go/no-go decision      |

## G0 — already complete in the current source

These checks establish what exists in source. Separate sections record an EAS
development builder and registered-device artifact for earlier revision
`7c64bd70`; those receipts do **not** prove the integrated SDK 57 source,
TestFlight, or physical Room AR behavior. Expo Go cannot execute the native Room
runtime; AR proof requires a compatible development or TestFlight build on an
ARKit-capable iPhone.

- [x] **An Expo Router SDK 57 app exists at `apps/mobile`.** It uses Expo
      `~57.0.12`, React Native `0.86.2`, React `19.2.3`, Expo Router
      `~57.0.12`, and TypeScript `~6.0.3`; explicit
      `@expo/metro-runtime` and `expo-font` dependencies are present, and
      `expo-font` is an app-config plugin. SDK 57 also explicitly pins
      `react-native-webview` `13.16.1`, `expo-web-browser` `~57.0.2`,
      `react-native-reanimated` `4.5.1`, `react-native-worklets` `0.10.1`, and
      `@react-native/metro-config` `0.86.2`. **Owner:** Codex.
      **Receipt:** [`apps/mobile/package.json`](../apps/mobile/package.json).
- [x] **The application identity is reserved in source.** Name `Lupi`, slug
      `lupi`, scheme `lupi`, iOS bundle identifier `live.lupi.app`, app version
      `1.0.1`, runtime policy `appVersion`, explicit iOS deployment target
      `17.6`, and iPhone-only support are declared. Local `ios.buildNumber` is
      intentionally omitted because EAS owns the remote build number; that remote
      value is initialized to `1`. **Owner:** Codex. **Receipt:**
      [`app.json`](../apps/mobile/app.json) and [`eas.json`](../apps/mobile/eas.json).
- [x] **Release image assets have explicit roles and verified PNG properties.**
      `lupi-app-icon.png` is 1024x1024 truecolor RGB without alpha;
      `lupi-splash-mark-1024.png` is 1024x1024 RGBA with alpha; `lupi-icon.png`
      remains the web/favicon and in-app mark. **Owner:** Codex. **Receipt:**
      [`app.json`](../apps/mobile/app.json) and the passed source configuration
      gate. On-device appearance remains G5.
- [x] **EAS profiles and version policy exist in source.** `preview` is internal
      distribution; `production` is store distribution, uses the production EAS
      environment, pins Node `22.23.1` and the `sdk-57` image, explicitly targets `https://lupi.live`,
      and auto-increments the remote build number. `submit.production` remains
      empty. **Owner:** Codex. **Receipt:** [`eas.json`](../apps/mobile/eas.json).
- [x] **The Expo project identity is linked.** Source pins owner `alexwelcing`
      and project ID `38c55c8d-b7dc-4bec-ab5e-1809eda6bf9d`, resolving to
      `@alexwelcing/lupi`. **Owner:** Codex. **Receipt:**
      [`app.json`](../apps/mobile/app.json) plus the authenticated EAS config
      receipt.
- [x] **Source has no Universal Links and has an explicit OTA runtime
      configuration.** iOS `associatedDomains` remains absent. The app includes
      `expo-updates`, an `appVersion` `runtimeVersion` policy, the linked Update
      URL, and named EAS channels. An active development update exists for
      runtime `1.0.0` and exact clean SDK 54 revision `7c64bd70`; runtime `1.0.1`
      requires a new compatible binary. **Owner:** Codex. **Receipt:**
      [`app.json`](../apps/mobile/app.json),
      [`package.json`](../apps/mobile/package.json), and the TestFlight notes.
- [x] **Native tab routes exist for Gallery, Library, and Settings.** The tab shell
      uses Expo Router's nested `NativeTabs.Trigger`, `.Icon`, and `.Label` API.
      The Gallery keeps the internal `(explore)` route name, while the visible
      product label and native header are Gallery. Viewer is an immersive root-stack detail
      route with an explicit native Back button and interactive back-swipe
      disabled, not a permanent tab. This reserves horizontal drags for molecule
      rotation. The route layer
      stays thin and delegates behavior to feature screens. **Owner:** Codex.
      **Receipt:** [`app/_layout.tsx`](../apps/mobile/app/_layout.tsx) and
      [`apps/mobile/README.md`](../apps/mobile/README.md).
- [x] **Native Gallery discovery exists in source.** Exactly 24 curated records
      are bundled for offline browsing. iPhone uses native large-title header
      search and an iOS action sheet for All Structures, Featured, Molecules,
      Materials, and Trajectories; the direct-root list adapts between one and
      two columns. **Owner:** Codex. **Receipt:**
      [`gallery-screen.tsx`](../apps/mobile/src/features/gallery/gallery-screen.tsx)
      and [`gallery-catalog.ts`](../apps/mobile/src/features/gallery/gallery-catalog.ts).
- [x] **A common 50,000-atom mobile policy and Gallery allowlist are present.**
      Gallery IDs and canonical atom counts are shared by route, persistence,
      and command validation; unknown IDs, mismatched counts, oversized routes,
      and invalid persisted recents fail closed before viewer use. **Owner:**
      Codex. **Receipt:**
      [`mobile-gallery.ts`](../apps/mobile/src/domain/mobile-gallery.ts),
      [`molecules.ts`](../apps/mobile/src/domain/molecules.ts), and
      [`recent-molecules-codec.ts`](../apps/mobile/src/storage/recent-molecules-codec.ts).
- [x] **Recents are local and bounded in source.** The implementation uses
      `expo-sqlite/kv-store`, keeps at most 12 records, rejects invalid/corrupt or
      over-cap records, and deduplicates IDs by retaining the first valid record.
      **Owner:** Codex. **Receipt:**
      [`recent-molecules.native.ts`](../apps/mobile/src/storage/recent-molecules.native.ts)
      and
      [`recent-molecules-codec.ts`](../apps/mobile/src/storage/recent-molecules-codec.ts).
- [x] **Recents are recorded only after the intended viewer load succeeds.**
      Initial responses are correlated by request ID, bridge tool, and active
      molecule identity. Status/probe/error messages, failed or stale responses,
      reload duplicates, and a superseded WebView cannot write history; a local
      persistence error is reported without turning a successful render into a
      viewer failure. **Owner:** Codex. **Receipt:**
      [`viewer-session.ts`](../apps/mobile/src/features/viewer/viewer-session.ts)
      and [`viewer-screen.tsx`](../apps/mobile/src/features/viewer/viewer-screen.tsx).
- [x] **Library uses native recent-structure rows in source.** A direct-root
      `SectionList` presents compact, success-gated Recent Structures with clear
      confirmation, loading/error/empty states, persistence, accessibility
      semantics, and the dark theme. XYZ import, saved-view handoff, privacy, and
      diagnostics live in Settings. **Owner:** Codex.
      **Receipt:**
      [`library-screen.tsx`](../apps/mobile/src/features/library/library-screen.tsx)
      and [`library-sections.ts`](../apps/mobile/src/features/library/library-sections.ts).
- [x] **Native XYZ document import exists in source.** The `/import` route uses
      Expo DocumentPicker and FileSystem, accepts `.xyz` only, caps files at 2 MB
      and structures at 50,000 atoms, bounds coordinate tokens and values, and
      validates before WebView injection. **Owner:** Codex. **Receipt:**
      [`import-molecule-screen.tsx`](../apps/mobile/src/features/import/import-molecule-screen.tsx)
      and [`xyz-document.ts`](../apps/mobile/src/features/import/xyz-document.ts).
- [x] **XYZ privacy and parser-alignment boundaries are visible in source.** The
      import UI discloses that coordinates enter the configured remote WebView page
      in memory; blank XYZ comment lines are materialized for browser-parser
      alignment; imports are not persisted to recents yet. **Owner:** Codex.
      **Receipt:**
      [`import-molecule-screen.tsx`](../apps/mobile/src/features/import/import-molecule-screen.tsx)
      and [`xyz-document.ts`](../apps/mobile/src/features/import/xyz-document.ts).
- [x] **The current viewer is an intentional parity bridge.** Native screens
      host the configured web viewer at the chrome-free
      `/?load#/embed/mobile` entry point and expose a compact Fit, Camera, Look,
      More, Share, and Room toolbar. Native iOS action sheets provide camera presets,
      appearance choices, trajectory Play/Pause, bond visibility, Reset, and
      Reload; an accessible modal is the cross-platform fallback. The exact
      route retains the canvas and typed bridge but omits the browser header,
      MCP harness, default-
      molecule side effect, command deck, and other web controls. It is not yet
      the planned native renderer. **Owner:** Codex. **Receipt:**
      [`viewer-screen.tsx`](../apps/mobile/src/features/viewer/viewer-screen.tsx),
      [`viewer-control-bar.tsx`](../apps/mobile/src/features/viewer/viewer-control-bar.tsx),
      [`viewer-menu.ts`](../apps/mobile/src/features/viewer/viewer-menu.ts), and
      [`docs/mobile-expo.md`](mobile-expo.md).
- [x] **Native Room AR exists behind a strict handoff.** Viewer calls
      `lupi.export_xyz` only when advertised by the bridge and correlates response
      ID, tool, and active molecule. Native `lupi.ar-scene.v1` validation uses
      canonical element data, accepts at most 512 atoms, infers at most 2,048
      bonds, bounds/centers coordinates, and fails closed on stale, malformed,
      unsupported, or count-drifted exports. Only an opaque, expiring in-memory
      session ID enters the `/ar` route; molecule bytes are neither route params
      nor durable storage. **Owner:** Codex. **Receipt:**
      [`ar-scene.ts`](../apps/mobile/src/features/ar/ar-scene.ts),
      [`ar-session-store.ts`](../apps/mobile/src/features/ar/ar-session-store.ts),
      [`viewer-ar-handoff.ts`](../apps/mobile/src/features/viewer/viewer-ar-handoff.ts),
      and [`app/ar.tsx`](../apps/mobile/app/ar.tsx).
- [x] **The Room surface uses native ARKit interaction in source.** Viro `2.57.5`
      provides horizontal/vertical plane discovery, tap placement, drag, pinch,
      two-finger rotation, atom selection, second-atom distance measurement, and
      a native accessible atom-inspection/measurement sheet. It also provides
      re-place/reset, people occlusion, tracking guidance, lighting, shadows,
      and haptics. The intro precedes camera permission, and unsupported/denied
      states are explicit. These are source claims only; every AR behavior remains
      a G5 physical-iPhone gate. **Owner:** Codex. **Receipt:**
      [`ar-screen.tsx`](../apps/mobile/src/features/ar/ar-screen.tsx) and
      [`molecule-ar-surface.native.tsx`](../apps/mobile/src/features/ar/molecule-ar-surface.native.tsx).
- [x] **The source bridge has a typed Gallery command.** Native Gallery loads
      issue `lupi.open_gallery_example` with an allowlisted stable ID, exact
      expected atom count, and a 50,000-atom ceiling. The web
      bridge delegates to the canonical web Gallery open path and the generated
      browser manifest includes the tool. Production deployment remains an open
      G1/G3 gate. **Owner:** Codex. **Receipt:**
      [`viewer-session.ts`](../apps/mobile/src/features/viewer/viewer-session.ts),
      [`mcpViewerBridge.tsx`](../packages/ui/src/mcpViewerBridge.tsx), and
      [`browser-mcp-manifest.json`](../apps/web/public/browser-mcp-manifest.json).
- [x] **WebView navigation and sharing fail closed in source.** Embedded
      navigation is restricted to the exact configured origin; cross-origin
      HTTP(S) opens externally only for an exact top-frame user click; redirects,
      subframes, and custom schemes are rejected. Encoded share URLs must match the
      exact configured origin. **Owner:** Codex. **Receipt:**
      [`viewer-navigation.ts`](../apps/mobile/src/features/viewer/viewer-navigation.ts)
      and [`viewer-share.ts`](../apps/mobile/src/features/viewer/viewer-share.ts).
- [x] **Viewer compatibility and lifecycle recovery are implemented in source.**
      The initial load accepts legacy bridge major `0` or the dated
      `asset-export` family from `2026-07-07` onward, plus nine base mobile
      tools; a Gallery load additionally requires `lupi.open_gallery_example`;
      foreground resume probes bridge state with a bounded reload timeout, and
      WebKit content-process termination reports recovery and reloads. Embedded
      maximum-update-depth failures (including production React error `#185`)
      receive one cache-busted automatic reload before switching to an actionable
      manual retry state. **Owner:** Codex. **Receipt:**
      [`viewer-compatibility.ts`](../apps/mobile/src/features/viewer/viewer-compatibility.ts),
      [`viewer-recovery.ts`](../apps/mobile/src/features/viewer/viewer-recovery.ts),
      and [`viewer-screen.tsx`](../apps/mobile/src/features/viewer/viewer-screen.tsx).
- [x] **Native diagnostics, privacy copy, and a root error boundary exist.** The
      diagnostics route exposes native/EAS/Git and remote `/health` identity when
      available, provides a shareable report, and explains native/WebView data
      boundaries. The root error boundary offers retry plus version/build context.
      **Owner:** Codex. **Receipt:**
      [`diagnostics-screen.tsx`](../apps/mobile/src/features/diagnostics/diagnostics-screen.tsx),
      [`release-identity.ts`](../apps/mobile/src/features/diagnostics/release-identity.ts),
      and [`root-error-boundary.tsx`](../apps/mobile/src/components/root-error-boundary.tsx).
- [x] **Source accessibility semantics are present.** Current screens and
      controls include roles, labels, hints, live alert/status regions, responsive
      Gallery layouts, grouped Library rows, and 44-point control targets.
      **Owner:** Codex. **Receipt:**
      [`viewer-control-bar.tsx`](../apps/mobile/src/features/viewer/viewer-control-bar.tsx)
      and representative feature/component source. Physical VoiceOver, Dynamic
      Type, contrast, Reduce Motion, safe-area, and target-size receipts remain G5.
- [x] **Saved views do not embed in the current app.** The canonical
      `/view/[slug]` thin route delegates to `SavedViewHandoffScreen`, revalidates
      the slug, explains the 50,000-atom boundary, and opens the configured web
      route only after an explicit Safari button. In-app saved-view rendering is
      deferred until trusted atom-count metadata exists. **Owner:** Codex.
      **Receipt:** [`app/view/[slug].tsx`](../apps/mobile/app/view/[slug].tsx) and
      [`saved-view-handoff-screen.tsx`](../apps/mobile/src/features/saved-view/saved-view-handoff-screen.tsx).
- [x] **Local verification commands are declared.** The package exposes
      source/release TestFlight gates, `test`, `typecheck`, `lint`, Expo dependency
      and EAS-archive checks, local verification, `export:web`, and `export:ios`,
      plus Expo start and tunnel commands. **Owner:** Codex. **Receipt:**
      [`apps/mobile/package.json`](../apps/mobile/package.json).
- [x] **Generated output and local secrets are excluded from source control.**
      Expo state, native generated directories, build exports, credentials, and
      local environment files are ignored. **Owner:** Codex. **Receipt:**
      [`apps/mobile/.gitignore`](../apps/mobile/.gitignore).
- [x] **The migration guide distinguishes local, build, and release truth.**
      **Owner:** Codex. **Receipt:** [`docs/mobile-expo.md`](mobile-expo.md) and
      [`release-truth-contract.md`](release-truth-contract.md).

## G1 — Codex/in-repo release-candidate development

G1 is complete only when one immutable source revision has all local receipts.
Do not fix source, bump versions, or change config while calling the old
revision “the candidate”; start a new candidate record after any change.

### Candidate freeze and environment

- [ ] **Name and freeze the Room candidate.** Development is isolated on
      `codex/sdk57-patch-alignment`, source marketing version is `1.0.1`,
      runtime policy is `appVersion`, the SDK checkpoint is Expo 57 / React Native
      0.86.2 / React 19.2.3, iOS deployment target is `17.6`, and the recorded remote iOS
      build number baseline is `1`. Capture the final full SHA with
      `git rev-parse HEAD`, UTC timestamp, and effective remote build number only
      after all AR/config/docs changes and checks finish. **Owner:** Codex.
      **Receipt:** candidate evidence record below.
- [x] **Review the candidate diff.** The integration-candidate file list and mobile
      release scope were reviewed, and unrelated shared-working-tree changes were
      excluded from the candidate claim. Reconfirm the clean state after the final
      docs amendment. **Owner:** Codex. **Receipt:** reviewed file list on
      `codex/sdk57-patch-alignment` and scoped strict-gate output.
- [x] **Pin the SDK 57 EAS runtime to Node `22.23.1`.** This
      machine's Node 24 root install hit `canvas@3.2.3`/ClangCL.
      `pnpm install --ignore-scripts` was a
      local relink workaround, not an acceptable clean-install receipt. Source
      engines and every EAS profile now use Node `22.23.1`; pnpm remains `9.0.0`.
      **Owner:** Codex. **Receipt:** source gate, resolved EAS config, and the
      exact-runtime frozen install in the next item.
- [x] **Install the frozen SDK 57 lockfile without bypassing lifecycle scripts.**
      Exact Node `22.23.1` and pnpm `9.0.0` completed the full frozen workspace
      install with lifecycle scripts enabled; Canvas loaded its published
      prebuilt binary. **Owner:** Codex. **Receipt:**
      `pnpm install --frozen-lockfile` under Node `22.23.1`, exit 0, followed by
      the focused verification ladder.
- [x] **Set the candidate web origin deliberately.** The resolved production
      value is `EXPO_PUBLIC_LUPI_WEB_URL=https://lupi.live`; no secret, LAN, or
      localhost value is present. **Owner:** Product owner + Codex. **Receipt:**
      sanitized resolved production EAS config.
- [x] **Record the remote dependencies independently.** The acceptance baseline
      records the deployed service's ready state, version, release tag, and
      timestamp separately from the app candidate. A future Expo Go/TestFlight
      session must recapture the remote identity it actually loads. **Owner:**
      Codex. **Receipt:** live `/health` snapshot below.
- [x] **Record the current live service health snapshot.**
      `https://lupi.live/health` returned `ready: true`, version
      `2026-07-20.remote-science-data.1`, release tag
      `7cd75aaf346f362f29bb51d6b22677fb44e1e644`, and release timestamp
      `2026-08-14T11:50:14.750703Z`. **Owner:** Codex. **Receipt:** live endpoint
      response. This identifies that check only; the future native acceptance run
      must capture the remote identity it actually loads.
- [x] **Deploy the Gallery-capable web bridge to the production origin.** Exact
      revision `7cd75aaf346f362f29bb51d6b22677fb44e1e644` is live at
      `https://lupi.live`. Public `/health` identifies that revision; the browser
      manifest contains exactly 30 unique tools, including
      `lupi.open_gallery_example` and `lupi.assess_asset`; the edge manifest
      contains exactly seven; and the public Gallery bridge matrix passed for all
      24 stable IDs. **Owner:** Codex + Product owner. **Receipt:** live health,
      both public manifests, deployment identity, and public-origin Gallery matrix.
- [ ] **Freeze the new native scope for the candidate.** Review the exact
      `@reactvision/react-viro` `2.57.5` pin, `@expo/metro-runtime` and
      `expo-font` dependencies, the exact Viro package extension supplying
      `@expo/config-plugins` `57.0.7`, and removal of the historical SDK 55
      Babel/Router extension because newer Router releases fix project-root
      resolution upstream. Review the Viro/camera-sanitizer/font plugins,
      built-in `ios.deploymentTarget` `17.6`, SDK 57's required New Architecture
      with the obsolete config flag absent, nested
      NativeTabs API, `sdk-57` EAS images, `appVersion` runtime policy, explicit
      WebView/DOM/reanimated/worklets/Metro-config dependencies, and archive
      contents. Rive and `react-native-wgpu` remain absent. Any native
      dependency/plugin change requires a new binary and candidate gate.
      **Owner:** Product owner + Codex. **Receipt:** final dependency, lockfile,
      resolved-config, and generated-native diff review.

### Required local command receipts

Run from the repository root unless noted. Capture the full command, exit code,
timestamp, and meaningful warnings; “it ran before” is not a receipt.

```powershell
pnpm --filter @lupi/mobile check:testflight
pnpm --filter @lupi/mobile test
pnpm --filter @lupi/mobile typecheck
pnpm --filter @lupi/mobile lint
pnpm --filter @lupi/mobile check:expo
pnpm --filter @lupi/mobile export:web
pnpm --filter @lupi/mobile export:ios
pnpm --filter @lupi/mobile check:eas-archive
```

The checked receipts below were captured in the clean integration worktree. The
final SHA changes when source or documentation is amended, so capture
`git rev-parse HEAD` afterward; the app/source checks remain bounded local
receipts and do not complete G1 by themselves.

- [x] **The non-release source configuration and asset gate passes on SDK 57.** It
      checks linked Expo identity, version policy, store profile/origin, and
      1024-pixel icon/splash PNG properties. **Owner:** Codex. **Receipt:** current
      `check:testflight` output and exit 0.
- [x] **The full local verification ladder passes on SDK 57.** It completed the
      source and resolved-production config gates, 108/108 tests, typecheck,
      zero-warning lint, Expo dependency compatibility, the 34-command required
      visual flow plus 8-command isolated AR diagnostic,
      contract, a 20-route web export with 1,457 server modules and 1,425 web
      modules, and a clean unsigned iOS export with 1,826 modules and 4.4 MB
      HBC. Doctor also passed 20/20 and native
      autolinking discovered 41 modules. **Owner:** Codex. **Receipt:** terminal
      command/output and exit 0 on `codex/sdk57-patch-alignment`.
- [x] **Preserve the completed SDK 56 ladder as historical evidence.** Commit
      `42536acd` retains 105/105 tests, typecheck, zero-warning lint, Expo
      dependency/config checks, Doctor 21/21, 41-module autolinking, a 20-route
      web export, a 1,796-module/4.5 MB unsigned iOS export, visual/workflow
      contracts, and the 92-file/1,660,534-byte archive. None of those receipts
      proves SDK 57. **Owner:** Codex. **Receipt:** historical SDK 56 commit and
      command ledger.
- [x] **Preserve the completed SDK 55 ladder as historical evidence.** Commits
      `d33e7aeb` and `1a56e398` retain the frozen install, 105/105 tests,
      typecheck, zero-warning lint, Expo dependency/config checks, Doctor 19/19,
      20-route web export, 1,392-module/3.7 MB unsigned iOS export, local
      visual/workflow contracts, browser matrices, and 92-file/1,707,990-byte
      archive. None of those receipts proves SDK 57. **Owner:** Codex.
      **Receipt:** historical SDK 55 command ledger and commits.
- [ ] **Make the strict release gate fully green.** Its required-file tracking
      and clean scoped-Git checks passed before the docs amendment; the only
      failure is the absent numeric `submit.production.ios.ascAppId`. **Owner:**
      Codex + Apple Account Holder. **Receipt:** `check:testflight:release` output
      after App Store Connect creation and the final docs amendment.
- [x] **Mobile unit tests pass on the Room candidate: 108/108.** Coverage
      includes strict AR scene/session/handoff/build-policy contracts, config/release
      identity, molecule/route caps, saved-view and XYZ
      validation, WebView bridge compatibility/recovery/session/navigation/share,
      Settings/Library models, bounded runtime-error recovery, MCP normalization,
      and recent decoding. **Owner:** Codex. **Receipt:**
      `test` output and exit 0. This is not a device receipt.
- [x] **The integrated-candidate TypeScript check passes.** **Owner:** Codex.
      **Receipt:** current SDK 57 `typecheck` output and exit 0 under TypeScript
      `6.0.3`.
- [x] **The SDK 57 lint check passes with zero warnings.** **Owner:** Codex.
      **Receipt:** current `lint` output and exit 0.
- [x] **Expo dependency compatibility passes reproducibly.** `check:expo`
      validates all 30 installed Expo-managed packages against
      `expo/bundledNativeModules.json` from the installed SDK and fails closed
      on an incompatible fixture. The mutable online upgrade feed is not used
      as a release gate. **Owner:** Codex. **Receipt:** `check:expo` output and
      exit 0 plus the positive/negative unit tests.
- [x] **The SDK 57 Expo web export completes with 20 reported routes.** It
      bundled 1,457 server modules and 1,425 web modules. Treat it only
      as a browser-fallback bundling receipt, not proof of an iOS binary or native
      layout. **Owner:** Codex. **Receipt:** `export:web --clear` output and route
      count on the SDK 57 checkpoint.
- [ ] **Refresh browser QA on the SDK 57 export.** The historical SDK 55 QA passed
      at 320x693 and 390x844 after the header/tab overlap fix, but it is not a
      current SDK 57 or physical-iPhone receipt. **Owner:** Codex. **Receipt:**
      current before/fix/after browser QA record.
- [x] **The clean unsigned iOS export completes on the SDK 57 checkpoint.** It
      reported 1,826 modules and a 4.4 MB HBC bundle.
      “Clean” means `export:ios --clear` regenerated output; it does not mean
      native project generation. Treat it only as an iOS JavaScript/assets bundle
      smoke, not code signing, an IPA, EAS build, App Store processing, or device
      behavior.
      **Owner:** Codex. **Receipt:** current `export:ios --clear` output and exit 0.
- [x] **Expo Doctor passes 20/20 checks.** **Owner:** Codex. **Receipt:**
      `pnpm dlx expo-doctor@latest` output from `apps/mobile` on the integrated
      candidate.
- [x] **Native autolinking discovers 41 modules.** This is a dependency graph
      receipt, not a native compile or device result. **Owner:** Codex.
      **Receipt:** current SDK 57 autolinking output.
- [x] **Resolve and inspect public Expo config.** Name, scheme, version, bundle
      identifier, icon/splash paths, plugins, linked project ID, and the public
      `https://lupi.live` origin were reviewed. EAS remote build number `1` is a
      separate remote-version receipt, not a local `ios.buildNumber` field.
      **Owner:** Codex. **Receipt:** sanitized public and production config
      snapshots.
- [ ] **Start the app locally at least once.** Use
      `pnpm --filter @lupi/mobile start` on the same LAN, or
      `pnpm --filter @lupi/mobile start:tunnel` when LAN discovery is unavailable.
      This is an Expo Go development smoke only and cannot satisfy TestFlight G5.
      **Owner:** Codex + User. **Receipt:** Metro URL, device/Expo Go version, and
      observed screen list.

### Source and product review before cloud build

- [x] **Review declared Room permissions and native plugins at source/config
      level.** Source now declares Viro `2.57.5`, camera-only usage copy, and a
      local config sanitizer that removes Viro's unused microphone, photo-library,
      and location iOS descriptions. The built-in `ios.deploymentTarget` field
      explicitly sets the ViroKit-compatible minimum to `17.6`. Android blocks
      microphone, location, storage,
      and media permissions. DocumentPicker remains system-mediated. Associated
      Domains are still absent. The effective signed Info.plist, entitlements,
      Android manifest, permission prompts, and runtime network behavior remain
      G3/G5 inspections. **Owner:** Codex. **Receipt:** resolved Expo config,
      [`app.json`](../apps/mobile/app.json), and
      [`with-viro-camera-only.js`](../apps/mobile/plugins/with-viro-camera-only.js).
- [x] **Complete the Codex source/data-flow review.** Search, remote WebView and
      XYZ memory, bounded local recents, short-lived in-memory AR sessions,
      camera-only Room intent, user-triggered sharing/diagnostics,
      remote-page analytics/auth, build services, and the current SDK set are
      documented. This is not Product/Legal approval and does not complete Apple's
      privacy answers; those remain open in G4. **Owner:** Codex. **Receipt:**
      [`testflight-notes.md`](../apps/mobile/store/testflight-notes.md#source-level-privacy-and-native-config-review).
- [x] **Document App Review native-value risk.** The reviewer draft explains the
      native curated Gallery, grouped Library/recents, bounded file import,
      action-sheet controls, trajectory playback, native ARKit Room, sharing,
      recovery/diagnostics/accessibility, exact-origin safety, and saved-view
      handoff around an honestly disclosed web-backed renderer. Product approval
      and Apple's review remain external. **Owner:** Codex. **Receipt:**
      [`testflight-notes.md`](../apps/mobile/store/testflight-notes.md#app-review-native-value-rationale)
      and Apple's
      [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
- [x] **Decide the first-beta OTA boundary.** The candidate includes
      `expo-updates`, an `appVersion` runtime policy, the linked update URL, and
      named EAS channels. A development update is active for runtime `1.0.1`,
      group `27fd1483-2d23-40f5-95cd-a52eeb1a8a45`, exact clean revision
      `7cd75aaf`; it was exercised in the compatible installed binary. The
      focused follow-up requires a landed same-runtime update. Before every later Viro,
      permission, plugin, deployment-target, SDK, Metal, or other native
      compatibility change, increment the app version and ship a new binary.
      Remote web/Worker releases remain
      independently identified. **Owner:** Product owner + Codex.
      **Receipt:**
      [`testflight-notes.md`](../apps/mobile/store/testflight-notes.md#first-beta-delivery-and-ota-decision).
- [x] **Review deep-link expectations.** The `lupi` custom scheme exists, but
      Universal Links/Associated Domains are not configured. Acceptance criteria
      and beta notes do not promise automatic `https://lupi.live/view/...`
      opening in-app. **Owner:** Product owner + Codex. **Receipt:** resolved
      config and tester copy.
- [x] **Marketing version and runtime are both `1.0.1` in source.**
      **Owner:** Product owner + Codex. **Receipt:** [`app.json`](../apps/mobile/app.json),
      [`package.json`](../apps/mobile/package.json), and the source gate.
- [x] **Initialize and record the remote iOS build number.** EAS owns the remote
      app-version source. Pre-build inspection initialized build number `1`, and
      `eas build:version:get --platform ios --profile production` confirmed it.
      A later internal development artifact used earlier version/build
      `1.0.0 (1)`; no production/store build or Apple upload exists. Query the effective
      number again immediately before production. Once Apple receives a build,
      never reuse its number. **Owner:** Product owner + Codex. **Receipt:**
      remote-version command output and version/build ledger.
- [x] **Source icon and splash bytes meet the intended roles.** The iOS icon is
      1024x1024 RGB without alpha; the splash mark is a distinct 1024x1024 RGBA
      image with alpha. **Owner:** Design/Product + Codex. **Receipt:** passed
      source gate and [`app.json`](../apps/mobile/app.json).
- [ ] **Review icon and launch presentation on the signed app.** Confirm the
      icon is legible and unclipped and the splash renders correctly on supported
      iPhones. **Owner:** Design/Product + Tester. **Receipt:** G5 screenshots from
      the exact binary.
- [x] **Keep the completed Expo mutation bounded.** The authenticated action
      linked `@alexwelcing/lupi` without starting a build or requesting Apple
      credentials. A later, separately authorized development-build lane is
      recorded in G3; no Apple upload or tester invitation followed from the
      linking action. **Owner:** Codex. **Receipt:** Expo login/project/config
      result and separate development-build ledger.
- [ ] **Make no further external mutation or spend without authorization.**
      Apple registration, credentials, any further remote-version mutation,
      builds, submission, and tester invitations still require their G2
      approvals. **Owner:** Codex. **Receipt:** explicit scoped authorization.

G1 remains open. The integrated candidate has the complete local ladder and a
compatible live bridge, but no durable current-source Expo Go launch is recorded,
the strict release gate still needs the numeric App Store Connect ID, the new SDK
57/runtime-1.0.1 source lacks a signed binary, signed icon/splash behavior is
untested, and the post-amendment full SHA still must be entered in the final
release ledger.

## G2 — user-required Expo and Apple inputs

The user/account holder owns these attestations. Codex may explain fields and
prepare sanitized config, but it cannot infer legal identity, accept contracts,
approve spend, or invent account access.

### Expo account and execution authority

- [x] **The Expo owner is selected.** The authenticated owner is
      `alexwelcing`. **Owner:** User. **Receipt:** non-secret `eas whoami` result
      and [`app.json`](../apps/mobile/app.json).
- [x] **The acting Expo account is authenticated and can resolve the project.**
      **Owner:** User + Codex. **Receipt:** successful Expo login/account and EAS
      project/config resolution; no session token is stored.
- [x] **EAS project creation/linking is complete.** Project
      `@alexwelcing/lupi`, ID `38c55c8d-b7dc-4bec-ab5e-1809eda6bf9d`, matches
      the owner and slug in source. **Owner:** User + Codex. **Receipt:**
      [`app.json`](../apps/mobile/app.json) and EAS project resolution.
- [x] **Approve the completed development EAS usage or billing consequence.** The
      user authorized the development-build lane that produced
      `2b57a89e-e398-44a8-b799-871b7f8e3651`. This approval does not authorize a
      production build, visual-workflow run, submission, or future paid usage;
      those retain their exact downstream gates. **Owner:** User. **Receipt:**
      dated scoped authorization and finished build ID; no payment details in Git.
- [ ] **Approve the exact public WebView origin for the build.** Default is
      `https://lupi.live`, and the production EAS config currently resolves that
      exact value; an override changes the WebView and share trust boundary.
      **Owner:** Product owner. **Receipt:** explicit release approval of scheme and
      host, still pending despite the source/config value.

### Apple Developer and App Store Connect authority

- [x] **Select the intended Apple Account identity.** Use the user's existing real
      Apple Account as the preferred Account Holder login; do not create a
      throwaway release identity. This records the account-choice narrative only,
      not login access, membership, or contract authority. **Owner:** User.
      **Receipt:** explicit user direction.
- [ ] **Complete or confirm Apple Developer Program organization enrollment.**
      Organization enrollment is mandatory for this release path; do not substitute
      an individual membership. Confirm the existing Apple Account is the Account
      Holder for the correct legal organization team. **Owner:** Apple Account
      Holder/User. **Receipt:** organization name, Team ID, membership status,
      expiry date, and required organization-verification record; no credentials.
      The development artifact is signed by `Alex Welcing Individual`, Team ID
      `26Y4SLFJ4M`, through 2027-08-10; that is evidence of development signing,
      not the intended Lupine Science organization enrollment.
- [ ] **Confirm the legal seller/entity and contract authority.** The Account
      Holder must approve the correct legal identity. **Owner:** Apple Account
      Holder. **Receipt:** entity/team selection.
- [ ] **Accept current Apple agreements.** App creation or upload can be blocked
      by a pending agreement. **Owner:** Apple Account Holder. **Receipt:** App Store
      Connect agreements status and date.
- [ ] **Confirm the acting App Store Connect role is sufficient.** App creation
      generally requires Account Holder, Admin, or App Manager access; submission
      and TestFlight management need the corresponding app access. **Owner:** User.
      **Receipt:** role and app-access scope.
- [ ] **Confirm `live.lupi.app` is registered or available on the intended
      team.** Do not switch teams or bundle IDs implicitly. **Owner:** Apple Account
      Holder + Codex. **Receipt:** Apple identifier record.
- [ ] **Choose credential custody.** Approve EAS-managed iOS credentials or a
      documented bring-your-own distribution certificate/provisioning workflow.
      Separately choose Apple sign-in versus an App Store Connect API key for
      submission. **Owner:** Apple Account Holder. **Receipt:** method and custodian,
      never key contents.
- [ ] **If using an App Store Connect API key, provide it through the approved
      secure channel.** Record only Issuer ID, Key ID, access scope, and custodian in
      the release ledger; never commit the `.p8` key. **Owner:** Apple Account
      Holder. **Receipt:** `eas credentials --platform ios` confirms configuration.

### App record, beta, legal, and tester inputs

- [ ] **Approve App Store Connect app-record fields.** Platform iOS, app name,
      primary language, bundle ID, SKU, and user access must be exact. **Owner:**
      Product owner + Apple Account Holder. **Receipt:** approved field sheet.
- [ ] **Confirm product name availability.** App Store Connect name availability
      is external truth and is not established by `app.json`. **Owner:** User.
      **Receipt:** created app record or availability result.
- [ ] **Provide beta contact and tester-facing copy.** Supply beta description,
      what to test, feedback email, contact name/phone/email, and any sign-in/demo
      instructions. **Owner:** Product owner. **Receipt:** approved TestFlight copy.
- [ ] **Choose internal testers and groups.** Provide authorized App Store
      Connect users and the intended internal group. **Owner:** Product owner.
      **Receipt:** group name and tester roster, handled as personal data.
- [ ] **Decide whether external TestFlight is in scope.** If yes, provide tester
      groups, invitation route, beta-review contact, review notes, and demo account
      if the app requires it. The first external build may require Beta App Review.
      **Owner:** Product owner. **Receipt:** explicit internal-only or external-beta
      decision.
- [ ] **Provide support and privacy destinations.** Confirm public support URL
      and privacy-policy URL, plus marketing URL if used. **Owner:** Legal/Product.
      **Receipt:** live public URLs and content review.
- [ ] **Approve the App Privacy answers.** Answers must include the native app,
      remote WebView, service providers, analytics/auth, user-selected molecular
      files, diagnostics, and any tracking—not just native package imports.
      **Owner:** Legal/Product. **Receipt:** approved questionnaire and date.
- [ ] **Confirm export-compliance declaration.** Source declares
      `ITSAppUsesNonExemptEncryption: false`; the Account Holder/legal owner must
      confirm that remains accurate for the app and included third-party code.
      **Owner:** Legal/Apple Account Holder. **Receipt:** written attestation and
      App Store Connect answer.
- [ ] **Provide copyright and content-rights attestation.** Confirm the app name,
      icon, molecular content, remote web content, and third-party assets may be
      distributed. **Owner:** Legal/Product. **Receipt:** approved copyright line
      and rights record.
- [ ] **Prepare eventual store metadata without mislabeling it as a TestFlight
      gate.** Category, age rating, description, keywords, screenshots, and review
      notes are required for an App Store release path, but a complete store listing
      is not evidence of TestFlight device acceptance. **Owner:** Product/Design.
      **Receipt:** metadata draft and asset manifest.
- [ ] **Authorize the exact external mutations.** Record separate permission to
      (1) make any further remote build-number change, (2) create/register Apple
      identifiers and app record, (3) start the paid/quota-consuming build,
      (4) upload, and (5) invite testers. Project linking and the recorded remote
      build-number `1` do not authorize these remaining actions. **Owner:** User.
      **Receipt:** dated approvals with scope.

## G3 — EAS project, signing, and production iOS build

Run EAS commands from `apps/mobile`, as required for a monorepo app. Use the
current CLI explicitly unless the repo later pins it:

```powershell
Set-Location apps/mobile
npx --yes eas-cli@21.7.0 login
npx --yes eas-cli@21.7.0 whoami
```

### Project linking and build configuration

- [x] **Authenticate to the approved Expo account.** Login resolves to
      `alexwelcing`. **Owner:** User + Codex. **Receipt:** sanitized `eas whoami`
      result; no session token stored.
- [x] **Link the project under the approved owner.** The resolved project is
      `@alexwelcing/lupi`, ID `38c55c8d-b7dc-4bec-ab5e-1809eda6bf9d`.
      **Owner:** Codex. **Receipt:** EAS project/config result and
      [`app.json`](../apps/mobile/app.json).
- [x] **Review every source change made by linking.** The integration-candidate diff
      confirms owner `alexwelcing` and project ID
      `38c55c8d-b7dc-4bec-ab5e-1809eda6bf9d` with no unrelated linking change.
      **Owner:** Codex. **Receipt:** focused candidate diff and resolved project
      identity.
- [x] **Inspect the resolved EAS project identity.** Local owner/slug, bundle ID,
      remote project ID, production profile, environment, and viewer origin resolve
      consistently. Production resolves store distribution, `autoIncrement`, Node
      `22.23.1`, the `sdk-57` image, `https://lupi.live`, and project ID
      `38c55c8d-b7dc-4bec-ab5e-1809eda6bf9d`. **Owner:** Codex. **Receipt:**
      sanitized EAS production config result. This is configuration truth, not
      build truth.
- [x] **Confirm production is the TestFlight build lane.** The current
      `preview` profile uses internal/Ad Hoc distribution and may require registered
      device UDIDs; it is not the App Store/TestFlight artifact. Use
      `production` for the store-signed candidate. **Owner:** Codex. **Receipt:**
      passed source gate and [`eas.json`](../apps/mobile/eas.json).
- [x] **Pin the EAS Node runtime in source.** Every build profile resolves Node
      `22.23.1`. **Owner:** Codex. **Receipt:** passed source gate, resolved
      production config, and [`eas.json`](../apps/mobile/eas.json).
- [x] **Verify the complete development builder environment.** Confirm pnpm/corepack
      behavior, SDK 57 dependencies and `sdk-57` image, and the actual EAS
      macOS `26.5.2`/Xcode `26.6` image. Recheck
      that its Xcode/iOS SDK meets Apple's current upload minimum. **Owner:** Codex.
      SDK 57 build `2960e909-355d-46b0-8394-013786627180` is the builder receipt
      for exact SHA `7cd75aaf`; the production/store lane still needs its own
      builder receipt. **Receipt:** terminal EAS build profile/image and current
      requirement link.
- [x] **Resolve the public WebView origin in production EAS config.** The current
      production config resolves `EXPO_PUBLIC_LUPI_WEB_URL=https://lupi.live`.
      **Owner:** Codex. **Receipt:** non-secret EAS config result. Product approval
      and the eventual build-log value remain separate open checks.
- [x] **Build and identify the Room development client before TestFlight.** Viro
      custom native code cannot run in Expo Go. Authorized non-simulator internal
      build `2960e909-355d-46b0-8394-013786627180` finished for exact clean SHA
      `7cd75aaf346f362f29bb51d6b22677fb44e1e644`, version/build `1.0.1 (1)`,
      bundle `live.lupi.app.dev`, for the registered iPhone; SHA-256 is
      `2909E5EC183C6F294B699DFFBDB692989BCDC650498D28CF0A3EB7120006E44A`.
      The app and embedded ViroKit both target iOS `17.6`. It is distinct from
      the production store/TestFlight binary, and no physical Room acceptance is
      implied. **Owner:** Codex + User. **Receipt:** finished EAS build,
      artifact/provisioning inspection, and registered-device ledger.
- [x] **Record the active development update without treating it as device
      acceptance.** Channel `development` points to runtime `1.0.1`, group
      `27fd1483-2d23-40f5-95cd-a52eeb1a8a45`, exact clean revision `7cd75aaf`.
      It ran in the compatible signed binary during the partial device session;
      the follow-up needs its own landed update identity. **Owner:** Codex.
      **Receipt:** EAS Update branch/channel/group output.
- [x] **Regenerate and audit the staged SDK 57 EAS upload archive allowlist.** The
      current archive contains exactly 95 files totaling 1,690,897 bytes (about
      1.61 MiB), and every byte matches current source. **Owner:** Codex. **Receipt:**
      [`check-eas-archive.mjs`](../apps/mobile/scripts/check-eas-archive.mjs),
      regenerated `apps/mobile/.verify-artifacts/mobile-eas-archive`, and
      [`.easignore`](../.easignore). This is not an upload or build.
- [x] **Preserve the SDK 56 archive receipt as historical.** At commit
      `42536acd`, the archive contained 92 files totaling 1,660,534 bytes and
      passed its allowlist and byte-match audit. That receipt does not describe
      SDK 57. **Owner:** Codex. **Receipt:** the historical SDK 56 commit and
      command ledger.
- [x] **Preserve the SDK 55 archive receipt as historical.** At commit
      `1a56e398`, the standalone archive contained 92 files totaling 1,707,990
      bytes (about 1.63 MiB) and passed its allowlist and byte-match audit. That
      count and size do not describe SDK 57. **Owner:** Codex. **Receipt:** the
      historical SDK 55 archive ledger.

- [x] **Record the bounded EAS pre-build inspection result.** The inspection
      initialized remote iOS build number `1`, then stopped at Apple signing
      because no Apple account credentials were supplied; output staging was
      empty and that inspection produced no build/upload. A later authorized
      development build is recorded above. `eas build:version:get` confirms `1`.
      **Owner:** Codex. **Receipt:** sanitized inspect and remote-version output.
- [ ] **Generate and inspect an iOS native project in a supported environment.**
      Direct `expo prebuild --platform ios --no-install` on Windows stopped with
      Expo's macOS/Linux-only requirement. Do not call that a passed native
      prebuild. The earlier signed IPA proves EAS generated and compiled native
      output for `7c64bd70`, but no generated-project diff for the integrated
      source has been reviewed. **Owner:** Codex. **Receipt:** successful
      supported-host prebuild or EAS builder output plus generated
      Info.plist/entitlement inspection.
- [ ] **Inspect effective Room native configuration.** Confirm the generated
      iOS project links the expected Viro/ARKit code, keeps New Architecture,
      contains the approved camera usage description, and does not retain
      microphone, photo-library, or location usage keys. Reconcile entitlements,
      privacy manifests, linked SDKs, and any permission-related build warnings.
      The earlier `1.0.0 (1)` IPA includes ViroKit and only the camera usage key,
      but its minimum iOS value is 15.1, so it does not prove the source-level
      `17.6` fix. **Owner:** Codex + Privacy reviewer. **Receipt:** generated-native
      diff and sanitized effective Info.plist/entitlements from the exact build SHA.
- [x] **Keep simulator evidence out of the Room lane.** Viro `2.57.5` excludes
      `arm64` for the iOS simulator. The required build-and-capture and reusable
      capture-only workflows now stop at the Caffeine viewer and native
      Gallery/Library/Settings shells. AR runs only in a separate manual,
      capture-only simulator diagnostic that reuses an existing `build_id`, so
      its failure cannot block required screenshots. Workflow run
      `019ffcbc-514a-7466-b530-b241452a07bc` reached the AR deep link and then
      returned to the iOS Home Screen before `ar-room-intro`, consistent with
      the documented Viro simulator architecture boundary. This is not
      tracking, camera, placement, occlusion, gesture, or physical-AR evidence.
      **Owner:** Codex. **Receipt:** isolated Maestro flows, three validated EAS
      workflow schemas, run recording/failure screenshot, and JUnit assertion.

### iOS identifiers and signing

- [ ] **Register or select App ID `live.lupi.app` on the approved Apple team.**
      **Owner:** Apple Account Holder + Codex. **Receipt:** Apple bundle-ID record.
- [ ] **Generate or select the distribution certificate.** If EAS manages it,
      record its non-secret fingerprint/expiry; if self-managed, record custodian
      and expiry. **Owner:** Apple Account Holder + Codex. **Receipt:** credentials
      inventory without private material.
- [ ] **Generate or select the App Store provisioning profile.** Confirm bundle
      ID, team, certificate, and expiry. **Owner:** Apple Account Holder + Codex.
      **Receipt:** profile identity, not the private file in Git.
- [ ] **Inspect credentials before building.** Run the supported EAS credentials
      inspection flow and ensure there are no stale/revoked selections. **Owner:**
      Codex. **Receipt:** sanitized credentials summary.
- [ ] **Verify export-compliance config reaches the native app.** Confirm the
      resolved iOS Info.plist reflects the user-approved declaration. **Owner:**
      Codex + Legal. **Receipt:** resolved config/build artifact inspection.

### Production build

- [x] **Require the production Gallery bridge receipt before building.** The
      configured `https://lupi.live` origin must already expose the deployed
      `lupi.open_gallery_example` tool and matching Gallery assets. Reconcile its
      public manifest, web revision, and Worker revision with the G1 receipt;
      do not build a fixed binary against an incompatible known remote runtime.
      **Owner:** Codex + Product owner. **Receipt:** linked G1 deployment receipt
      and production-origin smoke result. Exact live revision `7cd75aaf` has 30
      browser tools, seven edge tools, and a passing public 24-item Gallery matrix.
- [ ] **Re-run all G1 checks on the exact build SHA.** **Owner:** Codex.
      **Receipt:** a single local verification bundle tied to the full SHA.
- [x] **Initialize the remote build-number baseline.** Marketing/runtime version
      `1.0.1`,
      remote app-version source, and `production.autoIncrement: true` are
      configured; remote iOS build number `1` is confirmed. This does not prove
      what number a future authorized production build will consume. **Owner:**
      Codex. **Receipt:** `eas build:version:get` result and build-number ledger.
- [ ] **Confirm the effective remote build number immediately before build.**
      Re-run the version query and record the number that the authorized build
      will auto-increment/consume; never infer it from the current baseline.
      **Owner:** Codex. **Receipt:** just-in-time remote-version output and build
      ledger.
- [ ] **Start one authorized production iOS build.** From `apps/mobile`, run:

  ```powershell
  npx --yes eas-cli@21.7.0 build --platform ios --profile production
  ```

  **Owner:** Codex with user authorization. **Receipt:** command, EAS build ID,
  build URL, start time, and account/project identity.

- [ ] **Wait for a terminal EAS status and inspect the logs.** A queue entry or
      upload start is not success. **Owner:** Codex. **Receipt:** terminal `finished`
      status, end time, and reviewed warning/error summary.
- [ ] **Record artifact identity.** Capture EAS build ID/URL, app version, iOS
      build number, Git commit, Expo project ID, bundle ID, Apple Team ID, build
      profile, builder image/Xcode version, public web origin, and artifact URL or
      checksum where available. **Owner:** Codex. **Receipt:** build ledger row.
- [ ] **Inspect the produced app metadata.** Verify display name, bundle ID,
      minimum iOS target, version/build, icon presence, entitlements, permissions,
      and export-compliance flag. **Owner:** Codex. **Receipt:** artifact metadata
      report.
- [ ] **Do not mark TestFlight complete.** A successful EAS build proves only
      the build lane until Apple accepts and processes that exact build. **Owner:**
      Codex. **Receipt:** G3 status remains distinct from G4.

## G4 — App Store Connect and TestFlight

### Create and verify the App Store Connect app

- [ ] **Create the app record before upload.** In App Store Connect, add an iOS
      app using the approved name, primary language, bundle ID `live.lupi.app`, SKU,
      and access scope. **Owner:** Apple Account Holder/Admin/App Manager.
      **Receipt:** App Store Connect app URL and numeric Apple ID.
- [ ] **Verify the app record points to the intended Apple team and bundle ID.**
      **Owner:** Codex + Apple Account Holder. **Receipt:** app-information capture.
- [ ] **Record the numeric App Store Connect app ID.** Configure
      `submit.production.ios.ascAppId` in a separately reviewed source change if the
      team chooses non-interactive submissions; it is absent from current source.
      **Owner:** Codex. **Receipt:** numeric ID and focused config diff.
- [ ] **Complete required beta information.** Add beta description, what to
      test, feedback email, contact details, and review/demo information where
      required. **Owner:** Product owner. **Receipt:** App Store Connect beta-info
      capture.
- [ ] **Complete the privacy-policy, export-compliance, content-rights, and other
      prompts that Apple presents for this build.** **Owner:** Legal/Product/Apple
      Account Holder. **Receipt:** completed-status capture and approved answers.

### Submit the exact production build

- [ ] **Select the exact successful G3 artifact.** Do not submit “latest” unless
      its build ID, SHA, version, and build number have been compared to the ledger.
      **Owner:** Codex. **Receipt:** selected-build reconciliation.
- [ ] **Upload through EAS Submit.** From `apps/mobile`, run the supported iOS
      submission flow and explicitly select the G3 build:

  ```powershell
  npx --yes eas-cli@21.7.0 submit --platform ios --profile production
  ```

  **Owner:** Codex with user authorization. **Receipt:** submission ID, selected
  EAS build ID, App Store Connect app ID, command output, and terminal status.

- [ ] **Verify Apple received the expected bundle/version/build.** Submission
      success is not enough; reconcile identifiers in App Store Connect. **Owner:**
      Codex. **Receipt:** App Store Connect build row.
- [ ] **Wait for Apple processing to finish.** Record processing failures or
      warnings, including missing compliance information. **Owner:** Codex + Apple.
      **Receipt:** processed status and UTC timestamp.
- [ ] **Confirm no unintended build is selected for testing.** **Owner:** Product
      owner + Codex. **Receipt:** exact version/build attached to the target group.

### Internal TestFlight gate

- [ ] **Create or select the internal tester group.** **Owner:** Product owner.
      **Receipt:** group name and App Store Connect URL.
- [ ] **Add only approved internal App Store Connect users.** **Owner:** Product
      owner/Apple Admin. **Receipt:** sanitized roster and invitation status.
- [ ] **Assign the processed build to the internal group.** **Owner:** Product
      owner/Apple Admin. **Receipt:** group/build association and timestamp.
- [ ] **Confirm at least one intended tester receives access.** **Owner:** User.
      **Receipt:** invitation/access confirmation without exposing personal data.
- [ ] **Record the 90-day TestFlight expiry shown by Apple.** **Owner:** Codex.
      **Receipt:** expiry timestamp from App Store Connect/TestFlight.

### Optional external TestFlight gate

- [ ] **Keep external testing closed unless G2 explicitly includes it.**
      **Owner:** Product owner. **Receipt:** scope decision.
- [ ] **Create an external tester group and approved invitation method.**
      **Owner:** Product owner/Apple Admin. **Receipt:** group, tester limit, and
      invitation configuration.
- [ ] **Submit the first external build for Beta App Review when required.**
      Supply accurate review notes, contact information, and demo credentials if
      applicable. **Owner:** Product owner + Apple Admin. **Receipt:** beta-review
      submission and status.
- [ ] **Resolve any Beta App Review rejection before inviting external users.**
      **Owner:** Product owner + Codex. **Receipt:** resolution and approved build.
- [ ] **Assign only the approved build to the external group.** **Owner:** Apple
      Admin. **Receipt:** build/group association and invitation result.

### G4 truth boundary

- [ ] **Record TestFlight availability without claiming App Store release.** A
      processed beta assigned to testers is TestFlight truth only. It does not prove
      physical use, App Review approval for production, phased release, or public
      App Store availability. **Owner:** Codex. **Receipt:** release-truth ledger.

## G5 — physical iPhone acceptance

Use the TestFlight binary, not Expo Go. Test the exact version/build from G4 on
at least one supported physical iPhone. For every run, record device model,
iOS version, TestFlight app version, app version/build, Git SHA, test date,
network type, configured web origin, deployed web revision, and Worker revision.

### Install, identity, and launch

- [x] **Install the signed development build on the registered target iPhone.**
      Build `2960e909…`, version/build `1.0.1 (1)`, launched on an iPhone 15 Pro
      running iOS 26.6. This is development-build evidence, not TestFlight or a
      complete G5 pass. **Owner:** User/tester. **Receipt:** product-owner report
      dated 2026-08-14 and the physical-acceptance worksheet.
- [ ] **Install from TestFlight on the target iPhone.** **Owner:** User/tester.
      **Receipt:** TestFlight build screen and installed version/build.
- [ ] **Confirm the installed identity.** App name is Lupi, icon is correct,
      bundle/version/build match the ledger, and there is no placeholder Expo icon
      or template art. **Owner:** Tester. **Receipt:** home-screen and settings/build
      screenshots.
- [ ] **Cold-launch successfully.** No crash, blank screen, endless splash, or
      unexpected login appears. **Owner:** Tester. **Receipt:** screen recording and
      device log if failed.
- [ ] **Exercise the root error boundary with a safe test fault.** The fallback
      shows the correct version/build context, preserves local-history expectations,
      and Retry recovers without a crash loop. **Owner:** Codex + Tester.
      **Receipt:** controlled fault and screen recording.
- [ ] **Background, foreground, terminate, and relaunch.** State recovery is
      understandable and the app remains responsive. **Owner:** Tester. **Receipt:**
      acceptance notes.
- [ ] **Check safe areas and orientation policy.** No tab, control, title, or
      system gesture target is clipped by the notch, Dynamic Island, home indicator,
      or keyboard. **Owner:** Tester. **Receipt:** screenshots.

### Native navigation and discovery

- [ ] **Navigate Gallery → Viewer → Back → Library repeatedly.** The root Viewer
      hides the tab bar, Back returns to the originating tab, tabs preserve
      sensible state, and repeated opens never stack duplicate Viewer routes.
      Horizontal rotation in either direction must not dismiss the Viewer;
      interactive back-swipe is disabled and only the explicit Back button exits.
      **Owner:** Tester. **Receipt:** screen recording.
- [ ] **Open the `/import` route and return.** The thin route presents the native
      import screen and dismissal/back behavior is correct. **Owner:** Tester.
      **Receipt:** route trace.
- [ ] **Open Settings > About & Diagnostics.** Confirm native version/build,
      bundle, Expo project ID, EAS/Git fields when available, viewer origin, and
      parsed remote `/health` identity match the release ledger. Share a sanitized
      report. **Owner:** Tester + Codex. **Receipt:** report and screenshot with no
      secrets/personal data.
- [ ] **Verify the complete native Gallery.** It opens in the dark UI with exactly
      24 curated cards and accurate names, formulas, atom/frame counts, and
      thumbnails or intentional thumbnail fallbacks. **Owner:** Tester + Codex.
      **Receipt:** full-list capture and catalog comparison.
- [ ] **Search through the native header.** Search `aspirin`; confirm the single
      21-atom Aspirin card remains and the result count is announced. Clear it,
      enter a no-match query, verify the native empty/reset state, then return to
      all 24 without stale results. **Owner:** Tester. **Receipt:** screen recording
      with VoiceOver announcement notes.
- [ ] **Filter through the iOS action sheet.** Exercise Featured, Molecules,
      Materials, Trajectories, and All Structures; reconcile each count to the
      bundled catalog and confirm search/filter composition plus Reset. **Owner:**
      Tester + Codex. **Receipt:** action-sheet and result screenshots.
- [ ] **Test Gallery layout and offline boundaries.** Rotate the iPhone and use
      large Dynamic Type to exercise one/two-column adaptation. In airplane mode,
      bundled metadata/search/filter remain usable; remote thumbnails or opening
      may fail honestly rather than fabricating an offline render. **Owner:**
      Tester. **Receipt:** layout and network-condition matrix.
- [ ] **Exercise Gallery allowlist and atom caps.** Supported IDs with canonical
      counts at or below 50,000 work; an unknown ID, mismatched count, or value
      above 50,000 is rejected before the viewer. **Owner:** Tester + Codex.
      **Receipt:** exact safe fixtures and result screenshots/logs.

### Library and local recents

- [ ] **Create recents from Gallery selections.** Confirm compact native rows,
      labels, formulas/tags, routes, and ordering render correctly under Recent
      Structures rather than as large web-style cards. **Owner:** Tester.
      **Receipt:** before/after screenshots.
- [ ] **Verify Library and Settings responsibilities.** Library contains compact
      Recent Structures plus its clear/empty/error states. Settings contains Open
      XYZ File, saved-view input, privacy details, and About & Diagnostics. Both
      remain reachable and accessible in the dark theme. **Owner:** Tester.
      **Receipt:** screen recording at default and large Dynamic Type.
- [ ] **Kill and relaunch the app.** Valid recents persist through
      `expo-sqlite/kv-store`. **Owner:** Tester. **Receipt:** relaunch evidence.
- [ ] **Confirm bounded storage.** More than 12 eligible recents leaves at most
      12, in the intended order. **Owner:** Tester. **Receipt:** test sequence and
      final list.
- [ ] **Confirm repeat IDs deduplicate.** The first valid decoded record wins and
      duplicates do not multiply in Library. **Owner:** Codex + Tester. **Receipt:**
      unit-test receipt plus device observation.
- [ ] **Confirm invalid or over-cap persisted records are not opened.** Use only
      a safe test fixture or debug-supported path; never corrupt a tester's real
      storage. **Owner:** Codex. **Receipt:** unit/instrumented evidence and expected
      Library result.
- [ ] **Confirm imported XYZ files do not appear in recents.** This is the
      current intentional limitation. **Owner:** Tester. **Receipt:** import and
      Library screenshots.
- [ ] **Confirm Clear is destructive and confirmed.** Cancel leaves all recents
      intact; confirming Clear removes them, shows the empty grouped state, and
      remains cleared after relaunch. **Owner:** Tester. **Receipt:** cancel/confirm
      recording and relaunch screenshot.

### WebView viewer and bridge controls

- [ ] **Open Aspirin from Gallery in Viewer.** The configured
      `/?load#/embed/mobile` page loads, bridge readiness resolves,
      `lupi.open_gallery_example` receives ID `aspirin`, and only the intended
      21-atom structure appears without Safari, an MCP overlay, browser chrome,
      or a stale default molecule. **Owner:** Tester + Codex. **Receipt:** Gallery
      tap, bridge response/log, screenshot, load duration, origin, and deployed
      web/Worker revisions.
- [ ] **Open representative molecule, material, and trajectory cards.** Confirm
      each stable Gallery ID reaches its canonical web Gallery scene rather than
      an arbitrary raw URL load. Include `This is Water` (450 atoms, 120 frames).
      **Owner:** Tester + Codex. **Receipt:** source card and viewer captures.
- [ ] **Verify the compatibility gate.** A supported legacy-v0 or dated
      `asset-export` bridge and all nine base tools permit ordinary loads;
      Gallery loads additionally require `lupi.open_gallery_example`. A
      controlled wrong-family/version, missing-base-tool, or missing-gallery-tool
      fixture remains blocked with the expected actionable error. **Owner:**
      Codex + Tester. **Receipt:** cases, remote identity, and results.
- [ ] **Test Fit.** The full structure is visible without clipping. **Owner:**
      Tester. **Receipt:** before/after screenshot.
- [ ] **Test the Camera action sheet.** Isometric, Top, Front, and Side each
      produce a distinct responsive camera state; Cancel changes nothing and
      disabled state is announced before bridge readiness. **Owner:** Tester.
      **Receipt:** action sheet plus before/after captures.
- [ ] **Test the Appearance action sheet.** Studio, Paper, Blueprint, and Deep
      Field remain legible and visibly distinct; Cancel changes nothing.
      **Owner:** Tester. **Receipt:** action sheet and screenshots.
- [ ] **Test trajectory playback from More.** On `This is Water`, Play advances
      the 120-frame trajectory and Pause stops it without resetting the current
      structure. Repeat rapidly enough to expose stale-command behavior without
      stress-abusing the device. **Owner:** Tester. **Receipt:** screen recording
      with bridge responses or visible frame evidence.
- [ ] **Test the remaining More actions.** Hide Bonds and Show Bonds preserve
      atoms; Reset returns documented defaults; Reload recovers to ready without
      duplicating the initial Gallery command. **Owner:** Tester. **Receipt:**
      before/after captures and reload timing.
- [ ] **Verify toolbar accessibility and responsive labels.** Fit, Camera, Look,
      More, Share, and Room remain reachable at large Dynamic Type and narrow width;
      VoiceOver announces labels, hints, disabled state, menus, and Cancel in a
      sensible order. **Owner:** Accessibility tester. **Receipt:** audit notes
      and screen recording.
- [ ] **Test foreground-resume recovery.** Background a ready viewer, return to
      active state, and confirm the correlated probe either restores a compatible
      status or reloads after the 2.5-second timeout. **Owner:** Tester. **Receipt:**
      screen recording and timing.
- [ ] **Test WKWebView content-process recovery where practical.** A terminated
      content process reports the native recovery message and reloads without an
      infinite loop. **Owner:** Codex + Tester. **Receipt:** controlled test/device
      logs.
- [ ] **Re-test the reported React `#185` failure on iPhone.** Opening Gallery
      structures must never expose minified framework text. If a controlled
      maximum-update-depth fault is injected, the first failure performs one
      cache-busted reload and a repeat stops at the native retry state without an
      infinite loop. **Owner:** Codex + Tester. **Receipt:** device video and
      sanitized diagnostics.
- [ ] **Test loading, bridge timeout, HTTP error, and manual recovery states.**
      The UI must not imply an automatic retry/backoff policy that does not exist.
      **Owner:** Tester + Codex. **Receipt:** controlled failure cases.
- [ ] **Test repeated and rapid controls.** No stale response, wrong request
      correlation, app hang, or unbounded queue appears. **Owner:** Tester.
      **Receipt:** interaction recording and any logs.

### Native Room AR on a physical iPhone

- [ ] **Use the exact development/TestFlight binary on a supported physical
      iPhone.** Record EAS build ID, artifact checksum, full Git SHA, native
      runtime version, app version/build, iPhone model, iOS version, remote
      viewer/Worker identities, room conditions, and test date. Expo Go and the
      simulator are explicitly invalid Room runtimes. Existing signed build
      `2960e909…` proves the `1.0.1 (1)` / iOS `17.6` artifact was installed on
      an iPhone 15 Pro running iOS 26.6, but no physical Room AR ledger exists.
      **Owner:** Tester + Codex.
      **Receipt:** identity ledger and installed-build screenshot.
- [ ] **Verify the Expo Go boundary separately.** In Expo Go, tapping Room must
      show the custom-development-build requirement without a crash, false camera
      prompt, or false AR success. **Owner:** Tester. **Receipt:** Expo Go version
      and screen capture.
- [ ] **Review privacy before camera access.** Room explains why the camera is
      needed before iOS prompts. The system requests camera only after the user
      starts AR; no microphone, photo-library, or location prompt appears. Deny
      once, verify the actionable denied state, open Settings, grant access, and
      return successfully. **Owner:** Privacy reviewer + Tester. **Receipt:**
      sequence recording and effective Info.plist comparison.
- [ ] **Verify camera lifecycle and data boundary.** The camera indicator appears
      only while Room is active and ends after closing it. Inspect sanitized
      device/network logs to confirm the AR feature does not upload camera frames
      or persist XYZ/model bytes. **Owner:** Privacy/Security reviewer. **Receipt:**
      indicator recording, network observation, and log review.
- [ ] **Open Room through the correlated viewer handoff.** Load water and
      caffeine, wait for bridge readiness, tap Room, and confirm `lupi.export_xyz`
      produces the active molecule directly without Safari, browser chrome, the
      MCP overlay, a stale/default structure, or a second copy after re-entry.
      **Owner:** Tester + Codex. **Receipt:** bridge IDs/tool/molecule, screenshots,
      and transition timing.
- [ ] **Exercise handoff failures before camera mount.** A stale molecule,
      wrong request/tool, bridge error, timeout, malformed/non-finite XYZ,
      count drift, unsupported element, and 513-atom structure must stop with an
      actionable native error. No AR session payload may enter route parameters
      or durable storage. **Owner:** Codex + Tester. **Receipt:** controlled safe
      fixtures, result matrix, and storage/route inspection.
- [ ] **Discover and place on real surfaces.** In a real room, detect both a
      horizontal surface (table/floor) and vertical surface (wall), verify useful
      coaching during limited tracking/no planes, then tap to place at the
      intended hit-test location. Repeat under bright, dim, low-texture, and
      cluttered conditions. **Owner:** Tester. **Receipt:** video and condition
      matrix with drift/failed-hit notes.
- [ ] **Validate manipulation.** One-finger drag moves the placed molecule;
      pinch scales within its bounded range; two-finger rotation is smooth;
      gestures compose without jumps, accidental dismissal, or system-gesture
      conflicts; re-place/reset returns to plane selection. **Owner:** Tester.
      **Receipt:** continuous interaction recording.
- [ ] **Validate atom interaction and scientific readout.** Tap an atom to show
      the expected element/index. Tap a second atom and compare the displayed
      angstrom distance against the source coordinates within the documented
      calculation precision. Selection highlighting and haptics remain clear
      after scale, rotation, drag, and re-place. Repeat the same selection and
      measurement through the native Inspect Atoms sheet with VoiceOver enabled.
      **Owner:** Chemistry reviewer +
      Tester. **Receipt:** fixture calculation, UI capture, and result.
- [ ] **Validate visual integration.** Atom colors/radii and inferred bonds are
      scientifically recognizable; centering and initial physical scale are
      useful; lighting and shadows remain legible; people occlusion behaves
      plausibly where supported; molecule depth/order is stable while walking
      around it. Record unsupported-device behavior honestly. **Owner:** Design +
      Chemistry reviewer + Tester. **Receipt:** multi-angle video and notes.
- [ ] **Exercise tracking and app lifecycle recovery.** Cover/uncover the camera,
      move rapidly, leave and return to the room, background/foreground, lock/
      unlock, interrupt with a system prompt, rotate if supported, close, and
      reopen. No duplicate scene, stale session, crash loop, camera leak, or
      permanently false-ready state may remain. **Owner:** Tester + Codex.
      **Receipt:** scenario matrix and device logs.
- [ ] **Measure bounded performance.** Test water, caffeine, representative
      medium structures, and a safe near-512-atom/near-2,048-bond fixture. Record
      export/parse/entry/placement latency, steady interaction frame pacing,
      peak memory, thermal state, battery impact, visual degradation, and crashes
      over a predefined session. The caps are safety limits, not performance
      guarantees. **Owner:** Performance tester + Codex. **Receipt:** raw
      measurements and pass/fail thresholds.
- [ ] **Complete an AR accessibility/safety review.** VoiceOver describes Room
      entry, privacy, state, close/re-place, selected atom, measurement, denial,
      and errors; Dynamic Type does not obscure critical controls; instructions
      do not depend on color alone; tester guidance warns users to stay aware of
      real surroundings. **Owner:** Accessibility/Product reviewer. **Receipt:**
      audit notes and captures.

### Navigation and share security boundary

- [ ] **Keep exact-origin navigation embedded.** Normal navigation within the
      configured origin remains in the WebView. **Owner:** Tester. **Receipt:** URL
      and observed destination.
- [ ] **Open an external HTTP(S) link only from an explicit top-frame tap.** It
      should leave the app for Safari/system browser. **Owner:** Tester. **Receipt:**
      interaction recording.
- [ ] **Confirm redirects, subframe requests, synthetic/non-user navigation, and
      custom schemes do not escape the allowlist.** Use benign controlled fixtures.
      **Owner:** Codex + Security reviewer. **Receipt:** test cases and outcomes.
- [ ] **Test Share.** The app calls `lupi.encode_view_url`, waits for the matching
      response, accepts only the exact configured origin, and presents the iOS share
      sheet with the encoded URL. **Owner:** Tester. **Receipt:** share-sheet capture
      with sensitive destination redacted if needed.
- [ ] **Reject a wrong-origin or malformed share result.** No attacker-controlled
      URL reaches the native share sheet. **Owner:** Codex. **Receipt:** unit or
      controlled-integration result.

### Native XYZ import

- [ ] **Import a small valid `.xyz` file.** File picking succeeds, validation
      completes before injection, and the molecule appears in Viewer. **Owner:**
      Tester. **Receipt:** safe fixture, file size/atom count, and screenshots.
- [ ] **Read the disclosure before import.** The UI clearly states that selected
      coordinates enter the configured remote WebView page in memory. **Owner:**
      Product/Privacy reviewer + Tester. **Receipt:** device screenshot and approved
      copy.
- [ ] **Import a valid XYZ with a blank comment line.** It remains aligned with
      the browser parser through comment materialization. **Owner:** Tester + Codex.
      **Receipt:** fixture and rendered result.
- [ ] **Reject a non-`.xyz` extension.** The file is not injected. **Owner:**
      Tester. **Receipt:** fixture and error copy.
- [ ] **Reject a malformed XYZ header/body.** The file is not injected.
      **Owner:** Tester. **Receipt:** fixture and error copy.
- [ ] **Reject a file over 2,000,000 bytes.** **Owner:** Tester + Codex.
      **Receipt:** generated safe fixture metadata and error copy.
- [ ] **Reject a structure over 50,000 atoms.** **Owner:** Tester + Codex.
      **Receipt:** generated safe fixture metadata and error copy.
- [ ] **Reject non-finite, overlong, or out-of-bound coordinates.** Coordinate
      tokens are limited and absolute coordinate values must stay within the source
      policy. **Owner:** Tester + Codex. **Receipt:** fixtures and error results.
- [ ] **Cancel DocumentPicker without error.** The previous screen remains
      usable and no partial import is injected. **Owner:** Tester. **Receipt:**
      observed result.
- [ ] **Background during document selection and resume.** The selection result
      is handled once and the app remains stable. **Owner:** Tester. **Receipt:**
      screen recording.

### Saved-view handoff boundary

- [ ] **Open a valid canonical `/view/[slug]` route.** It shows
      `SavedViewHandoffScreen`; it must not embed the saved view in Viewer.
      **Owner:** Tester. **Receipt:** route and screen capture.
- [ ] **Verify the 50,000-atom explanation.** Copy explains that trusted saved
      atom-count metadata is unavailable and in-app rendering is deferred.
      **Owner:** Product reviewer + Tester. **Receipt:** approved copy screenshot.
- [ ] **Confirm no automatic Safari launch.** Merely opening the route performs
      no external navigation. **Owner:** Tester. **Receipt:** screen recording.
- [ ] **Tap the explicit Safari button.** It opens only the configured exact
      origin at the normalized `/view/:slug` path. **Owner:** Tester. **Receipt:**
      source and destination capture.
- [ ] **Reject an invalid or malformed slug.** No WebView embed or external open
      occurs. **Owner:** Tester + Codex. **Receipt:** cases and results.
- [ ] **Do not expect Universal Links.** A public `https://` saved-view link may
      remain in Safari because associated domains are not configured. **Owner:**
      Product owner + Tester. **Receipt:** expectation documented in tester notes.

### Resilience, accessibility, privacy, and performance

- [ ] **Test Wi-Fi, cellular, airplane mode, and a network transition.** Record
      native versus remote-WebView behavior separately. **Owner:** Tester.
      **Receipt:** condition matrix and recovery notes.
- [ ] **Test slow loading and remote outage.** Loading/error/timeout/manual
      reload states remain actionable; no false offline guarantee is claimed.
      **Owner:** Tester. **Receipt:** throttled/outage cases.
- [ ] **Test at default and large Dynamic Type.** Text remains readable and
      controls are not clipped. **Owner:** Accessibility tester. **Receipt:**
      screenshots.
- [ ] **Test VoiceOver focus order and labels.** Tabs, native Gallery header
      search, filter action sheet, cards and counts, grouped Library rows, import,
      viewer toolbar/action sheets, saved-view handoff, and errors are
      understandable without vision. **Owner:** Accessibility tester. **Receipt:**
      audit notes/video.
- [ ] **Test the dark UI and color-independent status.** Gallery, Viewer,
      Library, Settings, action sheets, modals, loading, and errors remain legible and
      consistent under both iOS system appearance settings; status meaning never
      relies on color alone. **Owner:** Accessibility tester. **Receipt:**
      screenshots and contrast notes.
- [ ] **Test Reduce Motion and interaction target sizes.** Motion remains safe
      and tappable controls meet the team's accessibility target. **Owner:**
      Accessibility tester. **Receipt:** settings and results.
- [ ] **Exercise representative structures near the supported cap.** Record
      load time, interaction responsiveness, memory pressure, thermal behavior,
      battery impact, and crashes; do not extrapolate from a small molecule.
      **Owner:** Performance tester + Codex. **Receipt:** device/build-specific
      measurements.
- [ ] **Inspect device and service logs for secrets or raw private coordinates.**
      Imported XYZ data and account tokens must not appear unexpectedly in logs,
      analytics, or crash breadcrumbs. **Owner:** Privacy/Security reviewer.
      **Receipt:** sanitized log review.
- [ ] **Review the in-app privacy cards against observed behavior.** Search,
      remote viewer/XYZ memory, on-device recents, WebView storage, and external-
      link statements must be accurate for the shipped remote revision. **Owner:**
      Privacy reviewer + Tester. **Receipt:** approved comparison and screenshot.
- [ ] **Complete a crash-free acceptance session.** Define duration and actions
      before the run. **Owner:** Tester. **Receipt:** session protocol, duration,
      result, and crash diagnostics check.
- [ ] **Record every failure against the exact binary and remote revisions.**
      **Owner:** Codex. **Receipt:** issue links using the template below.

## G6 — post-test feedback and next-candidate loop

- [ ] **Collect TestFlight feedback, screenshots, and crash reports.** Reconcile
      Apple feedback with direct tester reports; do not assume an empty dashboard
      means no issue. **Owner:** Product owner + Codex. **Receipt:** dated feedback
      export/summary.
- [ ] **Normalize each issue.** Record issue ID, build, Git SHA, device/iOS,
      remote web/Worker revisions, network, exact steps, expected result, actual
      result, reproducibility, severity, evidence, and reporter. **Owner:** Codex.
      **Receipt:** issue tracker entries.
- [ ] **Triage severity consistently.** At minimum: P0 security/data-loss or
      launch blocker; P1 core-flow crash or unusable Viewer/import/search; P2 major
      degradation with workaround; P3 polish/low-impact. **Owner:** Product owner +
      Engineering. **Receipt:** triage decision and owner.
- [ ] **Separate binary bugs from remote-service regressions.** A web/Worker
      change can alter a fixed TestFlight binary; record which lane must be fixed
      and retested. **Owner:** Codex. **Receipt:** reproduction matrix.
- [ ] **Reproduce actionable failures safely.** Preserve tester evidence, avoid
      production data mutation, and add a regression test where practical.
      **Owner:** Codex. **Receipt:** reproduction and test reference.
- [ ] **Fix only on a new candidate revision.** Re-run G1, increment the iOS
      build number, rebuild G3, reprocess G4, and repeat affected G5 cases. Never
      relabel the prior binary. **Owner:** Codex. **Receipt:** old/new candidate
      linkage.
- [ ] **Update known limitations and tester notes.** Include current WebView
      parity architecture, saved-view Safari handoff, lack of Universal Links,
      imports not saved to recents, and any accepted residual issue. **Owner:**
      Product owner + Codex. **Receipt:** approved release notes.
- [ ] **Remove or expire unsafe beta access when necessary.** Stop testing a
      security/privacy-critical or unusable build and notify affected testers.
      **Owner:** Apple Admin/Product owner. **Receipt:** group/build status and
      notification record.
- [ ] **Make an explicit TestFlight go/no-go decision.** List passed gates,
      waived non-blockers with owner/date, open blockers, and the approved next
      audience. **Owner:** Product owner. **Receipt:** signed-off decision record.
- [ ] **Keep App Store release as a separate project gate.** TestFlight success
      does not authorize production App Review submission, pricing/availability,
      phased release, or public launch. **Owner:** Product owner + Apple Account
      Holder. **Receipt:** separate release checklist and authorization.

## Evidence record template

Copy this template into the approved release record. Keep secrets and personal
tester data out of Git.

```text
Candidate label:
Branch:
Final SHA command/result (`git rev-parse HEAD` after all amendments):
Full Git SHA:
Working tree clean (yes/no, explanation):
App version / iOS build:
iOS deployment target:
Candidate UTC timestamp:

Node / pnpm versions:
Install receipt:
Source configuration gate receipt:
Test receipt:
Typecheck receipt:
Lint receipt and warning disposition:
Expo install --check receipt:
Expo Doctor receipt:
Web export receipt:
Web route count:
Visual workflow local/schema receipt:
Visual workflow run ID/status or explicit zero-run receipt:
Browser QA viewports / overlap result:
iOS export receipt:
Resolved public Expo config receipt:

Approved EXPO_PUBLIC_LUPI_WEB_URL:
Deployed web revision:
Edge Worker revision:
Remote health/public verification:
Remote health ready/version/tag/timestamp:
Public browser manifest tool count / lupi.open_gallery_example receipt:
Public Gallery stable-ID smoke receipt:
First-beta OTA decision receipt:
App Review native-value draft receipt:
Codex source/data-flow review receipt:
Product/Legal privacy-answer approval:

Expo account or organization:
Expo project ID and URL:
Resolved production EAS config receipt:
Remote iOS build-number state:
EAS archive file count / byte size / allowlist receipt:
EAS archive audit command/result:
EAS build profile:
EAS build ID and URL:
EAS terminal status and timestamp:
Builder image / Xcode version:
Artifact metadata/checksum:
Earlier development build ID/SHA/version/build/device boundary:
EAS Update channel/runtime/group/SHA/device-acceptance boundary:

Apple team name / Team ID:
Bundle ID:
Distribution certificate fingerprint/expiry (no private material):
Provisioning profile identity/expiry:
App Store Connect numeric app ID:
EAS submission ID:
Apple processed version/build and timestamp:
TestFlight group:
TestFlight availability/expiry:

Physical device model / iOS version:
TestFlight app version:
Gallery/search/filter/action-sheet/playback matrix:
Room AR runtime / permission / handoff receipt:
Room surface / lighting / tracking condition matrix:
Room gesture / atom selection / distance receipt:
Room performance / memory / thermal / battery receipt:
Acceptance protocol and duration:
Acceptance result:
Evidence links:

Open issues and severities:
Waivers with owner and expiry:
Go/no-go owner, decision, and date:
```

## Stop conditions

Stop the build or submission lane and return to the owning gate if any of these
occur:

- The candidate SHA or dependency lock changes after local verification.
- The Expo account, EAS project, Apple team, bundle ID, or App Store Connect app
  does not match the approved identity.
- The effective public WebView origin differs from the approved exact origin.
- The native build is missing Viro/ARKit, requests microphone/photo/location,
  or its effective camera usage copy differs from the approved source.
- Room can mount from an uncorrelated/oversized/malformed export, camera access
  outlives the route, or molecule/camera data is unexpectedly persisted/uploaded.
- The public browser manifest lacks `lupi.open_gallery_example`, advertises an
  unexpected tool contract, or an allowlisted Gallery ID does not open through
  the deployed bridge.
- Signing credentials are expired, revoked, unexpectedly shared, or associated
  with the wrong team.
- App version/build is reused or cannot be reconciled across EAS and Apple.
- A build was started, uploaded, assigned, or exposed to testers without the
  corresponding user authorization.
- Privacy, export-compliance, content-rights, or agreement answers are unknown.
- TestFlight processing selects a different artifact from the G3 ledger.
- A P0/P1 acceptance issue remains open without an explicit owner and no-go
  disposition.

## Repository references

- [Mobile package scripts and dependencies](../apps/mobile/package.json)
- [Expo app configuration](../apps/mobile/app.json)
- [Build-time release metadata config](../apps/mobile/app.config.ts)
- [EAS profiles](../apps/mobile/eas.json)
- [Source/release readiness gate](../apps/mobile/scripts/check-testflight-readiness.mjs)
- [Local TestFlight verification ladder](../apps/mobile/scripts/verify-testflight.mjs)
- [Staged EAS archive audit](../apps/mobile/scripts/check-eas-archive.mjs)
- [EAS archive allowlist](../.easignore)
- [Mobile developer README](../apps/mobile/README.md)
- [Internal beta and App Review notes](../apps/mobile/store/testflight-notes.md)
- [Expo mobile migration and verification guide](mobile-expo.md)
- [Release-truth contract](release-truth-contract.md)
- [Molecule safety policy](../apps/mobile/src/domain/molecules.ts)
- [Mobile Gallery ID allowlist](../apps/mobile/src/domain/mobile-gallery.ts)
- [Native Gallery catalog](../apps/mobile/src/features/gallery/gallery-catalog.ts)
- [Grouped native Library](../apps/mobile/src/features/library/library-screen.tsx)
- [XYZ import validator](../apps/mobile/src/features/import/xyz-document.ts)
- [Native viewer menu contract](../apps/mobile/src/features/viewer/viewer-menu.ts)
- [Browser MCP manifest](../apps/web/public/browser-mcp-manifest.json)
- [Viewer navigation boundary](../apps/mobile/src/features/viewer/viewer-navigation.ts)
- [Viewer share boundary](../apps/mobile/src/features/viewer/viewer-share.ts)
- [Viewer compatibility boundary](../apps/mobile/src/features/viewer/viewer-compatibility.ts)
- [Viewer recovery policy](../apps/mobile/src/features/viewer/viewer-recovery.ts)
- [Native AR scene policy](../apps/mobile/src/features/ar/ar-scene.ts)
- [Ephemeral AR session store](../apps/mobile/src/features/ar/ar-session-store.ts)
- [Viewer-to-AR handoff](../apps/mobile/src/features/viewer/viewer-ar-handoff.ts)
- [Native Room screen](../apps/mobile/src/features/ar/ar-screen.tsx)
- [Viro camera-only config sanitizer](../apps/mobile/plugins/with-viro-camera-only.js)
- [Native diagnostics screen](../apps/mobile/src/features/diagnostics/diagnostics-screen.tsx)
- [Saved-view handoff boundary](../apps/mobile/src/features/saved-view/saved-view-handoff-screen.tsx)

## Official platform references

- [Set up the first EAS Build](https://docs.expo.dev/build/setup/)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Viro Expo integration](https://viro-community.readme.io/docs/integrating-with-expo)
- [Viro AR scene navigator](https://viro-community.readme.io/docs/viroarscenenavigator)
- [Viro AR plane selector](https://viro-community.readme.io/docs/viroarplaneselector)
- [EAS Build introduction](https://docs.expo.dev/build/introduction/)
- [EAS builds in a monorepo](https://docs.expo.dev/build-reference/build-with-monorepos/)
- [Submit an iOS app with EAS Submit](https://docs.expo.dev/submit/ios/)
- [Apple Developer Program](https://developer.apple.com/programs/)
- [Create an App Store Connect app record](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)
- [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
- [Manage App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
