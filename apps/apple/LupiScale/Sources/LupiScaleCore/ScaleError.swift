/// The error codes of scale-spec §4.7, with `base` (§5.2) and the pack
/// rejections of §6.6 (`pack`, `crc`).
///
/// Two errors are equal when their codes are: the detail is for people, and
/// tests compare codes (`#expect(throws: ScaleError.path) { … }`).
public struct ScaleError: Error, Sendable, Equatable, CustomStringConvertible {
    public enum Code: String, Sendable, CaseIterable {
        case truncated, canonical, range, limit, magic, version
        case missing, unsupported, path, validity, materialize, mismatch
        case base, pack, crc
    }

    public let code: Code
    public let detail: String

    public init(_ code: Code, _ detail: String = "") {
        self.code = code
        self.detail = detail
    }

    public var description: String { detail.isEmpty ? code.rawValue : "\(code.rawValue): \(detail)" }

    public static func == (a: ScaleError, b: ScaleError) -> Bool { a.code == b.code }

    public static let truncated = ScaleError(.truncated)
    public static let canonical = ScaleError(.canonical)
    public static let range = ScaleError(.range)
    public static let limit = ScaleError(.limit)
    public static let magic = ScaleError(.magic)
    public static let version = ScaleError(.version)
    public static let missing = ScaleError(.missing)
    public static let unsupported = ScaleError(.unsupported)
    public static let path = ScaleError(.path)
    public static let validity = ScaleError(.validity)
    public static let materialize = ScaleError(.materialize)
    public static let mismatch = ScaleError(.mismatch)
    public static let base = ScaleError(.base)
    public static let pack = ScaleError(.pack)
    public static let crc = ScaleError(.crc)
}

@inline(__always)
func fail(_ code: ScaleError.Code, _ detail: @autoclosure () -> String = "") -> ScaleError {
    ScaleError(code, detail())
}
