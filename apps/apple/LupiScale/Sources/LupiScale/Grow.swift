import Foundation
import LupiScaleCore

/// Grow ×2 (§10.7, proposed; the owner to confirm): a materializable piece becomes the seed of a
/// factor-2 tower of one level, and the root of a factor-2 tower gains a level.
public func grow(_ body: BodyFrame, resolver: Resolver) throws -> NodeRecord {
    try growRecords(body, resolver: resolver).tower
}

/// The grown tower and, for a first tap, the seed leaf it names (embed both in the new reference).
public func growRecords(_ body: BodyFrame, resolver: Resolver) throws -> (tower: NodeRecord, seed: NodeRecord?) {
    let r = resolver
    let view = try r.resolve(body.ref.root, body.ref.path)
    if body.ref.path.isEmpty, case let .tower(t)? = try r.record(body.ref.root).node, t.factor == 2 {
        var next = t
        next.levels = t.levels + 1
        return (try NodeRecord(.tower(next)), nil)
    }
    guard r.isMaterializable(view) else {
        throw ScaleError(.path, "only a materializable piece or the root of a factor-2 tower grows")
    }
    let seed = try NodeRecord(.leaf(r.materialize(view)))
    guard case let .leaf(leaf)? = seed.node else { throw ScaleError(.path, "not a leaf") }
    let periods = GrowRule.periods(leaf)
    do {
        let tower = try NodeRecord(.tower(TowerNode(seed: seed.id, factor: 2, periodsQ16: periods, levels: 1)))
        return (tower, seed)
    } catch let e as ScaleError where e.code == .limit || e.code == .range {
        throw ScaleError(.limit, "this piece is too long and flat to grow")
    }
}

/// The integer period rule of §10.7 [B]: on the diagonal, `qmax − qmin + 150,733` Q16 per axis,
/// with `qmax` the largest `⌈x × 65536⌉` and `qmin` the smallest `⌊x × 65536⌋`. Scaling a Float32
/// by 2¹⁶ is exact, so both are exact.
public enum GrowRule {
    public static let gapQ16: Int64 = 150_733

    public static func periods(_ leaf: LeafNode) -> [SIMD3<Int64>] {
        var out: [SIMD3<Int64>] = []
        for a in 0..<3 {
            var hi = Int64.min, lo = Int64.max
            for p in leaf.positions {
                let q = Double(p[a]) * 65536
                hi = max(hi, Int64(q.rounded(.up)))
                lo = min(lo, Int64(q.rounded(.down)))
            }
            var v = SIMD3<Int64>(0, 0, 0)
            v[a] = hi - lo + gapQ16
            out.append(v)
        }
        return out
    }

    /// The metres per unit that keep a grown body's longest displayed span (§10.7).
    public static func spanHoldingScale(old: Aggregate, oldScale: Double, new: Aggregate) -> Double {
        oldScale * old.bounds.longest / new.bounds.longest
    }
}
