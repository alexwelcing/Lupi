import Foundation
import LupiChem
import LupiPlay
import LupiScale
import LupiScaleCore

extension PlaySession {
    /// Background and exit cancel the hand rather than interpreting its last movement as a
    /// throw. Bodies and queued spawns remain; only Clear removes them.
    public mutating func endInteractions() {
        let now = time ?? 0
        endPinch(now: now)
        endGrab(now: now, cancelled: true)
        endFly()
        arbiter.reset()
        magnet = nil
    }

    // MARK: Touches in

    mutating func handleTouches(_ touches: [TouchSample], now: Double) {
        // Flight needs |λ| > 32 (scale-spec §8.8).
        arbiter.flyAllowed = flyAllowed
        for t in touches {
            let target = t.phase == .began ? touchTarget(at: t.location) : .none
            for g in arbiter.handle(t, target: target) { handle(g, now: t.time) }
            if case .grabbing = arbiter.state, grab != nil, t.phase == .moved { grab?.touch = t.location }
        }
    }

    /// What a finger at `point` lands on: the cut's pick (scale-spec §10.5), else a body's bounds.
    func touchTarget(at point: SIMD2<Double>) -> TouchTarget {
        guard let hit = pickBody(at: point), let b = bodies[hit.body] else { return .none }
        switch b.sizeState {
        case .toy: return .toy(b.id)
        case .monument: return .monument(b.id)
        case .terrain: return .terrain(b.id)
        }
    }

    /// The body and world point under a view point.
    func pickBody(at point: SIMD2<Double>, only: BodyID? = nil) -> (body: BodyID, point: Vec3)? {
        guard let camera else { return nil }
        let ray = camera.ray(through: point)
        if let cut = lastCut, let hit = pick(ray: ray, cut: cut, band: Bands.any, resolver: resolver),
           hit.body < lastOrder.count, only == nil || lastOrder[hit.body] == only, bodies[lastOrder[hit.body]] != nil {
            return (lastOrder[hit.body], hit.pointWorld)
        }
        // Bodies the cut has not drawn yet (this frame's spawns), by their world bounds.
        var best: (BodyID, Vec3, Double)?
        for id in bodyOrder where only == nil || id == only {
            guard let b = bodies[id], !b.parked, b.sizeState != .terrain,
                  let (near, far) = b.worldBounds.intersect(ray), far >= 0 else { continue }
            let t = max(near, 0)
            if best == nil || t < best!.2 { best = (id, ray.at(t), t) }
        }
        return best.map { ($0.0, $0.1) }
    }

    mutating func handle(_ g: PlayGesture, now: Double) {
        switch g {
        case let .tap(target, _):
            if let id = target.body { select(selection == id ? nil : id) } else { select(nil) }
        case let .grabBegan(id, point):
            beginGrab(id, at: point, now: now)
        case let .grabMoved(point):
            grab?.touch = point
        case let .grabEnded(point, cancelled):
            grab?.touch = point
            endGrab(now: now, cancelled: cancelled)
        case let .chunk(id, point):
            detach(id, at: point, band: Bands.hand, chip: false, now: now)
        case let .chip(id, point):
            detach(id, at: point, band: Bands.chip, chip: true, now: now)
        case let .pinchBegan(centroid, held, target):
            beginPinch(centroid: centroid, held: held, target: target, now: now)
        case let .pinchChanged(centroid, ratio, twist):
            changePinch(centroid: centroid, ratio: ratio, twist: twist, now: now)
        case .pinchEnded:
            endPinch(now: now)
        case let .flyBegan(direction, centroid):
            beginFly(direction: direction, centroid: centroid, now: now)
        case .flyEnded:
            endFly()
        }
    }

    // MARK: Grab and throw (plan §3.5)

    mutating func beginGrab(_ id: BodyID, at point: SIMD2<Double>, now: Double) {
        guard var b = bodies[id], b.isToy, let camera else { return }
        if glide?.body == id { glide = nil }
        let ray = camera.ray(through: point)
        let hit = pickBody(at: point, only: id)?.point ?? b.entityPose.translation
        let depth = HoldFollow.grabDepth(hitDistance: (hit - camera.position).length)
        let pose = b.entityPose
        let target = ray.at(depth) + Vec3(0, PlayTuning.grabLift, 0)
        var state = GrabState(
            body: id, depth: depth, localPoint: pose.inverse.apply(hit), rotation: pose.rotation, follow: HoldFollow(at: hit),
            touch: point
        )
        state.estimator.add(HandSample(time: now, world: target, screen: point))
        grab = state
        wake(&b)
        b.floatUntil = -.infinity
        b.mode = .kinematic
        b.spec.mode = .kinematic
        b.fromHand = true
        // Picked off its shelf, a trophy is a loose toy again until it rests on one.
        let wasPinned = b.pinned
        b.pinned = false
        b.frozen = false
        bodies[id] = b
        out.physics.append(.setMode(id, .kinematic))
        if wasPinned { makeRoom(for: 0) }
        fire(.grab, on: b, at: hit, direction: .zero, now: now)
        if selection != id { selection = id }
    }

