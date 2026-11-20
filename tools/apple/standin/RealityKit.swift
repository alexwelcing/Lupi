// Stand-in for RealityKit with the declarations the app uses, spelled as developer.apple.com
// documents them (iOS 26). It type-checks the app's own logic on Linux; it proves nothing
// about RealityKit itself.
import ARKit
import AVFAudio
import CoreMedia
import Foundation
import simd
import SwiftUI
import UIKit

public protocol Component {}
public protocol Material {}
public protocol Event {}
public protocol EventSource {}

public struct Transform: Sendable {
    public var scale: SIMD3<Float> = .one
    public var rotation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
    public var translation: SIMD3<Float> = .zero
    public init(scale: SIMD3<Float> = .one, rotation: simd_quatf = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1), translation: SIMD3<Float> = .zero) {}
    public init(matrix: float4x4) {}
    public var matrix: float4x4 { float4x4(diagonal: .one) }
}

@MainActor open class Entity: EventSource, Identifiable {
    public typealias ID = UInt64
    public struct ComponentSet {
        public subscript<T: Component>(componentType: T.Type) -> T? { get { nil } set {} }
        public mutating func set<T: Component>(_ component: T) {}
        public mutating func remove(_ componentType: any Component.Type) {}
    }
    public struct ChildCollection: Collection {
        public var startIndex: Int { 0 }
        public var endIndex: Int { 0 }
        public func index(after i: Int) -> Int { i + 1 }
        public subscript(i: Int) -> Entity { fatalError() }
    }
    nonisolated public var id: ID { 0 }
    public var components = ComponentSet()
    public var isEnabled = true
    public var parent: Entity? { nil }
    public var children: ChildCollection { ChildCollection() }
    public var transform = Transform()
    public var position: SIMD3<Float> = .zero
    public required init() {}
    public func addChild(_ child: Entity, preservingWorldTransform: Bool = false) {}
    public func removeFromParent(preservingWorldTransform: Bool = false) {}
    public func position(relativeTo referenceEntity: Entity?) -> SIMD3<Float> { .zero }
    public func orientation(relativeTo referenceEntity: Entity?) -> simd_quatf { simd_quatf(ix: 0, iy: 0, iz: 0, r: 1) }
    public var pins: EntityGeometricPins { EntityGeometricPins() }
    @discardableResult public func playAudio(_ resource: AudioResource) -> AudioPlaybackController { AudioPlaybackController() }
}

@MainActor open class ModelEntity: Entity {
    public required init() {}
    public init(mesh: MeshResource, materials: [any Material] = []) {}
    public func applyLinearImpulse(_ impulse: SIMD3<Float>, relativeTo referenceEntity: Entity?) {}
    public func applyAngularImpulse(_ impulse: SIMD3<Float>, relativeTo referenceEntity: Entity?) {}
}

@MainActor open class AudioResource {}
@MainActor public final class AudioBufferResource: AudioResource {
    public struct Configuration { public init() {} }
    public init(buffer: AVAudioBuffer, configuration: Configuration = .init()) throws {}
}
@MainActor public final class AudioPlaybackController {
    public typealias Decibel = Double
    public var gain: Decibel = 0
    public var speed: Double = 1
}

@MainActor public final class MeshResource {
    public static func generateSphere(radius: Float) -> MeshResource { MeshResource() }
    public static func generateBox(size: Float, cornerRadius: Float = 0) -> MeshResource { MeshResource() }
    public static func generatePlane(width: Float, depth: Float, cornerRadius: Float = 0) -> MeshResource { MeshResource() }
    public static func generate(from descriptors: [MeshDescriptor]) throws -> MeshResource { MeshResource() }
}
public struct MeshBuffer<Element>: Sendable { public init<S: Sequence>(_ s: S) where S.Element == Element {} }
public enum MeshBuffers {
    public typealias Positions = MeshBuffer<SIMD3<Float>>
    public typealias Normals = MeshBuffer<SIMD3<Float>>
}
public struct MeshDescriptor: Sendable {
    public enum Primitives: Sendable { case triangles([UInt32]) }
    public enum Materials: Sendable { case allFaces(UInt32) }
    public init(name: String = "") {}
    public var positions = MeshBuffers.Positions([])
    public var normals: MeshBuffers.Normals?
    public var primitives: Primitives?
    public var materials = Materials.allFaces(0)
}

public struct BoundingBox: Sendable {
    public var min: SIMD3<Float>
    public var max: SIMD3<Float>
    public init(min: SIMD3<Float>, max: SIMD3<Float>) { self.min = min; self.max = max }
    public func contains(_ other: BoundingBox) -> Bool { true }
}

