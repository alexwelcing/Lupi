import Foundation
import LupiChem
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

/// Picking, breaking, chipping and growing (§10.5–§10.7).
@Suite("§10 play")
struct PlayTests {
    // MARK: Personality (§10.6)

    @Test func everySaltRungIsBrittle() throws {
        for levels in [BigUInt(0), 3, 97, Content.googolplexLevels] {
            let rung = Content.rung(levels)
            let r = Content.resolver([rung])
            let p = try personality(for: r.root(rung.id), resolver: r)
            #expect(p.personality.kind == .brittle, "levels \(levels.description.prefix(8))")
        }
        let r = Resolver(store: RecordStore([Content.water]))
        #expect(try personality(for: r.root(Content.water.id), resolver: r).personality.kind != .brittle)
    }

    // MARK: Expansion (§10.6)

    /// The googolplex bar breaks into ten cubes of 10^(10^100 − 1) atoms that share its felt mass.
    @Test func theGoogolplexBarBreaksIntoTenCubes() throws {
        let rung = Content.rung(Content.googolplexLevels)
        let r = Content.resolver([rung])
        let bar = try Content.toy(Content.ref(rung), span: 0.3, centre: Vec3(0, 0, -0.5), resolver: r)
        let plan = try expand(bar, contactWorld: Vec3(0.15, 0, -0.5), budget: 16, resolver: r)
        #expect(plan.kind == .children)
        #expect(plan.pieces.count == 10)
        // Brittle salt, lattice-ionic: max(3 m/s, 2.5 √(60 / 346)) = 3 m/s.
        #expect(plan.threshold == 3.0)
        let cube = Magnitude.tower(seedCount: 1000, factor: 10, levels: try Content.googol - 4)
        let parentKg = FeltMass.kg(massLog(massMicroDa: try r.aggregate(r.root(rung.id)).massMicroDa), massScale: 0.85)
        for piece in plan.pieces {
            #expect(try piece.count.compare(cube) == 0)
            #expect(piece.cooldown == 1.0)
            #expect(abs(piece.separation.length - 0.4) < 1e-12)
            // Each 3 cm cube grows to 6 cm.
            #expect(piece.growToSpan == 0.06)
            #expect(abs(piece.feltMassKg! - max(0.06, parentKg / 10)) < 1e-9)
            #expect(piece.path.steps.count == 1)
        }
        // Nearest the contact first: the cube at the struck end.
        #expect(plan.pieces[0].centreWorld.x > plan.pieces[9].centreWorld.x)
        #expect(plan.newRecords.isEmpty)
    }

    /// With fewer pieces allowed than children, the B − 1 nearest go and the rest stays as one edit.
    @Test func aTightBudgetLeavesTheRestAsOneEdit() throws {
        let rung = Content.rung(Content.googolplexLevels)
        let r = Content.resolver([rung])
        let bar = try Content.toy(Content.ref(rung), span: 0.3, resolver: r)
        let plan = try expand(bar, contactWorld: Vec3(-0.15, 0, -0.5), budget: 4, resolver: r)
        #expect(plan.pieces.count == 4)
        #expect(plan.newRecords.count == 1)
        let rest = plan.pieces[3]
        #expect(rest.root == plan.newRecords[0].id)
        // Seven cubes remain.
        let seven = Magnitude.tower(seedCount: 7000, factor: 10, levels: try Content.googol - 4)
        #expect(try rest.count.compare(seven) == 0)
    }