    /// The held body follows the touch ray at the grab depth on the `snap` token (plan §3.5 step 2).
    mutating func stepGrab(dt: Double, now: Double) {
        guard var g = grab, var b = bodies[g.body], let camera else { return }
        let ray = camera.ray(through: g.touch)
        // A magnet zone pulls the hand gently toward the bond it would make (plan §4.5 (a)).
        let target = ray.at(g.depth) + Vec3(0, PlayTuning.grabLift, 0) + g.pull
        g.follow.step(toward: target, dt: dt)
        g.estimator.add(HandSample(time: now, world: target, screen: g.touch))
        let point = g.follow.position.value
        let pose = RigidD(rotation: g.rotation, translation: point - g.rotation.act(g.localPoint))
        b.adopt(entityPose: pose)
        b.motion = BodyMotion(pose: pose, linearVelocity: g.follow.position.velocity)
        bodies[g.body] = b
        grab = g
        out.physics.append(.move(g.body, pose: pose, linearVelocity: g.follow.position.velocity, angularVelocity: .zero))
    }

    /// Release: the least-squares hand velocity plus the flick, capped, as impulses (plan §3.5 steps 3–4).
    mutating func endGrab(now: Double, cancelled: Bool) {
        guard let g = grab, var b = bodies[g.body], let camera else {
            grab = nil
            return
        }
        grab = nil
        if pinch?.body == g.body { return }
        let pose = b.entityPose
        let grabWorld = pose.apply(g.localPoint)
        var release = cancelled
            ? ThrowRelease.setDown
            : g.estimator.release(
                at: now, view: ThrowView(forward: camera.forward, right: camera.right),
                grabOffset: grabWorld - b.centreOfMassWorld, comfort: settings.comfort
            )
        if release.linear.length < PlayTuning.setDownSpeed { release = .setDown }
        b.mode = .dynamic
        b.spec.mode = .dynamic
        b.spec.continuousCollision = true
        bodies[g.body] = b
        out.physics.append(.setMode(g.body, .dynamic))
        if cancelled {
            bodies[g.body]?.motion.linearVelocity = .zero
            bodies[g.body]?.motion.angularVelocity = .zero
            out.physics.append(.move(g.body, pose: pose, linearVelocity: .zero, angularVelocity: .zero))
        }
        if !release.held {
            let impulses = launchImpulses(spec: b.spec, entityRotation: pose.rotation, linear: release.linear, angular: release.angular)
            out.physics.append(.launch(g.body, linearImpulse: impulses.linear, angularImpulse: impulses.angular))
            bodies[g.body]?.motion.linearVelocity = release.linear
            bodies[g.body]?.motion.angularVelocity = release.angular
            fire(.release(speed: release.linear.length), on: b, at: grabWorld, direction: .zero, now: now)
        }
        lastThrow = release.held ? nil : release
    }

    // MARK: Pinch and twist (scale-spec §8.8)

    mutating func beginPinch(centroid: SIMD2<Double>, held: BodyID?, target: TouchTarget, now: Double) {
        let id = held ?? selection ?? target.body ?? pickBody(at: centroid)?.body
        guard let id, bodies[id] != nil else {
            out.events.append(.refused("Pinch a molecule to resize it"))
            return
        }
        if flightState?.body == id { endFlight(now: now) }
        guard var b = bodies[id] else { return }
        glide = nil
        let resting = b.mode == .dynamic && (b.atRest || now - b.lastSupportContact < PlayTuning.contactMemory)
        let focus: Vec3
        if let g = grab, g.body == id {
            focus = b.entityPose.apply(g.localPoint)
        } else if resting {
            let box = b.worldBounds
            focus = Vec3(box.centre.x, box.min.y, box.centre.z)
        } else {
            focus = pickBody(at: centroid, only: id)?.point ?? b.entityPose.translation
        }
        pinch = PinchState(body: id, focus: focus, lastShapes: now, resting: resting)
        if b.mode == .dynamic {
            b.mode = .kinematic
            b.spec.mode = .kinematic
            out.physics.append(.setMode(id, .kinematic))
        }
        wake(&b)
        b.floatUntil = -.infinity
        let wasPinned = b.pinned
        b.pinned = false
        b.frozen = false
        bodies[id] = b
        if wasPinned { makeRoom(for: 0) }
    }

