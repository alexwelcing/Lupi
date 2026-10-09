import Foundation
import LupiChem
import LupiPlay
import LupiScale
import LupiScaleCore

/// The atoms and bonds of a molecule's merged mesh (plan §3.6): positions relative to the
/// node's local centre c(X), in ångströms, as the cut's `leafMesh` item places them (scale-spec §8.5).
public struct MeshRecipe: Sendable, Equatable {
    public struct Atom: Sendable, Equatable {
        public var atomicNumber: UInt8
        public var position: SIMD3<Float>
        /// Toy radius, Å: `clamp(0.75 × covalent radius, 0.32, 0.90)` (plan §3.6).
        public var radius: Float
    }

    public struct Bond: Sendable, Equatable {
        public var i: Int
        public var j: Int
        public var kind: BondKind
    }

    /// Half a covalent bond whose other atom is drawn elsewhere: a flop segment's side of its
    /// hinge (plan §8 M4). The cylinder runs from the atom to the bond's midpoint.
    public struct Stub: Sendable, Equatable {
        public var atom: Int
        /// The other atom's position, Å, in the same frame.
        public var toward: SIMD3<Float>
    }

    /// Cache key: equal recipes share one mesh.
    public var key: String
    public var atoms: [Atom]
    public var bonds: [Bond]
    public var stubs: [Stub] = []

    public init(key: String, atoms: [Atom], bonds: [Bond], stubs: [Stub] = []) {
        self.key = key
        self.atoms = atoms
        self.bonds = bonds
        self.stubs = stubs
    }

    public static func toyRadius(_ z: UInt8) -> Float {
        Float(min(0.90, max(0.32, 0.75 * ChemicalElement.forAtomicNumber(Int(z)).covalentRadius)))
    }

    /// One flop segment's recipe (plan §8 M4): its atoms, the bonds inside it and its halves
    /// of the hinges, in this recipe's frame, so the segments drawn together are the whole.
    public func segment(_ k: Int, of flop: FlopSegments) -> MeshRecipe {
        let members = flop.segments[k].atoms
        var local = [Int: Int]()
        for (n, atom) in members.enumerated() { local[atom] = n }
        var inside: [Bond] = []
        var stubs: [Stub] = []
        for bond in bonds {
            switch (local[bond.i], local[bond.j]) {
            case let (i?, j?):
                inside.append(Bond(i: i, j: j, kind: bond.kind))
            case let (i?, nil) where bond.kind == .covalent:
                stubs.append(Stub(atom: i, toward: atoms[bond.j].position))
            case let (nil, j?) where bond.kind == .covalent:
                stubs.append(Stub(atom: j, toward: atoms[bond.i].position))
            default:
                break
            }
        }
        return MeshRecipe(key: "\(key)#flop\(k)of\(flop.count)", atoms: members.map { atoms[$0] }, bonds: inside, stubs: stubs)
    }

    /// The recipe of a leaf (its game graph from `lupi-bonds.molecular.v1`, plan §3.7).
    public static func of(_ leaf: LeafNode, centre: Vec3, key: String, bonds withBonds: Bool = true) -> MeshRecipe {
        let atoms = zip(leaf.atomicNumbers, leaf.positions).map { z, p in
            Atom(
                atomicNumber: z,
                position: SIMD3(Float(Double(p.x) - centre.x), Float(Double(p.y) - centre.y), Float(Double(p.z) - centre.z)),
                radius: toyRadius(z)
            )
        }
        var bonds: [Bond] = []
        if withBonds {
            let molecule = Molecule(atomicNumbers: leaf.atomicNumbers.map(Int.init), positions: leaf.positions)
            bonds = BondGraph.forPlay(molecule).bonds.map { Bond(i: $0.i, j: $0.j, kind: $0.kind) }
        }
        return MeshRecipe(key: key, atoms: atoms, bonds: bonds)
    }
}

/// Triangles for one material: an element's spheres and its halves of the bonds.
public struct MeshPart: Sendable, Equatable {
    public var atomicNumber: UInt8
    public var positions: [SIMD3<Float>] = []
    public var normals: [SIMD3<Float>] = []
    public var indices: [UInt32] = []

    public var triangleCount: Int { indices.count / 3 }
}

