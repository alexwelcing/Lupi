import Foundation
import LupiChem
import LupiData
import LupiPlay
import LupiScale
import LupiScaleCore

/// How a built body came to be (contracts.md §1.1, `origin.parts`).
public struct BuiltStory: Sendable, Hashable {
    /// The pieces joined, in snap order, as formulas; the first 64 are kept.
    public var parts: [String]

    public init(parts: [String]) { self.parts = Array(parts.prefix(TrophyOrigin.maxParts)) }
}

/// Building's starting values (plan §4.5; est. where marked).
public enum BuildTuning {
    /// Tray atoms spawn at 0.025 m/Å: a carbon is a 3 cm bead.
    public static let atomScale = 0.025
    /// H, C, N, O, F, P, S, Cl, Br, I, Na.
    public static let trayElements = [1, 6, 7, 8, 9, 15, 16, 17, 35, 53, 11]
    /// A break's pieces cannot snap for this long, so they fly apart instead of rejoining (est.).
    public static let pieceGrace = 1.0
    /// A refused pair waits this long before its magnet engages again (est.).
    public static let refusalCooldown = 1.5
    /// A refused guest bounces off at this speed, m/s (est.).
    public static let refusalBounce = 0.3
    /// The magnet lets go when the atoms drift this many zones apart (est.).
    public static let releaseFactor = 1.25
    /// A held guest's hand is pulled this share of the way to its bond (est.).
    public static let heldPull = 0.5
    /// The click of a new bond: a squash along it, recovering on `boing` (est.).
    public static let snapSquash = 0.12
    /// No pair links farther apart than this, Å: the bounds test before atoms are compared.
    static let longestCutoff = 6.0
    /// Sideways offsets of successive tray spawns, so atoms land apart (est.).
    static let traySpread = [0.0, 0.1, -0.1, 0.2, -0.2]
    /// The "Built it" chime follows the snap's click by this long, so neither swallows the other (est.).
    static let delightDelay = 0.15
}

/// A snap in progress (plan §4.5 (a)): the guest's atom pulled toward the host's on the
/// `glide` token, and the guest's toy scale gliding to the host's.
struct Magnet: Sendable {
    var host: BodyID
    var hostAtom: Int
    var guest: BodyID
    var guestAtom: Int
    /// Å.
    var cutoff: Double
    var rest: Double
    /// The guest's atom in world space while it glides.
    var atom: Spring<Vec3>
    var sigma: Spring<Double>
}

/// An unordered pair of bodies.
struct SnapPair: Hashable, Sendable {
    var a: BodyID
    var b: BodyID

    init(_ x: BodyID, _ y: BodyID) {
        a = min(x, y)
        b = max(x, y)
    }
}

/// A molecule body's atoms in its own frame, with its play graph and open atoms: the snap's
/// input, cached per piece.
struct BuildInfo: Sendable {
    var piece: BuildPiece
    var open: [Int]
}

extension PlaySession {
    // MARK: The atom tray

    /// Spawns a tray atom ahead of the camera, each a little beside the last.
    public mutating func spawnAtom(_ z: Int) {
        let spread = BuildTuning.traySpread
        spawn(.atom(z), at: .ahead(sideways: spread[atomSpawns % spread.count]))
        atomSpawns += 1
    }

    /// A break made loose atoms: their elements join the tray (plan §4.5).
    mutating func discoverLooseAtoms(_ pieces: [BodyID]) {
        for id in pieces {
            guard let b = bodies[id], b.facts.count.plain == BigUInt(1), let info = buildInfo(b) else { continue }
            let z = info.piece.molecule.atomicNumbers[0]
            if !atomTray.contains(z), ChemicalElement.known(z) != nil {
                atomTray.append(z)
                out.events.append(.trayGained(z))
            }
        }
    }

    // MARK: Pieces for building

    func buildInfo(_ b: Body) -> BuildInfo? {
        guard b.facts.isMolecule, b.frame.anchorPath.isEmpty else { return nil }
        let r = resolver
        let ref = b.frame.ref
        return try? r.cached("lupi.game.build:" + ref.key.hex) { () throws -> BuildInfo in
            let leaf = try r.materialize(r.resolve(ref.root, ref.path))
            let piece = BuildPiece(molecule: Molecule(atomicNumbers: leaf.atomicNumbers.map(Int.init), positions: leaf.positions))
            return BuildInfo(piece: piece, open: piece.openAtoms)
        }
    }

