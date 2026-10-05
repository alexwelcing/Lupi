import Foundation
import LupiChem
import LupiScale
import LupiScaleCore

/// The six rungs of the salt ladder (scale-spec §12.4): one seed, a tower of tens.
public enum SaltRung: Int, Sendable, CaseIterable, Comparable {
    case thousand, million, billion, e30, googol, googolplex

    /// `levels` of the rung's tower: 0, 3, 6, 27, 97 and 10¹⁰⁰ − 3.
    public var levels: BigUInt {
        switch self {
        case .thousand: BigUInt(0)
        case .million: BigUInt(3)
        case .billion: BigUInt(6)
        case .e30: BigUInt(27)
        case .googol: BigUInt(97)
        // 10¹⁰⁰ − 3 cannot underflow.
        case .googolplex: (try? BigUInt.power(10, 100) - BigUInt(3)) ?? BigUInt()
        }
    }

    /// The root's name in the bundled pack `lupi-scale-r1.lpk` (scale-spec §12.6).
    public var packName: String {
        switch self {
        case .thousand: "salt-thousand"
        case .million: "salt-million"
        case .billion: "salt-billion"
        case .e30: "salt-e30"
        case .googol: "salt-googol"
        case .googolplex: "salt-googolplex"
        }
    }

    public var title: String {
        switch self {
        case .thousand: "Salt, 10³ atoms"
        case .million: "Salt, 10⁶ atoms"
        case .billion: "Salt, 10⁹ atoms"
        case .e30: "Salt, 10³⁰ atoms"
        case .googol: "Salt, a googol atoms"
        case .googolplex: "Salt, a googolplex atoms"
        }
    }

    /// The rung's NodeID from scale-spec §12.4, checked by the tests.
    public var specNodeID: String {
        switch self {
        case .thousand: "1349a66011dc8c606efe01fb2b56362637560b205c37a0e87040041bc8933eb3"
        case .million: "cd481a1353e063838be8fc0c55f420b977465a8f1db3e959460aaa34ac4b8df8"
        case .billion: "8244914ffbe1dc2ef6fcc9d3d4dd33c7f904d8c9b06c6f760fa8224dd6244e27"
        case .e30: "acf0aa4a9271023dff67a256fcfcd5993f767ccf3ded32b0bbd3995765fffc3f"
        case .googol: "b6ea59ba7442ec18a606dffa157dba6bda89dbad3b27d427b24cef47012c167e"
        case .googolplex: "a10e2103622970045012eb530843be4ef0a080b1c21e5265e294cb440c3e5759"
        }
    }

    public init(_ receipt: ReceiptRung) {
        switch receipt {
        case .thousand: self = .thousand
        case .million: self = .million
        case .billion: self = .billion
        }
    }

    public static func < (a: SaltRung, b: SaltRung) -> Bool { a.rawValue < b.rawValue }
}

/// The scale content of M3a (plan §7.5): the salt ladder to a googolplex, copper's billion as one
/// crystal record, a diamond, and the {111} diamondoids.
public enum ScaleItem: Sendable, Hashable {
    case salt(SaltRung)
    /// The web's `BillionAtomBlock`: Cu fcc, 630³ cells, open or closed (scale-spec §12.3).
    case copper(closed: Bool)
    /// A one-carat cube of diamond, closed (`ScaleContent.diamondCarat`).
    case diamond
    /// The octahedral diamondoid of order m (1…12): adamantane C₁₀H₁₆ to C₂₉₂₅H₆₇₆ (scale-spec §3.3.4).
    case diamondoid(Int)

    /// Every item, in the menu's order.
    public static let all: [ScaleItem] =
        SaltRung.allCases.map { .salt($0) } + [.copper(closed: false), .copper(closed: true), .diamond]
        + (1...ScaleContent.diamondoidOrders).map { .diamondoid($0) }

    /// The bundled pack's root name, or the app's own name for the diamond, which the pack lacks.
    public var id: String {
        switch self {
        case let .salt(r): r.packName
        case let .copper(closed): closed ? "copper-billion-closed" : "copper-billion"
        case .diamond: "diamond-carat"
        case let .diamondoid(m): "diamondoid-\(m)"
        }
    }

    public var title: String {
        switch self {
        case let .salt(r): r.title
        case let .copper(closed): closed ? "Copper, a billion atoms, closed" : "Copper, a billion atoms"
        case .diamond: "Diamond, one carat"
        case let .diamondoid(m): ScaleContent.diamondoidName(m)
        }
    }

    /// The menu's group.
    public var shelf: ScaleShelf {
        switch self {
        case .salt: .salt
        case .copper, .diamond: .crystals
        case .diamondoid: .diamondoids
        }
    }
}

/// The scale menu's groups.
public enum ScaleShelf: String, Sendable, CaseIterable {
    case salt = "The salt ladder"
    case crystals = "Crystals"
    case diamondoids = "Diamondoids"
}

public enum ScaleContent {
    /// Orders of the bundled diamondoids (scale-spec §12.3).
    public static let diamondoidOrders = 12

    /// Cu fcc, `quarter` 59,228 Q16 (a = 3.615 Å), 630³ cells: 1,000,188,000 atoms open,
    /// 1,002,571,291 closed (scale-spec §3.3.2, §12.3).
    public static func copper(closed: Bool) -> CrystalNode {
        CrystalNode(structure: .fcc, termination: closed ? .closed : .open, speciesA: 29, quarterQ16: 59_228, cells: SIMD3(630, 630, 630))
    }

