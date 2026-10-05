import Foundation
import LupiChem
import LupiPlay
import LupiScale
import LupiScaleCore

extension PlaySession {
    // MARK: Physics in

    /// Physics owns a moving body's pose (scale-spec §8.3): a dynamic body's frame follows its
    /// entity. Kinematic and static bodies are posed by the session.
    mutating func adoptMotions(_ motions: [BodyID: BodyMotion]) {
        for (id, m) in motions {
            guard var b = bodies[id] else { continue }
            b.motion = m
            if b.mode == .dynamic && !b.parked { b.adopt(entityPose: m.pose) }
            bodies[id] = b
        }
    }

    // MARK: Spawning

    mutating func dequeueSpawn(now: Double) {
        guard !queue.isEmpty, let camera else { return }
        let request = queue.removeFirst()
        // No toy is ever spawned inside matter (scale-spec §10.1).
        if cameraInsideTerrain {
            out.events.append(.refused("Step out of the crystal to spawn"))
            return
        }
        do {
            let content = try catalog.content(request.source)
            store.add(content.ref.records)
            if let identity = content.identity { store.add(identity.records) }
            let view = try resolver.resolve(content.ref.root, content.ref.path)
            let sigma = try content.metresPerUnit ?? Spawn.metresPerUnit(view, resolver: resolver)
            let facts = try BodyFacts.of(content.ref, resolver: resolver)
            let pose: RigidD
            switch request.placement {
            case let .world(p):
                pose = RigidD(translation: p)
            case let .ahead(sideways):
                var flat = camera.forward
                flat.y = 0
                flat = flat.lengthSquared > 1e-6 ? flat.normalized : Vec3(0, 0, -1)
                let side = Vec3(0, 1, 0).cross(flat).normalized * -1
                pose = RigidD(translation: camera.position + flat * PlayTuning.spawnDistance + side * sideways - Vec3(0, PlayTuning.spawnDrop, 0))
            case let .shelf(entityPose):
                pose = entityPose
            }
            // The entity sits at the node's local centre (scale-spec §8.5).
            let frame = BodyFrame(
                ref: content.ref,
                worldFromAnchor: RigidD(rotation: pose.rotation, translation: pose.translation - pose.rotation.act(sigma * facts.aggregate.centre)),
                metresPerAnchorUnit: sigma
            )
            let onShelf = request.placement.isShelf
            let id = try addBody(
                frame: frame, identity: content.identity ?? content.ref, facts: facts, name: content.name, brokenFrom: nil, feltMass: nil,
                mode: .kinematic, now: now, floatFor: onShelf ? 0 : PlayTuning.spawnFloat, provenance: content.provenance,
                budgeted: !onShelf
            )
            guard var body = bodies[id] else { return }
            body.breakableAfter = now + PlayTuning.spawnGrace
            body.buildable = content.buildable
            body.omolRows = content.omolRows
            if case let .trophy(record) = content.provenance {
                body.trophyID = record.id
                if record.origin.kind == .broken { body.brokenFrom = record.origin.parent?.name }
            }
            if onShelf {
                // Back on its shelf: in place until something touches it (plan §6.4).
                body.pinned = true
                body.frozen = true
                body.floatUntil = -.infinity
            }
            bodies[id] = body
            out.events.append(.spawned(id))
            // A trophy back on its shelf comes with the soft kept chime (plan §6.4).
            fire(onShelf ? .kept : .spawn, on: body, at: body.entityPose.translation, direction: .zero, now: now)
        } catch {
            out.events.append(.refused("Could not spawn: \(error)"))
        }
    }

