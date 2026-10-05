import Foundation
import LupiChem
import LupiScaleCore

/// Where the traversal starts (§9.4).
extension CutBuilder {
    static let allFaces: UInt8 = 0b11_1111

    func addBody(_ index: Int, _ frame: BodyFrame) {
        do {
            let bodyView = try resolver.resolve(frame.ref.root, frame.ref.path)
            let count = try resolver.cached("count:" + frame.ref.key.hex) { try resolver.count(bodyView) }
            let anchor = try resolver.walk(bodyView, frame.anchorPath)
            let anchorAggregate = try resolver.aggregate(anchor)
            let sigma = frame.metresPerAnchorUnit
            let terrain = !frame.anchorPath.isEmpty || sigma * anchorAggregate.bounds.longest > CutTuning.terrainSpan
            bases.append(frame.anchorPath)
            frames.append(frame)
            var state = BodyState(
                index: index, sigma: sigma, worldFromAnchor: frame.worldFromAnchor,
                worldRotation: frame.worldFromAnchor.rotation.matrix, cameraA: frame.anchorPoint(camera),
                anchorCentre: anchorAggregate.centre, terrain: terrain, base: Int32(bases.count - 1)
            )
            state.cameraRotation = cameraRotation * state.worldRotation
            state.cameraTranslation = cameraFromWorld.apply(frame.worldFromAnchor.translation)
            bodies.append(state)
            bodyCounts.append(count)
            let bi = Int32(bodies.count - 1)
            if frame.anchorPath.isEmpty {
                try addAnchorAlone(bi, anchor, bodyView: bodyView, key: frame.ref.key.leadingUInt64)
            } else {
                try addNeighbourhood(bi, bodyView: bodyView, anchor: anchor)
            }
        } catch let e as ScaleError {
            failures[index] = e
            bodies.append(placeholderBody(index, frame))
            bodyCounts.append(.zero)
        } catch {
            failures[index] = ScaleError(.path, "\(error)")
            bodies.append(placeholderBody(index, frame))
            bodyCounts.append(.zero)
        }
    }

    private func placeholderBody(_ index: Int, _ frame: BodyFrame) -> BodyState {
        bases.append([])
        frames.append(frame)
        return BodyState(
            index: index, sigma: frame.metresPerAnchorUnit, worldFromAnchor: frame.worldFromAnchor,
            worldRotation: frame.worldFromAnchor.rotation.matrix, cameraA: .zero, anchorCentre: .zero, terrain: false,
            base: Int32(bases.count - 1)
        )
    }

    /// A toy or a monument: the body's own node, every face exposed (§8.3).
    func addAnchorAlone(_ bi: Int32, _ anchor: View, bodyView: View, key: UInt64) throws {
        let base = bodies[Int(bi)].base
        if anchor.kind == .leaf, let leaf = anchor.leaf, leaf.count <= CutTuning.meshAtoms {
            atomSets.append(AtomSet(atomicNumbers: leaf.atomicNumbers, positions: leaf.positions))
            let agg = try resolver.aggregate(anchor)
            let n = CNode(
                kind: .mesh, body: bi, payload: Int32(atomSets.count - 1), key64: key, s: 1, rot: -1, t: .zero,
                bounds: agg.bounds, epsilon: 0, faces: Self.allFaces, solid: false, colour: agg.colour.float3,
                cost: standInCost(.mesh), final: true
            )
            if let h = add(n, parent: -1, step: .start, base: base) { starts.append(h) }
            return
        }
        let n = try makeNode(anchor, body: bi, s: 1, rot: -1, t: .zero, key: key, faces: Self.allFaces)
        // A terrain short of E_desc keeps its own node as anchor (§8.4); a camera inside it is
        // inside the solid, so its bubble opens as for a neighbourhood (addStarts).
        if n.solid && bodies[Int(bi)].terrain && n.bounds.contains(bodies[Int(bi)].cameraA) { bodies[Int(bi)].bubble = true }
        if let h = add(n, parent: -1, step: .start, base: base) { starts.append(h) }
    }

