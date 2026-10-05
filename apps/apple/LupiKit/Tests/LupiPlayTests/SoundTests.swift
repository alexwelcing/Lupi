import Foundation
import Testing
@testable import LupiPlay

/// |DFT| of `x` at `frequency`, by the Goertzel recurrence, over samples [from, to).
private func goertzel(_ buffer: PCMBuffer, _ frequency: Double, from: Double = 0, to: Double? = nil) -> Double {
    let start = Int(from * buffer.sampleRate)
    let end = min(buffer.samples.count, to.map { Int($0 * buffer.sampleRate) } ?? buffer.samples.count)
    guard start < end else { return 0 }
    let w = 2 * Double.pi * frequency / buffer.sampleRate
    let c = 2 * cos(w)
    var s1 = 0.0, s2 = 0.0
    for k in start..<end {
        let s0 = Double(buffer.samples[k]) + c * s1 - s2
        s2 = s1
        s1 = s0
    }
    return (s1 * s1 + s2 * s2 - c * s1 * s2).squareRoot()
}

/// The strongest response near `frequency` (within ±1.5 %, the seeded detune and DFT leakage).
private func near(_ buffer: PCMBuffer, _ frequency: Double, from: Double = 0, to: Double? = nil) -> Double {
    stride(from: -0.015, through: 0.015, by: 0.0025).map { goertzel(buffer, frequency * (1 + $0), from: from, to: to) }.max()!
}

private func rms(_ buffer: PCMBuffer, from: Double, to: Double) -> Double {
    let start = Int(from * buffer.sampleRate)
    let end = min(buffer.samples.count, Int(to * buffer.sampleRate))
    guard start < end else { return 0 }
    let sum = buffer.samples[start..<end].reduce(0.0) { $0 + Double($1) * Double($1) }
    return (sum / Double(end - start)).squareRoot()
}

private func zeroCrossingRate(_ buffer: PCMBuffer, from: Double, to: Double) -> Double {
    let start = Int(from * buffer.sampleRate)
    let end = min(buffer.samples.count, Int(to * buffer.sampleRate))
    var crossings = 0
    for k in (start + 1)..<end where (buffer.samples[k - 1] < 0) != (buffer.samples[k] < 0) { crossings += 1 }
    return Double(crossings) / (Double(end - start) / buffer.sampleRate) / 2
}

/// Share of the energy in the first difference: a brightness proxy.
private func brightness(_ buffer: PCMBuffer) -> Double {
    var diff = 0.0, total = 0.0
    for k in 1..<buffer.samples.count {
        let d = Double(buffer.samples[k] - buffer.samples[k - 1])
        diff += d * d
        total += Double(buffer.samples[k]) * Double(buffer.samples[k])
    }
    return diff / total
}

@Suite("sound synthesis")
struct SoundTests {
    @Test func theBankHasEveryVoiceOnce() {
        #expect(SoundVoice.all.count == 4 * 3 * 2 + 13)
        #expect(Set(SoundVoice.all).count == SoundVoice.all.count)
        #expect(Set(SoundVoice.all.map(\.name)).count == SoundVoice.all.count)
        #expect(SoundVoice.impact(.clack, .medium, .hard).name == "impact.clack.medium.hard")
    }

    @Test func everyVoiceIsCleanPCM() {
        let bank = SoundBank.renderAll(seed: 1)
        #expect(bank.count == SoundVoice.all.count)
        for (voice, buffer) in bank {
            #expect(buffer.sampleRate == 48_000)
            #expect(buffer.samples.count > 480, "\(voice.name)")
            #expect(buffer.duration < 1, "\(voice.name)")
            let finite = buffer.samples.allSatisfy { $0.isFinite }
            #expect(finite, "\(voice.name)")
            #expect(abs(buffer.peak - SoundSynth.peak) < 1e-6, "\(voice.name)")
            // No click at either end.
            #expect(abs(buffer.samples.first!) < 0.05, "\(voice.name)")
            #expect(buffer.samples.last! == 0, "\(voice.name)")
        }
    }

    @Test func aSeedIsATake() {
        let voice = SoundVoice.impact(.tink, .small, .hard)
        #expect(SoundBank.render(voice, seed: 7) == SoundBank.render(voice, seed: 7))
        #expect(SoundBank.render(voice, seed: 7) != SoundBank.render(voice, seed: 8))
        #expect(SoundBank.render(.shatter, seed: 7) != SoundBank.render(.shatter, seed: 8))
        // Voices differ under one seed.
        #expect(SoundBank.render(.tick, seed: 7) != SoundBank.render(.detent, seed: 7))
        // Another rate is the same sound, resampled.
        let slow = SoundBank.render(voice, sampleRate: 44_100, seed: 7)
        #expect(abs(slow.duration - SoundBank.render(voice, seed: 7).duration) < 0.002)
    }

