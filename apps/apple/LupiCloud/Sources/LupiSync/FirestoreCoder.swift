import Foundation

// Codable <-> FirestoreValue. Swift types map onto Firestore's own types rather
// than through JSON, so a Date stays a timestamp and Data stays bytes:
//
//   Bool -> boolean          Int*, UInt* -> integer (int64)
//   Float, Double -> double  String, URL -> string
//   Date -> timestamp        Data -> bytes
//   nil -> null              arrays -> array (never directly nested)
//   keyed types -> map       FirestoreValue, FirestoreTimestamp -> themselves

public enum FirestoreCodingError: Error, Sendable, Equatable {
  /// Firestore arrays cannot hold arrays; wrap the inner one in a struct.
  case nestedArray(path: String)
  /// Map keys must be non-empty and not `__reserved__`.
  case invalidKey(path: String, key: String)
  case integerOverflow(path: String)
  case typeMismatch(path: String, expected: String, found: String)
  case missingKey(path: String, key: String)
}

func describe(_ path: [any CodingKey]) -> String {
  path.isEmpty ? "<root>" : path.map { $0.intValue.map { "[\($0)]" } ?? $0.stringValue }.joined(separator: ".")
}

// MARK: - Encoder

public struct FirestoreEncoder: Sendable {
  public init() {}

  public func encode<T: Encodable>(_ value: T) throws -> FirestoreValue {
    let node = EncodingNode()
    try FirestoreEncoder.encodeValue(value, into: node, path: [])
    return try node.resolve(path: [])
  }

  /// The `fields` of a document: the value must encode as a map.
  public func encodeFields<T: Encodable>(_ value: T) throws -> [String: FirestoreValue] {
    let encoded = try encode(value)
    guard case .map(let fields) = encoded else {
      throw FirestoreCodingError.typeMismatch(path: "<root>", expected: "map", found: encoded.kindName)
    }
    return fields
  }

  static func encodeValue<T: Encodable>(_ value: T, into node: EncodingNode, path: [any CodingKey]) throws {
    switch value {
    case let date as Date:
      node.kind = .value(.timestamp(FirestoreTimestamp(date: date)))
    case let data as Data:
      node.kind = .value(.bytes(data))
    case let url as URL:
      node.kind = .value(.string(url.absoluteString))
    case let decimal as Decimal:
      node.kind = .value(.double(NSDecimalNumber(decimal: decimal).doubleValue))
    case let timestamp as FirestoreTimestamp:
      node.kind = .value(.timestamp(timestamp))
    case let firestoreValue as FirestoreValue:
      node.kind = .value(firestoreValue)
    default:
      try value.encode(to: FirestoreEncoderImpl(node: node, codingPath: path))
    }
  }
}

/// A reference-typed tree so nested containers can be filled after they are
/// handed out, as Codable requires.
final class EncodingNode {
  enum Kind {
    case unset
    case value(FirestoreValue)
    case map([String: EncodingNode])
    case array([EncodingNode])
  }

  var kind: Kind = .unset

  func resolve(path: [any CodingKey]) throws -> FirestoreValue {
    switch kind {
    case .unset:
      return .map([:])
    case .value(let value):
      return value
    case .map(let children):
      var fields: [String: FirestoreValue] = [:]
      for (key, child) in children {
        guard !key.isEmpty, !(key.hasPrefix("__") && key.hasSuffix("__") && key.count >= 4) else {
          throw FirestoreCodingError.invalidKey(path: describe(path), key: key)
        }
        fields[key] = try child.resolve(path: path + [AnyKey(key)])
      }
      return .map(fields)
    case .array(let children):
      var values: [FirestoreValue] = []
      for (index, child) in children.enumerated() {
        let value = try child.resolve(path: path + [AnyKey(index)])
        if case .array = value {
          throw FirestoreCodingError.nestedArray(path: describe(path + [AnyKey(index)]))
        }
        values.append(value)
      }
      return .array(values)
    }
  }

  func mapChild(_ key: String) -> EncodingNode {
    var children: [String: EncodingNode]
    if case .map(let existing) = kind { children = existing } else { children = [:] }
    let child = children[key] ?? EncodingNode()
    children[key] = child
    kind = .map(children)
    return child
  }

  func appendChild() -> EncodingNode {
    var children: [EncodingNode]
    if case .array(let existing) = kind { children = existing } else { children = [] }
    let child = EncodingNode()
    children.append(child)
    kind = .array(children)
    return child
  }

