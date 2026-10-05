import Foundation
import LupiChem
import LupiGame
import LupiGameSim
import LupiPlay
import LupiScale
import LupiScaleCore
import Testing

/// Shared fixtures: the bundled catalog, a phone held level 40 cm above a desk, a wall ahead.
enum Fixture {
    static let catalog: Catalog = try! Catalog.bundled()

    /// A phone held 25 cm above a desk (the floor plane at 1.0 m), looking down at it.
    static let camera = CameraState.looking(from: Vec3(0, 1.25, 0), at: Vec3(0, 1.05, -0.6))

    /// The same phone raised level to aim at the wall.
    static let level = CameraState.looking(from: Vec3(0, 1.25, 0), at: Vec3(0, 1.25, -1))

    static let wall = SimPlane(point: Vec3(0, 0, -1.5), normal: Vec3(0, 0, 1))

    static func sim(_ settings: GameSettings = GameSettings(), walls: [SimPlane] = [wall]) -> Simulation {
        Simulation(session: PlaySession(catalog: catalog, settings: settings), world: StubWorld(floorY: 1.0, walls: walls), camera: camera)
    }

    /// Spawns a tray item and steps until it has landed and settled; returns its id.
    static func spawn(_ sim: inout Simulation, _ id: String, settle: Double = 2.0) -> BodyID {
        let before = Set(sim.session.bodyOrder)
        sim.session.spawn(.starter(id))
        sim.step()
        let new = Set(sim.session.bodyOrder).subtracting(before)
        precondition(new.count == 1, "one spawn")
        sim.run(settle)
        return new.first!
    }

    static func spawnSalt(_ sim: inout Simulation, _ rung: ReceiptRung, settle: Double = 2.0) -> BodyID {
        let before = Set(sim.session.bodyOrder)
        sim.session.spawn(.salt(rung))
        sim.step()
        let id = Set(sim.session.bodyOrder).subtracting(before).first!
        sim.run(settle)
        return id
    }
}

extension Simulation {
    /// A flick toward the wall: grab, drag up the screen fast, release.
    mutating func flick(_ id: BodyID, points: Double = 300, over: Double = 0.1) {
        drag(id, by: SIMD2(0, -points), over: over)
    }

    var breaks: [(BodyID, [BodyID])] {
        events.compactMap { if case let .broke(a, b) = $0 { return (a, b) }; return nil }
    }
}
