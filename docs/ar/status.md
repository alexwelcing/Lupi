# Lupi AR: status for the owner

*2026-10-05, branch `ar/native`. What is built, how to build and run it on your Mac, what to check on the iPhone 15 Pro and the iPad Pro, and where the first compile is most likely to fail. "Built" means the code exists and its Linux tests pass. The app itself (`apps/apple/Lupi`) has only been parsed (`swiftc -parse`); it has never been type-checked, compiled, signed or run. Nothing here has run on a device.*

The plan of record is [plan.md](plan.md); the scale spine is [scale.md](scale.md) and [scale-spec.md](scale-spec.md); the per-feature how-to is [apps/apple/README.md](../../apps/apple/README.md).

---

## 1. What is built, milestone by milestone

| Milestone (plan §8) | Built | Tested on Linux | Waits on the device |
|---|---|---|---|
| **M0** groundwork, the scale spine, the first playable slice | LupiKit (element table, XYZ, both bond recipes, inertia, personalities, felt mass, the throw estimator, springs, juice director, synthesized sound), LupiScale (records, paths, Magnitude, packs, references, frames, the cut, proxies, breaking; every §12 vector), LupiGame's play session (spawn, grab, throw, pinch through the scale axis, breaks, juice, the cut every frame, the HUD), the app (RealityView with an owned ARSession, LiDAR arena, bodies, merged meshes, instanced atoms and boxes, haptics, spatial sound, sparks, squash, hit-stop), the scale receipt (salt of 10³, 10⁶, 10⁹), spikes A1–A4, S7, S10 | yes | the playable slice and the receipt (§3.2), all spikes |
| **M1** the persistent shelf and the account | keeping, `lupi.trophy.v1` and `lupi.shelf.v1`, shelves as rooms, world-map save and relocalization, the recovery ladder, the Collection, the Lupi account (Sign in with Apple, Firestore sync over REST, deletion), `firestore.rules` | yes (LupiCloud against fakes; rules against the emulator in an earlier lane) | the M1 exit; your Firebase setup ([account-and-sync.md §7](account-and-sync.md)) |
| **M2** build from atoms; fragments you keep | the atom tray, the magnet and valence snaps with the re-perception check, hydrogen fill, "Built it" named from the known molecules, fragments and built molecules kept with their XYZ | yes | the M2 exit |
| **M3a** scale content, RealityKit only | the salt ladder to a googolplex, copper's billion, a carat of diamond, the diamondoids, true masses, flight along the scale axis, Life size, Grow ×2 (off), chunks and chips, monuments and terrain colliders, spikes S8 and S9, the directive's flat-cost tests | yes, including release timings | the M3a exit, S8, S9 |
| **M3b** LupiEngine | not started (spikes S1, S2; `massive_1m`; a pack bucket on lupi.live) | — | — |
| **M4** personalities and polish | personalities brought to `lupi.personality.rules.v1` ([contracts.md §3.3](contracts.md)) with plain-word reasons; four synthesized families tuned per personality (clack chatters, thwap slaps, tink shimmers, boing drops) plus a cage's ring, a flexible molecule's flaps and a brittle one's crackle; a sound lab that retunes the bank on the phone and copies it back; flexible molecules that flop (2–4 segments drawn on one rigid body) and spike A6's jointed copy; cages that shiver and ring; VoiceOver through `AccessibilityComponent` with toss and keep; the thermal policy with spike A5's 30 fps toggle; the first-run camera card | yes | the M4 exit, A5, A6, the sound tuning pass |

What the Linux checks prove: the four packages build and pass their tests with Swift 6.4 (LupiKit 187 tests, LupiScale 155, LupiGame 129, LupiCloud 80), LupiKit, LupiScale and LupiGame also in release, the app's 28 files parse, and the generated Swift is current. They prove nothing about the app compiling or about RealityKit's physics, ARKit tracking, audio or haptics: the session is tested against a stand-in physics world (`LupiGameSim`), not against RealityKit.

---

## 2. Build and run on your Mac

You need Xcode 26 or later (iOS 26 SDK) and XcodeGen. Swift 6.2 or later builds the packages, which stay within tools 6.0.

