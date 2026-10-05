import Foundation
import LupiChem
import LupiScale
import RealityKit
import simd
import UIKit

// LupiKit and LupiScale compute in binary64 on standard-library SIMD types;
// RealityKit takes Float32 and simd. Every cast happens here, once.

extension SIMD3 where Scalar == Double {
    var asFloat: SIMD3<Float> { SIMD3<Float>(Float(x), Float(y), Float(z)) }
}

extension SIMD3 where Scalar == Float {
    var asDouble: SIMD3<Double> { SIMD3<Double>(Double(x), Double(y), Double(z)) }
}

extension Quat {
    var simd: simd_quatf { simd_quatf(ix: Float(x), iy: Float(y), iz: Float(z), r: Float(w)) }

    init(_ q: simd_quatf) {
        self.init(x: Double(q.imag.x), y: Double(q.imag.y), z: Double(q.imag.z), w: Double(q.real))
    }
}

extension RigidD {
    /// A RealityKit transform at unit scale.
    var transform: Transform {
        Transform(scale: SIMD3<Float>(repeating: 1), rotation: rotation.simd, translation: translation.asFloat)
    }

    init(_ t: Transform) {
        self.init(rotation: Quat(t.rotation), translation: t.translation.asDouble)
    }

    /// The rigid part of an ARKit anchor transform (anchors carry no scale).
    init(_ m: simd_float4x4) {
        let c = { (v: SIMD4<Float>) in Vec3(Double(v.x), Double(v.y), Double(v.z)) }
        self.init(rotation: Quat(rotation: Mat3(columns: c(m.columns.0), c(m.columns.1), c(m.columns.2))), translation: c(m.columns.3))
    }
}

extension Transform3x4 {
    /// The 4×4 of an affine Float32 transform (scale and rotation in its columns).
    var matrix: float4x4 {
        float4x4(
            SIMD4<Float>(c0, 0), SIMD4<Float>(c1, 0), SIMD4<Float>(c2, 0), SIMD4<Float>(translation, 1)
        )
    }

    /// This transform after a uniform scale `s` about `p`: an instance at `p` of radius `s`.
    func instance(at p: SIMD3<Float>, scale s: SIMD3<Float>) -> float4x4 {
        float4x4(
            SIMD4<Float>(c0 * s.x, 0), SIMD4<Float>(c1 * s.y, 0), SIMD4<Float>(c2 * s.z, 0), SIMD4<Float>(apply(p), 1)
        )
    }
}

extension SIMD3 where Scalar == Float {
    /// sRGB 0…1 as a UIColor.
    var uiColor: UIColor { UIColor(red: CGFloat(x), green: CGFloat(y), blue: CGFloat(z), alpha: 1) }
}
