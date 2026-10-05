import Foundation

/// The per-request nonce for Sign in with Apple. Apple gets `hashed` in
/// `ASAuthorizationAppleIDRequest.nonce` and echoes it in the ID token; Firebase
/// gets `raw` with that token and checks SHA-256(raw) against the claim, so a
/// stolen token cannot be replayed.
public struct AppleNonce: Sendable, Equatable {
  public let raw: String

  /// base64url's alphabet: 64 symbols divide 256 evenly, so mapping random
  /// bytes onto it has no modulo bias.
  static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")

  /// 32 symbols carry 192 bits. SystemRandomNumberGenerator is the platform
  /// CSPRNG (arc4random_buf on Apple platforms, getrandom on Linux).
  public init(length: Int = 32) {
    var generator = SystemRandomNumberGenerator()
    self.init(length: length, using: &generator)
  }

  /// For tests: a deterministic generator gives a deterministic nonce.
  public init<G: RandomNumberGenerator>(length: Int = 32, using generator: inout G) {
    precondition(length > 0, "nonce length must be positive")
    var symbols: [Character] = []
    symbols.reserveCapacity(length)
    while symbols.count < length {
      var word = generator.next() as UInt64
      for _ in 0..<8 where symbols.count < length {
        symbols.append(AppleNonce.alphabet[Int(word & 0x3f)])
        word >>= 8
      }
    }
    raw = String(symbols)
  }

  public init(raw: String) {
    self.raw = raw
  }

  /// SHA-256 of the raw nonce as lowercase hex, for Apple's request.
  public var hashed: String { SHA256.hexDigest(raw) }
}
