import Foundation

/// A resolved node, possibly virtual (§4.3), with the removals that start at it (§4.4).
public struct View: Sendable {
    public enum Kind: Sendable, Equatable {
        case leaf, group, box, capped, level, copy, selection
    }

    public let kind: Kind
    /// The record that provides the view: the leaf, group, crystal or tower record.
    /// A selection carries its base's.
    public let record: NodeRecord
    /// The cells of a box view.
    public let box: CellBox
    /// The level k of a tower view (0 for a copy).
    public let level: BigUInt
    /// Per axis, the digits taken in this tower from its top: a copy's key (§3.4.5).
    public let towerRuns: [[DigitRun]]
    /// Removal paths that start at this view.
    public let removals: [[Step]]
    let selectionBase: ViewBox?
    let selection: [Int]
    /// Records entered on the way here, for the lazy depth check (§2.8).
    let chain: Int

    init(
        kind: Kind, record: NodeRecord, box: CellBox = CellBox(lo: .zero, hi: .zero), level: BigUInt = BigUInt(),
        towerRuns: [[DigitRun]] = [[], [], []], removals: [[Step]] = [], selectionBase: ViewBox? = nil,
        selection: [Int] = [], chain: Int
    ) {
        self.kind = kind
        self.record = record
        self.box = box
        self.level = level
        self.towerRuns = towerRuns
        self.removals = removals
        self.selectionBase = selectionBase
        self.selection = selection
        self.chain = chain
    }

    public var id: NodeID { record.id }

    /// The selection's base view and atom indices.
    public var selectionOf: (base: View, indices: [Int])? {
        guard kind == .selection, let b = selectionBase else { return nil }
        return (b.view, selection)
    }

    /// The same node without the removals that start at it.
    public var withoutRemovals: View { with(removals: []) }

    func with(removals: [[Step]]) -> View {
        View(
            kind: kind, record: record, box: box, level: level, towerRuns: towerRuns, removals: removals,
            selectionBase: selectionBase, selection: selection, chain: chain
        )
    }

    public var crystal: CrystalNode? { if case let .crystal(c)? = record.node { return c }; return nil }
    public var tower: TowerNode? { if case let .tower(t)? = record.node { return t }; return nil }
    public var groupChildren: [GroupChild]? { if case let .group(g)? = record.node { return g }; return nil }
    public var leaf: LeafNode? { if case let .leaf(l)? = record.node { return l }; return nil }

    /// The unit exponent of §2.8: u(k) for a tower level, else 0.
    public var unitExponent: BigUInt { kind == .level ? TowerMath.unitExponent(level) : BigUInt() }
}

final class ViewBox: Sendable {
    let view: View
    init(_ view: View) { self.view = view }
}

/// Memo tables keyed by NodeID (§4.6), shared by copies of one resolver.
final class ResolverMemo: @unchecked Sendable {
    private let lock = NSLock()
    private var depth: [NodeID: Int] = [:]
    private var counts: [NodeID: Magnitude] = [:]
    private var tallies: [NodeID: [UInt8: BigUInt]] = [:]
    private var materialized: [NodeID: LeafNode] = [:]
    private var checked: Set<NodeID> = []
    private var extras: [String: any Sendable] = [:]

    func depthOf(_ id: NodeID) -> Int? { lock.withLock { depth[id] } }
    func setDepth(_ id: NodeID, _ v: Int) { lock.withLock { depth[id] = v } }
    func countOf(_ id: NodeID) -> Magnitude? { lock.withLock { counts[id] } }
    func setCount(_ id: NodeID, _ v: Magnitude) { lock.withLock { counts[id] = v } }
    func tallyOf(_ id: NodeID) -> [UInt8: BigUInt]? { lock.withLock { tallies[id] } }
    func setTally(_ id: NodeID, _ v: [UInt8: BigUInt]) { lock.withLock { tallies[id] = v } }
    func leafOf(_ id: NodeID) -> LeafNode? { lock.withLock { materialized[id] } }
    func setLeaf(_ id: NodeID, _ v: LeafNode) { lock.withLock { materialized[id] = v } }
    func isChecked(_ id: NodeID) -> Bool { lock.withLock { checked.contains(id) } }
    func setChecked(_ id: NodeID) { lock.withLock { _ = checked.insert(id) } }

