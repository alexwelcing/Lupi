# Lupi core viewer: render path, hand-rolled math, perf hotspots, upgrade hooks

Research digest, 2026-09-27. I read the code only and changed nothing in the repo. Paths are relative to `/home/user/Lupi`. I checked external facts against the npm registry and against the published tarballs of `math@0.1.0`, `@react-three/fiber@10.0.0-alpha.5`, `@pmndrs/scheduler@0.2.0`, `postprocessing@6.38.3`, `n8ao@1.10.1` and `@react-three/drei@10.7.9`. Anything I could not verify is marked UNVERIFIED.

---

## 0. Versions (declared vs. locked vs. latest)

| Package | Declared (package.json) | Locked (pnpm-lock.yaml) | Latest on npm (2026-09-27) |
|---|---|---|---|
| three | ^0.184.0 | 0.184.0 | 0.186.1 (2026-09-24) |
| @react-three/fiber | ^9.6.0 (ui/scene), ^9.6.1 (web) | 9.6.1 | 9.8.1 (2026-09-24); `alpha` = 10.0.0-alpha.5 (2026-09-08); canary 10.0.0-canary.* published daily |
| @react-three/drei | ^10.0.0 / ^10.7.7 | 10.7.7 | 10.7.9 (2026-09-25); `alpha` = 11.0.0-alpha.7 |
| @react-three/postprocessing | ^3.0.0 (ui), ^2.16.0 (apps/web) | 3.0.4 and 2.19.1 (two copies) | 3.1.3 (2026-09-27) |
| postprocessing | ^6.36.0 | 6.38.3 | 6.39.5; `beta` = 7.0.0-beta.16 |
| n8ao / maath / camera-controls / three-mesh-bvh | transitive | 1.10.1 / 0.10.8 / 3.1.2 / 0.8.3 | not checked |
| vgpu | direct (ui) | 0.4.0 | not checked |
| math (pmndrs) | **not a dependency** | none | 0.1.0 (2026-09-11), canary 2026-09-27, MIT |

Notes:
- R3F 10.0.0-alpha.5 has `peerDependencies.three >= 0.185.0`. Adopting v10 therefore also means bumping three off 0.184.
- The alpha's exports are `.`, `./legacy` and `./webgpu`. It depends on `@pmndrs/scheduler ^0.2.0`.
- No source file imports `maath`, `camera-controls` or `three-mesh-bvh` directly. They arrive through drei.
- Drei helpers actually in use: `Text`, `Billboard`, `OrbitControls`, `Html`, `ContactShadows`, `useEnvironment`, `Environment`, `RoundedBox`, `MeshTransmissionMaterial`, `Line`, `Grid`, `GizmoHelper`/`GizmoViewport`.
- Postprocessing effects in use: `EffectComposer`, `N8AO`, `Bloom`, `ToneMapping`, `Vignette`, `DepthOfField` (`packages/ui/src/postprocess/ScenePostprocessing.tsx:15`).

---

## 1. Render-path architecture

### 1.1 Canvas, frameloop, DPR, GL context
- `packages/ui/src/viewer/ViewerCanvas.tsx:67`: `frameloop={paused ? 'never' : 'always'}`. `paused` is true only while the GPU Studio overlay is open (`ViewerApp.tsx:664`). **The main viewer therefore renders every display frame even when idle.** Comments elsewhere still assume on-demand rendering and are stale: `CameraFocus.tsx:64` says "frameloop is 'demand' when idle", and `ExportManager.tsx:94` says "the app normally renders on demand".
- DPR is a static range from UA tiering: `[1, 1.25]` on mobile/low and `[1, 1.75]` on desktop/high (`ViewerCanvas.tsx:20-25, 34-36`). There is no runtime adaptation. `PerformanceMonitor`, `AdaptiveDpr` and R3F `performance` regress appear nowhere in the source (grep).
- GL options (`ViewerCanvas.tsx:27-32`): `alpha: true`, `antialias: false` (AA comes from composer MSAA), `preserveDrawingBuffer: true` (kept for export/thumbnail capture; it can cost bandwidth on tile-based mobile GPUs), `powerPreference: 'high-performance'`.
- The renderer does no tone mapping (`ViewerCanvas.tsx:45-53`). The postprocess pipeline is the only tone-map owner.
- The viewer is WebGL2 only. WebGPU is used only for optional bond-detection compute (`renderCapability.ts:10-15`) and for the separate GPU Studio (`gpu-studio/runtime.ts:161`, `new WebGPURenderer`).

### 1.2 Scene composition
`packages/ui/src/app/ViewerScene.tsx:442-763` renders, in order:

1. `ExportManager`
2. `AppBackground` (a dome that follows the camera)
3. XR dome and light estimation
4. `SceneLighting`
5. A `SpatialAnchor` group containing:
   - `MoleculeFilterShell` and `MoleculeShadow`
   - `AnomalyTracker`
   - `GhostAtoms`
   - `AtomsTransmission` **or** `AtomsOptimized`
   - `VectorGlyphs`
   - `AtomClusters`
   - `Bonds`
   - `SimulationCell`
   - `BudgetedContactShadows`
   - Annotation, knowledge-label, selection and measurement layers, plus `AtomInfoHUD`
   - `CameraFocus`
   - `AtomTrails`
   - `AtomPicker`
6. `GizmoHelper`
7. drei `OrbitControls`: damping 0.08, rotate speed 0.5 (`:731-759`)
8. `ScenePostprocessing`

### 1.3 Atoms: ray-cast impostor billboards (`packages/scene/src/AtomsOptimized.tsx`)

