import Foundation
import LupiHTTP

/// What Sign in with Apple hands the app (ASAuthorizationAppleIDCredential),
/// in the form Firebase wants it.
public struct AppleCredential: Sendable, Equatable {
  /// `identityToken` decoded as UTF-8 (a JWT whose `aud` is the bundle ID).
  public var idToken: String
  /// The unhashed nonce whose SHA-256 went into the Apple request.
  public var rawNonce: String
  /// `authorizationCode` as UTF-8. Single use and short-lived; needed only to
  /// revoke the Apple tokens when the account is deleted.
  public var authorizationCode: String?
  /// Apple sends the name only on the first authorization; Firebase stores it
  /// as the display name when it is passed along.
  public var givenName: String?
  public var familyName: String?

  public init(
    idToken: String,
    rawNonce: String,
    authorizationCode: String? = nil,
    givenName: String? = nil,
    familyName: String? = nil
  ) {
    self.idToken = idToken
    self.rawNonce = rawNonce
    self.authorizationCode = authorizationCode
    self.givenName = givenName
    self.familyName = familyName
  }
}

/// Tokens from a sign-in or a refresh.
public struct AuthTokens: Sendable, Equatable {
  public var uid: String
  public var idToken: String
  public var refreshToken: String
  /// Seconds the ID token stays valid (Firebase issues 3600).
  public var expiresIn: TimeInterval
  public var isNewUser: Bool?

  public init(uid: String, idToken: String, refreshToken: String, expiresIn: TimeInterval, isNewUser: Bool? = nil) {
    self.uid = uid
    self.idToken = idToken
    self.refreshToken = refreshToken
    self.expiresIn = expiresIn
    self.isNewUser = isNewUser
  }
}

/// accounts:lookup's `users[0]`; only the fields the app may show.
public struct AccountInfo: Sendable, Equatable, Decodable {
  public struct Provider: Sendable, Equatable, Decodable {
    public var providerId: String
    public var federatedId: String?
    public var rawId: String?
    public var email: String?
  }

  public var localId: String
  public var email: String?
  public var emailVerified: Bool?
  public var displayName: String?
  public var providerUserInfo: [Provider]?
  public var disabled: Bool?
  /// Milliseconds since 1970, as a decimal string.
  public var createdAt: String?
  public var lastLoginAt: String?
}

/// Firebase Authentication over REST: Identity Toolkit v1 (signInWithIdp,
/// lookup, delete), v2 (revokeToken) and the Secure Token API.
public struct AuthClient: Sendable {
  public let configuration: AuthConfiguration
  private let transport: any HTTPTransport

  public init(configuration: AuthConfiguration, transport: any HTTPTransport = URLSessionTransport()) {
    self.configuration = configuration
    self.transport = transport
  }

  // MARK: Sign in

  /// POST v1/accounts:signInWithIdp with Apple's ID token and the raw nonce,
  /// the same postBody the Firebase iOS SDK builds for
  /// OAuthProvider.appleCredential(withIDToken:rawNonce:fullName:).
  public func signInWithApple(_ credential: AppleCredential) async throws -> AuthTokens {
    var postBody: [(String, String)] = [
      ("providerId", "apple.com"),
      ("id_token", credential.idToken),
      ("nonce", credential.rawNonce),
    ]
    if credential.givenName != nil || credential.familyName != nil {
      struct Name: Encodable { var firstName: String?; var lastName: String? }
      struct User: Encodable { var name: Name }
      let user = User(name: Name(firstName: credential.givenName, lastName: credential.familyName))
      postBody.append(("user", String(decoding: try JSONBody.encode(user), as: UTF8.self)))
    }
    struct Request: Encodable {
      var postBody: String
      var requestUri: String
      var returnIdpCredential: Bool
      var returnSecureToken: Bool
    }
    let request = Request(
      postBody: FormEncoding.encode(postBody),
      requestUri: configuration.requestURI,
      returnIdpCredential: true,
      returnSecureToken: true
    )
    struct Response: Decodable {
      var localId: String?
      var idToken: String?
      var refreshToken: String?
      var expiresIn: FlexibleSeconds?
      var isNewUser: Bool?
      var needConfirmation: Bool?
      var errorMessage: String?
      var email: String?
    }
    let response: Response = try await postJSON(identityToolkit("v1/accounts:signInWithIdp"), request)
    // With returnIdpCredential the server answers some failures with 200 and
    // an errorMessage (FEDERATED_USER_ID_ALREADY_LINKED, EMAIL_EXISTS).
    if let message = response.errorMessage {
      let error = GoogleAPIError(httpStatus: 200, message: message)
      throw AuthError.from(error, email: response.email)
    }
    if response.needConfirmation == true {
      throw AuthError.accountExistsWithDifferentCredential(email: response.email)
    }
    guard let uid = response.localId, let idToken = response.idToken, let refreshToken = response.refreshToken
    else {
      throw AuthError.malformedResponse("signInWithIdp returned no tokens")
    }
    return AuthTokens(
      uid: uid,
      idToken: idToken,
      refreshToken: refreshToken,
      expiresIn: response.expiresIn?.seconds ?? 3600,
      isNewUser: response.isNewUser
    )
  }

