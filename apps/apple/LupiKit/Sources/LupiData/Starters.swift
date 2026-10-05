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

extension Starter {
    /// Where lupi.live serves a starter copied from the gallery: "/gallery/curated/popular/caffeine.xyz".
    /// Nil for the geometries the bundler writes.
    public var lupiPath: String? {
        let prefix = "apps/web/public/"
        guard source.hasPrefix(prefix) else { return nil }
        return "/" + source.dropFirst(prefix.count)
    }

    /// The PubChem compound a written geometry is the 3D conformer of ("PubChem CID 784 3D
    /// conformer, …"), when its geometry says so.
    public var pubchemCID: Int? {
        guard let geometry, let range = geometry.range(of: "PubChem CID ") else { return nil }
        return Int(geometry[range.upperBound...].prefix { $0.isNumber })
    }
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
}