    /// A general cache for derived data (LupiScale's aggregates and proxies).
    func extra(_ key: String) -> (any Sendable)? { lock.withLock { extras[key] } }
    func setExtra(_ key: String, _ v: any Sendable) { lock.withLock { extras[key] = v } }
}

/// Resolution, counts, materialization and probes (§4).
public struct Resolver: Sendable {
    public let store: any NodeStore
    let memo: ResolverMemo

    public init(store: any NodeStore) {
        self.store = store
        memo = ResolverMemo()
    }

    /// A cached value, if one is resident.
    public func residentValue(_ key: String) -> (any Sendable)? { memo.extra(key) }

    /// A shared cache for derived data, keyed by caller-chosen strings.
    public func cached<T: Sendable>(_ key: String, _ make: () throws -> T) rethrows -> T {
        if let v = memo.extra(key) as? T { return v }
        let v = try make()
        memo.setExtra(key, v)
        return v
    }

    // MARK: Records

    /// A record whose node is known; an opaque record is `unsupported` (§2.7).
    public func record(_ id: NodeID) throws -> NodeRecord {
        let r = try store.record(id)
        guard r.node != nil else { throw fail(.unsupported, "record kind \(r.kindByte) version \(r.kindVersion)") }
        return r
    }

    /// Record depth (§2.8), memoized; deeper than 64 is `limit`.
    public func depth(_ id: NodeID) throws -> Int {
        try depth(id, guardLevel: 0)
    }

    private func depth(_ id: NodeID, guardLevel: Int) throws -> Int {
        if let d = memo.depthOf(id) { return d }
        if guardLevel > RecordLimits.maxDepth { throw fail(.limit, "record depth above 64") }
        let rec = try record(id)
        var d = 1
        switch rec.node! {
        case .leaf, .crystal: d = 1
        case let .group(children):
            var deepest = 0
            for c in Set(children.map(\.id)) { deepest = max(deepest, try depth(c, guardLevel: guardLevel + 1)) }
            d = 1 + deepest
        case let .tower(t): d = 1 + (try depth(t.seed, guardLevel: guardLevel + 1))
        case let .edit(e): d = 1 + (try depth(e.base, guardLevel: guardLevel + 1))
        }
        if d > RecordLimits.maxDepth { throw fail(.limit, "record depth above 64") }
        memo.setDepth(id, d)
        return d
    }

    // MARK: Views (§4.6)

    public func root(_ id: NodeID) throws -> View {
        try rootView(id, removals: [], chain: 0)
    }

    public func resolve(_ id: NodeID, _ path: Path) throws -> View {
        var v = try root(id)
        for s in path.steps { v = try step(v, s) }
        return v
    }

    /// Walks steps from a view, without canonicalizing them.
    public func walk(_ view: View, _ steps: [Step]) throws -> View {
        var v = view
        for s in steps { v = try step(v, s) }
        return v
    }

    func rootView(_ id: NodeID, removals: [[Step]], chain: Int) throws -> View {
        let rec = try record(id)
        let chain = chain + 1
        if chain > RecordLimits.maxDepth { throw fail(.limit, "record depth above 64") }
        switch rec.node! {
        case .leaf:
            if !removals.isEmpty { throw fail(.path, "a removal inside a leaf") }
            return View(kind: .leaf, record: rec, chain: chain)
        case .group:
            return View(kind: .group, record: rec, removals: removals, chain: chain)
        case let .crystal(c):
            if c.termination == .capped {
                if !removals.isEmpty { throw fail(.path, "a removal inside a capped crystal") }
                return View(kind: .capped, record: rec, chain: chain)
            }
            return View(kind: .box, record: rec, box: CrystalMath.rootBox(c), removals: removals, chain: chain)
        case let .tower(t):
            try checkTower(rec, t)
            let v = View(kind: .level, record: rec, level: t.levels, removals: removals, chain: chain)
            return t.levels.isZero ? try levelZero(v, t) : v
        case let .edit(e):
            try checkEdit(rec, e)
            let combined = Resolver.antichain(removals + e.removed.map(\.steps))
            return try rootView(e.base, removals: combined, chain: chain)
        }
    }

