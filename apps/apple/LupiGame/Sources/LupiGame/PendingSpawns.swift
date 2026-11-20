/// Spawn requests made while room tracking is not ready. Clear discards every kind of intent.
public struct PendingSpawns: Sendable {
    public private(set) var sources: [SpawnSource] = []
    public private(set) var atoms: [Int] = []
    public private(set) var receipt = false

    public init() {}
    public mutating func enqueue(_ source: SpawnSource) { sources.append(source) }
    public mutating func enqueueAtom(_ z: Int) { atoms.append(z) }
    public mutating func enqueueReceipt() { receipt = true }
    public mutating func clear() { self = PendingSpawns() }

    public mutating func drain() -> PendingSpawns {
        let requests = self
        clear()
        return requests
    }
}
