import Foundation
import LupiChem
import LupiData
import LupiPlay
import LupiScale
import LupiScaleCore

extension PlaySession {
    // MARK: Contacts in (plan §4.4, §5)

    mutating func handleContacts(_ contacts: [PlayContact], now: Double) {
        for c in contacts {
            let ma = c.a.flatMap { bodies[$0]?.feltMassKg }
            let mb = c.b.flatMap { bodies[$0]?.feltMassKg }
            // A contact with a body that is already gone (broken this frame) is dropped.
            if (c.a != nil && ma == nil) || (c.b != nil && mb == nil) { continue }
            let dv = JuiceRouter.deltaV(impulse: c.impulse, massA: ma, massB: mb)
            for id in [c.a, c.b].compactMap({ $0 }) {
                guard var b = bodies[id] else { continue }
                let other = id == c.a ? c.b : c.a
                b.lastContact = c.time
                if c.position.y < b.entityPose.translation.y, abs(c.direction.normalized.y) > 0.707 {
                    b.lastSupportContact = c.time
                    b.support = other.map { .body($0) } ?? .room(c.position)
                }
                if abs(c.impulse) > PlayTuning.wakeImpulse && b.atRest && dv > 0.2 { wake(&b) }
                // A shelved trophy held in place lets go when something hits it (plan §6.4).
                if b.frozen, other != nil, abs(c.impulse) > PlayTuning.wakeImpulse { unfreeze(&b) }
                bodies[id] = b
            }
            let (_, playNow) = juice.observe(c, deltaV: dv)
            if playNow { playImpact(a: c.a, b: c.b, deltaV: dv, position: c.position, direction: c.direction, now: now) }
            if abs(c.impulse) > 0 { lastImpact = LastImpact(impulse: abs(c.impulse), deltaV: dv) }
        }
        for (key, w) in juice.closing(at: now) {
            if !w.fired { playImpact(a: key.first, b: key.second, deltaV: w.deltaV, position: w.position, direction: w.direction, now: now) }
            for id in [key.first, key.second].compactMap({ $0 }) {
                tryBreak(id, deltaV: w.deltaV, at: w.position, direction: w.direction, now: now)
            }
        }
    }

    /// The impact cue of one hit: on the room, or between two bodies.
    mutating func playImpact(a: BodyID?, b: BodyID?, deltaV: Double, position: Vec3, direction: Vec3, now: Double) {
        switch (a.flatMap { bodies[$0] }, b.flatMap { bodies[$0] }) {
        case let (x?, y?):
            fire(.collision(deltaV: deltaV, other: JuiceBody(y)), on: x, at: position, direction: direction, now: now, other: y)
        case let (x?, nil), let (nil, x?):
            if x.atRest && deltaV < 0.3 { return }
            let surface = SurfaceGuess.classify(direction: direction, position: position, floorY: floorY)
            fire(.impact(deltaV: deltaV, surface: surface), on: x, at: position, direction: direction, now: now)
        case (nil, nil):
            return
        }
    }

    /// Plays a juice event on a body and applies its visuals to the body's render child.
    mutating func fire(_ event: JuiceEvent, on body: Body, at position: Vec3, direction: Vec3, now: Double, other: Body? = nil) {
        guard let output = juice.director.fire(event, body: JuiceBody(body), at: now) else { return }
        applyVisual(output.visual, to: body.id, direction: direction, squash: output.visual.squash, now: now)
        if let o = other { applyVisual(JuiceVisual(), to: o.id, direction: -1 * direction, squash: output.visual.otherSquash, now: now) }
        out.juice.append(JuiceCue(
            body: bodies[body.id] != nil ? body.id : nil, position: position, direction: direction, output: output,
            sparkColours: sparkColours(body, near: position)
        ))
    }

    mutating func applyVisual(_ v: JuiceVisual, to id: BodyID, direction: Vec3, squash amount: Double, now: Double) {
        guard var b = bodies[id] else { return }
        if amount > 0, direction.lengthSquared > 0 {
            let local = b.entityPose.rotation.inverted.act(direction)
            b.effects.squash.hit(direction: local, amount: amount)
        }
        if v.hitStop { b.effects.hitStop.hit(intensity: 1, comfort: settings.comfort, at: b.entityPose.translation) }
        if v.slowMotion { slowMotionStart = now }
        bodies[id] = b
    }

