# LupiScale v1 errata: the TypeScript reference

*2026-10-05. Issues found in [scale-spec.md](../scale-spec.md) while building the TypeScript reference in `packages/core/src/scale`. The spec text was not edited: each entry quotes it, says what is wrong or unclear, gives the evidence, and names the resolution the reference implements (and the golden fixtures carry). A conformance step reconciles this file with the Swift implementer's errata into the spec.*

Every value in §12 reproduced exactly with the resolutions below; none of them changes a §12 vector. E13 to E17 concern §8 and §9, which the reference implements at value level for the web viewer, so none of them touches the fixtures.

| # | Section | Kind | Resolution in the reference |
|---|---|---|---|
| E1 | §12.6 | missing data, [B] | the bundled pack's root names, taken from the scratch implementation |
| E2 | §4.5 | ambiguity, [B] | a box is materializable on its own §3.3.2 count, before removals |
| E3 | §4.4, §5.3 | error, [B] | subtract only the outermost removals, each with its nested removals applied |
| E4 | §2.8 | ambiguity, [B] | depth checked as walk length plus subtree depth |
| E5 | §5.4.2 rule 1 | ambiguity, [B] | `z` is the whole trailing zero run |
| E6 | §5.2 | ambiguity, [B] | a plain value joins any family; a large value keeps its own family's digits when printed |
| E7 | §6.6 | ambiguity, [B] | zero pages between and after sections accepted; unknown section flag bits ignored |
| E8 | §2.7 | ambiguity, [B] | an opaque record's header flags are not checked |
| E9 | §3.6 | implementation latitude | the Morton key in two exact Number halves with a radix sort, not `bigint` |
| E10 | §5.5 | gap, [V] | a mantissa that rounds up to the base renormalizes |
| E11 | §5.3 | wording, [B] | none needed: a product prints without parentheses |
| E12 | §6.4 | wording, [B] | ROOT padding is per entry (equivalent) |
| E13 | §9.2, §9.8.3 | error, [V] | ε as §9.2 writes it; the Grow ×2 test checks coverage, budgets and monotone counts, not the factor 2 |
| E14 | §9.3 | ambiguity, [V] | the τ controllers' windows and counters as `TauController` states them |
| E15 | §11.2 | gap | `buildCut`'s bodies carry their resolver; an options argument for debugging and the cache |
| E16 | §9.8.7 | note | the 4 ms bound is the Swift benchmark's; the TypeScript reference is timed and gated at 400 ms |
| E17 | §9.4, §9.5 | ambiguity, [V] | any node with removals splits like a starting node, within the budgets |

---

## E1. §12.6: the bundled pack does not name its roots

**Quote.** "**The bundled scale pack** `lupi-scale-r1.lpk` (the six salt rungs and their seed, copper open and closed, diamondoids 1 to 12; 20 roots, 21 records): 65,536 bytes; contentId `4ec7833b…`; file SHA-256 `d5f1d7ba…`."

**Problem.** The contentId hashes the ROOT section (§6.2.1), which holds the root names, and §12.6 gives none. An implementation cannot reproduce the vector from the spec alone.

**Evidence.** The scratch implementation (`scratchpad/scale3/vectors.mjs`) names them `salt-thousand`, `salt-million`, `salt-billion`, `salt-e30`, `salt-googol`, `salt-googolplex`, `copper-billion`, `copper-billion-closed` and `diamondoid-1` … `diamondoid-12`. With those names the reference reproduces both the contentId and the file SHA-256; any other names change both.

**Resolution.** Those names, used by `scale.vectors.test.ts` and the fixture writer, and listed in the fixture's `packs.bundled.roots`. **Proposed spec change:** list the 20 names in §12.6.

## E2. §4.5: "box with ≤ 4,096 atoms" — before or after its removals?

**Quote.** §4.5: "A view is **materializable** when it can be written as one leaf of at most 4,096 atoms", and in its table, "box with ≤ 4,096 atoms | §3.3.2, minus atoms whose owner cell lies in a removed sub-box". §4.3: "box … `atoms` when it has ≤ 4,096 atoms".

**Problem.** The first sentence suggests the count after removals; the table row suggests the box's own §3.3.2 count, before them. They differ for a box of more than 4,096 atoms whose removals leave 4,096 or fewer. The difference is [B]: it decides whether a reference carries a probe (§7.2) and whether an `atoms` step resolves.

**Evidence.** Seven octant removals per level for ten levels (70 removals, within the 256 of an edit) leave one cell of copper's 630³ box (§12.3): "after removals" would make that box of 10⁹ atoms materializable, and the frozen raster order of §3.3.2 would then have to be found among 2.5 × 10⁸ cells.

