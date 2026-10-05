/// `lupi.scale-ref.v1` (§7): one piece, regenerable identically anywhere, forever.
public struct ScaleRef: Sendable, Hashable {
    public static let schema = "lupi.scale-ref.v1"
    public static let maxBytes = 163_840
    static let textPrefix = "lsr1:"

    public var root: NodeID
    /// Embedded records; encoded sorted by NodeID.
    public var records: [NodeRecord]
    /// contentIds of packs that hold the other records; encoded sorted.
    public var dependencies: [NodeID]
    public var path: Path
    /// Present exactly when the target is materializable.
    public var probe: NodeID?

    public init(root: NodeID, records: [NodeRecord] = [], dependencies: [NodeID] = [], path: Path = Path(), probe: NodeID? = nil) {
        self.root = root
        self.records = records
        self.dependencies = dependencies
        self.path = path
        self.probe = probe
    }

    // MARK: Encoding (§7.1)

    public var bytes: [UInt8] {
        var w = ByteWriter()
        w.ascii("LSR")
        w.u8(1)
        w.u8(probe == nil ? 0 : 1)
        let recs = Dictionary(records.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }).values.sorted { $0.id < $1.id }
        let deps = Array(Set(dependencies)).sorted()
        w.u8(UInt8(clamping: recs.count))
        w.u8(UInt8(clamping: deps.count))
        w.u8(0)
        w.append(root.bytes)
        for r in recs {
            w.u32(UInt32(r.bytes.count))
            w.append(r.bytes)
        }
        for d in deps { w.append(d.bytes) }
        Path.encode(path.steps, into: &w)
        if let p = probe { w.append(p.bytes) }
        return w.bytes
    }

    /// `lsr1:` followed by the base64url of the bytes.
    public var text: String { ScaleRef.textPrefix + Base64URL.encode(bytes) }

    /// refKey = SHA-256("lupi.scale.ref.v1" ‖ 0 ‖ root ‖ path bytes).
    public var key: NodeID { ScaleRef.refKey(root: root, path: path) }

    public static func refKey(root: NodeID, path: Path) -> NodeID {
        NodeID.hashing(domain: Domain.ref, root.bytes, path.bytes)
    }

    /// Throws `limit` past 163,840 bytes, 255 records or 255 dependencies.
    public func encoded() throws -> [UInt8] {
        let unique = Set(records.map(\.id)).count
        guard unique <= 255, Set(dependencies).count <= 255 else { throw fail(.limit, "at most 255 records and 255 dependencies") }
        let b = bytes
        guard b.count <= ScaleRef.maxBytes else { throw fail(.limit, "a reference is at most 163,840 bytes") }
        return b
    }

    // MARK: Decoding (§7.3, step 1)

    public init(bytes: [UInt8]) throws {
        guard bytes.count <= ScaleRef.maxBytes else { throw fail(.limit, "a reference is at most 163,840 bytes") }
        var r = ByteReader(bytes)
        guard try r.take(3) == Array("LSR".utf8) else { throw fail(.magic, "not a scale reference") }
        guard try r.u8() == 1 else { throw fail(.version, "reference version") }
        let flags = try r.u8()
        guard flags & ~1 == 0 else { throw fail(.canonical, "reference flags") }
        let recordCount = Int(try r.u8()), depCount = Int(try r.u8())
        try r.zeros(1)
        let root = try NodeID(bytes: r.take(32))
        var records: [NodeRecord] = []
        for i in 0..<recordCount {
            let length = Int(try r.u32())
            let rec = try NodeRecord(bytes: r.take(length))
            if i > 0 && !(records[i - 1].id < rec.id) { throw fail(.canonical, "embedded records ascend strictly") }
            records.append(rec)
        }
        var deps: [NodeID] = []
        for i in 0..<depCount {
            let d = try NodeID(bytes: r.take(32))
            if i > 0 && !(deps[i - 1] < d) { throw fail(.canonical, "dependencies ascend strictly") }
            deps.append(d)
        }
        let path = try Path.decode(&r)
        let probe = flags & 1 == 1 ? try NodeID(bytes: r.take(32)) : nil
        try r.done()
        self.init(root: root, records: records, dependencies: deps, path: path, probe: probe)
    }

    public init(text: String) throws {
        guard text.hasPrefix(ScaleRef.textPrefix) else { throw fail(.magic, "not lsr1: text") }
        guard let b = Base64URL.decode(String(text.dropFirst(ScaleRef.textPrefix.count))) else {
            throw fail(.canonical, "base64url")
        }
        try self.init(bytes: b)
    }

    // MARK: Resolving (§7.3)

    /// Resolves from the embedded records plus `extra` (the records of available packs).
    public func resolve(extra: (any NodeStore)?) throws -> (view: View, count: Magnitude) {
        let r = resolver(extra: extra)
        let view = try r.resolve(root, path)
        let materializable = r.isMaterializable(view)
        if materializable != (probe != nil) { throw fail(.mismatch, "probe present exactly when materializable") }
        if let p = probe, try r.probe(view) != p { throw fail(.mismatch, "the probe does not match the regenerated leaf") }
        return (view, try r.count(view))
    }

    /// A resolver over the embedded records and `extra`.
    public func resolver(extra: (any NodeStore)?) -> Resolver {
        let embedded = RecordStore(records)
        return Resolver(store: extra.map { StoreUnion([embedded, $0]) } ?? embedded)
    }

    // MARK: Writing (§7.2)

    /// Keeps the piece at `path` below `root`, embedding every record its resolution reads.
    /// A piece of more than 4,096 atoms may leave leaf and group records to the packs that
    /// `packOf` names. When the result passes the limits, a piece of at most 4,096 atoms is
    /// kept as its own leaf; anything else is `limit` ("This piece is too intricate to keep").
    public static func keep(root: NodeID, path: Path, store: any NodeStore, packOf: [NodeID: NodeID] = [:]) throws -> ScaleRef {
        let recording = RecordingStore(store)
        let r = Resolver(store: recording)
        let view = try r.resolve(root, path)
        let count = try r.count(view)
        let materializable = r.isMaterializable(view)
        let probe = materializable ? try r.probe(view) : nil
        var records = recording.read
        var deps: Set<NodeID> = []
        let small = count.plain.map { $0 <= BigUInt(RecordLimits.maxAtoms) } ?? false
        if !small {
            records = records.filter { rec in
                guard let pack = packOf[rec.id], rec.kindByte == NodeKind.leaf.rawValue || rec.kindByte == NodeKind.group.rawValue else {
                    return true
                }
                deps.insert(pack)
                return false
            }
        }
        let ref = ScaleRef(root: root, records: records, dependencies: Array(deps), path: path, probe: probe)
        if (try? ref.encoded()) != nil { return ref }
        guard small, materializable else { throw fail(.limit, "This piece is too intricate to keep") }
        let leaf = try NodeRecord(.leaf(r.materialize(view)))
        return ScaleRef(root: leaf.id, records: [leaf], path: Path(), probe: leaf.id)
    }
}
