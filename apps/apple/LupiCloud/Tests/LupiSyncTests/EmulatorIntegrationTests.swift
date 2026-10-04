import Foundation
import LupiCloudTesting
import Testing

@testable import LupiSync

/// The real wire, against the Firebase emulators with this repo's
/// firestore.rules loaded. Runs only when both emulators are up:
///
///   npx firebase-tools emulators:exec --only auth,firestore --project demo-lupi \
///     "swift test --package-path apps/apple/LupiCloud --filter Emulator"
enum Emulator {
  static let firestoreHost = ProcessInfo.processInfo.environment["FIRESTORE_EMULATOR_HOST"]
  static let authHost = ProcessInfo.processInfo.environment["FIREBASE_AUTH_EMULATOR_HOST"]
  static var available: Bool { firestoreHost != nil && authHost != nil }
  static let projectID = ProcessInfo.processInfo.environment["GCLOUD_PROJECT"] ?? "demo-lupi"
}

/// Passes everything to the network except Apple token revocation, which the
/// Auth emulator does not implement (it answers 501 NOT_IMPLEMENTED for
/// identitytoolkit.accounts.revokeToken); production answers `{}`.
actor RevocationStub: HTTPTransport {
  let network = URLSessionTransport()
  private(set) var revoked: [String] = []

  func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    if request.url.path.hasSuffix("/v2/accounts:revokeToken") {
      let body = (try? JSONSerialization.jsonObject(with: request.body ?? Data())) as? [String: Any]
      revoked.append(body?["token"] as? String ?? "")
      return .json(200, "{}")
    }
    return try await network.send(request)
  }
}

struct EmulatorDevice {
  let sessions: SessionManager
  let firestore: FirestoreClient
  let sync: TrophySync<TestTrophy>

  init(transport: any HTTPTransport, configuration: TrophySyncConfiguration = TrophySyncConfiguration()) {
    let auth = AuthClient(configuration: .emulator(host: Emulator.authHost ?? ""), transport: transport)
    sessions = SessionManager(client: auth, store: InMemoryTokenStore())
    firestore = FirestoreClient(
      configuration: .emulator(host: Emulator.firestoreHost ?? "", projectID: Emulator.projectID),
      transport: transport,
      tokens: sessions
    )
    sync = TrophySync(session: sessions, firestore: firestore, store: InMemorySyncStateStore(), configuration: configuration)
  }

  func names() async throws -> [String: String] {
    Dictionary(uniqueKeysWithValues: try await sync.trophies().map { ($0.id, $0.name) })
  }
}

@Suite("Emulator integration", .enabled(if: Emulator.available), .serialized)
struct EmulatorIntegrationTests {
  @Test("Auth emulator: sign in with Apple, look up, refresh, delete")
  func auth() async throws {
    let client = AuthClient(configuration: .emulator(host: Emulator.authHost!), transport: URLSessionTransport())
    let nonce = AppleNonce()
    let sub = "apple-\(UUID().uuidString)"
    let credential = AppleCredential(
      idToken: FakeAppleIDToken.make(sub: sub, nonceHash: nonce.hashed),
      rawNonce: nonce.raw,
      givenName: "Ada",
      familyName: "Lovelace"
    )
    let tokens = try await client.signInWithApple(credential)
    #expect(tokens.isNewUser == true)
    #expect(tokens.expiresIn == 3600)
    let info = try await client.lookup(idToken: tokens.idToken)
    #expect(info.localId == tokens.uid)
    #expect(info.providerUserInfo?.first?.providerId == "apple.com")
    #expect(info.providerUserInfo?.first?.federatedId == sub)

    let refreshed = try await client.refresh(refreshToken: tokens.refreshToken)
    #expect(refreshed.uid == tokens.uid)
    #expect(refreshed.idToken != tokens.idToken || refreshed.expiresIn == 3600)

    // The route exists (the emulator names it) but is not implemented there.
    await #expect(throws: AuthError.self) {
      try await client.revokeAppleToken(authorizationCode: "code", idToken: tokens.idToken)
    }

