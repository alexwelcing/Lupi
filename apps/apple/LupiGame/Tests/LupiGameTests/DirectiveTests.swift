import Foundation
import LupiChem
import LupiData
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

/// D14 as tests at the session's level: "Million atom needs to be first principle. Should scale
/// from 1k to googleplex if we needed." A frame, a gesture, a break and a keep cost what is on
/// screen or in the hand, never the atom count (scale.md P1, scale-spec §9.8 guarantee 2).
@Suite("the directive: flat cost across rungs")
struct DirectiveTests {
    static let rungs: [SaltRung] = [.million, .billion, .e30, .googol, .googolplex]

    /// One rung alone on the desk, the camera half a metre from it.
    static func alone(_ rung: SaltRung, settings: GameSettings = GameSettings()) -> (Simulation, BodyID) {
        var sim = Fixture.sim(settings)
        sim.session.spawn(.scale(.salt(rung)))
        sim.step()
        let id = sim.session.bodyOrder.last!
        sim.run(2)
        let c = sim.session.body(id)!.entityPose.translation
        sim.camera = CameraState.looking(from: c + Vec3(0, 0.25, 0.45), at: c)
        sim.step()
        return (sim, id)
    }

    static func withinTenPercent(_ values: [Int], sourceLocation: SourceLocation = #_sourceLocation) {
        let lo = Double(values.min()!), hi = Double(values.max()!)
        #expect(hi <= max(1.1 * lo, lo + 10), "\(values)", sourceLocation: sourceLocation)
    }

    /// Wall time of one frame of the session and the stand-in, the best of `frames`.
    static func frameTime(_ sim: inout Simulation, frames: Int = 30) -> Double {
        var best = Double.infinity
        let clock = ContinuousClock()
        for _ in 0..<frames {
            let start = clock.now
            sim.step()
            let d = clock.now - start
            best = min(best, Double(d.components.seconds) + Double(d.components.attoseconds) / 1e18)
        }
        return best
    }

    /// The desk view: from 10⁶ to a googolplex, a toy is a box or a handful of nodes, and every
    /// rung costs the same visits and items, within 10 % (§9.8 guarantee 2), and the same time.
    @Test func aToyOnTheDeskCostsTheSameAtEveryRung() throws {
        var visits: [Int] = [], items: [Int] = [], times: [Double] = []
        for rung in [SaltRung.billion, .googol, .googolplex] {
            var (sim, id) = Self.alone(rung)
            // The same footprint: the cube grown to the bars' 30 cm.
            let b = try #require(sim.session.body(id))
            if b.span < 0.29 {
                sim.pinch(id, ratio: 0.30 / b.span, over: 0.5)
                sim.run(1.5)
            }
            #expect(abs(try #require(sim.session.body(id)).span - 0.30) < 0.01)
            times.append(Self.frameTime(&sim))
            let cut = try #require(sim.last.cut)
            visits.append(cut.visited)
            items.append(cut.items.count)
            #expect(sim.budgetViolations.isEmpty)
        }
        print("desk view, 10^9, googol, googolplex: visits \(visits), items \(items), frame \(times.map { String(format: "%.3f ms", $0 * 1000) })")
        Self.withinTenPercent(visits)
        Self.withinTenPercent(items)
        #expect(times.max()! <= 3 * times.min()! + 0.002)
    }

    /// Grab, throw and smash at every rung: the same ten pieces, the same physics commands, the
    /// counts exact (a googolplex smashes into ten cubes of 10^(10^100 − 1)), and the same time.
    @Test func aSmashCostsTheSameAtEveryRung() throws {
        var commands: [Int] = []
        var pieceCounts: [String] = []
        for rung in Self.rungs {
            var (sim, id) = Self.alone(rung)
            sim.camera = Fixture.level
            sim.step()
            let before = sim.world.commands
            sim.flick(id, points: 400)
            sim.run(0.8)
            let (_, pieces) = try #require(sim.breaks.first, "\(rung)")
            #expect(pieces.count == 10, "\(rung)")
            commands.append(sim.world.commands - before)
            pieceCounts.append(sim.session.body(pieces[0])?.facts.count.formatted ?? "")
            #expect(sim.budgetViolations.isEmpty)
            // Ten pieces of one tenth: the total stays the rung's, exactly.
            #expect(sim.last.hud.totalAtoms == Magnitude.tower(seedCount: 1000, factor: 10, levels: rung.levels).formatted)
        }
        print("smash: physics commands \(commands), a piece holds \(pieceCounts)")
        #expect(pieceCounts == ["100,000", "100,000,000", "10^29", "10^99", "10^(10^100 − 1)"])
        // The cost follows the shape, never the count: the cubes' slabs alike, and the bars' cubes
        // alike (they are 3 cm and grow to 6 cm, which updates their colliders as they grow).
        Self.withinTenPercent(Array(commands[0..<3]))
        Self.withinTenPercent(Array(commands[3..<5]))
    }

