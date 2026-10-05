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

/// The two τ controllers of §9.3, evaluated every 0.5 s and kept in [τ_min, 8].
public struct TauController: Sendable {
    public private(set) var tau: Double
    public var minimum: Double
    public let maximum = 8.0
    private var windowStart: Double?
    private var droppedInWindow = false
    private var lastDrop: Double = -.infinity
    private var underBudgetSince: Double?
    private var lastDecay: Double = -.infinity

    public init(budgets: Budgets) {
        tau = budgets.tau
        minimum = budgets.tauMinimum
    }

    /// Feeds one frame: its interval (ARFrame timestamp difference), the display period, whether
    /// the cut was over budget, and the largest fraction of any budget it used.
    public mutating func frame(at time: Double, interval: Double, displayPeriod: Double, overBudget: Bool, usage: Double) {
        if overBudget { tau *= 1.25 }
        if interval > 1.5 * displayPeriod {
            droppedInWindow = true
            lastDrop = time
        }
        if usage < 0.8 && !overBudget {
            if underBudgetSince == nil { underBudgetSince = time }
        } else {
            underBudgetSince = nil
        }
        let start = windowStart ?? time
        windowStart = start
        if time - start >= 0.5 {
            if droppedInWindow { tau *= 1.25 }
            if time - lastDrop >= 2, time - lastDecay >= 2 {
                tau *= 0.95
                lastDecay = time
            }
            if let since = underBudgetSince, time - since >= 0.5 {
                tau *= 0.9
                underBudgetSince = time
            }
            windowStart = time
            droppedInWindow = false
        }
        tau = min(maximum, max(minimum, tau))
    }

    /// LupiEngine's own pass GPU time toward 8 ms (M3b): τ ← τ · exp(0.5 (t − 8 ms) / 8 ms).
    public mutating func gpuTime(_ milliseconds: Double) {
        tau = min(maximum, max(minimum, tau * exp(0.5 * (milliseconds - 8) / 8)))
    }
}
