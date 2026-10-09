import Foundation

/// The parameters the strategy names as Lupi's own choices. v1 freezes them.
public struct MolecularRecipeParams: Sendable, Equatable {
    public var contactMargin: Double
    public var hapticRatio: Double
    public var metalMetalSlack: Double
    public var metalHydrideSlack: Double
    public var oxygenCap: Int
    /// Added to every ion coordination-number cap.
    public var ionCapDelta: Int

    public static let v1 = MolecularRecipeParams(
        contactMargin: BondConstants.ionContactMargin,
        hapticRatio: BondConstants.hapticTrimRatio,
        metalMetalSlack: BondConstants.metalMetalSlack,
        metalHydrideSlack: BondConstants.metalHydrideSlack,
        oxygenCap: ValenceCaps.caps[8]!,
        ionCapDelta: 0
    )
}

/// Port of `perceiveBonds` (packages/core/src/bonds/perceive.ts). Pure and
/// deterministic: coordinates are Float32 (as the web's Float32Array), every
/// distance is computed in double from them, one square root per stretch, no
/// trig, and every sort breaks ties on (i, j). Golden fixtures exported from
/// the TypeScript (Tests/Fixtures/bonds) pin it pair for pair.
public enum BondPerception {
    public static func clampTolerance(_ tolerance: Double?) -> Double {
        guard let tolerance, tolerance.isFinite else { return BondConstants.defaultTolerance }
        return min(BondConstants.bondToleranceMax, max(0, tolerance))
    }

    public static func perceive(
        _ molecule: Molecule, recipe: BondRecipe = .molecular, tolerance: Double? = nil, collectEvidence: Bool = true
    ) -> PerceivedBonds {
        perceive(
            atomicNumbers: molecule.atomicNumbers, positions: molecule.positions,
            recipe: recipe, tolerance: tolerance, collectEvidence: collectEvidence
        )
    }

    /// `insertionOrder` exists only to test that the grid's insertion order cannot change the output.
    public static func perceive(
        atomicNumbers: [Int], positions: [SIMD3<Float>], recipe: BondRecipe = .molecular,
        tolerance: Double? = nil, collectEvidence: Bool = true, params: MolecularRecipeParams = .v1,
        insertionOrder: [Int]? = nil
    ) -> PerceivedBonds {
        let tolerance = clampTolerance(tolerance)
        let n = min(atomicNumbers.count, positions.count)
        let coordinates = Coordinates(positions, count: n)
        switch recipe {
        case .distance:
            return perceiveDistance(atomicNumbers, coordinates, n, tolerance, collectEvidence, insertionOrder)
        case .molecular:
            var run = MolecularRun(
                atomicNumbers: atomicNumbers, c: coordinates, n: n, tolerance: tolerance,
                collectEvidence: collectEvidence, params: params
            )
            return run.perceive(insertionOrder: insertionOrder)
        }
    }

    static let clash2 = BondConstants.clashFloor * BondConstants.clashFloor

    private static func perceiveDistance(
        _ z: [Int], _ c: Coordinates, _ n: Int, _ tolerance: Double, _ collectEvidence: Bool, _ insertionOrder: [Int]?
    ) -> PerceivedBonds {
        var rcov = [Double](repeating: 0, count: n)
        var maxR = 0.0
        for a in 0..<n {
            rcov[a] = BondRadii.covalent(z[a])
            if rcov[a] > maxR { maxR = rcov[a] }
        }
        let reach = max(BondConstants.clashFloor, 2 * maxR + tolerance + BondConstants.nearMissWindow)
        let near = neighborPairs(c, count: n, reach: reach, insertionOrder: insertionOrder)
        var counts = BondCounts()
        var bonds: [PerceivedBond] = []
        for k in 0..<near.count {
            let a = Int(near.i[k])
            let b = Int(near.j[k])
            let d2 = near.d2[k]
            if d2 < clash2 { counts.clashes += 1 }
            let sum = rcov[a] + rcov[b]
            let cut = sum + tolerance
            if d2 > 0 && d2 <= cut * cut {
                let d = d2.squareRoot()
                let excess = Float(d - (rcov[a] + rcov[b]))
                bonds.append(PerceivedBond(i: a, j: b, kind: .covalent, distance: Float(d), excess: excess))
                if d - sum > BondConstants.longExcess { counts.long += 1 }
            } else if d2 > cut * cut {
                let window = cut + BondConstants.nearMissWindow
                if d2 <= window * window { counts.nearMiss += 1 }
            }
        }
        counts.covalent = bonds.count
        counts.fragments = countFragments(n, bonds.map { ($0.i, $0.j) })
        return PerceivedBonds(
            recipe: .distance, tolerance: tolerance, contactMargin: 0, clashFloor: 0,
            longExcess: BondConstants.longExcess, bonds: bonds, evidence: collectEvidence ? [] : nil, counts: counts
        )
    }
}

