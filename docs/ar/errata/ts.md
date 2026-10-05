# LupiScale v1 errata: the TypeScript reference

*2026-10-05. Issues found in [scale-spec.md](../scale-spec.md) while building the TypeScript reference in `packages/core/src/scale`. The spec text was not edited: each entry quotes it, says what is wrong or unclear, gives the evidence, and names the resolution the reference implements (and the golden fixtures carry). A conformance step reconciles this file with the Swift implementer's errata into the spec.*

Every value in §12 reproduced exactly with the resolutions below; none of them changes a §12 vector.

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
