import Foundation

// Ports of packages/parsers/src/byteScan.ts and the bits of JavaScript number
// parsing the XYZ parser relies on. Coordinates must round to the same
// Float32 the web stores, or bond cutoffs could flip on a borderline pair.

enum ByteScan {
    static let newline: UInt8 = 10

    /// Space, tab or carriage return: the web parser's token separators.
    @inline(__always) static func isSpace(_ c: UInt8) -> Bool { c == 32 || c == 9 || c == 13 }

    /// 10^0 ... 10^22, all exact in a double (the web builds the same table with Math.pow).
    static let pow10: [Double] = {
        var table: [Double] = [1]
        for _ in 1...22 { table.append(table[table.count - 1] * 10) }
        return table
    }()

    /// `scanFloat`: parses [start, end) as a decimal with an optional exponent,
    /// accumulating the mantissa in a double and dividing by an exact power of
    /// ten, exactly as the web does. NaN for anything malformed.
    static func scanFloat(_ b: UnsafeBufferPointer<UInt8>, _ start: Int, _ end: Int) -> Double {
        var i = start
        @inline(__always) func at(_ k: Int) -> UInt8 { k < end ? b[k] : 0 }
        var c = at(i)
        var negative = false
        if c == 45 {
            negative = true
            i += 1
            c = at(i)
        } else if c == 43 {
            i += 1
            c = at(i)
        }
        var mantissa = 0.0
        var exp10 = 0.0
        var any = false
        while i < end && c >= 48 && c <= 57 {
            mantissa = mantissa * 10 + Double(c - 48)
            any = true
            i += 1
            c = at(i)
        }
        if i < end && c == 46 {
            i += 1
            c = at(i)
            while i < end && c >= 48 && c <= 57 {
                mantissa = mantissa * 10 + Double(c - 48)
                exp10 -= 1
                any = true
                i += 1
                c = at(i)
            }
        }
        if !any { return .nan }
        if i < end && (c == 101 || c == 69) {
            i += 1
            c = at(i)
            var exponentNegative = false
            if c == 45 {
                exponentNegative = true
                i += 1
                c = at(i)
            } else if c == 43 {
                i += 1
                c = at(i)
            }
            var e = 0.0
            var digit = false
            while i < end && c >= 48 && c <= 57 {
                e = e * 10 + Double(c - 48)
                digit = true
                i += 1
                c = at(i)
            }
            if !digit { return .nan }
            exp10 += exponentNegative ? -e : e
        }
        if i != end { return .nan }
        let value: Double
        if exp10 == 0 {
            value = mantissa
        } else if exp10 > 0 {
            value = exp10 <= 22 ? mantissa * pow10[Int(exp10)] : mantissa * pow(10, exp10)
        } else {
            value = exp10 >= -22 ? mantissa / pow10[Int(-exp10)] : mantissa * pow(10, exp10)
        }
        return negative ? -value : value
    }
}

/// JavaScript's whitespace (`\s`, `String.prototype.trim`), so comment keys
/// split exactly where the web splits them.
enum JSText {
    static func isWhitespace(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            true
        default:
            false
        }
    }

    static func trim(_ text: Substring.UnicodeScalarView) -> Substring.UnicodeScalarView {
        var start = text.startIndex
        var end = text.endIndex
        while start < end && isWhitespace(text[start]) { start = text.index(after: start) }
        while end > start && isWhitespace(text[text.index(before: end)]) { end = text.index(before: end) }
        return text[start..<end]
    }

    static func trim(_ text: String) -> String {
        String(String.UnicodeScalarView(trim(Substring(text).unicodeScalars)))
    }

    /// JavaScript's `Number(text)`: NaN when the whole (trimmed) string is not a
    /// number; "" is 0. Covers decimal and exponent forms, Infinity, 0x/0o/0b.
    static func number(_ raw: String) -> Double {
        let text = trim(raw)
        if text.isEmpty { return 0 }
        let scalars = Array(text.unicodeScalars)
        switch text {
        case "Infinity", "+Infinity": return .infinity
        case "-Infinity": return -.infinity
        default: break
        }
        if scalars.count > 2, scalars[0] == "0" {
            let radix: Int?
            switch scalars[1] {
            case "x", "X": radix = 16
            case "o", "O": radix = 8
            case "b", "B": radix = 2
            default: radix = nil
            }
            if let radix {
                var value = 0.0
                for s in scalars[2...] {
                    guard let digit = Int(String(s), radix: radix) else { return .nan }
                    value = value * Double(radix) + Double(digit)
                }
                return value
            }
        }
        // Validate the decimal grammar ourselves; Double(String) also takes "nan", "inf" and hex floats.
        var i = 0
        if i < scalars.count, scalars[i] == "+" || scalars[i] == "-" { i += 1 }
        var digits = 0
        while i < scalars.count, ("0"..."9").contains(scalars[i]) { i += 1; digits += 1 }
        if i < scalars.count, scalars[i] == "." {
            i += 1
            while i < scalars.count, ("0"..."9").contains(scalars[i]) { i += 1; digits += 1 }
        }
        if digits == 0 { return .nan }
        if i < scalars.count, scalars[i] == "e" || scalars[i] == "E" {
            i += 1
            if i < scalars.count, scalars[i] == "+" || scalars[i] == "-" { i += 1 }
            var exponentDigits = 0
            while i < scalars.count, ("0"..."9").contains(scalars[i]) { i += 1; exponentDigits += 1 }
            if exponentDigits == 0 { return .nan }
        }
        if i != scalars.count { return .nan }
        return Double(text) ?? .nan
    }

    /// `Number.isInteger(Number(text))` within [min, max], else nil (`boundedInteger`).
    static func boundedInteger(_ value: String?, min: Int, max: Int) -> Int? {
        guard let value, !trim(value).isEmpty else { return nil }
        let n = number(value)
        guard n.isFinite, n.rounded(.towardZero) == n, n >= Double(min), n <= Double(max) else { return nil }
        return Int(n)
    }

    /// A finite `Number(text)`, else nil (`finiteNumber`).
    static func finiteNumber(_ value: String?) -> Double? {
        guard let value, !trim(value).isEmpty else { return nil }
        let n = number(value)
        return n.isFinite ? n : nil
    }
}
