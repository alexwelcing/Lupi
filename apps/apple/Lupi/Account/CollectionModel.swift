import Foundation
import LupiData
import LupiGame
import LupiSync
import Observation

/// The collection and the account for the views (plan §6.1–§6.2): the local-first trophy case,
/// the shelves on this device, and when to sync. Everything works signed out; a build without
/// the Firebase configuration shows no account at all.
@MainActor
@Observable
final class CollectionModel {
    @ObservationIgnored let trophyCase: TrophyCase
    @ObservationIgnored let shelves: ShelfStore

    private(set) var trophies: [TrophyRecord] = []
    private(set) var rooms: [ShelfRecord] = []
    private(set) var status: AccountStatus = .signedOut
    private(set) var syncing = false
    /// The last thing worth telling the player: a failed sync, a refused sign-in.
    private(set) var notice: String?

    @ObservationIgnored private var policy: SyncPolicy
    @ObservationIgnored private var editSync: Task<Void, Never>?

    /// Called when a trophy leaves the collection, so play can let its bodies go.
    @ObservationIgnored var onForget: ((UUID) -> Void)?

    enum Keys {
        static let lastFullSync = "lupi.lastFullSync"
        static let apiKey = "LupiFirebaseAPIKey"
        static let projectID = "LupiFirebaseProjectID"
    }

    init() {
        let info = Bundle.main
        let configuration = AccountConfiguration(
            apiKey: info.object(forInfoDictionaryKey: Keys.apiKey) as? String,
            projectID: info.object(forInfoDictionaryKey: Keys.projectID) as? String
        )
        let root = URL.applicationSupportDirectory.appending(path: "Lupi", directoryHint: .isDirectory)
        trophyCase = TrophyCase.make(directory: root, configuration: configuration, tokens: KeychainTokenStore())
        let shelfFolder = root.appending(path: "Shelves", directoryHint: .isDirectory)
        shelves = ShelfStore(directory: shelfFolder)
        Self.excludeFromBackup(shelfFolder)
        policy = SyncPolicy(lastFull: UserDefaults.standard.object(forKey: Keys.lastFullSync) as? Date)
        status = configuration == nil ? .unavailable : .signedOut
    }

    var accountsEnabled: Bool { trophyCase.accountsEnabled }

    func trophy(_ id: UUID) -> TrophyRecord? { trophies.first { $0.id == id } }

    func report(_ text: String) { notice = text }

    /// The room a trophy sits in, by name.
    func room(of trophy: UUID) -> String? { rooms.first { $0.placement(of: trophy) != nil }?.name }

    // MARK: Lifecycle

    /// On launch and whenever the app comes back to the foreground (account-and-sync.md §7).
    func opened() async {
        await refresh()
        await sync(full: policy.opening(at: Date()))
    }

    func refresh() async {
        do {
            trophies = try await trophyCase.trophies()
            // A placement whose trophy left the collection is dropped (contracts.md §2.3).
            try shelves.dropMissing(keeping: try await trophyCase.knownTrophyIDs())
        } catch {
            notice = "Could not read the collection: \(error)"
        }
        rooms = shelves.list()
        status = await trophyCase.status()
    }

    // MARK: Editing, signed in or not

    func keep(_ record: TrophyRecord) async {
        do {
            try await trophyCase.keep(record)
        } catch {
            notice = "Could not keep \(record.name): \(error)"
        }
        await refresh()
        scheduleSync()
    }

    func rename(_ id: UUID, to name: String) async {
        do {
            try await trophyCase.rename(id, to: name, at: Date())
        } catch {
            notice = "Could not rename it: \(error)"
        }
        await refresh()
        scheduleSync()
    }

    func delete(_ id: UUID) async {
        do {
            try await trophyCase.delete(id, at: Date())
        } catch {
            notice = "Could not delete it: \(error)"
        }
        onForget?(id)
        await refresh()
        scheduleSync()
    }

    func deleteRoom(_ id: UUID) {
        try? shelves.delete(id)
        rooms = shelves.list()
    }

    func openNext(_ room: UUID) {
        try? shelves.setLastUsed(room)
        rooms = shelves.list()
    }

    // MARK: The account

    func signIn(_ credential: AppleCredential) async {
        do {
            syncing = true
            defer { syncing = false }
            try await trophyCase.signIn(credential)
            notice = nil
        } catch {
            notice = "Sign in did not finish: \(error)"
        }
        await refresh()
    }

    func signOut() async {
        do {
            try await trophyCase.signOut()
        } catch {
            notice = "Sign out did not finish: \(error)"
        }
        await refresh()
    }

    /// account-and-sync.md §5, in order; `eraseDevice` then forgets this device's collection
    /// and shelves too ("Erase this device's collection", plan §6.2).
    func deleteAccount(_ credential: AppleCredential, eraseDevice: Bool) async -> Bool {
        var deleted = false
        do {
            syncing = true
            defer { syncing = false }
            try await trophyCase.deleteAccount(reauthentication: credential)
            deleted = true
            notice = "Your Lupi account is deleted."
        } catch {
            notice = "The deletion did not finish: \(error). Sign in with Apple again to finish it."
        }
        if deleted && eraseDevice { await self.eraseDevice() }
        await refresh()
        return deleted
    }

    func eraseDevice() async {
        do {
            for trophy in trophies { onForget?(trophy.id) }
            try await trophyCase.eraseDevice()
            try shelves.deleteAll()
            Self.excludeFromBackup(shelves.directory)
        } catch {
            notice = "Could not erase: \(error)"
        }
        await refresh()
    }

    // MARK: Sync

    func sync(full: Bool = false) async {
        guard accountsEnabled, case .signedIn = status else { return }
        syncing = true
        defer { syncing = false }
        do {
            try await trophyCase.syncNow(full: full)
            policy.completed(full: full, at: Date())
            if let last = policy.lastFull { UserDefaults.standard.set(last, forKey: Keys.lastFullSync) }
            notice = nil
        } catch {
            notice = "Sync failed: \(error)"
        }
        await refresh()
    }

    /// A few seconds after the last edit (account-and-sync.md §7).
    private func scheduleSync() {
        editSync?.cancel()
        editSync = Task { [weak self] in
            try? await Task.sleep(for: .seconds(SyncPolicy.afterEdit))
            guard !Task.isCancelled else { return }
            await self?.sync()
        }
    }

    /// Shelves hold room maps and photos of the home: never in a backup (D7, plan §6.3).
    private static func excludeFromBackup(_ folder: URL) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var url = folder
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }
}
