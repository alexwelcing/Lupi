import Foundation
@testable import LupiChem

// The checks of tools/omol25-bonds/run.mts, ported so the Swift recipe can be
// held to packages/core/src/bonds/validation-v1.json: the hard targets
// (no multi-bonded H, nothing over the v1 caps, no line touching an s-block
// ion, determinism, p99 time at 350 atoms) and the reported totals.

/// validation-sample.json, written by tools/apple/export-validation-sample.mts.
struct ValidationSample: Decodable {
    var schema: String
    var validation: Validation
    var rows: [Row]

    struct Validation: Decodable {
        var recipe: String
        var rows: Int
        var tolerance: Double
        var pass: Bool
        var targets: Targets
        var hard: Targets
        var parameters: Parameters
        var handCheck: [String: HandCheck]
        var reported: Reported
    }

    struct Targets: Decodable {
        var multiBondH: Int
        var overValent: Int
        var covalentIonSticks: Int
        var deterministic: Bool
        var p99Ms: Double
    }

    struct Parameters: Decodable {
        var contactMargin: Double
        var hapticRatio: Double
        var metalMetalSlack: Double
        var metalHydrideSlack: Double
        var oxygenCap: Int
        var ionCapDelta: Int
        var highSpinRadii: [String: Double]
        var ionRadii: Table
        var donorRadii: Table
        var maxIonContactA: Double
        var ionCoordinationCaps: [String: Int]

        struct Table: Decodable { var values: [String: Double] }
    }

    struct HandCheck: Decodable {
        var formula: String
        var atoms: Int
        var counts: BondCounts
        var ionContacts: [String: [String]]
        var removed: [String: [String]]
    }

    struct Reported: Decodable, Equatable {
        var kinds: [String: Int]
        var removedByReason: [String: Int]
        var ions: Int
        var isolatedIons: Int
        var ionContactHistogram: [String: [String: Int]]
        var contactPartners: [String: Int]
        var saltRows: Int
        var bridgedBoraneRows: Int
        var bridgingH: Int
        var longBondRows: Int
        var longBonds: Int
        var nearMissPairs: Int
        var clashRows: Int
        var ionCarbonCloseRows: Int
        var truncatedRows: Int
        var timing350Atoms: Timing?

        static func == (a: Reported, b: Reported) -> Bool {
            a.kinds == b.kinds && a.removedByReason == b.removedByReason && a.ions == b.ions
                && a.isolatedIons == b.isolatedIons && a.ionContactHistogram == b.ionContactHistogram
                && a.contactPartners == b.contactPartners && a.saltRows == b.saltRows
                && a.bridgedBoraneRows == b.bridgedBoraneRows && a.bridgingH == b.bridgingH
                && a.longBondRows == b.longBondRows && a.longBonds == b.longBonds && a.nearMissPairs == b.nearMissPairs
                && a.clashRows == b.clashRows && a.ionCarbonCloseRows == b.ionCarbonCloseRows
                && a.truncatedRows == b.truncatedRows
        }
    }

    struct Timing: Decodable {
        var samples: Int
        var p99: Double
    }

    struct Row: Decodable {
        var row: Int
        var formula: String
        var why: [String]
        var atomicNumbers: [Int]
        var positions: [Double]
        var run: Run

        /// The TypeScript `perceiveBonds` at τ = 0.45, molecular recipe.
        struct Run: Decodable {
            var pairs: [Int]
            var kinds: [UInt8]
            var distances: [Double]
            var counts: BondCounts
            var evidence: BondFixtureCase.Evidence?
        }

        var floatPositions: [SIMD3<Float>] {
            stride(from: 0, to: positions.count, by: 3).map {
                SIMD3(Float(positions[$0]), Float(positions[$0 + 1]), Float(positions[$0 + 2]))
            }
        }
    }
}

/// Every metric run.mts keeps for the molecular recipe, summed over rows.
struct ValidationTally: Equatable {
    var rows = 0
    var multiBondHRows = 0
    var overValentRows = 0
    var overValentByElement: [String: Int] = [:]
    var reported = ValidationSample.Reported(
        kinds: ["covalent": 0, "coordination": 0, "ionicContact": 0], removedByReason: [:], ions: 0, isolatedIons: 0,
        ionContactHistogram: [:], contactPartners: [:], saltRows: 0, bridgedBoraneRows: 0, bridgingH: 0,
        longBondRows: 0, longBonds: 0, nearMissPairs: 0, clashRows: 0, ionCarbonCloseRows: 0, truncatedRows: 0
    )
    var allowedMultiPartnerH: [String: Int] = [:]
    /// Covalent or coordination lines touching an s-block ion.
    var covalentIonSticks = 0

