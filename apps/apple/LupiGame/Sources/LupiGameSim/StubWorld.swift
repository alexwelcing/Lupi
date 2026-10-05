import Foundation
import LupiChem
import LupiGame
import LupiScale

/// A static plane of the room: the floor, a wall.
public struct SimPlane: Sendable, Equatable {
    public var point: Vec3
    /// Unit, pointing into the room.
    public var normal: Vec3

    public init(point: Vec3, normal: Vec3) {
        self.point = point
        self.normal = normal.normalized
    }
}

/// One body in the stand-in engine.
public struct SimBody: Sendable {
    public var pose: RigidD
    public var linearVelocity: Vec3 = .zero
    public var angularVelocity: Vec3 = .zero
    public var spec: PhysicsSpec
    public var mode: MotionMode
    public var parked = false
    public var linearDamping: Double
    public var angularDamping: Double
    /// Asleep, as engines put resting bodies to sleep: no integration until something touches it.
    public var asleep = false
    var stillFor = 0.0

    /// Contact points in the entity frame with their radii: spheres, and a box's or hull's corners.
    var points: [(Vec3, Double)]
    /// A bounding sphere in the entity frame, for body against body.
    var bound: (Vec3, Double)

    init(pose: RigidD, spec: PhysicsSpec) {
        self.pose = pose
        self.spec = spec
        mode = spec.mode
        linearDamping = spec.linearDamping
        angularDamping = spec.angularDamping
        points = []
        bound = (.zero, 0)
        refresh()
    }

    mutating func refresh() {
        points = []
        for s in spec.shapes {
            switch s {
            case let .sphere(c, r):
                points.append((c, r))
            case let .box(c, h, q):
                for k in 0..<8 {
                    let corner = Vec3(k & 1 == 0 ? -h.x : h.x, k & 2 == 0 ? -h.y : h.y, k & 4 == 0 ? -h.z : h.z)
                    points.append((c + q.act(corner), 0))
                }
            case let .convex(ps):
                points += ps.map { ($0, 0) }
            }
        }
        var lo = Vec3(repeating: .infinity), hi = Vec3(repeating: -.infinity)
        for (p, r) in points {
            lo = Vec3(min(lo.x, p.x - r), min(lo.y, p.y - r), min(lo.z, p.z - r))
            hi = Vec3(max(hi.x, p.x + r), max(hi.y, p.y + r), max(hi.z, p.z + r))
        }
        bound = points.isEmpty ? (.zero, 0) : ((lo + hi) / 2, ((hi - lo) / 2).length)
    }

    var inverseMass: Double { mode == .dynamic && spec.massKg > 0 ? 1 / spec.massKg : 0 }

    var centreOfMass: Vec3 { pose.apply(spec.centreOfMass) }

    /// I⁻¹ in world axes applied to a vector.
    func inverseInertia(_ v: Vec3) -> Vec3 {
        guard mode == .dynamic else { return .zero }
        let r = Quat.compose(pose.rotation, spec.principalRotation)
        let local = r.inverted.act(v)
        let m = spec.principalMoments
        return r.act(Vec3(m.x > 0 ? local.x / m.x : 0, m.y > 0 ? local.y / m.y : 0, m.z > 0 ? local.z / m.z : 0))
    }
}

/// A deterministic stand-in for RealityKit's physics, good enough to test the session's logic:
/// gravity, damping, impulses, a floor and walls, and bodies against each other by bounding
/// spheres. Contact reports mimic `CollisionEvents`: `began` on the first frame of a touch,
/// `updated` while it lasts, with the frame's largest impulse.
public struct StubWorld: Sendable {
    public var gravity = Vec3(0, -9.81, 0)
    public var planes: [SimPlane]
    public var substep = 1.0 / 240
    public private(set) var bodies: [BodyID: SimBody] = [:]
    public private(set) var commands = 0
    /// The last launch each body received, for the tests.
    public private(set) var launches: [BodyID: PhysicsCommand] = [:]
    var touching: Set<SimKey> = []

    struct SimKey: Hashable, Sendable {
        var a: UInt64
        var b: UInt64
    }

    public init(floorY: Double = 0, walls: [SimPlane] = []) {
        planes = [SimPlane(point: Vec3(0, floorY, 0), normal: Vec3(0, 1, 0))] + walls
    }

    public var floorY: Double { planes[0].point.y }

    public var motions: [BodyID: BodyMotion] {
        bodies.mapValues { BodyMotion(pose: $0.pose, linearVelocity: $0.linearVelocity, angularVelocity: $0.angularVelocity) }
    }

