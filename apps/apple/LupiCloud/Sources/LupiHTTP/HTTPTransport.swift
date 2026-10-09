import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One HTTP exchange, as plain values so a fake can stand in for the network.
public struct HTTPRequest: Sendable, Equatable {
  public var method: String
  public var url: URL
  public var headers: [String: String]
  public var body: Data?

  public init(method: String, url: URL, headers: [String: String] = [:], body: Data? = nil) {
    self.method = method
    self.url = url
    self.headers = headers
    self.body = body
  }

  /// The body as UTF-8 text, for tests and diagnostics.
  public var bodyText: String? { body.flatMap { String(data: $0, encoding: .utf8) } }
}

public struct HTTPResponse: Sendable, Equatable {
  public var status: Int
  public var headers: [String: String]
  public var body: Data

  public init(status: Int, headers: [String: String] = [:], body: Data = Data()) {
    self.status = status
    self.headers = headers
    self.body = body
  }

  public var isSuccess: Bool { (200..<300).contains(status) }
}

/// Every network call in LupiCloud goes through this, so tests run against an
/// in-memory Firebase and the app can add logging or pinning in one place.
public protocol HTTPTransport: Sendable {
  func send(_ request: HTTPRequest) async throws -> HTTPResponse
}

/// A network failure below HTTP (no connection, timeout, cancelled).
public struct TransportError: Error, Sendable, Equatable, CustomStringConvertible {
  public var message: String
  public init(_ message: String) { self.message = message }
  public var description: String { "transport: \(message)" }
}

/// The production transport. Works on Apple platforms and, through
/// FoundationNetworking, on Linux (where the emulator tests run).
public struct URLSessionTransport: HTTPTransport {
  private let session: URLSession
  private let timeout: TimeInterval

  public init(session: URLSession = .shared, timeout: TimeInterval = 30) {
    self.session = session
    self.timeout = timeout
  }

  public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    var urlRequest = URLRequest(url: request.url, timeoutInterval: timeout)
    urlRequest.httpMethod = request.method
    urlRequest.httpBody = request.body
    for (name, value) in request.headers {
      urlRequest.setValue(value, forHTTPHeaderField: name)
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: urlRequest)
    } catch {
      throw TransportError(String(describing: error))
    }
    guard let http = response as? HTTPURLResponse else {
      throw TransportError("not an HTTP response")
    }
    var headers: [String: String] = [:]
    for (name, value) in http.allHeaderFields {
      if let name = name as? String, let value = value as? String {
        headers[name.lowercased()] = value
      }
    }
    return HTTPResponse(status: http.statusCode, headers: headers, body: data)
  }
}

/// Supplies the bearer token for Firestore calls; the auth session conforms.
public protocol AccessTokenProvider: Sendable {
  /// A token valid for at least the next request. `forceRefresh` asks for a
  /// fresh one after the server rejected the last (401).
  func accessToken(forceRefresh: Bool) async throws -> String
}
