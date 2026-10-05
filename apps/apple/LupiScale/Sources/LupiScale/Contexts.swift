import Foundation
import LupiChem
import LupiScaleCore

/// The shape of a tower level in its own units (§3.4.1): extents in {1, f} × the periods.
struct LevelShape: Sendable {
    let k: BigUInt
    /// Per axis, whether the level holds f (rather than 1) of its unit along the axis.
    let wide: (Bool, Bool, Bool)
    /// u(k).
    let u: BigUInt

    init(_ k: BigUInt) {
        self.k = k
        if k.isZero {
            wide = (false, false, false)
            u = BigUInt()
        } else {
            let (q, r) = k.minus(1).dividedSmall(3)
            u = q
            wide = (true, r >= 1, r >= 2)
        }
    }

    func counts(_ f: Int) -> [Double] {
        [wide.0 ? Double(f) : 1, wide.1 ? Double(f) : 1, wide.2 ? Double(f) : 1]
    }

    /// f^−u(k) in binary64; 0 once it underflows.
    func inverseUnit(_ f: Int) -> Double {
        guard let small = u.int, small < 4000 else { return 0 }
        return pow(Double(f), -Double(small))
    }
}

/// Per tower record: what every level of it shares (§9.6: aggregates by (tower, k)).
final class TowerContext: Sendable {
    let record: NodeRecord
    let tower: TowerNode
    let factor: Int
    /// Periods in Å.
    let periods: [Vec3]
    /// ω_a = |det| / |p_b × p_c|, Å (§8.4).
    let width: [Double]
    let seedAggregate: Aggregate
    let seedCount: BigUInt
    /// The seed is an open crystal box whose periods equal its extents (§9.2).
    let solid: Bool
    let seedCrystal: CrystalNode?
    /// ε at u = 0, Å (§9.2).
    let epsilon: Double
    let colour: Vec3
    let rAtom: Double
    /// One seed copy's mass with the substitution, µDa.
    let unitMicroDa: BigUInt
    let seedCovariance: Mat3
    let seedCentreOfMass: Vec3
    /// The inverse of the period matrix, for points to digits (§4.8).
    let inversePeriods: Mat3
    /// A solid seed's atoms: their owner cells, and the indices on each face's outer cell layer
    /// (bit 2a lower, 2a + 1 upper), so exposed atoms are a union of lists (§9.5).
    let seedCells: [SIMD3<UInt64>]?
    let faceAtoms: [[Int32]]
    let idHex: String
    /// The seed's splats about its local centre, Float32, shared by every copy's item.
    let seedSplats: [SIMD4<Float>]

    var unitMass: Magnitude { Magnitude(unitMicroDa) }

