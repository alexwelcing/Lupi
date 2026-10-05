import Foundation
import LupiChem
import LupiScale
import LupiScaleCore
import Testing

/// The guarantees of §9.8, run on Linux.
@Suite("§9.8 cut guarantees")
struct CutGuaranteeTests {
    // MARK: 1. Budgets

    /// No budget is exceeded and no frame pops more than items + visits, for random cameras over
    /// random roots from 10³ to a googolplex, as toys and as terrain.
    @Test func budgetsHoldOverRandomScenes() throws {
        var rng = TestRandom(0x5CA1E)
        let rungs: [BigUInt] = [0, 1, 2, 3, 5, 6, 9, 14, 27, 97, 3000, BigUInt.power(10, 40), Content.googolplexLevels]
        for i in 0..<36 {
            let levels = rungs[rng.int(rungs.count)]
            let rung = Content.rung(levels, substitution: rng.int(2) == 0)
            let r = Content.resolver([rung])
            let thermal = ThermalLevel.allCases[rng.int(ThermalLevel.allCases.count)]
            let budgets = Budgets.iPhone15Pro(thermal)
            let eye = Vec3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1))
            let body: BodyFrame
            if i % 2 == 0 || levels < 9 {
                body = try Content.toy(Content.ref(rung), span: rng.range(0.03, 3), centre: Vec3(rng.range(-0.5, 0.5), rng.range(-0.5, 0.5), rng.range(-1.5, 0.5)), resolver: r)
            } else {
                let k = BigUInt(3 + rng.int(6))
                let digits = (0..<3).map { _ in UInt8(rng.int(10)) }
                let path = Content.anchorPath(rootLevels: levels, to: k, digits: digits)
                let sigma = Content.sigma(level: k, factor: 10, metresPerAngstrom: pow(10, rng.range(-4, -1.5)))
                let probe = Content.terrain(Content.ref(rung), anchorPath: path, sigma: sigma, anchorPoint: .zero, at: .zero)
                let (_, a) = try Content.anchor(probe, r)
                let x = a.bounds.min + Vec3(rng.range(-0.2, 1.2), rng.range(-0.2, 1.2), rng.range(-0.2, 1.2)) * a.bounds.size
                body = Content.terrain(Content.ref(rung), anchorPath: path, sigma: sigma, anchorPoint: x, at: eye + Vec3(rng.range(-0.2, 0.2), 0, 0))
            }
            let target = eye + Vec3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1))
            let view = ViewState.looking(from: eye, at: target, fovY: rng.range(0.6, 1.2), viewportHeight: 1380, viewportWidth: 640)
            var previous: Cut?
            for _ in 0..<3 {
                let cut = buildCut(bodies: [body], view: view, budgets: budgets, previous: previous, resolver: r)
                #expect(cut.failures.isEmpty, "scene \(i): \(cut.failures)")
                CutChecks.withinBudgets(cut, budgets)
                CutChecks.noRegionTwice(cut)
                previous = cut
            }
        }
    }

    /// Several bodies share one set of budgets.
    @Test func budgetsHoldAcrossBodies() throws {
        let rungs = [Content.rung(3), Content.rung(97), Content.rung(Content.googolplexLevels)]
        let r = Content.resolver(rungs)
        var bodies: [BodyFrame] = []
        for (i, rung) in rungs.enumerated() {
            bodies.append(try Content.toy(Content.ref(rung), span: 0.3, centre: Vec3(Double(i) * 0.12 - 0.12, 0, -0.25), resolver: r))
        }
        for thermal in ThermalLevel.allCases {
            let b = Budgets.iPhone15Pro(thermal)
            let cut = buildCut(bodies: bodies, view: deskView, budgets: b, previous: nil, resolver: r)
            CutChecks.withinBudgets(cut, b)
            #expect(cut.bodyCounts.count == 3)
        }
    }

    // MARK: 2. Same footprint, same cost

    /// Toys at the same span before the same camera: the count does not enter the cost.
    @Test func sameFootprintToys() throws {
        for (span, distance) in [(0.3, 0.5), (0.15, 0.3), (0.05, 0.1)] {
            var costs: [(Int, Int)] = []
            for levels in [BigUInt(6), 97, Content.googolplexLevels] {
                let rung = Content.rung(levels)
                let r = Content.resolver([rung])
                let body = try Content.toy(Content.ref(rung), span: span, centre: Vec3(0, 0, -distance - span / 2), resolver: r)
                let cut = settledCut([body], deskView, steadyBudgets(), r)
                costs.append((cut.visited, cut.items.count))
            }
            print("toys span \(span) m at \(distance) m: visited, items \(costs)")
            Self.expectWithinTenPercent(costs)
        }
    }

    /// Terrain surfaces at the same magnification, camera and lattice position: the 10⁹ rung is its
    /// own anchor (a 5.6 m or 28 m cube), the deep rungs are anchored where §8.4 puts them.
    @Test func sameFootprintSurfaces() throws {
        let view = ViewState.looking(from: .zero, at: Vec3(0, 0, 1), fovY: 1.0, viewportHeight: 1380, viewportWidth: 640)
        for (metresPerAngstrom, height, engine) in [(2e-3, 1.0, false), (1e-2, 3.0, false), (2e-3, 1.0, true), (1e-2, 3.0, true)] {
            var budgets = steadyBudgets()
            if engine { budgets.instancedAtoms = budgets.engineAtoms }
            var costs: [(Int, Int)] = []
            for (levels, k) in [(BigUInt(6), BigUInt(6)), (97, 9), (Content.googolplexLevels, 9)] {
                let rung = Content.rung(levels)
                let r = Content.resolver([rung])
                let body = try Self.surface(rung, levels: levels, anchor: k, metresPerAngstrom: metresPerAngstrom, height: height, r)
                let cut = settledCut([body], view, budgets, r)
                CutChecks.withinBudgets(cut, budgets)
                costs.append((cut.visited, cut.items.count))
            }
            print("surfaces \(metresPerAngstrom) m/Å, \(height) m, \(engine ? "engine" : "instanced") atoms: visited, items \(costs)")
            Self.expectWithinTenPercent(costs)
            #expect(costs[1] == costs[2], "the 10¹⁰⁰ and googolplex rungs anchored alike cut alike")
        }
    }

    /// Inside views at the same atom pixel size: the same cut for every rung deep enough.
    @Test func insideViewsAreIdentical() throws {
        var boxes: [[[Double]]] = []
        var costs: [(Int, Int, Int)] = []
        for levels in [BigUInt(27), 97, Content.googolplexLevels] {
            let rung = Content.rung(levels)
            let r = Content.resolver([rung])
            let path = Content.anchorPath(rootLevels: levels, to: 9, digit: 5)
            let body = Content.terrain(Content.ref(rung), anchorPath: path, sigma: 1.111, anchorPoint: Vec3(141, 141, 141), at: .zero)
            let cut = settledCut([body], deskView, steadyBudgets(), r)
            boxes.append(CutChecks.eyeBoxes(cut, deskView))
            costs.append((cut.visited, cut.items.count, cut.drawnAtoms))
        }
        print("inside views: visited, items, atoms \(costs)")
        #expect(costs[0].1 > 100)
        #expect(boxes[0] == boxes[1])
        #expect(boxes[1] == boxes[2])
        #expect(costs[0] == costs[1] && costs[1] == costs[2])
    }

    static func expectWithinTenPercent(_ costs: [(Int, Int)], sourceLocation: SourceLocation = #_sourceLocation) {
        for pick in [{ (c: (Int, Int)) in c.0 }, { (c: (Int, Int)) in c.1 }] {
            let values = costs.map(pick).map(Double.init)
            let lo = values.min()!, hi = values.max()!
            #expect(hi <= 1.1 * lo, "\(values)", sourceLocation: sourceLocation)
        }
    }

    /// A terrain body over the root's lower z face, the camera `height` metres in front of the
    /// centre of the level-6 cube with digits (5, 5, 0), looking along +z.
    static func surface(
        _ rung: NodeRecord, levels: BigUInt, anchor k: BigUInt, metresPerAngstrom: Double, height: Double, _ r: Resolver
    ) throws -> BodyFrame {
        let path = Content.anchorPath(rootLevels: levels, to: k, digits: [5, 5, 0])
        let sigma = Content.sigma(level: k, factor: 10, metresPerAngstrom: metresPerAngstrom)
        let probe = Content.terrain(Content.ref(rung), anchorPath: path, sigma: sigma, anchorPoint: .zero, at: .zero)
        let (anchor, a) = try Content.anchor(probe, r)
        var centre = a.centre, zmin = a.bounds.min.z
        if k > 6 {
            let (p, v) = try r.placement(from: anchor, steps: Content.anchorPath(rootLevels: k, to: 6, digits: [5, 5, 0]))
            let sub = try r.aggregate(v)
            centre = p.apply(sub.centre)
            zmin = p.apply(sub.bounds.min).z
        }
        let x = Vec3(centre.x, centre.y, zmin - height / sigma)
        return Content.terrain(Content.ref(rung), anchorPath: path, sigma: sigma, anchorPoint: x, at: .zero)
    }

    // MARK: 3. Coverage

    /// Inside anchors of the three level shapes, for f = 2, 10 and 16: nothing drawn twice, and
    /// every ray from the eye meets drawn matter just past the excavation bubble.
    @Test(arguments: [(UInt8(2), 40, [27, 28, 29]), (10, 20, [9, 10, 11]), (16, 20, [9, 10, 11])])
    func coverageInsideAnchors(_ f: UInt8, _ rootLevels: Int, _ anchorLevels: [Int]) throws {
        let rung = Content.rung(BigUInt(rootLevels), factor: f)
        let r = Content.resolver([rung])
        for k in anchorLevels {
            let level = BigUInt(k)
            let path = Content.anchorPath(rootLevels: BigUInt(rootLevels), to: level, digit: f / 2)
            let sigma = Content.sigma(level: level, factor: f, metresPerAngstrom: 2e-3)
            let probe = Content.terrain(Content.ref(rung), anchorPath: path, sigma: sigma, anchorPoint: .zero, at: .zero)
            let (_, a) = try Content.anchor(probe, r)
            #expect(sigma * a.narrowestWidth >= FrameTuning.ascendWidth, "the anchor is as wide as §8.4 keeps it")
            let x = a.bounds.min + 0.37 * a.bounds.size
            let body = Content.terrain(Content.ref(rung), anchorPath: path, sigma: sigma, anchorPoint: x, at: .zero)
            let budgets = steadyBudgets()
            let cut = settledCut([body], deskView, budgets, r)
            CutChecks.withinBudgets(cut, budgets)
            CutChecks.noRegionTwice(cut)
            let regions = CutChecks.regions(cut)
            // Each ray meets the bubble's wall: an item within a few cells past the bubble. (Item
            // regions are atom envelopes, a little narrower than their period cells, so a ray may
            // slip between two before it meets a third.)
            var missing = 0
            let rays = CutChecks.rays(deskView, 24)
            for ray in rays {
                guard let t = CutChecks.entry(ray, regions), t <= CutTuning.bubbleRadius + 0.05 else {
                    missing += 1
                    continue
                }
            }
            print("inside f=\(f) level \(k) (shape \(LevelShapeName.of(level))): visited \(cut.visited) items \(cut.items.count) atoms \(cut.drawnAtoms), rays missing \(missing) of \(rays.count)")
            #expect(missing == 0, "f=\(f) k=\(k)")
            #expect(cut.drawnAtoms > 0)
        }
    }

    /// A surface seen from outside: every ray that enters the root within z_far meets a drawn item there.
    @Test func coverageOfSurfaces() throws {
        let view = ViewState.looking(from: .zero, at: Vec3(0.3, 0.2, 1), fovY: 1.0, viewportHeight: 1380, viewportWidth: 640)
        for (levels, k) in [(BigUInt(6), BigUInt(6)), (Content.googolplexLevels, 9)] {
            let rung = Content.rung(levels)
            let r = Content.resolver([rung])
            let body = try Self.surface(rung, levels: levels, anchor: k, metresPerAngstrom: 2e-3, height: 0.5, r)
            let cut = settledCut([body], view, steadyBudgets(), r)
            CutChecks.noRegionTwice(cut)
            let regions = CutChecks.regions(cut)
            let (_, a) = try Content.anchor(body, r)
            let faceZ = body.world(Vec3(0, 0, a.bounds.min.z)).z
            // One seed copy across, in metres: a ray that enters the face meets an item within it.
            let copy = 28.2 * 2e-3
            var entering = 0, missing = 0
            for ray in CutChecks.rays(view, 24) where ray.direction.z > 0 {
                let t = (faceZ - ray.origin.z) / ray.direction.z
                guard t * ray.direction.length < FrameTuning.zFar else { continue }
                let local = body.anchorPoint(ray.at(t + 1e-4 / ray.direction.z))
                if levels == BigUInt(6), !a.bounds.contains(local) { continue }
                entering += 1
                guard let e = CutChecks.entry(ray, regions), e >= t - 1e-4, e <= t + copy else {
                    missing += 1
                    continue
                }
            }
            #expect(entering > 100)
            #expect(missing == 0, "\(missing) of \(entering) rays enter the root where nothing is drawn")
        }
    }

    /// An edited crystal box draws none of what was removed: no atom and no stand-in of the cut lies
    /// inside a removed sub-box, at the corner or inside, and nothing is drawn twice (§9.4, §9.8.3).
    @Test func editedBoxDrawsNothingRemoved() throws {
        let copper = try NodeRecord(.crystal(CrystalNode(structure: .fcc, termination: .open, speciesA: 29, quarterQ16: 59_228, cells: SIMD3(16, 16, 16))))
        let removals = [try Path(canonicalizing: [.cells([7])]), try Path(canonicalizing: [.cells([0, 7])])]
        let edit = try NodeRecord(.edit(EditNode(base: copper.id, removed: removals)))
        let r = Resolver(store: RecordStore([copper, edit]))
        let ref = ScaleRef(root: edit.id, records: [copper, edit], path: Path())
        let cell = 4 * 59_228.0 / 65536
        // Octant 7 is cells [8, 16)³; octant 7 of octant 0 is cells [4, 8)³, a cavity at the centre.
        let removed = [Box3(min: Vec3(8, 8, 8) * cell, max: Vec3(16, 16, 16) * cell), Box3(min: Vec3(4, 4, 4) * cell, max: Vec3(8, 8, 8) * cell)]
        // Near, atoms show; far, ρ of the edited root is under τ, and only the removals split it.
        for distance in [0.35, 0.6, 6.0] {
            let body = try Content.toy(ref, span: 0.3, centre: Vec3(0.02, 0.01, -distance), resolver: r)
            let budgets = steadyBudgets()
            let cut = settledCut([body], deskView, budgets, r)
            CutChecks.withinBudgets(cut, budgets)
            CutChecks.noRegionTwice(cut)
            let hollows = removed.map { body.world($0.centre) }
            var atoms = 0, inside = 0, covering = 0
            for item in cut.items where item.kind != .facePlane {
                let (m, t) = CutChecks.world(item, cut)
                if case let .atoms(runs) = item.extras {
                    for run in runs {
                        for p in run.positions {
                            atoms += 1
                            let x = body.anchorPoint(m * Vec3(Double(p.x), Double(p.y), Double(p.z)) + t)
                            if removed.contains(where: { $0.expanded(by: -0.25 * cell).contains(x) }) { inside += 1 }
                        }
                    }
                } else {
                    // A stand-in that reaches the middle of a removed region draws it.
                    let h = Vec3(Double(item.halfExtents.x), Double(item.halfExtents.y), Double(item.halfExtents.z))
                    let region = CutChecks.Region(inverse: inverse3(m), translation: t, half: h)
                    if hollows.contains(where: { region.contains($0, tolerance: 0) }) { covering += 1 }
                }
            }
            #expect(cut.items.count > 1, "at \(distance) m")
            #expect(inside == 0, "\(inside) of \(atoms) drawn atoms lie in removed cells at \(distance) m")
            #expect(covering == 0, "\(covering) stand-ins cover a removed region at \(distance) m")
        }
    }

    /// A water grown 30 times (a non-solid tower) as the camera approaches: within budgets, nothing
    /// drawn twice, every point of a seed copy's envelope along a ray inside a drawn item, and the
    /// count never falling. It does not grow gradually (§9.2): it jumps as the eye crosses R.
    @Test func grownWaterAsTheCameraApproaches() throws {
        let tower = try NodeRecord(.tower(TowerNode(seed: Content.water.id, factor: 2, periodsQ16: GrowRule.periods(Content.waterLeaf), levels: 30)))
        let r = Resolver(store: RecordStore([tower, Content.water]))
        let ref = ScaleRef(root: tower.id, records: [tower, Content.water], path: Path())
        let seedBox = try r.aggregate(r.root(Content.water.id)).bounds
        let periods = GrowRule.periods(Content.waterLeaf).enumerated().map { Double($0.element[$0.offset]) / 65536 }
        // The root's unit is 2^u(30) Å (§2.8); copies sit at j · p_a Å from its origin.
        let unit = pow(2, Double(TowerMath.unitExponent(30).int!))
        var counts: [Int] = []
        for distance in [0.5, 0.25, 0.125, 0.0625, 0.03125] {
            let body = try Content.toy(ref, span: 0.15, centre: Vec3(0.02, 0.01, -(distance + 0.075)), resolver: r)
            let budgets = steadyBudgets()
            let cut = settledCut([body], deskView, budgets, r)
            CutChecks.withinBudgets(cut, budgets)
            CutChecks.noRegionTwice(cut)
            counts.append(cut.items.count)
            let regions = CutChecks.regions(cut)
            var tested = 0, missing = 0
            for ray in CutChecks.rays(deskView, 12) {
                for step in 0..<64 {
                    let p = ray.at(distance + 0.15 * Double(step) / 64)
                    // Nearer than z_near is clipped, not missing.
                    guard -deskView.cameraFromWorld.apply(p).z > deskView.zNear else { continue }
                    let x = body.anchorPoint(p) * unit
                    // Inside some copy's envelope? Copies sit at j · p_a, j < 1,024, on the diagonal.
                    var inside = true
                    for a in 0..<3 {
                        let j = ((x[a] - seedBox.min[a]) / periods[a]).rounded(.down)
                        if j < 0 || j >= 1024 || x[a] - j * periods[a] > seedBox.max[a] { inside = false }
                    }
                    guard inside else { continue }
                    tested += 1
                    if !regions.contains(where: { $0.contains(p, tolerance: 1e-7) }) { missing += 1 }
                }
            }
            #expect(missing == 0, "\(missing) of \(tested) points in copies at \(distance) m")
        }
        #expect(counts == counts.sorted(), "\(counts)")
        print("grown water approaching, items per halving of the distance: \(counts)")
    }

    // MARK: 4. Monotone error

    /// ε(parent) ≥ ε(child) in the parent's units, along random descents through every kind of view.
    @Test func errorsAreMonotone() throws {
        let water = Content.water
        let caffeine = try NodeRecord(.leaf(Gallery.leaf(Gallery.caffeine)))
        let copper = try NodeRecord(.crystal(CrystalNode(structure: .fcc, termination: .open, speciesA: 29, speciesB: 0, quarterQ16: 59_228, cells: SIMD3(63, 63, 63))))
        let closed = try NodeRecord(.crystal(CrystalNode(structure: .fcc, termination: .closed, speciesA: 29, speciesB: 0, quarterQ16: 59_228, cells: SIMD3(9, 7, 5))))
        let grown = try NodeRecord(.tower(TowerNode(seed: water.id, factor: 2, periodsQ16: GrowRule.periods(Content.waterLeaf), levels: 12)))
        let group = try NodeRecord(.group([
            GroupChild(id: water.id, rotation: SIMD4(0, 0, 0, 1), translation: SIMD3(0, 0, 0)),
            GroupChild(id: caffeine.id, rotation: SIMD4(0, 0.6, 0, 0.8), translation: SIMD3(12, 0, 0)),
            GroupChild(id: copper.id, rotation: SIMD4(0, 0, 0, 1), translation: SIMD3(0, 30, 0)),
        ]))
        let rungs = [Content.rung(0), Content.rung(4), Content.rung(97), Content.rung(Content.googolplexLevels), Content.rung(20, factor: 2), Content.rung(11, factor: 16)]
        let r = Content.resolver([water, caffeine, copper, closed, grown, group] + rungs)
        var rng = TestRandom(42)
        var checked = 0
        for root in [group, grown, copper, closed] + rungs {
            for _ in 0..<12 {
                var view = try r.root(root.id)
                for _ in 0..<40 {
                    let steps = Self.childSteps(view, r)
                    guard !steps.isEmpty else { break }
                    let s = steps[rng.int(steps.count)]
                    let child = try r.step(view, s)
                    let p = try r.placement(from: view, step: s)
                    let parentError = try r.aggregate(view).geometricError
                    let childError = try r.aggregate(child).geometricError * p.scale
                    #expect(childError <= parentError * (1 + 1e-9), "\(view.kind) → \(child.kind)")
                    checked += 1
                    view = child
                }
            }
        }
        #expect(checked > 500)
    }

    /// The children of a view, by the steps §9.2 refines through.
    static func childSteps(_ v: View, _ r: Resolver) -> [Step] {
        switch v.kind {
        case .group:
            return (0..<(v.groupChildren?.count ?? 0)).map { .child(UInt16($0)) }
        case .box:
            return (0..<8).map { Step.cells([UInt8($0)]) }.filter { (try? r.step(v, $0)) != nil }
        case .level:
            let a = TowerMath.axis(v.level)
            return (0..<Int(v.tower!.factor)).map { j in
                var runs: [[DigitRun]] = [[], [], []]
                runs[a] = [DigitRun(digit: UInt8(j), length: 1)]
                return .tower(levels: 1, runs: runs)
            }
        default:
            return []
        }
    }

    // MARK: 5. Hysteresis

    /// With ρ unchanged, no item flips twice in consecutive frames: a still camera keeps its cut,
    /// and ρ moving 3 % against τ back and forth (τ alternating, so the frustum stays) settles
    /// after one frame.
    @Test func hysteresisHolds() throws {
        let rung = Content.rung(97)
        let r = Content.resolver([rung])
        let view = ViewState.looking(from: .zero, at: Vec3(0, 0, 1), fovY: 1.0, viewportHeight: 1380, viewportWidth: 640)
        // Atoms reach τ pixels 1.52 m away here, so at 1.45 m a patch of the face is refined.
        let body = try Self.surface(rung, levels: 97, anchor: 9, metresPerAngstrom: 2e-3, height: 1.45, r)
        var budgets = steadyBudgets()
        budgets.instancedAtoms = budgets.engineAtoms
        var cut = settledCut([body], view, budgets, r)
        let settled = Set(cut.items.map(\.key32))
        let still = buildCut(bodies: [body], view: view, budgets: budgets, previous: cut, resolver: r)
        #expect(Set(still.items.map(\.key32)) == settled)
        var flips = 0
        var keys = settled
        for i in 0..<8 {
            var b = budgets
            b.tau = i % 2 == 0 ? 1.5 * 1.03 : 1.5
            cut = buildCut(bodies: [body], view: view, budgets: b, previous: cut, resolver: r)
            #expect(!cut.overBudget)
            let k = Set(cut.items.map(\.key32))
            if k != keys { flips += 1 }
            keys = k
        }
        #expect(flips == 0)
        #expect(cut.drawnAtoms > 0)
        #expect(settled.count > 10)
        // Without the band, the same alternation flips every frame.
        var bare = budgets
        bare.tau = 1.5 * 1.03
        let coarse = settledCut([body], view, bare, r)
        let fine = settledCut([body], view, budgets, r)
        #expect(Set(coarse.items.map(\.key32)) != Set(fine.items.map(\.key32)))
    }

    // MARK: 6. Flight

    /// A dive through the googolplex: a wrap changes no item of the cut (as eye-space boxes), and a
    /// frame's zoom by V scales every item that stays about the eye by exactly that zoom.
    @Test func wrapsAndZoomInADive() throws {
        let levels = Content.googolplexLevels
        let rung = Content.rung(levels)
        let r = Content.resolver([rung])
        // Thirty levels below the root, so there is room to wrap 10^98 periods down.
        let k = try levels - 30
        let path = Content.anchorPath(rootLevels: levels, to: k, digits: [0, 0, 0])
        let probe = Content.terrain(Content.ref(rung), anchorPath: path, sigma: 1, anchorPoint: .zero, at: .zero)
        let (_, a) = try Content.anchor(probe, r)
        let sigma = 100 / a.narrowestWidth
        let view = ViewState.looking(from: .zero, at: Vec3(0.2, 0.1, 1), fovY: 1.0, viewportHeight: 1380, viewportWidth: 640)
        var frame = Content.terrain(Content.ref(rung), anchorPath: path, sigma: sigma, anchorPoint: Vec3(a.centre.x, a.centre.y, a.bounds.min.z - 3 / sigma), at: .zero)
        let budgets = steadyBudgets()
        var cut = settledCut([frame], view, budgets, r)
        var wraps = 0
        for (i, periods) in [BigUInt(1), 7, BigUInt.power(10, 98), 1, BigUInt.power(10, 60)].enumerated() {
            #expect(Wraps.allowed(frame, lastCut: cut, resolver: r))
            let before = CutChecks.eyeBoxes(cut, view)
            try Wraps.wrap(&frame, periods: periods, descending: i != 3, resolver: r)
            let wrapped = settledCut([frame], view, budgets, r)
            let after = CutChecks.eyeBoxes(wrapped, view)
            #expect(before.count == after.count)
            #expect(zip(before, after).allSatisfy { b, c in zip(b, c).allSatisfy { abs($0 - $1) <= 1e-5 * (1 + abs($0)) } })
            wraps += 1
            // One frame of zoom by V about the eye.
            let ratio = pow(10, Flight.pictureStep(.standard))
            pinch(&frame, ratio: ratio, about: view.cameraPosition)
            let zoomed = buildCut(bodies: [frame], view: view, budgets: budgets, previous: wrapped, resolver: r)
            var old: [UInt32: [Double]] = [:]
            for item in wrapped.items where item.kind == .box { old[item.key32] = CutChecks.eyeBoxes(Self.only(item, wrapped), view)[0] }
            var matched = 0
            for item in zoomed.items where item.kind == .box {
                guard let b = old[item.key32] else { continue }
                let c = CutChecks.eyeBoxes(Self.only(item, zoomed), view)[0]
                #expect(zip(b, c).allSatisfy { abs(ratio * $0 - $1) <= 1e-5 * (1 + abs($1)) })
                matched += 1
            }
            #expect(matched >= wrapped.items.count / 2)
            cut = zoomed
        }
        #expect(wraps == 5)
    }

    static func only(_ item: DrawItem, _ cut: Cut) -> Cut {
        var c = cut
        c.items = [item]
        return c
    }

    // MARK: 7. Cost

    /// `buildCut` at 8,192 visits (the fair visit budget), timed; release builds fail above 4 ms.
    @Test func buildCutCost() throws {
        let tower = try NodeRecord(.tower(TowerNode(seed: Content.water.id, factor: 2, periodsQ16: GrowRule.periods(Content.waterLeaf), levels: 30)))
        let r = Resolver(store: RecordStore([tower, Content.water]))
        let ref = ScaleRef(root: tower.id, records: [tower, Content.water], path: Path())
        let body = try Content.toy(ref, span: 0.15, centre: Vec3(0.02, 0.01, -0.14), resolver: r)
        let budgets = Budgets.iPhone15Pro(.fair)
        let warm = settledCut([body], deskView, steadyBudgets(), r)
        #expect(warm.visited == budgets.visits)
        var full = Self.time(bodies: [body], view: deskView, budgets: budgets, previous: warm, r)
        // A busy neighbour on a shared machine can slow a whole window of frames; a regression
        // slows every window, so up to two more windows are measured before the gate below.
        for _ in 0..<2 where full.best >= 0.004 {
            let again = Self.time(bodies: [body], view: deskView, budgets: budgets, previous: warm, r)
            if again.best < full.best { full = again }
        }

        let rung = Content.rung(Content.googolplexLevels)
        let rr = Content.resolver([rung])
        let inside = Content.terrain(
            Content.ref(rung), anchorPath: Content.anchorPath(rootLevels: Content.googolplexLevels, to: 9, digit: 5),
            sigma: 1.111, anchorPoint: Vec3(141, 141, 141), at: .zero
        )
        let insideWarm = settledCut([inside], deskView, steadyBudgets(), rr)
        let insideTime = Self.time(bodies: [inside], view: deskView, budgets: budgets, previous: insideWarm, rr)
        #if DEBUG
        let mode = "debug"
        #else
        let mode = "release"
        #endif
        print("buildCut (\(mode)): \(warm.visited) visits, \(warm.items.count) items: median \(String(format: "%.3f", full.median * 1000)) ms, best \(String(format: "%.3f", full.best * 1000)) ms; googolplex inside view, \(insideWarm.visited) visits: median \(String(format: "%.3f", insideTime.median * 1000)) ms")
        #if !DEBUG
        // The best of 15 frames: Swift Testing runs the other suites alongside this one.
        #expect(full.best < 0.004, "buildCut at 8,192 visits must run under 4 ms")
        #endif
    }

    static func time(bodies: [BodyFrame], view: ViewState, budgets: Budgets, previous: Cut, _ r: Resolver) -> (median: Double, best: Double) {
        var times: [Double] = []
        var prev = previous
        for _ in 0..<15 {
            let t0 = DispatchTime.now().uptimeNanoseconds
            prev = buildCut(bodies: bodies, view: view, budgets: budgets, previous: prev, resolver: r)
            times.append(Double(DispatchTime.now().uptimeNanoseconds - t0) / 1e9)
        }
        times.sort()
        return (times[times.count / 2], times[0])
    }
}

/// The three level shapes by their level (§3.4.1): (f,1,1), (f,f,1) or (f,f,f).
enum LevelShapeName {
    static func of(_ k: BigUInt) -> String {
        let c = (0..<3).map { TowerMath.stacked($0, k) }
        let lo = c.min()!, hi = c.max()!
        if lo == hi { return "(f,f,f)" }
        return c.filter { $0 == hi }.count == 1 ? "(f,1,1)" : "(f,f,1)"
    }
}
