import Foundation
import LupiChem
import LupiData
import LupiScale
import LupiScaleCore

/// The salt ladder of scale-spec §12.4: one 1,000-ion seed crystal, replicated by a tower of
/// factor 10 with one bromide per copy. The scale receipt plays its first three rungs.
public enum SaltLadder {
    /// Rock salt, open, Na/Cl, quarter 92,409 Q16 (a = 5.64019 Å), 5 × 5 × 5 cells (§12.3).
    public static let seed = CrystalNode(
        structure: .rocksalt, termination: .open, speciesA: 11, speciesB: 17, quarterQ16: 92_409, cells: SIMD3(5, 5, 5)
    )
    /// 28.2 Å, five cells, on each axis (§12.4).
    public static let periodQ16: Int64 = 1_848_180

    public static func tower(levels: BigUInt) -> TowerNode {
        TowerNode(
            seed: seedRecord.id, factor: 10,
            periodsQ16: [SIMD3(periodQ16, 0, 0), SIMD3(0, periodQ16, 0), SIMD3(0, 0, periodQ16)],
            levels: levels, substitution: Substitution(fromZ: 17, toZ: 35, perCopy: 1)
        )
    }

    // Valid by construction: these are the spec's own records (§12.3, §12.4).
    public static let seedRecord: NodeRecord = try! NodeRecord(.crystal(seed))

    public static func record(levels: BigUInt) throws -> NodeRecord { try NodeRecord(.tower(tower(levels: levels))) }

    /// A reference to a rung with both records embedded and, for the 10³ rung, its probe:
    /// 229 bytes for 10⁶ and 10⁹ (scale.md §6.2).
    public static func ref(levels: BigUInt) throws -> ScaleRef {
        let tower = try record(levels: levels)
        return try ScaleRef.keep(root: tower.id, path: Path(), store: RecordStore([tower, seedRecord]))
    }
}

/// The rungs of the scale receipt (plan §8 M0).
public enum ReceiptRung: Int, Sendable, CaseIterable, Comparable {
    case thousand = 0
    case million = 3
    case billion = 6

    public var levels: BigUInt { BigUInt(rawValue) }
    public var title: String {
        switch self {
        case .thousand: "Salt, 10³ atoms"
        case .million: "Salt, 10⁶ atoms"
        case .billion: "Salt, 10⁹ atoms"
        }
    }

    /// The tower's NodeID from scale-spec §12.4, checked by the tests.
    public var specNodeID: String {
        switch self {
        case .thousand: "1349a66011dc8c606efe01fb2b56362637560b205c37a0e87040041bc8933eb3"
        case .million: "cd481a1353e063838be8fc0c55f420b977465a8f1db3e959460aaa34ac4b8df8"
        case .billion: "8244914ffbe1dc2ef6fcc9d3d4dd33c7f904d8c9b06c6f760fa8224dd6244e27"
        }
    }

    public static func < (a: ReceiptRung, b: ReceiptRung) -> Bool { a.rawValue < b.rawValue }
}

/// Something the tray can spawn.
public enum SpawnSource: Sendable, Hashable {
    /// A bundled starter (LupiData), by id.
    case starter(String)
    case salt(ReceiptRung)
}

public struct SpawnItem: Sendable, Hashable, Identifiable {
    public var id: String
    public var title: String
    /// The formula, or the exact count for a crystal.
    public var subtitle: String
    public var source: SpawnSource
}

/// What a spawn becomes: a scale reference with its records, named.
public struct SpawnContent: Sendable {
    public var ref: ScaleRef
    public var name: String
}

/// The bundled content: starters as leaves (scale-spec §2.2, file order, Float32 as the web
/// parses them) and the salt rungs, all offline (plan §3.7).
public struct Catalog: Sendable {
    /// The tray, C₆₀ first: the house molecule of the web's first minute (plan §8 M0).
    public var tray: [SpawnItem]
    public var receipt: [SpawnItem]
    var starters: [String: (starter: Starter, leaf: LeafNode)]

    /// The tray's order; starters the manifest adds later follow in its order.
    public static let trayOrder = [
        "c60_buckyball", "caffeine", "hydrogen_peroxide", "water", "benzene", "ethanol", "glucose", "tryptophan",
        "methane", "ammonia", "carbon_dioxide", "hydrogen", "salt_cluster",
    ]

    public init(starters list: [(Starter, Molecule)]) {
        var map: [String: (starter: Starter, leaf: LeafNode)] = [:]
        for (s, m) in list {
            map[s.id] = (s, LeafNode(atomicNumbers: m.atomicNumbers.map { UInt8(clamping: $0) }, positions: m.positions))
        }
        starters = map
        let ids = list.map(\.0.id)
        let ordered = Self.trayOrder.filter { map[$0] != nil } + ids.filter { !Self.trayOrder.contains($0) }
        tray = ordered.compactMap { id in
            guard let s = map[id]?.starter else { return nil }
            return SpawnItem(id: id, title: s.name, subtitle: s.formula, source: .starter(id))
        }
        receipt = ReceiptRung.allCases.map { rung in
            let count = Magnitude.tower(seedCount: BigUInt(1000), factor: 10, levels: rung.levels)
            return SpawnItem(id: "salt-\(rung.rawValue)", title: rung.title, subtitle: "\(count.formatted) atoms", source: .salt(rung))
        }
    }

    /// The starters LupiData bundles.
    public static func bundled() throws -> Catalog {
        let manifest = try Starters.manifest()
        return Catalog(starters: try manifest.starters.map { ($0, try Starters.molecule($0)) })
    }

    public func item(_ id: String) -> SpawnItem? { (tray + receipt).first { $0.id == id } }

    public func content(_ source: SpawnSource) throws -> SpawnContent {
        switch source {
        case let .starter(id):
            guard let entry = starters[id] else { throw ScaleError(.missing, "starter \(id)") }
            let record = try NodeRecord(.leaf(entry.leaf))
            return SpawnContent(ref: try ScaleRef.keep(root: record.id, path: Path(), store: RecordStore([record])), name: entry.starter.name)
        case let .salt(rung):
            return SpawnContent(ref: try SaltLadder.ref(levels: rung.levels), name: rung.title)
        }
    }
}
