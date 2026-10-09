import Foundation
import LupiHTTP

public struct FirestoreConfiguration: Sendable, Equatable {
  public var projectID: String
  public var databaseID: String
  /// https://firestore.googleapis.com/v1/ in production.
  public var baseURL: URL

  public init(
    projectID: String,
    databaseID: String = "(default)",
    baseURL: URL = URL(string: "https://firestore.googleapis.com/v1/")!
  ) {
    self.projectID = projectID
    self.databaseID = databaseID
    self.baseURL = baseURL
  }

  /// The Firestore emulator speaks the same REST API over plain HTTP.
  public static func emulator(host: String, projectID: String) -> FirestoreConfiguration {
    FirestoreConfiguration(projectID: projectID, baseURL: URL(string: "http://\(host)/v1/")!)
  }

  /// projects/{p}/databases/{d}
  public var databaseName: String { "projects/\(projectID)/databases/\(databaseID)" }

  /// projects/{p}/databases/{d}/documents
  public var documentsRoot: String { databaseName + "/documents" }

  /// Full resource name for a path relative to the documents root.
  public func documentName(_ relativePath: String) -> String {
    relativePath.isEmpty ? documentsRoot : documentsRoot + "/" + relativePath
  }
}

public enum FirestoreError: Error, Sendable, Equatable {
  case api(GoogleAPIError)
  case transport(String)
  case malformedResponse(String)

  /// The google.rpc status name, e.g. "FAILED_PRECONDITION".
  public var status: String? {
    if case .api(let error) = self { return error.status }
    return nil
  }

  /// A write's precondition did not hold: updateTime mismatch
  /// (FAILED_PRECONDITION), exists:false on an existing document
  /// (ALREADY_EXISTS) or a required document missing (NOT_FOUND).
  public var isPreconditionFailure: Bool {
    ["FAILED_PRECONDITION", "ALREADY_EXISTS", "NOT_FOUND"].contains(status ?? "")
  }

  /// The rules or validation refused this document; retrying it unchanged
  /// will fail again, but other documents may still go through.
  public var isRejection: Bool {
    ["PERMISSION_DENIED", "INVALID_ARGUMENT"].contains(status ?? "")
  }
}

/// Firestore over REST, authorized as the signed-in user with a Firebase ID
/// token, so security rules apply exactly as they do for the SDKs.
public struct FirestoreClient: Sendable {
  public let configuration: FirestoreConfiguration
  private let transport: any HTTPTransport
  private let tokens: any AccessTokenProvider

  public init(
    configuration: FirestoreConfiguration,
    transport: any HTTPTransport = URLSessionTransport(),
    tokens: any AccessTokenProvider
  ) {
    self.configuration = configuration
    self.transport = transport
    self.tokens = tokens
  }

  /// GET a document; nil when it does not exist.
  public func getDocument(_ relativePath: String) async throws -> FirestoreDocument? {
    do {
      return try await send("GET", url(for: configuration.documentName(relativePath)), body: nil as Data?)
    } catch FirestoreError.api(let error) where error.httpStatus == 404 {
      return nil
    }
  }

  /// GET a collection page. `mask` limits the returned fields.
  public func listDocuments(
    collectionPath: String,
    pageSize: Int,
    pageToken: String? = nil,
    mask: [String]? = nil
  ) async throws -> ListDocumentsResponse {
    var query: [(String, String)] = [("pageSize", String(pageSize))]
    if let pageToken { query.append(("pageToken", pageToken)) }
    for field in mask ?? [] { query.append(("mask.fieldPaths", field)) }
    let target = url(for: configuration.documentName(collectionPath)).appendingQuery(query)
    return try await send("GET", target, body: nil as Data?)
  }

  public struct QueryResult: Sendable, Equatable {
    public var documents: [FirestoreDocument]
    /// The snapshot time the server read at (also a server clock reading).
    public var readTime: FirestoreTimestamp?
  }

  /// POST {parent}:runQuery. `parentPath` is relative to the documents root
  /// ("" for the root, "users/{uid}" for a user's subcollections).
  public func runQuery(parentPath: String, _ query: StructuredQuery) async throws -> QueryResult {
    struct Request: Encodable { var structuredQuery: StructuredQuery }
    let target = configuration.baseURL.appendingAPIPath(
      escapedPath(configuration.documentName(parentPath)) + ":runQuery"
    )
    let elements: [RunQueryResponseElement] = try await send(
      "POST",
      target,
      body: try JSONBody.encode(Request(structuredQuery: query))
    )
    return QueryResult(
      documents: elements.compactMap(\.document),
      readTime: elements.compactMap(\.readTime).max()
    )
  }

  /// POST {database}/documents:commit. All writes apply atomically, in order.
  public func commit(_ writes: [FirestoreWrite]) async throws -> CommitResponse {
    struct Request: Encodable { var writes: [FirestoreWrite] }
    let target = configuration.baseURL.appendingAPIPath(escapedPath(configuration.documentsRoot) + ":commit")
    return try await send("POST", target, body: try JSONBody.encode(Request(writes: writes)))
  }

  // MARK: Plumbing

  private func url(for resourceName: String) -> URL {
    configuration.baseURL.appendingAPIPath(escapedPath(resourceName))
  }

  /// Percent-escapes each segment; '(' and ')' stay literal so "(default)"
  /// reads as Google writes it.
  private func escapedPath(_ name: String) -> String {
    name.split(separator: "/", omittingEmptySubsequences: false).map { segment in
      FormEncoding.escape(String(segment))
        .replacingOccurrences(of: "%28", with: "(")
        .replacingOccurrences(of: "%29", with: ")")
    }.joined(separator: "/")
  }

  private func send<Response: Decodable>(_ method: String, _ url: URL, body: Data?) async throws -> Response {
    var response = try await exchange(method, url, body: body, forceRefresh: false)
    if response.status == 401 {
      // The ID token was rejected (revoked or clock skew): refresh once.
      response = try await exchange(method, url, body: body, forceRefresh: true)
    }
    guard response.isSuccess else {
      throw FirestoreError.api(GoogleAPIError.parse(status: response.status, body: response.body))
    }
    do {
      return try JSONDecoder().decode(Response.self, from: response.body.isEmpty ? Data("{}".utf8) : response.body)
    } catch {
      throw FirestoreError.malformedResponse(String(describing: error))
    }
  }

  private func exchange(_ method: String, _ url: URL, body: Data?, forceRefresh: Bool) async throws -> HTTPResponse {
    let token = try await tokens.accessToken(forceRefresh: forceRefresh)
    var headers = ["Authorization": "Bearer \(token)"]
    if body != nil { headers["Content-Type"] = "application/json" }
    do {
      return try await transport.send(HTTPRequest(method: method, url: url, headers: headers, body: body))
    } catch let error as TransportError {
      throw FirestoreError.transport(error.message)
    }
  }
}
