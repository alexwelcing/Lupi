import Foundation

// Small vector maths on the standard library's SIMD types, so LupiKit needs
// no `simd` module and builds on Linux. SIMD3<Double> is the working type;
// coordinates are stored as SIMD3<Float>, as the web stores Float32Array, and
// widen with the standard library's converting init, Vec3(floatVector).

public typealias Vec3 = SIMD3<Double>

extension SIMD3 where Scalar == Double {
    @inlinable public func dot(_ other: Self) -> Double { x * other.x + y * other.y + z * other.z }

    @inlinable public func cross(_ other: Self) -> Self {
        Self(y * other.z - z * other.y, z * other.x - x * other.z, x * other.y - y * other.x)
    }

    @inlinable public var lengthSquared: Double { dot(self) }
    @inlinable public var length: Double { lengthSquared.squareRoot() }

    /// The unit vector, or self when the length is zero.
    @inlinable public var normalized: Self {
        let len = length
        return len > 0 ? self / len : self
    }
}

/// A 3×3 matrix stored as three columns.
public struct Mat3: Sendable, Hashable, Codable {
    public var c0: Vec3
    public var c1: Vec3
    public var c2: Vec3

    public init(columns c0: Vec3, _ c1: Vec3, _ c2: Vec3) {
        self.c0 = c0
        self.c1 = c1
        self.c2 = c2
    }

    /// Row-major entries, as one writes a matrix on paper.
    public init(rows r0: Vec3, _ r1: Vec3, _ r2: Vec3) {
        self.init(columns: Vec3(r0.x, r1.x, r2.x), Vec3(r0.y, r1.y, r2.y), Vec3(r0.z, r1.z, r2.z))
    }

    public static let identity = Mat3(columns: Vec3(1, 0, 0), Vec3(0, 1, 0), Vec3(0, 0, 1))
    public static let zero = Mat3(columns: .zero, .zero, .zero)

    /// Entry at (row, column), both 0...2.
    public subscript(row: Int, column: Int) -> Double {
        get { self.column(column)[row] }
        set {
            switch column {
            case 0: c0[row] = newValue
            case 1: c1[row] = newValue
            default: c2[row] = newValue
            }
        }
    }

    public func column(_ index: Int) -> Vec3 {
        switch index {
        case 0: c0
        case 1: c1
        default: c2
        }
    }

    public var transposed: Mat3 { Mat3(rows: c0, c1, c2) }

    public var determinant: Double { c0.dot(c1.cross(c2)) }

    public static func * (m: Mat3, v: Vec3) -> Vec3 { m.c0 * v.x + m.c1 * v.y + m.c2 * v.z }

    public static func * (a: Mat3, b: Mat3) -> Mat3 { Mat3(columns: a * b.c0, a * b.c1, a * b.c2) }
}

/// A rotation quaternion (x, y, z, w), w the scalar part.
public struct Quat: Sendable, Hashable, Codable {
    public var x: Double
    public var y: Double
    public var z: Double
    public var w: Double

    public init(x: Double, y: Double, z: Double, w: Double) {
        self.x = x
        self.y = y
        self.z = z
        self.w = w
    }

    public static let identity = Quat(x: 0, y: 0, z: 0, w: 1)

    /// The rotation of a proper rotation matrix (det +1), as gl-matrix's
    /// `quat.fromMat3`, normalized.
    public init(rotation m: Mat3) {
        let trace = m[0, 0] + m[1, 1] + m[2, 2]
        var q: [Double] = [0, 0, 0, 1]
        if trace > 0 {
            var root = (trace + 1).squareRoot()
            q[3] = 0.5 * root
            root = 0.5 / root
            q[0] = (m[2, 1] - m[1, 2]) * root
            q[1] = (m[0, 2] - m[2, 0]) * root
            q[2] = (m[1, 0] - m[0, 1]) * root
        } else {
            var i = 0
            if m[1, 1] > m[0, 0] { i = 1 }
            if m[2, 2] > m[i, i] { i = 2 }
            let j = (i + 1) % 3
            let k = (i + 2) % 3
            var root = (m[i, i] - m[j, j] - m[k, k] + 1).squareRoot()
            q[i] = 0.5 * root
            root = 0.5 / root
            q[3] = (m[k, j] - m[j, k]) * root
            q[j] = (m[j, i] + m[i, j]) * root
            q[k] = (m[k, i] + m[i, k]) * root
        }
        let len = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).squareRoot()
        self.init(x: q[0] / len, y: q[1] / len, z: q[2] / len, w: q[3] / len)
    }

    /// Rotates `v` by this (unit) quaternion.
    public func act(_ v: Vec3) -> Vec3 {
        let u = Vec3(x, y, z)
        let t = 2 * u.cross(v)
        return v + w * t + u.cross(t)
    }
}
