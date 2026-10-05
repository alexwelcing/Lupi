import Foundation
import Testing
import LupiChem
@testable import LupiPlay

@Suite("flop and ring")
struct FlopTests {
    static func segments(_ name: String) throws -> (Molecule, FlopSegments?) {
        let m = try PlayFixtures.molecule(name)
        return (m, FlopSegments.of(m, graph: BondGraph.forPlay(m)))
    }

    @Test func flexibleMoleculesSplitAtRotatingBonds() throws {
        for name in ["cholesterol", "atp", "sucrose", "lsd"] {
            let (m, found) = try Self.segments(name)
            let s = try #require(found, "\(name)")
            #expect((2...4).contains(s.count), "\(name)")
            // Every atom in exactly one segment; parents come first; each hinge is a rotating bond.
            #expect(s.segmentOfAtom.count == m.count)
            #expect(Set(s.segments.flatMap(\.atoms)).count == m.count)
            #expect(s.segments[0].parent == nil)
            let graph = BondGraph.forPlay(m)
            let rotors = Set(MolecularFeatures.rotatableBonds(in: m, graph: graph))
            for (i, seg) in s.segments.enumerated().dropFirst() {
                let parent = try #require(seg.parent)
                #expect(parent < i)
                let hinge = try #require(seg.hinge)
                #expect(rotors.contains(hinge), "\(name)")
                let b = graph.bonds[hinge]
                // The hinge joins this segment to its parent, and the pivot is its midpoint.
                #expect(Set([s.segmentOfAtom[b.i], s.segmentOfAtom[b.j]]) == Set([i, parent]))
                #expect((seg.pivot - 0.5 * (m.position(b.i) + m.position(b.j))).length < 1e-12)
                #expect(seg.atoms.filter { m.atomicNumbers[$0] != 1 }.count >= FlopSegments.minHeavyAtoms)
            }
            // The root is the heaviest.
            #expect(s.segments.dropFirst().allSatisfy { $0.mass <= s.segments[0].mass })
        }
    }

    @Test func stiffMoleculesDoNotFlop() throws {
        for name in ["caffeine", "benzene", "water", "c60_buckyball"] {
            #expect(try Self.segments(name).1 == nil, "\(name)")
        }
    }

    @Test func segmentationIsDeterministic() throws {
        let a = try #require(try Self.segments("atp").1)
        let b = try #require(try Self.segments("atp").1)
        #expect(a == b)
    }

    @Test func aHitSwingsTheSegmentsAndTheySettle() throws {
        let s = try #require(try Self.segments("cholesterol").1)
        var flop = Flop(s)
        #expect(flop.isAtRest)
        #expect(flop.poses().allSatisfy { $0 == .identity })
        flop.kick(direction: Vec3(0, 0, 1), amount: 1, rotation: .identity)
        var peak = 0.0
        var swungBack = false
        var last = 0.0
        for k in 0..<240 {
            flop.step(dt: 1.0 / 60, velocity: .zero, rotation: .identity, metresPerAngstrom: 0.01)
            peak = max(peak, flop.largestAngle)
            if k > 5, flop.largestAngle < last { swungBack = true }
            last = flop.largestAngle
        }
        // It visibly swings, never past its stop, wobbles back and is still after four seconds.
        #expect(peak > 0.15)
        #expect(peak <= Flop.Tuning().maxAngle + 1e-12)
        #expect(swungBack)
        #expect(flop.isAtRest)
        // A child of the root turns about its pivot: the pivot stays put.
        var pushed = Flop(s)
        pushed.kick(direction: Vec3(1, 0, 0), amount: 1, rotation: .identity)
        for _ in 0..<6 { pushed.step(dt: 1.0 / 60, velocity: .zero, rotation: .identity, metresPerAngstrom: 0.01) }
        let poses = pushed.poses()
        for (i, seg) in s.segments.enumerated() where seg.parent == 0 {
            #expect((poses[i].apply(seg.pivot) - seg.pivot).length < 1e-9)
            #expect(poses[i] != .identity)
        }
    }

    @Test func steadyPushesDoNotSagIt() throws {
        let s = try #require(try Self.segments("atp").1)
        // Resting on a table and falling freely are both steady: nothing swings.
        var resting = Flop(s)
        var falling = Flop(s)
        var v = Vec3.zero
        for _ in 0..<120 {
            resting.step(dt: 1.0 / 60, velocity: .zero, rotation: .identity, metresPerAngstrom: 0.01)
            v += Vec3(0, -9.81, 0) / 60
            falling.step(dt: 1.0 / 60, velocity: v, rotation: .identity, metresPerAngstrom: 0.01)
        }
        #expect(resting.largestAngle < 1e-9)
        #expect(falling.largestAngle < 1e-6)
        // A landing (the fall stops at once) swings it.
        falling.step(dt: 1.0 / 60, velocity: .zero, rotation: .identity, metresPerAngstrom: 0.01)
        for _ in 0..<10 { falling.step(dt: 1.0 / 60, velocity: .zero, rotation: .identity, metresPerAngstrom: 0.01) }
        #expect(falling.largestAngle > 0.05)
    }

    @Test func stillComfortKeepsItStraight() throws {
        let s = try #require(try Self.segments("cholesterol").1)
        var flop = Flop(s)
        flop.kick(direction: Vec3(0, 1, 0), amount: 0, rotation: .identity)
        for k in 0..<30 {
            flop.step(dt: 1.0 / 60, velocity: Vec3(0, 0, k == 10 ? 3 : 0), rotation: .identity, metresPerAngstrom: 0.01, scale: 0)
        }
        #expect(flop.isAtRest)
    }

