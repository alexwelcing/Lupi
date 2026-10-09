import Foundation

/// The four impact families (plan §5.2), one per personality kind (plan §4.3).
public enum ImpactFamily: String, Sendable, Codable, CaseIterable {
    /// Hard plastic, bright: rigid.
    case clack
    /// Rubber, dull, noisy: flexible.
    case thwap
    /// Glass, ringing, inharmonic: brittle.
    case tink
    /// Rubber ball with a pitch drop: bouncy.
    case boing

    public init(kind: Personality.Kind) {
        switch kind {
        case .rigid: self = .clack
        case .flexible: self = .thwap
        case .brittle: self = .tink
        case .bouncy: self = .boing
        }
    }
}

/// Three pitch bands per family, so playback rate stays near 1 (plan §5.2).
public enum SizeBand: String, Sendable, Codable, CaseIterable {
    case small
    case medium
    case large

    /// The band's pitch relative to a 15 cm toy (est.).
    public var pitch: Double {
        switch self {
        case .small: 1.4
        case .medium: 1
        case .large: 0.7
        }
    }

    /// The band nearest `pitch` on a log scale.
    public static func nearest(pitch: Double) -> SizeBand {
        guard pitch > 0, pitch.isFinite else { return .medium }
        let target = Foundation.log(pitch)
        return allCases.min { abs(Foundation.log($0.pitch) - target) < abs(Foundation.log($1.pitch) - target) }!
    }
}

/// Two intensity layers per family and band: a soft, darker hit and a hard, brighter one.
public enum IntensityLayer: String, Sendable, Codable, CaseIterable {
    case soft
    case hard

    /// Impact intensity at or above this plays the hard layer (est.).
    public static let hardFrom = 0.5

    public init(intensity: Double) {
        self = intensity >= Self.hardFrom ? .hard : .soft
    }
}

/// Every sound the game plays, all synthesized (plan §5.2, §5.3; scale-spec §10.8).
public enum SoundVoice: Sendable, Hashable, Codable {
    case impact(ImpactFamily, SizeBand, IntensityLayer)
    /// Surface layers: a low thud for walls and floors, a tap for tables.
    case thud
    case tap
    /// The heft layer under heavy things (scale-spec §10.8).
    case subBass
    /// Spawn.
    case pop
    /// Grab.
    case tick
    /// Release, scaled by speed.
    case whoosh
    /// Settle.
    case tock
    /// Pinned to a shelf: a two-note chime.
    case kept
    /// The layer over a break's crack.
    case shatter
    /// An atom joins: click-clack.
    case snap
    /// A snap refused: a dull bump.
    case bump
    /// Built it, and the other delights: three rising notes.
    case delight
    /// A scale detent: the house click.
    case detent
    /// A bouncy cage rings after it lands, like a bell (plan §8 M4), in the size band's pitch.
    case ring(SizeBand)
    /// A flexible molecule's loose end landing after the body: a soft rubber flap.
    case flap
    /// A brittle molecule hit close to its break: a few glassy grains, a warning.
    case crackle

    /// Every voice a bank renders: 4 families × 3 bands × 2 layers, the rest, then the
    /// personality layers.
    public static let all: [SoundVoice] = {
        var voices: [SoundVoice] = []
        for family in ImpactFamily.allCases {
            for band in SizeBand.allCases {
                for layer in IntensityLayer.allCases { voices.append(.impact(family, band, layer)) }
            }
        }
        voices += [.thud, .tap, .subBass, .pop, .tick, .whoosh, .tock, .kept, .shatter, .snap, .bump, .delight, .detent]
        return voices + SizeBand.allCases.map { .ring($0) } + [.flap, .crackle]
    }()

    /// A stable name, for the app's resource names and logs: "impact.clack.medium.hard", "whoosh".
    public var name: String {
        switch self {
        case let .impact(family, band, layer): "impact.\(family.rawValue).\(band.rawValue).\(layer.rawValue)"
        case .thud: "thud"
        case .tap: "tap"
        case .subBass: "subBass"
        case .pop: "pop"
        case .tick: "tick"
        case .whoosh: "whoosh"
        case .tock: "tock"
        case .kept: "kept"
        case .shatter: "shatter"
        case .snap: "snap"
        case .bump: "bump"
        case .delight: "delight"
        case .detent: "detent"
        case let .ring(band): "ring.\(band.rawValue)"
        case .flap: "flap"
        case .crackle: "crackle"
        }
    }
}