**Geometry and upload**
- One instanced quad per atom, drawn as a single `InstancedBufferGeometry` / `RawShaderMaterial` in GLSL ES 3.00 (`:1234-1287`, `:1307-1357`).
- Instance layout is compact:
  - `instancePosition`: vec3 f32
  - `instanceTargetPosition`: aliases the position attribute for static frames and is lazily allocated for trajectories (`:1290-1298`)
  - `instanceTypeId`: u8 slot
  - `instancePropValue`: u16 normalized
  - `instanceOcclusion`: u8
- Radius, visibility and per-type scale live in 256-entry palette textures rather than per-instance data:
  - `uPalette` (colour), `uColormap`, `uRadiusPalette` (R32F; radius 0 hides the type), `uMaterialPalette` (256×2, metal/rough/aniso/SSS plus emission) (`:1002-1131`)
  - Scaling or hiding an element is therefore a 1 KB texture upload, not an O(n) rewrite (`:1513-1524`).
- Capacity grows with ×1.2 headroom (×1.05 above 2M atoms), with a minimum of 50,000 (`:1135-1140`, `:1217-1231`).

**Vertex shader** (`:318-424`)
- GPU interpolation: `mix(instancePosition, instanceTargetPosition, uProgress)` (`:367`).
- Sub-pixel culling: hidden or sub-pixel atoms collapse to a degenerate clip point (`:377-389`).
- The billboard sits on the sphere's front tangent plane so `EXT_conservative_depth` (`layout(depth_greater)`) keeps early-Z (`:417-422`, `:427-438`, `:974-997`).

**Fragment shader** (`:426-833`)
- Ray-sphere intersect, then Cook-Torrance (GGX, Smith, Schlick) with Burley wrap diffuse, a subsurface backlight and a Fresnel rim.
- Optional clearcoat (tier 2).
- IBL through Three's `cube_uv_reflection_fragment` against the PMREM atlas (tier ≥ 1), falling back to an analytic hemisphere.
- Per-atom baked occlusion, emission and property glow.
- Etched annotation stamp.
- Writes `gl_FragDepth`. Performs its own sRGB OETF (`:523-525`, `:829-831`).

**Quality tiers**
- `resolveAtomQualityTier`: tier 0 above 2M atoms, tier ≤ 1 above 400k (`:263-277`).
- Tiers are compile-time defines: `LUPI_QUALITY`, `LUPI_CONSERVATIVE_DEPTH` (`:914-934`).

**Upload** (`uploadFrame`, `:1604-1776`)
- Runs only on frame or prop change, in `useLayoutEffect`.
- Does one bulk `posArr.set`, an O(n) bounds pass, an O(n) PBC-unwrapped target pass (`wrapDelta`, `interpolation.ts:18-24`), an O(n) type-slot remap (skipped when the type buffer is unchanged), O(n) property quantisation and an occlusion copy.
- Uses `addUpdateRange` partial uploads (`:244-255`).
- The spatial hash for picking is rebuilt in `requestIdleCallback` (`:1609-1621`).

**Per-frame work** (`:1553-1577`): syncs the PMREM uniform and transforms four precomputed light directions into view space with one scratch vector (no allocation). It also sets `uProgress` from `liveStateRef.current.effectiveFrame - frameIndex`.

### 1.4 Bonds (`packages/scene/src/Bonds.tsx`, `bondImpostor.ts`)

**Detection**
- Runs in a Web Worker (`bondWorker.ts`, calling `bondDetectCpu.ts`) or in the WebGPU compute `BondPipeline` (`useBondGpuPipeline.ts`, `packages/renderer/src/pipeline/BondPipeline.ts`, `shaders/bond_compute.wgsl`).
- GPU is forced above 200,000 atoms (`Bonds.tsx:269`). Without WebGPU, those scenes skip bonds entirely.
- Recompute is skipped when a 1,000-atom subsampled max displacement is under 0.05 Å (`:72-90`, `:476`, `:619`).
- Cutoff-slider changes are debounced 150 ms. Frame changes dispatch with 0 ms delay (`:481-489`).

**Rendering**
- One instanced box per bond. The fragment shader ray-casts a flat-capped cylinder and writes exact depth.
- The vertex shader builds a basis via `cross(dir, ref)` (`bondImpostor.ts:55-80`).
- Interpolation uses the same GPU `uProgress` lerp over start/end plus target attributes (`Bonds.tsx:849-864`).
- Endpoint upload is O(bonds) per frame change (`:922-955`). Colour and radius upload is skipped by content-equality when the bond set is stable (`:969+`).
- Capacity: minimum 20k, grows ×1.5; shrinks after 60 idle renders (`:686-714`).

### 1.5 Large-scene LOD and other atom paths
- **Large scenes (≥ 50,000 atoms)** (`ViewerScene.tsx:65`) get:
  - Cull thresholds of 0.5 px when paused with clusters and 0.3 px while playing (`:68-69`, `:411-415`)
  - Far-LOD cluster splats built off-thread from the paused frame: `ClusterBuilder.ts` uniform grid, `MAX_GRID_DIM = 64` (`:62`), rendered as impostors with a distance fade by `AtomClusters.tsx:36-80`
  - Baked per-atom occlusion from a density kernel on a counting-sort grid (`atomOcclusion.ts`), computed in `occlusionWorker.ts` and wired by `useAtomOcclusion.ts`
- **AtomsTransmission** (`AtomsTransmission.tsx`): real sphere `InstancedMesh` with drei `MeshTransmissionMaterial`.
  - Capped at `MAX_TRANSMISSION_ATOMS = 20_000` (`:45`)
  - Samples/resolution are 4/256 on the low tier and 6/512 otherwise (`:78-81`)
  - Interpolation is a **CPU** `setMatrixAt` rewrite of every instance each display frame (`:175-196`, `:575-583`), not a GPU lerp
