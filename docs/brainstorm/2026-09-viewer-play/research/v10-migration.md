# Lupi migration map: R3F v10 alpha, three r186 and WebGPURenderer

Researched 2026-09-27. This is research only: nothing in `/home/user/Lupi` was modified. Repo HEAD is `e4a099b`.

**Baseline decided by the owner:** "Assume we are upgrading to v10 alpha for R3F."
- `@react-three/fiber` 10 alpha
- three ≥0.185, pinned to 0.186.x
- `WebGPURenderer` as the main renderer, with its WebGL2 fallback
- drei 11 alpha
- TSL hooks
- the v10 scheduler

**How I verified things.**
- Code facts are cited as `path:line` (relative to `/home/user/Lupi`).
- Package facts come from the published tarballs I unpacked:
  - `@react-three/fiber@10.0.0-alpha.5` and `10.0.0-canary.14007b4`
  - `@react-three/drei@11.0.0-alpha.7`
  - `@pmndrs/scheduler@0.2.0`
  - `three@0.186.1`
  - `vgpu@0.4.0`
  - `@react-three/test-renderer@10.0.0-alpha.5`
- The drei `component-status.json` comes from the `v11-working` branch at `fbd5b12`, dated 2026-09-27.
- The `pmndrs/xr` source is at `8d2fda1`.
- Web facts carry a URL.
- **UNVERIFIED** marks anything I could not confirm first-hand. **(inference)** marks reasoning that goes beyond what I read.

---

## 0. TL;DR (the 12 things that matter)

1. **Every hand-written material has to be rewritten in TSL.** That is 8 GLSL materials with about 1,280 lines of GLSL (§1.1).
   - Neither `WebGPURenderer` backend runs `ShaderMaterial`, `RawShaderMaterial` or `onBeforeCompile`.
   - There is no official three or pmndrs example of a ray-cast impostor to copy. The closest templates are `webgpu_instance_sprites` and `webgpu_instance_points`.

2. **Two hard WebGPU-backend blockers in the atom path, both missed by earlier digests.**
   - **Attribute formats.** three r186's WebGPU backend accepts itemSize-1 vertex attributes only as `Int32`, `Uint32` or `Float32` (`three.webgpu.js:84138-84142`). Lupi's `instanceTypeId` (u8), `instancePropValue` (u16 normalized) and `instanceOcclusion` (u8) (`AtomsOptimized.tsx:1262-1276`) hit "Vertex format not supported yet".
     - This would pass CI, because CI disables WebGPU (`playwright.config.mjs:55`).
     - It would fail on real Chrome and Safari 26.
   - **No conservative depth.** TSL cannot express it. Neither `layout(depth_greater)` nor WGSL `frag_depth, greater` is emitted; the WGSL feature is still a draft proposal plus a Chrome intent to ship. Impostor depth writes therefore lose early-Z on dense scenes.

3. **The whole postprocessing stack is replaced.** `@react-three/postprocessing` and `postprocessing` are WebGL-only.
   - N8AO becomes `ao()` (GTAO). It rebuilds normals from depth when `normalNode` is null (`GTAONode.js:428`), so it works with impostors the same way N8AO does.
   - Bloom becomes `bloom()`, DOF becomes `dof()`, and Vignette becomes CRT `vignette()`.
   - Tone mapping moves into `renderOutput` / `outputColorTransform`. AgX and Neutral are available.
   - MSAA moves to `pass(..., { samples })`.

4. **The v10 scheduler reverses `useFrame` numeric priority order without any error.**
   - v9 ran callbacks lowest priority first (`a.priority - b.priority`, fiber 9.8.1 `events-9ce18a08.esm.js:1167`).
   - `@pmndrs/scheduler` runs highest priority first (`b.priority - a.priority`, `dist/index.mjs:149`).
   - v10's compatibility shim passes the number straight through (`fiber@10.0.0-alpha.5 dist/index.mjs:1147-1149`).
   - Any `n > 0` job also turns off the default render job, including `renderPipeline.render()` (`:14523`).
   - This breaks:
     - ExportManager's `-0.5 / 2 / 100` capture barrier (`ExportManager.tsx:180,349,449`).
     - Video capture: the priority-2 loop suppresses rendering and does no rendering itself.
     - drei 11's own `GizmoHelper`, which is still `renderPriority = 1` with a raw `gl.render` and so bypasses the render pipeline.

5. **XR is the biggest risk.**
   - `@react-three/xr` 6.6.30 has no v10 line. It depends on the `useFrame` third argument, `XRFrame` (`xr.tsx:102`, `hand.tsx:36`, `space.tsx:251`, …).
   - v10 alpha.5 and the 2026-09-26 canary both drop `XRFrame`. `handleXRFrame(timestamp, _frame)` ignores it and the `useFrame` wrapper passes only `(state, delta)`.
   - three r186 WebXR on `WebGPURenderer` needs `XRGPUBinding`, which is behind a flag. Without it, three hot-swaps in a new WebGL-backend renderer (`examples/jsm/webxr/WebGLXRFallback.js`), and R3F cannot express that swap.
   - Lupi's own `useXRHands.ts:92` and `XRLightEstimation.tsx:31,39,52` (`XREstimatedLight` → `XRWebGLBinding`) break too.

6. **Export determinism: V1 cannot carry over. It needs a new renderer profile.**
   - `WebGPURenderer` renders the scene into a HalfFloat linear framebuffer target and only then runs an output pass to sRGB, whenever `outputColorSpace` ≠ working space (`needsFrameBufferTarget`, `three.webgpu.js:64270-64276`; `outputBufferType` defaults to HalfFloat). Classic WebGL encoded sRGB inside each material.
   - WebGPU has no `preserveDrawingBuffer`. The WebGL2 fallback backend also creates its context without it (`three.webgpu.js:74218-74225`).
   - The fingerprint's WebGL probe (`renderArtifactAdapter.ts:556`) returns `webgl2-unavailable` on a WebGPU canvas.
   - The parity harness hard-pins `lupi-browser-webgl.v1` / `three-r184` / SwiftShader WebGL (`tools/verify-render-parity.mjs:131-140,463`).

