import Foundation
import Testing
@testable import LupiChem

// Golden fixtures from tools/apple/export-bond-fixtures.mts: the TypeScript
// perceiveBonds on fixed inputs. The Swift port must reproduce every run
// exactly: pairs, kinds, Float32 distances, counts and removed pairs.

struct BondFixtureFile: Decodable {
    var schema: String
    var cases: [BondFixtureCase]
}

struct BondFixtureCase: Decodable {
    var name: String
    var source: String
    var xyz: String?
    var periodic: Bool?
    var chemistry: FrameChemistry?
    var atomicNumbers: [Int]
    var positions: [Double]
    var runs: [Run]

    struct Run: Decodable {
        var recipe: String
        var tolerance: Double
        var appliedTolerance: Double
        var count: Int
        var pairs: [Int]
        var kinds: [UInt8]
        var distances: [Double]
        var counts: BondCounts
        var evidence: Evidence?
    }

    struct Evidence: Decodable {
        var pairs: [Int]
        var reasons: [UInt8]
    }

    var floatPositions: [SIMD3<Float>] {
        stride(from: 0, to: positions.count, by: 3).map {
            SIMD3(Float(positions[$0]), Float(positions[$0 + 1]), Float(positions[$0 + 2]))
        }
    }
}

@Suite("lupi-bonds golden fixtures")
struct BondFixtureTests {
    static let files = ["bonds-omol25.json", "bonds-gallery.json", "bonds-synthetic.json"]

    @Test("Swift perceiveBonds reproduces every TypeScript run", arguments: files)
    func reproducesFixtures(file: String) throws {
        let fixture = try Fixtures.decode(BondFixtureFile.self, "bonds/\(file)")
        #expect(fixture.schema == "lupi.apple-fixtures.bonds.v1")
        #expect(!fixture.cases.isEmpty)
        var runs = 0
        for item in fixture.cases {
            let positions = item.floatPositions
            for run in item.runs {
                let recipe = try #require(BondRecipe(rawValue: run.recipe))
                let p = BondPerception.perceive(
                    atomicNumbers: item.atomicNumbers, positions: positions, recipe: recipe, tolerance: run.tolerance
                )
                let label = "\(item.name) \(run.recipe) τ=\(run.tolerance)"
                #expect(p.tolerance == run.appliedTolerance, "\(label): tolerance")
                #expect(p.count == run.count, "\(label): count")
                #expect(p.bonds.flatMap { [$0.i, $0.j] } == run.pairs, "\(label): pairs")
                #expect(p.bonds.map(\.kind.rawValue) == run.kinds, "\(label): kinds")
                #expect(p.bonds.map(\.distance) == run.distances.map(Float.init), "\(label): distances")
                #expect(p.counts == run.counts, "\(label): counts")
                if let evidence = run.evidence {
                    let removed = try #require(p.evidence, "\(label): evidence")
                    #expect(removed.flatMap { [$0.i, $0.j] } == evidence.pairs, "\(label): removed pairs")
                    #expect(removed.map(\.reason.rawValue) == evidence.reasons, "\(label): removal reasons")
                }
                runs += 1
            }
        }
        #expect(runs >= fixture.cases.count * 2)
    }

    @Test("the Swift XYZ parser reads every file case to the same Float32 coordinates", arguments: files)
    func parserMatchesFixtureCoordinates(file: String) throws {
        let fixture = try Fixtures.decode(BondFixtureFile.self, "bonds/\(file)")
        for item in fixture.cases {
            guard let xyz = item.xyz else { continue }
            let frame = try XYZParser.parse(xyz, maxFrames: 1).first
            #expect(frame.atomicNumbers == item.atomicNumbers, "\(item.name): atomic numbers")
            #expect(frame.positions == item.floatPositions, "\(item.name): coordinates")
            #expect(frame.periodic == (item.periodic ?? false), "\(item.name): periodic")
            #expect(frame.chemistry == item.chemistry, "\(item.name): chemistry")
        }
    }

    @Test("output does not depend on the grid's insertion order")
    func insertionOrderIndependence() throws {
        let fixture = try Fixtures.decode(BondFixtureFile.self, "bonds/bonds-synthetic.json")
        var state: UInt64 = 0x9E37_79B9_7F4A_7C15
        func nextIndex(_ bound: Int) -> Int {
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Int((state >> 33) % UInt64(bound))
        }
        for item in fixture.cases where item.atomicNumbers.count > 3 {
            var order = Array(0..<item.atomicNumbers.count)
            for k in stride(from: order.count - 1, to: 0, by: -1) { order.swapAt(k, nextIndex(k + 1)) }
            for recipe in BondRecipe.allCases {
                let plain = BondPerception.perceive(
                    atomicNumbers: item.atomicNumbers, positions: item.floatPositions, recipe: recipe
                )
                let shuffled = BondPerception.perceive(
                    atomicNumbers: item.atomicNumbers, positions: item.floatPositions, recipe: recipe, insertionOrder: order
                )
                #expect(plain == shuffled, "\(item.name) \(recipe.rawValue)")
            }
        }
    }
}
