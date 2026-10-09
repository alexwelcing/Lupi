import Foundation
import LupiChem
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One HTTP response, as the client needs it.
public struct EdgeResponse: Sendable {
    public var status: Int
    /// Header names lowercased.
    public var headers: [String: String]
    public var body: Data

    public init(status: Int, headers: [String: String] = [:], body: Data) {
        self.status = status
        self.headers = Dictionary(headers.map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { first, _ in first })
        self.body = body
    }
}

/// How the client reaches the network; tests pass a stub.
public protocol EdgeTransport: Sendable {
    func get(_ url: URL) async throws -> EdgeResponse
}

public struct URLSessionTransport: EdgeTransport {
    public let session: URLSession
    public let timeout: TimeInterval

    public init(session: URLSession = .shared, timeout: TimeInterval = 20) {
        self.session = session
        self.timeout = timeout
    }

    public func get(_ url: URL) async throws -> EdgeResponse {
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.setValue("application/json, chemical/x-xyz, text/plain", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { return EdgeResponse(status: 0, body: data) }
        var headers: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
            if let key = key as? String, let value = value as? String { headers[key.lowercased()] = value }
        }
        return EdgeResponse(status: http.statusCode, headers: headers, body: data)
    }
}

public enum EdgeError: Error, Equatable, Sendable {
    /// A non-2xx answer, with the edge's `error` text when it sent one.
    case http(status: Int, message: String?)
    /// The OMol25 search index is warming (202): retry after this many seconds.
    case warming(retryAfter: Double)
    /// The upstream dataset service did not answer in time (504).
    case slow
    /// The bytes do not hash to the recorded sha256.
    case integrity(expected: String, actual: String)
    /// A path or parameter the client refuses to send.
    case invalidRequest(String)
    case decoding(String)
    /// The body is not UTF-8 text.
    case notText
}

/// A row's XYZ from the edge, with the provenance headers it carries.
public struct OmolStructure: Sendable, Equatable {
    public var xyz: String
    /// `x-lupi-charge-provenance`: record, split-definition or unavailable.
    public var chargeProvenance: String?
    /// `x-lupi-bond-inference`: the recipe the viewer infers bonds with.
    public var bondInference: String?
    /// `x-lupi-bond-topology`: not-provided (OMol25 has no bonds).
    public var bondTopology: String?

    public func molecule(name: String? = nil) throws -> Molecule { try Molecule(xyz: xyz, name: name) }
}

/// Reads Lupi's edge (the Cloudflare Worker and the static assets it serves).
public struct EdgeClient: Sendable {
    public static let defaultOrigin = URL(string: "https://lupi.live")!

    public let origin: URL
    public let transport: any EdgeTransport

    public init(origin: URL = EdgeClient.defaultOrigin, transport: any EdgeTransport = URLSessionTransport()) {
        self.origin = origin
        self.transport = transport
    }

    // MARK: Gallery

    /// `/m/manifest.json`: the gallery molecules.
    public func moleculeManifest() async throws -> MoleculePagesManifest {
        try await json(path: "/m/manifest.json")
    }

    /// A gallery molecule's XYZ (its page's `file`).
    public func galleryXYZ(_ page: MoleculePage) async throws -> String {
        guard page.file.hasPrefix("/gallery/") else { throw EdgeError.invalidRequest("not a gallery path: \(page.file)") }
        return try await text(path: page.file)
    }

    public func galleryMolecule(_ page: MoleculePage) async throws -> Molecule {
        try Molecule(xyz: try await galleryXYZ(page), name: page.name)
    }

    // MARK: OMol25

    /// `/datasets/omol25/featured.v1.json`.
    public func omolFeatured() async throws -> OmolFeaturedIndex {
        try await json(path: "/datasets/omol25/featured.v1.json")
    }

    /// A featured pick's XYZ, checked against the sha256 the index records.
    public func omolFeaturedXYZ(_ pick: OmolFeaturedPick) async throws -> String {
        guard pick.xyz.hasPrefix("/datasets/omol25/featured/") else {
            throw EdgeError.invalidRequest("not a featured path: \(pick.xyz)")
        }
        let response = try await get(path: pick.xyz)
        let digest = SHA256.hex(response.body)
        guard digest == pick.sha256.lowercased() else { throw EdgeError.integrity(expected: pick.sha256, actual: digest) }
        guard let text = String(data: response.body, encoding: .utf8) else { throw EdgeError.notText }
        return text
    }