    static let halogens: Set<Int> = [9, 17, 35, 53]

    static func symbol(_ z: Int) -> String { ChemicalElement.forAtomicNumber(z).symbol }

    /// run.mts `allowedMultiPartnerH`: a B–H–B bridge, an η²-H₂ hydrogen, or a hydride between two metals.
    static func allowedMultiPartner(_ z: [Int], _ partners: [Int]) -> String? {
        let metals = partners.filter { ElementClass(z: z[$0]) == .metal }.count
        let hydrogens = partners.filter { z[$0] == 1 }.count
        if partners.count == 2 && partners.allSatisfy({ z[$0] == 5 }) { return "boraneBridge" }
        if hydrogens == 1 && metals == partners.count - 1 { return "eta2H2" }
        if partners.count == 2 && metals == 2 { return "hydrideBridge" }
        return nil
    }

    mutating func add(_ z: [Int], _ p: PerceivedBonds) {
        rows += 1
        let n = z.count
        var linked = [[Int]](repeating: [], count: n)
        var covalent = [[Int]](repeating: [], count: n)
        var contacts = [[Int]](repeating: [], count: n)
        for bond in p.bonds {
            switch bond.kind {
            case .ionicContact:
                contacts[bond.i].append(bond.j)
                contacts[bond.j].append(bond.i)
            case .covalent, .coordination:
                linked[bond.i].append(bond.j)
                linked[bond.j].append(bond.i)
                if bond.kind == .covalent {
                    covalent[bond.i].append(bond.j)
                    covalent[bond.j].append(bond.i)
                }
            }
        }

        var multiH = false
        var borane = false
        for a in 0..<n where z[a] == 1 && linked[a].count > 1 {
            let allowed = Self.allowedMultiPartner(z, linked[a])
            if let allowed { allowedMultiPartnerH[allowed, default: 0] += 1 }
            if allowed == "boraneBridge" { borane = true }
            if allowed == nil { multiH = true }
        }
        if multiH { multiBondHRows += 1 }
        if borane { reported.bridgedBoraneRows += 1 }

        // Over the v1 caps: H 1 (bar the allowed bridges), C 4, N 4, O 3, F 1, Cl/Br/I ≤ 7 with ≤ 1 non-O/F partner.
        var over = false
        for a in 0..<n {
            let za = z[a]
            var isOver = false
            if za == 1 {
                isOver = linked[a].count > 1 && Self.allowedMultiPartner(z, linked[a]) == nil
            } else if za == 6 || za == 7 || za == 8 || Self.halogens.contains(za) {
                let partners = covalent[a]
                if partners.count > ValenceCaps.caps[za]! {
                    isOver = true
                } else if za != 9 && Self.halogens.contains(za) && partners.filter({ z[$0] != 8 && z[$0] != 9 }).count > 1 {
                    isOver = true
                }
            }
            if isOver {
                over = true
                overValentByElement[Self.symbol(za), default: 0] += 1
            }
        }
        if over { overValentRows += 1 }

        var salt = false
        for a in 0..<n where ElementClass(z: z[a]) == .ion {
            salt = true
            reported.ions += 1
            reported.ionContactHistogram[Self.symbol(z[a]), default: [:]][String(contacts[a].count), default: 0] += 1
            if contacts[a].isEmpty && linked[a].isEmpty { reported.isolatedIons += 1 }
            for b in contacts[a] { reported.contactPartners[Self.symbol(z[b]), default: 0] += 1 }
            covalentIonSticks += linked[a].count
        }
        if salt { reported.saltRows += 1 }

        reported.kinds["covalent", default: 0] += p.counts.covalent
        reported.kinds["coordination", default: 0] += p.counts.coordination
        reported.kinds["ionicContact", default: 0] += p.counts.ionicContact
        for removed in p.evidence ?? [] { reported.removedByReason[String(describing: removed.reason), default: 0] += 1 }
        if p.counts.clashes > 0 { reported.clashRows += 1 }
        if p.counts.long > 0 { reported.longBondRows += 1 }
        reported.longBonds += p.counts.long
        reported.nearMissPairs += p.counts.nearMiss
        if p.counts.ionCarbonClose > 0 { reported.ionCarbonCloseRows += 1 }
        reported.bridgingH += p.counts.bridgingH
    }

}

