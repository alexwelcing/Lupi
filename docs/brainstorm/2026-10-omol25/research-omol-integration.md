# OMol25 in Lupi: end-to-end map (as of 2026-10-03)

Scope: this was read-only. I made a few live calls to the Hugging Face (HF) Dataset Viewer and to `lupi.live` to check behaviour. Facts about the repo are cited as `path:line`, and facts from outside it are cited by URL. Anything I couldn't confirm is marked **UNCONFIRMED**.

## Summary

- **Five collections exist, but only the two neutral splits are complete.** Those two hold 17 elements and no metals beyond Li, Na, K, Mg and Ca. Transition metals, lanthanides, and charged or open-shell systems appear only in three "indexed preview" windows.
- **Lupi keeps about ten scalar fields per row.** It never passes on charge, spin, the domain label (`data_id`), the source path (which sometimes carries a ChEMBL id and a name), the HOMO-LUMO gap, per-atom partial charges or forces. All of these are in the upstream rows.
- **The `multiplicity` value Lupi shows is not the spin multiplicity.** In every row I sampled it was 1. A Pr complex with `property_metadata.spin = 3` came through as `multiplicity: 1`.
- **Bonds today come from one rule.** The viewer infers them by distance, `d ≤ r_cov(A) + r_cov(B) + 0.45 Å` with Cordero radii, and turns them on by default for anything under 25,000 atoms. Every surface labels them as a "viewer guide". The offline functional-group screen uses a different rule, `1.25·(rA+rB)+0.15`.
- **The home page never names OMol25.** You reach it through the header "Library" link and then a second click, or through the finder's "browse the library" links.
- **Live search through the edge did not work when I tested.** A formula filter returned "warming" (202) after 25–33 s on both neutral splits. Text search on neutral-train returned 502 after 125 s. The browser gives up after 20 s.

---

## 1. Collections, row counts, and which fields Lupi keeps

### 1.1 Collections

The edge defines five collections (`apps/mcp-worker/src/scienceData.ts:39-95`). The UI repeats them as a fallback list (`packages/ui/src/molecules/remoteOmol.ts:78-129`), and the docs list them too (`docs/external-science-data.md:18-24`).

| Lupi id | Upstream repo | Lupi `indexedRows` | Lupi `estimatedRows` | ColabFit card count | Lupi coverage label |
|---|---|---:|---:|---:|---|
| `neutral-train` | `colabfit/OMol25_train_neutral` | 34,335,828 | 34,335,828 | 34,335,828 | complete |
| `neutral-validation` | `colabfit/OMol25_neutral_validation` | 27,697 | 27,697 | 27,697 | complete |
| `all-train-preview` | `colabfit/OMol25_train` | 841,736 | 65,331,709 | **101,666,280** | indexed-preview |
| `train-4m-preview` | `colabfit/OMol25_train_4M` | 1,000,000 | 2,657,915 | **3,986,754** | indexed-preview |
| `validation-preview` | `colabfit/OMol25_validation` | 800,000 | 1,842,258 | **2,762,021** | indexed-preview |

- Lupi's `estimatedRows` values are the HF Dataset Viewer's `estimated_num_rows`, for example https://datasets-server.huggingface.co/size?dataset=colabfit/OMol25_train. They understate the ColabFit dataset cards:
  - https://huggingface.co/datasets/colabfit/OMol25_train/raw/main/README.md
  - https://huggingface.co/datasets/colabfit/OMol25_train_4M/raw/main/README.md
  - https://huggingface.co/datasets/colabfit/OMol25_validation/raw/main/README.md
