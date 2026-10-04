import Foundation

/// The fixture directory, found from this file so `swift test` needs no resource bundle.
enum Fixtures {
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("Fixtures")

    static func data(_ relative: String) throws -> Data {
        try Data(contentsOf: root.appendingPathComponent(relative))
    }

    static func decode<T: Decodable>(_ type: T.Type, _ relative: String) throws -> T {
        try JSONDecoder().decode(type, from: data(relative))
    }
}
