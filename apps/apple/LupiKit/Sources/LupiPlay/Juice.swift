import Foundation

/// The juice spec's numbers (plan §5, scale-spec §10.8). Starting values for
/// the tuning pass on the device.
public enum JuiceTuning {
    /// I = clamp((Δv / 2 m/s)^0.6, 0.15, 1).
    public static let referenceSpeed = 2.0
    public static let intensityExponent = 0.6
    public static let minIntensity = 0.15
    /// A collision pair is quiet this long after it fires, seconds (plan §4.4).
    public static let pairQuiet = 0.08
    /// Bounces of one body within this window make a chain; the third and later are softer and higher.
    public static let chainWindow = 1.0
    public static let chainFrom = 3
    public static let chainHaptic = 0.6
    public static let chainPitchStep = 0.05
    /// At most this many haptic events in any one second (plan §5.1).
    public static let hapticsPerSecond = 30
    /// Transients closer than this merge into the first (the web's `MIN_CLICK_GAP_MS`).
    public static let transientMerge = 0.035
    /// One body's sounds closer than this merge (est.).
    public static let bodySoundGap = 0.035
    /// At most this many sound cues in any one second, so a collapsing pile never floods the mixer (est.).
    public static let soundsPerSecond = 24
    /// Playback speed varies by up to ±4 %, so repeats never sound identical.
    public static let pitchJitter = 0.04
    /// The toy span the bank's medium band is pitched for, metres.
    public static let referenceSpan = 0.15
    public static let hitStopIntensity = 0.6
    /// Impacts faster than this, m/s, take slow motion (as do breaks and bank-shot landings).
    public static let slowMotionSpeed = 4.0
    public static let sparksBase = 6
    public static let sparksPerIntensity = 30.0
    public static let breakSparks = 60
    public static let spawnSparks = 8
    /// The surface layer plays under the family at this share of its gain (est.).
    public static let surfaceGain = 0.6
    /// The haptic tail under an impact starts at this share of I (est.).
    public static let tailIntensity = 0.35
}

/// What ARKit's mesh classification says a contact touched (plan §3.3).
public enum SurfaceClass: String, Sendable, Codable, CaseIterable {
    case none, wall, floor, ceiling, table, seat, window, door

    /// The layer under the family: a low thud for walls and floors, a tap for
    /// tables (plan §5.2). Ceilings and doors thud and windows tap (est.).
    public var layer: SoundVoice? {
        switch self {
        case .wall, .floor, .ceiling, .door: .thud
        case .table, .window: .tap
        case .seat, .none: nil
        }
    }
}

/// A Core Haptics event: times in seconds from the start of the pattern,
/// intensity and sharpness 0...1 (`CHHapticEvent.ParameterID`).
public enum HapticEvent: Sendable, Equatable {
    case transient(time: Double, intensity: Double, sharpness: Double)
    /// A continuous event whose intensity ramps from `intensity` to `endIntensity`.
    case continuous(time: Double, duration: Double, intensity: Double, endIntensity: Double, sharpness: Double)

    public var time: Double {
        switch self {
        case let .transient(time, _, _), let .continuous(time, _, _, _, _): time
        }
    }
}

/// One sound to play on the body: a bank voice, when, how loud, how fast.
public struct SoundCue: Sendable, Equatable {
    public var voice: SoundVoice
    /// Seconds after the event.
    public var delay: Double
    /// 0...1, set on the playback controller.
    public var gain: Double
    /// Playback speed; pitch follows it.
    public var rate: Double
}

public enum RingCue: Sendable, Equatable {
    /// The lime ring (kept, delights).
    case lime
    /// A shelf ring fading (knocked off).
    case fade
}

/// What the app shows. Every number is already scaled for motion comfort.
public struct JuiceVisual: Sendable, Equatable {
    public var sparks = 0
    public var sparksDrift = false
    /// Still's static flash ring where sparks would fly.
    public var flashRing = false
    /// Squash for the body (`Squash.hit(direction:amount:)`).
    public var squash = 0.0
    /// Squash for the other body of a collision.
    public var otherSquash = 0.0
    public var hitStop = false
    /// Run `SlowMotion` from now.
    public var slowMotion = false
    public var popIn = false
    public var trail = false
    public var ring: RingCue?
    public var caption = false

    public init() {}
}

