import Foundation
import LupiChem
import LupiScale
import LupiScaleCore
import Testing

/// Budgets (§9.3), display keys and draw items (§9.7), and what reaches Float32 (§8.5, §8.6).
@Suite("§9.3 budgets and §9.7 draw items")
struct DrawItemTests {
    @Test func iPhone15ProColumns() {
        func row(_ b: Budgets) -> [Double] {
            [b.tau, b.tauMinimum, Double(b.visits), Double(b.items), Double(b.instancedAtoms), Double(b.engineAtoms),
             Double(b.boxesAndSplats), Double(b.materializations), Double(b.meshBuilds), Double(b.residentBytes >> 20)]
        }
        #expect(row(.iPhone15Pro(.fair)) == [1.5, 1.0, 8192, 4096, 5000, 150_000, 32_000, 8, 1, 192])
        #expect(row(.iPhone15Pro(.serious)) == [1.5, 1.5, 6144, 3072, 3000, 75_000, 24_000, 4, 1, 192])
        #expect(row(.iPhone15Pro(.critical)) == [2.0, 2.0, 4096, 2048, 2000, 50_000, 16_000, 2, 1, 192])
        #expect(row(.iPadPro(.fair)) == [1.5, 1.0, 12_288, 8192, 8000, 250_000, 48_000, 12, 2, 384])
    }

    /// τ rises by 1.25 on an over-budget frame or a dropped frame, decays by 0.95 after 2 s
    /// without drops and by 0.9 after 0.5 s under 80 %, and stays in [τ_min, 8].
    @Test func tauControllers() {
        var c = TauController(budgets: .iPhone15Pro(.fair))
        c.frame(at: 0, interval: 1 / 60.0, displayPeriod: 1 / 60.0, overBudget: true, usage: 1)
        #expect(abs(c.tau - 1.875) < 1e-12)
        for i in 1...600 { c.frame(at: Double(i) / 60, interval: 1 / 60.0, displayPeriod: 1 / 60.0, overBudget: false, usage: 0.5) }
        #expect(c.tau == 1.0)
        for i in 0..<400 { c.frame(at: 20 + Double(i) / 60, interval: 0.05, displayPeriod: 1 / 60.0, overBudget: true, usage: 1) }
        #expect(c.tau == 8)
        c.gpuTime(16)
        #expect(c.tau == 8)
        var d = TauController(budgets: .iPhone15Pro(.critical))
        d.gpuTime(0)
        #expect(d.tau == 2.0)
    }

    /// A start's key is its refKey's first 8 bytes as a little-endian u64; a child's is
    /// mix64(parent + γ (i + 1)); key32 is the low half (§9.7).
    @Test func displayKeys() throws {
        let rung = Content.rung(3)
        let r = Content.resolver([rung])
        let ref = Content.ref(rung)
        let body = try Content.toy(ref, span: 0.3, centre: Vec3(0, 0, -0.35), resolver: r)
        let cut = settledCut([body], deskView, steadyBudgets(), r)
        let start = ScaleRef.refKey(root: ref.root, path: ref.path).leadingUInt64
        #expect(ref.key.leadingUInt64 == start)
        // Every item's key follows from the start by the child rule along its path.
        for item in cut.items {
            let steps = try #require(cut.path(of: item))
            var k = start
            var level = BigUInt(3)
            for s in steps {
                guard case let .tower(d, runs) = s else { continue }
                var queues = runs.map { $0.flatMap { run in Array(repeating: run.digit, count: run.length.int!) } }
                for _ in 0..<d.int! {
                    let digit = queues[TowerMath.axis(level)].removeFirst()
                    k = SplitMix64.mix(k &+ 0x9E37_79B9_7F4A_7C15 &* UInt64(Int(digit) + 1))
                    level = try level - 1
                }
            }
            if case .atoms = item.extras { k = SplitMix64.mix(k &+ 0x9E37_79B9_7F4A_7C15) }
            #expect(item.key32 == UInt32(truncatingIfNeeded: k))
        }
        #expect(cut.items.count > 10)
    }

