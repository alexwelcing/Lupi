import Foundation
import LupiGame
import LupiScale
import RealityKit
import simd

/// Spike S7 (plan §8 M0): `MeshInstancesComponent` at 5,000 to 30,000 spheres split by element
/// colour, as the scale receipt draws them. A static cube of instanced atoms ahead of the camera;
/// the HUD's frame time is the measurement.
@MainActor
final class InstanceStress {
    let anchor = Entity()
    private var set: InstanceSet?
    private(set) var count = 0

    /// Sodium, chlorine, carbon and oxygen in turn, 2 mm spheres 6 mm apart.
    func show(_ n: Int, ahead camera: CameraState, assets: RenderAssets) {
        for child in Array(anchor.children) { child.removeFromParent() }
        set = nil
        count = n
        guard n > 0 else { return }
        let set = InstanceSet(parent: anchor)
        let side = Int(ceil(pow(Double(n), 1.0 / 3.0)))
        let spacing: Float = 0.006
        let half = Float(side - 1) * spacing / 2
        let elements: [UInt8] = [11, 17, 6, 8]
        for i in 0..<n {
            let p = SIMD3<Float>(Float(i % side), Float((i / side) % side), Float(i / (side * side))) * spacing - half
            let m = float4x4(diagonal: SIMD4<Float>(0.002, 0.002, 0.002, 1))
            var t = m
            t.columns.3 = SIMD4<Float>(p, 1)
            set.add(.atom(elements[i % elements.count]), t)
        }
        set.commit(assets)
        self.set = set
        anchor.position = (camera.position + camera.forward * 0.5).asFloat
    }
}

/// Spike S10 (plan §8 M0): a merged mesh of 1,000 and of 2,000 atoms, geometry built off the
/// main actor and the resource made on it, timed separately.
enum MeshBuildTiming {
    /// A simple cubic grid of carbon 1.5 Å apart: six bonds an atom inside, the worst case for bonds.
    static func grid(_ n: Int) -> LeafNode {
        let side = Int(ceil(pow(Double(n), 1.0 / 3.0)))
        var positions: [SIMD3<Float>] = []
        for i in 0..<n {
            positions.append(SIMD3<Float>(Float(i % side), Float((i / side) % side), Float(i / (side * side))) * 1.5)
        }
        return LeafNode(atomicNumbers: Array(repeating: 6, count: n), positions: positions)
    }

    @MainActor
    static func run(_ n: Int) async -> String {
        let clock = ContinuousClock()
        let start = clock.now
        let parts = await Task.detached(priority: .userInitiated) { () -> [MeshPart] in
            MeshBuilder.build(MeshRecipe.of(grid(n), centre: .zero, key: "s10-\(n)"))
        }.value
        let built = clock.now
        let triangles = parts.reduce(0) { $0 + $1.triangleCount }
        do {
            _ = try MeshResource.generate(from: RenderAssets.descriptors(parts))
        } catch {
            return "S10 \(n): resource failed: \(error.localizedDescription)"
        }
        let made = clock.now
        return "S10 \(n) atoms: geometry \(ms(built - start)) off main, resource \(ms(made - built)) on main, \(triangles / 1000)k triangles"
    }

    static func ms(_ d: Duration) -> String {
        let (s, a) = d.components
        return String(format: "%.1f ms", Double(s) * 1000 + Double(a) / 1e15)
    }
}
