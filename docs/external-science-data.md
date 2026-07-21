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

| Lupi collection | Public repository | Indexed rows | Coverage shown in the UI |
| --- | --- | ---: | --- |
| `neutral-train` | `colabfit/OMol25_train_neutral` | 34,335,828 | Complete public neutral training split |
| `neutral-validation` | `colabfit/OMol25_neutral_validation` | 27,697 | Complete public neutral validation split |
| `all-train-preview` | `colabfit/OMol25_train` | 841,736 of an estimated 65,331,709 | Indexed preview |
| `train-4m-preview` | `colabfit/OMol25_train_4M` | 1,000,000 of an estimated 2,657,915 | Indexed preview |
| `validation-preview` | `colabfit/OMol25_validation` | 800,000 of an estimated 1,842,258 | Indexed preview |

OMol25 supplies atomic numbers and source coordinates. It does **not** supply
source bond topology in this browsing path. Bonds that Lupi draws are a viewer
inference for display and must not be presented as dataset truth.

### Edge routes

All routes accept `GET` and `HEAD`:

- `/v1/datasets/omol25` returns coverage, attribution, and collection URLs.
- `/v1/datasets/omol25/:collection/rows?offset=0&limit=24` returns compact row
  metadata. Add either `query=...` or an exact `formula=...`, never both.
- `/v1/datasets/omol25/:collection/structures/:row.xyz` materializes one XYZ
  file from the selected source row. Its comment and response headers preserve
  coordinate and bond-topology provenance.

Rows are streamed from Hugging Face rather than copied into Lupi. A page is
limited to 36 rows and a synthesized XYZ to 1,000 atoms. When a Hugging Face
search/filter index is still warming, the edge returns `202`, `Retry-After: 15`,
and an explicit `warming` state; it does not silently substitute a different
result set.

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