    /// Turns a resolved view into a node: fast for levels, boxes and copies, else through the resolver.
    func makeNode(_ v: View, body: Int32, s: Double, rot: Int32, t: Vec3, key: UInt64, faces: UInt8) throws -> CNode {
        switch v.kind {
        case .level where v.removals.isEmpty:
            let ti = try towerSlot(v.record)
            let tc = towers[Int(ti)]
            addLevelBase(LevelBase(tower: ti, k0: v.level, runs0: v.towerRuns))
            let shape = LevelShape(v.level)
            return CNode(
                kind: .level, body: body, payload: ti, levelBase: Int32(levelBases.count - 1), depth: 0, key64: key, s: s, rot: rot,
                t: t, bounds: tc.envelope(shape), epsilon: tc.epsilon * shape.inverseUnit(tc.factor), faces: faces, solid: tc.solid,
                colour: tc.colour.float3, cost: standInCost(.level)
            )
        case .box where v.removals.isEmpty:
            let c = v.crystal!
            let ci = crystalSlot(v.id, c)
            let g = crystals[Int(ci)]
            return CNode(
                kind: .box, body: body, payload: ci, cellBox: addCellBox(v.box), key64: key, s: s, rot: rot, t: t,
                bounds: g.envelope(v.box), epsilon: g.rAtom, faces: faces, solid: true, colour: boxColour(g, v.box).float3,
                cost: standInCost(.box)
            )
        case .copy:
            let ti = try towerSlot(v.record)
            let tc = towers[Int(ti)]
            addLevelBase(LevelBase(tower: ti, k0: BigUInt(), runs0: v.towerRuns))
            return copyNode(tc, ti, base: Int32(levelBases.count - 1), depth: 0, body: body, key: key, s: s, rot: rot, t: t, faces: faces)
        default:
            views.append(v)
            let agg = try resolver.aggregate(v)
            viewSplats.append(agg.splats)
            viewKeys.append(nil)
            let solid = agg.solid
            return CNode(
                kind: .view, body: body, payload: Int32(views.count - 1), key64: key, s: s, rot: rot, t: t, bounds: agg.bounds,
                epsilon: agg.geometricError, faces: faces, solid: solid, hasRemovals: !v.removals.isEmpty, colour: agg.colour.float3,
                cost: solid ? standInCost(.box) : standInCost(.view, splats: agg.splats.count)
            )
        }
    }

    func addLevelBase(_ base: LevelBase) {
        levelBases.append(base)
        levelBaseIDs.append(-1)
    }

    func copyNode(
        _ tc: TowerContext, _ ti: Int32, base: Int32, depth: Int32, body: Int32, key: UInt64, s: Double, rot: Int32, t: Vec3, faces: UInt8
    ) -> CNode {
        let seed = tc.seedAggregate
        return CNode(
            kind: .copy, body: body, payload: ti, levelBase: base, depth: depth, key64: key, s: s, rot: rot, t: t, bounds: seed.bounds,
            epsilon: tc.solid ? tc.rAtom : seed.geometricError, faces: faces, solid: tc.solid, colour: tc.colour.float3,
            cost: tc.solid ? standInCost(.copy) : standInCost(.view, splats: seed.splats.count)
        )
    }

    func boxColour(_ g: CrystalGeometry, _ b: CellBox) -> Vec3 {
        var counts: [UInt8: Double] = [:]
        for (z, n) in CrystalMath.speciesCounts(g.crystal, b) { counts[z] = n.double }
        return Toy.meanColour(counts)
    }

    // MARK: Terrain (§9.4)

    /// A terrain anchor below the body's node: its index neighbourhood in a tower or crystal,
    /// the root's face planes near the camera, and the children of groups above it within z_far.
    func addNeighbourhood(_ bi: Int32, bodyView: View, anchor: View) throws {
        let b = bodies[Int(bi)]
        let path = frames[b.index].anchorPath
        var tail = 0
        // The trailing steps of one kind name the anchor inside its innermost tower or crystal.
        if anchor.kind == .level || anchor.kind == .copy {
            while tail < path.count, case .tower = path[path.count - 1 - tail] { tail += 1 }
        } else if anchor.kind == .box {
            while tail < path.count, case .cells = path[path.count - 1 - tail] { tail += 1 }
        }
        let head = Array(path[0..<(path.count - tail)])
        let structureRoot = try resolver.walk(bodyView, head)
        var found = false
        if tail > 0, anchor.kind == .level || anchor.kind == .copy {
            try towerNeighbourhood(bi, head: head, root: structureRoot, anchor: anchor, tail: Array(path.suffix(tail)))
            found = true
        } else if tail > 0, anchor.kind == .box {
            try crystalNeighbourhood(bi, head: head, root: structureRoot, anchor: anchor)
            found = true
        }
        if !found {
            let key = refKey(b, path)
            let n = try makeNode(anchor, body: bi, s: 1, rot: -1, t: .zero, key: key, faces: Self.allFaces)
            if let h = add(n, parent: -1, step: .start, base: b.base) { starts.append(h) }
        }
        try groupSiblings(bi, bodyView: bodyView, upTo: head)
    }

