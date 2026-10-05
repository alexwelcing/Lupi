import Foundation
import Testing
import LupiChem
@testable import LupiData

enum RecordFixtures {
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures/records")

    static func data(_ name: String) throws -> Data { try Data(contentsOf: root.appendingPathComponent(name)) }

    static func trophy(_ name: String) throws -> TrophyRecord {
        try LupiJSON.decoder().decode(TrophyRecord.self, from: data(name))
    }

    /// The JSON value of `data`, for comparing documents whatever their key order and spacing.
    static func object(_ data: Data) throws -> NSObject {
        try #require(JSONSerialization.jsonObject(with: data) as? NSObject)
    }
}

@Suite("lupi.trophy.v1")
struct TrophyRecordTests {
    static let examples = ["trophy-gallery.json", "trophy-fragment.json", "trophy-built.json", "trophy-scale.json"]

    @Test(arguments: examples)
    func contractExamplesDecodeValidateAndRoundTrip(_ name: String) throws {
        let fixture = try RecordFixtures.data(name)
        let trophy = try LupiJSON.decoder().decode(TrophyRecord.self, from: fixture)
        #expect(trophy.validate() == [], "\(name)")
        let encoded = try LupiJSON.encoder().encode(trophy)
        // Writers write exactly the contract's document: the same keys and values.
        #expect(try RecordFixtures.object(encoded) == RecordFixtures.object(fixture), "\(name)")
        let again = try LupiJSON.decoder().decode(TrophyRecord.self, from: encoded)
        #expect(again == trophy)
        #expect(try LupiJSON.encoder().encode(again) == encoded)
    }