/// The hand-check lines of run.mts: "N24 1.76 Å" per ionic contact, "S23–Li27 2.76 Å" per removed pair.
enum HandCheckLines {
    static func ionContacts(_ z: [Int], _ p: PerceivedBonds) -> [String: [String]] {
        var out: [String: [String]] = [:]
        for bond in p.bonds where bond.kind == .ionicContact {
            let ion = ElementClass(z: z[bond.i]) == .ion ? bond.i : bond.j
            let donor = ion == bond.i ? bond.j : bond.i
            out["\(ValidationTally.symbol(z[ion]))\(ion)", default: []]
                .append("\(ValidationTally.symbol(z[donor]))\(donor) \(XYZWriter.fixed(bond.distance, decimals: 2)) Å")
        }
        return out
    }

    static func removed(_ z: [Int], _ p: PerceivedBonds) -> [String: [String]] {
        var out: [String: [String]] = [:]
        for pair in p.evidence ?? [] {
            out[String(describing: pair.reason), default: []].append(
                "\(ValidationTally.symbol(z[pair.i]))\(pair.i)–\(ValidationTally.symbol(z[pair.j]))\(pair.j) "
                    + "\(XYZWriter.fixed(pair.distance, decimals: 2)) Å"
            )
        }
        return out
    }
}

enum RecipeTiming {
    static let clusterAtoms = 350

    /// run.mts `clusters`: molecules shelved 2.5 Å apart in a 24 Å box, the last cut to make exactly 350 atoms.
    static func clusters(_ rows: [(z: [Int], positions: [SIMD3<Float>])], count: Int) -> [(z: [Int], positions: [SIMD3<Float>])] {
        var out: [(z: [Int], positions: [SIMD3<Float>])] = []
        var next = 0
        for _ in 0..<count {
            var z: [Int] = []
            var positions: [SIMD3<Float>] = []
            var x = 0.0, y = 0.0, zc = 0.0, rowDepth = 0.0, layerHeight = 0.0
            while z.count < clusterAtoms {
                let row = rows[next % rows.count]
                next += 1
                var lo = Vec3(repeating: .infinity)
                var hi = Vec3(repeating: -.infinity)
                for p in row.positions {
                    lo = pointwiseMin(lo, Vec3(p))
                    hi = pointwiseMax(hi, Vec3(p))
                }
                let size = hi - lo
                if x > 0 && x + size.x > 24 {
                    x = 0
                    y += rowDepth + 2.5
                    rowDepth = 0
                }
                if y > 0 && y + size.y > 24 {
                    y = 0
                    zc += layerHeight + 2.5
                    layerHeight = 0
                }
                for (a, p) in row.positions.enumerated() where z.count < clusterAtoms {
                    z.append(row.z[a])
                    let q = Vec3(p) - lo + Vec3(x, y, zc)
                    positions.append(SIMD3(Float(q.x), Float(q.y), Float(q.z)))
                }
                x += size.x + 2.5
                rowDepth = max(rowDepth, size.y)
                layerHeight = max(layerHeight, size.z)
            }
            out.append((z, positions))
        }
        return out
    }

    /// Milliseconds per `perceive` call, after 200 warm-up calls.
    static func times(_ inputs: [(z: [Int], positions: [SIMD3<Float>])]) -> [Double] {
        for input in inputs.prefix(200) { _ = BondPerception.perceive(atomicNumbers: input.z, positions: input.positions) }
        let clock = ContinuousClock()
        return inputs.map { input in
            let elapsed = clock.measure { _ = BondPerception.perceive(atomicNumbers: input.z, positions: input.positions) }
            return Double(elapsed.components.attoseconds) / 1e15 + Double(elapsed.components.seconds) * 1e3
        }
    }

    /// run.mts `quantiles`: the sample at floor(q · n) of the sorted times.
    static func quantile(_ samples: [Double], _ q: Double) -> Double {
        let sorted = samples.sorted()
        return sorted[min(sorted.count - 1, Int(q * Double(sorted.count)))]
    }
}

/// run.mts's shuffled grid insertion: an LCG seeded per row.
func shuffledOrder(count: Int, row: Int) -> [Int] {
    var order = Array(0..<count)
    var seed = UInt32(truncatingIfNeeded: UInt64(row + 1) &* 2_654_435_761)
    for k in stride(from: count - 1, to: 0, by: -1) {
        seed = seed &* 1_103_515_245 &+ 12_345
        order.swapAt(k, Int(seed % UInt32(k + 1)))
    }
    return order
}

/// FNV-1a 32 of run.mts's "i-j-kind,…" line key.
func lineKeyHash(_ p: PerceivedBonds) -> UInt32 {
    var hash: UInt32 = 0x811C_9DC5
    let key = p.bonds.map { "\($0.i)-\($0.j)-\($0.kind.rawValue)" }.joined(separator: ",")
    for byte in key.utf8 { hash = (hash ^ UInt32(byte)) &* 0x0100_0193 }
    return hash
}