    // MARK: Commands

    public mutating func apply(_ list: [PhysicsCommand]) {
        for c in list {
            commands += 1
            switch c {
            case let .create(id, spec, pose):
                bodies[id] = SimBody(pose: pose, spec: spec)
            case let .update(id, spec):
                guard var b = bodies[id] else { continue }
                b.spec = spec
                b.mode = spec.mode
                b.linearDamping = spec.linearDamping
                b.angularDamping = spec.angularDamping
                b.refresh()
                bodies[id] = b
            case let .setMode(id, mode):
                guard var b = bodies[id] else { continue }
                if b.mode != mode {
                    b.asleep = false
                    b.linearVelocity = .zero
                    b.angularVelocity = .zero
                }
                b.mode = mode
                b.spec.mode = mode
                bodies[id] = b
            case let .move(id, pose, v, w):
                bodies[id]?.asleep = false
                bodies[id]?.pose = pose
                bodies[id]?.linearVelocity = v
                bodies[id]?.angularVelocity = w
            case let .launch(id, l, a):
                launches[id] = c
                guard var b = bodies[id] else { continue }
                b.asleep = false
                b.mode = .dynamic
                b.linearVelocity += l * b.inverseMass
                b.angularVelocity += b.inverseInertia(a)
                bodies[id] = b
            case let .setVelocity(id, l, a):
                bodies[id]?.asleep = false
                bodies[id]?.linearVelocity = l
                bodies[id]?.angularVelocity = a
            case let .setDamping(id, l, a):
                bodies[id]?.linearDamping = l
                bodies[id]?.angularDamping = a
            case let .park(id, parked):
                bodies[id]?.parked = parked
            case let .remove(id, _):
                bodies[id] = nil
            }
        }
    }

    // MARK: Stepping

    /// Advances `dt` seconds and reports the frame's contacts, stamped `time`.
    public mutating func step(_ dt: Double, time: Double) -> [Contact] {
        var reports: [SimKey: Contact] = [:]
        var now: Set<SimKey> = []
        let n = max(1, Int((dt / substep).rounded(.up)))
        let h = dt / Double(n)
        let ids = bodies.keys.sorted()
        for _ in 0..<n {
            for id in ids { integrate(id, h) }
            for id in ids { collidePlanes(id, time: time, reports: &reports, now: &now) }
            for i in ids.indices {
                for j in ids.indices where j > i { collideBodies(ids[i], ids[j], time: time, reports: &reports, now: &now) }
            }
        }
        var out: [Contact] = []
        for key in reports.keys.sorted(by: { ($0.a, $0.b) < ($1.a, $1.b) }) {
            var c = reports[key]!
            c.phase = touching.contains(key) ? .updated : .began
            out.append(c)
        }
        touching = now
        return out
    }

    mutating func integrate(_ id: BodyID, _ h: Double) {
        guard var b = bodies[id], b.mode == .dynamic, !b.parked, !b.asleep else { return }
        b.linearVelocity += gravity * h
        b.linearVelocity *= max(0, 1 - b.linearDamping * h)
        b.angularVelocity *= max(0, 1 - b.angularDamping * h)
        b.pose.translation += b.linearVelocity * h
        let w = b.angularVelocity
        let spin = Quat(x: w.x, y: w.y, z: w.z, w: 0)
        let dq = Quat.compose(spin, b.pose.rotation)
        let q = b.pose.rotation
        b.pose.rotation = Quat(x: q.x + 0.5 * h * dq.x, y: q.y + 0.5 * h * dq.y, z: q.z + 0.5 * h * dq.z, w: q.w + 0.5 * h * dq.w).normalizedQuat
        bodies[id] = b
    }

