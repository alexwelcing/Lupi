import Foundation

/// Unordered atom pairs within a reach: i < j, sorted by (i, j), each once.
struct NeighborPairs {
    var i: [Int32] = []
    var j: [Int32] = []
    /// Squared distance in double from the Float32 coordinates.
    var d2: [Double] = []
    var count: Int { i.count }
}

/// Coordinates widened from Float32 once, so every distance is computed as the web computes it.
struct Coordinates {
    let x: [Double]
    let y: [Double]
    let z: [Double]

    init(_ positions: [SIMD3<Float>], count: Int) {
        var x = [Double](repeating: 0, count: count)
        var y = x
        var z = x
        for a in 0..<count {
            x[a] = Double(positions[a].x)
            y[a] = Double(positions[a].y)
            z[a] = Double(positions[a].z)
        }
        self.x = x
        self.y = y
        self.z = z
    }
}

/// floor(v), clamped to ±2^52 so absurd coordinates cannot trap; clamped atoms
/// share a cell and are still compared by true distance.
private func cellIndex(_ v: Double) -> Int {
    let limit = 4_503_599_627_370_496.0
    return Int(min(limit, max(-limit, v.rounded(.down))))
}

private struct CellKey: Hashable {
    var x: Int
    var y: Int
    var z: Int
}

/// Port of `neighborPairs` (packages/core/src/bonds/grid.ts): every pair with
/// d² ≤ reach² on a uniform grid whose cell is the reach (at most 6 Å). Each
/// atom's partners are sorted, so the output does not depend on insertion
/// order. Atoms with non-finite coordinates are never paired.
func neighborPairs(_ c: Coordinates, count natoms: Int, reach: Double, insertionOrder: [Int]? = nil) -> NeighborPairs {
    var out = NeighborPairs()
    guard natoms >= 2, reach > 0, reach.isFinite else { return out }
    let gridMaxCell = 6.0
    let cell = min(reach, gridMaxCell)
    let span = Int((reach / cell).rounded(.up))
    let reach2 = reach * reach

    var cx = [Int](repeating: 0, count: natoms)
    var cy = cx
    var cz = cx
    var finite = [Bool](repeating: false, count: natoms)
    var minX = Int.max, minY = Int.max, minZ = Int.max
    var maxX = Int.min, maxY = Int.min, maxZ = Int.min
    for a in 0..<natoms {
        let x = c.x[a], y = c.y[a], z = c.z[a]
        guard x.isFinite, y.isFinite, z.isFinite else { continue }
        finite[a] = true
        cx[a] = cellIndex(x / cell)
        cy[a] = cellIndex(y / cell)
        cz[a] = cellIndex(z / cell)
        minX = min(minX, cx[a]); maxX = max(maxX, cx[a])
        minY = min(minY, cy[a]); maxY = max(maxY, cy[a])
        minZ = min(minZ, cz[a]); maxZ = max(maxZ, cz[a])
    }
    guard minX != Int.max else { return out }

    let nx = maxX - minX + 1
    let ny = maxY - minY + 1
    let nz = maxZ - minZ + 1
    let cellCount = nx.multipliedReportingOverflow(by: ny)
    let dense: Bool = {
        guard !cellCount.overflow else { return false }
        let total = cellCount.partialValue.multipliedReportingOverflow(by: nz)
        return !total.overflow && total.partialValue <= max(4096, natoms * 8)
    }()

    // Dense: a head/next list per cell. Sparse (far-flung atoms): a dictionary keyed by the exact cell.
    var head = dense ? [Int](repeating: -1, count: nx * ny * nz) : []
    var next = [Int](repeating: -1, count: natoms)
    var sparse: [CellKey: Int] = [:]
    func insert(_ a: Int) {
        guard finite[a] else { return }
        if dense {
            let index = (cx[a] - minX) + nx * ((cy[a] - minY) + ny * (cz[a] - minZ))
            next[a] = head[index]
            head[index] = a
        } else {
            let key = CellKey(x: cx[a], y: cy[a], z: cz[a])
            next[a] = sparse[key] ?? -1
            sparse[key] = a
        }
    }
    if let insertionOrder {
        for a in insertionOrder { insert(a) }
    } else {
        for a in 0..<natoms { insert(a) }
    }
    func firstIn(_ x: Int, _ y: Int, _ z: Int) -> Int {
        if dense {
            let ox = x - minX, oy = y - minY, oz = z - minZ
            if ox < 0 || oy < 0 || oz < 0 || ox >= nx || oy >= ny || oz >= nz { return -1 }
            return head[ox + nx * (oy + ny * oz)]
        }
        return sparse[CellKey(x: x, y: y, z: z)] ?? -1
    }

    out.i.reserveCapacity(natoms * 8)
    out.j.reserveCapacity(natoms * 8)
    out.d2.reserveCapacity(natoms * 8)
    var partners: [(j: Int32, d2: Double)] = []
    for a in 0..<natoms where finite[a] {
        let x = c.x[a], y = c.y[a], z = c.z[a]
        partners.removeAll(keepingCapacity: true)
        for dz in -span...span {
            for dy in -span...span {
                for dx in -span...span {
                    var b = firstIn(cx[a] + dx, cy[a] + dy, cz[a] + dz)
                    while b >= 0 {
                        defer { b = next[b] }
                        if b <= a { continue }
                        let ex = c.x[b] - x
                        let ey = c.y[b] - y
                        let ez = c.z[b] - z
                        let d2 = ex * ex + ey * ey + ez * ez
                        if d2 > reach2 { continue }
                        partners.append((Int32(b), d2))
                    }
                }
            }
        }
        partners.sort { $0.j < $1.j }
        for p in partners {
            out.i.append(Int32(a))
            out.j.append(p.j)
            out.d2.append(p.d2)
        }
    }
    return out
}
