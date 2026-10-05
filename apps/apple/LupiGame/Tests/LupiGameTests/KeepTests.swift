import Foundation
import LupiChem
import LupiData
import LupiGame
import LupiGameSim
import LupiScale
import LupiScaleCore
import LupiSync
import Testing

/// Keeping (plan §6.3, contracts.md §1, scale-spec §7.4): any body becomes a trophy that names
/// its piece with a `lupi.scale-ref.v1`, and the trophy brings back exactly that piece.
@Suite("keep and restore")
struct KeepTests {
    static let now = Date(timeIntervalSince1970: 1_791_150_000.123)

    /// Keeps a body, sends the record through JSON as the device store and the web would read
    /// it, brings it back into a fresh session and returns both bodies.
    static func keepAndRestore(_ sim: inout Simulation, _ id: BodyID) throws -> (record: TrophyRecord, kept: Body, back: Body) {
        let kept = try #require(sim.session.body(id))
        let record = try sim.session.keep(id, now: now)
        let json = try LupiJSON.encoder().encode(record)
        let read = try LupiJSON.decoder().decode(TrophyRecord.self, from: json)
        #expect(read == record)
        var fresh = Fixture.sim()
        fresh.session.spawn(.trophy(read))
        fresh.step()
        let back = try #require(fresh.session.bodyOrder.first.flatMap { fresh.session.body($0) })
        return (record, kept, back)
    }

    static func expectSamePiece(_ kept: Body, _ back: Body) {
        #expect(back.identity.key == kept.identity.key, "same refKey")
        #expect(back.identity.probe == kept.identity.probe, "same probe")
        #expect(back.facts.count == kept.facts.count)
        #expect(back.facts.count.formatted == kept.facts.count.formatted)
        #expect(back.facts.formula == kept.facts.formula)
        #expect(back.facts.massMicroDa == kept.facts.massMicroDa)
        #expect(abs(back.span / kept.span - 1) < 1e-6, "same size")
        #expect(back.frame.ref.root == kept.frame.ref.root, "drawn from the same node")
    }

