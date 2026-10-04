import Foundation

/// A molecule: atomic numbers and positions in Å. Positions are Float32, as
/// the web stores them, so bond perception sees exactly the viewer's numbers.
public struct Molecule: Sendable, Equatable, Codable {
    public var atomicNumbers: [Int]
    public var positions: [SIMD3<Float>]
    public var name: String?
    public var chemistry: FrameChemistry?
    /// The source claimed periodicity (`Lattice=`); the molecular bond recipe never applies then.
    public var periodic: Bool

    public init(
        atomicNumbers: [Int], positions: [SIMD3<Float>], name: String? = nil,
        chemistry: FrameChemistry? = nil, periodic: Bool = false
    ) {
        precondition(atomicNumbers.count == positions.count, "one position per atom")
        self.atomicNumbers = atomicNumbers
        self.positions = positions
        self.name = name
        self.chemistry = chemistry
        self.periodic = periodic
    }

    /// Positions given in double precision are rounded to Float32.
    public init(atomicNumbers: [Int], positions: [Vec3], name: String? = nil, chemistry: FrameChemistry? = nil) {
        self.init(
            atomicNumbers: atomicNumbers,
            positions: positions.map { SIMD3<Float>(Float($0.x), Float($0.y), Float($0.z)) },
            name: name, chemistry: chemistry
        )
    }

    public init(frame: XYZFrame, name: String? = nil) {
        self.init(
            atomicNumbers: frame.atomicNumbers, positions: frame.positions, name: name,
            chemistry: frame.chemistry, periodic: frame.periodic
        )
    }

    /// The first frame of an XYZ text.
    public init(xyz text: String, name: String? = nil) throws {
        self.init(frame: try XYZParser.parse(text, maxFrames: 1).first, name: name)
    }

    public var count: Int { atomicNumbers.count }
    public var isEmpty: Bool { atomicNumbers.isEmpty }

    public func position(_ atom: Int) -> Vec3 { Vec3(positions[atom]) }

    /// Atoms per atomic number.
    public var elementCounts: [Int: Int] {
        var counts: [Int: Int] = [:]
        for z in atomicNumbers { counts[z, default: 0] += 1 }
        return counts
    }

    /// Hill formula: C first, then H, then the rest alphabetically; with no
    /// carbon every element is alphabetical. "C8H10N4O2".
    public var hillFormula: String {
        var bySymbol: [String: Int] = [:]
        for (z, n) in elementCounts { bySymbol[Element.forAtomicNumber(z).symbol, default: 0] += n }
        var order: [String] = []
        if bySymbol["C"] != nil {
            order.append("C")
            if bySymbol["H"] != nil { order.append("H") }
        }
        order += bySymbol.keys.filter { !order.contains($0) }.sorted()
        return order.map { symbol in
            let n = bySymbol[symbol]!
            return n == 1 ? symbol : "\(symbol)\(n)"
        }.joined()
    }

    /// Sum of standard atomic weights, g/mol. Unknown types weigh nothing, as on the web.
    public var molarMass: Double {
        atomicNumbers.reduce(0) { $0 + Element.forAtomicNumber($1).mass }
    }

    public var heavyAtomCount: Int { atomicNumbers.lazy.filter { $0 != 1 }.count }

    /// The atoms at `indices`, in that order.
    public func subset(_ indices: [Int], name: String? = nil) -> Molecule {
        Molecule(
            atomicNumbers: indices.map { atomicNumbers[$0] }, positions: indices.map { positions[$0] },
            name: name, chemistry: nil, periodic: false
        )
    }

    /// Unweighted centroid, Å.
    public var centroid: Vec3 {
        guard !isEmpty else { return .zero }
        var sum = Vec3.zero
        for p in positions { sum += Vec3(p) }
        return sum / Double(count)
    }

    /// A copy shifted by `offset`, Å.
    public func translated(by offset: Vec3) -> Molecule {
        var copy = self
        let d = SIMD3<Float>(Float(offset.x), Float(offset.y), Float(offset.z))
        copy.positions = positions.map { $0 + d }
        return copy
    }

    /// XYZ text with 6 decimals; the comment line is the name (or the formula).
    public func xyzText(comment: String? = nil) -> String {
        var lines = ["\(count)", comment ?? name ?? hillFormula]
        for (z, p) in zip(atomicNumbers, positions) {
            lines.append("\(Element.forAtomicNumber(z).symbol) \(fixed6(p.x)) \(fixed6(p.y)) \(fixed6(p.z))")
        }
        return lines.joined(separator: "\n") + "\n"
    }
}

/// `%.6f` without Foundation's String(format:), which differs across platforms for some inputs.
func fixed6(_ value: Float) -> String {
    let scaled = (Double(value) * 1_000_000).rounded()
    if scaled == 0 { return "0.000000" }
    let negative = scaled < 0
    let magnitude = Int64(abs(scaled))
    let whole = magnitude / 1_000_000
    let frac = String(magnitude % 1_000_000)
    let padded = String(repeating: "0", count: 6 - frac.count) + frac
    return "\(negative ? "-" : "")\(whole).\(padded)"
}
