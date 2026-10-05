import Foundation
import LupiChem
import LupiScale

/// ARKit's tracking state, as the recovery ladder reads it.
public enum TrackingInput: String, Sendable, Equatable, Codable {
    case normal, relocalizing, limited, notAvailable
}

/// `ARFrame.WorldMappingStatus`.
public enum MappingInput: String, Sendable, Equatable, Codable {
    case notAvailable, limited, extending, mapped

    /// A map is saved only at these (apple-ar-platform.md §2.1).
    public var isSavable: Bool { self == .extending || self == .mapped }
}

/// What the recovery ladder asks of the app.
public enum RecoveryEvent: Sendable, Equatable {
    /// The session matched the map (step 2).
    case relocalized(after: Double)
    /// No match yet: offer "Put the shelf here" and "Start a new room" (steps 3 and 4).
    case offerPutHere
    /// Put the shelf's trophies out at their placements under this root, with the soft chime.
    case trophiesAppear(root: RigidD)
    /// The root was placed by hand: the app adds the new root anchor and records its id.
    case rootPlaced(RigidD)
    /// Save the map now (after every successful relocalization, and a placed root).
    case saveMap
}

/// The recovery ladder (plan §6.4): a shelf opened from its map hides its trophies while the
/// session relocalizes and shows the snapshot; a match brings them back; after 20 s without
/// one the player may put the shelf somewhere by hand or start a new room. The Cabinet and its
/// spawns stay available throughout, so a failed match never looks like a lost trophy.
public struct ShelfRecovery: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// No shelf yet: the first pin makes one.
        case idle
        /// Run from the shelf's map; the trophies wait (step 1).
        case relocalizing
        /// No match after 20 s (step 3), or the map is missing.
        case offering
        /// "Put the shelf here" chosen: the next tap on a surface places the root.
        case placing
        /// Matched or placed: the trophies are out.
        case shown
    }

    /// To tune on the device: the research has no number (plan §6.4).
    public static let offerAfter = 20.0
    /// Tracking can read normal a moment before ARKit restores the saved anchors.
    public static let anchorGrace = 3.0

    public private(set) var phase: Phase = .idle
    /// When the current phase began.
    public private(set) var since: Double?
    public private(set) var root: RigidD?
    var startedAt: Double?
    var normalSince: Double?

    public init() {}

    public var trophiesVisible: Bool { phase == .shown }
    /// The snapshot's small ghost card: "Look at your shelf".
    public var showsGhost: Bool { phase == .relocalizing || phase == .offering || phase == .placing }
    public var offersPutHere: Bool { phase == .offering }

    /// The session was run from the shelf's map.
    public mutating func begin(at t: Double) {
        phase = .relocalizing
        since = t
        startedAt = t
        root = nil
        normalSince = nil
    }

    /// The shelf has no map that loads: go straight to placing it by hand.
    public mutating func beginWithoutMap(at t: Double) -> [RecoveryEvent] {
        phase = .offering
        since = t
        startedAt = t
        root = nil
        return [.offerPutHere]
    }

    /// The first pin of a session without a shelf made one at `root`.
    public mutating func created(root: RigidD, at t: Double) {
        phase = .shown
        since = t
        self.root = root
    }

    /// Each frame: the tracking state and, when the session has it, the root anchor's pose.
    public mutating func frame(at t: Double, tracking: TrackingInput, rootAnchor: RigidD?) -> [RecoveryEvent] {
        switch phase {
        case .idle:
            return []
        case .shown:
            if let rootAnchor { root = rootAnchor }
            return []
        case .relocalizing, .offering, .placing:
            if tracking == .normal, let rootAnchor {
                let waited = t - (startedAt ?? t)
                phase = .shown
                since = t
                root = rootAnchor
                return [.relocalized(after: waited), .trophiesAppear(root: rootAnchor), .saveMap]
            }
            normalSince = tracking == .normal ? (normalSince ?? t) : nil
            guard phase == .relocalizing else { return [] }
            let anchorLost = normalSince.map { t - $0 >= Self.anchorGrace } ?? false
            if t - (since ?? t) >= Self.offerAfter || anchorLost {
                phase = .offering
                since = t
                return [.offerPutHere]
            }
            return []
        }
    }

    /// "Put the shelf here" (step 3); available while the trophies wait.
    public mutating func choosePutHere(at t: Double) {
        guard showsGhost else { return }
        phase = .placing
        since = t
    }

    /// The tap after "Put the shelf here": the root moves there, with the whole arrangement.
    public mutating func place(root: RigidD, at t: Double) -> [RecoveryEvent] {
        guard phase == .placing else { return [] }
        phase = .shown
        since = t
        self.root = root
        return [.rootPlaced(root), .trophiesAppear(root: root), .saveMap]
    }

    /// "Start a new room" (step 4): the old shelf stays on the device until deleted.
    public mutating func startNewRoom() {
        self = ShelfRecovery()
    }
}

