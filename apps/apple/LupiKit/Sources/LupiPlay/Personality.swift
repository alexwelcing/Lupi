import Foundation
import LupiChem

/// `lupi.personality.v1`: how a molecule feels in play. Fun first and loosely
/// inspired by chemistry (decision D8): the inputs are real graph facts, the
/// feel is a design table, and nothing here claims to be a simulation.
///
/// The kinds, their rules and their numbers are `lupi.personality.rules.v1`
/// (contracts.md §3.3). None depends on the felt mass or the display scale: the
/// body's mass is `lupi.feltmass.v1` (scale-spec §10.2), `breakImpulse(feltMass:)`
/// turns the break speed into an impulse, and `PersonalityRecord` is the
/// contract's JSON with both.
public struct Personality: Sendable, Equatable, Codable {
    public static let schema = "lupi.personality.v1"
    public static let rulesID = "lupi.personality.rules.v1"

    public enum Kind: String, Sendable, Codable, CaseIterable {
        /// One stiff body: rings, few rotors.
        case rigid
        /// A chain of hinges that flops and soaks up a hit.
        case flexible
        /// Snaps easily: weak bonds, ionic contacts and coordination, strained rings.
        case brittle
        /// Rebounds: single atoms, round tops and cages.
        case bouncy
    }

    /// The impact sound family the app plays (plan §5.2): clack, thwap, tink, boing.
    public typealias SoundFamily = ImpactFamily

    public var kind: Kind
    /// 0...1, RealityKit's physics-material restitution.
    public var restitution: Double
    /// Static friction, 0...1.
    public var friction: Double
    /// Dynamic friction, 0...1.
    public var dynamicFriction: Double
    public var linearDamping: Double
    public var angularDamping: Double
    /// The velocity change, m/s, of a hit that snaps the weakest bond (`unbreakable` when
    /// nothing can): contracts.md §3.3 rule 7, `base × sqrt(E_weakest / 346)`.
    public var breakSpeed: Double
    /// Shifts the body along `lupi.feltmass.v1` (scale-spec §10.2): how heavy this kind feels in the hand.
    public var massScale: Double
    /// The largest visual squash on impact, 0...1 (plan §5.4).
    public var squash: Double
    public var soundFamily: SoundFamily
    /// 0 (soft thud) ... 1 (sharp tick): Core Haptics' sharpness parameter.
    public var hapticSharpness: Double

    /// The break speed of a molecule nothing can snap: finite for JSON, unreachable in play.
    public static let unbreakable = 1.0e6

    public var isUnbreakable: Bool { breakSpeed >= Self.unbreakable }

    /// N·s for a body of this felt mass (kg): `massKg × breakSpeed`, as the
    /// contract's `breakImpulse`. Nil when nothing can snap.
    public func breakImpulse(feltMass: Double) -> Double? {
        isUnbreakable ? nil : feltMass * breakSpeed
    }
}

/// The table behind every personality: contracts.md §3.3 rule 5, exactly. Rules are tried in
/// order and the first that matches picks the kind; its preset gives the numbers. Deterministic:
/// same molecule, same table, same personality. Changing a number means a new rules id.
public struct PersonalityTable: Sendable, Equatable, Codable {
    public struct Preset: Sendable, Equatable, Codable {
        public var restitution: Double
        public var staticFriction: Double
        public var dynamicFriction: Double
        public var linearDamping: Double
        public var angularDamping: Double
        /// The base break speed (m/s): a hit this hard snaps a bond as strong as `referenceBond`.
        public var breakSpeed: Double
        public var massScale: Double
        public var squash: Double
        public var soundFamily: Personality.SoundFamily
        public var hapticSharpness: Double
    }

    public var rigid: Preset
    public var flexible: Preset
    public var brittle: Preset
    public var bouncy: Preset

