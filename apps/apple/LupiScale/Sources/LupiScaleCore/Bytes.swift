/// Little-endian writer for records, paths, packs and references (§1.1).
struct ByteWriter {
    var bytes: [UInt8] = []

    init(capacity: Int = 0) { bytes.reserveCapacity(capacity) }

    var count: Int { bytes.count }

    mutating func u8(_ v: UInt8) { bytes.append(v) }

    mutating func u16(_ v: UInt16) {
        bytes.append(UInt8(truncatingIfNeeded: v))
        bytes.append(UInt8(truncatingIfNeeded: v >> 8))
    }

    mutating func u32(_ v: UInt32) {
        for i in 0..<4 { bytes.append(UInt8(truncatingIfNeeded: v >> UInt32(8 * i))) }
    }

    mutating func u64(_ v: UInt64) {
        for i in 0..<8 { bytes.append(UInt8(truncatingIfNeeded: v >> UInt64(8 * i))) }
    }

    mutating func i64(_ v: Int64) { u64(UInt64(bitPattern: v)) }

    /// Finite only; −0 is written as +0 (§1.3).
    mutating func f32(_ v: Float) throws {
        guard v.isFinite else { throw fail(.range, "non-finite f32") }
        u32(v == 0 ? 0 : v.bitPattern)
    }

    mutating func f64(_ v: Double) throws {
        guard v.isFinite else { throw fail(.range, "non-finite f64") }
        u64(v == 0 ? 0 : v.bitPattern)
    }

    /// BigUInt: u16 byte count, then the minimal little-endian magnitude (§1.2).
    mutating func big(_ v: BigUInt) throws {
        let mag = v.littleEndianBytes
        guard mag.count <= BigUInt.maxBits / 8 else { throw fail(.limit, "BigUInt beyond 65,536 bits") }
        u16(UInt16(mag.count))
        bytes.append(contentsOf: mag)
    }

    mutating func append(_ b: some Sequence<UInt8>) { bytes.append(contentsOf: b) }

    mutating func ascii(_ s: String) { bytes.append(contentsOf: Array(s.utf8)) }

    mutating func zeros(_ n: Int) { bytes.append(contentsOf: repeatElement(0, count: n)) }

    mutating func pad(toMultipleOf n: Int) {
        while bytes.count % n != 0 { bytes.append(0) }
    }
}

/// Little-endian reader over a byte range. Every failure is a `ScaleError`.
struct ByteReader {
    let bytes: [UInt8]
    private(set) var offset: Int
    let end: Int

    init(_ bytes: [UInt8], offset: Int = 0, end: Int? = nil) {
        self.bytes = bytes
        self.offset = offset
        self.end = end ?? bytes.count
    }

    var remaining: Int { end - offset }

    private func need(_ n: Int) throws {
        if n < 0 || offset + n > end { throw fail(.truncated, "need \(n) bytes at \(offset)") }
    }

    mutating func u8() throws -> UInt8 {
        try need(1)
        defer { offset += 1 }
        return bytes[offset]
    }

    mutating func u16() throws -> UInt16 {
        try need(2)
        defer { offset += 2 }
        return UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
    }

    mutating func u32() throws -> UInt32 {
        try need(4)
        var v: UInt32 = 0
        for i in 0..<4 { v |= UInt32(bytes[offset + i]) << UInt32(8 * i) }
        offset += 4
        return v
    }

    mutating func u64() throws -> UInt64 {
        try need(8)
        var v: UInt64 = 0
        for i in 0..<8 { v |= UInt64(bytes[offset + i]) << UInt64(8 * i) }
        offset += 8
        return v
    }

    mutating func i64() throws -> Int64 { Int64(bitPattern: try u64()) }

    /// Rejects −0 (`canonical`) and non-finite values (`range`), §1.3.
    mutating func f32() throws -> Float {
        let bits = try u32()
        if bits == 0x8000_0000 { throw fail(.canonical, "−0 f32") }
        let v = Float(bitPattern: bits)
        guard v.isFinite else { throw fail(.range, "non-finite f32") }
        return v
    }

    mutating func f64() throws -> Double {
        let bits = try u64()
        if bits == 0x8000_0000_0000_0000 { throw fail(.canonical, "−0 f64") }
        let v = Double(bitPattern: bits)
        guard v.isFinite else { throw fail(.range, "non-finite f64") }
        return v
    }

    /// Rejects a non-minimal BigUInt (`canonical`) and one longer than 8,192 bytes (`limit`).
    mutating func big() throws -> BigUInt {
        let n = Int(try u16())
        if n > BigUInt.maxBits / 8 { throw fail(.limit, "BigUInt longer than 8,192 bytes") }
        try need(n)
        if n > 0 && bytes[offset + n - 1] == 0 { throw fail(.canonical, "non-minimal BigUInt") }
        defer { offset += n }
        return BigUInt(littleEndianBytes: bytes[offset..<(offset + n)])
    }

