import Testing
@testable import LupiChem

@Suite("bond perception")
struct BondPerceptionTests {
    /// apps/web/public/gallery/curated/popular/caffeine.xyz
    static let caffeine = """
    24
    Caffeine generated from PubChem 3D SDF
    O 0.47 2.5688 0.0006
    O -3.1271 -0.4436 -0.0003
    N -0.9686 -1.3125 0.0
    N 2.2182 0.1412 -0.0003
    N -1.3477 1.0797 -0.0001
    N 1.4119 -1.9372 0.0002
    C 0.8579 0.2592 -0.0008
    C 0.3897 -1.0264 -0.0004
    C 0.0307 1.422 -0.0006
    C -1.9061 -0.2495 -0.0004
    C 2.5032 -1.1998 0.0003
    C -1.4276 -2.696 0.0008
    C 3.1926 1.2061 0.0003
    C -2.2969 2.1881 0.0007
    H 3.5163 -1.5787 0.0008
    H -1.0451 -3.1973 -0.8937
    H -2.5186 -2.7596 0.0011
    H -1.0447 -3.1963 0.8957
    H 4.1992 0.7801 0.0002
    H 3.0468 1.8092 -0.8992
    H 3.0466 1.8083 0.9004
    H -1.8087 3.1651 -0.0003
    H -2.9322 2.1027 0.8881
    H -2.9346 2.1021 -0.8849
    """

    @Test func toleranceIsClamped() {
        #expect(BondPerception.clampTolerance(nil) == 0.45)
        #expect(BondPerception.clampTolerance(.nan) == 0.45)
        #expect(BondPerception.clampTolerance(9) == 1.5)
        #expect(BondPerception.clampTolerance(-1) == 0)
    }

    @Test func distanceRecipeIsEveryPairWithinTheCutoff() throws {
        let molecule = try Molecule(xyz: Self.caffeine)
        var expected: [[Int]] = []
        for i in 0..<molecule.count {
            for j in (i + 1)..<molecule.count {
                let a = Vec3(molecule.positions[i]), b = Vec3(molecule.positions[j])
                let d = b - a
                let d2 = d.x * d.x + d.y * d.y + d.z * d.z
                let cut = BondRadii.covalent(molecule.atomicNumbers[i]) + BondRadii.covalent(molecule.atomicNumbers[j]) + 0.45
                if d2 > 0 && d2 <= cut * cut { expected.append([i, j]) }
            }
        }
        let p = BondPerception.perceive(molecule, recipe: .distance)
        #expect(p.bonds.map { [$0.i, $0.j] } == expected)
        #expect(p.bonds.allSatisfy { $0.kind == .covalent })
        let molecular = BondPerception.perceive(molecule)
        #expect(molecular.counts.covalent == 25)
        #expect(molecular.counts.removed == 0)
        #expect(molecular.counts.fragments == 1)
    }

    @Test func leanRunKeepsTheCounts() throws {
        let molecule = try Molecule(xyz: Self.caffeine)
        let lean = BondPerception.perceive(molecule, collectEvidence: false)
        #expect(lean.evidence == nil)
        #expect(lean.counts == BondPerception.perceive(molecule).counts)
    }

    @Test func recipeGate() {
        let chemistry = FrameChemistry(totalCharge: 0, spinMultiplicity: 1, source: .record, domain: nil)
        #expect(selectBondRecipe(atomCount: 24, frameCount: 1, sourceBondCount: 3, periodic: false, chemistry: nil, isOmol25Record: false) == .source)
        #expect(selectBondRecipe(atomCount: 24, frameCount: 1, periodic: false, chemistry: chemistry, isOmol25Record: false) == .inferred(.molecular))
        #expect(selectBondRecipe(atomCount: 24, frameCount: 1, periodic: false, chemistry: nil, isOmol25Record: false) == .inferred(.distance))
        #expect(selectBondRecipe(atomCount: 24, frameCount: 5, periodic: false, chemistry: chemistry, isOmol25Record: false) == .inferred(.distance))
        #expect(selectBondRecipe(atomCount: 24, frameCount: 5, periodic: false, chemistry: chemistry, isOmol25Record: true) == .inferred(.molecular))
        #expect(selectBondRecipe(atomCount: 2001, frameCount: 1, periodic: false, chemistry: chemistry, isOmol25Record: true, profile: .molecular) == .inferred(.distance))
        #expect(selectBondRecipe(atomCount: 24, frameCount: 1, periodic: true, chemistry: chemistry, isOmol25Record: false, profile: .molecular) == .inferred(.distance))
        #expect(selectBondRecipe(atomCount: 24, frameCount: 1, periodic: false, chemistry: nil, isOmol25Record: false, profile: .molecular) == .inferred(.molecular))
        #expect(selectBondRecipe(atomCount: 24, frameCount: 1, inferenceAllowed: false, periodic: false, chemistry: nil, isOmol25Record: false) == nil)
    }

    @Test func maxIonContactIsTheComputedBound() {
        #expect(abs(BondRadii.maxIonContact - 4.35) < 1e-12)
    }
}
