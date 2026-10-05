import Foundation
import LupiChem
import LupiScaleCore

/// A body's piece and the world pose of its anchor (§8.3).
public struct BodyFrame: Sendable {
    public var ref: ScaleRef
    /// From the body's node to its anchor A: runtime state, never persisted, unlimited (§8.3).
    public var anchorPath: [Step]
    /// A point x in A's frame is at `worldFromAnchor(σ_A · x)`.
    public var worldFromAnchor: RigidD
    /// σ_A, metres per anchor unit.
    public var metresPerAnchorUnit: Double

    public init(ref: ScaleRef, anchorPath: [Step] = [], worldFromAnchor: RigidD = .identity, metresPerAnchorUnit: Double) {
        self.ref = ref
        self.anchorPath = anchorPath
        self.worldFromAnchor = worldFromAnchor
        self.metresPerAnchorUnit = metresPerAnchorUnit
    }

    /// World position of a point given in the anchor's frame.
    public func world(_ x: Vec3) -> Vec3 { worldFromAnchor.apply(metresPerAnchorUnit * x) }

    /// The anchor-frame coordinates of a world point.
    public func anchorPoint(_ world: Vec3) -> Vec3 { worldFromAnchor.inverse.apply(world) / metresPerAnchorUnit }
}

/// The starting values of §8.4 and §8.8 (the app's tuning table).
public enum FrameTuning {
    public static let descendWidth = 40.0        // E_desc, m
    public static let ascendWidth = 20.0         // E_asc = z_far, m
    public static let radiusCap = 1e8            // R_cap, m
    public static let stepsPerFrame = 2
    public static let zFar = 20.0
    public static let zNear = 0.05
}

/// `x_parent = s · R · x_child + t` (§8.2).
public struct Placement: Sendable, Hashable {
    public var scale: Double
    public var rotation: Mat3
    public var translation: Vec3

    public init(scale: Double = 1, rotation: Mat3 = .identity, translation: Vec3 = .zero) {
        self.scale = scale
        self.rotation = rotation
        self.translation = translation
    }

    public static let identity = Placement()

    public func apply(_ x: Vec3) -> Vec3 { scale * (rotation * x) + translation }

    /// This placement after `inner`: grandchild → child → parent.
    public func then(_ inner: Placement) -> Placement {
        Placement(scale: scale * inner.scale, rotation: rotation * inner.rotation, translation: apply(inner.translation))
    }

    public var inverse: Placement {
        let rt = rotation.transposed
        return Placement(scale: 1 / scale, rotation: rt, translation: -(1 / scale) * (rt * translation))
    }
}

extension Resolver {
    /// The placement of the node one step below `view` (§8.2). A tower step of any length composes
    /// in closed form per digit run, so a descent of 10¹⁰⁰ levels costs O(runs).
    public func placement(from view: View, step: Step) throws -> Placement {
        switch step {
        case let .child(i):
            guard let children = view.groupChildren, Int(i) < children.count else { throw ScaleError(.path, "child") }
            let c = children[Int(i)]
            return Placement(rotation: Quat(c.rotation).matrix, translation: c.translation)
        case let .cells(octants):
            guard let c = view.crystal else { throw ScaleError(.path, "cells") }
            var box = view.box
            for o in octants { box = try CrystalMath.octreeChild(box, o) }
            let q = Double(c.quarterQ16) / 65536
            var t = Vec3.zero
            for a in 0..<3 { t[a] = 4 * (Double(box.lo[a]) - Double(view.box.lo[a])) * q }
            return Placement(translation: t)
        case let .tower(d, runs):
            guard let t = view.tower else { throw ScaleError(.path, "tower") }
            let ctx = try TowerContext.of(view.record, self)
            return TowerPlacement.compose(ctx, from: view.level, levels: d, runs: runs)
        case .atoms:
            return .identity
        }
    }

    /// The composed placement of a run of steps below `view`, and the view they reach.
    public func placement(from view: View, steps: [Step]) throws -> (placement: Placement, view: View) {
        var p = Placement.identity
        var v = view
        for s in steps {
            p = p.then(try placement(from: v, step: s))
            v = try step(v, s)
        }
        return (p, v)
    }
}