    @Test func leavesBreakByBondChipOrOctant() throws {
        // Caffeine has bridges: a bond break into selections, each its own molecule.
        let caffeine = try NodeRecord(.leaf(Gallery.leaf(Gallery.caffeine)))
        let c60 = try NodeRecord(.leaf(Gallery.leaf(Gallery.c60)))
        let seedCopy = Content.rung(0)
        let r = Content.resolver([caffeine, c60, seedCopy])
        let caf = try Content.toy(ScaleRef(root: caffeine.id, records: [caffeine], path: Path()), span: 0.15, resolver: r)
        let bond = try expand(caf, contactWorld: Vec3(0, 0, -0.5), budget: 16, resolver: r)
        #expect(bond.kind == .bondBreak)
        #expect(bond.pieces.count == 2)
        #expect(bond.pieces.allSatisfy { $0.feltMassKg == nil && $0.cooldown == 0.25 })
        let atoms = try bond.pieces.reduce(0) { n, p in n + (try r.count(r.resolve(p.root, p.path)).plain!.int!) }
        #expect(atoms == 24)

        // C₆₀ is a cage: no bridge, 60 heavy atoms, so one carbon chips off.
        let cage = try Content.toy(ScaleRef(root: c60.id, records: [c60], path: Path()), span: 0.15, resolver: r)
        let chip = try expand(cage, contactWorld: Vec3(0, 0.07, -0.5), budget: 16, resolver: r)
        #expect(chip.kind == .chip)
        #expect(chip.pieces.count == 2)
        #expect(try r.count(r.resolve(chip.pieces[0].root, chip.pieces[0].path)).plain == BigUInt(1))

        // A salt seed copy: 1,000 heavy atoms and no bridge, so eight octants.
        let copy = try Content.toy(Content.ref(seedCopy), span: 0.15, resolver: r)
        let octants = try expand(copy, contactWorld: Vec3(0, 0, -0.5), budget: 16, resolver: r)
        #expect(octants.kind == .octants)
        #expect(octants.pieces.count == 8)
        #expect(try octants.pieces.reduce(0) { n, p in n + (try r.count(r.resolve(p.root, p.path)).plain!.int!) } == 1000)
    }

    @Test func aOneCellBoxFallsApartIntoLooseAtoms() throws {
        let crystal = try NodeRecord(.crystal(CrystalNode(structure: .fcc, termination: .open, speciesA: 29, speciesB: 0, quarterQ16: 59_228, cells: SIMD3(4, 4, 4))))
        let r = Resolver(store: RecordStore([crystal]))
        let path = try Path(canonicalizing: [.cells([0, 0])])
        let ref = ScaleRef(root: crystal.id, records: [crystal], path: path)
        let body = try Content.toy(ref, span: 0.06, resolver: r)
        let plan = try expand(body, contactWorld: Vec3(0, 0, -0.5), budget: 16, resolver: r)
        #expect(plan.kind == .looseAtoms)
        #expect(plan.pieces.count == 4)
    }

    // MARK: Chipping (§10.6)

    @Test func chippingMakesAPathAndAFlattenedRemainder() throws {
        let rung = Content.rung(3)
        let r = Content.resolver([rung])
        let monument = try Content.toy(Content.ref(rung), span: 1.5, resolver: r)
        let copySteps: [Step] = [.tower(levels: 3, runs: [[DigitRun(digit: 2, length: 1)], [DigitRun(digit: 4, length: 1)], [DigitRun(digit: 9, length: 1)]])]
        let first = try chip(monument, steps: copySteps, resolver: r)
        let withEdit = Resolver(store: StoreUnion([RecordStore(first.newRecords), r.store]))
        #expect(try withEdit.count(withEdit.resolve(first.chip.root, first.chip.path)).plain == BigUInt(1000))
        #expect(try withEdit.count(withEdit.resolve(first.remainder.root, first.remainder.path)).plain == BigUInt(999_000))
        // Chipping the remainder again flattens: one edit with both removals, of the original base.
        var rest = monument
        rest.ref = first.remainder
        let otherSteps: [Step] = [.tower(levels: 3, runs: [[DigitRun(digit: 0, length: 1)], [DigitRun(digit: 0, length: 1)], [DigitRun(digit: 0, length: 1)]])]
        let second = try chip(rest, steps: otherSteps, resolver: withEdit)
        guard case let .edit(e)? = second.newRecords.first?.node else { Issue.record("the remainder is an edit"); return }
        #expect(e.base == rung.id)
        #expect(e.removed.count == 2)
        // What is gone cannot be chipped again.
        let both = Resolver(store: StoreUnion([RecordStore(second.newRecords), withEdit.store]))
        var gone = rest
        gone.ref = second.remainder
        #expect(throws: ScaleError.self) { try chip(gone, steps: copySteps, resolver: both) }

        // In a materializable piece the remainder is the complement's selection.
        let copy = Content.rung(0)
        let cr = Content.resolver([copy])
        let small = try Content.toy(Content.ref(copy), span: 0.2, resolver: cr)
        let bit = try chip(small, steps: [.atoms([AtomRange(start: 10, length: 5)])], resolver: cr)
        #expect(bit.newRecords.isEmpty)
        #expect(try cr.count(cr.resolve(bit.remainder.root, bit.remainder.path)).plain == BigUInt(995))
    }

