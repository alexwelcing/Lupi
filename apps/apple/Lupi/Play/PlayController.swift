@preconcurrency import ARKit
import CoreMedia
import Foundation
import LupiChem
import LupiGame
import LupiPlay
import LupiScale
import Observation
import RealityKit
import UIKit

/// The selected body's plaque as text, so SwiftUI files need not import LupiScale (its `View`
/// and `Path` would shadow SwiftUI's).
struct PlaqueText: Equatable {
    var id: BodyID
    var name: String
    var formula: String
    var atoms: String
    var personality: String
    var magnification: String
    var mass: String
    var brokenFrom: String?
    /// A crystal can be dived into (the receipt's view from inside).
    var canDive: Bool
    /// Grown past a toy: Surface brings it back.
    var grown: Bool

    init(id: BodyID, plaque p: Plaque, isMolecule: Bool) {
        self.id = id
        name = p.name
        formula = p.formula
        atoms = p.atoms
        personality = p.personality
        magnification = p.magnification
        mass = p.feltMassKg < 1 ? String(format: "feels like %.0f g", p.feltMassKg * 1000) : String(format: "feels like %.1f kg", p.feltMassKg)
        brokenFrom = p.brokenFrom
        canDive = !isMolecule
        grown = p.sizeState != .toy
    }
}

/// Debug toggles for the day-one device spikes (plan §8 M0).
struct SpikeToggles: Equatable {
    /// A2: bodies under a custom `PhysicsSimulationComponent` with a slow-motion clock.
    var customSimulation = false
    /// A4: log impulses at first contact.
    var logContacts = false
    /// S7: instanced spheres ahead of the camera.
    var stressCount = 0
}

/// The play screen's engine room: owns the ARSession host, the RealityKit scene, haptics,
/// sound and sparks, and steps the pure `PlaySession` once per RealityKit update with the
/// frame's camera, physics state, contacts and touches (plan §3, scale-spec §8–§10).
@MainActor
@Observable
final class PlayController {
    @ObservationIgnored let ar = ARHost()
    @ObservationIgnored let scene = PlayScene()
    @ObservationIgnored let haptics = Haptics()
    @ObservationIgnored let sounds = Sounds()
    @ObservationIgnored let sparks = Sparks()
    @ObservationIgnored let stress = InstanceStress()
    /// Everything added to the RealityView.
    @ObservationIgnored let content = Entity()
    @ObservationIgnored private(set) var session: PlaySession

    private(set) var plaque: PlaqueText?
    private(set) var caption: String?
    /// Tracking has been normal at least once; spawns wait for it.
    private(set) var ready = false
    /// The tracking state while it is not normal.
    private(set) var limited: String?
    private(set) var hudLines: [String] = []
    private(set) var spikeLines: [String] = []
    private(set) var contactLog: [String] = []
    var showsHUD = false
    var spikes = SpikeToggles() {
        didSet { applySpikes(from: oldValue) }
    }

    @ObservationIgnored private var touchBuffer: [TouchSample] = []
    @ObservationIgnored private var contactBuffer: [PlayContact] = []
    @ObservationIgnored private var viewport = CGSize.zero
    @ObservationIgnored private var pixelsPerPoint: CGFloat = 1
    @ObservationIgnored private var orientation = UIInterfaceOrientation.portrait
    @ObservationIgnored private var subscriptions: [EventSubscription] = []
    @ObservationIgnored private var pending: [SpawnSource] = []
    @ObservationIgnored private var pendingReceipt = false
    @ObservationIgnored private var running = false
    @ObservationIgnored private var lastPublish: TimeInterval = 0
    @ObservationIgnored private var lastCamera: CameraState?
    @ObservationIgnored private var lastMotions: [BodyID: BodyMotion] = [:]
    @ObservationIgnored private var pairStart: [ContactPair: TimeInterval] = [:]
    @ObservationIgnored private var timebase: CMTimebase?
    @ObservationIgnored private var rate = 1.0
    @ObservationIgnored private var slowTestUntil: TimeInterval = 0
    @ObservationIgnored private var captionTask: Task<Void, Never>?

    private struct ContactPair: Hashable {
        var a: BodyID?
        var b: BodyID?
    }

