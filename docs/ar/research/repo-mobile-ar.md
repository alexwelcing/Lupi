# Native Apple AR for Lupi: what's in the repo today

Read-only survey of `/home/user/Lupi` at HEAD `5816359`, done on 2026-10-04. Nothing was edited, built or run. Citations are `path:line`. Where I say something about Apple platforms that the repo doesn't, I mark it **(external, verify)**.

---

## 0. Key findings

1. **A native ARKit experience already exists, and nobody has tried it on a phone.** The Expo app has a full-screen "Room" route built on Viro `2.57.5` and ARKit.
   - It finds horizontal and vertical planes. Tap places the molecule; one finger drags, two fingers pinch and rotate. You can select atoms and measure the distance between two of them.
   - It also has people occlusion, shadows and haptics (`apps/mobile/README.md:250-258`).
   - Limits: 512 atoms and 2,048 bonds, drawn as one Viro sphere per atom. There is no physics and no persistence; the molecule lives in an in-memory session that expires after 10 minutes.
   - Status: "Room AR and the post-fix device retest remain open" (`apps/mobile/README.md:104-108`, `docs/mobile-expo.md:3`).
2. **The docs already name the destination:** "The destination renderer is a local Expo module backed by Swift, MetalKit, and ARKit" (`docs/mobile-macbook-air-handoff.md:183-185`). Two later product decisions say the opposite and need explicit amending:
   - "Immersive XR | **Defer.** … iPhone AR stays on USDZ Quick Look" (`docs/brainstorm/2026-09-viewer-play/decisions.md:28`).
   - "App Clips and a native renderer fork" are deliberately left out (`docs/brainstorm/2026-09-viewer-play/round2/pocket-native-play.md:25`); "there is no native renderer fork" (`…pocket-native-play.md:682`).
3. **AR scale is set three different ways, and none matches the stated policy.** The brainstorm promises "an honest, locked 1 Å = 1 cm" (`…capture-share-loops.md:489`). The code does something else in each of three places (§2.4).
4. **The live viewer's Quick Look button is dead code.** `USDZExportHelper` is mounted (`packages/ui/src/app/ViewerScene.tsx:600`), but its trigger state (`packages/ui/src/ViewerApp.tsx:142`) is never set to `true` anywhere in the repo. The brainstorm noticed this too (`…capture-share-loops.md:536`).
5. **iPad is turned off on purpose, and a check enforces it.**
   - `"supportsTablet": false` is set at `apps/mobile/app.json:17`.
   - The TestFlight gate checks `app.ios?.supportsTablet === false` ("The first candidate is iPhone-only", `apps/mobile/scripts/check-testflight-readiness.mjs:90`).
   - The signed build is Ad Hoc and provisioned only for the one registered iPhone (`docs/mobile-macbook-air-handoff.md:35-37`).
6. **Nothing here can compile for iOS.** This environment is Linux x86_64 with no Xcode or Swift, and the repo has no `.swift`, `.metal` or `.xcodeproj` files. Every GitHub Actions job runs on `ubuntu-latest`. The only proven way to get a signed iOS build is EAS cloud: build `2960e909…` on the `sdk-57` image with Xcode 26.6 (`apps/mobile/README.md:36-38, 91-94`).
7. **No per-user store exists for a "trophy case".**
   - Firestore (`shed-489901`) has only `lupiViews`, `apiKeys`, `rateLimits` and `moleculeLibrary` (`firestore.rules:13-59`).
   - Sign-in is Google and GitHub, on the web only (`packages/ui/src/auth/firebase.ts:68-69`).
   - The mobile app has no auth code. Its only persistence is a list of 12 recents in `expo-sqlite/kv-store` (`apps/mobile/src/storage/recent-molecules.native.ts:1`, `recent-molecules-codec.ts:7`).
8. **The repo has no data for "breakable / rigid / flexible" behaviour.**
   - No bond energies, force constants or vibrational modes; a grep finds none in code or data.
   - The perceived bond graph has a kind (covalent, coordination, ionic contact) but no bond order (`packages/core/src/bonds/types.ts:7`). Only PubChem records carry bond orders (`packages/core/src/pubchem.ts:6`).
   - All the current "toys" are labelled illustrative display offsets, not physics (`AGENTS.md:165`).
9. **Million-atom building blocks exist, all on the web side:**
   - a 953,312-atom Cu FCC file, `massive_1m.glimbin` (10.2 MB, glimbin v1, gzip-compressed);
   - a billion-atom procedural block with brick level-of-detail (LOD);
   - a uniform-grid cluster "splat" LOD (one sphere standing in for many atoms);
   - WGSL compute shaders for GPU culling and bond detection (WGSL is WebGPU's shader language, the closest relative of Metal's).

---

## 1. `apps/mobile`: the Expo app

### 1.1 Identity and configuration

