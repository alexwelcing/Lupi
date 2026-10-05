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

    static let peroxide = Molecule(
        atomicNumbers: [8, 8, 1, 1],
        positions: [Vec3(0, 0.7375, -0.05), Vec3(0, -0.7375, -0.05), Vec3(0.8, 0.9, 0.42), Vec3(-0.8, -0.9, 0.42)]
    )

    @Test func tableIsTheContracts() {
        // contracts.md §3.3 rule 5, column by column.
        let t = PersonalityTable.v1
        let rows: [(PersonalityTable.Preset, [Double], ImpactFamily)] = [
            (t.rigid, [0.35, 0.7, 0.5, 0.05, 0.08, 3.0, 1.0, 0.06, 0.8], .clack),
            (t.flexible, [0.15, 0.9, 0.7, 0.12, 0.45, 4.5, 0.9, 0.18, 0.3], .thwap),
            (t.brittle, [0.20, 0.6, 0.45, 0.05, 0.10, 1.2, 0.85, 0.03, 1.0], .tink),
            (t.bouncy, [0.85, 0.5, 0.35, 0.02, 0.03, 6.5, 0.8, 0.25, 0.5], .boing),
        ]
        for (p, values, family) in rows {
            #expect([p.restitution, p.staticFriction, p.dynamicFriction, p.linearDamping, p.angularDamping, p.breakSpeed,
                     p.massScale, p.squash, p.hapticSharpness] == values)
            #expect(p.soundFamily == family)
        }
        #expect(Personality.SoundFamily.allCases.map(\.rawValue) == ["clack", "thwap", "tink", "boing"])
    }

    @Test func c60IsABouncyRoundCageThatRings() throws {
        let d = try derive("c60_buckyball")
        #expect(d.personality.kind == .bouncy)
        #expect(d.rule == .cage)
        #expect(d.rings)
        #expect(d.personality.soundFamily == .boing)
        // The contract's C₆₀: its weakest bond is a C–C single, so it breaks (chips) at 6.5 m/s.
        #expect(d.features.weakestBond?.label == "C–C")
        #expect(abs(d.personality.breakSpeed - 6.5) < 1e-12)
        #expect(d.reasons == ["Bouncy: a round cage of 60 carbons"])
        #expect(d.feel == "Bounces, and its cage rings")
    }

    @Test func caffeineIsRigidWithTwoFusedRings() throws {
        let d = try derive("caffeine")
        #expect(d.personality.kind == .rigid)
        #expect(d.plaque == "Rigid: two fused rings")
        #expect(d.personality.restitution == PersonalityTable.v1.rigid.restitution)
        #expect(!d.rings)
    }

    @Test func rotorsMakeItFlexible() throws {
        let d = try derive("cholesterol")
        #expect(d.personality.kind == .flexible)
        #expect(d.rule == .rotors)
        #expect(d.plaque == "Flexible: five rotating bonds")
        #expect(d.feel == "Flops, and soaks up a hit")
        #expect(d.personality.angularDamping == 0.45)
    }

    @Test func saltAndMetalsAreBrittle() throws {
        let salt = try derive("salt-cube")
        #expect(salt.personality.kind == .brittle)
        #expect(salt.rule == .ionic)
        #expect(salt.plaque == "Brittle: held by ionic contacts (80 kJ/mol)")
        #expect(salt.personality.soundFamily == .tink)
        #expect(salt.personality.hapticSharpness == 1)
        // 1.2 × sqrt(80 / 346).
        #expect(abs(salt.personality.breakSpeed - 1.2 * (80.0 / 346).squareRoot()) < 1e-12)
        for name in ["ferrocene", "cisplatin"] {
            let d = try derive(name)
            #expect(d.rule == .coordination, "\(name)")
            #expect(d.plaque == "Brittle: held by coordination bonds (150 kJ/mol)", "\(name)")
        }
        let diborane = try derive("diborane")
        #expect(diborane.rule == .strainedRing)
        #expect(diborane.plaque == "Brittle: a strained 4-membered ring")
    }

    @Test func peroxideIsBrittleAtItsOxygenBond() {
        let d = Personality.derive(Self.peroxide)
        #expect(d.personality.kind == .brittle)
        #expect(d.reasons == ["Brittle: its O–O bond is weak (142 kJ/mol)"])
        #expect(abs(d.personality.breakSpeed - 0.769) < 0.0005)
    }

    @Test func roundTopsAndAtomsBounce() throws {
        let methane = try derive("methane")
        #expect(methane.personality.kind == .bouncy)
        #expect(methane.rule == .round)
        #expect(!methane.rings)
        #expect(methane.feel == "Bounces like a rubber ball")
        let atom = Personality.derive(Molecule(atomicNumbers: [18], positions: [Vec3.zero]))
        #expect(atom.personality.kind == .bouncy)
        #expect(atom.plaque == "Bouncy: a single atom")
        #expect(atom.personality.isUnbreakable)
        #expect(atom.features.cutStrength == nil)
        #expect(atom.reasons.count == 1)
    }

    @Test func waterAndNitrogenAreRigidAndNitrogenWillNotSnap() throws {
        // Plan §4.3's own examples of rigid: benzene, caffeine, water, N₂.
        #expect(try derive("water").personality.kind == .rigid)
        #expect(try derive("benzene").personality.kind == .rigid)
        let n2 = Personality.derive(Molecule(atomicNumbers: [7, 7], positions: [Vec3.zero, Vec3(1.098, 0, 0)]))
        #expect(n2.personality.kind == .rigid)
        #expect(n2.features.weakestBond?.label == "N≡N")
        #expect(n2.personality.isUnbreakable)
        #expect(n2.reasons == ["Rigid: no rotating bonds", "Will not snap: its weakest bond, N≡N, is 941 kJ/mol"])
    }

    @Test func breakSpeedFollowsTheWeakestBond() throws {
        // Water's weakest bond is O–H (459); ethanol's is C–C (346), below its C–O (358).
        let ethanol = try derive("ethanol").personality
        let water = try derive("water").personality
        #expect(abs(ethanol.breakSpeed - 3.0) < 1e-12)
        #expect(abs(water.breakSpeed - 3.0 * (459.0 / 346).squareRoot()) < 1e-12)
    }

    @Test func contractOrdersComeFromTheLengthRatio() {
        // contracts.md §3.3 rule 1: N₂ reads 0.77, ethylene 0.88, ethane 1.01.
        #expect(MolecularFeatures.contractOrder(length: 1.098, 7, 7) == .triple)
        #expect(MolecularFeatures.contractOrder(length: 1.339, 6, 6) == .double)
        #expect(MolecularFeatures.contractOrder(length: 1.535, 6, 6) == .single)
        #expect(MolecularFeatures.contractEnergy(6, 6, kind: .covalent, order: .double) == (614, "table"))
        #expect(MolecularFeatures.contractEnergy(6, 7, kind: .covalent, order: .triple) == (887, "table"))
        #expect(MolecularFeatures.contractEnergy(5, 5, kind: .covalent, order: .triple) == (850, "game"))
        #expect(MolecularFeatures.contractEnergy(5, 5, kind: .covalent, order: .single) == (350, "game"))
        #expect(MolecularFeatures.contractEnergy(26, 6, kind: .coordination, order: nil) == (150, "game"))
        #expect(MolecularFeatures.contractEnergy(11, 17, kind: .ionicContact, order: nil) == (80, "game"))
    }

    @Test func derivationIsDeterministicAndRoundTrips() throws {
        let a = try derive("tryptophan")
        let b = try derive("tryptophan")
        #expect(a == b)
        let back = try JSONDecoder().decode(Personality.self, from: JSONEncoder().encode(a.personality))
        #expect(back == a.personality)
    }

    @Test func everyFixtureGetsABoundedPersonality() throws {
        for name in ["water", "benzene", "glucose", "atp", "sucrose", "lsd", "diborane", "ferrocene", "cisplatin",
                     "diamond_crystal", "carbon_nanotube", "graphene_ribbon", "omol25_nv_1008", "omol25_nv_23477"] {
            let d = try derive(name)
            let p = d.personality
            #expect((0...0.95).contains(p.restitution), "\(name)")
            #expect((0...1).contains(p.friction) && p.dynamicFriction <= p.friction, "\(name)")
            #expect(p.breakSpeed > 0, "\(name)")
            #expect((0...1).contains(p.hapticSharpness), "\(name)")
            #expect(!d.reasons.isEmpty && d.reasons[0].hasPrefix(p.kind.title + ": "), "\(name)")
        }
    }

    @Test func breakImpulseIsFeltMassTimesBreakSpeed() throws {
        let p = try derive("caffeine").personality
        let mass = try #require(GameUnits.feltMass(molarMass: 194.19, massScale: p.massScale))
        #expect(p.breakImpulse(feltMass: mass) == mass * p.breakSpeed)
        let n2 = Personality.derive(Molecule(atomicNumbers: [7, 7], positions: [Vec3.zero, Vec3(1.098, 0, 0)])).personality
        #expect(n2.breakImpulse(feltMass: 0.1) == nil)
    }

    /// contracts.md §3.2's two examples, to the digits they print.
    @Test func recordsMatchTheContractsExamples() throws {
        func close(_ a: Float?, _ b: Float, _ digits: Float) -> Bool { a.map { abs($0 - b) <= digits } ?? false }
        let h2o2 = PersonalityRecord(Personality.derive(Self.peroxide))
        #expect(h2o2.schema == "lupi.personality.v1" && h2o2.rules == "lupi.personality.rules.v1")
        #expect(h2o2.kind == .brittle && h2o2.soundFamily == .tink)
        #expect(h2o2.restitution == 0.2 && h2o2.friction == .init(static: 0.6, dynamic: 0.45))
        #expect(h2o2.linearDamping == 0.05 && h2o2.angularDamping == 0.1 && h2o2.massScale == 0.85)
        #expect(close(h2o2.massKg, 0.0874, 0.00015))
        #expect(close(h2o2.breakSpeed, 0.769, 0.0005))
        #expect(close(h2o2.breakImpulse, 0.0672, 0.00015))
        #expect(h2o2.squash == 0.03 && h2o2.hapticSharpness == 1)
        #expect(h2o2.weakestBond == .init(atoms: [0, 1], elements: ["O", "O"], kind: "covalent", order: 1,
                                          energyKJPerMol: 142, energySource: "table"))
        #expect(h2o2.reasons == ["Brittle: its O–O bond is weak (142 kJ/mol)"])

        let c60 = PersonalityRecord(try derive("c60_buckyball"))
        #expect(c60.kind == .bouncy && c60.soundFamily == .boing)
        #expect(c60.restitution == 0.85 && c60.friction == .init(static: 0.5, dynamic: 0.35))
        #expect(c60.linearDamping == 0.02 && c60.angularDamping == 0.03 && c60.massScale == 0.8)
        #expect(close(c60.massKg, 0.279, 0.0005))
        #expect(c60.breakSpeed == 6.5)
        #expect(close(c60.breakImpulse, 1.81, 0.005))
        #expect(c60.squash == 0.25 && c60.hapticSharpness == 0.5)
        #expect(c60.weakestBond?.elements == ["C", "C"] && c60.weakestBond?.order == 1)
        #expect(c60.weakestBond?.energyKJPerMol == 346 && c60.weakestBond?.energySource == "table")
        #expect(c60.reasons == ["Bouncy: a round cage of 60 carbons"])

        // Unbreakable: null, not absent.
        let n2 = PersonalityRecord(Personality.derive(Molecule(atomicNumbers: [7, 7], positions: [Vec3.zero, Vec3(1.098, 0, 0)])))
        let json = try #require(String(data: JSONEncoder().encode(n2), encoding: .utf8))
        #expect(json.contains("\"breakSpeed\":null") && json.contains("\"breakImpulse\":null"))
        #expect(try JSONDecoder().decode(PersonalityRecord.self, from: Data(json.utf8)) == n2)
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

    /// scale-spec §10.2 written out in full, the test's own reference.
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

    @Test func feltMassAboveTheKneeIsTheTail() throws {
        // Hemoglobin and the salt rungs are the tail's (scale-spec §10.2's table).
        #expect(abs(try #require(GameUnits.feltMass(molarMass: 64_500)) - 0.544) < 0.0005)
        #expect(abs(try #require(GameUnits.feltMass(molarMass: 29_264)) - 0.537) < 0.0005)
        #expect(abs(try #require(GameUnits.feltMass(molarMass: 29_264, massScale: 0.85)) - 0.533) < 0.0005)
        for (m, scale) in [(1019.0, 1.0), (1500, 1), (64_500, 1), (29_264, 0.85), (1e12, 0.9)] {
            let kg = try #require(GameUnits.feltMass(molarMass: m, massScale: scale))
            #expect(kg == FeltMass.kg(MassLog(daltons: m), massScale: scale), "\(m) \(scale)")
            #expect(abs(kg - Self.specFeltMass(m, scale)) < 1e-12, "\(m) \(scale)")
        }
        // A brittle molecule stays on the power law further: 1,500 × 0.85^2.5 ≈ 999 Da.
        #expect(abs(try #require(GameUnits.feltMass(molarMass: 1500, massScale: 0.85)) - 0.2 * pow(1500 / 180, 0.4) * 0.85) < 1e-12)
        #expect(GameUnits.feltMass(molarMass: 0) == nil)
        #expect(GameUnits.feltMass(molarMass: .infinity) == nil)
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
