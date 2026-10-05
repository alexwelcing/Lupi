import Foundation
import LupiChem

/// `lupi.trophy.v1` (contracts.md §1, amended by scale-spec §7.4): one molecule
/// or piece in the player's collection. It lives on the device and, signed in,
/// on the Lupi account (D7). It never holds a room map, a placement or a camera
/// image; where a trophy sits is a `lupi.shelf.v1` placement on the device.
public struct TrophyRecord: Codable, Sendable, Hashable, Identifiable {
    public static let schemaID = "lupi.trophy.v1"
    /// `name` is 1...80 characters.
    public static let maxNameLength = 80

    public var schema: String
    public var id: UUID
    public var name: String
    public var molecule: MoleculeRef
    public var origin: TrophyOrigin
    public var look: TrophyLook
    public var createdAt: Date
    /// The record's own last edit; the sync engine compares its envelope's
    /// `clientUpdatedAt`, never this (account-and-sync.md §3).
    public var updatedAt: Date
    /// A tombstone: set on delete, `molecule.xyz` dropped.
    public var deletedAt: Date?

    public init(
        id: UUID = UUID(), name: String, molecule: MoleculeRef, origin: TrophyOrigin, look: TrophyLook,
        createdAt: Date, updatedAt: Date? = nil, deletedAt: Date? = nil
    ) {
        schema = Self.schemaID
        self.id = id
        self.name = name
        self.molecule = molecule
        self.origin = origin
        self.look = look
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
    }

    /// A name the contract accepts: control characters and runs of whitespace become
    /// one space, at most 80 characters; `fallback` when nothing is left.
    public static func cleanName(_ raw: String, fallback: String) -> String {
        var out = ""
        var space = false
        for ch in raw {
            if ch.isWhitespace || ch.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) {
                space = !out.isEmpty
                continue
            }
            if space { out.append(" ") }
            space = false
            out.append(ch)
        }
        let cut = String(out.prefix(maxNameLength))
        return cut.isEmpty ? String(fallback.prefix(maxNameLength)) : cut
    }

    /// This record deleted: the tombstone keeps the record for sync and drops the embedded XYZ.
    public func tombstone(at date: Date) -> TrophyRecord {
        var copy = self
        copy.deletedAt = date
        copy.updatedAt = max(updatedAt, date)
        copy.molecule.xyz = nil
        return copy
    }

    /// What is wrong with this record, empty when it is valid.
    public func validate() -> [String] {
        var issues: [String] = []
        if schema != Self.schemaID { issues.append("schema is \(schema), expected \(Self.schemaID)") }
        if name.isEmpty || name.count > Self.maxNameLength { issues.append("name has \(name.count) characters, expected 1...80") }
        if name.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) {
            issues.append("name has a control character")
        }
        if updatedAt < createdAt { issues.append("updatedAt is before createdAt") }
        issues += molecule.validate(tombstone: deletedAt != nil)
        issues += origin.validate()
        issues += look.validate(source: molecule.source)
        let expectedKind: TrophyOrigin.Kind? = switch molecule.source {
        case .gallery, .omol25, .pubchem: .spawned
        case .built: .built
        case .fragment: .broken
        case .scale: nil
        }
        if let expectedKind, origin.kind != expectedKind {
            issues.append("a \(molecule.source.rawValue) trophy has origin \(expectedKind.rawValue), not \(origin.kind.rawValue)")
        }
        return issues
    }
}

public enum MoleculeSource: String, Codable, Sendable, Hashable, CaseIterable {
    case gallery, omol25, pubchem, built, fragment
    /// A piece of a LupiScale structure of any count (scale-spec §7.4).
    case scale
}

/// Which molecule a trophy is (contracts.md §1.3).
public struct MoleculeRef: Codable, Sendable, Hashable {
    /// `xyz` is embedded only up to the molecular recipe's cap.
    public static let maxEmbeddedAtoms = 2000
    /// `atoms` saturates here for larger counts; `scale.count` is authoritative.
    public static let maxExactAtoms = 9_007_199_254_740_991

    public var source: MoleculeSource
    /// Gallery page id, `<collection>:<row>` or `cid:<n>`.
    public var id: String?
    /// Where the coordinates came from (https).
    public var url: URL?
    /// SHA-256 as 64 lowercase hex: of the file, of the embedded `xyz`, or the refKey for `scale`.
    public var sha256: String
    /// Hill formula of the atoms as played; for `scale`, of one unit (scale-spec §5.3).
    public var formula: String
    public var atoms: Int
    /// Embedded XYZ (§1.4), at most 2,000 atoms.
    public var xyz: String?
    /// The piece as a `lupi.scale-ref.v1` (scale-spec §7.4): required for `scale`, optional otherwise.
    public var scale: ScaleRefField?

