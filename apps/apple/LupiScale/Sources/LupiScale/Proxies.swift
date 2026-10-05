import Foundation
import LupiChem
import LupiScaleCore

/// One piece of a body's collider, in metres relative to the node's local centre c(X) (§10.4).
/// The app builds each with `ShapeResource.generateSphere`, `generateBox` or `generateConvex`.
public enum CollisionShape: Sendable, Equatable {
    case sphere(centre: SIMD3<Double>, radius: Double)
    case box(centre: SIMD3<Double>, halfExtents: SIMD3<Double>, rotation: Quat)
    case convex(points: [SIMD3<Double>])

    /// The same shape inset by `d` metres on every side: fresh pieces start apart (§10.4).
    public func inset(by d: Double) -> CollisionShape {
        switch self {
        case let .sphere(c, r): return .sphere(centre: c, radius: max(r - d, 0.25 * r))
        case let .box(c, h, q): return .box(centre: c, halfExtents: simdMax(h - Vec3(repeating: d), 0.25 * h), rotation: q)
        case let .convex(points):
            var centre = Vec3.zero
            for p in points { centre += p }
            centre /= Double(max(1, points.count))
            return .convex(points: points.map { p in
                let v = p - centre
                let l = v.length
                return l > d ? centre + v * ((l - d) / l) : centre + 0.25 * v
            })
        }
    }

    public var boundingRadius: Double {
        switch self {
        case let .sphere(c, r): return c.length + r
        case let .box(c, h, _): return c.length + h.length
        case let .convex(points): return points.map(\.length).max() ?? 0
        }
    }
}

/// The proxy of a node (§10.4): spheres for atoms, a box for a crystal box or an orthogonal
/// level, a hull for an oblique level, children's spheres for a group.
public func collisionProxy(for view: View, metresPerUnit: Double, maxShapes: Int, resolver: Resolver) throws -> [CollisionShape] {
    let key = "proxy:\(ViewKey.of(view)):\(maxShapes):\(quantized(metresPerUnit))"
    return try resolver.cached(key) { try Proxies.make(view, metresPerUnit, maxShapes, resolver) }
}

/// σ quantized to 1/64 of a binary octave, for proxy caching (§10.4).
func quantized(_ sigma: Double) -> Int64 { Int64((log2(sigma) * 64).rounded()) }

enum Proxies {
    static func make(_ v: View, _ sigma: Double, _ maxShapes: Int, _ r: Resolver) throws -> [CollisionShape] {
        let agg = try r.aggregate(v)
        let centre = agg.centre
        switch v.kind {
        case .level:
            if !v.removals.isEmpty { return try remaining(v, sigma, maxShapes, r) }
            let tc = try TowerContext.of(v.record, r)
            if orthogonal(tc.periods) { return [box(agg.bounds, centre, sigma)] }
            return [hull(tc, LevelShape(v.level), centre, sigma)]
        case .box:
            if !v.removals.isEmpty && !r.isMaterializable(v) { return try remaining(v, sigma, maxShapes, r) }
            return [box(agg.bounds, centre, sigma)]
        case .group:
            return try groupSpheres(v, sigma, min(64, maxShapes), r)
        default:
            return atomSpheres(try r.materialize(v), centre, sigma, min(48, maxShapes))
        }
    }

    static func orthogonal(_ p: [Vec3]) -> Bool {
        abs(p[0].dot(p[1])) < 1e-9 * p[0].length * p[1].length && abs(p[0].dot(p[2])) < 1e-9 * p[0].length * p[2].length
            && abs(p[1].dot(p[2])) < 1e-9 * p[1].length * p[2].length
            && (0..<3).allSatisfy { a in (0..<3).filter { $0 != a }.allSatisfy { abs(p[a][$0]) < 1e-12 * p[a].length } }
    }

    static func box(_ bounds: Box3, _ centre: Vec3, _ sigma: Double) -> CollisionShape {
        .box(centre: (bounds.centre - centre) * sigma, halfExtents: bounds.halfExtents * sigma, rotation: .identity)
    }

