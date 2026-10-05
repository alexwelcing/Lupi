import Foundation
import LupiChem
import LupiPlay
import LupiScaleCore

/// The personality of a node (§10.6): a molecule's own, else that of one representative leaf,
/// derived once per NodeID by LupiKit's rules.
public func personality(for view: View, resolver: Resolver) throws -> PersonalityDerivation {
    let leaf = try Representative.leaf(view, resolver)
    return try resolver.cached("personality:" + leaf.key) {
        let molecule = Molecule(
            atomicNumbers: leaf.leaf.atomicNumbers.map(Int.init),
            positions: leaf.leaf.positions
        )
        return Personality.derive(molecule)
    }
}

enum Representative {
    /// For a crystal box, its crystal's 2 × 2 × 2-cell box at the origin (or the whole crystal
    /// when smaller); for a level or copy, its seed's; for a group, its child with the most
    /// atoms (the lower index on ties); for an edit, its base's.
    static func leaf(_ v: View, _ r: Resolver) throws -> (leaf: LeafNode, key: String) {
        let view = v.withoutRemovals
        switch view.kind {
        case .box:
            let c = view.crystal!
            let box = CellBox(lo: .zero, hi: SIMD3(min(2, c.cells.x), min(2, c.cells.y), min(2, c.cells.z)))
            let key = "crystal:\(view.id.hex)"
            return (r.cached("rep:" + key) { CrystalMath.atoms(c, box).leaf }, key)
        case .level, .copy:
            return try leaf(r.root(view.tower!.seed), r)
        case .group:
            var best = 0
            var bestCount = Magnitude.zero
            for i in 0..<(view.groupChildren?.count ?? 0) {
                let c = try r.count(r.step(view, .child(UInt16(i))))
                if try c.compare(bestCount) > 0 {
                    best = i
                    bestCount = c
                }
            }
            return try leaf(r.step(view, .child(UInt16(best))), r)
        case .leaf, .capped, .selection:
            return (try r.materialize(view), "leaf:" + ViewKey.of(view))
        }
    }
}

/// Interface classes of an expansion, game values (§10.6, scale.md §5.4).
public enum InterfaceClass: Double, Sendable {
    case covalent = 346
    case coordination = 150
    case ionicContact = 80
    case latticeIonic = 60
    case noncovalent = 40
}

/// What a smash does to a body (§10.6).
public struct BreakPlan: Sendable {
    public enum Kind: Sendable, Equatable {
        /// A leaf molecule's weakest-class bridge nearest the contact: fragments are selections.
        case bondBreak
        /// A leaf without a breakable bridge and at most 64 heavy atoms: the heavy atom nearest the contact.
        case chip
        /// A leaf without a breakable bridge and more heavy atoms: up to 8 octant selections.
        case octants
        /// A one-cell box: its atoms, loose, for building (D9).
        case looseAtoms
        /// A box with octants, a tower level or a group: its children.
        case children
    }

    public struct Piece: Sendable {
        /// The piece as a reference root and path (the parent's path plus one step).
        public var root: NodeID
        public var path: Path
        public var count: Magnitude
        /// World centre at the moment of the break.
        public var centreWorld: SIMD3<Double>
        /// 0.4 m/s outward from the parent's centre, added to the parent's velocity at the piece's centre.
        public var separation: SIMD3<Double>
        /// An expansion's piece shares its parent's felt mass; nil for a bond break's fragment (its own).
        public var feltMassKg: Double?
        /// 0.06 m when the piece's longest span would be smaller: it grows there over 0.2 s.
        public var growToSpan: Double?
        /// Seconds before the piece can break again.
        public var cooldown: Double
    }

    public var kind: Kind
    /// The impact Δv, m/s, at which it breaks.
    public var threshold: Double
    public var pieces: [Piece]
    /// Records the pieces name that did not exist before (a remainder's edit).
    public var newRecords: [NodeRecord]
}

public enum BreakTuning {
    public static let referenceBond = 346.0
    public static let expansionFloor = 3.0
    public static let separation = 0.4
    public static let minimumPieceSpan = 0.06
    public static let bondCooldown = 0.25
    public static let expansionCooldown = 1.0
    public static let chipHeavyAtoms = 64
}