    func refKey(_ b: BodyState, _ steps: [Step]) -> UInt64 {
        let ref = frames[b.index].ref
        let id = ResidentStore.RefID(root: ref.root, steps: ref.path.steps + steps)
        if let k = resident.refKey(id) { return k }
        // A path that cannot be canonicalized still gets a stable display key.
        let k = (try? Path(canonicalizing: id.steps)).map { ScaleRef.refKey(root: ref.root, path: $0).leadingUInt64 }
            ?? SplitMix64.mix(ref.root.leadingUInt64 &+ UInt64(id.steps.count))
        resident.setRefKey(id, k)
        return k
    }

    /// The 3 × 3 × 3 nodes at the anchor's level, by ±1 on the per-axis indices with carries (§9.4).
    func towerNeighbourhood(_ bi: Int32, head: [Step], root: View, anchor: View, tail: [Step]) throws {
        let b = bodies[Int(bi)]
        guard let tower = anchor.tower else { return }
        let tc = try TowerContext.of(anchor.record, resolver)
        let f = UInt8(tc.factor)
        var rel: [[DigitRun]] = [[], [], []]
        var levels = BigUInt()
        for s in tail {
            if case let .tower(d, runs) = s {
                levels += d
                for a in 0..<3 { rel[a] = AnchorPath.mergeRuns(rel[a], runs[a]) }
            }
        }
        let k = anchor.kind == .level ? anchor.level : BigUInt()
        let shape = LevelShape(k)
        let n = shape.counts(tc.factor)
        // Step vectors between neighbours, in the anchor's units.
        let stepVec = (0..<3).map { n[$0] * tc.periods[$0] }
        var candidates: [(CNode, [Step])] = []
        for dz in -1...1 {
            for dy in -1...1 {
                for dx in -1...1 {
                    let d = [dx, dy, dz]
                    var digits = rel
                    var outside = false
                    for a in 0..<3 where d[a] != 0 {
                        guard let moved = d[a] > 0 ? Digits.increment(rel[a], f) : Digits.decrement(rel[a], f) else {
                            outside = true
                            break
                        }
                        digits[a] = moved
                    }
                    if outside { continue }
                    let steps = head + [Step.tower(levels: levels, runs: digits)]
                    guard let v = try? resolver.walk(resolver.walk(root, []), [Step.tower(levels: levels, runs: digits)]) else { continue }
                    _ = tower
                    var faces: UInt8 = 0
                    for a in 0..<3 {
                        if Digits.all(digits[a], 0) { faces |= 1 << UInt8(2 * a) }
                        if Digits.all(digits[a], f - 1) { faces |= 1 << UInt8(2 * a + 1) }
                    }
                    var t = Vec3.zero
                    for a in 0..<3 { t += Double(d[a]) * stepVec[a] }
                    let key = refKey(b, steps)
                    var node = try makeNode(v, body: bi, s: 1, rot: -1, t: t, key: key, faces: faces)
                    if node.kind == .view && v.kind == .level { node.solid = tc.solid }
                    candidates.append((node, steps))
                }
            }
        }
        addStarts(bi, candidates)
        // Face planes: the root's outer faces within reach of the neighbourhood (§9.4).
        for a in 0..<3 {
            let other = (tc.periods[(a + 1) % 3].cross(tc.periods[(a + 2) % 3])).normalized
            let outward = other.dot(tc.periods[a]) > 0 ? other : -other
            if let index = Digits.smallValue(rel[a], f, limit: 4) {
                let point = -Double(index) * stepVec[a]
                addFacePlane(bi, point: point, normal: -outward, colour: tc.colour)
            }
            if let index = Digits.smallValue(Digits.complement(rel[a], f), f, limit: 4) {
                let point = Double(index + 1) * stepVec[a]
                addFacePlane(bi, point: point, normal: outward, colour: tc.colour)
            }
        }
    }

