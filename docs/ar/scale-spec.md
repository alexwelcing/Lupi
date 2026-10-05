# LupiScale v1: the normative specification

*2026-10-04, revised 2026-10-05 after an adversarial review, and again on 2026-10-05 when the two implementations were held to each other's fixtures (§13.1). This is the contract that two independent implementations build to: TypeScript in `packages/core/src/scale` (the reference, which writes the test fixtures) and Swift in `apps/apple/LupiScale` (which reads them). The architecture, the reasons and the play design are in [scale.md](scale.md); the owner's decision is D14 in [decisions.md](decisions.md). Where this spec and scale.md disagree on bytes or algorithms, this spec wins.*

---

## 0. Status, conformance and how to read this

**Key words.** MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

**Three kinds of rule.** Every section is marked with the kind of agreement it demands.

| Mark | Meaning | How it is tested |
|---|---|---|
| **[B]** byte-exact | Both implementations produce identical bytes, hashes, integers and strings. | Golden fixtures: TypeScript writes them, Swift asserts equality, on Linux and on the owner's Mac (debug and release). |
| **[V]** value | Both compute the same quantity to a stated tolerance. These values are never hashed or persisted. | Property and tolerance tests on both sides. |
| **[P]** play | Behaviour of the app. The constants are starting values in the app's tuning table, changed on the device without a format change. | Linux unit tests of the pure logic; feel on the device. |

**Frozen when persisted.** A [B] rule is frozen by the first change merged to `main` that can persist bytes depending on it. From then on, a change of any byte, order, constant or rounding is a new record kind version, a new step tag, a new reference version or a new pack version (§13), and the frozen version keeps resolving forever, bugs included, as the web's Remix `r1` codes do (`packages/ui/src/remix/code.ts`). Before a rule is frozen it may change, and the fixtures are regenerated in the same change.

| Rules | Frozen by | Why then |
|---|---|---|
| §1; §2.1, §2.2, §2.4–§2.8; §3.1, §3.3–§3.5; §4; §5; §7 | M1, the first build that writes a trophy with a scale reference | trophies are the first persisted data |
| §2.3 groups, §3.2, §3.6 the partition bake, §6 packs | M3b, the first pack served by lupi.live (`massive_1m`) | no group or pack is persisted before it |

M0 persists nothing (keeps arrive in M1), so M0 implements and tests the subset it plays with and may still revise any rule (plan.md §8).