/// Plans the break of a body hit at `contactWorld`, in at most `budget` pieces (§10.6).
public func expand(_ body: BodyFrame, contactWorld: SIMD3<Double>, budget: Int, resolver: Resolver) throws -> BreakPlan {
    let r = resolver
    let view = try r.resolve(body.ref.root, body.ref.path)
    let node = try r.walk(view, body.anchorPath)
    guard body.anchorPath.isEmpty else { throw ScaleError(.path, "only a body anchored at its own node expands") }
    let agg = try r.aggregate(node)
    let contact = body.anchorPoint(contactWorld)
    let derivation = try personality(for: node, resolver: r)
    let preset = PersonalityTable.v1.preset(derivation.personality.kind)
    let parentMass = FeltMass.kg(massLog(massMicroDa: agg.massMicroDa), massScale: derivation.personality.massScale)
    let b = max(1, budget)

    func piece(_ steps: [Step], root: NodeID? = nil, expansion: Bool) throws -> BreakPlan.Piece {
        let path = try Path(canonicalizing: body.ref.path.steps + steps)
        let (p, w) = try r.placement(from: node, steps: steps)
        let a = try r.aggregate(w)
        let centre = p.apply(a.centre)
        let worldCentre = body.world(centre)
        var dir = body.worldFromAnchor.applyDirection(centre - agg.centre)
        dir = dir.length > 0 ? dir.normalized : Vec3(0, 1, 0)
        let span = body.metresPerAnchorUnit * p.scale * a.bounds.longest
        let share = exp(a.massMicroDa.lnM - agg.massMicroDa.lnM)
        return BreakPlan.Piece(
            root: root ?? body.ref.root, path: path, count: try r.count(w), centreWorld: worldCentre,
            separation: BreakTuning.separation * dir, feltMassKg: expansion ? max(0.06, parentMass * share) : nil,
            growToSpan: span < BreakTuning.minimumPieceSpan ? BreakTuning.minimumPieceSpan : nil,
            cooldown: expansion ? BreakTuning.expansionCooldown : BreakTuning.bondCooldown
        )
    }

    func expansionThreshold(_ e: Double) -> Double {
        max(BreakTuning.expansionFloor, preset.breakSpeed * (e / BreakTuning.referenceBond).squareRoot())
    }

    let features = derivation.features
    let interface: InterfaceClass = node.kind == .group ? .noncovalent
        : features.ions > 0 || features.ionicContacts > 0 ? .latticeIonic
        : features.coordinationBonds > 0 ? .coordination : .covalent

    switch node.kind {
    case .leaf, .capped, .copy, .selection:
        let leaf = try r.materialize(node)
        let molecule = Molecule(atomicNumbers: leaf.atomicNumbers.map(Int.init), positions: leaf.positions)
        if leaf.count <= CutTuning.meshAtoms {
            let graph = BondGraph.forPlay(molecule)
            if let cut = LeafBreak.bridgeNearest(contact, graph, molecule), cut.energy < PersonalityTable.v1.unbreakableCut {
                let fragments = graph.split(molecule, cutting: [cut.index])
                let pieces = try fragments.map { f in
                    try piece([.atoms(AtomRange.covering(f.parentIndices))], expansion: false)
                }
                let threshold = preset.breakSpeed * (cut.energy / BreakTuning.referenceBond).squareRoot()
                return BreakPlan(kind: .bondBreak, threshold: threshold, pieces: pieces, newRecords: [])
            }
        }
        let heavy = leaf.atomicNumbers.indices.filter { leaf.atomicNumbers[$0] != 1 }
        if heavy.count <= BreakTuning.chipHeavyAtoms {
            let chosen = LeafBreak.chipAtoms(contact, leaf, heavy)
            let rest = leaf.atomicNumbers.indices.filter { !chosen.contains($0) }
            var pieces = [try piece([.atoms(AtomRange.covering(chosen))], expansion: true)]
            if !rest.isEmpty { pieces.append(try piece([.atoms(AtomRange.covering(rest))], expansion: true)) }
            return BreakPlan(kind: .chip, threshold: expansionThreshold(interface.rawValue), pieces: pieces, newRecords: [])
        }
        let groups = LeafBreak.octants(leaf, max: min(8, b))
        let pieces = try groups.map { try piece([.atoms(AtomRange.covering($0))], expansion: true) }
        return BreakPlan(kind: .octants, threshold: expansionThreshold(interface.rawValue), pieces: pieces, newRecords: [])
    case .box where (0..<3).allSatisfy({ node.box.extent($0) == 1 }):
        let n = try r.materialize(node).count
        let pieces = try (0..<min(n, b)).map { i in
            try piece([.atoms([AtomRange(start: UInt16(i), length: 1)])], expansion: true)
        }
        return BreakPlan(kind: .looseAtoms, threshold: expansionThreshold(interface.rawValue), pieces: pieces, newRecords: [])
    case .box, .level, .group:
        var children: [(Step, Vec3)] = []
        for s in Children.steps(of: node) {
            guard let w = try? r.step(node, s) else { continue }
            let p = try r.placement(from: node.withoutRemovals, step: s)
            children.append((s, p.apply(try r.aggregate(w).centre)))
        }
        children.sort { ($0.1 - contact).length < ($1.1 - contact).length }
        let threshold = expansionThreshold(interface.rawValue)
        if children.count <= b {
            let pieces = try children.map { try piece([$0.0], expansion: true) }
            return BreakPlan(kind: .children, threshold: threshold, pieces: pieces, newRecords: [])
        }
        // The B − 1 children nearest the contact become pieces; the rest stays as one edit.
        let taken = Array(children.prefix(b - 1))
        var pieces = try taken.map { try piece([$0.0], expansion: true) }
        let removals = try taken.map { try Path(canonicalizing: body.ref.path.steps + [$0.0]) }
        let (edit, records) = try EditWriter.removing(removals, from: body.ref.root, resolver: r)
        var rest = try piece([], root: edit, expansion: true)
        let withEdit = Resolver(store: StoreUnion([RecordStore(records), r.store]))
        rest.count = try withEdit.count(withEdit.resolve(edit, body.ref.path))
        pieces.append(rest)
        return BreakPlan(kind: .children, threshold: threshold, pieces: pieces, newRecords: records)
    }
}