    /// A body that can take part in a snap now.
    func snapEligible(_ b: Body, now: Double) -> Bool {
        b.facts.isMolecule && b.isToy && !b.parked && !b.frozen && !b.pinned && b.frame.anchorPath.isEmpty
            && now >= b.snapAfter && pinch?.body != b.id && glide?.body != b.id
    }

    /// The host is the larger body (more atoms, then more mass, then the older): its atoms come
    /// first and it stays where it is (scale-spec §10.7).
    static func hostFirst(_ a: Body, _ pa: BuildPiece, _ b: Body, _ pb: BuildPiece) -> Bool {
        if pa.count != pb.count { return pa.count > pb.count }
        let ma = pa.molecule.molarMass, mb = pb.molecule.molarMass
        if ma != mb { return ma > mb }
        return a.id < b.id
    }

    /// The formulas a body was built from, in snap order.
    static func parts(of b: Body) -> [String] {
        switch b.provenance {
        case let .built(story): story.parts
        case let .trophy(t) where t.origin.kind == .built: t.origin.parts ?? [t.molecule.formula]
        default: [b.facts.formula]
        }
    }

    // MARK: The magnet (plan §4.5 (a))

    /// The closest pair of open atoms inside a magnet zone, between two bodies of which one is
    /// buildable and one is in or from the player's hand.
    func findMagnet(now: Double) -> Magnet? {
        let held = grab?.body
        let ids = bodyOrder.filter { bodies[$0].map { snapEligible($0, now: now) } ?? false }
        guard ids.count >= 2 else { return nil }
        var best: (score: Double, magnet: Magnet)?
        for (n, i) in ids.enumerated() {
            for j in ids[(n + 1)...] {
                let a = bodies[i]!, b = bodies[j]!
                guard a.buildable || b.buildable, a.fromHand || b.fromHand || held == i || held == j else { continue }
                if let until = refusals[SnapPair(i, j)], now < until { continue }
                guard let ia = buildInfo(a), let ib = buildInfo(b), !ia.open.isEmpty, !ib.open.isEmpty else { continue }
                let (host, hi, guest, gi) = Self.hostFirst(a, ia.piece, b, ib.piece) ? (a, ia, b, ib) : (b, ib, a, ia)
                let reach = Snapper.magnetFactor * BuildTuning.longestCutoff * max(host.sigma, guest.sigma)
                let hb = host.worldBounds.expanded(by: reach), gb = guest.worldBounds
                guard hb.min.x <= gb.max.x, hb.min.y <= gb.max.y, hb.min.z <= gb.max.z,
                      gb.min.x <= hb.max.x, gb.min.y <= hb.max.y, gb.min.z <= hb.max.z else { continue }
                let guestAtoms = gi.open.map { ($0, guest.frame.world(gi.piece.molecule.position($0))) }
                for ha in hi.open {
                    let pa = host.frame.world(hi.piece.molecule.position(ha))
                    for (ga, pb) in guestAtoms {
                        guard let rule = Snapper.rule(hi.piece, ha, gi.piece, ga) else { continue }
                        let score = (pb - pa).length / (Snapper.magnetFactor * rule.cutoff * host.sigma)
                        guard score <= 1, best.map({ score < $0.score }) ?? true else { continue }
                        best = (score, Magnet(
                            host: host.id, hostAtom: ha, guest: guest.id, guestAtom: ga, cutoff: rule.cutoff, rest: rule.rest,
                            atom: Spring(pb, velocity: guest.motion.linearVelocity), sigma: Spring(guest.sigma)
                        ))
                    }
                }
            }
        }
        return best?.magnet
    }

