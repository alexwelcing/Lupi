import Foundation
import LupiChem
import LupiPlay
import LupiScale
import LupiScaleCore

/// One outer face of a terrain's root near the camera (scale-spec §10.1), in the world.
public struct TerrainFace: Sendable, Equatable {
    public var point: Vec3
    /// Outward, unit: the matter is on the other side.
    public var normal: Vec3

    public init(point: Vec3, normal: Vec3) {
        self.point = point
        self.normal = normal.normalized
    }

    /// The signed distance of a point outside the face (negative behind it, in the matter).
    func distance(_ p: Vec3) -> Double { (p - point).dot(normal) }
}

/// Where a terrain's matter is near the camera: inside its anchor, or inside the anchor's
/// neighbourhood and behind every face of the root that the cut found within reach. Only a solid
/// (a crystal, or a tower of a seed that tiles) has an inside and faces; a sparse tower such as a
/// grown water has neither, and meets toys through its windows of atom bumps alone.
public struct TerrainRegion: Sendable {
    public var faces: [TerrainFace]
    var worldFromAnchor: RigidD
    var sigma: Double
    /// The region the anchor's matter fills, anchor units (`Resolver.occupied`): every point of it
    /// is inside the root.
    var anchor: Box3
    /// Its 3 × 3 × 3 neighbourhood, anchor units; nil when the anchor is the body's node.
    var neighbourhood: Box3?
    var solid: Bool

    public func contains(_ p: Vec3) -> Bool {
        guard solid else { return false }
        let x = worldFromAnchor.inverse.apply(p) / sigma
        if anchor.contains(x) { return true }
        guard let n = neighbourhood, !faces.isEmpty, n.contains(x) else { return false }
        return faces.allSatisfy { $0.distance(p) <= 0 }
    }
}

/// Which static collider a command replaces (scale-spec §10.1).
public enum ColliderKey: Sendable, Hashable {
    /// The terrain's face planes: boxes 0.5 m thick behind each face near the camera.
    case faces
    /// Atom bumps in the 1 m window around the camera.
    case cameraWindow
    /// Atom bumps in the 0.5 m window around a slow body.
    case bodyWindow(BodyID)
}

/// The starting values of §10.1's terrain physics.
public enum TerrainTuning {
    public static let faceThickness = 0.5
    /// Face planes reach z_far about the camera's foot on them.
    public static let faceReach = 20.0
    /// Faces are re-made when the camera's foot moves this far from where they were made.
    public static let faceRemake = 10.0
    public static let cameraWindowRadius = 1.0
    public static let bodyWindowRadius = 0.5
    public static let cameraWindowShapes = 64
    public static let bodyWindowShapes = 64
    public static let windowShapes = 256
    /// Slower bodies get a window; faster ones meet the face planes alone, with CCD.
    public static let slowSpeed = 1.0
}

/// Pure geometry of terrain colliders.
public enum TerrainGeometry {
    /// Each face as a box 0.5 m thick behind it, reaching z_far about the camera's foot and clipped
    /// at the faces perpendicular to it, so no plane reaches past the root's edge. Metres about `origin`.
    public static func faceBoxes(_ faces: [TerrainFace], camera: Vec3, origin: Vec3, reach: Double = TerrainTuning.faceReach) -> [CollisionShape] {
        var out: [CollisionShape] = []
        for (i, f) in faces.enumerated() {
            let n = f.normal
            let others = faces.enumerated().filter { $0.offset != i && abs($0.element.normal.dot(n)) < 1e-6 }.map(\.element)
            var u = others.first?.normal ?? (abs(n.y) < 0.9 ? Vec3(0, 1, 0).cross(n) : Vec3(1, 0, 0).cross(n)).normalized
            u = (u - n * u.dot(n)).normalized
            let v = n.cross(u)
            let foot = camera - n * (camera - f.point).dot(n)
            var lo = SIMD2(-reach, -reach), hi = SIMD2(reach, reach)
            for g in others {
                let limit = (g.point - foot).dot(g.normal)
                let cu = g.normal.dot(u), cv = g.normal.dot(v)
                if abs(cu) > 1 - 1e-6 {
                    if cu > 0 { hi.x = min(hi.x, limit) } else { lo.x = max(lo.x, -limit) }
                } else if abs(cv) > 1 - 1e-6 {
                    if cv > 0 { hi.y = min(hi.y, limit) } else { lo.y = max(lo.y, -limit) }
                }
            }
            guard hi.x > lo.x, hi.y > lo.y else { continue }
            let half = TerrainTuning.faceThickness / 2
            let centre = foot + u * ((lo.x + hi.x) / 2) + v * ((lo.y + hi.y) / 2) - n * half
            out.append(.box(
                centre: centre - origin, halfExtents: Vec3((hi.x - lo.x) / 2, (hi.y - lo.y) / 2, half),
                rotation: Quat(rotation: Mat3(columns: u, v, n))
            ))
        }
        return out
    }

