import Foundation
import LupiSync

/// An in-memory Firebase Auth and Firestore that answers the REST calls
/// LupiAuth and LupiSync make, with the same wire shapes. It keeps a server
/// clock, issues and expires ID tokens, stamps REQUEST_TIME transforms,
/// enforces write preconditions atomically per commit, and applies the
/// trophy rules from firestore.rules, so sync scenarios run end to end on
/// Linux without the emulator. Precondition status codes and the gap between
/// REQUEST_TIME (the request's arrival, in milliseconds) and the later commit
/// time match what the Firestore emulator does (EmulatorIntegrationTests).
public actor FakeFirebase: HTTPTransport {
  public struct Call: Sendable, Equatable, CustomStringConvertible {
    /// e.g. "auth.signInWithIdp", "firestore.commit".
    public var kind: String
    /// The uid behind the bearer token, for Firestore calls.
    public var uid: String?
    public var description: String { uid.map { "\(kind)[\($0)]" } ?? kind }
  }

  public let apiKey: String
  public let projectID: String
  /// The `aud` Apple ID tokens must carry (the registered bundle ID).
  public let audience: String
  public var tokenLifetime: TimeInterval = 3600
  /// accounts:delete needs a sign-in at most this old.
  public var recentLoginWindow: TimeInterval = 300

  public private(set) var calls: [Call] = []
  public private(set) var revokedAppleCodes: [String] = []
  public private(set) var now: Date

  private struct User {
    var uid: String
    var appleSub: String
    var lastSignIn: Date
    var disabled = false
  }

  private struct Stored {
    var fields: [String: FirestoreValue]
    var createTime: FirestoreTimestamp
    var updateTime: FirestoreTimestamp
  }

  private var users: [String: User] = [:]
  private var uidByAppleSub: [String: String] = [:]
  private var idTokens: [String: (uid: String, expires: Date)] = [:]
  private var refreshTokens: [String: String] = [:]
  private var documents: [String: Stored] = [:]
  private var counter = 0
  private var offline = false
  private var faults: [String: [Result<HTTPResponse, TransportError>]] = [:]
  private var commitHook: (@Sendable () async -> Void)?
  private var callHooks: [String: @Sendable () async -> Void] = [:]
  private var frozenRequestTime: FirestoreTimestamp?

  public init(
    apiKey: String = "test-api-key",
    projectID: String = "demo-lupi",
    audience: String = "live.lupi.app",
    start: Date = Date(timeIntervalSince1970: 1_790_000_000)
  ) {
    self.apiKey = apiKey
    self.projectID = projectID
    self.audience = audience
    self.now = start
  }

  // MARK: Test controls

  public func advance(_ seconds: TimeInterval) {
    now = now.addingTimeInterval(seconds)
  }

  public func setOffline(_ offline: Bool) {
    self.offline = offline
  }

  /// The next `times` calls of `kind` fail with `response`.
  public func failNext(_ kind: String, with response: HTTPResponse, times: Int = 1) {
    faults[kind, default: []].append(contentsOf: Array(repeating: .success(response), count: times))
  }

  public func failNext(_ kind: String, transport message: String, times: Int = 1) {
    faults[kind, default: []].append(contentsOf: Array(repeating: .failure(TransportError(message)), count: times))
  }

  /// Runs `hook` once, just before the next commit is applied: the moment
  /// another device can sneak a write in.
  public func onceBeforeCommit(_ hook: @escaping @Sendable () async -> Void) {
    commitHook = hook
  }

  /// Runs `hook` once, when the next call of `kind` (say "auth.signInWithIdp")
  /// arrives and before it is answered: a window for the app to act while
  /// that request is in flight.
  public func onceBefore(_ kind: String, _ hook: @escaping @Sendable () async -> Void) {
    callHooks[kind] = hook
  }

  /// Every commit from now on gets the same REQUEST_TIME, as writes landing
  /// in one millisecond do.
  public func freezeRequestTime() {
    frozenRequestTime = FirestoreTimestamp(date: Date(timeIntervalSince1970: (now.timeIntervalSince1970 * 1000).rounded(.down) / 1000))
  }

  public func clearCalls() {
    calls.removeAll()
  }

  public var callKinds: [String] { calls.map(\.kind) }

  public func document(_ relativePath: String) -> FirestoreDocument? {
    documents[relativePath].map { makeDocument(relativePath, $0) }
  }

  /// Documents directly under a collection path, by name.
  public func documents(in collectionPath: String) -> [FirestoreDocument] {
    children(of: collectionPath).map { makeDocument($0, documents[$0]!) }
  }

  public func uid(forAppleSub sub: String) -> String? { uidByAppleSub[sub] }

  public func userExists(_ uid: String) -> Bool { users[uid] != nil }

  /// Deletes a user the way the console would (no client involved).
  public func deleteUserServerSide(_ uid: String) {
    // Refresh tokens stay mapped, so using one answers USER_NOT_FOUND as
    // Firebase does for a deleted user.
    if let user = users.removeValue(forKey: uid) { uidByAppleSub[user.appleSub] = nil }
  }

  /// A write by another device, bypassing the client: stamps updatedAt and
  /// updateTime with the server clock.
  public func serverWrite(_ relativePath: String, fields: [String: FirestoreValue]) {
    let (requestTime, commitTime) = tick()
    var stamped = fields
    stamped["updatedAt"] = .timestamp(requestTime)
    let created = documents[relativePath]?.createTime ?? commitTime
    documents[relativePath] = Stored(fields: stamped, createTime: created, updateTime: commitTime)
  }

  // MARK: Transport

  public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    let host = request.url.host ?? ""
    let path = request.url.path
    let kind = Self.kind(host: host, path: path, method: request.method)
    let uid = bearerUID(request)
    calls.append(Call(kind: kind, uid: kind.hasPrefix("firestore") ? uid : nil))
    if offline { throw TransportError("offline") }
    if let hook = callHooks.removeValue(forKey: kind) { await hook() }
    if var queue = faults[kind], !queue.isEmpty {
      let fault = queue.removeFirst()
      faults[kind] = queue
      switch fault {
      case .success(let response): return response
      case .failure(let error): throw error
      }
    }
    switch kind {
    case "auth.signInWithIdp": return signInWithIdp(request)
    case "auth.token": return refresh(request)
    case "auth.lookup": return lookup(request)
    case "auth.delete": return deleteAccount(request)
    case "auth.revokeToken": return revoke(request)
    case "firestore.get", "firestore.list", "firestore.runQuery", "firestore.commit":
      return await firestore(kind, request)
    default:
      return .googleError(404, message: "Not Found", rpcStatus: "NOT_FOUND")
    }
  }

  static func kind(host: String, path: String, method: String) -> String {
    if path.hasSuffix("accounts:signInWithIdp") { return "auth.signInWithIdp" }
    if path.hasSuffix("accounts:lookup") { return "auth.lookup" }
    if path.hasSuffix("accounts:delete") { return "auth.delete" }
    if path.hasSuffix("accounts:revokeToken") { return "auth.revokeToken" }
    if path.hasSuffix("/v1/token") { return "auth.token" }
    if path.hasSuffix(":runQuery") { return "firestore.runQuery" }
    if path.hasSuffix(":commit") { return "firestore.commit" }
    if method == "GET", let range = path.range(of: "/documents/") {
      let relative = path[range.upperBound...].split(separator: "/")
      return relative.count % 2 == 0 ? "firestore.get" : "firestore.list"
    }
    return "unknown"
  }

  // MARK: Auth

  private func requireKey(_ request: HTTPRequest) -> HTTPResponse? {
    let query = FormEncoding.decode(request.url.query ?? "")
    guard query.contains(where: { $0.0 == "key" && $0.1 == apiKey }) else {
      return .googleError(
        400,
        message: "API key not valid. Please pass a valid API key.",
        rpcStatus: "INVALID_ARGUMENT",
        reasons: ["keyInvalid"]
      )
    }
    return nil
  }

  private func jsonBody(_ request: HTTPRequest) -> [String: Any] {
    guard let body = request.body else { return [:] }
    return ((try? JSONSerialization.jsonObject(with: body)) as? [String: Any]) ?? [:]
  }

  private func authError(_ message: String) -> HTTPResponse {
    .googleError(400, message: message, rpcStatus: "INVALID_ARGUMENT", reasons: ["invalid"])
  }

  private func issueTokens(for uid: String) -> (idToken: String, refreshToken: String) {
    counter += 1
    let idToken = "fake-id-\(uid)-\(counter)"
    let refreshToken = "fake-refresh-\(uid)-\(counter)"
    idTokens[idToken] = (uid, now.addingTimeInterval(tokenLifetime))
    refreshTokens[refreshToken] = uid
    return (idToken, refreshToken)
  }

  private func validUser(idToken: String?) -> User? {
    guard let idToken, let entry = idTokens[idToken], entry.expires > now else { return nil }
    return users[entry.uid]
  }

  private func signInWithIdp(_ request: HTTPRequest) -> HTTPResponse {
    if let error = requireKey(request) { return error }
    let body = jsonBody(request)
    guard body["returnSecureToken"] as? Bool == true, body["requestUri"] is String,
      let postBody = body["postBody"] as? String
    else {
      return authError("MISSING_REQUEST_URI")
    }
    let fields = Dictionary(FormEncoding.decode(postBody), uniquingKeysWith: { first, _ in first })
    guard fields["providerId"] == "apple.com" else { return authError("INVALID_PROVIDER_ID") }
    guard let token = fields["id_token"], let claims = FakeAppleIDToken.claims(of: token),
      let sub = claims["sub"] as? String
    else {
      return authError("INVALID_IDP_RESPONSE : Unable to parse the id_token.")
    }
    guard claims["aud"] as? String == audience else {
      return authError("INVALID_IDP_RESPONSE : The audience in ID Token does not match the expected audience.")
    }
    if let nonceClaim = claims["nonce"] as? String {
      guard let raw = fields["nonce"], SHA256.hexDigest(raw) == nonceClaim else {
        return authError("MISSING_OR_INVALID_NONCE : Nonce is missing in the request.")
      }
    }
    var isNewUser = false
    let uid: String
    if let existing = uidByAppleSub[sub] {
      uid = existing
    } else {
      counter += 1
      uid = "uid\(counter)"
      uidByAppleSub[sub] = uid
      users[uid] = User(uid: uid, appleSub: sub, lastSignIn: now)
      isNewUser = true
    }
    if users[uid]?.disabled == true { return authError("USER_DISABLED") }
    users[uid]?.lastSignIn = now
    let tokens = issueTokens(for: uid)
    let response: [String: Any] = [
      "kind": "identitytoolkit#VerifyAssertionResponse",
      "providerId": "apple.com",
      "federatedId": "https://appleid.apple.com/\(sub)",
      "localId": uid,
      "idToken": tokens.idToken,
      "refreshToken": tokens.refreshToken,
      "expiresIn": String(Int(tokenLifetime)),
      "isNewUser": isNewUser,
    ]
    return json(response)
  }

  private func refresh(_ request: HTTPRequest) -> HTTPResponse {
    if let error = requireKey(request) { return error }
    let form = Dictionary(
      FormEncoding.decode(request.bodyText ?? ""),
      uniquingKeysWith: { first, _ in first }
    )
    guard form["grant_type"] == "refresh_token" else { return authError("INVALID_GRANT_TYPE") }
    guard let refreshToken = form["refresh_token"] else { return authError("MISSING_REFRESH_TOKEN") }
    guard let uid = refreshTokens[refreshToken] else { return authError("INVALID_REFRESH_TOKEN") }
    guard let user = users[uid] else { return authError("USER_NOT_FOUND") }
    if user.disabled { return authError("USER_DISABLED") }
    counter += 1
    let idToken = "fake-id-\(uid)-\(counter)"
    idTokens[idToken] = (uid, now.addingTimeInterval(tokenLifetime))
    return json([
      "access_token": idToken,
      "expires_in": String(Int(tokenLifetime)),
      "token_type": "Bearer",
      "refresh_token": refreshToken,
      "id_token": idToken,
      "user_id": uid,
      "project_id": "350452481649",
    ])
  }

  private func lookup(_ request: HTTPRequest) -> HTTPResponse {
    if let error = requireKey(request) { return error }
    let idToken = jsonBody(request)["idToken"] as? String
    guard let user = validUser(idToken: idToken) else {
      // A live token of a deleted user, as Firebase and the emulator answer it.
      if let idToken, let entry = idTokens[idToken], entry.expires > now { return authError("USER_NOT_FOUND") }
      return authError("INVALID_ID_TOKEN")
    }
    return json([
      "kind": "identitytoolkit#GetAccountInfoResponse",
      "users": [[
        "localId": user.uid,
        "providerUserInfo": [["providerId": "apple.com", "federatedId": user.appleSub, "rawId": user.appleSub]],
        "lastLoginAt": String(Int(user.lastSignIn.timeIntervalSince1970 * 1000)),
      ]],
    ])
  }

  private func deleteAccount(_ request: HTTPRequest) -> HTTPResponse {
    if let error = requireKey(request) { return error }
    guard let user = validUser(idToken: jsonBody(request)["idToken"] as? String) else {
      return authError("INVALID_ID_TOKEN")
    }
    guard now.timeIntervalSince(user.lastSignIn) <= recentLoginWindow else {
      return authError("CREDENTIAL_TOO_OLD_LOGIN_AGAIN")
    }
    deleteUserServerSide(user.uid)
    return json(["kind": "identitytoolkit#DeleteAccountResponse"])
  }

  private func revoke(_ request: HTTPRequest) -> HTTPResponse {
    if let error = requireKey(request) { return error }
    let body = jsonBody(request)
    guard validUser(idToken: body["idToken"] as? String) != nil else { return authError("INVALID_ID_TOKEN") }
    guard body["providerId"] as? String == "apple.com", body["tokenType"] as? String == "CODE",
      let code = body["token"] as? String, !code.isEmpty
    else {
      return authError("INVALID_ARGUMENT")
    }
    revokedAppleCodes.append(code)
    return json([:])
  }

  // MARK: Firestore

  private var documentsRoot: String { "projects/\(projectID)/databases/(default)/documents" }

  private func bearerUID(_ request: HTTPRequest) -> String? {
    guard let header = request.headers["Authorization"], header.hasPrefix("Bearer ") else { return nil }
    return idTokens[String(header.dropFirst(7))]?.uid
  }

  private func firestore(_ kind: String, _ request: HTTPRequest) async -> HTTPResponse {
    guard let header = request.headers["Authorization"], header.hasPrefix("Bearer "),
      let token = idTokens[String(header.dropFirst(7))], token.expires > now
    else {
      return .googleError(
        401,
        message: "Request had invalid authentication credentials.",
        rpcStatus: "UNAUTHENTICATED"
      )
    }
    let uid = token.uid
    guard let range = request.url.path.range(of: "/documents") else {
      return .googleError(400, message: "bad path", rpcStatus: "INVALID_ARGUMENT")
    }
    var relative = String(request.url.path[range.upperBound...])
    if relative.hasPrefix("/") { relative.removeFirst() }
    switch kind {
    case "firestore.get":
      guard ownsPath(uid, relative) else { return denied() }
      guard let stored = documents[relative] else {
        return .googleError(404, message: "Document \"\(documentsRoot)/\(relative)\" not found.", rpcStatus: "NOT_FOUND")
      }
      return encodeJSON(makeDocument(relative, stored))
    case "firestore.list":
      guard ownsPath(uid, relative + "/x") else { return denied() }
      return list(relative, request)
    case "firestore.runQuery":
      return runQuery(String(relative.dropLast(":runQuery".count)), uid: uid, request)
    default:
      return await commit(uid: uid, request)
    }
  }

  private func denied() -> HTTPResponse {
    .googleError(403, message: "Missing or insufficient permissions.", rpcStatus: "PERMISSION_DENIED")
  }

  /// users/{uid}/trophies/{id}, owner only: the shape firestore.rules opens.
  private func ownsPath(_ uid: String, _ relative: String) -> Bool {
    let parts = relative.split(separator: "/").map(String.init)
    return parts.count == 4 && parts[0] == "users" && parts[1] == uid && parts[2] == "trophies"
  }

  private func children(of collectionPath: String) -> [String] {
    let depth = collectionPath.split(separator: "/").count + 1
    return documents.keys
      .filter { $0.hasPrefix(collectionPath + "/") && $0.split(separator: "/").count == depth }
      .sorted()
  }

  private func list(_ collectionPath: String, _ request: HTTPRequest) -> HTTPResponse {
    let query = FormEncoding.decode(request.url.query ?? "")
    let pageSize = query.first { $0.0 == "pageSize" }.flatMap { Int($0.1) } ?? 100
    let start = query.first { $0.0 == "pageToken" }.flatMap { Int($0.1) } ?? 0
    let mask = query.filter { $0.0 == "mask.fieldPaths" }.map(\.1)
    let all = children(of: collectionPath)
    let page = all.dropFirst(start).prefix(pageSize)
    let documents = page.map { path -> FirestoreDocument in
      var document = makeDocument(path, self.documents[path]!)
      if !mask.isEmpty { document.fields = document.fields.filter { mask.contains($0.key) } }
      return document
    }
    let next = start + page.count < all.count ? String(start + page.count) : nil
    return encodeJSON(ListDocumentsResponse(documents: documents.isEmpty ? nil : documents, nextPageToken: next))
  }

  private func runQuery(_ parent: String, uid: String, _ request: HTTPRequest) -> HTTPResponse {
    struct Body: Decodable { var structuredQuery: StructuredQuery }
    guard let body = request.body, let query = try? JSONDecoder().decode(Body.self, from: body).structuredQuery,
      let collection = query.from.first?.collectionId
    else {
      return .googleError(400, message: "bad query", rpcStatus: "INVALID_ARGUMENT")
    }
    let collectionPath = parent.isEmpty ? collection : parent + "/" + collection
    guard ownsPath(uid, collectionPath + "/x") else { return denied() }
    let orderField = query.orderBy?.first?.field.fieldPath ?? "__name__"
    func key(_ path: String) -> (FirestoreTimestamp, String)? {
      guard let stored = documents[path] else { return nil }
      let name = documentsRoot + "/" + path
      if orderField == "__name__" { return (.epoch, name) }
      guard let value = stored.fields[orderField]?.timestampValue else { return nil }
      return (value, name)
    }
    var rows = children(of: collectionPath).compactMap { path in key(path).map { (path, $0) } }
    if let filter = query.where?.fieldFilter {
      guard filter.op == "GREATER_THAN", filter.field.fieldPath == orderField,
        case .timestamp(let bound) = filter.value
      else {
        return .googleError(400, message: "unsupported filter", rpcStatus: "INVALID_ARGUMENT")
      }
      rows = rows.filter { $0.1.0 > bound }
    }
    rows.sort { $0.1 < $1.1 }
    if let cursor = query.startAt, cursor.values.count == 2,
      case .timestamp(let time) = cursor.values[0], case .reference(let name) = cursor.values[1]
    {
      let before = cursor.before ?? false
      rows = rows.filter { before ? $0.1 >= (time, name) : $0.1 > (time, name) }
    }
    if let limit = query.limit { rows = Array(rows.prefix(limit)) }
    let readTime = FirestoreTimestamp(date: now)
    let elements: [RunQueryResponseElement] = rows.isEmpty
      ? [RunQueryResponseElement(readTime: readTime)]
      : rows.map { RunQueryResponseElement(document: makeDocument($0.0, documents[$0.0]!), readTime: readTime) }
    return encodeJSON(elements)
  }

  private func commit(uid: String, _ request: HTTPRequest) async -> HTTPResponse {
    if let hook = commitHook {
      commitHook = nil
      await hook()
    }
    struct Body: Decodable { var writes: [FirestoreWrite] }
    guard let body = request.body, let writes = try? JSONDecoder().decode(Body.self, from: body).writes else {
      return .googleError(400, message: "bad commit", rpcStatus: "INVALID_ARGUMENT")
    }
    let (requestTime, commitTime) = tick()
    var staged = documents
    var results: [WriteResult] = []
    for write in writes {
      let name = write.documentName
      guard name.hasPrefix(documentsRoot + "/") else {
        return .googleError(400, message: "bad document name", rpcStatus: "INVALID_ARGUMENT")
      }
      let path = String(name.dropFirst(documentsRoot.count + 1))
      guard ownsPath(uid, path) else { return denied() }
      let existing = staged[path]
      switch write.currentDocument {
      case .exists(false)? where existing != nil:
        return .googleError(409, message: "Document already exists: \(name)", rpcStatus: "ALREADY_EXISTS")
      case .exists(true)? where existing == nil:
        return .googleError(404, message: "No document to update: \(name)", rpcStatus: "NOT_FOUND")
      case .updateTime(let expected)?:
        // The emulator answers FAILED_PRECONDITION for a missing document too.
        if existing?.updateTime != expected {
          return .googleError(400, message: "the stored version does not match the required base version.", rpcStatus: "FAILED_PRECONDITION")
        }
      default:
        break
      }
      if write.delete != nil {
        staged[path] = nil
        results.append(WriteResult(updateTime: nil))
        continue
      }
      guard var fields = write.update?.fields else {
        return .googleError(400, message: "empty write", rpcStatus: "INVALID_ARGUMENT")
      }
      var transformResults: [FirestoreValue] = []
      for transform in write.updateTransforms ?? [] where transform.setToServerValue == "REQUEST_TIME" {
        fields[transform.fieldPath] = .timestamp(requestTime)
        transformResults.append(.timestamp(requestTime))
      }
      guard validEnvelope(fields, id: path.split(separator: "/").last.map(String.init) ?? "", requestTime: requestTime)
      else {
        return denied()
      }
      staged[path] = Stored(fields: fields, createTime: existing?.createTime ?? commitTime, updateTime: commitTime)
      results.append(WriteResult(updateTime: commitTime, transformResults: transformResults.isEmpty ? nil : transformResults))
    }
    documents = staged
    return encodeJSON(CommitResponse(writeResults: results, commitTime: commitTime))
  }

  /// The checks of validTrophyEnvelope in firestore.rules.
  private func validEnvelope(_ fields: [String: FirestoreValue], id: String, requestTime: FirestoreTimestamp) -> Bool {
    let keys: Set<String> = ["schema", "id", "payload", "deleted", "updatedAt", "clientUpdatedAt"]
    guard Set(fields.keys) == keys,
      id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
      fields["schema"] == .string("lupi.trophy.v1"),
      fields["id"] == .string(id),
      let deleted = fields["deleted"]?.booleanValue,
      let payload = fields["payload"]?.mapFields, payload.count <= 32,
      !deleted || payload.isEmpty,
      fields["updatedAt"] == .timestamp(requestTime),
      let client = fields["clientUpdatedAt"]?.timestampValue,
      client < requestTime.adding(seconds: 3600)
    else {
      return false
    }
    return true
  }

  // MARK: Helpers

  /// REQUEST_TIME (arrival, truncated to milliseconds) and a commit time
  /// 0.4 ms later; the clock then moves on so every commit is distinct.
  private func tick() -> (request: FirestoreTimestamp, commit: FirestoreTimestamp) {
    let millis = (now.timeIntervalSince1970 * 1000).rounded(.down) / 1000
    let request = frozenRequestTime ?? FirestoreTimestamp(date: Date(timeIntervalSince1970: millis))
    now = now.addingTimeInterval(0.0004)
    let commit = FirestoreTimestamp(date: now)
    now = now.addingTimeInterval(0.0006)
    return (request, commit)
  }

  private func makeDocument(_ relativePath: String, _ stored: Stored) -> FirestoreDocument {
    FirestoreDocument(
      name: documentsRoot + "/" + relativePath,
      fields: stored.fields,
      createTime: stored.createTime,
      updateTime: stored.updateTime
    )
  }

  private func json(_ object: [String: Any]) -> HTTPResponse {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
    return HTTPResponse(status: 200, headers: ["content-type": "application/json"], body: data)
  }

  private func encodeJSON<T: Encodable>(_ value: T) -> HTTPResponse {
    let data = (try? JSONBody.encode(value)) ?? Data()
    return HTTPResponse(status: 200, headers: ["content-type": "application/json"], body: data)
  }
}