public struct JuiceOutput: Sendable, Equatable {
    public var haptics: [HapticEvent] = []
    public var sounds: [SoundCue] = []
    public var visual = JuiceVisual()
    /// I for the hit, 0 for events that are not hits.
    public var intensity = 0.0

    public init() {}
}

/// What the juice needs to know about a body.
public struct JuiceBody: Sendable, Equatable {
    public var id: UInt64
    public var family: ImpactFamily
    public var hapticSharpness: Double
    /// The personality's maximum squash (plan §4.3).
    public var maxSquash: Double
    /// Longest displayed span, metres.
    public var span: Double
    /// `JuiceBody.heft(...)`, scale-spec §10.8.
    public var heft: Double

    public init(id: UInt64, family: ImpactFamily, hapticSharpness: Double, maxSquash: Double, span: Double, heft: Double) {
        self.id = id
        self.family = family
        self.hapticSharpness = hapticSharpness
        self.maxSquash = maxSquash
        self.span = span
        self.heft = heft
    }

    /// From a personality kind, with plan §4.3's squash for it.
    public init(id: UInt64, kind: Personality.Kind, hapticSharpness: Double, span: Double, heft: Double) {
        self.init(id: id, family: ImpactFamily(kind: kind), hapticSharpness: hapticSharpness,
                  maxSquash: Self.maxSquash(kind), span: span, heft: heft)
    }

    /// Plan §4.3's squash on impact.
    public static func maxSquash(_ kind: Personality.Kind) -> Double {
        switch kind {
        case .rigid: 0.06
        case .flexible: 0.18
        case .brittle: 0.03
        case .bouncy: 0.25
        }
    }

    /// Heft `h = log10(1 + log10(M / 1 Da))` (scale-spec §10.8) from `ln M`, or
    /// from `ln ln M` when `ln M` is not finite: water 0.35, C₆₀ 0.59, a googolplex 100.
    public static func heft(lnM: Double, lnlnM: Double) -> Double {
        if lnM.isFinite { return max(0, Foundation.log10(1 + lnM / Foundation.log(10))) }
        return (lnlnM - Foundation.log(Foundation.log(10))) / Foundation.log(10)
    }

    public static func heft(molarMass: Double) -> Double {
        guard molarMass > 0 else { return 0 }
        let lnM = Foundation.log(molarMass)
        return heft(lnM: lnM, lnlnM: Foundation.log(lnM))
    }

    /// Size and heft together: the fundamental scales with (15 cm / span)^0.5
    /// (plan §5.2) and with 0.85^(min(h, 4) − 0.6) (scale-spec §10.8).
    public var pitch: Double {
        let span = min(3, max(0.01, span.isFinite ? span : JuiceTuning.referenceSpan))
        return (JuiceTuning.referenceSpan / span).squareRoot() * Foundation.pow(0.85, min(heft, 4) - 0.6)
    }

    /// scale-spec §10.8: the sub-bass layer's gain.
    public var subBassGain: Double { min(1, max(0, (heft - 0.9) / 2)) }
    /// scale-spec §10.8: the haptic tail, seconds.
    public var hapticTail: Double { 0.040 * (1 + min(max(heft, 0), 4)) }
}

/// Every game moment that makes juice (plan §5.3).
public enum JuiceEvent: Sendable, Equatable {
    case spawn
    case grab
    /// Release speed, m/s.
    case release(speed: Double)
    /// The body hit the room.
    case impact(deltaV: Double, surface: SurfaceClass)
    /// The body hit another body.
    case collision(deltaV: Double, other: JuiceBody)
    case settle
    case kept
    case knockedOff(deltaV: Double)
    /// Fired instead of the impact that broke the body.
    case breakApart(deltaV: Double)
    case snap
    case snapRefused
    /// Built it, bank shot, tower… `slowMotion` for a bank shot's landing.
    case delight(slowMotion: Bool)
    case scaleDetent
}

/// Slow motion for big moments (plan §5.4): the play simulation at quarter
/// speed for 220 ms, easing back over 180 ms. Standard comfort only.
public enum SlowMotion {
    public static let rate = 0.25
    public static let hold = 0.22
    public static let easeBack = 0.18
    /// At most once every this many seconds.
    public static let cooldown = 2.0

