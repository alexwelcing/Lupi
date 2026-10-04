/// A ring as atoms in cyclic order, starting at its smallest index and
/// stepping toward the smaller of that atom's two ring neighbours.
public struct Ring: Sendable, Hashable, Codable {
    public var atoms: [Int]
    public var size: Int { atoms.count }
}

/// A set of rings joined by shared bonds: one ring, a fused system, or a cage.
public struct RingSystem: Sendable, Hashable, Codable {
    public var atoms: [Int]
    public var bondCount: Int
    /// Independent cycles in the system (bonds − atoms + 1).
    public var cycleCount: Int
    /// Two or more rings sharing bonds (naphthalene, steroids, cages).
    public var isFused: Bool { cycleCount >= 2 }
    /// A fused system closed around a volume: at least three cycles, and
    /// globular (smallest RMS extent at least half the largest), like C60,
    /// adamantane or cubane. A shape test, so it is a play heuristic, not chemistry.
    public var isCage: Bool
}

public struct RingAnalysis: Sendable, Equatable {
    /// Per bond: true when the bond lies on a cycle (it is not a bridge).
    public var ringBond: [Bool]
    /// Independent cycles over the analysed kinds: bonds − atoms + components.
    public var cycleCount: Int
    /// Smallest set of smallest rings, by size then atoms; nil when a ring
    /// system has more than `ringSearchLimit` ring bonds.
    public var smallestRings: [Ring]?
    public var systems: [RingSystem]

    public var ringBondCount: Int { ringBond.lazy.filter { $0 }.count }
}

extension BondGraph {
    /// A ring system with more ring bonds than this skips the ring search
    /// (colossi); cycle counts and ring systems still hold.
    public static let ringSearchLimit = 6000

    /// Rings over covalent bonds by default; metal coordination would make
    /// every M–C–C a three-membered ring.
    public func rings(molecule: Molecule, kinds: Set<BondKind> = [.covalent]) -> RingAnalysis {
        let ringBond = ringBondMask(kinds: kinds)
        let active = bonds.indices.filter { kinds.contains(bonds[$0].kind) }
        let components = self.components(kinds: kinds).count
        let cycleCount = active.count - atomCount + components
        let groups = ringGroups(ringBond: ringBond)
        var smallest: [Ring]? = []
        for group in groups {
            guard group.bonds.count <= Self.ringSearchLimit else {
                smallest = nil
                break
            }
            smallest?.append(contentsOf: smallestRings(ringBond: ringBond, group: group))
        }
        smallest?.sort { $0.size != $1.size ? $0.size < $1.size : $0.atoms.lexicographicallyPrecedes($1.atoms) }
        return RingAnalysis(
            ringBond: ringBond, cycleCount: cycleCount, smallestRings: smallest,
            systems: ringSystems(groups, molecule: molecule)
        )
    }

    /// Atoms and ring bonds of each ring system, ordered by lowest atom.
    func ringGroups(ringBond: [Bool]) -> [(atoms: [Int], bonds: [Int])] {
        let nonRing = Set(bonds.indices.filter { !ringBond[$0] })
        let groups = components(kinds: BondGraph.allKinds, excluding: nonRing).filter { $0.count > 2 }
        // One pass over the ring bonds, so many small systems stay linear.
        var label = [Int](repeating: -1, count: atomCount)
        for (g, members) in groups.enumerated() { for atom in members { label[atom] = g } }
        var groupBonds = [[Int]](repeating: [], count: groups.count)
        for k in bonds.indices where ringBond[k] && label[bonds[k].i] >= 0 { groupBonds[label[bonds[k].i]].append(k) }
        return zip(groups, groupBonds).map { ($0, $1) }
    }

    /// Bridges by Tarjan's low-link, iteratively so a million-atom chain cannot overflow the stack.
    public func ringBondMask(kinds: Set<BondKind> = [.covalent]) -> [Bool] {
        var ring = [Bool](repeating: false, count: bonds.count)
        var order = [Int](repeating: -1, count: atomCount)
        var low = [Int](repeating: 0, count: atomCount)
        var counter = 0
        var isBridge = [Bool](repeating: false, count: bonds.count)
        // Stack frames: (atom, bond used to arrive, next incident position).
        var stack: [(atom: Int, via: Int, next: Int)] = []
        for root in 0..<atomCount where order[root] < 0 {
            order[root] = counter
            low[root] = counter
            counter += 1
            stack.append((root, -1, 0))
            while !stack.isEmpty {
                let top = stack.count - 1
                let atom = stack[top].atom
                if stack[top].next < incident[atom].count {
                    let k = incident[atom][stack[top].next]
                    stack[top].next += 1
                    if k == stack[top].via || !kinds.contains(bonds[k].kind) { continue }
                    let next = bonds[k].other(atom)
                    if order[next] < 0 {
                        order[next] = counter
                        low[next] = counter
                        counter += 1
                        stack.append((next, k, 0))
                    } else {
                        low[atom] = min(low[atom], order[next])
                    }
                } else {
                    let finished = stack.removeLast()
                    if let parent = stack.last {
                        low[parent.atom] = min(low[parent.atom], low[finished.atom])
                        if low[finished.atom] > order[parent.atom] { isBridge[finished.via] = true }
                    }
                }
            }
        }
        for k in bonds.indices where kinds.contains(bonds[k].kind) { ring[k] = !isBridge[k] }
        return ring
    }

