import Foundation
import LupiChem
import LupiData
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

extension Fixture {
    /// Spawns a tray atom and lets it land; returns its id. `sideways` places it (metres)
    /// instead of the tray's own spread.
    static func spawnAtom(_ sim: inout Simulation, _ z: Int, sideways: Double? = nil, settle: Double = 1.5) -> BodyID {
        let before = Set(sim.session.bodyOrder)
        if let sideways { sim.session.spawn(.atom(z), at: .ahead(sideways: sideways)) } else { sim.session.spawnAtom(z) }
        sim.step()
        let id = Set(sim.session.bodyOrder).subtracting(before).first!
        sim.run(settle)
        return id
    }
}

extension Simulation {
    var snaps: [(BodyID, [BodyID])] {
        events.compactMap { if case let .snapped(a, from) = $0 { return (a, from) }; return nil }
    }

    var builtIt: [(BodyID, String, Bool)] {
        events.compactMap { if case let .builtIt(id, name, known) = $0 { return (id, name, known) }; return nil }
    }

    /// The body a finger holds, by the session's selection (a grab selects).
    var held: BodyID? { session.selection }

    /// Picks `id` up and carries it toward each target in turn, the finger tracking the
    /// target's place on screen, until a snap joins them; holds still, then sets it down.
    /// Returns the bodies each snap made.
    @discardableResult
    mutating func build(holding id: BodyID, onto targets: [BodyID], perTarget seconds: Double = 2, speed: Double = 6) -> [BodyID] {
        guard var at = screenPoint(of: id) else { return [] }
        let finger = touch()
        step(touches: [TouchSample(id: finger, phase: .began, location: at, time: time + dt)])
        var made: [BodyID] = []
        for target in targets {
            let before = snaps.count
            let frames = Int(seconds / dt)
            for _ in 0..<frames {
                if snaps.count > before { break }
                guard let goal = screenPoint(of: target) else { break }
                let d = goal - at
                let len = (d.x * d.x + d.y * d.y).squareRoot()
                at += len > speed ? d * (speed / len) : d
                step(touches: [TouchSample(id: finger, phase: .moved, location: at, time: time + dt)])
            }
            guard snaps.count > before else { break }
            made.append(snaps.last!.0)
        }
        for _ in 0..<10 { step(touches: [TouchSample(id: finger, phase: .moved, location: at, time: time + dt)]) }
        step(touches: [TouchSample(id: finger, phase: .ended, location: at, time: time + dt)])
        return made
    }
}

/// Building from atoms (plan §4.5, §8 M2): the atom tray, the magnet and snap, hydrogen fill,
/// "Built it" with names, and trophies of what was built or broken, reloading with their bonds.
@Suite("building")
struct BuildTests {
    static let now = Date(timeIntervalSince1970: 1_791_200_000.456)

