import LupiScaleCore
import Testing

/// §2: records that decode only when every byte is canonical.
@Suite("§2 record validation")
struct RecordValidationTests {
    static func water() throws -> NodeRecord {
        try NodeRecord(.leaf(LeafNode(atomicNumbers: [8, 1, 1], positions: [.zero, SIMD3(0.28, 0.89, 0.25), SIMD3(0.61, -0.24, -0.72)])))
    }

    func reject(_ code: ScaleError.Code, _ bytes: [UInt8], sourceLocation: SourceLocation = #_sourceLocation) {
        expectCode(code, sourceLocation) { _ = try NodeRecord(bytes: bytes) }
    }

    func edited(_ base: [UInt8], _ edit: (inout [UInt8]) -> Void) -> [UInt8] {
        var b = base
        edit(&b)
        return b
    }

    @Test func header() throws {
        let w = try Self.water().bytes
        reject(.magic, edited(w) { $0[0] = 0x58 })
        reject(.canonical, edited(w) { $0[6] = 1 })                     // flags
        reject(.truncated, edited(w) { $0.removeLast() })               // body shorter than bodyLength
        reject(.canonical, edited(w) { $0.append(0) })                   // a trailing byte
        reject(.limit, [UInt8](repeating: 0, count: 65_537))
    }

    /// Unknown kinds and kind versions stay opaque; resolving through them is `unsupported` (§2.7).
    @Test func unknownKindsAreOpaque() throws {
        let w = try Self.water().bytes
        let future = try NodeRecord(bytes: edited(w) { $0[4] = 6 })
        #expect(future.node == nil)
        #expect(future.id == NodeID.hashing(future.bytes))
        let v2 = try NodeRecord(bytes: edited(w) { $0[5] = 2 })
        #expect(v2.node == nil)
        expectCode(.unsupported) { _ = try Spec.store([future]).root(future.id) }
        // A group that names it fails only when a path goes through it.
        let group = try NodeRecord(.group([GroupChild(id: future.id), GroupChild(id: try Self.water().id)]))
        let r = Spec.store([future, group, try Self.water()])
        _ = try r.resolve(group.id, try Path(canonicalizing: [.child(1)]))
        expectCode(.unsupported) { _ = try r.resolve(group.id, try Path(canonicalizing: [.child(0)])) }
    }

    @Test func leaves() throws {
        let w = try Self.water().bytes
        reject(.range, edited(w) { writeU32(&$0, 12, 0) })
        reject(.range, edited(w) { $0[16] = 0 })                         // Z = 0
        reject(.range, edited(w) { $0[16] = 119 })                       // Z = 119
        reject(.canonical, edited(w) { $0[19] = 1 })                     // padding
        reject(.canonical, edited(w) { writeU32(&$0, 20, 0x8000_0000) }) // −0
        reject(.range, edited(w) { writeU32(&$0, 20, 0x7FC0_0000) })     // NaN
        reject(.range, edited(w) { writeU32(&$0, 20, Float(2_000_000).bitPattern) })   // beyond 2^20 Å
        expectCode(.range) { _ = try NodeRecord(.leaf(LeafNode(atomicNumbers: [], positions: []))) }
        expectCode(.range) {
            _ = try NodeRecord(.leaf(LeafNode(atomicNumbers: [UInt8](repeating: 1, count: 4097), positions: [SIMD3<Float>](repeating: .zero, count: 4097))))
        }
        expectCode(.range) { _ = try NodeRecord(.leaf(LeafNode(atomicNumbers: [1, 1], positions: [.zero]))) }
    }

