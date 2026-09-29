# v10 baseline brief for ideators and judges

2026-09-27. Owner decision: **"Assume we are upgrading to v10 alpha for R3F."** Ideate as if the upgrade is done; score knowing its cost and what stays unproven. Sources: `v10-status.md` [ST] (live npm and probes), `v10-migration.md` [MIG], `v10-unlocks.md` [UNL], `00-fact-sheet.md` [FS]. Where [MIG] and [ST] disagree, this brief follows [ST], the later live check.

Backend tags used throughout:
- **[GPU]**: runs only on the real WebGPU backend.
- **[GPU+GL2]**: also runs on `WebGPURenderer`'s WebGL2 backend.
- **[GL2-degraded]**: runs on the WebGL2 backend, but slower or with less.

---

## 1. What the baseline now is

| Layer | Baseline | Status |
|---|---|---|
| `@react-three/fiber` | `10.0.0-canary.14007b4` (2026-09-26), pinned exactly; move to alpha.6 when it is published. **Not alpha.5**, whose `/legacy` entry and browser bundle fail (#3921) [ST]. | Alpha. No beta and no ETA; the v10 milestone is 87% done. |
| `@react-three/tsl` | The same canary hash as fiber. Its `latest` dist-tag points at a stale first canary. | Created 2026-09-26. The TSL hooks moved here 18 days after alpha.5. |
| `@react-three/test-renderer` | The same hash; `/webgpu` entry. | Alpha |
| three / `@types/three` | 0.186.1 exact now. **r187 (due 2026-10-21) is the shipping floor**, because it fixes the WebGL2-fallback GL leak (#34597). | Stable. r187's cube-RT PMREMs break today's CubeUV code, which the TSL port deletes anyway. |
| drei | 11.0.0-alpha.7 (2026-09-05). It was built against fiber alpha.4 and three 0.185.1. | Stale alpha. 144 components, of which **1** has a real test. |
| React / react-dom | `~19.2.4` via `pnpm.overrides` | 19.3.0 (npm `latest`) breaks v10's `<19.3` peer. |
| Frame loop | `@pmndrs/scheduler` 0.2.0: phases, `before`/`after`, per-job `fps`, per-root `frameloop`, `onIdle`. | **No fixed timestep.** Numeric priorities are shimmed but run in **reverse order** (only a generic deprecation warning, no error). |
| Renderer | `WebGPURenderer` from an async `<Canvas renderer>` factory that requests `requiredLimits` (`maxBufferSize`, `maxStorageBuffersInVertexStage`). With no adapter it falls back to `forceWebGL`. `state.webGPUSupported` is the gate. | ~87% global WebGPU support, so **~13% land on the WebGL2 backend** (iOS <26, older Android, Firefox on Android and Linux). |
| Post | TSL `RenderPipeline` through `useRenderPipeline` (GTAO/SSAO, bloom, DOF, output tone map, vignette). | Pass ownership is an open RFC (#3864). |
| Removed | `@react-three/postprocessing` (two copies), `postprocessing`, `n8ao`, `r3f-perf` | All WebGL-only. |
| Kept at risk | `@react-three/xr` 6.6.30 | **Known broken under v10**: `XRFrame` is dropped (§4). |
| Optional adds | `@pmndrs/glyph` 0.1.0, `@pmndrs/sky` 0.3.0, `@pmndrs/upscaler` 0.2.0 (WebGPU only) | All pre-1.0. |
| vgpu | Stays at 0.4.0 (0.5.0 breaks the texture API). `initFromDevice` can adopt R3F's device. | Sharing the device end to end is **UNVERIFIED**. |

**Still open or unverified (don't build a pitch on these):** early-Z loss for impostors (WGSL has no conservative depth); iPhone Safari accepting `maxStorageBuffersInVertexStage`; motion vectors for GPU-displaced atoms; multi-canvas on the WebGL2 backend (assume absent; #3965 misdraws); `VideoFrame`/`toBlob` from a WebGPU canvas on Safari; the renderer leak on unmount (#3926) and stale DPR (#3958), fixed only in PRs. **No real-device FPS or thermal data exists for any Lupi surface.**

---

## 2. What the upgrade requires

Sizes are engineer-weeks for one engineer who knows the codebase [MIG §9]. Total: **~2 wk Phase 0 (on v9) + 1-wk gate spike + 13–20 wk Phase 1 (parity)**, roughly 4–5 months before any v10-native feature ships.

| # | Requirement | Size | Risk | Is it also an opportunity? |
|---|---|---|---|---|
| R1 | Pins and cleanup: React override, canary hash triplet, three exact, drop rpp, postprocessing, n8ao, r3f-perf | ~2 d | Low | Minor: drops drei 9 / zustand 4; `StatsGl` or `<Inspector>` replace r3f-perf. |
| R2 | **Atom attribute repack.** r186 WebGPU rejects itemSize-1 u8/u16 attributes. Pack them into `unorm8x4`. CI can't catch this, because it runs `--disable-webgpu`. | ~2 d | Blocker | **Yes.** Type, prop and occlusion use 3 bytes, so the 4th byte is free for a per-atom flag (glow, selected, hovered). *(inference)* |
| R3 | **Atom impostor TSL port** (515 GLSL lines): `positionNode`, `depthNode`, `pmremTexture` IBL, tiers, etch, ortho, sub-pixel cull | **XL**, 2.5–3.5 wk | **High.** No early-Z; 256 MiB default buffer (~22M atoms against a 50M ceiling); no reference impostor example exists. | **The big one.** The same rewrite can add a display-offset buffer (poke, jiggle, morph), a glow MRT channel (selective bloom), a sphere normal (AO shades spheres, not cards) and `positionPrevious` velocity (TRAA), for a fraction of a later retrofit. |
| R4 | Bond TSL port (283 lines) | L, 1–1.5 wk | Medium | **Yes.** A `uvec2` atom-pair attribute lets bonds follow atom offsets; bond compute can write instance buffers on the renderer's device, with no CPU readback. |
| R5 | Six smaller materials: clusters, vector glyphs, billion-atom block, procedural sky, panorama dome, filter shell | 1.5–2 wk | Low–medium | **Yes.** The sky reads the mood uniforms; the filter shell gets OIT; the dome becomes `<Canvas background>`. |
| R6 | Post stack becomes one `useRenderPipeline` and is re-tuned | 1.5–2 wk | Medium. The N8AO look and `BlendFunction` variety are lost. | **Yes.** Selective bloom, outline, transition wipes, style skins, half-res SSAO and `fsr1` all land in the same graph. |
| R7 | Scheduler: ExportManager's `-0.5/2/100` priorities become phases (~3 d state machine in Phase 0); replace GizmoHelper (bypasses the pipeline); `clock` → `elapsed` | 0.5–1 wk | **High if skipped**: reversed order breaks capture and video without an error. | **Yes.** `demand` frameloop, one loop instead of five RAFs, labels at 20 fps. |
| R8 | Labels: `<LupiText>` shim over glyph or canvas sprites (10 JSX sites) | 1–2 wk | Medium: glyph is 2 weeks old; baked `.font.glb` plus Wasm. | **Yes.** Glyph's `breakApart()`/`split()` gives shatterable labels. |
| R9 | **Export V2**: render-target readback, new fingerprint, two execution classes, contract and AGENTS.md rewrite, baselines ×2 | 2–3 wk | **High**: every byte and `artifactKey` changes. | Partly: fixed-size output and frame-stepped `advance()` make share cards and exact loops cheap, as illustrative output only. |
| R10 | XR decision: fork, separate v9 bundle, or defer | 0.5 wk (defer) to 3–4 wk (fork) | **Highest** | No |
| R11 | CI: a WebGPU SwiftShader lane plus the fallback lane; rewrite 5 GLSL-string tests | 1–1.5 wk | Medium | Yes. It is the fallback smoke test every toy needs anyway. |
| R12 | Mechanical: 14 `gl` accesses, `three/webgpu` PMREM, `getMaxAnisotropy`, `renderer.xr.getFrame()`, capability gate (WebGL1 no longer suffices) | inside the 1.5–2 wk platform swap | Low | The renderer factory makes **one `GPUDevice`** for gist, bonds and Studio. |

**Gate:** before Phase 1, port only the atom impostor to a sandbox route for a week. Measure early-Z loss at 1M–5M atoms on a phone and a laptop, the iOS <26 fallback, and `maxBufferSize`. If it's bad, large-scene tiers keep a depth-prepass or compute-culled variant.

---

## 3. What becomes cheap or newly possible (ranked)

Ranked by payoff multiplied by device reach. Everything assumes R3 (the impostor port) is done.

| Rank | Capability | Payoff | On the WebGL2 backend |
|---|---|---|---|
| 1 | **Scheduler + `frameloop="demand"` + per-job `fps` + `onIdle`** | Perf: the idle viewer stops rendering every frame; one loop replaces five; attract mode on idle. | Works (renderer-agnostic) |
| 2 | **Mood uniform bus** (`configureTSL` + `useUniforms`) | Fun: Looks and Remix tween instead of snapping; tap pulse, warmth and tilt reach every material, post and particles with no recompile. | Works |
| 3 | **GPU-resident atoms + display-offset compute** (`useBuffers` → `positionNode`) | Fun: poke, thermal jiggle, explode and reassemble on switch, and curl "melt" on 100k+ atoms, with zero CPU copies. | [GL2-degraded]: simple kernels via transform feedback, lower counts, no atomics |
| 4 | **`useRenderPipeline` + MRT** | Visual: per-element glow from the palette, hover outline, molecule-switch `transition()` wipes, `afterImage` trails, blueprint and halftone skins. | Fullscreen passes are expected to work; this is UNVERIFIED node by node |
| 5 | **Phone-grade post**: `ssao()` at half resolution + `fsr1()` at a render scale of 0.6–0.75 + an `UnsignedByte` output buffer | Perf and visual: phones could regain AO and bloom (mobile has none today). | `fsr1` works but gives no speed-up; `@pmndrs/upscaler` is absent |
| 6 | **GPU ID picking**: an ID MRT and a 1-pixel `readRenderTargetPixelsAsync` | Perf: replaces the allocating CPU ray-march; hover and poke stay cheap up to 5M atoms. | Works |
| 7 | **Gist particles in the main canvas** (TSL compute) with pointer forces | Fun: SwitchStage's "type a thing" particles become touchable, on the viewer's loop and device. | A TSL port runs *(inference)*; the vgpu WGSL path is [GPU] |
| 8 | **Events**: `onOccluded`, per-pointer `pointerMap`, `interactivePriority`, drag-and-drop onto meshes | Fun: "find the buried atom", two-finger measure, "stretch the bond", chips that win taps, element chips dropped onto atoms (desktop). | Mostly works (`onOccluded` via GL2 queries, *inference*); finger drag-and-drop unreliable everywhere |
| 9 | **Fixed-size output + `useRenderTarget` in core** | Fun and share: share cards and frame-exact loops without resizing the live view. | Works |
| 10 | **Glyph labels with break-apart** | Visual and fun: crisp MSDF labels, element symbols that shatter into particles and re-form. | Works |
| 11 | **OIT** (`oitPass`) | Visual: candy or glass atoms and a filter shell that never pop while rotating. | No MSAA |
| 12 | **GPU Studio folded into the main canvas** as a Look | Product: one surface instead of a modal; one fewer device. | Only if its 54 WGSL lines are ported to TSL; otherwise [GPU] |
| 13 | **TRAA / TAAU** | Visual: clean impostor edges without MSAA. | Likely works, but **needs impostor velocity (UNVERIFIED)** |
| 14 | **Multi-canvas on one renderer** | Fun: live spinning thumbnails, picture-in-picture, "vs water" split compare, a legend strip of real lit atoms. | **Absent.** Fall back to drei `<View>` or static previews |
| 15 | **`GaussianSplat`** | Fun: `/scan` reconstructions shown as soft 3D ghosts next to "their" molecules. | CPU sort, fewer splats |
| 16 | **[GPU]-only tier**: `Storage3DTexture` electron-cloud fog, VXGI beauty shot, `ClusteredLighting` "firefly mode", `CountingSort` + atomics (Particle Life, sticky atoms), `@pmndrs/upscaler`, SSGI | Visual peak on desktop and flagships. | Absent; each needs a stated degrade (CPU-baked `Data3DTexture`, ≤4 lights plus bloom). |

---

## 4. What becomes harder or is lost

| Loss or hardship | Consequence | Mitigation |
|---|---|---|
| **vanruesc `postprocessing` / rpp** | N8AO's look, `BlendFunction` variety, `DepthPicking` and `EffectGroup` are gone; presets need re-tuning; no synchronous depth under the cursor. | TSL `ao`/`ssao`, `bloom`, `dof`; 1-pixel async depth read for tap-to-focus. |
| **troika `Text`** | 10 label sites break on WebGPU. | The `<LupiText>` shim: glyph first, canvas sprites as fallback (always in the XR panel). |
| **XR** | `XRFrame` dropped; negative priorities run last; pmndrs/xr pointers use `onBeforeCompile`; `XREstimatedLight` is WebGL-only; WebGPU XR needs flagged `XRGPUBinding` or a renderer swap R3F can't express. | Decide up front: defer immersive XR (iPhone AR stays on USDZ Quick Look), or remount with `forceWebGL` plus a fork (3–4 wk). |
| **Export determinism** | V1 can't carry over: no `preserveDrawingBuffer` on either backend; HalfFloat linear plus an output pass changes pixels; two execution classes; thumbnails come back blank. `specId` survives; `rendererFingerprint`, `artifactKey` and digests change. | A V2 profile with render-target readback. The edge Worker's `awaiting_renderer` validation is unaffected; AGENTS.md's "V1 truth" must be rewritten. |
| **Impostor performance** | No early-Z; 256 MiB default buffers; slow material init (#33821) and UBO cost (#30560) slow Look switches and many-mesh overlays. | Sub-pixel cull, depth prepass, compute culling; requested limits; the gate spike. |
| **The WebGL2 fallback is second-class** | GL leak on material or scene churn until r187; multi-canvas misdraws; transform-feedback compute; **silent failures**. | Ship on r187; `state.webGPUSupported` gating; dual CI lanes; validated-frame advertising. |
| **Alpha churn** | Hooks moved packages; dist-tag trap; `useRenderPipeline` RFC; drei 11 has 1 real test; `GizmoHelper`, `Outlines`, `PointMaterial` broken; gain-map `Environment` throws. | Pin exact hashes; wrap TSL hooks in one Lupi module; runtime-verify each drei component used. |
| **Ecosystem gaps** | `@react-three/rapier` is incompatible, `uikit` is WebGL-only (`onBeforeCompile`), and `@react-three/handle` is unverified. | Hand-written physics: an accumulator in the `physics` phase plus TSL kernels. |
| **Mobile bandwidth** | The HalfFloat framebuffer, output pass and pipeline targets cost more on tile GPUs *(inference)*. | Use `outputBufferType: UnsignedByteType` on mobile; measure on real devices. |
| **Canvas `background` / drei presets** | They fetch HDRs from githack. | Self-host (the "no external textures" rule). |

---

## 5. How this changes the product rules and assumptions

- **GPU Studio no longer needs to be a separate modal.** Its snowglobe (`MeshPhysicalNodeMaterial` spheres with a vgpu `colorNode`) drops into the main scene as a Look, removing the second device, the separate RAF and the `paused` frameloop dance. It stays [GPU] unless its WGSL is ported to TSL; "refuses the fallback" becomes "degrades to the non-Studio look".
- **The 5k Studio cap may lift, unproven.** It stems from a separate device, CPU `setMatrixAt` matrices and real sphere geometry. On the TSL impostor with GPU buffers, a Studio look could plausibly reach 25k or beyond *(inference)*. Ideas may assume "tens of thousands", not "millions", until the gate spike reports.
- **"Lazy-load WebGPU and fail soft" is re-scoped.** The WebGPU vendor chunk (~176 KB gzipped) becomes mandatory for the viewer, and the main path must render on both backends. Only [GPU] extras keep the old rule: advertise after `state.webGPUSupported` plus a validated frame.
- **"WebGPU-only" ideas that now apply to the main viewer** (both backends, some degraded): compute atom play, gist particles in SwitchStage, the mood bus, TSL post, OIT, glyph labels, GPU picking. Still [GPU]: vgpu WGSL, atomics and binning, storage textures, multi-canvas, `@pmndrs/upscaler`, clustered lights.
- **Mobile post rule ("no AO, Bloom or DOF; MSAA ≤2")** becomes a *candidate* for relaxation (half-res SSAO, render-scale plus `fsr1`, bloom masks), but holds until device data exists.
- **Idle rendering: `demand` becomes the default.** Continuous motion must justify an `always` job or use an analytic settle time. Reduced motion gets easier: one `invalidate()` per action gives a still frame per action.
- **"Display-only inertia. Source atoms never move."** This becomes *structurally enforceable*: the base buffer is uploaded once, and play writes only an offset buffer. Illustrative labelling is still required, and more motion means more labelling.
- **Deterministic export excludes the fun layer.** Mood, offsets, post and skins remain outside the artifact (V2 or V1). Share cards and videos are illustrative outputs, not MCP artifacts.
- **The zero-canvas home rule is unchanged and now blocks live thumbnails on home.** Secondaries need an existing primary canvas, so the landing's 48-tile `MoleculeWall` stays static; live thumbnails, picture-in-picture and split compare are viewer-route features (the in-viewer switcher qualifies). The scheduler's ambient root adds no canvas but would pull fiber into the landing chunk, so don't propose it for `/`. "No GPU decoration on home" still stands.
- **Five GPU devices can become one** on the WebGPU backend (viewer, Studio, gist, bonds); action-light stays separate. Ideas that coordinate these surfaces get cheaper.
- **XR ideas are frozen** until the XR decision is made.

---

## 6. Re-scoring guidance for judges

**Adjust effort and risk scores with these multipliers:**
- **+1 "rides the port":** it lands inside a mandatory rewrite (R2–R8): offsets in the impostor shader, a glow byte in the repack, bond pairs, bloom and wipes in the pipeline, shatter labels in the text shim.
- **+1 "uniform, not material":** it is expressed as mood-bus values or TSL `select()` branches, so there are no recompiles and it works on both backends.
- **+1 "calmer and cheaper":** it uses `demand`, `onIdle`, per-job `fps` or GPU picking, and saves battery.
- **0:** renderer-agnostic DOM or CPU ideas (`math/time` springs, seeded Remix). They can ship on v9 today; don't penalise them.
- **−1 "[GPU] without a degrade path":** multi-canvas, atomics, storage textures, the upscaler or clustered lights with no stated fallback for the ~13% on WebGL2.
- **−1 "temporal on moving atoms":** TRAA, TAAU or motion blur on GPU-displaced atoms before velocity is proven.
- **−1 "dense beauty":** multi-million-atom looks that assume WebGL early-Z performance.
- **−2 "blocked stack":** it depends on vanruesc effects, troika, rapier, uikit, r3f-perf, drei `Outlines`/`PointMaterial`, `DepthPicking`, or **new GLSL / `onBeforeCompile`** (throwaway work).
- **−2 "XR or deterministic export":** it needs immersive XR or byte-stable artifacts to work.
- **Disqualify:** live 3D or canvases on `/`, or motion that moves source atoms.

**Timing.** Anything needing R3 or R6 ships after roughly 4–5 months of parity work; score delivery dates honestly. Prefer ideas with a v9-shippable slice, unless that slice is GLSL the port would discard.

**Every idea should now state:** its backend tag; its WebGL2-fallback behaviour; the requirement (R#) it depends on or rides; that it stays outside deterministic export; and a phone budget with no FPS claims (none are measured).
