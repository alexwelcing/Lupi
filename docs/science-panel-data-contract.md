# VIS-2B science panel data contract

Adopted from the parallel HUD-integration prototype (hermes t_1abe8048, web-integrator + reviewer); the standalone demo panel in this branch follows this mapping.


Status: implementation mapping for the Phase 0 prototype  
Canonical input schema: `lupine.visualization-bundle.v1`  
Canonical samples: the four reviewed VIS-2A golden manifests

This document maps the canonical Lupine visualization bundle to the Lupi science panel. It is a field contract, not a component design. The panel must consume a validated canonical manifest (or a versioned, fail-closed adapter result); it must not populate a hand-shaped fixture that can drift from the manifest.

## Scientific language and exclusion rules

1. Z1 frames are a **reaction-path sequence** of zero-based **NEB images**. A defined reaction coordinate may replace image index only when its definition and unit come from the bundle.
2. Never label an NEB image as time, trajectory time, elapsed time, temperature, kinetics, or dynamics. Playback is navigation through a reaction path, not physical time evolution.
3. `ThermoMinimap` is forbidden for this data. In particular, its fallback from missing `Temp` to the first numeric column can color image index as if it were temperature. Science-bundle navigation must use a dedicated zero-based NEB-image control.
4. Path-0 electronic diagnostics (SCF status, iterations/residual, gap, Fermi level, smearing/occupations, or spin policy) must be absent unless a separate diagnostic artifact and exact source pointer are bound. None of the four current golden bundles has an `electronic_diagnostics` field.
5. Missing and failed observations remain missing or failed. Do not interpolate them, connect a line through them, or convert a failed model into a zero-valued series.
6. Same-engine GPAW evidence is primary. Cross-engine GPAW-versus-VASP evidence is secondary and must display the T1 contamination verdict.

## Manifest identity and provenance mapping

| Panel concept | Canonical field(s) | Mapping rule |
| --- | --- | --- |
| Schema | `schema` | Accept `lupine.visualization-bundle.v1` only in this adapter. Unknown versions fail closed or route to a separately versioned adapter. |
| Campaign | `campaign_id` | Display verbatim. |
| Campaign revision | `campaign_version` | Display as a digest/revision, separate from the bundle revision. |
| Run | `run_id` | Display verbatim. |
| Path | `path_index`, `path_id` | `path_index` is the human campaign path number (0, 14, 16, or 27); `path_id` is the source material/path identity. Preserve both. Do not coerce `path_id` to a number. |
| Exact bundle revision | `bundle_id` | This is the canonical bundle identity: SHA-256 over canonical manifest content with `bundle_id` omitted while hashing. Display the full value or a clearly expandable abbreviation. It is not interchangeable with the SHA-256 of the serialized file, which includes `bundle_id`. |
| Run state | `status`, `retraction`, `supersedes` | Show non-complete, retracted, or superseded state prominently. A non-public partial record can remain inspectable but must not be presented as a publication-ready figure. |
| Source digests | `source_artifacts[]` | Do not flatten to one digest. Present each artifact's `id`, `role`, `uri`, `bytes`, `sha256`, `schema`, and `git_commit`; at minimum make the campaign, coordinate/VASP, dense-GPAW, and relevant model artifacts inspectable. |
| Quality | `quality.state`, `quality.checks`, `quality.warnings` | Display the state and checks. Warnings are explicit audit content, not console-only text. Keep `status` and `quality.state` distinct. |
| Citation | `provenance.citation`, `provenance.creators`, `provenance.organization`, `provenance.license`, `provenance.source_revision`, plus preregistration/amendment when present | Citation text/links must be sourced from this object. Do not synthesize a citation from a campaign digest alone. |

The current goldens bind these shared source artifacts:

