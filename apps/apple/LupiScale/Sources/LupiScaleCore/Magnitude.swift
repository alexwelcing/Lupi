import Foundation

/// An exact non-negative integer with a display base (§5).
///
/// The value is held canonically: plain below 2⁶⁵⁵³⁶, otherwise digit runs
/// in its root base (2 for 2, 4, 8, 16; 3 for 3, 9; else the base itself).
/// Equality and hashing use the canonical value; the display base only
/// chooses how `formatted` prints it. Not `Comparable`: `compare` throws
/// `ScaleError.base` across families (§5.2).
public struct Magnitude: Sendable, Hashable, CustomStringConvertible {
    enum Value: Sendable, Hashable {
        case plain(BigUInt)
        /// Root-base digits, most significant first, canonical, value ≥ 2⁶⁵⁵³⁶.
        case runs(base: UInt8, runs: [DigitRun])
    }

    let value: Value
    public let displayBase: UInt8

    init(value: Value, displayBase: UInt8) {
        self.value = value
        self.displayBase = displayBase
    }

    /// A plain count, display base 10.
    public init(_ value: BigUInt) {
        self = Magnitude.canonical(value, displayBase: 10)
    }

    public init(_ value: Int) { self.init(BigUInt(value)) }

    public static let zero = Magnitude(BigUInt())
    public static let one = Magnitude(BigUInt(1))

    /// `towerCount(s, f, k)`: the base-f digits of s followed by k zeros, display base f (§5.1).
    public static func tower(seedCount: BigUInt, factor: UInt8, levels: BigUInt) -> Magnitude {
        precondition(factor >= 2 && factor <= 16, "factor 2 to 16")
        let r = Runs.rootBase(factor)
        let runs = DigitRuns.merged(Runs.encode(seedCount.digits(base: UInt64(factor))), [DigitRun(digit: 0, length: levels)])
        // A seed's digits never form a long mixed run, so the expansion is O(runs).
        let root = Runs.expand(runs, from: factor, to: r) ?? []
        return canonical(runs: root, base: r, displayBase: factor)
    }

    // MARK: Canonical form

    static func canonical(_ v: BigUInt, displayBase: UInt8) -> Magnitude {
        if v.bitWidth <= BigUInt.maxBits { return Magnitude(value: .plain(v), displayBase: displayBase) }
        let r = Runs.rootBase(displayBase)
        return Magnitude(value: .runs(base: r, runs: Runs.encode(v.digits(base: UInt64(r)))), displayBase: displayBase)
    }

    static func canonical(runs: [DigitRun], base r: UInt8, displayBase: UInt8) -> Magnitude {
        let clean = Runs.normalized(runs)
        if let v = Runs.plainValue(clean, base: r) { return Magnitude(value: .plain(v), displayBase: displayBase) }
        return Magnitude(value: .runs(base: r, runs: clean), displayBase: displayBase)
    }

    /// The same value with another display base.
    public func withDisplayBase(_ f: UInt8) -> Magnitude { Magnitude(value: value, displayBase: f) }

    public static func == (a: Magnitude, b: Magnitude) -> Bool { a.value == b.value }
    public func hash(into h: inout Hasher) { h.combine(value) }

    public var isZero: Bool { if case let .plain(v) = value { return v.isZero }; return false }

    /// `fitsPlain` (§5.2).
    public var fitsPlain: Bool { if case .plain = value { return true }; return false }

    /// `toPlain`: the value when it has at most 65,536 bits.
    public var plain: BigUInt? { if case let .plain(v) = value { return v }; return nil }

    // MARK: Arithmetic (§5.2)

    public static func + (a: Magnitude, b: Magnitude) throws -> Magnitude {
        try combine(a, b, subtract: false)
    }

    /// Throws `range` when the result would be negative.
    public static func - (a: Magnitude, b: Magnitude) throws -> Magnitude {
        try combine(a, b, subtract: true)
    }

    private static func combine(_ a: Magnitude, _ b: Magnitude, subtract: Bool) throws -> Magnitude {
        switch (a.value, b.value) {
        case let (.plain(x), .plain(y)):
            return canonical(subtract ? try x - y : x + y, displayBase: a.displayBase)
        default:
            let (x, y, r) = try alignFamilies(a, b)
            let out = subtract ? try Runs.subtract(x, y, base: r) : Runs.add(x, y, base: r)
            return canonical(runs: out, base: r, displayBase: a.displayBase)
        }
    }

