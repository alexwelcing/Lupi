import Foundation
import Testing
import LupiChem
@testable import LupiPlay

/// Molecules from the chem fixtures (the bond fixture files carry their XYZ).
enum PlayFixtures {
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures/bonds")

    struct File: Decodable {
        var cases: [Case]
    }

    struct Case: Decodable {
        var name: String
        var xyz: String?
        var atomicNumbers: [Int]
        var positions: [Double]
    }

    static func molecule(_ name: String) throws -> Molecule {
        for file in ["bonds-gallery.json", "bonds-synthetic.json", "bonds-omol25.json"] {
            let data = try Data(contentsOf: root.appendingPathComponent(file))
            let fixture = try JSONDecoder().decode(File.self, from: data)
            guard let item = fixture.cases.first(where: { $0.name == name }) else { continue }
            if let xyz = item.xyz { return try Molecule(xyz: xyz, name: name) }
            let positions = stride(from: 0, to: item.positions.count, by: 3).map {
                Vec3(item.positions[$0], item.positions[$0 + 1], item.positions[$0 + 2])
            }
            return Molecule(atomicNumbers: item.atomicNumbers, positions: positions, name: name)
        }
        throw CocoaError(.fileNoSuchFile)
    }
}

@Suite("personality")
struct PersonalityTests {
    func derive(_ name: String) throws -> PersonalityDerivation {
        Personality.derive(try PlayFixtures.molecule(name))
    }

    @Test func c60IsABouncyCage() throws {
        let d = try derive("c60_buckyball")
        #expect(d.personality.kind == .bouncy)
        #expect(d.rule == .cage)
        #expect(d.personality.soundFamily == .boing)
        // Every C60 bond is on a cycle: knocking one carbon off breaks three bonds, past the 800 kJ/mol line.
        let weakest = try #require(d.features.weakestBond)
        #expect(d.features.cutStrength.map { $0 >= 3 * weakest.kJPerMol } == true)
        #expect(d.personality.isUnbreakable)
        #expect(d.plaque == "Bouncy: a closed cage · will not snap")
    }

    @Test func caffeineIsRigidWithTwoFusedRings() throws {
        let d = try derive("caffeine")
        #expect(d.personality.kind == .rigid)
        #expect(d.plaque == "Rigid: two fused rings")
        #expect(d.personality.restitution > PersonalityTable.v1.rigid.restitution)
    }

    @Test func cholesterolsTailMakesItFlexible() throws {
        let d = try derive("cholesterol")
        #expect(d.personality.kind == .flexible)
        #expect(d.rule == .rotors)
        #expect(d.personality.angularDamping >= PersonalityTable.v1.flexible.angularDamping)
    }

    @Test func saltIsBrittle() throws {
        let d = try derive("salt-cube")
        #expect(d.personality.kind == .brittle)
        #expect(d.rule == .ionic)
        #expect(d.personality.soundFamily == .crackle)
        #expect(d.personality.hapticSharpness > 0.9)
    }

    @Test func peroxideIsBrittleAtItsOxygenBond() {
        let peroxide = Molecule(
            atomicNumbers: [8, 8, 1, 1],
            positions: [Vec3(0, 0.7375, -0.05), Vec3(0, -0.7375, -0.05), Vec3(0.8, 0.9, 0.42), Vec3(-0.8, -0.9, 0.42)]
        )
        let d = Personality.derive(peroxide)
        #expect(d.personality.kind == .brittle)
        #expect(d.plaque == "Brittle: weakest bond O–O, 142 kJ/mol")
    }

    @Test func nitrogenWillNotSnap() {
        let n2 = Molecule(atomicNumbers: [7, 7], positions: [Vec3.zero, Vec3(1.098, 0, 0)])
        let d = Personality.derive(n2)
        #expect(d.features.weakestBond?.label == "N≡N")
        #expect(d.personality.isUnbreakable)
        #expect(d.personality.kind == .bouncy)
        #expect(d.plaque == "Bouncy: small and tight · will not snap")
    }

    @Test func singleAtomHasNothingToBreak() {
        let d = Personality.derive(Molecule(atomicNumbers: [18], positions: [Vec3.zero]))
        #expect(d.personality.isUnbreakable)
        #expect(d.features.cutStrength == nil)
    }

