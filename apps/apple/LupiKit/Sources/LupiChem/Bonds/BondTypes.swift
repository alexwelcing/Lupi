/// The two bond rules the web names (packages/core/src/bonds/types.ts).
public enum BondRecipe: String, Sendable, Codable, CaseIterable {
    case molecular = "lupi-bonds.molecular.v1"
    case distance = "lupi-bonds.distance.v1"
}

/// Drawn as a solid stick, a dashed coordination line, or a dotted ionic contact.
public enum BondKind: UInt8, Sendable, Codable, CaseIterable, Comparable {
    case covalent = 0
    case coordination = 1
    case ionicContact = 2

    public static func < (a: BondKind, b: BondKind) -> Bool { a.rawValue < b.rawValue }
}

/// Why a candidate pair was not drawn. Codes are stable across versions.
public enum RemovalReason: UInt8, Sendable, Codable, CaseIterable {
    case clash = 1
    case hydrogenPair = 2
    case hydrogenSinglePartner = 3
    case hydrogenMetalContact = 4
    case acuteAngle = 5
    case valenceCap = 6
    case hapticTrim = 7
    case metalCoordinationCap = 8
    case ionDonorPrecedence = 9
    case ionCoordinationCap = 10
    case bridgedPair = 11
}

public struct BondCounts: Sendable, Hashable, Codable {
    public var covalent = 0
    public var coordination = 0
    public var ionicContact = 0
    /// Covalent bonds more than 0.20 Å longer than the covalent-radius sum.
    public var long = 0
    /// Pairs dropped by steps 2–8 of the molecular recipe (clashes are counted separately).
    public var removed = 0
    /// Covalent-class pairs just outside the tolerance: τ < e ≤ τ + 0.20 Å.
    public var nearMiss = 0
    /// Pairs closer than 0.40 Å.
    public var clashes = 0
    /// Connected components over covalent and coordination bonds (isolated atoms included).
    public var fragments = 0
    /// H atoms bonded to two non-hydrogen partners (B–H–B, M–H–M).
    public var bridgingH = 0
    /// s-block ions within r_cov(M) + r_cov(C) + τ of a carbon (no line is drawn for these).
    public var ionCarbonClose = 0

    public init() {}
}

/// One drawn pair, i < j.
public struct PerceivedBond: Sendable, Hashable {
    public var i: Int
    public var j: Int
    public var kind: BondKind
    /// Å, rounded to Float32 as the web's `distances`.
    public var distance: Float
    /// d − (r_cov,i + r_cov,j), Å.
    public var excess: Float
}

/// One pair the molecular recipe dropped, with why.
public struct RemovedPair: Sendable, Hashable {
    public var i: Int
    public var j: Int
    public var reason: RemovalReason
    public var distance: Float
}

public struct PerceivedBonds: Sendable, Equatable {
    public var recipe: BondRecipe
    public var tolerance: Double
    public var contactMargin: Double
    public var clashFloor: Double
    public var longExcess: Double
    /// Sorted by (i, j).
    public var bonds: [PerceivedBond]
    /// Removed pairs sorted by (i, j); nil when evidence was not collected.
    public var evidence: [RemovedPair]?
    public var counts: BondCounts

    public var count: Int { bonds.count }
}