| Item | Value | Cite |
|---|---|---|
| Package | `@lupi/mobile` 1.0.1, entry `expo-router/entry` | `apps/mobile/package.json:2-4` |
| App name / slug / scheme | `Lupi` / `lupi` / `lupi` | `apps/mobile/app.json:3-8` |
| Bundle id (prod) | `live.lupi.app` | `app.json:18`, `app.config.ts:3` |
| Bundle id (dev variant) | `live.lupi.app.dev`, name `Lupi Dev`, scheme `lupi-dev` (`APP_VARIANT=development`) | `app.config.ts:4, 55-56` |
| iOS deployment target | `17.6`, required by ViroKit | `app.json:19`; `docs/mobile-expo.md:66-69` |
| iPad | `supportsTablet: false` | `app.json:17` |
| Orientation / UI style | `default` / `dark` | `app.json:6, 9` |
| Camera permission string | "Lupi uses the camera to place and interact with molecules in your room…" | `app.json:30` |
| Runtime / updates | `runtimeVersion.policy: appVersion`; EAS Update URL | `app.json:10-15` |
| EAS project / owner | `38c55c8d-b7dc-4bec-ab5e-1809eda6bf9d` / `alexwelcing` | `app.json:95, 98` |
| Plugins | expo-router, expo-font, expo-sqlite, expo-web-browser, expo-splash-screen, `@reactvision/react-viro` (`provider: "none"`, no ARCore or semantics), `./plugins/with-viro-camera-only` | `app.json:56-88` |
| Privacy sanitizer | Removes the microphone, photo-library and location usage strings Viro adds | `apps/mobile/plugins/with-viro-camera-only.js:1-19` |
| SDK lines | expo `~57.0.12`, react-native `0.86.2`, react 19.2.3, Viro `2.57.5`, react-native-webview `13.16.1`, expo-haptics, expo-sqlite | `package.json:36-62` |
| Shared code | `@atlas/core: workspace:^`; only `packages/core/src/elements.ts` ships in the EAS archive | `package.json:33`; `.easignore:18` |
| Native folders | `/ios` and `/android` are gitignored (Continuous Native Generation: Expo regenerates them at build time) | `apps/mobile/.gitignore:43-44` |

**EAS profiles** (`apps/mobile/eas.json`):
- `cli.appVersionSource: remote` (`:4`).
- `development`: `developmentClient: true`, internal distribution, `sdk-57` image (`:7-14`).
- `development-simulator`, `visual-ios` (simulator, no credentials), `visual-android` and `preview`.
- `production`: `autoIncrement`, store distribution (`:80-83`).
- `submit.production` is empty `{}` (`:99-101`), so no `ascAppId`.

### 1.2 Screens and navigation (Expo Router)

- **Tabs** use `NativeTabs` from `expo-router/unstable-native-tabs`: Gallery `(explore)`, Library `(library)`, Settings `(settings)` (`apps/mobile/app/(tabs)/_layout.tsx:1-34`).
- **Root-stack routes:**
  - `app/viewer.tsx`, `app/ar.tsx`, `app/import.tsx`, `app/view/[slug].tsx`, `app/diagnostics.tsx`, `app/__visual.tsx`, `app/+not-found.tsx`.
  - `app/ar.tsx:1-27` reads an opaque `session` id, looks up the scene in memory, and removes it on unmount.
- **Gallery:** 24 molecules allowlisted with exact atom counts (`apps/mobile/src/domain/mobile-gallery.ts:1-25`), capped at 50,000 atoms (`apps/mobile/src/domain/molecules.ts:8`).
- **XYZ import:** limited to 2,000,000 bytes and 50,000 atoms (`apps/mobile/src/features/import/xyz-document.ts:3-4`).
- **Biggest files:**
  - `src/features/ar/ar-screen.tsx`: 1,269 lines (AR chrome, inspector, measurement, recovery)
  - `src/features/viewer/viewer-screen.tsx`: 1,090 lines
  - `src/features/ar/molecule-ar-surface.native.tsx`: 360 lines (the Viro scene)

### 1.3 How molecules are drawn

- **Viewer: a WebView around the web viewer, not native.** It loads `${origin}/?load#/embed/mobile` (`apps/mobile/src/config/lupi.ts:60-66`, used at `viewer-screen.tsx:95`). The origin must be `https://lupi.live` in release builds (`lupi.ts:1-2, 36-45`). "The WebView is a parity bridge, not a claim that the web renderer is native" (`apps/mobile/README.md:11`).
- **Room: native Viro/ARKit.**
  1. The viewer asks the WebView for the current frame with the `lupi.export_xyz` tool (8 s timeout) (`src/features/viewer/viewer-ar-handoff.ts:5-6`, `viewer-screen.tsx:623`).
  2. The XYZ is parsed into `lupi.ar-scene.v1` (`src/features/ar/ar-scene.ts:7`).
  3. The scene is stored in memory (`viewer-screen.tsx:472`) and the route receives only the session id.
  - Consequence: Room only works when the WebView has already loaded the molecule.

### 1.4 TestFlight readiness and CI

- **`scripts/check-testflight-readiness.mjs`** (577 lines) checks source and configuration only. It asserts:
  - app name, slug and owner, EAS project UUID, bundle id (`:69-80`);
  - **iPhone-only** (`:90`);
  - remote build numbers;
  - pnpm `9.0.0` plus audit overrides and exceptions;
  - Viro pinned at `2.57.5` (`:220-226`);
  - deployment target `17.6` (`:256-262`);
  - Viro providers disabled and the privacy sanitizer present (`:284-299`).
  - `--release` additionally requires a numeric `submit.production.ios.ascAppId` (`:466-471`), which is missing. The README says that is the strict gate's only failure (`README.md:74-75`).
