import Foundation

/// Mono Float32 PCM, −1...1: what the app wraps in an `AVAudioPCMBuffer`
/// (standard deinterleaved Float32) and an `AudioBufferResource` at launch.
public struct PCMBuffer: Sendable, Equatable {
    public var sampleRate: Double
    public var samples: [Float]

    public init(sampleRate: Double, samples: [Float]) {
        self.sampleRate = sampleRate
        self.samples = samples
    }

    public var duration: Double { Double(samples.count) / sampleRate }
    public var peak: Float { samples.reduce(0) { max($0, abs($1)) } }
}

/// One damped partial of a modal impact.
struct Mode: Sendable {
    var frequency: Double
    var amplitude: Double
    /// Seconds to fall 60 dB.
    var t60: Double
    /// Pitch glide: the frequency starts at `frequency × (1 + glide)` and relaxes
    /// to `frequency` with time constant `glideTime` (a boing's drop, a pop's rise).
    var glide = 0.0
    var glideTime = 0.05
}

/// A noise transient, band-limited by one-pole filters.
struct NoiseBurst: Sendable {
    var amplitude: Double
    var t60: Double
    var highpass: Double?
    var lowpass: Double?
    /// Rise time before the decay starts (a whoosh swells); 0 is a strike.
    var swell = 0.0
}

/// Modes and noise that start together.
struct Strike: Sendable {
    var at = 0.0
    var modes: [Mode]
    var noise: NoiseBurst?
    /// Linear fade-in, seconds, so no strike starts with a click.
    var attack = 0.0004
    var gain = 1.0
}

/// SplitMix64, kept internal: the seed's only job is to make a sound's noise
/// and detune repeatable.
struct SoundRandom {
    var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// [0, 1).
    mutating func unit() -> Double { Double(next() >> 11) * 0x1p-53 }
    /// [−1, 1).
    mutating func signed() -> Double { unit() * 2 - 1 }
    mutating func uniform(_ range: ClosedRange<Double>) -> Double {
        range.lowerBound + unit() * (range.upperBound - range.lowerBound)
    }
}

/// The modal synthesizer behind every game sound (plan §5.2): a few damped
/// partials plus a noise transient, rendered straight into PCM. Deterministic
/// for a seed on a given platform.
enum SoundSynth {
    /// The loudest sample of every rendered buffer (−1 dBFS); the app sets gain on playback.
    static let peak: Float = 0.89
    /// Envelopes are cut at −72 dB.
    static let floorDB = 72.0

    static func render(_ strikes: [Strike], sampleRate: Double, seed: UInt64) -> [Float] {
        var random = SoundRandom(seed: seed)
        let ln1000 = log(1000.0)
        var length = 0.0
        for strike in strikes {
            let modeEnd = strike.modes.map { $0.t60 * floorDB / 60 }.max() ?? 0
            let noiseEnd = strike.noise.map { $0.swell + $0.t60 * floorDB / 60 } ?? 0
            length = max(length, strike.at + max(modeEnd, noiseEnd))
        }
        let count = Int((length * sampleRate).rounded(.up)) + 1
        var out = [Double](repeating: 0, count: count)
        let dt = 1 / sampleRate

        for strike in strikes {
            let start = Int((strike.at * sampleRate).rounded())
            for mode in strike.modes {
                // A seeded half-percent detune and phase, so two seeds are two takes.
                let frequency = mode.frequency * (1 + 0.005 * random.signed())
                var phase = 2 * Double.pi * random.unit()
                let decay = ln1000 / mode.t60
                let end = min(count, start + Int((mode.t60 * floorDB / 60 * sampleRate).rounded(.up)))
                guard start < end, frequency < sampleRate / 2 else { continue }
                for k in start..<end {
                    let t = Double(k - start) * dt
                    let f = mode.glide == 0 ? frequency : frequency * (1 + mode.glide * exp(-t / mode.glideTime))
                    let attack = strike.attack > 0 ? min(1, t / strike.attack) : 1
                    out[k] += strike.gain * mode.amplitude * attack * exp(-decay * t) * sin(phase)
                    phase += 2 * Double.pi * f * dt
                    if phase > 2 * Double.pi { phase -= 2 * Double.pi }
                }
            }
            if let noise = strike.noise {
                let decay = ln1000 / noise.t60
                let end = min(count, start + Int(((noise.swell + noise.t60 * floorDB / 60) * sampleRate).rounded(.up)))
                let hp = noise.highpass.map { exp(-2 * Double.pi * $0 / sampleRate) }
                let lp = noise.lowpass.map { 1 - exp(-2 * Double.pi * $0 / sampleRate) }
                var hpIn = 0.0, hpOut = 0.0, lpOut = 0.0
                for k in start..<max(start, end) {
                    let t = Double(k - start) * dt
                    var x = random.signed()
                    if let a = hp {
                        let y = a * (hpOut + x - hpIn)
                        hpIn = x
                        hpOut = y
                        x = y
                    }
                    if let a = lp {
                        lpOut += a * (x - lpOut)
                        x = lpOut
                    }
                    let envelope = t < noise.swell
                        ? t / noise.swell
                        : exp(-decay * (t - noise.swell)) * (strike.attack > 0 ? min(1, t / strike.attack) : 1)
                    out[k] += strike.gain * noise.amplitude * envelope * x
                }
            }
        }
        return normalize(out, sampleRate: sampleRate)
    }

    /// Peak to −1 dBFS, the silent tail trimmed, and a 2 ms fade at the end.
    static func normalize(_ x: [Double], sampleRate: Double) -> [Float] {
        let peakValue = x.reduce(0) { max($0, abs($1)) }
        guard peakValue > 0, peakValue.isFinite else { return [] }
        let scale = Double(peak) / peakValue
        let floor = peakValue * pow(10, -floorDB / 20)
        var last = x.count - 1
        while last > 0 && abs(x[last]) < floor { last -= 1 }
        let fade = min(last + 1, Int(0.002 * sampleRate))
        var out = [Float](repeating: 0, count: last + 1)
        for k in 0...last {
            var gain = scale
            let fromEnd = last - k
            if fromEnd < fade { gain *= Double(fromEnd) / Double(fade) }
            out[k] = Float(x[k] * gain)
        }
        return out
    }
}
