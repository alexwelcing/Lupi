import Foundation
import LupiHTTP

/// Typed Firebase Auth failures. Codes come from Google's error bodies
/// (`error.message`, read up to the first colon) as documented at
/// firebase.google.com/docs/reference/rest/auth and mapped by the Firebase iOS
/// SDK's AuthBackend.
public enum AuthError: Error, Sendable, Equatable {
  /// The refresh token or credential is no longer valid; sign in again.
  case tokenExpired
  case invalidRefreshToken
  case invalidIDToken
  /// The account is disabled by an administrator.
  case userDisabled
  /// The account no longer exists (deleted elsewhere).
  case userNotFound
  /// Sensitive operations (account deletion) need a recent sign-in.
  case requiresRecentLogin
  /// The Apple ID token is malformed, expired, or its audience is not one of
  /// the project's registered bundle IDs.
  case invalidIdpResponse
  /// SHA-256(rawNonce) did not match the nonce claim in Apple's ID token.
  case missingOrInvalidNonce
  /// The Apple provider is not enabled in the Firebase project.
  case operationNotAllowed
  /// An account with the same email exists with another provider (Firebase's
  /// one-account-per-email setting). Carries the email when the server sent it.
  case accountExistsWithDifferentCredential(email: String?)
  case invalidAPIKey
  /// The API key's application restriction rejected this app (bundle ID).
  case appNotAuthorized
  case projectNumberMismatch
  case tooManyRequests
  case notSignedIn
  /// Re-authentication produced a different user than the signed-in one.
  case reauthenticationMismatch
  /// A server error with a code this client does not model.
  case server(status: Int, code: String, message: String)
  /// A 2xx body that did not decode.
  case malformedResponse(String)
  case transport(String)

  /// Errors after which the stored session can never work again.
  public var endsSession: Bool {
    switch self {
    case .tokenExpired, .invalidRefreshToken, .userDisabled, .userNotFound:
      return true
    default:
      return false
    }
  }

  static func from(_ error: GoogleAPIError, email: String? = nil) -> AuthError {
    from(code: error.shortCode, error: error, email: email)
  }

  static func from(code: String, error: GoogleAPIError, email: String? = nil) -> AuthError {
    switch code {
    case "TOKEN_EXPIRED": return .tokenExpired
    case "INVALID_REFRESH_TOKEN": return .invalidRefreshToken
    case "INVALID_ID_TOKEN": return .invalidIDToken
    case "USER_DISABLED": return .userDisabled
    case "USER_NOT_FOUND": return .userNotFound
    case "CREDENTIAL_TOO_OLD_LOGIN_AGAIN": return .requiresRecentLogin
    case "INVALID_IDP_RESPONSE": return .invalidIdpResponse
    case "MISSING_OR_INVALID_NONCE": return .missingOrInvalidNonce
    case "OPERATION_NOT_ALLOWED": return .operationNotAllowed
    case "EMAIL_EXISTS", "FEDERATED_USER_ID_ALREADY_LINKED":
      return .accountExistsWithDifferentCredential(email: email)
    case "PROJECT_NUMBER_MISMATCH": return .projectNumberMismatch
    case "TOO_MANY_ATTEMPTS_TRY_LATER", "QUOTA_EXCEEDED": return .tooManyRequests
    default:
      break
    }
    // Key problems arrive as ordinary Google API errors, not Auth codes.
    if error.reasons.contains(where: { $0.hasPrefix("keyInvalid") || $0 == "API_KEY_INVALID" })
      || error.message.hasPrefix("API key not valid")
    {
      return .invalidAPIKey
    }
    if error.reasons.contains(where: {
      $0 == "ipRefererBlocked" || $0 == "API_KEY_IOS_APP_BLOCKED" || $0 == "API_KEY_SERVICE_BLOCKED"
    }) {
      return .appNotAuthorized
    }
    return .server(status: error.httpStatus, code: code, message: error.message)
  }
}
