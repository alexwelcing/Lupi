import Testing
@testable import LupiChem

@Suite("bond graph")
struct GraphTests {
    func play(_ name: String) throws -> (Molecule, BondGraph) {
        let molecule = try FixtureMolecules.named(name)
        return (molecule, BondGraph.forPlay(molecule))
    }

    @Test func benzeneIsOneAromaticRing() throws {
        let (benzene, graph) = try play("benzene")
        let rings = graph.rings(molecule: benzene)
        #expect(rings.cycleCount == 1)
        #expect(rings.smallestRings?.map(\.size) == [6])
        #expect(rings.systems.count == 1)
        #expect(rings.systems[0].isFused == false)
        #expect(rings.systems[0].isCage == false)
        let carbonCarbon = graph.bonds.filter { benzene.atomicNumbers[$0.i] == 6 && benzene.atomicNumbers[$0.j] == 6 }
        #expect(carbonCarbon.count == 6)
        #expect(carbonCarbon.allSatisfy { $0.order == .delocalized })
        #expect(graph.rotatableBonds(in: benzene).isEmpty)
        for atom in 0..<benzene.count {
            #expect(AtomBondState(atom: atom, graph: graph, molecule: benzene).freeValence == 0)
        }
    }

    @Test func c60IsACageOf12PentagonsAnd20Hexagons() throws {
        let (c60, graph) = try play("c60_buckyball")
        #expect(graph.bonds.count == 90)
        let rings = graph.rings(molecule: c60)
        #expect(rings.cycleCount == 31)
        let sizes = rings.smallestRings?.map(\.size) ?? []
        // The 32 faces are not independent: the smallest set keeps 12 pentagons and 19 of the hexagons.
        #expect(sizes.filter { $0 == 5 }.count == 12)
        #expect(sizes.filter { $0 == 6 }.count == 19)
        #expect(rings.systems.count == 1)
        #expect(rings.systems[0].isCage)
        #expect(graph.weakestSplittingBond(in: c60) == nil)
        #expect(c60.inertia.rotor == .spherical)
    }

    @Test func caffeineIsAFusedPairOfRingsWithNoRotors() throws {
        let (caffeine, graph) = try play("caffeine")
        let rings = graph.rings(molecule: caffeine)
        #expect(rings.cycleCount == 2)
        #expect(rings.smallestRings?.map(\.size).sorted() == [5, 6])
        #expect(rings.systems.count == 1)
        #expect(rings.systems[0].isFused)
        #expect(!rings.systems[0].isCage)
        #expect(graph.rotatableBonds(in: caffeine).isEmpty)
        let doubles = graph.bonds.filter { $0.order == .double }
        // The two carbonyls.
        #expect(doubles.filter { caffeine.atomicNumbers[$0.i] == 8 || caffeine.atomicNumbers[$0.j] == 8 }.count == 2)
    }

    @Test func cholesterolHasFourFusedRingsAndAFloppyTail() throws {
        let (cholesterol, graph) = try play("cholesterol")
        let rings = graph.rings(molecule: cholesterol)
        #expect(rings.cycleCount == 4)
        #expect(rings.systems.count == 1)
        #expect(rings.systems[0].cycleCount == 4)
        #expect(!rings.systems[0].isCage)
        #expect(graph.rotatableBonds(in: cholesterol).count >= 4)
    }

    @Test func glucoseRingAndOneRotor() throws {
        let (glucose, graph) = try play("glucose")
        let rings = graph.rings(molecule: glucose)
        #expect(rings.smallestRings?.map(\.size) == [6])
        // C5–C6 (the CH2OH arm) is the only rotatable bond by the heavy-neighbour rule.
        #expect(graph.rotatableBonds(in: glucose).count == 1)
    }

    @Test func bondOrderEstimates() {
        func order(_ a: Int, _ b: Int, _ d: Double, _ da: Int = 2, _ db: Int = 2) -> BondOrder {
            BondOrderEstimate.order(zi: a, zj: b, length: d, degreeI: da, degreeJ: db)
        }
        #expect(order(6, 6, 1.54) == .single)
        #expect(order(6, 6, 1.39) == .delocalized)
        #expect(order(6, 6, 1.34) == .double)
        #expect(order(6, 6, 1.20) == .triple)
        #expect(order(6, 7, 1.16, 2, 1) == .triple)
        #expect(order(6, 8, 1.21, 3, 1) == .double)
        #expect(order(8, 8, 1.21, 1, 1) == .double)
        #expect(order(6, 8, 1.128, 1, 1) == .triple)
        #expect(order(6, 6, 1.45, 4, 3) == .single)
        #expect(order(6, 1, 0.95, 3, 1) == .single)
    }

