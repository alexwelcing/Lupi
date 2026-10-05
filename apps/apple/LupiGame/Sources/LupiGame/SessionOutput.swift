import Foundation
import LupiChem
import LupiPlay
import LupiScale
import LupiScaleCore

/// The plaque of the selected body (plan §4.7): only true facts.
public struct Plaque: Sendable, Equatable {
    public var name: String
    public var formula: String
    /// The exact count, printed one way everywhere (scale-spec §5.4).
    public var atoms: String
    /// The personality's first reason: "Brittle: its O–O bond is weak (142 kJ/mol)".
    public var personality: String
    /// Every reason (contracts.md §3.3 rule 8), the second when nothing can snap.
    public var reasons: [String]
    /// How it plays: "Bounces, and its cage rings".
    public var feel: String
    /// "shown 1.5 × 10^8 times life size" (scale-spec §8.7).
    public var magnification: String
    public var feltMassKg: Double
    public var brokenFrom: String?
    /// "O, H, H": what a built body was snapped from, in order (contracts.md §1.3's story).
    public var builtFrom: String?
    /// One tap of Fill would add hydrogens (plan §4.5).
    public var canFill: Bool
    public var sizeState: SizeState
    /// The true mass, exact to its printed digits (plan §4.7): "48.6 t", "0.200 g".
    public var trueMass: String
    /// Its span at life size when Life size can stand it in the room ("2.82 m", scale.md §5.8);
    /// nil when it is already there, too big or too small, or not a whole body.
    public var lifeSize: String?
    /// Grow ×2 is on and this body can double (scale-spec §10.7).
    public var canGrow: Bool
    /// Beyond 10^±32 of life size: a dive or a two-finger hold flies (scale-spec §8.8).
    public var beyondOneToOne: Bool
    /// A flight along the scale axis is moving it now.
    public var flying: Bool
}

/// The debug HUD (plan §8 M0): what the frame cost and drew, with exact counts.
public struct HUDStats: Sendable, Equatable {
    public var bodies = 0
    public var toys = 0
    /// The exact total of every body's count, `Magnitude.formatted`; counts of different tower
    /// families cannot be summed exactly and are listed instead (scale-spec §5.2).
    public var totalAtoms = "0"
    public var drawnAtoms = 0
    public var items = 0
    public var visited = 0
    public var overBudget = false
    public var tau = 0.0
    public var fps = 0.0
    /// The slowest frame interval of the last second, ms.
    public var worstFrameMs = 0.0
    /// `buildCut`'s wall time this frame, ms (not deterministic; tests ignore it).
    public var cutMs = 0.0
    public var thermal: ThermalLevel = .nominal
    /// What the thermal policy allows now (plan §7.4).
    public var thermalLine = "thermal nominal"
    public var lastImpulse: Double?
    public var lastDeltaV: Double?
    public var lastThrowSpeed: Double?
    /// The snap in progress: "#3 ← #5 4.2 cm, zone 5.7 cm, snaps at 3.5 cm" (plan §4.5), for tuning.
    public var magnet: String?
    public var plaque: Plaque?

    public init() {}
}

struct LastImpact: Sendable, Equatable {
    var impulse: Double
    var deltaV: Double
}

/// The total is summed only when the set of bodies changes.
struct HUDCache: Sendable {
    var dirty = true
    var total = "0"
}

/// Frame-rate bookkeeping over the last second.
struct FrameStats: Sendable {
    var intervals: [(time: Double, dt: Double)] = []

    mutating func frame(time: Double, dt: Double) {
        if dt > 0 { intervals.append((time, dt)) }
        intervals.removeAll { time - $0.time > 1 }
    }

    var fps: Double {
        let total = intervals.reduce(0) { $0 + $1.dt }
        return total > 0 ? Double(intervals.count) / total : 0
    }

    var worst: Double { (intervals.map(\.dt).max() ?? 0) * 1000 }
}

extension PlaySession {
    // MARK: The cut (scale-spec §9)

