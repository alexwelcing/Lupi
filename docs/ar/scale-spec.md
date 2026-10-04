# LupiScale v1: the normative specification

*2026-10-04. This is the contract that two independent implementations build to: TypeScript in `packages/core/src/scale` (the reference, which writes the test fixtures) and Swift in `apps/apple/LupiScale` (which reads them). The architecture, the reasons and the play design are in [scale.md](scale.md); the owner's decision is D14 in [decisions.md](decisions.md). Where this spec and scale.md disagree on bytes or algorithms, this spec wins.*

---

## 0. Status, conformance and how to read this

**Key words.** MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

**Three kinds of rule.** Every section is marked with the kind of agreement it demands.

| Mark | Meaning | How it is tested |
|---|---|---|
| **[B]** byte-exact | Both implementations produce identical bytes, hashes, integers and strings. | Golden fixtures: TypeScript writes them, Swift asserts equality, on Linux and on the owner's Mac (debug and release). |
| **[V]** value | Both compute the same quantity to a stated tolerance. These values are never hashed or persisted. | Property and tolerance tests on both sides. |
| **[P]** play | Behaviour of the app. The constants are starting values in the app's tuning table, changed on the device without a format change. | Linux unit tests of the pure logic; feel on the device. |

**Frozen.** Everything marked [B] is frozen when v1 first merges to `main`. After that, a change of any byte, order, constant or rounding is a new record kind version, a new step tag, a new reference version or a new pack version (§13). Version 1 then keeps resolving forever, bugs included, as the web's Remix `r1` codes do (`packages/ui/src/remix/code.ts`).