    /// The {111} diamondoid of order m: diamond, capped with H at 1.09 Å (scale-spec §3.3.4).
    public static func diamondoid(_ m: Int) -> CrystalNode {
        CrystalNode(
            structure: .diamond, termination: .capped, speciesA: 6, quarterQ16: 58_438, cells: SIMD3(UInt64(m), UInt64(m), UInt64(m)),
            capZ: 1, capOffsetQ16: 41_243
        )
    }

    /// Cells per axis of the carat: 8N³ + 6N² + 3N + 1 carbons (closed diamond) at 12.011 Da
    /// weigh 0.2000000 g, one carat, in a cube 3.85 mm on a side. Not in the bundled pack; its
    /// 52-byte record is embedded wherever it is kept, like every generator record (§7.2).
    public static let caratCells: UInt64 = 10_782_114

    public static let diamondCarat = CrystalNode(
        structure: .diamond, termination: .closed, speciesA: 6, quarterQ16: 58_438,
        cells: SIMD3(caratCells, caratCells, caratCells)
    )

    /// The octahedral diamondoids' names: adamantane, the octahedral [1231]decamantane, then
    /// by formula, C(2m+3 choose 3) H(2m+2)².
    public static func diamondoidName(_ m: Int) -> String {
        switch m {
        case 1: return "Adamantane"
        case 2: return "Decamantane"
        default:
            let c = (2 * m + 3) * (2 * m + 2) * (2 * m + 1) / 6
            let h = (2 * m + 2) * (2 * m + 2)
            return "Diamondoid C\(c)H\(h)"
        }
    }

    /// `lupi-scale-r1.lpk`'s twenty roots over twenty-one records (scale-spec §12.6), in its order.
    public static func bundledRoots() throws -> (records: [NodeRecord], roots: [(String, NodeID)]) {
        var records = [SaltLadder.seedRecord]
        var roots: [(String, NodeID)] = []
        for r in SaltRung.allCases {
            let rec = try SaltLadder.record(levels: r.levels)
            records.append(rec)
            roots.append((r.packName, rec.id))
        }
        for closed in [false, true] {
            let rec = try NodeRecord(.crystal(copper(closed: closed)))
            records.append(rec)
            roots.append((ScaleItem.copper(closed: closed).id, rec.id))
        }
        for m in 1...diamondoidOrders {
            let rec = try NodeRecord(.crystal(diamondoid(m)))
            records.append(rec)
            roots.append((ScaleItem.diamondoid(m).id, rec.id))
        }
        return (records, roots)
    }

    /// The bundled pack's bytes. The app writes them at launch instead of shipping the file: the
    /// generator registry is frozen, so the same records give the same 65,536 bytes everywhere,
    /// and the tests hold them to scale-spec §12.6's contentId and file hash.
    public static func bundledPackBytes() throws -> [UInt8] {
        let (records, roots) = try bundledRoots()
        return try LupiPack.write(records: records, roots: roots, dependencies: [])
    }

    /// The bundled pack, read back through LupiPack's conformance checks (§6.6).
    public static func bundledPack() throws -> LupiPack { try LupiPack(bytes: bundledPackBytes()) }

    /// The item's reference with every record it needs embedded (scale-spec §7.2), from the pack.
    public static func ref(_ item: ScaleItem, pack: LupiPack) throws -> ScaleRef {
        switch item {
        case .diamond:
            let record = try NodeRecord(.crystal(diamondCarat))
            return try ScaleRef.keep(root: record.id, path: Path(), store: RecordStore([record]))
        case let .diamondoid(m) where !(1...diamondoidOrders).contains(m):
            throw ScaleError(.range, "diamondoid order \(m)")
        default:
            guard let root = pack.root(named: item.id) else { throw ScaleError(.missing, "\(item.id) is not in the bundled pack") }
            return try ScaleRef.keep(root: root, path: Path(), store: pack)
        }
    }
}

/// True masses for the plaque (plan §4.7: only true facts), from the exact composition.
public enum MassText {
    /// A molecule's molar mass in daltons; anything bigger in grams, kilograms or tonnes while
    /// the number is ordinary, and §5.5's scientific form in kilograms beyond.
    public static func of(_ massMicroDa: Magnitude, isMolecule: Bool) -> String {
        if isMolecule, let micro = massMicroDa.plain?.nearestDouble, micro < 1e15 {
            return String(format: "%.2f Da", micro / 1e6)
        }
        let lnKg = massMicroDa.lnM + log(Magnitude.kgPerMicroDalton)
        guard lnKg.isFinite, lnKg < log(1e12) else { return massMicroDa.scientific(times: Magnitude.kgPerMicroDalton) + " kg" }
        let kg = exp(lnKg)
        let g = kg * 1000
        switch g {
        case ..<1e-21: return sig(g * 1e24) + " yg"
        case 1e-21..<1e-18: return sig(g * 1e21) + " zg"
        case 1e-18..<1e-15: return sig(g * 1e18) + " ag"
        case 1e-15..<1e-12: return sig(g * 1e15) + " fg"
        case 1e-12..<1e-9: return sig(g * 1e12) + " pg"
        case 1e-9..<1e-6: return sig(g * 1e9) + " ng"
        case 1e-6..<1e-3: return sig(g * 1e6) + " µg"
        case 1e-3..<1: return sig(g * 1e3) + " mg"
        case 1..<1000: return sig(g) + " g"
        case 1000..<1e6: return sig(kg) + " kg"
        default: return sig(kg / 1000) + " t"
        }
    }

    /// Three significant digits, no exponent.
    static func sig(_ v: Double) -> String {
        if v >= 100 { return String(format: "%.0f", v) }
        if v >= 10 { return String(format: "%.1f", v) }
        return String(format: "%.2f", v)
    }
}