    @Test func weakestBondSnapsFirst() throws {
        let (ethanol, graph) = try play("ethanol")
        let weakest = try #require(graph.weakestSplittingBond(in: ethanol))
        #expect(weakest.kJPerMol == 346)
        #expect(ethanol.atomicNumbers[weakest.bond.i] == 6 && ethanol.atomicNumbers[weakest.bond.j] == 6)

        // Hydrogen peroxide: O–O (142) goes before O–H (459).
        let peroxide = Molecule(
            atomicNumbers: [8, 8, 1, 1],
            positions: [Vec3(0, 0.7375, -0.05), Vec3(0, -0.7375, -0.05), Vec3(0.8, 0.9, 0.42), Vec3(-0.8, -0.9, 0.42)]
        )
        let peroxideGraph = BondGraph.forPlay(peroxide)
        #expect(peroxideGraph.bonds.count == 3)
        let first = try #require(peroxideGraph.weakestSplittingBond(in: peroxide))
        #expect(first.kJPerMol == 142)
        #expect(first.bond.i == 0 && first.bond.j == 1)
    }

    @Test func strengthTable() {
        #expect(BondStrength.kJPerMol(6, 6) == 346)
        #expect(BondStrength.kJPerMol(6, 6, order: .double) == 614)
        #expect(BondStrength.kJPerMol(7, 7, order: .triple) == 941)
        #expect(BondStrength.kJPerMol(6, 6, order: .delocalized) == 480)
        #expect(BondStrength.kJPerMol(8, 6) == 358)
        #expect(BondStrength.kJPerMol(11, 17, kind: .ionicContact) == BondStrength.ionicContact)
        // Not in the table: Pauling's rule from S–S, Si–Si and the electronegativities.
        #expect(abs(BondStrength.kJPerMol(14, 16) - ((226.0 * 222.0).squareRoot() + 96.485 * 0.68 * 0.68)) < 1e-9)
        // It reproduces a table value it was not given: C–Si.
        #expect(abs(BondStrength.singleBond(ElementPair(1000, 1001)) - BondStrength.unknownSingle) < 1e-12)
        let carbonSilicon = (346.0 * 222.0).squareRoot() + 96.485 * (2.55 - 1.90) * (2.55 - 1.90)
        #expect(abs(carbonSilicon - 318) < 1)
        #expect(BondStrength.kJPerMol(30, 34) == BondStrength.unknownSingle)
    }

    @Test func splittingEthanolMakesTwoRealFragments() throws {
        let (ethanol, graph) = try play("ethanol")
        let cc = try #require(graph.bonds.firstIndex { ethanol.atomicNumbers[$0.i] == 6 && ethanol.atomicNumbers[$0.j] == 6 })
        let pieces = graph.split(ethanol, cutting: [cc])
        #expect(pieces.count == 2)
        #expect(pieces.map(\.molecule.hillFormula).sorted() == ["CH3", "CH3O"])
        #expect(pieces.reduce(0) { $0 + $1.molecule.count } == ethanol.count)
        for piece in pieces {
            #expect(piece.graph.components().count == 1)
            #expect(piece.openValence.reduce(0, +) == 1)
            // The cut carbon now takes one more partner.
            let carbon = try #require(piece.parentIndices.firstIndex { graph.bonds[cc].touches($0) })
            #expect(AtomBondState(atom: carbon, graph: piece.graph, molecule: piece.molecule).freeValence == 1)
        }
        // A ring bond alone does not split benzene.
        let (benzene, ring) = try play("benzene")
        let ringBond = try #require(ring.bonds.firstIndex { $0.order == .delocalized })
        #expect(ring.split(benzene, cutting: [ringBond]).count == 1)
    }

    @Test func saltClusterHoldsTogetherByContacts() throws {
        let (salt, graph) = try play("salt-cube")
        #expect(graph.bonds.count == 12)
        #expect(graph.bonds.allSatisfy { $0.kind == .ionicContact })
        #expect(graph.components().count == 1)
        #expect(graph.components(kinds: [.covalent, .coordination]).count == 8)
        let weakest = try #require(graph.weakestBonds(in: salt).first)
        #expect(weakest.kJPerMol == BondStrength.ionicContact)
    }

    @Test func componentsAndBridgesOnABigChain() {
        // A 20,000-atom carbon chain: the iterative bridge finder must not overflow the stack.
        let n = 20_000
        let chain = Molecule(atomicNumbers: Array(repeating: 6, count: n), positions: (0..<n).map { Vec3(1.5 * Double($0), 0, 0) })
        let graph = BondGraph(atomCount: n, bonds: (0..<(n - 1)).map { GraphBond(i: $0, j: $0 + 1, length: 1.5) })
        #expect(graph.ringBondMask().allSatisfy { !$0 })
        #expect(graph.components().count == 1)
        #expect(graph.rings(molecule: chain).cycleCount == 0)
    }
}