    // MARK: Growing (§10.7)

    /// Grow ×2 from the gallery water: periods 190,501, 224,869 and 214,389 Q16, and the records of §12.4.
    @Test func growingWater() throws {
        let periods = GrowRule.periods(Content.waterLeaf)
        #expect(periods == [SIMD3(190_501, 0, 0), SIMD3(0, 224_869, 0), SIMD3(0, 0, 214_389)])
        let water = Content.water
        var records = [water]
        var r = Resolver(store: RecordStore(records))
        var body = try Content.toy(ScaleRef(root: water.id, records: [water], path: Path()), span: 0.15, resolver: r)
        var spans: [Double] = []
        for tap in 1...100 {
            let (tower, seed) = try growRecords(body, resolver: r)
            if tap == 1 {
                #expect(seed?.id == water.id)
                #expect(tower.id.hex == "9a0d1fadcc862005945fb3a802e644fcb96ab88b7beccd45de8d2bb7889f8ddf")
            } else {
                #expect(seed == nil)
            }
            records.append(tower)
            let old = try r.aggregate(r.resolve(body.ref.root, body.ref.path))
            r = Resolver(store: RecordStore(records))
            let new = try r.aggregate(r.root(tower.id))
            let sigma = GrowRule.spanHoldingScale(old: old, oldScale: body.metresPerAnchorUnit, new: new)
            body = BodyFrame(ref: ScaleRef(root: tower.id, records: [tower, water], path: Path()), worldFromAnchor: body.worldFromAnchor, metresPerAnchorUnit: sigma)
            spans.append(sigma * new.bounds.longest)
        }
        #expect(body.ref.root.hex == "56f05f1af0f47e8b00834c5742f6e6e7b4ad7a1f63b31cadb476ed79a5610aac")
        #expect(try r.count(r.root(body.ref.root)).formatted == "3 \u{00D7} 2^100")
        // The body keeps its longest span: it stays a toy however many taps.
        #expect(spans.allSatisfy { abs($0 - 0.15) < 1e-9 })
        // Something neither materializable nor a factor-2 root does not grow.
        let salt = Content.rung(97)
        let sr = Content.resolver([salt])
        #expect(throws: ScaleError.self) { try grow(try Content.toy(Content.ref(salt), span: 0.3, resolver: sr), resolver: sr) }
    }

    // MARK: Picking (§10.5)

    @Test func pickingStopsInTheBand() throws {
        let rung = Content.rung(6)
        let r = Content.resolver([rung])
        let body = try Content.toy(Content.ref(rung), span: 0.3, centre: Vec3(0, 0, -0.5), resolver: r)
        let cut = settledCut([body], deskView, steadyBudgets(), r)
        let ray = RayD(origin: .zero, direction: Vec3(0.01, 0.02, -1).normalized)
        let any = try #require(pick(ray: ray, cut: cut, band: Bands.any, resolver: r))
        #expect(any.body == 0)
        #expect(abs(any.pointWorld.z - -0.35) < 0.01)
        let hand = try #require(pick(ray: ray, cut: cut, band: Bands.hand, resolver: r))
        #expect(Bands.hand.contains(hand.displayedDiameter))
        let chipBand = try #require(pick(ray: ray, cut: cut, band: Bands.chip, resolver: r))
        #expect(Bands.chip.contains(chipBand.displayedDiameter))
        #expect(chipBand.displayedDiameter < hand.displayedDiameter)
        // The chip's node lies under the hand's.
        let handView = try r.walk(r.root(rung.id), hand.steps)
        let chipView = try r.walk(r.root(rung.id), chipBand.steps)
        #expect(chipView.level < handView.level)
        // A ray that misses picks nothing.
        #expect(pick(ray: RayD(origin: .zero, direction: Vec3(1, 0, 0)), cut: cut, band: Bands.any, resolver: r) == nil)
    }
}