    @Test func groups() throws {
        let child = try Self.water().id
        let g = try NodeRecord(.group([GroupChild(id: child)])).bytes
        reject(.range, edited(g) { $0[12] = 0 })                         // no children
        reject(.canonical, edited(g) { $0[14] = 1 })                     // reserved
        // qw = 0.5: not a unit quaternion.
        reject(.validity, edited(g) { b in for (i, v) in Double(0.5).bitPattern.littleEndianBytes.enumerated() { b[16 + 32 + 24 + i] = v } })
        // qw = −1: unit but not the canonical sign.
        reject(.canonical, edited(g) { b in for (i, v) in Double(-1).bitPattern.littleEndianBytes.enumerated() { b[16 + 32 + 24 + i] = v } })
        // tx = 2^41 Å.
        reject(.range, edited(g) { b in for (i, v) in Double(2_199_023_255_552).bitPattern.littleEndianBytes.enumerated() { b[16 + 64 + i] = v } })
        // Writers negate a non-canonical quaternion and keep the rotation.
        let flipped = try NodeRecord(.group([GroupChild(id: child, rotation: SIMD4(0, 0, 0, -1))]))
        #expect(flipped.bytes == g)
        let quarterTurn = try NodeRecord(.group([GroupChild(id: child, rotation: SIMD4(0, -0.6, 0, -0.8))]))
        if case let .group(c)? = quarterTurn.node { #expect(c[0].rotation == SIMD4(0, 0.6, 0, 0.8)) }
        expectCode(.range) { _ = try NodeRecord(.group([])) }
        expectCode(.range) { _ = try NodeRecord(.group([GroupChild](repeating: GroupChild(id: child), count: 257))) }
    }

    @Test func crystals() throws {
        func crystal(_ edit: (inout CrystalNode) -> Void) -> CrystalNode {
            var c = Spec.saltSeed
            edit(&c)
            return c
        }
        let seed = Spec.seedRecord().bytes
        reject(.validity, edited(seed) { $0[15] = 0 })                   // rock salt without B
        reject(.validity, edited(seed) { $0[12] = 3 })                   // fcc with B
        reject(.range, edited(seed) { $0[12] = 6 })                       // structure 6
        reject(.range, edited(seed) { $0[13] = 3 })                       // termination 3
        reject(.range, edited(seed) { writeU32(&$0, 16, 0) })             // quarter 0
        reject(.range, edited(seed) { writeU32(&$0, 16, (1 << 20) + 1) }) // quarter beyond 2^20
        reject(.range, edited(seed) { writeU64(&$0, 20, 0) })             // no cells
        reject(.range, edited(seed) { writeU64(&$0, 20, (1 << 60) + 1) })
        reject(.validity, edited(seed) { writeU64(&$0, 20, 5 << 16 + 1) })   // aspect above 2^16
        reject(.canonical, edited(seed) { $0[44] = 1 })                   // capZ on an open crystal
        reject(.canonical, edited(seed) { $0[45] = 1 })                   // reserved
        // Exactly at the aspect limit is fine.
        _ = try NodeRecord(.crystal(crystal { $0.cells = SIMD3(1 << 16, 1, 1) }))
        let capped = try NodeRecord(.crystal(Spec.diamondoid(1))).bytes
        reject(.range, edited(capped) { for a in 0..<3 { writeU64(&$0, 20 + 8 * a, 13) } })
        reject(.validity, edited(capped) { writeU64(&$0, 28, 2) })        // n0 ≠ n1
        reject(.validity, edited(capped) { $0[12] = 3; $0[15] = 0 })      // capped fcc
        reject(.range, edited(capped) { $0[44] = 0 })                      // no capZ
    }

    @Test func towers() throws {
        let t = try Spec.rung(3).bytes
        reject(.range, edited(t) { $0[44] = 1 })                          // factor 1
        reject(.range, edited(t) { $0[44] = 17 })
        reject(.canonical, edited(t) { $0[45] = 3 })                      // flags bit 1
        reject(.canonical, edited(t) { $0[46] = 1 })                      // reserved
        reject(.range, edited(t) { writeU64(&$0, 48, (1 << 40) + 1) })    // period component
        reject(.validity, edited(t) { writeU64(&$0, 72, 1_848_180); writeU64(&$0, 80, 0) })  // p1 = p0: dependent
        reject(.canonical, edited(t) { $0.replaceSubrange(120..<123, with: [2, 0, 3, 0]) })   // non-minimal levels
        reject(.validity, edited(t) { $0[124] = 17 })                        // fromZ = toZ
        reject(.range, edited(t) { $0[125] = 0; $0[126] = 0 })            // perCopy 0
        // A cell 2^13 times longer than it is wide breaks slenderness; 2^12 is the limit.
        let long: [SIMD3<Int64>] = [SIMD3(1 << 25, 0, 0), SIMD3(0, 1 << 12, 0), SIMD3(0, 0, 1 << 12)]
        expectCode(.validity) { _ = try NodeRecord(.tower(TowerNode(seed: Spec.seed.id, factor: 2, periodsQ16: long, levels: 1))) }
        let ok: [SIMD3<Int64>] = [SIMD3(1 << 24, 0, 0), SIMD3(0, 1 << 12, 0), SIMD3(0, 0, 1 << 12)]
        _ = try NodeRecord(.tower(TowerNode(seed: Spec.seed.id, factor: 2, periodsQ16: ok, levels: 1)))
    }

    @Test func edits() throws {
        let child9 = try Path(canonicalizing: [Spec.towerStep(1, [[(9, 1)], [], []])])
        let child3 = try Path(canonicalizing: [Spec.towerStep(1, [[(3, 1)], [], []])])
        let gp = try Spec.rung(Spec.googolplexLevels)
        let e = try NodeRecord(.edit(EditNode(base: gp.id, removed: [child9, child3])))
        // Writers sort the removals.
        #expect(e == (try NodeRecord(.edit(EditNode(base: gp.id, removed: [child3, child9])))))
        // Readers reject an unsorted pair: swap the two removals in place (both 16 bytes).
        var swapped = e.bytes
        let first = Array(swapped[48..<68]), second = Array(swapped[68..<88])
        swapped.replaceSubrange(48..<68, with: second)
        swapped.replaceSubrange(68..<88, with: first)
        reject(.canonical, swapped)
        expectCode(.canonical) { _ = try NodeRecord(.edit(EditNode(base: gp.id, removed: [child9, child9]))) }
        expectCode(.range) { _ = try NodeRecord(.edit(EditNode(base: gp.id, removed: []))) }
        expectCode(.validity) { _ = try NodeRecord(.edit(EditNode(base: gp.id, removed: [Path()]))) }
        expectCode(.validity) {
            _ = try NodeRecord(.edit(EditNode(base: gp.id, removed: [try child9.appending([Spec.towerStep(1, [[], [(0, 1)], []])]), child9])))
        }
        // A non-canonical removal path inside the record.
        reject(.canonical, edited(e.bytes) { $0[52 + 5] = 0 })     // D = 1 written as a non-minimal BigUInt
    }
}

/// §2.8: the rules that need other records.
@Suite("§2.8 contextual rules")
struct ContextualRuleTests {
    @Test func editRules() throws {
        let seed = Spec.seedRecord()
        let octant0 = try Path(canonicalizing: [.cells([0])])
        let edit = try NodeRecord(.edit(EditNode(base: seed.id, removed: [octant0])))
        // An edit of an edit.
        let twice = try NodeRecord(.edit(EditNode(base: edit.id, removed: [try Path(canonicalizing: [.cells([1])])])))
        expectCode(.validity) { _ = try Spec.store([seed, edit, twice]).root(twice.id) }
        // A removal that does not resolve inside the base.
        let nowhere = try NodeRecord(.edit(EditNode(base: seed.id, removed: [try Path(canonicalizing: [.child(0)])])))
        expectCode(.validity) { _ = try Spec.store([seed, nowhere]).root(nowhere.id) }
        let tooDeep = try NodeRecord(.edit(EditNode(base: seed.id, removed: [try Path(canonicalizing: [.cells([0, 0, 0, 0])])])))
        expectCode(.validity) { _ = try Spec.store([seed, tooDeep]).root(tooDeep.id) }
    }

