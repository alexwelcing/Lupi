# Lupi for iPhone

`apps/mobile` is the Expo Router app for Lupi. Native Gallery, grouped Library,
bounded XYZ import, and viewer controls surround a WebView-backed version of
the existing molecular viewer. The standard shell is eligible for Expo Go only
when the installed iPhone client supports this SDK 57 source checkpoint.
The new **Room** experience is different: it uses Viro's native ARKit runtime
and therefore requires a custom Expo development build or TestFlight binary on
a supported physical iPhone.

The WebView is a parity bridge, not a claim that the web renderer is native.
See [the full Expo migration guide](../../docs/mobile-expo.md) for architecture,
the parity matrix, development-build boundaries, and App Store preparation.
The current source is being integrated on `codex/mobile-testflight-integration`
from deployed `origin/main` revision
`ee0d8885d90ffb3cd37243d0c1eb998c41e4572f`. Record the final clean commit with
`git rev-parse HEAD` after the documentation and native configuration are
complete. A signed development artifact exists for the earlier clean Room
revision `7c64bd702bd50ecf7b161054ced5c2d806e4c780`; it is useful development
evidence, but it is not a signed artifact of the integrated source and is not a
TestFlight or physical-AR acceptance receipt.

## Current release snapshot

- Expo login: `alexwelcing`
- EAS project: `@alexwelcing/lupi`
- EAS project ID: `38c55c8d-b7dc-4bec-ab5e-1809eda6bf9d`
- current integration branch: `codex/mobile-testflight-integration`; it is not a
  frozen release candidate until the changes are committed and the clean full
  SHA is recorded
- current source checkpoint: Expo SDK 57 (`~57.0.12`), React Native `0.86.2`,
  React `19.2.3`, Expo Router `~57.0.12`, TypeScript `~6.0.3`, and a
  deterministic `appVersion` runtime policy. The existing signed
  development artifact remains the earlier SDK 54 `1.0.0 (1)` binary; it is not
  compatible evidence for this source checkpoint.
- iOS version source: EAS remote; build number `1` is initialized
- EAS Node runtime: `22.23.1` in every build profile
- EAS iOS/Android image: `sdk-57`; Viro remains pinned to `2.57.5`, whose peer
  range spans the Expo SDK 55–57 upgrade checkpoints. Expo currently maps the
  SDK 57 iOS image to macOS `26.5.2` and Xcode `26.6`; the actual builder
  environment still needs its own build receipt.
- pnpm supplies Viro's undeclared runtime import through an exact
  `@expo/config-plugins` `57.0.7` package extension. The SDK 55 Babel/Router
  package extension remains removed because newer Router releases fix project-root
  resolution upstream.
- Metro and asset runtime: explicit `@expo/metro-runtime` and `expo-font`
  dependencies, with the corresponding `expo-font` config plugin
- explicit SDK 57 DOM/native runtime lines: `react-native-webview` `13.16.1`,
  `expo-web-browser` `~57.0.2`, `react-native-reanimated` `4.5.1`,
  `react-native-worklets` `0.10.1`, and `@react-native/metro-config` `0.86.2`
- native tab shell: Expo Router's nested `NativeTabs.Trigger`, `.Icon`, and
  `.Label` API; Gallery, Library, and Settings remain the only visible tabs
- production viewer origin resolved by EAS config: `https://lupi.live`
- EAS build runtime: Node `22.23.1`; the repository remains pinned to pnpm
  `9.0.0`. The final full frozen install under that exact Node/pnpm pair passed,
  including loading the published Canvas prebuilt binary.
- dependency audit policy: patched `picomatch`, `brace-expansion`, and
  `js-yaml` transitive releases are forced at the workspace root. The two exact
  `image-size` high-severity advisories remain temporarily allowlisted because
  upstream has no patched release. The native app and web service do not expose
  Metro's ICNS/JXL/HEIF parsers to user input. Pull-request assets remain
  contributor-controlled and therefore retain a CI availability risk; the
  mobile source job is explicitly capped at 45 minutes while the exception is
  active.
- current SDK 57 integration-worktree receipts: 105/105 focused tests,
  typecheck, zero-warning lint, `expo install --check`, the 36-command visual
  contract, a 20-route web export (1,447 server modules and 1,415 web modules),
  a clean unsigned iOS export (1,817 modules and 4.4 MB HBC), Expo Doctor 20/20,
  41-module native autolinking, and an audited 93-file/1,657,510-byte EAS
  archive.
