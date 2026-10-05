import Foundation
import LupiPlay
import LupiScale

/// The thermal policy's numbers (plan §7.4, scale-spec §9.3, est.).
public enum ThermalTuning {
    /// After this long at critical, the oldest loose pieces poof down to `criticalToys`.
    public static let poofAfter = 30.0
    public static let criticalToys = 24
    /// Back to 60 fps only after this long below critical, so a state on the edge does not flap.
    public static let recoverAfter = 10.0
}

/// What the device may spend at one moment of the thermal policy (plan §7.4). Degradation comes
/// in the spec's order: τ up and budgets down (the cut's thermal column, already in `Budgets`),
/// then at critical 30 fps (only with spike A5's toggle), slow motion and particles off, then
/// after a while the oldest loose pieces poof. Exact counts, paths and keeps never degrade.
public struct ThermalStage: Sendable, Equatable {
    public var level: ThermalLevel
    /// Spark bursts, flash rings and the lime ring's particles.
    public var particles: Bool
    public var slowMotion: Bool
    /// The camera's video format: 60, or 30 at critical when A5 allows it.
    public var frameRate: Int
    /// Loose toys at most; beyond, the oldest loose pieces poof.
    public var toyLimit: Int

    public static let full = ThermalStage(level: .nominal, particles: true, slowMotion: true, frameRate: 60, toyLimit: PlayTuning.maxDynamicBodies)

    /// "thermal critical: 30 fps, no particles, no slow motion, toys ≤ 24".
    public var line: String {
        var parts = ["thermal \(level)"]
        if frameRate != 60 { parts.append("\(frameRate) fps") }
        if !particles { parts.append("no particles") }
        if !slowMotion { parts.append("no slow motion") }
        if toyLimit < PlayTuning.maxDynamicBodies { parts.append("toys ≤ \(toyLimit)") }
        return parts.joined(separator: parts.count > 1 ? ", " : "")
    }
}

/// Follows `ProcessInfo.thermalState` through time and says what this moment allows.
public struct ThermalPolicy: Sendable, Equatable {
    /// Spike A5: may the session drop to a 30 fps video format? Off until A5 shows tracking
    /// survives the switch; without it the 30 fps step is skipped (scale-spec §9.3).
    public var allowsThirtyFPS = false
    public private(set) var stage = ThermalStage.full
    var criticalSince: Double?
    var belowCriticalSince: Double?

    public init(allowsThirtyFPS: Bool = false) {
        self.allowsThirtyFPS = allowsThirtyFPS
    }

    public mutating func update(_ level: ThermalLevel, now: Double) -> ThermalStage {
        if level == .critical {
            if criticalSince == nil { criticalSince = now }
            belowCriticalSince = nil
        } else {
            criticalSince = nil
            if belowCriticalSince == nil { belowCriticalSince = now }
        }
        var next = ThermalStage.full
        next.level = level
        if level == .critical {
            next.particles = false
            next.slowMotion = false
            next.frameRate = allowsThirtyFPS ? 30 : 60
            if let since = criticalSince, now - since >= ThermalTuning.poofAfter { next.toyLimit = ThermalTuning.criticalToys }
        } else if stage.frameRate == 30, allowsThirtyFPS, let since = belowCriticalSince, now - since < ThermalTuning.recoverAfter {
            // Cooling down: stay at 30 a while before the session runs at 60 again.
            next.frameRate = 30
        }
        stage = next
        return next
    }
}

extension PlaySession {
    /// The thermal policy's stage this frame (plan §7.4).
    public var thermalStage: ThermalStage { thermalPolicy.stage }

    /// Applies the stage to a juice output: no particles and no slow motion when it says so.
    func thermalJuice(_ output: JuiceOutput) -> JuiceOutput {
        let stage = thermalPolicy.stage
        var o = output
        if !stage.particles {
            o.visual.sparks = 0
            o.visual.flashRing = false
            o.visual.ring = nil
        }
        if !stage.slowMotion && o.visual.slowMotion {
            o.visual.slowMotion = false
            o.visual.hitStop = settings.comfort.allowsTimeEffects
        }
        return o
    }

    /// The oldest loose pieces poof while there are more toys than the stage allows. Only pieces
    /// of breaks that nobody holds and nobody kept: whole molecules stay (plan §7.4 step 5).
    mutating func shedLoosePieces() {
        let limit = thermalPolicy.stage.toyLimit
        guard toyCount > limit else { return }
        let pieces = bodyOrder.compactMap { bodies[$0] }.filter {
            $0.isToy && !$0.pinned && $0.brokenFrom != nil && $0.trophyID == nil && $0.id != grab?.body && $0.id != pinch?.body
        }
        for piece in pieces.prefix(toyCount - limit) { remove(piece.id, poof: true) }
    }
}
