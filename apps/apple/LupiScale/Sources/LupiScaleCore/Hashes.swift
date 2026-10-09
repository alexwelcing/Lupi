/// SHA-256 (FIPS 180-4), incremental, for NodeIDs, copy keys, refKeys and
/// contentIds (§1.5).
///
/// The spec gives this to a `LupiCore` target in LupiKit; until that target
/// exists this package keeps its own, at `package` access, so no module that
/// imports both LupiScaleCore and LupiData sees two public `SHA256`s.
package struct SHA256Hasher {
    private var state: (UInt32, UInt32, UInt32, UInt32, UInt32, UInt32, UInt32, UInt32) = (
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    )
    private var buffer: [UInt8] = []
    private var length: UInt64 = 0

    package init() { buffer.reserveCapacity(64) }

    package static func hash(_ bytes: [UInt8]) -> [UInt8] {
        var h = SHA256Hasher()
        h.update(bytes)
        return h.finalize()
    }

    /// The domain string's ASCII bytes and one zero byte (§1.5).
    package mutating func update(domain: String) {
        update(Array(domain.utf8))
        update([0])
    }

    package mutating func update(_ bytes: [UInt8]) {
        length &+= UInt64(bytes.count)
        bytes.withUnsafeBufferPointer { src in
            var i = 0
            if !buffer.isEmpty {
                let take = min(64 - buffer.count, src.count)
                buffer.append(contentsOf: src[0..<take])
                i = take
                if buffer.count == 64 {
                    buffer.withUnsafeBufferPointer { compress($0.baseAddress!) }
                    buffer.removeAll(keepingCapacity: true)
                }
            }
            while i + 64 <= src.count {
                compress(src.baseAddress! + i)
                i += 64
            }
            if i < src.count { buffer.append(contentsOf: src[i..<src.count]) }
        }
    }

    package mutating func finalize() -> [UInt8] {
        let bits = length &* 8
        var tail = buffer
        tail.append(0x80)
        while tail.count % 64 != 56 { tail.append(0) }
        for s in stride(from: 56, through: 0, by: -8) { tail.append(UInt8(truncatingIfNeeded: bits >> UInt64(s))) }
        tail.withUnsafeBufferPointer { p in
            var i = 0
            while i < p.count {
                compress(p.baseAddress! + i)
                i += 64
            }
        }
        buffer.removeAll()
        let words = [state.0, state.1, state.2, state.3, state.4, state.5, state.6, state.7]
        var out = [UInt8]()
        out.reserveCapacity(32)
        for w in words {
            out.append(UInt8(truncatingIfNeeded: w >> 24))
            out.append(UInt8(truncatingIfNeeded: w >> 16))
            out.append(UInt8(truncatingIfNeeded: w >> 8))
            out.append(UInt8(truncatingIfNeeded: w))
        }
        return out
    }

    @inline(__always) private static func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 { (x >> n) | (x << (32 &- n)) }

    private mutating func compress(_ p: UnsafePointer<UInt8>) {
        var w = (
            UInt32(0), UInt32(0), UInt32(0), UInt32(0), UInt32(0), UInt32(0), UInt32(0), UInt32(0),
            UInt32(0), UInt32(0), UInt32(0), UInt32(0), UInt32(0), UInt32(0), UInt32(0), UInt32(0)
        )
        withUnsafeMutableBytes(of: &w) { raw in
            let words = raw.bindMemory(to: UInt32.self)
            for t in 0..<16 {
                let b = p + 4 * t
                words[t] = UInt32(b[0]) << 24 | UInt32(b[1]) << 16 | UInt32(b[2]) << 8 | UInt32(b[3])
            }
        }
        var (a, b, c, d, e, f, g, h) = state
        withUnsafeMutableBytes(of: &w) { raw in
            let s = raw.bindMemory(to: UInt32.self)
            for t in 0..<64 {
                let wt: UInt32
                if t < 16 {
                    wt = s[t]
                } else {
                    let w15 = s[(t - 15) & 15], w2 = s[(t - 2) & 15]
                    let s0 = Self.rotr(w15, 7) ^ Self.rotr(w15, 18) ^ (w15 >> 3)
                    let s1 = Self.rotr(w2, 17) ^ Self.rotr(w2, 19) ^ (w2 >> 10)
                    wt = s[t & 15] &+ s0 &+ s[(t - 7) & 15] &+ s1
                    s[t & 15] = wt
                }
                let S1 = Self.rotr(e, 6) ^ Self.rotr(e, 11) ^ Self.rotr(e, 25)
                let ch = (e & f) ^ (~e & g)
                let t1 = h &+ S1 &+ ch &+ sha256K[t] &+ wt
                let S0 = Self.rotr(a, 2) ^ Self.rotr(a, 13) ^ Self.rotr(a, 22)
                let maj = (a & b) ^ (a & c) ^ (b & c)
                let t2 = S0 &+ maj
                h = g; g = f; f = e; e = d &+ t1
                d = c; c = b; b = a; a = t1 &+ t2
            }
        }
        state = (
            state.0 &+ a, state.1 &+ b, state.2 &+ c, state.3 &+ d,
            state.4 &+ e, state.5 &+ f, state.6 &+ g, state.7 &+ h
        )
    }
}

private let sha256K: [UInt32] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/// CRC-32/ISO-HDLC, the CRC of zlib and PNG (§1.6). It only guards packs
/// against corruption; it never identifies anything.
public enum CRC32 {
    private static let table: [UInt32] = (0..<256).map { n in
        var c = UInt32(n)
        for _ in 0..<8 { c = c & 1 == 1 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    public static func checksum(_ bytes: [UInt8]) -> UInt32 {
        checksum(bytes[...])
    }

    public static func checksum(_ bytes: ArraySlice<UInt8>) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        table.withUnsafeBufferPointer { t in
            for b in bytes { c = t[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        }
        return c ^ 0xFFFF_FFFF
    }
}

/// SplitMix64 (Steele, Lea and Flood, OOPSLA 2014), §1.7: the only
/// pseudo-random generator in v1, used by the dopant substitution alone.
public struct SplitMix64: Sendable {
    public private(set) var state: UInt64

    public init(seed: UInt64) { state = seed }

    public mutating func next() -> UInt64 {
        state = state &+ 0x9E37_79B9_7F4A_7C15
        return SplitMix64.mix(state)
    }

    /// The output function: the steps after `z ← s` (§1.7), also the display key's mixer (§9.7).
    public static func mix(_ s: UInt64) -> UInt64 {
        var z = s
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
