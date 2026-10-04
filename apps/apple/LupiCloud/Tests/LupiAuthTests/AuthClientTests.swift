import Foundation
import LupiCloudTesting
import Testing

@testable import LupiAuth

@Suite("Auth REST requests")
struct AuthClientRequestTests {
  let config = AuthConfiguration(apiKey: "AIzaTestKey")

  @Test("signInWithIdp: endpoint, headers and the exact body")
  func signInBody() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(.json(
      200,
      #"{"localId":"u1","idToken":"id1","refreshToken":"r1","expiresIn":"3600","isNewUser":true,"providerId":"apple.com"}"#
    ))
    let client = AuthClient(configuration: config, transport: transport)
    let tokens = try await client.signInWithApple(AppleCredential(idToken: "eyJ.apple.token", rawNonce: "n0nce-_x"))
    #expect(tokens == AuthTokens(uid: "u1", idToken: "id1", refreshToken: "r1", expiresIn: 3600, isNewUser: true))

    let request = try #require(await transport.lastRequest)
    #expect(request.method == "POST")
    #expect(request.url.absoluteString == "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=AIzaTestKey")
    #expect(request.headers["Content-Type"] == "application/json")
    #expect(request.headers["X-Ios-Bundle-Identifier"] == "live.lupi.app")
    #expect(
      request.bodyText
        == #"{"postBody":"providerId=apple.com&id_token=eyJ.apple.token&nonce=n0nce-_x","requestUri":"http://localhost","returnIdpCredential":true,"returnSecureToken":true}"#
    )
  }

  @Test("signInWithIdp passes Apple's first-sign-in name as the SDK does")
  func signInWithName() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(.json(200, #"{"localId":"u1","idToken":"id1","refreshToken":"r1","expiresIn":"3600"}"#))
    let client = AuthClient(configuration: config, transport: transport)
    _ = try await client.signInWithApple(
      AppleCredential(idToken: "t", rawNonce: "n", givenName: "Ada", familyName: "Lovelace")
    )
    let body = try #require(await transport.lastRequest?.body)
    let object = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
    let postBody = try #require(object["postBody"] as? String)
    let pairs = FormEncoding.decode(postBody)
    #expect(pairs.map(\.0) == ["providerId", "id_token", "nonce", "user"])
    #expect(pairs.last?.1 == #"{"name":{"firstName":"Ada","lastName":"Lovelace"}}"#)
  }

  @Test("refresh: form-encoded body, escaped token, snake_case response")
  func refreshBody() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(.json(
      200,
      #"{"expires_in":"3600","token_type":"Bearer","refresh_token":"r2","id_token":"id2","user_id":"u1","project_id":"1"}"#
    ))
    let client = AuthClient(configuration: config, transport: transport)
    let tokens = try await client.refresh(refreshToken: "a/b+c=d&e")
    #expect(tokens == AuthTokens(uid: "u1", idToken: "id2", refreshToken: "r2", expiresIn: 3600))
    let request = try #require(await transport.lastRequest)
    #expect(request.url.absoluteString == "https://securetoken.googleapis.com/v1/token?key=AIzaTestKey")
    #expect(request.headers["Content-Type"] == "application/x-www-form-urlencoded")
    #expect(request.bodyText == "grant_type=refresh_token&refresh_token=a%2Fb%2Bc%3Dd%26e")
  }

  @Test("lookup, delete and revokeToken bodies")
  func accountBodies() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(
      .json(200, #"{"users":[{"localId":"u1","providerUserInfo":[{"providerId":"apple.com","federatedId":"000.abc","rawId":"000.abc"}]}]}"#),
      .json(200, #"{"kind":"identitytoolkit#DeleteAccountResponse"}"#),
      .json(200, "{}")
    )
    let client = AuthClient(configuration: config, transport: transport)
    let info = try await client.lookup(idToken: "id1")
    #expect(info.localId == "u1")
    #expect(info.providerUserInfo?.first?.providerId == "apple.com")
    try await client.deleteAccount(idToken: "id1")
    try await client.revokeAppleToken(authorizationCode: "c0de", idToken: "id1")

    let requests = await transport.requests
    #expect(requests.map(\.url.path) == ["/v1/accounts:lookup", "/v1/accounts:delete", "/v2/accounts:revokeToken"])
    #expect(requests[0].bodyText == #"{"idToken":"id1"}"#)
    #expect(requests[1].bodyText == #"{"idToken":"id1"}"#)
    #expect(requests[2].bodyText == #"{"idToken":"id1","providerId":"apple.com","token":"c0de","tokenType":"CODE"}"#)
    #expect(requests[2].url.absoluteString == "https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=AIzaTestKey")
  }

  @Test("no bundle header when unset; emulator paths keep the API host prefix")
  func emulatorConfig() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(.json(200, #"{"localId":"u","idToken":"i","refreshToken":"r","expiresIn":3600}"#))
    let client = AuthClient(configuration: .emulator(host: "127.0.0.1:9099"), transport: transport)
    let tokens = try await client.signInWithApple(AppleCredential(idToken: "t", rawNonce: "n"))
    #expect(tokens.expiresIn == 3600)
    let request = try #require(await transport.lastRequest)
    #expect(request.headers["X-Ios-Bundle-Identifier"] == nil)
    #expect(
      request.url.absoluteString
        == "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key"
    )
  }
}