    /// The simulation clock's rate `elapsed` seconds after it began.
    public static func rate(at elapsed: Double) -> Double {
        if elapsed < hold { return rate }
        let u = min(1, (elapsed - hold) / easeBack)
        return rate + (1 - rate) * u * u * (3 - 2 * u)
    }
}

public struct JuiceSettings: Sendable, Equatable {
    /// The one "Sound & haptics" toggle, on by default in AR (D11).
    public var soundAndHaptics: Bool
    /// `CHHapticEngine.capabilitiesForHardware().supportsHaptics`: false on iPad.
    public var supportsHaptics: Bool
    public var comfort: MotionComfort

    public init(soundAndHaptics: Bool = true, supportsHaptics: Bool = true, comfort: MotionComfort = .standard) {
        self.soundAndHaptics = soundAndHaptics
        self.supportsHaptics = supportsHaptics
        self.comfort = comfort
    }
}

/// Turns game moments into haptics, sounds and visuals (plan §5), with the
/// rate limits: a pair is quiet for 80 ms after it fires, a body's sounds
/// merge within 35 ms, and globally at most 30 haptic events per second with
/// transients closer than 35 ms merged. Pure and deterministic for a seed.
public struct JuiceDirector: Sendable {
    public var settings: JuiceSettings

    var pairFired: [PairKey: Double] = [:]
    var bounces: [UInt64: [Double]] = [:]
    var bodySound: [UInt64: Double] = [:]
    var hapticTimes: [Double] = []
    var soundTimes: [Double] = []
    var lastTransient = -Double.infinity
    var lastSlowMotion = -Double.infinity
    var random: SoundRandom

    struct PairKey: Hashable, Sendable {
        var a: UInt64
        var b: UInt64

        init(_ x: UInt64, _ y: UInt64) {
            a = min(x, y)
            b = max(x, y)
        }

        /// The room is one body.
        static func world(_ id: UInt64) -> PairKey { PairKey(id, .max) }
    }

    public init(settings: JuiceSettings = JuiceSettings(), seed: UInt64 = 0) {
        self.settings = settings
        random = SoundRandom(seed: seed)
    }

    /// I = clamp((Δv / 2 m/s)^0.6, 0.15, 1.0) (plan §5.1).
    public static func intensity(deltaV: Double) -> Double {
        guard deltaV > 0, deltaV.isFinite else { return deltaV.isFinite ? JuiceTuning.minIntensity : 1 }
        let raw = Foundation.pow(deltaV / JuiceTuning.referenceSpeed, JuiceTuning.intensityExponent)
        return min(1, max(JuiceTuning.minIntensity, raw))
    }

    /// Drops what the director remembers about a body that left play.
    public mutating func forget(_ id: UInt64) {
        bounces[id] = nil
        bodySound[id] = nil
        pairFired = pairFired.filter { $0.key.a != id && $0.key.b != id }
    }

