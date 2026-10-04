# Scale without a ceiling: the LupiScale architecture

*2026-10-04. The architecture of record for decision D14. The owner's words: **"Million atom needs to be first principle. Should scale from 1k to googleplex if we needed."** This document replaces the plan's old order, where scale waited for "M3, the million-atom colossus" ([plan.md](plan.md) §7–§8 before this change). Scale is now the spine of the game from M0.*

*The byte-level contract that the TypeScript and Swift implementations build to is [scale-spec.md](scale-spec.md). Appendix A adjudicates the three proposals this design was chosen from. Numbers marked **(est.)** are arithmetic or starting values to tune on a device; **UNCONFIRMED** marks claims that need a device spike. Every identifier, count and byte size quoted here was computed by a scratch implementation of the spec, and the core ones were re-derived by a separate Swift program (scale-spec.md §0, §12).*

---

## 0. In one page

**What the directive means.** Scale is not a feature to add later; it is the shape of every data structure. Every per-frame and per-gesture cost is bounded by the output: pixels, frame time and a memory budget, never the atom count. The same representation, renderer, physics, persistence and UI handle a 1,000-atom molecule, a million-atom assembly, 10⁹, 10³⁰, 10¹⁰⁰, and a googolplex, 10^(10^100), atoms. "If we needed" means no ceiling in the architecture, even though the first content runs only from a water to the 10⁹-atom salt crystal of M0's scale receipt.

No storage holds 10¹³ atoms explicitly, let alone 10^(10^100). So the upper range forces five things, and they are the whole design:

1. **Content is a DAG of small, immutable, content-addressed nodes.**
   - A node is explicit atoms (a leaf of at most 4,096), an assembly of other nodes, a crystal generator, a self-similar tower generator, or an edit.
   - A googolplex atoms is one 168-byte record that names a 52-byte seed. Repeating a node is instancing.
   - Each node is identified by the SHA-256 of its bytes, so the same structure has the same identity on every device, forever.
2. **Counts and positions are exact and relative.**
   - Counts and masses are exact integers that cannot overflow: base-*f* digit runs, so a googolplex is the digit 1 followed by a run of 10¹⁰⁰ zeros.
   - A position is a node, a path to it, and local coordinates. Paths store tower descents as digit runs, so descending 10¹⁰⁰ levels writes a few hundred bytes.
3. **Each frame draws a cut.** The cut is a front through the DAG, chosen by screen-space error under hard budgets.
   - A crystal is drawn as boxes until its atoms are bigger than a pixel and a half.
   - Whatever the count, the cut is a ring of boxes around the eye, plus the atoms near it.
4. **Every frame is relative to its own level.**
   - Each body keeps an anchor node with a binary64 pose and a metres-per-unit scale.
   - Drawing composes transforms relative to the eye and casts to Float32 once, which keeps vertex error below 4 × 10⁻⁴ px at every magnification (scale-spec.md §8.6).
5. **Play acts on nodes, never on atoms.**
   - **Grab** takes the hand-sized node under the finger.
   - **Smash** expands a node into its children: a googolplex bar breaks into ten cubes of 10^(10^100 − 1) atoms each.
   - **Build** joins atoms into new leaves, or replicates a body into a tower.
   - **Keep** stores a reference: a root, a path and the records it needs, at most a few hundred bytes. It regenerates the same atoms in Swift and TypeScript.

**What it costs M0.** A pure-Swift package, `apps/apple/LupiScale`, that is mostly integer arithmetic and hashing, tested on Linux against the TypeScript reference. Every molecule in the playable slice is a leaf node, so the slice runs on the spine with one cut item per molecule and no change of feel. The colossus and the googolplex become **content** milestones on that spine, not a rewrite.

**The showpiece** is one generator, the salt ladder:

- The seed is a 1,000-ion cube of rock salt with one bromide per copy.
- A tower of tens stacks it into the rungs 10³, 10⁶, 10⁹, 10³⁰ (a 2.82 m cube, life size in your room), 10¹⁰⁰ and 10^(10^100).
- Every rung is a record of 126 to 168 bytes.
- At the top it is a bar, not a cube: 10¹⁰⁰ ≡ 1 (mod 3), so a googolplex is not a perfect cube and no cube of ions holds exactly that many. The bar is ten cubes long, and smashing it gives you the ten.

---

## 1. Principles, each a test

