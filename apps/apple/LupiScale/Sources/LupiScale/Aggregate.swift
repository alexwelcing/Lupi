import Foundation
import LupiChem
import LupiScaleCore

/// Element facts for display and play: toy radii and CPK colours (plan §3.6).
enum Toy {
    /// `clamp(0.75 r_cov, 0.32, 0.90)` Å.
    static func radius(_ z: UInt8) -> Double {
        min(0.90, max(0.32, 0.75 * ChemicalElement.forAtomicNumber(Int(z)).covalentRadius))
    }

    /// Linear-light CPK colour.
    static func colour(_ z: UInt8) -> Vec3 { ChemicalElement.forAtomicNumber(Int(z)).cpk.linear }

    /// Toy radius and colour by atomic number, for drawing atoms without lookups.
    static let radii: [Float] = (0...255).map { Float(radius(UInt8($0))) }
    static let colours: [SIMD3<Float>] = (0...255).map { z in
        let c = meanColour([UInt8(z): 1])
        return SIMD3<Float>(Float(c.x), Float(c.y), Float(c.z))
    }

    /// Atomic mass in daltons (binary64; exact masses live in LupiScaleCore's µDa table).
    static func mass(_ z: UInt8) -> Double { Double(ScaleElements.microDaltons(z) ?? 12_000_000) / 1e6 }

    /// The largest toy radius of a set of elements.
    static func largestRadius(_ zs: some Sequence<UInt8>) -> Double {
        var r = 0.32
        for z in Set(zs) { r = max(r, radius(z)) }
        return r
    }

    /// Coverage-weighted mean colour (weights r², in linear light), as sRGB 0…1.
    static func meanColour(_ counts: [UInt8: Double]) -> Vec3 {
        var sum = Vec3.zero, weight = 0.0
        for (z, n) in counts {
            let r = radius(z)
            sum += n * r * r * colour(z)
            weight += n * r * r
        }
        guard weight > 0 else { return Vec3(0.5, 0.5, 0.5) }
        let lin = sum / weight
        func encode(_ c: Double) -> Double { c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055 }
        return Vec3(encode(lin.x), encode(lin.y), encode(lin.z))
    }
}

/// What a node is drawn as when it is not refined, and the facts physics reads from it
/// (§9.2, §10.3). Derived data, never identity.
public struct Aggregate: Sendable {
    /// The atom envelope: atom centres grown by `rAtom`, in the node's own units.
    public var bounds: Box3
    /// c(X), the centre of `bounds` (§8.1).
    public var centre: Vec3 { bounds.centre }
    /// Bounding radius r(X) about the centre, own units.
    public var radius: Double
    /// w(X), own units (§8.4).
    public var narrowestWidth: Double
    /// ε(X), own units (§9.2).
    public var geometricError: Double
    /// Up to 8 spheres (centre, radius), own units; empty for a solid node, which draws as a box.
    public var splats: [SIMD4<Double>]
    /// sRGB 0…1: the coverage-weighted CPK mean.
    public var colour: Vec3
    /// Mass-weighted covariance of atom positions about `centreOfMass`, own units².
    public var covariance: Mat3
    public var centreOfMass: Vec3
    public var count: Magnitude
    public var massMicroDa: Magnitude
    /// The largest toy radius of its elements, Å.
    public var rAtom: Double
    /// A crystal box, a level of a solid seed, or a copy of one (§9.2).
    public var solid: Bool
}

extension Resolver {
    /// The aggregate of a view, cached by what it depends on (§9.6).
    public func aggregate(_ view: View) throws -> Aggregate {
        try cached("agg:" + ViewKey.of(view)) { try Aggregates.make(view, self) }
    }