- **VectorGlyphs** (`VectorGlyphs.tsx`): instanced cylindrical-billboard arrows with the same GPU `uProgress` lerp (`:364-372`).
- **BillionAtomBlock** (`BillionAtomBlock.tsx`): 1,000,188,000 procedural FCC atoms. Positions are derived from `gl_InstanceID`, with an integer `hash1` thermal jitter (`:105`). Each frame the CPU classifies 9,261 bricks into four LOD tiers with `THREE.Frustum` (`:303-386`).
- **InterpolatedAtoms** (`InterpolatedAtoms.tsx`): legacy CPU `Matrix4.compose` path. Exported (`index.ts:34`) but **not used** by `ViewerScene`.
- **packages/renderer AtomPipeline**: full WebGPU impostor render with compute frustum culling, colormap and indirect draw (`AtomPipeline.ts`, `culling.wgsl`, `atom.wgsl`). Exported but **unused by the UI**; only `BondPipeline` is consumed (`useBondGpuPipeline.ts:4`).

### 1.6 Trajectory playback
- `useSmoothFramePlayback` (`packages/ui/src/hooks/useSmoothFramePlayback.ts:237-350`) runs **its own `requestAnimationFrame` loop**, separate from R3F's.
  - It writes a fractional `effectiveFrame` into `liveStateRef` every tick.
  - It pushes React state only at `stateSyncFPS`: 15 by default, or 30/60 in high-fidelity mode (`ViewerApp.tsx:299`).
- Loop, bounce and once modes are closed-form (`advancePlaybackFrame`, `:79-118`).
- Shaders read `liveStateRef` in `useFrame` for smooth display-rate interpolation, so a React re-render and an O(n) upload happen only on source-frame change.
- Frames are streamed and LRU-cached from `.glimbin` (`docs/trajectory-architecture.md:18-30`).

### 1.7 Lighting and postprocessing
- **SceneLighting** (`SceneLighting.tsx`): ambient light plus a key directional; fill and rim lights only when the scene has ≤ 50k atoms (`:113-115`).
  - PMREM-prefiltered drei preset, or a procedural "softbox" studio baked once (`studioEnvironment.ts:205`, `fromScene`).
  - Environment and fill/rim are dropped in immersive AR.
- **Composer chain** (`ScenePostprocessing.tsx:42-99`): `N8AO` (aoSamples 16, denoiseSamples 8, fixed across tiers) → `Bloom` (mipmapBlur) → `DepthOfField` (autofocus wrapper) → `ToneMapping` (ACES_FILMIC or REINHARD only, `:87`) → `Vignette`.
- **Presets** (`postprocess/presets.ts`): paper, studio, editorial, cinematic, diagram, all with MSAA 4.
  - `reduceForPlayback` sets MSAA to 0 and halves AO.
  - `reduceForMobile` disables AO, Bloom and DOF and caps MSAA at 2 (`:138-146`; test at `mobileBudget.test.ts`).
  - `composerKey` remounts the composer only when the set of enabled effects changes.
- **ContactShadows**: 1024 px up to 5k atoms, 512 px up to 50k, omitted above that; `frames={0}` while playing (`ViewerScene.tsx:61-146`).
- **Scene presets**:
  - `sceneLooks.ts`: Studio, Paper, Night, Prism
  - `sceneRemix.ts`: random "remix" of about 40 presentation keys, with an injectable `random` (`:27`)
  - Both apply **instantly** through store patches. Nothing tweens.

---

## 2. Hand-rolled math that pmndrs `math` could replace or improve

`math` API facts, verified from the `math@0.1.0` tarball's `API.md`:
- Types are plain JS tuples (`Vec3 = [x,y,z]`), **not typed arrays**. Functions write to an `out` argument ("nothing is allocated").
- Flat buffers marshal through `vec3.fromBuffer(out, buf, i*3)` and `vec3.toBuffer(buf, v, i*3)`.
- Subpaths: `math`, `math/shapes`, `math/geometry`, `math/time`, `math/random`, `math/noise`, `math/color`, `math/ik`.
- Notable gaps:
  - `raycast3` has only `intersectsTriangle` and `intersectsBox3`. **No ray-sphere.**
  - `sphere` has only `create` and `containsPoint`.
  - `math/color` has linear-sRGB, Display-P3 and HSL, but **no OKLab/OKLCH**.
  - There is no quaternion spring. `spring`/`spring2`/`spring3`/`spring4` plus `spring.dampAngle` are scalar or vector.
  - `math/noise` is CPU JavaScript, so it does not replace GLSL/WGSL noise.

### 2.1 Vectors, quaternions, matrices, angles

| Location | What it does | `math` candidate |
|---|---|---|
| `AtomsOptimized.tsx:1534-1550`, `Bonds.tsx:832-845`, `SceneLighting.tsx:75-85`, `studioEnvironment.ts:79-84`, `MoleculeShadow.tsx:68-70` | Five copies of azimuth/elevation → direction (`cos(el)·sin(az), sin(el), cos(el)·cos(az)`) | `spherical.toVec3` + `degreesToRadians`; one shared helper |
| `flythrough.ts:86-126` | `lerp3` and a tension Catmull-Rom that allocate a tuple per call; target is linear, FOV is lerped | `vec3.lerp`, `vec3.hermite`/`vec3.bezier` into `out`; `spherical.lerp` for orbit-style paths; `quat.slerp` if orientation keys are added |
| `cameraFit.ts:59-137` | AABB centre + half-diagonal sphere fit, direction normalisation via tuple spreads | `box3.center`/`box3.extents`, `vec3.normalize`; `obb3` for tighter fits (no OBB-from-points fitter is listed, UNVERIFIED) |
| `viewer/useViewerSceneModel.ts:4-21` | Eight-corner loop for outer radius | `box3.*` helpers |
| `xr/grabMath.ts:73-222` | One/two-hand rigid delta, swing-twist, `dampFactor`, `dampVector3`, `dampQuaternion` (already allocation-free with module scratch) | `quat.*`/`vec3.*`; `spring3.damp` for position; quaternion damping stays custom |
| `bondImpostor.ts:55-80` (GLSL) | Per-vertex orthonormal basis from the bond axis | GLSL; not replaceable by a JS library |
| `packages/renderer/src/pipeline/AtomPipeline.ts:335-348` | Hand-written frustum-plane extraction, allocating one `Float32Array` per plane | `frustum.setFromViewProjectionMatrixZO` (WebGPU depth range) into a reused `Frustum` |

