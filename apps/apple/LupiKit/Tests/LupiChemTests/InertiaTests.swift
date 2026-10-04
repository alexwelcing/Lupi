import Testing
@testable import LupiChem

@Suite("inertia")
struct InertiaTests {
    static let files = ["bonds-omol25.json", "bonds-gallery.json", "bonds-synthetic.json"]

    /// The fixtures carry the web's computeInertia for every case.
    @Test("matches objectFacts/inertia.ts", arguments: files)
    func matchesTheWeb(file: String) throws {
        let fixture = try Fixtures.decode(BondFixtureFile.self, "bonds/\(file)")
        func close(_ a: Double, _ b: Double, _ scale: Double = 1) -> Bool { abs(a - b) <= 1e-9 * max(1, scale) }
        var compared = 0
        for item in fixture.cases {
            guard let expected = item.inertia else { continue }
            compared += 1
            let molecule = Molecule(atomicNumbers: item.atomicNumbers, positions: item.floatPositions)
            let facts = molecule.inertia
            let scale = expected.moments[2]
            #expect(close(facts.mass, expected.mass, expected.mass), "\(item.name): mass")
            #expect(close(facts.centerOfMass.x, expected.com[0]) && close(facts.centerOfMass.y, expected.com[1])
                && close(facts.centerOfMass.z, expected.com[2]), "\(item.name): centre of mass")
            #expect(close(facts.moments.x, expected.moments[0], scale) && close(facts.moments.y, expected.moments[1], scale)
                && close(facts.moments.z, expected.moments[2], scale), "\(item.name): moments")
            #expect(facts.rotor.rawValue == expected.rotor, "\(item.name): rotor")
            #expect(abs(facts.kappa - expected.kappa) < 1e-9, "\(item.name): kappa")
            if facts.rotor == .asymmetric {
                for (axis, want) in zip(facts.axes, expected.axes) {
                    #expect(abs(axis.x - want[0]) < 1e-9 && abs(axis.y - want[1]) < 1e-9 && abs(axis.z - want[2]) < 1e-9,
                            "\(item.name): axes")
                }
            }
        }
        #expect(compared == fixture.cases.count)
    }

    @Test func rotorClassesAndGyration() throws {
        let water = try FixtureMolecules.named("water")
        #expect(water.inertia.rotor == .asymmetric)
        let co2 = Molecule(atomicNumbers: [6, 8, 8], positions: [Vec3.zero, Vec3(1.16, 0, 0), Vec3(-1.16, 0, 0)])
        let facts = co2.inertia
        #expect(facts.rotor == .linear)
        #expect(abs(facts.moments.x) < 1e-9)
        // Two oxygens at 1.16 Å: I = 2 · 15.999 · 1.16².
        #expect(abs(facts.moments.z - 2 * 15.999 * 1.16 * 1.16) < 1e-4)
        #expect(abs(facts.radiusOfGyration - (facts.moments.z / facts.mass).squareRoot()) < 1e-9)
        let benzene = try FixtureMolecules.named("benzene")
        #expect(benzene.inertia.rotor == .oblate)
        let single = Molecule(atomicNumbers: [26], positions: [Vec3(1, 2, 3)])
        #expect(single.inertia.rotor == .atom)
        #expect(single.inertia.centerOfMass == Vec3(1, 2, 3))
    }

    @Test func principalFrameIsRightHandedAndDiagonalizes() throws {
        let caffeine = try FixtureMolecules.named("caffeine")
        let facts = caffeine.inertia
        let a = facts.axes
        #expect(abs(a[0].dot(a[1].cross(a[2])) - 1) < 1e-9)
        // The quaternion takes body x to the first axis.
        let x = facts.principalRotation.act(Vec3(1, 0, 0))
        #expect((x - a[0]).length < 1e-9)
    }
}
