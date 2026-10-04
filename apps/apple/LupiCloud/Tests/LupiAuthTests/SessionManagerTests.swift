import Foundation
import LupiCloudTesting
import Testing

@testable import LupiAuth

@Suite("Session manager")
struct SessionManagerTests {
  let clock = TestClock()

  func tokenResponse(id: String, refresh: String, uid: String = "u1") -> HTTPResponse {
    .json(200, #"{"expires_in":"3600","token_type":"Bearer","refresh_token":"\#(refresh)","id_token":"\#(id)","user_id":"\#(uid)","project_id":"1"}"#)
  }

  func manager(_ transport: ScriptedTransport, store: InMemoryTokenStore = InMemoryTokenStore()) -> SessionManager {
    SessionManager(
      client: AuthClient(configuration: AuthConfiguration(apiKey: "k"), transport: transport),
      store: store,
      now: clock.function
    )
  }

  @Test("sign-in stores a session that expires with the ID token")
  func signIn() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(.json(200, #"{"localId":"u1","idToken":"id1","refreshToken":"r1","expiresIn":"3600"}"#))
    let store = InMemoryTokenStore()
    let sessions = manager(transport, store: store)
    let session = try await sessions.signInWithApple(AppleCredential(idToken: "t", rawNonce: "n"))
    #expect(session == Session(uid: "u1", idToken: "id1", refreshToken: "r1", expiresAt: clock.now.addingTimeInterval(3600)))
    #expect(try await store.load() == session)
    // Fresh: no network for a token.
    #expect(try await sessions.accessToken(forceRefresh: false) == "id1")
    #expect(await transport.requests.count == 1)
  }

  @Test("refreshes inside the leeway and keeps a rotated refresh token")
  func refreshNearExpiry() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(tokenResponse(id: "id2", refresh: "r2"))
    let store = InMemoryTokenStore(Session(uid: "u1", idToken: "id1", refreshToken: "r1", expiresAt: clock.now.addingTimeInterval(400)))
    let sessions = manager(transport, store: store)
    #expect(try await sessions.accessToken(forceRefresh: false) == "id1")
    clock.advance(120)  // 280 s left, inside the 300 s leeway
    #expect(try await sessions.accessToken(forceRefresh: false) == "id2")
    #expect(try await store.load()?.refreshToken == "r2")
    #expect(await transport.requests.map(\.url.path) == ["/v1/token"])
  }

  @Test("concurrent callers share one refresh")
  func singleFlight() async throws {
    let transport = ScriptedTransport { request in
      try await Task.sleep(nanoseconds: 50_000_000)
      return .json(200, #"{"expires_in":"3600","refresh_token":"r2","id_token":"id2","user_id":"u1"}"#)
    }
    let store = InMemoryTokenStore(Session(uid: "u1", idToken: "id1", refreshToken: "r1", expiresAt: clock.now))
    let sessions = manager(transport, store: store)
    let tokens = try await withThrowingTaskGroup(of: String.self) { group in
      for _ in 0..<25 {
        group.addTask { try await sessions.accessToken(forceRefresh: false) }
      }
      return try await group.reduce(into: [String]()) { $0.append($1) }
    }
    #expect(tokens.count == 25)
    #expect(Set(tokens) == ["id2"])
    #expect(await transport.requests.count == 1)
  }

  @Test("a dead refresh token signs the device out")
  func deadRefreshToken() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(.googleError(400, message: "TOKEN_EXPIRED"))
    let store = InMemoryTokenStore(Session(uid: "u1", idToken: "id1", refreshToken: "r1", expiresAt: clock.now))
    let sessions = manager(transport, store: store)
    await #expect(throws: AuthError.tokenExpired) { _ = try await sessions.validSession() }
    #expect(try await store.load() == nil)
    await #expect(throws: AuthError.notSignedIn) { _ = try await sessions.validSession() }
  }

  @Test("a transient refresh failure keeps the session")
  func transientFailure() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(HTTPResponse(status: 503, body: Data()), tokenResponse(id: "id2", refresh: "r1"))
    let store = InMemoryTokenStore(Session(uid: "u1", idToken: "id1", refreshToken: "r1", expiresAt: clock.now))
    let sessions = manager(transport, store: store)
    await #expect(throws: AuthError.self) { _ = try await sessions.validSession() }
    #expect(try await store.load() != nil)
    #expect(try await sessions.validSession().idToken == "id2")
  }

