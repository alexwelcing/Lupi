// Stand-in for the Core Haptics the app uses, spelled as developer.apple.com documents it.
import Foundation
public protocol CHHapticDeviceCapability { var supportsHaptics: Bool { get } }
struct Caps: CHHapticDeviceCapability { var supportsHaptics: Bool { true } }
public let CHHapticTimeImmediate: TimeInterval = 0
public protocol CHHapticPatternPlayer { func start(atTime time: TimeInterval) throws }
struct Player: CHHapticPatternPlayer { func start(atTime time: TimeInterval) throws {} }
open class CHHapticEngine {
    public enum StoppedReason: Int, Sendable { case audioSessionInterrupt }
    public typealias StoppedHandler = @Sendable (StoppedReason) -> Void
    public typealias ResetHandler = @Sendable () -> Void
    public class func capabilitiesForHardware() -> any CHHapticDeviceCapability { Caps() }
    public init() throws {}
    open var isAutoShutdownEnabled = false
    open var stoppedHandler: StoppedHandler = { _ in }
    open var resetHandler: ResetHandler = {}
    open func start() throws {}
    open func makePlayer(with pattern: CHHapticPattern) throws -> any CHHapticPatternPlayer { Player() }
}
open class CHHapticEvent {
    public struct EventType: Sendable { public static let hapticTransient = EventType(); public static let hapticContinuous = EventType() }
    public struct ParameterID: Sendable { public static let hapticIntensity = ParameterID(); public static let hapticSharpness = ParameterID() }
    public init(eventType type: EventType, parameters eventParams: [CHHapticEventParameter], relativeTime time: TimeInterval) {}
    public init(eventType type: EventType, parameters eventParams: [CHHapticEventParameter], relativeTime time: TimeInterval, duration: TimeInterval) {}
}
open class CHHapticEventParameter {
    public init(parameterID: CHHapticEvent.ParameterID, value: Float) {}
}
public struct CHHapticDynamicParameterID: Sendable { public static let hapticIntensityControl = CHHapticDynamicParameterID() }
open class CHHapticParameterCurve {
    open class ControlPoint { public init(relativeTime time: TimeInterval, value: Float) {} }
    public init(parameterID: CHHapticDynamicParameterID, controlPoints: [ControlPoint], relativeTime: TimeInterval) {}
}
open class CHHapticPattern {
    public init(events: [CHHapticEvent], parameterCurves: [CHHapticParameterCurve]) throws {}
}