    /// The bonds a trophy's embedded XYZ reloads with, as the web and the app perceive them.
    static func reloadedGraph(_ record: TrophyRecord) throws -> MolecularGraph {
        let molecule = try Molecule(xyz: try #require(record.molecule.xyz))
        return MolecularGraph(molecule: molecule, graph: BondGraph.forPlay(molecule))
    }

    /// The graph a body plays with.
    static func graph(_ sim: Simulation, _ id: BodyID) throws -> MolecularGraph {
        let b = try #require(sim.session.body(id))
        let r = sim.session.resolver
        let leaf = try r.materialize(r.resolve(b.frame.ref.root, b.frame.ref.path))
        let m = Molecule(atomicNumbers: leaf.atomicNumbers.map(Int.init), positions: leaf.positions)
        return MolecularGraph(molecule: m, graph: BondGraph.forPlay(m))
    }

    @Test func theTrayHoldsElevenElementsAndAtomsAreBeads() throws {
        var sim = Fixture.sim()
        #expect(sim.session.atomTray == [1, 6, 7, 8, 9, 15, 16, 17, 35, 53, 11])
        let c = Fixture.spawnAtom(&sim, 6)
        let b = try #require(sim.session.body(c))
        #expect(b.name == "Carbon")
        #expect(b.sigma == BuildTuning.atomScale)
        #expect(b.buildable && b.facts.isMolecule)
        #expect(b.facts.count.formatted == "1")
        // A carbon is a bead about 3 cm across, landed on the desk.
        let box = b.worldBounds
        #expect(abs(box.min.y - 1.0) < 0.02)
        #expect(b.spec.shapes.count == 1)
        // Atoms spawn side by side, not in one spot; a lone hydrogen is a bead too.
        let h = Fixture.spawnAtom(&sim, 1)
        #expect(sim.session.body(h)!.spec.shapes.count == 1)
        #expect(abs(sim.session.body(h)!.worldBounds.min.y - 1.0) < 0.02)
        let gap = (sim.session.body(h)!.entityPose.translation - sim.session.body(c)!.entityPose.translation).length
        #expect(gap > 0.04)
        // Loose atoms at rest never snap by themselves, however close.
        #expect(sim.snaps.isEmpty)
        #expect(sim.session.canFill(c))
        let water = Fixture.spawn(&sim, "water")
        #expect(!sim.session.canFill(water))
    }

    @Test func waterFromAtomsKeptAndReloadedWithItsBonds() throws {
        var sim = Fixture.sim()
        let o = Fixture.spawnAtom(&sim, 8)
        let h1 = Fixture.spawnAtom(&sim, 1)
        let h2 = Fixture.spawnAtom(&sim, 1)
        let made = sim.build(holding: o, onto: [h1, h2])
        #expect(made.count == 2)
        // The first snap: O and H into OH, held on; the click plays.
        let (oh, from) = try #require(sim.snaps.first)
        #expect(from.sorted() == [o, h1].sorted())
        #expect(sim.session.body(o) == nil && sim.session.body(h1) == nil)
        #expect(sim.cues.contains { $0.output.sounds.contains { $0.voice == .snap } })
        _ = oh
        let water = try #require(made.last)
        let w = try #require(sim.session.body(water))
        #expect(w.facts.formula == "H2O")
        #expect(w.name == "Water")
        // "Built it": every atom at its usual valence, and Lupi knows it.
        let (celebrated, name, known) = try #require(sim.builtIt.last)
        #expect(celebrated == water && name == "Water" && known)
        #expect(sim.builtIt.count == 1)
        #expect(sim.cues.contains { $0.output.sounds.contains { $0.voice == .delight } })
        // The oxygen's atoms come first and keep the oxygen's frame (scale-spec §10.7).
        #expect(w.sigma == BuildTuning.atomScale)
        let g = try Self.graph(sim, water)
        #expect(g.atomicNumbers == [8, 1, 1])
        #expect(g.links.count == 2)
        sim.run(1.5)
        #expect(sim.session.body(water)?.mode == .dynamic)

        let record = try sim.session.keep(water, now: Self.now)
        #expect(record.validate() == [])
        #expect(record.name == "Water")
        #expect(record.molecule.source == .built)
        #expect(record.molecule.formula == "H2O" && record.molecule.atoms == 3)
        #expect(record.origin.kind == .built)
        #expect(record.origin.parts == ["O", "H", "H"])
        #expect(record.story() == "Built from atoms: O, H, H")
        let xyz = try #require(record.molecule.xyz)
        #expect(xyz.hasPrefix("3\nLupi built | formula=H2O | charge_source=unavailable | coordinates=lupi-play\nO "))
        #expect(record.molecule.sha256 == SHA256.hex(xyz))
        // Its exact form is its own leaf, embedded (scale-spec §10.7).
        let ref = try ScaleRef(text: try #require(record.molecule.scale).ref)
        #expect(ref.path.steps.isEmpty && ref.records.count == 1 && ref.probe == ref.root)
        #expect(ref.key == w.identity.key)
        // Reloads with exactly the bonds built, in the same atom order.
        #expect(try Self.reloadedGraph(record) == g)

        // Back from the collection: the same piece, buildable, its story on the plaque.
        var fresh = Fixture.sim()
        fresh.session.spawn(.trophy(record))
        fresh.step()
        let back = try #require(fresh.session.bodyOrder.first)
        #expect(fresh.session.body(back)!.identity.key == ref.key)
        #expect(fresh.session.body(back)!.buildable)
        #expect(try Self.graph(fresh, back) == g)
        #expect(fresh.session.plaque(back)?.builtFrom == "O, H, H")
    }

    @Test func ethanolFromAtomsWithOneTapOfFill() throws {
        var sim = Fixture.sim()
        // Far enough apart that a carbon picked up reaches only the atom it is carried to.
        let c1 = Fixture.spawnAtom(&sim, 6, sideways: 0)
        let c2 = Fixture.spawnAtom(&sim, 6, sideways: 0.15)
        let o = Fixture.spawnAtom(&sim, 8, sideways: -0.15)
        let cc = try #require(sim.build(holding: c1, onto: [c2]).first)
        #expect(sim.session.body(cc)?.facts.formula == "C2")
        // Nothing celebrated yet: two carbons are not a molecule anyone knows.
        #expect(sim.builtIt.isEmpty)
        let cco = try #require(sim.build(holding: cc, onto: [o]).first)
        #expect(sim.session.body(cco)?.facts.formula == "C2O")
        #expect(sim.session.plaque(cco)?.canFill == true)
        sim.run(1)
        let filled = sim.session.fillHydrogens(cco)
        #expect(filled)
        sim.step()
        let (ethanol, name, known) = try #require(sim.builtIt.last)
        #expect(name == "Ethanol" && known)
        let b = try #require(sim.session.body(ethanol))
        #expect(b.facts.formula == "C2H6O")
        #expect(sim.events.contains(.filled(ethanol, hydrogens: 6)))
        #expect(!sim.session.canFill(ethanol))
        #expect(sim.session.plaque(ethanol)?.builtFrom == "C, C, O, H, H, H, H, H, H")
        // It is ethanol, not dimethyl ether: the graph matches the gallery's.
        let reference = try Molecule(xyz: try Starters.xyz(try #require(try Starters.manifest().starters.first { $0.id == "ethanol" })))
        #expect(try Self.graph(sim, ethanol).isIsomorphic(to: MolecularGraph(molecule: reference, graph: BondGraph.forPlay(reference))))
        sim.run(1.5)
        let record = try sim.session.keep(ethanol, now: Self.now)
        #expect(record.validate() == [])
        #expect(record.name == "Ethanol")
        #expect(record.origin.parts == ["C", "C", "O", "H", "H", "H", "H", "H", "H"])
        #expect(try Self.reloadedGraph(record) == Self.graph(sim, ethanol))
    }

    @Test func aBrokenFragmentIsKeptAndRebuilt() throws {
        // A wall close ahead and a soft throw, so the halves land near each other.
        var sim = Fixture.sim(walls: [SimPlane(point: Vec3(0, 0, -0.7), normal: Vec3(0, 0, 1))])
        let peroxide = Fixture.spawn(&sim, "hydrogen_peroxide")
        sim.camera = Fixture.level
        sim.flick(peroxide, points: 150)
        sim.run(0.6)
        let (_, pieces) = try #require(sim.breaks.first)
        #expect(pieces.count == 2)
        // The halves fly apart and never rejoin by themselves.
        sim.run(3)
        #expect(sim.snaps.isEmpty)
        let alive = pieces.filter { sim.session.body($0) != nil }
        #expect(alive.count == 2)
        let piece = try #require(alive.first)
        #expect(sim.session.body(piece)!.buildable)
        #expect(sim.session.body(piece)!.facts.formula == "HO")
        // Labelled honestly (plan §4.4): a hydroxyl's oxygen lacks a partner.
        #expect(sim.session.body(piece)!.name == "HO radical")

        // A fragment kept: embedded XYZ, broken from its parent, the same bonds back.
        let record = try sim.session.keep(piece, now: Self.now)
        #expect(record.validate() == [])
        #expect(record.molecule.source == .fragment)
        #expect(record.origin.kind == .broken)
        #expect(record.origin.parent?.name == "Hydrogen peroxide")
        #expect(record.story() == "Broken from Hydrogen peroxide")
        let ref = try ScaleRef(text: try #require(record.molecule.scale).ref)
        // Its exact form is the parent's leaf and one `atoms` step (scale-spec §10.6).
        guard case .atoms? = ref.path.steps.last else {
            Issue.record("a fragment is a selection")
            return
        }
        #expect(ref.path.steps.count == 1)
        #expect(try Self.reloadedGraph(record) == Self.graph(sim, piece))

        // Picked up and brought to its other half, it snaps back into peroxide.
        let other = try #require(alive.last)
        // The phone over the middle, at the same distance from both, as a player would hold it.
        let pa = sim.session.body(piece)!.entityPose.translation, pb = sim.session.body(other)!.entityPose.translation
        let mid = 0.5 * (pa + pb)
        var across = Vec3(pb.x - pa.x, 0, pb.z - pa.z).cross(Vec3(0, 1, 0)).normalized
        if across.z < 0 { across = -1 * across }
        sim.camera = CameraState.looking(from: mid + Vec3(0, 0.35, 0) + across * 0.35, at: mid)
        guard sim.screenPoint(of: piece) != nil, sim.screenPoint(of: other) != nil else {
            Issue.record("both halves in front of the camera")
            return
        }
        // They may have landed a metre apart: the finger sweeps across quickly.
        let rebuilt = try #require(sim.build(holding: piece, onto: [other], perTarget: 4, speed: 25).first)
        let b = try #require(sim.session.body(rebuilt))
        #expect(b.facts.formula == "H2O2")
        #expect(sim.builtIt.last?.1 == "Hydrogen peroxide")
        // A rebuilt piece is a built molecule: its story is the two halves.
        #expect(sim.session.plaque(rebuilt)?.builtFrom == "HO, HO")
        let kept = try sim.session.keep(rebuilt, now: Self.now)
        #expect(kept.molecule.source == .built && kept.origin.parts == ["HO", "HO"])
        #expect(kept.validate() == [])
    }

    @Test func aFragmentOfABuiltMoleculeNamesItsParent() throws {
        var sim = Fixture.sim()
        let k = Fixture.spawnAtom(&sim, 19)
        let cl = Fixture.spawnAtom(&sim, 17)
        // Potassium is not in the tray; a spawned one still snaps, as an ion to a chloride.
        #expect(!sim.session.atomTray.contains(19))
        let salt = try #require(sim.build(holding: k, onto: [cl]).first)
        #expect(sim.session.body(salt)?.facts.formula == "ClK")
        // Ionic contact: every atom has its partner, so it is built, named by its formula.
        #expect(sim.builtIt.last.map { $0.1 == "ClK" && !$0.2 } == true)
        sim.run(1.5)
        sim.camera = Fixture.level
        sim.flick(salt)
        sim.run(0.6)
        let (broken, pieces) = try #require(sim.breaks.first)
        #expect(broken == salt && pieces.count == 2)
        // The loose potassium joins the tray.
        #expect(sim.session.atomTray.last == 19)
        #expect(sim.events.contains(.trayGained(19)))
        let ion = try #require(pieces.first { sim.session.body($0)?.facts.formula == "K" })
        #expect(sim.session.body(ion)?.name == "Potassium atom")
        let record = try sim.session.keep(ion, now: Self.now)
        #expect(record.validate() == [])
        #expect(record.molecule.source == .fragment)
        #expect(record.origin.parent?.source == .built)
        #expect(record.origin.parent?.name == "ClK")
    }

    @Test func wholeMoleculesBounceAndFullOnesTakeNothing() throws {
        var sim = Fixture.sim()
        let water = Fixture.spawn(&sim, "water")
        let methane = Fixture.spawn(&sim, "methane")
        // Two gallery molecules carried together: neither is buildable, nothing snaps.
        sim.build(holding: water, onto: [methane], perTarget: 1.5)
        #expect(sim.snaps.isEmpty)
        // A hydrogen carried to methane: methane has no open valence.
        let h = Fixture.spawnAtom(&sim, 1)
        sim.build(holding: h, onto: [methane], perTarget: 1.5)
        #expect(sim.snaps.isEmpty)
        #expect(sim.session.body(methane)?.facts.formula == "CH4")
    }

    @Test func theGuestGlidesToTheHostsScale() throws {
        var sim = Fixture.sim()
        let peroxide = Fixture.spawn(&sim, "hydrogen_peroxide")
        sim.camera = Fixture.level
        sim.flick(peroxide)
        sim.run(2.5)
        sim.camera = Fixture.camera
        let (_, pieces) = try #require(sim.breaks.first)
        let hydroxyl = try #require(pieces.first { sim.session.body($0) != nil && sim.screenPoint(of: $0) != nil })
        let host = try #require(sim.session.body(hydroxyl))
        #expect(host.sigma > BuildTuning.atomScale * 1.2)
        let h = Fixture.spawnAtom(&sim, 1)
        var sigmas: [Double] = []
        var magnetLines: [String] = []
        // Carry the hydroxyl to the bead; the bead glides to it and grows to its scale.
        guard var at = sim.screenPoint(of: hydroxyl) else { return }
        let finger = sim.touch()
        sim.step(touches: [TouchSample(id: finger, phase: .began, location: at, time: sim.time + sim.dt)])
        for _ in 0..<240 where sim.snaps.isEmpty {
            if let s = sim.session.body(h)?.sigma { sigmas.append(s) }
            if let line = sim.last.hud.magnet { magnetLines.append(line) }
            guard let goal = sim.screenPoint(of: h) else { break }
            let d = goal - at
            let len = (d.x * d.x + d.y * d.y).squareRoot()
            at += len > 6 ? d * (6 / len) : d
            sim.step(touches: [TouchSample(id: finger, phase: .moved, location: at, time: sim.time + sim.dt)])
        }
        sim.step(touches: [TouchSample(id: finger, phase: .ended, location: at, time: sim.time + sim.dt)])
        let (water, _) = try #require(sim.snaps.first)
        #expect(sim.session.body(water)?.facts.formula == "H2O")
        #expect(sigmas.first == BuildTuning.atomScale)
        // The HUD shows the pull while it lasts.
        #expect(magnetLines.first?.hasPrefix("magnet \(hydroxyl) ← \(h) ") == true)
        #expect(try #require(sigmas.last) > BuildTuning.atomScale)
        // The merged body keeps the host's frame and scale.
        #expect(abs(sim.session.body(water)!.sigma - host.sigma) < 1e-12)
    }

    @Test func stillSnapsWithoutAGlide() throws {
        var sim = Fixture.sim(GameSettings(comfort: .still))
        let o = Fixture.spawnAtom(&sim, 8)
        let h = Fixture.spawnAtom(&sim, 1)
        sim.build(holding: o, onto: [h])
        let (oh, _) = try #require(sim.snaps.first)
        #expect(sim.session.body(oh)?.facts.formula == "HO")
    }

    @Test func omolAttributionIsReadBackFromTrophies() throws {
        let at = Date(timeIntervalSince1970: 1_791_200_000)
        let xyz = "1\nLupi built | formula=K | charge_source=unavailable | source=omol25:neutral-validation:4138,omol25:neutral-validation:3082 | license=CC-BY-4.0 | coordinates=lupi-play\nK 0 0 0\n"
        let built = TrophyRecord(
            name: "K", molecule: MoleculeRef(source: .built, sha256: SHA256.hex(xyz), formula: "K", atoms: 1, xyz: xyz),
            origin: TrophyOrigin(kind: .built, at: at, parts: ["K"]), look: TrophyLook(scale: 0.025), createdAt: at
        )
        #expect(Catalog.omolRows(built) == ["neutral-validation:4138", "neutral-validation:3082"])
        let fragment = TrophyRecord(
            name: "HO", molecule: MoleculeRef(source: .fragment, sha256: SHA256.hex(xyz), formula: "K", atoms: 1, xyz: xyz),
            origin: TrophyOrigin(kind: .broken, at: at, parent: ParentRef(name: "C4H4F6O", formula: "C4H4F6O", source: .omol25, id: "neutral-validation:21277")),
            look: TrophyLook(scale: 0.025), createdAt: at
        )
        #expect(Catalog.omolRows(fragment) == ["neutral-validation:21277"])
    }

    @Test func buildingIsDeterministic() throws {
        func run() throws -> NodeID {
            var sim = Fixture.sim()
            let o = Fixture.spawnAtom(&sim, 8)
            let h1 = Fixture.spawnAtom(&sim, 1)
            let h2 = Fixture.spawnAtom(&sim, 1)
            let water = try #require(sim.build(holding: o, onto: [h1, h2]).last)
            return try #require(sim.session.body(water)).identity.key
        }
        #expect(try run() == run())
    }
}