| # | Principle | The test that holds us to it |
|---|---|---|
| P1 | **Output-bounded cost.** No per-frame or per-gesture cost depends on the atom count. The cut is bounded by visit, item, atom and splat budgets; a gesture by its constants (16 pieces, 64 proxy shapes, O(runs) path edits). | Linux: no budget is ever exceeded for roots from 10³ to a googolplex, and for the same on-screen footprint the 10⁹, 10¹⁰⁰ and googolplex rungs visit within ±10 % of the same nodes (scale-spec.md §9.8). Device: frame time flat across the 10³, 10⁶ and 10⁹ crystals (M0 receipt). |
| P2 | **No ceiling in the representation.** Counts, masses, depths, indices and paths are exact, and their size grows with the description and the player's choices, never with N. v1 reaches about 10^(2.4 × 10¹⁹⁷²⁸); the format reserves the step beyond (spec §13). | Linux: the googolplex and a tower at `levels` = 2⁶⁵⁵³⁵ resolve, count and format exactly; a 10¹⁰⁰-level path round-trips in under 500 bytes. |
| P3 | **Keeps are exact; play is not.** Physics, contacts and gestures are floating point and nondeterministic. Anything kept is an exact reference that regenerates bit for bit. | Linux: chip, keep, resolve and probe round-trip; a corrupted probe is rejected. |
| P4 | **One truth in two languages.** The TypeScript reference and the Swift implementation agree byte for byte on records, generators, paths, magnitudes, packs and references. | Golden fixtures written by TypeScript, asserted by Swift on Linux and on the owner's Mac in debug and release (spec §12). |
| P5 | **Precision at every magnification.** Positions are relative to a per-level anchor and composed relative to the eye. | Linux: random dives to depth 10¹⁰⁰; vertex error under 4 × 10⁻⁴ px; rebases move no vertex by more than 10⁻⁴ px. |
| P6 | **True order, honest numbers.** Counts print exactly when they can and say "≈" when they cannot. Heavier things feel heavier, all the way up. Nothing claims to be a simulation (D8). | Linux: `format` vectors; for one personality, felt mass strictly increasing in true mass above 9 Da (the plan's 0.06 kg floor), up to and past a googolplex. |
| P7 | **Missing data degrades, never breaks.** A child not yet resident draws its parent. A missing pack shows the trophy's cached aggregate. Over budget, τ rises and the frame rate holds. | Linux: cut with random residency has no holes; device: thermal soak. |
| P8 | **Small is a special case.** A molecule is a leaf, and M0's code paths run through the spine at the cost of one cut item. | Device: the M0 exit list unchanged; the cut call under 10 µs (est.) for a single leaf. |
| P9 | **Frozen means frozen.** A generator version, once published, resolves forever, bugs included. | Fixtures never change for a version; a change is a new version (spec §13). |

---

## 2. The abstractions

### 2.1 Nodes

| Kind | What it is | Typical record | Used for |
|---|---|---|---|
| **leaf** | up to 4,096 explicit atoms, file order, the source's Float32 positions | caffeine 328 B; 4,096 atoms 53 KB | every gallery, OMol25 and PubChem molecule; built molecules; the chunks of an imported colossus |
| **group** | up to 256 children, each a NodeID with an f64 rotation and translation; NodeIDs may repeat | 16 + 88 B per child | assemblies: a capsid's subunits, the 35 groups over `massive_1m`'s 233 leaves |
| **crystal** | sc, bcc/CsCl, fcc, diamond/zincblende or rock salt; open or closed boxes of up to 2⁶² cells per axis; or an H-capped diamondoid | 52 B | copper's billion (`BillionAtomBlock`), diamond, adamantane and its octahedral siblings, the salt seed |
| **tower** | `f` (2–16) copies of the level below, one axis per level; levels up to 2⁶⁵⁵³⁶ − 1; an optional dopant substitution per copy | 123–168 B | the salt ladder to a googolplex; "Grow ×2" of anything |
| **edit** | a node with up to 256 sub-nodes removed | 48 B + paths | chips taken out of something too big to rewrite |

Only leaves hold atoms. Everything above them is references and rules, so storage grows with distinct content, not with atoms: a 60-subunit capsid stores one subunit.

### 2.2 Views and paths

A **path** walks from a root to any node, which may be virtual: a crystal sub-box, a tower level, a seed copy, or a selection of a leaf's atoms. It has four kinds of step:

| Step | Chooses |
|---|---|
| `child i` | a group child |
| `cells o…` | crystal octants |
| `tower D runs` | a descent of D levels, its digits run-length coded per axis |
| `atoms ranges` | a selection from a leaf of at most 4,096 atoms |

A dive of 10¹⁰⁰ levels toward a point writes, per axis, a few dozen explicit digits and then one run. Every node reached this way is a **view**. Its count, composition, bounds and proxy are closed-form, so nothing is ever expanded to answer a question about it (spec §4).

### 2.3 Identity

| Name | Is | Identifies |
|---|---|---|
| NodeID | SHA-256 of a record | a node, on every platform, forever |
| probe | the NodeID of a materialized leaf | the exact atoms of any piece of at most 4,096 atoms, wherever it came from |
| refKey | SHA-256 of a root and a path | a piece of anything, independent of how its records travel |
| contentId | SHA-256 of a pack's sorted NodeIDs | a pack; also its file name and URL |

A gallery molecule's NodeID is a pure function of its XYZ file through the web's own parser: the leaf keeps the file's atom order and its Float32 numbers. So the app, the web and the edge name the same molecule the same way, and bond perception sees the numbers the viewer sees.

### 2.4 Magnitude

A count or a mass is an exact non-negative integer:

- plain (a BigUInt of up to 65,536 bits);
- or, for anything derived from a tower, base-*f* digit runs.

`format` prints it the same way on the HUD, plaques and the web: `953,312`, `1,000,188,000`, `10^30`, `10^(10^100)`, `9 × 10^(10^100 − 1)`, `10^(10^100) − 1,000`, `3 × 2^100`, `≈ 1.235 × 10^24`.

Physical units (kilograms, metres, magnification) are derived approximately from the exact value, with an exact exponent and a binary64 mantissa: the googolplex bar weighs ≈ 4.859 × 10^(10^100 − 26) kg.

### 2.5 Frames

Each body has one **anchor**: the deepest node on the focus point's chain whose radius is at least 8 m at the current magnification (with hysteresis). The anchor carries the body's world pose in binary64 and its metres per anchor unit.

- Everything drawn composes from the anchor to the item in binary64 and is cast to Float32 once, relative to the eye.
- Ancestors far beyond the room are drawn only as the face planes that come near you.
- Rebasing is a change of representation, not of state: the image does not move (spec §8).

### 2.6 The cut

Each frame, a budgeted priority traversal starts from each body's anchor neighbourhood and refines the node with the largest screen-space error first, until every emitted node's error is under τ (1.5 px) or a budget is spent.

- A crystal box or a tower level is drawn as a box until its atoms exceed τ. Its error is one atomic radius at every level, so its cut is a ring of boxes around the eye: the clipmap of terrain rendering.
- A missing child draws its parent. Over budget, τ rises; the frame rate holds (spec §9).

### 2.7 Bodies

A body is a scale reference (what it is), a frame (where it is and how big), a personality and a size state: toy (dynamic), monument (kinematic) or terrain (static, with a collision window around you).

### 2.8 Layers

```
lupi.live (Worker, static assets)      /scale/p/<contentId>.lpk  ← web build bakes packs (TypeScript)
packages/core/src/scale  (TypeScript)  the reference: records, generators, paths, magnitude, packs, refs;
                                       writes the golden fixtures; later the web viewer's cut
apps/apple/LupiScale     (Swift, Linux-tested)
   LupiScaleCore   [byte-exact]  BigUInt, Magnitude, records, generators, paths, resolver, packs, refs
   LupiScale       [values]      aggregates, frames and rebasing, the cut, picking, proxies, felt mass,
                                 breaking and growing   (uses LupiKit's LupiChem for bonds and elements)
apps/apple (the app)
   ScaleSystem     each frame: rebase anchors → buildCut → draw items → backends
   RealityKit      leaf meshes, instanced atoms and boxes, face planes, bodies, colliders   (M0 on)
   LupiEngine      Metal impostors and splats inside RealityView post-processing          (M3)
```

---

## 3. Walkthroughs at five scales

### 3.1 The content

| | 10³ | 10⁶ | 10⁹ | 10¹⁰⁰ | 10^(10^100) |
|---|---|---|---|---|---|
| Example | the salt rung 10³ (`levels` 0: one 1,000-atom copy); gallery molecules are leaves of 3 to about 2,000 atoms | `massive_1m.glimbin`: 953,312 Cu atoms baked into 233 leaves and 35 groups; or the salt rung 10⁶ | copper's billion: one crystal record, 1,000,188,000 atoms, the web's `BillionAtomBlock`; or the salt rung 10⁹ | the salt rung 10¹⁰⁰ (`levels` 97) | the salt rung 10^(10^100) (`levels` 10¹⁰⁰ − 3) |
| Bytes on disk | tower 126 B + seed 52 B | a 12.5 MB pack, or 127 B + 52 B | 52 B, or 127 B + 52 B | 127 B + 52 B | 168 B + 52 B |
| Count, as printed | 1,000 | 953,312 / 1,000,000 | 1,000,188,000 / 1,000,000,000 | 10^100 | 10^(10^100) |
| Shape | 2.82 nm cube | 28.2 nm cube (salt) | 282 nm cube (salt), 228 nm (copper) | a 10 : 1 : 1 bar | a 10 : 1 : 1 bar of ten cubes |
| Life-size length | 2.82 nm | 28.2 nm | 282 nm | 2.82 × 10²⁴ m (about 300 million light-years) | about 10^(3.3 × 10⁹⁹) m |

### 3.2 One frame

Two views of each piece of content:

- **The desk view.** The body is 30 cm long, 0.5 m from the camera, on a phone at about 1,380 px/rad (UNCONFIRMED).
- **The inside view.** The player has pinched or dived until ions are marbles 2 cm across, and stands among them.

| | 10³ | 10⁶ | 10⁹ | 10¹⁰⁰ | 10^(10^100) |
|---|---|---|---|---|---|
| Ion radius on screen, desk view | about 29 px | about 2.9 px | about 0.3 px | about 3 × 10⁻³² px | about 10^(−3.3 × 10⁹⁹) px |
| Desk view: what is drawn | one item: the merged RealityKit mesh (≤ 2,000 atoms) | boxes, plus atoms on the faces nearest the eye up to the budget: 5,000 atoms with RealityKit instancing; all ~30,000 visible face atoms with LupiEngine (M3) | one box | one box | one box |
| Desk view: nodes visited | 1 | ≤ 8,192 (budget) | 1 to a few | 1 to a few | 1 to a few |
| Inside view: what is drawn | n/a (a monument at most) | the anchor's 3 × 3 × 3 neighbourhood refined into rings of boxes and the atoms within a metre or two | the same | the same | the same |
| Inside view: cost | | bounded by the budgets, and identical for every rung deep enough: the neighbourhood of a seed copy looks the same in a 10⁹ crystal and in a googolplex | | | |
| Count arithmetic per frame | none | none | none | none | the HUD's `format`, once per change |

### 3.3 Grab, throw, smash, build, zoom, keep

| | 10³ | 10⁶ | 10⁹ | 10¹⁰⁰ | 10^(10^100) |
|---|---|---|---|---|---|
| **Grab** | the ray hits the leaf's atoms; the whole body (≤ 40 cm) is grabbed | the ray hits the cut (box or leaf), then refines along the hit; the whole body | same | same | same |
| **Throw** | proxy: up to 48 heavy-atom spheres. Felt mass `b` = 0.537 kg before `massScale` | one box (salt, 0.567 kg), or ≤ 64 spheres from the group tree (`massive_1m`, 0.568 kg) | one box; 0.575 kg | one box; 0.590 kg | one box; 0.5998 kg, the heaviest thing in the game |
| **Sound and haptics** (heft h) | h = 0.74 | 0.93 | 1.06 | 2.01 | 100, clamped at 4: the lowest thud and the longest tail |
| **Smash** | the 1,000-ion copy has no breakable bridge and more than 64 heavy atoms, so it splits into up to 8 octant selections; a one-cell box gives loose ions to build with | 8 octants (crystal), or ≤ 16 group children (`massive_1m`) | 8 octants; a salt rung's 10 children | 10 children: a bar becomes 10 cubes | 10 cubes of 10^(10^100 − 1) atoms each |
| **Build** | valence snapping into new leaves (plan §4.5), with loose ions included | building happens at the molecular scale; at larger scales it means replication: Grow ×2 turns any body into a tower, one level per tap | Grow ×2: 30 taps on a water give 3 × 2³⁰ atoms | 331 taps on a water pass 10¹⁰⁰ | out of reach of taps (about 3.3 × 10¹⁰⁰ of them); the salt dial sets it directly |
| **Zoom** | the anchor stays at the root; a pinch changes σ | the anchor descends the group tree (3 levels) or the crystal octree | about 10 octree levels, or 6 tower levels | ≤ 97 levels, at most 2 per frame | **Dive**: flight across about 7,300 units of the scale axis (about 20 s), writing one run per axis |
| **Keep on the shelf** | a reference of 260 B (seed and tower embedded, probe) | 115 B for a `massive_1m` leaf (root and pack by id, three child steps, probe); 229 B for the whole 10⁶ rung | 138 B for a 4,000-atom copper box six octants deep; 229 B for the rung | 229 B for the rung; 243 B for one of its slabs | 270 B for the bar, 284 B for a cube, 496 B for a 1,000-ion grain at the middle of its top face |

Every column has the same code path. N appears only inside Magnitudes.

### 3.4 A googolplex in your hand

The salt dial's last stop. A 30 cm glossy bar drops into your hand, minty in true CPK (purple sodium and green chlorine average out) with dark-red bromide flecks.

- **The plaque.** "10^(10^100) atoms. A googolplex is not a perfect cube, so no cube of salt holds exactly that many ions; this bar is ten cubes long."
- **Throw it.** It is the heaviest thing you can throw, tumbles like a baton because its inertia is a 10 : 1 : 1 bar's, and lands with the lowest thud and the longest buzz.
- **Smash it.** Ten cubes, each "10^(10^100 − 1) atoms". Smash a cube: ten slabs. A slab: ten rods. A rod: ten cubes. The rhythm repeats all the way down.
- **Pinch.** Pinch a cube to room size and it becomes a monument, then terrain. You stand on a salt plain that runs past your walls.
- **Dive.** For about twenty seconds the readout races through powers of powers of ten, until the ions are marbles at your feet.
- **Chip.** Pinch-pull a 1,000-ion grain out of the surface. It is a real crystal fragment that no device has ever generated before you looked, and it is the same on every device: its bromide sits at atom 639, its probe is `449611ac…`.
- **Keep it.** On the shelf, the grain's trophy is 496 bytes, and its plaque says where it came from.

None of this costs more per frame than a caffeine.

---

## 4. Rendering

### 4.1 Draw items and backends

| Item | Backend | When |
|---|---|---|
| `leafMesh` | RealityKit merged `MeshDescriptor` mesh, one PBR material per element (plan §3.6) | any body whose node is a leaf of at most 2,000 atoms: the whole M0 slice |
| `atomInstances` | RealityKit `MeshInstancesComponent` (iOS 26), one component per element colour (per-instance colour is UNCONFIRMED, forum 814211, and this sidesteps it) | atoms of materialized leaves and seed copies that are not bodies: up to 5,000 |
| `box` | RealityKit instanced unit cube, PBR in the node's aggregate colour; later an optional `CustomMaterial` lattice shading that draws atom bumps on the faces (UNCONFIRMED, spike S6) | crystal boxes and tower levels: the googolplex is one of these |
| `facePlane` | a RealityKit plane | an ancestor's outer face near the camera when you are inside something vast |
| `splats` | instanced spheres now; LupiEngine later | aggregates of groups and non-solid towers |
| `atomsGPU`, `clusterSplats` | **LupiEngine** (M3): our Metal pass inside RealityView's `customPostProcessing`, depth-tested against `sourceDepthTexture` (research [million-atom-ar.md §4](research/million-atom-ar.md)) | dense explicit sets at full detail: `massive_1m`, a capsid, 50k–150k impostors |

**The sequencing consequence.** The whole salt ladder, a googolplex included, renders with RealityKit alone: boxes far away, instanced atoms near, merged meshes for what you hold. LupiEngine is needed only for dense explicit structures at full detail, so it stays a content milestone (M3), and spike S1 no longer blocks the scale spine.

### 4.2 Budgets

The iPhone 15 Pro starting budgets (est.; spike S2 replaces them):

| Budget | Value |
|---|---|
| nodes visited per frame | 8,192 |
| draw items | 4,096 |
| atoms through RealityKit instancing | 5,000 |
| atoms through LupiEngine impostors | 150,000 |
| boxes and splats | 32,000 |
| leaf materializations per frame | 8 |
| traversal CPU | 1 ms |
| resident cache | min(192 MB, 10 % of `os_proc_available_memory`) |

The iPad's are about 1.5× to 2×. Each thermal state tightens them (spec §9.3).

### 4.3 Transitions without popping

- **Same look on both sides of a swap.** A box's colour is the coverage-weighted CPK mean of its exposed atoms, and its faces are tangent to the atom envelope. A swap happens at about τ = 1.5 px, so it changes texture, not silhouette.
- **Fades.** Items fade in and out over 200 ms with a stable screen-door dither keyed by their refKey: no blending and no sorting, and depth stays opaque. Still comfort cuts instead.
- **Hysteresis.** Refine above τ, coarsen below τ/2.
- **Backend hand-offs.** A merged mesh hands over to instances or impostors only while small on screen or at rest, because shading parity between backends is UNCONFIRMED.

### 4.4 Thermal policy and the τ controller

τ follows the measured molecule GPU time toward 8 ms (0.5 s windows, τ between its thermal minimum and 8 px). Above that sits the plan's policy:

- **serious:** a 0.75× molecule pass with MetalFX;
- **critical:** 30 fps, no slow motion, no particles.

Degradation always comes in this order:

1. τ rises;
2. atom budgets fall;
3. render scale drops;
4. 30 fps;
5. the oldest loose pieces poof.

Missing data shows parents. The HUD never lies: "10^(10^100) atoms · 4,812 drawn · generated by rule".

### 4.5 The web

The TypeScript package is the reference before it is a renderer. Later, without a format change:

- `BillionAtomBlock` becomes the copper crystal record, and its four hand-tuned tiers fall out of the same cut;
- `AtomsOptimized` draws materialized leaves;
- `lupi.status` reports counts with `formatMagnitude`;
- the `/m` pages state exact counts.

---

## 5. Physics and play at every scale

### 5.1 Size states

| State | When | Physics |
|---|---|---|
| **Toy** | within 3× its spawn span (spawns are 15 cm) | dynamic |
| **Monument** | up to 3 m | kinematic, ≤ 256 static shapes; stack things on it |
| **Terrain** | beyond 3 m, at most one at a time | static. A collision window of radius 2 m around the camera and each dynamic body holds up to 256 shapes (spheres, boxes, and an analytic plane per outer face of a box ancestor). It is rebuilt asynchronously when the window moves 0.5 m. Inside solid matter, an excavation bubble of 0.35 m keeps atoms off the lens. |

These extend plan §7.2 and keep RealityKit's guidance that size and mass ratios stay within one order of magnitude: only toys move, and they stay within 3 to 45 cm.

### 5.2 Felt mass, inertia and heft

**Felt mass.** One function, `lupi.feltmass.v1` (spec §10.2):

- below 1,018 Da it is the plan's curve exactly (water 0.080 kg, caffeine 0.206, C₆₀ 0.348 before `massScale`);
- above it, mass rises slowly in log log M toward 0.6 kg instead of clamping at 2.8 kDa. Hemoglobin 0.544, the 10⁶ salt 0.567, a googolplex 0.5998.

Order stays true everywhere, and the 10× band is kept. LupiKit's `GameUnits` (50 g × (M/18)^0.4, up to 100 kg) disagrees with the plan today and is replaced by this function.

**Inertia** keeps the true shape: point masses for leaves, closed-form lattice covariances for crystals and towers (exact in shape at every level, so a googolplex bar tumbles like a bar), and the parallel-axis theorem for groups. The plan's 0.02 floor applies.

**Heft**, `h = log10(1 + log10(M / Da))`, carries what felt mass cannot: a sub-bass layer, lower pitch, a longer haptic tail. A googol and a googolplex sound different.

### 5.3 Grab and the hand band

A touch ray tests the current cut, then refines along the hit to a chain of nodes.

- A body up to 40 cm is grabbed whole (the plan's grab and throw, §3.5, unchanged).
- On a monument or terrain, the grab takes the deepest node on the chain whose displayed diameter is 4 to 40 cm and detaches it as a chip. On the salt plain that is a block of ions you can throw.

### 5.4 Breaking expands one level

The threshold is the plan's: Δv against `base × sqrt(E / 346)`. E is a bond energy for molecules and an interface class for anything larger. Game values, labelled as such:

| Interface class | E (kJ/mol) |
|---|---|
| covalent | 346 |
| coordination | 150 |
| ionic contact | 80 |
| lattice-ionic | 60 |
| noncovalent (between chains or subunits) | 40 |

| Node | It breaks into |
|---|---|
| a molecule with a bridge | the plan's graph cut at the weakest class (§4.4), as selections |
| a cage or crystal leaf of up to 64 heavy atoms | a chip of one heavy atom with its hydrogens |
| a larger leaf | up to 8 octant selections |
| a crystal box | its octants |
| a tower level | its `f` children |
| a group | its children |

At most 16 pieces per break: beyond that, the pieces are the 15 children nearest the contact and one edited remainder. So a capsid sheds subunits before a subunit splits, which is how proteins actually come apart ([chemistry-play-physics.md §4.3](research/chemistry-play-physics.md)). A googolplex smashes into ten cubes.

The contact point is play input; the piece it picks is an exact step.

### 5.5 Chips, fragments and loose atoms

A pinch-pull at a surface takes the node under the finger that is 1 to 5 cm across.

- The chip is a path.
- The remainder is a selection of the complement when it is small, or an edit when it is not (at most 256 holes per edit, then "this one is full").
- A one-cell salt box breaks into loose Na and Cl ions that snap by the recipe's ionic-contact rules (D9).
- A shelved trophy's record is never destroyed by play (plan §4.4).

### 5.6 Building and growing

**Snap** is the plan's valence snapping. A built molecule is a new leaf, embedded in its trophy.

**Grow ×2** is proposed here and the owner should confirm it:

- Any body of molecular frame becomes the seed of a factor-2 tower, one level per tap.
- Ten taps make 1,024 waters. A hundred make 3 × 2¹⁰⁰ atoms, a 123-byte record that costs no more to hold, throw or keep than one water.
- It is the player's own road to a googol: 331 taps on a water.

**Gluing** arbitrary bodies into a group is reserved and not in v1.

### 5.7 Zoom: pinch, detents, dive

- **Pinch.** A similarity about the focus point. Within 10⁻³²× to 10³²× of life size it is one to one with the fingers, with a detent click per decade (plan §5.3) and one at life size.
- **Beyond.** The gesture moves along a logarithmic scale axis (`φ(λ)`, spec §8.8). Holding two fingers flies: from a googolplex bar at 30 cm to its atoms is about 7,300 axis units, about 20 s.
- **Flight** appends at most one run per axis per frame toward the focus, so the path stays a few hundred bytes.
- **Comfort.** Still turns flight into cuts between detents; Gentle halves its speed (plan §5.5).
- **Readout.** The magnification always shows: "shown 10^(−3.333 × 10^99) times life size".

### 5.8 Life size

The 10³⁰ rung is a 2.82 m cube of salt. At λ = 0 (a detent) it stands in your room at true size: 48.6 tonnes of it, from the exact composition (BrCl₄₉₉Na₅₀₀ in every thousand atoms), with the plaque's arithmetic to prove it. That is Powers of Ten in a living room, and it is the same record as the toy.

---

## 6. Persistence

### 6.1 A trophy references; it does not copy

Every kept piece is a `lupi.scale-ref.v1` (spec §7):

- a root NodeID;
- the records needed to resolve it (generators are always embedded);
- dependency packs for large explicit content;
- a canonical path;
- a probe when the piece has at most 4,096 atoms.

It travels as text, `lsr1:…`, in an optional field of `lupi.trophy.v1` (`molecule.scale`, with `source: "scale"`), amended before M1 when nothing has shipped. Small molecules keep their XYZ as today.

### 6.2 Sizes

| Kept | Bytes |
|---|---|
| caffeine (leaf embedded) | 406 |
| a `massive_1m` leaf | 115 |
| the salt rung 10³ | 260 |
| any rung from 10⁶ to 10¹⁰⁰ | 229 |
| the googolplex bar | 270 |
| one of its cubes | 284 |
| a grain of it | 496 |
| a 4,096-atom leaf | about 53 KB |

All are far under the account sync's 256 KiB payload bound.

### 6.3 Forever

- The generator registry is frozen like Remix `r1`: a new behaviour is a new version, and the old one keeps resolving, bugs included.
- Because generator records are embedded, a trophy of a googolplex grain needs no network, no pack and no server, ever.
- On load, the app recomputes the probe and the count and treats a mismatch as corruption, never as a different trophy.

### 6.4 Shelves and packs

- **Shelves.** A placement of a scale trophy stores its displayed span (`spanMetres`) instead of metres per Å, because a googolplex at 20 cm has no Float metres per Å. Shelves stay on the device (D7).
- **Packs** (LupiPack v1, spec §6) are immutable, content-addressed, 16 KiB-page-aligned files.
  - The app bundles `lupi-scale-r1.lpk` (the ladder, copper and diamondoids: 64 KiB).
  - The web build writes packs for gallery colossi to `/scale/p/<contentId>.lpk`.
  - The device caches them by contentId.

---

## 7. What lands when

The plan's roadmap (§8) changes as follows. Milestone numbers stay, so existing references remain valid.

**M0: the spine and the playable slice on it.**

- LupiScaleCore and LupiScale in Swift, the TypeScript reference, and the golden fixtures, green on Linux and on the owner's Mac.
- Every spawned molecule is a leaf, every break returns selections, every pinch goes through the anchor and the scale axis.
- **The scale receipt:** the salt crystal at 10³, 10⁶ and 10⁹ atoms, drawn through the cut with RealityKit boxes and instanced atoms. Frame time is flat across the three, and the HUD prints exact totals and drawn counts.

**M1: shelf and account.** Every keep writes a scale reference.

**M2: build and fragments.** Fragments, chips and built molecules are references; selections are their exact form.

**M3: scale content on the spine.**

- **M3a (RealityKit only):** the salt ladder to a googolplex; diamondoids; copper's billion; monuments, terrain, dive and chip; Grow ×2 if confirmed.
- **M3b (LupiEngine):** spikes S1 and S2, then `massive_1m` and one baked assembly at full impostor detail.

**M4: personalities and polish**, unchanged.

---

## 8. What is validated where

### 8.1 On Linux (`swift test`, `vitest`)

| Area | Tests |
|---|---|
| Byte-exact core | every §12 vector; encode, decode and re-encode for all kinds; reject non-canonical forms (−0, non-minimal BigUInt, unsorted removals, adjacent steps, bad CRCs, wrong probe); fuzzed record, path, pack and reference decoders |
| Generators | crystal coverage (the union of materialized leaves equals the whole, with no duplicates, for every structure and termination); closed-form counts equal to materialized counts; capped diamondoids clash-free (H–H ≥ 1.7 Å) with every carbon bonded to at least two; towers equal to direct lattices for small `f` and `L`; substitution counts |
| Magnitude | algebra against BigUInt below 2⁶⁵⁵³⁶; the formatting table; towers to `levels` 2⁶⁵⁵³⁵ |
| Paths | canonical merging; removal semantics (entering a removed node fails, containment); O(runs) arithmetic on 10¹⁰⁰-level paths |
| The directive as a test | for the same footprint and camera, cuts over the 10⁹, 10¹⁰⁰ and googolplex rungs visit within ±10 % of each other and never exceed a budget; inside views are identical for every rung deep enough |
| Frames | rebase continuity (≤ 10⁻⁴ px); random dives to depth 10¹⁰⁰ keep vertex error under 4 × 10⁻⁴ px |
| Physics logic | felt mass monotone; inertia of towers against brute force for small `L`; conservation of count and mass across every expansion; chip, keep and resolve round-trips |

### 8.2 Only on the device

| Area | What to check |
|---|---|
| Spikes | S1 post-process composition and depth convention; S2 throughput (impostors per ms) |
| New spikes | S6 `CustomMaterial` lattice shading on boxes; S7 `MeshInstancesComponent` cost at 5,000 spheres split by element; S8 asynchronous `ShapeResource` rebuild latency for terrain windows; S9 RealityKit stability of box and convex colliders at the size extremes |
| Measurements | frame time and thermal state over 10-minute soaks; how dithered fades look in AR light; nausea during flight and dive (Gentle and Still) |
| Feel | whether a googolplex feels different from a googol; whether ten cubes falling out of a bar is a delight |

---

## 9. Risks, unknowns, degradation and cuts

### 9.1 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Swift and TypeScript drift in a generator | trophies regenerate differently | Integer-only generators; the one float step (Q16 to Float32) is a single correctly rounded operation; golden fixtures in both languages, on Linux and on the Mac in release; frozen versions |
| RealityKit-only rendering is too slow or too plain for boxes and instances (UNCONFIRMED) | the ladder looks blocky or drops frames | τ rises first; fewer near atoms; LupiEngine (M3b) for the far field; boxes are only ever a few hundred instances in the desk view |
| Terrain window rebuild hitches (UNCONFIRMED) | stutter when walking on a plain | analytic face planes are instant, and atom bumps arrive a frame or two late; at worst the plane alone |
| A googolplex feels like a googol | the showpiece falls flat | heft (sound, haptics), the exact plaque, the flight time, the bar-of-ten-cubes fact; if it still feels the same, the dial stops at 10¹⁰⁰ |
| Self-similar sameness | the dive gets boring | the bromide doping puts the one Br of each 1,000-atom copy at a place picked from that copy's own key, so neighbouring copies almost never match; polycrystals with rotated grains are a reserved generator (spec §13); the copy is honest: "a perfect crystal, generated by rule" |
| Nausea during dive and flight | discomfort | capped flight speed, detents, Still cuts, Gentle halves speed |
| Edits accumulate | holes cost more | 256 per edit, then "this one is full"; holes smaller than 1/8 of a node are ignored by physics |
| BigUInt bugs corrupt keeps | lost trophies | property tests against `bigint`; the probe and recomputed count on every load |
| Scope: the spine delays M0's slice | a later playable | the spine is mostly integer code with tests and is written on Linux in parallel with device spikes; the four M0 call sites (spawn, collider, break, keep) can fall back to the plan's direct path without a data change |

### 9.2 UNCONFIRMED

- `MeshInstancesComponent` cost at 5,000 instances and per-instance colour.
- `CustomMaterial` surface shading of lattice bumps on boxes.
- `ShapeResource` rebuild latency and RealityKit stability with large static compounds.
- Post-process composition and depth convention (S1).
- The display's px/rad in portrait AR.
- Memory limits per device.
- Whether fades read as continuous in AR light.

### 9.3 Degradation order

1. τ up;
2. atom budgets down;
3. render scale 0.75× with MetalFX;
4. 30 fps;
5. the oldest loose pieces poof;
6. evict to aggregates.

Exact counts, paths and keeps never degrade.

### 9.4 Cut first, never cut

**Cut first, in order:**

1. Grow ×2 (if the owner declines);
2. lattice shading on boxes;
3. the 10³⁰ life-size moment;
4. edits on towers beyond chip removal;
5. the web adopting the cut;
6. `massive_1m` at full detail before LupiEngine.

**Never cut:**

- NodeIDs and the frozen registry;
- Magnitude and its formatting;
- paths with digit runs;
- anchors with eye-relative composition;
- the budgeted cut;
- references in trophies;
- the golden fixtures.

Retrofitting any of these later is the rewrite the directive forbids.

---

## Appendix A. Adjudication of the three proposals

Three proposals answered the directive from different angles: rendering first, mathematics first and play first. Each is scored from 1 (weak) to 5 (strong).

| Criterion | Render-first | Math-first | Play-first |
|---|---|---|---|
| **No ceiling** | 4: exact monomials plus level-index; BigUInt depths and repeat-cycle paths; nothing beyond its 4,096-bit integers | 5: counts as towers of any height, a log-axis floating origin, run lengths that are themselves counts | 4: exact integer exponents and digit runs, and an honest statement of the information-theoretic limit |
| **Bounded cost** | 5: a formal invariant, a global budgeted heap with parents standing in, a PI controller on τ, budgets per thermal state | 4: a derivation of the front-size bound; analytic boxes keep crystal fronts tiny; leans on LupiEngine | 4: budgets with clipmap rings around a pivot stack; thinner on the GPU side |
| **Determinism** | 4: integer generators, rational rotations, golden vectors, the `Math.round` trap; but leaves are re-sorted and re-quantized, so they no longer carry the source's numbers | 3: generator identity rests on binary64 arithmetic and on no fused multiply-adds, UNCONFIRMED for Swift release builds | 5: integer-only Q16 generators, a counter-based PRNG, file-order Float32 leaves, and an explicit split between kept, derived and play data |
| **Game feel** | 3: the hand band and chips are good; its felt-mass curve changes M0's water from 0.08 to 0.11 kg | 4: keeps the plan's feel; Grow ×N; inside mode; "a googolplex ÷ 1,000" as a joke | 5: a thirty-minute script; the salt ladder; the life-size boulder; terrain; a capsid that sheds capsomers; felt mass that keeps order |
| **Buildable on iOS 26 now** | 3: most tiers wait for LupiEngine; its M0 receipt through instancing is right | 3: box impostors with analytic shading need LupiEngine or an unproven `CustomMaterial` | 5: the whole ladder, a googolplex included, renders with RealityKit boxes and instances; LupiEngine only for dense explicit sets |
| **Testable on Linux** | 5 | 5 | 5 |
| **Simplicity** | 2: six node kinds, repeat cycles, affine seed folds, level-index and monomials, exposure bits at every level | 3: seven node kinds, counts with offsets, NodeKeys and external roots | 3: one lattice kind carrying count-sized extents and digit-run addresses everywhere; Philox; a zoo of reference steps |
| **Total (of 35)** | **26** | **27** | **31** |

**The design is a synthesis led by the play-first proposal.** Its laws, its leaves and its RealityKit-first sequencing are the backbone. The render-first proposal supplies the budget machinery, and the math-first proposal supplies the DAG and the closed forms.

### A.1 What came from each

| Proposal | Taken |
|---|---|
| **Render-first** | the invariant and its per-thermal-state budgets; one global budgeted refinement in which a missing child draws its parent; the PI controller on τ; the hand band for grabbing; collision proxies at a fixed object-space error; dithered fades keyed by a stable id; golden vectors and the `Math.round` trap; the M0 scale receipt; the "never cut" list |
| **Math-first** | the content-addressed DAG of nodes; paths with run-length digits; the front-size bound; box error constant in Å at every level, which keeps crystal fronts tiny; Grow ×N as a verb; the plan's felt mass unchanged below the knee; trophies holding a reference in an optional field; the directive written as a test; a four-call-site fallback for M0 |
| **Play-first** | the three laws (bounded nodes, a cut for all work, exact keeps and inexact play); file-order Float32 leaves; per-axis digit runs; anchors that push and pop with hysteresis; the scale axis that turns into flight; RealityKit-first sequencing; the terrain collision window; a contact point turned into an exact step; one owner of felt mass (it found LupiKit's disagreeing curve); integer-only generators; the salt ladder |

### A.2 What was rejected, and why

| Proposal | Rejected | Why |
|---|---|---|
| Render-first | leaves Morton-sorted and quantized to 2⁻¹² Å for identity | It breaks parity with the web's Float32 numbers and with the file's atom indices, both of which the bond fixtures depend on. Dedup across sources is not worth that. |
| Render-first | integer-quaternion rotations | Groups carry the f64 bits instead: identity hashes the bits and never computes with them. |
| Render-first | repeat-cycle paths and the affine seed fold | Per-axis runs are simpler, and SHA-256 copy keys over the canonical step are order-free and cost O(runs). |
| Render-first | the doubly-logarithmic felt mass | It changes M0's feel. |
| Math-first | floats in generator identity | Generators are integer and Q16. |
| Math-first | counts with offsets | Base-*f* digit runs are canonical and share their code with paths. |
| Math-first | separate `rec` and `ext` kinds | The tower is the recursive kind, and a NodeID already is an external reference. |
| Play-first | one lattice kind with count-sized per-axis extents | Crystals (up to 2⁶² cells per axis) and towers are kept apart, so crystals stay simple and towers can replicate any seed. |
| Play-first | Philox | SplitMix64 suffices, because the SHA-256 copy key already makes each copy independent. |
| Play-first | gluing arbitrary bodies | Reserved; the owner has not asked for it. |

### A.3 What none of them got right

1. **The googolplex cube.** All three spawned a googolplex as a cube. It cannot be one: 10¹⁰⁰ ≡ 1 (mod 3), so 10^(10^100) is not a perfect cube. The tower's top level is a 10 : 1 : 1 bar of ten cubes, and that became the showpiece's best fact.
2. **Capped cubes of diamond.** Computing vectors showed that hydrogen-capping a diamond box puts two hydrogens 0.74 Å apart on every {100} face, which the bond recipe would read as H₂. The capped generator therefore cuts {111} octahedra: real diamondoids, from adamantane C₁₀H₁₆ and decamantane C₃₅H₃₆ up to C₂₉₂₅H₆₇₆. Their formula is C<sub>(2m+3 choose 3)</sub>H<sub>(2m+2)²</sub>.
3. **Felt mass.** The plan's clamp makes everything above 2.8 kDa weigh the same 0.6 kg, which breaks true order exactly where scale lives. The new tail keeps order to a googolplex.

---

## Appendix B. Numbers worth knowing

| Thing | Count | Record | Notes |
|---|---|---|---|
| Salt rung 10³ | 1,000 | 126 + 52 B | 2.82 nm cube; one Br at atom 836 |
| Salt rung 10⁶ | 1,000,000 | 127 + 52 B | 28.2 nm cube |
| Salt rung 10⁹ | 1,000,000,000 | 127 + 52 B | 282 nm cube |
| Salt rung 10³⁰ | 10^30 | 127 + 52 B | 2.82 m cube at life size: 48.6 t |
| Salt rung 10¹⁰⁰ | 10^100 | 127 + 52 B | a bar 2.82 × 10²⁴ m long |
| Salt googolplex | 10^(10^100) | 168 + 52 B | a bar of ten cubes; BrCl₄₉₉Na₅₀₀ per copy; ≈ 4.859 × 10^(10^100 − 26) kg |
| Copper's billion | 1,000,188,000 (closed: 1,002,571,291) | 52 B | the web's `BillionAtomBlock`, as a record |
| `massive_1m` | 953,312 | 233 leaves + 35 groups, 12.5 MB pack | bakes in about 4 s in the JavaScript reference |
| Diamondoid m = 1 … 12 | 26 … 3,601 | 52 B each | C₁₀H₁₆, C₃₅H₃₆, C₈₄H₆₄, … C₂₉₂₅H₆₇₆ |
| Water × 2¹⁰⁰ (Grow) | 3 × 2^100 | 123 + 56 B | as cheap as one water |