    public init(
        source: MoleculeSource, id: String? = nil, url: URL? = nil, sha256: String, formula: String, atoms: Int,
        xyz: String? = nil, scale: ScaleRefField? = nil
    ) {
        self.source = source
        self.id = id
        self.url = url
        self.sha256 = sha256
        self.formula = formula
        self.atoms = atoms
        self.xyz = xyz
        self.scale = scale
    }

    /// The OMol25 collections a trophy may name (`packages/core/src/omol25/collections.ts`).
    public static let omolCollections: Set<String> = [
        "neutral-train", "neutral-validation", "all-train-preview", "train-4m-preview", "validation-preview",
    ]

    func validate(tombstone: Bool) -> [String] {
        var issues: [String] = []
        if !Hex.isSHA256(sha256) { issues.append("sha256 is not 64 lowercase hex digits") }
        if !Self.isFormula(formula) { issues.append("formula \(formula) is not a formula") }
        if atoms < 1 { issues.append("atoms must be at least 1") }
        if let url, url.scheme != "https" { issues.append("url must be https") }
        switch source {
        case .gallery:
            let pageID = id.map { !$0.isEmpty && $0.allSatisfy { $0.isASCII && ($0.isLowercase || $0.isNumber || $0 == "_") } } ?? false
            if !pageID { issues.append("a gallery trophy needs its page id") }
            if url == nil { issues.append("a gallery trophy needs its url") }
            if xyz != nil { issues.append("a gallery trophy embeds no xyz") }
        case .omol25:
            let parts = id?.split(separator: ":", omittingEmptySubsequences: false) ?? []
            if parts.count != 2 || !Self.omolCollections.contains(String(parts[0])) || parts[1].isEmpty || !parts[1].allSatisfy(\.isNumber) {
                issues.append("an omol25 trophy's id is <collection>:<row>")
            }
            if url == nil { issues.append("an omol25 trophy needs its url") }
            if xyz != nil { issues.append("an omol25 trophy embeds no xyz") }
        case .pubchem:
            if !(id.map { $0.hasPrefix("cid:") && $0.count > 4 && $0.dropFirst(4).allSatisfy(\.isNumber) } ?? false) {
                issues.append("a pubchem trophy's id is cid:<n>")
            }
            if url == nil { issues.append("a pubchem trophy needs the record url it used") }
            if xyz == nil && !tombstone { issues.append("a pubchem trophy embeds its coordinates") }
        case .built, .fragment:
            if id != nil || url != nil { issues.append("a \(source.rawValue) trophy has no id or url") }
            if xyz == nil && !tombstone { issues.append("a \(source.rawValue) trophy embeds its coordinates") }
        case .scale:
            if scale == nil { issues.append("a scale trophy needs its scale reference") }
        }
        if let scale { issues += scale.validate() }
        if let xyz {
            // Every source that embeds XYZ hashes it, except a scale piece, whose sha256 is its refKey.
            if source != .scale && SHA256.hex(xyz) != sha256 { issues.append("sha256 is not the hash of the embedded xyz") }
            do {
                let molecule = try Molecule(xyz: xyz)
                if molecule.count != atoms { issues.append("xyz has \(molecule.count) atoms, atoms says \(atoms)") }
                if molecule.count > Self.maxEmbeddedAtoms { issues.append("xyz is embedded only up to 2,000 atoms") }
                if source != .scale && molecule.hillFormula != formula {
                    issues.append("formula \(formula) is not the xyz's \(molecule.hillFormula)")
                }
            } catch {
                issues.append("xyz does not parse: \(error)")
            }
        }
        return issues
    }

    /// Element symbols with optional counts: "C8H10N4O2", "BrCl499Na500".
    static func isFormula(_ formula: String) -> Bool {
        let c = Array(formula.unicodeScalars)
        guard let first = c.first, first.properties.isUppercase else { return false }
        return c.allSatisfy { $0.isASCII && ($0.properties.isAlphabetic || ("0"..."9").contains($0)) }
    }
}

/// `MoleculeRef.scale` (scale-spec §7.4).
public struct ScaleRefField: Codable, Sendable, Hashable {
    public static let schemaID = "lupi.scale-ref.v1"
    /// The text form of a 163,840-byte reference (scale-spec §7.1).
    public static let maxRefCharacters = 218_459
    public static let spanRange: ClosedRange<Float> = 0.005...3

    public var schema: String
    /// `lsr1:` and the base64url of the reference.
    public var ref: String
    /// The count as scale-spec §5.4 prints it: a cache for plaques, re-checked on load.
    public var count: String
    /// Longest displayed extent when kept, metres.
    public var spanMetres: Float
    public var aggregate: ScaleAggregate?

    public init(ref: String, count: String, spanMetres: Float, aggregate: ScaleAggregate? = nil) {
        schema = Self.schemaID
        self.ref = ref
        self.count = count
        self.spanMetres = spanMetres
        self.aggregate = aggregate
    }

