import Foundation
import LupiChem
import LupiData
import LupiScale
import LupiScaleCore
import LupiSync

/// Where a body came from: what a keep needs to write the trophy's contract fields
/// (contracts.md §1.3) beside its scale reference.
public enum Provenance: Sendable, Hashable {
    /// A gallery molecule: its page id, the file on lupi.live and the SHA-256 the page prints.
    case gallery(id: String, url: URL, sha256: String)
    /// A PubChem 3D conformer and the PUG-REST record it came from.
    case pubchem(cid: Int, url: URL)
    /// An OMol25 row (`<collection>:<row>`), its structure URL and the hash of the response.
    case omol25(id: String, url: URL, sha256: String)
    /// Kept by its scale reference alone: a crystal, a tower, a geometry the app writes itself.
    case scale
    /// Broken off another body (scale-spec §10.6).
    case piece(parent: ParentRef)
    /// Snapped together from atoms and pieces (plan §4.5).
    case built(BuiltStory)
    /// A trophy brought back into play, or a body already kept.
    case trophy(TrophyRecord)

    /// The PUG-REST record of a compound's 3D conformer (contracts.md §4.3, request 2).
    public static func pubchemRecordURL(cid: Int) -> URL {
        URL(string: "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/\(cid)/record/JSON?record_type=3d")!
    }

    /// The origin `https://lupi.live` that gallery paths hang from.
    public static let lupiOrigin = "https://lupi.live"
}

/// Why a piece cannot be kept or a trophy cannot come back.
public enum KeepError: Error, Equatable, Sendable, CustomStringConvertible {
    case noSuchBody
    /// scale-spec §7.2: past 163,840 bytes, and too big to keep as its own leaf.
    case tooIntricate
    /// The record and what its reference regenerates disagree (scale-spec §7.4, "on load").
    case corrupt(String)
    /// A record this build cannot bring back (no scale reference, and nothing bundled matches).
    case unsupported(String)

    public var description: String {
        switch self {
        case .noSuchBody: "That piece is gone"
        case .tooIntricate: "This piece is too intricate to keep"
        case let .corrupt(why): "This trophy does not match its own record: \(why)"
        case let .unsupported(why): "This trophy cannot come back into play yet: \(why)"
        }
    }
}

/// Writing a trophy for a piece in play (contracts.md §1, scale-spec §7.2, §7.4).
public enum Keep {
    /// The account sync refuses a record whose JSON passes this (account-and-sync.md §3).
    public static let maxRecordBytes = 256 * 1024

