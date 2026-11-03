import Foundation
import Testing
@testable import LupiData

private actor MerchandiseStub: MerchandiseTransport {
    let response: MerchandiseResponse
    var requests: [URL] = []
    init(status: Int = 200, contentType: String? = "application/json", body: Data,
         finalURL: URL? = MerchandiseClient.endpoint) {
        response = MerchandiseResponse(status: status, contentType: contentType, body: body, finalURL: finalURL)
    }
    func get(_ url: URL) async throws -> MerchandiseResponse { requests.append(url); return response }
}

private struct UnavailableMerchandise: MerchandiseTransport {
    func get(_ url: URL) async throws -> MerchandiseResponse { throw URLError(.notConnectedToInternet) }
}

private actor DelayedMerchandise: MerchandiseTransport {
    let body: Data
    var continuation: CheckedContinuation<MerchandiseResponse, Never>?
    var start: CheckedContinuation<Void, Never>?
    var requested = false
    init(body: Data) { self.body = body }
    func get(_ url: URL) async throws -> MerchandiseResponse {
        await withCheckedContinuation { continuation in
            self.continuation = continuation; requested = true; start?.resume(); start = nil
        }
    }
    func waitForRequest() async { if !requested { await withCheckedContinuation { start = $0 } } }
    func finish() {
        continuation?.resume(returning: MerchandiseResponse(status: 200, contentType: "application/json", body: body, finalURL: MerchandiseClient.endpoint))
        continuation = nil
    }
}

@Suite("native physical merchandise handoff")
struct MerchandiseTests {
    private let now = Date(timeIntervalSince1970: 1_793_714_400) // 2026-11-03 14:00 UTC

    private func offer(_ overrides: [String: Any] = [:]) -> [String: Any] {
        var value: [String: Any] = [
            "id": "fixture-tee", "moleculeId": "caffeine", "title": "Fixture physical tee",
            "productHandle": "fixture-tee", "shopifyProductId": "gid://shopify/Product/900000001",
            "shopifyVariantId": "gid://shopify/ProductVariant/900000002",
            "printArtifactDigest": "sha256:" + String(repeating: "a", count: 64), "ready": true,
            "countryCode": "US", "verifiedAt": "2026-11-03T13:00:00Z", "expiresAt": "2026-11-04T13:00:00Z",
            "campaignId": "fixture-launch-01", "creativeId": "fixture-cup-02",
        ]
        value.merge(overrides) { _, new in new }; return value
    }

    private func data(offers: [[String: Any]]? = nil, publicStore: Bool = true, extras: [String: Any] = [:]) throws -> Data {
        var root: [String: Any] = ["schema": MerchandiseRegistry.schemaID, "storefrontPublic": publicStore, "offers": offers ?? [offer()]]
        root.merge(extras) { _, new in new }; return try JSONSerialization.data(withJSONObject: root)
    }

