# How Lupi infers, stores, renders and exports bonds, and what an OMol25 bond strategy has to change

All repo paths are relative to `/home/user/Lupi`. This was a read-only study: no builds, no browser runs, no timing measurements. Claims marked **code-derived** come from reading the code, not from running it. Claims I could not confirm are marked **UNCONFIRMED**.

## Summary

- **At least eight bond rules are in use, and they disagree.**
  - The live viewer and the GLB/USDZ export use an additive rule: bonded if d ≤ r_i + r_j + 0.45 Å.
  - The ink drawings, molecule pages, Daily clues, and the ring and symmetry detection use a multiplicative rule: d ≤ 1.15 × (r_i + r_j).
  - The OMol25 functional-group index uses a Python rule: d ≤ 1.25 × (r_i + r_j) + 0.15.
  - Mobile AR, the C60 hero, the rule that hides lagging bonds, and the contact-shadow "bond stubs" each use their own variant.
- **No rule has any chemistry beyond distance.** There are no hydrogen–hydrogen rules, no per-element bond-count caps, no metal or ion handling, and no valence pruning.
- **Bond orders exist only as an unused type.** No parser keeps them, no renderer draws them, and the ink drawings do not show them. PubChem's orders are fetched and then thrown away.
- **Molecular charge and spin are not used anywhere.** The OMol25 XYZ files Lupi serves contain neither. The ColabFit rows behind them have multiplicity but no charge.
- **Provenance is tracked correctly but only shown in words.** Every frame resolves to `source`, `infer` or `none`. The UI and documents call inferred bonds "visual guides", but in 3D a source bond and an inferred bond look identical.
- **Small molecules use a separate WebGPU device for bonds.** On WebGPU browsers, a 50–350-atom OMol25 molecule gets its bonds from a second GPU device the bond pipeline creates for itself, sized for 100,000 atoms. This is because `useGpuBonds` defaults to true.
- **The cleanest place to plug in a better method** is one pure CPU function in `packages/core`. It would be called by the bond worker, the model export, Object Facts, and the molecule-page and Daily build scripts, for molecule-sized frames only. The GPU path would stay for large frames.
- **Latent bug (code-derived):** the MCP export adapter writes two keys, `topology` and `sourceBondCount`, into `view.bonds`. The core spec validator rejects any key it does not list. So an MCP GLB or USDZ export with bonds on should fail validation today.

---

## 1. Connectivity rules

### 1.1 Radii

- **Covalent radii:** one single-bond table, `ELEMENT_DATA[z].radius`. The source comment says the values are Cordero et al. 2008, with Pyykkö 2009 for elements Cordero lacks (`packages/core/src/elements.ts:17-21`, `:241-242`). The table covers Z = 1–118; `node -e` over the file counted 118 entries.
  - Sample values: H 0.31 (`elements.ts:56`), Mn 1.39 (`:104`), Fe 1.32 (`:106`), Co 1.26 (`:108`).
  - Paper: https://doi.org/10.1039/B801115J. Whether Fe, Mn and Co are Cordero's low-spin values is **UNCONFIRMED**; I did not check the paper's table.
- **Display radius is separate from the bond radius:** `clamp(0.5·r_cov, 0.30, 0.70)` (`elements.ts:22-28`, `:51-53`). Scene mirrors both tables (`packages/scene/src/constants.ts:5-24`).
- **No van der Waals radii table exists** in core, scene, renderer or ui (grep for vdw/Bondi found only an energy-column name in `packages/core/src/types.ts:26`).
- **Fallback radius for unknown elements differs by path:**

| Path | Fallback radius |
|---|---|
| core | 0.76 Å (`packages/core/src/objectFacts/bonds.ts:5-6`) |
| scene CPU worker | 1.5 Å (`packages/scene/src/bondDetectCpu.ts:126-127`) |
| stale-bond check | 1.5 Å (`packages/scene/src/Bonds.tsx:80`) |
| `getElementSpec` | 1.40 Å (`elements.ts:311-318`) |
| Python OMol index | 0.77 Å (`tools/omol25-structures.py:114-115`) |

