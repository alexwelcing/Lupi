# OMol25 in Lupi: how bonds are calculated, and where OMol25 shows up

Status: plan of record, 2026-10-03 (revision 2). Repo HEAD `c89bc5e`. This doc amends `docs/product-reset-2026-09-04.md` and `docs/product-ownership-contract.md` (section 4). It is committed as `docs/omol25-bonds-and-discovery.md` together with Track A.

**Revision 2 fixes:**
- **URL keys.** The new keys are `brp` and `bco`. `bp` (background pitch) and `bc` (bond cutoff) were already in use.
- **Edge cache.** The Cache API is now behind a guard, so it type-checks and Node tests pass.
- **Diborane.** A new bridged-pair rule, plus bridging B–H bonds exempt from the valence cap.
- **Per-pair data.** One per-pair bond contract (`getPerceivedBonds`) now serves the atom card, MCP, Object Facts and exports.
- **Validation.** The validation run is now a release prerequisite. Ionic-radius citations are corrected.
- **Object Facts.** They now use the same graph.
- **Contact reach.** The bound is derived from the tables, not hand-typed.
- **Hydrogen.** η²-H₂ is handled, and s-block–carbon is stated.
- **Copy.** The Learn copy now matches the rule.
- **Gate.** The periodic and multi-frame checks no longer depend on chemistry.
- **Missing files.** The test and edge files that were left out are now in tracks.

## 1. Decisions in brief

1. **OMol25 supplies no bonds, and its public releases never will.**
   - We checked about 2,600 rows across four ColabFit conversions, plus the documented ASE-LMDB fields. None has bonds, bond orders, SMILES or a molecular graph.
   - DFT bond orders exist only in the raw ORCA outputs of the 4M split (about 500 TB, Globus access with human approval).
   - So Lupi calculates bonds itself, and says so.
2. **Lupi calculates OMol25 bonds with one named recipe, `lupi-bonds.molecular.v1`.**
   - It is a pure, synchronous, deterministic TypeScript function, `perceiveBonds()`, in `packages/core/src/bonds/`.
   - Inputs: atomic numbers, coordinates and a tolerance.
   - Output: a list of bond pairs. Each pair has a **kind** (covalent bond, metal coordination or ionic contact), a length in Å, and its excess over the covalent-radius sum.
   - It also returns every pair it rejected, with the reason.
   - One memoised accessor, `getPerceivedBonds(frame, …)`, hands that same result to every consumer: the live view, the atom card, MCP, Object Facts (rings and symmetry detents), the GLB/USDZ export and the OMol25 ink drawings. All of them show one graph.
3. **The recipe is applied only where the file declares chemistry.**
   - The edge writes each OMol25 row's total charge, spin multiplicity and their provenance into the XYZ comment line. The parser reads them into `Frame.chemistry`.
   - **Automatic** use requires all of the following:
     - the frame has `Frame.chemistry`;
     - the XYZ parser marked it non-periodic (`Frame.periodic === false`);
     - it has no more than 2,000 atoms and no source bonds;
     - bond inference is allowed;
     - it is a single-frame file, or an OMol25 record.
   - Gallery molecules, materials, MD trajectories and every non-XYZ format keep today's rule, now named `lupi-bonds.distance.v1`. They look exactly as they do today.
4. **Each bond kind looks different, and the inference is stated in words.**
   - Covalent bonds stay solid CPK sticks.
   - Metal coordination is **dashed**.
   - Ionic contacts (Li, Na, K, Mg, Ca and the rest of the s-block) are **dotted** and thin, never covalent sticks. Today's rule draws the metal as a covalent stick in 97.68% of OMol25's 1,684 salt rows.
   - Every surface says that Lupi inferred these bonds and OMol25 did not provide them.
5. **No bond orders in wave 1.**
   - Double, triple and aromatic bonds are phase B: opt-in, off by default, labelled "inferred". The algorithm is specified in section 2.6.
   - A wrong double bond is worse than a single stick labelled "no bond order".
6. **v1 is validated before it is frozen.**
   - A one-off local Node run of `tools/omol25-bonds/` on all 27,697 neutral-validation rows must produce `packages/core/src/bonds/validation-v1.json` before the release that ships v1. No CI is involved.
   - The parameters that are Lupi's own choices are named in section 2.3. The run reports how sensitive the results are to each one.
   - v1 freezes at its first production deploy. Any later change becomes v2.
7. **OMol25 becomes a front-door resource.** It gets a primary nav item, a home shelf of hand-picked OMol25 structures directly after the hero (zero canvases, bundled data, no Hugging Face call from `/`), finder handoffs, a Library that leads with OMol25, a viewer source card, and MCP parity. Section 4 has the details.

## 2. The bond algorithm: `lupi-bonds.molecular.v1`

### 2.1 Inputs, and where each comes from

| Input | Neutral lanes (`neutral-train`, `neutral-validation`) | Preview lanes (`validation-preview`, `train-4m-preview`, `all-train-preview`) | Used by |
|---|---|---|---|
| Atomic numbers, positions (Å) | source | source | wave 1 |
| Total charge | 0 by split definition ("charge-neutral singlets", arXiv 2505.08762 v2 Table 1). neutral-validation also has `property_metadata.charge`. | `property_metadata.charge` | shown in wave 1; used for orders in phase B |
| Spin multiplicity (2S+1) | 1 by split definition. neutral-validation also has `property_metadata.spin`. | `property_metadata.spin` | shown in wave 1; phase B eligibility |
| `data_id` (domain) | neutral-validation only | yes | copy only (Learn caveats); never switches rules |
| Mulliken / Löwdin charges | neutral-validation only | yes | phase B only |

**Rules for charge and spin:**
- Spin is **never** read from ColabFit's `multiplicity` column. That column reads 1 for a Pr complex whose `spin` is 3. It stays in the row JSON, documented as "ColabFit column, not spin multiplicity", and no UI reads it.
- The parser never reads a bare `spin=` key, because different tools use it for S, 2S or 2S+1. The edge writes `multiplicity=` instead.
- The provenance of charge and spin is always one of:
  - `record`: from `property_metadata`;
  - `split-definition`: neutral-train, which has no metadata column;
  - `file-declared`: another extended-XYZ file that declares `charge=`;
  - `unavailable`.

