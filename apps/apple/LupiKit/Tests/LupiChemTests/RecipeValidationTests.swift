import Foundation
import Testing
@testable import LupiChem

/// The full run: every colabfit/OMol25_neutral_validation row from the cache
/// of tools/omol25-bonds/fetch-rows.mts, when `LUPI_OMOL25_ROWS` names its
/// directory (and, optionally, `LUPI_OMOL25_ROW_KEYS` the line keys from
/// `export-validation-sample.mts --row-keys`). Release builds hold the timing
/// to the target; see the LupiKit README.
enum FullRun {
    static var rowsDirectory: URL? {
        ProcessInfo.processInfo.environment["LUPI_OMOL25_ROWS"].map { URL(fileURLWithPath: $0) }
    }

    static var rowKeys: URL? {
        ProcessInfo.processInfo.environment["LUPI_OMOL25_ROW_KEYS"].map { URL(fileURLWithPath: $0) }
    }

    struct Page: Decodable { var rows: [Row] }

    struct Row: Decodable {
        var row: Int
        var formula: String
        var z: [Int]
        var pos: [Double]
        var truncated: Bool
    }

    static func rows() throws -> [Row] {
        let directory = try #require(rowsDirectory)
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasPrefix("rows-") && $0.hasSuffix(".json") }
            .sorted()
        var rows: [Row] = []
        for file in files {
            rows += try JSONDecoder().decode(Page.self, from: Data(contentsOf: directory.appendingPathComponent(file))).rows
        }
        return rows
    }
}

#if DEBUG
private let isRelease = false
#else
private let isRelease = true
#endif

@Suite("lupi-bonds.molecular.v1 against validation-v1.json")
struct RecipeValidationTests {
    func sample() throws -> ValidationSample {
        try Fixtures.decode(ValidationSample.self, "bonds/validation-sample.json")
    }

    @Test func theFileIsTheMolecularRecipesPassingRun() throws {
        let v = try sample().validation
        #expect(v.recipe == BondRecipe.molecular.rawValue)
        #expect(v.pass)
        #expect(v.tolerance == BondConstants.defaultTolerance)
        #expect(v.rows == 27_697)
        #expect(v.hard.multiBondH == 0 && v.hard.overValent == 0 && v.hard.covalentIonSticks == 0 && v.hard.deterministic)
    }

    @Test("the port's parameters are the ones validated")
    func parametersAreTheValidatedOnes() throws {
        let p = try sample().validation.parameters
        let v1 = MolecularRecipeParams.v1
        #expect(p.contactMargin == v1.contactMargin)
        #expect(p.hapticRatio == v1.hapticRatio)
        #expect(p.metalMetalSlack == v1.metalMetalSlack)
        #expect(p.metalHydrideSlack == v1.metalHydrideSlack)
        #expect(p.oxygenCap == v1.oxygenCap)
        #expect(p.ionCapDelta == v1.ionCapDelta)
        #expect(abs(p.maxIonContactA - BondRadii.maxIonContact) < 1e-12)
        func bySymbol<T>(_ table: [Int: T]) -> [String: T] {
            Dictionary(uniqueKeysWithValues: table.map { (ChemicalElement.forAtomicNumber($0.key).symbol, $0.value) })
        }
        #expect(bySymbol(BondRadii.highSpin) == p.highSpinRadii)
        #expect(bySymbol(BondRadii.ion) == p.ionRadii.values)
        #expect(bySymbol(BondRadii.donor) == p.donorRadii.values)
        #expect(bySymbol(ValenceCaps.ionCoordinationCaps) == p.ionCoordinationCaps)
    }

    @Test("Swift reproduces the TypeScript output on every sampled row")
    func reproducesTheTypeScript() throws {
        let rows = try sample().rows
        #expect(rows.count >= 60)
        for row in rows {
            let p = BondPerception.perceive(atomicNumbers: row.atomicNumbers, positions: row.floatPositions)
            let label = "row \(row.row) (\(row.why.joined(separator: ", ")))"
            #expect(p.bonds.flatMap { [$0.i, $0.j] } == row.run.pairs, "\(label): pairs")
            #expect(p.bonds.map(\.kind.rawValue) == row.run.kinds, "\(label): kinds")
            #expect(p.bonds.map(\.distance) == row.run.distances.map(Float.init), "\(label): distances")
            #expect(p.counts == row.run.counts, "\(label): counts")
            let evidence = try #require(row.run.evidence)
            #expect(p.evidence?.flatMap { [$0.i, $0.j] } == evidence.pairs, "\(label): removed pairs")
            #expect(p.evidence?.map(\.reason.rawValue) == evidence.reasons, "\(label): removal reasons")
        }
    }

    @Test("the hard targets hold on the sample: no multi-bonded H, nothing over the caps, no ion sticks, deterministic")
    func hardTargetsOnTheSample() throws {
        let rows = try sample().rows
        var tally = ValidationTally()
        for row in rows {
            let positions = row.floatPositions
            let p = BondPerception.perceive(atomicNumbers: row.atomicNumbers, positions: positions)
            tally.add(row.atomicNumbers, p)
            #expect(BondPerception.perceive(atomicNumbers: row.atomicNumbers, positions: positions) == p, "row \(row.row): rerun")
            let shuffled = BondPerception.perceive(
                atomicNumbers: row.atomicNumbers, positions: positions,
                insertionOrder: shuffledOrder(count: row.atomicNumbers.count, row: row.row)
            )
            #expect(shuffled == p, "row \(row.row): shuffled grid")
        }
        #expect(tally.multiBondHRows == 0)
        #expect(tally.overValentRows == 0, "\(tally.overValentByElement)")
        #expect(tally.covalentIonSticks == 0)
        // The sample exercises what the targets guard: ions with contacts, and every removal reason the run saw.
        #expect(tally.reported.ions >= 20 && tally.reported.kinds["ionicContact", default: 0] > 0)
        let v = try sample().validation
        #expect(Set(tally.reported.removedByReason.keys) == Set(v.reported.removedByReason.keys))
    }

