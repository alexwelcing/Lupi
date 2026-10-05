import Foundation
import LupiChem
import LupiScale
import LupiScaleCore

extension PlaySession {
    /// A chunk (a node 4 to 40 cm across, dragged out) or a chip (1 to 5 cm, held then pulled) from a
    /// monument or terrain (scale-spec §10.5, §10.6). The piece is its exact path and comes away as a
    /// new toy already in the hand; the body keeps the rest, a selection of the complement when it
    /// materializes, else a flattened edit.
    mutating func detach(_ id: BodyID, at point: SIMD2<Double>, band: ClosedRange<Double>, chip isChip: Bool, now: Double) {
        guard let b = bodies[id], b.sizeState != .toy, let camera, let cut = lastCut,
              let index = lastOrder.firstIndex(of: id) else { return }
        guard flightState?.body != id, glide?.body != id else {
            out.events.append(.refused("Wait for it to stop growing"))
            return
        }
        // No toy is ever made inside matter (§10.1).
        guard !cameraInsideTerrain else {
            out.events.append(.refused("Step out of the crystal to take a piece"))
            return
        }
        // A piece drawn through its own leaf has no smaller nodes to take.
        guard b.identity.root == b.frame.ref.root, b.identity.path == b.frame.ref.path else {
            out.events.append(.refused("This one comes away only whole"))
            return
        }
        var only = cut
        only.items = cut.items.filter { $0.body == index }
        guard let hit = pick(ray: camera.ray(through: point), cut: only, band: band, resolver: resolver), !hit.steps.isEmpty else {
            out.events.append(.refused(isChip
                ? "Nothing 1 to 5 cm across comes away here: pinch it bigger or smaller"
                : "Nothing 4 to 40 cm across comes away here: pinch it bigger or smaller"))
            return
        }
        let result: ChipResult
        do {
            result = try LupiScale.chip(b.frame, steps: hit.steps, resolver: resolver)
        } catch let e as ScaleError where e.code == .limit {
            out.events.append(.refused("This one is full: it holds all the holes it can"))
            return
        } catch {
            out.events.append(.refused("That piece will not come away: \(error)"))
            return
        }
        store.add(result.newRecords)

        // The rest stays where it was: an edit shares its base's frame, a selection its base's.
        var parent = b
        parent.frame.ref = result.remainder
        parent.identity = result.remainder
        do {
            parent.facts = try BodyFacts.of(result.remainder, resolver: resolver)
        } catch {
            out.events.append(.refused("That piece will not come away: \(error)"))
            return
        }
        parent.spec = (try? BodyPhysics.spec(
            parent, mode: parent.mode, resting: false, now: now, cameraInside: cameraInsideTerrain, resolver: resolver
        )) ?? parent.spec
        bodies[id] = parent
        out.physics.append(.update(id, parent.spec))
        terrainColliders.invalidate()
        hudCache.dirty = true

        // The piece, in the hand.
        do {
            let identity = try ScaleRef.keep(root: result.chip.root, path: result.chip.path, store: store)
            let view = try resolver.resolve(identity.root, identity.path)
            let display = try Restore.displayRef(identity, view: view, count: try resolver.count(view), resolver: resolver, store: store)
            let facts = try BodyFacts.of(display, resolver: resolver)
            let frame = BodyFrame(
                ref: display, worldFromAnchor: RigidD(rotation: hit.nodeRotation, translation: hit.nodeOrigin), metresPerAnchorUnit: hit.metresPerUnit
            )
            let span = hit.metresPerUnit * facts.aggregate.bounds.longest
            let piece = try addBody(
                frame: frame, identity: identity, facts: facts, name: "\(isChip ? "Chip" : "Chunk") of \(b.name)", brokenFrom: b.name,
                feltMass: nil, mode: .kinematic, now: now, spawnSpan: span, provenance: .piece(parent: parentRef(of: b))
            )
            guard var p = bodies[piece] else { return }
            p.floatUntil = -.infinity
            p.breakableAfter = now + BreakTuning.expansionCooldown
            p.buildable = p.facts.isMolecule
            p.snapAfter = now + BuildTuning.pieceGrace
            bodies[piece] = p
            out.events.append(.detached(from: id, piece: piece))
            fire(.breakApart(deltaV: BreakTuning.expansionFloor), on: b, at: hit.pointWorld, direction: camera.forward, now: now)
            // The finger that pulled it holds it.
            if arbiter.adoptGrab(piece, at: point, time: now) { beginGrab(piece, at: point, now: now) }
            selection = piece
        } catch {
            out.events.append(.refused("That piece will not come away: \(error)"))
        }
    }
}