    init(_ rec: NodeRecord, _ t: TowerNode, _ r: Resolver) throws {
        record = rec
        tower = t
        factor = Int(t.factor)
        let p = t.periodsQ16.map { Vec3(Double($0.x), Double($0.y), Double($0.z)) / 65536 }
        periods = p
        let det = p[0].dot(p[1].cross(p[2]))
        width = (0..<3).map { a in abs(det) / p[(a + 1) % 3].cross(p[(a + 2) % 3]).length }
        let seedView = try r.root(t.seed)
        seedAggregate = try r.aggregate(seedView)
        seedCount = try r.count(seedView).plain ?? BigUInt()
        var crystal: CrystalNode?
        var isSolid = false
        if case let .crystal(c)? = try r.record(t.seed).node, c.termination == .open {
            crystal = c
            let q = Int64(c.quarterQ16)
            let n = c.cells
            isSolid = t.periodsQ16[0] == SIMD3(4 * Int64(n.x) * q, 0, 0)
                && t.periodsQ16[1] == SIMD3(0, 4 * Int64(n.y) * q, 0)
                && t.periodsQ16[2] == SIMD3(0, 0, 4 * Int64(n.z) * q)
        }
        seedCrystal = crystal
        solid = isSolid
        rAtom = seedAggregate.rAtom
        let longest = p.map(\.length).max()!
        epsilon = isSolid ? rAtom : seedAggregate.radius + longest
        let comp = try r.composition(r.walk(r.root(rec.id), []))
        var micro = BigUInt()
        for (z, n) in comp.unit { micro += n.multipliedSmall(ScaleElements.microDaltons(z) ?? 0) }
        unitMicroDa = micro
        var counts: [UInt8: Double] = [:]
        for (z, n) in comp.unit { counts[z] = n.double }
        colour = Toy.meanColour(counts)
        seedCovariance = seedAggregate.covariance
        seedCentreOfMass = seedAggregate.centreOfMass
        let m = Mat3(columns: p[0], p[1], p[2])
        inversePeriods = m.inverse
        idHex = rec.id.hex
        let centre = seedAggregate.bounds.centre
        seedSplats = seedAggregate.splats.map { SIMD4(Float($0.x - centre.x), Float($0.y - centre.y), Float($0.z - centre.z), Float($0.w)) }
        if isSolid, let c = crystal {
            let cells = CrystalMath.atoms(c, CrystalMath.rootBox(c)).cells
            var lists = [[Int32]](repeating: [], count: 6)
            for (i, cell) in cells.enumerated() {
                for a in 0..<3 {
                    if cell[a] == 0 { lists[2 * a].append(Int32(i)) }
                    if cell[a] == c.cells[a] - 1 { lists[2 * a + 1].append(Int32(i)) }
                }
            }
            seedCells = cells
            faceAtoms = lists
        } else {
            seedCells = nil
            faceAtoms = []
        }
    }

    static func of(_ rec: NodeRecord, _ r: Resolver) throws -> TowerContext {
        try r.cached("tower:" + rec.id.hex) {
            guard case let .tower(t)? = rec.node else { throw ScaleError(.path, "not a tower") }
            return try TowerContext(rec, t, r)
        }
    }

    /// The level's stand-in box in its own units (§9.2): the atom envelope of its copies, and for
    /// a seed that does not tile, grown to cover the period cells.
    func envelope(_ shape: LevelShape) -> Box3 {
        envelope(counts: shape.counts(factor), inverseUnit: shape.inverseUnit(factor))
    }

    /// The envelope of a level k ≥ 1 with (k − 1) mod 3 = `axis` and f^−u(k) = `eps`, without
    /// BigUInt arithmetic: the level holds f units along axes 0…axis and 1 along the others.
    func envelope(axis: Int, inverseUnit eps: Double) -> Box3 {
        let f = Double(factor)
        return envelope(counts: Vec3(f, axis >= 1 ? f : 1, axis >= 2 ? f : 1), inverseUnit: eps)
    }

    func envelope(counts c: [Double], inverseUnit eps: Double) -> Box3 {
        envelope(counts: Vec3(c[0], c[1], c[2]), inverseUnit: eps)
    }

    func envelope(counts n: Vec3, inverseUnit eps: Double) -> Box3 {
        let seed = seedAggregate.bounds
        var lo = seed.min * eps, hi = seed.max * eps
        for a in 0..<3 {
            let reach = (n[a] - eps) * periods[a]
            lo += simdMin(reach, .zero)
            hi += simdMax(reach, .zero)
        }
        let box = Box3(min: lo, max: hi)
        return solid ? box : box.union(cells(counts: n))
    }

    /// The period cells of a level, its own units: Σ n_a p_a.
    func cells(_ shape: LevelShape) -> Box3 {
        let c = shape.counts(factor)
        return cells(counts: Vec3(c[0], c[1], c[2]))
    }

    func cells(counts n: Vec3) -> Box3 {
        var lo = Vec3.zero, hi = Vec3.zero
        for a in 0..<3 {
            let cell = n[a] * periods[a]
            lo += simdMin(cell, .zero)
            hi += simdMax(cell, .zero)
        }
        return Box3(min: lo, max: hi)
    }

    /// The translation of child j of level k, in level k's units: j · p_axis(k).
    func childTranslation(axis a: Int, digit j: Int) -> Vec3 { Double(j) * periods[a] }
}

