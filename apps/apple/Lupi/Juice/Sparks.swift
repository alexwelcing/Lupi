import Foundation
import RealityKit
import UIKit

/// Spark bursts (plan §5.4): `ParticleEmitterComponent.burst()`, 0.25 s life, 0.4–1.2 m/s, in the
/// colours of the atoms that hit. Still comfort gets a static flash ring instead.
@MainActor
final class Sparks {
    let anchor = Entity()

    func burst(at position: SIMD3<Float>, count: Int, colours: [SIMD3<Float>], drift: Bool) {
        guard count > 0 else { return }
        var emitter = ParticleEmitterComponent()
        emitter.emitterShape = .sphere
        emitter.emitterShapeSize = SIMD3<Float>(repeating: 0.01)
        emitter.speed = 0.8
        emitter.speedVariation = 0.4
        emitter.isEmitting = false
        emitter.burstCount = count
        emitter.mainEmitter.lifeSpan = 0.25
        emitter.mainEmitter.size = 0.004
        emitter.mainEmitter.dampingFactor = drift ? 0 : 6
        emitter.mainEmitter.color = Self.colour(colours)
        spawn(emitter, at: position)
    }

    /// Still's static flash ring where sparks would fly.
    func flash(at position: SIMD3<Float>, colours: [SIMD3<Float>]) {
        var emitter = ParticleEmitterComponent()
        emitter.emitterShape = .torus
        emitter.emitterShapeSize = SIMD3<Float>(repeating: 0.03)
        emitter.speed = 0
        emitter.isEmitting = false
        emitter.burstCount = 24
        emitter.mainEmitter.lifeSpan = 0.15
        emitter.mainEmitter.size = 0.003
        emitter.mainEmitter.color = Self.colour(colours)
        spawn(emitter, at: position)
    }

    /// The small vanish of a body rescued or over budget (plan §3.3, §3.4).
    func poof(at position: SIMD3<Float>) {
        burst(at: position, count: 16, colours: [SIMD3<Float>(0.84, 0.94, 0.61)], drift: false)
    }

    private func spawn(_ emitter: ParticleEmitterComponent, at position: SIMD3<Float>) {
        let e = Entity()
        e.position = position
        e.components.set(emitter)
        anchor.addChild(e)
        // Not emitting continuously: one burst of `burstCount`, from the attached component.
        e.components[ParticleEmitterComponent.self]?.burst()
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1))
            e.removeFromParent()
        }
    }

    static func colour(_ colours: [SIMD3<Float>]) -> ParticleEmitterComponent.ParticleEmitter.ParticleColor {
        let a = colours.first ?? SIMD3<Float>(1, 1, 1)
        let b = colours.count > 1 ? colours[1] : a
        return .constant(.random(a: a.uiColor, b: b.uiColor))
    }
}