- `data/candidates/z1-union-campaign.json`: campaign summary, 72,081 bytes, `sha256:af8a02ad5a663de2433b78917569af01f12a10f54ac8d94b33e934cfedc8a3f2`.
- `data/candidates/z1_nebdft2k_barriers.lock.json`: coordinates and VASP profiles, 4,021,811 bytes, `sha256:192fe54a5579cc421f6644d5d76fb442c6dfb985f014dc4741549e29052efb68`.
- `data/visualization/z1-golden-anchor-receipts.v1.json`: dense GPAW receipts, 16,074 bytes, `sha256:27de81269b3e04f156b34da7c302e03b6b2b88c19416b36a2a30ea3cc0c3142e`.
- Four float64 model artifacts at `data/candidates/z1/f64/raw/<model>/cell_result.json`, one each for `chgnet`, `mace-mp-medium`, `mace-mp-small`, and `mace-mpa-0-medium`. Each bundle records the exact byte count and SHA-256.

## Reaction-path and geometry mapping

| Panel concept | Canonical field(s) | Mapping rule |
| --- | --- | --- |
| Current image | `coordinates.frames[i].image_index` | Must equal zero-based `i`; show `NEB image i of n-1` or `NEB image i` plus total count. All adjacent HUD/scrubber readouts must use the same convention in science mode. |
| Reaction coordinate | `coordinates.reaction_coordinate.quantity`, `.definition`, `.unit`, `.values[i]` | The current goldens declare `neb_image_index`, unit `1`, values `[0..n-1]`, and explicitly say this is not time or temperature. A future arc-length coordinate is displayable only with its declared formula/definition and unit. |
| Frame count | `coordinates.frames.length` | Must match reaction-coordinate and every series cardinality. A mismatch is a load error, not a warning. |
| Geometry | `coordinates.frames[i].atoms`, `.lattice`, `.pbc` | Positions/species/cell/PBC are source-bound through `coordinates.source_artifact` and `coordinates.source_pointer`. Preserve stable atom order. |
| Units/conventions | `coordinates.units`, `.coordinate_system`, `.wrapped_convention`, `.unwrapped_convention` | Show wrapped/unwrapped state when relevant. The goldens contain source Cartesian Å coordinates and no unwrapped convention. Do not imply that the displayed wrapped sequence is an unwrapped migration path. |
| Migrating atom | `coordinates.migrating_atom_ids` | Treat as a derived annotation, not a source-authored label: the current builder selects the atom with largest endpoint minimum-image displacement. |

## Energy-series mapping

Each entry in `series[]` is independently identified by `id`, `quantity`, `engine`, optional `model`, `absolute`, `unit`, and `zero_convention`. The adapter must preserve those fields and map each `values[]` record by its explicit `image_index`.

The current golden series are:

- `vasp-reference`: VASP `potential_energy`, absolute eV, zero convention `none; absolute values retained`.
- `gpaw-dense`: GPAW `potential_energy`, absolute eV, the same no-zero convention.
- `model-<model>`: MLIP `potential_energy`, absolute eV, present only for models with `model_provenance.status == completed`.
- `gpaw-minus-vasp`: derived `engine_offset` in meV, zero convention/formula `E_GPAW(i) - E_VASP(i)`.

Every value record contributes `image_index`, `status`, nullable `value`, `source_pointer`, and `source_bindings[]`:

- `observed` requires a numeric value and resolvable source binding(s).
- `missing`, `failed`, and `not_evaluated` require `value: null` and must render explicitly.
- The derived offset has two bindings per image: the GPAW receipt and VASP reference value.

The panel may offer a derived relative-energy display, for example `1000 * (E(i) - min(E))` meV per series, but this is presentation state, not the canonical series. If used, label it explicitly as “display zero: this series' path minimum = 0 meV (derived),” retain access to absolute eV, and never replace or misreport the manifest's `zero_convention`. Scale chart coordinates to the finite range of the selected series; never clamp raw energy values to a fixed pixel range that collapses distinct profile points.

## Selection, extrema, guidance, and failure mapping

