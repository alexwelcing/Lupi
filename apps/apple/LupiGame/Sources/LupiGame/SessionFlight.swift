import Foundation
import LupiChem
import LupiPlay
import LupiScale
import LupiScaleCore

/// What the HUD says about a flight in progress (scale-spec §8.8).
public struct FlightReport: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        /// A two-finger hold beyond 10^±32.
        case fly
        /// Dive in: on toward the atoms until the ions are 2 cm across.
        case dive
        /// Surface: back out to the spawn size.
        case surface
        /// A pinch on a body anchored below its node moves φ, not the picture.
        case pinch
    }

    public var kind: Kind
    public var body: BodyID
    /// Where the picture is heading on the scale axis, and where it is.
    public var targetPhi: Double
    public var phi: Double
    /// Frames that wrapped, and the periods wrapped in all, exactly.
    public var wraps: Int
    public var periods: BigUInt
    /// Steps in the anchor path: a dive of 10¹⁰⁰ levels adds about one run per axis.
    public var anchorSteps: Int
    public var held: Bool
    /// The fixed point of the zoom, world.
    public var focus: Vec3
    /// When the picture last changed its size, the latest last (at most 64).
    public var pictureSteps: [Double]

    public var line: String {
        let p = Magnitude(periods).formatted
        return String(format: "flight %@ φ %.1f → %.1f, ", "\(kind)", phi, targetPhi) + "\(wraps) wraps of \(p) periods, anchor \(anchorSteps) steps"
    }
}

struct FlightState: Sendable {
    var kind: FlightReport.Kind
    var body: BodyID
    /// The fixed point of the zoom, world: a hit on the body's surface, or the camera inside it.
    var focus: Vec3
    var targetPhi: Double
    /// The target's speed; nil for a pinch, which moves it directly.
    var flight: Flight?
    /// Fingers are down (or a Dive or Surface runs): the target keeps moving.
    var held: Bool
    /// A Dive stops its target here.
    var stopPhi: Double?
    /// Still: no cut before this time.
    var nextCut = -Double.infinity
    var wraps = 0
    var periods = BigUInt()
    /// Surface ends by putting the body back ahead of the camera.
    var placeAhead = false
    var pictureSteps: [Double] = []
}

/// The ion size a dive ends at, metres across (plan §8 M0's receipt, scale.md §3.4).
public enum FlightTuning {
    public static let diveIonDiameter = 0.02
    /// Still cuts between detents at most this often (§8.8), at most this many decades a cut.
    public static let stillCutInterval = 0.35
    public static let stillCutDecades = 3.0
    /// Life size stands on the floor with its near face this far ahead (scale.md §5.8).
    public static let lifeSizeClearance = 1.2
    /// Life size is offered for bodies this big at λ = 0, metres.
    public static let lifeSizeSpans: ClosedRange<Double> = 0.03...20
}

extension PlaySession {
    var scaleComfort: Comfort {
        switch settings.comfort {
        case .standard: .standard
        case .gentle: .gentle
        case .still: .still
        }
    }

    /// The flight in progress, for the HUD.
    public var flight: FlightReport? {
        guard let s = flightState, let b = bodies[s.body] else { return nil }
        let phi = (try? resolver.magnification(of: b.frame))?.phi ?? .nan
        return FlightReport(
            kind: s.kind, body: s.body, targetPhi: s.targetPhi, phi: phi, wraps: s.wraps, periods: s.periods,
            anchorSteps: b.frame.anchorPath.count, held: s.held, focus: s.focus, pictureSteps: s.pictureSteps
        )
    }

    /// |λ| > 32: beyond the fingers' one-to-one range, where a hold flies (§8.8, §10.5).
    public func beyondOneToOne(_ id: BodyID) -> Bool {
        guard let b = bodies[id], let m = try? resolver.magnification(of: b.frame) else { return false }
        return abs(m.phi) > 32
    }

    /// What a two-finger hold flies: the selected body, else the terrain.
    func flyCandidate() -> BodyID? {
        if let s = selection, bodies[s] != nil { return s }
        return bodyOrder.first { bodies[$0]?.sizeState == .terrain }
    }

    var flyAllowed: Bool { flyCandidate().map(beyondOneToOne) ?? false }

    /// The body's own node cannot be placed in binary64: its anchor sits too far below it.
    func isDeep(_ b: Body) -> Bool { !b.frame.anchorPath.isEmpty && !b.nodePose(resolver).sigma.isFinite }