/// The closed form of a tower descent (§8.2): for axis a, the digits from the top are a base-f
/// number, so a run of r equal digits contributes a geometric series.
enum TowerPlacement {
    static func compose(_ t: TowerContext, from k: BigUInt, levels d: BigUInt, runs: [[DigitRun]]) -> Placement {
        let f = Double(t.factor)
        let uk = TowerMath.unitExponent(k)
        var translation = Vec3.zero
        for a in 0..<3 {
            // The highest axis-a level at or below k sits at position C(a, k) − 1.
            var top = TowerMath.stacked(a, k)
            var sum = 0.0
            for run in runs[a] where !run.length.isZero {
                if run.digit != 0 {
                    // d · (f^(top − u) − f^(top − r − u)) / (f − 1), with top counted one past the run.
                    let high = power(f, top, minus: uk)
                    let low = power(f, top.minus(min(top, run.length)), minus: uk)
                    sum += Double(run.digit) * (high - low) / (f - 1)
                }
                top = top.minus(min(top, run.length))
            }
            translation += sum * t.periods[a]
        }
        let scale = power(f, TowerMath.unitExponent(k.minus(min(k, d))), minus: uk)
        return Placement(scale: scale, translation: translation)
    }

    /// f^(a − b) in binary64, for exact integers a and b: 0 when it underflows.
    static func power(_ f: Double, _ a: BigUInt, minus b: BigUInt) -> Double {
        if a >= b {
            guard let e = a.minus(b).int, e < 4000 else { return .infinity }
            return pow(f, Double(e))
        }
        guard let e = b.minus(a).int, e < 4000 else { return 0 }
        return pow(f, -Double(e))
    }
}

/// §4.8: the child of a node that contains a point, one level down.
enum PointToChild {
    static func child(of v: View, containing x: Vec3, resolver r: Resolver) throws -> Step? {
        switch v.kind {
        case .group:
            guard let children = v.groupChildren else { return nil }
            var best: (Int, Double)?
            for (i, c) in children.enumerated() {
                guard let w = try? r.step(v, .child(UInt16(i))) else { continue }
                let a = try r.aggregate(w)
                let m = Quat(c.rotation).matrix
                let local = m.transposed * (x - c.translation)
                guard a.bounds.contains(local) else { continue }
                let d = (local - a.centre).length
                if best == nil || d < best!.1 { best = (i, d) }
            }
            return best.map { .child(UInt16($0.0)) }
        case .box:
            guard let c = v.crystal else { return nil }
            let cw = 4 * Double(c.quarterQ16) / 65536
            var o: UInt8 = 0
            for a in 0..<3 {
                let e = v.box.extent(a)
                guard e >= 2 else { continue }
                let mid = Double((e + 1) / 2) * cw
                if x[a] >= mid { o |= 1 << UInt8(a) }
            }
            guard CrystalMath.octreeChildren(v.box).contains(where: { $0.octant == o }) else { return nil }
            let s = Step.cells([o])
            return (try? r.step(v, s)) == nil ? nil : s
        case .level:
            let ctx = try TowerContext.of(v.record, r)
            let a = TowerMath.axis(v.level)
            let c = ctx.inversePeriods * x
            let j = max(0, min(ctx.factor - 1, Int(c[a].rounded(.down).clamped(-1, Double(ctx.factor)))))
            var runs: [[DigitRun]] = [[], [], []]
            runs[a] = [DigitRun(digit: UInt8(j), length: 1)]
            let s = Step.tower(levels: 1, runs: runs)
            return (try? r.step(v, s)) == nil ? nil : s
        default:
            return nil
        }
    }
}

extension Double {
    func clamped(_ lo: Double, _ hi: Double) -> Double { Swift.min(hi, Swift.max(lo, self)) }
}

// MARK: Rebasing (§8.4)

/// Moves the anchor at most two levels per call toward the focus point, keeping every drawn
/// point where it was: a change of representation, not of state.
public func rebase(_ frame: inout BodyFrame, focusWorld: SIMD3<Double>, resolver: Resolver) throws {
    let body = try resolver.resolve(frame.ref.root, frame.ref.path)
    var anchor = try resolver.walk(body, frame.anchorPath)
    for _ in 0..<FrameTuning.stepsPerFrame {
        let agg = try resolver.aggregate(anchor)
        let sigma = frame.metresPerAnchorUnit
        if !frame.anchorPath.isEmpty && sigma * agg.narrowestWidth < FrameTuning.ascendWidth {
            let (parentPath, last) = try AnchorPath.popLevel(frame.anchorPath, anchor: anchor)
            let parent = try resolver.walk(body, parentPath)
            let p = try resolver.placement(from: parent, step: last)
            ascend(&frame, through: p)
            frame.anchorPath = parentPath
            anchor = parent
            continue
        }
        let x = frame.anchorPoint(focusWorld)
        guard let s = try PointToChild.child(of: anchor, containing: x, resolver: resolver) else { break }
        let child = try resolver.step(anchor, s)
        let p = try resolver.placement(from: anchor, step: s)
        let childWidth = sigma * p.scale * (try resolver.aggregate(child)).narrowestWidth
        guard childWidth >= FrameTuning.descendWidth || sigma * agg.radius > FrameTuning.radiusCap else { break }
        descend(&frame, through: p)
        frame.anchorPath.append(s)
        anchor = child
    }
}

