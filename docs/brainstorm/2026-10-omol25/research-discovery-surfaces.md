# OMol25 discoverability in Lupi: where it appears today, what the owner has already decided, and where it could go

**Scope.** This is a read-only map of every discovery surface in the repo at HEAD `c89bc5e`. Lines are cited as `path:line`; anything I could not confirm is marked **UNCONFIRMED**.

**Headline.** OMol25 is a full first-class source in exactly one place: the Library route (`/library/omol25`) and the agent tools. On every high-traffic human surface it is either absent or hard to find:
- home first screen
- home below the fold
- molecule pages (`/m`)
- Lupi Daily
- the mobile app

Part of that absence is enforced by tests and by the normative product contract, so promoting OMol25 needs an explicit owner amendment, not just UI work.

---

## 1. Surfaces ranked by prominence, and how OMol25 appears on each

**Traffic data: UNCONFIRMED.** The repo has no traffic numbers. The analytics taxonomy has `app_landed`, `molecule_loaded` and `library_searched` (`packages/ui/src/analytics/events.ts:18-56`) but no data is checked in. The ranking below is by structural prominence: entry route first, then DOM order.

**Measurement gap.** `molecule_loaded` labels its source with `sourceKind()`, and that has no OMol25 branch: it returns only `inline`, `streaming`, `remote` or `other` (`packages/ui/src/loadMoleculeSource.ts:107-112`). OMol25 opens therefore cannot be told apart from other URL loads. `library_searched` does tag `collection: 'omol25'` (`packages/ui/src/library/Omol25Collection.tsx:133,321`).

