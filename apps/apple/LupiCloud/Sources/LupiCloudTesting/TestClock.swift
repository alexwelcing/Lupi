import Foundation

/// A settable clock for tests: `clock.now` is what the code under test sees.
public final class TestClock: @unchecked Sendable {
  private let lock = NSLock()
  private var current: Date

  public init(_ start: Date = Date(timeIntervalSince1970: 1_790_000_000)) {
    current = start
  }

  public var now: Date {
    lock.lock()
    defer { lock.unlock() }
    return current
  }

  public func advance(_ seconds: TimeInterval) {
    lock.lock()
    current = current.addingTimeInterval(seconds)
    lock.unlock()
  }

  public func set(_ date: Date) {
    lock.lock()
    current = date
    lock.unlock()
  }

  /// For `now:` parameters.
  public var function: @Sendable () -> Date { { [self] in self.now } }
}
