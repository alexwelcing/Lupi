import LupiChem

/// The graph and shape facts a personality is derived from (`lupi.personality.rules.v1`,
/// contracts.md §3.3). Computed once per molecule, and again for each fragment it breaks into.
public struct MolecularFeatures: Sendable, Equatable, Codable {
    public var atomCount: Int
    public var heavyAtomCount: Int
    /// g/mol.
    public var molarMass: Double
    public var covalentBonds: Int
    public var rotatableBonds: Int
    /// Independent cycles over covalent bonds.
    public var cycleCount: Int
    public var ringSystems: Int
    /// The most cycles in any one ring system (2 = naphthalene, 4 = a steroid).
    public var largestRingSystem: Int
    /// The smallest ring over covalent bonds (3 for cyclopropane, 4 for cubane), nil without rings
    /// or when the ring search was skipped for a colossus.
    public var smallestRing: Int?
    /// Heavy atoms with at least one covalent ring bond.
    public var heavyAtomsInRings: Int
    /// A ring system closed around a volume (C₆₀, adamantane): the shape test of `RingSystem.isCage`.
    public var hasCage: Bool
    /// Share of heavy-atom covalent bonds estimated delocalized (aromatic).
    public var delocalizedFraction: Double
    /// s-block ions present (Li, Na, K, Mg, Ca, …).
    public var ions: Int
    public var ionicContacts: Int
    public var coordinationBonds: Int
    /// Covalent bonds more than 0.20 Å over their radius sum.
    public var longBonds: Int
    /// The lowest-energy bond over the whole graph, ties to the lower atom indices (contracts.md §3.3
    /// rule 3), with the contract's order and energy (rules 1 and 2).
    public var weakestBond: WeakBond?
    /// What a hit must overcome to make two pieces, kJ/mol: the weakest bridge or, when every
    /// bond lies on a cycle (cages, bare rings, salt clusters), the cheapest atom to knock off,
    /// the sum of its bonds. Nil with no bonds. Breaking itself is LupiScale's (scale-spec §10.6).
    public var cutStrength: Double?
    public var rotor: RotorType
    /// Å.
    public var radiusOfGyration: Double
    /// The element of every heavy atom when they are all one ("carbons"), else nil.
    public var soleHeavyElement: Int?

    public struct WeakBond: Sendable, Equatable, Codable {
        /// "O–O", "C=O", "C–C (delocalized)", "Na···Cl".
        public var label: String
        public var kJPerMol: Double
        /// The two atoms, the lower index first.
        public var atoms: [Int]
        /// Their element symbols, in the same order.
        public var elements: [String]
        public var kind: BondKind
        public var order: BondOrder
        /// "table" for a cited mean bond enthalpy, "game" for a Lupi value (contracts.md §3.3 rule 2).
        public var energySource: String
    }

    /// Every heavy atom is in a ring and there are at least 20 (contracts.md §3.3 rule 4.2).
    public var isRingCage: Bool { heavyAtomCount >= 20 && heavyAtomsInRings == heavyAtomCount }

    public init(molecule: Molecule, graph: BondGraph) {
        let z = molecule.atomicNumbers
        let rings = graph.rings(molecule: molecule)
        let covalent = graph.bonds.filter { $0.kind == .covalent }
        let heavyCovalent = covalent.filter { z[$0.i] != 1 && z[$0.j] != 1 }
        let inertia = molecule.inertia

        atomCount = molecule.count
        heavyAtomCount = molecule.heavyAtomCount
        molarMass = molecule.molarMass
        covalentBonds = covalent.count
        let orders = Self.contractOrders(graph, z)
        rotatableBonds = Self.rotatableBonds(graph, z, orders: orders, ringBond: rings.ringBond).count
        cycleCount = rings.cycleCount
        ringSystems = rings.systems.count
        largestRingSystem = rings.systems.map(\.cycleCount).max() ?? 0
        smallestRing = rings.smallestRings?.map(\.size).min()
        var inRing = [Bool](repeating: false, count: molecule.count)
        for (k, bond) in graph.bonds.enumerated() where rings.ringBond[k] && bond.kind == .covalent {
            inRing[bond.i] = true
            inRing[bond.j] = true
        }
        heavyAtomsInRings = z.indices.filter { z[$0] != 1 && inRing[$0] }.count
        hasCage = rings.systems.contains { $0.isCage }
        delocalizedFraction = heavyCovalent.isEmpty
            ? 0 : Double(heavyCovalent.filter { $0.order == .delocalized }.count) / Double(heavyCovalent.count)
        ions = z.filter { ElementClass(z: $0) == .ion }.count
        ionicContacts = graph.bonds.filter { $0.kind == .ionicContact }.count
        coordinationBonds = graph.bonds.filter { $0.kind == .coordination }.count
        longBonds = covalent.filter {
            Double($0.length) - (BondRadii.covalent(z[$0.i]) + BondRadii.covalent(z[$0.j])) > BondConstants.longExcess
        }.count

        var weakest: WeakBond?
        for (k, bond) in graph.bonds.enumerated() {
            let w = Self.weak(bond, order: orders[k], z)
            guard let best = weakest else {
                weakest = w
                continue
            }
            if w.kJPerMol < best.kJPerMol || (w.kJPerMol == best.kJPerMol && w.atoms.lexicographicallyPrecedes(best.atoms)) {
                weakest = w
            }
        }
        weakestBond = weakest

        let ranked = graph.weakestBonds(in: molecule)
        if let first = ranked.first(where: \.splits) {
            cutStrength = first.kJPerMol
        } else if !ranked.isEmpty {
            var cheapestAtom = Double.infinity
            for atom in 0..<graph.atomCount where !graph.incident[atom].isEmpty {
                let sum = graph.incident[atom].reduce(0.0) { $0 + BondStrength.kJPerMol(graph.bonds[$1], in: molecule) }
                cheapestAtom = min(cheapestAtom, sum)
            }
            cutStrength = cheapestAtom
        } else {
            cutStrength = nil
        }
        rotor = inertia.rotor
        radiusOfGyration = inertia.radiusOfGyration
        let heavy = Set(z.filter { $0 != 1 })
        soleHeavyElement = heavy.count == 1 ? heavy.first : nil
    }