    /// Removals with every one contained in another dropped, so counts stay disjoint
    /// when an edit's base holds edits of its own.
    static func antichain(_ removals: [[Step]]) -> [[Step]] {
        if removals.count < 2 { return removals }
        var keep: [[Step]] = []
        for (i, r) in removals.enumerated() {
            let covered = removals.enumerated().contains { j, other in
                j != i && Path.contains(other, r) && (!Path.contains(r, other) || j < i)
            }
            if !covered { keep.append(r) }
        }
        return keep
    }

    /// Level 0: the copy with a substitution, otherwise the seed's own view (§3.4.4).
    private func levelZero(_ v: View, _ t: TowerNode) throws -> View {
        if t.substitution != nil {
            if !v.removals.isEmpty { throw fail(.path, "a removal inside a substituted copy") }
            return View(kind: .copy, record: v.record, level: BigUInt(), towerRuns: v.towerRuns, chain: v.chain)
        }
        return try rootView(t.seed, removals: v.removals, chain: v.chain)
    }

    /// §2.8 for towers: the seed is not a tower nor an edit of one, its count is below 2²⁵⁶,
    /// and with a substitution it is materializable with enough atoms of fromZ.
    private func checkTower(_ rec: NodeRecord, _ t: TowerNode) throws {
        if memo.isChecked(rec.id) { return }
        _ = try depth(rec.id)
        let seed = try record(t.seed)
        var inner = seed
        if case let .edit(e)? = seed.node { inner = try record(e.base) }
        if case .tower? = inner.node {
            throw fail(.validity, "a tower seed is never a tower: wrap it in a one-child group")
        }
        let seedView = try root(t.seed)
        guard let n = try count(seedView).plain, n.bitWidth <= 256 else {
            throw fail(.limit, "a tower seed holds fewer than 2^256 atoms")
        }
        if let s = t.substitution {
            guard isMaterializable(seedView) else { throw fail(.validity, "a substituted seed must be materializable") }
            let leaf = try materialize(seedView)
            if leaf.atomicNumbers.lazy.filter({ $0 == s.fromZ }).count < Int(s.perCopy) {
                throw fail(.validity, "perCopy exceeds the seed's atoms of fromZ")
            }
        }
        memo.setChecked(rec.id)
    }

    /// §2.8 for edits: the base is not an edit, and every removal is a non-empty path
    /// without an atoms step that resolves inside the base and contains no other.
    private func checkEdit(_ rec: NodeRecord, _ e: EditNode) throws {
        if memo.isChecked(rec.id) { return }
        let base = try record(e.base)
        if case .edit? = base.node { throw fail(.validity, "an edit's base is never an edit") }
        let removed = e.removed.map(\.steps)
        for r in removed { try Edits.checkRemovalShape(r) }
        try Edits.checkDisjoint(removed)
        let baseView = try root(e.base)
        for r in removed {
            do {
                _ = try walk(baseView, r)
            } catch let error as ScaleError where error.code == .path {
                throw fail(.validity, "a removal does not resolve inside the base: \(error.detail)")
            }
        }
        memo.setChecked(rec.id)
    }

    // MARK: Steps (§4.3, §4.4)