    @Test func exactSyntheticOfferBuildsOnlyTheFixedShopAndAllowedParameters() throws {
        let registry = try MerchandiseRegistry.decode(data())
        let link = try #require(registry.handoff(for: "caffeine", now: now))
        let url = try #require(URLComponents(url: link.url, resolvingAgainstBaseURL: false))
        #expect(url.scheme == "https"); #expect(url.host == "loot.lupi.live"); #expect(url.path == "/products/fixture-tee")
        #expect(url.user == nil && url.password == nil && url.fragment == nil)
        #expect(Dictionary(uniqueKeysWithValues: (url.queryItems ?? []).map { ($0.name, $0.value ?? "") }) == [
            "variant": "900000002", "utm_source": "lupi-ios", "utm_medium": "app",
            "utm_campaign": "fixture-launch-01", "utm_content": "fixture-cup-02",
        ])
        #expect(link.shopifyProductID == "gid://shopify/Product/900000001")
        #expect(link.shopifyVariantID == "gid://shopify/ProductVariant/900000002")
        #expect(link.printArtifactDigest == "sha256:" + String(repeating: "a", count: 64))
    }

    @Test func shippedRegistryNeverShowsADeadStoreLink() throws {
        let registry = try MerchandiseRegistry.bundled()
        #expect(!registry.storefrontPublic && registry.offers.isEmpty)
        for starter in try Starters.manifest().starters { #expect(registry.handoff(for: starter.id, now: now) == nil) }
    }

    @Test func samePreviewExpiresAtTheExactBoundaryWithoutChangingMolecule() throws {
        var preview = MerchandisePreviewState()
        #expect(preview.handoff == nil)
        preview.replaceRegistry(try MerchandiseRegistry.decode(data()), moleculeID: "caffeine", now: now)
        let deadline = try #require(preview.handoff?.validUntil)
        preview.revalidate(moleculeID: "caffeine", now: deadline.addingTimeInterval(-0.001))
        #expect(preview.handoff != nil)
        preview.revalidate(moleculeID: "caffeine", now: deadline)
        #expect(preview.handoff == nil)
    }

    @Test func foregroundRevalidationAndClosedReplacementRemoveTheCurrentCTA() throws {
        let registry = try MerchandiseRegistry.decode(data())
        var preview = MerchandisePreviewState()
        preview.replaceRegistry(registry, moleculeID: "caffeine", now: now)
        #expect(preview.handoff != nil)
        // Equivalent to foregrounding after the expiry task was suspended.
        preview.revalidate(moleculeID: "caffeine", now: now.addingTimeInterval(2 * 86_400))
        #expect(preview.handoff == nil)
        preview.replaceRegistry(registry, moleculeID: "caffeine", now: now)
        #expect(preview.handoff != nil)
        preview.replaceRegistry(try MerchandiseRegistry.decode(data(publicStore: false)), moleculeID: "caffeine", now: now)
        #expect(preview.handoff == nil)
        preview.replaceRegistry(nil, moleculeID: "caffeine", now: now)
        #expect(preview.handoff == nil)
    }

    @Test func missingClosedUnreadyExpiredFutureAndNonUSOffersStayHidden() throws {
        #expect(try MerchandiseRegistry.decode(data()).handoff(for: "water", now: now) == nil)
        #expect(try MerchandiseRegistry.decode(data(publicStore: false)).handoff(for: "caffeine", now: now) == nil)
        #expect(try MerchandiseRegistry.decode(data(offers: [offer(["ready": false])])).handoff(for: "caffeine", now: now) == nil)
        let registry = try MerchandiseRegistry.decode(data())
        #expect(registry.handoff(for: "caffeine", countryCode: "CA", now: now) == nil)
        #expect(registry.handoff(for: "caffeine", now: Date(timeIntervalSince1970: 0)) == nil)
        #expect(registry.handoff(for: "caffeine", now: now.addingTimeInterval(2 * 86_400)) == nil)
    }

    @Test func rejectsDomainPathIdentifierDigestAndCampaignInjection() throws {
        for origin in ["https://evil.test", "http://loot.lupi.live", "https://loot.lupi.live@evil.test", "https://loot.lupi.live/products/fixture"] {
            #expect(throws: MerchandiseError.self) { _ = try MerchandiseRegistry.decode(data(extras: ["storeOrigin": origin])) }
        }
        for mutation in [
            ["productHandle": "https://evil.test"], ["productHandle": "../admin"], ["productHandle": "fixture?email=person"],
            ["productHandle": "%2e%2e"], ["moleculeId": "invented"], ["shopifyProductId": "900000001"],
            ["productHandle": "fixture\n"], ["campaignId": "fixture\n"],
            ["shopifyVariantId": "gid://shopify/ProductVariant/0"], ["shopifyVariantId": "gid://shopify/Product/900000002"],
            ["printArtifactDigest": "sha256:wrong"], ["campaignId": "launch&email=person"],
            ["creativeId": String(repeating: "a", count: 81)], ["countryCode": "CA"],
        ] { #expect(throws: MerchandiseError.self) { _ = try MerchandiseRegistry.decode(data(offers: [offer(mutation)])) } }
    }

    @Test func rejectsAmbiguousMappingsUnknownSchemaAndUnboundedVerificationWindows() throws {
        for mutations in [ ["verifiedAt": "not-a-date"], ["verifiedAt": "2026-11-03T13:00:00Zsuffix"], ["expiresAt": "2026-11-03T12:00:00Z"], ["expiresAt": "2027-11-03T13:00:00Z"] ] {
            #expect(throws: MerchandiseError.self) { _ = try MerchandiseRegistry.decode(data(offers: [offer(mutations)])) }
        }
        #expect(throws: MerchandiseError.self) { _ = try MerchandiseRegistry.decode(data(offers: [offer(), offer(["id": "another-offer"])])) }
        #expect(throws: MerchandiseError.self) { _ = try MerchandiseRegistry.decode(data(extras: ["schema": "future"])) }
        #expect(throws: MerchandiseError.self) { _ = try MerchandiseRegistry.decode(Data(repeating: 32, count: MerchandiseRegistry.maximumBytes + 1)) }
    }

    @Test func loaderFetchesOnlyFixedAnonymousEndpointAndAcceptsBoundedJSON() async throws {
        let stub = MerchandiseStub(contentType: "application/json; charset=utf-8", body: try data())
        let registry = await MerchandiseClient(transport: stub).registry()
        #expect(registry?.handoff(for: "caffeine", now: now) != nil)
        #expect(await stub.requests == [MerchandiseClient.endpoint])
        await #expect(throws: MerchandiseError.self) {
            _ = try await URLSessionMerchandiseTransport().get(URL(string: "https://evil.test/registry")!)
        }
    }

    @Test func failedMissingOversizedRedirectedAndNonJSONFeedsUseTheHiddenFallback() async throws {
        let valid = try data()
        let stubs = [
            MerchandiseStub(status: 404, body: valid), MerchandiseStub(contentType: "text/html", body: valid),
            MerchandiseStub(body: Data(repeating: 32, count: MerchandiseRegistry.maximumBytes + 1)),
            MerchandiseStub(body: valid, finalURL: URL(string: "https://evil.test/registry")),
            MerchandiseStub(body: Data("broken json".utf8)),
        ]
        for stub in stubs {
            let registry = await MerchandiseClient(transport: stub).registry()
            #expect(registry?.handoff(for: "caffeine", now: now) == nil)
        }
        let unavailable = await MerchandiseClient(transport: UnavailableMerchandise()).registry()
        #expect(unavailable?.handoff(for: "caffeine", now: now) == nil)
    }

    @Test func canceledPreviewDoesNotPublishAnInFlightResponse() async throws {
        let stub = DelayedMerchandise(body: try data())
        let task = Task { await MerchandiseClient(transport: stub).registry() }
        await stub.waitForRequest(); task.cancel(); await stub.finish()
        #expect(await task.value == nil)
    }
}
