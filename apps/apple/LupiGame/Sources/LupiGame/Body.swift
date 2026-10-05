import Foundation
import LupiChem
import LupiPlay
import LupiScale
import LupiScaleCore

/// What a piece is, derived once from its reference: exact count and mass, formula, personality,
/// felt mass and heft (scale-spec §5, §10).
public struct BodyFacts: Sendable {
    public var count: Magnitude
    public var massMicroDa: Magnitude
    /// Hill formula of one unit; `formulaText` adds the copies ("BrCl499Na500 × 10^6").
    public var formula: String
    public var formulaText: String
    public var personality: PersonalityDerivation
    public var massLog: MassLog
    public var heft: Heft
    /// A leaf of at most 2,000 atoms: drawn as its merged mesh and broken at a bond (scale-spec §9.2, §10.6).
    public var isMolecule: Bool
    /// The node's aggregate: envelope, centre c(X), covariance (scale-spec §9.2, §10.3).
    public var aggregate: Aggregate

    public static func of(_ ref: ScaleRef, resolver r: Resolver) throws -> BodyFacts {
        let view = try r.resolve(ref.root, ref.path)
        let agg = try r.aggregate(view)
        let comp = try r.composition(view)
        let mass = try comp.massMicroDa()
        let log = LupiScale.massLog(massMicroDa: mass)
        let small = agg.count.plain.map { $0 <= BigUInt(CutTuning.meshAtoms) } ?? false
        return BodyFacts(
            count: agg.count, massMicroDa: mass, formula: comp.formula, formulaText: comp.formulaText,
            personality: try LupiScale.personality(for: view, resolver: r), massLog: log, heft: Heft(log),
            isMolecule: small && view.kind == .leaf,
            aggregate: agg
        )
    }

    /// Felt mass, kg (`lupi.feltmass.v1`, scale-spec §10.2).
    public var feltMassKg: Double { FeltMass.kg(massLog, massScale: personality.personality.massScale) }
}

/// What a resting body sits on.
public enum Support: Sendable, Equatable {
    /// The room's mesh (or a plane), touched at this world point.
    case room(Vec3)
    case body(BodyID)
}

/// Timers and render effects of one body (plan §5.4).
public struct BodyEffects: Sendable {
    public var popIn: PopIn
    public var squash = Squash()
    public var hitStop = HitStop()
}

/// A body in play: a LupiScale piece with a world pose (scale-spec §8.3), and its game state.
public struct Body: Sendable {
    public let id: BodyID
    /// What the cut and physics resolve. A piece of a break is drawn through a leaf record of its
    /// own atoms, because LupiScale's cut keeps the merged-mesh path for leaf records.
    public var frame: BodyFrame
    /// The piece itself, exactly: the parent's path plus one step (scale-spec §10.6). What a keep
    /// writes (M1, M2).
    public var identity: ScaleRef
    public var facts: BodyFacts
    public var name: String
    /// "Broken from Hydrogen peroxide" and the like; nil for a spawn.
    public var brokenFrom: String?
    /// Where it came from, for the trophy a keep writes (contracts.md §1.3).
    public var provenance: Provenance = .scale
    /// Snaps to other atoms (plan §4.5): tray atoms, the pieces of a break, what is built from
    /// them, and trophies of those. A molecule spawned whole is not, so two gallery molecules
    /// thrown at each other always bounce.
    public var buildable = false
    /// Held, or let go and not yet at rest: a snap needs the player's hand on one side, so the
    /// pieces of a break never rejoin by themselves.
    public var fromHand = false
    /// No snap before this time.
    public var snapAfter: Double = -.infinity
    /// OMol25 rows (`<collection>:<row>`) whose atoms are in this body: the attribution its
    /// trophy's XYZ carries (contracts.md §1.3).
    public var omolRows: [String] = []
    /// The trophy this body is, once kept or when it came back from the collection.
    public var trophyID: UUID?
    /// On a shelf (plan §6.3): outside the 40-toy budget, which counts loose play only (plan §3.4).
    public var pinned = false
    /// Held in place, kinematic, until something touches it: how a shelf's trophies come back
    /// before the room's mesh under them is rebuilt (plan §6.4).
    public var frozen = false
    /// What it last rested on: the room at a point, or another body (plan §6.3).
    public var support: Support?
    /// The shelf test ran for this rest; it runs again after the body moves.
    public var shelfChecked = false
    public var feltMassKg: Double
    /// Longest span at spawn, metres: the size states count from it (scale-spec §10.1).
    public var spawnSpan: Double
    public var sizeState: SizeState
    public var mode: MotionMode
    public var spec: PhysicsSpec
    public var motion: BodyMotion
    public var bornAt: Double
    /// No break before this time (plan §4.4, scale-spec §10.6).
    public var breakableAfter: Double
    /// Inset proxies until this time (scale-spec §10.4).
    public var insetUntil: Double
    /// Growing to `targetSigma` over [growFrom, growFrom + PlayTuning.growTime] (scale-spec §10.6).
    public var growth: (fromSigma: Double, toSigma: Double, start: Double)?
    public var lastContact: Double = -.infinity
    public var lastSupportContact: Double = -.infinity
    public var restingSince: Double?
    public var atRest = false
    public var parked = false
    /// The spawn float ends here; then the body falls.
    public var floatUntil: Double
    public var effects: BodyEffects