/// When to save a shelf's map (plan §6.3): 5 s after the last pin, at once after a match or a
/// placed root, and only while the mapping status allows it. While a save waits on mapping,
/// the app asks the player to look around the shelf.
public struct MapSavePolicy: Sendable, Equatable {
    public static let debounce = 5.0
    /// Ask for coverage once a due save has waited this long on mapping.
    public static let coachAfter = 2.0

    public private(set) var dueAt: Double?
    public private(set) var saving = false

    public init() {}

    public mutating func pinned(at t: Double) { dueAt = t + Self.debounce }

    public mutating func saveSoon(at t: Double) { dueAt = min(dueAt ?? t, t) }

    public func shouldSave(at t: Double, mapping: MappingInput) -> Bool {
        !saving && (dueAt.map { t >= $0 } ?? false) && mapping.isSavable
    }

    /// "Look around the shelf so I can remember it".
    public func needsCoverage(at t: Double, mapping: MappingInput) -> Bool {
        !mapping.isSavable && (dueAt.map { t >= $0 + Self.coachAfter } ?? false)
    }

    public mutating func began() { saving = true }

    public mutating func finished(at t: Double, saved: Bool) {
        saving = false
        dueAt = saved ? nil : t + Self.debounce
    }
}

/// Spike A1's instrumentation (plan §8 M0, §10): does a world map saved under RealityView with
/// our own ARSession relocalize, how long does it take, does RealityView keep drawing our
/// session meanwhile, and how far does the root anchor move once found. One line per event,
/// for the debug panel and a log the owner can read off the device.
public struct A1Probe: Sendable, Equatable {
    public struct Entry: Codable, Sendable, Equatable {
        /// Seconds since the probe's first event.
        public var t: Double
        public var event: String
        public var detail: String
    }

    public private(set) var entries: [Entry] = []
    var origin: Double?
    var runAt: Double?
    var tracking: TrackingInput?
    var mapping: MappingInput?
    var framesWhileRelocalizing = 0
    var rootFound: RigidD?
    var maxDrift = 0.0

    public init() {}

    mutating func log(_ t: Double, _ event: String, _ detail: String = "") {
        let start = origin ?? t
        origin = start
        entries.append(Entry(t: ((t - start) * 1000).rounded() / 1000, event: event, detail: detail))
    }

    /// The session was run from a saved map.
    public mutating func run(at t: Double, mapBytes: Int, anchors: Int) {
        runAt = t
        framesWhileRelocalizing = 0
        rootFound = nil
        maxDrift = 0
        log(t, "run", "map \(mapBytes / 1024) KB, \(anchors) anchors")
    }

    public mutating func loadFailed(at t: Double, reason: String) { log(t, "load failed", reason) }

    /// Each frame RealityView drew: the states, and the root anchor once the session has it.
    public mutating func frame(at t: Double, tracking: TrackingInput, mapping: MappingInput, root: RigidD?) {
        if tracking != self.tracking {
            log(t, "tracking", tracking.rawValue + (runAt.map { String(format: " after %.1f s", t - $0) } ?? ""))
            self.tracking = tracking
        }
        if mapping != self.mapping {
            log(t, "mapping", mapping.rawValue)
            self.mapping = mapping
        }
        if tracking == .relocalizing { framesWhileRelocalizing += 1 }
        guard let root else { return }
        if let first = rootFound {
            let drift = (root.translation - first.translation).length
            if drift > maxDrift + 0.005 {
                maxDrift = drift
                log(t, "root drift", String(format: "%.1f cm", drift * 100))
            }
        } else {
            rootFound = root
            log(t, "root anchor", (runAt.map { String(format: "after %.1f s, ", t - $0) } ?? "") + "\(framesWhileRelocalizing) frames drawn while relocalizing")
        }
    }

    public mutating func saved(at t: Double, bytes: Int, milliseconds: Double, mapping: MappingInput, anchors: Int) {
        log(t, "saved", String(format: "%d KB in %.0f ms at %@, %d anchors", bytes / 1024, milliseconds, mapping.rawValue, anchors))
    }

    public mutating func saveFailed(at t: Double, reason: String) { log(t, "save failed", reason) }

    public mutating func note(at t: Double, _ text: String) { log(t, "note", text) }

    /// The last `n` events as HUD lines: "A1 12.4 s tracking normal after 3.2 s".
    public func lines(_ n: Int = 8) -> [String] {
        entries.suffix(n).map { e in
            "A1 " + String(format: "%.1f s ", e.t) + e.event + (e.detail.isEmpty ? "" : " " + e.detail)
        }
    }

    /// The whole log as JSON lines, for the owner to copy off the device.
    public func jsonLines() -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return entries.compactMap { (try? encoder.encode($0)).map { String(decoding: $0, as: UTF8.self) } }.joined(separator: "\n")
    }
}
