import Foundation

/// A Firestore Timestamp: seconds and nanoseconds since 1970 UTC. Kept apart
/// from Date so values survive a round trip exactly; Firestore itself stores
/// microseconds and rounds anything finer down.
public struct FirestoreTimestamp: Sendable, Hashable, Comparable, Codable, CustomStringConvertible {
  public var seconds: Int64
  /// 0 ..< 1_000_000_000.
  public var nanos: Int32

  public init(seconds: Int64, nanos: Int32 = 0) {
    precondition(nanos >= 0 && nanos < 1_000_000_000, "nanos out of range")
    self.seconds = seconds
    self.nanos = nanos
  }

  /// Truncates to whole microseconds, Firestore's storage precision, so a
  /// value read back equals the value written.
  public init(date: Date) {
    let micros = (date.timeIntervalSince1970 * 1_000_000).rounded(.down)
    let wholeSeconds = (micros / 1_000_000).rounded(.down)
    seconds = Int64(wholeSeconds)
    nanos = Int32((micros - wholeSeconds * 1_000_000).rounded()) * 1000
  }

  public var date: Date {
    Date(timeIntervalSince1970: TimeInterval(seconds) + TimeInterval(nanos) / 1e9)
  }

  public func adding(seconds delta: TimeInterval) -> FirestoreTimestamp {
    FirestoreTimestamp(date: date.addingTimeInterval(delta))
  }

  public static func < (lhs: FirestoreTimestamp, rhs: FirestoreTimestamp) -> Bool {
    (lhs.seconds, lhs.nanos) < (rhs.seconds, rhs.nanos)
  }

  public static let epoch = FirestoreTimestamp(seconds: 0)

  // MARK: RFC 3339

  /// Z-normalized with 0, 3, 6 or 9 fractional digits, as Google emits.
  public var rfc3339: String {
    let days = seconds >= 0 ? seconds / 86_400 : (seconds - 86_399) / 86_400
    let secondOfDay = seconds - days * 86_400
    let (year, month, day) = Self.civil(fromDays: days)
    var text = String(
      format: "%04lld-%02lld-%02lldT%02lld:%02lld:%02lld",
      year, month, day, secondOfDay / 3600, secondOfDay / 60 % 60, secondOfDay % 60
    )
    if nanos != 0 {
      if nanos % 1_000_000 == 0 {
        text += String(format: ".%03d", nanos / 1_000_000)
      } else if nanos % 1000 == 0 {
        text += String(format: ".%06d", nanos / 1000)
      } else {
        text += String(format: ".%09d", nanos)
      }
    }
    return text + "Z"
  }

  public var description: String { rfc3339 }

  /// Parses `YYYY-MM-DDTHH:MM:SS[.f{1,9}](Z|±HH:MM)`.
  public init?(rfc3339 text: String) {
    let chars = Array(text.utf8)
    var index = 0
    func number(_ width: Int) -> Int64? {
      guard index + width <= chars.count else { return nil }
      var value: Int64 = 0
      for offset in 0..<width {
        let c = chars[index + offset]
        guard c >= 48 && c <= 57 else { return nil }
        value = value * 10 + Int64(c - 48)
      }
      index += width
      return value
    }
    func expect(_ allowed: [UInt8]) -> Bool {
      guard index < chars.count, allowed.contains(chars[index]) else { return false }
      index += 1
      return true
    }
    guard let year = number(4), expect([45]), let month = number(2), expect([45]), let day = number(2),
      expect([84, 116]), let hour = number(2), expect([58]), let minute = number(2), expect([58]),
      let second = number(2)
    else { return nil }
    guard (1...12).contains(month), (1...31).contains(day), hour < 24, minute < 60, second < 61 else { return nil }
    var nanos: Int64 = 0
    if index < chars.count, chars[index] == 46 {
      index += 1
      var digits = 0
      while index < chars.count, chars[index] >= 48, chars[index] <= 57 {
        if digits < 9 { nanos = nanos * 10 + Int64(chars[index] - 48) }
        digits += 1
        index += 1
      }
      guard digits > 0 else { return nil }
      for _ in min(digits, 9)..<9 { nanos *= 10 }
    }
    var offset: Int64 = 0
    guard index < chars.count else { return nil }
    if chars[index] == 90 || chars[index] == 122 {
      index += 1
    } else if chars[index] == 43 || chars[index] == 45 {
      let sign: Int64 = chars[index] == 45 ? -1 : 1
      index += 1
      guard let offsetHours = number(2), expect([58]), let offsetMinutes = number(2) else { return nil }
      offset = sign * (offsetHours * 3600 + offsetMinutes * 60)
    } else {
      return nil
    }
    guard index == chars.count else { return nil }
    let days = Self.days(fromCivil: year, month, day)
    self.init(seconds: days * 86_400 + hour * 3600 + minute * 60 + min(second, 59) - offset, nanos: Int32(nanos))
  }

  public init(from decoder: any Decoder) throws {
    let text = try decoder.singleValueContainer().decode(String.self)
    guard let value = FirestoreTimestamp(rfc3339: text) else {
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "not an RFC 3339 timestamp: \(text)")
      )
    }
    self = value
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(rfc3339)
  }

  // Howard Hinnant's days-from-civil algorithms (proleptic Gregorian).
  static func days(fromCivil year: Int64, _ month: Int64, _ day: Int64) -> Int64 {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146_097 + doe - 719_468
  }

  static func civil(fromDays days: Int64) -> (Int64, Int64, Int64) {
    let z = days + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let doe = z - era * 146_097
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let day = doy - (153 * mp + 2) / 5 + 1
    let month = mp < 10 ? mp + 3 : mp - 9
    return (yoe + era * 400 + (month <= 2 ? 1 : 0), month, day)
  }
}
