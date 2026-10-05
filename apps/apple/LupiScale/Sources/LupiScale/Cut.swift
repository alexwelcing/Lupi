import Foundation
import LupiChem
import LupiScaleCore

/// Builds the cut of one frame (§9.4, §9.5). It never throws: a body that cannot be resolved
/// draws nothing and is listed in `failures`, and missing data draws the parent.
public func buildCut(bodies: [BodyFrame], view: ViewState, budgets: Budgets, previous: Cut?, resolver: Resolver) -> Cut {
    let builder = CutBuilder(view: view, budgets: budgets, previous: previous, resolver: resolver)
    for (i, body) in bodies.enumerated() { builder.addBody(i, body) }
    return builder.run()
}

/// The cut's tuning table (§9, §10.1).
public enum CutTuning {
    /// A body whose node is a leaf of at most this many atoms draws as its merged mesh (§9.2).
    public static let meshAtoms = 2000
    /// The excavation bubble around a camera inside solid terrain (§10.1), metres.
    public static let bubbleRadius = 0.35
    /// The camera frame entity stays within this distance of the camera (§8.5), metres.
    public static let cameraFrameRange = 2.0
    /// A body longer than this is terrain (§10.1), metres.
    public static let terrainSpan = 3.0
}

struct Cost {
    var items: Int32 = 0
    var atoms: Int32 = 0
    var boxes: Int32 = 0

    static func + (a: Cost, b: Cost) -> Cost { Cost(items: a.items + b.items, atoms: a.atoms + b.atoms, boxes: a.boxes + b.boxes) }
    static func - (a: Cost, b: Cost) -> Cost { Cost(items: a.items - b.items, atoms: a.atoms - b.atoms, boxes: a.boxes - b.boxes) }
}

enum CKind: UInt8 {
    /// A tower level k ≥ 1 without removals.
    case level
    /// An open or closed crystal box without removals.
    case box
    /// A seed copy with a substitution.
    case copy
    /// Anything else, through the resolver: groups, leaves, capped crystals, selections, removals.
    case view
    /// A final set of atoms (the refinement of a leaf-like or solid node).
    case atoms
    /// A body's leaf of at most 2,000 atoms: its merged mesh, always (§9.2).
    case mesh
}

struct CNode {
    var kind: CKind
    var body: Int32
    /// Tower, crystal, view or atom-set index, by kind.
    var payload: Int32
    var levelBase: Int32 = -1
    var depth: Int32 = 0
    /// A crystal box node's cells, as an index into the builder's box table.
    var cellBox: Int32 = -1
    var key64: UInt64
    /// anchor ← node: x_A = s · R · x + t.
    var s: Double
    var rot: Int32
    var t: Vec3
    /// The envelope in the node's own units.
    var bounds: Box3
    var epsilon: Double
    /// Exposed faces: bit 2a for the lower face of axis a, 2a + 1 for the upper.
    var faces: UInt8
    var solid: Bool
    var hasRemovals: Bool = false
    var colour = SIMD3<Float>.zero
    var rho: Double = 0
    var area: Double = 0
    var cost = Cost()
    var final = false
}

/// A tower level base: the BigUInt level and digits from which fast levels count down.
struct LevelBase {
    let tower: Int32
    let k0: BigUInt
    let k0Small: Int?
    /// (k0 − 1) mod 3, for k0 ≥ 1.
    let r0: Int
    /// ⌊(k0 − 1) / 3⌋ when small.
    let q0Small: Int?
    /// Digits from the tower's top to k0 (copy keys, §3.4.5).
    let runs0: [[DigitRun]]

    init(tower: Int32, k0: BigUInt, runs0: [[DigitRun]]) {
        self.tower = tower
        self.k0 = k0
        self.runs0 = runs0
        k0Small = k0.int
        if k0.isZero {
            r0 = 0
            q0Small = 0
        } else {
            let (q, r) = k0.minus(1).dividedSmall(3)
            r0 = Int(r)
            q0Small = q.int.flatMap { $0 < 1_000_000 ? $0 : nil }
        }
    }