| # | Surface | OMol25 today | Evidence |
|---|---|---|---|
| 1 | **Home, first screen** (`/`, `LandingShell` then `LandingPage`) | **Absent by name.** The order is the H1 "Small structures. Big discoveries.", the C60 ink hero, the finder, then the scan callout. The finder searches only local gallery entries plus PubChem autocomplete, never OMol25. The only path toward OMol25 is a small "browse the library" link in the scope line, which goes to `/library` (all sources), and a "Search the full library for X" row once you type. | `packages/ui/src/landing/LandingPage.tsx:20-35`; `MoleculeFinder.tsx:13-25,164,181-185,270-273,316-320`; `hero/BuckyHero.tsx:8` (`GALLERY_ID = 'c60_buckyball'`) |
| 2 | **Home, below the fold** | **Absent.** In order: DailyCard (gallery queue); MoleculeWall (`LOCAL_MOLECULES` is built only from openable gallery entries, and none of the 104 gallery entries is OMol25); student collection (12 positive-list entries); tips; drop zone; footer. The footer has no Library or OMol25 link. | `LandingPage.tsx:36-52`; `moleculeIndex.ts:64-78`; `MoleculeWall.tsx:33,56-58`; `GallerySection.tsx:2,20`; `LandingFooter.tsx:10-16`. I checked `gallery-data.json` with node: 104 entries, 0 mentioning omol25. |
| 3 | **Primary nav** (`SiteHeader`, shared by home, Library and Scan) | **Indirect.** The nav is Molecules · Daily · Library · Scan · How to use · Open a file. Library goes to `/library` (all), not `/library/omol25`. No "Surprise me" link, although the restoration design planned one. The `/m` and `/daily` static headers also link only to `/library`. | `packages/ui/src/landing/SiteHeader.tsx:16-27`; `docs/library-restoration-design.md:151`; `scripts/molecule-pages/html.mts:83-85`; `scripts/daily/html.mts:62-63` |
| 4a | **Homepage search** (finder) | **Not queried.** Results are local gallery matches plus PubChem names only. | `MoleculeFinder.tsx:108-129,164` |
| 4b | **In-viewer switcher** (Switch panel, `MoleculeSwitcher`) | **Conditional and last.** When idle it shows "Familiar molecules", which is gallery only. OMol25 rows appear only when the query looks like a formula or elements are selected. They come after the gallery results, up to 16 rows. Their title is the bare formula with a `◇` glyph and no art. Jev judges only the gallery pool. | `switcher/MoleculeSwitcher.tsx:50,108-110,187-188,297-302`; `switcher/switchIndex.ts:51,103-118,173-191,264-268` |
| 4c | **Command palette** (Cmd/Ctrl+K) | **Absent.** The Discover group has only "Open gallery" and "Play Lupi Daily". | `packages/ui/src/ViewerApp.tsx:903-921` |
| 4d | **Dev/MCP panel search** (`MoleculeSearch`) | Has an OMol25 source chip, but it is mounted only in the `#/mcp` bridge panel. | `molecules/MoleculeSearch.tsx:5-14`; `mcpViewerBridge.tsx:1010-1014` |
| 5 | **Library, all sources** (`/library`) | **Present but not foregrounded.** It is the third nav item, "OMol25 · 34.3M structures", and is named in the lede. In the default browse grid every hit scores 0.3, except featured gallery entries (0.6). The tie-break ranks OMol25 at priority 6, ahead of PubChem alone. So OMol25 cards sit near the end, after gallery, research, social-QR, saved and NIST results. | `library/LibraryPage.tsx:21-33`; `molecules/search.ts:13-22,31,59-63`; `molecules/providers/gallery.ts:39`; `molecules/index.ts:19-28` |
| 6 | **Library, OMol25** (`/library/omol25`) | **The only full OMol25 experience.** It has an attribution masthead (CC BY 4.0, paper and source links, "OMol25 supplies no bond topology…"). There are two modes: Remote collections (neutral-train, 34,335,828 rows, with a "Random page" button) and "Filter by element" over the 27,697-row validation slice, with element chips, a functional-group screen and stats. Cards are text-only `LibraryCard`s with no image; gallery cards in the Library get ink tiles. | `library/Omol25Collection.tsx:48-79,163-167,218-225,263-439`; `library/LibraryCard.tsx:19-22,58-97`; `library/GalleryCollection.tsx:127-145` |
| 7 | **Library, random** (`/library/random`) | Opens one random validation structure. It is reachable only from the Library sub-nav. To pick one row it downloads the whole 698 KB index first. | `library/RandomStructure.tsx:11-12,32`; `molecules/randomOmol.ts:22-48`; `LibraryPage.tsx:71-73` |
| 8 | **SEO** | `/library/omol25` is indexed: in the sitemap, titled "Open Molecules 2025 (OMol25) browser", with CollectionPage JSON-LD. `/materials/omol25` and `/materials/omol25-molecule-geometry` are `noindex,follow` "Moved to the Library" pages and redirect client-side. The home SEO description, `llms.txt` and `llms-full.txt` do not mention OMol25 or the Library (grep found nothing). | `packages/ui/src/seo-routes.json` (`libraryOmol25`, `omol25`, `omol25Geometry` entries); `apps/web/public/sitemap.xml:7`; `viewer/viewerRoutes.ts:123-127`; `apps/web/src/main.tsx:39,220-221` |
| 9 | **Molecule pages** (`/m/<id>`, `/m/`) | **Absent by rule.** A page exists only for a gallery entry that is a single-frame XYZ under `gallery/curated/` with at most 600 atoms. The 70 `/m/` URLs in the built sitemap are all gallery. | `packages/ui/src/moleculePage/pages.ts:15,33-45`; `apps/web/dist/sitemap.xml` (local build; production parity UNCONFIRMED) |
| 10 | **Lupi Daily** | **Absent.** The queue is 55 recognisable gallery molecules with an `/m` page. It is a name-guessing game, and OMol25 rows have no names. | `scripts/daily/queue.mts:6-21`; `docs/daily.md:3,40,75` |
| 11 | **Mobile (Expo)** | **Absent.** The gallery is a closed, bundled 24-item allowlist with a 50k-atom ceiling, and unknown IDs fail closed. The mobile "Library" tab holds only recent items. | `apps/mobile/src/features/gallery/gallery-catalog.ts:8,41-57`; `docs/mobile-expo.md:169-180,181-188` |
| 12 | **Agents** | **First-class.** `lupi.search_molecules` and `lupi.browse_collection` page OMol25 through the edge. | `AGENTS.md:355-356`; `docs/library-restoration-design.md:156-163` |
| 13 | **Share unfurls** | An OMol25 saved view gets the generic `og-lupi.png` card, because the Worker matches only `/m/manifest.json` gallery pages. A live public OMol25 saved view exists: `c19h26brn3o4-omol25-publish`. | `apps/mcp-worker/src/index.ts:2666-2711,2785`; `docs/brainstorm/2026-09-viewer-play/verification.md:30` |

