/// Record kinds (§2.1).
public enum NodeKind: UInt8, Sendable {
    case leaf = 1, group, crystal, tower, edit
}

/// Kind 1: explicit atoms in source order (§2.2).
public struct LeafNode: Sendable, Hashable {
    public var atomicNumbers: [UInt8]
    public var positions: [SIMD3<Float>]

    public init(atomicNumbers: [UInt8], positions: [SIMD3<Float>]) {
        self.atomicNumbers = atomicNumbers
        self.positions = positions
    }

    public var count: Int { atomicNumbers.count }
}

/// A child of a group: `x_group = R(q)·x + t` (§2.3). `rotation` is (qx, qy, qz, qw).
public struct GroupChild: Sendable, Hashable {
    public var id: NodeID
    public var rotation: SIMD4<Double>
    public var translation: SIMD3<Double>

    public init(id: NodeID, rotation: SIMD4<Double> = SIMD4(0, 0, 0, 1), translation: SIMD3<Double> = .zero) {
        self.id = id
        self.rotation = rotation
        self.translation = translation
    }
}

/// Kind 3: a lattice generator (§2.4, §3.3).
public struct CrystalNode: Sendable, Hashable {
    public enum Structure: UInt8, Sendable { case sc = 1, bcc, fcc, diamond, rocksalt }
    public enum Termination: UInt8, Sendable { case open = 0, closed, capped }

    public var structure: Structure
    public var termination: Termination
    public var speciesA: UInt8
    public var speciesB: UInt8
    public var quarterQ16: UInt32
    public var cells: SIMD3<UInt64>
    public var capZ: UInt8
    public var capOffsetQ16: UInt32

    public init(
        structure: Structure, termination: Termination, speciesA: UInt8, speciesB: UInt8 = 0,
        quarterQ16: UInt32, cells: SIMD3<UInt64>, capZ: UInt8 = 0, capOffsetQ16: UInt32 = 0
    ) {
        self.structure = structure
        self.termination = termination
        self.speciesA = speciesA
        self.speciesB = speciesB
        self.quarterQ16 = quarterQ16
        self.cells = cells
        self.capZ = capZ
        self.capOffsetQ16 = capOffsetQ16
    }
}

/// The dopant substitution of a tower (§2.5, §3.4.6).
public struct Substitution: Sendable, Hashable {
    public var fromZ: UInt8
    public var toZ: UInt8
    public var perCopy: UInt16

    public init(fromZ: UInt8, toZ: UInt8, perCopy: UInt16) {
        self.fromZ = fromZ
        self.toZ = toZ
        self.perCopy = perCopy
    }
}

/// Kind 4: a self-similar generator (§2.5, §3.4).
public struct TowerNode: Sendable, Hashable {
    public var seed: NodeID
    public var factor: UInt8
    /// Three periods, Q16 in the seed's frame.
    public var periodsQ16: [SIMD3<Int64>]
    public var levels: BigUInt
    public var substitution: Substitution?

    public init(seed: NodeID, factor: UInt8, periodsQ16: [SIMD3<Int64>], levels: BigUInt, substitution: Substitution? = nil) {
        self.seed = seed
        self.factor = factor
        self.periodsQ16 = periodsQ16
        self.levels = levels
        self.substitution = substitution
    }
}

/// Kind 5: a node with pieces removed (§2.6, §3.5).
public struct EditNode: Sendable, Hashable {
    public var base: NodeID
    public var removed: [Path]

    public init(base: NodeID, removed: [Path]) {
        self.base = base
        self.removed = removed
    }
}

public enum Node: Sendable, Hashable {
    case leaf(LeafNode)
    case group([GroupChild])
    case crystal(CrystalNode)
    case tower(TowerNode)
    case edit(EditNode)

    public var kind: NodeKind {
        switch self {
        case .leaf: .leaf
        case .group: .group
        case .crystal: .crystal
        case .tower: .tower
        case .edit: .edit
        }
    }
}