  var arrayCount: Int {
    if case .array(let children) = kind { return children.count }
    return 0
  }
}

struct AnyKey: CodingKey {
  var stringValue: String
  var intValue: Int?
  init(_ string: String) { stringValue = string; intValue = nil }
  init(_ int: Int) { stringValue = "\(int)"; intValue = int }
  init?(stringValue: String) { self.init(stringValue) }
  init?(intValue: Int) { self.init(intValue) }
}

struct FirestoreEncoderImpl: Encoder {
  let node: EncodingNode
  var codingPath: [any CodingKey]
  var userInfo: [CodingUserInfoKey: Any] { [:] }

  func container<Key: CodingKey>(keyedBy type: Key.Type) -> KeyedEncodingContainer<Key> {
    if case .map = node.kind {} else { node.kind = .map([:]) }
    return KeyedEncodingContainer(KeyedEncoder<Key>(node: node, codingPath: codingPath))
  }

  func unkeyedContainer() -> any UnkeyedEncodingContainer {
    if case .array = node.kind {} else { node.kind = .array([]) }
    return UnkeyedEncoder(node: node, codingPath: codingPath)
  }

  func singleValueContainer() -> any SingleValueEncodingContainer {
    SingleValueEncoder(node: node, codingPath: codingPath)
  }
}

private func integerValue<T: BinaryInteger>(_ value: T, path: [any CodingKey]) throws -> FirestoreValue {
  guard let exact = Int64(exactly: value) else { throw FirestoreCodingError.integerOverflow(path: describe(path)) }
  return .integer(exact)
}

struct KeyedEncoder<Key: CodingKey>: KeyedEncodingContainerProtocol {
  let node: EncodingNode
  var codingPath: [any CodingKey]

  private func set(_ value: FirestoreValue, _ key: Key) {
    node.mapChild(key.stringValue).kind = .value(value)
  }

  mutating func encodeNil(forKey key: Key) throws { set(.null, key) }
  mutating func encode(_ value: Bool, forKey key: Key) throws { set(.boolean(value), key) }
  mutating func encode(_ value: String, forKey key: Key) throws { set(.string(value), key) }
  mutating func encode(_ value: Double, forKey key: Key) throws { set(.double(value), key) }
  mutating func encode(_ value: Float, forKey key: Key) throws { set(.double(Double(value)), key) }
  mutating func encode(_ value: Int, forKey key: Key) throws { set(try integerValue(value, path: codingPath + [key]), key) }
  mutating func encode(_ value: Int8, forKey key: Key) throws { set(.integer(Int64(value)), key) }
  mutating func encode(_ value: Int16, forKey key: Key) throws { set(.integer(Int64(value)), key) }
  mutating func encode(_ value: Int32, forKey key: Key) throws { set(.integer(Int64(value)), key) }
  mutating func encode(_ value: Int64, forKey key: Key) throws { set(.integer(value), key) }
  mutating func encode(_ value: UInt, forKey key: Key) throws { set(try integerValue(value, path: codingPath + [key]), key) }
  mutating func encode(_ value: UInt8, forKey key: Key) throws { set(.integer(Int64(value)), key) }
  mutating func encode(_ value: UInt16, forKey key: Key) throws { set(.integer(Int64(value)), key) }
  mutating func encode(_ value: UInt32, forKey key: Key) throws { set(.integer(Int64(value)), key) }
  mutating func encode(_ value: UInt64, forKey key: Key) throws { set(try integerValue(value, path: codingPath + [key]), key) }

  mutating func encode<T: Encodable>(_ value: T, forKey key: Key) throws {
    try FirestoreEncoder.encodeValue(value, into: node.mapChild(key.stringValue), path: codingPath + [key])
  }

  mutating func nestedContainer<NestedKey: CodingKey>(
    keyedBy keyType: NestedKey.Type,
    forKey key: Key
  ) -> KeyedEncodingContainer<NestedKey> {
    let child = node.mapChild(key.stringValue)
    if case .map = child.kind {} else { child.kind = .map([:]) }
    return KeyedEncodingContainer(KeyedEncoder<NestedKey>(node: child, codingPath: codingPath + [key]))
  }

  mutating func nestedUnkeyedContainer(forKey key: Key) -> any UnkeyedEncodingContainer {
    let child = node.mapChild(key.stringValue)
    if case .array = child.kind {} else { child.kind = .array([]) }
    return UnkeyedEncoder(node: child, codingPath: codingPath + [key])
  }

