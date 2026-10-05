import Foundation
import Testing
@testable import LupiChem

// xyz-write.json: the reference writer's text for each case and the web
// parser's reading of it, written by tools/apple/export-bond-fixtures.mts.

struct WriteFixtureFile: Decodable {
    var schema: String
    var cases: [Case]

    struct Case: Decodable {
        var name: String
        var atomicNumbers: [Int]
        var positions: [Double]
        var comment: Comment
        var decimals: Int?
        var text: String
        var parsed: ParseFixtureFile.Frame
    }

    struct Comment: Decodable {
        var title: String?
        var formula: String?
        var chemistry: FrameChemistry?
        var parent: String?
        var source: String?
        var license: String?
        var coordinates: String?
        var extra: [[String]]

        var xyz: XYZComment {
            XYZComment(
                title: title, formula: formula, chemistry: chemistry, parent: parent, source: source,
                license: license, coordinates: coordinates, extra: extra.map { XYZKey($0[0], $0[1]) }
            )
        }
    }
}

extension ParseFixtureFile.Frame {
    /// The web parser's frame equals this one, coordinate for coordinate.
    func matches(_ frame: XYZFrame) -> Bool {
        frame.atomicNumbers == atomicNumbers
            && frame.positions.flatMap { [Double($0.x), Double($0.y), Double($0.z)] } == positions
            && frame.periodic == periodic && frame.timestep == timestep && frame.chemistry == chemistry
            && frame.sourceRecord == sourceRecord
    }
}

private func floats(_ flat: [Double]) -> [SIMD3<Float>] {
    stride(from: 0, to: flat.count, by: 3).map { SIMD3(Float(flat[$0]), Float(flat[$0 + 1]), Float(flat[$0 + 2])) }
}

@Suite("XYZ writer")
struct XYZWriterTests {
    @Test("writes the reference's bytes, and both parsers read them the same")
    func matchesTheReferenceAndTheWebParser() throws {
        let fixture = try Fixtures.decode(WriteFixtureFile.self, "bonds/xyz-write.json")
        #expect(fixture.cases.count >= 9)
        for item in fixture.cases {
            let positions = floats(item.positions)
            let decimals = item.decimals ?? XYZWriter.defaultDecimals
            let text = XYZWriter.text(
                atomicNumbers: item.atomicNumbers, positions: positions, comment: item.comment.xyz, decimals: decimals
            )
            #expect(text == item.text, "\(item.name)")
            let frame = try XYZParser.parse(text).first
            #expect(item.parsed.matches(frame), "\(item.name): parse")
            // Written again from what was read, the text is the same (|x| < 128 Å at five decimals).
            let again = XYZWriter.text(
                atomicNumbers: frame.atomicNumbers, positions: frame.positions, comment: item.comment.xyz, decimals: decimals
            )
            #expect(again == text, "\(item.name): idempotent")
            // The formula is the atoms', never a label.
            if let formula = item.comment.formula, item.name.hasPrefix("fragment") || item.name.hasPrefix("built") {
                #expect(Molecule(atomicNumbers: item.atomicNumbers, positions: positions).hillFormula == formula, "\(item.name)")
            }
        }
    }

    @Test func fixedRoundsTheExactValueHalfAwayFromZero() {
        #expect(XYZWriter.fixed(1.0 / 64, decimals: 5) == "0.01563")
        #expect(XYZWriter.fixed(-1.0 / 64, decimals: 5) == "-0.01563")
        #expect(XYZWriter.fixed(0.5, decimals: 0) == "1")
        #expect(XYZWriter.fixed(-2.5, decimals: 0) == "-3")
        #expect(XYZWriter.fixed(0, decimals: 5) == "0.00000")
        #expect(XYZWriter.fixed(-0.0, decimals: 5) == "0.00000")
        #expect(XYZWriter.fixed(-0.000001, decimals: 5) == "0.00000")
        #expect(XYZWriter.fixed(.leastNonzeroMagnitude, decimals: 9) == "0.000000000")
        #expect(XYZWriter.fixed(123.456789, decimals: 5) == "123.45679")
        #expect(XYZWriter.fixed(1e9, decimals: 2) == "1000000000.00")
        // Float32(0.1) is 0.100000001490116…, so its 9th decimal rounds up.
        #expect(XYZWriter.fixed(0.1, decimals: 9) == "0.100000001")
        #expect(XYZWriter.fixed(-7.25, decimals: 1) == "-7.3")
    }

    @Test func commentKeysAndQuoting() {
        let comment = XYZComment(
            title: "Lupi = built\n", formula: "H2O", chemistry: XYZComment.unknownCharge, coordinates: "lupi-play",
            extra: [XYZKey("9lives", "no"), XYZKey("ok-key_2", "a b")]
        )
        #expect(comment.line == "Lupi - built | formula=H2O | charge_source=unavailable | coordinates=lupi-play | ok-key_2=\"a b\"")
        #expect(XYZComment(title: "7").line == "#7")
        #expect(XYZComment().line == "")
    }

