import Foundation

/// `ln M` and `ln ln M` of a mass in daltons (scale-spec §5.5). `lnM` may be +∞: LupiScale forms
/// both from an exact Magnitude, so masses far beyond binary64 keep their order.
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

/// `lupi.feltmass.v1` (scale-spec §10.2): felt mass in [0.06, 0.6) kg, in the true order of masses
/// to a googolplex and beyond. Below the knee (180 · 2^2.5 Da) it is the plan's
/// `0.2 · (M / 180)^0.4 · massScale`; above it a slow tail that never reaches 0.6. The personality
/// shifts a body along the curve instead of scaling the result, so none reaches the ceiling.
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