    /// Terrain items hang off the camera frame entity, kept within 2 m of the camera; every
    /// translation cast to Float32 is metres from it, so nothing far reaches Float32 (§8.5).
    @Test func terrainDrawsNearTheCamera() throws {
        let rung = Content.rung(Content.googolplexLevels)
        let r = Content.resolver([rung])
        let body = Content.terrain(
            Content.ref(rung), anchorPath: Content.anchorPath(rootLevels: Content.googolplexLevels, to: 9, digit: 5),
            sigma: 1.111, anchorPoint: Vec3(141, 141, 141), at: Vec3(1000, -2000, 5000)
        )
        let view = ViewState.looking(from: Vec3(1000, -2000, 5000), at: Vec3(1000, -2000, 4999))
        let cut = settledCut([body], view, steadyBudgets(), r)
        #expect((cut.cameraFrameOrigin - view.cameraPosition).length <= CutTuning.cameraFrameRange)
        for item in cut.items {
            #expect(item.parent == .cameraFrame)
            let t = item.transform.translation
            let half = SIMD3<Double>(Double(item.halfExtents.x), Double(item.halfExtents.y), Double(item.halfExtents.z))
            let scale = Double(simdLengthF(item.transform.c0))
            #expect(Double(simdLengthF(t)) <= FrameTuning.zFar + 2 + scale * half.length + 1e-3)
        }
        // Moving the camera 1 m keeps the entity; moving it 3 m re-centres it.
        let near = ViewState.looking(from: Vec3(1001, -2000, 5000), at: Vec3(1001, -2000, 4999))
        let kept = buildCut(bodies: [body], view: near, budgets: steadyBudgets(), previous: cut, resolver: r)
        #expect(kept.cameraFrameOrigin == cut.cameraFrameOrigin)
        let far = ViewState.looking(from: Vec3(1003, -2000, 5000), at: Vec3(1003, -2000, 4999))
        let moved = buildCut(bodies: [body], view: far, budgets: steadyBudgets(), previous: cut, resolver: r)
        #expect(moved.cameraFrameOrigin == far.cameraPosition)
    }

    /// A toy's items hang off its own entity: relative to the anchor's local centre, metres (§8.5).
    @Test func toyItemsAreEntityRelative() throws {
        let rung = Content.rung(3)
        let r = Content.resolver([rung])
        let body = try Content.toy(Content.ref(rung), span: 0.3, centre: Vec3(5, 6, -7), resolver: r)
        let view = ViewState.looking(from: Vec3(5, 6, -6.7), at: Vec3(5, 6, -7))
        let cut = settledCut([body], view, steadyBudgets(), r)
        #expect(!cut.items.isEmpty)
        #expect((cut.bodyEntities[0].translation - Vec3(5, 6, -7)).length < 1e-9)
        for item in cut.items {
            #expect(item.parent == .body(0))
            #expect(Double(simdLengthF(item.transform.translation)) <= 0.3)
        }
        #expect(cut.bodyCounts[0].plain == BigUInt(1_000_000))
    }

    /// The camera inside solid terrain opens the excavation bubble: no atom within 0.35 m (§10.1).
    @Test func excavationBubble() throws {
        let rung = Content.rung(27)
        let r = Content.resolver([rung])
        let body = Content.terrain(
            Content.ref(rung), anchorPath: Content.anchorPath(rootLevels: 27, to: 9, digit: 5),
            sigma: 1.111, anchorPoint: Vec3(141, 141, 141), at: .zero
        )
        let cut = settledCut([body], deskView, steadyBudgets(), r)
        var nearest = Double.infinity
        for item in cut.items {
            guard case let .atoms(runs) = item.extras else { continue }
            let (m, t) = CutChecks.world(item, cut)
            for run in runs {
                for p in run.positions {
                    let w = m * Vec3(Double(p.x), Double(p.y), Double(p.z)) + t
                    nearest = min(nearest, w.length)
                }
            }
        }
        #expect(nearest >= CutTuning.bubbleRadius - 1e-4)
        #expect(nearest < CutTuning.bubbleRadius + 0.05)
    }
}

func simdLengthF(_ v: SIMD3<Float>) -> Float { (v * v).sum().squareRoot() }
