import Foundation

/// One body's atoms in its own frame (Å) with the graph the game plays with,
/// the input to snapping and filling (plan §4.5).
public struct BuildPiece: Sendable, Equatable {
    public var molecule: Molecule
    public var graph: BondGraph

    /// `graph` defaults to the play graph the recipe perceives.
    public init(molecule: Molecule, graph: BondGraph? = nil) {
        self.molecule = molecule
        self.graph = graph ?? BondGraph.forPlay(molecule)
    }

    public var count: Int { molecule.count }

    public func state(_ atom: Int) -> AtomBondState { AtomBondState(atom: atom, graph: graph, molecule: molecule) }

    /// Atoms that take another partner of some kind: open covalent valence, or a metal's or ion's free slot.
    public var openAtoms: [Int] { (0..<count).filter { state($0).freeValence >= 1 } }

    /// Unit vectors from `atom` to each of its partners.
    public func bondVectors(_ atom: Int) -> [Vec3] {
        graph.incident[atom].map { k in (molecule.position(graph.bonds[k].other(atom)) - molecule.position(atom)).normalized }
    }
}

/// A rigid map between two frames in Å, x' = R x + t.
public struct RigidPlacement: Sendable, Equatable {
    public var rotation: Mat3
    public var translation: Vec3

    public init(rotation: Mat3 = .identity, translation: Vec3 = .zero) {
        self.rotation = rotation
        self.translation = translation
    }

    public static let identity = RigidPlacement()

    public func apply(_ x: Vec3) -> Vec3 { rotation * x + translation }
    public func applyDirection(_ v: Vec3) -> Vec3 { rotation * v }

    public var inverse: RigidPlacement {
        let rt = rotation.transposed
        return RigidPlacement(rotation: rt, translation: -1 * (rt * translation))
    }
}

/// Why a snap does not happen.
public enum SnapRefusal: Error, Sendable, Equatable {
    /// The valence rules refuse the pair (plan §4.5 (b), (c)).
    case notAllowed
    /// No free direction at one of the atoms.
    case noRoom
    /// The merged body would pass the molecular recipe's 2,000 atoms.
    case tooBig
    /// Every placement tried perceives a graph other than the one intended (plan §4.5, "Check").
    case perception
}

/// A snap that passed the check.
public struct SnapResult: Sendable {
    /// The host's atoms as they were, then the guest's in the host's frame (scale-spec §10.7).
    public var molecule: Molecule
    /// The recipe's graph of the merged atoms: the intended graph, orders re-estimated.
    public var graph: BondGraph
    /// The new link, in merged indices.
    public var bond: GraphBond
    /// Where the guest went: guest frame to host frame.
    public var guestToHost: RigidPlacement

    public var piece: BuildPiece { BuildPiece(molecule: molecule, graph: graph) }
}

/// Snapping two bodies by one atom each (plan §4.5): the valence rule, the cutoff and
/// magnet zone, the geometry placement and the re-perception check.
public enum Snapper {
    /// The magnet zone is this many times the bond cutoff.
    public static let magnetFactor = 1.6
    /// Placements tried before a refusal: the host's nearest free directions, each with
    /// a few turns of the guest about the new bond.
    public static let dihedrals: [Double] = [0, 60, -60, 120, -120, 180].map { $0 * .pi / 180 }
    public static let hostSlotsTried = 3

    /// The link atoms `a` (host) and `b` (guest) would make, with the recipe's cutoff and the rest length, Å.
    public static func rule(_ host: BuildPiece, _ a: Int, _ guest: BuildPiece, _ b: Int) -> (kind: BondKind, cutoff: Double, rest: Double)? {
        guard let kind = Valence.canBond(host.state(a), guest.state(b)) else { return nil }
        let za = host.molecule.atomicNumbers[a], zb = guest.molecule.atomicNumbers[b]
        return (kind, Valence.snapCutoff(za, zb, kind: kind), Valence.restLength(za, zb, kind: kind))
    }

