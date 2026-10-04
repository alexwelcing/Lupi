import Foundation
import LupiAuth

/// The local-first trophy case. Everything works signed out; signing in adopts
/// what was made signed out and keeps the owner's devices in step through
/// Firestore. Generic over the record (`SyncPayload`) so LupiKit's trophy
/// model plugs in.
///
/// Sync is pull, then push:
/// - pull reads documents whose server `updatedAt` is past this account's
///   cursor (minus a small overlap), in (updatedAt, name) order, and merges
///   them into the local store;
/// - push commits the outbox, each write conditioned on the server version it
///   was based on (`updateTime`, or `exists: false` for a first write). When
///   the condition fails another device got there first: the engine reads
///   that version, settles the conflict, and tries again.
///
/// Conflicts resolve last-writer-wins on `clientUpdatedAt`, the moment the
/// owner made the change on their device, because that is the order the owner
/// acted in: an edit made offline on the iPad at 10:00 and synced at 18:00
/// must not beat an iPhone edit made at 12:00. On a tie the later server
/// commit (`updatedAt`) wins, which for a pending local edit means the local
/// one, since it will commit later. The server cannot be the arbiter of
/// clientUpdatedAt order, so the clients settle it before writing and the
/// preconditions make sure no write lands on a version its device never saw.
public actor TrophySync<Payload: SyncPayload> {
  private let session: SessionManager
  private let firestore: FirestoreClient
  private let store: any SyncStateStore<Payload>
  public nonisolated let configuration: TrophySyncConfiguration
  private let now: @Sendable () -> Date

  private var state = SyncState<Payload>()
  private var loaded = false
  private var loadTask: Task<SyncState<Payload>?, any Error>?
  private var lastPersist: Task<Void, any Error>?
  /// The newest sync run. Each run waits for the one before it, so runs never
  /// overlap.
  private var syncRun: SyncRun?
  private var runCounter = 0
  /// True from the start of deleteAccount to its end: sync refuses to start.
  private var deletionUnderway = false
  /// The last server time seen (readTime, commitTime) and the local time it
  /// arrived, to estimate the server's clock.
  private var serverClock: (server: Date, local: Date)?

  public init(
    session: SessionManager,
    firestore: FirestoreClient,
    store: any SyncStateStore<Payload>,
    configuration: TrophySyncConfiguration = TrophySyncConfiguration(),
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.session = session
    self.firestore = firestore
    self.store = store
    self.configuration = configuration
    self.now = now
  }

  // MARK: - Reading

  /// The visible collection: this account's trophies plus any made signed
  /// out, oldest change first.
  public func trophies() async throws -> [Payload] {
    try await loadIfNeeded()
    return state.records.values
      .filter { isVisible($0) && !$0.isTombstone }
      .sorted { ($0.clientUpdatedAt, $0.id) < ($1.clientUpdatedAt, $1.id) }
      .compactMap(\.payload)
  }

  public func trophy(id: String) async throws -> Payload? {
    try await loadIfNeeded()
    guard let record = state.records[id], isVisible(record) else { return nil }
    return record.payload
  }

  /// What the next push would send.
  public func outbox() async throws -> [OutboxEntry] {
    try await loadIfNeeded()
    return state.outbox.compactMap { id in
      state.records[id].map { OutboxEntry(id: id, kind: $0.isTombstone ? .tombstone : .upsert) }
    }
  }

  /// The persisted state, for diagnostics and tests.
  public func snapshot() async throws -> SyncState<Payload> {
    try await loadIfNeeded()
    return state
  }

  // MARK: - Writing (local first)

  /// Adds or replaces a trophy locally and queues it for the account. A
  /// record that marks its own deletion (`isSyncTombstone`) is `delete(id:)`.
  public func save(_ payload: Payload) async throws {
    try await loadIfNeeded()
    let id = payload.syncID
    try Self.validate(id: id)
    if payload.isSyncTombstone {
      try await delete(id: id)
      return
    }
    _ = try encodePayload(payload)
    let uid = await session.currentUID()
    var record: LocalRecord<Payload>
    if let existing = state.records[id], isVisible(existing) {
      record = existing
    } else {
      record = LocalRecord(id: id, owner: uid, payload: nil, clientUpdatedAt: .epoch, remote: nil, revision: 0)
    }
    if record.owner == nil, let uid { record.owner = uid }
    record.payload = payload
    record.clientUpdatedAt = stamp(after: record.clientUpdatedAt)
    record.revision += 1
    state.records[id] = record
    enqueue(id)
    try await persist()
  }

  /// Deletes a trophy locally and queues a tombstone so the deletion reaches
  /// the owner's other devices.
  public func delete(id: String) async throws {
    try await loadIfNeeded()
    guard var record = state.records[id], isVisible(record), !record.isTombstone else { return }
    if record.owner == nil && record.remote == nil {
      // Never left this device: nothing to tell anyone.
      state.records[id] = nil
      dequeue(id)
    } else {
      record.payload = nil
      record.clientUpdatedAt = stamp(after: record.clientUpdatedAt)
      record.revision += 1
      state.records[id] = record
      enqueue(id)
    }
    try await persist()
  }

  // MARK: - Account

  /// Signs in with Apple, adopts the trophies made signed out into the
  /// account (they are never dropped), then syncs. Adoption is saved before
  /// any network call, so an offline first sync loses nothing.
  @discardableResult
  public func signIn(with credential: AppleCredential) async throws -> SyncReport {
    try await loadIfNeeded()
    try await session.signInWithApple(credential)
    return try await sync()
  }

  /// Stops syncing. Local copies stay and remain visible; changes made while
  /// signed out queue for whoever signs in next. `flush` tries one last sync.
  public func signOut(flush: Bool = true) async throws {
    if flush, await session.currentUID() != nil {
      _ = try? await sync()
    }
    try await session.signOut()
  }

  /// Pull then push for the signed-in account. Concurrent callers for the
  /// same account share one run. `full` re-reads the whole collection instead
  /// of resuming from the cursor: a cheap safety net (say once a day) against
  /// a commit that took longer than `pullOverlap` to become visible.
  @discardableResult
  public func sync(full: Bool = false) async throws -> SyncReport {
    let uid = await session.currentUID()
    // Join only a run that covers this request: a run for the previous
    // account, or one that skips the full re-read, would not.
    if let running = syncRun, running.uid == uid, running.full || !full {
      return try await running.task.value
    }
    runCounter += 1
    let id = runCounter
    let previous = syncRun?.task
    let task = Task { () async throws -> SyncReport in
      _ = await previous?.result
      defer { if self.syncRun?.id == id { self.syncRun = nil } }
      return try await self.runSync(full: full)
    }
    syncRun = SyncRun(id: id, uid: uid, full: full, task: task)
    return try await task.value
  }

  private struct SyncRun {
    var id: Int
    var uid: String?
    var full: Bool
    var task: Task<SyncReport, any Error>
  }

  /// Deletes the account, in the order App Store review and Apple require:
  /// 1. sign in with Apple again (deletion needs a recent login, and Apple's
  ///    fresh authorization code is what revocation consumes);
  /// 2. delete every trophy document of the account;
  /// 3. revoke the Sign in with Apple tokens;
  /// 4. delete the Firebase user;
  /// 5. forget everything local that belonged to the account.
  /// An interruption leaves `deletingAccount` set: sync stays off for that
  /// account until a retry (with a new Apple credential) completes.
  public func deleteAccount(reauthentication credential: AppleCredential) async throws {
    guard let code = credential.authorizationCode, !code.isEmpty else { throw SyncError.missingAuthorizationCode }
    guard !deletionUnderway else { throw SyncError.accountDeletionInProgress }
    // Before the first suspension: a sync started from here on (the app syncs
    // after edits) refuses, so nothing can be pushed or pulled back in while
    // documents are deleted and the uid forgotten.
    deletionUnderway = true
    defer { deletionUnderway = false }
    try await loadIfNeeded()
    guard let uid = await session.currentUID() else { throw SyncError.notSignedIn }
    // Runs are chained, so the newest one finishes after every earlier one.
    if let running = syncRun { _ = await running.task.result }
    do {
      try await session.reauthenticate(with: credential)
    } catch AuthError.reauthenticationMismatch {
      throw SyncError.reauthenticatedAsDifferentAccount
    }
    state.deletingAccount = uid
    try await persist()
    try await deleteRemoteRecords(of: uid)
    try await session.revokeApple(authorizationCode: code)
    try await session.deleteUser()
    forget(uid)
    state.deletingAccount = nil
    try await persist()
  }

  // MARK: - Sync

  private func runSync(full: Bool) async throws -> SyncReport {
    try await loadIfNeeded()
    guard let uid = await session.currentUID() else { throw SyncError.notSignedIn }
    if deletionUnderway || state.deletingAccount == uid { throw SyncError.accountDeletionInProgress }
    var report = SyncReport()
    // Adopt on a change of account, and whenever trophies were made signed
    // out since (a sign-out keeps the same account active).
    if state.activeOwner != uid || state.records.values.contains(where: { $0.owner == nil }) {
      report.adopted = adopt(into: uid)
      try await persist()
    }
    do {
      try await pull(uid: uid, full: full, report: &report)
      try await push(uid: uid, report: &report)
    } catch AuthError.userNotFound {
      // The account was deleted elsewhere: nothing tied to it may stay here.
      forget(uid)
      try await persist()
      throw AuthError.userNotFound
    } catch {
      // Keep whatever was merged or acknowledged before the failure.
      try? await persist()
      throw error
    }
    try await persist()
    return report
  }

  /// Signed-out trophies join the account that signs in. Another account's
  /// copies stay on the device but out of sight until it signs in again.
  private func adopt(into uid: String) -> Int {
    var adopted = 0
    for (id, var record) in state.records where record.owner == nil {
      if record.isTombstone && record.remote == nil {
        state.records[id] = nil
        dequeue(id)
        continue
      }
      record.owner = uid
      state.records[id] = record
      enqueue(id)
      adopted += 1
    }
    state.activeOwner = uid
    return adopted
  }

  private func pull(uid: String, full: Bool, report: inout SyncReport) async throws {
    // REQUEST_TIME is stamped on arrival, before the commit is visible, so a
    // later write can be read first. Re-reading the overlap catches the
    // earlier one; merging is idempotent.
    let since = full ? nil : state.cursors[uid].map { $0.adding(seconds: -configuration.pullOverlap) }
    var after: (FirestoreTimestamp, String)?
    var newest = state.cursors[uid]
    while true {
      let query = StructuredQuery.changes(
        in: configuration.collection,
        field: TrophyEnvelope.updatedAt,
        since: since,
        after: after,
        limit: configuration.pageSize
      )
      let result = try await firestore.runQuery(parentPath: "users/\(uid)", query)
      if let readTime = result.readTime { observeServerTime(readTime) }
      let previous = after
      for document in result.documents {
        if let updatedAt = document.fields[TrophyEnvelope.updatedAt]?.timestampValue {
          after = (updatedAt, document.name)
          if newest.map({ updatedAt > $0 }) ?? true { newest = updatedAt }
        }
        merge(document, uid: uid, report: &report)
      }
      let advanced = after.map { current in previous.map { $0 != current } ?? true } ?? false
      if result.documents.count < configuration.pageSize || !advanced { break }
    }
    if let newest { state.cursors[uid] = newest }
  }

  /// Folds one server document into the local store.
  private func merge(_ document: FirestoreDocument, uid: String, report: inout SyncReport) {
    let remote: TrophyEnvelope.Decoded<Payload>
    switch TrophyEnvelope.decode(document, schema: configuration.schema, as: Payload.self) {
    case .success(let decoded):
      remote = decoded
    case .failure(let problem):
      if !report.skipped.contains(problem.id) { report.skipped.append(problem.id) }
      return
    }
    let id = remote.id
    guard let local = state.records[id] else {
      if remote.payload != nil {
        state.records[id] = LocalRecord(
          id: id,
          owner: uid,
          payload: remote.payload,
          clientUpdatedAt: remote.clientUpdatedAt,
          remote: remote.version,
          revision: 0
        )
        report.pulled += 1
      }
      return
    }
    guard local.owner == uid else {
      // The id is held by another account's local copy; leave both alone.
      if !report.skipped.contains(id) { report.skipped.append(id) }
      return
    }
    // updateTime identifies a version: each write of a document commits later
    // than the last. updatedAt cannot, since REQUEST_TIME has millisecond
    // precision and two devices' writes can share one.
    if !state.outbox.contains(id) {
      if let base = local.remote, base.updateTime >= remote.version.updateTime { return }
      applyRemote(remote, over: local, uid: uid)
      report.pulled += 1
      return
    }
    // A local edit is waiting: last writer wins.
    if let base = local.remote, base.updateTime >= remote.version.updateTime { return }
    if local.clientUpdatedAt >= remote.clientUpdatedAt {
      var rebased = local
      rebased.remote = remote.version
      state.records[id] = rebased
      report.localWins += 1
    } else {
      applyRemote(remote, over: local, uid: uid)
      dequeue(id)
      report.remoteWins += 1
      report.pulled += 1
    }
  }

  private func applyRemote(_ remote: TrophyEnvelope.Decoded<Payload>, over local: LocalRecord<Payload>, uid: String) {
    guard remote.payload != nil else {
      // A remote tombstone: the trophy is gone from every device.
      state.records[remote.id] = nil
      return
    }
    state.records[remote.id] = LocalRecord(
      id: remote.id,
      owner: uid,
      payload: remote.payload,
      clientUpdatedAt: remote.clientUpdatedAt,
      remote: remote.version,
      revision: local.revision + 1
    )
  }

  private func push(uid: String, report: inout SyncReport) async throws {
    for id in state.outbox {
      if let record = state.records[id], record.owner == uid, record.isTombstone, record.remote == nil {
        state.records[id] = nil
        dequeue(id)
      }
    }
    let ids = state.outbox.filter { state.records[$0]?.owner == uid }
    for start in stride(from: 0, to: ids.count, by: configuration.pushBatchSize) {
      let batch = Array(ids[start..<min(start + configuration.pushBatchSize, ids.count)])
      do {
        try await commit(batch, uid: uid, report: &report)
      } catch let error as FirestoreError where error.isPreconditionFailure || error.isRejection {
        // One document spoiled the atomic batch; settle each on its own. A
        // batch of one already told us which.
        for id in batch {
          try await pushOne(id, uid: uid, report: &report, knownFailure: batch.count == 1 ? error : nil)
        }
      }
    }
  }

  private func pushOne(
    _ id: String,
    uid: String,
    report: inout SyncReport,
    knownFailure: FirestoreError? = nil
  ) async throws {
    var pendingFailure = knownFailure
    for _ in 0..<configuration.maxPushAttempts {
      guard let record = state.records[id], record.owner == uid, state.outbox.contains(id) else { return }
      if record.isTombstone && record.remote == nil {
        state.records[id] = nil
        dequeue(id)
        return
      }
      do {
        if let failure = pendingFailure {
          pendingFailure = nil
          throw failure
        }
        try await commit([id], uid: uid, report: &report)
        report.rejected[id] = nil
        return
      } catch let error as FirestoreError where error.isPreconditionFailure {
        // Another device wrote first: read that version and settle by LWW.
        if let current = try await firestore.getDocument(documentPath(uid, id)) {
          merge(current, uid: uid, report: &report)
        } else if var stale = state.records[id] {
          stale.remote = nil
          state.records[id] = stale
        }
      } catch let error as FirestoreError where error.isRejection {
        report.rejected[id] = error.status ?? "rejected"
        return
      }
    }
    if state.outbox.contains(id) {
      report.rejected[id] = "conflict unresolved after \(configuration.maxPushAttempts) attempts"
    }
  }

  private func commit(_ ids: [String], uid: String, report: inout SyncReport) async throws {
    var writes: [FirestoreWrite] = []
    var sent: [Sent] = []
    for id in ids {
      guard let record = state.records[id], record.owner == uid, state.outbox.contains(id) else { continue }
      let stamp = clamp(record.clientUpdatedAt)
      let fields = TrophyEnvelope.fields(
        schema: configuration.schema,
        id: id,
        payload: try record.payload.map(encodePayload),
        clientUpdatedAt: stamp
      )
      let precondition: Precondition = record.remote.map { .updateTime($0.updateTime) } ?? .exists(false)
      writes.append(
        .set(
          name: firestore.configuration.documentName(documentPath(uid, id)),
          fields: fields,
          serverTimestamps: [TrophyEnvelope.updatedAt],
          precondition: precondition
        )
      )
      sent.append(Sent(id: id, revision: record.revision, stamp: stamp, tombstone: record.isTombstone))
    }
    guard !writes.isEmpty else { return }
    let response = try await firestore.commit(writes)
    if let commitTime = response.commitTime { observeServerTime(commitTime) }
    for (index, entry) in sent.enumerated() {
      let result = response.writeResults.flatMap { index < $0.count ? $0[index] : nil }
      guard let updateTime = result?.updateTime ?? response.commitTime else {
        throw FirestoreError.malformedResponse("commit returned no update time")
      }
      let updatedAt = result?.transformResults?.first?.timestampValue ?? updateTime
      acknowledge(entry.id, revision: entry.revision, stamp: entry.stamp, tombstone: entry.tombstone,
                  version: RemoteVersion(updateTime: updateTime, updatedAt: updatedAt))
      report.pushed += 1
    }
  }

  /// What one write in a commit carried, to match it with its result.
  private struct Sent {
    var id: String
    var revision: Int
    var stamp: FirestoreTimestamp
    var tombstone: Bool
  }

  private func acknowledge(
    _ id: String,
    revision: Int,
    stamp: FirestoreTimestamp,
    tombstone: Bool,
    version: RemoteVersion
  ) {
    guard var record = state.records[id] else { return }
    if record.revision == revision {
      dequeue(id)
      if tombstone {
        // The server keeps the tombstone; this device can forget the trophy.
        state.records[id] = nil
        return
      }
      record.clientUpdatedAt = stamp
    }
    // Edited again while in flight: stay queued, now based on this version.
    record.remote = version
    state.records[id] = record
  }

  private func deleteRemoteRecords(of uid: String) async throws {
    let collectionPath = "users/\(uid)/\(configuration.collection)"
    // List and delete until nothing is left (another device may still be
    // adding); bounded so a misbehaving server cannot spin us forever.
    for _ in 0..<10_000 {
      let page = try await firestore.listDocuments(
        collectionPath: collectionPath,
        pageSize: configuration.pushBatchSize,
        mask: [TrophyEnvelope.deleted]
      )
      let names = (page.documents ?? []).map(\.name)
      if names.isEmpty { return }
      _ = try await firestore.commit(names.map { FirestoreWrite.delete(name: $0) })
    }
  }

  private func forget(_ uid: String) {
    for (id, record) in state.records where record.owner == uid {
      state.records[id] = nil
    }
    // Read a copy: the closure may not touch `state` while removeAll mutates it.
    let records = state.records
    state.outbox.removeAll { records[$0] == nil }
    state.cursors[uid] = nil
    if state.activeOwner == uid { state.activeOwner = nil }
  }

  // MARK: - Helpers

  private func isVisible(_ record: LocalRecord<Payload>) -> Bool {
    record.owner == nil || record.owner == state.activeOwner
  }

  private func documentPath(_ uid: String, _ id: String) -> String {
    "users/\(uid)/\(configuration.collection)/\(id)"
  }

  private func enqueue(_ id: String) {
    if !state.outbox.contains(id) { state.outbox.append(id) }
  }

  private func dequeue(_ id: String) {
    state.outbox.removeAll { $0 == id }
  }

  /// Now, at Firestore's microsecond precision, and strictly after the
  /// record's previous stamp so a clock step backwards cannot reorder two
  /// edits of one trophy.
  private func stamp(after previous: FirestoreTimestamp) -> FirestoreTimestamp {
    let current = FirestoreTimestamp(date: now())
    return current > previous ? current : previous.adding(seconds: 0.000_001)
  }

  private func observeServerTime(_ time: FirestoreTimestamp) {
    serverClock = (time.date, now())
  }

  /// A clientUpdatedAt far ahead of the server would win every later edit
  /// (and the rules refuse more than an hour); pull it back to server time.
  private func clamp(_ stamp: FirestoreTimestamp) -> FirestoreTimestamp {
    guard let clock = serverClock else { return stamp }
    let serverNow = clock.server.addingTimeInterval(now().timeIntervalSince(clock.local))
    if stamp.date > serverNow.addingTimeInterval(configuration.maxClockLead) {
      return FirestoreTimestamp(date: serverNow)
    }
    return stamp
  }

  private func encodePayload(_ payload: Payload) throws -> [String: FirestoreValue] {
    let id = payload.syncID
    let json: Data
    do {
      json = try JSONEncoder().encode(payload)
    } catch {
      throw SyncError.encoding(id: id, reason: String(describing: error))
    }
    guard json.count <= configuration.maxPayloadBytes else {
      throw SyncError.payloadTooLarge(id: id, bytes: json.count, limit: configuration.maxPayloadBytes)
    }
    let value: FirestoreValue
    do {
      value = try FirestoreEncoder().encode(payload)
    } catch {
      throw SyncError.encoding(id: id, reason: String(describing: error))
    }
    guard case .map(let fields) = value else { throw SyncError.payloadNotAnObject(id: id) }
    guard fields.count <= configuration.maxPayloadKeys else {
      throw SyncError.payloadTooWide(id: id, keys: fields.count, limit: configuration.maxPayloadKeys)
    }
    return fields
  }

  static func validate(id: String) throws {
    let allowed = id.utf8.allSatisfy { byte in
      (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte == 45 || byte == 95
    }
    guard allowed, (1...128).contains(id.utf8.count) else { throw SyncError.invalidID(id) }
  }

  // MARK: - Persistence

  private func loadIfNeeded() async throws {
    if loaded { return }
    let task = loadTask ?? Task { [store] in try await store.load() }
    loadTask = task
    let stored = try await task.value
    if !loaded {
      if let stored { state = stored }
      loaded = true
    }
  }

  /// Saves in call order even when the store is slow.
  private func persist() async throws {
    let snapshot = state
    let previous = lastPersist
    let task = Task { [store] in
      _ = await previous?.result
      try await store.save(snapshot)
    }
    lastPersist = task
    try await task.value
  }
}