    /// The atoms a cut drew for one body, in the world, with their toy radii.
    public static func atoms(_ cut: Cut, body index: Int) -> [(centre: Vec3, radius: Double)] {
        var out: [(Vec3, Double)] = []
        for item in cut.items where item.body == index {
            guard case let .atoms(runs) = item.extras else { continue }
            let m = item.transform
            let scale = Double((m.c0 * m.c0).sum().squareRoot())
            for run in runs {
                for p in run.positions {
                    let local = m.apply(p)
                    var w = Vec3(Double(local.x), Double(local.y), Double(local.z))
                    switch item.parent {
                    case .cameraFrame: w += cut.cameraFrameOrigin
                    case let .body(b): w = cut.bodyEntities[b].apply(w)
                    }
                    out.append((w, Double(run.radius) * scale))
                }
            }
        }
        return out
    }

    /// Up to `limit` atoms within `radius` of `centre`, nearest first, as spheres about `centre`.
    public static func window(_ atoms: [(centre: Vec3, radius: Double)], centre: Vec3, radius: Double, limit: Int) -> [CollisionShape] {
        var near: [(Double, Vec3, Double)] = []
        for a in atoms {
            let d = (a.centre - centre).length - a.radius
            if d <= radius { near.append((d, a.centre, a.radius)) }
        }
        near.sort { $0.0 < $1.0 }
        return near.prefix(limit).map { .sphere(centre: $0.1 - centre, radius: $0.2) }
    }
}

/// What spike S8 reads: terrain colliders and how often their windows are rebuilt.
public struct TerrainStats: Sendable, Equatable {
    public var faces = 0
    public var cameraShapes = 0
    public var bodyWindows = 0
    public var bodyShapes = 0
    /// Windows rebuilt since the terrain formed.
    public var rebuilds = 0
    var recent: [Double] = []

    public var rebuildsPerSecond: Double { Double(recent.count) }

    public var line: String {
        "S8 terrain: \(faces) faces, camera \(cameraShapes) bumps, \(bodyWindows) body windows (\(bodyShapes)), "
            + String(format: "%.0f rebuilds/s, %d in all", rebuildsPerSecond, rebuilds)
    }
}

/// The terrain colliders the app holds, so only what changed is sent again.
struct TerrainColliderState: Sendable {
    struct Window: Sendable {
        var centre: Vec3
        var shapes: Int
        var builtAt: Double
    }

    struct Key: Sendable, Equatable {
        var body: BodyID
        var root: NodeID
        var steps: Int
        var sigma: Double
        var translation: Vec3
    }

    var key: Key?
    var faceFoot: Vec3?
    var faceCount = 0
    var camera: Window?
    var bodies: [BodyID: Window] = [:]
    var stats = TerrainStats()

    /// The terrain changed under its colliders (a chip, a pinch): everything is rebuilt.
    mutating func invalidate() { key = nil }

    var holdsAny: Bool { key != nil || camera != nil || !bodies.isEmpty || faceFoot != nil }
}

/// Debug switches for the day-one device spikes (plan §8 M3a).
public struct SessionDebug: Sendable, Equatable {
    /// S8: rebuild the camera's atom window every frame, to time the worst case.
    public var s8RebuildEveryFrame = false
    /// Flexible molecules flop (plan §8 M4); off draws them stiff, for spike A6's comparison.
    public var flop = true
    /// Spike A5: the thermal policy may ask for a 30 fps video format at critical.
    public var a5ThirtyFPS = false
    /// Plays as if the device were this hot, to try the thermal policy without heating it.
    public var thermalOverride: ThermalLevel?

    public init() {}
}

extension PlaySession {
    /// The terrain's colliders, for the HUD and spike S8.
    public var terrainStats: TerrainStats { terrainColliders.stats }

