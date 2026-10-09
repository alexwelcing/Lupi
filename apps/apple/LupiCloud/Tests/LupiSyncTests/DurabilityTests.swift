import Foundation
import LupiCloudTesting
import Testing

@testable import LupiSync

private enum DiskFailure: Error, Equatable { case refused }

/// The real in-memory store behind deterministic disk failures and a single
/// suspended write. Tests observe entry/release through continuations.
private actor ControlledStateStore: SyncStateStore {
  typealias Payload = TestTrophy
  private let backing = InMemorySyncStateStore<TestTrophy>()
  private var plans: [(fail: Bool, pause: Bool)] = []
  private var waiting: [(Int, CheckedContinuation<Void, Never>)] = []
  private var release: CheckedContinuation<Void, Never>?
  private(set) var writes = 0

  func plan(fail: Bool = false, pause: Bool = false) { plans.append((fail, pause)) }
  func load() async throws -> SyncState<TestTrophy>? { try await backing.load() }

  func save(_ state: SyncState<TestTrophy>) async throws {
    let plan = plans.isEmpty ? (fail: false, pause: false) : plans.removeFirst()
    writes += 1
    if plan.pause {
      await withCheckedContinuation { continuation in
        release = continuation
        signalEntry()
      }
    } else {
      signalEntry()
    }
    if plan.fail { throw DiskFailure.refused }
    try await backing.save(state)
  }

  func entered(_ count: Int) async {
    if writes >= count { return }
    await withCheckedContinuation { waiting.append((count, $0)) }
  }

  func resume() { release?.resume(); release = nil }

  private func signalEntry() {
    let ready = waiting.filter { $0.0 <= writes }
    waiting.removeAll { $0.0 <= writes }
    for (_, continuation) in ready { continuation.resume() }
  }
}

private func durabilityEngine(
  _ cloud: FakeFirebase, store: any SyncStateStore<TestTrophy>
) async -> TrophySync<TestTrophy> {
  let clock = TestClock(await cloud.now)
  let sessions = SessionManager(
    client: AuthClient(configuration: AuthConfiguration(apiKey: "test-api-key"), transport: cloud),
    store: InMemoryTokenStore(), now: clock.function
  )
  let firestore = FirestoreClient(configuration: FirestoreConfiguration(projectID: "demo-lupi"), transport: cloud, tokens: sessions)
  return TrophySync(session: sessions, firestore: firestore, store: store, now: clock.function)
}