### 2.2 Element classes and radii (explicit Z sets, so they cannot drift)

| Class | Elements | Treatment |
|---|---|---|
| H | H | hydrogen rules |
| covalent | all non-metals, metalloids and halogens; Be, Al, Ga, In, Tl, Sn, Pb, Bi, Po; Kr, Xe | covalent bonds with valence caps |
| s-block ion | Li, Na, K, Rb, Cs, Fr, Mg, Ca, Sr, Ba, Ra | ionic contacts only; never covalent sticks |
| coordinating metal | Z 21–30, 39–48, 57–80, 89–112 | coordination bonds |
| inert | He, Ne, Ar, Rn | never bonded |

**Radii:**
- **Covalent radii.** `ELEMENT_DATA[z].radius` (Cordero 2008, with a Pyykkö fallback). This is the table the viewer uses today.
- **Coordination radii.** Cordero's high-spin values, so high-spin complexes are not missed: Mn 1.61, Fe 1.52, Co 1.50 Å.
- **Cation radii** (Shannon 1976 effective ionic radii, CN6): Li⁺ 0.76, Na⁺ 1.02, K⁺ 1.38, Rb⁺ 1.52, Cs⁺ 1.67, Fr⁺ 1.80, Mg²⁺ 0.72, Ca²⁺ 1.00, Sr²⁺ 1.18, Ba²⁺ 1.35, Ra²⁺ 1.48.
- **Donor contact radii.** These are Lupi's choices from published anion radii:
  - Shannon 1976 CN6: O²⁻ 1.40, F⁻ 1.33, Cl⁻ 1.81, Br⁻ 1.96, I⁻ 2.20, S²⁻ 1.84;
  - N³⁻ 1.46 is Shannon's CN4 value;
  - P³⁻ 2.12 is Pauling's radius.
  - They are labelled as such in code comments, in the Copy-method caption and in `validation-v1.json`.

### 2.3 Steps, with exact thresholds

**Notation.**
- τ is the bond tolerance: the existing slider, URL key `bt`, default 0.45 Å, range 0–1.5.
- Stretch is s = d/(r_i + r_j) and excess is e = d − (r_i + r_j), both using covalent radii.
- **Lupi choices.** These were not taken from a reference, and the harness reports how sensitive the results are to each:
  - the ionic contact margin 0.35 Å;
  - the haptic ratio 1.15;
  - the ion coordination-number caps;
  - the O cap of 3;
  - the metal–metal slack 0.25 and the metal–hydride slack 0.30.

1. **Candidates.** Use a uniform grid whose cell is the largest cutoff present among the frame's elements, never more than 6 Å. Compare squared distances for every pair i < j.
   - **Clash floor.** If d < 0.40 Å, never bond the pair. Count it in `clashes`.
   - **Covalent.** covalent/H with covalent/H, when d ≤ r_i + r_j + τ.
   - **Coordination.**
     - Metal with a covalent-class non-H atom: d ≤ r_M + r_L + τ, using the high-spin r_M for Mn, Fe and Co.
     - Metal with metal: d ≤ r_i + r_j + 0.25.
   - **Metal–H.** d ≤ r_M + 0.31 + 0.30. Step 3 resolves these.
   - **Ionic contact.** An s-block ion with a donor X ∈ {N, O, F, P, S, Cl, Br, I}, when d ≤ r_ion(M) + r_ion(X) + 0.35. Examples:

     | Pair | Cutoff (Å) |
     |---|---|
     | Li–O | 2.51 |
     | Na–O | 2.77 |
     | K–O | 3.13 |
     | Mg–O | 2.47 |
     | Ca–O | 2.75 |
     | Na–Cl | 3.18 |

   - **Never bonded:**
     - anything involving an inert atom;
     - ion–ion;
     - ion–metal;
     - an ion with C, H or any non-donor. So cation–π and s-block organometallic M–C bonds are not drawn in v1. The Learn copy says so whenever an ion sits within r_cov(M) + r_cov(C) + τ of a carbon (`counts.ionCarbonClose`).
2. **H–H.** A covalent H–H candidate survives only if neither H has any other **covalent** candidate. Metal–H candidates are ignored here, so H₂ and η²-H₂ ligands keep their H–H bond. Otherwise the reason is `hydrogen-pair`.
3. **One partner per hydrogen.**
   - If an H's two least-stretched covalent partners are both B, it keeps both (B–H–B) and is flagged as bridging.
   - Otherwise it keeps its least-stretched covalent partner and drops the rest (`hydrogen-single-partner`).
   - An H that keeps a non-H covalent partner drops all its metal–H candidates (`hydrogen-metal-contact`). This removes agostic contacts.
   - An H whose only covalent partner is another H (an H₂ unit) keeps its metal–H candidates as coordination (η²-H₂).
   - An H with no covalent partner is a hydride. It keeps up to its 2 least-stretched metal–H candidates as coordination. Two partners means a bridging hydride.
4. **Bridged pair.** Drop a B–B or metal–metal candidate when both atoms keep a bond to the same bridging H (`bridged-pair`). In diborane this removes the 1.77 Å B–B, leaving each B with 2 terminal and 2 bridging H.
5. **Acute angle.** Applies at covalent-class centres, to covalent bonds only.
   - Visit atoms in index order, and each atom's bonds in ascending stretch.
   - Drop a bond within 45° of a bond already kept at that atom (`acute-angle`). The test is `dot > 0 && dot*dot > 0.5*|u|²*|v|²`, with no trig.
   - Bridging B–H bonds are never dropped here.
   - It is never applied at metals, so haptic rings survive.
6. **Valence caps.** Only covalent bonds count; coordination and contacts never count against a ligand.
   - Visit covalent bonds in descending stretch, ties broken by (i, j). Drop a bond while either end is over its cap (`valence-cap`).
   - Bridging B–H bonds are never dropped by this step. Each counts 1 toward boron's cap.

   | Element | Cap |
   |---|---|
   | H | 1 (2 when bridging) |
   | B, C, N | 4 |
   | O | 3 |
   | F | 1 |
   | Be | 4 |
   | Al, Ga, In, Tl | 6 |
   | Si, Ge, Sn, Pb, P, As, Sb, Bi, S, Se, Te, Po | 6 |
   | Cl, Br, I | at most 1 partner that is not O/F, and at most 7 in total (allows ClO₄⁻, IF₇, BrF₅) |
   | Xe | 8, O/F partners only |
   | Kr | 2, F partners only |

