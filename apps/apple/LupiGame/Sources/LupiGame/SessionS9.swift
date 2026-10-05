import Foundation
import LupiChem
import LupiScale
import LupiScaleCore

/// Spike S9 (plan §8 M3a, scale.md §8.2): are RealityKit's box and convex colliders stable at the
/// size extremes toys reach, 3 cm and 90 cm (scale.md §5.1)? Four bodies drop onto the floor
/// side by side, and each one's landing, rest, sinking and jitter are read off the frames.
public struct S9Probe: Sendable, Equatable {
    public struct Track: Sendable, Equatable {
        public var body: BodyID
        /// "box 3 cm" and the like.
        public var label: String
        public var landedAt: Double?
        public var restedAt: Double?
        /// Deepest the body's collider went below the floor, metres.
        public var deepestSink = 0.0
        /// Fastest it moved once at rest, m/s: the jitter.
        public var jitter = 0.0
        /// It went 25 cm below the floor: through it.
        public var fellThrough = false
        /// It left play (poofed).
        public var lost = false
    }

    public var started: Double
    public var tracks: [Track]

    public var lines: [String] {
        tracks.map { t in
            var s = "S9 \(t.label):"
            if t.lost { return s + " gone" }
            if t.fellThrough { s += " FELL THROUGH," }
            s += t.landedAt.map { String(format: " landed %.2f s,", $0 - started) } ?? " falling,"
            s += t.restedAt.map { String(format: " rest %.2f s,", $0 - started) } ?? " moving,"
            return s + String(format: " sink %.1f mm, jitter %.3f m/s", t.deepestSink * 1000, t.jitter)
        }
    }

    /// A salt seed under oblique periods: a tower level whose proxy is a hull (§10.4). Debug content
    /// only; v1's content has no oblique tower.
    public static let obliqueTower: NodeRecord = {
        let p = SaltLadder.periodQ16
        let tower = TowerNode(
            seed: SaltLadder.seedRecord.id, factor: 10,
            periodsQ16: [SIMD3(p, 0, 0), SIMD3(p / 2, p, 0), SIMD3(0, 0, p)], levels: BigUInt(3)
        )
        // Valid by construction: independent periods, slenderness 1.25.
        return try! NodeRecord(.tower(tower))
    }()

    /// The four bodies: (what, longest span in metres).
    static func cases(_ catalog: Catalog) throws -> [(String, ScaleRef, Double)] {
        let cube = try SaltLadder.ref(levels: 3)
        guard let pack = catalog.scalePack else { throw ScaleError(.missing, "the bundled scale pack") }
        let bar = try ScaleContent.ref(.salt(.googolplex), pack: pack)
        let hull = try ScaleRef.keep(root: obliqueTower.id, path: Path(), store: RecordStore([obliqueTower, SaltLadder.seedRecord]))
        return [("box 3 cm", cube, 0.03), ("box 90 cm bar", bar, 0.90), ("convex 3 cm", hull, 0.03), ("convex 90 cm", hull, 0.90)]
    }
}

extension PlaySession {
    /// Drops S9's four bodies onto the floor 1.5 m ahead, 25 cm up, side by side.
    public mutating func s9DropExtremes() {
        guard let camera, let floor = floorY, let now = time else {
            out.events.append(.refused("S9 needs the floor: look at it first"))
            return
        }
        guard !cameraInsideTerrain else {
            out.events.append(.refused("Step out of the crystal first"))
            return
        }
        do {
            var flat = camera.forward
            flat.y = 0
            flat = flat.lengthSquared > 1e-6 ? flat.normalized : Vec3(0, 0, -1)
            let side = Vec3(0, 1, 0).cross(flat).normalized * -1
            var tracks: [S9Probe.Track] = []
            for (i, (label, ref, span)) in try S9Probe.cases(catalog).enumerated() {
                store.add(ref.records)
                let facts = try BodyFacts.of(ref, resolver: resolver)
                let sigma = span / facts.aggregate.bounds.longest
                let height = facts.aggregate.bounds.size.y * sigma
                let centre = Vec3(camera.position.x, floor, camera.position.z) + flat * 1.5 + side * ((Double(i) - 1.5) * 0.5)
                    + Vec3(0, 0.25 + height / 2, 0)
                let frame = BodyFrame(ref: ref, worldFromAnchor: RigidD(translation: centre - sigma * facts.aggregate.centre), metresPerAnchorUnit: sigma)
                let id = try addBody(
                    frame: frame, identity: ref, facts: facts, name: "S9 \(label)", brokenFrom: nil, feltMass: nil, mode: .dynamic, now: now,
                    spawnSpan: span, provenance: .scale
                )
                // A drop, not a smash: no break for the probe's run.
                bodies[id]?.breakableAfter = now + 30
                bodies[id]?.floatUntil = -.infinity
                tracks.append(S9Probe.Track(body: id, label: label))
            }
            s9 = S9Probe(started: now, tracks: tracks)
        } catch {
            out.events.append(.refused("S9: \(error)"))
        }
    }

    mutating func stepS9(now: Double) {
        guard var probe = s9 else { return }
        let floor = floorY ?? -.infinity
        for i in probe.tracks.indices {
            var t = probe.tracks[i]
            guard let b = bodies[t.body] else {
                t.lost = true
                probe.tracks[i] = t
                continue
            }
            let bottom = b.lowestColliderPoint
            t.deepestSink = max(t.deepestSink, floor - bottom)
            if bottom < floor - 0.25 { t.fellThrough = true }
            if t.landedAt == nil, b.lastContact > probe.started { t.landedAt = b.lastContact }
            if t.restedAt == nil, b.atRest { t.restedAt = now }
            if t.restedAt != nil { t.jitter = max(t.jitter, b.motion.linearVelocity.length) }
            probe.tracks[i] = t
        }
        s9 = probe
    }
}