    /// σ, metres per anchor unit.
    public var sigma: Double { frame.metresPerAnchorUnit }

    /// The longest displayed span, metres, of a body anchored at its own node (every toy and monument).
    public var span: Double { sigma * facts.aggregate.bounds.longest }

    /// The longest displayed span whatever the anchor.
    public func nodeSpan(_ r: Resolver) -> Double { nodePose(r).sigma * facts.aggregate.bounds.longest }

    /// The body entity's pose: its anchor's local centre with `worldFromAnchor`'s rotation (§8.5).
    public var entityPose: RigidD {
        let c = facts.aggregate.centre
        let w = frame.worldFromAnchor
        return RigidD(rotation: w.rotation, translation: w.translation + w.rotation.act(sigma * c))
    }

    /// Refreshes `worldFromAnchor` from the entity's pose (Float32 to binary64 is exact, §8.3).
    public mutating func adopt(entityPose pose: RigidD) {
        let c = facts.aggregate.centre
        frame.worldFromAnchor = RigidD(rotation: pose.rotation, translation: pose.translation - pose.rotation.act(sigma * c))
    }

    /// The centre of mass in world space.
    public var centreOfMassWorld: Vec3 { entityPose.apply(spec.centreOfMass) }

    public var isToy: Bool { sizeState == .toy }

    /// The world bounds of the envelope (an axis-aligned box around the rotated envelope).
    public var worldBounds: Box3 {
        let pose = entityPose
        let local = facts.aggregate.bounds
        let half = local.halfExtents * sigma
        let m = pose.rotation.rotationMatrix
        let e = Vec3(
            abs(m[0, 0]) * half.x + abs(m[0, 1]) * half.y + abs(m[0, 2]) * half.z,
            abs(m[1, 0]) * half.x + abs(m[1, 1]) * half.y + abs(m[1, 2]) * half.z,
            abs(m[2, 0]) * half.x + abs(m[2, 1]) * half.y + abs(m[2, 2]) * half.z
        )
        return Box3(min: pose.translation - e, max: pose.translation + e)
    }
}

/// Physics descriptions from LupiScale's proxies, inertia and the personality table.
enum BodyPhysics {
    static func spec(
        _ body: Body, mode: MotionMode, resting: Bool, now: Double, cameraInside: Bool, resolver r: Resolver
    ) throws -> PhysicsSpec {
        let view = try r.resolve(body.frame.ref.root, body.frame.ref.path)
        // The proxy is the body node's, at the node's own scale (a terrain's anchor may sit below it).
        let sigma = body.nodePose(r).sigma
        var shapes = try collisionProxy(for: view, metresPerUnit: sigma, maxShapes: 64, resolver: r)
        if now < body.insetUntil {
            let d = body.facts.aggregate.rAtom * sigma + 0.001
            shapes = shapes.map { $0.inset(by: d) }
        }
        if body.sizeState == .terrain && cameraInside { shapes = [] }
        let inertia = try inertia(for: view, feltMassKg: body.feltMassKg, metresPerUnit: sigma, resolver: r)
        let p = body.facts.personality.personality
        let rotation = Quat(rotation: inertia.axes.properRotation)
        return PhysicsSpec(
            mode: mode, massKg: body.feltMassKg, principalMoments: inertia.moments, principalRotation: rotation,
            centreOfMass: (inertia.centreOfMass - body.facts.aggregate.centre) * sigma,
            material: SurfaceMaterial(
                staticFriction: p.friction, dynamicFriction: p.friction * PlayTuning.dynamicFrictionShare,
                restitution: p.restitution
            ),
            linearDamping: resting ? PlayTuning.restLinearDamping : p.linearDamping,
            angularDamping: resting ? PlayTuning.restAngularDamping : p.angularDamping,
            shapes: shapes, continuousCollision: mode == .dynamic
        )
    }
}
