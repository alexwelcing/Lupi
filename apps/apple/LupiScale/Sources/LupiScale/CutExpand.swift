import Foundation
import LupiChem
import LupiScaleCore

/// Refinement (§9.2's last column) and emission (§9.7).
extension CutBuilder {
    /// The children of a node that are drawn: nil when one is not resident yet.
    func expand(_ x: Int32) -> [Int32]? {
        let node = nodes[Int(x)]
        do {
            switch node.kind {
            case .level: return try expandLevel(x, node)
            case .box: return try expandBox(x, node)
            case .copy: return try atomsOf(x, node)
            case .view: return try expandView(x, node)
            case .atoms, .mesh: return []
            }
        } catch {
            // Missing data draws the parent.
            return nil
        }
    }

    // MARK: Tower levels

    func expandLevel(_ x: Int32, _ n: CNode) throws -> [Int32] {
        let base = levelBases[Int(n.levelBase)]
        let tc = towers[Int(n.payload)]
        let (a, atLeastFour) = base.axis(Int(n.depth))
        let f = tc.factor
        // The child's frame is 1/f of the parent's when k ≡ 1 (mod 3) and k ≥ 4 (§3.4.2).
        let shrink = a == 0 && atLeastFour ? 1 / Double(f) : 1
        let childDepth = n.depth + 1
        let child = base.level(Int(childDepth), factor: f)
        let r = rotation(n.rot)
        let pitch = r * tc.periods[a]
        // A reused buffer: the caller is done with the last expansion's handles.
        var out = kidScratch
        kidScratch = []
        out.removeAll(keepingCapacity: true)
        defer { kidScratch = out }
        let childBounds = child.isZero ? nil : tc.envelope(axis: child.axis, inverseUnit: child.inverseUnit)
        let childEpsilon = tc.epsilon * (child.isZero ? 1 : child.inverseUnit)
        let lower = UInt8(1 << (2 * a)), upper = UInt8(1 << (2 * a + 1))
        for j in 0..<f {
            var faces = n.faces & ~(lower | upper)
            if j == 0 { faces |= n.faces & lower }
            if j == f - 1 { faces |= n.faces & upper }
            let t = n.t + (n.s * Double(j)) * pitch
            let s = n.s * shrink
            let key = childKey(n.key64, j)
            var kid: CNode
            if child.isZero {
                kid = try seedNode(tc, n, depth: childDepth, key: key, s: s, t: t, faces: faces)
            } else {
                kid = CNode(
                    kind: .level, body: n.body, payload: n.payload, levelBase: n.levelBase, depth: childDepth, key64: key, s: s,
                    rot: n.rot, t: t, bounds: childBounds!, epsilon: childEpsilon, faces: faces, solid: n.solid, colour: n.colour,
                    cost: n.cost
                )
            }
            if let h = add(kid, parent: x, step: .digit(UInt8(j), axis: UInt8(a))) { out.append(h) }
        }
        return out
    }

    /// Level 0 below a fast level: the copy with a substitution, else the seed's own view (§3.4.4).
    func seedNode(_ tc: TowerContext, _ parent: CNode, depth: Int32, key: UInt64, s: Double, t: Vec3, faces: UInt8) throws -> CNode {
        if tc.tower.substitution != nil {
            return copyNode(tc, parent.payload, base: parent.levelBase, depth: depth, body: parent.body, key: key, s: s, rot: parent.rot, t: t, faces: faces)
        }
        // Every copy of an unsubstituted seed is the seed: one node made once, then placed.
        var node: CNode
        if let template = seedTemplates[parent.payload] {
            node = template
        } else {
            node = try makeNode(try resolver.root(tc.tower.seed), body: parent.body, s: 1, rot: -1, t: .zero, key: 0, faces: CutBuilder.allFaces)
            seedTemplates[parent.payload] = node
        }
        node.body = parent.body
        node.s = s
        node.rot = parent.rot
        node.t = t
        node.key64 = key
        node.faces = tc.solid ? faces : CutBuilder.allFaces
        return node
    }

    // MARK: Crystal boxes

