import Foundation
import LupiChem
import LupiData
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

/// M3a's content (plan §7.5): the salt ladder to a googolplex, copper's billion, a diamond and the
/// diamondoids, read from the bundled pack `lupi-scale-r1.lpk` (scale-spec §12.3, §12.4, §12.6).
@Suite("scale content")
struct ScaleContentTests {
    /// The pack the app writes at launch is scale-spec §12.6's, byte for byte.
    @Test func theBundledPackIsTheSpecsPack() throws {
        let bytes = try ScaleContent.bundledPackBytes()
        #expect(bytes.count == 65_536)
        #expect(SHA256.hex(Data(bytes)) == "d5f1d7ba69da089b970e7f1cdfe1f6e530c17d006c268ceee4bad0cd795a2794")
        let pack = try ScaleContent.bundledPack()
        #expect(pack.contentID.hex == "4ec7833bd79b74af882a100e2ef121fa928a01c02dcc5dc66e2282a127377e97")
        #expect(pack.nodeIDs.count == 21)
        #expect(pack.roots.map(\.0).sorted() == ([
            "salt-thousand", "salt-million", "salt-billion", "salt-e30", "salt-googol", "salt-googolplex",
            "copper-billion", "copper-billion-closed",
        ] + (1...12).map { "diamondoid-\($0)" }).sorted())
        for rung in SaltRung.allCases {
            #expect(pack.root(named: rung.packName)?.hex == rung.specNodeID)
        }
    }

    /// Every rung of the ladder with its exact count, as the HUD and the plaque print it.
    @Test func theLadderCountsExactly() throws {
        let catalog = Fixture.catalog
        let counts = SaltRung.allCases.map { rung in catalog.scale.first { $0.id == rung.packName }?.subtitle }
        #expect(counts == [
            "1,000 atoms", "1,000,000 atoms", "1,000,000,000 atoms", "10^30 atoms", "10^100 atoms", "10^(10^100) atoms",
        ])
        // The googolplex is 168 bytes over the 52-byte seed; every other rung up to the googol 127 (§12.4).
        let pack = try #require(catalog.scalePack)
        let plex = try ScaleContent.ref(.salt(.googolplex), pack: pack)
        #expect(plex.records.first { $0.id == plex.root }?.bytes.count == 168)
        #expect(try ScaleContent.ref(.salt(.e30), pack: pack).records.first { $0.id.hex == SaltRung.e30.specNodeID }?.bytes.count == 127)
        // 270 bytes kept: the bar with both records embedded (scale.md §6.2).
        #expect(try plex.encoded().count == 270)
        #expect(try ScaleContent.ref(.salt(.googol), pack: pack).encoded().count == 229)
    }

    /// Copper's billion is one 52-byte crystal record, the web's `BillionAtomBlock` (§12.3).
    @Test func copperIsOneRecord() throws {
        let pack = try #require(Fixture.catalog.scalePack)
        let open = try ScaleContent.ref(.copper(closed: false), pack: pack)
        let closed = try ScaleContent.ref(.copper(closed: true), pack: pack)
        #expect(open.root.hex == "42e22db697e0f938556fc8249e423ed986daa0c0ec08aa391afa67d4ad3cf421")
        #expect(closed.root.hex == "3d6fb40fa20087ff857d0c2d48dc1801cf55a388c840a8a566306fd7d9942911")
        #expect(open.records.map(\.bytes.count) == [52])
        #expect(try open.resolve(extra: nil).count.formatted == "1,000,188,000")
        #expect(try closed.resolve(extra: nil).count.formatted == "1,002,571,291")
    }

    /// The {111} diamondoids, adamantane to C₂₉₂₅H₆₇₆, with the spec's crystal and leaf NodeIDs; the
    /// ones small enough for a merged mesh draw through that very leaf (§12.3).
    @Test func diamondoidsAreTheSpecs() throws {
        let catalog = Fixture.catalog
        let pack = try #require(catalog.scalePack)
        let crystals = [
            "52c36dc60407419030601a1ec30bddfbafa0867faaaf0699e79cd982129263eb",
            "0b45c04d5fd7f2a9e8527a5ade8f7f5dc6723b7756ca082fc261179ec003f45a",
            "7353efe571661aad03ddab352cc8c039172e10b910ca24c5925ff72f202dfcef",
        ]
        let leaves = [
            "f74c5d0693dd6421a23fb664f7da9ba5af74e2d2cadfd997c63e22cce5fb9502",
            "78b0fb8f73a87c45a72354a1438297a28c12af6ce510a2439119b17d7c49bc63",
            "117d3d50457ca5655a76395d968c9fe219fea0474fe7bde6671efe28197f52b8",
        ]
        let atoms = [26, 71, 148, 265, 430, 651, 936, 1293, 1730, 2255, 2876, 3601]
        for m in 1...12 {
            let ref = try ScaleContent.ref(.diamondoid(m), pack: pack)
            let (view, count) = try ref.resolve(extra: nil)
            #expect(count.formatted == atoms[m - 1].formatted(.number.grouping(.automatic).locale(Locale(identifier: "en_US"))))
            let formula = try Resolver(store: RecordStore(ref.records)).composition(view).formula
            let c = (2 * m + 3) * (2 * m + 2) * (2 * m + 1) / 6
            #expect(formula == "C\(c)H\((2 * m + 2) * (2 * m + 2))")
            if m <= 3 { #expect(ref.root.hex == crystals[m - 1]) }
            let content = try catalog.content(.scale(.diamondoid(m)))
            if atoms[m - 1] <= 2000 {
                // Drawn through its own leaf; kept as the crystal record it is.
                #expect(content.identity?.root == ref.root)
                if m <= 3 { #expect(content.ref.root.hex == leaves[m - 1]) }
            } else {
                #expect(content.identity == nil)
            }
        }
        #expect(ScaleContent.diamondoidName(1) == "Adamantane")
        #expect(ScaleContent.diamondoidName(2) == "Decamantane")
        #expect(ScaleContent.diamondoidName(12) == "Diamondoid C2925H676")
    }

    /// One carat of diamond: 0.2 g of carbon in a closed cube 3.85 mm on a side.
    @Test func aCaratWeighsOneCarat() throws {
        let content = try Fixture.catalog.content(.scale(.diamond))
        let r = Resolver(store: RecordStore(content.ref.records))
        let view = try r.resolve(content.ref.root, content.ref.path)
        let mass = try r.composition(view).massMicroDa()
        let grams = exp(mass.lnM + log(Magnitude.kgPerMicroDalton)) * 1000
        #expect(abs(grams - 0.2) < 0.0000005)
        #expect(MassText.of(mass, isMolecule: false) == "200 mg")
        let side = try r.aggregate(view).bounds.longest * 1e-10
        #expect(abs(side - 0.003846) < 0.000002)
    }

    /// True masses on the plaque (plan §4.7, scale.md §5.8): the life-size cube weighs 48.6 t.
    @Test func trueMasses() throws {
        let catalog = Fixture.catalog
        func mass(_ item: ScaleItem) throws -> Magnitude {
            let ref = try catalog.content(.scale(item)).identity ?? catalog.content(.scale(item)).ref
            let r = Resolver(store: RecordStore(ref.records))
            return try r.composition(r.resolve(ref.root, ref.path)).massMicroDa()
        }
        #expect(MassText.of(try mass(.salt(.e30)), isMolecule: false) == "48.6 t")
        #expect(MassText.of(try mass(.salt(.thousand)), isMolecule: false) == "48.6 zg")
        #expect(MassText.of(try mass(.salt(.googolplex)), isMolecule: false).hasSuffix(" kg"))
        #expect(MassText.of(try mass(.salt(.googolplex)), isMolecule: false).contains("10^(10^100"))
        #expect(MassText.of(try mass(.diamondoid(1)), isMolecule: true) == "136.24 Da")
    }

    /// Every item spawns at scale-spec §10.1's size: cubes 15 cm, the googol and googolplex bars
    /// 30 × 3 × 3 cm, a diamondoid at the molecule toy scale.
    @Test func everyItemSpawnsAtItsSize() throws {
        var sim = Fixture.sim()
        for item in ScaleItem.all {
            sim.session.clear()
            sim.step()
            sim.session.spawn(.scale(item))
            sim.step()
            let id = try #require(sim.session.bodyOrder.last, "\(item.id)")
            let b = try #require(sim.session.body(id))
            let size = b.facts.aggregate.bounds.size * b.sigma
            switch item {
            case .salt(.googol), .salt(.googolplex):
                #expect(abs(size.x - 0.30) < 1e-6 && abs(size.y - 0.03) < 1e-3 && abs(size.z - 0.03) < 1e-3, "\(item.id) \(size)")
            case .salt, .copper, .diamond:
                #expect(abs(b.span - 0.15) < 1e-6, "\(item.id) \(b.span)")
            case let .diamondoid(m):
                // Drawn as a molecule up to 2,000 atoms, at its toy scale of 0.005 to 0.04 m/Å (plan
                // §4.1), so m = 8 and 9 exceed 15 cm; beyond, a capped crystal at 15 cm (§10.1).
                let longest = b.facts.aggregate.bounds.longest
                let expected = m <= 9 ? min(0.04, max(0.005, 0.15 / longest)) * longest : 0.15
                #expect(abs(b.span - expected) < 1e-9, "\(item.id) \(b.span)")
            }
            #expect(b.sizeState == .toy)
            #expect(b.facts.personality.personality.kind == (item.shelf == .salt ? .brittle : b.facts.personality.personality.kind))
        }
        #expect(sim.budgetViolations.isEmpty)
    }
}
