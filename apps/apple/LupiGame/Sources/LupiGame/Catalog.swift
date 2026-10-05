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
    /// A kept trophy, from the Cabinet or a shelf (plan §6.4).
    case trophy(TrophyRecord)
    /// A loose atom from the atom tray, by atomic number (plan §4.5).
    case atom(Int)
}

public struct SpawnItem: Sendable, Hashable, Identifiable {
    public var id: String
    public var title: String
    /// The formula, or the exact count for a crystal.
    public var subtitle: String
    public var source: SpawnSource
}

/// What a spawn becomes: a scale reference with its records, named, and where it came from.
public struct SpawnContent: Sendable {
    /// What the cut draws.
    public var ref: ScaleRef
    public var name: String
    public var provenance: Provenance
    /// The piece exactly, when the drawing goes through another reference (a restored fragment).
    public var identity: ScaleRef?
    /// σ when the size is given (a trophy keeps its own); nil for the spawn size (scale-spec §10.1).
    public var metresPerUnit: Double?
    /// It snaps to other atoms (plan §4.5): a tray atom, or a kept fragment, built molecule or atom.
    public var buildable: Bool
    /// OMol25 rows whose atoms it holds, for attribution.
    public var omolRows: [String]

    public init(
        ref: ScaleRef, name: String, provenance: Provenance, identity: ScaleRef? = nil, metresPerUnit: Double? = nil,
        buildable: Bool = false, omolRows: [String] = []
    ) {
        self.ref = ref
        self.name = name
        self.provenance = provenance
        self.identity = identity
        self.metresPerUnit = metresPerUnit
        self.buildable = buildable
        self.omolRows = omolRows
    }
}

/// The bundled content: starters as leaves (scale-spec §2.2, file order, Float32 as the web
/// parses them) and the salt rungs, all offline (plan §3.7).
public struct Catalog: Sendable {
    /// The tray, C₆₀ first: the house molecule of the web's first minute (plan §8 M0).
    public var tray: [SpawnItem]
    public var receipt: [SpawnItem]
    /// What a built molecule is named after: the starters, then the gallery and OMol25 picks (plan §4.5).
    public var known: KnownMolecules
    var starters: [String: (starter: Starter, leaf: LeafNode)]

    /// The tray's order; starters the manifest adds later follow in its order.
    public static let trayOrder = [
        "c60_buckyball", "caffeine", "hydrogen_peroxide", "water", "benzene", "ethanol", "glucose", "tryptophan",
        "methane", "ammonia", "carbon_dioxide", "hydrogen", "salt_cluster",
    ]

    public init(starters list: [(Starter, Molecule)], known: KnownMolecules? = nil) {
        self.known = known ?? KnownMolecules.starters(list)
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
        let starters = try manifest.starters.map { ($0, try Starters.molecule($0)) }
        return Catalog(starters: starters, known: try KnownMolecules.bundled(starters: starters))
    }

    public func item(_ id: String) -> SpawnItem? { (tray + receipt).first { $0.id == id } }

    public func content(_ source: SpawnSource) throws -> SpawnContent {
        switch source {
        case let .starter(id):
            guard let entry = starters[id] else { throw ScaleError(.missing, "starter \(id)") }
            let record = try NodeRecord(.leaf(entry.leaf))
            return SpawnContent(
                ref: try ScaleRef.keep(root: record.id, path: Path(), store: RecordStore([record])), name: entry.starter.name,
                provenance: Self.provenance(entry.starter)
            )
        case let .salt(rung):
            return SpawnContent(ref: try SaltLadder.ref(levels: rung.levels), name: rung.title, provenance: .scale)
        case let .trophy(trophy):
            let piece = try Restore.piece(trophy, catalog: self, store: GameStore())
            let single = piece.count.plain == BigUInt(1)
            return SpawnContent(
                ref: piece.display, name: piece.name, provenance: .trophy(trophy), identity: piece.identity,
                metresPerUnit: piece.metresPerUnit,
                buildable: single || trophy.molecule.source == .built || trophy.molecule.source == .fragment,
                omolRows: Self.omolRows(trophy)
            )
        case let .atom(z):
            guard let element = ChemicalElement.known(z) else { throw ScaleError(.range, "atomic number \(z)") }
            let record = try NodeRecord(.leaf(LeafNode(atomicNumbers: [UInt8(z)], positions: [SIMD3<Float>(0, 0, 0)])))
            return SpawnContent(
                ref: try ScaleRef.keep(root: record.id, path: Path(), store: RecordStore([record])), name: element.name,
                provenance: .scale, metresPerUnit: BuildTuning.atomScale, buildable: true
            )
        }
    }

    /// The OMol25 rows a trophy's atoms come from: its own row, its parent's, or the rows its
    /// embedded XYZ credits (`source=omol25:…`, contracts.md §1.3).
    public static func omolRows(_ trophy: TrophyRecord) -> [String] {
        if trophy.molecule.source == .omol25, let id = trophy.molecule.id { return [id] }
        if let parent = trophy.origin.parent, parent.source == .omol25, let id = parent.id { return [id] }
        guard let xyz = trophy.molecule.xyz else { return [] }
        let comment = xyz.split(separator: "\n", maxSplits: 2, omittingEmptySubsequences: false).dropFirst().first ?? ""
        // `key=value | key=value`: the `source` key itself, not `charge_source`.
        let pairs = comment.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
        guard let value = pairs.first(where: { $0.hasPrefix("source=") })?.dropFirst("source=".count) else { return [] }
        return value.split(separator: ",").compactMap { part in
            part.hasPrefix("omol25:") ? String(part.dropFirst("omol25:".count)) : nil
        }
    }

    /// Where a bundled starter came from (contracts.md §1.3): a gallery file is a gallery
    /// molecule, a PubChem conformer is a PubChem one, and a geometry the bundler wrote has no
    /// home but its reference.
    public static func provenance(_ starter: Starter) -> Provenance {
        if let path = starter.lupiPath, let url = URL(string: Provenance.lupiOrigin + path) {
            // Bundled byte for byte, so the bundle's hash is the one the molecule page prints.
            return .gallery(id: starter.id, url: url, sha256: starter.sha256)
        }
        if let cid = starter.pubchemCID { return .pubchem(cid: cid, url: Provenance.pubchemRecordURL(cid: cid)) }
        return .scale
    }
}
