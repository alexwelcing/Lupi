import Foundation

/// `format(M)` (§5.4): one function for every surface. It reads digit runs and
/// never forms a long digit string.
extension Magnitude {
    public var formatted: String {
        if case let .plain(v) = value, v < MagnitudeFormat.ten15 {
            return MagnitudeFormat.grouped(v.decimal)
        }
        let f = effectiveBase
        if f != 10 { return MagnitudeFormat.otherBase(self, f) }
        return MagnitudeFormat.decimal(digitRuns(in: 10))
    }
}

enum MagnitudeFormat {
    static let ten15 = BigUInt(1_000_000_000_000_000)
    static let times = " \u{00D7} "
    static let minus = " \u{2212} "
    static let approx = "\u{2248} "

    /// A comma every three digits from the right.
    static func grouped(_ digits: String) -> String {
        var out = ""
        let chars = Array(digits)
        for (i, ch) in chars.enumerated() {
            if i > 0 && (chars.count - i) % 3 == 0 { out.append(",") }
            out.append(ch)
        }
        return out
    }

    /// `E(k)`: plain digits below 10¹⁵, otherwise the formatted exponent in parentheses.
    static func exponent(_ k: BigUInt) -> String {
        k < ten15 ? k.decimal : "(" + Magnitude(k).formatted + ")"
    }

    /// Rule 2's printing of `c × 10^K`, with c not divisible by 10.
    static func scientific(_ c: UInt64, _ k: BigUInt) -> String {
        let cs = String(c)
        if cs == "1" { return "10^" + exponent(k) }
        let mantissa = cs.count == 1 ? cs : String(cs.first!) + "." + cs.dropFirst()
        return mantissa + times + "10^" + exponent(k)
    }

    /// A binary64 value in [1, 16) to four significant digits, half to even on its exact value.
    static func fourSignificant(_ m: Double) -> String {
        var decimals = 3 - Int(log10(m).rounded(.down))
        var text = String(format: "%.\(max(decimals, 0))f", m)
        // Rounding up to the next power of ten adds a digit: print one decimal fewer.
        if let v = Double(text), v >= pow(10, Double(4 - decimals)) {
            decimals -= 1
            text = String(format: "%.\(max(decimals, 0))f", m)
        }
        return text
    }

    static func stripZeros(_ c: UInt64) -> UInt64 {
        var v = c
        while v > 0 && v % 10 == 0 { v /= 10 }
        return v
    }

    /// Digits [start, start + count) of MSD-first runs.
    static func digits(_ runs: [DigitRun], from start: BigUInt, count: Int) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(count)
        let end = start + BigUInt(count)
        var pos = BigUInt()
        for run in runs {
            let a = pos, b = pos + run.length
            pos = b
            if b <= start { continue }
            if a >= end { break }
            let from = max(a, start), to = min(b, end)
            out.append(contentsOf: repeatElement(run.digit, count: to.minus(from).int!))
        }
        return out
    }

    static func value(_ digits: [UInt8]) -> UInt64 {
        digits.reduce(UInt64(0)) { $0 * 10 + UInt64($1) }
    }

    /// Every digit in [start, end) equals `digit` (true when the range is empty).
    static func all(_ runs: [DigitRun], from start: BigUInt, to end: BigUInt, equal digit: UInt8) -> Bool {
        var pos = BigUInt()
        for run in runs {
            let a = pos, b = pos + run.length
            pos = b
            if b <= start || a >= end { continue }
            if run.digit != digit { return false }
        }
        return true
    }

    /// §5.4.1, on decimal runs of a value ≥ 10¹⁵.
    static func decimal(_ d: [DigitRun]) -> String {
        let len = DigitRuns.count(d)
        let k = len.minus(1)
        // 2. Round.
        let z = d.last.map { $0.digit == 0 ? $0.length : BigUInt() } ?? BigUInt()
        let significant = len.minus(z)
        if significant <= BigUInt(15) {
            let c = value(digits(d, from: BigUInt(), count: significant.int!))
            return scientific(c, k)
        }
        // 3. Medium.
        if len <= BigUInt(24) { return grouped(String(decoding: digits(d, from: BigUInt(), count: len.int!).map { $0 + 48 }, as: UTF8.self)) }
        // 4. Near a round number.
        let c15 = value(digits(d, from: BigUInt(), count: 15))
        let t = len.minus(15)
        let w = min(t, BigUInt(15)).int!
        let tailStart = len.minus(BigUInt(w))
        let tail = value(digits(d, from: tailStart, count: w))
        if all(d, from: BigUInt(15), to: tailStart, equal: 0) {
            let head = stripZeros(c15)
            if tail > 0 && head < 10_000 { return scientific(head, k) + " + " + grouped(String(tail)) }
        }
        if all(d, from: BigUInt(15), to: tailStart, equal: 9) {
            var pow10: UInt64 = 1
            for _ in 0..<w { pow10 *= 10 }
            let r = pow10 - tail
            var h = c15 + 1
            var hk = k
            if h == 1_000_000_000_000_000 {
                h = 1
                hk = k + 1
            }
            let head = stripZeros(h)
            if r > 0 && r < 1_000_000_000_000_000 && head < 10_000 { return scientific(head, hk) + minus + grouped(String(r)) }
        }
        // 5. Approximate: four digits, half to even on the exact digit string.
        var h = value(digits(d, from: BigUInt(), count: 4))
        let fifth = digits(d, from: BigUInt(4), count: 1)[0]
        let restNonzero = !all(d, from: BigUInt(5), to: len, equal: 0)
        var kk = k
        if fifth > 5 || (fifth == 5 && (restNonzero || h % 2 == 1)) { h += 1 }
        if h == 10_000 {
            h = 1_000
            kk = k + 1
        }
        let hs = String(h)
        return approx + String(hs.first!) + "." + hs.dropFirst() + times + "10^" + exponent(kk)
    }

    /// §5.4.2: display base f ≠ 10, value ≥ 10¹⁵.
    static func otherBase(_ m: Magnitude, _ f: UInt8) -> String {
        let runs = m.digitRuns(in: f)
        let len = DigitRuns.count(runs)
        // 1. c followed by z zeros, c < 10^15.
        let z = runs.last.map { $0.digit == 0 ? $0.length : BigUInt() } ?? BigUInt()
        var c: UInt64 = 0
        var exact = true
        loop: for run in runs.dropLast(z.isZero ? 0 : 1) {
            guard let n = run.length.int, n <= 64 else { exact = false; break }
            for _ in 0..<n {
                let (p, o1) = c.multipliedReportingOverflow(by: UInt64(f))
                let (s, o2) = p.addingReportingOverflow(UInt64(run.digit))
                if o1 || o2 || s >= 1_000_000_000_000_000 { exact = false; break loop }
                c = s
            }
        }
        if exact {
            let power = "\(f)^" + exponent(z)
            return c == 1 ? power : grouped(String(c)) + times + power
        }
        // 2. Plain values print in decimal.
        if let v = m.plain { return decimal(Runs.encode(v.decimal.utf8.map { $0 - 48 })) }
        // 3. Leading 16 digits, approximately.
        var lead: UInt64 = 0
        for digit in digits(runs, from: BigUInt(), count: 16) { lead = lead * UInt64(f) + UInt64(digit) }
        var k = len.minus(16)
        while lead > 0 && lead % UInt64(f) == 0 {
            lead /= UInt64(f)
            k += 1
        }
        return approx + grouped(String(lead)) + times + "\(f)^" + exponent(k)
    }
}
