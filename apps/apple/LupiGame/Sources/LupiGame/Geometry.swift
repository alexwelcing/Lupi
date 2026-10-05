import Foundation
import LupiChem
import LupiScale

// Rotation helpers in binary64. LupiScale keeps its own quaternion products
// internal, so these carry distinct names to stay unambiguous if it opens them.

extension Quat {
    /// `a ∘ b`: rotate by b, then by a.
    public static func compose(_ a: Quat, _ b: Quat) -> Quat {
        Quat(
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
        )
    }

    /// The inverse of a unit quaternion.
    public var inverted: Quat { Quat(x: -x, y: -y, z: -z, w: w) }

    /// A rotation of `angle` radians about `axis` (need not be unit length; zero gives identity).
    public static func axisAngle(_ axis: Vec3, _ angle: Double) -> Quat {
        let n = axis.length
        guard n > 0, angle.isFinite, angle != 0 else { return .identity }
        let s = sin(angle / 2) / n
        return Quat(x: axis.x * s, y: axis.y * s, z: axis.z * s, w: cos(angle / 2))
    }

    /// The shortest rotation taking unit vector `a` to unit vector `b`.
    public static func between(_ a: Vec3, _ b: Vec3) -> Quat {
        let a = a.normalized, b = b.normalized
        let d = a.dot(b)
        if d > 1 - 1e-12 { return .identity }
        if d < -1 + 1e-12 {
            var axis = Vec3(1, 0, 0).cross(a)
            if axis.lengthSquared < 1e-12 { axis = Vec3(0, 1, 0).cross(a) }
            return axisAngle(axis, .pi)
        }
        let c = a.cross(b)
        let q = Quat(x: c.x, y: c.y, z: c.z, w: 1 + d)
        let len = (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).squareRoot()
        return Quat(x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len)
    }

    public var normalizedQuat: Quat {
        let len = (x * x + y * y + z * z + w * w).squareRoot()
        guard len > 0 else { return .identity }
        return Quat(x: x / len, y: y / len, z: z / len, w: w / len)
    }

    /// Columns are the images of the basis vectors.
    public var rotationMatrix: Mat3 { Mat3(columns: act(Vec3(1, 0, 0)), act(Vec3(0, 1, 0)), act(Vec3(0, 0, 1))) }
}

extension Mat3 {
    /// The proper rotation nearest an orthonormal frame: flips the last column of a reflection.
    var properRotation: Mat3 {
        determinant < 0 ? Mat3(columns: c0, c1, -1 * c2) : self
    }
}

/// A perspective projection's four free entries (column-major 4×4 `P`): `sx = P[0][0]`,
/// `sy = P[1][1]`, `cx = P[2][0]`, `cy = P[2][1]`. ARKit's
/// `projectionMatrix(for:viewportSize:zNear:zFar:)` has this shape.
public struct Projection: Sendable, Equatable {
    public var sx: Double
    public var sy: Double
    public var cx: Double
    public var cy: Double

    public init(sx: Double, sy: Double, cx: Double = 0, cy: Double = 0) {
        self.sx = sx
        self.sy = sy
        self.cx = cx
        self.cy = cy
    }

    /// From the matrix's columns (each column's x, y, z, w).
    public init(columns c0: SIMD4<Double>, _ c1: SIMD4<Double>, _ c2: SIMD4<Double>) {
        self.init(sx: c0.x, sy: c1.y, cx: c2.x, cy: c2.y)
    }

    /// A symmetric frustum: vertical field of view in radians, aspect = width / height.
    public static func symmetric(fovY: Double, aspect: Double) -> Projection {
        let sy = 1 / tan(fovY / 2)
        return Projection(sx: sy / aspect, sy: sy)
    }

    public var fovY: Double { 2 * atan(1 / sy) }
}

/// The camera of one frame, in world metres (ARKit: y up). The camera looks down its −z.
public struct CameraState: Sendable, Equatable {
    public var worldFromCamera: RigidD
    public var projection: Projection
    /// Viewport in points: width, height.
    public var viewportPoints: SIMD2<Double>
    public var pixelsPerPoint: Double

