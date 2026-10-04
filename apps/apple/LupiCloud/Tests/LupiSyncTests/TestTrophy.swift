import Foundation
import LupiSync

/// Shaped like lupi.trophy.v1 (the real model lives in LupiKit): a molecule
/// reference, a name, when and how it was earned, and its look.
struct TestTrophy: SyncPayload, Identifiable, Equatable {
  struct Molecule: Codable, Equatable, Sendable {
    var source: String
    var id: String?
    var url: String?
    var sha256: String?
    var formula: String?
    var xyz: String?
  }

  struct Origin: Codable, Equatable, Sendable {
    var kind: String
    var from: String?
  }

  struct Look: Codable, Equatable, Sendable {
    var scale: Double
    var finish: String?
  }

  var id: String
  var molecule: Molecule
  var name: String
  var createdAt: Date
  var origin: Origin
  var look: Look

  static func make(
    _ id: String,
    name: String = "Caffeine",
    scale: Double = 1,
    createdAt: Date = Date(timeIntervalSince1970: 1_790_000_000)
  ) -> TestTrophy {
    TestTrophy(
      id: id,
      molecule: Molecule(source: "gallery", id: "caffeine", url: nil, sha256: nil, formula: "C8H10N4O2", xyz: nil),
      name: name,
      createdAt: createdAt,
      origin: Origin(kind: "spawned", from: nil),
      look: Look(scale: scale, finish: nil)
    )
  }
}

extension FirestoreValue {
  /// Value JSON with sorted keys, for golden comparisons.
  var json: String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(decoding: (try? encoder.encode(self)) ?? Data(), as: UTF8.self)
  }
}