/// The steps to a node's children, in order (§3.3.3, §3.4.2, §3.2).
enum Children {
    static func steps(of v: View) -> [Step] {
        switch v.kind {
        case .group:
            return (0..<(v.groupChildren?.count ?? 0)).map { .child(UInt16($0)) }
        case .box:
            return CrystalMath.octreeChildren(v.box).map { .cells([$0.octant]) }
        case .level:
            let a = TowerMath.axis(v.level)
            return (0..<Int(v.tower!.factor)).map { j in
                var runs: [[DigitRun]] = [[], [], []]
                runs[a] = [DigitRun(digit: UInt8(j), length: 1)]
                return .tower(levels: 1, runs: runs)
            }
        default:
            return []
        }
    }
}

/// Leaf breaks (plan §4.4).
enum LeafBreak {
    /// The bridge of the weakest class nearest the contact. Coordination bonds and ionic contacts
    /// are their own, weaker classes and go first; a class is within 10 % of its weakest.
    static func bridgeNearest(_ contact: Vec3, _ graph: BondGraph, _ m: Molecule) -> (index: Int, energy: Double)? {
        let bridges = graph.weakestBonds(in: m, splittingOnly: true)
        guard !bridges.isEmpty else { return nil }
        func rank(_ k: BondKind) -> Int { k == .ionicContact ? 0 : k == .coordination ? 1 : 2 }
        let weakestKind = bridges.map { rank($0.bond.kind) }.min()!
        let inKind = bridges.filter { rank($0.bond.kind) == weakestKind }
        let floor = inKind.map(\.kJPerMol).min()!
        let candidates = inKind.filter { $0.kJPerMol <= 1.1 * floor }
        let best = candidates.min { a, b in
            let ma = 0.5 * (m.position(a.bond.i) + m.position(a.bond.j)), mb = 0.5 * (m.position(b.bond.i) + m.position(b.bond.j))
            return (ma - contact).length < (mb - contact).length
        }!
        return (best.index, best.kJPerMol)
    }

    /// The heavy atom nearest the contact, with its hydrogens (each hydrogen goes with its nearest heavy atom).
    static func chipAtoms(_ contact: Vec3, _ leaf: LeafNode, _ heavy: [Int]) -> [Int] {
        func p(_ i: Int) -> Vec3 { Vec3(Double(leaf.positions[i].x), Double(leaf.positions[i].y), Double(leaf.positions[i].z)) }
        guard let atom = heavy.min(by: { (p($0) - contact).length < (p($1) - contact).length }) else { return [0] }
        var out = [atom]
        for i in leaf.atomicNumbers.indices where leaf.atomicNumbers[i] == 1 {
            let partner = heavy.min { (p($0) - p(i)).length < (p($1) - p(i)).length }
            if partner == atom { out.append(i) }
        }
        return out.sorted()
    }

