import Foundation
import Testing
import LupiChem
@testable import LupiData

@Suite("lupi.trophy.v1 and lupi.shelf.v1")
struct RecordTests {
    @Test func trophySampleDecodesAndValidates() throws {
        let trophy = try LupiJSON.decoder().decode(Trophy.self, from: try DataFixtures.data("trophy.sample.json"))
        #expect(trophy.schema == Trophy.schemaID)
        #expect(trophy.molecule.source == .gallery)
        #expect(trophy.molecule.ref == "caffeine")
        #expect(trophy.remix == RemixLook(code: "r1-K7QDM", finish: .goldLeaf))
        #expect(trophy.validate().isEmpty)
        #expect(RFC3339.string(from: trophy.createdAt) == "2026-10-04T21:19:00.123Z")
        #expect(RFC3339.string(from: trophy.updatedAt) == "2026-10-05T08:00:00.000Z")
    }

    @Test func builtTrophyCarriesItsStructure() throws {
        let trophy = try LupiJSON.decoder().decode(Trophy.self, from: try DataFixtures.data("trophy-built.sample.json"))
        #expect(trophy.validate().isEmpty)
        let structure = try #require(trophy.molecule.structure)
        let molecule = structure.molecule(name: trophy.molecule.name)
        #expect(molecule.hillFormula == "H2O")
        let graph = structure.graph()
        #expect(graph.bonds.count == 2)
        #expect(graph.bonds.allSatisfy { $0.kind == .covalent && $0.order == .single })
    }

    @Test func structureRoundTripsThroughAMolecule() throws {
        let molecule = try Molecule(xyz: "3\n\nC 0 0 0\nO 1.16 0 0\nO -1.16 0 0\n")
        let graph = BondGraph.forPlay(molecule)
        #expect(graph.bonds.allSatisfy { $0.order == .double })
        let carried = TrophyMolecule(source: .fragment, molecule: molecule, graph: graph)
        #expect(carried.validate().isEmpty)
        #expect(carried.formula == "CO2")
        let structure = try #require(carried.structure)
        #expect(structure.bonds == [[0, 1, 0, 4], [0, 2, 0, 4]])
        #expect(structure.molecule().positions == molecule.positions)
        #expect(structure.graph().bonds.map(\.order) == [.double, .double])
    }

    @Test func encodingIsStable() throws {
        let trophy = try LupiJSON.decoder().decode(Trophy.self, from: try DataFixtures.data("trophy.sample.json"))
        let encoded = try LupiJSON.encoder().encode(trophy)
        let again = try LupiJSON.decoder().decode(Trophy.self, from: encoded)
        #expect(again == trophy)
        #expect(try LupiJSON.encoder().encode(again) == encoded)
        let text = String(decoding: encoded, as: UTF8.self)
        #expect(text.hasPrefix(#"{"createdAt":"2026-10-04T21:19:00.123Z","earned":"#))
    }

    @Test func validationCatchesBrokenRecords() {
        var trophy = Trophy(
            molecule: TrophyMolecule(source: .gallery, name: "Caffeine", formula: "C8H10N4O2", atomCount: 24, url: "/gallery/x.xyz"),
            earned: Earned(how: .spawned), plaque: "Caffeine"
        )
        #expect(trophy.validate() == ["a url needs its sha256"])
        trophy.molecule.sha256 = "ABC"
        #expect(trophy.validate() == ["sha256 is not 64 lowercase hex digits"])
        trophy.molecule.sha256 = String(repeating: "a", count: 64)
        trophy.remix = RemixLook(code: "r1-K7QDI")
        #expect(trophy.validate() == ["remix code r1-K7QDI is not r1-XXXXX"])
        trophy.remix = nil
        #expect(trophy.validate().isEmpty)

        let built = TrophyMolecule(source: .built, name: "x", formula: "C", atomCount: 1)
        #expect(built.validate().contains("built molecules carry their structure"))
        let broken = InlineStructure(atomicNumbers: [6, 1], positions: [0, 0, 0, 1], bonds: [[0, 5, 0, 2], [0, 1, 9, 2]])
        #expect(broken.validate().count == 3)
        #expect(broken.molecule().count == 1)
    }

