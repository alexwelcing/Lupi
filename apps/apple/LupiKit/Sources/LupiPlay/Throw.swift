import Foundation
import LupiChem

/// The throw's numbers (plan §3.5). Values marked est. are starting points to
/// tune on the device.
public enum ThrowTuning {
    /// Release velocity is the least-squares slope over this window before release, seconds.
    public static let window = 0.1
    public static let minSamples = 3
    /// A release this long after the last sample is a held release: the body is set down, not thrown.
    /// The web's `flickPauseMs`; samples come once per frame while held, so only a stall trips it.
    public static let pause = 0.06
    /// Forward boost along the camera's view per pt/s of upward screen speed, m/s:
    /// a 2,000 pt/s flick throws about 5 m/s into the room (est.).
    public static let flickGain = 0.0025
    /// The total is capped here, m/s (plan §3.5, §10 tunnelling risk).
    public static let maxSpeed = 8.0
    /// Spin per m/s of sideways release speed, rad/s.
    public static let sidewaysSpin = 2.0
    /// Spin from the grab offset: this share of the spin that would carry the grab point
    /// along with the hand's sideways motion about the centre of mass (est.).
    public static let leverSpinGain = 0.5
    /// Lever arms shorter than this count as this long, metres (est.), so a grab
    /// near the centre never spins wildly.
    public static let minLever = 0.02
    /// Spin from the drag's curl: this share of the rate the hand's direction turns (est.).
    public static let curlGain = 0.5
    /// Below this hand speed the drag has no direction to curl, m/s (est.).
    public static let curlMinSpeed = 0.2
    /// Spin is capped here: 3 rev/s, the web's `maxOmega`.
    public static let maxSpin = 6 * Double.pi
    /// Samples older than this are dropped while holding, seconds.
    static let history = 0.5
}

/// One frame of a held body: where the touch ray meets the grab depth, in
/// world metres, and the touch itself, in points with y down (UIKit).
public struct HandSample: Sendable, Equatable {
    /// Seconds, from the frame or touch timestamp (never the time of handling).
    public var time: Double
    public var world: Vec3
    public var screen: SIMD2<Double>

    public init(time: Double, world: Vec3, screen: SIMD2<Double>) {
        self.time = time
        self.world = world
        self.screen = screen
    }
}

/// The camera at release: unit vectors in world space.
public struct ThrowView: Sendable, Equatable {
    /// Where the camera looks (RealityKit's camera −z).
    public var forward: Vec3
    /// The screen's right (camera +x).
    public var right: Vec3

    public init(forward: Vec3, right: Vec3) {
        self.forward = forward.normalized
        self.right = right.normalized
    }
}

/// What the body receives on release: once, as an impulse (plan §3.5 step 4).
public struct ThrowRelease: Sendable, Equatable {
    /// m/s, after the caps and the comfort level.
    public var linear: Vec3
    /// rad/s, world axes.
    public var angular: Vec3
    /// The hand's own least-squares velocity, m/s, phone motion included.
    public var hand: Vec3
    /// The flick's forward boost, m/s, before the caps.
    public var flick: Vec3
    /// True when the release came after a pause, so the body is set down.
    public var held: Bool

    public static let setDown = ThrowRelease(linear: .zero, angular: .zero, hand: .zero, flick: .zero, held: true)

    /// N·s for `applyLinearImpulse`.
    public func linearImpulse(mass: Double) -> Vec3 { linear * mass }
}

/// The release-velocity estimator: least squares over the last 100 ms of the
/// grab point's world motion (which already includes the phone's), plus a
/// forward flick boost, capped; spin from the sideways speed, the grab offset
/// and the drag's curl. The web's `packages/ui/src/camera/releaseVelocity.ts`
/// is the reference for the windowed slope.
public struct ThrowEstimator: Sendable, Equatable {
    public private(set) var samples: [HandSample] = []

    public init() {}

    /// Feed one sample per frame while the body is held. A sample older than
    /// the last is dropped; equal times are kept (a burst carries no slope).
    public mutating func add(_ sample: HandSample) {
        guard sample.time.isFinite else { return }
        if let last = samples.last, sample.time < last.time { return }
        samples.append(sample)
        let horizon = sample.time - ThrowTuning.history
        if let keep = samples.firstIndex(where: { $0.time >= horizon }), keep > 0 {
            samples.removeFirst(keep)
        }
    }

