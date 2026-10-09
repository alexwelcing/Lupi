@preconcurrency import ARKit
import CoreImage
import Foundation
import LupiChem
import LupiData
import LupiGame
import LupiScale
import UIKit

/// What the play screen shows about the shelf (plan §6.4).
enum ShelfPrompt: Equatable {
    /// Step 1: the shelf's trophies wait; the snapshot shows as a small ghost card.
    case lookAtShelf
    /// Steps 3 and 4: no match yet.
    case offer
    /// The next tap on a surface puts the shelf there.
    case placing
    /// A map save waits on mapping (plan §6.3).
    case coverage
}

/// The room's shelf in play (plan §6.3, §6.4): the `lupi.shelf.v1` record, its root anchor and
/// world map, the recovery ladder, map saves and spike A1's probe. The decisions are LupiGame's;
/// this owns the ARKit objects and the files.
@MainActor
final class ShelfHost {
    let store: ShelfStore
    private(set) var shelf: ShelfRecord?
    private(set) var ladder = ShelfRecovery()
    private(set) var mapPolicy = MapSavePolicy()
    private(set) var probe = A1Probe()
    private(set) var snapshot: UIImage?
    private(set) var mapping: MappingInput = .notAvailable

    init(store: ShelfStore) {
        self.store = store
    }

