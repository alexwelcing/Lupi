/// One run of equal digits in a tower step: `length` levels whose digit on
/// this axis is `digit` (§4.1).
public struct DigitRun: Sendable, Hashable {
    public var digit: UInt8
    public var length: BigUInt

    public init(digit: UInt8, length: BigUInt) {
        self.digit = digit
        self.length = length
    }
}

/// A run of atom indices in an `atoms` step: `start ..< start + length`.
public struct AtomRange: Sendable, Hashable {
    public var start: UInt16
    public var length: UInt16

    public init(start: UInt16, length: UInt16) {
        self.start = start
        self.length = length
    }
}

/// One step of a path (§4.1).
public enum Step: Sendable, Hashable {
    /// Group child (tag 1).
    case child(UInt16)
    /// Crystal octree octants, outermost first (tag 2).
    case cells([UInt8])
    /// A tower descent of `levels` levels; `runs[a]` are axis a's digits, most significant first (tag 3).
    case tower(levels: BigUInt, runs: [[DigitRun]])
    /// A selection of materialized atoms (tag 4).
    case atoms([AtomRange])

    public var tag: UInt8 {
        switch self {
        case .child: 1
        case .cells: 2
        case .tower: 3
        case .atoms: 4
        }
    }
}

/// Limits of §1.9 that paths obey.
enum PathLimits {
    static let maxBytes = 65_536
    static let maxSteps = 1_024
    static let maxOctants = 64
    static let maxRuns = 4_096
    static let maxRanges = 4_096
    static let atomIndexLimit = 4_096
}

/// A canonical path (§4.2): a sequence of steps from a root to one node.
public struct Path: Sendable, Hashable {
    public var steps: [Step]

    /// The empty path, which names the root itself.
    public init() { steps = [] }

    /// Merges adjacent `cells`, `tower` and `atoms` steps, merges equal adjacent
    /// digit runs and normalizes selections, then checks every rule of §4.2.
    public init(canonicalizing input: [Step]) throws {
        var out: [Step] = []
        for raw in input {
            let s = try Path.normalize(raw)
            if let last = out.last, let merged = try Path.merge(last, s) {
                out[out.count - 1] = merged
            } else {
                out.append(s)
            }
        }
        try Path.validate(out)
        steps = out
    }

    /// Decodes and rejects anything that is not canonical.
    public init(bytes: [UInt8]) throws {
        var r = ByteReader(bytes)
        self = try Path.decode(&r)
        try r.done()
    }

    /// The encoding of §4.1. A path built by `init(canonicalizing:)` or decoded
    /// is canonical; steps edited by hand are encoded as they are.
    public var bytes: [UInt8] {
        var w = ByteWriter()
        Path.encode(steps, into: &w)
        return w.bytes
    }

    public var isEmpty: Bool { steps.isEmpty }

    /// This path followed by `more`, canonicalized.
    public func appending(_ more: [Step]) throws -> Path {
        try Path(canonicalizing: steps + more)
    }

    // MARK: Encoding

    static func encode(_ steps: [Step], into w: inout ByteWriter) {
        w.u16(UInt16(steps.count))
        for s in steps { encodeStep(s, into: &w) }
    }

    static func encodeStep(_ s: Step, into w: inout ByteWriter) {
        w.u8(s.tag)
        switch s {
        case let .child(i):
            w.u16(i)
        case let .cells(octants):
            w.u8(UInt8(octants.count))
            w.append(octants)
        case let .tower(levels, runs):
            writeBig(levels, &w)
            for a in 0..<3 {
                let list = a < runs.count ? runs[a] : []
                w.u16(UInt16(list.count))
                for run in list {
                    w.u8(run.digit)
                    writeBig(run.length, &w)
                }
            }
        case let .atoms(ranges):
            w.u16(UInt16(ranges.count))
            for r in ranges {
                w.u16(r.start)
                w.u16(r.length)
            }
        }
    }

    private static func writeBig(_ v: BigUInt, _ w: inout ByteWriter) {
        do { try w.big(v) } catch { preconditionFailure("a path BigUInt beyond 65,536 bits") }
    }

    /// The bytes of one step alone, without the path's step count (the copy key's input, §3.4.5).
    static func stepBytes(_ s: Step) -> [UInt8] {
        var w = ByteWriter()
        encodeStep(s, into: &w)
        return w.bytes
    }

    // MARK: Decoding

