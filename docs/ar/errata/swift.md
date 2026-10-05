# Errata found building `apps/apple/LupiScale` (Swift)

Problems in [scale-spec.md](../scale-spec.md) found while building the Swift implementation. The spec is unchanged; each entry says what the Swift code does meanwhile, so the TypeScript implementation and the owner can agree on a fix. Numbers come from `swift test` and `swift test -c release` on Linux (Swift 6.4.0), at commit `b261783` on `ar/ssw`.

Each entry gives the section, the words in question, the problem, the evidence and the Swift resolution.

## A. Byte-exact layer (§1–§7)

### A1. §11.1: who owns SHA-256

- **Quote.** "`LupiScaleCore` holds everything marked [B]. Its only dependency is LupiKit's `LupiCore`, for SHA-256."
- **Problem.** LupiKit has no `LupiCore` target on this branch (its SHA-256 is in `LupiData`), and the build directive asks for `LupiScaleCore` with no dependencies.
- **Evidence.** `apps/apple/LupiKit/Sources` holds `LupiChem`, `LupiData` and `LupiPlay` only.
- **Resolution.** `LupiScaleCore` carries its own FIPS 180-4 implementation as `package struct SHA256Hasher` (`Sources/LupiScaleCore/Hashes.swift`), not public, so no second public `SHA256` exists for an app importing both packages. When LupiKit gains `LupiCore`, `LupiScaleCore` can depend on it and drop the copy; the tests (CRC, every NodeID of §12) pin the behaviour.

### A2. §12.6: the bundled pack's root names

- **Quote.** "The bundled scale pack `lupi-scale-r1.lpk` (the six salt rungs and their seed, copper open and closed, diamondoids 1 to 12; 20 roots, 21 records): 65,536 bytes; contentId `4ec7833b…`"
- **Problem.** The contentId depends on the root names (§6.2.1), and the spec does not list them, so a second implementation cannot reproduce the vector from the spec alone.
- **Evidence.** The names `salt-thousand`, `salt-million`, `salt-billion`, `salt-e30`, `salt-googol`, `salt-googolplex`, `copper-billion`, `copper-billion-closed` and `diamondoid-1` … `diamondoid-12` reproduce the contentId and the file SHA-256 exactly (`PackTests.bundledScalePack`).
- **Resolution.** The test uses those names. Proposed: state them in §12.6.

### A3. §6.6 and §6.5: which error for which rule

- **Quote.** "A reader MUST reject the pack (error `pack`, `crc`, `version`, `unsupported` or `mismatch`) unless all of these hold".
- **Problem.** The rules are not mapped to codes, and the writer's failures (§6.5) have none.
- **Resolution.** Reader: `crc` for any CRC, `version` for `versionMajor` ≠ 1, `unsupported` for an unknown required section, `mismatch` for a record hash or the contentId, `pack` for every other rule (magic, sizes, alignment, padding, ordering, NIDX/NREC shape, ROOT and DEPS, and a record that fails §2 inside a pack). Writer: `limit` for counts (records, roots, dependencies), `range` for a bad root name, `canonical` for a duplicate root name, `missing` for a root that is not among the records. `PackConformanceTests` pins each.

### A4. §4.5: a box's 4,096-atom bound with removals

- **Quote.** "box with ≤ 4,096 atoms | §3.3.2, minus atoms whose owner cell lies in a removed sub-box"
- **Problem.** It does not say whether the bound applies before or after the removals.
- **Resolution.** Before: a box is materializable when its count without removals is at most 4,096, so materializability, and with it the probe's presence (§7.3), does not change as pieces are removed.

### A5. §2.8 and §4.7: the code for a removal that does not resolve

- **Quote.** "Every removal MUST resolve inside the base." / `path`: "the step enters a removed node"; `validity`: "a contextual rule of §2.8 fails".
- **Problem.** Both codes fit a removal that leaves its base.
- **Resolution.** `validity`, because the rule is listed in §2.8.

### A6. §4.6: removals from two edits in one view

