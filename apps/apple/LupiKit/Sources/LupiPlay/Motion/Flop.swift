import Foundation
import LupiChem

/// A flexible molecule cut into 2–4 stiff segments at its rotating bonds, for the flop (plan
/// §8 M4). The physics body stays one rigid body, as RealityKit simulates it reliably; only
/// the drawing bends, each segment turning about its hinge bond (`Flop`). Spike A6 compares
/// this with segments joined by RealityKit physics joints.
public struct FlopSegments: Sendable, Equatable {
    public struct Segment: Sendable, Equatable {
        /// Atom indices, ascending.
        public var atoms: [Int]
        /// The segment it hangs from; nil for the root.
        public var parent: Int?
        /// The hinge: the cut bond's midpoint, in the molecule's frame (Å).
        public var pivot: Vec3
        /// The cut bond's index in the graph; nil for the root.
        public var hinge: Int?
        /// The mass-weighted centre, Å.
        public var centroid: Vec3
        /// Da.
        public var mass: Double
    }

    /// Parents before children; the root, the heaviest segment, first.
    public var segments: [Segment]
    public var segmentOfAtom: [Int]

    public var count: Int { segments.count }

    /// At most this many segments.
    public static let maxSegments = 4
    /// The smaller side of a cut has at least this many heavy atoms, so what flops is visible.
    public static let minHeavyAtoms = 3

    /// The segments of a molecule with its play graph, or nil when no rotating bond splits off
    /// enough of it to flop. Cuts go at the rotating bonds that split a segment most evenly
    /// (by heavy atoms), the lower bond index on ties; deterministic.
    public static func of(_ molecule: Molecule, graph: BondGraph, maxSegments: Int = maxSegments) -> FlopSegments? {
        let z = molecule.atomicNumbers
        let n = molecule.count
        guard n >= 2 * minHeavyAtoms else { return nil }
        let rotors = MolecularFeatures.rotatableBonds(in: molecule, graph: graph)
        var label = [Int](repeating: 0, count: n)
        var cuts: [Int] = []
        var segmentCount = 1

        func side(of bond: Int) -> [Int] {
            // The atoms reached from bond.i without crossing a cut or the bond itself.
            let b = graph.bonds[bond]
            let seg = label[b.i]
            var seen = Set([b.i])
            var stack = [b.i]
            while let atom = stack.popLast() {
                for k in graph.incident[atom] where k != bond && !cuts.contains(k) {
                    let next = graph.bonds[k].other(atom)
                    if label[next] == seg && seen.insert(next).inserted { stack.append(next) }
                }
            }
            return Array(seen)
        }

        while segmentCount < max(2, maxSegments) {
            var best: (bond: Int, side: [Int], smaller: Int)?
            for k in rotors where !cuts.contains(k) {
                let b = graph.bonds[k]
                guard label[b.i] == label[b.j] else { continue }
                let a = side(of: k)
                // A bridge inside its segment splits it; a bond that does not was already cut around.
                guard !a.contains(b.j) else { continue }
                let seg = label[b.i]
                let heavyA = a.filter { z[$0] != 1 }.count
                let heavyAll = (0..<n).filter { label[$0] == seg && z[$0] != 1 }.count
                let smaller = min(heavyA, heavyAll - heavyA)
                guard smaller >= minHeavyAtoms else { continue }
                if best == nil || smaller > best!.smaller { best = (k, a, smaller) }
            }
            guard let cut = best else { break }
            let seg = label[graph.bonds[cut.bond].i]
            let all = (0..<n).filter { label[$0] == seg }
            let aSet = Set(cut.side)
            let heavyA = cut.side.filter { z[$0] != 1 }.count
            // The smaller side becomes the new segment.
            let moving = 2 * heavyA <= all.filter { z[$0] != 1 }.count ? aSet : Set(all).subtracting(aSet)
            for atom in moving { label[atom] = segmentCount }
            cuts.append(cut.bond)
            segmentCount += 1
        }
        guard segmentCount >= 2 else { return nil }

        // Masses and centroids, then the tree from the heaviest segment.
        var mass = [Double](repeating: 0, count: segmentCount)
        var weighted = [Vec3](repeating: .zero, count: segmentCount)
        for atom in 0..<n {
            let m = ChemicalElement.forAtomicNumber(z[atom]).mass
            mass[label[atom]] += m
            weighted[label[atom]] += molecule.position(atom) * m
        }
        let root = (0..<segmentCount).max { mass[$0] < mass[$1] || (mass[$0] == mass[$1] && $0 > $1) }!
        var order = [root]
        var parentOf = [Int: (parent: Int, bond: Int)]()
        var queue = [root]
        while !queue.isEmpty {
            let s = queue.removeFirst()
            for k in cuts.sorted() {
                let b = graph.bonds[k]
                let (p, q) = (label[b.i], label[b.j])
                let other = p == s ? q : q == s ? p : nil
                guard let child = other, child != root, parentOf[child] == nil else { continue }
                parentOf[child] = (s, k)
                order.append(child)
                queue.append(child)
            }
        }
        var newIndex = [Int](repeating: 0, count: segmentCount)
        for (i, s) in order.enumerated() { newIndex[s] = i }
        let segments = order.map { s -> Segment in
            let atoms = (0..<n).filter { label[$0] == s }
            let link = parentOf[s]
            let pivot = link.map { 0.5 * (molecule.position(graph.bonds[$0.bond].i) + molecule.position(graph.bonds[$0.bond].j)) }
            let centroid = mass[s] > 0 ? weighted[s] / mass[s] : .zero
            return Segment(atoms: atoms, parent: link.map { newIndex[$0.parent] }, pivot: pivot ?? centroid,
                           hinge: link?.bond, centroid: centroid, mass: mass[s])
        }
        return FlopSegments(segments: segments, segmentOfAtom: label.map { newIndex[$0] })
    }
}

