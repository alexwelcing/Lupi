import Foundation
import LupiChem
import LupiGame
import LupiScale
import RealityKit
import simd

/// How spike S8 builds a terrain window's colliders (scale.md §8: asynchronous `ShapeResource`
/// rebuild latency for terrain windows).
enum S8Build: String, CaseIterable, Identifiable {
    /// A sphere shape per atom bump, generated on the main actor.
    case primitives
    /// One static triangle mesh per window, from `ShapeResource.generateStaticMesh`, which is
    /// `nonisolated async` and so leaves the main actor while it cooks.
    case staticMesh

    var id: String { rawValue }

    var title: String {
        switch self {
        case .primitives: "spheres"
        case .staticMesh: "static mesh"
        }
    }
}

/// Spike S8's readout: how long a terrain collider set takes from the session's command to being
/// set on its entity. RealityKit's own step that picks the new shapes up is not visible here.
struct S8Timing {
    private(set) var builds = 0
    private(set) var lastMs = 0.0
    private(set) var lastShapes = 0
    private(set) var recent: [Double] = []
    /// Asynchronous builds in flight, those a newer command made stale before they finished,
    /// and those RealityKit refused.
    var pending = 0
    private(set) var stale = 0
    private(set) var failed = 0

    mutating func record(_ ms: Double, shapes: Int) {
        builds += 1
        lastMs = ms
        lastShapes = shapes
        recent.append(ms)
        if recent.count > 30 { recent.removeFirst(recent.count - 30) }
    }

    mutating func dropStale() { stale += 1 }
    mutating func fail() { failed += 1 }

    func line(_ build: S8Build) -> String {
        let mean = recent.isEmpty ? 0 : recent.reduce(0, +) / Double(recent.count)
        let worst = recent.max() ?? 0
        return String(
            format: "S8 app (%@): last %.2f ms for %d shapes, mean %.2f, max %.2f of %d, pending %d, stale %d, failed %d",
            build.title, lastMs, lastShapes, mean, worst, recent.count, pending, stale, failed
        )
    }
}

/// A terrain's static colliders (scale-spec §10.1): face planes and windows of atom bumps, each an
/// entity with no model and a static body, replaced whole when the session rebuilds it. They
/// belong to no body, so a toy that touches one reports a contact with the room.
@MainActor
final class StaticColliders {
    let parent: Entity
    var build = S8Build.primitives
    private(set) var timing = S8Timing()
    private var entities: [ColliderKey: Entity] = [:]
    /// Bumped by every command for a key, so an asynchronous build that a newer command
    /// overtook is dropped instead of replacing the newer shapes.
    private var generation: [ColliderKey: Int] = [:]

    init(parent: Entity) { self.parent = parent }

    var count: Int { entities.count }

    func apply(_ key: ColliderKey, origin: Vec3, shapes: [CollisionShape], material: PhysicsMaterialResource) {
        let g = (generation[key] ?? 0) + 1
        generation[key] = g
        // A collider at a non-finite place would poison the simulation: drop it instead.
        guard !shapes.isEmpty, origin.allFinite, shapes.allSatisfy(\.allFinite) else {
            remove(key)
            return
        }
        let clock = ContinuousClock()
        let requested = clock.now
        var isWindow = true
        if case .faces = key { isWindow = false }
        if build == .staticMesh, isWindow, let mesh = Self.bumpMesh(shapes) {
            timing.pending += 1
            Task { [weak self] in
                let shape = try? await ShapeResource.generateStaticMesh(positions: mesh.positions, faceIndices: mesh.faces)
                guard let self else { return }
                self.timing.pending -= 1
                guard self.generation[key] == g else {
                    self.timing.dropStale()
                    return
                }
                guard let shape else {
                    self.timing.fail()
                    return
                }
                self.place(key, origin: origin, shapes: [shape], material: material)
                self.timing.record(Self.milliseconds(clock.now - requested), shapes: shapes.count)
            }
            return
        }
        place(key, origin: origin, shapes: shapes.map { PlayScene.shape($0) }, material: material)
        timing.record(Self.milliseconds(clock.now - requested), shapes: shapes.count)
    }

    func removeAll() {
        for key in Array(entities.keys) { remove(key) }
    }

    private func remove(_ key: ColliderKey) {
        entities.removeValue(forKey: key)?.removeFromParent()
    }

    private func place(_ key: ColliderKey, origin: Vec3, shapes: [ShapeResource], material: PhysicsMaterialResource) {
        let entity: Entity
        if let e = entities[key] {
            entity = e
        } else {
            entity = Entity()
            parent.addChild(entity)
            entities[key] = entity
        }
        entity.position = origin.asFloat
        entity.components.set(CollisionComponent(shapes: shapes))
        entity.components.set(PhysicsBodyComponent(massProperties: .default, material: material, mode: .static))
    }

    static func milliseconds(_ d: Duration) -> Double {
        Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
    }

    /// Each sphere as an icosahedron about its centre, outward faces counter-clockwise; nil when a
    /// window holds anything but spheres or would overflow 16-bit indices.
    static func bumpMesh(_ shapes: [CollisionShape]) -> (positions: [SIMD3<Float>], faces: [UInt16])? {
        guard shapes.count * icosahedron.vertices.count <= Int(UInt16.max) else { return nil }
        var positions: [SIMD3<Float>] = []
        var faces: [UInt16] = []
        positions.reserveCapacity(shapes.count * icosahedron.vertices.count)
        faces.reserveCapacity(shapes.count * icosahedron.faces.count)
        for s in shapes {
            guard case let .sphere(c, r) = s else { return nil }
            let base = UInt16(positions.count)
            for v in icosahedron.vertices { positions.append((c + r * v).asFloat) }
            for i in icosahedron.faces { faces.append(base + i) }
        }
        return (positions, faces)
    }

    /// The unit icosahedron (circumscribed by the unit sphere).
    static let icosahedron: (vertices: [Vec3], faces: [UInt16]) = {
        let t = (1 + 5.0.squareRoot()) / 2
        let raw: [Vec3] = [
            Vec3(-1, t, 0), Vec3(1, t, 0), Vec3(-1, -t, 0), Vec3(1, -t, 0),
            Vec3(0, -1, t), Vec3(0, 1, t), Vec3(0, -1, -t), Vec3(0, 1, -t),
            Vec3(t, 0, -1), Vec3(t, 0, 1), Vec3(-t, 0, -1), Vec3(-t, 0, 1),
        ]
        let faces: [UInt16] = [
            0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
            1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
            3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
            4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
        ]
        let n = (1 + t * t).squareRoot()
        return (raw.map { $0 / n }, faces)
    }()
}

extension SIMD3 where Scalar == Double {
    var allFinite: Bool { x.isFinite && y.isFinite && z.isFinite }
}

extension CollisionShape {
    var allFinite: Bool {
        switch self {
        case let .sphere(c, r): c.allFinite && r.isFinite && r > 0
        case let .box(c, h, q): c.allFinite && h.allFinite && q.x.isFinite && q.y.isFinite && q.z.isFinite && q.w.isFinite
        case let .convex(points): !points.isEmpty && points.allSatisfy(\.allFinite)
        }
    }
}

extension RigidD {
    var allFinite: Bool {
        translation.allFinite && rotation.x.isFinite && rotation.y.isFinite && rotation.z.isFinite && rotation.w.isFinite
    }
}
