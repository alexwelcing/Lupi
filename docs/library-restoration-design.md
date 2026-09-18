# Molecular library restoration design

Status: design proposal for an explicit reviewed product decision. Decision
owner: Alex Welcing. Written 2026-09-18 on branch
`claude/typesafe-ai-research-6yq1by`.

This document restores the browsable, source-backed molecular library that
the 2026-09-04 student reset removed. It follows the
[historical recovery inventory](historical-recovery-inventory.md) rule: a
commit hash establishes provenance, not current correctness, so the UI is
rebuilt against current contracts rather than reverted.

## What was lost, and what was not

### Still alive today

Every data path that made the library work survived the reset. Only the
screens were deleted.

| Layer | Where | State on 2026-09-18 |
|---|---|---|
| Federated search core | `packages/ui/src/molecules/search.ts`, `index.ts`, `types.ts`, `load.ts` | Present, unit tested, used by the MCP tool `lupi.search_molecules` and by the dev-only `#/mcp` panel. No public UI calls it. |
| Eight providers | `packages/ui/src/molecules/providers/*` | All registered in `MOLECULE_PROVIDERS`: saved views, Firestore library, social QR, gallery (104 entries), research (8 Zenodo records), NIST (675 potentials, 209 with demo trajectories), OMol25 (27,697-row validation index on GCS), PubChem (autocomplete plus direct PUG REST load). |
| OMol25 remote client | `packages/ui/src/molecules/remoteOmol.ts` | Present. Pages 34.3M neutral-train rows through the edge. |
| Random OMol25 opener | `packages/ui/src/molecules/randomOmol.ts` | Present, unmounted. |
| NIST potential browser | `packages/ui/src/panels/PotentialBrowser.tsx` | Present, unmounted. |
| Edge dataset routes | `apps/mcp-worker/src/scienceData.ts` | Live. Verified today: `GET /v1/datasets/omol25` returns the manifest, `/neutral-validation/rows?limit=2` returns real rows in 2.5 s, `/v1/datasets/research` returns the eight-record manifest. |
| GCS validation index | `gs://shed-489901-omol25/omol25_neutral_val.v3.json` | Responds 200 today. |
| Gallery catalog | `packages/ui/src/gallery-data.json`, `gallery/catalog.ts` | 104 entries, all `available`, 100 local files present (173 MB under `apps/web/public/gallery`), 3 on GCS, 7 trajectories, 11 domains. |
| Landing finder | `packages/ui/src/landing/MoleculeFinder.tsx`, `moleculeIndex.ts`, `MoleculeWall.tsx` (added 2026-09-17 in `777ca6b`) | Instant local search over all 103 directly openable gallery entries plus PubChem autocomplete. This is the current public search. |

### Deleted in `e15adff` (2026-09-04)

| Component | Origin | Lines | What it did | Restore? |
|---|---|---|---|---|
| `molecules/MoleculeBrowser.tsx` | `83027d4` | 310 | One grid over all sources with source chips, element chips, per-source badges, provenance line. | Yes, rebuilt. |
| `molecules/OmolCollection.tsx` | `83027d4` | 432 | OMol25 home: attribution masthead, periodic-table facet over the validation index, functional-group screen, formula search. | Yes, rebuilt. |
| `molecules/RemoteOmolCollection.tsx` | `56f2434` | 210 | Paged browsing of the five ColabFit collections through the edge, formula filter, random page, warming state. | Yes, rebuilt. |
| `Gallery.tsx` | `83027d4` | 1,868 | Full catalog with domain, source and functional-group filters, live XYZ previews. | Partly. Filters yes; the component no. |
| `gallery/useGalleryFilters.ts` | | 120 | Pure filter hook over the catalog. | Yes, nearly verbatim. |
| `landing/GallerySection.tsx` tab shell | | | Explore / Search all sources / OMol25 tabs plus research tools row, `?tab=` deep links, `lupi:gallery-search` intent event. | Replaced by a route, below. |
| `LandingShell.tsx` "Surprise me" | | | Random OMol25 structure. | Yes. |
| `EquilibriumSolveWorkbench.tsx`, `RunConfigurator.tsx`, `MlipLongRunWorkbench.tsx`, `MlipFlywheelPage.tsx`, `compare/*` | | 3,300 | Research execution and synthetic comparison. | No. The ownership contract excludes execution and the inventory rejects the comparison theater. |
| `MoleculeConfigurator.tsx` | | 426 | "Build a scene" modal for procedural lattices. | Not in this design. Procedural generation stays reachable through the agent tool. |

