// Stand-in for Apple's simd module: only what the app uses, with Apple's spellings.
public struct simd_quatf: Sendable {
    public var vector: SIMD4<Float>
    public init(ix: Float, iy: Float, iz: Float, r: Float) { vector = SIMD4(ix, iy, iz, r) }
    public init(angle: Float, axis: SIMD3<Float>) { vector = SIMD4(axis, angle) }
    public init(from: SIMD3<Float>, to: SIMD3<Float>) { vector = SIMD4(from, 0) }
    public var imag: SIMD3<Float> { SIMD3(vector.x, vector.y, vector.z) }
    public var real: Float { vector.w }
    public var inverse: simd_quatf { self }
}
public struct simd_float4x4: Sendable {
    public var columns: (SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>)
    public init(_ c0: SIMD4<Float>, _ c1: SIMD4<Float>, _ c2: SIMD4<Float>, _ c3: SIMD4<Float>) { columns = (c0, c1, c2, c3) }
    public init(diagonal: SIMD4<Float>) { columns = (diagonal, diagonal, diagonal, diagonal) }
    public init(_ q: simd_quatf) { columns = (q.vector, q.vector, q.vector, q.vector) }
    public var inverse: simd_float4x4 { self }
    public static func * (a: simd_float4x4, b: simd_float4x4) -> simd_float4x4 { a }
}
public typealias float4x4 = simd_float4x4
public func simd_length(_ v: SIMD4<Float>) -> Float { 0 }
public func simd_length(_ v: SIMD3<Float>) -> Float { 0 }
public func simd_min(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> SIMD3<Float> { a }
public func simd_max(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> SIMD3<Float> { a }
public func simd_normalize(_ a: SIMD3<Float>) -> SIMD3<Float> { a }
public typealias simd_float3 = SIMD3<Float>
extension simd_quatf {
    public static func * (a: simd_quatf, b: simd_quatf) -> simd_quatf { a }
    public func act(_ v: SIMD3<Float>) -> SIMD3<Float> { v }
    public var angle: Float { 0 }
    public var axis: SIMD3<Float> { .zero }
}