    func expandBox(_ x: Int32, _ n: CNode) throws -> [Int32]? {
        let g = crystals[Int(n.payload)]
        let box = cellBoxes[Int(n.cellBox)]
        if CrystalMath.boxCount(g.crystal, box) <= BigUInt(RecordLimits.maxAtoms) {
            return try atomsOf(x, n)
        }
        let r = rotation(n.rot)
        var out: [Int32] = []
        for child in CrystalMath.octreeChildren(box) {
            var faces = n.faces
            for a in 0..<3 where box.extent(a) >= 2 {
                let upperHalf = child.octant & (1 << UInt8(a)) != 0
                faces &= upperHalf ? ~UInt8(1 << (2 * a)) : ~UInt8(1 << (2 * a + 1))
            }
            var offset = Vec3.zero
            for a in 0..<3 { offset[a] = (Double(child.box.lo[a]) - Double(box.lo[a])) * g.cellWidth }
            let kid = CNode(
                kind: .box, body: n.body, payload: n.payload, cellBox: addCellBox(child.box), key64: childKey(n.key64, Int(child.octant)),
                s: n.s, rot: n.rot, t: n.t + n.s * (r * offset), bounds: g.envelope(child.box), epsilon: g.rAtom, faces: faces,
                solid: true, colour: boxColour(g, child.box).float3, cost: n.cost
            )
            if let h = add(kid, parent: x, step: .octant(child.octant)) { out.append(h) }
        }
        return out
    }

    // MARK: Views through the resolver

    func expandView(_ x: Int32, _ n: CNode) throws -> [Int32]? {
        let v = views[Int(n.payload)]
        switch v.kind {
        case .group:
            guard let children = v.groupChildren else { return [] }
            var out: [Int32] = []
            for (i, c) in children.enumerated() {
                guard let w = try? resolver.step(v, .child(UInt16(i))) else { continue }
                let m = Quat(c.rotation).matrix
                let r = rotation(n.rot)
                let rot = r * m
                let kid = try makeNode(
                    w, body: n.body, s: n.s, rot: rotationSlot(rot), t: n.t + n.s * (r * c.translation), key: childKey(n.key64, i),
                    faces: CutBuilder.allFaces
                )
                if let h = add(kid, parent: x, step: .child(UInt16(i))) { out.append(h) }
            }
            return out
        case .level:
            return try expandWithRemovals(x, n, v)
        case .box where !resolver.isMaterializable(v):
            return try expandWithRemovals(x, n, v)
        default:
            return try atomsOf(x, n)
        }
    }

    /// A level or box that carries removals: its remaining children (§9.4: removals split a node).
    /// A face next to a removed or partly removed sibling is exposed.
    func expandWithRemovals(_ x: Int32, _ n: CNode, _ v: View) throws -> [Int32] {
        var steps: [(Step, Cut.LiteStep, Int, Int, Bool)] = []   // step, lite, index, axis, upper half
        var offsets: [Vec3] = []
        var scale = 1.0
        if v.kind == .level, let t = v.tower {
            let tc = try TowerContext.of(v.record, resolver)
            let a = TowerMath.axis(v.level)
            for j in 0..<Int(t.factor) {
                var runs: [[DigitRun]] = [[], [], []]
                runs[a] = [DigitRun(digit: UInt8(j), length: 1)]
                steps.append((.tower(levels: 1, runs: runs), .digit(UInt8(j), axis: UInt8(a)), j, a, false))
                offsets.append(Double(j) * tc.periods[a])
            }
            if a == 0 && v.level >= BigUInt(4) { scale = 1 / Double(t.factor) }
        } else if v.kind == .box, let c = v.crystal {
            let cw = 4 * Double(c.quarterQ16) / 65536
            for child in CrystalMath.octreeChildren(v.box) {
                steps.append((.cells([child.octant]), .octant(child.octant), Int(child.octant), -1, false))
                var o = Vec3.zero
                for a in 0..<3 { o[a] = (Double(child.box.lo[a]) - Double(v.box.lo[a])) * cw }
                offsets.append(o)
            }
        }
        // Which siblings are gone or carved.
        var views: [View?] = []
        for s in steps { views.append(try? resolver.step(v, s.0)) }
        func damaged(_ i: Int) -> Bool { views[i] == nil || !(views[i]!.removals.isEmpty) }
        let r = rotation(n.rot)
        var out: [Int32] = []
        for (i, s) in steps.enumerated() {
            guard let w = views[i] else { continue }
            var faces = CutBuilder.allFaces
            if n.solid {
                faces = n.faces
                if v.kind == .level {
                    let a = s.3, f = steps.count
                    let lower = UInt8(1 << (2 * a)), upper = UInt8(1 << (2 * a + 1))
                    faces &= ~(lower | upper)
                    if s.2 == 0 { faces |= n.faces & lower } else if damaged(i - 1) { faces |= lower }
                    if s.2 == f - 1 { faces |= n.faces & upper } else if damaged(i + 1) { faces |= upper }
                } else {
                    let o = UInt8(s.2)
                    for a in 0..<3 where v.box.extent(a) >= 2 {
                        let upperHalf = o & (1 << UInt8(a)) != 0
                        let sibling = steps.firstIndex { $0.2 == Int(o ^ (1 << UInt8(a))) }
                        let inner = upperHalf ? UInt8(1 << (2 * a)) : UInt8(1 << (2 * a + 1))
                        faces &= ~inner
                        if let sib = sibling, damaged(sib) { faces |= inner }
                    }
                }
            }
            var kid = try makeNode(
                w, body: n.body, s: n.s * scale, rot: n.rot, t: n.t + n.s * (r * offsets[i]), key: childKey(n.key64, s.2), faces: faces
            )
            kid.solid = kid.solid && n.solid
            if let h = add(kid, parent: x, step: s.1) { out.append(h) }
        }
        return out
    }

