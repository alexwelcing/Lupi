// A permissive stand-in for the SwiftUI the app uses, spelled as developer.apple.com documents
// it. It checks the app's own names, types and isolation on Linux; it proves nothing about
// SwiftUI itself.
import Foundation
import Observation
import UIKit

@MainActor @preconcurrency public protocol View {
    associatedtype Body: View
    @ViewBuilder @MainActor var body: Body { get }
}
extension Never: View { public var body: Never { fatalError() } }
public struct EmptyView: View { nonisolated public init() {}; public var body: Never { fatalError() } }
public struct AnyV<C>: View { public var body: Never { fatalError() } }
public struct TupleView<T>: View { public var body: Never { fatalError() } }

@resultBuilder public enum ViewBuilder {
    public static func buildExpression<V: View>(_ v: V) -> V { v }
    public static func buildBlock() -> EmptyView { EmptyView() }
    public static func buildBlock<V: View>(_ v: V) -> V { v }
    public static func buildBlock<each V: View>(_ v: repeat each V) -> TupleView<(repeat each V)> { TupleView() }
    public static func buildOptional<V: View>(_ v: V?) -> AnyV<V> { AnyV() }
    public static func buildEither<A: View, B: View>(first: A) -> AnyV<(A, B)> { AnyV() }
    public static func buildEither<A: View, B: View>(second: B) -> AnyV<(A, B)> { AnyV() }
    public static func buildLimitedAvailability<V: View>(_ v: V) -> AnyV<V> { AnyV() }
}

public protocol ShapeStyle: Sendable {}
// As in SwiftUI, Color is a nonisolated Sendable struct whose View conformance is an extension.
public struct Color: ShapeStyle, Equatable {
    public init(red: Double, green: Double, blue: Double) {}
    public static let white = Color(red: 1, green: 1, blue: 1), black = Color(red: 0, green: 0, blue: 0), clear = Color(red: 0, green: 0, blue: 0)
    public func opacity(_ o: Double) -> Color { self }
}
extension Color: View { public var body: Never { fatalError() } }
extension ShapeStyle where Self == Color {
    public static var white: Color { .white }
    public static var black: Color { .black }
}
public struct HierarchicalShapeStyle: ShapeStyle {}
extension ShapeStyle where Self == HierarchicalShapeStyle { public static var secondary: HierarchicalShapeStyle { .init() } }
public struct Material: ShapeStyle {}
extension ShapeStyle where Self == Material { public static var ultraThinMaterial: Material { .init() } }

public struct Font: Sendable {
    public enum Weight: Sendable { case regular, medium, semibold, bold, heavy }
    public enum Design: Sendable { case `default`, rounded, monospaced }
    public static let headline = Font(), subheadline = Font(), caption = Font(), footnote = Font(), callout = Font(), body = Font()
    public static let title2 = Font(), title3 = Font()
    public static func system(size: CGFloat, weight: Weight = .regular, design: Design = .default) -> Font { Font() }
    public static func system(size: CGFloat, design: Design) -> Font { Font() }
    public func weight(_ w: Weight) -> Font { self }
    public func monospacedDigit() -> Font { self }
    public func italic() -> Font { self }
    public func bold() -> Font { self }
}

public protocol Shape: View {}
public protocol InsettableShape: Shape {}
extension Shape {
    public func fill<S: ShapeStyle>(_ s: S) -> some View { EmptyView() }
}
extension InsettableShape {
    public func strokeBorder<S: ShapeStyle>(_ s: S, lineWidth: CGFloat = 1) -> some View { EmptyView() }
}
public enum RoundedCornerStyle: Sendable { case circular, continuous }
public struct Circle: InsettableShape { public init() {}; public var body: Never { fatalError() } }
public struct Capsule: InsettableShape { public init() {}; public var body: Never { fatalError() } }
public struct Rectangle: InsettableShape { public init() {}; public var body: Never { fatalError() } }
public struct RoundedRectangle: InsettableShape { public init(cornerRadius: CGFloat, style: RoundedCornerStyle = .circular) {}; public var body: Never { fatalError() } }