    /// Places the guest so atom `b` sits at the rest length from atom `a` along a free
    /// direction of `a` nearest where `b` is now, with `b`'s own free direction pointing
    /// back (the guest turned the shortest way from `current`), and keeps the first
    /// placement whose merged atoms the recipe perceives as exactly the two graphs plus
    /// the new link.
    public static func snap(
        host: BuildPiece, hostAtom a: Int, guest: BuildPiece, guestAtom b: Int, guestToHost current: RigidPlacement
    ) -> Result<SnapResult, SnapRefusal> {
        guard host.count + guest.count <= BondConstants.molecularRecipeMaxAtoms else { return .failure(.tooBig) }
        guard let rule = rule(host, a, guest, b) else { return .failure(.notAllowed) }
        let pa = host.molecule.position(a)
        let pb = guest.molecule.position(b)
        let contact = current.apply(pb) - pa
        let hostSlots = BondGeometry.slots(
            existing: host.bondVectors(a), domains: BondGeometry.domains(host.state(a), adding: rule.kind), toward: contact
        )
        guard !hostSlots.isEmpty else { return .failure(.noRoom) }
        let guestDomains = BondGeometry.domains(guest.state(b), adding: rule.kind)
        let intended = intendedGraph(host: host, guest: guest, link: GraphBond(i: a, j: host.count + b, kind: rule.kind, length: Float(rule.rest)))
        let turns = guest.count == 1 ? [0.0] : dihedrals
        for da in hostSlots.prefix(hostSlotsTried) {
            // b's free direction nearest a, seen from the guest's frame as it is now.
            let back = current.rotation.transposed * (-1 * da)
            guard let db = BondGeometry.slots(existing: guest.bondVectors(b), domains: guestDomains, toward: back).first else {
                return .failure(.noRoom)
            }
            let aligned = Mat3.arc(from: current.rotation * db, to: -1 * da) * current.rotation
            let target = pa + da * rule.rest
            for turn in turns {
                let rotation = Mat3.rotation(axis: da, angle: turn) * aligned
                let placement = RigidPlacement(rotation: rotation, translation: target - rotation * pb)
                let merged = host.molecule.appending(guest.molecule.transformed(by: placement))
                if let graph = check(merged, intended: intended) {
                    let k = graph.bondIndex(a, host.count + b)!
                    var named = merged
                    named.name = merged.hillFormula
                    return .success(SnapResult(molecule: named, graph: graph, bond: graph.bonds[k], guestToHost: placement))
                }
            }
        }
        return .failure(.perception)
    }

    /// The host's graph, the guest's renumbered after it, and the link.
    static func intendedGraph(host: BuildPiece, guest: BuildPiece, link: GraphBond) -> BondGraph {
        host.graph.appending(guest.graph).adding(link)
    }

    /// The recipe's graph of `molecule` when its pairs and kinds are exactly `intended`'s, else nil.
    /// Orders are not compared: they are estimates from length, re-made for the merged atoms.
    public static func check(_ molecule: Molecule, intended: BondGraph) -> BondGraph? {
        guard molecule.count <= BondConstants.molecularRecipeMaxAtoms else { return nil }
        let perceived = BondGraph.forPlay(molecule)
        return linkSet(perceived) == linkSet(intended) ? perceived : nil
    }

    static func linkSet(_ graph: BondGraph) -> Set<LinkKey> {
        Set(graph.bonds.map { LinkKey(i: $0.i, j: $0.j, kind: $0.kind) })
    }

    struct LinkKey: Hashable {
        var i: Int
        var j: Int
        var kind: BondKind
    }
}

extension Valence {
    /// The molecular recipe's cutoff for a pair linked as `kind`, Å: r_cov + r_cov + τ for
    /// covalent pairs, the metal rules for coordination, r_ion + r_donor + 0.35 for contacts
    /// (`perceiveBonds`, step 1). Snapping commits within it (plan §4.5 (a)).
    public static func snapCutoff(_ za: Int, _ zb: Int, kind: BondKind) -> Double {
        let tau = BondConstants.defaultTolerance
        switch kind {
        case .covalent:
            return BondRadii.covalent(za) + BondRadii.covalent(zb) + tau
        case .coordination:
            let ca = ElementClass(z: za), cb = ElementClass(z: zb)
            if ca == .metal && cb == .metal { return BondRadii.metal(za) + BondRadii.metal(zb) + BondConstants.metalMetalSlack }
            let metal = ca == .metal ? za : zb
            let ligand = ca == .metal ? zb : za
            let slack = ligand == 1 ? BondConstants.metalHydrideSlack : tau
            return BondRadii.metal(metal) + BondRadii.covalent(ligand) + slack
        case .ionicContact:
            let ion = ElementClass(z: za) == .ion ? za : zb
            let donor = ion == za ? zb : za
            return (BondRadii.ion[ion] ?? BondRadii.covalent(ion)) + (BondRadii.donor[donor] ?? BondRadii.covalent(donor))
                + BondConstants.ionContactMargin
        }
    }
}

extension Molecule {
    /// A copy moved by `placement`, rounded to Float32 as stored.
    public func transformed(by placement: RigidPlacement) -> Molecule {
        var copy = self
        copy.positions = positions.map { p in
            let q = placement.apply(Vec3(p))
            return SIMD3<Float>(Float(q.x), Float(q.y), Float(q.z))
        }
        return copy
    }
}