    /// The terrain near the camera, from its anchor and the last cut's face planes.
    func terrainRegion(_ b: Body) -> TerrainRegion? {
        guard let body = try? resolver.resolve(b.frame.ref.root, b.frame.ref.path),
              let anchor = try? resolver.walk(body, b.frame.anchorPath),
              let agg = try? resolver.aggregate(anchor),
              let occupied = try? resolver.occupied(anchor) else { return nil }
        let w = b.frame.worldFromAnchor
        let sigma = b.frame.metresPerAnchorUnit
        let box = agg.bounds
        guard agg.solid else {
            return TerrainRegion(faces: [], worldFromAnchor: w, sigma: sigma, anchor: occupied, neighbourhood: nil, solid: false)
        }
        if b.frame.anchorPath.isEmpty {
            // The body's own node: its six faces are exact.
            var faces: [TerrainFace] = []
            for a in 0..<3 {
                for upper in [false, true] {
                    var p = box.centre
                    p[a] = upper ? box.max[a] : box.min[a]
                    var n = Vec3.zero
                    n[a] = upper ? 1 : -1
                    faces.append(TerrainFace(point: w.apply(sigma * p), normal: w.applyDirection(n)))
                }
            }
            return TerrainRegion(faces: faces, worldFromAnchor: w, sigma: sigma, anchor: occupied, neighbourhood: nil, solid: true)
        }
        var faces: [TerrainFace] = []
        if let cut = lastCut, let index = lastOrder.firstIndex(of: b.id) {
            for item in cut.items where item.body == index && item.kind == .facePlane {
                guard case let .plane(normal, _, _) = item.extras else { continue }
                let t = item.transform.translation
                let point = Vec3(Double(t.x), Double(t.y), Double(t.z)) + cut.cameraFrameOrigin
                faces.append(TerrainFace(point: point, normal: Vec3(Double(normal.x), Double(normal.y), Double(normal.z))))
            }
        }
        let size = occupied.size
        return TerrainRegion(
            faces: faces, worldFromAnchor: w, sigma: sigma, anchor: occupied,
            neighbourhood: Box3(min: occupied.min - size, max: occupied.max + size), solid: true
        )
    }

    /// Whether a world point is inside a terrain's matter.
    func terrainContains(_ b: Body, _ p: Vec3) -> Bool { terrainRegion(b)?.contains(p) ?? false }

    /// Terrain every frame (scale-spec §10.1): the anchor follows the camera, and while the camera is
    /// inside the solid every toy is parked and the colliders are off. Toys the terrain grew around
    /// are parked too, so nothing is ever left inside matter; they come back when it lets them go.
    mutating func updateTerrain() {
        guard let terrain = bodyOrder.compactMap({ bodies[$0] }).first(where: { $0.sizeState == .terrain }) else {
            if cameraInsideTerrain || bodies.values.contains(where: \.parked) { unparkAll() }
            cameraInsideTerrain = false
            return
        }
        var t = terrain
        // A flight moves the anchor toward its own focus.
        if let camera, flightState?.body != t.id { try? LupiScale.rebase(&t.frame, focusWorld: camera.position, resolver: resolver) }
        bodies[t.id] = t
        guard let camera, let region = terrainRegion(t) else { return }
        let inside = region.contains(camera.position)
        if inside != cameraInsideTerrain {
            cameraInsideTerrain = inside
            if let spec = try? BodyPhysics.spec(t, mode: t.mode, resting: false, now: time ?? 0, cameraInside: inside, resolver: resolver) {
                bodies[t.id]?.spec = spec
                out.physics.append(.update(t.id, spec))
            }
        }
        for id in bodyOrder where id != t.id {
            guard let b = bodies[id], b.isToy, grab?.body != id else { continue }
            let park = inside || region.contains(b.entityPose.translation)
            if park != b.parked {
                bodies[id]?.parked = park
                out.physics.append(.park(id, park))
            }
        }
    }

    mutating func unparkAll() {
        for id in bodyOrder where bodies[id]?.parked == true {
            bodies[id]?.parked = false
            out.physics.append(.park(id, false))
        }
    }

    // MARK: Colliders (§10.1)

