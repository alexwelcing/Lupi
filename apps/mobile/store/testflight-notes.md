# Lupi 1.0.1 internal beta candidate

## Beta description

Lupi for iPhone combines native molecule discovery, bounded XYZ file import,
local recent-history storage, iOS sharing, and an ARKit Room experience with
Lupi's interactive molecular viewer. The standard viewer uses a trusted
`https://lupi.live` WebView while native screens own discovery, validation,
persistence, navigation policy, diagnostics, and the bounded room-scale AR
renderer.

## Candidate identity and evidence boundary

The integration branch is `codex/mobile-testflight-integration`, source
marketing/runtime version is `1.0.1`, Expo SDK is `57.0.12`, React Native is
`0.86.2`, React is `19.2.3`, Expo Router is `57.0.12`, Viro is `2.57.5`, the
built-in iOS deployment target is `17.6`, and the EAS-managed remote iOS build
number baseline is `1`. Every EAS profile uses Node `22.23.1` and the `sdk-57`
image. Record the final full commit with `git rev-parse HEAD` after the docs
amendment; do not copy an earlier SHA into App Store Connect notes. The current
local ladder is green: 105/105 tests, typecheck, zero-warning lint, Expo
dependency check, Doctor 20/20, 20-route web export, clean unsigned iOS export,
local visual contract, EAS workflow schema, and a 92-file/1,656,247-byte archive
audit passed.

Historical local receipts remain separate: SDK 56 commit `42536acd` passed its
105/105 tests, Doctor 21/21, both exports, and 92-file/1,660,534-byte archive;
SDK 55 commit `1a56e398` passed its own ladder and 92-file/1,707,990-byte
archive. Neither checkpoint is a signed or device-tested receipt for SDK 57.

A signed internal development artifact exists as EAS build
`2b57a89e-e398-44a8-b799-871b7f8e3651`, exact clean revision `7c64bd70`,
version/build `1.0.0 (1)`, for one registered iPhone. It predates both source
version `1.0.1`, SDK 57, and the iOS `17.6` deployment-target fix, so it is not a
signed receipt for this candidate. No signed SDK 57 build, visual-workflow run,
App Store Connect creation,
Apple upload, TestFlight processing, or physical Room AR acceptance exists. The
existing development artifact is signed by the `Alex Welcing Individual` team;
mandatory Lupine Science organization enrollment/legal-team verification for
the intended release path remains open.

The compatible remote prerequisite is live at exact revision
`ee0d8885d90ffb3cd37243d0c1eb998c41e4572f`, timestamp
`2026-08-10T19:54:28.637969Z`: the browser manifest contains exactly 30 tools,
including `lupi.open_gallery_example` and `lupi.assess_asset`, and the edge
manifest contains exactly seven. Physical-device compatibility remains a
separate receipt.

## What to test

1. Browse the featured Gallery, search for caffeine, water, aspirin, and a
   material, then open a result and verify that the immersive Viewer replaces
   the tab bar and shows the intended molecule with an atom count.
2. Exercise Iso, Fit, Bonds off, Blueprint, Reset, Share, and Reload.
3. Import a small, non-sensitive `.xyz` file from Files or iCloud Drive. Confirm
   malformed, over-2 MB, and over-50,000-atom inputs are rejected before load.
4. Kill and relaunch the app; confirm recent catalog structures remain in
   Library and Clear removes them.
5. Background and foreground the app, rotate the phone, toggle Airplane Mode,
   and confirm the viewer either recovers or presents an actionable error.
6. Paste a Lupi saved-view link in Settings. Confirm it shows the size-policy
   handoff and opens Safari only after the explicit button press.
7. Test VoiceOver, larger text sizes, landscape, and the iOS share sheet.
8. Attach the report from Settings > About & Diagnostics to every bug.
9. In the Lupi development or TestFlight build, open a small molecule and choose
   Room. Confirm the explanation appears before the camera prompt, scan a table
   and a wall, place the molecule, then drag, pinch, rotate, select two atoms,
   read their distance, and use re-place. Repeat after denying camera access and
   after backgrounding the app.

## Known beta boundaries

- 3D rendering is web-backed and requires network access.
- Saved views open through an explicit Safari handoff until their size can be
  preflighted against the mobile atom cap.
- Imported coordinates enter the trusted remote viewer page's memory. Use only
  synthetic or non-sensitive XYZ data during this beta.
- OAuth login, Universal Links, native export-byte sharing, and replacing the
  standard WebView renderer are outside this first TestFlight candidate. Room is
  a separate native AR renderer capped at 512 atoms and 2,048 inferred bonds.

