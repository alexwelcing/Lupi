import Foundation

/// One touch as UIKit reports it: points, y down, timestamps in seconds.
public struct TouchSample: Sendable, Equatable {
    public enum Phase: Sendable, Equatable { case began, moved, ended, cancelled }

    public var id: Int
    public var phase: Phase
    public var location: SIMD2<Double>
    public var time: Double

    public init(id: Int, phase: Phase, location: SIMD2<Double>, time: Double) {
        self.id = id
        self.phase = phase
        self.location = location
        self.time = time
    }
}

/// What a finger landed on (scale-spec §10.5).
public enum TouchTarget: Sendable, Equatable {
    case none
    case toy(BodyID)
    case monument(BodyID)
    case terrain(BodyID)

    public var body: BodyID? {
        switch self {
        case .none: nil
        case let .toy(b), let .monument(b), let .terrain(b): b
        }
    }
}

/// Exactly one of these per touch sequence (scale-spec §10.5).
public enum PlayGesture: Sendable, Equatable {
    case tap(TouchTarget, SIMD2<Double>)
    /// A toy, grabbed whole where the finger came down.
    case grabBegan(BodyID, SIMD2<Double>)
    case grabMoved(SIMD2<Double>)
    case grabEnded(SIMD2<Double>, cancelled: Bool)
    /// Detach the deepest node in the hand band under the finger of a monument or terrain.
    case chunk(BodyID, SIMD2<Double>)
    /// Detach the node in the chip band under the finger.
    case chip(BodyID, SIMD2<Double>)
    /// Two fingers: `held` is the body a grab already holds, `target` what the first finger touched.
    case pinchBegan(centroid: SIMD2<Double>, held: BodyID?, target: TouchTarget)
    /// `ratio` multiplies the size since the last change; `twist` turns it, radians, clockwise on screen.
    case pinchChanged(centroid: SIMD2<Double>, ratio: Double, twist: Double)
    case pinchEnded
    /// +1 toward smaller things (the last pinch spread), −1 toward larger.
    case flyBegan(direction: Double)
    case flyEnded
}

/// The gesture arbiter of scale-spec §10.5: touches in, exactly one gesture out. Thresholds are
/// the spec's starting values. The spec gives the arbiter to LupiKit's `LupiPlay`; it lives here
/// until that lane lands one, with the same rules.
public struct GestureArbiter: Sendable {
    public struct Tuning: Sendable, Equatable {
        public var tapTime = 0.25
        public var slop = 8.0
        public var grabHold = 0.12
        public var chunkTime = 0.4
        public var chipHold = 0.4
        public var pinchSlop = 12.0
        public var pinchShare = 0.06
        public var flyHold = 0.3
        public var flySlop = 12.0

        public init() {}
    }

    struct Finger: Sendable, Equatable {
        var id: Int
        var down: SIMD2<Double>
        var downTime: Double
        var now: SIMD2<Double>
        var moved = false
    }

    enum State: Sendable, Equatable {
        case idle
        case pending(Finger, TouchTarget, chipArmed: Bool)
        case grabbing(Finger, BodyID)
        case twoPending(Finger, Finger, TouchTarget, since: Double, sep0: Double, centroid0: SIMD2<Double>)
        case pinching(Finger, Finger, lastSep: Double, lastAngle: Double, held: BodyID?)
        case flying(Finger, Finger, sep0: Double)
        /// A gesture ended or was refused; ignore the fingers still down until all lift.
        case done(Set<Int>)
    }

    public var tuning = Tuning()
    /// Set by the session each frame: flight needs |λ| > 32 (scale-spec §8.8).
    public var flyAllowed = false
    var state: State = .idle
    var lastPinchDirection = 1.0

    public init() {}

    public var isIdle: Bool { state == .idle }

    /// The body a grab holds now.
    public var grabbed: BodyID? {
        switch state {
        case let .grabbing(_, b): b
        case let .pinching(_, _, _, _, held): held
        default: nil
        }
    }

    /// The held body became another (a snap merged it, plan §4.5): the fingers keep holding.
    public mutating func retarget(_ old: BodyID, to new: BodyID) {
        switch state {
        case let .grabbing(f, b) where b == old:
            state = .grabbing(f, new)
        case let .pinching(f1, f2, sep, angle, held) where held == old:
            state = .pinching(f1, f2, lastSep: sep, lastAngle: angle, held: new)
        default:
            break
        }
    }