Two things the old surface never had: Playwright coverage of the browser or
OMol25 tabs (none existed), and a route of its own. It lived behind
`/?tab=browse` on the homepage, which is why it disappeared with the homepage.

## The decision this design needs

The [product ownership contract](product-ownership-contract.md) currently
says the public surface is Explore, How to use, and Open a file, and that
public search "explicitly filters the student collection; it does not
silently query a research corpus." The 2026-09-17 landing already widened
search to all 104 gallery entries and PubChem, so the contract text is
behind the shipped product.

Proposed amendment, for the owner to ratify with this design:

> Public navigation is Explore, Library, How to use, and Open a file. The
> homepage search matches the curated gallery and PubChem names. The Library
> route offers every connected source explicitly, one source at a time or all
> together, with the source and its provenance named on every result. No
> source is queried silently. Research execution remains outside Lupi.

Everything below assumes that amendment. Without it, only the homepage
finder handoff (phase 3) is permitted.

## Design

### Principles

1. **Rebuild the screens, reuse the engine.** Providers, load path, and edge
   routes are current and tested. No historical component is reverted;
   `useGalleryFilters` is the only near-verbatim recovery.
2. **A real route, not a tab.** `/library` and its children are path routes
   like `/study/*`, so they survive homepage redesigns, get their own SEO,
   and can be deep-linked by agents and lessons.
3. **Provenance on every card.** Source badge, license, and coordinate/bond
   truth come from the hit, never inferred by the UI. OMol25 bonds are
   labeled as viewer inference; LAMMPS types stay opaque unless the catalog
   supplies a map. This is the contract's core rule and the old cards
   already carried it.
4. **Student design system.** New screens use `student-home.css` classes
   (`student-width`, `student-section-head`, `student-search`,
   `student-filters`, `student-cards`, `student-card`) instead of the old
   dark inline styles. The library looks like the rest of the product.
5. **Nothing heavy on the landing chunk.** The library route is
   code-split. The 4 MB OMol25 index loads only when the OMol25 collection
   opens. Three.js loads only when a structure is picked, as today.

### Routes

| Route | Content | Data |
|---|---|---|
| `/library` | Federated browser: search box, source chips, element chips, result grid. Empty query browses. `?q=` and `?source=` prefill. | `searchMolecules` over `MOLECULE_PROVIDERS` |
| `/library/gallery` | The 104-entry catalog with domain, source-type, and functional-group filters. | `EXAMPLES` plus recovered `useGalleryFilters` |
| `/library/omol25` | Two modes as before: remote collections (default) and the faceted validation slice. | `remoteOmol.ts`, `providers/omol.ts` |
| `/library/research` | The eight cited Zenodo records with full provenance and parser notes. | `researchProvider`, `/v1/datasets/research` |
| `/library/potentials` | NIST potential catalog. | Rebuilt natively on `@atlas/nist` filters (delivered 2026-09-18) |
| `/library/random` | Redirect: opens a random OMol25 validation structure in the viewer. | `openRandomOmol25Molecule` |

Route registration goes in `packages/ui/src/viewer/viewerRoutes.ts` next to
`SEO_EDUCATION_ROUTES`, with a `LIBRARY_ROUTES` map, and a lazy
`LibraryPage` branch in `packages/ui/src/App.tsx`. The retired
`/materials/omol25` education pages get un-retired and link into
`/library/omol25` (they are currently a "this workspace has retired" stub).

### Components

All new files live under `packages/ui/src/library/`.

- `LibraryPage.tsx`: route shell. Reads the child route, renders a
  sub-navigation of the five collections with row counts pulled from
  providers and the OMol25 manifest, and mounts one collection component.
