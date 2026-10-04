import Foundation
import LupiCloudTesting
import Testing

@testable import LupiSync

/// Shaped like contracts.md's TrophyRecord where the engine cares: a UUID id
/// and a record that carries its own tombstone (`deletedAt`).
struct ContractTrophy: Codable, Sendable, Hashable, Identifiable {
  var schema = "lupi.trophy.v1"
  var id: UUID
  var name: String
  var createdAt: Date
  var updatedAt: Date
  var deletedAt: Date?
}

// All a lupi.trophy.v1 record needs: syncID comes from its UUID id.
extension ContractTrophy: SyncPayload {
  var isSyncTombstone: Bool { deletedAt != nil }
}

/// A device syncing any record type against the shared fake Firebase.
struct Engine<Payload: SyncPayload> {
  let clock: TestClock
  let sync: TrophySync<Payload>

  init(_ cloud: FakeFirebase) async {
    clock = TestClock(await cloud.now)
    let sessions = SessionManager(
      client: AuthClient(configuration: AuthConfiguration(apiKey: "test-api-key"), transport: cloud),
      store: InMemoryTokenStore(),
      now: clock.function
    )
    let firestore = FirestoreClient(
      configuration: FirestoreConfiguration(projectID: "demo-lupi"),
      transport: cloud,
      tokens: sessions
    )
    sync = TrophySync(session: sessions, firestore: firestore, store: InMemorySyncStateStore<Payload>(), now: clock.function)
  }
}

@Suite("Record contract")
struct RecordContractTests {
  let id = UUID(uuidString: "6F1C2D9E-3B7A-4E58-9C21-0A5D7B8E4F13")!
  let made = Date(timeIntervalSince1970: 1_790_000_000)

  var record: ContractTrophy {
    ContractTrophy(id: id, name: "Caffeine", createdAt: made, updatedAt: made)
  }

  @Test("a UUID-keyed record syncs under its uuidString, and its deletedAt as a tombstone")
  func uuidRecordAndOwnTombstone() async throws {
    let cloud = FakeFirebase()
    let phone = await Engine<ContractTrophy>(cloud)
    let pad = await Engine<ContractTrophy>(cloud)
    try await phone.sync.signIn(with: appleCredential())
    try await pad.sync.signIn(with: appleCredential())
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    let path = "users/\(uid)/trophies/\(id.uuidString)"

    try await phone.sync.save(record)
    try await phone.sync.sync()
    let document = try #require(await cloud.document(path))
    #expect(document.fields["id"] == .string("6F1C2D9E-3B7A-4E58-9C21-0A5D7B8E4F13"))
    #expect(document.fields["payload"]?.mapFields?["id"] == .string(id.uuidString))
    try await pad.sync.sync()
    #expect(try await pad.sync.trophies() == [record])

    phone.clock.advance(5)
    var deleted = record
    deleted.updatedAt = phone.clock.now
    deleted.deletedAt = phone.clock.now
    try await phone.sync.save(deleted)
    #expect(try await phone.sync.trophies().isEmpty)
    #expect(try await phone.sync.outbox() == [OutboxEntry(id: id.uuidString, kind: .tombstone)])
    try await phone.sync.sync()
    let tombstone = try #require(await cloud.document(path))
    #expect(tombstone.fields["deleted"] == .boolean(true))
    #expect(tombstone.fields["payload"] == .map([:]))

    try await pad.sync.sync()
    #expect(try await pad.sync.trophies().isEmpty)
  }

  @Test("a pulled record that marks its own deletion is a tombstone, whatever the envelope says")
  func pulledRecordTombstone() async throws {
    let cloud = FakeFirebase()
    let phone = await Engine<ContractTrophy>(cloud)
    try await phone.sync.signIn(with: appleCredential())
    let uid = try #require(await cloud.uid(forAppleSub: "apple-owner"))
    try await phone.sync.save(record)
    try await phone.sync.sync()

    var deleted = record
    deleted.deletedAt = made.addingTimeInterval(60)
    guard case .map(let payload) = try FirestoreEncoder().encode(deleted) else {
      Issue.record("a record encodes as a map")
      return
    }
    // Another client wrote the deleted record live (deleted: false).
    await cloud.serverWrite(
      "users/\(uid)/trophies/\(id.uuidString)",
      fields: TrophyEnvelope.fields(
        schema: "lupi.trophy.v1",
        id: id.uuidString,
        payload: payload,
        clientUpdatedAt: FirestoreTimestamp(date: await cloud.now)
      )
    )
    try await phone.sync.sync()
    #expect(try await phone.sync.trophies().isEmpty)
    #expect(try await phone.sync.snapshot().records[id.uuidString] == nil)
  }

  @Test("saving a tombstone for a trophy this device never had queues nothing")
  func unknownTombstone() async throws {
    let cloud = FakeFirebase()
    let phone = await Engine<ContractTrophy>(cloud)
    var deleted = record
    deleted.deletedAt = made
    try await phone.sync.save(deleted)
    #expect(try await phone.sync.outbox().isEmpty)
    #expect(try await phone.sync.snapshot().records.isEmpty)
  }
}
