import Foundation
@testable import LupiChem

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

/// Molecules from the bond fixtures, by case name, with their source XYZ when they have one.
enum FixtureMolecules {
    static func named(_ name: String) throws -> Molecule {
        for file in ["bonds-gallery.json", "bonds-synthetic.json", "bonds-omol25.json"] {
            let fixture = try Fixtures.decode(BondFixtureFile.self, "bonds/\(file)")
            if let item = fixture.cases.first(where: { $0.name == name }) {
                if let xyz = item.xyz { return try Molecule(xyz: xyz, name: name) }
                return Molecule(atomicNumbers: item.atomicNumbers, positions: item.floatPositions, name: name)
            }
        }
        throw FixtureMissing(name: name)
    }

    struct FixtureMissing: Error { var name: String }
}
