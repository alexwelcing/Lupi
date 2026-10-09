import Foundation
import Testing
@testable import LupiChem

/// Building from atoms (plan §4.5): geometry, snapping, the re-perception check,
/// hydrogen fill, the "Built it" cues and naming by graph.
@Suite struct BuildTests {
    static func atom(_ z: Int, at p: Vec3 = .zero) -> BuildPiece {
        BuildPiece(molecule: Molecule(atomicNumbers: [z], positions: [p]))
    }

    /// Snaps `guest` onto `host` with the guest sitting `offset` away, unturned.
    static func snap(_ host: BuildPiece, _ a: Int, _ guest: BuildPiece, _ b: Int, offset: Vec3 = Vec3(2, 0, 0)) throws -> SnapResult {
        let placement = RigidPlacement(translation: host.molecule.position(a) + offset - guest.molecule.position(b))
        return try Snapper.snap(host: host, hostAtom: a, guest: guest, guestAtom: b, guestToHost: placement).get()
    }

    static func angleDegrees(_ m: Molecule, _ a: Int, _ centre: Int, _ b: Int) -> Double {
        let u = (m.position(a) - m.position(centre)).normalized
        let v = (m.position(b) - m.position(centre)).normalized
        return BondGeometry.angle(u, v) * 180 / .pi
    }

    // MARK: Geometry

    @Test func domainsFollowLonePairs() {
        #expect(BondGeometry.domains(.loose(8)) == 4)   // water's oxygen: bent, tetrahedral domains
        #expect(BondGeometry.domains(.loose(7)) == 4)
        #expect(BondGeometry.domains(.loose(6)) == 4)
        #expect(BondGeometry.domains(.loose(5)) == 3)   // BH3 is planar
        // A vinyl radical's carbon (C=C and C–H) has one single bond left: trigonal.
        #expect(BondGeometry.domains(AtomBondState(z: 6, covalentPartners: [6, 1], covalentOrderSum: 3)) == 3)
        // An sp carbon (C≡C) with one bond left: linear.
        #expect(BondGeometry.domains(AtomBondState(z: 6, covalentPartners: [6], covalentOrderSum: 3)) == 2)
        // An imine nitrogen (C=N) keeps a lone pair: trigonal.
        #expect(BondGeometry.domains(AtomBondState(z: 7, covalentPartners: [6], covalentOrderSum: 2)) == 3)
        // Water's oxygen donating a lone pair to a metal stays tetrahedral.
        let water = AtomBondState(z: 8, covalentPartners: [1, 1], covalentOrderSum: 2)
        #expect(BondGeometry.domains(water, adding: .coordination) == 4)
        #expect(BondGeometry.domains(.loose(26)) == 6)
        #expect(BondGeometry.domains(.loose(10)) == 0)
    }

    @Test func slotsKeepIdealAngles() {
        let x = Vec3(1, 0, 0)
        let cone = BondGeometry.slots(existing: [x], domains: 4, toward: Vec3(0, 1, 0))
        #expect(abs(BondGeometry.angle(cone[0], x) * 180 / .pi - 109.4712) < 1e-3)
        // The nearest direction of the cone comes first.
        #expect(cone[0].y > 0.9)
        let second = cone[0]
        let pair = BondGeometry.slots(existing: [x, second], domains: 4, toward: Vec3(0, 0, 1))
        #expect(pair.count == 2)
        for d in pair {
            #expect(abs(BondGeometry.angle(d, x) * 180 / .pi - 109.4712) < 1e-3)
            #expect(abs(BondGeometry.angle(d, second) * 180 / .pi - 109.4712) < 1e-3)
        }
        #expect(pair[0].z > 0)
        let last = BondGeometry.slots(existing: [x, second, pair[0]], domains: 4, toward: .zero)
        #expect(last.count == 1)
        #expect(abs(BondGeometry.angle(last[0], pair[1])) < 1e-9)
        #expect(BondGeometry.slots(existing: [x], domains: 2, toward: x) == [Vec3(-1, 0, 0)])
        let trigonal = BondGeometry.slots(existing: [x], domains: 3, toward: Vec3(0, 1, 0))
        #expect(abs(BondGeometry.angle(trigonal[0], x) * 180 / .pi - 120) < 1e-6)
        // Nothing is ever offered within 45° of a bond.
        for d in BondGeometry.slots(existing: [x, Vec3(0, 1, 0)], domains: 0, toward: Vec3(1, 1, 0)) {
            #expect(BondGeometry.angle(d, x) >= BondGeometry.fallbackClearance - 1e-9)
        }
    }

