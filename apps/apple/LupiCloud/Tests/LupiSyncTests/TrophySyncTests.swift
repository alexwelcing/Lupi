import Foundation
import LupiCloudTesting
import Testing

@testable import LupiSync

/// One phone or tablet: its own clock, Keychain, local store and engine,
/// talking to the shared fake Firebase.
struct Device {
  let clock: TestClock
  let sessions: SessionManager
  let store: InMemorySyncStateStore<TestTrophy>
  let sync: TrophySync<TestTrophy>

  init(
    _ cloud: FakeFirebase,
    clock: TestClock? = nil,
    store: InMemorySyncStateStore<TestTrophy> = InMemorySyncStateStore(),
    configuration: TrophySyncConfiguration = TrophySyncConfiguration()
  ) async {
    let resolved: TestClock
    if let clock { resolved = clock } else { resolved = TestClock(await cloud.now) }
    let clock = resolved
    self.clock = clock
    self.store = store
    let auth = AuthClient(configuration: AuthConfiguration(apiKey: "test-api-key"), transport: cloud)
    sessions = SessionManager(client: auth, store: InMemoryTokenStore(), now: clock.function)
    let firestore = FirestoreClient(
      configuration: FirestoreConfiguration(projectID: "demo-lupi"),
      transport: cloud,
      tokens: sessions
    )
    sync = TrophySync(session: sessions, firestore: firestore, store: store, configuration: configuration, now: clock.function)
  }

  func names() async throws -> [String: String] {
    Dictionary(uniqueKeysWithValues: try await sync.trophies().map { ($0.id, $0.name) })
  }
}

/// What the app gets back from Sign in with Apple, for the owner's Apple ID.
func appleCredential(sub: String = "apple-owner", code: String? = nil) -> AppleCredential {
  let nonce = AppleNonce()
  return AppleCredential(
    idToken: FakeAppleIDToken.make(sub: sub, nonceHash: nonce.hashed),
    rawNonce: nonce.raw,
    authorizationCode: code
  )
}

