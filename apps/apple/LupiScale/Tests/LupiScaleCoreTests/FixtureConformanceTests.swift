import Foundation
import LupiChem
import LupiScaleCore
import Testing

// The golden fixtures of scale-spec §0 and §12: every value the TypeScript
// reference wrote, asserted here byte for byte. A mismatch is a conformance
// failure on one side or the other, never something to tolerate.

@Suite("Fixture: primitives (§1)")
struct FixturePrimitiveTests {
    let p = Fixture.json["primitives"]

    @Test func crc32() {
        for row in p["crc32"].array {
            let bytes = row["ascii"].optionalString.map { Array($0.utf8) } ?? row["hex"].bytes
            #expect(String(format: "%08x", CRC32.checksum(bytes)) == row["crc32"].string)
        }
    }

    @Test func sha256() {
        for row in p["sha256"].array {
            #expect(NodeID.hashing(Array(row["ascii"].string.utf8)).hex == row["sha256"].string)
        }
    }

    @Test func splitMix64() {
        for row in p["splitMix64"].array {
            var g = SplitMix64(seed: UInt64(row["seed"].string.dropFirst(2), radix: 16)!)
            #expect(row["outputs"].array.map(\.string) == (0..<5).map { _ in hex64(g.next()) })
        }
        for row in p["mix64"].array {
            #expect(hex64(SplitMix64.mix(UInt64(row["input"].string.dropFirst(2), radix: 16)!)) == row["output"].string)
        }
    }

    /// A BigUInt's encoding (§1.2), read back from the `levels` field of a tower record at offset 120.
    static func encoding(_ v: BigUInt) throws -> [UInt8] {
        let rec = try NodeRecord(.tower(TowerNode(seed: Spec.seed.id, factor: 10, periodsQ16: Spec.saltPeriods, levels: v)))
        return Array(rec.bytes[120...])
    }

    @Test func bigUInt() throws {
        var concatenated: [UInt8] = []
        for row in p["bigUInt"].array {
            let v = row["value"].big
            #expect(v.decimal == row["value"].string)
            let bytes = try Self.encoding(v)
            #expect(bytes.count == row["bytes"].int)
            #expect(NodeID.hashing(bytes).hex == row["sha256"].string)
            if let h = row["hex"].optionalString { #expect(hexString(bytes) == h) }
            if ["0", "1", "255", "256"].contains(row["value"].string) || v == Spec.googol { concatenated += bytes }
        }
        #expect(hexString(concatenated) == p["bigUIntConcatenatedHex"].string)
    }

    @Test func q16ToF32() {
        for row in p["q16ToF32"].array {
            let f = CrystalMath.f32(Int64(row["q16"].double))
            #expect(String(format: "%08x", f.bitPattern.byteSwapped) == row["f32Hex"].string)
        }
    }

    /// `lupi.mass.v1` (§5.3), element by element.
    @Test func microDaltons() {
        let table = Fixture.json["massMicroDaltons"].array
        #expect(table.count == 118)
        for (i, v) in table.enumerated() {
            #expect(ScaleElements.microDaltons(UInt8(i + 1)) == UInt64(v.double), "Z = \(i + 1)")
        }
    }

    /// Gallery leaves through LupiKit's port of the web parser (§2.2).
    @Test func galleryLeaves() throws {
        for row in Fixture.json["gallery"].array {
            let frame = try XYZParser.parse(bytes: Array(row["xyz"].string.utf8)).first
            let leaf = LeafNode(atomicNumbers: frame.atomicNumbers.map { UInt8($0) }, positions: frame.positions)
            let rec = try NodeRecord(.leaf(leaf))
            #expect(hexString(rec.bytes) == row["record"].string, "\(row["file"].string)")
            #expect(rec.id.hex == row["id"].string)
        }
    }
}

@Suite("Fixture: records (§2, §3)")
struct FixtureRecordTests {
    static let names = Fixture.names("records")