/// Connected components over the given pairs, isolated atoms included.
func countFragments(_ n: Int, _ links: [(Int, Int)]) -> Int {
    var parent = Array(0..<n)
    func find(_ x: Int) -> Int {
        var a = x
        while parent[a] != a {
            parent[a] = parent[parent[a]]
            a = parent[a]
        }
        return a
    }
    var components = n
    for (i, j) in links {
        let a = find(i)
        let b = find(j)
        if a == b { continue }
        if a < b { parent[b] = a } else { parent[a] = b }
        components -= 1
    }
    return components
}

/// One run of lupi-bonds.molecular.v1 (strategy §2.3), step by step as the web.
private struct MolecularRun {
    // Candidate kinds; metalH is a metal–H candidate before step 3 decides whether it becomes coordination.
    static let covalent: UInt8 = 0
    static let coordination: UInt8 = 1
    static let contact: UInt8 = 2
    static let metalH: UInt8 = 3

    let z: [Int]
    let c: Coordinates
    let n: Int
    let tolerance: Double
    let params: MolecularRecipeParams
    let collectEvidence: Bool

    var cls: [ElementClass]
    var rcov: [Double]
    var rmetal: [Double]
    var rion: [Double]
    var rdonor: [Double]

    var counts = BondCounts()
    var evidence: [RemovedPair] = []

    // Candidates.
    var ci: [Int] = []
    var cj: [Int] = []
    var cd: [Double] = []
    var cstretch: [Double] = []
    var ckind: [UInt8] = []
    var alive: [Bool] = []
    var bridgingBond: [Bool] = []
    var start: [Int] = []
    var incident: [Int] = []

    init(atomicNumbers: [Int], c: Coordinates, n: Int, tolerance: Double, collectEvidence: Bool, params: MolecularRecipeParams) {
        self.z = Array(atomicNumbers.prefix(n))
        self.c = c
        self.n = n
        self.tolerance = tolerance
        self.params = params
        self.collectEvidence = collectEvidence
        cls = z.map(ElementClass.init(z:))
        rcov = z.map(BondRadii.covalent)
        rmetal = [Double](repeating: 0, count: n)
        rion = [Double](repeating: 0, count: n)
        rdonor = [Double](repeating: .nan, count: n)
    }

    mutating func perceive(insertionOrder: [Int]?) -> PerceivedBonds {
        // The search reach is the largest cutoff the elements present can produce.
        var maxCovH = 0.0, maxCovNonH = 0.0, maxMetal = 0.0, maxIon = 0.0, maxIonCov = 0.0, maxDonor = 0.0
        var hasH = false, hasCovNonH = false, hasMetal = false, hasIon = false, hasDonor = false, hasCarbon = false
        for a in 0..<n {
            switch cls[a] {
            case .hydrogen:
                hasH = true
                maxCovH = max(maxCovH, rcov[a])
            case .covalent:
                hasCovNonH = true
                maxCovH = max(maxCovH, rcov[a])
                maxCovNonH = max(maxCovNonH, rcov[a])
                if z[a] == 6 { hasCarbon = true }
            case .metal:
                hasMetal = true
                rmetal[a] = BondRadii.metal(z[a])
                maxMetal = max(maxMetal, rmetal[a])
            case .ion:
                hasIon = true
                rion[a] = BondRadii.ion[z[a]]!
                maxIon = max(maxIon, rion[a])
                maxIonCov = max(maxIonCov, rcov[a])
            case .inert:
                break
            }
            if let donor = BondRadii.donor[z[a]] {
                rdonor[a] = donor
                hasDonor = true
                maxDonor = max(maxDonor, donor)
            }
        }
        let rH = BondRadii.covalent(1)
        var reach = BondConstants.clashFloor
        if hasH || hasCovNonH { reach = max(reach, 2 * maxCovH + tolerance + BondConstants.nearMissWindow) }
        if hasMetal {
            reach = max(reach, 2 * maxMetal + params.metalMetalSlack)
            if hasCovNonH { reach = max(reach, maxMetal + maxCovNonH + tolerance) }
            if hasH { reach = max(reach, maxMetal + rH + params.metalHydrideSlack) }
        }
        if hasIon && hasDonor { reach = max(reach, maxIon + maxDonor + params.contactMargin) }
        if hasIon && hasCarbon { reach = max(reach, maxIonCov + BondRadii.covalent(6) + tolerance) }

        let near = neighborPairs(c, count: n, reach: reach, insertionOrder: insertionOrder)
        var ionNearCarbon = [Bool](repeating: false, count: n)
        step1Candidates(near, &ionNearCarbon)
        buildIncidence()
        step2HydrogenPairs()
        let bridgingAtom = step3OnePartnerPerHydrogen()
        step4BridgedPairs(bridgingAtom)
        step5AcuteAngles()
        step6ValenceCaps(bridgingAtom)
        if hasMetal { step7Metals() }
        if hasIon { step8Ions() }
        return step9Result(ionNearCarbon)
    }