    /// `GET /v1/datasets/omol25`: the collections and their coverage.
    public func omolCollections() async throws -> OmolCollectionsManifest {
        try await json(path: "/v1/datasets/omol25")
    }

    /// One page of compact rows. `query` (text search) and `formula` (Hill
    /// formula filter) are exclusive; the edge caps `limit` at 36. A cold
    /// search index throws `.warming(retryAfter:)`.
    public func omolRows(
        collection: String, offset: Int = 0, limit: Int = 24, query: String? = nil, formula: String? = nil
    ) async throws -> OmolRowsPage {
        try Self.checkCollection(collection)
        guard offset >= 0, (1...36).contains(limit) else { throw EdgeError.invalidRequest("offset ≥ 0 and limit 1...36") }
        guard query == nil || formula == nil else { throw EdgeError.invalidRequest("use query or formula, not both") }
        var items = [URLQueryItem(name: "offset", value: String(offset)), URLQueryItem(name: "limit", value: String(limit))]
        if let query { items.append(URLQueryItem(name: "query", value: query)) }
        if let formula { items.append(URLQueryItem(name: "formula", value: formula)) }
        return try await json(path: "/v1/datasets/omol25/\(collection)/rows", query: items)
    }

    /// `GET /v1/datasets/omol25/:collection/structures/:row.xyz`.
    public func omolStructure(collection: String, row: Int) async throws -> OmolStructure {
        try Self.checkCollection(collection)
        guard row >= 0 else { throw EdgeError.invalidRequest("row must be ≥ 0") }
        let response = try await get(path: "/v1/datasets/omol25/\(collection)/structures/\(row).xyz")
        guard let text = String(data: response.body, encoding: .utf8) else { throw EdgeError.notText }
        return OmolStructure(
            xyz: text, chargeProvenance: response.headers["x-lupi-charge-provenance"],
            bondInference: response.headers["x-lupi-bond-inference"], bondTopology: response.headers["x-lupi-bond-topology"]
        )
    }

    // MARK: Plumbing

    static func checkCollection(_ id: String) throws {
        let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789-")
        guard !id.isEmpty, id.allSatisfy({ allowed.contains($0) }) else {
            throw EdgeError.invalidRequest("not a collection id: \(id)")
        }
    }

    func url(path: String, query: [URLQueryItem] = []) throws -> URL {
        guard path.hasPrefix("/"), !path.split(separator: "/").contains("..") else {
            throw EdgeError.invalidRequest("not an origin path: \(path)")
        }
        guard var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else {
            throw EdgeError.invalidRequest("bad origin \(origin)")
        }
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw EdgeError.invalidRequest("cannot build a URL for \(path)") }
        return url
    }

    func get(path: String, query: [URLQueryItem] = []) async throws -> EdgeResponse {
        let response = try await transport.get(try url(path: path, query: query))
        if response.status == 200 { return response }
        let body = try? LupiJSON.decoder().decode(EdgeErrorBody.self, from: response.body)
        if response.status == 202, body?.status == "warming" {
            throw EdgeError.warming(retryAfter: body?.retryAfterSeconds ?? Double(response.headers["retry-after"] ?? "") ?? 15)
        }
        if response.status == 504 { throw EdgeError.slow }
        if (200..<300).contains(response.status) { return response }
        throw EdgeError.http(status: response.status, message: body?.error)
    }

    func json<T: Decodable>(path: String, query: [URLQueryItem] = []) async throws -> T {
        let response = try await get(path: path, query: query)
        do {
            return try LupiJSON.decoder().decode(T.self, from: response.body)
        } catch {
            throw EdgeError.decoding("\(path): \(error)")
        }
    }

    func text(path: String) async throws -> String {
        let response = try await get(path: path)
        guard let text = String(data: response.body, encoding: .utf8) else { throw EdgeError.notText }
        return text
    }
}
