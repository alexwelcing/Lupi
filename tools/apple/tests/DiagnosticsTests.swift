import Foundation

@main
struct DiagnosticsTests {
    static func main() throws {
        if CommandLine.arguments.count == 4 {
            let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
            let identity = BuildIdentity.load(data: data, version: "0.1.0", build: "1")
            let expectedRevision = CommandLine.arguments[2]
            precondition(identity.revision == (expectedRevision == "null" ? nil : expectedRevision))
            precondition(identity.workTree.rawValue == CommandLine.arguments[3])
            precondition(identity.builtAt != nil)
            return
        }

        let unavailable = BuildIdentity.load(data: nil, version: "0.1.0", build: "1")
        precondition(unavailable.revision == nil && unavailable.workTree == .unknown)
        precondition(unavailable.revisionLabel == "Unavailable")
        let malformed = Data("{\"schemaVersion\":1,\"revision\":\"private-account-secret\",\"workTree\":\"clean\",\"builtAt\":\"invalid\"}".utf8)
        let refused = BuildIdentity.load(data: malformed, version: "account-secret", build: "1")
        precondition(refused.revision == nil && refused.builtAt == nil && refused.version == "unavailable")
        precondition(!refused.diagnosticText.contains("secret"))
        let oldSchema = Data("{\"schemaVersion\":2,\"revision\":null,\"workTree\":\"clean\",\"builtAt\":null}".utf8)
        precondition(BuildIdentity.load(data: oldSchema).workTree == .unknown)

        let start = Date(timeIntervalSince1970: 1_000)
        var recorder = SessionReceiptRecorder(build: unavailable, device: SessionDeviceInfo(model: "iPhone", osVersion: "26.5"), at: start)
        recorder.recordStage(.keep, at: start.addingTimeInterval(1))
        recorder.recordSave(.collection, outcome: .failed, at: start.addingTimeInterval(2))
        for i in 0..<700 {
            recorder.recordSample(SessionSample(at: start.addingTimeInterval(Double(i)), stage: recorder.stage,
                                               bodies: 3, atomCountDisplay: "10^(10^100) − 1,000", fps: 60,
                                               lastImpulse: 0.3, lastDeltaV: 1.2, lastThrowSpeed: 2.4,
                                               thermal: .fair, tracking: .normal, mapping: .mapped))
        }
        precondition(recorder.samples.count == SessionReceiptRecorder.maximumSamples && recorder.droppedSamples == 100)
        precondition(recorder.events.contains { $0.saveKind == .collection && $0.saveOutcome == .failed })
        let json = try recorder.receipt(at: start.addingTimeInterval(700)).json()
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(SessionReceipt.self, from: Data(json.utf8))
        precondition(decoded.samples.first?.atomCountDisplay == "10^(10^100) − 1,000")
        precondition(decoded.events.last?.saveOutcome == .failed)
        precondition(decoded.droppedSamples == 100 && decoded.build.revision == nil)
        precondition(decoded.samples.last?.lastImpulse == 0.3 && decoded.samples.last?.lastThrowSpeed == 2.4)
        precondition(decoded.text.contains("collection: failed"))
        precondition(decoded.text.contains("throw 2.40 m/s"))
        for i in 0..<150 { recorder.recordStage(.thermal, at: start.addingTimeInterval(Double(i))) }
        precondition(recorder.events.count == SessionReceiptRecorder.maximumEvents && recorder.droppedEvents == 53)

        let invalid = SessionSample(stage: .scaleReceipt, bodies: -1, atomCountDisplay: "room-address-secret", fps: .nan,
                                    worstFrameMs: .infinity, cutMs: -1,
                                    lastImpulse: .nan, lastDeltaV: .infinity, lastThrowSpeed: -3)
        precondition(invalid.bodies == 0 && invalid.atomCountDisplay == nil && invalid.fps == nil && invalid.worstFrameMs == nil && invalid.cutMs == nil)
        precondition(invalid.lastImpulse == nil && invalid.lastDeltaV == nil && invalid.lastThrowSpeed == nil)
        for notation in ["1,000", "10^100", "3 × 2^100", "10^(10^100) − 1,000", "≈ 1.235 × 10^40", "10³ + 10⁶ + 10⁹"] {
            precondition(SessionSample(stage: .scaleReceipt, atomCountDisplay: notation).atomCountDisplay == notation)
        }
        recorder.recordSample(SessionSample(stage: .scaleReceipt, atomCountDisplay: "≈ 1.235 × 10^40"))
        let approximate = try decoder.decode(SessionReceipt.self, from: Data(recorder.receipt().json().utf8))
        precondition(approximate.samples.last?.atomCountDisplay == "≈ 1.235 × 10^40")
        precondition(approximate.text.contains("atom count display ≈ 1.235 × 10^40"))
        precondition(!json.contains("exactAtoms"))
        precondition(SessionDeviceInfo(model: "private\nroom", osVersion: "26").model == "unavailable")
        recorder.recordSample(invalid)
        _ = try recorder.receipt().json()
        print("Native diagnostics tests passed: stamp fallback, bounded history, save outcomes, count notation, invalid metrics and JSON round trip.")
    }
}