/// Limits of §1.9 that records obey.
public enum RecordLimits {
    public static let maxRecordBytes = 65_536
    public static let maxAtoms = 4_096
    public static let maxDepth = 64
    public static let positionLimit: Float = 1_048_576          // 2^20 Å
    public static let maxChildren = 256
    public static let translationLimit: Double = 1_099_511_627_776   // 2^40 Å
    public static let maxCells: UInt64 = 1 << 60
    public static let maxAspect: UInt64 = 1 << 16
    public static let maxQuarter: UInt32 = 1 << 20
    public static let maxCapped: UInt64 = 12
    public static let periodLimit: Int64 = 1 << 40
    public static let maxRemovals = 256
}

/// A node record: its bytes, NodeID and decoded node (§2).
public struct NodeRecord: Sendable, Hashable {
    public let bytes: [UInt8]
    public let id: NodeID
    /// nil for an unknown kind or kind version, which stays opaque (§2.7).
    public let node: Node?

    /// Encodes and validates every rule of §2 that needs no other record.
    public init(_ node: Node) throws {
        var body = ByteWriter()
        switch node {
        case let .leaf(leaf): try NodeRecord.encodeLeaf(leaf, &body)
        case let .group(children): try NodeRecord.encodeGroup(children, &body)
        case let .crystal(c): try NodeRecord.encodeCrystal(c, &body)
        case let .tower(t): try NodeRecord.encodeTower(t, &body)
        case let .edit(e): try NodeRecord.encodeEdit(e, &body)
        }
        var w = ByteWriter(capacity: 12 + body.count)
        w.ascii("LUPN")
        w.u8(node.kind.rawValue)
        w.u8(1)
        w.u16(0)
        w.u32(UInt32(body.count))
        w.append(body.bytes)
        if w.count > RecordLimits.maxRecordBytes { throw fail(.limit, "record longer than 65,536 bytes") }
        // Decoding back gives the canonical node (a flipped quaternion, sorted removals).
        self = try NodeRecord(bytes: w.bytes)
    }

    /// Decodes and validates (§2). Unknown kinds and versions stay opaque.
    public init(bytes: [UInt8]) throws {
        if bytes.count > RecordLimits.maxRecordBytes { throw fail(.limit, "record longer than 65,536 bytes") }
        var r = ByteReader(bytes)
        guard try r.take(4) == Array("LUPN".utf8) else { throw fail(.magic, "record magic") }
        let kind = try r.u8()
        let version = try r.u8()
        let flags = try r.u16()
        let length = Int(try r.u32())
        guard 12 + length == bytes.count else {
            throw fail(12 + length > bytes.count ? .truncated : .canonical, "bodyLength does not match the record")
        }
        self.bytes = bytes
        self.id = NodeID.hashing(bytes)
        guard let k = NodeKind(rawValue: kind), version == 1 else {
            // Opaque (§2.7): only its NodeID is ever checked.
            self.node = nil
            return
        }
        guard flags == 0 else { throw fail(.canonical, "record flags") }
        let node: Node
        switch k {
        case .leaf: node = .leaf(try NodeRecord.decodeLeaf(&r))
        case .group: node = .group(try NodeRecord.decodeGroup(&r))
        case .crystal: node = .crystal(try NodeRecord.decodeCrystal(&r))
        case .tower: node = .tower(try NodeRecord.decodeTower(&r))
        case .edit: node = .edit(try NodeRecord.decodeEdit(&r))
        }
        try r.done()
        self.node = node
    }

    /// Byte 4 of the record.
    public var kindByte: UInt8 { bytes[4] }
    /// Byte 5 of the record.
    public var kindVersion: UInt8 { bytes[5] }

    public static func == (a: NodeRecord, b: NodeRecord) -> Bool { a.id == b.id }
    public func hash(into h: inout Hasher) { h.combine(id) }

    // MARK: Leaf

    static func encodeLeaf(_ leaf: LeafNode, _ w: inout ByteWriter) throws {
        let n = leaf.atomicNumbers.count
        guard n >= 1, n <= RecordLimits.maxAtoms else { throw fail(.limit, "a leaf holds 1 to 4,096 atoms") }
        guard leaf.positions.count == n else { throw fail(.range, "one position per atom") }
        w.u32(UInt32(n))
        for z in leaf.atomicNumbers {
            guard z >= 1, z <= 118 else { throw fail(.range, "atomic number \(z)") }
            w.u8(z)
        }
        while (12 + w.count) % 4 != 0 { w.u8(0) }
        for p in leaf.positions {
            for v in [p.x, p.y, p.z] {
                guard v.isFinite, abs(v) <= RecordLimits.positionLimit else { throw fail(.range, "leaf coordinate beyond 2^20 Å") }
                try w.f32(v)
            }
        }
    }

