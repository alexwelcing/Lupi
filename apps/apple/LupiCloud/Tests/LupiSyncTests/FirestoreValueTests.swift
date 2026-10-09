import Foundation
import Testing

@testable import LupiSync

@Suite("Firestore timestamps")
struct FirestoreTimestampTests {
  @Test("RFC 3339 in, Z-normalized with 0/3/6/9 digits out")
  func roundTrip() throws {
    let cases: [(String, String, Int64, Int32)] = [
      ("1970-01-01T00:00:00Z", "1970-01-01T00:00:00Z", 0, 0),
      ("2014-10-02T15:01:23Z", "2014-10-02T15:01:23Z", 1_412_262_083, 0),
      ("2014-10-02T15:01:23.045123456Z", "2014-10-02T15:01:23.045123456Z", 1_412_262_083, 45_123_456),
      ("2014-10-02T15:01:23.045Z", "2014-10-02T15:01:23.045Z", 1_412_262_083, 45_000_000),
      ("2014-10-02T15:01:23.0451Z", "2014-10-02T15:01:23.045100Z", 1_412_262_083, 45_100_000),
      ("2014-10-02T15:01:23+05:30", "2014-10-02T09:31:23Z", 1_412_242_283, 0),
      ("2024-02-29T23:59:59.999999Z", "2024-02-29T23:59:59.999999Z", 1_709_251_199, 999_999_000),
      ("1969-12-31T23:59:59.5Z", "1969-12-31T23:59:59.500Z", -1, 500_000_000),
    ]
    for (input, output, seconds, nanos) in cases {
      let parsed = try #require(FirestoreTimestamp(rfc3339: input), "\(input)")
      #expect(parsed == FirestoreTimestamp(seconds: seconds, nanos: nanos), "\(input)")
      #expect(parsed.rfc3339 == output, "\(input)")
      #expect(FirestoreTimestamp(rfc3339: output) == parsed)
    }
  }

  @Test("rejects malformed text")
  func malformed() {
    for text in ["", "2014-10-02", "2014-10-02T15:01:23", "2014-13-02T15:01:23Z", "2014-10-02T15:01:23.Z", "2014-10-02 15:01:23Z", "2014-10-02T15:01:23Zjunk"] {
      #expect(FirestoreTimestamp(rfc3339: text) == nil, "\(text)")
    }
  }

  @Test("Date conversion truncates to Firestore's microseconds")
  func dates() {
    let date = Date(timeIntervalSince1970: 1_790_000_000.123_456_789)
    let stamp = FirestoreTimestamp(date: date)
    #expect(stamp.seconds == 1_790_000_000)
    #expect(stamp.nanos % 1000 == 0)
    #expect(abs(stamp.date.timeIntervalSince(date)) < 0.000_002)
    #expect(FirestoreTimestamp(date: stamp.date) == stamp)
    #expect(FirestoreTimestamp(date: Date(timeIntervalSince1970: -0.25)) == FirestoreTimestamp(seconds: -1, nanos: 750_000_000))
  }
}

