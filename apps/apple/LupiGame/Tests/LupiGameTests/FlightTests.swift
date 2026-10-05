import Foundation
import LupiChem
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

/// Flight along the scale axis (scale-spec §8.8): the dive from a googolplex bar on the desk to
/// its ions, wraps, Still and Gentle, a hold that flies, a pinch that moves φ, and surfacing.
@Suite("flight")
struct FlightTests {
    /// Spawns a scale item, lets it land, turns the camera toward it and selects it.
    static func spawn(_ sim: inout Simulation, _ item: ScaleItem, settle: Double = 2.0) -> BodyID {
        sim.session.spawn(.scale(item))
        sim.step()
        let id = sim.session.bodyOrder.last!
        sim.run(settle)
        sim.camera = ScaleTests.facing(sim, id)
        sim.session.select(id)
        sim.step()
        return id
    }

    static func lambda(_ sim: Simulation, _ id: BodyID) -> Double {
        let m = try! sim.session.resolver.magnification(of: sim.session.body(id)!.frame)
        return m.lambda ?? ScaleAxis.lambda(m.phi)
    }

    static func flightEnded(_ sim: Simulation, after count: Int = 0) -> Bool {
        sim.events.dropFirst(count).contains { if case .flight(_, false) = $0 { return true }; return false }
    }

    /// Runs until the flight ends; returns the seconds it took and the frames' longest anchor path.
    static func fly(_ sim: inout Simulation, limit: Double) -> (seconds: Double, steps: Int) {
        let start = sim.time
        let mark = sim.events.count
        var steps = 0
        sim.run(until: limit) { s in
            if let id = s.session.flight?.body { steps = max(steps, s.session.body(id)?.frame.anchorPath.count ?? 0) }
            return flightEnded(s, after: mark)
        }
        return (sim.time - start, steps)
    }

    /// From the bar on the desk to 2 cm ions (§8.8): about 18 s of flight plus the first and last
    /// decades at V a frame, every frame within its budgets, the anchor path one merged step however
    /// many of the 10¹⁰⁰ levels it descends, and the ions drawn at the end.
    @Test func theGoogolplexDive() throws {
        var sim = Fixture.sim()
        sim.dt = 1.0 / 30
        let id = Self.spawn(&sim, .salt(.googolplex))
        let rAtom = try #require(sim.session.body(id)).facts.aggregate.rAtom
        #expect(sim.session.beyondOneToOne(id))
        sim.session.dive(into: id)
        sim.step()
        #expect(sim.events.contains(.flight(id, active: true)))
        #expect(sim.session.flight?.kind == .dive)
        let (seconds, steps) = Self.fly(&sim, limit: 40)
        let b = try #require(sim.session.body(id))
        let target = log10(0.02 / (2 * rAtom)) + 10
        print("googolplex dive: \(String(format: "%.1f", seconds)) s at 30 fps, anchor \(steps) steps, items \(sim.last.cut?.items.count ?? 0), atoms \(sim.last.cut?.drawnAtoms ?? 0)")
        #expect(Self.flightEnded(sim))
        #expect(sim.budgetViolations.isEmpty)
        // V is per frame: at 30 fps the first and last decades take twice as long as at 60.
        #expect(seconds > 15 && seconds < 26)
        #expect(abs(Self.lambda(sim, id) - target) < 1e-6)
        #expect(b.sizeState == .terrain)
        #expect(b.mode == .static)
        #expect(steps <= 3)
        #expect((sim.last.cut?.drawnAtoms ?? 0) > 0)
        // The count never changed on the way, and prints the same.
        #expect(b.facts.count.formatted == "10^(10^100)")
        #expect(sim.events.filter { if case .detent(id, _) = $0 { return true }; return false }.count > 30)
    }

    /// Back out of the googolplex: the anchor climbs whole periods, the picture shrinks the last
    /// decades, and the bar lands back ahead of the camera at its spawn size.
    @Test func surfacingFromTheGoogolplex() throws {
        var sim = Fixture.sim()
        sim.dt = 1.0 / 30
        let id = Self.spawn(&sim, .salt(.googolplex))
        let spawnSpan = try #require(sim.session.body(id)).spawnSpan
        sim.session.dive(into: id, ionDiameter: 1e-6)
        _ = Self.fly(&sim, limit: 40)
        #expect(try #require(sim.session.body(id)).sizeState == .terrain)
        sim.session.surface(id)
        let (seconds, steps) = Self.fly(&sim, limit: 60)
        let b = try #require(sim.session.body(id))
        print("googolplex surface: \(String(format: "%.1f", seconds)) s, anchor \(steps) steps")
        #expect(seconds < 40)
        #expect(b.frame.anchorPath.isEmpty)
        #expect(abs(b.span - spawnSpan) < 1e-6)
        #expect(b.sizeState == .toy)
        #expect(sim.budgetViolations.isEmpty)
        // Ahead of the camera again.
        #expect((b.entityPose.translation - sim.camera.position).length < 0.6)
    }

