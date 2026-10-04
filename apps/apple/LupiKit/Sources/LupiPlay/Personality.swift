import Foundation
import LupiChem

/// `lupi.personality.v1`: how a molecule feels in play. Fun first and loosely
/// inspired by chemistry (decision D8): the inputs are real graph facts, the
/// feel is a design table, and nothing here claims to be a simulation.
///
/// JSON keys are exactly these nine fields. Every value is for display scale
/// 1; `scaled(by:units:)` adjusts what depends on the felt mass.
public struct Personality: Sendable, Equatable, Codable {
    public static let schema = "lupi.personality.v1"

    public enum Kind: String, Sendable, Codable, CaseIterable {
        /// One stiff body: fused or aromatic rings, few rotors.
        case rigid
        /// A chain of hinges that soaks up a hit.
        case flexible
        /// Snaps easily: ionic contacts, weak or stretched bonds.
        case brittle
        /// Rebounds: closed cages, and small tight molecules that rattle like gas.
        case bouncy
    }

    /// The impact sound set the app plays (spatial, D11).
    public enum SoundFamily: String, Sendable, Codable, CaseIterable {
        case clack
        case squish
        case crackle
        case boing
    }

    public var kind: Kind
    /// 0...1, RealityKit's physics-material restitution.
    public var restitution: Double
    /// 0...1, used for static and dynamic friction.
    public var friction: Double
    public var linearDamping: Double
    public var angularDamping: Double
    /// The impulse, N·s in game units, of a hit that snaps the weakest bond
    /// (`unbreakable` when nothing can). Felt mass × break speed.
    public var breakImpulse: Double
    /// Multiplier on `GameUnits.mass`: how heavy this kind feels in the hand.
    public var massScale: Double
    public var soundFamily: SoundFamily
    /// 0 (soft thud) ... 1 (sharp tick): Core Haptics' sharpness parameter.
    public var hapticSharpness: Double

    /// The break impulse of a molecule nothing can snap: finite for JSON, unreachable in play.
    public static let unbreakable = 1.0e6

    public var isUnbreakable: Bool { breakImpulse >= Self.unbreakable }

    /// The same personality at another display scale: the break impulse
    /// follows the felt mass (m ∝ s^β), everything else is scale-free.
    public func scaled(by displayScale: Double, units: GameUnits = .molecule) -> Personality {
        guard !isUnbreakable else { return self }
        var copy = self
        copy.breakImpulse = breakImpulse * displayScale.power(units.sizeMassExponent)
        return copy
    }
}

/// The tunable table behind every personality. Rules are tried in order; the
/// first that matches picks the kind, its preset gives the numbers, and a few
/// gentle modifiers follow the features. Deterministic: same molecule, same
/// table, same personality.
public struct PersonalityTable: Sendable, Equatable, Codable {
    public struct Preset: Sendable, Equatable, Codable {
        public var restitution: Double
        public var friction: Double
        public var linearDamping: Double
        public var angularDamping: Double
        /// Impact speed (m/s) that snaps a bond as strong as `referenceBond`.
        public var breakSpeed: Double
        public var massScale: Double
        public var soundFamily: Personality.SoundFamily
        public var hapticSharpness: Double
    }

    public var rigid: Preset
    public var flexible: Preset
    public var brittle: Preset
    public var bouncy: Preset

    /// A weakest splitting bond below this (kJ/mol) is brittle: peroxide O–O 142, N–N 167, halogens.
    public var weakBond: Double
    /// A cut at or above this never snaps (N≡N 941, C≡O 1072).
    public var unbreakableCut: Double
    /// The bond `breakSpeed` is calibrated on: C–C, 346 kJ/mol.
    public var referenceBond: Double
    /// This many rotatable bonds or more is flexible.
    public var flexibleRotors: Int
    /// At most this many heavy atoms and no rings rattles like a gas molecule: bouncy.
    public var smallMolecule: Int
    /// Flexible: extra angular damping per rotor past `flexibleRotors` (up to ten).
    public var dampingPerRotor: Double
    /// Rigid: extra restitution at a fully aromatic skeleton.
    public var aromaticSpring: Double

    public static let v1 = PersonalityTable(
        rigid: Preset(
            restitution: 0.35, friction: 0.6, linearDamping: 0.05, angularDamping: 0.08, breakSpeed: 4.0,
            massScale: 1.0, soundFamily: .clack, hapticSharpness: 0.75
        ),
        flexible: Preset(
            restitution: 0.15, friction: 0.8, linearDamping: 0.10, angularDamping: 0.35, breakSpeed: 5.0,
            massScale: 1.0, soundFamily: .squish, hapticSharpness: 0.25
        ),
        brittle: Preset(
            restitution: 0.20, friction: 0.5, linearDamping: 0.05, angularDamping: 0.10, breakSpeed: 2.5,
            massScale: 1.1, soundFamily: .crackle, hapticSharpness: 0.95
        ),
        bouncy: Preset(
            restitution: 0.80, friction: 0.3, linearDamping: 0.02, angularDamping: 0.02, breakSpeed: 4.5,
            massScale: 0.9, soundFamily: .boing, hapticSharpness: 0.5
        ),
        weakBond: 200, unbreakableCut: 800, referenceBond: 346, flexibleRotors: 3, smallMolecule: 3,
        dampingPerRotor: 0.05, aromaticSpring: 0.1
    )

