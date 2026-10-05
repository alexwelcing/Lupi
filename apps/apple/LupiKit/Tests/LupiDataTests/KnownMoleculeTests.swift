import Foundation
import Testing
import LupiChem
@testable import LupiData

@Suite("known molecules")
struct KnownMoleculeTests {
    static func starters() throws -> [(Starter, Molecule)] {
        try Starters.manifest().starters.map { ($0, try Starters.molecule($0)) }
    }

    @Test func theIndexLoads() throws {
        let index = try KnownMolecules.bundledIndex()
        #expect(index.count == 86)
        #expect(index.allSatisfy { $0.graph.isConnected && $0.graph.count <= 256 })
        #expect(index.filter { $0.source == .omol25 }.count == 20)
        #expect(index.first { $0.id == "ethanol" }?.name == "Ethanol")
        // OMol25 picks are named by their formula and keep their row.
        let pick = try #require(index.first { $0.source == .omol25 })
        #expect(pick.id.hasPrefix("neutral-validation:"))
        #expect(pick.name == pick.formula)
    }

    /// The index was perceived by the TypeScript recipe; the gallery starters here by the
    /// Swift port. Same atoms in file order, so the same links, pair for pair.
    @Test func swiftPerceivesTheIndexGraphs() throws {
        let index = Dictionary(uniqueKeysWithValues: try KnownMolecules.bundledIndex().map { ($0.id, $0) })
        var compared = 0
        for (starter, molecule) in try Self.starters() where starter.lupiPath != nil {
            let entry = try #require(index[starter.id], "\(starter.id)")
            let swift = MolecularGraph(molecule: molecule, graph: BondGraph.forPlay(molecule))
            #expect(swift == entry.graph, "\(starter.id)")
            compared += 1
        }
        #expect(compared == 7)
    }

    @Test func startersComeFirstAndOnce() throws {
        let known = try KnownMolecules.bundled(starters: Self.starters())
        // Seven starters are gallery pages: known once, under the starter's name.
        #expect(known.count == 86 + 13 - 7)
        #expect(Array(known.molecules.prefix(13)).allSatisfy { $0.source == .starter })
        #expect(known.molecules.filter { $0.id == "water" }.count == 1)
    }

    @Test func everyKnownMoleculeIsItsOwnMatch() throws {
        let known = try KnownMolecules.bundled(starters: Self.starters())
        for m in known.molecules {
            // Renumbered, as a builder's atom order would be.
            let n = m.graph.count
            let order = (0..<n).map { ($0 * 7 + 3) % n }
            let ok = Set(order).count == n
            let perm = ok ? order : Array((0..<n).reversed())
            var inverse = [Int](repeating: 0, count: n)
            for (new, old) in perm.enumerated() { inverse[old] = new }
            let renumbered = MolecularGraph(
                atomicNumbers: perm.map { m.graph.atomicNumbers[$0] },
                links: m.graph.links.map { .init(i: inverse[$0.i], j: inverse[$0.j], kind: $0.kind) }
            )
            let hit = try #require(known.match(renumbered), "\(m.id)")
            // Two picks can share a graph (the same molecule in two rows): the first wins.
            #expect(hit.graph.isIsomorphic(to: m.graph), "\(m.id)")
        }
    }

    @Test func builtMoleculesFindTheirNames() throws {
        let known = try KnownMolecules.bundled(starters: Self.starters())
        func built(_ steps: (BuildPiece) throws -> BuildPiece) rethrows -> MolecularGraph {
            MolecularGraph(try steps(BuildPiece(molecule: Molecule(atomicNumbers: [6], positions: [Vec3.zero]))))
        }
        func atom(_ z: Int) -> BuildPiece { BuildPiece(molecule: Molecule(atomicNumbers: [z], positions: [Vec3.zero])) }
        func snap(_ host: BuildPiece, _ a: Int, _ z: Int, offset: Vec3) throws -> BuildPiece {
            try Snapper.snap(
                host: host, hostAtom: a, guest: atom(z), guestAtom: 0,
                guestToHost: RigidPlacement(translation: host.molecule.position(a) + offset)
            ).get().piece
        }
        let ethanol = try built { c in
            let cc = try snap(c, 0, 6, offset: Vec3(2, 0, 0))
            let cco = try snap(cc, 1, 8, offset: Vec3(1, 1.5, 0))
            return try #require(HydrogenFill.fill(cco)).piece
        }
        #expect(known.match(ethanol)?.name == "Ethanol")
        let methane = try built { try #require(HydrogenFill.fill($0)).piece }
        #expect(known.match(methane)?.name == "Methane")
        #expect(known.match(methane)?.source == .starter)
        let water = MolecularGraph(try #require(HydrogenFill.fill(atom(8))).piece)
        #expect(known.match(water)?.name == "Water")
        let ether = try built { c in
            let co = try snap(c, 0, 8, offset: Vec3(2, 0, 0))
            let coc = try snap(co, 1, 6, offset: Vec3(2, 2, 0))
            return try #require(HydrogenFill.fill(coc)).piece
        }
        #expect(known.match(ether) == nil)
        // A radical matches nothing: names are for what the cue table or the index recognizes.
        let dicarbon = try built { try snap($0, 0, 6, offset: Vec3(2, 0, 0)) }
        #expect(known.match(dicarbon) == nil)
    }

    @Test func aWrongSchemaIsRefused() {
        let data = Data(#"{"schema":"lupi.known-molecules.v2","molecules":[]}"#.utf8)
        #expect(throws: KnownMoleculesError.schema("lupi.known-molecules.v2")) { try KnownMolecules.decode(data) }
    }
}