- **`scripts/verify-testflight.mjs:4-15`** runs, in order:
  1. `check:testflight`
  2. the resolved Expo config check and its tests
  3. unit tests
  4. `tsc`
  5. ESLint
  6. `check:expo`
  7. the visual-workflow contract
  8. `export:web`
  9. `export:ios`

  It ends: "This does not prove EAS, Apple signing, upload, or iPhone behavior" (`:29-31`).
- **CI job `mobile-testflight-source`** (`.github/workflows/ci.yml:69-95`):
  - runs on `ubuntu-latest` with a 45-minute timeout and Node `22.23.1`;
  - does a frozen install of `@lupi/mobile...`, then `pnpm --filter @lupi/mobile verify:testflight`;
  - compiles no native code, signs nothing and runs no Xcode. Every other job is also `ubuntu-latest` (`ci.yml:98`; the deploy workflows).
- **EAS workflows** (manual dispatch, paid):
  - `apps/mobile/.eas/workflows/mobile-visual.yml:1-45`: a simulator build plus Maestro (a UI-test runner) on an iPhone 16 Plus simulator;
  - `mobile-visual-ar-diagnostic.yml` covers AR separately and is "non-authoritative".
  - Viro's plugin "unconditionally excludes `arm64` for iOS simulator builds" (`docs/mobile-expo.md:646`), so AR can't run on Apple Silicon simulators (`docs/mobile-macbook-air-handoff.md:170-181`).
- **Device receipts:**
  - Build `2960e909…`, version `1.0.1 (1)`, signed for one registered iPhone and installed on an **iPhone 15 Pro running iOS 26.6** (`README.md:91-94, 104-108`).
  - The signing team is "Alex Welcing Individual", Team ID `26Y4SLFJ4M`, valid through 2027-08-10 (`docs/mobile-testflight-checklist.md:572-574`).

---

## 2. Current AR

### 2.1 Native Room (Viro/ARKit) in `apps/mobile`

**Scene preparation** (`src/features/ar/ar-scene.ts`):
- Caps: `NATIVE_AR_MAX_ATOMS = 512`, `NATIVE_AR_MAX_BONDS = 2_048`, `NATIVE_AR_TARGET_EXTENT_METERS = 0.32` (`:8-10`). XYZ text is capped at 250,000 characters (`:12`).
- Scaling: the largest span of the molecule is set to 0.32 m (`:161-163`). Atom radius is `displayRadius × scale`, clamped to 6–30 mm (`:177-181`).
- Bonds: an O(n²) distance rule, `r_cov(A) + r_cov(B) + 0.45 Å` (`:219-237`). This is a reimplementation of `lupi-bonds.distance.v1` and never uses the `molecular.v1` recipe.

**Rendering and interaction** (`molecule-ar-surface.native.tsx`):
- `ViroARSceneNavigator` with HDR, bloom, PBR, multisampling, shadows, `occlusionMode="peopleOnly"` and `worldAlignment="Gravity"` (`:77-91`).
- Plane detection for horizontal and vertical planes (`:200`); `ViroARPlaneSelector` with a minimum size of 0.14 m (`:230-241`).
- **One `ViroSphere` per atom** (16×12 segments, `:282-298`) and **one `ViroPolyline` per bond** (`:270-281`). This is why the cap is 512 atoms.
- Gestures:
  - Drag is `FixedToPlane`, horizontal only (`:242-255`).
  - Pinch scale is clamped to 0.35–4 (`:174-184`).
  - Rotation is about Y only (`:186-196`).
  - Tap selects an atom (`:292`).
- Materials: one Blinn material per element using the `ELEMENT_DATA` colour (`:305-336`). A transparent quad receives shadows (`:262-269`).

**Session and runtime:**
- 10-minute TTL, at most 3 sessions, held in memory (`ar-session-store.ts:3-4`).
- Support check via `isARSupportedOnDevice()`; camera permission via `requestRequiredPermissions(["camera"])` (`ar-runtime.native.ts:1-33`).
- Expo Go is blocked with a "Development build required" screen (`ar-entry-screen.tsx:25-33`, `ar-build-policy.ts:1-7`).
- Haptics on selection and impact (`ar-screen.tsx:136, 145`).

**What it doesn't have:**
- no persistence (no saved world map or anchors);
- no physics, throwing, stretching or breaking;
- no multiple molecules in a scene;
- no LOD, no impostors, and nothing beyond 512 atoms;
- no iPad layout;
- no acceptance run on a real device.

### 2.2 Prebuilt "Place on your desk" models (`/m` pages)

