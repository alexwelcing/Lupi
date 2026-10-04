import Foundation
import LupiChem

/// The molecules bundled with the app (Resources/starters, written by
/// tools/apple/bundle-starters.mts), so play works offline from first launch.
public struct Starter: Sendable, Equatable, Codable, Identifiable {
    public var id: String
    public var name: String
    /// Hill formula.
    public var formula: String
    public var atoms: Int
    /// File name inside the starters folder.
    public var file: String
    /// The repo file it was copied from, or the generator for written geometries.
    public var source: String
    /// Where a written geometry comes from (bond lengths and their reference).
    public var geometry: String?
    public var sha256: String
}

public struct StarterManifest: Sendable, Equatable, Codable {
    public static let schemaID = "lupi.starters.v1"

    public var schema: String
    public var generator: String
    public var starters: [Starter]
}

public enum StarterError: Error, Equatable {
    case missingResource(String)
    case integrity(String)
}

public enum Starters {
    /// The bundled folder.
    public static var directory: URL {
        get throws {
            guard let url = Bundle.module.url(forResource: "starters", withExtension: nil) else {
                throw StarterError.missingResource("starters")
            }
            return url
        }
    }

    public static func manifest() throws -> StarterManifest {
        let data = try Data(contentsOf: try directory.appendingPathComponent("starters.json"))
        return try LupiJSON.decoder().decode(StarterManifest.self, from: data)
    }

    /// The starter's XYZ, checked against the manifest's sha256.
    public static func xyz(_ starter: Starter) throws -> String {
        guard !starter.file.contains("/") else { throw StarterError.missingResource(starter.file) }
        let url = try directory.appendingPathComponent(starter.file)
        guard let data = try? Data(contentsOf: url) else { throw StarterError.missingResource(starter.file) }
        guard SHA256.hex(data) == starter.sha256 else { throw StarterError.integrity(starter.file) }
        return String(decoding: data, as: UTF8.self)
    }

    public static func molecule(_ starter: Starter) throws -> Molecule {
        try Molecule(xyz: try xyz(starter), name: starter.name)
    }

    /// The trophy reference for a starter.
    public static func trophyMolecule(_ starter: Starter) -> TrophyMolecule {
        TrophyMolecule(
            source: .starter, ref: starter.id, name: starter.name, formula: starter.formula, atomCount: starter.atoms,
            url: "starters/\(starter.file)", sha256: starter.sha256, bondRecipe: BondRecipe.molecular.rawValue
        )
    }
}