    /// The juice for `event` on `body` at `time` (seconds, monotonic). Nil
    /// when the hit is swallowed by its pair's quiet time.
    public mutating func fire(_ event: JuiceEvent, body: JuiceBody, at time: Double) -> JuiceOutput? {
        let comfort = settings.comfort
        var out = JuiceOutput()
        var haptics: [HapticEvent] = []
        var sounds: [SoundCue] = []

        switch event {
        case .spawn:
            haptics = [.transient(time: 0, intensity: 0.4, sharpness: 0.5)]
            sounds = [cue(.pop, gain: 0.6)]
            out.visual.popIn = true
            setSparks(&out.visual, JuiceTuning.spawnSparks)
        case .grab:
            haptics = [.transient(time: 0, intensity: 0.3, sharpness: 0.6)]
            sounds = [cue(.tick, gain: 0.5)]
        case let .release(speed):
            let s = min(1, max(0, speed / ThrowTuning.maxSpeed))
            if speed > 0.3 { sounds = [cue(.whoosh, gain: max(0.15, s), rate: 0.9 + 0.2 * s)] }
            out.visual.trail = speed > 0.5 && comfort != .still
        case let .impact(deltaV, surface):
            guard claimPair(.world(body.id), at: time) else { return nil }
            let i = Self.intensity(deltaV: deltaV)
            out.intensity = i
            let chain = bounce(body.id, at: time)
            let chained = chain >= JuiceTuning.chainFrom
            let hapticI = chained ? JuiceTuning.chainHaptic * i : i
            haptics = [.transient(time: 0, intensity: hapticI, sharpness: body.hapticSharpness), tail(body, i)]
            let chainPitch = chained ? 1 + JuiceTuning.chainPitchStep * Double(chain - JuiceTuning.chainFrom + 1) : 1
            sounds = family(body, intensity: i, gain: i, pitch: chainPitch)
            if let layer = surface.layer { sounds.append(cue(layer, gain: JuiceTuning.surfaceGain * i)) }
            if body.subBassGain > 0 { sounds.append(cue(.subBass, gain: body.subBassGain * i)) }
            hit(&out.visual, body: body, intensity: i, deltaV: deltaV, at: time)
        case let .collision(deltaV, other):
            guard claimPair(PairKey(body.id, other.id), at: time) else { return nil }
            let i = Self.intensity(deltaV: deltaV)
            out.intensity = i
            let sharpness = (body.hapticSharpness + other.hapticSharpness) / 2
            haptics = [.transient(time: 0, intensity: i, sharpness: sharpness), tail(body.heft >= other.heft ? body : other, i)]
            sounds = family(body, intensity: i, gain: 0.5 * i) + family(other, intensity: i, gain: 0.5 * i)
            let heavy = body.heft >= other.heft ? body : other
            if heavy.subBassGain > 0 { sounds.append(cue(.subBass, gain: heavy.subBassGain * i)) }
            hit(&out.visual, body: body, intensity: i, deltaV: deltaV, at: time)
            out.visual.otherSquash = Squash.amount(intensity: i, maxSquash: other.maxSquash, comfort: comfort)
        case .settle:
            haptics = [.transient(time: 0, intensity: 0.2, sharpness: 0.2)]
            sounds = [cue(.tock, gain: 0.5)]
        case .kept:
            haptics = [.transient(time: 0, intensity: 0.35, sharpness: 0.2), .transient(time: 0.09, intensity: 0.6, sharpness: 0.6)]
            sounds = [cue(.kept, gain: 0.7, jitter: false)]
            out.visual.ring = .lime
        case let .knockedOff(deltaV):
            guard claimPair(.world(body.id), at: time) else { return nil }
            let i = Self.intensity(deltaV: deltaV)
            out.intensity = i
            haptics = [.transient(time: 0, intensity: 0.5, sharpness: 0.8)]
            sounds = family(body, intensity: i, gain: i)
            out.visual.ring = .fade
        case .breakApart:
            claimPairAlways(.world(body.id), at: time)
            out.intensity = 1
            haptics = [
                .transient(time: 0, intensity: 1, sharpness: 1),
                .continuous(time: 0.01, duration: 0.12, intensity: 0.6, endIntensity: 0, sharpness: 0.3),
            ]
            sounds = family(body, intensity: 1, gain: 1) + [cue(.shatter, gain: 0.8)]
            if body.subBassGain > 0 { sounds.append(cue(.subBass, gain: body.subBassGain)) }
            setSparks(&out.visual, JuiceTuning.breakSparks)
            out.visual.squash = Squash.amount(intensity: 1, maxSquash: body.maxSquash, comfort: comfort)
            if takeSlowMotion(at: time) { out.visual.slowMotion = true } else { out.visual.hitStop = comfort.allowsTimeEffects }
        case .snap:
            haptics = [.transient(time: 0, intensity: 0.5, sharpness: 0.9), .transient(time: 0.04, intensity: 0.5, sharpness: 0.9)]
            sounds = [cue(.snap, gain: 0.7)]
        case .snapRefused:
            haptics = [.transient(time: 0, intensity: 0.3, sharpness: 0.2)]
            sounds = [cue(.bump, gain: 0.5)]
        case let .delight(slow):
            haptics = [0.4, 0.5, 0.6].enumerated().map { .transient(time: 0.11 * Double($0.offset), intensity: $0.element, sharpness: 0.5) }
            sounds = [cue(.delight, gain: 0.7, jitter: false)]
            out.visual.ring = .lime
            out.visual.caption = true
            if slow { out.visual.slowMotion = takeSlowMotion(at: time) }
        case .scaleDetent:
            haptics = [.transient(time: 0, intensity: 0.3, sharpness: 0.9)]
            sounds = [cue(.detent, gain: 0.5, jitter: false)]
        }

        if settings.soundAndHaptics {
            if settings.supportsHaptics { out.haptics = limitHaptics(haptics, at: time) }
            out.sounds = limitSounds(sounds, body: body.id, at: time)
        }
        return out
    }