/// worldFromC = worldFromA · (σ_A · placement), σ_C = σ_A · s.
func descend(_ frame: inout BodyFrame, through p: Placement) {
    let w = frame.worldFromAnchor
    let rotation = w.rotation.multiplied(by: Quat(rotation: p.rotation))
    frame.worldFromAnchor = RigidD(
        rotation: rotation, translation: w.translation + w.rotation.act(frame.metresPerAnchorUnit * p.translation)
    )
    frame.metresPerAnchorUnit *= p.scale
}

/// The inverse of `descend`.
func ascend(_ frame: inout BodyFrame, through p: Placement) {
    let sigmaParent = frame.metresPerAnchorUnit / p.scale
    let rotation = frame.worldFromAnchor.rotation.multiplied(by: Quat(rotation: p.rotation).conjugate)
    frame.worldFromAnchor = RigidD(
        rotation: rotation, translation: frame.worldFromAnchor.translation - rotation.act(sigmaParent * p.translation)
    )
    frame.metresPerAnchorUnit = sigmaParent
}

/// Anchor paths: lists of steps that the resolver walks without canonical form.
enum AnchorPath {
    /// Removes one level: a child, the last octant, or the deepest level of the last tower step.
    static func popLevel(_ path: [Step], anchor: View) throws -> ([Step], Step) {
        guard let last = path.last else { throw ScaleError(.path, "the anchor is the body's node") }
        var rest = Array(path.dropLast())
        switch last {
        case .child, .atoms:
            return (rest, last)
        case let .cells(o):
            if o.count > 1 { rest.append(.cells(Array(o.dropLast()))) }
            return (rest, .cells([o.last!]))
        case let .tower(d, runs):
            // The deepest level taken was k + 1, where k is the anchor's level (0 for a copy or seed).
            let k = anchor.kind == .level ? anchor.level : BigUInt()
            let a = TowerMath.axis(k + 1)
            var axisRuns = runs[a]
            let digit = axisRuns[axisRuns.count - 1].digit
            axisRuns[axisRuns.count - 1].length = axisRuns[axisRuns.count - 1].length.minus(1)
            if axisRuns[axisRuns.count - 1].length.isZero { axisRuns.removeLast() }
            var upper = runs
            upper[a] = axisRuns
            if d > BigUInt(1) { rest.append(.tower(levels: d.minus(1), runs: upper)) }
            var single: [[DigitRun]] = [[], [], []]
            single[a] = [DigitRun(digit: digit, length: 1)]
            return (rest, .tower(levels: 1, runs: single))
        }
    }

    /// Per axis, the digits of the anchor within the innermost tower that holds it, from that
    /// tower's top (or from the body's node when it is a level of that tower).
    static func towerDigits(_ path: [Step]) -> [[DigitRun]] {
        var runs: [[DigitRun]] = [[], [], []]
        for s in path {
            switch s {
            case let .tower(_, r):
                for a in 0..<3 { runs[a] = mergeRuns(runs[a], r[a]) }
            default:
                runs = [[], [], []]
            }
        }
        return runs
    }

    static func mergeRuns(_ a: [DigitRun], _ b: [DigitRun]) -> [DigitRun] {
        var out = a
        for run in b where !run.length.isZero {
            if let last = out.last, last.digit == run.digit {
                out[out.count - 1].length = last.length + run.length
            } else {
                out.append(run)
            }
        }
        return out
    }
}

// MARK: Pinch (§8.8)

/// Scales a body by `ratio` about the world point P: a similarity, continuous and exactly invertible.
public func pinch(_ frame: inout BodyFrame, ratio: Double, about p: SIMD3<Double>) {
    frame.worldFromAnchor.translation = p + ratio * (frame.worldFromAnchor.translation - p)
    frame.metresPerAnchorUnit *= ratio
}
