/// `lupi.bake.partition@1` (§3.6): any explicit structure into leaves and groups,
/// integer-only so every platform bakes the same NodeIDs.
public enum Partition {
    public static func bake(atomicNumbers: [UInt8], positions: [SIMD3<Float>]) throws -> (records: [NodeRecord], root: NodeID) {
        let n = atomicNumbers.count
        guard n >= 1, positions.count == n else { throw fail(.range, "one position per atom, at least one atom") }
        for p in positions {
            for v in [p.x, p.y, p.z] where !(v.isFinite && abs(v) <= RecordLimits.positionLimit) {
                throw fail(.range, "a coordinate beyond 2^20 Å")
            }
        }
        if n <= RecordLimits.maxAtoms {
            let leaf = try NodeRecord(.leaf(LeafNode(atomicNumbers: atomicNumbers, positions: positions)))
            return ([leaf], leaf.id)
        }
        // q = ⌊x × 1024⌋: a power-of-two scale is exact, so only the floor rounds.
        var q = [[Int64]](repeating: [Int64](repeating: 0, count: n), count: 3)
        for i in 0..<n {
            let p = positions[i]
            q[0][i] = Int64((Double(p.x) * 1024).rounded(.down))
            q[1][i] = Int64((Double(p.y) * 1024).rounded(.down))
            q[2][i] = Int64((Double(p.z) * 1024).rounded(.down))
        }
        let mins = q.map { $0.min()! }
        var largest: Int64 = 0
        for a in 0..<3 { for i in 0..<n { largest = max(largest, q[a][i] - mins[a]) } }
        let bits = largest == 0 ? 0 : 64 - largest.leadingZeroBitCount
        let shift = Int64(max(0, bits - 21))
        var keyed = [(key: UInt64, index: Int)]()
        keyed.reserveCapacity(n)
        for i in 0..<n {
            var key: UInt64 = 0
            for a in 0..<3 {
                let u = UInt64((q[a][i] - mins[a]) >> shift)
                for b in 0..<21 where (u >> UInt64(b)) & 1 == 1 { key |= 1 << UInt64(3 * b + a) }
            }
            keyed.append((key, i))
        }
        keyed.sort { $0.key != $1.key ? $0.key < $1.key : $0.index < $1.index }

        var records: [NodeRecord] = []
        var level: [NodeID] = []
        var start = 0
        while start < n {
            let slice = keyed[start..<min(start + RecordLimits.maxAtoms, n)]
            let leaf = try NodeRecord(.leaf(LeafNode(
                atomicNumbers: slice.map { atomicNumbers[$0.index] },
                positions: slice.map { positions[$0.index] }
            )))
            records.append(leaf)
            level.append(leaf.id)
            start += RecordLimits.maxAtoms
        }
        while level.count > 1 {
            var next: [NodeID] = []
            var s = 0
            while s < level.count {
                let children = level[s..<min(s + 8, level.count)].map { GroupChild(id: $0) }
                let group = try NodeRecord(.group(Array(children)))
                records.append(group)
                next.append(group.id)
                s += 8
            }
            level = next
        }
        return (records, level[0])
    }
}
