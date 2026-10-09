// Stand-in for the Core Media clock types, as developer.apple.com documents them.
public final class CMClock: @unchecked Sendable {
    public static var hostTimeClock: CMClock { CMClock() }
}
public final class CMTimebase: @unchecked Sendable {
    public init(sourceClock: CMClock) throws {}
    public func setRate(_ rate: Double) throws {}
}
// Documented as `typealias CMClockOrTimebase = CFTypeRef`, which Swift imports as AnyObject.
public typealias CMClockOrTimebase = AnyObject
