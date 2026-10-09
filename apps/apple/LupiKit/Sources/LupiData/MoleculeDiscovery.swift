import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A code-owned catalogue entry, generated from @atlas/core. Its CID identifies a
/// compound in chat; its id identifies a bundled starter in the native app. Those
/// structures may be different conformers, so discovery does not promise parity.
public struct DiscoveryCandidate: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var formula: String
    public var atoms: Int
    public var pubchemCid: Int
    public var aliases: [String]
    public var description: String
}

public struct DiscoveryCatalog: Codable, Sendable, Equatable {
    public static let version = "starters-v1"
    public var catalogVersion: String
    public var candidates: [DiscoveryCandidate]

    public static func bundled() throws -> DiscoveryCatalog {
        guard let url = Bundle.module.url(forResource: "discovery", withExtension: "json") else {
            throw EdgeError.decoding("Missing discovery catalogue")
        }
        let catalog = try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
        let starters = try Starters.manifest().starters
        guard catalog.catalogVersion == version,
              Set(catalog.candidates.map(\.id)).count == catalog.candidates.count,
              catalog.candidates.allSatisfy({ c in
                  c.pubchemCid > 0 && c.atoms > 0 && c.atoms <= 1000
                    && starters.contains { $0.id == c.id && $0.atoms == c.atoms && $0.formula == c.formula }
              }) else { throw EdgeError.decoding("Discovery catalogue does not match the bundled starters") }
        return catalog
    }

    /// Whole-input name and formula matching works offline, without Jev.
    public func exact(_ query: String) -> DiscoveryCandidate? {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return candidates.first { c in
            ([c.id, c.name, c.formula] + c.aliases).contains { $0.lowercased() == text }
        }
    }
}

public enum DiscoveryMethod: String, Codable, Sendable { case exact, jev, unavailable, uncertain }

public struct MoleculeRecommendation: Codable, Sendable, Equatable {
    public var schema: String
    public var catalogVersion: String
    public var query: String
    public var status: String
    public var method: DiscoveryMethod
    public var model: String?
    public var confidence: Double?
    public var candidates: [DiscoveryCandidate]
    public var note: String

    public var candidate: DiscoveryCandidate? { candidates.first }
}

public protocol DiscoveryTransport: Sendable {
    func post(_ url: URL, body: Data) async throws -> EdgeResponse
}

public struct URLSessionDiscoveryTransport: DiscoveryTransport {
    public init() {}
    public func post(_ url: URL, body: Data) async throws -> EdgeResponse {
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        return EdgeResponse(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: data)
    }
}

/// Jev stays on the edge. Only the typed query is sent, on explicit Find. A remote
/// answer must match a bundled entry in full before the app offers a Play button.
public struct MoleculeDiscoveryClient: Sendable {
    public let catalog: DiscoveryCatalog
    public let origin: URL
    public let transport: any DiscoveryTransport

    public init(catalog: DiscoveryCatalog, origin: URL = EdgeClient.defaultOrigin, transport: any DiscoveryTransport = URLSessionDiscoveryTransport()) {
        self.catalog = catalog
        self.origin = origin
        self.transport = transport
    }

    public func recommend(_ text: String) async throws -> MoleculeRecommendation {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, query.utf16.count <= 200 else { throw EdgeError.invalidRequest("Use 1–200 characters") }
        if let exact = catalog.exact(query) {
            return MoleculeRecommendation(
                schema: "lupi.discovery.v1", catalogVersion: catalog.catalogVersion, query: query,
                status: "matched", method: .exact, model: nil, confidence: nil, candidates: [exact],
                note: "Exact catalogue match. This molecule is bundled for offline play."
            )
        }
        let url = origin.appendingPathComponent("v1/discovery/molecule")
        let response = try await transport.post(url, body: JSONEncoder().encode(["query": query]))
        try Task.checkCancellation()
        guard response.status == 200 else { throw EdgeError.http(status: response.status, message: nil) }
        guard response.body.count <= 32 * 1024 else { throw EdgeError.decoding("Discovery response too large") }
        let result = try JSONDecoder().decode(MoleculeRecommendation.self, from: response.body)
        guard result.schema == "lupi.discovery.v1", result.catalogVersion == catalog.catalogVersion, result.query == query,
              result.note.count <= 1000,
              result.confidence.map({ $0.isFinite && (0...1).contains($0) }) ?? true else {
            throw EdgeError.decoding("Invalid discovery response")
        }
        switch result.status {
        case "matched":
            guard result.candidates.count == 1, let c = result.candidate, catalog.candidates.contains(c),
                  result.method == .exact || (result.method == .jev && (result.confidence ?? 0) >= 0.8 && !(result.model ?? "").isEmpty),
                  result.method != .exact || catalog.exact(query) == c else {
                throw EdgeError.decoding("Discovery answer is not a trusted catalogue match")
            }
        case "no-match":
            guard result.candidates.isEmpty, result.method == .unavailable || result.method == .uncertain else {
                throw EdgeError.decoding("Invalid withheld discovery answer")
            }
        default: throw EdgeError.decoding("Unknown discovery status")
        }
        return result
    }
}