**Two stale-copy findings.** These two strings still tell visitors that dataset browsing is outside the app, which contradicts the 2026-09-18 amendment:
- `apps/web/src/main.tsx:239-240`: "Research execution and large dataset browsing are separate from the learning app."
- `packages/ui/src/landing/SeoEducationPage.tsx:43`: "Large dataset browsing and research execution are separate…"

Separately, `SceneLandingPage.tsx:111` mentions OMol25, but its route `/scenes/1m-copper-lattice` is retired in `main.tsx:43-45`. Whether it can still be reached is UNCONFIRMED, and probably not on a direct load.

---

## 2. Prior owner decisions a new plan must not silently contradict

1. **Student reset (2026-09-04).**
   - Goal: "curate for students, and separate research execution from lupi.live" (`docs/product-reset-2026-09-04.md:3-4`).
   - Home was diagnosed as "Competing entry points, GPU decoration, research/scale-first cards" and replaced with "One learning collection, first Water model, short guide, local file opening" (`:21`).
   - "Catalog growth silently became product curation" led to "Positive list of 12 source-bound examples" (`:22`).
   - "Adding an item to the full agent/research catalog alone never publishes it in this collection" (`:48-49`).
   - The pre-reset home had an "Explore / Search all sources / OMol25 tabs" shell and a home "Surprise me" that opened a random OMol25 structure. Both were deleted in `e15adff` (`docs/library-restoration-design.md:41-42`).

2. **Amendment (2026-09-18).**
   - "the student curation, typography, and retirement of research execution stand. Removing the browsable, source-backed molecular library was a mistake" (`docs/product-reset-2026-09-04.md:101-103`).
   - Home row of the table: "Unchanged; … plus a Library link in the header and a full-library handoff under the finder" (`:109`).
   - `/materials/omol25*` redirect into `/library` (`:111`).

3. **Normative product contract** (`docs/product-ownership-contract.md`).
   - Change control is an "explicit reviewed product decision approved by the decision owner" (`:7`).
   - "Public navigation is Explore, Library, How to use, and Open a file" (`:56`). The shipped header has already drifted to six items (`SiteHeader.tsx:17-26`).
   - "The homepage search matches the curated gallery and PubChem names" (`:57-58`). **Putting OMol25 into the homepage finder contradicts this as written.**
   - "No source is queried silently, and the Library never presents a viewer inference (such as a distance-inferred bond) as dataset truth" (`:61-63`).
   - Student publication is positive-list controlled (`:78-81`). Supplied data must be distinguished from inferred visual convenience (`:113-115`).

4. **Library restoration design.**
   - "Nothing heavy on the landing chunk… The 4 MB OMol25 index loads only when the OMol25 collection opens" (`docs/library-restoration-design.md:89-91`).
   - "The student collection section on the homepage is unchanged" (`:152`).
   - Risks: "Contract drift… Phase 0 is not optional" (`:256-258`); "Bundle weight. The library must stay off the landing chunk… no-canvas checks… are the regression guard" (`:265-267`); "Truth labeling. OMol25 supplies no bonds" (`:268-270`).
   - Mobile was explicitly deferred (`:190-192`).
   - Planned but **not shipped**: "Surprise me" in the header (`:151`).

5. **Switcher UX decision.** The 18-column periodic-table grid "was removed on 2026-09-20… and the same decision removed it from the Library's OMol25 facets" (`docs/jev-integration.md:161-165`). A featured OMol25 experience should not bring back a periodic-table grid.

6. **Tests that enforce the demotion.**
   - `GallerySection.test.tsx:11` asserts the student collection never shows "OMol25".
   - `tests/ui/student-surface.spec.ts:8-9` requires exactly 12 cards and zero canvases on `/`.
   - `:22` requires the primary nav not to match `/research|MLIP/i`, so any new nav label must avoid the word "research".