    /// Decoded removals that the writer would refuse fail at resolution with `validity`.
    @Test func decodedRemovalRules() throws {
        let seed = Spec.seedRecord()
        // A record whose single removal is the empty path: hand-built bytes.
        var body = seed.id.bytes + [1, 0, 0, 0] + [2, 0, 0, 0] + [0, 0]
        var bytes = Array("LUPN".utf8) + [5, 1, 0, 0]
        bytes += [UInt8(body.count), 0, 0, 0]
        bytes += body
        let empty = try NodeRecord(bytes: bytes)
        expectCode(.validity) { _ = try Spec.store([seed, empty]).root(empty.id) }
        // Overlapping removals: an octant and its child.
        let a = try Path(canonicalizing: [.cells([0])]).bytes, b = try Path(canonicalizing: [.cells([0, 1])]).bytes
        body = seed.id.bytes + [2, 0, 0, 0]
        for p in [a, b] { body += [UInt8(p.count), 0, 0, 0] + p }
        bytes = Array("LUPN".utf8) + [5, 1, 0, 0] + [UInt8(body.count), 0, 0, 0] + body
        let overlapping = try NodeRecord(bytes: bytes)
        expectCode(.validity) { _ = try Spec.store([seed, overlapping]).root(overlapping.id) }
    }

