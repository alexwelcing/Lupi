import Foundation
import LupiChem
import LupiScaleCore

/// A body's magnification as the exact pair (u(A), ℓ) (§8.7): `σ_A × 10¹⁰ / f^u(A)`, with
/// `ℓ = log10(σ_A) + 10` in binary64 and u(A) exact.
public struct Magnification: Sendable, Hashable {
    public var unitExponent: BigUInt
    /// The tower factor of the anchor's unit (10 when u = 0).
    public var factor: UInt8
    public var ell: Double

    public init(unitExponent: BigUInt, factor: UInt8, ell: Double) {
        self.unitExponent = unitExponent
        self.factor = factor
        self.ell = ell
    }

    var log10f: Double { log10(Double(factor)) }

    /// u(A) · log10 f in binary64 while that is below 2⁵⁰; nil beyond.
    var decades: Double? {
        let u = unitExponent.double
        let d = u * log10f
        return d < 0x1p50 ? d : nil
    }

    /// λ in binary64, when it is meaningful there (§8.7).
    public var lambda: Double? { decades.map { ell - $0 } }

    /// φ(λ) (§8.8), finite for every v1 tower.
    public var phi: Double {
        if let l = lambda { return ScaleAxis.phi(l) }
        // λ is negative here; ln|λ| = ln u + ln(log10 f) to within 2⁻⁴⁰ (§8.7).
        let lnAbs = unitExponent.naturalLog + log(log10f)
        return -32 * (1 + lnAbs - log(32))
    }

    /// "shown 10^λ times life size", with λ in §5.5's scientific form; in the tower's base when a
    /// decimal exponent would not be exact (§8.7).
    public var readout: String {
        if let l = lambda, abs(l) <= 32 {
            if abs(l) < 0.005 { return "life size" }
            return "shown \(Readout.scientific(pow(10, l))) times life size"
        }
        if let l = lambda, factor == 10 || unitExponent.double * log10f < 0x1p50 {
            return "shown 10^(\(Readout.signed(l))) times life size"
        }
        // f^(−X), X = u − ℓ / log10 f: u exact, the ℓ term negligible at this size.
        return "shown \(factor)^(\u{2212}\(Readout.scientific(Magnitude(unitExponent)))) times life size"
    }
}

extension Resolver {
    /// The magnification of a body from its anchor's unit exponent and σ_A.
    public func magnification(of frame: BodyFrame) throws -> Magnification {
        let body = try resolve(frame.ref.root, frame.ref.path)
        let anchor = try walk(body, frame.anchorPath)
        let ell = log10(frame.metresPerAnchorUnit) + 10
        if anchor.kind == .level, let t = anchor.tower {
            return Magnification(unitExponent: anchor.unitExponent, factor: t.factor, ell: ell)
        }
        return Magnification(unitExponent: BigUInt(), factor: 10, ell: ell)
    }
}

/// Printing for the readouts.
enum Readout {
    /// `m × 10^e` with four significant digits, for an ordinary binary64 value.
    static func scientific(_ v: Double) -> String {
        guard v.isFinite, v > 0 else { return String(v) }
        var e = Int(log10(v).rounded(.down))
        var m = v / pow(10, Double(e))
        m = (m * 1000).rounded(.toNearestOrEven) / 1000
        if m >= 10 { m /= 10; e += 1 }
        if e == 0 { return String(format: "%.3g", m) }
        return String(format: "%.4g", m) + " \u{00D7} 10^\(e)"
    }

    /// A signed λ: −3.333 × 10^99, with U+2212.
    static func signed(_ l: Double) -> String {
        let s = abs(l) < 1e6 ? String(format: "%.2f", abs(l)) : scientific(abs(l))
        return (l < 0 ? "\u{2212}" : "") + s
    }

    /// An exact Magnitude in §5.5's scientific form: `m × 10^E`, 4 significant digits, E exact.
    static func scientific(_ m: Magnitude) -> String {
        let s = m.formatted
        return s.hasPrefix("\u{2248} ") ? String(s.dropFirst(2)) : s
    }
}

