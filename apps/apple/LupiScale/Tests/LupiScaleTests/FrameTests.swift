import Foundation
import LupiChem
import LupiScale
import LupiScaleCore
import Testing

/// Frames, rebasing, pinch, magnification and flight (§8).
@Suite("§8 frames and the camera")
struct FrameTests {
    // MARK: Placements (§8.2)

    /// A tower step of any length composes in closed form; it agrees with the level-by-level product.
    @Test func closedFormPlacementMatchesLevelByLevel() throws {
        var rng = TestRandom(7)
        for (factor, levels) in [(UInt8(10), BigUInt(30)), (2, 45), (16, 24)] {
            let rung = Content.rung(levels, factor: factor)
            let r = Content.resolver([rung])
            let root = try r.root(rung.id)
            for _ in 0..<8 {
                let d = 1 + rng.int(20)
                var singles: [Step] = []
                var runs: [[DigitRun]] = [[], [], []]
                for i in 0..<d {
                    let a = TowerMath.axis(try levels - BigUInt(i))
                    let digit = UInt8(rng.int(Int(factor)))
                    var one: [[DigitRun]] = [[], [], []]
                    one[a] = [DigitRun(digit: digit, length: 1)]
                    singles.append(.tower(levels: 1, runs: one))
                    if let last = runs[a].last, last.digit == digit {
                        runs[a][runs[a].count - 1].length = last.length + 1
                    } else {
                        runs[a].append(DigitRun(digit: digit, length: 1))
                    }
                }
                let closed = try r.placement(from: root, step: .tower(levels: BigUInt(d), runs: runs))
                let (product, view) = try r.placement(from: root, steps: singles)
                #expect(abs(closed.scale / product.scale - 1) < 1e-12)
                #expect((closed.translation - product.translation).length <= 1e-12 * max(1, product.translation.length))
                let direct = try r.step(root, .tower(levels: BigUInt(d), runs: runs))
                #expect(direct.level == view.level)
            }
        }
    }

    /// A descent of 10¹⁰⁰ levels costs O(runs) and stays finite.
    @Test func googolplexDescentIsClosedForm() throws {
        let levels = Content.googolplexLevels
        let rung = Content.rung(levels)
        let r = Content.resolver([rung])
        let root = try r.root(rung.id)
        let path = Content.anchorPath(rootLevels: levels, to: 9, digits: [5, 2, 7])
        let start = DispatchTime.now().uptimeNanoseconds
        let (p, anchor) = try r.placement(from: root, steps: path)
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1e9
        #expect(anchor.level == BigUInt(9))
        #expect(p.translation.x.isFinite && p.translation.y.isFinite && p.translation.z.isFinite)
        #expect(p.scale >= 0 && p.scale < 1e-300)
        #expect(elapsed < 1)
    }

    // MARK: Rebasing (§8.4, §8.6)

    /// Rebasing changes the representation, not the state: every corner of the deeper anchor is
    /// where the other frame puts it, within §8.6's bound, descending and ascending.
    @Test func rebaseKeepsEveryPointInPlace() throws {
        let levels = Content.googolplexLevels
        let rung = Content.rung(levels)
        let r = Content.resolver([rung])
        // An anchor 60 levels below the root of the googolplex, shown a billion metres long, so
        // its radius is over R_cap; the focus sits just inside its lower x face.
        let path = Content.anchorPath(rootLevels: levels, to: try levels - 60, digits: [0, 4, 6])
        let a = try r.aggregate(try r.walk(try r.root(rung.id), path))
        var frame = Content.terrain(
            Content.ref(rung), anchorPath: path, sigma: 1e9 / a.bounds.longest,
            anchorPoint: Vec3(a.bounds.min.x, a.centre.y, a.centre.z), at: Vec3(0, 0, -1)
        )
        let focus = Vec3(0.5, 0, -1)
        var descents = 0
        for _ in 0..<40 {
            let before = frame
            try rebase(&frame, focusWorld: focus, resolver: r)
            guard frame.anchorPath != before.anchorPath else { break }
            descents += frame.anchorPath.count - before.anchorPath.count
            try Self.expectSamePoints(before, frame, r)
        }
        let (_, rest) = try Content.anchor(frame, r)
        print("rebase: \(descents) descents to an anchor \(String(format: "%.1f", frame.metresPerAnchorUnit * rest.narrowestWidth)) m wide")
        #expect(descents >= 9)
        #expect(frame.metresPerAnchorUnit * rest.narrowestWidth >= FrameTuning.ascendWidth)

        // Shrink the body a thousandfold about the focus: rebasing now ascends.
        pinch(&frame, ratio: 1e-3, about: focus)
        var ascents = 0
        for _ in 0..<40 {
            let before = frame
            try rebase(&frame, focusWorld: focus, resolver: r)
            guard frame.anchorPath != before.anchorPath else { break }
            ascents += 1
            try Self.expectSamePoints(before, frame, r)
        }
        #expect(ascents >= 3)
        let (_, top) = try Content.anchor(frame, r)
        #expect(frame.metresPerAnchorUnit * top.narrowestWidth >= FrameTuning.ascendWidth)
    }

