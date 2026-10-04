import Foundation

/// Where a frame's declared charge and spin came from (the web's `ChemistrySource`).
public enum ChemistrySource: String, Sendable, Codable, CaseIterable {
    case record
    case splitDefinition = "split-definition"
    case fileDeclared = "file-declared"
    case unavailable
}

/// Declared charge and spin multiplicity of a frame (the web's `FrameChemistry`).
public struct FrameChemistry: Sendable, Hashable, Codable {
    public var totalCharge: Int?
    public var spinMultiplicity: Int?
    public var source: ChemistrySource
    /// OMol25's `data_id` (its source domain), when the comment names one.
    public var domain: String?

    public init(totalCharge: Int?, spinMultiplicity: Int?, source: ChemistrySource, domain: String?) {
        self.totalCharge = totalCharge
        self.spinMultiplicity = spinMultiplicity
        self.source = source
        self.domain = domain
    }
}

/// The OMol25 row behind a comment that begins `OMol25 ` (the edge and featured-pick format).
public struct OmolSourceRecord: Sendable, Hashable, Codable {
    public var collection: String?
    public var row: Int?
    public var method: String?
    public var energyEv: Double?
    public var maxForceEvPerA: Double?
    public var homoLumoGapEv: Double?
    public var license: String?
    public var source: String?
}

/// One parsed frame. Positions are in Å, rounded to Float32 as the web stores them.
public struct XYZFrame: Sendable, Equatable {
    public var atomicNumbers: [Int]
    public var positions: [SIMD3<Float>]
    public var comment: String
    /// `Lattice=` is present (even if malformed): the frame claims periodicity.
    public var periodic: Bool
    /// The nine `Lattice=` numbers (a, b, c row vectors), when well formed.
    public var lattice: [Double]?
    public var chemistry: FrameChemistry?
    public var sourceRecord: OmolSourceRecord?
    public var timestep: Int?

    public var atomCount: Int { atomicNumbers.count }
}

public struct XYZDocument: Sendable, Equatable {
    public var frames: [XYZFrame]
    /// True when `maxFrames` stopped the parse with more text left.
    public var hasMoreFrames: Bool

    /// The frame the app uses.
    public var first: XYZFrame { frames[0] }
}

public struct XYZParseError: Error, Sendable, Equatable, CustomStringConvertible {
    public var message: String
    public var line: Int
    public var frameIndex: Int
    public var description: String { message }
}

/// XYZ and extended-XYZ, ported from packages/parsers/src/xyzParser.ts: element
/// symbols (case-insensitive) or atomic numbers, `Properties=` column layouts,
/// `Lattice=` (periodic), and the comment keys `charge=`, `multiplicity=` /
/// `spin_multiplicity=`, `charge_source=`, `data_id=`, plus an `OMol25 ` record.
public enum XYZParser {
    public static func parse(_ text: String, maxFrames: Int? = nil) throws -> XYZDocument {
        try parse(bytes: Array(text.utf8), maxFrames: maxFrames)
    }

    public static func parse(bytes: [UInt8], maxFrames: Int? = nil) throws -> XYZDocument {
        try bytes.withUnsafeBufferPointer { try parse(buffer: $0, maxFrames: maxFrames ?? .max) }
    }

    /// Atomic number for an element token, as `xyzElementToType`: unknown tokens are errors, never hydrogen.
    public static func atomicNumber(forToken token: String) throws -> Int {
        let trimmed = JSText.trim(token)
        var body = Substring(trimmed)
        if body.hasPrefix("+") { body = body.dropFirst() }
        if !body.isEmpty && body.allSatisfy({ $0.isASCII && $0.isNumber }) {
            let digits = body.drop(while: { $0 == "0" })
            let value = digits.count > 4 ? Int.max : (Int(digits) ?? 0)
            guard value >= 1 && value <= 118 else {
                throw XYZTokenError("atomic number \(digits.count > 4 ? String(digits) : String(value)) is outside 1..118")
            }
            return value
        }
        guard let z = ChemicalElement.atomicNumber(forSymbol: trimmed) else {
            throw XYZTokenError("unknown element token '\(trimmed)'")
        }
        return z
    }

    // MARK: - Frames

