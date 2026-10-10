@preconcurrency import ARKit
import Foundation
import LupiGame
import Observation
import UIKit

/// Collects only a whitelisted scalar snapshot. ARFrames, poses, names and camera images never stay here.
@MainActor
@Observable
final class PlaySessionDiagnostics {
    private(set) var receiptStage: SessionStage = .roomScan
    @ObservationIgnored private var recorder: SessionReceiptRecorder
    @ObservationIgnored private var latestSnapshot: SessionSample?
    @ObservationIgnored private var lastRecordedAt: Date?
    @ObservationIgnored private var lastSampleUptime: TimeInterval?
    @ObservationIgnored private var captureNextFrame = true

    init() {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        #if targetEnvironment(simulator)
        let model = "Simulator (\(UIDevice.current.model))"
        #else
        let model = UIDevice.current.model
        #endif
        recorder = SessionReceiptRecorder(device: SessionDeviceInfo(
            model: model, osVersion: "iOS \(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        ))
    }

    /// Call independently of HUD visibility, with the frame's uptime. Nil HUD means unavailable metrics.
    /// The bounded history captures every five seconds, plus the next frame after stage/save events.
    func sample(hud: HUDStats?, frame: ARFrame?, now: TimeInterval) {
        guard now.isFinite else { return }
        let snapshot = SessionSample(
            at: Date(), stage: receiptStage,
            bodies: hud?.bodies, toys: hud?.toys, atomCountDisplay: hud?.totalAtoms,
            drawnAtoms: hud?.drawnAtoms, items: hud?.items, visited: hud?.visited, overBudget: hud?.overBudget,
            fps: hud?.fps, worstFrameMs: hud?.worstFrameMs, cutMs: hud?.cutMs,
            lastImpulse: hud?.lastImpulse, lastDeltaV: hud?.lastDeltaV, lastThrowSpeed: hud?.lastThrowSpeed,
            thermal: Self.actualThermal, policyThermal: hud.map { Self.policyThermal($0) },
            tracking: frame.map { Self.tracking($0.camera.trackingState) } ?? .notAvailable,
            mapping: frame.map { Self.mapping($0.worldMappingStatus) } ?? .notAvailable
        )
        latestSnapshot = snapshot
        guard captureNextFrame || lastSampleUptime.map({ now - $0 >= 5 || now < $0 }) ?? true else { return }
        recorder.recordSample(snapshot)
        lastRecordedAt = snapshot.at
        lastSampleUptime = now
        captureNextFrame = false
    }

    func recordStage(_ stage: SessionStage) {
        receiptStage = stage
        recorder.recordStage(stage)
        captureNextFrame = true
    }

    func recordSave(_ kind: SessionSaveKind, outcome: SessionSaveOutcome) {
        recorder.recordSave(kind, outcome: outcome)
        captureNextFrame = true
    }

    /// Includes the most recently captured scalar snapshot with its original capture timestamp.
    /// Exporting does not pretend that old measurements were freshly observed.
    func json() throws -> String {
        var export = recorder
        if let latestSnapshot, latestSnapshot.at != lastRecordedAt { export.recordSample(latestSnapshot) }
        return try export.receipt().json()
    }

    private static var actualThermal: SessionThermalState {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: .nominal
        case .fair: .fair
        case .serious: .serious
        case .critical: .critical
        @unknown default: .unknown
        }
    }

    private static func policyThermal(_ hud: HUDStats) -> SessionThermalState {
        switch hud.thermal {
        case .nominal: .nominal
        case .fair: .fair
        case .serious: .serious
        case .critical: .critical
        }
    }

    private static func tracking(_ state: ARCamera.TrackingState) -> SessionTrackingState {
        switch state {
        case .normal: .normal
        case .notAvailable: .notAvailable
        case let .limited(reason):
            switch reason {
            case .initializing: .initializing
            case .relocalizing: .relocalizing
            case .excessiveMotion: .excessiveMotion
            case .insufficientFeatures: .insufficientFeatures
            @unknown default: .limited
            }
        }
    }

    private static func mapping(_ state: ARFrame.WorldMappingStatus) -> SessionMappingState {
        switch state {
        case .notAvailable: .notAvailable
        case .limited: .limited
        case .extending: .extending
        case .mapped: .mapped
        @unknown default: .unknown
        }
    }
}
