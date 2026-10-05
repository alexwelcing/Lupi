@preconcurrency import ARKit
import CoreMedia
import Foundation
import LupiChem
import LupiData
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
    /// "O, H, H": what a built molecule was snapped from.
    var builtFrom: String?
    /// One tap of Fill would add hydrogens (plan §4.5).
    var canFill: Bool
    /// A crystal can be dived into (the receipt's view from inside).
    var canDive: Bool
    /// Grown past a toy: Surface brings it back.
    var grown: Bool
    /// Already a trophy in the collection.
    var kept: Bool

    init(id: BodyID, plaque p: Plaque, isMolecule: Bool, kept: Bool) {
        self.id = id
        name = p.name
        formula = p.formula
        atoms = p.atoms
        personality = p.personality
        magnification = p.magnification
        mass = p.feltMassKg < 1 ? String(format: "feels like %.0f g", p.feltMassKg * 1000) : String(format: "feels like %.1f kg", p.feltMassKg)
        brokenFrom = p.brokenFrom
        builtFrom = p.builtFrom
        canFill = p.canFill
        canDive = !isMolecule
        grown = p.sizeState != .toy
        self.kept = kept
    }
}

/// One element of the atom tray, ready for SwiftUI (plan §4.5).
struct TrayAtom: Identifiable, Equatable {
    var z: Int
    var symbol: String
    var name: String
    /// CPK, sRGB 0...1.
    var red: Double
    var green: Double
    var blue: Double

    var id: Int { z }

    init(_ z: Int) {
        let e = ChemicalElement.forAtomicNumber(z)
        self.z = z
        symbol = e.symbol
        name = e.name
        let c = e.cpk.srgb
        red = c.x
        green = c.y
        blue = c.z
    }

    /// Dark CPK colours (nitrogen, oxygen, bromine, iodine) take a white symbol.
    var isDark: Bool { 0.299 * red + 0.587 * green + 0.114 * blue < 0.5 }
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
    @ObservationIgnored let collection: CollectionModel
    @ObservationIgnored let shelf: ShelfHost

    private(set) var plaque: PlaqueText?
    private(set) var caption: String?
    /// Tracking has been normal at least once; spawns wait for it.
    private(set) var ready = false
    /// The tracking state while it is not normal.
    private(set) var limited: String?
    private(set) var hudLines: [String] = []
    private(set) var spikeLines: [String] = []
    private(set) var contactLog: [String] = []
    /// Spike A1's probe, as HUD lines.
    private(set) var a1Lines: [String] = []
    /// What the screen says about the shelf (plan §6.4), and its snapshot.
    private(set) var shelfPrompt: ShelfPrompt?
    var shelfSnapshot: UIImage? { shelf.snapshot }
    var showsHUD = false
    /// Three seconds at rest on a shelf keeps a body (plan §6.3); the player may turn it off.
    var autoKeep = true
    /// The atom tray's elements, as the session has them (it grows when a break frees a new one).
    private(set) var atomTray: [TrayAtom] = BuildTuning.trayElements.map(TrayAtom.init)
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
    @ObservationIgnored private var pendingAtoms: [Int] = []
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

    init(catalog: Catalog, settings: GameSettings, collection: CollectionModel) {
        session = PlaySession(catalog: catalog, settings: settings)
        self.collection = collection
        shelf = ShelfHost(store: collection.shelves)
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
        // The room opened last relocalizes from its map (plan §6.3, §6.4).
        let opened = shelf.openLastRoom(now: ProcessInfo.processInfo.systemUptime)
        await ar.start(worldMap: opened.map)
        if let missing = ar.unavailable { note("Unavailable: \(missing)") }
        for e in opened.events { handle(e) }
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

    /// A tray atom: a 3 cm bead ahead of the camera, beside the last (plan §4.5).
    func spawnAtom(_ z: Int) {
        guard ready else {
            pendingAtoms.append(z)
            show("Look around slowly so Lupi can find the room")
            return
        }
        session.spawnAtom(z)
    }

    /// One tap fills every open valence of the selected body with hydrogens (plan §4.5).
    func fillSelected() {
        guard let id = session.selection else { return }
        session.fillHydrogens(id)
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
        // UITouch timestamps and this clock share the system uptime base.
        let now = ProcessInfo.processInfo.systemUptime
        ar.update(arFrame)
        track(arFrame.camera.trackingState)
        for e in shelf.frame(arFrame, now: now) { handle(e) }
        shelf.saveIfDue(ar: ar, frame: arFrame, now: now)
        let prompt = shelf.prompt ?? (shelf.needsCoverage(now: now) ? .coverage : nil)
        if prompt != shelfPrompt { shelfPrompt = prompt }
        guard let camera = ar.camera(arFrame, viewport: viewport, orientation: orientation, scale: pixelsPerPoint) else { return }
        lastCamera = camera
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
        if session.atomTray.count != atomTray.count { atomTray = session.atomTray.map(TrayAtom.init) }
        if now - lastPublish >= 0.25 {
            lastPublish = now
            refreshPlaque()
            if showsHUD {
                publish(out.hud, arFrame)
                let a1 = shelf.probe.lines(6)
                if a1 != a1Lines { a1Lines = a1 }
            }
        }
    }

    private func flushPending() {
        for s in pending { session.spawn(s) }
        pending.removeAll()
        for z in pendingAtoms { session.spawnAtom(z) }
        pendingAtoms.removeAll()
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
        if v.ring == .lime { sparks.ring(at: position) }
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
        case let .restedOnShelf(id, support): pin(id, support: support)
        case .snapped, .filled: refreshPlaque()
        case .snapRefused: break
        case let .builtIt(id, name, known): builtIt(id, name: name, known: known)
        case let .trayGained(z): show("\(ChemicalElement.forAtomicNumber(z).name) joins the atom tray")
        }
    }

