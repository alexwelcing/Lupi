import Foundation

/// A Firestore Value, encoded exactly as the REST API's JSON
/// (firebase.google.com/docs/firestore/reference/rest/v1/Value): one key per
/// value, integers as decimal strings, timestamps as RFC 3339, bytes as base64,
/// arrays under `values`, maps under `fields`.
public enum FirestoreValue: Sendable, Hashable {
  case null
  case boolean(Bool)
  case integer(Int64)
  case double(Double)
  case timestamp(FirestoreTimestamp)
  case string(String)
  case bytes(Data)
  case reference(String)
  case geoPoint(latitude: Double, longitude: Double)
  case array([FirestoreValue])
  case map([String: FirestoreValue])

  public var mapFields: [String: FirestoreValue]? {
    if case .map(let fields) = self { return fields }
    return nil
  }

  public var timestampValue: FirestoreTimestamp? {
    if case .timestamp(let value) = self { return value }
    return nil
  }

  public var stringValue: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  public var booleanValue: Bool? {
    if case .boolean(let value) = self { return value }
    return nil
  }
}

extension FirestoreValue: Codable {
  private enum Key: String, CodingKey {
    case nullValue, booleanValue, integerValue, doubleValue, timestampValue, stringValue
    case bytesValue, referenceValue, geoPointValue, arrayValue, mapValue
  }

  private struct ArrayBody: Codable {
    var values: [FirestoreValue]?
  }

  private struct MapBody: Codable {
    var fields: [String: FirestoreValue]?
  }

  private struct LatLng: Codable {
    var latitude: Double?
    var longitude: Double?
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Key.self)
    guard let key = container.allKeys.first, container.allKeys.count == 1 else {
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "a Value must have exactly one field")
      )
    }
    switch key {
    case .nullValue:
      self = .null
    case .booleanValue:
      self = .boolean(try container.decode(Bool.self, forKey: key))
    case .integerValue:
      // int64 travels as a string; accept a bare number too.
      if let text = try? container.decode(String.self, forKey: key) {
        guard let value = Int64(text) else {
          throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: "bad int64 \(text)")
        }
        self = .integer(value)
      } else {
        self = .integer(try container.decode(Int64.self, forKey: key))
      }
    case .doubleValue:
      // proto3 JSON spells the non-finite doubles as strings.
      if let text = try? container.decode(String.self, forKey: key) {
        switch text {
        case "NaN": self = .double(.nan)
        case "Infinity": self = .double(.infinity)
        case "-Infinity": self = .double(-.infinity)
        default:
          guard let value = Double(text) else {
            throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: "bad double \(text)")
          }
          self = .double(value)
        }
      } else {
        self = .double(try container.decode(Double.self, forKey: key))
      }
    case .timestampValue:
      self = .timestamp(try container.decode(FirestoreTimestamp.self, forKey: key))
    case .stringValue:
      self = .string(try container.decode(String.self, forKey: key))
    case .bytesValue:
      let text = try container.decode(String.self, forKey: key)
      guard let data = Data(base64Encoded: Self.paddedBase64(text)) else {
        throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: "bad base64")
      }
      self = .bytes(data)
    case .referenceValue:
      self = .reference(try container.decode(String.self, forKey: key))
    case .geoPointValue:
      let point = try container.decode(LatLng.self, forKey: key)
      self = .geoPoint(latitude: point.latitude ?? 0, longitude: point.longitude ?? 0)
    case .arrayValue:
      // An empty array arrives as {"arrayValue": {}}.
      self = .array(try container.decode(ArrayBody.self, forKey: key).values ?? [])
    case .mapValue:
      self = .map(try container.decode(MapBody.self, forKey: key).fields ?? [:])
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Key.self)
    switch self {
    case .null:
      try container.encodeNil(forKey: .nullValue)
    case .boolean(let value):
      try container.encode(value, forKey: .booleanValue)
    case .integer(let value):
      try container.encode(String(value), forKey: .integerValue)
    case .double(let value):
      if value.isNaN {
        try container.encode("NaN", forKey: .doubleValue)
      } else if value.isInfinite {
        try container.encode(value > 0 ? "Infinity" : "-Infinity", forKey: .doubleValue)
      } else {
        try container.encode(value, forKey: .doubleValue)
      }
    case .timestamp(let value):
      try container.encode(value, forKey: .timestampValue)
    case .string(let value):
      try container.encode(value, forKey: .stringValue)
    case .bytes(let value):
      try container.encode(value.base64EncodedString(), forKey: .bytesValue)
    case .reference(let value):
      try container.encode(value, forKey: .referenceValue)
    case .geoPoint(let latitude, let longitude):
      try container.encode(LatLng(latitude: latitude, longitude: longitude), forKey: .geoPointValue)
    case .array(let values):
      try container.encode(ArrayBody(values: values), forKey: .arrayValue)
    case .map(let fields):
      try container.encode(MapBody(fields: fields), forKey: .mapValue)
    }
  }

  /// Google may send unpadded or URL-safe base64.
  private static func paddedBase64(_ text: String) -> String {
    var normalized = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while normalized.count % 4 != 0 { normalized += "=" }
    return normalized
  }
}