    /// Face planes made when the terrain forms and kept while it stands, and windows of atom bumps
    /// around the camera and each slow body, rebuilt when their centre moves a quarter of their
    /// radius. All off while the camera is inside the solid or the terrain is moving.
    mutating func stepTerrainColliders(now: Double) {
        guard let camera, let t = bodyOrder.compactMap({ bodies[$0] }).first(where: { $0.sizeState == .terrain }),
              !cameraInsideTerrain, flightState?.body != t.id, glide?.body != t.id, pinch?.body != t.id,
              let region = terrainRegion(t) else {
            removeTerrainColliders()
            return
        }
        let key = TerrainColliderState.Key(
            body: t.id, root: t.frame.ref.root, steps: t.frame.anchorPath.count, sigma: t.frame.metresPerAnchorUnit,
            translation: t.frame.worldFromAnchor.translation
        )
        if terrainColliders.key != key {
            terrainColliders.key = key
            terrainColliders.faceFoot = nil
            terrainColliders.camera = nil
            for id in terrainColliders.bodies.keys { terrainColliders.bodies[id]?.builtAt = -.infinity }
        }
        terrainColliders.stats.recent.removeAll { now - $0 > 1 }
        let material = terrainMaterial(t)

        // Faces: re-made only when the set changes or the camera's foot wanders far.
        if region.faces.count != terrainColliders.faceCount || terrainColliders.faceFoot.map({ ($0 - camera.position).length > TerrainTuning.faceRemake }) ?? true {
            let boxes = TerrainGeometry.faceBoxes(region.faces, camera: camera.position, origin: camera.position)
            out.physics.append(.staticColliders(.faces, origin: camera.position, shapes: boxes, material: material))
            terrainColliders.faceFoot = camera.position
            terrainColliders.faceCount = region.faces.count
            terrainColliders.stats.faces = boxes.count
        }

        var atoms: [(centre: Vec3, radius: Double)]?
        func cutAtoms() -> [(centre: Vec3, radius: Double)] {
            if let atoms { return atoms }
            let found = lastCut.flatMap { cut in lastOrder.firstIndex(of: t.id).map { TerrainGeometry.atoms(cut, body: $0) } } ?? []
            atoms = found
            return found
        }

        // The camera's window.
        let cw = terrainColliders.camera
        let moved = cw.map { ($0.centre - camera.position).length >= TerrainTuning.cameraWindowRadius / 4 } ?? true
        let empty = cw.map { $0.shapes == 0 && now - $0.builtAt >= 0.5 } ?? false
        if moved || debug.s8RebuildEveryFrame || (empty && !cutAtoms().isEmpty) {
            let shapes = TerrainGeometry.window(
                cutAtoms(), centre: camera.position, radius: TerrainTuning.cameraWindowRadius, limit: TerrainTuning.cameraWindowShapes
            )
            out.physics.append(.staticColliders(.cameraWindow, origin: camera.position, shapes: shapes, material: material))
            terrainColliders.camera = .init(centre: camera.position, shapes: shapes.count, builtAt: now)
            terrainColliders.stats.cameraShapes = shapes.count
            noteRebuild(now)
        }

        // Slow bodies' windows, nearest first, sharing what the camera's leaves.
        let slow = bodyOrder.compactMap { bodies[$0] }.filter {
            $0.isToy && $0.mode == .dynamic && !$0.parked && grab?.body != $0.id && $0.motion.linearVelocity.length < TerrainTuning.slowSpeed
        }.sorted { ($0.entityPose.translation - camera.position).length < ($1.entityPose.translation - camera.position).length }
        var left = TerrainTuning.windowShapes - TerrainTuning.cameraWindowShapes
        var kept: Set<BodyID> = []
        var shapesInBodies = 0
        for b in slow where left > 0 {
            let centre = b.centreOfMassWorld
            let limit = min(TerrainTuning.bodyWindowShapes, left)
            if let w = terrainColliders.bodies[b.id], w.builtAt > -.infinity, (w.centre - centre).length < TerrainTuning.bodyWindowRadius / 4, w.shapes <= limit {
                kept.insert(b.id)
                left -= w.shapes
                shapesInBodies += w.shapes
                continue
            }
            let shapes = TerrainGeometry.window(cutAtoms(), centre: centre, radius: TerrainTuning.bodyWindowRadius, limit: limit)
            out.physics.append(.staticColliders(.bodyWindow(b.id), origin: centre, shapes: shapes, material: material))
            terrainColliders.bodies[b.id] = .init(centre: centre, shapes: shapes.count, builtAt: now)
            kept.insert(b.id)
            left -= shapes.count
            shapesInBodies += shapes.count
            noteRebuild(now)
        }
        for id in terrainColliders.bodies.keys where !kept.contains(id) {
            out.physics.append(.staticColliders(.bodyWindow(id), origin: .zero, shapes: [], material: material))
            terrainColliders.bodies[id] = nil
        }
        terrainColliders.stats.bodyWindows = kept.count
        terrainColliders.stats.bodyShapes = shapesInBodies
    }

    mutating func noteRebuild(_ now: Double) {
        terrainColliders.stats.rebuilds += 1
        terrainColliders.stats.recent.append(now)
    }

    mutating func removeTerrainColliders() {
        guard terrainColliders.holdsAny else { return }
        let none = SurfaceMaterial(staticFriction: 0, dynamicFriction: 0, restitution: 0)
        if terrainColliders.faceFoot != nil { out.physics.append(.staticColliders(.faces, origin: .zero, shapes: [], material: none)) }
        if terrainColliders.camera != nil { out.physics.append(.staticColliders(.cameraWindow, origin: .zero, shapes: [], material: none)) }
        for id in terrainColliders.bodies.keys.sorted() {
            out.physics.append(.staticColliders(.bodyWindow(id), origin: .zero, shapes: [], material: none))
        }
        let stats = TerrainStats(rebuilds: terrainColliders.stats.rebuilds)
        terrainColliders = TerrainColliderState()
        terrainColliders.stats = stats
    }

    func terrainMaterial(_ b: Body) -> SurfaceMaterial {
        let p = b.facts.personality.personality
        return SurfaceMaterial(staticFriction: p.friction, dynamicFriction: p.dynamicFriction, restitution: p.restitution)
    }
}