    private static func parse(buffer b: UnsafeBufferPointer<UInt8>, maxFrames: Int) throws -> XYZDocument {
        var frames: [XYZFrame] = []
        let length = b.count
        var pos = 0
        var lineNumber = 0
        if length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF { pos = 3 }

        func nextLineEnd(_ from: Int) -> Int {
            var k = from
            while k < length && b[k] != ByteScan.newline { k += 1 }
            return k
        }
        func text(_ start: Int, _ end: Int) -> String {
            String(decoding: UnsafeBufferPointer(rebasing: b[start..<end]), as: UTF8.self)
        }

        while pos < length && frames.count < maxFrames {
            // Atom count line; blank lines between frames are skipped.
            var lineEnd = nextLineEnd(pos)
            lineNumber += 1
            var s = pos
            while s < lineEnd && ByteScan.isSpace(b[s]) { s += 1 }
            var e = lineEnd
            while e > s && ByteScan.isSpace(b[e - 1]) { e -= 1 }
            if s == e {
                pos = lineEnd + 1
                continue
            }
            var natoms = 0
            var countValid = true
            for k in s..<e {
                let digit = Int(b[k]) - 48
                if digit < 0 || digit > 9 {
                    countValid = false
                    break
                }
                natoms = natoms * 10 + digit
                if natoms > 2_000_000_000 {
                    countValid = false
                    break
                }
            }
            if !countValid {
                throw XYZParseError(
                    message: "Expected atom count at line \(lineNumber), got: '\(text(s, min(e, s + 80)))'",
                    line: lineNumber, frameIndex: frames.count
                )
            }
            pos = lineEnd + 1
            if pos >= length { break }

            lineEnd = nextLineEnd(pos)
            lineNumber += 1
            let commentLine = lineNumber
            let comment = text(pos, lineEnd)
            pos = lineEnd + 1
            let info = try parseComment(comment, frameIndex: frames.count, lineNumber: commentLine)
            let layout = info.layout

            var positions = [SIMD3<Float>]()
            var types = [Int]()
            positions.reserveCapacity(natoms)
            types.reserveCapacity(natoms)
            var tokenStarts = [Int](repeating: 0, count: layout.requiredTokens)
            var tokenEnds = [Int](repeating: 0, count: layout.requiredTokens)

            for atom in 0..<natoms {
                if pos >= length {
                    throw XYZParseError(
                        message: "Unexpected end of file while reading atom \(atom + 1) of frame \(frames.count + 1)",
                        line: lineNumber, frameIndex: frames.count
                    )
                }
                lineEnd = nextLineEnd(pos)
                lineNumber += 1
                var i = pos
                var tokenCount = 0
                while i < lineEnd && tokenCount < layout.requiredTokens {
                    while i < lineEnd && ByteScan.isSpace(b[i]) { i += 1 }
                    if i >= lineEnd { break }
                    let tokenStart = i
                    while i < lineEnd && !ByteScan.isSpace(b[i]) { i += 1 }
                    tokenStarts[tokenCount] = tokenStart
                    tokenEnds[tokenCount] = i
                    tokenCount += 1
                }
                if tokenCount < layout.requiredTokens {
                    throw XYZParseError(
                        message: "Expected at least \(layout.requiredTokens) columns at line \(lineNumber), "
                            + "got: '\(text(pos, min(lineEnd, pos + 120)))'",
                        line: lineNumber, frameIndex: frames.count
                    )
                }
                let species = text(tokenStarts[layout.speciesToken], tokenEnds[layout.speciesToken])
                let z: Int
                do {
                    z = try atomicNumber(forToken: species)
                } catch let error as XYZTokenError {
                    throw XYZParseError(
                        message: "Invalid XYZ element at line \(lineNumber): \(error.message)",
                        line: lineNumber, frameIndex: frames.count
                    )
                }
                let p = layout.posToken
                let x = ByteScan.scanFloat(b, tokenStarts[p], tokenEnds[p])
                let y = ByteScan.scanFloat(b, tokenStarts[p + 1], tokenEnds[p + 1])
                let zc = ByteScan.scanFloat(b, tokenStarts[p + 2], tokenEnds[p + 2])
                for (axis, value) in [("x", x), ("y", y), ("z", zc)] where value.isNaN {
                    throw XYZParseError(
                        message: "Invalid \(axis) coordinate at line \(lineNumber)", line: lineNumber, frameIndex: frames.count
                    )
                }
                // Float32 rounding, as the web's Float32Array store.
                positions.append(SIMD3(Float(x), Float(y), Float(zc)))
                types.append(z)
                pos = lineEnd + 1
            }

            frames.append(XYZFrame(
                atomicNumbers: types, positions: positions, comment: comment, periodic: info.periodic,
                lattice: info.lattice, chemistry: info.chemistry, sourceRecord: info.sourceRecord,
                timestep: info.timestep ?? frames.count
            ))
        }

        if frames.isEmpty {
            throw XYZParseError(message: "No valid XYZ frames found", line: lineNumber, frameIndex: 0)
        }
        var more = false
        if frames.count >= maxFrames {
            var k = pos
            while k < length {
                if !ByteScan.isSpace(b[k]) && b[k] != ByteScan.newline {
                    more = true
                    break
                }
                k += 1
            }
        }
        return XYZDocument(frames: frames, hasMoreFrames: more)
    }