- **Quote.** "edit → validate the removals (§2.8), then rootView(base, removals ++ edit.removals)"
- **Problem.** §2.8 forbids containment within one edit, but the pending removals of an outer edit and an inner edit's own can contain one another (an outer edit removes a group child that holds an inner edit whose removal lies inside it, or the reverse). `count = baseCount − Σ` then subtracts the same atoms twice.
- **Resolution.** The concatenation is reduced to an antichain (a removal contained in another is dropped) before it is used (`Resolver.antichain`).

### A7. §5.2 and §5.3: `mulSmall`'s bound and a copy's mass

- **Quote.** "`mulSmall(k)` | Repeated doubling, for `k` below 2²⁵⁶." / "massµDa = (Σ_Z unit[Z] × µDa(Z)) × copies − …"
- **Problem.** A seed may hold up to 2²⁵⁶ − 1 atoms (§2.8), so its unit mass in µDa can reach about 2²⁸⁴, beyond `mulSmall`'s domain, when a tower's mass is formed as unit mass × copies.
- **Resolution.** `Magnitude.multiplied(by:)` doubles for any BigUInt factor (≤ 65,536 bits). No v1 vector reaches the difference.

### A8. §5.4.2: a display base outside the value's family

- **Quote.** "For a display base `f ≠ 10` and `M ≥ 10¹⁵`, working on the base-`f` digits"
- **Problem.** A value held as digit runs in one family (a googolplex, base 10) has no exact base-`f` digits in another family once it is past 65,536 bits.
- **Resolution.** Such a value prints in its own root base, as if that were the display base.

### A9. §7.3: the code when a probe is present or absent wrongly

- **Quote.** "The probe MUST be present exactly when the target is materializable. If present, it MUST equal the target's probe, otherwise the error is `mismatch`."
- **Problem.** The presence rule has no code.
- **Resolution.** `mismatch` for both.

## B. Frames and the cut (§8, §9)

### B1. §11.1 `ViewState` and `Budgets`: missing fields

- **Quote.** "`public struct ViewState … viewportHeight: Int … zNear … zFar`" and "`public struct Budgets … public var tau: Double`", against §9.3: "τ (px): start, and the controllers' minimum".
- **Problem.** Frustum culling needs the viewport's width (a phone is 9 : 19.5), and the τ controllers need each thermal column's minimum.
- **Resolution.** `ViewState.viewportWidth` (defaults to the height) and `Budgets.tauMinimum` are added; everything else keeps §11.1's names and shapes.

### B2. §8.7: the readout within ±32 decades

- **Quote.** "'shown 10^λ times life size', with λ printed in §5.5's scientific form: 'shown 10^(−3.333 × 10^99) times life size'."
- **Problem.** The form for an ordinary λ (10³ times, or life size) is not given.
- **Resolution.** |λ| < 0.005 reads "life size"; otherwise, within ±32, "shown m × 10^e times life size" with four significant digits. The googolplex bar reads exactly the spec's example (`FrameTests.phiForTheDeepestTowers`).

### B3. §8.8: "4 φ/s² easing"

- **Quote.** "φ moves at up to 400 φ/s with 4 φ/s² easing while |φ| ≤ 8,192"
- **Problem.** An acceleration of 4 φ/s² would take 100 s to reach 400 φ/s, which contradicts "from the googolplex bar at desk size to its atoms in about 18 s".
- **Evidence.** Easing the speed toward its target at a rate of 4 per second gives 18.4 s for the googolplex bar (φ ≈ −7,254), 36.5 s in Gentle, and 126 s from `levels` 2⁶⁵⁵³⁵ ("about two minutes") (`FrameTests.flightCrossesEveryTowerInBoundedTime`).
- **Resolution.** `speed += (target − speed) · min(1, 4 dt)`.

### B4. §9.6: residency keyed by copy key needs a hash per copy per frame

- **Quote.** "a seed copy's materialization, by (tower NodeID, copy key)" and "The only hashes in a frame are the copy keys of new materializations".
- **Problem.** The copy key is a SHA-256 of the copy's path (§3.4.5). Looking a resident copy up by it means hashing every refined copy every frame, not only new ones.
- **Evidence.** Before the change, the copy keys and their string keys were about a third of a googolplex inside view's frame in release (callgrind).
- **Resolution.** Resident copies are keyed by their exact path, as the interned (tower, digit runs) of their level base plus the digits below it (`ResidentStore.CopyID`); the copy key is computed only when a copy is materialized. Starting nodes' refKeys are keyed by (root, steps) the same way.

