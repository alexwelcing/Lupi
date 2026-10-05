import LupiScaleCore
import Testing

@Suite("§12.4 towers: the salt ladder")
struct TowerVectorTests {
    static let ladder: [(BigUInt, Int, String, String, [String])] = [
        (0, 126, "1349a66011dc8c606efe01fb2b56362637560b205c37a0e87040041bc8933eb3", "1,000", ["0", "0", "0"]),
        (3, 127, "cd481a1353e063838be8fc0c55f420b977465a8f1db3e959460aaa34ac4b8df8", "1,000,000", ["1", "1", "1"]),
        (6, 127, "8244914ffbe1dc2ef6fcc9d3d4dd33c7f904d8c9b06c6f760fa8224dd6244e27", "1,000,000,000", ["2", "2", "2"]),
        (27, 127, "acf0aa4a9271023dff67a256fcfcd5993f767ccf3ded32b0bbd3995765fffc3f", "10^30", ["9", "9", "9"]),
        (97, 127, "b6ea59ba7442ec18a606dffa157dba6bda89dbad3b27d427b24cef47012c167e", "10^100", ["33", "32", "32"]),
    ]

    @Test(arguments: ladder)
    func rung(levels: BigUInt, bytes: Int, id: String, count: String, perAxis: [String]) throws {
        let rec = try Spec.rung(levels)
        #expect(rec.bytes.count == bytes)
        #expect(rec.id.hex == id)
        let r = Spec.store([Spec.seedRecord(), rec])
        #expect(try r.count(r.root(rec.id)).formatted == count)
        #expect(Spec.copiesPerAxis(levels).map(\.decimal) == perAxis)
    }