    @Test func depthAboveSixtyFourIsALimit() throws {
        var records = [try RecordValidationTests.water()]
        for _ in 0..<64 { records.append(try NodeRecord(.group([GroupChild(id: records.last!.id)]))) }
        let r = Spec.store(records)
        expectCode(.limit) { _ = try r.depth(records.last!.id) }
        expectCode(.limit) { _ = try r.count(r.root(records.last!.id)) }
        #expect(try r.depth(records[63].id) == 64)
        #expect(try r.count(r.root(records[63].id)) == Magnitude(3))
        // Walking the 65-record chain fails on entering the 65th.
        let path = try Path(canonicalizing: [Step](repeating: .child(0), count: 64))
        expectCode(.limit) { _ = try r.resolve(records.last!.id, path) }
    }

    @Test func groupChildrenHaveUnitExponentZero() throws {
        let seed = Spec.seedRecord()
        let four = try NodeRecord(.tower(TowerNode(seed: seed.id, factor: 10, periodsQ16: Spec.saltPeriods, levels: 4)))
        let three = try Spec.rung(3)
        let bad = try NodeRecord(.group([GroupChild(id: four.id)]))
        let good = try NodeRecord(.group([GroupChild(id: three.id)]))
        let r = Spec.store([seed, four, three, bad, good])
        expectCode(.validity) { _ = try r.resolve(bad.id, try Path(canonicalizing: [.child(0)])) }
        expectCode(.validity) { _ = try r.count(r.root(bad.id)) }
        #expect(try r.count(r.root(good.id)).formatted == "1,000,000")
    }

    @Test func substitutionNeedsEnoughAtoms() throws {
        let seed = Spec.seedRecord()
        let tooMany = try NodeRecord(.tower(TowerNode(
            seed: seed.id, factor: 10, periodsQ16: Spec.saltPeriods, levels: 3, substitution: Substitution(fromZ: 17, toZ: 35, perCopy: 501)
        )))
        expectCode(.validity) { _ = try Spec.store([seed, tooMany]).root(tooMany.id) }
        let absent = try NodeRecord(.tower(TowerNode(
            seed: seed.id, factor: 10, periodsQ16: Spec.saltPeriods, levels: 3, substitution: Substitution(fromZ: 6, toZ: 35, perCopy: 1)
        )))
        expectCode(.validity) { _ = try Spec.store([seed, absent]).root(absent.id) }
        // A seed that is not materializable cannot carry a substitution.
        let copper = try NodeRecord(.crystal(Spec.copper(63, closed: false)))
        let unmaterializable = try NodeRecord(.tower(TowerNode(
            seed: copper.id, factor: 2, periodsQ16: Spec.saltPeriods, levels: 1, substitution: Substitution(fromZ: 29, toZ: 79, perCopy: 1)
        )))
        expectCode(.validity) { _ = try Spec.store([copper, unmaterializable]).root(unmaterializable.id) }
    }

    /// A seed of 2^256 atoms or more is `limit`: eight levels of 256-way groups over towers of copper.
    @Test func seedCountBelowTwoTo256() throws {
        let copper = try NodeRecord(.crystal(Spec.copper(1 << 60, closed: false)))
        let p: [SIMD3<Int64>] = [SIMD3(1 << 40, 0, 0), SIMD3(0, 1 << 40, 0), SIMD3(0, 0, 1 << 40)]
        let tower = try NodeRecord(.tower(TowerNode(seed: copper.id, factor: 16, periodsQ16: p, levels: 3)))
        var records = [copper, tower]
        for _ in 0..<8 {
            records.append(try NodeRecord(.group([GroupChild](repeating: GroupChild(id: records.last!.id), count: 256))))
        }
        let top = try NodeRecord(.tower(TowerNode(seed: records.last!.id, factor: 2, periodsQ16: p, levels: 1)))
        records.append(top)
        let r = Spec.store(records)
        #expect(try r.count(r.root(records[records.count - 2].id)).plain!.bitWidth > 256)
        expectCode(.limit) { _ = try r.root(top.id) }
        // One level fewer is below 2^256 and fine.
        let lower = try NodeRecord(.tower(TowerNode(seed: records[records.count - 3].id, factor: 2, periodsQ16: p, levels: 1)))
        let r2 = Spec.store(records + [lower])
        _ = try r2.root(lower.id)
    }