  // MARK: Tokens

  /// POST securetoken v1/token, form-encoded grant_type=refresh_token as the
  /// REST reference documents it. The response may rotate the refresh token.
  public func refresh(refreshToken: String) async throws -> AuthTokens {
    struct Response: Decodable {
      var id_token: String
      var refresh_token: String
      var expires_in: FlexibleSeconds
      var user_id: String
    }
    let url = configuration.secureTokenBase.appendingAPIPath("v1/token")
      .appendingQuery([("key", configuration.apiKey)])
    let body = FormEncoding.encode([("grant_type", "refresh_token"), ("refresh_token", refreshToken)])
    let response: Response = try await send(
      url: url,
      contentType: "application/x-www-form-urlencoded",
      body: Data(body.utf8)
    )
    return AuthTokens(
      uid: response.user_id,
      idToken: response.id_token,
      refreshToken: response.refresh_token,
      expiresIn: response.expires_in.seconds
    )
  }

  // MARK: Account

  /// POST v1/accounts:lookup.
  public func lookup(idToken: String) async throws -> AccountInfo {
    struct Request: Encodable { var idToken: String }
    struct Response: Decodable { var users: [AccountInfo]? }
    let response: Response = try await postJSON(identityToolkit("v1/accounts:lookup"), Request(idToken: idToken))
    guard let user = response.users?.first else { throw AuthError.userNotFound }
    return user
  }

  /// POST v1/accounts:delete. Needs a recent sign-in, else
  /// CREDENTIAL_TOO_OLD_LOGIN_AGAIN (`.requiresRecentLogin`).
  public func deleteAccount(idToken: String) async throws {
    struct Request: Encodable { var idToken: String }
    let _: Empty = try await postJSON(identityToolkit("v1/accounts:delete"), Request(idToken: idToken))
  }

  /// POST v2/accounts:revokeToken: Firebase exchanges the Apple authorization
  /// code for Apple tokens and revokes them, which Apple requires when an
  /// account made with Sign in with Apple is deleted. Same endpoint and body
  /// as the iOS SDK's Auth.revokeToken(withAuthorizationCode:), except that
  /// tokenType is the enum name "CODE" where the SDK sends its number as "3";
  /// proto3 JSON accepts either.
  public func revokeAppleToken(authorizationCode: String, idToken: String) async throws {
    struct Request: Encodable {
      var idToken: String
      var providerId: String
      var token: String
      var tokenType: String
    }
    let request = Request(idToken: idToken, providerId: "apple.com", token: authorizationCode, tokenType: "CODE")
    let _: Empty = try await postJSON(identityToolkit("v2/accounts:revokeToken"), request)
  }

  // MARK: Plumbing

  private struct Empty: Decodable {}

  private func identityToolkit(_ path: String) -> URL {
    configuration.identityToolkitBase.appendingAPIPath(path)
      .appendingQuery([("key", configuration.apiKey)])
  }

  private func postJSON<Body: Encodable, Response: Decodable>(_ url: URL, _ body: Body) async throws -> Response {
    try await send(url: url, contentType: "application/json", body: try JSONBody.encode(body))
  }

  private func send<Response: Decodable>(url: URL, contentType: String, body: Data) async throws -> Response {
    var headers = ["Content-Type": contentType]
    if let bundle = configuration.bundleIdentifier {
      headers["X-Ios-Bundle-Identifier"] = bundle
    }
    let response: HTTPResponse
    do {
      response = try await transport.send(HTTPRequest(method: "POST", url: url, headers: headers, body: body))
    } catch let error as TransportError {
      throw AuthError.transport(error.message)
    }
    guard response.isSuccess else {
      throw AuthError.from(GoogleAPIError.parse(status: response.status, body: response.body))
    }
    let data = response.body.isEmpty ? Data("{}".utf8) : response.body
    do {
      return try JSONDecoder().decode(Response.self, from: data)
    } catch {
      throw AuthError.malformedResponse(String(describing: error))
    }
  }
}

/// Google sends durations as decimal strings ("3600"); the emulator has sent
/// numbers. Accept both.
struct FlexibleSeconds: Decodable, Sendable {
  var seconds: TimeInterval

  init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let text = try? container.decode(String.self), let value = TimeInterval(text) {
      seconds = value
    } else {
      seconds = try container.decode(TimeInterval.self)
    }
  }
}