**Test vectors.** §12 lists values computed with a scratch implementation of exactly these algorithms. The core vectors (CRC-32, SplitMix64, the salt seed and its leaf, the copper billion, diamondoids 1, 2 and 12, the googolplex record, the grain's copy key, substitution and probe, the 10³ copy key, and every row of the formatting table) were re-derived by a second, separately written Swift program and matched byte for byte. So were the vectors added or changed in the 2026-10-05 revision: both packs' contentIds, headers and file hashes, the Grow ×2 periods and records, the tower over a group-wrapped tower, the removal inside a seed copy, and the micro-dalton table. The TypeScript implementation MUST reproduce every value in §12 before it writes `packages/core/src/scale/__fixtures__/scale-v1.json` (`pnpm exec tsx packages/core/scripts/write-scale-fixtures.mts`). The Swift tests read a copy at `apps/apple/LupiScale/Tests/Fixtures/scale-v1.json`, kept in sync by `pnpm exec tsx tools/apple/export-scale-fixtures.mts` (with `--check`), the pattern LupiKit's bond fixtures already use, and assert every value in it byte for byte (`FixtureConformanceTests`): beyond §12, the fixtures carry rejection cases for records, paths, packs, references and the contextual rules (thirteen of the codes of §4.7), Magnitude arithmetic and comparison across forms and families, and edge cases of record depth, nested removals and Grow ×2. A fixture value that disagrees with this text is a bug in one of the three; none is ever tolerated.

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

- SHA-256 is FIPS 180-4. `LupiScaleCore` carries its own pure-Swift implementation, package-internal so that it declares no public `SHA256`, tested against the NIST vectors and every NodeID of §12 (§11.1).
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
| Record depth (§2.8) | 64 |
| Atoms in a leaf, or in any materialized node | 4,096 |
| Atomic number | 1 to 118 |
| Leaf coordinate | \|x\| ≤ 2²⁰ Å |
| Group children | 1 to 256 |
| Group translation | \|t\| ≤ 2⁴⁰ Å |
| Crystal cells per axis | 1 to 2⁶⁰ |
| Crystal aspect | the largest cell count at most 2¹⁶ times the smallest |
| Crystal `quarter`, `capOffset` | 1 to 2²⁰ Q16 |
| Capped crystal size `m` | 1 to 12 |
| Tower factor | 2 to 16 |
| Tower levels | 0 to 2⁶⁵⁵³⁶ − 1 |
| Tower period components | \|p\| ≤ 2⁴⁰ Q16 |
| Tower period cell slenderness (§2.5) | 2¹² |
| Tower seed count | below 2²⁵⁶ |
| Edit removals | 1 to 256, within the 65,536-byte record |
| Path in a record or a reference | 65,536 bytes, 1,024 steps |
| Octants in one `cells` step | 64 |
| Runs per axis in one `tower` step | 4,096 |
| Ranges in one `atoms` step | 4,096 |
| Scale reference | 163,840 bytes, 255 embedded records, 255 dependencies |
| Pack | 2²² records, 4,096 roots, 256 dependencies, 16 sections, 2⁴⁰ bytes |

A body's anchor path (§8.3) is runtime state, never persisted, and is not subject to the path limits.

### 1.10 Integer widths

Every [B] computation is exact. At the limits above, these are the widths it needs:

| Quantity | Bound | Width |
|---|---|---|
| Crystal quarter-grid coordinates `g` (§3.3) | at most 2⁶² | i64 |
| Q16 positions of a materialized box or capped crystal | below 2³⁶ | i64, exact in binary64 |
| Tower child translations `j × p` | below 2⁴⁴ | i64 |
| Period determinant (§2.5) | below 2¹²³ | 128-bit: Swift `Int128`, TypeScript `bigint` |
| Slenderness products (§2.5) | below 2²⁸⁰ | BigUInt or `bigint` |
| Box atom counts (§3.3.2) | below 2¹⁸⁴ | BigUInt or `bigint` |
| Sub-box translations `4(lo_child − lo_parent) × quarter` (§8.2) | below 2⁸³ | 128-bit, converted to binary64 once |
| Partition inputs `u` (§3.6) | below 2³² | i64 or Number; TypeScript MUST NOT use the 32-bit operators `>>`, `<<` or `\|` on them |

The rules of §1.9 and §2 keep every value inside these bounds, so no conforming reader ever overflows. A Swift implementation still uses checked arithmetic (never `&+` outside §1.7 and §1.5), and an overflow it meets is a bug, never a wrap.

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
- Record depth (§2.8) bounds nesting, so the count of any group is below 2⁸⁰⁰ and is always a plain Magnitude (§5.1).
- A group stores no interface or bond table. Which children touch, and how strongly, is derived data (scale.md §5.4).

### 2.4 Crystal (kind 3): a lattice generator

| Offset | Size | Field | Values |
|---|---|---|---|
| 12 | 1 | `structure` | 1 sc, 2 bcc, 3 fcc, 4 diamond, 5 rocksalt |
| 13 | 1 | `termination` | 0 open, 1 closed, 2 capped |
| 14 | 1 | `A`, species of sublattice 0 | 1 to 118 |
| 15 | 1 | `B`, species of sublattice 1 | 0 to 118; 0 means "same as A" |
| 16 | 4 | `quarter` | a quarter of the cubic lattice constant, Q16, 1 to 2²⁰ |
| 20 | 8 | `n0` | cells along x, 1 to 2⁶⁰ |
| 28 | 8 | `n1` | cells along y |
| 36 | 8 | `n2` | cells along z |
| 44 | 1 | `capZ` | capping species when `termination = 2`, else 0 |
| 45 | 3 | reserved | 0 |
| 48 | 4 | `capOffset` | Q16 per quarter step when `termination = 2`, else 0 |

The record is always 52 bytes. Field rules:

- `sc` and `fcc`: `B` MUST be 0. `rocksalt`: `B` MUST NOT be 0. `bcc` with `B ≠ 0` is the CsCl structure, and `diamond` with `B ≠ 0` is zincblende.
- `termination = 2` (capped) requires `structure = 4`, `n0 = n1 = n2 = m` with `1 ≤ m ≤ 12`, and nonzero `capZ` and `capOffset`.
- **Aspect.** `max(n0, n1, n2) ≤ 2¹⁶ × min(n0, n1, n2)`, compared exactly. A longer needle or a thinner sheet is a tower or a group. The limit keeps every octree box within the anchor rule of §8.4.
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

- Every period component satisfies `|p| ≤ 2⁴⁰` Q16 (2²⁴ Å).
- The periods MUST be linearly independent: their determinant `det = p0 · (p1 × p2)`, computed exactly in 128-bit integers, is nonzero.
- **Slenderness.** The period cell may be at most 2¹² times longer than it is wide. For each axis `a`, with `b`, `c` the other two:
  `max(|p0|², |p1|², |p2|²) × |p_b × p_c|² ≤ 2²⁴ × det²`,
  evaluated exactly (BigUInt; every term is a sum of squares of integers). `det / |p_b × p_c|` is the cell's width across the faces spanned by `p_b` and `p_c`, so this bounds the longest period over the narrowest width. The bounding radius of every level of a valid tower is then at most `1.5 f × 2¹²` times its narrowest width, which the anchor rule of §8.4 relies on.
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
- The base MUST NOT itself be an edit. Writers flatten: removing node `n` from an edit `E` writes one edit of `E`'s base whose removals are `E`'s removals, minus every removal that `n` contains (§4.4), plus `n`. Removing a node that lies inside an existing removal is an error (`path`): that piece is already gone.
- An edit is **full** when one more removal would pass 256 removals or the 65,536-byte record. Writers refuse it (the play text is "this one is full", §10.6).
- The semantics are in §3.5.

### 2.7 Kinds a reader does not know

A record with an unknown kind, or a known kind with an unknown `kindVersion`, is kept opaque: its NodeID is still verified (§6.6), but resolving any path through it fails with `unsupported`. This is how later kinds can be added without breaking v1 readers (§13).

A reader checks only what every version shares: the magic, and that the record is exactly `12 + bodyLength` bytes and at most 65,536. It does not check an opaque record's flags, which a later kind may use.

### 2.8 Rules that need context

These are checked when a node is resolved, because they look at other nodes.

**Unit exponent.** Every node has a frame unit of `f^u` Å.

| Node | Unit exponent `u` |
|---|---|
| leaf, crystal, crystal box, seed copy, selection | 0 (Å) |
| group | 0 (all its children are unit 0) |
| tower level `k` | `u(k)` from §3.4.1, in the tower's base `f` |
| edit | that of its base |

One rule uses it: a group child MUST have unit exponent 0. A tower with `levels ≤ 3` has unit exponent 0, so it may be a group child. (A tower seed, which is never a tower, always has unit exponent 0.)

**Tower seeds.**

- A tower seed MUST NOT be a tower, or an edit whose base is a tower. Its seed view would sit directly below the outer tower's level 0, and the two tower steps would be adjacent, which §4.2 rule 1 merges into one invalid step. A writer that needs a tower of towers wraps the inner tower in a one-child group with the identity placement: the path then reads `tower`, `child 0`, `tower` (§12.4).
- The seed's atom count MUST be below 2²⁵⁶.
- With a substitution, the seed MUST be materializable (§4.5) and MUST contain at least `perCopy` atoms of `fromZ`.

**Record depth.** A leaf or a crystal has depth 1; a group has 1 plus its deepest child's depth; a tower, 1 plus its seed's; an edit, 1 plus its base's. Depth MUST NOT exceed 64.

- Readers check it lazily, so that a reader needs only the records it reads, with two necessary conditions of the rule that together catch every record deeper than 64 that the reader touches:
  - **Walking.** A walk counts the records it enters: 1 for the root, and 1 more for each `child` step, each edit's base, and each seed entered from a tower's level 0 without a substitution. Entering a 65th record fails with `limit`.
  - **Evaluating a subtree.** A count, a composition, an aggregate or a materialization of a view reached after `c` records fails with `limit` when `c − 1 + d > 64`, with `d` the record depth of the view's record for a group, a tower level or a copy, and 1 for any other view. So the depth-65 chain of §12.4 fails from its root and from every node below it.
- Depth is a property of the record, so it is memoized by NodeID like counts.
- It bounds every recursion at 64 frames and every group count below 2⁸⁰⁰ (§2.3).

**Edits.**

- Every removal MUST resolve inside the base; one that does not fails with `validity`, whatever the step's own error would be.
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

- The digits of axis `a` from the top of the tower down to level 0 are exactly the base-`f` representation of the seed copy's index along `a`. So a neighbour is ±1 on that number, with carries through the runs (§9.4), and a copy's key needs only its runs (§3.4.5).
- Digit strings are run-length coded as `(digit, length)` runs.

#### 3.4.4 Seed copies

Level 0 below a tower is a **seed copy**.

- **Without a substitution** the copy is the seed node itself, and a path continues into it with the seed's own steps. The seed is never a tower (§2.8), so the next step is never a second `tower` step.
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

- Positions are never re-centred or re-quantized, so the source's numbers survive. (Drawing uses a derived local centre per leaf, §8.5; that is display data, never identity.)
- Every input position satisfies |x| ≤ 2²⁰ Å (§1.9); a bake of anything larger fails with `range`.
- `u` reaches 2³¹, and the key has 63 bits: TypeScript computes `u >> shift` as `Math.floor(u / 2 ** shift)` and orders by the key exactly, in `bigint` or in any exact form (the reference holds it as two exact Number halves under a stable radix sort, §1.10).
- `massive_1m.glimbin` (953,312 Cu atoms) bakes to 233 leaves and 35 groups, depth 4.

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

1. **No two adjacent steps share a tag of 2, 3 or 4.** Adjacent `cells` steps concatenate their octants (at most 64). Adjacent `tower` steps add their `D` and concatenate the run lists per axis. Adjacent `atoms` steps compose: the second selection indexes the first, and the result is re-expressed in the first's base indices. Two adjacent `tower` steps always descend one tower, because a tower's seed is never a tower (§2.8), so this rule needs no context.
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
| box | a crystal with open or closed termination (the box `[0, n)`), or a `cells` step | `cells`; `atoms` when its own count (§3.3.2, before removals) is at most 4,096 |
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

A view carries the list of removal paths that start at it. Taking a step updates each removal `r`, whose first step is `h`. A removal is **used up** when `h` is its only step.

- **`child i`.** If `h` is `child i`: when `r` is used up, the step enters a removed node and fails; otherwise `r` continues with its remaining steps. A removal starting with another index is dropped.
- **`cells o₁…oₙ`.** If `h`'s octants are equal to the step's, or a proper prefix of them, the step enters a removed node and fails. (A `cells` step is always a removal's last: removals have no `atoms` step, and adjacent `cells` steps merge.) If the step's octants are a proper prefix of `h`'s, `r` keeps the remaining octants. Otherwise `r` is dropped.
- **`tower D`**, taken at level `k`. Let `D' = min(D, D_h)`, and compare per axis the first `n(a, k, D')` digits of the step and of `h`. If they differ, drop `r`. If they match:
  - `D_h > D`: `r` keeps a tower step of `D_h − D` levels with the remaining digits, followed by its other steps;
  - `D_h ≤ D` and `r` is used up: the step enters a removed node and fails;
  - otherwise `D_h = D = k`, because a removal continues past a tower step only from level 0 (§4.2 rule 1): `r` continues inside the seed copy with its remaining steps. This is how an edit removes part of one copy (§5.3).
- **`atoms`.** Selections index the materialization, which already excludes removed atoms (§4.5), so the selection view carries no removals.

**Containment.** Removal `a` contains removal `b` (both starting at the same view) when `a` equals `b` or names one of its ancestors. Compare them step by step:

- `child`: equal indices go on to the next steps; different indices: no.
- `cells`: if neither octant list is a prefix of the other: no. If `a`'s list is a proper prefix of `b`'s: yes. If `b`'s is a proper prefix of `a`'s: no. If they are equal, go on.
- `tower`: compare per axis as many leading digits as the shorter of the two steps has on that axis (its run lengths); any difference: no. If `D_a < D_b`: yes. If `D_a > D_b`: no. If they are equal, go on.
- When `a` runs out of steps first, or both run out together: yes. When `b` runs out first: no.

It needs no start level, because each step's run lengths give its digit counts. Writers use it to flatten edits (§2.6), and readers to check that no removal contains another (§2.8).

**Counts with removals.** A view's removals can overlap when they come from two edits: an outer edit's removal may contain an inner edit's removal at the same view, or reach through a seed copy into a seed that is itself an edit. So a count subtracts only the **outermost** removals, each with what it really takes away:

```
count(view) = baseCount(view) − Σ count(walk(view without its removals, r))
              over the removals r of the view that no other removal of the view contains
```

The walk re-enters every edit below the view and applies its removals, so each term is the count of what is left in the removed node, and the count always equals the materialization. When a view's removals come from one edit and no walk re-enters an edit, this is `baseCount(view) − Σ baseCount(…)`, and no §12 vector changes. Example (§12.4, "nested removals"): a factor-10 tower of 3 levels over the salt seed edited to remove `cells 0, 3` (16 ions), with copy (0, 0, 0)'s octant 0 (216 ions, of which 200 remain) removed by an outer edit, counts 984 × 1,000 − 200 = 983,800, not 983,784.

### 4.5 Materialization and probes

A view is **materializable** when it can be written as one leaf of at most 4,096 atoms:

| View | Materialization |
|---|---|
| leaf | the record's atoms |
| capped | §3.3.4 |
| box whose own count (§3.3.2, before removals) is at most 4,096 | §3.3.2, minus atoms whose owner cell lies in a removed sub-box |
| copy | the seed's materialization with the substitution (§3.4.6); the seed MUST be materializable |
| selection | the selected atoms of its base's materialization, in ascending index order, positions unchanged |

Groups and tower levels `k ≥ 1` are never materialized. A box's materializability never changes as pieces are removed from it, so neither does whether a reference to it carries a probe (§7.2); a box of 10⁹ atoms with all but one cell removed is still not materializable. The **probe** of a materializable view is the NodeID of the leaf record (§2.2) of its materialization.

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
    group    → group view (a child's unit exponent is checked when a `child` step enters it,
                or when the group's whole subtree is evaluated)
    crystal  → capped view, or the box [0, n)
    tower    → check the seed (§2.8: not a tower, unit exponent 0, count, substitution);
                the level L view, or the copy when L = 0
    edit     → validate the removals (§2.8), then rootView(base, removals ++ edit.removals)
```

- **What a resolution reads.** The records on the path; for a tower, its seed's subtree (for the seed's count and, with a substitution, its materialization); for an edit, the records its removals walk through. Nothing else, so a reference can embed exactly these (§7.2), and record depth is checked on them (§2.8).
- **Memoization.** Counts, compositions, depths and aggregates of records MUST be memoized by NodeID. A DAG that repeats children is exponentially larger than its records (a 64-deep chain of 256-way groups names 256⁶³ leaves), and evaluating it MUST cost O(records × children), never the number of paths.
- Nothing is ever expanded to answer a count: every count above is closed-form.

### 4.7 Errors

| Code | Meaning |
|---|---|
| `truncated` | the bytes end inside a field |
| `magic` | the magic is wrong (`LUPN`, `LUPK`, `LSR`, or a reference text without `lsr1:`) |
| `version` | an unsupported pack `versionMajor` or reference version (a record of an unknown version is opaque, §2.7) |
| `canonical` | the bytes are not the one encoding of their value: a nonzero reserved or padding byte or unused flag bit, −0, a non-minimal BigUInt, a quaternion of the wrong sign, a list out of order or with a duplicate, any rule of §4.2 (including `start + length ≤ 4096`), `bodyLength` short of the record, trailing bytes, or base64url that is not strict |
| `range` | one field holds a value its definition excludes: an enum value, an atomic number, a count outside its range (a leaf's atoms, a group's children, an edit's removals, cells per axis, a capped crystal's size, `perCopy`, the factor), a coordinate, translation, period or `quarter` past its bound, a non-finite float, a root name |
| `limit` | a size limit of §1.9 that bounds a reader's memory or work: a record, path, reference or pack too long; too many steps, octants, runs or ranges in a path, or records, roots or dependencies in a pack or reference; a BigUInt past 65,536 bits; record depth (§2.8) |
| `missing` | a NodeID is not in the store |
| `unsupported` | an unknown kind, version, step tag or required section |
| `path` | a step does not apply, an index is out of range, or the step enters a removed node |
| `validity` | fields that are each in range break a rule that relates them, within one record (a unit quaternion; a crystal's species by structure, its aspect, a capped crystal's structure and shape; independent periods within the slenderness limit; a substitution to another element) or across records (every rule of §2.8) |
| `materialize` | the view is not materializable |
| `mismatch` | a probe (present when it should not be, absent when it should be, or different), record hash or contentId does not match |
| `base`, `pack`, `crc` | §5.2 across families; §6.6 |

When one input breaks several rules, the code of any of them conforms; the fixtures test inputs that break one.

### 4.8 From a point to a path [V]

Picking, rebasing, chips and pieces need the path from a node down to the node under a point F. Inside one node:

- **Group:** the child whose bounds contain F, nearest centre first on ties.
- **Box:** the octant `o` whose bits are set where F is at or past `mid` (in quarter units).
- **Tower level `k`:** express F in the period basis of the node's own frame (solve `x = Σ c_a p_a` in binary64), take `j = clamp(⌊c_axis(k)⌋, 0, f − 1)`, and continue in child `j`.

**Every descent is bounded by its target, never by the depth of the content.** A descent stops at the first node that is small enough for its purpose:

| Descent | Stops at |
|---|---|
| picking (§10.5) | the first node on the hit whose displayed diameter is below one pixel, or below the bottom of the band being picked (4 cm for the hand band, 1 cm for the chip band) |
| rebasing (§8.4) | one level per descent, at most 2 descents per frame |
| a chip or a piece (§10.5, §10.6) | the node in the chip band (1–5 cm) or the hand band (4–40 cm) |

Each starts from a node already drawn on screen (an item of the current cut, or the anchor), so it takes at most `3 ⌈log_f(start size / stop size)⌉` levels per tower: a few dozen, for a water or a googolplex alike.

**Precision.** F is known in binary64 relative to the node a descent starts from, so its digits there are meaningful for only `P(f) = ⌊40 / log₂ f⌋` digits per axis (40 for f = 2, 12 for f = 10, 10 for f = 16). Iterating `c ← (c − j) · f` past that point produces noise, not digits: for odd `f` it never settles. So a descent MUST NOT iterate past `P(f)` digits on any axis; it instead re-expresses F, from its world position, in the frame of the node it has reached, and goes on. F's world position is known to about 10⁻¹⁵ m, and every node a bounded descent stops at is at least a pixel across, so F always determines the digits it needs.

The one descent that is not bounded by a target is flight, which crosses up to 2⁶⁵⁵³⁶ levels. It does not use F's digits at all: it descends by whole self-similar periods along constant digits (§8.8), so a dive of 10¹⁰⁰ levels adds about one run per axis to the anchor path.

The digits are play input; once written, a path is exact.

---

## 5. Magnitude: exact counts and masses [B]

### 5.1 Values

A Magnitude is an exact non-negative integer, its **value**, held in one of two forms, together with a **display base** `f` (2 to 16, and 10 for plain counts). The display base only chooses how §5.4 prints the value, never what it is.

| Form | Holds | Used for |
|---|---|---|
| plain | a BigUInt, below 2⁶⁵⁵³⁶ | every count of a finite node: leaves, groups, crystals, small towers, selections |
| base-`f` runs | `f` in 2…16 and digit runs `(digit, BigUInt length)`, most significant first, adjacent digits different, no leading zero run | tower counts and anything derived from them |

- `towerCount(s, f, k)` is the base-`f` digits of `s` followed by a run of `k` zeros, with display base `f`.
- **Canonical form.** A value below 2⁶⁵⁵³⁶ is canonically plain, whichever form produced it. A larger value is canonically runs in its **root base**: 2 for `f` in {2, 4, 8, 16}, 3 for `f` in {3, 9}, and `f` itself for 5, 6, 7, 10, 11, 12, 13, 14 and 15. Bases with one root form a **family**. Converting a base-`r^j` value to base `r` replaces each digit by its `j` base-`r` digits. That costs O(runs) for every value v1 produces, because their long runs hold only the digits 0 and `f − 1`, whose expansions are themselves single runs.
- **Exact range.** Every count v1 can produce is exact: plain values below 2⁶⁵⁵³⁶ and tower values `s · f^L` with `s < 2²⁵⁶`, `f ≤ 16` and `L < 2⁶⁵⁵³⁶`, plus sums and differences of these. That reaches about 10^(2.4 × 10¹⁹⁷²⁸); a googolplex is 10^(10^100). There is no floating-point step anywhere in a count. §13 says how a later version goes past this bound.

### 5.2 Arithmetic

| Operation | Rule |
|---|---|
| `add`, `sub` | Both plain: BigUInt arithmetic. One family: in the root base, digit runs added or subtracted from the least significant end; within an aligned segment of constant digits at most two positions differ before the carry or borrow settles, so the cost is O(runs). A plain value is exact in every base, so it joins the family of the other operand (converted to its root base once, O(digits)). Two values of runs in different families: the error `base`. v1 never reaches that error, because only edits subtract and an edit's terms share one tower. A negative result is the error `range`. The result keeps the left operand's display base, even when the value is runs of another family; §5.4.2 then prints it in its own root base. |
| `mulSmall(k)` | Repeated doubling, for any plain `k` (at most 65,536 bits), at O(runs) per bit. A composition's unit mass reaches 2²⁸⁵ µDa (a seed below 2²⁵⁶ atoms of at most 294 Da), so a narrower bound would refuse valid towers. |
| `cmp` | Plain values: numerically. One family: by digit count in the root base, then digit by digit from the most significant. Different families with a value above 2⁶⁵⁵³⁶: the error `base`. No [B] rule compares across families; interfaces that sort mixed values use the key of §5.5. |
| equality, hash | By canonical form. That is numeric equality for every pair except two values above 2⁶⁵⁵³⁶ in different families, which v1 treats as unequal without deciding. Hashes hash the canonical form, so equal values hash alike and the display base never matters. |
| `key` | The canonical form as text, for maps and the fixtures: `p:` and the value in lowercase hex without leading zeros (`p:0` for zero) below 2⁶⁵⁵³⁶, otherwise `r<root>:` and the root-base runs, most significant first, each `<digit>x<length>` in lowercase hex, joined by commas. The googolplex is `r10:1x1,0x` followed by the hex of 10¹⁰⁰. |
| `fitsPlain`, `toPlain` | Exact conversion when the value has at most 65,536 bits. |

In Swift, `+`, `-` and `compare` throw (§11.1). In TypeScript they throw `ScaleError('base')`.

### 5.3 Composition, formula and mass

**Composition** gives exact per-element counts in one form:

```
count(Z) = unit[Z] × copies − removed[Z]
```

- **A tower level `k`**, with the outermost removals its view carries (§4.4):
  - `unit` is one seed copy's counts: the seed's composition (after the seed's own edit, if it is one) with the substitution applied;
  - `copies` is `f^k`, minus `f^j` for each removal used up at a level-`j` node (`j = 0` for a whole seed copy);
  - `removed` sums the counts of the removals that continue inside a seed copy (§4.4), each a finite node counted with the removals nested inside it applied.
- **Every other view:** `unit` is its exact counts after its removals (the outermost ones, each with its nested removals applied, as for counts), `copies` is 1 and `removed` is empty. A crystal box's counts are closed-form per species, like its atom count (§3.3.2); a group's are the sum over its children.
- `unit` and `removed` are plain; `copies` is a Magnitude.
- The googolplex is BrCl₄₉₉Na₅₀₀ × 10^(10^100 − 3).

**Formula** (`MoleculeRef.formula`, §7.4) is the Hill formula of `unit`:

- with carbon: C first, H second, then alphabetical; without carbon: all alphabetical;
- counts of 1 omitted, no separators.

For a tower piece it is one seed copy's formula (BrCl499Na500 for every salt rung, edited or not); for any other piece, its molecular formula (caffeine is C8H10N4O2).

**Formula text**, for plaques: the formula; then ` × ` and `format(copies)` when `copies ≠ 1`, in parentheses when that text is a sum or a difference (rules 4a and 4b of §5.4), and without them when it is a product (the googolplex without child 9 is `BrCl499Na500 × 9 × 10^(10^100 − 4)`); then ` − ` and the Hill formula of `removed` when it is not empty:

| Piece | Formula text |
|---|---|
| the googolplex | `BrCl499Na500 × 10^(10^100 − 3)` |
| the googolplex without child 9 and the grain | `BrCl499Na500 × (9 × 10^(10^100 − 4) − 1)` |
| §12.4's edit inside a seed copy | `Cl500Na500 × 1,000 − Cl108Na108` |
| caffeine | `C8H10N4O2` |

**Mass** is exact in micro-daltons:

```
massµDa = (Σ_Z unit[Z] × µDa(Z)) × copies − Σ_Z removed[Z] × µDa(Z)
```

`µDa(Z)` is the frozen table below (`lupi.mass.v1`): each element mass of `packages/core/src/elements.ts` read as its decimal literal and scaled by 10⁶ exactly. Never multiply the binary64 mass by 10⁶ and truncate: in binary64, 65.38 × 10⁶ is 65,379,999.99999999 and 32.06 × 10⁶ is 32,060,000.000000004. `tools/apple/gen-elements.mts` emits this column as integers for Swift and TypeScript alike, and `pnpm apple:check` fails when `elements.ts` changes a mass without a new table version.

```
µDa(Z), ten elements per row
  1–10  1008000 4002600 6940000 9012200 10810000 12011000 14007000 15999000 18998000 20180000
 11–20  22990000 24305000 26982000 28085000 30974000 32060000 35450000 39950000 39098000 40078000
 21–30  44956000 47867000 50942000 51996000 54938000 55845000 58933000 58693000 63546000 65380000
 31–40  69723000 72630000 74922000 78971000 79904000 83798000 85468000 87620000 88906000 91224000
 41–50  92906000 95950000 98000000 101070000 102910000 106420000 107870000 112410000 114820000 118710000
 51–60  121760000 127600000 126900000 131290000 132910000 137330000 138910000 140120000 140910000 144240000
 61–70  145000000 150360000 151960000 157250000 158930000 162500000 164930000 167260000 168930000 173050000
 71–80  174970000 178490000 180950000 183840000 186210000 190230000 192220000 195080000 196970000 200590000
 81–90  204380000 207200000 208980000 209000000 210000000 222000000 223000000 226000000 227000000 232040000
 91–100 231040000 238030000 237000000 244000000 243000000 247000000 247000000 251000000 252000000 257000000
101–110 258000000 259000000 266000000 267000000 268000000 269000000 270000000 269000000 278000000 281000000
111–118 282000000 285000000 286000000 289000000 290000000 293000000 294000000 294000000
```

Mass is derived data, never identity.

### 5.4 Formatting

One function, `format(M)`, prints every count on every surface: the HUD, plaques, trophies and the web. It works on the decimal digit string of `M` without ever forming it in full, using runs. For a display base `f ≠ 10` it first applies the rules of §5.4.2.

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

For a display base `f ≠ 10` and `M ≥ 10¹⁵`, working on the base-`f` digits. A value of runs whose display base is of another family (a sum that kept its left operand's base, §5.2) has no exact digits in that base, so it prints as if its root base were its display base: `10 + 3 × 2^70000` prints `≈ 3 × 2^70000`.

1. If the digits are `c` followed by `z` zeros with `c < 10¹⁵`, where `z` is the whole trailing run of zeros (so `c`'s last digit is not zero), print `c × f^E(z)`, or `f^E(z)` when `c = 1`. `c` is printed in decimal, grouped as in rule 1 of §5.4.1. Water grown a hundred times is `3 × 2^100`, and `1000 × 2^100` is `125 × 2^103`.
2. Else, if `M` fits in 65,536 bits, convert it to plain and use §5.4.1.
3. Else take `c` as the value of the leading 16 base-`f` digits, `k` as the number of digits after them, move factors of `f` from `c` into `k`, and print `≈ c × f^E(k)`, with `c` in decimal, grouped.

### 5.5 Approximate quantities [V]

Physical quantities derived from exact counts (kilograms, metres, magnification) and the feel functions of §10 need logarithms of Magnitudes. These are values, never hashed or persisted, and they are tested with the tolerances below. Exponents are printed exactly only in a base in which they are exact.

For a Magnitude `M ≥ 1` whose display base is `f` (its root base when it is runs of another family, §5.4.2), let `n` be its number of base-`f` digits, `c` the integer value of its leading `min(n, 16)` digits, and `N = max(n − 16, 0)`, an exact integer.

| Quantity | Computed as | Tolerance |
|---|---|---|
| `ln M` | `N · ln f + ln c` in binary64; `+∞` when that overflows | absolute 10⁻⁹ while \|ln M\| ≤ 10⁶, else relative 2⁻⁴⁰ |
| `lnln M` (for `M ≥ 3`) | `ln(ln f) + ln(N + log_f c)`: in binary64 while `N < 2⁵³`; beyond, `ln N` from `N`'s bit length and its top 53 bits (`log_f c` is then below 2⁻⁴⁸ of `N` and is dropped). Finite for every v1 value. | absolute 10⁻¹² |
| `log10 M` | `ln M / ln 10` | as `ln M` |
| `ln(M_a / M_b)` | in the base of the runs operand (10 for two plain values): `(N_a − N_b) · ln f + ln c_a − ln c_b`, with the digit counts subtracted exactly before any rounding, so the ratio of two values beyond binary64 (a piece of a googolplex and the googolplex, §10.6) is as good as that of small ones; `ln M_a − ln M_b` across families | as `ln M` |

Binary64 cannot carry more than about 16 digits of `n · log10 f`, so the decimal exponent of a large value whose base is not 10 is not exact (for `3 × 2^L` it goes wrong from `L = 2⁵³`).

**Scientific display** of a physical quantity `Q = M × q`, with `q` a binary64 constant (1.66053906660 × 10⁻³³ kg per µDa, or metres per unit), prints `≈ m × b^E`:

- The base `b` is 10 when `M` is plain or has display base 10. Otherwise it is `M`'s display base (as above), the only base in which its exponent is exact.
- With `n` the number of base-`b` digits of `M` and `c` the integer value of its leading `min(n, 17)` digits, rounded to binary64 once: `E = max(n − 17, 0) + ⌊log_b(c · q)⌋`, an exact integer, and `m = b^frac(log_b(c · q))`, printed with 4 significant digits (half to even on the binary64 value). A mantissa that rounds up to `b` (9.9996 in base 10) prints as `1.000` with `E + 1`.
- `E` is printed by `E(k)` of §5.4.1, with a minus sign U+2212 when negative.
- The googolplex weighs `≈ 4.859 × 10^(10^100 − 26)` kg. A water tower of `levels` 70,000 (3 × 2^70000 atoms) weighs `≈ 1.157 × 2^69915` kg.

**Sorting** mixed Magnitudes in an interface (a shelf by count) uses the key `(lnln M, ln M)`, then the existing order. It is approximate across families, and no [B] rule uses it.

The magnification `λ` and the scale axis `φ` (§8.7) are computed from the exact unit exponent in the same way.

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
| 32 | 32 | contentId | §6.2.1 |
| 64 | 32 | reserved | 0 |
| 96 | 4 | flags | 0 |
| 100 | 4 | tableCrc | CRC-32 of the section table bytes |
| 104 | 20 | reserved | 0 |
| 124 | 4 | headerCrc | CRC-32 of bytes 0 to 123 |

#### 6.2.1 contentId

```
contentId = SHA-256( "lupi.pack.v1" ‖ 0x00
                   ‖ u32 nodeCount ‖ every NodeID, in NIDX order
                   ‖ u32 length of ROOT ‖ the ROOT section's bytes
                   ‖ u32 length of DEPS ‖ the DEPS section's bytes )
```

An absent ROOT or DEPS section contributes a length of 0 and no bytes. The contentId depends on the records, the root names and the dependencies, and not on the layout, which the writer fixes (§6.5). It is the pack's identity, its file name and its URL, so two packs that hold the same records under different roots or dependencies are different packs with different URLs. The SHA-256 of the whole file (§12.6) is a further check, never an identity.

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
| per root: NodeID, name length (u16), name, zero padding to a multiple of 4 | 32 + 2 + len + pad, with `pad = (4 − (34 + len) mod 4) mod 4`, which also aligns the next entry within the section |

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
4. Fill the header. `contentId` comes from the sorted NodeIDs and the ROOT and DEPS bytes (§6.2.1), and the two CRCs are computed last: `tableCrc` first, then `headerCrc` over bytes 0 to 123.

v1 writers write no other sections.

### 6.6 Reading a pack

A reader MUST reject the pack unless all of these hold. The codes: `crc` for any CRC, `version` for `versionMajor`, `unsupported` for an unknown required section, `mismatch` for a record's hash or the contentId, and `pack` for every other rule, including a record that hashes to its NodeID but breaks §2, whether it is found at open time or on first use.

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
   - Its offset is page-aligned and not before the end of the previous section's pages. Zero pages between sections, or after the last one, are accepted; §6.5's writers never write them, and a pack's identity is its contentId, not its layout.
   - Its bytes lie inside the file, and the rest of its last page is zero.
   - Its CRC matches.
   - No type appears twice.
   - An unknown type, or an unknown sectionVersion, is skipped when its required bit is clear and rejected when it is set. Flag bits other than bit 0 are ignored (v1 writers write 0), so a later minor version may use them.
4. **NIDX and NREC** are present.
   - NIDX's length is exact and its NodeIDs strictly ascend.
   - Records are packed in NIDX order at 8-byte alignment with zero padding, and NREC has nothing after the last record.
   - Each entry's kind and version match its record.
5. **Records.**
   - Every record's SHA-256 equals its NIDX NodeID before the record is used. Hashing every record at open time is allowed but not required; hashing on first use is enough.
   - Records of known kinds decode under §2; unknown kinds stay opaque.
6. **contentId** recomputed from NIDX, ROOT and DEPS (§6.2.1) equals the header's.
7. **ROOT and DEPS**, when present, follow §6.4.

### 6.7 How packs reference other packs and generators

- **NodeIDs are global.** A record in pack P may name a child, seed or base that lives in pack Q. P lists Q's contentId in DEPS so a resolver knows what to fetch. A resolver looks a NodeID up in every pack it has loaded; DEPS is a fetch hint, never a namespace.
- **Generators are records.** A crystal, tower or edit carries its whole definition, typically 40 to 200 bytes, and names no code. The algorithm is selected by kind and kindVersion (§3). So a procedural structure of any size is a single small record, and a trophy can embed it (§7) and never fetch anything.
- **Explicit structures** (gallery colossi, imports) are leaves and groups from `lupi.bake.partition@1`, packed whole.

### 6.8 Serving and caching

| Where | What |
|---|---|
| lupi.live | `GET /scale/p/<contentId hex>.lpk`, served by the Worker from an append-only R2 bucket. The response carries `Cache-Control: public, max-age=31536000, immutable`. HTTP range requests work because sections are page-aligned. |
| The app bundle | `lupi-scale-r1.lpk` (the salt ladder, copper, diamondoids; §12.6), plus the gallery leaves, which are also derivable from the bundled XYZ files. |
| On the device | `Caches/scale/<contentId hex>.lpk`. iOS may purge it, which is safe: a missing pack only shows the trophy's stored aggregate (§7.4) until it is fetched again. |

**Retention.** A trophy may depend on a pack for as long as the trophy exists, so a pack, once any build has served it, is never removed or replaced. Packs are therefore not ordinary static assets of the web build, which Workers static assets drop at the next deploy. The web build writes them, the deploy uploads each new contentId to the R2 bucket before the build goes live, and nothing ever deletes from that bucket. A pack with the same contentId is byte-identical by construction, so re-uploading it is harmless. (The bucket and its binding are new; contracts.md §4 lists the route.)

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

- The reference is at most 163,840 bytes, and nothing follows the probe. Its text form is then at most 218,459 characters, which leaves room for the rest of a trophy under the account sync's 256 KiB bound (§7.4).
- **Text form:** `lsr1:` followed by the base64url of the bytes.
- **refKey** = SHA-256(`lupi.scale.ref.v1` ‖ 0x00 ‖ rootID ‖ path bytes). It identifies the piece whatever is embedded: two references to the same piece have the same refKey even if one embeds a record that the other fetches.

### 7.2 Writing

- **Embedded records.** A writer MUST embed every record that resolving the reference reads (§4.6), counting its target and computing its probe included (a count reads a group target's whole subtree), even one the app bundles, with one exception: when the target has more than 4,096 atoms, the records of an explicit pack (a gallery colossus) MAY be left to that pack, listed in DEPS. So:
  - generator records (crystal, tower, edit) are always embedded;
  - a target of at most 4,096 atoms always resolves from the reference alone. When it lives in a pack, its leaf and the group records on its path are embedded, and the pack need not be listed;
  - only a bigger piece of explicit content depends on a pack, and packs are kept forever (§6.8).
- **The probe** is present exactly when the target is materializable (§4.5), and it is the target's probe.
- **When it does not fit.** If the reference would pass 163,840 bytes, or its path the limits of §1.9:
  - a target of at most 4,096 atoms is kept as its own materialized leaf, as a root with the empty path (always under 54 KB). Its probe and atoms are the same, its refKey is new, and the trophy's origin records where it came from;
  - anything else is refused with the error `limit`, and the app says "This piece is too intricate to keep". No v1 content reaches this: it takes several nearly full edits on one path, or thousands of alternating smashes along one axis.
- Typical sizes:

| Piece | Size |
|---|---|
| A gallery molecule, its leaf embedded: caffeine | 406 bytes (a 4,096-atom leaf: about 53 KB) |
| A leaf of `massive_1m`, embedded with the three groups on its path, three `child` steps, probe | 55,171 bytes (§12.6); by dependency alone it would be 115 bytes |
| The salt rung 10³: two records, empty path, probe | 260 bytes |
| A grain of the googolplex: two records, one tower step, probe | 496 bytes (§12.4) |

### 7.3 Resolving

1. Decode: canonical layout, sorted records and dependencies, canonical path, no trailing bytes.
2. Build a store from the embedded records plus the records of the listed packs that are available. Each embedded record's NodeID is its SHA-256.
3. Resolve the path from the root (§4.6).
4. The probe MUST be present exactly when the target is materializable, and if present it MUST equal the target's probe. Either failure is `mismatch`.
5. **When a dependency pack is missing**, the piece is not lost: the app shows the trophy from the aggregate stored in its `ScaleRefField` (§7.4) and its plaque text, and fetches the pack, which lupi.live keeps forever (§6.8). Generator records and targets of at most 4,096 atoms never need a pack (§7.2).

### 7.4 In `lupi.trophy.v1` (amends contracts.md §1 before M1)

`MoleculeRef` gains one optional field and one source value. Both are additive, and nothing has shipped.

```swift
public enum MoleculeSource: String { case gallery, omol25, pubchem, built, fragment, scale }   // + scale

public struct ScaleRefField: Codable, Sendable, Hashable {
    public var schema: String      // "lupi.scale-ref.v1"
    public var ref: String         // "lsr1:…"
    public var count: String       // format(count), §5.4: a cache for plaques, re-checked on load
    public var spanMetres: Float   // longest displayed extent when kept, 0.005...3
    public var aggregate: ScaleAggregate?   // for display while a dependency pack is missing
}
public struct ScaleAggregate: Codable, Sendable, Hashable {
    public var extents: [Float]    // 3 values, the shape: extents along the node's axes, the longest = 1
    public var colour: String      // "#rrggbb", the coverage-weighted CPK mean of its exposed atoms
}
// MoleculeRef.scale: ScaleRefField?
```

| `MoleculeRef` field | For `source: scale` |
|---|---|
| `sha256` | the refKey in hex |
| `formula` | the Hill formula of `unit` (§5.3): a tower piece's formula is one seed copy's |
| `atoms` | the count when it is at most 2⁵³ − 1, else 2⁵³ − 1; `scale.count` is authoritative |
| `xyz` | MAY be embedded, as for fragments, when the piece is materializable and has at most 2,000 atoms |
| `scale` | required |

Other sources MAY also carry `scale`: a fragment of a gallery molecule is its leaf plus an `atoms` step.

On load, the app resolves `scale.ref`, recomputes `format(count)` and the formula, and treats a disagreement as a corrupt record.

**Size.** The account sync refuses a trophy whose JSON encoding passes 256 KiB (`.payloadTooLarge`, `docs/ar/account-and-sync.md` on the `ar/acct` branch). A reference is at most 218,459 characters as text (§7.1), so the rest of the record has at least 43 KiB. A writer omits `xyz` whenever including it would pass the bound.

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
| frame entity | a RealityKit entity whose local space (Float32 metres) holds draw items: a body's own entity, or the camera frame entity that holds terrain and face planes (§8.5) |

No position is ever absolute across levels. A point is named by a node (a root and a path) and local coordinates in that node's frame. Every node also has a **local centre** `c(X)`, the centre of its bounding box in its own frame (binary64, derived data, never identity); drawing happens relative to it.

### 8.2 Placements: child into parent

| From → to | Map, `x_parent = s · R · x_child + t` |
|---|---|
| group child → group | `R(q)`, `t` from the record, `s = 1` |
| sub-box → box | `R = I`, `s = 1`, `t = 4(lo_child − lo_parent) × quarter / 65536` Å: a 128-bit integer before the one division in binary64 (§1.10) |
| level `k−1` child `j` → level `k` | `R = I`, `s = f^(u(k−1) − u(k))`, `t = j · p_axis(k) / 65536` |
| seed copy and seed, selection and its base, edit and its base | identity: they share one frame |

For a run of `r` equal digits `d` on axis `a`, the composed translation is a geometric series with a closed form, so composing a descent of 10¹⁰⁰ levels costs O(runs), not O(levels).

### 8.3 Body frames

```
BodyFrame {
  ref                   // the body's piece: root and path (§7)
  anchorPath            // from the body's node to its anchor A; runtime state, empty for toys and monuments
  worldFromAnchor       // rigid transform, binary64: rotation and translation in metres
  metresPerAnchorUnit   // σ_A, binary64
}
```

A point `x` in A's frame is at `worldFromAnchor(σ_A · x)` in the world.

**Who owns the pose.** A toy or a monument is never larger than about 3 m, so its anchor is always its own node (§8.4) and its anchor path is empty.

- For a dynamic or kinematic body, RealityKit's entity transform is authoritative. The cut runs in a System ordered after the physics step. It refreshes `worldFromAnchor` from the entity's transform (Float32 to binary64 is exact) before it culls or refines, and it never writes a body entity's transform; only physics and the grab do.
- The body's draw items are children of its entity, through one render child that carries squash and hit-stop (plan §5.4). RealityKit composes them with the collider in the same frame, so nothing lags.
- Terrain is static, and at most one exists (§10.1). The app owns its `worldFromAnchor` in binary64, and its anchor may sit any depth below its node.

### 8.4 Rebasing

Let `σ_X` be metres per X unit, `radius_m(X) = σ_X · r(X)` with `r(X)` X's bounding radius, and `w_m(X) = σ_X · w(X)` with `w(X)` X's **narrowest width**:

- for a box, its shortest side;
- for a tower level, `min_a n_a · ω_a`, where `n_a` is its count of periods along `a` and `ω_a = |det| / |p_b × p_c|` is the period cell's width (§2.5);
- for a group or a leaf, the shortest side of its bounding box.

The focus point F is, in order of preference: the pinch centroid's hit on the body; the screen-centre hit; the camera position, when the camera is inside the body.

| Rule | Condition | Starting value |
|---|---|---|
| descend from A to its child C that contains F (§4.8) | `w_m(C) ≥ E_desc`, or `radius_m(A) > R_cap` | `E_desc` = 40 m, `R_cap` = 10⁸ m |
| ascend from A to its parent | `w_m(A) < E_asc` and A is not the body's node | `E_asc` = `z_far` = 20 m |
| steps per frame | at most 2 descents or ascents; flight moves the anchor by whole periods (§8.8) | |

- **Coverage.** An anchor with `w_m(A) ≥ z_far` has a 3 × 3 × 3 neighbourhood (§9.4) that contains every point within `z_far` of a camera anywhere inside A: on each axis the neighbours reach at least one width past A's faces. This holds for all three level shapes, (f,1,1), (f,f,1) and (f,f,f), which a radius threshold does not guarantee (a radius of 8 m covers only 1 to 9 m across a bar).
- **Precision guard.** At rest a tower anchor has `w_m(A) < f · E_desc ≤ 640 m`, and the slenderness limits (§2.5) keep its radius below `1.5 f × 2¹² × 640 m`, about 6.3 × 10⁷ m. A crystal box anchor has `w_m(A) < 3 E_desc` and a radius below 1.4 × 10⁷ m (aspect, §2.4). So `R_cap` never fires for towers or crystals; it guards groups, whose placements are free.

A descent through placement `(s, R, t)` updates the frame:

```
worldFromC.rotation    = worldFromA.rotation · R
worldFromC.translation = worldFromA.translation + worldFromA.rotation · (σ_A · t)
σ_C = σ_A · s
```

An ascent applies the inverse. A rebase is a change of representation, not of state: no drawn vertex moves by more than the bound of §8.6 across one (tested on Linux).

### 8.5 Drawing relative to a nearby origin

Every vertex position that reaches Float32 is relative to an origin near it: the item's local centre `c(X)`, and an entity or eye origin within metres of the item. All composition before that happens in binary64.

**RealityKit (M0 on).** An item's parent is a frame entity: the body's entity for a toy or a monument, or for terrain and face planes, a camera frame entity, kept within 2 m of the camera and moved (with its items recomputed) when the camera leaves that range. The frame entity's origin is the local centre of the node it carries. For each item, the cut computes in binary64

```
body:     entityFromItem(X) = Scale(σ_A) · T(−c(A)) · T(A ← X) · T(c(X))                       // metres
terrain:  entityFromItem(X) = cameraFrameFromWorld · worldFromAnchor · Scale(σ_A) · T(A ← X) · T(c(X))
```

with A the anchor and the camera frame entity's pose held in binary64, and casts it to Float32 once. Vertex data, merged meshes and instance positions are built relative to `c(X)`, in binary64, then cast once. RealityKit then composes `worldFromEntity · entityFromItem` itself in Float32.

A body entity's origin is its anchor's local centre: it shares `worldFromAnchor`'s rotation, and its translation is `worldFromAnchor.translation + rotation · (σ_A · c(A))`. Refreshing `worldFromAnchor` from the entity (§8.3) inverts that. The body's mass properties put the centre of mass where the proxy's is (plan §3.4).

**LupiEngine (M3b).** Items are composed relative to the eye and cast once:

```
modelToEye(X) = Float32( cameraFromWorld · worldFromAnchor · Scale(σ_A) · T(A ← X) · T(c(X)) )
```

The GPU computes `p_eye = modelToEye(X) · p_X` in Float32, with `p_X = x − c(X)`, so `|p_X| ≤ r(X)`. Atoms are drawn per 64-atom cluster, each about its own centre.

**Both.** `T(A ← X)` is the composition of the placements from A down to X; for an item above A, the inverse chain. Items above the anchor are drawn only where they come within `z_far`: a tower or crystal ancestor contributes its outer face planes (§9.4), never a far-away origin.

### 8.6 Precision bounds

**Eye-relative (LupiEngine).** Suppose every drawn item satisfies:

- (i) it lies within `z_far` = 20 m of the camera;
- (ii) it, or for atoms each 64-atom cluster, is no larger than its distance `d` from the camera. The cut refines larger items, and a cluster larger than its distance is drawn atom by atom;
- (iii) its anchor has `radius_m(A) ≤ R_cap` = 10⁸ m (§8.4).

Then its eye-space vertex error is at most `2⁻²³ (d + r) + 2⁻⁵⁰ × 10⁸ m ≤ 2.4 × 10⁻⁷ d + 9 × 10⁻⁸ m`. One pixel at distance `d` subtends about `d / 1,380` (the research's 1,380 px/rad, UNCONFIRMED per device). So the error is below **3 × 10⁻³ px** for every `d ≥ z_near` = 0.05 m, and below 5 × 10⁻⁴ px beyond 1 m, at every magnification and depth. This is the relative-to-eye technique of virtual-globe engines ([Cozzi and Ring](https://www.virtualglobebook.com/); [Ohlarik](https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm)) applied once per level of a hierarchy, and the Linux tests hold to it.

**RealityKit.** RealityKit composes our Float32 transforms with its own Float32 world and view matrices, so this bound does not describe what it draws. With frame entities within about 20 m of the session origin and items within `z_far` of their entity, every Float32 world position is under 40 m, and the composition errs by a few micrometres: about 0.15 px at `z_near` (5 cm) and under 0.01 px beyond 75 cm. That is sub-pixel at every magnification and depth. The Linux tests check what we cast; RealityKit's own arithmetic is not ours to test.

### 8.7 Magnification and λ

- The magnification of a body is `σ_A × 10¹⁰ / f^u(A)` (metres per Å × 10¹⁰).
- Its decimal logarithm is `λ = ℓ − u(A) · log10 f`, with `ℓ = log10(σ_A) + 10` in binary64 and `u(A)` an exact integer.
- It is held as the pair `(u(A), ℓ)`, never as one binary64 once `u(A) · log10 f` passes 2⁵⁰.
- **φ from the pair.** While `u(A) · log10 f < 2⁵⁰`, λ is formed in binary64 and φ follows §8.8. Beyond, λ is negative and `ln|λ| = ln u(A) + ln(log10 f)` to within 2⁻⁴⁰ (the ℓ term is negligible), with `ln u(A)` taken from its bit length and its top 53 bits, so `φ = −32 · (1 + ln|λ| − ln 32)` is finite for every v1 tower: about −7,254 for the googolplex bar, and −1.45 × 10⁶ for a tower of `levels` 2⁶⁵⁵³⁵.
- **Cap.** λ ≤ 11: one ångström drawn 10 m across. Nothing finer than an atom has detail, so a pinch stops there.
- **Readout.** Within ±32 decades it reads "life size" while |λ| < 0.005, and otherwise "shown m × 10^e times life size", the magnification itself with four significant digits ("shown 2.5 × 10^3 times life size"). Beyond, "shown 10^λ times life size", with λ printed in §5.5's scientific form: "shown 10^(−3.333 × 10^99) times life size". When `f ≠ 10` and `u(A) · log10 f ≥ 2⁵⁰`, it prints in the tower's base instead, "shown f^(−X) times life size" with `X = u(A) − ℓ / log10 f` (§5.5), because the decimal exponent is not exact there.

### 8.8 Pinch, detents and flight [P]

**Pinch.** A ratio `r` about a centre P scales the body:

```
worldFromAnchor.translation ← P + r · (translation − P)
σ_A ← r · σ_A
```

- P is the focus F for a held body or one in the air. For a body resting on a support (in contact during the last 0.1 s, with a contact normal within 45° of up), P is the lowest point of its bounds along gravity, so it grows and shrinks on its footprint and never sinks into what holds it.
- While pinching, the body is kinematic and its colliders scale with it every frame. A kinematic body that grows pushes the bodies stacked on it.
- At pinch end, the body takes its size state's mode (§10.1). If its proxy then overlaps anything, it is first lifted along +y until it is clear (at most its own height).

The map is continuous and exactly invertible.

**Scale axis.** The gesture moves along `φ(λ)`:

```
φ(λ) = λ                                    for |λ| ≤ 32
φ(λ) = sign(λ) · 32 · (1 + ln(|λ| / 32))    otherwise     (C¹ at |λ| = 32)
```

- Within |λ| ≤ 32 (everything from 10⁻³²× to 10³²× of life size), fingers map one to one.
- Beyond, a pinch moves φ, and a two-finger hold flies (§10.5).

**Detents** click at every decade while |λ| ≤ 32, at λ = 0 ("life size"), and at |λ| = 10ᵏ beyond, at most one click per frame.

**Flight speed.** The target speed is 400 φ/s while |φ| ≤ 8,192 and |φ| / 20.48 per second beyond, doubling every 14 s; the speed eases toward its target at a rate of 4 per second, `speed += (target − speed) · min(1, 4 dt)` (an acceleration of 4 φ/s² would take 100 s to reach 400 φ/s). So every v1 tower is crossed in bounded time: from the googolplex bar at desk size to its atoms in about 18 s, and from the top of a tower of `levels` 2⁶⁵⁵³⁵ in about two minutes.

**Wraps: the picture moves at a bounded rate while λ races.** Beyond |λ| = 32 a frame of flight moves λ by thousands of decades, and a tower repeats itself every 3 levels (log10 f decades). Zooming the picture that fast would land on a random phase of the repeat each frame, a strobe of boxes. So the picture and λ are decoupled:

- The displayed magnification changes by at most V = 0.03 decade per frame (0.015 in Gentle).
- The rest of λ's change is made by **wraps**. A wrap moves the anchor by whole periods (3 levels, a factor of f on every axis) and keeps `worldFromAnchor` and `σ_A` unchanged. A level and its descendant 3 levels down have the same extents in their own units, and the cut draws both as the same boxes, so a wrap leaves the picture exactly as it was while λ jumps by `log10 f` per period.
- A wrap is allowed only when the last cut drew nothing at or below the tower's seed copies, no removal touches the anchor's neighbourhood, and, on every axis whose root face lies in the neighbourhood, the anchor touches that face. A dive is aimed at a hit on the body's surface, so its anchor touches the face it dives into.
- A descending wrap of `n` periods appends 3n levels to the anchor path, the digits of each axis being constant: on an axis whose root face the anchor touches, the extreme digit (`f − 1` at the upper face, 0 at the lower); on any other axis, ⌊f/2⌋, the child that holds its parent's centre. So a dive of 10¹⁰⁰ levels adds about one run per axis to the anchor path. An ascending wrap removes 3n levels.
- Each frame wraps by as many whole periods as keep the remaining distance below one period plus V. Each wrap costs O(runs).
- When wraps stop (seed copies come into the cut near the atoms), the dive finishes at V per frame: the last few decades take a few seconds, in which the player sees the ions grow to marbles.

**Comfort.** Gentle halves the speeds and V. Still turns flight into cuts: λ jumps between detents with no visual zoom, each jump a wrap plus at most one rebase.

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
| solid view | a box: its atom envelope (the bounds of its atom centres grown by `r_atom`), oriented, in the aggregate colour, with optional lattice shading | `r_atom` in Å (`r_atom / f^u(k)` in a level's units): the box is exact up to atom bumps, at every level | its exposed atoms when materializable (§9.5), else its octants or tower children |
| tower level `k ≥ 1` of any other seed | a box: the period cells of its copies, grown to cover the seed's atom envelope, in the aggregate colour | `r(seed) + max_a \|p_a\| / 65536` in Å (divided by `f^u(k)` in the level's units): every atom lies in the box, and every point of the box lies within one period and one seed radius of an atom | its `f` children |
| leaf, capped crystal, other copies, selection | up to 8 splat spheres fitted to its 64-atom clusters (consecutive in Morton order, derived data) | the radius of its largest 64-atom cluster | its atoms (final) |
| group | up to 8 splat spheres fitted to its children | `max(max ε(child), r(group) / 2)` | its children |

A body whose node is a leaf of at most 2,000 atoms always draws as its merged mesh (the M0 path), whatever ρ says, and as `atomInstances` until that mesh is built (§9.6).

Errors are monotone, `ε(parent) ≥ max ε(child)`: by construction for towers (one value for every level, at least the seed's own error) and by the `max` for groups. Because a tower's error is the same at every level, `ρ` of a level depends on its size only through its nearest distance: every node whose bounds come within `R = ε σ K / τ` of the eye refines, down to its seed copies, and none beyond does. So the refined region is a ball of radius `R` around the eye, whatever the count, and outside it the tower stays a handful of boxes. The ball does not grow gradually: as the eye crosses `R`, a surface's cut goes from a few boxes to the copies within `R`, about `(K/τ)²` of them, which the budgets and τ's controllers (§9.3) bound. (Measured on Linux: a water grown 45 levels, 3 m across, went from 5 items at 0.4 m to 59,989 at 0.2 m with 60,000 items allowed, and stopped at 4,096 items, over budget, with the fair column.) An error that grows with the level, such as one child's extent, would make the cut the ring of boxes of a geometry clipmap ([Losasso and Hoppe 2004](https://hhoppe.com/proj/geomclipmap/)) at the price of boxes that read denser than their copies; v1 does not do that. A box drawn for a sparse seed reads denser at a distance than the seed really is; v1's only non-solid towers come from Grow (§10.7), whose copies sit 2.3 Å apart.

### 9.3 Budgets

Starting values for the iPhone 15 Pro (A17 Pro), **est.** Spikes S1, S2, S7 and S10 replace them with measurements.

| Budget | fair | serious | critical | iPad Pro (fair) |
|---|---|---|---|---|
| τ (px): start, and the controllers' minimum (their maximum is 8) | 1.5, 1.0 | 1.5, 1.5 | 2.0, 2.0 | 1.5, 1.0 |
| nodes visited per frame | 8,192 | 6,144 | 4,096 | 12,288 |
| draw items | 4,096 | 3,072 | 2,048 | 8,192 |
| atoms drawn by RealityKit instancing (before LupiEngine) | 5,000 | 3,000 | 2,000 | 8,000 |
| atoms drawn by LupiEngine impostors (M3b) | 150,000 | 75,000 | 50,000 | 250,000 |
| boxes and splats | 32,000 | 24,000 | 16,000 | 48,000 |
| leaf materializations per frame (background) | 8 | 4 | 2 | 12 |
| merged-mesh builds per frame (off the main actor) | 1 | 1 | 1 | 2 |
| traversal and draw-list CPU | 1.0 ms | 0.8 ms | 0.6 ms | 1.0 ms |
| resident scale cache | min(192 MB, 10 % of `os_proc_available_memory`) | same | same, plus eviction | min(384 MB, 10 %) |

**τ** is the larger of two controllers, each kept in [τ_min, 8], where τ_min is the thermal column's value; a thermal change moves τ_min, and a controller below it rises to meet it:

- **Frame time.** RealityKit exposes no per-pass GPU time, so through M3a the signal is the frame interval, the difference between consecutive `ARFrame` timestamps. The controller judges consecutive 0.5 s windows, starting at the first frame. At the end of a window with any interval over 1.5 display periods (a dropped frame) it multiplies by 1.25; at the end of any other window, once 2 s have passed since the last dropped frame (or the first frame), by 0.95. With LupiEngine (M3b), it also follows that pass's own GPU time (its command buffer's `gpuStartTime` and `gpuEndTime`) toward 8 ms: `τ ← τ · exp(0.5 (t − 8 ms) / 8 ms)`.
- **Budget.** A cut that was `overBudget` (§9.5) multiplies this controller by 1.25 at once, for the next frame. Each 0.5 s in which every cut kept its items, boxes and splats, instanced atoms and visits under 80 % of their budgets multiplies it by 0.9. Refinement therefore stays uniform in screen-space error: a budget never leaves a patchwork of refined and unrefined copies.

Frame rate is protected, and detail is what gets spent. On RealityKit the degradation order is: τ rises; the atom and box budgets drop to the next thermal column; 30 fps; the oldest loose pieces poof; the cache evicts to aggregates. The 30 fps step re-runs the session with a 30 fps `ARConfiguration.VideoFormat`; whether tracking survives that without a reset is UNCONFIRMED (spike A5), and if it does not, the step is skipped. Render scale has no RealityKit equivalent: with LupiEngine (M3b), its pass drops to 0.75× with MetalFX after the budgets.

### 9.4 Where the traversal starts

For each body:

- **The anchor is the body's own node.** Start from it. Every toy and monument does (§8.3).
- **The anchor is a crystal box or a tower level** (terrain). Start from the anchor's **index neighbourhood**:
  - In a tower: the 3 × 3 × 3 nodes at the anchor's level around it. A level-`k` node's index on axis `a` is the number formed by its digits on that axis above level `k`; neighbours add ±1 to it, with carries and borrows through the digit runs, at O(runs) each. The nodes of one level are congruent, so with `w_m(A) ≥ z_far` (§8.4) these 27 cover every point within `z_far` of the camera.
  - In a crystal: the boxes at the anchor's octree depth that hold the cells up to `⌈z_far / cell width⌉` cells beyond the anchor's faces, found by descending from the crystal's root (at most 60 octants). Boxes at one depth differ by at most one cell per axis, so these are at most 5 per axis.
  - Neighbours outside the root are dropped: compare per-axis indices with the root's per-axis counts.
  - "The root" is the innermost tower or crystal that holds the anchor. When it sits inside a group inside an outer tower (§2.8's tower of towers), the outer tower's neighbouring copies come in through the group rule below, so a camera within `z_far` of the inner tower's boundary can miss the outer tower's next copy until the anchor ascends.
  - Add a **face plane** item for each outer face of the root within `z_far` of the camera. The distance to it is an exact integer from the digits, converted only when small.
  - **Enclosed nodes.** A solid node whose 26 neighbours at its level all lie inside the root, carry no removal, and miss the excavation bubble (§10.1) is **enclosed**. Nothing of it can be seen, from outside (only the root's surface shows) or from inside (only the bubble's wall and removal walls show), so it is neither drawn nor refined.
  - **Faces turned away.** A solid node that carries no removal and does not meet the bubble, and whose exposed faces (§9.5) all turn away from the camera, is not seen either: the camera is on the inner side of each such face's plane, with two atom radii of slack for the outer layer's bumps. Solid nodes are axis-aligned boxes in their own frame (§9.2), so each face is a coordinate plane. An implementation SHOULD skip such a node like an enclosed one: without it a finite rung's slabs beside the view are visited and split, and guarantee 2 of §9.8 fails for small surface cuts (the 10⁹ rung cost 78 visits against 38 for the googolplex at the same view). The Swift cut does; the TypeScript reference, written for the web viewer, does not yet.
- **The anchor is inside a group.** Start from the group's children whose bounds come within `z_far` of the camera, at every group level from the anchor up to the body's node; record depth (§2.8) bounds the levels at 64.
- **Removals.** A node that carries removals and is not final, a starting node or any node met during the traversal, is refined whatever its ρ (§9.5), because its stand-in would draw what was removed: it splits into its remaining children, at most 256 per edit, within the same residency and budget checks as any other refinement.
- Starting nodes enter the heap of §9.5 in decreasing ρ while its budget invariant holds. Any that do not fit are dropped and the cut is `overBudget`. Only groups with many overlapping children can cause this, and it is the one case in which a cut may leave a hole.

### 9.5 The algorithm

```
buildCut(bodies, view, budgets, previousCut) → Cut:
  heap ← max-heap by ρ (ties: larger projected area first, then smaller key32)
  used ← 0        // per budget: the emitted items, plus the stand-in cost of every entry in the heap
  for each body, for each starting node S (§9.4), in decreasing ρ:
    if S is outside the frustum or enclosed: skip
    if used + cost(S) ≤ budgets: push S; used ← used + cost(S)
    else: overBudget ← true
  visited ← 0
  while heap not empty:
    X ← pop
    if visited = budgets.visits:
       emit X as its stand-in; continue                     // drain: counts no visit
    visited ← visited + 1
    wantRefine ← ρ(X) > τ, or (X was refined in previousCut and ρ(X) ≥ τ/2), or X carries removals
    if not wantRefine, or X is final:
       emit X as its stand-in (§9.2); continue
    kids ← the children of X (§9.2's last column) that are inside the frustum, not enclosed,
           and not occluded by last frame's Hi-Z (LupiEngine only)
    if any kid is not resident:
       request it (priority ρ); emit X as its stand-in; continue
    if used − cost(X) + Σ cost(kid) > budgets:
       overBudget ← true; emit X as its stand-in; continue
    used ← used − cost(X) + Σ cost(kid); push every kid
  return the emitted items, visited, overBudget, and the HUD's counts (each body's exact count, the atoms drawn)
```

- **`cost(X)`** is what X's stand-in draws: one item; its boxes and splats (one box, or up to 8 splats); and, for a final item of atoms, its atoms (only the exposed ones for a solid node).
- **Invariant.** `used ≤ budgets` holds after every step, and every heap entry is emitted as at most its stand-in. So no budget is ever exceeded, whatever the content.
- **Work.** Every pop is either an emit (at most `items` of them) or a visit (at most `visits`), and culled children are never pushed. So a frame makes at most `items + visits` pops, each O(log items) plus O(runs) for a tower child's digits.
- **Exposed atoms.** When a solid node is refined into its atoms, only the atoms of its outermost cell layer on each exposed face are drawn. A face is exposed when the neighbour across it lies outside the root, is removed, or meets the excavation bubble. A seed copy at a corner of a salt cube draws 488 of its 1,000 ions, one in a face draws 200, and an enclosed one is skipped. The atoms keep their materialization order; the selection is display data.
- **The bubble's wall.** The excavation bubble (§10.1) is a sphere, not a face layer, so a solid node that reaches it draws, besides its exposed face layers, its atoms outside the bubble within a shell two cells thick. Rays from an eye inside the solid then meet the wall within a few centimetres of the bubble's radius.
- No step depends on the atom count.

### 9.6 Swaps, fades, residency and loading

- **Swaps (RealityKit, M0–M3a).** There are no screen-door fades. `MeshInstancesComponent` carries per-instance transforms and, as far as Apple documents, no per-instance shader data; whether a `CustomMaterial` can read an instance index is UNCONFIRMED (spike S7). A refinement adds the children and removes the parent in the same frame, and the error bound keeps that swap under τ pixels. Where a swap changes texture (a box becoming atoms), the atoms scale in from radius 0 over 120 ms inside the box, which is removed when they reach full size; coarsening reverses it. Still comfort swaps at once.
- **Fades (LupiEngine, M3b).** An item entering or leaving the cut fades over 200 ms with a stable screen-door threshold (its `key32` against the fade value), using `discard` and no blending. Atoms stay opaque and need no sort.
- **Residency.** Decoded leaves and aggregates live in an LRU capped by the resident budget. Its keys need no hashing per visit:
  - records and their aggregates, by NodeID;
  - a tower level's aggregate, by (tower NodeID, k): every node of one level has the same shape and colour;
  - a crystal box's aggregate, by (crystal NodeID, extents, which far faces it owns);
  - a seed copy's materialization, by the copy's exact path within its tower (the tower NodeID and the digit runs from its top, interned per level so a lookup costs O(runs) and no hash); a crystal box's, by (crystal NodeID, lo, hi). Keying by copy key would hash every refined copy every frame.
  The only hashes in a frame are the copy keys of new materializations (at most the materialization budget), computed for the substitution when a copy is materialized, and the refKey of a new anchor. Nodes that are bodies, or on a shelf, are pinned at their aggregate. Materialized seed copies and crystal boxes are cheaper to regenerate than to store, so they are never written to disk.
- **Missing data draws the parent.** A missing child never leaves a hole.
- **Merged meshes** are built off the main actor (`MeshDescriptor`, or `LowLevelMesh`), at most one per frame (§9.3). A body waiting for its mesh, such as a fresh piece of a break, draws as `atomInstances` in its own entity meanwhile. The mesh replaces the instances once it is ready and the body is at rest or under 64 px across, because shading parity between the two is UNCONFIRMED. Spike S10 times the build for 1,000 and 2,000 atoms.

### 9.7 Draw items

```
DrawItem {
  kind          // leafMesh | atomInstances | box | splats | facePlane | atomsGPU | clusterSplats
  node          // root + path, or a resident handle
  transform     // Float32 3×4: entityFromItem on RealityKit, modelToEye on LupiEngine (§8.5)
  fade          // 0…1
  key32         // display key, below
  extras        // per kind: element runs for instances, half-extents and colour for a box, splat spheres
}
```

**`key32`** is a display key, never identity: the low 32 bits of `key64`. A starting node's `key64` is the first 8 bytes, read as a little-endian u64, of the refKey of its path, computed once when the anchor changes. A child's is `mix64(key64(parent) + 0x9E3779B97F4A7C15 × (i + 1))`, with `i` its octant, tower digit or group child index, and `mix64` SplitMix64's output function (§1.7, the steps after `z ← s`). Collisions only affect dithering and jitter.

**Backends** (scale.md §4):

| Kind | Drawn by |
|---|---|
| `leafMesh` | RealityKit merged mesh (bodies with ≤ 2,000 atoms) |
| `atomInstances` | RealityKit `MeshInstancesComponent`, one per element colour; also a fresh piece's atoms until its merged mesh is ready |
| `box` | RealityKit instanced unit cube, one component per material |
| `facePlane` | RealityKit plane |
| `atomsGPU`, `clusterSplats`, `splats` | LupiEngine (M3b); before it, `splats` draw as instanced spheres |

### 9.8 Guarantees (Linux tests)

1. **Budgets.** No budget is exceeded, for any camera, over random roots from 10³ to a googolplex, and no frame makes more than `items + visits` pops (§9.5's invariant).
2. **Same footprint, same cost.** For the same on-screen footprint and camera, the visited and emitted counts of the 10⁹, 10¹⁰⁰ and googolplex salt rungs agree within ±10 %, or within 10 when that is larger: as toys at a desk all three draw as one box, and on terrain where atoms show the 10⁹ rung starts from its root while the deep rungs start from an anchor's neighbourhood, which costs a constant handful of visits (about 8). Rungs anchored at the same level cut identically. For inside views at the same atom pixel size, the cut is identical for every rung that is deep enough.
3. **Coverage.** No region is drawn at two levels, and no visible, unremoved region is missing (a coverage test on a sampled ray grid). It runs with the camera inside anchors of all three level shapes, (f,1,1), (f,f,1) and (f,f,f), for f = 2, 10 and 16; on an edited crystal box, where nothing removed is drawn; and on a water grown by Grow ×2 (a non-solid tower) as the camera approaches, where at every distance the body is drawn exactly once, within the budgets, and the emitted count never falls as the eye nears. The count is not gradual (§9.2): it jumps when the eye crosses `R`.
4. Monotone error holds for every view generated.
5. With ρ unchanged, hysteresis never flips an item twice in consecutive frames.
6. **Flight.** In a simulated dive through the googolplex, a wrap changes no item of the cut (compared as eye-space boxes), and consecutive frames differ only by what V's zoom changes.
7. **Cost.** A release-mode benchmark of the Swift `buildCut` at 8,192 visits runs with the Linux tests and fails above 4 ms on CI hardware, taking the best of 15 frames, in up to three windows, because the test runner and the machine are shared. The device budget of 1 ms is measured by spike S2. The TypeScript reference is written for exact agreement, not speed (about 80 ms for the same frame on Node 22); its test asserts the 8,192 visits and gates the time loosely, and a web viewer that adopts it profiles against §9.3 for itself.

---

## 10. Physics and play [V, P]

### 10.1 Size states and spawning [P]

**Spawn size.** A molecule spawns at the plan's toy scale (plan §4.1). Anything bigger (a crystal, tower or group) spawns at the larger of a 15 cm longest span and a 3 cm shortest span, capped at a 30 cm longest span. So the googolplex bar (10 : 1 : 1) is 30 cm long and 3 cm thick, and a cube is 15 cm.

| State | When | Physics |
|---|---|---|
| toy | longest span ≤ 3 × its spawn span | dynamic body |
| monument | longer, up to 3 m | kinematic; up to 256 static shapes; other bodies land on it |
| terrain | over 3 m (at most one at a time) | static, below |

**Terrain physics.**

- **Face planes are global.** Each outer face of the terrain's root within 20 m of the camera is a static collider, a box 0.5 m thick behind the face. The planes are made once, when the terrain forms, and move with the camera frame entity (§8.5); no window rebuild ever removes them, so nothing falls through. (Holes left by chips get no planes; their atoms are windowed like any others.)
- **Atom windows.** Atom-level bumps are static spheres in windows: one of radius 1 m around the camera, and one of radius 0.5 m around each dynamic body slower than 1 m/s. A faster body collides with the face planes alone, with CCD on. A window is rebuilt asynchronously when its centre moves a quarter of its radius. All windows together hold at most 256 shapes: 64 for the camera's, and the rest shared among the slow bodies' windows, nearest bodies first.
- **Inside the solid.** When the camera is inside solid terrain, atoms within 0.35 m of it are not drawn (the excavation bubble). Toys are then parked, frozen and hidden in place outside the simulation, until the camera leaves the solid, and the terrain's colliders are off. No toy is ever spawned or moved inside matter, so none is born interpenetrating.

### 10.2 Felt mass: `lupi.feltmass.v1` [V]

RealityKit "works best if the size and mass ratios don't exceed one order of magnitude" (plan §3.4). Felt mass therefore stays in [0.06, 0.6) kg and keeps the true order of masses to a googolplex and beyond. With M the exact mass in Da (§5.3) and `massScale` the personality's (contracts.md §3.3):

```
M_k = 180 · 2^2.5 Da (≈ 1,018 Da);   a = 0.8 · ln M_k (≈ 5.541)
x   = ln M + 2.5 · ln(massScale)
b   = 0.2 · exp(0.4 · (x − ln 180))                    for x ≤ ln M_k     (= plan §4.2's 0.2 · (M/180)^0.4 · massScale)
b   = 0.6 − 0.2 / (1 + a · (ln x − ln ln M_k))           for x > ln M_k     (C¹ at the knee)
massKg = max(0.06, b)
```

- **The personality shifts the body along the curve** instead of scaling the result. Below the knee that is exactly the plan's `b(M) × massScale`; above it, the shift fades out, so no personality can push anything to the ceiling. `ln x` is computed as `lnln M + ln1p(2.5 · ln(massScale) / ln M)`, with `lnln M` from §5.5; the second term is dropped when `ln M` is not finite in binary64.
- **Order.** For one personality, felt mass is strictly increasing in M from about 9 Da (the 0.06 kg floor) up to and past a googolplex: `b` never reaches 0.6, so nothing clamps at the top. Across personalities, order is true whenever two masses differ by more than `(massScale ratio)^2.5`, at most (1.0 / 0.8)^2.5 ≈ 1.75 with the contract's table. A googolplex of salt, which is brittle, outweighs every molecule of every personality.
- **Below about 1 kDa nothing changes** from the plan: water 0.080, caffeine 0.206, C₆₀ 0.348 at `massScale` 1; hydrogen peroxide (brittle, 0.85) 0.087 and C₆₀ (bouncy, 0.8) 0.279, as in contracts.md §3.2.
- **Above it**, mass rises slowly instead of hitting the ceiling at 2.8 kDa:

| Structure | `massScale` 1 (kg) | brittle, 0.85 (kg) |
|---|---|---|
| hemoglobin (the human HbA tetramer, 64,458 Da) | 0.544 | 0.541 |
| salt 10³ (29,264 Da) | 0.537 | 0.533 |
| salt 10⁶ | 0.567 | 0.566 |
| salt 10⁹ | 0.575 | 0.574 |
| salt 10³⁰ | 0.586 | 0.586 |
| salt 10¹⁰⁰ | 0.590 | 0.590 |
| googolplex | 0.5998 | 0.5998 |

- **What it cannot do.** Above about 10 kDa the differences are a few percent, too small to feel in a throw, which sets the velocity directly. Felt mass keeps the order honest in collisions and in the hand; heft (§10.8) and the plaque carry the scale to the player.
- **Owner.** The function lives in LupiKit's `LupiPlay` as `FeltMass` (§11.1), taking `ln M`, `lnln M` and `massScale`, so personality derivation calls it without depending on LupiScale. It replaces LupiKit's `GameUnits` curve (50 g × (M/18)^0.4, up to 100 kg, growing with display scale), and contracts.md §3.3 rule 6 points here.
- Pieces of an expansion share their parent's felt mass instead (§10.6).

### 10.3 Inertia [V]

- **Leaf:** point-mass principal moments and axes, as LupiKit's `Inertia` (port of `objectFacts/inertia.ts`).
- **Crystal box:** the closed form for a uniform grid: `Cov = Cov(cell) + Σ_a ((e_a² − 1) / 12) · v_a v_aᵀ`, with `v_a` the cell vector of axis a and `e_a` the cell count.
- **Tower level `k`:** `Cov = Cov(seed) + Σ_a ((n_a² − 1) / 12) · p_a p_aᵀ`, with `n_a = f^C(a,k)`, normalized by the level's radius. The three `n_a` of one level differ by a factor of 1 or `f`, so the normalized tensor stays well within binary64 for every `k`, including a googolplex.
- **Group:** the parallel-axis theorem over its children, weighted by mass fractions `m_child / m_group`. Each fraction is formed in binary64 from exact plain masses (§5.3; a group's mass is below 2⁸³⁰ µDa, inside binary64's range), so no weight overflows.
- The inertia is `I = M (tr(Cov) E − Cov)`, and the body uses the shape tensor `I / (M r²)` times felt mass times display radius², with the smallest principal moment floored at 0.02 of the largest (plan §4.2).

### 10.4 Collision proxies [V]

| Node | Proxy |
|---|---|
| leaf, capped crystal, copy, selection | plan §3.4: one sphere per heavy atom at toy radius, each hydrogen folded into its partner (its radius × 1.15 per hydrogen, compounded: water is one sphere of 0.495 Å × 1.15²), grid-merged to at most 48 spheres |
| box, or tower level with orthogonal periods | one box (`ShapeResource.generateBox`): its atom envelope (§9.2), the same box that is drawn. Stacks hold on it. |
| tower level with oblique periods | the convex hull of its envelope's 8 corners (`generateConvex`) |
| group | children's bounding spheres; split the largest into its own proxy until 64 shapes, or every sphere is under 8 % of the group radius |
| edit | the proxy of the remaining children; holes smaller than 1/8 of the node are ignored |

- **Fresh pieces.** For their first 0.25 s, the pieces of a break use proxies inset by `r_atom · σ + 1 mm` on every side (spheres shrunk by the same), so no two pieces start in contact and the solver never has to push them apart.
- Proxies are cached under the same keys as aggregates (§9.6), together with a quantized `σ`.

### 10.5 Picking, gestures and bands [P]

**Picking.** A touch ray is tested against the current cut:

1. a BVH over draw items;
2. then the item's own shapes, so the box of a box item, or up to 64 atoms of a leaf, adjusted by the display-motion twin;
3. then refinement along the hit, bounded as §4.8 says: it stops at the first node on the hit whose displayed diameter is under one pixel, or under the bottom of the band the gesture picks from. The hit chain is a few dozen nodes at most, for a water or a googolplex.

The hit costs tens of µs (est.).

**Bands.** The hand band is 4 to 40 cm of displayed diameter, and the chip band 1 to 5 cm.

**Gestures.** One arbiter, `GestureArbiter` in LupiKit (pure Swift, tested on Linux with recorded touch streams), turns touches into exactly one of these. Thresholds are starting values.

| Gesture | Starts when | Does |
|---|---|---|
| tap | one finger, down and up within 250 ms, moving under 8 pt | selects the body and shows its plaque |
| grab | one finger down on a toy, then moving 8 pt or held 120 ms | grabs the whole toy, whatever its span (plan §3.5); releasing throws it |
| chunk | one finger down on a monument or terrain, moving 8 pt within 400 ms | detaches the deepest node on the hit chain in the hand band, as a new toy already grabbed |
| chip | one finger down on a monument or terrain, held still (under 8 pt) for 400 ms, then moving | detaches the node in the chip band under the finger, grabbed |
| pinch and twist | two fingers whose separation changes by 12 pt (or 6 %) before a hold is recognized | scales the selected or held body (§8.8) and turns it |
| fly | two fingers held still (separation and centroid each changing under 12 pt) for 300 ms, while \|λ\| > 32 | flies on in the direction of the last pinch (spreading flies toward smaller things), §8.8 |

- A gesture holds until all its fingers lift. A second finger during a grab starts pinch-and-twist of the held body, which stays held. During a fly, a separation change of 12 pt turns it back into a pinch.
- Chunks and chips only come from monuments and terrain: a toy is always grabbed whole.
- The web's gesture arbiter (`packages/ui/src/camera`) is the model for the structure, not for these thresholds.

### 10.6 Breaking and chipping [P]

**Two tiers.**

| Break | Threshold on the impact's Δv |
|---|---|
| a **bond break**: a leaf molecule of at most 2,000 atoms with a bridge in its game graph | `base(personality) · sqrt(E_weakest / 346 kJ/mol)` (plan §4.4) |
| an **expansion**: everything else (a leaf with no breakable bridge, a box, a tower level, a group) | `max(3.0 m/s, base(personality) · sqrt(E / 346 kJ/mol))` |

**The personality of a node that is not a molecule** comes from one **representative leaf**, derived once per NodeID by LupiKit's rules (contracts.md §3.3): for a crystal box, its crystal's 2 × 2 × 2-cell box at the origin (or the whole crystal when it is smaller); for a tower level or seed copy, its seed's materialization; for a group, its child with the most atoms (the lower index on ties), recursively; for an edit, its base's. So every salt rung is brittle, because its seed has ionic contacts.

- E for an expansion is the node's interface class, in game values, read from its representative leaf's game graph: lattice-ionic 60 when it has ionic contacts, else coordination 150 when it has coordination bonds, else covalent 346; noncovalent 40 for a group; an edit takes its base's.
- The 3 m/s floor lets a crystal survive a drop from 30 cm (an impact Δv of 2.9 m/s with restitution 0.2) and breaks it when thrown at a wall at about 2.5 m/s or more. Without it, brittle salt (lattice-ionic) would break when dropped from 1 to 4 cm.

**Expanding a body** makes up to `B` = min(16, 41 − dynamic bodies) pieces:

| Node | Pieces |
|---|---|
| a leaf molecule, at most 2,000 atoms, with a bridge in the game graph | plan §4.4: cut the weakest-class bridge nearest the contact; each component is a selection |
| a leaf with no breakable bridge (cages, crystals): at most 64 heavy atoms | chip: the heavy atom nearest the contact, with its hydrogens |
| a leaf with no breakable bridge: more than 64 heavy atoms | split into up to 8 selections by octant around its bounding-box centre |
| one-cell box | its atoms, as loose atoms for building (D9) |
| box with octants, tower level, group | its children: octants, the `f` children of a level (the googolplex bar breaks into ten cubes of 10^(10^100 − 1) atoms), or a group's children. When there are more than `B`, the `B − 1` children nearest the contact become pieces and the rest stays as one edit. |

**Pieces.**

- Each piece is a scale reference: the parent's path plus one step. Its identity is exact even though the contact point is not, because the play input picks the step and the step is exact (scale.md law 3).
- **Velocity:** the parent's velocity at the piece's centre, plus 0.4 m/s of separation outward from the parent's centre.
- **Felt mass:** a bond break's fragments are new molecules with their own felt mass (§10.2). An expansion's pieces share their parent's, `m_piece = max(0.06 kg, m_parent × M_piece / M_parent)`, with the ratio formed as `exp(ln(M_piece / M_parent))` of §5.5, so each of the googolplex bar's ten cubes gets exactly a tenth; a smash never multiplies the weight in play. A piece that is kept and later respawned takes its own felt mass from §10.2.
- **Size:** a piece whose longest span would be under 6 cm grows about its own centre to 6 cm over 0.2 s (at once in Still), and its magnification readout follows. While it grows it separates at its growth rate on top of the 0.4 m/s. So the bar smashes into ten 3 cm cubes that grow to 6 cm, and smashing on never makes millimetre bodies.
- **Proxies** are inset at first (§10.4).
- **Cooldown:** a bond break's fragment cannot break again for 0.25 s (plan §4.4), and an expansion's piece for 1.0 s, so one throw at a wall makes one smash, not a cascade.
- **Meshes:** nothing is built on the frame of the impact. A piece of at most 2,000 atoms draws as `atomInstances` until its merged mesh is built, one per frame (§9.6).

**Chipping** is the chip and chunk gestures (§10.5) on a monument or terrain.

- The chip is its path.
- The remainder is the parent minus it: a selection of the complement when the parent is materializable, otherwise an edit, flattened as §2.6 says.
- A full edit (§2.6) refuses: "this one is full".
- A trophy's record is never destroyed by play (plan §4.4).

### 10.7 Building and growing [P]

- **Snap** (plan §4.5) joins atoms into a new leaf. Atom order: the larger body's atoms first, then the other's, each in its own order. Its record is embedded in the trophy's reference, so its identity is whatever the app built; there is nothing to agree on across languages.
- **Grow ×2** (proposed; the owner to confirm):
  - **What grows.** A body whose piece is materializable (§4.5) becomes a new tower: its materialization as the seed leaf, `f = 2`, no substitution, `levels` 1. A body whose piece is the root of a factor-2 tower gets the same record with `levels` + 1. Other bodies do not grow in v1.
  - **Periods** [B], so that the same body grows into the same record on every device. On the diagonal, for each axis `a`, the period is `qmax − qmin + 150,733` Q16, where `qmax` is the maximum over the seed's atoms of `⌈x_a × 65536⌉` and `qmin` the minimum of `⌊x_a × 65536⌋`. Both are exact on Float32 positions (scaling by 2¹⁶ is exact), and 150,733 Q16 is 2.3 Å (2 × 0.9 Å + 0.5 Å) rounded up. If the record would break a limit of §2.5 (a very long, flat seed), Grow is refused.
  - **Span held.** The body keeps its longest displayed span: each tap divides σ by the growth of its longest extent, and the magnification readout shows it. So a grown body stays a toy, however many taps.
  - Water grown a hundred times is `3 × 2^100` atoms (§12.4), as cheap as one water.
- **Glue** of arbitrary bodies into a group is reserved and not in v1.

### 10.8 Heft: sound and haptics [P]

`h = log10(1 + log10(M / 1 Da))`, from §5.5's `ln M`, or as `(lnln M − ln ln 10) / ln 10` when `ln M` is not finite. Values: water 0.35, C₆₀ 0.59, salt 10⁶ 0.93, salt 10⁹ 1.06, salt 10¹⁰⁰ 2.01, googolplex 100.

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

A Swift package (tools 6.0, Swift 6 language mode, Foundation only, iOS 26 and macOS 26) with two library targets, over LupiKit through `.package(path: "../LupiKit")`:

- **`LupiScaleCore`** holds everything marked [B]. It has no dependencies, so the byte-exact layer never moves with anything else.
- **`LupiScale`** depends on `LupiScaleCore` and on LupiKit's `LupiChem` (element table, bond perception, graph cuts) and `LupiPlay` (personalities, felt mass).

**One owner for each shared piece**, so that nothing is duplicated and no dependency runs both ways:

| Piece | Owner | Users |
|---|---|---|
| SHA-256 (FIPS 180-4) | `LupiScaleCore`'s own, package-internal (`SHA256Hasher`, incremental, with the domain strings of §1.5), so it adds no public `SHA256` to an app | `LupiScaleCore`. The public SHA-256s that LupiKit's `LupiData` and LupiCloud's `LupiAuth` declare are outside this spec; folding them into one is LupiKit's work (plan.md). |
| felt mass `lupi.feltmass.v1` (§10.2) | LupiKit's `LupiPlay`, as `FeltMass`, over a `MassLog` (`ln M`, `lnln M`) | `Personality.derive`, and LupiScale for nodes (it turns a Magnitude into a `MassLog`, §5.5) |
| personalities and their table (contracts.md §3.3) | LupiKit's `LupiPlay` | LupiScale derives a node's personality from one materialized leaf (§10.6) |
| the gesture arbiter (§10.5) | LupiKit's `LupiPlay` | the app |

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
public struct Magnitude: Sendable, Hashable {                                     // §5: == and hash by canonical form
    public init(_ value: BigUInt); public static func tower(seedCount: BigUInt, factor: UInt8, levels: BigUInt) -> Magnitude
    public static func + (a: Magnitude, b: Magnitude) throws -> Magnitude          // ScaleError.base across families
    public static func - (a: Magnitude, b: Magnitude) throws -> Magnitude
    public func compare(_ other: Magnitude) throws -> Int                          // −1, 0, 1; not Comparable (§5.2)
    public func multiplied(by k: BigUInt) throws -> Magnitude                      // mulSmall (§5.2)
    public var displayBase: UInt8 { get }; public var formatted: String { get }
    public var key: String { get }                                                 // the canonical form as text (§5.2)
    public var lnM: Double { get }; public var lnlnM: Double { get }               // §5.5 [V]
    public func lnRatio(_ other: Magnitude) -> Double                              // ln(self / other), §5.5 [V]
    public func scientific(times q: Double) -> String                              // ≈ m × b^E, §5.5 [V]
    public static let kgPerMicroDalton: Double                                     // 1.6605390666e-33
}
public struct Composition: Sendable, Hashable {                                   // §5.3
    public var unit: [UInt8: BigUInt]; public var copies: Magnitude; public var removed: [UInt8: BigUInt]
    public var formula: String { get }; public var formulaText: String { get }; public func massMicroDa() throws -> Magnitude
}
public protocol NodeStore: Sendable { func record(_ id: NodeID) throws -> NodeRecord }
public struct View: Sendable { /* leaf | group | box | capped | level | copy | selection, with pending removals */ }
public struct Resolver: Sendable {
    public init(store: NodeStore)
    public func root(_ id: NodeID) throws -> View
    public func step(_ view: View, _ step: Step) throws -> View
    public func resolve(_ id: NodeID, _ path: Path) throws -> View
    public func count(_ view: View) throws -> Magnitude
    public func composition(_ view: View) throws -> Composition                    // unit × copies − removed (§5.3)
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
public enum CRC32 { public static func checksum(_ bytes: [UInt8]) -> UInt32 }     // SHA-256 is package-internal (§1.5)
public struct SplitMix64 { public init(seed: UInt64); public mutating func next() -> UInt64 }

// LupiScale
public struct Aggregate: Sendable { /* bounds, geometricError, splats, colour, shape tensor, count, massMicroDa */ }
public struct BodyFrame: Sendable { public var ref: ScaleRef; public var anchorPath: [Step]   // runtime, unlimited (§8.3)
    public var worldFromAnchor: RigidD; public var metresPerAnchorUnit: Double }
public struct ViewState: Sendable { public var cameraFromWorld: RigidD; public var fovY: Double; public var viewportHeight: Int
    public var viewportWidth: Int                                                  // for the frustum; defaults to the height
    public var zNear: Double; public var zFar: Double }
public struct Budgets: Sendable { public var tau: Double; public var visits, items, instancedAtoms, engineAtoms, boxesAndSplats, materializations, meshBuilds: Int
    public var residentBytes: Int; public var tauMinimum: Double                   // τ_min of the thermal column (§9.3)
    public static func iPhone15Pro(_ thermal: ThermalLevel) -> Budgets; public static func iPadPro(_ thermal: ThermalLevel) -> Budgets }
public struct TauController: Sendable { public init(budgets: Budgets); public var tau: Double { get }; public var minimum: Double
    public mutating func frame(at time: Double, interval: Double, displayPeriod: Double, overBudget: Bool, usage: Double)
    public mutating func gpuTime(_ milliseconds: Double) }                        // §9.3: the larger of two controllers
public struct Cut: Sendable { public var items: [DrawItem]; public var bodyCounts: [Magnitude]; public var drawnAtoms: Int
    public var visited: Int; public var overBudget: Bool }                       // the HUD sums bodyCounts when it can (§5.2)
public func rebase(_ frame: inout BodyFrame, focusWorld: SIMD3<Double>, resolver: Resolver) throws
public func buildCut(bodies: [BodyFrame], view: ViewState, budgets: Budgets, previous: Cut?, resolver: Resolver) -> Cut
public func pick(ray: RayD, cut: Cut, band: ClosedRange<Double>, resolver: Resolver) -> PickResult?   // bounded, §4.8
public func collisionProxy(for view: View, metresPerUnit: Double, maxShapes: Int, resolver: Resolver) throws -> [CollisionShape]
public func massLog(massMicroDa: Magnitude) -> MassLog                                           // §5.5, for LupiPlay's FeltMass (§10.2)
public func personality(for view: View, resolver: Resolver) throws -> PersonalityDerivation     // §10.6, cached by NodeID
public func expand(_ body: BodyFrame, contactWorld: SIMD3<Double>, budget: Int, resolver: Resolver) throws -> BreakPlan
public func grow(_ body: BodyFrame, resolver: Resolver) throws -> NodeRecord                    // §10.7

// LupiKit's LupiPlay (for reference)
public struct MassLog: Sendable { public var lnM: Double; public var lnlnM: Double }             // lnM may be +infinity
public enum FeltMass { public static func kg(_ mass: MassLog, massScale: Double) -> Double }      // lupi.feltmass.v1, §10.2
```

Types named but not spelled out (`DigitRun`, `AtomRange`, `Substitution`, `RigidD`, `RayD`, `DrawItem`, `PickResult`, `CollisionShape`, `BreakPlan`, `ThermalLevel`) follow the sections cited next to their use.

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
export function addMagnitude(a: Magnitude, b: Magnitude): Magnitude;    // throws ScaleError('base') across families (§5.2)
export function compareMagnitude(a: Magnitude, b: Magnitude): -1 | 0 | 1;  // likewise
export function magnitudeKey(m: Magnitude): string;                     // the canonical form as text (§5.2), as Swift's Magnitude.key
export function mulSmallMagnitude(m: Magnitude, k: bigint): Magnitude;  // §5.2, any plain k
export function scientific(m: Magnitude, q: number): string;            // §5.5 [V]; KG_PER_MICRO_DALTON = 1.6605390666e-33
export function removeFrom(edit: EditNode | { base: NodeID }, removal: Step[]): EditNode;   // §2.6's flattening
export function writePack(records: Uint8Array[], opts?: { roots?: { name: string; id: NodeID }[]; deps?: NodeID[] }): Uint8Array;
export function readPack(bytes: Uint8Array): Pack;                  // §6.6 conformance
export function encodeRef(ref: ScaleRef): Uint8Array; export function decodeRef(bytes: Uint8Array): ScaleRef;
export function refText(bytes: Uint8Array): string; export function refKey(root: NodeID, path: Uint8Array): NodeID;
export function resolveRef(bytes: Uint8Array, extra?: NodeStore): { view: View; count: Magnitude };
export function bakePartition(z: Uint8Array, positions: Float32Array): { records: Uint8Array[]; root: NodeID };
export function buildCut(bodies: BodyFrame[], view: ViewState, budgets: Budgets, previous?: Cut,
                         options?: { debug?: boolean; cache?: CutCache }): Cut;   // later, for the web
export class TauController { constructor(tauMin: number, start: number); frame(t: number, period: number, cut: Cut, budgets: Budgets): number; gpuTime(ms: number): number }
```

The cut reads records, and a TypeScript `BodyFrame` carries its own `resolver` with `root` and `path` (in place of Swift's `ref`), so bodies from different packs share one call; its `ViewState` carries `aspect` (width over height) where Swift's has `viewportWidth`; `options.debug` returns the regions skipped as enclosed or culled, for the coverage tests, and `options.cache` keeps materializations and aggregates across frames.

The web viewer adopts the same data in its own time: `BillionAtomBlock` becomes the copper crystal record and its hand-tuned tiers fall out of `buildCut`, `AtomsOptimized` draws materialized leaves, and `lupi.status` reports counts with `formatMagnitude`.


---

## 12. Test vectors [B]

Everything below was computed with a scratch implementation of §1–§7 while this spec was written. The rows §0 lists were re-derived by a separately written Swift program (its own SHA-256, CRC-32, SplitMix64, BigUInt and generators) and matched exactly. The TypeScript implementation MUST reproduce all of them before writing `scale-v1.json`. The fixture file also carries every intermediate (all twelve diamondoids, all ladder rungs, the pack bytes) for the Swift tests. The vectors added on 2026-10-05 (§13.1: nested removals, record depth, several dopants per copy, caffeine's first Grow tap, the bundled pack's root names) come from the TypeScript reference and are reproduced by the Swift implementation's own code.

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

- Googolplex: formula BrCl499Na500, formula text `BrCl499Na500 × 10^(10^100 − 3)`; mass 2.9264454 × 10^(10^100 + 7) µDa.
- The googolplex with child 9 and the grain removed: formula text `BrCl499Na500 × (9 × 10^(10^100 − 4) − 1)`.
- Caffeine leaf: C8H10N4O2, 194,194,000 µDa.
- `µDa` of S, Zn and Xe (the three masses whose binary64 product with 10⁶ is not an integer): 32,060,000, 65,380,000 and 131,290,000.

**A removal inside a seed copy.** The salt seed in a tower of factor 10 with the salt periods, `levels` 3 and no substitution (record `4c55504e040100006f0000002ef8502fcd22e4b098c57e85c0bd1b6793ff8be13f9b330d0017f1c9561e3f3e0a00000074331c000000000000000000000000000000000000000000000000000000000074331c000000000000000000000000000000000000000000000000000000000074331c0000000000010003`, NodeID `31e0ec4ca049b549f939cd0b170459cdca96f41a466824aec7eb58c53400ee27`), edited to remove octant 0 of seed copy (0, 0, 0):

- Removal path `020003010003010000010001010000010001010000010001020100`: a tower step to level 0, then `cells 0`.
- Edit record `4c55504e050100004300000031e0ec4ca049b549f939cd0b170459cdca96f41a466824aec7eb58c53400ee27010000001b000000020003010003010000010001010000010001010000010001020100`, NodeID `ee3b568af6b6583687b1efe9e65f7e472541e052eb03ec54935a56becfb6c4d2`.
- Count 999,784 (one octant is 27 cells of 8 ions). Formula Cl500Na500; formula text `Cl500Na500 × 1,000 − Cl108Na108`; mass 29,213,688,480,000 µDa.
- Inside the edit: copy (0, 0, 0) resolves, with 784 atoms and probe `e5d83bf7fcf5686f3ec7b398323feab9c4a43de3f89ac91b6909d3a6f4117fa5`; its octant 1 resolves, with 144 atoms; its octant 0, or anything below it, fails with `path`.

**Nested removals (§4.4).** The salt seed edited to remove `cells 0, 3` (16 ions; edit NodeID `b213364182f77577861945d0948660b87c042a1e75bb0898651e5521da98aecb`), as the seed of a factor-10 tower with the salt periods, `levels` 3 and no substitution (NodeID `c9920489607ed1aac084973934d380a10bf709509283599038b4ebcf71388fb1`), edited again with the removal path above (copy (0, 0, 0), `cells 0`; NodeID `ae3d9e6017238f0d77c616ff5f0a2afccdb4964ce1ff2d58f41110b9b6e15024`):

- Count 983,800, formula text `Cl492Na492 × 1,000 − Cl100Na100`, mass 28,746,636,000,000 µDa. The outer removal takes the 200 ions its octant still holds.
- Copy (0, 0, 0) resolves, with 784 atoms and the same probe as copy (0, 0, 0) of the single edit above, `e5d83bf7…`.
- The same two removals at one view: a one-child group over the edited seed (NodeID `26ea60e894f469565c8948e8a884d1118f4be7621fc0e364cd81344ed4249667`), edited to remove `child 0`, `cells 0` (NodeID `0f0f948acaf62cd1a1c271b64bd0a8e10427a4925e8bfc39ce1b22143ceacdff`), counts 784, and so does its child 0.

**Record depth (§2.8).** A chain of one-child groups with identity placements over the water leaf: the group 64 records deep (NodeID `832b63591d94ca90705b33c2be76af4b57af66ce9d7933b953790c002ec5a75f`) counts 3, and 63 `child 0` steps reach the water leaf, whose probe is its own NodeID. The group 65 records deep (NodeID `2f30eae5f1a5b672b223029ba74c6b6eab87100eca29f81029e69cd5254085cb`) fails with `limit` when counted from its root, after 1 or 63 `child 0` steps, and after 64 (the walk's 65th record).

**Several dopants per copy (§3.4.6).** The salt seed in a tower of factor 10 with the salt periods, `levels` 1 and Cl → Br seven per copy (NodeID `2992ef6bafad40a949412d9e1189db917eafae7209adc7f38fe22c3b009b08d1`): copy 3 has copy key `0x9462782503d6a991`, Br replaces atoms 358, 148, 757, 244, 628, 53 and 261 in that order, its formula is Br7Cl493Na500 and its probe `fc73e821f52c5a8551faefa7ca3f8746c5b51e1d51067745c6402b5425621f0e`.

**A tower of towers.** A tower whose seed is the 10⁶ rung itself is rejected with `validity` (§2.8). Wrapped in a one-child group, it resolves:

- Group record `4c55504e020100005c00000001000000cd481a1353e063838be8fc0c55f420b977465a8f1db3e959460aaa34ac4b8df8000000000000000000000000000000000000000000000000000000000000f03f000000000000000000000000000000000000000000000000`, NodeID `bdd05a247b85878be2d11bbd16470d62cdc722d182ec124f76aa212e898d0cfa`.
- Over it, factor 2, periods ten times the salt periods, `levels` 1: record `4c55504e040100006f000000bdd05a247b85878be2d11bbd16470d62cdc722d182ec124f76aa212e898d0cfa0200000088021a010000000000000000000000000000000000000000000000000000000088021a010000000000000000000000000000000000000000000000000000000088021a0100000000010001`, NodeID `6bff9b557dcb5058dcb4126f001f7415a617e43e3bf31e3922c6adeea4d3bfa6`, count 2,000,000.
- The path `tower` (x digit 1), `child 0`, `tower` (to level 0, all digits 0) is `0300030100010100010100010000000001000003010003010000010001010000010001010000010001`. It reaches a seed copy with probe `7e800b0105dba71bf11d993caf7b8a7c44c922cbe44ebfd766c57626118d7202`, the same in both copies of the outer tower, because they instance one record.

**Grow ×2.** Water (the leaf above) as seed, factor 2, periods 190501, 224869, 214389 Q16 on the diagonal (§10.7's integer rule), `levels` 100: 123-byte record, NodeID `56f05f1af0f47e8b00834c5742f6e6e7b4ad7a1f63b31cadb476ed79a5610aac`, count 3 × 2^100. With `levels` 1 (the first tap), NodeID `9a0d1fadcc862005945fb3a802e644fcb96ab88b7beccd45de8d2bb7889f8ddf`. Caffeine's first tap has periods 630870, 567700, 268672 Q16 and NodeID `5a9910437443a8940531924ebba289e763528199483fccd6c56ff690c0173358`.

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

**A small pack** holding the water leaf, the salt seed and the googolplex tower, with roots `salt-googolplex` and `water`: 65,536 bytes; contentId `a91476434956a8fc564e9328db078a20864d0053e674734e89da55b4675f6256`; header CRC `ac22309b`; SHA-256 of the file `64235b518944425f713f018008f94171525328d7627e00865cff8a5d9442c2a8`.

| Section | Offset | Length | CRC-32 |
|---|---|---|---|
| NIDX | 16,384 | 152 | `1acbd66a` |
| NREC | 32,768 | 280 | `b01bfc5e` |
| ROOT | 49,152 | 100 | `dde7474c` |

Header (128 bytes) and section table:

```
4c55504b01000000800000000300000080000000000000000000010000000000
a91476434956a8fc564e9328db078a20864d0053e674734e89da55b4675f6256
0000000000000000000000000000000000000000000000000000000000000000
000000009fae118f00000000000000000000000000000000000000009b3022ac

4e49445801000000004000000000000098000000000000006ad6cb1a01000000
4e52454301000000008000000000000018010000000000005efc1bb001000000
524f4f540100000000c000000000000064000000000000004c47e7dd01000000
```

**The bundled scale pack** `lupi-scale-r1.lpk` (the six salt rungs and their seed, copper open and closed, diamondoids 1 to 12; 21 records) has 20 roots, named `salt-thousand`, `salt-million`, `salt-billion`, `salt-e30`, `salt-googol`, `salt-googolplex` (the rungs, `levels` 0, 3, 6, 27, 97 and 10¹⁰⁰ − 3), `copper-billion` and `copper-billion-closed` (Cu 630³ open and closed) and `diamondoid-1` to `diamondoid-12`. The names are part of its contentId (§6.2.1). It is 65,536 bytes; contentId `4ec7833bd79b74af882a100e2ef121fa928a01c02dcc5dc66e2282a127377e97`; file SHA-256 `d5f1d7ba69da089b970e7f1cdfe1f6e530c17d006c268ceee4bad0cd795a2794`.

**`massive_1m.glimbin` through `lupi.bake.partition@1`:** 953,312 Cu atoms → 233 leaves (the last holds 3,040 atoms) and 35 groups, depth 4; root `08588107c1be69ef9816bb4226c25e65b2dae3d2da2edf3fb9420fff76664cca`; pack (root `massive_1m`) 12,484,608 bytes, contentId `c760f77ae2225153e842d6f1dd164fe6470de5741a75f2bd9e0603f92b307f08`, file SHA-256 `b12f3e7a79ac58774e4b79b0066b08f91f79a669816c672d3748b978177e9b85`; the resolver counts 953,312 atoms.

- Keeping its first leaf (path `child 0`, `child 0`, `child 0`) embeds the leaf (53,264 bytes) and the three groups on the path (368, 720 and 720 bytes): a 55,171-byte reference, 73,567 characters as text, that resolves with no pack (§7.2). By dependency alone it would be 115 bytes.

---

## 13. Change control [B]

**What v1 freezes.** Everything marked [B], each part at the milestone §0 names (M1 for what trophies carry, M3b for groups and packs):

- the record layouts and kinds 1–5 at `kindVersion` 1, with the limits of §1.9 and the contextual rules of §2.8;
- the site tables, orders and roundings of §3;
- the step tags 1–4 and the canonical rules of §4;
- Magnitude's canonical form, the composition and formula text of §5.3, the mass table `lupi.mass.v1`, and the formatting of §5.4;
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

**Past the v1 ceiling.** v1 is honest about where it stops:

- **Counts** are exact up to about 10^(2.4 × 10¹⁹⁷²⁸), far past a googolplex.
- **Paths** address every node of a v1 tower whose digit strings, within one tower step, have at most 4,096 runs per axis, in a path of at most 65,536 bytes and 1,024 steps. That covers every node play can reach: a smash adds at most one run per axis, a chip at most a few dozen (its bounded descent, §4.8), and a dive about one (§8.8). It does not cover a node whose index digits are arbitrary, such as the seed copy at a random index of a googolplex, whose 10¹⁰⁰ digits have about as many runs; no gesture produces one. A keep past the limits falls back as §7.2 says.
- **Anchor paths** are runtime state with no limit (§8.3).

Going further needs no rewrite:

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

### 13.1 Changelog

v1 is not frozen until it reaches `main` (§0), so these entries revise v1 in place; after that, every entry is a new version.

**2026-10-05, conformance.** The TypeScript reference (`packages/core/src/scale`) and the Swift package (`apps/apple/LupiScale`) were built to this spec separately, and Swift now asserts every value of the reference's fixtures. Each implementation kept a list of what the spec got wrong or left open; this entry settles every item, and the lists are gone. No vector of the earlier §12 changed.

| § | Decision | Source |
|---|---|---|
| §1.5, §11.1 | `LupiScaleCore` has no dependencies and keeps its own SHA-256, package-internal, instead of depending on a LupiKit `LupiCore` target that does not exist; it adds no public `SHA256`. | Swift |
| §2.7 | A reader checks an opaque record's magic and length only, not its flags. | TS |
| §2.8 | Record depth is checked as a walk of at most 64 records plus, for a subtree evaluation, the walk's length minus one plus the subtree's depth; the depth-65 chain of §12.4 pins it. A removal that does not resolve in its base is `validity`. | TS, Swift |
| §3.6 | The Morton order must be exact; `bigint` is one way, not a requirement. | TS |
| §4.3, §4.5 | A box is materializable on its own §3.3.2 count, before its removals. | both |
| §4.4, §5.3 | A count or composition subtracts only the outermost removals of a view, each with the removals nested inside it applied. The literal formula subtracted an inner edit's atoms twice (983,784 for 983,800); the Swift resolver did, and now does not. | both |
| §4.7, §6.6 | Every decoding rule has one code: `range` for one field outside its values, `validity` for fields that break a rule relating them, `limit` for the size limits of readers, `canonical` for a second encoding. Nine Swift record checks and one path check changed code. A record in a pack that hashes but breaks §2 is `pack`; the TypeScript reader surfaced the record's own code. A wrong or missing probe is `mismatch`. | fixtures, Swift |
| §5.2 | A plain value joins any family; two runs values of different families are `base`. `mulSmall` takes any plain factor, since a unit mass reaches 2²⁸⁵ µDa; the TypeScript bound of 2²⁵⁶ is lifted. `key` is the canonical form as text, in both APIs. | TS, Swift |
| §5.3 | A product in the formula text has no parentheses. | TS |
| §5.4.2 | `z` is the whole trailing zero run (`125 × 2^103`). A runs value whose display base is of another family prints in its own root base. | TS, Swift |
| §5.5 | The scientific display's mantissa renormalizes when it rounds up to the base, `c` is rounded to binary64 once, and Swift gains the display. `ln(M_a / M_b)` subtracts digit counts exactly, for §10.6's piece shares. | TS, Swift |
| §6.4 | ROOT's padding is per entry. | TS |
| §6.6 | Zero pages between and after sections are accepted, and section flag bits other than bit 0 ignored, as written; the fixtures pin both. | TS |
| §7.2 | The embedded records are those that resolving, counting and probing the target read. | conformance |
| §8.7 | The readout within ±32 decades: "life size", or "shown m × 10^e times life size". | Swift |
| §8.8 | Flight eases toward its target speed at a rate of 4 per second. | Swift |
| §9.2, §9.8.3 | Refinement is not gradual: with one error per level, a ball of radius `R` around the eye refines all at once. The claim and the factor-of-2 test are dropped; the test checks what holds. | both |
| §9.3 | τ is the larger of two controllers with stated windows; the Swift controller, which multiplied one τ by both, now follows the reference. | TS, Swift |
| §9.4 | Nodes with removals below the starting nodes are split whatever their ρ, in both cuts. A solid node whose exposed faces all turn away SHOULD be skipped (the Swift cut does). The neighbourhood is taken in the innermost tower or crystal. | TS, Swift |
| §9.5 | The bubble's wall draws a shell of atoms two cells thick. | Swift |
| §9.6 | A seed copy's materialization is resident under its exact path, not its copy key, so a frame hashes only new materializations. | Swift |
| §9.8.2 | Same footprint, same cost: within ±10 % or 10, whichever is larger. | Swift |
| §9.8.7 | The 4 ms bound is the Swift release benchmark's. | TS |
| §10.2 | Hemoglobin is 64,458 Da. `FeltMass` and `MassLog` now live in LupiKit's `LupiPlay`, as §11.1 always said; LupiScale's interim copies are gone. | Swift |
| §10.4 | A hydrogen folded into its partner grows its radius by 1.15, compounded. | Swift |
| §11.1, §11.2 | Swift adds `ViewState.viewportWidth`, `Budgets.tauMinimum`, `TauController` and the Magnitude members above; TypeScript's `BodyFrame` carries its resolver and `buildCut` an options argument. | TS, Swift |
| §12.4, §12.6 | New vectors: nested removals, record depth, several dopants per copy, caffeine's first Grow tap. The bundled pack's twenty root names, which its contentId depends on, are listed. | TS, Swift |