    @Test func snapCutoffsAreTheRecipes() {
        let rc = BondRadii.covalent
        #expect(Valence.snapCutoff(6, 1, kind: .covalent) == rc(6) + rc(1) + 0.45)
        #expect(Valence.snapCutoff(11, 17, kind: .ionicContact) == 1.02 + 1.81 + 0.35)
        #expect(Valence.snapCutoff(26, 8, kind: .coordination) == 1.52 + rc(8) + 0.45)
        #expect(Valence.snapCutoff(26, 1, kind: .coordination) == 1.52 + rc(1) + 0.30)
        #expect(Valence.snapCutoff(26, 29, kind: .coordination) == 1.52 + rc(29) + 0.25)
        // A snap always lands inside the cutoff, so the recipe sees the bond it made.
        for (a, b, kind) in [(6, 1, BondKind.covalent), (11, 17, .ionicContact), (26, 8, .coordination), (8, 8, .covalent)] {
            #expect(Valence.restLength(a, b, kind: kind) < Valence.snapCutoff(a, b, kind: kind))
        }
    }

    // MARK: Snapping

    @Test func waterFromAtoms() throws {
        let hydroxyl = try Self.snap(Self.atom(8), 0, Self.atom(1), 0)
        #expect(hydroxyl.molecule.hillFormula == "HO")
        #expect(hydroxyl.molecule.atomicNumbers == [8, 1])
        #expect(abs(hydroxyl.molecule.position(1).x - Valence.restLength(8, 1, kind: .covalent)) < 1e-6)
        let water = try Self.snap(hydroxyl.piece, 0, Self.atom(1), 0, offset: Vec3(0, 2, 0))
        #expect(water.molecule.hillFormula == "H2O")
        #expect(water.graph.bonds.count == 2)
        #expect(water.bond.i == 0 && water.bond.j == 2)
        #expect(abs(Self.angleDegrees(water.molecule, 1, 0, 2) - 109.4712) < 1e-3)
        #expect(BuildCues.isComplete(water.piece))
        // The finished water takes nothing more.
        #expect(Snapper.rule(water.piece, 0, Self.atom(1), 0) == nil)
        #expect(Snapper.rule(water.piece, 1, Self.atom(1), 0) == nil)
    }

    @Test func theGuestTurnsToMeetTheHost() throws {
        // Two hydroxyls, the guest's O–H pointing at the host: the guest turns so its free
        // direction faces the host, and the snap is hydrogen peroxide's O–O.
        let hydroxyl = try Self.snap(Self.atom(8), 0, Self.atom(1), 0)
        let guest = hydroxyl.piece
        let placement = RigidPlacement(rotation: Mat3.rotation(axis: Vec3(0, 0, 1), angle: .pi), translation: Vec3(3, 0, 0))
        let peroxide = try Snapper.snap(host: hydroxyl.piece, hostAtom: 0, guest: guest, guestAtom: 0, guestToHost: placement).get()
        #expect(peroxide.molecule.hillFormula == "H2O2")
        #expect(peroxide.molecule.atomicNumbers == [8, 1, 8, 1])
        #expect(peroxide.graph.bondIndex(0, 2) != nil)
        #expect(abs(Self.angleDegrees(peroxide.molecule, 1, 0, 2) - 109.4712) < 1e-3)
        #expect(abs(Self.angleDegrees(peroxide.molecule, 0, 2, 3) - 109.4712) < 1e-3)
        let known = BuildPiece(molecule: try FixtureMolecules.named("water"))
        #expect(!MolecularGraph(peroxide.piece).isIsomorphic(to: MolecularGraph(known)))
    }

