import Foundation
import Testing
@testable import LupiPlay

/// A 15 cm rigid toy whose heft gives pitch 1 exactly.
private func toy(_ id: UInt64, _ kind: Personality.Kind = .rigid, heft: Double = 0.6) -> JuiceBody {
    JuiceBody(id: id, kind: kind, hapticSharpness: 0.8, span: 0.15, heft: heft)
}

private func transients(_ out: JuiceOutput) -> [(time: Double, intensity: Double, sharpness: Double)] {
    out.haptics.compactMap {
        if case let .transient(time, intensity, sharpness) = $0 { return (time, intensity, sharpness) }
        return nil
    }
}

private struct Swallowed: Error {}

extension JuiceDirector {
    /// `fire`, outside the expectation macros (which cannot call a mutating method).
    mutating func must(_ event: JuiceEvent, body: JuiceBody, at time: Double) throws -> JuiceOutput {
        guard let out = fire(event, body: body, at: time) else { throw Swallowed() }
        return out
    }

    mutating func fires(_ event: JuiceEvent, body: JuiceBody, at time: Double) -> Bool {
        fire(event, body: body, at: time) != nil
    }
}

@Suite("juice")
struct JuiceTests {
    @Test func intensityCurve() {
        #expect(JuiceDirector.intensity(deltaV: 2) == 1)
        #expect(JuiceDirector.intensity(deltaV: 9) == 1)
        #expect(JuiceDirector.intensity(deltaV: 0.05) == 0.15)
        #expect(JuiceDirector.intensity(deltaV: 0) == 0.15)
        #expect(abs(JuiceDirector.intensity(deltaV: 1) - pow(0.5, 0.6)) < 1e-12)
    }

    @Test func aWallHitDrivesEveryChannel() throws {
        var juice = JuiceDirector(seed: 1)
        let out = try juice.must(.impact(deltaV: 1, surface: .wall), body: toy(1), at: 10)
        let i = pow(0.5, 0.6)
        #expect(abs(out.intensity - i) < 1e-12)
        let first = try #require(transients(out).first)
        #expect(abs(first.intensity - i) < 1e-12 && first.sharpness == 0.8)
        // The heft tail follows (scale-spec §10.8): 40 ms × (1 + h).
        #expect(out.haptics.contains { if case let .continuous(_, d, _, _, _) = $0 { abs(d - 0.064) < 1e-12 } else { false } })
        #expect(out.sounds.map(\.voice) == [.impact(.clack, .medium, .hard), .thud])
        #expect(abs(out.sounds[0].gain - i) < 1e-12)
        #expect(abs(out.sounds[0].rate - 1) <= JuiceTuning.pitchJitter)
        #expect(out.visual.sparks == 6 + Int((30 * i).rounded()))
        #expect(abs(out.visual.squash - 0.06 * i) < 1e-12)
        #expect(out.visual.hitStop)
        #expect(!out.visual.slowMotion)
        // A table taps, a seat adds nothing.
        let table = try juice.must(.impact(deltaV: 1, surface: .table), body: toy(2), at: 11)
        #expect(table.sounds.map(\.voice).last == .tap)
        let seat = try juice.must(.impact(deltaV: 0.2, surface: .seat), body: toy(3), at: 12)
        #expect(seat.sounds.map(\.voice) == [.impact(.clack, .medium, .soft)])
        #expect(!seat.visual.hitStop)
    }

    @Test func aPairIsQuietForEightyMilliseconds() {
        var juice = JuiceDirector()
        let first = juice.fires(.impact(deltaV: 1, surface: .wall), body: toy(1), at: 1)
        let tooSoon = juice.fires(.impact(deltaV: 3, surface: .floor), body: toy(1), at: 1.05)
        let otherBody = juice.fires(.impact(deltaV: 1, surface: .wall), body: toy(2), at: 1.05)
        let later = juice.fires(.impact(deltaV: 1, surface: .wall), body: toy(1), at: 1.081)
        #expect(first && !tooSoon && otherBody && later)
        // A collision's pair is the same whichever body reports it.
        let ab = juice.fires(.collision(deltaV: 1, other: toy(4)), body: toy(3), at: 2)
        let ba = juice.fires(.collision(deltaV: 1, other: toy(3)), body: toy(4), at: 2.03)
        juice.forget(3)
        let forgotten = juice.fires(.collision(deltaV: 1, other: toy(3)), body: toy(4), at: 2.04)
        #expect(ab && !ba && forgotten)
    }

