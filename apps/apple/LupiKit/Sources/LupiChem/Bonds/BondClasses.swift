// Port of packages/core/src/bonds/classes.ts: the thresholds, element classes,
// radii and caps of lupi-bonds.molecular.v1 and lupi-bonds.distance.v1.
// Every number here must equal the web's; the golden fixtures check it.

public enum BondConstants {
    /// Frames above this many atoms keep the distance recipe (same cap as Object Facts).
    public static let molecularRecipeMaxAtoms = 2000
    /// Store `bondTolerance` / URL `bt`; clamped to 0...bondToleranceMax.
    public static let defaultTolerance = 0.45
    public static let bondToleranceMax = 1.5
    /// Pairs closer than this are never bonded (Open Babel, RDKit and Jmol use the same floor).
    public static let clashFloor = 0.40
    public static let ionContactMargin = 0.35
    public static let metalMetalSlack = 0.25
    /// Metal–H cutoff is r_M + r_H + 0.30.
    public static let metalHydrideSlack = 0.30
    public static let hapticTrimRatio = 1.15
    public static let metalCoordinationCap = 12
    public static let ionDonorPrecedence = 0.15
    public static let longExcess = 0.20
    /// Near misses: covalent-class pairs with τ < e ≤ τ + this.
    public static let nearMissWindow = 0.20
    public static let acuteAngleDegrees = 45.0
    /// cos²(45°) is exactly ½, so the angle test needs no trig.
    public static let acuteAngleCos2 = 0.5
}

/// How the molecular recipe treats an element.
public enum ElementClass: UInt8, Sendable, Codable {
    case hydrogen = 0
    case covalent = 1
    /// s-block ions: ionic contacts only, never covalent sticks.
    case ion = 2
    /// Coordinating metals: dashed coordination lines.
    case metal = 3
    /// Never bonded.
    case inert = 4

    public static let ionZ: Set<Int> = [3, 11, 19, 37, 55, 87, 12, 20, 38, 56, 88]
    public static let inertZ: Set<Int> = [2, 10, 18, 86]

    /// Z 21–30, 39–48, 57–80, 89–112.
    public static func isCoordinatingMetal(_ z: Int) -> Bool {
        (21...30).contains(z) || (39...48).contains(z) || (57...80).contains(z) || (89...112).contains(z)
    }

    /// Every Z that is not H, an ion, a coordinating metal or inert is covalent
    /// (Be, Al, Ga, In, Tl, Sn, Pb, Bi, Po, Kr, Xe included).
    public init(z: Int) {
        if z == 1 { self = .hydrogen }
        else if Self.ionZ.contains(z) { self = .ion }
        else if Self.inertZ.contains(z) { self = .inert }
        else if Self.isCoordinatingMetal(z) { self = .metal }
        else { self = .covalent }
    }
}

public enum BondRadii {
    /// Single-bond covalent radius: the element table's (1.40 Å for unknown types).
    public static func covalent(_ z: Int) -> Double { Element.forAtomicNumber(z).covalentRadius }

    /// Cordero 2008 high-spin radii, so high-spin complexes are not missed.
    public static let highSpin: [Int: Double] = [25: 1.61, 26: 1.52, 27: 1.50]

    /// A coordinating metal's radius in every metal rule: high-spin for Mn, Fe and Co, covalent otherwise.
    public static func metal(_ z: Int) -> Double { highSpin[z] ?? covalent(z) }

    /// Cation radii: Shannon 1976 effective ionic radii, CN6.
    public static let ion: [Int: Double] = [
        3: 0.76, 11: 1.02, 19: 1.38, 37: 1.52, 55: 1.67, 87: 1.80,
        12: 0.72, 20: 1.00, 38: 1.18, 56: 1.35, 88: 1.48,
    ]

    /// Donor contact radii; only these donors make ionic contacts with an s-block ion.
    /// O, F, Cl, Br, I, S: Shannon 1976 CN6; N: Shannon CN4; P: Pauling.
    public static let donor: [Int: Double] = [
        8: 1.40, 9: 1.33, 17: 1.81, 35: 1.96, 53: 2.20, 16: 1.84, 7: 1.46, 15: 2.12,
    ]

    /// Longest ionic contact any pair can make: max r_ion + max r_donor + margin (4.35 Å).
    public static let maxIonContact: Double =
        ion.values.max()! + donor.values.max()! + BondConstants.ionContactMargin
}

public enum ValenceCaps {
    /// Covalent valence caps of the molecular recipe. Unlisted elements are uncapped.
    /// H is 1, or 2 when bridging B–H–B; O is 3 (v1's harness choice).
    public static let caps: [Int: Int] = [
        1: 1,
        5: 4, 6: 4, 7: 4,
        8: 3,
        9: 1,
        4: 4,
        13: 6, 31: 6, 49: 6, 81: 6,
        14: 6, 32: 6, 50: 6, 82: 6,
        15: 6, 33: 6, 51: 6, 83: 6,
        16: 6, 34: 6, 52: 6, 84: 6,
        17: 7, 35: 7, 53: 7,
        54: 8,
        36: 2,
    ]

    /// At most `limit` covalent partners outside `allowed`: halogens keep one
    /// ordinary partner; Xe and Kr bond only to O/F and F.
    public struct PartnerRule: Sendable {
        public let allowed: Set<Int>
        public let limit: Int
    }

    public static let partnerRules: [Int: PartnerRule] = [
        17: PartnerRule(allowed: [8, 9], limit: 1),
        35: PartnerRule(allowed: [8, 9], limit: 1),
        53: PartnerRule(allowed: [8, 9], limit: 1),
        54: PartnerRule(allowed: [8, 9], limit: 0),
        36: PartnerRule(allowed: [9], limit: 0),
    ]

    /// Ionic-contact caps per s-block ion.
    public static let ionCoordinationCaps: [Int: Int] = [
        3: 6, 12: 6,
        11: 8, 20: 8,
        19: 10, 38: 10,
        37: 12, 55: 12, 87: 12, 56: 12, 88: 12,
    ]
}
