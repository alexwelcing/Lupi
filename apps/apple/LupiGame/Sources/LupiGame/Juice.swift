import Foundation
import LupiChem
import LupiPlay
import LupiScale

/// One cue for the app: haptics, sounds and visuals for a game moment (plan §5.3), already
/// filtered by the Sound & haptics toggle and scaled for motion comfort (LupiKit's `JuiceDirector`).
public struct JuiceCue: Sendable, Equatable {
    /// The body to play it on (spatial audio comes from its entity); nil plays at `position`.
    public var body: BodyID?
    public var position: Vec3
    /// The impulse's direction, world; zero when there is none.
    public var direction: Vec3
    public var output: JuiceOutput
    /// sRGB 0…1: the colours of the atoms nearest the contact (plan §5.3).
    public var sparkColours: [SIMD3<Float>]
}

/// A contact pair's first 50 ms: the largest impulse in it decides the hit (plan §4.4, spike A4).
struct ImpactWindow: Sendable {
    var start: Double
    var maxImpulse: Double
    var deltaV: Double
    var position: Vec3
    var direction: Vec3
    /// Juice already played for this hit (a hard first report plays at once).
    var fired: Bool
}

struct PairKey: Hashable, Sendable {
    var a: UInt64
    var b: UInt64

    init(_ x: BodyID?, _ y: BodyID?) {
        let p = x?.raw ?? .max, q = y?.raw ?? .max
        a = min(p, q)
        b = max(p, q)
    }

    var first: BodyID? { a == .max ? nil : BodyID(a) }
    var second: BodyID? { b == .max ? nil : BodyID(b) }
}

/// Routes contacts and game moments to LupiKit's juice director (plan §5): the impact window,
/// Δv from impulse and mass, the surface a room contact touched, and the cue list.
struct JuiceRouter: Sendable {
    var director: JuiceDirector
    var windows: [PairKey: ImpactWindow] = [:]

    init(settings: JuiceSettings) {
        director = JuiceDirector(settings: settings)
    }

    /// Δv = J / m_eff: the body's mass against the room, the reduced mass of two bodies (plan §4.4).
    static func deltaV(impulse: Double, massA: Double?, massB: Double?) -> Double {
        let m: Double
        switch (massA, massB) {
        case let (a?, b?): m = a * b / max(a + b, 1e-9)
        case let (a?, nil): m = a
        case let (nil, b?): m = b
        case (nil, nil): return 0
        }
        return abs(impulse) / max(m, 1e-6)
    }

    /// Opens or feeds a pair's window. Returns true when this report should play at once.
    mutating func observe(_ c: PlayContact, deltaV: Double) -> (key: PairKey, playNow: Bool) {
        let key = PairKey(c.a, c.b)
        if var w = windows[key] {
            if deltaV > w.deltaV {
                w.deltaV = deltaV
                w.maxImpulse = abs(c.impulse)
                w.position = c.position
                w.direction = c.direction
            }
            let now = !w.fired && deltaV >= PlayTuning.immediateImpact
            if now { w.fired = true }
            windows[key] = w
            return (key, now)
        }
        // A pair already touching opens a window only for a real hit (something landing on a resting body).
        guard c.phase == .began || deltaV >= PlayTuning.immediateImpact else { return (key, false) }
        let now = deltaV >= PlayTuning.immediateImpact
        windows[key] = ImpactWindow(
            start: c.time, maxImpulse: abs(c.impulse), deltaV: deltaV, position: c.position, direction: c.direction, fired: now
        )
        return (key, now)
    }

    /// Windows whose 50 ms are over, removed.
    mutating func closing(at time: Double) -> [(PairKey, ImpactWindow)] {
        let done = windows.filter { time - $0.value.start >= PlayTuning.impactWindow }.sorted { ($0.key.a, $0.key.b) < ($1.key.a, $1.key.b) }
        for (k, _) in done { windows[k] = nil }
        return done
    }

    mutating func forget(_ id: BodyID) {
        director.forget(id.raw)
        windows = windows.filter { $0.key.a != id.raw && $0.key.b != id.raw }
    }
}

/// What a room contact touched, from the impulse direction and height (plan §3.3). The app's
/// classified LiDAR mesh can replace this when its lookup lands; it needs no device to decide.
public enum SurfaceGuess {
    /// A surface higher than this above the floor is furniture, not floor (plan §6.3's shelf height).
    public static let shelfHeight = 0.25

    public static func classify(direction: Vec3, position: Vec3, floorY: Double?) -> SurfaceClass {
        let d = direction.normalized
        guard d.lengthSquared > 0 else { return .none }
        if abs(d.y) < 0.5 { return .wall }
        guard let floor = floorY else { return .table }
        if position.y - floor < shelfHeight { return .floor }
        // A support from above: the ceiling, when it is well above eye height.
        if position.y - floor > 2.0 { return .ceiling }
        return .table
    }
}

extension JuiceBody {
    init(_ body: Body) {
        let p = body.facts.personality.personality
        let timbre = Timbre.of(body.facts.personality, segments: body.effects.flop?.segments.count ?? 0)
        self.init(id: body.id.raw, kind: p.kind, hapticSharpness: p.hapticSharpness, span: body.span, heft: body.facts.heft.h, timbre: timbre)
    }
}

extension PlaySession {
    /// The Δv of a hit (plan §4.4): the impulse over the body's felt mass against the room, or over
    /// the reduced mass of two bodies.
    public static func impactDeltaV(impulse: Double, massA: Double?, massB: Double?) -> Double {
        JuiceRouter.deltaV(impulse: impulse, massA: massA, massB: massB)
    }
}