    @Test func galleryExampleIsTheContractsText() throws {
        let trophy = try RecordFixtures.trophy("trophy-gallery.json")
        #expect(trophy.id.uuidString == "6F1C2D9E-3B7A-4E58-9C21-0A5D7B8E4F13")
        #expect(trophy.molecule.url?.absoluteString == "https://lupi.live/gallery/curated/popular/caffeine.xyz")
        #expect(trophy.story(timeZone: TimeZone(identifier: "UTC")!) == "Spawned 4 Oct 2026")
        let text = String(decoding: try LupiJSON.encoder().encode(trophy), as: UTF8.self)
        #expect(text == """
            {"createdAt":"2026-10-04T18:02:41.877Z","id":"6F1C2D9E-3B7A-4E58-9C21-0A5D7B8E4F13","look":{"scale":0.0156},\
            "molecule":{"atoms":24,"formula":"C8H10N4O2","id":"caffeine",\
            "sha256":"912c14862af853b2234e6cff6c67d0462a25acab38fed1ada8bbf9967233d80a","source":"gallery",\
            "url":"https://lupi.live/gallery/curated/popular/caffeine.xyz"},"name":"Caffeine",\
            "origin":{"at":"2026-10-04T18:02:11.204Z","kind":"spawned"},"schema":"lupi.trophy.v1",\
            "updatedAt":"2026-10-04T18:02:41.877Z"}
            """)
    }

    @Test func storiesAreDerived() throws {
        #expect(try RecordFixtures.trophy("trophy-fragment.json").story() == "Broken from Hydrogen peroxide")
        #expect(try RecordFixtures.trophy("trophy-built.json").story() == "Built from atoms: O, H, H")
    }

    @Test func theFragmentExampleIsWhatTheWriterEmbeds() throws {
        // O–H at 0.97 Å, centred on the centre of mass: the contract's own numbers.
        let hydroxyl = Molecule(atomicNumbers: [8, 1], positions: [Vec3(0, 0, 0), Vec3(-0.97, 0, 0)])
        let xyz = XYZWriter.embedded(hydroxyl, title: "Lupi fragment", parent: "H2O2")
        #expect(xyz == (try RecordFixtures.trophy("trophy-fragment.json").molecule.xyz))
    }

    @Test func readersIgnoreFieldsTheyDoNotKnow() throws {
        var object = try #require(JSONSerialization.jsonObject(with: RecordFixtures.data("trophy-gallery.json")) as? [String: Any])
        object["addedInV1Later"] = ["x": 1]
        var molecule = try #require(object["molecule"] as? [String: Any])
        molecule["newOptional"] = "y"
        object["molecule"] = molecule
        let trophy = try LupiJSON.decoder().decode(TrophyRecord.self, from: JSONSerialization.data(withJSONObject: object))
        #expect(trophy == (try RecordFixtures.trophy("trophy-gallery.json")))
    }

    @Test func aTombstoneDropsTheXYZAndStillValidates() throws {
        let built = try RecordFixtures.trophy("trophy-built.json")
        let gone = built.tombstone(at: built.createdAt.addingTimeInterval(60))
        #expect(gone.molecule.xyz == nil)
        #expect(gone.deletedAt != nil && gone.updatedAt == gone.deletedAt)
        #expect(gone.validate() == [])
    }

    @Test func validationNamesWhatIsWrong() throws {
        let gallery = try RecordFixtures.trophy("trophy-gallery.json")
        let cases: [(String, (inout TrophyRecord) -> Void)] = [
            ("name has 0 characters, expected 1...80", { $0.name = "" }),
            ("name has a control character", { $0.name = "Caf\u{7}feine" }),
            ("sha256 is not 64 lowercase hex digits", { $0.molecule.sha256 = "ABC" }),
            ("url must be https", { $0.molecule.url = URL(string: "http://lupi.live/x.xyz") }),
            ("a gallery trophy needs its page id", { $0.molecule.id = "Caffeine!" }),
            ("atoms must be at least 1", { $0.molecule.atoms = 0 }),
            ("look.scale 0.0 is outside 0.0005...0.5", { $0.look.scale = 0 }),
            ("look.finish chrome is not a finish", { $0.look.finish = "chrome" }),
            ("a gallery trophy has origin spawned, not built", { $0.origin.kind = .built }),
            ("updatedAt is before createdAt", { $0.updatedAt = $0.createdAt.addingTimeInterval(-1) }),
            ("schema is lupi.trophy.v2, expected lupi.trophy.v1", { $0.schema = "lupi.trophy.v2" }),
        ]
        for (expected, change) in cases {
            var t = gallery
            change(&t)
            #expect(t.validate() == [expected])
        }

        let fragment = try RecordFixtures.trophy("trophy-fragment.json")
        var tampered = fragment
        tampered.molecule.xyz = tampered.molecule.xyz?.replacingOccurrences(of: "0.05749", with: "0.05750")
        #expect(tampered.validate() == ["sha256 is not the hash of the embedded xyz"])
        tampered = fragment
        tampered.origin.parent = nil
        #expect(tampered.validate() == ["a broken trophy names its parent"])
        tampered = fragment
        tampered.molecule.formula = "OH"
        #expect(tampered.validate() == ["formula OH is not the xyz's HO"])
        tampered = fragment
        tampered.molecule.xyz = nil
        #expect(tampered.validate() == ["a fragment trophy embeds its coordinates"])

        let omol = MoleculeRef(
            source: .omol25, id: "neutral-test:12", url: URL(string: "https://lupi.live/x.xyz"),
            sha256: gallery.molecule.sha256, formula: "C2H6O", atoms: 9
        )
        #expect(omol.validate(tombstone: false) == ["an omol25 trophy's id is <collection>:<row>"])
    }

    @Test func aScaleTrophyKeepsLookScaleZeroAndItsReference() throws {
        let field = ScaleRefField(
            ref: "lsr1:TFNSAQ", count: "1,000,000,000", spanMetres: 0.15,
            aggregate: ScaleAggregate(extents: [1, 1, 1], colour: "#a0b1c2")
        )
        var scale = TrophyRecord(
            name: "Salt, 10⁹ atoms",
            molecule: MoleculeRef(
                source: .scale, sha256: String(repeating: "0", count: 64), formula: "BrCl499Na500", atoms: 1_000_000_000,
                scale: field
            ),
            origin: TrophyOrigin(kind: .spawned, at: Date(timeIntervalSince1970: 0)),
            look: TrophyLook(scale: 0), createdAt: Date(timeIntervalSince1970: 0)
        )
        #expect(scale.validate() == [])
        scale.molecule.scale?.spanMetres = 4
        scale.molecule.scale?.aggregate?.colour = "#A0B1C2"
        scale.molecule.scale?.aggregate?.extents = [1, 0.5]
        #expect(scale.validate() == [
            "scale.spanMetres 4.0 is outside 0.005...3",
            "scale.aggregate.extents are three values with the longest 1",
            "scale.aggregate.colour is not #rrggbb",
        ])
        scale.molecule.scale = nil
        #expect(scale.validate() == ["a scale trophy needs its scale reference"])
    }

    @Test func namesAreCleaned() {
        #expect(TrophyRecord.cleanName("  Caffeine\n\tcup  ", fallback: "C8H10N4O2") == "Caffeine cup")
        #expect(TrophyRecord.cleanName("\u{0}\u{1}", fallback: "H2O") == "H2O")
        #expect(TrophyRecord.cleanName(String(repeating: "a", count: 100), fallback: "x").count == 80)
    }
}

@Suite("lupi.shelf.v1")
struct ShelfRecordTests {
    @Test func contractExampleDecodesValidatesAndRoundTrips() throws {
        let fixture = try RecordFixtures.data("shelf.json")
        let shelf = try LupiJSON.decoder().decode(ShelfRecord.self, from: fixture)
        #expect(shelf.validate() == [])
        #expect(shelf.placements[0].transform.translation == SIMD3<Float>(0.18, 0.042, -0.05))
        #expect(shelf.placements[0].transform.rotation == SIMD4<Float>(0, 0.3827, 0, 0.9239))
        let encoded = try LupiJSON.encoder().encode(shelf)
        #expect(try RecordFixtures.object(encoded) == RecordFixtures.object(fixture))
        #expect(try LupiJSON.decoder().decode(ShelfRecord.self, from: encoded) == shelf)
    }

    func placement(_ id: UUID, scale: Float = 0.02, span: Float? = nil) -> ShelfPlacement {
        ShelfPlacement(
            trophyId: id, transform: RootTransform(translation: .zero, rotation: SIMD4(0, 0, 0, 1), scale: scale),
            pinnedAt: Date(timeIntervalSince1970: 10), spanMetres: span
        )
    }

    @Test func pinningReplacesMovesAndStopsAtSixty() {
        let t0 = Date(timeIntervalSince1970: 0)
        var shelf = ShelfRecord(name: "Desk", rootAnchorId: UUID(), createdAt: t0)
        let a = UUID()
        var ok = shelf.pin(placement(a), at: t0.addingTimeInterval(5))
        #expect(ok)
        var moved = placement(a)
        moved.transform.translation = SIMD3(0.1, 0, 0)
        ok = shelf.pin(moved, at: t0.addingTimeInterval(6))
        #expect(ok)
        #expect(shelf.placements == [moved])
        #expect(shelf.updatedAt == t0.addingTimeInterval(6))
        for _ in 1..<ShelfRecord.maxPlacements {
            ok = shelf.pin(placement(UUID()), at: t0)
            #expect(ok)
        }
        ok = shelf.pin(placement(UUID()), at: t0)
        #expect(!ok)
        ok = shelf.pin(moved, at: t0)
        #expect(ok, "a trophy already here can always move")
        #expect(shelf.placements.count == 60)
        ok = shelf.unpin(a, at: t0.addingTimeInterval(7))
        #expect(ok)
        ok = shelf.unpin(a, at: t0)
        #expect(!ok)
        let dropped = shelf.dropPlacements(keeping: [])
        #expect(dropped == 59)
        #expect(shelf.validate() == [])
    }

    @Test func aScalePlacementStoresZeroAndItsSpan() {
        let id = UUID()
        var shelf = ShelfRecord(name: "Desk", rootAnchorId: UUID(), createdAt: Date(timeIntervalSince1970: 0))
        shelf.pin(placement(id, scale: 0, span: 0.3), at: shelf.createdAt)
        #expect(shelf.validate() == [])
        shelf.placements[0].spanMetres = nil
        #expect(shelf.validate() == ["\(id.uuidString): a placement at scale 0 needs spanMetres in 0.005...3"])
    }

    @Test func validationNamesWhatIsWrong() {
        let id = UUID()
        var shelf = ShelfRecord(name: String(repeating: "x", count: 41), rootAnchorId: UUID(), createdAt: Date(timeIntervalSince1970: 0))
        shelf.worldMapFile = "../world.arworldmap"
        shelf.mapStatusAtSave = "limited"
        var bad = placement(id)
        bad.transform.translation.x = .nan
        bad.transform.rotation = SIMD4(0, 0, 0, 2)
        bad.transform.scale = -1
        shelf.placements = [bad, placement(id)]
        #expect(shelf.validate() == [
            "name has 41 characters, expected 1...40",
            "worldMapFile is not a file name",
            "mapStatusAtSave is limited, expected mapped or extending",
            "\(id.uuidString): translation is not finite",
            "\(id.uuidString): rotation is not a unit quaternion",
            "\(id.uuidString): scale must be positive, or 0 with spanMetres",
            "trophy \(id.uuidString) is placed twice",
        ])
    }

    @Test func aShelfNeverCarriesTheMapItself() throws {
        let shelf = ShelfRecord(name: "Desk", rootAnchorId: UUID(), createdAt: Date(timeIntervalSince1970: 0))
        let keys = try #require(JSONSerialization.jsonObject(with: LupiJSON.encoder().encode(shelf)) as? [String: Any]).keys
        #expect(Set(keys) == ["schema", "id", "name", "worldMapFile", "rootAnchorId", "placements", "createdAt", "updatedAt"])
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
