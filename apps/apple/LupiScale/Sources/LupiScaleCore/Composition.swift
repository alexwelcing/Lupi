/// Exact per-element counts in one form: `count(Z) = unit[Z] × copies − removed[Z]` (§5.3).
public struct Composition: Sendable, Hashable {
    public var unit: [UInt8: BigUInt]
    public var copies: Magnitude
    public var removed: [UInt8: BigUInt]

    public init(unit: [UInt8: BigUInt], copies: Magnitude = .one, removed: [UInt8: BigUInt] = [:]) {
        self.unit = unit
        self.copies = copies
        self.removed = removed
    }

    /// The Hill formula of `unit`: one seed copy's for a tower piece (§5.3).
    public var formula: String { Composition.hill(unit) }

    /// The plaque text: the formula, ` × copies` when copies ≠ 1, and ` − ` removed.
    public var formulaText: String {
        var text = formula
        if copies != .one {
            let f = copies.formatted
            text += MagnitudeFormat.times + (Composition.isSum(f) ? "(" + f + ")" : f)
        }
        if !Composition.hill(removed).isEmpty { text += MagnitudeFormat.minus + Composition.hill(removed) }
        return text
    }

    /// Exact mass in micro-daltons, `lupi.mass.v1`.
    public func massMicroDa() throws -> Magnitude {
        func weigh(_ counts: [UInt8: BigUInt]) throws -> BigUInt {
            var total = BigUInt()
            for (z, n) in counts {
                guard let mu = ScaleElements.microDaltons(z) else { throw fail(.range, "atomic number \(z)") }
                total += n.multipliedSmall(mu)
            }
            return total
        }
        return try copies.multiplied(by: weigh(unit)) - Magnitude(weigh(removed))
    }

    /// C first and H second when there is carbon, the rest alphabetical; counts of 1 omitted.
    public static func hill(_ counts: [UInt8: BigUInt]) -> String {
        let present = counts.filter { !$0.value.isZero }.map { (ScaleElements.symbol($0.key) ?? "?", $0.value) }
        let hasCarbon = present.contains { $0.0 == "C" }
        func key(_ s: String) -> String {
            guard hasCarbon else { return s }
            return s == "C" ? "0" : s == "H" ? "1" : "2" + s
        }
        return present.sorted { key($0.0) < key($1.0) }
            .map { $0.1 == BigUInt(1) ? $0.0 : $0.0 + $0.1.decimal }
            .joined()
    }

    /// A formatted value that is a sum or difference at the top level (rules 4a and 4b of §5.4).
    static func isSum(_ text: String) -> Bool {
        var depth = 0
        let chars = Array(text)
        for (i, ch) in chars.enumerated() {
            if ch == "(" { depth += 1 } else if ch == ")" { depth -= 1 } else if depth == 0, ch == "+" || ch == "\u{2212}",
                i > 0, i + 1 < chars.count, chars[i - 1] == " ", chars[i + 1] == " " {
                return true
            }
        }
        return false
    }
}

extension Resolver {
    /// `unit × copies − removed` (§5.3).
    public func composition(_ v: View) throws -> Composition {
        try checkSubtree(v)
        guard v.kind == .level, let t = v.tower else { return Composition(unit: try finiteCounts(v)) }
        var unit = try finiteCounts(root(t.seed))
        if let s = t.substitution {
            unit[s.fromZ] = try unit[s.fromZ, default: BigUInt()] - BigUInt(UInt64(s.perCopy))
            unit[s.toZ, default: BigUInt()] += BigUInt(UInt64(s.perCopy))
            if unit[s.fromZ]!.isZero { unit[s.fromZ] = nil }
        }
        var copies = Magnitude.tower(seedCount: 1, factor: t.factor, levels: v.level)
        var removed: [UInt8: BigUInt] = [:]
        let bare = v.with(removals: [])
        for r in v.removals {
            guard case let .tower(d, _) = r[0] else { throw fail(.validity, "a tower removal starts with a tower step") }
            if r.count == 1 {
                // A whole node at level k − D: f^(k − D) seed copies.
                copies = try copies - Magnitude.tower(seedCount: 1, factor: t.factor, levels: v.level.minus(d))
            } else {
                Composition.add(&removed, try finiteCounts(walk(bare, r)))
            }
        }
        return Composition(unit: unit, copies: copies, removed: removed)
    }

    /// Exact counts per element of a finite view, after its removals.
    func finiteCounts(_ v: View) throws -> [UInt8: BigUInt] {
        var out: [UInt8: BigUInt]
        switch v.kind {
        case .leaf, .capped, .selection:
            return Composition.tally(try materialize(v).atomicNumbers)
        case .copy:
            let t = v.tower!
            var unit = try finiteCounts(root(t.seed))
            let s = t.substitution!
            unit[s.fromZ] = try unit[s.fromZ, default: BigUInt()] - BigUInt(UInt64(s.perCopy))
            unit[s.toZ, default: BigUInt()] += BigUInt(UInt64(s.perCopy))
            return unit.filter { !$0.value.isZero }
        case .box:
            out = CrystalMath.boxComposition(v.crystal!, v.box)
        case .group:
            out = try groupTally(v.record)
        case .level:
            let c = try composition(v)
            guard let k = c.copies.plain else { throw fail(.range, "a finite count past 2^65536") }
            var total: [UInt8: BigUInt] = [:]
            for (z, n) in c.unit { total[z] = n * k }
            return try Composition.subtract(total, c.removed)
        }
        let bare = v.with(removals: [])
        for r in v.removals { out = try Composition.subtract(out, finiteCounts(walk(bare, r))) }
        return out
    }

    private func groupTally(_ rec: NodeRecord) throws -> [UInt8: BigUInt] {
        if let t = memo.tallyOf(rec.id) { return t }
        _ = try depth(rec.id)
        guard case let .group(children)? = rec.node else { throw fail(.path, "not a group") }
        var cache: [NodeID: [UInt8: BigUInt]] = [:]
        var total: [UInt8: BigUInt] = [:]
        for c in children {
            if cache[c.id] == nil {
                let w = try root(c.id)
                if !w.unitExponent.isZero { throw fail(.validity, "a group child has unit exponent 0") }
                cache[c.id] = try finiteCounts(w)
            }
            Composition.add(&total, cache[c.id]!)
        }
        memo.setTally(rec.id, total)
        return total
    }
}

extension Composition {
    static func tally(_ z: [UInt8]) -> [UInt8: BigUInt] {
        var counts: [UInt8: Int] = [:]
        for v in z { counts[v, default: 0] += 1 }
        return counts.mapValues { BigUInt($0) }
    }

    static func add(_ a: inout [UInt8: BigUInt], _ b: [UInt8: BigUInt]) {
        for (z, n) in b { a[z, default: BigUInt()] += n }
    }

    static func subtract(_ a: [UInt8: BigUInt], _ b: [UInt8: BigUInt]) throws -> [UInt8: BigUInt] {
        var out = a
        for (z, n) in b { out[z] = try out[z, default: BigUInt()] - n }
        return out.filter { !$0.value.isZero }
    }
}
