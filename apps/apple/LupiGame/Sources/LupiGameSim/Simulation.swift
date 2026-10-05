import Foundation
import LupiChem
import LupiGame
import LupiScale

/// The headless harness: a session, the stand-in physics and a scripted camera, stepped at a
/// fixed rate, with every cue and event kept for the tests to read.
public struct Simulation: Sendable {
    public var session: PlaySession
    public var world: StubWorld
    public var camera: CameraState
    public var thermal: ThermalLevel = .nominal
    public var dt = 1.0 / 60
    public private(set) var time = 0.0
    public private(set) var rate = 1.0
    public private(set) var last = FrameOutput()
    /// What the session saw last: the motions it adopted.
    public private(set) var lastInput: FrameInput?
    public private(set) var cues: [JuiceCue] = []
    public private(set) var events: [SessionEvent] = []
    /// Every frame's cut stayed within its budgets (scale-spec §9.5's invariant).
    public private(set) var budgetViolations: [String] = []
    public private(set) var frames = 0
    var nextTouch = 100

    public init(session: PlaySession, world: StubWorld = StubWorld(), camera: CameraState) {
        self.session = session
        self.world = world
        self.camera = camera
    }

    @discardableResult
    public mutating func step(touches: [TouchSample] = []) -> FrameOutput {
        let contacts = frames > 0 ? world.step(dt * rate, time: time + dt) : []
        time += dt
        frames += 1
        let input = FrameInput(
            time: time, camera: camera, bodies: world.motions, contacts: contacts, touches: touches, thermal: thermal,
            floorY: world.floorY
        )
        lastInput = input
        let out = session.step(input)
        world.apply(out.physics)
        rate = out.simulationRate
        last = out
        cues += out.juice
        events += out.events
        if !lastCutWithinBudgets(session.budgets) { budgetViolations.append("frame \(frames)") }
        return out
    }

    public mutating func run(_ seconds: Double) {
        let n = Int((seconds / dt).rounded())
        for _ in 0..<n { step() }
    }

    /// Steps until `done` holds, at most `seconds`; returns whether it held.
    @discardableResult
    public mutating func run(until seconds: Double, _ done: (Simulation) -> Bool) -> Bool {
        let n = Int((seconds / dt).rounded())
        for _ in 0..<n {
            if done(self) { return true }
            step()
        }
        return done(self)
    }

    /// Whether the last cut kept every budget of the device column (scale-spec §9.8 item 1).
    public func lastCutWithinBudgets(_ budgets: Budgets) -> Bool {
        guard let cut = last.cut else { return true }
        return cut.usedItems <= budgets.items && cut.usedAtoms <= budgets.instancedAtoms
            && cut.usedBoxesAndSplats <= budgets.boxesAndSplats && cut.visited <= budgets.visits
            && cut.pops <= budgets.items + budgets.visits
    }

    /// Where a body's centre shows on screen.
    public func screenPoint(of id: BodyID) -> SIMD2<Double>? {
        guard let b = session.body(id) else { return nil }
        return camera.project(b.entityPose.translation)
    }

    // MARK: Scripted touches

    public mutating func touch() -> Int {
        nextTouch += 1
        return nextTouch
    }

    /// A finger down on a body, dragged by `delta` points over `duration`, then lifted (a flick
    /// when fast). Returns the touch id.
    @discardableResult
    public mutating func drag(_ id: BodyID, by delta: SIMD2<Double>, over duration: Double, holdFirst: Double = 0) -> Int {
        guard let start = screenPoint(of: id) else { return -1 }
        let finger = touch()
        step(touches: [TouchSample(id: finger, phase: .began, location: start, time: time + dt)])
        var held = 0.0
        while held < holdFirst {
            step(touches: [TouchSample(id: finger, phase: .moved, location: start, time: time + dt)])
            held += dt
        }
        let n = max(1, Int((duration / dt).rounded()))
        var location = start
        for k in 1...n {
            location = start + delta * (Double(k) / Double(n))
            step(touches: [TouchSample(id: finger, phase: .moved, location: location, time: time + dt)])
        }
        step(touches: [TouchSample(id: finger, phase: .ended, location: location, time: time + dt)])
        return finger
    }

    /// Two fingers about a body's screen point spreading by `ratio` over `duration`.
    public mutating func pinch(_ id: BodyID, ratio: Double, over duration: Double, separation: Double = 120) {
        guard let c = screenPoint(of: id) else { return }
        let f1 = touch(), f2 = touch()
        let half = SIMD2(separation / 2, 0)
        step(touches: [
            TouchSample(id: f1, phase: .began, location: c - half, time: time + dt),
            TouchSample(id: f2, phase: .began, location: c + half, time: time + dt),
        ])
        let n = max(1, Int((duration / dt).rounded()))
        var s = separation
        for k in 1...n {
            s = separation * pow(ratio, Double(k) / Double(n))
            let h = SIMD2(s / 2, 0)
            step(touches: [
                TouchSample(id: f1, phase: .moved, location: c - h, time: time + dt),
                TouchSample(id: f2, phase: .moved, location: c + h, time: time + dt),
            ])
        }
        let h = SIMD2(s / 2, 0)
        step(touches: [
            TouchSample(id: f1, phase: .ended, location: c - h, time: time + dt),
            TouchSample(id: f2, phase: .ended, location: c + h, time: time + dt),
        ])
    }
}
