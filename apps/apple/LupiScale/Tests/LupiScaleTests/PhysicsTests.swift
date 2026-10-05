import Foundation
import LupiChem
import LupiScale
import LupiScaleCore
import Testing

/// Size states, felt mass, heft, inertia and collision proxies (§10.1–§10.4, §10.8).
@Suite("§10 physics")
struct PhysicsTests {
    static func leafMass(_ path: String) throws -> MassLog {
        let rec = try NodeRecord(.leaf(Gallery.leaf(path)))
        let r = Resolver(store: RecordStore([rec]))
        return massLog(massMicroDa: try r.composition(r.root(rec.id)).massMicroDa())
    }

    static func rungMass(_ levels: BigUInt) throws -> MassLog {
        let rung = Content.rung(levels)
        let r = Content.resolver([rung])
        return massLog(massMicroDa: try r.composition(r.root(rung.id)).massMicroDa())
    }

    static func rounded(_ v: Double, _ places: Int) -> Double {
        let s = pow(10, Double(places))
        return (v * s).rounded() / s
    }

    // MARK: The mass table

    /// `lupi.mass.v1` is LupiChem's element masses read as decimals and scaled by 10⁶ exactly (§5.3).
    @Test func microDaltonTableMatchesLupiChem() {
        var checked = 0
        for element in ChemicalElement.all where element.mass > 0 && element.z <= 118 {
            let z = UInt8(element.z)
            #expect(ScaleElements.microDaltons(z) == UInt64((element.mass * 1e6).rounded()), "Z = \(z)")
            #expect(ScaleElements.symbol(z) == element.symbol, "Z = \(z)")
            checked += 1
        }
        #expect(checked >= 100)
    }

    // MARK: Felt mass (§10.2)

    /// The table of §10.2, from exact masses: gallery molecules (file order, Float32) and the salt ladder.
    @Test func feltMassTable() throws {
        let water = try Self.leafMass(Gallery.water)
        let caffeine = try Self.leafMass(Gallery.caffeine)
        let c60 = try Self.leafMass(Gallery.c60)
        #expect(Self.rounded(FeltMass.kg(water, massScale: 1), 3) == 0.080)
        #expect(Self.rounded(FeltMass.kg(caffeine, massScale: 1), 3) == 0.206)
        #expect(Self.rounded(FeltMass.kg(c60, massScale: 1), 3) == 0.348)
        #expect(Self.rounded(FeltMass.kg(c60, massScale: 0.8), 3) == 0.279)
        // Hydrogen peroxide, brittle: its mass from the same table.
        let peroxide = try NodeRecord(.leaf(LeafNode(atomicNumbers: [8, 8, 1, 1], positions: [SIMD3(0, 0, 0), SIMD3(1.45, 0, 0), SIMD3(-0.3, 0.9, 0), SIMD3(1.75, 0, 0.9)])))
        let pr = Resolver(store: RecordStore([peroxide]))
        let pm = massLog(massMicroDa: try pr.composition(pr.root(peroxide.id)).massMicroDa())
        #expect(Self.rounded(FeltMass.kg(pm, massScale: 0.85), 3) == 0.087)
        // Hemoglobin: the spec names no mass; 64,458 Da is the human HbA tetramer.
        let hemoglobin = MassLog(daltons: 64_458)
        #expect(Self.rounded(FeltMass.kg(hemoglobin, massScale: 1), 3) == 0.544)
        #expect(Self.rounded(FeltMass.kg(hemoglobin, massScale: 0.85), 3) == 0.541)

        let rows: [(BigUInt, Double, Double, Int)] = [
            (0, 0.537, 0.533, 3), (3, 0.567, 0.566, 3), (6, 0.575, 0.574, 3), (27, 0.586, 0.586, 3), (97, 0.590, 0.590, 3),
            (Content.googolplexLevels, 0.5998, 0.5998, 4),
        ]
        for (levels, plain, brittle, places) in rows {
            let m = try Self.rungMass(levels)
            #expect(Self.rounded(FeltMass.kg(m, massScale: 1), places) == plain, "levels \(levels.description.prefix(12))")
            #expect(Self.rounded(FeltMass.kg(m, massScale: 0.85), places) == brittle, "levels \(levels.description.prefix(12))")
        }
        // Salt 10³ is 29,264 Da (one bromide in the copy).
        #expect(Self.rounded(exp(try Self.rungMass(0).lnM), 0) == 29_264)
    }

