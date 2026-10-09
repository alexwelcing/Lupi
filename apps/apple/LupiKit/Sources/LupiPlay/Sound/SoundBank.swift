import Foundation

/// Every game sound, synthesized: the app renders the bank once at launch and
/// needs no audio assets (plan §5.2). Fundamentals and partial weights are
/// starting values (est.) for the tuning pass on the device; the families'
/// partial ratios and decays are plan §5.2's table.
public enum SoundBank {
    public static let defaultSampleRate = 48_000.0

    /// One voice. The same voice, tuning, rate and seed always give the same samples.
    public static func render(
        _ voice: SoundVoice, tuning: SoundTuning = .v1, sampleRate: Double = defaultSampleRate, seed: UInt64 = 0
    ) -> PCMBuffer {
        var random = SoundRandom(seed: seed ^ fnv1a(voice.name))
        let strikes = recipe(voice, tuning: tuning, random: &random)
        return PCMBuffer(sampleRate: sampleRate, samples: SoundSynth.render(strikes, sampleRate: sampleRate, seed: random.next()))
    }

    /// The whole bank, `SoundVoice.all`.
    public static func renderAll(tuning: SoundTuning = .v1, sampleRate: Double = defaultSampleRate, seed: UInt64 = 0) -> [SoundVoice: PCMBuffer] {
        var bank: [SoundVoice: PCMBuffer] = [:]
        for voice in SoundVoice.all { bank[voice] = render(voice, tuning: tuning, sampleRate: sampleRate, seed: seed) }
        return bank
    }

    /// The lowest partial a voice is built on at its own pitch, Hz (for tests and tuning).
    public static func fundamental(of voice: SoundVoice, tuning: SoundTuning = .v1) -> Double {
        switch voice {
        case let .impact(family, band, _): tuning.family(family).fundamental * band.pitch
        case let .ring(band): tuning.ring.fundamental * band.pitch
        case .flap: tuning.flap.fundamental
        case .crackle: 4_000
        case .thud: 85
        case .tap: 1_800
        case .subBass: 45
        case .pop: 900
        case .tick: 1_500
        case .whoosh: 1_200
        case .tock: 520
        case .kept: 1_568
        case .shatter: 2_000
        case .snap: 2_600
        case .bump: 140
        case .delight: 2_400
        case .detent: 2_600
        }
    }

    /// One family's strikes at a band's pitch and a layer's brightness.
    static func strikes(_ spec: SoundTuning.Family, pitch: Double, hard: Bool) -> [Strike] {
        let f0 = spec.fundamental * pitch
        let amplitudes = hard ? spec.hard : spec.soft
        var modes = zip(spec.ratios, amplitudes).map { ratio, amplitude in
            Mode(frequency: f0 * ratio, amplitude: amplitude, t60: spec.t60 / pow(ratio, spec.damping),
                 glide: spec.glide, glideTime: spec.glideTime)
        }
        if spec.shimmer > 0, let first = modes.first {
            var twin = first
            twin.frequency *= 1 + spec.shimmer
            twin.amplitude *= 0.6
            modes.append(twin)
        }
        let noise = NoiseBurst(
            amplitude: hard ? spec.noiseHard : spec.noiseSoft, t60: spec.noiseT60,
            highpass: spec.highpass.map { $0 * pitch }, lowpass: spec.lowpass.map { $0 * pitch }
        )
        var out = [Strike(modes: modes, noise: noise)]
        if spec.chatter > 0 && spec.chatterGain > 0 {
            // The second touch is a little higher and has no tail of its own.
            let short = modes.map { m -> Mode in
                var m = m
                m.frequency *= 1.03
                m.t60 *= 0.5
                return m
            }
            out.append(Strike(at: spec.chatter, modes: short, noise: noise, gain: spec.chatterGain))
        }
        return out
    }