    // MARK: - Comment line

    struct Layout: Equatable {
        var speciesToken: Int
        var posToken: Int
        var requiredTokens: Int
    }

    static let defaultLayout = Layout(speciesToken: 0, posToken: 1, requiredTokens: 4)

    struct CommentInfo {
        var timestep: Int?
        var lattice: [Double]?
        var layout = XYZParser.defaultLayout
        var periodic = false
        var chemistry: FrameChemistry?
        var sourceRecord: OmolSourceRecord?
    }

    /// `parseXyzProperties`: the species and position columns of a `Properties=` declaration.
    static func parseProperties(_ spec: String) throws -> Layout {
        let parts = spec.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard parts.count >= 3, parts.count % 3 == 0 else {
            throw XYZTokenError("malformed Properties declaration '\(spec)'")
        }
        var columns: [(name: String, kind: String, count: Int)] = []
        for k in stride(from: 0, to: parts.count, by: 3) {
            let kind = parts[k + 1].uppercased()
            let count = JSText.number(parts[k + 2])
            guard ["S", "R", "I", "L"].contains(kind), count.isFinite, count.rounded(.towardZero) == count, count >= 1 else {
                throw XYZTokenError("malformed Properties declaration '\(spec)'")
            }
            columns.append((parts[k], kind, Int(count)))
        }
        var token = 0
        var species = -1
        var position = -1
        for column in columns {
            let lower = column.name.lowercased()
            if species < 0 && column.kind == "S" && column.count == 1
                && ["species", "element", "symbol", "type"].contains(lower) {
                species = token
            } else if position < 0 && column.kind == "R" && column.count == 3
                && ["pos", "position", "positions"].contains(lower) {
                position = token
            }
            token += column.count
        }
        if species < 0 {
            guard let first = columns.firstIndex(where: { $0.kind == "S" && $0.count == 1 }) else {
                throw XYZTokenError("Properties declaration '\(spec)' has no species column")
            }
            species = columns[..<first].reduce(0) { $0 + $1.count }
        }
        if position < 0 {
            var offset = 0
            for column in columns {
                if column.kind == "R" && column.count == 3 {
                    position = offset
                    break
                }
                offset += column.count
            }
            if position < 0 { throw XYZTokenError("Properties declaration '\(spec)' has no pos:R:3 column") }
        }
        return Layout(speciesToken: species, posToken: position, requiredTokens: token)
    }

