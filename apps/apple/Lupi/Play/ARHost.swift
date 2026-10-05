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

    func configuration(worldMap: ARWorldMap? = nil) -> ARWorldTrackingConfiguration {
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        config.environmentTexturing = .automatic
        if hasLiDAR { config.sceneReconstruction = .meshWithClassification }
        config.initialWorldMap = worldMap
        return config
    }

    /// Runs the session through RealityKit, so RealityView renders our ARSession's camera and
    /// scene understanding uses its mesh (`run(_:session:arConfiguration:)`, iOS 18).
    func start(worldMap: ARWorldMap? = nil) async {
        let understanding: Set<SpatialTrackingSession.Configuration.SceneUnderstandingCapability> =
            hasLiDAR ? [.collision, .physics, .occlusion, .shadow] : []
        let spatial = SpatialTrackingSession.Configuration(tracking: [.plane, .world], sceneUnderstanding: understanding, camera: .back)
        if let missing = await tracking.run(spatial, session: session, arConfiguration: configuration(worldMap: worldMap)) {
            unavailable = missing.debugDescription
        }
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

    // MARK: Spike A1: world map save and relocalize

    static var worldMapURL: URL {
        URL.documentsDirectory.appending(path: "spike-a1.worldmap")
    }

    /// Saves the current world map when mapping allows it; returns a line for the HUD.
    func saveWorldMap() async -> String {
        guard let status = session.currentFrame?.worldMappingStatus, status == .extending || status == .mapped else {
            return "A1: map not ready, look around more"
        }
        do {
            let map = try await session.currentWorldMap()
            let data = try NSKeyedArchiver.archivedData(withRootObject: map, requiringSecureCoding: true)
            try data.write(to: Self.worldMapURL, options: [.atomic, .completeFileProtection])
            return "A1: saved \(data.count / 1024) KB, \(map.anchors.count) anchors"
        } catch {
            return "A1: save failed: \(error.localizedDescription)"
        }
    }

    /// Reruns the session from the saved map; relocalization shows in the HUD's tracking line.
    func loadWorldMap() async -> String {
        do {
            let data = try Data(contentsOf: Self.worldMapURL)
            guard let map = try NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: data) else { return "A1: no map" }
            await tracking.stop()
            await start(worldMap: map)
            return "A1: relocalizing from \(data.count / 1024) KB"
        } catch {
            return "A1: load failed: \(error.localizedDescription)"
        }
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