/// Builds merged-mesh geometry (plan §3.6): icospheres for atoms, half-bond cylinders in each
/// atom's colour, thinner dashes for coordination bonds and dots for ionic contacts, as on the
/// web (`packages/core/src/bonds/types.ts`). Pure arithmetic, so it is tested on Linux; the app
/// wraps each part in a `MeshDescriptor` with its element's material.
public enum MeshBuilder {
    /// Bond radius, Å (plan §3.6, est.).
    public static let bondRadius: Float = 0.16
    public static let coordinationRadius: Float = 0.10
    public static let dashLength: Float = 0.22
    public static let dotRadius: Float = 0.07
    public static let dotSpacing: Float = 0.35
    static let bondSides = 12

    /// Icosphere subdivisions: 2 (320 triangles) for small molecules, 1 (80) up to 2,000 atoms.
    public static func detail(atoms: Int) -> Int { atoms <= 200 ? 2 : 1 }

    public static func build(_ recipe: MeshRecipe, detail: Int? = nil) -> [MeshPart] {
        let level = detail ?? Self.detail(atoms: recipe.atoms.count)
        let sphere = Icosphere.unit(subdivisions: level)
        var parts: [UInt8: MeshPart] = [:]
        func part(_ z: UInt8) -> MeshPart { parts[z] ?? MeshPart(atomicNumber: z) }

        for atom in recipe.atoms {
            var p = part(atom.atomicNumber)
            let base = UInt32(p.positions.count)
            for v in sphere.vertices {
                p.positions.append(atom.position + v * atom.radius)
                p.normals.append(v)
            }
            p.indices += sphere.indices.map { $0 + base }
            parts[atom.atomicNumber] = p
        }
        for stub in recipe.stubs where stub.atom < recipe.atoms.count {
            let a = recipe.atoms[stub.atom]
            var p = part(a.atomicNumber)
            cylinder(&p, from: a.position, to: (a.position + stub.toward) / 2, radius: bondRadius)
            parts[a.atomicNumber] = p
        }
        for bond in recipe.bonds {
            guard bond.i < recipe.atoms.count, bond.j < recipe.atoms.count else { continue }
            let a = recipe.atoms[bond.i], b = recipe.atoms[bond.j]
            let mid = (a.position + b.position) / 2
            switch bond.kind {
            case .covalent:
                var pa = part(a.atomicNumber)
                cylinder(&pa, from: a.position, to: mid, radius: bondRadius)
                parts[a.atomicNumber] = pa
                var pb = part(b.atomicNumber)
                cylinder(&pb, from: mid, to: b.position, radius: bondRadius)
                parts[b.atomicNumber] = pb
            case .coordination:
                for (from, to, z) in dashes(a, b) {
                    var p = part(z)
                    cylinder(&p, from: from, to: to, radius: coordinationRadius)
                    parts[z] = p
                }
            case .ionicContact:
                for (centre, z) in dots(a, b) {
                    var p = part(z)
                    let base = UInt32(p.positions.count)
                    let small = Icosphere.unit(subdivisions: 0)
                    for v in small.vertices {
                        p.positions.append(centre + v * dotRadius)
                        p.normals.append(v)
                    }
                    p.indices += small.indices.map { $0 + base }
                    parts[z] = p
                }
            }
        }
        return parts.keys.sorted().map { parts[$0]! }
    }

    /// Dashes between the two spheres' surfaces, each in the colour of the nearer atom.
    static func dashes(_ a: MeshRecipe.Atom, _ b: MeshRecipe.Atom) -> [(SIMD3<Float>, SIMD3<Float>, UInt8)] {
        let d = b.position - a.position
        let len = simdLength(d)
        guard len > 1e-4 else { return [] }
        let u = d / len
        let start = a.radius, end = len - b.radius
        guard end > start else { return [] }
        var out: [(SIMD3<Float>, SIMD3<Float>, UInt8)] = []
        var s = start
        while s < end {
            let e = min(end, s + dashLength)
            let z = (s + e) / 2 < len / 2 ? a.atomicNumber : b.atomicNumber
            out.append((a.position + u * s, a.position + u * e, z))
            s = e + dashLength
        }
        return out
    }