    /// The region a view's matter fills, own units (§10.1). A solid node's atom envelope leaves a
    /// gap of up to a spacing less two atom radii between neighbouring copies, and a point there is
    /// still inside the solid, so a level, copy or box also covers its lattice cells.
    public func occupied(_ view: View) throws -> Box3 {
        let a = try aggregate(view)
        guard a.solid, view.removals.isEmpty else { return a.bounds }
        switch view.kind {
        case .level: return a.bounds.union(try TowerContext.of(view.record, self).cells(LevelShape(view.level)))
        case .copy: return a.bounds.union(try TowerContext.of(view.record, self).cells(LevelShape(BigUInt())))
        case .box: return a.bounds.union(CrystalGeometry(view.crystal!).cells(view.box))
        default: return a.bounds
        }
    }
}

/// Cache keys for views (§9.6): by NodeID, and for virtual nodes by what fixes their shape.
enum ViewKey {
    static func of(_ v: View) -> String {
        var s = v.id.hex
        switch v.kind {
        case .leaf, .capped, .group: break
        case .box: s += ":b\(v.box.lo.x),\(v.box.lo.y),\(v.box.lo.z),\(v.box.hi.x),\(v.box.hi.y),\(v.box.hi.z)"
        case .level: s += ":k\(v.level)"
        case .copy: s += ":c" + Self.steps([.tower(levels: v.tower?.levels ?? BigUInt(), runs: v.towerRuns)])
        case .selection:
            let (base, idx) = v.selectionOf!
            s += ":s" + idx.map(String.init).joined(separator: ",") + ":" + of(base)
        }
        for r in v.removals { s += ":r" + steps(r) }
        return s
    }

    /// Exact text of steps (not canonicalized), for cache keys.
    static func steps(_ steps: [Step]) -> String {
        var w = Path()
        w.steps = steps
        return w.bytes.map { String($0, radix: 16) }.joined(separator: ".")
    }
}

enum Aggregates {
    static func make(_ v: View, _ r: Resolver) throws -> Aggregate {
        if !v.removals.isEmpty && !r.isMaterializable(v) {
            // A partly removed level, box or group keeps its base's shape and gets its exact count.
            var a = try r.aggregate(v.withoutRemovals)
            a.count = try r.count(v)
            a.massMicroDa = try r.composition(v).massMicroDa()
            return a
        }
        switch v.kind {
        case .box where v.removals.isEmpty && !r.isMaterializable(v):
            return box(CrystalGeometry(v.crystal!), v.box, count: try r.count(v))
        case .level:
            return try level(TowerContext.of(v.record, r), level: v.level)
        case .group:
            return try group(v, r)
        default:
            var a = leaf(try r.materialize(v))
            a.count = try r.count(v)
            a.massMicroDa = try r.composition(v).massMicroDa()
            if v.kind == .box {
                // A box is drawn as its box until refined, even when small (§9.2).
                let g = CrystalGeometry(v.crystal!)
                a.bounds = g.envelope(v.box)
                a.radius = a.bounds.radius
                a.splats = []
                a.geometricError = g.rAtom
                a.solid = true
            } else if v.kind == .copy, try TowerContext.of(v.record, r).solid {
                a.solid = true
                a.splats = []
                a.geometricError = a.rAtom
            }
            return a
        }
    }

    /// From atoms: leaves, capped crystals, copies and selections (§9.2).
    static func leaf(_ leaf: LeafNode) -> Aggregate {
        let n = leaf.count
        let pos = leaf.positions.map { Vec3(Double($0.x), Double($0.y), Double($0.z)) }
        let rAtom = Toy.largestRadius(leaf.atomicNumbers)
        var box = Box3.empty
        for p in pos { box = box.union(Box3(min: p, max: p)) }
        let bounds = box.expanded(by: rAtom)
        let centre = bounds.centre
        var radius = 0.0
        for p in pos { radius = max(radius, (p - centre).length) }
        radius += rAtom
        // 64-atom clusters, consecutive in Morton order (derived data).
        let order = mortonOrder(pos, box)
        var clusters: [(Vec3, Double)] = []
        var i = 0
        while i < n {
            let members = order[i..<min(i + 64, n)]
            var c = Vec3.zero
            for k in members { c += pos[k] }
            c /= Double(members.count)
            var rr = 0.0
            for k in members { rr = max(rr, (pos[k] - c).length) }
            clusters.append((c, rr + rAtom))
            i += 64
        }
        var counts: [UInt8: Double] = [:]
        for z in leaf.atomicNumbers { counts[z, default: 0] += 1 }
        let (com, cov) = covariance(pos, leaf.atomicNumbers.map(Toy.mass))
        return Aggregate(
            bounds: bounds, radius: radius, narrowestWidth: box.shortest, geometricError: clusters.map(\.1).max() ?? rAtom,
            splats: fitSplats(clusters), colour: Toy.meanColour(counts), covariance: cov, centreOfMass: com,
            count: Magnitude(n), massMicroDa: .zero, rAtom: rAtom, solid: false
        )
    }