    /// Strictly increasing from the 0.06 kg floor (about 9 Da) to a googolplex and past it, never 0.6.
    @Test func feltMassKeepsTheOrderOfMasses() throws {
        var previous = 0.0
        var masses: [MassLog] = [8, 9.5, 18, 180, 1018, 1019, 1e4, 1e6, 1e12, 1e100, 1e300].map { MassLog(daltons: $0) }
        masses.append(try Self.rungMass(BigUInt.power(10, 60)))
        masses.append(try Self.rungMass(Content.googolplexLevels))
        masses.append(MassLog(lnM: .infinity, lnlnM: 1e4))
        for (i, m) in masses.enumerated() {
            let kg = FeltMass.kg(m, massScale: 1)
            #expect(kg < 0.6)
            if i == 0 { #expect(kg == 0.06) } else if i > 1 { #expect(kg > previous, "\(i)") }
            previous = kg
        }
        // C¹ at the knee: no jump in value or slope.
        let lnKnee = log(180.0) + 2.5 * log(2.0)
        let below = FeltMass.kg(MassLog(lnM: lnKnee - 1e-6, lnlnM: log(lnKnee - 1e-6)), massScale: 1)
        let above = FeltMass.kg(MassLog(lnM: lnKnee + 1e-6, lnlnM: log(lnKnee + 1e-6)), massScale: 1)
        #expect(abs(above - below) < 1e-6)
        // A brittle googolplex outweighs every molecule of every personality.
        let gp = FeltMass.kg(try Self.rungMass(Content.googolplexLevels), massScale: 0.85)
        #expect(gp > FeltMass.kg(MassLog(daltons: 1e7), massScale: 1.0))
    }

    // MARK: Heft (§10.8)

    @Test func heftValues() throws {
        func h(_ m: MassLog) -> Double { Self.rounded(Heft(m).h, 2) }
        #expect(h(try Self.leafMass(Gallery.water)) == 0.35)
        #expect(h(try Self.leafMass(Gallery.c60)) == 0.59)
        #expect(h(try Self.rungMass(3)) == 0.93)
        #expect(h(try Self.rungMass(6)) == 1.06)
        #expect(h(try Self.rungMass(97)) == 2.01)
        let gp = Heft(try Self.rungMass(Content.googolplexLevels))
        #expect(Self.rounded(gp.h, 2) == 100)
        #expect(gp.subBassGain == 1)
        #expect(abs(gp.hapticTail - 0.2) < 1e-12)
        let water = Heft(try Self.leafMass(Gallery.water))
        #expect(water.subBassGain == 0)
        #expect(water.pitchFactor > 1)
        // A googol is still audibly different from a billion.
        #expect(Heft(try Self.rungMass(97)).subBassGain > Heft(try Self.rungMass(6)).subBassGain)
    }

    // MARK: Size states and spawning (§10.1)

    @Test func spawnSizesAndStates() throws {
        let r = Content.resolver([Content.rung(Content.googolplexLevels), Content.rung(6)])
        let bar = try r.root(Content.rung(Content.googolplexLevels).id)
        let barAgg = try r.aggregate(bar)
        let sigma = try Spawn.metresPerUnit(bar, resolver: r)
        #expect(abs(sigma * barAgg.bounds.longest - 0.30) < 1e-9)
        #expect(abs(sigma * barAgg.bounds.shortest - 0.03) < 0.001)
        let cube = try r.root(Content.rung(6).id)
        #expect(abs(try Spawn.span(cube, resolver: r) - 0.15) < 1e-9)
        let water = Content.water
        let wr = Resolver(store: RecordStore([water]))
        let wv = try wr.root(water.id)
        let ws = try Spawn.metresPerUnit(wv, resolver: wr)
        #expect(ws >= 0.005 && ws <= 0.04)

        #expect(SizeState.of(longestSpan: 0.449, spawnSpan: 0.15) == .toy)
        #expect(SizeState.of(longestSpan: 0.46, spawnSpan: 0.15) == .monument)
        #expect(SizeState.of(longestSpan: 3, spawnSpan: 0.15) == .monument)
        #expect(SizeState.of(longestSpan: 3.01, spawnSpan: 0.15) == .terrain)
    }

    // MARK: Inertia (§10.3)

    /// The googolplex bar turns like a bar: its long axis has the smallest moment, floored at 0.02
    /// of the largest (a 10 : 1 : 1 bar has 2/101 ≈ 0.0198).
    @Test func inertiaOfTheGoogolplexBar() throws {
        let rung = Content.rung(Content.googolplexLevels)
        let r = Content.resolver([rung])
        let bar = try r.root(rung.id)
        let sigma = try Spawn.metresPerUnit(bar, resolver: r)
        let i = try inertia(for: bar, feltMassKg: 0.5998, metresPerUnit: sigma, resolver: r)
        let moments = [i.moments.x, i.moments.y, i.moments.z]
        let smallest = moments.firstIndex(of: moments.min()!)!
        let axis = [i.axes.c0, i.axes.c1, i.axes.c2][smallest]
        #expect(abs(abs(axis.x) - 1) < 1e-9)
        #expect(abs(moments.min()! / moments.max()! - 0.02) < 1e-12)
        // I = M (tr Cov E − Cov) for a uniform 30 × 3 × 3 cm bar: (L² + w²) / 12 about a short axis.
        let expected = 0.5998 * (0.30 * 0.30 + 0.03 * 0.03) / 12
        #expect(abs(moments.max()! / expected - 1) < 0.02)
    }

    @Test func inertiaOfAMolecule() throws {
        let water = Content.water
        let r = Resolver(store: RecordStore([water]))
        let i = try inertia(for: try r.root(water.id), feltMassKg: 0.08, metresPerUnit: 0.02, resolver: r)
        let m = [i.moments.x, i.moments.y, i.moments.z].sorted()
        #expect(m[0] > 0 && m[0] < m[1] && m[1] < m[2])
        // Planar: the largest moment is the sum of the other two.
        #expect(abs(m[2] - (m[0] + m[1])) < 1e-6 * m[2])
    }

    // MARK: Collision proxies (§10.4)

    @Test func proxiesByKind() throws {
        let caffeine = try NodeRecord(.leaf(Gallery.leaf(Gallery.caffeine)))
        let c60 = try NodeRecord(.leaf(Gallery.leaf(Gallery.c60)))
        let rung = Content.rung(3)
        let oblique = try NodeRecord(.tower(TowerNode(
            seed: Content.water.id, factor: 2,
            periodsQ16: [SIMD3(300_000, 0, 0), SIMD3(100_000, 300_000, 0), SIMD3(0, 50_000, 300_000)], levels: 6
        )))
        let group = try NodeRecord(.group((0..<100).map { i in
            GroupChild(id: Content.water.id, translation: SIMD3(Double(i % 10) * 4, Double(i / 10) * 4, 0))
        }))
        let r = Content.resolver([Content.water, caffeine, c60, rung, oblique, group])

        let water = try collisionProxy(for: r.root(Content.water.id), metresPerUnit: 0.02, maxShapes: 48, resolver: r)
        #expect(water.count == 1)
        if case let .sphere(_, radius) = water[0] {
            // Oxygen's toy radius, grown 15 % for each of its two hydrogens (compounded).
            #expect(abs(radius - 0.02 * 0.495 * 1.15 * 1.15) < 1e-9)
        } else {
            Issue.record("water is one sphere")
        }
        let caf = try collisionProxy(for: r.root(caffeine.id), metresPerUnit: 0.02, maxShapes: 48, resolver: r)
        #expect(caf.count == 14)
        let buckyball = try collisionProxy(for: r.root(c60.id), metresPerUnit: 0.02, maxShapes: 48, resolver: r)
        #expect(buckyball.count <= 48 && buckyball.count >= 24)

        let cube = try collisionProxy(for: r.root(rung.id), metresPerUnit: 1e-4, maxShapes: 256, resolver: r)
        #expect(cube.count == 1)
        guard case let .box(_, half, _) = cube[0] else { Issue.record("a level with orthogonal periods is a box"); return }
        let agg = try r.aggregate(r.root(rung.id))
        #expect(abs(half.x - agg.bounds.halfExtents.x * 1e-4) < 1e-12)

        let hull = try collisionProxy(for: r.root(oblique.id), metresPerUnit: 1e-3, maxShapes: 256, resolver: r)
        guard case let .convex(points) = hull.first, hull.count == 1 else { Issue.record("an oblique level is a hull"); return }
        #expect(points.count >= 8)

        let spheres = try collisionProxy(for: r.root(group.id), metresPerUnit: 0.01, maxShapes: 64, resolver: r)
        #expect(spheres.count <= 64 && spheres.count > 1)

        // Fresh pieces start inset by r_atom σ + 1 mm (§10.4).
        let inset = cube[0].inset(by: 0.001)
        if case let .box(_, h2, _) = inset { #expect(abs(h2.x - (half.x - 0.001)) < 1e-12) }
        #expect(water[0].inset(by: 0.001).boundingRadius < water[0].boundingRadius)
    }
}
