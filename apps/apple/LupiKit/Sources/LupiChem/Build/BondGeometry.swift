import Foundation

/// Where an atom's next partner goes (plan §4.5): along a free direction of an
/// ideal geometry for the atom's electron domains (VSEPR: partners plus lone
/// pairs, so water's oxygen is tetrahedral and bent, not linear), never
/// closer than the recipe's 45° to an existing bond.
public enum BondGeometry {
    /// The molecular recipe drops the longer of two bonds closer than 45° (`acuteAngle`).
    public static let minimumAngle = BondConstants.acuteAngleDegrees * .pi / 180
    /// Fallback directions keep this much clear of existing bonds, well past the recipe's 45°.
    public static let fallbackClearance = 60.0 * .pi / 180
    /// Samples around a cone of free directions (one partner placed, one free azimuth).
    public static let coneSamples = 24

    static let tetrahedral = acos(-1.0 / 3.0)
    static let trigonal = 2.0 * .pi / 3.0

    /// Valence electrons of a main-group element; nil for transition metals and f-block.
    public static func valenceElectrons(_ z: Int) -> Int? {
        switch z {
        case 1: 1
        case 2: 2
        case 3...10: z - 2
        case 11...18: z - 10
        case 19...20: z - 18
        case 31...36: z - 28
        case 37...38: z - 36
        case 49...54: z - 46
        case 55...56: z - 54
        case 81...86: z - 78
        case 87...88: z - 86
        case 113...118: z - 110
        default: nil
        }
    }

    /// Electron domains around an atom once it holds its next partner, a link of `kind`:
    /// the σ partners it ends with (its links now, the single bonds its valence still
    /// takes, and a dative link) and the lone pairs left after the dative links use
    /// theirs. Metals are octahedral; ions take octahedral sites for their first six
    /// contacts, then any clear direction. 0 means no ideal shape applies.
    public static func domains(_ state: AtomBondState, adding kind: BondKind = .covalent) -> Int {
        let dative = state.coordinationCount + state.contactCount
        let links = state.covalentPartners.count + dative
        switch ElementClass(z: state.z) {
        case .inert:
            return 0
        case .metal, .ion:
            return links < 6 ? 6 : 0
        case .hydrogen, .covalent:
            let used = state.usedValence
            let fill = used + state.freeValence
            let adding = kind == .covalent ? 0 : 1
            let sigma = state.covalentPartners.count + max(kind == .covalent ? 1 : 0, fill - used) + dative + adding
            let pairs = valenceElectrons(state.z).map { max(0, $0 - fill) / 2 } ?? 0
            let total = sigma + max(0, pairs - dative - adding)
            return total <= 6 ? total : 0
        }
    }

    /// Every direction the next partner may take, nearest `toward` first. `existing` are the
    /// unit vectors to the atom's partners; `toward` is where the partner is now (it may be
    /// zero). Empty when nothing is clear.
    public static func slots(existing: [Vec3], domains: Int, toward: Vec3) -> [Vec3] {
        let e = existing.map(\.normalized).filter { $0.lengthSquared > 0.5 }
        let t = toward.lengthSquared > 1e-18 ? toward.normalized : Vec3.zero
        var raw: [Vec3]
        switch (domains, e.count) {
        case (_, 0):
            raw = t == .zero ? lattice : [t] + lattice
        case (2, 1):
            raw = [-1 * e[0]]
        case (3, 1):
            raw = cone(e[0], angle: trigonal, toward: t)
        case (3, 2):
            raw = bisectorOpposite(e[0], e[1]).map { [$0] } ?? perpendicularRing(e[0], toward: t)
        case (4, 1):
            raw = cone(e[0], angle: tetrahedral, toward: t)
        case (4, 2):
            raw = tetrahedralPair(e[0], e[1])
        case (4, 3):
            let s = -1 * (e[0] + e[1] + e[2])
            if s.length > 0.2 {
                raw = [s.normalized]
            } else {
                // Three bonds in a plane: the two normals.
                let n = e[0].cross(e[1]).normalized
                raw = [n, -1 * n]
            }
        case (5, 1), (6, 1):
            raw = [-1 * e[0]] + cone(e[0], angle: .pi / 2, toward: t)
        case (5, _), (6, _):
            raw = octahedralSites(e, toward: t)
        default:
            raw = []
        }
        var out = raw.filter { d in e.allSatisfy { angle($0, d) >= minimumAngle + 1e-9 } }
        if out.isEmpty {
            out = (t == .zero ? lattice : [t] + lattice).filter { d in e.allSatisfy { angle($0, d) >= fallbackClearance } }
        }
        guard t != .zero else { return out }
        // Stable: equal nearness keeps the geometry's own order.
        return out.enumerated().sorted { a, b in
            let da = a.element.dot(t), db = b.element.dot(t)
            return da != db ? da > db : a.offset < b.offset
        }.map(\.element)
    }

