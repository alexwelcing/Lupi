@preconcurrency import ARKit
import Foundation
import LupiChem
import LupiGame
import LupiScale
import RealityKit
import simd
import UIKit

/// The ARSession we own under RealityView (plan §3.3): world tracking with the LiDAR scene
/// mesh when the device has one, planes always, and RealityKit's scene understanding for
/// collision, physics, occlusion and shadows. Without LiDAR the arena falls back to detected
/// planes as thin box colliders.
@MainActor
final class ARHost {
    let session = ARSession()
    let tracking = SpatialTrackingSession()
    let hasLiDAR = ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification)
    /// Thin static boxes on detected planes, only without LiDAR.
    let planeArena = Entity()
    private var planeColliders: [UUID: ModelEntity] = [:]
    private var lastPlaneUpdate: TimeInterval = 0
    private(set) var floorY: Double?
    private(set) var unavailable: String?
    /// The video format the thermal policy chose (spike A5); nil is ARKit's default.
    private(set) var videoFormat: ARConfiguration.VideoFormat?

    func configuration(worldMap: ARWorldMap? = nil) -> ARWorldTrackingConfiguration {
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        config.environmentTexturing = .automatic
        if hasLiDAR { config.sceneReconstruction = .meshWithClassification }
        if let videoFormat { config.videoFormat = videoFormat }
        config.initialWorldMap = worldMap
        return config
    }

    /// The frame rate the session runs at now.
    var framesPerSecond: Int {
        (session.configuration?.videoFormat ?? videoFormat)?.framesPerSecond ?? 60
    }

    /// Spike A5 (scale-spec §9.3): runs the session again with a video format at `fps`, the one
    /// nearest the current resolution. No run options, so tracking resumes from where it was and
    /// the anchors stay (`ARSession.run(_:options:)`); whether tracking survives is the spike.
    /// Returns a line for the HUD, or nil when the device has no such format.
    func setFrameRate(_ fps: Int) -> String? {
        let current = session.configuration?.videoFormat.imageResolution
        let candidates = ARWorldTrackingConfiguration.supportedVideoFormats.filter { $0.framesPerSecond == fps }
        guard let pick = candidates.min(by: { a, b in
            let w = current?.width ?? 1920
            return abs(a.imageResolution.width - w) < abs(b.imageResolution.width - w)
        }) else { return nil }
        videoFormat = pick
        session.run(configuration())
        return "A5: \(fps) fps, \(Int(pick.imageResolution.width))×\(Int(pick.imageResolution.height))"
    }

    /// Runs the session through RealityKit, so RealityView renders our ARSession's camera and
    /// scene understanding uses its mesh (`run(_:session:arConfiguration:)`, iOS 18).
    func start(worldMap: ARWorldMap? = nil) async {
        #if targetEnvironment(simulator)
        // The Simulator SDK omits the overload that takes an owned ARSession.
        // Home and Collection can run there; room tracking needs a device camera.
        unavailable = "AR needs a camera on an iPhone or iPad."
        #else
        let understanding: Set<SpatialTrackingSession.Configuration.SceneUnderstandingCapability> =
            hasLiDAR ? [.collision, .physics, .occlusion, .shadow] : []
        let spatial = SpatialTrackingSession.Configuration(tracking: [.plane, .world], sceneUnderstanding: understanding, camera: .back)
        if let missing = await tracking.run(spatial, session: session, arConfiguration: configuration(worldMap: worldMap)) {
            unavailable = missing.debugDescription
        }
        #endif
    }

    func stop() async {
        await tracking.stop()
        session.pause()
    }

    // MARK: Per frame

    /// The camera of the current frame for a view of `size` points in `orientation`
    /// (ARKit's projection and view for that orientation, so rays match what RealityView draws).
    func camera(_ frame: ARFrame, viewport size: CGSize, orientation: UIInterfaceOrientation, scale: CGFloat) -> CameraState? {
        guard size.width > 0, size.height > 0 else { return nil }
        let p = frame.camera.projectionMatrix(for: orientation, viewportSize: size, zNear: 0.01, zFar: 100)
        let view = frame.camera.viewMatrix(for: orientation)
        let world = view.inverse
        let m = Mat3(
            columns: Vec3(Double(world.columns.0.x), Double(world.columns.0.y), Double(world.columns.0.z)),
            Vec3(Double(world.columns.1.x), Double(world.columns.1.y), Double(world.columns.1.z)),
            Vec3(Double(world.columns.2.x), Double(world.columns.2.y), Double(world.columns.2.z))
        )
        let t = Vec3(Double(world.columns.3.x), Double(world.columns.3.y), Double(world.columns.3.z))
        return CameraState(
            worldFromCamera: RigidD(rotation: Quat(rotation: m), translation: t),
            projection: Projection(
                columns: SIMD4<Double>(Double(p.columns.0.x), Double(p.columns.0.y), Double(p.columns.0.z), Double(p.columns.0.w)),
                SIMD4<Double>(Double(p.columns.1.x), Double(p.columns.1.y), Double(p.columns.1.z), Double(p.columns.1.w)),
                SIMD4<Double>(Double(p.columns.2.x), Double(p.columns.2.y), Double(p.columns.2.z), Double(p.columns.2.w))
            ),
            viewportPoints: SIMD2(Double(size.width), Double(size.height)),
            pixelsPerPoint: Double(scale)
        )
    }

    /// Updates the floor height and, without LiDAR, the plane colliders (at most twice a second).
    func update(_ frame: ARFrame) {
        guard frame.timestamp - lastPlaneUpdate >= 0.5 else { return }
        lastPlaneUpdate = frame.timestamp
        let planes = frame.anchors.compactMap { $0 as? ARPlaneAnchor }
        var lowestFloor: Double?
        var lowestHorizontal: Double?
        for plane in planes where plane.alignment == .horizontal {
            let y = Double(plane.transform.columns.3.y)
            lowestHorizontal = min(lowestHorizontal ?? y, y)
            if case .floor = plane.classification { lowestFloor = min(lowestFloor ?? y, y) }
        }
        floorY = lowestFloor ?? lowestHorizontal
        guard !hasLiDAR else { return }
        var seen: Set<UUID> = []
        for plane in planes {
            seen.insert(plane.identifier)
            let size = SIMD3<Float>(max(plane.planeExtent.width, 0.05), 0.01, max(plane.planeExtent.height, 0.05))
            let collider: ModelEntity
            if let existing = planeColliders[plane.identifier] {
                collider = existing
            } else {
                collider = ModelEntity()
                planeArena.addChild(collider)
                planeColliders[plane.identifier] = collider
            }
            collider.components.set(CollisionComponent(shapes: [ShapeResource.generateBox(size: size)]))
            collider.components.set(PhysicsBodyComponent(massProperties: .default, material: nil, mode: .static))
            // The box's top face lies on the plane, rotated about the plane's own y.
            let local = Transform(
                rotation: simd_quatf(angle: plane.planeExtent.rotationOnYAxis, axis: SIMD3<Float>(0, 1, 0)),
                translation: plane.center - SIMD3<Float>(0, 0.005, 0)
            )
            collider.transform = Transform(matrix: plane.transform * local.matrix)
        }
        for (id, e) in planeColliders where !seen.contains(id) {
            e.removeFromParent()
            planeColliders[id] = nil
        }
    }

    // MARK: Shelves: anchors, re-runs and raycasts (plan §6.3, §6.4)

    /// Re-runs our session from a world map (or none), dropping what it tracked. The first run
    /// goes through `SpatialTrackingSession`; whether RealityView keeps drawing after a direct
    /// re-run like this is part of spike A1.
    func rerun(worldMap: ARWorldMap?) {
        session.run(configuration(worldMap: worldMap), options: [.resetTracking, .removeExistingAnchors])
    }

    /// Adds an anchor at a pose; returns its identifier.
    func addAnchor(named name: String, at pose: RigidD) -> UUID {
        let anchor = ARAnchor(name: name, transform: pose.transform.matrix)
        session.add(anchor: anchor)
        return anchor.identifier
    }

    func removeAnchor(_ id: UUID) {
        guard let anchor = session.currentFrame?.anchors.first(where: { $0.identifier == id }) else { return }
        session.remove(anchor: anchor)
    }

    /// The pose of an anchor in this frame, when the session has it.
    func anchorPose(_ id: UUID, in frame: ARFrame) -> RigidD? {
        frame.anchors.first { $0.identifier == id }.map { RigidD($0.transform) }
    }

    /// Where a world ray meets a real horizontal surface ARKit knows or estimates.
    func raycast(_ ray: RayD) -> Vec3? {
        let query = ARRaycastQuery(
            origin: ray.origin.asFloat, direction: ray.direction.normalized.asFloat, allowing: .estimatedPlane, alignment: .horizontal
        )
        guard let hit = session.raycast(query).first else { return nil }
        let t = hit.worldTransform.columns.3
        return Vec3(Double(t.x), Double(t.y), Double(t.z))
    }
}

extension ARCamera.TrackingState {
    var line: String {
        switch self {
        case .notAvailable: "not available"
        case .normal: "normal"
        case let .limited(reason):
            switch reason {
            case .initializing: "initializing"
            case .relocalizing: "relocalizing"
            case .excessiveMotion: "excessive motion"
            case .insufficientFeatures: "insufficient features"
            @unknown default: "limited"
            }
        }
    }
}

extension ARFrame.WorldMappingStatus {
    var line: String {
        switch self {
        case .notAvailable: "not available"
        case .limited: "limited"
        case .extending: "extending"
        case .mapped: "mapped"
        @unknown default: "unknown"
        }
    }
}