    @Test(arguments: names) func record(_ name: String) throws {
        let row = Fixture.named(Fixture.json["records"], name)
        let bytes = row["hex"].bytes
        #expect(bytes.count == row["bytes"].int)
        #expect(String(format: "%08x", CRC32.checksum(bytes)) == row["crc32"].string)
        let node = Fixture.node(row["node"])
        // Encode from the fixture's fields, decode the fixture's bytes: both ways agree.
        let encoded = try NodeRecord(node)
        #expect(hexString(encoded.bytes) == row["hex"].string)
        #expect(encoded.id.hex == row["id"].string)
        let decoded = try NodeRecord(bytes: bytes)
        #expect(decoded.node == node)
        #expect(Int(decoded.kindByte) == row["kind"].int)
        #expect(decoded.id.hex == row["id"].string)
    }

    @Test func everyRecordIsListedOnce() {
        #expect(Fixture.records.count == Fixture.json["records"].array.count)
    }
}

@Suite("Fixture: resolutions (§3, §4, §5.3)")
struct FixtureResolutionTests {
    static let names = Fixture.names("resolutions")

    @Test(arguments: names) func resolution(_ name: String) throws {
        try Self.check(Fixture.named(Fixture.json["resolutions"], name), store: Fixture.store)
    }

    /// One view case: the path's bytes both ways, then either the §4.7 code, met while resolving
    /// or describing the view, or every derived value.
    static func check(_ row: JSON, store: any NodeStore) throws {
        let name = row["name"].string
        let path = try Path(canonicalizing: Fixture.steps(row["path"]))
        #expect(hexString(path.bytes) == row["path"]["hex"].string, "\(name): path bytes")
        #expect(try Path(bytes: row["path"]["hex"].bytes) == path, "\(name): path decodes")

        let r = Resolver(store: store)
        do {
            let v = try r.resolve(row["root"].id, path)
            if row["error"].isNull {
                try describe(r, v, row["view"], name)
            } else {
                _ = try r.count(v)
                _ = try r.composition(v)
                if r.isMaterializable(v) { _ = try r.probe(v) }
                Issue.record("\(name): resolved, but the fixture fails it with \(row["error"].string)")
            }
        } catch let e as ScaleError {
            #expect(e.code.rawValue == row["error"].optionalString, "\(name): \(e)")
        }
    }

    static func describe(_ r: Resolver, _ v: View, _ want: JSON, _ name: String) throws {
        #expect("\(v.kind)" == want["type"].string, "\(name): view type")
        expectMagnitude(try r.count(v), want["count"], "\(name): count")
        if v.kind == .level {
            #expect(v.level.decimal == want["level"].string, "\(name): level")
            #expect((0..<3).map { TowerMath.stacked($0, v.level).decimal } == want["seedCopiesPerAxis"].array.map(\.string))
        }
        if v.kind == .copy, let t = v.tower, let s = t.substitution {
            let key = try #require(r.copyKey(v))
            #expect(hex64(key) == want["copyKey"].string, "\(name): copy key")
            var g = SplitMix64(seed: key)
            #expect(hex64(g.next()) == want["firstSplitMix64"].string)
            let seed = try r.materialize(r.root(t.seed))
            #expect(try TowerMath.substitute(seed.atomicNumbers, s, key: key).changed == want["substituted"].array.map(\.int))
        }
        let c = try r.composition(v)
        let wc = want["composition"]
        #expect(c.unit == Fixture.counts(wc["unit"]), "\(name): unit")
        expectMagnitude(c.copies, wc["copies"], "\(name): copies")
        #expect(c.removed == Fixture.counts(wc["removed"]), "\(name): removed")
        #expect(c.formula == wc["formula"].string, "\(name): formula")
        #expect(c.formulaText == wc["formulaText"].string, "\(name): formula text")
        expectMagnitude(try c.massMicroDa(), wc["massMicroDa"], "\(name): mass")

        #expect(r.isMaterializable(v) == want["materializable"].bool, "\(name): materializable")
        guard want["materializable"].bool else { return }
        let leaf = try r.materialize(v)
        #expect(try r.probe(v).hex == want["probe"].string, "\(name): probe")
        #expect(leaf.count == want["materializedAtoms"].int, "\(name): atoms")
        if let h = want["materializedRecordHex"].optionalString {
            #expect(hexString(try NodeRecord(.leaf(leaf)).bytes) == h, "\(name): materialized leaf")
        }
    }
}

@Suite("Fixture: Magnitude (§5)")
struct FixtureMagnitudeTests {
    static let names = Fixture.names("formatting")