    /// Both operands as root-base runs of one family; throws `base` across families.
    private static func alignFamilies(_ a: Magnitude, _ b: Magnitude) throws -> ([DigitRun], [DigitRun], UInt8) {
        switch (a.value, b.value) {
        case let (.runs(ra, xa), .runs(rb, xb)):
            guard ra == rb else { throw fail(.base, "values above 2^65536 in different families") }
            return (xa, xb, ra)
        case let (.runs(r, x), .plain(v)):
            return (x, Runs.encode(v.digits(base: UInt64(r))), r)
        case let (.plain(v), .runs(r, x)):
            return (Runs.encode(v.digits(base: UInt64(r))), x, r)
        case let (.plain(v), .plain(w)):
            let r = Runs.rootBase(a.displayBase)
            return (Runs.encode(v.digits(base: UInt64(r))), Runs.encode(w.digits(base: UInt64(r))), r)
        }
    }

    /// −1, 0 or 1; throws `base` for two values above 2⁶⁵⁵³⁶ in different families.
    public func compare(_ other: Magnitude) throws -> Int {
        switch (value, other.value) {
        case let (.plain(x), .plain(y)): return x.compare(y)
        case (.runs, .plain): return 1
        case (.plain, .runs): return -1
        case let (.runs(ra, x), .runs(rb, y)):
            guard ra == rb else { throw fail(.base, "values above 2^65536 in different families") }
            return Runs.compare(x, y)
        }
    }

    /// `mulSmall(k)`: repeated doubling, O(runs × bits of k).
    public func multiplied(by k: BigUInt) throws -> Magnitude {
        if case let .plain(v) = value { return Magnitude.canonical(v * k, displayBase: displayBase) }
        var result = Magnitude(value: .plain(BigUInt()), displayBase: displayBase)
        var x = self
        for i in 0..<k.bitWidth {
            if k.bit(i) { result = try result + x }
            if i + 1 < k.bitWidth { x = try x + x }
        }
        return result
    }

    // MARK: Digits in the display base

    /// The base the value prints in: the display base when the value is in its family, else the value's root base.
    var effectiveBase: UInt8 {
        if case let .runs(r, _) = value, Runs.rootBase(displayBase) != r { return r }
        return displayBase
    }

    /// The value's digits in `base` as runs, MSD first. `base` must be in the value's family when the value is runs.
    func digitRuns(in base: UInt8) -> [DigitRun] {
        switch value {
        case let .plain(v): return Runs.encode(base == 10 ? decimalDigits(v) : v.digits(base: UInt64(base)))
        case let .runs(r, x): return Runs.group(x, from: r, to: base)
        }
    }

    private func decimalDigits(_ v: BigUInt) -> [UInt8] {
        v.isZero ? [] : v.decimal.utf8.map { $0 - 48 }
    }

    public var description: String { formatted }

    // MARK: Logarithms (§5.5) [V]

    /// `ln M` = N · ln f + ln c in binary64, from the leading 16 digits; +∞ when it overflows.
    public var lnM: Double {
        let (n, c, f) = leadingDigits()
        if n.isZero { return -.infinity }
        let N = n > 16 ? n.minus(16) : BigUInt()
        let v = N.double * log(Double(f)) + log(Double(c))
        return v.isNaN ? .infinity : v
    }

    /// `ln ln M`, finite for every v1 value ≥ 3.
    public var lnlnM: Double {
        let (n, c, f) = leadingDigits()
        if n.isZero { return .nan }
        let lnf = log(Double(f))
        let N = n > 16 ? n.minus(16) : BigUInt()
        if N.bitWidth <= 53 {
            let inner = N.double + log(Double(c)) / lnf
            return log(lnf) + log(inner)
        }
        return log(lnf) + N.naturalLog
    }

    /// `ln(self / other)` in binary64 [V]: the digit counts are subtracted exactly before any
    /// rounding, so the ratio of two values far beyond binary64 (two pieces of a googolplex) is
    /// as good as that of small ones. Values in different base families fall back to `lnM`.
    public func lnRatio(_ other: Magnitude) -> Double {
        let f: UInt8
        switch (value, other.value) {
        case let (.runs(r, _), .runs(q, _)):
            guard r == q else { return lnM - other.lnM }
            f = effectiveBase
        case (.runs, .plain): f = effectiveBase
        case (.plain, .runs): f = other.effectiveBase
        case (.plain, .plain): f = 10
        }
        let a = leadingDigits(in: f), b = other.leadingDigits(in: f)
        if a.n.isZero || b.n.isZero { return lnM - other.lnM }
        // value ≈ c · f^(n − min(n, 16))
        let na = a.n > 16 ? a.n.minus(16) : BigUInt(), nb = b.n > 16 ? b.n.minus(16) : BigUInt()
        let shift = na >= nb ? na.minus(nb).double : -nb.minus(na).double
        return shift * log(Double(f)) + log(Double(a.c)) - log(Double(b.c))
    }

    /// (digit count, leading min(n, 16) digits as an integer, base), in the effective base.
    private func leadingDigits() -> (n: BigUInt, c: UInt64, base: UInt8) { leadingDigits(in: effectiveBase) }