### 1.2 Every bond rule in the repo

| # | Path | Rule | Minimum distance | Where it is used |
|---|---|---|---|---|
| A | Live viewer, CPU worker | `d² ≤ (r_i + r_j + tol)²` (`packages/scene/src/bondDetectCpu.ts:125-130`) | `d² > 0` (`:84`) | Live bonds when not on the GPU |
| B | Live viewer, GPU compute | `dist ≤ r_a + r_b + config.tolerance` (`packages/renderer/src/pipeline/shaders/bond_compute.wgsl:141-145`) | `dist > 0.0` (`:145`) | Live bonds when WebGPU is available (the default) |
| C | GLB/USDZ export | Rule A, via `detectExportBonds` (`packages/ui/src/export/exportSceneBuilder.ts:451-478`) | `d > 0` | Model exports |
| D | Core `computeBonds` | `d ≤ (r_cov,i + r_cov,j) × 1.15` (`packages/core/src/objectFacts/bonds.ts:3-4`, `:106-130`) | 0.1 Å (`:7-8`, `:129`) | Object Facts rings and symmetry (`objectFacts/index.ts:37-46`), molecule-page ink models (`scripts/molecule-pages/catalog.mts:347`), Daily clues (`scripts/daily/clues.mts:138`) |
| E | Python OMol25 index | `1.25 × (r_a + r_b) + 0.15`, own radii table (`tools/omol25-structures.py:84-101`, `:113-116`) | none | Functional-group tags in the OMol25 neutral-validation index (`tools/build-omol25-validation-index.mjs:122`) |
| F | Mobile AR | `r_a + r_b + 0.45` (`apps/mobile/src/features/ar/ar-scene.ts:15-16`, `:224-226`) | 0.1 Å | Native AR, capped at 2,048 bonds (`:9`, `:228-231`) |
| G | C60 hero | flat `d ≤ 1.6 Å` (`tools/build-hero-data.mjs:32`, `:79`) | none | Landing-page hero |
| H | Stale-bond hiding | `(r_a + r_b + tol) × 1.1` (`Bonds.tsx:78`, `:1003-1018`) | none | An inferred pair from an older frame that fails this test in the frame on screen collapses to zero length |
| I | Contact-occlusion "bond stubs" | Any baked contact neighbour closer than `uBondStubReach` gets a darkening stub (`packages/scene/src/tsl/atomImpostorMaterial.ts:438-448`) | none | `uBondStubReach` is one global cutoff, the bond plan's maximum reach (`packages/ui/src/app/ViewerScene.tsx:680-681`), not the actual bond list |

Notes on the live path:

- **Tolerance default is 0.45 Å** (`packages/ui/src/store.ts:955`). The UI slider runs 0–1.2 (`packages/ui/src/SceneModControls.tsx:287`, `packages/ui/src/studio/MoleculeControls.tsx:682`). MCP clamps it to 0–1.5 (`packages/ui/src/mcpViewerBridge.tsx:2048-2050`). URLs round-trip it as `bt` (`store.ts:1177`, `:1266`).
- **An implicit maximum length applies.** The viewer passes `maxBondLength = min(6, 2·max r_cov + tol + 0.5)` (`ViewerScene.tsx:437-445`, with the radius lookup at `:108-128`). This is the CPU hash cell size and query radius (`bondDetectCpu.ts:104`, `:119`), so no pair longer than it is ever seen.
  - The export's maximum is `2·max r_cov + tol` (`exportSceneBuilder.ts:460`). For every real element this is longer than the longest per-pair cutoff, so the two paths behave the same in practice (code-derived).
- **Silent pair cap:** the CPU detector stores at most `min(natoms × 12, 50,000,000)` pairs and drops the rest without warning (`bondDetectCpu.ts:107-109`, `:134`).
- **Unused cutoff options:** the `typeCutoffs` prop is accepted but never used (`Bonds.tsx:225`, `:296`). `DEFAULT_CUTOFFS` and `buildTypeCutoffs` are exported but have no consumers (`Bonds.tsx:1205-1233`, `packages/scene/src/index.ts:46`). `SpatialHash.findBonds` discards its `typeCutoffs` argument (`packages/scene/src/SpatialHash.ts:248-249`) and has no production callers.