    @Test("the hand-check rows are drawn exactly as validation-v1.json lists them")
    func handCheckRows() throws {
        let s = try sample()
        #expect(s.validation.handCheck.count == 7)
        for (key, expected) in s.validation.handCheck {
            let row = try #require(s.rows.first { String($0.row) == key }, "row \(key) is in the sample")
            let p = BondPerception.perceive(atomicNumbers: row.atomicNumbers, positions: row.floatPositions)
            #expect(row.formula == expected.formula && row.atomicNumbers.count == expected.atoms, "row \(key)")
            #expect(p.counts == expected.counts, "row \(key): counts")
            #expect(HandCheckLines.ionContacts(row.atomicNumbers, p) == expected.ionContacts, "row \(key): ionic contacts")
            #expect(HandCheckLines.removed(row.atomicNumbers, p) == expected.removed, "row \(key): removed pairs")
        }
    }

    @Test("p99 of one call on 350-atom clusters (the target is held in release builds)")
    func timingAt350Atoms() throws {
        let s = try sample()
        let rows = s.rows.map { (z: $0.atomicNumbers, positions: $0.floatPositions) }
        let clusters = RecipeTiming.clusters(rows, count: isRelease ? 3000 : 300)
        #expect(clusters.allSatisfy { $0.z.count == RecipeTiming.clusterAtoms })
        let times = RecipeTiming.times(clusters)
        let p50 = RecipeTiming.quantile(times, 0.5)
        let p99 = RecipeTiming.quantile(times, 0.99)
        print("lupi-bonds.molecular.v1 at 350 atoms, \(times.count) clusters: p50 \(p50) ms, p99 \(p99) ms"
              + (isRelease ? "" : " (debug build)"))
        if isRelease {
            #expect(p99 <= s.validation.targets.p99Ms)
        } else {
            #expect(p99 < 50 * s.validation.targets.p99Ms)
        }
    }

    @Test("every neutral-validation row: the hard targets and the reported totals, pair for pair with TypeScript",
          .enabled(if: FullRun.rowsDirectory != nil, "set LUPI_OMOL25_ROWS to the fetch-rows.mts cache"))
    func everyRow() throws {
        let s = try sample()
        let rows = try FullRun.rows()
        #expect(rows.count == s.validation.rows)
        var keys: [Int: (count: Int, hash: UInt32)] = [:]
        if let file = FullRun.rowKeys {
            for line in try String(contentsOf: file, encoding: .utf8).split(separator: "\n") {
                let fields = line.split(separator: "\t")
                keys[Int(fields[0])!] = (Int(fields[1])!, UInt32(fields[2], radix: 16)!)
            }
            #expect(keys.count == rows.count)
        }
        var tally = ValidationTally()
        var nondeterministic: [Int] = []
        var mismatched: [Int] = []
        var inputs: [(z: [Int], positions: [SIMD3<Float>])] = []
        for row in rows {
            if row.truncated {
                tally.reported.truncatedRows += 1
                continue
            }
            let positions = stride(from: 0, to: row.pos.count, by: 3).map {
                SIMD3(Float(row.pos[$0]), Float(row.pos[$0 + 1]), Float(row.pos[$0 + 2]))
            }
            inputs.append((row.z, positions))
            let p = BondPerception.perceive(atomicNumbers: row.z, positions: positions)
            tally.add(row.z, p)
            let again = BondPerception.perceive(atomicNumbers: row.z, positions: positions)
            let shuffled = BondPerception.perceive(
                atomicNumbers: row.z, positions: positions, insertionOrder: shuffledOrder(count: row.z.count, row: row.row)
            )
            if again != p || shuffled != p { nondeterministic.append(row.row) }
            if let key = keys[row.row], key.count != p.count || key.hash != lineKeyHash(p) { mismatched.append(row.row) }
            if let expected = s.validation.handCheck[String(row.row)] {
                #expect(p.counts == expected.counts, "hand-check row \(row.row)")
            }
        }
        #expect(tally.multiBondHRows == s.validation.hard.multiBondH)
        #expect(tally.overValentRows == s.validation.hard.overValent, "\(tally.overValentByElement)")
        #expect(tally.covalentIonSticks == s.validation.hard.covalentIonSticks)
        #expect(nondeterministic.isEmpty, "\(nondeterministic.prefix(20))")
        #expect(mismatched.isEmpty, "rows whose lines differ from TypeScript: \(mismatched.prefix(20))")
        #expect(tally.reported == s.validation.reported)

        let clusters = RecipeTiming.clusters(inputs, count: isRelease ? 3000 : 300)
        let times = RecipeTiming.times(clusters)
        let p99 = RecipeTiming.quantile(times, 0.99)
        print("full run: \(tally.rows) rows, kinds \(tally.reported.kinds), removed \(tally.reported.removedByReason); "
              + "350-atom p50 \(RecipeTiming.quantile(times, 0.5)) ms, p99 \(p99) ms over \(times.count) clusters"
              + (isRelease ? "" : " (debug build)"))
        if isRelease { #expect(p99 <= s.validation.targets.p99Ms) }
    }
}