**Resolution.** The box's own §3.3.2 count, before removals (`Resolver.isMaterializable`). Its materialization and its `atoms` ranges then exclude the removed atoms, as the table says. The scratch implementation reads it the same way. **Proposed spec change:** "box whose own atom count (§3.3.2, before removals) is at most 4,096".

## E3. §4.4 and §5.3: removals that nest across edits are subtracted twice

**Quote.** §4.4: "**Counts with removals:** `count(view) = baseCount(view) − Σ baseCount(view without removals, walked along r)` over its removals `r`." §3.5: "`count(edit) = count(base) − Σ count(removed node)`. This is exact (§5) because removals are disjoint." §2.8 forbids containment only among one edit's removals.

**Problem.** Two edits can nest legally: a tower seed may be an edit (§2.8 forbids only an edit *of a tower*), and an outer edit of that tower may remove, through a seed copy, an ancestor of the inner edit's removal. Then the view of that copy carries both removals, which overlap, and the walk along the outer removal re-enters the inner edit and picks up its removal again. The formula subtracts the inner atoms twice, and the count no longer equals the materialization.

**Evidence.** Salt seed edited to remove `cells 0, 3` (16 ions); a factor-10 tower of 3 levels over that edit; an outer edit removing `cells 0` (216 ions) of copy (0, 0, 0):

| Quantity | Literal §4.4 | Materialized / correct |
|---|---|---|
| copy (0, 0, 0) | 1,000 − 216 − 16 = 768 | 784 |
| the whole outer edit | 984,000 − 216 = 983,784 | 983,800 |

**Resolution.** A count subtracts only the outermost removals of a view (those no other removal of the view contains, §4.4's containment), and each one's count *with* the removals nested inside it applied, which is exactly the atoms it takes away. Compositions do the same. Wherever removals are disjoint and no walk re-enters an edit, this is the literal formula, so every §12 vector is unchanged. The fixture carries the case as `nested removals (errata E3)`. **Proposed spec change:** either that rule in §4.4 and §5.3, or a §2.8 rule rejecting an edit whose removal contains a removal of an edit it walks through (simpler for readers, and it loses nothing play needs).

## E4. §2.8: what "walking a path checks the records it enters" means for depth

**Quote.** "Readers check it lazily, so that a reader needs only the records it reads: walking a path checks the records it enters, and any evaluation of a whole subtree … checks the depth of that subtree."

**Problem.** A record's depth is a property of its whole subtree, so a walk cannot check the depth of the records it enters without reading their subtrees, which the sentence says it must not need.

**Resolution.** A walk counts the records it enters (root 1; each `child`, the seed of a level-0 copy and the base of an edit add one) and fails with `limit` past 64. An evaluation of a whole subtree (count, composition, materialization) fails with `limit` when the walk's count minus one plus the subtree's depth passes 64. Both are necessary conditions of the record rule, and together they catch every record of depth above 64 that the reader touches. **Proposed spec change:** state this rule.

## E5. §5.4.2 rule 1: how many zeros is `z`?

**Quote.** "If the digits are `c` followed by `z` zeros with `c < 10¹⁵`, print `c × f^E(z)`".

**Problem.** Any split of the trailing zeros satisfies the sentence; the vectors (`3 × 2^100`, `24 × 16^40`) do not decide it, because 3 and 24 have no factor of their base.

**Resolution.** `z` is the whole trailing zero run, so `c`'s last base-`f` digit is nonzero, as in §5.4.1 rule 2 ("a run of `z` zeros") and §5.4.2 rule 3 ("move factors of `f` from `c` into `k`"). So `towerCount(1000, 2, 100)` prints `125 × 2^103`, and water grown 70,000 times weighs `2,251,875 × 2^70003` µDa. Both rows are in the fixture's `formatting` and `scientific`.

## E6. §5.2: families of plain values, and printing a value whose display base is of another family

**Quote.** "`add`, `sub` | … Different families: plain arithmetic when both operands and the result fit in 65,536 bits, otherwise the error `base`. … The result keeps the left operand's display base."

**Problem.** (a) A plain value has a display base, but it is below 2⁶⁵⁵³⁶, so it is exact in every base; the table does not say whether `plain(10) + towerCount(3, 2, 70000)` is "different families". (b) If it is allowed, the result is base-2 runs with display base 10, and §5.4.1 cannot print its decimal digits without forming them.

**Resolution.** (a) A plain value joins any family: it is converted to the other operand's root base, O(digits) once. Only two runs values of different families give `base`. (b) Such a value prints in its own root base (§5.4.2), as if that were its display base. `withDisplayBase` refuses a base outside the value's family. v1 does not reach (b): only edits subtract, and an edit's terms share one tower (§5.2's own remark).

## E7. §6.6: zero pages between and after sections; section flag bits

**Quote.** §6.6 rule 3: "Its offset is page-aligned and not before the end of the previous section's pages." §6.1: "All bytes between sections are zero, and the file length is a multiple of 16,384." §6.5 (writers): "The file ends at the end of the last section's last page."

