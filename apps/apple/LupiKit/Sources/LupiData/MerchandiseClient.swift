import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct MerchandiseResponse: Sendable {
    public let status: Int
    public let contentType: String?
    public let body: Data
    public let finalURL: URL?

    public init(status: Int, contentType: String?, body: Data, finalURL: URL?) {
        self.status = status; self.contentType = contentType; self.body = body; self.finalURL = finalURL
    }
}

public protocol MerchandiseTransport: Sendable {
    func get(_ url: URL) async throws -> MerchandiseResponse
}

/// The registry request never follows a redirect or borrows account cookies/credentials.
private final class MerchandiseRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public struct URLSessionMerchandiseTransport: MerchandiseTransport {
    public init() {}

    public func get(_ url: URL) async throws -> MerchandiseResponse {
        guard url == MerchandiseClient.endpoint else { throw MerchandiseError.invalidRegistry("Not the fixed registry endpoint") }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 8
        let session = URLSession(configuration: configuration, delegate: MerchandiseRedirectPolicy(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        #if canImport(FoundationNetworking)
        // Headless Linux FoundationNetworking has no AsyncBytes. Its test-only
        // transport still rejects oversized content before registry parsing.
        let (data, response) = try await session.data(for: request)
        #else
        // Apple's URLSession.bytes(for:delegate:) delivers the response before
        // its body, so the app's production body buffer stays within the cap.
        // https://developer.apple.com/documentation/foundation/urlsession/bytes(for:delegate:)
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.url == MerchandiseClient.endpoint,
              response.expectedContentLength <= Int64(MerchandiseRegistry.maximumBytes),
              http.value(forHTTPHeaderField: "Content-Type")?.split(separator: ";").first?
                .trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "application/json" else {
            throw MerchandiseError.invalidRegistry("Registry response headers are not a bounded JSON document")
        }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < MerchandiseRegistry.maximumBytes else {
                // The deferred invalidation cancels the response immediately.
                throw MerchandiseError.invalidRegistry("Registry exceeds 128 KiB")
            }
            data.append(byte)
        }
        #endif
        guard data.count <= MerchandiseRegistry.maximumBytes, let http = response as? HTTPURLResponse else {
            throw MerchandiseError.invalidRegistry("Registry response exceeds bounds or is not HTTP")
        }
        return MerchandiseResponse(status: http.statusCode, contentType: http.value(forHTTPHeaderField: "Content-Type"), body: data, finalURL: http.url)
    }
}

/// One anonymous request when opening a preview. Failure keeps the shipped, empty fallback.
public struct MerchandiseClient: Sendable {
    public static let endpoint = URL(string: "https://lupi.live/commerce/merchandise.v1.json")!
    public let transport: any MerchandiseTransport

    public init(transport: any MerchandiseTransport = URLSessionMerchandiseTransport()) {
        self.transport = transport
    }

    public func registry() async -> MerchandiseRegistry? {
        do {
            try Task.checkCancellation()
            let response = try await transport.get(Self.endpoint)
            try Task.checkCancellation()
            let mime = response.contentType?.split(separator: ";").first?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard response.status == 200, response.finalURL == Self.endpoint, mime == "application/json",
                  response.body.count <= MerchandiseRegistry.maximumBytes else {
                return try? MerchandiseRegistry.bundled()
            }
            return try MerchandiseRegistry.decode(response.body)
        } catch {
            guard !Task.isCancelled else { return nil }
            return try? MerchandiseRegistry.bundled()
        }
    }
}