7. **Cost history.** The 2026-05-30 audit flagged "OMol25 4MB index re-fetched every session" (`docs/pre-spend-retention-audit.md:43,171`). That is now mitigated: the index is a 698,385-byte same-origin v4 file (`apps/web/public/datasets/omol25/`) with `/datasets/*` cached for a day (`apps/web/public/_headers`). It still should not load on the landing page.

**Implication.** The user's new direction, that OMol25 is "one of our top resources", goes beyond what the 2026-09-18 amendment ratified. That amendment confined OMol25 to the Library. A plan should open with a Phase 0 contract amendment covering at least: nav, homepage search scope, and whether a non-student OMol25 row may sit on the home page.

---

## 3. Where OMol25 could go with little new machinery, and the constraints

### Cheapest options (copy and links only, no new data)

| Insertion | Reuses | Notes |
|---|---|---|
| Header link "Surprise me" to `/library/random`, or "OMol25" to `/library/omol25` | `SiteHeader.tsx:16-27` | Already in the design (`library-restoration-design.md:151`). Needs the contract nav amendment. The label must not match `/research/i`. |
| Finder scope line: "· 34M DFT structures in OMol25" linking `/library/omol25` | `MoleculeFinder.tsx:270-273` | A link, not a silent query, so it fits `product-ownership-contract.md:61`. |
| Formula-shaped query: an explicit row "Find C6H6 in OMol25" linking `/library/omol25?q=…` | The `finder-more` pattern at `MoleculeFinder.tsx:316-320` | Labeled, user-initiated handoff. No OMol25 fetch on landing. |
| Footer link to Library and OMol25 | `LandingFooter.tsx:10-16` | Trivial. |
| Palette "Discover": "Browse OMol25", "Random OMol25 structure" | `ViewerApp.tsx:903-921`; code-split import as in `RandomStructure.tsx:11-12` | Trivial. Runs inside the viewer, so no landing cost. |
| Library emphasis: OMol25 first or default in the sub-nav, and a raised `omol` tie-break | `LibraryPage.tsx:21-27`; `search.ts:13-22` | Also update the lede/SEO copy. |
| Fix the stale "dataset browsing is separate" copy | `main.tsx:239-240`; `SeoEducationPage.tsx:43` | Copy only. |
| Home SEO description, `llms.txt` mention | `seo-routes.json` (`home`); `apps/web/public/llms.txt` | Copy only. |
| `/m/` index and `/m` "More molecules": an "Explore OMol25" shelf link | `scripts/molecule-pages/html.mts:316,382` | Static HTML, zero canvas. |
| Analytics: add an `omol25` branch to `sourceKind()` | `loadMoleculeSource.ts:107-112` | Do this first, so any promotion can be measured. |
| `/library/random` without downloading the index | `randomOmol.ts:28` | Rows 0..27,696 map 1:1 to edge rows (`providers/omol.ts:17-24`), so a random integer can open directly. |

### Medium options (reuse ink and card components; need a small build-time data file)

- **An "From OMol25" card or row on the home page, between DailyCard and MoleculeWall** (`LandingPage.tsx:36-37`). Model it on `DailyCard`: SVG only, data fetched at idle, honours Save-Data, no idle motion (`DailyCard.tsx:32-36,70-75,92-118`). Draw it with `inkSvgMarkup` (`moleculePage/ink.ts:264`) or the spinnable `createInkStage` (`moleculePage/inkStage.ts:1-24,117`), styled with the existing `.ink-tile` CSS (`landing/student-home.css:843-860`). Open the molecule through `openMolecule({kind:'url', …})` as the switcher already does (`switchIndex.ts:113-116`).
  - **Bond dependency (this links to the bond-strategy work).** An `InkModel` requires bond pairs `b` (`ink.ts:42-55`). The `/m` generator fills them with `computeBonds`, a distance-inferred rule with `BOND_SLACK = 1.15` (`scripts/molecule-pages/catalog.mts:347`; `packages/core/src/objectFacts/bonds.ts:3-4`). Any OMol25 ink art therefore displays inferred bonds and must carry the "viewer guide" label (`LibraryCard.tsx:21-22`).
