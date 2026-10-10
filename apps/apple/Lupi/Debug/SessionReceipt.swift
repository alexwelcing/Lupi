import Foundation

/// Fixed labels prevent molecule queries, account notices or room names entering a receipt.
enum SessionStage: String, Codable, CaseIterable, Sendable {
    case roomScan, firstThrow, stack, breakApart, keep, reopen, scaleReceipt, buildFromAtoms, thermal, finish
}
enum SessionThermalState: String, Codable, Sendable { case nominal, fair, serious, critical, unknown }
enum SessionTrackingState: String, Codable, Sendable {
    case normal, initializing, relocalizing, excessiveMotion, insufficientFeatures, limited, notAvailable, unknown
}
enum SessionMappingState: String, Codable, Sendable { case notAvailable, limited, extending, mapped, unknown }
enum SessionSaveKind: String, Codable, Sendable { case collection, placement, worldMap }
enum SessionSaveOutcome: String, Codable, Sendable { case saved, failed, cancelled, staleIgnored }

struct SessionDeviceInfo: Codable, Equatable, Sendable {
    /// Hardware/family label only; never pass UIDevice.name or a device identifier.
    var model: String
    var osVersion: String

    init(model: String, osVersion: String) {
        self.model = Self.safe(model)
        self.osVersion = Self.safe(osVersion)
    }

    private static func safe(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " .,-_()"))
        guard !value.isEmpty, value.count <= 64, value.unicodeScalars.allSatisfy({ $0.isASCII && allowed.contains($0) }) else { return "unavailable" }
        return value
    }
}

/// A sample contains numeric diagnostics and count display notation, never poses or captured images.
struct SessionSample: Codable, Equatable, Sendable {
    var at: Date
    var stage: SessionStage
    var bodies: Int?
    var toys: Int?
    /// Preserves Magnitude.formatted, including ≈ when the displayed count is approximate.
    /// This is display text, not a canonical exact-count representation.
    var atomCountDisplay: String?
    var drawnAtoms: Int?
    var items: Int?
    var visited: Int?
    var overBudget: Bool?
    var fps: Double?
    var worstFrameMs: Double?
    var cutMs: Double?
    var lastImpulse: Double?
    var lastDeltaV: Double?
    var lastThrowSpeed: Double?
    var thermal: SessionThermalState
    /// The effective game policy may be a debug override; thermal above is the actual device state.
    var policyThermal: SessionThermalState?
    var tracking: SessionTrackingState
    var mapping: SessionMappingState

    init(at: Date = Date(), stage: SessionStage, bodies: Int? = nil, toys: Int? = nil,
         atomCountDisplay: String? = nil, drawnAtoms: Int? = nil, items: Int? = nil, visited: Int? = nil,
         overBudget: Bool? = nil, fps: Double? = nil, worstFrameMs: Double? = nil, cutMs: Double? = nil,
         lastImpulse: Double? = nil, lastDeltaV: Double? = nil, lastThrowSpeed: Double? = nil,
         thermal: SessionThermalState = .unknown, policyThermal: SessionThermalState? = nil,
         tracking: SessionTrackingState = .unknown,
         mapping: SessionMappingState = .unknown) {
        self.at = at
        self.stage = stage
        self.bodies = bodies.map { max(0, $0) }
        self.toys = toys.map { max(0, $0) }
        self.atomCountDisplay = Self.countNotation(atomCountDisplay)
        self.drawnAtoms = drawnAtoms.map { max(0, $0) }
        self.items = items.map { max(0, $0) }
        self.visited = visited.map { max(0, $0) }
        self.overBudget = overBudget
        self.fps = Self.measurement(fps)
        self.worstFrameMs = Self.measurement(worstFrameMs)
        self.cutMs = Self.measurement(cutMs)
        self.lastImpulse = Self.measurement(lastImpulse)
        self.lastDeltaV = Self.measurement(lastDeltaV)
        self.lastThrowSpeed = Self.measurement(lastThrowSpeed)
        self.thermal = thermal
        self.policyThermal = policyThermal
        self.tracking = tracking
        self.mapping = mapping
    }

    private static func measurement(_ value: Double?) -> Double? {
        guard let value, value.isFinite, value >= 0 else { return nil }
        return value
    }

    private static func countNotation(_ value: String?) -> String? {
        guard let value, !value.isEmpty, value.count <= 256 else { return nil }
        // Magnitude formatting: scientific notation, superscripts and separate tower families.
        let allowed = CharacterSet(charactersIn: "0123456789., +-−×≈^()[]⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻eE;")
        return value.unicodeScalars.allSatisfy { allowed.contains($0) } ? value : nil
    }
}

struct SessionReceiptEvent: Codable, Equatable, Sendable {
    var at: Date
    var stage: SessionStage
    var saveKind: SessionSaveKind?
    var saveOutcome: SessionSaveOutcome?
}