    // MARK: Touches

    public mutating func handle(_ t: TouchSample, target: TouchTarget) -> [PlayGesture] {
        var out = tick(t.time)
        switch t.phase {
        case .began: out += began(t, target)
        case .moved: out += moved(t)
        case .ended: out += ended(t, cancelled: false)
        case .cancelled: out += ended(t, cancelled: true)
        }
        return out
    }

    mutating func began(_ t: TouchSample, _ target: TouchTarget) -> [PlayGesture] {
        let f = Finger(id: t.id, down: t.location, downTime: t.time, now: t.location)
        switch state {
        case .idle:
            state = .pending(f, target, chipArmed: false)
            return []
        case let .pending(first, firstTarget, _):
            let sep = (first.now - f.now).length
            state = .twoPending(first, f, firstTarget, since: t.time, sep0: sep, centroid0: (first.now + f.now) / 2)
            return []
        case let .grabbing(first, body):
            // A second finger during a grab scales and turns the held body, which stays held.
            state = .pinching(first, f, lastSep: (first.now - f.now).length, lastAngle: Self.angle(first.now, f.now), held: body)
            return [.pinchBegan(centroid: (first.now + f.now) / 2, held: body, target: .toy(body))]
        case var .done(ids):
            ids.insert(t.id)
            state = .done(ids)
            return []
        case .twoPending, .pinching, .flying:
            // A third finger is ignored.
            return []
        }
    }

    mutating func moved(_ t: TouchSample) -> [PlayGesture] {
        switch state {
        case .pending(var f, let target, let armed):
            guard f.id == t.id else { return [] }
            f.now = t.location
            let far = (f.now - f.down).length >= tuning.slop
            switch target {
            case let .toy(b):
                if far {
                    state = .grabbing(f, b)
                    return [.grabBegan(b, f.down), .grabMoved(f.now)]
                }
            case let .monument(b), let .terrain(b):
                if far {
                    state = .done([f.id])
                    if armed { return [.chip(b, f.down)] }
                    if t.time - f.downTime <= tuning.chunkTime { return [.chunk(b, f.down)] }
                    return []
                }
            case .none:
                if far {
                    state = .done([f.id])
                    return []
                }
            }
            state = .pending(f, target, chipArmed: armed)
            return []
        case .grabbing(var f, let b):
            guard f.id == t.id else { return [] }
            f.now = t.location
            state = .grabbing(f, b)
            return [.grabMoved(f.now)]
        case .twoPending(var a, var b, let target, let since, let sep0, let c0):
            guard update(&a, &b, t) else { return [] }
            let sep = (a.now - b.now).length
            // 12 pt, or 6 % of the separation, whichever comes first.
            if abs(sep - sep0) >= min(tuning.pinchSlop, tuning.pinchShare * max(sep0, 1)) {
                lastPinchDirection = sep >= sep0 ? 1 : -1
                state = .pinching(a, b, lastSep: sep, lastAngle: Self.angle(a.now, b.now), held: nil)
                let centroid = (a.now + b.now) / 2
                let twist = Self.wrap(Self.angle(a.now, b.now) - Self.angle(a.down, b.down))
                return [
                    .pinchBegan(centroid: centroid, held: nil, target: target),
                    .pinchChanged(centroid: centroid, ratio: sep0 > 0 ? sep / sep0 : 1, twist: twist),
                ]
            }
            state = .twoPending(a, b, target, since: since, sep0: sep0, centroid0: c0)
            return []
        case .pinching(var a, var b, let lastSep, let lastAngle, let held):
            guard update(&a, &b, t) else { return [] }
            let sep = (a.now - b.now).length
            let angle = Self.angle(a.now, b.now)
            let ratio = lastSep > 0 && sep > 0 ? sep / lastSep : 1
            if ratio != 1 { lastPinchDirection = ratio > 1 ? 1 : -1 }
            state = .pinching(a, b, lastSep: sep, lastAngle: angle, held: held)
            return [.pinchChanged(centroid: (a.now + b.now) / 2, ratio: ratio, twist: Self.wrap(angle - lastAngle))]
        case .flying(var a, var b, let sep0):
            guard update(&a, &b, t) else { return [] }
            let sep = (a.now - b.now).length
            if abs(sep - sep0) >= tuning.flySlop {
                // A separation change turns a fly back into a pinch.
                state = .pinching(a, b, lastSep: sep, lastAngle: Self.angle(a.now, b.now), held: nil)
                return [.flyEnded, .pinchBegan(centroid: (a.now + b.now) / 2, held: nil, target: .none)]
            }
            state = .flying(a, b, sep0: sep0)
            return []
        case .idle, .done:
            return []
        }
    }