    // MARK: Step 1: candidates

    mutating func add(_ a: Int, _ b: Int, _ d2: Double, _ kind: UInt8) {
        let d = d2.squareRoot()
        ci.append(a)
        cj.append(b)
        cd.append(d)
        cstretch.append(d / (rcov[a] + rcov[b]))
        ckind.append(kind)
        alive.append(true)
    }

    mutating func step1Candidates(_ near: NeighborPairs, _ ionNearCarbon: inout [Bool]) {
        for k in 0..<near.count {
            let a = Int(near.i[k])
            let b = Int(near.j[k])
            let d2 = near.d2[k]
            if d2 < BondPerception.clash2 {
                counts.clashes += 1
                if collectEvidence { evidence.append(RemovedPair(i: a, j: b, reason: .clash, distance: Float(d2.squareRoot()))) }
                continue
            }
            let ca = cls[a]
            let cb = cls[b]
            if ca == .inert || cb == .inert { continue }
            let covalentA = ca == .hydrogen || ca == .covalent
            let covalentB = cb == .hydrogen || cb == .covalent
            if covalentA && covalentB {
                let cut = rcov[a] + rcov[b] + tolerance
                if d2 <= cut * cut {
                    add(a, b, d2, Self.covalent)
                } else {
                    let window = cut + BondConstants.nearMissWindow
                    if d2 <= window * window { counts.nearMiss += 1 }
                }
                continue
            }
            if ca == .metal || cb == .metal {
                var cut = -1.0
                var kind = Self.coordination
                if ca == .metal && cb == .metal {
                    cut = rmetal[a] + rmetal[b] + params.metalMetalSlack
                } else {
                    let metal = ca == .metal ? a : b
                    let ligand = ca == .metal ? b : a
                    if cls[ligand] == .covalent {
                        cut = rmetal[metal] + rcov[ligand] + tolerance
                    } else if cls[ligand] == .hydrogen {
                        cut = rmetal[metal] + rcov[ligand] + params.metalHydrideSlack
                        kind = Self.metalH
                    }
                }
                if cut > 0 && d2 <= cut * cut { add(a, b, d2, kind) }
                continue
            }
            if ca == .ion || cb == .ion {
                if ca == .ion && cb == .ion { continue }
                let ion = ca == .ion ? a : b
                let partner = ca == .ion ? b : a
                if !rdonor[partner].isNaN {
                    let cut = rion[ion] + rdonor[partner] + params.contactMargin
                    if d2 <= cut * cut { add(a, b, d2, Self.contact) }
                }
                if z[partner] == 6 {
                    let cut = rcov[ion] + rcov[partner] + tolerance
                    if d2 <= cut * cut { ionNearCarbon[ion] = true }
                }
            }
        }
        bridgingBond = [Bool](repeating: false, count: ci.count)
    }

    /// Per-atom candidate lists (CSR), each in ascending partner order.
    mutating func buildIncidence() {
        let total = ci.count
        start = [Int](repeating: 0, count: n + 1)
        for k in 0..<total {
            start[ci[k] + 1] += 1
            start[cj[k] + 1] += 1
        }
        for a in 0..<n { start[a + 1] += start[a] }
        var fill = Array(start[0..<n])
        incident = [Int](repeating: 0, count: 2 * total)
        for k in 0..<total {
            incident[fill[ci[k]]] = k
            fill[ci[k]] += 1
            incident[fill[cj[k]]] = k
            fill[cj[k]] += 1
        }
    }