- `LibraryBrowser.tsx`: rebuild of `MoleculeBrowser`. Same state machine
  (debounced text, source, elements, request id guard), same
  `PER_SOURCE_LIMIT`, `loadMoleculeHit` on click. Adds an explicit
  "Searching N sources" status and a per-source error line instead of a
  silent empty grid.
- `LibraryCard.tsx`: one card used by every collection. Title, source
  badge, subtitle, element pills, provenance line (DOI, license, coordinate
  and bond truth), notice, busy overlay. Pure function of `MoleculeHit`.
- `GalleryCollection.tsx`: catalog grid over `useGalleryFilters`. Live XYZ
  previews from the old `Gallery.tsx` are dropped in favour of static
  `/learn/<id>.svg` art. `tools/build-gallery-previews.mjs` now generates
  that art for every local XYZ entry up to 1,200 atoms (72 of 104 entries),
  bound to the source SHA like the student previews; the palette mark remains
  for the rest.
- `Omol25Collection.tsx` and `Omol25RemoteBrowser.tsx`: rebuilds of the two
  OMol components. The remote browser keeps the warming state, the
  coverage label ("complete" versus "indexed preview"), the row counts,
  and the random page button. The faceted view keeps the periodic-table
  navigator and functional-group screen, both labeled as a Lupi geometry
  screen rather than dataset truth.
- `ResearchCollection.tsx`: `LibraryBrowser` pinned to `source=research`,
  plus a header that names the proxy safety rules from the manifest.
- `useLibraryQuery.ts`: URL state (`q`, `source`, `elements`, `collection`,
  `offset`) synchronized with `history.replaceState`, so Back and refresh
  work. This replaces the old `lupi:gallery-search` custom event.

Recovered nearly verbatim: `gallery/useGalleryFilters.ts` from `e15adff^`.

### Homepage and navigation

- Header nav gains "Library" between Explore and How to use.
- `MoleculeFinder` gets a final row, "Search the full library for `<query>`",
  that navigates to `/library?q=<query>`. This is the "full-library handoff"
  the [UX redesign notes](ux-redesign-2026.md) already list.
- "Surprise me" returns to the header as a link to `/library/random`.
- The student collection section on the homepage is unchanged.

### Agent surface

`lupi.search_molecules` already fans out over the same providers. Two small
additions keep the agent and human paths equal:

- Document the `sources` argument values in the browser MCP manifest so an
  agent can ask for OMol25 or research only.
- Add `lupi.browse_collection` to the browser runtime for paged OMol25
  access (`collection`, `offset`, `limit`, `formula`), a thin wrapper over
  `remoteOmolPage`. Without it an agent cannot reach the 34.3M-row split.

### Data ownership and hosting

- The OMol25 validation index and its per-structure XYZ files live in a GCS
  bucket outside the Cloudflare estate. Phase 2 mirrors them to the
  `lupi-assets` R2 bucket under `datasets/omol25/v3/` and points
  `VITE_LUPI_OMOL_INDEX` at `assets.lupi.live`, so the library has one
  origin and one operator. The GCS copy stays as the fallback until the
  mirror is verified by checksum.
- Facets for the validation slice are derived client-side from the 4 MB
  index. Phase 2 precomputes them once into `omol25_neutral_val.v3.facets.json`
  next to the index, so the OMol25 page paints its periodic table before the
  index finishes downloading.
- The Firestore `moleculeLibrary` collection has rules and a provider but no
  UI ever used it. The contract bounds cloud storage to saved-view metadata
  and a few other records. This design leaves that collection dormant and
  does not add "add to my library". If the owner wants a personal shelf,
  saved views already are one; a bookmark of a library hit can be a saved
  view whose source is the hit's load URL.

### What stays out

- Research execution and the equilibrium solver.
- Synthetic comparison and any MLIP workbench.
- The old 1,868-line `Gallery.tsx` and its live preview canvas.
- The `?tab=` homepage tab shell and the custom event bus.
- Cloud trajectory sync, and any mobile changes in this pass. The Expo app
  has a bounded native gallery; a library tab there can consume the same
  edge routes later.

## Phases

Each phase is one PR, each with its own local, CI, and deployed-smoke
receipt under the [release truth contract](release-truth-contract.md).

