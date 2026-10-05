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

    @Test func weakerBondsBreakAtSmallerSpeed() throws {
        let ethanol = try derive("ethanol").personality
        let water = try derive("water").personality
        // Both small and bouncy; water's O–H (459) outlasts ethanol's C–C (346).
        #expect(ethanol.breakSpeed < water.breakSpeed)
        let ratio = (346.0 / 459).squareRoot()
        #expect(abs(ethanol.breakSpeed / water.breakSpeed - ratio) < 1e-12)
    }

    @Test func derivationIsDeterministicAndEncodesNineKeys() throws {
        let a = try derive("tryptophan")
        let b = try derive("tryptophan")
        #expect(a == b)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(a.personality)) as? [String: Any]
        #expect(Set(json?.keys ?? [:].keys) == [
            "kind", "restitution", "friction", "linearDamping", "angularDamping", "breakSpeed", "massScale",
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
            #expect(p.breakSpeed > 0, "\(name)")
            #expect((0...1).contains(p.hapticSharpness), "\(name)")
        }
    }

    @Test func breakImpulseIsFeltMassTimesBreakSpeed() throws {
        let p = try derive("caffeine").personality
        let mass = try #require(GameUnits.feltMass(molarMass: 194.19, massScale: p.massScale))
        #expect(p.breakImpulse(feltMass: mass) == mass * p.breakSpeed)
        let n2 = Personality.derive(Molecule(atomicNumbers: [7, 7], positions: [Vec3.zero, Vec3(1.098, 0, 0)])).personality
        #expect(n2.breakImpulse(feltMass: 0.1) == nil)
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

    /// scale-spec §10.2 written out in full, the test's own reference for the
    /// shared domain (LupiKit ships only the branch below the knee).
    static func specFeltMass(_ m: Double, _ massScale: Double) -> Double {
        let knee = 180 * pow(2, 2.5)
        let a = 0.8 * log(knee)
        let x = log(m) + 2.5 * log(massScale)
        let b = x <= log(knee)
            ? 0.2 * exp(0.4 * (x - log(180.0)))
            : 0.6 - 0.2 / (1 + a * (log(log(m)) + log1p(2.5 * log(massScale) / log(m)) - log(log(knee))))
        return max(0.06, b)
    }

    @Test func feltMassBelowTheKneeIsTheSpecsTable() throws {
        func kg(_ m: Double, _ scale: Double = 1) throws -> Double {
            try #require(GameUnits.feltMass(molarMass: m, massScale: scale))
        }
        let water = Molecule(atomicNumbers: [8, 1, 1], positions: [Vec3.zero, Vec3(0.96, 0, 0), Vec3(-0.24, 0.93, 0)])
        // scale-spec §10.2 and contracts.md §3.2, to the digits they print.
        #expect(abs(try kg(water.molarMass) - 0.080) < 0.0005)
        #expect(abs(try kg(194.19) - 0.206) < 0.0005)
        #expect(abs(try kg(720.66) - 0.348) < 0.0005)
        #expect(abs(try kg(34.0147, 0.85) - 0.087) < 0.0005)
        #expect(abs(try kg(720.66, 0.8) - 0.279) < 0.0005)
        // Identical to the spec's curve wherever the branch answers.
        for m in [2.016, 9.0, 18.015, 46.069, 180.156, 500, 1000, 1018] {
            for scale in [0.8, 0.85, 0.9, 1.0] where m * pow(scale, 2.5) <= GameUnits.feltMassKneeDa {
                #expect(abs(try kg(m, scale) - Self.specFeltMass(m, scale)) < 1e-15, "\(m) \(scale)")
            }
        }
        // The floor: hydrogen weighs 0.06, not less.
        #expect(try kg(2.016) == 0.06)
        // The knee is 0.4 kg (2^(2.5 × 0.4) = 2), where the spec's tail takes over continuously.
        #expect(abs(try kg(GameUnits.feltMassKneeDa) - 0.4) < 1e-12)
        #expect(abs(Self.specFeltMass(GameUnits.feltMassKneeDa * (1 + 1e-9), 1) - 0.4) < 1e-6)
    }

    @Test func feltMassAboveTheKneeIsLeftToLupiScale() {
        // Hemoglobin and the salt rungs are the tail's (scale-spec §10.2's table).
        #expect(GameUnits.feltMass(molarMass: 64_500) == nil)
        #expect(GameUnits.feltMass(molarMass: 29_264, massScale: 0.85) == nil)
        #expect(GameUnits.feltMass(molarMass: 1019) == nil)
        // A brittle molecule stays on the branch further: 1,500 × 0.85^2.5 ≈ 999 Da.
        #expect(GameUnits.feltMass(molarMass: 1500, massScale: 0.85) != nil)
        #expect(GameUnits.feltMass(molarMass: 0) == nil)
        #expect(GameUnits.feltMass(molarMass: .infinity) == nil)
        // The test's reference reproduces the spec's table above the knee, so the two agree where they meet.
        #expect(abs(Self.specFeltMass(64_500, 1) - 0.544) < 0.0005)
        #expect(abs(Self.specFeltMass(29_264, 1) - 0.537) < 0.0005)
        #expect(abs(Self.specFeltMass(29_264, 0.85) - 0.533) < 0.0005)
    }

    @Test func principalMomentsKeepTheShape() throws {
        let caffeine = try PlayFixtures.molecule("caffeine")
        let facts = caffeine.inertia
        let mass = try #require(GameUnits.feltMass(molarMass: facts.mass))
        let moments = GameUnits.molecule.principalMoments(facts, mass: mass)
        #expect(abs(moments.x / moments.z - facts.moments.x / facts.moments.z) < 1e-12)
        // I = m r² in kg·m² at 1 Å = 1 cm: caffeine's radius of gyration is ~2.6 Å, so I ~ 0.13 · 0.026².
        #expect(moments.z > 1e-5 && moments.z < 1e-3)
    }
}
