import Foundation

// The edge's JSON, as written by scripts/molecule-pages/build.mts
// (moleculeManifest), apps/web/public/datasets/omol25/featured.v1.json and
// apps/mcp-worker/src/scienceData.ts. Tests decode samples those produce
// (tools/apple/export-edge-samples.mts).

/// `/m/manifest.json`: every gallery molecule with a zero-canvas page.
public struct MoleculePagesManifest: Sendable, Equatable, Codable {
    public static let schemaID = "lupi.molecule-pages.v1"

    public var schema: String
    public var origin: String
    public var cards: Bool
    public var pages: [MoleculePage]
}

public struct MoleculePage: Sendable, Equatable, Codable, Identifiable {
    public var id: String
    public var name: String
    public var formula: String
    public var atoms: Int
    /// Path of the coordinate file on the origin: "/gallery/curated/popular/caffeine.xyz".
    public var file: String
    /// The ink drawing's opening pose: [azimuth about +Y, elevation], radians.
    public var pose: [Double]?
    /// The ink drawing's radius, Å.
    public var inkRadius: Double?
    /// The viewer's fit radius, Å.
    public var fit: Double?
}

/// `/datasets/omol25/featured.v1.json`: the hand-picked OMol25 specimens.
public struct OmolFeaturedIndex: Sendable, Equatable, Codable {
    public static let schemaID = "lupi.omol25-featured.v1"

    public var schema: String
    public var license: String
    public var citation: String
    public var picks: [OmolFeaturedPick]
}

public struct OmolFeaturedPick: Sendable, Equatable, Codable, Identifiable {
    public var id: String
    public var collection: String
    public var dataset: String
    public var row: Int
    public var configurationId: String
    public var propertyId: String
    public var formula: String
    public var atoms: Int
    public var elements: [String]
    public var shelf: String
    public var home: Bool
    public var domain: String?
    public var domainLabel: String
    public var charge: Int
    public var spinMultiplicity: Int
    public var chargeSource: String
    public var energyEv: Double?
    public var maxForceEvPerA: Double?
    public var homoLumoGapEv: Double?
    public var title: String
    public var name: PickName?
    /// Same-origin XYZ path; its bytes hash to `sha256`.
    public var xyz: String
    /// The edge route for the same row.
    public var edge: String
    public var ink: String
    public var sha256: String
    public var fetchedAt: String
    public var bondRecipe: String

    /// A matched common name, when the curation found one.
    public struct PickName: Sendable, Equatable, Codable {
        public var text: String
        public var id: String
        public var url: String
        public var source: String
        public var formulaMatch: Bool
    }
}

/// `GET /v1/datasets/omol25`: the collections the edge pages through.
public struct OmolCollectionsManifest: Sendable, Equatable, Codable {
    public var id: String
    public var title: String
    public var license: String
    public var citation: String
    public var collections: [OmolCollection]
    public var browserContract: BrowserContract

    public struct BrowserContract: Sendable, Equatable, Codable {
        public var maxRowsPerRequest: Int
        public var completePublicLane: String
    }
}

public struct OmolCollection: Sendable, Equatable, Codable, Identifiable {
    /// neutral-train, neutral-validation, all-train-preview, train-4m-preview, validation-preview.
    public var id: String
    public var label: String
    public var description: String
    public var repository: String
    public var indexedRows: Int
    public var estimatedRows: Int
    public var sourceRows: Int
    /// "complete" or "indexed-preview".
    public var coverage: String
    public var rowsUrl: String
}

/// `GET /v1/datasets/omol25/:collection/rows`.
public struct OmolRowsPage: Sendable, Equatable, Codable {
    public var dataset: String
    public var repository: String
    public var coverage: String
    public var indexedRows: Int
    public var estimatedRows: Int
    public var sourceRows: Int
    public var offset: Int
    public var limit: Int
    public var returnedRows: Int
    public var matchedRows: Int?
    public var partial: Bool
    public var query: String?
    public var formula: String?
    public var rows: [OmolRow]
    public var provenance: Provenance

    public struct Provenance: Sendable, Equatable, Codable {
        public var license: String
        public var attributionUrl: String
        public var coordinates: String
        public var bondTopology: String
    }
}

/// One compact OMol25 row (`compactOmolRow`).
public struct OmolRow: Sendable, Equatable, Codable, Identifiable {
    public var rowIndex: Int
    public var id: String
    public var configurationId: String?
    public var propertyId: String?
    public var formula: String
    public var reducedFormula: String?
    public var elements: [String]
    public var atomCount: Int
    /// ColabFit's column, which is not spin multiplicity; use `spinMultiplicity`.
    public var multiplicity: Int?
    public var charge: Int?
    public var spinMultiplicity: Int?
    /// "record", "split-definition" or "unavailable".
    public var chargeSource: String
    public var domain: String?
    public var homoLumoGapEv: Double?
    /// True when Hugging Face truncated the metadata, so charge and spin are unknown.
    public var metaTruncated: Bool?
    public var method: String?
    public var software: String?
    public var energy: Double?
    public var maxForceNorm: Double?
    public var name: String?
    /// The edge path of this row's XYZ.
    public var loadUrl: String
}

/// An error body from the edge: `{ error, status?, retryAfterSeconds? }`.
public struct EdgeErrorBody: Sendable, Equatable, Codable {
    public var error: String
    /// "warming" (202) or "slow" (504) on the OMol25 routes.
    public var status: String?
    public var dataset: String?
    public var retryAfterSeconds: Double?
    public var timeoutSeconds: Double?
}
