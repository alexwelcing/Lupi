import Foundation
import LupiChem
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

/// The play session on the stand-in physics: spawn, grab, throw, break, juice and budgets.
@Suite("play session")
struct SessionTests {
    // MARK: Spawn

    @Test func aSpawnPopsInFloatsThenLandsAndSettles() throws {
        var sim = Fixture.sim()
        sim.session.spawn(.starter("caffeine"))
        let first = sim.step()
        let id = try #require(sim.session.bodyOrder.first)
        // Created at rest, kinematic while it pops in, with the spawn cue.
        guard case let .create(created, spec, _)? = first.physics.first else {
            Issue.record("no create")
            return
        }
        #expect(created == id)
        #expect(spec.mode == .kinematic)
        #expect(!spec.shapes.isEmpty && spec.shapes.count <= 48)
        #expect(first.juice.first?.output.sounds.first?.voice == .pop)
        #expect(first.renders[id]!.scale < 0.5)
        // It spans 15 cm (plan §4.1) and weighs its felt mass (scale-spec §10.2).
        let b = try #require(sim.session.body(id))
        #expect(abs(b.span - 0.15) < 1e-9)
        #expect(abs(b.feltMassKg - FeltMass.kg(b.facts.massLog, massScale: b.facts.personality.personality.massScale)) < 1e-12)
        sim.run(2)
        let landed = try #require(sim.session.body(id))
        #expect(landed.mode == .dynamic)
        #expect(sim.last.renders[id]!.scale > 0.99)
        #expect(abs(landed.worldBounds.min.y - 1.0) < 0.02)
        // Settling plays once and raises damping (plan §4.6).
        sim.run(1)
        #expect(sim.session.body(id)!.atRest)
        #expect(sim.cues.filter { $0.output.sounds.first?.voice == .tock }.count == 1)
    }

    @Test func spawnsComeOnePerFrame() {
        var sim = Fixture.sim()
        sim.session.spawnReceipt()
        sim.step()
        #expect(sim.session.bodyOrder.count == 1)
        sim.step()
        sim.step()
        #expect(sim.session.bodyOrder.count == 3)
        #expect(sim.last.hud.totalAtoms == "1,001,001,000")
    }

    // MARK: Grab and throw (plan §3.5)

