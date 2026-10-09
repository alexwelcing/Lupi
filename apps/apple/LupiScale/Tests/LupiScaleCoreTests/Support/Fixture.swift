import Foundation
import LupiScaleCore
import Testing

/// A JSON value, enough to read the golden fixtures without a schema per section.
enum JSON: Decodable, Sendable {
    case null, bool(Bool), number(Double), string(String), array([JSON]), object([String: JSON])

    init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let d = try? c.decode(Double.self) { self = .number(d); return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let a = try? c.decode([JSON].self) { self = .array(a); return }
        self = .object(try c.decode([String: JSON].self))
    }

    subscript(_ key: String) -> JSON {
        if case let .object(o) = self { return o[key] ?? .null }
        return .null
    }

    var isNull: Bool { if case .null = self { return true }; return false }
    var string: String { if case let .string(s) = self { return s }; preconditionFailure("not a string: \(self)") }
    var optionalString: String? { if case let .string(s) = self { return s }; return nil }
    var double: Double { if case let .number(d) = self { return d }; preconditionFailure("not a number: \(self)") }
    var int: Int { Int(double) }
    var bool: Bool { if case let .bool(b) = self { return b }; preconditionFailure("not a bool: \(self)") }
    var array: [JSON] { if case let .array(a) = self { return a }; preconditionFailure("not an array: \(self)") }
    var object: [String: JSON] { if case let .object(o) = self { return o }; preconditionFailure("not an object: \(self)") }
    var big: BigUInt { BigUInt(decimal: string)! }
    var bytes: [UInt8] { hex(string) }
    var id: NodeID { nid(string) }
}

/// `Tests/Fixtures/scale-v1.json`, written by the TypeScript reference
/// (packages/core/scripts/write-scale-fixtures.mts) and kept in sync by
/// `pnpm exec tsx tools/apple/export-scale-fixtures.mts`.
enum Fixture {
    static let json: JSON = {
        let url = Repo.root.appendingPathComponent("apps/apple/LupiScale/Tests/Fixtures/scale-v1.json")
        return try! JSONDecoder().decode(JSON.self, from: Data(contentsOf: url))
    }()

    /// Every record the fixture lists, by NodeID.
    static let records: [NodeID: NodeRecord] = {
        var out: [NodeID: NodeRecord] = [:]
        for r in json["records"].array {
            let rec = try! NodeRecord(bytes: r["hex"].bytes)
            out[rec.id] = rec
        }
        return out
    }()

    static var store: RecordStore { RecordStore(Array(records.values)) }

    /// The named cases of a section, for parameterized tests.
    static func names(_ section: String) -> [String] { json[section].array.map { $0["name"].string } }

    static func named(_ section: JSON, _ name: String) -> JSON {
        section.array.first { $0["name"].string == name }!
    }

    // MARK: Values

    static func step(_ j: JSON) -> Step {
        switch j["tag"].string {
        case "child":
            return .child(UInt16(j["index"].int))
        case "cells":
            return .cells(j["octants"].array.map { UInt8($0.int) })
        case "tower":
            let runs = j["runs"].array.map { axis in
                axis.array.map { DigitRun(digit: UInt8($0.array[0].int), length: $0.array[1].big) }
            }
            return .tower(levels: j["levels"].big, runs: runs)
        case "atoms":
            return .atoms(j["ranges"].array.map { AtomRange(start: UInt16($0.array[0].int), length: UInt16($0.array[1].int)) })
        case let tag:
            preconditionFailure("step tag \(tag)")
        }
    }

    static func steps(_ path: JSON) -> [Step] { path["steps"].array.map(step) }