7. **Readback moves to render targets.** Render into an explicit `RenderTarget` and read it with `readRenderTargetPixelsAsync` (`three.webgpu.js:64886`).
   - Encode and submit happen synchronously inside the call **(inference)**, so renderer state can be restored before the `await`.
   - Otherwise, `drawImage` of the WebGPU canvas has to happen in the same task as the render (gpuweb #2743, #1781).
   - The thumbnail path (`captureViewerThumbnail.ts:17-31`) reads a canvas from an arbitrary later task, so it breaks.

8. **Text replacement.** drei 11 `Text` exists only in `/legacy`; its status is "todo … returns via @pmndrs/glyph".
   - Lupi has 10 `<Text>` JSX sites in 5 files (§3).
   - `@pmndrs/glyph` 0.1.0 needs baked `.font.glb` assets and Wasm shaping, and is two weeks old.
   - `Html`, `Billboard`, `OrbitControls`, `GizmoHelper`, `useEnvironment` and `RoundedBox` are renderer-agnostic in drei core.
   - `ContactShadows`, `Line`, `MeshTransmissionMaterial` and `Grid` must be imported from `@react-three/drei/webgpu`. "Implemented" there means a file exists, not that it works; the audit counts `withRealTest: 1` across all 144 components.

9. **API census for the code migration.**
   - 32 `useFrame` sites in 26 files, of which:
     - 3 use a numeric priority
     - 2 use `clock` (`SelectionMarkers.tsx:99-101`, `BillionAtomBlock.tsx:303,356`)
     - 1 uses `XRFrame`
   - 14 `gl` accesses in 10 files.
   - 3 `new THREE.PMREMGenerator(gl)` from the WebGL module.
   - 3 `renderer.capabilities.getMaxAnisotropy()`, which throws on `WebGPURenderer` (`equirectTexture.ts:36,59,87`).
   - 1 `<color attach="background">`.
   - 3 `<Canvas>`.
   - 5 test files built on test-renderer, plus 5 tests or specs that assert on GLSL strings.

10. **GPU Studio, scan and bonds can share R3F's device, but only on the WebGPU backend.**
    - vgpu `tslExports` compiles through `wgslFn` (`vgpu/dist/three/tsl-exports.js:1,26`), so it cannot run on the WebGL2 fallback.
    - `initFromDevice` exists in 0.4.0.
    - R3F v10's `renderer` prop takes an async factory (`resolveRenderer`, `index.mjs:14087-14091`), so Lupi can build its own `GPUDevice` with `requiredLimits`.
    - Two limits must be requested:
      - `maxStorageBuffersInVertexStage`, which gist needs.
      - `maxBufferSize`. The default is 256 MiB, which caps the atom position buffer at about 22M atoms against Lupi's 50M ceiling.

11. **Pins and peers.**
    - React `>=19.0 <19.3` is a hard peer for fiber 10, drei 11 and glyph. But React **19.3.0 has been npm `latest` since 2026-09-09**, and Lupi declares `^19.0.0` in five package.json files. A lock refresh would break the peers, so pin with `pnpm.overrides`.
    - Drop `@react-three/postprocessing` (two copies), `postprocessing` and `r3f-perf` (which drags in drei 9 and zustand 4).
    - `@react-three/rapier` peers `^9.0.4`, which is incompatible with fiber 10. Lupi does not use it.

12. **Plan and sizing.**
    - Phase 0 (about 2 weeks, on v9): pins, API shims, attribute repack, XR frame via `renderer.xr.getFrame()`, and an ExportManager state machine.
    - Phase 1 (about 13–20 engineer-weeks): the v10 + `WebGPURenderer` parity swap.
    - Phase 2: TSL-native features.
    - The riskiest items are XR, the export profile, impostor performance without early-Z or with >256 MiB buffers, and alpha churn. alpha.6 moves every TSL hook into `@react-three/tsl`, and `/legacy` is broken (issue #3921, still open).

---

## 0.1 Target pin set (proposal)

| Package | Today (lock) | Target | Peers / notes |
|---|---|---|---|
| `@react-three/fiber` | 9.6.1 | `10.0.0-alpha.5` exact. alpha.6 is unpublished; the canary `14007b4` is 2026-09-26 | peers `react >=19.0 <19.3`, `three >=0.185.0` (npm) |
| `@react-three/tsl` | – | wait for alpha.6. Canary `10.0.0-canary.490e4992` peers fiber `^10.0.0-alpha.6` | alpha.5 still exports the TSL hooks from `@react-three/fiber/webgpu` |
| `three` / `@types/three` | 0.184.0 | 0.186.1 / 0.186.0 exact | r187 (unreleased) removes `CubeUVReflectionMapping`. Pin exactly. |
| `@react-three/drei` | 10.7.7 | `11.0.0-alpha.7` exact | peers fiber `>=10.0.0-0`, three `>=0.185`, React `<19.3` |
| `@react-three/test-renderer` | 9.1.0 | `10.0.0-alpha.5` | has a `/webgpu` entry with a mocked `GPUCanvasContext` (`dist/index.mjs:876-954`) |
| `react` / `react-dom` | 19.2.4 (declared `^19.0.0`) | `~19.2.4` via `pnpm.overrides` | 19.3.0 is npm `latest` (2026-09-09) |
| `@react-three/postprocessing`, `postprocessing`, `n8ao` | 3.0.4 + 2.19.1, 6.38.3 | **remove** | WebGL-only |
| `@react-three/xr` | 6.6.29 | no v10-compatible version exists | see §5 |
| `r3f-perf` | 7.2.3 | **remove**; use drei 11 `StatsGl` (stats-gl 4.2.3 supports WebGPU) or `<Inspector>` | depends on drei `^9.103.0`, zustand `~4.5.2` |
| `vgpu` | 0.4.0 | 0.4.0 (0.5.0 has breaking changes, **UNVERIFIED**) | peer three `>=0.180 <0.200` |
| `@pmndrs/glyph` | – | 0.1.0 (optional, §3) | peers fiber `>=10.0.0-alpha.4 <11`, three `>=0.185`, React `<19.3` |

---

## 1. Custom shaders: inventory and TSL port approach

### 1.1 Lupi-owned GLSL materials

In total there are 8 material sites with about 1,282 lines of GLSL. All of them fail on both `WebGPURenderer` backends. Line counts are taken from the template-string boundaries.

| # | Site | Kind | GLSL lines (vert+frag) | GLSL features to replace |
|---|---|---|---|---|
| A | `packages/scene/src/AtomsOptimized.tsx:1307` (shaders `:318-424`, `:426-833`) | `RawShaderMaterial` GLSL ES 3.00, instanced quad | 107 + 408 = **515** | 36 uniforms. Palettes: `uPalette`, `uColormap`, `uRadiusPalette` (R32F, **vertex-stage** fetch), `uMaterialPalette`. `gl_InstanceID`. `mix(pos, target, uProgress)` lerp. Sub-pixel collapse. `#extension GL_EXT_conservative_depth` + `layout(depth_greater)` (`:427-438`). `gl_FragDepth` (`:823`). `cube_uv_reflection_fragment` IBL via `CUBEUV_*` defines (`:316`, `:835-920`). Hand-rolled sRGB OETF behind `uOutputSrgb` (`:829-831`, set in `onBeforeRender` `:1582-1596`). `LUPI_QUALITY` compile tiers (`:914-934`). Etch texture. UV noise and scratch. Ortho path. |
| B | `packages/scene/src/Bonds.tsx:769` + `bondImpostor.ts:21-304` | `RawShaderMaterial`, instanced box | 74 + 209 = **283** | Ray-cast flat-capped cylinder. `layout(depth_greater)` (`bondImpostor.ts:105`). `gl_FragDepth` (`:297`). CubeUV IBL (`:19`). OETF (`:301`). Per-vertex basis from `cross` (`:55-80`). `uProgress` lerp over 4 attributes. Fade uniforms. |
| C | `packages/scene/src/AtomClusters.tsx:198` (`:36-128`) | `ShaderMaterial`, transparent, `depthWrite:false` | 44 + 48 = 92 | Sphere impostor splats. `gl_FragColor`. Fade by distance. |
| D | `packages/scene/src/VectorGlyphs.tsx:199` (`:72-140`) | `ShaderMaterial`, instanced quad | 46 + 22 = 68 | Cylindrical billboard arrow. AA silhouette. Colormap texture. `#include <colorspace_fragment>` (`:138`). `uProgress` lerp. |
| E | `packages/scene/src/BillionAtomBlock.tsx:236` (`:77-210`) | `ShaderMaterial` GLSL3, 4 tier meshes from one factory | 104 + 29 = 133 | `gl_InstanceID` → brick/cell/FCC site decode. `texelFetch` of an RGBA32F brick texture. Integer `hash1` jitter. `uTime`. Fog. `discard`. |
| F | `packages/ui/src/ProceduralBackground.tsx:336-343` (`:182-302`) | JSX `<shaderMaterial>` on a 128×64 sphere | 8 + 112 = 120 | Hash, value noise, fbm, `uVariant` switch, `uTime`. |
| G | `packages/ui/src/app/AppBackground.tsx:241` (`:57-96`) | `ShaderMaterial` panorama dome | 7 + 32 = 39 | Equirect map, gradient, brightness/saturation/contrast, pattern modes. |
| H | `packages/ui/src/MoleculeFilterShell.tsx:79-89` (`:123-155`) | JSX `<shaderMaterial>` sphere shell | 12 + 20 = 32 | Fresnel/sheen, `#include <colorspace_fragment>` (`:153`). |

**TSL port approach for each material.** Difficulty is rated S/M/L/XL. The last column records whether a proven example exists.

| # | Approach | Difficulty | Proven example |
|---|---|---|---|
| **A atoms** | **Material:** `MeshBasicNodeMaterial`, keeping the custom BRDF in `colorNode`/`outputNode`, or `MeshStandardNodeMaterial` with `normalNode`, `roughnessNode`, `metalnessNode` and `emissiveNode` taken from palette lookups.<br>**Vertex:** `vertexNode` (clip-space output) or `positionNode` in view space, built from `attribute('instancePosition')`, `attribute('instanceTargetPosition')` and `uProgress`. Collapse to a degenerate clip point with `select(...)`. Pass varyings with `.toVarying()`.<br>**Fragment:** an `Fn` that does the ray-sphere hit, `Discard()` or `maskNode`, then shading.<br>**Depth:** `material.depthNode = viewZToPerspectiveDepth(hitViewZ, cameraNear, cameraFar)` (or `viewZToOrthographicDepth` / `viewZToReversedPerspectiveDepth`). `depthNode` exists (`three.webgpu.js:21808-21814`, applied in `setupDepth` `:22212-22250`). Because it outputs window-space [0,1] depth it works on both backends, so the current `ndcDepth*0.5+0.5` goes away.<br>**IBL:** `pmremTexture(envMap, dir, roughness)` (`:27986`) replaces `cube_uv_reflection_fragment`, the `CUBEUV_*` defines and `syncCubeUvEnvironment` (`AtomsOptimized.tsx:884-910`). That code dies with r187 anyway.<br>**Output colour:** remove `uOutputSrgb` and the OETF. Node materials output linear and the renderer's output pass encodes.<br>**Pixel scale:** use `screenSize`/`viewportSize` plus `cameraProjectionMatrix` instead of `syncImpostorRenderTargetUniforms` (`:945-966`).<br>**Palettes:** keep them as `DataTexture`s. Fetch R32F with `.load()` (textureLoad) or switch to HalfFloat, because float32 is unfilterable on WebGPU without `float32-filterable`.<br>**Tiers:** replace compile defines with separate cached materials, or with `If` plus a uniform.<br>**Attributes (blocker):** repack type/prop/occlusion into one `Uint8Array(capacity*4)` with itemSize 4 (`unorm8x4`/`uint8x4`) or into a `Uint32`. r186 WebGPU rejects itemSize-1 u8/u16 (`three.webgpu.js:84138-84142`, `84624-84654`). Keep partial `addUpdateRange` uploads working on the repacked layout. | **XL** | No impostor example exists in three's 230 `webgpu_*` examples or in the 268 `react-three-examples` ports (searched `files.json` and `r3e-examples.json`). Closest templates: `webgpu_instance_sprites`, `webgpu_instance_points`, `webgpu_reversed_depth_buffer`, `webgpu_camera_logarithmicdepthbuffer`. |
| **B bonds** | Same pattern as A: `attribute()` for start, end, targets and radius; the basis in the vertex `Fn`; the cylinder ray-cast plus `depthNode` in the fragment.<br>The `Uint8×3` colours (`Bonds.tsx:734-736`) are padded to x4 by three on **every upload** (`three.webgpu.js:84217-84255`, a CPU copy), so author them as `Uint8×4`. | L | none (as A) |
| **C clusters** | A `MeshBasicNodeMaterial` impostor with transparency; no depth write. | S | as A |
| **D vector glyphs** | `vertexNode` cylindrical billboard, colormap `texture()`, AA with `fwidth` in TSL. | M | `webgpu_instance_sprites` |
| **E billion atoms** | `instanceIndex` replaces `gl_InstanceID`. `textureLoad` of the brick texture via `texture(tex).load(ivec2)`. Integer hash with `uint` ops. Same sphere shading. | M | `webgpu_compute_points`, but only for index-derived positions |
| **F procedural sky** | Straight TSL port of the fbm (`mx_noise` / `mx_fractal_noise` exist in TSL); `uTime` via the `time` node. | M | `webgpu_tsl_*` noise examples |
| **G panorama dome** | `MeshBasicNodeMaterial` with `colorNode` from the equirect texture and adjustments. Or drop it for `<Canvas background>` / `scene.backgroundNode`. | S | `webgpu_equirectangular`-class examples (not individually checked) |
| **H filter shell** | Fresnel in `colorNode`/`opacityNode`. This is where OIT (`oitPass`, r186) can help later. | S | – |

**Built-in materials convert automatically.** `WebGPURenderer` maps `MeshBasicMaterial`, `MeshStandardMaterial`, `MeshPhysicalMaterial` and `LineBasicMaterial` to node equivalents, so these need no port:
- `GhostAtoms.tsx:22`, `studioEnvironment.ts:154,165`, `InterpolatedAtoms.tsx:68` (unused)
- `SimulationCell.tsx:26`, `AtomTrails.tsx` lines, the JSX `<mesh*Material>` in annotations, XR and the filter shell
- `export/instanceBake.ts:45`

`instanceBake.ts:60` only clears `onBeforeCompile`, which is harmless.

### 1.2 Third-party GLSL/WebGL code pulled into the viewer

| Source | Where Lupi uses it | Status on `WebGPURenderer` |
|---|---|---|
| drei `Text` (troika SDF via `onBeforeCompile`) | 10 JSX sites (§3) | Broken. drei 11 status: `todo`. troika has no WebGPU support ([three.js forum thread](https://discourse.threejs.org/t/troika-three-text-and-webgpu/55737)). |
| drei 10 `ContactShadows`, `MeshTransmissionMaterial`, `Line` (Line2 `ShaderMaterial`), `Grid` | `ViewerScene.tsx:135`, `SpatialAnchor.tsx:102`, `AtomsTransmission.tsx:609`, `MeasurementLayer.tsx:1`, `Testbed.tsx:3` | Import from `@react-three/drei/webgpu`, which has TSL versions. The MTM props Lupi passes all exist there (`webgpu/index.d.ts:180-205`). |
| `@react-three/postprocessing` / `postprocessing` / `n8ao` | `ScenePostprocessing.tsx:16-17` | Not supported (§2). |
| `@pmndrs/xr` pointer ray and cursor materials (`onBeforeCompile`) | the XR ray pointer configured in `viewer/xrStore.ts:38-42` | `packages/xr/src/pointer/ray.ts:43`, `cursor.ts:45`. They render wrongly or not at all **(inference)**. |
| three `XREstimatedLight` (`XRWebGLBinding`, `renderer.getContext()`) | `xr/XRLightEstimation.tsx:31,48` | WebGL-only (`examples/jsm/webxr/XREstimatedLight.js:23-66`). |
| `r3f-perf` | `ViewerApp.tsx:98` (dev only) | Uses WebGL `gl.info` and timer queries. **UNVERIFIED** on WebGPU; drop it. |
| vgpu `tslExports` (`wgslFn`) | `gpu-studio/runtime.ts:28,47,237-248` | Runs on the WebGPU backend only. |

### 1.3 Cross-cutting shader-port hazards

- **Early-Z loss (performance).**
  - three r186 emits no conservative-depth qualifier. `grep fragment_depth|EXT_conservative_depth three.webgpu.js` finds nothing.
  - WGSL's `@builtin(frag_depth, greater)` is a draft ([proposal](https://github.com/gpuweb/gpuweb/blob/main/proposals/fragment-depth.md)). Chrome has an Intent to Ship with no milestone ([blink-dev](http://www.mail-archive.com/blink-dev@chromium.org/msg17263.html)).
  - Writing `frag_depth` "typically forces the GPU to disable early-Z for the entire draw call" ([gpuweb #5342](https://github.com/gpuweb/gpuweb/issues/5342)).
  - Lupi's own comment (`AtomsOptimized.tsx:24-28`) says it depends on early-Z for "dense scenes with heavy overdraw".
  - Mitigations:
    - Keep sub-pixel culling.
    - Add a depth pre-pass or a compute-culled indirect draw (the `culling.wgsl` idea).
    - Measure before committing to the million-atom tiers.
- **Buffer limits.**
  - three requests only default limits (fact sheet #30). WebGPU's default `maxBufferSize` is 256 MiB, so `instancePosition` f32×3 overflows above about 22.3M atoms. `instanceTargetPosition` adds a second buffer of the same size.
  - Lupi's ceiling is 50M (`deviceCapabilities.ts:30`).
  - Fix: request `requiredLimits: { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: … }` in the R3F renderer factory, or split instances across several meshes.
  - The bond compute already asks for 512 MB limits (`packages/renderer/src/pipeline/AtomPipeline.ts:403-409`).
- **Vertex-stage texture reads.** WGSL disallows `textureSample` in the vertex stage. TSL's vertex-stage `texture()` should emit a level-0 or `textureLoad` variant **(UNVERIFIED)**, so use `.load()` explicitly for `uRadiusPalette` and the brick texture.
- **Velocity for temporal effects (TRAA, TAAU, `@pmndrs/upscaler`).**
  - The built-in velocity MRT derives from object matrices, so it will not know about `uProgress` GPU lerps or impostor depth.
  - Expect ghosting unless the impostors write their own velocity into `mrtNode` (`three.webgpu.js:21897`). **UNVERIFIED.**
- **Testing coupling.** These assert on GLSL strings or `ShaderMaterial` internals and must be rewritten:
  - `packages/scene/src/AtomsOptimized.test.ts`
  - `bondImpostor.test.ts`
  - `VectorGlyphs.test.tsx`
  - `packages/ui/src/export/artifactSceneReadiness.test.ts`
  - `tests/ui/scene-remix.spec.ts:44` (`fragmentShader.includes('fresnel')`)
- **De-risking option (on the current v9 stack).**
  - r184+ `WebGLNodesHandler` lets TSL `NodeMaterial`s render on the classic `WebGLRenderer` (fact sheet #24). The impostor TSL ports could therefore be built and pixel-compared on today's WebGL viewer, with today's pmndrs post stack still attached, before the renderer swap.
  - Limits: no MRT, transmission, node post, or `compile()`.
  - Whether `depthNode` and custom instanced attributes work under the handler is **UNVERIFIED**.

---

## 2. Postprocessing: pmndrs stack → TSL `RenderPipeline` via `useRenderPipeline`

Today's chain lives in `packages/ui/src/postprocess/ScenePostprocessing.tsx`:
- `EffectComposer` (`:44`, `multisampling` `:46`, remounted by `composerKey`)
- `N8AO` (`:58`: aoSamples 16, denoiseSamples 8, denoiseRadius 12, `depthAwareUpsampling`, world-space `aoRadius` in Å)
- `Bloom` (`:69`, `mipmapBlur`, threshold and smoothing)
- `DepthOfField` inside `AutoFocusDof` (`:77`, `:142`, which autofocuses on `controls.target`)
- `ToneMapping` (`:86`, ACES or Reinhard only)
- `Vignette` (`:91`)

Presets (`presets.ts`) use MSAA 4 (`:67-119`). `reduceForMobile` caps MSAA at 2 and drops AO, Bloom and DOF (`:128-134`). `reduceForPlayback` sets MSAA to 0 (`:172-183`).

| Lupi effect | TSL replacement (three 0.186.1 `examples/jsm/tsl/display/*`) | Notes |
|---|---|---|
| `EffectComposer` + remount on `composerKey` | `useRenderPipeline(({ renderPipeline, passes }) => …)` (fiber alpha.5 `/webgpu`; `@react-three/tsl` from alpha.6). `pass(scene, camera, { samples })` | Rebuild `outputNode` when the effect set changes. MSAA moves to pass samples, since `antialias` is constructor-only. Proven: r3e `postprocessing-*` ports. |
| `N8AO` | `ao(depth, null, camera)` (GTAONode `:719`). With `normalNode` null it reconstructs normals from depth (`GTAONode.js:428`), which is exactly why N8AO works with impostors today (`ScenePostprocessing.tsx:50-57`). Alternative: `ssao()` (r186, `SSAONode.js:436`) plus `depthAwareBlur`. | GTAO became physically based in r185, so retune radius and scale. `distanceExponent`/`distanceFallOff` are deprecated in r186. `resolutionScale 0.5` lets mobile keep AO. Proven: r3e `postprocessing-ao`, `gtao`. |
| `Bloom` (mipmapBlur) | `bloom(node, strength, radius, threshold)` (`BloomNode.js:597`) plus `smoothWidth` | Selective bloom through an emissive MRT or a per-material `mrtNode`. The atom palette already carries emission (`uMaterialPalette`). Proven: r3e `postprocessing-bloom-selective`. |
| `DepthOfField` with autofocus | `dof(color, viewZ, focusDistance, focalLength, bokehScale)` (`DepthOfFieldNode.js:572`), all in world units | Drive the `focusDistance` uniform per frame from camera→`controls.target`. `focusRange` has no 1:1 mapping, so retune. Proven: r3e `postprocessing-dof`. |
| `ToneMapping` ACES/Reinhard | Either `renderer.toneMapping` with `RenderPipeline.outputColorTransform = true`, or `renderOutput(node, toneMapping, colorSpace)` with `outputColorTransform = false` | **Recommendation:** keep the invariant "the renderer does no tone mapping" (`ViewerCanvas.tsx:45-53`). Do the tone map inside `outputNode` so the raw-scene export path stays untone-mapped. AgX and Neutral are registered (`three.webgpu.js:90368-90369`). Proven: r3e `tonemapping`. |
| `Vignette` (offset, darkness, NORMAL blend) | CRT.js `vignette(color, intensity, smoothness)` (`CRT.js:140`) | Parameter semantics differ, so retune. |
| MSAA 0/2/4 | pass `samples`. Or `smaa()` (`SMAANode.js:729`), `fxaa()` (`FXAANode.js:364`), or `traa()` (`TRAANode.js:641`, needs a velocity MRT) | TRAA needs MSAA off plus correct velocity (§1.3). |

**Features with no equivalent:**
- N8AO's specific denoise and look.
- `BlendFunction` variety for vignette.
- rpp 3.1's `DepthPicking` / `useDepthPicking` and `EffectGroup` / `mergeMode`. Lupi does not use these.
- A synchronous depth-under-cursor read. The only path is async RT readback.

---

## 3. drei inventory → drei 11 alpha.7, and label rendering

The entry mapping was checked against the tarball's `index`/`core`/`legacy`/`webgpu` `.d.ts` files. Status and "exercised" flags come from `component-status.json` (`v11-working@fbd5b12`).

| Symbol | Lupi sites | drei 11 entry | Status | Action |
|---|---|---|---|---|
| `Text` | 10 JSX in 5 files:<br>`KnowledgeLabelsLayer.tsx:356`<br>`AnnotationsLayer.tsx:150,196,238` (`:196` is one Text per halo glyph)<br>`MeasurementLayer.tsx:50,64`<br>`SpatialAnchor.tsx:112`<br>`xr/XRControlPanel.tsx:53,63,78` | `/legacy` only | **todo**: "Depended on a vendored troika fork that could not be published. Returns via @pmndrs/glyph… #2658" | Replace; see below |
| `Billboard` | `MeasurementLayer`, `KnowledgeLabelsLayer`, `SelectionMarkers.tsx:7`, `AnnotationsLayer` | core | agnostic | None |
| `Html` | `KnowledgeLabelsLayer.tsx:254`, `AnnotationsLayer.tsx:103` (`occlude`), `AtomInfoHUD.tsx:319,331` | core | agnostic | None. DOM overlay. |
| `OrbitControls` | `ViewerScene.tsx:731`, `BillionAtomsPage.tsx`, `Testbed.tsx` | core | agnostic. It uses `useFrame(…, { before: 'update' })` (`core/index.mjs:1620-1625`). | None |
| `GizmoHelper` / `GizmoViewport` | `ViewerScene.tsx:726-728` | core | agnostic; GizmoViewport `exercised: false` | **Hazard.** It renders through `Hud` with legacy `useFrame(…, renderPriority = 1)` and calls `gl.render(defaultScene, defaultCamera)` directly (`core/index.mjs:782-796, 2964-3030`). Under v10 this disables the default render job and bypasses `renderPipeline`, so there is no postprocessing while axes are shown. Replace it with a render-phase HUD job, a secondary v10 canvas (WebGPU only), or a DOM/SVG gizmo. |
| `ContactShadows` | `ViewerScene.tsx:135` (`BudgetedContactShadows`), `SpatialAnchor.tsx:102` | `/webgpu` | implemented (has a test file, but the test asserts nothing) | Import from `/webgpu`. Re-verify the `frames={0}` budget behaviour. |
| `MeshTransmissionMaterial` | `packages/scene/src/AtomsTransmission.tsx:27,609` | `/webgpu` | implemented; props compatible | A new implementation changes bytes: bump the `transmission` runtime fingerprint (`mcp/transmissionRuntime.ts`). The CPU `setMatrixAt` loop stays. |
| `Line` | `MeasurementLayer.tsx:1` | `/webgpu` (Line2NodeMaterial) | implemented | Import from `/webgpu` |
| `useEnvironment` / `Environment` | `SceneLighting.tsx:19` / `Testbed.tsx:3` | core, and also in R3F v10 core | agnostic; `useEnvironment` `exercised: false` | Keep. Swap Lupi's own PMREM to `three/webgpu` (§4). |
| `RoundedBox` | `xr/XRControlPanel.tsx:3` | core | agnostic | None |
| `Grid` | `Testbed.tsx:3` | `/webgpu` | implemented | Import from `/webgpu` |

Audit totals: 144 components, 107 agnostic, 27 implemented, 4 todo, 6 won't-port, but only **`withRealTest: 1`**. Budget for runtime verification of every component Lupi uses.

**What replaces troika `Text` on WebGPU.** Options, ranked for Lupi:

1. **`@pmndrs/glyph` 0.1.0** (published 2026-09-18).
   - MSDF/Slug text, with HarfRust shaping in Wasm.
   - Supports `WebGPURenderer` on both backends, but not classic WebGL. The React API is `GlyphProvider` + `<Text font=…>` ([README](https://github.com/pmndrs/glyph)).
   - Costs:
     - Fonts must be baked with `glyph bake … --msdf --slug` into `.font.glb` files served from `/public`. Today Lupi's Text uses troika's default fetched font; no `font=` prop is set.
     - Wasm init.
     - Pre-1.0 churn.
   - It has MSDF outlines (Lupi uses `outlineWidth` in 5 sites) and "break-apart glyphs", which suit playful labels.
   - Bundle and Wasm size are **UNVERIFIED**.
2. **CanvasTexture sprites** (`SpriteNodeMaterial` / `MeshBasicNodeMaterial` in a `Billboard`).
   - Zero new dependencies. The same approach Lupi already uses for the atom etch stamp (`AnnotationsLayer.tsx:265`, `ViewerScene.tsx:312`) and in three's `examples/jsm/webxr/Text2D.js`.
   - Good enough for measurement and knowledge labels; the fallback if glyph slips.
3. **Promote more labels to `Html`.** Cheap for a few labels. `KnowledgeLabelsLayer` already re-renders about 20 times a second (fact sheet #35), so fix that first.
4. [`countertype/three-text`](https://github.com/countertype/three-text) (TSL node materials). An alternative, not evaluated.

**Recommendation:** add a `<LupiText>` shim with troika-compatible props (`fontSize`, `anchorX/Y`, `outlineWidth`, `color`). Implement it with glyph on `WebGPURenderer`, and keep canvas sprites as the fallback for the XR panel.

---

## 4. R3F API changes that hit Lupi

### 4.1 Census (non-test sources)

| Change in v10 (evidence) | Lupi sites | Fix |
|---|---|---|
| `state.gl` → `state.renderer`. `gl` is still a getter with a deprecation warning (`fiber@10.0.0-alpha.5 dist/index.mjs:996-1015`). | 14 accesses in 10 files:<br>`viewer/ViewerCanvas.tsx:77` (`onCreated`)<br>`scene/AtomsOptimized.tsx:1194`<br>`scene/Bonds.tsx:768`<br>`scene/AtomPicker.tsx:45`<br>`SceneLighting.tsx:49,67`<br>`ExportManager.tsx:219,455`<br>`hooks/useEquirectMediaTexture.ts:61`<br>`xr/useXRHands.ts:78`<br>`xr/XRLightEstimation.tsx:39`<br>`DevProbe.tsx:130,137,191` | Mechanical |
| `state.clock` removed. Use `state.elapsed`/`time`/`delta`. | `SelectionMarkers.tsx:99-101`, `BillionAtomBlock.tsx:303,356` | Mechanical |
| **Numeric priority is shimmed, but the order is reversed** (see TL;DR #4). Jobs with `n > 0` suppress the default render (`index.mjs:1157-1172, 14518-14530`). | `ExportManager.tsx:180` (2, video), `:349` (-0.5, canonical state), `:449` (100, capture) | Rewrite as named phases: canonical state `{ phase:'update', after:'<controls>' }`; capture `{ phase:'render' }` (a render-phase job takes over rendering). The video loop becomes a plain `update` job that leaves the default render and pipeline running. |
| `useFrame` callbacks receive `(state, delta)`; **no `XRFrame`** (`index.mjs:1175-1186`; XR loop `:14360-14364` ignores `_frame`). The canary is identical (`shared/fiber.Ch4JrXS2.mjs:14127-14131`). | `xr/useXRHands.ts:92` (`(_state, dt, xrFrame)`) | Use `renderer.xr.getFrame()`, which works on v9 and v10 |
| Canvas props `flat`/`linear`/`legacy`/`colorSpace`/`toneMapping` removed. The default configure sets `ACESFilmicToneMapping` + sRGB (`index.mjs:14419-14422`). | `ViewerCanvas.tsx:77` already forces `NoToneMapping` in `onCreated` | Keep it, now on the `renderer` |
| `gl` vs `renderer` props. Passing both throws. The WebGPU defaults are `{ antialias: true }` only (`index.mjs:14185-14188`). | `VIEWER_GL_OPTIONS` (`ViewerCanvas.tsx:26-31`), `BillionAtomsPage.tsx:100-103`, `Testbed.tsx:67` | Use `renderer={async (props) => …}`. See §4.2. |
| `<color attach="background">` deprecated in favour of `<Canvas background>` | `BillionAtomsPage.tsx:106` | Mechanical |
| `onUpdate` removed (canary) | none on R3F elements (`FlythroughPanel.tsx:395` is a DOM prop) | – |
| Camera is in the scene graph (alpha.3) | No `scene.children[...]` indexing. `scene.traverse` sites (`renderCaptureState.ts:153,188`, `artifactSceneReadiness.ts:57`, `DevProbe.tsx:33,72`) will now visit the camera, which is harmless because they filter by `userData` or type. | Verify only |
| Canvas `id` registers a primary canvas under WebGPU (`index.mjs:14243-14255`) | `ViewerCanvas.tsx:68` `id="lupi-viewer-canvas"`. It is also used as the DOM selector in `renderArtifactAdapter.ts:553` and `captureViewerThumbnail.ts:60`. | Keep. It enables secondary canvases (§7). |
| Events: per-pointer `pointerMap`, `frameTimedRaycasts` (defaults true, only when `frameloop==='always'`), `interactivePriority` | R3F pointer props appear only in XR (`XRMoleculeInteraction.tsx:394-398`, `XRControlPanel.tsx:41-43`). Main picking is a custom window `mousemove` ray-march (`AtomPicker.tsx:57-156`). | Low impact. Optionally move AtomPicker onto the `input` phase. |
| Frameloop is per root; `maxDelta` defaults to one frame | `ViewerCanvas.tsx:67` (`paused ? 'never' : 'always'`). ExportManager uses `setFrameloop`, `setDpr`, `setSize` (`:455-521, 846-863`). | Those still exist on `RootState` (`index.d.ts:607-613`). Consider `width`/`height` props for fixed-size capture. |
| `renderer.capabilities` does not exist on `WebGPURenderer` (use `renderer.getMaxAnisotropy()`, `three.webgpu.js:63691`) | `equirectTexture.ts:36,59,87` | Write a helper that handles both |
| `PMREMGenerator` must come from `three/webgpu` (the WebGL version cannot drive `WebGPURenderer`) | `SceneLighting.tsx:54,70`, `xr/XRLightEstimation.tsx:52` | Import swap. r187 makes PMREMs cube RTs, which breaks the CubeUV assumptions in `sceneEnvironment.ts:95-133` and `AtomsOptimized.tsx:884-910`. |
| `onBeforeRender(renderer, …)` typed `WebGLRenderer` | `AtomsOptimized.tsx:1582-1596`, `Bonds.tsx:866-876` | Deleted by the TSL port |
| WebGL context probes | `AtomsOptimized.tsx:974-996` (`EXT_conservative_depth`); `renderCapability.ts:73-79` (it accepts WebGL1, but the fallback needs WebGL2) | Rework the capability gate to test WebGPU, then WebGL2 |
| test-renderer entry points (`/legacy`, `/webgpu`) (v10 migration doc) | 5 files: `AtomsOptimized.test.ts`, `Bonds.fallback.test.tsx`, `VectorGlyphs.test.tsx`, `SpatialAnchor.test.tsx`, `xr/XRMoleculeInteraction.test.tsx`. Plus `@react-three/xr` mocks in `setupTests.ts:56`, `ViewerCanvas.test.tsx:10`, `SpatialAnchor.test.tsx:7`. | Use `@react-three/test-renderer@10.0.0-alpha.5/webgpu` |

The full `useFrame` count is **32 call sites in 26 files**. The per-file breakdown is: ExportManager 3; XRControlPanel, ProceduralBackground, BillionAtomsPage and AtomTrails 2 each; every other file 1.

Only the 3 ExportManager sites, the 2 `clock` sites and the 1 `XRFrame` site need semantic changes. The others compile unchanged, and phase or fps tuning is optional (see `r3f-releases.md` §4).

### 4.2 Canvas setup under v10 (proposal)

**Renderer factory.** `<Canvas id="lupi-viewer-canvas" renderer={createLupiRenderer} …>`, where `createLupiRenderer(props)` does the following:
1. Call `navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })`.
2. Call `adapter.requestDevice({ requiredLimits: { maxBufferSize, maxStorageBufferBindingSize, maxStorageBuffersInVertexStage? } })`.
3. Return `new WebGPURenderer({ ...props, device, alpha: true, antialias: false, outputBufferType: tier === 'mobile' ? UnsignedByteType : HalfFloatType })`.
4. With no adapter, return `new WebGPURenderer({ ...props, forceWebGL: true })`.

R3F awaits `init()` and sets `state.webGPUSupported` (`index.mjs:14230-14242`).

**Consequences.**
- `outputBufferType` is a documented option (`three.webgpu.js:90414`). The HalfFloat default doubles framebuffer bandwidth on phones **(inference)**.
- All vgpu-WGSL features must be gated on `state.webGPUSupported`, because the fallback silently lacks them.

---

## 5. `@react-three/xr` and WebXR

**Status.**
- `@react-three/xr` 6.6.30 (2026-05-29) peers `@react-three/fiber >=8`, so npm will not block the install, but there is **no v10 line**.
- The pmndrs `react-three-examples` README says: "WebXR (29): deferred … `@react-three/xr` has no v10 branch, and today even the `webgpu_xr_*` originals swap in a WebGL renderer at session start, a swap fiber cannot express. Revisit when `XRGPUBinding` ships." (scratchpad `gh/react-three-examples.README.md:90-92`; https://github.com/pmndrs/react-three-examples)

**Concrete breakages, read from the `pmndrs/xr@8d2fda1` source.**
- **`XRFrame` third argument is dropped in v10:**
  - `packages/react/xr/src/xr.tsx:102`: `useFrame((state,_d,frame) => store.onBeforeFrame(state.scene, state.camera, frame), -1000)`
  - `hand.tsx:36`, `space.tsx:251`, `hit-test.tsx:103`, `layer.tsx:527`, `controller-locomotion.ts:37`
- **Negative priorities now run last instead of first:** `xr.tsx:102` (-1000) and `xr.tsx:132` (-50).
- **`s.gl.xr`:** `xr.tsx:80`, `origin.tsx:19`. This works through the deprecated getter.
- **WebGL-only code:**
  - `XRWebGLLayer.getNativeFramebufferScaleFactor` (`packages/xr/src/store.ts:803`)
  - WebGL layers (`layer.tsx:195,474-527`, `packages/xr/src/layer.ts:299`)
  - `onBeforeCompile` pointer materials (`pointer/ray.ts:43`, `cursor.ts:45`)

**three side.**
- `XRManager` supports `XRGPUBinding` when present (`three.webgpu.js:59544-59545, 60064-60086`). Otherwise it calls `renderer.backend.makeXRCompatible()` and uses `XRWebGLLayer`, which exists only on the WebGL backend.
- PR #33583 says "Currently only WebGL is supported for WebXR" ([mrdoob/three.js#33583](https://github.com/mrdoob/three.js/pull/33583)).
- r186 ships `setupWebGLXRFallback(renderer, createFallbackRenderer, onFallback)`. It **replaces the renderer** at `setSession` when `XRGPUBinding` is missing (`examples/jsm/webxr/WebGLXRFallback.js:1-70`).
- `XRGPUBinding` is an Editor's Draft (2026-06-15). Chrome has it behind the "WebXR Projection Layers" and "WebXR/WebGPU Bindings" flags ([spec](https://immersive-web.github.io/WebXR-WebGPU-Binding/), [toji.dev](https://toji.dev/2025/03/03/experimenting-with-webgpu-in-webxr.html)). Quest Browser support is **UNVERIFIED**.

**Lupi's own XR code** (7 non-test files under `packages/ui/src/xr/`, plus `viewer/xrStore.ts`, `SpatialAnchor`, `SceneLighting`, `AppBackground`, `ScenePostprocessing` and `ViewerCanvas`):
- `useXRHands.ts:92` needs `renderer.xr.getFrame()`.
- `XRLightEstimation.tsx` (`XREstimatedLight`) only works with a WebGL context. Under a `forceWebGL` `WebGPURenderer` it still calls `renderer.getContext()` and `renderer.properties` (`XREstimatedLight.js:29,62`) **(UNVERIFIED)**.
- `xrStore.ts` `customSessionInit` with `layers` and `light-estimation`.

**Options.**

| Option | Mechanics | Assessment |
|---|---|---|
| (a) XR remount | When an immersive session is requested, unmount the viewer Canvas and remount it with `renderer={{ forceWebGL: true }}`. Fork `@react-three/xr` so it reads `XRFrame` via `renderer.xr.getFrame()`, uses phases, and replaces the `onBeforeCompile` pointers. | The scene (all TSL) runs on the WebGL2 backend, so XR loses vgpu WGSL features. Fork maintenance cost. |
| (b) Separate XR bundle on v9 | Keep XR on a separate v9 + drei 10 + xr 6 bundle via package aliasing, with a shared three r186. | Duplicate React reconciler; feasibility **UNVERIFIED** (glyph PR #193 hints that dual targeting works). GLSL materials would have to survive in parallel. |
| (c) Defer immersive XR | Ship v10 without immersive XR and keep iPhone AR via USDZ Quick Look (the exporter exists). | Cheapest. Needs a product call. |

---

## 6. Export and render-artifact determinism

**What V1 assumes today.**
- `docs/render-artifact-contract.md:64-69`: "Mounted WebGL viewer…", raw scene, DPR 1, sRGB, no tone mapping.
- `:235-273`: straight alpha; `multisampling: 0`.
- `AGENTS.md` "Render artifact V1 truth".
- Code:
  - `renderArtifactAdapter.ts:40` (`BROWSER_RENDERER_VERSION_V1 = 'lupi-browser-webgl.v1'`)
  - `:390-412` (`executionClass: 'browser-webgl-main-thread'`, determinism flags including `preserveDrawingBuffer: true`)
  - `:536-579` (the runtime probe calls `canvas.getContext('webgl2')` on the viewer canvas)
- Capture: `ExportManager.tsx:387-403` (`gl.render` then `drawImage(gl.domElement)` inside the priority-100 job); `renderCaptureState.ts:230-360`.
- Thumbnails: `viewer/captureViewerThumbnail.ts:17-31`, which relies on the preserved drawing buffer.
- Parity gate: `tools/verify-render-parity.mjs:131-140` (`RENDERER_BEHAVIOR_PROFILE_V1`, pinned to `three-r184`) and `:440-465` (checks context attributes `preserveDrawingBuffer===true`, `antialias===false`, and a SwiftShader WebGL renderer). `tools/verify-asset-quality.mjs:786` launches with `--disable-webgpu`.

**What changes.**

1. **The pixel pipeline differs.**
   - `WebGPURenderer` renders into a linear HalfFloat framebuffer target whenever the output colour space ≠ the working space (`three.webgpu.js:63222-63250, 64270-64276`). It then does an output pass to the canvas.
   - Classic WebGL wrote sRGB directly from each material into RGBA8.
   - Blending precision, quantisation and alpha all change, so every V1 byte changes.
   - The WebGPU and WebGL2 backends of `WebGPURenderer` also differ from each other (GLSL vs WGSL codegen and canvas formats; the WebGPU preferred format is often `bgra8unorm`, `:77696-77702`). They need **two execution classes**, for example `browser-webgpu-main-thread` and `browser-webgpu-webgl2-main-thread`.
2. **No `preserveDrawingBuffer`.**
   - The WebGPU canvas is configured with `usage: RENDER_ATTACHMENT | COPY_SRC` and `alphaMode: 'premultiplied'` when `alpha` is set (`:87310-87320`). WebGPU has no preserve flag ([gpuweb#2743](https://github.com/gpuweb/gpuweb/issues/2743)).
   - Reading the canvas is defined only for the current drawing buffer within the task ([gpuweb#1781](https://github.com/gpuweb/gpuweb/issues/1781)).
   - The WebGL2 fallback creates `{ antialias, alpha: true, depth, stencil }` with no `preserveDrawingBuffer` (`:74218-74225`).
   - As a result, `captureViewerThumbnail`, which is called from an unrelated UI task, returns a blank or cleared image, and `verify-render-parity`'s context check fails.
3. **Recommended V2 capture path.**
   - Inside a `{ phase: 'render' }` job, apply canonical state with `NoToneMapping` and `outputColorTransform` off.
   - `await renderer.compileAsync(scene, camera)` before the capture frame. This replaces today's warm-up frame (`renderCaptureState.ts:70-80`).
   - Render into an explicit `RenderTarget(w, h, { type: UnsignedByteType, colorSpace: SRGBColorSpace, samples: 0 })`.
   - Call `renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)` (`:64886-64890`). The command is encoded and submitted synchronously and only the `mapAsync` is awaited (WebGPU path `:84560-84600`), so state can be restored immediately **(inference)**.
   - Un-premultiply if needed and encode.
   - **UNVERIFIED:** whether rendering to an sRGB `RenderTarget` applies the output transform identically on both backends. The parity harness must prove it.
   - Thumbnails should use the same RT path at 320×200. Video (`captureStream`, `ExportManager.tsx:7,877`) works on WebGPU canvases in Chrome **(UNVERIFIED on Safari)**.
4. **Fingerprint and contract.**
   - New `renderer` id: `lupi-browser-webgpu.v1`.
   - `rendererVersion: three-r186;bridge-…`.
   - Runtime facts from `GPUAdapter.info` (vendor, architecture, device, description), `getPreferredCanvasFormat()`, the backend kind, `outputBufferType` and `alphaMode`.
   - Replace `preserveDrawingBuffer` in `determinism` with `readback: 'render-target-async'`.
   - Per the contract's own rule (`render-artifact-contract.md:347-348`), a colour, tone or alpha change "creates a new policy or contract version". Treat this as **V2 or a new profile**, not a V1 patch.
   - `artifactKey`s for the same `specId` change by construction.
   - Transparent export: re-prove the straight-alpha criteria (`:239-243`) under the r185 premultiplied-alpha rework ([Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide), r184→r185).
5. **Export layers that change bytes.** The transmission layer (drei 11 MTM is a new implementation) and bonds (still fail-closed for raster).
6. **CI lanes.**
   - `playwright.config.mjs:55` (`--disable-webgpu`) turns into the WebGL2-fallback lane.
   - Add a WebGPU lane with SwiftShader Vulkan, using the flags from `playwright.gpu-studio.config.mjs:17-22`: `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --use-angle=swiftshader`.
   - Rebaseline `tests/fixtures/render-artifact-v1/browser-synthetic-calibration.*` for each lane.

---

## 7. GPU Studio, scan, action-light and bonds: device sharing and folding into the canvas

**Today there are 5 independent GPU contexts or devices:**
- the main WebGL canvas
- GPU Studio: its own adapter and device (`gpu-studio/runtime.ts:151-161`) with `new WebGPURenderer({ device })`
- action-light: a shared low-power vgpu device (`action-light/runtime.ts:16,36`)
- scan swirl (`scan/swirl.ts:89`)
- gist particles, with `requiredLimits: { maxStorageBuffersInVertexStage: 1 }` (`scan/gist/gistParticles.ts:94`)
- plus the optional bond-compute device (`packages/renderer/src/pipeline/AtomPipeline.ts:387-411`, used by `scene/useBondGpuPipeline.ts:4`)

**Sharing mechanics.**
- `renderer.backend.device` is the R3F device.
- vgpu 0.4.0 has `initFromDevice(device)`: "Wraps a device owned by another library … vgpu never destroys what it did not create" (`vgpu@0.4.0 dist/init-from-device.d.ts:1-10`).
- R3F's async `renderer` factory lets Lupi create that device with gist's and the bonds' limits (§4.2).
- One device may configure several canvases, so gist's own canvas surface can stay.
- v10 multi-canvas (`renderer={{ primaryCanvas: 'lupi-viewer-canvas' }}`, `index.mjs:14200-14228`) shares the renderer, not just the device. It is **WebGPU-only**: "The `primaryCanvas` prop … cannot be used with WebGL". Whether it works on the `forceWebGL` backend is **UNVERIFIED**; assume not.

**Can the GPU Studio snowglobe run inside the main v10 canvas? Yes, with a condition.**
- It is `MeshPhysicalNodeMaterial` on `InstancedMesh` spheres (≤5k atoms) with a vgpu WGSL `colorNode` (`runtime.ts:229-274`). That drops straight into the R3F scene as a "Studio look" branch of the atom layer, with `useUniforms` for look, snow, energy and drift, and the DeviceMotion shake as a scheduler job.
- **Condition:** `atom-surface.wgsl` goes through `wgslFn` (`vgpu/dist/three/tsl-exports.js:26`) and so fails on the WebGL2 backend. Either gate it on `state.webGPUSupported` (which matches Studio's current refusal, `runtime.ts:166-172`) or port its 54 lines of WGSL to TSL `Fn`.
- Benefit: this removes the second device, the separate RAF (`runtime.ts:122-148`) and the `paused` frameloop dance (`ViewerCanvas.tsx:67`, `ViewerApp.tsx:664`).
- Alternative: keep Studio as a secondary canvas on the shared renderer.

**Can the gist compute run inside the main canvas? Yes, two ways.**
- **(a)** Keep vgpu and WGSL (`gist-step.wgsl` 364 lines, `gist-points.wgsl` 103 lines) via `initFromDevice(renderer.backend.device)`, and drive `frame()` from a `getScheduler()` job. WebGPU backend only.
- **(b)** Port to TSL: `instancedArray` buffers, `Fn(…)().compute(n)` with `renderer.compute()` in a `physics`-phase job, and instanced quads with `positionNode = buf.element(instanceIndex)`.
  - `gist-step.wgsl` uses a plain `@compute @workgroup_size(64)` per-particle kernel with no atomics, workgroup memory or storage textures (grep). So it is within the transform-feedback limits of the WebGL2 fallback **(inference; performance UNVERIFIED)**.
  - Reading storage in the vertex stage still needs `maxStorageBuffersInVertexStage` on WebGPU. iPhone Safari acceptance is an open question (fact sheet OQ1).
- Keep action-light separate: it is a DOM effect on a low-power device.

**Bonds.** Move `BondPipeline` onto the renderer's device and write bond instances straight into GPU instance or storage buffers. This removes the CPU readback and re-upload (`Bonds.tsx:922-955`). On the fallback, keep the worker CPU path (`bondWorker.ts`), as today when WebGPU is absent.

**r185/r186 changes that affect existing TSL code.**
- `positionLocal` is used in `colorNode` at `gpu-studio/runtime.ts:238`.
  - **Correction to earlier digests:** the Migration Guide lists the change under **r185 → r186**, not r185. It concerns `material.positionNode`: "positionLocal does not update internal vertex transformations such as SkinnedMesh when used in material.positionNode. Use positionGeometry…" ([Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)).
  - r186 documents `positionLocal` as "transformed … instancing … will change the vertex position", with `positionGeometry` as the raw attribute (`three.webgpu.js:15572-15584`).
  - Studio feeds it into a contour pattern (`atom-surface.wgsl:48`), so do a visual diff and switch to `positionGeometry` if per-sphere-local contours are intended.
- The premultiplied-alpha rework (r185) affects GPU Studio's `alpha: true` + `setClearColor(0,0)` (`runtime.ts:161,165`).
- `PCFSoftShadowMap` was removed (r186). Lupi already uses `PCFShadowMap` (`ViewerCanvas.tsx:51-52`).
- r187 (pending) turns PMREMs into cube RTs, which affects `runtime.ts:191-193` `fromScene`. Pin three exactly.

---

## 8. Dependencies and peers

- **React.**
  - Lock: 19.2.4. The declared specifiers are `^19.0.0` in `apps/web`, `packages/ui`, `packages/scene`, `packages/ui-core` and `apps/remotion-trailer`.
  - npm `latest` has been **19.3.0 since 2026-09-09**, which violates `<19.3` for fiber 10 alpha, drei 11, glyph and `@react-three/tsl`.
  - Add `pnpm.overrides: { react: '~19.2.4', 'react-dom': '~19.2.4' }`. The root `package.json` already has an `overrides` block.
  - `apps/mobile` (19.2.3, Expo) does not use R3F; v10 moved React Native into its own package anyway.
- **drei 11 alpha** peers fiber `>=10.0.0-0`, three `>=0.185` and React `<19.3`. It still depends on `troika-three-text`, `maath`, `detect-gpu` 5 and `three-mesh-bvh ^0.9.14` (tarball `package.json`).
- **Dropped:** `@react-three/postprocessing` (3.0.4 in ui, 2.19.1 in web), `postprocessing` and `n8ao`. They are all WebGL-only; rpp 3.1.3 also peers fiber `>=9.7.0`. The Vite `vendor-postprocess` chunk goes away (`apps/web/vite.config.ts:342`).
- **Becomes mandatory:** `vendor-three-webgpu` (about 176 KB gzipped; fact sheet #38). The manual chunking at `vite.config.ts:330-335` must stop treating it as optional. The landing page stays three-free.
- **Not in Lupi but relevant for toys:**
  - `@react-three/rapier` 2.2.0 peers fiber `^9.0.4`: a hard conflict.
  - `@react-three/uikit` 1.0.76 peers fiber `>=8` but uses `onBeforeCompile`, so it is WebGL-only.
  - `@react-three/handle` 6.6.30 peers fiber `>=8`; WebGPU compatibility is **UNVERIFIED**.
- **leva** 0.10.1 is DOM-only with React `^18||^19` peers and is used only in `Testbed.tsx:5`. Fine. drei 11's `useInspectorControls` is a WebGPU-era alternative.
- **Vite `dedupe`** (`vite.config.ts:294`) already lists three, fiber, drei, react, react-dom and zustand. Add `@react-three/tsl` once it is used.
- **API churn to budget for.**
  - alpha.6 moves every TSL hook to `@react-three/tsl`; `/webgpu` in the canary no longer exports `useUniforms`.
  - `onUpdate` is removed.
  - `/legacy` is broken (#3921, open; https://github.com/pmndrs/react-three-fiber/issues/3921).
  - There is still no beta.

---

## 9. Phased migration plan

Sizes are in engineer-weeks for one engineer who knows the codebase, and are rough. Phase 0 lands on today's v9 stack so it can ship on its own.

### Phase 0: prerequisites on v9 (≈2 weeks)

1. **Versions (≈2 days).**
   - Pin React `~19.2.4` with overrides.
   - three and `@types/three` to 0.186.1 exact. v9 peers `>=0.156`, so this works. Expect the harmless "THREE.Clock deprecated" warning.
   - fiber 9.8.1 and drei 10.7.9.
   - Remove `r3f-perf`, the stale `apps/web` rpp 2.x, and zustand 4.
   - Re-run `verify:render-parity` and rebaseline the r184 → r186 drift under V1.
2. **Renderer-agnostic shims (≈2 days).**
   - A `maxAnisotropy(renderer)` helper.
   - `renderer.xr.getFrame()` in `useXRHands`.
   - PMREM through an injected generator factory. `installSceneEnvironmentPmrem` already takes one (`SceneLighting.tsx:50-55`).
   - `state.clock` → `performance.now()` deltas.
3. **Atom attribute repack (≈2 days).** Move to a 4-byte packed `unorm8x4`/`uint8x4` layout (`AtomsOptimized.tsx:1262-1276`) and make bond colours `Uint8×4`. This is valid on WebGL and required on WebGPU.
4. **ExportManager capture state machine (≈3 days).**
   - Replace the numeric-priority trio with one explicit job and a barrier that does not depend on cross-job priority order.
   - Move thumbnails off the preserved drawing buffer, onto a render-target capture.
5. **Optional de-risking (≈1 week).** Build the TSL atom and bond materials behind `WebGLNodesHandler` on the WebGL viewer and pixel-diff them against GLSL. Whether `depthNode` works there is **UNVERIFIED**.

### Phase 1: R3F v10 alpha + `WebGPURenderer` (WebGL2 fallback) at parity (≈13–20 weeks)

| Work package | Size | Exit criteria |
|---|---|---|
| 1a. Platform swap:<br>• fiber `10.0.0-alpha.5`, drei 11 alpha.7, test-renderer 10 alpha<br>• `renderer` factory with limits, `outputBufferType` per tier and `forceWebGL` fallback<br>• the 14 `gl` accesses, `/webgpu` drei imports, `<Canvas background>`<br>• `PMREMGenerator` from `three/webgpu`<br>• the 3 Canvases | 1.5–2 wk | App boots on both backends; `state.webGPUSupported` is logged |
| 1b. Atom impostor TSL port (A), with IBL via `pmremTexture`, tiers, etch, ortho, sub-pixel cull, `depthNode` | 2.5–3.5 wk | Visual parity within tolerance on both backends; an FPS matrix at 100k / 1M / 5M / 10M atoms, including the early-Z loss |
| 1c. Bond TSL port (B) | 1–1.5 wk | Parity plus cutaway fade |
| 1d. Clusters, glyphs, billion-atom block, both backgrounds, filter shell (C–H) | 1.5–2 wk | Parity |
| 1e. `useRenderPipeline` stack (GTAO, bloom, DOF, output tone map, vignette, MSAA/SMAA) and the mobile reductions | 1.5–2 wk | Preset gallery re-tuned; `mobileBudget.test.ts` updated |
| 1f. Scheduler migration: ExportManager phases, GizmoHelper replacement, optional fps and phases for labels | 0.5–1 wk | No legacy-priority deprecation warnings |
| 1g. Labels: `<LupiText>` shim on glyph or canvas sprites for the 10 sites | 1–2 wk | Measurements, knowledge labels and annotations readable at all zooms |
| 1h. Export V2: RT readback, new fingerprint and execution classes, contract and AGENTS.md updates, parity baselines × 2 backends, transparent-alpha proof | 2–3 wk | `verify:render-parity` and `verify:asset-quality` pass in both lanes |
| 1i. XR: option (a) fork or (c) defer | 0.5 wk (defer) … 3–4 wk (fork) | Explicit product decision |
| 1j. CI and tests: WebGPU SwiftShader lane, rewrite the 5 GLSL-string tests, test-renderer `/webgpu` | 1–1.5 wk | CI green in both lanes |

**Gate before Phase 1 starts:** a one-week spike that ports only the atom impostor into a v10 `<Canvas renderer>` sandbox route. Measure:
- the early-Z loss at 1M–5M atoms on a mid-range phone and a laptop
- the fallback on iOS < 26
- whether the default `maxBufferSize` suffices

If the performance loss is unacceptable, keep a WebGL-backend or depth-prepass variant for the large-scene tiers.

### Phase 2: TSL-native features (after parity; each item is 1–3 weeks)

- **Fold GPU Studio into the main canvas** (snowglobe as a TSL look, shared uniforms) and retire its device.
- **Bond compute on the renderer's device,** writing instance buffers directly.
- **Compute culling with `IndirectStorageBufferAttribute`** (the `culling.wgsl` idea) for 10M+ atoms and bricks.
- **Gist particles as TSL compute** inside the viewer (SwitchStage), with pointer forces.
- **GPU picking:** an ID MRT plus a 1-pixel `readRenderTargetPixelsAsync`, replacing the CPU ray-march (`AtomPicker.tsx:57-141`).
- **Look upgrades:**
  - selective bloom from the emissive MRT
  - TRAA/TAAU/FSR1 or `@pmndrs/upscaler` on phones (needs impostor velocity)
  - OIT for the filter shell and transmission
  - SSGI on desktop
  - `onFramed`/`onOccluded` label culling
  - multi-canvas live gallery thumbnails
  - `@pmndrs/sky` moods
- **XR on native WebGPU** once `XRGPUBinding` ships and `@react-three/xr` has a v10 line.

---

## 10. Risk register (ranked)

1. **XR regression.** There is no v10 `@react-three/xr`, `XRFrame` is dropped, and WebGPU XR needs `XRGPUBinding` or a renderer swap. *Mitigation:* decide option (a) or (c) up front.
2. **Export and artifact identity.**
   - All bytes and keys change.
   - Readback becomes async.
   - The capture barrier depends on frame ordering that v10 reverses without warning.
   - Two backends mean two execution classes and two sets of baselines.
   *Mitigation:* treat it as a V2 profile and do Phase 0 item 4 first.
3. **Impostor performance on WebGPU.** No conservative depth (early-Z lost), a 256 MiB default `maxBufferSize`, and a single-component u8/u16 format that is rejected. *Mitigation:* the Phase 1 gate spike, the repack, and requested limits.
4. **Alpha churn.** alpha.6 moves the TSL hooks; `/legacy` is broken; drei 11 components are largely untested (`withRealTest: 1`); glyph is 0.1.0. *Mitigation:* pin exact versions, wrap `useRenderPipeline`/`useUniforms` behind Lupi hooks, and verify each drei component at runtime.
5. **Silent backend divergence.** vgpu `wgslFn` nodes, storage-in-vertex, atomics and multi-canvas are WebGPU-only, and failures on the WebGL2 fallback are silent (Utsubo, fact sheet #28). CI currently runs only the fallback path (`--disable-webgpu`). *Mitigation:* a dual CI lane and `state.webGPUSupported` gating.
6. **Mobile cost.** The HalfFloat frame buffer plus the output pass and RenderPipeline targets, with no device FPS data yet (fact sheet OQ2). *Mitigation:* `outputBufferType` UnsignedByte on mobile, `resolutionScale` 0.5 AO, and real-device measurement.
7. **Text.** A new dependency with baked font assets and Wasm. *Mitigation:* the `<LupiText>` shim with a canvas-sprite fallback.
8. **React 19.3 drift** on the next install. *Mitigation:* overrides (Phase 0).

---

## 11. Corrections and additions to earlier digests

- **`positionLocal` → `positionGeometry`** is listed under **r185 → r186** in the Migration Guide, and it is scoped to `material.positionNode`. Fact sheet #26 and `threejs-webgpu.md` §1 placed it in r185.
- **v10 numeric `useFrame` priority is reversed** (higher runs first) compared with v9 (lower runs first). The shim does not remap it. This is new; earlier digests said only "the shim still works but warns".
- **v10 alpha.5 and the canary drop the `XRFrame` argument.** This is new; it upgrades the earlier "@react-three/xr under v10 UNVERIFIED" to "known broken".
- **The r186 WebGPU backend rejects itemSize-1 `Uint8`/`Uint16` vertex attributes.** This is new and blocks the atom renderer.
- **The `WebGPURenderer` WebGL2 fallback also lacks `preserveDrawingBuffer`,** because it creates its own context (`three.webgpu.js:74218-74225`). This resolves open question 5: readback works through `readRenderTargetPixelsAsync` (confirmed at `:64886`) or a same-task canvas read.
- **GTAO reconstructs normals from depth when `normalNode` is null.** This confirms the impostor-safe N8AO replacement.
- **drei 11 `GizmoHelper` still uses legacy `renderPriority=1` plus raw `gl.render`,** so it conflicts with `useRenderPipeline`.
- **three r186 ships `WebGLXRFallback.js` (renderer swap).**

---

## 12. Sources

**Package tarballs** (npm registry, read 2026-09-27)
- https://registry.npmjs.org/@react-three/fiber: `10.0.0-alpha.5` (`dist/index.mjs`, `dist/index.d.ts`), `10.0.0-canary.14007b4`, and 9.8.1 (`dist/events-9ce18a08.esm.js`).
- https://registry.npmjs.org/@pmndrs/scheduler: 0.2.0 (`dist/index.mjs:149`).
- https://registry.npmjs.org/@react-three/drei: `11.0.0-alpha.7` (`core/`, `legacy/`, `webgpu/`, `package.json`).
- https://registry.npmjs.org/@react-three/test-renderer: `10.0.0-alpha.5`.
- https://registry.npmjs.org/three: 0.186.1. Line refs are to `build/three.webgpu.js` and `examples/jsm/tsl/display/*.js`, `examples/jsm/webxr/*.js` (also at https://cdn.jsdelivr.net/npm/three@0.186.1/).
- https://registry.npmjs.org/vgpu: 0.4.0 (`dist/init-from-device.d.ts`, `dist/three/tsl-exports.js`).
- Dist-tags and peers for `@react-three/{tsl,xr,postprocessing,rapier,uikit,handle}`, `@pmndrs/glyph`, `leva`, `r3f-perf`, `stats-gl` and `react`.

**Docs and repos**
- R3F v10 migration guide: https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/docs/migration/v10.mdx
- R3F issue #3921 (`/legacy` broken, open): https://github.com/pmndrs/react-three-fiber/issues/3921
- drei v11 component audit: https://github.com/pmndrs/drei/blob/v11-working/component-status.json
- pmndrs/xr source: https://github.com/pmndrs/xr (`packages/react/xr/src/xr.tsx`, `hand.tsx`, `space.tsx`, `layer.tsx`; `packages/xr/src/store.ts`, `pointer/ray.ts`, `pointer/cursor.ts`)
- react-three-examples (WebXR deferred; the port list): https://github.com/pmndrs/react-three-examples
- @pmndrs/glyph: https://github.com/pmndrs/glyph
- three.js Migration Guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide
- three.js PR #33583 (WebXR on `WebGPURenderer`): https://github.com/mrdoob/three.js/pull/33583
- three.js examples index: https://threejs.org/examples/files.json

**WebGPU and WebXR platform**
- gpuweb preserveDrawingBuffer: https://github.com/gpuweb/gpuweb/issues/2743
- gpuweb canvas readback semantics: https://github.com/gpuweb/gpuweb/issues/1781
- WGSL fragment depth proposal: https://github.com/gpuweb/gpuweb/blob/main/proposals/fragment-depth.md and https://github.com/gpuweb/gpuweb/issues/5342
- Chrome Intent to Ship, WGSL fragment depth: http://www.mail-archive.com/blink-dev@chromium.org/msg17263.html
- WebXR/WebGPU Binding spec: https://immersive-web.github.io/WebXR-WebGPU-Binding/
- toji.dev on WebGPU in WebXR: https://toji.dev/2025/03/03/experimenting-with-webgpu-in-webxr.html

**Text on WebGPU**
- troika on WebGPU (forum): https://discourse.threejs.org/t/troika-three-text-and-webgpu/55737
- three-text: https://github.com/countertype/three-text

**Prior digests in this folder**
- `00-fact-sheet.md`, `r3f-releases.md`, `pmndrs-ecosystem.md`, `threejs-webgpu.md`, `code-core.md`

**Lupi code**
- Every `path:line` cited above, relative to `/home/user/Lupi`. Primary files:
  - `packages/scene/src/{AtomsOptimized,Bonds,bondImpostor,AtomClusters,VectorGlyphs,BillionAtomBlock,AtomsTransmission,AtomPicker}.ts(x)`
  - `packages/ui/src/{viewer/ViewerCanvas,postprocess/ScenePostprocessing,postprocess/presets,ExportManager,export/renderCaptureState,mcp/renderArtifactAdapter,viewer/captureViewerThumbnail,SceneLighting,equirectTexture,ProceduralBackground,app/AppBackground,app/ViewerScene,MoleculeFilterShell,KnowledgeLabelsLayer,AnnotationsLayer,MeasurementLayer,SpatialAnchor,xr/*,gpu-studio/runtime,scan/gist/*,action-light/runtime}.ts(x)`
  - `docs/render-artifact-contract.md`, `AGENTS.md`
  - `tools/verify-render-parity.mjs`, `tools/verify-asset-quality.mjs`
  - `playwright*.config.mjs`, `apps/web/vite.config.ts`, `package.json`