    /// A two-finger hold flies only beyond 10^±32 (§10.5): on the googolplex it flies toward the
    /// atoms, and lifting the fingers lets the picture finish its way.
    @Test func aHoldFliesTheGoogolplexButNotCaffeine() throws {
        var sim = Fixture.sim()
        let caffeine = Fixture.spawn(&sim, "caffeine")
        sim.session.select(caffeine)
        sim.step()
        sim.hold(at: sim.screenPoint(of: caffeine)!, for: 0.6)
        #expect(!sim.events.contains { if case .flight = $0 { return true }; return false })

        var deep = Fixture.sim()
        deep.dt = 1.0 / 30
        let id = Self.spawn(&deep, .salt(.googolplex))
        let phi0 = try deep.session.resolver.magnification(of: deep.session.body(id)!.frame).phi
        deep.hold(at: SIMD2(195, 422), for: 2.0)
        #expect(deep.events.contains(.flight(id, active: true)))
        let report = try #require(deep.session.flight)
        #expect(report.kind == .fly)
        #expect(report.targetPhi > phi0 + 100)
        #expect(!report.held)
        _ = Self.fly(&deep, limit: 20)
        #expect(Self.flightEnded(deep))
        #expect(deep.budgetViolations.isEmpty)
    }

    /// Gentle halves the flight's speed and V (§8.8): the same dive takes longer.
    @Test func gentleFliesSlower() throws {
        var standard = Fixture.sim()
        standard.dt = 1.0 / 30
        let a = Self.spawn(&standard, .salt(.googolplex))
        standard.session.dive(into: a)
        let fast = Self.fly(&standard, limit: 40).seconds
        var gentle = Fixture.sim(GameSettings(comfort: .gentle))
        gentle.dt = 1.0 / 30
        let b = Self.spawn(&gentle, .salt(.googolplex))
        gentle.session.dive(into: b)
        let slow = Self.fly(&gentle, limit: 80).seconds
        print("googolplex dive: standard \(fast) s, gentle \(slow) s")
        #expect(slow > 1.6 * fast)
        #expect(gentle.budgetViolations.isEmpty)
    }

    /// Still turns flight into cuts (§8.8): the picture never creeps by V; it jumps, at most every
    /// 0.35 s, wraps carry the rest unseen, and the dive still arrives.
    @Test func stillCutsInsteadOfZooming() throws {
        var sim = Fixture.sim(GameSettings(comfort: .still))
        sim.dt = 1.0 / 30
        let id = Self.spawn(&sim, .salt(.googolplex))
        sim.session.dive(into: id)
        var steps: [Double] = []
        sim.run(until: 40) { s in
            if let r = s.session.flight { steps = r.pictureSteps }
            return Self.flightEnded(s)
        }
        #expect(Self.flightEnded(sim))
        #expect(steps.count >= 2)
        for (a, b) in zip(steps, steps.dropFirst()) { #expect(b - a >= FlightTuning.stillCutInterval - 1e-9) }
        let target = log10(0.02 / (2 * sim.session.body(id)!.facts.aggregate.rAtom)) + 10
        #expect(abs(Self.lambda(sim, id) - target) < 1e-6)
        #expect(sim.budgetViolations.isEmpty)
    }

    /// Anchored below its node, a body is beyond the fingers' one-to-one range: a pinch moves φ and
    /// the picture follows (§8.8).
    @Test func aPinchOnDeepTerrainMovesPhi() throws {
        var sim = Fixture.sim()
        sim.dt = 1.0 / 30
        let id = Self.spawn(&sim, .salt(.googolplex))
        sim.session.dive(into: id, ionDiameter: 1e-7)
        _ = Self.fly(&sim, limit: 40)
        let before = sim.events.count
        let lambda0 = Self.lambda(sim, id)
        sim.pinch(at: SIMD2(195, 422), ratio: 2, over: 0.5)
        #expect(sim.events.dropFirst(before).contains(.flight(id, active: true)))
        _ = Self.fly(&sim, limit: 10)
        // log10(2) along φ, which is λ itself within 10^±32.
        #expect(abs(Self.lambda(sim, id) - lambda0 - log10(2)) < 1e-6)
        #expect(sim.budgetViolations.isEmpty)
    }
}

extension Simulation {
    /// Two fingers held still about a point for `seconds`, then lifted.
    mutating func hold(at c: SIMD2<Double>, for seconds: Double, separation: Double = 120) {
        let f1 = touch(), f2 = touch()
        let half = SIMD2(separation / 2, 0)
        step(touches: [
            TouchSample(id: f1, phase: .began, location: c - half, time: time + dt),
            TouchSample(id: f2, phase: .began, location: c + half, time: time + dt),
        ])
        run(seconds)
        step(touches: [
            TouchSample(id: f1, phase: .ended, location: c - half, time: time + dt),
            TouchSample(id: f2, phase: .ended, location: c + half, time: time + dt),
        ])
    }

    /// Two fingers about a screen point spreading by `ratio`.
    mutating func pinch(at c: SIMD2<Double>, ratio: Double, over duration: Double, separation: Double = 120) {
        let f1 = touch(), f2 = touch()
        let half = SIMD2(separation / 2, 0)
        step(touches: [
            TouchSample(id: f1, phase: .began, location: c - half, time: time + dt),
            TouchSample(id: f2, phase: .began, location: c + half, time: time + dt),
        ])
        let n = max(1, Int((duration / dt).rounded()))
        var s = separation
        for k in 1...n {
            s = separation * pow(ratio, Double(k) / Double(n))
            let h = SIMD2(s / 2, 0)
            step(touches: [
                TouchSample(id: f1, phase: .moved, location: c - h, time: time + dt),
                TouchSample(id: f2, phase: .moved, location: c + h, time: time + dt),
            ])
        }
        let h = SIMD2(s / 2, 0)
        step(touches: [
            TouchSample(id: f1, phase: .ended, location: c - h, time: time + dt),
            TouchSample(id: f2, phase: .ended, location: c + h, time: time + dt),
        ])
    }
}
