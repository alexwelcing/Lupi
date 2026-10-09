# External scientific data

Lupi exposes large scientific collections through a same-origin edge API. The
repository stores a small, reviewable catalog; coordinates and trajectories stay
with their public data providers and are fetched only when a user browses a page
or opens a structure. This keeps checkout and deployment size independent of the
underlying datasets.

## OMol25: exact coverage

[OMol25](https://huggingface.co/facebook/OMol25) is the gated, official source
corpus described in the [OMol25 paper](https://arxiv.org/abs/2505.08762). Lupi
does not claim that the gate has been removed or that every official shard is
publicly browsable. Its browser uses the public
[ColabFit conversions](https://huggingface.co/collections/colabfit/omol25-open-molecules-2025-colabfit)
through the [Hugging Face Dataset Viewer row API](https://huggingface.co/docs/dataset-viewer/en/rows):

| Lupi collection | Public repository | Indexed rows | Source rows | Coverage shown in the UI |
| --- | --- | ---: | ---: | --- |
| `neutral-train` | `colabfit/OMol25_train_neutral` | 34,335,828 | 34,335,828 | Complete public neutral training split |
| `neutral-validation` | `colabfit/OMol25_neutral_validation` | 27,697 | 27,697 | Complete public neutral validation split |
| `all-train-preview` | `colabfit/OMol25_train` | 841,736 | 101,666,280 | Indexed preview |
| `train-4m-preview` | `colabfit/OMol25_train_4M` | 1,000,000 | 3,986,754 | Indexed preview |
| `validation-preview` | `colabfit/OMol25_validation` | 800,000 | 2,762,021 | Indexed preview |

*Indexed rows* are the rows the Hugging Face Dataset Viewer serves (the edge
rejects any row past them). *Source rows* are the configurations in the split,
from the ColabFit dataset cards (they match arXiv:2505.08762 Table 1 for the 4M,
validation and neutral splits). The manifest and row pages report both, plus
the Dataset Viewer's `estimatedRows`, which understates the larger
repositories (65,331,709 / 2,657,915 / 1,842,258).

These collections, their row counts, the structure URLs and every provenance
sentence live in one module, `@atlas/core/omol25`
(`packages/core/src/omol25/`). The edge, the Library, the URL policy and the
MCP tools import it rather than keeping their own lists.

OMol25 supplies atomic numbers, source coordinates, energies and forces, and
(outside neutral-train) each record's total charge and spin. It does **not**
supply bond topology: OMol25 supplies no bond topology; Lupi infers bonds with
a published rule (`lupi-bonds.molecular.v1`, see
`docs/omol25-bonds-and-discovery.md`) and labels them. Inferred bonds must never
be presented as dataset truth.

### Same-origin validation index

The faceted view at `/library/omol25?view=facets` needs the whole
neutral-validation slice at once. `tools/build-omol25-validation-index.mjs`
turns the v3 metadata index into a compact same-origin asset,
`apps/web/public/datasets/omol25/neutral-validation.v4.json` (about 700 KB,
210 KB compressed), plus a precomputed facets file and a build receipt. Each
compact record is `[formula, atomCount, functionalGroupMask]` and record `i`
is Hugging Face row `i` of `colabfit/OMol25_neutral_validation`; the builder
spot-checks a sample of rows against the live edge and refuses to write on a
mismatch. A hit therefore opens through
`/v1/datasets/omol25/neutral-validation/structures/{i}.xyz`, and no external
bucket is needed at runtime. `VITE_LUPI_OMOL_INDEX` can still point at an
older v3 index for local experiments.

The functional-group mask is the Lupi geometry screen recorded by
`tools/omol25-structures.py`. It is a search aid over source coordinates, not
OMol25 bond topology.

### Edge routes

All routes accept `GET` and `HEAD`:

- `/v1/datasets/omol25` returns coverage (`indexedRows`, `estimatedRows`,
  `sourceRows`), attribution, the citation and collection URLs.
- `/v1/datasets/omol25/:collection/rows?offset=0&limit=24` returns compact row
  metadata. Add either `query=...` or an exact `formula=...`, never both.
- `/v1/datasets/omol25/:collection/structures/:row.xyz` materializes one XYZ
  file from the selected source row. Its comment and response headers preserve
  coordinate, charge and bond-topology provenance.

Rows are streamed from Hugging Face rather than copied into Lupi. A page is
limited to 36 rows and a synthesized XYZ to 1,000 atoms. When a Hugging Face
search/filter index is still warming, the edge returns `202`, `Retry-After: 15`,
and an explicit `warming` state; it does not silently substitute a different
result set.

#### Row fields

Each row carries `rowIndex`, `id`, `configurationId`, `propertyId`, `formula`
(Hill), `reducedFormula`, `elements`, `atomCount`, `method`, `software`,
`energy` (eV), `maxForceNorm` (eV/Å), `name` (a ColabFit shard id, not a
chemical name), `loadUrl`, `coordinateProvenance: 'source'` and
`bondTopology: 'not-provided'`, plus the record's chemistry:

| Field | Meaning |
| --- | --- |
| `charge` | Total charge, an integer with \|q\| ≤ 10, or `null` |
| `spinMultiplicity` | 2S+1, an integer from 1 to 11, or `null` |
| `chargeSource` | `record` (from `property_metadata`), `split-definition` (neutral-train: charge-neutral singlets by definition, no metadata column) or `unavailable` |
| `domain` | The record's `data_id` subset (`spice`, `ani2x`, `orbnet_denali`, …), or `null` |
| `homoLumoGapEv` | The first entry of `property_metadata.homo_lumo_gap` (eV), or `null` |
| `metaTruncated` | Present (`true`) when Hugging Face truncated `property_metadata`; charge and spin are then `unavailable` |
| `multiplicity` | ColabFit's column, kept for compatibility. It is **not** the spin multiplicity (it reads 1 for a Pr triplet) and no UI reads it |

`property_metadata` is parsed defensively: a truncated, unparsable or
out-of-range cell gives `chargeSource: 'unavailable'` and never fails the page.

#### XYZ comment and headers

The structure comment is `key=value` pairs separated by ` | `, in this order,
with no spaces inside values and no `Properties=` columns:

```
OMol25 {collection} row={row} | collection={collection} | formula={hill} |
configuration_id=… | property_id=… | method=ωB97M-V | charge={int} |
multiplicity={int} | charge_source={record|split-definition|unavailable} |
data_id={id} | energy_eV={num} | max_force_eV_per_A={num} |
homo_lumo_gap_eV={num} | coordinates=source | bonds=not-provided |
license=CC-BY-4.0 | source={hf repo}
```

(one line in the file). `charge=` and `multiplicity=` are omitted when the
charge source is `unavailable`; `data_id=`, the energy, the force and the gap
are omitted when absent. The XYZ parser reads these keys into `Frame.chemistry`
and `Frame.sourceRecord`; none of them enters the decoded-frame digest.

Response headers: `x-lupi-coordinate-provenance: source`,
`x-lupi-bond-topology: not-provided`, `x-lupi-charge-provenance` (the charge
source) and `x-lupi-bond-inference: lupi-bonds.molecular.v1`. The Worker's CORS
`access-control-expose-headers` list includes all four.

#### Timeouts, truncation and caching

- Every upstream call runs under `AbortSignal.timeout`: 9 s for rows, filter
  and search, 12 s for a structure (the deadline covers reading the body). A
  timeout answers `504 {status: 'slow'}` with `cache-control: no-store`; the
  browser maps it to a typed `OmolSlowError`, separate from `warming`.
- A structure whose `positions` or `atomic_numbers` cell Hugging Face
  truncated answers an explicit `502` naming the truncation.
- Structure responses are cached through the Workers Cache API under a key
  that includes `omol25-xyz-v2` (bump it whenever the XYZ text changes). The
  cache is injectable and guarded: without one (plain Node tests, `tsc` with
  `types: []`) the route simply does not cache. After a deploy that changes the
  XYZ text, purge `/v1/datasets/omol25/*/structures/*`; a client holding an
  older file falls back to the distance recipe, which is older, never wrong.

### Featured picks

Lupi keeps same-origin copies of a small featured set (at most 48 rows,
CC BY 4.0, attributed, each with a sha256 receipt) for the home shelf, the
Library shelves, the finder and agents; every other row stays stream-only.

- `tools/omol25-featured.picks.json` is hand-edited: neutral-validation rows
  (the split with a verified 1:1 row map), each with a shelf (`drug-like`,
  `amino-acid-ligand`, `conformers`, `off-equilibrium`, `salt-complexes`,
  `small`), a `home` flag and why it was picked. Home picks are listed first,
  cycling through the shelves, because the home shelf shows six consecutive
  home picks a day.
- `tools/build-omol25-featured.mjs` (run once by hand with
  `pnpm exec tsx`; it needs the network and `@atlas/core/bonds`, and the web
  build never fetches) builds each XYZ with the edge module itself, so the
  committed file is byte-for-byte what the edge serves, and writes:
  - `apps/web/public/datasets/omol25/featured/omol25_nv_<row>.xyz`;
  - `apps/web/public/datasets/omol25/featured.v1.json`
    (`lupi.omol25-featured.v1`: every pick's ids, formula, elements, shelf,
    domain, charge and spin from the record, energy, largest force, gap,
    title, file, edge and ink paths, sha256 and fetch time; this is also the
    agent-parity surface);
  - `packages/ui/src/landing/omolShelf.data.ts`, the landing-safe slice the
    home shelf renders (imports nothing; about 0.8 KB gzip);
  - a curation contact sheet under `.verify-artifacts/omol25-featured/`.
- Gates (fatal): 12–120 atoms; no pair closer than 0.7 Å; charge and spin
  from the record; under `perceiveBonds` (`lupi-bonds.molecular.v1`, τ 0.45)
  every H has exactly one covalent partner, no atom exceeds its covalent cap
  and no s-block ion has a covalent stick; across the set all 17 neutral-lane
  elements appear, every shelf is filled and at least 12 picks are home.
- Titles are Hill formulas. A ChEMBL or PubChem name needs owner approval and
  a matching Hill formula; the tool does not resolve names.
- `--check` re-gates the committed files without the network and exits 1 when
  `featured.v1.json` or the landing data is stale; `--reuse` keeps committed
  XYZ files and fetches only new rows.
- The remote-URL policy trusts exactly
  `^/datasets/omol25/featured/omol25_nv_\d+\.xyz$` on the same origin (no query
  or hash), next to the edge structure route.

## Fixed LAMMPS research catalog

The research catalog contains eight intentionally selected
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) Zenodo assets. Every
entry pins a versioned record, exact file name, byte count, Zenodo's MD5,
an independently verified SHA-256, citation, DOI, license, parser warning, and coordinate/bond provenance.
Only these catalog paths can pass through the edge proxy.

| Dataset | Versioned source and file | Size | Pinned MD5 | Type semantics |
| --- | --- | ---: | --- | --- |
| Mg-pyrophosphate hydrolysis MD | [Zenodo 18044294](https://zenodo.org/records/18044294), `r_ppmg.lammpstrj` | 3,461,655 B | `2af811c29608677fc682564ae84f06ac` | Explicit source map: H, O, Mg, P |
| Semi-crystalline PLGA at 400 K | [Zenodo 13905472](https://zenodo.org/records/13905472), `plga_cryst_400K.dump` | 682,394 B | `d08c4a080130485b07b98ed3b17107bc` | Coarse-grained LA/GA beads; not elements |
| Amorphous PLGA at 400 K | [Zenodo 13905472](https://zenodo.org/records/13905472), `plga_amorph_400K.dump` | 682,716 B | `8129af0f68b51b9a09b5110ef91d4a31` | Coarse-grained LA/GA beads; not elements |
| Sodium-triflate water-in-salt electrolyte | [Zenodo 10548743](https://zenodo.org/records/10548743), `dataNP.lmp` | 349,598 B | `059c14998b7c6b62007dbc8872005157` | Explicit source map for C, F, S, O, Na, H |
| Ge-Sb-Te phase-change start | [Zenodo 12173540](https://zenodo.org/records/12173540), `GST_config.data` | 65,631 B | `07644cbfe1f3e17b0776e3b403a443c1` | Explicit Ge, Sb, Te map |
| Alpha-RDX thin film at 300 K | [Zenodo 4663415](https://zenodo.org/records/4663415), `RDX_NonReact_3xUnit_300K1atm.data` | 1,032,865 B | `d94851315f71f9c9934e5c49cf945c73` | Explicit source map for H, N, O, C |
| [001] ZnS nanopillar, 5 nm | [Zenodo 18716572](https://zenodo.org/records/18716572), `ZnS_nanopillar_001_5nm.data` | 499,770 B | `589b6f7266e75604686aac1dcfdae2a2` | Explicit Zn, S map |
| hBN Stone-Wales defect | [Zenodo 17050007](https://zenodo.org/records/17050007), `30sw-defect.dump` | 1,851,021 B | `a5fbe3432d63ffd78c3f6e84621907f4` | Explicit B, N map |

LAMMPS numeric type IDs are opaque identifiers, not atomic numbers. Lupi applies
an element map only when the catalog records an explicit source-derived map.
Coarse-grained bead classes remain pseudo-types and do not enable atomic bond
inference. Source coordinates stay labeled as source data; topology is labeled
`source-when-present` or `not-provided` per record.

The two PLGA sources additionally carry quaternion orientation and three
diameters for anisotropic ellipsoids. Lupi does not yet render that ellipsoid
geometry: it shows the source particle centers as spherical coarse-grained
beads and surfaces this approximation on the result cards before loading.

The related routes are:

- `/v1/datasets/research` for the manifest and full provenance.
- `/v1/datasets/research/:dataset/files/:exact-file` for an allowlisted asset.

The proxy rejects arbitrary upstream URLs, unknown files, query strings, and
upstream redirects. Before a body becomes immutable/cacheable it reads within
the pinned byte boundary and verifies the full SHA-256. It exposes that digest
in `X-Lupi-Content-Checksum` and Zenodo's record checksum in
`X-Lupi-Source-Checksum`, supports at most one valid byte range, and caps a
catalog asset at 16 MiB. The generic legacy text loader has an additional
stream-enforced 64 MiB ceiling even when `Content-Length` is absent. These
limits prevent a catalog entry from becoming an unbounded monolithic download.

## Local development

Run the edge Worker on port 8787 and Vite on the preview port in separate
terminals:

```powershell
pnpm --dir apps/mcp-worker exec wrangler dev --local --port 8787 --compatibility-date 2026-05-01
pnpm --dir apps/web exec vite --host 127.0.0.1 --port 5177
```

`apps/web/vite.config.ts` proxies only `/v1/datasets` to
`http://127.0.0.1:8787`, so browser development exercises the same edge contract
as production without CORS workarounds or bundled dataset copies. Override the
target with `VITE_DATA_EDGE_ORIGIN` when the Worker runs elsewhere. The
compatibility-date override above is for the currently bundled local workerd;
production continues to use the date pinned in `apps/mcp-worker/wrangler.toml`.
