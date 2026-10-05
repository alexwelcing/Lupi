import Foundation
import LupiChem
import LupiScaleCore

/// The bands of §10.5: displayed diameters, metres.
public enum Bands {
    /// What a chunk or a grab can take: 4 to 40 cm.
    public static let hand: ClosedRange<Double> = 0.04...0.40
    /// What a chip takes: 1 to 5 cm.
    public static let chip: ClosedRange<Double> = 0.01...0.05
    /// Any node: plain picking (a tap or a toy's grab).
    public static let any: ClosedRange<Double> = 0...Double.infinity
}

/// A touch's hit (§10.5).
public struct PickResult: Sendable {
    public var body: Int
    /// The index of the hit item in the cut.
    public var item: Int
    /// The picked node's steps below the body's node (append to the body's ref path).
    public var steps: [Step]
    public var pointWorld: SIMD3<Double>
    /// Along the ray, in units of its direction's length.
    public var distance: Double
    /// The picked node's displayed bounding diameter, metres.
    public var displayedDiameter: Double
    /// The element of the atom hit, when the hit item drew atoms.
    public var atomicNumber: UInt8?
}

/// Tests a touch ray against the cut's items, then refines along the hit only as far as the band
/// asks: the deepest node on the hit chain whose displayed diameter is in `band` (§4.8, §10.5).
/// Nil when nothing is hit, or when no node on the chain falls in the band.
public func pick(ray: RayD, cut: Cut, band: ClosedRange<Double>, resolver: Resolver) -> PickResult? {
    var best: (item: Int, t: Double, local: Vec3, z: UInt8?)?
    for (i, item) in cut.items.enumerated() where item.kind != .facePlane {
        guard let hit = Picking.hit(ray, item, cut) else { continue }
        if best == nil || hit.t < best!.t { best = (i, hit.t, hit.local, hit.z) }
    }
    guard let hit = best else { return nil }
    let item = cut.items[hit.item]
    guard let steps = cut.path(of: item), item.body < cut.bodies.count else { return nil }
    let frame = cut.bodies[item.body]
    do {
        let bodyView = try resolver.resolve(frame.ref.root, frame.ref.path)
        var view = try resolver.walk(bodyView, steps)
        var path = steps
        let agg = try resolver.aggregate(view)
        // Item-local is the node's frame about c(X); the transform's column length is σ_X.
        var x = hit.local + agg.centre
        var sigma = Double(simdLength(item.transform.c0))
        var diameter = 2 * agg.radius * sigma
        var chosen: (path: [Step], diameter: Double)? = band.contains(diameter) ? (path, diameter) : nil
        var guardSteps = 0
        while guardSteps < 4096 {
            guardSteps += 1
            guard let s = try PointToChild.child(of: view, containing: x, resolver: resolver) else { break }
            let p = try resolver.placement(from: view.withoutRemovals, step: s)
            let child = try resolver.step(view, s)
            let childSigma = sigma * p.scale
            let childDiameter = 2 * (try resolver.aggregate(child)).radius * childSigma
            if childDiameter < band.lowerBound { break }
            x = p.inverse.apply(x)
            view = child
            sigma = childSigma
            path.append(s)
            diameter = childDiameter
            if band.contains(diameter) { chosen = (path, diameter) }
        }
        guard let pick = chosen else { return nil }
        return PickResult(
            body: item.body, item: hit.item, steps: pick.path, pointWorld: ray.at(hit.t), distance: hit.t,
            displayedDiameter: pick.diameter, atomicNumber: hit.z
        )
    } catch {
        return nil
    }
}

func simdLength(_ v: SIMD3<Float>) -> Float { (v * v).sum().squareRoot() }

enum Picking {
    /// The item's world transform: the body entity's pose (or the camera frame entity's) after the item's.
    static func world(_ item: DrawItem, _ cut: Cut) -> (Mat3, Vec3) {
        let m = Mat3(
            columns: Vec3(Double(item.transform.c0.x), Double(item.transform.c0.y), Double(item.transform.c0.z)),
            Vec3(Double(item.transform.c1.x), Double(item.transform.c1.y), Double(item.transform.c1.z)),
            Vec3(Double(item.transform.c2.x), Double(item.transform.c2.y), Double(item.transform.c2.z))
        )
        let t = Vec3(Double(item.transform.translation.x), Double(item.transform.translation.y), Double(item.transform.translation.z))
        switch item.parent {
        case .cameraFrame:
            return (m, t + cut.cameraFrameOrigin)
        case let .body(b):
            let e = cut.bodyEntities[b]
            let r = e.matrix
            return (r * m, e.apply(t))
        }
    }

    /// The nearest hit of a ray on an item's own shapes, in item-local coordinates.
    static func hit(_ ray: RayD, _ item: DrawItem, _ cut: Cut) -> (t: Double, local: Vec3, z: UInt8?)? {
        let (m, t) = world(item, cut)
        let inv = m.inverse
        let o = inv * (ray.origin - t)
        let d = inv * ray.direction
        let localRay = RayD(origin: o, direction: d)
        switch item.extras {
        case .box:
            let h = Vec3(Double(item.halfExtents.x), Double(item.halfExtents.y), Double(item.halfExtents.z))
            guard let (near, far) = Box3(min: -h, max: h).intersect(localRay), far >= 0 else { return nil }
            let tt = max(near, 0)
            return (tt, localRay.at(tt), nil)
        case let .atoms(runs):
            var best: (Double, Vec3, UInt8)?
            for run in runs {
                let r = Double(run.radius)
                for p in run.positions {
                    let c = Vec3(Double(p.x), Double(p.y), Double(p.z))
                    if let tt = sphere(localRay, c, r), best == nil || tt < best!.0 { best = (tt, localRay.at(tt), run.atomicNumber) }
                }
            }
            return best.map { ($0.0, $0.1, $0.2) }
        case let .splats(spheres, _):
            var best: (Double, Vec3)?
            for s in spheres {
                if let tt = sphere(localRay, Vec3(Double(s.x), Double(s.y), Double(s.z)), Double(s.w)), best == nil || tt < best!.0 {
                    best = (tt, localRay.at(tt))
                }
            }
            return best.map { ($0.0, $0.1, nil) }
        case .plane:
            return nil
        }
    }

    static func sphere(_ ray: RayD, _ c: Vec3, _ r: Double) -> Double? {
        let oc = ray.origin - c
        let a = ray.direction.dot(ray.direction)
        let b = oc.dot(ray.direction)
        let cc = oc.dot(oc) - r * r
        let disc = b * b - a * cc
        guard disc >= 0, a > 0 else { return nil }
        let s = disc.squareRoot()
        let t0 = (-b - s) / a, t1 = (-b + s) / a
        if t1 < 0 { return nil }
        return max(t0, 0)
    }
}
