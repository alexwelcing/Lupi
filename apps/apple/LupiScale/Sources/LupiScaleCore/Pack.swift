/// LupiPack v1 (§6): an immutable, content-addressed bundle of node records.
public struct LupiPack: Sendable {
    public static let pageSize = 16_384
    static let headerSize = 128
    static let entrySize = 32
    static let maxNodes = 1 << 22
    static let maxRoots = 4_096
    static let maxDependencies = 256
    static let maxSections = 16

    public let contentID: NodeID
    public let roots: [(String, NodeID)]
    public let dependencies: [NodeID]
    /// Every NodeID, ascending.
    public let nodeIDs: [NodeID]
    let records: [NodeID: NodeRecord]

    // MARK: Writing (§6.5)

    /// Identical bytes from the same records, roots and dependencies.
    public static func write(records: [NodeRecord], roots: [(String, NodeID)], dependencies: [NodeID]) throws -> [UInt8] {
        var unique: [NodeID: NodeRecord] = [:]
        for r in records { unique[r.id] = r }
        let sorted = unique.values.sorted { $0.id < $1.id }
        guard !sorted.isEmpty, sorted.count <= maxNodes else { throw fail(.limit, "a pack holds 1 to 2^22 records") }

        var nrec = ByteWriter()
        var nidx = ByteWriter()
        nidx.u32(UInt32(sorted.count))
        nidx.u32(0)
        for r in sorted {
            nrec.pad(toMultipleOf: 8)
            nidx.append(r.id.bytes)
            nidx.u64(UInt64(nrec.count))
            nidx.u32(UInt32(r.bytes.count))
            nidx.u8(r.kindByte)
            nidx.u8(r.kindVersion)
            nidx.u16(0)
            nrec.append(r.bytes)
        }
        var sections: [(type: String, data: [UInt8])] = [("NIDX", nidx.bytes), ("NREC", nrec.bytes)]
        var rootBytes: [UInt8] = [], depBytes: [UInt8] = []
        if !roots.isEmpty {
            rootBytes = try encodeRoots(roots, known: Set(sorted.map(\.id)))
            sections.append(("ROOT", rootBytes))
        }
        if !dependencies.isEmpty {
            let deps = Array(Set(dependencies)).sorted()
            guard deps.count <= maxDependencies else { throw fail(.limit, "at most 256 dependencies") }
            var w = ByteWriter()
            w.u32(UInt32(deps.count))
            w.u32(0)
            for d in deps { w.append(d.bytes) }
            depBytes = w.bytes
            sections.append(("DEPS", depBytes))
        }

        var offsets: [Int] = []
        var end = pageSize
        for s in sections {
            offsets.append(end)
            end += max(1, (s.data.count + pageSize - 1) / pageSize) * pageSize
        }
        var table = ByteWriter()
        for (i, s) in sections.enumerated() {
            table.ascii(s.type)
            table.u32(1)
            table.u64(UInt64(offsets[i]))
            table.u64(UInt64(s.data.count))
            table.u32(CRC32.checksum(s.data))
            table.u16(1)
            table.u16(0)
        }
        let cid = contentID(ids: sorted.map(\.id), root: rootBytes, deps: depBytes)
        var header = ByteWriter(capacity: headerSize)
        header.ascii("LUPK")
        header.u16(1)
        header.u16(0)
        header.u32(UInt32(headerSize))
        header.u32(UInt32(sections.count))
        header.u64(UInt64(headerSize))
        header.u64(UInt64(end))
        header.append(cid.bytes)
        header.zeros(32)
        header.u32(0)
        header.u32(CRC32.checksum(table.bytes))
        header.zeros(20)
        header.u32(CRC32.checksum(header.bytes))

        var file = [UInt8](repeating: 0, count: end)
        file.replaceSubrange(0..<headerSize, with: header.bytes)
        file.replaceSubrange(headerSize..<(headerSize + table.count), with: table.bytes)
        for (i, s) in sections.enumerated() {
            file.replaceSubrange(offsets[i]..<(offsets[i] + s.data.count), with: s.data)
        }
        return file
    }