    /// The trophy of `body`. Every keep writes the piece's `lupi.scale-ref.v1`, with each record
    /// its resolution reads embedded, so it regenerates offline, forever; the other fields follow
    /// where the body came from.
    public static func record(
        for body: Body, id: UUID, name: String?, now: Date, sessionTime: Double, resolver: Resolver
    ) throws -> TrophyRecord {
        let stamp = Self.millisecond(now)
        if case let .trophy(kept) = body.provenance {
            return try rekeep(kept, body: body, now: stamp, resolver: resolver)
        }
        let ref = body.identity
        guard (try? ref.encoded()) != nil else { throw KeepError.tooIntricate }
        let (view, count) = try ref.resolve(extra: resolver.store)
        let unit = try resolver.composition(view).formula
        let molecule = try Self.molecule(of: view, count: count, resolver: resolver)
        let field = try Self.field(ref: ref, count: count, body: body, resolver: resolver)
        let bornAt = Self.millisecond(stamp.addingTimeInterval(-(sessionTime - body.bornAt)))
        let fallback = molecule?.hillFormula ?? unit
        let title = TrophyRecord.cleanName(name ?? body.name, fallback: fallback)

        var source: MoleculeSource
        var moleculeRef: MoleculeRef
        var origin = TrophyOrigin(kind: .spawned, at: bornAt)
        switch body.provenance {
        case let .gallery(page, url, sha256):
            guard let molecule else { throw KeepError.corrupt("a gallery molecule that is not a molecule") }
            source = .gallery
            moleculeRef = MoleculeRef(source: source, id: page, url: url, sha256: sha256, formula: molecule.hillFormula, atoms: molecule.count, scale: field)
        case let .omol25(row, url, sha256):
            guard let molecule else { throw KeepError.corrupt("an OMol25 row that is not a molecule") }
            source = .omol25
            moleculeRef = MoleculeRef(source: source, id: row, url: url, sha256: sha256, formula: molecule.hillFormula, atoms: molecule.count, scale: field)
        case let .pubchem(cid, url):
            guard let molecule else { throw KeepError.corrupt("a PubChem molecule that is not a molecule") }
            source = .pubchem
            let xyz = XYZWriter.embedded(molecule, title: title, source: "pubchem:cid:\(cid)")
            moleculeRef = MoleculeRef(
                source: source, id: "cid:\(cid)", url: url, sha256: SHA256.hex(xyz), formula: molecule.hillFormula,
                atoms: molecule.count, xyz: xyz, scale: field
            )
        case let .piece(parent):
            origin = TrophyOrigin(kind: .broken, at: bornAt, parent: parent)
            if let molecule, try resolver.store.record(ref.root).kindByte == NodeKind.leaf.rawValue {
                // A selection of a molecule's atoms is a fragment: a new molecule with its XYZ.
                source = .fragment
                let rows = body.omolRows.isEmpty && parent.source == .omol25 ? parent.id.map { [$0] } ?? [] : body.omolRows
                let omol = Self.attribution(rows)
                let xyz = XYZWriter.embedded(
                    molecule, title: "Lupi fragment", parent: parent.formula, source: omol, license: omol == nil ? nil : "CC-BY-4.0"
                )
                moleculeRef = MoleculeRef(
                    source: source, sha256: SHA256.hex(xyz), formula: molecule.hillFormula, atoms: molecule.count, xyz: xyz, scale: field
                )
            } else {
                source = .scale
                moleculeRef = Self.scaleRef(ref: ref, unit: unit, count: count, molecule: molecule, title: title, field: field)
            }
        case let .built(story):
            // A built molecule embeds its XYZ (contracts.md §1.3); its reference is its own leaf.
            guard let molecule else { throw KeepError.corrupt("a built molecule that is not a molecule") }
            source = .built
            let omol = Self.attribution(body.omolRows)
            let xyz = XYZWriter.embedded(molecule, title: "Lupi built", source: omol, license: omol == nil ? nil : "CC-BY-4.0")
            moleculeRef = MoleculeRef(
                source: source, sha256: SHA256.hex(xyz), formula: molecule.hillFormula, atoms: molecule.count, xyz: xyz, scale: field
            )
            origin = TrophyOrigin(kind: .built, at: bornAt, parts: story.parts)
        case .scale:
            source = .scale
            moleculeRef = Self.scaleRef(ref: ref, unit: unit, count: count, molecule: molecule, title: title, field: field)
        case .trophy:
            preconditionFailure("handled above")
        }
        let look = TrophyLook(scale: source == .scale ? 0 : Self.lookScale(body, resolver: resolver))
        var record = TrophyRecord(id: id, name: title, molecule: moleculeRef, origin: origin, look: look, createdAt: stamp)
        try Self.fit(&record)
        let issues = record.validate()
        guard issues.isEmpty else { throw KeepError.corrupt(issues.joined(separator: "; ")) }
        return record
    }

    /// A body that already is a trophy keeps its record: only its size can have changed.
    static func rekeep(_ kept: TrophyRecord, body: Body, now: Date, resolver: Resolver) throws -> TrophyRecord {
        var record = kept
        if kept.molecule.source == .scale {
            let span = Self.span(body, resolver: resolver)
            if record.molecule.scale?.spanMetres != span { record.molecule.scale?.spanMetres = span }
        } else {
            let scale = Self.lookScale(body, resolver: resolver)
            if record.look.scale != scale { record.look.scale = scale }
            let span = Self.span(body, resolver: resolver)
            if record.molecule.scale != nil, record.molecule.scale?.spanMetres != span { record.molecule.scale?.spanMetres = span }
        }
        if record != kept { record.updatedAt = max(kept.updatedAt, now) }
        return record
    }

    /// The XYZ `source=` that credits OMol25 rows (CC BY 4.0, contracts.md §1.3); several rows
    /// are joined with commas, since a value holds no spaces.
    static func attribution(_ rows: [String]) -> String? {
        rows.isEmpty ? nil : rows.map { "omol25:\($0)" }.joined(separator: ",")
    }