7. **Metals.**
   - **Haptic trim.** For each metal, group its coordination partners into sets connected by kept covalent bonds. In a set of 2 or more, drop partners with d > 1.15 × the shortest distance in that set (`haptic-trim`).
   - **Cap.** At most 12 coordination bonds per metal, keeping the least stretched (`metal-coordination-cap`).
8. **Ions.**
   - **Donor precedence.** Drop M···X when X has a kept covalent neighbour Y that is also a contact of M and d(M,Y) < d(M,X) − 0.15 Å (`ion-donor-precedence`). This removes K···S behind a sulfonate O.
   - **Coordination-number caps.** Keep the contacts with the smallest d − r_ion(M) − r_ion(X) (`ion-coordination-cap`):

     | Ion | Cap |
     |---|---|
     | Li, Mg | 6 |
     | Na, Ca | 8 |
     | K, Sr | 10 |
     | Rb, Cs, Fr, Ba, Ra | 12 |

9. **Final counts and evidence.** Computed from the final graph, after all removals:
   - `long`: covalent bonds with e > 0.20 Å.
   - `nearMiss`: covalent-class pairs with τ < e ≤ τ + 0.20 that were not bonded.
   - `removed`: every pair dropped in steps 2–8, with its reason.
   - `fragments`: connected components over covalent and coordination bonds.
   - `bridgingH`: H atoms that keep 2 partners.
   - `ionCarbonClose`, and `clashes`.

**Reach bound (a computed constant, not a literal).**
- `MAX_ION_CONTACT_A` = max r_ion + max r_donor + 0.35 = 1.80 + 2.20 + 0.35 = 4.35 Å.
- `MAX_COORDINATION_A` = 2 × max metal radius + τ_max.
- The grid takes its cell from the cutoffs actually present, so no output pair can lie outside the search.

**Invariants (unit-tested).**
- Every covalent pair satisfies d ≤ r_i + r_j + τ. Covalent output is therefore a subset of the distance recipe, and the stale-bond collapse threshold stays valid.
- Every coordination pair satisfies its own rule, so it may exceed Cordero + τ for high-spin Mn, Fe and Co. That is harmless: the molecular path never uses `bondRenderPlan`'s cutoff.
- Every contact is ≤ `MAX_ION_CONTACT_A`.

### 2.4 What "bond values" Lupi reports in wave 1

For every drawn line, Lupi reports four things:
- the atom pair;
- its kind;
- its length in Å, computed from the source coordinates;
- its excess over the covalent-radius sum.

For each structure it reports counts by kind and the evidence counts. It does **not** report bond orders, bond energies or hydrogen bonds in wave 1.

### 2.5 Hydrogen bonds (phase D: opt-in, off by default, URL `bhb=1`)

- **Donor:** N, O, F or S that carries a covalent H.
- **Acceptor:** O; F; N with fewer than 4 bonds; S with at most 2 bonds; halide ions.
- **Distances:** H···A ≤ 2.5 Å and D···A ≤ 3.5 Å. For S, Cl, Br and I acceptors: 3.0 Å and 4.0 Å.
- **Angle:** D–H···A ≥ 120°.
- **Exclusions:** A within 3 bonds of H.
- **Limit:** at most one per H, the shortest.
- **Drawing:** dotted hairlines, never counted as bonds.

### 2.6 Bond orders (phase B: opt-in, off by default, URL `bor=1`; specified now, built later)

- **Recipe id** `lupi-bond-orders.v1`; the UI label is "Inferred bond orders".
- **Eligibility.** Only fragments where:
  - the total charge is known (`record` or `split-definition`);
  - multiplicity = 1;
  - there is no coordinating metal;
  - there are 200 atoms or fewer.
  - Anything else shows single sticks labelled "orders unknown".
- **Fragment charges:**
  - An isolated s-block ion is fixed at its group charge (+1/+2), because Mulliken under-reports Mg, Ca, Na and Li.
  - Otherwise use the rounded Mulliken sum, reconciled to the total by adjusting the fragment with the largest rounding residual.
  - Without partial charges (neutral-train), find each fragment's solvable charges in {0, −1, +1, −2, +2}, then choose the combination that sums to the total with the minimum Σ|q|.
  - If that fails, retry the whole molecule at the total charge.