### 1.3 Hydrogen rules, per-element caps and metals

- **None in any TypeScript path.** A grep for valence, maxValence, isMetal or coordination caps in core, scene and renderer found nothing. Hydrogen is treated like any other element (radius 0.31).
- **The only caps are capacity limits, not chemistry:**
  - 12 pairs per atom in the CPU buffer (`bondDetectCpu.ts:109`).
  - On the GPU: 4, 6 or 12 bonds per atom depending on size (`packages/scene/src/useBondGpuPipeline.ts:30-34`), and 64 or 48 atoms per grid cell (`:26-28`). Overflowing atoms are dropped from the grid (`bond_compute.wgsl:100-107`).
- **Comparison with Open Babel:** its ConnectTheDots uses the same `r_i + r_j + 0.45` rule (https://github.com/openbabel/openbabel/blob/master/src/mol.cpp#L3068). It also rejects pairs closer than 0.4 Å (`#L3100`), prunes the longest bonds of atoms over their maximum valence (`#L3128`), and deletes H–H bonds when hydrogen is over valence (`#L3166`). Lupi has the 0.45 Å constant but none of the pruning.
  - Lupi's comments attribute 0.45 Å to "the Cordero pair-radius slack" (`Bonds.tsx:221-223`, `store.ts:441-444`). That attribution is **UNCONFIRMED**; the number is Open Babel's.

### 1.4 Do the CPU and GPU paths agree?

**CPU worker and GPU: same rule, slightly different output.**

- Both build the radius table from the same `getElementSpec(z).radius` (`Bonds.tsx:600-611` for the CPU, `:732-739` for the GPU) and both use the additive tolerance.
- Differences:
  - The GPU uses float32 and writes bonds in non-deterministic order through an atomic counter (`bond_compute.wgsl:146`). The CPU output is ordered by atom index. Bonds draw transparent at opacity 0.85 (`Bonds.tsx:300`), so instance order may affect blending (**UNCONFIRMED** visually).
  - The GPU silently drops atoms that land outside its grid or in an overflowing cell (`bond_compute.wgsl:96`, `:100-107`).
- **No automated test compares the GPU result to the reference detector.** `referenceBondDetect` is imported only by `packages/scene/src/__tests__/bondDetectCpu.test.ts` and `bondReference.test.ts`. `BondPipeline.test.ts:57-81` only tests construction. The comment in `bondReference.ts:4-6` says the GPU path "is diffed" against the reference; I found no such test.

**Live viewer vs core `computeBonds`: they disagree.** The cutoffs below are arithmetic from the repo's radii (code-derived). Rule E uses the repo radii too; Python's table lacks Li, Fe, Cu and Cs, so it would use 0.77 for those.

| Pair | r_i + r_j | D: core (×1.15) | A/B/C: live (+0.45) | E: Python OMol index |
|---|---|---|---|---|
| H–H | 0.62 | 0.713 | 1.070 | 0.925 |
| C–H | 1.07 | 1.230 | 1.520 | 1.488 |
| O–H | 0.97 | 1.115 | 1.420 | 1.362 |
| C–C | 1.52 | 1.748 | 1.970 | 2.050 |
| C–O | 1.42 | 1.633 | 1.870 | 1.925 |
| Li–O | 1.94 | 2.231 | 2.390 | (fallback) |
| Na–O | 2.32 | 2.668 | 2.770 | 3.050 |
| Na–C | 2.42 | 2.783 | 2.870 | 3.175 |
| K–O | 2.69 | 3.093 | 3.140 | 3.512 |
| K–C | 2.79 | 3.208 | 3.240 | 3.637 |
| Mg–O | 2.07 | 2.380 | 2.520 | 2.737 |
| Fe–N | 2.03 | 2.335 | 2.480 | (fallback) |

- Below a radius sum of 3.0 Å, the live viewer is more permissive than core. So a stretched C–H (1.3 Å) or C–C (1.8 Å) is drawn in the 3D view but is missing from the ink drawing, the ring detection and the Daily clues.
- The ink cage is handed over to the lit viewer during the relay, and the lit viewer waits for its bonds (`packages/ui/src/relay/FirstFrameSignal.tsx:10-16`). Different rules can make the bond graph change at that hand-off (code-derived).
- The comment in `elements.ts:18` says the cutoff is `r+r+tolerance`. That is true for rules A–C and F, not for D or E.

---

## 2. Bond orders, charge and spin

**Data model: pairs only.**

- `Frame.bonds` is a flat `Int32Array` of index pairs (`packages/core/src/types.ts:101`).
- `BondProperties.order?: Float32Array` exists (`types.ts:246-249`) inside the `BondData`, `BondSourceType` and `BondDivergence` types (`types.ts:241-308`). These are only re-exported (`packages/core/src/index.ts:21-25`); nothing builds or reads them.

**Parsers and loaders drop orders:**

- **PubChem JSON:** the record type declares `bonds.order` (`packages/ui/src/molecules/pubchemLoad.ts:65`), but the loader keeps only `aid1`/`aid2` (`:120-128`, `:145`).
- **MCP `lupi.generate_molecule` via PubChem SDF:** parses the atom block only (`packages/ui/src/mcpViewerBridge.tsx:2283-2304`, `:1860-1876`). Even the bond pairs are dropped, so those molecules fall back to distance inference. The UI PubChem path, by contrast, keeps PubChem's pairs as source topology.
- **LAMMPS data `Bonds` section:** keeps columns 3–4 (atom ids) and drops the bond-type column (`packages/parsers/src/lammpsDataParser.ts:299-305`, `:386-394`).
- **Glimbin binary format:** pairs only (`packages/core/src/glimbin.ts:302-308`).
- **XYZ:** never carries bonds (`packages/parsers/src/xyzParser.ts:401`).
- No SDF/MOL, PDB CONECT, mmCIF, CML or MOL2 bond readers exist (grep for CONECT, V2000, `_struct_conn`, `bondArray` and `@<TRIPOS>BOND` found nothing).

**Rendering: one cylinder per pair.**

- Each bond is one ray-cast cylinder instance with start, end, radius and two end colours (`Bonds.tsx:819-848`, `packages/scene/src/tsl/bondImpostorMaterial.ts:87-95`). There is no double, triple or aromatic geometry.
- The live ink look shades that same cylinder (`bondImpostorMaterial.ts:314-338`).
- **Static ink drawings:** the `InkModel.b` field is flat pairs (`packages/ui/src/moleculePage/ink.ts:48-49`) and each bond becomes one SVG `<line>` (`ink.ts:250-257`). The Daily art reuses this layout (`packages/ui/src/daily/art.ts:26-41`).

**UI copy states there are no orders:**

- "Connections are inferred from distance; they do not specify bond order." (`SceneModControls.tsx:283`)
- "...not source bonds, bond orders, or measured topology." (`packages/ui/src/studyFacts.ts:763`)
- The brainstorm proposal "Bond Grammar" suggests orders only when the source supplies them, and says "Never perceived silently from XYZ" (`docs/brainstorm/2026-09-viewer-play/round2/signature-and-moonshots.md:249`, `:256-258`).

**Charge and spin:**

- `Frame` has no molecular charge or spin fields (`types.ts:88-103`).
- Multiplicity appears only as a subtitle on OMol25 search hits (`packages/ui/src/molecules/remoteOmol.ts:41`, `:172-177`; worker `apps/mcp-worker/src/scienceData.ts:506`).
- The XYZ the worker serves for an OMol25 row writes formula, ids, method, `bonds=not-provided` and the license in its comment line. It omits charge and multiplicity (`scienceData.ts:461-474`).
- The XYZ parser reads only lattice, `Properties=` and step keys (`xyzParser.ts:187-210`).
- Per-atom "charge" exists only as an optional property for colouring (`MoleculeControls.tsx:388`).
- **External sources:**
  - The ColabFit configuration schema lists `multiplicity` but no charge field (https://materials.colabfit.org/docs/configuration_schema).
  - The `ameya98/OMol25-Index` HDF5 files do carry per-molecule charge and spin, according to the extract script (`tools/omol25-extract.py:12`, `:44-60`).
  - OMol25 itself has "variable charge/spin" (https://arxiv.org/abs/2505.08762).

---

## 3. How file bonds and inferred bonds are kept apart, and what users see

**Mode resolution:**

- `resolveBondTopologyMode` returns `'source' | 'infer' | 'none'` (`packages/scene/src/bondTopology.ts:4`, `:33-41`).
- Valid source pairs always win. Malformed source pairs give `none`, never inference (`bondTopology.ts:37-38`; `ViewerScene.tsx:422-431`, which logs a warning at `:448-452`).
- Inference is allowed only with Ångström distances and a complete element mapping (`packages/core/src/frameSemantics.ts:142-147`).
  - XYZ frames declare both (`packages/parsers/src/workers/frameTransfer.ts:52-55`), so every OMol25 XYZ qualifies for inference.
- GPU inference is never used when source pairs exist (`bondTopology.ts:44-52`).

**State and status fields:**

- The store's `bondSource: 'cpu' | 'gpu' | 'none'` names the backend, not the provenance (`store.ts:467-469`). Source pairs pass through the worker, which fills in distances (`packages/scene/src/bondWorker.ts:47-59`), so they report `'cpu'` (`Bonds.tsx:440`).
- MCP `status()` reports `bondTopology: 'source' | 'inferred' | 'unavailable'`, plus `bondCount` (after hidden types are removed) and `showBondsEffective` (`packages/ui/src/mcp/driver.ts:44-47`; `mcpViewerBridge.tsx:1960-1965`, `:1996-2010`).
- `set_viewer` refuses `showBonds: true` when the topology is unavailable (`mcpViewerBridge.tsx:2017-2021`).
- The render spec records `view.bonds.topology` as `'source-frame-v1'` or `'covalent-inference-v1'` (`packages/ui/src/mcp/renderArtifactAdapter.ts:336-350`).

**What users are told:**

- **Viewer:** the "Bond guides" toggle with three hint texts (`SceneModControls.tsx:281-287`) and the "Bond detection" group (`MoleculeControls.tsx:663-682`).
- **Study facts:** source / "Visual guide only" / "Not shown" / "Inference unavailable" (`studyFacts.ts:731-775`).
- **Library and gallery copy:** `packages/ui/src/library/Omol25Collection.tsx:58`, `:401`; `LibraryCard.tsx:34`; `GalleryCollection.tsx:172`; `landing/GallerySection.tsx:88`.
- **Product contract and reliability rule:** `docs/product-ownership-contract.md:58-63`; `docs/molecule-reliability-nomenclature.md:57-58`.
- **Edge:** the response header `x-lupi-bond-topology: not-provided` (`scienceData.ts:480`); the manifest field `sourceTruth.bondTopology` (`scienceData.ts:321-324`); the MCP `browse_collection` result field `sourceTruth.bondTopology` (`packages/ui/src/mcp/tools.ts:812`).
- **Debug panels:** `StateInspector.tsx:81-90`, `DevProbe.tsx:163-169`.

**In 3D, source and inferred bonds look the same.** The only behaviour that depends on the mode is the stale-bond collapse (`Bonds.tsx:996-1018`). The brainstorm notes the same gap (`signature-and-moonshots.md:247`).

**Dead bond-analysis UI:**

- `BondAnalysisModule` is mounted nowhere; only its test imports it.
- `setBondStats` is never called. The worker computes stats (`bondWorker.ts:70-72`), but `Bonds.tsx:423-449` ignores them.
- `meamScreening` is never sent to the worker (the message is built at `Bonds.tsx:616-626`).
- `bondCutoff`, `bondThresholdMode`, `filamentMode` and `grDrivenCutoff` are stored and saved in views (`packages/ui/src/savedViews.ts:91-98`, `:405-412`) but do not change rendering (`store.ts:434-438`).

---

## 4. Performance, caps, and what happens at 50–350 atoms

| Threshold or cap | Value | Citation |
|---|---|---|
| `useGpuBonds` default | `true` | `store.ts:963-966` |
| GPU forced above | 200,000 atoms; if WebGPU is unavailable there, bonds are skipped entirely | `Bonds.tsx:350-378`, `:508-521`; `bondTopology.ts:48` |
| Bonds on by default | < 300 atoms (editorial look) and < 25,000 atoms (studio look) | `store.ts:2116-2149`, applied at `:1355` |
| Bonds off by default | ≥ 25,000 atoms | `store.ts:2150-2153` |
| Studio "Bonds" preset disabled | ≥ 25,000 atoms | `MoleculeControls.tsx:208-210`, `:676-677` |
| Skip re-detection when atoms moved less than | 0.05 Å | `Bonds.tsx:75`, `:560-574` |
| Debounce | 150 ms for parameter changes, 0 ms for frame changes | `Bonds.tsx:579-581` |
| Render capacity | starts at 20,000, grows ×1.5 | `Bonds.tsx:790-816` |
| Export cap | 2,000,000 bonds, 50,000-atom chunks | `exportSceneBuilder.ts:41`, `:457` |
| Deterministic raster exports with bonds | rejected | `renderArtifactAdapter.ts:331-334` |
| Object Facts | ≤ 2,000 atoms; rings ≤ 500; symmetry ≤ 200 | `objectFacts/index.ts:10-13`, `:23`; `packages/ui/src/camera/objectFactsForFile.ts:14` |
| First-frame wait for bonds | 10 frames / 600 ms; 1,500 ms under the relay ("bonds can take seconds" on SwiftShader) | `FirstFrameSignal.tsx:49-57` |
| OMol25 edge row limit | 1,000 atoms | `scienceData.ts:17`, `:443-445` |

**OMol25 sizes:**

- Up to 350 atoms (https://arxiv.org/abs/2505.08762).
- Neutral validation: 1,238,644 atoms in 27,697 configurations, so a mean of about 44.7 atoms (computed from https://huggingface.co/datasets/colabfit/OMol25_neutral_validation). Most OMol25 molecules therefore open in the "< 300 atoms, bonds on" default.

**What a 50–350-atom molecule triggers (code-derived):**

- **WebGPU browser:** `wantGpu` is true (`Bonds.tsx:362-367`), so `initWebGPU` gets a second GPU adapter and device just for bonds. It asks for 512 MB buffer limits and has a 5 s timeout (`packages/renderer/src/pipeline/AtomPipeline.ts:359`, `:390-449`).
  - The first allocation is sized for 100,000 atoms and 1.2 million bonds (`useBondGpuPipeline.ts:9-10`): about 19.2 MB of bond buffer, plus 3 × 19.2 MB of staging buffers, plus about 8.4 MB of grid cells (32³ × 64 × 4 bytes), plus 1.6 MB of positions. That is roughly 87 MB in total (from `BondPipeline.ts:137-193` and `useBondGpuPipeline.ts:21-38`).
  - Every readback copies the full 19.2 MB buffer, whatever the bond count (`BondPipeline.ts:392`).
  - The GPU path never computes stats.
- **Without WebGPU:** the CPU worker runs an O(N) string-keyed hash (`bondDetectCpu.ts:44-58`). At a few hundred atoms this should cost almost nothing (**UNCONFIRMED**, not measured).
- **Conclusion:** at OMol25 sizes the GPU path is overhead with no benefit. A CPU method that is far more expensive per pair would still be cheap enough.

---

## 5. Where a better bond module would plug in

**Recommended seam: one pure, synchronous CPU function in `packages/core`.** For example, `perceiveBonds(z, xyz, n, opts) → { pairs, orders?, flags, provenance, params }`. It would replace both `computeBonds` (`objectFacts/bonds.ts:106-139`) and `detectBondsCpu` for frames below an atom threshold, for example ≤ 2,000–5,000 atoms. The GPU and the plain distance rule would stay for large materials and MD frames.

- This is the least disruptive option because the worker and the export already share `detectBondsCpu`, and the scripts already share `computeBonds`.
- A synchronous CPU result would also remove the reason raster bonds fail closed (`renderArtifactAdapter.ts:333`): the bond result is currently asynchronous and cannot be addressed by a snapshot.
- **Do not write perceived bonds into `Frame.bonds`.** `resolveBondTopologyMode` would then label them `source` (`bondTopology.ts:37-38`). A separate field or sidecar with its own provenance is needed, for example `'perceived-v1'`.

**Everything that must agree:**

1. **Live rendering**
   - Worker dispatch (`Bonds.tsx:486-652`) and worker body (`bondWorker.ts:47-62`).
   - GPU dispatch: route small frames to the CPU through `shouldUseGpuBondInference` (`bondTopology.ts:44-52`).
   - The stale-bond check (`Bonds.tsx:1003-1018`).
   - `bondRenderPlan` and `maxCovalentRadiusForFrame` (`ViewerScene.tsx:108-128`, `:412-446`).
   - Hidden-type filtering (`Bonds.tsx:115-148`).
2. **Picking and measurements:** neither uses bonds. `AtomPicker.tsx` has no bond references. `MeasurementLayer.tsx:132-213` uses knowledge-graph `nodeLabel.neighbors` (`store.ts:75`), not bonds. No change is required. A "bonded neighbours" feature would be new.
3. **Ink**
   - The live ink look draws whatever list it is given (`bondImpostorMaterial.ts:314-338`).
   - Static ink, molecule pages and Daily come from `catalog.mts:331`, `:347` (unknown symbols become carbon there) and `clues.mts:138`, via `ink.ts` and `daily/art.ts`.
   - Order strokes would need new geometry in `ink.ts:247-257`.
4. **Molecule pages and the relay:** the ink-cage-to-lit hand-off needs identical topology (`FirstFrameSignal.tsx:10-16`).
5. **Exports**
   - `detectExportBonds` (`exportSceneBuilder.ts:451-566`, `:766-800`) and `ExportManager.tsx:788-845`.
   - Spec identity: bump `'covalent-inference-v1'` (`renderArtifactAdapter.ts:337`) and the validator (`packages/core/src/renderArtifact.ts:1003-1034`).
   - **Latent mismatch (code-derived, not run):** the adapter writes `topology` and `sourceBondCount` into `view.bonds` (`renderArtifactAdapter.ts:336-338`). The validator's exact-key list for model formats is only the shared keys (`renderArtifact.ts:1004-1013`), and `requireExactKeys` throws on any unknown key (`renderArtifact.ts:1346-1356`). The adapter calls `validateRenderRequestV1` (`renderArtifactAdapter.ts:417-421`), which runs this check. So an MCP GLB or USDZ export with `showBonds` should be rejected with "contains unsupported field sourceBondCount". No test covers this case: the adapter tests set `showBonds: false` (`renderArtifactAdapter.test.ts:82`, `:119`).
6. **Display motion**
   - The offset is a closed form keyed on raw position bits. Bonds stay attached only because each bond end is a bit-exact copy of its atom's position (`packages/scene/src/tsl/displayMotion.ts:6-12`; `bondImpostorMaterial.ts:194-200`).
   - Any pair list works. But offset multi-line orders must be computed in the shader after the offset is applied, or this invariant breaks.
   - Strain thinning compares against the rest length (`bondImpostorMaterial.ts:203-210`). Tug is a distance Gaussian, not graph-based (`displayMotion.ts:374-385`).
7. **Contact-occlusion stubs:** they use one global reach (`atomImpostorMaterial.ts:441-448`; `ViewerScene.tsx:680-681`). They should use the real bond list or per-pair cutoffs.
8. **MCP**
   - Status counts and the topology enum (`mcpViewerBridge.tsx:1960-2010`; `driver.ts:44-47`).
   - `bondTolerance` meaning (`mcpViewerBridge.tsx:2048-2050`; `packages/ui/src/mcp/schemas.ts:100-112`).
   - `browse_collection` `sourceTruth` (`tools.ts:812`).
   - Regenerate the manifest and update the `AGENTS.md` status example.
9. **Store, URLs and saved views:** `bt` (`store.ts:1177`, `:1266`); `savedViews.ts:91-98`, `:405-412`.
10. **Provenance copy:** `studyFacts.ts:731-775`, `SceneModControls.tsx:282-284`, `MoleculeControls.tsx:664-669`, and the Library/OMol25 copy.
11. **Object Facts:** rings, symmetry detents and the camera "face-on" labels (`objectFacts/index.ts:37-46`; `objectFacts/symmetry.ts:100-121` uses bond midpoints).
12. **OMol25 search tags:** the Python screen (`tools/omol25-structures.py:119-145`) should be regenerated from the same TypeScript module so search tags match what the viewer draws.
13. **Mobile AR:** `ar-scene.ts:219-236`.

---

## 6. Known weaknesses (code-derived from the rules above)

- **Metals and ions:** no ionic or coordination class and no valence cap. With +0.45 Å:
  - Na–C (≤ 2.87 Å) and K–C (≤ 3.24 Å) contacts become bonds, for example a cation sitting on an aromatic ring.
  - Na–Cl (≤ 3.13 Å) ion pairs become bonds.
  - Every O near Li, Na, K, Mg or Ca becomes a bond.
  - This matters for OMol25's electrolyte and metal-complex subsets (arXiv abstract).
  - Fe, Mn and Co use a single radius (1.32, 1.39, 1.26). Whether that is Cordero's low-spin value, and so too short for high-spin complexes, is **UNCONFIRMED**.
- **Hydrogen bonds:** never drawn; there is no hydrogen-bond layer. Normal O–H···O contacts (~1.8 Å) fall outside the O–H cutoff of 1.42 Å. But hydrogen has no one-bond cap, so short, strong or proton-transfer geometries can give one H two "covalent" bonds. An H–H pair is bonded below 1.07 Å live and 0.71 Å in core.
- **Long or stretched bonds:** OMol25 includes reactive structures. Any bond longer than `r+r+0.45` vanishes. The only remedy is a global slider that loosens every pair at once. Core's ×1.15 rule drops stretched bonds sooner than the viewer does.
- **Hypervalent atoms:** nothing under-bonds them, since there are no valence rules. Nothing prunes over-bonding either, unlike Open Babel (`mol.cpp#L3128`).
- **Charged species:** charge is absent from the frame, the OMol25 XYZ, and the ColabFit schema. Bond-order perception needs the total charge.
  - RDKit's `DetermineBondOrders` and `DetermineBonds` take `charge` (default 0) and `allowChargedFragments` (https://github.com/rdkit/rdkit/blob/master/Code/GraphMol/DetermineBonds/DetermineBonds.h#L36-L112).
  - Its default connectivity uses ConnectTheDots with H–H contact removal, with optional covalent-radius ×1.3 or Hückel modes (https://github.com/rdkit/rdkit/blob/master/Code/GraphMol/DetermineBonds/DetermineBonds.cpp#L199-L242).
  - xyz2mol (Kim & Kim 2015, https://github.com/jensengroup/xyz2mol) also takes the charge as input.
  - The neutral lanes are neutral by definition (`scienceData.ts:40-61`), so charge = 0 is known there. The "all train" and validation preview lanes include charged molecules (`scienceData.ts:63-94`) and would need charge from another source, such as the OMol25-Index HDF5 (`tools/omol25-extract.py:44-60`).
  - Open-shell rows (multiplicity ≠ 1, available per row at `scienceData.ts:506`) should not get closed-shell bond orders.
  - Whether RDKit's WASM build exposes `DetermineBonds` in the browser is **UNCONFIRMED**.