@Suite("valence and snapping")
struct ValenceTests {
    @Test func defaultValences() {
        #expect(Valence.defaultValence(1) == 1)
        #expect(Valence.defaultValence(6) == 4)
        #expect(Valence.defaultValence(7) == 3)
        #expect(Valence.defaultValence(8) == 2)
        #expect(Valence.defaultValence(9) == 1)
        #expect(Valence.standardValences(15) == [3, 5])
        #expect(Valence.standardValences(16) == [2, 4, 6])
        #expect(Valence.defaultValence(17) == 1)
        #expect(Valence.defaultValence(11) == 0)
        #expect(Valence.defaultValence(26) == 0)
        #expect(Valence.defaultValence(2) == 0)
    }

    @Test func looseAtomsSnapByKind() {
        let h = AtomBondState.loose(1)
        #expect(Valence.canBond(h, .loose(1)) == .covalent)
        #expect(Valence.canBond(.loose(6), h) == .covalent)
        #expect(Valence.canBond(.loose(11), .loose(17)) == .ionicContact)
        #expect(Valence.canBond(.loose(11), .loose(6)) == nil)
        #expect(Valence.canBond(.loose(11), .loose(19)) == nil)
        #expect(Valence.canBond(.loose(26), .loose(6)) == .coordination)
        #expect(Valence.canBond(.loose(26), .loose(29)) == .coordination)
        #expect(Valence.canBond(.loose(2), h) == nil)
        #expect(Valence.canBond(.loose(18), .loose(6)) == nil)
        // Xe and Kr bond only to O/F and F.
        #expect(Valence.canBond(.loose(54), .loose(9)) == .covalent)
        #expect(Valence.canBond(.loose(54), .loose(6)) == nil)
        #expect(Valence.canBond(.loose(36), .loose(8)) == nil)
    }

    @Test func buildMethaneThenStop() {
        var molecule = Molecule(atomicNumbers: [6], positions: [Vec3.zero])
        var graph = BondGraph(atomCount: 1, bonds: [])
        for k in 0..<4 {
            let h = Molecule(atomicNumbers: [1], positions: [Vec3(Double(k + 1), 0, 0)])
            let joined = Snap.join(molecule, graph, atom: 0, h, BondGraph(atomCount: 1, bonds: []), atom: 0)
            #expect(joined != nil)
            if let joined { (molecule, graph) = joined }
        }
        #expect(molecule.hillFormula == "CH4")
        #expect(graph.bonds.allSatisfy { abs(Double($0.length) - 1.07) < 1e-6 })
        let fifth = Molecule(atomicNumbers: [1], positions: [Vec3(0, 5, 0)])
        #expect(Snap.join(molecule, graph, atom: 0, fifth, BondGraph(atomCount: 1, bonds: []), atom: 0) == nil)
        // A hydrogen of methane is full too.
        #expect(Snap.join(molecule, graph, atom: 1, fifth, BondGraph(atomCount: 1, bonds: []), atom: 0) == nil)
    }

    @Test func hydrogenMoleculeTakesNoThirdAtom() {
        let h2 = Molecule(atomicNumbers: [1, 1], positions: [Vec3.zero, Vec3(0.74, 0, 0)])
        let graph = BondGraph.forPlay(h2)
        #expect(graph.bonds.count == 1)
        let h = Molecule(atomicNumbers: [1], positions: [Vec3(3, 0, 0)])
        #expect(Snap.join(h2, graph, atom: 1, h, BondGraph(atomCount: 1, bonds: []), atom: 0) == nil)
    }

    @Test func ionsFillTheirContactCap() {
        var state = AtomBondState.loose(3)
        #expect(state.freeValence == 6)
        state.contactCount = 6
        #expect(state.freeValence == 0)
        #expect(Valence.canBond(state, .loose(8)) == nil)
    }

    @Test func halogensKeepOnePartner() {
        let chloromethaneCl = AtomBondState(z: 17, covalentPartners: [6], covalentOrderSum: 1)
        #expect(chloromethaneCl.freeValence == 0)
        #expect(Valence.canBond(chloromethaneCl, .loose(6)) == nil)
        // Even with valence to spare, the recipe's partner rule refuses a second ordinary partner.
        #expect(!AtomBondState(z: 17, covalentPartners: [6]).withinRecipeCaps(adding: 6))
        #expect(AtomBondState(z: 17, covalentPartners: [6]).withinRecipeCaps(adding: 8))
    }

    @Test func restLengths() {
        #expect(abs(Valence.restLength(6, 1, kind: .covalent) - 1.07) < 1e-12)
        #expect(abs(Valence.restLength(11, 17, kind: .ionicContact) - 2.83) < 1e-12)
        #expect(abs(Valence.restLength(26, 6, kind: .coordination) - (1.52 + 0.76)) < 1e-12)
    }
}