- **Ink thumbnails on OMol25 Library cards and switcher rows.** Today they are text-only or `◇` (`LibraryCard.tsx:70-97`; `MoleculeSwitcher.tsx:297-302`). Gallery cards already render `img.ink-tile` (`GalleryCollection.tsx:142-145`). OMol25 would need per-row ink SVGs: at build time for curated picks, or at runtime from the fetched XYZ.
- **Switcher idle shelf.** Add an "OMol25" group or a "random OMol25" chip next to "Familiar molecules" (`MoleculeSwitcher.tsx:187-188`). Note that `LOCAL_MOLECULES` feeds the wall, the finder and the switcher together (`moleculeIndex.ts:64-78`; `switchIndex.ts:134-137`). Adding OMol25 rows to it would quietly change all three surfaces, so keep OMol25 in a separate list.
- **Share cards for curated OMol25 picks.** Extend the `/og/m` card generator and the Worker manifest match (`index.ts:2666-2711`). Without that, shared OMol25 views keep the generic image.

### Constraints any insertion must respect

- **No three.js and zero canvases on landing.**
  - `main.tsx:27-28`: LandingShell "imports ZERO three/R3F/drei".
  - `LandingShell.tsx:9`.
  - `student-surface.spec.ts:9`.
  - `BuckyHero.tsx:35`.
  - `DailyCard.tsx:73`.
  - `library.spec.ts:26,73` requires zero canvases on the Library pages as well.
- **Landing-chunk import discipline.** Only modules marked landing-safe may be imported there (`inkTiles.ts:19-20`; `moleculePage/pages.ts:10`; `MoleculeFinder.tsx:10,72-73`). The OMol25 collection is lazy-loaded (`LibraryPage.tsx:10`).
- **Data weight.** Do not fetch the 698 KB index on landing. The 2,279-byte facets file is safe to fetch there.
- **Upstream fragility.** Remote OMol25 depends on the Hugging Face Dataset Viewer:
  - 202 "warming" responses (`Omol25Collection.tsx:136-143`; `scienceData.ts:518-537`);
  - a 20 s client timeout (`remoteOmol.ts:185-188`);
  - row pages cached only 300 s (`scienceData.ts:408`).

  A home-page card must use curated, build-time data or degrade quietly, as DailyCard does.
- **Truth labels on every OMol25 surface** (`product-ownership-contract.md:61-63`; `LibraryCard.tsx:21-22`; `library.spec.ts:69`).
- **Layout.** 320 px reflow with text-spacing stress (`student-surface.spec.ts:25-35`; `library.spec.ts:77-78`). The reset's home-height receipt (3,466 px against a 16,551 px baseline, `product-reset-2026-09-04.md:74-76`) is the cited regression guard (`library-restoration-design.md:265-267`).
- **Bundle budget: UNCONFIRMED.** I found no enforced landing bundle-size budget in tools or tests.
- **Daily ordering.** If Daily ever takes OMol25 content: "Append to the queue; never reorder it" (`docs/daily.md:84`; `scripts/daily/queue.mts:14-15`).
- **Mobile** needs a new allowlist and bridge path. Unknown IDs fail closed (`docs/mobile-expo.md:176-180`).

---

## 4. What a "featured" or "hero" OMol25 experience can build on

1. **Validation index and facets (same-origin, verified).**
   - 27,697 records, each `[formula, atoms, functional-group bitmask]`, where record *i* is edge row *i* (`providers/omol.ts:17-24,59-79`).
   - The build checked a sample of 24 rows against the live edge, all matched (`neutral-validation.v4.receipt.json`).
   - Facets: 17 elements (H 27,432 … Mg 207), 20 geometry-screen groups (amine 19,638 … anhydride 120), atoms 2–110 with median 46 (`neutral-validation.v4.facets.json`, read via node).
   - These allow deterministic shelves such as rare elements (Li, Na, K, Mg, Ca), "with a nitro group" or "phosphate esters". Every structure is under the 600-atom ink limit (`pages.ts:15`).
   - Limits: the v4 index has no HOMO–LUMO gap ("all null", `providers/omol.ts:151-153`) and no names. Every surface titles rows by formula (`providers/omol.ts:252`; `remoteOmol.ts:176`; `switchIndex.ts:106`).
