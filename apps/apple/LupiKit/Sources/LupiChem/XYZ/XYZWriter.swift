import Foundation

/// The comment line of an extended XYZ file Lupi writes: an optional title,
/// then `key=value` pairs separated by ` | `, the edge's style
/// (contracts.md §1.4). Every key here is one the web's parser and
/// `XYZParser` read back (`charge=`, `multiplicity=`, `charge_source=`,
/// `data_id=`) or one the contract adds.
public struct XYZComment: Sendable, Equatable {
    /// Free text before the keys: "Lupi fragment", "Lupi built".
    public var title: String?
    /// Hill formula, recomputed from the coordinates (never copied from a label).
    public var formula: String?
    /// Written as `charge=`, `multiplicity=`, `charge_source=` and `data_id=`.
    public var chemistry: FrameChemistry?
    /// The formula a fragment broke from.
    public var parent: String?
    /// Provenance, e.g. `omol25:neutral-validation:1008` for an OMol25-derived piece.
    public var source: String?
    /// e.g. `CC-BY-4.0`, which OMol25-derived pieces keep.
    public var license: String?
    /// `lupi-play` for coordinates the game wrote.
    public var coordinates: String?
    /// Further keys, in order, after the ones above. Keys that a parser could
    /// not read back (`[A-Za-z_][A-Za-z0-9_-]*`) are dropped.
    public var extra: [XYZKey]

    public init(
        title: String? = nil, formula: String? = nil, chemistry: FrameChemistry? = nil, parent: String? = nil,
        source: String? = nil, license: String? = nil, coordinates: String? = nil, extra: [XYZKey] = []
    ) {
        self.title = title
        self.formula = formula
        self.chemistry = chemistry
        self.parent = parent
        self.source = source
        self.license = license
        self.coordinates = coordinates
        self.extra = extra
    }

    /// Chemistry that says only that the charge is not known: what makes the
    /// web give a single frame `lupi-bonds.molecular.v1` on auto.
    public static let unknownCharge = FrameChemistry(totalCharge: nil, spinMultiplicity: nil, source: .unavailable, domain: nil)

    /// The key-value pairs in the order they are written.
    public var pairs: [XYZKey] {
        var out: [XYZKey] = []
        if let formula { out.append(XYZKey("formula", formula)) }
        if let chemistry {
            if let charge = chemistry.totalCharge { out.append(XYZKey("charge", String(charge))) }
            if let spin = chemistry.spinMultiplicity { out.append(XYZKey("multiplicity", String(spin))) }
            out.append(XYZKey("charge_source", chemistry.source.rawValue))
            if let domain = chemistry.domain, !domain.isEmpty { out.append(XYZKey("data_id", domain)) }
        }
        if let parent { out.append(XYZKey("parent", parent)) }
        if let source { out.append(XYZKey("source", source)) }
        if let license { out.append(XYZKey("license", license)) }
        if let coordinates { out.append(XYZKey("coordinates", coordinates)) }
        return out + extra.filter(\.isReadable)
    }

    /// The comment line, without its newline.
    public var line: String {
        var parts: [String] = []
        if let title {
            let clean = XYZWriter.cleanTitle(title)
            if !clean.isEmpty { parts.append(clean) }
        }
        for pair in pairs { parts.append("\(pair.key)=\(XYZWriter.quote(pair.value))") }
        return parts.joined(separator: " | ")
    }
}

public struct XYZKey: Sendable, Equatable {
    public var key: String
    public var value: String

    public init(_ key: String, _ value: String) {
        self.key = key
        self.value = value
    }

    /// Matches the parsers' key grammar, `[A-Za-z_][A-Za-z0-9_-]*`.
    public var isReadable: Bool {
        guard let first = key.unicodeScalars.first, first.isASCII,
              first.properties.isAlphabetic || first == "_" else { return false }
        return key.unicodeScalars.allSatisfy { $0.isASCII && ($0.properties.isAlphabetic || ("0"..."9").contains($0) || $0 == "_" || $0 == "-") }
    }
}

/// XYZ text that both parsers read back to the same atoms, Float32 positions
/// and chemistry: the atom count, the comment line, then `Symbol x y z` in Å
/// with fixed decimals (five by default, contracts.md §1.4). Coordinates are
/// formatted from the exact binary value of each Float32, rounding half away
/// from zero (as JavaScript's `toFixed`), and a zero is never signed.
public enum XYZWriter {
    public static let defaultDecimals = 5

    public static func text(
        atomicNumbers: [Int], positions: [SIMD3<Float>], comment: XYZComment, decimals: Int = defaultDecimals
    ) -> String {
        text(atomicNumbers: atomicNumbers, positions: positions, commentLine: comment.line, decimals: decimals)
    }

    public static func text(_ molecule: Molecule, comment: XYZComment, decimals: Int = defaultDecimals) -> String {
        text(atomicNumbers: molecule.atomicNumbers, positions: molecule.positions, comment: comment, decimals: decimals)
    }