    static func mortonOrder(_ pos: [Vec3], _ box: Box3) -> [Int] {
        let size = box.size
        func q(_ v: Double, _ a: Int) -> UInt64 {
            let span = size[a] > 0 ? size[a] : 1
            return UInt64(max(0, min(1023, ((v - box.min[a]) / span * 1023).rounded(.down))))
        }
        let keys = pos.map { p -> UInt64 in
            var k: UInt64 = 0
            let u = [q(p.x, 0), q(p.y, 1), q(p.z, 2)]
            for b in 0..<10 { for a in 0..<3 { k |= ((u[a] >> UInt64(b)) & 1) << UInt64(3 * b + a) } }
            return k
        }
        return pos.indices.sorted { keys[$0] != keys[$1] ? keys[$0] < keys[$1] : $0 < $1 }
    }

    /// Mass-weighted centre and covariance.
    static func covariance(_ pos: [Vec3], _ masses: [Double]) -> (Vec3, Mat3) {
        var total = 0.0, com = Vec3.zero
        for (p, m) in zip(pos, masses) {
            total += m
            com += m * p
        }
        guard total > 0 else { return (.zero, .zero) }
        com /= total
        var cov = Mat3.zero
        for (p, m) in zip(pos, masses) { cov = cov + outer(p - com, p - com).scaled(by: m) }
        return (com, cov.scaled(by: 1 / total))
    }

    static func outer(_ a: Vec3, _ b: Vec3) -> Mat3 { Mat3(columns: b.x * a, b.y * a, b.z * a) }

    /// A crystal box: the closed-form envelope, ε = r_atom (§9.2), the uniform-grid covariance (§10.3).
    static func box(_ g: CrystalGeometry, _ b: CellBox, count: Magnitude) -> Aggregate {
        let bounds = g.envelope(b)
        let cw = g.cellWidth
        var cov = g.cellCovariance
        var com = Vec3.zero
        for a in 0..<3 {
            let e = Double(b.extent(a))
            var v = Vec3.zero
            v[a] = cw
            cov = cov + outer(v, v).scaled(by: (e * e - 1) / 12)
            com[a] = (e - 1) / 2 * cw
        }
        let speciesCounts = CrystalMath.speciesCounts(g.crystal, b)
        var micro = BigUInt()
        var counts: [UInt8: Double] = [:]
        for (z, n) in speciesCounts {
            micro += n.multipliedSmall(ScaleElements.microDaltons(z) ?? 0)
            counts[z] = n.double
        }
        return Aggregate(
            bounds: bounds, radius: bounds.radius, narrowestWidth: g.cells(b).shortest, geometricError: g.rAtom,
            splats: [], colour: Toy.meanColour(counts), covariance: cov, centreOfMass: com + g.cellCentreOfMass,
            count: count, massMicroDa: Magnitude(micro), rAtom: g.rAtom, solid: true
        )
    }

