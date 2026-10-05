import Foundation
import LupiChem

/// A molecule Lupi knows by name, as a connectivity graph (plan §4.5, "Done").
public struct KnownMolecule: Sendable, Hashable {
    public enum Source: String, Sendable, Hashable, Codable {
        /// A molecule the app bundles (LupiData's starters).
        case starter
        /// A lupi.live gallery page.
        case gallery
        /// A featured OMol25 pick (CC BY 4.0; its name is its formula).
        case omol25
    }

    /// The starter or gallery page id, or `<collection>:<row>` for an OMol25 pick.
    public var id: String
    public var name: String
    public var source: Source
    public var graph: MolecularGraph

    public init(id: String, name: String, source: Source, graph: MolecularGraph) {
        self.id = id
        self.name = name
        self.source = source
        self.graph = graph
    }

    public var formula: String { graph.formula }
}

public enum KnownMoleculesError: Error, Equatable {
    case missingResource
    case schema(String)
}

/// The molecules a built molecule may be named after: the bundled starters, then the
/// gallery and the OMol25 picks of `known-molecules.json` (written by
/// tools/apple/bundle-known.mts with the TypeScript recipe). A match needs the same
/// formula and an isomorphic graph, so ethanol and dimethyl ether never trade names.
public struct KnownMolecules: Sendable {
    public static let schemaID = "lupi.known-molecules.v1"

    public private(set) var molecules: [KnownMolecule] = []
    private var index: [Key: [Int]] = [:]

    struct Key: Hashable {
        var formula: String
        var signature: UInt64
    }

    public init(_ molecules: [KnownMolecule] = []) {
        for m in molecules { append(m) }
    }

    public var count: Int { molecules.count }

    /// Adds a molecule after those already known; an earlier one wins a tie. An id already
    /// present is skipped, so a starter copied from the gallery is known once.
    public mutating func append(_ m: KnownMolecule) {
        guard !molecules.contains(where: { $0.id == m.id }) else { return }
        index[Key(formula: m.formula, signature: m.graph.signature), default: []].append(molecules.count)
        molecules.append(m)
    }

    /// The first known molecule with this graph.
    public func match(_ graph: MolecularGraph) -> KnownMolecule? {
        guard let candidates = index[Key(formula: graph.formula, signature: graph.signature)] else { return nil }
        return candidates.lazy.map { self.molecules[$0] }.first { $0.graph.isIsomorphic(to: graph) }
    }

    /// The bundled index.
    public static func bundledIndex() throws -> [KnownMolecule] {
        guard let url = Bundle.module.url(forResource: "known-molecules", withExtension: "json") else {
            throw KnownMoleculesError.missingResource
        }
        return try decode(Data(contentsOf: url))
    }

    static func decode(_ data: Data) throws -> [KnownMolecule] {
        let file = try JSONDecoder().decode(File.self, from: data)
        guard file.schema == schemaID else { throw KnownMoleculesError.schema(file.schema) }
        return try file.molecules.map { entry in
            let links = try entry.links.map { l -> MolecularGraph.Link in
                guard l.count == 3, let kind = BondKind(rawValue: UInt8(clamping: l[2])) else {
                    throw KnownMoleculesError.schema("link \(l) of \(entry.id)")
                }
                return MolecularGraph.Link(i: l[0], j: l[1], kind: kind)
            }
            return KnownMolecule(
                id: entry.id, name: entry.name, source: entry.source,
                graph: MolecularGraph(atomicNumbers: entry.z, links: links)
            )
        }
    }

    /// The starters (perceived here, by the play graph) and then the bundled index.
    public static func bundled(starters: [(Starter, Molecule)]) throws -> KnownMolecules {
        var known = KnownMolecules()
        for (starter, molecule) in starters {
            let graph = MolecularGraph(molecule: molecule, graph: BondGraph.forPlay(molecule))
            guard graph.isConnected else { continue }
            known.append(KnownMolecule(id: starter.id, name: starter.name, source: .starter, graph: graph))
        }
        for m in try bundledIndex() { known.append(m) }
        return known
    }

    struct File: Decodable {
        var schema: String
        var molecules: [Entry]
    }

    struct Entry: Decodable {
        var id: String
        var name: String
        var source: KnownMolecule.Source
        var z: [Int]
        var links: [[Int]]
    }
}
