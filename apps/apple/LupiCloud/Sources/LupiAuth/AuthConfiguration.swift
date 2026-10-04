import Foundation

/// Where and how LupiAuth talks to Firebase Authentication.
public struct AuthConfiguration: Sendable, Equatable {
  /// The Firebase Web API key of the project (shed-489901). Sent as `?key=`.
  public var apiKey: String
  /// Sent as `X-Ios-Bundle-Identifier` on every Auth request. A Google API key
  /// restricted to iOS apps only accepts requests that carry an allowed bundle
  /// ID in this header (cloud.google.com/docs/authentication/api-keys). nil
  /// omits the header, e.g. against the emulator.
  public var bundleIdentifier: String?
  /// Base for Identity Toolkit (`v1/accounts:…`, `v2/accounts:revokeToken`).
  public var identityToolkitBase: URL
  /// Base for the Secure Token service (`v1/token`).
  public var secureTokenBase: URL
  /// `requestUri` for accounts:signInWithIdp. Required by the API, unused for
  /// ID-token credentials; the Firebase iOS SDK sends "http://localhost".
  public var requestURI: String

  public init(
    apiKey: String,
    bundleIdentifier: String? = "live.lupi.app",
    identityToolkitBase: URL = URL(string: "https://identitytoolkit.googleapis.com/")!,
    secureTokenBase: URL = URL(string: "https://securetoken.googleapis.com/")!,
    requestURI: String = "http://localhost"
  ) {
    self.apiKey = apiKey
    self.bundleIdentifier = bundleIdentifier
    self.identityToolkitBase = identityToolkitBase
    self.secureTokenBase = secureTokenBase
    self.requestURI = requestURI
  }

  /// The Firebase Auth emulator serves both APIs under its own host, prefixed
  /// by the production host name (as the Firebase SDKs address it).
  public static func emulator(host: String, apiKey: String = "fake-api-key") -> AuthConfiguration {
    AuthConfiguration(
      apiKey: apiKey,
      bundleIdentifier: nil,
      identityToolkitBase: URL(string: "http://\(host)/identitytoolkit.googleapis.com/")!,
      secureTokenBase: URL(string: "http://\(host)/securetoken.googleapis.com/")!
    )
  }
}
