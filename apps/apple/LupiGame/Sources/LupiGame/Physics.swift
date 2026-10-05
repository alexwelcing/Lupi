import Foundation
import LupiChem
import LupiScale
import LupiScaleCore
import LupiPlay

/// Every record the session has seen, shared by one resolver for the whole session, so its
/// caches (aggregates, proxies, materializations) live across frames. Records are immutable
/// and content-addressed, so adding one never invalidates a cached value.
public final class GameStore: NodeStore, @unchecked Sendable {
    private let lock = NSLock()
    private var records: [NodeID: NodeRecord] = [:]

    public init(_ records: [NodeRecord] = []) { add(records) }

    public func add(_ more: [NodeRecord]) {
        lock.lock()
        for r in more { records[r.id] = r }
        lock.unlock()
    }

    public func record(_ id: NodeID) throws -> NodeRecord {
        lock.lock()
        defer { lock.unlock() }
        guard let r = records[id] else { throw ScaleError(.missing, "node \(id.hex.prefix(16))…") }
        return r
    }

    public var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return records.count
    }
}

/// A body in play. Stable for its life; never reused within a session.
public struct BodyID: Hashable, Comparable, Sendable, CustomStringConvertible {
    public let raw: UInt64
    public init(_ raw: UInt64) { self.raw = raw }
    public static func < (a: BodyID, b: BodyID) -> Bool { a.raw < b.raw }
    public var description: String { "#\(raw)" }
}

/// RealityKit's `PhysicsBodyMode`.
public enum MotionMode: Sendable, Equatable {
    case dynamic, kinematic, `static`
}

/// What `PhysicsMaterialResource.generate(staticFriction:dynamicFriction:restitution:)` takes.
public struct SurfaceMaterial: Sendable, Equatable {
    public var staticFriction: Double
    public var dynamicFriction: Double
    public var restitution: Double
}

/// Everything the app needs to build a body's `PhysicsBodyComponent` and `CollisionComponent`.
/// Lengths in metres in the body entity's frame, whose origin is the node's local centre c(X)
/// (scale-spec §8.5, §10.4).
public struct PhysicsSpec: Sendable, Equatable {
    public var mode: MotionMode
    public var massKg: Double
    /// Principal moments, kg·m² (scale-spec §10.3).
    public var principalMoments: Vec3
    /// Entity frame ← principal axes.
    public var principalRotation: Quat
    public var centreOfMass: Vec3
    public var material: SurfaceMaterial
    public var linearDamping: Double
    public var angularDamping: Double
    /// Empty means no collider (terrain while the camera is inside it).
    public var shapes: [CollisionShape]
    /// For everything thrown (plan §3.4).
    public var continuousCollision: Bool
}

/// A body's motion as the physics engine reports it each frame.
public struct BodyMotion: Sendable, Equatable {
    /// World from the body entity.
    public var pose: RigidD
    public var linearVelocity: Vec3
    public var angularVelocity: Vec3

    public init(pose: RigidD, linearVelocity: Vec3 = .zero, angularVelocity: Vec3 = .zero) {
        self.pose = pose
        self.linearVelocity = linearVelocity
        self.angularVelocity = angularVelocity
    }
}

/// One collision report (`CollisionEvents.Began` or `.Updated`, plan §4.4).
public struct PlayContact: Sendable, Equatable {
    public enum Phase: Sendable, Equatable { case began, updated }

    /// Nil is the room: the scene-understanding mesh or a plane.
    public var a: BodyID?
    public var b: BodyID?
    public var phase: Phase
    /// N·s.
    public var impulse: Double
    /// The impulse's direction, world (unit, or zero when unknown).
    public var direction: Vec3
    /// World contact point.
    public var position: Vec3
    public var time: Double

    public init(a: BodyID?, b: BodyID?, phase: Phase, impulse: Double, direction: Vec3, position: Vec3, time: Double) {
        self.a = a
        self.b = b
        self.phase = phase
        self.impulse = impulse
        self.direction = direction
        self.position = position
        self.time = time
    }
}

