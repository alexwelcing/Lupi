import Foundation

/// An exact unsigned integer (scale-spec §1.2).
///
/// The type itself has no ceiling, so intermediate arithmetic never wraps;
/// the 65,536-bit limit is enforced where a value is encoded or decoded and
/// where Magnitude chooses its plain form (§5.1).
public struct BigUInt: Hashable, Comparable, Sendable, CustomStringConvertible, ExpressibleByIntegerLiteral {
    /// Little-endian 64-bit limbs with no trailing zero limb; zero is empty.
    public private(set) var limbs: [UInt64]

    /// The largest value an encoding carries: 65,536 bits.
    public static let maxBits = 65_536

    public init() { limbs = [] }

    public init(_ value: UInt64) { limbs = value == 0 ? [] : [value] }

    public init(_ value: Int) {
        precondition(value >= 0, "BigUInt is unsigned")
        self.init(UInt64(value))
    }

    public init(integerLiteral value: UInt64) { self.init(value) }

    public init(limbs: [UInt64]) {
        self.limbs = limbs
        normalize()
    }

    /// The value of minimal little-endian bytes, or of any bytes (trailing zeros are ignored).
    public init(littleEndianBytes bytes: some Collection<UInt8>) {
        var out = [UInt64](repeating: 0, count: (bytes.count + 7) / 8)
        for (i, b) in bytes.enumerated() { out[i >> 3] |= UInt64(b) << UInt64((i & 7) * 8) }
        self.init(limbs: out)
    }

    /// Parses decimal digits; nil for anything else.
    public init?(decimal text: String) {
        guard !text.isEmpty else { return nil }
        var value = BigUInt()
        var chunk: UInt64 = 0
        var chunkDigits = 0
        for ch in text.utf8 {
            guard ch >= 48, ch <= 57 else { return nil }
            chunk = chunk * 10 + UInt64(ch - 48)
            chunkDigits += 1
            if chunkDigits == 19 {
                value = value.multipliedSmall(10_000_000_000_000_000_000) + BigUInt(chunk)
                chunk = 0
                chunkDigits = 0
            }
        }
        if chunkDigits > 0 {
            var scale: UInt64 = 1
            for _ in 0..<chunkDigits { scale *= 10 }
            value = value.multipliedSmall(scale) + BigUInt(chunk)
        }
        self = value
    }

    private mutating func normalize() {
        while let last = limbs.last, last == 0 { limbs.removeLast() }
    }

    public var isZero: Bool { limbs.isEmpty }

    /// The number of significant bits (0 for zero).
    public var bitWidth: Int {
        guard let top = limbs.last else { return 0 }
        return limbs.count * 64 - top.leadingZeroBitCount
    }

    /// The value when it fits in a UInt64.
    public var uint64: UInt64? {
        switch limbs.count {
        case 0: 0
        case 1: limbs[0]
        default: nil
        }
    }

    /// The value when it fits in an Int.
    public var int: Int? {
        guard let v = uint64, v <= UInt64(Int.max) else { return nil }
        return Int(v)
    }

    /// Minimal little-endian bytes: empty for zero, last byte nonzero.
    public var littleEndianBytes: [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(limbs.count * 8)
        for limb in limbs {
            for i in 0..<8 { out.append(UInt8(truncatingIfNeeded: limb >> UInt64(i * 8))) }
        }
        while let last = out.last, last == 0 { out.removeLast() }
        return out
    }

    public func bit(_ index: Int) -> Bool {
        let limb = index >> 6
        guard limb < limbs.count else { return false }
        return (limbs[limb] >> UInt64(index & 63)) & 1 == 1
    }

    // MARK: Comparison

    public static func < (a: BigUInt, b: BigUInt) -> Bool { a.compare(b) < 0 }

    /// −1, 0 or 1.
    public func compare(_ other: BigUInt) -> Int {
        if limbs.count != other.limbs.count { return limbs.count < other.limbs.count ? -1 : 1 }
        var i = limbs.count - 1
        while i >= 0 {
            if limbs[i] != other.limbs[i] { return limbs[i] < other.limbs[i] ? -1 : 1 }
            i -= 1
        }
        return 0
    }

    // MARK: Arithmetic