    /// The `key=value` pairs of a comment, in order, matching the web's
    /// /([A-Za-z_][A-Za-z0-9_\-]*)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g. Keys are lowercased.
    static func commentPairs(_ trimmed: String) -> [(key: String, value: String)] {
        let s = Array(trimmed.unicodeScalars)
        var out: [(String, String)] = []
        func isKeyStart(_ c: Unicode.Scalar) -> Bool {
            (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c == "_"
        }
        func isKeyChar(_ c: Unicode.Scalar) -> Bool { isKeyStart(c) || (c >= "0" && c <= "9") || c == "-" }
        var start = 0
        while start < s.count {
            guard isKeyStart(s[start]) else {
                start += 1
                continue
            }
            var k = start + 1
            while k < s.count && isKeyChar(s[k]) { k += 1 }
            let keyEnd = k
            while k < s.count && JSText.isWhitespace(s[k]) { k += 1 }
            guard k < s.count, s[k] == "=" else {
                start += 1
                continue
            }
            k += 1
            while k < s.count && JSText.isWhitespace(s[k]) { k += 1 }
            var value: String?
            var end = k
            if k < s.count, s[k] == "\"" || s[k] == "'" {
                let quote = s[k]
                if let close = s[(k + 1)...].firstIndex(of: quote) {
                    value = String(String.UnicodeScalarView(s[(k + 1)..<close]))
                    end = close + 1
                }
            }
            if value == nil {
                var m = k
                while m < s.count && !JSText.isWhitespace(s[m]) { m += 1 }
                if m > k {
                    value = String(String.UnicodeScalarView(s[k..<m]))
                    end = m
                }
            }
            guard let value else {
                start += 1
                continue
            }
            out.append((String(String.UnicodeScalarView(s[start..<keyEnd])).lowercased(), value))
            start = end
        }
        return out
    }

    static func parseComment(_ comment: String, frameIndex: Int, lineNumber: Int) throws -> CommentInfo {
        let trimmed = JSText.trim(comment)
        var info = CommentInfo()
        if !trimmed.isEmpty && trimmed.unicodeScalars.allSatisfy({ $0 >= "0" && $0 <= "9" }) {
            info.timestep = Int(trimmed)
            return info
        }
        var keys: [String: String] = [:]
        for (key, value) in commentPairs(trimmed) {
            if keys[key] == nil { keys[key] = value }
            switch key {
            case "lattice":
                info.periodic = true
                let numbers = splitOnWhitespace(JSText.trim(value)).map(JSText.number)
                if numbers.count == 9 && numbers.allSatisfy(\.isFinite) { info.lattice = numbers }
            case "properties":
                do {
                    info.layout = try parseProperties(JSText.trim(value))
                } catch let error as XYZTokenError {
                    throw XYZParseError(
                        message: "Invalid extended-XYZ header at line \(lineNumber): \(error.message)",
                        line: lineNumber, frameIndex: frameIndex
                    )
                }
            case "step", "timestep", "frame":
                if info.timestep == nil {
                    let n = JSText.number(value)
                    if n.isFinite && n.rounded(.towardZero) == n && n >= 0 && n <= 9_007_199_254_740_991 {
                        info.timestep = Int(n)
                    }
                }
            default:
                break
            }
        }
        info.chemistry = readChemistry(keys)
        info.sourceRecord = readSourceRecord(trimmed, keys)
        return info
    }

    /// `readChemistry`: a bare `spin=` is never read (tools use it for S, 2S or 2S+1).
    static func readChemistry(_ keys: [String: String]) -> FrameChemistry? {
        let charge = JSText.boundedInteger(keys["charge"], min: -20, max: 20)
        let spin = JSText.boundedInteger(keys["multiplicity"] ?? keys["spin_multiplicity"], min: 1, max: 20)
        let source = keys["charge_source"].flatMap(ChemistrySource.init(rawValue:))
        if charge == nil && spin == nil && source == nil { return nil }
        let domain = keys["data_id"].flatMap { $0.isEmpty ? nil : $0 }
        return FrameChemistry(totalCharge: charge, spinMultiplicity: spin, source: source ?? .fileDeclared, domain: domain)
    }

    static func readSourceRecord(_ comment: String, _ keys: [String: String]) -> OmolSourceRecord? {
        guard comment.hasPrefix("OMol25 ") else { return nil }
        let rest = String(comment.dropFirst("OMol25 ".count))
        let leading = splitOnWhitespace(rest, keepLeadingEmpty: true).first ?? ""
        func nonEmpty(_ key: String) -> String? { keys[key].flatMap { $0.isEmpty ? nil : $0 } }
        return OmolSourceRecord(
            collection: nonEmpty("collection") ?? (!leading.isEmpty && !leading.contains("=") ? leading : nil),
            row: JSText.boundedInteger(keys["row"], min: 0, max: 9_007_199_254_740_991),
            method: nonEmpty("method"),
            energyEv: JSText.finiteNumber(keys["energy_ev"]),
            maxForceEvPerA: JSText.finiteNumber(keys["max_force_ev_per_a"]),
            homoLumoGapEv: JSText.finiteNumber(keys["homo_lumo_gap_ev"]),
            license: nonEmpty("license"),
            source: nonEmpty("source")
        )
    }

    /// `text.split(/\s+/)`; JavaScript keeps an empty first piece when the text starts with whitespace.
    static func splitOnWhitespace(_ text: String, keepLeadingEmpty: Bool = false) -> [String] {
        var pieces: [String] = []
        var current = String.UnicodeScalarView()
        var sawSeparator = false
        for scalar in text.unicodeScalars {
            if JSText.isWhitespace(scalar) {
                if !sawSeparator {
                    pieces.append(String(current))
                    current = String.UnicodeScalarView()
                }
                sawSeparator = true
            } else {
                sawSeparator = false
                current.append(scalar)
            }
        }
        pieces.append(String(current))
        if !keepLeadingEmpty, pieces.first == "" { pieces.removeFirst() }
        return pieces
    }
}

struct XYZTokenError: Error {
    var message: String
    init(_ message: String) { self.message = message }
}