    @Test func missingRecords() throws {
        let gp = try Spec.rung(Spec.googolplexLevels)
        expectCode(.missing) { _ = try Spec.store([gp]).root(gp.id) }
        expectCode(.missing) { _ = try Spec.store([]).root(gp.id) }
    }
}

/// §4: canonical paths, and steps that do not apply.
@Suite("§4 paths and resolution")
struct PathTests {
    func reject(_ code: ScaleError.Code, _ bytes: [UInt8], sourceLocation: SourceLocation = #_sourceLocation) {
        expectCode(code, sourceLocation) { _ = try Path(bytes: bytes) }
    }

    @Test func canonicalForm() throws {
        // Adjacent cells, tower and atoms steps merge.
        let p = try Path(canonicalizing: [
            .cells([1]), .cells([2, 3]), .child(4), .child(5),
            Spec.towerStep(1, [[(0, 1)], [], []]), Spec.towerStep(2, [[], [(0, 1)], [(0, 1)]]),
        ])
        #expect(p.steps == [.cells([1, 2, 3]), .child(4), .child(5), Spec.towerStep(3, [[(0, 1)], [(0, 1)], [(0, 1)]])])
        // Runs merge; zero-length runs drop.
        let runs = try Path(canonicalizing: [Spec.towerStep(3, [[(2, 1), (2, 1), (7, 0)], [(1, 1)], []])])
        #expect(runs.steps == [Spec.towerStep(3, [[(2, 2)], [(1, 1)], []])])
        // A second selection indexes the first.
        let sel = try Path(canonicalizing: [.atoms([AtomRange(start: 10, length: 5)]), .atoms([AtomRange(start: 1, length: 2)])])
        #expect(sel.steps == [.atoms([AtomRange(start: 11, length: 2)])])
        expectCode(.path) { _ = try Path(canonicalizing: [.atoms([AtomRange(start: 0, length: 2)]), .atoms([AtomRange(start: 2, length: 1)])]) }
        // Overlapping and unsorted ranges normalize to a set.
        let set = try Path(canonicalizing: [.atoms([AtomRange(start: 5, length: 3), AtomRange(start: 0, length: 2), AtomRange(start: 6, length: 4)])])
        #expect(set.steps == [.atoms([AtomRange(start: 0, length: 2), AtomRange(start: 5, length: 5)])])
        // Round trip.
        #expect(try Path(bytes: p.bytes) == p)
        #expect(Path().bytes == [0, 0])
        expectCode(.limit) { _ = try Path(canonicalizing: [.cells([UInt8](repeating: 0, count: 33)), .cells([UInt8](repeating: 0, count: 32))]) }
        expectCode(.limit) { _ = try Path(canonicalizing: [Step](repeating: .child(0), count: 1025)) }
    }

    @Test func decodingRejects() throws {
        reject(.canonical, [2, 0, 2, 1, 0, 2, 1, 1])                         // two adjacent cells steps
        reject(.canonical, [1, 0, 2, 0])                                     // no octants
        reject(.limit, [1, 0, 2, 65] + [UInt8](repeating: 0, count: 65))     // 65 octants
        reject(.range, [1, 0, 2, 1, 8])                                      // octant 8
        reject(.canonical, [1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0])                // tower of D = 0
        reject(.canonical, [1, 0, 3, 1, 0, 1, 1, 0, 3, 0, 0, 0, 0, 0, 0])    // an empty run (length 0)
        reject(.canonical, [1, 0, 3, 1, 0, 2, 2, 0, 3, 1, 0, 1, 3, 1, 0, 1, 0, 0, 0, 0])  // adjacent runs share a digit
        reject(.canonical, [1, 0, 3, 2, 0, 1, 0, 1, 0, 3, 1, 1, 0, 0, 0, 0])  // non-minimal BigUInt
        reject(.canonical, [1, 0, 4, 2, 0, 0, 0, 2, 0, 2, 0, 1, 0])          // ranges without a gap
        reject(.canonical, [1, 0, 4, 1, 0, 0, 0, 0, 0])                      // an empty range
        reject(.canonical, [1, 0, 4, 1, 0, 0xFF, 0x0F, 2, 0])                    // past 4,096
        reject(.unsupported, [1, 0, 9])                                      // unknown tag
        reject(.canonical, [0, 0, 0])                                        // trailing bytes
        reject(.truncated, [1, 0, 1, 0])                                     // a short child index
        var many = [UInt8]([0x01, 0x04])
        for _ in 0..<1025 { many += [1, 0, 0] }
        reject(.limit, many)
        var runs = [UInt8]([1, 0, 3, 2, 0, 0x01, 0x10, 0x01, 0x10])           // D = 4097, 4,097 runs on axis 0
        for i in 0..<4097 { runs += [UInt8(i % 2), 1, 0, 1] }
        runs += [0, 0, 0, 0]
        reject(.limit, runs)
    }

