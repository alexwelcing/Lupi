import Foundation
import LupiAuth
import LupiCloudTesting
import LupiData
import LupiGame
import LupiGameSim
import LupiSync
import Testing

/// Refuses every request and counts them: proof that signed-out use never touches the network.
actor NoNetwork: HTTPTransport {
    private(set) var requests = 0

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests += 1
        throw TransportError("offline")
    }
}

/// One device's trophy case against the shared fake Firebase, with its own folder and Keychain.
struct CaseDevice {
    let folder: URL
    let clock: TestClock
    let trophies: TrophyCase

    init(_ cloud: FakeFirebase, folder: URL? = nil, transport: (any HTTPTransport)? = nil, configured: Bool = true) async {
        self.folder = folder ?? FileManager.default.temporaryDirectory.appendingPathComponent("lupi-case-\(UUID().uuidString)")
        clock = TestClock(await cloud.now)
        trophies = TrophyCase.make(
            directory: self.folder,
            configuration: configured ? AccountConfiguration(apiKey: "test-api-key", projectID: "demo-lupi") : nil,
            tokens: InMemoryTokenStore(), transport: transport ?? cloud, now: clock.function
        )
    }
}

func appleSignIn(sub: String = "apple-owner", code: String? = nil) -> AppleCredential {
    let nonce = AppleNonce()
    return AppleCredential(idToken: FakeAppleIDToken.make(sub: sub, nonceHash: nonce.hashed), rawNonce: nonce.raw, authorizationCode: code)
}

/// Three trophies of very different sizes, kept in one session: a gallery molecule, a billion
/// atoms of salt and a fragment.
func keptTrophies() throws -> [(record: TrophyRecord, key: String)] {
    var sim = Fixture.sim()
    let caffeine = Fixture.spawn(&sim, "caffeine")
    let salt = Fixture.spawnSalt(&sim, .billion)
    let peroxide = Fixture.spawn(&sim, "hydrogen_peroxide")
    var out: [(TrophyRecord, String)] = []
    for id in [caffeine, salt] {
        out.append((try sim.session.keep(id, now: KeepTests.now), sim.session.body(id)!.identity.key.hex))
    }
    sim.camera = Fixture.level
    sim.flick(peroxide)
    sim.run(0.6)
    let piece = try #require(sim.breaks.first?.1.first)
    out.append((try sim.session.keep(piece, now: KeepTests.now), sim.session.body(piece)!.identity.key.hex))
    return out
}

@Suite("the trophy case")
struct CollectionTests {
    @Test func everythingWorksSignedOutWithoutTheNetwork() async throws {
        let cloud = FakeFirebase()
        let offline = NoNetwork()
        let device = await CaseDevice(cloud, transport: offline)
        let kept = try keptTrophies()
        for (record, _) in kept { try await device.trophies.keep(record) }
        #expect(try await device.trophies.trophies().count == 3)
        let renamed = try await device.trophies.rename(kept[0].record.id, to: "  My  caffeine ", at: KeepTests.now.addingTimeInterval(9))
        #expect(renamed?.name == "My caffeine")
        try await device.trophies.delete(kept[1].record.id, at: KeepTests.now.addingTimeInterval(10))
        #expect(try await device.trophies.trophies().map(\.id) == [kept[2].record.id, kept[0].record.id].sorted { $0.uuidString > $1.uuidString })
        #expect(await device.trophies.status() == .signedOut)
        #expect(try await device.trophies.syncNow() == nil)
        #expect(await offline.requests == 0)
        // A build without the configuration hides the account and still keeps everything.
        let local = await CaseDevice(cloud, transport: offline, configured: false)
        try await local.trophies.keep(kept[0].record)
        #expect(await local.trophies.status() == .unavailable)
        await #expect(throws: AccountError.unavailable) { try await local.trophies.signIn(appleSignIn()) }
        #expect(await offline.requests == 0)
    }

    @Test func theCollectionSurvivesARestart() async throws {
        let cloud = FakeFirebase()
        let device = await CaseDevice(cloud)
        let kept = try keptTrophies()
        for (record, _) in kept { try await device.trophies.keep(record) }
        let again = await CaseDevice(cloud, folder: device.folder)
        let read = try await again.trophies.trophies()
        #expect(Set(read) == Set(kept.map(\.record)))
        try? FileManager.default.removeItem(at: device.folder)
    }

    /// M1's exit: sign in on the iPad and the collection is there, each trophy the same piece.
    @Test func signInOnTheIPadAndTheCollectionIsThere() async throws {
        let cloud = FakeFirebase()
        let phone = await CaseDevice(cloud)
        let kept = try keptTrophies()
        for (record, _) in kept { try await phone.trophies.keep(record) }
        let report = try await phone.trophies.signIn(appleSignIn())
        #expect(report.adopted == 3 && report.pushed == 3)

        let pad = await CaseDevice(cloud)
        try await pad.trophies.signIn(appleSignIn())
        let synced = try await pad.trophies.trophies()
        #expect(synced.count == 3)
        for (record, key) in kept {
            let there = try #require(synced.first { $0.id == record.id })
            // Firestore carries dates as timestamps; to the millisecond the contract keeps, equal.
            #expect(try LupiJSON.encoder().encode(there) == LupiJSON.encoder().encode(record))
            let piece = try Restore.piece(there, catalog: Fixture.catalog, store: GameStore())
            #expect(piece.identity.key.hex == key)
        }
        // A rename on the iPad reaches the phone.
        pad.clock.advance(30)
        try await pad.trophies.rename(kept[1].record.id, to: "The billion", at: pad.clock.now)
        try await pad.trophies.syncNow()
        phone.clock.advance(60)
        try await phone.trophies.syncNow()
        #expect(try await phone.trophies.trophy(kept[1].record.id)?.name == "The billion")
    }