    public func step(_ v: View, _ s: Step) throws -> View {
        switch s {
        case let .child(i):
            guard v.kind == .group, let children = v.groupChildren else { throw fail(.path, "a child step needs a group") }
            guard Int(i) < children.count else { throw fail(.path, "child \(i) of \(children.count)") }
            let removals = try descend(v, s)
            let w = try rootView(children[Int(i)].id, removals: removals, chain: v.chain)
            if !w.unitExponent.isZero { throw fail(.validity, "a group child has unit exponent 0") }
            return w
        case let .cells(octants):
            guard v.kind == .box, let c = v.crystal else { throw fail(.path, "a cells step needs an open or closed crystal") }
            _ = c
            var box = v.box
            for o in octants { box = try CrystalMath.octreeChild(box, o) }
            let removals = try descend(v, s)
            return View(kind: .box, record: v.record, box: box, removals: removals, chain: v.chain)
        case let .tower(d, runs):
            guard v.kind == .level, let t = v.tower else { throw fail(.path, "a tower step needs a tower level") }
            guard !d.isZero, d <= v.level else { throw fail(.path, "a tower step below level 0") }
            guard runs.count == 3 else { throw fail(.path, "a tower step has three axes") }
            for a in 0..<3 {
                for run in runs[a] where run.digit >= t.factor { throw fail(.path, "digit \(run.digit) of factor \(t.factor)") }
                if DigitRuns.count(runs[a]) != TowerMath.digits(a, v.level, d) {
                    throw fail(.path, "axis \(a) has the wrong number of digits")
                }
            }
            let removals = try descend(v, s)
            let merged = (0..<3).map { DigitRuns.merged(v.towerRuns[$0], runs[$0]) }
            let k = v.level.minus(d)
            let nv = View(kind: .level, record: v.record, level: k, towerRuns: merged, removals: removals, chain: v.chain)
            return k.isZero ? try levelZero(nv, t) : nv
        case let .atoms(ranges):
            guard isMaterializable(v) else { throw fail(.path, "an atoms step needs a materializable view") }
            let n = try materialize(v).count
            let picked = AtomSelection.indices(ranges)
            for i in picked where i >= n { throw fail(.path, "atom \(i) of \(n)") }
            if v.kind == .selection, let (base, idx) = v.selectionOf {
                return View(
                    kind: .selection, record: base.record, selectionBase: ViewBox(base),
                    selection: Array(Set(picked.map { idx[$0] })).sorted(), chain: v.chain
                )
            }
            return View(
                kind: .selection, record: v.record, selectionBase: ViewBox(v), selection: Array(Set(picked)).sorted(), chain: v.chain
            )
        }
    }

    /// The removals that start below `s`; throws `path` when `s` enters a removed node (§4.4).
    public func removals(below v: View, taking s: Step) throws -> [[Step]] { try descend(v, s) }

    func descend(_ v: View, _ s: Step) throws -> [[Step]] {
        var out: [[Step]] = []
        for r in v.removals {
            let h = r[0]
            let rest = Array(r.dropFirst())
            switch (s, h) {
            case let (.child(i), .child(j)):
                if i != j { continue }
                if rest.isEmpty { throw fail(.path, "enters a removed node") }
                out.append(rest)
            case let (.cells(so), .cells(ho)):
                let m = min(so.count, ho.count)
                if so[0..<m] != ho[0..<m] { continue }
                if ho.count <= so.count { throw fail(.path, "enters a removed node") }
                out.append([.cells(Array(ho[so.count...]))] + rest)
            case let (.tower(d, sr), .tower(dh, hr)):
                let dmin = min(d, dh)
                var same = true
                var hTail: [[DigitRun]] = []
                for a in 0..<3 {
                    let n = TowerMath.digits(a, v.level, dmin)
                    guard let hs = DigitRuns.split(hr[a], n), let ss = DigitRuns.split(sr[a], n) else { same = false; break }
                    if hs.head != ss.head { same = false; break }
                    hTail.append(hs.tail)
                }
                if !same { continue }
                if dh > d {
                    out.append([.tower(levels: dh.minus(d), runs: hTail)] + rest)
                } else if rest.isEmpty {
                    throw fail(.path, "enters a removed node")
                } else {
                    // D_h = D = k: the removal continues inside the seed copy.
                    out.append(rest)
                }
            default:
                // A validated removal always matches the kind of step its view takes.
                throw fail(.validity, "a removal does not match its node")
            }
        }
        return out
    }

    // MARK: Counts (§4.4, §5)

    public func count(_ v: View) throws -> Magnitude {
        var c = try baseCount(v)
        let bare = v.with(removals: [])
        for r in v.removals { c = try c - baseCount(try walk(bare, r)) }
        return c
    }

    private func baseCount(_ v: View) throws -> Magnitude {
        switch v.kind {
        case .leaf: return Magnitude(BigUInt(v.leaf!.count))
        case .capped: return Magnitude(BigUInt(try cappedAtoms(v).count))
        case .box: return Magnitude(CrystalMath.boxCount(v.crystal!, v.box))
        case .selection: return Magnitude(BigUInt(v.selection.count))
        case .group: return try groupCount(v.record)
        case .level:
            let t = v.tower!
            let seed = try count(root(t.seed)).plain!
            return Magnitude.tower(seedCount: seed, factor: t.factor, levels: v.level)
        case .copy:
            return try count(root(v.tower!.seed))
        }
    }

