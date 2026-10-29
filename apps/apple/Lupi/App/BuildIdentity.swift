import Foundation

/// Metadata stamped into the built app, never inferred from the checkout at runtime.
/// No account configuration or environment variables are included in diagnostics.
struct BuildIdentity: Codable, Equatable, Sendable {
    enum WorkTree: String, Codable, Sendable { case clean, dirty, unknown }

    var revision: String?
    var workTree: WorkTree
    var builtAt: String?
    var version: String
    var build: String

    static var current: BuildIdentity { load(bundle: .main) }

    var shortRevision: String { revision.map { String($0.prefix(10)) } ?? "Unavailable" }
    var revisionLabel: String {
        guard revision != nil else { return "Unavailable" }
        return shortRevision + (workTree == .dirty ? " · modified source" : workTree == .unknown ? " · source state unknown" : "")
    }
    var versionLabel: String { "\(version) (\(build))" }

    static func load(bundle: Bundle) -> BuildIdentity {
        let data = bundle.url(forResource: "LupiBuildIdentity", withExtension: "json").flatMap { try? Data(contentsOf: $0) }
        return load(data: data,
                    version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
                    build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String)
    }

    /// A missing, stale-format or malformed stamp stays explicitly unavailable.
    static func load(data: Data?, version: String? = nil, build: String? = nil) -> BuildIdentity {
        var identity = BuildIdentity(revision: nil, workTree: .unknown, builtAt: nil,
                                     version: versionNumber(version), build: versionNumber(build))
        guard let data, let stamp = try? JSONDecoder().decode(Stamp.self, from: data), stamp.schemaVersion == 1 else { return identity }
        if let revision = stamp.revision,
           [40, 64].contains(revision.count), revision.allSatisfy({ $0.isHexDigit && $0.isASCII }) {
            identity.revision = revision.lowercased()
            identity.workTree = stamp.workTree
        }
        if let at = stamp.builtAt, ISO8601DateFormatter().date(from: at) != nil { identity.builtAt = at }
        return identity
    }

    var diagnosticText: String {
        "Lupi native build\nVersion: \(versionLabel)\nRevision: \(revision ?? "unavailable")\nSource state: \(workTree.rawValue)\nBuilt: \(builtAt ?? "unavailable")\n"
    }

    private struct Stamp: Decodable {
        var schemaVersion: Int
        var revision: String?
        var workTree: WorkTree
        var builtAt: String?
    }

    private static func versionNumber(_ value: String?) -> String {
        guard let value, !value.isEmpty, value.count <= 32,
              value.allSatisfy({ $0.isASCII && ($0.isNumber || $0 == ".") }) else { return "unavailable" }
        return value
    }
}