    try await client.deleteAccount(idToken: refreshed.idToken)
    // Production documents USER_NOT_FOUND for a deleted user's refresh token;
    // the emulator answers INVALID_REFRESH_TOKEN. Both end the session.
    do {
      _ = try await client.refresh(refreshToken: tokens.refreshToken)
      Issue.record("refresh after deletion should fail")
    } catch let error as AuthError {
      #expect(error == .userNotFound || error == .invalidRefreshToken)
      #expect(error.endsSession)
    }
  }

  @Test("Firestore emulator + firestore.rules: precondition and rule statuses")
  func statuses() async throws {
    let device = EmulatorDevice(transport: URLSessionTransport())
    let nonce = AppleNonce()
    let session = try await device.sessions.signInWithApple(
      AppleCredential(idToken: FakeAppleIDToken.make(sub: "apple-\(UUID().uuidString)", nonceHash: nonce.hashed), rawNonce: nonce.raw)
    )
    let config = device.firestore.configuration
    let name = config.documentName("users/\(session.uid)/trophies/t1")
    let fields = TrophyEnvelope.fields(
      schema: "lupi.trophy.v1",
      id: "t1",
      payload: try FirestoreEncoder().encodeFields(TestTrophy.make("t1")),
      clientUpdatedAt: FirestoreTimestamp(date: Date())
    )
    func write(_ fields: [String: FirestoreValue], _ precondition: Precondition?, name: String = name) -> FirestoreWrite {
      .set(name: name, fields: fields, serverTimestamps: ["updatedAt"], precondition: precondition)
    }
    func status(_ writes: [FirestoreWrite]) async -> String? {
      do {
        _ = try await device.firestore.commit(writes)
        return "OK"
      } catch let error as FirestoreError {
        return error.status
      } catch {
        return "\(error)"
      }
    }

    let created = try await device.firestore.commit([write(fields, .exists(false))])
    let updateTime = try #require(created.writeResults?.first?.updateTime)
    let requestTime = try #require(created.writeResults?.first?.transformResults?.first?.timestampValue)
    #expect(requestTime <= updateTime, "REQUEST_TIME is stamped on arrival, before the commit")

    #expect(await status([write(fields, .exists(false))]) == "ALREADY_EXISTS")
    #expect(await status([write(fields, .updateTime(FirestoreTimestamp(seconds: 1)))]) == "FAILED_PRECONDITION")
    #expect(await status([write(fields, .updateTime(updateTime))]) == "OK")
    let missing = config.documentName("users/\(session.uid)/trophies/t2")
    var otherFields = fields
    otherFields["id"] = .string("t2")
    #expect(await status([write(otherFields, .exists(true), name: missing)]) == "NOT_FOUND")
    #expect(await status([write(otherFields, .updateTime(updateTime), name: missing)]) == "FAILED_PRECONDITION")

    var badSchema = fields
    badSchema["schema"] = .string("lupi.trophy.v2")
    #expect(await status([write(badSchema, nil)]) == "PERMISSION_DENIED")
    var extraKey = fields
    extraKey["ownerEmail"] = .string("a@b.c")
    #expect(await status([write(extraKey, nil)]) == "PERMISSION_DENIED")
    #expect(await status([.set(name: name, fields: fields, precondition: nil)]) == "PERMISSION_DENIED", "updatedAt must be REQUEST_TIME")
    let foreign = config.documentName("users/someone-else/trophies/t1")
    #expect(await status([write(fields, nil, name: foreign)]) == "PERMISSION_DENIED")
    let shelf = config.documentName("users/\(session.uid)/shelves/s1")
    #expect(await status([write(fields, nil, name: shelf)]) == "PERMISSION_DENIED")
  }

  @Test("two devices converge through the emulator: edits, LWW, tombstones, paging")
  func convergence() async throws {
    let sub = "apple-\(UUID().uuidString)"
    func credential() -> AppleCredential {
      let nonce = AppleNonce()
      return AppleCredential(idToken: FakeAppleIDToken.make(sub: sub, nonceHash: nonce.hashed), rawNonce: nonce.raw)
    }
    let phone = EmulatorDevice(transport: URLSessionTransport())
    let pad = EmulatorDevice(transport: URLSessionTransport(), configuration: TrophySyncConfiguration(pageSize: 2))

    // Made signed out, adopted at sign-in.
    for index in 1...5 { try await phone.sync.save(.make("t\(index)")) }
    let first = try await phone.sync.signIn(with: credential())
    #expect(first.adopted == 5 && first.pushed == 5)

    // One commit stamps all five alike; the pad pages through them two at a time.
    try await pad.sync.signIn(with: credential())
    #expect(try await pad.sync.trophies().map(\.id).sorted() == ["t1", "t2", "t3", "t4", "t5"])

    // Conflict: the pad's later edit wins although the phone syncs last.
    try await phone.sync.save(.make("t1", name: "Phone"))
    try await Task.sleep(nanoseconds: 20_000_000)
    try await pad.sync.save(.make("t1", name: "Pad"))
    try await pad.sync.sync()
    let report = try await phone.sync.sync()
    #expect(report.remoteWins == 1)

    // Deletion travels as a tombstone.
    try await pad.sync.delete(id: "t2")
    try await pad.sync.sync()
    try await phone.sync.sync()

    let expected = ["t1": "Pad", "t3": "Caffeine", "t4": "Caffeine", "t5": "Caffeine"]
    #expect(try await phone.names() == expected)
    #expect(try await pad.names() == expected)
    let uid = try #require(await phone.sessions.currentUID())
    let tombstone = try #require(try await phone.firestore.getDocument("users/\(uid)/trophies/t2"))
    #expect(tombstone.fields["deleted"] == .boolean(true))
    #expect(tombstone.fields["payload"] == .map([:]))
  }

  @Test("account deletion against the emulators (Apple revocation stubbed)")
  func accountDeletion() async throws {
    let transport = RevocationStub()
    let sub = "apple-\(UUID().uuidString)"
    func credential(code: String? = nil) -> AppleCredential {
      let nonce = AppleNonce()
      return AppleCredential(
        idToken: FakeAppleIDToken.make(sub: sub, nonceHash: nonce.hashed),
        rawNonce: nonce.raw,
        authorizationCode: code
      )
    }
    let phone = EmulatorDevice(transport: transport)
    try await phone.sync.signIn(with: credential())
    let uid = try #require(await phone.sessions.currentUID())
    for index in 1...3 { try await phone.sync.save(.make("t\(index)")) }
    try await phone.sync.sync()

    try await phone.sync.deleteAccount(reauthentication: credential(code: "fresh-code"))
    #expect(await transport.revoked == ["fresh-code"])
    #expect(try await phone.sessions.currentSession() == nil)
    #expect(try await phone.sync.trophies().isEmpty)

    // The documents are gone. "Bearer owner" is the emulator's admin bypass.
    let admin = FirestoreClient(
      configuration: .emulator(host: Emulator.firestoreHost!, projectID: Emulator.projectID),
      transport: URLSessionTransport(),
      tokens: StaticToken(token: "owner")
    )
    let left = try await admin.listDocuments(collectionPath: "users/\(uid)/trophies", pageSize: 10)
    #expect(left.documents == nil)

    // And the Apple ID now makes a new, empty account.
    let probe = EmulatorDevice(transport: URLSessionTransport())
    try await probe.sessions.signInWithApple(credential())
    #expect(await probe.sessions.currentUID() != uid)
  }
}

struct StaticToken: AccessTokenProvider {
  let token: String
  func accessToken(forceRefresh: Bool) async throws -> String { token }
}
