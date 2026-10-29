# Research Payloads, Vector/Energy Views, Export Scaling, AR Grab

## What we asked

Support real research payloads from LAMMPS — not just showcase molecules —
using [MaginnGroup/Validation-of-HFC-FFs](https://github.com/MaginnGroup/Validation-of-HFC-FFs)
as the reference workload. Deliver (1) a visualization type beyond
ball-and-stick that shows energy and forces, (2) reliable replay of output
files plus a curated LAMMPS results collection, (3) an export system that
scales to any molecule size, and (4) grab-the-molecule-with-your-hand AR
manipulation.

## What a real research payload looks like

The HFC study's artifacts (and what now happens when you drop them on Lupi):

| artifact | dialect | before | now |
| --- | --- | --- | --- |
| `R32_v52_2000mol.data` | atom_style full topology, Masses w/ `# c3` labels, Bonds | atoms colored as H/He/Li (type ids read as elements), comments corrupted token counts | correct C/F/H chemistry via mass→element remap, `q`/`mol`/`type_id` properties, 8000 file bonds, Velocities → `vx/vy/vz`, triclinic tilt |
| `dump ... id type x y z vx vy vz fx fy fz c_pe c_ke` | custom dump | extra columns parsed but only usable as raw scalars | vector fields detected → force/velocity arrows; `\|F\|`/`\|v\|` derived for energy-style coloring; survives `.glimbin` streaming |
| `Output_*.txt` | `fix print` thermo table | parsed via log fallback | loads as thermo (sparklines, temperature timeline) alongside the structure |
| `temp_profile.*`, `velocity_profile.*` | `fix ave/chunk` | unsupported | parsed (`parseChunkProfile`), replayed as an animated spatial-profile chart synced to playback |

## The four deliverables

### 1. Force & energy visualization (beyond ball-and-stick)

- `<VectorGlyphs />` (packages/scene): one camera-facing ribbon-impostor
  arrow per atom for any detected per-atom vector triplet (`fx/fy/fz`,
  `vx/vy/vz`, `mux/muy/muz`, compute outputs, bracket triplets). Instanced
  (2 tris/glyph), GPU cross-frame interpolation identical to the atom
  impostors, PBC-aware targets, p95 auto-scale so outlier forces don't
  flatten the field, magnitude → colormap.
- Vector-field detection + magnitude derivation live in `@atlas/core`
  (`detectVectorFields`, `ensureVectorMagnitude`) so the controls, scene,
  and export all share one contract; derived `|F|`/`|v|` land in
  `frame.properties` and drive the existing property-coloring path (energy
  heat maps via `c_peatom` etc. work the same way).
- New "Vectors" section in Molecule controls (field / length / density) and
  a colormap legend HUD with numeric bounds for both scalar coloring and
  vector magnitude. All of it round-trips through the `?s=` share URL.

### 2. Reliable output-file replay + curated collection

- `fix ave/chunk` profiles parse and replay in the Telemetry panel — the
  current snapshot as an accented line over the all-time envelope, selected
  by timestep match against the playing trajectory (proportional fallback
  for cross-run replay).
- Dropping output tables alongside (or after) a structure attaches them
  without resetting the scene; large streamable dumps dropped on the landing
  page now use the worker transcode path (progressive frame-0 paint, OPFS
  `.glimbin`, frames fetched on demand) instead of an in-memory parse.
- Curated collection at `apps/web/public/gallery/research/hfc/` — R32
  (10,000 atoms × 61 frames) and R125 (8,000 atoms × 31 frames) NVT 273 K
  runs with the study's published force fields, streamed as `.glimbin` with
  the full per-atom research payload plus thermo + temperature-profile
  sidecars and provenance manifests (paper DOI 10.1039/D5DD00537J).
  Regenerate from scratch with `python3 tools/sims/make_hfc_trajectories.py all`
  (fetches the upstream inputs, runs genuine LAMMPS, writes manifests).

### 3. Export scaling

- Export-scene construction moved to a pure module
  (`packages/ui/src/export/exportSceneBuilder.ts`) — bond detection now
  reuses the live viewer's spatial-hash detector in x-sorted slabs with a
  halo (set-identical to a whole-frame run, unit-tested), replacing the
  O(N²) loop and its silent 50k-atom gate; scratch-object matrix fill and
  event-loop yields keep the UI responsive; sphere LOD adapts to atom count.
- GLB keeps `EXT_mesh_gpu_instancing` (geometry once + 52 B/atom).
  Measured by `node tools/verify-exports.mjs`: 10k atoms 0.16 s / 0.85 MB,
  100k 1.13 s / 8.4 MB, 500k 5.96 s / 41.8 MB with 343k bonds.
- USDZ no longer explodes instances into per-atom `Mesh` objects (the old
  path OOMed near 1M atoms); it bakes each InstancedMesh into one merged
  indexed geometry with a palette texture, chunked with yields, within a
  ~3M-triangle budget. GLB/USDZ report progress through
  `ExportRequest.onProgress` and the export buttons show it.

### 4. AR hand manipulation

- One-hand pinch-grab is now a rigid hold: the molecule rotates with your
  wrist about the grab point (smoothed, frame-rate independent).
- A second pinch enters two-hand grab — scale from hand separation
  (0.25×–4×), rotation from the inter-hand axis plus wrist-roll twist,
  translation from the midpoint; releasing either hand hands off cleanly.
- Release carries linear and angular momentum into the existing throw
  physics; controllers grab via the squeeze/grip button with the same code
  path; pure math in `xr/grabMath.ts` (unit-tested).
- "View in AR" / "Enter VR" buttons now exist in the production UI (they
  were previously reachable only from the dev testbed), rendered only where
  WebXR reports support — including headset browsers that identify as mobile.
- Manual QA checklist for Quest 3 in the PR/commit body (grab, wrist
  rotation, two-hand zoom, hand-off, throw, controllers, tracking loss).

## Verification

- `pnpm build` (turbo, 9/9) and `pnpm test` (14/14 tasks; ui 189 tests,
  parsers 68, core 46, scene 38, nist 16) green; `cargo test` 18/18.
- `node tools/verify-exports.mjs` — the scaling numbers above.
- Playwright drive of the built app (see `.verify-artifacts` when run
  locally): loads both curated entries via `?sim=`, streams 61 frames,
  force/velocity arrows + legends render, per-atom PE coloring renders,
  profile replay animates in the Telemetry panel, and the genuine
  `R32_v52_2000mol.data` drops in with correct chemistry
  (types [1,6,9], `q`/`mol`/`type_id`, 8000 bonds).
- Note for headless verification environments: drei's `<Environment>`
  preset HDRI and Google Fonts come from external CDNs; stub or block them
  (see the harness) or the app suspends behind the splash.
