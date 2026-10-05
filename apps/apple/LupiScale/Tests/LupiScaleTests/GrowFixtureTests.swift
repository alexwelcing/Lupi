import Foundation
import LupiScale
import LupiScaleCore
import Testing

/// Grow ×2's periods are [B] (§10.7): the same body grows into the same record on every device,
/// so the first tap reproduces the TypeScript reference's records in `Tests/Fixtures/scale-v1.json`.
@Suite("Fixture: Grow ×2 (§10.7)")
struct GrowFixtureTests {
    struct Row: Sendable {
        let name: String, seed: String, record: String, periods: [String]
    }

    static let rows: [Row] = {
        let url = Gallery.root.appendingPathComponent("apps/apple/LupiScale/Tests/Fixtures/scale-v1.json")
        let json = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        return (json["grow"] as! [[String: Any]]).map {
            Row(name: $0["name"] as! String, seed: $0["seed"] as! String, record: $0["record"] as! String, periods: $0["periods"] as! [String])
        }
    }()

    @Test func firstTaps() throws {
        let seeds = [Content.water, try NodeRecord(.leaf(Gallery.leaf(Gallery.caffeine)))]
        #expect(Self.rows.count == 2)
        for row in Self.rows {
            let name = row.name
            let seed = try #require(seeds.first { $0.id.hex == row.seed }, "\(name)")
            guard case let .leaf(leaf)? = seed.node else { Issue.record("\(name): a leaf"); continue }
            let periods = GrowRule.periods(leaf)
            #expect((0..<3).map { String(periods[$0][$0]) } == row.periods, "\(name): periods")
            let r = Resolver(store: RecordStore([seed]))
            let body = BodyFrame(ref: ScaleRef(root: seed.id, records: [seed], path: Path()), metresPerAnchorUnit: 1e-10)
            let (tower, embedded) = try growRecords(body, resolver: r)
            #expect(tower.bytes.map { String(format: "%02x", $0) }.joined() == row.record, "\(name): record")
            #expect(embedded?.id == seed.id)
        }
    }
}