    /// The colours of the two atoms nearest the contact, or the aggregate colour (plan §5.3).
    func sparkColours(_ b: Body, near world: Vec3) -> [SIMD3<Float>] {
        let agg = b.facts.aggregate
        let fallback = [SIMD3<Float>(Float(agg.colour.x), Float(agg.colour.y), Float(agg.colour.z))]
        guard b.facts.isMolecule, b.frame.anchorPath.isEmpty,
              let view = try? resolver.resolve(b.frame.ref.root, b.frame.ref.path),
              let leaf = try? resolver.materialize(view) else { return fallback }
        let x = b.frame.anchorPoint(world)
        let order = leaf.positions.indices.sorted {
            (Vec3(leaf.positions[$0]) - x).lengthSquared < (Vec3(leaf.positions[$1]) - x).lengthSquared
        }
        let picked = order.prefix(2).map { i -> SIMD3<Float> in
            let c = ChemicalElement.forAtomicNumber(Int(leaf.atomicNumbers[i])).cpk.srgb
            return SIMD3(Float(c.x), Float(c.y), Float(c.z))
        }
        return picked.isEmpty ? fallback : picked
    }

    // MARK: Breaks (plan §4.4, scale-spec §10.6)

    /// Breaks a body when the hit's Δv reaches its threshold: a bond break for a molecule with a
    /// bridge, an expansion of one level for anything else. Pieces inherit the parent's velocity
    /// at their centre plus 0.4 m/s outward.
    mutating func tryBreak(_ id: BodyID, deltaV: Double, at contact: Vec3, direction: Vec3, now: Double) {
        guard let body = bodies[id], body.isToy, !body.parked, !body.frozen, now >= body.breakableAfter,
              grab?.body != id, pinch?.body != id, body.frame.anchorPath.isEmpty else { return }
        let p = body.facts.personality.personality
        // A molecule whose only bridges are 800 kJ/mol or more never breaks (N₂, CO, plan §4.3).
        if body.facts.isMolecule, p.isUnbreakable, body.facts.personality.features.cutStrength != nil { return }
        // Cheap lower bound before planning: no plan breaks below min(base, 3 m/s) × the weakest scaling.
        guard deltaV >= 0.5 * min(p.breakSpeed, BreakTuning.expansionFloor) else { return }
        let budget = min(16, PlayTuning.maxDynamicBodies + 1 - toyCount)
        guard budget >= 2 else { return }
        let plan: BreakPlan
        do {
            plan = try expand(body.frame, contactWorld: contact, budget: budget, resolver: resolver)
        } catch {
            return
        }
        guard deltaV >= plan.threshold, plan.pieces.count >= 2 else { return }
        store.add(plan.newRecords)
        fire(.breakApart(deltaV: deltaV), on: body, at: contact, direction: direction, now: now)
        let parentCom = body.centreOfMassWorld
        let v = body.motion.linearVelocity, w = body.motion.angularVelocity
        remove(id, poof: false)
        var made: [BodyID] = []
        for piece in plan.pieces {
            guard let pid = try? addPiece(piece, of: body, plan: plan, now: now) else { continue }
            let velocity = v + w.cross(piece.centreWorld - parentCom) + piece.separation
            out.physics.append(.setVelocity(pid, linear: velocity, angular: w))
            bodies[pid]?.motion.linearVelocity = velocity
            bodies[pid]?.motion.angularVelocity = w
            made.append(pid)
        }
        out.events.append(.broke(id, into: made))
        discoverLooseAtoms(made)
    }

    /// One piece as a new body: its exact identity (the parent's path plus one step), drawn
    /// through a leaf of its own atoms when it is small enough for a merged mesh.
    mutating func addPiece(_ piece: BreakPlan.Piece, of parent: Body, plan: BreakPlan, now: Double) throws -> BodyID {
        let records = parent.frame.ref.records + plan.newRecords
        let display = ScaleRef(root: piece.root, records: records, dependencies: parent.frame.ref.dependencies, path: piece.path)
        let identity = pieceIdentity(piece, parent: parent, display: display)
        // parent ← piece through their common root: canonical paths merge steps, so the piece's
        // step cannot be split off its path. An edit shares its base's frame, so a remainder kept
        // as an edit of the same path lands where it was.
        let (toParent, _) = try resolver.placement(from: resolver.root(parent.frame.ref.root), steps: parent.frame.ref.path.steps)
        let (toPiece, view) = try resolver.placement(from: resolver.root(piece.root), steps: piece.path.steps)
        let placement = toParent.inverse.then(toPiece)
        var ref = display
        let count = try resolver.count(view)
        if view.kind != .leaf, count.plain.map({ $0 <= BigUInt(CutTuning.meshAtoms) }) ?? false, resolver.isMaterializable(view) {
            let leaf = try NodeRecord(.leaf(resolver.materialize(view)))
            store.add([leaf])
            ref = ScaleRef(root: leaf.id, records: [leaf], path: Path(), probe: leaf.id)
        }
        let facts = try BodyFacts.of(ref, resolver: resolver)
        let w = parent.frame.worldFromAnchor
        let sigma = parent.sigma * placement.scale
        let frame = BodyFrame(
            ref: ref,
            worldFromAnchor: RigidD(
                rotation: Quat.compose(w.rotation, Quat(rotation: placement.rotation.properRotation)).normalizedQuat,
                translation: w.translation + w.rotation.act(parent.sigma * placement.translation)
            ),
            metresPerAnchorUnit: sigma
        )
        let name = plan.kind == .bondBreak ? facts.formula : "Piece of \(parent.name)"
        let id = try addBody(
            frame: frame, identity: identity, facts: facts, name: name, brokenFrom: parent.brokenFrom ?? parent.name,
            feltMass: piece.feltMassKg, mode: .dynamic, now: now, spawnSpan: max(BreakTuning.minimumPieceSpan, sigma * facts.aggregate.bounds.longest),
            provenance: .piece(parent: parentRef(of: parent))
        )
        guard var b = bodies[id] else { return id }
        if plan.kind == .bondBreak, let info = buildInfo(b) { b.name = fragmentName(info.piece) }
        // Pieces are for building (D9), once they have flown apart.
        b.buildable = b.facts.isMolecule
        b.snapAfter = now + BuildTuning.pieceGrace
        b.omolRows = parent.omolRows
        b.breakableAfter = now + piece.cooldown
        b.insetUntil = now + PlayTuning.insetTime
        b.floatUntil = -.infinity
        if let span = piece.growToSpan, b.span > 0 {
            let target = sigma * span / b.span
            if settings.comfort.animatesGlides {
                b.growth = (sigma, target, now)
            } else {
                pinchFrame(&b, ratio: target / sigma, about: b.entityPose.translation)
            }
            b.spawnSpan = max(b.spawnSpan, span)
        }
        b.spec = try BodyPhysics.spec(b, mode: .dynamic, resting: false, now: now, cameraInside: false, resolver: resolver)
        bodies[id] = b
        // Replace the create with the inset, grown spec.
        if let i = out.physics.lastIndex(where: { if case .create(id, _, _) = $0 { return true }; return false }) {
            out.physics[i] = .create(id, b.spec, pose: b.entityPose)
        }
        return id
    }