    /// Both frames draw the deeper of their two anchors at the same world points.
    static func expectSamePoints(_ a: BodyFrame, _ b: BodyFrame, _ r: Resolver, sourceLocation: SourceLocation = #_sourceLocation) throws {
        let body = try r.resolve(a.ref.root, a.ref.path)
        let viewA = try r.walk(body, a.anchorPath), viewB = try r.walk(body, b.anchorPath)
        // A level deeper has the lower level number; one rebase step moves one or two levels.
        let aIsDeeper = viewA.level < viewB.level
        let (deep, shallow) = aIsDeeper ? (a, b) : (b, a)
        let (deepView, shallowView) = aIsDeeper ? (viewA, viewB) : (viewB, viewA)
        let steps = try Self.levelsBetween(shallowView, deepView, deep.anchorPath)
        let (p, reached) = try r.placement(from: shallowView, steps: steps)
        #expect(reached.level == deepView.level, sourceLocation: sourceLocation)
        let box = try r.aggregate(deepView).bounds
        for corner in 0..<8 {
            let y = Vec3(
                corner & 1 == 0 ? box.min.x : box.max.x, corner & 2 == 0 ? box.min.y : box.max.y, corner & 4 == 0 ? box.min.z : box.max.z
            )
            let w1 = deep.world(y), w0 = shallow.world(p.apply(y))
            // §8.6 bounds what Float32 draws by 2⁻²³ (d + r) + 2⁻⁵⁰ × 10⁸ m; the binary64 frames sit inside it.
            #expect((w1 - w0).length <= 2.4e-7 * w1.length + 9e-8, sourceLocation: sourceLocation)
        }
    }

    /// The single-level steps from a level down to a deeper one, read off the deeper anchor's
    /// digits: the last digit on each level's axis, from the bottom up.
    static func levelsBetween(_ shallow: View, _ deep: View, _ deepPath: [Step]) throws -> [Step] {
        let n = try shallow.level - deep.level
        guard let count = n.int, count <= 3 else { throw ScaleError(.path, "one rebase moves at most two levels") }
        var digits = AnchorDigits(deepPath)
        var steps: [Step] = []
        var k = deep.level
        for _ in 0..<count {
            k = k + 1
            let axis = TowerMath.axis(k)
            var runs: [[DigitRun]] = [[], [], []]
            runs[axis] = [DigitRun(digit: digits.popLast(axis), length: 1)]
            steps.insert(.tower(levels: 1, runs: runs), at: 0)
        }
        return steps
    }

    /// Per axis, the digits of an anchor path's tower steps, popped from the end.
    struct AnchorDigits {
        var runs: [[DigitRun]] = [[], [], []]

        init(_ path: [Step]) {
            for s in path {
                if case let .tower(_, rs) = s { for a in 0..<3 { runs[a] += rs[a] } }
            }
        }

        mutating func popLast(_ a: Int) -> UInt8 {
            let last = runs[a].removeLast()
            if last.length > BigUInt(1) { runs[a].append(DigitRun(digit: last.digit, length: try! last.length - 1)) }
            return last.digit
        }
    }

    // MARK: Pinch (§8.8)