public struct Text: View {
    public init(_ s: String) {}
    public var body: Never { fatalError() }
}
public struct Image: View {
    public init(systemName: String) {}
    public init(uiImage: UIImage) {}
    public func resizable() -> Image { self }
    public var body: Never { fatalError() }
}
extension View { public func scaledToFill() -> some View { self } }
public struct Label: View { public init(_ title: String, systemImage: String) {}; public var body: Never { fatalError() } }
public struct ButtonRole: Sendable { public static let destructive = ButtonRole(), cancel = ButtonRole() }
public struct Button<L: View>: View {
    public init(action: @escaping @MainActor () -> Void, @ViewBuilder label: () -> L) {}
    public var body: Never { fatalError() }
}
extension Button where L == Text {
    public init(_ title: String, action: @escaping @MainActor () -> Void) {}
    public init(_ title: String, role: ButtonRole?, action: @escaping @MainActor () -> Void) {}
}
public struct Toggle: View { public init(_ title: String, isOn: Binding<Bool>) {}; public var body: Never { fatalError() } }
public struct Picker<S: Hashable, C: View>: View {
    public init(_ title: String, selection: Binding<S>, @ViewBuilder content: () -> C) {}
    public var body: Never { fatalError() }
}
public struct ProgressView: View { public init() {}; public init(_ title: String) {}; public var body: Never { fatalError() } }
public struct LabeledContent: View { public init(_ title: String, value: String) {}; public var body: Never { fatalError() } }
public struct TextField: View { public init(_ title: String, text: Binding<String>) {}; public var body: Never { fatalError() } }
public struct Divider: View { public init() {}; public var body: Never { fatalError() } }
public struct Spacer: View { public init(minLength: CGFloat? = nil) {}; public var body: Never { fatalError() } }
public enum HorizontalAlignment: Sendable { case leading, center, trailing }
public enum VerticalAlignment: Sendable { case top, center, bottom, firstTextBaseline }
public enum Alignment: Sendable { case leading, center, trailing, top }
public struct HStack<C: View>: View { public init(alignment: VerticalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> C) {}; public var body: Never { fatalError() } }
public struct VStack<C: View>: View { public init(alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> C) {}; public var body: Never { fatalError() } }
public struct ZStack<C: View>: View { public init(@ViewBuilder content: () -> C) {}; public var body: Never { fatalError() } }
public enum Axis: Sendable { case horizontal, vertical; public struct Set: OptionSet, Sendable { public let rawValue: Int; public init(rawValue: Int) { self.rawValue = rawValue }; public static let horizontal = Set(rawValue: 1) } }
public struct ScrollView<C: View>: View { public init(_ axes: Axis.Set = [], showsIndicators: Bool = true, @ViewBuilder content: () -> C) {}; public var body: Never { fatalError() } }
public struct GridItem: Sendable { public enum Size: Sendable { case adaptive(minimum: CGFloat) }; public init(_ size: Size, spacing: CGFloat? = nil) {} }
public struct LazyVGrid<C: View>: View { public init(columns: [GridItem], spacing: CGFloat? = nil, @ViewBuilder content: () -> C) {}; public var body: Never { fatalError() } }
public struct ForEach<D, ID: Hashable, C: View>: View {
    public var body: Never { fatalError() }
}
extension ForEach where D: RandomAccessCollection, D.Element: Identifiable, ID == D.Element.ID {
    public init(_ data: D, @ViewBuilder content: @escaping (D.Element) -> C) {}
}
extension ForEach where D: RandomAccessCollection {
    public init(_ data: D, id: KeyPath<D.Element, ID>, @ViewBuilder content: @escaping (D.Element) -> C) {}
}
public struct Form<C: View>: View { public init(@ViewBuilder content: () -> C) {}; public var body: Never { fatalError() } }
public struct List<C: View>: View { public init(@ViewBuilder content: () -> C) {}; public var body: Never { fatalError() } }
public struct NavigationStack<C: View>: View { public init(@ViewBuilder root: () -> C) {}; public var body: Never { fatalError() } }
public struct Section<H: View, C: View, F: View>: View {
    public init(@ViewBuilder content: () -> C, @ViewBuilder header: () -> H, @ViewBuilder footer: () -> F) {}
    public var body: Never { fatalError() }
}
extension Section where H == EmptyView, F == EmptyView { public init(@ViewBuilder content: () -> C) {} }
extension Section where F == EmptyView { public init(@ViewBuilder content: () -> C, @ViewBuilder header: () -> H) {} }
extension Section where H == EmptyView { public init(@ViewBuilder content: () -> C, @ViewBuilder footer: () -> F) {} }
public struct Menu<C: View, L: View>: View { public init(@ViewBuilder content: () -> C, @ViewBuilder label: () -> L) {}; public var body: Never { fatalError() } }

