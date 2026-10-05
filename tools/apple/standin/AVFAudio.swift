// Stand-in for the AVFAudio calls the app makes, spelled as developer.apple.com documents them.
import Foundation
open class AVAudioSession {
    public struct Category: Sendable { public static let ambient = Category() }
    public struct Mode: Sendable { public static let `default` = Mode() }
    public struct CategoryOptions: OptionSet, Sendable { public let rawValue: UInt; public init(rawValue: UInt) { self.rawValue = rawValue }; public static let mixWithOthers = CategoryOptions(rawValue: 1) }
    public class func sharedInstance() -> AVAudioSession { AVAudioSession() }
    open func setCategory(_ category: Category, mode: Mode, options: CategoryOptions = []) throws {}
    open func setActive(_ active: Bool) throws {}
}
public typealias AVAudioFrameCount = UInt32
open class AVAudioFormat {
    public init?(standardFormatWithSampleRate sampleRate: Double, channels: UInt32) {}
}
open class AVAudioBuffer {}
open class AVAudioPCMBuffer: AVAudioBuffer {
    public init?(pcmFormat format: AVAudioFormat, frameCapacity: AVAudioFrameCount) {}
    open var frameLength: AVAudioFrameCount = 0
    open var floatChannelData: UnsafePointer<UnsafeMutablePointer<Float>>? { nil }
}