**Generator:** `scripts/molecule-pages/desk.mts` (127 lines), written in Node with three's `USDZExporter` and `GLTFExporter`.
- One `SphereGeometry` is shared by all atoms (24×16 segments, or 14×10 above 150 atoms) and one open `CylinderGeometry` by all bonds. Materials are `MeshStandardMaterial` with roughness 0.38 and metalness 0 (`:55-75`).
- Scale: `DESK_SPAN_M = 0.18`, so the molecule is about a hand wide, clamped to 0.004–0.05 m per Å (`:18-20, 55`). The model sits on y = 0 (`:77-83`).
- USDZ export uses `quickLookCompatible`, `includeAnchoringProperties` and a horizontal plane anchor (`:120-124`). GLB is binary (`:125`).
- Positions, elements and bonds come from the page's own `InkModel` (`:9-10`), so the desk model matches the drawing.

**Build output:** `scripts/molecule-pages/build.mts:157-186` writes `dist/ar/<id>.usdz|.glb`. A failed model removes the AR button for that page.
- The built `apps/web/dist` has **69 molecules** with 138 files.
- Atom counts: minimum 2, median 25, maximum 512 (`diamond_crystal`).
- The largest USDZ is 777,817 bytes (`diamond_crystal.usdz`).

**Client:** `packages/ui/src/moleculePage/page.ts:79-118, 291-300`.
- iPhone and iPad: a hidden `<a rel="ar">` pointing at the USDZ, with `#allowsContentScaling=1&canonicalWebPageURL=…` and an `<img>` of the ink drawing.
- Android: a Scene Viewer `intent://` URL.
- Neither path loads React or three on that page (`page.ts:19`).

**Limits:**
- Static geometry: interaction is whatever Quick Look offers (place, scale, rotate).
- Gallery molecules only, up to 512 atoms; no OMol25 picks.
- three's USDZ bytes are not reproducible run to run: "three's USDZExporter (r186) embeds process-global object ids" (`AGENTS.md:577-580`).

### 2.3 USDZ export from the live viewer

- **Export path:** `packages/ui/src/ExportManager.tsx:685-903`. It shares mesh reconstruction with GLB, then dynamically imports `USDZExporter`; the blob is `model/vnd.usdz+zip` (`:885-903`).
  - It is refused on the immutable artifact lane: "USDZ is not available through the immutable artifact-key lane…" (`:723-726`).
  - It is not advertised by `lupi.export_asset` (`AGENTS.md:577`).
- **Budgets:** `USDZ_TRIANGLE_BUDGET = 3_000_000` and `USDZ_BAKE_MEMORY_BUDGET_BYTES = 256 MiB` (`packages/ui/src/export/exportSceneBuilder.ts:56-57`).
  - Sphere detail steps down from 16×12 to 10×8 to 6×5, falling back to 5×4 (`:70-76`).
  - Extent target `TARGET_USDZ_EXTENT_METERS = 0.4` (`:720-756`).
  - Over budget it fails with "use GLB for instanced large-model delivery" (`:118-120`).
- **`USDZExportPipeline.ts`** (282 lines) expands instanced meshes into many `Mesh` objects that share geometry, so USDZ deduplicates them (`:48-80`). Its `USDZExportHelper` (`:209-282`) is the dead Quick Look trigger from §0.4.
- **Practical ceiling:** about 3M triangles. At 5×4 segments that is roughly 75k atoms, far short of a million; USDZ is the wrong vehicle for very large structures.

### 2.4 Scale policy today

| Surface | Rule | Cite |
|---|---|---|
| Brainstorm and decisions | "honest, locked 1 Å = 1 cm" | `docs/brainstorm/2026-09-viewer-play/round2/capture-share-loops.md:489, 535`; `pocket-native-play.md:700` |
| `/m` desk models | Widest span = 0.18 m, clamped to 0.4–5 cm per Å | `scripts/molecule-pages/desk.mts:18-20, 55` |
| Native Room | Largest span = 0.32 m, atom radius clamped 6–30 mm | `apps/mobile/src/features/ar/ar-scene.ts:10, 161-181` |
| Viewer USDZ export | Extent target 0.4 m | `packages/ui/src/export/exportSceneBuilder.ts:720-756` |

---

## 3. Data a native app can use today

Everything below is served publicly by the `lupi-edge` Worker or as static assets (`apps/mcp-worker/wrangler.toml:1-17`). A native `URLSession` client isn't subject to CORS.