    public func preset(_ kind: Personality.Kind) -> Preset {
        switch kind {
        case .rigid: rigid
        case .flexible: flexible
        case .brittle: brittle
        case .bouncy: bouncy
        }
    }
}

/// Which rule picked the kind, for the plaque ("Rigid: three fused rings").
public enum PersonalityRule: String, Sendable, Codable, CaseIterable {
    case ionic
    case weakBond
    case stretchedBonds
    case cage
    case smallMolecule
    case rotors
    case fusedRings
    case stiff
}

public struct PersonalityDerivation: Sendable, Equatable {
    public var personality: Personality
    public var features: MolecularFeatures
    public var rule: PersonalityRule
    /// One line for the plaque: "Brittle: weakest bond O–O, 142 kJ/mol".
    public var plaque: String
}

extension Personality {
    /// The personality of `molecule` with its play graph.
    public static func derive(
        _ molecule: Molecule, graph: BondGraph? = nil, units: GameUnits = .molecule, table: PersonalityTable = .v1
    ) -> PersonalityDerivation {
        let graph = graph ?? BondGraph.forPlay(molecule)
        return derive(features: MolecularFeatures(molecule: molecule, graph: graph), units: units, table: table)
    }

    public static func derive(
        features f: MolecularFeatures, units: GameUnits = .molecule, table: PersonalityTable = .v1
    ) -> PersonalityDerivation {
        let (kind, rule, reason) = classify(f, table)
        let preset = table.preset(kind)
        var restitution = preset.restitution
        var angularDamping = preset.angularDamping
        switch kind {
        case .flexible:
            let extra = Double(min(10, max(0, f.rotatableBonds - table.flexibleRotors)))
            angularDamping += table.dampingPerRotor * extra
            restitution -= 0.01 * extra
        case .rigid:
            restitution += table.aromaticSpring * f.delocalizedFraction
        case .brittle, .bouncy:
            break
        }

        let mass = units.mass(molarMass: f.molarMass) * preset.massScale
        var breakImpulse = unbreakable
        if let cut = f.cutStrength, cut < table.unbreakableCut {
            let speed = preset.breakSpeed * (cut / table.referenceBond).squareRoot()
            breakImpulse = min(unbreakable, mass * speed)
        }
        let personality = Personality(
            kind: kind,
            restitution: min(0.95, max(0, restitution)),
            friction: min(1, max(0, preset.friction)),
            linearDamping: max(0, preset.linearDamping),
            angularDamping: max(0, angularDamping),
            breakImpulse: breakImpulse,
            massScale: preset.massScale,
            soundFamily: preset.soundFamily,
            hapticSharpness: min(1, max(0, preset.hapticSharpness))
        )
        let name = kind.rawValue.prefix(1).uppercased() + kind.rawValue.dropFirst()
        let suffix = personality.isUnbreakable && f.cutStrength != nil ? " · will not snap" : ""
        return PersonalityDerivation(
            personality: personality, features: f, rule: rule, plaque: "\(name): \(reason)\(suffix)"
        )
    }

    static func classify(_ f: MolecularFeatures, _ t: PersonalityTable) -> (Kind, PersonalityRule, String) {
        if f.ions > 0 || f.ionicContacts > 0 {
            return (.brittle, .ionic, "ionic contacts cleave")
        }
        if let weak = f.weakestBond, weak.kJPerMol < t.weakBond, f.cutStrength == weak.kJPerMol {
            return (.brittle, .weakBond, "weakest bond \(weak.label), \(Int(weak.kJPerMol.rounded())) kJ/mol")
        }
        if f.longBonds > 0 {
            return (.brittle, .stretchedBonds, "\(count(f.longBonds, "stretched bond"))")
        }
        if f.hasCage {
            return (.bouncy, .cage, "a closed cage")
        }
        if f.heavyAtomCount <= t.smallMolecule && f.cycleCount == 0 {
            return (.bouncy, .smallMolecule, "small and tight")
        }
        if f.rotatableBonds >= t.flexibleRotors {
            return (.flexible, .rotors, count(f.rotatableBonds, "rotatable bond"))
        }
        if f.largestRingSystem >= 2 {
            return (.rigid, .fusedRings, "\(numberWord(f.largestRingSystem)) fused rings")
        }
        if f.cycleCount > 0 {
            return (.rigid, .stiff, f.cycleCount == 1 ? "one ring" : "\(numberWord(f.cycleCount)) rings")
        }
        return (.rigid, .stiff, f.rotatableBonds == 0 ? "no rotatable bonds" : count(f.rotatableBonds, "rotatable bond"))
    }

    static func count(_ n: Int, _ noun: String) -> String {
        "\(numberWord(n)) \(noun)\(n == 1 ? "" : "s")"
    }

    static func numberWord(_ n: Int) -> String {
        let words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
        return n >= 0 && n < words.count ? words[n] : String(n)
    }
}