/// One segment's displayed pose in the molecule's frame: x ↦ rotation · x + translation (Å).
public struct SegmentPose: Sendable, Equatable {
    public var rotation: Quat
    public var translation: Vec3

    public static let identity = SegmentPose(rotation: .identity, translation: .zero)

    public func apply(_ p: Vec3) -> Vec3 { rotation.act(p) + translation }
}

/// The flop (plan §8 M4): each segment of a flexible molecule swings about its hinge on a soft
/// damped spring. Changes in how the body is pushed (a throw, a catch, a landing; free fall
/// and resting are both steady, so neither sags it) and the impulse of each hit kick the
/// segments; they wobble a few times and settle. Render only: the collider never bends.
public struct Flop: Sendable, Equatable {
    public struct Tuning: Sendable, Equatable {
        /// The swing's natural frequency, Hz, and damping ratio: a few visible wobbles (est.).
        public var frequency = 2.4
        public var dampingRatio = 0.22
        /// No segment turns further than this from its rest, radians.
        public var maxAngle = 0.6
        /// Spin added by a hit of intensity 1, rad/s.
        public var kick = 7.0
        /// How strongly a change of push swings a segment, and the most it adds in one frame.
        public var drive = 0.35
        public var maxDriveStep = 4.0
        /// The push is compared with its own average over this long, seconds: steady pushes fade.
        public var settleTime = 0.15

        public init() {}
    }

    public let segments: FlopSegments
    public var tuning: Tuning
    /// Per segment, a rotation vector (rad) about its pivot in the molecule's frame, and its rate.
    public private(set) var angles: [Vec3]
    public private(set) var rates: [Vec3]
    var lastVelocity: Vec3?
    var averagePush: Vec3?

    public init(_ segments: FlopSegments, tuning: Tuning = Tuning()) {
        self.segments = segments
        self.tuning = tuning
        angles = Array(repeating: .zero, count: segments.count)
        rates = Array(repeating: .zero, count: segments.count)
    }

    /// A hit along `direction` (world), of intensity `amount` 0...1 already scaled for comfort.
    /// `rotation` takes the molecule's frame to the world.
    public mutating func kick(direction: Vec3, amount: Double, rotation: Quat) {
        guard amount > 0, direction.lengthSquared > 0 else { return }
        let local = conjugate(rotation).act(direction.normalized)
        for s in segments.segments.indices.dropFirst() {
            let arm = segments.segments[s].centroid - segments.segments[s].pivot
            guard arm.lengthSquared > 1e-12 else { continue }
            var axis = arm.normalized.cross(local)
            // A hit along the arm still shakes it: about any axis across the arm.
            if axis.lengthSquared < 1e-6 { axis = arm.normalized.cross(abs(arm.normalized.y) < 0.9 ? Vec3(0, 1, 0) : Vec3(1, 0, 0)) }
            rates[s] += axis.normalized * (tuning.kick * min(1, amount))
        }
    }