| Data | Endpoint or path | Format and limits | Cite |
|---|---|---|---|
| Service identity | `GET /health` | JSON: ready, version, release tag | `apps/mcp-worker/src/index.ts:707-711` |
| Gallery molecule index | `GET /m/manifest.json` | `lupi.molecule-pages.v1`: `{id, name, formula, atoms, file, pose:[az,el], inkRadius, fit}` × 69 | `scripts/molecule-pages/build.mts:113-131` |
| **Compact molecule model** | `GET /og/m/<id>-ink.json` (69), `GET /og/omol25/omol25_nv_<row>-ink.json` (24) | `InkModel`: `p` (xyz in Å), `k` (kind index), `kinds:[{s,c,r}]` (symbol, CPK colour, radius), `b` (flat bond pairs), `bk` (bond kind), `radius`, `detents`, `opening`. A small, complete molecule with bonds and symmetry views. | `packages/ui/src/moleculePage/ink.ts:41-60`; `AGENTS.md:59-66` |
| Desk models | `GET /ar/<id>.usdz`, `/ar/<id>.glb` | See §2.2 | `AGENTS.md:28-34` |
| Gallery coordinate files | `/gallery/curated/...xyz`, `.lammpstrj`, `.glimbin`; some remote (GCS, `assets.lupi.live`) | 104 entries in `packages/ui/src/gallery-data.json`; the mobile allowlist uses 24 | `packages/ui/src/gallery/catalog.ts:1-60`; `wrangler.toml:22-23` |
| Million-atom file | `/gallery/trajectories/massive_1m.glimbin` | 953,312 atoms, 10,156,835 bytes, glimbin v1, flags `0x3` (compressed + little-endian) | `packages/core/src/glimbin.ts:1-80` |
| Billion-atom scene | `/?billion-atoms` (procedural, no file) | Generated on the GPU | `packages/scene/src/BillionAtomBlock.tsx:1-31` |
| OMol25 coverage | `GET /v1/datasets/omol25` | Collections and citation | `apps/mcp-worker/src/scienceData.ts:133` |
| OMol25 rows | `GET /v1/datasets/omol25/:collection/rows?offset&limit` | At most 36 rows per page. Fields: `formula, elements, atomCount, charge, spinMultiplicity, chargeSource, domain, homoLumoGapEv, energy, maxForceNorm, loadUrl, bondTopology:'not-provided'` | `scienceData.ts:32, 98-124, 140, 361-409` |
| OMol25 structure | `GET /v1/datasets/omol25/:collection/structures/:row.xyz` | XYZ whose comment carries charge, multiplicity and provenance; at most 1,000 atoms; `x-lupi-*` headers | `scienceData.ts:33, 148`; `AGENTS.md:51-58` |
| OMol25 collections | neutral-train 34,335,828 rows; neutral-validation 27,697; three larger collections as previews | — | `packages/core/src/omol25/collections.ts:24-77` |
| OMol25 featured picks | `GET /datasets/omol25/featured.v1.json` plus `/datasets/omol25/featured/omol25_nv_<row>.xyz` | `lupi.omol25-featured.v1`, 24 picks, with energy, max force, HOMO–LUMO gap, shelf, sha256 | `apps/web/public/datasets/omol25/featured.v1.json`; `packages/core/src/omol25/featured.ts:5-61` |
| ChatGPT-plugin JSON contracts | `lupi.omol25.v1`, `lupi.pubchem.v1` | OMol25: `atoms:{ids, elements, positions}`, empty bonds, at most 1,000 atoms. PubChem keeps bond orders. | `packages/core/src/omol25/widget.ts:5-29`; `packages/core/src/pubchem.ts:6, 13-14` |
| Daily puzzle | `/daily/schedule.json`, `/daily/pool.json`, `/daily/p/<token>.json` | `lupi.daily.v1`: an `InkModel` plus clues sealed with an XOR keystream (obscured, not encrypted) | `docs/daily.md:14-16, 69` |
| Saved views | Firestore `lupiViews/{slug}` (anyone can read a single view); `GET /view/:slug` HTML and `/view/:slug/card.*` | `SavedMolecularView` schema 1: `molecule` is a URL or inline XYZ (≤ 5,000 atoms), plus view state | `firestore.rules:13-35`; `packages/ui/src/savedViews.ts:45-90`; `index.ts:721-724, 2531, 2586-2642` |
| Room properties | `packages/ui/src/switcher/property-sheet.json` (bundled, not served) | 85 entries: `phase`, `meltingPoint`, `boilingPoint`, `water` (handbook values) | `scripts/molecule-pages/catalog.mts:308-309, 397` |
| Photo → molecules | `POST /v1/scan/identify | gist | sculpt | recipe | plan | segment | reconstruct` | `{configured:false}` without `HF_TOKEN`; `reconstruct` returns coloured points `lupi.points.v1` (~700 kB) | `AGENTS.md:48-50`; `apps/mcp-worker/src/remote.ts:12, 337` |
| Jev judgments | `POST /v1/switch/judge`, `/v1/viewer/command` | `{configured:false}` without `TYPESAFE_API_KEY` | `AGENTS.md:46` |
| Analytics | `POST /collectAnalytics` | Only allowlisted event names are logged (`ANALYTICS_EVENTS`), so native events must be added there | `index.ts:207, 2489-2519`; `docs/analytics-measurement.md:5-7` |

**Authentication:**
- Firebase project `shed-489901` (`wrangler.toml:25`); the auth proxy is at `/__/auth/*` (`index.ts:2347, 2477`).
- The web client offers Google and GitHub sign-in (`packages/ui/src/auth/firebase.ts:68-71`). The mobile app has none.
- No Firestore collection fits a per-user shelf. `moleculeLibrary` accepts entries stamped with an owner and is public to read (`firestore.rules:55-59`).
- **(external, verify):** App Store guideline 4.8 generally requires offering Sign in with Apple when an app offers third-party social login.

