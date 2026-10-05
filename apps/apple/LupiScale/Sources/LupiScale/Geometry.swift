import Foundation
import LupiChem

/// A rigid transform in binary64: rotation then translation (metres in world space, §8.1).
public struct RigidD: Sendable, Hashable {
    /// Unit quaternion (x, y, z, w), w the scalar part.
    public var rotation: Quat
    public var translation: Vec3

    public init(rotation: Quat = .identity, translation: Vec3 = .zero) {
        self.rotation = rotation
        self.translation = translation
    }

    public static let identity = RigidD()

    public func apply(_ p: Vec3) -> Vec3 { rotation.act(p) + translation }

    public func applyDirection(_ v: Vec3) -> Vec3 { rotation.act(v) }

    public var inverse: RigidD {
        let inv = rotation.conjugate
        return RigidD(rotation: inv, translation: -inv.act(translation))
    }

    /// `a ∘ b`: apply b, then a.
    public static func * (a: RigidD, b: RigidD) -> RigidD {
        RigidD(rotation: a.rotation.multiplied(by: b.rotation), translation: a.apply(b.translation))
    }

    public var matrix: Mat3 { rotation.matrix }
}

/// A ray in world space; `direction` need not be unit length.
public struct RayD: Sendable, Hashable {
    public var origin: Vec3
    public var direction: Vec3

    public init(origin: Vec3, direction: Vec3) {
        self.origin = origin
        self.direction = direction
    }

    public func at(_ t: Double) -> Vec3 { origin + t * direction }
}

/// A Float32 affine transform: three linear columns and a translation, cast once from binary64 (§8.5).
public struct Transform3x4: Sendable, Hashable {
    public var c0: SIMD3<Float>
    public var c1: SIMD3<Float>
    public var c2: SIMD3<Float>
    public var translation: SIMD3<Float>

    public init(c0: SIMD3<Float>, c1: SIMD3<Float>, c2: SIMD3<Float>, translation: SIMD3<Float>) {
        self.c0 = c0
        self.c1 = c1
        self.c2 = c2
        self.translation = translation
    }

    /// The one cast of a binary64 linear map and translation.
    init(_ m: Mat3, _ t: Vec3) {
        c0 = SIMD3(Float(m.c0.x), Float(m.c0.y), Float(m.c0.z))
        c1 = SIMD3(Float(m.c1.x), Float(m.c1.y), Float(m.c1.z))
        c2 = SIMD3(Float(m.c2.x), Float(m.c2.y), Float(m.c2.z))
        translation = SIMD3(Float(t.x), Float(t.y), Float(t.z))
    }

    public func apply(_ p: SIMD3<Float>) -> SIMD3<Float> { c0 * p.x + c1 * p.y + c2 * p.z + translation }
}

/// An axis-aligned box in binary64.
public struct Box3: Sendable, Hashable {
    public var min: Vec3
    public var max: Vec3

    public init(min: Vec3, max: Vec3) {
        self.min = min
        self.max = max
    }

    public static let empty = Box3(min: Vec3(repeating: .infinity), max: Vec3(repeating: -.infinity))

    public var isEmpty: Bool { min.x > max.x || min.y > max.y || min.z > max.z }
    public var centre: Vec3 { 0.5 * (min + max) }
    public var size: Vec3 { max - min }
    public var halfExtents: Vec3 { 0.5 * (max - min) }
    public var radius: Double { 0.5 * (max - min).length }
    public var shortest: Double { Swift.min(size.x, Swift.min(size.y, size.z)) }
    public var longest: Double { Swift.max(size.x, Swift.max(size.y, size.z)) }

    public func union(_ b: Box3) -> Box3 {
        Box3(min: simdMin(min, b.min), max: simdMax(max, b.max))
    }

    public func expanded(by r: Double) -> Box3 { Box3(min: min - Vec3(repeating: r), max: max + Vec3(repeating: r)) }

    public func contains(_ p: Vec3, tolerance: Double = 0) -> Bool {
        p.x >= min.x - tolerance && p.y >= min.y - tolerance && p.z >= min.z - tolerance
            && p.x <= max.x + tolerance && p.y <= max.y + tolerance && p.z <= max.z + tolerance
    }

    /// The box of the image of this box under `x ↦ s · M · x + t`.
    public func transformed(scale s: Double, rotation m: Mat3, translation t: Vec3) -> Box3 {
        let c = s * (m * centre) + t
        let h = halfExtents * s
        // |M| applied to the half extents.
        let e = Vec3(
            abs(m[0, 0]) * h.x + abs(m[0, 1]) * h.y + abs(m[0, 2]) * h.z,
            abs(m[1, 0]) * h.x + abs(m[1, 1]) * h.y + abs(m[1, 2]) * h.z,
            abs(m[2, 0]) * h.x + abs(m[2, 1]) * h.y + abs(m[2, 2]) * h.z
        )
        return Box3(min: c - e, max: c + e)
    }

    /// Distance from a point to the box (0 inside).
    public func distance(to p: Vec3) -> Double {
        let d = simdMax(simdMax(min - p, p - max), .zero)
        return d.length
    }

    /// The ray's entry parameter, or nil when it misses (slab test).
    public func intersect(_ ray: RayD) -> (near: Double, far: Double)? {
        var t0 = -Double.infinity, t1 = Double.infinity
        for a in 0..<3 {
            let o = ray.origin[a], d = ray.direction[a]
            if abs(d) < 1e-300 {
                if o < min[a] || o > max[a] { return nil }
                continue
            }
            var near = (min[a] - o) / d, far = (max[a] - o) / d
            if near > far { swap(&near, &far) }
            t0 = Swift.max(t0, near)
            t1 = Swift.min(t1, far)
            if t0 > t1 { return nil }
        }
        return (t0, t1)
    }
}

@inline(__always) func simdMin(_ a: Vec3, _ b: Vec3) -> Vec3 { Vec3(min(a.x, b.x), min(a.y, b.y), min(a.z, b.z)) }
@inline(__always) func simdMax(_ a: Vec3, _ b: Vec3) -> Vec3 { Vec3(max(a.x, b.x), max(a.y, b.y), max(a.z, b.z)) }

extension Quat {
    var conjugate: Quat { Quat(x: -x, y: -y, z: -z, w: w) }

    func multiplied(by b: Quat) -> Quat {
        Quat(
            x: w * b.x + x * b.w + y * b.z - z * b.y,
            y: w * b.y - x * b.z + y * b.w + z * b.x,
            z: w * b.z + x * b.y - y * b.x + z * b.w,
            w: w * b.w - x * b.x - y * b.y - z * b.z
        )
    }

    var matrix: Mat3 {
        Mat3(columns: act(Vec3(1, 0, 0)), act(Vec3(0, 1, 0)), act(Vec3(0, 0, 1)))
    }

    init(_ q: SIMD4<Double>) { self.init(x: q.x, y: q.y, z: q.z, w: q.w) }
}

extension Mat3 {
    static func * (s: Double, m: Mat3) -> Mat3 { Mat3(columns: s * m.c0, s * m.c1, s * m.c2) }
    var isIdentity: Bool { self == Mat3.identity }
}
