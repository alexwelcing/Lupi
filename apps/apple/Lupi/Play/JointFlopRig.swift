import Foundation
import LupiChem
import LupiGame
import LupiPlay
import RealityKit
import simd

/// Spike A6 (plan §8 M4): the selected flexible molecule's flop segments as separate dynamic
/// bodies joined by RealityKit spherical joints (iOS 18), tossed beside the game's own flop,
/// which draws the bend on one rigid body. The HUD line says whether the joints hold (the gap
/// between each pair of pins), how far they bend and whether a part was lost. The game keeps
/// the drawn flop unless this shows joints that are stable, cheap and better to look at.
@MainActor
final class JointFlopRig {
    let anchor = Entity()
    private var parts: [ModelEntity] = []
    private var hinges: [(parent: Int, child: Int, pin0: GeometricPin, pin1: GeometricPin)] = []
    private var started: TimeInterval = 0
    private var worstGap: Float = 0
    private var widest: Float = 0
    private(set) var line: String?

    var isActive: Bool { !parts.isEmpty }

    /// Builds and tosses the jointed copy. `recipes` are the segments' meshes (built already, as
    /// the body draws them), `metresPerAngstrom` the body's scale, `origin` where its recipe
    /// frame's origin goes, `velocity` the toss.
    func toss(
        segments: FlopSegments, recipes: [MeshRecipe], metresPerAngstrom: Float, origin: SIMD3<Float>, velocity: SIMD3<Float>,
        assets: RenderAssets, material: PhysicsMaterialResource, now: TimeInterval
    ) -> String {
        clear()
        guard recipes.count == segments.count else { return "A6: the segments' meshes are not built yet; let it rest first" }
        let total = segments.segments.reduce(0) { $0 + $1.mass }
        for (k, seg) in segments.segments.enumerated() {
            let centroid = seg.centroid.asFloat
            let part = ModelEntity()
            part.position = origin + centroid * metresPerAngstrom
            if let mesh = assets.mesh(recipes[k].key) {
                let model = ModelEntity(mesh: mesh, materials: PlayScene.materials(recipes[k], assets))
                // The mesh is in the recipe's frame (Å): scale it, and put the centroid at the part's origin.
                model.transform = Transform(scale: SIMD3<Float>(repeating: metresPerAngstrom), rotation: simd_quatf(ix: 0, iy: 0, iz: 0, r: 1),
                                            translation: -centroid * metresPerAngstrom)
                part.addChild(model)
            }
            // One sphere around the segment's atoms; enough to bounce and to compare.
            let reach = recipes[k].atoms.map { simd_length($0.position - centroid) + $0.radius }.max() ?? 1
            let radius = max(0.01, reach * metresPerAngstrom)
            let mass = Float(0.3 * seg.mass / max(total, 1))
            let inertia = SIMD3<Float>(repeating: 0.4 * mass * radius * radius)
            part.components.set(CollisionComponent(shapes: [ShapeResource.generateSphere(radius: radius)]))
            var body = PhysicsBodyComponent(massProperties: PhysicsMassProperties(mass: mass, inertia: inertia), material: material, mode: .dynamic)
            body.isContinuousCollisionDetectionEnabled = true
            part.components.set(body)
            part.components.set(PhysicsMotionComponent(linearVelocity: velocity, angularVelocity: .zero))
            anchor.addChild(part)
            parts.append(part)
        }
        var made = 0
        for (k, seg) in segments.segments.enumerated() {
            guard let parent = seg.parent else { continue }
            let pivot = seg.pivot.asFloat
            let arm = seg.centroid.asFloat - pivot
            // The cone's axis (each pin's x) along the arm, the same in both pins, so the joint starts straight.
            let axis = simd_length(arm) > 1e-6 ? simd_normalize(arm) : SIMD3<Float>(1, 0, 0)
            let orientation = simd_quatf(from: SIMD3<Float>(1, 0, 0), to: axis)
            let pin0 = parts[parent].pins.set(
                named: "a6-hinge-\(k)", position: (pivot - segments.segments[parent].centroid.asFloat) * metresPerAngstrom, orientation: orientation
            )
            let pin1 = parts[k].pins.set(named: "a6-hinge-\(k)", position: (pivot - seg.centroid.asFloat) * metresPerAngstrom, orientation: orientation)
            let joint = PhysicsSphericalJoint(pin0: pin0, pin1: pin1, angularLimitInYZ: (0.6, 0.6), checksForInternalCollisions: false)
            do {
                try joint.addToSimulation()
                hinges.append((parent, k, pin0, pin1))
                made += 1
            } catch {
                return "A6: joint \(k) refused: \(error.localizedDescription)"
            }
        }
        started = now
        return "A6: tossed \(parts.count) jointed parts, \(made) joints"
    }

    /// Measures the joints each frame: the gap between paired pins, the bend, and lost parts.
    func update(now: TimeInterval, floorY: Double?) {
        guard !parts.isEmpty else { return }
        for h in hinges {
            if let a = h.pin0.position(relativeTo: nil), let b = h.pin1.position(relativeTo: nil) { worstGap = max(worstGap, simd_length(a - b)) }
            let q = parts[h.parent].orientation(relativeTo: nil).inverse * parts[h.child].orientation(relativeTo: nil)
            widest = max(widest, 2 * acos(min(1, abs(q.real))))
        }
        let lost = parts.filter { p in
            let y = Double(p.position(relativeTo: nil).y)
            return !y.isFinite || floorY.map { y < $0 - 0.5 } ?? false
        }.count
        line = String(
            format: "A6 joints: %d parts, worst pin gap %.1f mm, widest bend %.0f°, %d lost, %.1f s",
            parts.count, worstGap * 1000, widest * 180 / .pi, lost, now - started
        )
        if now - started > 20 { clear() }
    }

    func clear() {
        for p in parts { p.removeFromParent() }
        parts = []
        hinges = []
        worstGap = 0
        widest = 0
    }
}
