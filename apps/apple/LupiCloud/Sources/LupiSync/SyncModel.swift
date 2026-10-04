import Foundation

/// A record the engine can sync. The trophy model (lupi.trophy.v1 in
/// LupiKit) conforms; the engine reads only its document id and whether it
/// marks itself deleted.
public protocol SyncPayload: Codable, Sendable {
  /// The Firestore document id; must match [A-Za-z0-9_-]{1,128}.
  var syncID: String { get }
  /// True for a record that carries its own tombstone (lupi.trophy.v1's
  /// `deletedAt`). The engine syncs it as a deletion, never as a live record.
  var isSyncTombstone: Bool { get }
}

extension SyncPayload {
  public var isSyncTombstone: Bool { false }
}

extension SyncPayload where Self: Identifiable, ID == String {
  public var syncID: String { id }
}

extension SyncPayload where Self: Identifiable, ID == UUID {
  /// Uppercase hex with hyphens, as Swift encodes a UUID: the document id
  /// contracts.md gives a trophy.
  public var syncID: String { id.uuidString }
}

public struct TrophySyncConfiguration: Sendable, Equatable {
  /// The envelope's `schema`; must match firestore.rules.
  public var schema: String
  /// Subcollection under users/{uid}.
  public var collection: String
  /// Bound on one record's JSON encoding.
  public var maxPayloadBytes: Int
  /// Top-level payload keys; firestore.rules caps the map at 32.
  public var maxPayloadKeys: Int
  public var pageSize: Int
  /// Writes per commit (Firestore allows 500).
  public var pushBatchSize: Int
  /// Each pull re-reads this much before the cursor, so a commit that became
  /// visible after a later one is still seen. Merging is idempotent.
  public var pullOverlap: TimeInterval
  /// A device clock may lead the server by at most this much when stamping
  /// clientUpdatedAt (the rules refuse more than an hour).
  public var maxClockLead: TimeInterval
  /// Rounds of (commit, conflict, re-read) per record before giving up for
  /// this sync.
  public var maxPushAttempts: Int

  public init(
    schema: String = "lupi.trophy.v1",
    collection: String = "trophies",
    maxPayloadBytes: Int = 256 * 1024,
    maxPayloadKeys: Int = 32,
    pageSize: Int = 300,
    pushBatchSize: Int = 100,
    pullOverlap: TimeInterval = 60,
    maxClockLead: TimeInterval = 300,
    maxPushAttempts: Int = 3
  ) {
    self.schema = schema
    self.collection = collection
    self.maxPayloadBytes = maxPayloadBytes
    self.maxPayloadKeys = maxPayloadKeys
    self.pageSize = pageSize
    self.pushBatchSize = pushBatchSize
    self.pullOverlap = pullOverlap
    self.maxClockLead = maxClockLead
    self.maxPushAttempts = maxPushAttempts
  }
}

/// The server version a local record was last reconciled with.
public struct RemoteVersion: Codable, Sendable, Equatable {
  /// The document's updateTime (commit time, microseconds): identifies the
  /// version and is the precondition for the next write.
  public var updateTime: FirestoreTimestamp
  /// The envelope's REQUEST_TIME (arrival, milliseconds): what pulls query
  /// and order by, since queries cannot see updateTime.
  public var updatedAt: FirestoreTimestamp
}

public struct LocalRecord<Payload: SyncPayload>: Codable, Sendable {
  public var id: String
  /// The account this copy belongs to; nil for a trophy made signed out and
  /// not yet adopted by an account.
  public var owner: String?
  /// nil marks a tombstone.
  public var payload: Payload?
  public var clientUpdatedAt: FirestoreTimestamp
  public var remote: RemoteVersion?
  /// Bumped by every local edit, so a push that finishes after a newer edit
  /// does not mark that edit as synced.
  public var revision: Int

  public var isTombstone: Bool { payload == nil }
}