### 2.2 Lerp, damp, easing, springs (feel-critical)

| Location | Current | Issue | `math` candidate |
|---|---|---|---|
| `CameraFocus.tsx:11-12, 54-60` | `orbitTarget.lerp(target, 0.14)` and `camera.position.lerp(..., 0.07)` **per frame** | Frame-rate dependent: slower on 30 Hz phones, faster on 120 Hz ProMotion | `spring3.damp(state, target, smoothTime, delta)` |
| `scene/AnomalyTracker.tsx:56-66` | `target.lerp(goal, 3.0 * delta)` | Linear-in-dt; overshoots when `delta > 0.33` | `spring3.damp` |
| `xr/XRControlPanel.tsx:157-172` | `position.lerp(t, delta*2.5)`, `quaternion.slerp(q, delta*3)` | Same dt issue, at XR frame rates | `spring3.damp`; the quat needs `1-exp(-k·dt)` + `quat.slerp` |
| `SpatialAnchor.tsx:73-90` | Correct exponential ease `1 - exp(-3·dt)` | Fine; duplicated idea | `spring.damp` / `spring3.damp` |
| `lib/spring.ts:38-59` | Euler-Cromer spring (stiffness 520, damping 20, `MAX_STEP = 1/30`); returns a **new object each step** | Used by `usePressSpring.ts` for DOM buttons with its own rAF | `spring.update(state, target, smoothTime, dampingRatio, delta)` (mutating, damping-ratio parametrised); `spring.fromResponse` gives SwiftUI-style tuning |
| `flythrough.ts:56-72` | Six easing lambdas using `Math.pow` | Fine but bespoke | `easing.cubicIn/Out/InOut`, `easing.expo*`, `easing.sine*` |
| `sceneLooks.ts` / `sceneRemix.ts` / `store.setCameraPreset` (`store.ts:1812-1822`) | Instant state patches; `CameraManager.tsx:62-77` snaps the camera with `position.set` + `lookAt` | No transitions, which is a feel gap | `spring*` or `easing` tweens of numeric keys and camera pose |

### 2.3 Noise
- GLSL `rand = fract(sin(dot(...)) * 43758.5453)` drives the atom "noise" and "scratched" textures (`AtomsOptimized.tsx:518-521`, `:721-733`). It is **UV-based on a billboard**, so the grain is screen-aligned and "swims" when the view rotates. Keying it by atom id or the normal would fix that; this is a shader concern, not something `math` solves.
- GLSL hash/value-noise/fbm in the procedural background (`ProceduralBackground.tsx:206-231`).
- CPU `seeded()` sine-hash (`ProceduralBackground.tsx:30-32`) builds the math-field geometry. It could become `simplex3d.sample` / `curl3` / `fbm` (seeded, CPU).
- `BillionAtomBlock.tsx:105`: integer `hash1` for thermal jitter (GLSL, well designed).
- **Summary:** `math/noise` is useful CPU-side (for example `curl3` flow fields for particle or atom "wind" computed per frame, or seeded structure generation). GPU noise still needs GLSL/TSL.

### 2.4 Random (seeded vs. unseeded)
- **Unseeded `Math.random`, relevant to fun and shareability:**
  - `sceneRemix.ts:27` (default argument; injectable)
  - `StudioControlDeck.tsx:30`
  - `panels/FlythroughPanel.tsx:253-282` (random tour keyframes)
  - `studio/SceneControls.tsx:124, 135`
  - `molecules/randomOmol.ts:13`
  - `library/Omol25Collection.tsx:166`
  - `scan/swirl.ts:33`
  - `scan/gist/gistEngine.ts:154, 266` (injectable)
  - `core/src/gist/points.ts:181`
- **Hand-rolled seeded LCG:** `AtomsTransmission.tsx:216-219` (for deterministic exports).
- **Opportunity:** `mulberry32.create(seed)` / `random.choice` / `random.float` would make remixes and random tours reproducible from a URL seed ("share this remix"). The export determinism contract already demands this for textures.

### 2.5 Bounds, frustum, raycast, spatial grids
- **Four separate uniform-grid implementations:**
  - `SpatialHash.ts` (typed-array counting sort, good)
  - `atomOcclusion.ts:98-160` (a second counting-sort copy)
  - `ClusterBuilder.ts:124-160` (a third grid)
  - `bondDetectCpu.ts:32-92`: **string-key `Map<string, number[]>`** with `results.push({index,d2})` per neighbour. This is `BOND_ARCHITECTURE.md` known limitation #1, and it is still present even though `SpatialHash3D` already solves it.
- **`AtomPicker.tsx:57-141`** ray-marches in 0.5 Å steps up to 1000 Å (≤ 2000 steps).
  - Each step allocates `new THREE.Vector3` (`:74`) and calls `spatialHash.query`, which allocates an object per hit and **sorts** (`SpatialHash.ts:133-170`).
  - Each candidate atom allocates a `Vector3` and projects (`:85-99`).
  - It runs on every window `mousemove`, not rAF-throttled (`:145-156`, `:247`).
  - A grid DDA with analytic ray-sphere tests would be exact and allocation-free. `math` has `raycast3.intersectsBox3` for cell or brick rejection but **no ray-sphere**, so that test would be hand-written.
