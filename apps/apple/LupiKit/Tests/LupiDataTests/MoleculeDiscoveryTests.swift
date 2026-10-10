import Foundation
import Testing
@testable import LupiData

private actor DiscoveryStub: DiscoveryTransport {
    let reply: EdgeResponse
    var requests: [(URL, Data)] = []
    init(_ result: MoleculeRecommendation, status: Int = 200) throws {
        reply = EdgeResponse(status: status, body: try JSONEncoder().encode(result))
    }
    func post(_ url: URL, body: Data) async throws -> EdgeResponse {
        requests.append((url, body))
        return reply
    }
}

/// Deliberately ignores cancellation in the transport: a response already in flight
/// can still arrive after a view has cancelled its search.
private actor DelayedDiscoveryStub: DiscoveryTransport {
    let reply: EdgeResponse
    private var response: CheckedContinuation<EdgeResponse, Never>?
    private var requestStarted: CheckedContinuation<Void, Never>?
    private var requested = false

    init(_ result: MoleculeRecommendation) throws {
        reply = EdgeResponse(status: 200, body: try JSONEncoder().encode(result))
    }

    func post(_ url: URL, body: Data) async throws -> EdgeResponse {
        await withCheckedContinuation { continuation in
            response = continuation
            requested = true
            requestStarted?.resume()
            requestStarted = nil
        }
    }

    func waitForRequest() async {
        if requested { return }
        await withCheckedContinuation { requestStarted = $0 }
    }

    func deliverResponse() {
        response?.resume(returning: reply)
        response = nil
    }
}

private struct UnavailableDiscoveryStub: DiscoveryTransport {
    func post(_ url: URL, body: Data) async throws -> EdgeResponse {
        throw URLError(.timedOut)
    }
}

@Suite("native molecule discovery")
struct MoleculeDiscoveryTests {
    private func result(_ catalog: DiscoveryCatalog, query: String = "the molecule in coffee") -> MoleculeRecommendation {
        MoleculeRecommendation(
            schema: "lupi.discovery.v1", catalogVersion: catalog.catalogVersion, query: query,
            status: "matched", method: .jev, model: "jev-1.13.0", confidence: 0.95,
            candidates: [catalog.candidates.first { $0.id == "caffeine" }!], note: "Inferred catalogue match"
        )
    }

    @Test func bundledNamesAndFormulasWorkOffline() async throws {
        let catalog = try DiscoveryCatalog.bundled()
        #expect(catalog.candidates.count == 12)
        #expect(catalog.exact("buckyball")?.pubchemCid == 123591)
        #expect(catalog.exact("not water") == nil)
        let stub = try DiscoveryStub(result(catalog))
        let answer = try await MoleculeDiscoveryClient(catalog: catalog, transport: stub).recommend(" h2o ")
        #expect(answer.candidate?.id == "water")
        #expect(answer.method == .exact)
        #expect(await stub.requests.isEmpty)
    }

    @Test func sendsOnlyTheQueryAndMapsTheAnswerToBundledContent() async throws {
        let catalog = try DiscoveryCatalog.bundled()
        let stub = try DiscoveryStub(result(catalog))
        let answer = try await MoleculeDiscoveryClient(catalog: catalog, transport: stub).recommend("the molecule in coffee")
        #expect(answer.candidate?.id == "caffeine")
        #expect(answer.candidate?.atoms == 24)
        #expect(answer.method == .jev)
        let calls = await stub.requests
        #expect(calls.count == 1)
        #expect(calls.first?.0.absoluteString == "https://lupi.live/v1/discovery/molecule")
        let sent = try JSONDecoder().decode([String: String].self, from: #require(calls.first?.1))
        #expect(sent == ["query": "the molecule in coffee"])
    }

    @Test func refusesChangedMetadataUnknownIDsWeakAnswersAndStaleQueries() async throws {
        let catalog = try DiscoveryCatalog.bundled()
        let valid = result(catalog)
        var badCID = valid; badCID.candidates[0].pubchemCid = 999
        var unknown = valid; unknown.candidates[0].id = "invented"
        var weak = valid; weak.confidence = 0.5
        var stale = valid; stale.query = "a previous query"
        var version = valid; version.catalogVersion = "future"
        var contradiction = valid; contradiction.status = "no-match"
        for bad in [badCID, unknown, weak, stale, version, contradiction] {
            let stub = try DiscoveryStub(bad)
            await #expect(throws: EdgeError.self) {
                _ = try await MoleculeDiscoveryClient(catalog: catalog, transport: stub).recommend(valid.query)
            }
        }
    }

    @Test func withheldAnswersHaveNoPlayableCandidate() async throws {
        let catalog = try DiscoveryCatalog.bundled()
        var withheld = result(catalog)
        withheld.status = "no-match"; withheld.method = .uncertain; withheld.candidates = []; withheld.confidence = 0.5
        let stub = try DiscoveryStub(withheld)
        let answer = try await MoleculeDiscoveryClient(catalog: catalog, transport: stub).recommend(withheld.query)
        #expect(answer.candidate == nil)
        let failed = try DiscoveryStub(withheld, status: 503)
        await #expect(throws: EdgeError.self) {
            _ = try await MoleculeDiscoveryClient(catalog: catalog, transport: failed).recommend(withheld.query)
        }
    }

    @Test func refusesOversizedQueriesBeforeNetwork() async throws {
        let catalog = try DiscoveryCatalog.bundled()
        let stub = try DiscoveryStub(result(catalog))
        let client = MoleculeDiscoveryClient(catalog: catalog, transport: stub)
        await #expect(throws: EdgeError.self) { _ = try await client.recommend(String(repeating: "a", count: 201)) }
        #expect(await stub.requests.isEmpty)
    }

    @Test func cancelledSearchRejectsAResponseThatArrivesLater() async throws {
        let catalog = try DiscoveryCatalog.bundled()
        let stub = try DelayedDiscoveryStub(result(catalog))
        let client = MoleculeDiscoveryClient(catalog: catalog, transport: stub)
        let request = Task { try await client.recommend("the molecule in coffee") }
        await stub.waitForRequest()
        request.cancel()
        await stub.deliverResponse()
        await #expect(throws: CancellationError.self) { try await request.value }
    }

    @Test func exactSearchStillWorksWhenDescriptionTransportIsUnavailable() async throws {
        let client = MoleculeDiscoveryClient(catalog: try DiscoveryCatalog.bundled(), transport: UnavailableDiscoveryStub())
        let answer = try await client.recommend("caffeine")
        #expect(answer.candidate?.atoms == 24)
        #expect(answer.method == .exact)
        await #expect(throws: URLError.self) { try await client.recommend("the molecule in coffee") }
    }
}
