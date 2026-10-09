import Foundation
import Testing
@testable import LupiChem

// xyz-parse.json: the web parser's output for each case, written by
// tools/apple/export-bond-fixtures.mts.

struct ParseFixtureFile: Decodable {
    var schema: String
    var cases: [Case]

    struct Case: Decodable {
        var name: String
        var xyz: String
        var maxFrames: Int?
        var frames: [Frame]
        var error: String?
    }

    struct Frame: Decodable {
        var atomicNumbers: [Int]
        var positions: [Double]
        var periodic: Bool
        var timestep: Int
        var chemistry: FrameChemistry?
        var sourceRecord: OmolSourceRecord?
    }
}

@Suite("XYZ parser fixtures")
struct XYZFixtureTests {
    @Test("matches the web parser on every fixture case (frames, keys, errors)")
    func matchesWebParser() throws {
        let fixture = try Fixtures.decode(ParseFixtureFile.self, "bonds/xyz-parse.json")
        #expect(fixture.cases.count >= 20)
        for item in fixture.cases {
            if let message = item.error {
                do {
                    _ = try XYZParser.parse(item.xyz, maxFrames: item.maxFrames)
                    Issue.record("\(item.name): expected an error")
                } catch let error as XYZParseError {
                    #expect(error.message == message, "\(item.name)")
                }
                continue
            }
            let document = try XYZParser.parse(item.xyz, maxFrames: item.maxFrames)
            #expect(document.frames.count == item.frames.count, "\(item.name): frame count")
            for (frame, expected) in zip(document.frames, item.frames) {
                #expect(frame.atomicNumbers == expected.atomicNumbers, "\(item.name): atoms")
                let positions = frame.positions.flatMap { [Double($0.x), Double($0.y), Double($0.z)] }
                #expect(positions == expected.positions, "\(item.name): coordinates")
                #expect(frame.periodic == expected.periodic, "\(item.name): periodic")
                #expect(frame.timestep == expected.timestep, "\(item.name): timestep")
                #expect(frame.chemistry == expected.chemistry, "\(item.name): chemistry")
                #expect(frame.sourceRecord == expected.sourceRecord, "\(item.name): source record")
            }
        }
    }
}