- `BillionAtomBlock.tsx:296-318` uses `THREE.Frustum` + `intersectsSphere` on 9,261 bricks per frame. `math` equivalents: `frustum.setFromViewProjectionMatrixNO` + `frustum.intersectsSphere` or `frustum.intersectsBox3` (bricks are AABBs).
- `createAtomInterpolationBoundingSphere` (`AtomsOptimized.tsx:190-225`) is an AABB-derived sphere, which is fine.
- **Convex hull / OBB:** none anywhere in the codebase (grep for hull/quickhull/OBB/PCA returned nothing). `quickhull3(points: number[]): number[]` and `obb3` are net-new capabilities.

### 2.6 Colour conversions
- `core/src/elements.ts:365-376` `hexToRgb`: regex parse; **`hsl(...)` strings fall back to grey [0.6, 0.6, 0.6]**. `math/color` `color.fromValues` / `hsl.toColor` handle HSL properly (`ColorInput = string | number | [r,g,b]`, per the API).
- `scene/src/constants.ts:27-68`: every scientific colormap (viridis, inferno, magma, plasma, cividis, turbo and others) is a **four-stop piecewise-linear approximation lerped in sRGB display space**, returning a fresh tuple per call. This is visibly off from real viridis/turbo. A 256-entry LUT or sRGB→linear lerp via `color.lerp` plus `colorspace.srgbToLinear` would be more accurate.
- `ClusterBuilder.ts:152-155` averages cluster colours in **sRGB** space. `color.setFromSRGB` → accumulate → `color.toSRGB` would give physically correct averages.
- Shader-side transfer functions are hand-written: `AtomsOptimized.tsx:523-525` (OETF) and `bondImpostor.ts:51-53` (`srgbToLinear`).
- `new THREE.Color(uniformColor)` runs inside a layout effect (`AtomsOptimized.tsx:1466`). That is cheap and not per-frame.

---

## 3. Per-frame allocation hotspots, O(n) loops, `useFrame` census

### 3.1 `useFrame` call sites
There are **32 static call sites in 26 non-test files**. `AtomPicker.tsx:9` imports `useFrame` but never calls it. Three of the sites are per-instance components, so the live count grows with content.

| # | Site | Per-frame work | Notes |
|---|---|---|---|
| 1 | `scene/AtomsOptimized.tsx:1553` | 4 light transforms, env sync, `uProgress` | allocation-free |
| 2 | `scene/Bonds.tsx:849` | same as #1 | allocation-free |
| 3 | `scene/VectorGlyphs.tsx:364` | `uProgress` | |
| 4 | `scene/AtomsTransmission.tsx:575` | **O(n) `setMatrixAt` rewrite** (≤ 20k) while interpolating | CPU sweep |
| 5 | `scene/BillionAtomBlock.tsx:303` | 9,261-brick distance, sort and frustum loop | **allocates** `atomCandidates[]`, sort closure, `new Set(slice)` (`:325-330`); sets `needsUpdate` on 4 textures every frame even when the camera is still (`:359`) |
| 6 | `scene/AtomClusters.tsx:231` | no-op `useFrame(() => {})` | removable |
| 7 | `scene/AnomalyTracker.tsx:56` | target lerp | linear-dt lerp |
| 8 | `ui/CameraFocus.tsx:46` | focus lerp | **allocates 2× `clone()` per frame** while focusing (`:58-59`); frame-rate dependent |
| 9-10 | `ui/AtomTrails.tsx:96` and `:166` (one per tracked atom) | history sample; buffer rewrite | `new THREE.Vector3` per sample + `Array.shift()` (O(len)) (`:108-114`); each `TrailLine` rewrites its buffers **every frame** even when unchanged; 1 px `THREE.Line` |
| 11 | `ui/KnowledgeLabelsLayer.tsx:100` | label culling | on every third frame it calls `setVisibleLabels(...)` unconditionally; `selectVisibleLabels` returns a **fresh `[]`** even when hidden or empty (`knowledgeLabels/selectVisibleLabels.ts:21-23`). By code reading, that is a React re-render about 20×/s while idle (not profiled). |
| 12 | `ui/SelectionMarkers.tsx:99` (per marker) | ring pulse | cheap |
| 13 | `ui/AnnotationsLayer.tsx:184` (per ring label) | rotate | cheap |
| 14 | `ui/app/CameraManager.tsx:48` | flythrough sync / projection check | runs every frame; reads `getState()` |
| 15 | `ui/app/AppBackground.tsx:282` | dome follows camera, rotation set | cheap |
| 16-17 | `ui/ProceduralBackground.tsx:328`, `:371` | `uTime`, group rotation | cheap; the dome is a 128×64 sphere (`:336`) |
| 18 | `ui/postprocess/ScenePostprocessing.tsx:121` | DOF autofocus | cheap |
| 19 | `ui/DevProbe.tsx:235` | FPS samples with `Array.shift()` | dev only |
| 20 | `ui/SpatialAnchor.tsx:73` | exponential ease | good pattern |
| 21 | `ui/hooks/useEquirectMediaTexture.ts:91` | video texture | |
| 22-24 | `ui/ExportManager.tsx:90` (priority 2 at `:180`), `:335` (priority **-0.5**), `:351` (priority 100) | capture ordering via fractional priorities | |
| 25-29 | `ui/xr/XREnvironmentDome.tsx:118`, `useXRHands.ts:92`, `XRMoleculeInteraction.tsx:184`, `XRControlPanel.tsx:31`, `XRControlPanel.tsx:157` | XR | `XRControlPanel:161` allocates `new THREE.Vector3` every XR frame; `XRMoleculeInteraction:201` allocates a candidates array |
| 30 | `ui/xr/XRLightEstimation.tsx:98` | | |
| 31-32 | `ui/BillionAtomsPage.tsx:62`, `:71` | | separate page |