    /// A tower level (§9.2, §10.3): the closed-form envelope and `Cov(seed) + Σ (n² − 1)/12 p pᵀ`,
    /// in the level's own units.
    static func level(_ t: TowerContext, level k: BigUInt) throws -> Aggregate {
        let shape = LevelShape(k)
        let bounds = t.envelope(shape)
        let n = shape.counts(t.factor)
        let eps = shape.inverseUnit(t.factor)
        var cov = t.seedCovariance.scaled(by: eps * eps)
        var com = t.seedCentreOfMass * eps
        for a in 0..<3 {
            cov = cov + outer(t.periods[a], t.periods[a]).scaled(by: (n[a] * n[a] - eps * eps) / 12)
            com += 0.5 * (n[a] - eps) * t.periods[a]
        }
        let count = Magnitude.tower(seedCount: t.seedCount, factor: UInt8(t.factor), levels: k)
        let mass = try Magnitude.tower(seedCount: 1, factor: UInt8(t.factor), levels: k).multiplied(by: t.unitMicroDa)
        let width = (0..<3).map { n[$0] * t.width[$0] }.min()!
        return Aggregate(
            bounds: bounds, radius: bounds.radius, narrowestWidth: width, geometricError: t.epsilon * eps,
            splats: t.solid ? [] : [SIMD4(bounds.centre.x, bounds.centre.y, bounds.centre.z, bounds.radius)],
            colour: t.colour, covariance: cov, centreOfMass: com, count: count, massMicroDa: mass, rAtom: t.rAtom, solid: t.solid
        )
    }

    /// A group: the union of its children, splats fitted to them (§9.2), parallel axes (§10.3).
    static func group(_ v: View, _ r: Resolver) throws -> Aggregate {
        let children = v.groupChildren!
        var bounds = Box3.empty
        var spheres: [(Vec3, Double)] = []
        var epsilon = 0.0, rAtom = 0.32
        var parts: [(com: Vec3, cov: Mat3, mass: Double, colour: Vec3)] = []
        for (i, c) in children.enumerated() {
            let a = try r.aggregate(r.step(v.withoutRemovals, .child(UInt16(i))))
            let m = Quat(c.rotation).matrix
            bounds = bounds.union(a.bounds.transformed(scale: 1, rotation: m, translation: c.translation))
            spheres.append((m * a.centre + c.translation, a.radius))
            epsilon = max(epsilon, a.geometricError)
            rAtom = max(rAtom, a.rAtom)
            // Masses below 2^830 µDa are finite in binary64 (§10.3).
            let mass = exp(a.massMicroDa.lnM)
            parts.append((m * a.centreOfMass + c.translation, m * a.covariance * m.transposed, mass, a.colour))
        }
        let total = parts.reduce(0) { $0 + $1.mass }
        var com = Vec3.zero
        for p in parts { com += (p.mass / total) * p.com }
        var cov = Mat3.zero
        var colour = Vec3.zero
        for p in parts {
            let w = p.mass / total
            cov = cov + (p.cov + outer(p.com - com, p.com - com)).scaled(by: w)
            colour += w * p.colour
        }
        let centre = bounds.centre
        let radius = spheres.map { ($0.0 - centre).length + $0.1 }.max() ?? 0
        return Aggregate(
            bounds: bounds, radius: radius, narrowestWidth: bounds.shortest, geometricError: max(epsilon, radius / 2),
            splats: fitSplats(spheres), colour: colour, covariance: cov, centreOfMass: com, count: try r.count(v),
            massMicroDa: try r.composition(v).massMicroDa(), rAtom: rAtom, solid: false
        )
    }

    /// Up to 8 bounding spheres over consecutive runs of the given spheres.
    static func fitSplats(_ spheres: [(Vec3, Double)]) -> [SIMD4<Double>] {
        var out: [SIMD4<Double>] = []
        let per = max(1, (spheres.count + 7) / 8)
        var s = 0
        while s < spheres.count {
            let run = spheres[s..<min(s + per, spheres.count)]
            var c = Vec3.zero
            for k in run { c += k.0 }
            c /= Double(run.count)
            var rr = 0.0
            for k in run { rr = max(rr, (k.0 - c).length + k.1) }
            out.append(SIMD4(c.x, c.y, c.z, rr))
            s += per
        }
        return out
    }
}

extension Mat3 {
    func scaled(by s: Double) -> Mat3 { Mat3(columns: s * c0, s * c1, s * c2) }
    static func + (a: Mat3, b: Mat3) -> Mat3 { Mat3(columns: a.c0 + b.c0, a.c1 + b.c1, a.c2 + b.c2) }
}