    /// The boxes at the anchor's octree depth that hold the cells up to ⌈z_far / cell width⌉
    /// cells beyond its faces, found from the root (§9.4).
    func crystalNeighbourhood(_ bi: Int32, head: [Step], root: View, anchor: View) throws {
        let b = bodies[Int(bi)]
        guard let c = anchor.crystal else { return }
        let ci = crystalSlot(anchor.id, c)
        let g = crystals[Int(ci)]
        let rootBox = root.kind == .box ? root.box : CrystalMath.rootBox(c)
        var depth = 0
        var probe = rootBox
        while probe != anchor.box {
            guard let next = CrystalMath.octreeChildren(probe).first(where: { contains($0.box, anchor.box) }) else { break }
            probe = next.box
            depth += 1
        }
        let reach = UInt64(min(1e15, (view.zFar / (b.sigma * g.cellWidth)).rounded(.up)))
        var lo = SIMD3<UInt64>.zero, hi = SIMD3<UInt64>.zero
        for a in 0..<3 {
            lo[a] = anchor.box.lo[a] >= rootBox.lo[a] + reach ? anchor.box.lo[a] - reach : rootBox.lo[a]
            hi[a] = min(rootBox.hi[a], anchor.box.hi[a] &+ reach < anchor.box.hi[a] ? rootBox.hi[a] : anchor.box.hi[a] + reach)
        }
        let range = CellBox(lo: lo, hi: hi)
        var found: [(CellBox, [UInt8])] = []
        func descend(_ box: CellBox, _ octants: [UInt8], _ level: Int) {
            if level == depth {
                found.append((box, octants))
                return
            }
            for child in CrystalMath.octreeChildren(box) where overlaps(child.box, range) {
                descend(child.box, octants + [child.octant], level + 1)
            }
        }
        descend(rootBox, [], 0)
        var candidates: [(CNode, [Step])] = []
        for (box, octants) in found.prefix(512) {
            let steps = head + (octants.isEmpty ? [] : [Step.cells(octants)])
            guard let v = try? resolver.walk(root, octants.isEmpty ? [] : [.cells(octants)]) else { continue }
            var faces: UInt8 = 0
            for a in 0..<3 {
                if box.lo[a] == rootBox.lo[a] { faces |= 1 << UInt8(2 * a) }
                if box.hi[a] == rootBox.hi[a] { faces |= 1 << UInt8(2 * a + 1) }
            }
            var t = Vec3.zero
            for a in 0..<3 { t[a] = (Double(box.lo[a]) - Double(anchor.box.lo[a])) * g.cellWidth }
            candidates.append((try makeNode(v, body: bi, s: 1, rot: -1, t: t, key: refKey(b, steps), faces: faces), steps))
        }
        addStarts(bi, candidates)
        for a in 0..<3 {
            var normal = Vec3.zero
            normal[a] = 1
            if anchor.box.lo[a] - rootBox.lo[a] <= reach {
                var p = Vec3.zero
                p[a] = (Double(rootBox.lo[a]) - Double(anchor.box.lo[a])) * g.cellWidth
                addFacePlane(bi, point: p, normal: -normal, colour: boxColour(g, anchor.box))
            }
            if rootBox.hi[a] - anchor.box.hi[a] <= reach {
                var p = Vec3.zero
                p[a] = (Double(rootBox.hi[a]) - Double(anchor.box.lo[a])) * g.cellWidth
                addFacePlane(bi, point: p, normal: normal, colour: boxColour(g, anchor.box))
            }
        }
    }

    /// Adds a neighbourhood's nodes. A camera inside one of its solid nodes is inside the solid:
    /// its excavation bubble opens (§10.1) before the enclosed rule culls anything.
    func addStarts(_ bi: Int32, _ candidates: [(CNode, [Step])]) {
        let b = bodies[Int(bi)]
        let inside = candidates.contains { node, _ in
            node.solid && node.bounds.transformed(scale: node.s, rotation: rotation(node.rot), translation: node.t).contains(b.cameraA)
        }
        if inside { bodies[Int(bi)].bubble = true }
        for (node, steps) in candidates {
            bases.append(steps)
            if let h = add(node, parent: -1, step: .start, base: Int32(bases.count - 1)) { starts.append(h) }
        }
    }

    func contains(_ outer: CellBox, _ inner: CellBox) -> Bool {
        (0..<3).allSatisfy { outer.lo[$0] <= inner.lo[$0] && inner.hi[$0] <= outer.hi[$0] }
    }

    func overlaps(_ a: CellBox, _ b: CellBox) -> Bool {
        (0..<3).allSatisfy { a.lo[$0] < b.hi[$0] && b.lo[$0] < a.hi[$0] }
    }

