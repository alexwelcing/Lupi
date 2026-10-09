/// Bond order, estimated from geometry until `lupi-bond-orders.v1` exists
/// (docs/omol25-bonds-and-discovery.md §2.6 specifies it; no code has it yet).
public enum BondOrder: String, Sendable, Codable, CaseIterable, Comparable {
    case single
    /// Aromatic or otherwise between single and double (benzene, amide C–N, nitro N–O).
    case delocalized
    case double
    case triple

    public var value: Double {
        switch self {
        case .single: 1
        case .delocalized: 1.5
        case .double: 2
        case .triple: 3
        }
    }

    public static func < (a: BondOrder, b: BondOrder) -> Bool { a.value < b.value }
}

/// One link of a molecule's graph, i < j.
public struct GraphBond: Sendable, Hashable, Codable {
    public var i: Int
    public var j: Int
    public var kind: BondKind
    /// Meaningful for covalent bonds; coordination and ionic contacts are `.single`.
    public var order: BondOrder
    /// Rest length, Å.
    public var length: Float

    public init(i: Int, j: Int, kind: BondKind = .covalent, order: BondOrder = .single, length: Float) {
        self.i = min(i, j)
        self.j = max(i, j)
        self.kind = kind
        self.order = order
        self.length = length
    }

    public func other(_ atom: Int) -> Int { atom == i ? j : i }
    public func touches(_ atom: Int) -> Bool { atom == i || atom == j }
}

/// A molecule's bonds as a graph: covalent sticks, coordination lines and
/// ionic contacts, sorted by (i, j), with per-atom adjacency.
public struct BondGraph: Sendable, Equatable {
    public let atomCount: Int
    public let bonds: [GraphBond]
    /// Bond indices touching each atom, in bond order.
    public let incident: [[Int]]

    public static let allKinds: Set<BondKind> = [.covalent, .coordination, .ionicContact]

    /// Duplicates and self-pairs are dropped; the first of a duplicate pair wins.
    public init(atomCount: Int, bonds: [GraphBond]) {
        var seen = Set<Int>()
        var kept: [GraphBond] = []
        for bond in bonds where bond.i != bond.j && bond.i >= 0 && bond.j < atomCount {
            if seen.insert(bond.i * atomCount + bond.j).inserted { kept.append(bond) }
        }
        kept.sort { $0.i != $1.i ? $0.i < $1.i : $0.j < $1.j }
        var incident = [[Int]](repeating: [], count: atomCount)
        for (k, bond) in kept.enumerated() {
            incident[bond.i].append(k)
            incident[bond.j].append(k)
        }
        self.atomCount = atomCount
        self.bonds = kept
        self.incident = incident
    }

    /// The perceived bonds of `molecule`, with orders estimated from their lengths.
    public init(molecule: Molecule, perceived: PerceivedBonds) {
        let raw = perceived.bonds.map { GraphBond(i: $0.i, j: $0.j, kind: $0.kind, order: .single, length: $0.distance) }
        let draft = BondGraph(atomCount: molecule.count, bonds: raw)
        self.init(atomCount: molecule.count, bonds: BondOrderEstimate.assign(draft, molecule: molecule))
    }

    /// The graph the game plays with: the molecular recipe wherever the viewer
    /// could apply it (a non-periodic structure of at most 2,000 atoms), so
    /// hydrogens keep one partner and the snap rules share its caps; the
    /// distance recipe beyond that.
    public static func forPlay(_ molecule: Molecule, tolerance: Double? = nil) -> BondGraph {
        let recipe: BondRecipe = !molecule.periodic && molecule.count <= BondConstants.molecularRecipeMaxAtoms
            ? .molecular : .distance
        let perceived = BondPerception.perceive(molecule, recipe: recipe, tolerance: tolerance, collectEvidence: false)
        return BondGraph(molecule: molecule, perceived: perceived)
    }

    public func bondIndex(_ a: Int, _ b: Int) -> Int? {
        incident[a].first { bonds[$0].other(a) == b }
    }

    public func neighbors(of atom: Int, kinds: Set<BondKind> = BondGraph.allKinds) -> [Int] {
        incident[atom].compactMap { kinds.contains(bonds[$0].kind) ? bonds[$0].other(atom) : nil }
    }

