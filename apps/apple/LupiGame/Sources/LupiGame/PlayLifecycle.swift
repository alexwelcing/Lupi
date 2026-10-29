/// Identifies asynchronous AR transitions. Only the most recent request may publish its result.
public struct PlayLifecycle: Sendable {
    public enum Phase: Sendable, Equatable { case idle, active, suspended, stopped }
    public struct Request: Sendable, Equatable {
        public let generation: UInt64
        public let phase: Phase
    }
    public private(set) var phase: Phase = .idle
    public private(set) var generation: UInt64 = 0

    public init() {}

    /// Stop is terminal for this controller; a new Play screen gets a new lifecycle.
    public mutating func request(_ next: Phase) -> Request? {
        guard phase != .stopped else { return nil }
        generation &+= 1
        phase = next
        return Request(generation: generation, phase: next)
    }

    public func accepts(_ request: Request) -> Bool {
        generation == request.generation && phase == request.phase
    }
}