    @Test func aBounceChainGetsSofterAndHigher() throws {
        // Same seed, same draws: one director chains three bounces in a second, the other spreads them out.
        var chained = JuiceDirector(seed: 9)
        var spread = JuiceDirector(seed: 9)
        var a: [JuiceOutput] = []
        var b: [JuiceOutput] = []
        for k in 0..<4 {
            a.append(try chained.must(.impact(deltaV: 1, surface: .none), body: toy(1), at: 10 + 0.3 * Double(k)))
            b.append(try spread.must(.impact(deltaV: 1, surface: .none), body: toy(1), at: 10 + 1.5 * Double(k)))
        }
        for k in 0..<2 {
            #expect(a[k].sounds[0].rate == b[k].sounds[0].rate)
            #expect(transients(a[k])[0].intensity == transients(b[k])[0].intensity)
        }
        #expect(abs(a[2].sounds[0].rate / b[2].sounds[0].rate - 1.05) < 1e-12)
        #expect(abs(a[3].sounds[0].rate / b[3].sounds[0].rate - 1.10) < 1e-12)
        #expect(abs(transients(a[2])[0].intensity - 0.6 * transients(b[2])[0].intensity) < 1e-12)
    }

    @Test func comfortChangesOnlyWhatMoves() throws {
        func hit(_ comfort: MotionComfort) throws -> JuiceOutput {
            var juice = JuiceDirector(settings: JuiceSettings(comfort: comfort), seed: 4)
            return try juice.must(.impact(deltaV: 5, surface: .wall), body: toy(1, .bouncy), at: 3)
        }
        let standard = try hit(.standard), gentle = try hit(.gentle), still = try hit(.still)
        #expect(standard.haptics == gentle.haptics && gentle.haptics == still.haptics)
        #expect(standard.sounds == gentle.sounds && gentle.sounds == still.sounds)
        #expect(standard.visual.slowMotion && !gentle.visual.slowMotion && !still.visual.slowMotion)
        #expect(!gentle.visual.hitStop && !still.visual.hitStop)
        #expect(standard.visual.sparks == 36 && gentle.visual.sparks == 18 && still.visual.sparks == 0)
        #expect(still.visual.flashRing && !gentle.visual.flashRing)
        #expect(standard.visual.sparksDrift && !gentle.visual.sparksDrift)
        #expect(standard.visual.squash == 0.25 && gentle.visual.squash == 0.125 && still.visual.squash == 0)
    }

    @Test func slowMotionAtMostEveryTwoSeconds() throws {
        var juice = JuiceDirector()
        let first = try juice.must(.breakApart(deltaV: 5), body: toy(1, .brittle), at: 1)
        #expect(first.visual.slowMotion && !first.visual.hitStop)
        let second = try juice.must(.impact(deltaV: 6, surface: .wall), body: toy(2), at: 2)
        #expect(!second.visual.slowMotion && second.visual.hitStop)
        let third = try juice.must(.breakApart(deltaV: 5), body: toy(3, .brittle), at: 3.1)
        #expect(third.visual.slowMotion)
        #expect(abs(SlowMotion.rate(at: 0.1) - 0.25) < 1e-12)
        #expect(abs(SlowMotion.rate(at: 0.31) - 0.625) < 1e-12)
        #expect(SlowMotion.rate(at: 0.4) == 1)
    }