    static func scaleRef(ref: ScaleRef, unit: String, count: Magnitude, molecule: Molecule?, title: String, field: ScaleRefField) -> MoleculeRef {
        // A materializable piece of at most 2,000 atoms MAY embed its XYZ (scale-spec §7.4), so
        // the web can open it; the reference stays authoritative.
        let xyz = molecule.map { XYZWriter.embedded($0, title: title) }
        return MoleculeRef(
            source: .scale, sha256: ref.key.hex, formula: unit, atoms: Self.atoms(count), xyz: xyz, scale: field
        )
    }

    /// The piece's atoms when it materializes as a molecule of at most 2,000 (the cap of embedded XYZ).
    static func molecule(of view: View, count: Magnitude, resolver: Resolver) throws -> Molecule? {
        guard let n = count.plain, n <= BigUInt(MoleculeRef.maxEmbeddedAtoms), resolver.isMaterializable(view) else { return nil }
        let leaf = try resolver.materialize(view)
        return Molecule(atomicNumbers: leaf.atomicNumbers.map(Int.init), positions: leaf.positions)
    }

    static func field(ref: ScaleRef, count: Magnitude, body: Body, resolver: Resolver) throws -> ScaleRefField {
        let agg = body.facts.aggregate
        let half = agg.bounds.halfExtents
        let longest = max(half.x, max(half.y, half.z))
        let extents = longest > 0 ? [half.x, half.y, half.z].map { Float($0 / longest) } : [1, 1, 1]
        return ScaleRefField(
            ref: ref.text, count: count.formatted, spanMetres: Self.span(body, resolver: resolver),
            aggregate: ScaleAggregate(extents: extents, colour: Self.hexColour(agg.colour))
        )
    }

    /// Longest displayed span, metres, within the contract's 0.005...3.
    static func span(_ body: Body, resolver: Resolver) -> Float {
        let span = Float(body.nodeSpan(resolver))
        return min(ScaleRefField.spanRange.upperBound, max(ScaleRefField.spanRange.lowerBound, span.isFinite ? span : 0.15))
    }

    /// Metres per ångström: σ of a node whose frame is in Å (leaves and their selections).
    static func lookScale(_ body: Body, resolver: Resolver) -> Float {
        let sigma = Float(body.nodePose(resolver).sigma)
        return min(TrophyLook.scaleRange.upperBound, max(TrophyLook.scaleRange.lowerBound, sigma.isFinite ? sigma : 0.015))
    }

    /// The count when it is at most 2⁵³ − 1, else 2⁵³ − 1 (scale-spec §7.4).
    static func atoms(_ count: Magnitude) -> Int {
        guard let n = count.plain?.int, n <= MoleculeRef.maxExactAtoms else { return MoleculeRef.maxExactAtoms }
        return n
    }

    /// Under the sync's 256 KiB: a scale piece drops its optional XYZ first; anything else that
    /// cannot fit is refused (scale-spec §7.4).
    static func fit(_ record: inout TrophyRecord) throws {
        func size() throws -> Int { try LupiJSON.encoder().encode(record).count }
        if try size() <= maxRecordBytes { return }
        if record.molecule.source == .scale, record.molecule.xyz != nil {
            record.molecule.xyz = nil
            if try size() <= maxRecordBytes { return }
        }
        throw KeepError.tooIntricate
    }

    static func hexColour(_ c: Vec3) -> String {
        func byte(_ v: Double) -> String {
            let b = Int((min(1, max(0, v.isFinite ? v : 0)) * 255).rounded())
            let digits = Array("0123456789abcdef")
            return String([digits[b >> 4], digits[b & 15]])
        }
        return "#" + byte(c.x) + byte(c.y) + byte(c.z)
    }

    /// Dates the contract can carry exactly (ISO 8601 with milliseconds).
    static func millisecond(_ date: Date) -> Date {
        Date(timeIntervalSince1970: (date.timeIntervalSince1970 * 1000).rounded() / 1000)
    }
}

/// A trophy brought back: the piece it names, checked against the record (scale-spec §7.3, §7.4).
public struct RestoredPiece: Sendable {
    /// The piece exactly: what a keep wrote.
    public var identity: ScaleRef
    /// What the cut draws: the identity, or a leaf of its own atoms (as break pieces are drawn).
    public var display: ScaleRef
    public var name: String
    public var count: Magnitude
    /// σ of the piece's own node, metres per node unit.
    public var metresPerUnit: Double
}

