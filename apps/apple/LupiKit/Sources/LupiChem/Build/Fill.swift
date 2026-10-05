import Foundation

/// "One tap fills every open valence with hydrogens" (plan §4.5): each open atom
/// takes hydrogens on the free directions of its ideal geometry, the one with
/// the most room first, and the recipe checks the result like any snap.
public enum HydrogenFill {
    /// The atom count it stops at: the molecular recipe's cap.
    public static let maxAtoms = BondConstants.molecularRecipeMaxAtoms
    static let rounds = 4

    public struct Result: Sendable {
        public var piece: BuildPiece
        /// Hydrogens added; they follow the piece's own atoms, in the order they were placed.
        public var added: Int
        /// Atom index each new hydrogen is bonded to.
        public var partners: [Int]
    }

    /// The piece with every open covalent valence filled, or nil when nothing can be
    /// added. A hydrogen the check refuses (no room) is left out, and the rest stay.
    public static func fill(_ piece: BuildPiece) -> Result? {
        var skip = Set<HydrogenSlot>()
        for _ in 0..<rounds {
            let hydrogens = place(piece, skipping: skip)
            guard !hydrogens.isEmpty else { return nil }
            let molecule = piece.molecule.appending(Molecule(
                atomicNumbers: hydrogens.map { _ in 1 }, positions: hydrogens.map(\.position)
            ))
            var intended = piece.graph.appending(BondGraph(atomCount: hydrogens.count, bonds: []))
            for (n, h) in hydrogens.enumerated() {
                let rest = BondRadii.covalent(piece.molecule.atomicNumbers[h.slot.atom]) + BondRadii.covalent(1)
                intended = intended.adding(GraphBond(i: h.slot.atom, j: piece.count + n, kind: .covalent, length: Float(rest)))
            }
            let perceived = BondGraph.forPlay(molecule)
            if Snapper.linkSet(perceived) == Snapper.linkSet(intended) {
                var named = molecule
                named.name = molecule.hillFormula
                return Result(
                    piece: BuildPiece(molecule: named, graph: perceived), added: hydrogens.count,
                    partners: hydrogens.map(\.slot.atom)
                )
            }
            // Leave out every new hydrogen the perceived graph disagrees about, and place again.
            let wrong = Snapper.linkSet(perceived).symmetricDifference(Snapper.linkSet(intended))
            var touched = Set<Int>()
            for key in wrong { touched.insert(key.i); touched.insert(key.j) }
            var dropped = false
            for (n, h) in hydrogens.enumerated() where touched.contains(piece.count + n) || touched.contains(h.slot.atom) {
                skip.insert(h.slot)
                dropped = true
            }
            if !dropped { return nil }
        }
        return nil
    }

    struct HydrogenSlot: Hashable {
        var atom: Int
        /// The atom's n-th new hydrogen.
        var nth: Int
    }

    struct Placed {
        var slot: HydrogenSlot
        var position: SIMD3<Float>
    }