    @Test func aBreakCracksShattersAndRumbles() throws {
        var juice = JuiceDirector()
        let out = try juice.must(.breakApart(deltaV: 3), body: toy(1, .brittle), at: 1)
        #expect(out.haptics == [
            .transient(time: 0, intensity: 1, sharpness: 1),
            .continuous(time: 0.01, duration: 0.12, intensity: 0.6, endIntensity: 0, sharpness: 0.3),
        ])
        #expect(out.sounds.map(\.voice) == [.impact(.tink, .medium, .hard), .shatter])
        #expect(out.visual.sparks == 60)
    }

    @Test func eventsFollowThePlansTable() throws {
        var juice = JuiceDirector(settings: JuiceSettings(comfort: .standard), seed: 2)
        let body = toy(1)
        let spawn = try juice.must(.spawn, body: body, at: 1)
        #expect(spawn.haptics == [.transient(time: 0, intensity: 0.4, sharpness: 0.5)])
        #expect(spawn.sounds.map(\.voice) == [.pop] && spawn.visual.popIn && spawn.visual.sparks == 8)
        let grab = try juice.must(.grab, body: body, at: 2)
        #expect(grab.haptics == [.transient(time: 0, intensity: 0.3, sharpness: 0.6)])
        #expect(grab.sounds.map(\.voice) == [.tick])
        let release = try juice.must(.release(speed: 4), body: body, at: 3)
        #expect(release.haptics.isEmpty && release.sounds.map(\.voice) == [.whoosh] && release.visual.trail)
        let lob = try juice.must(.release(speed: 0.2), body: body, at: 4)
        #expect(lob.sounds.isEmpty && !lob.visual.trail)
        let settle = try juice.must(.settle, body: body, at: 5)
        #expect(settle.haptics == [.transient(time: 0, intensity: 0.2, sharpness: 0.2)] && settle.sounds.map(\.voice) == [.tock])
        let kept = try juice.must(.kept, body: body, at: 6)
        #expect(kept.haptics == [.transient(time: 0, intensity: 0.35, sharpness: 0.2), .transient(time: 0.09, intensity: 0.6, sharpness: 0.6)])
        #expect(kept.sounds.map(\.voice) == [.kept] && kept.visual.ring == .lime)
        let knocked = try juice.must(.knockedOff(deltaV: 1), body: body, at: 7)
        #expect(knocked.haptics == [.transient(time: 0, intensity: 0.5, sharpness: 0.8)] && knocked.visual.ring == .fade)
        let snap = try juice.must(.snap, body: body, at: 8)
        #expect(snap.haptics == [.transient(time: 0, intensity: 0.5, sharpness: 0.9), .transient(time: 0.04, intensity: 0.5, sharpness: 0.9)])
        let refused = try juice.must(.snapRefused, body: body, at: 9)
        #expect(refused.sounds.map(\.voice) == [.bump])
        let delight = try juice.must(.delight(slowMotion: true), body: body, at: 10)
        #expect(transients(delight).map(\.time) == [0, 0.11, 0.22])
        #expect(transients(delight).map(\.intensity) == [0.4, 0.5, 0.6])
        #expect(delight.visual.caption && delight.visual.slowMotion)
        let detent = try juice.must(.scaleDetent, body: body, at: 11)
        #expect(detent.haptics == [.transient(time: 0, intensity: 0.3, sharpness: 0.9)] && detent.sounds.map(\.voice) == [.detent])
    }

    @Test func moleculesHittingMoleculesShareTheJuice() throws {
        var juice = JuiceDirector()
        let a = toy(1, .rigid)
        let b = JuiceBody(id: 2, kind: .bouncy, hapticSharpness: 0.5, span: 0.15, heft: 0.6)
        let out = try juice.must(.collision(deltaV: 2, other: b), body: a, at: 1)
        #expect(transients(out)[0].sharpness == (0.8 + 0.5) / 2)
        #expect(out.sounds.map(\.voice) == [.impact(.clack, .medium, .hard), .impact(.boing, .medium, .hard)])
        #expect(out.sounds.allSatisfy { $0.gain == 0.5 })
        #expect(out.visual.squash == 0.06 && out.visual.otherSquash == 0.25)
    }

    @Test func theToggleAndTheHardware() throws {
        var off = JuiceDirector(settings: JuiceSettings(soundAndHaptics: false))
        let silent = try off.must(.impact(deltaV: 2, surface: .wall), body: toy(1), at: 1)
        #expect(silent.haptics.isEmpty && silent.sounds.isEmpty && silent.visual.sparks > 0)
        var iPad = JuiceDirector(settings: JuiceSettings(supportsHaptics: false))
        let heard = try iPad.must(.impact(deltaV: 2, surface: .wall), body: toy(1), at: 1)
        #expect(heard.haptics.isEmpty && !heard.sounds.isEmpty)
    }

    @Test func hapticsStayUnderThirtyASecondAndTransientsMerge() throws {
        var juice = JuiceDirector()
        var times: [Double] = []
        for k in 0..<60 {
            // Different bodies, 40 ms apart: 25 transients and 25 tails a second asked for.
            let at = 5 + 0.04 * Double(k)
            let out = try juice.must(.impact(deltaV: 1, surface: .none), body: toy(UInt64(k)), at: at)
            times += out.haptics.map { at + $0.time }
        }
        times.sort()
        for (k, t) in times.enumerated() {
            #expect(times[k...].prefix { $0 - t < 1 }.count <= JuiceTuning.hapticsPerSecond)
        }
        #expect(times.count > 50)
        // A transient 20 ms after another merges into it; the sound still plays.
        var merge = JuiceDirector()
        _ = merge.fire(.grab, body: toy(1), at: 1)
        let next = try merge.must(.grab, body: toy(2), at: 1.02)
        #expect(next.haptics.isEmpty && next.sounds.map(\.voice) == [.tick])
        // One body's sounds 20 ms apart merge too.
        let again = try merge.must(.settle, body: toy(2), at: 1.04)
        #expect(again.sounds.isEmpty)
    }

    @Test func heftFollowsTheSpec() {
        // scale-spec §10.8: water 0.35, C60 0.59, salt 10^6 0.93, salt 10^9 1.06, a googolplex 100.
        #expect(abs(JuiceBody.heft(molarMass: 18.015) - 0.35) < 0.005)
        #expect(abs(JuiceBody.heft(molarMass: 720.66) - 0.59) < 0.005)
        #expect(abs(JuiceBody.heft(molarMass: 29.22 * 1e6) - 0.93) < 0.005)
        #expect(abs(JuiceBody.heft(molarMass: 29.22 * 1e9) - 1.06) < 0.005)
        // A googolplex of salt: ln M overflows, ln ln M = ln(10^100 · ln 10 + ln 29.22).
        let lnlnM = log(1e100 * log(10.0))
        #expect(abs(JuiceBody.heft(lnM: .infinity, lnlnM: lnlnM) - 100) < 1e-9)
        let googolplex = JuiceBody(id: 1, kind: .brittle, hapticSharpness: 1, span: 0.3, heft: 100)
        #expect(googolplex.subBassGain == 1)
        #expect(abs(googolplex.hapticTail - 0.2) < 1e-12)
        #expect(abs(googolplex.pitch - (0.5).squareRoot() * pow(0.85, 3.4)) < 1e-12)
        let water = JuiceBody(id: 2, kind: .rigid, hapticSharpness: 0.8, span: 0.09, heft: JuiceBody.heft(molarMass: 18.015))
        #expect(water.subBassGain == 0)
        #expect(water.pitch > 1.2)
    }

    @Test func surfaceLayers() {
        #expect(SurfaceClass.wall.layer == .thud && SurfaceClass.floor.layer == .thud)
        #expect(SurfaceClass.table.layer == .tap)
        #expect(SurfaceClass.none.layer == nil)
    }
}
