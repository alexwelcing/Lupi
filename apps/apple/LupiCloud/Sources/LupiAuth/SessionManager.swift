import Foundation
import LupiHTTP

/// Owns the signed-in session: sign-in with Apple, ID tokens that refresh
/// themselves before they expire, sign-out and the account calls that need a
/// token. An actor, so concurrent callers share one refresh.
public actor SessionManager: AccessTokenProvider {
  public nonisolated let client: AuthClient
  private let store: any TokenStore
  private let now: @Sendable () -> Date
  /// Refresh this long before expiry so a token never lapses mid-request.
  private let refreshLeeway: TimeInterval

  private var session: Session?
  private var loaded = false
  /// The refresh in flight and the generation it was started for.
  private var refreshTask: (task: Task<Session, any Error>, generation: Int)?
  /// Bumped by sign-in and sign-out, so a refresh that started for an older
  /// session cannot resurrect it.
  private var generation = 0

  public init(
    client: AuthClient,
    store: any TokenStore,
    refreshLeeway: TimeInterval = 300,
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.client = client
    self.store = store
    self.refreshLeeway = refreshLeeway
    self.now = now
  }

  /// The stored session, if any, without touching the network.
  public func currentSession() async throws -> Session? {
    if !loaded {
      let stored = try await store.load()
      // A sign-in or sign-out during the load is newer than what was stored.
      if !loaded {
        session = stored
        loaded = true
      }
    }
    return session
  }

  public func currentUID() async -> String? {
    (try? await currentSession())?.uid
  }

  // MARK: Sign in and out

  @discardableResult
  public func signInWithApple(_ credential: AppleCredential) async throws -> Session {
    let tokens = try await client.signInWithApple(credential)
    let fresh = Session(tokens, issuedAt: now())
    generation += 1
    session = fresh
    loaded = true
    try await store.save(fresh)
    return fresh
  }

  /// Signs in again as the current user, for operations that need a recent
  /// login (account deletion). A different Apple ID is refused, and an empty
  /// account it may have just created is deleted again.
  @discardableResult
  public func reauthenticate(with credential: AppleCredential) async throws -> Session {
    guard let current = try await currentSession() else { throw AuthError.notSignedIn }
    let tokens = try await client.signInWithApple(credential)
    guard tokens.uid == current.uid else {
      if tokens.isNewUser == true {
        try? await client.deleteAccount(idToken: tokens.idToken)
      }
      throw AuthError.reauthenticationMismatch
    }
    let fresh = Session(tokens, issuedAt: now())
    generation += 1
    session = fresh
    try await store.save(fresh)
    return fresh
  }

  /// Forgets the session on this device. Firebase has no server-side sign-out
  /// for ID tokens; they simply stop being refreshed.
  public func signOut() async throws {
    generation += 1
    session = nil
    loaded = true
    try await store.clear()
  }

  // MARK: Tokens

  /// A session whose ID token outlives the leeway, refreshing at most once no
  /// matter how many callers ask at the same time.
  public func validSession(forceRefresh: Bool = false) async throws -> Session {
    guard let current = try await currentSession() else { throw AuthError.notSignedIn }
    if !forceRefresh && current.isFresh(at: now(), leeway: refreshLeeway) {
      return current
    }
    return try await refreshed(current)
  }

  public func accessToken(forceRefresh: Bool) async throws -> String {
    try await validSession(forceRefresh: forceRefresh).idToken
  }

  private func refreshed(_ current: Session) async throws -> Session {
    // A refresh started for an earlier session is not joined: its tokens
    // belong to whoever was signed in then.
    if let inFlight = refreshTask, inFlight.generation == generation {
      let startedFor = inFlight.generation
      let fresh = try await inFlight.task.value
      guard startedFor == generation else { throw AuthError.notSignedIn }
      return fresh
    }
    let client = self.client
    let now = self.now
    let refreshToken = current.refreshToken
    let startedFor = generation
    let task = Task { () async throws -> Session in
      let tokens = try await client.refresh(refreshToken: refreshToken)
      return Session(tokens, issuedAt: now())
    }
    refreshTask = (task, startedFor)
    defer {
      if refreshTask?.generation == startedFor { refreshTask = nil }
    }
    do {
      let fresh = try await task.value
      guard startedFor == generation else { throw AuthError.notSignedIn }
      session = fresh
      try await store.save(fresh)
      return fresh
    } catch let error as AuthError where error.endsSession {
      // The refresh token is dead (expired, disabled, deleted user): forget it
      // so the app shows itself signed out rather than failing every call.
      if startedFor == generation {
        generation += 1
        session = nil
        try? await store.clear()
      }
      throw error
    }
  }

  // MARK: Account

  public func lookup() async throws -> AccountInfo {
    try await client.lookup(idToken: validSession().idToken)
  }

  /// Revokes the Apple tokens behind this account (needs a fresh Apple
  /// authorization code from a new Sign in with Apple).
  public func revokeApple(authorizationCode: String) async throws {
    try await client.revokeAppleToken(authorizationCode: authorizationCode, idToken: validSession().idToken)
  }

  /// Deletes the Firebase user, then forgets the session. A user that is
  /// already gone counts as deleted.
  public func deleteUser() async throws {
    do {
      try await client.deleteAccount(idToken: validSession().idToken)
    } catch AuthError.userNotFound {
      // Deleted already (another device, or a retry after a lost response).
    }
    try await signOut()
  }
}
