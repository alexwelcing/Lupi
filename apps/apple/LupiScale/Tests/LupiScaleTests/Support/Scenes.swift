import Foundation
import LupiChem
import LupiScale
import LupiScaleCore
import Testing

/// The repository root, found from this file so `swift test` needs no resource bundle.
enum Gallery {
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()   // …/Tests/LupiScaleTests/Support
        .deletingLastPathComponent()   // …/Tests/LupiScaleTests
        .deletingLastPathComponent()   // …/LupiScale/Tests
        .deletingLastPathComponent()   // …/apple/LupiScale
        .deletingLastPathComponent()   // …/apps/apple
        .deletingLastPathComponent()   // …/apps
        .deletingLastPathComponent()   // the repository

    /// A gallery XYZ through LupiKit's port of the web parser: file order, Float32 (§12.2).
    static func leaf(_ relative: String) throws -> LeafNode {
        let bytes = [UInt8](try Data(contentsOf: root.appendingPathComponent(relative)))
        let frame = try XYZParser.parse(bytes: bytes).first
        return LeafNode(atomicNumbers: frame.atomicNumbers.map { UInt8($0) }, positions: frame.positions)
    }

    static let water = "apps/web/public/gallery/curated/popular/water.xyz"
    static let caffeine = "apps/web/public/gallery/curated/popular/caffeine.xyz"
    static let c60 = "apps/web/public/gallery/curated/c60_buckyball.xyz"
}

/// The spec's content for runtime tests: the salt ladder, its relatives in other factors, and water.
enum Content {
    static let saltSeed = CrystalNode(
        structure: .rocksalt, termination: .open, speciesA: 11, speciesB: 17, quarterQ16: 92_409, cells: SIMD3(5, 5, 5)
    )
    static let seed: NodeRecord = try! NodeRecord(.crystal(saltSeed))
    static let period: Int64 = 1_848_180
    static let periods: [SIMD3<Int64>] = [SIMD3(period, 0, 0), SIMD3(0, period, 0), SIMD3(0, 0, period)]
    static let googol = BigUInt.power(10, 100)
    static let googolplexLevels = try! googol - 3

    /// A salt tower: the §12.4 ladder for factor 10, the same seed and periods for other factors.
    static func rung(_ levels: BigUInt, substitution: Bool = true, factor: UInt8 = 10) -> NodeRecord {
        try! NodeRecord(.tower(TowerNode(
            seed: seed.id, factor: factor, periodsQ16: periods, levels: levels,
            substitution: substitution ? Substitution(fromZ: 17, toZ: 35, perCopy: 1) : nil
        )))
    }

    static let waterLeaf: LeafNode = try! Gallery.leaf(Gallery.water)
    static let water: NodeRecord = try! NodeRecord(.leaf(waterLeaf))

    static func resolver(_ records: [NodeRecord]) -> Resolver {
        Resolver(store: RecordStore(records + [seed]))
    }

    static func ref(_ rec: NodeRecord, _ others: [NodeRecord] = [], path: Path = Path()) -> ScaleRef {
        ScaleRef(root: rec.id, records: [rec, seed] + others, path: path)
    }

    /// A body whose longest span is `span` metres, centred at `centre`, anchored at its own node.
    static func toy(_ ref: ScaleRef, span: Double, centre: Vec3 = Vec3(0, 0, -0.5), resolver: Resolver) throws -> BodyFrame {
        let v = try resolver.resolve(ref.root, ref.path)
        let a = try resolver.aggregate(v)
        let sigma = span / a.bounds.longest
        return BodyFrame(ref: ref, worldFromAnchor: RigidD(translation: centre - sigma * a.centre), metresPerAnchorUnit: sigma)
    }

    /// The anchor `levels − k` below a tower root, with a constant digit per axis.
    static func anchorPath(rootLevels: BigUInt, to k: BigUInt, digits: [UInt8]) -> [Step] {
        let d = try! rootLevels - k
        guard !d.isZero else { return [] }
        let runs = (0..<3).map { a -> [DigitRun] in
            let n = TowerMath.digits(a, rootLevels, d)
            return n.isZero ? [] : [DigitRun(digit: digits[a], length: n)]
        }
        return [.tower(levels: d, runs: runs)]
    }

    static func anchorPath(rootLevels: BigUInt, to k: BigUInt, digit: UInt8) -> [Step] {
        anchorPath(rootLevels: rootLevels, to: k, digits: [digit, digit, digit])
    }

    /// A terrain body: its anchor `anchorPath` below the body's node, σ metres per anchor unit,
    /// placed so the anchor's point `x` is at world point `at`.
    static func terrain(_ ref: ScaleRef, anchorPath: [Step], sigma: Double, anchorPoint x: Vec3, at world: Vec3) -> BodyFrame {
        BodyFrame(ref: ref, anchorPath: anchorPath, worldFromAnchor: RigidD(translation: world - sigma * x), metresPerAnchorUnit: sigma)
    }

    /// σ_A for an anchor at tower level k when one ångström should be `metresPerAngstrom` metres.
    static func sigma(level k: BigUInt, factor: UInt8, metresPerAngstrom: Double) -> Double {
        metresPerAngstrom * pow(Double(factor), Double(TowerMath.unitExponent(k).int!))
    }

    /// The anchor's view and aggregate.
    static func anchor(_ body: BodyFrame, _ r: Resolver) throws -> (View, Aggregate) {
        let v = try r.walk(r.resolve(body.ref.root, body.ref.path), body.anchorPath)
        return (v, try r.aggregate(v))
    }
}

/// A camera at the origin looking down −z, as on a phone held up (1,380 px across the height).
let deskView = ViewState.looking(from: Vec3(0, 0, 0), at: Vec3(0, 0, -1), fovY: 1.0, viewportHeight: 1380, viewportWidth: 640)

/// Device budgets with materialization unthrottled, so one frame reaches the steady cut.
func steadyBudgets(_ thermal: ThermalLevel = .fair) -> Budgets {
    var b = Budgets.iPhone15Pro(thermal)
    b.materializations = 100_000
    return b
}

/// Builds frames with `previous` threaded through until no materialization is pending.
func settledCut(_ bodies: [BodyFrame], _ view: ViewState, _ budgets: Budgets, _ r: Resolver, previous: Cut? = nil) -> Cut {
    var cut = buildCut(bodies: bodies, view: view, budgets: budgets, previous: previous, resolver: r)
    for _ in 0..<64 where cut.requests > 0 {
        cut = buildCut(bodies: bodies, view: view, budgets: budgets, previous: cut, resolver: r)
    }
    return buildCut(bodies: bodies, view: view, budgets: budgets, previous: cut, resolver: r)
}
