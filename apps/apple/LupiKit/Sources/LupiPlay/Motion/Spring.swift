import Foundation
import LupiChem

/// The two dials of a damped spring, as the web's motion tokens
/// (`packages/core/src/motion/tokens.ts`): `smoothTime`, roughly the time to
/// reach the target (ω = 2 / smoothTime), and `dampingRatio` (1 is critical,
/// below 1 overshoots).
public struct MotionToken: Sendable, Hashable, Codable {
    public var smoothTime: Double
    public var dampingRatio: Double

    public init(smoothTime: Double, dampingRatio: Double) {
        self.smoothTime = smoothTime
        self.dampingRatio = dampingRatio
    }

    /// Hold-follow and hit-stop catch-up (plan §3.5, §5.4).
    public static let snap = MotionToken(smoothTime: 0.05, dampingRatio: 1)
    /// A loose atom gliding to a magnet zone (plan §4.5).
    public static let glide = MotionToken(smoothTime: 0.12, dampingRatio: 1)
    /// ≈4.6 % overshoot: a detent clicking home, a new bond growing.
    public static let click = MotionToken(smoothTime: 0.09, dampingRatio: 0.7)
    /// ≈2.8 % overshoot: a spawn dropping in.
    public static let land = MotionToken(smoothTime: 0.125, dampingRatio: 0.75)
    /// Squash recovery, with a wobble.
    public static let boing = MotionToken(smoothTime: 0.12, dampingRatio: 0.45)
    public static let settle = MotionToken(smoothTime: 0.2, dampingRatio: 1)
    public static let float = MotionToken(smoothTime: 0.35, dampingRatio: 0.8)

    /// No glide lasts longer than this, seconds.
    public static let glideMax = 0.8

    var omega: Double { 2 / max(0.0001, smoothTime) }
    var isCritical: Bool { abs(dampingRatio - 1) < 1e-4 }

    /// The exact step's 2×2 map over `dt` seconds, ported from math's
    /// `spring-core.js`: displacement' = pp·d + pv·v, velocity' = vp·d + vv·v.
    func coefficients(_ dt: Double) -> (pp: Double, pv: Double, vp: Double, vv: Double) {
        let omega = omega
        let zeta = dampingRatio
        if isCritical {
            let e = exp(-omega * dt)
            return (e * (1 + omega * dt), e * dt, -e * omega * omega * dt, e * (1 - omega * dt))
        }
        if zeta < 1 {
            let za = -omega * zeta
            let wd = omega * (1 - zeta * zeta).squareRoot()
            let e = exp(za * dt)
            let c = cos(wd * dt)
            let s = sin(wd * dt)
            return (e * (c - za * s / wd), e * s / wd, -e * omega * omega * s / wd, e * (c + za * s / wd))
        }
        let za = -omega * zeta
        let zb = omega * (zeta * zeta - 1).squareRoot()
        let r1 = za - zb
        let r2 = za + zb
        let den = r1 - r2
        let e1 = exp(r1 * dt)
        let e2 = exp(r2 * dt)
        return ((r1 * e2 - r2 * e1) / den, (e1 - e2) / den, omega * omega * (e2 - e1) / den, (r1 * e1 - r2 * e2) / den)
    }

    /// The value at `t` seconds of a spring released at rest from 0 toward 1
    /// (the web's `stepResponse`). `t <= 0` is 0.
    public func stepResponse(_ t: Double) -> Double {
        guard t > 0 else { return 0 }
        let omega = omega
        let zeta = dampingRatio
        if isCritical { return 1 - (1 + omega * t) * exp(-omega * t) }
        if zeta < 1 {
            let wd = omega * (1 - zeta * zeta).squareRoot()
            return 1 - exp(-zeta * omega * t) * (cos(wd * t) + zeta * omega / wd * sin(wd * t))
        }
        let za = -omega * zeta
        let zb = omega * (zeta * zeta - 1).squareRoot()
        let r1 = za - zb
        let r2 = za + zb
        return 1 - (r1 * exp(r2 * t) - r2 * exp(r1 * t)) / (r1 - r2)
    }

    /// Seconds until a unit step stays within `eps` of its target for good
    /// (the web's `settleTime`).
    public func settleTime(eps: Double = 1e-3) -> Double {
        let omega = omega
        let zeta = dampingRatio
        let sigma = isCritical ? omega : zeta < 1 ? zeta * omega : omega * (zeta - (zeta * zeta - 1).squareRoot())
        let horizon = (log(1 / eps) + 8) / max(sigma, 1e-9) + 1 / omega
        let steps = 4096
        let h = horizon / Double(steps)
        var last = 0.0
        for i in 0...steps {
            let t = Double(i) * h
            if abs(1 - stepResponse(t)) >= eps { last = t }
        }
        var lo = last
        var hi = last + h
        for _ in 0..<40 {
            let mid = (lo + hi) / 2
            if abs(1 - stepResponse(mid)) >= eps { lo = mid } else { hi = mid }
        }
        return hi
    }
}

/// What a spring can carry: a scalar or a vector.
public protocol SpringValue: Sendable, Equatable {
    static func + (a: Self, b: Self) -> Self
    static func - (a: Self, b: Self) -> Self
    static func * (a: Self, s: Double) -> Self
    static var zero: Self { get }
}

extension Double: SpringValue {}
extension SIMD3: SpringValue where Scalar == Double {}

/// A damped spring stepped with its exact solution, so it settles at the
/// same wall-clock time at 30, 60 or 120 Hz and is stable at any `dt`.
public struct Spring<Value: SpringValue>: Sendable, Equatable {
    public var value: Value
    public var velocity: Value

    public init(_ value: Value, velocity: Value = .zero) {
        self.value = value
        self.velocity = velocity
    }

    /// Advances toward `target` by `dt` seconds on `token`. A negative or
    /// non-finite `dt` is no time at all.
    public mutating func step(toward target: Value, token: MotionToken, dt: Double) {
        let dt = dt.isFinite && dt > 0 ? dt : 0
        let c = token.coefficients(dt)
        let d = value - target
        let v = velocity
        value = target + d * c.pp + v * c.pv
        velocity = d * c.vp + v * c.vv
    }

    /// Lands at `target` at once, at rest (Still, or a hard reset).
    public mutating func cut(to target: Value) {
        value = target
        velocity = .zero
    }
}

public typealias Spring1 = Spring<Double>
public typealias Spring3 = Spring<Vec3>

extension Spring where Value == Double {
    /// Within `eps` of `target` and slower than `velocityEps` (default eps · 10).
    public func isSettled(at target: Double, eps: Double, velocityEps: Double? = nil) -> Bool {
        abs(value - target) < eps && abs(velocity) < (velocityEps ?? eps * 10)
    }
}

extension Spring where Value == Vec3 {
    public func isSettled(at target: Vec3, eps: Double, velocityEps: Double? = nil) -> Bool {
        (value - target).length < eps && velocity.length < (velocityEps ?? eps * 10)
    }
}
