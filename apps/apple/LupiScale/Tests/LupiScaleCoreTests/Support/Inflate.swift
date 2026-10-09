/// gzip (RFC 1952) over DEFLATE (RFC 1951), for reading the gallery's
/// `.glimbin` frames on Linux, where Foundation has no decompressor.
enum Inflate {
    struct Failure: Error, CustomStringConvertible {
        var description: String
    }

    static func gunzip(_ data: ArraySlice<UInt8>) throws -> [UInt8] {
        let b = Array(data)
        guard b.count >= 18, b[0] == 0x1f, b[1] == 0x8b, b[2] == 8 else { throw Failure(description: "not gzip") }
        let flags = b[3]
        var p = 10
        if flags & 4 != 0 { p += 2 + Int(b[p]) | Int(b[p + 1]) << 8 }
        if flags & 8 != 0 { while b[p] != 0 { p += 1 }; p += 1 }
        if flags & 16 != 0 { while b[p] != 0 { p += 1 }; p += 1 }
        if flags & 2 != 0 { p += 2 }
        var inflater = Inflater(b, start: p)
        return try inflater.run()
    }

    struct Table {
        /// Indexed by the next 15 bits (LSB first): symbol << 4 | code length.
        var entries: [UInt32]

        init(lengths: [Int]) throws {
            entries = [UInt32](repeating: 0, count: 1 << 15)
            var count = [Int](repeating: 0, count: 16)
            for l in lengths { count[l] += 1 }
            count[0] = 0
            var next = [Int](repeating: 0, count: 16)
            var code = 0
            for bits in 1...15 {
                code = (code + count[bits - 1]) << 1
                next[bits] = code
            }
            for (symbol, len) in lengths.enumerated() where len > 0 {
                let c = next[len]
                next[len] += 1
                var rev = 0
                for i in 0..<len where c >> i & 1 == 1 { rev |= 1 << (len - 1 - i) }
                var i = rev
                while i < 1 << 15 {
                    entries[i] = UInt32(symbol) << 4 | UInt32(len)
                    i += 1 << len
                }
            }
        }
    }

    struct Inflater {
        let input: [UInt8]
        var pos: Int
        var bitBuffer: UInt64 = 0
        var bitCount = 0
        var out: [UInt8] = []

        init(_ input: [UInt8], start: Int) {
            self.input = input
            pos = start
            out.reserveCapacity(input.count * 2)
        }

        mutating func refill() {
            while bitCount <= 48 {
                let byte: UInt64 = pos < input.count ? UInt64(input[pos]) : 0
                pos += 1
                bitBuffer |= byte << UInt64(bitCount)
                bitCount += 8
            }
        }

        mutating func bits(_ n: Int) -> Int {
            if bitCount < n { refill() }
            let v = Int(bitBuffer & ((1 << UInt64(n)) - 1))
            bitBuffer >>= UInt64(n)
            bitCount -= n
            return v
        }

        mutating func decode(_ t: Table) throws -> Int {
            if bitCount < 15 { refill() }
            let e = t.entries[Int(bitBuffer & 0x7FFF)]
            let len = Int(e & 15)
            guard len > 0 else { throw Failure(description: "bad code") }
            bitBuffer >>= UInt64(len)
            bitCount -= len
            return Int(e >> 4)
        }

        static let lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
        static let lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
        static let distBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
        static let distExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

        mutating func run() throws -> [UInt8] {
            let fixedLit = try Table(lengths: (0..<288).map { $0 < 144 ? 8 : $0 < 256 ? 9 : $0 < 280 ? 7 : 8 })
            let fixedDist = try Table(lengths: [Int](repeating: 5, count: 30))
            var last = false
            while !last {
                last = bits(1) == 1
                switch bits(2) {
                case 0:
                    // Stored: drop to a byte boundary.
                    let drop = bitCount % 8
                    _ = bits(drop)
                    let len = bits(16)
                    _ = bits(16)
                    for _ in 0..<len { out.append(UInt8(bits(8))) }
                case 1:
                    try block(fixedLit, fixedDist)
                case 2:
                    let hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4
                    let order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
                    var cl = [Int](repeating: 0, count: 19)
                    for i in 0..<hclen { cl[order[i]] = bits(3) }
                    let clTable = try Table(lengths: cl)
                    var lengths: [Int] = []
                    while lengths.count < hlit + hdist {
                        let sym = try decode(clTable)
                        switch sym {
                        case 0..<16: lengths.append(sym)
                        case 16: lengths.append(contentsOf: repeatElement(lengths.last!, count: 3 + bits(2)))
                        case 17: lengths.append(contentsOf: repeatElement(0, count: 3 + bits(3)))
                        default: lengths.append(contentsOf: repeatElement(0, count: 11 + bits(7)))
                        }
                    }
                    try block(Table(lengths: Array(lengths[0..<hlit])), Table(lengths: Array(lengths[hlit...])))
                default:
                    throw Failure(description: "reserved block type")
                }
            }
            return out
        }

        mutating func block(_ lit: Table, _ dist: Table) throws {
            while true {
                let sym = try decode(lit)
                if sym < 256 {
                    out.append(UInt8(sym))
                } else if sym == 256 {
                    return
                } else {
                    let li = sym - 257
                    let length = Self.lengthBase[li] + bits(Self.lengthExtra[li])
                    let di = try decode(dist)
                    let distance = Self.distBase[di] + bits(Self.distExtra[di])
                    let start = out.count - distance
                    guard start >= 0 else { throw Failure(description: "distance too far") }
                    for i in 0..<length { out.append(out[start + i]) }
                }
            }
        }
    }
}

/// The first frame of a `.glimbin` (packages/core/src/glimbin.ts): atom types and Float32 positions.
enum Glimbin {
    static func firstFrame(_ b: [UInt8]) throws -> (types: [UInt8], positions: [SIMD3<Float>]) {
        let flags = Int(b[6]) | Int(b[7]) << 8
        let n = Int(readU32(b, 12))
        let index = Int(readU64(b, 152))
        let offset = Int(readU64(b, index))
        let size = Int(readU32(b, index + 8))
        let raw = flags & 1 != 0 ? try Inflate.gunzip(b[offset..<(offset + size)]) : Array(b[offset..<(offset + size)])
        var p = flags & 0x20 != 0 ? 76 : 0
        p += 4 * n
        let types = Array(raw[p..<(p + n)])
        p = (p + n + 3) & ~3
        var positions: [SIMD3<Float>] = []
        positions.reserveCapacity(n)
        for i in 0..<n {
            let q = p + 12 * i
            positions.append(SIMD3(
                Float(bitPattern: readU32(raw, q)), Float(bitPattern: readU32(raw, q + 4)), Float(bitPattern: readU32(raw, q + 8))
            ))
        }
        return (types, positions)
    }
}