    func validate() -> [String] {
        var issues: [String] = []
        if schema != Self.schemaID { issues.append("scale.schema is \(schema)") }
        if !ref.hasPrefix("lsr1:") || ref.count > Self.maxRefCharacters { issues.append("scale.ref is not lsr1: text") }
        if count.isEmpty { issues.append("scale.count is empty") }
        if !Self.spanRange.contains(spanMetres) { issues.append("scale.spanMetres \(spanMetres) is outside 0.005...3") }
        if let aggregate { issues += aggregate.validate() }
        return issues
    }
}

/// Shape and colour to show while a dependency pack is missing (scale-spec §7.4).
public struct ScaleAggregate: Codable, Sendable, Hashable {
    /// Three extents along the node's axes, the longest 1.
    public var extents: [Float]
    /// `#rrggbb`.
    public var colour: String

    public init(extents: [Float], colour: String) {
        self.extents = extents
        self.colour = colour
    }

    func validate() -> [String] {
        var issues: [String] = []
        if extents.count != 3 || !extents.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }) || abs((extents.max() ?? 0) - 1) > 1e-6 {
            issues.append("scale.aggregate.extents are three values with the longest 1")
        }
        let hex = colour.dropFirst()
        if !colour.hasPrefix("#") || hex.count != 6 || !hex.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) {
            issues.append("scale.aggregate.colour is not #rrggbb")
        }
        return issues
    }
}

public struct TrophyOrigin: Codable, Sendable, Hashable {
    public enum Kind: String, Codable, Sendable, Hashable, CaseIterable { case spawned, broken, built }
    public static let maxParts = 64

    public var kind: Kind
    /// When it was spawned, broken off or completed.
    public var at: Date
    /// Required for `.broken`.
    public var parent: ParentRef?
    /// `.built`: the pieces joined, in snap order (formulas).
    public var parts: [String]?

    public init(kind: Kind, at: Date, parent: ParentRef? = nil, parts: [String]? = nil) {
        self.kind = kind
        self.at = at
        self.parent = parent
        self.parts = parts
    }

    func validate() -> [String] {
        var issues: [String] = []
        if kind == .broken && parent == nil { issues.append("a broken trophy names its parent") }
        if let parts, parts.count > Self.maxParts { issues.append("at most 64 parts") }
        if let parent, parent.name.isEmpty || parent.formula.isEmpty { issues.append("a parent needs its name and formula") }
        return issues
    }
}

public struct ParentRef: Codable, Sendable, Hashable {
    public var name: String
    public var formula: String
    public var source: MoleculeSource
    /// The parent's `MoleculeRef.id`, when it had one.
    public var id: String?
    /// When the parent was itself a trophy.
    public var trophyId: UUID?

    public init(name: String, formula: String, source: MoleculeSource, id: String? = nil, trophyId: UUID? = nil) {
        self.name = name
        self.formula = formula
        self.source = source
        self.id = id
        self.trophyId = trophyId
    }
}

public struct TrophyLook: Codable, Sendable, Hashable {
    public static let scaleRange: ClosedRange<Float> = 0.0005...0.5
    public static let finishes: Set<String> = ["holo", "gold-leaf", "pearl"]

    /// Toy scale when kept, metres per ångström. A `scale` piece writes 0: metres per
    /// ångström cannot express a googolplex at 20 cm, so its size is `scale.spanMetres`,
    /// the rule scale-spec §7.5 gives shelf placements.
    public var scale: Float
    /// Reserved; v1 writes none.
    public var finish: String?

    public init(scale: Float, finish: String? = nil) {
        self.scale = scale
        self.finish = finish
    }

    func validate(source: MoleculeSource) -> [String] {
        var issues: [String] = []
        if !(Self.scaleRange.contains(scale) || (source == .scale && scale == 0)) {
            issues.append("look.scale \(scale) is outside 0.0005...0.5")
        }
        if let finish, !Self.finishes.contains(finish) { issues.append("look.finish \(finish) is not a finish") }
        return issues
    }
}

extension TrophyRecord {
    /// The origin story the Cabinet shows (contracts.md §1.3), derived and never stored:
    /// "Spawned 4 Oct 2026", "Broken from Hydrogen peroxide", "Built from atoms: O, H, H".
    public func story(timeZone: TimeZone = .current) -> String {
        switch origin.kind {
        case .spawned:
            return "Spawned \(Self.day(origin.at, timeZone: timeZone))"
        case .broken:
            return "Broken from \(origin.parent?.name ?? "a molecule")"
        case .built:
            let parts = origin.parts ?? []
            return parts.isEmpty ? "Built from atoms" : "Built from atoms: \(parts.joined(separator: ", "))"
        }
    }

    /// "4 Oct 2026", in English whatever the locale, like the rest of the app.
    static func day(_ date: Date, timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return "\(c.day ?? 1) \(months[((c.month ?? 1) - 1) % 12]) \(c.year ?? 1970)"
    }
}

enum Hex {
    static func isSHA256(_ text: String) -> Bool {
        text.utf8.count == 64 && text.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
    }
}
