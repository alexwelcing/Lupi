import LupiScaleCore
import Testing

/// Every rejection of §6.6, each on a pack whose CRCs are resealed so that only the
/// rule under test fails.
@Suite("§6.6 pack conformance")
struct PackConformanceTests {
    static func pack() throws -> [UInt8] { try PackVectorTests.smallPack() }

    static func reject(_ code: ScaleError.Code, _ edit: (inout [UInt8]) -> Void, sourceLocation: SourceLocation = #_sourceLocation) throws {
        var b = try pack()
        edit(&b)
        expectCode(code, sourceLocation) { _ = try LupiPack(bytes: b) }
    }

    @Test func acceptsTheWritersOutput() throws {
        _ = try LupiPack(bytes: try Self.pack())
    }

    @Test func header() throws {
        try Self.reject(.pack) { $0[0] = 0x58; resealHeader(&$0) }                   // magic
        try Self.reject(.version) { $0[4] = 2; resealHeader(&$0) }                   // versionMajor
        try Self.reject(.pack) { writeU32(&$0, 8, 64); resealHeader(&$0) }           // headerSize
        try Self.reject(.pack) { writeU64(&$0, 16, 256); resealHeader(&$0) }         // sectionTableOffset
        try Self.reject(.pack) { writeU64(&$0, 24, 49_152); resealHeader(&$0) }      // fileLength ≠ the file's
        try Self.reject(.pack) { $0 += [UInt8](repeating: 0, count: 16_384) }        // file longer than declared
        try Self.reject(.pack) { $0 = Array($0[0..<65_000]) }                        // not a multiple of a page
        try Self.reject(.pack) { writeU32(&$0, 12, 1); resealHeader(&$0) }           // sectionCount 1
        try Self.reject(.pack) { writeU32(&$0, 12, 17); resealHeader(&$0) }          // sectionCount 17
        try Self.reject(.pack) { $0[70] = 1; resealHeader(&$0) }                     // reserved at 64
        try Self.reject(.pack) { $0[96] = 1; resealHeader(&$0) }                     // flags
        try Self.reject(.pack) { $0[110] = 1; resealHeader(&$0) }                    // reserved at 104
        try Self.reject(.crc) { $0[124] ^= 1 }                                       // headerCrc
        try Self.reject(.pack) { $0 = Array($0[0..<100]) }                           // shorter than a page
    }

    /// A versionMinor above 0 is accepted.
    @Test func minorVersionIsAccepted() throws {
        var b = try Self.pack()
        b[6] = 3
        resealHeader(&b)
        _ = try LupiPack(bytes: b)
    }

    @Test func sectionTable() throws {
        try Self.reject(.crc) { $0[130] ^= 1; resealHeader(&$0) }                    // tableCrc
        try Self.reject(.pack) { $0[400] = 1 }                                       // nonzero after the table
    }

    @Test func sections() throws {
        // NREC at 40,000: not page-aligned.
        try Self.reject(.pack) { writeU64(&$0, 128 + 32 + 8, 40_000); resealTable(&$0) }
        // NREC overlapping NIDX's page.
        try Self.reject(.pack) { writeU64(&$0, 128 + 32 + 8, 16_384); resealTable(&$0) }
        // ROOT past the end of the file.
        try Self.reject(.pack) { writeU64(&$0, 128 + 64 + 16, 20_000); resealTable(&$0) }
        // A nonzero byte in the rest of NIDX's page.
        try Self.reject(.pack) { $0[16_384 + 152 + 10] = 1 }
        // A section CRC.
        try Self.reject(.crc) { $0[16_384 + 20] ^= 1 }
        // A type twice: ROOT renamed NREC.
        try Self.reject(.pack) { $0.replaceSubrange((128 + 64)..<(128 + 68), with: Array("NREC".utf8)); resealTable(&$0) }
        // An unknown required section, and a known one at an unknown version.
        try Self.reject(.unsupported) { $0.replaceSubrange((128 + 64)..<(128 + 68), with: Array("XTRA".utf8)); resealTable(&$0) }
        try Self.reject(.unsupported) { $0[128 + 64 + 28] = 2; resealTable(&$0) }
        // A nonzero reserved table byte.
        try Self.reject(.pack) { $0[128 + 30] = 1; resealTable(&$0) }
    }

