import Foundation
import LupiChem
import LupiGame
import RealityKit
import UIKit

/// Meshes and materials, made once and shared (plan §3.6): the glossy-toy look in true CPK colours.
@MainActor
final class RenderAssets {
    /// Unit sphere (radius 1) and unit cube (side 1), scaled per instance.
    let sphere = MeshResource.generateSphere(radius: 1)
    let cube = MeshResource.generateBox(size: 1)
    let plane = MeshResource.generatePlane(width: 1, depth: 1)

    private var elementMaterials: [UInt8: PhysicallyBasedMaterial] = [:]
    private var colourMaterials: [SIMD3<Int>: PhysicallyBasedMaterial] = [:]
    private var physics: [SIMD3<Int>: PhysicsMaterialResource] = [:]
    private(set) var meshes: [String: MeshResource] = [:]

    /// Candy gloss (plan §3.6): roughness 0.3, clearcoat 1.0 at roughness 0.05; metals metallic 0.6.
    func material(element z: UInt8) -> PhysicallyBasedMaterial {
        if let m = elementMaterials[z] { return m }
        let element = ChemicalElement.forAtomicNumber(Int(z))
        let c = element.cpk.srgb
        var m = glossy(UIColor(red: CGFloat(c.x), green: CGFloat(c.y), blue: CGFloat(c.z), alpha: 1))
        switch element.category {
        case .transitionMetal, .postTransitionMetal, .lanthanide, .actinide:
            m.metallic = PhysicallyBasedMaterial.Metallic(floatLiteral: 0.6)
        default:
            break
        }
        elementMaterials[z] = m
        return m
    }

    /// A box or splat in a node's aggregate colour (sRGB 0…1), quantized so similar colours share one.
    func material(colour: SIMD3<Float>) -> PhysicallyBasedMaterial {
        let key = SIMD3<Int>(Int(colour.x * 255), Int(colour.y * 255), Int(colour.z * 255))
        if let m = colourMaterials[key] { return m }
        let m = glossy(colour.uiColor)
        colourMaterials[key] = m
        return m
    }

    func glossy(_ colour: UIColor) -> PhysicallyBasedMaterial {
        var m = PhysicallyBasedMaterial()
        m.baseColor = PhysicallyBasedMaterial.BaseColor(tint: colour)
        m.roughness = PhysicallyBasedMaterial.Roughness(floatLiteral: 0.3)
        m.metallic = PhysicallyBasedMaterial.Metallic(floatLiteral: 0)
        m.clearcoat = PhysicallyBasedMaterial.Clearcoat(floatLiteral: 1)
        m.clearcoatRoughness = PhysicallyBasedMaterial.ClearcoatRoughness(floatLiteral: 0.05)
        return m
    }

    func physicsMaterial(_ s: SurfaceMaterial) -> PhysicsMaterialResource {
        let key = SIMD3<Int>(Int(s.staticFriction * 1000), Int(s.dynamicFriction * 1000), Int(s.restitution * 1000))
        if let m = physics[key] { return m }
        let m = PhysicsMaterialResource.generate(
            staticFriction: Float(s.staticFriction), dynamicFriction: Float(s.dynamicFriction), restitution: Float(s.restitution)
        )
        physics[key] = m
        return m
    }

    // MARK: Merged meshes (plan §3.6, scale-spec §9.6)

    func mesh(_ key: String) -> MeshResource? { meshes[key] }

    /// One descriptor per element, each with its own material slot, in the parts' order.
    func makeMesh(_ key: String, parts: [MeshPart]) throws -> MeshResource {
        if let m = meshes[key] { return m }
        let mesh = try MeshResource.generate(from: Self.descriptors(parts))
        meshes[key] = mesh
        return mesh
    }

    static func descriptors(_ parts: [MeshPart]) -> [MeshDescriptor] {
        parts.enumerated().map { i, part in
            var d = MeshDescriptor(name: "z\(part.atomicNumber)")
            d.positions = MeshBuffers.Positions(part.positions)
            d.normals = MeshBuffers.Normals(part.normals)
            d.primitives = .triangles(part.indices)
            d.materials = .allFaces(UInt32(i))
            return d
        }
    }
}
