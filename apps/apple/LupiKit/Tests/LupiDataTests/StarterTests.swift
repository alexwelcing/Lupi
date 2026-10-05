import Foundation
import Testing
import LupiChem
@testable import LupiData

@Suite("bundled starters")
struct StarterTests {
    @Test func manifestListsThirteenStarters() throws {
        let manifest = try Starters.manifest()
        #expect(manifest.schema == StarterManifest.schemaID)
        #expect(manifest.starters.map(\.id) == [
            "hydrogen", "water", "carbon_dioxide", "methane", "ammonia", "ethanol", "benzene", "caffeine",
            "c60_buckyball", "glucose", "salt_cluster", "tryptophan", "hydrogen_peroxide",
        ])
    }

    @Test func everyStarterLoadsAndMatchesItsManifest() throws {
        for starter in try Starters.manifest().starters {
            let molecule = try Starters.molecule(starter)
            #expect(molecule.count == starter.atoms, "\(starter.id)")
            #expect(molecule.hillFormula == starter.formula, "\(starter.id)")
            let graph = BondGraph.forPlay(molecule)
            #expect(graph.components().count == 1, "\(starter.id) is one body")
            #expect(Starters.trophyMolecule(starter).validate().isEmpty, "\(starter.id)")
        }
    }

    @Test func writtenGeometriesHaveTheirBondLengths() throws {
        let starters = Dictionary(uniqueKeysWithValues: try Starters.manifest().starters.map { ($0.id, $0) })
        func lengths(_ id: String) throws -> [Double] {
            let molecule = try Starters.molecule(try #require(starters[id]))
            return BondGraph.forPlay(molecule).bonds.map { Double($0.length) }
        }
        #expect(try lengths("hydrogen").allSatisfy { abs($0 - 0.7414) < 1e-5 })
        #expect(try lengths("carbon_dioxide").allSatisfy { abs($0 - 1.16) < 1e-5 })
        #expect(try lengths("methane").allSatisfy { abs($0 - 1.087) < 1e-5 })
        #expect(try lengths("ammonia").allSatisfy { abs($0 - 1.012) < 1e-5 })
        // PubChem's conformer: O–O 1.4494 Å, the bond play breaks first.
        let peroxide = try Starters.molecule(try #require(starters["hydrogen_peroxide"]))
        let oo = BondGraph.forPlay(peroxide).bonds.filter { peroxide.atomicNumbers[$0.i] == 8 && peroxide.atomicNumbers[$0.j] == 8 }
        #expect(oo.count == 1)
        #expect(abs(Double(oo[0].length) - 1.4494) < 1e-5)
        let salt = try lengths("salt_cluster")
        #expect(salt.count == 12)
        #expect(salt.allSatisfy { abs($0 - 2.82) < 1e-5 })
    }

    @Test func tamperedFilesAreRefused() throws {
        var starter = try #require(try Starters.manifest().starters.first)
        starter.sha256 = String(repeating: "0", count: 64)
        #expect(throws: StarterError.integrity(starter.file)) { _ = try Starters.xyz(starter) }
        starter.file = "../starters.json"
        #expect(throws: StarterError.missingResource("../starters.json")) { _ = try Starters.xyz(starter) }
    }
}
