import Foundation
import LupiCloudTesting
import LupiChem
import LupiGame
import LupiPlay
import Testing

@Suite("durable keep preparation and pending play")
struct KeepTransactionTests {
    @Test func aFailedWriteLeavesPlayUnkeptAndRetryKeepsTheUUID() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let prepared = try sim.session.prepareKeep(id, now: KeepTests.now)
        // The caller's disk write failed: no commit, no success feedback.
        #expect(sim.session.body(id)?.trophyID == nil)
        sim.step()
        #expect(!sim.last.juice.contains { $0.output.sounds.contains { $0.voice == .kept } })
        #expect(sim.session.canCommitKeep(prepared))
        // A retry writes the same record and only then commits.
        let committed = sim.session.commitKeep(prepared)
        #expect(committed)
        #expect(sim.session.body(id)?.trophyID == prepared.record.id)
        sim.step()
        #expect(sim.last.juice.contains { $0.output.sounds.contains { $0.voice == .kept } })
        let duplicate = sim.session.commitKeep(prepared)
        #expect(!duplicate, "a duplicate completion cannot celebrate twice")
    }

    @Test func clearRejectsALateKeepCompletion() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let prepared = try sim.session.prepareKeep(id, now: KeepTests.now)
        sim.session.clear()
        let committed = sim.session.commitKeep(prepared)
        #expect(!committed)
    }

    @Test func forgettingATrophyRejectsItsDelayedUpdate() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let first = try sim.session.keep(id, now: KeepTests.now)
        let update = try sim.session.prepareKeep(id, now: KeepTests.now)
        sim.session.forget(trophy: first.id)
        let committed = sim.session.commitKeep(update)
        #expect(!committed)
        let copy = try sim.session.prepareKeep(id, now: KeepTests.now)
        #expect(copy.record.id != first.id)
    }

    @Test func resizingRejectsTheOldPreparedSize() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let prepared = try sim.session.prepareKeep(id, now: KeepTests.now)
        sim.pinch(id, ratio: 2, over: 0.3)
        sim.run(0.5)
        let committed = sim.session.commitKeep(prepared)
        #expect(!committed)
    }

    @Test func shelfCommitCanWaitToCelebrate() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let prepared = try sim.session.prepareKeep(id, now: KeepTests.now)
        let committed = sim.session.commitKeep(prepared, celebrate: false)
        #expect(committed)
        sim.step()
        #expect(!sim.last.juice.contains { $0.output.sounds.contains { $0.voice == .kept } })
        #expect(sim.session.body(id)?.pinned == false)
    }

    @Test func aDurableKeepRetainsItsUUIDWhenResizeFinishesDuringTheWrite() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let prepared = try sim.session.prepareKeep(id, now: KeepTests.now)
        sim.pinch(id, ratio: 2, over: 0.3)
        sim.run(0.5)
        // The saved snapshot describes its original size. Attaching its durable UUID is
        // safe for the unchanged source; the next keep brings the saved size up to date.
        let committed = sim.session.commitKeep(prepared, celebrate: false, allowingResize: true)
        #expect(committed)
        let resized = try sim.session.prepareKeep(id, now: KeepTests.now.addingTimeInterval(1))
        #expect(resized.record.id == prepared.record.id)
        #expect(resized.record.look.scale > prepared.record.look.scale)
    }

    @Test func clearDiscardsAllQueuedIntentsAndAllowsNewOnes() {
        var pending = PendingSpawns()
        pending.enqueue(.starter("water"))
        pending.enqueueAtom(8)
        pending.enqueueReceipt()
        pending.clear()
        let cleared = pending.drain()
        #expect(cleared.sources.isEmpty && cleared.atoms.isEmpty && !cleared.receipt)
        pending.enqueue(.starter("caffeine"))
        pending.enqueueAtom(6)
        pending.enqueueReceipt()
        let later = pending.drain()
        #expect(later.sources.count == 1 && later.atoms == [6] && later.receipt)
        #expect(pending.sources.isEmpty && pending.atoms.isEmpty && !pending.receipt)
    }

    @Test func backgroundCancelsTheHandWithoutAThrowAndLaterGesturesWork() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let point = try #require(sim.screenPoint(of: id))
        let finger = sim.touch()
        sim.step(touches: [TouchSample(id: finger, phase: .began, location: point, time: sim.time + sim.dt)])
        for k in 1...20 {
            sim.step(touches: [TouchSample(id: finger, phase: .moved,
                                          location: point + SIMD2(Double(k) * 3, 0), time: sim.time + sim.dt)])
        }
        #expect(sim.session.body(id)?.mode == .kinematic)
        sim.session.endInteractions()
        sim.step()
        #expect(sim.session.body(id)?.mode == .dynamic)
        #expect(sim.world.lastLaunch(id) == nil)
        #expect(!sim.last.juice.contains { $0.output.sounds.contains { $0.voice == .whoosh } })
        sim.drag(id, by: SIMD2(0, -150), over: 0.1)
        #expect(sim.world.lastLaunch(id) != nil)
    }

    @Test func backgroundAndStopRejectLateARStartResults() throws {
        var lifecycle = PlayLifecycle()
        let firstRequest = lifecycle.request(.active)
        let first = try #require(firstRequest)
        let pauseRequest = lifecycle.request(.suspended)
        let pause = try #require(pauseRequest)
        let resumeRequest = lifecycle.request(.active)
        let resume = try #require(resumeRequest)
        #expect(!lifecycle.accepts(first) && !lifecycle.accepts(pause))
        #expect(lifecycle.accepts(resume))
        let stopRequest = lifecycle.request(.stopped)
        let stop = try #require(stopRequest)
        #expect(!lifecycle.accepts(resume) && lifecycle.accepts(stop))
        let afterStop = lifecycle.request(.active)
        #expect(afterStop == nil)
    }

    @Test func realDiskFailureRetriesOneTrophyAndSurvivesReopening() async throws {
        let cloud = FakeFirebase()
        let offline = NoNetwork()
        let device = await CaseDevice(cloud, transport: offline, configured: false)
        defer { try? FileManager.default.removeItem(at: device.folder) }
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let prepared = try sim.session.prepareKeep(id, now: KeepTests.now)
        let condition = try await device.trophies.saveCondition(for: prepared.record.id)
        // A file where the collection directory belongs injects a real filesystem failure.
        try Data("blocked".utf8).write(to: device.folder)
        await #expect(throws: (any Error).self) {
            try await device.trophies.keep(prepared.record, ifUnchanged: condition)
        }
        #expect(try await device.trophies.trophies().isEmpty)
        #expect(sim.session.body(id)?.trophyID == nil)
        sim.step()
        #expect(!sim.last.juice.contains { $0.output.sounds.contains { $0.voice == .kept } })
        try FileManager.default.removeItem(at: device.folder)
        try await device.trophies.keep(prepared.record, ifUnchanged: condition)
        let committed = sim.session.commitKeep(prepared)
        #expect(committed)
        let reopened = await CaseDevice(cloud, folder: device.folder, transport: offline, configured: false)
        #expect(try await reopened.trophies.trophies() == [prepared.record])
        #expect(await offline.requests == 0)
    }

    @Test func aDelayedConditionalKeepCannotResurrectADeletedTrophy() async throws {
        let cloud = FakeFirebase()
        let device = await CaseDevice(cloud, configured: false)
        defer { try? FileManager.default.removeItem(at: device.folder) }
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let prepared = try sim.session.prepareKeep(id, now: KeepTests.now)
        try await device.trophies.keep(prepared.record)
        let condition = try await device.trophies.saveCondition(for: prepared.record.id)
        try await device.trophies.delete(prepared.record.id, at: KeepTests.now)
        await #expect(throws: (any Error).self) {
            try await device.trophies.keep(prepared.record, ifUnchanged: condition)
        }
        let reopened = await CaseDevice(cloud, folder: device.folder, configured: false)
        #expect(try await reopened.trophies.trophies().isEmpty)
    }
}