    /// For every ring bond, every shortest cycle through it (at most 32), then
    /// a greedy pick, smallest first, of cycles independent over GF(2) until
    /// there are as many as the ring bonds' cycle count. Deterministic: ties
    /// break on the sorted atom list.
    func smallestRings(ringBond: [Bool], group: (atoms: [Int], bonds: [Int])) -> [Ring] {
        let ringIndices = group.bonds
        guard !ringIndices.isEmpty else { return [] }
        let column = Dictionary(uniqueKeysWithValues: ringIndices.enumerated().map { ($0.element, $0.offset) })
        let words = (ringIndices.count + 63) / 64
        let target = ringIndices.count - group.atoms.count + 1

        var candidates: [(atoms: [Int], key: [Int], edges: [UInt64])] = []
        var seen = Set<[Int]>()
        var dist = [Int](repeating: -1, count: atomCount)
        var touched: [Int] = []
        for k in ringIndices {
            let u = bonds[k].i
            let v = bonds[k].j
            for t in touched { dist[t] = -1 }
            touched = [v]
            dist[v] = 0
            var queue = [v]
            var head = 0
            while head < queue.count, dist[u] < 0 {
                let cur = queue[head]
                head += 1
                for e in incident[cur] where ringBond[e] && e != k {
                    let next = bonds[e].other(cur)
                    if dist[next] < 0 {
                        dist[next] = dist[cur] + 1
                        touched.append(next)
                        queue.append(next)
                    }
                }
            }
            guard dist[u] > 0 else { continue }
            var paths: [[Int]] = []
            var path = [u]
            func walk(_ cur: Int) {
                if paths.count >= 32 { return }
                if cur == v {
                    paths.append(path)
                    return
                }
                for e in incident[cur] where ringBond[e] && e != k {
                    let next = bonds[e].other(cur)
                    if dist[next] == dist[cur] - 1 {
                        path.append(next)
                        walk(next)
                        path.removeLast()
                    }
                }
            }
            walk(u)
            for cycle in paths {
                var edges = [UInt64](repeating: 0, count: words)
                var edgeList: [Int] = []
                for t in 0..<cycle.count {
                    let a = cycle[t]
                    let b = cycle[(t + 1) % cycle.count]
                    guard let e = bondIndex(a, b), let c = column[e] else { continue }
                    edges[c >> 6] |= 1 << UInt64(c & 63)
                    edgeList.append(c)
                }
                let key = edgeList.sorted()
                if !seen.insert(key).inserted { continue }
                candidates.append((canonicalCycle(cycle), cycle.sorted(), edges))
            }
        }
        candidates.sort { a, b in
            a.atoms.count != b.atoms.count ? a.atoms.count < b.atoms.count : a.key.lexicographicallyPrecedes(b.key)
        }

        // Basis rows keyed by pivot bit, each reduced against earlier pivots.
        var basis: [(pivot: Int, bits: [UInt64])] = []
        var rings: [Ring] = []
        for candidate in candidates {
            if rings.count >= target { break }
            var bits = candidate.edges
            for row in basis where bits[row.pivot >> 6] & (1 << UInt64(row.pivot & 63)) != 0 {
                for w in 0..<words { bits[w] ^= row.bits[w] }
            }
            guard let pivot = lowestBit(bits) else { continue }
            basis.append((pivot, bits))
            rings.append(Ring(atoms: candidate.atoms))
        }
        return rings
    }

    func ringSystems(_ groups: [(atoms: [Int], bonds: [Int])], molecule: Molecule) -> [RingSystem] {
        groups.compactMap { group in
            let cycles = group.bonds.count - group.atoms.count + 1
            guard cycles >= 1 else { return nil }
            return RingSystem(
                atoms: group.atoms, bondCount: group.bonds.count, cycleCount: cycles,
                isCage: cycles >= 3 && isGlobular(group.atoms, molecule: molecule)
            )
        }
    }

    private func isGlobular(_ atoms: [Int], molecule: Molecule) -> Bool {
        let extents = rmsExtents(atoms.map { molecule.position($0) })
        return extents.z > 0 && extents.x >= 0.5 * extents.z
    }
}

/// RMS extents along the principal axes of an unweighted point cloud, ascending.
func rmsExtents(_ points: [Vec3]) -> Vec3 {
    guard !points.isEmpty else { return .zero }
    let center = points.reduce(Vec3.zero, +) / Double(points.count)
    var m = Mat3.zero
    for p in points {
        let d = p - center
        m[0, 0] += d.x * d.x; m[0, 1] += d.x * d.y; m[0, 2] += d.x * d.z
        m[1, 1] += d.y * d.y; m[1, 2] += d.y * d.z; m[2, 2] += d.z * d.z
    }
    m[1, 0] = m[0, 1]; m[2, 0] = m[0, 2]; m[2, 1] = m[1, 2]
    let n = Double(points.count)
    let values = SymmetricEigen.solve(Mat3(columns: m.c0 / n, m.c1 / n, m.c2 / n)).values
    return Vec3(max(0, values.x).squareRoot(), max(0, values.y).squareRoot(), max(0, values.z).squareRoot())
}

private func lowestBit(_ bits: [UInt64]) -> Int? {
    for (w, word) in bits.enumerated() where word != 0 { return w * 64 + word.trailingZeroBitCount }
    return nil
}

/// Start at the smallest atom, step toward its smaller ring neighbour.
private func canonicalCycle(_ cycle: [Int]) -> [Int] {
    let k = cycle.count
    guard k > 2 else { return cycle }
    var start = 0
    for t in 1..<k where cycle[t] < cycle[start] { start = t }
    let next = cycle[(start + 1) % k]
    let prev = cycle[(start - 1 + k) % k]
    let step = next < prev ? 1 : k - 1
    return (0..<k).map { cycle[(start + step * $0) % k] }
}
