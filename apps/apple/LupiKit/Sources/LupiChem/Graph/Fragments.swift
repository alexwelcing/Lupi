/// A piece of a broken molecule: a molecule of its own, kept as a real
/// structure (atoms, positions, bonds), plus where it came from.
public struct Fragment: Sendable, Equatable {
    public var molecule: Molecule
    public var graph: BondGraph
    /// The parent's index of each fragment atom, ascending.
    public var parentIndices: [Int]
    /// Valence the cut freed on each fragment atom (covalent bond orders, summed): the radical sites a loose atom can snap onto.
    public var openValence: [Double]
}

extension BondGraph {
    /// Rotatable bonds: single covalent bonds outside rings between two heavy
    /// atoms that each have another heavy neighbour (so turning it moves
    /// something). Orders are length estimates (`BondOrderEstimate`).
    public func rotatableBonds(in molecule: Molecule, ringBond: [Bool]? = nil) -> [Int] {
        let ring = ringBond ?? ringBondMask(kinds: [.covalent])
        let z = molecule.atomicNumbers
        func heavyNeighbors(_ atom: Int) -> Int {
            incident[atom].reduce(0) { n, k in
                bonds[k].kind == .covalent && z[bonds[k].other(atom)] != 1 ? n + 1 : n
            }
        }
        return bonds.indices.filter { k in
            let bond = bonds[k]
            return bond.kind == .covalent && bond.order == .single && !ring[k]
                && z[bond.i] != 1 && z[bond.j] != 1
                && heavyNeighbors(bond.i) >= 2 && heavyNeighbors(bond.j) >= 2
        }
    }

    /// Cuts the bonds at `cut` and returns the connected pieces (over every
    /// bond kind, so ions stay with their contacts), ordered by their lowest
    /// parent atom. Cutting a ring bond alone leaves one piece.
    public func split(_ molecule: Molecule, cutting cut: Set<Int>) -> [Fragment] {
        var freed = [Double](repeating: 0, count: atomCount)
        for k in cut where k >= 0 && k < bonds.count && bonds[k].kind == .covalent {
            freed[bonds[k].i] += bonds[k].order.value
            freed[bonds[k].j] += bonds[k].order.value
        }
        let kept = removing(cut)
        return kept.components().map { members in
            var local = [Int: Int]()
            for (n, atom) in members.enumerated() { local[atom] = n }
            var pieceBonds: [GraphBond] = []
            for atom in members {
                for k in kept.incident[atom] where kept.bonds[k].i == atom {
                    let bond = kept.bonds[k]
                    pieceBonds.append(GraphBond(
                        i: local[bond.i]!, j: local[bond.j]!, kind: bond.kind, order: bond.order, length: bond.length
                    ))
                }
            }
            var piece = molecule.subset(members)
            piece.name = piece.hillFormula
            return Fragment(
                molecule: piece, graph: BondGraph(atomCount: members.count, bonds: pieceBonds),
                parentIndices: members, openValence: members.map { freed[$0] }
            )
        }
    }
}