    private func leadingDigits(in f: UInt8) -> (n: BigUInt, c: UInt64, base: UInt8) {
        let runs = digitRuns(in: f)
        let n = DigitRuns.count(runs)
        var c: UInt64 = 0
        var taken = 0
        outer: for run in runs {
            let take = min(16 - taken, run.length.int ?? 16)
            for _ in 0..<take {
                c = c * UInt64(f) + UInt64(run.digit)
                taken += 1
                if taken == 16 { break outer }
            }
        }
        return (n, c, f)
    }

    /// `log10 M`.
    public var log10M: Double { lnM / log(10) }
}

/// Digit-run arithmetic in one base, least significant segment first (§5.2).
enum Runs {
    static func rootBase(_ f: UInt8) -> UInt8 {
        switch f {
        case 2, 4, 8, 16: 2
        case 3, 9: 3
        default: f
        }
    }

    /// The exponent j with f = r^j.
    static func exponent(_ f: UInt8, root r: UInt8) -> Int {
        var j = 0, v = 1
        while v < Int(f) { v *= Int(r); j += 1 }
        precondition(v == Int(f), "\(f) is not a power of \(r)")
        return j
    }

    /// Run-length codes a digit list (MSD first).
    static func encode(_ digits: [UInt8]) -> [DigitRun] {
        var out: [DigitRun] = []
        var i = 0
        while i < digits.count {
            var j = i + 1
            while j < digits.count && digits[j] == digits[i] { j += 1 }
            out.append(DigitRun(digit: digits[i], length: BigUInt(j - i)))
            i = j
        }
        return normalized(out)
    }

    /// Merged neighbours, no empty runs, no leading zeros.
    static func normalized(_ runs: [DigitRun]) -> [DigitRun] {
        var out = DigitRuns.merged([], runs)
        if let first = out.first, first.digit == 0 { out.removeFirst() }
        return out
    }

    /// The largest digit count a value below 2⁶⁵⁵³⁶ can have in base r, give or take one.
    private static func plainDigitBound(_ r: UInt8) -> Int {
        Int((Double(BigUInt.maxBits) * log(2) / log(Double(r))).rounded(.down)) + 1
    }

    /// The plain value of root-base runs when it is below 2⁶⁵⁵³⁶, else nil.
    static func plainValue(_ runs: [DigitRun], base r: UInt8) -> BigUInt? {
        let n = DigitRuns.count(runs)
        guard let digits = n.int, digits <= plainDigitBound(r) + 1 else { return nil }
        var v = BigUInt()
        if r == 2 {
            for run in runs {
                let len = run.length.int!
                v = v << len
                if run.digit == 1 { v += (BigUInt(1) << len).minus(1) }
            }
            return v.bitWidth <= BigUInt.maxBits ? v : nil
        }
        for run in runs {
            let len = run.length.int!
            let rn = BigUInt.power(UInt64(r), len)
            v = v * rn
            if run.digit != 0 {
                // d · (r^n − 1) / (r − 1): a repunit of the digit.
                let repunit = rn.minus(1).dividedSmall(UInt64(r) - 1).quotient
                v += repunit.multipliedSmall(UInt64(run.digit))
            }
        }
        return v.bitWidth <= BigUInt.maxBits ? v : nil
    }

    /// Base r^j runs as base r runs. nil when a long run of a mixed digit would cost more than O(runs).
    static func expand(_ runs: [DigitRun], from f: UInt8, to r: UInt8) -> [DigitRun]? {
        if f == r { return runs }
        let j = exponent(f, root: r)
        var out: [DigitRun] = []
        for run in runs {
            var pattern = [UInt8](repeating: 0, count: j)
            var d = Int(run.digit)
            for i in stride(from: j - 1, through: 0, by: -1) {
                pattern[i] = UInt8(d % Int(r))
                d /= Int(r)
            }
            if pattern.allSatisfy({ $0 == pattern[0] }) {
                out = DigitRuns.merged(out, [DigitRun(digit: pattern[0], length: run.length.multipliedSmall(UInt64(j)))])
            } else {
                guard let n = run.length.int, n <= 4096 else { return nil }
                for _ in 0..<n { out = DigitRuns.merged(out, patternRuns(pattern)) }
            }
        }
        return out
    }

    private static func patternRuns(_ pattern: [UInt8]) -> [DigitRun] {
        var out: [DigitRun] = []
        for d in pattern { out = DigitRuns.merged(out, [DigitRun(digit: d, length: 1)]) }
        return out
    }