### 3.2 Other non-`useFrame` hotspots
- **Separate rAF loops outside R3F:**
  - `useSmoothFramePlayback.ts:237-414` (playback)
  - `usePressSpring.ts:63-80` (every pressed button, allocating a new spring state object per tick through `springStep`)
  - The GPU-studio/scan vgpu `frame` loops
  - None of these share R3F's clock.
- **Every trajectory source-frame change** runs:
  - An O(n) atom upload of positions, targets, bounds, type remap and properties (`AtomsOptimized.tsx:1604-1776`)
  - An O(bonds) endpoint gather (`Bonds.tsx:922-955`)
  - A worker bond redispatch
  - At 15 source frames/s × 1M atoms, that is tens of millions of scalar writes per second on the main thread. The GPU lerp only hides the sub-steps.
- **CPU bond detection** (`bondDetectCpu.ts`): string keys, an object per neighbour, and a pre-allocated `pairBuf` of `min(natoms*12, 50M)` Int32 pairs (up to about 400 MB + 200 MB for the float distances) in the worker (`:107-110`).
- **Per render:**
  - `Bonds.tsx:250` `hiddenAtomTypes = new Set<number>()` default argument, plus `Array.from(...).sort().join()` keys on every render (`Bonds.tsx:273`, `ViewerScene.tsx:269`, `AtomPicker.tsx:49`)
  - `ViewerScene` subscribes to about 55 separate store selectors (`:211-266`), so any of them re-renders the whole scene tree

---

## 4. Current limits and documented pain

**Atom ceilings and thresholds**
- Global ceiling `GLOBAL_BROWSER_ATOM_CEILING = 50_000_000` for every tier (`deviceCapabilities.ts:30`).
- Recommended soft budgets: mobile 2M, low 4M, desktop 10M (`:56-88`).
- Picking disabled above `MAX_INTERACTIVE_PICKING_ATOMS = 5_000_000` (`:41`).
- Default shader tier: mobile = 0 (analytic, no IBL); low and desktop = 1; high = 2. Tier is further capped by count: ≤ 1 above 400k, 0 above 2M (`AtomsOptimized.tsx:263-264`).
- Large-scene treatment (clusters, occlusion, cull) from 50k atoms (`ViewerScene.tsx:65`). Contact shadows off above 50k (`:62`). Fill/rim lights off above 50k (`SceneLighting.tsx:113-115`).
- Looks and remix drop to `diagram` with no IBL at ≥ 25k (`sceneLooks.ts:14`) or ≥ 20k atoms (`sceneRemix.ts:30`).
- Transmission capped at 20k atoms (`AtomsTransmission.tsx:45`).

**Bonds**
- GPU forced above 200k atoms. The GPU pipeline starts at 100k atoms × 12 bonds and grows; grid 32³-80³ with 48-64 atoms per cell (`useBondGpuPipeline.ts:7-37`). Bonds/atom budget drops to 6 above 100k and 4 above 500k atoms, which is a possible silent drop in dense systems (UNVERIFIED in practice).
- CPU `maxPairs = min(natoms*12, 50M)`. `BOND_ARCHITECTURE.md:290` still says `natoms * 8`; the doc is stale.

**Mobile budget**
- DPR ≤ 1.25; no AO, Bloom or DOF; MSAA ≤ 2 (`presets.ts:138-146`).
- Tier detection is by UA, touch and screen size (`deviceCapabilities.ts:91-139`). Every iPad counts as "mobile". There is no GPU-benchmark or FPS feedback.

**Known pain, by document**
- `BOND_ARCHITECTURE.md:269-296`:
  - 100k atoms / 565k bonds costs about 109 ms per detection (35 ms worker + 59 ms MEAM + 15 ms upload)
  - "Up to ~50K atoms run comfortably within 16 ms"
  - Limitations: string-key hash GC pressure, fixed `maxPairs` can silently overflow, no PBC-wrapped bond drawing (cross-cell bonds)
  - The doc also describes an older mesh/"filament" bond renderer; the code now uses ray-cast impostors
- `docs/gpu-studio-launch.md:64, 144`: software-adapter results are "not phone FPS proof", and "the existing large regular-viewer and XR bundles remain a separate optimization task".
- `docs/product-reset-2026-09-04.md:77-78`: "The remaining 3D viewer is still a large bundle and is not being relabeled as a complete performance rewrite"; no device-FPS claims.
- `MOBILE_VIEWER_RELEASE_NOTES.md`: chrome-only changes ("no renderer … behavior is touched").
- `VIEWER_RELEASE_NOTES_2026-06-14.md`: the homepage hero is a 953,312-atom FCC copper scene; verification is functional, not FPS.
- `docs/trajectory-architecture.md:128-137`: OPFS eviction and quota; the device ceiling still gates rendering.

---

## 5. Upgrade hooks: where new pmndrs pieces plug in

