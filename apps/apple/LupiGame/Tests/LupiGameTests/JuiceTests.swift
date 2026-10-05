import Foundation
import LupiChem
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import Testing

/// Contacts to juice (plan §4.4, §5): the impact window, surfaces, render effects.
@Suite("juice router")
struct JuiceRouterTests {
    @Test func surfacesFromTheImpulseAndHeight() {
        #expect(SurfaceGuess.classify(direction: Vec3(0, 0, 1), position: Vec3(0, 1.2, -1.5), floorY: 0) == .wall)
        #expect(SurfaceGuess.classify(direction: Vec3(0, 1, 0), position: Vec3(0, 0.02, -1), floorY: 0) == .floor)
        #expect(SurfaceGuess.classify(direction: Vec3(0, 1, 0), position: Vec3(0, 0.75, -1), floorY: 0) == .table)
        #expect(SurfaceGuess.classify(direction: Vec3(0, -1, 0), position: Vec3(0, 2.5, -1), floorY: 0) == .ceiling)
        #expect(SurfaceGuess.classify(direction: Vec3(0, 1, 0), position: Vec3(0, 0.75, -1), floorY: nil) == .table)
    }

    /// A first report that reads low is not the hit: the window's largest impulse is (spike A4).
    @Test func theLargestImpulseInFiftyMillisecondsDecides() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "benzene")
        let m = try #require(sim.session.body(id)).feltMassKg
        let t = sim.time
        let low = PlayContact(a: id, b: nil, phase: .began, impulse: 0.05 * m, direction: Vec3(0, 0, 1), position: Vec3(0, 1.1, -0.5), time: t + 0.01)
        let real = PlayContact(a: id, b: nil, phase: .updated, impulse: 3 * m, direction: Vec3(0, 0, 1), position: Vec3(0, 1.1, -0.5), time: t + 0.03)
        var input = FrameInput(time: t + 0.01, camera: sim.camera, bodies: sim.world.motions, contacts: [low])
        _ = sim.session.step(input)
        input = FrameInput(time: t + 0.03, camera: sim.camera, bodies: sim.world.motions, contacts: [real])
        let second = sim.session.step(input)
        input = FrameInput(time: t + 0.07, camera: sim.camera, bodies: sim.world.motions)
        let third = sim.session.step(input)
        let cues = second.juice + third.juice
        let hit = try #require(cues.first { $0.output.intensity > 0 })
        // Δv = J / m = 3 m/s, so I = (3 / 2)^0.6.
        #expect(abs(hit.output.intensity - min(1, pow(1.5, 0.6))) < 1e-9)
        #expect(cues.filter { $0.output.intensity > 0 }.count == 1)
        #expect(abs(third.hud.lastDeltaV! - 3) < 1e-9 || abs(second.hud.lastDeltaV! - 3) < 1e-9)
    }

    @Test func twoBodiesUseTheirReducedMass() {
        #expect(abs(PlaySession.impactDeltaV(impulse: 1, massA: 0.2, massB: 0.2) - 10) < 1e-12)
        #expect(abs(PlaySession.impactDeltaV(impulse: 1, massA: 0.5, massB: nil) - 2) < 1e-12)
    }

    @Test func aHitSquashesAndAGrabLeans() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "benzene")
        sim.camera = Fixture.level
        // Hold it and swing it sideways: the render child leans toward the motion.
        let start = try #require(sim.screenPoint(of: id))
        let finger = sim.touch()
        sim.step(touches: [TouchSample(id: finger, phase: .began, location: start, time: sim.time + sim.dt)])
        var leaned = false
        for k in 1...12 {
            sim.step(touches: [TouchSample(id: finger, phase: .moved, location: start + SIMD2(Double(k) * 12, 0), time: sim.time + sim.dt)])
            if sim.last.renders[id]!.rotation.w < 0.9999 { leaned = true }
        }
        #expect(leaned)
        sim.step(touches: [TouchSample(id: finger, phase: .ended, location: start + SIMD2(144, -200), time: sim.time + sim.dt)])
        // The wall hit squashes the render child, never the physics body.
        var squashed = false
        for _ in 0..<60 {
            sim.step()
            if let r = sim.last.renders[id], abs(r.squash.y - 1) > 0.01 {
                squashed = true
                #expect(abs(r.squash.x * r.squash.x * r.squash.y - 1) < 1e-9)
            }
        }
        #expect(squashed)
    }
}