struct ErrorCase: Sendable, CustomStringConvertible {
  var response: HTTPResponse
  var expected: AuthError
  var description: String { "\(expected)" }
}

private let errorCases: [ErrorCase] = [
  ErrorCase(response: .googleError(400, message: "TOKEN_EXPIRED", rpcStatus: "INVALID_ARGUMENT"), expected: .tokenExpired),
  ErrorCase(response: .googleError(400, message: "USER_DISABLED"), expected: .userDisabled),
  ErrorCase(response: .googleError(400, message: "USER_NOT_FOUND"), expected: .userNotFound),
  ErrorCase(response: .googleError(400, message: "INVALID_REFRESH_TOKEN"), expected: .invalidRefreshToken),
  ErrorCase(response: .googleError(400, message: "INVALID_ID_TOKEN"), expected: .invalidIDToken),
  ErrorCase(
    response: .googleError(400, message: "INVALID_IDP_RESPONSE : The audience in ID Token [x] does not match."),
    expected: .invalidIdpResponse
  ),
  ErrorCase(response: .googleError(400, message: "MISSING_OR_INVALID_NONCE : Duplicate credential."), expected: .missingOrInvalidNonce),
  ErrorCase(response: .googleError(400, message: "OPERATION_NOT_ALLOWED"), expected: .operationNotAllowed),
  ErrorCase(response: .googleError(400, message: "CREDENTIAL_TOO_OLD_LOGIN_AGAIN"), expected: .requiresRecentLogin),
  ErrorCase(
    response: .googleError(400, message: "TOO_MANY_ATTEMPTS_TRY_LATER : Too many unsuccessful login attempts."),
    expected: .tooManyRequests
  ),
  ErrorCase(response: .googleError(400, message: "PROJECT_NUMBER_MISMATCH"), expected: .projectNumberMismatch),
  ErrorCase(
    response: .googleError(400, message: "API key not valid. Please pass a valid API key.", rpcStatus: "INVALID_ARGUMENT", reasons: ["keyInvalid"]),
    expected: .invalidAPIKey
  ),
  ErrorCase(
    response: .json(
      403,
      #"{"error":{"code":403,"message":"Requests from this iOS client application <empty> are blocked.","status":"PERMISSION_DENIED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_IOS_APP_BLOCKED","domain":"googleapis.com"}]}}"#
    ),
    expected: .appNotAuthorized
  ),
  ErrorCase(
    response: .googleError(400, message: "SOMETHING_NEW : detail"),
    expected: .server(status: 400, code: "SOMETHING_NEW", message: "SOMETHING_NEW : detail")
  ),
  ErrorCase(
    response: HTTPResponse(status: 502, body: Data("<html>Bad Gateway</html>".utf8)),
    expected: .server(status: 502, code: "<html>Bad Gateway</html>", message: "<html>Bad Gateway</html>")
  ),
]

@Suite("Auth error mapping")
struct AuthErrorMappingTests {

  @Test("Google error bodies become typed errors", arguments: errorCases)
  func mapping(_ testCase: ErrorCase) async {
    let transport = ScriptedTransport()
    await transport.enqueue(testCase.response)
    let client = AuthClient(configuration: AuthConfiguration(apiKey: "k"), transport: transport)
    await #expect(throws: testCase.expected) {
      _ = try await client.refresh(refreshToken: "r")
    }
  }

  @Test("200 answers that carry an error: errorMessage and needConfirmation")
  func softErrors() async {
    let transport = ScriptedTransport()
    await transport.enqueue(
      .json(200, #"{"errorMessage":"FEDERATED_USER_ID_ALREADY_LINKED","email":"a@b.c"}"#),
      .json(200, #"{"needConfirmation":true,"email":"a@b.c","providerId":"apple.com"}"#),
      .json(200, #"{"localId":"u1"}"#)
    )
    let client = AuthClient(configuration: AuthConfiguration(apiKey: "k"), transport: transport)
    let credential = AppleCredential(idToken: "t", rawNonce: "n")
    await #expect(throws: AuthError.accountExistsWithDifferentCredential(email: "a@b.c")) {
      _ = try await client.signInWithApple(credential)
    }
    await #expect(throws: AuthError.accountExistsWithDifferentCredential(email: "a@b.c")) {
      _ = try await client.signInWithApple(credential)
    }
    await #expect(throws: AuthError.malformedResponse("signInWithIdp returned no tokens")) {
      _ = try await client.signInWithApple(credential)
    }
  }

  @Test("network failures surface as .transport")
  func transportFailure() async {
    let transport = ScriptedTransport { _ in throw TransportError("offline") }
    let client = AuthClient(configuration: AuthConfiguration(apiKey: "k"), transport: transport)
    await #expect(throws: AuthError.transport("offline")) {
      _ = try await client.lookup(idToken: "x")
    }
  }

  @Test("which errors end a session")
  func endsSession() {
    #expect(AuthError.tokenExpired.endsSession)
    #expect(AuthError.userNotFound.endsSession)
    #expect(AuthError.userDisabled.endsSession)
    #expect(AuthError.invalidRefreshToken.endsSession)
    #expect(!AuthError.transport("x").endsSession)
    #expect(!AuthError.tooManyRequests.endsSession)
    #expect(!AuthError.projectNumberMismatch.endsSession)
  }
}
