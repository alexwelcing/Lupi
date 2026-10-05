/// Valence rules for building: which loose atoms may snap together, and how
/// many more partners an atom takes. Consistent with lupi-bonds.molecular.v1:
/// covalent bonds only between hydrogen and covalent-class atoms and never
/// past its caps (`ValenceCaps`), coordination only at metals, ionic contacts
/// only between an s-block ion and a donor, noble gases never.
public enum Valence {
    /// Standard covalent valences, ascending. An atom fills the smallest one
    /// that covers what it already uses (S: 2, then 4, then 6). Empty for
    /// elements that make no covalent bonds in play.
    public static func standardValences(_ z: Int) -> [Int] {
        switch z {
        case 1, 9, 85: [1]
        case 5: [3, 4]
        case 6, 14: [4]
        case 7: [3, 4]
        case 8: [2, 3]
        case 15, 33, 51, 83: [3, 5]
        case 16, 34, 52: [2, 4, 6]
        case 17, 35, 53: [1, 3, 5, 7]
        case 4: [2]
        case 13, 31, 49: [3]
        case 81: [1, 3]
        case 32, 50, 82: [2, 4]
        case 84: [2, 4]
        case 54: [2, 4, 6, 8]
        case 36: [2]
        default: []
        }
    }

    /// The valence a loose atom starts with: H 1, C 4, N 3, O 2, F 1, P 3, S 2, Cl 1.
    public static func defaultValence(_ z: Int) -> Int { standardValences(z).first ?? 0 }

    /// Ligands a metal takes when building (an octahedron); the recipe allows up to 12.
    public static let buildCoordinationCap = 6
    /// Metals one ligand may bridge.
    public static let ligandMetalCap = 2

    /// Whether atoms in these two states may link, and as what.
    public static func canBond(_ a: AtomBondState, _ b: AtomBondState) -> BondKind? {
        let ca = ElementClass(z: a.z)
        let cb = ElementClass(z: b.z)
        if ca == .inert || cb == .inert { return nil }
        let covalentA = ca == .hydrogen || ca == .covalent
        let covalentB = cb == .hydrogen || cb == .covalent
        if covalentA && covalentB {
            if a.z == 1 && b.z == 1 && (a.linkCount > 0 || b.linkCount > 0) { return nil }
            guard a.freeValence >= 1, b.freeValence >= 1 else { return nil }
            guard a.withinRecipeCaps(adding: b.z), b.withinRecipeCaps(adding: a.z) else { return nil }
            return .covalent
        }
        if ca == .metal || cb == .metal {
            if ca == .metal && cb == .metal {
                return a.freeValence >= 1 && b.freeValence >= 1 ? .coordination : nil
            }
            let metal = ca == .metal ? a : b
            let ligand = ca == .metal ? b : a
            let ligandClass = ca == .metal ? cb : ca
            guard ligandClass == .covalent || ligandClass == .hydrogen, metal.freeValence >= 1 else { return nil }
            guard ligand.coordinationCount < ligandMetalCap else { return nil }
            // A hydrogen that already has a covalent partner loses metal contacts (recipe step 3).
            if ligandClass == .hydrogen && !ligand.covalentPartners.isEmpty { return nil }
            return .coordination
        }
        if ca == .ion || cb == .ion {
            if ca == .ion && cb == .ion { return nil }
            let ion = ca == .ion ? a : b
            let donor = ca == .ion ? b : a
            guard BondRadii.donor[donor.z] != nil, ion.freeValence >= 1 else { return nil }
            return .ionicContact
        }
        return nil
    }

    /// The rest length a new link snaps to, Å: the radius sum the recipe uses for that kind.
    public static func restLength(_ za: Int, _ zb: Int, kind: BondKind) -> Double {
        switch kind {
        case .covalent:
            return BondRadii.covalent(za) + BondRadii.covalent(zb)
        case .coordination:
            let ra = ElementClass(z: za) == .metal ? BondRadii.metal(za) : BondRadii.covalent(za)
            let rb = ElementClass(z: zb) == .metal ? BondRadii.metal(zb) : BondRadii.covalent(zb)
            return ra + rb
        case .ionicContact:
            let ion = ElementClass(z: za) == .ion ? za : zb
            let donor = ion == za ? zb : za
            return (BondRadii.ion[ion] ?? BondRadii.covalent(ion)) + (BondRadii.donor[donor] ?? BondRadii.covalent(donor))
        }
    }
}

/// What an atom is already bonded to, for the snap rules.
public struct AtomBondState: Sendable, Equatable {
    public var z: Int
    /// Atomic numbers of its covalent partners.
    public var covalentPartners: [Int]
    /// Sum of its covalent bond orders.
    public var covalentOrderSum: Double
    public var coordinationCount: Int
    public var contactCount: Int