**File formats parsed in `packages/parsers`:**
- XYZ and extended XYZ, LAMMPS dump (`.lammpstrj`), LAMMPS data, chunk profiles (`packages/parsers/src/index.ts:461-475`);
- `.glimbin` streaming over HTTP range requests (`StreamingLoader.ts`, `LocalGlimbinSource.ts`);
- PubChem PUG-REST JSON (`packages/core/src/pubchem.ts:141`).

There is **no PDB, CIF, SDF or mol2 parser**.

---

## 4. Algorithms worth porting to Swift, or sharing as data

| Module | Path (lines / bytes) | Imports | Self-contained? | Use in native AR |
|---|---|---|---|---|
| Element table: covalent radius, display radius, CPK colour, mass, category, electronegativity | `packages/core/src/elements.ts` (412 / 34,160) | None | **Fully.** Pure data plus helpers; `ELEMENT_DATA` at `:298`; display radius = clamp(0.5 × covalent, 0.30, 0.70) at `:45-50` | Generate a Swift or JSON table at build time. Mobile already imports it (`ar-scene.ts:1-5`). |
| Bond recipes `distance.v1` / `molecular.v1` | `packages/core/src/bonds/`: `perceive.ts` 681, `classes.ts` 154, `grid.ts` 146, `types.ts` 104, `filter.ts` 35, `select.ts` 20, `method.ts` 44; fixture `validation-v1.json` 35 KB | Only `elements` and its own files | **Fully.** Frozen v1 parameters (`perceive.ts:46-53`); molecular recipe up to 2,000 atoms (`classes.ts:6`); bond kinds and dash styles (`types.ts:7-16`) | Port to Swift and test against `validation-v1.json` and `perceive.test.ts`, or have the edge or build ship bond pairs (InkModel `b` / `bk` already does). |
| Object Facts: inertia, rotor type, rings, symmetry axes, **detents** | `packages/core/src/objectFacts/`: index 85, bonds 168, detents 229, inertia 190, jacobi 84, rings 177, symmetry 203, types 54 | `elements`, `math` (pmndrs, a quaternion in `inertia.ts:1`) | **Nearly** (a small quaternion dependency). Capped at 2,000 atoms (`index.ts:23-26`). Output `ObjectFactsV1` (`types.ts:34-54`) is plain JSON. | Detents in the hand, symmetry "clicks", rotor type. Easiest to precompute and ship as JSON. |
| Motion springs and tokens | `packages/core/src/motion/`: spring 72, tokens 30, settle 47, stepResponse 35 | `math/time` (analytic damped spring) | **Fully**, small. Tokens: snap, glide, click, land, boing, settle, float (`tokens.ts:15-25`) | Port; a few dozen lines of Swift. Keeps the feel identical. |
| **True-spin coast** (free rigid-body tumble, Euler equations with RK4 integration, tennis-racket flip) | `packages/ui/src/camera/trueSpinCoast.ts` (408) | Only types from `objectFacts` and `rigApi` | **Fully**; "Pure math: no three.js, no DOM, no store" (`:44`) | The basis for how a thrown molecule tumbles. Port directly. |
| Symmetry detents provider, release velocity, isotropic coast | `camera/symmetryDetents.ts` 168, `releaseVelocity.ts` 73, `isotropicCoast.ts` | Types and gesture tokens | Mostly | Port. The gesture arbiter (744 lines) and rig (1,392 lines) are web-pointer specific; carry over the ideas only. |
| Display motion (arrival, ripple, **Tug, Burst, Heat**) | `packages/scene/src/tsl/displayMotion.ts` (511, GPU) + **`displayMotionTwin.ts` (378, CPU twin in double precision)** | three TSL; the twin imports constants only | The twin is pure TS. Tuning at `displayMotion.ts:72-105`; Tug = Gaussian falloff with core and halo springs (`:165-172`); Burst shock front 70 Å/s; Heat two jiggle bands | Port the twin's formulas to Metal or Swift. The repo labels them **"Illustrative"** display offsets, not physics (`AGENTS.md:165`; truth rules `displayMotion.ts:19-33`). |
| Impostor shading (ray-cast spheres and cylinders, ink look, foil, glow) | `packages/scene/src/tsl/atomImpostorMaterial.ts` 537, `bondImpostorMaterial.ts` 392, `impostorKit.ts` 680, `inkLook.ts` 384, `atomFoil.ts` 266, `atomGlow.ts` 164 | three/webgpu TSL | No; these are TSL node graphs | Reimplement by hand in Metal. Technique: one camera-facing quad per atom (1.3 radii), ray–sphere intersection, `discard` on miss, depth written, sub-pixel atoms collapsed (`atomImpostorMaterial.ts:1-28`). |
| WGSL GPU pipeline: compute culling plus indirect draw, atom render, GPU bond detection | `packages/renderer/src/shaders/atom.wgsl` 176, `culling.wgsl` 265, `bond_render.wgsl` 190, `pipeline/shaders/bond_compute.wgsl` 161; hosts `AtomPipeline.ts` 464, `BondPipeline.ts` 468 | WebGPU | The shaders map closely to MSL | Port the million-atom path to Metal compute (`culling.wgsl:1-9`). |
| Cluster splat LOD | `packages/scene/src/ClusterBuilder.ts` (223) | `@atlas/core` colour and radius | **Fully**; "This module is pure — no React, no Three.js"; a 1M-atom build takes ~150–300 ms on a laptop (`:30-34`) | Far LOD for million-atom AR. |
| Brick LOD (billion atoms) | `BillionAtomBlock.tsx` 266 + `tsl/billionBrickMaterial.ts` 265 | R3F, TSL | No (but the design is documented) | Four tiers: atoms, 2³-cell, 6³-cell, whole brick; CPU classifies about 9k bricks per frame (`BillionAtomBlock.tsx:13-24`). The design to copy. |
| Spatial hash, CPU bonds, contact occlusion | `SpatialHash.ts` 323, `bondDetectCpu.ts` 279, `atomContactOcclusion.ts` 272, `atomOcclusion.ts` 203 | Mostly pure | Mostly | Neighbour queries for picking or grabbing; baked ambient occlusion for the "specimen" look. |
| glimbin reader and writer | `packages/core/src/glimbin.ts` (773) | `types` | **Fully** | 256-byte header plus a frame index of 24-byte entries (`:17-23`); per frame: u8 types, f32 × 3 positions, optional bonds and properties (`:292-339`). Swift reader is straightforward. |
| Ink drawing model | `packages/ui/src/moleculePage/ink.ts` (290) | **None** ("Pure: no DOM, no three, no imports", `:11`) | **Fully** | Painter-sorted circles and ink bonds; usable for shelf labels and 2D cards. `inkStage.ts` (651) is DOM code. |
| OMol25 validators | `packages/core/src/omol25/widget.ts` 154, `featured.ts` 290 | `elements` | **Fully** | Port the validators, or trust the edge. |
| CPK colours | `ELEMENT_DATA[z].color` (`elements.ts:13-40, 298`) | — | — | Already used for Viro materials (`molecule-ar-surface.native.tsx:308-318`). Decision: "Default element palette | **Keep CPK**" (`decisions.md:20`). |

