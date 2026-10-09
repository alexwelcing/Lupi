import Foundation

/// JSON as Lupi's records write it: sorted keys, slashes unescaped (so a URL
/// reads as one), dates as RFC 3339 UTC with
/// milliseconds ("2026-10-04T21:19:00.123Z", what JavaScript's toISOString
/// writes). Dates decode with or without fractional seconds and with any
/// offset. Hand-rolled so every platform reads and writes the same text.
public enum LupiJSON {
    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(RFC3339.string(from: date))
        }
        return encoder
    }

    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            guard let date = RFC3339.date(from: text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "not an RFC 3339 date: \(text)")
            }
            return date
        }
        return decoder
    }
}

public enum RFC3339 {
    /// UTC with milliseconds, rounded to the nearest millisecond.
    public static func string(from date: Date) -> String {
        let millis = Int64((date.timeIntervalSince1970 * 1000).rounded())
        var days = millis / 86_400_000
        var rest = millis % 86_400_000
        if rest < 0 {
            rest += 86_400_000
            days -= 1
        }
        let (y, m, d) = civil(fromDays: days)
        let ms = rest % 1000
        let s = (rest / 1000) % 60
        let min = (rest / 60_000) % 60
        let h = rest / 3_600_000
        return "\(pad(y, 4))-\(pad(m, 2))-\(pad(d, 2))T\(pad(h, 2)):\(pad(min, 2)):\(pad(s, 2)).\(pad(ms, 3))Z"
    }

    /// `YYYY-MM-DDTHH:MM:SS[.fff…](Z|±HH:MM)`; nil for anything else.
    public static func date(from text: String) -> Date? {
        let c = Array(text.utf8)
        func digits(_ start: Int, _ count: Int) -> Int64? {
            guard start + count <= c.count else { return nil }
            var value: Int64 = 0
            for k in start..<(start + count) {
                guard c[k] >= 48 && c[k] <= 57 else { return nil }
                value = value * 10 + Int64(c[k] - 48)
            }
            return value
        }
        guard c.count >= 20, c[4] == 45, c[7] == 45, c[10] == 84 || c[10] == 116, c[13] == 58, c[16] == 58,
              let y = digits(0, 4), let mo = digits(5, 2), let d = digits(8, 2),
              let h = digits(11, 2), let mi = digits(14, 2), let s = digits(17, 2),
              (1...12).contains(mo), (1...31).contains(d), h < 24, mi < 60, s < 61 else { return nil }
        var i = 19
        var fraction = 0.0
        if i < c.count, c[i] == 46 {
            i += 1
            var scale = 0.1
            let start = i
            while i < c.count, c[i] >= 48 && c[i] <= 57 {
                fraction += Double(c[i] - 48) * scale
                scale /= 10
                i += 1
            }
            if i == start { return nil }
        }
        guard i < c.count else { return nil }
        var offset: Int64 = 0
        if c[i] == 90 || c[i] == 122 {
            i += 1
        } else if c[i] == 43 || c[i] == 45, let oh = digits(i + 1, 2), i + 3 < c.count, c[i + 3] == 58,
                  let om = digits(i + 4, 2) {
            offset = (oh * 60 + om) * 60 * (c[i] == 45 ? -1 : 1)
            i += 6
        } else {
            return nil
        }
        guard i == c.count else { return nil }
        let days = daysFromCivil(y, mo, d)
        let seconds = days * 86_400 + h * 3600 + mi * 60 + s - offset
        // Round to the millisecond so a decoded date re-encodes to the same text.
        let millis = (fraction * 1000).rounded()
        return Date(timeIntervalSince1970: Double(seconds) + millis / 1000)
    }

    /// Days since 1970-01-01 (Howard Hinnant's days_from_civil).
    static func daysFromCivil(_ year: Int64, _ month: Int64, _ day: Int64) -> Int64 {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    static func civil(fromDays z0: Int64) -> (Int64, Int64, Int64) {
        let z = z0 + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (m <= 2 ? 1 : 0), m, d)
    }

    private static func pad(_ value: Int64, _ width: Int) -> String {
        let text = String(value)
        return text.count >= width ? text : String(repeating: "0", count: width - text.count) + text
    }
}