    /// Keeping costs the same at every rung: a scale reference of a few hundred bytes, whatever
    /// the count (scale.md §6.2), and it comes back with the same exact count.
    @Test func aKeepCostsTheSameAtEveryRung() throws {
        var sizes: [Int] = []
        for rung in Self.rungs {
            var (sim, id) = Self.alone(rung)
            let record = try sim.session.keep(id, now: Date(timeIntervalSince1970: 1_790_000_000))
            let json = try LupiJSON.encoder().encode(record)
            sizes.append(json.count)
            let ref = try ScaleRef(text: try #require(record.molecule.scale).ref)
            #expect(try ref.encoded().count <= 270, "\(rung)")
            let back = try Restore.piece(record, catalog: Fixture.catalog, store: GameStore())
            #expect(back.count == Magnitude.tower(seedCount: 1000, factor: 10, levels: rung.levels))
        }
        print("kept trophies, bytes of JSON: \(sizes)")
        #expect(sizes.max()! - sizes.min()! < 200)
        #expect(sizes.max()! < 2048)
    }

    /// Inside views (§9.8 guarantee 2): each rung dived until its ions are 2 cm across, then the
    /// camera put at the same point of a seed copy in the middle of its anchor. The 10³⁰, googol
    /// and googolplex rungs, anchored at the same level by the session's own descents and flight,
    /// cut identically. The 10⁹ rung is not deep enough to have an anchor below its node: cut
    /// from its root, it costs less, never more. Every frame within its budgets.
    @Test func insideViewsCostTheSameAtEveryRung() throws {
        var costs: [(Int, Int, Int)] = []
        var times: [Double] = []
        var levels: [String] = []
        for rung in Self.rungs where rung != .million {
            var sim = Fixture.sim()
            sim.dt = 1.0 / 30
            sim.session.spawn(.scale(.salt(rung)))
            sim.step()
            let id = sim.session.bodyOrder.last!
            sim.session.dive(into: id)
            if rung == .googolplex { _ = FlightTests.fly(&sim, limit: 40) } else { sim.run(2.5) }
            // The anchor follows at two levels a frame (§8.4): the googol's 97 take a while.
            var settled = 0, last = sim.session.body(id)!.frame.anchorPath
            sim.run(until: 10) { s in
                let path = s.session.body(id)!.frame.anchorPath
                settled = path == last ? settled + 1 : 0
                last = path
                return settled >= 15
            }
            var b = try #require(sim.session.body(id))
            #expect(b.sizeState == .terrain, "\(rung)")
            let ion = 2 * b.facts.aggregate.rAtom * pow(10, FlightTests.lambda(sim, id) - 10)
            #expect(abs(ion - 0.02) < 1e-6, "\(rung)")
            // The same point of a seed copy, in the middle of the anchor (a cube of 10^(k/3) copies a side).
            let r = sim.session.resolver
            let anchor = try r.walk(r.resolve(b.frame.ref.root, b.frame.ref.path), b.frame.anchorPath)
            let k = try #require(anchor.level.int)
            #expect(k % 3 == 0, "\(rung)")
            let copies = pow(10, Double(k / 3))
            let period = try r.occupied(anchor).max.x / copies
            let eye = b.frame.world(period * (Vec3(repeating: (copies / 2).rounded(.down)) + Vec3(0.37, 0.52, 0.61)))
            sim.camera = CameraState.looking(from: eye, at: eye + Vec3(0.2, -0.3, -1))
            sim.run(0.5)
            b = try #require(sim.session.body(id))
            levels.append("\(anchor.level)/\(b.frame.anchorPath.count)")
            times.append(Self.frameTime(&sim))
            let cut = try #require(sim.last.cut)
            costs.append((cut.visited, cut.items.count, cut.drawnAtoms))
            #expect(cut.drawnAtoms > 0, "\(rung)")
            #expect(sim.budgetViolations.isEmpty, "\(rung)")
        }
        print("inside views, 10^9, 10^30, googol, googolplex: anchor level/steps \(levels), (visits, items, atoms) \(costs), frame \(times.map { String(format: "%.3f ms", $0 * 1000) })")
        #expect(costs[1] == costs[2] && costs[2] == costs[3], "rungs anchored alike cut alike")
        #expect(costs[0].0 <= costs[1].0 && costs[0].1 <= costs[1].1)
        // The bubble's wall: the same atoms within 10 %, whatever the rung.
        Self.withinTenPercent(costs.map(\.2))
        #expect(times.max()! <= 3 * times.min()! + 0.004)
    }
}