    static func decodeLeaf(_ r: inout ByteReader) throws -> LeafNode {
        let n = Int(try r.u32())
        guard n >= 1, n <= RecordLimits.maxAtoms else { throw fail(.limit, "a leaf holds 1 to 4,096 atoms") }
        let z = try r.take(n)
        for v in z where v < 1 || v > 118 { throw fail(.range, "atomic number \(v)") }
        try r.pad(toMultipleOf: 4)
        var positions: [SIMD3<Float>] = []
        positions.reserveCapacity(n)
        for _ in 0..<n {
            let x = try r.f32(), y = try r.f32(), zz = try r.f32()
            for v in [x, y, zz] where abs(v) > RecordLimits.positionLimit { throw fail(.range, "leaf coordinate beyond 2^20 Å") }
            positions.append(SIMD3(x, y, zz))
        }
        return LeafNode(atomicNumbers: z, positions: positions)
    }

    // MARK: Group

    /// Writers negate a non-canonical quaternion (§2.3); +0 replaces −0.
    static func canonicalQuaternion(_ q: SIMD4<Double>) -> SIMD4<Double> {
        var out = q
        if !quaternionIsCanonical(q) { out = -q }
        return SIMD4(out.x + 0, out.y + 0, out.z + 0, out.w + 0)
    }

    static func quaternionIsCanonical(_ q: SIMD4<Double>) -> Bool {
        if q.w > 0 { return true }
        if q.w < 0 { return false }
        for v in [q.x, q.y, q.z] where v != 0 { return v > 0 }
        return false
    }

    static func checkQuaternion(_ q: SIMD4<Double>) throws {
        let s = ((q.x * q.x + q.y * q.y) + q.z * q.z) + q.w * q.w
        guard abs(s - 1) <= 0x1p-30 else { throw fail(.range, "rotation is not a unit quaternion") }
        guard quaternionIsCanonical(q) else { throw fail(.canonical, "rotation sign is not canonical") }
    }

    static func encodeGroup(_ children: [GroupChild], _ w: inout ByteWriter) throws {
        guard children.count >= 1, children.count <= RecordLimits.maxChildren else {
            throw fail(.limit, "a group holds 1 to 256 children")
        }
        w.u16(UInt16(children.count))
        w.u16(0)
        for c in children {
            let q = canonicalQuaternion(c.rotation)
            try checkQuaternion(q)
            for v in [c.translation.x, c.translation.y, c.translation.z] where !(abs(v) <= RecordLimits.translationLimit) {
                throw fail(.range, "translation beyond 2^40 Å")
            }
            w.append(c.id.bytes)
            for v in [q.x, q.y, q.z, q.w] { try w.f64(v) }
            for v in [c.translation.x, c.translation.y, c.translation.z] { try w.f64(v) }
        }
    }

    static func decodeGroup(_ r: inout ByteReader) throws -> [GroupChild] {
        let c = Int(try r.u16())
        try r.zeros(2)
        guard c >= 1, c <= RecordLimits.maxChildren else { throw fail(.limit, "a group holds 1 to 256 children") }
        var out: [GroupChild] = []
        out.reserveCapacity(c)
        for _ in 0..<c {
            let id = NodeID(unchecked: try r.take(32))
            let q = SIMD4(try r.f64(), try r.f64(), try r.f64(), try r.f64())
            let t = SIMD3(try r.f64(), try r.f64(), try r.f64())
            try checkQuaternion(q)
            for v in [t.x, t.y, t.z] where abs(v) > RecordLimits.translationLimit { throw fail(.range, "translation beyond 2^40 Å") }
            out.append(GroupChild(id: id, rotation: q, translation: t))
        }
        return out
    }

    // MARK: Crystal