    /// The room opened last, and the world map to run the session from (plan §6.3).
    func openLastRoom(now: Double) -> (map: ARWorldMap?, events: [RecoveryEvent]) {
        guard let id = store.lastUsed, let room = try? store.load(id) else { return (nil, []) }
        shelf = room
        snapshot = store.snapshot(of: room).flatMap { UIImage(data: $0) }
        guard let data = store.map(of: room) else {
            probe.loadFailed(at: now, reason: "no saved map")
            return (nil, ladder.beginWithoutMap(at: now))
        }
        do {
            guard let map = try NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: data) else {
                throw CocoaError(.coderReadCorrupt)
            }
            ladder.begin(at: now)
            probe.run(at: now, mapBytes: data.count, anchors: map.anchors.count)
            return (map, [])
        } catch {
            probe.loadFailed(at: now, reason: error.localizedDescription)
            return (nil, ladder.beginWithoutMap(at: now))
        }
    }

    /// Each frame: the ladder's steps and whether a map save is due.
    func frame(_ frame: ARFrame, now: Double) -> [RecoveryEvent] {
        let tracking = TrackingInput(frame.camera.trackingState)
        mapping = MappingInput(frame.worldMappingStatus)
        let root = shelf.flatMap { s in frame.anchors.first { $0.identifier == s.rootAnchorId } }.map { RigidD($0.transform) }
        probe.frame(at: now, tracking: tracking, mapping: mapping, root: root)
        return ladder.frame(at: now, tracking: tracking, rootAnchor: root)
    }

    var prompt: ShelfPrompt? {
        switch ladder.phase {
        case .relocalizing: return .lookAtShelf
        case .offering: return .offer
        case .placing: return .placing
        case .idle, .shown: return nil
        }
    }

    func needsCoverage(now: Double) -> Bool { mapPolicy.needsCoverage(at: now, mapping: mapping) }

    /// Pins can join a shelf only once it is found, or before a room has one.
    var acceptsPins: Bool { ladder.phase == .idle || ladder.phase == .shown }

    // MARK: Pinning (plan §6.3)

    /// The first pin of a session without a shelf makes one, its root at the support point.
    func ensureShelf(support: Vec3, camera: Vec3, ar: ARHost, now: Double) throws -> RigidD {
        if let root = ladder.root, shelf != nil, ladder.phase == .shown { return root }
        let root = ShelfMath.rootPose(at: support, camera: camera)
        let anchor = ar.addAnchor(named: ShelfRecord.rootAnchorName, at: root)
        shelf = try store.create(rootAnchorId: anchor, at: Date())
        ladder.created(root: root, at: now)
        return root
    }

    /// Places a kept body on the shelf: false when the shelf already holds 60 others.
    func place(trophy: UUID, pose: KeptPose, root: RigidD, now: Double) throws -> Bool {
        guard let id = shelf?.id else { return false }
        let placement = ShelfMath.placement(trophy: trophy, pose: pose, root: root, at: Date())
        switch try store.pin(placement, on: id, at: Date()) {
        case let .pinned(updated):
            shelf = updated
            mapPolicy.pinned(at: now)
            return true
        case .full:
            return false
        }
    }

    // MARK: The ladder's steps

    func offerNow(now: Double) -> [RecoveryEvent] { ladder.offerNow(at: now) }

    func choosePutHere(now: Double) { ladder.choosePutHere(at: now) }

    /// "Put the shelf here": the root moves to the tapped surface with the whole arrangement.
    func place(root: RigidD, ar: ARHost, now: Double) -> [RecoveryEvent] {
        let events = ladder.place(root: root, at: now)
        guard !events.isEmpty, var room = shelf else { return events }
        ar.removeAnchor(room.rootAnchorId)
        room.rootAnchorId = ar.addAnchor(named: ShelfRecord.rootAnchorName, at: root)
        room.updatedAt = Date()
        try? store.save(room)
        shelf = room
        probe.note(at: now, "root placed by hand")
        return events
    }

    /// "Start a new room" (step 4): the old shelf stays on the device until deleted.
    func startNewRoom(ar: ARHost) {
        if let room = shelf { ar.removeAnchor(room.rootAnchorId) }
        shelf = nil
        snapshot = nil
        ladder.startNewRoom()
        mapPolicy = MapSavePolicy()
    }

    func saveSoon(now: Double) { mapPolicy.saveSoon(at: now) }

    /// Where each placement's trophy goes under `root`, at the size it was pinned at.
    func placements(under root: RigidD, trophies: [UUID: TrophyRecord]) -> [(TrophyRecord, RigidD)] {
        (shelf?.placements ?? []).compactMap { p in
            guard var trophy = trophies[p.trophyId] else { return nil }
            // The placement's own size wins: a display copy, never saved.
            if p.transform.scale > 0, trophy.molecule.source != .scale {
                trophy.look.scale = p.transform.scale
            } else if let span = p.spanMetres {
                trophy.molecule.scale?.spanMetres = span
            }
            return (trophy, ShelfMath.worldPose(p.transform, root: root))
        }
    }

    // MARK: Saving the map (plan §6.3)

    /// Saves the map and a snapshot when the policy says so; never two at once.
    func saveIfDue(ar: ARHost, frame: ARFrame, now: Double) {
        guard mapPolicy.shouldSave(at: now, mapping: mapping), let room = shelf else { return }
        mapPolicy.began()
        let status = mapping
        let started = ProcessInfo.processInfo.systemUptime
        let pixels = PixelBox(buffer: frame.capturedImage)
        Task {
            do {
                let map = try await ar.session.currentWorldMap()
                let anchors = map.anchors.count
                let box = MapBox(map: map)
                let data = try await Task.detached(priority: .utility) {
                    try NSKeyedArchiver.archivedData(withRootObject: box.map, requiringSecureCoding: true)
                }.value
                let jpeg = await Task.detached(priority: .utility) { pixels.jpeg() }.value
                var saved = shelf?.id == room.id ? (shelf ?? room) : room
                try store.saveMap(data, shelf: &saved, status: status.rawValue, at: Date())
                if let jpeg {
                    try store.saveSnapshot(jpeg, shelf: &saved)
                    snapshot = UIImage(data: jpeg)
                }
                if shelf?.id == saved.id { shelf = saved }
                let ms = (ProcessInfo.processInfo.systemUptime - started) * 1000
                probe.saved(at: ProcessInfo.processInfo.systemUptime, bytes: data.count, milliseconds: ms, mapping: status, anchors: anchors)
                mapPolicy.finished(at: ProcessInfo.processInfo.systemUptime, saved: true)
            } catch {
                probe.saveFailed(at: ProcessInfo.processInfo.systemUptime, reason: error.localizedDescription)
                mapPolicy.finished(at: ProcessInfo.processInfo.systemUptime, saved: false)
            }
        }
    }

    /// Spike A1 from the debug panel: run the session again from the saved map, to watch it
    /// relocalize without leaving the app.
    func relocalizeFromSavedMap(ar: ARHost, now: Double) -> Bool {
        guard let room = shelf, let data = store.map(of: room),
              let map = try? NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: data) else {
            probe.note(at: now, "no saved map to relocalize from")
            return false
        }
        ar.rerun(worldMap: map)
        ladder = ShelfRecovery()
        ladder.begin(at: now)
        probe.run(at: now, mapBytes: data.count, anchors: map.anchors.count)
        probe.note(at: now, "re-run from the saved map (resetTracking, removeExistingAnchors)")
        return true
    }

    func note(_ text: String, now: Double) { probe.note(at: now, text) }
}

/// An `ARWorldMap` is immutable once ARKit hands it over, so it may be archived off the main actor.
private struct MapBox: @unchecked Sendable {
    let map: ARWorldMap
}

/// The camera image at a map save, for the ghost card: a quarter size, upright for portrait.
private struct PixelBox: @unchecked Sendable {
    let buffer: CVPixelBuffer

    func jpeg() -> Data? {
        let image = CIImage(cvPixelBuffer: buffer).oriented(.right).transformed(by: CGAffineTransform(scaleX: 0.25, y: 0.25))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        return CIContext().jpegRepresentation(of: image, colorSpace: space)
    }
}

extension TrackingInput {
    init(_ state: ARCamera.TrackingState) {
        switch state {
        case .normal: self = .normal
        case .notAvailable: self = .notAvailable
        case let .limited(reason):
            if case .relocalizing = reason { self = .relocalizing } else { self = .limited }
        }
    }
}

extension MappingInput {
    init(_ status: ARFrame.WorldMappingStatus) {
        switch status {
        case .notAvailable: self = .notAvailable
        case .limited: self = .limited
        case .extending: self = .extending
        case .mapped: self = .mapped
        @unknown default: self = .notAvailable
        }
    }
}