    public init(
        z: Int, covalentPartners: [Int] = [], covalentOrderSum: Double = 0, coordinationCount: Int = 0,
        contactCount: Int = 0
    ) {
        self.z = z
        self.covalentPartners = covalentPartners
        self.covalentOrderSum = covalentOrderSum
        self.coordinationCount = coordinationCount
        self.contactCount = contactCount
    }

    /// A loose atom.
    public static func loose(_ z: Int) -> AtomBondState { AtomBondState(z: z) }

    public init(atom: Int, graph: BondGraph, molecule: Molecule) {
        var partners: [Int] = []
        var orders = 0.0
        var coordination = 0
        var contacts = 0
        for k in graph.incident[atom] {
            let bond = graph.bonds[k]
            switch bond.kind {
            case .covalent:
                partners.append(molecule.atomicNumbers[bond.other(atom)])
                orders += bond.order.value
            case .coordination:
                coordination += 1
            case .ionicContact:
                contacts += 1
            }
        }
        self.init(
            z: molecule.atomicNumbers[atom], covalentPartners: partners, covalentOrderSum: orders,
            coordinationCount: coordination, contactCount: contacts
        )
    }

    var linkCount: Int { covalentPartners.count + coordinationCount + contactCount }

    /// Valence in use, rounded (benzene's C: 1.5 + 1.5 + 1 = 4).
    public var usedValence: Int { Int(covalentOrderSum.rounded()) }

    /// How many more partners it takes: covalent valence left for H and
    /// covalent-class atoms, coordination slots for metals, contact slots for ions.
    public var freeValence: Int {
        switch ElementClass(z: z) {
        case .inert:
            return 0
        case .metal:
            return max(0, Valence.buildCoordinationCap - coordinationCount)
        case .ion:
            return max(0, (ValenceCaps.ionCoordinationCaps[z] ?? 0) - contactCount)
        case .hydrogen, .covalent:
            let valences = Valence.standardValences(z)
            guard let largest = valences.last else { return 0 }
            let used = usedValence
            let fill = valences.first { $0 >= used } ?? largest
            return max(0, fill - used)
        }
    }

    /// The recipe's caps after one more covalent partner of atomic number `partner`.
    func withinRecipeCaps(adding partner: Int) -> Bool {
        let cap = z == 8 ? MolecularRecipeParams.v1.oxygenCap : (ValenceCaps.caps[z] ?? Int.max)
        if covalentPartners.count + 1 > cap { return false }
        if let rule = ValenceCaps.partnerRules[z], !rule.allowed.contains(partner) {
            let restricted = covalentPartners.filter { !rule.allowed.contains($0) }.count
            if restricted + 1 > rule.limit { return false }
        }
        return true
    }
}

extension Molecule {
    /// This molecule followed by `other`'s atoms.
    public func appending(_ other: Molecule) -> Molecule {
        Molecule(
            atomicNumbers: atomicNumbers + other.atomicNumbers, positions: positions + other.positions,
            name: nil, chemistry: nil, periodic: false
        )
    }
}

/// Joining atoms into molecules by the valence rules, at the graph level. Play goes through
/// `Snapper`, which also places the atoms and checks the result by re-perception.
public enum Snap {
    /// Links atoms `a` and `b` of one body (a ring closure or a new bond),
    /// or nil when the rules refuse or they are already linked.
    public static func link(_ molecule: Molecule, _ graph: BondGraph, _ a: Int, _ b: Int) -> BondGraph? {
        guard a != b, graph.bondIndex(a, b) == nil else { return nil }
        let sa = AtomBondState(atom: a, graph: graph, molecule: molecule)
        let sb = AtomBondState(atom: b, graph: graph, molecule: molecule)
        guard let kind = Valence.canBond(sa, sb) else { return nil }
        let length = Valence.restLength(molecule.atomicNumbers[a], molecule.atomicNumbers[b], kind: kind)
        return graph.adding(GraphBond(i: a, j: b, kind: kind, order: .single, length: Float(length)))
    }

    /// Joins atom `a` of the first body to atom `b` of the second. The merged
    /// molecule lists the first body's atoms, then the second's (b becomes
    /// `first.count + b`). Positions are kept as given: the game moves atoms.
    public static func join(
        _ first: Molecule, _ firstGraph: BondGraph, atom a: Int,
        _ second: Molecule, _ secondGraph: BondGraph, atom b: Int
    ) -> (molecule: Molecule, graph: BondGraph)? {
        let merged = first.appending(second)
        let mergedGraph = firstGraph.appending(secondGraph)
        guard let linked = link(merged, mergedGraph, a, first.count + b) else { return nil }
        var named = merged
        named.name = merged.hillFormula
        return (named, linked)
    }
}