**Test vectors.** §12 lists values computed while drafting this spec with a scratch implementation of exactly these algorithms. The core vectors (CRC-32, SplitMix64, the salt seed and its leaf, the copper billion, diamondoids 1, 2 and 12, the googolplex record, the grain's copy key, substitution and probe, the 10³ copy key, and every row of the formatting table) were then re-derived by a second, separately written Swift program and matched byte for byte. The TypeScript implementation MUST reproduce every value in §12 before it writes `packages/core/src/scale/__fixtures__/scale-v1.json` (`pnpm exec tsx packages/core/scripts/write-scale-fixtures.mts`). The Swift tests read a copy at `apps/apple/LupiScale/Tests/Fixtures/scale-v1.json`, kept in sync by `pnpm exec tsx tools/apple/export-scale-fixtures.mts` (with `--check`), the pattern LupiKit's bond fixtures already use.

---

## 1. Conventions and primitives [B]

### 1.1 Bytes and integers

- Byte order is little-endian everywhere.
- `u8`, `u16`, `u32`, `u64` are unsigned; `i64` is two's complement.
- Offsets in tables below are from the start of the structure being described.

### 1.2 BigUInt

An unsigned integer of up to 65,536 bits.

| Field | Size | Meaning |
|---|---|---|
| `n` | u16 | number of magnitude bytes, 0 to 8,192 |
| bytes | n | the magnitude, little-endian |

- Zero is encoded with `n = 0`.
- The encoding is minimal: when `n > 0`, the last byte MUST NOT be zero. Readers MUST reject a non-minimal BigUInt.
- Example: 256 is `02 00 00 01`.

### 1.3 Floating point

- `f32` and `f64` are IEEE 754 binary32 and binary64, little-endian.
- Every stored float MUST be finite. The negative-zero bit patterns (`0x80000000`, `0x8000000000000000`) are forbidden: writers MUST write +0 for every zero, and readers MUST reject −0.
- No identity-bearing value is ever the result of floating-point arithmetic, with one exception: the conversion from Q16 (§1.4).

### 1.4 Q16 fixed point

Generator geometry is integer. Lengths are integers in units of 2⁻¹⁶ Å ("Q16").

- A Q16 value `q` becomes an `f32` Å value with exactly one rounding: `f32(q) = Float32(Double(q) / 65536)`, round-to-nearest-even.
  - TypeScript: `Math.fround(Number(q) / 65536)`.
  - Swift: `Float(Double(q) / 65536.0)`.
- `|q|` MUST be below 2⁵³, so `Double(q)` is exact and the division by a power of two is exact. Every generator in §3 keeps `|q|` under 2³⁶.
- No rule here uses `Math.round`, which rounds halves toward +∞; TypeScript MUST NOT use it for any [B] value.

### 1.5 SHA-256 and domain strings

- SHA-256 is FIPS 180-4. LupiKit's pure-Swift implementation (`LupiData/SHA256.swift`, tested against the NIST vectors) is acceptable.
- Every hash that is not a NodeID starts with a domain string: the ASCII bytes below followed by one `0x00` byte.

| Domain string | Used for |
|---|---|
| `lupi.scale.copy.v1` | the copy key of a tower's seed copy (§3.4) |
| `lupi.scale.ref.v1` | the refKey of a scale reference (§7.1) |
| `lupi.pack.v1` | the contentId of a pack (§6.2) |

A NodeID is the SHA-256 of the record bytes; the record's own magic `LUPN` separates it from the others.

### 1.6 CRC-32

CRC-32/ISO-HDLC, the CRC of zlib, PNG and Ethernet:

| Parameter | Value |
|---|---|
| width | 32 |
| polynomial | `0x04C11DB7` (reflected form `0xEDB88320`) |
| initial value | `0xFFFFFFFF` |
| input and output reflected | yes |
| final XOR | `0xFFFFFFFF` |
| check (ASCII `123456789`) | `0xCBF43926` |

CRC-32 only guards packs against corruption. It never identifies anything.

### 1.7 SplitMix64

The only pseudo-random generator in v1 ([Steele, Lea and Flood, OOPSLA 2014](https://doi.org/10.1145/2660193.2660195)). State `s` is a u64; all arithmetic is modulo 2⁶⁴.

```
next():
  s ← s + 0x9E3779B97F4A7C15
  z ← s
  z ← (z XOR (z >> 30)) × 0xBF58476D1CE4E5B9
  z ← (z XOR (z >> 27)) × 0x94D049BB133111EB
  return z XOR (z >> 31)
```

- Swift: `&+`, `&*` on `UInt64`.
- TypeScript: `BigInt` with `& 0xFFFFFFFFFFFFFFFFn` after each `+` and `×`, or `BigInt.asUintN(64, …)`.
- It is used by one rule only, the dopant substitution of a tower (§3.4.6). Display-only jitter on a GPU is not part of v1 and MUST NOT feed anything that is hashed or kept.

### 1.8 Text encodings

- base64url is RFC 4648 §5, without padding.
- Hex is lowercase.
- Strings are UTF-8 without a byte-order mark.

### 1.9 Limits

| Limit | Value |
|---|---|
| BigUInt | 65,536 bits (8,192 bytes) |
| Node record | 65,536 bytes |
| Atoms in a leaf, or in any materialized node | 4,096 |
| Atomic number | 1 to 118 |
| Leaf coordinate | \|x\| ≤ 2²⁰ Å |
| Group children | 1 to 256 |
| Group translation | \|t\| ≤ 2⁴⁰ Å |
| Crystal cells per axis | 1 to 2⁶² |
| Crystal `quarter`, `capOffset` | 1 to 2²⁰ Q16 |
| Capped crystal size `m` | 1 to 12 |
| Tower factor | 2 to 16 |
| Tower levels | 0 to 2⁶⁵⁵³⁶ − 1 |
| Tower seed count | below 2²⁵⁶ |
| Edit removals | 1 to 256 |
| Path | 65,536 bytes, 1,024 steps |
| Octants in one `cells` step | 64 |
| Runs per axis in one `tower` step | 4,096 |
| Ranges in one `atoms` step | 4,096 |
| Scale reference | 196,608 bytes, 255 embedded records, 255 dependencies |
| Pack | 2²² records, 4,096 roots, 256 dependencies, 16 sections, 2⁴⁰ bytes |

---

## 2. Node records [B]

A **node** is an immutable description of a finite set of atoms (an element and a position each) in the node's own frame. Nodes refer to other nodes only by NodeID, so a structure is a DAG, and repeating a NodeID is how anything is instanced.

### 2.1 Record header

| Offset | Size | Field | Rule |
|---|---|---|---|
| 0 | 4 | magic | ASCII `LUPN` (`4C 55 50 4E`) |
| 4 | 1 | kind | 1 leaf, 2 group, 3 crystal, 4 tower, 5 edit |
| 5 | 1 | kindVersion | 1 |
| 6 | 2 | flags | 0 |
| 8 | 4 | bodyLength | the record is exactly 12 + bodyLength bytes, at most 65,536 |
| 12 | … | body | per kind, below |

**NodeID** = SHA-256 of the whole record (header and body). Two records with the same bytes are the same node on every platform, forever. Readers MUST reject a record whose body does not parse to exactly `bodyLength` bytes, and any nonzero reserved or padding byte.

### 2.2 Leaf (kind 1): explicit atoms

| Offset | Size | Field |
|---|---|---|
| 12 | 4 | `n`, the atom count, 1 to 4,096 (u32) |
| 16 | n | `Z[i]`, atomic numbers 1 to 118 (u8) |
| 16 + n | p | zero padding, `p = (4 − (16 + n) mod 4) mod 4` |
| 16 + n + p | 12n | positions, `x, y, z` per atom (f32, Å), in atom order |

- Record length: `16 + n + p + 12n`. A 4,096-atom leaf is 53,264 bytes.
- **Order is meaningful and kept.** Atoms appear in the order of their source (the file order of an XYZ, or a generator's order). Nothing re-sorts them, so atom index `i` in a leaf is atom `i` of its file, as on the web.
- **Positions are the source's Float32 values.** For an XYZ file they are exactly the numbers the web's parser stores in its `Float32Array` (`packages/parsers/src/xyzParser.ts`), which LupiKit's parser already reproduces (`LupiChem/XYZ`). Only −0 changes, to +0.
- Bonds, charge and multiplicity are not part of a leaf. Bonds come from the named recipe at use time (`lupi-bonds.molecular.v1` for play); chemistry metadata stays in the trophy's `MoleculeRef`.
- Positions are 4-byte aligned inside the record, and records sit at 8-byte aligned offsets in a pack (§6), so a reader can use them in place.

### 2.3 Group (kind 2): an assembly of nodes

| Offset | Size | Field |
|---|---|---|
| 12 | 2 | `c`, child count, 1 to 256 (u16) |
| 14 | 2 | reserved, 0 |
| 16 + 88i | 32 | child `i`: NodeID |
| 48 + 88i | 32 | child `i`: rotation `qx, qy, qz, qw` (f64) |
| 80 + 88i | 24 | child `i`: translation `tx, ty, tz` (f64, Å) |

- A child point `x` maps to the group frame as `R(q)·x + t`.
- **Rotation.** `(qx, qy, qz, qw)` is a unit quaternion with `qw` the scalar part.
  - Readers MUST check `|((qx² + qy²) + qz²) + qw² − 1| ≤ 2⁻³⁰`, evaluated left to right in binary64. Writers SHOULD normalize to within 2⁻⁴⁰ so the check never sits on its boundary.
  - Canonical sign: `qw > 0`, or `qw = 0` and the first nonzero of `qx, qy, qz` is positive. Writers MUST negate a quaternion that is not canonical, and readers MUST reject one.
  - The identity is `(0, 0, 0, 1)`.
- **Translation.** `|tx|, |ty|, |tz| ≤ 2⁴⁰` Å.
- **Order** is meaningful (it is the child index of a path), and a NodeID MAY repeat: a 60-subunit capsid is one subunit referenced 60 times.
- Every child MUST have unit exponent 0 (§2.8).
- A group stores no interface or bond table. Which children touch, and how strongly, is derived data (scale.md §5.4).

### 2.4 Crystal (kind 3): a lattice generator

| Offset | Size | Field | Values |
|---|---|---|---|
| 12 | 1 | `structure` | 1 sc, 2 bcc, 3 fcc, 4 diamond, 5 rocksalt |
| 13 | 1 | `termination` | 0 open, 1 closed, 2 capped |
| 14 | 1 | `A`, species of sublattice 0 | 1 to 118 |
| 15 | 1 | `B`, species of sublattice 1 | 0 to 118; 0 means "same as A" |
| 16 | 4 | `quarter` | a quarter of the cubic lattice constant, Q16, 1 to 2²⁰ |
| 20 | 8 | `n0` | cells along x, 1 to 2⁶² |
| 28 | 8 | `n1` | cells along y |
| 36 | 8 | `n2` | cells along z |
| 44 | 1 | `capZ` | capping species when `termination = 2`, else 0 |
| 45 | 3 | reserved | 0 |
| 48 | 4 | `capOffset` | Q16 per quarter step when `termination = 2`, else 0 |

The record is always 52 bytes. Field rules:

- `sc` and `fcc`: `B` MUST be 0. `rocksalt`: `B` MUST NOT be 0. `bcc` with `B ≠ 0` is the CsCl structure, and `diamond` with `B ≠ 0` is zincblende.
- `termination = 2` (capped) requires `structure = 4`, `n0 = n1 = n2 = m` with `1 ≤ m ≤ 12`, and nonzero `capZ` and `capOffset`.
- The algorithm is in §3.3.

### 2.5 Tower (kind 4): a self-similar generator

| Offset | Size | Field |
|---|---|---|
| 12 | 32 | `seed`, the NodeID repeated at level 0 |
| 44 | 1 | `f`, factor, 2 to 16 |
| 45 | 1 | `flags`: bit 0 = substitution present; other bits 0 |
| 46 | 2 | reserved, 0 |
| 48 | 72 | periods `p0, p1, p2`, each three i64 (x, y, z), Q16 in the seed's frame |
| 120 | 2 + k | `levels`, a BigUInt |
| 122 + k | 4 | only when flags bit 0 is set: `fromZ` (u8), `toZ` (u8), `perCopy` (u16) |

- The periods MUST be linearly independent: their determinant, computed exactly in integers, is nonzero.
- Substitution: `fromZ` and `toZ` in 1 to 118 and different; `perCopy` 1 to 4,096.
- The algorithm is in §3.4. The googolplex record is 168 bytes.

### 2.6 Edit (kind 5): a node with pieces removed

| Offset | Size | Field |
|---|---|---|
| 12 | 32 | `base`, a NodeID |
| 44 | 2 | `r`, removal count, 1 to 256 (u16) |
| 46 | 2 | reserved, 0 |
| 48 | … | `r` removals, each a u32 byte length followed by a canonical path (§4.2) |

- Removals are sorted strictly ascending by their path bytes: compare byte by byte, and a proper prefix sorts first. Duplicates are forbidden.
- The base MUST NOT itself be an edit; writers flatten (an edit of an edit becomes one edit with both removal sets).
- The semantics are in §3.5.

### 2.7 Kinds a reader does not know

A record with an unknown kind, or a known kind with an unknown `kindVersion`, is kept opaque: its NodeID is still verified (§6.6), but resolving any path through it fails with `unsupported`. This is how later kinds can be added without breaking v1 readers (§13).

### 2.8 Rules that need context

These are checked when a node is resolved, because they look at other nodes.

**Unit exponent.** Every node has a frame unit of `f^u` Å.

| Node | Unit exponent `u` |
|---|---|
| leaf, crystal, crystal box, seed copy, selection | 0 (Å) |
| group | 0 (all its children are unit 0) |
| tower level `k` | `u(k)` from §3.4.1, in the tower's base `f` |
| edit | that of its base |

Two rules use it:

- A group child MUST have unit exponent 0.
- A tower seed MUST have unit exponent 0. A tower with `levels ≤ 3` has unit exponent 0 and may itself be a seed or a group child.

**Tower seeds.**

- The seed's atom count MUST be below 2²⁵⁶.
- With a substitution, the seed MUST be materializable (§4.5) and MUST contain at least `perCopy` atoms of `fromZ`.

**Edits.**

- Every removal MUST resolve inside the base.
- No removal may contain an `atoms` step.
- No removal may be equal to, or an ancestor of, another (§4.4).
- The empty path (the whole base) is not a removal.

---

## 3. The generator registry v1 [B]

Every node kind is a generator: a pure function from its record (and the records it names) to atoms. The registry is frozen like Remix `r1`. Changing a table, an order, a constant or a rounding makes a new kind version, and the old one resolves forever.

| Registry id | Record kind | What it generates |
|---|---|---|
| `lupi.gen.leaf@1` | 1 | explicit atoms, as stored |
| `lupi.gen.assembly@1` | 2 | instanced assemblies of other nodes |
| `lupi.gen.crystal@1` | 3 | crystal lattices: sc, bcc and CsCl, fcc, diamond and zincblende, rock salt; open or closed boxes; H-capped diamondoids |
| `lupi.gen.tower@1` | 4 | self-similar towers of any seed, up to and beyond a googolplex atoms |
| `lupi.gen.edit@1` | 5 | a node with sub-nodes removed |
| `lupi.bake.partition@1` | 1 and 2 | not a node kind: the deterministic bake that turns any explicit structure into leaves and groups (§3.6) |

### 3.1 `lupi.gen.leaf@1`

- **Input:** the record.
- **Output:** atoms `i = 0 … n−1` with element `Z[i]` and position `(x, y, z)[i]` Å, in record order.

### 3.2 `lupi.gen.assembly@1`

- **Input:** the record and its children.
- **Output:** the concatenation of every child's atoms in child order. Each child's atoms are mapped by its placement `R(q)·x + t`.
- The same NodeID may appear many times; that is instancing, and storage is one record per distinct child.
- A group is never materialized as a leaf (§4.5). It is drawn and broken through its children.

### 3.3 `lupi.gen.crystal@1`

#### 3.3.1 The quarter grid

Positions live on an integer grid of quarter steps: a site at grid point `g = (gx, gy, gz)` sits at `g × quarter` Q16 from the crystal origin. The cubic cell `(i, j, k)` spans grid points `4i … 4i+4` and so on. The cell's sites, in this order, as `(sx, sy, sz, sublattice)`:

| Structure | Sites |
|---|---|
| 1 sc | (0,0,0,0) |
| 2 bcc | (0,0,0,0), (2,2,2,1) |
| 3 fcc | (0,0,0,0), (0,2,2,0), (2,0,2,0), (2,2,0,0) |
| 4 diamond | (0,0,0,0), (0,2,2,0), (2,0,2,0), (2,2,0,0), (1,1,1,1), (1,3,3,1), (3,1,3,1), (3,3,1,1) |
| 5 rocksalt | (0,0,0,0), (0,2,2,0), (2,0,2,0), (2,2,0,0), (2,0,0,1), (0,2,0,1), (0,0,2,1), (2,2,2,1) |

- The site of cell `(i, j, k)` is at `g = (4i + sx, 4j + sy, 4k + sz)`.
- Species: sublattice 0 is `A`; sublattice 1 is `B`, or `A` when `B = 0`.
- **Examples.** Copper: fcc, `quarter` = 59,228 (a = 3.615 Å). Salt: rocksalt, Na/Cl, 92,409 (5.6402 Å). Diamond: 58,438 (3.5668 Å). The web's `BillionAtomBlock` is fcc Cu, open, 630³ cells.

#### 3.3.2 Boxes and their atoms (open and closed)

A **box** is a range of cells `[lo, hi)` per axis, with `0 ≤ lo < hi ≤ n`. The crystal itself is the box `[0, n)`.

- **Open termination.** The box holds every site of every cell in the range. Open crystals tile: two adjacent boxes share no atom, which is what towers need.
- **Closed termination.** The crystal is the open crystal plus the sites on its far faces, so all six faces are complete, as a real crystal cut on {100}. A box whose `hi` equals `n` on an axis also owns that extra layer.

Materialization order (both terminations):

```
ext[a] = 1 if termination = closed and hi[a] = n[a], else 0
for k in lo2 … hi2 − 1 + ext[2]:
  for j in lo1 … hi1 − 1 + ext[1]:
    for i in lo0 … hi0 − 1 + ext[0]:
      for each site s of the structure, in table order:
        g = (4i + sx, 4j + sy, 4k + sz)
        skip if any g[a] > 4·n[a]                  // only face sites in the extra layer
        emit atom: Z = species(s), q = (g − 4·lo) × quarter   // Q16, relative to the box corner
```

- The leaf of a box has positions `f32(q)` (§1.4).
- **Atom count of a box** (no materialization needed): `count = Σ_sites Π_axes e_a`, where `e_a = hi[a] − lo[a]`, plus 1 when the termination is closed, the site's `s_a` is 0 and `hi[a] = n[a]`. Copper 630³: 1,000,188,000 open and 1,002,571,291 closed.
- **The owner cell of an atom** at grid point `g` is `min(⌊g_a / 4⌋, n_a − 1)` per axis. Removals (§3.5) use it.

#### 3.3.3 The octree of boxes

A box's children split every axis whose extent `e = hi − lo` is at least 2 at `mid = lo + ⌈e / 2⌉`, so the lower half takes the extra cell.

- Octant `o` (0 to 7) has bit `a` set for the upper half on axis `a`.
- Octants that would set a bit on an axis that is not split do not exist.
- Children are listed in increasing `o`. A box of one cell has no children.

Any box can be addressed by octants (`cells` step, §4.1). A box with at most 4,096 atoms can also be materialized as a leaf (§4.5).

#### 3.3.4 Capped diamondoids (`termination = 2`)

A hydrogen-terminated diamond nanocrystal cut on {111} faces, built whole as one leaf. Cube-shaped caps were tried and rejected: on {100} faces two hydrogens land 0.74 Å apart, which the bond recipe would read as H₂.

```
m = n0 (= n1 = n2), centre c = (2m, 2m, 2m), radius R = 2m + 1          // quarter grid
sites  = every diamond-lattice grid point g with |gx−c|+|gy−c|+|gz−c| ≤ R,
         enumerated for gz ascending, then gy ascending, then gx ascending
         (a diamond-lattice point: all coordinates even with sum ≡ 0 (mod 4),
          or all odd with (g − (1,1,1)) of that form)
sublattice(g) = 1 if gx is odd, else 0
dirs[0] = (1,1,1), (1,−1,−1), (−1,1,−1), (−1,−1,1);   dirs[1] = their negatives
neighbours(g) = [g + d for d in dirs[sublattice(g)]] that are in sites
kept(g) = |neighbours(g)| ≥ 2                          // one pass only
for each kept g in site order:
  emit species(sublattice(g)) at q = g × quarter
  for d in dirs[sublattice(g)], in order:
    if g + d is not a kept site: emit capZ at q + d × capOffset
```

- Positions are Q16 from the crystal origin, then `f32(q)`.
- With `quarter` 58,438 and `capOffset` 41,243, C–C is 1.5445 Å and C–H is 1.0900 Å.
- The series is C₁₀H₁₆ (adamantane, m = 1), C₃₅H₃₆ (decamantane, m = 2), C₈₄H₆₄, …, and in general C<sub>(2m+3 choose 3)</sub>H<sub>(2m+2)²</sub>, up to C₂₉₂₅H₆₇₆ (3,601 atoms) at m = 12.
- Every kept carbon has at least two carbon neighbours, and the closest H–H pair is 1.78 Å (within a CH₂), for every m.
- A capped crystal has no octree. Its count is its materialized length.

### 3.4 `lupi.gen.tower@1`

A tower of `levels = L` stacks `f` copies of level `k − 1` into level `k`, one axis at a time, so three levels grow a cube by `f` on every side. Level 0 is the seed.

#### 3.4.1 Level arithmetic

All quantities are exact integers (BigUInt where `L` is large).

| Quantity | Formula | Meaning |
|---|---|---|
| `axis(k)` | `(k − 1) mod 3`, for k ≥ 1 | the axis level `k` stacks along |
| `u(k)` | 0 for k = 0, else `⌊(k − 1) / 3⌋` | unit exponent: a level-`k` frame unit is `f^u(k)` seed units (Å) |
| `C(a, k)` | `⌊(k + 2 − a) / 3⌋`, for k ≥ 0 | how many levels from 1 to `k` stack along axis `a` |
| `n(a, k, D)` | `C(a, k) − C(a, k − D)` | how many of the levels `k, k−1, …, k−D+1` stack along `a` |

- Level `k` holds `f^C(a,k)` seed copies along axis `a` and `f^k` copies in all.
- In its own units, every level has extents in {1, f} × the periods. There are only three shapes: (f,1,1), (f,f,1) and (f,f,f) times the periods.

#### 3.4.2 Children and placements

Level `k ≥ 1` has `f` children, `j = 0 … f−1`, each a level `k − 1` node.

- Child `j` sits at translation `j × p_axis(k)`. The value is Q16 in the parent's units, so in the parent frame it is `j × p_axis(k) / 65536` units.
- The child's scale relative to the parent is `f^(u(k−1) − u(k))`: `1/f` when `k ≡ 1 (mod 3)` and `k ≥ 4`, otherwise 1.
- There is no rotation.
- The tower's own frame is level `L`'s: its origin is copy 0's origin.

#### 3.4.3 Digits and per-axis runs

A descent of `D` levels from level `k` picks one child digit per level, `d ∈ [0, f)`. The digits are grouped by axis and written most significant first: for axis `a`, the digits of the levels `k, k−1, …` whose `axis` is `a`, in descending level order.

- The digits of axis `a` from the top of the tower down to level 0 are exactly the base-`f` representation of the seed copy's index along `a`. That is why a point maps to a short path (§4.8).
- Digit strings are run-length coded as `(digit, length)` runs.

#### 3.4.4 Seed copies

Level 0 below a tower is a **seed copy**.

- **Without a substitution** the copy is the seed node itself, and a path continues into it with the seed's own steps.
- **With a substitution** the copy is a leaf: the seed's materialization (§4.5) with `perCopy` atoms of `fromZ` turned into `toZ`. Positions are the seed's, unchanged. Where a copy sits is its path, never its coordinates.

#### 3.4.5 The copy key

The copy key names one seed copy of one tower:

```
stepBytes = the encoding (§4.1) of the single tower step that descends from level L to level 0
            along this copy's digits: tag 0x03, BigUInt D = L, then the three run lists,
            without the path's u16 step count. Empty when L = 0.
copyKey   = the first 8 bytes, read as a little-endian u64, of
            SHA-256("lupi.scale.copy.v1" ‖ 0x00 ‖ towerNodeID ‖ stepBytes)
```

- The key depends only on the tower and the copy, never on how a path was split into steps, on edits around the tower, or on where the tower sits.
- Its cost is O(runs), not O(levels).

#### 3.4.6 The substitution

```
idx  = ascending indices i of the seed materialization with Z[i] = fromZ;  m = |idx|
pool = [0, 1, …, m−1];  g = SplitMix64(seed = copyKey)
for t in 0 … perCopy−1:
  r = g.next()
  j = t + (r mod (m − t))          // u64 remainder
  swap pool[t], pool[j]
for t in 0 … perCopy−1:  Z[idx[pool[t]]] = toZ
```

The salt ladder uses Cl → Br, one per copy: a 0.1 % bromide doping whose place is picked by each copy's own key, so neighbouring cells rarely match (two copies put their bromide on the same one of the seed's 500 chlorines with probability 1/500).

#### 3.4.7 Counts

- `count(level k) = count(seed) × f^k`, exactly. A substitution changes no count.
- The salt seed holds 1,000 atoms, so the salt rungs are 10³ (L = 0), 10⁶ (3), 10⁹ (6), 10³⁰ (27), 10¹⁰⁰ (97) and 10^(10^100) (L = 10¹⁰⁰ − 3).
- **A googolplex is not a perfect cube** (10¹⁰⁰ ≡ 1 mod 3), so no cube of a simple cubic arrangement holds exactly a googolplex ions. At L = 10¹⁰⁰ − 3, `axis(L) = 0` and the root is a 10 : 1 : 1 bar of ten cubes, each 10^(10^100 − 1) atoms. The same holds for 10¹⁰⁰ (L = 97). Every rung whose L is a multiple of 3 is a cube.

### 3.5 `lupi.gen.edit@1`

An edit denotes its base minus the atoms of every removed node.

- Paths through an edit are the base's paths. Addressing a removed node, or anything below it, fails (§4.4).
- `count(edit) = count(base) − Σ count(removed node)`. This is exact (§5) because removals are disjoint.
- **Materializing a removed region.** When a removal falls inside a box that is being materialized, the atoms whose owner cell (§3.3.2) lies in a removed sub-box are dropped. The other atoms keep their order.

### 3.6 `lupi.bake.partition@1`: explicit structures of any size

Turns `N` explicit atoms (elements and Float32 positions, e.g. a glimbin frame or a large mmCIF) into leaves and groups. It is integer-only, so the web build (TypeScript) and a device import (Swift) produce the same NodeIDs.

```
if N ≤ 4096: one leaf, atoms in source order; done.
q[a][i]  = ⌊pos[i][a] × 1024⌋                     // exact: a power-of-two scale, then floor
u[a][i]  = q[a][i] − min_i q[a][i]                   // ≥ 0
B        = bit length of max over all a, i of u[a][i]   (0 when the max is 0)
shift    = max(0, B − 21)
key[i]   = Σ over b in 0…20, a in 0…2 of  ((u[a][i] >> shift) >> b & 1) << (3b + a)   // 63-bit Morton key
order    = indices sorted by (key ascending, then source index ascending)
leaves   = consecutive runs of 4,096 atoms of `order` (the last may be shorter), each a leaf
           with its atoms in `order` order and their positions unchanged
level    = the leaves' NodeIDs, in order
while |level| > 1:
  level  = groups of up to 8 consecutive entries, each a group record with identity placements
root     = level[0]
```

- Positions are never re-centred or re-quantized, so the source's numbers survive.
- `massive_1m.glimbin` (953,312 Cu atoms) bakes to 233 leaves and 35 groups.

---

## 4. Paths, views and resolution [B]

A **path** names one node inside a root: a sequence of steps, each choosing a child of the current node. A path's size grows with the choices made, never with the depth reached, because a tower step covers any number of levels as digit runs.

### 4.1 Steps and their encoding

```
path   := u16 stepCount, then stepCount steps
step   := u8 tag, then
  tag 1  child  : u16 index                                     group child
  tag 2  cells  : u8 count (1…64), count × u8 octant (0…7)       crystal octree
  tag 3  tower  : BigUInt D (≥ 1), then for axis 0, 1, 2:
                  u16 runCount, runCount × (u8 digit, BigUInt length ≥ 1)
  tag 4  atoms  : u16 rangeCount (1…4096), rangeCount × (u16 start, u16 length ≥ 1)
```

### 4.2 Canonical form

Writers MUST write, and readers MUST accept only, canonical paths:

1. **No two adjacent steps share a tag of 2, 3 or 4.** Adjacent `cells` steps concatenate their octants (at most 64). Adjacent `tower` steps add their `D` and concatenate the run lists per axis. Adjacent `atoms` steps compose: the second selection indexes the first, and the result is re-expressed in the first's base indices.
2. **Runs.** In each axis list, adjacent runs have different digits and every length is at least 1. An axis with no levels in the step has `runCount = 0`.
3. **Ranges** ascend with a gap of at least one index between them (`start[i+1] > start[i] + length[i]`), and `start + length ≤ 4096`.
4. The empty path (`stepCount = 0`) names the root itself.

Readers MUST reject a path that is not canonical. The simplest reader check is to decode and re-encode, and compare the bytes.

### 4.3 Views

Resolution walks from a root NodeID to a **view**, a node that may be virtual:

| View | Comes from | Steps it takes |
|---|---|---|
| leaf | a leaf record | `atoms` |
| group | a group record | `child` |
| box | a crystal with open or closed termination (the box `[0, n)`), or a `cells` step | `cells`; `atoms` when it has ≤ 4,096 atoms |
| capped | a capped crystal record | `atoms` |
| level `k` | a tower record (k = L), or a `tower` step | `tower` (D ≤ k) |
| copy | level 0 of a tower with a substitution | `atoms` |
| (seed view) | level 0 of a tower without a substitution: the seed's own view | the seed's steps |
| selection | an `atoms` step | `atoms` (merged canonically) |

An edit record resolves to its base's view, carrying the edit's removals (§4.4). Any other step on a view is an error (`path`).

**Validity checks while walking:**

- A `child` index MUST be below the child count.
- A `cells` octant MUST exist (§3.3.3).
- A `tower` step needs `D ≤ k`, every digit `< f`, and on each axis `a` the run lengths MUST sum to `n(a, k, D)`.
- An `atoms` range MUST lie inside the current view's materialization.

### 4.4 Removals

A view carries the list of removal paths that start at it. Taking a step updates the list:

- **`child i`.** A removal starting with `child i` loses that step. If nothing remains, the step enters a removed node and fails. Removals starting with another index are dropped.
- **`cells o₁…oₙ`.** Compare with the removal's octant list. If the removal's octants are a prefix of (or equal to) the step's, the step enters a removed node and fails. If the step's octants are a proper prefix of the removal's, the removal keeps the remaining octants. Otherwise the removal is dropped.
- **`tower D`.** Let `D' = min(D, D_removal)`. Compare, per axis, the first `n(a, k, D')` digits of both. If they differ, drop the removal. If they match and `D_removal ≤ D`, the step enters a removed node and fails. Otherwise the removal keeps a tower step of `D_removal − D` levels with the remaining digits.
- **`atoms`.** Selections index the materialization, which already excludes removed atoms (§4.5), so the selection view carries no removals.

**Containment** for the edit rule "no removal contains another" is the same prefix comparison applied between two removal paths that start at the same node. It needs no start level: the shorter tower step's run lengths give the digit counts to compare.

**Counts with removals:** `count(view) = baseCount(view) − Σ baseCount(view without removals, walked along r)` over its removals `r`.

### 4.5 Materialization and probes

A view is **materializable** when it can be written as one leaf of at most 4,096 atoms:

| View | Materialization |
|---|---|
| leaf | the record's atoms |
| capped | §3.3.4 |
| box with ≤ 4,096 atoms | §3.3.2, minus atoms whose owner cell lies in a removed sub-box |
| copy | the seed's materialization with the substitution (§3.4.6); the seed MUST be materializable |
| selection | the selected atoms of its base's materialization, in ascending index order, positions unchanged |

Groups and tower levels `k ≥ 1` are never materialized. The **probe** of a materializable view is the NodeID of the leaf record (§2.2) of its materialization.

### 4.6 Resolution

```
resolve(rootID, path, store) → view:
  v ← rootView(rootID, removals = [])
  for step in path.steps: v ← apply(v, step)      // §4.3 checks, §4.4 removals
  return v

rootView(id, removals):
  rec ← store.record(id)                          // a missing record is the error `missing`
  match rec.kind:
    leaf     → leaf view (removals must be empty)
    group    → group view (check every child has unit exponent 0)
    crystal  → capped view, or the box [0, n)
    tower    → check the seed (§2.8); the level L view, or the copy when L = 0
    edit     → validate the removals (§2.8), then rootView(base, removals ++ edit.removals)
```

- Implementations SHOULD memoize counts by NodeID.
- They MUST NOT expand anything to answer a count: every count above is closed-form.

### 4.7 Errors

| Code | Meaning |
|---|---|
| `truncated`, `canonical`, `range`, `limit`, `magic`, `version` | decoding failures |
| `missing` | a NodeID is not in the store |
| `unsupported` | an unknown kind, version, step tag or required section |
| `path` | a step does not apply, an index is out of range, or the step enters a removed node |
| `validity` | a contextual rule of §2.8 fails |
| `materialize` | the view is not materializable |
| `mismatch` | a probe, record hash or contentId does not match |

### 4.8 From a point to a path [V]

The pinch, the dive and the chip gesture need the path to the node under a point. Inside one node:

- **Group:** the child whose bounds contain the point, nearest centre first on ties.
- **Box:** the octant `o` whose bits are set where the point is at or past `mid` (in quarter units).
- **Tower level `k`:** express the point in the period basis (solve `x = Σ c_a p_a` in binary64), then take `j = clamp(⌊c_axis(k)⌋, 0, f − 1)`.

Repeating this down a tower toward a point whose coordinates are binary64 values gives, per axis, a few dozen explicit digits and then one constant run. So even a dive of 10¹⁰⁰ levels writes a path of a few hundred bytes. The digits are play input; once written, the path is exact.

---

## 5. Magnitude: exact counts and masses [B]

### 5.1 Values

A Magnitude is an exact non-negative integer, held in one of two forms:

| Form | Holds | Used for |
|---|---|---|
| plain | a BigUInt, below 2⁶⁵⁵³⁶ | every count of a finite node: leaves, groups, crystals, small towers, selections |
| base-`f` runs | `f` in 2…16 and digit runs `(digit, BigUInt length)`, most significant first, adjacent digits different, no leading zero run | tower counts and anything derived from them |

- `towerCount(s, f, k)` is the base-`f` digits of `s` followed by a run of `k` zeros.
- A Magnitude keeps the base of the tower it came from, and formats in that base (§5.4). Equality and order are by value.
- **Exact range.** Every count v1 can produce is exact: plain values below 2⁶⁵⁵³⁶ and tower values `s · f^L` with `s < 2²⁵⁶`, `f ≤ 16` and `L < 2⁶⁵⁵³⁶`, plus sums and differences of these. That reaches about 10^(2.4 × 10¹⁹⁷²⁸); a googolplex is 10^(10^100). There is no floating-point step anywhere in a count. §13 says how a later version goes past this bound.

### 5.2 Arithmetic

| Operation | Rule |
|---|---|
| `add`, `sub` | Plain + plain is BigUInt arithmetic. With one tower base `f`, the plain operand is converted to base-`f` digits and the digit runs are added or subtracted from the least significant end. Within an aligned segment of constant digits, at most two positions differ before the carry or borrow settles, so the cost is O(runs). A negative result is an error. Two different tower bases are converted to plain when both fit, else the operation fails; v1 never needs it, because only edits subtract and an edit's terms share one tower. |
| `mulSmall(k)` | Repeated doubling, for `k` below 2²⁵⁶. |
| `cmp` | By digit count, then digit by digit from the most significant. |
| `fitsPlain`, `toPlain` | Exact conversion when the value has at most 65,536 bits. |

### 5.3 Composition, formula and mass

**Composition** is `count(Z) = perUnit[Z] × multiplier`:

- **Finite node:** `perUnit` is its exact element counts and `multiplier` is 1.
- **Tower level `k`:** `perUnit` is one copy's counts (the seed's, with the substitution applied) and `multiplier` is `f^k` minus the copies removed by edits.
- The googolplex is BrCl₄₉₉Na₅₀₀ × 10^(10^100 − 3).

**Formula.** The Hill formula of `perUnit`:

- with carbon: C first, H second, then alphabetical; without carbon: all alphabetical;
- counts of 1 omitted.

For finite nodes it is the molecular formula (caffeine is C8H10N4O2). For towers it is one copy's formula followed by "× multiplier".

**Mass** is exact in micro-daltons:

- `massµDa = Σ_Z perUnit[Z] × µDa(Z) × multiplier`, where `µDa(Z) = ELEMENT_DATA[Z].mass × 10⁶` from `packages/core/src/elements.ts` (at most four decimals today, so exact).
- The element table is generated for Swift from the same file (`tools/apple/gen-elements.mts`), so both sides hold the same integers.
- Mass is derived data, never identity.

### 5.4 Formatting

One function, `format(M)`, prints every count on every surface: the HUD, plaques, trophies and the web. It works on the decimal digit string of `M` without ever forming it in full, using runs. For a tower base `f ≠ 10` it first applies the rules of §5.4.2.

#### 5.4.1 Decimal rules

Let `D` be the decimal digits of `M` (plain values are converted with an exact BigUInt-to-decimal routine), `len` their count, and `K = len − 1`. Apply the first rule that matches:

1. **Small.** `M < 10¹⁵`: all digits, with a comma every three from the right: `953,312`, `1,000,188,000`.
2. **Round.** `D` ends in a run of `z` zeros and has at most 15 significant digits (`len − z ≤ 15`). Let `c` be those digits. If `c = 1`, print `10^E(K)`. Otherwise print the mantissa (`c`'s first digit, then `.` and the rest when there is more than one) as `mantissa × 10^E(K)`: `2.5 × 10^20`, `1.000188 × 10^21`, `10^(10^100)`.
3. **Medium.** `len ≤ 24`: all digits, grouped: `1,234,567,890,123,456,789`.
4. **Near a round number.** Let `c15` be the first 15 digits, `t = len − 15` and `w = min(t, 15)`.
   Two forms are tried in this order. In both, the "middle" is digits 15 … `len − w − 1`, counted from zero at the most significant digit; it is empty when `t ≤ 15`, and an empty middle satisfies either test.
   - **4a. Plus.** If the middle digits are all 0, let `r` be the value of the last `w` digits. If `r > 0` and `c15` stripped of trailing zeros is below 10,000, print `head + r`. The head is `c15 · 10^t` formatted by rule 2 and `r` is grouped: `10^(10^100) + 5`.
   - **4b. Minus.** If the middle digits are all 9, let `r = 10^w − (value of the last w digits)` and `h = c15 + 1`. If `h = 10¹⁵`, set `h = 1` and `K = K + 1`. If `0 < r < 10¹⁵` and `h` stripped of trailing zeros is below 10,000, print `head − r` with head `h · 10^…` by rule 2: `10^(10^100) − 1,000`, `9 × 10^(10^100 − 1) − 1,000`.
5. **Approximate.** `≈ d.ddd × 10^E(K)`. The four digits are the leading digits rounded half to even on the exact digit string: round up when the fifth digit is above 5, or is 5 and any later digit is nonzero or the fourth digit is odd. If rounding reaches 10,000, it becomes 1,000 and `K = K + 1`: `≈ 1.235 × 10^24`.

**`E(k)`, the exponent:** plain digits with no separators when `k < 10¹⁵` (`10^100`, `2^70000`), otherwise `(` + `format(k)` + `)` (`10^(10^100 − 1)`). Spaces surround `×`, `+` and `−`; the minus sign is U+2212.

#### 5.4.2 Other bases

For a tower base `f ≠ 10` and `M ≥ 10¹⁵`:

1. If the digits are `c` followed by `z` zeros with `c < 10¹⁵`, print `c × f^E(z)`, or `f^E(z)` when `c = 1`. Water grown a hundred times is `3 × 2^100`.
2. Else, if `M` fits in 65,536 bits, convert it to plain and use §5.4.1.
3. Else take `c` as the value of the leading 16 base-`f` digits, `k` as the number of digits after them, move factors of `f` from `c` into `k`, and print `≈ c × f^E(k)`.

### 5.5 Approximate quantities [V]

Physical quantities derived from exact counts (kilograms, metres, magnification) and the feel functions of §10 need logarithms of huge Magnitudes:

- **`log10(M)`.** For a value of `len` digits in base `f` with leading digits `c` (16 of them), `log10(M) = (len − 16) · log10(f) + log10(c)`, in binary64 while `len < 2⁵³`.
- **`loglog10(M)`** is `log10(log10(M))`, computed from the bit length of `len` so it stays finite for every v1 value.
- **Scientific display** of a physical quantity is `≈ m × 10^E`, with the mantissa `m` in binary64 and the exponent `E` an exact integer taken from the Magnitude: the googolplex weighs `≈ 4.859 × 10^(10^100 − 26)` kg.
- **Tolerance:** relative 10⁻⁹ on mantissas, exact exponents.

---

## 6. LupiPack v1: the on-disk and wire unit [B]

A pack is an immutable, content-addressed bundle of node records. It is the unit the app bundles, the web build writes, the edge serves and the device caches. It replaces the flat colossus layout proposed in [million-atom-ar.md §5](research/million-atom-ar.md): what that layout held (Morton-ordered atoms, clusters, splats, exposure) is derived data computed from records (scale.md §4) and is not stored in a v1 pack.

### 6.1 Layout

- Offset 0: the 128-byte header (§6.2).
- Offset 128: the section table, `sectionCount × 32` bytes, which MUST end within the first 16,384-byte page.
- Every section starts on a 16,384-byte boundary, in table order, after the previous section's last page.
- All bytes between sections are zero, and the file length is a multiple of 16,384.
- 16 KiB is the page size of Apple silicon. A page-aligned section can be mapped with `mmap` and wrapped without a copy (`MTLDevice.makeBuffer(bytesNoCopy:…)`), and fetched with HTTP range requests.

### 6.2 Header

| Offset | Size | Field | Rule |
|---|---|---|---|
| 0 | 4 | magic | ASCII `LUPK` |
| 4 | 2 | versionMajor | 1 |
| 6 | 2 | versionMinor | 0 |
| 8 | 4 | headerSize | 128 |
| 12 | 4 | sectionCount | 2 to 16 |
| 16 | 8 | sectionTableOffset | 128 |
| 24 | 8 | fileLength | the exact file length, a multiple of 16,384 |
| 32 | 32 | contentId | SHA-256(`lupi.pack.v1` ‖ 0x00 ‖ every NodeID in NIDX order) |
| 64 | 32 | reserved | 0 |
| 96 | 4 | flags | 0 |
| 100 | 4 | tableCrc | CRC-32 of the section table bytes |
| 104 | 20 | reserved | 0 |
| 124 | 4 | headerCrc | CRC-32 of bytes 0 to 123 |

The contentId depends only on which records the pack holds, not on its layout: it is the pack's identity, its file name and its URL.

### 6.3 Section table entry (32 bytes)

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | type, four ASCII bytes |
| 4 | 4 | flags: bit 0 = required |
| 8 | 8 | offset, a multiple of 16,384 |
| 16 | 8 | length in bytes, without padding |
| 24 | 4 | CRC-32 of the section's bytes |
| 28 | 2 | sectionVersion, 1 |
| 30 | 2 | reserved, 0 |

### 6.4 Sections

**`NIDX`: the node index (required).**

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | `nodeCount`, 1 to 2²² |
| 4 | 4 | reserved, 0 |
| 8 + 48i | 32 | NodeID |
| 40 + 48i | 8 | record offset from the start of `NREC` |
| 48 + 48i | 4 | record length |
| 52 + 48i | 1 | kind, equal to the record's byte 4 |
| 53 + 48i | 1 | kindVersion, equal to the record's byte 5 |
| 54 + 48i | 2 | reserved, 0 |

- Entries are sorted strictly ascending by NodeID, so a lookup is a binary search.
- The section is exactly `8 + 48 × nodeCount` bytes.

**`NREC`: the records (required).**

- The records, in NIDX order, each starting at an offset that is a multiple of 8 within the section.
- Zero padding between records; no bytes after the last one.

**`ROOT`: named roots (required when present).**

| Field | Size |
|---|---|
| `rootCount` (1 to 4,096), reserved 0 | 4 + 4 |
| per root: NodeID, name length (u16), name, zero padding to a multiple of 4 | 32 + 2 + len + pad |

- Names are 1 to 64 bytes of `[a-z0-9._-]`, sorted strictly ascending by bytes.
- Every root is in this pack's NIDX.

**`DEPS`: dependencies (required when present).**

| Field | Size |
|---|---|
| `depCount` (1 to 256), reserved 0 | 4 + 4 |
| per dependency: the contentId of another pack | 32 |

Sorted strictly ascending; the section ends after the last id.

### 6.5 Writing a pack

A conforming writer produces identical bytes from the same records, roots and dependencies:

1. Sort the records by NodeID and drop exact duplicates. Two different records cannot share a NodeID.
2. Write sections in the order NIDX, NREC, then ROOT if there are roots, then DEPS if there are dependencies. Each has flags 1 and sectionVersion 1.
3. Place the first section at offset 16,384. Each section occupies `max(1, ⌈length / 16384⌉)` pages. The file ends at the end of the last section's last page.
4. Fill the header. `contentId` comes from the sorted NodeIDs, and the two CRCs are computed last: `tableCrc` first, then `headerCrc` over bytes 0 to 123.

v1 writers write no other sections.

### 6.6 Reading a pack

A reader MUST reject the pack (error `pack`, `crc`, `version`, `unsupported` or `mismatch`) unless all of these hold:

1. **Header.**
   - The magic is `LUPK` and `versionMajor` is 1. A `versionMinor` above 0 is accepted.
   - `headerSize` and `sectionTableOffset` are 128.
   - `fileLength` equals the file's length and is a multiple of 16,384.
   - `sectionCount` is in 2…16.
   - Reserved bytes and flags are zero.
   - `headerCrc` matches.
2. **Section table.**
   - `tableCrc` matches, and the table ends within the first page, followed by zeros.
3. **Each section.**
   - Its offset is page-aligned and not before the end of the previous section's pages.
   - Its bytes lie inside the file, and the rest of its last page is zero.
   - Its CRC matches.
   - No type appears twice.
   - An unknown type, or an unknown sectionVersion, is skipped when its required bit is clear and rejected when it is set.
4. **NIDX and NREC** are present.
   - NIDX's length is exact and its NodeIDs strictly ascend.
   - Records are packed in NIDX order at 8-byte alignment with zero padding, and NREC has nothing after the last record.
   - Each entry's kind and version match its record.
5. **Records.**
   - Every record's SHA-256 equals its NIDX NodeID before the record is used. Hashing every record at open time is allowed but not required; hashing on first use is enough.
   - Records of known kinds decode under §2; unknown kinds stay opaque.
6. **contentId** recomputed from NIDX equals the header's.
7. **ROOT and DEPS**, when present, follow §6.4.

### 6.7 How packs reference other packs and generators

- **NodeIDs are global.** A record in pack P may name a child, seed or base that lives in pack Q. P lists Q's contentId in DEPS so a resolver knows what to fetch. A resolver looks a NodeID up in every pack it has loaded; DEPS is a fetch hint, never a namespace.
- **Generators are records.** A crystal, tower or edit carries its whole definition, typically 40 to 200 bytes, and names no code. The algorithm is selected by kind and kindVersion (§3). So a procedural structure of any size is a single small record, and a trophy can embed it (§7) and never fetch anything.
- **Explicit structures** (gallery colossi, imports) are leaves and groups from `lupi.bake.partition@1`, packed whole.

### 6.8 Serving and caching

| Where | What |
|---|---|
| lupi.live | `GET /scale/p/<contentId hex>.lpk`: static assets written by the web build next to the OG cards and desk models. The response carries `Cache-Control: public, max-age=31536000, immutable`. HTTP range requests work because sections are page-aligned. |
| The app bundle | `lupi-scale-r1.lpk` (the salt ladder, copper, diamondoids; §12.6), plus the gallery leaves, which are also derivable from the bundled XYZ files. |
| On the device | `Caches/scale/<contentId hex>.lpk`. iOS may purge it, which is safe: a missing pack only shows its root's proxy until it is fetched again. |

---

## 7. `lupi.scale-ref.v1`: keeping any piece [B]

A **scale reference** names one piece (a node reached from a root by a path) so that it regenerates identically on any device, forever. Trophies, chips, fragments, slabs and grains are all scale references.

### 7.1 Binary layout

| Offset | Size | Field |
|---|---|---|
| 0 | 3 | ASCII `LSR` |
| 3 | 1 | version, 1 |
| 4 | 1 | flags: bit 0 = probe present; other bits 0 |
| 5 | 1 | `recordCount`, 0 to 255 |
| 6 | 1 | `depCount`, 0 to 255 |
| 7 | 1 | reserved, 0 |
| 8 | 32 | root NodeID |
| 40 | … | `recordCount` × (u32 length, record bytes): embedded records, sorted strictly ascending by NodeID |
| … | 32 × depCount | contentIds of packs that hold the other records, sorted strictly ascending |
| … | … | the path (§4.1), canonical |
| … | 32 | the probe, when flags bit 0 is set |

- The reference is at most 196,608 bytes, and nothing follows the probe.
- **Text form:** `lsr1:` followed by the base64url of the bytes.
- **refKey** = SHA-256(`lupi.scale.ref.v1` ‖ 0x00 ‖ rootID ‖ path bytes). It identifies the piece whatever is embedded: two references to the same piece have the same refKey even if one embeds a record that the other fetches.

### 7.2 Writing

- **Embedded records.** Writers SHOULD embed every generator record (crystal, tower, edit) and every leaf that is needed and not in a dependency pack. They SHOULD reference large explicit packs (gallery colossi) by dependency instead of embedding them.
- **The probe** is present exactly when the target is materializable (§4.5), and it is the target's probe.
- Typical sizes:

| Piece | Size |
|---|---|
| A gallery molecule, its leaf embedded: caffeine | 406 bytes (a 4,096-atom leaf: about 53 KB) |
| A leaf of `massive_1m`: root and pack by id, three `child` steps, probe | 115 bytes |
| The salt rung 10³: two records, empty path, probe | 260 bytes |
| A grain of the googolplex: two records, one tower step, probe | 496 bytes (§12.4) |

### 7.3 Resolving

1. Decode: canonical layout, sorted records and dependencies, canonical path, no trailing bytes.
2. Build a store from the embedded records plus the records of the listed packs that are available. Each embedded record's NodeID is its SHA-256.
3. Resolve the path from the root (§4.6).
4. The probe MUST be present exactly when the target is materializable. If present, it MUST equal the target's probe, otherwise the error is `mismatch`.
5. **When a dependency pack is missing**, the piece is not lost: the app shows the trophy from its cached aggregate (and plaque text) and fetches the pack. A missing generator record cannot happen when writers embed them.

### 7.4 In `lupi.trophy.v1` (amends contracts.md §1 before M1)

`MoleculeRef` gains one optional field and one source value. Both are additive, and nothing has shipped.

```swift
public enum MoleculeSource: String { case gallery, omol25, pubchem, built, fragment, scale }   // + scale

public struct ScaleRefField: Codable, Sendable, Hashable {
    public var schema: String      // "lupi.scale-ref.v1"
    public var ref: String         // "lsr1:…"
    public var count: String       // format(count), §5.4: a cache for plaques, re-checked on load
    public var spanMetres: Float   // longest displayed extent when kept, 0.005...3
}
// MoleculeRef.scale: ScaleRefField?
```

| `MoleculeRef` field | For `source: scale` |
|---|---|
| `sha256` | the refKey in hex |
| `formula` | the Hill formula of the per-unit composition (§5.3); a tower piece's formula is one seed copy's |
| `atoms` | the count when it is at most 2⁵³ − 1, else 2⁵³ − 1; `scale.count` is authoritative |
| `xyz` | MAY be embedded, as for fragments, when the piece is materializable and has at most 2,000 atoms |
| `scale` | required |

Other sources MAY also carry `scale`: a fragment of a gallery molecule is its leaf plus an `atoms` step.

On load, the app resolves `scale.ref`, recomputes `format(count)` and the formula, and treats a disagreement as a corrupt record. Every reference above fits under the account sync's 256 KiB payload bound (`docs/ar/account-and-sync.md` on the `ar/acct` branch).

### 7.5 In `lupi.shelf.v1`

- `ShelfPlacement.transform.scale` (metres per Å, a Float) cannot express a googolplex at 20 cm.
- A placement of a `scale` trophy therefore stores `scale = 0` and adds an optional `spanMetres` (Float). The app recomputes the frame from the resolved root's extent.
- Shelves stay on the device (D7).

---

## 8. Frames and the camera [V]

### 8.1 Spaces

| Space | What it is |
|---|---|
| world | ARKit world space, metres, y up. Kept in binary64 on the CPU. |
| node frame | every view's own coordinates, in units of `f^u` Å (§2.8): Å for leaves, crystals and groups; for a tower level, a unit in which its extents are a few periods |
| anchor | the one node per body that carries the body's world pose |

No position is ever absolute across levels. A point is named by a node (a root and a path) and local coordinates in that node's frame.

### 8.2 Placements: child into parent

| From → to | Map, `x_parent = s · R · x_child + t` |
|---|---|
| group child → group | `R(q)`, `t` from the record, `s = 1` |
| sub-box → box | `R = I`, `s = 1`, `t = 4(lo_child − lo_parent) × quarter / 65536` Å: an exact integer before the last division |
| level `k−1` child `j` → level `k` | `R = I`, `s = f^(u(k−1) − u(k))`, `t = j · p_axis(k) / 65536` |
| seed copy and seed, selection and its base, edit and its base | identity: they share one frame |

For a run of `r` equal digits `d` on axis `a`, the composed translation is a geometric series with a closed form, so composing a dive of 10¹⁰⁰ levels costs O(runs), not O(levels).

### 8.3 Body frames

```
BodyFrame {
  ref                   // the body's piece: root and path (§7)
  anchorPath            // a path from the body's node to its anchor A (often empty)
  worldFromAnchor       // rigid transform, binary64: rotation and translation in metres
  metresPerAnchorUnit   // σ_A, binary64
}
```

A point `x` in A's frame is at `worldFromAnchor(σ_A · x)` in the world.

### 8.4 Rebasing

Let `radius_m(X) = σ_X · r(X)`, where `r(X)` is X's bounding radius in X's units. The focus point F is, in order of preference:

1. the pinch centroid's hit on the body;
2. the screen-centre hit;
3. the camera position, when the camera is inside the body.

| Rule | Condition | Starting value |
|---|---|---|
| descend from A to its child C that contains F | `radius_m(C) ≥ R_desc`, or `radius_m(A) > R_cap` | `R_desc` = 16 m, `R_cap` = 10⁶ m |
| ascend from A to its parent | `radius_m(A) < R_asc` and A is not the body's node | `R_asc` = 8 m |
| steps per frame | at most 2 descents or ascents; a flight (§8.8) may append one whole run | |

A descent through placement `(s, R, t)` updates the frame:

```
worldFromC.rotation    = worldFromA.rotation · R
worldFromC.translation = worldFromA.translation + worldFromA.rotation · (σ_A · t)
σ_C = σ_A · s
```

An ascent applies the inverse. A rebase is a change of representation, not of state: no drawn vertex moves by more than 10⁻⁴ px across one (tested on Linux; the bound is §8.6's).

### 8.5 Eye-relative drawing

For every drawn item X, compose in binary64 and cast once:

```
modelToEye(X) = Float32( cameraFromWorld · worldFromAnchor · Scale(σ_A) · T(A ← X) )
```

- `T(A ← X)` is the composition of the placements from A down to X; for an item above A, the inverse chain.
- The GPU computes `p_eye = modelToEye(X) · p_X` in Float32, with `p_X` local to X (|p_X| ≤ r(X)).
- Items above the anchor are drawn only where they come within the far distance: a tower or crystal ancestor contributes its outer face planes (§9.4), never a far-away origin.
- RealityKit receives only room-sized transforms (bodies and face planes within metres of the camera).

### 8.6 Precision bound

Suppose every drawn item satisfies:

- (i) it lies within `z_far` = 20 m of the camera;
- (ii) it is no larger than its distance `d` from the camera (the cut refines anything larger);
- (iii) its anchor has `radius_m(A) ≤ 10⁶` m (rule `R_cap`).

Then its eye-space vertex error is at most `2⁻²³ (d + r) + 2⁻⁵⁰ × 10⁶ m ≤ 2.4 × 10⁻⁷ d + 10⁻⁹ m`. One pixel at distance `d` subtends about `d / 1,380` (the research's 1,380 px/rad, UNCONFIRMED per device). So the error is below **4 × 10⁻⁴ px** for every `d ≥ z_near` = 0.05 m, at every magnification and depth.

This is the relative-to-eye technique of virtual-globe engines ([Cozzi and Ring](https://www.virtualglobebook.com/); [Ohlarik](https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm)) applied once per level of a hierarchy.

### 8.7 Magnification and λ

- The magnification of a body is `σ_A × 10¹⁰ / f^u(A)` (metres per Å × 10¹⁰).
- Its decimal logarithm is `λ = log10(σ_A) + 10 − u(A) · log10(f)`.
- It is held as a pair, `u(A)` exactly and `log10 σ_A` in binary64, never as one binary64 once `u(A)` passes 2⁵³.
- Readouts print `10^λ` with §5.5's scientific form: "shown 10^(−3.333 × 10^99) times life size".

### 8.8 Pinch, detents and flight [P]

**Pinch.** Ratio `r` about the focus F scales the body:

```
worldFromAnchor.translation ← F + r · (translation − F)
σ_A ← r · σ_A
```

This is continuous and exactly invertible.

**Scale axis.** The gesture moves along `φ(λ)`:

```
φ(λ) = λ                                    for |λ| ≤ 32
φ(λ) = sign(λ) · 32 · (1 + ln(|λ| / 32))    otherwise     (C¹ at |λ| = 32)
```

- Within |λ| ≤ 32 (everything from life size to 10³²×), fingers map one to one.
- Beyond, a pinch moves φ, and a two-finger hold flies at up to 400 φ/s with 4 φ/s² easing. A googolplex at 30 cm sits near λ = −3.3 × 10⁹⁹, which is φ ≈ −7,300: about 20 s of flight from atoms to the whole bar.

**Detents** click at every decade while |λ| ≤ 32, at λ = 0 ("life size"), and at |λ| = 10ᵏ beyond.

**Flight.** Each frame appends at most one run per axis to the anchor path, toward F (§4.8).

**Comfort.** Still turns flight into cuts between detents; Gentle halves the flight speed.

---

## 9. Screen-space error and the cut [V]

### 9.1 The metric

The 3D Tiles screen-space error ([spec](https://github.com/CesiumGS/3d-tiles/blob/main/specification/README.adoc)) with each node's own scale:

```
K    = viewportHeight_px / (2 tan(fovY / 2))
ρ(X) = ε(X) · σ(X) · K / max(dist(X) − r(X) · σ(X), z_near)
```

- `ε(X)` is X's geometric error in X's units, and `σ(X)` is metres per X unit.
- X is **refined** while `ρ(X) > τ`. Once refined, it is **coarsened** only when `ρ(X) < τ / 2`.

### 9.2 Geometric error per view

What each view is drawn as when it is not refined, and the error of that stand-in. `r_atom` is the largest toy radius of its elements (`clamp(0.75 r_cov, 0.32, 0.90)` Å, plan §3.6).

A view is **solid** when it is a crystal box, a tower level whose seed is solid, or the seed copy of a solid seed. A solid seed is an open crystal box whose tower periods equal its extents (`p_a` = 4 · `n_a` · `quarter` along axis `a`), so its copies tile with no gaps.

| View | Stand-in when not refined | `ε` | Refined into |
|---|---|---|---|
| solid view | a box impostor: an oriented box, the aggregate colour, optional lattice shading | `r_atom` in Å (`r_atom / f^u(k)` in a level's units): a solid box is exact up to atom bumps, at every level | its atoms when materializable, else its octants or tower children |
| leaf, capped crystal, other copies, selection | up to 8 splat spheres fitted to its 64-atom clusters (consecutive in Morton order, derived data) | the radius of its largest 64-atom cluster | its atoms (final) |
| tower level `k`, other seeds | up to 8 splat spheres | `r(seed) / f^u(k)` | its `f` children |
| group | up to 8 splat spheres fitted to its children | `max(max ε(child), r(group) / 2)` | its children |

A body whose node is a leaf of at most 2,000 atoms always draws as its merged mesh (the M0 path), whatever ρ says.

Errors are monotone: `ε(parent) ≥ max ε(child)`, by construction for solid views and by the `max` for groups. A crystal or tower is therefore refined only where its atoms are bigger than τ pixels. Its cut is a ring of boxes around the eye, the geometry clipmap of terrain rendering ([Losasso and Hoppe 2004](https://hhoppe.com/proj/geomclipmap/)), whatever its count.

### 9.3 Budgets

Starting values for the iPhone 15 Pro (A17 Pro), **est.** Spikes S1 and S2 replace them with measurements.

| Budget | fair | serious | critical | iPad Pro (fair) |
|---|---|---|---|---|
| τ (px): start, and the controller's minimum (its maximum is 8) | 1.5, 1.0 | 1.5, 1.5 | 2.0, 2.0 | 1.5, 1.0 |
| nodes visited per frame | 8,192 | 6,144 | 4,096 | 12,288 |
| draw items | 4,096 | 3,072 | 2,048 | 8,192 |
| atoms drawn by RealityKit instancing (before LupiEngine) | 5,000 | 3,000 | 2,000 | 8,000 |
| atoms drawn by LupiEngine impostors (M3) | 150,000 | 75,000 | 50,000 | 250,000 |
| boxes and splats | 32,000 | 24,000 | 16,000 | 48,000 |
| leaf materializations per frame (background) | 8 | 4 | 2 | 12 |
| traversal and draw-list CPU | 1.0 ms | 0.8 ms | 0.6 ms | 1.0 ms |
| resident scale cache | min(192 MB, 10 % of `os_proc_available_memory`) | same | same, plus eviction | min(384 MB, 10 %) |

- **τ controller.** τ follows the measured molecule GPU time toward 8 ms: `τ ← clamp(τ · exp(0.5 (t − 8 ms) / 8 ms), τ_min, 8)`, evaluated each 0.5 s. `τ_min` is the thermal column's value.
- Frame rate is protected, and detail is what gets spent.

### 9.4 Where the traversal starts

For each body:

- **The anchor is the body's own node.** Start from it (the common case: anything smaller than the room).
- **The anchor is a crystal box or a tower level.** Start from the anchor's **index neighbourhood**: the 3 × 3 × 3 nodes at the anchor's level around it.
  - In a tower, a level-`k` node's index on axis `a` is the number formed by its digits on that axis above level `k`. Neighbours add ±1 to it, with carries and borrows through the digit runs, at O(runs) each.
  - In a crystal, the neighbours are the boxes at the anchor's octree depth that hold the cells just beyond its faces, found by descending from the crystal's root (at most 63 octants).
  - Neighbours outside the root are dropped: compare per-axis digit strings with the root's per-axis counts.
  - Add a **face plane** item for each outer face of the root within `z_far` of the camera. The distance to it is an exact integer from the digits, converted only when small.
  - The anchor is at least `R_asc` = 8 m in radius, so the neighbourhood covers everything within `z_far` of the camera that is not removed.
- **The anchor is inside a group.** Start from the group's children whose bounds come within `z_far` of the camera, at every group level from the anchor up to the body's node. Explicit groups nest only log₈ of their atom count deep (at most 9 for 10¹² atoms), and the visit budget caps the rest.
- **Removals** inside a starting node split it into its remaining children, at most 256 per edit.

### 9.5 The algorithm

```
buildCut(bodies, view, budgets, previousCut) → Cut:
  heap ← max-heap by ρ (ties: larger projected area first)
  for each body: push its starting nodes (§9.4)
  visited ← 0
  while heap not empty:
    X ← pop
    visited += 1
    if X is outside the frustum, or occluded by last frame's Hi-Z (LupiEngine only): continue
    wantRefine ← ρ(X) > τ, or (X was refined in previousCut and ρ(X) ≥ τ/2)
    if not wantRefine, or X is final, or visited ≥ budgets.visits:
       emit X as its stand-in (§9.2); continue
    kids ← children of X that are resident
       (crystal octants, tower children, group children; a materializable node's atoms)
    if kids are not all resident:
       request the missing ones (priority ρ); emit X as its stand-in; continue
    if emitting kids would exceed an item, atom or splat budget:
       emit X as its stand-in; continue
    push kids
  return the emitted items, with counts for the HUD (exact total, drawn, aggregated)
```

- Each pop costs O(1) except a tower child's path extension, which is O(runs) with tiny constants.
- No step depends on the atom count.

### 9.6 Fades, residency and loading

- **Fades.** An item entering or leaving the cut fades over 200 ms with a stable screen-door threshold (a hash of its refKey against the fade value), using `discard` and no blending. Atoms stay opaque and need no sort. Still comfort cuts instead.
- **Residency.** Decoded leaves and derived aggregates live in an LRU keyed by NodeID (or refKey for virtual nodes), capped by the resident budget.
  - Nodes that are bodies, or on a shelf, are pinned at their aggregate.
  - Materialized seed copies and crystal boxes are cheaper to regenerate than to store, so they are never written to disk.
- **Missing data draws the parent.** A missing child never leaves a hole.

### 9.7 Draw items

```
DrawItem {
  kind          // leafMesh | atomInstances | box | splats | facePlane | atomsGPU | clusterSplats
  node          // root + path, or a resident handle
  modelToEye    // Float32 3×4 (§8.5)
  fade          // 0…1
  key32         // low 32 bits of the refKey, for stable dithering and display jitter
  extras        // per kind: element runs for instances, half-extents and colour for a box, splat spheres
}
```

**Backends** (scale.md §4):

| Kind | Drawn by |
|---|---|
| `leafMesh` | RealityKit merged mesh (bodies with ≤ 2,000 atoms) |
| `atomInstances` | RealityKit `MeshInstancesComponent`, one per element colour |
| `box` | RealityKit instanced unit cube, one component per material |
| `facePlane` | RealityKit plane |
| `atomsGPU`, `clusterSplats`, `splats` | LupiEngine (M3); before it, `splats` draw as instanced spheres |

### 9.8 Guarantees (Linux tests)

1. No budget is exceeded, for any camera, over random roots from 10³ to a googolplex.
2. **Same footprint, same cost.** For the same on-screen footprint and camera, the visited and emitted counts of the 10⁹, 10¹⁰⁰ and googolplex salt rungs agree within ±10 %. For inside views at the same atom pixel size, the cut is identical for every rung that is deep enough.
3. No region is drawn at two levels, and no visible, unremoved region is missing (a coverage test on a sampled ray grid).
4. Monotone error holds for every view generated.
5. With ρ unchanged, hysteresis never flips an item twice in consecutive frames.

---

## 10. Physics and play [V, P]

### 10.1 Size states [P]

| State | When | Physics |
|---|---|---|
| toy | longest span ≤ 3 × its spawn span (spawn spans 15 cm) | dynamic body |
| monument | span up to 3 m | kinematic; up to 256 static shapes; other bodies land on it |
| terrain | span over 3 m (at most one at a time) | static. A collision window of radius 2 m around the camera and each dynamic body holds up to 256 shapes. It is rebuilt (asynchronously) when its centre moves 0.5 m, at most twice a second, plus an analytic plane for each outer face of a box ancestor within the window. When the camera is inside solid material, atoms within 0.35 m of the camera are not drawn (an excavation bubble). |

### 10.2 Felt mass: `lupi.feltmass.v1` [V]

RealityKit "works best if the size and mass ratios don't exceed one order of magnitude" (plan §3.4). Felt mass therefore stays in [0.06, 0.6] kg and keeps the true order of masses to a googolplex and beyond. With M the exact mass in Da (§5.3):

```
M_k = 180 · 2^2.5 Da (≈ 1,018 Da);   a = 0.8 · ln(M_k) (≈ 5.541)
b(M) = 0.2 · (M / 180)^0.4                                   for M ≤ M_k    (plan §4.2, unchanged)
b(M) = 0.6 − 0.2 / (1 + a · (ln ln M − ln ln M_k))           for M > M_k    (C¹ at M_k)
massKg = clamp(b(M) · massScale, 0.06, 0.6)                    massScale from the personality
```

- `ln ln M` comes from §5.5, so it is finite for every Magnitude.
- **Below about 1 kDa nothing changes** from the plan: water 0.080, caffeine 0.206, C₆₀ 0.348 before `massScale`.
- **Above it**, mass rises slowly instead of hitting the ceiling at 2.8 kDa:

| Structure | `b` (kg) |
|---|---|
| hemoglobin | 0.544 |
| salt 10³ (29,264 Da) | 0.537 |
| salt 10⁶ | 0.567 |
| salt 10⁹ | 0.575 |
| salt 10³⁰ | 0.586 |
| salt 10¹⁰⁰ | 0.590 |
| googolplex | 0.5998 |

LupiKit's `GameUnits` uses a different curve (50 g × (M/18)^0.4, up to 100 kg, growing with display scale). It MUST be replaced by this function, and contracts.md §3.3 rule 6 points here.

### 10.3 Inertia [V]

- **Leaf:** point-mass principal moments and axes, as LupiKit's `Inertia` (port of `objectFacts/inertia.ts`).
- **Crystal box:** the closed form for a uniform grid: `Cov = Cov(cell) + Σ_a ((e_a² − 1) / 12) · v_a v_aᵀ`, with `v_a` the cell vector of axis a and `e_a` the cell count.
- **Tower level `k`:** `Cov = Cov(seed) + Σ_a ((n_a² − 1) / 12) · p_a p_aᵀ`, with `n_a = f^C(a,k)`, normalized by the level's radius. The three `n_a` of one level differ by a factor of 1 or `f`, so the normalized tensor stays well within binary64 for every `k`, including a googolplex.
- **Group:** the parallel-axis theorem over children.
- The inertia is `I = M (tr(Cov) E − Cov)`, and the body uses the shape tensor `I / (M r²)` times felt mass times display radius², with the smallest principal moment floored at 0.02 of the largest (plan §4.2).

### 10.4 Collision proxies [V]

| Node | Proxy |
|---|---|
| leaf, capped crystal, copy, selection | plan §3.4: one sphere per heavy atom at toy radius, each hydrogen folded into its partner (+15 % radius each), grid-merged to at most 48 spheres |
| box, or tower level with orthogonal periods | one box (`ShapeResource.generateBox`) of the node's extents plus `r_atom`. Stacks hold on it. |
| tower level with oblique periods | the convex hull of its 8 corners (`generateConvex`) |
| group | children's bounding spheres; split the largest into its own proxy until 64 shapes, or every sphere is under 8 % of the group radius |
| edit | the proxy of the remaining children; holes smaller than 1/8 of the node are ignored |

Proxies are cached by NodeID or refKey together with a quantized `σ`.

### 10.5 Picking and the hand band [P]

**Picking.** A touch ray is tested against the current cut:

1. a BVH over draw items;
2. then the item's own shapes, so the box of a box item, or up to 64 atoms of a leaf, adjusted by the display-motion twin;
3. then refinement along the hit, down to the deepest node the ray hits, so the result is a hit chain.

The hit costs tens of µs (est.).

**Grab** takes the body when its span is at most 40 cm. Otherwise it takes the deepest node on the hit chain whose displayed diameter is 4 to 40 cm (the hand band), detached as a chip (§10.6).

### 10.6 Breaking and chipping [P]

**Threshold.** A body breaks when an impact's Δv reaches `base(personality) · sqrt(E / 346 kJ/mol)` (plan §4.4). E is the bond energy for leaves, and the interface class for anything larger (game values: covalent 346, coordination 150, ionic contact 80, lattice-ionic 60, noncovalent 40).

**Expanding a body** makes up to `B` = min(16, 41 − dynamic bodies) pieces:

| Node | Pieces |
|---|---|
| a leaf molecule, at most 2,000 atoms, with a bridge in the game graph | plan §4.4: cut the weakest-class bridge nearest the contact; each component is a selection |
| a leaf with no breakable bridge (cages, crystals): at most 64 heavy atoms | chip: the heavy atom nearest the contact, with its hydrogens |
| a leaf with no breakable bridge: more than 64 heavy atoms | split into up to 8 selections by octant around its bounding-box centre |
| one-cell box | its atoms, as loose atoms for building (D9) |
| box with octants, tower level, group | its children: octants, the `f` children of a level (the googolplex bar breaks into ten cubes of 10^(10^100 − 1) atoms), or a group's children. When there are more than `B`, the `B − 1` children nearest the contact become pieces and the rest stays as one edit. |

- Each piece is a scale reference (the parent's path plus one step) with the parent's velocity at that point plus 0.4 m/s of separation.
- A fresh piece cannot break again for 0.25 s.
- A piece's identity is exact even though the contact point is not: the play input picks the step, and the step is exact (scale.md law 3).

**Chipping** (a pinch-pull at the surface) detaches the node under the finger whose displayed diameter is 1 to 5 cm.

- The chip is its path.
- The remainder is the parent minus it: a selection of the complement when the parent is materializable, otherwise an edit.
- An edit already holding 256 removals refuses: "this one is full".
- A trophy's record is never destroyed by play (plan §4.4).

### 10.7 Building and growing [P]

- **Snap** (plan §4.5) joins atoms into a new leaf. Atom order: the larger body's atoms first, then the other's, each in its own order. Its record is embedded in the trophy's reference, so its identity is whatever the app built; there is nothing to agree on across languages.
- **Grow ×2** (proposed; the owner to confirm) wraps a body of unit exponent 0 in a tower:
  - `f = 2`;
  - periods on the diagonal equal to the body's extent plus 2 × 0.9 Å plus 0.5 Å, rounded up to Q16;
  - one more level per tap (a new record each time).
  - Water grown a hundred times is `3 × 2^100` atoms (§12.4), as cheap as one water.
- **Glue** of arbitrary bodies into a group is reserved and not in v1.

### 10.8 Heft: sound and haptics [P]

`h = log10(1 + log10(M / 1 Da))`. Values: water 0.35, C₆₀ 0.59, salt 10⁶ 0.93, salt 10⁹ 1.06, salt 10¹⁰⁰ 2.01, googolplex 100.

| Channel | Starting value |
|---|---|
| sub-bass layer gain | `clamp((h − 0.9) / 2, 0, 1)` |
| pitch factor (with plan §5.2's size factor) | `0.85^(min(h, 4) − 0.6)` |
| haptic tail | `40 ms × (1 + min(h, 4))` |

The googolplex lands lowest and longest, and a googol is still audibly different from a billion.

---

## 11. API surfaces

The two implementations expose the same names. `packages/core` gains the export `"./scale": "./src/scale/index.ts"`.

### 11.1 Swift: `apps/apple/LupiScale`

A Swift package (tools 6.0, Swift 6 language mode, Foundation only, iOS 26 and macOS 26) with two library targets:

- **`LupiScaleCore`** has no dependencies and holds everything marked [B].
- **`LupiScale`** depends on it and on LupiKit's `LupiChem` (element table, bond perception, graph cuts) through `.package(path: "../LupiKit")`.

Tests run on Linux with `swift test`.

```swift
// LupiScaleCore
public struct NodeID: Hashable, Comparable, Sendable { public let bytes: [UInt8] }       // 32 bytes
public struct BigUInt: Hashable, Comparable, Sendable { /* ≤ 65,536 bits; add, sub, mulSmall, divSmall, decimal */ }
public enum NodeKind: UInt8, Sendable { case leaf = 1, group, crystal, tower, edit }
public struct LeafNode: Sendable, Hashable { public var atomicNumbers: [UInt8]; public var positions: [SIMD3<Float>] }
public struct GroupChild: Sendable, Hashable { public var id: NodeID; public var rotation: SIMD4<Double>; public var translation: SIMD3<Double> }
public struct CrystalNode: Sendable, Hashable {
    public enum Structure: UInt8, Sendable { case sc = 1, bcc, fcc, diamond, rocksalt }
    public enum Termination: UInt8, Sendable { case open = 0, closed, capped }
    public var structure: Structure; public var termination: Termination
    public var speciesA: UInt8; public var speciesB: UInt8; public var quarterQ16: UInt32
    public var cells: SIMD3<UInt64>; public var capZ: UInt8; public var capOffsetQ16: UInt32
}
public struct TowerNode: Sendable, Hashable {
    public var seed: NodeID; public var factor: UInt8; public var periodsQ16: [SIMD3<Int64>]   // 3
    public var levels: BigUInt; public var substitution: Substitution?
}
public struct EditNode: Sendable, Hashable { public var base: NodeID; public var removed: [Path] }
public enum Node: Sendable, Hashable { case leaf(LeafNode), group([GroupChild]), crystal(CrystalNode), tower(TowerNode), edit(EditNode) }
public struct NodeRecord: Sendable, Hashable {
    public let bytes: [UInt8]; public let id: NodeID; public let node: Node?        // nil: unknown kind (opaque)
    public init(_ node: Node) throws                                               // encode (§2)
    public init(bytes: [UInt8]) throws                                             // decode + validate (§2)
}
public enum Step: Sendable, Hashable {
    case child(UInt16), cells([UInt8]), tower(levels: BigUInt, runs: [[DigitRun]]), atoms([AtomRange])
}
public struct Path: Sendable, Hashable { public var steps: [Step]
    public init(canonicalizing steps: [Step]) throws; public init(bytes: [UInt8]) throws; public var bytes: [UInt8] { get } }
public struct Magnitude: Sendable, Hashable, Comparable {                         // §5
    public init(_ value: BigUInt); public static func tower(seedCount: BigUInt, factor: UInt8, levels: BigUInt) -> Magnitude
    public static func + (a: Magnitude, b: Magnitude) -> Magnitude; public static func - (a: Magnitude, b: Magnitude) throws -> Magnitude
    public var formatted: String { get }; public var log10: Double { get }; public var logLog10: Double { get }
}
public protocol NodeStore: Sendable { func record(_ id: NodeID) throws -> NodeRecord }
public struct View: Sendable { /* leaf | group | box | capped | level | copy | selection, with pending removals */ }
public struct Resolver: Sendable {
    public init(store: NodeStore)
    public func root(_ id: NodeID) throws -> View
    public func step(_ view: View, _ step: Step) throws -> View
    public func resolve(_ id: NodeID, _ path: Path) throws -> View
    public func count(_ view: View) throws -> Magnitude
    public func composition(_ view: View) throws -> Composition                    // perUnit + multiplier
    public func isMaterializable(_ view: View) -> Bool
    public func materialize(_ view: View) throws -> LeafNode
    public func probe(_ view: View) throws -> NodeID
}
public struct ScaleRef: Sendable, Hashable {
    public var root: NodeID; public var records: [NodeRecord]; public var dependencies: [NodeID]
    public var path: Path; public var probe: NodeID?
    public init(bytes: [UInt8]) throws; public init(text: String) throws
    public var bytes: [UInt8] { get }; public var text: String { get }; public var key: NodeID { get }   // refKey
    public func resolve(extra: NodeStore?) throws -> (view: View, count: Magnitude)
}
public struct LupiPack: Sendable {
    public static func write(records: [NodeRecord], roots: [(String, NodeID)], dependencies: [NodeID]) throws -> [UInt8]
    public init(bytes: [UInt8]) throws                                             // §6.6 conformance
    public let contentID: NodeID; public let roots: [(String, NodeID)]; public let dependencies: [NodeID]
}
extension LupiPack: NodeStore {}
public enum Partition { public static func bake(atomicNumbers: [UInt8], positions: [SIMD3<Float>]) throws -> (records: [NodeRecord], root: NodeID) }
public enum SHA256 { public static func hash(_ bytes: [UInt8]) -> [UInt8] }
public enum CRC32 { public static func checksum(_ bytes: [UInt8]) -> UInt32 }
public struct SplitMix64 { public init(seed: UInt64); public mutating func next() -> UInt64 }

// LupiScale
public struct Aggregate: Sendable { /* bounds, geometricError, splats, colour, shape tensor, count, massMicroDa */ }
public struct BodyFrame: Sendable { public var ref: ScaleRef; public var anchorPath: Path
    public var worldFromAnchor: RigidD; public var metresPerAnchorUnit: Double }
public struct ViewState: Sendable { public var cameraFromWorld: RigidD; public var fovY: Double; public var viewportHeight: Int
    public var zNear: Double; public var zFar: Double }
public struct Budgets: Sendable { public var tau: Double; public var visits, items, instancedAtoms, engineAtoms, boxesAndSplats, materializations: Int
    public var residentBytes: Int; public static func iPhone15Pro(_ thermal: ThermalLevel) -> Budgets }   // fair, serious, critical
public struct Cut: Sendable { public var items: [DrawItem]; public var totalAtoms: Magnitude; public var drawnAtoms: Int; public var visited: Int }
public func rebase(_ frame: inout BodyFrame, focusWorld: SIMD3<Double>, resolver: Resolver) throws
public func buildCut(bodies: [BodyFrame], view: ViewState, budgets: Budgets, previous: Cut?, resolver: Resolver) -> Cut
public func pick(ray: RayD, cut: Cut, handBand: ClosedRange<Double>, resolver: Resolver) -> PickResult?
public func collisionProxy(for view: View, metresPerUnit: Double, maxShapes: Int, resolver: Resolver) throws -> [CollisionShape]
public func feltMass(massMicroDa: Magnitude, massScale: Double) -> Double                       // §10.2
public func expand(_ body: BodyFrame, contactWorld: SIMD3<Double>, budget: Int, resolver: Resolver) throws -> BreakPlan
public func grow(_ body: BodyFrame, resolver: Resolver) throws -> NodeRecord                    // §10.7
```

Types named but not spelled out (`DigitRun`, `AtomRange`, `Substitution`, `Composition`, `RigidD`, `RayD`, `DrawItem`, `PickResult`, `CollisionShape`, `BreakPlan`) follow the sections cited next to their use.

### 11.2 TypeScript: `packages/core/src/scale`

| File | Holds |
|---|---|
| `bytes.ts` | Writer and Reader, BigUInt as `bigint` |
| `hash.ts` | SHA-256 in pure TypeScript (synchronous; `crypto.subtle` is asynchronous), CRC-32, SplitMix64 |
| `records.ts`, `crystal.ts`, `tower.ts`, `edit.ts`, `partition.ts` | §2 and §3 |
| `paths.ts`, `resolve.ts` | §4 |
| `magnitude.ts`, `composition.ts` | §5 |
| `pack.ts` | §6 |
| `ref.ts` | §7 |
| `cut.ts`, `frames.ts` | §8 and §9, for the web viewer later |
| `index.ts` | the exports below |
| `__fixtures__/scale-v1.json` | written by `pnpm exec tsx packages/core/scripts/write-scale-fixtures.mts` |

```ts
export type NodeID = Uint8Array;                                    // 32 bytes
export function nodeId(record: Uint8Array): NodeID;
export function encodeRecord(node: Node): Uint8Array;
export function decodeRecord(record: Uint8Array): DecodedRecord;    // throws ScaleError(code)
export function encodePath(steps: Step[]): Uint8Array;              // canonical only
export function canonicalPath(steps: Step[]): Step[];
export function decodePath(bytes: Uint8Array): Step[];
export class Resolver {
  constructor(store: NodeStore);
  root(id: NodeID): View; step(view: View, step: Step): View; resolve(id: NodeID, path: Step[]): View;
  count(view: View): Magnitude; composition(view: View): Composition;
  isMaterializable(view: View): boolean; materialize(view: View): Leaf; probe(view: View): NodeID;
}
export function formatMagnitude(m: Magnitude): string;
export function writePack(records: Uint8Array[], opts?: { roots?: { name: string; id: NodeID }[]; deps?: NodeID[] }): Uint8Array;
export function readPack(bytes: Uint8Array): Pack;                  // §6.6 conformance
export function encodeRef(ref: ScaleRef): Uint8Array; export function decodeRef(bytes: Uint8Array): ScaleRef;
export function refText(bytes: Uint8Array): string; export function refKey(root: NodeID, path: Uint8Array): NodeID;
export function resolveRef(bytes: Uint8Array, extra?: NodeStore): { view: View; count: Magnitude };
export function bakePartition(z: Uint8Array, positions: Float32Array): { records: Uint8Array[]; root: NodeID };
export function buildCut(bodies: BodyFrame[], view: ViewState, budgets: Budgets, previous?: Cut): Cut;   // later, for the web
```

The web viewer adopts the same data in its own time: `BillionAtomBlock` becomes the copper crystal record and its hand-tuned tiers fall out of `buildCut`, `AtomsOptimized` draws materialized leaves, and `lupi.status` reports counts with `formatMagnitude`.


---

## 12. Test vectors [B]

Everything below was computed with a scratch implementation of §1–§7 while this spec was written. The rows §0 lists were re-derived by a separately written Swift program (its own SHA-256, CRC-32, SplitMix64, BigUInt and generators) and matched exactly. The TypeScript implementation MUST reproduce all of them before writing `scale-v1.json`. The fixture file also carries every intermediate (all twelve diamondoids, all ladder rungs, the pack bytes) for the Swift tests.

Hex is lowercase; NodeIDs are SHA-256 in hex.

### 12.1 Primitives

| Vector | Value |
|---|---|
| CRC-32 of the ASCII bytes `123456789` | `cbf43926` |
| SplitMix64, seed 0, first three outputs | `0xe220a8397b1dcdaf`, `0x6e789e6aa1b965f4`, `0x06c45d188009454f` |
| SplitMix64, seed `0x0123456789abcdef`, first three outputs | `0x157a3807a48faa9d`, `0xd573529b34a1d093`, `0x2f90b72e996dccbe` |
| BigUInt encodings of 0, 1, 255, 256 and 10^100, concatenated | `00000100010100ff020000012a00000000000000000000000000108f2ea80843b2aa7c1a218e40ce8af30bcec484270beb7cc39425ad4912` |

### 12.2 Leaves from gallery files (parsed by the web parser, file order, Float32)

| Source | Atoms | Record bytes | NodeID |
|---|---|---|---|
| `apps/web/public/gallery/curated/popular/water.xyz` | 3 | 56 | `8985f649ff0866084daa120d8b4a02db7124823d408d32487a63bb870b3a553a` |
| `…/popular/caffeine.xyz` | 24 | 328 | `54c3bbfb50de8c1f7a11af255980822b2be57d1eff18908046ccabee382fcc84` |

The water record in full (CRC-32 `91dd48b2`):

```
4c55504e010100002c0000000300000008010100000000000000000000000000
5f078e3e1895643fb840823e3f571b3fea0474bec28637bf
```

### 12.3 Crystals

The salt seed: rock salt, open, Na/Cl, `quarter` 92,409 (a = 5.64019 Å), 5 × 5 × 5 cells, 1,000 atoms.

```
4c55504e030100002800000005000b11f9680100050000000000000005000000
0000000005000000000000000000000000000000
```

- NodeID `2ef8502fcd22e4b098c57e85c0bd1b6793ff8be13f9b330d0017f1c9561e3f3e`.
- Its materialized leaf (box [0, 5)³): NodeID `1c017d69dbee61f3a8057626855ca149bec10e10bfbac66014c63871dd8d36e2`.
- The first nine atoms of that box, as (Z, x, y, z) in Q16: (11, 0, 0, 0), (11, 0, 184818, 184818), (11, 184818, 0, 184818), (11, 184818, 184818, 0), (17, 184818, 0, 0), (17, 0, 184818, 0), (17, 0, 0, 184818), (17, 184818, 184818, 184818), (11, 369636, 0, 0).

| Crystal | Record (hex) | NodeID | Atoms |
|---|---|---|---|
| Cu FCC, open, 630³ cells (the web's `BillionAtomBlock`) | `4c55504e030100002800000003001d005ce700007602000000000000760200000000000076020000000000000000000000000000` | `42e22db697e0f938556fc8249e423ed986daa0c0ec08aa391afa67d4ad3cf421` | 1,000,188,000 |
| Cu FCC, closed, 630³ | `4c55504e030100002800000003011d005ce700007602000000000000760200000000000076020000000000000000000000000000` | `3d6fb40fa20087ff857d0c2d48dc1801cf55a388c840a8a566306fd7d9942911` | 1,002,571,291 |
| Cu FCC, open, 63³ | `4c55504e030100002800000003001d005ce700003f000000000000003f000000000000003f000000000000000000000000000000` | `13bc69957235914287d68a9bed1a136158811dc35db3fbed45cfe415d5867bdf` | 1,000,188 |
| Cu FCC, closed, 10³ | `4c55504e030100002800000003011d005ce700000a000000000000000a000000000000000a000000000000000000000000000000` | `5dc6df08fa5c36d6e1f2c39333933582ce2535bdb1b38c6dad2942d9d51601ee` | 4,631 |

Diamond, closed, 2³ cells (`quarter` 58,438): 95 atoms; crystal NodeID `6da1979dc30edc1232a92f59966899f376a2976bd8e8cfb491fb99f315c4804e`; leaf NodeID `9c58417edf7741fbf248f333c14e3aa6859e3c18d101e2191b1a61da220abd77`.

**Capped diamondoids** (diamond, `capped`, C/H, `quarter` 58,438, `capOffset` 41,243, which puts H at 1.0900 Å). Adamantane's record:

```
4c55504e03010000280000000402060046e40000010000000000000001000000
000000000100000000000000010000001ba10000
```

Its first six atoms (Z, x, y, z in Q16): (6, 116876, 116876, 0), (1, 158119, 75633, -41243), (1, 75633, 158119, -41243), (6, 58438, 58438, 58438), (1, 17195, 17195, 17195), (6, 175314, 175314, 58438).

| m | Formula | Atoms | Crystal NodeID | Leaf NodeID |
|---|---|---|---|---|
| 1 | C<sub>10</sub>H<sub>16</sub> | 26 | `52c36dc60407419030601a1ec30bddfbafa0867faaaf0699e79cd982129263eb` | `f74c5d0693dd6421a23fb664f7da9ba5af74e2d2cadfd997c63e22cce5fb9502` |
| 2 | C<sub>35</sub>H<sub>36</sub> | 71 | `0b45c04d5fd7f2a9e8527a5ade8f7f5dc6723b7756ca082fc261179ec003f45a` | `78b0fb8f73a87c45a72354a1438297a28c12af6ce510a2439119b17d7c49bc63` |
| 3 | C<sub>84</sub>H<sub>64</sub> | 148 | `7353efe571661aad03ddab352cc8c039172e10b910ca24c5925ff72f202dfcef` | `117d3d50457ca5655a76395d968c9fe219fea0474fe7bde6671efe28197f52b8` |
| 4 | C<sub>165</sub>H<sub>100</sub> | 265 | `2574a5846d192f258b549e0f0775f509604c8b9c50bb021cf781c7fb457080b9` | `fdfeb39413d49705d0aa9eb31bc99315baeb280cbc57e70f5bcf01c2cd43d380` |
| 5 | C<sub>286</sub>H<sub>144</sub> | 430 | `15d49908cb3caa4b80167cb0cd51b54791fb860c2431ad6315d227c2220c6e01` | `5c90b6e191e7c9398b6d913932c7c92e3f03f57d41d1555739e4b4ac6615df89` |
| 6 | C<sub>455</sub>H<sub>196</sub> | 651 | `17004b5a55c0315069a2ba6de9882ed905e55a2f5fb12abfe989d6ad75e99856` | `d82b7ad03faa34bbff44391d480d23e0b75010c9992da711b698f80b857b3dc6` |
| 7 | C<sub>680</sub>H<sub>256</sub> | 936 | `a0542377bd2af58fe0192486fcd45f7d993913c2b1fec97e0bc03cc484e4d168` | `c8657a51966d01c26b38b38fa87d3d0e034f9d10c1cef5729c853d998efd6692` |
| 8 | C<sub>969</sub>H<sub>324</sub> | 1,293 | `064114ca4eb32256c75269d15c3fbdd54625247c379af0ab2bcf14c17963123c` | `beb780100b08c5329a7955eb66df0593f979749e5b964dfbf56d1758f55cc01a` |
| 9 | C<sub>1330</sub>H<sub>400</sub> | 1,730 | `9b61ceda5193bbaef3b248c8d6ac2bafd8115d24231d900eb3efa55b3c8e7b14` | `8be36eec9808dcfdf3ee9f21a9e525fc9649ad1567a89363e9aca6807e8b66a8` |
| 10 | C<sub>1771</sub>H<sub>484</sub> | 2,255 | `3969240b4d7444ba2b6ebaf0e6067e298aab7c2fb87833476594b1c683b9571b` | `1a43a4efe3a9a2c40cce5870efccd43b9e225aafb793daa6c276d19e01809c3a` |
| 11 | C<sub>2300</sub>H<sub>576</sub> | 2,876 | `12b3efdff68034a3d86a30b92d21a42c5915b6f3ca28478aa31b0d8e2f417f77` | `f0c65fb8573710eeca766444799faafc4bab340190da07f77471ca52eb041228` |
| 12 | C<sub>2925</sub>H<sub>676</sub> | 3,601 | `f4d037ff369dc1e509ae78c3d922f244f0b41a628aaa1cc64d69c9db731c1778` | `a58f2906169bd197fb51a4b19dae430a3f5a6b304c5880f6ebe7d99e3c8a5acc` |

### 12.4 Towers: the salt ladder

Seed: the salt seed above. Factor 10; periods (1,848,180, 0, 0), (0, 1,848,180, 0), (0, 0, 1,848,180) in Q16 (28.2 Å, five cells); substitution Cl → Br, one per copy.

| Rung | `levels` | Record bytes | NodeID | Count | Seed copies per axis (exponents of 10) |
|---|---|---|---|---|---|
| 10³ | 0 | 126 | `1349a66011dc8c606efe01fb2b56362637560b205c37a0e87040041bc8933eb3` | 1,000 | 0, 0, 0 |
| 10⁶ | 3 | 127 | `cd481a1353e063838be8fc0c55f420b977465a8f1db3e959460aaa34ac4b8df8` | 1,000,000 | 1, 1, 1 |
| 10⁹ | 6 | 127 | `8244914ffbe1dc2ef6fcc9d3d4dd33c7f904d8c9b06c6f760fa8224dd6244e27` | 1,000,000,000 | 2, 2, 2 |
| 10³⁰ | 27 | 127 | `acf0aa4a9271023dff67a256fcfcd5993f767ccf3ded32b0bbd3995765fffc3f` | 10^30 | 9, 9, 9 |
| 10¹⁰⁰ (googol) | 97 | 127 | `b6ea59ba7442ec18a606dffa157dba6bda89dbad3b27d427b24cef47012c167e` | 10^100 | 33, 32, 32 |
| 10^(10^100) (googolplex) | 10^100 − 3 | 168 | `a10e2103622970045012eb530843be4ef0a080b1c21e5265e294cb440c3e5759` | 10^(10^100) | (10^100 − 1)/3, (10^100 − 4)/3, (10^100 − 4)/3 |

The googolplex record in full:

```
4c55504e040100009c0000002ef8502fcd22e4b098c57e85c0bd1b6793ff8be1
3f9b330d0017f1c9561e3f3e0a01000074331c00000000000000000000000000
0000000000000000000000000000000074331c00000000000000000000000000
0000000000000000000000000000000074331c00000000002a00fdffffffffff
ffffffffffff0f8f2ea80843b2aa7c1a218e40ce8af30bcec484270beb7cc394
25ad491211230100
```

The 10³ rung has `levels` 0, so it is its own seed copy: copy key `0x5a39d7642495b059` (from empty step bytes), Br at atom 836, probe `c5e72c9b3e1f4e05ade222824419e94114144d25015da1398e2f8ef437f2bfb8`.

**The first copy** of the googolplex (every digit 0), its path:

```
0100032a00fdffffffffffffffffffffff0f8f2ea80843b2aa7c1a218e40ce8a
f30bcec484270beb7cc39425ad49120100002a00555555555555555555555555
05850f385816e638d4080bda6aefd8fb039a412c0d594ed4eb860c8f18060100
002a0054555555555555555555555505850f385816e638d4080bda6aefd8fb03
9a412c0d594ed4eb860c8f18060100002a005455555555555555555555550585
0f385816e638d4080bda6aefd8fb039a412c0d594ed4eb860c8f1806
```

- Copy key `0xd2821aef089f3b51`; Br replaces atom 764; probe `a4b81f1ada35de728dc1bc0e662d22e58d43c281bbc27e1662279dd639c30663`.

**The grain**: the seed copy at the middle of the top face of the googolplex bar (x digits 5 then 0, y digits all 9, z digits 5 then 0):

```
0100032a00fdffffffffffffffffffffff0f8f2ea80843b2aa7c1a218e40ce8a
f30bcec484270beb7cc39425ad4912020005010001002a005455555555555555
5555555505850f385816e638d4080bda6aefd8fb039a412c0d594ed4eb860c8f
18060100092a0054555555555555555555555505850f385816e638d4080bda6a
efd8fb039a412c0d594ed4eb860c8f1806020005010001002a00535555555555
55555555555505850f385816e638d4080bda6aefd8fb039a412c0d594ed4eb86
0c8f1806
```

- Copy key `0x9df8af3f7edb268e`; the first SplitMix64 output for that key is `0xe7ad625697864313`; Br replaces atom 639.
- Probe (NodeID of the grain's leaf) `449611ace7889516d11722ee8da078a5e4b697c89e4ef7854dd9118497df80ad`; count 1,000.
- Its `lupi.scale-ref.v1` with both records embedded is 496 bytes; refKey `ebfdf60d1a694e092141c1c6d2838e2af7e7194f711e66855110a0186ce7ad1d`. Text form:

```
lsr1:TFNSAQECAAChDiEDYilwBFAS61MIQ75O8KCAscIeUmXilMtEDD5XWTQAAABMVVBOAwEAACg
AAAAFAAsR-WgBAAUAAAAAAAAABQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAqAAAAExVUE4EAQAAnAA
AAC74UC_NIuSwmMV-hcC9G2eT_4vhP5szDQAX8clWHj8-CgEAAHQzHAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAdDMcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB0MxwAAAAAACoA_f_
_____________D48uqAhDsqp8GiGOQM6K8wvOxIQnC-t8w5QlrUkSESMBAAEAAyoA_f_________
_____D48uqAhDsqp8GiGOQM6K8wvOxIQnC-t8w5QlrUkSAgAFAQABACoAVFVVVVVVVVVVVVVVBYU
POFgW5jjUCAvaau_Y-wOaQSwNWU7U64YMjxgGAQAJKgBUVVVVVVVVVVVVVVUFhQ84WBbmONQIC9p
q79j7A5pBLA1ZTtTrhgyPGAYCAAUBAAEAKgBTVVVVVVVVVVVVVVUFhQ84WBbmONQIC9pq79j7A5p
BLA1ZTtTrhgyPGAZElhGs54iVFtEXIu6NoHil5LaXyJ5O94VN2RGEl9-ArQ
```

- A fragment of the grain, atoms [0, 8): Z = [11,11,11,11,17,17,17,17], probe `5d6b6718370227172746f478c065f25bc74c708d9c4a61257a5c42ee18f3d3ce`.

**Slabs and edits.**

- Child 3 of the root (one tower step, x digit 3): path `01000301000101000301000100000000`, count 10^(10^100 − 1), a cube, not materializable.
- The googolplex with child 9 removed: edit record `4c55504e0501000038000000a10e2103622970045012eb530843be4ef0a080b1c21e5265e294cb440c3e5759010000001000000001000301000101000901000100000000`, NodeID `825d98342ecdde760707b430acd8229a6eb7480fcaf5f0b2b4311bde4864e907`, count 9 × 10^(10^100 − 1).
- With child 9 and the grain removed: NodeID `29beccfd91e84c70e305e6f1743c57d7b7c5bac0b21354ddbd7b3d44d265a254`, count 9 × 10^(10^100 − 1) − 1,000. Resolving the grain's path inside that edit fails ("enters a removed node").

**Composition and mass.**

- Googolplex: per-copy formula BrCl499Na500 × 10^(10^100 − 3); mass 2.9264454 × 10^(10^100 + 7) µDa.
- Caffeine leaf: C8H10N4O2, 194,194,000 µDa.

**Grow ×2.** Water (the leaf above) as seed, factor 2, periods 190501, 224868, 214388 Q16 on the diagonal, `levels` 100: 123-byte record, NodeID `554f4b7dcfadca431d8d5cd0c27f9a5ed802da3334163275bb487a010784a48b`, count 3 × 2^100.

### 12.5 Formatting

| Value | `format` |
|---|---|
| 953312 | `953,312` |
| 1000188000 | `1,000,188,000` |
| 10^15 | `10^15` |
| 1234567890123456789 | `1,234,567,890,123,456,789` |
| 1000188 × 10^15 | `1.000188 × 10^21` |
| 1234567890123456789012345 | `≈ 1.235 × 10^24` |
| 25 × 10^30 + 7 | `2.5 × 10^31 + 7` |
| googol | `10^100` |
| googol − 1 | `10^100 − 1` |
| googolplex | `10^(10^100)` |
| googolplex ÷ 10 | `10^(10^100 − 1)` |
| googolplex − googolplex ÷ 10 | `9 × 10^(10^100 − 1)` |
| googolplex − 1000 | `10^(10^100) − 1,000` |
| googolplex + 5 | `10^(10^100) + 5` |
| 3 × 2^100 | `3 × 2^100` |
| 3 × 2^70000 | `3 × 2^70000` |
| 24 × 16^40 | `24 × 16^40` |

### 12.6 Packs

**A small pack** holding the water leaf, the salt seed and the googolplex tower, with roots `salt-googolplex` and `water`: 65,536 bytes; contentId `9fe8d2366fbba08239408ac3b0308a917465770e9a3c428f1bf72c0d822ce15d`; header CRC `616fe651`; SHA-256 of the file `fe2e65065e9499fd79d6171cedd3c158ad46ad5b96febb3d22cd955ef2ffe674`.

| Section | Offset | Length | CRC-32 |
|---|---|---|---|
| NIDX | 16,384 | 152 | `1acbd66a` |
| NREC | 32,768 | 280 | `b01bfc5e` |
| ROOT | 49,152 | 100 | `dde7474c` |

Header (128 bytes) and section table:

```
4c55504b01000000800000000300000080000000000000000000010000000000
9fe8d2366fbba08239408ac3b0308a917465770e9a3c428f1bf72c0d822ce15d
0000000000000000000000000000000000000000000000000000000000000000
000000009fae118f000000000000000000000000000000000000000051e66f61

4e49445801000000004000000000000098000000000000006ad6cb1a01000000
4e52454301000000008000000000000018010000000000005efc1bb001000000
524f4f540100000000c000000000000064000000000000004c47e7dd01000000
```

**The bundled scale pack** `lupi-scale-r1.lpk` (the six salt rungs and their seed, copper open and closed, diamondoids 1 to 12; 20 roots, 21 records): 65,536 bytes; contentId `0cdc9ca710a3f5ac7c4c2e9ed1420513616ee7ad6d96fe6fc6b932c8e9d18f36`; file SHA-256 `97e3a0a6b25a7b91d5139438c714d36633d1bb87f5f5338d31f978020754ca29`.

**`massive_1m.glimbin` through `lupi.bake.partition@1`:** 953,312 Cu atoms → 233 leaves (the last holds 3,040 atoms) and 35 groups; root `08588107c1be69ef9816bb4226c25e65b2dae3d2da2edf3fb9420fff76664cca`; pack 12,484,608 bytes, contentId `6ced2d48335d9efb281e5685fbce716368d86f477495624a6f2719d4f221a939`, file SHA-256 `5709e48847b04b15a0b11c400c0073834ed9d64217c32d172f6510ee3e1abafb`; the resolver counts 953,312 atoms.

---

## 13. Change control [B]

**What v1 freezes.** Everything marked [B]:

- the record layouts and kinds 1–5 at `kindVersion` 1;
- the site tables, orders and roundings of §3;
- the step tags 1–4 and the canonical rules of §4;
- the Magnitude formatting of §5.4;
- the pack layout at version 1.0;
- `lupi.scale-ref.v1`;
- the domain strings, CRC-32 and SplitMix64 constants.

**How it grows.** Every extension is additive and versioned:

| Change | How it is made |
|---|---|
| A new generator (a polycrystal with rotated grains, a sponge, a capsid from symmetry operators) | a new record kind, 6 and up |
| A change to an existing generator | `kindVersion` 2 of that kind. Version 1 records keep resolving with the version 1 algorithm, bugs included. |
| A new way to address children | a new step tag, 5 and up |
| New derived sections in packs (clusters, exposure, splats for LupiEngine in M3) | optional sections (required bit clear) under `versionMinor` 1 or later; v1 readers skip them |
| A new reference format | `LSR` with version 2 |
| A new felt-mass curve or budgets | not format changes: [V] and [P] values live in the app's tuning table |

**Past the v1 ceiling.** v1 counts reach about 10^(2.4 × 10¹⁹⁷²⁸), far past a googolplex, and v1 paths address any node of any v1 tower. Going further needs no rewrite:

- **Record:** a tower `kindVersion` 2 whose `levels` is itself a Magnitude in runs form (a tower of towers).
- **Path:** a tower step tag whose run lengths are Magnitudes.
- **Magnitude:** a runs form whose run lengths are Magnitudes. The arithmetic of §5.2 is already O(runs) and never looks at a length except to add or compare it.

All three are new tags. v1 readers report `unsupported`, and v1 data is untouched.

**The process for any [B] change:**

1. a new version number;
2. new fixtures written by the TypeScript implementation;
3. the Swift implementation passing them on Linux and on the owner's Mac;
4. this spec updated in the same change.

Nothing is ever deleted: a frozen version is a promise to every trophy that uses it.
