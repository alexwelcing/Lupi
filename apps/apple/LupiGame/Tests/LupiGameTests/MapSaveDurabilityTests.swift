import Foundation
import LupiData
import LupiGame
import Testing

@Suite("room-scoped map saves")
struct MapSaveCoordinatorTests {
    func begin(_ saves: inout MapSaveCoordinator, at t: Double, mapping: MappingInput = .mapped) throws -> MapSaveCoordinator.Request {
        let request = saves.begin(at: t, mapping: mapping)
        return try #require(request)
    }

    @Test func pinsQueuedDuringASaveRemainDueAfterSuccess() throws {
        var saves = MapSaveCoordinator()
        saves.activate(roomID: UUID(), rootAnchorID: UUID())
        saves.pinned(at: 10)
        let early = saves.begin(at: 14.9, mapping: .mapped)
        #expect(early == nil)
        let first = try begin(&saves, at: 15)
        #expect(saves.policy.dueAt == nil)
        saves.pinned(at: 16)
        let overlapping = saves.begin(at: 25, mapping: .mapped)
        #expect(overlapping == nil, "only one request at once")
        let accepted = saves.finish(first, at: 17, saved: true)
        #expect(accepted)
        #expect(saves.policy.dueAt == 21)
        let nextEarly = saves.begin(at: 20.9, mapping: .mapped)
        #expect(nextEarly == nil)
        _ = try begin(&saves, at: 21)
    }

    @Test func explicitRequestsQueuedDuringASaveSurviveItsCompletion() throws {
        for succeeded in [false, true] {
            var saves = MapSaveCoordinator()
            saves.activate(roomID: UUID(), rootAnchorID: UUID())
            saves.saveSoon(at: 10)
            let first = try begin(&saves, at: 10)
            saves.saveSoon(at: 11)
            let accepted = saves.finish(first, at: 12, saved: succeeded)
            #expect(accepted)
            #expect(saves.policy.dueAt == 11, "a completed request must not consume newer work")
            _ = try begin(&saves, at: 12)
        }
    }

    @Test func failureRetriesAndPreservesAnEarlierPinDeadline() throws {
        var saves = MapSaveCoordinator()
        saves.activate(roomID: UUID(), rootAnchorID: UUID())
        saves.saveSoon(at: 0)
        let first = try begin(&saves, at: 0)
        let firstAccepted = saves.finish(first, at: 1, saved: false)
        #expect(firstAccepted)
        #expect(saves.policy.dueAt == 6)
        let retry = try begin(&saves, at: 6)
        saves.pinned(at: 7)
        let retryAccepted = saves.finish(retry, at: 9, saved: false)
        #expect(retryAccepted)
        #expect(saves.policy.dueAt == 12, "do not move a queued pin's deadline to 14")
    }

    @Test func staleRoomSuccessAndFailureLeaveTheNewRoomRequestUntouched() throws {
        for succeeded in [false, true] {
            var saves = MapSaveCoordinator()
            saves.activate(roomID: UUID(), rootAnchorID: UUID())
            saves.saveSoon(at: 0)
            let old = try begin(&saves, at: 0)
            let roomB = UUID(), rootB = UUID()
            saves.activate(roomID: roomB, rootAnchorID: rootB)
            saves.saveSoon(at: 1)
            let current = try begin(&saves, at: 1)
            saves.pinned(at: 2)
            let unchanged = saves
            #expect(!saves.accepts(old))
            let oldAccepted = saves.finish(old, at: 3, saved: succeeded)
            #expect(!oldAccepted)
            #expect(saves == unchanged)
            #expect(saves.accepts(current))
            let currentAccepted = saves.finish(current, at: 4, saved: true)
            #expect(currentAccepted)
            #expect(saves.policy.dueAt == 7)
        }
    }

    @Test func reopeningTheSameRoomAndMovingItsRootRejectOlderGenerations() throws {
        let room = UUID(), root = UUID()
        var saves = MapSaveCoordinator()
        saves.activate(roomID: room, rootAnchorID: root)
        saves.saveSoon(at: 0)
        let old = try begin(&saves, at: 0)
        saves.activate(roomID: room, rootAnchorID: root)
        saves.saveSoon(at: 1)
        let reopened = try begin(&saves, at: 1)
        #expect(old.roomID == reopened.roomID && old.rootAnchorID == reopened.rootAnchorID)
        #expect(old.generation != reopened.generation)
        let oldAccepted = saves.finish(old, at: 2, saved: true)
        #expect(!oldAccepted)
        let movedRoot = UUID()
        saves.activate(roomID: room, rootAnchorID: movedRoot)
        saves.saveSoon(at: 3)
        let moved = try begin(&saves, at: 3)
        #expect(moved.rootAnchorID == movedRoot)
        let reopenedAccepted = saves.finish(reopened, at: 4, saved: false)
        #expect(!reopenedAccepted)
        #expect(saves.accepts(moved))
    }