    /// The convex hull of an oblique level's envelope corners (`generateConvex`).
    static func hull(_ tc: TowerContext, _ shape: LevelShape, _ centre: Vec3, _ sigma: Double) -> CollisionShape {
        let n = shape.counts(tc.factor)
        let eps = shape.inverseUnit(tc.factor)
        let seed = tc.seedAggregate.bounds
        var points: [Vec3] = []
        for corner in 0..<8 {
            var base = Vec3.zero
            for a in 0..<3 where corner & (1 << a) != 0 { base += (n[a] - eps) * tc.periods[a] }
            for s in 0..<8 {
                let p = Vec3(s & 1 == 0 ? seed.min.x : seed.max.x, s & 2 == 0 ? seed.min.y : seed.max.y, s & 4 == 0 ? seed.min.z : seed.max.z)
                points.append((base + eps * p - centre) * sigma)
            }
        }
        return .convex(points: points)
    }

    /// One sphere per heavy atom at its toy radius, each hydrogen folded into its nearest heavy
    /// partner (+15 % radius each), grid-merged to at most `limit` spheres (plan §3.4).
    static func atomSpheres(_ leaf: LeafNode, _ centre: Vec3, _ sigma: Double, _ limit: Int) -> [CollisionShape] {
        let pos = leaf.positions.map { Vec3(Double($0.x), Double($0.y), Double($0.z)) }
        var heavy: [(Vec3, Double)] = []
        var heavyIndex: [Int] = []
        for i in leaf.atomicNumbers.indices where leaf.atomicNumbers[i] != 1 {
            heavy.append((pos[i], Toy.radius(leaf.atomicNumbers[i])))
            heavyIndex.append(i)
        }
        if heavy.isEmpty {
            // Hydrogen only (H₂): the atoms themselves.
            heavy = leaf.atomicNumbers.indices.map { (pos[$0], Toy.radius(leaf.atomicNumbers[$0])) }
        } else {
            for i in leaf.atomicNumbers.indices where leaf.atomicNumbers[i] == 1 {
                var best = 0, bestD = Double.infinity
                for (k, h) in heavy.enumerated() {
                    let d = (h.0 - pos[i]).length
                    if d < bestD { best = k; bestD = d }
                }
                heavy[best].1 *= 1.15
            }
        }
        return merge(heavy, limit).map { .sphere(centre: ($0.0 - centre) * sigma, radius: $0.1 * sigma) }
    }

    /// Grid clustering into at most `limit` bounding spheres (plan §3.4), coarsening the grid
    /// until the occupied cells fit.
    static func merge(_ spheres: [(Vec3, Double)], _ limit: Int) -> [(Vec3, Double)] {
        guard spheres.count > limit else { return spheres }
        var box = Box3.empty
        for s in spheres { box = box.union(Box3(min: s.0, max: s.0)) }
        var cell = max(box.longest / 8, 1e-6)
        while true {
            var cells: [SIMD3<Int64>: [(Vec3, Double)]] = [:]
            for s in spheres {
                let k = SIMD3<Int64>(Int64(((s.0.x - box.min.x) / cell).rounded(.down)),
                                     Int64(((s.0.y - box.min.y) / cell).rounded(.down)),
                                     Int64(((s.0.z - box.min.z) / cell).rounded(.down)))
                cells[k, default: []].append(s)
            }
            if cells.count <= limit {
                return cells.keys.sorted { ($0.z, $0.y, $0.x) < ($1.z, $1.y, $1.x) }.map { k in
                    let members = cells[k]!
                    var c = Vec3.zero
                    for m in members { c += m.0 }
                    c /= Double(members.count)
                    let r = members.map { ($0.0 - c).length + $0.1 }.max()!
                    return (c, r)
                }
            }
            cell *= 1.5
        }
    }