    @Test(arguments: names) func formatting(_ name: String) throws {
        let row = Fixture.named(Fixture.json["formatting"], name)
        expectMagnitude(try Fixture.magnitude(row["value"]), row, name)
    }

    /// §5.5 [V]: ln M to 10⁻⁹ absolute while |ln M| ≤ 10⁶, else 2⁻⁴⁰ relative; ln ln M to 10⁻¹².
    @Test func approximations() throws {
        for row in Fixture.json["approximations"].array {
            let m = try Fixture.magnitude(row["value"])
            let name = row["name"].string
            if row["lnM"].isNull {
                #expect(m.lnM == .infinity, "\(name)")
            } else {
                let want = row["lnM"].double
                let tolerance = abs(want) <= 1e6 ? 1e-9 : abs(want) * 0x1p-40
                #expect(abs(m.lnM - want) <= tolerance, "\(name): ln M \(m.lnM) against \(want)")
            }
            #expect(abs(m.lnlnM - row["lnlnM"].double) <= 1e-12, "\(name): ln ln M \(m.lnlnM) against \(row["lnlnM"].double)")
        }
    }

    /// §5.5 [V]: kilograms from micro-daltons, in the base where the exponent is exact.
    @Test func scientific() throws {
        for row in Fixture.json["scientific"].array {
            let r = Resolver(store: Fixture.store)
            let mass = try r.composition(r.root(row["root"].id)).massMicroDa()
            expectMagnitude(mass, row["mass"], row["name"].string)
            #expect(row["kgPerMicroDalton"].double == Magnitude.kgPerMicroDalton)
            #expect(mass.scientific(times: Magnitude.kgPerMicroDalton) == row["text"].string, "\(row["name"].string)")
        }
    }
}

@Suite("Fixture: packs (§6)")
struct FixturePackTests {
    @Test(arguments: ["small", "bundled", "withDependencies"]) func pack(_ which: String) throws {
        let row = Fixture.json["packs"][which]
        let records = row["records"].array.map { Fixture.records[$0.id]! }
        let roots = row["roots"].array.map { ($0["name"].string, $0["id"].id) }
        let deps = row["deps"].array.map(\.id)
        // The writer fixes the layout, so any record and root order gives the same bytes.
        let file = try LupiPack.write(records: records.reversed(), roots: roots.reversed(), dependencies: deps.reversed())
        #expect(file.count == row["fileLength"].int)
        #expect(hexString(file) == row["hex"].string, "\(which): bytes")
        #expect(NodeID.hashing(file).hex == row["fileSha256"].string)
        #expect(String(format: "%08x", readU32(file, 124)) == row["headerCrc"].string)
        for (i, s) in row["sections"].array.enumerated() {
            let e = 128 + 32 * i
            #expect(String(decoding: file[e..<(e + 4)], as: UTF8.self) == s["type"].string)
            #expect(Int(readU64(file, e + 8)) == s["offset"].int)
            #expect(Int(readU64(file, e + 16)) == s["length"].int)
            #expect(String(format: "%08x", readU32(file, e + 24)) == s["crc32"].string)
        }
        let pack = try LupiPack(bytes: row["hex"].bytes)
        #expect(pack.contentID.hex == row["contentId"].string)
        #expect(pack.roots.map(\.0) == roots.map(\.0))
        #expect(pack.roots.map(\.1) == roots.map(\.1))
        #expect(pack.dependencies == deps)
        #expect(pack.nodeIDs == records.map(\.id))
    }
}

@Suite("Fixture: references (§7)")
struct FixtureReferenceTests {
    static let names = Fixture.names("references")