    static func validateCrystal(_ c: CrystalNode) throws {
        let s = c.structure, t = c.termination
        guard c.speciesA >= 1, c.speciesA <= 118 else { throw fail(.range, "speciesA") }
        guard c.speciesB <= 118 else { throw fail(.range, "speciesB") }
        if (s == .sc || s == .fcc) && c.speciesB != 0 { throw fail(.canonical, "sc and fcc have no second species") }
        if s == .rocksalt && c.speciesB == 0 { throw fail(.canonical, "rock salt needs speciesB") }
        guard c.quarterQ16 >= 1, c.quarterQ16 <= RecordLimits.maxQuarter else { throw fail(.range, "quarter") }
        let n = [c.cells.x, c.cells.y, c.cells.z]
        for v in n where v < 1 || v > RecordLimits.maxCells { throw fail(.range, "cells per axis 1 to 2^60") }
        let mx = n.max()!, mn = n.min()!
        // mn ≤ 2^60, so 2^16 · mn cannot overflow.
        if mx > RecordLimits.maxAspect * mn { throw fail(.limit, "crystal aspect above 2^16") }
        if t == .capped {
            if s != .diamond { throw fail(.canonical, "capped crystals are diamond") }
            if n[0] != n[1] || n[1] != n[2] { throw fail(.canonical, "capped crystals have n0 = n1 = n2") }
            if n[0] > RecordLimits.maxCapped { throw fail(.limit, "capped crystals have m ≤ 12") }
            guard c.capZ >= 1, c.capZ <= 118, c.capOffsetQ16 >= 1, c.capOffsetQ16 <= RecordLimits.maxQuarter else {
                throw fail(.range, "cap fields")
            }
        } else if c.capZ != 0 || c.capOffsetQ16 != 0 {
            throw fail(.canonical, "cap fields are 0 unless capped")
        }
    }

    static func encodeCrystal(_ c: CrystalNode, _ w: inout ByteWriter) throws {
        try validateCrystal(c)
        w.u8(c.structure.rawValue)
        w.u8(c.termination.rawValue)
        w.u8(c.speciesA)
        w.u8(c.speciesB)
        w.u32(c.quarterQ16)
        w.u64(c.cells.x)
        w.u64(c.cells.y)
        w.u64(c.cells.z)
        w.u8(c.capZ)
        w.zeros(3)
        w.u32(c.capOffsetQ16)
    }

    static func decodeCrystal(_ r: inout ByteReader) throws -> CrystalNode {
        let s = try r.u8(), t = try r.u8(), a = try r.u8(), b = try r.u8()
        guard let structure = CrystalNode.Structure(rawValue: s) else { throw fail(.range, "crystal structure \(s)") }
        guard let termination = CrystalNode.Termination(rawValue: t) else { throw fail(.range, "termination \(t)") }
        let quarter = try r.u32()
        let n = SIMD3(try r.u64(), try r.u64(), try r.u64())
        let capZ = try r.u8()
        try r.zeros(3)
        let capOffset = try r.u32()
        let c = CrystalNode(
            structure: structure, termination: termination, speciesA: a, speciesB: b,
            quarterQ16: quarter, cells: n, capZ: capZ, capOffsetQ16: capOffset
        )
        try validateCrystal(c)
        return c
    }

    // MARK: Tower

    static func validatePeriods(_ p: [SIMD3<Int64>]) throws {
        guard p.count == 3 else { throw fail(.range, "three periods") }
        for v in p {
            for x in [v.x, v.y, v.z] where x > RecordLimits.periodLimit || x < -RecordLimits.periodLimit {
                throw fail(.range, "period component beyond 2^40 Q16")
            }
        }
        let det = TowerMath.determinant(p)
        if det == 0 { throw fail(.canonical, "periods are linearly dependent") }
        if !TowerMath.slendernessHolds(p, det: det) { throw fail(.limit, "period cell slenderness above 2^12") }
    }

    static func validateSubstitution(_ s: Substitution) throws {
        guard s.fromZ >= 1, s.fromZ <= 118, s.toZ >= 1, s.toZ <= 118, s.fromZ != s.toZ else {
            throw fail(.range, "substitution elements")
        }
        guard s.perCopy >= 1, s.perCopy <= 4096 else { throw fail(.range, "perCopy 1 to 4,096") }
    }