    // MARK: Atoms

    /// The final atoms of a leaf-like or solid node: for a solid node, only its outermost cell
    /// layer on each exposed face (§9.5). Nil when the materialization is not resident and the
    /// frame's budget of materializations is spent.
    func atomsOf(_ x: Int32, _ n: CNode) throws -> [Int32]? {
        // With no atom left in the budget nothing can replace the stand-in: skip the work. The
        // caller reads `[x]` as "does not fit".
        guard Int(used.atoms) < budgets.instancedAtoms else { return [x] }
        guard let (leaf, cells, lo, hi) = try materialization(n, x) else { return nil }
        let b = bodies[Int(n.body)]
        let count = leaf.count
        if keepScratch.count < count { keepScratch = [Bool](repeating: false, count: max(count, 4096)) }
        let kept = keepScratch.withUnsafeMutableBufferPointer { keep -> Int in
            let initial = !n.solid || cells == nil
            for i in 0..<count { keep[i] = initial }
            if n.solid, let cells {
                if n.kind == .copy, case let lists = towers[Int(n.payload)].faceAtoms, lists.count == 6 {
                    for f in 0..<6 where n.faces & (1 << UInt8(f)) != 0 {
                        for i in lists[f] { keep[Int(i)] = true }
                    }
                } else {
                    for i in 0..<count {
                        var exposed = false
                        for a in 0..<3 {
                            if n.faces & (1 << UInt8(2 * a)) != 0 && cells[i][a] == lo[a] { exposed = true }
                            if n.faces & (1 << UInt8(2 * a + 1)) != 0 && cells[i][a] == hi[a] - 1 { exposed = true }
                        }
                        keep[i] = exposed
                    }
                }
            }
            if b.bubble && n.solid {
                // Inside the solid, the visible atoms are the bubble's wall: those outside the
                // bubble within a shell of two cells, as well as the exposed face layers. Only
                // nodes that reach into the shell need the per-atom test.
                let r = rotation(n.rot)
                let radius = CutTuning.bubbleRadius / b.sigma
                let shell = radius + 2 * n.s * cellWidth(n)
                let box = n.bounds.transformed(scale: n.s, rotation: r, translation: n.t)
                if box.distance(to: b.cameraA) <= shell {
                    let identity = n.rot < 0
                    let c = b.cameraA - n.t
                    let shell2 = shell * shell, radius2 = radius * radius
                    leaf.positions.withUnsafeBufferPointer { ps in
                        for i in 0..<count {
                            let p = Vec3(Double(ps[i].x), Double(ps[i].y), Double(ps[i].z))
                            let q = identity ? n.s * p : n.s * (r * p)
                            let d = q - c
                            let d2 = d.x * d.x + d.y * d.y + d.z * d.z
                            if d2 < radius2 { keep[i] = false } else if d2 <= shell2 { keep[i] = true }
                        }
                    }
                }
            }
            var k = 0
            for i in 0..<count where keep[i] { k += 1 }
            return k
        }
        if kept == 0 { return [] }
        // The atoms replace the stand-in; when they cannot fit, the stand-in stays (§9.5).
        if Int(used.atoms) - Int(n.cost.atoms) + kept > budgets.instancedAtoms { return [x] }
        var z: [UInt8] = []
        var pos: [SIMD3<Float>] = []
        z.reserveCapacity(kept)
        pos.reserveCapacity(kept)
        keepScratch.withUnsafeBufferPointer { keep in
            for i in 0..<count where keep[i] {
                z.append(leaf.atomicNumbers[i])
                pos.append(leaf.positions[i])
            }
        }
        atomSets.append(AtomSet(atomicNumbers: z, positions: pos))
        let kid = CNode(
            kind: .atoms, body: n.body, payload: Int32(atomSets.count - 1), key64: childKey(n.key64, 0), s: n.s, rot: n.rot, t: n.t,
            bounds: n.bounds, epsilon: 0, faces: n.faces, solid: false, colour: n.colour,
            cost: standInCost(.atoms, atoms: z.count), final: true
        )
        if let h = add(kid, parent: x, step: .atoms) { return [h] }
        return []
    }

