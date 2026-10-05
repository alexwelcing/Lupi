import Foundation
import Testing
import LupiChem
@testable import LupiPlay

/// The web's motion code (`packages/core/src/motion`, over math's spring-core)
/// on the same inputs: settle times, step responses and a spring stepped at
/// uneven frame times with a target change after the third step.
private let webMotion = #"""
{"snap":{"settle":0.2308353369112912,"step":[0.1912078645890012,0.9084218055563291,0.9999201252394068],"seq":[0.13524042456940033,13.498686055502043,0.5830590740737068,11.043300200209927,0.664507801973037,9.328319652457017,-0.37627106466043286,-3.92515510402753,-0.4277919248525807,-2.363283210212689,-0.4866748792249835,-0.4619484215412628]},"glide":{"settle":0.5540048085870988,"step":[0.04462491923494771,0.49633172576650186,0.9595723180054871],"seq":[0.0298241047381117,3.404125948287328,0.19721098592144576,6.014780074900484,0.24585500426372275,6.123399538029602,-0.008680419258013508,-4.684202007210472,-0.08374364364779766,-4.284575773995908,-0.26144562540392885,-2.8229040863534514]},"click":{"settle":0.4629903610466788,"step":[0.07983937978300837,0.7965517150779176,1.0087499794314354],"seq":[0.0533609287062764,6.094344834458308,0.3465912708082075,10.187204939936867,0.42785446181306264,10.079577884642987,-0.177186745257233,-8.212899845336821,-0.30035472972554034,-6.515806799645066,-0.5060410929913349,-2.042450486330954]},"land":{"settle":0.49991603812293056,"step":[0.043542714362796664,0.5546637059557282,1.0283403586602173],"seq":[0.028793706934379548,3.3643259991578307,0.20543125471474544,6.659304526740055,0.2598749089917026,6.924544843159597,0.010154284398174201,-5.86337036389058,-0.08547733176656355,-5.542880825046623,-0.3185031135086498,-3.662689461790297]},"boing":{"settle":0.9136099682070258,"step":[0.04993748747175586,0.7238946489253544,1.077290771662103],"seq":[0.03268272040367992,3.9047161540039754,0.25116049954797004,8.61161123027453,0.32227667785073816,9.130706964068384,0.015832103191432245,-9.035355055297758,-0.13422352105237326,-8.828005083587483,-0.505389165666669,-5.570508754889001]},"settle":{"settle":0.9233413476451648,"step":[0.017523096306421904,0.26424111765711533,0.8008517265285442],"seq":[0.011513204799194932,1.363430062345938,0.08718667266522015,3.0018693315036384,0.11212506124172689,3.2234950005873615,0.06896220485678445,-2.251882254566414,0.030036131710652725,-2.391347239544131,-0.09029652398314258,-2.3326285325913156]},"float":{"settle":1.4828684646905668,"step":[0.006143498680787118,0.11998157403699616,0.5792599835086413],"seq":[0.003980281121423124,0.48535611239817406,0.0337327526437825,1.2728967335912145,0.04453431721336511,1.4251679398513821,0.06766884320418509,-0.6584358939055663,0.05503049912439348,-0.849137404801269,0.0019793734123789916,-1.2295415489007113]}}
"""#

private struct WebToken: Decodable {
    var settle: Double
    var step: [Double]
    var seq: [Double]
}

private let tokens: [String: MotionToken] = [
    "snap": .snap, "glide": .glide, "click": .click, "land": .land, "boing": .boing, "settle": .settle, "float": .float,
]

private func close(_ a: Double, _ b: Double, _ tolerance: Double = 1e-12) -> Bool {
    abs(a - b) <= tolerance * max(1, abs(b))
}

@Suite("springs")
struct SpringTests {
    @Test func matchesTheWebsMotionCode() throws {
        let web = try JSONDecoder().decode([String: WebToken].self, from: Data(webMotion.utf8))
        #expect(web.count == tokens.count)
        for (name, token) in tokens {
            let expected = try #require(web[name])
            #expect(close(token.settleTime(), expected.settle, 1e-9), "\(name) settle")
            for (t, value) in zip([0.02, 0.1, 0.3], expected.step) {
                #expect(close(token.stepResponse(t), value), "\(name) step \(t)")
            }
            var spring = Spring1(0)
            var target = 1.0
            for (k, dt) in [0.016, 0.033, 0.008, 0.1, 0.0167, 0.05].enumerated() {
                if k == 3 { target = -0.5 }
                spring.step(toward: target, token: token, dt: dt)
                #expect(close(spring.value, expected.seq[2 * k]), "\(name) value \(k)")
                #expect(close(spring.velocity, expected.seq[2 * k + 1]), "\(name) velocity \(k)")
            }
        }
    }

    @Test(arguments: [MotionToken.snap, .click, .land, .boing, MotionToken(smoothTime: 0.1, dampingRatio: 2)])
    func frameRateIndependent(token: MotionToken) {
        var fast = Spring3(Vec3(1, -2, 0.5), velocity: Vec3(3, 0, -1))
        var slow = fast
        let target = Vec3(0.2, 0.4, -0.3)
        for _ in 0..<120 { fast.step(toward: target, token: token, dt: 1.0 / 120) }
        for _ in 0..<30 { slow.step(toward: target, token: token, dt: 1.0 / 30) }
        #expect((fast.value - slow.value).length < 1e-12)
        #expect((fast.velocity - slow.velocity).length < 1e-10)
    }

    @Test func overshootIsTheTokensCharacter() {
        func peak(_ token: MotionToken) -> Double {
            var spring = Spring1(0)
            var best = 0.0
            for _ in 0..<2000 {
                spring.step(toward: 1, token: token, dt: 0.0005)
                best = max(best, spring.value)
            }
            return best - 1
        }
        #expect(abs(peak(.click) - 0.046) < 0.001)
        #expect(abs(peak(.land) - 0.028) < 0.001)
        #expect(abs(peak(.boing) - 0.205) < 0.002)
        #expect(peak(.snap) <= 1e-12)
        #expect(peak(MotionToken(smoothTime: 0.1, dampingRatio: 2)) <= 1e-12)
    }

    @Test func badFrameTimesAreNoTime() {
        var spring = Spring1(0.25, velocity: 2)
        for dt in [0, -0.1, .nan, .infinity] {
            spring.step(toward: 1, token: .snap, dt: dt)
            #expect(spring.value == 0.25)
            #expect(spring.velocity == 2)
        }
        spring.cut(to: 1)
        #expect(spring.value == 1 && spring.velocity == 0)
        #expect(spring.isSettled(at: 1, eps: 1e-6))
    }
}

@Suite("motion toys")
struct MotionToyTests {
    @Test func holdFollowTrailsTheHandAndLeansIntoIt() {
        var hold = HoldFollow(at: .zero)
        #expect(hold.lean() == .none)
        // The hand sweeps right at 1 m/s for a third of a second at 60 Hz.
        for frame in 1...20 { hold.step(toward: Vec3(Double(frame) / 60, 0, 0), dt: 1.0 / 60) }
        let lag = 20.0 / 60 - hold.position.value.x
        // A critically damped follower trails a steady hand by smoothTime × speed, less half a
        // frame, because each frame's target is where the hand is at the end of that frame.
        #expect(abs(lag - (MotionToken.snap.smoothTime - 0.5 / 60)) < 0.001)
        let lean = hold.lean()
        #expect(lean.angle > 0.7 * HoldFollow.maxLean && lean.angle <= HoldFollow.maxLean)
        // Up tips toward +x: the axis is up × x = −z.
        #expect((lean.axis - Vec3(0, 0, -1)).length < 1e-9)
        let tipped = lean.rotation.act(Vec3(0, 1, 0))
        #expect(tipped.x > 0)
        #expect(abs(hold.lean(comfort: .gentle).angle - lean.angle / 2) < 1e-12)
        #expect(hold.lean(comfort: .still) == .none)
        // Rising straight up is no lean.
        var lift = HoldFollow(at: .zero)
        for frame in 1...10 { lift.step(toward: Vec3(0, Double(frame) / 60, 0), dt: 1.0 / 60) }
        #expect(lift.lean() == .none)
    }

    @Test func grabDepthIsClamped() {
        #expect(HoldFollow.grabDepth(hitDistance: 0.1) == 0.25)
        #expect(HoldFollow.grabDepth(hitDistance: 0.8) == 0.8)
        #expect(HoldFollow.grabDepth(hitDistance: 4) == 1.5)
        #expect(HoldFollow.grabDepth(hitDistance: .nan) == 1.5)
    }

    @Test func squashKeepsVolumeAndWobblesHome() {
        var squash = Squash()
        let amount = Squash.amount(intensity: 1, maxSquash: 0.25, comfort: .standard)
        #expect(amount == 0.25)
        #expect(Squash.amount(intensity: 1, maxSquash: 0.25, comfort: .gentle) == 0.125)
        #expect(Squash.amount(intensity: 1, maxSquash: 0.25, comfort: .still) == 0)
        squash.hit(direction: Vec3(0, -3, 0), amount: amount)
        #expect((squash.axis - Vec3(0, -1, 0)).length < 1e-12)
        let s = squash.scale
        #expect(abs(s.along * s.across * s.across - 1) < 1e-12)
        #expect(abs(s.along - 0.75) < 1e-12)
        // A weaker hit while squashed does not reset it.
        squash.hit(direction: Vec3(1, 0, 0), amount: 0.1)
        #expect((squash.axis - Vec3(0, -1, 0)).length < 1e-12)
        var stretched = false
        for _ in 0..<120 {
            squash.step(dt: 1.0 / 60)
            if squash.amount.value < 0 { stretched = true }
        }
        #expect(stretched, "the boing token overshoots into a stretch")
        #expect(squash.isAtRest)
    }

    @Test func popInLandsAndStillCuts() {
        var pop = PopIn(comfort: .standard)
        #expect(pop.scale.value == 0)
        var overshoot = 0.0
        for _ in 0..<60 {
            pop.step(dt: 1.0 / 60)
            overshoot = max(overshoot, pop.scale.value - 1)
        }
        #expect(pop.isDone)
        #expect(overshoot > 0.01 && overshoot < 0.04)
        #expect(PopIn(comfort: .gentle).scale.value == 0)
        #expect(PopIn(comfort: .still).scale.value == 1)
    }

    @Test func hitStopHoldsThenCatchesUp() {
        var stop = HitStop()
        var physics = Vec3.zero
        #expect(stop.step(physics: physics, dt: 1.0 / 60) == physics)
        let soft = stop.hit(intensity: 0.5, comfort: .standard, at: physics)
        let gentle = stop.hit(intensity: 0.8, comfort: .gentle, at: physics)
        let hard = stop.hit(intensity: 0.8, comfort: .standard, at: physics)
        #expect(!soft && !gentle && hard)
        var drawn: [Vec3] = []
        for _ in 0..<30 {
            physics += Vec3(0.05, 0, 0)
            drawn.append(stop.step(physics: physics, dt: 1.0 / 60))
        }
        // Held for 50 ms (three frames at 60 Hz), then it catches the body.
        #expect(drawn[0] == .zero && drawn[1] == .zero)
        #expect(drawn[3].x > 0)
        #expect(!stop.isHolding)
        #expect((drawn[29] - physics).length < 1e-3)
    }

    @Test func comfortLevels() {
        #expect(MotionComfort.defaultLevel(reduceMotion: true) == .still)
        #expect(MotionComfort.defaultLevel(reduceMotion: false) == .standard)
        #expect(MotionComfort.standard.throwSpeedCap == 8)
        #expect(MotionComfort.gentle.throwSpeedCap == 4)
        #expect(MotionComfort.still.throwSpeedCap == 1.5)
        #expect(MotionComfort.gentle.spinScale == 0.5 && MotionComfort.still.spinScale == 0)
        #expect(!MotionComfort.gentle.allowsTimeEffects && MotionComfort.standard.allowsTimeEffects)
        #expect(MotionComfort.gentle.animatesGlides && !MotionComfort.still.animatesGlides)
    }
}