/// What the session asks of the physics engine, in order.
public enum PhysicsCommand: Sendable, Equatable {
    /// A new body entity at `pose`, at rest.
    case create(BodyID, PhysicsSpec, pose: RigidD)
    /// New shapes, mass or material for an existing body (pinch, growth, inset expiry).
    case update(BodyID, PhysicsSpec)
    case setMode(BodyID, MotionMode)
    /// A kinematic body's pose this frame, and the velocity it moves at (so it pushes what it meets).
    case move(BodyID, pose: RigidD, linearVelocity: Vec3, angularVelocity: Vec3)
    /// Becomes dynamic at rest, then receives these impulses once (plan §3.5 step 4):
    /// `applyLinearImpulse` (N·s) and `applyAngularImpulse` (N·m·s), world axes.
    case launch(BodyID, linearImpulse: Vec3, angularImpulse: Vec3)
    /// A fresh piece of a break: dynamic, at this velocity from its first frame.
    case setVelocity(BodyID, linear: Vec3, angular: Vec3)
    case setDamping(BodyID, linear: Double, angular: Double)
    /// Frozen and hidden outside the simulation (toys while the camera is inside terrain, §10.1).
    case park(BodyID, Bool)
    /// Gone; `poof` plays the small vanish (out of bounds, over budget).
    case remove(BodyID, poof: Bool)
}

/// The tuning table of the session's physics (plan §3.3, §3.4, §4.4, §4.6). Values marked est.
public enum PlayTuning {
    /// At most this many dynamic bodies; beyond, the oldest loose fragment poofs (plan §3.4, est.).
    public static let maxDynamicBodies = 40
    /// Out of bounds: this far below the floor, or this far from the camera (plan §3.3).
    public static let fallBelowFloor = 0.5
    public static let rescueRadius = 6.0
    /// Rest damping (plan §4.6).
    public static let restSpeed = 0.03
    public static let restSpin = 0.3
    public static let restHold = 0.25
    public static let restLinearDamping = 2.0
    public static let restAngularDamping = 4.0
    public static let wakeImpulse = 0.05
    /// Touching something within this window (s) counts as in contact.
    public static let contactMemory = 0.1
    /// The largest impulse within this window after first contact decides a hit (plan §4.4).
    public static let impactWindow = 0.05
    /// A first report this hard fires its juice at once, without waiting for the window (est.).
    public static let immediateImpact = 1.0
    /// Fresh pieces use inset proxies this long (scale-spec §10.4).
    public static let insetTime = 0.25
    /// A piece under 6 cm grows to it over this long (scale-spec §10.6).
    public static let growTime = 0.2
    /// Spawns appear this far ahead of the camera and this far below its line (est.).
    public static let spawnDistance = 0.4
    public static let spawnDrop = 0.08
    /// A spawn floats while it pops in, then falls (est.).
    public static let spawnFloat = 0.3
    /// Its first fall onto the desk never breaks it, however brittle (est.).
    public static let spawnGrace = 1.5
    /// A release slower than this sets the body down: samples come every frame, so a still finger
    /// gives a near-zero throw rather than LupiKit's pause (est.).
    public static let setDownSpeed = 0.25
    /// The grab lifts the body this much (plan §5.3).
    public static let grabLift = 0.01
    /// Dynamic friction as a share of static: LupiKit's table has one friction (est.).
    public static let dynamicFrictionShare = 0.75
    /// Shapes are rebuilt at most this often during a pinch (est.).
    public static let pinchShapeInterval = 0.1
}

extension Mat3 {
    func scaledMat(_ s: Double) -> Mat3 { Mat3(columns: c0 * s, c1 * s, c2 * s) }
}

/// The impulses that give a body at rest `linear` (m/s) and `angular` (rad/s): `m v` and the
/// world inertia tensor times ω, with the tensor from principal moments and axes.
public func launchImpulses(spec: PhysicsSpec, entityRotation: Quat, linear: Vec3, angular: Vec3) -> (linear: Vec3, angular: Vec3) {
    let r = Quat.compose(entityRotation, spec.principalRotation).rotationMatrix
    let local = r.transposed * angular
    let l = Vec3(spec.principalMoments.x * local.x, spec.principalMoments.y * local.y, spec.principalMoments.z * local.z)
    return (linear * spec.massKg, r * l)
}
