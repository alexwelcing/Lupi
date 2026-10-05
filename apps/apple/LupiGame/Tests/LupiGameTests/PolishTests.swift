import Foundation
import LupiChem
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

/// M4 (plan §8 M4): the flop, the cage ring, plaques with reasons, VoiceOver, the thermal
/// policy and the first-run card.
@Suite("polish")
struct PolishTests {
    @Test func tryptophanFlopsInThreeSegments() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "tryptophan")
        let recipes = try #require(sim.session.segmentRecipes(for: id))
        let whole = try #require(sim.session.meshRecipe(for: id))
        #expect(recipes.count == 3)
        // The segments drawn together are the whole: every atom once, every bond whole or as two stubs.
        #expect(recipes.map(\.atoms.count).reduce(0, +) == whole.atoms.count)
        #expect(recipes.map(\.stubs.count).reduce(0, +) == 2 * (recipes.count - 1))
        #expect(recipes.map(\.bonds.count).reduce(0, +) + recipes.count - 1 == whole.bonds.count)
        #expect(Set(recipes.map(\.key)).count == 3 && recipes.allSatisfy { $0.key.hasPrefix(whole.key + "#flop") })
        // Every part has geometry, stubs included.
        #expect(recipes.allSatisfy { !MeshBuilder.build($0).isEmpty })
        #expect(sim.last.renders[id]?.segments.count == 3)

        // Thrown at the wall, short of a break, it flops, then settles straight.
        sim.camera = Fixture.level
        sim.flick(id, points: 150)
        var bent = 0.0
        for _ in 0..<90 {
            sim.step()
            guard let poses = sim.last.renders[id]?.segments else { continue }
            for p in poses { bent = max(bent, 2 * acos(min(1, abs(p.rotation.w)))) }
        }
        #expect(bent > 0.1)
        sim.run(5)
        #expect(sim.breaks.isEmpty)
        let rest = try #require(sim.last.renders[id]?.segments)
        #expect(rest.allSatisfy { 2 * acos(min(1, abs($0.rotation.w))) < 0.01 })
    }

    @Test func theFlopSwitchesOffAndStiffMoleculesNeverFlop() throws {
        var sim = Fixture.sim()
        sim.session.debug.flop = false
        let off = Fixture.spawn(&sim, "tryptophan")
        #expect(sim.session.segmentRecipes(for: off) == nil)
        #expect(sim.last.renders[off]?.segments.isEmpty == true)
        sim.session.debug.flop = true
        let caffeine = Fixture.spawn(&sim, "caffeine")
        #expect(sim.session.segmentRecipes(for: caffeine) == nil)
    }

    @Test func aBuckyballRingsWhenItHitsTheWall() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "c60_buckyball")
        sim.camera = Fixture.level
        // A firm throw, short of the 6.5 m/s hit that chips a cage.
        sim.flick(id, points: 150)
        var rang = false
        var over = false, under = false
        for _ in 0..<90 {
            sim.step()
            if sim.last.juice.contains(where: { $0.body == id && $0.output.sounds.contains { if case .ring = $0.voice { true } else { false } } }) {
                rang = true
            }
            if let r = sim.last.renders[id] {
                if r.squash.y > 1.005 { over = true }
                if r.squash.y < 0.995 { under = true }
                #expect(abs(r.squash.x * r.squash.x * r.squash.y - 1) < 1e-9)
            }
        }
        #expect(rang)
        // It shivers: stretched and squashed in turn along the hit.
        #expect(over && under)
    }

    @Test func plaquesGiveTheReasonAndTheFeel() throws {
        var sim = Fixture.sim()
        let peroxide = Fixture.spawn(&sim, "hydrogen_peroxide")
        let p = try #require(sim.session.plaque(peroxide))
        #expect(p.personality == "Brittle: its O–O bond is weak (142 kJ/mol)")
        #expect(p.reasons == [p.personality])
        #expect(p.feel == "Cracks easily, and tinks like glass")
        let c60 = Fixture.spawn(&sim, "c60_buckyball")
        let bucky = try #require(sim.session.plaque(c60))
        #expect(bucky.personality == "Bouncy: a round cage of 60 carbons" && bucky.feel == "Bounces, and its cage rings")
    }

    @Test func voiceOverDescribesAndTosses() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "caffeine")
        let a = try #require(sim.session.accessibility(id))
        #expect(a.label == "Caffeine")
        #expect(a.value.hasPrefix("Rigid: two fused rings. Clacks like hard plastic. 24 atoms: 8 carbon, 10 hydrogen, 4 nitrogen, 2 oxygen."))
        #expect(a.value.hasSuffix("Resting."))
        #expect(a.actions == [.select, .toss, .keep])
        #expect(sim.session.accessibilitySummary == "1 in play: Caffeine.")
        let before = try #require(sim.session.body(id)).entityPose.translation
        let tossed = sim.session.toss(id)
        #expect(tossed)
        let out = sim.step()
        #expect(out.juice.contains { $0.output.sounds.contains { $0.voice == .whoosh } })
        sim.run(0.3)
        let after = try #require(sim.session.body(id)).entityPose.translation
        // Ahead of the camera (−z) and up.
        #expect(after.z < before.z - 0.2)
        // A googolplex is spoken, not spelled.
        var plex = Fixture.sim()
        plex.session.spawn(.scale(.salt(.googolplex)))
        plex.step()
        let bar = try #require(plex.session.bodyOrder.first)
        let words = try #require(plex.session.accessibility(bar)).value
        #expect(words.contains("10 to the power of 10 to the power of 100 atoms of bromine, chlorine and sodium."))
    }

    @Test func spokenCountsAndFormulas() {
        #expect(Spoken.count("1,000,000,000") == "1,000,000,000")
        #expect(Spoken.count("10^30") == "10 to the power of 30")
        #expect(Spoken.count("9 × 10^(10^100 − 1)") == "9 times 10 to the power of 10 to the power of 100 minus 1")
        #expect(Spoken.count("10^(10^100) − 1,000") == "10 to the power of 10 to the power of 100, minus 1,000")
        #expect(Spoken.formula("H2O") == "2 hydrogen, 1 oxygen")
        #expect(Spoken.formula("C2H6O") == "2 carbon, 6 hydrogen, 1 oxygen")
        #expect(Spoken.formula("ClNa", counts: false) == "chlorine and sodium")
    }

    @Test func theThermalPolicyDegradesInOrder() {
        var policy = ThermalPolicy()
        #expect(policy.update(.nominal, now: 0) == .full)
        let serious = policy.update(.serious, now: 1)
        #expect(serious.particles && serious.slowMotion && serious.frameRate == 60 && serious.toyLimit == 40)
        let critical = policy.update(.critical, now: 2)
        #expect(!critical.particles && !critical.slowMotion)
        // Without spike A5's toggle, the 30 fps step is skipped.
        #expect(critical.frameRate == 60)
        #expect(policy.update(.critical, now: 31).toyLimit == 40)
        #expect(policy.update(.critical, now: 32).toyLimit == ThermalTuning.criticalToys)
        #expect(policy.stage.line == "thermal critical, no particles, no slow motion, toys ≤ 24")
        // With it, 30 fps at critical, and 60 again only after ten cooler seconds.
        var a5 = ThermalPolicy(allowsThirtyFPS: true)
        #expect(a5.update(.critical, now: 0).frameRate == 30)
        #expect(a5.update(.serious, now: 1).frameRate == 30)
        #expect(a5.update(.serious, now: 10.9).frameRate == 30)
        #expect(a5.update(.fair, now: 11.1).frameRate == 60)
        #expect(a5.stage.particles && a5.stage.toyLimit == 40)
    }

    @Test func aCriticalDeviceDropsParticlesAndThenLoosePieces() throws {
        var sim = Fixture.sim()
        sim.session.debug.thermalOverride = .critical
        sim.session.debug.a5ThirtyFPS = true
        let peroxide = Fixture.spawn(&sim, "hydrogen_peroxide")
        #expect(sim.last.frameRate == 30)
        #expect(sim.last.hud.thermalLine.hasPrefix("thermal critical, 30 fps"))
        sim.camera = Fixture.level
        sim.flick(peroxide)
        var sparks = 0
        for _ in 0..<150 {
            sim.step()
            sparks += sim.last.juice.map(\.output.visual.sparks).reduce(0, +)
            #expect(!sim.last.juice.contains { $0.output.visual.slowMotion || $0.output.visual.flashRing })
        }
        let (_, pieces) = try #require(sim.breaks.first)
        #expect(pieces.count == 2)
        #expect(sparks == 0)
        // Fill the room to 25 toys with atoms; after 30 s at critical one loose piece poofs.
        sim.camera = Fixture.camera
        while sim.session.toys < 25 {
            sim.session.spawnAtom(6)
            sim.step()
        }
        sim.run(31)
        #expect(sim.session.toys == 24)
        #expect(pieces.filter { sim.session.body($0) != nil }.count == 1)
        // Atoms are whole molecules of their own: none of them poofed.
        #expect(sim.session.bodyOrder.compactMap { sim.session.body($0) }.filter { $0.brokenFrom == nil }.count == 23)
    }

    @Test func theFirstRunCardComesBeforeTheSystemPrompt() {
        #expect(Onboarding.card(camera: .notDetermined) == .camera)
        #expect(Onboarding.card(camera: .authorized) == nil)
        #expect(Onboarding.card(camera: .denied) == .cameraDenied)
        #expect(Onboarding.card(camera: .restricted) == .cameraRestricted)
        #expect(OnboardingCard.camera.action == "Continue" && OnboardingCard.cameraDenied.action == "Open Settings")
        #expect(OnboardingCard.cameraRestricted.action == nil)
        // The privacy promise is the Info.plist's, word for word.
        #expect(OnboardingCard.camera.body.contains { $0.hasPrefix("What the camera sees stays on this device.") })
    }
}