2. **Upstream per-row metadata the edge currently discards (external, sampled).**
   - Hugging Face rows for `colabfit/OMol25_neutral_validation` carry `property_metadata` with:
     - `data_id`: the subset. I observed `orbnet_denali`, `spice`, `ani2x` and `geom_orca6`.
     - `source`: strings that sometimes embed a **ChEMBL ID and a name** (for example `orbnet_saltcomplex_22340_CHEMBL380061_Choline`, `CHEMBL117434_Methionil`) or a **PubChem CID** (`SPICE_Solvated_PubChem_Set_1_…_135142749`).
     - `homo_lumo_gap`, NBO/Mulliken/Löwdin charges, `charge`, `spin`.
   - The top-level `names` field is only a shard ID (`OMol25_neutral_validation_data0029_31`).
   - Source: https://datasets-server.huggingface.co/rows?dataset=colabfit/OMol25_neutral_validation&config=default&split=train&offset=0&length=1, plus offsets 3000–27003.
   - **Bond orders: none.** I saw no bond-order field among the `property_metadata` keys in the row I listed (UNCONFIRMED for other subsets). That reinforces the need for a bond strategy; charge and spin are the inputs a bond-order assignment would need.
   - The edge keeps only top-level columns (`apps/mcp-worker/src/scienceData.ts:484-516`). Its XYZ comment omits charge and spin (`:459-474`).
   - So **named curated picks are feasible as a build-time step**: resolve ChEMBL or PubChem IDs to names, keeping provenance.
   - UNCONFIRMED: whether all `source` names are clean (one looks truncated, "Methionil"), and whether biomolecule, metal-complex or electrolyte subsets appear in this neutral slice at all; my sample showed none.
   - The paper describes the full dataset as ">100 million DFT calculations at ωB97M-V/def2-TZVPD", "83 elements", "~83M unique molecular systems… small molecules, biomolecules, metal complexes, and electrolytes", "up to 350 atoms" (https://arxiv.org/abs/2505.08762).
3. **The random path.** `openRandomOmol25Molecule` (`randomOmol.ts:22-48`) and the remote "Random page" (`Omol25Collection.tsx:163-167`) already exist. A header or palette "Surprise me" is close to free.
4. **A daily format.** DailyCard's date-seeded, idle-loaded pattern (`DailyCard.tsx:75-118`) fits an "OMol25 structure of the day" chosen deterministically from curated rows. It needs no names. A formula-guess variant of Daily is possible, but whether it fits the name-based game (`docs/daily.md:40`) is UNCONFIRMED.
5. **The ink pipeline for a hero.** The C60 hero is hard-wired: `GALLERY_ID` (`BuckyHero.tsx:8`) and data generated by `tools/build-hero-data.mjs` (header of `c60Hero.data.ts`). The general spinnable stage `createInkStage` has "no three, no React" (`inkStage.ts:18-20,117`) and the turntable detents come from Object Facts at build time (`catalog.mts:348`). A rotating OMol25 hero is mostly a build step that writes `InkModel`s, with bonds, for curated rows.
6. **Facet and Jev enrichment.** `docs/library-facts.md:168-172` already scopes it: "Formula-derived facets (contains a metal or a halogen, charge, spin) are free. Jev enrichment of all rows would cost about 75M tokens (about $3). The result belongs in an edge-served index… not the bundle." The switcher's Jev judgment covers only the gallery pool today (`switchIndex.ts:210-216`; `MoleculeSwitcher.tsx:108-110`).
7. **Agent parity.** `lupi.browse_collection` and `lupi.search_molecules` (`AGENTS.md:355-356`) can serve as the contract test for any featured list: whatever humans see should also be reachable by agents.

---

## Also unconfirmed

- Whether the deployed site matches this repo. The `apps/web/dist/` sitemap and pages are a local build.
- What actually sits above the fold at common viewports. Only the DOM order is confirmed.