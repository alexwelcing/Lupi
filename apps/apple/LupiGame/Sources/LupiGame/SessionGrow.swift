import Foundation
import LupiChem
import LupiScale
import LupiScaleCore

extension PlaySession {
    /// Whether Grow ×2 would take this body: the setting is on, and it is a toy whose piece
    /// materializes or is the root of a factor-2 tower (scale-spec §10.7).
    public func canGrow(_ id: BodyID) -> Bool {
        guard settings.growTwo, let b = bodies[id], b.isToy, b.frame.anchorPath.isEmpty else { return false }
        if b.identity.path.isEmpty, case let .tower(t)? = try? resolver.store.record(b.identity.root).node { return t.factor == 2 }
        guard let view = try? resolver.resolve(b.identity.root, b.identity.path) else { return false }
        return resolver.isMaterializable(view)
    }

    /// Grow ×2 (scale-spec §10.7, proposed; behind a setting until the owner confirms it): the body
    /// becomes a factor-2 tower one level taller, by the integer period rule, so the same water
    /// grows into the same record everywhere. It keeps its longest displayed span, so the molecules
    /// inside shrink and it stays a toy; a hundred taps on a water are 3 × 2^100 atoms.
    public mutating func grow(_ id: BodyID) {
        guard settings.growTwo else {
            out.events.append(.refused("Grow ×2 is off: turn it on in Settings"))
            return
        }
        guard var b = bodies[id], b.isToy, b.frame.anchorPath.isEmpty, flightState?.body != id, glide?.body != id else {
            out.events.append(.refused("Only a toy grows"))
            return
        }
        do {
            let (tower, seed) = try growRecords(BodyFrame(ref: b.identity, metresPerAnchorUnit: b.sigma), resolver: resolver)
            store.add([tower] + (seed.map { [$0] } ?? []))
            let ref = try ScaleRef.keep(root: tower.id, path: Path(), store: store)
            let facts = try BodyFacts.of(ref, resolver: resolver)
            let entity = b.entityPose
            let sigma = GrowRule.spanHoldingScale(old: b.facts.aggregate, oldScale: b.sigma, new: facts.aggregate)
            b.frame = BodyFrame(
                ref: ref,
                worldFromAnchor: RigidD(rotation: entity.rotation, translation: entity.translation - entity.rotation.act(sigma * facts.aggregate.centre)),
                metresPerAnchorUnit: sigma
            )
            b.identity = ref
            b.facts = facts
            b.feltMassKg = facts.feltMassKg
            if seed != nil { b.name = "\(b.name), grown" }
            // A tower of molecules is scale content now, whatever its seed was (contracts.md §1.3).
            b.provenance = .scale
            b.buildable = false
            b.spec = try BodyPhysics.spec(b, mode: b.mode, resting: false, now: time ?? 0, cameraInside: false, resolver: resolver)
            bodies[id] = b
            out.physics.append(.update(id, b.spec))
            hudCache.dirty = true
            out.events.append(.grew(id, count: facts.count.formatted))
            if let now = time { fire(.scaleDetent, on: b, at: entity.translation, direction: .zero, now: now) }
        } catch let e as ScaleError where e.code == .limit {
            out.events.append(.refused("This piece is too long and flat to grow"))
        } catch {
            out.events.append(.refused("Only a molecule-sized piece or a grown tower grows"))
        }
    }
}
