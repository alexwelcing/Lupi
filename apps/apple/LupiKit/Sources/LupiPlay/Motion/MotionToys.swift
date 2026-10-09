import Foundation
import LupiChem

/// A tilt about an axis, radians. The app turns it into its own quaternion.
public struct Lean: Sendable, Equatable {
    /// Unit axis, or zero for no lean.
    public var axis: Vec3
    public var angle: Double

    public static let none = Lean(axis: .zero, angle: 0)

    public var rotation: Quat {
        guard angle != 0, axis.lengthSquared > 0 else { return .identity }
        let half = angle / 2
        let s = sin(half)
        return Quat(x: axis.x * s, y: axis.y * s, z: axis.z * s, w: cos(half))
    }
}

/// A held molecule (plan §3.5 steps 1 and 2): it follows the touch ray's
/// point at the grab depth on the `snap` token, and leans up to 12° toward
/// its motion, so it feels held, not glued.
public struct HoldFollow: Sendable, Equatable {
    /// The grab depth: the camera distance of the hit point, clamped, metres.
    public static let depthRange: ClosedRange<Double> = 0.25...1.5
    public static let maxLean = 12 * Double.pi / 180
    /// Sideways speed (m/s) at which the lean reaches tanh(1) ≈ 76 % of its maximum (est.).
    public static let leanSpeed = 0.5

    public static func grabDepth(hitDistance: Double) -> Double {
        guard hitDistance.isFinite else { return depthRange.upperBound }
        return min(depthRange.upperBound, max(depthRange.lowerBound, hitDistance))
    }

    public var position: Spring3
    /// World up (RealityKit is y-up).
    public var up: Vec3

    public init(at position: Vec3, up: Vec3 = Vec3(0, 1, 0)) {
        self.position = Spring3(position)
        self.up = up.normalized
    }

    /// One frame toward the touch ray's point. The hand moves the body in
    /// every comfort level: it is the player's own motion.
    public mutating func step(toward target: Vec3, dt: Double) {
        position.step(toward: target, token: .snap, dt: dt)
    }

    /// The lean toward the current motion: the body's up tips toward its
    /// sideways velocity. Gentle halves it, Still has none.
    public func lean(comfort: MotionComfort = .standard) -> Lean {
        let v = position.velocity
        let sideways = v - up * v.dot(up)
        let speed = sideways.length
        let angle = Self.maxLean * tanh(speed / Self.leanSpeed) * comfort.squashScale
        guard speed > 1e-9, angle > 0 else { return .none }
        return Lean(axis: up.cross(sideways / speed).normalized, angle: angle)
    }
}

/// Squash on impact (plan §5.4), applied to the render child only: it
/// compresses along the impulse by up to the personality's maximum × I,
/// keeps the volume, and recovers on the `boing` token with a short wobble.
public struct Squash: Sendable, Equatable {
    /// Unit axis of the latest hit.
    public private(set) var axis: Vec3 = Vec3(0, 1, 0)
    /// Compression along `axis`: positive squashes, negative stretches (the wobble).
    public private(set) var amount = Spring1(0)

    /// No squash past this, whatever the table says, so the volume-keeping scale stays sane.
    public static let limit = 0.5

    public init() {}

    /// The squash a hit shows: the personality's maximum × I, halved in Gentle, none in Still.
    public static func amount(intensity: Double, maxSquash: Double, comfort: MotionComfort) -> Double {
        min(limit, max(0, maxSquash * min(1, max(0, intensity)) * comfort.squashScale))
    }

    /// A hit along `direction` (the impulse direction) squashing by `amount`.
    /// A smaller squash than the one still showing is ignored.
    public mutating func hit(direction: Vec3, amount a: Double) {
        let a = min(Self.limit, a)
        guard a > 0, direction.lengthSquared > 0, a >= abs(amount.value) else { return }
        axis = direction.normalized
        amount.cut(to: a)
    }

    public mutating func step(dt: Double) {
        amount.step(toward: 0, token: .boing, dt: dt)
    }

    /// Scale along the axis and across it; along × across² = 1.
    public var scale: (along: Double, across: Double) {
        let along = 1 - min(Self.limit, amount.value)
        return (along, 1 / along.squareRoot())
    }

    public var isAtRest: Bool { amount.isSettled(at: 0, eps: 1e-4) }
}

/// A spawn drops in on the `land` token (plan §5.3): render scale from 0 to 1.
/// A scale animation, so Still cuts to full size (plan §5.5).
public struct PopIn: Sendable, Equatable {
    public private(set) var scale: Spring1

    public init(comfort: MotionComfort) {
        scale = Spring1(comfort.animatesGlides ? 0 : 1)
    }

    public mutating func step(dt: Double) {
        scale.step(toward: 1, token: .land, dt: dt)
    }

    public var isDone: Bool { scale.isSettled(at: 1, eps: 1e-3) }
}

/// Hit-stop for medium hits (plan §5.4): the struck molecule's render child
/// holds its pose for 50 ms while physics runs on, then catches up on the
/// `snap` token. Only the gap springs, so a body in flight is never dragged
/// behind its physics. Standard comfort only.
public struct HitStop: Sendable, Equatable {
    public static let hold = 0.05
    /// Hits at or above this intensity stop.
    public static let threshold = 0.6

    var frozen: Vec3?
    var heldFor = 0.0
    var gap = Spring3(.zero)

    public init() {}

    /// Whether this hit stops, and if so holds the render child at `at`, where it is drawn now.
    @discardableResult
    public mutating func hit(intensity: Double, comfort: MotionComfort, at position: Vec3) -> Bool {
        guard comfort.allowsTimeEffects, intensity >= Self.threshold else { return false }
        frozen = position
        heldFor = 0
        return true
    }

    /// The render position for this frame, given where physics has the body.
    public mutating func step(physics: Vec3, dt: Double) -> Vec3 {
        let dt = dt.isFinite ? max(0, dt) : 0
        if let held = frozen {
            heldFor += dt
            if heldFor < Self.hold { return held }
            frozen = nil
            gap.cut(to: held - physics)
            gap.step(toward: .zero, token: .snap, dt: heldFor - Self.hold)
            return physics + gap.value
        }
        gap.step(toward: .zero, token: .snap, dt: dt)
        return physics + gap.value
    }

    public var isHolding: Bool { frozen != nil }
}