    mutating func changePinch(centroid: SIMD2<Double>, ratio: Double, twist: Double, now: Double) {
        guard var p = pinch, var b = bodies[p.body], let camera else { return }
        // Anchored below its node, a body is beyond the fingers' one-to-one range: the pinch moves φ
        // and the picture follows as in flight (§8.8).
        if !b.frame.anchorPath.isEmpty || flightState?.body == p.body {
            pinchAlongAxis(p.body, ratio: ratio, focus: p.focus)
            return
        }
        // The scale axis: fingers map one to one within 10^±32, logarithmically beyond (§8.8).
        let before = (try? resolver.magnification(of: b.frame))?.lambda
        var effective = ratio
        if let l0 = before, ratio > 0, ratio.isFinite {
            let phi1 = ScaleAxis.phi(l0) + log10(ratio)
            let l1 = min(ScaleAxis.cap, ScaleAxis.lambda(phi1))
            effective = pow(10, l1 - l0)
            // A terrain is at most one; a second body stops at monument size.
            let span = b.nodeSpan(resolver) * effective
            if span > CutTuning.terrainSpan, bodies.values.contains(where: { $0.id != b.id && $0.sizeState == .terrain }) {
                effective = max(1e-12, CutTuning.terrainSpan / max(b.nodeSpan(resolver), 1e-12))
            }
            if let d = ScaleAxis.detent(from: l0, to: l0 + log10(effective)) {
                let readout = Magnification(unitExponent: BigUInt(), factor: 10, ell: d + 10).readout
                out.events.append(.detent(b.id, readout: readout))
                fire(.scaleDetent, on: b, at: p.focus, direction: .zero, now: now)
            }
        }
        pinchFrame(&b, ratio: effective, about: p.focus)
        if twist != 0, twist.isFinite {
            let axis = p.resting ? Vec3(0, 1, 0) : camera.forward
            b.frame.worldFromAnchor = b.frame.worldFromAnchor.rotated(by: .axisAngle(axis, p.resting ? -twist : twist), about: p.focus)
        }
        if var g = grab, g.body == b.id {
            g.localPoint *= effective
            g.rotation = b.entityPose.rotation
            grab = g
        }
        if now - p.lastShapes >= PlayTuning.pinchShapeInterval {
            p.lastShapes = now
            if let spec = try? BodyPhysics.spec(b, mode: b.mode, resting: false, now: now, cameraInside: false, resolver: resolver) {
                b.spec = spec
                out.physics.append(.update(b.id, spec))
            }
        }
        out.physics.append(.move(b.id, pose: b.nodePose(resolver).frame, linearVelocity: .zero, angularVelocity: .zero))
        bodies[b.id] = b
        pinch = p
        hudCache.dirty = true
    }

    mutating func endPinch(now: Double) {
        guard let p = pinch else { return }
        pinch = nil
        if flightState?.body == p.body {
            // The picture finishes its way to the pinched φ, then settles.
            endPinchAlongAxis()
            return
        }
        settleSize(p.body, now: now, held: grab?.body == p.body)
    }

    // MARK: Glides (the receipt's dive, surfacing, life size)

    mutating func startGlide(_ id: BodyID, ratio: Double, returnAhead: Bool, about: Vec3? = nil) {
        guard var b = bodies[id], ratio.isFinite, ratio > 0 else { return }
        if grab?.body == id { grab = nil }
        if pinch?.body == id { pinch = nil }
        let duration = settings.comfort.animatesGlides ? (settings.comfort == .gentle ? 3.2 : 1.6) : 0
        glide = Glide(
            body: id, targetSigma: b.sigma * ratio, start: time ?? 0, fromSigma: b.sigma, duration: duration, returnAhead: returnAhead,
            about: about
        )
        b.mode = .kinematic
        b.floatUntil = -.infinity
        // No collider while it sweeps through the room: a growing kinematic box would shove every toy.
        b.spec.mode = .kinematic
        b.spec.shapes = []
        bodies[id] = b
        out.physics.append(.update(id, b.spec))
        out.physics.append(.setMode(id, .kinematic))
    }

    mutating func stepGlide(now: Double) {
        guard let g = glide, var b = bodies[g.body], let camera else { return }
        let u = g.duration > 0 ? min(1, (now - g.start) / g.duration) : 1
        let sigma = g.fromSigma * pow(g.targetSigma / g.fromSigma, smoothstep(u))
        // About the body's own centre (a similarity about the eye would keep the eye outside), or
        // about the footprint a life-size body stands on.
        pinchFrame(&b, ratio: sigma / b.sigma, about: g.about ?? b.nodePose(resolver).frame.translation)
        if u >= 1 && g.returnAhead {
            var flat = camera.forward
            flat.y = 0
            flat = flat.lengthSquared > 1e-6 ? flat.normalized : Vec3(0, 0, -1)
            let ahead = camera.position + flat * PlayTuning.spawnDistance - Vec3(0, PlayTuning.spawnDrop, 0)
            b.frame.worldFromAnchor.translation += ahead - b.entityPose.translation
        }
        bodies[g.body] = b
        out.physics.append(.move(g.body, pose: b.nodePose(resolver).frame, linearVelocity: .zero, angularVelocity: .zero))
        hudCache.dirty = true
        if u >= 1 {
            glide = nil
            settleSize(g.body, now: now, held: false)
        }
    }
}