public struct ToolbarItemPlacement: Sendable { public static let topBarTrailing = ToolbarItemPlacement(), confirmationAction = ToolbarItemPlacement(), cancellationAction = ToolbarItemPlacement() }
public struct ToolbarItem<C: View>: View { public init(placement: ToolbarItemPlacement, @ViewBuilder content: () -> C) {}; public var body: Never { fatalError() } }

@propertyWrapper @dynamicMemberLookup public struct Binding<Value> {
    public init(get: @escaping () -> Value, set: @escaping (Value) -> Void) {}
    public var wrappedValue: Value { get { fatalError() } nonmutating set {} }
    public var projectedValue: Binding<Value> { self }
    public subscript<T>(dynamicMember k: WritableKeyPath<Value, T>) -> Binding<T> { fatalError() }
}
@propertyWrapper public struct State<Value> {
    public init(wrappedValue: Value) {}
    public var wrappedValue: Value { get { fatalError() } nonmutating set {} }
    public var projectedValue: Binding<Value> { fatalError() }
}
@propertyWrapper @dynamicMemberLookup public struct Bindable<Value: AnyObject & Observable> {
    public init(wrappedValue: Value) {}
    public var wrappedValue: Value { fatalError() }
    public var projectedValue: Bindable<Value> { self }
    public subscript<T>(dynamicMember k: ReferenceWritableKeyPath<Value, T>) -> Binding<T> { fatalError() }
}
public struct DismissAction { @MainActor public func callAsFunction() {} }
public enum ScenePhase: Sendable, Equatable { case active, inactive, background }
public struct EnvironmentValues {
    public var dismiss: DismissAction { fatalError() }
    public var scenePhase: ScenePhase { .active }
    public var accessibilityReduceMotion: Bool { false }
    public var accessibilityVoiceOverEnabled: Bool { false }
}
@propertyWrapper public struct Environment<Value> {
    public init(_ keyPath: KeyPath<EnvironmentValues, Value>) {}
    public init(_ type: Value.Type) where Value: AnyObject & Observable {}
    public var wrappedValue: Value { fatalError() }
}

public enum ColorScheme: Sendable { case light, dark }
public enum Visibility: Sendable { case automatic, visible, hidden }
public enum TextAlignment: Sendable { case leading, center, trailing }
public struct AnyTransition: Sendable { public static let opacity = AnyTransition() }
public enum NavigationBarItem { public enum TitleDisplayMode: Sendable { case inline, large } }
public struct Edge { public struct Set: OptionSet, Sendable { public let rawValue: Int; public init(rawValue: Int) { self.rawValue = rawValue }; public static let horizontal = Set(rawValue: 1), vertical = Set(rawValue: 2), top = Set(rawValue: 4), all = Set(rawValue: 7) } }
public protocol ButtonStyle {}
public struct PlainButtonStyle: ButtonStyle {}
public struct BorderedButtonStyle: ButtonStyle {}
public struct BorderedProminentButtonStyle: ButtonStyle {}
extension ButtonStyle where Self == PlainButtonStyle { public static var plain: PlainButtonStyle { .init() } }
extension ButtonStyle where Self == BorderedButtonStyle { public static var bordered: BorderedButtonStyle { .init() } }
extension ButtonStyle where Self == BorderedProminentButtonStyle { public static var borderedProminent: BorderedProminentButtonStyle { .init() } }
public protocol PickerStyle {}
public struct InlinePickerStyle: PickerStyle {}
public struct SegmentedPickerStyle: PickerStyle {}
extension PickerStyle where Self == InlinePickerStyle { public static var inline: InlinePickerStyle { .init() } }
extension PickerStyle where Self == SegmentedPickerStyle { public static var segmented: SegmentedPickerStyle { .init() } }
public protocol CoordinateSpaceProtocol {}
public struct LocalCoordinateSpace: CoordinateSpaceProtocol {}
extension CoordinateSpaceProtocol where Self == LocalCoordinateSpace { public static var local: LocalCoordinateSpace { .init() } }
public protocol ShapeProtocolForClip {}

