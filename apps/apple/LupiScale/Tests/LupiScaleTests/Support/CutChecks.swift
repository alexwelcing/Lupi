import Foundation
import LupiChem
import LupiScale
import LupiScaleCore
import Testing

/// Checks on cuts shared by the guarantee tests.
enum CutChecks {
    /// §9.5's invariant: no budget exceeded, and no more pops than items + visits.
    static func withinBudgets(_ cut: Cut, _ b: Budgets, sourceLocation: SourceLocation = #_sourceLocation) {
        #expect(cut.visited <= b.visits, sourceLocation: sourceLocation)
        #expect(cut.items.count <= b.items, sourceLocation: sourceLocation)
        #expect(cut.usedItems <= b.items, sourceLocation: sourceLocation)
        #expect(cut.usedAtoms <= b.instancedAtoms, sourceLocation: sourceLocation)
        #expect(cut.usedBoxesAndSplats <= b.boxesAndSplats, sourceLocation: sourceLocation)
        #expect(cut.pops <= b.items + b.visits, sourceLocation: sourceLocation)
        let instanced = cut.items.filter { $0.kind == .atomInstances }.reduce(0) { n, item in
            if case let .atoms(runs) = item.extras { return n + runs.reduce(0) { $0 + $1.positions.count } }
            return n
        }
        #expect(instanced <= b.instancedAtoms, sourceLocation: sourceLocation)
    }

    /// No region drawn at two levels: no emitted node is an ancestor of another.
    static func noRegionTwice(_ cut: Cut, sourceLocation: SourceLocation = #_sourceLocation) {
        let emitted = Set(cut.items.map(\.node).filter { $0 >= 0 })
        for n in emitted {
            var p = cut.parent(of: n)
            while p >= 0 {
                #expect(!emitted.contains(p), "node \(p) and its descendant \(n) are both drawn", sourceLocation: sourceLocation)
                p = cut.parent(of: p)
            }
        }
    }

    /// An item's region in world space: the item's box about its origin.
    struct Region {
        var inverse: Mat3
        var translation: Vec3
        var half: Vec3

        func contains(_ p: Vec3, tolerance: Double) -> Bool {
            let local = inverse * (p - translation)
            let scale = 1 / max(1e-300, (inverse * Vec3(1, 0, 0)).length)
            let tol = tolerance / scale
            return abs(local.x) <= half.x + tol && abs(local.y) <= half.y + tol && abs(local.z) <= half.z + tol
        }
    }

    /// Where a ray first enters any item's region (its parameter, ≥ 0), or nil.
    static func entry(_ ray: RayD, _ regions: [Region]) -> Double? {
        var best: Double?
        for g in regions {
            let o = g.inverse * (ray.origin - g.translation)
            let d = g.inverse * ray.direction
            guard let (near, far) = Box3(min: -g.half, max: g.half).intersect(RayD(origin: o, direction: d)), far >= 0 else { continue }
            let t = max(near, 0)
            if best == nil || t < best! { best = t }
        }
        return best
    }

    static func regions(_ cut: Cut) -> [Region] {
        cut.items.filter { $0.kind != .facePlane }.map { item in
            let (m, t) = world(item, cut)
            return Region(inverse: inverse3(m), translation: t, half: Vec3(Double(item.halfExtents.x), Double(item.halfExtents.y), Double(item.halfExtents.z)))
        }
    }

    static func world(_ item: DrawItem, _ cut: Cut) -> (Mat3, Vec3) {
        let m = Mat3(
            columns: Vec3(Double(item.transform.c0.x), Double(item.transform.c0.y), Double(item.transform.c0.z)),
            Vec3(Double(item.transform.c1.x), Double(item.transform.c1.y), Double(item.transform.c1.z)),
            Vec3(Double(item.transform.c2.x), Double(item.transform.c2.y), Double(item.transform.c2.z))
        )
        let t = Vec3(Double(item.transform.translation.x), Double(item.transform.translation.y), Double(item.transform.translation.z))
        switch item.parent {
        case .cameraFrame: return (m, t + cut.cameraFrameOrigin)
        case let .body(b):
            let e = cut.bodyEntities[b]
            return (e.matrix * m, e.apply(t))
        }
    }

    /// Eye-space boxes of the cut's items, sorted, for comparing pictures.
    static func eyeBoxes(_ cut: Cut, _ view: ViewState) -> [[Double]] {
        cut.items.filter { $0.kind != .facePlane }.map { item -> [Double] in
            let (m, t) = world(item, cut)
            let h = Vec3(Double(item.halfExtents.x), Double(item.halfExtents.y), Double(item.halfExtents.z))
            let c = view.cameraFromWorld.apply(t)
            let r = view.cameraFromWorld.matrix * m
            let e = Vec3(
                abs(r[0, 0]) * h.x + abs(r[0, 1]) * h.y + abs(r[0, 2]) * h.z,
                abs(r[1, 0]) * h.x + abs(r[1, 1]) * h.y + abs(r[1, 2]) * h.z,
                abs(r[2, 0]) * h.x + abs(r[2, 1]) * h.y + abs(r[2, 2]) * h.z
            )
            return [c.x - e.x, c.y - e.y, c.z - e.z, c.x + e.x, c.y + e.y, c.z + e.z]
        }.sorted { a, b in a.lexicographicallyPrecedes(b) }
    }

    /// Rays through a grid of the view.
    static func rays(_ view: ViewState, _ n: Int) -> [RayD] {
        let worldFromCamera = view.cameraFromWorld.inverse
        let tanY = tan(view.fovY / 2)
        let tanX = tanY * Double(view.viewportWidth) / Double(view.viewportHeight)
        var out: [RayD] = []
        for i in 0..<n {
            for j in 0..<n {
                let u = (Double(i) + 0.5) / Double(n) * 2 - 1, v = (Double(j) + 0.5) / Double(n) * 2 - 1
                let d = worldFromCamera.applyDirection(Vec3(u * tanX * 0.95, v * tanY * 0.95, -1)).normalized
                out.append(RayD(origin: worldFromCamera.translation, direction: d))
            }
        }
        return out
    }
}

/// The inverse of a 3×3 matrix (the item transforms are similarities).
func inverse3(_ m: Mat3) -> Mat3 {
    let a = m.c0, b = m.c1, c = m.c2
    let r0 = b.cross(c), r1 = c.cross(a), r2 = a.cross(b)
    let det = a.dot(r0)
    return Mat3(rows: r0 / det, r1 / det, r2 / det)
}

/// A deterministic generator for random scenarios.
struct TestRandom {
    var g: SplitMix64
    init(_ seed: UInt64) { g = SplitMix64(seed: seed) }
    mutating func unit() -> Double { Double(g.next() >> 11) / Double(1 << 53) }
    mutating func range(_ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * unit() }
    mutating func int(_ n: Int) -> Int { Int(g.next() % UInt64(n)) }
}
