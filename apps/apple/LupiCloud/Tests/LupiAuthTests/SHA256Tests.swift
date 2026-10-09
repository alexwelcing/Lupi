import Foundation
import Testing

@testable import LupiAuth

/// FIPS 180-4 example vectors (NIST CSRC "Examples with Intermediate Values",
/// SHA256.pdf and SHA2_Additional.pdf).
private let nistVectors: [(String, String)] = [
  ("", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
  ("abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
  (
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  ),
  (
    "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
    "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1"
  ),
]

@Suite("SHA-256")
struct SHA256Tests {
  @Test("NIST message vectors", arguments: nistVectors)
  func vectors(_ vector: (String, String)) {
    #expect(SHA256.hexDigest(vector.0) == vector.1)
  }

  @Test("one million 'a'")
  func millionA() {
    var hasher = SHA256()
    let chunk = [UInt8](repeating: 0x61, count: 10_000)
    for _ in 0..<100 { hasher.update(chunk) }
    let hex = hasher.finalize().map { String(format: "%02x", $0) }.joined()
    #expect(hex == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")
  }

  @Test("padding boundaries: 55, 56, 63, 64 and 65 bytes")
  func paddingBoundaries() {
    // Digests from coreutils sha256sum of the same byte strings.
    let expected: [Int: String] = [
      55: "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
      56: "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
      63: "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34",
      64: "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
      65: "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0",
    ]
    for (length, digest) in expected {
      #expect(SHA256.hexDigest(String(repeating: "a", count: length)) == digest, "length \(length)")
    }
  }

  @Test("streaming in odd pieces equals one shot")
  func streaming() {
    let message = Array("The quick brown fox jumps over the lazy dog, again and again and again.".utf8)
    var hasher = SHA256()
    var index = 0
    var step = 1
    while index < message.count {
      let end = min(index + step, message.count)
      hasher.update(message[index..<end])
      index = end
      step += 2
    }
    #expect(hasher.finalize() == SHA256.hash(message))
  }
}
