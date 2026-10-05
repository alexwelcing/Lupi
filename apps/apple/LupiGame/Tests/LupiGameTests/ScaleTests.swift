import Foundation
import LupiChem
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

/// Pinch through the anchor and the scale axis, size states, and the receipt's dive
/// (scale-spec §8.8, §10.1; plan §8 M0).
@Suite("scale in play")
struct ScaleTests {
    /// The camera turned toward a body's centre.
    static func facing(_ sim: Simulation, _ id: BodyID) -> CameraState {
        CameraState.looking(from: sim.camera.position, at: sim.session.body(id)!.entityPose.translation)
    }

    @Test func aPinchScalesOnTheFootprintAndClicksAtDecades() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "caffeine")
        sim.camera = Self.facing(sim, id)
        let before = try #require(sim.session.body(id))
        let bottom = before.worldBounds.min.y
        let lambda0 = try sim.session.resolver.magnification(of: before.frame).lambda!
        sim.pinch(id, ratio: 2, over: 0.5)
        let after = try #require(sim.session.body(id))
        // Fingers map one to one within 10^±32: twice the separation, twice the size.
        #expect(abs(after.span / before.span - 2) < 0.02)
        let lambda1 = try sim.session.resolver.magnification(of: after.frame).lambda!
        #expect(abs(lambda1 - lambda0 - log10(after.span / before.span)) < 1e-9)
        // A resting body grows about the bottom of its bounds, so it never sinks into the desk.
        let r = after.span / before.span
        let c0 = before.entityPose.translation, c1 = after.entityPose.translation
        #expect(abs((c1.y - bottom) - r * (c0.y - bottom)) < 1e-9)
        #expect(abs(c1.x - c0.x) < 1e-9 && abs(c1.z - c0.z) < 1e-9)
        // λ crossed a decade near 8.18 → 8.48? Not necessarily; a detent is reported when it does.
        let crossed = floor(lambda1) != floor(lambda0)
        #expect(sim.events.contains { if case .detent(id, _) = $0 { return true }; return false } == crossed)
        // Still a toy within 3× its spawn span, so dynamic again.
        #expect(after.sizeState == .toy)
        #expect(after.mode == .dynamic)
        // Mass does not change with toy scale (plan §4.2).
        #expect(after.feltMassKg == before.feltMassKg)
    }

    @Test func growingPastThreeTimesMakesAMonumentAndBackAToy() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "benzene")
        sim.camera = Self.facing(sim, id)
        sim.pinch(id, ratio: 4, over: 0.6)
        var b = try #require(sim.session.body(id))
        #expect(b.span > 3 * b.spawnSpan)
        #expect(b.sizeState == .monument)
        #expect(b.mode == .kinematic)
        #expect(sim.last.physics.contains(.setMode(id, .kinematic)))
        // A detent clicked on the way (4× crosses at least one decade boundary or none; the HUD readout updates).
        #expect(sim.last.hud.plaque == nil || !sim.last.hud.plaque!.magnification.isEmpty)
        sim.pinch(id, ratio: 0.25, over: 0.6)
        b = try #require(sim.session.body(id))
        #expect(b.sizeState == .toy)
        #expect(b.mode == .dynamic)
    }

    /// The receipt's inside view: the 10⁹ crystal grows until its ions are 2 cm across, the camera
    /// stands inside it, toys are parked, and the cut draws the bubble's wall within its budgets.
    @Test func divingIntoTheBillionKeepsBudgetsAndExactCounts() throws {
        var sim = Fixture.sim()
        sim.session.spawnReceipt()
        sim.run(2.5)
        let ids = sim.session.bodyOrder
        #expect(ids.count == 3)
        let billion = ids[2]
        #expect(sim.session.body(billion)!.facts.count.formatted == "1,000,000,000")
        sim.session.dive(into: billion)
        sim.run(2.5)
        let b = try #require(sim.session.body(billion))
        #expect(b.sizeState == .terrain)
        #expect(b.mode == .static)
        // Ions about 2 cm across.
        let ionDiameter = 2 * b.facts.aggregate.rAtom * pow(10, try sim.session.resolver.magnification(of: b.frame).lambda! - 10)
        #expect(abs(ionDiameter - 0.02) < 1e-6)
        let cut = try #require(sim.last.cut)
        #expect(!cut.items.isEmpty)
        #expect(cut.items.allSatisfy { $0.parent == .cameraFrame })
        #expect(cut.drawnAtoms > 0)
        #expect(sim.budgetViolations.isEmpty)
        // The other toys wait outside the simulation; the HUD still counts everything exactly.
        #expect(ids.dropLast().allSatisfy { sim.session.body($0)!.parked })
        #expect(sim.last.hud.totalAtoms == "1,001,001,000")
        // Nothing spawns inside matter.
        sim.session.spawn(.starter("water"))
        sim.step()
        #expect(sim.session.bodyOrder.count == 3)
        #expect(sim.events.contains(.refused("Step out of the crystal to spawn")))
        // And back out: a toy again, ahead of the camera, the others unparked.
        sim.session.surface(billion)
        sim.run(2.5)
        let back = try #require(sim.session.body(billion))
        #expect(back.sizeState == .toy)
        #expect(abs(back.span - back.spawnSpan) < 1e-6)
        #expect(ids.allSatisfy { sim.session.body($0)?.parked == false })
        #expect(sim.budgetViolations.isEmpty)
    }

    /// The scale receipt on a hot phone: the same content within the critical column.
    @Test func theReceiptFitsTheCriticalColumn() {
        var sim = Fixture.sim()
        sim.thermal = .critical
        sim.session.spawnReceipt()
        sim.run(1)
        sim.session.dive(into: sim.session.bodyOrder[2])
        sim.run(2.5)
        #expect(sim.budgetViolations.isEmpty)
        let cut = sim.last.cut!
        #expect(cut.drawnAtoms <= Budgets.iPhone15Pro(.critical).instancedAtoms)
        #expect(cut.visited <= Budgets.iPhone15Pro(.critical).visits)
    }
}
