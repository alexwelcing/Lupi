import Foundation
import LupiScaleCore

/// The cut's resident data (§9.6), keyed by values that hash without forming text: seed-copy
/// materializations by their exact path, and start nodes' refKeys by root and steps. One per
/// resolver, shared by every frame.
final class ResidentStore: @unchecked Sendable {
    /// A tower level base: the tower and its digits from the top.
    struct BaseID: Hashable {
        var tower: NodeID
        var runs: [[DigitRun]]
    }

    /// A seed copy: its base, and the digits below it as `axis × 16 + digit`.
    struct CopyID: Hashable {
        var base: Int32
        var digits: [UInt8]
    }

    struct RefID: Hashable {
        var root: NodeID
        var steps: [Step]
    }

    private let lock = NSLock()
    private var bases: [BaseID: Int32] = [:]
    private var copies: [CopyID: LeafNode] = [:]
    private var refKeys: [RefID: UInt64] = [:]

    static func of(_ r: Resolver) -> ResidentStore { r.cached("lupi.scale.resident") { ResidentStore() } }

    func base(_ id: BaseID) -> Int32 {
        lock.withLock {
            if let i = bases[id] { return i }
            let i = Int32(bases.count)
            bases[id] = i
            return i
        }
    }

    func copy(_ id: CopyID) -> LeafNode? { lock.withLock { copies[id] } }
    func setCopy(_ id: CopyID, _ leaf: LeafNode) { lock.withLock { copies[id] = leaf } }
    func refKey(_ id: RefID) -> UInt64? { lock.withLock { refKeys[id] } }
    func setRefKey(_ id: RefID, _ key: UInt64) { lock.withLock { refKeys[id] = key } }
}
