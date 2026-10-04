# Lupi AR: plan of record for the native Apple game

*2026-10-04. Written for the owner. It reworks the [groundwork brief](research/00-groundwork-brief.md) around the owner's [decisions](decisions.md) (D1–D13); where the two disagree, the decisions win. The data shapes it names are specified in [contracts.md](contracts.md). Platform facts cite the research reports or the Apple page they were checked on; numbers marked **(est.)** are arithmetic or starting values to tune on a device, and **UNCONFIRMED** items need a device spike. Nothing here claims behaviour on a device that nobody has measured.*

---

## 0. The game in one paragraph

You point your iPhone Pro or iPad Pro at your room, tap a drawing of a molecule, and a glossy, candy-coloured toy of it drops into your hand. You flick it and it flies across the room, smacks your real wall, sparks, clacks, bounces off the real bookshelf and tumbles end over end the way that molecule really tumbles. Throw hydrogen peroxide hard and it cracks at its O–O bond into two real hydroxyl fragments. Throw a buckyball and it boings. Stack caffeines on your desk into a tower. Leave one on a real shelf and it stays there: tomorrow it is still on that shelf, and it is in your collection on your Lupi account. Pick up loose atoms and they snap together by valence into new molecules you can keep. Pinch any of it up to room size, all the way to a million-atom crystal. No score, no levels, no timer (D4): the reward is the feel, and a small celebration when you do something delightful.

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
| Decade magnifications as fixed steps | **Seamless user-controlled scale** from tabletop to room, with the magnification always printed (§7) | D10 |
| Sound and haptics a recommendation | **On by default in AR**, one toggle | D11 |
| Recommends iOS 26 floor, Xcode Cloud for TestFlight | iOS 26.0 floor (D3); **GitHub Actions macOS runner** compiles every push and uploads to TestFlight when the secrets exist | D2, D3 |

Kept from the brief: the native SwiftUI + RealityKit app at `apps/apple` taking `live.lupi.app` with `apps/mobile` frozen (D1); RealityView with an `ARSession` we own; the three persistence layers; the recovery ladder; the hybrid million-atom renderer; the thermal policy; the privacy rules for room maps.

---

## 3. Architecture

### 3.1 Units

| Unit | Where | Contents | Builds and tests on |
|---|---|---|---|
| **LupiKit** | `apps/apple/LupiKit` (Swift package, tools 6.0, Swift 6 language mode, no Apple-only imports) | element table generated from `packages/core/src/elements.ts`; XYZ reader and writer; port of `lupi-bonds.molecular.v1` (`packages/core/src/bonds/`) checked against `validation-v1.json`; inertia and rotor facts (port of `packages/core/src/objectFacts/inertia.ts`); personality derivation; fragmenting by graph cut; valence snapping rules; throw-velocity estimator; motion springs and tokens (`packages/core/src/motion/`); impact-sound synthesis as PCM sample arrays; haptic intensity mapping; the `lupi.trophy.v1`, `lupi.shelf.v1` and `lupi.personality.v1` Codable types; a file-backed collection store; a pure-Swift SHA-256 | Linux (`swift build`, `swift test`) and macOS |
| **Lupi app** | `apps/apple` (one universal iPhone + iPad target, `live.lupi.app`, iOS 26.0) | SwiftUI shell (Play, Cabinet, Settings); RealityView play space; ARSession, scene mesh and world maps; RealityKit bodies, gestures, collisions; Core Haptics; spatial audio; Firebase account and sync | macOS runner with Xcode (compile on every push) |
| **LupiEngine** | later, M3 | Metal colossus renderer inside RealityView post-processing: cluster culling, LOD tiers, impostors ported from WGSL and TSL | Mac only |

