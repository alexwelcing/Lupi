/// Eigen-decomposition of a symmetric 3×3 matrix by cyclic Jacobi rotations,
/// ported from packages/core/src/objectFacts/jacobi.ts so the app's principal
/// axes are the viewer's.
public enum SymmetricEigen {
    /// Eigenvalues ascending, with unit eigenvectors forming a right-handed frame (det +1).
    public static func solve(_ m: Mat3) -> (values: Vec3, vectors: [Vec3]) {
        var a = [
            [m[0, 0], m[0, 1], m[0, 2]],
            [m[0, 1], m[1, 1], m[1, 2]],
            [m[0, 2], m[1, 2], m[2, 2]],
        ]
        var v: [[Double]] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
        let scale = abs(a[0][0]) + abs(a[1][1]) + abs(a[2][2]) + 1e-300
        let pairs = [(0, 1), (0, 2), (1, 2)]
        for _ in 0..<64 {
            let off = abs(a[0][1]) + abs(a[0][2]) + abs(a[1][2])
            if off <= 1e-15 * scale { break }
            for (p, q) in pairs {
                let apq = a[p][q]
                if abs(apq) <= 1e-300 { continue }
                let theta = (a[q][q] - a[p][p]) / (2 * apq)
                let t = (theta >= 0 ? 1.0 : -1.0) / (abs(theta) + (theta * theta + 1).squareRoot())
                let c = 1 / (t * t + 1).squareRoot()
                let s = t * c
                for k in 0..<3 {
                    let akp = a[k][p], akq = a[k][q]
                    a[k][p] = c * akp - s * akq
                    a[k][q] = s * akp + c * akq
                }
                for k in 0..<3 {
                    let apk = a[p][k], aqk = a[q][k]
                    a[p][k] = c * apk - s * aqk
                    a[q][k] = s * apk + c * aqk
                }
                a[p][q] = 0
                a[q][p] = 0
                for k in 0..<3 {
                    let vkp = v[k][p], vkq = v[k][q]
                    v[k][p] = c * vkp - s * vkq
                    v[k][q] = s * vkp + c * vkq
                }
            }
        }
        let order = [0, 1, 2].sorted { a[$0][$0] < a[$1][$1] }
        let values = Vec3(a[order[0]][order[0]], a[order[1]][order[1]], a[order[2]][order[2]])
        var vectors = order.map { Vec3(v[0][$0], v[1][$0], v[2][$0]).normalized }
        if vectors[0].dot(vectors[1].cross(vectors[2])) < 0 { vectors[2] = -vectors[2] }
        return (values, vectors)
    }
}

/// How a rigid body spins, from its principal moments (the web's rotor classes).
public enum RotorType: String, Sendable, Codable {
    case atom, linear, spherical, oblate, prolate, asymmetric
}

/// Point-mass rigid-body facts about the centre of mass, in amu and Å, as the
/// web's `computeInertia` (packages/core/src/objectFacts/inertia.ts).
public struct InertiaFacts: Sendable, Equatable {
    /// Total mass, amu (g/mol). Unresolved elements weigh 12, like carbon.
    public var mass: Double
    public var centerOfMass: Vec3
    /// Principal moments, ascending, amu·Å².
    public var moments: Vec3
    /// Unit principal axes for `moments`, right-handed.
    public var axes: [Vec3]
    /// Body (x, y, z) = principal (a, b, c) → molecule frame.
    public var principalRotation: Quat
    public var rotor: RotorType
    /// Ray's asymmetry κ: −1 prolate … +1 oblate.
    public var kappa: Double
    /// sqrt(Σ m r² / M) about the centre of mass, Å.
    public var radiusOfGyration: Double
    /// Atoms whose element had no mass.
    public var unresolvedElements: Int
}

extension Molecule {
    /// Mass used for an atomic number the element table does not resolve (carbon-like), as the web.
    public static let unresolvedMass = 12.0

    public var inertia: InertiaFacts {
        let momentGap = 0.01
        let linearRatio = 1e-3
        var unresolved = 0
        var masses = [Double](repeating: 0, count: count)
        var total = 0.0
        var weighted = Vec3.zero
        for a in 0..<count {
            var m = ChemicalElement.forAtomicNumber(atomicNumbers[a]).mass
            if !(m > 0) {
                m = Self.unresolvedMass
                unresolved += 1
            }
            masses[a] = m
            total += m
            weighted += m * position(a)
        }
        guard total > 0 else {
            return InertiaFacts(
                mass: 0, centerOfMass: .zero, moments: .zero, axes: [Vec3(1, 0, 0), Vec3(0, 1, 0), Vec3(0, 0, 1)],
                principalRotation: .identity, rotor: .atom, kappa: 0, radiusOfGyration: 0, unresolvedElements: 0
            )
        }
        let com = weighted / total
        var ixx = 0.0, iyy = 0.0, izz = 0.0, ixy = 0.0, ixz = 0.0, iyz = 0.0, mr2 = 0.0
        for a in 0..<count {
            let d = position(a) - com
            let m = masses[a]
            ixx += m * (d.y * d.y + d.z * d.z)
            iyy += m * (d.x * d.x + d.z * d.z)
            izz += m * (d.x * d.x + d.y * d.y)
            ixy -= m * d.x * d.y
            ixz -= m * d.x * d.z
            iyz -= m * d.y * d.z
            mr2 += m * d.lengthSquared
        }
        let tensor = Mat3(rows: Vec3(ixx, ixy, ixz), Vec3(ixy, iyy, iyz), Vec3(ixz, iyz, izz))
        let (values, axes) = SymmetricEigen.solve(tensor)
        // Round-off can leave a tiny negative moment for a line or a point.
        let moments = Vec3(max(0, values.x), max(0, values.y), max(0, values.z))
        let (ia, ib, ic) = (moments.x, moments.y, moments.z)
        func near(_ lo: Double, _ hi: Double) -> Bool { hi - lo <= momentGap * hi }
        let rotor: RotorType
        if count == 1 || ic <= 1e-9 { rotor = .atom }
        else if ia < linearRatio * ic { rotor = .linear }
        else if near(ia, ib) && near(ib, ic) { rotor = .spherical }
        else if near(ia, ib) { rotor = .oblate }
        else if near(ib, ic) { rotor = .prolate }
        else { rotor = .asymmetric }

        var kappa = 0.0
        switch rotor {
        case .atom, .spherical:
            kappa = 0
        case .linear:
            kappa = -1
        default:
            if ia <= 0 {
                kappa = -1
            } else {
                let A = 1 / ia, B = 1 / ib, C = 1 / ic
                let span = A - C
                kappa = span > 1e-12 * A ? max(-1, min(1, (2 * B - A - C) / span)) : 0
            }
        }
        return InertiaFacts(
            mass: total, centerOfMass: com, moments: moments, axes: axes,
            principalRotation: Quat(rotation: Mat3(columns: axes[0], axes[1], axes[2])),
            rotor: rotor, kappa: kappa, radiusOfGyration: (mr2 / total).squareRoot(), unresolvedElements: unresolved
        )
    }
}