**Phase 0, decision.** Ratify the contract amendment above and record it in
`docs/product-ownership-contract.md` and `docs/product-reset-2026-09-04.md`.

**Phase 1, the library route with local and edge sources.** `/library`,
`/library/gallery`, `/library/research`, `/library/potentials`, header nav,
finder handoff. No GCS dependency. Sources: gallery, research, NIST,
PubChem, saved views. Roughly 900 lines of new UI plus tests.

**Phase 2, OMol25.** `/library/omol25` with both modes, `/library/random`,
precomputed facets, `lupi.browse_collection`. Un-retire the two
`/materials/omol25*` pages. Roughly 700 lines plus tests.

*Delivered 2026-09-18 with one change of approach:* instead of mirroring
the GCS index and its 27,697 XYZ files to R2, the validation index is now a
compact same-origin asset whose record `i` is Hugging Face row `i`, verified
against the dataset edge at build time, and structures open through the
edge. The external bucket is no longer a runtime dependency.

**Phase 3, quality.** Search analytics event for library queries (aggregate
only, per the analytics support role), gallery-card art for the most
opened entries beyond the twelve student previews, and the two Jev hooks
from the [TypeSafe research brief](typesafe-jev-research-2026-09-18.md)
once access exists: intent routing for the `/library` search box and
relevance re-ranking behind `lupi.search_molecules`.

## Verification

Unit (vitest, `packages/ui`):

- `useLibraryQuery` round-trips every parameter through the URL.
- `LibraryCard` renders provenance for research, OMol25, NIST, and gallery
  hits, and never invents a bond or license field that the hit lacks.
- `useGalleryFilters` recovered tests: domain, source type, functional
  group, and text filters compose.
- `Omol25RemoteBrowser` shows the warming message on a 202 and keeps the
  previous page.

Browser (Playwright, `tests/ui`):

- `/library` renders results for an empty query from at least gallery,
  research, and NIST without network beyond same-origin.
- `/library?q=benzene` opens the gallery benzene on Enter and lands in the
  viewer with the Learn prompt intact.
- `/library/research` opens one Zenodo record through the proxy and the
  viewer shows opaque types unless a map exists.
- `student-surface.spec.ts` still passes: the six retired research entry
  points stay retired, the twelve student cards still load, 320 px reflow
  holds on `/library`.
- Deployed smoke (`@deployed-smoke`): `/v1/datasets/omol25` manifest and
  one rows page respond, `/library/omol25` paints at least one card.

Verifiers: `pnpm verify:product-contract` (update its required-doc list
with this design and the amendment), `pnpm audit:gallery-claims`,
`pnpm lint`, `pnpm build`.

## Risks

- **Contract drift.** The biggest risk is shipping the library without the
  written amendment, which recreates the ambiguity that led to the reset.
  Phase 0 is not optional.
- **External uptime.** Hugging Face's dataset viewer warms indexes lazily
  and Zenodo rate-limits. The edge already returns explicit warming and
  502 states; the UI must show them rather than an empty grid.
- **GCS ownership.** Resolved: the validation index ships same-origin and
  structures open through the edge (`tools/build-omol25-validation-index.mjs`).
  The GCS bucket is only the offline source for rebuilding the index.
- **Bundle weight.** The library must stay off the landing chunk. The
  student-surface height and no-canvas checks in the reset receipt are the
  regression guard.
- **Truth labeling.** OMol25 supplies no bonds and NIST demos are
  procedural for 466 of 675 entries. Cards and the Learn panel must say so,
  as the old cards did through `notice` and the bond-source facts.

## Provenance

- `83027d4` (2026-07-20): first `MoleculeBrowser`, `OmolCollection`,
  `randomOmol`, `PotentialBrowser`, `providers/omol.ts`, `Gallery.tsx`.
- `56f2434` (2026-07-21): edge dataset routes, `remoteOmol.ts`,
  `RemoteOmolCollection`, the Zenodo research catalog.
- `992ab23` (2026-08-22): periodic table explorer and run configurator.
- `e15adff` (2026-09-04): student reset, deletions listed above.
- `777ca6b` (2026-09-17): molecule-first landing with the finder and wall.
