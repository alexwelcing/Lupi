import LupiScaleCore
import Testing

@Suite("§12.4 composition and mass")
struct CompositionTests {
    @Test func googolplex() throws {
        let gp = try Spec.rung(Spec.googolplexLevels)
        let r = Spec.store([Spec.seedRecord(), gp])
        let c = try r.composition(r.root(gp.id))
        #expect(c.formula == "BrCl499Na500")
        #expect(c.formulaText == "BrCl499Na500 \u{00D7} 10^(10^100 \u{2212} 3)")
        #expect(try c.massMicroDa().formatted == "2.9264454 \u{00D7} 10^(10^100 + 7)")
    }

    @Test func googolplexWithoutChild9AndTheGrain() throws {
        let gp = try Spec.rung(Spec.googolplexLevels)
        let child9 = try Path(canonicalizing: [Spec.towerStep(1, [[(9, 1)], [], []]),])
        let edit = try NodeRecord(.edit(EditNode(base: gp.id, removed: [child9, try TowerVectorTests.grainPath])))
        let r = Spec.store([Spec.seedRecord(), gp, edit])
        let c = try r.composition(r.root(edit.id))
        #expect(c.formulaText == "BrCl499Na500 \u{00D7} (9 \u{00D7} 10^(10^100 \u{2212} 4) \u{2212} 1)")
    }

    @Test func caffeine() throws {
        let rec = try NodeRecord(.leaf(Repo.galleryLeaf("apps/web/public/gallery/curated/popular/caffeine.xyz")))
        let r = Spec.store([rec])
        let c = try r.composition(r.root(rec.id))
        #expect(c.formula == "C8H10N4O2")
        #expect(c.formulaText == "C8H10N4O2")
        #expect(try c.massMicroDa().formatted == "194,194,000")
    }

    /// The three masses whose binary64 product with 10⁶ is not an integer.
    @Test func microDaltons() {
        #expect(ScaleElements.microDaltons(16) == 32_060_000)
        #expect(ScaleElements.microDaltons(30) == 65_380_000)
        #expect(ScaleElements.microDaltons(54) == 131_290_000)
        #expect(ScaleElements.microDaltons(0) == nil)
        #expect(ScaleElements.microDaltons(119) == nil)
    }

    @Test func hillFormula() {
        #expect(Composition.hill([6: 8, 1: 10, 7: 4, 8: 2]) == "C8H10N4O2")
        // Without carbon, everything alphabetical, hydrogen included.
        #expect(Composition.hill([8: 1, 1: 2]) == "H2O")
        #expect(Composition.hill([17: 1, 11: 1]) == "ClNa")
        #expect(Composition.hill([6: 1, 1: 4, 17: 0]) == "CH4")
    }

    /// Every salt rung has one seed copy's formula; counts multiply out exactly.
    @Test func everyRungShareItsFormula() throws {
        for levels in [BigUInt(0), 3, 6, 27, 97] {
            let rung = try Spec.rung(levels)
            let r = Spec.store([Spec.seedRecord(), rung])
            let c = try r.composition(r.root(rung.id))
            #expect(c.formula == "BrCl499Na500")
        }
    }

    /// A crystal box's per-species counts are closed-form, and an edit of a box subtracts its sub-box.
    @Test func boxCompositionMinusARemovedOctant() throws {
        let seed = Spec.seedRecord()
        let edit = try NodeRecord(.edit(EditNode(base: seed.id, removed: [try Path(canonicalizing: [.cells([0])])])))
        let r = Spec.store([seed, edit])
        let v = try r.root(edit.id)
        #expect(try r.composition(v).formula == "Cl392Na392")
        #expect(try r.count(v) == Magnitude(784))
        #expect(try r.materialize(v).count == 784)
    }
}