    @Test(arguments: names) func reference(_ name: String) throws {
        let row = Fixture.named(Fixture.json["references"], name)
        let path = try Path(canonicalizing: Fixture.steps(row["path"]))
        #expect(hexString(path.bytes) == row["path"]["hex"].string)
        let ref = try ScaleRef.keep(root: row["root"].id, path: path, store: Fixture.store)
        #expect(ref.bytes.count == row["bytes"].int, "\(name): size")
        #expect(hexString(ref.bytes) == row["hex"].string, "\(name): bytes")
        #expect(ref.text == row["text"].string, "\(name): text")
        #expect(ref.key.hex == row["refKey"].string, "\(name): refKey")
        #expect(ref.records.map(\.id).sorted().map(\.hex) == row["embedded"].array.map(\.string), "\(name): embedded")
        #expect(ref.probe?.hex == row["probe"].optionalString, "\(name): probe")
        // Read back from text and bytes alike, it resolves with nothing but itself.
        let back = try ScaleRef(text: row["text"].string)
        #expect(back.bytes == row["hex"].bytes)
        #expect(try ScaleRef(bytes: row["hex"].bytes).resolve(extra: nil).count.formatted == row["count"].string)
    }
}

@Suite("Fixture: the partition bake (§3.6)")
struct FixturePartitionTests {
    let p = Fixture.json["partition"]

    @Test func single() throws {
        let water = try NodeRecord(bytes: Fixture.json["gallery"].array[0]["record"].bytes)
        guard case let .leaf(leaf)? = water.node else { Issue.record("water is a leaf"); return }
        let baked = try Partition.bake(atomicNumbers: [8, 1, 1], positions: leaf.positions)
        #expect(baked.root.hex == p["single"]["root"].string)
        #expect(baked.records.count == p["single"]["records"].int)
    }

    /// Regenerated from its stated rule, so it needs no data file.
    @Test func procedural() throws {
        let row = p["procedural"]
        var g = SplitMix64(seed: UInt64(row["seed"].string.dropFirst(2), radix: 16)!)
        let n = row["atoms"].int
        var z: [UInt8] = [], positions: [SIMD3<Float>] = [], raw: [UInt8] = []
        for _ in 0..<n {
            var xyz: [Float] = []
            for _ in 0..<3 {
                let f = Float(Double(Int64(g.next() >> 40) - 8_388_608) / 1024)
                xyz.append(f)
                withUnsafeBytes(of: f.bitPattern.littleEndian) { raw += $0 }
            }
            positions.append(SIMD3(xyz[0], xyz[1], xyz[2]))
            z.append(UInt8(1 + g.next() % 118))
        }
        #expect(NodeID.hashing(raw).hex == row["positionsSha256"].string)
        let baked = try Partition.bake(atomicNumbers: z, positions: positions)
        #expect(baked.records.filter { $0.kindByte == 1 }.count == row["leaves"].int)
        #expect(baked.records.filter { $0.kindByte == 2 }.count == row["groups"].int)
        #expect(baked.root.hex == row["root"].string)
        #expect(baked.records.map(\.id.hex) == row["recordIds"].array.map(\.string))
        let r = Resolver(store: RecordStore(baked.records))
        #expect(try r.depth(baked.root) == row["depth"].int)
        let v = try r.root(baked.root)
        #expect(try r.count(v).formatted == row["count"].string)
        #expect(try r.composition(v).unit == Fixture.counts(row["composition"]))
    }

