import Foundation
import LupiChem
import LupiGame
import LupiScale
import RealityKit
import simd

/// One instanced mesh in one material: atoms of an element, boxes or splats of a colour
/// (scale.md §4.1). `MeshInstancesComponent` instances the entity's own model.
@MainActor
final class InstanceGroup {
    let entity: Entity
    let mesh: MeshResource
    private var data: LowLevelInstanceData?
    private var capacity = 0
    private var bounds: BoundingBox?

    init(mesh: MeshResource, material: any Material, parent: Entity, shadow: Bool) {
        self.mesh = mesh
        entity = Entity()
        entity.components.set(ModelComponent(mesh: mesh, materials: [material]))
        if shadow { entity.components.set(GroundingShadowComponent(castsShadow: true)) }
        entity.isEnabled = false
        parent.addChild(entity)
    }

    /// This frame's instances, in the parent's space. An empty list hides the group.
    func set(_ transforms: [float4x4], radius: Float) {
        guard !transforms.isEmpty else {
            entity.isEnabled = false
            return
        }
        do {
            var replaced = false
            if data == nil || transforms.count > capacity {
                capacity = max(64, transforms.count * 2)
                data = try LowLevelInstanceData(instanceCount: transforms.count, instanceCapacity: capacity)
                replaced = true
            }
            guard let data else { return }
            data.instanceCount = transforms.count
            data.withMutableTransforms { buffer in
                for i in 0..<transforms.count { buffer[i] = transforms[i] }
            }
            // Bounds of every instance, so none is culled by the base mesh's own bounds.
            var lo = SIMD3<Float>(repeating: .infinity), hi = SIMD3<Float>(repeating: -.infinity)
            for m in transforms {
                let p = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
                let s = max(simd_length(m.columns.0), simd_length(m.columns.1), simd_length(m.columns.2)) * radius
                lo = simd_min(lo, p - s)
                hi = simd_max(hi, p + s)
            }
            let box = BoundingBox(min: lo, max: hi)
            if replaced || bounds.map({ !($0.contains(box)) }) ?? true {
                let grown = BoundingBox(min: box.min - (box.max - box.min) * 0.25, max: box.max + (box.max - box.min) * 0.25)
                bounds = grown
                entity.components.set(try MeshInstancesComponent(mesh: mesh, instances: data, bounds: grown))
            }
            entity.isEnabled = true
        } catch {
            entity.isEnabled = false
        }
    }
}

/// Instance groups under one parent, keyed by what they draw.
@MainActor
final class InstanceSet {
    enum Key: Hashable {
        case atom(UInt8)
        case box(SIMD3<Int>)
        case splat(SIMD3<Int>)
    }

    let parent: Entity
    private var groups: [Key: InstanceGroup] = [:]
    private var pending: [Key: [float4x4]] = [:]

    init(parent: Entity) { self.parent = parent }

    func add(_ key: Key, _ m: float4x4) { pending[key, default: []].append(m) }

    var atomCount: Int { pending.reduce(0) { if case .atom = $1.key { return $0 + $1.value.count }; return $0 } }

    /// Writes this frame's instances and hides the groups nothing drew into.
    func commit(_ assets: RenderAssets) {
        for (key, list) in pending where groups[key] == nil {
            guard !list.isEmpty else { continue }
            switch key {
            case let .atom(z):
                groups[key] = InstanceGroup(mesh: assets.sphere, material: assets.material(element: z), parent: parent, shadow: false)
            case let .box(c):
                groups[key] = InstanceGroup(mesh: assets.cube, material: assets.material(colour: Self.colour(c)), parent: parent, shadow: true)
            case let .splat(c):
                groups[key] = InstanceGroup(mesh: assets.sphere, material: assets.material(colour: Self.colour(c)), parent: parent, shadow: false)
            }
        }
        for (key, group) in groups {
            let radius: Float = if case .box = key { 0.9 } else { 1 }
            group.set(pending[key] ?? [], radius: radius)
        }
        pending.removeAll(keepingCapacity: true)
    }

    static func key(_ c: SIMD3<Float>) -> SIMD3<Int> { SIMD3<Int>(Int(c.x * 255), Int(c.y * 255), Int(c.z * 255)) }
    static func colour(_ k: SIMD3<Int>) -> SIMD3<Float> { SIMD3<Float>(Float(k.x), Float(k.y), Float(k.z)) / 255 }
}