- The UI shows the understated number to users: "N rows queryable of {estimatedRows}" (`packages/ui/src/library/Omol25Collection.tsx:218-225`).
- The paper describes more than 100M DFT calculations, about 83M unique systems, 83 elements and up to 350 atoms (https://arxiv.org/abs/2505.08762). A code comment cites "~83M-system source corpus" (`scienceData.ts:32-38`).
- The official `facebook/OMol25` repo is gated, and its DATASET.md returned 401 (https://huggingface.co/facebook/OMol25/blob/main/DATASET.md). Lupi uses only the ColabFit conversions (`scienceData.ts:310-329`).

### 1.2 Fields Lupi receives and keeps

There are three lanes.

**A. Edge page rows** (`/v1/datasets/omol25/:id/rows`). These go through `compactOmolRow` (`scienceData.ts:484-516`; type at `scienceData.ts:99-117` and `remoteOmol.ts:32-50`). The fields kept are:
- `rowIndex`
- `configurationId`, `propertyId` (and `id`)
- `formula`, which is `chemical_formula_hill`, falling back to reduced
- `reducedFormula`
- `elements`
- `atomCount`, which is `nsites` or `positions.length`
- `multiplicity`
- `method`, `software`
- `energy`
- `maxForceNorm`
- `name`, which is `names[0]`, for example `"OMol25_validation_data0070_28819"`. That is a ColabFit id, not a chemical name.
- `loadUrl`
- constant `coordinateProvenance: 'source'` and `bondTopology: 'not-provided'`

The test confirms positions and atomic numbers are stripped (`scienceData.test.ts:115-126`).

**B. The UI card** (`remoteOmolHit`, `remoteOmol.ts:170-183`) keeps less again:
- title and formula, elements, and a subtitle of `"{n} atoms · {method}"`
- `" · multiplicity N"` only when N ≠ 1 (`remoteOmol.ts:172`)
- tags: `omol25`, the config and property ids, and software

`energy`, `maxForceNorm`, `name` and `reducedFormula` are dropped here. There is also no `provenance` and no `notice`, even though `MoleculeHit` supports both (`types.ts:58-71`). The MCP output drops the same fields (`packages/ui/src/mcp/tools.ts:813-822`).

**C. Faceted validation index** (`apps/web/public/datasets/omol25/neutral-validation.v4.json`):
- Each record is `[formula, atomCount, functionalGroupMask?]`. Fields are declared at `tools/build-omol25-validation-index.mjs:124` and built at `:79-85`.
- I inspected it with `node -e`. It has 27,697 records, 20 functional groups, and 508 records with no mask.
- Parsed records hard-code `gap: null` and `src: 'colabfit/OMol25_neutral_validation'` (`packages/ui/src/molecules/providers/omol.ts:74`). There is no energy, charge, spin or id beyond the row index `nval-i`.

### 1.3 Available upstream but dropped

From the 42-column schema (https://huggingface.co/datasets/colabfit/OMol25_neutral_validation) and the live rows I sampled (https://datasets-server.huggingface.co/rows?dataset=colabfit/OMol25_validation&config=default&split=train&offset=0&length=3):

- **`atomic_forces`** (per atom), and **`mean_force_norm`**. Lupi computes on neither.
- **`property_metadata`**, a JSON string. It is present in validation, neutral-validation and train, and **absent from neutral-train**, which has 40 columns and no `property_metadata`. Its keys are:
  - `charge`, `spin`
  - `data_id`, the domain. I saw `biomolecules`, `elytes`, `metal_complexes`, `ani2x`, `spice`, `geom_orca6`, `reactivity`, `trans1x`, `rgd` and `orbnet_denali`.
  - `source`, a path that sometimes holds a ChEMBL id and a name, for example `…CHEMBL380061_Choline…`
  - `homo_energy`, `homo_lumo_gap`
  - `mulliken_charges`, `lowdin_charges`, `nbo_charges` (per atom)
  - `s_squared`, `s_squared_dev`, `unrestricted`
  - `num_electrons`, `n_basis`, `n_scf_steps`, `nl_energy`
  - `basis_set`, `integrated_densities`, `warnings`
- `structure_hash`, `configuration_hash`, `chemical_formula_anonymous`, `elements_ratios`, `nelements`.
- `electronic_band_gap` is null in the rows I sampled. The HOMO-LUMO gap lives in `property_metadata.homo_lumo_gap` (7.28 eV in validation row 0).
  - So the code comment "no per-record HOMO-LUMO gap (all null)" (`providers/omol.ts:151-153`, `omolCollection.test.ts:5-7`) describes how the column was read, not the dataset. The v3 builder reads `electronic_band_gap` (`tools/omol25-structures.py:380, 397`).
- The older HDF5 index (`ameya98/OMol25-Index`) carried `charges`, `spins`, `homo_lumo_gaps` and `data_ids` (`tools/omol25-extract.py:43-46, 52-63`). The v3 and v4 indexes dropped them.
- **No SMILES, InChI, bond list or bond-order field** appears in any ColabFit column or `property_metadata` key I inspected. Whether the official gated OMol25 release contains bond orders (for example Mayer or Wiberg) is **UNCONFIRMED**.
- **`multiplicity` is not spin.** It was 1 for a Pr complex with `spin=3` and for an Ir complex with `spin=2`. I checked this through the live edge (https://lupi.live/v1/datasets/omol25/validation-preview/rows?offset=0&limit=3) and upstream. What ColabFit's `multiplicity` actually means (I suspect a duplicate count) is **UNCONFIRMED**.
- **Energy units are not labelled anywhere in Lupi.** ColabFit values are in eV: -74676.37 for the 68-atom row 0, which is plausible. The ColabFit unit convention itself is **UNCONFIRMED** from a card.

---

## 2. Load path from a row to the viewer

### 2.1 URL shapes

Edge routes (`scienceData.ts:120-148`, `docs/external-science-data.md:49-64`):
- **Manifest:** `GET /v1/datasets/omol25`
- **Rows:** `GET /v1/datasets/omol25/{id}/rows?offset&limit≤36[&query=|&formula=]`
  - Without a query or formula, the edge proxies upstream `/rows`. With `query` it uses `/search`, with `formula` it uses `/filter` with `"chemical_formula_hill"='…'` (`:365-372`).
  - There is no upstream timeout (`:374-376`).
- **Structure:** `GET /v1/datasets/omol25/{id}/structures/{row}.xyz`
  - Makes one upstream `/rows?length=1` call (`:412-422`).
  - Accepts `atomic_numbers` either as a JSON string (neutral-train) or as an array (`:433-435`).
  - Rejects rows with 0 or more than 1,000 atoms (`:17, 443-445`).

In the viewer, a structure opens as `?load=/v1/datasets/omol25/{id}/structures/{i}.xyz` (`packages/ui/src/viewer/openMolecule.ts:23-25`). The remote-URL policy trusts that path pattern for all five collection ids (`packages/ui/src/remoteMoleculeUrlPolicy.ts:27-33, 146-149`).

### 2.2 The XYZ comment line

Built at `scienceData.ts:459-473`. I checked the live output:

`OMol25 neutral-train row=5 | formula=C5H7NO | configuration_id=CO_… | property_id=PO_… | method=ωB97M-V | coordinates=source | bonds=not-provided | license=CC-BY-4.0 | source=colabfit/OMol25_train_neutral`

- Response headers are `x-lupi-coordinate-provenance: source` and `x-lupi-bond-topology: not-provided` (`:479-480`).
- **The comment has no charge, spin, energy, domain or forces.**

### 2.3 What reaches the store

1. A library card click goes through `openLibraryHit`, then `loadMoleculeHit` (`library/openHit.ts:60-63`), then `openMolecule({kind:'url', title: hit.title})` (`molecules/load.ts:15-21`).
2. `loadMoleculeSource`: the `.xyz` extension marks it as legacy, so no Range probe (`packages/parsers/src/StreamingLoader.ts:547-567`). The file is fetched and parsed (`packages/ui/src/loadMoleculeSource.ts:151, 214-230, 262-277`).
3. The XYZ parser reads only `Lattice=`, `Properties=` and `step/timestep/frame` from the comment and ignores every other key (`packages/parsers/src/xyzParser.ts:194-224`). `bonds` is always set to `new Int32Array(0)` (`xyzParser.ts:401`).
4. The frame metadata is fixed: `typeSemantics: atomic-number` and `distanceSemantics: angstrom (format-convention)` (`packages/parsers/src/workers/frameTransfer.ts:47-57`).
5. What the store keeps: `file.name`, overwritten with the card title (`openMolecule.ts:85-88`); `sourceUrl`; and positions and types. **No OMol25 scalar metadata reaches the store.**
   - The title differs by entry point: a plain formula from Library cards, but `"{formula} (OMol25)"` from random (`randomOmol.ts:40`) and from the switcher (`switcher/switchIndex.ts:114`).
6. The Learn panel labels the source "Meta OMol25" because the URL contains "omol" (`packages/ui/src/studyFacts.ts:798`).

### 2.4 How bonds are decided today

- **Mode.** Topology mode is `source` if `frame.bonds` is non-empty, else `infer` if `canInferCovalentBonds` is true, else `none` (`packages/scene/src/bondTopology.ts:33-41`). `canInferCovalentBonds` requires Ångström units and a complete element mapping (`packages/core/src/frameSemantics.ts:143-147`). OMol25 XYZ satisfies both, so the mode is **infer**.
- **Default visibility.** `showBonds` is true for fewer than 25,000 atoms when inference is possible (`packages/ui/src/store.ts:1298-1303, 1355, 2116-2137`). OMol25 rows therefore open with bonds on.
  - At 300 atoms and above, `showCell` also turns on (`store.ts:2133-2137`). For a non-periodic molecule that draws a padded bounding box. This affects preview rows of 300 to 350 atoms.
- **The rule.** The CPU worker accepts a pair when `d ≤ r_cov(A) + r_cov(B) + tolerance` (`packages/scene/src/bondDetectCpu.ts:97, 123-129`).
  - Radii are Cordero single-bond covalent radii from `getElementSpec(Z).radius` (`packages/scene/src/Bonds.tsx:600-611`; `packages/core/src/elements.ts:17-21`).
  - Tolerance defaults to 0.45 Å (`store.ts:955`) and has a slider from 0 to 1.2 (`packages/ui/src/SceneModControls.tsx:286`).
  - The spatial-hash cutoff is `min(6, 2·maxR + tol + 0.5)` (`packages/ui/src/app/ViewerScene.tsx:412-446`).
  - The rule ignores charge, spin, bond order, ionic or dative contacts, and hydrogen bonds. Because K is 2.03 Å (`elements.ts:92`) and Na is 1.66 Å (`elements.ts:76`), K/Na–O ionic contacts up to about 3.14 Å and 2.77 Å are drawn as bonds.
- **Reported values.** `bondSource` is `'cpu' | 'gpu' | 'none'` (`store.ts:469`). The MCP state reports `bondTopology: 'inferred'` (`packages/ui/src/mcpViewerBridge.tsx:1962-1965, 2004-2010`).
- **What the UI says.** Every surface labels the bonds as a guide rather than data:
  - Library cards: "Source DFT coordinates. OMol25 supplies no bonds; any bond lines are a viewer guide." (`packages/ui/src/library/LibraryCard.tsx:21-22`)
  - OMol25 masthead: same message (`Omol25Collection.tsx:58-59`)
  - Structure guides: "Connections are inferred from distance; they do not specify bond order." (`SceneModControls.tsx:281-284`)
  - Studio bond detection copy (`packages/ui/src/studio/MoleculeControls.tsx:664-669`)
  - Bond analysis panel: "inferred proximity links" (`packages/ui/src/panels/analysis_modules/BondAnalysisModule.tsx:45`)
  - Learn panel: "Visual guide only … not source bonds, bond orders, or measured topology" (`studyFacts.ts:760-767`)
  - MCP: `sourceTruth: { bondTopology: 'not-provided' }` (`mcp/tools.ts:812`)
- **A second, different rule exists offline.** The functional-group screen behind the facets uses `1.25·(rA+rB)+0.15` with its own radius table and a 0.77 Å fallback (`tools/omol25-structures.py:84-116`). Its spatial-hash comment ("largest … cutoff below 2.6 Å") is wrong for K, Na and Ca (`:124-126`).

---

## 3. Entry points and how discoverable each is from the home page

| Entry point | Where | Clicks from `/` |
|---|---|---|
| Header "Library" → `/library` (all sources) | `landing/SiteHeader.tsx:19-21` | 1 to the library, 2 to the OMol25 tab |
| Library nav "OMol25 · 34.3M structures" → `/library/omol25` | `library/LibraryPage.tsx:24, 66-70` | 2 |
| `/library/omol25`: "Remote collections 34.3M+" (four chips; neutral-validation is excluded, `Omol25Collection.tsx:26`) and "Filter by element 27.7K" (`?view=facets`) | `Omol25Collection.tsx:67-76, 185-200` | 2–3 |
| Random page button (remote) | `Omol25Collection.tsx:163-167, 213-215` | 3 |
| "Surprise me" → `/library/random`, a random **validation** row | `LibraryPage.tsx:71-73`; `RandomStructure.tsx:32`; `molecules/randomOmol.ts:16-40` | 2. The design promised a header link (`docs/library-restoration-design.md:151`), but it is not in `SiteHeader.tsx`. |
| Finder: "browse the library" link and "Search the full library for X" | `landing/MoleculeFinder.tsx:270-273, 316-319` | 1, but it lands on all sources, not OMol25 |
| Federated "All sources" search, provider `omol` | `library/LibraryBrowser.tsx:17-25`; `providers/omol.ts:269-298` (no filters means a neutral-train page or search; with element or group filters it falls back to the validation index) | 1–2 |
| In-viewer Switch panel: OMol25 candidates appear only for formula-shaped text or element picks, from the validation index, at most 16 | `switcher/switchIndex.ts:51, 103-117, 173-191`; `ViewerPanelBody.tsx:64` | not on `/` |
| Legacy redirects: `/materials/omol25*` and `/?tab=omol25` → `/library/omol25` | `viewer/viewerRoutes.ts:123-136`; `apps/web/src/main.tsx:39, 220-221` | n/a |
| SEO: sitemap entry and `libraryOmol25` metadata | `apps/web/public/sitemap.xml:7`; `packages/ui/src/seo-routes.json:153-164` | n/a |
| MCP `lupi.browse_collection`, plus `lupi.search_molecules` with `sources:['omol']` | `mcp/tools.ts:777-829, 850`; `mcp/schemas.ts:83-95` (the `sources` field is an untyped string array, `schemas.ts:67`); `AGENTS.md:356` | agents only |
| Deep link `?load=/v1/datasets/omol25/...xyz` | `remoteMoleculeUrlPolicy.ts:146-149` | n/a |

- The home page (hero, wall, finder results, student gallery) **never mentions OMol25**. The student gallery test asserts that OMol25 text is absent (`landing/GallerySection.test.tsx:11`).
- The search ranking puts `omol` at priority 6 of 8, just above PubChem (`molecules/search.ts:13-22`).
- Facet filtering and sorting drop OMol25 hits, which have no library facts (`molecules/organizeHits.ts:10-12`). `library-facts.json` has 103 entries and none are OMol25.

---

## 4. Size limits, elements, charge and spin

### Atom counts in the neutral-validation index

From the index, computed with `node -e`:

| Statistic | Value |
|---|---|
| Rows | 27,697 |
| min / p10 / p25 / median | 2 / 19 / 28 / 46 |
| p75 / p90 / p99 / max | 59 / 67 / 102 / 110 |
| Mean | 44.7 |
| Distinct formulas | 7,453 (many conformers) |
| Formula sum ≠ atom count | 0 |

The facets file matches: min 2, max 110, median 46 (`neutral-validation.v4.facets.json`). By bins:

| Atoms | 1–10 | 11–20 | 21–30 | 31–40 | 41–50 | 51–60 | 61–70 | 71–80 | 81–90 | 91–100 | 101–110 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Rows | 559 | 2,719 | 4,517 | 4,048 | 4,002 | 5,511 | 4,983 | 627 | 173 | 238 | 320 |

### Mean atoms per configuration in other splits

Computed from the ColabFit card totals (atoms ÷ configurations):

| Split | Mean atoms |
|---|---|
| neutral-train | 27.07 |
| train | 51.5 |
| 4M | 54.9 |
| validation | 102.6 |

The full distributions for these splits are **UNCONFIRMED**; the repo has no index for them.

### Limits

| Limit | Value | Where |
|---|---|---|
| Edge atom cap | 1,000 | `scienceData.ts:17` |
| Paper's maximum system size | 350 atoms | https://arxiv.org/abs/2505.08762 |
| Rows per page | 36 | `scienceData.ts:16` |
| Faceted results per view | 36 | `Omol25Collection.tsx:22` |
| Browser fetch timeout | 20 s | `remoteOmol.ts:187` |

### Elements

- Both neutral splits have the same **17 elements**: H, C, O, N, S, F, Cl, Br, P, I, Si, B, K, Li, Na, Ca, Mg. Sources: the facets file, the neutral-train card (https://huggingface.co/datasets/colabfit/OMol25_train_neutral/raw/main/README.md), and the hard-coded list in the test (`omolCollection.test.ts:94-95`).
- There are **no transition metals and no lanthanides** in either complete lane. 1,684 validation rows contain Li, Na, K, Mg or Ca, typically salt complexes.
- `OMol25_train` and `OMol25_validation` (and the 4M split) list **83 elements** each on their cards, including lanthanides (Ce, Pr, Nd, Pm, Sm, Eu, Gd, Tb, Dy, Ho, Er, Tm, Yb, Lu, La), Tc, and transition metals. In Lupi those are reachable only through the indexed preview windows.
- Lupi's element table covers Z 1–118 (`elements.ts`), so rendering is not a blocker.

### Charged and open-shell share

- The neutral lanes are charge 0 by definition. Whether they are all singlets is **UNCONFIRMED**; the sampled neutral-validation row had `spin: 1`.
- In 12 sampled `OMol25_train` rows, 3 were charged and 0 open-shell. In 9 sampled `OMol25_validation` rows, 8 were charged and 3 open-shell (spin 2 or 3). That is anecdotal; the real shares are **UNCONFIRMED**.
- Lupi cannot compute these shares or display them: the index has no charge or spin fields, and `multiplicity` is not spin (see 1.3).

---

## 5. Gaps, bugs and awkwardness

1. **Wrong spin label.** `multiplicity` comes from the ColabFit column, which does not match `property_metadata.spin` (Pr complex: spin 3, multiplicity 1). The card's "· multiplicity N" (`remoteOmol.ts:172`) effectively never fires and would be misleading if it did.
2. **Charge, spin and domain never reach the user or the viewer.** They aren't in rows (`scienceData.ts:497-515`), in the XYZ comment (`:463-473`), or in the index (`build-omol25-validation-index.mjs:124`). For neutral-train they don't exist upstream at all (no `property_metadata` column).
3. **Rich per-atom data is thrown away.** NBO, Mulliken and Löwdin charges and forces are dropped. Yet the XYZ parser already supports extended-XYZ `Properties=` columns, including forces as fx/fy/fz (`xyzParser.ts:19-24, 128-185`). So these could reach the existing property colouring with no parser change.
4. **Live search is effectively broken.** Formula filters returned "warming" (202) after 25–33 s on both neutral-train and neutral-validation, and `query=caffeine` returned 502 after 125 s (live calls, 2026-10-03). Consequences:
   - The browser aborts at 20 s (`remoteOmol.ts:187`) and shows the raw abort message, not the warming copy (`Omol25Collection.tsx:137-143`).
   - The edge has no upstream timeout (`scienceData.ts:374, 420`).
   - `searchMolecules` waits on `Promise.all` (`search.ts:80`), so one slow OMol25 call holds every "All sources" result for up to 20 s.
   - Text queries go to HF full-text search over ColabFit id and name strings, so chemical names such as "caffeine" match nothing meaningful (`providers/omol.ts:280-288`).
5. **Row counts are understated.** The preview "of N" totals use HF's estimates (65.3M, 2.66M, 1.84M) instead of the ColabFit counts (101.7M, 3.99M, 2.76M) (`scienceData.ts:69, 80, 91`; `Omol25Collection.tsx:220`).
6. **The collection list is duplicated in five places:** `scienceData.ts:39-95`, `remoteOmol.ts:4-9` and `:78-129`, `mcp/schemas.ts:88`, and `remoteMoleculeUrlPolicy.ts:27-33`. None of them come from `packages/core`; `scienceDataCatalog.ts` holds only the Zenodo catalog.
7. **Two inconsistent bond rules.** The viewer uses `rA+rB+0.45`; the functional-group screen uses `1.25(rA+rB)+0.15` with a different radius table (`omol25-structures.py:84-116`). The screen's 2.6 Å hash cell can miss alkali contacts between 2.6 and 3.5 Å (`:124-126`). The facet tags can therefore come from a bond graph the viewer never draws.
8. **No OMol25-aware bond handling.** Ionic alkali contacts are drawn as covalent sticks, and metal–ligand and lanthanide coordination in the preview lanes falls under the same single-bond Cordero rule (Fe 1.32 Å is the low-spin value, `elements.ts:106`). There is no bond order, no charge or spin input, and no per-dataset tolerance.
9. **Cell box on large molecules.** For 300+ atom rows, `showCell` turns on and draws a padded bounding box around a non-periodic molecule (`store.ts:2133-2137`).
10. **Weak discoverability.**
    - The home page never names OMol25.
    - "Surprise me" was promised in the header but is only in the Library nav (`library-restoration-design.md:151` versus `SiteHeader.tsx:16-27`).
    - Random opens only the 27.7K validation slice (`randomOmol.ts:28-31`), not the 34.3M-row neutral-train lane.
    - The faceted view's functional-group filter is local state and not in the URL, so shared links lose it (`Omol25Collection.tsx:268`).
11. **No caching of edge responses.** `Cache-Control` headers are set (`scienceData.ts:408, 475`), but neither `scienceData.ts` nor the Worker's `index.ts` uses the Cache API. Each XYZ pulls a full upstream row, forces and `property_metadata` included, about 2.5 s live. Whether Cloudflare caches Worker responses without the Cache API is **UNCONFIRMED**.
12. **HF truncated cells are not checked.** The edge ignores `truncated_cells` (`scienceData.ts:426-445`); a truncated `positions` cell would surface as a 502 "inconsistent coordinate data". That large rows actually get truncated is **UNCONFIRMED**.
13. **Doc drift.**
    - The design doc says the index is "4 MB" (`docs/library-restoration-design.md:90, 173`); it is 698 KB (`neutral-validation.v4.receipt.json`).
    - It refers to an `Omol25RemoteBrowser.tsx` (`:131`) that doesn't exist; the code is inside `Omol25Collection.tsx`.
    - The type comment still calls `omol` "(scaffolded)" (`molecules/types.ts:17`).
    - AGENTS.md's endpoint list has no `/v1/datasets/*` entry.
    - The `sources` enum for `search_molecules` is still undocumented (design asked for it at `library-restoration-design.md:159-160`).
14. **Facets and agent tools ignore OMol25.** `organizeHits` drops OMol25 hits under any facet filter and sorts them last (`organizeHits.ts:10-12`). OMol25 enrichment is listed only as future work (`docs/library-facts.md:168-172`).
15. **The faceted index depends on an external bucket at build time.** Rebuilding it fetches the v3 source from GCS by default (`build-omol25-validation-index.mjs:35`). There is no runtime dependency (verified on 24 rows, receipt `allMatched: true`), but a rebuild of v3 needs `tools/omol25-structures.py` and the 72 MB parquet.

## Implications for a bond strategy (facts only)

- Every upstream lane provides Z and coordinates in Å. Validation, train and 4M also provide `charge`, `spin`, `data_id` and per-atom NBO, Mulliken and Löwdin charges. Neutral-train provides only Z, coordinates, energy and forces.
- No bond or bond-order field exists in the ColabFit rows I inspected. Official-release bond data is **UNCONFIRMED**.
- The viewer's existing infer path, its "viewer guide" labelling, and the extended-XYZ `Properties=` support are the integration points. An edge-computed bond list would need a new XYZ or extended-XYZ field: today the parser always sets `bonds` to empty (`xyzParser.ts:401`), while the scene already treats non-empty `frame.bonds` as `source` (`bondTopology.ts:37-38`). Any computed topology would therefore need its own label so that it doesn't show up as "source bonds" (`studyFacts.ts:733-737`).