import Foundation
import LupiChem
import LupiScaleCore
import Testing

/// Hex with whitespace ignored, as the spec prints it.
func hex(_ text: String) -> [UInt8] {
    let clean = text.filter { !$0.isWhitespace }
    var out: [UInt8] = []
    var i = clean.startIndex
    while i < clean.endIndex {
        let j = clean.index(i, offsetBy: 2)
        out.append(UInt8(clean[i..<j], radix: 16)!)
        i = j
    }
    return out
}

func hexString(_ bytes: [UInt8]) -> String { bytes.map { String(format: "%02x", $0) }.joined() }

func nid(_ text: String) -> NodeID { NodeID(hex: text)! }

/// The repository root, found from this file so `swift test` needs no resource bundle.
enum Repo {
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()   // …/Tests/LupiScaleCoreTests/Support
        .deletingLastPathComponent()   // …/Tests/LupiScaleCoreTests
        .deletingLastPathComponent()   // …/LupiScale/Tests
        .deletingLastPathComponent()   // …/apple/LupiScale
        .deletingLastPathComponent()   // …/apps/apple
        .deletingLastPathComponent()   // …/apps
        .deletingLastPathComponent()   // the repository

    static func bytes(_ relative: String) throws -> [UInt8] {
        [UInt8](try Data(contentsOf: root.appendingPathComponent(relative)))
    }

    /// A gallery XYZ through LupiKit's port of the web parser: file order, Float32.
    static func galleryLeaf(_ relative: String) throws -> LeafNode {
        let frame = try XYZParser.parse(bytes: bytes(relative)).first
        return LeafNode(atomicNumbers: frame.atomicNumbers.map { UInt8($0) }, positions: frame.positions)
    }
}

/// The spec's §12 content, built from its stated parameters.
enum Spec {
    static let saltSeed = CrystalNode(
        structure: .rocksalt, termination: .open, speciesA: 11, speciesB: 17, quarterQ16: 92_409, cells: SIMD3(5, 5, 5)
    )
    static let saltPeriod: Int64 = 1_848_180
    static let saltPeriods: [SIMD3<Int64>] = [SIMD3(saltPeriod, 0, 0), SIMD3(0, saltPeriod, 0), SIMD3(0, 0, saltPeriod)]
    static let bromide = Substitution(fromZ: 17, toZ: 35, perCopy: 1)
    static let googol = BigUInt.power(10, 100)
    static let googolplexLevels = googol.minus3

    static let seed: NodeRecord = try! NodeRecord(.crystal(saltSeed))

    static func seedRecord() -> NodeRecord { seed }

    static func rung(_ levels: BigUInt) throws -> NodeRecord {
        try NodeRecord(.tower(TowerNode(
            seed: seed.id, factor: 10, periodsQ16: saltPeriods, levels: levels, substitution: bromide
        )))
    }

    static func copper(_ n: UInt64, closed: Bool) -> CrystalNode {
        CrystalNode(structure: .fcc, termination: closed ? .closed : .open, speciesA: 29, quarterQ16: 59_228, cells: SIMD3(n, n, n))
    }

    static func diamondoid(_ m: UInt64) -> CrystalNode {
        CrystalNode(
            structure: .diamond, termination: .capped, speciesA: 6, quarterQ16: 58_438, cells: SIMD3(m, m, m),
            capZ: 1, capOffsetQ16: 41_243
        )
    }

    /// A tower step from the top: per axis, the given (digit, length) runs.
    static func towerStep(_ levels: BigUInt, _ runs: [[(UInt8, BigUInt)]]) -> Step {
        .tower(levels: levels, runs: runs.map { $0.map { DigitRun(digit: $0.0, length: $0.1) } })
    }

    /// C(a, L): the seed copies per axis of the googolplex, as digit counts.
    static func copiesPerAxis(_ levels: BigUInt) -> [BigUInt] { (0..<3).map { TowerMath.stacked($0, levels) } }

    static func store(_ records: [NodeRecord]) -> Resolver { Resolver(store: RecordStore(records)) }
}

extension BigUInt {
    var minus3: BigUInt { try! self - 3 }
}

/// Recomputes the pack header CRC after a test edits the header.
func resealHeader(_ b: inout [UInt8]) {
    let crc = CRC32.checksum(Array(b[0..<124]))
    for i in 0..<4 { b[124 + i] = UInt8(truncatingIfNeeded: crc >> UInt32(8 * i)) }
}

/// Recomputes the table CRC, then the header CRC.
func resealTable(_ b: inout [UInt8]) {
    let n = Int(b[12]) | Int(b[13]) << 8
    let crc = CRC32.checksum(Array(b[128..<(128 + 32 * n)]))
    for i in 0..<4 { b[100 + i] = UInt8(truncatingIfNeeded: crc >> UInt32(8 * i)) }
    resealHeader(&b)
}

/// Recomputes the CRC of section `index` from its bytes, then the table and header CRCs.
func resealSection(_ b: inout [UInt8], _ index: Int) {
    let e = 128 + 32 * index
    let offset = Int(readU64(b, e + 8)), length = Int(readU64(b, e + 16))
    let crc = CRC32.checksum(Array(b[offset..<(offset + length)]))
    for i in 0..<4 { b[e + 24 + i] = UInt8(truncatingIfNeeded: crc >> UInt32(8 * i)) }
    resealTable(&b)
}

func readU64(_ b: [UInt8], _ at: Int) -> UInt64 {
    (0..<8).reduce(UInt64(0)) { $0 | UInt64(b[at + $1]) << UInt64(8 * $1) }
}

func readU32(_ b: [UInt8], _ at: Int) -> UInt32 {
    (0..<4).reduce(UInt32(0)) { $0 | UInt32(b[at + $1]) << UInt32(8 * $1) }
}

func writeU32(_ b: inout [UInt8], _ at: Int, _ v: UInt32) {
    for i in 0..<4 { b[at + i] = UInt8(truncatingIfNeeded: v >> UInt32(8 * i)) }
}

func writeU64(_ b: inout [UInt8], _ at: Int, _ v: UInt64) {
    for i in 0..<8 { b[at + i] = UInt8(truncatingIfNeeded: v >> UInt64(8 * i)) }
}

/// Expects a ScaleError with this code.
func expectCode(_ code: ScaleError.Code, _ sourceLocation: SourceLocation = #_sourceLocation, _ body: () throws -> Void) {
    do {
        try body()
        Issue.record("expected \(code), got success", sourceLocation: sourceLocation)
    } catch let e as ScaleError {
        #expect(e.code == code, "\(e)", sourceLocation: sourceLocation)
    } catch {
        Issue.record("expected \(code), got \(error)", sourceLocation: sourceLocation)
    }
}