    /// The axis of the level `depth` below k0, and whether that level is at least 4.
    @inline(__always) func axis(_ depth: Int) -> (axis: Int, atLeastFour: Bool) {
        (((r0 - depth) % 3 + 3) % 3, k0Small.map { $0 - depth >= 4 } ?? true)
    }

    /// Whether the level `depth` below k0 is 0, and its axis, without f^−u(k).
    @inline(__always) func levelKind(_ depth: Int) -> (isZero: Bool, axis: Int) {
        if let k = k0Small, k - depth == 0 { return (true, 0) }
        return (false, ((r0 - depth) % 3 + 3) % 3)
    }

    /// The level `depth` below k0: whether it is 0, its axis, and f^−u(k).
    func level(_ depth: Int, factor f: Int) -> (isZero: Bool, axis: Int, inverseUnit: Double, atLeastFour: Bool) {
        if let k = k0Small, k - depth == 0 { return (true, 0, 1, false) }
        let axis = ((r0 - depth) % 3 + 3) % 3
        var inv = 0.0
        if let q = q0Small {
            let drop = depth > r0 ? (depth - r0 + 2) / 3 : 0
            let u = q - drop
            inv = u < 4000 ? pow(Double(f), -Double(u)) : 0
        }
        let atLeastFour = k0Small.map { $0 - depth >= 4 } ?? true
        return (false, axis, inv, atLeastFour)
    }

    func shape(_ depth: Int) -> LevelShape { LevelShape(k0.minus(BigUInt(depth))) }
}

/// Plain values only, so reading one per node copies no references.
struct BodyState {
    let index: Int
    let sigma: Double
    let worldFromAnchor: RigidD
    let worldRotation: Mat3
    /// The camera in anchor coordinates.
    let cameraA: Vec3
    /// c(A), the anchor's local centre.
    let anchorCentre: Vec3
    let terrain: Bool
    let base: Int32
    var bubble: Bool = false
    /// cameraFromAnchor without σ: cameraFromWorld's rotation times worldFromAnchor's, and
    /// where the anchor's origin lands in camera space.
    var cameraRotation: Mat3 = .identity
    var cameraTranslation: Vec3 = .zero
}

/// A set of display keys with open addressing: the keys are SplitMix outputs, already mixed,
/// so their low bits index the table directly (§9.1's hysteresis reads it per visit).
struct KeySet: Sendable {
    private var slots: [UInt64] = []
    private var hasZero = false
    private(set) var count = 0

    init() {}

    func contains(_ k: UInt64) -> Bool {
        if k == 0 { return hasZero }
        guard !slots.isEmpty else { return false }
        let mask = slots.count - 1
        var i = Int(truncatingIfNeeded: k) & mask
        while true {
            let v = slots[i]
            if v == k { return true }
            if v == 0 { return false }
            i = (i + 1) & mask
        }
    }

    mutating func insert(_ k: UInt64) {
        if k == 0 {
            if !hasZero { count += 1 }
            hasZero = true
            return
        }
        if 2 * (count + 1) > slots.count { grow() }
        let mask = slots.count - 1
        var i = Int(truncatingIfNeeded: k) & mask
        while true {
            let v = slots[i]
            if v == k { return }
            if v == 0 {
                slots[i] = k
                count += 1
                return
            }
            i = (i + 1) & mask
        }
    }

    private mutating func grow() {
        let old = slots
        slots = [UInt64](repeating: 0, count: max(64, old.count * 2))
        let mask = slots.count - 1
        for k in old where k != 0 {
            var i = Int(truncatingIfNeeded: k) & mask
            while slots[i] != 0 { i = (i + 1) & mask }
            slots[i] = k
        }
    }
}

/// Exposed atoms ready to draw, item-local positions computed at emission.
struct AtomSet {
    var atomicNumbers: [UInt8]
    var positions: [SIMD3<Float>]
}

final class CutBuilder {
    let view: ViewState
    let budgets: Budgets
    let resolver: Resolver
    let previousRefined: KeySet
    let camera: Vec3
    let cameraFromWorld: RigidD
    let cameraRotation: Mat3
    let k: Double
    let tau: Double
    let cosX: Double, sinX: Double, cosY: Double, sinY: Double
    var cameraFrameOrigin: Vec3

