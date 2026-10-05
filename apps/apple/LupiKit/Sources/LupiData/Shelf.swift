import Foundation

/// `lupi.shelf.v1` (contracts.md §2, amended by scale-spec §7.5): one room's
/// arrangement. On the device only (D7): never synced, never uploaded,
/// excluded from backup. Placements are relative to the root anchor, so moving
/// the root ("Put the shelf here") moves the whole arrangement and rewrites
/// nothing here.
public struct ShelfRecord: Codable, Sendable, Hashable, Identifiable {
    public static let schemaID = "lupi.shelf.v1"
    /// `ARAnchor.name` of the root.
    public static let rootAnchorName = "lupi.shelf.root"
    public static let worldMapFileName = "world.arworldmap"
    public static let snapshotFileName = "snapshot.jpg"
    /// plan §3.4.
    public static let maxPlacements = 60
    public static let maxNameLength = 40
    /// `worldMappingStatus` values a map is saved at (apple-ar-platform.md §2.1).
    public static let savableMapStatuses: Set<String> = ["mapped", "extending"]

    public var schema: String
    public var id: UUID
    /// "Living room"; 1...40 characters.
    public var name: String
    /// NSKeyedArchiver data of the ARWorldMap, beside this record.
    public var worldMapFile: String
    /// `ARAnchor.identifier` of the anchor named `lupi.shelf.root`.
    public var rootAnchorId: UUID
    /// The camera image at the last map save.
    public var snapshotFile: String?
    public var placements: [ShelfPlacement]
    public var createdAt: Date
    public var updatedAt: Date
    /// The last successful map save.
    public var mapSavedAt: Date?
    /// "mapped" or "extending".
    public var mapStatusAtSave: String?
    public var lastRelocalizedAt: Date?

    public init(
        id: UUID = UUID(), name: String, rootAnchorId: UUID, placements: [ShelfPlacement] = [], createdAt: Date,
        updatedAt: Date? = nil
    ) {
        schema = Self.schemaID
        self.id = id
        self.name = name
        worldMapFile = Self.worldMapFileName
        self.rootAnchorId = rootAnchorId
        snapshotFile = nil
        self.placements = placements
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        mapSavedAt = nil
        mapStatusAtSave = nil
        lastRelocalizedAt = nil
    }

    public func placement(of trophy: UUID) -> ShelfPlacement? { placements.first { $0.trophyId == trophy } }

    /// Pins a trophy here, replacing its earlier placement on this shelf. Refused (false) when
    /// the shelf already holds 60 others.
    @discardableResult
    public mutating func pin(_ placement: ShelfPlacement, at date: Date) -> Bool {
        if let i = placements.firstIndex(where: { $0.trophyId == placement.trophyId }) {
            placements[i] = placement
        } else {
            guard placements.count < Self.maxPlacements else { return false }
            placements.append(placement)
        }
        updatedAt = max(updatedAt, date)
        return true
    }

    /// Removes a trophy's placement; true when there was one.
    @discardableResult
    public mutating func unpin(_ trophy: UUID, at date: Date) -> Bool {
        let before = placements.count
        placements.removeAll { $0.trophyId == trophy }
        guard placements.count != before else { return false }
        updatedAt = max(updatedAt, date)
        return true
    }

    /// Drops placements whose trophy is no longer in the collection (contracts.md §2.3, on load).
    /// Returns how many went.
    @discardableResult
    public mutating func dropPlacements(keeping trophies: Set<UUID>) -> Int {
        let before = placements.count
        placements.removeAll { !trophies.contains($0.trophyId) }
        return before - placements.count
    }

    public func validate() -> [String] {
        var issues: [String] = []
        if schema != Self.schemaID { issues.append("schema is \(schema), expected \(Self.schemaID)") }
        if name.isEmpty || name.count > Self.maxNameLength { issues.append("name has \(name.count) characters, expected 1...40") }
        if !Self.isPlainFileName(worldMapFile) { issues.append("worldMapFile is not a file name") }
        if let snapshotFile, !Self.isPlainFileName(snapshotFile) { issues.append("snapshotFile is not a file name") }
        if placements.count > Self.maxPlacements { issues.append("at most 60 placements") }
        if updatedAt < createdAt { issues.append("updatedAt is before createdAt") }
        if let status = mapStatusAtSave, !Self.savableMapStatuses.contains(status) {
            issues.append("mapStatusAtSave is \(status), expected mapped or extending")
        }
        var seen = Set<UUID>()
        for p in placements {
            if !seen.insert(p.trophyId).inserted { issues.append("trophy \(p.trophyId) is placed twice") }
            issues += p.validate()
        }
        return issues
    }

    static func isPlainFileName(_ name: String) -> Bool {
        !name.isEmpty && name != "." && name != ".." && !name.contains("/") && !name.contains("\\")
    }
}

/// One trophy on the shelf.
public struct ShelfPlacement: Codable, Sendable, Hashable {
    /// A `lupi.trophy.v1` id.
    public var trophyId: UUID
    /// Relative to the shelf root anchor.
    public var transform: RootTransform
    public var pinnedAt: Date
    /// A `scale` trophy's longest span, metres, with `transform.scale` 0 (scale-spec §7.5).
    public var spanMetres: Float?

    public init(trophyId: UUID, transform: RootTransform, pinnedAt: Date, spanMetres: Float? = nil) {
        self.trophyId = trophyId
        self.transform = transform
        self.pinnedAt = pinnedAt
        self.spanMetres = spanMetres
    }

    func validate() -> [String] {
        var issues: [String] = []
        let id = trophyId.uuidString
        let t = transform.translation
        if !(t.x.isFinite && t.y.isFinite && t.z.isFinite) { issues.append("\(id): translation is not finite") }
        let q = transform.rotation
        let norm = (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).squareRoot()
        if !(abs(norm - 1) < 1e-3) { issues.append("\(id): rotation is not a unit quaternion") }
        if transform.scale == 0 {
            if !(spanMetres.map { ScaleRefField.spanRange.contains($0) } ?? false) {
                issues.append("\(id): a placement at scale 0 needs spanMetres in 0.005...3")
            }
        } else if !(transform.scale > 0 && transform.scale.isFinite) {
            issues.append("\(id): scale must be positive, or 0 with spanMetres")
        }
        return issues
    }
}

/// A pose relative to the shelf root anchor.
public struct RootTransform: Codable, Sendable, Hashable {
    /// Metres, in the root anchor's frame.
    public var translation: SIMD3<Float>
    /// Unit quaternion `[x, y, z, w]`.
    public var rotation: SIMD4<Float>
    /// Toy scale, metres per ångström; 0 for a `scale` trophy (scale-spec §7.5).
    public var scale: Float

    public init(translation: SIMD3<Float>, rotation: SIMD4<Float>, scale: Float) {
        self.translation = translation
        self.rotation = rotation
        self.scale = scale
    }
}