    // MARK: - Pieces

    mutating func cue(_ voice: SoundVoice, gain: Double, rate: Double = 1, jitter: Bool = true) -> SoundCue {
        let wobble = jitter ? 1 + JuiceTuning.pitchJitter * random.signed() : 1
        return SoundCue(voice: voice, delay: 0, gain: min(1, max(0, gain)), rate: rate * wobble)
    }

    /// The body's family at its size band and intensity layer, the rest of its pitch as playback rate.
    mutating func family(_ body: JuiceBody, intensity: Double, gain: Double, pitch: Double = 1) -> [SoundCue] {
        let target = body.pitch * pitch
        let band = SizeBand.nearest(pitch: target)
        let rate = min(2, max(0.5, target / band.pitch))
        return [cue(.impact(body.family, band, IntensityLayer(intensity: intensity)), gain: gain, rate: rate, jitter: true)]
    }

    func tail(_ body: JuiceBody, _ intensity: Double) -> HapticEvent {
        .continuous(time: 0.01, duration: body.hapticTail, intensity: JuiceTuning.tailIntensity * intensity,
                    endIntensity: 0, sharpness: 0.15)
    }

    mutating func hit(_ visual: inout JuiceVisual, body: JuiceBody, intensity: Double, deltaV: Double, at time: Double) {
        let comfort = settings.comfort
        setSparks(&visual, JuiceTuning.sparksBase + Int((JuiceTuning.sparksPerIntensity * intensity).rounded()))
        visual.squash = Squash.amount(intensity: intensity, maxSquash: body.maxSquash, comfort: comfort)
        if deltaV > JuiceTuning.slowMotionSpeed, takeSlowMotion(at: time) {
            visual.slowMotion = true
        } else {
            visual.hitStop = comfort.allowsTimeEffects && intensity >= JuiceTuning.hitStopIntensity
        }
    }

    func setSparks(_ visual: inout JuiceVisual, _ count: Int) {
        let comfort = settings.comfort
        visual.sparks = Int((Double(count) * comfort.sparkScale).rounded())
        visual.sparksDrift = comfort.sparksDrift
        visual.flashRing = comfort.flashRingInsteadOfSparks && count > 0
    }

    mutating func takeSlowMotion(at time: Double) -> Bool {
        guard settings.comfort.allowsTimeEffects, time - lastSlowMotion >= SlowMotion.cooldown else { return false }
        lastSlowMotion = time
        return true
    }

    mutating func claimPair(_ key: PairKey, at time: Double) -> Bool {
        if let last = pairFired[key], time - last < JuiceTuning.pairQuiet { return false }
        pairFired[key] = time
        return true
    }

    mutating func claimPairAlways(_ key: PairKey, at time: Double) {
        pairFired[key] = time
    }

    /// This impact's place in the body's bounce chain (1 for the first in a second).
    mutating func bounce(_ id: UInt64, at time: Double) -> Int {
        var times = (bounces[id] ?? []).filter { time - $0 <= JuiceTuning.chainWindow }
        times.append(time)
        bounces[id] = times
        return times.count
    }

    mutating func limitHaptics(_ events: [HapticEvent], at time: Double) -> [HapticEvent] {
        hapticTimes.removeAll { time - $0 >= 1 }
        var kept: [HapticEvent] = []
        for event in events {
            let at = time + event.time
            if case .transient = event {
                if at - lastTransient < JuiceTuning.transientMerge { continue }
            }
            guard hapticTimes.filter({ at - $0 < 1 }).count < JuiceTuning.hapticsPerSecond else { continue }
            if case .transient = event { lastTransient = at }
            hapticTimes.append(at)
            kept.append(event)
        }
        return kept
    }

    mutating func limitSounds(_ cues: [SoundCue], body: UInt64, at time: Double) -> [SoundCue] {
        guard !cues.isEmpty else { return [] }
        if let last = bodySound[body], time - last < JuiceTuning.bodySoundGap { return [] }
        soundTimes.removeAll { time - $0 >= 1 }
        guard soundTimes.count < JuiceTuning.soundsPerSecond else { return [] }
        bodySound[body] = time
        soundTimes.append(time)
        return cues
    }
}
