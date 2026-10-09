/// `lupi.gen.tower@1` arithmetic (§2.5, §3.4). Every quantity is exact.
public enum TowerMath {
    // MARK: Period checks (§2.5)

    /// `p0 · (p1 × p2)`, exact in 128 bits (below 2¹²³ at the limits).
    public static func determinant(_ p: [SIMD3<Int64>]) -> Int128 {
        let a = wide(p[0]), b = wide(p[1]), c = wide(p[2])
        return a.0 * (b.1 * c.2 - b.2 * c.1) - a.1 * (b.0 * c.2 - b.2 * c.0) + a.2 * (b.0 * c.1 - b.1 * c.0)
    }

    /// For each axis a: `max |p|² × |p_b × p_c|² ≤ 2²⁴ × det²`, evaluated exactly.
    public static func slendernessHolds(_ p: [SIMD3<Int64>], det: Int128) -> Bool {
        let lengths = p.map { v -> BigUInt in
            let w = wide(v)
            return big(w.0 * w.0 + w.1 * w.1 + w.2 * w.2)
        }
        let longest = lengths.max()!
        let det2 = big(det.magnitude) * big(det.magnitude)
        let bound = det2 << 24
        for a in 0..<3 {
            let c = cross(p[(a + 1) % 3], p[(a + 2) % 3])
            let c2 = big(c.0.magnitude) * big(c.0.magnitude) + big(c.1.magnitude) * big(c.1.magnitude)
                + big(c.2.magnitude) * big(c.2.magnitude)
            if longest * c2 > bound { return false }
        }
        return true
    }

    static func wide(_ v: SIMD3<Int64>) -> (Int128, Int128, Int128) { (Int128(v.x), Int128(v.y), Int128(v.z)) }

    static func cross(_ u: SIMD3<Int64>, _ v: SIMD3<Int64>) -> (Int128, Int128, Int128) {
        let a = wide(u), b = wide(v)
        return (a.1 * b.2 - a.2 * b.1, a.2 * b.0 - a.0 * b.2, a.0 * b.1 - a.1 * b.0)
    }

    static func big(_ v: Int128) -> BigUInt { big(v.magnitude) }

    static func big(_ v: UInt128) -> BigUInt {
        BigUInt(limbs: [UInt64(truncatingIfNeeded: v), UInt64(truncatingIfNeeded: v >> 64)])
    }

    // MARK: Level arithmetic (§3.4.1)

    /// `(k − 1) mod 3`, the axis level k ≥ 1 stacks along.
    public static func axis(_ k: BigUInt) -> Int {
        precondition(!k.isZero, "level 0 stacks along no axis")
        return Int(k.minus(1).dividedSmall(3).remainder)
    }

    /// The unit exponent `u(k)`: 0 for k = 0, else `⌊(k − 1) / 3⌋`.
    public static func unitExponent(_ k: BigUInt) -> BigUInt {
        k.isZero ? BigUInt() : k.minus(1).dividedSmall(3).quotient
    }

    /// `C(a, k) = ⌊(k + 2 − a) / 3⌋`: how many of the levels 1…k stack along axis a.
    public static func stacked(_ a: Int, _ k: BigUInt) -> BigUInt {
        (k + BigUInt(UInt64(2 - a))).dividedSmall(3).quotient
    }

    /// `n(a, k, D) = C(a, k) − C(a, k − D)`, for D ≤ k.
    public static func digits(_ a: Int, _ k: BigUInt, _ d: BigUInt) -> BigUInt {
        stacked(a, k).minus(stacked(a, k.minus(d)))
    }

    // MARK: Copy keys and substitution (§3.4.5, §3.4.6)

    /// The step bytes of the tower step from level L to 0 along `runs` (empty when L = 0).
    static func copyStepBytes(levels: BigUInt, runs: [[DigitRun]]) -> [UInt8] {
        levels.isZero ? [] : Path.stepBytes(.tower(levels: levels, runs: runs))
    }

    /// The first 8 bytes, little-endian, of SHA-256("lupi.scale.copy.v1" ‖ 0 ‖ tower ‖ stepBytes).
    public static func copyKey(tower: NodeID, levels: BigUInt, runs: [[DigitRun]]) -> UInt64 {
        NodeID.hashing(domain: Domain.copy, tower.bytes, copyStepBytes(levels: levels, runs: runs)).leadingUInt64
    }

    /// The partial Fisher–Yates of §3.4.6; returns the substituted elements and the changed indices.
    public static func substitute(_ z: [UInt8], _ s: Substitution, key: UInt64) throws -> (atomicNumbers: [UInt8], changed: [Int]) {
        let idx = z.indices.filter { z[$0] == s.fromZ }
        let m = idx.count
        let per = Int(s.perCopy)
        guard per <= m else { throw fail(.validity, "perCopy exceeds the seed's atoms of fromZ") }
        var pool = Array(0..<m)
        var g = SplitMix64(seed: key)
        for t in 0..<per {
            let r = g.next()
            let j = t + Int(r % UInt64(m - t))
            pool.swapAt(t, j)
        }
        var out = z
        var changed: [Int] = []
        for t in 0..<per {
            out[idx[pool[t]]] = s.toZ
            changed.append(idx[pool[t]])
        }
        return (out, changed)
    }
}
