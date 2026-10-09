import Foundation
import LupiChem
import LupiPlay
import LupiScale

/// Spike A3 (plan §4.2 "Tumble", §8 M0): does the physics engine keep the gyroscopic terms
/// that flip an asymmetric top spun about its intermediate axis (the tennis-racket effect)?
/// The session tosses a body straight up spinning about that axis, with a small tilt toward
/// the largest axis, and counts how often the axis turns over before the body lands.
public struct TumbleReport: Sendable, Equatable {
    public var body: BodyID
    public var started: Double
    /// The intermediate principal axis in the entity's frame.
    public var axisLocal: Vec3
    /// Its world direction at launch.
    public var reference: Vec3
    /// Times the axis turned over (its dot with `reference` crossing ±0.5).
    public var flips = 0
    public var minDot = 1.0
    public var seconds = 0.0
    public var finished = false
    var sign = 1.0

    public var line: String {
        let state = finished ? "landed" : "airborne"
        return "A3 \(body): \(flips) flip\(flips == 1 ? "" : "s") in \(String(format: "%.2f", seconds)) s, min dot \(String(format: "%.2f", minDot)), \(state)"
    }
}

extension PlaySession {
    /// Ends a tumble at its first contact after launch, or after this long.
    static let tumbleLimit = 3.0

    /// Tosses `id` up at `lift` m/s spinning at `spin` rad/s about its intermediate axis, tilted
    /// by `tilt` toward the largest. Refused for a body that is held, not a toy, or has no
    /// distinct intermediate axis.
    @discardableResult
    public mutating func tumbleTest(_ id: BodyID, spin: Double = 20, lift: Double = 4, tilt: Double = 0.05) -> Bool {
        guard let now = time, var b = bodies[id], b.mode == .dynamic, b.isToy, grab?.body != id, pinch?.body != id else {
            out.events.append(.refused("A3 needs a toy at rest that is not held"))
            return false
        }
        let m = b.spec.principalMoments
        let order = [0, 1, 2].sorted { m[$0] < m[$1] }
        let (small, middle, large) = (m[order[0]], m[order[1]], m[order[2]])
        // An intermediate axis within 2 % of another is no axis to flip about.
        guard middle - small > 0.02 * large, large - middle > 0.02 * large else {
            out.events.append(.refused("A3 needs an asymmetric top"))
            return false
        }
        var unit = Vec3.zero
        unit[order[1]] = 1
        var other = Vec3.zero
        other[order[2]] = 1
        let axisLocal = b.spec.principalRotation.act(unit)
        let rotation = b.entityPose.rotation
        let axis = rotation.act(axisLocal)
        let omega = (axis + rotation.act(b.spec.principalRotation.act(other)) * tilt).normalized * spin
        b.atRest = false
        b.restingSince = nil
        bodies[id] = b
        out.physics.append(.setDamping(id, linear: 0, angular: 0))
        out.physics.append(.setVelocity(id, linear: Vec3(0, lift, 0), angular: omega))
        tumble = TumbleReport(body: id, started: now, axisLocal: axisLocal, reference: axis)
        return true
    }

    /// Follows the tumble each frame; restores the body's damping when it lands.
    mutating func stepTumble(now: Double) {
        guard var t = tumble, !t.finished else { return }
        guard let b = bodies[t.body] else {
            t.finished = true
            tumble = t
            return
        }
        let d = b.entityPose.rotation.act(t.axisLocal).dot(t.reference)
        t.minDot = min(t.minDot, d)
        if d * t.sign < -0.5 {
            t.flips += 1
            t.sign = -t.sign
        }
        t.seconds = now - t.started
        if b.lastContact > t.started + 0.05 || t.seconds >= Self.tumbleLimit {
            t.finished = true
            let p = b.facts.personality.personality
            out.physics.append(.setDamping(t.body, linear: p.linearDamping, angular: p.angularDamping))
        }
        tumble = t
    }
}