**A. Scheduler and frameloop**
1. **`ViewerCanvas.tsx:67`: demand rendering.** Switch idle to `frameloop="demand"` and call `invalidate()` from controls, damping, springs, playback and uniform changes. This is the largest idle battery and thermal win on phones. Stale comments in `CameraFocus.tsx:64` and `ExportManager.tsx:94` show the code was once written for it.
2. **R3F v10 scheduler** (10.0.0-alpha.5, built on `@pmndrs/scheduler`). `useFrame(cb, { phase, before, after, priority, fps, drop, enabled, id })`; default phases are `start | input | physics | update | render | finish`. Its typings describe a "single RAF loop for entire application". Plug-in points:
   - `ExportManager.tsx:180/335/351`: replace the priority -0.5/2/100 hacks with named phases.
   - Fold `useSmoothFramePlayback`'s private rAF (`:237-414`) into an `input`/`update` job so playback and render share one clock.
   - Throttle `KnowledgeLabelsLayer`, `CameraManager` and `BillionAtomBlock` brick classification with `fps: 10-20`.
   - Pause decorative jobs (`ProceduralBackground`, `SelectionMarkers`, annotation rings) with `enabled` while idle.
   - Canvas-level `renderer={{ scheduler: { fps } }}` could cap mobile render FPS.
   - Requires three ≥ 0.185 and React 19.0-19.2 peers.
3. **Adaptive quality.** Wrap `ViewerScene` in drei `PerformanceMonitor` (verified exported in drei 10.7.9) to drive DPR (`viewerDprRange`), `atomQualityTier`, `cullPixelRadius`, N8AO sample counts and `composerKey` sets from measured FPS instead of UA tiers (`deviceCapabilities.ts`). `AdaptiveDpr`/`AdaptiveEvents` are the simpler alternatives.

**B. Feel and motion (`math/time`)**
4. `CameraFocus.tsx`, `AnomalyTracker.tsx`, `XRControlPanel.tsx`: `spring3.damp` or `spring3.update` for frame-rate-independent, allocation-free camera and target motion.
5. `CameraManager.tsx:62-77` and `store.setCameraPreset` (`store.ts:1812`): animate preset changes (top/side/iso) and "fit" as spring or `spherical.lerp` orbits instead of snapping.
6. `sceneLooks.ts`, `sceneRemix.ts`: tween numeric look keys (light azimuths, intensities, roughness) with `spring.damp` or `easing.*` so "Remix" and "Look" morph instead of cutting. `spherical`/`deltaAngle`/`wrapAngle` handle azimuth wrap correctly.
7. `lib/spring.ts` + `usePressSpring.ts`: swap in `spring.update` (mutating, damping-ratio tuned, `fromResponse`) and share one scheduler loop.
8. `flythrough.ts`: replace `EASING_FUNCTIONS`, `lerp3` and `catmullRom` with `easing.*` and `vec3.hermite`/`vec3.bezier` writing into scratch; add `quat.slerp` roll keys. `easing.rsqw` gives a smoothed square-wave "hold then glide" option.

**C. Spatial queries and structure (`math/shapes`, `math/geometry`)**
9. `AtomPicker.tsx:57-141`: rewrite as a grid DDA over `SpatialHash3D` cells, using `raycast3.intersectsBox3` for cell rejection and a hand-written ray-sphere test. Throttle to one pick per frame. This makes hover cheap enough for "magnet cursor" and hover-glow effects on every molecule size.
10. `BillionAtomBlock.tsx:303-386` and `AtomPipeline.ts:335-348`: use `frustum.setFromViewProjectionMatrix{NO,ZO}` + `frustum.intersectsBox3` into caller-owned scratch. Also remove the per-frame arrays and Set, and skip texture uploads when the camera has not moved.
11. `MoleculeFilterShell.tsx` (shapes: sphere, cube, off): `quickhull3` would add a molecule-hugging convex-hull shell. `obb3` would give an oriented bounding cube and a PCA-aligned "fit" camera in `cameraFit.ts`; an OBB fitter from points is not listed in `math` (UNVERIFIED), so PCA would be local code.
12. `bondDetectCpu.ts`: reuse `SpatialHash3D` (typed counting sort) instead of the string-key Map. This closes `BOND_ARCHITECTURE.md` limitation #1. Plain code, no library needed.

**D. Procedural fun (`math/noise`, `math/random`, `math/color`, `math/ik`)**
13. Swap `Math.random` in `sceneRemix.ts:27`, `FlythroughPanel.tsx:253-282` and `SceneControls.tsx:124/135` for `mulberry32` + `random.choice`/`random.float`. A URL seed then reproduces a remix or random tour exactly, which also suits the export determinism contract (`AtomsTransmission.tsx:212-219` already hand-rolls an LCG for this).
14. `ProceduralBackground.tsx:30-32` (CPU `seeded`): `simplex3d`, `curl3`, `fbm` and `domainWarp3` for seeded CPU fields. A `curl3` flow field could also drive a playful per-atom "wind/jiggle" as a small instanced offset attribute, uploaded like `instanceTargetPosition`.
15. Colour:
    - `hexToRgb` should support HSL (`hsl.toColor`).
    - `constants.ts` colormaps should be proper LUTs lerped in linear space (`color.lerp`, `colorspace.*`).
    - `ClusterBuilder` should average in linear.
    - `colorspace.linearSrgbToLinearDisplayP3` could feed P3 canvases. That needs the canvas color-space configured; UNVERIFIED for R3F 9.
16. `math/ik` `fabrik3`: drag a chain of bonded atoms (a polymer or alkane backbone) like a rope in "play mode", with bonds as fixed-length IK segments. `xr/grabMath.ts` already has the grab plumbing for XR.

