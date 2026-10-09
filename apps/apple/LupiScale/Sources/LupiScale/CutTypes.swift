import Foundation
import LupiChem
import LupiScaleCore

/// The camera and viewport of one frame (§9.1). Camera space looks down −z, y up (ARKit).
public struct ViewState: Sendable {
    public var cameraFromWorld: RigidD
    /// Vertical field of view, radians.
    public var fovY: Double
    public var viewportHeight: Int
    public var zNear: Double
    public var zFar: Double
    /// Not in §11.1's shape: the frustum's horizontal extent needs it. Defaults to the height.
    public var viewportWidth: Int

    public init(
        cameraFromWorld: RigidD, fovY: Double, viewportHeight: Int, zNear: Double = FrameTuning.zNear,
        zFar: Double = FrameTuning.zFar, viewportWidth: Int? = nil
    ) {
        self.cameraFromWorld = cameraFromWorld
        self.fovY = fovY
        self.viewportHeight = viewportHeight
        self.zNear = zNear
        self.zFar = zFar
        self.viewportWidth = viewportWidth ?? viewportHeight
    }

    /// A camera at `eye` looking at `target`, y up.
    public static func looking(
        from eye: Vec3, at target: Vec3, fovY: Double = 1.0, viewportHeight: Int = 1380, viewportWidth: Int? = nil
    ) -> ViewState {
        let back = (eye - target).normalized
        var up = Vec3(0, 1, 0)
        if abs(back.dot(up)) > 0.999 { up = Vec3(0, 0, 1) }
        let right = up.cross(back).normalized
        let trueUp = back.cross(right)
        let worldFromCamera = RigidD(rotation: Quat(rotation: Mat3(columns: right, trueUp, back)), translation: eye)
        return ViewState(cameraFromWorld: worldFromCamera.inverse, fovY: fovY, viewportHeight: viewportHeight, viewportWidth: viewportWidth)
    }

    public var cameraPosition: Vec3 { cameraFromWorld.inverse.translation }

    /// K = viewportHeight / (2 tan(fovY / 2)), pixels per unit of tangent.
    public var pixelsPerRadian: Double { Double(viewportHeight) / (2 * tan(fovY / 2)) }
}

/// One element's atoms in an atoms item: positions relative to the item's origin, item units.
public struct ElementRun: Sendable {
    public var atomicNumber: UInt8
    /// Toy radius, item units.
    public var radius: Float
    /// sRGB 0…1.
    public var colour: SIMD3<Float>
    public var positions: [SIMD3<Float>]
}

/// What an item needs besides its transform (§9.7).
public enum DrawExtras: Sendable {
    /// A box centred on the item's origin.
    case box(halfExtents: SIMD3<Float>, colour: SIMD3<Float>)
    /// Atoms by element, for instancing (or a merged mesh for `leafMesh`).
    case atoms([ElementRun])
    /// Up to 8 spheres: centre (xyz) and radius (w), item units.
    case splats([SIMD4<Float>], colour: SIMD3<Float>)
    /// A plane through the item's origin with this normal; `halfExtent` along its two in-plane axes.
    case plane(normal: SIMD3<Float>, halfExtent: Float, colour: SIMD3<Float>)
}

/// One thing to draw (§9.7).
public struct DrawItem: Sendable {
    public enum Kind: Sendable, Equatable {
        case leafMesh, atomInstances, box, splats, facePlane, atomsGPU, clusterSplats
    }

    /// The frame entity an item is parented to (§8.5).
    public enum Parent: Sendable, Equatable {
        /// The body's entity: transforms are `entityFromItem` relative to the anchor's local centre.
        case body(Int)
        /// The camera frame entity at `Cut.cameraFrameOrigin` (terrain and face planes).
        case cameraFrame
    }