    // MARK: Starting and ending

    mutating func beginFly(direction: Double, centroid: SIMD2<Double>, now: Double) {
        guard let id = flyCandidate(), beyondOneToOne(id) else {
            out.events.append(.refused("Flight starts beyond 10^32 times larger or smaller"))
            return
        }
        startFlight(.fly, id, direction: direction, focus: flightFocus(id, at: centroid), held: true, stop: nil)
    }

    mutating func endFly() {
        guard var s = flightState, s.kind == .fly else { return }
        // The target stops; the picture finishes the way at V a frame.
        s.held = false
        s.flight?.speed = 0
        flightState = s
    }

    /// Where a flight zooms about: inside the body, the camera; else the hit under `point`, the
    /// screen centre's hit, or the body's nearest point to the camera.
    func flightFocus(_ id: BodyID, at point: SIMD2<Double>?) -> Vec3 {
        guard let b = bodies[id], let camera else { return .zero }
        if b.sizeState == .terrain, terrainContains(b, camera.position) { return camera.position }
        let centre = SIMD2(camera.viewportPoints.x / 2, camera.viewportPoints.y / 2)
        for p in [point, centre].compactMap({ $0 }) {
            if let hit = pickBody(at: p, only: id) { return hit.point }
        }
        if b.frame.anchorPath.isEmpty {
            let box = b.worldBounds
            let c = camera.position
            return Vec3(min(max(c.x, box.min.x), box.max.x), min(max(c.y, box.min.y), box.max.y), min(max(c.z, box.min.z), box.max.z))
        }
        return camera.position
    }

    mutating func startFlight(
        _ kind: FlightReport.Kind, _ id: BodyID, direction: Double, focus: Vec3, held: Bool, stop: Double?, placeAhead: Bool = false
    ) {
        guard var b = bodies[id], let m = try? resolver.magnification(of: b.frame) else { return }
        if grab?.body == id { grab = nil }
        if pinch?.body == id, kind != .pinch { pinch = nil }
        if glide?.body == id { glide = nil }
        // No collider while it sweeps through the room, as in a glide: a growing body would shove every toy.
        b.mode = b.sizeState == .terrain ? .static : .kinematic
        b.spec.mode = b.mode
        b.spec.shapes = []
        b.floatUntil = -.infinity
        wake(&b)
        bodies[id] = b
        out.physics.append(.update(id, b.spec))
        out.physics.append(.setMode(id, b.mode))
        let flight: Flight? = kind == .pinch ? nil : Flight(phi: m.phi, direction: direction)
        flightState = FlightState(
            kind: kind, body: id, focus: focus, targetPhi: m.phi, flight: flight, held: held, stopPhi: stop, placeAhead: placeAhead
        )
        out.events.append(.flight(id, active: true))
    }

    mutating func endFlight(now: Double) {
        guard let s = flightState else { return }
        flightState = nil
        guard var b = bodies[s.body] else { return }
        if s.placeAhead && b.frame.anchorPath.isEmpty, let camera {
            var flat = camera.forward
            flat.y = 0
            flat = flat.lengthSquared > 1e-6 ? flat.normalized : Vec3(0, 0, -1)
            let ahead = camera.position + flat * PlayTuning.spawnDistance - Vec3(0, PlayTuning.spawnDrop, 0)
            b.frame.worldFromAnchor.translation += ahead - b.entityPose.translation
            bodies[s.body] = b
        }
        out.events.append(.flight(s.body, active: false))
        settleSize(s.body, now: now, held: false)
    }

    // MARK: Dive, surface and life size

    /// Dives until the ions are about 2 cm across. A body within 10^±32 of life size glides about
    /// its centre, so the camera stands inside it (plan §8 M0's receipt); anything further flies,
    /// aimed at the surface under the screen's centre, wrapping whole periods (§8.8).
    public mutating func dive(into id: BodyID, ionDiameter: Double = FlightTuning.diveIonDiameter) {
        guard let b = bodies[id], let m = try? resolver.magnification(of: b.frame) else { return }
        let target = log10(ionDiameter / (2 * b.facts.aggregate.rAtom)) + 10
        if let lambda = m.lambda, abs(lambda) <= 32, b.frame.anchorPath.isEmpty {
            startGlide(id, ratio: pow(10, target - lambda), returnAhead: false)
            return
        }
        startFlight(.dive, id, direction: 1, focus: flightFocus(id, at: nil), held: false, stop: ScaleAxis.phi(target))
    }