**Suggested data contract:** generate one versioned "native molecule pack" per molecule at build or edge time, containing positions, Z, bond pairs, kinds, ObjectFacts and detents, property-sheet entries, and OMol25 energy, force and gap. Only the per-frame code (springs, coast, impostors, LOD) then needs a Swift or Metal port. The InkModel JSON and the `lupi.omol25.v1` shape are the nearest existing precedents.

---

## 5. Earlier docs and decisions on mobile and AR (quoted)

- `docs/mobile-expo.md:15`: "The hybrid is a migration bridge, not the final architecture and not evidence of native-renderer parity."
- `docs/mobile-expo.md:517-527`: "Do not import `@atlas/ui` into mobile… When native rendering begins, create a native scene boundary… Share molecule data, semantic render specs, bond algorithms, and fixtures—not the web React tree."
- `docs/mobile-expo.md:641-642`: "The current caps are safety limits, not performance promises, and should move only from physical evidence."
- `docs/mobile-expo.md:690`: "Do not promise the web viewer's largest datasets on iPhone before those measurements; cap inferred bonds from measured evidence and prefer authoritative or precomputed bonds."
- `docs/mobile-expo.md:758`: the native WebGPU route is `react-native-wgpu` (Dawn) in a development build (Phase 3).
- `docs/mobile-expo.md:784-785`: "Define a native renderer fingerprint. Never reuse a browser artifact key for bytes produced by a different native renderer execution class."
- `docs/mobile-expo.md:789`: "Do not submit the initial WebView shell as a thin website wrapper" (App Store minimum-functionality rule).
- `docs/mobile-macbook-air-handoff.md:53`: an M2 Air is fine for "initial Swift/Metal module development after the current hybrid app is accepted."
- `docs/mobile-macbook-air-handoff.md:183-185`: "The destination renderer is a local Expo module backed by Swift, MetalKit, and ARKit. The M2 is capable of developing that module, but performance acceptance must be collected on target iPhones rather than inferred from the Mac GPU."
- `docs/mobile-macbook-air-handoff.md:35-37`: "The build is Ad Hoc signed for the registered iPhone… A different iPhone must be registered and included in a new development build."
- `apps/mobile/README.md:564-565`: "The cloud build can consume quota or incur cost. Do not run it merely because these commands are documented."
- `apps/mobile/README.md:615-617`: every native or SDK change must bump `app.json`'s version (`appVersion` runtime policy).
- `docs/brainstorm/2026-09-viewer-play/decisions.md:11`: "Anything goes, arcade included… The 'Illustrative' label still applies to motion that is not data."
- `decisions.md:28`: "Immersive XR | **Defer.** | Remove immersive XR from the v10 viewer. iPhone AR stays on USDZ Quick Look…; Android on Scene Viewer."
- `decisions.md:33`: "Device performance data | **Not a priority; the bar is that it works.**"
- `round2/pocket-native-play.md:675`: "Room. C110's 'On my desk' opens the native Room inside the app instead of Quick Look."
- `round2/pocket-native-play.md:682`: "The WebView stays a parity bridge; there is no native renderer fork."
- `round2/capture-share-loops.md:534`: a judge suggests "Add a 'bigger' option, since 1 Å = 1 cm makes water tiny."
- `docs/mobile-testflight-checklist.md:566-569`: "Organization enrollment is mandatory for this release path; do not substitute an individual membership."