extension View {
    public func font(_ f: Font?) -> some View { self }
    public func foregroundStyle<S: ShapeStyle>(_ s: S) -> some View { self }
    public func padding(_ length: CGFloat? = nil) -> some View { self }
    public func padding(_ edges: Edge.Set, _ length: CGFloat? = nil) -> some View { self }
    public func frame(width: CGFloat? = nil, height: CGFloat? = nil, alignment: Alignment = .center) -> some View { self }
    public func frame(minWidth: CGFloat? = nil, maxWidth: CGFloat? = nil, minHeight: CGFloat? = nil, maxHeight: CGFloat? = nil, alignment: Alignment = .center) -> some View { self }
    public func background<V: View>(_ v: V) -> some View { self }
    public func background<S: ShapeStyle, T: Shape>(_ s: S, in shape: T) -> some View { self }
    public func overlay<V: View>(_ v: V) -> some View { self }
    public func clipShape<S: Shape>(_ s: S) -> some View { self }
    public func contentShape<S: Shape>(_ s: S) -> some View { self }
    public func opacity(_ o: Double) -> some View { self }
    public func ignoresSafeArea() -> some View { self }
    public func buttonStyle<S: ButtonStyle>(_ s: S) -> some View { self }
    // Apple declaration checked 2026-10-09:
    // developer.apple.com/tutorials/data/documentation/swiftui/view/disabled(_:).json
    public nonisolated func disabled(_ disabled: Bool) -> some View { self }
    public func pickerStyle<S: PickerStyle>(_ s: S) -> some View { self }
    public func labelsHidden() -> some View { self }
    public func lineLimit(_ n: Int?) -> some View { self }
    public func multilineTextAlignment(_ a: TextAlignment) -> some View { self }
    public func transition(_ t: AnyTransition) -> some View { self }
    public func tint(_ c: Color?) -> some View { self }
    public func preferredColorScheme(_ s: ColorScheme?) -> some View { self }
    public func statusBarHidden(_ hidden: Bool = true) -> some View { self }
    public func persistentSystemOverlays(_ v: Visibility) -> some View { self }
    public func accessibilityLabel(_ s: String) -> some View { self }
    public func accessibilityHint(_ s: String) -> some View { self }
    public func navigationTitle(_ s: String) -> some View { self }
    public func navigationBarTitleDisplayMode(_ m: NavigationBarItem.TitleDisplayMode) -> some View { self }
    public func tag<V: Hashable>(_ v: V) -> some View { self }
    // Apple SDK: View.id and View.sheet(item:onDismiss:content:).
    public nonisolated func id<ID: Hashable>(_ id: ID) -> some View { self }
    public func toolbar<C: View>(@ViewBuilder content: () -> C) -> some View { self }
    public func environment<T: AnyObject & Observable>(_ object: T?) -> some View { self }
    public func sheet<C: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> C) -> some View { self }
    public nonisolated func sheet<Item: Identifiable, C: View>(item: Binding<Item?>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping (Item) -> C) -> some View { self }
    public func fullScreenCover<C: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> C) -> some View { self }
    public func alert<A: View>(_ title: String, isPresented: Binding<Bool>, @ViewBuilder actions: () -> A) -> some View { self }
    public func confirmationDialog<A: View>(_ title: String, isPresented: Binding<Bool>, titleVisibility: Visibility = .automatic, @ViewBuilder actions: () -> A) -> some View { self }
    public func onChange<V: Equatable>(of value: V, initial: Bool = false, _ action: @escaping (V, V) -> Void) -> some View { self }
    public func onTapGesture(count: Int = 1, coordinateSpace: some CoordinateSpaceProtocol = .local, perform: @escaping (CGPoint) -> Void) -> some View { self }
    public func onLongPressGesture(minimumDuration: Double = 0.5, perform: @escaping () -> Void) -> some View { self }
    public func swipeActions<C: View>(edge: HorizontalAlignment = .trailing, allowsFullSwipe: Bool = true, @ViewBuilder content: () -> C) -> some View { self }
    public func refreshable(action: @escaping @Sendable () async -> Void) -> some View { self }
    public func task(priority: TaskPriority = .userInitiated, @_inheritActorContext _ action: @escaping @Sendable () async -> Void) -> some View { self }
}

