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

/// A keep prepared without changing play. The app persists `record` before committing it.
/// Retaining this value across a failed write keeps the retry's UUID stable.
public struct PreparedKeep: Sendable {
    public let bodyID: BodyID
    public let record: TrophyRecord
    public let priorTrophyID: UUID?
    public var priorRecord: TrophyRecord? {
        guard priorTrophyID != nil, case let .trophy(record) = provenance else { return nil }
        return record
    }
    fileprivate let identity: ScaleRef
    fileprivate let provenance: Provenance
    fileprivate let sigma: Double
    fileprivate let frameRef: ScaleRef
    fileprivate let anchorPath: [Step]
}

extension PlaySession {
    /// Keeps a body (plan §6.3, contracts.md §1): the trophy record to save. Any body can be kept,
    /// whatever its count. A body that already is a trophy keeps its id, with its size brought up
    /// to date; a copy of a deleted trophy becomes a new one.
    public func prepareKeep(_ id: BodyID, trophyID: UUID = UUID(), name: String? = nil, now: Date) throws -> PreparedKeep {
        guard var b = bodies[id] else { throw KeepError.noSuchBody }
        let original = b
        if case let .trophy(kept) = b.provenance, b.trophyID == nil {
            var copy = kept
            copy.id = trophyID
            copy.createdAt = Keep.millisecond(now)
            copy.updatedAt = copy.createdAt
            copy.deletedAt = nil
            b.provenance = .trophy(copy)
        }
        let record = try Keep.record(for: b, id: trophyID, name: name, now: now, sessionTime: time ?? b.bornAt, resolver: resolver)
        return PreparedKeep(bodyID: id, record: record, priorTrophyID: original.trophyID,
                            identity: original.identity, provenance: original.provenance, sigma: original.sigma,
                            frameRef: original.frame.ref, anchorPath: original.frame.anchorPath)
    }

    /// A delayed save must not attach to a removed, rebuilt, resized or forgotten body.
    public func canCommitKeep(_ prepared: PreparedKeep, allowingResize: Bool = false) -> Bool {
        guard let b = bodies[prepared.bodyID] else { return false }
        return b.identity == prepared.identity && b.provenance == prepared.provenance &&
            b.trophyID == prepared.priorTrophyID && (allowingResize ||
                (b.sigma == prepared.sigma && b.frame.ref == prepared.frameRef && b.frame.anchorPath == prepared.anchorPath))
    }

    /// Called only after a durable save. A shelf keep can defer the celebration until its
    /// placement also succeeds.
    @discardableResult
    public mutating func commitKeep(_ prepared: PreparedKeep, celebrate: Bool = true, allowingResize: Bool = false) -> Bool {
        guard canCommitKeep(prepared, allowingResize: allowingResize), var b = bodies[prepared.bodyID] else { return false }
        b.provenance = .trophy(prepared.record)
        b.trophyID = prepared.record.id
        b.name = prepared.record.name
        bodies[b.id] = b
        hudCache.dirty = true
        // The lime ring and the kept chime (plan §5.3).
        if celebrate { celebrateKeep(b.id, trophyID: prepared.record.id) }
        return true
    }

    /// A durable collection record and shelf placement may finish at different times.
    public mutating func celebrateKeep(_ id: BodyID, trophyID: UUID) {
        guard let b = bodies[id], b.trophyID == trophyID, let now = time else { return }
        fire(.kept, on: b, at: b.entityPose.translation, direction: .zero, now: now)
    }

    /// Synchronous convenience for callers that own persistence themselves.
    public mutating func keep(_ id: BodyID, trophyID: UUID = UUID(), name: String? = nil, now: Date) throws -> TrophyRecord {
        let prepared = try prepareKeep(id, trophyID: trophyID, name: name, now: now)
        _ = commitKeep(prepared)
        return prepared.record
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