    public static func + (a: BigUInt, b: BigUInt) -> BigUInt {
        let (long, short) = a.limbs.count >= b.limbs.count ? (a.limbs, b.limbs) : (b.limbs, a.limbs)
        var out = long
        var carry: UInt64 = 0
        var i = 0
        while i < short.count || (carry != 0 && i < out.count) {
            let (s1, o1) = out[i].addingReportingOverflow(i < short.count ? short[i] : 0)
            let (s2, o2) = s1.addingReportingOverflow(carry)
            out[i] = s2
            carry = (o1 ? 1 : 0) + (o2 ? 1 : 0)
            i += 1
        }
        if carry != 0 { out.append(carry) }
        return BigUInt(limbs: out)
    }

    public static func += (a: inout BigUInt, b: BigUInt) { a = a + b }

    /// `a − b`; throws `range` when the result would be negative.
    public static func - (a: BigUInt, b: BigUInt) throws -> BigUInt {
        guard a >= b else { throw fail(.range, "negative BigUInt") }
        var out = a.limbs
        var borrow: UInt64 = 0
        var i = 0
        while i < b.limbs.count || borrow != 0 {
            let (d1, o1) = out[i].subtractingReportingOverflow(i < b.limbs.count ? b.limbs[i] : 0)
            let (d2, o2) = d1.subtractingReportingOverflow(borrow)
            out[i] = d2
            borrow = (o1 ? 1 : 0) + (o2 ? 1 : 0)
            i += 1
        }
        return BigUInt(limbs: out)
    }

    /// `a − b` for callers that already know `a ≥ b`.
    package func minus(_ b: BigUInt) -> BigUInt {
        // A violated precondition is a bug, never a wrap (§1.10).
        guard let d = try? self - b else { preconditionFailure("BigUInt underflow") }
        return d
    }

    /// mulSmall: the product with a 64-bit factor.
    public func multipliedSmall(_ k: UInt64) -> BigUInt {
        if k == 0 || isZero { return BigUInt() }
        var out = [UInt64](repeating: 0, count: limbs.count + 1)
        var carry: UInt64 = 0
        for i in 0..<limbs.count {
            let (hi, lo) = limbs[i].multipliedFullWidth(by: k)
            let (s, o) = lo.addingReportingOverflow(carry)
            out[i] = s
            carry = hi + (o ? 1 : 0)
        }
        out[limbs.count] = carry
        return BigUInt(limbs: out)
    }

    public static func * (a: BigUInt, b: BigUInt) -> BigUInt {
        if a.isZero || b.isZero { return BigUInt() }
        if b.limbs.count == 1 { return a.multipliedSmall(b.limbs[0]) }
        if a.limbs.count == 1 { return b.multipliedSmall(a.limbs[0]) }
        var out = [UInt64](repeating: 0, count: a.limbs.count + b.limbs.count)
        for i in 0..<a.limbs.count {
            var carry: UInt64 = 0
            let ai = a.limbs[i]
            if ai == 0 { continue }
            for j in 0..<b.limbs.count {
                let (hi, lo) = ai.multipliedFullWidth(by: b.limbs[j])
                let (s1, o1) = out[i + j].addingReportingOverflow(lo)
                let (s2, o2) = s1.addingReportingOverflow(carry)
                out[i + j] = s2
                carry = hi + (o1 ? 1 : 0) + (o2 ? 1 : 0)
            }
            out[i + b.limbs.count] = carry
        }
        return BigUInt(limbs: out)
    }

    /// divSmall: quotient and remainder by a nonzero 64-bit divisor.
    public func dividedSmall(_ d: UInt64) -> (quotient: BigUInt, remainder: UInt64) {
        precondition(d != 0, "division by zero")
        if isZero { return (BigUInt(), 0) }
        var out = [UInt64](repeating: 0, count: limbs.count)
        var rem: UInt64 = 0
        var i = limbs.count - 1
        while i >= 0 {
            let (q, r) = d.dividingFullWidth((high: rem, low: limbs[i]))
            out[i] = q
            rem = r
            i -= 1
        }
        return (BigUInt(limbs: out), rem)
    }

    public static func << (a: BigUInt, shift: Int) -> BigUInt {
        guard !a.isZero, shift > 0 else { return a }
        let whole = shift >> 6, part = UInt64(shift & 63)
        var out = [UInt64](repeating: 0, count: whole) + a.limbs + [0]
        if part != 0 {
            var carry: UInt64 = 0
            for i in whole..<out.count {
                let v = out[i]
                out[i] = (v << part) | carry
                carry = v >> (64 - part)
            }
        }
        return BigUInt(limbs: out)
    }