    mutating func take(_ n: Int) throws -> [UInt8] {
        try need(n)
        defer { offset += n }
        return Array(bytes[offset..<(offset + n)])
    }

    mutating func skip(_ n: Int) throws {
        try need(n)
        offset += n
    }

    /// Reserved or padding bytes: every one zero.
    mutating func zeros(_ n: Int) throws {
        try need(n)
        for i in 0..<n where bytes[offset + i] != 0 { throw fail(.canonical, "nonzero reserved or padding byte") }
        offset += n
    }

    /// Zero padding up to a multiple of `n`, counted from `base`.
    mutating func pad(toMultipleOf n: Int, from base: Int = 0) throws {
        let r = (offset - base) % n
        if r != 0 { try zeros(n - r) }
    }

    func done() throws {
        if offset != end { throw fail(.canonical, "\(end - offset) trailing bytes") }
    }
}

// MARK: Text encodings (§1.8)

enum Hex {
    private static let digits = Array("0123456789abcdef".utf8)

    static func encode(_ bytes: some Sequence<UInt8>) -> String {
        var out: [UInt8] = []
        for b in bytes {
            out.append(digits[Int(b >> 4)])
            out.append(digits[Int(b & 15)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// Lowercase or uppercase hex; nil for anything else or an odd length.
    static func decode(_ text: String) -> [UInt8]? {
        let chars = Array(text.utf8)
        guard chars.count % 2 == 0 else { return nil }
        func value(_ c: UInt8) -> UInt8? {
            switch c {
            case 48...57: c - 48
            case 97...102: c - 87
            case 65...70: c - 55
            default: nil
            }
        }
        var out: [UInt8] = []
        out.reserveCapacity(chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let hi = value(chars[i]), let lo = value(chars[i + 1]) else { return nil }
            out.append(hi << 4 | lo)
            i += 2
        }
        return out
    }
}

/// base64url without padding (RFC 4648 §5).
enum Base64URL {
    private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".utf8)

    static func encode(_ bytes: [UInt8]) -> String {
        var out: [UInt8] = []
        out.reserveCapacity((bytes.count * 4 + 2) / 3)
        var i = 0
        while i + 3 <= bytes.count {
            let v = UInt32(bytes[i]) << 16 | UInt32(bytes[i + 1]) << 8 | UInt32(bytes[i + 2])
            for s in [18, 12, 6, 0] { out.append(alphabet[Int((v >> UInt32(s)) & 63)]) }
            i += 3
        }
        let rest = bytes.count - i
        if rest == 1 {
            let v = UInt32(bytes[i]) << 16
            out.append(alphabet[Int((v >> 18) & 63)])
            out.append(alphabet[Int((v >> 12) & 63)])
        } else if rest == 2 {
            let v = UInt32(bytes[i]) << 16 | UInt32(bytes[i + 1]) << 8
            out.append(alphabet[Int((v >> 18) & 63)])
            out.append(alphabet[Int((v >> 12) & 63)])
            out.append(alphabet[Int((v >> 6) & 63)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// Strict: no padding, no other characters, and unused trailing bits zero.
    static func decode(_ text: String) -> [UInt8]? {
        var lookup = [Int8](repeating: -1, count: 256)
        for (i, c) in alphabet.enumerated() { lookup[Int(c)] = Int8(i) }
        let chars = Array(text.utf8)
        if chars.count % 4 == 1 { return nil }
        var out: [UInt8] = []
        out.reserveCapacity(chars.count * 3 / 4)
        var acc: UInt32 = 0
        var bits = 0
        for c in chars {
            let v = lookup[Int(c)]
            guard v >= 0 else { return nil }
            acc = acc << 6 | UInt32(v)
            bits += 6
            if bits >= 8 {
                bits -= 8
                out.append(UInt8(truncatingIfNeeded: acc >> UInt32(bits)))
                acc &= (1 << UInt32(bits)) - 1
            }
        }
        guard acc == 0 else { return nil }
        return out
    }
}

/// Lexicographic byte order; a proper prefix sorts first (§2.6, §6.4).
func compareBytes(_ a: [UInt8], _ b: [UInt8]) -> Int {
    let n = min(a.count, b.count)
    for i in 0..<n where a[i] != b[i] { return a[i] < b[i] ? -1 : 1 }
    return a.count == b.count ? 0 : (a.count < b.count ? -1 : 1)
}
