import Foundation
import LupiChem
import LupiGame
import LupiGameSim
import LupiScale
import Testing

@Suite("camera rays and rotations")
struct GeometryTests {
    @Test func aRayThroughAProjectedPointHitsIt() {
        let camera = CameraState.looking(from: Vec3(0.2, 1.3, 0.1), at: Vec3(-0.1, 1.0, -0.7))
        for p in [Vec3(0, 1, -0.5), Vec3(-0.2, 1.1, -0.9), Vec3(0.1, 0.95, -0.4)] {
            guard let s = camera.project(p) else {
                Issue.record("behind the camera")
                continue
            }
            let ray = camera.ray(through: s)
            let t = (p - ray.origin).length
            #expect((ray.at(t) - p).length < 1e-9)
        }
        // The centre of the view is straight ahead.
        let centre = camera.ray(through: camera.viewportPoints / 2)
        #expect((centre.direction - camera.forward).length < 1e-12)
        #expect(camera.project(camera.position - camera.forward) == nil)
    }

    /// ARKit's projection may be off-centre: the principal point shifts rays and projections alike.
    @Test func anOffCentreProjectionRoundTrips() {
        var camera = CameraState.looking(from: .zero, at: Vec3(0, 0, -1))
        camera.projection = Projection(columns: SIMD4(3.2, 0, 0, 0), SIMD4(0, 1.6, 0, 0), SIMD4(0.01, -0.02, -1, -1))
        let p = Vec3(0.05, -0.1, -0.8)
        let s = camera.project(p)!
        let ray = camera.ray(through: s)
        #expect((ray.at((p - ray.origin).length) - p).length < 1e-9)
        #expect(abs(camera.projection.fovY - 2 * atan(1 / 1.6)) < 1e-15)
        #expect(camera.viewState.viewportHeight == Int((camera.viewportPoints.y * camera.pixelsPerPoint).rounded()))
    }

    @Test func quaternionsCompose() {
        let a = Quat.axisAngle(Vec3(0, 1, 0), 0.7)
        let b = Quat.axisAngle(Vec3(1, 0, 0), -0.4)
        let v = Vec3(0.3, -0.2, 0.9)
        #expect((Quat.compose(a, b).act(v) - a.act(b.act(v))).length < 1e-12)
        #expect((a.inverted.act(a.act(v)) - v).length < 1e-12)
        let q = Quat.between(Vec3(0, 1, 0), Vec3(1, 1, 0).normalized)
        #expect((q.act(Vec3(0, 1, 0)) - Vec3(1, 1, 0).normalized).length < 1e-12)
        #expect((Quat.between(Vec3(0, 1, 0), Vec3(0, -1, 0)).act(Vec3(0, 1, 0)) - Vec3(0, -1, 0)).length < 1e-12)
    }

    /// Launch impulses give back the release velocity through the inverse inertia.
    @Test func launchImpulsesInvertToTheReleaseVelocity() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "caffeine")
        let b = try #require(sim.session.body(id))
        let w = Vec3(1.5, -2, 0.7)
        let impulses = launchImpulses(spec: b.spec, entityRotation: b.entityPose.rotation, linear: Vec3(0, 0, -3), angular: w)
        var world = StubWorld(floorY: -100)
        var spec = b.spec
        spec.mode = .dynamic
        world.apply([.create(id, spec, pose: b.entityPose), .launch(id, linearImpulse: impulses.linear, angularImpulse: impulses.angular)])
        let m = try #require(world.motions[id])
        #expect((m.linearVelocity - Vec3(0, 0, -3)).length < 1e-9)
        #expect((m.angularVelocity - w).length < 1e-9)
    }
}
