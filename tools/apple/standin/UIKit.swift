@_exported import Foundation // as UIKit re-exports Foundation and CoreGraphics
open class UIColor: @unchecked Sendable {
    public init(red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {}
    public static var clear: UIColor { UIColor(red: 0, green: 0, blue: 0, alpha: 0) }
}
public enum UIUserInterfaceIdiom: Sendable { case phone, pad }
@MainActor open class UIDevice {
    public static var current: UIDevice { UIDevice() }
    public var userInterfaceIdiom: UIUserInterfaceIdiom { .phone }
}
@MainActor public enum UIAccessibility {
    public static var isReduceMotionEnabled: Bool { false }
}
public enum UIInterfaceOrientation: Int, Sendable { case unknown, portrait, portraitUpsideDown, landscapeLeft, landscapeRight }
open class UIImage: @unchecked Sendable {
    public init?(data: Data) {}
}
@MainActor open class UIPasteboard {
    public static var general: UIPasteboard { UIPasteboard() }
    open var string: String?
}
@MainActor open class UITouch: Hashable {
    open var timestamp: TimeInterval { 0 }
    open func location(in view: UIView?) -> CGPoint { .zero }
    nonisolated public static func == (a: UITouch, b: UITouch) -> Bool { a === b }
    nonisolated public func hash(into h: inout Hasher) { h.combine(ObjectIdentifier(self)) }
}
@MainActor open class UIEvent {}
@MainActor open class UIResponder {
    public init() {}
    open func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {}
    open func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {}
    open func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {}
    open func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {}
}
@MainActor open class UITraitCollection { public init() {}; open var displayScale: CGFloat { 3 } }
@MainActor open class UIWindowScene {
    public struct Geometry { public var interfaceOrientation: UIInterfaceOrientation { .portrait } }
    open var effectiveGeometry: Geometry { Geometry() }
}
@MainActor open class UIView: UIResponder {
    public convenience override init() { self.init(frame: .zero) }
    public init(frame: CGRect) { super.init() }
    public required init?(coder: NSCoder) { super.init() }
    open var bounds: CGRect = .zero
    open var isMultipleTouchEnabled = false
    open var backgroundColor: UIColor?
    open var window: UIWindow? { nil }
    open var traitCollection: UITraitCollection { UITraitCollection() }
    open func layoutSubviews() {}
    open func didMoveToWindow() {}
}
@MainActor open class UIWindow: UIView {
    open var windowScene: UIWindowScene? { nil }
}
@MainActor open class UIApplication: UIResponder {
    public struct OpenExternalURLOptionsKey: Hashable, Sendable { public let rawValue: String }
    public class var shared: UIApplication { UIApplication() }
    public static let openSettingsURLString: String = "app-settings:"
    open func open(_ url: URL, options: [OpenExternalURLOptionsKey: Any] = [:], completionHandler completion: (@MainActor @Sendable (Bool) -> Void)? = nil) {}
}
public struct UIAccessibilityTraits: OptionSet, Sendable {
    public let rawValue: UInt64
    public init(rawValue: UInt64) { self.rawValue = rawValue }
    public static let button = UIAccessibilityTraits(rawValue: 1)
    public static let adjustable = UIAccessibilityTraits(rawValue: 2)
    public static let allowsDirectInteraction = UIAccessibilityTraits(rawValue: 4)
    public static let updatesFrequently = UIAccessibilityTraits(rawValue: 8)
    public static let image = UIAccessibilityTraits(rawValue: 16)
}
// Foundation's LocalizedStringResource (iOS 16) is Darwin-only; stood in here.
public struct LocalizedStringResource: Hashable, Sendable, ExpressibleByStringLiteral {
    public let key: String
    public init(stringLiteral value: String) { key = value }
}
