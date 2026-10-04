import Foundation
import LupiChem

/// `lupi.trophy.v1`: one molecule in the player's collection (decision D6:
/// spawn anything; a molecule left on a shelf is a trophy). Collection
/// records sync to the Lupi account (D7); where a trophy sits in the room is
/// a `lupi.shelf.v1` placement and stays on the device.
public struct Trophy: Sendable, Equatable, Codable, Identifiable {
    public static let schemaID = "lupi.trophy.v1"

    public var schema: String
    /// Stable across devices: a lowercase UUID.
    public var id: String
    public var molecule: TrophyMolecule
    public var earned: Earned
    /// The Remix look it wears, if any (codes resolve forever, AGENTS.md).
    public var remix: RemixLook?
    /// The museum line: "Caffeine · C8H10N4O2 · shown 10⁸×".
    public var plaque: String
    public var createdAt: Date
    public var updatedAt: Date
    /// Set when the player deletes it, so the deletion syncs; nil while kept.
    public var deletedAt: Date?

    public init(
        id: String = UUID().uuidString.lowercased(), molecule: TrophyMolecule, earned: Earned,
        remix: RemixLook? = nil, plaque: String, createdAt: Date = Date(), updatedAt: Date? = nil, deletedAt: Date? = nil
    ) {
        schema = Self.schemaID
        self.id = id
        self.molecule = molecule
        self.earned = earned
        self.remix = remix
        self.plaque = plaque
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
    }

    /// What is wrong with this record, empty when it is valid.
    public func validate() -> [String] {
        var issues: [String] = []
        if schema != Self.schemaID { issues.append("schema is \(schema), expected \(Self.schemaID)") }
        if id.isEmpty { issues.append("id is empty") }
        if plaque.isEmpty { issues.append("plaque is empty") }
        if updatedAt < createdAt { issues.append("updatedAt is before createdAt") }
        issues += molecule.validate()
        if let remix, !RemixLook.isValidCode(remix.code) { issues.append("remix code \(remix.code) is not r1-XXXXX") }
        return issues
    }
}

/// Which molecule a trophy is: a reference to a file (URL plus sha256) or,
/// for molecules that exist nowhere else (built, broken off), the structure.
public struct TrophyMolecule: Sendable, Equatable, Codable {
    public enum Source: String, Sendable, Codable, CaseIterable {
        /// A gallery molecule (/m/manifest.json).
        case gallery
        /// An OMol25 record: a featured pick or an edge structure row.
        case omol25
        /// One of the app's bundled starters.
        case starter
        /// Snapped together by the player.
        case built
        /// Broken off another molecule.
        case fragment
    }

    public var source: Source
    /// The id within its source: gallery page id, OMol25 pick id or "collection/row", starter id.
    public var ref: String?
    public var name: String
    /// Hill formula.
    public var formula: String
    public var atomCount: Int
    /// Where the coordinates live: a path on the Lupi origin ("/gallery/…") or an https URL.
    public var url: String?
    /// SHA-256 of the bytes at `url`, lowercase hex.
    public var sha256: String?
    /// The coordinates and bonds themselves, when there is no file.
    public var structure: InlineStructure?
    /// The bond rule its bonds were drawn with (`lupi-bonds.molecular.v1`).
    public var bondRecipe: String?

    public init(
        source: Source, ref: String? = nil, name: String, formula: String, atomCount: Int, url: String? = nil,
        sha256: String? = nil, structure: InlineStructure? = nil, bondRecipe: String? = nil
    ) {
        self.source = source
        self.ref = ref
        self.name = name
        self.formula = formula
        self.atomCount = atomCount
        self.url = url
        self.sha256 = sha256
        self.structure = structure
        self.bondRecipe = bondRecipe
    }

    /// A built or broken-off molecule, carried whole.
    public init(source: Source, name: String? = nil, molecule: Molecule, graph: BondGraph, bondRecipe: BondRecipe? = .molecular) {
        self.init(
            source: source, name: name ?? molecule.name ?? molecule.hillFormula, formula: molecule.hillFormula,
            atomCount: molecule.count, structure: InlineStructure(molecule: molecule, graph: graph),
            bondRecipe: bondRecipe?.rawValue
        )
    }

    public func validate() -> [String] {
        var issues: [String] = []
        if name.isEmpty { issues.append("molecule name is empty") }
        if atomCount < 1 { issues.append("atomCount must be at least 1") }
        let hasFile = url != nil
        if hasFile {
            if let url, url.isEmpty { issues.append("url is empty") }
            guard let sha256 else {
                issues.append("a url needs its sha256")
                return issues
            }
            if sha256.count != 64 || !sha256.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) {
                issues.append("sha256 is not 64 lowercase hex digits")
            }
        }
        if let structure {
            issues += structure.validate()
            if structure.atomicNumbers.count != atomCount { issues.append("atomCount does not match the structure") }
        }
        if !hasFile && structure == nil { issues.append("a trophy needs a url and sha256, or a structure") }
        if (source == .built || source == .fragment) && structure == nil {
            issues.append("\(source.rawValue) molecules carry their structure")
        }
        return issues
    }
}

