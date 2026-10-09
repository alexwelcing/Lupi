import Foundation
import Testing
import LupiChem
@testable import LupiData

enum DataFixtures {
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures/data")

    static func data(_ name: String) throws -> Data { try Data(contentsOf: root.appendingPathComponent(name)) }
    static func text(_ name: String) throws -> String { String(decoding: try data(name), as: UTF8.self) }
}

/// Answers from committed samples and records what was asked; no network.
final class StubTransport: EdgeTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var requested: [URL] = []
    let routes: [String: EdgeResponse]

    init(_ routes: [String: EdgeResponse]) { self.routes = routes }

    var urls: [URL] { lock.withLock { requested } }

    func get(_ url: URL) async throws -> EdgeResponse {
        lock.withLock { requested.append(url) }
        return routes[url.path] ?? EdgeResponse(status: 404, body: Data(#"{"error":"Not found"}"#.utf8))
    }
}

@Suite("edge client")
struct EdgeClientTests {
    @Test func decodesTheMoleculeManifest() async throws {
        let stub = StubTransport(["/m/manifest.json": EdgeResponse(status: 200, body: try DataFixtures.data("molecule-manifest.sample.json"))])
        let manifest = try await EdgeClient(transport: stub).moleculeManifest()
        #expect(manifest.schema == MoleculePagesManifest.schemaID)
        #expect(manifest.pages.map(\.id) == ["c60_buckyball", "caffeine", "water"])
        let caffeine = try #require(manifest.pages.first { $0.id == "caffeine" })
        #expect(caffeine.formula == "C8H10N4O2")
        #expect(caffeine.atoms == 24)
        #expect(caffeine.file == "/gallery/curated/popular/caffeine.xyz")
        #expect(caffeine.pose?.count == 2)
        #expect(stub.urls.map(\.absoluteString) == ["https://lupi.live/m/manifest.json"])
    }

    @Test func galleryMoleculeParsesTheFile() async throws {
        let xyz = "3\nwater\nO 0 0 0.1173\nH 0 0.7572 -0.4692\nH 0 -0.7572 -0.4692\n"
        let stub = StubTransport(["/gallery/curated/popular/water.xyz": EdgeResponse(status: 200, body: Data(xyz.utf8))])
        let page = MoleculePage(id: "water", name: "Water", formula: "H2O", atoms: 3, file: "/gallery/curated/popular/water.xyz")
        let molecule = try await EdgeClient(transport: stub).galleryMolecule(page)
        #expect(molecule.hillFormula == "H2O")
        #expect(molecule.name == "Water")
        let bad = MoleculePage(id: "x", name: "x", formula: "", atoms: 0, file: "https://elsewhere.example/x.xyz")
        await #expect(throws: EdgeError.invalidRequest("not a gallery path: https://elsewhere.example/x.xyz")) {
            _ = try await EdgeClient(transport: stub).galleryXYZ(bad)
        }
    }

    @Test func featuredPickIsCheckedAgainstItsSha256() async throws {
        let index = try LupiJSON.decoder().decode(OmolFeaturedIndex.self, from: try DataFixtures.data("omol25-featured.sample.json"))
        #expect(index.schema == OmolFeaturedIndex.schemaID)
        let pick = try #require(index.picks.first)
        #expect(pick.id == "omol25_nv_23477")
        #expect(pick.bondRecipe == BondRecipe.molecular.rawValue)
        #expect(pick.name == nil)
        let file = try DataFixtures.data("omol25_nv_23477.xyz")
        #expect(SHA256.hex(file) == pick.sha256)

        let good = StubTransport([pick.xyz: EdgeResponse(status: 200, body: file)])
        let xyz = try await EdgeClient(transport: good).omolFeaturedXYZ(pick)
        let document = try XYZParser.parse(xyz, maxFrames: 1)
        #expect(document.first.atomCount == pick.atoms)
        #expect(document.first.chemistry?.source == .record)
        #expect(document.autoBondRecipe == .molecular)

        var tampered = file
        tampered[tampered.count - 2] ^= 1
        let bad = StubTransport([pick.xyz: EdgeResponse(status: 200, body: tampered)])
        await #expect(throws: EdgeError.self) { _ = try await EdgeClient(transport: bad).omolFeaturedXYZ(pick) }
    }

    @Test func featuredPickNameDecodes() throws {
        // The type allows a matched name; the committed picks have none yet.
        let json = #"{"text":"Caffeine","id":"CHEMBL113","url":"https://www.ebi.ac.uk/chembl/","source":"chembl","formulaMatch":true}"#
        let name = try JSONDecoder().decode(OmolFeaturedPick.PickName.self, from: Data(json.utf8))
        #expect(name.text == "Caffeine")
        #expect(name.formulaMatch)
    }

    @Test func collectionsAndRows() async throws {
        let stub = StubTransport([
            "/v1/datasets/omol25": EdgeResponse(status: 200, body: try DataFixtures.data("omol25-collections.sample.json")),
            "/v1/datasets/omol25/neutral-validation/rows": EdgeResponse(status: 200, body: try DataFixtures.data("omol25-rows.sample.json")),
        ])
        let client = EdgeClient(transport: stub)
        let collections = try await client.omolCollections()
        #expect(collections.collections.map(\.id) == [
            "neutral-train", "neutral-validation", "all-train-preview", "train-4m-preview", "validation-preview",
        ])
        #expect(collections.browserContract.maxRowsPerRequest == 36)

        let page = try await client.omolRows(collection: "neutral-validation", offset: 273, limit: 2)
        #expect(page.rows.count == 2)
        let water = page.rows[0]
        #expect(water.formula == "H2O")
        #expect(water.charge == 0)
        #expect(water.spinMultiplicity == 1)
        #expect(water.chargeSource == "record")
        #expect(water.loadUrl == "/v1/datasets/omol25/neutral-validation/structures/273.xyz")
        #expect(page.rows[1].metaTruncated == true)
        #expect(page.rows[1].charge == nil)
        #expect(page.provenance.bondTopology == "not-provided")
        let asked = try #require(stub.urls.last)
        #expect(asked.absoluteString == "https://lupi.live/v1/datasets/omol25/neutral-validation/rows?offset=273&limit=2")
    }

    @Test func rowsRefuseBadRequestsBeforeTheNetwork() async throws {
        let stub = StubTransport([:])
        let client = EdgeClient(transport: stub)
        await #expect(throws: EdgeError.self) { _ = try await client.omolRows(collection: "../etc", limit: 2) }
        await #expect(throws: EdgeError.self) { _ = try await client.omolRows(collection: "neutral-train", limit: 37) }
        await #expect(throws: EdgeError.self) {
            _ = try await client.omolRows(collection: "neutral-train", query: "a", formula: "H2O")
        }
        #expect(stub.urls.isEmpty)
    }

    @Test func warmingSearchIndexAsksForARetry() async throws {
        let stub = StubTransport([
            "/v1/datasets/omol25/all-train-preview/rows": EdgeResponse(
                status: 202, headers: ["Retry-After": "15"], body: try DataFixtures.data("omol25-rows-warming.sample.json")
            ),
            "/v1/datasets/omol25/neutral-train/rows": EdgeResponse(
                status: 504, body: Data(#"{"error":"slow","status":"slow","timeoutSeconds":9}"#.utf8)
            ),
            "/v1/datasets/omol25/validation-preview/rows": EdgeResponse(
                status: 502, body: Data(#"{"error":"The upstream OMol25 dataset service is temporarily unavailable."}"#.utf8)
            ),
        ])
        let client = EdgeClient(transport: stub)
        await #expect(throws: EdgeError.warming(retryAfter: 15)) {
            _ = try await client.omolRows(collection: "all-train-preview", query: "caffeine")
        }
        await #expect(throws: EdgeError.slow) { _ = try await client.omolRows(collection: "neutral-train") }
        await #expect(throws: EdgeError.http(status: 502, message: "The upstream OMol25 dataset service is temporarily unavailable.")) {
            _ = try await client.omolRows(collection: "validation-preview")
        }
    }

    @Test func structureCarriesItsProvenanceHeaders() async throws {
        let headers = try JSONDecoder().decode([String: String].self, from: try DataFixtures.data("omol25-structure.sample.headers.json"))
        let stub = StubTransport([
            "/v1/datasets/omol25/neutral-validation/structures/273.xyz": EdgeResponse(
                status: 200, headers: headers, body: try DataFixtures.data("omol25-structure.sample.xyz")
            ),
        ])
        let structure = try await EdgeClient(transport: stub).omolStructure(collection: "neutral-validation", row: 273)
        #expect(structure.chargeProvenance == "record")
        #expect(structure.bondInference == BondRecipe.molecular.rawValue)
        #expect(structure.bondTopology == "not-provided")
        let document = try XYZParser.parse(structure.xyz)
        #expect(document.first.sourceRecord?.row == 273)
        #expect(document.first.sourceRecord?.collection == "neutral-validation")
        #expect(document.first.chemistry == FrameChemistry(totalCharge: 0, spinMultiplicity: 1, source: .record, domain: "orbnet_denali"))
        #expect(try structure.molecule().hillFormula == "H2O")
    }

    @Test func urlsStayOnTheOrigin() throws {
        let client = EdgeClient(origin: URL(string: "http://127.0.0.1:8787")!, transport: StubTransport([:]))
        #expect(try client.url(path: "/m/manifest.json").absoluteString == "http://127.0.0.1:8787/m/manifest.json")
        #expect(throws: EdgeError.self) { _ = try client.url(path: "/gallery/../secrets") }
        #expect(throws: EdgeError.self) { _ = try client.url(path: "gallery/x.xyz") }
    }
}

@Suite("sha256")
struct SHA256Tests {
    @Test func knownVectors() {
        #expect(SHA256.hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        #expect(SHA256.hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        #expect(SHA256.hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
            == "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
        #expect(SHA256.hex(String(repeating: "a", count: 1000))
            == "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3")
    }
}