/// A body's entities (plan §3.2): the physics entity RealityKit moves, and below it the render
/// chain that carries pop-in, lean and hit-stop, then squash about its axis (plan §5.4). The
/// cut's items hang below the chain, so the collider and the drawing move together.
@MainActor
final class BodyRig {
    let id: BodyID
    let entity = ModelEntity()
    let render = Entity()
    let squash = Entity()
    let unsquash = Entity()
    let instances: InstanceSet
    var meshEntity: ModelEntity?
    var meshKey: String?
    var spec: PhysicsSpec

    init(id: BodyID, spec: PhysicsSpec) {
        self.id = id
        self.spec = spec
        entity.addChild(render)
        render.addChild(squash)
        squash.addChild(unsquash)
        instances = InstanceSet(parent: unsquash)
    }

    func apply(_ r: RenderState) {
        render.transform = Transform(scale: SIMD3<Float>(repeating: Float(r.scale)), rotation: r.rotation.simd, translation: r.translation.asFloat)
        let axis = r.squashAxis.simd
        squash.transform = Transform(scale: r.squash.asFloat, rotation: axis, translation: .zero)
        unsquash.transform = Transform(scale: SIMD3<Float>(repeating: 1), rotation: axis.inverse, translation: .zero)
    }
}

/// The RealityKit side of the play session: bodies from physics commands, and every frame the
/// cut's draw items as merged meshes, instanced atoms and instanced boxes (scale-spec §9.7).
@MainActor
final class PlayScene {
    let root = Entity()
    /// Terrain and face planes hang here, kept near the camera (scale-spec §8.5).
    let cameraFrame = Entity()
    let assets = RenderAssets()
    private(set) var rigs: [BodyID: BodyRig] = [:]
    private var byEntity: [Entity.ID: BodyID] = [:]
    private let cameraInstances: InstanceSet
    private var building: Set<String> = []
    private var built: [(key: String, parts: [MeshPart], atoms: Int, seconds: Double)] = []
    /// The last merged-mesh build: geometry off the main actor, resource on it (spike S10).
    private(set) var lastMeshBuild: (atoms: Int, milliseconds: Double)?
    private(set) var drawnInstances = 0
    /// A terrain's face planes and atom windows (scale-spec §10.1), and spike S8's timing.
    let statics: StaticColliders

    init() {
        root.addChild(cameraFrame)
        cameraInstances = InstanceSet(parent: cameraFrame)
        statics = StaticColliders(parent: root)
    }

    func body(of entity: Entity) -> BodyID? { byEntity[entity.id] }

    func position(of id: BodyID) -> SIMD3<Float>? { rigs[id].map { $0.entity.position(relativeTo: nil) } }

    func entity(of id: BodyID) -> Entity? { rigs[id]?.entity }

    // MARK: Physics commands

    func apply(_ commands: [PhysicsCommand], poof: (SIMD3<Float>) -> Void) {
        for command in commands {
            switch command {
            case let .create(id, spec, pose):
                let rig = BodyRig(id: id, spec: spec)
                // A pose binary64 cannot place (a terrain deep in its anchor) keeps the origin.
                if pose.allFinite { rig.entity.transform = pose.transform }
                configure(rig, spec)
                root.addChild(rig.entity)
                rigs[id] = rig
                byEntity[rig.entity.id] = id
            case let .update(id, spec):
                guard let rig = rigs[id] else { continue }
                configure(rig, spec)
            case let .setMode(id, mode):
                guard let rig = rigs[id] else { continue }
                rig.spec.mode = mode
                if var body = rig.entity.components[PhysicsBodyComponent.self] {
                    body.mode = Self.mode(mode)
                    rig.entity.components.set(body)
                }
                if mode == .dynamic { rig.entity.components.set(PhysicsMotionComponent()) }
            case let .move(id, pose, v, w):
                guard let rig = rigs[id], pose.allFinite else { continue }
                rig.entity.transform = pose.transform
                rig.entity.components.set(PhysicsMotionComponent(linearVelocity: v.asFloat, angularVelocity: w.asFloat))
            case let .launch(id, linear, angular):
                // The velocity arrives once, as impulses (plan §3.5 step 4).
                guard let rig = rigs[id] else { continue }
                rig.entity.components.set(PhysicsMotionComponent())
                rig.entity.applyLinearImpulse(linear.asFloat, relativeTo: nil)
                rig.entity.applyAngularImpulse(angular.asFloat, relativeTo: nil)
            case let .setVelocity(id, linear, angular):
                rigs[id]?.entity.components.set(PhysicsMotionComponent(linearVelocity: linear.asFloat, angularVelocity: angular.asFloat))
            case let .setDamping(id, linear, angular):
                guard let rig = rigs[id], var body = rig.entity.components[PhysicsBodyComponent.self] else { continue }
                body.linearDamping = Float(linear)
                body.angularDamping = Float(angular)
                rig.entity.components.set(body)
            case let .park(id, parked):
                rigs[id]?.entity.isEnabled = !parked
            case let .remove(id, wasPoof):
                guard let rig = rigs.removeValue(forKey: id) else { continue }
                if wasPoof { poof(rig.entity.position(relativeTo: nil)) }
                byEntity[rig.entity.id] = nil
                rig.entity.removeFromParent()
            case let .staticColliders(key, origin, shapes, material):
                statics.apply(key, origin: origin, shapes: shapes, material: assets.physicsMaterial(material))
            }
        }
    }