**These conflict with the owner's new direction** (fully native, an AR toy box, persistent shelves, a million atoms): `decisions.md:28` and `pocket-native-play.md:25, 682`. The handoff guide's Swift/MetalKit/ARKit module (`:183`) agrees with it.

---

## 6. Building native iOS from this repo

**In this environment:** Linux 6.18 x86_64 with no `xcodebuild` or `swift`. `git ls-files` shows no Swift, Metal, Xcode project, entitlements or AASA files. The owner previously worked from Windows: the README uses PowerShell (`README.md:129-146`), and `expo prebuild --platform ios` fails on Windows (`README.md:442-444`).

**CI today:**
- GitHub Actions run only `ubuntu-latest` and only JS checks plus an unsigned `expo export --platform ios` (`ci.yml:69-95`).
- EAS is the only place native code compiles. It is proven for signed internal builds (Xcode 26.6 on the `sdk-57` image) and is manual and metered.

**Ways to get native builds onto the iPhone and iPad:**

| Route | What it is | Fit | Notes |
|---|---|---|---|
| A. Expo app plus local Expo native module (Swift: RealityKit, ARKit, Metal) | Matches `mobile-macbook-air-handoff.md:183`. EAS builds it like today. Metro still hot-reloads JS; native changes need a new development build. | Keeps Gallery, Library, Settings and the WebView viewer; the AR scene becomes a native view. | Replace Viro: it blocks arm64 simulators and caps at a sphere per atom. Raise the deployment target if newer RealityKit APIs are needed. |
| B. Standalone SwiftUI + RealityKit Xcode project (e.g. a new `apps/ios`) | Fully native. | Cleanest for heavy Metal and AR work. | Needs a macOS build host:<br>• GitHub-hosted macOS runners **(external, verify: higher per-minute billing)**<br>• Xcode Cloud **(external, verify: needs an App Store Connect app record and program membership; includes a monthly compute allowance)**<br>• a Mac (the M2 Air guide)<br>• whether EAS can build a non-React-Native project is **unverified**. |
| Hybrid testing | Put the pure algorithms (springs, coast, bond rules, LOD builders, glimbin reader) in a Swift Package with no RealityKit. | Its unit tests could run on Linux CI with a Swift toolchain **(external, verify)**, checked against the TS fixtures (`bonds/validation-v1.json`, `objectFacts.test.ts`, `motion.test.ts`). | Gives native code a verification path without a Mac. |

**Distribution blockers:**
- **Ad Hoc builds:** each device's UDID must be registered (`eas device:create`), then a new build made interactively (`docs/mobile-macbook-air-handoff.md:204-216`). **The iPad is not registered.**
- **TestFlight:** needs an App Store Connect app, `ascAppId` in `eas.json:99-101`, and agreements accepted. The repo's own policy also requires organization enrollment (`docs/mobile-testflight-checklist.md:566-574`). The existing individual team (`26Y4SLFJ4M`) signs development builds today. **(external, verify):** internal TestFlight testing is allowed on an individual membership, so the organization requirement is a project choice, not an Apple rule.
- **iPad UI:** needs `supportsTablet: true` and the readiness check at `check-testflight-readiness.mjs:90` relaxed. **(external, verify):** without it, an iPhone-only app runs in iPad compatibility mode.

**Hardware (external, verify):** the iPhone 15 Pro on record has LiDAR, which helps plane and mesh reconstruction and occlusion on shelves. For "still there tomorrow", the usual ARKit mechanism is saving and restoring an `ARWorldMap` and relocalizing against it. Relocalization is sensitive to lighting and viewpoint, so a fallback re-placement flow is needed. Nothing in the repo implements either.

---

## 7. Gaps to resolve before building

1. **Product decisions to amend:** `decisions.md:28` (XR deferred, Quick Look only) and `pocket-native-play.md:25, 682` (no native fork).
2. **Scale policy:** pick one rule (1 Å = 1 cm, hand-sized, or trophy-sized) and apply it to desk models, Room and exports (§2.4).
3. **Persistence and identity:** decide what the shelf syncs (on-device only, iCloud/CloudKit, or Firestore under a new `users/{uid}/…` with rules); which sign-in (Firebase plus Sign in with Apple); and whether the scene layout (anchors, world map) is per device.
4. **Physics data:** "rigid / breakable / flexible" needs new, cited data the repo lacks: bond dissociation energies, bond orders, stiffness. Candidates to start from: PubChem bond orders, OMol25 `energy` and `maxForceNorm`, ObjectFacts rotor type and planarity, and the property sheet's phase and melting/boiling points. The current honesty rule is that motion which isn't data is labelled "Illustrative".
5. **Million-atom path:** the browser-side pieces are ready to port (glimbin, cluster splats, brick LOD, WGSL culling). The Viro and USDZ paths cannot scale to a million atoms (512 atoms; about a 3M-triangle budget).
6. **Building:** no Mac or Xcode here and no macOS CI. Choose EAS + Expo module, Xcode Cloud, or GitHub macOS runners, and register the iPad.