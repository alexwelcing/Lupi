import Foundation

/// The device's thermal state, as `ProcessInfo.ThermalState` reports it. Nominal plays as fair.
public enum ThermalLevel: Sendable, CaseIterable {
    case nominal, fair, serious, critical
}

/// Per-frame budgets of the cut (§9.3). Starting values, **est.**: spikes S1, S2, S7 and S10
/// replace them with measurements.
public struct Budgets: Sendable, Hashable {
    /// τ, the screen-space error threshold in pixels.
    public var tau: Double
    public var visits: Int
    public var items: Int
    /// Atoms drawn by RealityKit instancing (before LupiEngine).
    public var instancedAtoms: Int
    /// Atoms drawn by LupiEngine impostors (M3b).
    public var engineAtoms: Int
    public var boxesAndSplats: Int
    /// Leaf materializations per frame (background).
    public var materializations: Int
    /// Merged-mesh builds per frame, off the main actor.
    public var meshBuilds: Int
    /// The resident scale cache, bytes; 0 means "10 % of available memory, capped" (decided by the app).
    public var residentBytes: Int
    /// τ_min for the controllers (§9.3).
    public var tauMinimum: Double

    public init(
        tau: Double, visits: Int, items: Int, instancedAtoms: Int, engineAtoms: Int, boxesAndSplats: Int,
        materializations: Int, meshBuilds: Int, residentBytes: Int, tauMinimum: Double
    ) {
        self.tau = tau
        self.visits = visits
        self.items = items
        self.instancedAtoms = instancedAtoms
        self.engineAtoms = engineAtoms
        self.boxesAndSplats = boxesAndSplats
        self.materializations = materializations
        self.meshBuilds = meshBuilds
        self.residentBytes = residentBytes
        self.tauMinimum = tauMinimum
    }

    /// The iPhone 15 Pro (A17 Pro) column of §9.3 for a thermal level.
    public static func iPhone15Pro(_ thermal: ThermalLevel) -> Budgets {
        let mb = 1 << 20
        switch thermal {
        case .nominal, .fair:
            return Budgets(tau: 1.5, visits: 8192, items: 4096, instancedAtoms: 5000, engineAtoms: 150_000, boxesAndSplats: 32_000,
                           materializations: 8, meshBuilds: 1, residentBytes: 192 * mb, tauMinimum: 1.0)
        case .serious:
            return Budgets(tau: 1.5, visits: 6144, items: 3072, instancedAtoms: 3000, engineAtoms: 75_000, boxesAndSplats: 24_000,
                           materializations: 4, meshBuilds: 1, residentBytes: 192 * mb, tauMinimum: 1.5)
        case .critical:
            return Budgets(tau: 2.0, visits: 4096, items: 2048, instancedAtoms: 2000, engineAtoms: 50_000, boxesAndSplats: 16_000,
                           materializations: 2, meshBuilds: 1, residentBytes: 192 * mb, tauMinimum: 2.0)
        }
    }

    /// The iPad Pro's fair column.
    public static func iPadPro(_ thermal: ThermalLevel) -> Budgets {
        switch thermal {
        case .nominal, .fair:
            return Budgets(tau: 1.5, visits: 12_288, items: 8192, instancedAtoms: 8000, engineAtoms: 250_000, boxesAndSplats: 48_000,
                           materializations: 12, meshBuilds: 2, residentBytes: 384 << 20, tauMinimum: 1.0)
        default:
            // Only the fair column is given; hotter states fall back to the iPhone's.
            var b = iPhone15Pro(thermal)
            b.residentBytes = 384 << 20
            return b
        }
    }
}

/// The two τ controllers of §9.3, each kept in [τ_min, 8]; τ is the larger of the two.
///
/// The frame-time controller judges 0.5 s windows: a window with a dropped frame multiplies it by
/// 1.25, any other window by 0.95 once 2 s have passed without a drop (counted from the first
/// frame). The budget controller reacts to an over-budget cut at once, for the next frame, and
/// multiplies by 0.9 for each 0.5 s in which every budget stays under 80 %.
public struct TauController: Sendable {
    public var tau: Double { max(frameTau, budgetTau) }
    /// τ_min, the thermal column's value; τ only rises to meet a new one.
    public var minimum: Double {
        didSet {
            frameTau = clamp(frameTau)
            budgetTau = clamp(budgetTau)
        }
    }
    public let maximum = 8.0
    public private(set) var frameTau: Double
    public private(set) var budgetTau: Double
    private var windowStart: Double?
    private var droppedInWindow = false
    private var lastDrop: Double?
    private var calmSince: Double?

    public init(budgets: Budgets) {
        minimum = budgets.tauMinimum
        frameTau = min(8, max(budgets.tauMinimum, budgets.tau))
        budgetTau = frameTau
    }

    /// Feeds one frame: its interval (ARFrame timestamp difference), the display period, whether
    /// the cut was over budget, and the largest fraction of the item, box and splat, instanced
    /// atom and visit budgets it used.
    public mutating func frame(at time: Double, interval: Double, displayPeriod: Double, overBudget: Bool, usage: Double) {
        if interval > 1.5 * displayPeriod {
            droppedInWindow = true
            lastDrop = time
        }
        let quietSince = lastDrop ?? time
        lastDrop = quietSince
        let start = windowStart ?? time
        windowStart = start
        if time - start >= 0.5 {
            if droppedInWindow {
                frameTau = clamp(frameTau * 1.25)
            } else if time - quietSince >= 2 {
                frameTau = clamp(frameTau * 0.95)
            }
            windowStart = time
            droppedInWindow = false
        }
        if overBudget {
            budgetTau = clamp(budgetTau * 1.25)
            calmSince = nil
        } else if usage >= 0.8 {
            calmSince = nil
        } else {
            let since = calmSince ?? time
            calmSince = since
            if time - since >= 0.5 {
                budgetTau = clamp(budgetTau * 0.9)
                calmSince = time
            }
        }
    }

    private func clamp(_ t: Double) -> Double { min(maximum, max(minimum, t)) }

    /// LupiEngine's own pass GPU time toward 8 ms (M3b): τ ← τ · exp(0.5 (t − 8 ms) / 8 ms).
    public mutating func gpuTime(_ milliseconds: Double) {
        frameTau = clamp(frameTau * exp(0.5 * (milliseconds - 8) / 8))
    }
}