    static func decode(_ r: inout ByteReader) throws -> Path {
        let start = r.offset
        let n = Int(try r.u16())
        if n > PathLimits.maxSteps { throw fail(.limit, "more than 1,024 steps") }
        var steps: [Step] = []
        steps.reserveCapacity(n)
        for _ in 0..<n {
            let tag = try r.u8()
            switch tag {
            case 1:
                steps.append(.child(try r.u16()))
            case 2:
                let c = Int(try r.u8())
                steps.append(.cells(try r.take(c)))
            case 3:
                let d = try r.big()
                var runs: [[DigitRun]] = []
                for _ in 0..<3 {
                    let c = Int(try r.u16())
                    if c > PathLimits.maxRuns { throw fail(.limit, "more than 4,096 runs on an axis") }
                    var list: [DigitRun] = []
                    list.reserveCapacity(c)
                    for _ in 0..<c {
                        let digit = try r.u8()
                        list.append(DigitRun(digit: digit, length: try r.big()))
                    }
                    runs.append(list)
                }
                steps.append(.tower(levels: d, runs: runs))
            case 4:
                let c = Int(try r.u16())
                var ranges: [AtomRange] = []
                ranges.reserveCapacity(c)
                for _ in 0..<c { ranges.append(AtomRange(start: try r.u16(), length: try r.u16())) }
                steps.append(.atoms(ranges))
            default:
                throw fail(.unsupported, "step tag \(tag)")
            }
        }
        if r.offset - start > PathLimits.maxBytes { throw fail(.limit, "path longer than 65,536 bytes") }
        try validate(steps)
        return Path(validated: steps)
    }

    private init(validated steps: [Step]) { self.steps = steps }

    // MARK: Canonical rules (§4.2)

    static func validate(_ steps: [Step]) throws {
        if steps.count > PathLimits.maxSteps { throw fail(.limit, "more than 1,024 steps") }
        var previous: UInt8 = 0
        for s in steps {
            if s.tag != 1 && s.tag == previous { throw fail(.canonical, "adjacent steps of one kind must merge") }
            previous = s.tag
            switch s {
            case .child:
                break
            case let .cells(octants):
                if octants.isEmpty { throw fail(.canonical, "a cells step with no octants") }
                if octants.count > PathLimits.maxOctants { throw fail(.limit, "more than 64 octants in one step") }
                if octants.contains(where: { $0 > 7 }) { throw fail(.range, "octant above 7") }
            case let .tower(levels, runs):
                if levels.isZero { throw fail(.canonical, "a tower step of no levels") }
                if runs.count != 3 { throw fail(.range, "a tower step has three axes") }
                for list in runs {
                    if list.count > PathLimits.maxRuns { throw fail(.limit, "more than 4,096 runs on an axis") }
                    for (i, run) in list.enumerated() {
                        if run.length.isZero { throw fail(.canonical, "an empty digit run") }
                        if i > 0 && list[i - 1].digit == run.digit { throw fail(.canonical, "adjacent runs share a digit") }
                    }
                }
            case let .atoms(ranges):
                if ranges.isEmpty { throw fail(.canonical, "an atoms step with no ranges") }
                if ranges.count > PathLimits.maxRanges { throw fail(.limit, "more than 4,096 ranges") }
                for (i, r) in ranges.enumerated() {
                    if r.length == 0 { throw fail(.canonical, "an empty atom range") }
                    if Int(r.start) + Int(r.length) > PathLimits.atomIndexLimit { throw fail(.range, "atom range past 4,096") }
                    if i > 0 {
                        let p = ranges[i - 1]
                        if Int(r.start) <= Int(p.start) + Int(p.length) { throw fail(.canonical, "ranges must ascend with gaps") }
                    }
                }
            }
        }
        var w = ByteWriter()
        encode(steps, into: &w)
        if w.count > PathLimits.maxBytes { throw fail(.limit, "path longer than 65,536 bytes") }
    }

    /// One step in its own canonical form: runs merged, selections as sorted disjoint ranges.
    static func normalize(_ s: Step) throws -> Step {
        switch s {
        case .child, .cells:
            return s
        case let .tower(levels, runs):
            guard runs.count == 3 else { throw fail(.range, "a tower step has three axes") }
            return .tower(levels: levels, runs: runs.map { DigitRuns.merged([], $0) })
        case let .atoms(ranges):
            return .atoms(try AtomSelection.ranges(AtomSelection.indices(ranges)))
        }
    }

