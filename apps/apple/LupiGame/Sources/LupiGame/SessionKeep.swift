import Foundation
import LupiChem
import LupiData
import LupiScale
import LupiScaleCore

/// Where a kept body sits, for its shelf placement (contracts.md §2): the entity's world pose
/// (its node's local centre) and its size.
public struct KeptPose: Sendable, Equatable {
    public var entity: RigidD
    /// Metres per ångström, or 0 for a `scale` trophy (scale-spec §7.5).
    public var scale: Float
    /// Longest displayed span, metres.
    public var spanMetres: Float

    public init(entity: RigidD, scale: Float, spanMetres: Float) {
        self.entity = entity
        self.scale = scale
        self.spanMetres = spanMetres
    }
}

extension PlaySession {
    /// Keeps a body (plan §6.3, contracts.md §1): the trophy record to save. Any body can be kept,
    /// whatever its count. A body that already is a trophy keeps its id, with its size brought up
    /// to date; a copy of a deleted trophy becomes a new one.
    public mutating func keep(_ id: BodyID, trophyID: UUID = UUID(), name: String? = nil, now: Date) throws -> TrophyRecord {
        guard var b = bodies[id] else { throw KeepError.noSuchBody }
        if case let .trophy(kept) = b.provenance, b.trophyID == nil {
            var copy = kept
            copy.id = trophyID
            copy.createdAt = Keep.millisecond(now)
            copy.updatedAt = copy.createdAt
            copy.deletedAt = nil
            b.provenance = .trophy(copy)
        }
        let record = try Keep.record(for: b, id: trophyID, name: name, now: now, sessionTime: time ?? b.bornAt, resolver: resolver)
        b.provenance = .trophy(record)
        b.trophyID = record.id
        b.name = record.name
        bodies[id] = b
        hudCache.dirty = true
        return record
    }

    /// The body now sits on a shelf (plan §6.3): outside the loose-toy budget.
    public mutating func pin(_ id: BodyID) {
        bodies[id]?.pinned = true
    }

    /// The bodies in play that are this trophy.
    public func bodies(of trophy: UUID) -> [BodyID] {
        bodyOrder.filter { bodies[$0]?.trophyID == trophy }
    }

    /// A trophy changed elsewhere (renamed, or synced from another device): its bodies take the record.
    public mutating func refresh(_ trophy: TrophyRecord) {
        for id in bodies(of: trophy.id) {
            bodies[id]?.provenance = .trophy(trophy)
            bodies[id]?.name = trophy.name
        }
    }

    /// The trophy left the collection: its bodies stay in play as copies, and keeping one makes a
    /// new trophy.
    public mutating func forget(trophy: UUID) {
        for id in bodies(of: trophy) {
            bodies[id]?.trophyID = nil
            bodies[id]?.pinned = false
        }
    }

    /// The pose and size a placement records.
    public func keptPose(_ id: BodyID) -> KeptPose? {
        guard let b = bodies[id] else { return nil }
        let isScale: Bool
        if case let .trophy(t) = b.provenance { isScale = t.molecule.source == .scale } else { isScale = false }
        return KeptPose(
            entity: b.entityPose, scale: isScale ? 0 : Keep.lookScale(b, resolver: resolver), spanMetres: Keep.span(b, resolver: resolver)
        )
    }

    /// Where a body's stack meets a shelf, when it does (plan §6.3); nil on the floor.
    public func shelfSupport(of id: BodyID) -> Vec3? {
        bodies[id].flatMap { shelfSupport(of: $0) }
    }

    /// Every body that is a trophy, with its trophy.
    public func trophyBodies() -> [(body: BodyID, trophy: UUID)] {
        bodyOrder.compactMap { id in bodies[id]?.trophyID.map { (id, $0) } }
    }
}
