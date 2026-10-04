import Foundation

/// The error body every Google REST API returns:
/// `{"error": {"code": 400, "message": "…", "status": "…", "errors": [{"reason": …}],
/// "details": [{"@type": "…ErrorInfo", "reason": …}]}}`.
public struct GoogleAPIError: Error, Sendable, Equatable, CustomStringConvertible {
  /// HTTP status (also `error.code`).
  public var httpStatus: Int
  /// `error.message`. Identity Toolkit puts its code here, e.g.
  /// "TOO_MANY_ATTEMPTS_TRY_LATER : Too many unsuccessful login attempts."
  public var message: String
  /// `error.status`, the google.rpc code name, e.g. "FAILED_PRECONDITION".
  public var status: String?
  /// `errors[].reason` and `details[].reason` (ErrorInfo), e.g. "keyInvalid",
  /// "API_KEY_IOS_APP_BLOCKED".
  public var reasons: [String]

  public init(httpStatus: Int, message: String, status: String? = nil, reasons: [String] = []) {
    self.httpStatus = httpStatus
    self.message = message
    self.status = status
    self.reasons = reasons
  }

  /// The code before the first colon of `message`, trimmed (how the Firebase
  /// SDKs read Identity Toolkit errors).
  public var shortCode: String {
    let head = message.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
    return head.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  public var description: String {
    "HTTP \(httpStatus) \(status ?? "-"): \(message)"
  }

  /// Parses an error body; falls back to the raw text when it is not JSON.
  public static func parse(status: Int, body: Data) -> GoogleAPIError {
    struct Envelope: Decodable {
      struct Inner: Decodable {
        struct Reason: Decodable { var reason: String? }
        var code: Int?
        var message: String?
        var status: String?
        var errors: [Reason]?
        var details: [Reason]?
      }
      var error: Inner?
    }
    if let envelope = try? JSONDecoder().decode(Envelope.self, from: body), let inner = envelope.error {
      let reasons = (inner.errors ?? []).compactMap(\.reason) + (inner.details ?? []).compactMap(\.reason)
      return GoogleAPIError(
        httpStatus: status,
        message: inner.message ?? "",
        status: inner.status,
        reasons: reasons
      )
    }
    let text = String(data: body.prefix(512), encoding: .utf8) ?? ""
    return GoogleAPIError(httpStatus: status, message: text)
  }
}

/// JSON helpers shared by the clients: sorted keys so request bodies are
/// byte-stable for tests and logs.
public enum JSONBody {
  public static func encode<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value)
  }
}