    func other(_ k: Int, _ a: Int) -> Int { ci[k] == a ? cj[k] : ci[k] }

    mutating func remove(_ k: Int, _ reason: RemovalReason) {
        alive[k] = false
        counts.removed += 1
        if collectEvidence { evidence.append(RemovedPair(i: ci[k], j: cj[k], reason: reason, distance: Float(cd[k]))) }
    }

    func aliveOfKind(_ a: Int, _ kind: UInt8) -> [Int] {
        var out: [Int] = []
        for p in start[a]..<start[a + 1] {
            let k = incident[p]
            if alive[k] && ckind[k] == kind { out.append(k) }
        }
        return out
    }

    func byStretch(_ p: Int, _ q: Int) -> Bool {
        if cstretch[p] != cstretch[q] { return cstretch[p] < cstretch[q] }
        if ci[p] != ci[q] { return ci[p] < ci[q] }
        return cj[p] < cj[q]
    }

    // MARK: Step 2: H–H survives only between two H with no other covalent candidate

    mutating func step2HydrogenPairs() {
        var covDegree = [Int](repeating: 0, count: n)
        for k in 0..<ci.count where ckind[k] == Self.covalent {
            covDegree[ci[k]] += 1
            covDegree[cj[k]] += 1
        }
        for k in 0..<ci.count
        where ckind[k] == Self.covalent && z[ci[k]] == 1 && z[cj[k]] == 1
            && (covDegree[ci[k]] != 1 || covDegree[cj[k]] != 1) {
            remove(k, .hydrogenPair)
        }
    }

    // MARK: Step 3: one partner per hydrogen (B–H–B bridges, η²-H₂, hydrides)

    mutating func step3OnePartnerPerHydrogen() -> [Bool] {
        var bridgingAtom = [Bool](repeating: false, count: n)
        for h in 0..<n where cls[h] == .hydrogen {
            let covalent = aliveOfKind(h, Self.covalent).sorted(by: byStretch)
            var kept = min(1, covalent.count)
            if covalent.count >= 2 && z[other(covalent[0], h)] == 5 && z[other(covalent[1], h)] == 5 {
                kept = 2
                bridgingAtom[h] = true
                bridgingBond[covalent[0]] = true
                bridgingBond[covalent[1]] = true
            }
            for p in stride(from: kept, to: covalent.count, by: 1) { remove(covalent[p], .hydrogenSinglePartner) }

            var metalH = aliveOfKind(h, Self.metalH)
            if kept > 0 {
                let h2Unit = kept == 1 && z[other(covalent[0], h)] == 1
                for k in metalH {
                    if h2Unit { ckind[k] = Self.coordination } else { remove(k, .hydrogenMetalContact) }
                }
            } else {
                metalH.sort(by: byStretch)
                for (p, k) in metalH.enumerated() {
                    if p < 2 { ckind[k] = Self.coordination } else { remove(k, .hydrogenSinglePartner) }
                }
                if metalH.count >= 2 { bridgingAtom[h] = true }
            }
        }
        return bridgingAtom
    }

    // MARK: Step 4: drop B–B / M–M when both atoms bond the same bridging H

    mutating func step4BridgedPairs(_ bridgingAtom: [Bool]) {
        var pairIndex: [Int: Int] = [:]
        for k in 0..<ci.count { pairIndex[ci[k] * n + cj[k]] = k }
        for h in 0..<n where bridgingAtom[h] {
            var partners: [Int] = []
            for p in start[h]..<start[h + 1] {
                let k = incident[p]
                if alive[k] && (ckind[k] == Self.covalent || ckind[k] == Self.coordination) { partners.append(other(k, h)) }
            }
            if partners.count != 2 { continue }
            let a = min(partners[0], partners[1])
            let b = max(partners[0], partners[1])
            guard let k = pairIndex[a * n + b], alive[k] else { continue }
            let boranes = z[a] == 5 && z[b] == 5 && ckind[k] == Self.covalent
            let metals = cls[a] == .metal && cls[b] == .metal && ckind[k] == Self.coordination
            if boranes || metals { remove(k, .bridgedPair) }
        }
    }