    @Test func weakerBondsBreakAtSmallerImpulse() throws {
        let ethanol = try derive("ethanol").personality
        let water = try derive("water").personality
        // Both small and bouncy; per kilogram, water's O–H (459) outlasts ethanol's C–C (346).
        let ethanolMass = GameUnits.molecule.mass(molarMass: 46.069) * ethanol.massScale
        let waterMass = GameUnits.molecule.mass(molarMass: 18.015) * water.massScale
        #expect(ethanol.breakImpulse / ethanolMass < water.breakImpulse / waterMass)
    }

    @Test func derivationIsDeterministicAndEncodesNineKeys() throws {
        let a = try derive("tryptophan")
        let b = try derive("tryptophan")
        #expect(a == b)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(a.personality)) as? [String: Any]
        #expect(Set(json?.keys ?? [:].keys) == [
            "kind", "restitution", "friction", "linearDamping", "angularDamping", "breakImpulse", "massScale",
            "soundFamily", "hapticSharpness",
        ])
        let back = try JSONDecoder().decode(Personality.self, from: JSONEncoder().encode(a.personality))
        #expect(back == a.personality)
    }

    @Test func everyFixtureGetsABoundedPersonality() throws {
        for name in ["water", "benzene", "glucose", "atp", "sucrose", "lsd", "diborane", "ferrocene", "cisplatin",
                     "diamond_crystal", "carbon_nanotube", "graphene_ribbon", "omol25_nv_1008", "omol25_nv_23477"] {
            let p = try derive(name).personality
            #expect((0...0.95).contains(p.restitution), "\(name)")
            #expect((0...1).contains(p.friction), "\(name)")
            #expect(p.breakImpulse > 0, "\(name)")
            #expect((0...1).contains(p.hapticSharpness), "\(name)")
        }
    }

    @Test func scalingFollowsFeltMass() throws {
        let p = try derive("caffeine").personality
        #expect(abs(p.scaled(by: 10).breakImpulse - 10 * p.breakImpulse) < 1e-12)
        let n2 = Personality.derive(Molecule(atomicNumbers: [7, 7], positions: [Vec3.zero, Vec3(1.098, 0, 0)])).personality
        #expect(n2.scaled(by: 10).breakImpulse == Personality.unbreakable)
    }
}

@Suite("game units")
struct GameUnitsTests {
    @Test func moleculeScaleIsTenToTheEighth() {
        let units = GameUnits.molecule
        #expect(units.meters(1) == 0.01)
        #expect(units.magnification() == 1e8)
        #expect(units.magnificationLabel() == "10⁸×")
        #expect(units.magnificationLabel(displayScale: 10) == "10⁹×")
        #expect(units.magnificationLabel(displayScale: 3) == "3 × 10⁸×")
        #expect(GameUnits.colossus.magnificationLabel() == "10⁷×")
        #expect(GameUnits.forSpan(10) == .molecule)
        #expect(GameUnits.forSpan(250) == .colossus)
    }

    @Test func feltMassIsCompressedButOrdered() {
        let units = GameUnits.molecule
        let h2 = units.mass(molarMass: 2.016)
        let water = units.mass(molarMass: 18.015)
        let caffeine = units.mass(molarMass: 194.19)
        let hemoglobin = units.mass(molarMass: 64_500)
        let colossus = units.mass(molarMass: 63.546 * 1_000_000)
        #expect(abs(water - 0.05) < 1e-12)
        #expect(h2 > 0.015 && h2 < 0.03)
        #expect(caffeine > 0.12 && caffeine < 0.14)
        #expect(hemoglobin > 1 && hemoglobin < 2)
        #expect(colossus > 15 && colossus < 30)
        #expect(h2 < water && water < caffeine && caffeine < hemoglobin && hemoglobin < colossus)
        // Real ratio ~3×10⁴, felt ~60.
        #expect(hemoglobin / h2 < 100)
        #expect(units.mass(molarMass: 18.015, displayScale: 10) == 0.5)
    }

    @Test func principalMomentsKeepTheShape() throws {
        let caffeine = try PlayFixtures.molecule("caffeine")
        let facts = caffeine.inertia
        let mass = GameUnits.molecule.mass(molarMass: facts.mass)
        let moments = GameUnits.molecule.principalMoments(facts, mass: mass)
        #expect(abs(moments.x / moments.z - facts.moments.x / facts.moments.z) < 1e-12)
        // I = m r² in kg·m² at 1 Å = 1 cm: caffeine's radius of gyration is ~2.6 Å, so I ~ 0.13 · 0.026².
        #expect(moments.z > 1e-5 && moments.z < 1e-3)
    }
}