| Panel concept | Canonical field(s) | Mapping rule |
| --- | --- | --- |
| Rule and tie policy | `selection.rule_id`, `.rule_version`, `.tie_policy` | Display in the audit area. Current tie policy is `lowest_image_index`. |
| Per-model nominations | `selection.nominated_by_model[model]` | Draw nomination marks per model. Absence for a failed model is not an empty successful nomination. |
| Union anchors | `selection.union_model_anchor_indices` | Union of successful model nominations. A “union-only” mark is presentation-relative: for a selected model it means an index in the union but not that model's nomination set. Do not store or imply a global union-only category without naming the comparison model. |
| Evaluated anchors | `selection.evaluated_anchor_indices` | Draw filled evaluated marks. The four goldens are dense complete profiles, so every image is evaluated. |
| Dense extension | `selection.dense_extension_indices` | Exactly the evaluated indices not in the union. These are path 0 `[1,5]`, path 14 `[0,1,2,3,4,5,6]`, path 16 `[]`, and path 27 `[]`. `dense_extension_applied` records campaign process state; it does not mean every point—or any point—belongs to the extension. |
| Extrema/barrier | `selection.extrema[series_id]` | Map min/max image and value plus `barrier_ev`. The barrier-defining pair is `(min_image_index, max_image_index)` under the declared tie policy. Mark extrema on the corresponding series rather than only listing text. |
| Guidance | `selection.guidance[model]` | Display `missed_dense_extrema`, `guidance_deficit_mev`, and `dense_extrema_captured`. State the Z1 subset rule: exact same-engine recovery follows when the evaluated set contains both dense-profile extrema. |
| Model outcome/failure | `model_provenance[]` | `status`, `failure_reason`, `source_artifact`, `source_pointer`, and `anchor_rule` are authoritative. Failed models have no fabricated energy series. Keep the denominator from `quality_gates.denominator_policy`; path 14 must read as 0 successful guides of 4, not disappear from an average. |
| Same-engine result | `quality_gates.same_engine` | Primary result. Show per-model sparse/dense barriers, signed/absolute error, and verdict plus aggregate verdict. |
| Cross-engine result | `quality_gates.cross_engine` | Secondary result. Show signed dense-GPAW-versus-VASP error, interpretation, and clean/contaminated verdict. |

## T1 mapping

The per-image T1 diagnostic is the `gpaw-minus-vasp` series referenced by `quality_gates.t1.offset_series_id`. The panel must display:

- current-image offset from that series in meV;
- `offset_min_mev`, `offset_max_mev`, and optionally `offset_mean_mev`;
- `wander_mev = offset_max_mev - offset_min_mev`;
- `threshold_mev` (40 meV in the goldens);
- `verdict` (`clean` only when wander is at or below the threshold);
- `driver_pair`, the zero-based images of the minimum and maximum offsets, linked to geometry navigation.

Do not use the magnitude of the mean offset as the gate. Path 16 demonstrates why: its cross-engine barrier error is only 32.7296928566 meV, but its T1 wander is 117.271678515 meV, so the cross-engine result is contaminated.

## Warnings and visual-feature provenance

Two warning channels must remain distinct:

1. Bundle/scientific warnings come from `quality.warnings` and are always shown. The current warning is “NEB images are a reaction-path sequence, not equal-time dynamics.”
2. Parser/adapter warnings come from the validated load operation (for example, a supported optional field omitted from the panel). They must identify the field/pointer and adapter version. Digest mismatch, schema failure, non-finite values, frame/series misalignment, bad atom identity/order, or bad source pointers are fatal load errors and must not be downgraded to warnings.

The panel's “source vs inferred” audit is constructed as follows:

| Visual feature | Classification | Reason/source |
| --- | --- | --- |
| Atom species, wrapped Cartesian positions, lattice, and PBC | Source-bound | `coordinates` points to the coordinate panel; the validator verifies exact equality. |
| VASP, GPAW, and successful-model energy samples | Source-bound observations | Every observed value has artifact/JSON-pointer bindings. |
| GPAW-minus-VASP offsets, extrema, barriers, anchor unions/extensions, guidance deficits, same-engine results, and T1 statistics | Derived from source-bound arrays | They are deterministic and validator-recomputable; label them derived rather than raw observations. |
| Stable IDs such as `atom-0000` | Derived identity | Assigned deterministically from source atom order by the converter. |
| Migrating-atom highlight | Inferred/derived annotation | Current converter chooses the largest endpoint minimum-image displacement. |
| Bonds/coordination graphics | Inferred unless separately bound | No source topology is present in the goldens. If bonds are drawn using viewer heuristics, label them inferred; do not use them as quantitative mechanism evidence. |
| Unwrapped motion | Absent | `unwrapped_convention` is null in the goldens. Do not claim unwrapped coordinates. |
| Electronic diagnostics | Absent | No separately bound diagnostic artifact/field exists, especially for path 0. |
| Temperature/kinetics/time | Forbidden inference | The bundle supplies none of these quantities. |