/// Coordinates and bonds, compact enough for a synced document.
public struct InlineStructure: Sendable, Equatable, Codable {
    public var atomicNumbers: [Int]
    /// Å, flat x y z per atom.
    public var positions: [Float]
    /// Per bond `[i, j, kind, order×2]`: kind 0 covalent, 1 coordination,
    /// 2 ionic contact; order×2 is 2 single, 3 delocalized, 4 double, 6 triple.
    public var bonds: [[Int]]

    public init(atomicNumbers: [Int], positions: [Float], bonds: [[Int]]) {
        self.atomicNumbers = atomicNumbers
        self.positions = positions
        self.bonds = bonds
    }

    public init(molecule: Molecule, graph: BondGraph) {
        atomicNumbers = molecule.atomicNumbers
        positions = molecule.positions.flatMap { [$0.x, $0.y, $0.z] }
        bonds = graph.bonds.map { [$0.i, $0.j, Int($0.kind.rawValue), Int(($0.order.value * 2).rounded())] }
    }

    /// The molecule; a malformed record (see `validate`) is cut to its complete atoms.
    public func molecule(name: String? = nil) -> Molecule {
        let n = min(atomicNumbers.count, positions.count / 3)
        let points = (0..<n).map { SIMD3<Float>(positions[3 * $0], positions[3 * $0 + 1], positions[3 * $0 + 2]) }
        return Molecule(atomicNumbers: Array(atomicNumbers.prefix(n)), positions: points, name: name)
    }

    public func graph() -> BondGraph {
        let points = molecule()
        let links = bonds.compactMap { entry -> GraphBond? in
            guard entry.count == 4, let kind = BondKind(rawValue: UInt8(clamping: entry[2])) else { return nil }
            let order: BondOrder = switch entry[3] {
            case 3: .delocalized
            case 4: .double
            case 6: .triple
            default: .single
            }
            guard entry[0] >= 0, entry[1] >= 0, entry[0] < points.count, entry[1] < points.count else { return nil }
            let length = Float((points.position(entry[0]) - points.position(entry[1])).length)
            return GraphBond(i: entry[0], j: entry[1], kind: kind, order: order, length: length)
        }
        return BondGraph(atomCount: points.count, bonds: links)
    }

    public func validate() -> [String] {
        var issues: [String] = []
        if atomicNumbers.isEmpty { issues.append("structure has no atoms") }
        if positions.count != 3 * atomicNumbers.count { issues.append("structure needs 3 coordinates per atom") }
        if !positions.allSatisfy(\.isFinite) { issues.append("structure has a non-finite coordinate") }
        if atomicNumbers.contains(where: { !(1...118).contains($0) }) {
            issues.append("structure has an atomic number outside 1...118")
        }
        for entry in bonds {
            guard entry.count == 4, entry[0] != entry[1],
                  atomicNumbers.indices.contains(entry[0]), atomicNumbers.indices.contains(entry[1]),
                  (0...2).contains(entry[2]), [2, 3, 4, 6].contains(entry[3]) else {
                issues.append("bond \(entry) is not [i, j, kind, order×2] within the structure")
                continue
            }
        }
        return issues
    }
}

/// How the player came by it.
public struct Earned: Sendable, Equatable, Codable {
    public enum How: String, Sendable, Codable, CaseIterable {
        /// Spawned from the library (any molecule, no gating: D6).
        case spawned
        /// Snapped together from loose atoms.
        case built
        /// A fragment kept after a break.
        case broken
        /// Lupi Daily's molecule of the day.
        case daily
        /// Found with Scan.
        case scan
        /// An OMol25 specimen.
        case specimen
    }

    public var how: How
    public var at: Date
    /// "Found in: coffee mug", "Broke off caffeine".
    public var note: String?

    public init(how: How, at: Date = Date(), note: String? = nil) {
        self.how = how
        self.at = at
        self.note = note
    }
}

/// A Remix code and the Foil finish it rolled.
public struct RemixLook: Sendable, Equatable, Codable {
    public enum Finish: String, Sendable, Codable, CaseIterable {
        case holo
        case goldLeaf = "gold-leaf"
        case pearl
    }

    /// `r1-K7QDM`: five Crockford base32 characters.
    public var code: String
    public var finish: Finish?

    public init(code: String, finish: Finish? = nil) {
        self.code = code
        self.finish = finish
    }

    public static func isValidCode(_ code: String) -> Bool {
        let crockford = Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
        return code.count == 8 && code.hasPrefix("r1-") && code.dropFirst(3).allSatisfy { crockford.contains($0) }
    }
}