    @Test func pinchIsASimilarityAndInvertible() throws {
        let rung = Content.rung(6)
        let r = Content.resolver([rung])
        var frame = try Content.toy(Content.ref(rung), span: 0.3, resolver: r)
        let original = frame
        let p = Vec3(0.1, -0.2, -0.4)
        let x = Vec3(3, 7, 11)
        let before = frame.world(x)
        pinch(&frame, ratio: 2.5, about: p)
        #expect((frame.world(x) - (p + 2.5 * (before - p))).length < 1e-15)
        pinch(&frame, ratio: 1 / 2.5, about: p)
        #expect(abs(frame.metresPerAnchorUnit / original.metresPerAnchorUnit - 1) < 1e-15)
        #expect((frame.worldFromAnchor.translation - original.worldFromAnchor.translation).length < 1e-15)
    }

    // MARK: Magnification (§8.7) and the scale axis (§8.8)

    /// φ ≈ −7,254 for the googolplex bar at desk size, and ≈ −1.45 × 10⁶ for `levels` 2⁶⁵⁵³⁵.
    @Test func phiForTheDeepestTowers() throws {
        let rung = Content.rung(Content.googolplexLevels)
        let r = Content.resolver([rung])
        let bar = try Content.toy(Content.ref(rung), span: 0.3, resolver: r)
        let m = try r.magnification(of: bar)
        #expect(m.lambda == nil)
        #expect(abs(m.phi - -7254) < 1)
        #expect(m.readout == "shown 10^(\u{2212}3.333 \u{00D7} 10^99) times life size")

        let deepest = Magnification(unitExponent: TowerMath.unitExponent(BigUInt.power(2, 65535)), factor: 10, ell: -1)
        #expect(abs(deepest.phi / -1.45e6 - 1) < 0.01)
        #expect(deepest.phi.isFinite)
        // In another base the exponent is printed in that base.
        let two = Magnification(unitExponent: TowerMath.unitExponent(BigUInt.power(2, 300)), factor: 2, ell: -1)
        #expect(two.readout.hasPrefix("shown 2^(\u{2212}"))
    }

    @Test func magnificationNearLifeSize() throws {
        let water = Content.water
        let r = Resolver(store: RecordStore([water]))
        let ref = ScaleRef(root: water.id, records: [water], path: Path())
        var frame = BodyFrame(ref: ref, metresPerAnchorUnit: 1e-10)
        #expect(try r.magnification(of: frame).readout == "life size")
        #expect(abs(try r.magnification(of: frame).lambda! - 0) < 1e-12)
        frame.metresPerAnchorUnit = 0.01
        let m = try r.magnification(of: frame)
        #expect(abs(m.lambda! - 8) < 1e-12)
        #expect(m.phi == m.lambda!)
    }