@Suite("Trophy sync")
struct TrophySyncTests {
  @Test("offline create, then sync: the envelope lands as the rules expect")
  func offlineCreate() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))

    await cloud.setOffline(true)
    try await phone.sync.save(.make("t1"))
    #expect(try await phone.names() == ["t1": "Caffeine"])
    await #expect(throws: FirestoreError.transport("offline")) { try await phone.sync.sync() }
    #expect(try await phone.sync.outbox() == [OutboxEntry(id: "t1", kind: .upsert)])

    await cloud.setOffline(false)
    let report = try await phone.sync.sync()
    #expect(report.pushed == 1)
    #expect(try await phone.sync.outbox().isEmpty)

    let document = try #require(await cloud.document("users/\(uid)/trophies/t1"))
    #expect(Set(document.fields.keys) == ["schema", "id", "payload", "deleted", "updatedAt", "clientUpdatedAt"])
    #expect(document.fields["schema"] == .string("lupi.trophy.v1"))
    #expect(document.fields["id"] == .string("t1"))
    #expect(document.fields["deleted"] == .boolean(false))
    // REQUEST_TIME is the request's arrival; the commit (updateTime) is later.
    let updatedAt = try #require(document.fields["updatedAt"]?.timestampValue)
    #expect(updatedAt <= document.updateTime!)
    #expect(document.fields["payload"]?.mapFields?["name"] == .string("Caffeine"))
    let state = try await phone.sync.snapshot()
    #expect(state.records["t1"]?.remote?.updateTime == document.updateTime)
  }

  @Test("two devices converge")
  func twoDevicesConverge() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    let pad = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    try await pad.sync.signIn(with: appleCredential())

    try await phone.sync.save(.make("t1"))
    try await phone.sync.save(.make("t2", name: "Water"))
    try await phone.sync.sync()
    let padReport = try await pad.sync.sync()
    #expect(padReport.pulled == 2)
    #expect(try await pad.names() == ["t1": "Caffeine", "t2": "Water"])

    pad.clock.advance(5)
    try await pad.sync.save(.make("t1", name: "Theine"))
    try await pad.sync.sync()
    try await phone.sync.sync()
    #expect(try await phone.names() == ["t1": "Theine", "t2": "Water"])
    let padNames = try await pad.names()
    #expect(try await phone.names() == padNames)
    #expect(try await phone.sync.outbox().isEmpty)
    #expect(try await pad.sync.outbox().isEmpty)
  }

  @Test("a deletion reaches the other device through a tombstone")
  func tombstonePropagates() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    let pad = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    try await pad.sync.signIn(with: appleCredential())
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    try await phone.sync.save(.make("t1"))
    try await phone.sync.save(.make("t2", name: "Water"))
    try await phone.sync.sync()
    try await pad.sync.sync()

    phone.clock.advance(5)
    try await phone.sync.delete(id: "t1")
    #expect(try await phone.sync.outbox() == [OutboxEntry(id: "t1", kind: .tombstone)])
    try await phone.sync.sync()
    let tombstone = try #require(await cloud.document("users/\(uid)/trophies/t1"))
    #expect(tombstone.fields["deleted"] == .boolean(true))
    #expect(tombstone.fields["payload"] == .map([:]))
    #expect(try await phone.sync.snapshot().records["t1"] == nil)

    try await pad.sync.sync()
    #expect(try await pad.names() == ["t2": "Water"])
  }

  @Test("conflicting edits: the later clientUpdatedAt wins whatever the sync order")
  func lastWriterWins() async throws {
    for newerSyncsFirst in [true, false] {
      let cloud = FakeFirebase()
      let phone = await Device(cloud)
      let pad = await Device(cloud)
      try await phone.sync.signIn(with: appleCredential())
      try await pad.sync.signIn(with: appleCredential())
      try await phone.sync.save(.make("t1"))
      try await phone.sync.sync()
      try await pad.sync.sync()

      // Both edit offline: the phone at +10 s, the pad later at +20 s.
      phone.clock.advance(10)
      try await phone.sync.save(.make("t1", name: "Phone edit"))
      pad.clock.advance(20)
      try await pad.sync.save(.make("t1", name: "Pad edit"))

      if newerSyncsFirst {
        try await pad.sync.sync()
        let report = try await phone.sync.sync()
        #expect(report.remoteWins == 1 && report.pushed == 0)
      } else {
        try await phone.sync.sync()
        let report = try await pad.sync.sync()
        #expect(report.localWins == 1 && report.pushed == 1)
        try await phone.sync.sync()
      }
      try await pad.sync.sync()
      #expect(try await phone.names() == ["t1": "Pad edit"], "newer first: \(newerSyncsFirst)")
      #expect(try await pad.names() == ["t1": "Pad edit"], "newer first: \(newerSyncsFirst)")
    }
  }

  @Test("versions that share one REQUEST_TIME millisecond are still told apart")
  func sharedRequestTime() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    let pad = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    try await pad.sync.signIn(with: appleCredential())
    await cloud.freezeRequestTime()
    try await phone.sync.save(.make("t1"))
    try await phone.sync.sync()
    try await pad.sync.sync()
    pad.clock.advance(1)
    try await pad.sync.save(.make("t1", name: "Same millisecond"))
    try await pad.sync.sync()
    let phoneReport = try await phone.sync.sync()
    #expect(phoneReport.pulled == 1)
    #expect(try await phone.names() == ["t1": "Same millisecond"])
    // A full re-pull changes nothing once converged.
    #expect(try await phone.sync.sync(full: true).pulled == 0)
  }

  @Test("edit against delete: the later action wins, either way round")
  func editVersusDelete() async throws {
    for deleteIsLater in [false, true] {
      let cloud = FakeFirebase()
      let phone = await Device(cloud)
      let pad = await Device(cloud)
      try await phone.sync.signIn(with: appleCredential())
      try await pad.sync.signIn(with: appleCredential())
      try await phone.sync.save(.make("t1"))
      try await phone.sync.sync()
      try await pad.sync.sync()

      phone.clock.advance(deleteIsLater ? 20 : 10)
      try await phone.sync.delete(id: "t1")
      pad.clock.advance(deleteIsLater ? 10 : 20)
      try await pad.sync.save(.make("t1", name: "Kept"))

      try await phone.sync.sync()
      try await pad.sync.sync()
      try await phone.sync.sync()
      let expected: [String: String] = deleteIsLater ? [:] : ["t1": "Kept"]
      #expect(try await phone.names() == expected, "delete later: \(deleteIsLater)")
      #expect(try await pad.names() == expected, "delete later: \(deleteIsLater)")
    }
  }

  @Test("a write that loses its precondition re-reads, settles and retries")
  func preconditionRace() async throws {
    for remoteIsNewer in [true, false] {
      let cloud = FakeFirebase()
      let phone = await Device(cloud)
      try await phone.sync.signIn(with: appleCredential())
      let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
      try await phone.sync.save(.make("t1"))
      try await phone.sync.sync()

      phone.clock.advance(10)
      try await phone.sync.save(.make("t1", name: "Phone"))
      // Between the phone's pull and its commit, another device writes.
      let sneakyStamp = FirestoreTimestamp(date: phone.clock.now.addingTimeInterval(remoteIsNewer ? 5 : -5))
      let sneakyPayload = try FirestoreEncoder().encodeFields(TestTrophy.make("t1", name: "Elsewhere"))
      await cloud.onceBeforeCommit {
        await cloud.serverWrite("users/\(uid)/trophies/t1", fields: [
          "schema": .string("lupi.trophy.v1"), "id": .string("t1"), "deleted": .boolean(false),
          "payload": .map(sneakyPayload), "clientUpdatedAt": .timestamp(sneakyStamp),
        ])
      }
      await cloud.clearCalls()
      let report = try await phone.sync.sync()
      let kinds = await cloud.callKinds
      #expect(kinds.filter { $0 == "firestore.get" }.count == 1)
      // pull, the commit that loses, the re-read, and (if ours still wins) one more commit.
      #expect(kinds.filter { $0 == "firestore.commit" }.count == (remoteIsNewer ? 1 : 2))
      if remoteIsNewer {
        #expect(report.remoteWins == 1)
        #expect(try await phone.names() == ["t1": "Elsewhere"])
      } else {
        #expect(report.localWins == 1 && report.pushed == 1)
        #expect(await cloud.document("users/\(uid)/trophies/t1")?.fields["payload"]?.mapFields?["name"] == .string("Phone"))
      }
      #expect(try await phone.sync.outbox().isEmpty)
    }
  }

  @Test("first sign-in adopts trophies made signed out, alongside the account's own")
  func signInAdoption() async throws {
    let cloud = FakeFirebase()
    let pad = await Device(cloud)
    try await pad.sync.signIn(with: appleCredential())
    try await pad.sync.save(.make("t9", name: "From the iPad"))
    try await pad.sync.sync()

    let phone = await Device(cloud)
    try await phone.sync.save(.make("s1", name: "Made signed out"))
    try await phone.sync.save(.make("s2", name: "Thrown away"))
    try await phone.sync.delete(id: "s2")
    #expect(try await phone.names() == ["s1": "Made signed out"])
    #expect(try await phone.sync.outbox().map(\.id) == ["s1"])

    let report = try await phone.sync.signIn(with: appleCredential())
    #expect(report.adopted == 1)
    #expect(report.pushed == 1)
    #expect(report.pulled == 1)
    #expect(try await phone.names() == ["s1": "Made signed out", "t9": "From the iPad"])
    try await pad.sync.sync()
    #expect(try await pad.names() == ["s1": "Made signed out", "t9": "From the iPad"])
  }

  @Test("sign-out keeps local copies; changes queue until the next sign-in")
  func signOutKeepsCopies() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    try await phone.sync.save(.make("t1"))
    try await phone.sync.signOut()
    #expect(try await phone.sessions.currentSession() == nil)
    #expect(try await phone.names() == ["t1": "Caffeine"])
    await #expect(throws: SyncError.notSignedIn) { try await phone.sync.sync() }

    try await phone.sync.save(.make("t2", name: "Offline"))
    #expect(try await phone.sync.outbox().map(\.id) == ["t2"])
    let report = try await phone.sync.signIn(with: appleCredential())
    #expect(report.adopted == 1 && report.pushed == 1)
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    #expect(await cloud.documents(in: "users/\(uid)/trophies").map(\.documentID) == ["t1", "t2"])
  }

  @Test("another account on the same device sees none of the first one's trophies")
  func secondAccount() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential(sub: "owner"))
    try await phone.sync.save(.make("t1"))
    try await phone.sync.signOut()

    try await phone.sync.signIn(with: appleCredential(sub: "guest"))
    #expect(try await phone.names().isEmpty)
    try await phone.sync.save(.make("g1", name: "Guest's"))
    try await phone.sync.sync()
    let guest = try #require(await cloud.uid(forAppleSub: "guest"))
    #expect(await cloud.documents(in: "users/\(guest)/trophies").map(\.documentID) == ["g1"])
    try await phone.sync.signOut()

    try await phone.sync.signIn(with: appleCredential(sub: "owner"))
    #expect(try await phone.names() == ["t1": "Caffeine"])
  }

  @Test("account deletion: re-auth, trophies, Apple revocation, user, local, in that order")
  func accountDeletion() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    try await phone.sync.save(.make("t1"))
    try await phone.sync.save(.make("t2"))
    try await phone.sync.sync()
    phone.clock.advance(1)
    try await phone.sync.delete(id: "t2")
    try await phone.sync.sync()
    #expect(await cloud.documents(in: "users/\(uid)/trophies").count == 2)

    // Long enough that Firebase wants a fresh sign-in before deleting.
    await cloud.advance(3600 * 24)
    phone.clock.advance(3600 * 24)
    await cloud.clearCalls()
    try await phone.sync.deleteAccount(reauthentication: appleCredential(code: "apple-auth-code"))

    #expect(
      await cloud.callKinds
        == ["auth.signInWithIdp", "firestore.list", "firestore.commit", "firestore.list", "auth.revokeToken", "auth.delete"]
    )
    #expect(await cloud.revokedAppleCodes == ["apple-auth-code"])
    #expect(await cloud.documents(in: "users/\(uid)/trophies").isEmpty)
    #expect(await !cloud.userExists(uid))
    #expect(try await phone.sessions.currentSession() == nil)
    let state = try await phone.sync.snapshot()
    #expect(state.records.isEmpty && state.outbox.isEmpty && state.cursors.isEmpty)
    #expect(state.activeOwner == nil && state.deletingAccount == nil)
    #expect(try await phone.names().isEmpty)
  }

  @Test("deleting an account with unsynced edits forgets them too")
  func deletionWithPendingEdits() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    try await phone.sync.save(.make("t1"))
    try await phone.sync.sync()
    try await phone.sync.save(.make("t2"))
    try await phone.sync.save(.make("t1", name: "Theine"))
    #expect(try await phone.sync.outbox().count == 2)

    try await phone.sync.deleteAccount(reauthentication: appleCredential(code: "c"))
    let state = try await phone.sync.snapshot()
    #expect(state.records.isEmpty && state.outbox.isEmpty)
  }

  @Test("an interrupted deletion keeps sync off until a retry finishes it")
  func interruptedDeletion() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    try await phone.sync.save(.make("t1"))
    try await phone.sync.sync()

    await cloud.failNext("auth.revokeToken", with: .googleError(503, message: "Service Unavailable", rpcStatus: "UNAVAILABLE"))
    await #expect(throws: AuthError.self) {
      try await phone.sync.deleteAccount(reauthentication: appleCredential(code: "first"))
    }
    #expect(try await phone.sync.snapshot().deletingAccount == uid)
    #expect(await cloud.documents(in: "users/\(uid)/trophies").isEmpty)
    // Local copies still pending must not be pushed back up.
    await #expect(throws: SyncError.accountDeletionInProgress) { try await phone.sync.sync() }
    #expect(await cloud.documents(in: "users/\(uid)/trophies").isEmpty)

    try await phone.sync.deleteAccount(reauthentication: appleCredential(code: "second"))
    #expect(await cloud.revokedAppleCodes == ["second"])
    #expect(await !cloud.userExists(uid))
    #expect(try await phone.sync.snapshot().deletingAccount == nil)
  }

  @Test("a sync started while deletion re-authenticates refuses to run")
  func syncDuringDeletion() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    try await phone.sync.save(.make("t1"))
    try await phone.sync.sync()
    try await phone.sync.save(.make("t2"))

    // The app's "sync after edits" fires while Apple's sign-in is in flight.
    let engine = phone.sync
    let racing = Slot<Result<SyncReport, any Error>>()
    await cloud.onceBefore("auth.signInWithIdp") {
      do {
        await racing.set(.success(try await engine.sync()))
      } catch {
        await racing.set(.failure(error))
      }
    }
    await cloud.clearCalls()
    try await phone.sync.deleteAccount(reauthentication: appleCredential(code: "c"))

    let outcome = try #require(await racing.value)
    #expect(throws: SyncError.accountDeletionInProgress) { try outcome.get() }
    #expect(
      await cloud.callKinds
        == ["auth.signInWithIdp", "firestore.list", "firestore.commit", "firestore.list", "auth.revokeToken", "auth.delete"]
    )
    #expect(await cloud.documents(in: "users/\(uid)/trophies").isEmpty)
    #expect(try await phone.sync.snapshot().records.isEmpty)
    await #expect(throws: SyncError.notSignedIn) { try await phone.sync.sync() }
  }

  @Test("signing in as another account runs its own sync, not the previous account's")
  func signInDoesNotJoinPreviousSync() async throws {
    let cloud = FakeFirebase()
    let pad = await Device(cloud)
    try await pad.sync.signIn(with: appleCredential(sub: "owner-b"))
    try await pad.sync.save(.make("b1", name: "Water"))
    try await pad.sync.sync()

    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential(sub: "owner-a"))
    let uidA = try #require(await cloud.uid(forAppleSub: "owner-a"))
    try await phone.sync.save(.make("a1"))

    // A's push is held at its commit while the device switches to B.
    let engine = phone.sync
    let sessions = phone.sessions
    let switched = Slot<Task<SyncReport, any Error>>()
    await cloud.onceBeforeCommit {
      let signIn = Task {
        try await engine.signOut(flush: false)
        return try await engine.signIn(with: appleCredential(sub: "owner-b"))
      }
      await switched.set(signIn)
      while true {
        let current = await sessions.currentUID()
        if current != nil && current != uidA { break }
        try? await Task.sleep(nanoseconds: 2_000_000)
      }
      // Let signIn reach sync() while A's run is still in flight.
      try? await Task.sleep(nanoseconds: 20_000_000)
    }
    let reportA = try await phone.sync.sync()
    #expect(reportA.pushed == 1)

    let reportB = try await #require(await switched.value).value
    #expect(reportB.pulled == 1)
    #expect(reportB.pushed == 0)
    #expect(try await phone.names() == ["b1": "Water"])
    #expect(try await phone.sync.snapshot().activeOwner == cloud.uid(forAppleSub: "owner-b"))
  }

  @Test("deletion refuses a different Apple ID and a missing authorization code")
  func deletionGuards() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    await #expect(throws: SyncError.missingAuthorizationCode) {
      try await phone.sync.deleteAccount(reauthentication: appleCredential())
    }
    await #expect(throws: SyncError.reauthenticatedAsDifferentAccount) {
      try await phone.sync.deleteAccount(reauthentication: appleCredential(sub: "someone-else", code: "c"))
    }
    #expect(await cloud.uid(forAppleSub: "someone-else") == nil, "the stray account is removed again")
    let owner = await cloud.uid(forAppleSub: "apple-owner")
    #expect(await phone.sessions.currentUID() == owner)
  }

  @Test("an account deleted on another device is wiped here at the next refresh")
  func deletedElsewhere() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    let pad = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    try await pad.sync.signIn(with: appleCredential())
    try await phone.sync.save(.make("t1"))
    try await phone.sync.sync()
    try await pad.sync.sync()
    try await pad.sync.deleteAccount(reauthentication: appleCredential(code: "c"))

    await cloud.advance(3700)
    phone.clock.advance(3700)
    await #expect(throws: AuthError.userNotFound) { try await phone.sync.sync() }
    #expect(try await phone.names().isEmpty)
    #expect(try await phone.sessions.currentSession() == nil)
    #expect(try await phone.sync.snapshot().records.isEmpty)
  }

  @Test("local validation: id, size and width")
  func validation() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    await #expect(throws: SyncError.invalidID("bad id/")) { try await phone.sync.save(.make("bad id/")) }
    var huge = TestTrophy.make("big")
    huge.molecule.xyz = String(repeating: "C 0.000 0.000 0.000\n", count: 14_000)
    await #expect(throws: SyncError.self) { try await phone.sync.save(huge) }
    do {
      try await phone.sync.save(huge)
    } catch SyncError.payloadTooLarge(let id, let bytes, let limit) {
      #expect(id == "big" && bytes > limit && limit == 256 * 1024)
    }
    let narrow = await Device(cloud, configuration: TrophySyncConfiguration(maxPayloadKeys: 5))
    await #expect(throws: SyncError.payloadTooWide(id: "w", keys: 6, limit: 5)) {
      try await narrow.sync.save(.make("w"))
    }
    #expect(try await phone.sync.trophies().isEmpty)
  }

  @Test("a record the server refuses stays queued while the rest go through")
  func rejection() async throws {
    let cloud = FakeFirebase()
    let store = InMemorySyncStateStore<FlatPayload>()
    let clock = TestClock(await cloud.now)
    let auth = AuthClient(configuration: AuthConfiguration(apiKey: "test-api-key"), transport: cloud)
    let sessions = SessionManager(client: auth, store: InMemoryTokenStore(), now: clock.function)
    let firestore = FirestoreClient(configuration: FirestoreConfiguration(projectID: "demo-lupi"), transport: cloud, tokens: sessions)
    // The client allows more keys than the rules do, so the server refuses.
    let sync = TrophySync(
      session: sessions, firestore: firestore, store: store,
      configuration: TrophySyncConfiguration(maxPayloadKeys: 64), now: clock.function
    )
    try await sync.signIn(with: appleCredential())
    try await sync.save(FlatPayload(id: "ok", count: 3))
    try await sync.save(FlatPayload(id: "wide", count: 40))
    let report = try await sync.sync()
    #expect(report.pushed == 1)
    #expect(report.rejected == ["wide": "PERMISSION_DENIED"])
    #expect(try await sync.outbox().map(\.id) == ["wide"])
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    #expect(await cloud.documents(in: "users/\(uid)/trophies").map(\.documentID) == ["ok"])
  }

  @Test("paging never skips documents that share one commit's timestamp")
  func pagingSharedTimestamps() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    for index in 1...5 { try await phone.sync.save(.make("t\(index)")) }
    try await phone.sync.sync()
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    let stamps = Set(await cloud.documents(in: "users/\(uid)/trophies").compactMap { $0.fields["updatedAt"] })
    #expect(stamps.count == 1, "one commit stamps all its writes alike")

    let pad = await Device(cloud, configuration: TrophySyncConfiguration(pageSize: 2))
    try await pad.sync.signIn(with: appleCredential())
    #expect(try await pad.sync.trophies().map(\.id).sorted() == ["t1", "t2", "t3", "t4", "t5"])
    #expect(await cloud.callKinds.filter { $0 == "firestore.runQuery" }.count >= 3)
  }

  @Test("a clock two days fast is pulled back to server time")
  func clockClamp() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    phone.clock.advance(2 * 86_400)
    try await phone.sync.save(.make("t1"))
    let report = try await phone.sync.sync()
    #expect(report.pushed == 1 && report.rejected.isEmpty)
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    let stamp = try #require(await cloud.document("users/\(uid)/trophies/t1")?.fields["clientUpdatedAt"]?.timestampValue)
    let serverNow = await cloud.now
    #expect(abs(stamp.date.timeIntervalSince(serverNow)) < 60)
  }

  @Test("an edit made while its previous version is in flight stays queued")
  func editDuringPush() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    try await phone.sync.save(.make("t1"))
    let sync = phone.sync
    let clock = phone.clock
    await cloud.onceBeforeCommit {
      clock.advance(1)
      try? await sync.save(.make("t1", name: "Second thoughts"))
    }
    try await phone.sync.sync()
    #expect(await cloud.document("users/\(uid)/trophies/t1")?.fields["payload"]?.mapFields?["name"] == .string("Caffeine"))
    #expect(try await phone.sync.outbox().map(\.id) == ["t1"])
    try await phone.sync.sync()
    #expect(await cloud.document("users/\(uid)/trophies/t1")?.fields["payload"]?.mapFields?["name"] == .string("Second thoughts"))
    #expect(try await phone.sync.outbox().isEmpty)
  }

  @Test("concurrent sync calls share one run")
  func singleFlightSync() async throws {
    let cloud = FakeFirebase()
    let phone = await Device(cloud)
    try await phone.sync.signIn(with: appleCredential())
    try await phone.sync.save(.make("t1"))
    await cloud.clearCalls()
    let sync = phone.sync
    let reports = try await withThrowingTaskGroup(of: SyncReport.self) { group in
      for _ in 0..<5 { group.addTask { try await sync.sync() } }
      return try await group.reduce(into: [SyncReport]()) { $0.append($1) }
    }
    #expect(reports.count == 5)
    #expect(await cloud.callKinds.filter { $0 == "firestore.commit" }.count == 1)
  }

  @Test("the JSON file store survives a restart, written atomically")
  func fileStore() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("lupi-sync-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("trophies.json")
    let cloud = FakeFirebase()
    let clock = TestClock(await cloud.now)
    func engine() -> TrophySync<TestTrophy> {
      let auth = AuthClient(configuration: AuthConfiguration(apiKey: "test-api-key"), transport: cloud)
      let sessions = SessionManager(client: auth, store: InMemoryTokenStore(), now: clock.function)
      let firestore = FirestoreClient(configuration: FirestoreConfiguration(projectID: "demo-lupi"), transport: cloud, tokens: sessions)
      return TrophySync(session: sessions, firestore: firestore, store: JSONFileSyncStateStore<TestTrophy>(url: url), now: clock.function)
    }
    let first = engine()
    try await first.save(.make("t1"))
    try await first.save(.make("t2", name: "Water"))
    try await first.delete(id: "t2")
    try await first.save(.make("t3", name: "Salt"))

    let second = engine()
    let before = try await first.trophies()
    #expect(try await second.trophies() == before)
    #expect(try await second.outbox().map(\.id) == ["t1", "t3"])
    let state = try JSONDecoder().decode(SyncState<TestTrophy>.self, from: Data(contentsOf: url))
    #expect(state.format == "lupi.sync-state.v1")
    #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path) == ["trophies.json"])
  }
}

/// A payload whose keys sit at the top level, to exceed the rules' 32-key cap.
struct FlatPayload: SyncPayload, Identifiable {
  var id: String
  var count: Int

  struct Key: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(_ string: String) { stringValue = string }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }

  init(id: String, count: Int) {
    self.id = id
    self.count = count
  }

  func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Key.self)
    try container.encode(id, forKey: Key("id"))
    for index in 0..<count { try container.encode(index, forKey: Key("k\(index)")) }
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Key.self)
    id = try container.decode(String.self, forKey: Key("id"))
    count = container.allKeys.count - 1
  }
}

/// A value handed out of a hook.
actor Slot<Value: Sendable> {
  private(set) var value: Value?
  func set(_ value: Value) { self.value = value }
}