    init(catalog: Catalog, settings: GameSettings) {
        session = PlaySession(catalog: catalog, settings: settings)
        content.addChild(scene.root)
        // The plane fallback arena shares the bodies' simulation, custom (A2) or not.
        scene.root.addChild(ar.planeArena)
        content.addChild(stress.anchor)
        content.addChild(sounds.anchor)
        content.addChild(sparks.anchor)
    }

    var hasLiDAR: Bool { ar.hasLiDAR }

    // MARK: RealityView

    /// Adds the scene and subscribes to RealityKit's update and collision events. Each handler
    /// is formed on the main actor, where RealityKit delivers scene events.
    func attach(_ view: inout RealityViewCameraContent) {
        view.camera = .spatialTracking
        view.add(content)
        subscriptions = [
            view.subscribe(to: SceneEvents.Update.self, on: nil, componentType: nil) { [weak self] _ in
                self?.frame()
            },
            view.subscribe(to: CollisionEvents.Began.self, on: nil, componentType: nil) { [weak self] e in
                self?.collision(e.entityA, e.entityB, impulse: e.impulse, direction: e.impulseDirection, position: e.position, began: true)
            },
            view.subscribe(to: CollisionEvents.Updated.self, on: nil, componentType: nil) { [weak self] e in
                self?.collision(e.entityA, e.entityB, impulse: e.impulse, direction: e.impulseDirection, position: e.position, began: false)
            },
        ]
    }

    func start() async {
        guard !running else { return }
        running = true
        Task { await sounds.load() }
        // Without LiDAR the arena is the detected planes alone (plan §3.3).
        if !ar.hasLiDAR { show("No LiDAR on this device: molecules land on the floors and tables Lupi finds") }
        await ar.start()
        if let missing = ar.unavailable { note("Unavailable: \(missing)") }
    }

    func stop() async {
        running = false
        for s in subscriptions { s.cancel() }
        subscriptions = []
        await ar.stop()
    }

    // MARK: Input from the views

    func touches(_ samples: [TouchSample]) { touchBuffer.append(contentsOf: samples) }

    func layout(_ size: CGSize, _ scale: CGFloat, _ orientation: UIInterfaceOrientation) {
        viewport = size
        pixelsPerPoint = scale
        self.orientation = orientation
    }

    func apply(_ settings: GameSettings) {
        if session.settings != settings { session.settings = settings }
    }

    func spawn(_ source: SpawnSource) {
        guard ready else {
            pending.append(source)
            show("Look around slowly so Lupi can find the room")
            return
        }
        session.spawn(source)
    }

    func spawnReceipt() {
        guard ready else {
            pendingReceipt = true
            show("Look around slowly so Lupi can find the room")
            return
        }
        session.spawnReceipt()
    }

    func clear() { session.clear() }
    func deselect() { session.select(nil) }

    func dive() {
        guard let id = plaque?.id else { return }
        session.dive(into: id)
    }

    func surface() {
        guard let id = plaque?.id else { return }
        session.surface(id)
    }

    // MARK: The frame

    private func frame() {
        guard running, let arFrame = ar.session.currentFrame else { return }
        ar.update(arFrame)
        track(arFrame.camera.trackingState)
        guard let camera = ar.camera(arFrame, viewport: viewport, orientation: orientation, scale: pixelsPerPoint) else { return }
        lastCamera = camera
        // UITouch timestamps and this clock share the system uptime base.
        let now = ProcessInfo.processInfo.systemUptime
        if ready { flushPending() }
        let motions = scene.motions()
        lastMotions = motions
        let contacts = contactBuffer.map { c -> PlayContact in
            var c = c
            c.time = now
            return c
        }
        contactBuffer.removeAll(keepingCapacity: true)
        let input = FrameInput(
            time: now, camera: camera, bodies: motions, contacts: contacts, touches: touchBuffer,
            thermal: Self.thermal, floorY: ar.floorY
        )
        touchBuffer.removeAll(keepingCapacity: true)
        let out = session.step(input)
        scene.apply(out.physics) { self.sparks.poof(at: $0) }
        scene.draw(out) { self.session.meshRecipe(for: $0) }
        for cue in out.juice { play(cue) }
        applyRate(out.simulationRate, now: now)
        for event in out.events { handle(event) }
        if now - lastPublish >= 0.25 {
            lastPublish = now
            refreshPlaque()
            if showsHUD { publish(out.hud, arFrame) }
        }
    }

