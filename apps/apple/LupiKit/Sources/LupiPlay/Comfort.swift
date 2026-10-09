/// Motion comfort (plan §5.5, D11), the web's three levels. It governs what
/// moves on its own; sound and haptics never depend on it, because they are
/// not motion (`packages/ui/src/play/feedback.ts`).
///
/// Still keeps the player's own throw, capped to a short lob, and removes
/// everything that moves by itself. Plan §11 item 6 asks the owner to confirm it.
public enum MotionComfort: String, Sendable, Codable, CaseIterable {
    case standard
    case gentle
    case still

    /// Still when Reduce Motion is on and the player chose nothing, else Standard.
    public static func defaultLevel(reduceMotion: Bool) -> MotionComfort {
        reduceMotion ? .still : .standard
    }

    /// The fastest release, m/s. Standard is the throw's own 8 m/s cap.
    public var throwSpeedCap: Double {
        switch self {
        case .standard: ThrowTuning.maxSpeed
        case .gentle: 4
        case .still: 1.5
        }
    }

    /// Multiplies spin on release.
    public var spinScale: Double { scale(full: 1, gentle: 0.5) }
    /// Multiplies squash and wobble.
    public var squashScale: Double { scale(full: 1, gentle: 0.5) }
    /// Multiplies the spark count.
    public var sparkScale: Double { scale(full: 1, gentle: 0.5) }
    /// Sparks keep drifting after the burst.
    public var sparksDrift: Bool { self == .standard }
    /// Still shows a static flash ring where the others throw sparks.
    public var flashRingInsteadOfSparks: Bool { self == .still }
    /// Hit-stop and slow motion.
    public var allowsTimeEffects: Bool { self == .standard }
    /// Scale glides animate; Still cuts.
    public var animatesGlides: Bool { self != .still }
    /// Two-finger flight (scale-spec §8.8): Gentle halves it, Still cuts between detents.
    public var flightSpeedScale: Double { scale(full: 1, gentle: 0.5) }

    private func scale(full: Double, gentle: Double) -> Double {
        switch self {
        case .standard: full
        case .gentle: gentle
        case .still: 0
        }
    }
}