    mutating func ended(_ t: TouchSample, cancelled: Bool) -> [PlayGesture] {
        switch state {
        case let .pending(f, target, _):
            guard f.id == t.id else { return [] }
            state = .idle
            let quick = t.time - f.downTime <= tuning.tapTime && (t.location - f.down).length < tuning.slop
            return quick && !cancelled ? [.tap(target, f.down)] : []
        case let .grabbing(f, _):
            guard f.id == t.id else { return [] }
            state = .idle
            return [.grabEnded(t.location, cancelled: cancelled)]
        case let .twoPending(a, b, target, _, _, _):
            guard a.id == t.id || b.id == t.id else { return [] }
            let other = a.id == t.id ? b : a
            state = .done([other.id])
            _ = target
            return []
        case let .pinching(a, b, _, _, held):
            guard a.id == t.id || b.id == t.id else { return [] }
            let other = a.id == t.id ? b : a
            if let body = held {
                // The held body stays held by the remaining finger.
                state = .grabbing(other, body)
                return [.pinchEnded]
            }
            state = .done([other.id])
            return [.pinchEnded]
        case let .flying(a, b, _):
            guard a.id == t.id || b.id == t.id else { return [] }
            state = .done([a.id == t.id ? b.id : a.id])
            return [.flyEnded]
        case var .done(ids):
            ids.remove(t.id)
            state = ids.isEmpty ? .idle : .done(ids)
            return []
        case .idle:
            return []
        }
    }

    // MARK: Time

    /// Recognitions that need only time: a held toy grabs, a held monument arms a chip, two still
    /// fingers fly.
    public mutating func tick(_ time: Double) -> [PlayGesture] {
        switch state {
        case let .pending(f, target, armed):
            switch target {
            case let .toy(b) where time - f.downTime >= tuning.grabHold:
                state = .grabbing(f, b)
                return [.grabBegan(b, f.down)]
            case .monument, .terrain:
                if !armed && time - f.downTime >= tuning.chipHold { state = .pending(f, target, chipArmed: true) }
            default:
                break
            }
            return []
        case let .twoPending(a, b, _, since, sep0, c0):
            let still = abs((a.now - b.now).length - sep0) < tuning.flySlop && (((a.now + b.now) / 2) - c0).length < tuning.flySlop
            if still && flyAllowed && time - since >= tuning.flyHold {
                state = .flying(a, b, sep0: sep0)
                return [.flyBegan(direction: lastPinchDirection)]
            }
            return []
        default:
            return []
        }
    }

    /// The session turned a chunk or chip into a new body held by the same finger.
    public mutating func adoptGrab(_ body: BodyID, finger id: Int, at location: SIMD2<Double>, time: Double) {
        state = .grabbing(Finger(id: id, down: location, downTime: time, now: location, moved: true), body)
    }

    /// Drops every gesture in progress (the scene went away).
    public mutating func reset() { state = .idle }

    // MARK: Helpers

    func update(_ a: inout Finger, _ b: inout Finger, _ t: TouchSample) -> Bool {
        if a.id == t.id { a.now = t.location; return true }
        if b.id == t.id { b.now = t.location; return true }
        return false
    }

    /// Screen angle of the line a → b, radians, y down (clockwise positive).
    static func angle(_ a: SIMD2<Double>, _ b: SIMD2<Double>) -> Double { atan2(b.y - a.y, b.x - a.x) }

    static func wrap(_ a: Double) -> Double {
        var x = a
        while x > .pi { x -= 2 * .pi }
        while x < -.pi { x += 2 * .pi }
        return x
    }
}

extension SIMD2 where Scalar == Double {
    var length: Double { (x * x + y * y).squareRoot() }
}