    public static func >> (a: BigUInt, shift: Int) -> BigUInt {
        guard shift > 0 else { return a }
        let whole = shift >> 6, part = UInt64(shift & 63)
        guard whole < a.limbs.count else { return BigUInt() }
        var out = Array(a.limbs[whole...])
        if part != 0 {
            for i in 0..<out.count {
                let next: UInt64 = i + 1 < out.count ? out[i + 1] : 0
                out[i] = (out[i] >> part) | (next << (64 - part))
            }
        }
        return BigUInt(limbs: out)
    }

    /// `base^exponent` by squaring.
    public static func power(_ base: UInt64, _ exponent: Int) -> BigUInt {
        var result = BigUInt(1)
        var b = BigUInt(base)
        var e = exponent
        while e > 0 {
            if e & 1 == 1 { result = result * b }
            e >>= 1
            if e > 0 { b = b * b }
        }
        return result
    }

    // MARK: Text

    /// Decimal digits, exact.
    public var decimal: String {
        if isZero { return "0" }
        var chunks: [UInt64] = []
        var v = self
        while !v.isZero {
            let (q, r) = v.dividedSmall(10_000_000_000_000_000_000)
            chunks.append(r)
            v = q
        }
        var out = String(chunks.removeLast())
        for chunk in chunks.reversed() {
            let s = String(chunk)
            out += String(repeating: "0", count: 19 - s.count) + s
        }
        return out
    }

    public var description: String { decimal }

    /// Lowercase hex without leading zeros; "0" for zero.
    public var hex: String {
        guard let top = limbs.last else { return "0" }
        var out = String(top, radix: 16)
        for limb in limbs.dropLast().reversed() {
            let s = String(limb, radix: 16)
            out += String(repeating: "0", count: 16 - s.count) + s
        }
        return out
    }

    /// Digits in base `f` (2…16), most significant first; empty for zero.
    public func digits(base f: UInt64) -> [UInt8] {
        precondition(f >= 2 && f <= 16)
        if isZero { return [] }
        if f.nonzeroBitCount == 1 {
            let bits = f.trailingZeroBitCount
            let count = (bitWidth + bits - 1) / bits
            var out = [UInt8](repeating: 0, count: count)
            for i in 0..<count {
                var d: UInt8 = 0
                for b in 0..<bits where bit(i * bits + b) { d |= 1 << UInt8(b) }
                out[count - 1 - i] = d
            }
            return out
        }
        // The largest power of f that fits in 64 bits, peeled at a time.
        var chunk: UInt64 = 1, per = 0
        while chunk <= UInt64.max / f { chunk *= f; per += 1 }
        var out: [UInt8] = []
        var v = self
        while !v.isZero {
            var (q, r) = v.dividedSmall(chunk)
            for _ in 0..<per {
                out.append(UInt8(r % f))
                r /= f
                if q.isZero && r == 0 { break }
            }
            v = q
        }
        while let last = out.last, last == 0 { out.removeLast() }
        return out.reversed()
    }

    /// The top 53 bits and the shift that scales them back: value ≈ top × 2^shift.
    var top53: (top: UInt64, shift: Int) {
        let w = bitWidth
        if w <= 53 { return (uint64 ?? 0, 0) }
        let shifted = self >> (w - 53)
        return (shifted.uint64 ?? 0, w - 53)
    }

    /// ln of the value (−∞ for zero), from its top bits: relative error below 2⁻⁵².
    public var naturalLog: Double {
        if isZero { return -.infinity }
        let (top, shift) = top53
        return log(Double(top)) + Double(shift) * 0.693_147_180_559_945_3
    }

    /// The value as a Double, rounded to nearest, ties to even; +∞ beyond the range.
    public var nearestDouble: Double {
        let w = bitWidth
        if w <= 64 { return Double(uint64 ?? 0) }
        // The top 64 bits with a sticky bit for everything below: one correct rounding.
        let shift = w - 64
        var top = (self >> shift).uint64 ?? 0
        if !minus((self >> shift) << shift).isZero { top |= 1 }
        if shift > 1100 { return .infinity }
        return scalbn(Double(top), shift)
    }

    /// The value as a Double, rounded toward zero in its 53 bits; +∞ beyond the range.
    public var double: Double {
        let (top, shift) = top53
        if shift > 1100 { return .infinity }
        return scalbn(Double(top), shift)
    }
}

