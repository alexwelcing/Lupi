/// How hard a bond is to break, as a mean bond enthalpy in kJ/mol.
///
/// Covalent values are the average bond energies of Huheey, Keiter & Keiter,
/// *Inorganic Chemistry*, 4th ed. (1993), as tabulated by LibreTexts
/// ("Strength of Covalent Bonds", Chemistry 101A, City College of San
/// Francisco), the table docs/ar/research/chemistry-play-physics.md cites.
/// Mean enthalpies are not the dissociation energy of a specific bond (expect
/// 10–20% error), but they order bonds truly: the weakest goes first. Where
/// the table is silent the value is a labelled Lupi estimate.
public enum BondStrength {
    /// Single bonds, keyed by the sorted pair of atomic numbers.
    public static let single: [ElementPair: Double] = [
        ElementPair(1, 1): 432, ElementPair(1, 6): 411, ElementPair(1, 14): 318, ElementPair(1, 7): 391,
        ElementPair(1, 15): 322, ElementPair(1, 8): 459, ElementPair(1, 16): 363, ElementPair(1, 9): 565,
        ElementPair(1, 17): 428, ElementPair(1, 35): 362, ElementPair(1, 53): 295,
        ElementPair(6, 6): 346, ElementPair(6, 14): 318, ElementPair(6, 7): 305, ElementPair(6, 8): 358,
        ElementPair(6, 16): 272, ElementPair(6, 9): 485, ElementPair(6, 17): 327, ElementPair(6, 35): 285,
        ElementPair(6, 53): 213, ElementPair(14, 14): 222, ElementPair(8, 14): 452,
        ElementPair(7, 7): 167, ElementPair(7, 8): 201, ElementPair(7, 9): 283, ElementPair(7, 17): 313,
        ElementPair(7, 35): 243, ElementPair(15, 15): 201,
        ElementPair(8, 8): 142, ElementPair(8, 9): 190, ElementPair(8, 17): 218, ElementPair(8, 35): 201,
        ElementPair(8, 53): 201, ElementPair(16, 16): 226, ElementPair(9, 16): 284, ElementPair(16, 17): 255,
        ElementPair(16, 35): 218,
        ElementPair(9, 9): 155, ElementPair(9, 17): 249, ElementPair(9, 35): 249, ElementPair(9, 53): 278,
        ElementPair(17, 17): 240, ElementPair(17, 35): 216, ElementPair(17, 53): 208, ElementPair(35, 35): 190,
        ElementPair(35, 53): 175, ElementPair(53, 53): 149,
    ]

    public static let double: [ElementPair: Double] = [
        ElementPair(6, 6): 614, ElementPair(6, 7): 615, ElementPair(8, 8): 495, ElementPair(7, 8): 607,
        ElementPair(7, 7): 418, ElementPair(6, 8): 745,
    ]

    public static let triple: [ElementPair: Double] = [
        ElementPair(6, 6): 839, ElementPair(6, 7): 887, ElementPair(7, 7): 941, ElementPair(6, 8): 1072,
    ]

    // Lupi estimates (no table value), chosen to keep the true orderings:
    /// A pair the table lacks: Pauling's rule when both homonuclear single
    /// bonds are known, D(A–B) = √(D(A–A)·D(B–B)) + 96.485·(χA − χB)², the
    /// electronegativity term in eV converted to kJ/mol (it reproduces the
    /// table's own C–Si, 318); else this.
    public static let unknownSingle = 250.0
    /// 1 eV per particle in kJ/mol.
    static let electronVolt = 96.485
    /// Multiple bonds the table lacks: the single bond times the C=C/C–C and C≡C/C–C ratios.
    public static let doubleRatio = 614.0 / 346.0
    public static let tripleRatio = 839.0 / 346.0
    /// Coordination lines give way before covalent sticks (chemistry-play-physics §4.3).
    public static let coordination = 150.0
    /// Ionic contacts give way first: salt crystals cleave.
    public static let ionicContact = 100.0

    public static func kJPerMol(_ za: Int, _ zb: Int, kind: BondKind = .covalent, order: BondOrder = .single) -> Double {
        switch kind {
        case .coordination: return coordination
        case .ionicContact: return ionicContact
        case .covalent: break
        }
        let pair = ElementPair(za, zb)
        let s = singleBond(pair)
        switch order {
        case .single: return s
        case .double: return double[pair] ?? s * doubleRatio
        case .triple: return triple[pair] ?? s * tripleRatio
        case .delocalized: return (s + (double[pair] ?? s * doubleRatio)) / 2
        }
    }

    static func singleBond(_ pair: ElementPair) -> Double {
        if let value = single[pair] { return value }
        if let a = single[ElementPair(pair.a, pair.a)], let b = single[ElementPair(pair.b, pair.b)] {
            let chiA = Element.forAtomicNumber(pair.a).electronegativity ?? 0
            let chiB = Element.forAtomicNumber(pair.b).electronegativity ?? 0
            return (a * b).squareRoot() + electronVolt * (chiA - chiB) * (chiA - chiB)
        }
        return unknownSingle
    }

    public static func kJPerMol(_ bond: GraphBond, in molecule: Molecule) -> Double {
        kJPerMol(molecule.atomicNumbers[bond.i], molecule.atomicNumbers[bond.j], kind: bond.kind, order: bond.order)
    }
}

/// An unordered pair of atomic numbers.
public struct ElementPair: Sendable, Hashable, Codable {
    public let a: Int
    public let b: Int
    public init(_ x: Int, _ y: Int) {
        a = min(x, y)
        b = max(x, y)
    }
}

/// A bond with its strength, for picking what snaps first.
public struct RankedBond: Sendable, Equatable {
    public var index: Int
    public var bond: GraphBond
    public var kJPerMol: Double
    /// Cutting it alone splits the molecule.
    public var splits: Bool
}

extension BondGraph {
    /// Bonds weakest first. Ties: the more stretched (longer than its radius
    /// sum) first, then lower (i, j). `splittingOnly` keeps bonds whose cut
    /// alone makes two fragments (bridges), so breaking always makes pieces.
    public func weakestBonds(in molecule: Molecule, splittingOnly: Bool = false) -> [RankedBond] {
        let ringBond = ringBondMask(kinds: BondGraph.allKinds)
        let z = molecule.atomicNumbers
        var ranked: [(RankedBond, Double)] = []
        for (k, bond) in bonds.enumerated() {
            let splits = !ringBond[k]
            if splittingOnly && !splits { continue }
            let excess = Double(bond.length) - (BondRadii.covalent(z[bond.i]) + BondRadii.covalent(z[bond.j]))
            ranked.append((RankedBond(index: k, bond: bond, kJPerMol: BondStrength.kJPerMol(bond, in: molecule), splits: splits), excess))
        }
        ranked.sort { p, q in
            if p.0.kJPerMol != q.0.kJPerMol { return p.0.kJPerMol < q.0.kJPerMol }
            if p.1 != q.1 { return p.1 > q.1 }
            if p.0.bond.i != q.0.bond.i { return p.0.bond.i < q.0.bond.i }
            return p.0.bond.j < q.0.bond.j
        }
        return ranked.map(\.0)
    }

    /// The bond that snaps first when the molecule is hit hard enough, or nil when no single cut splits it.
    public func weakestSplittingBond(in molecule: Molecule) -> RankedBond? {
        weakestBonds(in: molecule, splittingOnly: true).first
    }
}