    /// Back to the spawn size, ahead of the camera: a glide when the body's node is within reach
    /// of binary64, else a flight outward that climbs the anchor path by whole periods.
    public mutating func surface(_ id: BodyID) {
        guard var b = bodies[id] else { return }
        if isDeep(b) || flightState?.body == id {
            let focus = flightFocus(id, at: nil)
            startFlight(.surface, id, direction: -1, focus: focus, held: false, stop: nil, placeAhead: true)
            // The target runs out until the anchor is the body's node at its spawn size.
            flightState?.targetPhi = -.infinity
            flightState?.held = true
            return
        }
        returnAnchor(&b)
        bodies[id] = b
        startGlide(id, ratio: b.spawnSpan / max(b.span, 1e-12), returnAhead: true)
    }

    /// The span of a body at life size (λ = 0), metres, when binary64 can say it.
    public func lifeSizeSpan(_ id: BodyID) -> Double? {
        guard let b = bodies[id], b.frame.anchorPath.isEmpty, let lambda = (try? resolver.magnification(of: b.frame))?.lambda,
              abs(lambda) < 300 else { return nil }
        return b.span * pow(10, -lambda)
    }

    /// What the plaque offers for Life size: the span it would stand at, when it would fit the room
    /// and is not there already.
    func lifeSizeOffer(_ id: BodyID) -> String? {
        guard let b = bodies[id], b.isToy || b.sizeState == .monument, glide?.body != id, flightState?.body != id,
              let span = lifeSizeSpan(id), FlightTuning.lifeSizeSpans.contains(span), abs(span - b.span) > 1e-6 * span else { return nil }
        return Self.lengthText(span)
    }

    /// Life size (scale.md §5.8): the body glides to λ = 0 standing on the floor ahead, its near face
    /// 1.2 m away. The 10³⁰ rung becomes a 2.82 m cube of 48.6 tonnes.
    public mutating func lifeSize(_ id: BodyID) {
        guard var b = bodies[id], let camera, let span = lifeSizeSpan(id), b.isToy || b.sizeState == .monument else {
            out.events.append(.refused("Life size needs a body you can see whole"))
            return
        }
        guard FlightTuning.lifeSizeSpans.contains(span) else {
            out.events.append(.refused("At life size this is \(Self.lengthText(span)): it would not fit the room"))
            return
        }
        guard let floor = floorY else {
            out.events.append(.refused("Lupi has not found the floor yet"))
            return
        }
        var flat = camera.forward
        flat.y = 0
        flat = flat.lengthSquared > 1e-6 ? flat.normalized : Vec3(0, 0, -1)
        let distance = FlightTuning.lifeSizeClearance + 0.75 * span
        let footprint = Vec3(camera.position.x, floor, camera.position.z) + flat * distance
        // Upright and facing the camera, its bottom on the footprint: it then grows on it.
        let yaw = atan2(-flat.x, -flat.z)
        let rotation = Quat.axisAngle(Vec3(0, 1, 0), yaw)
        b.frame.worldFromAnchor.rotation = rotation
        let box = b.worldBounds
        let bottom = Vec3(box.centre.x, box.min.y, box.centre.z)
        b.frame.worldFromAnchor.translation += footprint - bottom
        b.mode = .kinematic
        b.spec.mode = .kinematic
        b.floatUntil = -.infinity
        bodies[id] = b
        out.physics.append(.setMode(id, .kinematic))
        out.physics.append(.move(id, pose: b.entityPose, linearVelocity: .zero, angularVelocity: .zero))
        startGlide(id, ratio: span / b.span, returnAhead: false, about: footprint)
        out.events.append(.lifeSize(id, mass: trueMass(id) ?? ""))
    }

    static func lengthText(_ metres: Double) -> String {
        switch metres {
        case ..<0.01: String(format: "%.1f mm", metres * 1000)
        case ..<1: String(format: "%.0f cm", metres * 100)
        case ..<1000: String(format: "%.2f m", metres)
        default: "\(Readout.scientificText(metres)) m"
        }
    }

    // MARK: A pinch beyond the one-to-one range

    /// A pinch on a body anchored below its node moves φ by the fingers' ratio; the picture follows
    /// at V a frame with wraps, as in flight (§8.8).
    mutating func pinchAlongAxis(_ id: BodyID, ratio: Double, focus: Vec3) {
        if flightState?.body != id || flightState?.kind != .pinch {
            startFlight(.pinch, id, direction: 1, focus: focus, held: true, stop: nil)
        }
        guard var s = flightState, ratio > 0, ratio.isFinite else { return }
        s.targetPhi += log10(ratio)
        flightState = s
    }

