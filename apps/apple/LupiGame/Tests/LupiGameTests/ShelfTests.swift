import Foundation
import LupiChem
import LupiData
import LupiGame
import LupiGameSim
import LupiScale
import Testing

/// A room whose floor is at 0 with a shelf top at 0.8 m: the stub's lowest plane stands in for
/// the shelf, and the session is told the floor is lower.
enum ShelfRoom {
    static let camera = CameraState.looking(from: Vec3(0, 1.1, 0), at: Vec3(0, 0.85, -0.6))

    static func sim(floor: Double = 0) -> Simulation {
        var sim = Simulation(session: PlaySession(catalog: Fixture.catalog), world: StubWorld(floorY: 0.8), camera: camera)
        sim.reportedFloorY = floor
        return sim
    }

    static func shelfRests(_ sim: Simulation) -> [(BodyID, Vec3)] {
        sim.events.compactMap { if case let .restedOnShelf(id, support) = $0 { return (id, support) }; return nil }
    }
}

@Suite("shelves")
struct ShelfTests {
    // MARK: Pinning (plan §6.3)

    @Test func threeSecondsAtRestOnAShelfPinsOnce() throws {
        var sim = ShelfRoom.sim()
        let id = Fixture.spawn(&sim, "caffeine", settle: 2)
        #expect(ShelfRoom.shelfRests(sim).isEmpty, "not before three seconds of rest")
        sim.run(3)
        let rests = ShelfRoom.shelfRests(sim)
        #expect(rests.count == 1)
        let (rested, support) = try #require(rests.first)
        #expect(rested == id)
        #expect(abs(support.y - 0.8) < 0.02)
        sim.run(2)
        #expect(ShelfRoom.shelfRests(sim).count == 1, "once per rest")
    }

    @Test func theFloorIsNoShelf() {
        // The same surface, but it is the lowest floor.
        var sim = ShelfRoom.sim(floor: 0.8)
        _ = Fixture.spawn(&sim, "caffeine", settle: 2)
        sim.run(4)
        #expect(ShelfRoom.shelfRests(sim).isEmpty)
        // A low step 20 cm up is no shelf either.
        var low = ShelfRoom.sim(floor: 0.6)
        _ = Fixture.spawn(&low, "caffeine", settle: 2)
        low.run(4)
        #expect(ShelfRoom.shelfRests(low).isEmpty)
    }

    /// The stub's spheres roll off each other, so the stack is reported the way RealityKit
    /// would: contacts below each body's centre, pushing up.
    @Test func aStackOnAShelfMeetsItAtItsBase() throws {
        var sim = ShelfRoom.sim()
        let base = Fixture.spawn(&sim, "benzene", settle: 2)
        sim.session.spawn(.starter("water"), at: .world(Vec3(0.3, 0.9, -0.4)))
        sim.step()
        let upper = try #require(sim.session.bodyOrder.last)
        sim.run(2)
        let baseSupport = try #require(sim.session.shelfSupport(of: base))
        #expect(abs(baseSupport.y - 0.8) < 0.02)
        // Stand the water on the benzene, and report the touch between them: below the upper
        // body's centre and above the lower's, pushing up.
        func report(_ a: BodyID, on b: BodyID) {
            let below = try! #require(sim.session.body(b)).worldBounds
            let top = Vec3(below.centre.x, below.max.y, below.centre.z)
            sim.world.apply([.move(a, pose: RigidD(translation: top + Vec3(0, 0.03, 0)), linearVelocity: .zero, angularVelocity: .zero)])
            let contact = PlayContact(a: a, b: b, phase: .updated, impulse: 0.001, direction: Vec3(0, 1, 0), position: top, time: sim.time)
            _ = sim.session.step(FrameInput(time: sim.time + sim.dt, camera: sim.camera, bodies: sim.world.motions, contacts: [contact], floorY: 0))
        }
        report(upper, on: base)
        #expect(sim.session.body(upper)?.support == .body(base))
        #expect(sim.session.shelfSupport(of: upper) == baseSupport, "the stack's base meets the shelf")
        // The same stack on the floor is no shelf.
        let floorTouch = PlayContact(a: base, b: nil, phase: .updated, impulse: 0.001, direction: Vec3(0, 1, 0), position: Vec3(0, 0.1, -0.4), time: sim.time)
        _ = sim.session.step(FrameInput(time: sim.time + sim.dt, camera: sim.camera, bodies: sim.world.motions, contacts: [floorTouch], floorY: 0))
        #expect(sim.session.shelfSupport(of: upper) == nil)
        // A body on a trophy held in place on its shelf is on that shelf.
        let record = try sim.session.keep(base, now: KeepTests.now)
        let pose = try #require(sim.session.keptPose(base))
        sim.session.spawn(.trophy(record), at: .shelf(pose.entity))
        sim.step()
        let shelved = try #require(sim.session.bodyOrder.last)
        report(upper, on: shelved)
        let onTrophy = try #require(sim.session.shelfSupport(of: upper))
        #expect(abs(onTrophy.y - (try #require(sim.session.body(shelved)).worldBounds.min.y)) < 1e-9)
    }