    @exclusivity(unchecked) var bodies: [BodyState] = []
    var frames: [BodyFrame] = []
    @exclusivity(unchecked) var nodes: [CNode] = []
    @exclusivity(unchecked) var arena: [Cut.ArenaEntry] = []
    var bases: [[Step]] = []
    @exclusivity(unchecked) var towers: [TowerContext] = []
    var towerIndex: [NodeID: Int32] = [:]
    @exclusivity(unchecked) var crystals: [CrystalGeometry] = []
    var crystalIndex: [NodeID: Int32] = [:]
    var crystalIDs: [NodeID] = []
    @exclusivity(unchecked) var views: [View] = []
    /// Per view: its aggregate's splats, and its materialization key once formed.
    @exclusivity(unchecked) var viewSplats: [[SIMD4<Double>]] = []
    @exclusivity(unchecked) var viewKeys: [String?] = []
    /// The node every unsubstituted seed copy of a tower starts from, by tower slot.
    var seedTemplates: [Int32: CNode] = [:]
    @exclusivity(unchecked) var levelBases: [LevelBase] = []
    @exclusivity(unchecked) var kidScratch: [Int32] = []
    @exclusivity(unchecked) var keepScratch: [Bool] = []
    /// A level's envelope and f^−u by (level base, depth): every node of one level shares them.
    @exclusivity(unchecked) var levelShapes: [Int64: (Box3, Double)] = [:]
    /// The cells of crystal box nodes, kept apart so nodes stay small to copy.
    @exclusivity(unchecked) var cellBoxes: [CellBox] = []

    func addCellBox(_ b: CellBox) -> Int32 {
        cellBoxes.append(b)
        return Int32(cellBoxes.count - 1)
    }
    /// Each level base's interned identity in the resident store, once formed.
    @exclusivity(unchecked) var levelBaseIDs: [Int32] = []
    let resident: ResidentStore
    @exclusivity(unchecked) var rotations: [Mat3] = []
    @exclusivity(unchecked) var atomSets: [AtomSet] = []
    var starts: [Int32] = []
    var planes: [DrawItem] = []

    @exclusivity(unchecked) var items: [DrawItem] = []
    @exclusivity(unchecked) var used = Cost()
    @exclusivity(unchecked) var overBudget = false
    @exclusivity(unchecked) var visited = 0
    @exclusivity(unchecked) var pops = 0
    @exclusivity(unchecked) var requests = 0
    @exclusivity(unchecked) var materialized = 0
    @exclusivity(unchecked) var refined = KeySet()
    @exclusivity(unchecked) var drawnAtoms = 0
    var bodyCounts: [Magnitude] = []
    var failures: [Int: ScaleError] = [:]

    init(view: ViewState, budgets: Budgets, previous: Cut?, resolver: Resolver) {
        self.view = view
        self.budgets = budgets
        self.resolver = resolver
        resident = ResidentStore.of(resolver)
        previousRefined = previous?.refined ?? KeySet()
        nodes.reserveCapacity(4 * budgets.visits + 1024)
        arena.reserveCapacity(4 * budgets.visits + 1024)
        items.reserveCapacity(budgets.items + 64)
        cameraFromWorld = view.cameraFromWorld
        cameraRotation = view.cameraFromWorld.rotation.matrix
        camera = view.cameraPosition
        k = view.pixelsPerRadian
        tau = budgets.tau
        let halfY = view.fovY / 2
        let halfX = atan(tan(halfY) * Double(view.viewportWidth) / Double(view.viewportHeight))
        cosX = cos(halfX)
        sinX = sin(halfX)
        cosY = cos(halfY)
        sinY = sin(halfY)
        if let o = previous?.cameraFrameOrigin, (o - view.cameraPosition).length <= CutTuning.cameraFrameRange {
            cameraFrameOrigin = o
        } else {
            cameraFrameOrigin = view.cameraPosition
        }
    }

    // MARK: Tables

    func towerSlot(_ rec: NodeRecord) throws -> Int32 {
        if let i = towerIndex[rec.id] { return i }
        towers.append(try TowerContext.of(rec, resolver))
        let i = Int32(towers.count - 1)
        towerIndex[rec.id] = i
        return i
    }

