import Foundation

/// A signed-in Firebase user: who, and the tokens that prove it.
public struct Session: Codable, Sendable, Equatable {
  public var uid: String
  /// Firebase ID token (a JWT, valid one hour). Bearer for Firestore.
  public var idToken: String
  /// Long-lived; exchanged for new ID tokens. Treat as a password.
  public var refreshToken: String
  public var expiresAt: Date

  public init(uid: String, idToken: String, refreshToken: String, expiresAt: Date) {
    self.uid = uid
    self.idToken = idToken
    self.refreshToken = refreshToken
    self.expiresAt = expiresAt
  }

  init(_ tokens: AuthTokens, issuedAt: Date) {
    self.init(
      uid: tokens.uid,
      idToken: tokens.idToken,
      refreshToken: tokens.refreshToken,
      expiresAt: issuedAt.addingTimeInterval(tokens.expiresIn)
    )
  }

  /// True while the ID token has more than `leeway` seconds left.
  public func isFresh(at now: Date, leeway: TimeInterval) -> Bool {
    now.addingTimeInterval(leeway) < expiresAt
  }
}

/// Where the session survives app launches. The app supplies a Keychain store
/// (generic password, this-device-only, not synchronizable); tests use
/// InMemoryTokenStore.
public protocol TokenStore: Sendable {
  func load() async throws -> Session?
  func save(_ session: Session) async throws
  func clear() async throws
}

public actor InMemoryTokenStore: TokenStore {
  private var session: Session?

  public init(_ session: Session? = nil) {
    self.session = session
  }

  public func load() async throws -> Session? { session }
  public func save(_ session: Session) async throws { self.session = session }
  public func clear() async throws { session = nil }
}
