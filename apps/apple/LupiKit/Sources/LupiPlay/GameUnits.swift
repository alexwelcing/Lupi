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
/// Mass: felt, not real, but ordered truly. m = m₀ · (M / M₀)^γ with M₀ water
/// (18.015 g/mol), m₀ = 50 g and γ = 0.4, so real ratios are compressed
/// without reordering: H₂ 21 g, water 50 g, caffeine 130 g, C₆₀ 219 g,
/// hemoglobin (64.5 kDa) 1.3 kg, a million copper atoms 21 kg. H₂ is not
/// weightless and a protein is not immovable. Growing a molecule makes it
/// heavier as s^β with β = 1 (physics would say 3, which would make a grown
/// molecule impossible to throw). The real molar mass belongs on the card.
public struct GameUnits: Sendable, Equatable, Codable {
    /// Metres per ångström at display scale 1.
    public var metersPerAngstrom: Double
    /// Felt mass of the reference molecule at display scale 1, kg.
    public var referenceMass: Double
    /// Molar mass of the reference molecule, g/mol (water).
    public var referenceMolarMass: Double
    /// γ in m ∝ M^γ.
    public var massExponent: Double
    /// β in m ∝ displayScale^β.
    public var sizeMassExponent: Double
    /// Felt mass is clamped to this range, kg.
    public var minimumMass: Double
    public var maximumMass: Double

    public init(
        metersPerAngstrom: Double, referenceMass: Double = 0.05, referenceMolarMass: Double = 18.015,
        massExponent: Double = 0.4, sizeMassExponent: Double = 1, minimumMass: Double = 0.005, maximumMass: Double = 100
    ) {
        self.metersPerAngstrom = metersPerAngstrom
        self.referenceMass = referenceMass
        self.referenceMolarMass = referenceMolarMass
        self.massExponent = massExponent
        self.sizeMassExponent = sizeMassExponent
        self.minimumMass = minimumMass
        self.maximumMass = maximumMass
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

    /// Felt mass, kg.
    public func mass(molarMass: Double, displayScale: Double = 1) -> Double {
        guard molarMass > 0 else { return minimumMass }
        let felt = referenceMass * (molarMass / referenceMolarMass).power(massExponent)
            * displayScale.power(sizeMassExponent)
        return min(maximumMass, max(minimumMass, felt))
    }

    /// Principal moments in kg·m² for a body of felt mass `mass`: the real
    /// mass distribution (amu·Å²) rescaled to the felt mass and the shown size,
    /// so a molecule tumbles with its true shape.
    public func principalMoments(_ facts: InertiaFacts, mass: Double, displayScale: Double = 1) -> Vec3 {
        guard facts.mass > 0 else { return .zero }
        let length = metersPerAngstrom * displayScale
        return facts.moments * (mass / facts.mass * length * length)
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
