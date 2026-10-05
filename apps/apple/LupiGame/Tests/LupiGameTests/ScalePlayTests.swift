import Foundation
import LupiChem
import LupiData
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

/// Life size, Grow ×2, chunks and chips (scale.md §5.5–§5.8, scale-spec §10.5–§10.7).
@Suite("scale play")
struct ScalePlayTests {
    /// The 10³⁰ rung at λ = 0 (scale.md §5.8): a 2.82 m cube standing on the floor ahead, 48.6 t.
    @Test func theLifeSizeCube() throws {
        var sim = Fixture.sim()
        let id = FlightTests.spawn(&sim, .salt(.e30))
        let span = try #require(sim.session.lifeSizeSpan(id))
        #expect(abs(span - 2.82) < 0.01)
        sim.session.lifeSize(id)
        sim.run(2.5)
        let b = try #require(sim.session.body(id))
        #expect(abs(b.span - span) < 1e-9 * span)
        #expect(abs(FlightTests.lambda(sim, id)) < 1e-9)
        #expect(sim.session.plaque(id)?.magnification == "life size")
        #expect(b.sizeState == .monument)
        #expect(b.mode == .kinematic)
        // On the floor, its near face 1.2 m from the camera.
        let box = b.worldBounds
        #expect(abs(box.min.y - 1.0) < 1e-6)
        let flat = Vec3(box.centre.x - sim.camera.position.x, 0, box.centre.z - sim.camera.position.z).length
        #expect(flat - span / 2 >= 1.2 - 1e-6)
        #expect(sim.events.contains(.lifeSize(id, mass: "48.6 t")))
        #expect(sim.session.trueMass(id) == "48.6 t")
        #expect(sim.budgetViolations.isEmpty)

        // Things that would not fit the room are refused, with their size.
        let plex = FlightTests.spawn(&sim, .salt(.googolplex))
        #expect(sim.session.lifeSizeSpan(plex) == nil)
        sim.session.lifeSize(plex)
        sim.step()
        #expect(sim.events.contains(.refused("Life size needs a body you can see whole")))
        let carat = FlightTests.spawn(&sim, .diamond)
        sim.session.lifeSize(carat)
        sim.step()
        #expect(sim.events.contains(.refused("At life size this is 3.8 mm: it would not fit the room")))
    }

    /// Grow ×2 (scale-spec §10.7, §12.4): off by default; on, a water grows into the spec's
    /// records, keeps its span, and a hundred taps make 3 × 2^100 atoms that keep and come back.
    @Test func growingAWaterAHundredTimes() throws {
        var off = Fixture.sim()
        let w0 = Fixture.spawn(&off, "water")
        off.session.grow(w0)
        off.step()
        #expect(off.events.contains(.refused("Grow ×2 is off: turn it on in Settings")))
        #expect(!off.session.canGrow(w0))

        var sim = Fixture.sim(GameSettings(growTwo: true))
        let id = Fixture.spawn(&sim, "water")
        let span = try #require(sim.session.body(id)).span
        #expect(sim.session.canGrow(id))
        sim.session.grow(id)
        sim.step()
        var b = try #require(sim.session.body(id))
        #expect(b.identity.root.hex == "9a0d1fadcc862005945fb3a802e644fcb96ab88b7beccd45de8d2bb7889f8ddf")
        #expect(sim.events.contains(.grew(id, count: "6")))
        #expect(b.name == "Water, grown")
        for _ in 1..<100 { sim.session.grow(id) }
        sim.run(1)
        b = try #require(sim.session.body(id))
        #expect(b.identity.root.hex == "56f05f1af0f47e8b00834c5742f6e6e7b4ad7a1f63b31cadb476ed79a5610aac")
        #expect(b.facts.count.formatted == "3 × 2^100")
        #expect(abs(b.span - span) < 1e-9)
        #expect(b.sizeState == .toy)
        #expect(b.feltMassKg > 0.5)
        #expect(sim.budgetViolations.isEmpty)
        // Kept, it is 123 bytes of tower over the 56-byte water, and comes back the same.
        let record = try sim.session.keep(id, now: Date(timeIntervalSince1970: 1_790_000_000))
        #expect(record.molecule.source == .scale)
        let piece = try Restore.piece(record, catalog: Fixture.catalog, store: GameStore())
        #expect(piece.count.formatted == "3 × 2^100")
        #expect(piece.identity.root == b.identity.root)

        // Caffeine's first tap is §12.4's.
        let caffeine = Fixture.spawn(&sim, "caffeine")
        sim.session.grow(caffeine)
        sim.step()
        #expect(sim.session.body(caffeine)?.identity.root.hex == "5a9910437443a8940531924ebba289e763528199483fccd6c56ff690c0173358")
    }

    /// The camera 2 m back from a body, looking at its centre.
    static func stepBack(_ sim: inout Simulation, from id: BodyID) {
        let c = sim.session.body(id)!.entityPose.translation
        sim.camera = CameraState.looking(from: c + Vec3(0, 0.6, 2.0), at: c)
        sim.step()
    }