    @Test func googolplex() throws {
        let rec = try Spec.rung(Spec.googolplexLevels)
        #expect(rec.bytes.count == 168)
        #expect(rec.id.hex == "a10e2103622970045012eb530843be4ef0a080b1c21e5265e294cb440c3e5759")
        #expect(rec.bytes == hex("""
            4c55504e040100009c0000002ef8502fcd22e4b098c57e85c0bd1b6793ff8be1
            3f9b330d0017f1c9561e3f3e0a01000074331c00000000000000000000000000
            0000000000000000000000000000000074331c00000000000000000000000000
            0000000000000000000000000000000074331c00000000002a00fdffffffffff
            ffffffffffff0f8f2ea80843b2aa7c1a218e40ce8af30bcec484270beb7cc394
            25ad491211230100
            """))
        let r = Spec.store([Spec.seedRecord(), rec])
        #expect(try r.count(r.root(rec.id)).formatted == "10^(10^100)")
        // Seed copies per axis: (10^100 − 1)/3, (10^100 − 4)/3, (10^100 − 4)/3.
        let perAxis = Spec.copiesPerAxis(Spec.googolplexLevels)
        #expect(perAxis[0] == (try Spec.googol - 1).dividedSmall(3).quotient)
        #expect(perAxis[1] == (try Spec.googol - 4).dividedSmall(3).quotient)
        #expect(perAxis[2] == perAxis[1])
        // The root is a 10 : 1 : 1 bar: axis(L) = 0 (§3.4.7).
        #expect(TowerMath.axis(Spec.googolplexLevels) == 0)
    }

    @Test func thousandRungIsItsOwnSeedCopy() throws {
        let rec = try Spec.rung(0)
        let r = Spec.store([Spec.seedRecord(), rec])
        let v = try r.root(rec.id)
        #expect(v.kind == .copy)
        #expect(r.copyKey(v) == 0x5a39_d764_2495_b059)
        let seedZ = try r.materialize(r.root(Spec.seed.id)).atomicNumbers
        let z = try r.materialize(v).atomicNumbers
        #expect(changed(seedZ, z) == [836])
        #expect(z[836] == 35)
        #expect(try r.probe(v).hex == "c5e72c9b3e1f4e05ade222824419e94114144d25015da1398e2f8ef437f2bfb8")
    }

    func changed(_ a: [UInt8], _ b: [UInt8]) -> [Int] { a.indices.filter { a[$0] != b[$0] } }

    static var googolplexResolver: Resolver {
        get throws { Spec.store([Spec.seedRecord(), try Spec.rung(Spec.googolplexLevels)]) }
    }

    @Test func firstCopy() throws {
        let gp = try Spec.rung(Spec.googolplexLevels).id
        let c = Spec.copiesPerAxis(Spec.googolplexLevels)
        let path = try Path(canonicalizing: [Spec.towerStep(Spec.googolplexLevels, [[(0, c[0])], [(0, c[1])], [(0, c[2])]])])
        #expect(path.bytes == hex("""
            0100032a00fdffffffffffffffffffffff0f8f2ea80843b2aa7c1a218e40ce8a
            f30bcec484270beb7cc39425ad49120100002a00555555555555555555555555
            05850f385816e638d4080bda6aefd8fb039a412c0d594ed4eb860c8f18060100
            002a0054555555555555555555555505850f385816e638d4080bda6aefd8fb03
            9a412c0d594ed4eb860c8f18060100002a005455555555555555555555550585
            0f385816e638d4080bda6aefd8fb039a412c0d594ed4eb860c8f1806
            """))
        let r = try Self.googolplexResolver
        let v = try r.resolve(gp, path)
        #expect(r.copyKey(v) == 0xd282_1aef_089f_3b51)
        let seedZ = try r.materialize(r.root(Spec.seed.id)).atomicNumbers
        #expect(changed(seedZ, try r.materialize(v).atomicNumbers) == [764])
        #expect(try r.probe(v).hex == "a4b81f1ada35de728dc1bc0e662d22e58d43c281bbc27e1662279dd639c30663")
    }

    static var grainPath: Path {
        get throws {
            let c = Spec.copiesPerAxis(Spec.googolplexLevels)
            return try Path(canonicalizing: [Spec.towerStep(Spec.googolplexLevels, [
                [(5, 1), (0, try c[0] - 1)], [(9, c[1])], [(5, 1), (0, try c[2] - 1)],
            ])])
        }
    }

    @Test func grain() throws {
        let gp = try Spec.rung(Spec.googolplexLevels)
        let path = try Self.grainPath
        #expect(path.bytes == hex("""
            0100032a00fdffffffffffffffffffffff0f8f2ea80843b2aa7c1a218e40ce8a
            f30bcec484270beb7cc39425ad4912020005010001002a005455555555555555
            5555555505850f385816e638d4080bda6aefd8fb039a412c0d594ed4eb860c8f
            18060100092a0054555555555555555555555505850f385816e638d4080bda6a
            efd8fb039a412c0d594ed4eb860c8f1806020005010001002a00535555555555
            55555555555505850f385816e638d4080bda6aefd8fb039a412c0d594ed4eb86
            0c8f1806
            """))
        let r = try Self.googolplexResolver
        let v = try r.resolve(gp.id, path)
        let key = try #require(r.copyKey(v))
        #expect(key == 0x9df8_af3f_7edb_268e)
        var g = SplitMix64(seed: key)
        #expect(g.next() == 0xe7ad_6256_9786_4313)
        let seedZ = try r.materialize(r.root(Spec.seed.id)).atomicNumbers
        #expect(changed(seedZ, try r.materialize(v).atomicNumbers) == [639])
        #expect(try r.probe(v).hex == "449611ace7889516d11722ee8da078a5e4b697c89e4ef7854dd9118497df80ad")
        #expect(try r.count(v).formatted == "1,000")

        let ref = ScaleRef(root: gp.id, records: [Spec.seedRecord(), gp], path: path, probe: try r.probe(v))
        #expect(ref.bytes.count == 496)
        #expect(ref.key.hex == "ebfdf60d1a694e092141c1c6d2838e2af7e7194f711e66855110a0186ce7ad1d")
        #expect(ref.text == ("lsr1:TFNSAQECAAChDiEDYilwBFAS61MIQ75O8KCAscIeUmXilMtEDD5XWTQAAABMVVBOAwEAACg"
            + "AAAAFAAsR-WgBAAUAAAAAAAAABQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAqAAAAExVUE4EAQAAnAA"
            + "AAC74UC_NIuSwmMV-hcC9G2eT_4vhP5szDQAX8clWHj8-CgEAAHQzHAAAAAAAAAAAAAAAAAAAAAA"
            + "AAAAAAAAAAAAAAAAAdDMcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB0MxwAAAAAACoA_f_"
            + "_____________D48uqAhDsqp8GiGOQM6K8wvOxIQnC-t8w5QlrUkSESMBAAEAAyoA_f_________"
            + "_____D48uqAhDsqp8GiGOQM6K8wvOxIQnC-t8w5QlrUkSAgAFAQABACoAVFVVVVVVVVVVVVVVBYU"
            + "POFgW5jjUCAvaau_Y-wOaQSwNWU7U64YMjxgGAQAJKgBUVVVVVVVVVVVVVVUFhQ84WBbmONQIC9p"
            + "q79j7A5pBLA1ZTtTrhgyPGAYCAAUBAAEAKgBTVVVVVVVVVVVVVVUFhQ84WBbmONQIC9pq79j7A5p"
            + "BLA1ZTtTrhgyPGAZElhGs54iVFtEXIu6NoHil5LaXyJ5O94VN2RGEl9-ArQ"))
        // It resolves from itself alone, and its text form decodes to the same bytes.
        let back = try ScaleRef(text: ref.text)
        #expect(back.bytes == ref.bytes)
        #expect(try back.resolve(extra: nil).count.formatted == "1,000")
        // The writer embeds exactly the two records a resolution reads.
        let kept = try ScaleRef.keep(root: gp.id, path: path, store: RecordStore([Spec.seedRecord(), gp]))
        #expect(kept.bytes == ref.bytes)
    }

    @Test func grainFragment() throws {
        let gp = try Spec.rung(Spec.googolplexLevels).id
        let path = try Self.grainPath.appending([.atoms([AtomRange(start: 0, length: 8)])])
        let r = try Self.googolplexResolver
        let v = try r.resolve(gp, path)
        #expect(try r.materialize(v).atomicNumbers == [11, 11, 11, 11, 17, 17, 17, 17])
        #expect(try r.probe(v).hex == "5d6b6718370227172746f478c065f25bc74c708d9c4a61257a5c42ee18f3d3ce")
    }

    @Test func slabsAndEdits() throws {
        let seed = Spec.seedRecord(), gp = try Spec.rung(Spec.googolplexLevels)
        let child3 = try Path(canonicalizing: [Spec.towerStep(1, [[(3, 1)], [], []])])
        #expect(hexString(child3.bytes) == "01000301000101000301000100000000")
        let r = Spec.store([seed, gp])
        let slab = try r.resolve(gp.id, child3)
        #expect(try r.count(slab).formatted == "10^(10^100 \u{2212} 1)")
        #expect(!r.isMaterializable(slab))
        // Child 3 is a cube: level L − 1 ≡ 0 (mod 3).
        #expect(TowerMath.axis(slab.level) == 2)

        let child9 = try Path(canonicalizing: [Spec.towerStep(1, [[(9, 1)], [], []])])
        let edit = try NodeRecord(.edit(EditNode(base: gp.id, removed: [child9])))
        #expect(edit.bytes == hex("4c55504e0501000038000000a10e2103622970045012eb530843be4ef0a080b1c21e5265e294cb440c3e5759010000001000000001000301000101000901000100000000"))
        #expect(edit.id.hex == "825d98342ecdde760707b430acd8229a6eb7480fcaf5f0b2b4311bde4864e907")
        let re = Spec.store([seed, gp, edit])
        #expect(try re.count(re.root(edit.id)).formatted == "9 \u{00D7} 10^(10^100 \u{2212} 1)")

        let both = try NodeRecord(.edit(EditNode(base: gp.id, removed: [child9, try Self.grainPath])))
        #expect(both.id.hex == "29beccfd91e84c70e305e6f1743c57d7b7c5bac0b21354ddbd7b3d44d265a254")
        let rb = Spec.store([seed, gp, both])
        #expect(try rb.count(rb.root(both.id)).formatted == "9 \u{00D7} 10^(10^100 \u{2212} 1) \u{2212} 1,000")
        expectCode(.path) { _ = try rb.resolve(both.id, try Self.grainPath) }
        expectCode(.path) { _ = try rb.resolve(both.id, child9) }
        // A sibling of the grain still resolves.
        #expect(try rb.count(rb.resolve(both.id, child3)).formatted == "10^(10^100 \u{2212} 1)")
    }

    @Test func removalInsideASeedCopy() throws {
        let seed = Spec.seedRecord()
        let plain = try NodeRecord(.tower(TowerNode(seed: seed.id, factor: 10, periodsQ16: Spec.saltPeriods, levels: 3)))
        #expect(plain.bytes == hex("4c55504e040100006f0000002ef8502fcd22e4b098c57e85c0bd1b6793ff8be13f9b330d0017f1c9561e3f3e0a00000074331c000000000000000000000000000000000000000000000000000000000074331c000000000000000000000000000000000000000000000000000000000074331c0000000000010003"))
        #expect(plain.id.hex == "31e0ec4ca049b549f939cd0b170459cdca96f41a466824aec7eb58c53400ee27")
        let copy0 = Spec.towerStep(3, [[(0, 1)], [(0, 1)], [(0, 1)]])
        let removal = try Path(canonicalizing: [copy0, .cells([0])])
        #expect(hexString(removal.bytes) == "020003010003010000010001010000010001010000010001020100")
        let edit = try NodeRecord(.edit(EditNode(base: plain.id, removed: [removal])))
        #expect(edit.bytes == hex("4c55504e050100004300000031e0ec4ca049b549f939cd0b170459cdca96f41a466824aec7eb58c53400ee27010000001b000000020003010003010000010001010000010001010000010001020100"))
        #expect(edit.id.hex == "ee3b568af6b6583687b1efe9e65f7e472541e052eb03ec54935a56becfb6c4d2")
        let r = Spec.store([seed, plain, edit])
        let v = try r.root(edit.id)
        #expect(try r.count(v).formatted == "999,784")
        let c = try r.composition(v)
        #expect(c.formula == "Cl500Na500")
        #expect(c.formulaText == "Cl500Na500 \u{00D7} 1,000 \u{2212} Cl108Na108")
        #expect(try c.massMicroDa().formatted == "29,213,688,480,000")

        let whole = try r.walk(v, [copy0])
        #expect(try r.count(whole) == Magnitude(784))
        #expect(try r.materialize(whole).count == 784)
        #expect(try r.probe(whole).hex == "e5d83bf7fcf5686f3ec7b398323feab9c4a43de3f89ac91b6909d3a6f4117fa5")
        #expect(try r.count(r.walk(v, [copy0, .cells([1])])) == Magnitude(144))
        expectCode(.path) { _ = try r.walk(v, [copy0, .cells([0])]) }
        expectCode(.path) { _ = try r.walk(v, [copy0, .cells([0, 7])]) }
    }

    @Test func towerOfTowers() throws {
        let seed = Spec.seedRecord(), million = try Spec.rung(3)
        let ten = Spec.saltPeriods.map { SIMD3($0.x * 10, $0.y * 10, $0.z * 10) }
        let bad = try NodeRecord(.tower(TowerNode(seed: million.id, factor: 2, periodsQ16: ten, levels: 1)))
        expectCode(.validity) { _ = try Spec.store([seed, million, bad]).root(bad.id) }

        let group = try NodeRecord(.group([GroupChild(id: million.id)]))
        #expect(group.bytes == hex("4c55504e020100005c00000001000000cd481a1353e063838be8fc0c55f420b977465a8f1db3e959460aaa34ac4b8df8000000000000000000000000000000000000000000000000000000000000f03f000000000000000000000000000000000000000000000000"))
        #expect(group.id.hex == "bdd05a247b85878be2d11bbd16470d62cdc722d182ec124f76aa212e898d0cfa")
        let good = try NodeRecord(.tower(TowerNode(seed: group.id, factor: 2, periodsQ16: ten, levels: 1)))
        #expect(good.bytes == hex("4c55504e040100006f000000bdd05a247b85878be2d11bbd16470d62cdc722d182ec124f76aa212e898d0cfa0200000088021a010000000000000000000000000000000000000000000000000000000088021a010000000000000000000000000000000000000000000000000000000088021a0100000000010001"))
        #expect(good.id.hex == "6bff9b557dcb5058dcb4126f001f7415a617e43e3bf31e3922c6adeea4d3bfa6")
        let r = Spec.store([seed, million, group, good])
        #expect(try r.count(r.root(good.id)).formatted == "2,000,000")

        let path = try Path(canonicalizing: [
            Spec.towerStep(1, [[(1, 1)], [], []]), .child(0), Spec.towerStep(3, [[(0, 1)], [(0, 1)], [(0, 1)]]),
        ])
        #expect(hexString(path.bytes) == "0300030100010100010100010000000001000003010003010000010001010000010001010000010001")
        let v = try r.resolve(good.id, path)
        #expect(v.kind == .copy)
        #expect(try r.probe(v).hex == "7e800b0105dba71bf11d993caf7b8a7c44c922cbe44ebfd766c57626118d7202")
        let other = try Path(canonicalizing: [
            Spec.towerStep(1, [[(0, 1)], [], []]), .child(0), Spec.towerStep(3, [[(0, 1)], [(0, 1)], [(0, 1)]]),
        ])
        #expect(try r.probe(r.resolve(good.id, other)) == r.probe(v))
    }

    @Test func growWater() throws {
        let water = try NodeRecord(.leaf(Repo.galleryLeaf("apps/web/public/gallery/curated/popular/water.xyz")))
        let periods: [SIMD3<Int64>] = [SIMD3(190_501, 0, 0), SIMD3(0, 224_869, 0), SIMD3(0, 0, 214_389)]
        let hundred = try NodeRecord(.tower(TowerNode(seed: water.id, factor: 2, periodsQ16: periods, levels: 100)))
        #expect(hundred.bytes.count == 123)
        #expect(hundred.id.hex == "56f05f1af0f47e8b00834c5742f6e6e7b4ad7a1f63b31cadb476ed79a5610aac")
        let r = Spec.store([water, hundred])
        #expect(try r.count(r.root(hundred.id)).formatted == "3 \u{00D7} 2^100")
        let one = try NodeRecord(.tower(TowerNode(seed: water.id, factor: 2, periodsQ16: periods, levels: 1)))
        #expect(one.id.hex == "9a0d1fadcc862005945fb3a802e644fcb96ab88b7beccd45de8d2bb7889f8ddf")
    }
}