/// Per crystal record: box envelopes and the unit cell (§3.3, §9.2, §10.3).
struct CrystalGeometry: Sendable {
    let crystal: CrystalNode
    let rAtom: Double
    /// Quarter step, Å.
    let quarter: Double
    /// The largest site offset per axis, in quarter steps.
    let maxSite: [Double]
    let cellCovariance: Mat3
    let cellCentreOfMass: Vec3
    let colourBySpecies: [UInt8: Double]

    init(_ c: CrystalNode) {
        crystal = c
        let sites = CrystalGeometry.sites(c)
        var species = Set<UInt8>()
        for s in sites { species.insert(s.z) }
        if c.termination == .capped { species.insert(c.capZ) }
        rAtom = Toy.largestRadius(species)
        quarter = Double(c.quarterQ16) / 65536
        maxSite = (0..<3).map { a in sites.map { Double($0.s[a]) }.max() ?? 0 }
        let pos = sites.map { Vec3(Double($0.s.x), Double($0.s.y), Double($0.s.z)) * (Double(c.quarterQ16) / 65536) }
        (cellCentreOfMass, cellCovariance) = Aggregates.covariance(pos, sites.map { Toy.mass($0.z) })
        var counts: [UInt8: Double] = [:]
        for s in sites { counts[s.z, default: 0] += 1 }
        colourBySpecies = counts
    }

    struct Site {
        var s: SIMD3<Int64>
        var z: UInt8
    }

    static func sites(_ c: CrystalNode) -> [Site] {
        let base: [(Int64, Int64, Int64, Int)]
        switch c.structure {
        case .sc: base = [(0, 0, 0, 0)]
        case .bcc: base = [(0, 0, 0, 0), (2, 2, 2, 1)]
        case .fcc: base = [(0, 0, 0, 0), (0, 2, 2, 0), (2, 0, 2, 0), (2, 2, 0, 0)]
        case .diamond:
            base = [(0, 0, 0, 0), (0, 2, 2, 0), (2, 0, 2, 0), (2, 2, 0, 0), (1, 1, 1, 1), (1, 3, 3, 1), (3, 1, 3, 1), (3, 3, 1, 1)]
        case .rocksalt:
            base = [(0, 0, 0, 0), (0, 2, 2, 0), (2, 0, 2, 0), (2, 2, 0, 0), (2, 0, 0, 1), (0, 2, 0, 1), (0, 0, 2, 1), (2, 2, 2, 1)]
        }
        return base.map { Site(s: SIMD3($0.0, $0.1, $0.2), z: $0.3 == 0 || c.speciesB == 0 ? c.speciesA : c.speciesB) }
    }

    /// The atom envelope of a box in the box's frame (origin at its lower corner), Å.
    func envelope(_ b: CellBox) -> Box3 {
        var hi = Vec3.zero
        for a in 0..<3 {
            let e = Double(b.extent(a))
            let closedFace = crystal.termination == .closed && b.hi[a] == crystal.cells[a]
            hi[a] = closedFace ? 4 * e * quarter : (4 * (e - 1) + maxSite[a]) * quarter
        }
        return Box3(min: .zero, max: hi).expanded(by: rAtom)
    }

    /// The cell box of a box in its frame, Å: what the box occupies.
    func cells(_ b: CellBox) -> Box3 {
        Box3(min: .zero, max: Vec3((0..<3).map { Double(b.extent($0)) * 4 * quarter }.vec3))
    }

    var cellWidth: Double { 4 * quarter }
}

extension Array where Element == Double {
    var vec3: Vec3 { Vec3(self[0], self[1], self[2]) }
}

extension Vec3 {
    init(_ a: [Double]) { self.init(a[0], a[1], a[2]) }
}

extension Mat3 {
    var inverse: Mat3 {
        let a = c0, b = c1, c = c2
        let r0 = b.cross(c), r1 = c.cross(a), r2 = a.cross(b)
        let det = a.dot(r0)
        guard det != 0 else { return .zero }
        return Mat3(rows: r0 / det, r1 / det, r2 / det)
    }
}