    mutating func collidePlanes(_ id: BodyID, time: Double, reports: inout [SimKey: Contact], now: inout Set<SimKey>) {
        guard var b = bodies[id], b.mode == .dynamic, !b.parked, !b.points.isEmpty else { return }
        if b.asleep {
            // A sleeping body still reports its resting contacts, as CollisionEvents.Updated does.
            for k in planes.indices {
                let key = SimKey(a: id.raw, b: UInt64.max - UInt64(k))
                if touching.contains(key) { now.insert(key) }
            }
            return
        }
        for (k, plane) in planes.enumerated() {
            // Sequential impulses at every penetrating point, a few passes, so a flat body rests on
            // its face instead of rocking from corner to corner.
            var contacts: [Vec3] = []
            var depth = 0.0
            for (p, r) in b.points {
                let world = b.pose.apply(p)
                let d = (world - plane.point).dot(plane.normal) - r
                if d < 0 {
                    contacts.append(world - plane.normal * r)
                    depth = min(depth, d)
                }
            }
            guard !contacts.isEmpty else { continue }
            let key = SimKey(a: id.raw, b: UInt64.max - UInt64(k))
            now.insert(key)
            let n = plane.normal
            b.pose.translation += n * -depth
            var point = Vec3.zero
            for c in contacts { point += c }
            point /= Double(contacts.count)
            let com = b.centreOfMass
            let approach = (b.linearVelocity + b.angularVelocity.cross(point - com)).dot(n)
            let e = approach < -0.5 ? b.spec.material.restitution : 0
            var total = 0.0
            for pass in 0..<4 {
                for c in contacts {
                    let arm = c - com
                    let vn = (b.linearVelocity + b.angularVelocity.cross(arm)).dot(n)
                    guard vn < 0 else { continue }
                    let k2 = b.inverseMass + n.dot(b.inverseInertia(arm.cross(n)).cross(arm))
                    let j = -(1 + (pass == 0 ? e : 0)) * vn / max(k2, 1e-9)
                    total += j
                    b.linearVelocity += n * (j * b.inverseMass)
                    b.angularVelocity += b.inverseInertia(arm.cross(n * j))
                    // Coulomb friction on what is left of the sliding at this point.
                    let after = b.linearVelocity + b.angularVelocity.cross(arm)
                    let vt = after - n * after.dot(n)
                    let slide = vt.length
                    if slide > 1e-9 {
                        let t = vt / slide
                        let kt = b.inverseMass + t.dot(b.inverseInertia(arm.cross(t)).cross(arm))
                        let jt = min(b.spec.material.dynamicFriction * j, slide / max(kt, 1e-9))
                        b.linearVelocity += t * (-jt * b.inverseMass)
                        b.angularVelocity += b.inverseInertia(arm.cross(t * -jt))
                    }
                }
            }
            let j = total
            // Rolling resistance while touching, then sleep once still for 0.3 s, so the stand-in
            // comes to rest as a real engine's bodies do.
            b.angularVelocity *= max(0, 1 - 6 * substep)
            if b.linearVelocity.length < 0.06 && b.angularVelocity.length < 2.5 {
                b.stillFor += substep
                if b.stillFor > 0.3 {
                    b.asleep = true
                    b.linearVelocity = .zero
                    b.angularVelocity = .zero
                }
            } else {
                b.stillFor = 0
            }
            record(&reports, key, Contact(a: id, b: nil, phase: .began, impulse: j, direction: n, position: point, time: time))
        }
        bodies[id] = b
    }

    mutating func collideBodies(_ x: BodyID, _ y: BodyID, time: Double, reports: inout [SimKey: Contact], now: inout Set<SimKey>) {
        guard var a = bodies[x], var b = bodies[y], !a.parked, !b.parked, a.bound.1 > 0, b.bound.1 > 0 else { return }
        guard a.mode == .dynamic || b.mode == .dynamic else { return }
        let ca = a.pose.apply(a.bound.0), cb = b.pose.apply(b.bound.0)
        let d = cb - ca
        let dist = d.length
        let overlap = a.bound.1 + b.bound.1 - dist
        guard overlap > 0 else { return }
        let key = SimKey(a: x.raw, b: y.raw)
        now.insert(key)
        let n = dist > 1e-9 ? d / dist : Vec3(0, 1, 0)
        let ia = a.inverseMass, ib = b.inverseMass
        let sum = ia + ib
        guard sum > 0 else { return }
        a.pose.translation -= n * (overlap * ia / sum)
        b.pose.translation += n * (overlap * ib / sum)
        let vn = (b.linearVelocity - a.linearVelocity).dot(n)
        var j = 0.0
        if vn < 0 {
            a.asleep = false
            b.asleep = false
            let e = vn < -0.2 ? min(a.spec.material.restitution, b.spec.material.restitution) : 0
            j = -(1 + e) * vn / sum
            a.linearVelocity -= n * (j * ia)
            b.linearVelocity += n * (j * ib)
        }
        bodies[x] = a
        bodies[y] = b
        record(&reports, key, Contact(a: x, b: y, phase: .began, impulse: j, direction: n, position: ca + n * (a.bound.1 - overlap / 2), time: time))
    }

    func record(_ reports: inout [SimKey: Contact], _ key: SimKey, _ c: Contact) {
        if let old = reports[key], old.impulse >= c.impulse { return }
        reports[key] = c
    }
}