    @Test func aShelvedTrophyWaitsInPlaceOutsideTheToyBudget() throws {
        var sim = ShelfRoom.sim()
        let id = Fixture.spawn(&sim, "caffeine", settle: 2)
        let record = try sim.session.keep(id, now: KeepTests.now)
        let pose = try #require(sim.session.keptPose(id))
        sim.session.clear()
        sim.run(0.2)
        // Back on its shelf next session: in place, kinematic, not a loose toy.
        sim.session.spawn(.trophy(record), at: .shelf(pose.entity))
        sim.step()
        let back = try #require(sim.session.bodyOrder.last)
        var b = try #require(sim.session.body(back))
        #expect(b.pinned && b.frozen && b.mode == .kinematic)
        #expect(b.trophyID == record.id)
        #expect((b.entityPose.translation - pose.entity.translation).length < 1e-9)
        #expect(sim.session.toys == 0)
        sim.run(1)
        b = try #require(sim.session.body(back))
        #expect((b.entityPose.translation - pose.entity.translation).length < 1e-9, "it does not fall")
        // Picked up, it is a loose toy again.
        sim.drag(back, by: SIMD2(0, -20), over: 0.2)
        b = try #require(sim.session.body(back))
        #expect(!b.pinned && !b.frozen && b.mode == .dynamic)
        #expect(sim.session.toys == 1)
    }

    @Test func aHitLetsAShelvedTrophyGo() throws {
        var sim = ShelfRoom.sim()
        let id = Fixture.spawn(&sim, "caffeine", settle: 2)
        let record = try sim.session.keep(id, now: KeepTests.now)
        let pose = try #require(sim.session.keptPose(id))
        sim.session.clear()
        sim.run(0.2)
        sim.session.spawn(.trophy(record), at: .shelf(pose.entity))
        sim.step()
        let shelved = try #require(sim.session.bodyOrder.last)
        // Drop a buckyball onto it.
        let above = pose.entity.translation + Vec3(0, 0.25, 0)
        sim.session.spawn(.starter("c60_buckyball"), at: .world(above))
        sim.run(1.5)
        let b = try #require(sim.session.body(shelved))
        #expect(!b.frozen && b.mode == .dynamic)
        #expect(b.pinned, "still the shelf's, outside the toy budget")
    }

    // MARK: Geometry

    @Test func placementsAreRelativeToTheRoot() {
        let root = ShelfMath.rootPose(at: Vec3(0.3, 0.8, -0.5), camera: Vec3(0, 1.4, 0.5))
        // The root faces the camera: its +z points at it across the floor.
        let facing = root.applyDirection(Vec3(0, 0, 1))
        let toward = Vec3(-0.3, 0, 1).normalized
        #expect((facing - toward).length < 1e-12)
        #expect(abs(root.applyDirection(Vec3(0, 1, 0)).y - 1) < 1e-12, "upright")
        let entity = RigidD(rotation: Quat.axisAngle(Vec3(1, 2, 3), 0.7), translation: Vec3(0.42, 0.85, -0.61))
        let pose = KeptPose(entity: entity, scale: 0.0156, spanMetres: 0.15)
        let t = ShelfMath.transform(pose, root: root)
        #expect(t.scale == 0.0156)
        let back = ShelfMath.worldPose(t, root: root)
        #expect((back.translation - entity.translation).length < 1e-6)
        #expect((back.applyDirection(Vec3(1, 0, 0)) - entity.applyDirection(Vec3(1, 0, 0))).length < 1e-6)
        // Moving the root ("Put the shelf here") carries the placement with it.
        let moved = RigidD(rotation: Quat.axisAngle(Vec3(0, 1, 0), 1.1), translation: Vec3(-2, 0.7, 1))
        let carried = ShelfMath.worldPose(t, root: moved)
        let offset = root.inverse.apply(entity.translation)
        #expect((carried.translation - moved.apply(offset)).length < 1e-6)
        // A scale trophy stores 0 and its span (scale-spec §7.5).
        let scale = ShelfMath.placement(trophy: UUID(), pose: KeptPose(entity: entity, scale: 0, spanMetres: 0.3), root: root, at: KeepTests.now)
        #expect(scale.transform.scale == 0 && scale.spanMetres == 0.3)
        #expect(ShelfMath.placement(trophy: UUID(), pose: pose, root: root, at: KeepTests.now).spanMetres == nil)
    }

    // MARK: The store (contracts.md §2)