    @Test func stepsThatDoNotApply() throws {
        let seed = Spec.seedRecord(), rung = try Spec.rung(6), gp = try Spec.rung(Spec.googolplexLevels)
        let r = Spec.store([seed, rung, gp])
        let level = try r.root(rung.id)
        expectCode(.path) { _ = try r.step(level, .child(0)) }
        expectCode(.path) { _ = try r.step(level, .cells([0])) }
        expectCode(.path) { _ = try r.step(level, .atoms([AtomRange(start: 0, length: 1)])) }
        expectCode(.path) { _ = try r.step(level, Spec.towerStep(7, [[(0, 3)], [(0, 2)], [(0, 2)]])) }   // D > k
        expectCode(.path) { _ = try r.step(level, Spec.towerStep(1, [[(10, 1)], [], []])) }            // digit ≥ f
        expectCode(.path) { _ = try r.step(level, Spec.towerStep(1, [[], [(0, 1)], []])) }             // wrong axis
        // Level 6 stacks along axis 2 (axis(6) = 2).
        _ = try r.step(level, Spec.towerStep(1, [[], [], [(4, 1)]]))
        let box = try r.root(seed.id)
        expectCode(.path) { _ = try r.step(box, .cells([0, 0, 0, 0])) }   // octants run out at one cell
        expectCode(.path) { _ = try r.step(box, .atoms([AtomRange(start: 999, length: 2)])) }
        _ = try r.step(box, .atoms([AtomRange(start: 999, length: 1)]))
    }

    /// A box of one cell along an axis has no octant there (§3.3.3).
    @Test func octreeShapes() throws {
        let slab = CrystalNode(structure: .sc, termination: .open, speciesA: 29, quarterQ16: 59_228, cells: SIMD3(4, 4, 1))
        let kids = CrystalMath.octreeChildren(CrystalMath.rootBox(slab))
        #expect(kids.map(\.octant) == [0, 1, 2, 3])
        #expect(kids[1].box == CellBox(lo: SIMD3(2, 0, 0), hi: SIMD3(4, 2, 1)))
        // An odd extent gives the lower half the extra cell.
        let odd = CrystalMath.octreeChildren(CellBox(lo: .zero, hi: SIMD3(5, 1, 1)))
        #expect(odd.map(\.box.hi.x) == [3, 5])
    }
}

/// §7: reference decoding and resolution failures.
@Suite("§7 scale references")
struct ScaleRefValidationTests {
    static func grainRef() throws -> ScaleRef {
        let gp = try Spec.rung(Spec.googolplexLevels)
        return try ScaleRef.keep(root: gp.id, path: try TowerVectorTests.grainPath, store: RecordStore([Spec.seedRecord(), gp]))
    }

    func reject(_ code: ScaleError.Code, _ bytes: [UInt8], sourceLocation: SourceLocation = #_sourceLocation) {
        expectCode(code, sourceLocation) { _ = try ScaleRef(bytes: bytes) }
    }

    @Test func decoding() throws {
        let b = try Self.grainRef().bytes
        var x = b; x[0] = 0x4D; reject(.magic, x)
        x = b; x[3] = 2; reject(.version, x)
        x = b; x[4] = 3; reject(.canonical, x)
        x = b; x[7] = 1; reject(.canonical, x)
        x = b; x.append(0); reject(.canonical, x)
        x = b; x.removeLast(); reject(.truncated, x)
        reject(.limit, [UInt8](repeating: 0, count: 163_841))
        expectCode(.magic) { _ = try ScaleRef(text: "lsr2:AAAA") }
        expectCode(.canonical) { _ = try ScaleRef(text: "lsr1:AA$A") }
        // Embedded records out of order: swap the seed (52 bytes) and the tower (168 bytes).
        let ref = try Self.grainRef()
        let sorted = ref.records.sorted { $0.id < $1.id }
        var w = Array(b[0..<40])
        for rec in sorted.reversed() { w += [UInt8(rec.bytes.count), 0, 0, 0] + rec.bytes }
        w += Array(b[(40 + 4 * 2 + sorted.map(\.bytes.count).reduce(0, +))...])
        reject(.canonical, w)
    }