    /// "You built ethanol" (plan §4.5): a known molecule by its name, anything else by its formula.
    private func builtIt(_ id: BodyID, name: String, known: Bool) {
        refreshPlaque()
        let formula = session.body(id)?.facts.formula
        guard known, name != formula else {
            show("Built it: \(name.subscriptedFormula)")
            return
        }
        // "Water" reads "water"; "ATP" and "GABA" keep their capitals.
        let chars = Array(name)
        let lower = chars.count > 1 && chars[1].isLowercase ? chars[0].lowercased() + String(chars.dropFirst()) : name
        show("You built \(lower)")
    }

    // MARK: Keeping and shelves (plan §6.3, §6.4)

    /// Keep: the selected body becomes a trophy in the collection.
    func keepSelected() {
        guard let id = session.selection else { return }
        do {
            let record = try session.keep(id, now: Date())
            save(record)
            show("Kept: \(record.name)")
            refreshPlaque()
        } catch {
            show("\(error)")
        }
    }

    /// Three seconds at rest on a shelf: kept, and placed relative to the room's root.
    private func pin(_ id: BodyID, support: Vec3) {
        guard autoKeep, shelf.acceptsPins, let camera = lastCamera else { return }
        let now = ProcessInfo.processInfo.systemUptime
        do {
            let root = try shelf.ensureShelf(support: support, camera: camera.position, ar: ar, now: now)
            let record = try session.keep(id, now: Date())
            guard let pose = session.keptPose(id) else { return }
            save(record)
            if try shelf.place(trophy: record.id, pose: pose, root: root, now: now) {
                session.pin(id)
                show("Kept on the shelf: \(record.name)")
            } else {
                show("This shelf is full: 60 trophies")
            }
        } catch {
            show("\(error)")
        }
    }

    /// Writes a kept record unless the collection already has it as it is.
    private func save(_ record: TrophyRecord) {
        guard collection.trophy(record.id) != record else { return }
        Task { await collection.keep(record) }
    }

    private func handle(_ e: RecoveryEvent) {
        let now = ProcessInfo.processInfo.systemUptime
        switch e {
        case let .relocalized(after):
            show("Found your shelf")
            shelf.note(String(format: "relocalized after %.1f s", after), now: now)
        case .offerPutHere:
            break
        case let .trophiesAppear(root):
            let byID = Dictionary(collection.trophies.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            for (trophy, pose) in shelf.placements(under: root, trophies: byID) where session.bodies(of: trophy.id).isEmpty {
                session.spawn(.trophy(trophy), at: .shelf(pose))
            }
        case .rootPlaced:
            show("The shelf is here now")
        case .saveMap:
            shelf.saveSoon(now: now)
        }
    }

    /// Step 3: the next tap on a surface puts the shelf there.
    func putShelfHere() {
        shelf.choosePutHere(now: ProcessInfo.processInfo.systemUptime)
        shelfPrompt = shelf.prompt
    }

    /// The tap after "Put the shelf here", in view points.
    func placeShelf(at point: CGPoint) {
        guard let camera = lastCamera,
              let hit = ar.raycast(camera.ray(through: SIMD2(Double(point.x), Double(point.y)))) else {
            show("Tap a table or a shelf Lupi can see")
            return
        }
        let root = ShelfMath.rootPose(at: hit, camera: camera.position)
        for e in shelf.place(root: root, ar: ar, now: ProcessInfo.processInfo.systemUptime) { handle(e) }
        shelfPrompt = shelf.prompt
    }

    /// Step 4: the old room stays on the device until deleted.
    func startNewRoom() {
        shelf.startNewRoom(ar: ar)
        shelfPrompt = shelf.prompt
        show("A new room: leave a molecule on a shelf to start it")
    }

    /// The coaching overlay's Start Over would reset the session and lose the shelf's anchors
    /// (plan §6.4, step 6): it stops the wait instead.
    func coachingRequestedReset() {
        for e in shelf.offerNow(now: ProcessInfo.processInfo.systemUptime) { handle(e) }
        shelfPrompt = shelf.prompt
    }

    /// A trophy left the collection: its bodies stay as copies.
    func forget(trophy: UUID) {
        session.forget(trophy: trophy)
        refreshPlaque()
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
            next = PlaqueText(
                id: id, plaque: p, isMolecule: session.body(id)?.facts.isMolecule ?? true, kept: session.body(id)?.trophyID != nil
            )
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
        if let m = h.magnet { lines.append(m) }
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

    /// A1: save the shelf's map now (when mapping allows).
    func saveShelfMap() {
        let now = ProcessInfo.processInfo.systemUptime
        guard shelf.shelf != nil else {
            note("A1: no shelf yet; leave a molecule on one")
            return
        }
        shelf.saveSoon(now: now)
    }

    /// A1: run the session again from the shelf's saved map and watch it relocalize.
    func relocalizeShelf() {
        // Everything in play poofs; the shelf's trophies come back when the map matches.
        if shelf.relocalizeFromSavedMap(ar: ar, now: ProcessInfo.processInfo.systemUptime) { session.clear() }
    }

    /// A1: the probe's log as JSON lines, for the owner to paste into an issue.
    func copyA1Log() {
        UIPasteboard.general.string = shelf.probe.jsonLines()
        note("A1: log copied")
    }

    /// S10: merged meshes of 1,000 and 2,000 atoms.
    func timeMeshBuilds() {
        Task {
            note(await MeshBuildTiming.run(1000))
            note(await MeshBuildTiming.run(2000))
        }
    }
}