```bash
brew install xcodegen
cd apps/apple && xcodegen generate && open Lupi.xcodeproj
```

1. Pick the **Lupi** scheme. Signing & Capabilities: team **26Y4SLFJ4M**, automatic signing (set in `project.yml`); if Xcode shows "None", pick the team. Bundle id `live.lupi.app`.
2. Connect the iPhone 15 Pro or the iPad Pro, choose it, press Run. The Simulator has no AR camera.
3. First launch: Home, then any molecule. A card says why Lupi wants the camera; **Continue** lets iOS ask. In Play, move slowly until the coaching overlay goes.
4. The debug HUD: touch and hold the **Lupi** badge at the top of Play.
5. The account is optional. To turn it on, copy `Config/Secrets.example.xcconfig` to `Config/Secrets.xcconfig` with the iOS API key and project id, and do [account-and-sync.md §7](account-and-sync.md#7-owner-checklist). Without it, everything works on the device and Settings says the account is not configured.
6. `Lupi.xcodeproj`, `Lupi/Info.plist` and `Lupi/Lupi.entitlements` are generated and ignored by git. Run `xcodegen generate` again after pulling or adding files.

**When it does not compile,** send the errors back:

```bash
cd apps/apple
xcodebuild -project Lupi.xcodeproj -scheme Lupi -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates build 2>&1 | grep -E 'error:|warning:' | head -100
```

or Xcode's Report navigator (⌘9). Errors inside LupiKit, LupiScale, LupiGame or LupiCloud should not happen (Linux builds and tests them every push); say so if one does. §4 lists where the app's errors are most likely.

The Linux checks, if you want to run them on the Mac too: `swift test` in each of `apps/apple/LupiKit`, `LupiScale`, `LupiGame`, `LupiCloud`; `swift test -c release` in LupiScale and LupiGame; `tools/apple/parse-app.sh`; `pnpm apple:check`.

---

## 3. On the device

Record each result on the iPhone 15 Pro **and** the iPad Pro (which model?). The HUD's lines are the measurements; paste them back as text.

### 3.1 Spikes

| Spike | The question | How (HUD) | Record | It decides |
|---|---|---|---|---|
| **A1** world map under RealityView | Does a saved `ARWorldMap` relocalize when our own ARSession runs under RealityView? | Leave a molecule on a shelf until kept; when `map` reads extending or mapped it saves itself (or **A1 save shelf map**); **A1 relocalize**; **A1 copy log** | the `A1` lines: map size, time to `tracking normal`, frames drawn while relocalizing, root drift; and the real test, force-quit and reopen the next day | whether shelves stay on RealityView or fall back to `ARView` (plan §3.3) |
| **A2** slow-motion clock | Do bodies under a custom `PhysicsSimulationComponent` with a `CMTimebase` clock still collide with the LiDAR mesh? | **A2 custom simulation + clock**, throw at a wall; **A2 quarter speed for 2 s**, throw again | bounce or pass through; slows down and still hits | slow motion on, or hit-stop only, or a mirrored arena (plan §5.4) |
| **A3** tumble | Does RealityKit keep the gyroscopic terms that flip an asymmetric top? | Spawn caffeine, let it rest, select it, **A3 toss the selected body** (five times) | the `A3` line's flips | true tumble from RealityKit, or LupiKit's coast drives it in the air (plan §4.2) |
| **A4** first-contact impulse | Does `CollisionEvents.Began` read the hit's impulse, or only `Updated`? | **A4 log contact impulses**, throw at a wall | the `B` and `U` lines against `m·v` | the 50 ms window stays, or a pre-contact fallback (plan §4.4) |
| **A5** 30 fps without losing tracking | Can the session switch to a 30 fps video format, without reset options, and keep tracking? | **A5 allow 30 fps at critical**, then Thermal **critical** (or a hot phone); or **A5 hold 30 fps / let go** | the `A5` lines: the format, then tracking limited for how long in 5 s; whether shelf trophies stay put; any stutter in the camera picture | whether the thermal policy's 30 fps step is used (scale-spec §9.3); off, it is skipped |
| **A6** flop | Are RealityKit's spherical joints a reliable articulated body, and does it look better than the drawn flop? | Spawn tryptophan, rest, select, **A6 toss the selected molecule beside a jointed copy**; **A6 flexible molecules flop** off for stiff ones | the `A6 joints` line (pin gap mm, widest bend, parts lost); which looks better; any explosion or sinking | the drawn flop stays (default), or flexible bodies become jointed (plan §8 M4) |
| **S7** instanced spheres | What does `MeshInstancesComponent` cost at 5k, 10k and 30k spheres in four colours? | **S7** 5k / 10k / 30k | fps, worst frame, thermal after two minutes | the instanced-atom budgets of scale-spec §9.3 |
| **S8** terrain window rebuilds | How long does rebuilding the camera's window of atom colliders take, as spheres and as a static mesh? | Googolplex, **Fly in**, stand on the plain; **S8 rebuild the camera window every frame**, walk; then **S8 static mesh** | the `S8 app` line's mean and worst in both modes, fps, whether a resting molecule ever drops through | sphere windows or static meshes for terrain (scale-spec §10.1) |
| **S9** colliders at the size extremes | Do 3 cm and 90 cm boxes and hulls land and rest cleanly? | **S9 drop boxes and hulls of 3 and 90 cm**, on a LiDAR floor and on a table | the `S9` lines: landed, rested, sank, jitter, lost | whether the 0.5×–3× dynamic band and monuments hold (plan §3.4) |
| S10 (extra) merged meshes | How long do 1,000- and 2,000-atom merged meshes take? | **S10 time 1k and 2k atom meshes** | geometry off the main actor, resource on it | the one-mesh-a-frame budget |

The **sound lab** is the M4 tuning pass: **Sound lab** in the HUD, each family's pitch and length, played soft and hard 40 cm ahead; **Apply**, then **Copy the tuning as JSON** and send it back.

### 3.2 Exits

Each exit is in the README with its steps; in short:

- **M0, the playable slice:** spawn C₆₀ and caffeine, throw them at a wall, watch them bounce and land on a shelf, stack three, break hydrogen peroxide into two pieces, with sound and (iPhone) haptics; no hitch you can see in 10 minutes.
- **M0, the scale receipt:** salt of 10³, 10⁶ and 10⁹ atoms on the desk and from inside (**Dive in**), held and thrown at the same frame time, exact counts on the HUD.
- **M1:** the receipt still holds; three trophies on a real shelf survive a force-quit and a night (or one tap on **Put the shelf here**); a kept billion-atom crystal comes back the same; sign in on the iPad and the collection is there; delete the account in the app.
- **M2:** build water and ethanol from atoms and keep them; break a molecule and keep a fragment; all reload with the same bonds.
- **M3a:** the googolplex bar thrown into ten cubes; **Fly in** and walk on the plain, toys parked inside the salt; a chunk of 1,000 ions leaving 10^(10^100) − 1,000; **Surface**; the 10³⁰ cube at **Life size** (2.82 m, 48.6 t); copper pinched to a monument, a chunk and a chip; S8 and S9. Plan §8's full M3 exit also asks for a million-atom crystal grown to room size at a steady frame rate for 10 minutes at `fair` or better: copper's billion stands in until M3b's `massive_1m`.
- **M4:** you play for 30 minutes and want to keep going (D4). On the way: four families you can tell apart with your eyes closed, the flop, the crackle and the ring; each plaque's reason; VoiceOver hears the room, a molecule's description, and tosses one; a fresh install shows the camera card before iOS asks; A5 and A6 sent back.

### 3.3 Decisions waiting on you

1. **Grow ×2** (plan §11.9): off in Settings until you confirm it.
2. **A monument around the camera** (walking into the life-size cube) draws nothing today; what should it show?
3. **Life size** is offered for spans from 3 cm to 20 m (so the 3.8 mm carat is refused): keep that range?
4. **Still comfort** (plan §11.6): throws still fly, capped at 1.5 m/s.
5. **The contract's personality numbers** now rule play: hydrogen peroxide breaks at about 0.77 m/s, salt is brittle, tray atoms and C₆₀ are bouncy (restitution 0.85), and C₆₀ chips at 6.5 m/s. The contract's length ratio reads PubChem's O₂ as a single bond, so O₂ is brittle (contracts.md §3.3 now says so): move the double-bond threshold from 0.92, or keep it?

---

## 4. Where the first compile will most likely fail

Every Apple API below is unverified by a compiler. "Docs-checked" means its signature and availability were read from Apple's documentation data (`developer.apple.com/tutorials/data/documentation/...`); the rest come from earlier milestones' research ([research/apple-ar-platform.md §7](research/apple-ar-platform.md#7-capability-table)) or from memory. The project is Swift 6 language mode with complete strict concurrency, so actor-isolation and Sendable diagnostics are errors.

**The likeliest failures, first:**

1. `PlayController.swift`: `sim.clock = tb` assigns a `CMTimebase` to `PhysicsSimulationComponent.clock`, typed `CMClockOrTimebase` (docs-checked). If CoreMedia's Swift types do not upcast, wrap it as the overlay requires.
2. `Sparks.swift`: `e.components[ParticleEmitterComponent.self]?.burst()` calls the mutating `burst()` (docs-checked, iOS 18) through the component set's optional subscript; if it does not write back, read the component, call `burst()`, set it again.
3. `PlayController.swift`: `LocalizedStringResource(stringLiteral: text)` with a runtime `String` for `AccessibilityComponent.label` and `.value` (docs-checked: `init(stringLiteral value: String)`, iOS 16). If the compiler insists on a literal, use `LocalizedStringResource(String.LocalizationValue(text))`.
4. Event handlers from `RealityViewCameraContent.subscribe(to:on:componentType:_:)` (docs-checked) call `@MainActor` methods; they are formed in a `@MainActor` method so they should inherit isolation. If Xcode disagrees, wrap the body in `MainActor.assumeIsolated { … }`.
5. `ARHost.swift`: `SpatialTrackingSession.Configuration(tracking:sceneUnderstanding:camera:)` labels and the `SceneUnderstandingCapability` set; `run(_:session:arConfiguration:)` is docs-checked (iOS 18, async, returns `UnavailableCapabilities?`).
6. `@preconcurrency import ARKit` types crossing into `Task`s (`ShelfHost`'s world-map save, `PixelBox`).

**By file:**

| File | Apple APIs it uses | Checked | Notes |
|---|---|---|---|
| `App/AppModel.swift` | `AVCaptureDevice.authorizationStatus(for:)`, `requestAccess(for:) async`; `UIApplication.openSettingsURLString`, `UIApplication.shared.open(_:options:completionHandler:)`; `@Observable` with an `@ObservationIgnored` closure | docs-checked (M4) | new in M4 |
| `App/LupiApp.swift`, `App/OnboardingView.swift` | `sheet(isPresented:)` with a hand-made `Binding`, `presentationDetents`, `scenePhase`, `fullScreenCover` | SwiftUI | new card in M4 |
| `Account/AccountView.swift`, `Account/AppleSignIn.swift` | `SignInWithAppleButton`, `ASAuthorizationAppleIDRequest`, `ASAuthorizationAppleIDCredential` (`identityToken`, `authorizationCode`), `ASAuthorizationError` | M1 research | |
| `Account/KeychainTokenStore.swift` | `SecItemAdd`, `SecItemCopyMatching`, `SecItemUpdate`, `SecItemDelete`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, `kSecAttrSynchronizable` | memory | CF bridging casts (`as String`, `kCFBooleanFalse`) |
| `Account/CollectionModel.swift`, `Collection/CollectionView.swift` | `@Observable`, `Task`, `swipeActions`, `.task` | SwiftUI | |
| `Debug/DebugPanel.swift`, `Debug/SoundLabView.swift` | SwiftUI `Picker` with enum tags, `Slider`, `Form`, `UIPasteboard` | SwiftUI | sound lab new in M4 |
| `Juice/Haptics.swift` | `CHHapticEngine` (`capabilitiesForHardware`, `start`, `makePlayer(with:)`), `CHHapticEvent(eventType:parameters:relativeTime:duration:)`, `CHHapticEventParameter`, `CHHapticParameterCurve` and its control points, `CHHapticPattern(events:parameterCurves:)`, `start(atTime: CHHapticTimeImmediate)` | plan research | `@preconcurrency import CoreHaptics` |
| `Juice/Sounds.swift` | `AVAudioSession.setCategory(.ambient, mode:options: [.mixWithOthers])`, `AVAudioFormat(standardFormatWithSampleRate:channels:)`, `AVAudioPCMBuffer(pcmFormat:frameCapacity:)`, `floatChannelData`; `AudioBufferResource(buffer:configuration:)`; `Entity.playAudio(_:)`; `AudioPlaybackController.gain`, `.speed` | `AudioBufferResource` (iOS 18, `@MainActor`, throws), `playAudio`, `gain` (decibels), `speed` (0.25–4): docs-checked (M4) | rendering is off the main actor, resources on it |
| `Juice/Sparks.swift` | `ParticleEmitterComponent` (`emitterShape`, `emitterShapeSize`, `speed`, `speedVariation`, `isEmitting`, `burstCount`, `mainEmitter.lifeSpan`, `.size`, `.dampingFactor`, `.color`, `ParticleColor.constant(.random(a:b:))`), `burst()` | `burstCount`, `burst()`: docs-checked | risk 2 above |
| `Play/ARHost.swift` | `SpatialTrackingSession` (`run`, `stop`, `Configuration`), `ARSession` (`run(_:options:)`, `configuration`, `add(anchor:)`, `remove(anchor:)`, `raycast`), `ARWorldTrackingConfiguration` (`planeDetection`, `environmentTexturing`, `sceneReconstruction`, `initialWorldMap`, `videoFormat`, `supportedVideoFormats`, `supportsSceneReconstruction`), `ARConfiguration.VideoFormat` (`framesPerSecond`, `imageResolution`), `ARCamera.projectionMatrix(for:viewportSize:zNear:zFar:)`, `viewMatrix(for:)`, `ARPlaneAnchor` (`planeExtent`, `classification`), `ARRaycastQuery(origin:direction:allowing:alignment:)`, static plane colliders | `run` (no options keeps tracking and anchors), `configuration`, the video-format members: docs-checked (M4); the rest M0 research | the A5 switch is new |
| `Play/Bridging.swift` | `simd_quatf(ix:iy:iz:r:)`, `Transform(scale:rotation:translation:)`, `Transform3x4` | memory | |
| `Play/CoachingOverlay.swift` | `ARCoachingOverlayView` (`session`, `goal`, `activatesAutomatically`, `delegate`), a `nonisolated` delegate method | M0 research | |
| `Play/JointFlopRig.swift` | `PhysicsSphericalJoint(pin0:pin1:angularLimitInYZ:checksForInternalCollisions:)`, `addToSimulation()`, `Entity.pins.set(named:position:orientation:)`, `GeometricPin.position(relativeTo:)`, `PhysicsMassProperties(mass:inertia:)`, `PhysicsMotionComponent(linearVelocity:angularVelocity:)`, `CollisionComponent`, `ShapeResource.generateSphere(radius:)`, `simd_quatf(from:to:)` | all docs-checked (M4, iOS 18) | new in M4; spike only |
| `Play/PlayController.swift` | `RealityViewCameraContent` (`camera = .spatialTracking`, `add`, `subscribe`), `SceneEvents.Update`, `CollisionEvents.Began`/`.Updated` (`entityA`, `entityB`, `impulse`, `impulseDirection`, `position`), `AccessibilityComponent` (`isAccessibilityElement`, `label`, `value`, `systemActions`, `customActions`), `AccessibilityEvents.Activate`/`.CustomAction` (`entity`, `key`), `PhysicsSimulationComponent` (`solverIterations`, `SolverIterations(positionIterations:velocityIterations:)`, `clock`), `CMTimebase(sourceClock:)`, `setRate`, `CMClock.hostTimeClock`, `UIPasteboard` | `camera`, `subscribe`, the accessibility types (iOS 17; `SupportedActions` is an `OptionSet`; `CustomAction` conforms to `Event`), the simulation component and `CMTimebase`: docs-checked | risks 1, 3, 4 above |
| `Play/PlayScene.swift` | `LowLevelInstanceData(instanceCount:instanceCapacity:)`, `instanceCount`, `withMutableTransforms`, `MeshInstancesComponent(mesh:instances:bounds:)` (iOS 26), `BoundingBox`, `ModelComponent`, `ModelEntity(mesh:materials:)`, `GroundingShadowComponent(castsShadow:)`, `PhysicsBodyComponent(massProperties:material:mode:)` and its damping and CCD fields, `PhysicsMassProperties(mass:inertia:centerOfMass:)`, `PhysicsMotionComponent`, `ShapeResource.generateSphere`/`generateBox(size:)`/`generateConvex(from: [SIMD3<Float>])` (`@MainActor`), `offsetBy(translation:)`, `offsetBy(rotation:translation:)`, `applyLinearImpulse`, `applyAngularImpulse` | the instancing types and the shape generators: docs-checked (M4); the rest M0 research | the flop's segment container is new in M4 |
| `Play/PlayView.swift` | `RealityView { content in … }` with an `async` make closure, `persistentSystemOverlays`, `statusBarHidden`, `accessibilityVoiceOverEnabled`, accessibility modifiers on a `UIViewRepresentable` | SwiftUI | |
| `Play/RenderAssets.swift` | `MeshResource.generateSphere`/`generateBox`/`generatePlane(width:depth:)`, `PhysicallyBasedMaterial` (`BaseColor(tint:)`, `Roughness`, `Metallic`, `Clearcoat`, `ClearcoatRoughness` from float literals), `MeshDescriptor`, `MeshBuffers.Positions`/`.Normals`, `.triangles`, `.allFaces`, `MeshResource.generate(from:)`, `PhysicsMaterialResource.generate(staticFriction:dynamicFriction:restitution:)` | plan research | |
| `Play/ShelfHost.swift` | `NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from:)`, `ARSession.currentWorldMap()` (async), `NSKeyedArchiver.archivedData(withRootObject:requiringSecureCoding:)`, `ARFrame.capturedImage`, `CIImage`, `CIContext.jpegRepresentation(of:colorSpace:)` | `jpegRepresentation` docs-checked (M4); world-map APIs M1 research | risk 6 |
| `Play/StressRigs.swift` | `MeshResource.generate(from:)`, instancing as in PlayScene | | |
| `Play/TerrainColliders.swift` | `ShapeResource.generateStaticMesh(positions:faceIndices:)` (async, nonisolated, static bodies only), `CollisionComponent(shapes:)`, `PhysicsBodyComponent(massProperties: .default, material:mode: .static)` | docs-checked (M3a) | |
| `Play/TouchLayer.swift`, `Settings/SettingsView.swift`, `Home/HomeView.swift`, `App/Theme.swift` | UIKit touches, SwiftUI | | |

No new Info.plist keys or entitlements: `NSCameraUsageDescription` was already set, and the first-run card repeats its privacy line word for word.

---

## 5. Not built, or stubbed

- **M3b** (LupiEngine, `massive_1m`, a baked assembly, the pack bucket) and spikes S1, S2 and the optional S6.
- The cache does not evict to aggregates, the thermal policy's last step (scale-spec §9.3).
- The flop is drawn on one rigid body: a swinging arm can pass through the table for a moment. A6 decides whether joints replace it.
- Whether RealityView on iOS turns `AccessibilityComponent` into VoiceOver elements is unconfirmed. The room's one-line summary and the card's **Toss** button work either way.
- Room surfaces are guessed from the impact's direction and height, not the classified LiDAR mesh; the Collection shows colour swatches, not ink drawings; snaps make single bonds only; a monument around the camera draws nothing.
- The contract's ratio rule for bond orders is the personality's alone; fragments and snapping keep LupiKit's own length estimate until `lupi-bond-orders.v1` exists.