/// The scale axis φ(λ) (§8.8): one to one within ±32 decades, logarithmic beyond, C¹ at 32.
public enum ScaleAxis {
    public static func phi(_ lambda: Double) -> Double {
        abs(lambda) <= 32 ? lambda : (lambda < 0 ? -1 : 1) * 32 * (1 + log(abs(lambda) / 32))
    }

    public static func lambda(_ phi: Double) -> Double {
        abs(phi) <= 32 ? phi : (phi < 0 ? -1 : 1) * 32 * exp(abs(phi) / 32 - 1)
    }

    /// λ ≤ 11: one ångström drawn 10 m across (§8.7).
    public static let cap = 11.0

    /// The detent crossed going from λ0 to λ1, if any (§8.8): every decade while |λ| ≤ 32, life
    /// size, and |λ| = 10^k beyond; at most one per frame.
    public static func detent(from l0: Double, to l1: Double) -> Double? {
        let lo = min(l0, l1), hi = max(l0, l1)
        if lo < 0 && hi >= 0 || lo <= 0 && hi > 0 { return 0 }
        var candidates: [Double] = []
        let a = lo.rounded(.up), b = hi.rounded(.down)
        if a <= b {
            for d in stride(from: a, through: b, by: 1) where abs(d) <= 32 && d != l0 { candidates.append(d) }
        }
        for k in 2...400 {
            let v = pow(10, Double(k))
            if v <= 32 { continue }
            if !v.isFinite { break }
            for s in [v, -v] where s > lo && s <= hi && s != l0 { candidates.append(s) }
        }
        return candidates.min { abs($0 - l0) < abs($1 - l0) }
    }
}

/// Motion comfort (plan §5.5).
public enum Comfort: Sendable {
    case standard, gentle, still

    var factor: Double { self == .gentle ? 0.5 : 1 }
}

/// Flight along the scale axis (§8.8): up to 400 φ/s eased at 4/s while |φ| ≤ 8,192, then
/// |φ| / 20.48 per second (doubling every 14 s).
public struct Flight: Sendable {
    public var phi: Double
    public var speed: Double = 0
    /// +1 toward larger λ (things bigger), −1 toward smaller.
    public var direction: Double

    public static let cruise = 400.0
    public static let easing = 4.0
    public static let fastBeyond = 8192.0
    public static let fastRate = 20.48
    /// The displayed magnification moves at most this many decades per frame (V, §8.8).
    public static let pictureRate = 0.03

    public init(phi: Double, direction: Double) {
        self.phi = phi
        self.direction = direction < 0 ? -1 : 1
    }

    /// Advances by `dt` seconds; returns the change in φ.
    public mutating func step(_ dt: Double, comfort: Comfort = .standard) -> Double {
        let target = abs(phi) <= Self.fastBeyond ? Self.cruise : abs(phi) / Self.fastRate
        speed += (target * comfort.factor - speed) * min(1, Self.easing * dt)
        let dphi = direction * speed * dt
        phi += dphi
        return dphi
    }

    /// V for a comfort level.
    public static func pictureStep(_ comfort: Comfort) -> Double { pictureRate * comfort.factor }
}

/// Wraps (§8.8): the anchor moves by whole periods (3 levels) while its pose and σ stay, so the
/// picture stays exactly as it was and λ jumps by log10 f per period.
public enum Wraps {
    /// How many whole periods to wrap so the remaining change in λ stays below one period plus V.
    public static func periods(remaining: Double, factor: UInt8, pictureStep: Double) -> Int {
        let n = periodCount(remaining: remaining, factor: factor, pictureStep: pictureStep)
        return n.int ?? Int.max
    }

    /// The same count exactly: a dive through the googolplex wraps some 10⁹⁸ periods in a frame.
    public static func periodCount(remaining: Double, factor: UInt8, pictureStep: Double) -> BigUInt {
        let period = log10(Double(factor))
        let excess = abs(remaining) - period - pictureStep
        guard excess > 0, excess.isFinite else { return BigUInt() }
        return BigUInt(roundingUp: excess / period)
    }