    /// A chunk (§10.5): one finger dragged on a monument takes a node 4 to 40 cm across, already
    /// in the hand; the monument keeps the rest as an edit, and the counts add up exactly.
    @Test func aChunkComesAwayInTheHand() throws {
        var sim = Fixture.sim()
        let id = FlightTests.spawn(&sim, .copper(closed: false))
        sim.pinch(id, ratio: 12, over: 0.8)
        sim.run(0.5)
        var b = try #require(sim.session.body(id))
        #expect(b.sizeState == .monument)
        // Grown on the desk it stands around the phone; step back 2 m to see it whole.
        Self.stepBack(&sim, from: id)
        let total = b.facts.count
        let before = sim.events.count
        let finger = sim.drag(id, by: SIMD2(0, -40), over: 0.15)
        #expect(finger > 0)
        let detached = sim.events.dropFirst(before).compactMap { e -> BodyID? in
            if case let .detached(from, piece) = e, from == id { return piece }
            return nil
        }
        let piece = try #require(detached.first)
        let p = try #require(sim.session.body(piece))
        #expect(p.sizeState == .toy)
        #expect(p.span >= 0.04 * 0.5 && p.span <= 0.40)
        #expect(!p.identity.path.isEmpty)
        #expect(p.name == "Chunk of Copper, a billion atoms")
        b = try #require(sim.session.body(id))
        #expect(b.identity.root != p.identity.root)
        #expect(try (b.facts.count + p.facts.count) == total)
        sim.run(1)
        #expect(sim.session.body(piece)?.mode == .dynamic)
        #expect(sim.budgetViolations.isEmpty)
    }

    /// A chip (§10.5): held 400 ms, then pulled, a node 1 to 5 cm across comes away.
    @Test func aChipComesAwayAfterAHold() throws {
        var sim = Fixture.sim()
        let id = FlightTests.spawn(&sim, .copper(closed: false))
        sim.pinch(id, ratio: 12, over: 0.8)
        sim.run(0.5)
        Self.stepBack(&sim, from: id)
        let before = sim.events.count
        sim.drag(id, by: SIMD2(0, -40), over: 0.15, holdFirst: 0.45)
        let piece = try #require(sim.events.dropFirst(before).compactMap { e -> BodyID? in
            if case let .detached(_, piece) = e { return piece }
            return nil
        }.first)
        let p = try #require(sim.session.body(piece))
        #expect(p.span <= 0.05)
        #expect(p.name == "Chip of Copper, a billion atoms")
    }

    /// The grain (scale.md §3.4): with the googolplex's ions a centimetre across, a chunk under the
    /// screen's centre is one seed copy of 1,000 ions, and the bar keeps 10^(10^100) − 1,000.
    @Test func aGrainOfTheGoogolplex() throws {
        var sim = Fixture.sim()
        sim.dt = 1.0 / 30
        let id = FlightTests.spawn(&sim, .salt(.googolplex))
        sim.session.dive(into: id, ionDiameter: 0.01)
        _ = FlightTests.fly(&sim, limit: 40)
        let before = sim.events.count
        sim.drag(at: SIMD2(195, 422), by: SIMD2(0, -40), over: 0.15)
        let piece = try #require(sim.events.dropFirst(before).compactMap { e -> BodyID? in
            if case let .detached(_, piece) = e { return piece }
            return nil
        }.first)
        let p = try #require(sim.session.body(piece))
        #expect(p.facts.count.formatted == "1,000")
        #expect(p.facts.formula == "BrCl499Na500")
        #expect(sim.session.body(id)?.facts.count.formatted == "10^(10^100) − 1,000")
        // Kept, the grain is a few hundred bytes and needs nothing but itself.
        let record = try sim.session.keep(piece, now: Date(timeIntervalSince1970: 1_790_000_000))
        let ref = try ScaleRef(text: try #require(record.molecule.scale).ref)
        #expect(try ref.encoded().count < 600)
        #expect(try ref.resolve(extra: nil).count.formatted == "1,000")
        #expect(sim.budgetViolations.isEmpty)
    }
}

extension Simulation {
    /// One finger down at a screen point, dragged by `delta`, then lifted.
    @discardableResult
    mutating func drag(at start: SIMD2<Double>, by delta: SIMD2<Double>, over duration: Double, holdFirst: Double = 0) -> Int {
        let finger = touch()
        step(touches: [TouchSample(id: finger, phase: .began, location: start, time: time + dt)])
        var held = 0.0
        while held < holdFirst {
            step(touches: [TouchSample(id: finger, phase: .moved, location: start, time: time + dt)])
            held += dt
        }
        let n = max(1, Int((duration / dt).rounded()))
        var location = start
        for k in 1...n {
            location = start + delta * (Double(k) / Double(n))
            step(touches: [TouchSample(id: finger, phase: .moved, location: location, time: time + dt)])
        }
        step(touches: [TouchSample(id: finger, phase: .ended, location: location, time: time + dt)])
        return finger
    }
}