    @Test func massiveOneMillion() throws {
        let row = p["massive1m"]
        let frame = try Glimbin.firstFrame(Repo.bytes(row["source"].string))
        #expect(frame.types.count == row["atoms"].int)
        let baked = try Partition.bake(atomicNumbers: frame.types, positions: frame.positions)
        let leaves = baked.records.filter { $0.kindByte == 1 }
        #expect(leaves.map(\.id.hex) == row["leafIds"].array.map(\.string))
        #expect(baked.records.filter { $0.kindByte == 2 }.map(\.id.hex) == row["groupIds"].array.map(\.string))
        if case let .leaf(last)? = leaves.last?.node { #expect(last.count == row["lastLeafAtoms"].int) }
        #expect(baked.root.hex == row["root"].string)

        let file = try LupiPack.write(records: baked.records, roots: [("massive_1m", baked.root)], dependencies: [])
        #expect(file.count == row["pack"]["fileLength"].int)
        #expect(NodeID.hashing(file).hex == row["pack"]["fileSha256"].string)
        let pack = try LupiPack(bytes: file)
        #expect(pack.contentID.hex == row["pack"]["contentId"].string)
        let r = Resolver(store: pack)
        #expect(try r.depth(baked.root) == row["depth"].int)
        #expect(try r.count(r.root(baked.root)).formatted == row["count"].string)

        let k = row["firstLeafKeep"]
        let path = try Path(canonicalizing: Fixture.steps(k["path"]))
        #expect(hexString(path.bytes) == k["path"]["hex"].string)
        let keep = try ScaleRef.keep(root: baked.root, path: path, store: pack)
        #expect(keep.bytes.count == k["bytes"].int)
        #expect(keep.text.count == k["textLength"].int)
        #expect(keep.text == k["text"].string)
        #expect(keep.records.map(\.bytes.count).sorted() == k["embeddedRecordBytes"].array.map(\.int))
        #expect(keep.key.hex == k["refKey"].string)
        #expect(keep.probe?.hex == k["probe"].optionalString)
        #expect(try keep.resolve(extra: nil).count.formatted == k["count"].string)
        let byDependency = ScaleRef(root: baked.root, dependencies: [pack.contentID], path: path, probe: keep.probe)
        #expect(byDependency.bytes.count == k["byDependencyBytes"].int)
        #expect(hexString(byDependency.bytes) == k["byDependencyHex"].string)
    }
}

@Suite("Fixture: rejections (§2, §4, §6.6, §7.3)")
struct FixtureRejectionTests {
    let j = Fixture.json["rejections"]

    @Test func records() {
        for row in j["records"].array {
            let code = errorCode { _ = try NodeRecord(bytes: row["hex"].bytes) }
            #expect(code == row["error"].optionalString, "\(row["name"].string): got \(code ?? "success")")
        }
    }

    @Test func paths() {
        for row in j["paths"].array {
            let code = errorCode { _ = try Path(bytes: row["hex"].bytes) }
            #expect(code == row["error"].optionalString, "\(row["name"].string): got \(code ?? "success")")
        }
    }

    @Test func packs() {
        let base = Fixture.json["packs"]["small"]["hex"].bytes
        for row in j["pack"]["cases"].array {
            // A case may grow the file; the patches read the base as zero past its end.
            var b = base + [UInt8](repeating: 0, count: row["fileLength"].int - base.count)
            for patch in row["patches"].array {
                let at = patch.array[0].int
                for (i, byte) in patch.array[1].bytes.enumerated() { b[at + i] = byte }
            }
            let code = errorCode {
                let pack = try LupiPack(bytes: b)
                for id in pack.nodeIDs { _ = try pack.record(id) }
            }
            #expect(code == row["error"].optionalString, "\(row["name"].string): got \(code ?? "success")")
        }
    }

    @Test func references() {
        for row in j["references"].array {
            let code = errorCode { _ = try ScaleRef(bytes: row["hex"].bytes).resolve(extra: nil) }
            #expect(code == row["error"].optionalString, "\(row["name"].string): got \(code ?? "success")")
        }
    }

    @Test func resolutions() throws {
        for row in j["resolutions"].array {
            let store = row["records"].isNull
                ? Fixture.store
                : RecordStore(try row["records"].array.map { try NodeRecord(bytes: $0.bytes) })
            try FixtureResolutionTests.check(row, store: store)
        }
    }
}
