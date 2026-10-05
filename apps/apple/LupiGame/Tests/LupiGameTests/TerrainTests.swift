import Foundation
import LupiChem
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

/// Terrain physics (scale-spec §10.1) and the spikes S8 and S9: face planes that hold toys on a
/// plain of salt, windows of atom bumps around the camera and slow bodies, colliders off inside the
/// solid, and bodies at the size extremes.
@Suite("terrain")
struct TerrainTests {
    /// The googolplex bar dived into from above: a plain of salt 30 cm under the phone.
    static func plain(_ settings: GameSettings = GameSettings()) -> (Simulation, BodyID) {
        var sim = Fixture.sim(settings)
        sim.dt = 1.0 / 30
        sim.session.spawn(.scale(.salt(.googolplex)))
        sim.step()
        let id = sim.session.bodyOrder.last!
        sim.run(2)
        let c = sim.session.body(id)!.entityPose.translation
        sim.camera = CameraState.looking(from: c + Vec3(0, 0.3, 0.1), at: c)
        sim.session.select(id)
        sim.step()
        sim.session.dive(into: id)
        _ = FlightTests.fly(&sim, limit: 40)
        sim.run(0.5)
        return (sim, id)
    }

    @Test func aPlainOfSaltHoldsToysOnItsFace() throws {
        var (sim, id) = Self.plain()
        let b = try #require(sim.session.body(id))
        #expect(b.sizeState == .terrain)
        // Its own body has no shapes: its faces and windows are static colliders (§10.1).
        #expect(b.spec.shapes.isEmpty)
        let faces = try #require(sim.world.statics[.faces])
        #expect(!faces.shapes.isEmpty)
        let stats = sim.session.terrainStats
        #expect(stats.faces >= 1)
        #expect(stats.cameraShapes > 0 && stats.cameraShapes <= 64)
        // The face under the camera: the top of the bar it was dived into.
        guard case let .box(centre, half, rotation) = faces.shapes[0] else {
            Issue.record("a face plane is a box")
            return
        }
        let normal = rotation.act(Vec3(0, 0, 1))
        #expect(normal.y > 0.99)
        let faceY = faces.origin.y + centre.y + half.z
        #expect(abs(half.z - 0.25) < 1e-9)
        // The plain lies above the desk the bar stood on.
        #expect(faceY > 1.005)
        // A caffeine dropped on the plain rests on it, not on the desk under it.
        sim.session.spawn(.starter("caffeine"))
        sim.step()
        let water = sim.session.bodyOrder.last!
        sim.run(4)
        let w = try #require(sim.session.body(water))
        #expect(!w.parked)
        #expect(w.lowestColliderPoint >= faceY - 0.003)
        #expect(w.atRest)
        // At rest, it has a window of atom bumps; the camera's and the bodies' share 256 shapes.
        let after = sim.session.terrainStats
        #expect(after.bodyWindows == 1)
        #expect(after.cameraShapes + after.bodyShapes <= 256)
        #expect(sim.world.statics[.bodyWindow(water)] != nil)
        #expect(sim.budgetViolations.isEmpty)
    }

    /// A fast body has no window; it meets the face planes alone (§10.1).
    @Test func fastBodiesMeetTheFacesAlone() throws {
        var (sim, _) = Self.plain()
        sim.session.spawn(.starter("water"))
        sim.step()
        let water = sim.session.bodyOrder.last!
        sim.run(2)
        #expect(sim.world.statics[.bodyWindow(water)] != nil)
        sim.flick(water, points: 600, over: 0.1)
        sim.step()
        sim.step()
        let speed = sim.session.body(water)?.motion.linearVelocity.length ?? 0
        if speed > 1 { #expect(sim.world.statics[.bodyWindow(water)] == nil) }
    }

    /// Spike S8: with the switch on, the camera's window is rebuilt every frame, and the HUD line
    /// counts the rebuilds a second.
    @Test func s8RebuildsTheCameraWindowEveryFrame() throws {
        var (sim, _) = Self.plain()
        let before = sim.world.staticBuilds[.cameraWindow] ?? 0
        sim.session.debug.s8RebuildEveryFrame = true
        sim.run(1)
        let after = sim.world.staticBuilds[.cameraWindow] ?? 0
        #expect(after - before >= 29)
        #expect(sim.session.terrainStats.rebuildsPerSecond >= 29)
        #expect(sim.session.terrainStats.line.hasPrefix("S8 terrain:"))
    }

    /// Inside the solid the colliders are off and every toy is parked until the camera comes out.
    @Test func insideTheSolidEverythingWaits() throws {
        var (sim, id) = Self.plain()
        sim.session.spawn(.starter("water"))
        sim.step()
        let water = sim.session.bodyOrder.last!
        sim.run(2)
        let faces = try #require(sim.world.statics[.faces])
        guard case let .box(centre, _, _) = faces.shapes[0] else { return }
        // Down through the face, 10 cm into the salt.
        let below = faces.origin + centre + Vec3(0, 0.15, 0)
        let outside = sim.camera
        sim.camera = CameraState.looking(from: below, at: below + Vec3(0, -1, 0.1))
        sim.run(0.5)
        #expect(sim.world.statics.isEmpty)
        #expect(sim.session.body(water)?.parked == true)
        #expect(sim.session.body(id)?.sizeState == .terrain)
        #expect(sim.budgetViolations.isEmpty)
        sim.camera = outside
        sim.run(0.5)
        #expect(sim.session.body(water)?.parked == false)
        #expect(sim.world.statics[.faces] != nil)
    }

    /// Spike S9: boxes and hulls of 3 cm and 90 cm dropped side by side land, rest and stay above
    /// the floor (on the stand-in; the device is the real test).
    @Test func s9DropsBoxesAndHullsAtTheExtremes() throws {
        var sim = Fixture.sim()
        sim.step()
        sim.session.s9DropExtremes()
        sim.step()
        let probe = try #require(sim.session.s9)
        #expect(probe.tracks.count == 4)
        let kinds = probe.tracks.map { t -> String in
            switch sim.session.body(t.body)?.spec.shapes.first {
            case .box?: "box"
            case .convex?: "convex"
            default: "other"
            }
        }
        #expect(kinds == ["box", "box", "convex", "convex"])
        let spans = probe.tracks.map { sim.session.body($0.body)!.span }
        #expect(zip(spans, [0.03, 0.9, 0.03, 0.9]).allSatisfy { abs($0 - $1) < 1e-9 })
        sim.run(4)
        let done = try #require(sim.session.s9)
        for t in done.tracks {
            #expect(t.landedAt != nil, "\(t.label)")
            #expect(t.restedAt != nil, "\(t.label)")
            #expect(!t.fellThrough && !t.lost, "\(t.label)")
            #expect(t.deepestSink < 0.01, "\(t.label)")
        }
        #expect(done.lines.count == 4)
        #expect(done.lines[0].hasPrefix("S9 box 3 cm: landed"))
    }
}
