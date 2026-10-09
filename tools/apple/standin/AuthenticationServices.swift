// Stand-in for the Sign in with Apple types the app uses (developer.apple.com, iOS 13+).
import Foundation
import SwiftUI
public protocol ASAuthorizationCredential: NSObjectProtocol {}
open class ASAuthorization: NSObject {
    public struct Scope: Hashable, Sendable { public static let fullName = Scope(); public static let email = Scope() }
    open var credential: any ASAuthorizationCredential { fatalError() }
}
open class ASAuthorizationAppleIDCredential: NSObject, ASAuthorizationCredential {
    open var identityToken: Data? { nil }
    open var authorizationCode: Data? { nil }
    open var fullName: PersonNameComponents? { nil }
}
open class ASAuthorizationOpenIDRequest: NSObject {
    open var nonce: String?
    open var requestedScopes: [ASAuthorization.Scope]?
}
open class ASAuthorizationAppleIDRequest: ASAuthorizationOpenIDRequest {}
public struct ASAuthorizationError: Error {
    public struct Code: Equatable, Sendable { public static let canceled = Code(); public static let failed = Code() }
    public var code: Code { .failed }
}

// developer.apple.com: SignInWithAppleButton (iOS 14) and signInWithAppleButtonStyle(_:).
public struct SignInWithAppleButton: View {
    public enum Label: Sendable { case signIn, `continue`, signUp }
    public struct Style: Sendable { public static let black = Style(), white = Style(), whiteOutline = Style() }
    public init(_ label: Label = .signIn, onRequest: @escaping (ASAuthorizationAppleIDRequest) -> Void, onCompletion: @escaping (Result<ASAuthorization, any Error>) -> Void) {}
    public var body: Never { fatalError() }
}
extension View {
    public func signInWithAppleButtonStyle(_ style: SignInWithAppleButton.Style) -> some View { self }
}
