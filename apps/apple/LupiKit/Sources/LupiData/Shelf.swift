import Foundation
import LupiChem

/// `lupi.shelf.v1`: where trophies sit on one real shelf, as transforms
/// relative to a shelf-root anchor. Re-placing the root restores the whole
/// arrangement. It never holds the room map: the ARWorldMap that finds the
/// root is a separate file on the device (D7), and a shelf can be shared or
/// backed up without it.
public struct Shelf: Sendable, Equatable, Codable, Identifiable {
    public static let schemaID = "lupi.shelf.v1"

    public var schema: String
    /// A lowercase UUID.
    public var id: String
    public var name: String
    /// The name of the ARAnchor the arrangement hangs from.
    public var rootAnchor: String
    public var placements: [Placement]
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: String = UUID().uuidString.lowercased(), name: String, rootAnchor: String, placements: [Placement] = [],
        createdAt: Date = Date(), updatedAt: Date? = nil
    ) {
        schema = Self.schemaID
        self.id = id
        self.name = name
        self.rootAnchor = rootAnchor
        self.placements = placements
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
    }

    public func validate() -> [String] {
        var issues: [String] = []
        if schema != Self.schemaID { issues.append("schema is \(schema), expected \(Self.schemaID)") }
        if id.isEmpty { issues.append("id is empty") }
        if rootAnchor.isEmpty { issues.append("rootAnchor is empty") }
        var seen = Set<String>()
        for placement in placements {
            if !seen.insert(placement.trophyId).inserted { issues.append("trophy \(placement.trophyId) is placed twice") }
            issues += placement.validate()
        }
        return issues
    }
}

/// One trophy's pose on the shelf.
public struct Placement: Sendable, Equatable, Codable {
    public var trophyId: String
    /// Metres, in the shelf root's frame. Encoded `[x, y, z]`.
    public var position: Vec3
    /// Unit quaternion. Encoded `[x, y, z, w]`.
    public var rotation: Quat
    /// The player's grow/shrink on top of the molecule's magnification (1 = 10⁸×).
    public var displayScale: Double
    public var placedAt: Date

    public init(trophyId: String, position: Vec3, rotation: Quat = .identity, displayScale: Double = 1, placedAt: Date = Date()) {
        self.trophyId = trophyId
        self.position = position
        self.rotation = rotation
        self.displayScale = displayScale
        self.placedAt = placedAt
    }

    private enum CodingKeys: String, CodingKey { case trophyId, position, rotation, displayScale, placedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        trophyId = try c.decode(String.self, forKey: .trophyId)
        let p = try c.decode([Double].self, forKey: .position)
        let r = try c.decode([Double].self, forKey: .rotation)
        guard p.count == 3 else {
            throw DecodingError.dataCorruptedError(forKey: .position, in: c, debugDescription: "position is [x, y, z]")
        }
        guard r.count == 4 else {
            throw DecodingError.dataCorruptedError(forKey: .rotation, in: c, debugDescription: "rotation is [x, y, z, w]")
        }
        position = Vec3(p[0], p[1], p[2])
        rotation = Quat(x: r[0], y: r[1], z: r[2], w: r[3])
        displayScale = try c.decode(Double.self, forKey: .displayScale)
        placedAt = try c.decode(Date.self, forKey: .placedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(trophyId, forKey: .trophyId)
        try c.encode([position.x, position.y, position.z], forKey: .position)
        try c.encode([rotation.x, rotation.y, rotation.z, rotation.w], forKey: .rotation)
        try c.encode(displayScale, forKey: .displayScale)
        try c.encode(placedAt, forKey: .placedAt)
    }

    func validate() -> [String] {
        var issues: [String] = []
        if trophyId.isEmpty { issues.append("a placement has no trophyId") }
        if ![position.x, position.y, position.z].allSatisfy(\.isFinite) { issues.append("\(trophyId): position is not finite") }
        let q = rotation
        let norm = (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).squareRoot()
        if !(abs(norm - 1) < 1e-3) { issues.append("\(trophyId): rotation is not a unit quaternion") }
        if !(displayScale > 0 && displayScale.isFinite) { issues.append("\(trophyId): displayScale must be positive") }
        return issues
    }
}
