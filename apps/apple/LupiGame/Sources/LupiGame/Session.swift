import Foundation
import LupiChem
import LupiPlay
import LupiScale
import LupiScaleCore

/// The device the budgets are for (scale-spec §9.3).
public enum DeviceClass: Sendable, Equatable {
    case iPhone, iPad
}

/// The player's settings (plan §5.1, §5.5) and what the hardware can do.
public struct GameSettings: Sendable, Equatable {
    /// The one "Sound & haptics" toggle, on by default in AR (D11).
    public var soundAndHaptics: Bool
    public var comfort: MotionComfort
    /// `CHHapticEngine.capabilitiesForHardware().supportsHaptics`: false on iPad.
    public var supportsHaptics: Bool
    public var device: DeviceClass

    public init(soundAndHaptics: Bool = true, comfort: MotionComfort = .standard, supportsHaptics: Bool = true, device: DeviceClass = .iPhone) {
        self.soundAndHaptics = soundAndHaptics
        self.comfort = comfort
        self.supportsHaptics = supportsHaptics
        self.device = device
    }

    var juice: JuiceSettings { JuiceSettings(soundAndHaptics: soundAndHaptics, supportsHaptics: supportsHaptics, comfort: comfort) }
}

/// Everything the app reports for one frame.
public struct FrameInput: Sendable {
    /// Seconds, monotonic: the ARFrame's timestamp.
    public var time: Double
    public var camera: CameraState
    /// Each body's pose and velocity as the physics engine has them now.
    public var bodies: [BodyID: BodyMotion]
    /// Collision reports since the last frame.
    public var contacts: [Contact]
    /// Touches since the last frame, in order.
    public var touches: [TouchSample]
    public var thermal: ThermalLevel
    /// The lowest detected floor, world y, when ARKit has one.
    public var floorY: Double?

    public init(
        time: Double, camera: CameraState, bodies: [BodyID: BodyMotion] = [:], contacts: [Contact] = [],
        touches: [TouchSample] = [], thermal: ThermalLevel = .nominal, floorY: Double? = nil
    ) {
        self.time = time
        self.camera = camera
        self.bodies = bodies
        self.contacts = contacts
        self.touches = touches
        self.thermal = thermal
        self.floorY = floorY
    }
}

/// The render child of a body (plan §5.4): pop-in, lean, hit-stop and squash, in the body
/// entity's frame. Never the physics body.
public struct RenderState: Sendable, Equatable {
    /// Entity-local offset (hit-stop).
    public var translation: Vec3 = .zero
    /// Entity-local lean while held.
    public var rotation: Quat = .identity
    /// Uniform pop-in scale.
    public var scale: Double = 1
    /// Rotation taking +y to the squash axis, entity-local.
    public var squashAxis: Quat = .identity
    /// Scale in the squash axis's frame: (across, along, across); along × across² = 1.
    public var squash: Vec3 = Vec3(1, 1, 1)
    /// A merged mesh may replace instanced atoms now: at rest, or under 64 px (scale-spec §9.6).
    public var meshSwapAllowed: Bool = true
}

/// What happened, for the app's captions and the HUD.
public enum SessionEvent: Sendable, Equatable {
    case spawned(BodyID)
    case removed(BodyID, poof: Bool)
    /// A body broke into these pieces.
    case broke(BodyID, into: [BodyID])
    case detent(BodyID, readout: String)
    case selected(BodyID?)
    case refused(String)
}

/// What the app applies after a frame.
public struct FrameOutput: Sendable {
    public var physics: [PhysicsCommand] = []
    public var cut: Cut?
    /// The cut's body index → body.
    public var bodyOrder: [BodyID] = []
    public var renders: [BodyID: RenderState] = [:]
    public var juice: [JuiceCue] = []
    /// The play simulation's clock rate: 1, or slow motion (plan §5.4).
    public var simulationRate: Double = 1
    public var hud = HUDStats()
    public var events: [SessionEvent] = []

    public init() {}
}

/// Where a spawn appears.
public enum SpawnPlacement: Sendable, Equatable {
    /// Ahead of the camera, shifted sideways by this many metres (the receipt's row).
    case ahead(sideways: Double)
    /// At a world point (entity origin).
    case world(Vec3)
}

struct SpawnRequest: Sendable {
    var source: SpawnSource
    var placement: SpawnPlacement
}

struct GrabState: Sendable {
    var body: BodyID
    var depth: Double
    /// The grab point in the entity's frame, metres.
    var localPoint: Vec3
    /// The body's rotation while held.
    var rotation: Quat
    var follow: HoldFollow
    var estimator = ThrowEstimator()
    var touch: SIMD2<Double>
}

struct PinchState: Sendable {
    var body: BodyID
    var focus: Vec3
    var lastShapes: Double
    /// A resting body grows on its footprint and twists about the vertical (scale-spec §8.8).
    var resting: Bool
}

/// The receipt's dive into a crystal: σ glides about the camera toward a target (plan §8 M0).
struct Glide: Sendable {
    var body: BodyID
    var targetSigma: Double
    var start: Double
    var fromSigma: Double
    var duration: Double
    /// Put the body back ahead of the camera when the glide ends.
    var returnAhead: Bool
}