/// Everything the engine persists. One JSON document, written atomically.
public struct SyncState<Payload: SyncPayload>: Codable, Sendable {
  public var format: String
  /// The account whose trophies are shown: the signed-in user, or the last
  /// one after sign-out (local copies stay visible).
  public var activeOwner: String?
  public var records: [String: LocalRecord<Payload>]
  /// Pending upserts and tombstones, by record id, oldest first.
  public var outbox: [String]
  /// Per account: the newest envelope updatedAt pulled.
  public var cursors: [String: FirestoreTimestamp]
  /// Set while an account deletion is underway; sync stays off for it.
  public var deletingAccount: String?

  public init() {
    format = "lupi.sync-state.v1"
    activeOwner = nil
    records = [:]
    outbox = []
    cursors = [:]
    deletingAccount = nil
  }
}

public struct SyncReport: Sendable, Equatable {
  /// Remote changes applied to the local store.
  public var pulled = 0
  /// Writes committed.
  public var pushed = 0
  /// Conflicts where the local edit was newer and was kept.
  public var localWins = 0
  /// Conflicts where the remote edit was newer and replaced the local one.
  public var remoteWins = 0
  /// Signed-out trophies adopted into the account during this sync.
  public var adopted = 0
  /// Remote documents this build cannot read (other schema, bad payload).
  public var skipped: [String] = []
  /// Records the server refused this time, with the reason. They stay
  /// queued and are retried on the next sync.
  public var rejected: [String: String] = [:]

  public init() {}
}

public enum SyncError: Error, Sendable, Equatable {
  case notSignedIn
  /// Ids must match [A-Za-z0-9_-]{1,128} (the rules' document id check).
  case invalidID(String)
  case payloadTooLarge(id: String, bytes: Int, limit: Int)
  case payloadTooWide(id: String, keys: Int, limit: Int)
  case payloadNotAnObject(id: String)
  case encoding(id: String, reason: String)
  /// An account deletion started and has not finished; finish it first.
  case accountDeletionInProgress
  /// Deleting an account needs Apple's authorization code to revoke tokens.
  case missingAuthorizationCode
  /// Re-authentication signed in as a different account than the one being
  /// deleted.
  case reauthenticatedAsDifferentAccount
}

public enum OutboxKind: String, Sendable, Equatable {
  case upsert
  case tombstone
}

public struct OutboxEntry: Sendable, Equatable {
  public var id: String
  public var kind: OutboxKind
}

// MARK: - Local stores

/// Where the engine keeps its state between launches.
public protocol SyncStateStore<Payload>: Sendable {
  associatedtype Payload: SyncPayload
  func load() async throws -> SyncState<Payload>?
  func save(_ state: SyncState<Payload>) async throws
}

public actor InMemorySyncStateStore<Payload: SyncPayload>: SyncStateStore {
  private var state: SyncState<Payload>?
  public private(set) var saveCount = 0

  public init(_ state: SyncState<Payload>? = nil) {
    self.state = state
  }

  public func load() async throws -> SyncState<Payload>? { state }

  public func save(_ state: SyncState<Payload>) async throws {
    self.state = state
    saveCount += 1
  }
}

/// One JSON file, replaced atomically on every save (write to a temporary
/// file, then rename), so a crash leaves either the old state or the new one.
/// Whole-file writes suit a collection of small records; the 256 KiB cap
/// bounds the worst case.
public struct JSONFileSyncStateStore<Payload: SyncPayload>: SyncStateStore {
  public let url: URL

  public init(url: URL) {
    self.url = url
  }

  public func load() async throws -> SyncState<Payload>? {
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(SyncState<Payload>.self, from: data)
  }

  public func save(_ state: SyncState<Payload>) async throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(state)
    var options: Data.WritingOptions = [.atomic]
    #if os(iOS)
      // Readable after first unlock, so a background sync can still run.
      options.insert(.completeFileProtectionUntilFirstUserAuthentication)
    #endif
    try data.write(to: url, options: options)
  }
}
