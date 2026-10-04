import Foundation
import Testing
@testable import LupiChem

@Suite("XYZ parser")
struct XYZParserTests {
    @Test func firstFrameOnlyReportsMoreFrames() throws {
        let text = "1\na\nH 0 0 0\n1\nb\nH 1 1 1\n"
        let one = try XYZParser.parse(text, maxFrames: 1)
        #expect(one.frames.count == 1)
        #expect(one.hasMoreFrames)
        let all = try XYZParser.parse(text)
        #expect(all.frames.count == 2)
        #expect(!all.hasMoreFrames)
    }

    @Test func latticeNumbersAreKept() throws {
        let frame = try XYZParser.parse("1\nLattice=\"3.6 0 0 0 3.6 0 0 0 3.6\"\nCu 0 0 0\n").first
        #expect(frame.periodic)
        #expect(frame.lattice == [3.6, 0, 0, 0, 3.6, 0, 0, 0, 3.6])
    }

    @Test func commentPairsFollowTheWebRegex() {
        let pairs = XYZParser.commentPairs("OMol25 x row=3 | a.b=1 key = \"two words\" bad= k='q' open=\"x")
        // `bad=` swallows the next token, as the regex does; an unclosed quote is a bare value.
        #expect(pairs.map(\.key) == ["row", "b", "key", "bad", "open"])
        #expect(pairs.map(\.value) == ["3", "1", "two words", "k='q'", "\"x"])
    }

    @Test func javaScriptNumberSemantics() {
        #expect(JSText.number("1.0") == 1)
        #expect(JSText.number(" 0x1F ") == 31)
        #expect(JSText.number("") == 0)
        #expect(JSText.number("1e3") == 1000)
        #expect(JSText.number("-0x10").isNaN)
        #expect(JSText.number("nan").isNaN)
        #expect(JSText.number("inf").isNaN)
        #expect(JSText.number("Infinity") == .infinity)
        #expect(JSText.boundedInteger("2.5", min: 0, max: 10) == nil)
        #expect(JSText.boundedInteger("-3", min: -20, max: 20) == -3)
    }

    @Test func moleculeFromXYZ() throws {
        let water = try Molecule(xyz: "3\nwater\nO 0 0 0.1173\nH 0 0.7572 -0.4692\nH 0 -0.7572 -0.4692\n")
        #expect(water.hillFormula == "H2O")
        #expect(abs(water.molarMass - 18.015) < 1e-9)
        #expect(water.heavyAtomCount == 1)
    }
}
