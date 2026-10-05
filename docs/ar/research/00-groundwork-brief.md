# Lupi AR: groundwork brief for a native Apple trophy case

*Technical lead brief, 2026-10-04. It is based on the five-part research dossier: a repo survey at HEAD `5816359`, plus reports on the Apple AR platform, chemistry physics, million-atom rendering, and retention. Repo facts cite `path:line` and platform facts cite their source URL. Numbers marked **(est.)** are my own arithmetic or the dossier's; nobody has measured them. Items marked **UNCONFIRMED** still need a spike.*

---

## 1. The opportunity

Lupi already has what most AR collection apps lack, and none of it reaches AR today:

- **Reasons to earn a molecule:** Lupi Daily, Scan, and 24 OMol25 specimens with provenance.
- **Cosmetic rarity that is never sold:** Remix codes and Foil at a published 1 in 24.
- **Chemistry facts that can drive physics:** the inferred bond graph `lupi-bonds.molecular.v1`, plus inertia, rings and symmetry detents in `objectFacts`.
- **A feel people already enjoy:** coast, detents, Tug, Burst and Heat.
- **Million-atom building blocks:** glimbin, cluster splats, brick LOD and WGSL culling.

The AR we ship is the opposite. It is a Viro scene with one sphere per atom, capped at 512 atoms, with no physics and no persistence, and it has never been accepted on a real phone (`apps/mobile/src/features/ar/ar-scene.ts:8-10`, `apps/mobile/README.md:104-108`).

The research gives a clear lesson about what keeps people coming back:

- AR alone does not. Niantic says most Pokémon GO players turn AR off, and puts the AR sweet spot at 2–3 minutes ([AR Insider](https://arinsider.co/2019/04/29/data-point-of-the-week-ars-3-minute-sweet-spot-in-pokemon-go/)).
- An always-on AR pet like Peridot was too expensive to keep running ([Peridot](https://playperidot.com/de/news/peridot-mobile-sunset)).
- What does work is a collection you own, a daily ritual, and a short AR visit that shows something you otherwise can't see.

So the product is three things:

1. **A durable collection.** You own it, it syncs, and it can be exported.
2. **A shelf in your room that remembers.** This is best effort, and there is always a way to recover it.
3. **Three minutes of honest, chemistry-tuned play.** True mass ratios, true inertia, the weakest bond snapping first, labelled clearly.

Its showpiece is a 1,000,000-atom monument on the same shelf. No consumer molecule app does that, and the maths says it fits in a phone's frame budget.

---

## 2. Recommended architecture

### 2.1 App shape: a new universal SwiftUI app, not a module inside Expo

**Recommendation:** create a new Xcode project at `apps/apple/` (iPhone and iPad, one target), plus two Swift packages:

| Unit | Contents | Builds where |
|---|---|---|
| `LupiKit` (pure Swift, no RealityKit) | element table (code-generated), bond recipes, springs and motion tokens, true-spin coast, symmetry detents, the XPBD solver with Morse bonds, glimbin and LupiPack readers, ClusterBuilder | Mac, and possibly Linux CI with a Swift toolchain **(external, verify)** |
| `LupiEngine` (Metal and RealityKit) | colossus renderer, impostor shaders in MSL, culling, LOD | Mac / Xcode only |
| `apps/apple` (SwiftUI) | Cabinet (collection), Shelf (RealityView AR), Learn, Settings | Mac / Xcode only |

The new app takes the bundle id `live.lupi.app`. Nothing has gone to the App Store yet: `submit.production` has no `ascAppId` (`apps/mobile/eas.json:99-101`, `README.md:74-75`). Verify in App Store Connect that no app record already holds the id. `apps/mobile` is frozen as the hybrid reference, and its WebView-parity approach can come back through WKWebView if a native screen ever needs the web viewer.

Why not an Expo module (Route A, which `docs/mobile-macbook-air-handoff.md:183-185` describes):

- **AR becomes the whole app, not one route.** The Cabinet, Shelf and Learn screens all need native lifecycle, gestures and an `ARSession` we own.
- **Expo pins our toolchain.** The `sdk-57` image ships Xcode 26.6 ([Expo infra](https://docs.expo.dev/build-reference/infrastructure/)), so iOS 27 APIs (LOD, splats, cloth, `trackingObjects`) wait on an Expo SDK 58 migration.
- **We lose hot reload anyway.** Every native change needs a new development build, and every native or SDK change bumps the app version (`apps/mobile/README.md:615-617`).
- **Viro is removed either way.** It caps out at one sphere per atom and blocks arm64 simulators (`docs/mobile-expo.md:646`).
- **No thin-wrapper risk.** A native app avoids the App Store minimum-functionality worry (`docs/mobile-expo.md:789`).

Why not raw ARKit with a custom Metal engine (`MTKView`): we would rebuild camera compositing, occlusion, lighting, physics, gestures and the entity-component system, which the dossier sizes at "months of engine work". RealityKit on iOS 26/27 is now a full engine: instancing, `LowLevelMesh`, `PostProcessEffect`, joints, force effects, and in iOS 27 LOD, splats and cloth ([RealityKit updates](https://developer.apple.com/documentation/updates/realitykit)).

This direction requires amending two earlier decisions: "Immersive XR | Defer… iPhone AR stays on USDZ Quick Look" (`docs/brainstorm/2026-09-viewer-play/decisions.md:28`) and "there is no native renderer fork" (`round2/pocket-native-play.md:25, 682`).

### 2.2 AR stack: RealityView with an `ARSession` we own

- Use `RealityView` with `SpatialTrackingSession.run(_:session:arConfiguration:)` (iOS 18). In that mode we own the `ARSession`, so `initialWorldMap` and `getCurrentWorldMap` stay available ([doc](https://developer.apple.com/documentation/realitykit/spatialtrackingsession/run(_:session:arconfiguration:))). Scene understanding `[.occlusion, .shadow, .collision, .physics]` is the iOS default.
- **Fallback: `ARView`** (iOS 13, not deprecated). It gives direct `session`, `AnchoringComponent.Target.anchor(identifier:)`, and `renderCallbacks.postProcess` (iOS 15).
- Spike first. It is **UNCONFIRMED** whether relocalizing from a world map re-binds `AnchorEntity`s inside RealityView, and one developer reported delegate callbacks stopping there ([forum 773741](https://developer.apple.com/forums/thread/773741)).
- **Gestures have to be built ourselves.** `ManipulationComponent` is visionOS-only ([doc](https://developer.apple.com/documentation/realitykit/manipulationcomponent)), so grab and throw use:
  - `GestureComponent` (iOS 26), or `targetedToEntity` plus `InputTargetComponent` (iOS 18);
  - a kinematic body while the molecule is held;
  - on release, velocity from the last 80–120 ms of world-space hand pose, then a dynamic body with `applyLinearImpulse`.

### 2.3 Trophy case persistence: three layers that never mix

| Layer | What it holds | Store | Failure behaviour |
|---|---|---|---|
| **Collection** (ownership) | `lupi.trophy.v1` records: molecule reference (URL plus sha256), how it was earned, date, Remix code and finish, plaque text | SwiftData with CloudKit private database ([doc](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices)); exportable | Never lost. The app opens here, not on the camera. |
| **Placement** (pins) | One `ARWorldMap` per shelf, plus a `lupi.shelf.v1` arrangement: trophy transforms relative to a **shelf root** anchor | On device. Private-iCloud `CKAsset` later, behind a cross-device test | Recovery ladder (§3.2). Re-placing the root restores the whole arrangement. |
| **Play** (state) | Pose, stretch, fragments | Not persisted | A broken molecule always re-forms. Captures show the rest pose, as the web capture guard does today (`AGENTS.md`). |

How the map is used:

- Save it only when `worldMappingStatus` is `.extending` or `.mapped`.
- Re-save it after every successful relocalization.
- Store a camera snapshot with it, as Apple's sample does ([Saving and loading world data](https://developer.apple.com/documentation/arkit/saving-and-loading-world-data)).
- Override `coachingOverlayViewDidRequestSessionReset`, because the default Start Over "removes any existing anchors" ([doc](https://developer.apple.com/documentation/arkit/arcoachingoverlayview)).

iOS has no system-persisted anchor API. `WorldAnchor` is visionOS-only, and the June 2026 ARKit changes added none for iOS ([ARKit updates](https://developer.apple.com/documentation/updates/arkit)).

### 2.4 Physics tiers: off-device chemistry, a cheap solver on device, two clocks

The principle is to compute the chemistry offline and run cheap, data-driven physics on the device. Two layers, each labelled:

- **The trophy as a desk model:** it falls, lands and gets thrown.
- **The molecule inside it:** slowed down, amplitude exaggerated, ratios kept true.

| Tier | Applies to | Runtime | Inputs |
|---|---|---|---|
| **T0 Macro** | everything | RealityKit rigid body that collides with planes or the LiDAR mesh. Real principal inertia via `PhysicsMassProperties`. Felt mass compressed as m ∝ M^0.3–0.5 so the ordering stays true. In flight, the `trueSpinCoast.ts` port runs the tumble, in case RealityKit lacks gyroscopic terms (**UNCONFIRMED**). | `objectFacts` (mass, moments, axes) |
| **T1 Small** | up to ~350 atoms (the OMol25 range) | CPU XPBD on a fixed 1/240 s substep: rigid clusters, torsion hinges with detents, **Morse bonds**, harmonic angles. Heat is Boltzmann normal-mode excitation, compressed into 0.5–8 Hz. | `lupi.physics-card.v1` |
| **T2 Medium** | ~350 to ~100k atoms | Metal XPBD over residues or rigid clusters with elastic-network springs. Domains unfold rather than snap. | card plus elastic network |
| **T3 Colossus** | 100k to 1M+ atoms | One rigid body, ≤200 chunk bodies joined by `PhysicsJoint`s that our own code breaks, K ≈ 10–20 RTB/ANM modes, and a local XPBD focus window of 1–5k atoms. | offline modes |

The key mechanism is that Morse bonds map exactly onto XPBD:

- Constraint C = 1 − e^(−a(r−rₑ)) with compliance α = 1/(2Dₑ). Its energy is exactly Dₑ(1−e^(−aΔr))².
- A bond **breaks when C > ½**, which is past the inflection where the force peaks.
- One calibration constant sets maximum finger effort to about 6 nN-equivalent. From the dossier's computed peak forces:

| Bond | Peak force | What the player feels |
|---|---|---|
| O–O (peroxide) | 3.3 nN | gives at about half effort |
| C–C | 5.0 nN | needs most of your effort |
| N≡N | 20.9 nN | never breaks |

This sits in the right range: AFM measured Si–C rupture at 2.0 ± 0.3 nN, and DFT gives 6–8 nN for single bonds ([arXiv:1605.03441](https://arxiv.org/pdf/1605.03441)).

RealityKit joints have **no spring, compliance or break force** ([PhysicsJoint](https://developer.apple.com/documentation/realitykit/physicsjoint)), so the molecule's internals run in a custom ECS `System`, not on joints. iOS 27 cloth works on triangle meshes only, so use it for graphene-like sheets, not bond graphs.

Rejected alternatives:

- **On-device force fields** (RDKit UFF/MMFF, OpenMM). Topology is fixed, so nothing can break. Open Babel is GPL, which conflicts with App Store terms.
- **On-device ML potentials as the core.** There is no published iPhone benchmark, and even at 100 steps/s you would see only 50 fs per wall-clock second.

ML potentials earn their place on the server, building the cards and answering optional "verdict" calls.

### 2.5 Million-atom renderer: a hybrid that hands the colossus to our own Metal pass

- **RealityKit owns the world:** shelf, anchors, physics, occlusion, and native-entity trophies up to about 5k atoms (`MeshInstancesComponent` spheres and bonds).
- **`LupiEngine` draws large structures inside RealityView's `customPostProcessing`** (iOS 26). That hook provides `sourceColorTexture`, `sourceDepthTexture`, `projection` and `commandBuffer` ([PostProcessEffectContext](https://developer.apple.com/documentation/realitykit/postprocesseffectcontext)), so our impostors write real depth and are depth-tested against RealityKit's.
- **Why not RealityKit alone:** `CustomMaterial` has no depth output ([Metal-RealityKit APIs PDF](https://developer.apple.com/metal/Metal-RealityKit-APIs.pdf)), so billboards would intersect like flat coins up close.
- **Why not `RealityRenderer`:** it exposes no depth texture.

The scale maths **(est.)**:

- 1M atoms is a sphere about 25 nm across. At 1 Å = 1 mm that is a 25 cm trophy with 3.4 mm carbon beads.
- From any one view, only 1.5–3% of atoms are visible. The exterior shell is about 140k atoms (14%), roughly 70k of them facing the camera.
- Baked exterior flags, 15,625 clusters of 64 atoms (one mesh-shader meshlet each), normal cones and two-phase Hi-Z cut the drawn set to **50–150k atoms**.
- LOD tiers by projected size:

| Tier | When | What is drawn |
|---|---|---|
| L0 | atom radius ≥ 1.5 px | ray-cast impostors |
| L1 | 0.5–1.5 px | compute-rasterized points into a 64-bit visibility buffer (Apple9+) |
| L2 | cluster under ~3 px | one cluster splat |
| L3 | whole chunk under ~3 px | one chunk splat |

- Data is about 13–16 MB packed, and about 30–60 MB resident per colossus.
- GPU budget is about 7–10.5 ms of 16.7 ms at 60 fps, all on paper until spike S2 measures it.

Fallback ladder:

1. `ARView.renderCallbacks.postProcess`.
2. `LowLevelMesh` impostor discs, acceptable at 2–4 px per atom.
3. iOS 27 `GaussianSplatComponent` or `LevelOfDetailComponent` for the far field.

Default colossi to space-filling with no bonds. At about one bond per atom, bonds would double the primitive count; draw them only for near-field L0 clusters.

### 2.6 Shared data contracts with web and edge

| Contract | Status | Notes |
|---|---|---|
| `/m/manifest.json` (`lupi.molecule-pages.v1`, 69 molecules) and InkModel JSON (`/og/m/<id>-ink.json` for 69, `/og/omol25/...-ink.json` for 24) | **Exists** | Positions in Å, kinds, CPK colours, bond pairs `b` and kinds `bk`, detents, opening pose (`packages/ui/src/moleculePage/ink.ts:41-60`). Enough for the vertical slice without any new server work. The ink SVGs also become the Cabinet grid and the widget. |
| `lupi.physics-card.v1` | **New** | Per-bond rₑ, k, Dₑ, torsion barriers, rigid clusters, normal modes, strain, mass and inertia. Every field carries `source`, `inferred` or `computed:<method>`. About 10–20 KB for caffeine **(est.)**. Built next to `scripts/generate-molecule-pages.mts` for the gallery, and on the edge for OMol25 rows. |
| `lupi-bond-orders.v1` | **Specified, no code** (`docs/omol25-bonds-and-discovery.md` §2.6) | A hard dependency for bond-order-dependent strengths and rotatable-bond detection. Bond orders exist today only on PubChem records (`packages/core/src/pubchem.ts:6`). |
| `LupiPack v1` | **New** | Binary, mmap-able. 64 B header, 48 B clusters, 8 B atoms (u16×3 positions quantized inside each cluster, type, exposure), bonds, LOD splats, chunks with mass, inertia and interface tables. About 13–16 MB per 1M atoms. Loaded zero-copy via `makeBuffer(bytesNoCopy:)` or through `MTLIOCommandQueue` with LZ4. Baked at web-build time for gallery colossi. |
| `lupi.trophy.v1`, `lupi.shelf.v1` | **New** | Collection record and shareable arrangement. **Never contains the room map.** |
| Native renderer fingerprint | **New** | Never reuse a browser artifact key for native bytes (`docs/mobile-expo.md:784-785`). |
| Analytics | **Extend** | Native event names must be added to `ANALYTICS_EVENTS` (`apps/mcp-worker/src/index.ts:207`). |

### 2.7 What to port from TypeScript

| Port to Swift/MSL, with fixtures | Ship as data instead | Carry over the idea only |
|---|---|---|
| `core/elements.ts` (code-generated table) · `core/bonds/` (validate against `validation-v1.json` and `perceive.test.ts`) · `core/motion/` springs and tokens (a few dozen lines) · `camera/trueSpinCoast.ts` (408 lines, "pure math") · `symmetryDetents.ts`, `releaseVelocity.ts` · `displayMotionTwin.ts` (Tug, Burst, Heat formulas) · `ClusterBuilder.ts` (pure) · `glimbin.ts` reader · WGSL `culling.wgsl` and `atom.wgsl` to MSL · impostor maths from `atomImpostorMaterial.ts` | `objectFacts` (capped at 2,000 atoms; precompute it) · bond pairs for gallery and OMol25 (InkModel `b`/`bk`) · physics cards | gesture arbiter (744 lines) and camera rig (1,392 lines), which are web-pointer specific · `BillionAtomBlock.tsx` (the four-tier brick design, not its R3F code) |

The Ink, Remix and Foil looks get ported to MSL once, behind one parameter block, so the web and AR read the same. This comes after the slice.

### 2.8 Scale policy

The repo has three different scale rules, and none of them is the promised one:

| Where | Rule |
|---|---|
| Brainstorm promise | locked 1 Å = 1 cm |
| `/m` desk models | widest span 0.18 m (`scripts/molecule-pages/desk.mts:18-20`) |
| Native Room | largest span 0.32 m (`apps/mobile/src/features/ar/ar-scene.ts:10`) |
| Viewer USDZ export | extent 0.4 m (`packages/ui/src/export/exportSceneBuilder.ts`) |

**Recommendation:** use honest decade magnifications printed on the plaque.

- **10⁸× (1 Å = 1 cm)** for molecules. Caffeine is about 10 cm.
- **10⁷× (1 Å = 1 mm)** for colossi. 1M atoms is about 25 cm.
- An explicit "×10 bigger" toggle that changes the printed number.

This answers the judge's complaint that "1 Å = 1 cm makes water tiny" (`round2/capture-share-loops.md:534`) without hiding the scale. The HIG allows scaling content that isn't life-size, as long as scale isn't used to fake distance.

---

## 3. Hard constraints and risks

### 3.1 Platform limits (all sourced)

- **No auto-persisted anchors on iOS.** We use `ARWorldMap` (iOS 12). A session can stay in `.relocalizing` "indefinitely" if the room has changed ([initialWorldMap](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/initialworldmap)).
- **No `ManipulationComponent` on iOS**, so grab and throw are ours to build.
- **Joints have no springs or break thresholds.** Flexible and breakable behaviour is custom XPBD.
- **`CustomMaterial` has no depth output.** Exact impostors need our own Metal pass (spike S1).
- **iPad has no haptics** ([Core Haptics](https://developer.apple.com/documentation/corehaptics/preparing-your-app-to-play-haptics)). The iPad demo relies on sound and visuals.
- **LiDAR is only on iPhone Pro (12 Pro to 17 Pro) and iPad Pro.** iPad Air and mini lack it. Without LiDAR there is no scene-mesh occlusion and no real-surface physics; people occlusion and detected planes only. Whether the iPhone 18 Pro's A20 Pro is in GPU family Apple10 is **UNCONFIRMED**.
- **The full colossus pipeline needs Apple9 or later** (A17 Pro, A18, M4) for iOS 64-bit atomics and indirect mesh draws. A14–A16 fall back to point sprites and splats for L1.

### 3.2 Relocalization reliability is the product's biggest promise and its weakest link

- Community reports, not Apple data:
  - maps work at about 100 m² and degrade at about 200 m² ([forum 723947](https://developer.apple.com/forums/thread/723947));
  - a 58 MB map hit `exceedSceneSizeLimit` on iPhone 15 Pro Max and iPhone 17 Pro ([forum 804371](https://developer.apple.com/forums/thread/804371)).
- **UNCONFIRMED:** how long a map stays valid, whether it survives an iOS update, and whether a map recorded on the iPhone matches on the iPad.
- Mitigation is the recovery ladder:
  1. Open on the Cabinet, not the camera.
  2. Camera on, trophies hidden, saved snapshot shown as a ghost.
  3. After a timeout we find by testing, offer "Put the shelf here", which re-places the root.
  4. Optional printed plinth card (`ARImageAnchor`) for instant re-anchoring.
  5. Non-AR cabinet view.
- **A failed relocalization must never look like a lost trophy.**
- Measure it as a receipt: next-day success out of N attempts, with LiDAR and without, on the iPhone and on the iPad.

### 3.3 Thermal and memory

- Sustained camera, tracking, LiDAR and rendering is the real ceiling. Degrade on `ProcessInfo.thermalState`, as Apple advises ([WWDC26 279](https://developer.apple.com/videos/play/wwdc2026/279/)):
  - `serious`: LOD bias +1, molecule pass at 0.75× with MetalFX spatial upscaling, contact AO off.
  - `critical`: 30 fps video format, physics and display motion paused.
- Per-device memory limits are undocumented. One developer measured about 6 GB per process on a 12 GB iPhone 17 Pro Max even with `increased-memory-limit` ([forum 834805](https://developer.apple.com/forums/thread/834805)).
- A colossus at 30–60 MB is one to two orders of magnitude below that. Keep one colossus at full detail and every other at L3.
- The earlier decision that "device performance data: not a priority" (`decisions.md:33`) no longer holds. A million atoms needs per-stage GPU timings on the owner's devices.

### 3.4 Honesty of physics claims

- **True trajectories are impossible to show.** Bond vibrations take 8–38 fs and molecules rotate every 0.2–30 ps, so anything visible is slowed **10¹¹–10¹³×**. Thermal amplitude at 300 K is 0.014–0.034 Å, about 2% of a bond.
- **What we can make true:** parameters, orderings (the weakest bond goes first), mass and inertia ratios, and the labels.
- **The repo has no stiffness, bond-energy or vibrational data today.** It all needs new cited data or computed cards.
- **Table values are approximate.** Mean bond enthalpies are not specific BDEs, so expect roughly 10–20% absolute error while orderings survive **(est.)**. Prefer model scans.
- **Label ladder**, extending the web's "Illustrative":

| Level | Example copy |
|---|---|
| Illustrative | (as on the web today) |
| Chemistry-tuned | "Bond strengths from <source> · time slowed ~10¹³× · wiggle ×20" |
| Simulated | "<method> · 300 K · …" |
| Verdict | "<model> single point: +38 kJ/mol" |

- **Never imply** that molecules feel gravity, that they shatter like glass, or that a snap predicts a reaction.
- **Licences:**
  - UMA weights carry the FAIR AUP and geographic gating; keep them server-side only, if used at all.
  - GPL is out; LGPL in the App Store needs legal review.
  - MACE academic licences are unusable commercially.
  - OrbMol (Apache-2.0) and AIMNet2 (MIT) are clean.

### 3.5 Building: this Linux environment cannot compile iOS

- This environment is Linux x86_64 with no `xcodebuild` or `swift`. The repo has no `.swift`, `.metal` or `.xcodeproj` files, and every CI job runs on `ubuntu-latest` (`.github/workflows/ci.yml:69-98`).
- Xcode 27 requires an Apple-silicon Mac on macOS 26.6 or later ([Xcode 27 RN](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes)).
- Build options:

| Option | Fit |
|---|---|
| The owner's Mac (the M2 Air from the handoff guide) | Development and device runs. Performance acceptance must happen on the target devices, not be inferred from the Mac GPU (`mobile-macbook-air-handoff.md:183-185`). |
| GitHub `macos-26` runner | Xcode 26.6, iOS 26.0–26.5 SDKs |
| GitHub `xcode-27` preview runner | Xcode 27, iOS 27 SDKs; may queue ([runner-images](https://github.com/actions/runner-images/blob/main/README.md)) |
| Xcode Cloud | 25 compute hours a month included; 100 h for $49.99 ([Xcode Cloud](https://developer.apple.com/xcode-cloud/)) |
| EAS | Proven for RN only; whether it builds non-RN projects is **unverified** |

- Claude sessions on Linux can write Swift and the generators, and can test `LupiKit` only if a Linux Swift toolchain works **(external, verify)**. Every device claim needs the owner's hardware.

### 3.6 App Store, TestFlight and distribution

- Today's Ad Hoc build is provisioned only for the one registered iPhone, an **iPhone 15 Pro on iOS 26.6**. **The iPad is not registered** (`docs/mobile-macbook-air-handoff.md:35-37`).
- `supportsTablet: false` is enforced by `check-testflight-readiness.mjs:90`. The new app retires both the flag and the check.
- TestFlight needs an App Store Connect record and agreements. The repo's policy requires organization enrollment (`docs/mobile-testflight-checklist.md:566-569`). Internal TestFlight on an individual membership appears allowed by Apple **(external, verify)**, so that requirement is a project choice. The current team is `26Y4SLFJ4M`, valid through 2027-08-10.
- Uploads must be built with Xcode 26 or later and an iOS 26 SDK ([upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)).
- If accounts arrive:
  - 4.8: offering Google or GitHub login means also offering an equivalent private login such as Sign in with Apple.
  - 5.1.1(v): accounts must be deletable in the app, and the app must stay usable without login.

### 3.7 Privacy

- `ARWorldMap` holds raw feature points, and point clouds can be inverted back into images of the room ([Pittaluga et al. 2019](https://arxiv.org/abs/1904.03303)). The relocalization snapshot is literally a photo of the home.
- Rules:
  - Maps stay on the device or in the user's private iCloud.
  - Never on Lupi servers or third-party anchor clouds.
  - Deleting a shelf deletes its map.
  - Explain camera use in context before the system prompt.
- On-device-only data is not "collected" for App Privacy labels. If the audience includes children, COPPA and the UK Children's Code apply; keeping maps and photos off our servers shrinks that exposure.

### 3.8 Product risks

- **Novelty decay.** Gamification effects dipped around week 4 and recovered between weeks 6 and 10 ([Rodrigues et al. 2022](https://link.springer.com/article/10.1186/s41239-021-00314-6)). Plan a content drop for weeks 4–6.
- **Collections that die with the app** (LEGO Hidden Side, Peridot). Promise export from day one: InkModel, USDZ and GLB already exist.

---

## 4. Phased roadmap

All durations are **estimates** for one focused builder and are shown only to sequence the work.

### M0. Groundwork (1–2 weeks; mostly doable from Linux)

1. Amend `decisions.md:28` and `pocket-native-play.md:25, 682`, and record the scale policy (§2.8).
2. Write specs for `lupi.trophy.v1`, `lupi.shelf.v1`, `lupi.physics-card.v1` and `LupiPack v1`.
3. Implement `lupi-bond-orders.v1` in `packages/core`.
4. Scaffold `LupiKit`:
   - code-generated element table;
   - ports of `trueSpinCoast`, springs and motion tokens, bond recipes, and the glimbin reader;
   - golden fixtures exported from the TypeScript tests;
   - optionally a TypeScript twin of the XPBD + Morse solver, so feel can be tuned on the web first.
5. Hand-author physics cards for 5–6 slice molecules from cited table values (`Chemistry-tuned (table)`).
6. Set up the build lane on a Mac, Xcode 27 and a CI runner; create the App Store Connect record; register the iPad or go straight to internal TestFlight.
7. **Day-one device spikes:**
   - **(a)** World map plus `AnchorEntity` re-binding under RealityView, with `ARView` as the comparison.
   - **(b)** S1 post-process composition: a Metal cube and a RealityKit cube stay within 1 px during fast pans, and a real object occludes the Metal cube.
   - **(c)** Does a RealityKit dynamic body reproduce the tennis-racket flip?

*Proves:* the toolchain works end to end, and the two highest-risk APIs behave as documented.

### M1. The "wow" vertical slice: *a shelf that remembers* (4–6 weeks after M0)

What the owner sees on the iPhone 15 Pro, with the same build on the iPad:

1. **The Cabinet opens with no camera.** It shows ink drawings of caffeine, C₆₀, hydrogen peroxide, N₂ and water, taken from the existing `-ink.svg`/`-ink.json`.
2. **"Put it somewhere."** The app explains camera use, the coaching overlay appears, and LiDAR finds the shelf almost instantly. Caffeine lands on a plinth with a grounding shadow and a plaque: *"Caffeine · C₈H₁₀N₄O₂ · shown 10⁸× (1 Å = 1 cm)."* iPhone gets a haptic thunk; iPad gets a sound.
3. **Flick C₆₀.** It coasts and clicks into *"Pentagon face-on · 5-fold axis"*, using the same detents and springs as the web, ported.
4. **Grab and throw caffeine across the desk.** It tumbles with its real principal inertia (an asymmetric top flips about its middle axis), hits the real shelf through the LiDAR mesh, bounces and settles.
5. **Two-finger stretch on H₂O₂.** The O–O bond (3.3 nN-equivalent) gives long before O–H (8.3 nN). A force meter reads the XPBD λ. The label reads *Chemistry-tuned · time slowed ~10¹³×*. On release the fragments spring back and re-form.
6. **Pull N₂ as hard as you can.** It will not snap.
7. **"Look around so I can remember this shelf."** The map saves once the status is `.mapped`.
8. **Force-quit. Next morning:** the Cabinet opens, then "Visit shelf". The saved snapshot appears as a ghost, the session relocalizes, and the trophies fade in where they were. If it fails, one tap on "Put the shelf here" restores the whole arrangement.

*Proves:* the native stack, next-day persistence including the recovery ladder, the true-inertia throw, chemistry-ordered breaking, and honest labels.

*Exit receipts:* next-day relocalization success on 10 attempts per device, frame-time traces, and a 10-minute thermal trace.

### M2. The colossus: a million atoms on the shelf (4–8 weeks)

Steps, each building on the last:

1. A procedural 1M-atom Cu crystal with positions derived from the instance index, so there is no per-atom data. The HUD reads honestly, e.g. *"1,000,000 atoms · 84,212 drawn"*.
2. The real `massive_1m.glimbin` (953,312 atoms, 10.2 MB) converted to LupiPack.
3. One real mmCIF biological assembly baked server-side through BinaryCIF.

The pipeline: exterior bake, the 15,625-cluster cull, L0–L3 tiers, our impostors depth-tested against RealityKit, a contact shadow on the shelf plane, and the thermal policy.

Interaction: the whole structure is one RealityKit body (compound collider of ≤64–256 spheres) that can be thrown and lands on the shelf. Synchronous picking walks a cluster BVH, then ray-sphere tests within the hit cluster. Visual Tug and Heat apply only to touched clusters.

*Proves:* spike S2's targets: ≤ 8 ms molecule GPU and 60 fps sustained for 10 minutes at `thermalState ≤ fair` on both devices. Also points vs quads, and `depth(greater)` vs `depth(any)`.

### M3. Personalities from real data (4–6 weeks; runs in parallel with M2)

- An offline card generator for the 69 gallery molecules and 24 OMol25 picks, with provenance per field. Engines: GFN-FF scans plus OrbMol or AIMNet2 Hessians and torsion scans (Apache/MIT path).
- Rigid-cluster analysis (FIRST-style), torsion detents (sp³ rotation 12.5 kJ/mol ≈ 5 kT; amides locked), ring-strain-aware snapping, and Heat as Boltzmann normal-mode excitation.
- Personality plaques, e.g. *"Rigid: three fused rings"*, *"Fragile: O–O 142 kJ/mol"*.

*Proves:* every personality traces to a cited number; Chemistry-tuned becomes the default.

### M4. The collection loop (4–6 weeks)

- **Earning:**
  - Daily "mints" that day's molecule.
  - Scan finds ("Found in: coffee mug").
  - OMol25 specimens with CC BY 4.0 provenance.
  - A free plain copy of any Library molecule.
  - Foil bound to the roll that earned it.
- **Sets** with progress ("7 of 20"), plus a widget showing today's silhouette and a wrapped "delivery" waiting on the shelf.
- **Sync:** SwiftData and CloudKit between iPhone and iPad, and a cross-device map test before maps go to private iCloud.
- **Web bridge:** an optional Lupi account (Sign in with Apple, deletable in the app) so trophies earned on the web reach the app.
- **Content:** the weeks 4–6 drop is ready.

*Proves:* the reason to come back daily, with AR as the roughly three-minute visit.

### M5. Big play and sharing (open-ended)

- T2/T3 elastic-network deformation: tug and unzip a protein domain, at 150–300 pN-scale unfolding versus covalent rupture.
- Breaking chunks off a colossus.
- "Crystallize": many copies become real bulk structures, up to earned million-atom monuments.
- Shelf share links (arrangement only, rendered as zero-canvas ink pages on the web), and same-room iPhone + iPad co-play via ARKit collaboration.
- Ink, Remix and Foil looks in MSL. Spike S5 (iOS 27 splats as a far-field haze).

*Proves:* depth and virality without public pins or server-side room data.

---

## 5. Decisions only you can make

1. **App strategy versus the Expo app.**
   - Options: (a) new SwiftUI app at `apps/apple` taking `live.lupi.app`, with Expo frozen; (b) an Expo native module hosting RealityView; (c) ship both.
   - **Recommend (a).** The AR is now the product, Expo's `sdk-57` image (Xcode 26.6) blocks the iOS 27 APIs we want, and Viro must go regardless.

2. **OS and device floor, and exact demo hardware.**
   - Options: iOS 26.0 floor with iOS 27 features gated, or iOS 27 only. GPU floor Apple9 or Apple7.
   - **Recommend:** iOS/iPadOS 26.0 floor, built with Xcode 27, iOS 27 features behind `#available`. Apple9 (A17 Pro, A18, M4) or newer for the full colossus pipeline.
   - Please confirm your exact models. If the iPad is an Air or mini, there is no LiDAR, which removes mesh occlusion and real-surface physics. My demo preference is the iPhone 15 Pro (on record, LiDAR, Apple9) plus an iPad Pro M4 or M5.

3. **Persistence scope.**
   - Options: (a) device only; (b) collection in iCloud, maps on device; (c) collection and maps in private iCloud; (d) Lupi account.
   - **Recommend (b) for v1, moving to (c) once the iPhone-to-iPad map test passes.** Add a Lupi account only as the web bridge in M4. Room maps never go to Lupi servers.

4. **Physics fidelity tier.**
   - Options: Illustrative toys; Chemistry-tuned by default with labels; Simulated or Verdict on demand.
   - **Recommend Chemistry-tuned by default**, Illustrative only where no card exists, and edge Verdict calls as an M3+ extra.
   - Sub-decisions:
     - Card models: OrbMol, AIMNet2 and GFN-FF only (Apache/MIT path), or also gated UMA on the server? **Recommend the former.**
     - Broken trophies: always re-form, persistently broken, or heal over time? **Recommend always re-form**, since destroying creations kills attachment ([Norton et al. 2012](https://dash.harvard.edu/handle/1/12136084)).

5. **What earns a molecule into the trophy case.**
   - Options: anything free; earned only; or a free plain copy of anything plus earned editions with provenance (Daily, Scan, OMol25) and Foil.
   - **Recommend the hybrid.** Science stays free, the story is the prize, and rarity is never sold.

6. **Million-atom content and interaction scope.**
   - Content options: procedural crystal, `massive_1m.glimbin` (953,312 Cu atoms), a PDB assembly (mmCIF), an MD snapshot.
   - Interaction options: throw the whole thing; shatter into subunits; local tug.
   - **Recommend:** a procedural crystal first, then `massive_1m`, then one real virus-capsid-class assembly. v1 interaction is throwing the whole body plus visual Tug and Heat; chunk breaking and elastic-mode tug follow in M5. Space-filling, no bonds at colossus scale.
   - Also decide: available on day one, or an earned monument ("Crystallize")? **Recommend** a day-one demo piece, with earned monuments in M5.

7. **Multi-user and sharing.**
   - Options: none; arrangement-only share links; same-room co-play; remote visits; public pins.
   - **Recommend none in M1–M4. M5 adds share links (with ink web pages) and same-room iPhone + iPad co-play.** Never public pins: when Niantic shipped public persistent AR, it chose to expire placements after 48 hours.

8. **Demo date and audience.**
   - Options: a private demo to you; an investor or press demo; a classroom.
   - Need from you: the date, and whether "next day" will be shown live or recorded.
   - **Recommend** demoing in a room that was mapped beforehand, with a printed plinth card as the guaranteed backup. Treat the recovery ladder as a feature you show, not a failure.
   - Also: are children a target audience (Kids Category, COPPA)? **Recommend** adults and families first, no Kids Category in v1.

9. **Build and distribution pipeline.**
   - Do you have a Mac on macOS 26.6 or later, given the M2 Air in the handoff guide? It is non-negotiable for daily work.
   - CI options: GitHub `xcode-27` preview runner, `macos-26`, Xcode Cloud (25 h a month included), or EAS.
   - **Recommend:** your Mac for development; Xcode Cloud for TestFlight (internal testers, both devices, no UDID registration); a GitHub macOS job for compile and tests.
   - Also: keep the "organization enrollment mandatory" policy, or allow internal TestFlight under the individual team `26Y4SLFJ4M` for now? **Recommend** relaxing it for internal testing; it is a project choice, not an Apple rule (verify).

10. **Sound and haptic defaults.**
    - Options: off, like the web (`AGENTS.md`: "Sound and haptics are off by default"); on in AR; on everywhere.
    - **Recommend:** in AR, haptics on (iPhone) and sound on, because tactile feedback is the product and the iPad has no haptics. One toggle; the web keeps its defaults.
    - Motion comfort maps from the web: Standard; Gentle (no coast); Still (throws land instantly; the default when Reduce Motion is on).

11. **Scale (extra).**
    - Options: locked 1 Å = 1 cm; hand-sized normalisation; decade magnifications printed on the plaque.
    - **Recommend decade magnifications:** 10⁸× for molecules, 10⁷× for colossi, plus a "×10 bigger" toggle, applied to desk models, AR and exports alike.