## Four golden roles and available data

The canonical repository-relative manifests are:

| Role | Manifest | Expected panel evidence |
| --- | --- | --- |
| Large-wander mechanism | `data/visualization/z1-golden/path-0.visualization-bundle.json` | 7 images; path ID `mp-761269_2_1_1_-1_0`; bundle ID `sha256:85ab92ff6f2dc3aebf8dd8c5642d5173a84c96ebaeeaefc2f7ad1555230a24ec`; dense extension `[1,5]`; all four guides completed and same-engine `strong_win`; T1 contaminated with 4212.33092634 meV wander and driver pair `[0,3]`; cross-engine error 4212.26030045 meV. Electronic diagnostics are absent. |
| All guides failed / dense completion | `data/visualization/z1-golden/path-14.visualization-bundle.json` | 7 images; path ID `mp-756912_1_1_1_0_0`; bundle ID `sha256:d2b2932287d1995534fabba7316e7a8f8b09aab67b1d82057cb9451898566f10`; all four `model_provenance` records are `failed` with “CI-NEB did not converge under the frozen protocol”; no model series, nominations, or guidance entries; union `[]`; dense extension is all images; same-engine verdict `not_applicable` with a 0-of-4 denominator; T1 contaminated with 4542.38853759 meV wander and driver pair `[0,4]`. |
| Apparently successful but contaminated | `data/visualization/z1-golden/path-16.visualization-bundle.json` | 5 images; path ID `mp-760344_10_4_0_1_0`; bundle ID `sha256:c3ef7c66c57542b488e0ad1362fcdb4d160ccd96e9f4732a5135c77c096eb81c`; all four guides completed, full union, no dense-extension indices, same-engine `strong_win`; cross-engine error 32.7296928566 meV but T1 contaminated with 117.271678515 meV wander and driver pair `[1,3]`. |
| Sole T1-clean path | `data/visualization/z1-golden/path-27.visualization-bundle.json` | 5 images; path ID `mp-752552_0_7_0_0_1`; bundle ID `sha256:365c03cac0ea5ccd19f28e39f2b20f63aa50e57d7cc25935d523f4bf54f67dd0`; all four guides completed, full union, no dense-extension indices, same-engine `strong_win`; T1 clean with 33.4682497736 meV wander, driver pair `[2,0]`, and cross-engine error -33.4000753630 meV. |

Sample-data confirmation (rebuilt from lupine-rhizo after the checkout-independent URI fix in PR #102):

- All four canonical manifests are present and parse as `lupine.visualization-bundle.v1`.
- Serialized manifest sizes/file SHA-256 values are: path 0 — 130,768 bytes / `42c856fe737059ff389443ac6bda5b3604cc735196aaba4b16d45a9a9fa32bc3`; path 14 — 100,943 / `016d2f55b134ef7b94640a56a5bd9146202f3e0289203e321cc314d86ba067db`; path 16 — 68,467 / `22766c56417b9002e03668c65c53bdda5cb3b725946aef5af66105773708b8cf`; path 27 — 86,573 / `21c1e96c92588a592c52d7be0f42af377279b15c6a5bf350481d4e5f5ea0418a`.
- The schema and shared dense-GPAW receipt file are present alongside them. VIS-2A reported 4/4 validator success and byte-identical independent builds; VIS-2B should still validate at its own load boundary rather than trusting filenames or prior test results.
- These exact canonical bytes are vendored under `packages/ui/src/science/canonical-bundles/`; the Lupi adapter verifies their serialized manifest digests, embedded bundle IDs, source assets, and schema before projection. It never falls back to the older hand-authored `goldenSciencePanelFixtures.ts` data.