    /// Base r runs grouped into base r^j digits, from the least significant end. O(runs × j).
    static func group(_ runs: [DigitRun], from r: UInt8, to f: UInt8) -> [DigitRun] {
        if f == r { return runs }
        let j = exponent(f, root: r)
        var out: [DigitRun] = []          // LSD first
        var chunk = 0, filled = 0, scale = 1
        func push(_ d: Int, _ n: BigUInt) {
            if n.isZero { return }
            if let last = out.last, Int(last.digit) == d {
                out[out.count - 1].length = last.length + n
            } else {
                out.append(DigitRun(digit: UInt8(d), length: n))
            }
        }
        for run in runs.reversed() {
            var left = run.length
            let d = Int(run.digit)
            // Fill the open chunk.
            while filled > 0 && filled < j && !left.isZero {
                chunk += d * scale
                scale *= Int(r)
                filled += 1
                left = left.minus(1)
            }
            if filled == j {
                push(chunk, 1)
                chunk = 0; filled = 0; scale = 1
            }
            if left.isZero { continue }
            // Whole chunks of this digit.
            let (q, rem) = left.dividedSmall(UInt64(j))
            var whole = 0, p = 1
            for _ in 0..<j { whole += d * p; p *= Int(r) }
            push(whole, q)
            for _ in 0..<Int(rem) {
                chunk += d * scale
                scale *= Int(r)
                filled += 1
            }
        }
        if filled > 0 { push(chunk, 1) }
        return normalized(out.reversed())
    }

    /// Aligns two LSD-first run lists into segments of constant digits.
    private static func segments(_ a: [DigitRun], _ b: [DigitRun]) -> [(x: Int, y: Int, n: BigUInt)] {
        var ra = Array(a.reversed()), rb = Array(b.reversed())
        var i = 0, j = 0
        var out: [(Int, Int, BigUInt)] = []
        while i < ra.count || j < rb.count {
            let x = i < ra.count ? Int(ra[i].digit) : 0
            let y = j < rb.count ? Int(rb[j].digit) : 0
            let n: BigUInt
            if i >= ra.count { n = rb[j].length } else if j >= rb.count { n = ra[i].length } else { n = min(ra[i].length, rb[j].length) }
            out.append((x, y, n))
            if i < ra.count {
                ra[i].length = ra[i].length.minus(n)
                if ra[i].length.isZero { i += 1 }
            }
            if j < rb.count {
                rb[j].length = rb[j].length.minus(n)
                if rb[j].length.isZero { j += 1 }
            }
        }
        return out
    }

    private static func combine(_ a: [DigitRun], _ b: [DigitRun], base r: UInt8, sign: Int) throws -> [DigitRun] {
        let f = Int(r)
        var out: [DigitRun] = []      // LSD first
        var carry = 0
        func push(_ d: Int, _ n: BigUInt) {
            if let last = out.last, Int(last.digit) == d {
                out[out.count - 1].length = last.length + n
            } else {
                out.append(DigitRun(digit: UInt8(d), length: n))
            }
        }
        for (x, y, n) in segments(a, b) {
            var left = n
            // Within a constant segment the carry settles after at most one position.
            while !left.isZero {
                let s = sign > 0 ? x + y + carry : x - y - carry
                let digit = ((s % f) + f) % f
                let next = sign > 0 ? (s >= f ? 1 : 0) : (s < 0 ? 1 : 0)
                if next == carry {
                    push(digit, left)
                    left = BigUInt()
                } else {
                    push(digit, 1)
                    left = left.minus(1)
                    carry = next
                }
            }
        }
        if carry != 0 {
            if sign < 0 { throw fail(.range, "negative magnitude") }
            push(1, 1)
        }
        return normalized(out.reversed())
    }

    static func add(_ a: [DigitRun], _ b: [DigitRun], base r: UInt8) -> [DigitRun] {
        (try? combine(a, b, base: r, sign: 1)) ?? []
    }

    static func subtract(_ a: [DigitRun], _ b: [DigitRun], base r: UInt8) throws -> [DigitRun] {
        try combine(a, b, base: r, sign: -1)
    }

    /// Canonical runs of one base: by digit count, then from the most significant digit.
    static func compare(_ a: [DigitRun], _ b: [DigitRun]) -> Int {
        let la = DigitRuns.count(a), lb = DigitRuns.count(b)
        if la != lb { return la < lb ? -1 : 1 }
        var i = 0, j = 0
        var ra = a, rb = b
        while i < ra.count && j < rb.count {
            if ra[i].digit != rb[j].digit { return ra[i].digit < rb[j].digit ? -1 : 1 }
            let n = min(ra[i].length, rb[j].length)
            ra[i].length = ra[i].length.minus(n)
            rb[j].length = rb[j].length.minus(n)
            if ra[i].length.isZero { i += 1 }
            if rb[j].length.isZero { j += 1 }
        }
        return 0
    }
}