@Suite("Firestore Value JSON")
struct FirestoreValueJSONTests {
  @Test("each kind encodes as the REST reference spells it")
  func golden() {
    let cases: [(FirestoreValue, String)] = [
      (.null, #"{"nullValue":null}"#),
      (.boolean(true), #"{"booleanValue":true}"#),
      (.integer(-9_007_199_254_740_993), #"{"integerValue":"-9007199254740993"}"#),
      (.double(1.5), #"{"doubleValue":1.5}"#),
      (.double(.infinity), #"{"doubleValue":"Infinity"}"#),
      (.double(.nan), #"{"doubleValue":"NaN"}"#),
      (.timestamp(FirestoreTimestamp(seconds: 1_412_262_083, nanos: 45_123_000)), #"{"timestampValue":"2014-10-02T15:01:23.045123Z"}"#),
      (.string("Ca²⁺ & \"ions\""), #"{"stringValue":"Ca²⁺ & \"ions\""}"#),
      (.bytes(Data([0, 1, 254, 255])), #"{"bytesValue":"AAH+/w=="}"#),
      (.reference("projects/p/databases/(default)/documents/users/u"), #"{"referenceValue":"projects/p/databases/(default)/documents/users/u"}"#),
      (.geoPoint(latitude: 51.5, longitude: -0.12), #"{"geoPointValue":{"latitude":51.5,"longitude":-0.12}}"#),
      (.array([.integer(1), .string("a")]), #"{"arrayValue":{"values":[{"integerValue":"1"},{"stringValue":"a"}]}}"#),
      (.map(["b": .boolean(false), "a": .null]), #"{"mapValue":{"fields":{"a":{"nullValue":null},"b":{"booleanValue":false}}}}"#),
    ]
    for (value, json) in cases {
      #expect(value.json == json)
    }
  }

  @Test("decodes what Google sends, including its shortcuts")
  func decoding() throws {
    let cases: [(String, FirestoreValue)] = [
      (#"{"integerValue":"42"}"#, .integer(42)),
      (#"{"integerValue":42}"#, .integer(42)),
      (#"{"doubleValue":3}"#, .double(3)),
      (#"{"doubleValue":"-Infinity"}"#, .double(-.infinity)),
      (#"{"arrayValue":{}}"#, .array([])),
      (#"{"mapValue":{}}"#, .map([:])),
      (#"{"bytesValue":"AAH-_w"}"#, .bytes(Data([0, 1, 254, 255]))),
      (#"{"timestampValue":"2026-10-04T21:45:50.123456Z"}"#, .timestamp(FirestoreTimestamp(rfc3339: "2026-10-04T21:45:50.123456Z")!)),
      (#"{"geoPointValue":{}}"#, .geoPoint(latitude: 0, longitude: 0)),
    ]
    for (json, expected) in cases {
      #expect(try JSONDecoder().decode(FirestoreValue.self, from: Data(json.utf8)) == expected, "\(json)")
    }
    #expect(throws: (any Error).self) { try JSONDecoder().decode(FirestoreValue.self, from: Data("{}".utf8)) }
    #expect(throws: (any Error).self) {
      try JSONDecoder().decode(FirestoreValue.self, from: Data(#"{"integerValue":"1","stringValue":"x"}"#.utf8))
    }
  }

  @Test("a REST document decodes, with or without fields")
  func document() throws {
    let json = #"""
    {"name":"projects/demo-lupi/databases/(default)/documents/users/u1/trophies/t1",
     "fields":{"schema":{"stringValue":"lupi.trophy.v1"},"deleted":{"booleanValue":false}},
     "createTime":"2026-10-04T21:45:50.123456Z","updateTime":"2026-10-04T21:45:51Z"}
    """#
    let document = try JSONDecoder().decode(FirestoreDocument.self, from: Data(json.utf8))
    #expect(document.documentID == "t1")
    #expect(document.fields["schema"] == .string("lupi.trophy.v1"))
    #expect(document.updateTime == FirestoreTimestamp(seconds: 1_791_150_351))
    let bare = try JSONDecoder().decode(FirestoreDocument.self, from: Data(#"{"name":"projects/p/databases/d/documents/c/x"}"#.utf8))
    #expect(bare.fields.isEmpty)
  }
}

@Suite("Codable <-> Firestore Value")
struct FirestoreCoderTests {
  struct Everything: Codable, Equatable {
    enum Kind: String, Codable { case spawned, broken }
    enum Shape: Codable, Equatable {
      case sphere(radius: Double)
      case box(x: Int, y: Int)
    }

    var flag: Bool
    var small: Int8
    var big: Int64
    var unsigned: UInt32
    var ratio: Double
    var single: Float
    var text: String
    var when: Date
    var blob: Data
    var link: URL
    var kind: Kind
    var shapes: [Shape]
    var tags: [String]
    var nested: [String: [Int]]
    var maybe: String?
    var never: String?
  }

  static let sample = Everything(
    flag: true,
    small: -8,
    big: Int64.max,
    unsigned: 4_000_000_000,
    ratio: 0.1,
    single: 0.5,
    text: "C₈H₁₀N₄O₂",
    when: Date(timeIntervalSince1970: 1_790_000_000.5),
    blob: Data([1, 2, 3]),
    link: URL(string: "https://lupi.live/m/caffeine")!,
    kind: .broken,
    shapes: [.sphere(radius: 1.5), .box(x: 2, y: 3)],
    tags: ["a", "b"],
    nested: ["even": [2, 4]],
    maybe: "here",
    never: nil
  )

  @Test("maps Swift types onto Firestore types and back")
  func roundTrip() throws {
    let value = try FirestoreEncoder().encode(Self.sample)
    let fields = try #require(value.mapFields)
    #expect(fields["flag"] == .boolean(true))
    #expect(fields["small"] == .integer(-8))
    #expect(fields["big"] == .integer(Int64.max))
    #expect(fields["unsigned"] == .integer(4_000_000_000))
    #expect(fields["single"] == .double(0.5))
    #expect(fields["when"] == .timestamp(FirestoreTimestamp(seconds: 1_790_000_000, nanos: 500_000_000)))
    #expect(fields["blob"] == .bytes(Data([1, 2, 3])))
    #expect(fields["link"] == .string("https://lupi.live/m/caffeine"))
    #expect(fields["kind"] == .string("broken"))
    #expect(fields["tags"] == .array([.string("a"), .string("b")]))
    #expect(fields["nested"] == .map(["even": .array([.integer(2), .integer(4)])]))
    #expect(fields["never"] == nil, "nil optionals are omitted, as synthesized Codable does")
    let decoded = try FirestoreDecoder().decode(Everything.self, from: value)
    #expect(decoded == Self.sample)
  }

  @Test("golden: a trophy payload as Firestore fields")
  func goldenTrophy() throws {
    var trophy = TestTrophy.make("8C2E7A4B-1F7D-4C0E-9B1A-2D3E4F5A6B7C")
    trophy.molecule = .init(source: "built", id: nil, url: nil, sha256: "ab12", formula: "H2O", xyz: "3\nwater\nO 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n")
    trophy.origin = .init(kind: "built", from: nil)
    trophy.look = .init(scale: 2.5, finish: "gold")
    let json = try FirestoreEncoder().encode(trophy).json
    #expect(
      json
        == #"{"mapValue":{"fields":{"createdAt":{"timestampValue":"2026-09-21T14:13:20Z"},"id":{"stringValue":"8C2E7A4B-1F7D-4C0E-9B1A-2D3E4F5A6B7C"},"look":{"mapValue":{"fields":{"finish":{"stringValue":"gold"},"scale":{"doubleValue":2.5}}}},"molecule":{"mapValue":{"fields":{"formula":{"stringValue":"H2O"},"sha256":{"stringValue":"ab12"},"source":{"stringValue":"built"},"xyz":{"stringValue":"3\nwater\nO 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n"}}}},"name":{"stringValue":"Caffeine"},"origin":{"mapValue":{"fields":{"kind":{"stringValue":"built"}}}}}}}"#
    )
    let back = try FirestoreDecoder().decode(TestTrophy.self, from: try JSONDecoder().decode(FirestoreValue.self, from: Data(json.utf8)))
    #expect(back == trophy)
  }

  @Test("refuses what Firestore cannot store")
  func refusals() {
    struct Grid: Encodable { var rows: [[Int]] }
    #expect(throws: FirestoreCodingError.nestedArray(path: "rows.[0]")) {
      try FirestoreEncoder().encode(Grid(rows: [[1]]))
    }
    #expect(throws: FirestoreCodingError.invalidKey(path: "<root>", key: "__name__")) {
      try FirestoreEncoder().encode(["__name__": 1])
    }
    #expect(throws: FirestoreCodingError.invalidKey(path: "<root>", key: "")) {
      try FirestoreEncoder().encode(["": 1])
    }
    #expect(throws: FirestoreCodingError.integerOverflow(path: "<root>")) {
      try FirestoreEncoder().encode(UInt64.max)
    }
  }

  @Test("lenient numbers, strict types")
  func decoding() throws {
    struct Numbers: Decodable { var count: Int; var scale: Double }
    let numbers = try FirestoreDecoder().decode(Numbers.self, fields: ["count": .double(3), "scale": .integer(2)])
    #expect(numbers.count == 3 && numbers.scale == 2)
    #expect(throws: FirestoreCodingError.self) {
      try FirestoreDecoder().decode(Numbers.self, fields: ["count": .double(3.5), "scale": .integer(2)])
    }
    #expect(throws: FirestoreCodingError.typeMismatch(path: "count", expected: "integer", found: "string")) {
      try FirestoreDecoder().decode(Numbers.self, fields: ["count": .string("3"), "scale": .integer(2)])
    }
    #expect(throws: DecodingError.self) {
      try FirestoreDecoder().decode(Numbers.self, fields: ["scale": .integer(2)])
    }
    struct Small: Decodable { var tiny: Int8 }
    #expect(throws: FirestoreCodingError.integerOverflow(path: "tiny")) {
      try FirestoreDecoder().decode(Small.self, fields: ["tiny": .integer(300)])
    }
    struct Optional: Decodable { var note: String? }
    #expect(try FirestoreDecoder().decode(Optional.self, fields: ["note": .null]).note == nil)
    #expect(try FirestoreDecoder().decode(Optional.self, fields: [:]).note == nil)
  }
}