public struct PhysicallyBasedMaterial: Material {
    public struct BaseColor { public init(tint: UIColor = UIColor(red: 1, green: 1, blue: 1, alpha: 1)) {} }
    public struct Roughness: ExpressibleByFloatLiteral { public init(floatLiteral: Float) {} }
    public struct Metallic: ExpressibleByFloatLiteral { public init(floatLiteral: Float) {} }
    public struct Clearcoat: ExpressibleByFloatLiteral { public init(floatLiteral: Float) {} }
    public struct ClearcoatRoughness: ExpressibleByFloatLiteral { public init(floatLiteral: Float) {} }
    public init() {}
    public var baseColor = BaseColor()
    public var roughness: Roughness = 0.0
    public var metallic: Metallic = 0.0
    public var clearcoat: Clearcoat = 0.0
    public var clearcoatRoughness: ClearcoatRoughness = 0.0
}

@MainActor public final class PhysicsMaterialResource {
    public static func generate(staticFriction: Float = 0.8, dynamicFriction: Float = 0.6, restitution: Float = 0.8) -> PhysicsMaterialResource { PhysicsMaterialResource() }
}
public enum PhysicsBodyMode: Sendable { case `static`, kinematic, dynamic }
public struct PhysicsMassProperties: Sendable {
    public static let `default` = PhysicsMassProperties(mass: 1)
    public init(mass: Float, inertia: SIMD3<Float> = SIMD3<Float>(0.1, 0.1, 0.1), centerOfMass: (position: SIMD3<Float>, orientation: simd_quatf) = (.zero, simd_quatf(ix: 0, iy: 0, iz: 0, r: 1))) {}
}
public struct PhysicsBodyComponent: Component {
    public init(massProperties: PhysicsMassProperties = .default, material: PhysicsMaterialResource? = nil, mode: PhysicsBodyMode = .dynamic) {}
    public var mode = PhysicsBodyMode.dynamic
    public var linearDamping: Float = 0
    public var angularDamping: Float = 0
    public var isContinuousCollisionDetectionEnabled = false
}
public struct PhysicsMotionComponent: Component {
    public init(linearVelocity: SIMD3<Float> = .zero, angularVelocity: SIMD3<Float> = .zero) {}
    public var linearVelocity: SIMD3<Float> = .zero
    public var angularVelocity: SIMD3<Float> = .zero
}
public struct PhysicsSimulationComponent: Component {
    public struct SolverIterations: Sendable { public init(positionIterations: Int = 6, velocityIterations: Int = 1) {} }
    public init() {}
    public var solverIterations = SolverIterations()
    public var clock: CMClockOrTimebase = CMClock.hostTimeClock
}
@MainActor public final class ShapeResource {
    public static func generateSphere(radius: Float) -> ShapeResource { ShapeResource() }
    public static func generateBox(size: SIMD3<Float>) -> ShapeResource { ShapeResource() }
    public static func generateConvex(from points: [SIMD3<Float>]) -> ShapeResource { ShapeResource() }
    nonisolated public static func generateStaticMesh(positions: [SIMD3<Float>], faceIndices: [UInt16]) async throws -> ShapeResource { fatalError() }
    public func offsetBy(rotation: simd_quatf = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1), translation: SIMD3<Float> = SIMD3<Float>()) -> ShapeResource { self }
}
public struct CollisionComponent: Component {
    public init(shapes: [ShapeResource]) {}
}
public struct ModelComponent: Component {
    public init(mesh: MeshResource, materials: [any Material]) {}
}
public struct GroundingShadowComponent: Component {
    public init(castsShadow: Bool) {}
}
@MainActor public final class LowLevelInstanceData {
    public init(instanceCount: Int, instanceCapacity: Int) throws {}
    public var instanceCount = 0
    public func withMutableTransforms(_ body: (UnsafeMutableBufferPointer<float4x4>) -> Void) {}
}
public struct MeshInstancesComponent: Component {
    @MainActor public init(mesh: MeshResource, modelID: String? = nil, instances: LowLevelInstanceData, bounds: BoundingBox? = nil) throws {}
}
public struct ParticleEmitterComponent: Component {
    public enum EmitterShape: Sendable { case sphere, torus, point }
    public struct ParticleEmitter {
        public enum ParticleColor { public enum ColorValue { case single(UIColor); case random(a: UIColor, b: UIColor) }; case constant(ColorValue) }
        public var lifeSpan: Double = 1
        public var size: Float = 0.02
        public var dampingFactor: Float = 0
        public var color = ParticleColor.constant(.single(UIColor(red: 1, green: 1, blue: 1, alpha: 1)))
    }
    public init() {}
    public var emitterShape = EmitterShape.point
    public var emitterShapeSize: SIMD3<Float> = .zero
    public var speed: Float = 0.5
    public var speedVariation: Float = 0
    public var isEmitting = true
    public var burstCount = 100
    public var mainEmitter = ParticleEmitter()
    public mutating func burst() {}
}