    @Test func deletingTheAccountRunsInTheOrderAppleAndFirebaseRequire() async throws {
        let cloud = FakeFirebase()
        let phone = await CaseDevice(cloud)
        try await phone.trophies.signIn(appleSignIn())
        let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
        for (record, _) in try keptTrophies() { try await phone.trophies.keep(record) }
        try await phone.trophies.syncNow()
        #expect(await cloud.documents(in: "users/\(uid)/trophies").count == 3)
        await cloud.advance(3600 * 24)
        phone.clock.advance(3600 * 24)
        await cloud.clearCalls()

        try await phone.trophies.deleteAccount(reauthentication: appleSignIn(code: "fresh-code"))
        #expect(
            await cloud.callKinds
                == ["auth.signInWithIdp", "firestore.list", "firestore.commit", "firestore.list", "auth.revokeToken", "auth.delete"]
        )
        #expect(await cloud.revokedAppleCodes == ["fresh-code"])
        #expect(await cloud.documents(in: "users/\(uid)/trophies").isEmpty)
        #expect(await !cloud.userExists(uid))
        #expect(await phone.trophies.status() == .signedOut)
        #expect(try await phone.trophies.trophies().isEmpty)
    }

    @Test func deletionNeedsTheAuthorizationCode() async throws {
        let cloud = FakeFirebase()
        let phone = await CaseDevice(cloud)
        try await phone.trophies.signIn(appleSignIn())
        await #expect(throws: SyncError.missingAuthorizationCode) {
            try await phone.trophies.deleteAccount(reauthentication: appleSignIn())
        }
        #expect(await phone.trophies.status() != .signedOut)
    }

    @Test func placementsOfAnotherAccountsTrophiesAreNotMissing() async throws {
        let cloud = FakeFirebase()
        let phone = await CaseDevice(cloud)
        try await phone.trophies.signIn(appleSignIn(sub: "owner"))
        let kept = try keptTrophies()[0].record
        try await phone.trophies.keep(kept)
        try await phone.trophies.signOut()
        try await phone.trophies.signIn(appleSignIn(sub: "guest"))
        #expect(try await phone.trophies.trophies().isEmpty)
        #expect(try await phone.trophies.knownTrophyIDs() == [kept.id])
        try await phone.trophies.delete(kept.id, at: KeepTests.now)
        #expect(try await phone.trophies.knownTrophyIDs() == [kept.id], "another account's trophy is not this one's to delete")
    }

    @Test func erasingTheDeviceLeavesTheAccountAlone() async throws {
        let cloud = FakeFirebase()
        let phone = await CaseDevice(cloud)
        try await phone.trophies.signIn(appleSignIn())
        for (record, _) in try keptTrophies() { try await phone.trophies.keep(record) }
        try await phone.trophies.syncNow()
        try await phone.trophies.eraseDevice()
        #expect(try await phone.trophies.trophies().isEmpty)
        try await phone.trophies.syncNow(full: true)
        #expect(try await phone.trophies.trophies().count == 3)
    }

    @Test func aRecordThatBreaksTheContractIsNotQueued() async throws {
        let cloud = FakeFirebase()
        let phone = await CaseDevice(cloud)
        var bad = try keptTrophies()[0].record
        bad.molecule.sha256 = "nope"
        await #expect(throws: KeepError.self) { try await phone.trophies.keep(bad) }
        #expect(try await phone.trophies.sync.outbox().isEmpty)
    }

    @Test func configurationComesFromTheBuildOrNotAtAll() {
        #expect(AccountConfiguration(apiKey: "AIzaSyExample", projectID: "shed-489901") != nil)
        #expect(AccountConfiguration(apiKey: "", projectID: "shed-489901") == nil)
        #expect(AccountConfiguration(apiKey: "$(LUPI_FIREBASE_API_KEY)", projectID: "shed-489901") == nil)
        #expect(AccountConfiguration(apiKey: "AIza key", projectID: "shed-489901") == nil)
        #expect(AccountConfiguration(apiKey: "AIzaSyExample", projectID: nil) == nil)
        #expect(AccountConfiguration(apiKey: " AIzaSyExample\n", projectID: "shed-489901")?.apiKey == "AIzaSyExample")
    }

    @Test func syncsReReadEverythingOnceADay() {
        let t0 = Date(timeIntervalSince1970: 1_791_000_000)
        var policy = SyncPolicy()
        #expect(policy.opening(at: t0), "the first sync ever is full")
        policy.completed(full: true, at: t0)
        #expect(!policy.opening(at: t0.addingTimeInterval(3600)))
        policy.completed(full: false, at: t0.addingTimeInterval(3600))
        #expect(policy.lastFull == t0)
        #expect(policy.opening(at: t0.addingTimeInterval(24 * 3600)))
        #expect(policy.opening(at: t0.addingTimeInterval(-60)), "a clock set back re-reads too")
    }
}