    func crystalSlot(_ id: NodeID, _ c: CrystalNode) -> Int32 {
        if let i = crystalIndex[id] { return i }
        let g = resolver.cached("geom:" + id.hex) { CrystalGeometry(c) }
        crystals.append(g)
        crystalIDs.append(id)
        let i = Int32(crystals.count - 1)
        crystalIndex[id] = i
        return i
    }

    func rotationSlot(_ m: Mat3) -> Int32 {
        if m.isIdentity { return -1 }
        rotations.append(m)
        return Int32(rotations.count - 1)
    }

    func rotation(_ i: Int32) -> Mat3 { i < 0 ? .identity : rotations[Int(i)] }

    // MARK: Running

    func run() -> Cut {
        // Starting nodes enter in decreasing ρ while the budgets hold (§9.5).
        let order = starts.sorted { heapBefore($0, $1) }
        var heap = NodeHeap()
        heap.a.reserveCapacity(budgets.items + 64)
        for s in order {
            let c = nodes[Int(s)].cost
            if fits(used + c) {
                used = used + c
                heap.push(s, self)
            } else {
                overBudget = true
            }
        }
        for p in planes where fits(used + Cost(items: 1, atoms: 0, boxes: 0)) {
            used.items += 1
            items.append(p)
        }
        while let x = heap.pop(self) {
            pops += 1
            if visited == budgets.visits {
                emit(x)
                continue
            }
            visited += 1
            let rho = nodes[Int(x)].rho, key64 = nodes[Int(x)].key64
            // A node that carries removals is split whatever its ρ (§9.5): its stand-in would
            // draw what was removed.
            let wantRefine = rho > tau || (rho >= tau / 2 && previousRefined.contains(key64)) || nodes[Int(x)].hasRemovals
            if !wantRefine || nodes[Int(x)].final {
                emit(x)
                continue
            }
            guard let kids = expand(x) else {
                requests += 1
                emit(x)
                continue
            }
            if kids.count == 1 && kids[0] == x {
                // Refinement cannot fit (atomsOf found the atom budget spent).
                overBudget = true
                emit(x)
                continue
            }
            var next = used - nodes[Int(x)].cost
            for kid in kids { next = next + nodes[Int(kid)].cost }
            if !fits(next) {
                overBudget = true
                emit(x)
                continue
            }
            used = next
            refined.insert(key64)
            for kid in kids { heap.push(kid, self) }
        }
        let largest = max(
            Double(used.items) / Double(max(1, budgets.items)), Double(used.atoms) / Double(max(1, budgets.instancedAtoms)),
            Double(used.boxes) / Double(max(1, budgets.boxesAndSplats)), Double(visited) / Double(max(1, budgets.visits))
        )
        return Cut(
            items: items, bodyCounts: bodyCounts, drawnAtoms: drawnAtoms, visited: visited, overBudget: overBudget, pops: pops,
            requests: requests, materialized: materialized, cameraFrameOrigin: cameraFrameOrigin, usedItems: Int(used.items),
            usedAtoms: Int(used.atoms), usedBoxesAndSplats: Int(used.boxes), largestUsage: largest, failures: failures,
            bodies: frames,
            bodyEntities: bodies.map { RigidD(rotation: $0.worldFromAnchor.rotation, translation: $0.worldFromAnchor.apply($0.sigma * $0.anchorCentre)) },
            refined: refined, arena: arena, bases: bases
        )
    }

    func fits(_ c: Cost) -> Bool {
        Int(c.items) <= budgets.items && Int(c.atoms) <= budgets.instancedAtoms && Int(c.boxes) <= budgets.boxesAndSplats
    }

    /// Heap order: larger ρ first; ties, larger projected area, then smaller key32 (§9.5).
    func heapBefore(_ a: Int32, _ b: Int32) -> Bool {
        let x = nodes[Int(a)], y = nodes[Int(b)]
        if x.rho != y.rho { return x.rho > y.rho }
        if x.area != y.area { return x.area > y.area }
        return UInt32(truncatingIfNeeded: x.key64) < UInt32(truncatingIfNeeded: y.key64)
    }

    // MARK: Nodes

