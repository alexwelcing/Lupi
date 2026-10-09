import LupiScaleCore
import Testing

@Suite("§12.2 leaves from gallery files")
struct GalleryLeafTests {
    @Test func water() throws {
        let leaf = try Repo.galleryLeaf("apps/web/public/gallery/curated/popular/water.xyz")
        let rec = try NodeRecord(.leaf(leaf))
        #expect(leaf.count == 3)
        #expect(rec.bytes.count == 56)
        #expect(rec.id.hex == "8985f649ff0866084daa120d8b4a02db7124823d408d32487a63bb870b3a553a")
        #expect(rec.bytes == hex("""
            4c55504e010100002c0000000300000008010100000000000000000000000000
            5f078e3e1895643fb840823e3f571b3fea0474bec28637bf
            """))
        #expect(CRC32.checksum(rec.bytes) == 0x91dd48b2)
    }

    @Test func caffeine() throws {
        let leaf = try Repo.galleryLeaf("apps/web/public/gallery/curated/popular/caffeine.xyz")
        let rec = try NodeRecord(.leaf(leaf))
        #expect(leaf.count == 24)
        #expect(rec.bytes.count == 328)
        #expect(rec.id.hex == "54c3bbfb50de8c1f7a11af255980822b2be57d1eff18908046ccabee382fcc84")
    }

    /// −0 becomes +0, and the record round-trips (§1.3, §2.2).
    @Test func negativeZeroIsWrittenAsPositiveZero() throws {
        let a = try NodeRecord(.leaf(LeafNode(atomicNumbers: [1], positions: [SIMD3(-0.0, 0, 1)])))
        let b = try NodeRecord(.leaf(LeafNode(atomicNumbers: [1], positions: [SIMD3(0, 0, 1)])))
        #expect(a.bytes == b.bytes)
        #expect(try NodeRecord(bytes: a.bytes).node == a.node)
    }

    /// A 4,096-atom leaf is 53,264 bytes (§2.2).
    @Test func largestLeaf() throws {
        let leaf = LeafNode(atomicNumbers: [UInt8](repeating: 6, count: 4096), positions: [SIMD3<Float>](repeating: .zero, count: 4096))
        #expect(try NodeRecord(.leaf(leaf)).bytes.count == 53_264)
    }
}

@Suite("§12.3 crystals")
struct CrystalVectorTests {
    @Test func saltSeed() throws {
        let rec = Spec.seedRecord()
        #expect(rec.bytes == hex("""
            4c55504e030100002800000005000b11f9680100050000000000000005000000
            0000000005000000000000000000000000000000
            """))
        #expect(rec.id.hex == "2ef8502fcd22e4b098c57e85c0bd1b6793ff8be13f9b330d0017f1c9561e3f3e")
        let r = Spec.store([rec])
        let v = try r.root(rec.id)
        #expect(try r.count(v) == Magnitude(1000))
        #expect(r.isMaterializable(v))
        #expect(try r.probe(v).hex == "1c017d69dbee61f3a8057626855ca149bec10e10bfbac66014c63871dd8d36e2")
        let leaf = try r.materialize(v)
        let first: [(UInt8, Int64, Int64, Int64)] = [
            (11, 0, 0, 0), (11, 0, 184_818, 184_818), (11, 184_818, 0, 184_818), (11, 184_818, 184_818, 0),
            (17, 184_818, 0, 0), (17, 0, 184_818, 0), (17, 0, 0, 184_818), (17, 184_818, 184_818, 184_818), (11, 369_636, 0, 0),
        ]
        for (i, a) in first.enumerated() {
            #expect(leaf.atomicNumbers[i] == a.0)
            #expect(leaf.positions[i] == SIMD3(CrystalMath.f32(a.1), CrystalMath.f32(a.2), CrystalMath.f32(a.3)))
        }
    }

    @Test(arguments: [
        (630 as UInt64, false, "4c55504e030100002800000003001d005ce700007602000000000000760200000000000076020000000000000000000000000000",
         "42e22db697e0f938556fc8249e423ed986daa0c0ec08aa391afa67d4ad3cf421", "1,000,188,000"),
        (630, true, "4c55504e030100002800000003011d005ce700007602000000000000760200000000000076020000000000000000000000000000",
         "3d6fb40fa20087ff857d0c2d48dc1801cf55a388c840a8a566306fd7d9942911", "1,002,571,291"),
        (63, false, "4c55504e030100002800000003001d005ce700003f000000000000003f000000000000003f000000000000000000000000000000",
         "13bc69957235914287d68a9bed1a136158811dc35db3fbed45cfe415d5867bdf", "1,000,188"),
        (10, true, "4c55504e030100002800000003011d005ce700000a000000000000000a000000000000000a000000000000000000000000000000",
         "5dc6df08fa5c36d6e1f2c39333933582ce2535bdb1b38c6dad2942d9d51601ee", "4,631"),
    ])
    func copper(n: UInt64, closed: Bool, record: String, id: String, count: String) throws {
        let rec = try NodeRecord(.crystal(Spec.copper(n, closed: closed)))
        #expect(rec.bytes == hex(record))
        #expect(rec.id.hex == id)
        let r = Spec.store([rec])
        #expect(try r.count(r.root(rec.id)).formatted == count)
    }

    /// A closed box materializes its far faces, and its count agrees with the closed form.
    @Test func closedBoxMaterializesItsCount() throws {
        let rec = try NodeRecord(.crystal(Spec.copper(5, closed: true)))
        let r = Spec.store([rec])
        let v = try r.root(rec.id)
        #expect(try r.count(v) == Magnitude(666))
        #expect(try r.materialize(v).count == 666)
        // The 10³ closed box has 4,631 atoms: not materializable.
        let big = try NodeRecord(.crystal(Spec.copper(10, closed: true)))
        let rb = Spec.store([big])
        #expect(!rb.isMaterializable(try rb.root(big.id)))
        expectCode(.materialize) { _ = try rb.materialize(rb.root(big.id)) }
    }

    @Test func diamondClosedTwo() throws {
        let c = CrystalNode(structure: .diamond, termination: .closed, speciesA: 6, quarterQ16: 58_438, cells: SIMD3(2, 2, 2))
        let rec = try NodeRecord(.crystal(c))
        let r = Spec.store([rec])
        let v = try r.root(rec.id)
        #expect(rec.id.hex == "6da1979dc30edc1232a92f59966899f376a2976bd8e8cfb491fb99f315c4804e")
        #expect(try r.count(v) == Magnitude(95))
        #expect(try r.materialize(v).count == 95)
        #expect(try r.probe(v).hex == "9c58417edf7741fbf248f333c14e3aa6859e3c18d101e2191b1a61da220abd77")
    }

    @Test func adamantane() throws {
        let rec = try NodeRecord(.crystal(Spec.diamondoid(1)))
        #expect(rec.bytes == hex("""
            4c55504e03010000280000000402060046e40000010000000000000001000000
            000000000100000000000000010000001ba10000
            """))
        let leaf = try Spec.store([rec]).materialize(Spec.store([rec]).root(rec.id))
        let first: [(UInt8, Int64, Int64, Int64)] = [
            (6, 116_876, 116_876, 0), (1, 158_119, 75_633, -41_243), (1, 75_633, 158_119, -41_243),
            (6, 58_438, 58_438, 58_438), (1, 17_195, 17_195, 17_195), (6, 175_314, 175_314, 58_438),
        ]
        for (i, a) in first.enumerated() {
            #expect(leaf.atomicNumbers[i] == a.0)
            #expect(leaf.positions[i] == SIMD3(CrystalMath.f32(a.1), CrystalMath.f32(a.2), CrystalMath.f32(a.3)))
        }
    }

    static let diamondoids: [(UInt64, String, Int, String, String)] = [
        (1, "C10H16", 26, "52c36dc60407419030601a1ec30bddfbafa0867faaaf0699e79cd982129263eb", "f74c5d0693dd6421a23fb664f7da9ba5af74e2d2cadfd997c63e22cce5fb9502"),
        (2, "C35H36", 71, "0b45c04d5fd7f2a9e8527a5ade8f7f5dc6723b7756ca082fc261179ec003f45a", "78b0fb8f73a87c45a72354a1438297a28c12af6ce510a2439119b17d7c49bc63"),
        (3, "C84H64", 148, "7353efe571661aad03ddab352cc8c039172e10b910ca24c5925ff72f202dfcef", "117d3d50457ca5655a76395d968c9fe219fea0474fe7bde6671efe28197f52b8"),
        (4, "C165H100", 265, "2574a5846d192f258b549e0f0775f509604c8b9c50bb021cf781c7fb457080b9", "fdfeb39413d49705d0aa9eb31bc99315baeb280cbc57e70f5bcf01c2cd43d380"),
        (5, "C286H144", 430, "15d49908cb3caa4b80167cb0cd51b54791fb860c2431ad6315d227c2220c6e01", "5c90b6e191e7c9398b6d913932c7c92e3f03f57d41d1555739e4b4ac6615df89"),
        (6, "C455H196", 651, "17004b5a55c0315069a2ba6de9882ed905e55a2f5fb12abfe989d6ad75e99856", "d82b7ad03faa34bbff44391d480d23e0b75010c9992da711b698f80b857b3dc6"),
        (7, "C680H256", 936, "a0542377bd2af58fe0192486fcd45f7d993913c2b1fec97e0bc03cc484e4d168", "c8657a51966d01c26b38b38fa87d3d0e034f9d10c1cef5729c853d998efd6692"),
        (8, "C969H324", 1_293, "064114ca4eb32256c75269d15c3fbdd54625247c379af0ab2bcf14c17963123c", "beb780100b08c5329a7955eb66df0593f979749e5b964dfbf56d1758f55cc01a"),
        (9, "C1330H400", 1_730, "9b61ceda5193bbaef3b248c8d6ac2bafd8115d24231d900eb3efa55b3c8e7b14", "8be36eec9808dcfdf3ee9f21a9e525fc9649ad1567a89363e9aca6807e8b66a8"),
        (10, "C1771H484", 2_255, "3969240b4d7444ba2b6ebaf0e6067e298aab7c2fb87833476594b1c683b9571b", "1a43a4efe3a9a2c40cce5870efccd43b9e225aafb793daa6c276d19e01809c3a"),
        (11, "C2300H576", 2_876, "12b3efdff68034a3d86a30b92d21a42c5915b6f3ca28478aa31b0d8e2f417f77", "f0c65fb8573710eeca766444799faafc4bab340190da07f77471ca52eb041228"),
        (12, "C2925H676", 3_601, "f4d037ff369dc1e509ae78c3d922f244f0b41a628aaa1cc64d69c9db731c1778", "a58f2906169bd197fb51a4b19dae430a3f5a6b304c5880f6ebe7d99e3c8a5acc"),
    ]

    @Test(arguments: diamondoids)
    func diamondoid(m: UInt64, formula: String, atoms: Int, crystal: String, leaf: String) throws {
        let rec = try NodeRecord(.crystal(Spec.diamondoid(m)))
        let r = Spec.store([rec])
        let v = try r.root(rec.id)
        #expect(rec.id.hex == crystal)
        #expect(try r.count(v) == Magnitude(atoms))
        #expect(try r.composition(v).formula == formula)
        #expect(try r.probe(v).hex == leaf)
        // C(2m+3 choose 3) carbons and (2m+2)² hydrogens (§3.3.4).
        let k = Int(m)
        #expect(formula == "C\((2 * k + 3) * (2 * k + 2) * (2 * k + 1) / 6)H\((2 * k + 2) * (2 * k + 2))")
    }
}