    /// One frame of building: engage the nearest pair, glide the guest, snap within the cutoff.
    mutating func stepMagnet(dt: Double, now: Double) {
        let due = delights.filter { $0.at <= now }
        delights.removeAll { $0.at <= now }
        for d in due {
            guard let b = bodies[d.body] else { continue }
            fire(.delight(slowMotion: false), on: b, at: b.entityPose.translation, direction: .zero, now: now)
        }
        if magnet == nil, let found = findMagnet(now: now) { engage(found) }
        guard var m = magnet else { return }
        guard var guest = bodies[m.guest], let host = bodies[m.host],
              snapEligible(host, now: now), snapEligible(guest, now: now),
              let hi = buildInfo(host), let gi = buildInfo(guest) else {
            release(m, bounce: nil)
            return
        }
        let held = grab?.body == m.guest
        let pa = host.frame.world(hi.piece.molecule.position(m.hostAtom))
        let pb = guest.frame.world(gi.piece.molecule.position(m.guestAtom))
        let sigma = host.sigma
        let d = (pb - pa).length
        // Still cuts glides: the snap is immediate.
        if d <= m.cutoff * sigma || !settings.comfort.animatesGlides {
            commitSnap(m, now: now)
            return
        }
        if d > Snapper.magnetFactor * m.cutoff * sigma * BuildTuning.releaseFactor {
            release(m, bounce: nil)
            return
        }
        let dir = d > 0 ? (pb - pa) / d : Vec3(0, 1, 0)
        let target = pa + dir * (m.rest * sigma)
        // The guest glides to the host's toy scale about its own atom, so the snap joins two
        // pieces at one scale.
        m.sigma.step(toward: sigma, token: .glide, dt: dt)
        let ratio = m.sigma.value / guest.sigma
        let scaling = ratio.isFinite && ratio > 0 && abs(ratio - 1) > 1e-9
        if scaling { pinchFrame(&guest, ratio: ratio, about: pb) }
        if held {
            grab?.pull = (target - pb) * BuildTuning.heldPull
            if scaling { grab?.localPoint *= ratio }
        } else {
            m.atom.step(toward: target, token: .glide, dt: dt)
            let moved = guest.frame.world(gi.piece.molecule.position(m.guestAtom))
            guest.frame.worldFromAnchor.translation += m.atom.value - moved
            guest.motion = BodyMotion(pose: guest.entityPose, linearVelocity: m.atom.velocity)
            out.physics.append(.move(guest.id, pose: guest.entityPose, linearVelocity: m.atom.velocity, angularVelocity: .zero))
        }
        if scaling, abs(ratio - 1) > 0.005,
           let spec = try? BodyPhysics.spec(guest, mode: guest.mode, resting: false, now: now, cameraInside: false, resolver: resolver) {
            guest.spec = spec
            out.physics.append(.update(guest.id, spec))
        }
        bodies[guest.id] = guest
        magnet = m
    }

    mutating func engage(_ m: Magnet) {
        magnet = m
        guard grab?.body != m.guest, var g = bodies[m.guest] else { return }
        wake(&g)
        g.floatUntil = -.infinity
        if g.mode != .kinematic {
            g.mode = .kinematic
            g.spec.mode = .kinematic
            out.physics.append(.setMode(g.id, .kinematic))
        }
        bodies[g.id] = g
    }

    /// Lets the guest go: back to the physics, with its glide velocity or a bounce.
    mutating func release(_ m: Magnet, bounce: Vec3?) {
        magnet = nil
        grab?.pull = .zero
        guard grab?.body != m.guest, var g = bodies[m.guest], g.mode == .kinematic, g.isToy else { return }
        let v = bounce ?? m.atom.velocity
        g.mode = .dynamic
        g.spec.mode = .dynamic
        g.motion.linearVelocity = v
        bodies[g.id] = g
        out.physics.append(.setMode(g.id, .dynamic))
        out.physics.append(.setVelocity(g.id, linear: v, angular: .zero))
    }

    /// One of the magnet's bodies left play.
    mutating func magnetLost(_ m: Magnet, removed: BodyID) {
        if removed == m.host { release(m, bounce: nil) } else {
            magnet = nil
            grab?.pull = .zero
        }
    }

    // MARK: Snapping (plan §4.5)

    /// The atoms are within the bond cutoff: place the guest by the ideal geometry and keep it
    /// only if the recipe perceives exactly the graph the snap means.
    mutating func commitSnap(_ m: Magnet, now: Double) {
        magnet = nil
        grab?.pull = .zero
        guard let host = bodies[m.host], let guest = bodies[m.guest], let hi = buildInfo(host), let gi = buildInfo(guest) else { return }
        // Guest frame → host frame now, exact at the guest's snapping atom.
        let rotation = Quat.compose(host.frame.worldFromAnchor.rotation.inverted, guest.frame.worldFromAnchor.rotation).rotationMatrix
        let pb = gi.piece.molecule.position(m.guestAtom)
        let bInHost = host.frame.anchorPoint(guest.frame.world(pb))
        let current = RigidPlacement(rotation: rotation, translation: bInHost - rotation * pb)
        switch Snapper.snap(host: hi.piece, hostAtom: m.hostAtom, guest: gi.piece, guestAtom: m.guestAtom, guestToHost: current) {
        case let .success(result):
            merge(m, result, host: host, guest: guest, now: now)
        case .failure:
            refuse(m, host: host, guest: guest, now: now)
        }
    }