    mutating func buildCut(dt: Double, now: Double) {
        guard let camera else { return }
        let order = bodyOrder.filter { bodies[$0]?.parked == false }
        var budgets = Self.budgets(settings.device, thermal)
        budgets.tau = tau.tau
        let frames = order.map { bodies[$0]!.frame }
        let clock = ContinuousClock()
        let start = clock.now
        let cut = LupiScale.buildCut(bodies: frames, view: camera.viewState, budgets: budgets, previous: lastCut, resolver: resolver)
        let elapsed = clock.now - start
        cutMs = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
        let period = 1.0 / 60
        tau.frame(at: now, interval: dt > 0 ? dt : period, displayPeriod: period, overBudget: cut.overBudget, usage: cut.largestUsage)
        lastCut = cut
        lastOrder = order
        out.cut = cut
        out.bodyOrder = order
    }

    // MARK: Render children (plan §5.4)

    mutating func renderStates(dt: Double) -> [BodyID: RenderState] {
        var states: [BodyID: RenderState] = [:]
        for id in bodyOrder {
            guard var b = bodies[id] else { continue }
            var r = RenderState()
            b.effects.popIn.step(dt: dt)
            r.scale = b.effects.popIn.scale.value
            b.effects.squash.step(dt: dt)
            b.effects.ring.step(dt: dt)
            let s = b.effects.squash.scale
            var along = s.along
            var axis = b.effects.squash.axis
            if !b.effects.ring.isAtRest {
                // A cage's ring rides on the squash, along the squash's axis while it lasts.
                if b.effects.squash.isAtRest { axis = b.effects.ring.axis }
                along = min(1.5, max(0.5, along - b.effects.ring.value))
            }
            r.squash = Vec3(1 / along.squareRoot(), along, 1 / along.squareRoot())
            r.squashAxis = .between(Vec3(0, 1, 0), axis)
            let pose = b.entityPose
            if var flop = b.effects.flop, !b.parked {
                flop.step(
                    dt: dt, velocity: b.motion.linearVelocity, rotation: pose.rotation, metresPerAngstrom: b.sigma,
                    scale: settings.comfort.squashScale
                )
                r.segments = flop.poses()
                b.effects.flop = flop
            }
            let rendered = b.effects.hitStop.step(physics: pose.translation, dt: dt)
            r.translation = pose.rotation.inverted.act(rendered - pose.translation)
            if let g = grab, g.body == id {
                let lean = g.follow.lean(comfort: settings.comfort)
                // World lean expressed in the entity's frame.
                r.rotation = Quat.compose(pose.rotation.inverted, Quat.compose(lean.rotation, pose.rotation)).normalizedQuat
            }
            if let camera {
                let distance = (pose.translation - camera.position).length
                r.meshSwapAllowed = b.atRest || camera.pixels(b.span, at: distance) < 64 || b.mode == .static
            }
            bodies[id] = b
            states[id] = r
        }
        return states
    }

    // MARK: HUD

    mutating func hud() -> HUDStats {
        var h = HUDStats()
        h.bodies = bodies.count
        h.toys = toyCount
        if hudCache.dirty {
            hudCache.total = Self.total(bodyOrder.compactMap { bodies[$0]?.facts.count })
            hudCache.dirty = false
        }
        h.totalAtoms = hudCache.total
        if let cut = lastCut {
            h.drawnAtoms = cut.drawnAtoms
            h.items = cut.items.count
            h.visited = cut.visited
            h.overBudget = cut.overBudget
        }
        h.tau = tau.tau
        h.fps = frameStats.fps
        h.worstFrameMs = frameStats.worst
        h.cutMs = cutMs
        h.thermal = thermal
        h.thermalLine = thermalPolicy.stage.line
        h.lastImpulse = lastImpact?.impulse
        h.lastDeltaV = lastImpact?.deltaV
        h.lastThrowSpeed = lastThrow.map { $0.linear.length }
        h.magnet = magnetLine()
        if let id = selection { h.plaque = plaque(id) }
        return h
    }