    static func tempStore() -> ShelfStore {
        ShelfStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("lupi-shelves-\(UUID().uuidString)"))
    }

    func placement(_ trophy: UUID) -> ShelfPlacement {
        ShelfPlacement(
            trophyId: trophy, transform: RootTransform(translation: SIMD3(0.1, 0, 0), rotation: SIMD4(0, 0, 0, 1), scale: 0.02),
            pinnedAt: KeepTests.now
        )
    }

    @Test func aTrophyLivesOnOneShelfAtATime() throws {
        let store = Self.tempStore()
        defer { try? store.deleteAll() }
        let desk = try store.create(name: "Desk", rootAnchorId: UUID(), at: KeepTests.now)
        let lounge = try store.create(rootAnchorId: UUID(), at: KeepTests.now.addingTimeInterval(1))
        #expect(lounge.name == "Room 2")
        #expect(store.lastUsed == lounge.id)
        let a = UUID()
        guard case .pinned = try store.pin(placement(a), on: desk.id, at: KeepTests.now) else {
            Issue.record("pinned")
            return
        }
        _ = try store.pin(placement(a), on: lounge.id, at: KeepTests.now.addingTimeInterval(2))
        #expect(try store.load(desk.id).placements.isEmpty, "pinning it elsewhere moves it")
        #expect(try store.load(lounge.id).placements.map(\.trophyId) == [a])
        _ = try store.pin(placement(UUID()), on: desk.id, at: KeepTests.now.addingTimeInterval(3))
        #expect(store.list().map(\.id) == [desk.id, lounge.id], "most recently changed first")
        try store.delete(desk.id)
        for _ in 1..<ShelfRecord.maxPlacements { _ = try store.pin(placement(UUID()), on: lounge.id, at: KeepTests.now) }
        #expect(try store.pin(placement(UUID()), on: lounge.id, at: KeepTests.now) == .full)
        #expect(try store.dropMissing(keeping: [a]) == 59)
        #expect(try store.load(lounge.id).placements.map(\.trophyId) == [a])
    }

    @Test func mapsAndSnapshotsStayBesideTheirShelf() throws {
        let store = Self.tempStore()
        defer { try? store.deleteAll() }
        var shelf = try store.create(rootAnchorId: UUID(), at: KeepTests.now)
        #expect(throws: ShelfStoreError.mapNotReady("limited")) {
            try store.saveMap(Data([1, 2, 3]), shelf: &shelf, status: "limited", at: KeepTests.now)
        }
        try store.saveMap(Data([1, 2, 3]), shelf: &shelf, status: "mapped", at: KeepTests.now.addingTimeInterval(5))
        try store.saveSnapshot(Data([0xff, 0xd8]), shelf: &shelf)
        let read = try store.load(shelf.id)
        #expect(read.mapStatusAtSave == "mapped" && read.mapSavedAt == KeepTests.now.addingTimeInterval(5))
        #expect(read.snapshotFile == "snapshot.jpg")
        #expect(store.map(of: read) == Data([1, 2, 3]))
        #expect(store.snapshot(of: read) == Data([0xff, 0xd8]))
        let folder = store.directory.appendingPathComponent(shelf.id.uuidString)
        #expect(Set(try FileManager.default.contentsOfDirectory(atPath: folder.path)) == ["shelf.json", "world.arworldmap", "snapshot.jpg"])
        // Deleting a shelf deletes its directory: map, snapshot and record.
        try store.delete(shelf.id)
        #expect(!FileManager.default.fileExists(atPath: folder.path))
        #expect(store.lastUsed == nil)
        #expect(store.list().isEmpty)
    }
}

@Suite("the recovery ladder")
struct RecoveryTests {
    let root = RigidD(translation: Vec3(0.5, 0.8, -1))

    @Test func aMatchBringsTheTrophiesBackAndSavesTheMap() {
        var ladder = ShelfRecovery()
        ladder.begin(at: 100)
        #expect(ladder.showsGhost && !ladder.trophiesVisible)
        #expect(ladder.frame(at: 101, tracking: .relocalizing, rootAnchor: nil).isEmpty)
        // The root anchor alone is not a match until tracking is normal.
        #expect(ladder.frame(at: 102, tracking: .relocalizing, rootAnchor: root).isEmpty)
        let events = ladder.frame(at: 104.5, tracking: .normal, rootAnchor: root)
        #expect(events == [.relocalized(after: 4.5), .trophiesAppear(root: root), .saveMap])
        #expect(ladder.trophiesVisible && !ladder.showsGhost)
        #expect(ladder.frame(at: 105, tracking: .normal, rootAnchor: root).isEmpty)
    }