- **State table** (neutral first, to avoid RDKit's `[S+][O-]` and `S#[O+]` on rows 196 and 357):

  | Element | States |
  |---|---|
  | H | (1,0) |
  | B | (3,0), (4,−1) |
  | C | (4,0), (3,−1), (3,+1) |
  | N | (3,0), (4,+1), (2,−1) |
  | O | (2,0), (1,−1), (3,+1) |
  | F | (1,0) |
  | Si, Ge | (4,0), (6,−2) |
  | P, As | (3,0), (5,0), (4,+1), (6,−1) |
  | S, Se, Te | (2,0), (4,0), (6,0), (1,−1), (3,+1) |
  | Cl, Br, I | (1,0), (3,0), (5,0), (7,0); isolated (0,−1) |

- **Solver:**
  1. Unpaired-electron matching (Edmonds).
  2. Charge repair toward the fragment charge.
  3. Best-first enumeration, capped at 20,000 iterations, 50 ms per fragment and 250 ms per molecule. When the budget trips, show connections only.
  4. Kekulé form chosen from DFT lengths: flip when the double bonds come out shorter than the singles by more than 0.03 Å.
  5. Aromatic when the ring's plane deviation is ≤ 0.15 Å and Hückel 4n+2 holds.
  6. Delocalised for terminal X–O/N pairs of equal length (Δ < 0.03 Å).
- **Gate.** Draw orders only if Σ formal charge = fragment charge, no |c| > 1, and no carbon carries a charge where a heteroatom state was available.
- **Data.** The Mulliken/Löwdin `Properties=` columns ship **with phase B, not before**. They change the decoded-frame digest, and so every OMol25 export `specId`, once. The release notes will say so.
- **Rendering.** Lane offsets are applied in the shader after the display-motion offset, so bond ends stay bit-exact.

### 2.7 How bonds are drawn (wave 1)

| Kind | Look | Radius | Style code (colour alpha byte) |
|---|---|---|---|
| covalent | solid stick, CPK split colours (unchanged) | 1.0× | 255 |
| coordination | dashed: period 0.30 Å, 60% on | 0.6× | 170 |
| ionic contact | dotted: period 0.16 Å, 45% on | 0.45× | 85 |

**How the style reaches the shader.**
- The style rides in the bond instance colour's alpha byte. That byte is an unused 255 today (`packages/scene/src/tsl/bondImpostorMaterial.ts:97-118`), so every existing bond renders byte-identically.
- The fragment shader decodes `k = round(alpha·3)` and discards where `fract(axialÅ/period) > duty`, phase-centred so each end begins with a dash.

**What stays the same.** Bond ends remain bit-exact copies of atom positions. Display motion, strain thinning, the ink look (which inherits the dashes), picking and overlays are unaffected. No new colours are added; lime stays reserved for selection and hover.

**Other changes for molecular frames:**
- **Main thread, no worker.** The molecular recipe runs synchronously through the shared cache (≤ 2,000 atoms; about 1 ms at OMol25 sizes). It never uses the bond worker or the GPU.
  - This removes the second WebGPU device (about 87 MB, 5 s init) that a 50-atom molecule allocates today.
  - It also makes the live result the same object that UI, MCP and export read.
  - Gallery routing is unchanged.
- **Contact-occlusion stubs.** The stub reach becomes 2 × the largest covalent radius among the non-ion, non-inert elements present, plus τ.
- **Stale-bond collapse** (`Bonds.tsx:1003-1018`) runs on covalent kind only.
- **Cell box.** Auto `showCell` no longer draws a padded box around frames that have chemistry and `periodic === false` (the 300–350-atom preview rows).

### 2.8 One graph for every consumer (`getPerceivedBonds`)

`packages/ui/src/bonds/perceivedBonds.ts` exports `getPerceivedBonds(frame, { recipe, tolerance })`.
- It memoises `perceiveBonds` in a WeakMap keyed on `frame.positions`, with the key `recipe|tolerance`.
- It returns the **full, unfiltered** `PerceivedBonds`.
- Consumers that show drawn bonds apply the pure core helper `filterPerceivedBonds(p, { types, hiddenTypes, showContacts })`, the same filter `Bonds.tsx` uses:

| Consumer | What it reads |
|---|---|
| `Bonds.tsx` (live) | `getPerceivedBonds` → `filterPerceivedBonds` → instances |
| `AtomInfoHUD` | the filtered view, for "Bonded to … (inferred)" and "Ionic contacts: …" |
| MCP `lupi.viewer_state { includeBonds: true }` | the filtered view as `[i, j, kind, lengthÅ, excessÅ]`; reports `bondsFilter: { hiddenTypes, contacts }` |
| Object Facts (`objectFactsForFile` via `CameraToys`) | covalent + coordination pairs from the unfiltered result, passed as `options.bondPairs` to `computeObjectFacts`. Rings, symmetry detents and "face-on" labels then come from the drawn graph, never from a ring through an ion. Distance-recipe frames keep `computeBonds` (×1.15) as today. |
| GLB/USDZ export | `getPerceivedBonds` → `filterPerceivedBonds` (the same filter as the view) |
| Pick ink (build scripts) | `perceiveBonds` directly (molecular, τ 0.45) on the committed XYZ |

Determinism guarantees that the build scripts and the browser draw the same pairs.

### 2.9 Determinism, specIds and exports

**Arithmetic rules:**
- d² is computed in float64 from the float32 inputs, and compared against squared cutoffs.
- Stretch uses one `Math.sqrt` and one divide.
- Never `Math.hypot`, trig or `Math.cos` (cos²45° = 0.5 exactly).
- Every sort has an explicit (i, j) tie-break, and the output is sorted by (i, j).
- Tests: the same input twice, and a shuffled grid insertion order, both give byte-equal output.

**Digest rules:**
- Inferred bonds never enter `Frame.bonds`. `resolveBondTopologyMode` would label them `source`, and `Frame.bonds` is hashed into the decoded-frame digest (`renderArtifactSource.ts:41-43`).
- New XYZ comment keys are not hashed; only frame fields and `Properties` columns are. `Frame.chemistry`, `Frame.sourceRecord` and `Frame.periodic` are not added to the digest. So wave 1 changes no OMol25 content digest.

**`view.bonds` in the render spec:**
- It gains optional `topology` (`'source-frame-v1' | 'covalent-inference-v1' | 'molecular-inference-v1'`), `recipe` (`'lupi-bonds.molecular.v1' | 'lupi-bonds.distance.v1'`) and `contacts` (boolean).
- It stops emitting `sourceBondCount`.
- The validator allows the three keys without requiring them, which keeps the edge fixture at `apps/mcp-worker/src/index.test.ts:875-897` valid.
- This fixes a latent bug: today every MCP GLB/USDZ export with bonds is rejected, because `exactViewObject` refuses `topology` and `sourceBondCount`. So no valid specId changes.

**GLB/USDZ:**
- Three named meshes: `lupi-bonds-covalent`, `lupi-bonds-coordination` and `lupi-contacts-ionic`.
- Dashes and dots become cylinder segments with the same period and duty.
- `userData` holds `{ lupiBondRecipe, lupiBondKind, lupiProvenance: 'inferred' }`, written as glTF extras.

**Raster exports:**
- Deterministic raster exports with bonds stay fail-closed in wave 1.
- Phase 2 opens them through the validator's existing `execution: 'cpu-snapshot-v1'` and `appliedCount` slots. The molecular result is already synchronous and keyed on the frame, so the receipt is issued only when the pairs came from `getPerceivedBonds` for the spec's exact frame and tolerance.
- Interactive UI exports capture what is drawn, as configured.

### 2.10 Performance

- O(n·k) on a grid. Target p99 ≤ 5 ms in Node at 350 atoms; a plain grid measured 0.78 ms at 397 atoms. The harness records p50/p95/p99.
- Capped at 2,000 atoms, the same cap as Object Facts.
- One memoised computation per (frame, recipe, τ), shared by all consumers.
- `@atlas/core/bonds` is a pure subpath. The landing chunk never imports it.

### 2.11 How provenance is shown

**Strings kept.** These are pinned by existing tests:
- "Bond guides";
- "OMol25 supplies no bond topology" (`tests/ui/library.spec.ts:69`);
- "OMol25 supplies no bonds" (`Omol25Collection.test.tsx`, `LibraryCard`);
- 'Visual guide only' (distance recipe, `studyFacts.test.ts:75`).

**Bond legend** (new DOM HUD, `BondLegendHUD`):
- **Placement.** Stacked above `PropertyLegendHUD`. It registers as a phone occluder in `viewInset` and is not a pill.
- **Shown** whenever the molecular recipe is active.
- **Expanded copy:**
  - "Bonds inferred from DFT geometry · Lupi v1"
  - swatches "— bond ┄ coordination ··· ionic contact"
  - "OMol25 supplies coordinates, charge {q} and spin multiplicity {m} — not bonds."
- **Collapsed copy:** "Inferred bonds ⓘ".
  - It always starts collapsed on a phone and under Still.
  - Under Standard motion it collapses after 4 s.
- **Variants:**
  - "Inferred bonds · adjusted (+0.60 Å)" when τ ≠ 0.45;
  - "Distance-only guides" for the distance profile.
- ⓘ opens the Learn section.

**Learn section "How these bonds were drawn"** (`StudyLensPanel`).
- The paragraph is generated by `bondMethodParagraph()` in core, from the same constants as the recipe:

  > Lupi infers these bonds; OMol25 provides none. Two atoms are bonded when they are closer than their covalent radii (Cordero 2008) plus 0.45 Å, and never closer than 0.40 Å. Each hydrogen keeps only its least-stretched partner, the one closest relative to its usual bond length. When two bonds leave a non-metal atom less than 45° apart, the more stretched one is dropped. An atom over its usual valence loses its most stretched bonds first. Lithium, sodium, potassium, magnesium and calcium are treated as ions: they get dotted ionic contacts to nearby oxygen, nitrogen, sulfur, phosphorus and halogen atoms, never bonds. Transition metals get dashed coordination lines.

- **Counts line:** "This structure: {covalent} bonds · {coordination} metal–ligand · {ionicContact} ionic contacts · {long} long bonds · {removed} removed by the rule · {clashes} clashes."
- **Inputs line:** "Inputs from OMol25: charge {q}, spin multiplicity {m} ({from the record | by split definition})."
- **Not-claimed line:** "Not claimed: bond orders, hydrogen bonds." Add "…, or carbon bonds to lithium or magnesium (organometallic s-block bonds are not drawn)" when `ionCarbonClose > 0`.
- **Long-bond line:** "{n} bonds are more than 0.20 Å longer than usual: this is a snapshot away from equilibrium, or a bond is breaking."
- **Domain caveat** (`reactivity`, `trans1x`, `rgd`): "Reaction-path snapshot: stretched bonds may be absent."
- **Clash line:** "Atoms closer than 0.40 Å — likely a coordinate problem in the source."
- **"How sure" line:** quotes `validation-v1.json`, for example "On all 27,697 OMol25 neutral-validation structures: no hydrogen with two bonds, no over-valent atom, no covalent stick to an s-block ion; {x}% of ions have 1 or more contacts."
- **[Copy method]** copies:

  > "Bonds inferred by Lupi (lupi-bonds.molecular.v1: Cordero 2008 covalent radii + 0.45 Å; one least-stretched partner per H; valence caps; s-block ionic contacts at Shannon 1976 ionic-radius sums (N: CN4; P: Pauling) + 0.35 Å). Coordinates, charge and spin: OMol25 (Levine et al., arXiv:2505.08762, CC BY 4.0), {collection} row {row}."

**Other surfaces:**
- **Atom card:** "Bonded to C3 1.53 Å · H9 1.10 Å (inferred)" and "Ionic contacts: O4 2.41 Å".
- **Style → Structure guides:**
  - Bond rule: Molecular (v1) / Distance only. Store `bondProfile`, URL `brp=m|d`, omitted when auto.
  - Contacts toggle. Store `showBondContacts`, URL `bco=0` when off, default on.
  - Hint: "Bonds are inferred from geometry by Lupi; OMol25 supplies none. They do not show bond order."
  - The URL keys `brp`, `bco`, `bor` and `bhb` were checked against every `delta.*` key in `store.ts` and `savedViews.ts`; all are unused.
- **Library card:** "Source DFT coordinates, charge and spin. OMol25 supplies no bonds; Lupi infers them and labels them."

### 2.12 MCP and edge reporting

**`lupi.status` and `lupi.viewer_state`:**
- Keep `bondTopology` (`source | inferred | unavailable`), `bondSource` and `bondCount` (covalent + coordination).
- Add: `bondRecipe`, `bondToleranceAdjusted`, `bondKinds {covalent, coordination, ionicContact}`, `bondEvidence {long, removed, nearMiss, clashes}` and `chemistry {totalCharge, spinMultiplicity, source, domain} | null`.

**Other tools:**
- `lupi.viewer_state` accepts `includeBonds: boolean`. It returns `bonds: [[i, j, kind, lengthÅ, excessÅ], …]` (at most 5,000; `bondsTruncated`) plus `bondsFilter`.
- `lupi.set_viewer` gains `bondProfile` and `showBondContacts`.
- The tool count stays at 31. Regenerate the manifest.
- `lupi.browse_collection` rows gain `charge`, `spinMultiplicity`, `chargeSource`, `domain` and `homoLumoGapEv`. `sourceTruth` keeps `bondTopology: 'not-provided'` and adds `viewerBonds: { recipe: 'lupi-bonds.molecular.v1', provenance: 'inferred' }`.

**Edge:**
- Keeps `x-lupi-bond-topology: not-provided` and `bonds=not-provided`.
- Adds `x-lupi-charge-provenance` and `x-lupi-bond-inference`, both added to the CORS `access-control-expose-headers` list (`apps/mcp-worker/src/index.ts:2305-2309`).

### 2.13 Validation

**Unit tests** (cheap, pure, in the existing vitest suites), on hand-built geometries:

| Group | Cases |
|---|---|
| Organic | water, methane, caffeine |
| Hydrogen | H₂ kept; η²-H₂ on a metal (H–H kept, 2 coordination); crowded H–H dropped; stretched second C–H dropped |
| Boranes | diborane: B–B dropped (`bridged-pair`), 2 bridging H each with 2 B partners, each B has 4 bonds, bridgingH = 2 |
| Clash | a 0.35 Å pair |
| Hypervalent | ClO₄⁻ (4), PF₆⁻ (6), IF₇ (7); Cl with two C partners keeps 1 |
| Ions | [Na(H₂O)₆]⁺ (6 contacts, 0 Na sticks); K⁺ by sulfonate (K···O kept, K···S dropped); K⁺ in 12 waters (cap 10); Fr–I at 4.30 Å contacted (bound 4.35) |
| Metals | ferrocene (10 coordination, haptic, no angle prune at Fe); cisplatin (4 coordination) |
| Properties | determinism (repeat, shuffled grid); fuzz of the per-kind invariants |

**Release prerequisite: the local harness.** `tools/omol25-bonds/` is a Node script, not CI.
- It pages all 27,697 neutral-validation rows through the Hugging Face rows API, cached under `.verify-artifacts/omol25-bonds/`, and runs both recipes.
- It writes `packages/core/src/bonds/validation-v1.json`.
- **Hard targets.** The release does not ship v1 unless all of these hold:
  - 0% of rows with an H with more than one bond (today 6.93%);
  - 0% with an over-valent H/C/N/O/halogen (today 9.68%);
  - 0 covalent s-block sticks (today 97.68% of salt rows);
  - byte-identical output on a second run;
  - p99 ≤ 5 ms.
- **Reported, owner-read, no target:**
  - the contact-count distribution per ion and the number of isolated ions;
  - the Mulliken-integrality rate: the share of covalent fragments whose Mulliken sum lies more than 0.25 from an integer. This is a reference-free check that a wrong split fails.
  - the share of rows changed relative to the distance recipe;
  - a sensitivity table for each Lupi choice: margin 0.25/0.35/0.45, haptic ratio 1.10/1.15/1.20, O cap 2/3, ion caps ±2.
- **Gallery no-op diff.** The 73 gallery XYZ files of 2,000 atoms or fewer under both recipes. This is evidence for the owner decision in section 8.
- **Changing a parameter.** If a target misses, or the owner changes a Lupi choice, the parameter is changed and the harness re-run before deploy. v1 freezes at its first deploy.
- **Not prerequisites:** an RDKit `DetermineConnectivity` cross-check (optional), and external ChEMBL/CCD/GEOM graph matching.

**Owner hand-check after deploy.** Open `https://lupi.live/?load=/v1/datasets/omol25/{collection}/structures/{row}.xyz`.

| Collection | Row | What it is | Expect |
|---|---|---|---|
| neutral-validation | 273 | K⁺ azo-dye sulfonate | dotted K···O, no K···S, no K stick |
| neutral-validation | 1239 | Ca²⁺ dicarboxylate | at most 8 dotted Ca···O |
| neutral-validation | 196 | Li⁺ sulfonate | dotted Li···O |
| neutral-validation | 357 | Mg²⁺ salt | dotted Mg···O |
| neutral-validation | 0 | choline + dianion | two fragments, no stick between them |
| neutral-validation | 1008 | ani2x distorted snapshot | a long-bond line in Learn |
| neutral-validation | 245 | nitrile | single sticks, "no bond order" |
| validation-preview | 0–2 | Pr/Ir complexes | dashed coordination; the card reads the record's spin (for example "triplet"), never "multiplicity 1" |
| validation-preview | 28, 56, 400008 | s-block electrolytes | dotted contacts |

## 3. Data pass-through (edge and parser)

**Edge** (`apps/mcp-worker/src/scienceData.ts`):
- **Parse `property_metadata` defensively:**
  - charge must be an integer with |q| ≤ 10;
  - spin must be an integer from 1 to 11;
  - a truncated (listed in `truncated_cells`) or unparsable cell gives `chargeSource: 'unavailable'` and never fails the page.
  - Neutral-train gets 0 / 1 / `split-definition`.
- **Comment line** (key=value, no spaces in values):
  `OMol25 neutral-validation row=812 | collection=neutral-validation | formula=… | configuration_id=… | property_id=… | method=ωB97M-V | charge=0 | multiplicity=1 | charge_source=record | data_id=spice | energy_eV=-12345.678 | max_force_eV_per_A=2.81 | homo_lumo_gap_eV=8.34 | coordinates=source | bonds=not-provided | license=CC-BY-4.0 | source=colabfit/OMol25_neutral_validation`
  - No `Properties=` columns in wave 1.
- **Timeouts:** `AbortSignal.timeout` of 9 s for rows, filter and search; 12 s for a structure. A timeout returns `504 {status:'slow'}`.
- **Cache.** Structure responses are cached under a key that includes `omol25-xyz-v2`, using the Worker's existing guarded pattern (as in `gist.ts:262`, `jev.ts:318`):
  `const cache = options.cache === undefined ? (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null : options.cache;`
  - With no cache (plain Node vitest, `tsc` with `types: []`), it skips caching.
  - Tests inject a fake cache.
- **Manifest:** reports `sourceRows` 34,335,828 / 27,697 / 101,666,280 / 3,986,754 / 2,762,021.
- **Deploy step (owner):** purge the Cloudflare cache for `/v1/datasets/omol25/*/structures/*`. Until a client gets the new file, it falls back to the distance recipe, which is never wrong, only older.

**Parser** (`packages/parsers/src/xyzParser.ts`):
- **Reads into `Frame.chemistry`:**
  - `charge=` (integer, |q| ≤ 20);
  - `multiplicity=` or `spin_multiplicity=` (integer 1–20);
  - `charge_source=`;
  - `data_id=`.
  - Chemistry is attached only when `charge=`, `multiplicity=` or `charge_source=` is present.
  - `charge=` without `charge_source=` is `file-declared`.
- **Sets `Frame.periodic`** to true when `Lattice=` is present, false otherwise. Other parsers leave it undefined, which the gate treats as "not eligible".
- **`Frame.sourceRecord`:** a comment that begins `OMol25 ` also fills it (collection, row, method, energy, maximum force, gap, licence, source).
- **Worker boundary:** all three fields cross it (`frameTransfer.ts`, `parse.worker.ts`, `hydrateWorkerFrame`).
- **Saved views:** `savedViews.frameToXyz` writes the chemistry keys back.
- **Shared module:** `packages/core/src/omol25/` replaces the five duplicated collection lists and holds the truth strings and URL helpers.

## 4. Surfacing plan

### 4.1 Contract amendment (lands with wave 1)

Amendment 2026-10-03, in `docs/product-reset-2026-09-04.md`, mirrored in `docs/product-ownership-contract.md`:

1. **Public navigation** is Molecules · OMol25 · Daily · Library · Scan · How to use · Open a file. OMol25 goes to `/library/omol25`. No label matches `/research|MLIP/i`.
2. **The home page** carries one OMol25 shelf directly after the hero, rendered from bundled same-origin data. It is not part of the 12-card student collection, which is unchanged. `/` makes zero OMol25, edge or Hugging Face requests and has zero canvases.
3. **The homepage finder** matches the gallery, the bundled featured OMol25 picks and PubChem names. For a formula-shaped query it adds one labelled, user-initiated "Find … in OMol25" link. No source is queried silently.
4. **Lupi keeps same-origin copies of a small featured set:** at most 48 rows, CC BY 4.0, attributed, each with a sha256 receipt. All other rows stay stream-only.
5. **Every OMol25 surface states:**
   - that coordinates are source data;
   - the geometry state (largest force);
   - that bonds are Lupi's inference, naming the recipe;
   - that any name is a derived parent compound.
   - The wording comes from `packages/core/src/omol25/truth.ts`.

### 4.2 Featured picks: data that every surface shares

- **Tool.** `tools/build-omol25-featured.mjs` runs once and needs the network; the build itself never fetches. It reads the hand-edited `tools/omol25-featured.picks.json` (`{collection,row,shelf,home,why}`).
- **It writes:**
  - `apps/web/public/datasets/omol25/featured/omol25_nv_<row>.xyz`: the edge comment format, no bonds, no `Properties` columns;
  - `apps/web/public/datasets/omol25/featured.v1.json` (schema `lupi.omol25-featured.v1`, also the agent-parity surface);
  - `packages/ui/src/landing/omolShelf.data.ts` (generated, landing-safe, under 1 KB gzip);
  - a curation contact sheet in scratch.
- **Wave 1 picks:**
  - 24 rows from neutral-validation, which has a verified 1:1 row map.
  - Shelves: `drug-like`, `amino-acid-ligand`, `conformers`, `off-equilibrium`, `salt-complexes` (the molecular recipe ships in the same release), `small`.
  - All 17 neutral-lane elements are covered, and at least 12 picks are `home: true`.
- **Gates:**
  - 12–120 atoms;
  - no pair closer than 0.7 Å;
  - under `perceiveBonds`, every H has exactly 1 covalent partner, no atom is over-valent, and there are 0 covalent s-block sticks.
- **Titles.** Hill formula. A ChEMBL or PubChem name is used only with owner approval **and** when the resolved Hill formula equals the structure's.
- **URL policy.** `isTrustedScienceDataUrl` gains `^/datasets/omol25/featured/omol25_nv_\d+\.xyz$` (same-origin).
- **Ink.**
  - `scripts/omol25-picks/build.mts` runs in the web build after the molecule pages. It writes `/og/omol25/<key>-ink.svg` and `-ink.json` from the committed XYZ with `perceiveBonds`.
  - `InkModel` gains `bk` (kind codes). Coordination is drawn with `stroke-dasharray`, and contacts are dotted.

### 4.3 Surface by surface

| Surface | Change | Track |
|---|---|---|
| Header (`SiteHeader.tsx`; static `/m` and `/daily` top bars) | Add "OMol25" after Molecules. `SiteSection` gains `'omol25'` (aria-current at `/library/omol25`). `/omol25` redirects to `/library/omol25`. | D |
| Home (`LandingPage.tsx`, new `OmolShelf.tsx` + `omol-shelf.css`) | Shelf directly after the hero, before DailyCard (details below). | D |
| Finder (`MoleculeFinder.tsx`) | See "Finder details" below. | D |
| Footer | Add "OMol25 structures" and "Library". | D |
| Library nav (`LibraryPage.tsx`) | All sources · OMol25 · Lupi gallery · Zenodo research · NIST potentials · Surprise me. | D |
| `/library/omol25` (`Omol25Collection.tsx`) | See "`/library/omol25` details" below. | D |
| `/library` all sources (`search.ts`, `providers/omol.ts`) | Each provider races a 6,000 ms timeout instead of `Promise.all`. The `omol` tie-break moves from 6 to 2. An "OMol25 picks" row of 6 sits above the grid. | D |
| Random (`randomOmol.ts`, `RandomStructure.tsx`) | Picks a uniform `crypto` integer in [0, 34,335,828) and opens `/v1/datasets/omol25/neutral-train/structures/{n}.xyz`, with no index download. Lede: "One random structure from the 34.3M-row OMol25 neutral training set". On failure: "OMol25's host didn't answer. Try again, or open a pick." No automatic retry. | D |
| Viewer palette (`ViewerApp.tsx` Discover) | "Browse OMol25 · 34.3M DFT structures" and "Open a random OMol25 structure". | D |
| Switcher (`MoleculeSwitcher.tsx`, `switchIndex.ts`) | The idle view gets a "From OMol25" group: 4 of today's picks with ink tiles, kept separate from `LOCAL_MOLECULES`. `omolTitle()` gives "{formula} (OMol25)" everywhere. | D |
| Viewer Learn (`StudyLensPanel.tsx`, new `Omol25SourceCard.tsx`, `studyFacts.ts`) | Details below. | B |
| Viewer bonds (legend, Structure guides, atom card, Object Facts) | Sections 2.8 and 2.11. | B |
| Library card / row (`LibraryCard.tsx`, `remoteOmol.ts`) | Subtitle "46 atoms · ωB97M-V · neutral singlet", or "· charge +1 · doublet". The false "· multiplicity N" is removed. Truth line per 2.11. `MoleculeHit.provenance` and `notice` are filled. | C (data), D (card) |
| SEO and copy | The home description names OMol25. `llms.txt` gets an OMol25 section. The stale "dataset browsing is separate" copy is fixed (`main.tsx:239-240`, `SeoEducationPage.tsx:43`). | D |
| Analytics (`loadMoleculeSource.ts`, `analytics/events.ts`) | `sourceKind()` returns `'omol25'`. `molecule_loaded` gains `entry`, taken from a one-shot `markOpenEntry`/`takeOpenEntry` (sessionStorage, 30 s expiry). The landing never imports analytics. | D |
| MCP / agents | Section 2.12. The `AGENTS.md` endpoint list adds `/v1/datasets/omol25*` and `/datasets/omol25/featured.v1.json`, plus the bond status fields. | B, C |
| Daily, mobile, molecule pages | Unchanged in wave 1. | — |

**Finder details.**
- The scope line adds "· 34.3M in OMol25", as a link.
- Up to 3 featured-pick matches, placed after gallery matches and before PubChem. Each has an ink tile and "OMol25 · {domain} · {atoms} atoms".
- A formula-shaped query adds "Find {q} in OMol25's 27,697-structure index ↗", linking to `/library/omol25?view=facets&q={q}`.
- Formula-shaped means all of:
  - the whole string is covered by `[A-Z][a-z]?\d*` tokens;
  - there are at least 2 tokens;
  - every token is one of the 17 neutral elements;
  - and there is a digit or mixed case.

**Home shelf details.**
- **Eyebrow:** "OMol25 · Meta FAIR Chemistry · CC BY 4.0", with Paper and Source links.
- **H2:** "From Open Molecules 2025".
- **Deck:** "34.3 million DFT structures to explore. Today's six picks."
- **Tiles:**
  - Six ink tiles, `home[(dayNumber·6 + i) mod N]`, chosen with DailyCard's landing-safe date helpers.
  - Each tile is `<a href="/?load=/datasets/omol25/featured/<key>.xyz">` with a lazy `img.ink-tile`: 88 px, or 64 px at ≤ 480 px.
  - Text: title; "{domain} · {atoms} atoms"; a chip only when charge ≠ 0 or spin ≠ 1.
  - A click runs `prefetchViewer`, then dynamically imports `openMolecule`.
- **Actions:** "Browse OMol25 →", "Surprise me" (with "one of 34,335,828"), "Filter by element →".
- **Caption:** `omolBondTruth()`.
- **Behaviour:**
  - rendered synchronously, so no layout shift;
  - under Save-Data, text marks replace the images;
  - nothing moves at idle;
  - no `.student-card`, no canvas, no three.js;
  - landing JS ≤ 3 KB gzip and CSS ≤ 1.5 KB gzip;
  - the finder stays in the first viewport.

**`/library/omol25` details.**
- **Shelves:** the featured picks, by shelf, on top.
- **Masthead:**
  - keeps "OMol25 supplies no bond topology" and the `.library-coverage` line naming `colabfit/OMol25_train_neutral`;
  - "Lupi stores no shards and copies no rows" becomes "Lupi pages rows on demand and keeps 24 hand-picked rows, credited, for its shelves";
  - row counts use `sourceRows`;
  - adds "Nearly all OMol25 geometries are snapshots away from a minimum."
- **Facets:**
  - `groups=` moves into the URL;
  - exact formula matches rank before the slice;
  - Previous/Next paging with "1–36 of N";
  - "Random in this filter".
- **Remote splits:**
  - "Random row" picks one row;
  - a 504 `slow` response gets its own copy: "OMol25's host is slow to answer. Try again in a moment.";
  - the existing warming sentence stays as is (`Omol25Collection.test.tsx:75` pins `/warming.*15 seconds/`);
  - raw abort text is never shown.

**Viewer Learn details.** `Omol25SourceCard` reads `Frame.sourceRecord` and `Frame.chemistry`, with no second fetch. It shows:
- collection and row;
- charge and spin, with their source;
- the HOMO–LUMO gap;
- the largest force, with the geometry state;
- energy in eV, with "not comparable across formulas";
- the citation, with Copy;
- "Open in Library" and "Random OMol25".

`studyFacts.inferSourceLabel` names the collection and row.

## 5. Phases

- **Wave 1 (this build):** everything above that is not marked phase 2, B or D.
- **Phase 2:**
  - `/m/omol25_nv_<row>` pages with share cards and Worker unfurls;
  - relay `RelayBaton.loadUrl`, for Ink-to-Light on shelf taps;
  - deterministic raster bond exports (`cpu-snapshot-v1`);
  - a v5 validation index;
  - functional-group facets regenerated from `perceiveBonds`;
  - a "Beyond neutral" shelf after the Pr/Ir hand-check;
  - a "Check bonds" mode (ghost lines and colour by excess);
  - `browse_collection` facet filters;
  - a Daily post-answer OMol25 link.
- **Phase B:** inferred bond orders (2.6).
- **Phase D:** hydrogen-bond overlay (2.5).

## 6. Out of scope, and known divergences

**Out of scope:**
- quantum bond orders (Mayer/Löwdin from ORCA, xTB Wiberg);
- RDKit or Open Babel WASM (RDKit.js lacks DetermineBonds; the Open Babel build is GPL-2.0);
- partial or forming bonds in transition states;
- three-centre bonds beyond B–H–B and M–H–M;
- Jahn–Teller radii;
- trajectory hysteresis (forced molecular on a multi-frame file recomputes each frame, labelled);
- cation–π and s-block organometallic M–C lines (stated in the Learn copy);
- changing bonds for the gallery, `/m` ink pages, Daily, mobile AR, the C60 hero or the GPU shader;
- new CI checks, browser verification lanes or Playwright specs;
- faceting the 34.3M split beyond the Hugging Face API;
- an OMol25 Daily puzzle;
- the mobile app;
- replacing the C60 hero;
- restoring a periodic-table grid.

**Known divergences (accepted in wave 1):**
- Distance-recipe frames (the gallery) keep Object Facts on `computeBonds` (×1.15) while the viewer draws r+r+0.45. This is unchanged from today, and the gallery diff shows identical pairs.
- The offline functional-group facets still use the Python `1.25·(rA+rB)+0.15` screen until phase 2. They are labelled as a search aid.

## 7. Build tracks

Four tracks, merged in the order A → C → B → D. The contracts are frozen, so B, C and D can start against stubs while A is in review. Track A must include the committed validation receipt before the deploying release.

## 8. Owner decisions requested

See `openQuestionsForOwner`. Defaults if there is no answer:
- nav and shelf as written;
- bond orders deferred;
- recipe limited to files that declare chemistry;
- titles are formulas;
- the Lupi choices as listed, unless the harness sensitivity table argues otherwise.
