import Foundation

/// A molecule as connectivity alone, for naming what was built (plan §4.5,
/// "Done"): elements and links with their kinds, orders ignored (a built
/// molecule's bonds are all single, a gallery molecule's are estimated from
/// length). Two molecules are the same when their graphs are isomorphic,
/// whatever their atom order or geometry.
public struct MolecularGraph: Sendable, Hashable, Codable {
    public struct Link: Sendable, Hashable, Codable {
        public var i: Int
        public var j: Int
        public var kind: BondKind

        public init(i: Int, j: Int, kind: BondKind) {
            self.i = min(i, j)
            self.j = max(i, j)
            self.kind = kind
        }
    }

    public var atomicNumbers: [Int]
    public var links: [Link]

    public init(atomicNumbers: [Int], links: [Link]) {
        self.atomicNumbers = atomicNumbers
        self.links = Array(Set(links.filter { $0.i != $0.j && $0.j < atomicNumbers.count })).sorted {
            $0.i != $1.i ? $0.i < $1.i : $0.j < $1.j
        }
    }

    public init(_ piece: BuildPiece) {
        self.init(molecule: piece.molecule, graph: piece.graph)
    }

    public init(molecule: Molecule, graph: BondGraph) {
        self.init(atomicNumbers: molecule.atomicNumbers, links: graph.bonds.map { Link(i: $0.i, j: $0.j, kind: $0.kind) })
    }

    public var count: Int { atomicNumbers.count }

    public var formula: String {
        Molecule(atomicNumbers: atomicNumbers, positions: atomicNumbers.map { _ in SIMD3<Float>(0, 0, 0) }).hillFormula
    }

    /// Neighbours of each atom with the link kind, ascending.
    public var adjacency: [[(atom: Int, kind: BondKind)]] {
        var out = [[(atom: Int, kind: BondKind)]](repeating: [], count: count)
        for l in links {
            out[l.i].append((l.j, l.kind))
            out[l.j].append((l.i, l.kind))
        }
        return out.map { $0.sorted { $0.atom < $1.atom } }
    }

    /// One piece over every link kind (what a single body always is).
    public var isConnected: Bool {
        guard count > 0 else { return false }
        let adj = adjacency
        var seen = [Bool](repeating: false, count: count)
        var stack = [0]
        seen[0] = true
        var reached = 1
        while let a = stack.popLast() {
            for (b, _) in adj[a] where !seen[b] {
                seen[b] = true
                reached += 1
                stack.append(b)
            }
        }
        return reached == count
    }

    /// Colour refinement (Weisfeiler–Lehman) labels: each atom's element and links, then its
    /// neighbours' labels, until the partition stops splitting. Equal graphs get equal labels
    /// under any numbering, and the hash is stable across runs and platforms (FNV-1a, not `Hasher`).
    public var refinedLabels: [UInt64] {
        let adj = adjacency
        var labels = (0..<count).map { a -> UInt64 in
            var h = FNV64()
            h.add(UInt64(atomicNumbers[a]))
            for kind in BondKind.allCases { h.add(UInt64(adj[a].filter { $0.kind == kind }.count)) }
            return h.value
        }
        var classes = Set(labels).count
        for _ in 0..<count {
            let next = (0..<count).map { a -> UInt64 in
                var h = FNV64()
                h.add(labels[a])
                for v in adj[a].map({ UInt64($0.kind.rawValue) &* 0x9E37_79B9_7F4A_7C15 ^ labels[$0.atom] }).sorted() { h.add(v) }
                return h.value
            }
            let nextClasses = Set(next).count
            labels = next
            if nextClasses == classes { break }
            classes = nextClasses
        }
        return labels
    }

    /// The refined labels as one number: equal for isomorphic graphs, and rarely equal otherwise.
    public var signature: UInt64 {
        var h = FNV64()
        h.add(UInt64(count))
        h.add(UInt64(links.count))
        for l in refinedLabels.sorted() { h.add(l) }
        return h.value
    }

    /// A mapping search bounded by `stepLimit`, past which it answers no (a cage so symmetric
    /// that refinement cannot tell its atoms apart still matches within it).
    public func isIsomorphic(to other: MolecularGraph, stepLimit: Int = 200_000) -> Bool {
        guard count == other.count, links.count == other.links.count else { return false }
        guard atomicNumbers.sorted() == other.atomicNumbers.sorted() else { return false }
        let la = refinedLabels, lb = other.refinedLabels
        guard la.sorted() == lb.sorted() else { return false }
        if count == 0 { return true }
        let adjA = adjacency, adjB = other.adjacency
        var kindA = [Int: BondKind](), kindB = [Int: BondKind]()
        for l in links { kindA[l.i * count + l.j] = l.kind }
        for l in other.links { kindB[l.i * count + l.j] = l.kind }
        func link(_ k: [Int: BondKind], _ a: Int, _ b: Int) -> BondKind? { k[min(a, b) * count + max(a, b)] }

        // Visit A's atoms rarest label first, then outward, so each step is constrained by mapped neighbours.
        var frequency = [UInt64: Int]()
        for l in la { frequency[l, default: 0] += 1 }
        var order: [Int] = []
        var placed = [Bool](repeating: false, count: count)
        while order.count < count {
            let start = (0..<count).filter { !placed[$0] }.min {
                (frequency[la[$0]]!, $0) < (frequency[la[$1]]!, $1)
            }!
            placed[start] = true
            var queue = [start]
            var head = 0
            while head < queue.count {
                let a = queue[head]
                head += 1
                order.append(a)
                for (b, _) in adjA[a] where !placed[b] {
                    placed[b] = true
                    queue.append(b)
                }
            }
        }
        var map = [Int](repeating: -1, count: count)
        var used = [Bool](repeating: false, count: count)
        var steps = 0
        func extend(_ depth: Int) -> Bool {
            if depth == count { return true }
            steps += 1
            if steps > stepLimit { return false }
            let a = order[depth]
            for b in 0..<count where !used[b] && lb[b] == la[a] && adjB[b].count == adjA[a].count {
                var ok = true
                for (n, kind) in adjA[a] where map[n] >= 0 {
                    if link(kindB, b, map[n]) != kind { ok = false; break }
                }
                guard ok else { continue }
                map[a] = b
                used[b] = true
                if extend(depth + 1) { return true }
                map[a] = -1
                used[b] = false
                if steps > stepLimit { return false }
            }
            return false
        }
        return extend(0)
    }
}

/// FNV-1a over 64-bit words, little-endian bytes.
struct FNV64 {
    var value: UInt64 = 0xCBF2_9CE4_8422_2325

    mutating func add(_ word: UInt64) {
        var w = word
        for _ in 0..<8 {
            value ^= w & 0xFF
            value = value &* 0x0000_0100_0000_01B3
            w >>= 8
        }
    }
}