  @Test("sign-out during a refresh discards the refreshed tokens")
  func signOutWins() async throws {
    let transport = ScriptedTransport { _ in
      try await Task.sleep(nanoseconds: 100_000_000)
      return .json(200, #"{"expires_in":"3600","refresh_token":"r2","id_token":"id2","user_id":"u1"}"#)
    }
    let store = InMemoryTokenStore(Session(uid: "u1", idToken: "id1", refreshToken: "r1", expiresAt: clock.now))
    let sessions = manager(transport, store: store)
    let pending = Task { try await sessions.validSession() }
    try await Task.sleep(nanoseconds: 20_000_000)
    try await sessions.signOut()
    await #expect(throws: AuthError.notSignedIn) { _ = try await pending.value }
    #expect(try await store.load() == nil)
    #expect(try await sessions.currentSession() == nil)
  }

  @Test("re-authentication must be the same user; a stray new account is removed")
  func reauthenticate() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(
      .json(200, #"{"localId":"u1","idToken":"id9","refreshToken":"r9","expiresIn":"3600"}"#),
      .json(200, #"{"localId":"u2","idToken":"stray","refreshToken":"rs","expiresIn":"3600","isNewUser":true}"#),
      .json(200, #"{"kind":"identitytoolkit#DeleteAccountResponse"}"#)
    )
    let original = Session(uid: "u1", idToken: "id1", refreshToken: "r1", expiresAt: clock.now.addingTimeInterval(3600))
    let store = InMemoryTokenStore(original)
    let sessions = manager(transport, store: store)
    let fresh = try await sessions.reauthenticate(with: AppleCredential(idToken: "t", rawNonce: "n"))
    #expect(fresh.idToken == "id9")
    await #expect(throws: AuthError.reauthenticationMismatch) {
      _ = try await sessions.reauthenticate(with: AppleCredential(idToken: "other", rawNonce: "n"))
    }
    #expect(try await store.load()?.uid == "u1")
    let requests = await transport.requests
    #expect(requests.last?.url.path == "/v1/accounts:delete")
    #expect(requests.last?.bodyText == #"{"idToken":"stray"}"#)
  }

  @Test("deleting a user that is already gone still signs out")
  func deleteAlreadyGone() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(.googleError(400, message: "USER_NOT_FOUND"))
    let store = InMemoryTokenStore(Session(uid: "u1", idToken: "id1", refreshToken: "r1", expiresAt: clock.now.addingTimeInterval(3600)))
    let sessions = manager(transport, store: store)
    try await sessions.deleteUser()
    #expect(try await store.load() == nil)
  }

  @Test("a new manager restores the stored session")
  func restore() async throws {
    let stored = Session(uid: "u1", idToken: "id1", refreshToken: "r1", expiresAt: clock.now.addingTimeInterval(3600))
    let sessions = manager(ScriptedTransport(), store: InMemoryTokenStore(stored))
    #expect(await sessions.currentUID() == "u1")
    #expect(try await sessions.validSession() == stored)
  }

  @Test("session JSON round trip, for Keychain stores")
  func codable() throws {
    let session = Session(uid: "u1", idToken: "a.b.c", refreshToken: "r", expiresAt: Date(timeIntervalSince1970: 1_790_000_000))
    let data = try JSONEncoder().encode(session)
    #expect(try JSONDecoder().decode(Session.self, from: data) == session)
  }
}