**Problem.** The reader rules permit a zero page between sections ("not before", rather than "at") and say nothing of pages after the last section, while the writer never writes either. §6.3 defines only bit 0 of a section's flags. §6.8's "a pack with the same contentId is byte-identical by construction" holds only for conforming writers.

**Resolution.** Following §6.6 as written: zero gaps between sections and zero pages after the last are accepted, any nonzero byte there is `pack`, and section flag bits other than bit 0 are ignored. The conformance tests pin both. **Proposed spec change:** require the writer's exact layout in §6.6 (offset equal to the end of the previous section's pages, file ending with the last section), so a pack's bytes are a function of its contentId for every reader.

## E8. §2.7: an unknown kind's header

**Quote.** "A record with an unknown kind, or a known kind with an unknown `kindVersion`, is kept opaque: its NodeID is still verified (§6.6)". §2.1: "flags | 0".

**Problem.** Whether a reader checks an opaque record's header flags (and padding rules it cannot know) is not said.

**Resolution.** An opaque record is checked for its magic and that it is exactly `12 + bodyLength` bytes, at most 65,536; its flags are not checked, so a later kind may use them.

## E9. §3.6: the Morton key in TypeScript

**Quote.** "`u` reaches 2³¹, and the key has 63 bits: TypeScript computes `u >> shift` as `Math.floor(u / 2 ** shift)` and the key in `bigint` (§1.10)."

**Note, not an error.** The reference computes `⌊u / 2^shift⌋` as the spec says and never applies a 32-bit operator to `u`, but holds the 63-bit key as two exact Number halves (bits 0–32 and 33–62) and orders atoms by a stable LSD radix sort over them, so ties keep source order. The order equals the `bigint` sort (`mortonKeyBig`, tested on random inputs with ties and on `massive_1m`), and the bake of 953,312 atoms takes about 0.5 s instead of several. The bytes are what §3.6 fixes, so this is an implementation choice; if the sentence is meant as a requirement, it should say "exactly", not "in `bigint`".

## E10. §5.5: the scientific mantissa can round up to the base

**Quote.** "`m = b^frac(log_b(c · q))`, printed with 4 significant digits (half to even on the binary64 value)."

**Problem.** A mantissa just under `b` (9.9996 in base 10) prints as `10.00`.

**Resolution.** It becomes `1.000` and `E` grows by one. [V] only.

## E11. §5.3: a product in the formula text

**Quote.** "then ` × ` and `format(copies)` when `copies ≠ 1`, in parentheses when that text is a sum or a difference (rules 4a and 4b of §5.4)".

**Note.** The googolplex without child 9 then reads `BrCl499Na500 × 9 × 10^(10^100 − 4)`: a product, unparenthesized, which is what the rule says and reads correctly. Listed so the conformance step sees it was considered; no change proposed.

## E12. §6.4: ROOT padding

**Quote.** "per root: NodeID, name length (u16), name, zero padding to a multiple of 4".

**Note.** Padding the entry (34 + len) and padding the section offset to a multiple of 4 are the same, because the section header is 8 bytes and a NodeID 32. The reference pads the entry; the small pack's ROOT (100 bytes) confirms it. A one-word clarification would remove the doubt.

## E13. §9.2 and §9.8.3: a non-solid tower does not refine gradually

**Quote.** §9.2: "Because a tower's error is the same at every level, a level is refined only where its atoms (solid) or its periods (any other seed) are bigger than τ pixels. So its cut is a ring of boxes around the eye, the geometry clipmap of terrain rendering …, whatever its count, and it refines gradually as the eye approaches." §9.8.3: "… and on a water grown by Grow ×2 (a non-solid tower) as the camera approaches, where refinement must also be gradual: the emitted count grows by at most a factor of 2 per halving of the distance."

**Problem.** With one ε in Å for every level, `ρ(X) = ε · σ · K / max(dist − r σ, z_near)` depends on a node's size only through its nearest distance. Every node whose bounds come within `R = ε σ K / τ` of the eye refines, and so does each of its descendants that does: the refined region is a ball of radius `R` that goes down to seed copies all at once, not a set of rings (a clipmap needs an error that grows with each level's cell). Seen face-on, the copies just inside the ball are about τ pixels across, so their number goes from none to roughly `(K/τ)²` while the eye moves from `R` to `R/2`. No factor-2 bound per halving can hold. (A solid tower behaves the same at the atom scale; §9.8 does not ask that to be gradual.)

**Evidence.** Water grown 45 levels with §12.4's Grow ×2 periods, scaled to 3 m across, the camera on the normal through the centre of its top face, iPhone 15 Pro fair budgets except 60,000 items and visits and unlimited materializations, two frames each:

| Eye distance | 0.800 m | 0.566 m | 0.400 m | 0.283 m | 0.200 m | 0.141 m |
|---|---|---|---|---|---|---|
| Items | 5 | 5 | 5 | 21 | 59,989 | 59,985 |
| Visits | 9 | 9 | 9 | 49 | 60,000 (budget) | 60,000 (budget) |

From 0.4 m to 0.2 m, one halving, the count grows by a factor above 10⁴; with the fair budgets the cut stops at 4,096 items and is `overBudget`, and §9.3's controller then raises τ, which shrinks the ball.

**Resolution.** §9.2's error as written. The Grow ×2 test (`scale.cut.test.ts`) checks what does hold: each sampled point of the body in view is drawn exactly once at every distance, including over budget; counts are monotone as the eye approaches; no budget is exceeded; and outside the ball the body stays a handful of boxes. It does not check the factor 2. **Proposed spec change:** drop "refines gradually" from §9.2 and the factor-2 clause from §9.8.3, and say instead that the budgets and τ bound the cut. If gradual growth is wanted, give a non-solid level an error that grows with the level, such as the extent of one child: errors stay monotone, and the cut becomes the clipmap §9.2 describes, at the price of boxes that read denser than their copies out to where one child is τ pixels.

## E14. §9.3: when the τ controllers act

**Quote.** "**τ** is the larger of two controllers, each evaluated every 0.5 s and kept in [τ_min, 8] … A window with any interval over 1.5 display periods (a dropped frame) multiplies τ by 1.25; 2 s without one multiplies it by 0.95. … A cut that was `overBudget` (§9.5) multiplies the next frame's τ by 1.25; 0.5 s with every budget under 80 % multiplies it by 0.9."

**Problem.** "Evaluated every 0.5 s" and "the next frame's τ" disagree for the budget controller. It is not said whether ×0.95 applies once per 2 s or at every window once 2 s have passed, where the 2 s count from at start, or which budgets "every budget" covers.

**Resolution** (`TauController`, [V]). The frame-time controller judges 0.5 s windows: a window with a dropped frame multiplies by 1.25, otherwise ×0.95 when the last drop (or the first frame) is at least 2 s old, so at most once per window. The budget controller reacts to an `overBudget` cut at once, for the next frame; a run of frames with items, boxes and splats, instanced atoms and visits all under 80 % multiplies it by 0.9 each 0.5 s it lasts. Both are clamped to [τ_min, 8], and a thermal change moves τ_min. With LupiEngine, `gpuTime` applies the 8 ms rule to the frame-time controller.

## E15. §11.2: `buildCut` has no store

**Quote.** "`export function buildCut(bodies: BodyFrame[], view: ViewState, budgets: Budgets, previous?: Cut): Cut;   // later, for the web`"; the Swift signature in §11.1 takes `resolver: Resolver`.

**Problem.** The cut reads records, and §8.3's `BodyFrame` holds a reference, not a store, so the TypeScript signature cannot resolve anything.

**Resolution.** The reference's `BodyFrame` carries its `resolver`, with `root` and `path` in place of `ref`, so bodies from different packs share one call, and `buildCut` takes an optional fifth argument `{ debug, cache }` (the regions skipped as enclosed or culled, for the coverage tests; a cache kept across frames). Otherwise the signature is §11.2's. **Proposed spec change:** add the resolver to the TypeScript `BodyFrame` or the signature.

## E16. §9.8.7: the cost bound and the TypeScript reference

**Quote.** "A release-mode benchmark of `buildCut` at 8,192 visits runs with the Linux tests and fails above 4 ms on CI hardware."

**Note.** The bound is the Swift implementation's. The TypeScript reference is written for clarity and exact agreement, with `bigint` digits and object nodes: on this Linux container (Node 22) a frame of exactly 8,192 visits over a 4,000³ copper box takes about 76 to 85 ms, near 10 µs a visit. Its test asserts the 8,192 visits and gates the time at 400 ms (`LUPI_CUT_MS` overrides it), and prints the measurement. A web viewer that adopts `buildCut` will need its own profile against §9.3's 1 ms; no claim about devices is made here.

## E17. §9.4 and §9.5: nodes with removals below the starting nodes

**Quote.** §9.4: "**Removals** inside a starting node split it into its remaining children, at most 256 per edit."

**Problem.** Only starting nodes are mentioned. A node met during the traversal can also carry removals (an edit below the anchor, or a removal deeper than the starting node), and its stand-in (§9.2) would draw the removed matter.

**Resolution.** Any node that carries removals and is not final is refined whatever its ρ, like a starting node, subject to the same residency and budget checks; over budget it is emitted as its stand-in and the cut is `overBudget`, as for any other node. A coverage test on an edited copper box (a hole at a corner, two cavities inside) checks that no removed region is drawn, no atom drawn lies in one, and the rest is drawn once.