    @Test func probeRules() throws {
        let ref = try Self.grainRef()
        var wrong = ref
        wrong.probe = Spec.seed.id
        expectCode(.mismatch) { _ = try wrong.resolve(extra: nil) }
        var missingProbe = ref
        missingProbe.probe = nil
        expectCode(.mismatch) { _ = try missingProbe.resolve(extra: nil) }
        // A slab is not materializable, so a probe on it is wrong too.
        let gp = try Spec.rung(Spec.googolplexLevels)
        let slab = ScaleRef(
            root: gp.id, records: [Spec.seedRecord(), gp], path: try Path(canonicalizing: [Spec.towerStep(1, [[(3, 1)], [], []])]),
            probe: Spec.seed.id
        )
        expectCode(.mismatch) { _ = try slab.resolve(extra: nil) }
        // Without its records, a reference resolves only with a store that has them.
        let bare = ScaleRef(root: ref.root, path: ref.path, probe: ref.probe)
        expectCode(.missing) { _ = try bare.resolve(extra: nil) }
        #expect(try bare.resolve(extra: RecordStore([Spec.seedRecord(), gp])).count == Magnitude(1000))
        // The refKey ignores what is embedded.
        #expect(bare.key == ref.key)
    }

    /// When a keep would pass 163,840 bytes, a piece of at most 4,096 atoms is kept as its own
    /// leaf, and anything bigger is refused with `limit` (§7.2).
    @Test func oversizedKeeps() throws {
        // A tower whose seed is a group of four full leaves: resolving anything in it reads
        // the whole seed for its count, about 213 KB of records.
        var leaves: [NodeRecord] = []
        for k in 0..<4 {
            let leaf = LeafNode(atomicNumbers: [UInt8](repeating: 6, count: 4096), positions: (0..<4096).map { SIMD3(Float($0), Float(k), 0) })
            leaves.append(try NodeRecord(.leaf(leaf)))
        }
        let group = try NodeRecord(.group(leaves.map { GroupChild(id: $0.id) }))
        let p: [SIMD3<Int64>] = [SIMD3(1 << 28, 0, 0), SIMD3(0, 1 << 28, 0), SIMD3(0, 0, 1 << 28)]
        let tower = try NodeRecord(.tower(TowerNode(seed: group.id, factor: 2, periodsQ16: p, levels: 1)))
        let store = RecordStore(leaves + [group, tower])
        let path = try Path(canonicalizing: [Spec.towerStep(1, [[(1, 1)], [], []]), .child(2)])
        let kept = try ScaleRef.keep(root: tower.id, path: path, store: store)
        #expect(kept.root == leaves[2].id)
        #expect(kept.path.isEmpty)
        #expect(kept.records.map(\.id) == [leaves[2].id])
        #expect(kept.probe == leaves[2].id)
        #expect(try kept.resolve(extra: nil).count == Magnitude(4096))
        // The whole tower has 32,768 atoms: too intricate to keep.
        expectCode(.limit) { _ = try ScaleRef.keep(root: tower.id, path: Path(), store: store) }
        // With its leaves and group left to a pack, the same keep fits.
        let pack = nid(String(repeating: "ab", count: 32))
        var packOf: [NodeID: NodeID] = [group.id: pack]
        for l in leaves { packOf[l.id] = pack }
        let byPack = try ScaleRef.keep(root: tower.id, path: Path(), store: store, packOf: packOf)
        #expect(byPack.records.map(\.id) == [tower.id])
        #expect(byPack.dependencies == [pack])
        #expect(try byPack.resolve(extra: store).count == Magnitude(32_768))
    }
}

extension UInt64 {
    var littleEndianBytes: [UInt8] { (0..<8).map { UInt8(truncatingIfNeeded: self >> UInt64(8 * $0)) } }
}
