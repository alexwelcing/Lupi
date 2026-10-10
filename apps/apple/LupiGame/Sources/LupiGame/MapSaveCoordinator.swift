import Foundation

/// Associates asynchronous map work with the room, root and request that began it.
/// The host must check `accepts` after its awaits and before writing or publishing a
/// result. Canceling an ARKit request alone cannot keep a late callback from arriving.
public struct MapSaveCoordinator: Sendable, Equatable {
    public struct Request: Sendable, Equatable {
        public let roomID: UUID
        public let rootAnchorID: UUID
        public let generation: UInt64
        public let sequence: UInt64
    }

    public private(set) var policy = MapSavePolicy()
    public private(set) var roomID: UUID?
    public private(set) var rootAnchorID: UUID?
    public private(set) var request: Request?
    public private(set) var generation: UInt64 = 0
    private var sequence: UInt64 = 0

    public init() {}

    /// Opening even the same room again starts a different session generation.
    /// Call this after a root is replaced too, before requesting its next map.
    public mutating func activate(roomID: UUID, rootAnchorID: UUID) {
        invalidate()
        self.roomID = roomID
        self.rootAnchorID = rootAnchorID
    }

    /// A room change, deletion or stopped/reset AR session abandons its pending work.
    public mutating func invalidate() {
        generation &+= 1
        roomID = nil
        rootAnchorID = nil
        request = nil
        policy = MapSavePolicy()
    }

    public mutating func pinned(at t: Double) {
        guard roomID != nil else { return }
        policy.pinned(at: t)
    }

    public mutating func saveSoon(at t: Double) {
        guard roomID != nil else { return }
        policy.saveSoon(at: t)
    }

    public func needsCoverage(at t: Double, mapping: MappingInput) -> Bool {
        roomID != nil && policy.needsCoverage(at: t, mapping: mapping)
    }

    /// Only one request in the current generation can be active at a time.
    public mutating func begin(at t: Double, mapping: MappingInput) -> Request? {
        guard request == nil, policy.shouldSave(at: t, mapping: mapping),
              let roomID, let rootAnchorID else { return nil }
        sequence &+= 1
        let token = Request(roomID: roomID, rootAnchorID: rootAnchorID,
                            generation: generation, sequence: sequence)
        request = token
        policy.began()
        return token
    }

    public func accepts(_ token: Request) -> Bool {
        request == token && roomID == token.roomID && rootAnchorID == token.rootAnchorID
            && generation == token.generation
    }

    /// False means a stale or duplicate completion; the caller must leave the active
    /// room's probe, snapshot and shelf untouched in both success and failure paths.
    @discardableResult
    public mutating func finish(_ token: Request, at t: Double, saved: Bool) -> Bool {
        guard accepts(token) else { return false }
        request = nil
        policy.finished(at: t, saved: saved)
        return true
    }
}