## First-beta delivery and OTA decision

The candidate includes `expo-updates`, an app-version `runtimeVersion`, the
linked EAS Update URL, and named development, visual, preview, and production
channels. A development update is active for runtime `1.0.0`, group
`0442ed9e-1ebc-4da0-a79c-8750e37641e8`, exact clean revision `7c64bd70`; it has
no device screenshot or acceptance receipt. The new source runtime is `1.0.1`
and requires a compatible `1.0.1` binary before it can receive `1.0.1` updates.
Any Viro, SDK, permission, deployment-target, config-plugin, or other native
change requires a new EAS binary and TestFlight build. Do not tell testers that
an update is available until that specific update has a device receipt.

The trusted remote viewer and edge service at `https://lupi.live` can deploy on
their own release lane. Because those remote bytes are not frozen by the app
binary, every acceptance report must record both the native version/build/Git
identity and the remote `/health` version, release tag, and timestamp observed
by About & Diagnostics.

## App Review native-value rationale

This beta is intentionally hybrid, but it is more than a website shortcut. The
native app owns the iPhone-shaped workflow around the remote 3D surface:

- a native 24-item Gallery with bundled search/filter metadata, canonical atom
  counts, and a global 50,000-atom policy;
- native Files/iCloud Drive selection plus on-device `.xyz` extension, byte,
  atom-count, row, and coordinate validation before WebView injection;
- a bounded, validated local recent-history list with native Library controls,
  plus a separate Settings surface for import, saved-view handoff, privacy, and
  diagnostics;
- native viewer controls, iOS sharing, manual reload, lifecycle recovery, and
  bridge-compatibility checks;
- a camera-consented native ARKit Room surface with bounded on-device molecule
  validation, plane placement, drag/pinch/rotation, atom selection, and distance
  measurement;
- exact-origin WebView navigation/share enforcement and an explicit Safari
  handoff for saved views that cannot yet be size-preflighted; and
- native diagnostics, privacy disclosures, root error recovery, responsive
  layouts, and accessibility semantics.

App Review notes must also be candid that Three.js/R3F rendering, trajectories,
and browser export execution remain in the trusted `https://lupi.live` WebView.
The product owner must approve this rationale and the final reviewer wording;
this source-level draft is not Apple approval.

## Source-level privacy and native-config review

The current source/configuration review found this first-beta data flow:

- Gallery search and filter terms stay on-device against the bundled curated
  catalog. Opening a Gallery item asks the trusted viewer service for the
  allowlisted structure bytes.
- The remote viewer receives molecule commands and validated XYZ coordinates in
  its page memory. Mobile does not persist imported XYZ files to recents and
  does not POST the selected file to a separate mobile upload endpoint.
- Room requests a correlated active-frame XYZ export from that viewer, validates
  it again, and stores it only in a bounded in-memory session that expires after
  ten minutes and is removed when Room closes. Camera frames remain in the
  native ARKit/Viro runtime; the runtime provider is `none` and this feature does
  not upload them.
- Up to 12 validated catalog recents are stored locally through
  `expo-sqlite/kv-store`.
- Share sends an exact-origin saved-state URL to the iOS share sheet only after
  a user action. About & Diagnostics fetches remote health and shares its
  sanitized report only after a user action.
- The embedded remote page may exercise its own analytics or authentication
  behavior. That remote behavior, EAS/Expo build processing, Apple diagnostics,
  and any future SDK must be reconciled separately in the privacy policy and
  App Store Connect privacy answers.

Resolved Expo source declares `expo-router`, `expo-splash-screen`, the built-in
`ios.deploymentTarget` value `17.6`, the pinned Viro plugin, and Lupi's
camera-only Viro sanitizer. It contains an explicit room placement camera
usage description and App Transport Security enforcement, but no microphone,
location, contacts, or photo-library usage description. The earlier signed
`1.0.0 (1)` IPA inspection found ViroKit and only the camera usage description,
but also a 15.1 minimum iOS value; a fresh signed `1.0.1` artifact must verify the
17.6 fix. Source has no Universal Link associated domains. The custom `lupi`
scheme is not a
Universal Link: `https://lupi.live/view/...` links must not be promised to open
automatically in-app. DocumentPicker supplies explicit system-mediated file
selection.

This is a Codex source/data-flow review only. Product/Legal must approve the
actual data inventory, privacy policy, export-compliance answers, and every App
Store Connect disclosure before submission; a signed artifact must still be
inspected for its effective permissions and entitlements.

## Test contact

Set the internal TestFlight feedback email in App Store Connect before inviting
testers. Do not commit private Apple credentials or API keys here.