    mutating func merge(_ m: Magnet, _ r: SnapResult, host: Body, guest: Body, now: Double) {
        // Where the finger holds the merged body: the same point of the same atoms.
        var grabWorld: Vec3?
        if let g = grab, g.body == host.id || g.body == guest.id {
            let body = g.body == host.id ? host : guest
            let world = body.entityPose.apply(g.localPoint)
            grabWorld = g.body == host.id ? world : host.frame.world(r.guestToHost.apply(guest.frame.anchorPoint(world)))
        }
        let mh = host.feltMassKg, mg = guest.feltMassKg
        let vg = guest.mode == .kinematic && grab?.body != guest.id ? m.atom.velocity : guest.motion.linearVelocity
        let velocity = (host.motion.linearVelocity * mh + vg * mg) / (mh + mg)
        let story = BuiltStory(parts: Self.parts(of: host) + Self.parts(of: guest))
        let rows = Array(Set(host.omolRows + guest.omolRows)).sorted()
        let fromHand = host.fromHand || guest.fromHand
        guard let id = try? replace(
            [host, guest], molecule: r.molecule, frameOf: host, story: story, rows: rows, grabWorld: grabWorld, now: now
        ) else {
            refuse(m, host: host, guest: guest, now: now)
            return
        }
        guard var b = bodies[id] else { return }
        b.fromHand = fromHand || grab?.body == id
        if grab?.body != id {
            b.motion.linearVelocity = velocity
            b.motion.angularVelocity = host.motion.angularVelocity
            out.physics.append(.setVelocity(id, linear: velocity, angular: host.motion.angularVelocity))
        }
        bodies[id] = b
        // The click: two transients and a squash along the new bond (plan §5.3).
        let mid = b.frame.world(0.5 * (r.molecule.position(r.bond.i) + r.molecule.position(r.bond.j)))
        let axis = b.frame.worldFromAnchor.applyDirection(r.molecule.position(r.bond.j) - r.molecule.position(r.bond.i))
        fire(.snap, on: b, at: mid, direction: .zero, now: now)
        click(id, along: axis)
        out.events.append(.snapped(id, from: [host.id, guest.id]))
        celebrate(id, piece: r.piece, now: now)
    }

    mutating func refuse(_ m: Magnet, host: Body, guest: Body, now: Double) {
        fire(.snapRefused, on: guest, at: guest.entityPose.translation, direction: .zero, now: now)
        var away = guest.entityPose.translation - host.entityPose.translation
        away = away.lengthSquared > 0 ? away.normalized : Vec3(0, 1, 0)
        refusals[SnapPair(host.id, guest.id)] = now + BuildTuning.refusalCooldown
        release(m, bounce: host.motion.linearVelocity + away * BuildTuning.refusalBounce)
        out.events.append(.snapRefused(host: host.id, guest: guest.id))
    }

