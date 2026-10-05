import Foundation

/// Where a resolver finds records by NodeID (§4.6). A missing record is the error `missing`.
public protocol NodeStore: Sendable {
    func record(_ id: NodeID) throws -> NodeRecord
}

/// Records in memory.
public struct RecordStore: NodeStore {
    public private(set) var records: [NodeID: NodeRecord]

    public init(_ records: [NodeRecord] = []) {
        var map: [NodeID: NodeRecord] = [:]
        for r in records { map[r.id] = r }
        self.records = map
    }

    public mutating func add(_ record: NodeRecord) { records[record.id] = record }

    public mutating func add(_ more: [NodeRecord]) { for r in more { records[r.id] = r } }

    public func record(_ id: NodeID) throws -> NodeRecord {
        guard let r = records[id] else { throw fail(.missing, "node \(id.hex.prefix(16))…") }
        return r
    }
}

/// The first store that has a record wins.
public struct StoreUnion: NodeStore {
    public var stores: [any NodeStore]

    public init(_ stores: [any NodeStore]) { self.stores = stores }

    public func record(_ id: NodeID) throws -> NodeRecord {
        for s in stores {
            do { return try s.record(id) } catch let e as ScaleError where e.code == .missing { continue }
        }
        throw fail(.missing, "node \(id.hex.prefix(16))…")
    }
}

/// A store that remembers every record it hands out: what a resolution read (§4.6, §7.2).
public final class RecordingStore: NodeStore, @unchecked Sendable {
    private let base: any NodeStore
    private let lock = NSLock()
    private var seen: [NodeID: NodeRecord] = [:]

    public init(_ base: any NodeStore) { self.base = base }

    public func record(_ id: NodeID) throws -> NodeRecord {
        let r = try base.record(id)
        lock.lock()
        seen[id] = r
        lock.unlock()
        return r
    }

    public var read: [NodeRecord] {
        lock.lock()
        defer { lock.unlock() }
        return Array(seen.values)
    }
}