    public init(worldFromCamera: RigidD, projection: Projection, viewportPoints: SIMD2<Double>, pixelsPerPoint: Double) {
        self.worldFromCamera = worldFromCamera
        self.projection = projection
        self.viewportPoints = viewportPoints
        self.pixelsPerPoint = pixelsPerPoint
    }

    /// A camera at `eye` looking at `target`, y up: for tests and the simulator.
    public static func looking(
        from eye: Vec3, at target: Vec3, fovY: Double = 1.0, viewportPoints: SIMD2<Double> = SIMD2(390, 844),
        pixelsPerPoint: Double = 3
    ) -> CameraState {
        let back = (eye - target).normalized
        var up = Vec3(0, 1, 0)
        if abs(back.dot(up)) > 0.999 { up = Vec3(0, 0, 1) }
        let right = up.cross(back).normalized
        let trueUp = back.cross(right)
        let rotation = Quat(rotation: Mat3(columns: right, trueUp, back))
        return CameraState(
            worldFromCamera: RigidD(rotation: rotation, translation: eye),
            projection: .symmetric(fovY: fovY, aspect: viewportPoints.x / viewportPoints.y),
            viewportPoints: viewportPoints, pixelsPerPoint: pixelsPerPoint
        )
    }

    public var position: Vec3 { worldFromCamera.translation }
    public var forward: Vec3 { worldFromCamera.applyDirection(Vec3(0, 0, -1)) }
    public var right: Vec3 { worldFromCamera.applyDirection(Vec3(1, 0, 0)) }
    public var up: Vec3 { worldFromCamera.applyDirection(Vec3(0, 1, 0)) }

    /// The world ray through a point of the view (points, y down), with a unit direction.
    public func ray(through point: SIMD2<Double>) -> RayD {
        let w = max(viewportPoints.x, 1), h = max(viewportPoints.y, 1)
        let nx = 2 * point.x / w - 1
        let ny = 1 - 2 * point.y / h
        let local = Vec3((nx + projection.cx) / projection.sx, (ny + projection.cy) / projection.sy, -1)
        return RayD(origin: position, direction: worldFromCamera.applyDirection(local).normalized)
    }

    /// The view point (points, y down) of a world point, or nil behind the camera.
    public func project(_ world: Vec3) -> SIMD2<Double>? {
        let c = worldFromCamera.inverse.apply(world)
        guard c.z < -1e-9 else { return nil }
        let nx = projection.sx * c.x / -c.z - projection.cx
        let ny = projection.sy * c.y / -c.z - projection.cy
        return SIMD2((nx + 1) / 2 * viewportPoints.x, (1 - ny) / 2 * viewportPoints.y)
    }

    /// Displayed size in pixels of a length `metres` at distance `distance`.
    public func pixels(_ metres: Double, at distance: Double) -> Double {
        let ppr = viewportPoints.y * pixelsPerPoint * projection.sy / 2
        return metres * ppr / max(distance, 1e-6)
    }

    /// What the cut needs (scale-spec §9.1).
    public var viewState: ViewState {
        ViewState(
            cameraFromWorld: worldFromCamera.inverse, fovY: projection.fovY,
            viewportHeight: max(1, Int((viewportPoints.y * pixelsPerPoint).rounded())),
            viewportWidth: max(1, Int((viewportPoints.x * pixelsPerPoint).rounded()))
        )
    }
}

extension RigidD {
    /// Rotates this pose about the world point `p` by `q`.
    func rotated(by q: Quat, about p: Vec3) -> RigidD {
        RigidD(rotation: Quat.compose(q, rotation).normalizedQuat, translation: p + q.act(translation - p))
    }
}

/// Smoothstep on [0, 1].
@inline(__always) func smoothstep(_ u: Double) -> Double {
    let t = min(1, max(0, u))
    return t * t * (3 - 2 * t)
}
