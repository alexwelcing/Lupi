import Foundation
import LupiChem

/// How molecules map into the game world. Game units are RealityKit's:
/// metres, kilograms, seconds.
///
/// Size: an honest decade magnification printed on the plaque. Molecules
/// show at 10⁸× (1 Å → 1 cm, caffeine about 10 cm across), colossi at 10⁷×
/// (1 Å → 1 mm, a million atoms about 25 cm). The player's grow/shrink is a
/// further `displayScale` multiplier that changes the printed number.
///
/// Mass is not here: felt mass is `lupi.feltmass.v1` (scale-spec §10.2),
/// whose canonical form lives in LupiScale. LupiKit keeps only its branch
/// below the knee, `feltMass(molarMass:massScale:)`, with identical numbers.
/// Mass does not grow with `displayScale` (plan §4.2).
public struct GameUnits: Sendable, Equatable, Codable {
    /// Metres per ångström at display scale 1.
    public var metersPerAngstrom: Double

    public init(metersPerAngstrom: Double) {
        self.metersPerAngstrom = metersPerAngstrom
    }

    /// 10⁸×: 1 Å → 1 cm.
    public static let molecule = GameUnits(metersPerAngstrom: 0.01)
    /// 10⁷×: 1 Å → 1 mm, for structures too big to hold at molecule scale.
    public static let colossus = GameUnits(metersPerAngstrom: 0.001)

    /// Molecules whose widest span at 10⁸× would pass this (metres) use `colossus`.
    public static let colossusSpan = 0.6

    /// The default units for a structure of this span (Å).
    public static func forSpan(_ angstroms: Double) -> GameUnits {
        angstroms * molecule.metersPerAngstrom > colossusSpan ? colossus : molecule
    }

    public func meters(_ angstroms: Double, displayScale: Double = 1) -> Double {
        angstroms * metersPerAngstrom * displayScale
    }

    /// A position in Å (molecule frame) in metres.
    public func meters(_ angstroms: Vec3, displayScale: Double = 1) -> Vec3 {
        angstroms * (metersPerAngstrom * displayScale)
    }

    /// How many times bigger than life: 1e8 at molecule scale.
    public func magnification(displayScale: Double = 1) -> Double {
        metersPerAngstrom * 1e10 * displayScale
    }

    /// "10⁸×", or "3 × 10⁸×" off a power of ten.
    public func magnificationLabel(displayScale: Double = 1) -> String {
        let value = magnification(displayScale: displayScale)
        guard value > 0, value.isFinite else { return "—" }
        var exponent = Int(value.log10().rounded(.down))
        var mantissa = value / Self.power10(exponent)
        if (mantissa * 10).rounded() >= 100 {
            exponent += 1
            mantissa /= 10
        }
        let rounded = (mantissa * 10).rounded() / 10
        let power = "10" + Self.superscript(exponent) + "×"
        if abs(rounded - 1) < 0.05 { return power }
        let text = rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
        return "\(text) × \(power)"
    }

    /// Principal moments in kg·m² for a body of felt mass `mass`: the real
    /// mass distribution (amu·Å²) rescaled to the felt mass and the shown size,
    /// so a molecule tumbles with its true shape.
    public func principalMoments(_ facts: InertiaFacts, mass: Double, displayScale: Double = 1) -> Vec3 {
        guard facts.mass > 0 else { return .zero }
        let length = metersPerAngstrom * displayScale
        return facts.moments * (mass / facts.mass * length * length)
    }

    /// The knee of `lupi.feltmass.v1`, 180 · 2^2.5 Da (≈ 1,018 Da), where the
    /// power law hands over to the slow tail.
    public static let feltMassKneeDa = 180 * Foundation.pow(2, 2.5)
    /// The floor of `lupi.feltmass.v1`, kg.
    public static let feltMassFloorKg = 0.06

    /// Felt mass in kg by `lupi.feltmass.v1` (scale-spec §10.2) on its branch
    /// below the knee: `max(0.06, 0.2 × (M / 180 Da)^0.4 × massScale)`, which is
    /// the spec's `b(M × massScale^2.5)` there. Water 0.080, caffeine 0.206,
    /// C₆₀ 0.348; peroxide at 0.85 is 0.087, C₆₀ at 0.8 is 0.279.
    ///
    /// Nil above the knee (`M × massScale^2.5` over 1,018 Da): the tail is
    /// LupiScale's `FeltMass`, and a second copy here could only drift from it.
    public static func feltMass(molarMass: Double, massScale: Double = 1) -> Double? {
        guard molarMass > 0, molarMass.isFinite, massScale > 0, massScale.isFinite else { return nil }
        let x = Foundation.log(molarMass) + 2.5 * Foundation.log(massScale)
        guard x <= Foundation.log(feltMassKneeDa) else { return nil }
        return max(feltMassFloorKg, 0.2 * Foundation.exp(0.4 * (x - Foundation.log(180.0))))
    }

    static func power10(_ exponent: Int) -> Double {
        var value = 1.0
        for _ in 0..<abs(exponent) { value *= 10 }
        return exponent >= 0 ? value : 1 / value
    }

    static func superscript(_ n: Int) -> String {
        let digits: [Character] = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"]
        let body = String(abs(n)).map { digits[Int(String($0))!] }
        return (n < 0 ? "⁻" : "") + String(body)
    }
}

extension Double {
    func power(_ exponent: Double) -> Double { Foundation.pow(self, exponent) }
    func log10() -> Double { Foundation.log10(self) }
}