  mutating func superEncoder() -> any Encoder {
    FirestoreEncoderImpl(node: node.mapChild("super"), codingPath: codingPath + [AnyKey("super")])
  }

  mutating func superEncoder(forKey key: Key) -> any Encoder {
    FirestoreEncoderImpl(node: node.mapChild(key.stringValue), codingPath: codingPath + [key])
  }
}

struct UnkeyedEncoder: UnkeyedEncodingContainer {
  let node: EncodingNode
  var codingPath: [any CodingKey]
  var count: Int { node.arrayCount }

  private func append(_ value: FirestoreValue) {
    node.appendChild().kind = .value(value)
  }

  private var nextPath: [any CodingKey] { codingPath + [AnyKey(count)] }

  mutating func encodeNil() throws { append(.null) }
  mutating func encode(_ value: Bool) throws { append(.boolean(value)) }
  mutating func encode(_ value: String) throws { append(.string(value)) }
  mutating func encode(_ value: Double) throws { append(.double(value)) }
  mutating func encode(_ value: Float) throws { append(.double(Double(value))) }
  mutating func encode(_ value: Int) throws { append(try integerValue(value, path: nextPath)) }
  mutating func encode(_ value: Int8) throws { append(.integer(Int64(value))) }
  mutating func encode(_ value: Int16) throws { append(.integer(Int64(value))) }
  mutating func encode(_ value: Int32) throws { append(.integer(Int64(value))) }
  mutating func encode(_ value: Int64) throws { append(.integer(value)) }
  mutating func encode(_ value: UInt) throws { append(try integerValue(value, path: nextPath)) }
  mutating func encode(_ value: UInt8) throws { append(.integer(Int64(value))) }
  mutating func encode(_ value: UInt16) throws { append(.integer(Int64(value))) }
  mutating func encode(_ value: UInt32) throws { append(.integer(Int64(value))) }
  mutating func encode(_ value: UInt64) throws { append(try integerValue(value, path: nextPath)) }

  mutating func encode<T: Encodable>(_ value: T) throws {
    let path = nextPath
    try FirestoreEncoder.encodeValue(value, into: node.appendChild(), path: path)
  }

  mutating func nestedContainer<NestedKey: CodingKey>(keyedBy keyType: NestedKey.Type) -> KeyedEncodingContainer<NestedKey> {
    let path = nextPath
    let child = node.appendChild()
    child.kind = .map([:])
    return KeyedEncodingContainer(KeyedEncoder<NestedKey>(node: child, codingPath: path))
  }

  mutating func nestedUnkeyedContainer() -> any UnkeyedEncodingContainer {
    let path = nextPath
    let child = node.appendChild()
    child.kind = .array([])
    return UnkeyedEncoder(node: child, codingPath: path)
  }

  mutating func superEncoder() -> any Encoder {
    let path = nextPath
    return FirestoreEncoderImpl(node: node.appendChild(), codingPath: path)
  }
}

struct SingleValueEncoder: SingleValueEncodingContainer {
  let node: EncodingNode
  var codingPath: [any CodingKey]

  mutating func encodeNil() throws { node.kind = .value(.null) }
  mutating func encode(_ value: Bool) throws { node.kind = .value(.boolean(value)) }
  mutating func encode(_ value: String) throws { node.kind = .value(.string(value)) }
  mutating func encode(_ value: Double) throws { node.kind = .value(.double(value)) }
  mutating func encode(_ value: Float) throws { node.kind = .value(.double(Double(value))) }
  mutating func encode(_ value: Int) throws { node.kind = .value(try integerValue(value, path: codingPath)) }
  mutating func encode(_ value: Int8) throws { node.kind = .value(.integer(Int64(value))) }
  mutating func encode(_ value: Int16) throws { node.kind = .value(.integer(Int64(value))) }
  mutating func encode(_ value: Int32) throws { node.kind = .value(.integer(Int64(value))) }
  mutating func encode(_ value: Int64) throws { node.kind = .value(.integer(value)) }
  mutating func encode(_ value: UInt) throws { node.kind = .value(try integerValue(value, path: codingPath)) }
  mutating func encode(_ value: UInt8) throws { node.kind = .value(.integer(Int64(value))) }
  mutating func encode(_ value: UInt16) throws { node.kind = .value(.integer(Int64(value))) }
  mutating func encode(_ value: UInt32) throws { node.kind = .value(.integer(Int64(value))) }
  mutating func encode(_ value: UInt64) throws { node.kind = .value(try integerValue(value, path: codingPath)) }