    /// The cell width of a solid node's crystal, Å in its own units.
    func cellWidth(_ n: CNode) -> Double {
        switch n.kind {
        case .box: return crystals[Int(n.payload)].cellWidth
        case .copy, .level:
            if let c = towers[Int(n.payload)].seedCrystal { return 4 * Double(c.quarterQ16) / 65536 }
            return 0
        case .view:
            if let c = views[Int(n.payload)].crystal { return 4 * Double(c.quarterQ16) / 65536 }
            return 0
        default: return 0
        }
    }

    /// A node's materialization and, for a solid one, the owner cells of its atoms and the box
    /// they are counted in. Resident data is reused; at most `budgets.materializations` new ones
    /// per frame (§9.6).
    func materialization(_ n: CNode, _ x: Int32) throws -> (LeafNode, [SIMD3<UInt64>]?, SIMD3<UInt64>, SIMD3<UInt64>)? {
        switch n.kind {
        case .box:
            let g = crystals[Int(n.payload)]
            let id = crystalIDs[Int(n.payload)]
            let box = cellBoxes[Int(n.cellBox)]
            let key = "mat:box:\(id.hex):\(box.lo.x),\(box.lo.y),\(box.lo.z),\(box.hi.x),\(box.hi.y),\(box.hi.z)"
            guard let m = resident(key, { CrystalMath.atoms(g.crystal, box) }) else { return nil }
            return (m.leaf, m.cells, box.lo, box.hi)
        case .copy:
            let tc = towers[Int(n.payload)]
            // Resident by the copy's exact path (its base's runs and the digits below them), so a
            // frame hashes only the copy keys of new materializations (§9.6).
            let id = copyIdentity(x, n)
            let leaf: LeafNode
            if let l = resident.copy(id) {
                leaf = l
            } else {
                guard materialized < budgets.materializations else { return nil }
                materialized += 1
                let copyKey = TowerMath.copyKey(tower: tc.record.id, levels: tc.tower.levels, runs: copyRuns(x))
                let seed = try resolver.materialize(resolver.root(tc.tower.seed))
                if let s = tc.tower.substitution {
                    let z = try TowerMath.substitute(seed.atomicNumbers, s, key: copyKey).atomicNumbers
                    leaf = LeafNode(atomicNumbers: z, positions: seed.positions)
                } else {
                    leaf = seed
                }
                resident.setCopy(id, leaf)
            }
            if tc.solid, let c = tc.seedCrystal, let cells = tc.seedCells {
                return (leaf, cells, .zero, c.cells)
            }
            return (leaf, nil, .zero, .zero)
        case .view:
            let v = views[Int(n.payload)]
            if viewKeys[Int(n.payload)] == nil { viewKeys[Int(n.payload)] = "mat:view:" + ViewKey.of(v) }
            guard let leaf = try residentThrowing(viewKeys[Int(n.payload)]!, { try resolver.materialize(v) }) else { return nil }
            if n.solid, v.kind == .box, let cells = try resolver.ownerCells(v) {
                return (leaf, cells, v.box.lo, v.box.hi)
            }
            return (leaf, nil, .zero, .zero)
        default:
            return nil
        }
    }

    func resident<T: Sendable>(_ key: String, _ make: () -> T) -> T? {
        if let v = resolver.residentValue(key) as? T { return v }
        guard materialized < budgets.materializations else { return nil }
        materialized += 1
        return resolver.cached(key, make)
    }

    func residentThrowing<T: Sendable>(_ key: String, _ make: () throws -> T) throws -> T? {
        if let v = resolver.residentValue(key) as? T { return v }
        guard materialized < budgets.materializations else { return nil }
        materialized += 1
        return try resolver.cached(key, make)
    }

    /// A copy's exact identity within its tower: its base (interned once per frame) and the
    /// digits taken below it, read up the arena.
    func copyIdentity(_ x: Int32, _ n: CNode) -> ResidentStore.CopyID {
        let bi = Int(n.levelBase)
        if levelBaseIDs[bi] < 0 {
            let base = levelBases[bi]
            levelBaseIDs[bi] = resident.base(.init(tower: towers[Int(base.tower)].record.id, runs: base.runs0))
        }
        var digits: [UInt8] = []
        var i = x
        while i >= 0 {
            let p = arena[Int(i)].parent
            guard p >= 0, nodes[Int(p)].levelBase == n.levelBase else { break }
            if case let .digit(d, a) = arena[Int(i)].step { digits.append(a &* 16 &+ d) }
            i = p
        }
        return .init(base: levelBaseIDs[bi], digits: digits)
    }