    /// The body and collision components of a spec. No shapes means no physics (a terrain the
    /// camera stands in, a body gliding through the room).
    private func configure(_ rig: BodyRig, _ s: PhysicsSpec) {
        rig.spec = s
        // No physics for a spec binary64 cannot state either: a non-finite shape or mass would
        // poison the simulation.
        guard !s.shapes.isEmpty, s.shapes.allSatisfy(\.allFinite), s.massKg.isFinite, s.principalMoments.allFinite else {
            rig.entity.components.remove(PhysicsBodyComponent.self)
            rig.entity.components.remove(CollisionComponent.self)
            return
        }
        let mass = PhysicsMassProperties(
            mass: Float(s.massKg), inertia: s.principalMoments.asFloat,
            centerOfMass: (position: s.centreOfMass.asFloat, orientation: s.principalRotation.simd)
        )
        var body = PhysicsBodyComponent(massProperties: mass, material: assets.physicsMaterial(s.material), mode: Self.mode(s.mode))
        body.linearDamping = Float(s.linearDamping)
        body.angularDamping = Float(s.angularDamping)
        body.isContinuousCollisionDetectionEnabled = s.continuousCollision
        rig.entity.components.set(CollisionComponent(shapes: s.shapes.map(Self.shape)))
        rig.entity.components.set(body)
        if rig.entity.components[PhysicsMotionComponent.self] == nil { rig.entity.components.set(PhysicsMotionComponent()) }
    }

    static func mode(_ m: MotionMode) -> PhysicsBodyMode {
        switch m {
        case .dynamic: .dynamic
        case .kinematic: .kinematic
        case .static: .static
        }
    }

    /// LupiScale's proxies in metres about the body entity's origin (scale-spec §10.4).
    static func shape(_ s: CollisionShape) -> ShapeResource {
        switch s {
        case let .sphere(c, r):
            return ShapeResource.generateSphere(radius: Float(r)).offsetBy(translation: c.asFloat)
        case let .box(c, h, q):
            return ShapeResource.generateBox(size: (h * 2).asFloat).offsetBy(rotation: q.simd, translation: c.asFloat)
        case let .convex(points):
            return ShapeResource.generateConvex(from: points.map(\.asFloat))
        }
    }

    // MARK: Physics out

    /// Each enabled body's pose and velocity, as physics has them now (scale-spec §8.3).
    func motions() -> [BodyID: BodyMotion] {
        var out: [BodyID: BodyMotion] = [:]
        for (id, rig) in rigs where rig.entity.isEnabled {
            let pose = RigidD(
                rotation: Quat(rig.entity.orientation(relativeTo: nil)),
                translation: rig.entity.position(relativeTo: nil).asDouble
            )
            let m = rig.entity.components[PhysicsMotionComponent.self]
            out[id] = BodyMotion(
                pose: pose, linearVelocity: (m?.linearVelocity ?? .zero).asDouble, angularVelocity: (m?.angularVelocity ?? .zero).asDouble
            )
        }
        return out
    }

    // MARK: Drawing the cut (scale-spec §9.7)