  mutating func encode<T: Encodable>(_ value: T) throws {
    try FirestoreEncoder.encodeValue(value, into: node, path: codingPath)
  }
}

// MARK: - Decoder

public struct FirestoreDecoder: Sendable {
  public init() {}

  public func decode<T: Decodable>(_ type: T.Type, from value: FirestoreValue) throws -> T {
    try FirestoreDecoder.decodeValue(type, from: value, path: [])
  }

  public func decode<T: Decodable>(_ type: T.Type, fields: [String: FirestoreValue]) throws -> T {
    try decode(type, from: .map(fields))
  }

  static func decodeValue<T: Decodable>(_ type: T.Type, from value: FirestoreValue, path: [any CodingKey]) throws -> T {
    if type == Date.self {
      guard case .timestamp(let timestamp) = value else { throw mismatch(path, "timestamp", value) }
      return timestamp.date as! T
    }
    if type == Data.self {
      guard case .bytes(let data) = value else { throw mismatch(path, "bytes", value) }
      return data as! T
    }
    if type == URL.self {
      guard case .string(let text) = value, let url = URL(string: text) else { throw mismatch(path, "URL string", value) }
      return url as! T
    }
    if type == Decimal.self {
      return Decimal(try FirestoreDecoderImpl.double(value, path: path)) as! T
    }
    if type == FirestoreTimestamp.self {
      guard case .timestamp(let timestamp) = value else { throw mismatch(path, "timestamp", value) }
      return timestamp as! T
    }
    if type == FirestoreValue.self {
      return value as! T
    }
    return try T(from: FirestoreDecoderImpl(value: value, codingPath: path))
  }
}

func mismatch(_ path: [any CodingKey], _ expected: String, _ value: FirestoreValue) -> FirestoreCodingError {
  .typeMismatch(path: describe(path), expected: expected, found: value.kindName)
}

extension FirestoreValue {
  var kindName: String {
    switch self {
    case .null: return "null"
    case .boolean: return "boolean"
    case .integer: return "integer"
    case .double: return "double"
    case .timestamp: return "timestamp"
    case .string: return "string"
    case .bytes: return "bytes"
    case .reference: return "reference"
    case .geoPoint: return "geoPoint"
    case .array: return "array"
    case .map: return "map"
    }
  }
}

struct FirestoreDecoderImpl: Decoder {
  let value: FirestoreValue
  var codingPath: [any CodingKey]
  var userInfo: [CodingUserInfoKey: Any] { [:] }

  func container<Key: CodingKey>(keyedBy type: Key.Type) throws -> KeyedDecodingContainer<Key> {
    guard case .map(let fields) = value else { throw mismatch(codingPath, "map", value) }
    return KeyedDecodingContainer(KeyedDecoder<Key>(fields: fields, codingPath: codingPath))
  }

  func unkeyedContainer() throws -> any UnkeyedDecodingContainer {
    guard case .array(let values) = value else { throw mismatch(codingPath, "array", value) }
    return UnkeyedDecoder(values: values, codingPath: codingPath)
  }

  func singleValueContainer() throws -> any SingleValueDecodingContainer {
    SingleValueDecoder(value: value, codingPath: codingPath)
  }

  // Lenient numbers: an integral double fills an Int field and an integer
  // fills a Double one, since other writers (the web, the console) may pick
  // either representation.
  static func integer<T: FixedWidthInteger>(_ value: FirestoreValue, as: T.Type, path: [any CodingKey]) throws -> T {
    switch value {
    case .integer(let raw):
      guard let exact = T(exactly: raw) else { throw FirestoreCodingError.integerOverflow(path: describe(path)) }
      return exact
    case .double(let raw):
      guard raw.rounded() == raw, let exact = T(exactly: raw) else { throw mismatch(path, "integer", value) }
      return exact
    default:
      throw mismatch(path, "integer", value)
    }
  }

  static func double(_ value: FirestoreValue, path: [any CodingKey]) throws -> Double {
    switch value {
    case .double(let raw): return raw
    case .integer(let raw): return Double(raw)
    default: throw mismatch(path, "double", value)
    }
  }

  static func bool(_ value: FirestoreValue, path: [any CodingKey]) throws -> Bool {
    guard case .boolean(let raw) = value else { throw mismatch(path, "boolean", value) }
    return raw
  }

  static func string(_ value: FirestoreValue, path: [any CodingKey]) throws -> String {
    switch value {
    case .string(let raw), .reference(let raw): return raw
    default: throw mismatch(path, "string", value)
    }
  }
}