    /// The exact sum, formatted once; families that do not add are listed (scale-spec §5.2).
    public static func total(_ counts: [Magnitude]) -> String {
        var sums: [Magnitude] = []
        for c in counts {
            if let i = sums.indices.first(where: { (try? sums[$0] + c) != nil }) {
                sums[i] = (try? sums[i] + c) ?? sums[i]
            } else {
                sums.append(c)
            }
        }
        return sums.isEmpty ? "0" : sums.map(\.formatted).joined(separator: " + ")
    }

    public func plaque(_ id: BodyID) -> Plaque? {
        guard let b = bodies[id] else { return nil }
        let readout = (try? resolver.magnification(of: b.frame))?.readout ?? ""
        let formula = b.facts.count.plain.map { $0 <= BigUInt(RecordLimits.maxAtoms) } ?? false ? b.facts.formula : b.facts.formulaText
        var builtFrom: String?
        switch b.provenance {
        case let .built(story): builtFrom = story.parts.joined(separator: ", ")
        case let .trophy(t) where t.origin.kind == .built: builtFrom = (t.origin.parts ?? []).joined(separator: ", ")
        default: break
        }
        return Plaque(
            name: b.name, formula: formula, atoms: b.facts.count.formatted, personality: b.facts.personality.plaque,
            reasons: b.facts.personality.reasons, feel: b.facts.personality.feel,
            magnification: readout, feltMassKg: b.feltMassKg, brokenFrom: b.brokenFrom, builtFrom: builtFrom,
            canFill: canFill(id), sizeState: b.sizeState, trueMass: trueMass(id) ?? "", lifeSize: lifeSizeOffer(id),
            canGrow: canGrow(id), beyondOneToOne: beyondOneToOne(id), flying: flightState?.body == id
        )
    }

    // MARK: Meshes for the app

    /// The merged-mesh recipe of a molecule body (the cut's `leafMesh`), keyed so equal molecules
    /// share one mesh. Nil for anything that does not draw as a merged mesh.
    public func meshRecipe(for id: BodyID) -> MeshRecipe? {
        guard let b = bodies[id], b.facts.isMolecule,
              let view = try? resolver.resolve(b.frame.ref.root, b.frame.ref.path),
              let leaf = view.leaf else { return nil }
        return resolver.cached("lupi.game.mesh:" + view.id.hex) {
            MeshRecipe.of(leaf, centre: b.facts.aggregate.centre, key: view.id.hex)
        }
    }

    /// The flop's segment recipes of a flexible molecule (plan §8 M4), one merged mesh each, in
    /// the order of `RenderState.segments`. Nil for a body that does not flop.
    public func segmentRecipes(for id: BodyID) -> [MeshRecipe]? {
        guard let flop = bodies[id]?.effects.flop, let whole = meshRecipe(for: id) else { return nil }
        return resolver.cached("lupi.game.flopMesh:" + whole.key) {
            (0..<flop.segments.count).map { whole.segment($0, of: flop.segments) }
        }
    }

    /// The segments of a flexible molecule body, in its recipe's frame; nil when it does not
    /// flop (not flexible, too few rotating bonds, not a molecule, or the flop is switched off).
    func flopSegments(_ b: Body) -> FlopSegments? {
        guard debug.flop, b.facts.isMolecule, b.facts.personality.personality.kind == .flexible,
              let view = try? resolver.resolve(b.frame.ref.root, b.frame.ref.path),
              let leaf = view.leaf else { return nil }
        let centre = b.facts.aggregate.centre
        // Boxed: the resolver's cache cannot tell a cached nil from a missing entry.
        return resolver.cached("lupi.game.flop:" + view.id.hex) { () -> FlopEntry in
            let m = Molecule(atomicNumbers: leaf.atomicNumbers.map(Int.init), positions: leaf.positions.map { Vec3($0) - centre })
            return FlopEntry(segments: FlopSegments.of(m, graph: BondGraph.forPlay(m)))
        }.segments
    }
}

/// A cached flop, nil included.
struct FlopEntry: Sendable {
    var segments: FlopSegments?
}
