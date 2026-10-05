import Foundation

/// Every number the four impact families and the cage ring are built from (plan §5.2, §8 M4),
/// in one value: the tuning pass on the device changes it live, renders the bank again and
/// copies it back as JSON, so the next build is one paste. `v1` is the starting point (est.);
/// the partial ratios and decays are plan §5.2's table.
public struct SoundTuning: Sendable, Equatable, Codable {
    /// One modal impact: damped partials, a noise transient, and the touches that make each
    /// family itself (a clack's chatter, a tink's shimmer, a boing's pitch drop).
    public struct Family: Sendable, Equatable, Codable {
        /// The lowest partial, Hz, at the medium size band.
        public var fundamental: Double
        /// Partial frequencies over the fundamental.
        public var ratios: [Double]
        /// The fundamental's fall to −60 dB, seconds; higher partials fall in t60 / ratio^damping.
        public var t60: Double
        public var damping: Double
        /// Partial amplitudes of the hard and the soft layer.
        public var hard: [Double]
        public var soft: [Double]
        /// Pitch starts this much higher and relaxes over `glideTime` (a boing's drop).
        public var glide: Double
        public var glideTime: Double
        /// The noise transient: its amplitude in each layer, its decay, and its band at the
        /// medium size band (nil for no filter).
        public var noiseHard: Double
        public var noiseSoft: Double
        public var noiseT60: Double
        public var highpass: Double?
        public var lowpass: Double?
        /// A second, softer strike this long after the first (hard plastic chatters), 0 for none.
        public var chatter: Double
        public var chatterGain: Double
        /// A twin of the fundamental detuned by this ratio, so the two beat (glass shimmers), 0 for none.
        public var shimmer: Double

        public init(
            fundamental: Double, ratios: [Double], t60: Double, damping: Double, hard: [Double], soft: [Double],
            glide: Double = 0, glideTime: Double = 0.06, noiseHard: Double, noiseSoft: Double, noiseT60: Double,
            highpass: Double? = nil, lowpass: Double? = nil, chatter: Double = 0, chatterGain: Double = 0, shimmer: Double = 0
        ) {
            self.fundamental = fundamental
            self.ratios = ratios
            self.t60 = t60
            self.damping = damping
            self.hard = hard
            self.soft = soft
            self.glide = glide
            self.glideTime = glideTime
            self.noiseHard = noiseHard
            self.noiseSoft = noiseSoft
            self.noiseT60 = noiseT60
            self.highpass = highpass
            self.lowpass = lowpass
            self.chatter = chatter
            self.chatterGain = chatterGain
            self.shimmer = shimmer
        }

        /// The family with its fundamental and every decay scaled: the two knobs the tuning panel offers first.
        public func scaled(pitch: Double = 1, decay: Double = 1) -> Family {
            var f = self
            f.fundamental *= pitch
            f.t60 *= decay
            f.noiseT60 *= decay
            return f
        }
    }

    public var clack: Family
    public var thwap: Family
    public var tink: Family
    public var boing: Family
    /// The ring a bouncy cage makes after it lands.
    public var ring: Family
    /// A flexible molecule's loose end landing a beat after the body.
    public var flap: Family

    public func family(_ f: ImpactFamily) -> Family {
        switch f {
        case .clack: clack
        case .thwap: thwap
        case .tink: tink
        case .boing: boing
        }
    }

    public mutating func set(_ f: ImpactFamily, _ value: Family) {
        switch f {
        case .clack: clack = value
        case .thwap: thwap = value
        case .tink: tink = value
        case .boing: boing = value
        }
    }

    public static let v1 = SoundTuning(
        // Hard plastic: bright partials, a sharp click of high noise, and a chatter as the
        // second corner touches 7 ms later.
        clack: Family(
            fundamental: 1_100, ratios: [1, 2.32, 4.25], t60: 0.080, damping: 0.5, hard: [1, 0.7, 0.45], soft: [1, 0.45, 0.2],
            noiseHard: 0.6, noiseSoft: 0.25, noiseT60: 0.006, highpass: 2_000, chatter: 0.007, chatterGain: 0.35
        ),
        // Rubber: dull, noisy, short, with a little downward slap in pitch.
        thwap: Family(
            fundamental: 220, ratios: [1, 1.6], t60: 0.050, damping: 0.3, hard: [1, 0.5], soft: [1, 0.3],
            glide: 0.12, glideTime: 0.012, noiseHard: 0.9, noiseSoft: 0.6, noiseT60: 0.030, lowpass: 1_200
        ),
        // Glass: inharmonic and ringing, with a detuned twin that beats.
        tink: Family(
            fundamental: 2_100, ratios: [1, 2.76, 5.40], t60: 0.250, damping: 0.3, hard: [1, 0.8, 0.55], soft: [1, 0.5, 0.25],
            noiseHard: 0.3, noiseSoft: 0.12, noiseT60: 0.003, highpass: 3_000, shimmer: 0.006
        ),
        // A rubber ball: the pitch drops as it springs back.
        boing: Family(
            fundamental: 330, ratios: [1, 1.5], t60: 0.180, damping: 0.2, hard: [1, 0.35], soft: [1, 0.2],
            glide: 0.35, glideTime: 0.06, noiseHard: 0.2, noiseSoft: 0.1, noiseT60: 0.005, lowpass: 2_000
        ),
        // A cage rings like a small bell: the low modes of a vibrating sphere (1 : 1.52 : 2.09 :
        // 2.72, as Earth's own free oscillations 0S2 to 0S5), a game timbre, not a measurement.
        ring: Family(
            fundamental: 640, ratios: [1, 1.52, 2.09, 2.72], t60: 0.65, damping: 0.6, hard: [1, 0.6, 0.4, 0.25], soft: [1, 0.4, 0.2, 0.1],
            noiseHard: 0.05, noiseSoft: 0.02, noiseT60: 0.004, highpass: 2_500, shimmer: 0.004
        ),
        flap: Family(
            fundamental: 150, ratios: [1, 1.7], t60: 0.035, damping: 0.3, hard: [1, 0.4], soft: [1, 0.4],
            glide: 0.2, glideTime: 0.01, noiseHard: 0.7, noiseSoft: 0.7, noiseT60: 0.02, lowpass: 900
        )
    )
}
