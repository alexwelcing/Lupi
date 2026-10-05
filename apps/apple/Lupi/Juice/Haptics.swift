@preconcurrency import CoreHaptics
import Foundation
import LupiPlay

/// Core Haptics for the juice director's events (plan §5.1). The engine starts only where the
/// hardware supports haptics: never on iPad, where sound and visuals carry everything.
@MainActor
final class Haptics {
    /// False on iPad, which has no haptic engine (plan §5.1).
    static var hardwareSupportsHaptics: Bool { CHHapticEngine.capabilitiesForHardware().supportsHaptics }

    let supported = Haptics.hardwareSupportsHaptics
    private var engine: CHHapticEngine?
    private var running = false

    init() {
        guard supported else { return }
        do {
            let engine = try CHHapticEngine()
            // The engine stops when idle, in the background or when audio is interrupted; the
            // next event starts it again.
            engine.isAutoShutdownEnabled = true
            engine.stoppedHandler = { [weak self] _ in Task { @MainActor in self?.running = false } }
            engine.resetHandler = { [weak self] in Task { @MainActor in self?.running = false } }
            self.engine = engine
        } catch {
            engine = nil
        }
    }

    func play(_ events: [HapticEvent]) {
        guard let engine, !events.isEmpty else { return }
        var list: [CHHapticEvent] = []
        var curves: [CHHapticParameterCurve] = []
        for event in events {
            switch event {
            case let .transient(time, intensity, sharpness):
                list.append(CHHapticEvent(
                    eventType: .hapticTransient,
                    parameters: [
                        CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(intensity)),
                        CHHapticEventParameter(parameterID: .hapticSharpness, value: Float(sharpness)),
                    ],
                    relativeTime: time
                ))
            case let .continuous(time, duration, intensity, endIntensity, sharpness):
                list.append(CHHapticEvent(
                    eventType: .hapticContinuous,
                    parameters: [
                        CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
                        CHHapticEventParameter(parameterID: .hapticSharpness, value: Float(sharpness)),
                    ],
                    relativeTime: time, duration: duration
                ))
                // The ramp from `intensity` to `endIntensity` (a break's rumble, a heavy body's tail).
                curves.append(CHHapticParameterCurve(
                    parameterID: .hapticIntensityControl,
                    controlPoints: [
                        CHHapticParameterCurve.ControlPoint(relativeTime: 0, value: Float(intensity)),
                        CHHapticParameterCurve.ControlPoint(relativeTime: duration, value: Float(endIntensity)),
                    ],
                    relativeTime: time
                ))
            }
        }
        do {
            if !running {
                try engine.start()
                running = true
            }
            let player = try engine.makePlayer(with: CHHapticPattern(events: list, parameterCurves: curves))
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            // A missed haptic is never worth an error.
        }
    }
}