struct KeyedDecoder<Key: CodingKey>: KeyedDecodingContainerProtocol {
  let fields: [String: FirestoreValue]
  var codingPath: [any CodingKey]

  var allKeys: [Key] { fields.keys.compactMap { Key(stringValue: $0) } }

  func contains(_ key: Key) -> Bool { fields[key.stringValue] != nil }

  private func value(_ key: Key) throws -> FirestoreValue {
    guard let value = fields[key.stringValue] else {
      throw DecodingError.keyNotFound(key, .init(codingPath: codingPath, debugDescription: "missing \(key.stringValue)"))
    }
    return value
  }

  private func path(_ key: Key) -> [any CodingKey] { codingPath + [key] }

  func decodeNil(forKey key: Key) throws -> Bool {
    guard let value = fields[key.stringValue] else { return true }
    if case .null = value { return true }
    return false
  }

  func decode(_ type: Bool.Type, forKey key: Key) throws -> Bool {
    try FirestoreDecoderImpl.bool(value(key), path: path(key))
  }
  func decode(_ type: String.Type, forKey key: Key) throws -> String {
    try FirestoreDecoderImpl.string(value(key), path: path(key))
  }
  func decode(_ type: Double.Type, forKey key: Key) throws -> Double {
    try FirestoreDecoderImpl.double(value(key), path: path(key))
  }
  func decode(_ type: Float.Type, forKey key: Key) throws -> Float {
    Float(try FirestoreDecoderImpl.double(value(key), path: path(key)))
  }
  func decode(_ type: Int.Type, forKey key: Key) throws -> Int { try int(key) }
  func decode(_ type: Int8.Type, forKey key: Key) throws -> Int8 { try int(key) }
  func decode(_ type: Int16.Type, forKey key: Key) throws -> Int16 { try int(key) }
  func decode(_ type: Int32.Type, forKey key: Key) throws -> Int32 { try int(key) }
  func decode(_ type: Int64.Type, forKey key: Key) throws -> Int64 { try int(key) }
  func decode(_ type: UInt.Type, forKey key: Key) throws -> UInt { try int(key) }
  func decode(_ type: UInt8.Type, forKey key: Key) throws -> UInt8 { try int(key) }
  func decode(_ type: UInt16.Type, forKey key: Key) throws -> UInt16 { try int(key) }
  func decode(_ type: UInt32.Type, forKey key: Key) throws -> UInt32 { try int(key) }
  func decode(_ type: UInt64.Type, forKey key: Key) throws -> UInt64 { try int(key) }

  private func int<T: FixedWidthInteger>(_ key: Key) throws -> T {
    try FirestoreDecoderImpl.integer(value(key), as: T.self, path: path(key))
  }

  func decode<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T {
    try FirestoreDecoder.decodeValue(type, from: value(key), path: path(key))
  }

  func nestedContainer<NestedKey: CodingKey>(
    keyedBy type: NestedKey.Type,
    forKey key: Key
  ) throws -> KeyedDecodingContainer<NestedKey> {
    try FirestoreDecoderImpl(value: value(key), codingPath: path(key)).container(keyedBy: type)
  }

  func nestedUnkeyedContainer(forKey key: Key) throws -> any UnkeyedDecodingContainer {
    try FirestoreDecoderImpl(value: value(key), codingPath: path(key)).unkeyedContainer()
  }

  func superDecoder() throws -> any Decoder {
    FirestoreDecoderImpl(value: fields["super"] ?? .null, codingPath: codingPath + [AnyKey("super")])
  }

  func superDecoder(forKey key: Key) throws -> any Decoder {
    FirestoreDecoderImpl(value: fields[key.stringValue] ?? .null, codingPath: path(key))
  }
}

struct UnkeyedDecoder: UnkeyedDecodingContainer {
  let values: [FirestoreValue]
  var codingPath: [any CodingKey]
  var currentIndex = 0

  init(values: [FirestoreValue], codingPath: [any CodingKey]) {
    self.values = values
    self.codingPath = codingPath
  }

  var count: Int? { values.count }
  var isAtEnd: Bool { currentIndex >= values.count }

  private var path: [any CodingKey] { codingPath + [AnyKey(currentIndex)] }

  private mutating func next() throws -> FirestoreValue {
    guard !isAtEnd else {
      throw DecodingError.valueNotFound(
        FirestoreValue.self,
        .init(codingPath: path, debugDescription: "unkeyed container is at end")
      )
    }
    defer { currentIndex += 1 }
    return values[currentIndex]
  }

