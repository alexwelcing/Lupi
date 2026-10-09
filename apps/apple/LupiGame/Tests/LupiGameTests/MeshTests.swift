import Foundation
import LupiChem
import LupiGame
import LupiScale
import LupiScaleCore
import Testing

/// Merged-mesh geometry (plan §3.6), the part of the M0 look that needs no device.
@Suite("merged meshes")
struct MeshTests {
    @Test func icospheresHaveEightyAndThreeHundredTwentyTriangles() {
        #expect(Icosphere.unit(subdivisions: 1).indices.count / 3 == 80)
        #expect(Icosphere.unit(subdivisions: 2).indices.count / 3 == 320)
        #expect(Icosphere.unit(subdivisions: 2).vertices.allSatisfy { abs((($0 * $0).sum()).squareRoot() - 1) < 1e-5 })
        // Counter-clockwise from outside: every face normal points away from the centre.
        let s = Icosphere.unit(subdivisions: 1)
        for f in stride(from: 0, to: s.indices.count, by: 3) {
            let a = s.vertices[Int(s.indices[f])], b = s.vertices[Int(s.indices[f + 1])], c = s.vertices[Int(s.indices[f + 2])]
            let u = b - a, v = c - a
            let n = SIMD3<Float>(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x)
            #expect(((a + b + c) * n).sum() > 0)
        }
    }

    @Test func caffeineIsOnePartPerElementWithHalfBonds() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "caffeine", settle: 0.1)
        let recipe = try #require(sim.session.meshRecipe(for: id))
        #expect(recipe.atoms.count == 24)
        #expect(recipe.bonds.count == 25)
        #expect(recipe.atoms.allSatisfy { $0.radius >= 0.32 && $0.radius <= 0.9 })
        let parts = MeshBuilder.build(recipe)
        #expect(parts.map(\.atomicNumber) == [1, 6, 7, 8])
        for p in parts {
            #expect(p.positions.count == p.normals.count)
            #expect(p.indices.allSatisfy { Int($0) < p.positions.count })
            #expect(p.indices.count % 3 == 0)
        }
        // 24 spheres of 320 triangles, and 50 half-bonds of 24 triangles.
        #expect(parts.reduce(0) { $0 + $1.triangleCount } == 24 * 320 + 50 * 24)
        // Positions sit about the node's local centre, as the cut's leafMesh item places them.
        let b = try #require(sim.session.body(id))
        let half = b.facts.aggregate.bounds.halfExtents
        #expect(recipe.atoms.allSatisfy { abs(Double($0.position.x)) <= half.x && abs(Double($0.position.y)) <= half.y })
        // The same molecule shares one recipe.
        let other = Fixture.spawn(&sim, "caffeine", settle: 0.1)
        #expect(sim.session.meshRecipe(for: other)?.key == recipe.key)
    }

    @Test func ionicContactsAreDotted() throws {
        var sim = Fixture.sim()
        let id = Fixture.spawn(&sim, "salt_cluster", settle: 0.1)
        let recipe = try #require(sim.session.meshRecipe(for: id))
        #expect(recipe.bonds.count == 12)
        #expect(recipe.bonds.allSatisfy { $0.kind == .ionicContact })
        let parts = MeshBuilder.build(recipe)
        // No cylinders: 8 spheres of 320 triangles and dots of 20.
        let dots = parts.reduce(0) { $0 + $1.triangleCount } - 8 * 320
        #expect(dots > 0 && dots % 20 == 0)
    }

    /// Crystals and towers draw through the cut, never as one merged mesh.
    @Test func crystalsHaveNoMergedMesh() {
        var sim = Fixture.sim()
        let id = Fixture.spawnSalt(&sim, .million, settle: 0.1)
        #expect(sim.session.meshRecipe(for: id) == nil)
    }
}
