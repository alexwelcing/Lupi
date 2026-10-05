import Foundation
import LupiAuth
import LupiData
import LupiSync

/// The account configuration a build carries (plan §6.2): an API key restricted to iOS apps and
/// the Firebase project id, from Info.plist keys an untracked xcconfig fills in. A build without
/// them runs with the account features hidden and makes no Firebase calls.
public struct AccountConfiguration: Sendable, Equatable {
    public var apiKey: String
    public var projectID: String
    public var bundleID: String

    /// Nil when either value is missing, blank, or an unexpanded `$(…)` build setting.
    public init?(apiKey: String?, projectID: String?, bundleID: String = "live.lupi.app") {
        func usable(_ value: String?) -> String? {
            guard let v = value?.trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty, !v.contains("$("),
                  !v.contains(where: \.isWhitespace) else { return nil }
            return v
        }
        guard let key = usable(apiKey), let project = usable(projectID) else { return nil }
        self.apiKey = key
        self.projectID = project
        self.bundleID = bundleID
    }
}

/// Who the collection belongs to now.
public enum AccountStatus: Sendable, Equatable {
    /// The build has no account configuration: local only.
    case unavailable
    case signedOut
    case signedIn(uid: String)
    /// A deletion started and did not finish (account-and-sync.md §5): "Finish deleting your
    /// account", which needs a new Sign in with Apple.
    case deletionPending(uid: String)
}

/// The local-first trophy case (plan §6.1–§6.2, account-and-sync.md §4, §7): trophies live on
/// the device in one JSON file and work fully signed out; signed in, they sync with the Lupi
/// account through LupiSync.
public struct TrophyCase: Sendable {
    public let sync: TrophySync<TrophyRecord>
    public let session: SessionManager
    public let configuration: AccountConfiguration?

    public init(sync: TrophySync<TrophyRecord>, session: SessionManager, configuration: AccountConfiguration?) {
        self.sync = sync
        self.session = session
        self.configuration = configuration
    }

    /// The app's case: its state in `directory/collection.json`, the session in `tokens` (the
    /// Keychain). Without a configuration the clients exist but are never asked to call out.
    public static func make(
        directory: URL, configuration: AccountConfiguration?, tokens: any TokenStore,
        transport: any HTTPTransport = URLSessionTransport(), now: @escaping @Sendable () -> Date = { Date() }
    ) -> TrophyCase {
        let auth = AuthClient(
            configuration: AuthConfiguration(apiKey: configuration?.apiKey ?? "", bundleIdentifier: configuration?.bundleID ?? "live.lupi.app"),
            transport: transport
        )
        let session = SessionManager(client: auth, store: tokens, now: now)
        let firestore = FirestoreClient(
            configuration: FirestoreConfiguration(projectID: configuration?.projectID ?? "unconfigured"), transport: transport, tokens: session
        )
        let store = JSONFileSyncStateStore<TrophyRecord>(url: directory.appendingPathComponent("collection.json"))
        let sync = TrophySync(session: session, firestore: firestore, store: store, now: now)
        return TrophyCase(sync: sync, session: session, configuration: configuration)
    }

    public var accountsEnabled: Bool { configuration != nil }

    // MARK: The collection, signed in or not

    /// Every trophy on show, newest first.
    public func trophies() async throws -> [TrophyRecord] {
        try await sync.trophies().sorted { ($0.createdAt, $0.id.uuidString) > ($1.createdAt, $1.id.uuidString) }
    }

    /// Every live trophy on this device, of any account: what shelf placements may keep. A
    /// placement of a trophy hidden while another account is signed in is not a missing one.
    public func knownTrophyIDs() async throws -> Set<UUID> {
        Set(try await sync.snapshot().records.values.compactMap { $0.payload?.id })
    }

    public func trophy(_ id: UUID) async throws -> TrophyRecord? {
        try await sync.trophy(id: id.uuidString)
    }

    /// Saves a kept trophy, or a changed one. Records that break the contract are refused here,
    /// before they are queued for anyone else.
    public func keep(_ trophy: TrophyRecord) async throws {
        let issues = trophy.validate()
        guard issues.isEmpty else { throw KeepError.corrupt(issues.joined(separator: "; ")) }
        try await sync.save(trophy)
    }

    /// Renames a trophy; nil when it is not in the collection.
    @discardableResult
    public func rename(_ id: UUID, to name: String, at now: Date) async throws -> TrophyRecord? {
        guard var trophy = try await trophy(id) else { return nil }
        let clean = TrophyRecord.cleanName(name, fallback: trophy.name)
        guard clean != trophy.name else { return trophy }
        trophy.name = clean
        trophy.updatedAt = max(trophy.updatedAt, Keep.millisecond(now))
        try await keep(trophy)
        return trophy
    }

    /// Deletes a trophy everywhere: a tombstone tells the owner's other devices (account-and-sync.md §4).
    public func delete(_ id: UUID, at now: Date) async throws {
        guard let trophy = try await trophy(id) else { return }
        try await sync.save(trophy.tombstone(at: Keep.millisecond(now)))
    }

    // MARK: The account

    public func status() async -> AccountStatus {
        guard accountsEnabled else { return .unavailable }
        if let pending = try? await sync.snapshot().deletingAccount { return .deletionPending(uid: pending) }
        if let uid = await session.currentUID() { return .signedIn(uid: uid) }
        return .signedOut
    }

    /// Sign in with Apple, then the first sync: trophies made signed out join the account.
    @discardableResult
    public func signIn(_ credential: AppleCredential) async throws -> SyncReport {
        guard accountsEnabled else { throw AccountError.unavailable }
        return try await sync.signIn(with: credential)
    }

    /// Signs out after one last sync; the copies on this device stay.
    public func signOut() async throws {
        try await sync.signOut(flush: accountsEnabled)
    }

    /// Pull then push when signed in; nil when there is nothing to sync with.
    @discardableResult
    public func syncNow(full: Bool = false) async throws -> SyncReport? {
        guard accountsEnabled, await session.currentUID() != nil else { return nil }
        if case .deletionPending = await status() { return nil }
        return try await sync.sync(full: full)
    }

    /// Deletes the account in the order account-and-sync.md §5 gives: re-authenticate with the
    /// fresh credential, mark the deletion, delete every trophy document, revoke Apple's tokens
    /// with the credential's authorization code, delete the Firebase user, forget it locally.
    public func deleteAccount(reauthentication credential: AppleCredential) async throws {
        guard accountsEnabled else { throw AccountError.unavailable }
        try await sync.deleteAccount(reauthentication: credential)
    }

    /// "Erase this device's collection": every trophy on this device goes; the account keeps its own.
    public func eraseDevice() async throws {
        try await sync.eraseLocal()
    }
}

public enum AccountError: Error, Equatable, Sendable {
    /// This build carries no account configuration.
    case unavailable
}

/// When the collection syncs (account-and-sync.md §7, step 10): on launch and on foreground, a
/// few seconds after an edit, and a full re-read once a day as a safety net.
public struct SyncPolicy: Sendable, Equatable, Codable {
    /// Edits made close together sync together.
    public static let afterEdit: TimeInterval = 3
    public static let fullEvery: TimeInterval = 24 * 3600

    public private(set) var lastFull: Date?

    public init(lastFull: Date? = nil) {
        self.lastFull = lastFull
    }

    /// On launch or foreground: whether this sync should re-read everything.
    public func opening(at now: Date) -> Bool {
        lastFull.map { now.timeIntervalSince($0) >= Self.fullEvery || now < $0 } ?? true
    }

    public mutating func completed(full: Bool, at now: Date) {
        if full { lastFull = now }
    }
}