  mutating func decodeNil() throws -> Bool {
    guard !isAtEnd else { return false }
    if case .null = values[currentIndex] {
      currentIndex += 1
      return true
    }
    return false
  }

  mutating func decode(_ type: Bool.Type) throws -> Bool {
    let p = path
    return try FirestoreDecoderImpl.bool(next(), path: p)
  }
  mutating func decode(_ type: String.Type) throws -> String {
    let p = path
    return try FirestoreDecoderImpl.string(next(), path: p)
  }
  mutating func decode(_ type: Double.Type) throws -> Double {
    let p = path
    return try FirestoreDecoderImpl.double(next(), path: p)
  }
  mutating func decode(_ type: Float.Type) throws -> Float {
    let p = path
    return Float(try FirestoreDecoderImpl.double(next(), path: p))
  }
  mutating func decode(_ type: Int.Type) throws -> Int { try int() }
  mutating func decode(_ type: Int8.Type) throws -> Int8 { try int() }
  mutating func decode(_ type: Int16.Type) throws -> Int16 { try int() }
  mutating func decode(_ type: Int32.Type) throws -> Int32 { try int() }
  mutating func decode(_ type: Int64.Type) throws -> Int64 { try int() }
  mutating func decode(_ type: UInt.Type) throws -> UInt { try int() }
  mutating func decode(_ type: UInt8.Type) throws -> UInt8 { try int() }
  mutating func decode(_ type: UInt16.Type) throws -> UInt16 { try int() }
  mutating func decode(_ type: UInt32.Type) throws -> UInt32 { try int() }
  mutating func decode(_ type: UInt64.Type) throws -> UInt64 { try int() }

  private mutating func int<T: FixedWidthInteger>() throws -> T {
    let p = path
    return try FirestoreDecoderImpl.integer(next(), as: T.self, path: p)
  }

  mutating func decode<T: Decodable>(_ type: T.Type) throws -> T {
    let p = path
    return try FirestoreDecoder.decodeValue(type, from: next(), path: p)
  }

  mutating func nestedContainer<NestedKey: CodingKey>(keyedBy type: NestedKey.Type) throws -> KeyedDecodingContainer<NestedKey> {
    let p = path
    return try FirestoreDecoderImpl(value: next(), codingPath: p).container(keyedBy: type)
  }

  mutating func nestedUnkeyedContainer() throws -> any UnkeyedDecodingContainer {
    let p = path
    return try FirestoreDecoderImpl(value: next(), codingPath: p).unkeyedContainer()
  }

  mutating func superDecoder() throws -> any Decoder {
    let p = path
    return FirestoreDecoderImpl(value: try next(), codingPath: p)
  }
}

struct SingleValueDecoder: SingleValueDecodingContainer {
  let value: FirestoreValue
  var codingPath: [any CodingKey]

  func decodeNil() -> Bool {
    if case .null = value { return true }
    return false
  }

  func decode(_ type: Bool.Type) throws -> Bool { try FirestoreDecoderImpl.bool(value, path: codingPath) }
  func decode(_ type: String.Type) throws -> String { try FirestoreDecoderImpl.string(value, path: codingPath) }
  func decode(_ type: Double.Type) throws -> Double { try FirestoreDecoderImpl.double(value, path: codingPath) }
  func decode(_ type: Float.Type) throws -> Float { Float(try FirestoreDecoderImpl.double(value, path: codingPath)) }
  func decode(_ type: Int.Type) throws -> Int { try int() }
  func decode(_ type: Int8.Type) throws -> Int8 { try int() }
  func decode(_ type: Int16.Type) throws -> Int16 { try int() }
  func decode(_ type: Int32.Type) throws -> Int32 { try int() }
  func decode(_ type: Int64.Type) throws -> Int64 { try int() }
  func decode(_ type: UInt.Type) throws -> UInt { try int() }
  func decode(_ type: UInt8.Type) throws -> UInt8 { try int() }
  func decode(_ type: UInt16.Type) throws -> UInt16 { try int() }
  func decode(_ type: UInt32.Type) throws -> UInt32 { try int() }
  func decode(_ type: UInt64.Type) throws -> UInt64 { try int() }

  private func int<T: FixedWidthInteger>() throws -> T {
    try FirestoreDecoderImpl.integer(value, as: T.self, path: codingPath)
  }

  func decode<T: Decodable>(_ type: T.Type) throws -> T {
    try FirestoreDecoder.decodeValue(type, from: value, path: codingPath)
  }
}