LupiKit carries everything that can be decided without a device, so the logic that makes the game fun is unit-tested on Linux. Two Linux rules keep it portable: no `import simd` (quaternions and transforms are LupiKit's own value types over `SIMD3<Float>`/`SIMD4<Float>`, which are standard library), and no CryptoKit (SHA-256 is implemented in LupiKit against the NIST test vectors). LupiKit must also compile with the Swift that the macOS runner's Xcode ships (Swift 6.2 on Xcode 26.6), so it avoids features newer than its tools version even though the local Linux toolchain is 6.4.

### 3.2 Runtime stack

```
LupiApp (SwiftUI, @MainActor)
├─ PlayView: RealityView (camera .spatialTracking)
│   ├─ SpatialTrackingSession.run(config, session: ownedARSession, arConfiguration: world)   // iOS 18
│   │     ARWorldTrackingConfiguration: sceneReconstruction .meshWithClassification,
│   │     planeDetection [.horizontal, .vertical], initialWorldMap (when a shelf loads)
│   ├─ Arena: scene-understanding colliders from the LiDAR mesh (or our mirrored mesh, §3.3)
│   ├─ Bodies: one Entity per molecule or fragment
│   │     PhysicsBodyComponent (explicit mass properties) + CollisionComponent (compound spheres)
│   │     render child: merged mesh, one PhysicallyBasedMaterial per element (glossy CPK)
│   ├─ Systems: GrabSystem, ImpactSystem (collision events → juice, breaks), RestSystem (settle, pin),
│   │     SnapSystem (valence building), ScaleSystem (pinch, monuments)
│   └─ Juice: CHHapticEngine, AudioBufferResource per sound family, ParticleEmitterComponent bursts
├─ CabinetView: the collection (ink drawings, plaques), works without the camera
└─ SettingsView: Sound & haptics, Motion comfort, account (sign in, sign out, delete)
LupiKit (pure Swift): molecule model, bonds, facts, personality, fragments, snapping, contracts, store
```

### 3.3 AR session and the arena

- **Session.** RealityView with `SpatialTrackingSession.run(_:session:arConfiguration:)` (iOS 18), so we own the `ARSession` and keep `initialWorldMap` and `getCurrentWorldMap` ([apple-ar-platform.md §2.2](research/apple-ar-platform.md)). The fallback, if the day-one spike fails, is `ARView` (iOS 13, not deprecated), which gives `session` and `physicsOrigin` directly.
- **Arena.** LiDAR scene reconstruction with classification (`ARMeshAnchor`, iOS 13.4) is the play field (D3). Primary path: the session's scene-understanding capabilities `[.collision, .physics, .occlusion, .shadow]`, which the iOS default enables ([apple-ar-platform.md §3](research/apple-ar-platform.md)). Mirror path: we build static colliders ourselves from each `ARMeshAnchor` with `ShapeResource.generateStaticMesh(positions:faceIndices:)` (async; 16-bit face indices, so large anchors are split), rebuilt at most every 0.5 s per anchor and only within 4 m of the camera (est.). We need the mirror if a custom physics simulation root (for slow motion, §5.4) cannot collide with the system's scene-understanding colliders: **UNCONFIRMED**, spike A2.
- **Surface classes.** For every contact we look up the nearest classified mesh face (`.wall`, `.floor`, `.table`, `.seat`, `.ceiling`, `.window`, `.door`, `.none`) in a spatial hash rebuilt when anchors update. The class picks the sound layer (a thud for walls, a tap for tables) and decides what counts as a shelf (§6.3).
- **No LiDAR.** D3 targets LiDAR devices. If `ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification)` is false, the arena falls back to detected planes as thin box colliders and the app says so once. It is a degraded mode, not a supported target.
- **Out-of-bounds rescue.** A body that falls 0.5 m below the floor or leaves a 6 m radius disappears with a poof and, if it was a trophy, goes back to the Cabinet. LiDAR meshes have holes; nothing is ever lost behind one.

### 3.4 Bodies

- **Collider:** a compound of spheres, one per heavy atom at its toy radius, with each hydrogen folded into its partner's sphere (radius grown by 15 % per H, est.). Above 48 heavy atoms, spheres are merged by a grid clustering into at most 48 bounding spheres; colossi use the cluster hierarchy (§7.3). `ShapeResource.generateSphere(radius:)` plus `offsetBy(translation:)` builds each piece ([ShapeResource](https://developer.apple.com/documentation/realitykit/shaperesource)).
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
- **Mesh:** one merged mesh per molecule built with `MeshDescriptor` (iOS 15), one material per element via per-face material indices ([doc](https://developer.apple.com/documentation/realitykit/meshdescriptor)). It needs no instancing API and no per-instance colour, which is unconfirmed on `MeshInstancesComponent` ([forum 814211](https://developer.apple.com/forums/thread/814211)). Up to about 2,000 atoms at 80–320 triangles per sphere (est.); bigger structures go to LupiEngine (§7.3).
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
- The magnification `s × 10¹⁰` is always readable on the molecule's plaque ("shown 1.5 × 10⁸ times larger"). §7 covers changing it.

### 4.2 Mass and inertia

- **Felt mass** compresses molar mass M (from `ELEMENT_DATA[z].mass`) so the ordering stays true and the range fits RealityKit's 10× guidance:
  `massKg = clamp(0.2 × (M / 180 Da)^0.4 × massScale, 0.06, 0.6)`.
  Water weighs 0.08, glucose 0.2, C₆₀ (bouncy, massScale 0.8) 0.28, and hemoglobin hits the 0.6 ceiling (est.). The exponent sits in the brief's γ = 0.3–0.5 band ([chemistry-play-physics.md §4.4](research/chemistry-play-physics.md)). Learn says the feel is compressed and shows the real molar mass.
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

All values are starting points **(est.)**. A personality never claims to be chemistry: the plaque gives the reason in plain words ("Brittle: O–O bond", "Bouncy: a cage of 60 carbons", "Flexible: 5 rotating bonds").

**Bond strengths for the game.** Until `lupi-bond-orders.v1` exists (specified in `docs/omol25-bonds-and-discovery.md` §2.6, no code yet), LupiKit estimates a bond's order from its length: the ratio of the bond length to the sum of the two single-bond covalent radii, ≤ 0.84 triple, ≤ 0.92 double, otherwise single (a Lupi game rule: N₂ reads 0.77, ethylene 0.88, ethane 1.01). The energy then comes from the mean bond enthalpies the research cites ([chemistry-play-physics.md §4.1](research/chemistry-play-physics.md): C–H 411, C–C 346, C=C 614, C≡C 839, C=O 745, O–H 459, O–O 142, N≡N 941, H–H 432, F–F 155, I–I 149, N–N 167, C≡O 1072 kJ/mol), and otherwise from game defaults (single 350, double 600, triple 850, coordination 150, ionic contact 80), which are labelled as game values. A molecule whose weakest breakable bond is 800 kJ/mol or more (N₂, CO) never breaks.

### 4.4 Breaking

- **Impact strength.** Each collision pair reports `impulse` (N·s) and `impulseDirection` on `CollisionEvents.Began` and `CollisionEvents.Updated` (iOS 13; [Began](https://developer.apple.com/documentation/realitykit/collisionevents/began), [Updated](https://developer.apple.com/documentation/realitykit/collisionevents/updated)). We take the largest impulse within 50 ms of the first contact (a first-contact impulse can read low) and convert it to a velocity change, `Δv = J / m_eff`, with `m_eff` the body's mass against the world or the reduced mass of two bodies. A pair is quiet for 80 ms after it fires.
- **Threshold.** A body breaks when `Δv ≥ breakSpeed × sqrt(D_weakest / 346 kJ/mol)`: the personality sets the base, and the weakest bond scales it (a peroxide gives way at about 64 % of a C–C molecule's speed). `breakImpulse` in the contract is that speed times the mass. A fresh fragment cannot break again for 0.25 s, so one hit never turns into dust.
- **Where it breaks: graph cut at the weakest bond class.**
  1. Find the bridges of the covalent graph (bonds whose removal splits it; ring bonds are never bridges).
  2. Take the bridges in the weakest energy class (within 10 % of the minimum). Coordination bonds and ionic contacts count as their own, weaker classes and go first.
  3. Cut the one nearest the contact point, in body coordinates. A hydrogen always leaves with its partner unless the X–H bond itself is the cut.
  4. A molecule with no bridges (a cage or a fused ring system) chips instead: the heavy atom nearest the contact leaves with its hydrogens, cutting all of its bonds.
- **Fragments are real molecules.** Each connected component becomes a new body with its own atoms in their original body-frame positions, its own mass, inertia and re-derived personality, the parent's velocity at that point (`v + ω × r`) and a 0.4 m/s separation along the cut bond. A single atom becomes a loose atom for building. A fragment is labelled honestly: formula, and "radical" when its valences are not satisfied.
- **Keeping fragments.** A fragment left on a shelf, or kept with one tap, becomes a trophy with `source: fragment` and an origin of "broken from <parent>" (D9, [contracts.md §1](contracts.md#1-lupitrophyv1)).
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
- Solver iterations are raised on the play simulation (`PhysicsSimulationComponent.solverIterations`, iOS 18).
- **Tower detection:** a stack is the longest chain of bodies each resting on the one below (contact normal within 30° of up) down to the world mesh.

### 4.7 Honesty

D8 replaces the brief's label ladder with one rule: nothing claims to be a simulation. Learn has one short section, "Toy physics", saying that masses, tumbling and which bond breaks first are loosely inspired by the molecule's real mass, shape and bond strengths, and that the weights are compressed. Plaques show only true facts (name, formula, molar mass, atom count, source, magnification, the reason for the personality). Fragments and built molecules are labelled as what they are. No copy implies that molecules feel gravity or that a break predicts a reaction ([chemistry-play-physics.md §6](research/chemistry-play-physics.md)).

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

- **Squash** is applied to the render child only, never the physics body. It compresses along the impulse direction by up to the personality's maximum × `I`, preserves volume, and recovers on the `boing` token (smooth time 0.12 s, damping 0.45). A personality-coloured wobble follows for flexible and bouncy molecules.
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
- **Config.** `GoogleService-Info.plist` for `live.lupi.app` is injected by CI from a secret (the web keeps its Firebase config in environment variables too, `packages/ui/src/auth/firebase.ts`). A build without it runs with the account features hidden.

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

### 7.1 Seamless, user-controlled (D10)

- A pinch on a held or selected molecule scales it continuously. The readout shows the magnification as it changes ("1.5 × 10⁸×"), with a detent click at each decade.
- Physics follows: while the body stays within 0.5×–3× of its spawn size it stays dynamic (colliders rebuilt at pinch end; mass unchanged, §4.2).

### 7.2 Monuments

Beyond 3× spawn size a molecule becomes a **monument**: kinematic, too big to throw, and solid ground for everything else (stack trophies on a two-metre caffeine). Shrinking it back below 3× returns it to play. A monument's span is capped at 3 m. This keeps the room-scale fantasy inside RealityKit's size-ratio guidance (§3.4).

### 7.3 The million-atom path

Taken from [million-atom-ar.md](research/million-atom-ar.md) and §2.5 of the brief, unchanged in substance:

- **Tiers by atom count:** up to about 2,000 atoms, the merged-mesh toy (§3.6); 2,000–5,000, `MeshInstancesComponent` (iOS 26); above that, **LupiEngine**, our Metal renderer drawing inside RealityView's post-processing hook with `sourceColorTexture`, `sourceDepthTexture`, `projection` and `commandBuffer` (iOS 26), so impostors are depth-tested against RealityKit's depth ([million-atom-ar.md §4](research/million-atom-ar.md)).
- **Content order:** a procedural 1,000,000-atom copper crystal (positions from the instance index, no data); then `massive_1m.glimbin` (953,312 Cu atoms, 10,156,835 bytes, served at `/gallery/trajectories/massive_1m.glimbin`); then one real assembly baked server-side.
- **Culling and LOD:** exterior bake, 15,625 clusters of 64 atoms, normal cones, two-phase Hi-Z, L0–L3 tiers from impostors to chunk splats; 50–150k atoms drawn per view; 7–10.5 ms GPU at 60 fps on paper (est., spike S2 measures it).
- **Play at a million atoms:** the colossus spawns at 1 Å = 1 mm (about 25 cm), is one dynamic body with a compound of up to 64 spheres from the cluster hierarchy, and is thrown like anything else. Grown past 3× it becomes a monument with up to 256 static spheres, and other molecules bounce off it. Space-filling, no bonds at that scale. Breaking a colossus into chunks is post-M4.
- **Thermal policy** from the brief: at `.serious`, LOD bias +1 and the molecule pass at 0.75× with MetalFX upscaling; at `.critical`, 30 fps and slow motion and particles off ([00-groundwork-brief.md §3.3](research/00-groundwork-brief.md)).

---

## 8. Roadmap

Durations are not promised. Each milestone ends with receipts the owner checks on the device; CI receipts are compile and test results only.

### M0. Groundwork and the first playable slice

- **Docs:** this plan, [contracts.md](contracts.md), the amendments to the viewer brainstorm.
- **LupiKit:** element table, XYZ reader and writer, the molecular recipe port against `validation-v1.json`, inertia facts, personality derivation, graph-cut fragments, throw estimator, springs, sound synthesis, SHA-256, and the contract types with golden JSON fixtures. `swift build` and `swift test` green on Linux and macOS.
- **App:** RealityView with an owned ARSession and LiDAR arena; the spawn tray with bundled molecules (C₆₀ first, the house molecule of the web's first minute); grab, throw, bounce off real walls, stack on real surfaces, shatter into fragments; haptics, synthesized sound, squash, sparks and hit-stop; Sound & haptics toggle and Motion comfort.
- **Build lane:** the macOS workflow compiles on every push; TestFlight upload on main once the secrets exist (§9).
- **Day-one device spikes:**
  - **A1** World map save and relocalize under RealityView with an owned ARSession, with `ARView` as the comparison.
  - **A2** Do bodies under a custom `PhysicsSimulationComponent` (slow-motion clock) collide with scene-understanding colliders? If not, mirror the mesh.
  - **A3** Does a RealityKit dynamic body reproduce the tennis-racket flip?
  - **A4** Do impulses on `CollisionEvents.Began` read reliably at first contact?
- **Exit (on device):** spawn C₆₀ and caffeine, throw them at a wall, watch them bounce and land on a shelf, stack three, break hydrogen peroxide into two pieces, all with sound and (on iPhone) haptics; no frame hitches the owner can see in a 10-minute session.

### M1. The persistent trophy shelf and the account

- Pinning, shelves as rooms, world-map save and relocalization, the recovery ladder, the Cabinet (ink drawings from `/og/m/<id>-ink.svg` and `/og/omol25/…-ink.svg`, plaques).
- Lupi account with Sign in with Apple, local-first store, Firestore sync, in-app account deletion, the Firestore rules.
- **Exit:** leave three trophies on a real shelf, force-quit, next day they are there (or one tap on "Put the shelf here" restores them); sign in on the iPad and the collection is there; delete the account in the app.

### M2. Build from atoms; fragments you keep

- Atom tray, valence snapping with the recipe's caps, geometry placement, the re-perception check, hydrogen fill, naming by matching, "Built it".
- Fragments and built molecules become trophies with embedded XYZ; the "broken from" and "built from atoms" stories.
- **Exit:** build water and ethanol from loose atoms, keep them on the shelf; break a molecule and keep a fragment; both reload with the same bonds.

### M3. The million-atom colossus and seamless scale

- Seamless pinch scale with detents and monuments.
- LupiEngine: spikes S1 (post-process composition) and S2 (1M-atom throughput) first, then the procedural crystal, `massive_1m`, and the colossus as a throwable body and a monument.
- **Exit:** a million-atom crystal on the desk, thrown, grown to room size and walked around, at a steady frame rate over 10 minutes with thermal state at `fair` or better on the owner's devices.

### M4. Personalities and polish

- Four distinct sound families with a tuning pass on device; flexible molecules that visibly flop (a 2–4 segment articulated body or a wobble deformer, spike first); bouncy cages that ring.
- Plaques with personality reasons, VoiceOver descriptions (`AccessibilityComponent`), thermal policy, first-run onboarding (one card that explains the camera before the system prompt).
- **Exit:** the owner plays for 30 minutes and wants to keep going (D4).

---

## 9. Build and distribution lane

- **Workflow** (one file, for example `.github/workflows/apple.yml`, triggered by changes under `apps/apple/**`):
  1. **LupiKit on Linux** (`ubuntu-latest`, a Swift 6 toolchain): `swift build` and `swift test` in `apps/apple/LupiKit`.
  2. **macOS** (`macos-26`: macOS 26.6, Xcode 26.6, iOS 26.0–26.5 SDKs, [apple-ar-platform.md §6](research/apple-ar-platform.md)): `swift test` for LupiKit, then `xcodebuild build` of the app for a generic iOS device with signing disabled, as the compile receipt on every push.
  3. **TestFlight**, on `main` only and only when the App Store Connect secrets are present (the step checks an environment variable set from the secret, since secrets cannot be tested in a job-level `if`): `xcodebuild archive` with automatic signing and `-allowProvisioningUpdates -authenticationKeyPath -authenticationKeyID -authenticationKeyIssuerID`, then `xcodebuild -exportArchive` with an export options file whose `method` is `app-store-connect` and `destination` is `upload`. The build number is the workflow run number.
- **Project file.** The Xcode project is generated on the runner from a checked-in spec (recommended: XcodeGen's `project.yml`), so nobody hand-merges a `.pbxproj` and Linux sessions can edit the spec.
- **iOS 27 APIs.** `macos-26` has no iOS 27 SDK. Code that uses iOS 27 APIs sits behind `#if compiler(>=6.4)` (Xcode 27 ships Swift 6.4) as well as `if #available(iOS 27, *)`, and the job moves to the `xcode-27` runner or a later stable image when M3 needs them ([apple-ar-platform.md §6](research/apple-ar-platform.md)). Uploads must be built with Xcode 26 or later and an iOS 26 SDK, which this lane meets.
- **Signing.** The team is `26Y4SLFJ4M` (`docs/mobile-testflight-checklist.md:572-574`). Cloud-managed distribution signing from `xcodebuild` needs an API key with the **Admin** role; an App Manager key fails with "Cloud signing permission error" ([Apple forum 698117](https://developer.apple.com/forums/thread/698117)).
- **What CI proves:** that LupiKit builds and its tests pass, that the app compiles, and that a build reached App Store Connect. It never proves device behaviour; that is the owner's receipt.
- **Cost:** macOS runner minutes are billed above Linux minutes on private repositories (check the plan); the macOS job runs only when `apps/apple/**` changes.

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
| Thermal and memory over 30-minute sessions | Throttling, a hot phone | Body budget, thermal policy, one colossus at full detail |
| Sign in with Apple token revocation and account deletion | App Review rejection (5.1.1(v)) | Deletion flow in M1 exactly as §6.2 |
| Firebase SDK adds build time and size | Slower CI | Account code lands in M1 only; signed-out builds run without the config |
| Linux toolchain parity (no `simd`, no CryptoKit) | LupiKit fails on one platform | The two rules in §3.1; CI runs LupiKit on both |
| Bond orders inferred from length | A wrong personality now and then | Plaque gives the reason; `lupi-bond-orders.v1` replaces the estimate when it lands |
| Novelty fades | The 30-minute promise | The pillars are the content; new molecules and delights in M4 |

---

## 11. Open asks for the owner

1. **App Store Connect API key** with the **Admin** role: the `.p8` file, its key ID and the issuer ID, stored as GitHub secrets (for example `ASC_KEY_P8` as base64, `ASC_KEY_ID`, `ASC_ISSUER_ID`).
2. **The App Store Connect app record** for bundle id `live.lupi.app` (name "Lupi"), the agreements accepted, and an internal TestFlight group with you in it. Nothing has been uploaded under that id yet (`apps/mobile/eas.json:99-101`).
3. **Team `26Y4SLFJ4M`:** confirm it, and confirm that internal TestFlight under the individual membership is fine for `apps/apple`, relaxing the "organization enrollment is mandatory" rule (`docs/mobile-testflight-checklist.md:566-569`) for this app.
4. **Firebase:** register the iOS app `live.lupi.app` in project `shed-489901` and store its `GoogleService-Info.plist` as a GitHub secret; enable the Apple provider in Firebase Auth with the Services ID, team ID, key ID and private key that Firebase asks for ([Firebase: Apple on iOS](https://firebase.google.com/docs/auth/ios/apple)); approve the Firestore rules in [contracts.md §5](contracts.md#5-account-sync-firestore-layout-and-proposed-rules).
5. **Devices:** the iPhone on record is a 15 Pro on iOS 26.6 (`apps/mobile/README.md:104-108`). Which iPad Pro (M4 or M5)? Both have LiDAR.
6. **Still comfort:** confirm that throws still fly in Still, capped and without secondary motion (§5.5).
7. **Breaking a shelved trophy:** confirm that its record is never destroyed and it returns to its shelf next session, while the fragments are new molecules (§4.4).
8. **Runner budget:** is the repository private, and is the macOS-minutes cost acceptable for a compile on every `apps/apple` push?