    mutating func endPinchAlongAxis() {
        guard var s = flightState, s.kind == .pinch else { return }
        s.held = false
        flightState = s
    }

    // MARK: The frame

    /// One frame of flight (§8.8): the target moves on the scale axis, whole periods wrap the
    /// anchor while the picture stays, and the picture zooms at most V about the focus.
    mutating func stepFlight(dt: Double, now: Double) {
        guard var s = flightState else { return }
        guard var b = bodies[s.body], let mag = try? resolver.magnification(of: b.frame) else {
            flightState = nil
            return
        }
        let comfort = scaleComfort
        if var f = s.flight, s.held || s.stopPhi != nil {
            _ = f.step(dt, comfort: comfort)
            if let stop = s.stopPhi, f.direction * (f.phi - stop) >= 0 {
                f.phi = stop
                f.speed = 0
                s.stopPhi = nil
                s.held = false
            }
            s.flight = f
            if s.targetPhi.isFinite || s.kind != .surface { s.targetPhi = f.phi }
        }
        // Nothing finer than an atom has detail: λ ≤ 11 (§8.7).
        s.targetPhi = min(s.targetPhi, ScaleAxis.phi(ScaleAxis.cap))
        let lambdaNow = mag.lambda ?? ScaleAxis.lambda(mag.phi)
        // Surfacing runs its target out to −∞; −10^300 decades is as far as binary64 needs.
        let targetLambda = max(-1e300, ScaleAxis.lambda(s.targetPhi))
        var remaining = targetLambda - lambdaNow
        // A body anchored at its own node never flies below its spawn size.
        var atFloor = false
        if remaining < 0 && b.frame.anchorPath.isEmpty {
            let floor = min(0, log10(b.spawnSpan / max(b.span, 1e-300)))
            if remaining <= floor {
                remaining = floor
                atFloor = true
            }
        }
        guard remaining.isFinite else {
            flightState = s
            endFlight(now: now)
            return
        }
        let v = Flight.pictureStep(comfort)
        // Wraps carry λ by whole periods while the picture stays.
        var wrapped = 0.0
        if let (n, descending, period) = wrapPeriods(b, target: targetLambda, magnification: mag, focus: s.focus) {
            do {
                try Wraps.wrap(&b.frame, periods: n, descending: descending, focus: s.focus, resolver: resolver)
                wrapped = (descending ? 1 : -1) * n.double * period
                s.wraps += 1
                s.periods = s.periods + n
                // What is left for the picture, in binary64 only where λ is: deeper, the target's own
                // precision is all there is, and the wrap met it.
                if let after = (try? resolver.magnification(of: b.frame))?.lambda {
                    remaining = targetLambda - after
                } else {
                    remaining = 0
                }
            } catch {
                // A refused wrap leaves the anchor as it was; the picture carries on.
            }
        }
        var step = 0.0
        if settings.comfort == .still {
            // Still cuts instead of zooming (§8.8): a jump of at most a period's decades, then the
            // rebase follows; wraps carry the rest, unseen.
            if now >= s.nextCut, abs(remaining) > 1e-9 {
                step = max(-FlightTuning.stillCutDecades, min(FlightTuning.stillCutDecades, remaining))
                s.nextCut = now + FlightTuning.stillCutInterval
            }
        } else {
            step = max(-v, min(v, remaining))
        }
        if step != 0 {
            pinchFrame(&b, ratio: pow(10, step), about: s.focus)
            s.pictureSteps.append(now)
            if s.pictureSteps.count > 64 { s.pictureSteps.removeFirst(s.pictureSteps.count - 64) }
        }
        if let d = ScaleAxis.detent(from: lambdaNow, to: lambdaNow + wrapped + step) {
            let readout = (try? resolver.magnification(of: b.frame))?.readout ?? Magnification(unitExponent: BigUInt(), factor: 10, ell: d + 10).readout
            out.events.append(.detent(b.id, readout: readout))
            fire(.scaleDetent, on: b, at: s.focus, direction: .zero, now: now)
        }
        // The anchor follows the focus; Still's cuts may need many levels at once.
        let passes = settings.comfort == .still ? 64 : 1
        for _ in 0..<passes {
            let before = (b.frame.anchorPath.count, b.frame.metresPerAnchorUnit)
            try? LupiScale.rebase(&b.frame, focusWorld: s.focus, resolver: resolver)
            if before == (b.frame.anchorPath.count, b.frame.metresPerAnchorUnit) { break }
        }
        b.sizeState = sizeState(for: b, span: b.nodeSpan(resolver))
        bodies[s.body] = b
        out.physics.append(.move(s.body, pose: physicsPose(b), linearVelocity: .zero, angularVelocity: .zero))
        flightState = s
        let settled = abs(remaining - step) < 1e-9
        if (settled && !s.held && s.stopPhi == nil) || (atFloor && settled) { endFlight(now: now) }
    }