    /// Adds a body and its `create` command. Keeps the dynamic-body budget by poofing the oldest
    /// loose fragment, else the oldest toy nobody holds (plan §3.4).
    @discardableResult
    mutating func addBody(
        frame: BodyFrame, identity: ScaleRef, facts: BodyFacts, name: String, brokenFrom: String?, feltMass: Double?,
        mode: MotionMode, now: Double, floatFor: Double = 0, spawnSpan: Double? = nil, provenance: Provenance,
        budgeted: Bool = true
    ) throws -> BodyID {
        if budgeted { makeRoom(for: 1) }
        let id = newID()
        let felt = feltMass ?? facts.feltMassKg
        let span = frame.metresPerAnchorUnit * facts.aggregate.bounds.longest
        var body = Body(
            id: id, frame: frame, identity: identity, facts: facts, name: name, brokenFrom: brokenFrom, feltMassKg: felt,
            spawnSpan: spawnSpan ?? span, sizeState: .toy, mode: mode,
            spec: PhysicsSpec(
                mode: mode, massKg: felt, principalMoments: Vec3(1, 1, 1), principalRotation: .identity, centreOfMass: .zero,
                material: SurfaceMaterial(staticFriction: 0.5, dynamicFriction: 0.4, restitution: 0.3), linearDamping: 0,
                angularDamping: 0, shapes: [], continuousCollision: true
            ),
            motion: BodyMotion(pose: .identity), bornAt: now, breakableAfter: now, insetUntil: -.infinity, growth: nil,
            floatUntil: now + floatFor, effects: BodyEffects(popIn: PopIn(comfort: settings.comfort))
        )
        body.provenance = provenance
        body.spec = try BodyPhysics.spec(body, mode: mode, resting: false, now: now, cameraInside: false, resolver: resolver)
        body.motion = BodyMotion(pose: body.entityPose)
        bodies[id] = body
        out.physics.append(.create(id, body.spec, pose: body.entityPose))
        hudCache.dirty = true
        return id
    }

    /// Poofs bodies until `n` more toys fit the budget.
    mutating func makeRoom(for n: Int) {
        while toyCount + n > PlayTuning.maxDynamicBodies {
            let held = grab?.body
            let candidates = bodyOrder.compactMap { bodies[$0] }.filter { $0.isToy && !$0.pinned && $0.id != held && $0.id != pinch?.body }
            guard let victim = candidates.first(where: { $0.brokenFrom != nil }) ?? candidates.first else { return }
            remove(victim.id, poof: true)
        }
    }

    /// Loose toys: what the 40-body budget counts. Shelved trophies count against their shelf's 60.
    var toyCount: Int { bodies.values.filter { $0.isToy && !$0.pinned }.count }

    mutating func remove(_ id: BodyID, poof: Bool) {
        guard bodies.removeValue(forKey: id) != nil else { return }
        out.physics.append(.remove(id, poof: poof))
        out.events.append(.removed(id, poof: poof))
        juice.forget(id)
        if grab?.body == id { grab = nil }
        if pinch?.body == id { pinch = nil }
        if glide?.body == id { glide = nil }
        if let m = magnet, m.host == id || m.guest == id { magnetLost(m, removed: id) }
        if selection == id { selection = nil }
        hudCache.dirty = true
    }

    // MARK: Per-body timers

    mutating func stepBodies(dt: Double, now: Double) {
        for id in bodyOrder {
            guard var b = bodies[id] else { continue }
            var changed = false
            // A spawn floats while it pops in, then falls.
            if b.mode == .kinematic && b.floatUntil > -.infinity && now >= b.floatUntil && grab?.body != id && pinch?.body != id
                && glide?.body != id && b.sizeState == .toy {
                b.floatUntil = -.infinity
                b.mode = .dynamic
                out.physics.append(.setMode(id, .dynamic))
                changed = true
            }
            // A fresh piece grows to 6 cm about its own centre (scale-spec §10.6).
            if let g = b.growth {
                let u = settings.comfort.animatesGlides ? min(1, (now - g.start) / PlayTuning.growTime) : 1
                let sigma = g.fromSigma * pow(g.toSigma / g.fromSigma, smoothstep(u))
                let centre = b.entityPose.translation
                pinchFrame(&b, ratio: sigma / b.sigma, about: centre)
                if u >= 1 { b.growth = nil }
                changed = true
                b.spec = (try? BodyPhysics.spec(b, mode: b.mode, resting: b.atRest, now: now, cameraInside: false, resolver: resolver)) ?? b.spec
                out.physics.append(.update(id, b.spec))
                if b.mode != .dynamic { out.physics.append(.move(id, pose: b.entityPose, linearVelocity: .zero, angularVelocity: .zero)) }
            }
            // Inset proxies end (scale-spec §10.4).
            if b.insetUntil > -.infinity && now >= b.insetUntil {
                b.insetUntil = -.infinity
                if let spec = try? BodyPhysics.spec(b, mode: b.mode, resting: b.atRest, now: now, cameraInside: false, resolver: resolver) {
                    b.spec = spec
                    out.physics.append(.update(id, spec))
                }
                changed = true
            }
            if b.mode == .dynamic { changed = rest(&b, now: now) || changed }
            if changed { bodies[id] = b }
        }
    }