    @Test func duplicateCompletionCannotFinishANewerRequest() throws {
        var saves = MapSaveCoordinator()
        saves.activate(roomID: UUID(), rootAnchorID: UUID())
        saves.saveSoon(at: 0)
        let first = try begin(&saves, at: 0)
        let accepted = saves.finish(first, at: 1, saved: true)
        #expect(accepted)
        saves.saveSoon(at: 2)
        let second = try begin(&saves, at: 2)
        #expect(first.sequence != second.sequence)
        let unchanged = saves
        let duplicateAccepted = saves.finish(first, at: 3, saved: true)
        #expect(!duplicateAccepted)
        #expect(saves == unchanged && saves.accepts(second))
    }

    @Test func invalidatingADeletedOrStoppedRoomDropsItsPendingWork() throws {
        var saves = MapSaveCoordinator()
        saves.activate(roomID: UUID(), rootAnchorID: UUID())
        saves.saveSoon(at: 0)
        let old = try begin(&saves, at: 0)
        saves.pinned(at: 1)
        saves.invalidate()
        let unchanged = saves
        let accepted = saves.finish(old, at: 2, saved: false)
        #expect(!accepted)
        #expect(saves == unchanged && saves.roomID == nil && saves.request == nil)
        saves.saveSoon(at: 3)
        saves.pinned(at: 3)
        #expect(saves.policy.dueAt == nil && !saves.policy.saving)
        let afterInvalidation = saves.begin(at: 100, mapping: .mapped)
        #expect(afterInvalidation == nil)
        #expect(!saves.needsCoverage(at: 100, mapping: .limited))
    }

    @Test func mappingStillGatesSavingAndCoverage() throws {
        var saves = MapSaveCoordinator()
        saves.activate(roomID: UUID(), rootAnchorID: UUID())
        saves.saveSoon(at: 1)
        let unmapped = saves.begin(at: 3, mapping: .limited)
        #expect(unmapped == nil)
        #expect(saves.needsCoverage(at: 3, mapping: .limited))
        _ = try begin(&saves, at: 3, mapping: .extending)
    }
}

@Suite("durable shelf updates")
struct ShelfDurabilityTests {
    let date = Date(timeIntervalSince1970: 1_700_000_000)