    public mutating func reset() { samples.removeAll() }

    /// The throw for a release at `time` (seconds). `grabOffset` is the grab
    /// point minus the body's centre of mass, world metres.
    public func release(
        at time: Double, view: ThrowView, grabOffset: Vec3 = .zero, comfort: MotionComfort = .standard
    ) -> ThrowRelease {
        guard let last = samples.last, time - last.time <= ThrowTuning.pause else { return .setDown }
        let window = samples.filter { $0.time >= time - ThrowTuning.window }
        guard window.count >= ThrowTuning.minSamples,
              let hand = Self.slope(window.map(\.time), window.map(\.world)),
              let screen = Self.slope(window.map(\.time), window.map { Vec3($0.screen.x, $0.screen.y, 0) })
        else { return .setDown }

        let upward = max(0, -screen.y)
        let flick = view.forward * (ThrowTuning.flickGain * upward)
        var linear = hand + flick
        let cap = min(ThrowTuning.maxSpeed, comfort.throwSpeedCap)
        let speed = linear.length
        if speed > cap { linear *= cap / speed }

        // The near face rolls on the hand: ω = n × v with n the view direction, from the sideways speed alone.
        let sideways = linear.dot(view.right)
        var angular = view.forward.cross(view.right) * (ThrowTuning.sidewaysSpin * sideways)
        // A grab off the centre is a lever: the hand's motion across it turns the body.
        let lever2 = max(grabOffset.lengthSquared, ThrowTuning.minLever * ThrowTuning.minLever)
        angular += grabOffset.cross(hand) * (ThrowTuning.leverSpinGain / lever2)
        // A curving drag turns the body with it, at the rate the hand's direction turns.
        let handSpeed2 = hand.lengthSquared
        if handSpeed2 >= ThrowTuning.curlMinSpeed * ThrowTuning.curlMinSpeed,
           let accel = Self.acceleration(window.map(\.time), window.map(\.world)) {
            angular += hand.cross(accel) * (ThrowTuning.curlGain / handSpeed2)
        }
        angular *= comfort.spinScale
        let spin = angular.length
        if spin > ThrowTuning.maxSpin { angular *= ThrowTuning.maxSpin / spin }
        guard linear.x.isFinite, linear.y.isFinite, linear.z.isFinite,
              angular.x.isFinite, angular.y.isFinite, angular.z.isFinite
        else { return .setDown }
        return ThrowRelease(linear: linear, angular: angular, hand: hand, flick: flick, held: false)
    }

    /// Least-squares slope of `values` against `times`, per axis. Nil when
    /// every sample shares one instant.
    static func slope(_ times: [Double], _ values: [Vec3]) -> Vec3? {
        let n = Double(times.count)
        guard n >= 2 else { return nil }
        let mt = times.reduce(0, +) / n
        let mv = values.reduce(Vec3.zero, +) / n
        var stt = 0.0
        var stv = Vec3.zero
        for (t, v) in zip(times, values) {
            let dt = t - mt
            stt += dt * dt
            stv += (v - mv) * dt
        }
        guard stt > 1e-12 else { return nil }
        return stv / stt
    }

    /// Second derivative of the least-squares parabola through the samples,
    /// per axis. Nil with fewer than three distinct instants.
    static func acceleration(_ times: [Double], _ values: [Vec3]) -> Vec3? {
        let n = Double(times.count)
        guard n >= 3 else { return nil }
        let mt = times.reduce(0, +) / n
        var s2 = 0.0, s3 = 0.0, s4 = 0.0
        var y0 = Vec3.zero, y1 = Vec3.zero, y2 = Vec3.zero
        for (t, v) in zip(times, values) {
            let u = t - mt
            let u2 = u * u
            s2 += u2
            s3 += u2 * u
            s4 += u2 * u2
            y0 += v
            y1 += v * u
            y2 += v * u2
        }
        // Normal equations [n 0 s2; 0 s2 s3; s2 s3 s4] (c0 c1 c2) = (y0 y1 y2); Σu = 0.
        let det = n * (s2 * s4 - s3 * s3) - s2 * s2 * s2
        guard abs(det) > 1e-18 * max(1, n * s4 * s2) else { return nil }
        let c2 = (n * (s2 * y2 - s3 * y1) - s2 * s2 * y0) / det
        return c2 * 2
    }
}