    /// Up to 8 selections by octant around the bounding-box centre.
    static func octants(_ leaf: LeafNode, max limit: Int) -> [[Int]] {
        var box = Box3.empty
        let pos = leaf.positions.map { Vec3(Double($0.x), Double($0.y), Double($0.z)) }
        for q in pos { box = box.union(Box3(min: q, max: q)) }
        let c = box.centre
        var groups = [[Int]](repeating: [], count: 8)
        for (i, q) in pos.enumerated() {
            let o = (q.x >= c.x ? 1 : 0) | (q.y >= c.y ? 2 : 0) | (q.z >= c.z ? 4 : 0)
            groups[o].append(i)
        }
        var nonEmpty = groups.filter { !$0.isEmpty }
        while nonEmpty.count > limit {
            // Merge the two smallest when the budget is tighter than eight.
            nonEmpty.sort { $0.count < $1.count }
            let merged = (nonEmpty[0] + nonEmpty[1]).sorted()
            nonEmpty = [merged] + Array(nonEmpty.dropFirst(2))
        }
        return nonEmpty
    }
}

enum EditWriter {
    /// An edit of `root` without the given nodes, flattened as §2.6 says: an edit of an edit
    /// rewrites its base's removals. Removing what is already removed is `path`; a full edit is
    /// `limit` ("this one is full").
    static func removing(_ removals: [Path], from root: NodeID, resolver r: Resolver) throws -> (NodeID, [NodeRecord]) {
        let rec = try r.record(root)
        var base = root
        var existing: [Path] = []
        if case let .edit(e)? = rec.node {
            base = e.base
            existing = e.removed
        }
        var out: [Path] = []
        for old in existing {
            if removals.contains(where: { Path.contains($0.steps, old.steps) }) { continue }
            out.append(old)
        }
        for new in removals {
            if existing.contains(where: { Path.contains($0.steps, new.steps) }) {
                throw ScaleError(.path, "that piece is already gone")
            }
            out.append(new)
        }
        guard out.count <= RecordLimits.maxRemovals else { throw ScaleError(.limit, "this one is full") }
        let edit: NodeRecord
        do {
            edit = try NodeRecord(.edit(EditNode(base: base, removed: out)))
        } catch let e as ScaleError where e.code == .limit {
            throw ScaleError(.limit, "this one is full")
        }
        return (edit.id, [edit])
    }
}

/// Chipping (§10.6): the chip is its path; the remainder is the parent minus it, as a
/// selection of the complement when the parent is materializable, otherwise a flattened edit.
public struct ChipResult: Sendable {
    public var chip: ScaleRef
    public var remainder: ScaleRef
    public var newRecords: [NodeRecord]
}

public func chip(_ body: BodyFrame, steps: [Step], resolver: Resolver) throws -> ChipResult {
    let r = resolver
    let parent = try r.resolve(body.ref.root, body.ref.path)
    let chipPath = try Path(canonicalizing: body.ref.path.steps + steps)
    _ = try r.resolve(body.ref.root, chipPath)
    let chip = ScaleRef(root: body.ref.root, records: body.ref.records, dependencies: body.ref.dependencies, path: chipPath)
    if r.isMaterializable(parent), case let .atoms(ranges)? = steps.last, steps.count == 1 {
        let all = Set(0..<(try r.materialize(parent).count))
        let complement = all.subtracting(AtomRange.indices(ranges)).sorted()
        let rest = try Path(canonicalizing: body.ref.path.steps + [.atoms(AtomRange.covering(complement))])
        return ChipResult(chip: chip, remainder: ScaleRef(root: body.ref.root, records: body.ref.records, path: rest), newRecords: [])
    }
    let (edit, records) = try EditWriter.removing([chipPath], from: body.ref.root, resolver: r)
    let remainder = ScaleRef(root: edit, records: records + body.ref.records, dependencies: body.ref.dependencies, path: body.ref.path)
    return ChipResult(chip: chip, remainder: remainder, newRecords: records)
}
