import Testing
@testable import LupiChem

@Suite("element table")
struct ElementTests {
    @Test func coversZ1To118InOrder() {
        #expect(ChemicalElement.all.count == 118)
        #expect(ChemicalElement.all.enumerated().allSatisfy { $0.offset + 1 == $0.element.z })
    }

    @Test func cpkColoursMatchTheWeb() {
        // packages/core/src/elements.ts
        #expect(ChemicalElement.forAtomicNumber(1).cpk.hexString == "#ffffff")
        #expect(ChemicalElement.forAtomicNumber(6).cpk.hexString == "#909090")
        #expect(ChemicalElement.forAtomicNumber(7).cpk.hexString == "#3050f8")
        #expect(ChemicalElement.forAtomicNumber(8).cpk.hexString == "#ff0d0d")
        #expect(ChemicalElement.forAtomicNumber(17).cpk.hexString == "#1ff01f")
        #expect(ChemicalElement.forAtomicNumber(26).cpk.hexString == "#e06633")
        #expect(ChemicalElement.forAtomicNumber(29).cpk == CPKColor(red: 0xC8, green: 0x80, blue: 0x33))
    }

    @Test func radiiAndMasses() {
        let carbon = ChemicalElement.forAtomicNumber(6)
        #expect(carbon.symbol == "C")
        #expect(carbon.mass == 12.011)
        #expect(carbon.covalentRadius == 0.76)
        #expect(carbon.vdwRadius == 1.70)
        #expect(carbon.displayRadius == 0.38)
        #expect(carbon.category == .nonmetal)
        #expect(ChemicalElement.forAtomicNumber(1).displayRadius == 0.30)
        #expect(ChemicalElement.forAtomicNumber(55).displayRadius == 0.70)
    }

    @Test func symbolsAreCaseInsensitive() {
        #expect(ChemicalElement.atomicNumber(forSymbol: "Cl") == 17)
        #expect(ChemicalElement.atomicNumber(forSymbol: "CL") == 17)
        #expect(ChemicalElement.atomicNumber(forSymbol: "og") == 118)
        #expect(ChemicalElement.atomicNumber(forSymbol: "Qq") == nil)
    }

    @Test func unknownTypesKeepABondRadius() {
        let unknown = ChemicalElement.forAtomicNumber(130)
        #expect(ChemicalElement.known(130) == nil)
        #expect(unknown.covalentRadius == 1.40)
        #expect(unknown.mass == 0)
        #expect(unknown.symbol == "X130")
    }

    @Test func linearColourDecodesSRGB() {
        let white = ChemicalElement.forAtomicNumber(1).cpk.linear
        #expect(white == SIMD3(1, 1, 1))
        let grey = ChemicalElement.forAtomicNumber(6).cpk.linear.x
        #expect(abs(grey - 0.278894) < 1e-5)
    }
}