- production EAS config resolved to store distribution, automatic build-number
  incrementing, Node `22.23.1`, the `sdk-57` image, `https://lupi.live`, and the
  linked project ID
- strict release gate: tracked-file and clean scoped-Git checks passed; its only
  failure is the absent `submit.production.ios.ascAppId`
- historical SDK 56 checkpoint at commit `42536acd`: its 105/105 tests,
  Doctor 21/21, 20-route web export, 1,796-module/4.5 MB unsigned iOS export,
  and 92-file/1,660,534-byte archive remain upgrade evidence, not SDK 57 proof
- historical SDK 55 archive audit at commit `1a56e398`: `check:eas-archive`
  passed for 92 allowlisted files totaling 1,707,990 bytes (approximately
  1.63 MiB)
- live service snapshot: `https://lupi.live/health` returned `ready: true`,
  version `2026-07-20.remote-science-data.1`, seven edge tools, release tag
  `ee0d8885d90ffb3cd37243d0c1eb998c41e4572f`, and release timestamp
  `2026-08-10T19:54:28.637969Z`; the browser manifest contains exactly 30
  unique tools, including `lupi.open_gallery_example` and `lupi.assess_asset`
- signed development receipt: EAS build
  `2b57a89e-e398-44a8-b799-871b7f8e3651` finished for exact clean revision
  `7c64bd702bd50ecf7b161054ced5c2d806e4c780`, version/build `1.0.0 (1)`, as a
  non-simulator internal `Lupi Dev` artifact for the registered iPhone; SHA-256
  `54889F7A16A377D2CD2B4ADFD652A6508CFE21C418E77771B5BE10124914441D`
- active development update: iOS runtime `1.0.0`, group
  `0442ed9e-1ebc-4da0-a79c-8750e37641e8`, exact clean revision `7c64bd70`;
  this is channel truth, not a screenshot or device-acceptance receipt
- Expo web-fallback browser QA: 320x693 and 390x844 initially exposed, then
  verified the fixes for header/tab overlap

The complete SDK 55 and SDK 56 source ladders remain historical receipts at
commits `1a56e398` and `42536acd`. The current SDK 57 local ladder and archive
are green, but the final clean commit/release identity is not frozen. No signed
SDK 57 build, TestFlight build, or SDK 57 physical-iPhone result is claimed.

## Quick start on a physical iPhone

Prerequisites:

- Node.js `22.23.1`
- pnpm 9; the verified candidate used `9.0.0`
- a current Expo Go client confirmed to support SDK 57 for Gallery, Library,
  Settings, import, and the WebView viewer; Room AR requires the custom
  development client
- the PC and iPhone on the same reachable Wi-Fi network

On this Windows machine, Node 24 drove an earlier root install into a
`canvas@3.2.3`/ClangCL native-build failure. Use Node `22.23.1` for the current
monorepo install. `pnpm install --ignore-scripts` was only a local relink
workaround; it skips required install work and is not the recommended
verification path. SDK 55 and SDK 56 frozen-install results remain historical;
capture the final SDK 57 frozen-install receipt after the candidate is committed.

From the repository root in PowerShell:

```powershell
pnpm install --frozen-lockfile --filter @lupi/mobile...
Copy-Item apps/mobile/.env.example apps/mobile/.env.local
pnpm --filter @lupi/mobile test
pnpm --filter @lupi/mobile typecheck
pnpm --filter @lupi/mobile lint
pnpm --filter @lupi/mobile check:expo
pnpm --filter @lupi/mobile start
```

Scan the QR code with the iPhone camera or Expo Go. This exercises the hybrid
shell only; Expo Go cannot load `@reactvision/react-viro`, so its Room action
must stop with the development-build explanation instead of attempting AR.