    @Test(arguments: [ImpactFamily.clack, .thwap, .tink])
    func familiesRingAtTheirPartials(family: ImpactFamily) {
        let voice = SoundVoice.impact(family, .medium, .hard)
        let buffer = SoundBank.render(voice, seed: 3)
        let f0 = SoundBank.fundamental(of: voice)
        let ratios: [Double] = switch family {
        case .clack: [1, 2.32, 4.25]
        case .thwap: [1, 1.6]
        case .tink: [1, 2.76, 5.40]
        case .boing: [1, 1.5]
        }
        // Between the partials; thwap's 50 ms partials are too short to resolve 1 : 1.6
        // from what lies between, so it is probed above them instead.
        let noise = near(buffer, f0 * (family == .thwap ? 3.1 : 1.27))
        for ratio in ratios {
            #expect(near(buffer, f0 * ratio) > 3 * noise, "\(family) partial \(ratio)")
        }
    }

    @Test func bandsAndLayersShiftPitchAndBrightness() {
        for family in ImpactFamily.allCases where family != .boing {
            let small = SoundBank.render(.impact(family, .small, .hard), seed: 2)
            let medium = SoundBank.render(.impact(family, .medium, .hard), seed: 2)
            let large = SoundBank.render(.impact(family, .large, .hard), seed: 2)
            let f0 = SoundBank.fundamental(of: .impact(family, .medium, .hard))
            #expect(near(small, f0 * 1.4) > 3 * near(small, f0), "\(family) small")
            #expect(near(large, f0 * 0.7) > 3 * near(large, f0), "\(family) large")
            #expect(near(medium, f0) > 3 * near(medium, f0 * 0.7), "\(family) medium")
        }
        for family in ImpactFamily.allCases {
            let hard = SoundBank.render(.impact(family, .medium, .hard), seed: 2)
            let soft = SoundBank.render(.impact(family, .medium, .soft), seed: 2)
            #expect(brightness(hard) > brightness(soft), "\(family)")
        }
    }

    @Test func decaysFollowThePlan() {
        func length(_ family: ImpactFamily) -> Double { SoundBank.render(.impact(family, .medium, .soft), seed: 4).duration }
        // Plan §5.2: thwap 50 ms < clack 80 ms < boing 180 ms < tink 250 ms.
        #expect(length(.thwap) < length(.clack))
        #expect(length(.clack) < length(.boing))
        #expect(length(.boing) < length(.tink))
        let tink = SoundBank.render(.impact(.tink, .medium, .hard), seed: 4)
        #expect(rms(tink, from: 0.2, to: 0.25) < rms(tink, from: 0, to: 0.05) / 30)
    }

    @Test func theBoingDropsInPitch() {
        let boing = SoundBank.render(.impact(.boing, .medium, .hard), seed: 5)
        let early = zeroCrossingRate(boing, from: 0.001, to: 0.03)
        let late = zeroCrossingRate(boing, from: 0.12, to: 0.18)
        #expect(early > 1.15 * late)
        #expect(abs(late - SoundBank.fundamental(of: .impact(.boing, .medium, .hard))) < 40)
    }

    @Test func eventSoundsHaveTheirShapes() {
        // The whoosh swells before it fades.
        let whoosh = SoundBank.render(.whoosh, seed: 6)
        #expect(rms(whoosh, from: 0.05, to: 0.09) > 2 * rms(whoosh, from: 0, to: 0.02))
        // The kept chime's second note waits 90 ms; the delight's third waits 220 ms.
        let kept = SoundBank.render(.kept, seed: 6)
        #expect(near(kept, 2_093, from: 0.095, to: 0.2) > 5 * near(kept, 2_093, from: 0, to: 0.085))
        let delight = SoundBank.render(.delight, seed: 6)
        #expect(near(delight, 3_800, from: 0.225, to: 0.3) > 5 * near(delight, 3_800, from: 0, to: 0.2))
        // The snap is two clicks, 40 ms apart.
        let snap = SoundBank.render(.snap, seed: 6)
        #expect(near(snap, 1_900, from: 0.04, to: 0.07) > 5 * near(snap, 1_900, from: 0, to: 0.035))
        // The sub-bass sits at 45 Hz.
        let sub = SoundBank.render(.subBass, seed: 6)
        #expect(abs(zeroCrossingRate(sub, from: 0.2, to: 0.45) - 45) < 3)
        // The pop rises.
        let pop = SoundBank.render(.pop, seed: 6)
        #expect(zeroCrossingRate(pop, from: 0.002, to: 0.012) < zeroCrossingRate(pop, from: 0.03, to: 0.06))
    }

    @Test func sizeBandsAreChosenOnALogScale() {
        #expect(SizeBand.nearest(pitch: 1) == .medium)
        #expect(SizeBand.nearest(pitch: 1.3) == .small)
        #expect(SizeBand.nearest(pitch: 0.75) == .large)
        #expect(SizeBand.nearest(pitch: 0.2) == .large)
        #expect(SizeBand.nearest(pitch: .nan) == .medium)
        #expect(IntensityLayer(intensity: 0.49) == .soft)
        #expect(IntensityLayer(intensity: 0.5) == .hard)
        #expect(ImpactFamily(kind: .brittle) == .tink)
        #expect(ImpactFamily(kind: .flexible) == .thwap)
    }
}