### B5. §9.4 and §9.5: back faces

- **Quote.** "kids ← the children of X … that are inside the frustum, not enclosed, and not occluded by last frame's Hi-Z (LupiEngine only)"
- **Problem.** For a finite rung, a slab beside the view touches the root's side faces, so it is not enclosed; it is visited and split although every face it exposes turns away from the camera. Guarantee 2 then fails between the 10⁹ rung (its own anchor) and the deep rungs.
- **Evidence.** A camera 0.3 m from a face at 10⁻² m/Å: 78 visits for the 10⁹ rung against 38 for the googolplex anchored at the same level, before; 36 against 38 after.
- **Resolution.** A solid node is also dropped when every face it exposes turns away from the camera (the camera is on the inner side of each such face plane, with two atom radii of slack for the outer layer's bumps). Solid nodes are axis-aligned in their own frame (§9.2: a solid seed's periods equal its extents), so each face is a coordinate plane. Proposed: add it to §9.4 beside the enclosed rule.

### B6. §9.8 guarantee 2: "same footprint" for a cube and two bars

- **Quote.** "For the same on-screen footprint and camera, the visited and emitted counts of the 10⁹, 10¹⁰⁰ and googolplex salt rungs agree within ±10 %."
- **Problem.** The 10⁹ rung is a cube and the other two are 10 : 1 : 1 bars, so as toys they never share a footprint; and at toy sizes all three draw as one box (ρ of a solid node is r_atom σ K / d, under a pixel at any desk distance). The comparison only means something on terrain, at a magnification where atoms show. There the deep rungs start from their anchor's neighbourhood (§8.4 puts it at level 9 here) and the 10⁹ rung from its root, which costs a constant handful of visits more or less, about 8 here; under about 80 visits that exceeds 10 %.
- **Evidence.** Camera over the same lattice position, visited and emitted: (311, 220), (320, 225), (320, 225) at 2 × 10⁻³ m/Å and 1 m; (155, 84), (164, 89), (164, 89) at 10⁻² m/Å and 3 m; at 0.3 m from the face, (36, 8) against (44, 10). The 10¹⁰⁰ and googolplex rungs anchored alike always cut identically.
- **Resolution.** The test checks the desk views (one box each) and terrain surface views of 150 to 520 visits within ±10 % (`CutGuaranteeTests.sameFootprintSurfaces`). Proposed: say "for cuts of at least a few hundred visits", or compare rungs anchored at the same level.

### B7. §9.8 guarantee 3: gradual refinement contradicts §9.1–§9.2