    /// One frame. `velocity` is the body's linear velocity (world, m/s), `rotation` its
    /// orientation, `metresPerAngstrom` its display scale, and `scale` comfort's share (1
    /// Standard, 0.5 Gentle, 0 Still).
    public mutating func step(
        dt: Double, velocity: Vec3, rotation: Quat, metresPerAngstrom: Double, gravity: Vec3 = Vec3(0, -9.81, 0), scale: Double = 1
    ) {
        guard dt > 0, dt.isFinite, velocity.x.isFinite, velocity.y.isFinite, velocity.z.isFinite else { return }
        // The first frame only learns the velocity; the first push only learns the average.
        var change = Vec3.zero
        if let last = lastVelocity {
            let push = (velocity - last) / dt - gravity
            let average = averagePush ?? push
            change = push - average
            averagePush = average + (push - average) * min(1, dt / tuning.settleTime)
        }
        lastVelocity = velocity
        let localChange = conjugate(rotation).act(change)
        let w = 2 * Double.pi * tuning.frequency
        let k = w * w, c = 2 * tuning.dampingRatio * w
        for s in segments.segments.indices.dropFirst() {
            let seg = segments.segments[s]
            let arm = (seg.centroid - seg.pivot) * max(1e-6, metresPerAngstrom)
            if scale > 0, arm.lengthSquared > 0 {
                // The segment lags what moves the body: a push turns it the other way.
                var swing = arm.cross(-localChange) / arm.lengthSquared * (tuning.drive * dt)
                let size = swing.length
                if size > tuning.maxDriveStep { swing *= tuning.maxDriveStep / size }
                rates[s] += swing * scale
            }
            rates[s] += (-k * angles[s] - c * rates[s]) * dt
            angles[s] += rates[s] * dt
            let angle = angles[s].length
            if angle > tuning.maxAngle {
                // At the stop the swing loses its outward speed.
                let n = angles[s] / angle
                angles[s] = n * tuning.maxAngle
                let out = rates[s].dot(n)
                if out > 0 { rates[s] -= n * out }
            }
        }
        if scale == 0 { reset(keepingVelocity: true) }
    }

    /// Everything at rest, straight.
    public mutating func reset(keepingVelocity: Bool = false) {
        angles = Array(repeating: .zero, count: segments.count)
        rates = Array(repeating: .zero, count: segments.count)
        if !keepingVelocity {
            lastVelocity = nil
            averagePush = nil
        }
    }

    public var isAtRest: Bool {
        zip(angles, rates).allSatisfy { $0.0.length < 1e-4 && $0.1.length < 1e-3 }
    }

    /// The largest angle of any segment, radians (for the HUD and tests).
    public var largestAngle: Double { angles.map(\.length).max() ?? 0 }

    /// Each segment's pose, composed down the tree.
    public func poses() -> [SegmentPose] {
        var out = [SegmentPose](repeating: .identity, count: segments.count)
        for (s, seg) in segments.segments.enumerated() {
            guard let parent = seg.parent else { continue }
            let r = rotationOf(angles[s])
            // About the pivot: x ↦ r (x − p) + p.
            let local = SegmentPose(rotation: r, translation: seg.pivot - r.act(seg.pivot))
            let up = out[parent]
            out[s] = SegmentPose(rotation: multiply(up.rotation, local.rotation), translation: up.rotation.act(local.translation) + up.translation)
        }
        return out
    }
}

/// A bouncy cage rings after a hit (plan §8 M4): it shivers along the hit, stretching and
/// squashing a few percent at 9 Hz, dying away in about half a second. Render only.
public struct CageRing: Sendable, Equatable {
    public static let frequency = 9.0
    /// The envelope's time constant, seconds.
    public static let decay = 0.18
    /// The largest stretch, at intensity 1.
    public static let largest = 0.06

    public private(set) var axis = Vec3(0, 1, 0)
    var amplitude = 0.0
    var elapsed = 0.0

    public init() {}

    /// A hit along `direction` of `amount` 0...1, already scaled for comfort. A weaker hit
    /// than what still rings is ignored.
    public mutating func hit(direction: Vec3, amount: Double) {
        let a = Self.largest * min(1, max(0, amount))
        guard a > 0, direction.lengthSquared > 0, a >= abs(value) else { return }
        axis = direction.normalized
        amplitude = a
        elapsed = 0
    }

    public mutating func step(dt: Double) {
        guard amplitude > 0, dt.isFinite, dt > 0 else { return }
        elapsed += dt
        if amplitude * exp(-elapsed / Self.decay) < 1e-4 { amplitude = 0 }
    }

    /// The stretch along `axis` now: positive squashes, negative stretches, as `Squash`.
    public var value: Double {
        amplitude == 0 ? 0 : amplitude * exp(-elapsed / Self.decay) * sin(2 * Double.pi * Self.frequency * elapsed + Double.pi / 2)
    }

    public var isAtRest: Bool { amplitude == 0 }
}

private func conjugate(_ q: Quat) -> Quat { Quat(x: -q.x, y: -q.y, z: -q.z, w: q.w) }

private func multiply(_ a: Quat, _ b: Quat) -> Quat {
    Quat(
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
    )
}

/// The rotation of a rotation vector (axis × angle).
private func rotationOf(_ v: Vec3) -> Quat {
    let angle = v.length
    guard angle > 1e-12 else { return .identity }
    let s = sin(angle / 2) / angle
    return Quat(x: v.x * s, y: v.y * s, z: v.z * s, w: cos(angle / 2))
}
