import Foundation
import LupiChem
import LupiGame
import LupiScale
import LupiScaleCore
import Testing

@Suite("catalog and the scale receipt")
struct CatalogTests {
    @Test func theTrayStartsWithC60AndHoldsEveryStarter() throws {
        let catalog = Fixture.catalog
        #expect(catalog.tray.first?.id == "c60_buckyball")
        #expect(catalog.tray.count == 13)
        #expect(catalog.tray.contains { $0.id == "hydrogen_peroxide" && $0.subtitle == "H2O2" })
        #expect(catalog.receipt.map(\.subtitle) == ["1,000 atoms", "1,000,000 atoms", "1,000,000,000 atoms"])
    }

    /// Starters copied byte for byte from the gallery are the spec's leaves (scale-spec §12.2).
    @Test func galleryStartersAreTheSpecsLeaves() throws {
        let catalog = Fixture.catalog
        let water = try catalog.content(.starter("water")).ref
        let caffeine = try catalog.content(.starter("caffeine")).ref
        #expect(water.root.hex == "8985f649ff0866084daa120d8b4a02db7124823d408d32487a63bb870b3a553a")
        #expect(caffeine.root.hex == "54c3bbfb50de8c1f7a11af255980822b2be57d1eff18908046ccabee382fcc84")
        #expect(water.records.first?.bytes.count == 56)
        // A leaf reference carries its probe and resolves to itself.
        let (_, count) = try caffeine.resolve(extra: nil)
        #expect(count.formatted == "24")
    }

    /// The receipt's rungs are the spec's towers (scale-spec §12.4), with exact counts.
    @Test func theReceiptRungsAreTheSpecsTowers() throws {
        for rung in ReceiptRung.allCases {
            let ref = try SaltLadder.ref(levels: rung.levels)
            #expect(ref.root.hex == rung.specNodeID)
            let (_, count) = try ref.resolve(extra: nil)
            #expect(count == Magnitude.tower(seedCount: 1000, factor: 10, levels: rung.levels))
        }
        #expect(try SaltLadder.record(levels: 0).bytes.count == 126)
        #expect(try SaltLadder.record(levels: 6).bytes.count == 127)
        // 229 bytes for the 10⁶ and 10⁹ rungs with both records embedded (scale.md §6.2).
        #expect(try SaltLadder.ref(levels: 3).encoded().count == 229)
        #expect(try SaltLadder.ref(levels: 6).encoded().count == 229)
    }

    @Test func theHUDTotalIsExact() throws {
        let counts = ReceiptRung.allCases.map { Magnitude.tower(seedCount: 1000, factor: 10, levels: $0.levels) }
        #expect(PlaySession.total(counts) == "1,001,001,000")
        #expect(PlaySession.total([]) == "0")
        // Towers of different factors past plain integers do not add: both are listed (scale-spec §5.2).
        let googolplex = Magnitude.tower(seedCount: 1000, factor: 10, levels: try BigUInt.power(10, 100) - BigUInt(3))
        let grown = Magnitude.tower(seedCount: 3, factor: 2, levels: 70_000)
        #expect(PlaySession.total([googolplex, grown]) == "10^(10^100) + 3 × 2^70000")
    }
}