@MainActor public protocol UIViewRepresentable: View where Body == Never {
    associatedtype UIViewType: UIView
    associatedtype Coordinator = Void
    typealias Context = UIViewRepresentableContext<Self>
    func makeUIView(context: Context) -> UIViewType
    func updateUIView(_ uiView: UIViewType, context: Context)
    func makeCoordinator() -> Coordinator
}
extension UIViewRepresentable where Coordinator == Void { public func makeCoordinator() {} }
extension UIViewRepresentable { public var body: Never { fatalError() } }
@MainActor public struct UIViewRepresentableContext<R: UIViewRepresentable> { public var coordinator: R.Coordinator { fatalError() } }

@MainActor @preconcurrency public protocol App {
    associatedtype Body: Scene
    init()
    @SceneBuilder var body: Body { get }
}
@MainActor public protocol Scene {}
@resultBuilder public enum SceneBuilder { public static func buildBlock<S: Scene>(_ s: S) -> S { s } }
public struct WindowGroup<C: View>: Scene { public init(@ViewBuilder content: () -> C) {} }
extension App { public static func main() {} }
public struct PresentationDetent: Hashable, Sendable {
    public static let medium = PresentationDetent(), large = PresentationDetent()
    public static func fraction(_ f: CGFloat) -> PresentationDetent { PresentationDetent() }
    public static func height(_ h: CGFloat) -> PresentationDetent { PresentationDetent() }
}
extension View {
    public func presentationDetents(_ detents: Set<PresentationDetent>) -> some View { self }
}
public struct AccessibilityChildBehavior: Sendable { public static let ignore = AccessibilityChildBehavior(), contain = AccessibilityChildBehavior(), combine = AccessibilityChildBehavior() }
extension View {
    public func minimumScaleFactor(_ factor: CGFloat) -> some View { self }
    public func fixedSize() -> some View { self }
    public func fixedSize(horizontal: Bool, vertical: Bool) -> some View { self }
    public func accessibilityHidden(_ hidden: Bool) -> some View { self }
    public func accessibilityElement(children: AccessibilityChildBehavior = .ignore) -> some View { self }
}
extension View {
    public func task<T: Equatable>(id value: T, priority: TaskPriority = .userInitiated, @_inheritActorContext _ action: @escaping @Sendable () async -> Void) -> some View { self }
}
public struct Slider: View {
    public init<V: BinaryFloatingPoint>(value: Binding<V>, in bounds: ClosedRange<V> = 0...1, onEditingChanged: @escaping (Bool) -> Void = { _ in }) where V.Stride: BinaryFloatingPoint {}
    public var body: Never { fatalError() }
}
extension View {
    public func onAppear(perform action: (() -> Void)? = nil) -> some View { self }
    public func onDisappear(perform action: (() -> Void)? = nil) -> some View { self }
}
extension Section where H == Text, F == EmptyView {
    public init<S: StringProtocol>(_ title: S, @ViewBuilder content: () -> C) {}
}
