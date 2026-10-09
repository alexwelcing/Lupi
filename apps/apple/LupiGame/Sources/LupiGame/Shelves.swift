import Foundation
import LupiChem
import LupiData
import LupiScale

/// Shelf geometry (plan §6.3, contracts.md §2.3): placements are poses relative to one root
/// anchor, so moving the root moves the arrangement.
public enum ShelfMath {
    /// The root of a new shelf, or of "Put the shelf here": at the support point, upright, its +z
    /// turned toward the camera so the arrangement faces whoever placed it.
    public static func rootPose(at point: Vec3, camera: Vec3) -> RigidD {
        var toward = camera - point
        toward.y = 0
        let yaw = toward.lengthSquared > 1e-12 ? atan2(toward.x, toward.z) : 0
        return RigidD(rotation: Quat.axisAngle(Vec3(0, 1, 0), yaw), translation: point)
    }

    /// The placement transform of a kept pose under `root`.
    public static func transform(_ pose: KeptPose, root: RigidD) -> RootTransform {
        let local = root.inverse * pose.entity
        let q = local.rotation.normalizedQuat
        return RootTransform(
            translation: SIMD3(Float(local.translation.x), Float(local.translation.y), Float(local.translation.z)),
            rotation: SIMD4(Float(q.x), Float(q.y), Float(q.z), Float(q.w)),
            scale: pose.scale
        )
    }

    /// Where a placement puts its trophy's entity in the world.
    public static func worldPose(_ t: RootTransform, root: RigidD) -> RigidD {
        let q = Quat(x: Double(t.rotation.x), y: Double(t.rotation.y), z: Double(t.rotation.z), w: Double(t.rotation.w)).normalizedQuat
        let local = RigidD(rotation: q, translation: Vec3(Double(t.translation.x), Double(t.translation.y), Double(t.translation.z)))
        return root * local
    }

    public static func placement(trophy: UUID, pose: KeptPose, root: RigidD, at date: Date) -> ShelfPlacement {
        ShelfPlacement(
            trophyId: trophy, transform: transform(pose, root: root), pinnedAt: Keep.millisecond(date),
            spanMetres: pose.scale == 0 ? pose.spanMetres : nil
        )
    }
}

/// The shelves on this device (contracts.md §2): one directory per shelf under
/// `Application Support/Lupi/Shelves/<shelf id>/`, holding `shelf.json`, the world map and the
/// snapshot. Never synced or uploaded (D7); the app excludes the folder from backup.
public struct ShelfStore: Sendable {
    public static let recordFileName = "shelf.json"
    static let lastUsedFileName = "last-used"

    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    public enum PinResult: Sendable, Equatable {
        case pinned(ShelfRecord)
        /// The shelf already holds 60 other trophies (plan §3.4).
        case full
    }

    func folder(_ id: UUID) -> URL { directory.appendingPathComponent(id.uuidString, isDirectory: true) }