struct SessionReceipt: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let startedAt: Date
    let exportedAt: Date
    let build: BuildIdentity
    let device: SessionDeviceInfo
    let events: [SessionReceiptEvent]
    let samples: [SessionSample]
    let droppedEvents: Int
    let droppedSamples: Int

    func json() throws -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }

    var text: String {
        let date = ISO8601DateFormatter()
        var lines = [build.diagnosticText.trimmingCharacters(in: .newlines),
                     "Device: \(device.model), OS \(device.osVersion)",
                     "Session: \(date.string(from: startedAt))", "Exported: \(date.string(from: exportedAt))"]
        for event in events {
            let result = event.saveKind.flatMap { kind in event.saveOutcome.map { " \(kind.rawValue): \($0.rawValue)" } } ?? ""
            lines.append("\(date.string(from: event.at)) \(event.stage.rawValue)\(result)")
        }
        for sample in samples {
            let fps = sample.fps.map { String(format: "%.1f", $0) } ?? "unavailable"
            let frame = sample.worstFrameMs.map { String(format: "%.2f", $0) } ?? "unavailable"
            let cut = sample.cutMs.map { String(format: "%.2f", $0) } ?? "unavailable"
            let count: (Int?) -> String = { $0.map(String.init) ?? "unavailable" }
            let overBudget = sample.overBudget.map { String($0) } ?? "unavailable"
            var line = "\(date.string(from: sample.at)) \(sample.stage.rawValue): \(fps) fps, worst \(frame) ms, cut \(cut) ms; bodies \(count(sample.bodies)), toys \(count(sample.toys)), atom count display \(sample.atomCountDisplay ?? "unavailable"), drawn \(count(sample.drawnAtoms)), items \(count(sample.items)), visited \(count(sample.visited)), overBudget \(overBudget); thermal \(sample.thermal.rawValue), tracking \(sample.tracking.rawValue), map \(sample.mapping.rawValue)"
            if let policy = sample.policyThermal { line += "; policy thermal \(policy.rawValue)" }
            if let impulse = sample.lastImpulse { line += String(format: "; impulse %.4f N·s", impulse) }
            if let delta = sample.lastDeltaV { line += String(format: "; Δv %.2f m/s", delta) }
            if let speed = sample.lastThrowSpeed { line += String(format: "; throw %.2f m/s", speed) }
            lines.append(line)
        }
        if droppedEvents > 0 || droppedSamples > 0 { lines.append("Bounded history omitted \(droppedEvents) old events and \(droppedSamples) old samples.") }
        return lines.joined(separator: "\n") + "\n"
    }
}

/// In-memory diagnostics only. The caller samples at a modest cadence and exports on request.
/// Separate bounded histories keep frame samples from erasing stage and save outcomes.
struct SessionReceiptRecorder: Sendable {
    static let maximumSamples = 600
    static let maximumEvents = 100
    let build: BuildIdentity
    let device: SessionDeviceInfo
    let startedAt: Date
    private(set) var stage: SessionStage = .roomScan
    private(set) var samples: [SessionSample] = []
    private(set) var events: [SessionReceiptEvent] = []
    private(set) var droppedSamples = 0
    private(set) var droppedEvents = 0

    init(build: BuildIdentity = .current, device: SessionDeviceInfo, at: Date = Date()) {
        self.build = build
        self.device = device
        self.startedAt = at
        events = [SessionReceiptEvent(at: at, stage: .roomScan)]
    }

    mutating func recordStage(_ stage: SessionStage, at: Date = Date()) {
        self.stage = stage
        append(SessionReceiptEvent(at: at, stage: stage))
    }

    mutating func recordSave(_ kind: SessionSaveKind, outcome: SessionSaveOutcome, at: Date = Date()) {
        append(SessionReceiptEvent(at: at, stage: stage, saveKind: kind, saveOutcome: outcome))
    }

    mutating func recordSample(_ sample: SessionSample) {
        samples.append(sample)
        if samples.count > Self.maximumSamples {
            let excess = samples.count - Self.maximumSamples
            samples.removeFirst(excess)
            droppedSamples += excess
        }
    }

    func receipt(at: Date = Date()) -> SessionReceipt {
        SessionReceipt(schemaVersion: 1, startedAt: startedAt, exportedAt: at, build: build, device: device,
                       events: events, samples: samples, droppedEvents: droppedEvents, droppedSamples: droppedSamples)
    }

    private mutating func append(_ event: SessionReceiptEvent) {
        events.append(event)
        if events.count > Self.maximumEvents {
            let excess = events.count - Self.maximumEvents
            events.removeFirst(excess)
            droppedEvents += excess
        }
    }
}
