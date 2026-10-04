import LupiChem

/// The graph and shape facts a personality is derived from. Computed once
/// per molecule (and again for each fragment it breaks into).
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
    public var hasCage: Bool
    /// Share of heavy-atom covalent bonds estimated delocalized (aromatic).
    public var delocalizedFraction: Double
    /// s-block ions present (Li, Na, K, Mg, Ca, …).
    public var ions: Int
    public var ionicContacts: Int
    public var coordinationBonds: Int
    /// Covalent bonds more than 0.20 Å over their radius sum.
    public var longBonds: Int
    /// The bond that snaps first: the weakest whose cut alone splits the molecule.
    public var weakestBond: WeakBond?
    /// What a hit must overcome to make two pieces, kJ/mol: the weakest
    /// splitting bond or, when every bond lies on a cycle (cages, bare
    /// rings, salt clusters), the cheapest atom to knock off, the sum of its
    /// bonds. That is the true minimum cut for cages and simple rings. Nil
    /// with no bonds.
    public var cutStrength: Double?
    public var rotor: RotorType
    /// Å.
    public var radiusOfGyration: Double

    public struct WeakBond: Sendable, Equatable, Codable {
        /// "O–O", "C=O", "C–C (delocalized)", "Na···Cl".
        public var label: String
        public var kJPerMol: Double
    }

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
        rotatableBonds = graph.rotatableBonds(in: molecule).count
        cycleCount = rings.cycleCount
        ringSystems = rings.systems.count
        largestRingSystem = rings.systems.map(\.cycleCount).max() ?? 0
        hasCage = rings.systems.contains { $0.isCage }
        delocalizedFraction = heavyCovalent.isEmpty
            ? 0 : Double(heavyCovalent.filter { $0.order == .delocalized }.count) / Double(heavyCovalent.count)
        ions = z.filter { ElementClass(z: $0) == .ion }.count
        ionicContacts = graph.bonds.filter { $0.kind == .ionicContact }.count
        coordinationBonds = graph.bonds.filter { $0.kind == .coordination }.count
        longBonds = covalent.filter {
            Double($0.length) - (BondRadii.covalent(z[$0.i]) + BondRadii.covalent(z[$0.j])) > BondConstants.longExcess
        }.count

        let ranked = graph.weakestBonds(in: molecule)
        if let first = ranked.first(where: \.splits) {
            weakestBond = WeakBond(label: Self.label(first.bond, z), kJPerMol: first.kJPerMol)
            cutStrength = first.kJPerMol
        } else if let first = ranked.first {
            weakestBond = WeakBond(label: Self.label(first.bond, z), kJPerMol: first.kJPerMol)
            var cheapestAtom = Double.infinity
            for atom in 0..<graph.atomCount where !graph.incident[atom].isEmpty {
                let sum = graph.incident[atom].reduce(0.0) { $0 + BondStrength.kJPerMol(graph.bonds[$1], in: molecule) }
                cheapestAtom = min(cheapestAtom, sum)
            }
            cutStrength = cheapestAtom
        } else {
            weakestBond = nil
            cutStrength = nil
        }
        rotor = inertia.rotor
        radiusOfGyration = inertia.radiusOfGyration
    }

    static func label(_ bond: GraphBond, _ z: [Int]) -> String {
        let a = Element.forAtomicNumber(z[bond.i]).symbol
        let b = Element.forAtomicNumber(z[bond.j]).symbol
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