public enum Restore {
    /// Resolves a trophy's reference and checks that it is the piece the record says: its refKey,
    /// its count as printed, its formula and atom count. A record without a reference (an older
    /// writer) comes back through the bundled catalog when its file matches.
    public static func piece(_ trophy: TrophyRecord, catalog: Catalog, store: GameStore) throws -> RestoredPiece {
        guard trophy.deletedAt == nil else { throw KeepError.unsupported("it was deleted") }
        guard let field = trophy.molecule.scale else {
            return try bundled(trophy, catalog: catalog, store: store)
        }
        let identity: ScaleRef
        do {
            identity = try ScaleRef(text: field.ref)
        } catch {
            throw KeepError.corrupt("its reference does not decode (\(error))")
        }
        let resolved: (view: View, count: Magnitude)
        do {
            resolved = try identity.resolve(extra: store)
        } catch {
            throw KeepError.corrupt("its reference does not resolve (\(error))")
        }
        let resolver = Resolver(store: StoreUnion([RecordStore(identity.records), store]))
        let count = resolved.count
        guard count.formatted == field.count else { throw KeepError.corrupt("count \(count.formatted), record says \(field.count)") }
        let unit = try resolver.composition(resolved.view).formula
        let molecule = try Keep.molecule(of: resolved.view, count: count, resolver: resolver)
        switch trophy.molecule.source {
        case .scale:
            guard trophy.molecule.sha256 == identity.key.hex else { throw KeepError.corrupt("sha256 is not its refKey") }
            guard trophy.molecule.formula == unit else { throw KeepError.corrupt("formula \(trophy.molecule.formula), unit is \(unit)") }
        default:
            guard let molecule else { throw KeepError.corrupt("a \(trophy.molecule.source.rawValue) trophy that is not a molecule") }
            guard trophy.molecule.formula == molecule.hillFormula else {
                throw KeepError.corrupt("formula \(trophy.molecule.formula), atoms say \(molecule.hillFormula)")
            }
        }
        guard trophy.molecule.atoms == Keep.atoms(count) else { throw KeepError.corrupt("atoms \(trophy.molecule.atoms), count \(count.formatted)") }
        store.add(identity.records)
        let display = try displayRef(identity, view: resolved.view, count: count, resolver: resolver, store: store)
        let agg = try resolver.aggregate(resolved.view)
        let sigma: Double
        if trophy.molecule.source == .scale || trophy.look.scale <= 0 {
            sigma = Double(field.spanMetres) / max(agg.bounds.longest, 1e-300)
        } else {
            sigma = Double(trophy.look.scale)
        }
        return RestoredPiece(identity: identity, display: display, name: trophy.name, count: count, metresPerUnit: sigma)
    }

    /// The reference the cut draws: a piece that is not a leaf but materializes small enough for
    /// a merged mesh is drawn through a leaf of its own atoms, as a break's pieces are (M0).
    static func displayRef(_ identity: ScaleRef, view: View, count: Magnitude, resolver: Resolver, store: GameStore) throws -> ScaleRef {
        guard view.kind != .leaf, count.plain.map({ $0 <= BigUInt(CutTuning.meshAtoms) }) ?? false, resolver.isMaterializable(view) else {
            return identity
        }
        let leaf = try NodeRecord(.leaf(resolver.materialize(view)))
        store.add([leaf])
        return ScaleRef(root: leaf.id, records: [leaf], path: Path(), probe: leaf.id)
    }

    /// A gallery trophy written without a reference (the contract's own example): the bundled
    /// starter of that page, when its file is the one the record hashed.
    static func bundled(_ trophy: TrophyRecord, catalog: Catalog, store: GameStore) throws -> RestoredPiece {
        guard trophy.molecule.source == .gallery, let page = trophy.molecule.id, let entry = catalog.starters[page],
              entry.starter.sha256 == trophy.molecule.sha256 else {
            throw KeepError.unsupported("it has no scale reference and nothing bundled matches it")
        }
        let content = try catalog.content(.starter(page))
        store.add(content.ref.records)
        let (_, count) = try content.ref.resolve(extra: store)
        let sigma = trophy.look.scale > 0 ? Double(trophy.look.scale) : 0.015
        return RestoredPiece(identity: content.ref, display: content.ref, name: trophy.name, count: count, metresPerUnit: sigma)
    }
}

// The trophy is the record LupiSync carries (account-and-sync.md §7, step 10): its UUID is
// the document id and `deletedAt` makes it a tombstone.
extension TrophyRecord: @retroactive SyncPayload {
    public var isSyncTombstone: Bool { deletedAt != nil }
}
