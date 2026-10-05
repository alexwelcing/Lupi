// Stand-in for the ARKit the app uses, spelled as developer.apple.com documents it.
import Foundation
import simd
import UIKit

open class ARConfiguration {
    open class VideoFormat: NSObject, @unchecked Sendable {
        open var framesPerSecond: Int { 60 }
        open var imageResolution: CGSize { .zero }
    }
    open var videoFormat: VideoFormat = VideoFormat()
    open class var supportedVideoFormats: [VideoFormat] { [] }
}
open class ARWorldTrackingConfiguration: ARConfiguration {
    public struct PlaneDetection: OptionSet, Sendable { public let rawValue: UInt; public init(rawValue: UInt) { self.rawValue = rawValue }; public static let horizontal = PlaneDetection(rawValue: 1); public static let vertical = PlaneDetection(rawValue: 2) }
    public enum EnvironmentTexturing: Sendable { case none, manual, automatic }
    public struct SceneReconstruction: OptionSet, Sendable { public let rawValue: UInt; public init(rawValue: UInt) { self.rawValue = rawValue }; public static let mesh = SceneReconstruction(rawValue: 1); public static let meshWithClassification = SceneReconstruction(rawValue: 3) }
    public override init() {}
    open var planeDetection: PlaneDetection = []
    open var environmentTexturing = EnvironmentTexturing.automatic
    open var sceneReconstruction: SceneReconstruction = []
    open var initialWorldMap: ARWorldMap?
    open class func supportsSceneReconstruction(_ r: SceneReconstruction) -> Bool { false }
}
open class ARAnchor {
    public init(name: String, transform: simd_float4x4) {}
    open var identifier: UUID { UUID() }
    open var name: String? { nil }
    open var transform: float4x4 { float4x4(diagonal: .one) }
}
public final class CVBuffer {}
public typealias CVPixelBuffer = CVBuffer
public final class ARRaycastQuery {
    public enum Target: Sendable { case existingPlaneGeometry, existingPlaneInfinite, estimatedPlane }
    public enum TargetAlignment: Sendable { case horizontal, vertical, any }
    public init(origin: simd_float3, direction: simd_float3, allowing target: Target, alignment: TargetAlignment) {}
}
public final class ARRaycastResult { public var worldTransform: simd_float4x4 { float4x4(diagonal: .one) } }
open class ARPlaneAnchor: ARAnchor {
    public enum Alignment: Sendable { case horizontal, vertical }
    public enum Classification: Sendable { case none(Int), wall, floor, ceiling, table, seat, window, door }
    open var alignment: Alignment { .horizontal }
    open var classification: Classification { .wall }
    open var center: SIMD3<Float> { .zero }
    open var planeExtent: ARPlaneExtent { ARPlaneExtent() }
}
open class ARPlaneExtent { open var width: Float { 0 }; open var height: Float { 0 }; open var rotationOnYAxis: Float { 0 } }
open class ARWorldMap: NSObject, NSSecureCoding {
    public static var supportsSecureCoding: Bool { true }
    public override init() {}
    public required init?(coder: NSCoder) {}
    public func encode(with coder: NSCoder) {}
    open var anchors: [ARAnchor] { [] }
}
open class ARCamera {
    public enum TrackingState: Sendable {
        public enum Reason: Sendable { case initializing, excessiveMotion, insufficientFeatures, relocalizing }
        case notAvailable, limited(Reason), normal
    }
    open var trackingState: TrackingState { .normal }
    open func projectionMatrix(for orientation: UIInterfaceOrientation, viewportSize: CGSize, zNear: CGFloat, zFar: CGFloat) -> float4x4 { float4x4(diagonal: .one) }
    open func viewMatrix(for orientation: UIInterfaceOrientation) -> float4x4 { float4x4(diagonal: .one) }
}
open class ARFrame {
    public enum WorldMappingStatus: Int, Sendable { case notAvailable, limited, extending, mapped }
    open var timestamp: TimeInterval { 0 }
    open var camera: ARCamera { ARCamera() }
    open var anchors: [ARAnchor] { [] }
    open var worldMappingStatus: WorldMappingStatus { .notAvailable }
    open var capturedImage: CVPixelBuffer { CVBuffer() }
}
open class ARSession {
    public struct RunOptions: OptionSet, Sendable {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let resetTracking = RunOptions(rawValue: 1)
        public static let removeExistingAnchors = RunOptions(rawValue: 2)
    }
    public init() {}
    open var currentFrame: ARFrame? { nil }
    open var configuration: ARConfiguration? { nil }
    open func pause() {}
    open func run(_ configuration: ARConfiguration, options: RunOptions = []) {}
    open func add(anchor: ARAnchor) {}
    open func remove(anchor: ARAnchor) {}
    open func raycast(_ query: ARRaycastQuery) -> [ARRaycastResult] { [] }
    open func currentWorldMap() async throws -> ARWorldMap { ARWorldMap() }
}

@MainActor public protocol ARCoachingOverlayViewDelegate: AnyObject {
    func coachingOverlayViewDidRequestSessionReset(_ coachingOverlayView: ARCoachingOverlayView)
}
extension ARCoachingOverlayViewDelegate {
    public func coachingOverlayViewDidRequestSessionReset(_ coachingOverlayView: ARCoachingOverlayView) {}
}
@MainActor open class ARCoachingOverlayView: UIView {
    public enum Goal: Sendable { case tracking, horizontalPlane, verticalPlane, anyPlane, geoTracking }
    open var session: ARSession?
    open var goal: Goal = .tracking
    open var activatesAutomatically = true
    open weak var delegate: (any ARCoachingOverlayViewDelegate)?
}