    // MARK: Step 5: acute angle at covalent centres

    mutating func step5AcuteAngles() {
        for a in 0..<n where cls[a] == .covalent {
            var bonds = aliveOfKind(a, Self.covalent)
            if bonds.count < 2 { continue }
            bonds.sort(by: byStretch)
            let ax = c.x[a], ay = c.y[a], az = c.z[a]
            var keptBonds: [Int] = []
            for k in bonds {
                if !bridgingBond[k] {
                    let o = other(k, a)
                    let ux = c.x[o] - ax
                    let uy = c.y[o] - ay
                    let uz = c.z[o] - az
                    let uu = ux * ux + uy * uy + uz * uz
                    var acute = false
                    for q in keptBonds {
                        let p = other(q, a)
                        let vx = c.x[p] - ax
                        let vy = c.y[p] - ay
                        let vz = c.z[p] - az
                        let dot = ux * vx + uy * vy + uz * vz
                        if dot > 0 && dot * dot > BondConstants.acuteAngleCos2 * uu * (vx * vx + vy * vy + vz * vz) {
                            acute = true
                            break
                        }
                    }
                    if acute {
                        remove(k, .acuteAngle)
                        continue
                    }
                }
                keptBonds.append(k)
            }
        }
    }

    // MARK: Step 6: valence caps, most stretched first

    mutating func step6ValenceCaps(_ bridgingAtom: [Bool]) {
        var valence = [Int](repeating: 0, count: n)
        var restricted = [Int](repeating: 0, count: n)
        let z = self.z
        func restrictedPartner(_ a: Int, _ partner: Int) -> Bool {
            guard let rule = ValenceCaps.partnerRules[z[a]] else { return false }
            return !rule.allowed.contains(z[partner])
        }
        var covalentAlive: [Int] = []
        for k in 0..<ci.count where alive[k] && ckind[k] == Self.covalent {
            covalentAlive.append(k)
            valence[ci[k]] += 1
            valence[cj[k]] += 1
            if restrictedPartner(ci[k], cj[k]) { restricted[ci[k]] += 1 }
            if restrictedPartner(cj[k], ci[k]) { restricted[cj[k]] += 1 }
        }
        let oxygenCap = params.oxygenCap
        func cap(_ a: Int) -> Int {
            if z[a] == 1 { return bridgingAtom[a] ? 2 : 1 }
            if z[a] == 8 { return oxygenCap }
            return ValenceCaps.caps[z[a]] ?? Int.max
        }
        func over(_ a: Int, _ partner: Int) -> Bool {
            if valence[a] > cap(a) { return true }
            return restrictedPartner(a, partner) && restricted[a] > ValenceCaps.partnerRules[z[a]]!.limit
        }
        let stretch = cstretch, i = ci, j = cj
        covalentAlive.sort { p, q in
            if stretch[p] != stretch[q] { return stretch[p] > stretch[q] }
            if i[p] != i[q] { return i[p] < i[q] }
            return j[p] < j[q]
        }
        for k in covalentAlive {
            if bridgingBond[k] { continue }
            let a = ci[k]
            let b = cj[k]
            if !over(a, b) && !over(b, a) { continue }
            remove(k, .valenceCap)
            valence[a] -= 1
            valence[b] -= 1
            if restrictedPartner(a, b) { restricted[a] -= 1 }
            if restrictedPartner(b, a) { restricted[b] -= 1 }
        }
    }

    // MARK: Step 7: metals, haptic trim then the coordination cap

    mutating func step7Metals() {
        var local = [Int](repeating: -1, count: n)
        for metal in 0..<n where cls[metal] == .metal {
            let bonds = aliveOfKind(metal, Self.coordination)
            if bonds.count < 2 { continue }
            let partners = bonds.map { other($0, metal) }
            for (idx, p) in partners.enumerated() { local[p] = idx }
            var parent = Array(0..<partners.count)
            func find(_ x: Int) -> Int {
                var root = x
                while parent[root] != root { root = parent[root] }
                return root
            }
            for (idx, p) in partners.enumerated() {
                for k in aliveOfKind(p, Self.covalent) {
                    let q = local[other(k, p)]
                    if q < 0 { continue }
                    let ra = find(idx)
                    let rb = find(q)
                    if ra != rb { parent[max(ra, rb)] = min(ra, rb) }
                }
            }
            var shortest = [Double](repeating: .infinity, count: partners.count)
            var size = [Int](repeating: 0, count: partners.count)
            for (idx, k) in bonds.enumerated() {
                let root = find(idx)
                size[root] += 1
                if cd[k] < shortest[root] { shortest[root] = cd[k] }
            }
            for (idx, k) in bonds.enumerated() {
                let root = find(idx)
                if size[root] >= 2 && cd[k] > params.hapticRatio * shortest[root] { remove(k, .hapticTrim) }
            }
            for p in partners { local[p] = -1 }
        }
        for metal in 0..<n where cls[metal] == .metal {
            var bonds = aliveOfKind(metal, Self.coordination)
            if bonds.count <= BondConstants.metalCoordinationCap { continue }
            bonds.sort(by: byStretch)
            for p in BondConstants.metalCoordinationCap..<bonds.count { remove(bonds[p], .metalCoordinationCap) }
        }
    }