    @Test func twentySecondsWithoutAMatchOffersPutTheShelfHere() {
        var ladder = ShelfRecovery()
        ladder.begin(at: 0)
        #expect(ladder.frame(at: 19.9, tracking: .relocalizing, rootAnchor: nil).isEmpty)
        #expect(ladder.frame(at: 20, tracking: .relocalizing, rootAnchor: nil) == [.offerPutHere])
        #expect(ladder.offersPutHere && ladder.showsGhost)
        // Placing needs the choice first.
        #expect(ladder.place(root: root, at: 21).isEmpty)
        ladder.choosePutHere(at: 22)
        #expect(ladder.phase == .placing)
        #expect(ladder.place(root: root, at: 23) == [.rootPlaced(root), .trophiesAppear(root: root), .saveMap])
        #expect(ladder.trophiesVisible && ladder.root == root)
    }

    @Test func aLateMatchStillWinsWhilePlacing() {
        var ladder = ShelfRecovery()
        ladder.begin(at: 0)
        _ = ladder.frame(at: 25, tracking: .relocalizing, rootAnchor: nil)
        ladder.choosePutHere(at: 26)
        #expect(ladder.frame(at: 30, tracking: .normal, rootAnchor: root) == [.relocalized(after: 30), .trophiesAppear(root: root), .saveMap])
    }

    @Test func normalTrackingWithoutTheRootGivesUpEarly() {
        var ladder = ShelfRecovery()
        ladder.begin(at: 0)
        #expect(ladder.frame(at: 1, tracking: .normal, rootAnchor: nil).isEmpty)
        #expect(ladder.frame(at: 3.9, tracking: .normal, rootAnchor: nil).isEmpty)
        #expect(ladder.frame(at: 4, tracking: .normal, rootAnchor: nil) == [.offerPutHere])
    }

    @Test func aMissingMapGoesStraightToTheOfferAndANewRoomStartsOver() {
        var ladder = ShelfRecovery()
        #expect(ladder.beginWithoutMap(at: 0) == [.offerPutHere])
        #expect(ladder.offersPutHere)
        ladder.startNewRoom()
        #expect(ladder.phase == .idle && !ladder.showsGhost && !ladder.trophiesVisible)
        ladder.created(root: root, at: 5)
        #expect(ladder.trophiesVisible)
    }

    @Test func mapsSaveFiveSecondsAfterTheLastPinWhenMappingAllows() {
        var policy = MapSavePolicy()
        #expect(!policy.shouldSave(at: 0, mapping: .mapped))
        policy.pinned(at: 10)
        policy.pinned(at: 12)
        #expect(!policy.shouldSave(at: 16.9, mapping: .mapped))
        #expect(!policy.shouldSave(at: 17, mapping: .limited))
        #expect(!policy.needsCoverage(at: 18.9, mapping: .limited))
        #expect(policy.needsCoverage(at: 19, mapping: .limited), "Look around the shelf so I can remember it")
        #expect(policy.shouldSave(at: 20, mapping: .extending))
        policy.began()
        #expect(!policy.shouldSave(at: 20, mapping: .mapped), "one save at a time")
        policy.finished(at: 21, saved: false)
        #expect(policy.shouldSave(at: 26, mapping: .mapped), "a failed save retries")
        policy.began()
        policy.finished(at: 26.5, saved: true)
        #expect(policy.dueAt == nil)
        policy.saveSoon(at: 30)
        #expect(policy.shouldSave(at: 30, mapping: .mapped), "after a relocalization, at once")
    }

    @Test func spikeA1LogsWhatTheOwnerMustRead() {
        var probe = A1Probe()
        probe.run(at: 10, mapBytes: 3_500_000, anchors: 4)
        probe.frame(at: 10.1, tracking: .relocalizing, mapping: .notAvailable, root: nil)
        probe.frame(at: 10.2, tracking: .relocalizing, mapping: .notAvailable, root: nil)
        probe.frame(at: 13.0, tracking: .normal, mapping: .extending, root: RigidD(translation: Vec3(0, 0.8, -1)))
        probe.frame(at: 14.0, tracking: .normal, mapping: .mapped, root: RigidD(translation: Vec3(0, 0.8, -1.02)))
        probe.saved(at: 15, bytes: 3_600_000, milliseconds: 180, mapping: .mapped, anchors: 4)
        #expect(probe.lines(10) == [
            "A1 0.0 s run map 3417 KB, 4 anchors",
            "A1 0.1 s tracking relocalizing after 0.1 s",
            "A1 0.1 s mapping notAvailable",
            "A1 3.0 s tracking normal after 3.0 s",
            "A1 3.0 s mapping extending",
            "A1 3.0 s root anchor after 3.0 s, 2 frames drawn while relocalizing",
            "A1 4.0 s mapping mapped",
            "A1 4.0 s root drift 2.0 cm",
            "A1 5.0 s saved 3515 KB in 180 ms at mapped, 4 anchors",
        ])
        #expect(probe.jsonLines().split(separator: "\n").count == 9)
    }
}