    /// An unknown section whose required bit is clear is skipped. Here the ROOT section is
    /// turned into one, so the pack must still check out without roots, except that its
    /// contentId covered ROOT's bytes.
    @Test func unknownOptionalSectionIsSkipped() throws {
        var b = try Self.pack()
        b.replaceSubrange((128 + 64)..<(128 + 68), with: Array("XTRA".utf8))
        writeU32(&b, 128 + 64 + 4, 0)
        resealTable(&b)
        // Skipped, so ROOT is absent and the contentId no longer matches.
        expectCode(.mismatch) { _ = try LupiPack(bytes: b) }
    }

    @Test func nidxAndNrec() throws {
        // NIDX missing: renamed to an optional unknown section.
        try Self.reject(.pack) {
            $0.replaceSubrange(128..<132, with: Array("XIDX".utf8))
            writeU32(&$0, 132, 0)
            resealTable(&$0)
        }
        // NIDX length not 8 + 48n.
        try Self.reject(.pack) { writeU64(&$0, 128 + 16, 151); resealSection(&$0, 0) }
        // Entries out of order: the first two swapped whole.
        try Self.reject(.pack) { b in
            let a = Array(b[(16_384 + 8)..<(16_384 + 56)]), c = Array(b[(16_384 + 56)..<(16_384 + 104)])
            b.replaceSubrange((16_384 + 8)..<(16_384 + 56), with: c)
            b.replaceSubrange((16_384 + 56)..<(16_384 + 104), with: a)
            resealSection(&b, 0)
        }
        // A record offset off its 8-byte slot.
        try Self.reject(.pack) { b in
            writeU64(&b, 16_384 + 56 + 32, readU64(b, 16_384 + 56 + 32) + 8)
            resealSection(&b, 0)
        }
        // A kind byte that disagrees with the record.
        try Self.reject(.pack) { $0[16_384 + 8 + 44] = 4; resealSection(&$0, 0) }
        // Bytes after the last record.
        try Self.reject(.pack) { b in
            writeU64(&b, 128 + 32 + 16, readU64(b, 128 + 32 + 16) + 4)
            resealSection(&b, 1)
        }
        // Nonzero padding between records.
        try Self.reject(.pack) { b in
            let firstLength = Int(readU32(b, 16_384 + 8 + 40))
            b[32_768 + firstLength] = 1
            resealSection(&b, 1)
        }
    }

    @Test func records() throws {
        // A record byte flipped: its SHA-256 no longer matches its NodeID.
        try Self.reject(.mismatch) { $0[32_768 + 20] ^= 1; resealSection(&$0, 1) }
    }

    @Test func contentID() throws {
        try Self.reject(.mismatch) { $0[40] ^= 1; resealHeader(&$0) }
    }

    @Test func rootsAndDependencies() throws {
        // A root name with a capital letter.
        try Self.reject(.pack) { $0[49_152 + 8 + 34] = 0x53; resealSection(&$0, 2) }
        // A root name byte past the declared length (padding) nonzero: "water" is 5 bytes, padded to 8.
        try Self.reject(.pack) { $0[49_152 + 99] = 1; resealSection(&$0, 2) }
        // A root count of zero.
        try Self.reject(.pack) { writeU32(&$0, 49_152, 0); resealSection(&$0, 2) }
    }

    @Test func writerRefusals() throws {
        let seed = Spec.seedRecord()
        expectCode(.limit) { _ = try LupiPack.write(records: [], roots: [], dependencies: []) }
        expectCode(.range) { _ = try LupiPack.write(records: [seed], roots: [("Salt", seed.id)], dependencies: []) }
        expectCode(.range) { _ = try LupiPack.write(records: [seed], roots: [("", seed.id)], dependencies: []) }
        expectCode(.canonical) { _ = try LupiPack.write(records: [seed], roots: [("a", seed.id), ("a", seed.id)], dependencies: []) }
        expectCode(.missing) { _ = try LupiPack.write(records: [seed], roots: [("a", nid(String(repeating: "00", count: 32)))], dependencies: []) }
    }
}