    /// Whole periods to wrap this frame (§8.8), which way, and a period's decades: only for an
    /// anchor that is a tower level whose seed copies the last cut did not draw, with no removal
    /// near. The count is exact: the anchor's unit exponent less the target's, w = (ℓ − λ)/log10 f,
    /// so a target of 10^81 decades set against an anchor at 10^99 lands where it says, not where
    /// binary64's difference of the two would. What is left is under one period. A descent is held
    /// to the anchor's level and stops a period short of where the body's atoms reach τ, so atoms
    /// come into the picture by zoom, not by a jump; a climb keeps the anchor's place (maxAscent).
    func wrapPeriods(_ b: Body, target lambda: Double, magnification mag: Magnification, focus: Vec3) -> (BigUInt, Bool, Double)? {
        guard !b.frame.anchorPath.isEmpty, lambda.isFinite, var cut = lastCut, let index = lastOrder.firstIndex(of: b.id) else { return nil }
        cut.items = cut.items.filter { $0.body == index }
        guard Wraps.allowed(b.frame, lastCut: cut, resolver: resolver),
              let bodyView = try? resolver.resolve(b.frame.ref.root, b.frame.ref.path),
              let anchor = try? resolver.walk(bodyView, b.frame.anchorPath), anchor.kind == .level, let t = anchor.tower else { return nil }
        let period = log10(Double(t.factor))
        let u = anchor.unitExponent
        let w = (mag.ell - lambda) / period
        guard w.isFinite else { return nil }
        if w < 0 || BigUInt(roundingUp: w) < u {
            // Down: to ⌈w⌉, but not past the anchor's level, nor to where atoms would show at once.
            var floor = BigUInt(roundingUp: max(0, w))
            if let camera {
                let d = max((focus - camera.position).length, FrameTuning.zNear)
                let visible = 10 + log10(tau.tau * d / (b.facts.aggregate.rAtom * camera.viewState.pixelsPerRadian))
                floor = max(floor, BigUInt(roundingUp: max(0, (mag.ell - visible) / period)) + BigUInt(1))
            }
            guard floor < u else { return nil }
            let n = min(try! u - floor, anchor.level.dividedSmall(3).quotient)
            return n.isZero ? nil : (n, true, period)
        }
        // Up: to ⌊w⌋, keeping the anchor's place against the root's faces.
        let ceiling = BigUInt(roundingUp: w.rounded(.down))
        guard ceiling > u else { return nil }
        let n = min(try! ceiling - u, Wraps.maxAscent(b.frame, resolver: resolver))
        return n.isZero ? nil : (n, false, period)
    }

    /// A pose the physics engine can hold: the node's when binary64 can place it, else the
    /// anchor's local centre (a deep terrain's entity carries no shapes).
    func physicsPose(_ b: Body) -> RigidD {
        let node = b.nodePose(resolver)
        let t = node.frame.translation
        if node.sigma.isFinite, t.x.isFinite, t.y.isFinite, t.z.isFinite { return node.frame }
        return b.entityPose
    }

    /// The true mass of a body for its plaque (plan §4.7).
    public func trueMass(_ id: BodyID) -> String? {
        guard let b = bodies[id] else { return nil }
        return MassText.of(b.facts.massMicroDa, isMolecule: b.facts.isMolecule)
    }
}

extension Readout {
    /// `m × 10^e` with four significant digits, for an ordinary binary64 value.
    static func scientificText(_ v: Double) -> String {
        guard v.isFinite, v > 0 else { return String(v) }
        var e = Int(log10(v).rounded(.down))
        var m = v / pow(10, Double(e))
        m = (m * 1000).rounded() / 1000
        if m >= 10 {
            m /= 10
            e += 1
        }
        return String(format: "%.4g", m) + " \u{00D7} 10^\(e)"
    }
}

/// The readout helpers of this module (LupiScale's are internal to it).
enum Readout {}
