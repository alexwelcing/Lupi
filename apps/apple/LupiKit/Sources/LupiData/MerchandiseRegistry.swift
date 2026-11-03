import Foundation

/// An operator-reviewed physical offer. A shared molecule name never creates a mapping.
public struct MerchandiseOffer: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let moleculeID: String
    public let title: String
    public let productHandle: String
    public let shopifyProductID: String
    public let shopifyVariantID: String
    public let printArtifactDigest: String
    public let ready: Bool
    public let countryCode: String
    public let verifiedAt: String
    public let expiresAt: String
    public let campaignID: String
    public let creativeID: String

    enum CodingKeys: String, CodingKey {
        case id, title, productHandle, printArtifactDigest, ready, countryCode, verifiedAt, expiresAt
        case moleculeID = "moleculeId", shopifyProductID = "shopifyProductId"
        case shopifyVariantID = "shopifyVariantId", campaignID = "campaignId", creativeID = "creativeId"
    }
}

/// Only this typed handoff reaches SwiftUI's external Link. It carries no visitor identifiers.
public struct MerchandiseHandoff: Sendable, Equatable {
    public let offerID: String
    public let moleculeID: String
    public let title: String
    public let shopifyProductID: String
    public let shopifyVariantID: String
    public let printArtifactDigest: String
    public let countryCode: String
    public let validUntil: Date
    public let url: URL
}

public enum MerchandiseError: Error, Sendable, Equatable {
    case invalidRegistry(String)
    case missingResource
}

/// Readiness and exact artwork approval are established by the commerce operator,
/// not by this parser. The app only validates the resulting bounded, expiring registry.
public struct MerchandiseRegistry: Decodable, Sendable, Equatable {
    public static let schemaID = "lupi.merchandise.v1"
    public static let storeOrigin = "https://loot.lupi.live"
    public static let maximumBytes = 128 * 1024
    public static let maximumValidity: TimeInterval = 7 * 24 * 60 * 60

    public let schema: String
    public let storefrontPublic: Bool
    public let offers: [MerchandiseOffer]

    enum CodingKeys: String, CodingKey { case schema, storefrontPublic, offers, storeOrigin }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schema = try values.decode(String.self, forKey: .schema)
        storefrontPublic = try values.decode(Bool.self, forKey: .storefrontPublic)
        offers = try values.decode([MerchandiseOffer].self, forKey: .offers)
        let origin = try values.decodeIfPresent(String.self, forKey: .storeOrigin)
        let knownIDs = Set(try Starters.manifest().starters.map(\.id))
        guard schema == Self.schemaID, origin == nil || origin == Self.storeOrigin,
              offers.count <= 50, Set(offers.map(\.id)).count == offers.count,
              Set(offers.map(\.moleculeID)).count == offers.count else {
            throw MerchandiseError.invalidRegistry("Unsupported schema, store or ambiguous offer mapping")
        }
        for offer in offers {
            guard knownIDs.contains(offer.moleculeID), Self.slug(offer.id), Self.slug(offer.productHandle, maximum: 128),
                  Self.slug(offer.campaignID), Self.slug(offer.creativeID),
                  Self.matches(offer.shopifyProductID, "^gid://shopify/Product/[1-9][0-9]{0,19}$"),
                  Self.matches(offer.shopifyVariantID, "^gid://shopify/ProductVariant/[1-9][0-9]{0,19}$"),
                  Self.matches(offer.printArtifactDigest, "^sha256:[a-f0-9]{64}$"),
                  offer.countryCode == "US", !offer.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  offer.title.count <= 120, !offer.title.contains(where: { $0.isNewline }),
                  let verified = Self.date(offer.verifiedAt), let expires = Self.date(offer.expiresAt),
                  expires > verified, expires.timeIntervalSince(verified) <= Self.maximumValidity else {
                throw MerchandiseError.invalidRegistry("Invalid exact offer identity, destination or verification window")
            }
        }
    }

    public static func decode(_ data: Data) throws -> Self {
        guard data.count <= maximumBytes else { throw MerchandiseError.invalidRegistry("Registry exceeds 128 KiB") }
        return try JSONDecoder().decode(Self.self, from: data)
    }

    public static func bundled() throws -> Self {
        guard let url = Bundle.module.url(forResource: "merchandise", withExtension: "json") else {
            throw MerchandiseError.missingResource
        }
        return try decode(Data(contentsOf: url))
    }

    /// An unavailable/expired mapping produces no CTA. The destination remains US only.
    public func handoff(for moleculeID: String, countryCode: String = "US", now: Date = Date()) -> MerchandiseHandoff? {
        guard storefrontPublic, countryCode == "US",
              let offer = offers.first(where: { $0.moleculeID == moleculeID && $0.countryCode == countryCode }),
              offer.ready, let verified = Self.date(offer.verifiedAt), let expires = Self.date(offer.expiresAt),
              verified <= now, now < expires else { return nil }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "loot.lupi.live"
        components.path = "/products/" + offer.productHandle
        components.queryItems = [
            URLQueryItem(name: "variant", value: String(offer.shopifyVariantID.split(separator: "/").last ?? "")),
            URLQueryItem(name: "utm_source", value: "lupi-ios"),
            URLQueryItem(name: "utm_medium", value: "app"),
            URLQueryItem(name: "utm_campaign", value: offer.campaignID),
            URLQueryItem(name: "utm_content", value: offer.creativeID),
        ]
        guard let url = components.url else { return nil }
        return MerchandiseHandoff(offerID: offer.id, moleculeID: offer.moleculeID, title: offer.title,
            shopifyProductID: offer.shopifyProductID, shopifyVariantID: offer.shopifyVariantID,
            printArtifactDigest: offer.printArtifactDigest, countryCode: countryCode, validUntil: expires, url: url)
    }

    private static func slug(_ value: String, maximum: Int = 80) -> Bool {
        value.count <= maximum && matches(value, "^[a-z0-9]+(?:-[a-z0-9]+)*$")
    }
    private static func matches(_ value: String, _ pattern: String) -> Bool {
        guard let range = value.range(of: pattern, options: .regularExpression) else { return false }
        return range.lowerBound == value.startIndex && range.upperBound == value.endIndex
    }
    private static func date(_ value: String) -> Date? {
        guard matches(value, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$") else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}

/// Preview lifecycle state is clock-injected so the same visible molecule can
/// lose an expired CTA without a new selection or another network request.
public struct MerchandisePreviewState: Sendable {
    private var registry: MerchandiseRegistry?
    public private(set) var handoff: MerchandiseHandoff?

    public init() {}

    public mutating func replaceRegistry(_ registry: MerchandiseRegistry?, moleculeID: String, now: Date = Date()) {
        self.registry = registry
        revalidate(moleculeID: moleculeID, now: now)
    }

    public mutating func revalidate(moleculeID: String, now: Date = Date()) {
        handoff = registry?.handoff(for: moleculeID, now: now)
    }
}