    func store() -> ShelfStore {
        ShelfStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("lupi-shelf-durability-\(UUID().uuidString)"))
    }

    func placement(_ id: UUID) -> ShelfPlacement {
        ShelfPlacement(trophyId: id,
                       transform: RootTransform(translation: SIMD3(0, 0, 0), rotation: SIMD4(0, 0, 0, 1), scale: 0.02),
                       pinnedAt: date)
    }

    @Test func lateUpdatesCannotRecreateADeletedRoom() throws {
        let store = store()
        defer { try? store.deleteAll() }
        var stale = try store.create(rootAnchorId: UUID(), at: date)
        try store.delete(stale.id)
        let unchanged = stale
        #expect(throws: ShelfStoreError.missing(stale.id)) { try store.save(stale) }
        #expect(throws: ShelfStoreError.missing(stale.id)) {
            try store.saveMap(Data([1]), shelf: &stale, status: "mapped", at: date)
        }
        #expect(throws: ShelfStoreError.missing(stale.id)) { try store.saveSnapshot(Data([2]), shelf: &stale) }
        #expect(throws: ShelfStoreError.missing(stale.id)) {
            try store.updateRoot(on: stale.id, to: UUID(), expecting: stale.rootAnchorId, at: date)
        }
        #expect(stale == unchanged)
        #expect(store.list().isEmpty && store.lastUsed == nil)
        #expect(!FileManager.default.fileExists(atPath: store.directory.appendingPathComponent(stale.id.uuidString).path))
    }

    @Test func lateUpdatesCannotRecreateAnErasedShelfDirectory() throws {
        let store = store()
        defer { try? store.deleteAll() }
        var stale = try store.create(rootAnchorId: UUID(), at: date)
        try store.deleteAll()
        #expect(throws: ShelfStoreError.missing(stale.id)) {
            try store.saveMap(Data([1]), shelf: &stale, status: "mapped", at: date)
        }
        #expect(throws: ShelfStoreError.missing(stale.id)) { try store.saveSnapshot(Data([2]), shelf: &stale) }
        #expect(throws: ShelfStoreError.missing(stale.id)) { try store.save(stale) }
        #expect(!FileManager.default.fileExists(atPath: store.directory.path))
        let new = try store.create(name: "New room", rootAnchorId: UUID(), at: date)
        #expect(try store.load(new.id) == new && store.lastUsed == new.id, "explicit creation still makes a room")
    }

    @Test func anExistingFolderWithoutARecordDoesNotAuthorizeAnUpdate() throws {
        let store = store()
        defer { try? store.deleteAll() }
        var stale = try store.create(rootAnchorId: UUID(), at: date)
        let folder = store.directory.appendingPathComponent(stale.id.uuidString)
        try FileManager.default.removeItem(at: folder.appendingPathComponent(ShelfStore.recordFileName))
        #expect(throws: ShelfStoreError.missing(stale.id)) {
            try store.saveMap(Data([1]), shelf: &stale, status: "mapped", at: date)
        }
        #expect(throws: ShelfStoreError.missing(stale.id)) { try store.saveSnapshot(Data([2]), shelf: &stale) }
        #expect(try FileManager.default.contentsOfDirectory(atPath: folder.path).isEmpty)
    }

    @Test func mapAndSnapshotMetadataMergeIntoTheLatestDurableRecord() throws {
        let store = store()
        defer { try? store.deleteAll() }
        let original = try store.create(name: "Old name", rootAnchorId: UUID(), at: date)
        var staleMap = original, staleSnapshot = original
        let a = UUID(), b = UUID()
        _ = try store.pin(placement(a), on: original.id, at: date.addingTimeInterval(1))
        _ = try store.pin(placement(b), on: original.id, at: date.addingTimeInterval(2))
        try store.dropMissing(keeping: [b])
        var latest = try store.load(original.id)
        latest.name = "Renamed room"
        latest.lastRelocalizedAt = date.addingTimeInterval(3)
        latest.updatedAt = date.addingTimeInterval(20)
        try store.save(latest)
        try store.saveMap(Data([1, 2]), shelf: &staleMap, status: "extending", at: date.addingTimeInterval(4))
        #expect(staleMap.name == latest.name && staleMap.placements == latest.placements)
        #expect(staleMap.placement(of: a) == nil && staleMap.placement(of: b) != nil)
        try store.saveSnapshot(Data([3, 4]), shelf: &staleSnapshot)
        let durable = try store.load(original.id)
        #expect(durable == staleSnapshot)
        #expect(durable.name == latest.name && durable.placements == latest.placements)
        #expect(durable.updatedAt == latest.updatedAt && durable.lastRelocalizedAt == latest.lastRelocalizedAt)
        #expect(durable.mapSavedAt == date.addingTimeInterval(4) && durable.mapStatusAtSave == "extending")
        #expect(store.map(of: durable) == Data([1, 2]) && store.snapshot(of: durable) == Data([3, 4]))
    }

    @Test func replacingTheRootPreservesDurableEditsAndRejectsOldMaps() throws {
        let store = store()
        defer { try? store.deleteAll() }
        let original = try store.create(rootAnchorId: UUID(), at: date)
        let trophy = UUID()
        _ = try store.pin(placement(trophy), on: original.id, at: date.addingTimeInterval(1))
        var latest = try store.load(original.id)
        latest.name = "Latest name"
        try store.save(latest)
        let movedRoot = UUID()
        let moved = try store.updateRoot(on: original.id, to: movedRoot, expecting: original.rootAnchorId,
                                         at: date.addingTimeInterval(2))
        #expect(moved.rootAnchorId == movedRoot && moved.name == latest.name && moved.placements == latest.placements)
        var old = original
        #expect(throws: ShelfStoreError.rootChanged(original.id)) {
            try store.saveMap(Data([1]), shelf: &old, status: "mapped", at: date)
        }
        #expect(throws: ShelfStoreError.rootChanged(original.id)) { try store.saveSnapshot(Data([2]), shelf: &old) }
        #expect(throws: ShelfStoreError.rootChanged(original.id)) {
            try store.updateRoot(on: original.id, to: UUID(), expecting: original.rootAnchorId, at: date)
        }
        #expect(try store.load(original.id) == moved && old == original)
        #expect(store.map(of: moved) == nil && store.snapshot(of: moved) == nil)
    }

    @Test func writeFailuresDoNotPublishSuccessfulMapMetadata() throws {
        let store = store()
        defer { try? store.deleteAll() }
        var room = try store.create(rootAnchorId: UUID(), at: date)
        let original = room
        let mapURL = store.directory.appendingPathComponent(room.id.uuidString).appendingPathComponent(room.worldMapFile)
        try FileManager.default.createDirectory(at: mapURL, withIntermediateDirectories: false)
        #expect(throws: (any Error).self) {
            try store.saveMap(Data([1]), shelf: &room, status: "mapped", at: date.addingTimeInterval(1))
        }
        #expect(room == original)
        #expect(try store.load(room.id) == original)
    }
}