    /// Fragments and built molecules reload with the bonds they had (contracts.md §1.4).
    @Test(arguments: ["caffeine", "tryptophan", "atp", "omol25_nv_23477", "cisplatin", "ferrocene"])
    func piecesReloadWithTheirBonds(name: String) throws {
        let molecule = try FixtureMolecules.named(name)
        let graph = BondGraph.forPlay(molecule)
        // Break every non-ring bond between heavy atoms, one at a time, and keep each piece.
        let ring = graph.ringBondMask(kinds: BondGraph.allKinds)
        var checked = 0
        for k in graph.bonds.indices where !ring[k] && checked < 6 {
            let bond = graph.bonds[k]
            guard molecule.atomicNumbers[bond.i] != 1, molecule.atomicNumbers[bond.j] != 1 else { continue }
            let pieces = graph.split(molecule, cutting: [k])
            guard pieces.count == 2 else { continue }
            checked += 1
            for piece in pieces {
                let text = XYZWriter.embedded(piece.molecule, title: "Lupi fragment", parent: molecule.hillFormula)
                let frame = try XYZParser.parse(text).first
                #expect(frame.atomicNumbers == piece.molecule.atomicNumbers)
                #expect(frame.chemistry == XYZComment.unknownCharge)
                #expect(frame.comment.contains("formula=\(piece.molecule.hillFormula)"))
                let reloaded = Molecule(frame: frame)
                let centred = XYZWriter.centredOnCentreOfMass(piece.molecule)
                for (a, b) in zip(reloaded.positions, centred.positions) {
                    #expect(Vec3(a - b).length < 1e-5)
                }
                #expect(reloaded.inertia.centerOfMass.length < 1e-4)
                let again = BondGraph.forPlay(reloaded)
                #expect(again.bonds.map { [$0.i, $0.j, Int($0.kind.rawValue)] } == piece.graph.bonds.map { [$0.i, $0.j, Int($0.kind.rawValue)] }
                            .sorted { ($0[0], $0[1]) < ($1[0], $1[1]) }, "\(name) piece \(piece.molecule.hillFormula)")
            }
        }
        #expect(checked > 0 || name == "cisplatin" || name == "ferrocene")
    }

    @Test("a fragment cut in Swift is the reference's fragment, byte for byte")
    func swiftCutMatchesTheReference() throws {
        let fixture = try Fixtures.decode(WriteFixtureFile.self, "bonds/xyz-write.json")
        let caffeine = try FixtureMolecules.named("caffeine")
        let graph = BondGraph.forPlay(caffeine)
        for name in ["fragment-caffeine-methyl", "fragment-caffeine-demethyl"] {
            let expected = try #require(fixture.cases.first { $0.name == name })
            let methylCarbon = caffeine.atomicNumbers.indices.first { a in
                caffeine.atomicNumbers[a] == 6
                    && graph.neighbors(of: a).filter { caffeine.atomicNumbers[$0] == 1 }.count == 3
                    && graph.neighbors(of: a).contains { caffeine.atomicNumbers[$0] == 7 }
            }
            let carbon = try #require(methylCarbon)
            let nitrogen = try #require(graph.neighbors(of: carbon).first { caffeine.atomicNumbers[$0] == 7 })
            let cut = try #require(graph.bondIndex(carbon, nitrogen))
            let pieces = graph.split(caffeine, cutting: [cut])
            let piece = try #require(pieces.first { $0.molecule.count == expected.atomicNumbers.count })
            let text = XYZWriter.embedded(piece.molecule, title: "Lupi fragment", parent: caffeine.hillFormula)
            #expect(text == expected.text, "\(name)")
        }
    }

    @Test func builtMoleculesReloadToo() throws {
        // Ethanol as the snap rule would build it, written and read back.
        let ethanol = try FixtureMolecules.named("ethanol")
        let text = XYZWriter.embedded(ethanol, title: "Lupi built")
        let reloaded = try Molecule(xyz: text)
        #expect(reloaded.chemistry?.source == .unavailable)
        #expect(BondGraph.forPlay(reloaded).bonds.count == BondGraph.forPlay(ethanol).bonds.count)
        #expect(text.hasPrefix("9\nLupi built | formula=C2H6O | charge_source=unavailable | coordinates=lupi-play\n"))
        // Molecule.xyzText keeps its six decimals.
        #expect(Molecule(atomicNumbers: [1], positions: [SIMD3<Float>(0.5, -0.25, 0)]).xyzText() == "1\nH\nH 0.500000 -0.250000 0.000000\n")
    }
}