    @Test func scaleAxisIsOneToOneThenLogarithmicAndC1() {
        for l in [-31.5, -1, 0, 0.25, 12, 32] { #expect(ScaleAxis.phi(l) == l) }
        for l in [-1e6, -40, 33, 100, 1e99] {
            #expect(abs(ScaleAxis.lambda(ScaleAxis.phi(l)) / l - 1) < 1e-12)
        }
        // C¹ at 32: the slope is 1 on both sides.
        let h = 1e-6
        #expect(abs((ScaleAxis.phi(32 + h) - ScaleAxis.phi(32)) / h - 1) < 1e-5)
        #expect(ScaleAxis.cap == 11)
    }

    @Test func detentsClickOncePerFrame() {
        #expect(ScaleAxis.detent(from: 0.5, to: 1.5) == 1)
        #expect(ScaleAxis.detent(from: -0.1, to: 0.1) == 0)
        #expect(ScaleAxis.detent(from: 2.2, to: 2.8) == nil)
        #expect(ScaleAxis.detent(from: 99, to: 101) == 100)
        #expect(ScaleAxis.detent(from: -999, to: -1001) == -1000)
        // Crossing several decades in one frame clicks the nearest one only.
        #expect(ScaleAxis.detent(from: 3.5, to: 7.5) == 4)
    }

    // MARK: Flight (§8.8)

    /// From the googolplex bar at desk size to its atoms in about 18 s, and from the top of a tower
    /// of `levels` 2⁶⁵⁵³⁵ in about two minutes.
    @Test func flightCrossesEveryTowerInBoundedTime() throws {
        let rung = Content.rung(Content.googolplexLevels)
        let r = Content.resolver([rung])
        let bar = try Content.toy(Content.ref(rung), span: 0.3, resolver: r)
        let start = try r.magnification(of: bar).phi
        let googolplex = Self.flightTime(from: start)
        let deepest = Self.flightTime(from: Magnification(unitExponent: TowerMath.unitExponent(BigUInt.power(2, 65535)), factor: 10, ell: -1).phi)
        let gentle = Self.flightTime(from: start, comfort: .gentle)
        print("flight to the atoms: googolplex bar \(String(format: "%.1f", googolplex)) s (Gentle \(String(format: "%.1f", gentle)) s), levels 2^65535 \(String(format: "%.0f", deepest)) s")
        #expect(googolplex > 17 && googolplex < 20)
        #expect(deepest > 100 && deepest < 150)
        #expect(gentle > 1.9 * googolplex && gentle < 2.1 * googolplex)
    }

    static func flightTime(from phi: Double, comfort: Comfort = .standard) -> Double {
        var f = Flight(phi: phi, direction: 1)
        let dt = 1.0 / 60
        var t = 0.0
        while f.phi < 0 && t < 3600 {
            _ = f.step(dt, comfort: comfort)
            t += dt
        }
        return t
    }

    /// Each frame wraps whole periods so what remains is under one period plus V (§8.8).
    @Test func wrapsLeaveLessThanAPeriodPlusV() {
        let v = Flight.pictureStep(.standard)
        #expect(abs(v - 0.03) < 1e-15)
        #expect(Flight.pictureStep(.gentle) == 0.015)
        for (remaining, f) in [(1000.0, UInt8(10)), (-55.5, 10), (12345.6, 2), (0.5, 16), (3.2, 16)] {
            let n = Wraps.periods(remaining: remaining, factor: f, pictureStep: v)
            let left = abs(remaining) - Double(n) * log10(Double(f))
            #expect(left <= log10(Double(f)) + v + 1e-9)
            #expect(left >= 0 || n == 0)
        }
        // A googolplex dive wraps about 10⁹⁸ periods a frame: counted exactly, never as an Int.
        let huge = Wraps.periodCount(remaining: 7.3e98, factor: 10, pictureStep: v)
        #expect(huge.bitWidth > 320)
        #expect(abs(huge.double / 7.3e98 - 1) < 1e-12)
        #expect(Wraps.periods(remaining: 7.3e98, factor: 10, pictureStep: v) == Int.max)
        #expect(BigUInt(roundingUp: 2.5) == BigUInt(3))
        #expect(BigUInt(roundingUp: 0x1p70) == BigUInt(1) << 70)
    }

    /// Climbing back part of the way up a long descent removes one digit per axis for each period,
    /// in O(runs): the picture's frame stays, and walking the new anchor path is exact.
    @Test func aPartialClimbCostsRuns() throws {
        let levels = Content.googolplexLevels
        let rung = Content.rung(levels)
        let r = Content.resolver([rung])
        let k = try levels - 30
        let path = Content.anchorPath(rootLevels: levels, to: k, digits: [0, 0, 0])
        var frame = Content.terrain(Content.ref(rung), anchorPath: path, sigma: 1, anchorPoint: .zero, at: .zero)
        let before = frame.worldFromAnchor
        let deep = BigUInt.power(10, 98)
        try Wraps.wrap(&frame, periods: deep, descending: true, resolver: r)
        // Up again by a tenth of it and one level-period more: the last step is only partly consumed.
        let up = deep.dividedSmall(10).quotient + BigUInt(1)
        let clock = ContinuousClock()
        let start = clock.now
        try Wraps.wrap(&frame, periods: up, descending: false, resolver: r)
        #expect(clock.now - start < .seconds(1))
        let anchor = try r.walk(r.root(rung.id), frame.anchorPath)
        let expected = try k - deep.multipliedSmall(3) + up.multipliedSmall(3)
        #expect(anchor.level == expected)
        #expect(frame.worldFromAnchor == before)
        // And all the way back to where the dive began.
        try Wraps.wrap(&frame, periods: try deep - up, descending: false, resolver: r)
        #expect(try r.walk(r.root(rung.id), frame.anchorPath).level == k)
    }
}