    private func flushPending() {
        for s in pending { session.spawn(s) }
        pending.removeAll()
        if pendingReceipt {
            pendingReceipt = false
            session.spawnReceipt()
        }
    }

    private func track(_ state: ARCamera.TrackingState) {
        if case .normal = state {
            if !ready { ready = true }
            if limited != nil { limited = nil }
        } else {
            let line = state.line
            if limited != line { limited = line }
        }
    }

    static var thermal: ThermalLevel {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: .nominal
        case .fair: .fair
        case .serious: .serious
        case .critical: .critical
        @unknown default: .serious
        }
    }

    // MARK: Contacts

    private func collision(_ a: Entity, _ b: Entity, impulse: Float, direction: SIMD3<Float>, position: SIMD3<Float>, began: Bool) {
        let ia = scene.body(of: a)
        let ib = scene.body(of: b)
        guard ia != nil || ib != nil else { return }
        contactBuffer.append(PlayContact(
            a: ia, b: ib, phase: began ? .began : .updated, impulse: Double(impulse),
            direction: direction.asDouble, position: position.asDouble, time: 0
        ))
        if spikes.logContacts { logContact(ia, ib, impulse: Double(impulse), began: began) }
    }

    /// Spike A4: the impulse of `Began` against the `Updated` reports of the next 50 ms, and
    /// against the body's momentum just before (m·v; a bounce takes up to twice that).
    private func logContact(_ a: BodyID?, _ b: BodyID?, impulse: Double, began: Bool) {
        let now = ProcessInfo.processInfo.systemUptime
        let key = ContactPair(a: a, b: b)
        if began {
            pairStart[key] = now
        } else {
            guard let start = pairStart[key], now - start <= PlayTuning.impactWindow else { return }
        }
        let name = { (id: BodyID?) in id.map(\.description) ?? "room" }
        var line = "\(began ? "B" : "U") \(name(a))·\(name(b)) J \(String(format: "%.4f", impulse))"
        if began, let id = a ?? b, let m = session.body(id)?.feltMassKg, let v = lastMotions[id]?.linearVelocity.length {
            line += " m·v \(String(format: "%.4f", m * v))"
        }
        contactLog.append(line)
        if contactLog.count > 12 { contactLog.removeFirst(contactLog.count - 12) }
    }

    // MARK: Juice

    private func play(_ cue: JuiceCue) {
        // The director already applied Sound & haptics, the hardware and motion comfort.
        haptics.play(cue.output.haptics)
        let position = cue.position.asFloat
        let entity = cue.body.flatMap { scene.entity(of: $0) }
        for sound in cue.output.sounds {
            if sound.delay > 0 {
                Task { [weak self] in
                    try? await Task.sleep(for: .seconds(sound.delay))
                    self?.playSound(sound, on: entity, at: position)
                }
            } else {
                playSound(sound, on: entity, at: position)
            }
        }
        let v = cue.output.visual
        if v.flashRing {
            sparks.flash(at: position, colours: cue.sparkColours)
        } else if v.sparks > 0 {
            sparks.burst(at: position, count: v.sparks, colours: cue.sparkColours, drift: v.sparksDrift)
        }
    }

    private func playSound(_ cue: SoundCue, on entity: Entity?, at position: SIMD3<Float>) {
        if let entity, entity.parent != nil {
            sounds.play(cue, on: entity)
        } else {
            sounds.play(cue, at: position)
        }
    }

    /// Slow motion runs only on spike A2's custom simulation clock; without it, hit-stop alone
    /// carries big moments (plan §5.4).
    private func applyRate(_ r: Double, now: TimeInterval) {
        guard let timebase else { return }
        let target = now < slowTestUntil ? 0.25 : r
        guard target != rate else { return }
        rate = target
        try? timebase.setRate(target)
    }

    // MARK: Events, captions, plaque, HUD

    private func handle(_ e: SessionEvent) {
        switch e {
        case let .refused(text): show(text)
        case let .detent(_, readout): show(readout)
        case let .broke(_, pieces): show("Broke into \(pieces.count) pieces")
        case .selected, .removed: refreshPlaque()
        case .spawned: break
        }
    }

    private func show(_ text: String) {
        caption = text
        captionTask?.cancel()
        captionTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            self?.caption = nil
        }
    }

    private func refreshPlaque() {
        var next: PlaqueText?
        if let id = session.selection, let p = session.plaque(id) {
            next = PlaqueText(id: id, plaque: p, isMolecule: session.body(id)?.facts.isMolecule ?? true)
        }
        if next != plaque { plaque = next }
    }

    private func publish(_ h: HUDStats, _ frame: ARFrame) {
        var lines = [
            String(format: "%.0f fps, worst %.1f ms, cut %.2f ms", h.fps, h.worstFrameMs, h.cutMs),
            "bodies \(h.bodies), toys \(h.toys), items \(h.items), visited \(h.visited)\(h.overBudget ? ", OVER BUDGET" : "")",
            "atoms \(h.totalAtoms)",
            "drawn \(h.drawnAtoms), instanced \(scene.drawnInstances), τ \(String(format: "%.2f", h.tau)) px",
            "thermal \(h.thermal), tracking \(frame.camera.trackingState.line), map \(frame.worldMappingStatus.line), \(ar.hasLiDAR ? "LiDAR" : "no LiDAR")",
        ]
        if let i = h.lastImpulse { lines.append(String(format: "last impulse %.4f N·s, Δv %.2f m/s", i, h.lastDeltaV ?? 0)) }
        if let s = h.lastThrowSpeed { lines.append(String(format: "last throw %.2f m/s", s)) }
        if let m = scene.lastMeshBuild { lines.append(String(format: "last mesh %d atoms, %.1f ms", m.atoms, m.milliseconds)) }
        if let t = session.tumble { lines.append(t.line) }
        if timebase != nil { lines.append("A2 custom simulation, rate \(String(format: "%.2f", rate))") }
        if stress.count > 0 { lines.append("S7 \(stress.count) instanced spheres") }
        if hudLines != lines { hudLines = lines }
    }

    private func note(_ line: String) {
        spikeLines.append(line)
        if spikeLines.count > 6 { spikeLines.removeFirst(spikeLines.count - 6) }
    }

    // MARK: Spikes (plan §8 M0)

    private func applySpikes(from old: SpikeToggles) {
        if spikes.customSimulation != old.customSimulation { setCustomSimulation(spikes.customSimulation) }
        if spikes.stressCount != old.stressCount {
            if let camera = lastCamera {
                stress.show(spikes.stressCount, ahead: camera, assets: scene.assets)
            } else {
                note("S7: no camera yet")
            }
        }
        if !spikes.logContacts && old.logContacts {
            contactLog = []
            pairStart = [:]
        }
    }

    /// A2: the play root becomes its own simulation, with raised solver iterations and a clock
    /// slow motion can drive. Does it still collide with the scene-understanding mesh?
    private func setCustomSimulation(_ on: Bool) {
        guard on else {
            scene.root.components.remove(PhysicsSimulationComponent.self)
            timebase = nil
            rate = 1
            note("A2: default simulation")
            return
        }
        var sim = PhysicsSimulationComponent()
        sim.solverIterations = PhysicsSimulationComponent.SolverIterations(positionIterations: 12, velocityIterations: 4)
        do {
            let tb = try CMTimebase(sourceClock: CMClock.hostTimeClock)
            try tb.setRate(1)
            sim.clock = tb
            timebase = tb
            rate = 1
        } catch {
            note("A2: no timebase: \(error.localizedDescription)")
        }
        scene.root.components.set(sim)
        note("A2: custom simulation, solver 12/4; throw at a wall")
    }

    /// A2: quarter speed for two seconds, to throw through.
    func slowMotionTest() {
        guard timebase != nil else {
            note("A2: turn on the custom simulation first")
            return
        }
        slowTestUntil = ProcessInfo.processInfo.systemUptime + 2
        note("A2: quarter speed for 2 s")
    }

    /// A3: toss the selected body up spinning about its intermediate axis.
    func tumbleTest() {
        guard let id = session.selection else {
            note("A3: tap a body to select it first")
            return
        }
        if session.tumbleTest(id) { note("A3: tossed \(id)") }
    }

    func saveWorldMap() {
        Task { note(await ar.saveWorldMap()) }
    }

    func loadWorldMap() {
        Task { note(await ar.loadWorldMap()) }
    }

    /// S10: merged meshes of 1,000 and 2,000 atoms.
    func timeMeshBuilds() {
        Task {
            note(await MeshBuildTiming.run(1000))
            note(await MeshBuildTiming.run(2000))
        }
    }
}