public struct EventSubscription { public func cancel() {} }
public enum SceneEvents { public struct Update: Event { public let deltaTime: TimeInterval } }
public enum CollisionEvents {
    public struct Began: Event {
        public let entityA: Entity
        public let entityB: Entity
        public let position: SIMD3<Float>
        public let impulse: Float
        public let impulseDirection: SIMD3<Float>
    }
    public struct Updated: Event {
        public let entityA: Entity
        public let entityB: Entity
        public let position: SIMD3<Float>
        public let impulse: Float
        public let impulseDirection: SIMD3<Float>
    }
}
public enum RealityViewCamera { case spatialTracking, virtual }
// Apple docs and iOS 26.5 SDK: CameraControls.orbit and RealityViewCameraContent.cameraTarget.
public struct CameraControls: Hashable, Sendable {
    public static var orbit: CameraControls { CameraControls() }
}
@MainActor public struct RealityViewCameraContent {
    public var camera = RealityViewCamera.virtual
    public var cameraTarget: Entity?
    public func add(_ entity: Entity) {}
    public func subscribe<E: Event>(to event: E.Type, on sourceObject: (any EventSource)?, componentType: (any Component.Type)?, _ handler: @escaping (E) -> Void) -> EventSubscription { EventSubscription() }
}

@MainActor public final class SpatialTrackingSession {
    public struct Configuration {
        public struct AnchorCapability: Hashable, Sendable { public static let plane = AnchorCapability(); public static let world = AnchorCapability() }
        public struct SceneUnderstandingCapability: Hashable, Sendable {
            public static let collision = SceneUnderstandingCapability(); public static let physics = SceneUnderstandingCapability()
            public static let occlusion = SceneUnderstandingCapability(); public static let shadow = SceneUnderstandingCapability()
        }
        public enum Camera: Hashable { case back, front }
        public init(tracking: Set<AnchorCapability> = [], sceneUnderstanding: Set<SceneUnderstandingCapability> = [], camera: Camera = .back) {}
    }
    public struct UnavailableCapabilities: Sendable, CustomStringConvertible {
        public var description: String { "" }
        public var debugDescription: String { "" }
    }
    public init() {}
    @discardableResult public func run(_ configuration: Configuration, session: ARSession, arConfiguration: ARConfiguration) async -> UnavailableCapabilities? { nil }
    public func stop() async {}
}

// developer.apple.com: RealityView.init(make:update:) for iOS.
public struct RealityView: View {
    public init(make: @escaping @MainActor @Sendable (inout RealityViewCameraContent) async -> Void,
                update: (@MainActor (inout RealityViewCameraContent) -> Void)? = nil) {}
    public var body: Never { fatalError() }
}
extension View {
    @MainActor public func realityViewCameraControls(_ controls: CameraControls) -> some View { self }
}

// iOS 18 joints and pins, as developer.apple.com documents them.
public struct GeometricPin: Sendable {
    @MainActor public func position(relativeTo referenceEntity: Entity?) -> SIMD3<Float>? { nil }
    @MainActor public func orientation(relativeTo referenceEntity: Entity?) -> simd_quatf? { nil }
}
@MainActor public struct EntityGeometricPins {
    @discardableResult public func set(named name: String, position: SIMD3<Float> = SIMD3<Float>(0, 0, 0), orientation: simd_quatf = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)) -> GeometricPin { GeometricPin() }
    @discardableResult public func set(named name: String, position: SIMD3<Float> = SIMD3<Float>(0, 0, 0), orientation: simd_quatf = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1), relativeTo referenceEntity: Entity?) -> GeometricPin { GeometricPin() }
}
public protocol PhysicsJoint: Equatable {}
extension PhysicsJoint {
    @discardableResult @MainActor public func addToSimulation() throws -> Entity { fatalError() }
}
public struct PhysicsSphericalJoint: PhysicsJoint {
    public init(pin0: GeometricPin, pin1: GeometricPin, angularLimitInYZ: (Float, Float)? = nil, checksForInternalCollisions: Bool = false) {}
    public static func == (a: Self, b: Self) -> Bool { true }
}

// iOS 17 accessibility.
public struct AccessibilityComponent: Component {
    public struct SupportedActions: OptionSet, Sendable {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let activate = SupportedActions(rawValue: 1)
        public static let increment = SupportedActions(rawValue: 2)
        public static let decrement = SupportedActions(rawValue: 4)
    }
    public init() {}
    public var isAccessibilityElement = false
    public var label: LocalizedStringResource?
    public var value: LocalizedStringResource?
    public var systemActions: SupportedActions = []
    public var customActions: [LocalizedStringResource] = []
    public var traits: UIAccessibilityTraits = []
}
public enum AccessibilityEvents {
    public struct Activate: Event { public var entity: Entity }
    public struct CustomAction: Event { public var entity: Entity; public var key: LocalizedStringResource }
    public struct Increment: Event { public var entity: Entity }
    public struct Decrement: Event { public var entity: Entity }
}
