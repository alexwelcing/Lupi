import Foundation
import LupiHTTP

/// A transport that records every request and answers from a handler, for
/// checking exact request shapes.
public actor ScriptedTransport: HTTPTransport {
  public typealias Handler = @Sendable (HTTPRequest) async throws -> HTTPResponse

  public private(set) var requests: [HTTPRequest] = []
  private var handler: Handler
  private var queued: [HTTPResponse] = []

  public init(handler: @escaping Handler = { _ in HTTPResponse(status: 200, body: Data("{}".utf8)) }) {
    self.handler = handler
  }

  /// Answers the next requests with these, in order, before the handler.
  public func enqueue(_ responses: HTTPResponse...) {
    queued.append(contentsOf: responses)
  }

  public func setHandler(_ handler: @escaping Handler) {
    self.handler = handler
  }

  public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    requests.append(request)
    if !queued.isEmpty {
      return queued.removeFirst()
    }
    return try await handler(request)
  }

  public var lastRequest: HTTPRequest? { requests.last }
}

extension HTTPResponse {
  /// A JSON response from a literal.
  public static func json(_ status: Int = 200, _ text: String) -> HTTPResponse {
    HTTPResponse(status: status, headers: ["content-type": "application/json"], body: Data(text.utf8))
  }

  /// A Google API error body.
  public static func googleError(
    _ status: Int,
    message: String,
    rpcStatus: String? = nil,
    reasons: [String] = []
  ) -> HTTPResponse {
    var inner: [String: Any] = ["code": status, "message": message]
    if let rpcStatus { inner["status"] = rpcStatus }
    if !reasons.isEmpty {
      inner["errors"] = reasons.map { ["domain": "global", "reason": $0, "message": message] }
    }
    let body = (try? JSONSerialization.data(withJSONObject: ["error": inner], options: [.sortedKeys])) ?? Data()
    return HTTPResponse(status: status, headers: ["content-type": "application/json"], body: body)
  }
}

/// Unsigned JWTs shaped like Apple's identity token, for the fakes and the
/// Auth emulator (which accepts unsigned tokens).
public enum FakeAppleIDToken {
  public static func make(
    sub: String,
    nonceHash: String?,
    audience: String = "live.lupi.app",
    email: String? = nil,
    issuedAt: Date = Date()
  ) -> String {
    var claims: [String: Any] = [
      "iss": "https://appleid.apple.com",
      "aud": audience,
      "sub": sub,
      "iat": Int(issuedAt.timeIntervalSince1970),
      "exp": Int(issuedAt.timeIntervalSince1970) + 600,
    ]
    if let nonceHash { claims["nonce"] = nonceHash }
    if let email { claims["email"] = email }
    let header = base64url(Data(#"{"alg":"none","typ":"JWT"}"#.utf8))
    let payload = base64url((try? JSONSerialization.data(withJSONObject: claims, options: [.sortedKeys])) ?? Data())
    return "\(header).\(payload)."
  }

  /// The claims of an unsigned (or any) JWT, without verifying it.
  public static func claims(of token: String) -> [String: Any]? {
    let parts = token.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count >= 2 else { return nil }
    var text = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while text.count % 4 != 0 { text += "=" }
    guard let data = Data(base64Encoded: text) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  static func base64url(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