    /// Applies the render children and draws the cut. `recipe` gives a molecule body's merged
    /// mesh; until it is built (at most one a frame, off the main actor) the body draws its atoms
    /// instanced, and the mesh takes over once the body may swap (scale-spec §9.6).
    func draw(_ out: FrameOutput, recipe: (BodyID) -> MeshRecipe?) {
        finishOneMesh()
        for (id, rig) in rigs {
            if let r = out.renders[id] { rig.apply(r) }
        }
        guard let cut = out.cut else { return }
        cameraFrame.position = cut.cameraFrameOrigin.asFloat
        var drewMesh: Set<BodyID> = []
        for item in cut.items {
            let target: InstanceSet
            var rig: BodyRig?
            switch item.parent {
            case let .body(b):
                guard b < out.bodyOrder.count, let r = rigs[out.bodyOrder[b]] else { continue }
                rig = r
                target = r.instances
            case .cameraFrame:
                target = cameraInstances
            }
            switch item.extras {
            case let .atoms(runs):
                if item.kind == .leafMesh, let rig, let r = recipe(rig.id) {
                    if drawMesh(rig, recipe: r, item: item, swapAllowed: out.renders[rig.id]?.meshSwapAllowed ?? true) {
                        drewMesh.insert(rig.id)
                        continue
                    }
                }
                for run in runs {
                    for p in run.positions {
                        target.add(.atom(run.atomicNumber), item.transform.instance(at: p, scale: SIMD3<Float>(repeating: run.radius)))
                    }
                }
            case let .box(half, colour):
                target.add(.box(InstanceSet.key(colour)), item.transform.instance(at: .zero, scale: half * 2))
            case let .splats(spheres, colour):
                for s in spheres {
                    target.add(.splat(InstanceSet.key(colour)), item.transform.instance(at: SIMD3<Float>(s.x, s.y, s.z), scale: SIMD3<Float>(repeating: s.w)))
                }
            case let .plane(normal, half, colour):
                // A thin box across the plane: no separate plane pipeline before LupiEngine.
                let q = simd_quatf(from: SIMD3<Float>(0, 1, 0), to: simd_normalize(normal))
                let local = float4x4(q) * float4x4(diagonal: SIMD4<Float>(half * 2, 0.002, half * 2, 1))
                target.add(.box(InstanceSet.key(colour)), item.transform.matrix * local)
            }
        }
        var atoms = 0
        for (id, rig) in rigs {
            if !drewMesh.contains(id) { rig.meshEntity?.isEnabled = false }
            atoms += rig.instances.atomCount
            rig.instances.commit(assets)
        }
        atoms += cameraInstances.atomCount
        cameraInstances.commit(assets)
        drawnInstances = atoms
    }

    /// The merged mesh of a molecule, when it is built and the body may swap to it.
    private func drawMesh(_ rig: BodyRig, recipe: MeshRecipe, item: DrawItem, swapAllowed: Bool) -> Bool {
        guard let mesh = assets.mesh(recipe.key) else {
            requestMesh(recipe)
            return false
        }
        if rig.meshKey != recipe.key {
            // Shading parity between instances and the mesh is unconfirmed, so a moving body
            // keeps its instances until it rests or is small on screen.
            guard swapAllowed else { return false }
            rig.meshEntity?.removeFromParent()
            // Parts come one per element, in increasing atomic number.
            let elements = Set(recipe.atoms.map(\.atomicNumber)).sorted()
            let entity = ModelEntity(mesh: mesh, materials: elements.map { assets.material(element: $0) })
            entity.components.set(GroundingShadowComponent(castsShadow: true))
            rig.unsquash.addChild(entity)
            rig.meshEntity = entity
            rig.meshKey = recipe.key
        }
        rig.meshEntity?.transform = Transform(matrix: item.transform.matrix)
        rig.meshEntity?.isEnabled = true
        return true
    }

    private func requestMesh(_ recipe: MeshRecipe) {
        guard !building.contains(recipe.key) else { return }
        building.insert(recipe.key)
        Task { [weak self] in
            let start = Date()
            let parts = await Task.detached(priority: .userInitiated) { MeshBuilder.build(recipe) }.value
            self?.built.append((recipe.key, parts, recipe.atoms.count, Date().timeIntervalSince(start)))
        }
    }

    /// At most one merged mesh becomes a resource per frame (scale-spec §9.3).
    private func finishOneMesh() {
        guard !built.isEmpty else { return }
        let next = built.removeFirst()
        let start = Date()
        _ = try? assets.makeMesh(next.key, parts: next.parts)
        lastMeshBuild = (next.atoms, (next.seconds + Date().timeIntervalSince(start)) * 1000)
    }
}