@Suite("Committed local sync state")
struct DurabilityTests {
  @Test("failed first save stays absent and the same conditional edit can be retried")
  func firstSaveRetry() async throws {
    let store = ControlledStateStore()
    let sync = await durabilityEngine(FakeFirebase(), store: store)
    let condition = try await sync.saveCondition(for: "t1")
    #expect(!condition.recordExists)
    await store.plan(fail: true)
    await #expect(throws: DiskFailure.refused) { try await sync.save(.make("t1"), ifUnchanged: condition) }
    #expect(try await sync.trophies().isEmpty)
    #expect(try await sync.outbox().isEmpty)
    #expect(try await sync.snapshot().records.isEmpty)
    #expect(try await store.load() == nil)

    try await sync.save(.make("t1"), ifUnchanged: condition)
    #expect(try await sync.trophies().map(\.id) == ["t1"])
    #expect(try await sync.outbox() == [OutboxEntry(id: "t1", kind: .upsert)])
    #expect(try await store.load()?.records["t1"]?.revision == 1)
    await #expect(throws: SyncError.localRecordChanged(id: "t1")) {
      try await sync.save(.make("t1"), ifUnchanged: condition)
    }
  }

  @Test("failed overwrite, delete and erase preserve the previous durable record")
  func failedMutations() async throws {
    let store = ControlledStateStore()
    let sync = await durabilityEngine(FakeFirebase(), store: store)
    try await sync.save(.make("t1"))
    let condition = try await sync.saveCondition(for: "t1")
    #expect(condition.recordExists)
    for operation in 0..<3 {
      await store.plan(fail: true)
      await #expect(throws: DiskFailure.refused) {
        switch operation {
        case 0: try await sync.save(.make("t1", name: "Changed"), ifUnchanged: condition)
        case 1: try await sync.delete(id: "t1")
        default: try await sync.eraseLocal()
        }
      }
      #expect(try await sync.trophy(id: "t1")?.name == "Caffeine")
      #expect(try await sync.snapshot().records["t1"]?.revision == 1)
      #expect(try await sync.outbox() == [OutboxEntry(id: "t1", kind: .upsert)])
      #expect(try await store.load()?.records["t1"]?.payload?.name == "Caffeine")
    }
    try await sync.save(.make("t1", name: "Changed"), ifUnchanged: condition)
    #expect(try await sync.trophy(id: "t1")?.name == "Changed")
    #expect(try await sync.snapshot().records["t1"]?.revision == 2)
  }

  @Test("readers never see a suspended candidate and a later edit excludes the failed one")
  func suspendedFailure() async throws {
    let store = ControlledStateStore()
    let sync = await durabilityEngine(FakeFirebase(), store: store)
    await store.plan(fail: true, pause: true)
    let first = Task { try await sync.save(.make("t1")) }
    await store.entered(1)
    let second = Task { try await sync.save(.make("t2", name: "Water")) }
    #expect(try await sync.trophies().isEmpty)
    #expect(try await sync.outbox().isEmpty)
    #expect(try await store.load() == nil)
    #expect(await store.writes == 1)
    await store.resume()
    await #expect(throws: DiskFailure.refused) { try await first.value }
    try await second.value
    #expect(try await sync.trophies().map(\.id) == ["t2"])
    #expect(try await sync.outbox().map(\.id) == ["t2"])
    #expect(try await store.load()?.records["t1"] == nil)
    #expect(try await store.load()?.records["t2"]?.payload?.name == "Water")
  }

  @Test("a deletion queued after a suspended save wins without a rollback race")
  func saveThenDelete() async throws {
    let store = ControlledStateStore()
    let sync = await durabilityEngine(FakeFirebase(), store: store)
    await store.plan(pause: true)
    let save = Task { try await sync.save(.make("t1")) }
    await store.entered(1)
    let deletion = Task { try await sync.delete(id: "t1") }
    #expect(try await sync.trophy(id: "t1") == nil)
    await store.resume()
    try await save.value
    try await deletion.value
    #expect(try await sync.trophies().isEmpty)
    #expect(try await sync.outbox().isEmpty)
    #expect(try await store.load()?.records.isEmpty == true)
  }

  @Test("prepared keeps cannot resurrect or replace a trophy, even after delete/recreate")
  func conditionalEdit() async throws {
    let store = ControlledStateStore()
    let sync = await durabilityEngine(FakeFirebase(), store: store)
    try await sync.save(.make("t1"))
    let original = try await sync.saveCondition(for: "t1")
    try await sync.save(.make("t2", name: "Unrelated"))
    try await sync.save(.make("t1", name: "Updated"), ifUnchanged: original)
    let beforeDelete = try await sync.saveCondition(for: "t1")
    try await sync.delete(id: "t1")
    #expect(!(try await sync.saveCondition(for: "t1")).recordExists)
    await #expect(throws: SyncError.localRecordChanged(id: "t1")) {
      try await sync.save(.make("t1"), ifUnchanged: beforeDelete)
    }
    try await sync.save(.make("t1", name: "Updated"))
    await #expect(throws: SyncError.localRecordChanged(id: "t1")) {
      try await sync.save(.make("t1"), ifUnchanged: beforeDelete)
    }
    #expect(try await sync.trophy(id: "t1")?.name == "Updated")
    let beforeReplace = try await sync.saveCondition(for: "t1")
    try await sync.save(.make("t1", name: "Renamed"))
    await #expect(throws: SyncError.localRecordChanged(id: "t1")) {
      try await sync.save(.make("t1"), ifUnchanged: beforeReplace)
    }
  }

  @Test("conditions belong to one engine and one ID")
  func conditionIdentity() async throws {
    let cloud = FakeFirebase()
    let first = await durabilityEngine(cloud, store: ControlledStateStore())
    let second = await durabilityEngine(cloud, store: ControlledStateStore())
    let condition = try await first.saveCondition(for: "t1")
    await #expect(throws: SyncError.localRecordChanged(id: "t1")) {
      try await second.save(.make("t1"), ifUnchanged: condition)
    }
    await #expect(throws: SyncError.localRecordChanged(id: "t2")) {
      try await first.save(.make("t2"), ifUnchanged: condition)
    }
  }

  @Test("failed adoption preserves signed-out state and retries on the next sync")
  func adoptionFailure() async throws {
    let cloud = FakeFirebase()
    let store = ControlledStateStore()
    let sync = await durabilityEngine(cloud, store: store)
    try await sync.save(.make("t1"))
    let beforeSignIn = try await sync.saveCondition(for: "t1")
    await store.plan(fail: true)
    await #expect(throws: DiskFailure.refused) { try await sync.signIn(with: appleCredential()) }
    #expect(try await sync.snapshot().activeOwner == nil)
    #expect(try await sync.snapshot().records["t1"]?.owner == nil)
    #expect(try await store.load()?.activeOwner == nil)
    try await sync.sync()
    #expect(try await sync.snapshot().activeOwner != nil)
    await #expect(throws: SyncError.localRecordChanged(id: "t1")) {
      try await sync.save(.make("t1"), ifUnchanged: beforeSignIn)
    }
  }

  @Test("a prepared absent record cannot cross an account switch away and back")
  func accountABA() async throws {
    let cloud = FakeFirebase()
    let sync = await durabilityEngine(cloud, store: ControlledStateStore())
    try await sync.signIn(with: appleCredential())
    let condition = try await sync.saveCondition(for: "t1")
    #expect(!condition.recordExists)
    try await sync.signOut(flush: false)
    try await sync.signIn(with: appleCredential())
    await #expect(throws: SyncError.localRecordChanged(id: "t1")) {
      try await sync.save(.make("t1"), ifUnchanged: condition)
    }
    #expect(try await sync.trophies().isEmpty)
  }

  @Test("failed pull keeps its cursor and payload unpublished until retry")
  func pullFailure() async throws {
    let cloud = FakeFirebase()
    let store = ControlledStateStore()
    let sync = await durabilityEngine(cloud, store: store)
    try await sync.signIn(with: appleCredential())
    let other = await Device(cloud)
    try await other.sync.signIn(with: appleCredential())
    try await other.sync.save(.make("t1"))
    try await other.sync.sync()
    let before = try await sync.snapshot()
    await store.plan(fail: true)
    await #expect(throws: DiskFailure.refused) { try await sync.sync() }
    #expect(try await sync.trophies().isEmpty)
    #expect(try await sync.snapshot().cursors == before.cursors)
    #expect(try await store.load()?.records.isEmpty == true)
    try await sync.sync()
    #expect(try await sync.trophy(id: "t1")?.name == "Caffeine")
  }

  @Test("failed push acknowledgement retains the durable outbox for safe retry")
  func acknowledgementFailure() async throws {
    let cloud = FakeFirebase()
    let store = ControlledStateStore()
    let sync = await durabilityEngine(cloud, store: store)
    try await sync.signIn(with: appleCredential())
    try await sync.save(.make("t1"))
    await store.plan(fail: true)
    await #expect(throws: DiskFailure.refused) { try await sync.sync() }
    #expect(try await sync.outbox().map(\.id) == ["t1"])
    #expect(try await sync.snapshot().records["t1"]?.remote == nil)
    #expect(try await store.load()?.outbox == ["t1"])
    try await sync.sync()
    #expect(try await sync.outbox().isEmpty)
    #expect(try await sync.snapshot().records["t1"]?.remote != nil)
  }

  @Test("failed account deletion marker does not begin destructive remote work")
  func deletionMarkerFailure() async throws {
    let cloud = FakeFirebase()
    let store = ControlledStateStore()
    let sync = await durabilityEngine(cloud, store: store)
    try await sync.signIn(with: appleCredential())
    try await sync.save(.make("t1"))
    try await sync.sync()
    await cloud.clearCalls()
    await store.plan(fail: true)
    await #expect(throws: DiskFailure.refused) { try await sync.deleteAccount(reauthentication: appleCredential(code: "first")) }
    #expect(try await sync.snapshot().deletingAccount == nil)
    #expect(try await store.load()?.deletingAccount == nil)
    #expect(await cloud.callKinds == ["auth.signInWithIdp"])
    try await sync.deleteAccount(reauthentication: appleCredential(code: "retry"))
    #expect(try await sync.trophies().isEmpty)
    #expect(try await sync.snapshot().deletingAccount == nil)
  }

  @Test("an actual file-system failure leaves no visible trophy and permits a restart-safe retry")
  func actualFileFailure() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("lupi-durability-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let parent = directory.appendingPathComponent("blocked")
    try Data("a file, not a directory".utf8).write(to: parent)
    let store = JSONFileSyncStateStore<TestTrophy>(url: parent.appendingPathComponent("collection.json"))
    let cloud = FakeFirebase()
    let sync = await durabilityEngine(cloud, store: store)
    let condition = try await sync.saveCondition(for: "t1")
    await #expect(throws: (any Error).self) { try await sync.save(.make("t1"), ifUnchanged: condition) }
    #expect(try await sync.trophies().isEmpty)
    #expect(try await sync.outbox().isEmpty)
    try FileManager.default.removeItem(at: parent)
    try await sync.save(.make("t1"), ifUnchanged: condition)
    let restarted = await durabilityEngine(cloud, store: store)
    #expect(try await restarted.trophy(id: "t1")?.name == "Caffeine")
    #expect(try await restarted.outbox().map(\.id) == ["t1"])
  }
}
