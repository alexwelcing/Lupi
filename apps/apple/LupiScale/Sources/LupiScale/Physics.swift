import Foundation
import LupiChem
import LupiScaleCore

/// `ln M` and `ln ln M` of a mass in daltons (§5.5). `lnM` may be +∞.
///
/// The spec gives this and `FeltMass` to LupiKit's `LupiPlay` (§11.1). Until LupiKit has them they
/// live here with the same names and shapes; when LupiPlay gains them these two go.
public struct MassLog: Sendable, Hashable {
    public var lnM: Double
    public var lnlnM: Double

    public init(lnM: Double, lnlnM: Double) {
        self.lnM = lnM
        self.lnlnM = lnlnM
    }

    /// For a mass in daltons that binary64 holds.
    public init(daltons: Double) {
        lnM = log(daltons)
        lnlnM = log(log(daltons))
    }
}

/// `lupi.feltmass.v1` (§10.2): felt mass in [0.06, 0.6) kg, in the true order of masses to a
/// googolplex and beyond. The personality shifts a body along the curve.
public enum FeltMass {
    static let lnKnee = log(180.0) + 2.5 * log(2.0)
    static let a = 0.8 * lnKnee
    static let lnlnKnee = log(lnKnee)

    public static func kg(_ mass: MassLog, massScale: Double) -> Double {
        let shift = 2.5 * log(massScale)
        let x = mass.lnM + shift
        let b: Double
        if x.isFinite && x <= lnKnee {
            b = 0.2 * exp(0.4 * (x - log(180)))
        } else {
            // ln x = ln ln M + ln1p(2.5 ln(massScale) / ln M); the shift drops once ln M is not finite.
            let lnX = mass.lnM.isFinite ? mass.lnlnM + log1p(shift / mass.lnM) : mass.lnlnM
            b = 0.6 - 0.2 / (1 + a * (lnX - lnlnKnee))
        }
        return max(0.06, b)
    }
}

/// `massLog` of an exact mass in micro-daltons (§5.5), for `FeltMass`.
public func massLog(massMicroDa: Magnitude) -> MassLog {
    let ln1e6 = log(1e6)
    let lnM = massMicroDa.lnM - ln1e6
    let lnlnM: Double
    if massMicroDa.lnM.isFinite {
        lnlnM = log(lnM)
    } else {
        // ln(ln(µDa) − ln 10⁶) = ln ln(µDa) + ln1p(−ln 10⁶ / ln(µDa)), and the second term vanishes.
        lnlnM = massMicroDa.lnlnM
    }
    return MassLog(lnM: lnM, lnlnM: lnlnM)
}

/// Heft for sound and haptics (§10.8): `h = log10(1 + log10(M / 1 Da))`.
public struct Heft: Sendable, Hashable {
    public var h: Double

    public init(_ mass: MassLog) {
        if mass.lnM.isFinite {
            h = log10(1 + mass.lnM / log(10))
        } else {
            h = (mass.lnlnM - log(log(10.0))) / log(10.0)
        }
    }

    public var subBassGain: Double { min(1, max(0, (h - 0.9) / 2)) }
    /// Multiplies plan §5.2's size factor.
    public var pitchFactor: Double { pow(0.85, min(h, 4) - 0.6) }
    /// Seconds.
    public var hapticTail: Double { 0.040 * (1 + min(h, 4)) }
}

/// Size states (§10.1).
public enum SizeState: Sendable, Equatable {
    /// Dynamic: within 3× its spawn span.
    case toy
    /// Kinematic, up to 3 m; other bodies land on it.
    case monument
    /// Static, over 3 m, at most one at a time.
    case terrain

    public static func of(longestSpan: Double, spawnSpan: Double) -> SizeState {
        if longestSpan <= 3 * spawnSpan { return .toy }
        if longestSpan <= 3 { return .monument }
        return .terrain
    }
}

public enum Spawn {
    /// Metres per own unit at spawn (§10.1, plan §4.1). A molecule (a leaf) spans 15 cm at
    /// 0.005–0.04 m/Å; anything bigger is the larger of a 15 cm longest and a 3 cm shortest span,
    /// capped at a 30 cm longest span.
    public static func metresPerUnit(_ view: View, resolver: Resolver) throws -> Double {
        let a = try resolver.aggregate(view)
        let longest = a.bounds.longest, shortest = max(a.bounds.shortest, 1e-12)
        if view.kind == .leaf || view.kind == .selection {
            return min(0.04, max(0.005, 0.15 / longest))
        }
        let span = min(0.30, max(0.15, 0.03 * longest / shortest))
        return span / longest
    }

    /// The spawn span (longest, metres) of a view.
    public static func span(_ view: View, resolver: Resolver) throws -> Double {
        try metresPerUnit(view, resolver: resolver) * resolver.aggregate(view).bounds.longest
    }
}

/// Principal moments (kg·m²) and axes of a body (§10.3).
public struct InertiaShape: Sendable {
    public var moments: Vec3
    /// Columns are the principal axes, in the node's frame.
    public var axes: Mat3
    /// The centre of mass in the node's own units.
    public var centreOfMass: Vec3
}

/// The inertia of a node at a display scale: the shape tensor `I / M` from its covariance, times
/// felt mass and metres², the smallest moment floored at 0.02 of the largest (§10.3, plan §4.2).
public func inertia(for view: View, feltMassKg: Double, metresPerUnit: Double, resolver: Resolver) throws -> InertiaShape {
    let a = try resolver.aggregate(view)
    let c = a.covariance
    let trace = c[0, 0] + c[1, 1] + c[2, 2]
    let perMass = Mat3.identity.scaled(by: trace) + c.scaled(by: -1)
    let (values, vectors) = SymmetricEigen.solve(perMass)
    let s2 = metresPerUnit * metresPerUnit * feltMassKg
    var m = Vec3(max(0, values.x), max(0, values.y), max(0, values.z)) * s2
    let largest = max(m.x, max(m.y, m.z))
    m = Vec3(max(m.x, 0.02 * largest), max(m.y, 0.02 * largest), max(m.z, 0.02 * largest))
    return InertiaShape(moments: m, axes: Mat3(columns: vectors[0], vectors[1], vectors[2]), centreOfMass: a.centreOfMass)
}
