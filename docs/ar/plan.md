# Lupi AR: plan of record for the native Apple game

*2026-10-04. Written for the owner. It reworks the [groundwork brief](research/00-groundwork-brief.md) around the owner's [decisions](decisions.md) (D1–D14); where the two disagree, the decisions win. The data shapes it names are specified in [contracts.md](contracts.md). Platform facts cite the research reports or the Apple page they were checked on; numbers marked **(est.)** are arithmetic or starting values to tune on a device, and **UNCONFIRMED** items need a device spike. Nothing here claims behaviour on a device that nobody has measured.*

*Amended 2026-10-04 for D14 (scale is the first principle) and the amendment to D2 (builds on the owner's Mac). Scale is the spine from M0: its architecture of record is [scale.md](scale.md), and the bytes and algorithms are [scale-spec.md](scale-spec.md). The amendment touches §0–§4, §6.2 and §7–§11; the rest stands as written. Revised 2026-10-05 after an adversarial review of the scale design ([scale.md Appendix C](scale.md#appendix-c-revision-of-2026-10-05)): §3.1, §3.2, §4.1–§4.4, §7, §8, §10 and §11.*

---

## 0. The game in one paragraph

You point your iPhone Pro or iPad Pro at your room, tap a drawing of a molecule, and a glossy, candy-coloured toy of it drops into your hand. You flick it and it flies across the room, smacks your real wall, sparks, clacks, bounces off the real bookshelf and tumbles end over end the way that molecule really tumbles. Throw hydrogen peroxide hard and it cracks at its O–O bond into two real hydroxyl fragments. Throw a buckyball and it boings. Stack caffeines on your desk into a tower. Leave one on a real shelf and it stays there: tomorrow it is still on that shelf, and it is in your collection on your Lupi account. Pick up loose atoms and they snap together by valence into new molecules you can keep. Pinch any of it up to room size, or pick up a crystal of salt with a billion atoms, or a googolplex, and it throws, smashes and stays on your shelf like a water (D14). No score, no levels, no timer (D4): the reward is the feel, and a small celebration when you do something delightful.

---

## 1. Game pillars

Each pillar is a feel target with the mechanism that delivers it. §4 and §5 give the numbers.

| Pillar | Feel target | Mechanism |
|---|---|---|
| **Throw feel** | A flick goes where your finger meant, at the speed it meant, every time | Custom grab (kinematic follow at the grab depth), release velocity from the last 100 ms of world-space hand motion plus a forward flick boost, true principal inertia for the tumble (§3.5, §4.2) |
| **Juice on every contact** | Nothing ever touches anything silently | Every collision event drives a haptic, a spatial sound, a squash and sparks, all scaled by the impact (§5) |
| **Stacking that holds** | A tower of five molecules stands until you knock it down | Compound sphere colliders, generous friction, rest damping once a body settles, raised solver iterations (§4.6) |
| **Spawn fast** | Tap to toy in the hand with no wait | The gallery and OMol25 picks ship inside the app; spawn needs no network (§3.7) |
| **Personalities you can feel** | Rigid clacks, flexible flops, brittle cracks, bouncy boings | Four personalities derived from the bond graph on device, each with its own restitution, damping, break threshold, sound and haptic sharpness (§4.3) |
| **Build from atoms** | Bring a loose oxygen to two hydrogens and it clicks into water | Valence snapping with the `lupi-bonds.molecular.v1` caps, then a name if you made something known (§4.5) |
| **Persistent shelf** | A molecule left on a real shelf is there tomorrow | Collection record on the Lupi account, placement relative to a shelf root in an `ARWorldMap` on device, and a recovery ladder that never loses a trophy (§6) |
| **No ceiling** | A googolplex of salt is held, thrown, smashed and kept like a water, and its plaque prints the exact count | LupiScale: every piece is a node in one content-addressed hierarchy, drawn through a budgeted cut whose cost follows the screen, never the atom count (§7, [scale.md](scale.md)) |

Hidden delights (D4) get a small celebration (a lime ring, a three-note chime, a triple haptic) and are never counted or scored:

- **Bank shot:** a thrown molecule touches a wall, then comes to rest on a shelf within 2 s.
- **Tower:** four or more molecules resting on each other, each supported by the one below.
- **Built it:** a built molecule has every atom at its usual valence, or matches a molecule Lupi knows ("You built ethanol").
- **Home run:** a throw that lands more than 3 m away.
- **Feather landing:** a thrown molecule comes to rest on a shelf after touching down at under 0.3 m/s.
- **First crack:** the first time a given molecule breaks.

---

## 2. What changes from the groundwork brief

| Brief | Plan of record | Why |
|---|---|---|
| Collection in SwiftData + CloudKit; Lupi account only as an M4 web bridge | Collection on the **Lupi account** (Firebase Auth with Sign in with Apple), local-first and usable signed out | D7 |
| Three minutes of chemistry-tuned play; XPBD Morse bonds on device; "Chemistry-tuned" by default | A **sandbox physics game for 30 minutes**; molecules are rigid toy bodies whose personalities are *loosely inspired* by the bond graph; no simulation claims | D4, D8 |
| Earned editions, sets ("7 of 20"), Daily mints | **Spawn anything, no gating**; no sets, scores or levels; hidden delights only | D4, D6 |
| Broken trophies always re-form | **Breaking makes real fragments you can keep**; a shelved trophy's record is never destroyed by play (§4.4) | D9, plus the attachment finding in [retention-collection.md §2.1](research/retention-collection.md) |
| Shelf share links, same-room co-play (M5) | **Never multi-user**, no share links, no web shelf page | D7, D12 |
| Decade magnifications as fixed steps | **Seamless user-controlled scale** from tabletop to room, with the magnification always printed, for any count from one atom to a googolplex (§7) | D10, D14 |
| A million-atom colossus as a separate tier, with its own renderer and milestone | **Scale is the spine from M0:** one representation, cut, physics, persistence and UI from 10³ atoms to a googolplex; the colossus and the googolplex are content milestones on it (§7, §8) | D14 |
| Sound and haptics a recommendation | **On by default in AR**, one toggle | D11 |
| Recommends iOS 26 floor, Xcode Cloud for TestFlight | iOS 26.0 floor (D3); **the app builds on the owner's Mac** with XcodeGen and Xcode, Linux CI tests the pure-Swift packages, and there is no TestFlight lane for now (§9) | D2 as amended, D3 |

Kept from the brief: the native SwiftUI + RealityKit app at `apps/apple` taking `live.lupi.app` with `apps/mobile` frozen (D1); RealityView with an `ARSession` we own; the three persistence layers; the recovery ladder; the hybrid million-atom renderer (now LupiEngine, one backend under the scale cut, §7.4); the thermal policy; the privacy rules for room maps.

---

## 3. Architecture

### 3.1 Units

| Unit | Where | Contents | Builds and tests on |
|---|---|---|---|
| **LupiKit** | `apps/apple/LupiKit` (Swift package, tools 6.0, Swift 6 language mode, no Apple-only imports) | element table generated from `packages/core/src/elements.ts`, with integer micro-dalton masses; XYZ reader and writer; port of `lupi-bonds.molecular.v1` (`packages/core/src/bonds/`) checked against `validation-v1.json`; inertia and rotor facts (port of `packages/core/src/objectFacts/inertia.ts`); personality derivation and felt mass `lupi.feltmass.v1` (`LupiPlay`); the gesture arbiter; fragmenting by graph cut; valence snapping rules; throw-velocity estimator; motion springs and tokens (`packages/core/src/motion/`); impact-sound synthesis as PCM sample arrays; haptic intensity mapping; the `lupi.trophy.v1`, `lupi.shelf.v1` and `lupi.personality.v1` Codable types; a file-backed collection store; a pure-Swift SHA-256 in its own `LupiCore` target, the one public SHA-256 an app sees (`LupiScaleCore` keeps a package-internal one, [scale-spec.md §1.5](scale-spec.md)) | Linux (`swift build`, `swift test`) and macOS |
| **LupiScale** | `apps/apple/LupiScale` (Swift package, tools 6.0, Swift 6 language mode, Foundation only) | `LupiScaleCore` (no dependencies): NodeIDs, BigUInt, Magnitude and its formatting, node records and the frozen generator registry v1, paths, LupiPack v1 and `lupi.scale-ref.v1`. `LupiScale` (over LupiKit's `LupiChem` and `LupiPlay`): the resolver, anchors and frames, the budgeted cut, collision proxies, the personality of nodes that are not molecules, breaking by expansion. Byte for byte with the TypeScript reference in `packages/core/src/scale`, held to it by shared golden fixtures ([scale-spec.md](scale-spec.md)) | Linux (`swift build`, `swift test`) and macOS |
| **Lupi app** | `apps/apple` (one universal iPhone + iPad target, `live.lupi.app`, iOS 26.0) | SwiftUI shell (Play, Cabinet, Settings); RealityView play space; ARSession, scene mesh and world maps; RealityKit bodies, gestures, collisions; the cut's draw items as RealityKit meshes, instances, boxes and planes; Core Haptics; spatial audio; Firebase account and sync | the owner's Mac with Xcode (local builds, §9) |
| **LupiEngine** | later, M3b | Metal renderer inside RealityView post-processing for dense explicit structures at full detail (`massive_1m`, baked assemblies): cluster culling, LOD tiers, impostors ported from WGSL and TSL. One backend under LupiScale's cut (§7.4) | the owner's Mac |

LupiKit and LupiScale carry everything that can be decided without a device, so the logic that makes the game fun, and every byte of scale, is unit-tested on Linux. Two Linux rules keep them portable: no `import simd` (quaternions and transforms are LupiKit's own value types over `SIMD3<Float>`/`SIMD4<Float>`, which are standard library), and no CryptoKit (SHA-256 is implemented in LupiKit against the NIST test vectors). They must also compile with the Swift that Xcode 26.x ships on the owner's Mac (6.2 or later; Xcode 26 introduced Swift 6.2, [apple-ar-platform.md §1](research/apple-ar-platform.md)), so they avoid features newer than their tools version even though the local Linux toolchain is 6.4.

### 3.2 Runtime stack

```
LupiApp (SwiftUI, @MainActor)
├─ PlayView: RealityView (camera .spatialTracking)
│   ├─ SpatialTrackingSession.run(config, session: ownedARSession, arConfiguration: world)   // iOS 18
│   │     ARWorldTrackingConfiguration: sceneReconstruction .meshWithClassification,
│   │     planeDetection [.horizontal, .vertical], initialWorldMap (when a shelf loads)
│   ├─ Arena: scene-understanding colliders from the LiDAR mesh (or our mirrored mesh, §3.3)
│   ├─ Bodies: one Entity per body; a body is a LupiScale piece (a root and a path), a water or a googolplex
│   │     PhysicsBodyComponent (explicit mass properties) + CollisionComponent (LupiScale proxy:
│   │     compound spheres, a box or a hull)
│   │     render: the cut's draw items; a molecule of ≤ 2,000 atoms is one merged mesh,
│   │     one PhysicallyBasedMaterial per element (glossy CPK)
│   ├─ Systems: GrabSystem, ImpactSystem (collision events → juice, breaks), RestSystem (settle, pin),
│   │     SnapSystem (valence building), ScaleSystem (pinch, scale axis, size states),
│   │     CutSystem (every frame, after the physics step: anchors and rebasing, the budgeted cut,
│   │     draw items as children of each body's entity; it never moves a body)
│   └─ Juice: CHHapticEngine, AudioBufferResource per sound family, ParticleEmitterComponent bursts
├─ CabinetView: the collection (ink drawings, plaques), works without the camera
└─ SettingsView: Sound & haptics, Motion comfort, account (sign in, sign out, delete)
LupiKit (pure Swift): molecule model, bonds, facts, personality, fragments, snapping, contracts, store
LupiScale (pure Swift): nodes, paths, Magnitude, packs and references, anchors, the cut, proxies, felt mass
```

### 3.3 AR session and the arena

- **Session.** RealityView with `SpatialTrackingSession.run(_:session:arConfiguration:)` (iOS 18), so we own the `ARSession` and keep `initialWorldMap` and `getCurrentWorldMap` ([apple-ar-platform.md §2.2](research/apple-ar-platform.md)). The fallback, if the day-one spike fails, is `ARView` (iOS 13, not deprecated), which gives `session` and `physicsOrigin` directly.
- **Arena.** LiDAR scene reconstruction with classification (`ARMeshAnchor`, iOS 13.4) is the play field (D3). Primary path: the session's scene-understanding capabilities `[.collision, .physics, .occlusion, .shadow]`, which the iOS default enables ([apple-ar-platform.md §3](research/apple-ar-platform.md)). Mirror path: we build static colliders ourselves from each `ARMeshAnchor` with `ShapeResource.generateStaticMesh(positions:faceIndices:)` (async; 16-bit face indices, so large anchors are split), rebuilt at most every 0.5 s per anchor and only within 4 m of the camera (est.). We need the mirror if a custom physics simulation root (for slow motion, §5.4) cannot collide with the system's scene-understanding colliders: **UNCONFIRMED**, spike A2.
- **Surface classes.** For every contact we look up the nearest classified mesh face (`.wall`, `.floor`, `.table`, `.seat`, `.ceiling`, `.window`, `.door`, `.none`) in a spatial hash rebuilt when anchors update. The class picks the sound layer (a thud for walls, a tap for tables) and decides what counts as a shelf (§6.3).
- **No LiDAR.** D3 targets LiDAR devices. If `ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification)` is false, the arena falls back to detected planes as thin box colliders and the app says so once. It is a degraded mode, not a supported target.
- **Out-of-bounds rescue.** A body that falls 0.5 m below the floor or leaves a 6 m radius disappears with a poof and, if it was a trophy, goes back to the Cabinet. LiDAR meshes have holes; nothing is ever lost behind one.

### 3.4 Bodies

- **Collider:** a compound of spheres, one per heavy atom at its toy radius, with each hydrogen folded into its partner's sphere (radius grown by 15 % per H, est.). Above 48 heavy atoms, spheres are merged by a grid clustering into at most 48 bounding spheres. Anything bigger than a molecule takes its proxy from LupiScale: a box for a crystal or a tower level, a hull, or a group's spheres ([scale-spec.md §10.4](scale-spec.md), §7.3). `ShapeResource.generateSphere(radius:)` plus `offsetBy(translation:)` builds each piece ([ShapeResource](https://developer.apple.com/documentation/realitykit/shaperesource)).
- **Mass properties:** set explicitly with `PhysicsMassProperties(mass:inertia:centerOfMass:)`, which takes principal moments and the principal-axis orientation ([doc](https://developer.apple.com/documentation/realitykit/physicsmassproperties)), from LupiKit's inertia facts (§4.2). Overlapping compound spheres would otherwise give a wrong automatic mass.
- **Body:** `PhysicsBodyComponent(massProperties:material:mode:)` with the personality's material from `PhysicsMaterialResource.generate(staticFriction:dynamicFriction:restitution:)`, `linearDamping`, `angularDamping` and `isContinuousCollisionDetectionEnabled = true` for everything thrown ([PhysicsBodyComponent](https://developer.apple.com/documentation/realitykit/physicsbodycomponent), [PhysicsMaterialResource](https://developer.apple.com/documentation/realitykit/physicsmaterialresource)).
- **Engine limits we design around:** Apple says RealityKit physics "works best if the size and mass ratios don't exceed one order of magnitude" and if each object's smallest dimension is at least 0.05 units ([Designing scene hierarchies for efficient physics simulation](https://developer.apple.com/documentation/realitykit/designing-scene-hierarchies-for-efficient-physics-simulation)). So felt mass lives in a 10× band (§4.2), dynamic bodies stay within 0.5×–3× of their spawn size, and anything grown beyond that becomes a monument (§7.2). Loose atoms (about 3 cm beads) sit below the 0.05 m guidance; CCD is on for them.
- **Budget (est.):** at most 40 dynamic bodies at once; beyond that the oldest loose fragment poofs. Pinned trophies are counted separately, up to 60 per shelf.

### 3.5 Grab and throw (custom)

`ManipulationComponent` is visionOS only ([apple-ar-platform.md §3](research/apple-ar-platform.md)), so the throw is ours. It is the most important code in the app.

1. **Grab.** A one-finger drag that starts on a molecule (`DragGesture().targetedToAnyEntity()` with `InputTargetComponent` and the body's `CollisionComponent`, iOS 18) grabs it. The body switches to `.kinematic`. The grab depth `d0` is the camera distance of the hit point, clamped to 0.25–1.5 m.
2. **Hold.** Each frame the target is the touch ray (`RealityCoordinateSpaceProjecting.ray(through:in:to:)`, iOS 18) at depth `d0`. The body follows on the `snap` motion token (smooth time 0.05 s, critically damped; `packages/core/src/motion/tokens.ts`) and leans up to 12° toward its motion, so it feels held, not glued.
3. **Release.** Velocity is the least-squares slope of the target's world positions over the last 100 ms (at least 3 samples), which already includes how the phone itself moved. A flick adds a forward component along the camera's view: 0.0025 m/s per pt/s of upward screen speed, so a 2,000 pt/s flick throws about 5 m/s into the room (est., tune on device). The total is capped at 8 m/s. Spin is 2 rad/s per m/s of sideways release speed about the axis perpendicular to the throw, then the body's true inertia does the rest.
4. **Hand-off.** The body switches to `.dynamic` and receives the velocity once, as an impulse (`applyLinearImpulse`, iOS 13), which Apple recommends over forces for frame-rate independence (same page as above).
5. **Two fingers** on a held or selected molecule: pinch scales it (§7.1), twist turns it.

LupiKit owns the velocity estimator, the flick mapping and their tests. The web's release-velocity code (`packages/ui/src/camera/releaseVelocity.ts`) is the reference for the windowed estimate.

### 3.6 The look

D5: glossy toy, true CPK colours, chunky bonds, soft shadows on the real table.

- **Atoms:** spheres at a toy radius of `clamp(0.75 × covalent radius, 0.32 Å, 0.9 Å)` (est.), coloured with `ELEMENT_DATA[z].color` from `packages/core/src/elements.ts` (the web's CPK palette, kept by `docs/brainstorm/2026-09-viewer-play/decisions.md:20`).
- **Bonds:** half-bond cylinders of radius 0.16 Å (est.), each half in its atom's colour. Coordination bonds are thinner and dashed, ionic contacts dotted, as on the web (`packages/core/src/bonds/types.ts`).
- **Material:** `PhysicallyBasedMaterial` (iOS 15) with roughness 0.3, clearcoat 1.0 and clearcoat roughness 0.05 for the candy gloss ([doc](https://developer.apple.com/documentation/realitykit/physicallybasedmaterial)); metals get metallic 0.6.
- **Mesh:** one merged mesh per molecule built with `MeshDescriptor` (iOS 15), one material per element via per-face material indices ([doc](https://developer.apple.com/documentation/realitykit/meshdescriptor)). It needs no instancing API and no per-instance colour, which is unconfirmed on `MeshInstancesComponent` ([forum 814211](https://developer.apple.com/forums/thread/814211)). Up to about 2,000 atoms at 80–320 triangles per sphere (est.); bigger structures are drawn through LupiScale's cut (§7.4).
- **Shadows:** `GroundingShadowComponent` (iOS 18) plus the scene-understanding shadow, so a molecule on your desk sits on it.

### 3.7 Data in

The app ships the gallery coordinate files, the 24 OMol25 picks and the few PubChem 3D records the first slice needs that the gallery lacks (hydrogen peroxide, CID 784) in its bundle, so the first spawn needs no network. Online, it refreshes from lupi.live: `/m/manifest.json`, the gallery XYZ files, `/datasets/omol25/featured.v1.json` and the edge's OMol25 browse and structure routes. PubChem names are looked up directly at PubChem with the same three requests the web uses, because the edge has no REST PubChem route. [contracts.md §4](contracts.md#4-molecule-sources-the-app-reads) lists every endpoint with its code citation and limits.

Every molecule's game graph comes from LupiKit's port of `lupi-bonds.molecular.v1`, forced for any non-periodic frame of at most 2,000 atoms (the web's `bondProfile: 'molecular'`, `packages/core/src/bonds/select.ts`). The InkModel bond pairs are not used for play, because the gallery drawings use the Object Facts 1.15× distance rule (`scripts/molecule-pages/catalog.mts:358`), not the molecular recipe. One rule for every source means fragments and snaps behave the same whatever you spawned.

---

## 4. Physics design

Fun first (D8). The numbers below are starting values: the owner tunes them on the device, and LupiKit keeps them in one table so tuning is one edit.

### 4.1 Units and scale

- Physics runs in metres, kilograms and seconds.
- A molecule spawns at a **toy scale** `s` (metres per ångström) that makes its widest span 15 cm, clamped to 0.005–0.04 m/Å (5×10⁷× to 4×10⁸×). Caffeine and C₆₀ spawn at about 15 cm; water hits the 0.04 m/Å ceiling at about 9 cm; a protein hits the 0.005 m/Å floor at about 30 cm (est.).
- Anything bigger than a molecule (a LupiScale crystal, tower or group) spawns 15 cm long, or 3 cm thick if that is larger, up to 30 cm long, without the clamp: a cube is 15 cm, the googolplex bar 30 × 3 × 3 cm ([scale-spec.md §10.1](scale-spec.md)). Its magnification is held as LupiScale's exact pair λ, never as one Float metres per Å ([scale-spec.md §8.7](scale-spec.md)): the googolplex bar is "shown 10^(−3.333 × 10^99) times life size".
- The magnification `s × 10¹⁰` is always readable on the molecule's plaque ("shown 1.5 × 10⁸ times larger"). §7 covers changing it.

### 4.2 Mass and inertia

- **Felt mass** compresses molar mass M (from the element table's integer micro-daltons) so the ordering stays true and the range fits RealityKit's 10× guidance:
  `massKg = max(0.06, b(M × massScale^2.5))`, where `b(M) = 0.2 × (M / 180 Da)^0.4` up to about 1,018 Da, so below it this is exactly `0.2 × (M / 180 Da)^0.4 × massScale`. Above that, a slow tail that never reaches 0.6 keeps the order true all the way to a googolplex instead of clamping everything over 2.8 kDa to the ceiling (`lupi.feltmass.v1`, [scale-spec.md §10.2](scale-spec.md), D14). The personality shifts a body along the curve, so no personality reaches the ceiling and a brittle googolplex still outweighs every molecule.
  Water weighs 0.08, glucose 0.2, C₆₀ (bouncy, massScale 0.8) 0.28; at massScale 1, hemoglobin 0.54, a million-atom salt crystal 0.57 and a googolplex 0.5998 (est.). Above about 10 kDa the differences are a few percent, too small to feel in a throw; heft (sound and haptics) and the plaque carry the scale. The exponent sits in the brief's γ = 0.3–0.5 band ([chemistry-play-physics.md §4.4](research/chemistry-play-physics.md)). The "Toy physics" info sheet says the feel is compressed, and the plaque shows the real molar mass.
- **Inertia** keeps the true shape of the molecule's inertia tensor: each principal moment is `massKg × (I_i / M) × s²`, with `I_i` the point-mass principal moments in amu·Å² and the axes from the same diagonalisation (`lupi.object-facts.v1`, `packages/core/src/objectFacts/types.ts`). The smallest moment is floored at 0.02 × the largest, as the web's free-spin coast does for linear rotors (`packages/ui/src/camera/trueSpinCoast.ts`), to keep the solver stable.
- **Tumble.** With true moments, an asymmetric top thrown spinning about its middle axis should flip (the tennis-racket effect). Whether RealityKit's solver keeps the gyroscopic terms that need is **UNCONFIRMED** ([chemistry-play-physics.md §2](research/chemistry-play-physics.md)); spike A3 checks it. If it does not, LupiKit's port of `trueSpinCoast.ts` drives the orientation while the body is airborne and hands back to RealityKit on first contact.
- Mass does not change with toy scale while a body is dynamic (0.5×–3× of spawn size), which keeps the 10× band.

### 4.3 Personalities

Four kinds, derived on device from the game graph by fixed rules (`lupi.personality.v1`, [contracts.md §3](contracts.md#3-lupipersonalityv1)). The first rule that matches wins:

1. **Brittle** if the weakest breakable bond is under 200 kJ/mol (peroxide O–O, N–N, F–F, I–I), or the molecule has any coordination bond or ionic contact, or any 3- or 4-membered ring.
2. **Bouncy** if it is a single atom, a spherical top (rotor `spherical` in Object Facts: C₆₀, adamantane, methane), or a cage where every heavy atom is in a ring and there are at least 20 heavy atoms.
3. **Flexible** if it has at least 3 rotatable bonds (covalent, single by geometry, not in a ring, both ends with at least 2 heavy neighbours).
4. **Rigid** otherwise (benzene, caffeine, water, N₂).

| | Rigid | Flexible | Brittle | Bouncy |
|---|---|---|---|---|
| Restitution | 0.35 | 0.15 | 0.20 | 0.85 |
| Friction (static / dynamic) | 0.7 / 0.5 | 0.9 / 0.7 | 0.6 / 0.45 | 0.5 / 0.35 |
| Linear damping | 0.05 | 0.12 | 0.05 | 0.02 |
| Angular damping | 0.08 | 0.45 | 0.10 | 0.03 |
| Break speed Δv (m/s), before bond scaling | 3.0 | 4.5 | 1.2 | 6.5 |
| massScale | 1.0 | 0.9 | 0.85 | 0.8 |
| Squash on impact (max) | 6 % | 18 % | 3 % | 25 % |
| Sound family | clack (hard plastic) | thwap (rubber) | tink (glass) | boing (rubber ball) |
| Haptic sharpness | 0.8 | 0.3 | 1.0 | 0.5 |

All values are starting points **(est.)**, and this table is the contract ([contracts.md §3.3](contracts.md#3-lupipersonalityv1)): LupiKit's `PersonalityTable.v1` on `ar/kit` differs today (brittle `massScale` 1.1, base break speed 2.5, and others) and is brought to it in M0. A personality never claims to be chemistry: the plaque gives the reason in plain words ("Brittle: O–O bond", "Bouncy: a cage of 60 carbons", "Flexible: 5 rotating bonds"). Crystals, towers and groups take the personality of one materialized leaf ([scale-spec.md §10.6](scale-spec.md)): every salt rung is brittle.

**Bond strengths for the game.** Until `lupi-bond-orders.v1` exists (specified in `docs/omol25-bonds-and-discovery.md` §2.6, no code yet), LupiKit estimates a bond's order from its length: the ratio of the bond length to the sum of the two single-bond covalent radii, ≤ 0.84 triple, ≤ 0.92 double, otherwise single (a Lupi game rule: N₂ reads 0.77, ethylene 0.88, ethane 1.01). The energy then comes from the mean bond enthalpies the research cites ([chemistry-play-physics.md §4.1](research/chemistry-play-physics.md): C–H 411, C–C 346, C=C 614, C≡C 839, C=O 745, O–H 459, O–O 142, N≡N 941, H–H 432, F–F 155, I–I 149, N–N 167, C≡O 1072 kJ/mol), and otherwise from game defaults (single 350, double 600, triple 850, coordination 150, ionic contact 80), which are labelled as game values. A molecule whose weakest breakable bond is 800 kJ/mol or more (N₂, CO) never breaks.

### 4.4 Breaking

- **Impact strength.** Each collision pair reports `impulse` (N·s) and `impulseDirection` on `CollisionEvents.Began` and `CollisionEvents.Updated` (iOS 13; [Began](https://developer.apple.com/documentation/realitykit/collisionevents/began), [Updated](https://developer.apple.com/documentation/realitykit/collisionevents/updated)). We take the largest impulse within 50 ms of the first contact (a first-contact impulse can read low) and convert it to a velocity change, `Δv = J / m_eff`, with `m_eff` the body's mass against the world or the reduced mass of two bodies. A pair is quiet for 80 ms after it fires.
- **Threshold.** A body breaks when `Δv ≥ base × sqrt(D_weakest / 346 kJ/mol)`: the personality sets the base, and the weakest bond scales it (a peroxide gives way at about 64 % of a C–C molecule's speed). That product is `breakSpeed` in the contract, and `breakImpulse` is `breakSpeed` times the mass. A fresh fragment cannot break again for 0.25 s, so one hit never turns into dust.
- **Where it breaks: graph cut at the weakest bond class.**
  1. Find the bridges of the bond graph, covalent bonds, coordination bonds and ionic contacts together (bonds whose removal splits it; ring bonds are never bridges).
  2. Take the bridges in the weakest energy class (within 10 % of the minimum). Coordination bonds and ionic contacts count as their own, weaker classes and go first.
  3. Cut the one nearest the contact point, in body coordinates. A hydrogen always leaves with its partner unless the X–H bond itself is the cut.
  4. A molecule with no bridges (a cage or a fused ring system) chips instead: the heavy atom nearest the contact leaves with its hydrogens, cutting all of its bonds.
- **Fragments are real molecules.** Each connected component becomes a new body with its own atoms in their original body-frame positions, its own mass, inertia and re-derived personality, the parent's velocity at that point (`v + ω × r`) and a 0.4 m/s separation along the cut bond. A single atom becomes a loose atom for building. A fragment is labelled honestly: formula, and "radical" when its valences are not satisfied.
- **Keeping fragments.** A fragment left on a shelf, or kept with one tap, becomes a trophy with `source: fragment` and an origin of "broken from <parent>" (D9, [contracts.md §1](contracts.md#1-lupitrophyv1)).
- **Crystals, towers and groups expand instead** ([scale-spec.md §10.6](scale-spec.md)): only at Δv of 3 m/s or more, so a crystal survives a drop and smashes against a wall; into at most 16 pieces that share the parent's felt mass, start with inset colliders, grow to at least 6 cm and cannot break again for 1 s; drawn as instanced atoms until their meshes are built, one per frame.
- **A trophy is never destroyed by play.** Breaking a pinned trophy breaks the copy in play. Its collection record stays, its placement is removed, and the next session it is back on its shelf (or "Put back" brings it now). This keeps D9 (real fragments) and the research's warning that destroying creations kills attachment ([retention-collection.md §2.1](research/retention-collection.md)).

### 4.5 Building from atoms

- **Atom tray.** H, C, N, O, F, P, S, Cl, Br, I, Na, plus every loose atom a break produced. Tray atoms spawn at 0.025 m/Å (a carbon is a 3 cm bead, est.); an atom entering another body's magnet zone glides to that body's toy scale, so a snap always joins two pieces at one scale.
- **Snap rule.** Two atoms in different bodies snap when (a) their centres are within the bond cutoff of `lupi-bonds.molecular.v1`, the covalent radii (Cordero 2008) plus 0.45 Å, scaled to the toy scale, with a magnet zone of 1.6× that distance that pulls gently on the `glide` token; (b) both are below their covalent valence cap, `VALENCE_CAPS` in `packages/core/src/bonds/classes.ts` (H 1, C 4, N 4, O 3 by that recipe's own choice, F 1, S 6, P 6, halogens 7 with the partner rules); (c) the pair is a covalent class pair. s-block ions (Li, Na, K, Mg, Ca, …) make ionic contacts within their coordination caps instead, and noble gases never snap. These are the same caps the recipe uses (D9).
- **Geometry.** The new bond is placed at the sum of the covalent radii, along the free direction nearest the contact taken from an ideal geometry for the atom's new partner count (linear, trigonal or tetrahedral), never closer than 45° to an existing bond (the recipe's acute-angle rule). The two bodies merge into one; mass and inertia are recomputed.
- **Check.** LupiKit re-runs the recipe on the merged coordinates. If the graph it perceives is not the intended graph, the snap is refused with a soft bounce. Whatever you build therefore reloads with exactly the bonds you made.
- **Done.** When every atom reaches its usual valence (H 1, C 4, N 3, O 2, halogens 1, S 2, P 3: a cue table separate from the caps), the molecule gets the "Built it" celebration. LupiKit then matches its formula and graph against the bundled gallery and OMol25 picks; a match gets the name ("You built ethanol"), otherwise it is named by its formula. One tap fills every open valence with hydrogens.

### 4.6 Stacking and rest

- Compound spheres fixed in one body do not roll like marbles: a flat molecule lying on its face rests on many contacts and holds. Linear molecules roll, as a dumbbell would.
- **Rest damping:** when a body is touching something, slower than 3 cm/s and turning slower than 0.3 rad/s for 0.25 s, its damping rises to 2.0 linear and 4.0 angular. Any impulse above 0.05 N·s or a grab restores its personality's damping.
- Solver iterations are raised on the play simulation root (`PhysicsSimulationComponent.solverIterations`, iOS 18), which shares spike A2's question about scene-understanding colliders.
- **Tower detection:** a stack is the longest chain of bodies each resting on the one below (contact normal within 30° of up) down to the world mesh.

### 4.7 Honesty

D8 replaces the brief's label ladder with one rule: nothing claims to be a simulation. One short info sheet, "Toy physics" (from the plaque and from Settings), says that masses, tumbling and which bond breaks first are loosely inspired by the molecule's real mass, shape and bond strengths, and that the weights are compressed. Plaques show only true facts (name, formula, molar mass, atom count, source, magnification, the reason for the personality). Fragments and built molecules are labelled as what they are. No copy implies that molecules feel gravity or that a break predicts a reaction ([chemistry-play-physics.md §6](research/chemistry-play-physics.md)).

---

## 5. The juice spec

### 5.1 Scaling

- **Impact intensity** `I = clamp((Δv / 2 m/s)^0.6, 0.15, 1.0)` drives every channel.
- **Haptics** use Core Haptics transient and continuous events with `hapticIntensity` and `hapticSharpness` (iOS 13; [ParameterID](https://developer.apple.com/documentation/corehaptics/chhapticevent/parameterid)). The engine starts only if `CHHapticEngine.capabilitiesForHardware().supportsHaptics`, which is false on iPad ([apple-ar-platform.md §3](research/apple-ar-platform.md)); there, sound and visuals carry everything.
- **Rate limits:** at most 30 haptic events per second; clicks closer than 35 ms merge, as on the web (`packages/ui/src/play/feedback.ts`, `MIN_CLICK_GAP_MS`).
- **One toggle** in Settings, "Sound & haptics", on by default in AR (D11). The audio session uses the `.ambient` category, so the Ring/Silent switch is respected and the user's music keeps playing.

### 5.2 Sounds

- **Synthesized, not sampled.** LupiKit synthesizes each family as a short modal impact (a few damped partials plus a noise transient) into PCM arrays. This is testable on Linux and needs no audio assets. The app wraps them in `AVAudioPCMBuffer` and `AudioBufferResource(buffer:configuration:)` (iOS 15; [doc](https://developer.apple.com/documentation/realitykit/audiobufferresource)) at launch: 4 families × 3 size bands × 2 intensity layers.
- **Families (est.):**

| Family | Character | Partial ratios | Decay |
|---|---|---|---|
| clack | hard plastic, bright | 1 : 2.32 : 4.25 | 80 ms |
| thwap | rubber, dull, noisy | 1 : 1.6 | 50 ms |
| tink | glass, ringing, inharmonic | 1 : 2.76 : 5.40 | 250 ms |
| boing | rubber ball, pitch drop | 1 : 1.5 | 180 ms |

- **Size and pitch:** the fundamental scales with `(15 cm / span)^0.5`, so a bigger molecule sounds lower.
- **Playback:** `Entity.playAudio(_:)` on the molecule, which plays spatially by default ([doc](https://developer.apple.com/documentation/realitykit/entity/playaudio(_:)), [SpatialAudioComponent](https://developer.apple.com/documentation/realitykit/spatialaudiocomponent), iOS 18). Gain is set on the returned controller from `I`, and speed varies ±4 % so repeats never sound identical.
- **Surface layer:** a low thud for `.wall` and `.floor`, a tap for `.table`, nothing extra for `.none`.

### 5.3 Events

| Event | Haptic (iPhone) | Sound | Visual |
|---|---|---|---|
| Spawn | transient 0.4 / 0.5 | soft pop | drops in on the `land` token; 8 sparks in its own colours |
| Grab | transient 0.3 / 0.6 (the web's grab cue) | tick | lifts 1 cm, lean begins |
| Throw (release) | none (the finger already felt it) | whoosh scaled by speed | short motion trail |
| Impact, wall or surface | transient `I` / personality sharpness | family at `I` + surface layer | squash, sparks (6 + 30·`I`) in the colours of the two nearest atoms |
| Molecule hits molecule | transient `I` / mean sharpness | both families, half gain each | both squash, sparks |
| Bounce chain (3rd+ bounce in 1 s) | transient 0.6·`I` | family, pitch +5 % per bounce | — |
| Settle (comes to rest) | transient 0.2 / 0.2 | soft tock | squash recovers |
| Pinned to a shelf ("Kept") | 0.35 / 0.2, then 0.6 / 0.6 after 90 ms | two-note "kept" chime | lime ring under it, plaque fades in |
| Knocked off a shelf | transient 0.5 / 0.8 | family | ring fades |
| Break | transient 1.0 / 1.0, then 120 ms continuous rumble 0.6 → 0 at sharpness 0.3 | family crack + shatter layer | 60 sparks, shards, hit-stop or slow motion (§5.4) |
| Snap (atom joins) | two transients 0.5 / 0.9, 40 ms apart | click-clack | new bond grows on the `click` token |
| Snap refused | transient 0.3 / 0.2 | dull bump | soft bounce apart |
| Built it / delight | three transients 0.4, 0.5, 0.6 at 0, 110, 220 ms (the web's Foil chime spacing) | three rising notes | lime ring and a short caption |
| Scale detent (each decade of magnification) | transient 0.3 / 0.9 (the web's detent cue) | house click | readout flashes |

### 5.4 Squash, sparks, hit-stop and slow motion

- **Squash** is applied to the render child only, never the physics body. It compresses along the impulse direction by up to the personality's maximum × `I`, preserves volume, and recovers on the `boing` token (smooth time 0.12 s, damping 0.45). Flexible and bouncy molecules wobble for a moment after.
- **Sparks:** `ParticleEmitterComponent.burst()` (iOS 18; [doc](https://developer.apple.com/documentation/realitykit/particleemittercomponent)), 0.25 s life, 0.4–1.2 m/s, in CPK colours.
- **Hit-stop** for medium hits (`I ≥ 0.6`): the struck molecule's render child holds its pose for 50 ms while physics runs on, then catches up on the `snap` token. It costs nothing and needs no clock.
- **Slow motion** for big moments (a break, `Δv > 4 m/s`, a bank shot landing): the play simulation runs at quarter speed for 220 ms and eases back over 180 ms, at most once every 2 s. The documented hook is `PhysicsSimulationComponent.clock`, a `CMClockOrTimebase` that "drives the physics simulation" (iOS 18; [doc](https://developer.apple.com/documentation/realitykit/physicssimulationcomponent)), driven by a timebase at rate 0.25. Whether bodies under a custom simulation root still collide with the scene-understanding mesh is **UNCONFIRMED** (spike A2); if not, the mirrored arena (§3.3) or hit-stop alone carries it.
- **Never shake the camera.** In AR the camera is the user's view of their room; shaking it is nausea, not juice.

### 5.5 Motion comfort

Comfort follows the web's three levels (`AGENTS.md`, "Motion comfort"), and Still is the default when Reduce Motion is on. Sound and haptics do not depend on it, because they are not motion (`packages/ui/src/play/feedback.ts`).

| | Standard | Gentle | Still |
|---|---|---|---|
| Throws | as thrown | speed capped at 4 m/s | speed capped at 1.5 m/s; a throw is a short lob |
| Squash, wobble | full | half | off |
| Sparks | full | half count, no drift | off (a static flash ring instead) |
| Hit-stop, slow motion | on | off | off |
| Spin on release | full | half | off |
| Scale glides | animated | animated | cut |

The brief's Still made throws "land instantly". In a throwing game that removes the game, so Still keeps the user's own throw (direct manipulation) and removes everything that moves on its own. This is a plan choice for the owner to confirm (§11).

---

## 6. Persistence

### 6.1 Three layers that never mix

| Layer | What | Where | Rule |
|---|---|---|---|
| **Collection** | `lupi.trophy.v1` records | Device first (LupiKit file store), synced to the Lupi account when signed in | Never lost because of tracking, never destroyed by play |
| **Placement** | `lupi.shelf.v1` per room: the `ARWorldMap`, a shelf root anchor and trophy transforms relative to it, plus a snapshot image | Device only, excluded from backup (D7) | Best effort, with the recovery ladder |
| **Play** | Everything moving, fragments not kept, the atom tray | Memory only | Gone when the session ends |

### 6.2 The Lupi account

- **Firebase Auth with Sign in with Apple** (D7), in the existing Firebase project `shed-489901` (`apps/mcp-worker/wrangler.toml`). Swift: `OAuthProvider.appleCredential(withIDToken:rawNonce:fullName:)` with a SHA-256-hashed nonce on the Apple request ([Firebase: Apple on iOS](https://firebase.google.com/docs/auth/ios/apple)). The app offers Apple only, so guideline 4.8 is met as written; Google and GitHub stay web-only for now ([retention-collection.md §3.5](research/retention-collection.md)).
- **Local-first.** The app is fully usable signed out (guideline 5.1.1(v)): the collection lives in LupiKit's file store, and signed-out use makes no Firebase calls at all. Signing in uploads the local records to the account and from then on syncs both ways. Signing out keeps the local copy.
- **Sync** (M1): Firestore documents at `users/{uid}/trophies/{trophyId}`, one per record, with last-writer-wins on `updatedAt` and tombstones (`deletedAt`) so deletions propagate. The Firestore rules to add are proposed in [contracts.md §5](contracts.md#5-account-sync-firestore-layout-and-proposed-rules); today `firestore.rules` has no per-user collection.
- **Account deletion in the app** (5.1.1(v)): Settings → Delete account → re-authenticate with Apple to get a fresh authorization code → `Auth.auth().revokeToken(withAuthorizationCode:)` (token revocation is required for Sign in with Apple accounts) → delete the `users/{uid}` documents → `user.delete()`. The local collection and room maps stay on the device unless the user also chooses "Erase this device's collection".
- **No account-only features.** Everything works signed out; the account adds the collection on a second device and survival across a new phone.
- **Config.** The Firebase client configuration for `live.lupi.app` stays on the owner's Mac and is never committed (the web keeps its Firebase config in environment variables too, `packages/ui/src/auth/firebase.ts`); with local builds (§9) nothing is injected by CI. The account design (`docs/ar/account-and-sync.md` on the `ar/acct` branch) narrows it to an iOS-restricted API key and the project id. A build without it runs with the account features hidden.

### 6.3 Shelves and world maps

- **What counts as a shelf.** A trophy pins when it has rested for 3 s on world mesh at least 25 cm above the floor (the lowest `.floor` surface), or on a stack whose bottom rests there. The floor is the play area and is never persisted. Pinning creates or updates the trophy record and its placement.
- **A shelf is a room.** The first pin in a session without a loaded shelf creates one: an `ARAnchor` named `lupi.shelf.root` at the first pinned trophy's support point, and a `lupi.shelf.v1` file. Every placement is a transform relative to that root, so re-placing the root restores the whole arrangement ([retention-collection.md §2.1](research/retention-collection.md)).
- **Saving the map:** `getCurrentWorldMap` only when `worldMappingStatus` is `.extending` or `.mapped`, archived with `NSKeyedArchiver`; debounced to 5 s after the last pin, and again after every successful relocalization, with a camera snapshot stored beside it as in Apple's sample ([apple-ar-platform.md §2.1](research/apple-ar-platform.md)). "Look around the shelf so I can remember it" asks for coverage when the status is still `.limited`.
- **Size discipline.** Community reports put the useful limit near 100 m² and a 58 MB map failing on an iPhone 17 Pro ([apple-ar-platform.md §2.1](research/apple-ar-platform.md)). One map per room; the app keeps a list of rooms ("Living room", "Desk") and opens the last one used.
- **Privacy.** Maps hold feature points that can be inverted into images, and the snapshot is a photo of the home ([retention-collection.md §3.6](research/retention-collection.md)). They stay on the device, are excluded from backup, are never uploaded, and deleting a room deletes its map and snapshot.

### 6.4 The recovery ladder

1. **Open into play, trophies hidden.** While the session is `.limited(.relocalizing)` the shelf's trophies are hidden (HIG) and its snapshot shows as a small ghost card: "Look at your shelf". The Cabinet is one tap away and always shows every trophy.
2. **Relocalized:** trophies fade in at their placements with a soft "kept" chime, and the map is re-saved.
3. **After 20 s without a match** (to tune on device: the research has no number, [retention-collection.md §3.3](research/retention-collection.md)), offer "Put the shelf here": tap a surface and the root moves there, bringing the whole arrangement.
4. **"Start a new room"** if the room has changed; the old map stays until deleted.
5. **Any trophy can be spawned from the Cabinet** into play at any time, so a failed match never looks like a lost trophy.
6. The coaching overlay's "Start Over" is overridden (`coachingOverlayViewDidRequestSessionReset`), because by default it "removes any existing anchors" ([apple-ar-platform.md §2.1](research/apple-ar-platform.md)).

A printed plinth card (`ARImageAnchor`) stays a later option, not v1.

---

## 7. Scale

D14: "Million atom needs to be first principle. Should scale from 1k to googleplex if we needed." Scale is therefore not a feature that arrives in M3. It is the spine the rest of this plan stands on, from M0. [scale.md](scale.md) is the architecture of record and [scale-spec.md](scale-spec.md) the normative bytes and algorithms; this section is the summary the rest of the plan relies on.

### 7.1 Seamless, user-controlled (D10, D14)

- A pinch on a held or selected molecule scales it continuously about the pinch point, or, for a molecule resting on something, about its footprint, so it never sinks into the table. The readout shows the magnification as it changes ("1.5 × 10⁸×"), with a detent click at each decade and at life size.
- From 10⁻³²× to 10³²× of life size the fingers map one to one. Beyond, the pinch moves along a logarithmic scale axis, and a two-finger hold flies: from the googolplex bar down to its atoms takes about 18 s ([scale-spec.md §8.8](scale-spec.md)). The picture zooms at a steady rate while the readout races, because the anchor jumps by whole self-similar repeats of the tower, so nothing strobes. Still turns flight into cuts between detents, and Gentle halves its speed. Which two-finger gesture is which is one arbiter's job ([scale-spec.md §10.5](scale-spec.md)).
- Physics follows: the body is kinematic while pinched and its colliders scale with it; while it stays within 0.5×–3× of its spawn size it is dynamic again afterwards (mass unchanged, §4.2).

### 7.2 Monuments and terrain

Beyond 3× spawn size a body becomes a **monument**: kinematic, too big to throw, and solid ground for everything else (stack trophies on a two-metre caffeine). Shrinking it back below 3× returns it to play. Past a 3 m span it becomes **terrain**: static, with a fixed collider for each outer face near you, which no rebuild ever removes, and small windows of atom bumps around the camera and around slow bodies, so you can stand on a plain of salt and throw molecules across it. While the camera is inside the solid, toys are parked until you come out. There is at most one terrain at a time ([scale-spec.md §10.1](scale-spec.md)). This keeps the room-scale fantasy close to RealityKit's size-ratio guidance (§3.4).

### 7.3 The spine: LupiScale

- **Nodes.** Everything in play is a node in one content-addressed graph, named by the SHA-256 of an immutable record:
  - a **leaf** of up to 4,096 atoms, in file order and Float32 exactly as the web parses it;
  - a **group** that instances its children (a capsid's subunits);
  - a **crystal** generated from a 52-byte record (copper's billion, diamond, the diamondoids, the salt seed);
  - a **tower** that replicates a seed self-similarly (a googolplex of salt is a 168-byte record);
  - an **edit** that removes pieces.
- **Pieces.** A body, fragment, chip or kept piece is a root and a canonical path. A piece of a piece is its parent's path plus one exact step, whatever the contact point was.
- **Counts** are exact Magnitudes, printed one way on the HUD, the plaques and the web: `953,312`, `10^30`, `10^(10^100)`, `9 × 10^(10^100 − 1)`.
- **The cut.** Each frame, a traversal ordered by screen-space error picks what to draw, under hard caps per thermal state on nodes visited, draw items and atoms. A child that is not ready draws as its parent. Cost follows the pixels and the hand, never the count: the 10⁹, 10¹⁰⁰ and googolplex rungs cost the same for the same footprint, and that is a Linux test.
- **Frames.** Positions are relative to an anchor node that moves as you zoom. They are composed in binary64 relative to an origin near what is drawn (a body's entity, a camera frame, or with LupiEngine the eye) and cast to Float32 once, so vertex error stays sub-pixel at any depth ([scale-spec.md §8.6](scale-spec.md)). RealityKit's physics owns a moving body's pose, and the cut draws into it.
- **Physics** uses the node's proxy (§3.4) and felt mass from its exact mass (§4.2). Breaking expands one level: a molecule cuts its weakest bridge as in §4.4, a crystal box splits into octants, a tower level into its children (the googolplex bar into ten cubes) and a group into its children ([scale-spec.md §10.6](scale-spec.md)).
- **Keeping** writes a `lupi.scale-ref.v1` reference into the trophy ([scale-spec.md §7](scale-spec.md)): 229 bytes for any salt rung from 10⁶ to 10¹⁰⁰, 270 for the googolplex bar. Generator records are embedded, so a kept googolplex never needs the network, and a piece of at most 4,096 atoms embeds everything it needs, even when it came from a pack. Packs that bigger pieces depend on are kept forever.
- **Determinism.** Generators use integers and Q16 fixed point, with one correctly rounded step to Float32, and their versions are frozen like Remix `r1`. TypeScript writes golden fixtures that the Swift tests read.

### 7.4 Rendering through the cut

| Draw item | Drawn by | Used for |
|---|---|---|
| merged mesh | RealityKit (§3.6) | a molecule of at most 2,000 atoms, held or thrown: the M0 look |
| instanced atoms | RealityKit `MeshInstancesComponent`, one per element colour (cost at 5,000 is UNCONFIRMED, spike S7) | atoms near the eye in crystals and towers |
| instanced boxes, face planes | RealityKit | solid crystal and tower nodes farther away: a googolplex is one box until you look closer |
| impostors, splats | LupiEngine (M3b) | dense explicit structures at full detail |

- **RealityKit first.** The whole salt ladder, a googolplex included, draws with RealityKit alone. Atoms outside the merged-mesh path draw space-filling, without bonds. LupiEngine is needed only for dense explicit structures at full detail (`massive_1m`, baked assemblies), so spike S1 no longer blocks the spine.
- **LupiEngine** keeps the design in [million-atom-ar.md](research/million-atom-ar.md): it draws inside RealityView's post-processing hook with `sourceColorTexture`, `sourceDepthTexture`, `projection` and `commandBuffer` (iOS 26), depth-tested against RealityKit's depth ([million-atom-ar.md §4](research/million-atom-ar.md)), with exterior bake, 64-atom clusters, normal cones, two-phase Hi-Z and L0–L3 tiers; 50–150k atoms drawn per view, 7–10.5 ms GPU at 60 fps on paper (est., spike S2 measures it).
- **Budgets** (iPhone 15 Pro, est.): per frame at `fair`, 8,192 nodes visited, 4,096 draw items, 5,000 RealityKit-instanced atoms, one merged-mesh build and 1.0 ms of traversal CPU, with less at `serious` and `critical` ([scale-spec.md §9.3](scale-spec.md)). The cut counts its pending work, so no budget is ever exceeded. RealityKit reports no GPU time per pass, so until LupiEngine two controllers steer the error threshold τ: dropped frames, and budgets (a cut that hits one raises τ rather than leave a patchwork). With LupiEngine, its pass's GPU time near 8 ms joins them. Frame rate is protected, and detail is what gets spent.
- **What is drawn.** Nodes buried on all sides are skipped, and a refined crystal draws only its exposed atoms. On RealityKit's budget, a million-atom crystal on the desk is boxes with atoms only near the eye; LupiEngine draws every exposed ion.
- **Thermal policy** from the brief, in this order: τ up; atom budgets down; at `.serious`, LupiEngine's pass at 0.75× with MetalFX upscaling (M3b; RealityKit has no such step); at `.critical`, 30 fps (if spike A5 shows the video format can change without losing tracking) with slow motion and particles off ([00-groundwork-brief.md §3.3](research/00-groundwork-brief.md)); then the oldest loose pieces poof, and the cache evicts to aggregates. Exact counts, paths and keeps never degrade.

### 7.5 Content on the spine

| Content | Atoms | Records | Milestone |
|---|---|---|---|
| the salt crystal at 10³, 10⁶ and 10⁹ | 1,000 to 1,000,000,000 | a tower of 126 or 127 B over a 52 B seed | M0, the scale receipt |
| the salt ladder on to 10³⁰ (a 2.82 m cube at life size, 48.6 t), 10¹⁰⁰ and 10^(10^100) | exact | 127 or 168 B + 52 B | M3a |
| diamond and the diamondoids, adamantane C₁₀H₁₆ to C₂₉₂₅H₆₇₆ | 26 to 3,601 | 52 B each | M3a |
| copper's billion, the web's `BillionAtomBlock` | 1,000,188,000 | 52 B | M3a |
| `massive_1m.glimbin` (served at `/gallery/trajectories/massive_1m.glimbin`) | 953,312 | 233 leaves and 35 groups, a 12.5 MB pack | M3b |
| one real assembly, baked server-side | its own | a pack | M3b |

- **A googolplex is a bar, not a cube.** 10¹⁰⁰ ≡ 1 (mod 3), so 10^(10^100) atoms cannot make a cube. The tower's top level is a 10 : 1 : 1 bar of ten cubes, and a hard throw smashes it into those ten cubes of 10^(10^100 − 1) atoms each.
- **Play at every scale.** A colossus or a googolplex spawns at §4.1's size, is one dynamic body with its proxy, and is thrown like anything else; grown, it becomes a monument and then terrain (§7.2). Breaking expands one level (§7.3), so breaking a colossus into chunks, post-M4 in the earlier plan, is now ordinary play.
- **Grow ×2** (proposed, §11): any molecule becomes the seed of a factor-2 tower, one level per tap, and keeps its size in the hand while the molecules inside shrink. A hundred taps on a water make 3 × 2¹⁰⁰ atoms in a 123-byte record.

---

## 8. Roadmap

Durations are not promised. Each milestone ends with receipts the owner checks on the device, from builds on the owner's Mac (§9); CI receipts are Linux test results only. Scale is the spine from M0 (D14): the colossus and the googolplex are content milestones on it (M3).

### M0. Groundwork, the scale spine and the first playable slice on it

- **Docs:** this plan, [contracts.md](contracts.md), [scale.md](scale.md) and [scale-spec.md](scale-spec.md), the amendments to the viewer brainstorm.
- **LupiKit:** element table (with integer micro-dalton masses, `lupi.mass.v1`), XYZ reader and writer, the molecular recipe port against `validation-v1.json`, inertia facts, personality derivation with `PersonalityTable.v1` brought to contracts.md §3.3, graph-cut fragments, throw estimator, the gesture arbiter, springs, sound synthesis, SHA-256 moved into its own `LupiCore` target, and the contract types with golden JSON fixtures; `GameUnits`' felt mass replaced by `FeltMass`, `lupi.feltmass.v1` ([scale-spec.md §10.2](scale-spec.md)). `swift build` and `swift test` green on Linux and macOS.
- **LupiScale, the spine (D14):** `LupiScaleCore` and `LupiScale` in Swift and the TypeScript reference in `packages/core/src/scale`, which writes the golden fixtures, for the part M0 plays with: leaves, crystals and towers, paths, counts and formatting, the cut, frames and proxies, with their vectors from [scale-spec.md §12](scale-spec.md) reproduced in both languages; `swift test` green on Linux and on the owner's Mac. M0 persists nothing, so nothing freezes yet ([scale-spec.md §0](scale-spec.md)). The directive is a Linux test: for the same footprint and camera, cuts over the 10⁹, 10¹⁰⁰ and googolplex rungs visit within ±10 % of each other and never exceed a budget.
- **App:** RealityView with an owned ARSession and LiDAR arena; the spawn tray with bundled molecules (C₆₀ first, the house molecule of the web's first minute); grab, throw, bounce off real walls, stack on real surfaces, shatter into fragments; haptics, synthesized sound, squash, sparks and hit-stop; Sound & haptics toggle and Motion comfort. All of it on the spine: every spawned molecule is a leaf, every collider comes from a LupiScale proxy, every break returns selections, and every pinch goes through the anchor and the scale axis.
- **Scale receipt:** the salt crystal at 10³, 10⁶ and 10⁹ atoms, drawn through the cut with RealityKit instanced atoms and boxes, held and thrown like a water, and seen from inside: the 10⁹ crystal pinched until its ions are about 2 cm across, which exercises the deep cut, rebasing and the neighbourhood. Frame time is flat across all of it, at the same budgets, and the HUD prints the exact total and the drawn count.
- **Build lane:** builds on the owner's Mac with XcodeGen and Xcode; Linux CI runs `swift test` for the pure-Swift packages (§9).
- **Day-one device spikes:**
  - **A1** World map save and relocalize under RealityView with an owned ARSession, with `ARView` as the comparison.
  - **A2** Do bodies under a custom `PhysicsSimulationComponent` (slow-motion clock) collide with scene-understanding colliders? If not, mirror the mesh.
  - **A3** Does a RealityKit dynamic body reproduce the tennis-racket flip?
  - **A4** Do impulses on `CollisionEvents.Began` read reliably at first contact?
  - **S7** What does `MeshInstancesComponent` cost at 5,000 to 30,000 spheres split by element colour, which the scale receipt draws with? Can a `CustomMaterial` read an instance index (for per-instance colour and screen-door fades)?
  - **S10** How long does a merged mesh of 1,000 and of 2,000 atoms take to build off the main actor (`MeshDescriptor` or `LowLevelMesh`), the budget a break's pieces wait on?
- **Exit (on device), in two parts.** The playable slice: spawn C₆₀ and caffeine, throw them at a wall, watch them bounce and land on a shelf, stack three, break hydrogen peroxide into two pieces, all with sound and (on iPhone) haptics; no frame hitches the owner can see in a 10-minute session. The scale receipt: salt crystals of 10³, 10⁶ and 10⁹ atoms on the desk and from inside, held and thrown at the same frame time, with exact counts on the HUD. The playable slice does not wait for the receipt; M1's exit does.

### M1. The persistent trophy shelf and the account

- Pinning, shelves as rooms, world-map save and relocalization, the recovery ladder, the Cabinet (ink drawings from `/og/m/<id>-ink.svg` and `/og/omol25/…-ink.svg`, plaques).
- Lupi account with Sign in with Apple, local-first store, Firestore sync, in-app account deletion, the Firestore rules.
- Every keep writes a scale reference: `lupi.scale-ref.v1` in the trophy's optional `molecule.scale` ([scale-spec.md §7.4](scale-spec.md)), approved before M1 (§11). LupiScale's records, paths, Magnitude and references are complete in both languages, with every §12 vector they cover, and they freeze with the first build that writes such a trophy ([scale-spec.md §0](scale-spec.md)).
- **Exit:** the M0 scale receipt holds; leave three trophies on a real shelf, force-quit, next day they are there (or one tap on "Put the shelf here" restores them); a kept salt crystal of a billion atoms comes back as the same crystal; sign in on the iPad and the collection is there; delete the account in the app.

### M2. Build from atoms; fragments you keep

- Atom tray, valence snapping with the recipe's caps, geometry placement, the re-perception check, hydrogen fill, naming by matching, "Built it".
- Fragments and built molecules become trophies with embedded XYZ; the "broken from" and "built from atoms" stories.
- Fragments, chips and built molecules are scale references too, with selections as their exact form.
- **Exit:** build water and ethanol from loose atoms, keep them on the shelf; break a molecule and keep a fragment; both reload with the same bonds.

### M3. Scale content on the spine: the colossus and the googolplex

Pinch, the cut and scale references are already M0's and M1's. M3 is content, the larger size states and the renderers they need (§7.5).

- **M3a, RealityKit only:** the salt ladder to a googolplex (the bar of ten cubes) with the 2.82 m life-size cube of 10³⁰; diamond and the diamondoids; copper's billion as one record; monuments and terrain, the scale axis with flight and dive, and chips; Grow ×2 if the owner confirms it. Spikes first: S8 (terrain collision-window rebuild latency) and S9 (box and convex colliders at the size extremes); S6 (lattice shading on boxes) is optional.
- **M3b, LupiEngine:** spikes S1 (post-process composition) and S2 (throughput) first, then `massive_1m` and one baked assembly at full impostor detail. Its pack is the first lupi.live serves, from an append-only R2 bucket (§11); groups, the partition bake and packs freeze with it.
- **Exit:** a million-atom crystal on the desk, thrown, grown to room size and walked around, at a steady frame rate over 10 minutes with thermal state at `fair` or better on the owner's devices; and a googolplex of salt held, thrown, smashed into ten cubes and kept on a shelf, at the same frame time as the million.

### M4. Personalities and polish

- Four distinct sound families with a tuning pass on device; flexible molecules that visibly flop (a 2–4 segment articulated body or a wobble deformer, spike first); bouncy cages that ring.
- Plaques with personality reasons, VoiceOver descriptions (`AccessibilityComponent`), thermal policy (spike A5 first: can a 30 fps video format be set without losing tracking?), first-run onboarding (one card that explains the camera before the system prompt).
- **Exit:** the owner plays for 30 minutes and wants to keep going (D4).

---

## 9. Build and distribution lane

D2 as amended on 2026-10-04 ([decisions.md](decisions.md#d2-amended-2026-10-04-builds-on-the-owners-mac)): the app is built, signed and run on the owner's own Mac, and CI keeps only what Linux can prove. This supersedes the earlier lane of a macOS runner compiling every push and uploading to TestFlight.

- **Local builds on the owner's Mac.** The Xcode project is generated from a checked-in XcodeGen spec, `apps/apple/project.yml` (written with the app in M0), so nobody hand-merges a `.pbxproj` and Linux sessions can edit the spec. The generated `Lupi.xcodeproj` is not committed.
  ```bash
  brew install xcodegen; cd apps/apple && xcodegen generate && open Lupi.xcodeproj
  ```
  Then select team `26Y4SLFJ4M` (Signing & Capabilities, automatic signing; the team is also in `docs/mobile-testflight-checklist.md:572-574`), choose the connected iPhone or iPad, and run on the device. Re-run `xcodegen generate` after pulling changes to `project.yml` or adding files.
- **Linux CI.** One workflow, `.github/workflows/apple.yml` (written on the `ar/ci` branch), runs on `ubuntu-latest` in a Swift 6.4 container. It runs `swift test` for every pure-Swift package under `apps/apple` (LupiKit and LupiScale; a new package is picked up without editing the workflow) and checks that the Swift files generated from the web's TypeScript are current (`pnpm apple:check`; the scale fixtures join it when LupiScale lands). There is no macOS job.
- **No TestFlight lane for now.** No App Store Connect key, archive or upload. If a TestFlight lane is wanted later, the earlier design (an `xcodebuild archive` with automatic signing, then `-exportArchive` with `method` `app-store-connect` and `destination` `upload`; cloud signing from `xcodebuild` needs an **Admin**-role API key, [Apple forum 698117](https://developer.apple.com/forums/thread/698117)) is in this file's history.
- **Toolchains.** The app needs Xcode 26 or later for the iOS 26 SDK, and Xcode 26 ships Swift 6.2 or later. The pure-Swift packages stay within tools 6.0, so the same sources build in Xcode and in CI's Swift 6.4 (§3.1).
- **iOS 27 APIs.** Code that uses iOS 27 APIs sits behind `#if compiler(>=6.4)` (Xcode 27 ships Swift 6.4) as well as `if #available(iOS 27, *)`, so the app still builds with Xcode 26 until the owner moves to Xcode 27 ([apple-ar-platform.md §6](research/apple-ar-platform.md)).
- **What each proves.** CI proves that the pure-Swift packages build and pass their tests on Linux, golden fixtures included, and that the generated sources are current. It never proves that the app compiles or how it behaves on a device: those receipts come from the owner's Mac. So app changes are built on the Mac before they merge.
- **Cost:** Linux minutes only.

---

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| World-map relocalization under RealityView is unproven ([forum 773741](https://developer.apple.com/forums/thread/773741)) | The persistent shelf, the product's biggest promise | Spike A1 on day one; `ARView` fallback; the recovery ladder |
| Relocalization fails in a changed room | Trophies seem lost | Trophies hidden while relocalizing, Cabinet always complete, "Put the shelf here", re-save after each match |
| Slow-motion clock vs scene-understanding colliders (A2) | No slow motion, or molecules fall through walls during it | Mirror the arena mesh, or ship hit-stop only |
| RealityKit lacks gyroscopic terms (A3) | Tumbles look generic | LupiKit's `trueSpinCoast` port drives airborne orientation |
| First-contact impulse reads low (A4) | Breaks and juice miss hits | Max over Began and Updated in a 50 ms window; fall back to pre-contact relative velocity |
| LiDAR mesh holes and lag; fast small bodies tunnel | Molecules vanish into walls | CCD on, 8 m/s cap, out-of-bounds rescue with a poof |
| RealityKit's 10× size and mass guidance | Jitter, explosions | Mass band, dynamic scale band, monuments, beads at about 3 cm with CCD |
| Thermal and memory over 30-minute sessions | Throttling, a hot phone | Body budget, the cut's budgets and τ controller, thermal policy, one dense structure at full detail |
| Sign in with Apple token revocation and account deletion | App Review rejection (5.1.1(v)) | Deletion flow in M1 exactly as §6.2 |
| Firebase SDK adds build time and size | Slower builds on the Mac | Account code lands in M1 only; signed-out builds run without the config |
| Linux toolchain parity (no `simd`, no CryptoKit) | LupiKit or LupiScale fails on one platform | The two rules in §3.1; Linux CI runs their tests, and the owner's Mac builds them with Xcode |
| No CI compile of the app (D2 as amended) | A broken app build surfaces only on the Mac | Everything testable lives in the pure-Swift packages, which CI tests; app changes are built on the Mac before they merge |
| Swift and TypeScript drift in a scale generator | A kept piece regenerates differently | Integer-only generators with one correctly rounded float step, shared golden fixtures, frozen versions, the probe and the count re-checked on every load ([scale.md §9](scale.md)) |
| The spine delays M0's playable slice | A later first playable | M0 builds only the part it plays with and freezes nothing; the playable slice does not wait for the scale receipt; the spine is integer code written and tested on Linux in parallel with the device spikes; spawn, collider and break can fall back to the direct path without a data change |
| RealityKit-only drawing of instances and boxes is too slow or too plain (UNCONFIRMED, S7) | The salt ladder drops frames or looks blocky | τ rises first; buried nodes skipped and only exposed atoms drawn; lattice shading (S6); LupiEngine (M3b) for dense detail |
| A pack a trophy needs is gone from lupi.live | A kept colossus chunk cannot be restored on a new device | Packs in an append-only R2 bucket, never deleted; pieces of at most 4,096 atoms embed everything they need; trophies store their shape and colour for offline display |
| Bond orders inferred from length | A wrong personality now and then | Plaque gives the reason; `lupi-bond-orders.v1` replaces the estimate when it lands |
| Novelty fades | The 30-minute promise | The pillars are the content; new molecules and delights in M4 |

---

## 11. Open asks for the owner

1. **App Store Connect API key:** not needed for now, because there is no TestFlight lane (D2 as amended, §9).
2. **The App Store Connect app record** for bundle id `live.lupi.app`: not needed until a TestFlight lane returns. Nothing has been uploaded under that id yet (`apps/mobile/eas.json:99-101`).
3. **Team `26Y4SLFJ4M`:** select it in Xcode for local builds (§9). Whether internal TestFlight under the individual membership is fine for `apps/apple` (relaxing the "organization enrollment is mandatory" rule, `docs/mobile-testflight-checklist.md:566-569`) waits for a TestFlight lane.
4. **Firebase:** register the iOS app `live.lupi.app` in project `shed-489901` and keep its client configuration on your Mac (§6.2); enable the Apple provider in Firebase Auth with the Services ID, team ID, key ID and private key that Firebase asks for ([Firebase: Apple on iOS](https://firebase.google.com/docs/auth/ios/apple)); approve the Firestore rules in [contracts.md §5](contracts.md).
5. **Devices:** the iPhone on record is a 15 Pro on iOS 26.6 (`apps/mobile/README.md:104-108`). Which iPad Pro (M4 or M5)? Both have LiDAR.
6. **Still comfort:** confirm that throws still fly in Still, capped and without secondary motion (§5.5).
7. **Breaking a shelved trophy:** confirm that its record is never destroyed and it returns to its shelf next session, while the fragments are new molecules (§4.4).
8. **Runner budget:** settled by D2's amendment: Linux minutes only, with no macOS runner (§9).
9. **Grow ×2:** confirm the proposed verb. Any molecule becomes the seed of a factor-2 tower, one level per tap, keeping its size in your hand while the molecules inside shrink, and 331 taps take a water past a googol ([scale.md §5.6](scale.md)). If you decline it, it is the first thing cut.
10. **The googolplex showpiece:** a googolplex cannot be a cube (10¹⁰⁰ ≡ 1 mod 3), so the salt tower's top is a bar of ten cubes (30 × 3 × 3 cm in your hand), and a hard throw smashes it into those ten. Confirm the salt ladder (10³, 10⁶, 10⁹, the life-size 10³⁰, 10¹⁰⁰ and 10^(10^100), with one bromide in every thousand atoms at a place that varies from copy to copy) as the showpiece (§7.5).
11. **Felt mass above 1 kDa:** confirm the slow tail that keeps the order of masses to a googolplex (hemoglobin 0.54 kg instead of the 0.6 ceiling), with the personality shifting a body along the curve rather than scaling it past the ceiling. Be aware that above about 10 kDa the differences are a few percent, which no throw can feel: the order is honest, but heft (the sound and the haptic tail) and the plaque are what make a googolplex feel bigger than a googol. It also replaces LupiKit's `GameUnits` curve (§4.2).
12. **Trophy amendment:** approve `source: scale` and the optional `molecule.scale` reference (with its optional shape-and-colour `aggregate`) in `lupi.trophy.v1` before M1 ([scale-spec.md §7.4](scale-spec.md)).
13. **A pack bucket on lupi.live (before M3b):** an R2 bucket and Worker route for `/scale/p/<contentId>.lpk` that the deploy only ever adds to. Trophies that keep big pieces of explicit colossi depend on those packs forever, and Workers static assets drop files at the next deploy ([scale-spec.md §6.8](scale-spec.md), [contracts.md §4.4](contracts.md)).