    /// Evenly spaced dots between the two spheres' surfaces.
    static func dots(_ a: MeshRecipe.Atom, _ b: MeshRecipe.Atom) -> [(SIMD3<Float>, UInt8)] {
        let d = b.position - a.position
        let len = simdLength(d)
        guard len > 1e-4 else { return [] }
        let u = d / len
        let start = a.radius + dotRadius, end = len - b.radius - dotRadius
        guard end > start else { return [] }
        let n = max(1, Int(((end - start) / dotSpacing).rounded(.down)) + 1)
        let step = n > 1 ? (end - start) / Float(n - 1) : 0
        return (0..<n).map { k in
            let s = n > 1 ? start + Float(k) * step : (start + end) / 2
            return (a.position + u * s, s < len / 2 ? a.atomicNumber : b.atomicNumber)
        }
    }

    /// An open cylinder (its ends are inside spheres) with outward normals.
    static func cylinder(_ p: inout MeshPart, from a: SIMD3<Float>, to b: SIMD3<Float>, radius: Float) {
        let d = b - a
        let len = simdLength(d)
        guard len > 1e-5 else { return }
        let axis = d / len
        let helper: SIMD3<Float> = abs(axis.x) < 0.9 ? SIMD3(1, 0, 0) : SIMD3(0, 1, 0)
        let u = normalize3(cross3(axis, helper))
        let v = cross3(axis, u)
        let base = UInt32(p.positions.count)
        let n = bondSides
        for k in 0..<n {
            let t = Float(k) / Float(n) * 2 * .pi
            let normal = u * cos(t) + v * sin(t)
            p.positions.append(a + normal * radius)
            p.normals.append(normal)
            p.positions.append(b + normal * radius)
            p.normals.append(normal)
        }
        for k in 0..<n {
            let i0 = base + UInt32(2 * k), i1 = i0 + 1
            let j0 = base + UInt32(2 * ((k + 1) % n)), j1 = j0 + 1
            // Counter-clockwise seen from outside.
            p.indices += [i0, j0, i1, i1, j0, j1]
        }
    }
}

/// A unit icosphere: 20 × 4^n triangles, counter-clockwise from outside.
public struct Icosphere: Sendable {
    public var vertices: [SIMD3<Float>]
    public var indices: [UInt32]

    private static let levels: [Icosphere] = (0...3).map(make)

    /// Subdivisions 0 to 3 (20 to 1,280 triangles).
    public static func unit(subdivisions n: Int) -> Icosphere { levels[min(3, max(0, n))] }

    static func make(_ n: Int) -> Icosphere {
        let t: Float = (1 + Float(5).squareRoot()) / 2
        var v: [SIMD3<Float>] = [
            SIMD3(-1, t, 0), SIMD3(1, t, 0), SIMD3(-1, -t, 0), SIMD3(1, -t, 0),
            SIMD3(0, -1, t), SIMD3(0, 1, t), SIMD3(0, -1, -t), SIMD3(0, 1, -t),
            SIMD3(t, 0, -1), SIMD3(t, 0, 1), SIMD3(-t, 0, -1), SIMD3(-t, 0, 1),
        ].map(normalize3)
        var f: [(UInt32, UInt32, UInt32)] = [
            (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
            (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
        ]
        for _ in 0..<n {
            var mids: [UInt64: UInt32] = [:]
            func mid(_ a: UInt32, _ b: UInt32) -> UInt32 {
                let key = UInt64(min(a, b)) << 32 | UInt64(max(a, b))
                if let m = mids[key] { return m }
                v.append(normalize3((v[Int(a)] + v[Int(b)]) / 2))
                let m = UInt32(v.count - 1)
                mids[key] = m
                return m
            }
            var next: [(UInt32, UInt32, UInt32)] = []
            for (a, b, c) in f {
                let ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
                next += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
            }
            f = next
        }
        return Icosphere(vertices: v, indices: f.flatMap { [$0.0, $0.1, $0.2] })
    }
}

@inline(__always) func simdLength(_ v: SIMD3<Float>) -> Float { (v * v).sum().squareRoot() }
@inline(__always) func normalize3(_ v: SIMD3<Float>) -> SIMD3<Float> {
    let l = simdLength(v)
    return l > 0 ? v / l : v
}
@inline(__always) func cross3(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> SIMD3<Float> {
    SIMD3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
}