/// The play session (plan §3–§5, scale-spec §8–§10): bodies as LupiScale pieces, spawning,
/// grab and throw, pinch through the scale axis, breaks, juice and the cut, frame by frame.
/// Pure and deterministic for a given input stream; the app adapts RealityKit, ARKit and
/// SwiftUI to it.
public struct PlaySession: Sendable {
    public let catalog: Catalog
    public let store: GameStore
    public let resolver: Resolver
    public var settings: GameSettings {
        didSet { juice.director.settings = settings.juice }
    }

    public internal(set) var bodies: [BodyID: Body] = [:]
    public internal(set) var selection: BodyID?
    public internal(set) var lastCut: Cut?
    public internal(set) var time: Double?

    var nextID: UInt64 = 1
    var queue: [SpawnRequest] = []
    var arbiter = GestureArbiter()
    var grab: GrabState?
    var pinch: PinchState?
    var glide: Glide?
    var juice: JuiceRouter
    var tau: TauController
    var thermal: ThermalLevel = .nominal
    var slowMotionStart: Double?
    var cameraInsideTerrain = false
    var floorY: Double?
    var camera: CameraState?
    var hudCache = HUDCache()
    var frameStats = FrameStats()
    var lastOrder: [BodyID] = []
    var lastThrow: ThrowRelease?
    var lastImpact: LastImpact?
    var cutMs = 0.0
    /// Commands, cues and events gathered since the last frame was returned.
    var out = FrameOutput()

    public init(catalog: Catalog, settings: GameSettings = GameSettings()) {
        self.catalog = catalog
        self.settings = settings
        store = GameStore([SaltLadder.seedRecord])
        resolver = Resolver(store: store)
        juice = JuiceRouter(settings: settings.juice)
        tau = TauController(budgets: Self.budgets(settings.device, .nominal))
    }

    static func budgets(_ device: DeviceClass, _ thermal: ThermalLevel) -> Budgets {
        device == .iPad ? .iPadPro(thermal) : .iPhone15Pro(thermal)
    }

    /// This frame's budgets: the device's column at the current thermal level (scale-spec §9.3).
    public var budgets: Budgets { Self.budgets(settings.device, thermal) }

    /// Bodies in id order: the order the cut sees them in.
    public var bodyOrder: [BodyID] { bodies.keys.sorted() }

    public func body(_ id: BodyID) -> Body? { bodies[id] }

    /// Toys in play: the bodies the 40-body budget counts (plan §3.4).
    public var toys: Int { toyCount }

    // MARK: Requests from the UI

    /// Queues a spawn; at most one appears per frame (one merged-mesh build per frame, §9.3).
    public mutating func spawn(_ source: SpawnSource, at placement: SpawnPlacement = .ahead(sideways: 0)) {
        queue.append(SpawnRequest(source: source, placement: placement))
    }

    /// The scale receipt: salt of 10³, 10⁶ and 10⁹ atoms in a row on the desk (plan §8 M0).
    public mutating func spawnReceipt() {
        for (i, rung) in ReceiptRung.allCases.enumerated() {
            spawn(.salt(rung), at: .ahead(sideways: (Double(i) - 1) * 0.2))
        }
    }

    public mutating func select(_ id: BodyID?) {
        selection = id.flatMap { bodies[$0] != nil ? $0 : nil }
        out.events.append(.selected(selection))
    }

    /// Poofs every body.
    public mutating func clear() {
        for id in bodyOrder { remove(id, poof: true) }
        queue.removeAll()
        grab = nil
        pinch = nil
        glide = nil
        arbiter.reset()
    }

    // MARK: The frame

    /// One frame. Requests made since the last frame (spawns, a dive, clearing) land in this
    /// frame's output with everything the frame itself decides.
    public mutating func step(_ input: FrameInput) -> FrameOutput {
        let dt = time.map { min(0.1, max(0, input.time - $0)) } ?? 0
        time = input.time
        camera = input.camera
        floorY = input.floorY ?? floorY
        if input.thermal != thermal {
            thermal = input.thermal
            tau.minimum = Self.budgets(settings.device, thermal).tauMinimum
        }
        frameStats.frame(time: input.time, dt: dt)

        adoptMotions(input.bodies)
        handleContacts(input.contacts, now: input.time)
        handleTouches(input.touches, now: input.time)
        for g in arbiter.tick(input.time) { handle(g, now: input.time) }
        stepGrab(dt: dt, now: input.time)
        stepGlide(now: input.time)
        stepBodies(dt: dt, now: input.time)
        dequeueSpawn(now: input.time)
        rescue()
        updateTerrain()
        buildCut(dt: dt, now: input.time)
        out.renders = renderStates(dt: dt)
        out.simulationRate = simulationRate(now: input.time)
        out.hud = hud()
        let result = out
        out = FrameOutput()
        return result
    }

    func simulationRate(now: Double) -> Double {
        guard let start = slowMotionStart, settings.comfort.allowsTimeEffects else { return 1 }
        let elapsed = now - start
        return elapsed >= SlowMotion.hold + SlowMotion.easeBack ? 1 : SlowMotion.rate(at: elapsed)
    }

    // MARK: Ids

    mutating func newID() -> BodyID {
        defer { nextID += 1 }
        return BodyID(nextID)
    }
}