    /// Rule 1: adjacent cells, tower and atoms steps combine; nil when they do not.
    static func merge(_ a: Step, _ b: Step) throws -> Step? {
        switch (a, b) {
        case let (.cells(x), .cells(y)):
            return .cells(x + y)
        case let (.tower(d1, r1), .tower(d2, r2)):
            return .tower(levels: d1 + d2, runs: (0..<3).map { DigitRuns.merged(r1[$0], r2[$0]) })
        case let (.atoms(first), .atoms(second)):
            let base = AtomSelection.indices(first)
            var picked: [Int] = []
            for i in AtomSelection.indices(second) {
                guard i < base.count else { throw fail(.path, "selection index beyond the selection") }
                picked.append(base[i])
            }
            return .atoms(try AtomSelection.ranges(picked))
        default:
            return nil
        }
    }

    // MARK: Containment (§4.4)

    /// Does removal `a` contain removal `b` (equal, or an ancestor)? Both start at one view.
    static func contains(_ a: [Step], _ b: [Step]) -> Bool {
        var i = 0, j = 0
        var bHead: Step? = b.first
        while i < a.count, j < b.count, let y = bHead {
            let x = a[i]
            switch (x, y) {
            case let (.child(p), .child(q)):
                if p != q { return false }
                i += 1; j += 1
            case let (.cells(p), .cells(q)):
                let m = min(p.count, q.count)
                if p[0..<m] != q[0..<m] { return false }
                if p.count < q.count {
                    i += 1
                    bHead = .cells(Array(q[p.count...]))
                    continue
                }
                if p.count > q.count { return false }
                i += 1; j += 1
            case let (.tower(da, ra), .tower(db, rb)):
                let short = da <= db ? ra : rb
                for ax in 0..<3 {
                    let n = DigitRuns.count(short[ax])
                    guard let ha = DigitRuns.split(ra[ax], n)?.head, let hb = DigitRuns.split(rb[ax], n)?.head,
                          ha == hb else { return false }
                }
                if da < db {
                    i += 1
                    let rest = (0..<3).map { ax in DigitRuns.split(rb[ax], DigitRuns.count(ra[ax]))?.tail ?? [] }
                    bHead = .tower(levels: db.minus(da), runs: rest)
                    continue
                }
                if da > db { return false }
                i += 1; j += 1
            default:
                return false
            }
            bHead = j < b.count ? b[j] : nil
        }
        return i == a.count
    }
}

/// Digit-run arithmetic on one axis.
enum DigitRuns {
    /// `a` followed by `b`, merging equal neighbours and dropping empty runs.
    static func merged(_ a: [DigitRun], _ b: [DigitRun]) -> [DigitRun] {
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

    static func count(_ runs: [DigitRun]) -> BigUInt {
        runs.reduce(BigUInt()) { $0 + $1.length }
    }

    /// The first `n` digits and the rest; nil when there are fewer than `n`.
    static func split(_ runs: [DigitRun], _ n: BigUInt) -> (head: [DigitRun], tail: [DigitRun])? {
        var head: [DigitRun] = [], tail: [DigitRun] = []
        var left = n
        for run in runs {
            if left.isZero {
                tail.append(run)
            } else if run.length <= left {
                head.append(run)
                left = left.minus(run.length)
            } else {
                head.append(DigitRun(digit: run.digit, length: left))
                tail.append(DigitRun(digit: run.digit, length: run.length.minus(left)))
                left = BigUInt()
            }
        }
        return left.isZero ? (head, tail) : nil
    }

    /// The first digit, if any.
    static func first(_ runs: [DigitRun]) -> UInt8? { runs.first?.digit }

    /// Every digit equals `d` (true for no digits).
    static func all(_ runs: [DigitRun], _ d: UInt8) -> Bool { runs.allSatisfy { $0.digit == d } }
}

/// Atom selections as index sets.
enum AtomSelection {
    static func indices(_ ranges: [AtomRange]) -> [Int] {
        var out: [Int] = []
        for r in ranges { for i in 0..<Int(r.length) { out.append(Int(r.start) + i) } }
        return out
    }

    /// Sorted, deduplicated ranges with gaps between them.
    static func ranges(_ indices: [Int]) throws -> [AtomRange] {
        var out: [AtomRange] = []
        for i in Set(indices).sorted() {
            guard i >= 0, i < PathLimits.atomIndexLimit else { throw fail(.range, "atom index past 4,096") }
            if let last = out.last, Int(last.start) + Int(last.length) == i {
                out[out.count - 1].length += 1
            } else {
                out.append(AtomRange(start: UInt16(i), length: 1))
            }
        }
        return out
    }
}