    @Test func remixCodes() {
        #expect(RemixLook.isValidCode("r1-K7QDM"))
        #expect(!RemixLook.isValidCode("r2-K7QDM"))
        #expect(!RemixLook.isValidCode("r1-K7QD"))
        #expect(!RemixLook.isValidCode("r1-k7qdm"))
        #expect(!RemixLook.isValidCode("r1-K7QDU"))
    }

    @Test func shelfSampleDecodesAndRoundTrips() throws {
        let shelf = try LupiJSON.decoder().decode(Shelf.self, from: try DataFixtures.data("shelf.sample.json"))
        #expect(shelf.schema == Shelf.schemaID)
        #expect(shelf.validate().isEmpty)
        #expect(shelf.placements.count == 2)
        #expect(shelf.placements[0].position == Vec3(0.12, 0, -0.05))
        #expect(abs(shelf.placements[0].rotation.y - 0.7071067811865476) < 1e-15)
        #expect(shelf.placements[1].displayScale == 2.5)
        let again = try LupiJSON.decoder().decode(Shelf.self, from: try LupiJSON.encoder().encode(shelf))
        #expect(again == shelf)
        // Never the room map.
        let keys = try JSONSerialization.jsonObject(with: try LupiJSON.encoder().encode(shelf)) as? [String: Any]
        #expect(Set(keys?.keys ?? [:].keys) == ["createdAt", "id", "name", "placements", "rootAnchor", "schema", "updatedAt"])
    }

    @Test func shelfValidation() {
        let id = "t"
        var shelf = Shelf(name: "Desk", rootAnchor: "root", placements: [
            Placement(trophyId: id, position: Vec3(0, 0, 0)),
            Placement(trophyId: id, position: Vec3(.nan, 0, 0), rotation: Quat(x: 0, y: 0, z: 0, w: 2), displayScale: 0),
        ])
        #expect(shelf.validate() == [
            "trophy t is placed twice",
            "t: position is not finite",
            "t: rotation is not a unit quaternion",
            "t: displayScale must be positive",
        ])
        shelf.placements.removeLast()
        #expect(shelf.validate().isEmpty)
    }

    @Test func malformedPlacementArraysAreRejected() {
        let json = #"{"trophyId":"t","position":[0,0],"rotation":[0,0,0,1],"displayScale":1,"placedAt":"2026-10-04T00:00:00Z"}"#
        #expect(throws: DecodingError.self) { _ = try LupiJSON.decoder().decode(Placement.self, from: Data(json.utf8)) }
    }
}

@Suite("RFC 3339 dates")
struct RFC3339Tests {
    @Test func formatsUTCWithMilliseconds() {
        #expect(RFC3339.string(from: Date(timeIntervalSince1970: 0)) == "1970-01-01T00:00:00.000Z")
        #expect(RFC3339.string(from: Date(timeIntervalSince1970: 951_782_400.5)) == "2000-02-29T00:00:00.500Z")
        #expect(RFC3339.string(from: Date(timeIntervalSince1970: -1)) == "1969-12-31T23:59:59.000Z")
    }

    @Test func parsesOffsetsAndFractions() {
        #expect(RFC3339.date(from: "2026-10-03T17:40:57.741Z") == Date(timeIntervalSince1970: 1_791_049_257.741))
        #expect(RFC3339.date(from: "2026-10-03T19:40:57+02:00") == Date(timeIntervalSince1970: 1_791_049_257))
        #expect(RFC3339.date(from: "2026-10-03T17:40:57Z") == RFC3339.date(from: "2026-10-03t17:40:57z"))
        #expect(RFC3339.date(from: "2026-10-03 17:40:57Z") == nil)
        #expect(RFC3339.date(from: "2026-13-03T17:40:57Z") == nil)
        #expect(RFC3339.date(from: "2026-10-03T17:40:57") == nil)
        #expect(RFC3339.date(from: "2026-10-03T17:40:57.Z") == nil)
    }

    @Test func roundTrips() throws {
        for seconds in [0.0, 1_791_049_257.741, 4_102_444_799.999, -86_400.25] {
            let text = RFC3339.string(from: Date(timeIntervalSince1970: seconds))
            let back = try #require(RFC3339.date(from: text))
            #expect(RFC3339.string(from: back) == text)
        }
    }
}