    /// The children of every group between the body's node and the structure holding the anchor,
    /// when they come within z_far of the camera (§9.4).
    func groupSiblings(_ bi: Int32, bodyView: View, upTo head: [Step]) throws {
        let b = bodies[Int(bi)]
        let path = frames[b.index].anchorPath
        guard path.contains(where: { if case .child = $0 { return true }; return false }) else { return }
        // anchor ← body, composed once.
        let toAnchor = try resolver.placement(from: bodyView, steps: path).placement.inverse
        var v = bodyView
        var bodyToPrefix = Placement.identity
        for (i, s) in path.enumerated() {
            if case let .child(chosen) = s, let children = v.groupChildren {
                for j in children.indices where j != Int(chosen) {
                    guard let w = try? resolver.step(v, .child(UInt16(j))) else { continue }
                    let p = toAnchor.then(bodyToPrefix).then(try resolver.placement(from: v, step: .child(UInt16(j))))
                    let agg = try resolver.aggregate(w)
                    let box = agg.bounds.transformed(scale: p.scale, rotation: p.rotation, translation: p.translation)
                    if box.distance(to: b.cameraA) * b.sigma > view.zFar { continue }
                    let steps = Array(path[0..<i]) + [Step.child(UInt16(j))]
                    let node = try makeNode(
                        w, body: bi, s: p.scale, rot: rotationSlot(p.rotation), t: p.translation, key: refKey(b, steps), faces: Self.allFaces
                    )
                    bases.append(steps)
                    if let h = add(node, parent: -1, step: .start, base: Int32(bases.count - 1)) { starts.append(h) }
                }
            }
            if i >= head.count { break }
            bodyToPrefix = bodyToPrefix.then(try resolver.placement(from: v, step: s))
            v = try resolver.step(v, s)
        }
    }

    /// A face plane of the root, as an item in the camera frame entity (§8.5, §9.4).
    func addFacePlane(_ bi: Int32, point: Vec3, normal: Vec3, colour: Vec3) {
        let b = bodies[Int(bi)]
        // The plane's point nearest the camera, so the item stays within reach.
        let toCamera = b.cameraA - point
        let foot = b.cameraA - toCamera.dot(normal) * normal
        let world = b.worldFromAnchor.apply(b.sigma * foot)
        let distance = abs(toCamera.dot(normal)) * b.sigma
        if distance > view.zFar { return }
        let n = b.worldRotation * normal
        planes.append(DrawItem(
            kind: .facePlane, node: -1, body: b.index, parent: .cameraFrame,
            transform: Transform3x4(Mat3.identity, world - cameraFrameOrigin), fade: 1, key32: 0,
            extras: .plane(normal: SIMD3(Float(n.x), Float(n.y), Float(n.z)), halfExtent: Float(view.zFar), colour: colour.float3),
            halfExtents: SIMD3(Float(view.zFar), Float(view.zFar), 0)
        ))
    }
}

extension Vec3 {
    var float3: SIMD3<Float> { SIMD3<Float>(Float(x), Float(y), Float(z)) }
}

/// Base-f digit strings as runs: ±1 with carries and borrows, in O(runs) (§9.4).
enum Digits {
    static func increment(_ runs: [DigitRun], _ f: UInt8) -> [DigitRun]? { step(runs, f, up: true) }
    static func decrement(_ runs: [DigitRun], _ f: UInt8) -> [DigitRun]? { step(runs, f, up: false) }

    private static func step(_ runs: [DigitRun], _ f: UInt8, up: Bool) -> [DigitRun]? {
        let wrapDigit: UInt8 = up ? f - 1 : 0
        var r = runs
        var trailing = BigUInt()
        if let last = r.last, last.digit == wrapDigit {
            trailing = last.length
            r.removeLast()
        }
        guard var last = r.popLast() else { return nil }
        let changed = up ? last.digit + 1 : last.digit - 1
        last.length = last.length.minus(1)
        if !last.length.isZero { r.append(last) }
        r = AnchorPath.mergeRuns(r, [DigitRun(digit: changed, length: 1)])
        if !trailing.isZero { r = AnchorPath.mergeRuns(r, [DigitRun(digit: up ? 0 : f - 1, length: trailing)]) }
        return r
    }

    static func all(_ runs: [DigitRun], _ d: UInt8) -> Bool { runs.allSatisfy { $0.digit == d } }

    /// The value of the digits when it is at most `limit`.
    static func smallValue(_ runs: [DigitRun], _ f: UInt8, limit: Int) -> Int? {
        var v = 0
        for run in runs {
            if run.digit == 0 && v == 0 { continue }
            guard let n = run.length.int, n < 64 else { return nil }
            for _ in 0..<n {
                v = v * Int(f) + Int(run.digit)
                if v > limit { return nil }
            }
        }
        return v
    }

    /// (f − 1 − d) for every digit: the index counted from the upper end.
    static func complement(_ runs: [DigitRun], _ f: UInt8) -> [DigitRun] {
        runs.map { DigitRun(digit: f - 1 - $0.digit, length: $0.length) }
    }
}