    /// Hydrogens on every open valence, atom by atom in index order, each on the free
    /// direction of its ideal geometry farthest from every other atom.
    static func place(_ piece: BuildPiece, skipping skip: Set<HydrogenSlot>) -> [Placed] {
        let m = piece.molecule
        guard m.count < maxAtoms else { return [] }
        var others: [Vec3] = m.positions.map { Vec3($0) }
        let centroid = m.centroid
        var out: [Placed] = []
        for atom in 0..<m.count {
            let cls = ElementClass(z: m.atomicNumbers[atom])
            guard cls == .covalent || cls == .hydrogen else { continue }
            var state = piece.state(atom)
            // A hydrogen held by a metal would lose that contact to a covalent partner (recipe step 3).
            if cls == .hydrogen && state.linkCount > 0 { continue }
            var bonds = piece.bondVectors(atom)
            let p = m.position(atom)
            var nth = 0
            while state.freeValence >= 1, state.withinRecipeCaps(adding: 1), m.count + out.count < maxAtoms {
                defer { nth += 1 }
                let slot = HydrogenSlot(atom: atom, nth: nth)
                let rest = BondRadii.covalent(m.atomicNumbers[atom]) + BondRadii.covalent(1)
                // Outward from the body, away from the bonds already there.
                var toward = p - centroid
                if bonds.count > 0 { toward = toward.normalized - bonds.reduce(Vec3.zero, +).normalized }
                let slots = BondGeometry.slots(existing: bonds, domains: BondGeometry.domains(state), toward: toward)
                guard let best = roomiest(slots, from: p, rest: rest, others: others, exclude: atom) else { break }
                if !skip.contains(slot) {
                    let q = p + best * rest
                    let stored = SIMD3<Float>(Float(q.x), Float(q.y), Float(q.z))
                    out.append(Placed(slot: slot, position: stored))
                    others.append(Vec3(stored))
                }
                // A skipped slot still counts, so the next hydrogen keeps its geometry.
                bonds.append(best)
                state.covalentPartners.append(1)
                state.covalentOrderSum += 1
            }
        }
        return out
    }

    /// The slot whose hydrogen would sit farthest from every other atom; ties keep the slot order.
    static func roomiest(_ slots: [Vec3], from p: Vec3, rest: Double, others: [Vec3], exclude: Int) -> Vec3? {
        var best: (Vec3, Double)?
        for d in slots {
            let q = p + d * rest
            var nearest = Double.infinity
            for (k, o) in others.enumerated() where k != exclude {
                nearest = min(nearest, (o - q).lengthSquared)
            }
            if best == nil || nearest > best!.1 + 1e-9 { best = (d, nearest) }
        }
        return best?.0
    }
}

/// The cue table for "Built it" (plan §4.5, "Done"): every atom at its usual valence.
/// Separate from the recipe's caps, which only bound what may snap.
public enum BuildCues {
    /// H 1, C 4, N 3, O 2, halogens 1, S 2, P 3; other covalent elements their first standard valence.
    public static func usualValence(_ z: Int) -> Int? {
        switch z {
        case 1, 9, 17, 35, 53, 85: 1
        case 6: 4
        case 7: 3
        case 8: 2
        case 16: 2
        case 15: 3
        default: Valence.standardValences(z).first
        }
    }

    /// Whether `atom` is at its usual valence: its covalent bond orders sum to it (contacts and
    /// coordination make up a shortfall, so both ends of Na–Cl count), or, for a metal or an ion,
    /// it holds at least one partner.
    public static func isSatisfied(_ atom: Int, in piece: BuildPiece) -> Bool {
        let s = piece.state(atom)
        switch ElementClass(z: s.z) {
        case .inert:
            return true
        case .metal, .ion:
            return s.coordinationCount + s.contactCount + s.covalentPartners.count >= 1
        case .hydrogen, .covalent:
            guard let usual = usualValence(s.z) else { return s.covalentPartners.count + s.coordinationCount + s.contactCount >= 1 }
            let used = s.usedValence
            return used == usual || (used < usual && used + s.coordinationCount + s.contactCount >= usual)
        }
    }

    /// Every atom at its usual valence, and more than one atom.
    public static func isComplete(_ piece: BuildPiece) -> Bool {
        piece.count >= 2 && (0..<piece.count).allSatisfy { isSatisfied($0, in: piece) }
    }

    /// Atoms with covalent valence left for a hydrogen (what one tap of Fill would fill).
    public static func fillable(_ piece: BuildPiece) -> [Int] {
        (0..<piece.count).filter { atom in
            let cls = ElementClass(z: piece.molecule.atomicNumbers[atom])
            guard cls == .covalent || cls == .hydrogen else { return false }
            let s = piece.state(atom)
            return s.freeValence >= 1 && s.withinRecipeCaps(adding: 1) && !(s.z == 1 && s.linkCount > 0)
        }
    }
}