The source now uses Expo SDK 57 as one aligned upgrade, with React Native 0.86
and React 19.2. Use the current App Store Expo Go client only after checking its
physical-device SDK support at test time; iOS cannot install a second, older Expo
Go version side-by-side. That QR path is a hybrid-shell check only. The custom
Viro Room runtime, runtime-version changes, and any future local Metal
module require a Lupi development build. The current SDK 57 local checkpoint is
not physical acceptance; that proof waits for a signed SDK 57 development build. Recheck
[Expo's physical-device note](https://docs.expo.dev/get-started/create-a-project/)
and [development-build FAQ](https://docs.expo.dev/develop/development-builds/faq/)
before changing SDKs.

If LAN discovery is blocked:

```powershell
pnpm --filter @lupi/mobile start:tunnel
```

Tunnel mode makes Metro reachable. It does not expose a separate local Vite
server to the phone.

## Choose the viewer/API base

The default environment file contains:

```dotenv
EXPO_PUBLIC_LUPI_WEB_URL=https://lupi.live
```

That base drives the embedded viewer, curated-gallery thumbnails and source
assets, saved-view links, and service health checks. Keep the default to
exercise the deployed service.

`EXPO_PUBLIC_*` values are embedded in the client bundle. Never put secrets or
private credentials in them.

### Use the local web viewer over LAN

`localhost` on an iPhone is the iPhone. Use the development PC's private IPv4
address.

In terminal 1:

```powershell
ipconfig
pnpm --filter @atlas/web exec vite --host 0.0.0.0
```

Set the address shown for the active adapter, then restart Metro in terminal 2:

```powershell
Set-Content -LiteralPath apps/mobile/.env.local -Value 'EXPO_PUBLIC_LUPI_WEB_URL=http://192.168.1.42:5173'
pnpm --dir apps/mobile exec expo start --clear
```

First open the LAN URL in iPhone Safari. If Safari cannot reach it, check that
both devices are on the same non-guest network, disable a routing VPN, and allow
Node/Vite on the Windows private network.

Gallery metadata and filtering are bundled in the native app and do not depend
on `/mcp`. Opening a card still requires the configured web runtime to contain
the matching gallery asset and the `lupi.open_gallery_example` browser-bridge
tool. Use `https://lupi.live` only after that bridge revision has been deployed;
a local Vite success is not production evidence.

## What is native today

- Expo Router tabs for Gallery, Library, and Settings, presented in the app's
  dark native visual system; Viewer opens as an immersive root-stack detail
  with native Back behavior instead of occupying a permanent tab
- a 24-item curated Gallery whose metadata is bundled for offline browsing;
  iPhone uses the native navigation-bar search field and an iOS action sheet for
  All Structures, Featured, Molecules, Materials, and Trajectories, while the
  list adapts between one and two compact columns for width and Dynamic Type
- a closed gallery-ID allowlist and canonical atom-count table shared by route,
  persistence, and viewer-command validation; every curated item is at or below
  the 50,000-atom mobile cap, and a crafted ID/count pair fails closed
- a maximum 12-record recent-molecule JSON list through `expo-sqlite/kv-store`;
  corrupt, stale, and over-cap persisted entries are revalidated and dropped
  before use, and duplicate IDs collapse to the first valid record
- a focused native Library for success-gated recent structures, including
  durable on-device storage, clear confirmation, empty/loading/error states,
  and exact-route reopen behavior
- a dedicated Settings tab for XYZ import, saved-view handoff, privacy details,
  service status, and About & Diagnostics
- exact-origin saved-view slug/URL normalization and canonical `/view/[slug]`
  routing to a native 50,000-atom policy screen; saved views do not embed or
  auto-open, and Safari opens only after the explicit handoff button
- a thin `/import` route using the iOS document picker and FileSystem to read one
  `.xyz` file, validate it on-device, then inject only the validated text into
  the WebView viewer
- a compact iPhone viewer toolbar for Fit, Camera, Look, More, Share, and Room;
  Camera, Appearance, and More use native iOS action sheets (and an accessible modal
  fallback elsewhere) for camera presets, visual styles, trajectory play/pause,
  bond visibility, Reset, and Reload
- a root-stack Viewer with molecule metadata, native loading/retry states, a
  safe-area-aware toolbar, manual WebView reload, WebKit content-process
  recovery, and an active-app resume probe with timed reload
- a full-screen `/ar` Room route backed by Viro `2.57.5` and ARKit. The Viewer
  requests the active structure with the correlated `lupi.export_xyz` browser
  tool, validates and centers it natively, stores it under a short-lived opaque
  in-memory session ID, and passes only that ID through Expo Router
- a camera-first Room flow with horizontal and vertical plane discovery, tap to
  place, one-finger drag, pinch scale, two-finger rotation, atom selection,
  second-atom distance measurement in angstroms, a native VoiceOver-friendly
  atom inspector and measurement sheet, reset/re-place, people
  occlusion, tracking guidance, lighting, shadows, and haptic feedback
- bounded recovery for embedded React maximum-update-depth failures (including
  production error `#185`): one cache-busted automatic reload, then an
  actionable manual retry without exposing minified framework text
- a bridge compatibility gate that accepts legacy bridge major `0` or the
  dated `asset-export` family from `2026-07-07` onward, requires nine base
  mobile tools, and additionally requires `lupi.open_gallery_example` before a
  curated gallery item can load
- an About & Diagnostics screen that exposes native/EAS/Git identity when
  available, the configured viewer origin, parsed remote `/health` identity,
  a shareable diagnostic report, and explicit privacy-boundary copy
- a root Expo Router error boundary with retry and version/build context
- source-level accessibility labels, hints, roles, live status/error regions,
  responsive layouts, a native Room atom-inspection alternative, and at least
  44-point viewer-control targets; VoiceOver,
  Dynamic Type, contrast, and physical target-size acceptance remain device gates

The Three.js/R3F scene, trajectories, and browser exports execute in the app's
WebView at the chrome-free `/?load#/embed/mobile` entry point. The exact embed
route keeps the typed browser bridge and canvas but omits the browser header,
MCP harness, default-molecule side effect, command deck, and other web controls;
the native screen owns the mobile controls. Saved `/view/:slug` datasets stay
out of that WebView because their atom counts cannot yet be trusted before
load. In-app saved-view rendering is deferred until the service provides
trusted size metadata that can enforce the mobile cap.
Gallery cards never convert a curated item into an arbitrary remote URL. Native
code sends its allowlisted ID through `lupi.open_gallery_example`; the browser
bridge then delegates to the web gallery's canonical open path so scene and
trajectory semantics remain intact. The embedded mobile command deliberately
skips the web-only science-panel bundle, which has no native surface and was a
measurable startup cost for the two Z1 research trajectories.
XYZ import is capped at 2,000,000 UTF-8 bytes and 50,000 declared atoms, with
header/row validation and coordinate tokens capped at 32 characters and numeric
absolute value 1,000,000 before bridge injection. The selected import is not
saved to recents or a durable app library yet. Mobile does not POST the file to
the edge Worker, but this is not a fully local/private renderer: the configured
web origin is remote by default, and coordinates enter that page in memory. The
import UI discloses this before selection.
When an XYZ comment line is blank, native validation inserts
`Imported XYZ structure` into the normalized text before injection so the
browser parser keeps the first atom on the expected third line.

Expo SDK 57 includes the installed `expo-document-picker` `~57.0.1` and
`expo-file-system` `~57.0.2` modules in Expo Go, so XYZ import does not itself
trigger the development-build cut. `copyToCacheDirectory: true` allows the
picked document to be read immediately. See Expo's
[DocumentPicker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/)
and [FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/)
references. A physical iPhone smoke remains the evidence gate.

Native controls cross a typed bridge whose requests and responses carry stable
request IDs. The initial response must match its exact request ID, tool, and
active molecule before the app records a recent item; failures, stale responses,
reload duplicates, status messages, and probes cannot write history.
Room uses the same correlation discipline. It starts only after a successful
`lupi.export_xyz` response matches the pending request, tool, and active
molecule. Native validation limits Room to 512 atoms and at most 2,048 inferred
bonds, rejects malformed/non-finite coordinates and unsupported elements, and
keeps the XYZ/model payload out of URL parameters and persistent storage. The
AR session expires after ten minutes and is removed when the route closes.

Room requests camera access only when the user explicitly starts AR. Its source
configuration removes Viro's unused microphone, photo-library, and location
usage descriptions; the Android configuration also blocks those sensitive
permissions. Camera frames are consumed by ARKit on device and are not uploaded
by this feature. This source/config statement still needs inspection against
the effective signed binary.
Only the exact configured origin remains inside the WebView. Cross-origin
HTTP(S) links open in the system browser only for a top-frame user click;
automatic redirects, subframe clicks, malformed URLs, and other schemes are
blocked.
Share calls browser tool `lupi.encode_view_url`, correlates that response with a
timeout, then requires a bounded HTTP(S) URL from the exact configured origin
before opening the iOS share sheet. Lookalike hosts and `javascript:` values
fail closed. Exported-file handoff to Files or the share sheet is still a
separate, unimplemented parity gate.
Likewise, the app route is not yet an iOS Universal Link: automatic opening of
`https://lupi.live/view/...` requires Associated Domains and TestFlight/device
evidence in the development-build phase.

### Remote prerequisite and remaining device gate

The remote prerequisite is complete: deployed revision
`ee0d8885d90ffb3cd37243d0c1eb998c41e4572f` exposes
`lupi.open_gallery_example`; `/browser-mcp-manifest.json` contains exactly 30
unique browser tools including `lupi.assess_asset`; and the edge manifest
contains exactly seven tools. The deterministic visual contract loads Caffeine
through the Gallery command and fails closed on browser-manifest drift. The
remaining gates are an executed workflow and physical-iPhone proof that a
Gallery card opens the requested molecule directly in the embedded canvas
without Safari, browser chrome, or the MCP configuration overlay.

## Commands

Run these from the repository root:

| Purpose                                      | Command                                               |
| -------------------------------------------- | ----------------------------------------------------- |
| Start Expo on LAN                            | `pnpm --filter @lupi/mobile start`                    |
| Start Metro for an installed development app | `pnpm --filter @lupi/mobile start:dev-client`         |
| Start Expo through a tunnel                  | `pnpm --filter @lupi/mobile start:tunnel`             |
| Run the source configuration/asset gate      | `pnpm --filter @lupi/mobile check:testflight`         |
| Run the stricter tracked-release gate        | `pnpm --filter @lupi/mobile check:testflight:release` |
| Run focused unit tests                       | `pnpm --filter @lupi/mobile test`                     |
| Type-check                                   | `pnpm --filter @lupi/mobile typecheck`                |
| Lint                                         | `pnpm --filter @lupi/mobile lint`                     |
| Check Expo dependency compatibility          | `pnpm --filter @lupi/mobile check:expo`               |
| Audit the staged EAS archive                 | `pnpm --filter @lupi/mobile check:eas-archive`        |
| Run the local TestFlight verification ladder | `pnpm --filter @lupi/mobile verify:testflight`        |
| Capture one web-composition profile          | `pnpm --filter @lupi/mobile visual:web:quick`         |
| Capture the three-profile web matrix         | `pnpm --filter @lupi/mobile visual:web`               |
| Validate the native screenshot workflow      | `pnpm --filter @lupi/mobile check:visual-workflow`    |
| Run the paid native iOS screenshot workflow  | `pnpm --filter @lupi/mobile visual:ios:cloud`         |
| Export the Expo web target                   | `pnpm --filter @lupi/mobile export:web`               |
| Export the unsigned Expo iOS JS/assets       | `pnpm --filter @lupi/mobile export:ios`               |
| Open Expo's web target                       | `pnpm --filter @lupi/mobile web`                      |

Run type-check and both exports sequentially; Expo rewrites generated
`dist`/`dist-ios` output. `export:ios` is a bundle check, not a native compile,
signed `.ipa`, EAS build, or physical-iPhone receipt.

For Expo dependency/config diagnostics:

```powershell
Push-Location apps/mobile
pnpm check:expo
pnpm dlx expo-doctor@latest
Pop-Location
```

### Current SDK 57 checkpoint and historical SDK 55–56 receipts

The SDK 57 local verification ladder is green: source gate, resolved-production
config gate, 105/105 tests,
typecheck, zero-warning lint, Expo dependency compatibility, the 36-command
visual contract, both exports, Expo Doctor 20/20, and 41-module native
autolinking passed. The fresh EAS archive audit also passed for 93 files and
1,657,510 bytes (about 1.58 MiB), every byte matching current source.

| Check                       | Result                                           | Boundary                                                                                                                           |
| --------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| SDK 57 runtime              | Node 22.23.1; pnpm 9.0.0                         | Declared EAS/repository target; capture a final frozen-install receipt after the candidate is committed                            |
| SDK 57 `test`               | 105/105 passed                                   | Current JavaScript/domain contract receipt; not native rendering or physical UI behavior                                           |
| SDK 57 `typecheck`          | Passed                                           | Current TypeScript 6.0.3 static receipt; not runtime behavior                                                                      |
| SDK 57 `check:expo`         | Passed                                           | Current installed Expo package compatibility                                                                                       |
| SDK 57 Expo Doctor          | 20/20 passed                                     | Current Expo project diagnostics                                                                                                   |
| SDK 57 native autolinking   | 41 modules                                       | Dependency-discovery receipt only; not a native compile                                                                            |
| SDK 57 `lint`               | Passed, zero warnings                            | Current static lint receipt only                                                                                                   |
| SDK 57 visual contract      | Passed; 36 commands                              | Local workflow contract only; no paid workflow execution or native screenshot receipt                                              |
| SDK 57 `export:web --clear` | Passed; 20 routes                                | 1,447 server modules and 1,415 web modules; browser-fallback bundling only                                                         |
| SDK 57 `export:ios --clear` | Passed; 1,817 modules, 4.4 MB HBC                | Clean unsigned JavaScript/assets export only                                                                                       |
| SDK 57 `check:eas-archive`  | Passed: 93 files, 1,657,510 bytes                | Fresh allowlisted archive; every byte matches current source; local archive evidence only                                          |
| iOS deployment target       | Resolved source gate passed at `17.6`            | Built-in `ios.deploymentTarget` in `app.json`; not present in the existing signed `1.0.0 (1)` binary                               |
| signed development build    | Finished: `2b57a89e-e398-44a8-b799-871b7f8e3651` | Exact clean SDK 54 `7c64bd70`, internal registered-iPhone artifact, `1.0.0 (1)`; not SDK 57, TestFlight, or physical-AR acceptance |
| active development update   | Published for runtime `1.0.0`                    | Group `0442ed9e-1ebc-4da0-a79c-8750e37641e8`, exact SDK 54 `7c64bd70`; no SDK 57 device screenshot/acceptance receipt              |
| EAS remote version          | iOS build number `1`                             | Initialized remotely; the existing signed development artifact uses `1.0.0 (1)` and no production/store build exists               |
| live `/health`              | Ready with recorded version/tag/time             | Live service identity only; not native compatibility in a shipped binary                                                           |

Historical SDK 56 commit `42536acd` retains its completed local ladder:
105/105 tests, typecheck, zero-warning lint, Expo dependency checks, Doctor
21/21, 41-module autolinking, the 20-route web export, 1,796-module/4.5 MB
unsigned iOS export, visual/workflow contracts, and a
92-file/1,660,534-byte archive. Historical SDK 55 commits `d33e7aeb` and
`1a56e398` retain their completed local
receipts: frozen Node 20.19.4/pnpm 9 install, source gates, 105/105 tests,
typecheck, zero-warning lint, Expo dependency check, Doctor 19/19, 20-route web
export, 1,392-module/3.7 MB unsigned iOS export, local visual/workflow contracts,
and a 92-file/1,707,990-byte archive. Those facts are useful upgrade baselines,
not current SDK 57 proof.

The strict release gate's recorded sole failure was the missing numeric App Store
Connect ID. Rerun it with the complete local ladder after all source changes,
then capture the candidate's final full SHA with `git rev-parse HEAD` in the
release ledger. Direct
`expo prebuild --platform ios --no-install` on Windows stopped with Expo's
macOS/Linux-only iOS-project-generation requirement; that honest failure is not
a native prebuild receipt. The earlier EAS pre-build inspection likewise stopped
before Apple signing and produced no artifact; the later successful development
build is the separate `7c64bd70` / `1.0.0 (1)` receipt shown above.

### Expo web fallback and live-service QA

The current web export reported 20 routes. Initial browser QA at 320x693 and 390x844
found the web-only nested headers colliding with the tab surface. The verified
fix hides nested Stack headers on web and reserves top space in Gallery,
Library, and Settings; the same two viewport profiles then passed without the
header/tab overlap. This validates the exported browser fallback, not
`NativeTabs`, WKWebView, safe areas, gestures, or layout on an iPhone.

The separately observed live `/health` response was:

```text
ready: true
version: 2026-07-20.remote-science-data.1
release tag: ee0d8885d90ffb3cd37243d0c1eb998c41e4572f
release timestamp: 2026-08-10T19:54:28.637969Z
```

That identifies the live service at the time of the check. A future Expo Go or
TestFlight acceptance report must capture the remote identity it actually loads.

## Physical-device smoke checklist

Record the Git SHA, iPhone model, iOS version, and Expo Go or development-client
version, then verify:

1. Gallery shows all 24 curated items in the dark native UI. Search for
   `aspirin` from the native header and confirm only the 21-atom Aspirin card
   remains; clear search and verify all items return.
2. Open the filter action sheet and verify Featured, Molecules, Materials, and
   Trajectories produce the documented non-empty subsets, announce their result
   counts, and reset to All Structures.
3. Open Aspirin and confirm `lupi.open_gallery_example` reaches a visible,
   interactive embedded viewer canvas without Safari, browser chrome, or the MCP
   overlay. Repeat with `This is Water` (450 atoms, 120 frames) and verify Play
   and Pause from More affect trajectory playback.
4. From Library, choose a valid small `.xyz` file in Files or iCloud Drive;
   confirm its atom count and visible viewer result. Confirm wrong-extension,
   malformed, over-2,000,000-byte, over-50,000-atom, long-coordinate-token, and
   over-±1,000,000-coordinate fixtures are rejected before viewer injection.
   Confirm the remote-page disclosure is visible and the import is absent from
   recents after leaving the route. A blank-comment fixture should render with
   `Imported XYZ structure` materialized and its first atom row aligned.
5. Fit, every Camera and Appearance action-sheet choice, both bond states,
   playback, Reset, Share, Reload, and Room receive success or an actionable
   error. In Expo Go, Room must explain that a development build is required.
6. A saved `lupi.live/view/...` URL normalizes through `/view/[slug]`, shows the
   50,000-atom policy without an embedded canvas or automatic browser launch,
   and opens the exact configured URL in Safari only after tapping the button.
7. Gallery selections appear as compact rows in Library after kill and relaunch;
   Clear requires and honors its destructive confirmation, while XYZ import,
   saved-view handoff, privacy, and About remain reachable from Settings.
8. An over-50,000-atom procedural route does not reach the viewer, and stale or
   corrupt recent records do not reach Library navigation; duplicate IDs
   collapse to their first valid record.
9. Same-origin links remain embedded. Only a user-clicked, top-frame external
   HTTP(S) link opens the system browser; automatic/subframe/custom-scheme
   navigation and a lookalike-origin share URL are blocked.
10. Background/foreground, rotation, network loss/recovery, Share, and Reload do
    not leave a false-ready or permanently blocked screen.
11. Background and foreground the app after a viewer load; confirm the resume
    probe either restores compatible ready state or reloads after the bounded
    timeout. Simulate WebKit content-process termination where practical and
    confirm the recovery message plus reload.
12. Open Settings > About & Diagnostics; confirm native version/build, Expo
    project, configured origin, and remote `/health` identity are accurate, then
    share the sanitized diagnostic report.
13. Exercise the root error fallback and its Retry action with a safe test fault.
14. Test VoiceOver focus/labels, Dynamic Type, contrast, Reduce Motion, safe
    areas, and 44-point control targets on the named iPhone.

For the separate native Room acceptance run, install a development or
TestFlight build on an ARKit-capable iPhone and record the exact binary identity.
Verify that the camera explanation appears before the system prompt; denial and
Settings recovery are understandable; a supported molecule exports without
opening Safari; horizontal and vertical planes are discovered; tap places the
molecule at the intended surface; drag, pinch, rotate, select, measure, and
re-place remain responsive; app background/foreground and tracking loss recover
without duplicating the scene; and camera access ends when Room closes. Repeat
with water and caffeine, then exercise a near-512-atom fixture while recording
load time, frame pacing, memory, thermal behavior, and crashes. Confirm that a
513-atom export and a malformed/unsupported-element export fail before the
camera surface mounts. These are physical-device gates; a simulator screenshot
cannot prove tracking, placement, occlusion, gestures, or camera privacy.

A passing web export or simulator check does not replace this iPhone smoke.

## Room AR development-build boundary

The boundary has now been crossed for Room AR. Use a compatible Expo Go client
for fast hybrid-shell iteration only, and the Lupi development client for native
ARKit work. `@reactvision/react-viro` is custom native code and is not bundled
in Expo Go. A missing-native-module result in Expo Go is expected and is not AR
evidence.

Viro is pinned to `2.57.5`, whose peer range supports this SDK 57 / React Native
0.86 checkpoint. Its Expo config plugin
excludes `arm64` for the iOS simulator,
so the existing Apple-silicon `visual-ios` simulator workflow must not be treated
as an AR build receipt and may require a separate non-AR profile. The authoritative
Room feedback loop is a physical ARKit iPhone development build. JavaScript-only
changes can then reload through Metro; native dependency or plugin changes
require a newly built client.

After the owner explicitly authorizes an EAS build, the physical-iPhone loop is:

```powershell
Push-Location apps/mobile
npx --yes eas-cli@21.7.0 build --platform ios --profile development
pnpm start:dev-client
Pop-Location
```

The cloud build can consume quota or incur cost. Do not run it merely because
these commands are documented.

Other reviewed development-build features include:

- the animated companion via `@rive-app/react-native`;
- native WebGPU via `react-native-wgpu`;
- production-like OAuth/OIDC redirects; or
- another reviewed custom native module/configuration.

Rive and React Native WebGPU are also explicit development-build cuts. They
remain Expo projects; they simply run in a Lupi development client instead of
the stock Expo Go binary.

## EAS and App Store status

`app.json` now pins owner `alexwelcing`, project ID
`38c55c8d-b7dc-4bec-ab5e-1809eda6bf9d`, bundle identifier `live.lupi.app`, and
source marketing version `1.0.1` and `appVersion` runtime policy. The authenticated Expo account and
linked project are verified.
`eas.json` uses the remote app-version source, production store distribution,
automatic build-number incrementing, Node `22.23.1`, the `sdk-57` image, the production EAS
environment, and the exact `https://lupi.live` public viewer origin. The remote
iOS build number is initialized to `1`. An earlier pre-build inspection stopped
before Apple credentials and produced no artifact. A later authorized
development build did finish as
`2b57a89e-e398-44a8-b799-871b7f8e3651` for exact clean revision `7c64bd70`,
version/build `1.0.0 (1)`, signed for the registered iPhone. That artifact
predates both the source version `1.0.1` and the iOS `17.6` deployment-target
fix, so it does not validate either change and is not a TestFlight receipt.

The iOS app icon is a 1024x1024 truecolor RGB PNG with no alpha
(`lupi-app-icon.png`). The splash mark is a separate 1024x1024 RGBA PNG with
alpha (`lupi-splash-mark-1024.png`); the web favicon remains `lupi-icon.png`.
These source/byte properties do not prove on-device icon or splash fidelity.

The root [`.easignore`](../../.easignore) is an allowlist. The current SDK 57
archive contains 93 files totaling 1,657,510 bytes (about 1.58 MiB); every byte
matches current source. Historical SDK 56 commit `42536acd` produced a
92-file/1,660,534-byte archive, and historical SDK 55 commit `1a56e398` produced
a 92-file/1,707,990-byte archive. All are local archive-content receipts, not an
upload, native compile, signed artifact, or EAS build.

The app includes `expo-updates`, an `appVersion` runtime policy, and named
development/visual/preview/production channels. A development-channel update is
active for runtime `1.0.0`, group
`0442ed9e-1ebc-4da0-a79c-8750e37641e8`, exact clean SDK 54 revision `7c64bd70`; it has
no device screenshot or acceptance receipt. The SDK 57 source resolves runtime
`1.0.1` and requires a compatible `1.0.1` binary before it can receive updates.
Every SDK, Viro, permission, config-plugin, deployment-target, or other native
compatibility change must increment `app.json`'s version before the new binary
and update are published. The remote viewer/Worker can
deploy independently, so acceptance must record native, update, and remote
identities. The reviewer-facing native-value and privacy
boundary are documented in
[the TestFlight notes](store/testflight-notes.md#app-review-native-value-rationale).

Run future EAS commands from `apps/mobile` only after Apple ownership, build
spend, and submission are explicitly authorized. The intended path uses the
existing real Apple Account as the preferred Account Holder, while mandatory
Apple Developer Program organization enrollment/membership remains open. The
Apple bundle/App Store Connect record, credentials/signing, a production EAS
build, upload, TestFlight processing, and physical-device acceptance also remain
open. Keep local checks, EAS build success, TestFlight behavior, and App Store
release as separate evidence lanes; the
[full guide](../../docs/mobile-expo.md#keep-local-build-and-release-truth-separate)
defines the receipts.