    /// Records a node: evaluates its ρ, culls it against the frustum, the enclosed rule and the
    /// excavation bubble. Returns its handle, or nil when it is not drawn.
    func add(_ node: CNode, parent: Int32, step: Cut.LiteStep, base: Int32 = -1) -> Int32? {
        let b = bodies[Int(node.body)]
        let r = rotation(node.rot)
        let centreA = node.s * (node.rot < 0 ? node.bounds.centre : r * node.bounds.centre) + node.t
        let radius = b.sigma * node.s * node.bounds.radius
        // Camera space directly: the camera sits at its origin.
        let p = b.cameraRotation * (b.sigma * centreA) + b.cameraTranslation
        // Frustum: in front of the near plane, inside the far plane and the four sides, first by the
        // bounding sphere, then by the box's extent along each axis of the camera (a slab of a big
        // node beside the view passes the sphere test).
        if p.z - radius > -view.zNear { return nil }
        if -p.z - radius > view.zFar { return nil }
        if p.x * cosX + p.z * sinX > radius || -p.x * cosX + p.z * sinX > radius { return nil }
        if p.y * cosY + p.z * sinY > radius || -p.y * cosY + p.z * sinY > radius { return nil }
        let m = node.rot < 0 ? b.cameraRotation : b.cameraRotation * r
        let h = node.bounds.halfExtents * (node.s * b.sigma)
        let e = Vec3(
            abs(m[0, 0]) * h.x + abs(m[0, 1]) * h.y + abs(m[0, 2]) * h.z,
            abs(m[1, 0]) * h.x + abs(m[1, 1]) * h.y + abs(m[1, 2]) * h.z,
            abs(m[2, 0]) * h.x + abs(m[2, 1]) * h.y + abs(m[2, 2]) * h.z
        )
        if p.z - e.z > -view.zNear || -p.z - e.z > view.zFar { return nil }
        let ex = e.x * cosX + e.z * sinX, ey = e.y * cosY + e.z * sinY
        if p.x * cosX + p.z * sinX > ex || -p.x * cosX + p.z * sinX > ex { return nil }
        if p.y * cosY + p.z * sinY > ey || -p.y * cosY + p.z * sinY > ey { return nil }
        var faces = node.faces
        if node.solid && node.kind != .atoms && b.bubble {
            if insideBubble(node, b) { return nil }
            faces |= bubbleFaces(node, b)
        }
        if node.solid && !node.hasRemovals && node.kind != .atoms {
            // Enclosed (§9.4), or every exposed face turned away from the camera: nothing of it shows.
            if faces & frontFaces(node, b) == 0 && !(b.bubble && intersectsBubble(node, b)) { return nil }
        }
        let dist = p.length
        let projected = radius / max(dist, view.zNear)
        // Appended as given, then patched in place: a node is copied once.
        nodes.append(node)
        let i = nodes.count - 1
        nodes[i].faces = faces
        nodes[i].rho = node.final ? 0 : node.epsilon * node.s * b.sigma * k / max(dist - radius, view.zNear)
        nodes[i].area = projected * projected
        arena.append(Cut.ArenaEntry(parent: parent, base: base, step: step))
        return Int32(i)
    }

    func intersectsBubble(_ n: CNode, _ b: BodyState) -> Bool {
        let box = n.bounds.transformed(scale: n.s, rotation: rotation(n.rot), translation: n.t)
        return box.distance(to: b.cameraA) <= CutTuning.bubbleRadius / b.sigma
    }

    /// Faces whose neighbour across meets the excavation bubble are exposed (§9.5).
    func bubbleFaces(_ n: CNode, _ b: BodyState) -> UInt8 {
        guard n.rot < 0 else { return CutBuilder.allFacesMask }
        let box = n.bounds.transformed(scale: n.s, rotation: .identity, translation: n.t)
        let r = CutTuning.bubbleRadius / b.sigma
        var faces: UInt8 = 0
        for a in 0..<3 {
            var shift = Vec3.zero
            shift[a] = box.size[a]
            if Box3(min: box.min - shift, max: box.max - shift).distance(to: b.cameraA) <= r { faces |= 1 << UInt8(2 * a) }
            if Box3(min: box.min + shift, max: box.max + shift).distance(to: b.cameraA) <= r { faces |= 1 << UInt8(2 * a + 1) }
        }
        return faces
    }

