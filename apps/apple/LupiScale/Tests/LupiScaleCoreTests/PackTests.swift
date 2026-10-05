import Foundation
import LupiScaleCore
import Testing

@Suite("§12.6 packs")
struct PackVectorTests {
    static func smallPack() throws -> [UInt8] {
        let water = try NodeRecord(.leaf(Repo.galleryLeaf("apps/web/public/gallery/curated/popular/water.xyz")))
        let gp = try Spec.rung(Spec.googolplexLevels)
        return try LupiPack.write(
            records: [water, Spec.seedRecord(), gp], roots: [("water", water.id), ("salt-googolplex", gp.id)], dependencies: []
        )
    }

    @Test func smallPack() throws {
        let file = try Self.smallPack()
        #expect(file.count == 65_536)
        #expect(NodeID.hashing(file).hex == "64235b518944425f713f018008f94171525328d7627e00865cff8a5d9442c2a8")
        #expect(readU32(file, 124) == 0xac22309b)
        #expect(Array(file[0..<128]) == hex("""
            4c55504b01000000800000000300000080000000000000000000010000000000
            a91476434956a8fc564e9328db078a20864d0053e674734e89da55b4675f6256
            0000000000000000000000000000000000000000000000000000000000000000
            000000009fae118f00000000000000000000000000000000000000009b3022ac
            """))
        #expect(Array(file[128..<224]) == hex("""
            4e49445801000000004000000000000098000000000000006ad6cb1a01000000
            4e52454301000000008000000000000018010000000000005efc1bb001000000
            524f4f540100000000c000000000000064000000000000004c47e7dd01000000
            """))
        // Section offsets, lengths and CRCs as the table in §12.6 lists them.
        for (i, (offset, length, crc)) in [(16_384, 152, 0x1acbd66a), (32_768, 280, 0xb01bfc5e), (49_152, 100, 0xdde7474c)].enumerated() {
            let e = 128 + 32 * i
            #expect(readU64(file, e + 8) == UInt64(offset))
            #expect(readU64(file, e + 16) == UInt64(length))
            #expect(readU32(file, e + 24) == UInt32(crc))
        }
        let pack = try LupiPack(bytes: file)
        #expect(pack.contentID.hex == "a91476434956a8fc564e9328db078a20864d0053e674734e89da55b4675f6256")
        #expect(pack.roots.map(\.0) == ["salt-googolplex", "water"])
        #expect(pack.nodeIDs.count == 3)
        // The pack is a store: the googolplex resolves from it.
        let r = Resolver(store: pack)
        #expect(try r.count(r.root(pack.root(named: "salt-googolplex")!)).formatted == "10^(10^100)")
    }

    /// The writer fixes the layout: record order, duplicates and root order never change the bytes.
    @Test func writerIsDeterministic() throws {
        let water = try NodeRecord(.leaf(Repo.galleryLeaf("apps/web/public/gallery/curated/popular/water.xyz")))
        let gp = try Spec.rung(Spec.googolplexLevels), seed = Spec.seedRecord()
        let shuffled = try LupiPack.write(
            records: [gp, seed, water, seed], roots: [("salt-googolplex", gp.id), ("water", water.id)], dependencies: []
        )
        #expect(shuffled == (try Self.smallPack()))
    }

    /// `lupi-scale-r1.lpk`. The spec names its content but not its root names; these are the
    /// reference implementation's (docs/ar/errata/swift.md, "bundled pack root names").
    @Test func bundledScalePack() throws {
        let seed = Spec.seedRecord()
        var records = [seed]
        var roots: [(String, NodeID)] = []
        let rungs: [(String, BigUInt)] = [
            ("thousand", 0), ("million", 3), ("billion", 6), ("e30", 27), ("googol", 97), ("googolplex", Spec.googolplexLevels),
        ]
        for (name, levels) in rungs {
            let rec = try Spec.rung(levels)
            records.append(rec)
            roots.append(("salt-" + name, rec.id))
        }
        let open = try NodeRecord(.crystal(Spec.copper(630, closed: false)))
        let closed = try NodeRecord(.crystal(Spec.copper(630, closed: true)))
        records += [open, closed]
        roots += [("copper-billion", open.id), ("copper-billion-closed", closed.id)]
        for m in 1...12 {
            let rec = try NodeRecord(.crystal(Spec.diamondoid(UInt64(m))))
            records.append(rec)
            roots.append(("diamondoid-\(m)", rec.id))
        }
        let file = try LupiPack.write(records: records, roots: roots, dependencies: [])
        let pack = try LupiPack(bytes: file)
        #expect(pack.nodeIDs.count == 21)
        #expect(pack.roots.count == 20)
        #expect(file.count == 65_536)
        #expect(pack.contentID.hex == "4ec7833bd79b74af882a100e2ef121fa928a01c02dcc5dc66e2282a127377e97")
        #expect(NodeID.hashing(file).hex == "d5f1d7ba69da089b970e7f1cdfe1f6e530c17d006c268ceee4bad0cd795a2794")
    }

    @Test func dependenciesAreSortedAndHashed() throws {
        let seed = Spec.seedRecord()
        let a = nid("ff" + String(repeating: "00", count: 31)), b = nid(String(repeating: "11", count: 32))
        let file = try LupiPack.write(records: [seed], roots: [], dependencies: [a, b, a])
        let pack = try LupiPack(bytes: file)
        #expect(pack.dependencies == [b, a])
        #expect(pack.roots.isEmpty)
        // DEPS changes the contentId; the records alone do not decide it.
        let bare = try LupiPack(bytes: LupiPack.write(records: [seed], roots: [], dependencies: []))
        #expect(bare.contentID != pack.contentID)
    }

    /// `massive_1m.glimbin` through `lupi.bake.partition@1` (§3.6, §12.6).
    @Test func massiveOneMillion() throws {
        let frame = try Glimbin.firstFrame(Repo.bytes("apps/web/public/gallery/trajectories/massive_1m.glimbin"))
        #expect(frame.types.count == 953_312)
        #expect(Set(frame.types) == [29])
        let baked = try Partition.bake(atomicNumbers: frame.types, positions: frame.positions)
        let leaves = baked.records.filter { $0.kindByte == 1 }
        let groups = baked.records.filter { $0.kindByte == 2 }
        #expect(leaves.count == 233)
        #expect(groups.count == 35)
        if case let .leaf(last)? = leaves.last?.node { #expect(last.count == 3_040) }
        #expect(baked.root.hex == "08588107c1be69ef9816bb4226c25e65b2dae3d2da2edf3fb9420fff76664cca")

        let file = try LupiPack.write(records: baked.records, roots: [("massive_1m", baked.root)], dependencies: [])
        #expect(file.count == 12_484_608)
        let pack = try LupiPack(bytes: file)
        #expect(pack.contentID.hex == "c760f77ae2225153e842d6f1dd164fe6470de5741a75f2bd9e0603f92b307f08")
        #expect(NodeID.hashing(file).hex == "b12f3e7a79ac58774e4b79b0066b08f91f79a669816c672d3748b978177e9b85")
        let r = Resolver(store: pack)
        #expect(try r.count(r.root(baked.root)).formatted == "953,312")
        #expect(try r.depth(baked.root) == 4)

        // Keeping its first leaf embeds the leaf and the three groups on its path.
        let path = try Path(canonicalizing: [.child(0), .child(0), .child(0)])
        let keep = try ScaleRef.keep(root: baked.root, path: path, store: pack)
        #expect(keep.records.map(\.bytes.count).sorted() == [368, 720, 720, 53_264])
        #expect(keep.bytes.count == 55_171)
        #expect(keep.text.count == 73_567)
        #expect(try keep.resolve(extra: nil).count.formatted == "4,096")
        // By dependency alone it would be 115 bytes.
        let byDependency = ScaleRef(root: baked.root, dependencies: [pack.contentID], path: path, probe: keep.probe)
        #expect(byDependency.bytes.count == 115)
        #expect(try byDependency.resolve(extra: pack).count.formatted == "4,096")
        expectCode(.missing) { _ = try byDependency.resolve(extra: nil) }
    }
}

@Suite("§7.2 typical reference sizes")
struct ReferenceSizeTests {
    @Test func caffeine() throws {
        let leaf = try NodeRecord(.leaf(Repo.galleryLeaf("apps/web/public/gallery/curated/popular/caffeine.xyz")))
        let ref = try ScaleRef.keep(root: leaf.id, path: Path(), store: RecordStore([leaf]))
        #expect(ref.bytes.count == 406)
        #expect(ref.probe == leaf.id)
    }

    @Test func saltThousand() throws {
        let rung = try Spec.rung(0)
        let ref = try ScaleRef.keep(root: rung.id, path: Path(), store: RecordStore([Spec.seedRecord(), rung]))
        #expect(ref.records.count == 2)
        #expect(ref.bytes.count == 260)
        #expect(ref.probe?.hex == "c5e72c9b3e1f4e05ade222824419e94114144d25015da1398e2f8ef437f2bfb8")
    }

    /// Generator records are always embedded, and a tower piece needs no probe.
    @Test func googolplexSlab() throws {
        let gp = try Spec.rung(Spec.googolplexLevels)
        let path = try Path(canonicalizing: [Spec.towerStep(1, [[(3, 1)], [], []])])
        let ref = try ScaleRef.keep(root: gp.id, path: path, store: RecordStore([Spec.seedRecord(), gp]))
        #expect(ref.probe == nil)
        #expect(try ScaleRef(bytes: ref.bytes).resolve(extra: nil).count.formatted == "10^(10^100 \u{2212} 1)")
    }
}