    @Test func refusals() throws {
        let methane = try #require(HydrogenFill.fill(Self.atom(6))).piece
        #expect(methane.molecule.hillFormula == "CH4")
        let h = Self.atom(1)
        #expect(throws: SnapRefusal.notAllowed) {
            try Snapper.snap(host: methane, hostAtom: 0, guest: h, guestAtom: 0, guestToHost: RigidPlacement(translation: Vec3(3, 0, 0))).get()
        }
        // A methyl radical whose only free direction is filled by a water in the same body:
        // the new hydrogen would sit on the water's oxygen, the recipe sees another graph, and
        // the snap is refused rather than made wrong.
        var methyl = methane.molecule.subset([0, 1, 2, 3])
        let free = -1 * (methyl.position(1) + methyl.position(2) + methyl.position(3) - 3 * methyl.position(0)).normalized
        let o = methyl.position(0) + free * 2.0
        methyl = methyl.appending(Molecule(
            atomicNumbers: [8, 1, 1], positions: [o, o + Vec3(0.0, 0.76, 0.59), o + Vec3(0.0, -0.76, 0.59)]
        ))
        let crowded = BuildPiece(molecule: methyl)
        #expect(crowded.graph.bonds.count == 5)
        #expect(throws: SnapRefusal.perception) {
            try Snapper.snap(host: crowded, hostAtom: 0, guest: h, guestAtom: 0, guestToHost: RigidPlacement(translation: o)).get()
        }
        // Past the recipe's 2,000 atoms nothing snaps.
        let big = BuildPiece(molecule: Molecule(
            atomicNumbers: [Int](repeating: 6, count: 2000), positions: (0..<2000).map { Vec3(Double($0) * 5, 0, 0) }
        ), graph: BondGraph(atomCount: 2000, bonds: []))
        #expect(throws: SnapRefusal.tooBig) {
            try Snapper.snap(host: big, hostAtom: 0, guest: h, guestAtom: 0, guestToHost: .identity).get()
        }
    }

    @Test func saltFromIons() throws {
        let salt = try Self.snap(Self.atom(17), 0, Self.atom(11), 0, offset: Vec3(0, 0, 3))
        #expect(salt.bond.kind == .ionicContact)
        #expect(salt.molecule.atomicNumbers == [17, 11])
        #expect(abs((salt.molecule.position(1) - salt.molecule.position(0)).length - (1.02 + 1.81)) < 1e-5)
        #expect(BuildCues.isComplete(salt.piece))
        let second = try Self.snap(salt.piece, 0, Self.atom(11), 0, offset: Vec3(3, 0, 0))
        #expect(second.molecule.hillFormula == "ClNa2")
        #expect(second.graph.bonds.allSatisfy { $0.kind == .ionicContact })
    }

    @Test func aMetalTakesWaterOnALonePair() throws {
        let water = BuildPiece(molecule: try FixtureMolecules.named("water"))
        let o = try #require(water.molecule.atomicNumbers.firstIndex(of: 8))
        let aqua = try Self.snap(water, o, Self.atom(26), 0, offset: Vec3(0, 0, 3))
        #expect(aqua.bond.kind == .coordination)
        let h = water.molecule.atomicNumbers.firstIndex(of: 1)!
        let fe = water.count
        // Off both O–H bonds by the tetrahedral angle, give or take water's own bend.
        #expect(abs(Self.angleDegrees(aqua.molecule, h, o, fe) - 109.5) < 8)
        #expect(BuildCues.isComplete(aqua.piece))
    }

    // MARK: Fill

    @Test func fillingSimpleCentres() throws {
        let water = try #require(HydrogenFill.fill(Self.atom(8)))
        #expect(water.added == 2)
        #expect(water.piece.molecule.hillFormula == "H2O")
        #expect(abs(Self.angleDegrees(water.piece.molecule, 1, 0, 2) - 109.4712) < 1e-3)
        #expect(BuildCues.isComplete(water.piece))
        let ammonia = try #require(HydrogenFill.fill(Self.atom(7)))
        #expect(ammonia.piece.molecule.hillFormula == "H3N")
        let methane = try #require(HydrogenFill.fill(Self.atom(6)))
        for (a, b) in [(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)] {
            #expect(abs(Self.angleDegrees(methane.piece.molecule, a, 0, b) - 109.4712) < 1e-3)
        }
        #expect(HydrogenFill.fill(methane.piece) == nil)
        #expect(HydrogenFill.fill(Self.atom(10)) == nil)
        // Ions and metals take no hydrogens from Fill.
        #expect(HydrogenFill.fill(Self.atom(11)) == nil)
        let sulfide = try #require(HydrogenFill.fill(Self.atom(16)))
        #expect(sulfide.piece.molecule.hillFormula == "H2S")
        let phosphine = try #require(HydrogenFill.fill(Self.atom(15)))
        #expect(phosphine.piece.molecule.hillFormula == "H3P")
        let chloride = try #require(HydrogenFill.fill(Self.atom(17)))
        #expect(chloride.piece.molecule.hillFormula == "ClH")
    }

    @Test func ethanolFromAtomsIsEthanol() throws {
        let cc = try Self.snap(Self.atom(6), 0, Self.atom(6), 0)
        #expect(cc.molecule.atomicNumbers == [6, 6])
        let cco = try Self.snap(cc.piece, 1, Self.atom(8), 0, offset: Vec3(1, 1.5, 0))
        #expect(abs(Self.angleDegrees(cco.molecule, 0, 1, 2) - 109.4712) < 1e-3)
        #expect(!BuildCues.isComplete(cco.piece))
        #expect(BuildCues.fillable(cco.piece) == [0, 1, 2])
        let filled = try #require(HydrogenFill.fill(cco.piece))
        #expect(filled.added == 6)
        #expect(filled.piece.molecule.hillFormula == "C2H6O")
        #expect(filled.partners == [0, 0, 0, 1, 1, 2])
        #expect(BuildCues.isComplete(filled.piece))
        #expect(BuildCues.fillable(filled.piece).isEmpty)
        let ethanol = BuildPiece(molecule: try FixtureMolecules.named("ethanol"))
        #expect(MolecularGraph(filled.piece).isIsomorphic(to: MolecularGraph(ethanol)))
        #expect(MolecularGraph(filled.piece).signature == MolecularGraph(ethanol).signature)

        // Dimethyl ether has ethanol's formula and another graph.
        let co = try Self.snap(Self.atom(6), 0, Self.atom(8), 0)
        let coc = try Self.snap(co.piece, 1, Self.atom(6), 0, offset: Vec3(2, 2, 0))
        let ether = try #require(HydrogenFill.fill(coc.piece)).piece
        #expect(ether.molecule.hillFormula == "C2H6O")
        #expect(!MolecularGraph(ether).isIsomorphic(to: MolecularGraph(ethanol)))
        #expect(MolecularGraph(ether).signature != MolecularGraph(ethanol).signature)
    }

    @Test func aPhenylRadicalFillsBackToBenzene() throws {
        let benzene = BuildPiece(molecule: try FixtureMolecules.named("benzene"))
        let h = try #require(benzene.molecule.atomicNumbers.firstIndex(of: 1))
        let phenyl = BuildPiece(molecule: benzene.molecule.subset((0..<benzene.count).filter { $0 != h }))
        #expect(BuildCues.fillable(phenyl).count == 1)
        let refilled = try #require(HydrogenFill.fill(phenyl))
        #expect(refilled.added == 1)
        #expect(MolecularGraph(refilled.piece).isIsomorphic(to: MolecularGraph(benzene)))
        // The new hydrogen sits in the ring's plane, opposite the ring.
        let c = refilled.partners[0]
        let ring = phenyl.molecule.atomicNumbers.indices.filter { phenyl.molecule.atomicNumbers[$0] == 6 && $0 != c }
        let centre = ring.reduce(Vec3.zero) { $0 + phenyl.molecule.position($1) } / Double(ring.count)
        let outward = (refilled.piece.molecule.position(c) - centre).normalized
        let ch = (refilled.piece.molecule.position(phenyl.count) - refilled.piece.molecule.position(c)).normalized
        #expect(ch.dot(outward) > 0.99)
    }

    @Test func peroxideBrokenAndRebuilt() throws {
        let peroxide = BuildPiece(molecule: try Molecule(xyz: """
            4
            hydrogen peroxide
            O 0.7247 0 0
            O -0.7247 0 0
            H 0.8233 -0.7 -0.6676
            H -0.8233 -0.6175 0.7446
            """))
        let oo = try #require(peroxide.graph.bondIndex(0, 1))
        let halves = peroxide.graph.split(peroxide.molecule, cutting: [oo])
        #expect(halves.count == 2)
        let a = BuildPiece(molecule: halves[0].molecule, graph: halves[0].graph)
        let b = BuildPiece(molecule: halves[1].molecule, graph: halves[1].graph)
        let rejoined = try Snapper.snap(host: a, hostAtom: 0, guest: b, guestAtom: 0, guestToHost: .identity).get()
        #expect(MolecularGraph(rejoined.piece).isIsomorphic(to: MolecularGraph(peroxide)))
        #expect(BuildCues.isComplete(rejoined.piece))
    }

    /// A snap re-perceives the merged atoms once (more only when it is refused): what it costs on
    /// a 512-atom diamond, printed for the record (the app snaps on the main actor).
    @Test func snappingOntoABigBodyCostsOnePerception() throws {
        let diamond = BuildPiece(molecule: try FixtureMolecules.named("diamond_crystal"))
        let open = try #require(diamond.openAtoms.first)
        let outward = (diamond.molecule.position(open) - diamond.molecule.centroid).normalized
        let clock = ContinuousClock()
        let start = clock.now
        let result = try Snapper.snap(
            host: diamond, hostAtom: open, guest: Self.atom(1), guestAtom: 0,
            guestToHost: RigidPlacement(translation: diamond.molecule.position(open) + outward * 1.5)
        ).get()
        let elapsed = clock.now - start
        #expect(result.molecule.count == diamond.count + 1)
        let ms = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
        print("snap onto \(diamond.count) atoms: \(String(format: "%.2f", ms)) ms")
    }

    // MARK: Naming graphs

    @Test func graphsMatchUnderAnyNumbering() throws {
        for name in ["caffeine", "c60_buckyball", "glucose", "nicotine"] {
            let m = try FixtureMolecules.named(name)
            let piece = BuildPiece(molecule: m)
            let order = Array((0..<m.count).reversed())
            let shuffled = BuildPiece(molecule: m.subset(order))
            let g = MolecularGraph(piece), s = MolecularGraph(shuffled)
            #expect(g.signature == s.signature, "\(name)")
            #expect(g.isIsomorphic(to: s), "\(name)")
            #expect(g.isConnected)
        }
        let caffeine = MolecularGraph(BuildPiece(molecule: try FixtureMolecules.named("caffeine")))
        let glucose = MolecularGraph(BuildPiece(molecule: try FixtureMolecules.named("glucose")))
        #expect(!caffeine.isIsomorphic(to: glucose))
        let cluster = MolecularGraph(BuildPiece(molecule: try FixtureMolecules.named("water_cluster")))
        #expect(!cluster.isConnected)
    }

    @Test func linkKindsCount() {
        // Same atoms and pairs, one link a contact instead of a bond: not the same molecule.
        let a = MolecularGraph(atomicNumbers: [11, 17], links: [.init(i: 0, j: 1, kind: .ionicContact)])
        let b = MolecularGraph(atomicNumbers: [11, 17], links: [.init(i: 0, j: 1, kind: .covalent)])
        #expect(!a.isIsomorphic(to: b))
        #expect(a.signature != b.signature)
        #expect(a.formula == "ClNa")
    }
}