    @Test func aFlickThrowsTowardTheWallAndItHits() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "benzene")
        sim.camera = Fixture.level
        sim.flick(id)
        let b = try #require(sim.session.body(id))
        #expect(b.mode == .dynamic)
        let v = b.motion.linearVelocity
        #expect(v.z < -4)
        #expect(v.length <= ThrowTuning.maxSpeed + 1e-9)
        #expect(sim.cues.contains { $0.output.sounds.first?.voice == .tick })
        #expect(sim.cues.contains { $0.output.sounds.first?.voice == .whoosh })
        guard case .launch? = sim.world.lastLaunch(id) else {
            Issue.record("no launch")
            return
        }
        // The wall answers: a clack, a thud, sparks, squash.
        let before = sim.cues.count
        sim.run(1)
        let hits = sim.cues[before...].filter { cue in cue.output.sounds.contains { $0.voice == .thud } && cue.direction.z > 0.9 }
        let hit = try #require(hits.first)
        #expect(hit.output.intensity > 0.6)
        #expect(hit.output.visual.sparks > 6)
        #expect(!hit.output.haptics.isEmpty)
        #expect(!hit.sparkColours.isEmpty)
    }

    @Test func aHeldBodyFollowsTheFingerAndASlowReleaseSetsItDown() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        let start = try #require(sim.screenPoint(of: id))
        let finger = sim.touch()
        sim.step(touches: [TouchSample(id: finger, phase: .began, location: start, time: sim.time + sim.dt)])
        for k in 1...20 {
            sim.step(touches: [TouchSample(id: finger, phase: .moved, location: start + SIMD2(Double(k) * 3, 0), time: sim.time + sim.dt)])
        }
        #expect(sim.session.body(id)!.mode == .kinematic)
        #expect(sim.last.physics.contains { if case .move(id, _, _, _) = $0 { return true }; return false })
        // Held still, then lifted after the 60 ms pause: set down, not thrown.
        for _ in 0..<10 { sim.step() }
        let end = start + SIMD2(60, 0)
        sim.step(touches: [TouchSample(id: finger, phase: .ended, location: end, time: sim.time + sim.dt)])
        #expect(sim.session.body(id)!.mode == .dynamic)
        #expect(sim.world.lastLaunch(id) == nil)
        #expect(!sim.cues.contains { $0.output.sounds.first?.voice == .whoosh })
    }

    // MARK: Breaking (plan §4.4, scale-spec §10.6)

    @Test func hydrogenPeroxideCracksIntoTwoHydroxyls() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "hydrogen_peroxide")
        let parent = try #require(sim.session.body(id))
        #expect(parent.facts.personality.personality.kind == .brittle)
        sim.camera = Fixture.level
        sim.flick(id)
        sim.run(0.6)
        let (broken, pieces) = try #require(sim.breaks.first)
        #expect(broken == id)
        #expect(pieces.count == 2)
        #expect(sim.session.body(id) == nil)
        let fragments = try pieces.map { try #require(sim.session.body($0)) }
        #expect(fragments.map(\.facts.formula).sorted() == ["HO", "HO"])
        #expect(fragments.allSatisfy { $0.brokenFrom == "Hydrogen peroxide" && $0.facts.isMolecule })
        // Each fragment's identity is the peroxide's leaf plus one atoms step.
        for f in fragments {
            #expect(f.identity.root == parent.identity.root)
            #expect(f.identity.path.steps.count == 1)
            #expect(try f.identity.resolve(extra: nil).count.formatted == "2")
        }
        // Break juice: the shatter layer and 60 sparks in Standard.
        let crack = try #require(sim.cues.first { $0.output.sounds.contains { $0.voice == .shatter } })
        #expect(crack.output.visual.sparks == 60)
        #expect(crack.output.visual.slowMotion || crack.output.visual.hitStop)
    }

    /// Pieces leave with the parent's velocity at their centre plus 0.4 m/s outward (scale-spec §10.6).
    @Test func piecesInheritVelocityAndAnOutwardKick() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "hydrogen_peroxide")
        let parentBody = try #require(sim.session.body(id))
        // Lift it and drive it into the desk.
        sim.world.apply([
            .move(id, pose: RigidD(rotation: parentBody.entityPose.rotation, translation: parentBody.entityPose.translation + Vec3(0, 0.2, 0)),
                  linearVelocity: .zero, angularVelocity: .zero),
            .setVelocity(id, linear: Vec3(0.5, -6, 0), angular: Vec3(0, 2, 0)),
        ])
        #expect(sim.run(until: 0.5) { !$0.breaks.isEmpty })
        let (_, pieces) = try #require(sim.breaks.first)
        let parent = try #require(sim.lastInput?.bodies[id])
        let com = parent.pose.apply(parentBody.spec.centreOfMass)
        let fragments = try pieces.map { try #require(sim.session.body($0)) }
        let kicks = fragments.map { f in
            f.motion.linearVelocity - parent.linearVelocity - parent.angularVelocity.cross(f.entityPose.translation - com)
        }
        #expect(kicks.allSatisfy { abs($0.length - 0.4) < 1e-9 })
        #expect(kicks[0].dot(kicks[1]) < 0)
        #expect(fragments.allSatisfy { ($0.motion.angularVelocity - parent.angularVelocity).length < 1e-12 })
        // Fresh pieces start inset, and cannot break again for 0.25 s.
        #expect(fragments.allSatisfy { $0.insetUntil > sim.time && $0.breakableAfter >= sim.time + 0.2 })
    }

    /// A thrown 10⁹ salt crystal smashes into its ten children, which share its felt mass.
    @Test func aBillionAtomCrystalExpandsIntoTenPieces() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawnSalt(&sim, .billion)
        let parent = try #require(sim.session.body(id))
        #expect(parent.facts.count.formatted == "1,000,000,000")
        #expect(parent.facts.personality.personality.kind == .brittle)
        sim.camera = Fixture.level
        sim.flick(id, points: 400)
        sim.run(0.6)
        let (_, pieces) = try #require(sim.breaks.first)
        #expect(pieces.count == 10)
        let bodies = try pieces.map { try #require(sim.session.body($0)) }
        #expect(bodies.allSatisfy { $0.facts.count.formatted == "100,000,000" })
        #expect(bodies.allSatisfy { abs($0.feltMassKg - max(0.06, parent.feltMassKg / 10)) < 1e-9 })
        // Every piece is a step below the rung: exact identity whatever the contact point.
        #expect(bodies.allSatisfy { $0.identity.root == parent.identity.root && $0.identity.path.steps.count == 1 })
        // Each is at least 6 cm once grown, a toy.
        sim.run(0.5)
        #expect(pieces.compactMap { sim.session.body($0) }.allSatisfy { $0.span >= 0.06 - 1e-6 && $0.isToy })
        #expect(sim.last.hud.totalAtoms == "1,000,000,000")
    }

    @Test func aDropOnTheDeskNeverBreaksAFreshSpawn() {
        var sim = Fixture.sim()
        _ = Fixture.spawn(&sim, "hydrogen_peroxide", settle: 3)
        #expect(sim.breaks.isEmpty)
        #expect(sim.session.bodyOrder.count == 1)
    }

    // MARK: Juice settings (plan §5.1, §5.5)

    @Test func soundAndHapticsOffKeepsTheVisuals() throws {
        var sim = Fixture.sim(GameSettings(soundAndHaptics: false))
        let id = Fixture.spawn(&sim, "benzene")
        sim.camera = Fixture.level
        sim.flick(id)
        sim.run(1)
        #expect(!sim.cues.isEmpty)
        #expect(sim.cues.allSatisfy { $0.output.sounds.isEmpty && $0.output.haptics.isEmpty })
        #expect(sim.cues.contains { $0.output.visual.sparks > 0 })
    }

    @Test func stillComfortCapsTheThrowAndDropsMotion() throws {
        var sim = Fixture.sim(GameSettings(comfort: .still))
        let id = Fixture.spawn(&sim, "benzene")
        sim.camera = Fixture.level
        sim.flick(id)
        #expect(sim.session.body(id)!.motion.linearVelocity.length <= 1.5 + 1e-9)
        sim.run(1.5)
        #expect(sim.cues.allSatisfy { $0.output.visual.sparks == 0 && $0.output.visual.squash == 0 && !$0.output.visual.hitStop })
        #expect(sim.cues.contains { $0.output.visual.flashRing })
        #expect(sim.last.simulationRate == 1)
    }

    @Test func noHapticsOnIPad() throws {
        var sim = Fixture.sim(GameSettings(supportsHaptics: false, device: .iPad))
        let id = Fixture.spawn(&sim, "benzene")
        sim.camera = Fixture.level
        sim.flick(id)
        sim.run(1)
        #expect(sim.cues.allSatisfy { $0.output.haptics.isEmpty })
        #expect(sim.cues.contains { !$0.output.sounds.isEmpty })
    }

    // MARK: Budgets (plan §3.4, scale-spec §9.3)

    @Test func atMostFortyToysTheOldestPoofs() {
        var sim = Fixture.sim()
        for _ in 0..<45 { sim.session.spawn(.starter("water")) }
        sim.run(1)
        #expect(sim.session.toys == PlayTuning.maxDynamicBodies)
        let poofs = sim.events.filter { if case .removed(_, true) = $0 { return true }; return false }
        #expect(poofs.count == 5)
        // The first spawns went first.
        #expect(!sim.session.bodyOrder.contains(BodyID(1)))
    }

    @Test func aBodyThatFallsOutOfTheRoomPoofs() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "water")
        sim.world.apply([.move(id, pose: RigidD(translation: Vec3(7, 1.1, -1)), linearVelocity: .zero, angularVelocity: .zero)])
        sim.step()
        #expect(sim.session.body(id) == nil)
        #expect(sim.events.contains(.removed(id, poof: true)))
    }

    @Test func everyFrameOfTheReceiptKeepsItsBudgets() {
        var sim = Fixture.sim()
        sim.session.spawnReceipt()
        sim.run(3)
        #expect(sim.budgetViolations.isEmpty)
        #expect(sim.last.cut != nil)
        #expect(sim.last.hud.items > 0)
        #expect(sim.last.hud.totalAtoms == "1,001,001,000")
        // Hot devices get tighter budgets, and the cut keeps them too.
        sim.thermal = .critical
        sim.run(1)
        #expect(sim.budgetViolations.isEmpty)
        #expect(sim.last.hud.thermal == .critical)
    }

    /// Requests between frames reach the next frame's output.
    @Test func clearingBetweenFramesRemovesEveryBody() {
        var sim = Fixture.sim()
        sim.session.spawn(.starter("water"))
        sim.session.spawn(.starter("benzene"))
        sim.run(0.5)
        #expect(sim.session.bodyOrder.count == 2)
        sim.session.clear()
        let out = sim.step()
        #expect(sim.session.bodyOrder.isEmpty)
        #expect(out.physics.filter { if case .remove(_, true) = $0 { return true }; return false }.count == 2)
        #expect(sim.world.bodies.isEmpty)
        #expect(out.hud.totalAtoms == "0")
    }

    // MARK: Determinism

    @Test func theSameInputsGiveTheSameGame() throws {
        func play() -> [String] {
            var sim = Fixture.sim()
            let id = Fixture.spawn(&sim, "hydrogen_peroxide")
            sim.camera = Fixture.level
            sim.flick(id)
            sim.run(1)
            return sim.events.map { "\($0)" } + sim.cues.map { "\($0.output.sounds.map(\.voice.name)) \($0.output.intensity)" }
                + sim.session.bodyOrder.map { "\($0) \(sim.session.body($0)!.entityPose.translation)" }
        }
        #expect(play() == play())
    }
}

extension StubWorld {
    /// The last launch command the world applied to a body.
    func lastLaunch(_ id: BodyID) -> PhysicsCommand? { launches[id] }
}