    /// The angle between two unit vectors.
    public static func angle(_ a: Vec3, _ b: Vec3) -> Double {
        acos(min(1, max(-1, a.dot(b))))
    }

    /// Directions at `angle` from `axis`: the one nearest `toward` first, then evenly round.
    static func cone(_ axis: Vec3, angle: Double, toward t: Vec3) -> [Vec3] {
        let u0 = perpendicular(to: axis, toward: t)
        let v0 = axis.cross(u0)
        return (0..<coneSamples).map { k in
            let phi = 2 * .pi * Double(k) / Double(coneSamples)
            let u = u0 * cos(phi) + v0 * sin(phi)
            return (axis * cos(angle) + u * sin(angle)).normalized
        }
    }

    static func perpendicularRing(_ axis: Vec3, toward t: Vec3) -> [Vec3] { cone(axis, angle: .pi / 2, toward: t) }

    /// The unit vector perpendicular to `axis` nearest `t`, or a fixed one when `t` is along it.
    static func perpendicular(to axis: Vec3, toward t: Vec3) -> Vec3 {
        let p = t - axis * t.dot(axis)
        if p.length > 1e-6 { return p.normalized }
        let helper = abs(axis.x) < 0.9 ? Vec3(1, 0, 0) : Vec3(0, 1, 0)
        return (helper - axis * helper.dot(axis)).normalized
    }

    static func bisectorOpposite(_ a: Vec3, _ b: Vec3) -> Vec3? {
        let s = -1 * (a + b)
        return s.length > 0.2 ? s.normalized : nil
    }

    /// The two remaining tetrahedral directions beside bonds `a` and `b`.
    static func tetrahedralPair(_ a: Vec3, _ b: Vec3) -> [Vec3] {
        guard let bisector = bisectorOpposite(a, b) else { return perpendicularRing(a, toward: .zero) }
        let n = a.cross(b).normalized
        let c = 1 / 3.0.squareRoot(), s = (2.0 / 3.0).squareRoot()
        return [(bisector * c + n * s).normalized, (bisector * c - n * s).normalized]
    }

    /// The free axes of an octahedron set by the first two bonds.
    static func octahedralSites(_ e: [Vec3], toward t: Vec3) -> [Vec3] {
        let x = e[0]
        var y = e[1] - x * e[1].dot(x)
        if y.length < 1e-3 { y = perpendicular(to: x, toward: t) }
        y = y.normalized
        let z = x.cross(y)
        return [x, -1 * x, y, -1 * y, z, -1 * z]
    }

    /// The 26 directions of a cube's faces, edges and corners: the last resort.
    static let lattice: [Vec3] = {
        var out: [Vec3] = []
        for i in -1...1 {
            for j in -1...1 {
                for k in -1...1 where i != 0 || j != 0 || k != 0 {
                    out.append(Vec3(Double(i), Double(j), Double(k)).normalized)
                }
            }
        }
        return out
    }()
}

extension Mat3 {
    /// The rotation by `angle` about the unit `axis` (right-handed).
    public static func rotation(axis: Vec3, angle: Double) -> Mat3 {
        let a = axis.normalized
        let c = cos(angle), s = sin(angle), t = 1 - c
        return Mat3(rows:
            Vec3(t * a.x * a.x + c, t * a.x * a.y - s * a.z, t * a.x * a.z + s * a.y),
            Vec3(t * a.x * a.y + s * a.z, t * a.y * a.y + c, t * a.y * a.z - s * a.x),
            Vec3(t * a.x * a.z - s * a.y, t * a.y * a.z + s * a.x, t * a.z * a.z + c)
        )
    }

    /// The shortest rotation taking unit `from` onto unit `to`.
    public static func arc(from: Vec3, to: Vec3) -> Mat3 {
        let f = from.normalized, g = to.normalized
        let axis = f.cross(g)
        let c = min(1, max(-1, f.dot(g)))
        if axis.length < 1e-12 {
            if c > 0 { return .identity }
            return rotation(axis: BondGeometry.perpendicular(to: f, toward: .zero), angle: .pi)
        }
        return rotation(axis: axis.normalized, angle: acos(c))
    }
}