    @Test func aCageRingsAndFades() {
        var ring = CageRing()
        #expect(ring.isAtRest && ring.value == 0)
        ring.hit(direction: Vec3(0, 1, 0), amount: 1)
        // It starts squashed by the hit, then stretches half a period later.
        #expect(abs(ring.value - CageRing.largest) < 1e-12)
        var signs: Set<Bool> = []
        for _ in 0..<12 {
            ring.step(dt: 1.0 / 60)
            signs.insert(ring.value > 0)
        }
        #expect(signs == [true, false])
        // A weaker hit while it rings is ignored; a bigger one restarts it.
        let before = ring.value
        ring.hit(direction: Vec3(1, 0, 0), amount: 0.01)
        #expect(ring.value == before && ring.axis == Vec3(0, 1, 0))
        for _ in 0..<120 { ring.step(dt: 1.0 / 60) }
        #expect(ring.isAtRest)
    }
}

@Suite("personality juice")
struct PersonalityJuiceTests {
    static func body(_ name: String, segments: Int = 0) throws -> (PersonalityDerivation, JuiceBody) {
        let d = Personality.derive(try PlayFixtures.molecule(name))
        let p = d.personality
        return (d, JuiceBody(id: 1, kind: p.kind, hapticSharpness: p.hapticSharpness, span: 0.15, heft: 0.6,
                             timbre: Timbre.of(d, segments: segments)))
    }

    @Test func timbresFollowThePersonality() throws {
        let c60 = try Self.body("c60_buckyball").0
        #expect(Timbre.of(c60).rings && Timbre.of(c60).flaps == 0)
        let cholesterol = try Self.body("cholesterol").0
        #expect(Timbre.of(cholesterol, segments: 3).flaps == 2)
        #expect(Timbre.of(cholesterol).flaps == 2)
        #expect(Timbre.of(cholesterol).pitch < 1)
        let salt = try Self.body("salt-cube").0
        #expect(Timbre.of(salt).nearBreak == salt.personality.breakSpeed && Timbre.of(salt).pitch > 1)
        let benzene = try Self.body("benzene").0
        #expect(Timbre.of(benzene).pitch > Timbre.of(try Self.body("water").0).pitch)
        #expect(!Timbre.of(try Self.body("methane").0).rings)
    }

    @Test func aCageRings() throws {
        var juice = JuiceDirector(seed: 3)
        let (_, c60) = try Self.body("c60_buckyball")
        let out = try juice.must(.impact(deltaV: 2, surface: .wall), body: c60, at: 1)
        let ring = try #require(out.sounds.first { if case .ring = $0.voice { true } else { false } })
        #expect(ring.delay > 0 && ring.rate == out.sounds[0].rate)
        #expect(out.visual.cageRing == 1)
        #expect(out.haptics.contains { if case let .continuous(_, d, _, _, s) = $0 { d == 0.25 && s == 0.9 } else { false } })
        // A tap too soft to ring.
        let soft = try juice.must(.impact(deltaV: 0.02, surface: .wall), body: JuiceBody(id: 2, kind: .bouncy, hapticSharpness: 0.5, span: 0.15, heft: 0.6, timbre: c60.timbre), at: 2)
        #expect(!soft.sounds.contains { if case .ring = $0.voice { true } else { false } })
    }

    @Test func flexibleEndsFlapAfterTheHit() throws {
        var juice = JuiceDirector(seed: 5)
        let (_, chol) = try Self.body("cholesterol", segments: 4)
        let out = try juice.must(.impact(deltaV: 2, surface: .floor), body: chol, at: 1)
        let flaps = out.sounds.filter { $0.voice == .flap }
        #expect(flaps.count == 3)
        #expect(zip(flaps, flaps.dropFirst()).allSatisfy { $0.delay < $1.delay && $0.gain > $1.gain })
        #expect(flaps.allSatisfy { $0.delay >= 0.04 })
        #expect(out.visual.flop == 1)
        #expect(out.sounds[0].voice == .impact(.thwap, .medium, .hard))
    }

    @Test func brittleCrackleNearTheBreak() throws {
        var juice = JuiceDirector(seed: 7)
        let (d, salt) = try Self.body("salt-cube")
        let b = d.personality.breakSpeed
        let near = try juice.must(.impact(deltaV: 0.8 * b, surface: .table), body: salt, at: 1)
        #expect(near.sounds.contains { $0.voice == .crackle } && near.visual.crackled)
        let far = try juice.must(.impact(deltaV: 0.3 * b, surface: .table), body: salt, at: 2)
        #expect(!far.sounds.contains { $0.voice == .crackle })
    }

    @Test func comfortQuietsTheMotionNotTheSound() throws {
        func hit(_ comfort: MotionComfort, _ name: String) throws -> JuiceOutput {
            var juice = JuiceDirector(settings: JuiceSettings(comfort: comfort), seed: 4)
            return try juice.must(.impact(deltaV: 2, surface: .wall), body: try Self.body(name, segments: 3).1, at: 3)
        }
        for name in ["c60_buckyball", "cholesterol"] {
            let standard = try hit(.standard, name), gentle = try hit(.gentle, name), still = try hit(.still, name)
            #expect(standard.sounds == still.sounds && standard.haptics == still.haptics, "\(name)")
            #expect(max(standard.visual.cageRing, standard.visual.flop) == 1, "\(name)")
            #expect(max(gentle.visual.cageRing, gentle.visual.flop) == 0.5, "\(name)")
            #expect(still.visual.cageRing == 0 && still.visual.flop == 0, "\(name)")
        }
    }
}