    static let allFacesMask: UInt8 = 0b11_1111

    /// The faces of a solid node whose outer side holds the camera, give or take two atom radii
    /// for the bumps of the outermost layer. Solid nodes are axis-aligned in their own frame
    /// (§9.2: a solid seed's periods equal its extents), so each face is a coordinate plane.
    func frontFaces(_ n: CNode, _ b: BodyState) -> UInt8 {
        let c = rotation(n.rot).transposed * (b.cameraA - n.t) / n.s
        let tol = 2 * n.epsilon
        var m: UInt8 = 0
        for a in 0..<3 {
            if c[a] < n.bounds.min[a] + tol { m |= 1 << UInt8(2 * a) }
            if c[a] > n.bounds.max[a] - tol { m |= 1 << UInt8(2 * a + 1) }
        }
        return m
    }

    func insideBubble(_ n: CNode, _ b: BodyState) -> Bool {
        let box = n.bounds.transformed(scale: n.s, rotation: rotation(n.rot), translation: n.t)
        let r = CutTuning.bubbleRadius / b.sigma
        for corner in 0..<8 {
            let c = Vec3(corner & 1 == 0 ? box.min.x : box.max.x, corner & 2 == 0 ? box.min.y : box.max.y, corner & 4 == 0 ? box.min.z : box.max.z)
            if (c - b.cameraA).length > r { return false }
        }
        return true
    }

    /// Stand-in costs (§9.5): one item, plus its box or splats, plus atoms for a final item.
    func standInCost(_ kind: CKind, splats: Int = 0, atoms: Int = 0) -> Cost {
        switch kind {
        case .level, .box, .copy: Cost(items: 1, atoms: 0, boxes: 1)
        case .view: Cost(items: 1, atoms: 0, boxes: Int32(max(1, splats)))
        case .atoms: Cost(items: 1, atoms: Int32(atoms), boxes: 0)
        case .mesh: Cost(items: 1, atoms: 0, boxes: 0)
        }
    }
}

/// A binary max-heap of node handles, ordered as `CutBuilder.heapBefore`. Entries carry their
/// keys, so comparisons never read the node table.
struct NodeHeap {
    struct Entry {
        var rho: Double
        var area: Double
        var key32: UInt32
        var handle: Int32

        @inline(__always) static func before(_ x: Entry, _ y: Entry) -> Bool {
            if x.rho != y.rho { return x.rho > y.rho }
            if x.area != y.area { return x.area > y.area }
            return x.key32 < y.key32
        }
    }

    var a: [Entry] = []

    mutating func push(_ x: Int32, _ b: CutBuilder) {
        let e = b.nodes.withUnsafeBufferPointer { n in
            Entry(rho: n[Int(x)].rho, area: n[Int(x)].area, key32: UInt32(truncatingIfNeeded: n[Int(x)].key64), handle: x)
        }
        a.append(e)
        a.withUnsafeMutableBufferPointer { h in
            var i = h.count - 1
            while i > 0 {
                let p = (i - 1) / 2
                guard Entry.before(e, h[p]) else { break }
                h[i] = h[p]
                i = p
            }
            h[i] = e
        }
    }

    mutating func pop(_ b: CutBuilder) -> Int32? {
        guard let top = a.first else { return nil }
        let last = a.removeLast()
        if !a.isEmpty {
            a.withUnsafeMutableBufferPointer { h in
                // Sift the last entry down from the root, moving holes instead of swapping.
                let count = h.count
                var i = 0
                while true {
                    let l = 2 * i + 1
                    if l >= count { break }
                    var m = l
                    if l + 1 < count && Entry.before(h[l + 1], h[l]) { m = l + 1 }
                    guard Entry.before(h[m], last) else { break }
                    h[i] = h[m]
                    i = m
                }
                h[i] = last
            }
        }
        return top.handle
    }
}

/// The display key of a child: mix64(key64(parent) + γ × (i + 1)) (§9.7).
@inline(__always) func childKey(_ parent: UInt64, _ i: Int) -> UInt64 {
    SplitMix64.mix(parent &+ 0x9E37_79B9_7F4A_7C15 &* UInt64(i + 1))
}