    public var kind: Kind
    /// A resident handle: `Cut.path(of:)` turns it into the node's path. −1 for face planes.
    public var node: Int
    public var body: Int
    public var parent: Parent
    /// Float32 3×4: entityFromItem on RealityKit (§8.5).
    public var transform: Transform3x4
    public var fade: Float
    /// The display key's low 32 bits (§9.7).
    public var key32: UInt32
    public var extras: DrawExtras
    /// Half extents of the node's envelope about the item's origin, item units: the region the item stands for.
    public var halfExtents: SIMD3<Float>
}

/// The cut of one frame (§9.5).
public struct Cut: Sendable {
    public var items: [DrawItem]
    /// Each body's exact count; the HUD sums them when it can (§5.2).
    public var bodyCounts: [Magnitude]
    public var drawnAtoms: Int
    public var visited: Int
    public var overBudget: Bool
    /// Heap pops: never more than items + visits (§9.5).
    public var pops: Int
    /// Materializations requested for a later frame.
    public var requests: Int
    /// Leaf materializations done in this frame.
    public var materialized: Int
    /// The camera frame entity's origin (world, metres), kept within 2 m of the camera (§8.5).
    public var cameraFrameOrigin: SIMD3<Double>
    /// Budgets used, and the largest fraction of any (for the τ controller).
    public var usedItems: Int
    public var usedAtoms: Int
    public var usedBoxesAndSplats: Int
    public var largestUsage: Double
    /// Bodies whose node could not be resolved, with the error.
    public var failures: [Int: ScaleError]
    /// The bodies this cut drew, and each body entity's world pose: its anchor's local centre
    /// with `worldFromAnchor`'s rotation (§8.5).
    public var bodies: [BodyFrame]
    public var bodyEntities: [RigidD]

    /// Display keys of the nodes refined in this cut, for hysteresis (§9.1).
    var refined: KeySet
    var arena: [ArenaEntry]
    var bases: [[Step]]

    /// One step from a parent, without allocation.
    enum LiteStep: Sendable {
        case start
        case child(UInt16)
        case octant(UInt8)
        case digit(UInt8, axis: UInt8)
        case atoms
    }

    struct ArenaEntry: Sendable {
        var parent: Int32
        var base: Int32
        var step: LiteStep
    }

    /// The path of an item's node below its body's node (the steps after the body's ref path).
    public func path(of item: DrawItem) -> [Step]? { path(ofNode: item.node) }

    public func path(ofNode node: Int) -> [Step]? {
        guard node >= 0, node < arena.count else { return nil }
        var lites: [LiteStep] = []
        var i = Int32(node)
        var base: Int32 = -1
        while i >= 0 {
            let e = arena[Int(i)]
            lites.append(e.step)
            base = e.base
            i = e.parent
        }
        var steps = base >= 0 ? bases[Int(base)] : []
        for lite in lites.reversed() {
            switch lite {
            case .start, .atoms: break
            case let .child(c): steps.append(.child(c))
            case let .octant(o):
                if case let .cells(prev)? = steps.last {
                    steps[steps.count - 1] = .cells(prev + [o])
                } else {
                    steps.append(.cells([o]))
                }
            case let .digit(d, a):
                var runs: [[DigitRun]] = [[], [], []]
                runs[Int(a)] = [DigitRun(digit: d, length: 1)]
                if case let .tower(levels, prev)? = steps.last {
                    var merged = prev
                    merged[Int(a)] = AnchorPath.mergeRuns(prev[Int(a)], runs[Int(a)])
                    steps[steps.count - 1] = .tower(levels: levels + 1, runs: merged)
                } else {
                    steps.append(.tower(levels: 1, runs: runs))
                }
            }
        }
        return steps
    }

    /// Whether `ancestor` is a strict ancestor of `node` (both handles).
    public func isAncestor(_ ancestor: Int, of node: Int) -> Bool {
        guard node >= 0, node < arena.count else { return false }
        var i = arena[node].parent
        while i >= 0 {
            if Int(i) == ancestor { return true }
            i = arena[Int(i)].parent
        }
        return false
    }

    /// The handle of a node's parent in this cut, or −1 at a starting node.
    public func parent(of node: Int) -> Int { node >= 0 && node < arena.count ? Int(arena[node].parent) : -1 }
}