    /// `commentLine` is written as given, with line breaks turned into spaces.
    public static func text(
        atomicNumbers: [Int], positions: [SIMD3<Float>], commentLine: String, decimals: Int = defaultDecimals
    ) -> String {
        let count = min(atomicNumbers.count, positions.count)
        var out = "\(count)\n\(singleLine(commentLine))\n"
        out.reserveCapacity(out.utf8.count + count * (8 + 3 * (decimals + 6)))
        for k in 0..<count {
            let p = positions[k]
            out += ChemicalElement.forAtomicNumber(atomicNumbers[k]).symbol
            out += " " + fixed(p.x, decimals: decimals)
            out += " " + fixed(p.y, decimals: decimals)
            out += " " + fixed(p.z, decimals: decimals) + "\n"
        }
        return out
    }

    /// What a trophy embeds (contracts.md §1.4): centred on the centre of mass in
    /// the molecule's body frame, five decimals, the formula recomputed from the
    /// atoms, `charge_source=unavailable` unless `chemistry` says otherwise, and
    /// `coordinates=lupi-play`.
    public static func embedded(
        _ molecule: Molecule, title: String, parent: String? = nil, source: String? = nil, license: String? = nil,
        chemistry: FrameChemistry = XYZComment.unknownCharge
    ) -> String {
        let comment = XYZComment(
            title: title, formula: molecule.hillFormula, chemistry: chemistry, parent: parent,
            source: source, license: license, coordinates: "lupi-play"
        )
        return text(centredOnCentreOfMass(molecule), comment: comment)
    }

    /// The molecule moved so its centre of mass (standard atomic weights) is the origin, Float32 again.
    public static func centredOnCentreOfMass(_ molecule: Molecule) -> Molecule {
        guard !molecule.isEmpty else { return molecule }
        let com = molecule.inertia.centerOfMass
        var copy = molecule
        copy.positions = molecule.positions.map { p in
            let d = Vec3(p) - com
            return SIMD3<Float>(Float(d.x), Float(d.y), Float(d.z))
        }
        return copy
    }

    // MARK: - Formatting

    /// The decimal of `value` with `decimals` digits after the point, rounded
    /// from its exact binary value, ties away from zero; never "-0.000".
    public static func fixed(_ value: Float, decimals: Int) -> String {
        precondition((0...9).contains(decimals), "0 to 9 decimals")
        guard value.isFinite else { return value.isNaN ? "nan" : (value < 0 ? "-inf" : "inf") }
        var scale: UInt64 = 1
        for _ in 0..<decimals { scale *= 10 }
        let magnitude = abs(value)
        // magnitude = significand × 2^exponent, exactly.
        let significand: UInt64
        let exponent: Int
        if magnitude.exponentBitPattern == 0 {
            significand = UInt64(magnitude.significandBitPattern)
            exponent = -149
        } else {
            significand = UInt64(magnitude.significandBitPattern) | (1 << 23)
            exponent = Int(magnitude.exponentBitPattern) - 150
        }
        let digits: UInt64
        if exponent >= 0 {
            // Up to 2^128 does not fit; such coordinates are not molecules, so fall back to Double.
            guard exponent <= 63 - 24 - 30 else { return String(format: "%.\(decimals)f", Double(value)) }
            digits = (significand << UInt64(exponent)) * scale
        } else {
            let n = significand * scale                      // < 2^24 · 10^9 < 2^54
            let k = -exponent
            if k >= 64 {
                digits = 0                                   // n < 2^54 ≤ half of 2^k
            } else {
                let q = n >> UInt64(k)
                let r = n - (q << UInt64(k))
                let half = UInt64(1) << UInt64(k - 1)
                digits = r >= half ? q + 1 : q
            }
        }
        let whole = digits / scale
        var text = String(whole)
        if decimals > 0 {
            let fraction = String(digits % scale)
            text += "." + String(repeating: "0", count: decimals - fraction.count) + fraction
        }
        return value < 0 && digits != 0 ? "-" + text : text
    }

    static func singleLine(_ text: String) -> String {
        String(text.map { $0 == "\n" || $0 == "\r" ? " " : $0 })
    }

    /// A title that parses as no key and no timestep.
    static func cleanTitle(_ title: String) -> String {
        let flat = singleLine(title).replacingOccurrences(of: "=", with: "-").trimmingCharacters(in: .whitespaces)
        return flat.allSatisfy(\.isNumber) && !flat.isEmpty ? "#" + flat : flat
    }

    /// A value the parsers read back whole: bare when it has no whitespace or
    /// leading quote, else quoted.
    static func quote(_ raw: String) -> String {
        let value = singleLine(raw)
        let needsQuotes = value.isEmpty || value.contains(where: \.isWhitespace)
            || value.hasPrefix("\"") || value.hasPrefix("'")
        guard needsQuotes else { return value }
        if !value.contains("\"") { return "\"\(value)\"" }
        if !value.contains("'") { return "'\(value)'" }
        return "\"\(value.replacingOccurrences(of: "\"", with: "'"))\""
    }
}
