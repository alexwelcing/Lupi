import Foundation
import LupiScaleCore
import Testing

@Suite("§12.1 primitives")
struct PrimitiveTests {
    @Test func crc32Check() {
        #expect(CRC32.checksum(Array("123456789".utf8)) == 0xCBF4_3926)
    }

    @Test func splitMix64Vectors() {
        var g = SplitMix64(seed: 0)
        #expect([g.next(), g.next(), g.next()] == [0xe220a8397b1dcdaf, 0x6e789e6aa1b965f4, 0x06c45d188009454f])
        var h = SplitMix64(seed: 0x0123_4567_89ab_cdef)
        #expect([h.next(), h.next(), h.next()] == [0x157a3807a48faa9d, 0xd573529b34a1d093, 0x2f90b72e996dccbe])
    }

    /// BigUInt encodings of 0, 1, 255, 256 and 10^100, concatenated, through a tower record's
    /// `levels` field: the only public writer of a lone BigUInt.
    @Test func bigUIntEncodings() throws {
        let expected = "00000100010100ff020000012a00000000000000000000000000108f2ea80843b2aa7c1a218e40ce8af30bcec484270beb7cc39425ad4912"
        var all: [UInt8] = []
        for v in [BigUInt(0), 1, 255, 256, Spec.googol] {
            let rec = try NodeRecord(.tower(TowerNode(seed: Spec.seed.id, factor: 10, periodsQ16: Spec.saltPeriods, levels: v)))
            all += Array(rec.bytes[120...])
        }
        #expect(hexString(all) == expected)
        // 256 is 02 00 00 01 (§1.2).
        #expect(BigUInt(256).littleEndianBytes == [0, 1])
    }

    @Test func sha256KnownAnswers() {
        // FIPS 180-4 examples ("abc", the empty string, the two-block message).
        #expect(NodeID.hashing(Array("abc".utf8)).hex == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        #expect(NodeID.hashing([]).hex == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        let two = Array("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8)
        #expect(NodeID.hashing(two).hex == "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
        // A million 'a's crosses many blocks and the incremental buffer.
        #expect(NodeID.hashing([UInt8](repeating: 0x61, count: 1_000_000)).hex
            == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")
    }

    @Test func bigUIntArithmetic() throws {
        let a = BigUInt(decimal: "123456789012345678901234567890")!
        let b = BigUInt(decimal: "987654321098765432109876543210")!
        #expect((a + b).decimal == "1111111110111111111011111111100")
        #expect(try (b - a).decimal == "864197532086419753208641975320")
        #expect((a * b).decimal == "121932631137021795226185032733622923332237463801111263526900")
        #expect(a.dividedSmall(97).remainder == 52)
        #expect(Spec.googol.decimal == "1" + String(repeating: "0", count: 100))
        #expect(Spec.googol.bitWidth == 333)
        #expect(throws: ScaleError.range) { try a - b }
        #expect(((BigUInt(1) << 100) >> 99) == 2)
        #expect(BigUInt(3).digits(base: 2) == [1, 1])
        #expect(BigUInt(255).digits(base: 16) == [15, 15])
        #expect(BigUInt(decimal: "1000")!.digits(base: 3) == [1, 1, 0, 1, 0, 0, 1])
    }
}
