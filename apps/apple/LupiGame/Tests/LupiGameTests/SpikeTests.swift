import Foundation
import LupiChem
import LupiGame
import LupiGameSim
import Testing

/// Spike A3's toss on the stand-in physics, which has no gyroscopic terms: the body flies and
/// lands, and its axis never turns over, which is the failure the spike looks for on device.
@Suite("device spikes")
struct SpikeTests {
    @Test func theTumbleTossFliesLandsAndCountsNoFlipWithoutGyroscopicTerms() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "caffeine")
        let restY = try #require(sim.session.body(id)).entityPose.translation.y
        let tossed = sim.session.tumbleTest(id)
        #expect(tossed)
        var peak = restY
        sim.run(0.3)
        let t = try #require(sim.session.tumble)
        #expect(!t.finished)
        peak = max(peak, try #require(sim.session.body(id)).entityPose.translation.y)
        #expect(peak > restY + 0.5)
        let landed = sim.run(until: 3.5) { $0.session.tumble?.finished == true }
        #expect(landed)
        let done = try #require(sim.session.tumble)
        #expect(done.flips == 0)
        #expect(done.minDot > 0.9)
        #expect(done.seconds > 0.6 && done.seconds < 1.2)
        // Its damping comes back once it lands.
        let restore = sim.last.physics.contains {
            if case let .setDamping(b, l, _) = $0 { return b == id && l > 0 }
            return false
        }
        #expect(restore)
    }

    @Test func aTumbleNeedsAnAsymmetricTop() {
        var sim = Fixture.sim()
        // Methane is a spherical top: no intermediate axis to flip about.
        let id = Fixture.spawn(&sim, "methane")
        let tossed = sim.session.tumbleTest(id)
        #expect(!tossed)
        sim.step()
        #expect(sim.events.contains(.refused("A3 needs an asymmetric top")))
    }
}
