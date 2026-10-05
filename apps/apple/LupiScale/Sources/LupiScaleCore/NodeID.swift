/// A node's identity: the SHA-256 of its record (§2.1). Also the type of
/// every other 32-byte hash the spec names (refKey, contentId, probe).
public struct NodeID: Hashable, Comparable, Sendable, CustomStringConvertible {
    public let bytes: [UInt8]

    /// Exactly 32 bytes, else `range`.
    public init(bytes: [UInt8]) throws {
        guard bytes.count == 32 else { throw fail(.range, "a NodeID is 32 bytes") }
        self.bytes = bytes
    }

    init(unchecked bytes: [UInt8]) { self.bytes = bytes }

    /// Lowercase or uppercase hex of 32 bytes.
    public init?(hex: String) {
        guard let b = Hex.decode(hex), b.count == 32 else { return nil }
        bytes = b
    }

    /// The SHA-256 of `data`.
    public static func hashing(_ data: [UInt8]) -> NodeID {
        NodeID(unchecked: SHA256Hasher.hash(data))
    }

    /// SHA-256 of a domain string (with its zero byte) followed by `parts` (§1.5).
    public static func hashing(domain: String, _ parts: [UInt8]...) -> NodeID {
        var h = SHA256Hasher()
        h.update(domain: domain)
        for p in parts { h.update(p) }
        return NodeID(unchecked: h.finalize())
    }

    public var hex: String { Hex.encode(bytes) }

    public var description: String { hex }

    /// The first 8 bytes as a little-endian u64: copy keys (§3.4.5) and display keys (§9.7).
    public var leadingUInt64: UInt64 {
        var v: UInt64 = 0
        for i in 0..<8 { v |= UInt64(bytes[i]) << UInt64(8 * i) }
        return v
    }

    public static func < (a: NodeID, b: NodeID) -> Bool { compareBytes(a.bytes, b.bytes) < 0 }
}

/// Domain strings of §1.5.
enum Domain {
    static let copy = "lupi.scale.copy.v1"
    static let ref = "lupi.scale.ref.v1"
    static let pack = "lupi.pack.v1"
}
