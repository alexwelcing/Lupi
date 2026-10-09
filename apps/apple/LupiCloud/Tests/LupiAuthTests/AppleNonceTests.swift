import Foundation
import Testing

@testable import LupiAuth

/// SplitMix64, so a nonce can be pinned in a test.
struct SplitMix64: RandomNumberGenerator {
  var state: UInt64
  mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var z = state
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
  }
}

@Suite("Apple nonce")
struct AppleNonceTests {
  @Test("32 URL-safe symbols by default, from the 64-symbol alphabet")
  func shape() {
    let nonce = AppleNonce()
    #expect(nonce.raw.count == 32)
    let alphabet = Set(AppleNonce.alphabet)
    #expect(nonce.raw.allSatisfy { alphabet.contains($0) })
    #expect(AppleNonce(length: 7).raw.count == 7)
    #expect(AppleNonce(length: 100).raw.count == 100)
  }

  @Test("fresh every time")
  func unique() {
    let nonces = Set((0..<1000).map { _ in AppleNonce().raw })
    #expect(nonces.count == 1000)
  }

  @Test("hashed is the lowercase hex SHA-256 of raw")
  func hashed() {
    let nonce = AppleNonce(raw: "abc")
    #expect(nonce.hashed == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  }

  @Test("deterministic generator gives a pinned nonce and an unbiased spread")
  func deterministic() {
    var a = SplitMix64(state: 42)
    var b = SplitMix64(state: 42)
    #expect(AppleNonce(using: &a) == AppleNonce(using: &b))

    // Every symbol shows up at about the same rate (no modulo bias).
    var generator = SplitMix64(state: 7)
    var counts: [Character: Int] = [:]
    for _ in 0..<2000 {
      for symbol in AppleNonce(length: 32, using: &generator).raw { counts[symbol, default: 0] += 1 }
    }
    #expect(counts.count == 64)
    let mean = Double(2000 * 32) / 64
    #expect(counts.values.allSatisfy { abs(Double($0) - mean) < mean * 0.15 })
  }
}