    static func encodeTower(_ t: TowerNode, _ w: inout ByteWriter) throws {
        guard t.factor >= 2, t.factor <= 16 else { throw fail(.range, "factor 2 to 16") }
        try validatePeriods(t.periodsQ16)
        if let s = t.substitution { try validateSubstitution(s) }
        w.append(t.seed.bytes)
        w.u8(t.factor)
        w.u8(t.substitution == nil ? 0 : 1)
        w.u16(0)
        for p in t.periodsQ16 {
            w.i64(p.x)
            w.i64(p.y)
            w.i64(p.z)
        }
        try w.big(t.levels)
        if let s = t.substitution {
            w.u8(s.fromZ)
            w.u8(s.toZ)
            w.u16(s.perCopy)
        }
    }

    static func decodeTower(_ r: inout ByteReader) throws -> TowerNode {
        let seed = NodeID(unchecked: try r.take(32))
        let f = try r.u8()
        let flags = try r.u8()
        try r.zeros(2)
        guard f >= 2, f <= 16 else { throw fail(.range, "factor 2 to 16") }
        guard flags & ~1 == 0 else { throw fail(.canonical, "tower flags") }
        var periods: [SIMD3<Int64>] = []
        for _ in 0..<3 { periods.append(SIMD3(try r.i64(), try r.i64(), try r.i64())) }
        try validatePeriods(periods)
        let levels = try r.big()
        var sub: Substitution?
        if flags & 1 == 1 {
            let s = Substitution(fromZ: try r.u8(), toZ: try r.u8(), perCopy: try r.u16())
            try validateSubstitution(s)
            sub = s
        }
        return TowerNode(seed: seed, factor: f, periodsQ16: periods, levels: levels, substitution: sub)
    }

    // MARK: Edit

    static func encodeEdit(_ e: EditNode, _ w: inout ByteWriter) throws {
        let list = e.removed.map(\.bytes).sorted { compareBytes($0, $1) < 0 }
        guard list.count >= 1, list.count <= RecordLimits.maxRemovals else { throw fail(.limit, "an edit removes 1 to 256 paths") }
        for i in 1..<list.count where compareBytes(list[i - 1], list[i]) == 0 { throw fail(.canonical, "duplicate removal") }
        for p in e.removed {
            try Path.validate(p.steps)
            try Edits.checkRemovalShape(p.steps)
        }
        let removed = e.removed.map(\.steps)
        try Edits.checkDisjoint(removed)
        w.append(e.base.bytes)
        w.u16(UInt16(list.count))
        w.u16(0)
        for p in list {
            w.u32(UInt32(p.count))
            w.append(p)
        }
    }

    static func decodeEdit(_ r: inout ByteReader) throws -> EditNode {
        let base = NodeID(unchecked: try r.take(32))
        let c = Int(try r.u16())
        try r.zeros(2)
        guard c >= 1, c <= RecordLimits.maxRemovals else { throw fail(.limit, "an edit removes 1 to 256 paths") }
        var raw: [[UInt8]] = []
        var paths: [Path] = []
        for _ in 0..<c {
            let len = Int(try r.u32())
            let bytes = try r.take(len)
            paths.append(try Path(bytes: bytes))
            raw.append(bytes)
        }
        for i in 1..<raw.count where compareBytes(raw[i - 1], raw[i]) >= 0 {
            throw fail(.canonical, "removals sort strictly ascending")
        }
        return EditNode(base: base, removed: paths)
    }
}

/// The context-free edit rules, shared by the writer and the resolver (§2.6, §2.8).
enum Edits {
    /// Not the empty path, and no `atoms` step.
    static func checkRemovalShape(_ steps: [Step]) throws {
        if steps.isEmpty { throw fail(.validity, "the whole base is not a removal") }
        if steps.contains(where: { $0.tag == 4 }) { throw fail(.validity, "a removal has no atoms step") }
    }

    /// No removal equals or contains another.
    static func checkDisjoint(_ removals: [[Step]]) throws {
        for i in removals.indices {
            for j in removals.indices where i != j && Path.contains(removals[i], removals[j]) {
                throw fail(.validity, "a removal contains another")
            }
        }
    }
}