    /// Rest damping (plan §4.6): slow and turning slowly for 0.25 s after touching something raises
    /// damping, and the settle cue plays once. It holds until the body moves again; resting contacts
    /// need not keep reporting (an engine may put the body to sleep).
    mutating func rest(_ b: inout Body, now: Double) -> Bool {
        let slow = b.motion.linearVelocity.length < PlayTuning.restSpeed && b.motion.angularVelocity.length < PlayTuning.restSpin
        if b.atRest {
            if slow { return checkShelf(&b, now: now) }
            wake(&b)
            return true
        }
        guard slow, now - b.lastContact < 1.0 else {
            if b.restingSince == nil { return false }
            b.restingSince = nil
            return true
        }
        if b.restingSince == nil { b.restingSince = now }
        if now - b.restingSince! >= PlayTuning.restHold {
            b.atRest = true
            b.fromHand = false
            out.physics.append(.setDamping(b.id, linear: PlayTuning.restLinearDamping, angular: PlayTuning.restAngularDamping))
            fire(.settle, on: b, at: b.entityPose.translation, direction: .zero, now: now)
        }
        return true
    }

    /// Three seconds at rest on a shelf keeps a body there (plan §6.3); checked once per rest.
    mutating func checkShelf(_ b: inout Body, now: Double) -> Bool {
        guard !b.shelfChecked, let since = b.restingSince, now - since >= PlayTuning.pinHold else { return false }
        b.shelfChecked = true
        if let support = shelfSupport(of: b) { out.events.append(.restedOnShelf(b.id, support: support)) }
        return true
    }

    /// Where a resting body's stack meets the room, when that is a shelf: world mesh at least
    /// 25 cm above the floor, or a trophy already on its shelf (plan §6.3). Nil on the floor,
    /// while the floor is unknown, or when the chain of supports is broken.
    func shelfSupport(of body: Body) -> Vec3? {
        guard let floorY else { return nil }
        var current = body
        var seen: Set<BodyID> = []
        for _ in 0..<PlayTuning.maxStack {
            guard seen.insert(current.id).inserted else { return nil }
            if current.id != body.id, current.pinned, current.frozen {
                let box = current.worldBounds
                let base = Vec3(box.centre.x, box.min.y, box.centre.z)
                return base.y - floorY >= PlayTuning.shelfHeight ? base : nil
            }
            switch current.support {
            case let .room(point)?:
                return point.y - floorY >= PlayTuning.shelfHeight ? point : nil
            case let .body(next)?:
                guard let below = bodies[next] else { return nil }
                current = below
            case nil:
                return nil
            }
        }
        return nil
    }

    /// Restores the personality's damping (an impulse above 0.05 N·s, a grab).
    mutating func wake(_ b: inout Body) {
        b.restingSince = nil
        b.shelfChecked = false
        if b.atRest {
            b.atRest = false
            let p = b.facts.personality.personality
            out.physics.append(.setDamping(b.id, linear: p.linearDamping, angular: p.angularDamping))
        }
    }

    /// A trophy held in place on its shelf becomes an ordinary dynamic body.
    mutating func unfreeze(_ b: inout Body) {
        guard b.frozen else { return }
        b.frozen = false
        b.mode = .dynamic
        b.spec.mode = .dynamic
        out.physics.append(.setMode(b.id, .dynamic))
    }

    // MARK: Out of bounds (plan §3.3)

    mutating func rescue() {
        guard let camera else { return }
        let floor = floorY ?? (camera.position.y - 1.6)
        for id in bodyOrder {
            guard let b = bodies[id], b.isToy, !b.parked, grab?.body != id, pinch?.body != id, glide?.body != id else { continue }
            let box = b.worldBounds
            if box.max.y < floor - PlayTuning.fallBelowFloor || box.distance(to: camera.position) > PlayTuning.rescueRadius {
                remove(id, poof: true)
            }
        }
    }

    // MARK: Size states (scale-spec §10.1)

    /// The size state for a span, keeping at most one terrain.
    func sizeState(for b: Body, span: Double) -> SizeState {
        let s = SizeState.of(longestSpan: span, spawnSpan: b.spawnSpan)
        if s == .terrain, bodies.values.contains(where: { $0.id != b.id && $0.sizeState == .terrain }) { return .monument }
        return s
    }

    static func mode(for state: SizeState) -> MotionMode {
        switch state {
        case .toy: .dynamic
        case .monument: .kinematic
        case .terrain: .static
        }
    }