    /// Every shelf that reads, most recently changed first.
    public func list() -> [ShelfRecord] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.compactMap { UUID(uuidString: $0).flatMap { try? load($0) } }
            .sorted { ($0.updatedAt, $0.id.uuidString) > ($1.updatedAt, $1.id.uuidString) }
    }

    public func load(_ id: UUID) throws -> ShelfRecord {
        let data = try Data(contentsOf: folder(id).appendingPathComponent(Self.recordFileName))
        return try LupiJSON.decoder().decode(ShelfRecord.self, from: data)
    }

    public func save(_ shelf: ShelfRecord) throws {
        let issues = shelf.validate()
        guard issues.isEmpty else { throw ShelfStoreError.invalid(issues) }
        try write(LupiJSON.encoder().encode(shelf), to: folder(shelf.id).appendingPathComponent(Self.recordFileName))
    }

    /// A new room: its root anchor is the one the app just added (plan §6.3).
    public func create(name: String? = nil, rootAnchorId: UUID, at date: Date) throws -> ShelfRecord {
        let shelf = ShelfRecord(name: name ?? "Room \(list().count + 1)", rootAnchorId: rootAnchorId, createdAt: Keep.millisecond(date))
        try save(shelf)
        try setLastUsed(shelf.id)
        return shelf
    }

    /// Pins a trophy on a shelf and takes it off every other: a trophy has at most one placement
    /// across all shelves (contracts.md §2.3).
    public func pin(_ placement: ShelfPlacement, on shelfID: UUID, at date: Date) throws -> PinResult {
        var shelf = try load(shelfID)
        guard shelf.pin(placement, at: Keep.millisecond(date)) else { return .full }
        try save(shelf)
        for var other in list() where other.id != shelfID && other.placement(of: placement.trophyId) != nil {
            other.unpin(placement.trophyId, at: Keep.millisecond(date))
            try save(other)
        }
        return .pinned(shelf)
    }

    /// Drops placements whose trophy left the collection (contracts.md §2.3); returns how many.
    @discardableResult
    public func dropMissing(keeping trophies: Set<UUID>) throws -> Int {
        var dropped = 0
        for var shelf in list() {
            let n = shelf.dropPlacements(keeping: trophies)
            if n > 0 {
                dropped += n
                try save(shelf)
            }
        }
        return dropped
    }

    // MARK: The map and the snapshot

    /// Saves the archived ARWorldMap and records when and at which mapping status.
    public func saveMap(_ data: Data, shelf: inout ShelfRecord, status: String, at date: Date) throws {
        guard ShelfRecord.savableMapStatuses.contains(status) else { throw ShelfStoreError.mapNotReady(status) }
        try write(data, to: folder(shelf.id).appendingPathComponent(shelf.worldMapFile))
        shelf.mapSavedAt = Keep.millisecond(date)
        shelf.mapStatusAtSave = status
        shelf.updatedAt = max(shelf.updatedAt, shelf.mapSavedAt!)
        try save(shelf)
    }

    public func map(of shelf: ShelfRecord) -> Data? {
        try? Data(contentsOf: folder(shelf.id).appendingPathComponent(shelf.worldMapFile))
    }

    public func saveSnapshot(_ jpeg: Data, shelf: inout ShelfRecord) throws {
        let name = ShelfRecord.snapshotFileName
        try write(jpeg, to: folder(shelf.id).appendingPathComponent(name))
        shelf.snapshotFile = name
        try save(shelf)
    }

    public func snapshot(of shelf: ShelfRecord) -> Data? {
        shelf.snapshotFile.flatMap { try? Data(contentsOf: folder(shelf.id).appendingPathComponent($0)) }
    }

    // MARK: Deleting

    /// Deleting a shelf deletes its directory: map, snapshot and record (contracts.md §2.3).
    public func delete(_ id: UUID) throws {
        let url = folder(id)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        if lastUsed == id { try? FileManager.default.removeItem(at: directory.appendingPathComponent(Self.lastUsedFileName)) }
    }

    /// "Erase this device's collection": every shelf goes.
    public func deleteAll() throws {
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }

    // MARK: The room opened last (plan §6.3)

    public var lastUsed: UUID? {
        (try? String(contentsOf: directory.appendingPathComponent(Self.lastUsedFileName), encoding: .utf8))
            .flatMap { UUID(uuidString: $0.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }

    public func setLastUsed(_ id: UUID) throws {
        try write(Data(id.uuidString.utf8), to: directory.appendingPathComponent(Self.lastUsedFileName))
    }

    func write(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var options: Data.WritingOptions = [.atomic]
        #if os(iOS)
        // Room data is only read while the app is open in front of the player.
        options.insert(.completeFileProtection)
        #endif
        try data.write(to: url, options: options)
    }
}

public enum ShelfStoreError: Error, Equatable, Sendable {
    case invalid([String])
    /// Maps are saved only at `mapped` or `extending` (apple-ar-platform.md §2.1).
    case mapNotReady(String)
}