    static func node(_ j: JSON) -> Node {
        switch j["kind"].string {
        case "leaf":
            let raw = j["positionsF32Hex"].bytes
            let floats = stride(from: 0, to: raw.count, by: 4).map { Float(bitPattern: readU32(raw, $0)) }
            let positions = stride(from: 0, to: floats.count, by: 3).map { SIMD3(floats[$0], floats[$0 + 1], floats[$0 + 2]) }
            return .leaf(LeafNode(atomicNumbers: j["z"].array.map { UInt8($0.int) }, positions: positions))
        case "group":
            return .group(j["children"].array.map { c in
                let q = c["rotation"].array.map(\.double), t = c["translation"].array.map(\.double)
                return GroupChild(id: c["id"].id, rotation: SIMD4(q[0], q[1], q[2], q[3]), translation: SIMD3(t[0], t[1], t[2]))
            })
        case "crystal":
            let cells = j["cells"].array.map { $0.big.uint64! }
            return .crystal(CrystalNode(
                structure: CrystalNode.Structure(rawValue: UInt8(j["structure"].int))!,
                termination: CrystalNode.Termination(rawValue: UInt8(j["termination"].int))!,
                speciesA: UInt8(j["a"].int), speciesB: UInt8(j["b"].int), quarterQ16: UInt32(j["quarter"].int),
                cells: SIMD3(cells[0], cells[1], cells[2]), capZ: UInt8(j["capZ"].int), capOffsetQ16: UInt32(j["capOffset"].int)
            ))
        case "tower":
            let periods = j["periods"].array.map { p in
                let v = p.array.map { Int64($0.string)! }
                return SIMD3(v[0], v[1], v[2])
            }
            let s = j["substitution"]
            return .tower(TowerNode(
                seed: j["seed"].id, factor: UInt8(j["factor"].int), periodsQ16: periods, levels: j["levels"].big,
                substitution: s.isNull ? nil : Substitution(fromZ: UInt8(s["fromZ"].int), toZ: UInt8(s["toZ"].int), perCopy: UInt16(s["perCopy"].int))
            ))
        case "edit":
            return .edit(EditNode(base: j["base"].id, removed: j["removed"].array.map { try! Path(canonicalizing: steps($0)) }))
        case let kind:
            preconditionFailure("node kind \(kind)")
        }
    }

    /// A Magnitude from the fixture's value tree: plain, tower, add or sub.
    static func magnitude(_ j: JSON) throws -> Magnitude {
        switch j["op"].string {
        case "plain": return Magnitude(j["value"].big)
        case "tower": return Magnitude.tower(seedCount: j["seed"].big, factor: UInt8(j["factor"].int), levels: j["levels"].big)
        case "add": return try magnitude(j["a"]) + magnitude(j["b"])
        case "sub": return try magnitude(j["a"]) - magnitude(j["b"])
        case let op: preconditionFailure("magnitude op \(op)")
        }
    }

    /// Per-element counts as the fixture writes them: atomic number to decimal count.
    static func counts(_ j: JSON) -> [UInt8: BigUInt] {
        Dictionary(uniqueKeysWithValues: j.object.map { (UInt8($0.key)!, $0.value.big) })
    }
}

/// A Magnitude matches its fixture form: §5.4 text, display base and canonical key.
func expectMagnitude(_ m: Magnitude, _ j: JSON, _ what: String, sourceLocation: SourceLocation = #_sourceLocation) {
    #expect(m.formatted == j["text"].string, "\(what): text", sourceLocation: sourceLocation)
    #expect(Int(m.displayBase) == j["displayBase"].int, "\(what): display base", sourceLocation: sourceLocation)
    #expect(m.key == j["key"].string, "\(what): canonical key", sourceLocation: sourceLocation)
}

/// The §4.7 code thrown by `body`, or nil when it succeeds. Errors other than ScaleError are bugs.
func errorCode(_ body: () throws -> Void) -> String? {
    do {
        try body()
        return nil
    } catch let e as ScaleError {
        return e.code.rawValue
    } catch {
        Issue.record("not a ScaleError: \(error)")
        return "\(error)"
    }
}

func hex64(_ v: UInt64) -> String {
    let s = String(v, radix: 16)
    return "0x" + String(repeating: "0", count: 16 - s.count) + s
}