    // MARK: Step 8: ions, donor precedence then coordination-number caps

    mutating func step8Ions() {
        var contactDistance = [Double](repeating: .nan, count: n)
        for ion in 0..<n where cls[ion] == .ion {
            let contacts = aliveOfKind(ion, Self.contact)
            if contacts.isEmpty { continue }
            for k in contacts { contactDistance[other(k, ion)] = cd[k] }
            let shadowed = contacts.filter { k in
                let donor = other(k, ion)
                for b in aliveOfKind(donor, Self.covalent) {
                    let dY = contactDistance[other(b, donor)]
                    if dY < cd[k] - BondConstants.ionDonorPrecedence { return true }
                }
                return false
            }
            for k in contacts { contactDistance[other(k, ion)] = .nan }
            for k in shadowed { remove(k, .ionDonorPrecedence) }

            var remaining = contacts.filter { alive[$0] }
            let limit = ValenceCaps.ionCoordinationCaps[z[ion]]! + params.ionCapDelta
            if remaining.count <= limit { continue }
            let rIon = rion[ion]
            func slack(_ k: Int) -> Double { cd[k] - rIon - rdonor[other(k, ion)] }
            remaining.sort { p, q in
                let sp = slack(p), sq = slack(q)
                if sp != sq { return sp < sq }
                if ci[p] != ci[q] { return ci[p] < ci[q] }
                return cj[p] < cj[q]
            }
            for p in max(0, limit)..<remaining.count { remove(remaining[p], .ionCoordinationCap) }
        }
    }

    // MARK: Step 9: counts from the final graph

    mutating func step9Result(_ ionNearCarbon: [Bool]) -> PerceivedBonds {
        var bonds: [PerceivedBond] = []
        var links: [(Int, Int)] = []
        var heavyPartners = [Int](repeating: 0, count: n)
        var anyPartners = [Int](repeating: 0, count: n)
        for k in 0..<ci.count where alive[k] {
            let a = ci[k]
            let b = cj[k]
            let e = cd[k] - (rcov[a] + rcov[b])
            let kind = BondKind(rawValue: ckind[k])!
            bonds.append(PerceivedBond(i: a, j: b, kind: kind, distance: Float(cd[k]), excess: Float(e)))
            if kind == .ionicContact {
                counts.ionicContact += 1
                continue
            }
            if kind == .covalent {
                counts.covalent += 1
                if e > BondConstants.longExcess { counts.long += 1 }
            } else {
                counts.coordination += 1
            }
            links.append((a, b))
            anyPartners[a] += 1
            anyPartners[b] += 1
            if z[b] != 1 { heavyPartners[a] += 1 }
            if z[a] != 1 { heavyPartners[b] += 1 }
        }
        counts.fragments = countFragments(n, links)
        for a in 0..<n {
            if cls[a] == .hydrogen && anyPartners[a] == 2 && heavyPartners[a] == 2 { counts.bridgingH += 1 }
            if ionNearCarbon[a] { counts.ionCarbonClose += 1 }
        }
        let sortedEvidence: [RemovedPair]? = collectEvidence
            ? evidence.sorted { $0.i != $1.i ? $0.i < $1.i : $0.j < $1.j }
            : nil
        return PerceivedBonds(
            recipe: .molecular, tolerance: tolerance, contactMargin: params.contactMargin,
            clashFloor: BondConstants.clashFloor, longExcess: BondConstants.longExcess,
            bonds: bonds, evidence: sortedEvidence, counts: counts
        )
    }
}
