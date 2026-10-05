import Foundation
import LupiScaleCore
import Testing

@Suite("§12.5 formatting and §5 Magnitude")
struct MagnitudeTests {
    static let G = Spec.googol
    static var googolplex: Magnitude { Magnitude.tower(seedCount: 1000, factor: 10, levels: Spec.googolplexLevels) }
    static var googolplexTenth: Magnitude { Magnitude.tower(seedCount: 1000, factor: 10, levels: try! Spec.googolplexLevels - 1) }

    static func plain(_ text: String) -> Magnitude { Magnitude(BigUInt(decimal: text)!) }

    @Test func formattingTable() throws {
        let gp = Self.googolplex, tenth = Self.googolplexTenth
        let rows: [(Magnitude, String)] = [
            (Self.plain("953312"), "953,312"),
            (Self.plain("1000188000"), "1,000,188,000"),
            (Self.plain("1000000000000000"), "10^15"),
            (Self.plain("1234567890123456789"), "1,234,567,890,123,456,789"),
            (Self.plain("1000188000000000000000"), "1.000188 \u{00D7} 10^21"),
            (Self.plain("1234567890123456789012345"), "\u{2248} 1.235 \u{00D7} 10^24"),
            (Magnitude(BigUInt(25) * BigUInt.power(10, 30) + 7), "2.5 \u{00D7} 10^31 + 7"),
            (Magnitude(Spec.googol), "10^100"),
            (Magnitude(try Spec.googol - 1), "10^100 \u{2212} 1"),
            (gp, "10^(10^100)"),
            (tenth, "10^(10^100 \u{2212} 1)"),
            (try gp - tenth, "9 \u{00D7} 10^(10^100 \u{2212} 1)"),
            (try gp - Magnitude(1000), "10^(10^100) \u{2212} 1,000"),
            (try gp + Magnitude(5), "10^(10^100) + 5"),
            (Magnitude.tower(seedCount: 3, factor: 2, levels: 100), "3 \u{00D7} 2^100"),
            (Magnitude.tower(seedCount: 3, factor: 2, levels: 70_000), "3 \u{00D7} 2^70000"),
            (Magnitude.tower(seedCount: 24, factor: 16, levels: 40), "24 \u{00D7} 16^40"),
        ]
        for (m, text) in rows { #expect(m.formatted == text) }
    }

    /// The other rules and edge cases of §5.4.
    @Test func moreFormatting() throws {
        #expect(Magnitude(0).formatted == "0")
        #expect(Self.plain("999999999999999").formatted == "999,999,999,999,999")
        // Rule 5 rounds half to even on the exact digit string, and carries into K.
        #expect(Self.plain("1234500000000000000000000000").formatted == "1.2345 \u{00D7} 10^27")
        #expect(Self.plain("1234500000000000000000000001").formatted == "\u{2248} 1.235 \u{00D7} 10^27")
        #expect(Self.plain("1233500000000000000000000001").formatted == "\u{2248} 1.234 \u{00D7} 10^27")
        #expect(Self.plain("1234499999999999999999999999").formatted == "\u{2248} 1.234 \u{00D7} 10^27")
        #expect(Self.plain("1235500000000000000000000000000001").formatted == "\u{2248} 1.236 \u{00D7} 10^33")
        #expect(Self.plain("9999500000000000000000000000000001").formatted == "\u{2248} 1.000 \u{00D7} 10^34")
        // A googol minus a googolplex-sized exponent: exponents of 10^15 and more are themselves formatted.
        let big = Magnitude.tower(seedCount: 1, factor: 10, levels: BigUInt(1_000_000_000_000_000))
        #expect(big.formatted == "10^(10^15)")
        // Display base 2 values that are not c × 2^z fall back to decimal when plain.
        let odd = try Magnitude.tower(seedCount: 3, factor: 2, levels: 100) + Magnitude(1)
        #expect(odd.displayBase == 2)
        #expect(odd.formatted == "\u{2248} 3.803 \u{00D7} 10^30")
    }

    @Test func canonicalFormAndEquality() throws {
        // A tower count below 2^65536 is canonically plain, whatever produced it.
        let a = Magnitude.tower(seedCount: 1000, factor: 10, levels: 6)
        #expect(a == Magnitude(1_000_000_000))
        #expect(a.fitsPlain)
        #expect(a.displayBase == 10)
        // Display base never matters for equality or hashing.
        let b = Magnitude.tower(seedCount: 1, factor: 4, levels: 3)
        let c = Magnitude.tower(seedCount: 1, factor: 2, levels: 6)
        #expect(b == c)
        #expect(b.hashValue == c.hashValue)
        #expect(b.formatted == "64")
        // Above 2^65536, one family compares and adds; another family is the error `base`.
        let twos = Magnitude.tower(seedCount: 1, factor: 2, levels: 70_000)
        let fours = Magnitude.tower(seedCount: 1, factor: 4, levels: 35_000)
        #expect(twos == fours)
        #expect(try twos.compare(fours) == 0)
        #expect(try (twos + fours).formatted == "2^70001")
        let threes = Magnitude.tower(seedCount: 1, factor: 3, levels: 50_000)
        #expect(throws: ScaleError.base) { try twos + threes }
        #expect(throws: ScaleError.base) { try twos.compare(threes) }
        #expect(twos != threes)
        #expect(throws: ScaleError.range) { try Magnitude(1) - Magnitude(2) }
        #expect(throws: ScaleError.range) { try Self.googolplexTenth - Self.googolplex }
        #expect(try Self.googolplex.compare(Self.googolplexTenth) == 1)
        #expect(try Self.googolplexTenth.compare(Self.googolplex) == -1)
        #expect(try Self.googolplex.compare(Magnitude(5)) == 1)
        // Subtracting back gives the plain value.
        let back = try (Self.googolplex + Magnitude(5)) - Self.googolplex
        #expect(back == Magnitude(5))
        #expect(back.fitsPlain)
        // 3 × 2^65000 is plain; 3 × 2^70000 is not.
        #expect(Magnitude.tower(seedCount: 3, factor: 2, levels: 65_000).fitsPlain)
        #expect(!Magnitude.tower(seedCount: 3, factor: 2, levels: 70_000).fitsPlain)
    }

    @Test func mulSmallIsRepeatedDoubling() throws {
        let m = try Self.googolplex.multiplied(by: BigUInt(29_264_454_000))
        #expect(m.formatted == "2.9264454 \u{00D7} 10^(10^100 + 10)")
        #expect(try Magnitude(7).multiplied(by: 6) == Magnitude(42))
    }

    /// §5.5 [V]: ln M and ln ln M within their tolerances.
    @Test func logarithms() {
        let thousand = Magnitude(1000)
        #expect(abs(thousand.lnM - log(1000)) < 1e-9)
        #expect(abs(thousand.lnlnM - log(log(1000))) < 1e-12)
        let billion = Magnitude.tower(seedCount: 1000, factor: 10, levels: 6)
        #expect(abs(billion.lnM - log(1e9)) < 1e-9)
        let gp = Self.googolplex
        let expected = 1e100 * log(10)
        #expect(abs(gp.lnM - expected) / expected < 0x1p-40)
        #expect(abs(gp.lnlnM - (log(log(10)) + log(1e100))) < 1e-12)
        // A water grown 70,000 times: 3 × 2^70000.
        let grown = Magnitude.tower(seedCount: 3, factor: 2, levels: 70_000)
        #expect(abs(grown.lnM - (70_000 * log(2) + log(3))) / grown.lnM < 0x1p-40)
        // Beyond 2^53 digits, ln ln M stays finite.
        let deep = Magnitude.tower(seedCount: 1, factor: 2, levels: BigUInt(1) << 60)
        #expect(deep.lnlnM.isFinite)
        #expect(abs(deep.lnlnM - (log(log(2)) + 60 * log(2))) < 1e-12)
    }
}