    /// Children's bounding spheres; the largest is split into its own proxy until 64 shapes, or
    /// every sphere is under 8 % of the group's radius.
    static func groupSpheres(_ v: View, _ sigma: Double, _ limit: Int, _ r: Resolver) throws -> [CollisionShape] {
        let agg = try r.aggregate(v)
        let centre = agg.centre
        struct Part {
            var view: View
            var placement: Placement
            var centre: Vec3
            var radius: Double
        }
        var parts: [Part] = []
        for i in 0..<(v.groupChildren?.count ?? 0) {
            guard let w = try? r.step(v, .child(UInt16(i))) else { continue }
            let p = try r.placement(from: v.withoutRemovals, step: .child(UInt16(i)))
            let a = try r.aggregate(w)
            parts.append(Part(view: w, placement: p, centre: p.apply(a.centre), radius: a.radius * p.scale))
        }
        var leaves: [CollisionShape] = []
        while parts.count + leaves.count < limit {
            guard let largest = parts.indices.max(by: { parts[$0].radius < parts[$1].radius }),
                  parts[largest].radius >= 0.08 * agg.radius else { break }
            let part = parts.remove(at: largest)
            if part.view.kind == .group, let n = part.view.groupChildren?.count, parts.count + leaves.count + n <= limit {
                for i in 0..<n {
                    guard let w = try? r.step(part.view, .child(UInt16(i))) else { continue }
                    let p = part.placement.then(try r.placement(from: part.view.withoutRemovals, step: .child(UInt16(i))))
                    let a = try r.aggregate(w)
                    parts.append(Part(view: w, placement: p, centre: p.apply(a.centre), radius: a.radius * p.scale))
                }
            } else {
                // A part that cannot split further keeps its sphere.
                leaves.append(.sphere(centre: (part.centre - centre) * sigma, radius: part.radius * sigma))
                if parts.isEmpty { break }
                continue
            }
        }
        // A group with more children than shapes merges them (§10.4 bounds a group at 64).
        var spheres: [(Vec3, Double)] = []
        for case let .sphere(c, radius) in leaves { spheres.append((c / sigma + centre, radius / sigma)) }
        spheres += parts.map { ($0.centre, $0.radius) }
        return merge(spheres, limit).map { .sphere(centre: ($0.0 - centre) * sigma, radius: $0.1 * sigma) }
    }

    /// An edit: the proxy of the remaining children, ignoring holes smaller than 1/8 of the node.
    static func remaining(_ v: View, _ sigma: Double, _ maxShapes: Int, _ r: Resolver) throws -> [CollisionShape] {
        let whole = try r.count(v.withoutRemovals)
        let left = try r.count(v)
        let removed = try whole - left
        // Holes under 1/8 of the node are ignored (§10.4).
        if (try? removed.multiplied(by: 8).compare(whole)) ?? 1 < 0 {
            return try make(v.withoutRemovals, sigma, maxShapes, r)
        }
        let agg = try r.aggregate(v.withoutRemovals)
        var steps: [Step] = []
        var offsets: [Vec3] = []
        var scale = 1.0
        if v.kind == .level, let t = v.tower {
            let tc = try TowerContext.of(v.record, r)
            let a = TowerMath.axis(v.level)
            for j in 0..<Int(t.factor) {
                var runs: [[DigitRun]] = [[], [], []]
                runs[a] = [DigitRun(digit: UInt8(j), length: 1)]
                steps.append(.tower(levels: 1, runs: runs))
                offsets.append(Double(j) * tc.periods[a])
            }
            if a == 0 && v.level >= BigUInt(4) { scale = 1 / Double(t.factor) }
        } else if v.kind == .box, let c = v.crystal {
            let cw = 4 * Double(c.quarterQ16) / 65536
            for child in CrystalMath.octreeChildren(v.box) {
                steps.append(.cells([child.octant]))
                var o = Vec3.zero
                for a in 0..<3 { o[a] = (Double(child.box.lo[a]) - Double(v.box.lo[a])) * cw }
                offsets.append(o)
            }
        }
        var out: [CollisionShape] = []
        for (i, s) in steps.enumerated() {
            guard let w = try? r.step(v, s) else { continue }
            let a = try r.aggregate(w)
            let b = Box3(min: a.bounds.min * scale + offsets[i], max: a.bounds.max * scale + offsets[i])
            out.append(box(b, agg.centre, sigma))
        }
        return Array(out.prefix(maxShapes))
    }
}