- **Quote.** "on a water grown by Grow ×2 (a non-solid tower) as the camera approaches, where refinement must also be gradual: the emitted count grows by at most a factor of 2 per halving of the distance." Against §9.2: "Because a tower's error is the same at every level, a level is refined only where its atoms (solid) or its periods (any other seed) are bigger than τ pixels."
- **Problem.** With ε σ the same in metres at every level, ρ depends only on `dist − r σ`: every node whose bounding sphere comes within `d* = ε σ K / τ` of the eye refines down to the copies, and none beyond it does. The ring of boxes of §9.2 exists outside that ball, but inside it the count is the number of copies within `d*`, about π (K/τ)² ≈ 2 × 10⁶ on a surface at any magnification. So the count jumps from one box to the budget as the eye crosses `d*`.
- **Evidence.** Water grown 30 times, 15 cm long, approaching: 1, 1, 4,096, 4,096, 4,096 items at 50, 25, 12.5, 6.25 and 3.1 cm (the item budget; `CutGuaranteeTests.grownWaterAsTheCameraApproaches`). The solid salt rungs behave the same way at the atom scale.
- **Resolution.** The test checks what does hold at every distance: budgets, nothing drawn twice, and every point of a seed copy's envelope along a ray grid inside a drawn item. Budgets and τ's controllers keep the frame bounded. Proposed: drop the factor-of-2 clause, or give non-solid levels an error that grows with the level (for example the level's half-period scaled by its extent) if gradual refinement is wanted.

### B8. §9.4: a neighbourhood inside a nested tower

- **Quote.** "In a tower: the 3 × 3 × 3 nodes at the anchor's level around it. … Neighbours outside the root are dropped".
- **Problem.** For a tower inside a group inside a tower (§2.8's tower of towers), "the root" could be the inner tower or the body's node, and the outer tower's neighbouring copies are not at the anchor's level.
- **Resolution.** The neighbourhood is taken within the innermost tower or crystal that holds the anchor, plus the siblings of every group on the way up within `z_far` (§9.4's group rule). A camera within `z_far` of the inner tower's boundary can therefore miss the outer tower's next copy until the anchor ascends.

### B9. §10.1 and §9.5: which atoms make the bubble's wall

- **Quote.** "atoms within 0.35 m of it are not drawn (the excavation bubble)" and "only the atoms of its outermost cell layer on each exposed face are drawn".
- **Problem.** The bubble's wall is a sphere, not a face layer, and a node that meets the bubble would otherwise draw no atoms where the sphere cuts it.
- **Resolution.** A solid node that reaches the bubble draws, besides its exposed face layers, its atoms in a shell two cells thick beyond the bubble's radius. Rays from the eye inside anchors of all three level shapes for f = 2, 10 and 16 all meet the wall within 5 cm of it (`CutGuaranteeTests.coverageInsideAnchors`).

## C. Physics and play (§10)

### C1. §10.2 and §11.1: `FeltMass` and `MassLog` live in LupiPlay

- **Quote.** "The function lives in LupiKit's `LupiPlay` as `FeltMass` (§11.1), taking `ln M`, `lnln M` and `massScale`".
- **Problem.** LupiKit on this branch has neither, and this work may not change LupiKit.
- **Resolution.** `LupiScale` defines `MassLog` and `FeltMass` with exactly the names and shapes of §11.1 (`Sources/LupiScale/Physics.swift`). When LupiPlay gains them, these must be deleted from LupiScale, or an app importing both sees two of each.

### C2. contracts.md §3.3 against LupiKit's `PersonalityTable.v1`

- **Quote.** contracts.md §3.3: "LupiKit's `PersonalityTable.v1` … currently differs, for example brittle `massScale` 1.1 and base break speed 2.5, and must be brought to this table before M0 exits."
- **Problem.** §10.2's brittle column and §10.6's thresholds read the contract's values (0.85; 1.2 m/s), while the owner of the table is LupiKit.
- **Resolution.** LupiScale reads the personality from LupiKit (`personality(for:resolver:)`), so it follows the table when LupiKit changes. The tests pass the table's `massScale` values explicitly, so §10.2's numbers are checked independently of it. The difference does not show in any §9.8 or §10 vector: an expansion's floor (3 m/s) exceeds both brittle thresholds, and a googolplex's felt mass ignores `massScale`.

### C3. §10.2: hemoglobin's mass

- **Quote.** "| hemoglobin | 0.544 | 0.541 |"
- **Problem.** No mass is given. 0.544 holds from about 61 to 64.5 kDa, and 64.5 kDa itself rounds to 0.545.
- **Resolution.** The test uses 64,458 Da (the human HbA tetramer): 0.5444 and 0.5411.

### C4. §10.4: "+15 % radius each"

- **Quote.** "each hydrogen folded into its partner (+15 % radius each)"; plan §3.4: "radius grown by 15 % per H, est."
- **Problem.** Additive (1 + 0.15 n) or compounded (1.15ⁿ) is not said.
- **Resolution.** Compounded: water's proxy is one sphere of 0.495 Å × 1.15².

### C5. §10.6: a piece's share of a googolplex's felt mass

- **Quote.** "`m_piece = max(0.06 kg, m_parent × M_piece / M_parent)`"
- **Problem.** For the ten cubes of the googolplex bar both masses are beyond binary64 (`ln M` is infinite), so the ratio cannot be formed from §5.5's `ln M`.
- **Resolution.** `Magnitude.lnRatio` subtracts the exact digit counts before rounding, so each cube gets exactly a tenth (`PlayTests.theGoogolplexBarBreaksIntoTenCubes`). Proposed: name this in §5.5.