    /// A fragment is labelled honestly (plan §4.4): a lone atom by its element, a piece whose atoms
    /// lack partners as a radical, and a whole molecule by its name when Lupi knows it.
    func fragmentName(_ piece: BuildPiece) -> String {
        let formula = piece.molecule.hillFormula
        if piece.count == 1 { return "\(ChemicalElement.forAtomicNumber(piece.molecule.atomicNumbers[0]).name) atom" }
        guard BuildCues.isComplete(piece) else { return "\(formula) radical" }
        return catalog.known.match(MolecularGraph(piece))?.name ?? formula
    }

    /// The piece's exact reference: the parent's identity path plus the step that made it,
    /// kept with every record its resolution reads and its probe (scale-spec §7.2).
    func pieceIdentity(_ piece: BreakPlan.Piece, parent: Body, display: ScaleRef) -> ScaleRef {
        var root = display.root, path = display.path
        if !(parent.identity.root == parent.frame.ref.root && parent.identity.path == parent.frame.ref.path) {
            // A parent drawn through a leaf of its own atoms has an empty path there, so the
            // piece's path below it is exactly its one step.
            guard piece.root == parent.frame.ref.root, parent.frame.ref.path.isEmpty,
                  let p = try? parent.identity.path.appending(piece.path.steps) else { return display }
            root = parent.identity.root
            path = p
        }
        return (try? ScaleRef.keep(root: root, path: path, store: store)) ?? display
    }

    /// The parent a piece's trophy names (contracts.md §1.1): the trophy it was, or where it came from.
    func parentRef(of b: Body) -> ParentRef {
        switch b.provenance {
        case let .trophy(t):
            return ParentRef(name: t.name, formula: t.molecule.formula, source: t.molecule.source, id: t.molecule.id, trophyId: t.id)
        case let .gallery(page, _, _):
            return ParentRef(name: b.name, formula: b.facts.formula, source: .gallery, id: page)
        case let .pubchem(cid, _):
            return ParentRef(name: b.name, formula: b.facts.formula, source: .pubchem, id: "cid:\(cid)")
        case let .omol25(row, _, _):
            return ParentRef(name: b.name, formula: b.facts.formula, source: .omol25, id: row)
        case .scale:
            return ParentRef(name: b.name, formula: b.facts.formula, source: .scale)
        case .built:
            return ParentRef(name: b.name, formula: b.facts.formula, source: .built)
        case .piece:
            // A piece of a piece: a fragment when it is a selection of a molecule's atoms.
            let leafRoot = (try? store.record(b.identity.root).kindByte) == NodeKind.leaf.rawValue
            return ParentRef(name: b.name, formula: b.facts.formula, source: leafRoot && b.facts.isMolecule ? .fragment : .scale)
        }
    }

    /// σ scaled by `ratio` about a world point (scale-spec §8.8).
    func pinchFrame(_ b: inout Body, ratio: Double, about p: Vec3) {
        guard ratio.isFinite, ratio > 0 else { return }
        LupiScale.pinch(&b.frame, ratio: ratio, about: p)
    }
}