    @Test func aGalleryMoleculeKeepsItsPageFileAndPiece() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "caffeine")
        let (record, kept, back) = try Self.keepAndRestore(&sim, id)
        #expect(record.validate() == [])
        #expect(record.molecule.source == .gallery)
        #expect(record.molecule.id == "caffeine")
        #expect(record.molecule.url?.absoluteString == "https://lupi.live/gallery/curated/popular/caffeine.xyz")
        #expect(record.molecule.sha256 == "912c14862af853b2234e6cff6c67d0462a25acab38fed1ada8bbf9967233d80a")
        #expect(record.molecule.formula == "C8H10N4O2" && record.molecule.atoms == 24)
        #expect(record.molecule.xyz == nil)
        #expect(record.origin.kind == .spawned)
        #expect(abs(Double(record.look.scale) - kept.sigma) < 1e-6 * kept.sigma)
        let scale = try #require(record.molecule.scale)
        #expect(scale.count == "24")
        #expect(abs(Double(scale.spanMetres) - 0.15) < 1e-6)
        let ref = try ScaleRef(text: scale.ref)
        #expect(ref.key == kept.identity.key)
        // scale-spec §7.2's table: caffeine's leaf embedded is 406 bytes.
        #expect(ref.bytes.count == 406)
        #expect(record.id == back.trophyID)
        #expect(back.name == "Caffeine")
        Self.expectSamePiece(kept, back)
        // The kept body is the trophy now.
        #expect(sim.session.body(id)?.trophyID == record.id)
    }

    @Test func peroxideEmbedsThePubChemConformer() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "hydrogen_peroxide")
        let (record, kept, back) = try Self.keepAndRestore(&sim, id)
        #expect(record.validate() == [])
        #expect(record.molecule.source == .pubchem)
        #expect(record.molecule.id == "cid:784")
        #expect(record.molecule.url?.absoluteString == "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/784/record/JSON?record_type=3d")
        let xyz = try #require(record.molecule.xyz)
        #expect(record.molecule.sha256 == LupiData.SHA256.hex(xyz))
        #expect(xyz.hasPrefix("4\nHydrogen peroxide | formula=H2O2 | charge_source=unavailable | source=pubchem:cid:784 | coordinates=lupi-play\n"))
        Self.expectSamePiece(kept, back)
    }

    @Test func aWrittenGeometryIsKeptByItsReferenceAlone() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "methane")
        let (record, kept, back) = try Self.keepAndRestore(&sim, id)
        #expect(record.validate() == [])
        #expect(record.molecule.source == .scale)
        #expect(record.molecule.sha256 == kept.identity.key.hex)
        #expect(record.molecule.formula == "CH4" && record.molecule.atoms == 5)
        #expect(record.look.scale == 0)
        #expect(record.molecule.xyz?.hasPrefix("5\nMethane | formula=CH4") == true)
        Self.expectSamePiece(kept, back)
    }

    /// M1's exit: a kept salt crystal of a billion atoms comes back as the same crystal.
    @Test func aBillionAtomSaltCrystalComesBackAsTheSameCrystal() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawnSalt(&sim, .billion)
        let (record, kept, back) = try Self.keepAndRestore(&sim, id)
        #expect(record.validate() == [])
        #expect(record.molecule.source == .scale)
        #expect(record.molecule.atoms == 1_000_000_000)
        #expect(record.molecule.formula == kept.facts.formula)
        #expect(record.molecule.xyz == nil)
        #expect(record.look.scale == 0)
        let scale = try #require(record.molecule.scale)
        #expect(scale.count == "1,000,000,000")
        // Two records and an empty path: 229 bytes for any salt rung from 10⁶ (scale.md §6.2, plan §7.3).
        #expect(try ScaleRef(text: scale.ref).bytes.count == 229)
        #expect(record.molecule.sha256 == ReceiptRung.billion.refKeyHex)
        #expect(scale.aggregate?.extents == [1, 1, 1])
        Self.expectSamePiece(kept, back)
        #expect(back.identity.root.hex == ReceiptRung.billion.specNodeID)
    }

    @Test func aFragmentIsANewMoleculeWithItsParentsStory() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "hydrogen_peroxide")
        let parent = try sim.session.keep(id, now: Self.now)
        sim.camera = Fixture.level
        sim.flick(id)
        sim.run(0.6)
        let (_, pieces) = try #require(sim.breaks.first)
        let piece = try #require(pieces.first)
        let (record, kept, back) = try Self.keepAndRestore(&sim, piece)
        #expect(record.validate() == [])
        #expect(record.molecule.source == .fragment)
        #expect(record.molecule.formula == "HO" && record.molecule.atoms == 2)
        #expect(record.origin.kind == .broken)
        #expect(record.origin.parent == ParentRef(name: "Hydrogen peroxide", formula: "H2O2", source: .pubchem, id: "cid:784", trophyId: parent.id))
        #expect(record.story() == "Broken from Hydrogen peroxide")
        let xyz = try #require(record.molecule.xyz)
        #expect(xyz.hasPrefix("2\nLupi fragment | formula=HO | charge_source=unavailable | parent=H2O2 | coordinates=lupi-play\n"))
        // Its reference is the peroxide's leaf plus one atoms step (scale-spec §7.4).
        let ref = try ScaleRef(text: try #require(record.molecule.scale).ref)
        #expect(ref.root == kept.identity.root && ref.path.steps.count == 1)
        Self.expectSamePiece(kept, back)
        #expect(back.brokenFrom == "Hydrogen peroxide")
    }

    @Test func keepingAgainKeepsTheIdAndFollowsThePinch() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "benzene")
        let first = try sim.session.keep(id, now: Self.now)
        let same = try sim.session.keep(id, now: Self.now.addingTimeInterval(60))
        #expect(same == first, "nothing changed, nothing to write")
        sim.pinch(id, ratio: 2, over: 0.3)
        sim.run(0.5)
        let grown = try sim.session.keep(id, now: Self.now.addingTimeInterval(120))
        #expect(grown.id == first.id && grown.createdAt == first.createdAt)
        #expect(grown.look.scale > first.look.scale * 1.5)
        #expect(grown.updatedAt > first.updatedAt)
        #expect(grown.validate() == [])
    }

    @Test func aCopyOfADeletedTrophyBecomesANewOne() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let first = try sim.session.keep(id, now: Self.now)
        sim.session.forget(trophy: first.id)
        let again = try sim.session.keep(id, now: Self.now.addingTimeInterval(5))
        #expect(again.id != first.id)
        #expect(again.molecule == first.molecule)
        #expect(again.validate() == [])
    }

    @Test func aRecordThatDisagreesWithItsReferenceIsRefused() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawnSalt(&sim, .thousand)
        let record = try sim.session.keep(id, now: Self.now)
        let catalog = Fixture.catalog
        func refused(_ change: (inout TrophyRecord) -> Void) -> Bool {
            var t = record
            change(&t)
            do {
                _ = try Restore.piece(t, catalog: catalog, store: GameStore())
                return false
            } catch KeepError.corrupt {
                return true
            } catch {
                return false
            }
        }
        #expect(try Restore.piece(record, catalog: catalog, store: GameStore()).count.formatted == "1,000")
        #expect(refused { $0.molecule.scale?.count = "1,001" })
        #expect(refused { $0.molecule.formula = "ClNa" })
        #expect(refused { $0.molecule.sha256 = String(repeating: "0", count: 64) })
        #expect(refused { $0.molecule.atoms = 999 })
        #expect(refused { $0.molecule.scale?.ref = "lsr1:AAAA" })
        // A reference to another rung is another piece: its count gives it away.
        let million = try SaltLadder.ref(levels: 3)
        #expect(refused { $0.molecule.scale?.ref = million.text })
    }

    @Test func aRecordSurvivesTheFirestoreValueCodec() throws {
        var sim = Fixture.sim()
        let fragmentID = Fixture.spawn(&sim, "hydrogen_peroxide")
        let records = [try sim.session.keep(fragmentID, now: Self.now), try sim.session.keep(Fixture.spawnSalt(&sim, .billion), now: Self.now)]
        for record in records {
            let value = try FirestoreEncoder().encode(record)
            guard case let .map(fields) = value else {
                Issue.record("a record encodes as a map")
                return
            }
            #expect(fields.count <= 32, "firestore.rules caps the payload at 32 keys")
            #expect(fields["id"] == .string(record.id.uuidString))
            let back = try FirestoreDecoder().decode(TrophyRecord.self, fields: fields)
            #expect(try LupiJSON.encoder().encode(back) == LupiJSON.encoder().encode(record))
            #expect(back.syncID == record.id.uuidString && !back.isSyncTombstone)
            #expect(back.tombstone(at: Self.now).isSyncTombstone)
        }
    }

    /// The scale example in LupiKit's fixtures is a real kept rung: it resolves offline here.
    @Test func lupiKitsScaleFixtureIsAKeptBillion() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("LupiKit/Tests/Fixtures/records/trophy-scale.json")
        let record = try LupiJSON.decoder().decode(TrophyRecord.self, from: Data(contentsOf: url))
        #expect(record.validate() == [])
        let piece = try Restore.piece(record, catalog: Fixture.catalog, store: GameStore())
        #expect(piece.count.formatted == "1,000,000,000")
        #expect(piece.identity.root.hex == ReceiptRung.billion.specNodeID)
        #expect(piece.identity.key.hex == record.molecule.sha256)
    }
}

extension ReceiptRung {
    /// The refKey of the rung kept whole: SHA-256 of the ref domain, its NodeID and the empty path.
    var refKeyHex: String { (try? SaltLadder.ref(levels: levels).key.hex) ?? "" }
}
