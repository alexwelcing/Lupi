import Foundation
import LupiChem
import LupiPlay
import LupiScale
import LupiScaleCore

/// What VoiceOver says about a body (plan §8 M4), for RealityKit's `AccessibilityComponent`:
/// its name, then what it is and what it is doing, in words a screen reader speaks well.
public struct BodyAccessibility: Sendable, Equatable {
    /// "Caffeine".
    public var label: String
    /// "Rigid: two fused rings. Clacks like hard plastic. 24 atoms: 8 carbon, 10 hydrogen, 4
    /// nitrogen, 2 oxygen. Resting."
    public var value: String
    /// The custom actions a VoiceOver user can take on it, in order.
    public var actions: [BodyAction]
}

/// A body's VoiceOver actions: the gestures a finger would make, as one step each.
public enum BodyAction: String, Sendable, CaseIterable {
    /// Selects it and opens its card.
    case select = "Show its card"
    /// Throws it gently ahead, as a flick would.
    case toss = "Toss it"
    /// Keeps it in the collection.
    case keep = "Keep it"
}

/// Spoken forms of the plaque's text.
public enum Spoken {
    /// "10^(10^100) − 1,000" → "10 to the power of 10 to the power of 100, minus 1,000".
    public static func count(_ formatted: String) -> String {
        var s = formatted
        s = s.replacingOccurrences(of: " × ", with: " times ")
        s = s.replacingOccurrences(of: ") − ", with: ", minus ")
        s = s.replacingOccurrences(of: " − ", with: " minus ")
        s = s.replacingOccurrences(of: "^(", with: " to the power of ")
        s = s.replacingOccurrences(of: "^", with: " to the power of ")
        s = s.replacingOccurrences(of: "(", with: "")
        s = s.replacingOccurrences(of: ")", with: "")
        return s
    }

    /// "C8H10N4O2" → "8 carbon, 10 hydrogen, 4 nitrogen, 2 oxygen"; with `counts` false, the
    /// elements alone: "bromine, chlorine and sodium".
    public static func formula(_ hill: String, counts: Bool = true) -> String {
        var parts: [(String, Int)] = []
        var symbol = ""
        var digits = ""
        func flush() {
            guard !symbol.isEmpty else { return }
            parts.append((symbol, Int(digits) ?? 1))
            symbol = ""
            digits = ""
        }
        for ch in hill {
            if ch.isUppercase {
                flush()
                symbol = String(ch)
            } else if ch.isLowercase, !symbol.isEmpty, digits.isEmpty {
                symbol.append(ch)
            } else if ch.isNumber, !symbol.isEmpty {
                digits.append(ch)
            }
        }
        flush()
        let names = parts.map { symbol, n -> String in
            let name = ChemicalElement.allNames[symbol] ?? symbol
            return counts ? "\(n) \(name)" : name
        }
        guard !counts, names.count > 1 else { return names.joined(separator: ", ") }
        return names.dropLast().joined(separator: ", ") + " and " + names.last!
    }
}

extension ChemicalElement {
    /// Lower-case element names by symbol, for speech.
    static let allNames: [String: String] = {
        var out: [String: String] = [:]
        for z in 1...118 {
            let e = ChemicalElement.forAtomicNumber(z)
            out[e.symbol] = e.name.lowercased()
        }
        return out
    }()
}

extension PlaySession {
    /// VoiceOver's description of a body; nil when it is gone.
    public func accessibility(_ id: BodyID) -> BodyAccessibility? {
        guard let b = bodies[id] else { return nil }
        let d = b.facts.personality
        var parts = [d.plaque + ".", d.feel + "."]
        let count = Spoken.count(b.facts.count.formatted)
        let atoms = b.facts.count.plain == BigUInt(1) ? "1 atom" : "\(count) atoms"
        if b.facts.count.plain.map({ $0 <= BigUInt(RecordLimits.maxAtoms) }) ?? false {
            parts.append("\(atoms): \(Spoken.formula(b.facts.formula)).")
        } else {
            parts.append("\(atoms) of \(Spoken.formula(b.facts.formula, counts: false)).")
        }
        if let from = b.brokenFrom { parts.append("Broken from \(from).") }
        parts.append(stateWords(b) + ".")
        var actions: [BodyAction] = [.select]
        if b.isToy && !b.pinned && grab?.body != id { actions.append(.toss) }
        if b.trophyID == nil { actions.append(.keep) }
        return BodyAccessibility(label: b.name, value: parts.joined(separator: " "), actions: actions)
    }

    /// "Held", "Flying", "Kept, on a shelf", "Resting", "A monument", "Terrain under you".
    func stateWords(_ b: Body) -> String {
        if grab?.body == b.id { return "Held" }
        if flightState?.body == b.id { return "Flying along the scale" }
        switch b.sizeState {
        case .monument: return "A monument, too big to throw"
        case .terrain: return cameraInsideTerrain ? "You are inside it" : "Terrain you can stand on"
        case .toy: break
        }
        var words = b.atRest ? "Resting" : "Moving"
        if b.pinned { words = "On a shelf" }
        if b.trophyID != nil { words = "Kept. " + words }
        if selection == b.id { words += ", selected" }
        return words
    }

    /// One line for the whole scene, for the play view's own accessibility element.
    public var accessibilitySummary: String {
        let toys = bodyOrder.compactMap { bodies[$0] }
        guard !toys.isEmpty else { return "No molecules yet. Pick one from the tray to drop it ahead of you." }
        let names = toys.prefix(8).map(\.name)
        let more = toys.count > 8 ? ", and \(toys.count - 8) more" : ""
        return "\(toys.count) in play: \(names.joined(separator: ", "))\(more)."
    }

    /// VoiceOver's toss (plan §8 M4): a gentle throw ahead and up, the way a flick would send
    /// it, capped by motion comfort. Returns false when the body cannot be thrown now.
    @discardableResult
    public mutating func toss(_ id: BodyID) -> Bool {
        guard let now = time, let camera, var b = bodies[id], b.isToy, !b.pinned, grab?.body != id, pinch?.body != id,
              flightState?.body != id else { return false }
        var ahead = camera.forward
        ahead.y = 0
        ahead = ahead.lengthSquared > 1e-6 ? ahead.normalized : Vec3(0, 0, -1)
        var v = ahead * 2.2 + Vec3(0, 1.6, 0)
        let cap = settings.comfort.throwSpeedCap
        if v.length > cap { v *= cap / v.length }
        let spin = settings.comfort.spinScale * 3
        let w = camera.right * spin
        b.mode = .dynamic
        b.spec.mode = .dynamic
        b.spec.continuousCollision = true
        b.frozen = false
        b.atRest = false
        b.restingSince = nil
        b.floatUntil = -.infinity
        b.motion.linearVelocity = v
        b.motion.angularVelocity = w
        bodies[id] = b
        out.physics.append(.setMode(id, .dynamic))
        out.physics.append(.setVelocity(id, linear: v, angular: w))
        fire(.release(speed: v.length), on: b, at: b.entityPose.translation, direction: .zero, now: now)
        var release = ThrowRelease.setDown
        release.linear = v
        release.angular = w
        release.held = false
        lastThrow = release
        return true
    }
}