    /// Appends (descending) or removes (ascending) 3n levels. The digits of a descent are constant per
    /// axis: the extreme digit on an axis whose root face the anchor touches, else ⌊f/2⌋.
    public static func wrap(_ frame: inout BodyFrame, periods n: BigUInt, descending: Bool, resolver: Resolver) throws {
        guard !n.isZero else { return }
        let body = try resolver.resolve(frame.ref.root, frame.ref.path)
        let anchor = try resolver.walk(body, frame.anchorPath)
        guard anchor.kind == .level, let t = anchor.tower else { throw ScaleError(.path, "wraps move a tower anchor") }
        let levels = n.multipliedSmall(3)
        let f = t.factor
        if descending {
            guard levels <= anchor.level else { throw ScaleError(.path, "not enough levels below the anchor") }
            let digits = AnchorPath.towerDigits(frame.anchorPath)
            var runs: [[DigitRun]] = [[], [], []]
            for a in 0..<3 {
                let d: UInt8
                if !digits[a].isEmpty && Digits.all(digits[a], f - 1) { d = f - 1 }
                else if !digits[a].isEmpty && Digits.all(digits[a], 0) { d = 0 }
                else if digits[a].isEmpty { d = 0 }
                else { d = f / 2 }
                runs[a] = [DigitRun(digit: d, length: n)]
            }
            frame.anchorPath.append(.tower(levels: levels, runs: runs))
        } else {
            var remaining = levels
            var anchorView = anchor
            while !remaining.isZero {
                guard case let .tower(d, runs)? = frame.anchorPath.last else { throw ScaleError(.path, "not enough levels above the anchor") }
                if d <= remaining {
                    frame.anchorPath.removeLast()
                    remaining = remaining.minus(d)
                    anchorView = try resolver.walk(body, frame.anchorPath)
                    continue
                }
                // Part of the last step: single levels until a whole number of periods is left,
                // then one digit per axis for each period, so a long climb costs O(runs).
                if remaining.dividedSmall(3).remainder != 0 {
                    let (rest, _) = try AnchorPath.popLevel(frame.anchorPath, anchor: anchorView)
                    frame.anchorPath = rest
                    anchorView = try resolver.walk(body, rest)
                    remaining = remaining.minus(1)
                    continue
                }
                let q = remaining.dividedSmall(3).quotient
                var upper = runs
                for a in 0..<3 { upper[a] = Digits.dropLast(runs[a], q) }
                frame.anchorPath[frame.anchorPath.count - 1] = .tower(levels: d.minus(remaining), runs: upper)
                remaining = BigUInt()
            }
        }
    }

    /// A wrap is allowed only when the last cut drew nothing at or below the tower's seed copies, no
    /// removal touches the anchor's neighbourhood, and the anchor touches every root face in its
    /// neighbourhood (§8.8).
    public static func allowed(_ frame: BodyFrame, lastCut: Cut, resolver: Resolver) -> Bool {
        guard let body = try? resolver.resolve(frame.ref.root, frame.ref.path),
              let anchor = try? resolver.walk(body, frame.anchorPath), anchor.kind == .level, anchor.removals.isEmpty,
              body.removals.isEmpty else { return false }
        for item in lastCut.items {
            if case .atoms = item.extras { return false }
        }
        let digits = AnchorPath.towerDigits(frame.anchorPath)
        guard let f = anchor.tower?.factor else { return false }
        for a in 0..<3 where !digits[a].isEmpty {
            // A root face is in the neighbourhood when the index is 0 or 1 from it; then the anchor must touch it.
            let low = Digits.smallValue(digits[a], f, limit: 1)
            let high = Digits.smallValue(Digits.complement(digits[a], f), f, limit: 1)
            if low == 1 || high == 1 { return false }
        }
        return true
    }
}

extension BigUInt {
    /// ⌈v⌉ for a finite v ≥ 0, exactly: binary64 integers above 2⁵³ are a 53-bit significand shifted.
    public init(roundingUp v: Double) {
        guard v.isFinite, v > 0 else {
            self.init()
            return
        }
        let up = v.rounded(.up)
        if up < 0x1p63 {
            self.init(UInt64(up))
            return
        }
        let e = Int(up.exponent)
        let significand = up.significandBitPattern | (1 << 52)
        self = BigUInt(significand) << (e - 52)
    }
}