    private func groupCount(_ rec: NodeRecord) throws -> Magnitude {
        if let c = memo.countOf(rec.id) { return c }
        _ = try depth(rec.id)
        guard case let .group(children)? = rec.node else { throw fail(.path, "not a group") }
        var total = Magnitude.zero
        var perChild: [NodeID: Magnitude] = [:]
        for c in children {
            if perChild[c.id] == nil {
                let w = try root(c.id)
                if !w.unitExponent.isZero { throw fail(.validity, "a group child has unit exponent 0") }
                perChild[c.id] = try count(w)
            }
            total = try total + perChild[c.id]!
        }
        memo.setCount(rec.id, total)
        return total
    }

    // MARK: Materialization and probes (§4.5)

    public func isMaterializable(_ v: View) -> Bool {
        switch v.kind {
        case .leaf, .capped, .copy, .selection: return true
        case .box: return CrystalMath.boxCount(v.crystal!, v.box) <= BigUInt(RecordLimits.maxAtoms)
        case .group, .level: return false
        }
    }

    public func materialize(_ v: View) throws -> LeafNode {
        switch v.kind {
        case .leaf:
            return v.leaf!
        case .capped:
            return try cappedAtoms(v)
        case .box:
            return try boxAtoms(v).leaf
        case .copy:
            let t = v.tower!
            let seed = try materialize(root(t.seed))
            let key = TowerMath.copyKey(tower: v.id, levels: t.levels, runs: v.towerRuns)
            let z = try TowerMath.substitute(seed.atomicNumbers, t.substitution!, key: key).atomicNumbers
            return LeafNode(atomicNumbers: z, positions: seed.positions)
        case .selection:
            let (base, idx) = v.selectionOf!
            let m = try materialize(base)
            return LeafNode(atomicNumbers: idx.map { m.atomicNumbers[$0] }, positions: idx.map { m.positions[$0] })
        case .group, .level:
            throw fail(.materialize, "groups and tower levels are never materialized")
        }
    }

    /// A box's atoms in order, minus those whose owner cell lies in a removed sub-box,
    /// with their grid points (for owner cells).
    func boxAtoms(_ v: View) throws -> CrystalAtoms {
        let c = v.crystal!
        guard CrystalMath.boxCount(c, v.box) <= BigUInt(RecordLimits.maxAtoms) else {
            throw fail(.materialize, "a box of more than 4,096 atoms")
        }
        let all = CrystalMath.materializeBox(c, v.box)
        if v.removals.isEmpty { return all }
        let bare = v.with(removals: [])
        let removed = try v.removals.map { try walk(bare, $0).box }
        var out = CrystalAtoms()
        for i in all.atomicNumbers.indices {
            let cell = CrystalMath.ownerCell(c, all.grid[i])
            if removed.contains(where: { CrystalMath.contains($0, cell) }) { continue }
            out.atomicNumbers.append(all.atomicNumbers[i])
            out.q16.append(all.q16[i])
            out.grid.append(all.grid[i])
        }
        return out
    }

    /// The owner cell (§3.3.2) of each atom of a box view's materialization, in its order,
    /// or of a copy or seed view whose seed is a crystal box.
    public func ownerCells(_ v: View) throws -> [SIMD3<UInt64>]? {
        switch v.kind {
        case .box:
            let c = v.crystal!
            return try boxAtoms(v).grid.map { CrystalMath.ownerCell(c, $0) }
        case .copy:
            return try ownerCells(root(v.tower!.seed))
        default:
            return nil
        }
    }

    private func cappedAtoms(_ v: View) throws -> LeafNode {
        if let l = memo.leafOf(v.id) { return l }
        let l = try CrystalMath.materializeCapped(v.crystal!).leaf
        memo.setLeaf(v.id, l)
        return l
    }

    /// The NodeID of the leaf record of the view's materialization.
    public func probe(_ v: View) throws -> NodeID {
        try NodeRecord(.leaf(materialize(v))).id
    }

    /// The copy key of a copy view (§3.4.5).
    public func copyKey(_ v: View) -> UInt64? {
        guard v.kind == .copy, let t = v.tower else { return nil }
        return TowerMath.copyKey(tower: v.id, levels: t.levels, runs: v.towerRuns)
    }
}