    /// Per axis, a copy's digits from the tower's top: its base's, then the digits taken in its
    /// base's fast chain, read up the arena.
    func copyRuns(_ x: Int32) -> [[DigitRun]] {
        let n = nodes[Int(x)]
        let base = levelBases[Int(n.levelBase)]
        var digits: [(UInt8, UInt8)] = []
        var i = x
        while i >= 0 {
            let p = arena[Int(i)].parent
            guard p >= 0, nodes[Int(p)].levelBase == n.levelBase else { break }
            if case let .digit(d, a) = arena[Int(i)].step { digits.append((d, a)) }
            i = p
        }
        var runs = base.runs0
        for (d, a) in digits.reversed() {
            runs[Int(a)] = AnchorPath.mergeRuns(runs[Int(a)], [DigitRun(digit: d, length: 1)])
        }
        return runs
    }

    // MARK: Emission (§9.7)

    func emit(_ x: Int32) {
        let n = nodes[Int(x)]
        let b = bodies[Int(n.body)]
        let r = rotation(n.rot)
        let centre = n.bounds.centre
        // Composed in binary64, cast to Float32 once (§8.5).
        let linear: Mat3
        let translation: Vec3
        let parent: DrawItem.Parent
        if b.terrain {
            linear = (b.worldRotation * r).scaled(by: b.sigma * n.s)
            translation = b.worldFromAnchor.apply(b.sigma * (n.s * (r * centre) + n.t)) - cameraFrameOrigin
            parent = .cameraFrame
        } else {
            linear = r.scaled(by: b.sigma * n.s)
            translation = b.sigma * (n.s * (r * centre) + n.t - b.anchorCentre)
            parent = .body(b.index)
        }
        let transform = Transform3x4(linear, translation)
        let half = n.bounds.halfExtents.float3
        let colour = n.colour
        let kind: DrawItem.Kind
        let extras: DrawExtras
        switch n.kind {
        case .atoms, .mesh:
            let set = atomSets[Int(n.payload)]
            kind = n.kind == .mesh ? .leafMesh : .atomInstances
            extras = .atoms(elementRuns(set, centre: centre))
            drawnAtoms += set.atomicNumbers.count
        case .level, .box, .copy:
            if n.kind == .copy && !n.solid {
                kind = .splats
                extras = .splats(towers[Int(n.payload)].seedSplats, colour: colour)
            } else {
                kind = .box
                extras = .box(halfExtents: half, colour: colour)
            }
        case .view:
            let splats = viewSplats[Int(n.payload)]
            if n.solid || splats.isEmpty {
                kind = .box
                extras = .box(halfExtents: half, colour: colour)
            } else {
                kind = .splats
                extras = .splats(splats.map { relative($0, centre) }, colour: colour)
            }
        }
        items.append(DrawItem(
            kind: kind, node: Int(x), body: b.index, parent: parent, transform: transform, fade: 1,
            key32: UInt32(truncatingIfNeeded: n.key64), extras: extras, halfExtents: half
        ))
    }

    func relative(_ s: SIMD4<Double>, _ centre: Vec3) -> SIMD4<Float> {
        SIMD4(Float(s.x - centre.x), Float(s.y - centre.y), Float(s.z - centre.z), Float(s.w))
    }

    func elementRuns(_ set: AtomSet, centre: Vec3) -> [ElementRun] {
        // Counted first, so each run's array is allocated once; runs in increasing Z.
        var counts = [Int](repeating: 0, count: 256)
        for z in set.atomicNumbers { counts[Int(z)] += 1 }
        var slot = [Int](repeating: -1, count: 256)
        var runs: [ElementRun] = []
        for z in 0..<256 where counts[z] > 0 {
            slot[z] = runs.count
            var positions: [SIMD3<Float>] = []
            positions.reserveCapacity(counts[z])
            runs.append(ElementRun(atomicNumber: UInt8(z), radius: Toy.radii[z], colour: Toy.colours[z], positions: positions))
        }
        for (z, p) in zip(set.atomicNumbers, set.positions) {
            let local = SIMD3<Float>(Float(Double(p.x) - centre.x), Float(Double(p.y) - centre.y), Float(Double(p.z) - centre.z))
            runs[slot[Int(z)]].positions.append(local)
        }
        return runs
    }
}