    /// Replaces `olds` by one body of `molecule`, a new leaf in `frameOf`'s frame (its atoms are
    /// that body's, then the rest): built, with its story, keeping a grab, a selection and the
    /// spawn size. Velocities are the caller's.
    mutating func replace(
        _ olds: [Body], molecule: Molecule, frameOf host: Body, story: BuiltStory, rows: [String], grabWorld: Vec3?, now: Double
    ) throws -> BodyID {
        let leaf = LeafNode(atomicNumbers: molecule.atomicNumbers.map { UInt8(clamping: $0) }, positions: molecule.positions)
        let record = try NodeRecord(.leaf(leaf))
        store.add([record])
        let ref = try ScaleRef.keep(root: record.id, path: Path(), store: store)
        let facts = try BodyFacts.of(ref, resolver: resolver)
        let frame = BodyFrame(ref: ref, worldFromAnchor: host.frame.worldFromAnchor, metresPerAnchorUnit: host.sigma)
        let held = grab.flatMap { g in olds.contains { $0.id == g.body } ? g : nil }
        let selected = olds.contains { $0.id == selection }
        let span = host.sigma * facts.aggregate.bounds.longest
        for b in olds { remove(b.id, poof: false) }
        let id = try addBody(
            frame: frame, identity: ref, facts: facts, name: facts.formula, brokenFrom: nil, feltMass: nil,
            mode: held != nil ? .kinematic : .dynamic, now: now,
            spawnSpan: max(span, olds.map(\.spawnSpan).max() ?? span), provenance: .built(story), budgeted: false
        )
        guard var b = bodies[id] else { return id }
        b.buildable = true
        b.omolRows = rows
        b.floatUntil = -.infinity
        b.breakableAfter = now + BreakTuning.bondCooldown
        bodies[id] = b
        if var g = held {
            let pose = b.entityPose
            arbiter.retarget(g.body, to: id)
            g.body = id
            g.localPoint = pose.inverse.apply(grabWorld ?? pose.translation)
            g.rotation = pose.rotation
            g.pull = .zero
            grab = g
            bodies[id]?.fromHand = true
        }
        if selected {
            selection = id
            out.events.append(.selected(id))
        }
        return id
    }

    /// A squash along the new bond, in the entity's frame.
    mutating func click(_ id: BodyID, along worldAxis: Vec3) {
        guard var b = bodies[id], worldAxis.lengthSquared > 0 else { return }
        let amount = BuildTuning.snapSquash * settings.comfort.squashScale
        guard amount > 0 else { return }
        b.effects.squash.hit(direction: b.entityPose.rotation.inverted.act(worldAxis.normalized), amount: amount)
        bodies[id] = b
    }

    /// "Built it" (plan §4.5, "Done"; §1's hidden delights): every atom at its usual valence, or a
    /// molecule Lupi knows. A match names the body; otherwise it is named by its formula.
    mutating func celebrate(_ id: BodyID, piece: BuildPiece, now: Double) {
        let known = catalog.known.match(MolecularGraph(piece))
        guard BuildCues.isComplete(piece) || known != nil, var b = bodies[id] else { return }
        let name = known?.name ?? piece.molecule.hillFormula
        b.name = name
        bodies[id] = b
        delights.append((id, now + BuildTuning.delightDelay))
        out.events.append(.builtIt(id, name: name, known: known != nil))
    }

    // MARK: Hydrogen fill (plan §4.5)

    /// Whether one tap of Fill would add hydrogens to this body.
    public func canFill(_ id: BodyID) -> Bool {
        guard let b = bodies[id], b.buildable, b.isToy, !b.frozen, let info = buildInfo(b) else { return false }
        return !BuildCues.fillable(info.piece).isEmpty
    }

    /// Fills every open valence of a built body or piece with hydrogens: a new body of the same
    /// atoms plus the hydrogens, held or moving as the old one was. False when nothing fits.
    @discardableResult
    public mutating func fillHydrogens(_ id: BodyID) -> Bool {
        guard canFill(id), let b = bodies[id], let info = buildInfo(b), let filled = HydrogenFill.fill(info.piece) else {
            out.events.append(.refused("Nothing to fill"))
            return false
        }
        let now = time ?? b.bornAt
        if let m = magnet, m.host == id || m.guest == id { release(m, bounce: nil) }
        let grabWorld = grab.flatMap { $0.body == id ? b.entityPose.apply($0.localPoint) : nil }
        let story = BuiltStory(parts: Self.parts(of: b) + Array(repeating: "H", count: filled.added))
        guard let new = try? replace(
            [b], molecule: filled.piece.molecule, frameOf: b, story: story, rows: b.omolRows, grabWorld: grabWorld, now: now
        ) else {
            out.events.append(.refused("Nothing to fill"))
            return false
        }
        guard var nb = bodies[new] else { return false }
        nb.fromHand = b.fromHand || grab?.body == new
        if grab?.body != new {
            nb.motion.linearVelocity = b.motion.linearVelocity
            nb.motion.angularVelocity = b.motion.angularVelocity
            out.physics.append(.setVelocity(new, linear: b.motion.linearVelocity, angular: b.motion.angularVelocity))
        }
        bodies[new] = nb
        fire(.snap, on: nb, at: nb.entityPose.translation, direction: .zero, now: now)
        out.events.append(.filled(new, hydrogens: filled.added))
        celebrate(new, piece: filled.piece, now: now)
        return true
    }
}