    /// contracts.md §3.3 rule 1: a covalent bond's order from `length / (r_cov,i + r_cov,j)`,
    /// ≤ 0.84 triple, ≤ 0.92 double, otherwise single. The personality's own estimate, so its
    /// weakest bond and rotors follow the contract; fragments and snaps keep LupiChem's orders.
    public static func contractOrder(length: Double, _ zi: Int, _ zj: Int) -> BondOrder {
        let ratio = length / (BondRadii.covalent(zi) + BondRadii.covalent(zj))
        if ratio <= 0.84 { return .triple }
        if ratio <= 0.92 { return .double }
        return .single
    }

    /// Each bond's contract order; nil for coordination bonds and ionic contacts.
    static func contractOrders(_ graph: BondGraph, _ z: [Int]) -> [BondOrder?] {
        graph.bonds.map { $0.kind == .covalent ? contractOrder(length: Double($0.length), z[$0.i], z[$0.j]) : nil }
    }

    /// contracts.md §3.3 rule 2: the cited table (LupiChem's `BondStrength`, the table
    /// chemistry-play-physics.md §4.1 cites) when the pair and order are in it, else the game
    /// defaults: single 350, double 600, triple 850, coordination 150, ionic contact 80.
    public static func contractEnergy(_ zi: Int, _ zj: Int, kind: BondKind, order: BondOrder?) -> (kJPerMol: Double, source: String) {
        switch kind {
        case .coordination: return (BondStrength.coordination, "game")
        case .ionicContact: return (BondStrength.ionicContact, "game")
        case .covalent: break
        }
        let pair = ElementPair(zi, zj)
        switch order ?? .single {
        case .single, .delocalized: return BondStrength.single[pair].map { ($0, "table") } ?? (350, "game")
        case .double: return BondStrength.double[pair].map { ($0, "table") } ?? (600, "game")
        case .triple: return BondStrength.triple[pair].map { ($0, "table") } ?? (850, "game")
        }
    }

    /// contracts.md §3.3 rule 4.3: covalent, order 1, outside every ring, and both atoms with at
    /// least two heavy-atom neighbours. Bond indices, ascending.
    public static func rotatableBonds(_ graph: BondGraph, _ z: [Int], orders: [BondOrder?], ringBond: [Bool]) -> [Int] {
        func heavyNeighbours(_ atom: Int) -> Int {
            graph.incident[atom].reduce(0) { n, k in
                graph.bonds[k].kind == .covalent && z[graph.bonds[k].other(atom)] != 1 ? n + 1 : n
            }
        }
        return graph.bonds.indices.filter { k in
            let b = graph.bonds[k]
            return b.kind == .covalent && orders[k] == .single && !ringBond[k]
                && z[b.i] != 1 && z[b.j] != 1 && heavyNeighbours(b.i) >= 2 && heavyNeighbours(b.j) >= 2
        }
    }

    /// The rotatable bonds of a molecule with its play graph, as the personality counts them.
    public static func rotatableBonds(in molecule: Molecule, graph: BondGraph) -> [Int] {
        let z = molecule.atomicNumbers
        return rotatableBonds(graph, z, orders: contractOrders(graph, z), ringBond: graph.ringBondMask(kinds: [.covalent]))
    }

    static func weak(_ bond: GraphBond, order: BondOrder?, _ z: [Int]) -> WeakBond {
        let (i, j) = bond.i <= bond.j ? (bond.i, bond.j) : (bond.j, bond.i)
        let energy = contractEnergy(z[bond.i], z[bond.j], kind: bond.kind, order: order)
        var labelled = bond
        if let order { labelled.order = order }
        return WeakBond(
            label: label(labelled, z), kJPerMol: energy.kJPerMol, atoms: [i, j],
            elements: [i, j].map { ChemicalElement.forAtomicNumber(z[$0]).symbol }, kind: bond.kind, order: labelled.order,
            energySource: energy.source
        )
    }

    static func label(_ bond: GraphBond, _ z: [Int]) -> String {
        let a = ChemicalElement.forAtomicNumber(z[bond.i]).symbol
        let b = ChemicalElement.forAtomicNumber(z[bond.j]).symbol
        switch bond.kind {
        case .ionicContact: return "\(a)···\(b)"
        case .coordination: return "\(a)–\(b)"
        case .covalent:
            switch bond.order {
            case .single: return "\(a)–\(b)"
            case .delocalized: return "\(a)–\(b) (delocalized)"
            case .double: return "\(a)=\(b)"
            case .triple: return "\(a)≡\(b)"
            }
        }
    }
}