    /// A weakest bond below this (kJ/mol) is brittle: peroxide O–O 142, N–N 167, halogens.
    public var weakBond: Double
    /// A weakest bond at or above this never snaps (N≡N 941, C≡O 1072).
    public var unbreakableCut: Double
    /// The bond `breakSpeed` is calibrated on: C–C, 346 kJ/mol.
    public var referenceBond: Double
    /// This many rotatable bonds or more is flexible.
    public var flexibleRotors: Int
    /// A cage of rings with at least this many heavy atoms is bouncy.
    public var cageHeavyAtoms: Int
    /// A ring of at most this many atoms is strained: brittle.
    public var strainedRing: Int

    public static let v1 = PersonalityTable(
        rigid: Preset(
            restitution: 0.35, staticFriction: 0.7, dynamicFriction: 0.5, linearDamping: 0.05, angularDamping: 0.08,
            breakSpeed: 3.0, massScale: 1.0, squash: 0.06, soundFamily: .clack, hapticSharpness: 0.8
        ),
        flexible: Preset(
            restitution: 0.15, staticFriction: 0.9, dynamicFriction: 0.7, linearDamping: 0.12, angularDamping: 0.45,
            breakSpeed: 4.5, massScale: 0.9, squash: 0.18, soundFamily: .thwap, hapticSharpness: 0.3
        ),
        brittle: Preset(
            restitution: 0.20, staticFriction: 0.6, dynamicFriction: 0.45, linearDamping: 0.05, angularDamping: 0.10,
            breakSpeed: 1.2, massScale: 0.85, squash: 0.03, soundFamily: .tink, hapticSharpness: 1.0
        ),
        bouncy: Preset(
            restitution: 0.85, staticFriction: 0.5, dynamicFriction: 0.35, linearDamping: 0.02, angularDamping: 0.03,
            breakSpeed: 6.5, massScale: 0.8, squash: 0.25, soundFamily: .boing, hapticSharpness: 0.5
        ),
        weakBond: 200, unbreakableCut: 800, referenceBond: 346, flexibleRotors: 3, cageHeavyAtoms: 20, strainedRing: 4
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

/// Which rule picked the kind (contracts.md §3.3 rule 4), for the plaque's reason.
public enum PersonalityRule: String, Sendable, Codable, CaseIterable {
    case ionic
    case coordination
    case weakBond
    case strainedRing
    case atom
    case round
    case cage
    case rotors
    case fusedRings
    case stiff
}

public struct PersonalityDerivation: Sendable, Equatable {
    public var personality: Personality
    public var features: MolecularFeatures
    public var rule: PersonalityRule
    /// Plain-language plaque lines (contracts.md §3.3 rule 8): the rule that matched with the
    /// number it used, then "Will not snap" when nothing can.
    public var reasons: [String]
    /// How it plays, one line: "Bounces, and its cage rings".
    public var feel: String
    /// A bouncy cage: it rings like a bell when it lands (plan §8 M4).
    public var rings: Bool

    /// The first reason: "Brittle: its O–O bond is weak (142 kJ/mol)".
    public var plaque: String { reasons.first ?? "" }
}

extension Personality {
    /// The personality of `molecule` with its play graph.
    public static func derive(
        _ molecule: Molecule, graph: BondGraph? = nil, table: PersonalityTable = .v1
    ) -> PersonalityDerivation {
        let graph = graph ?? BondGraph.forPlay(molecule)
        return derive(features: MolecularFeatures(molecule: molecule, graph: graph), table: table)
    }

    public static func derive(features f: MolecularFeatures, table: PersonalityTable = .v1) -> PersonalityDerivation {
        let (kind, rule, reason) = classify(f, table)
        let preset = table.preset(kind)
        var breakSpeed = unbreakable
        if let weakest = f.weakestBond, weakest.kJPerMol < table.unbreakableCut {
            breakSpeed = min(unbreakable, preset.breakSpeed * (weakest.kJPerMol / table.referenceBond).squareRoot())
        }
        let personality = Personality(
            kind: kind, restitution: preset.restitution, friction: preset.staticFriction, dynamicFriction: preset.dynamicFriction,
            linearDamping: preset.linearDamping, angularDamping: preset.angularDamping, breakSpeed: breakSpeed,
            massScale: preset.massScale, squash: preset.squash, soundFamily: preset.soundFamily,
            hapticSharpness: preset.hapticSharpness
        )
        var reasons = ["\(kind.title): \(reason)"]
        if personality.isUnbreakable, let weakest = f.weakestBond {
            reasons.append("Will not snap: its weakest bond, \(weakest.label), is \(Int(weakest.kJPerMol.rounded())) kJ/mol")
        }
        let rings = kind == .bouncy && (f.hasCage || f.isRingCage)
        return PersonalityDerivation(
            personality: personality, features: f, rule: rule, reasons: reasons, feel: feel(kind, rings: rings), rings: rings
        )
    }

    /// contracts.md §3.3 rule 4, first match wins.
    static func classify(_ f: MolecularFeatures, _ t: PersonalityTable) -> (Kind, PersonalityRule, String) {
        if f.ionicContacts > 0 {
            return (.brittle, .ionic, "held by ionic contacts (\(kJ(BondStrength.ionicContact)))")
        }
        if f.coordinationBonds > 0 {
            return (.brittle, .coordination, "held by coordination bonds (\(kJ(BondStrength.coordination)))")
        }
        if let weak = f.weakestBond, weak.kJPerMol < t.weakBond {
            return (.brittle, .weakBond, "its \(weak.label) bond is weak (\(kJ(weak.kJPerMol)))")
        }
        if let ring = f.smallestRing, ring <= t.strainedRing {
            return (.brittle, .strainedRing, "a strained \(ring)-membered ring")
        }
        if f.rotor == .atom {
            return (.bouncy, .atom, "a single atom")
        }
        let cage = f.hasCage || f.isRingCage
        if f.rotor == .spherical {
            return cage
                ? (.bouncy, .cage, "a round cage of \(heavyAtoms(f))")
                : (.bouncy, .round, "round, it spins alike about every axis")
        }
        if f.heavyAtomCount >= t.cageHeavyAtoms && f.heavyAtomsInRings == f.heavyAtomCount {
            return (.bouncy, .cage, "a cage of \(heavyAtoms(f))")
        }
        if f.rotatableBonds >= t.flexibleRotors {
            return (.flexible, .rotors, count(f.rotatableBonds, "rotating bond"))
        }
        if f.largestRingSystem >= 2 {
            return (.rigid, .fusedRings, "\(numberWord(f.largestRingSystem)) fused rings")
        }
        if f.cycleCount > 0 {
            return (.rigid, .stiff, f.cycleCount == 1 ? "one ring" : "\(numberWord(f.cycleCount)) rings")
        }
        return (.rigid, .stiff, f.rotatableBonds == 0 ? "no rotating bonds" : "only \(count(f.rotatableBonds, "rotating bond"))")
    }

    static func feel(_ kind: Kind, rings: Bool) -> String {
        switch kind {
        case .rigid: "Clacks like hard plastic"
        case .flexible: "Flops, and soaks up a hit"
        case .brittle: "Cracks easily, and tinks like glass"
        case .bouncy: rings ? "Bounces, and its cage rings" : "Bounces like a rubber ball"
        }
    }

    /// "60 carbons", "26 atoms".
    static func heavyAtoms(_ f: MolecularFeatures) -> String {
        guard let z = f.soleHeavyElement else { return "\(f.heavyAtomCount) atoms" }
        let name = ChemicalElement.forAtomicNumber(z).name.lowercased()
        return f.heavyAtomCount == 1 ? "one \(name)" : "\(f.heavyAtomCount) \(name)s"
    }

    static func kJ(_ value: Double) -> String { "\(Int(value.rounded())) kJ/mol" }

    static func count(_ n: Int, _ noun: String) -> String {
        "\(numberWord(n)) \(noun)\(n == 1 ? "" : "s")"
    }

    static func numberWord(_ n: Int) -> String {
        let words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
        return n >= 0 && n < words.count ? words[n] : String(n)
    }
}

extension Personality.Kind {
    /// "Brittle".
    public var title: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

/// `lupi.personality.v1` as contracts.md §3.1 and §3.2 write it: the personality with its felt
/// mass, break impulse, weakest bond and reasons. Derived on device and never synced; this is
/// the shape a cache or another client reads.
public struct PersonalityRecord: Sendable, Equatable, Codable {
    public struct Friction: Sendable, Equatable, Codable {
        public var `static`: Float
        public var dynamic: Float
    }

    public struct WeakestBond: Sendable, Equatable, Codable {
        public var atoms: [Int]
        public var elements: [String]
        /// "covalent", "coordination" or "ionicContact".
        public var kind: String
        /// 1, 2 or 3 for a covalent bond; nil for a delocalized one (LupiChem's estimate keeps it apart).
        public var order: Int?
        public var energyKJPerMol: Float
        public var energySource: String
    }

    public var schema: String
    public var rules: String
    public var kind: Personality.Kind
    public var restitution: Float
    public var friction: Friction
    public var linearDamping: Float
    public var angularDamping: Float
    public var massScale: Float
    public var massKg: Float
    public var breakSpeed: Float?
    public var breakImpulse: Float?
    public var squash: Float
    public var soundFamily: Personality.SoundFamily
    public var hapticSharpness: Float
    public var weakestBond: WeakestBond?
    public var reasons: [String]

    /// The record of a derivation, its felt mass from the molar mass (`lupi.feltmass.v1`).
    public init(_ d: PersonalityDerivation) {
        let p = d.personality
        let mass = FeltMass.kg(MassLog(daltons: d.features.molarMass), massScale: p.massScale)
        schema = Personality.schema
        rules = Personality.rulesID
        kind = p.kind
        restitution = Float(p.restitution)
        friction = Friction(static: Float(p.friction), dynamic: Float(p.dynamicFriction))
        linearDamping = Float(p.linearDamping)
        angularDamping = Float(p.angularDamping)
        massScale = Float(p.massScale)
        massKg = Float(mass)
        breakSpeed = p.isUnbreakable ? nil : Float(p.breakSpeed)
        breakImpulse = p.breakImpulse(feltMass: mass).map(Float.init)
        squash = Float(p.squash)
        soundFamily = p.soundFamily
        hapticSharpness = Float(p.hapticSharpness)
        weakestBond = d.features.weakestBond.map { w in
            let order: Int? = switch (w.kind, w.order) {
            case (.covalent, .single): 1
            case (.covalent, .double): 2
            case (.covalent, .triple): 3
            default: nil
            }
            return WeakestBond(
                atoms: w.atoms, elements: w.elements, kind: w.kind.contractName, order: order,
                energyKJPerMol: Float(w.kJPerMol), energySource: w.energySource
            )
        }
        reasons = d.reasons
    }

    /// Absent values are written as `null`, as contracts.md §3.2 shows them.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema, forKey: .schema)
        try c.encode(rules, forKey: .rules)
        try c.encode(kind, forKey: .kind)
        try c.encode(restitution, forKey: .restitution)
        try c.encode(friction, forKey: .friction)
        try c.encode(linearDamping, forKey: .linearDamping)
        try c.encode(angularDamping, forKey: .angularDamping)
        try c.encode(massScale, forKey: .massScale)
        try c.encode(massKg, forKey: .massKg)
        try c.encode(breakSpeed, forKey: .breakSpeed)
        try c.encode(breakImpulse, forKey: .breakImpulse)
        try c.encode(squash, forKey: .squash)
        try c.encode(soundFamily, forKey: .soundFamily)
        try c.encode(hapticSharpness, forKey: .hapticSharpness)
        try c.encode(weakestBond, forKey: .weakestBond)
        try c.encode(reasons, forKey: .reasons)
    }
}

extension BondKind {
    /// The contract's spelling: "covalent", "coordination", "ionicContact".
    public var contractName: String {
        switch self {
        case .covalent: "covalent"
        case .coordination: "coordination"
        case .ionicContact: "ionicContact"
        }
    }
}
