# Native Apple AR platform for Lupi: research report (as of 2026-10-04)

Platform availability comes from Apple's DocC metadata (`developer.apple.com/documentation/...`, read through its JSON endpoint) and from WWDC session pages. Where I couldn't confirm something, it's marked **UNCONFIRMED**.

## 0. Bottom line

1. **iOS/iPadOS 27 has shipped.** It was released on 2026-09-14 ([MacRumors](https://macrumors.com/2026/09/09/apple-announces-ios-27-release-date/)), alongside Xcode 27 with Swift 6.4 ([Xcode 27 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes)). iOS 27 supports every iPhone that iOS 26 supports ([9to5Mac](https://9to5mac.com/2026/06/08/ios-27-here-are-all-the-compatible-iphone-models/), [AppleInsider](https://appleinsider.com/articles/26/06/08/ios-27-keeps-iphone-11-and-newer-compatibility)).
2. **The trophy case has to be built on `ARWorldMap`, which dates from iOS 12.** There is still no automatically persisted world-anchor API on iOS. `WorldAnchor` is visionOS-only ([doc](https://developer.apple.com/documentation/arkit/worldanchor)). `WorldTrackingProvider`/`ARKitSession` cover macOS 26 and visionOS only ([doc](https://developer.apple.com/documentation/arkit/worldtrackingprovider)). Shared world anchors (`SharedCoordinateSpaceProvider`) are visionOS 26 only ([doc](https://developer.apple.com/documentation/arkit/sharedcoordinatespaceprovider)). The June 2026 ARKit changes for iOS add object tracking, `viewLayer`, metadata objects and automatic environment texturing, but no persistence API ([ARKit updates](https://developer.apple.com/documentation/updates/arkit)).
3. **RealityKit on iOS is now a complete game engine.**
   - Physics joints, force effects and local simulations: iOS 18.
   - GPU instancing (`MeshInstancesComponent`), `LowLevelBuffer`, `GestureComponent` and custom post-processing: iOS 26.
   - New in iOS 27: Gaussian splats, `LevelOfDetailComponent`, `OcclusionCullingComponent`, cloth simulation, `ClippingComponent`, `ComputeGraphComponent` (GPU particles), and a whole `LowLevelRenderer`/`LowLevelMaterialResource` family.
4. **The gesture system from visionOS doesn't come to iOS.** `ManipulationComponent` (grab, rotate, swap hands) is visionOS 26 only ([doc](https://developer.apple.com/documentation/realitykit/manipulationcomponent)). On iPhone and iPad, grab, throw and stretch have to be built from `GestureComponent`, entity-targeted SwiftUI gestures and physics velocity.
5. **RealityKit joints have no springs and no break threshold.** "Flexible" and "breakable" have to be custom. The pieces exist: `ForceEffectProtocol` for spring and Morse-like forces, and toggling `PhysicsJoint.isActive` or removing joints from a `System` to break bonds. For 2D sheets such as graphene, iOS 27 cloth is a genuinely flexible body.
6. **A million atoms means a GPU-owned representation, not entities.** The realistic paths are:
   - `LowLevelMesh` or `MeshInstancesComponent`, fed by Metal compute (iOS 18 and 26).
   - A custom Metal pass inside `PostProcessEffect`, which receives color, depth and a command buffer (iOS 26).
   - The iOS 27 `LowLevelRenderer`.
   - Gaussian splats for the far level of detail (iOS 27; unlit, with an undocumented maximum count).
7. **iPad has no haptics.** Apple: "Some devices don't support haptic feedback, including iPad" ([doc](https://developer.apple.com/documentation/corehaptics/preparing-your-app-to-play-haptics)). The iPad demo needs audio and visual feedback instead.
8. **LiDAR is only on iPhone Pro models (12 Pro through 17 Pro) and iPad Pro.** iPad Air and iPad mini don't have it ([iPhone list](https://support.apple.com/en-kg/guide/iphone/aside/iphc07537a89/26/ios/27), [iPad list](https://support.apple.com/en-gb/guide/ipad/aside/ipad8a95fdc0/ipados)). The exact demo devices therefore decide the occlusion and real-surface physics story.
9. **The current EAS image can't build iOS 27 features.** Expo's `sdk-57` image is macOS Tahoe 26.5 with Xcode 26.6 ([Expo docs](https://docs.expo.dev/build-reference/infrastructure/)). On GitHub Actions, Xcode 27 is only on the preview `xcode-27` runner label.

---

## 1. Platform baseline

| Item | Fact | Source |
|---|---|---|
| Xcode 27 | Includes Swift 6.4 and the iOS/iPadOS 27 SDKs. Debugs on-device on iOS 17 and later. Requires macOS Tahoe 26.6 or later. Runs only on Apple silicon Macs. | [Xcode 27 RN](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes) |
| Newer Xcode builds | 27.1 and a 27.2 beta are listed | [Release notes index](https://developer.apple.com/documentation/xcode-release-notes) |
| App Store gate | Since 2026-04-28, uploads must be built with Xcode 26 or later and an iOS 26 SDK. Since 2026-09-09, apps must target iOS 13 or later. | [Upcoming requirements](https://developer.apple.com/news/upcoming-requirements/) |
| Swift 6.4 | `defer` can `await`, `withTaskCancellationShield`, `~Sendable`, `weak let`, `Module::` selectors | [WWDC26 262](https://developer.apple.com/videos/play/wwdc2026/262/), [InfoQ](https://www.infoq.com/news/2026/09/swift-6-4-released/) |
| Swift 6.2 (Xcode 26) | New projects default to MainActor isolation, with "approachable concurrency" on | [Donny Wals](https://www.donnywals.com/setting-default-actor-isolation-in-xcode-26/), [InfoQ](https://www.infoq.com/news/2025/08/swift62-approachable-concurrency) |
| SceneKit | Soft-deprecated and in maintenance mode; Apple says it is "not recommended" for new apps | [WWDC25 288](https://developer.apple.com/videos/play/wwdc2025/288/) |
| iPhone 18 Pro | A20 Pro chip, 7-core GPU, available 2026-09-18. LiDAR is not mentioned in the press release (UNCONFIRMED). | [Apple Newsroom](https://www.apple.com/newsroom/2026/09/apple-debuts-iphone-18-pro-and-iphone-18-pro-max/) |

**Metal GPU families** ([Metal Feature Set Tables, 2026-05-21](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf)):

| Chip | GPU family | Supports |
|---|---|---|
| A14 | Apple7 | Metal 3 and 4 |
| A17 Pro, A18-series, M3, M4 | Apple9 | Metal 3 and 4 |
| A19-series, M5 | Apple10 | Metal 3 and 4 |

Mesh shading needs Apple7 or later. The A20 Pro's family isn't in the table (UNCONFIRMED).

**Likely demo devices:**

| Device | Chip / family | LiDAR |
|---|---|---|
| iPhone 15 Pro | A17 Pro / Apple9 | Yes |
| iPhone 16 | A18 / Apple9 | No |
| iPhone 16 Pro | A18-series / Apple9 | Yes |
| iPhone 17 / Air | A19-series / Apple10 | No |
| iPhone 17 Pro | A19-series / Apple10 | Yes |
| iPhone 18 Pro | A20 Pro / ? | UNCONFIRMED |
| iPad Pro M4 / M5 | Apple9 / Apple10 | Yes |
| iPad Air (M-series), iPad mini (A17 Pro) | — | No |

LiDAR sources: [iPhone](https://support.apple.com/en-kg/guide/iphone/aside/iphc07537a89/26/ios/27), [iPad](https://support.apple.com/en-gb/guide/ipad/aside/ipad8a95fdc0/ipados).

**Recommended deployment target:** iOS/iPadOS 26.0, with iOS 27 features behind `if #available(iOS 27, *)`.
- iOS 26 is the floor for instancing, `LowLevelBuffer`, `GestureComponent`, `PostProcessEffect`, `ARKitAnchorComponent` and `Entity.Observable`.
- If the app is only for the owner's own devices, set iOS 27 and skip the gating.
- If the structures are large, add the `com.apple.developer.kernel.increased-memory-limit` entitlement (iOS 15) and budget with `os_proc_available_memory` ([doc](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit)).

---

## 2. Persistence across launches and days (the trophy case)

### 2.1 How `ARWorldMap` works (iOS 12 and later)

- **Saving.** `ARSession.getCurrentWorldMap(completionHandler:)` or the async `currentWorldMap()` returns the map. It conforms to `NSSecureCoding`, so you archive it with `NSKeyedArchiver` and restore it through `ARWorldTrackingConfiguration.initialWorldMap` ([ARWorldMap](https://developer.apple.com/documentation/arkit/arworldmap), [getCurrentWorldMap](https://developer.apple.com/documentation/arkit/arsession/getcurrentworldmap(completionhandler:))).
- **Relocalizing.** A session started from a map begins in `limited(.relocalizing)`. If ARKit "cannot reconcile the recorded world map with the current environment… the session remains in the relocalizing state indefinitely" ([initialWorldMap](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/initialworldmap)).
- **When to save.** Gate saving on `ARFrame.WorldMappingStatus` being `.extending` or `.mapped` (`.notAvailable` and `.limited` are the other states). Apple says this ensures "you can reliably make use of the saved map on a different device or at a later time" ([getCurrentWorldMap](https://developer.apple.com/documentation/arkit/arsession/getcurrentworldmap(completionhandler:))).
- **Restoring content.** Saved anchors come back after relocalization. Apple's sample identifies its content by `ARAnchor.name`, and suggests custom `ARAnchor` subclasses to carry game state ([Saving and loading world data](https://developer.apple.com/documentation/arkit/saving-and-loading-world-data)).
- **Helping the user relocalize.** The sample stores a camera snapshot inside the map and shows it while relocalizing. Relocalization "is more likely to succeed if the user moves to areas… visited during the previous session" ([same sample](https://developer.apple.com/documentation/arkit/saving-and-loading-world-data)).
- **Capture practice from Apple.** "scan your physical space from multiple point of views", keep "the environment… static and well textured", aim for "dense feature points" ([WWDC18 602 transcript](https://nonstrict.eu/wwdcindex/wwdc2018/602/); [session page](https://developer.apple.com/videos/play/wwdc2018/602/)).
- **After an interruption.** Use `sessionShouldAttemptRelocalization(_:)` (iOS 11.3). Returning `true` makes you responsible for offering a reset ([doc](https://developer.apple.com/documentation/arkit/arsessionobserver/sessionshouldattemptrelocalization(_:))). `ARCoachingOverlayView` (iOS 13) shows relocalization coaching automatically ([doc](https://developer.apple.com/documentation/arkit/arcoachingoverlayview)).

**Failure modes and size, as reported by the community rather than Apple:**
- Maps work at about 100 m². At about 200 m² there is "massive deletion of feature points", especially in the area scanned first ([forum 723947](https://developer.apple.com/forums/thread/723947)).
- A map of about 58 MB triggers `exceedSceneSizeLimit` in multi-room RoomPlan scans on iPhone 15 Pro Max and iPhone 17 Pro, but not on an M4 iPad (Oct 2025, no Apple reply) ([forum 804371](https://developer.apple.com/forums/thread/804371)).
- In iOS 15.0–15.1 the world origin wasn't restored after relocalization; it was fixed in 15.2. The workaround is `setWorldOrigin(relativeTransform:)` from a saved anchor ([forum 690668](https://developer.apple.com/forums/thread/690668)).
- `ARError.Code.invalidWorldMap` exists for maps that can't be processed ([doc](https://developer.apple.com/documentation/arkit/arerror/code/invalidworldmap)).
- **UNCONFIRMED:** how long a map stays valid (Apple publishes no expiry), whether archived maps survive iOS major updates, and whether maps interchange cleanly between LiDAR and non-LiDAR devices.

**Privacy:**
- The documented public contents are `anchors`, `rawFeaturePoints` ("a coarse representation of the space-mapping data"), `center` and `extent` ([rawFeaturePoints](https://developer.apple.com/documentation/arkit/arworldmap/rawfeaturepoints)).
- The internal mapping data is opaque. Whether it contains image descriptors is **UNCONFIRMED**.
- If you copy Apple's snapshot-anchor pattern, the map then contains a photo of the user's room.
- Data processed only on the device is not "collected" for App Privacy labels; anything sent off-device must be considered separately ([App privacy details](https://developer.apple.com/app-store/app-privacy-details/)).
- Treat any iCloud-synced map as sensitive home-interior data.

### 2.2 Getting a world map into RealityKit

There are two paths. Path B is the modern one but needs a spike to prove it.

**Path A: `ARView` (UIKit, iOS 13, not deprecated).**
- `ARView.session` gives direct `ARSession` access ([doc](https://developer.apple.com/documentation/realitykit/arview/session)).
- `AnchoringComponent.Target.anchor(identifier:)` binds an entity to an `ARAnchor` (iOS 13) ([doc](https://developer.apple.com/documentation/realitykit/anchoringcomponent/target-swift.enum/anchor(identifier:))).

**Path B: SwiftUI `RealityView` with `SpatialTrackingSession.run(_:session:arConfiguration:)` (iOS 18).**
- In this mode "You manage and run the ARSession", so `initialWorldMap` and `getCurrentWorldMap` stay available ([doc](https://developer.apple.com/documentation/realitykit/spatialtrackingsession/run(_:session:arconfiguration:))).
- iOS 26 adds `ARKitAnchorComponent.arAnchor`, which exposes the backing ARKit anchor ([doc](https://developer.apple.com/documentation/realitykit/arkitanchorcomponent)), and `AnchorStateEvents` (`DidAnchor`, `DidFailToAnchor`, `WillUnanchor`) ([doc](https://developer.apple.com/documentation/realitykit/anchorstateevents)).
- In Feb 2025 one developer reported this `run` overload missing and `ARSession` delegate callbacks stopping under RealityView. Apple DTS replied the function "is there for me in Xcode 16.2" ([forum 773741](https://developer.apple.com/forums/thread/773741)).
- **UNCONFIRMED** that `initialWorldMap` relocalization re-binds `AnchorEntity`s in RealityView. Spike this first.

### 2.3 Sensing the shelf

- **Plane classification** (iOS 12) includes `.table` ("table, desk, bar") and `.seat`; vertical planes are supported from iOS 11.3 ([doc](https://developer.apple.com/documentation/arkit/arplaneanchor/classification-swift.enum)).
- **With LiDAR:**
  - Scene reconstruction (`ARMeshAnchor`, `ARMeshClassification`, iOS 13.4) ([doc](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/scenereconstruction)).
  - `sceneDepth` (iOS 14), "captured by the LiDAR scanner" ([doc](https://developer.apple.com/documentation/arkit/arframe/scenedepth)).
  - Instant plane detection, plus occlusion and physics against real geometry ([ARKit 3.5 coverage](https://appleinsider.com/articles/20/03/24/apple-launches-arkit-35-with-new-ipad-pro-lidar-features)).
- **RoomPlan** (iOS 16) has an object category `.storage` ([doc](https://developer.apple.com/documentation/roomplan/capturedroom/object/category-swift.enum/storage)), which could detect shelving units. Check `RoomCaptureSession.isSupported` ([doc](https://developer.apple.com/documentation/roomplan/roomcapturesession/issupported)).
- **iOS 27 object tracking:** `ARWorldTrackingConfiguration.trackingObjects` gives high-frame-rate tracking of Create ML reference objects, the same files used on visionOS ([doc](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/trackingobjects), [WWDC26 283](https://developer.apple.com/videos/play/wwdc2026/283/)). A physical trophy plinth could serve as a re-anchoring beacon.

### 2.4 Sharing between iPhone and iPad

- **Host-guest map sharing (iOS 12):** archive the map and send it over MultipeerConnectivity ([ARWorldMap § Share](https://developer.apple.com/documentation/arkit/arworldmap), [Creating a multiuser AR experience](https://developer.apple.com/documentation/arkit/creating-a-multiuser-ar-experience)).
- **Peer-to-peer collaboration (iOS 13):** `isCollaborationEnabled`, `ARSession.CollaborationData`, `ARParticipantAnchor` and `update(with:)` ([Creating a collaborative session](https://developer.apple.com/documentation/arkit/creating-a-collaborative-session)). RealityKit's `SynchronizationComponent` and `MultipeerConnectivityService` (iOS 13) sync entities ([doc](https://developer.apple.com/documentation/realitykit/multipeerconnectivityservice)).
- **Per-user storage:**
  - SwiftData `@Attribute(.externalStorage)` (iOS 17) for map blobs ([doc](https://developer.apple.com/documentation/swiftdata/schema/attribute/option/externalstorage)).
  - SwiftData's CloudKit sync ([doc](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices)).
  - `CKAsset` for large files ([doc](https://developer.apple.com/documentation/cloudkit/ckasset)).
  - `Entity.write(to:)` (iOS 18) exports an entity as a `.reality` file ([doc](https://developer.apple.com/documentation/realitykit/entity/write(to:))).

---

## 3. RealityKit for interactive play (iOS)

### ECS and per-frame logic
- `System.update(context:)`, `SceneUpdateContext`, `SystemDependency` and `EntityQuery` (iOS 15) ([System](https://developer.apple.com/documentation/realitykit/system)).
- `Entity.Observable` (iOS 26) syncs with SwiftUI ([doc](https://developer.apple.com/documentation/realitykit/entity/observable-swift.struct)).
- `LowLevelMesh` is declared `@MainActor` ([doc](https://developer.apple.com/documentation/realitykit/lowlevelmesh)).

### Rigid bodies
- `PhysicsBodyComponent`, `PhysicsMotionComponent`, `CollisionComponent`, `ShapeResource` and `PhysicsMaterialResource` (iOS 13).
- Continuous collision detection: `isContinuousCollisionDetectionEnabled` (iOS 13).
- `linearDamping`/`angularDamping` (iOS 18).
- `ShapeResource.generateStaticMesh(from:)` (iOS 18) is for static colliders only.
- Non-uniform scale works only on box, convex and mesh shapes ([PhysicsBodyComponent](https://developer.apple.com/documentation/realitykit/physicsbodycomponent)).

### Joints (iOS 18)
- Types: `PhysicsFixedJoint`, `PhysicsRevoluteJoint`, `PhysicsSphericalJoint`, `PhysicsPrismaticJoint`, `PhysicsDistanceJoint` (with `distanceLimit` and `tolerance`) and `PhysicsCustomJoint` (per-axis `.fixed`, `.range` or `.unlimited`), all stored in `PhysicsJointsComponent` ([PhysicsJoint](https://developer.apple.com/documentation/realitykit/physicsjoint), [sample](https://developer.apple.com/documentation/realitykit/simulating-physics-joints-in-your-realitykit-app)).
- The documented joint properties are only `pin0`, `pin1`, `isActive` and `checksForInternalCollisions`. There is no spring, drive or break force.
- Apple's advice: give jointed bodies similar masses, use the heavier one as `pin0`, and tune `solverIterations`.

### Local simulations
- `PhysicsSimulationComponent` (iOS 18) exposes `gravity`, `solverIterations` and `clock`, with units in meters ([doc](https://developer.apple.com/documentation/realitykit/physicssimulationcomponent)).
- `AnchoringComponent.physicsSimulation` (iOS 18).

### Force effects (iOS 18)
- Built-in effects: `ConstantRadialForceEffect`, `VortexForceEffect`, `DragForceEffect`, `TurbulenceForceEffect`.
- Custom effects use `ForceEffectProtocol`. Each step receives positions, velocities, masses, orientations, inertia tensors and distances, and can call `setForce` or `setTorque`.
- `ForceMode` can be `.force`, `.acceleration`, `.impulse` or `.velocity` ([ForceEffectProtocol](https://developer.apple.com/documentation/realitykit/forceeffectprotocol), [WWDC24 10103](https://developer.apple.com/videos/play/wwdc2024/10103/)).
- This is the documented hook for spring-like or Morse-like bond forces.

### Cloth (iOS/iPadOS 27 and visionOS 27, not macOS)
- `ClothSimulationComponent`, `ClothBodyComponent` and `ClothBodyMaterial` (`springStiffness`, `bendStiffness`, damping, friction).
- `ClothGrabComponent` grabs particles with a ray or a volume, with optional falloff.
- Vertices can be made kinematic. Apple recommends thermal-state back-off.
- No tearing API is documented.
- Sources: [ClothSimulationComponent](https://developer.apple.com/documentation/realitykit/clothsimulationcomponent), [ClothGrabComponent](https://developer.apple.com/documentation/realitykit/clothgrabcomponent), [WWDC26 279](https://developer.apple.com/videos/play/wwdc2026/279/).

### Real-surface physics
- `SpatialTrackingSession.Configuration.SceneUnderstandingCapability` offers `.collision`, `.physics`, `.occlusion` and `.shadow`: iOS 18 and visionOS 26 ([doc](https://developer.apple.com/documentation/realitykit/spatialtrackingsession/configuration/sceneunderstandingcapability)).
- On iOS the default session already enables `[.occlusion, .shadow, .collision, .physics]` ([SpatialTrackingSession](https://developer.apple.com/documentation/realitykit/spatialtrackingsession)).
- The `ARView` equivalent is `Environment.SceneUnderstanding.Options` (iOS 13.4) ([doc](https://developer.apple.com/documentation/realitykit/arview/environment-swift.struct/sceneunderstanding-swift.struct/options-swift.struct)).
- In practice these depend on the LiDAR mesh.

### Gestures and throwing
- `ManipulationComponent`: **visionOS 26 only**.
- `GestureComponent` (iOS 26) attaches a SwiftUI gesture to an entity ([doc](https://developer.apple.com/documentation/realitykit/gesturecomponent)).
- `Gesture.targetedToEntity(_:)` / `targetedToAnyEntity()` and `EntityTargetValue` (iOS 18) ([doc](https://developer.apple.com/documentation/swiftui/gesture/targetedtoentity(_:))). These need `InputTargetComponent` plus a `CollisionComponent` for hit shapes ([doc](https://developer.apple.com/documentation/realitykit/inputtargetcomponent)).
- `MagnifyGesture` (iOS 17) and `SpatialEventGesture` (iOS 18, multi-touch) are available. `RotateGesture3D` is visionOS-only.
- `ARView.installGestures` (iOS 13) only does translate, rotate and scale ([doc](https://developer.apple.com/documentation/realitykit/arview/installgestures(_:for:))).
- `RealityCoordinateSpaceProjecting` (iOS 18) provides `hitTest`, `ray(through:in:to:)`, `unproject` and `project` ([doc](https://developer.apple.com/documentation/realitykit/realitycoordinatespaceprojecting)).
- To throw:
  1. Read `DragGesture.Value.velocity` ([doc](https://developer.apple.com/documentation/swiftui/draggesture/value/velocity)).
  2. Hold the molecule with `PhysicsBodyMode.kinematic` during the drag.
  3. On release, switch to dynamic and set `PhysicsMotionComponent.linearVelocity` or call `applyLinearImpulse` (iOS 13) ([doc](https://developer.apple.com/documentation/realitykit/hasphysicsbody/applylinearimpulse(_:relativeto:))).

### Haptics and audio
- Core Haptics (`CHHapticEngine`, iOS 13). Check `supportsHaptics`, which is false on iPad ([doc](https://developer.apple.com/documentation/corehaptics/preparing-your-app-to-play-haptics)). Apple has a sample, [Playing Collision-Based Haptic Patterns](https://developer.apple.com/documentation/corehaptics/playing-collision-based-haptic-patterns).
- Audio:
  - `SpatialAudioComponent` (iOS 18) ([doc](https://developer.apple.com/documentation/realitykit/spatialaudiocomponent)).
  - `AudioGeneratorController` (iOS 18) for real-time synthesis, which could sonify bond vibration.
  - `PHASEEngine` (iOS 15).
  - The new reverb-mesh audio "can only truly be experienced on an Apple Vision Pro" ([WWDC26 279](https://developer.apple.com/videos/play/wwdc2026/279/)).

---

## 4. Rendering at scale

### RealityKit building blocks

- **`LowLevelMesh` (iOS 18).** Your own vertex layout, up to 4 buffers and 8 UV channels. Can be updated on the CPU, or on the GPU via `replace(bufferIndex:using:)`, which returns an `MTLBuffer` for a compute kernel ([doc](https://developer.apple.com/documentation/realitykit/lowlevelmesh), [WWDC24 10104](https://developer.apple.com/videos/play/wwdc2024/10104/)). `LowLevelTexture` (iOS 18) does the same for textures.
- **`MeshInstancesComponent` with `LowLevelInstanceData` (iOS 26).**
  - One mesh is drawn N times, with `float4x4` per-instance transforms.
  - `replace(using:)` hands over the transform buffer for GPU writes; "RealityKit will wait for the MTLCommandBuffer to complete" ([doc](https://developer.apple.com/documentation/realitykit/meshinstancescomponent), [doc](https://developer.apple.com/documentation/realitykit/lowlevelinstancedata/replace(using:))).
  - Apple: "On iOS, iPadOS, macOS, and tvOS you can use a LowLevelBuffer to pass render data to your CustomMaterial to make each mesh instance look unique" ([WWDC25 287](https://developer.apple.com/videos/play/wwdc2025/287/)). The mechanism is `CustomMaterial.ResourceStorage.subscript(buffer:)` (iOS 26).
  - **UNCONFIRMED:** an instance index readable in the shader. A Jan 2026 forum question on per-instance colors is unanswered ([forum 814211](https://developer.apple.com/forums/thread/814211)).
- **`CustomMaterial` (iOS 15; not visionOS).**
  - Surface shaders can `discard_fragment()`, and geometry modifiers can read the vertex ID ([WWDC21 10075](https://developer.apple.com/videos/play/wwdc2021/10075/), [Shader API PDF](https://developer.apple.com/metal/Metal-RealityKit-APIs.pdf)).
  - `withMutableUniforms(ofType:stage:)` (iOS 18) supports argument buffers.
  - No fragment-depth output appears in the documented shader API (UNCONFIRMED for 26/27). True ray-cast sphere impostors with correct depth, like the web viewer's, therefore aren't directly expressible. Use real low-poly spheres near the camera and billboards far away.
- **`PostProcessEffect` / `PostProcessEffectContext` (iOS 26).**
  - Provides `commandBuffer`, `device`, `projection`, `sourceColorTexture`, `sourceDepthTexture` and `targetColorTexture` ([doc](https://developer.apple.com/documentation/realitykit/postprocesseffectcontext)). `ARView.renderCallbacks` has had the same since iOS 15.
  - For `ARView`, the depth buffer includes "approximated meshes for real-world objects" when scene understanding is on ([WWDC21 10075](https://developer.apple.com/videos/play/wwdc2021/10075/)). That allows a custom Metal impostor or compute rasterizer pass, depth-tested against RealityKit's depth, which keeps the web-style impostors.
  - Whether RealityView's depth includes the scene mesh is UNCONFIRMED.
- **`RealityRenderer` (iOS 18)** renders a RealityKit scene inside your own Metal workflow ([doc](https://developer.apple.com/documentation/realitykit/realityrenderer)).
- **New in iOS 27:**
  - `LowLevelRenderer`: encodes draws into your command buffer, manages camera constants and instance transforms, and handles culling, sorting and tonemapping.
  - `LowLevelRenderContext`, `LowLevelMaterialResource` (geometry modifier, surface shader and lighting function), `LowLevelMeshInstance(Array)`, `LowLevelInstanceTransformResource` ([LowLevelRenderer](https://developer.apple.com/documentation/realitykit/lowlevelrenderer), [LowLevelMaterialResource](https://developer.apple.com/documentation/realitykit/lowlevelmaterialresource)).
  - No WWDC26 session found covering it. How it composes with RealityView or the AR camera is UNCONFIRMED.
- **More iOS 27 additions:**
  - `GaussianSplatComponent`/`GaussianSplatResource`: unlit ("Scene lighting doesn't affect a Gaussian splat asset"), needs the Apple7 GPU family, has an "internal limit on the total number of splats" (undocumented value), and `LowLevelBuffer` updates animate splats ([doc](https://developer.apple.com/documentation/realitykit/gaussiansplatcomponent)).
  - `LevelOfDetailComponent` (`addByCameraDistance` / `addByScreenArea`) and `OcclusionCullingComponent` ([WWDC26 279](https://developer.apple.com/videos/play/wwdc2026/279/), [doc](https://developer.apple.com/documentation/realitykit/occlusioncullingcomponent)).
  - `ComputeGraphComponent` for GPU particle simulation ([doc](https://developer.apple.com/documentation/realitykit/computegraphcomponent)).
  - `ClippingComponent`, a feathered clip box that suits a display case ([doc](https://developer.apple.com/documentation/realitykit/clippingcomponent)).
  - `BloomComponent` and `ToneMappingComponent`.

### Raw ARKit with your own Metal renderer (`MTKView`)

This gives full control: depth-writing impostors, mesh shaders on Apple7+ ([feature tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf)), Metal 4 (`MTL4CommandQueue`, iOS 26), and MetalFX temporal upscaling (iOS 16) and frame interpolation (iOS 26).

You then reimplement yourself everything RealityKit provides:
- Camera compositing ([Displaying an AR Experience with Metal](https://developer.apple.com/documentation/arkit/displaying-an-ar-experience-with-metal)).
- People occlusion via `ARMatteGenerator` (iOS 13) ([sample](https://developer.apple.com/documentation/arkit/effecting-people-occlusion-in-custom-renderers)).
- LiDAR occlusion from `sceneDepth`.
- Lighting from `ARLightEstimate` and `AREnvironmentProbeAnchor.environmentTexture` (iOS 12).
- Physics, audio, gestures and the ECS.

Given that `PostProcessEffect` and iOS 27's `LowLevelRenderer` exist, a hybrid (RealityKit for the world, physics and shelf, plus a custom Metal pass for big structures) looks lower-risk than going fully raw. This is a recommendation, not a sourced fact.

### Million-atom references
- cellVIEW renders up to about 15 billion atoms at 60 Hz with LOD and GPU instancing in Unity on desktop ([Le Muzic et al., VCBM 2015](https://www.cg.tuwien.ac.at/research/publications/2015/cellVIEW_2015/)).
- Falk, Krone and Ertl render billions of atoms with ray-casted instancing ([CGF 2013](https://diglib.eg.org/handle/10.1111/v32i8pp195-206)).

My own arithmetic, unsourced: at 16 B per atom, a million atoms is about 16 MB of positions and attributes. Billboards are about 4 M vertices, versus about 80 M triangles for 80-triangle spheres. That points to clustered LOD and sub-pixel culling plus GPU-written buffers, and to per-molecule (not per-atom) physics bodies at that scale.

### Interactive molecular dynamics precedent
Multi-user VR iMD with cloud-hosted physics: [O'Connor et al., Sci. Adv. 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6025904).

---

## 5. SwiftUI with RealityView, and app architecture

- **RealityView on iOS** (`init(make:update:placeholder:)`, iOS 18). The `make` closure is `@MainActor @Sendable async` ([doc](https://developer.apple.com/documentation/realitykit/realityview/init(make:update:placeholder:))).
- **Camera modes.** `RealityViewCamera` currently lists `.spatialTracking` and `.virtual` ([doc](https://developer.apple.com/documentation/realitykit/realityviewcamera)). WWDC24 showed `.worldTracking` ([WWDC24 10103](https://developer.apple.com/videos/play/wwdc2024/10103/)), so use the shipped name.
- **Starting point.** Apple's SceneKit-to-RealityKit sample targets iOS 26 ([doc](https://developer.apple.com/documentation/realitykit/bringing-your-scenekit-projects-to-realitykit)). Apple's samples to start from are [Creating a Spaceship game](https://developer.apple.com/documentation/realitykit/creating-a-spaceship-game) (iOS 18) and the joints sample above.
- **Thermal throttling.** Apple's guidance is to watch `ProcessInfo.thermalState` and lower LOD or shadow quality as it rises ([WWDC26 279](https://developer.apple.com/videos/play/wwdc2026/279/)).
- **Current mobile app (repo facts).**
  - `apps/mobile` is Expo SDK 57 / React Native 0.86.2, using `@reactvision/react-viro` 2.57.5.
  - `ios.deploymentTarget` is 17.6, and `supportsTablet` is `false`, so the iPad demo needs that flipped.
  - EAS builds use `image: sdk-57`, which is Xcode 26.6 ([Expo infrastructure](https://docs.expo.dev/build-reference/infrastructure/); Xcode 27 images exist there for SDK 58).

---

## 6. Tooling

- **Reality Composer Pro 3.** Now a standalone download: "no longer available as an Xcode developer tool" ([WWDC26 280](https://developer.apple.com/videos/play/wwdc2026/280/)).
  - Features: Shader Graph, Animation Graph, Compute Graph, Behavior Trees and Script Graph ([WWDC26 393](https://developer.apple.com/videos/play/wwdc2026/393/)), and Xcode-built plugins for custom components and systems ([WWDC26 281](https://developer.apple.com/videos/play/wwdc2026/281/)).
  - Live Preview targets Vision Pro only (ships "later this year"). No iPhone or iPad preview was mentioned.
- **GitHub Actions** ([runner-images README](https://github.com/actions/runner-images/blob/main/README.md)):
  - `macos-latest` / `macos-26` (arm64): macOS 26.6.2, default Xcode 26.6, with 26.0.1–26.6 installed and iOS 26.0–26.5 SDKs ([readme](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)).
  - `xcode-27` / `xcode-27-xlarge` (preview): macOS 27.0, Xcode 27.0 default plus 27.1 and a 27.2 beta, iOS 27.0–27.2 SDKs ([readme](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md)). The preview announcement warns of possible queueing ([issue 14404](https://github.com/actions/runner-images/issues/14404)).
  - macOS 14 images are being retired by November 2.
  - The repo's CI is currently Ubuntu-only.
- **Xcode Cloud.**
  - 25 compute hours a month are included with membership. Paid tiers: 100 hours for $49.99, 250 for $99.99, 1,000 for $399.99, 10,000 for $3,999.99 ([Xcode Cloud](https://developer.apple.com/xcode-cloud/)).
  - WWDC26 adds TestFlight setup from inside Xcode, webhooks and multiple repositories ([WWDC26 261](https://developer.apple.com/videos/play/wwdc2026/261/)).
- **Xcode 27 Instruments** adds a Swift Executors instrument and task tracks; the Metal HUD and capture gain MetalFX options ([RN](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes)).

---

## 7. Capability table

| Feature | API | Min iOS/iPadOS | Notes | URL |
|---|---|---|---|---|
| Save/restore world map | `ARWorldMap`, `getCurrentWorldMap`/`currentWorldMap()`, `initialWorldMap` | 12.0 | NSSecureCoding; can stay in relocalizing forever | https://developer.apple.com/documentation/arkit/arworldmap |
| Map readiness | `ARFrame.WorldMappingStatus` | 12.0 | Save when `.extending` or `.mapped` | https://developer.apple.com/documentation/arkit/arframe/worldmappingstatus-swift.enum |
| Relocalization control | `sessionShouldAttemptRelocalization(_:)`, `.relocalizing` | 11.3 | You must offer a reset | https://developer.apple.com/documentation/arkit/arsessionobserver/sessionshouldattemptrelocalization(_:) |
| Coaching UI | `ARCoachingOverlayView` | 13.0 | Auto relocalization coaching | https://developer.apple.com/documentation/arkit/arcoachingoverlayview |
| Bad map error | `ARError.Code.invalidWorldMap` | 12.0 | | https://developer.apple.com/documentation/arkit/arerror/code/invalidworldmap |
| Auto-persisted world anchors | `WorldAnchor`/`WorldTrackingProvider` | Not on iOS | visionOS 1.0; provider also macOS 26 | https://developer.apple.com/documentation/arkit/worldanchor |
| Shared coordinate space | `SharedCoordinateSpaceProvider` | Not on iOS | visionOS 26 | https://developer.apple.com/documentation/arkit/sharedcoordinatespaceprovider |
| Entity bound to ARAnchor | `AnchoringComponent.Target.anchor(identifier:)` | 13.0 | | https://developer.apple.com/documentation/realitykit/anchoringcomponent/target-swift.enum/anchor(identifier:) |
| RealityView with your ARSession | `SpatialTrackingSession.run(_:session:arConfiguration:)` | 18.0 | Spike with world maps | https://developer.apple.com/documentation/realitykit/spatialtrackingsession/run(_:session:arconfiguration:) |
| Backing ARAnchor | `ARKitAnchorComponent.arAnchor` | 26.0 | | https://developer.apple.com/documentation/realitykit/arkitanchorcomponent |
| Anchor lifecycle | `AnchorStateEvents` | 26.0 | Needs SpatialTrackingSession | https://developer.apple.com/documentation/realitykit/anchorstateevents |
| Scene mesh | `sceneReconstruction`, `ARMeshAnchor` | 13.4 | LiDAR | https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/scenereconstruction |
| Scene depth | `ARFrame.sceneDepth` | 14.0 | LiDAR | https://developer.apple.com/documentation/arkit/arframe/scenedepth |
| Surface types | `ARPlaneAnchor.Classification` | 12.0 | `.table`, `.seat`, … | https://developer.apple.com/documentation/arkit/arplaneanchor/classification-swift.enum |
| Shelving detection | RoomPlan `Category.storage` | 16.0 | Check `isSupported` | https://developer.apple.com/documentation/roomplan/capturedroom/object/category-swift.enum/storage |
| Object tracking | `ARWorldTrackingConfiguration.trackingObjects` | 27.0 | Create ML reference objects | https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/trackingobjects |
| Multi-device | `isCollaborationEnabled`, `CollaborationData`, `ARParticipantAnchor` | 13.0 | Peer-to-peer | https://developer.apple.com/documentation/arkit/creating-a-collaborative-session |
| Entity sync | `SynchronizationComponent`, `MultipeerConnectivityService` | 13.0 | | https://developer.apple.com/documentation/realitykit/multipeerconnectivityservice |
| SwiftUI 3D view | `RealityView`, `RealityViewCamera.spatialTracking` | 18.0 | | https://developer.apple.com/documentation/realitykit/realityviewcamera |
| Tracking config | `SpatialTrackingSession` (+ scene understanding) | 18.0 | `.collision`/`.physics` on iOS | https://developer.apple.com/documentation/realitykit/spatialtrackingsession |
| ECS | `System`, `SceneUpdateContext`, `EntityQuery` | 15.0 | | https://developer.apple.com/documentation/realitykit/system |
| Rigid bodies | `PhysicsBodyComponent`, `PhysicsMotionComponent`, `CollisionComponent` | 13.0 | CCD flag 13.0; damping 18.0 | https://developer.apple.com/documentation/realitykit/physicsbodycomponent |
| Joints | Fixed/Revolute/Spherical/Prismatic/Distance/Custom + `PhysicsJointsComponent` | 18.0 | No spring/break props | https://developer.apple.com/documentation/realitykit/physicsjoint |
| Local physics space | `PhysicsSimulationComponent` | 18.0 | gravity, solverIterations | https://developer.apple.com/documentation/realitykit/physicssimulationcomponent |
| Force fields | `ForceEffectComponent` + 4 built-ins | 18.0 | | https://developer.apple.com/documentation/realitykit/forceeffectcomponent |
| Custom forces | `ForceEffectProtocol`, `ForceEffectParameters` | 18.0 | Hook for bond springs | https://developer.apple.com/documentation/realitykit/forceeffectprotocol |
| Cloth | `ClothSimulationComponent`, `ClothBodyComponent`, `ClothGrabComponent` | 27.0 | Not macOS | https://developer.apple.com/documentation/realitykit/clothsimulationcomponent |
| 6DOF manipulation | `ManipulationComponent` | Not on iOS | visionOS 26 | https://developer.apple.com/documentation/realitykit/manipulationcomponent |
| Entity gestures | `GestureComponent` | 26.0 | | https://developer.apple.com/documentation/realitykit/gesturecomponent |
| Targeted gestures | `targetedToEntity`, `EntityTargetValue`, `InputTargetComponent` | 18.0 | | https://developer.apple.com/documentation/swiftui/gesture/targetedtoentity(_:) |
| Screen↔world | `RealityCoordinateSpaceProjecting` | 18.0 | hitTest, ray, unproject | https://developer.apple.com/documentation/realitykit/realitycoordinatespaceprojecting |
| Throw | `applyLinearImpulse`, `linearVelocity` | 13.0 | | https://developer.apple.com/documentation/realitykit/hasphysicsbody/applylinearimpulse(_:relativeto:) |
| Haptics | `CHHapticEngine` | 13.0 | Not on iPad | https://developer.apple.com/documentation/corehaptics/preparing-your-app-to-play-haptics |
| Spatial audio | `SpatialAudioComponent`, `AudioGeneratorController` | 18.0 | | https://developer.apple.com/documentation/realitykit/spatialaudiocomponent |
| Custom mesh | `LowLevelMesh` (+GPU `replace`) | 18.0 | | https://developer.apple.com/documentation/realitykit/lowlevelmesh |
| Custom texture | `LowLevelTexture` | 18.0 | | https://developer.apple.com/documentation/realitykit/lowleveltexture |
| Instancing | `MeshInstancesComponent`, `LowLevelInstanceData` | 26.0 | GPU-writable transforms | https://developer.apple.com/documentation/realitykit/meshinstancescomponent |
| Buffer to material | `LowLevelBuffer`, `ResourceStorage[buffer:]` | 26.0 | iOS, not visionOS | https://developer.apple.com/documentation/realitykit/custommaterial/resourcestorage |
| Custom shaders | `CustomMaterial` | 15.0 | discard yes, depth out not documented | https://developer.apple.com/documentation/realitykit/custommaterial |
| Post pass | `PostProcessEffect`/`PostProcessEffectContext` | 26.0 | color + depth + cmd buffer | https://developer.apple.com/documentation/realitykit/postprocesseffectcontext |
| RealityKit in Metal | `RealityRenderer` | 18.0 | | https://developer.apple.com/documentation/realitykit/realityrenderer |
| Low-level renderer | `LowLevelRenderer`, `LowLevelMaterialResource` | 27.0 | No session found | https://developer.apple.com/documentation/realitykit/lowlevelrenderer |
| Splats | `GaussianSplatComponent` | 27.0 | Unlit; Apple7; cap undocumented | https://developer.apple.com/documentation/realitykit/gaussiansplatcomponent |
| LOD | `LevelOfDetailComponent` | 27.0 | | https://developer.apple.com/documentation/realitykit/levelofdetailcomponent |
| Occlusion culling | `OcclusionCullingComponent` | 27.0 | On by default | https://developer.apple.com/documentation/realitykit/occlusioncullingcomponent |
| GPU particles | `ComputeGraphComponent` | 27.0 | | https://developer.apple.com/documentation/realitykit/computegraphcomponent |
| Display case clip | `ClippingComponent` | 27.0 | | https://developer.apple.com/documentation/realitykit/clippingcomponent |
| Custom-renderer occlusion | `ARMatteGenerator` | 13.0 | | https://developer.apple.com/documentation/arkit/armattegenerator |
| Env lighting | `AREnvironmentProbeAnchor.environmentTexture` | 12.0 | | https://developer.apple.com/documentation/arkit/arenvironmentprobeanchor/environmenttexture |
| Metal 4 | `MTL4CommandQueue` | 26.0 | | https://developer.apple.com/documentation/metal/mtl4commandqueue |
| Frame interpolation | `MTLFXFrameInterpolator` | 26.0 | | https://developer.apple.com/documentation/metalfx/mtlfxframeinterpolator |
| Memory headroom | `increased-memory-limit` entitlement | 15.0 | | https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit |
| User data | SwiftData `.externalStorage` + CloudKit | 17.0 | | https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices |

## 8. UNCONFIRMED items to spike

1. **World maps in RealityView.** Whether `initialWorldMap` relocalization under `SpatialTrackingSession.run(_:session:arConfiguration:)` restores `AnchorEntity` bindings in RealityView.
2. **World map lifetime and compatibility.** How long maps stay valid, whether they survive iOS updates, interchange between LiDAR and non-LiDAR devices, and what the internal map contains (image descriptors?).
3. **Shader gaps for instancing and impostors.** Whether a per-instance index is readable in `CustomMaterial` under `MeshInstancesComponent`, and whether fragment depth output exists in RealityKit shaders.
4. **RealityView post-processing depth.** Whether RealityView's `PostProcessEffect` depth includes the LiDAR scene mesh, as it does for `ARView`.
5. **Undocumented capacities.** Maximum Gaussian splat count, and the RealityKit rigid-body count and performance ceiling.
6. **iOS 27 `LowLevelRenderer` with the AR camera.** How it composes with the camera feed; no sample or session was found.
7. **People occlusion in RealityView `.spatialTracking`.**
8. **iPhone 18 Pro hardware.** Whether it has LiDAR, and the A20 Pro's GPU family.
9. **Reality Composer Pro 3 for iOS.** Whether it targets or previews iOS; only visionOS was mentioned.

## 9. Questions for the owner that this research raises

1. **Exact iPhone and iPad models.** Do both have LiDAR? This decides occlusion quality, real-surface physics, and how reliable relocalization is.
2. **Where the trophy case lives.** On-device only, or iCloud-synced across iPhone and iPad (a privacy question for room maps)?
3. **How many shelves, and where.** One room or many? Is a "re-find your shelf" coaching moment acceptable when a room changes?
4. **How honest the physics must be.** Should iPhone-and-iPad co-play (shared shelf, simultaneous play) be part of the first version? Should bond physics be real, labelled-illustrative (like the web's "Illustrative" display motion), or switchable?
5. **The million-atom case.** Which structure and file format? Is rigid-body throwing of the whole object enough, with internal deformation only for small molecules?
6. **iOS floor.** Is iOS 27 acceptable, or should we keep iOS 26 for wider TestFlight reach?
7. **What happens to the Expo app.** Replace it with a pure Xcode SwiftUI app, or embed the native AR view in the Expo shell?