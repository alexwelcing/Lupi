import AuthenticationServices
import Foundation
import LupiAuth

/// One Sign in with Apple exchange (account-and-sync.md §2): a fresh nonce whose SHA-256 goes
/// in Apple's request, then the credential Firebase wants, with the raw nonce and Apple's
/// authorization code (the one account deletion revokes with, §5).
@MainActor
final class AppleSignIn {
    private var nonce: AppleNonce?

    /// For `SignInWithAppleButton`'s onRequest. No scopes: the account needs no name or email.
    func prepare(_ request: ASAuthorizationAppleIDRequest) {
        let fresh = AppleNonce()
        nonce = fresh
        request.requestedScopes = []
        request.nonce = fresh.hashed
    }

    /// For its onCompletion: the credential, or nil when the player cancelled.
    func credential(from result: Result<ASAuthorization, any Error>) throws -> AppleCredential? {
        switch result {
        case let .failure(error):
            if (error as? ASAuthorizationError)?.code == .canceled { return nil }
            throw error
        case let .success(authorization):
            defer { nonce = nil }
            guard let apple = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let token = apple.identityToken.flatMap({ String(data: $0, encoding: .utf8) }),
                  let nonce else { throw AppleSignInError.incomplete }
            return AppleCredential(
                idToken: token, rawNonce: nonce.raw,
                authorizationCode: apple.authorizationCode.flatMap { String(data: $0, encoding: .utf8) },
                givenName: apple.fullName?.givenName, familyName: apple.fullName?.familyName
            )
        }
    }
}

enum AppleSignInError: Error, CustomStringConvertible {
    /// Apple answered without an identity token, or for a request this app did not make.
    case incomplete

    var description: String { "Sign in with Apple did not finish. Try again." }
}