    public func degree(of atom: Int, kinds: Set<BondKind> = [.covalent]) -> Int {
        incident[atom].reduce(0) { $0 + (kinds.contains(bonds[$1].kind) ? 1 : 0) }
    }

    /// Connected components, each sorted, ordered by their smallest atom.
    /// Ionic contacts count by default: the game keeps a salt cluster in one piece.
    public func components(kinds: Set<BondKind> = BondGraph.allKinds, excluding cut: Set<Int> = []) -> [[Int]] {
        var label = [Int](repeating: -1, count: atomCount)
        var out: [[Int]] = []
        for seed in 0..<atomCount where label[seed] < 0 {
            let id = out.count
            var members: [Int] = [seed]
            label[seed] = id
            var head = 0
            while head < members.count {
                let atom = members[head]
                head += 1
                for k in incident[atom] where !cut.contains(k) && kinds.contains(bonds[k].kind) {
                    let next = bonds[k].other(atom)
                    if label[next] < 0 {
                        label[next] = id
                        members.append(next)
                    }
                }
            }
            out.append(members.sorted())
        }
        return out
    }

    /// A copy with `bond` added (or replacing the existing pair).
    public func adding(_ bond: GraphBond) -> BondGraph {
        BondGraph(atomCount: atomCount, bonds: [bond] + bonds.filter { !($0.i == bond.i && $0.j == bond.j) })
    }

    /// A copy without the bonds at `indices`.
    public func removing(_ indices: Set<Int>) -> BondGraph {
        BondGraph(atomCount: atomCount, bonds: bonds.enumerated().filter { !indices.contains($0.offset) }.map(\.element))
    }

    /// This graph followed by `other`'s atoms (renumbered after this one's).
    public func appending(_ other: BondGraph) -> BondGraph {
        let shifted = other.bonds.map {
            GraphBond(i: $0.i + atomCount, j: $0.j + atomCount, kind: $0.kind, order: $0.order, length: $0.length)
        }
        return BondGraph(atomCount: atomCount + other.atomCount, bonds: bonds + shifted)
    }
}

extension BondGraph: Codable {
    private enum CodingKeys: String, CodingKey { case atomCount, bonds }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            atomCount: try container.decode(Int.self, forKey: .atomCount),
            bonds: try container.decode([GraphBond].self, forKey: .bonds)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(atomCount, forKey: .atomCount)
        try container.encode(bonds, forKey: .bonds)
    }
}

/// Bond orders from bond lengths: a covalent bond's excess over the
/// single-bond radius sum (Cordero) reads as single (≥ −0.08 Å), delocalized
/// (−0.17 to −0.08), double (−0.28 to −0.17) or triple (< −0.28). Bonds to
/// H, or to an atom with four or more covalent partners, are single; a
/// terminal O, S or Se on a short bond is double (C=O, O=O, P=O), or triple
/// past −0.28 Å (C≡O). An estimate
/// for strength classes and rotatable bonds, labelled as such, until
/// `lupi-bond-orders.v1` ships.
public enum BondOrderEstimate {
    public static let singleFloor = -0.08
    public static let doubleFloor = -0.17
    public static let tripleFloor = -0.28

    static func assign(_ graph: BondGraph, molecule: Molecule) -> [GraphBond] {
        let z = molecule.atomicNumbers
        let degree = (0..<graph.atomCount).map { graph.degree(of: $0) }
        return graph.bonds.map { bond in
            guard bond.kind == .covalent else { return bond }
            var out = bond
            out.order = order(
                zi: z[bond.i], zj: z[bond.j], length: Double(bond.length),
                degreeI: degree[bond.i], degreeJ: degree[bond.j]
            )
            return out
        }
    }

    public static func order(zi: Int, zj: Int, length: Double, degreeI: Int, degreeJ: Int) -> BondOrder {
        if zi == 1 || zj == 1 || degreeI >= 4 || degreeJ >= 4 { return .single }
        let excess = length - (BondRadii.covalent(zi) + BondRadii.covalent(zj))
        if excess >= singleFloor { return .single }
        let chalcogen: Set<Int> = [8, 16, 34]
        if (chalcogen.contains(zi) && degreeI == 1) || (chalcogen.contains(zj) && degreeJ == 1) {
            return excess < tripleFloor ? .triple : .double
        }
        if excess >= doubleFloor { return .delocalized }
        if excess >= tripleFloor { return .double }
        return .triple
    }
}