**E. Postprocessing and visuals (no new deps)**
17. `ScenePostprocessing.tsx:87`: the installed postprocessing 6.38.3 already exports `ToneMappingMode.AGX` and `ToneMappingMode.NEUTRAL` (Khronos). Lupi uses only ACES and Reinhard. AGX/Neutral would give truer element colours.
18. N8AO: n8ao 1.10.1 supports `configuration.halfRes = true` (README). Whether `@react-three/postprocessing`'s `<N8AO>` forwards `halfRes` is UNVERIFIED. Half-res AO could let mobile keep AO instead of dropping it (`presets.ts:141`).
19. `AtomTrails.tsx`: use a ring buffer with no `Vector3` per sample, and swap the 1 px `THREE.Line` for drei `Trail` or a `Line2`-style ribbon (drei `Line` is already in use elsewhere), for fat glowing worldlines on mobile.
20. `AtomsOptimized.tsx:721-733`: key procedural grain by `vAtomId` and the normal instead of billboard UV, so textures stop swimming during orbit.

**F. WebGPU and TSL path**
21. `packages/renderer` `AtomPipeline` + `culling.wgsl` already implement GPU frustum culling, colour mapping and indirect draw, but are unused. R3F v10 ships a `./webgpu` entry, and GPU Studio already runs `three/webgpu` through vgpu (`gpu-studio/runtime.ts:15, 161`). A TSL port of the impostor BRDF (`AtomsOptimized.tsx:426-833`) plus the compute bond pipeline would unify both viewers.
    - The WebGL path's hand-owned sRGB, CubeUV-define and conservative-depth plumbing (`:835-997`) is exactly what a TSL node material would absorb.
    - Moving `wrapDelta` target unwrapping, bounds and property quantisation into compute would remove the O(n)-per-source-frame CPU uploads.

---

## Sources

**External**
- pmndrs math repo: https://github.com/pmndrs/math (README fetched 2026-09-27)
- npm registry `math` (dist-tags, time, exports): https://registry.npmjs.org/math
- Tarball read locally: https://registry.npmjs.org/math/-/math-0.1.0.tgz (`API.md`, `skills/math/SKILL.md`)
- npm `@react-three/fiber` (9.8.1 latest; 10.0.0-alpha.5 of 2026-09-08; exports and peers): https://registry.npmjs.org/@react-three/fiber and https://registry.npmjs.org/@react-three/fiber/-/fiber-10.0.0-alpha.5.tgz
- `@pmndrs/scheduler@0.2.0` typings (`UseFrameOptions`, `DefaultPhase`): https://registry.npmjs.org/@pmndrs/scheduler
- npm `@react-three/drei` 10.7.9 (helper export check): https://registry.npmjs.org/@react-three/drei
- npm `postprocessing` 6.38.3 `ToneMappingMode` (AGX, NEUTRAL): https://registry.npmjs.org/postprocessing
- npm `@react-three/postprocessing` 3.1.3: https://registry.npmjs.org/@react-three/postprocessing
- n8ao 1.10.1 README (`halfRes`): https://registry.npmjs.org/n8ao
- npm `three` 0.186.1: https://registry.npmjs.org/three

**Code and docs**
- Scene package: `packages/scene/src/` — `AtomsOptimized.tsx`, `AtomsTransmission.tsx`, `Bonds.tsx`, `bondImpostor.ts`, `bondWorker.ts`, `bondDetectCpu.ts`, `useBondGpuPipeline.ts`, `InterpolatedAtoms.tsx`, `interpolation.ts`, `SpatialHash.ts`, `atomOcclusion.ts`, `occlusionWorker.ts`, `useAtomOcclusion.ts`, `ClusterBuilder.ts`, `AtomClusters.tsx`, `BillionAtomBlock.tsx`, `VectorGlyphs.tsx`, `AtomPicker.tsx`, `AnomalyTracker.tsx`, `constants.ts`, `index.ts`
- Renderer package: `packages/renderer/src/` — `index.ts`, `pipeline/AtomPipeline.ts`, `shaders/culling.wgsl`
- Viewer shell and scene: `packages/ui/src/` — `viewer/ViewerCanvas.tsx`, `viewer/useViewerSceneModel.ts`, `app/ViewerScene.tsx`, `app/CameraManager.tsx`, `app/AppBackground.tsx`, `ViewerApp.tsx`
- Postprocessing: `packages/ui/src/postprocess/` — `ScenePostprocessing.tsx`, `presets.ts`, `controls.ts`, `mobileBudget.test.ts`
- Lighting and camera: `packages/ui/src/` — `SceneLighting.tsx`, `studioEnvironment.ts`, `CameraFocus.tsx`, `cameraFit.ts`, `flythrough.ts`, `controls.tsx`
- Hooks and helpers: `packages/ui/src/` — `hooks/usePressSpring.ts`, `hooks/useSmoothFramePlayback.ts`, `lib/spring.ts`, `deviceCapabilities.ts`, `renderCapability.ts`
- Scene layers and presets: `packages/ui/src/` — `AtomTrails.tsx`, `GhostAtoms.tsx`, `ProceduralBackground.tsx`, `MoleculeFilterShell.tsx`, `MoleculeShadow.tsx`, `sceneLooks.ts`, `sceneRemix.ts`, `KnowledgeLabelsLayer.tsx`, `knowledgeLabels/selectVisibleLabels.ts`, `SelectionMarkers.tsx`, `AnnotationsLayer.tsx`, `SpatialAnchor.tsx`, `DevProbe.tsx`, `ExportManager.tsx`, `store.ts`
- XR: `packages/ui/src/xr/` — `grabMath.ts`, `XRControlPanel.tsx`, `XRMoleculeInteraction.tsx`
- Other code: `packages/ui/src/gpu-studio/runtime.ts`, `packages/core/src/elements.ts`, `pnpm-lock.yaml`, `packages/*/package.json`
- Docs: `BOND_ARCHITECTURE.md`, `MOBILE_VIEWER_RELEASE_NOTES.md`, `VIEWER_RELEASE_NOTES_2026-06-14.md`, `docs/trajectory-architecture.md`, `docs/gpu-studio-launch.md`, `docs/product-reset-2026-09-04.md`