    /// Applies a new size state: mode, anchor (terrain may rebase), and physics.
    mutating func settleSize(_ id: BodyID, now: Double, held: Bool) {
        guard var b = bodies[id] else { return }
        let state = sizeState(for: b, span: b.span)
        b.sizeState = state
        let mode: MotionMode = held && state == .toy ? .kinematic : Self.mode(for: state)
        if state != .terrain && !b.frame.anchorPath.isEmpty { returnAnchor(&b) }
        b.mode = mode
        let inside = state == .terrain && cameraInside(b)
        b.spec = (try? BodyPhysics.spec(b, mode: mode, resting: false, now: now, cameraInside: inside, resolver: resolver)) ?? b.spec
        b.floatUntil = -.infinity
        bodies[id] = b
        out.physics.append(.update(id, b.spec))
        out.physics.append(.setMode(id, mode))
        if mode != .dynamic { out.physics.append(.move(id, pose: b.nodePose(resolver).frame, linearVelocity: .zero, angularVelocity: .zero)) }
        hudCache.dirty = true
    }

    /// Ascends the anchor back to the body's node (a terrain that shrank to a monument).
    mutating func returnAnchor(_ b: inout Body) {
        guard let body = try? resolver.resolve(b.frame.ref.root, b.frame.ref.path),
              let (p, _) = try? resolver.placement(from: body, steps: b.frame.anchorPath) else { return }
        // x_body = s R x_anchor + t, so σ_body = σ_A / s and the body's frame is the anchor's inverse map.
        let sigmaBody = b.frame.metresPerAnchorUnit / p.scale
        let w = b.frame.worldFromAnchor
        let rotation = Quat.compose(w.rotation, Quat(rotation: p.rotation.properRotation).inverted)
        let translation = w.translation - rotation.act(sigmaBody * p.translation)
        b.frame.worldFromAnchor = RigidD(rotation: rotation, translation: translation)
        b.frame.metresPerAnchorUnit = sigmaBody
        b.frame.anchorPath = []
    }

    /// Whether the camera is inside a body's envelope.
    func cameraInside(_ b: Body) -> Bool {
        guard let camera else { return false }
        let pose = b.nodePose(resolver)
        let local = pose.frame.inverse.apply(camera.position) / pose.sigma + b.facts.aggregate.centre
        return b.facts.aggregate.bounds.contains(local)
    }

    /// Terrain while the camera is inside: toys parked, its collider off (scale-spec §10.1).
    mutating func updateTerrain() {
        guard let terrain = bodies.values.first(where: { $0.sizeState == .terrain }) else {
            if cameraInsideTerrain { unparkAll() }
            cameraInsideTerrain = false
            return
        }
        var t = terrain
        if let camera { try? LupiScale.rebase(&t.frame, focusWorld: camera.position, resolver: resolver) }
        bodies[t.id] = t
        let inside = cameraInside(t)
        guard inside != cameraInsideTerrain else { return }
        cameraInsideTerrain = inside
        if let spec = try? BodyPhysics.spec(t, mode: .static, resting: false, now: time ?? 0, cameraInside: inside, resolver: resolver) {
            bodies[t.id]?.spec = spec
            out.physics.append(.update(t.id, spec))
        }
        if inside {
            for id in bodyOrder where id != t.id && bodies[id]?.isToy == true && grab?.body != id {
                bodies[id]?.parked = true
                out.physics.append(.park(id, true))
            }
        } else {
            unparkAll()
        }
    }

    mutating func unparkAll() {
        for id in bodyOrder where bodies[id]?.parked == true {
            bodies[id]?.parked = false
            out.physics.append(.park(id, false))
        }
    }
}

extension Body {
    /// The body node's own frame: worldFromBody and σ_body, through the anchor path when the
    /// anchor sits below the node (terrain, scale-spec §8.3).
    func nodePose(_ r: Resolver) -> (frame: RigidD, sigma: Double) {
        let centre = facts.aggregate.centre
        guard !frame.anchorPath.isEmpty,
              let body = try? r.resolve(frame.ref.root, frame.ref.path),
              let (p, _) = try? r.placement(from: body, steps: frame.anchorPath) else {
            let w = frame.worldFromAnchor
            return (RigidD(rotation: w.rotation, translation: w.translation + w.rotation.act(sigma * centre)), sigma)
        }
        let sigmaBody = frame.metresPerAnchorUnit / p.scale
        let w = frame.worldFromAnchor
        let rotation = Quat.compose(w.rotation, Quat(rotation: p.rotation.properRotation).inverted)
        let origin = w.translation - rotation.act(sigmaBody * p.translation)
        return (RigidD(rotation: rotation, translation: origin + rotation.act(sigmaBody * centre)), sigmaBody)
    }
}