    static func recipe(_ voice: SoundVoice, tuning: SoundTuning, random: inout SoundRandom) -> [Strike] {
        switch voice {
        case let .impact(family, band, layer):
            return strikes(tuning.family(family), pitch: band.pitch, hard: layer == .hard)
        case let .ring(band):
            // A soft onset: the ring blooms out of the boing rather than striking again.
            return strikes(tuning.ring, pitch: band.pitch, hard: true).map { s in
                var s = s
                s.attack = 0.006
                return s
            }
        case .flap:
            return strikes(tuning.flap, pitch: 1, hard: true)
        case .crackle:
            // A handful of tiny glass grains in 40 ms: the crack you hear before the break.
            return (0..<9).map { _ in
                let f = 3_000 * pow(3, random.unit())
                return Strike(at: random.uniform(0...0.04), modes: [Mode(frequency: f, amplitude: random.uniform(0.3...1), t60: random.uniform(0.01...0.04))],
                              noise: NoiseBurst(amplitude: 0.3, t60: 0.002, highpass: 4_000))
            }
        case .thud:
            return [Strike(modes: [Mode(frequency: 85, amplitude: 1, t60: 0.14), Mode(frequency: 140, amplitude: 0.4, t60: 0.08)],
                           noise: NoiseBurst(amplitude: 0.5, t60: 0.025, lowpass: 400), attack: 0.002)]
        case .tap:
            return [Strike(modes: [Mode(frequency: 1_800, amplitude: 1, t60: 0.035), Mode(frequency: 4_100, amplitude: 0.5, t60: 0.02)],
                           noise: NoiseBurst(amplitude: 0.5, t60: 0.003, highpass: 2_500))]
        case .subBass:
            return [Strike(modes: [Mode(frequency: 45, amplitude: 1, t60: 0.45, glide: 0.15, glideTime: 0.12)], attack: 0.008)]
        case .pop:
            return [Strike(modes: [Mode(frequency: 900, amplitude: 1, t60: 0.07, glide: -0.6, glideTime: 0.015)],
                           noise: NoiseBurst(amplitude: 0.15, t60: 0.004, lowpass: 3_000), attack: 0.001)]
        case .tick:
            return [Strike(modes: [Mode(frequency: 1_500, amplitude: 1, t60: 0.025), Mode(frequency: 4_050, amplitude: 0.4, t60: 0.015)],
                           noise: NoiseBurst(amplitude: 0.4, t60: 0.002, highpass: 3_000))]
        case .whoosh:
            return [Strike(modes: [], noise: NoiseBurst(amplitude: 1, t60: 0.15, highpass: 500, lowpass: 2_500, swell: 0.07))]
        case .tock:
            return [Strike(modes: [Mode(frequency: 520, amplitude: 1, t60: 0.09), Mode(frequency: 1_508, amplitude: 0.3, t60: 0.05)],
                           noise: NoiseBurst(amplitude: 0.2, t60: 0.005, lowpass: 2_000), attack: 0.001)]
        case .kept:
            // Two notes, 90 ms apart, as the kept haptic (plan §5.3): G6 then C7.
            return [1_568.0, 2_093.0].enumerated().map { index, f in
                Strike(at: 0.09 * Double(index), modes: bell(f, t60: 0.42), attack: 0.002)
            }
        case .shatter:
            var strikes: [Strike] = (0..<24).map { _ in
                let f = 2_000 * pow(4.5, random.unit())
                return Strike(at: random.uniform(0...0.06),
                              modes: [Mode(frequency: f, amplitude: random.uniform(0.2...1), t60: random.uniform(0.04...0.16))])
            }
            strikes.append(Strike(modes: [], noise: NoiseBurst(amplitude: 0.7, t60: 0.22, highpass: 2_500)))
            return strikes
        case .snap:
            return [
                Strike(modes: [Mode(frequency: 2_600, amplitude: 1, t60: 0.03), Mode(frequency: 6_100, amplitude: 0.4, t60: 0.02)],
                       noise: NoiseBurst(amplitude: 0.4, t60: 0.002, highpass: 3_000)),
                Strike(at: 0.04, modes: [Mode(frequency: 1_900, amplitude: 1, t60: 0.035), Mode(frequency: 4_500, amplitude: 0.4, t60: 0.02)],
                       noise: NoiseBurst(amplitude: 0.4, t60: 0.002, highpass: 3_000)),
            ]
        case .bump:
            return [Strike(modes: [Mode(frequency: 140, amplitude: 1, t60: 0.06), Mode(frequency: 210, amplitude: 0.5, t60: 0.04)],
                           noise: NoiseBurst(amplitude: 0.3, t60: 0.015, lowpass: 600), attack: 0.002)]
        case .delight:
            // The web's Foil chime: three rising notes at 0, 110 and 220 ms.
            return [(0.0, 2_400.0, 0.8), (0.11, 3_000.0, 0.9), (0.22, 3_800.0, 1.0)].map { at, f, gain in
                Strike(at: at, modes: bell(f, t60: 0.3), attack: 0.002, gain: gain)
            }
        case .detent:
            return [Strike(modes: [Mode(frequency: 2_600, amplitude: 1, t60: 0.02), Mode(frequency: 5_900, amplitude: 0.35, t60: 0.012)],
                           noise: NoiseBurst(amplitude: 0.3, t60: 0.0015, highpass: 3_000))]
        }
    }

    static func bell(_ f: Double, t60: Double) -> [Mode] {
        [Mode(frequency: f, amplitude: 1, t60: t60), Mode(frequency: 2 * f, amplitude: 0.3, t60: t60 * 0.6),
         Mode(frequency: 3.01 * f, amplitude: 0.12, t60: t60 * 0.4)]
    }

    static func fnv1a(_ text: String) -> UInt64 {
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash &*= 0x0000_0100_0000_01B3
        }
        return hash
    }
}