    static func validRootName(_ name: [UInt8]) -> Bool {
        guard name.count >= 1, name.count <= 64 else { return false }
        return name.allSatisfy { c in (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 46 || c == 95 || c == 45 }
    }

    private static func encodeRoots(_ roots: [(String, NodeID)], known: Set<NodeID>) throws -> [UInt8] {
        guard roots.count <= maxRoots else { throw fail(.limit, "at most 4,096 roots") }
        let named = roots.map { (Array($0.0.utf8), $0.1) }.sorted { compareBytes($0.0, $1.0) < 0 }
        var w = ByteWriter()
        w.u32(UInt32(named.count))
        w.u32(0)
        for (i, (name, id)) in named.enumerated() {
            guard validRootName(name) else { throw fail(.range, "a root name is 1 to 64 bytes of [a-z0-9._-]") }
            if i > 0 && compareBytes(named[i - 1].0, name) == 0 { throw fail(.canonical, "duplicate root name") }
            guard known.contains(id) else { throw fail(.missing, "a root is not in the pack") }
            w.append(id.bytes)
            w.u16(UInt16(name.count))
            w.append(name)
            w.pad(toMultipleOf: 4)
        }
        return w.bytes
    }

    /// SHA-256("lupi.pack.v1" ‖ 0 ‖ u32 n ‖ NodeIDs ‖ u32 len ‖ ROOT ‖ u32 len ‖ DEPS) (§6.2.1).
    static func contentID(ids: [NodeID], root: [UInt8], deps: [UInt8]) -> NodeID {
        var h = SHA256Hasher()
        h.update(domain: Domain.pack)
        var w = ByteWriter()
        w.u32(UInt32(ids.count))
        h.update(w.bytes)
        for id in ids { h.update(id.bytes) }
        for part in [root, deps] {
            var l = ByteWriter()
            l.u32(UInt32(part.count))
            h.update(l.bytes)
            h.update(part)
        }
        return NodeID(unchecked: h.finalize())
    }

    // MARK: Reading (§6.6)

    /// Accepts only a conforming pack; every record is hashed and decoded at open time.
    public init(bytes: [UInt8]) throws {
        let page = LupiPack.pageSize
        func reject(_ why: String) -> ScaleError { fail(.pack, why) }
        guard bytes.count >= page else { throw reject("shorter than one page") }
        var r = ByteReader(bytes, offset: 0, end: LupiPack.headerSize)
        guard try r.take(4) == Array("LUPK".utf8) else { throw reject("magic") }
        guard try r.u16() == 1 else { throw fail(.version, "pack major version") }
        _ = try r.u16()
        guard try r.u32() == UInt32(LupiPack.headerSize) else { throw reject("header size") }
        let sectionCount = Int(try r.u32())
        guard try r.u64() == UInt64(LupiPack.headerSize) else { throw reject("section table offset") }
        let fileLength = try r.u64()
        guard fileLength == UInt64(bytes.count), bytes.count % page == 0 else { throw reject("file length") }
        guard (2...LupiPack.maxSections).contains(sectionCount) else { throw reject("section count") }
        let cid = try NodeID(bytes: r.take(32))
        guard bytes[64..<96].allSatisfy({ $0 == 0 }) else { throw reject("reserved header bytes") }
        _ = try r.take(32)
        guard try r.u32() == 0 else { throw reject("header flags") }
        let tableCRC = try r.u32()
        guard bytes[104..<124].allSatisfy({ $0 == 0 }) else { throw reject("reserved header bytes") }
        let headerCRC = UInt32(bytes[124]) | UInt32(bytes[125]) << 8 | UInt32(bytes[126]) << 16 | UInt32(bytes[127]) << 24
        guard CRC32.checksum(bytes[0..<124]) == headerCRC else { throw fail(.crc, "header") }

        let tableEnd = LupiPack.headerSize + sectionCount * LupiPack.entrySize
        guard tableEnd <= page else { throw reject("section table beyond the first page") }
        guard CRC32.checksum(bytes[LupiPack.headerSize..<tableEnd]) == tableCRC else { throw fail(.crc, "section table") }
        guard bytes[tableEnd..<page].allSatisfy({ $0 == 0 }) else { throw reject("bytes after the section table") }

        var t = ByteReader(bytes, offset: LupiPack.headerSize, end: tableEnd)
        var sections: [String: ArraySlice<UInt8>] = [:]
        var seen: Set<String> = []
        var previousEnd = page
        for _ in 0..<sectionCount {
            let typeBytes = try t.take(4)
            let type = String(decoding: typeBytes, as: UTF8.self)
            let flags = try t.u32()
            let offset = try t.u64(), length = try t.u64()
            let crc = try t.u32()
            let version = try t.u16()
            guard try t.u16() == 0 else { throw reject("reserved section table bytes") }
            guard offset % UInt64(page) == 0, offset >= UInt64(previousEnd), offset <= fileLength,
                  length <= fileLength - offset else { throw reject("section \(type) bounds") }
            let start = Int(offset), stop = Int(offset + length)
            guard bytes[previousEnd..<start].allSatisfy({ $0 == 0 }) else { throw reject("bytes between sections") }
            let pagesEnd = start + max(1, (Int(length) + page - 1) / page) * page
            guard pagesEnd <= bytes.count else { throw reject("section \(type) pages beyond the file") }
            guard bytes[stop..<pagesEnd].allSatisfy({ $0 == 0 }) else { throw reject("section \(type) padding") }
            guard CRC32.checksum(bytes[start..<stop]) == crc else { throw fail(.crc, "section \(type)") }
            guard seen.insert(type).inserted else { throw reject("section \(type) twice") }
            previousEnd = pagesEnd
            let known = ["NIDX", "NREC", "ROOT", "DEPS"].contains(type) && version == 1
            if !known {
                if flags & 1 == 1 { throw fail(.unsupported, "required section \(type) version \(version)") }
                continue
            }
            sections[type] = bytes[start..<stop]
        }
        guard bytes[previousEnd..<bytes.count].allSatisfy({ $0 == 0 }) else { throw reject("bytes after the last section") }
        guard let nidx = sections["NIDX"], let nrec = sections["NREC"] else { throw reject("NIDX and NREC are required") }

        var x = ByteReader(Array(nidx))
        let n = Int(try x.u32())
        guard try x.u32() == 0 else { throw reject("NIDX reserved") }
        guard n >= 1, n <= LupiPack.maxNodes, nidx.count == 8 + 48 * n else { throw reject("NIDX length") }
        let recordBytes = Array(nrec)
        var ids: [NodeID] = []
        var records: [NodeID: NodeRecord] = [:]
        ids.reserveCapacity(n)
        var expected = 0
        for i in 0..<n {
            let id = try NodeID(bytes: x.take(32))
            let offset = Int(try x.u64()), length = Int(try x.u32())
            let kind = try x.u8(), version = try x.u8()
            guard try x.u16() == 0 else { throw reject("NIDX reserved") }
            if i > 0 && !(ids[i - 1] < id) { throw reject("NIDX NodeIDs ascend strictly") }
            let aligned = (expected + 7) / 8 * 8
            guard offset == aligned, length >= 12, length <= RecordLimits.maxRecordBytes,
                  offset + length <= recordBytes.count else { throw reject("record bounds") }
            guard recordBytes[expected..<offset].allSatisfy({ $0 == 0 }) else { throw reject("record padding") }
            let rec = Array(recordBytes[offset..<(offset + length)])
            guard NodeID.hashing(rec) == id else { throw fail(.mismatch, "record hash") }
            guard rec[4] == kind, rec[5] == version else { throw reject("NIDX kind or version") }
            do {
                records[id] = try NodeRecord(bytes: rec)
            } catch let e as ScaleError {
                throw reject("record \(id.hex.prefix(16)): \(e)")
            }
            ids.append(id)
            expected = offset + length
        }
        guard expected == recordBytes.count else { throw reject("bytes after the last record") }

        let rootBytes = sections["ROOT"].map { Array($0) } ?? []
        let depBytes = sections["DEPS"].map { Array($0) } ?? []
        var roots: [(String, NodeID)] = []
        if sections["ROOT"] != nil {
            var rr = ByteReader(rootBytes)
            let c = Int(try rr.u32())
            guard try rr.u32() == 0, c >= 1, c <= LupiPack.maxRoots else { throw reject("ROOT count") }
            var previous: [UInt8]?
            for _ in 0..<c {
                let id = try NodeID(bytes: rr.take(32))
                let nameLength = Int(try rr.u16())
                let name = try rr.take(nameLength)
                do { try rr.pad(toMultipleOf: 4) } catch { throw reject("ROOT padding") }
                guard LupiPack.validRootName(name) else { throw reject("root name") }
                if let p = previous, compareBytes(p, name) >= 0 { throw reject("root names ascend strictly") }
                guard records[id] != nil else { throw reject("a root is not in this pack") }
                previous = name
                roots.append((String(decoding: name, as: UTF8.self), id))
            }
            guard rr.remaining == 0 else { throw reject("bytes after the last root") }
        }
        var deps: [NodeID] = []
        if sections["DEPS"] != nil {
            var dr = ByteReader(depBytes)
            let c = Int(try dr.u32())
            guard try dr.u32() == 0, c >= 1, c <= LupiPack.maxDependencies, depBytes.count == 8 + 32 * c else {
                throw reject("DEPS length")
            }
            for i in 0..<c {
                let d = try NodeID(bytes: dr.take(32))
                if i > 0 && !(deps[i - 1] < d) { throw reject("dependencies ascend strictly") }
                deps.append(d)
            }
        }
        guard LupiPack.contentID(ids: ids, root: rootBytes, deps: depBytes) == cid else { throw fail(.mismatch, "contentId") }
        self.contentID = cid
        self.roots = roots
        self.dependencies = deps
        self.nodeIDs = ids
        self.records = records
    }

    /// The root of that name.
    public func root(named name: String) -> NodeID? { roots.first { $0.0 == name }?.1 }
}

extension LupiPack: NodeStore {
    public func record(_ id: NodeID) throws -> NodeRecord {
        guard let r = records[id] else { throw fail(.missing, "node \(id.hex.prefix(16))…") }
        return r
    }
}
