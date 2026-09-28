# three.js after r184, the state of WebGPU/TSL, and vgpu: research digest

Researched 2026-09-27. This is research only; nothing in the repo was changed.
Release dates come from the npm registry `time` field (registry.npmjs.org), which I treat as authoritative. GitHub release pages render dates without a year, and the fetch summarizer mislabelled them.
Anything I could not confirm first-hand is marked **UNVERIFIED**. Anything I reasoned out rather than read is marked **(inference)**.

---

## 0. Where Lupi stands today

- **Pinned versions (lockfile).** three `0.184.0`, vgpu `0.4.0`, @react-three/fiber `9.6.1`, and postprocessing `6.38.3`.
  - Two majors of @react-three/postprocessing are installed at once: `2.19.1` (apps/web asks for `^2.16.0`, `apps/web/package.json:21`) and `3.0.4` (packages/ui asks for `^3.0.0`, `packages/ui/package.json:32`). See `pnpm-lock.yaml:2956,2963,7419,7733`.
- **Main viewer is WebGLRenderer via the R3F `<Canvas>`** (`packages/ui/src/viewer/ViewerCanvas.tsx:66-84`).
  - GL options are `antialias:false` and `preserveDrawingBuffer:true`.
  - DPR is capped at 1.25 on mobile/low tiers and 1.75 on desktop/high (`ViewerCanvas.tsx:18-35`).
- **Post-processing is the pmndrs EffectComposer stack:** N8AO, Bloom, DepthOfField, ToneMapping and Vignette (`packages/ui/src/postprocess/ScenePostprocessing.tsx:16,44-91`).
- **Atoms and bonds are hand-written GLSL impostors.** They use `RawShaderMaterial` / `ShaderMaterial` and write `gl_FragDepth` with `layout(depth_greater)`.
  - Atoms: `packages/scene/src/AtomsOptimized.tsx:30,437,823`.
  - Bonds: `packages/scene/src/Bonds.tsx:769`.
  - The billion-atom block: `BillionAtomBlock.tsx:214-222`.
  - About 15 ShaderMaterial / onBeforeCompile sites exist across `packages/scene` and `packages/ui`.
- **GPU Studio is already WebGPURenderer + TSL.** Runtime: `packages/ui/src/gpu-studio/runtime.ts`.
  - Refuses the WebGL2 fallback on purpose: `runtime.ts:169-172` checks `isWebGPUBackend`.
  - Draws one `InstancedMesh` per element group with `MeshPhysicalNodeMaterial` (`runtime.ts:229-274`).
  - Uses a vgpu WGSL module as a TSL node through `tslExports` from `vgpu/three` (`runtime.ts:28,47,237-248`).
  - DPR is capped at 1.5 (`runtime.ts:162`), rendering is on demand with `requestAnimationFrame` (`runtime.ts:122-148`), and the environment is a PMREM `RoomEnvironment` (`runtime.ts:190-199`).
- **Raw WGSL pipelines live in `packages/renderer`.**
  - `culling.wgsl` does frustum culling, colormapping and indirect-buffer build. `atom.wgsl` draws impostors. `BondRenderPipeline.ts` handles bond rendering.
  - Only the bond-detection compute (`BondPipeline`) is wired into the live app (`packages/scene/src/useBondGpuPipeline.ts:4`). The WebGPU render paths are not.
- **Device tiers.** `packages/ui/src/deviceCapabilities.ts:30,40` sets a 50M-atom global ceiling and a 5M-atom interactive-picking ceiling. Mobile defaults to quality tier 0.

---

## 1. Dated three.js releases, r183 to the upcoming r187

| Release | npm publish date | Status |
|---|---|---|
| r183 | 0.183.0 on 2026-02-18; patches .1 (02-20) and .2 (02-28) | before Lupi's pin, listed for context |
| r184 | 0.184.0 on 2026-04-16 | Lupi's current pin |
| r185 | 0.185.0 on 2026-06-25; 0.185.1 on 2026-07-01 | |
| r186 | 0.186.0 on 2026-09-08; 0.186.1 on 2026-09-24 | npm `latest` |
| r187 | none | not released; only a "r186 → r187" section in the Migration Guide |

The Utsubo summary counts five releases in nine months (r182 to r186), with a new release every 8–11 weeks in 2026.

### r183 (context only)

These come from the Utsubo summary; I did not open the r183 notes myself.
- `PostProcessing` was renamed `RenderPipeline`.
- `Timer` replaces `Clock`.
- TSL gained read-write storage textures.
- `BatchedMesh` gained per-instance opacity.
- A reversed depth buffer was added.
- The `threejs.org/llms.txt` docs arrived.

### r184 (Lupi's pin)

These are GitHub release-note bullets, with PR numbers.
- **WebGLRenderer "Add NodeMaterial compatibility layer" (#32851, gkjohnson, merged 2026-03-14).**
  - Usage: `renderer.setNodesHandler(new WebGLNodesHandler())`, from `three/addons/tsl/WebGLNodesHandler.js`.
  - The PR says it covers "90% use cases": lights, shadows, skinning, instancing, batching and fog.
  - It does **not** support MRT nodes, storage textures, transmissive node materials, VSM, sharing geometry between InstancedMeshes that use node materials, `renderer.compile()`, or node post-processing.
  - Official examples: `webgl_tsl_instancing`, `webgl_tsl_shadowmap`, `webgl_tsl_skinning`, `webgl_tsl_clearcoat`.
- **Shader compilation.** `compileAsync()` is now truly non-blocking (#32984), and TSL compilation is 3.0x faster (#33120).
- **Upscaling.** New nodes for FSR 1 (#33339) and TAA with upsampling, TAAU (#33368).
- **Readback.** `ReadbackBuffer` was added and `getArrayBufferAsync()` buffers are reused (#33300); partial readback is supported (#33322).
- **Other renderer work.**
  - `WEBGL_multi_draw` fallback (#33238).
  - Dynamic Lights (#33042).
  - Compute-shader bounds check (#33186).
  - Env-map rotation refactor (#33232).
  - Unfilterable float32 storage textures (#33155).
- **TSL additions.**
  - `global` / `local` scopes (#33302).
  - `OnFrameUpdate` / `OnBeforeFrameUpdate` (#33356).
  - Hyperbolic math nodes (#33233).
- **`HTMLTexture`** (#31233, #33400). It relies on the experimental HTML-in-Canvas API: the canvas `layoutsubtree` attribute, `requestPaint`, `onpaint`, `gl.texElementImage2D`, and `GPUQueue.copyElementImageToTexture` (`three.webgpu.js` 0.186.1, lines ~35241-35265, 72461, 80011). Which browsers ship it is **UNVERIFIED**; it is likely behind a flag.
- **Global illumination.** `LightProbeGrid` adds position-dependent diffuse GI (#33125).
- **New example:** the SSGI ball pool.

### r185 (0.185.0, 2026-06-25)

- **Renderer.**
  - WebXR works on WebGPURenderer (#33583).
  - Rendering to texture arrays (#33507).
  - Descriptor classes and caching (#33525).
  - Full `ExternalTexture` support (#33816).
  - Uncaptured GPU errors and WGSL diagnostics are surfaced (#33418).
  - `InstancedMesh` fully works inside render bundles (#33839).
  - Frustum computations were optimized (#33804).
- **TSL and compute.**
  - `storageTexture3D` (#33443).
  - `textureGather` / `textureGatherCompare` (#33475).
  - An `ambientOcclusion` property (#33728).
  - Override context (#33807).
- **Post nodes.**
  - SSR gained a spatiotemporal denoiser (#33843).
  - SSGI now uses a half-float target (#33769) and RG11B10 to cut bandwidth (#33822).
- **Lighting.** `ClusteredLighting` (Forward+) replaces the removed `TiledLighting`.
- **New examples.**
  - `webgpu_compute_rasterizer`: a nanite-style compute rasterizer, formerly `_nanite-style`.
  - `webgpu_compute_rasterizer_ibl`.
  - Volumetric fire.
  - A procedural city generator.
  - `webgpu_lights_clustered` with "firefly-style HDR sprites".
  - `webgpu_skinning_instancing_individual`.
  - A reworked and optimized snow compute demo.
- **Migration notes that touch Lupi.**
  - The WebGPURenderer premultiplied-alpha implementation changed, and an opaque background should now be set through `Scene.background`. GPU Studio uses `alpha:true` plus `setClearColor(0x000000, 0)` (`runtime.ts:161,165`).
  - TSL `positionLocal` no longer updates internal vertex transformations; use `positionGeometry`. GPU Studio reads `positionLocal` (`runtime.ts:238`).
  - GTAO now computes physically correct AO, so lower `radius` / `scale`.
  - The SSRNode API changed.
  - `AnamorphicNode` was removed; use Bloom instead.
  - `directionToColor` / `colorToDirection` became `packNormalToRGB` / `unpackRGBToNormal`.

### r186 (0.186.0, 2026-09-08; 0.186.1, 2026-09-24)

- **New features.**
  - `SunLight` with cascaded shadow maps (#34221), also on WebGPU (#34259).
  - `Renderer.compileComputeAsync()` (#32551).
  - `updateBefore` / `updateAfter` for compute nodes (#34401).
  - Atomic workgroup arrays (#34428).
  - `4x8` pack/unpack (#34263).
  - Bone counts beyond the UBO limit (#34200).
- **Post and lighting nodes.**
  - `OITPassNode`, order-independent transparency (#34253).
  - `SSAONode` plus `depthAwareBlur` (#33921).
  - A faster Bloom blur (#33923).
  - GTAO quadratic stepping (#33895).
  - **VXGI**, voxel cone tracing for diffuse GI (#34402), in `three/addons/lighting/vxgi/VXGINode.js`.
  - `LightProbeGrid` for WebGPURenderer, with incremental baking.
- **Gaussian splats.**
  - `GaussianSplat` (formerly `GaussianSplatMesh`), a Gaussian-splat renderer and loader in TSL.
  - Loaders: `GaussianSplatPLYLoader`, `SPLATLoader`, `KSPLATLoader`, and a glTF extension.
  - Supports spherical harmonics, frustum culling and raycasting.
  - Sorting uses the new GPU `CountingSort` in `examples/jsm/gpgpu/`.
  - It runs on WebGPURenderer, including `forceWebGL`, but not on WebGLRenderer (header of `GaussianSplat.js`).
- **Materials and core.**
  - `MeshPhysicalMaterial` retroreflectivity (#33949).
  - Better energy conservation (#33985).
  - `Object3D.dispose()` (#34141).
  - A watertight `intersectTriangle()` (#33661).
  - `DirectRenderPipeline` (#34166).
  - A depth texture shared between passes (#34042).
  - The lighting system can be swapped at runtime (#34050).
  - MSAA in WebXR on WebGPU (#34120).
- **Build.**
  - Minified builds removed (#33893) and the CommonJS build deprecated (#33891).
  - Top-level side effects removed from TSL for better tree-shaking (#34332).
- **New examples.** `webgpu_deferred` (#34049) and a volumetric fog post example (#34319).
- **Migration notes.**
  - `PCFSoftShadowMap` was removed for WebGPU; `PCFShadowMap` is now soft.
  - GTAO `distanceExponent` / `distanceFallOff` are deprecated.
  - `Source` was renamed `TextureSource`.
  - `LightProbeGrid` (WebGL version) was renamed `LightProbeGridWebGL`.
  - Custom Object3D subclasses must call `super.dispose()`.

### r187 (unreleased dev branch)

These come from the Migration Guide's "r186 → r187" section.
- PMREMs are now cube render targets and `CubeUVReflectionMapping` is removed, so looks shift slightly. GPU Studio uses `PMREMGenerator.fromScene` (`runtime.ts:191-193`).
- The renderers use `WeakRef` / `FinalizationRegistry` internally.
- `setViewport` / `setScissor` no longer scale by pixel ratio when a render target is bound.
- `pixelationPass` `pixelSize` must now be a plain number.
- Custom lights register with `CustomLight.registerNode()`.

### Ecosystem context (brief; covered by other research)

- **@react-three/fiber.** `latest` is 9.8.1 (2026-09-24).
  - v10 alphas run from alpha.0 (2026-01-14) to alpha.5 (2026-09-08), plus canaries through 2026-09-26.
  - v10 treats WebGPU/TSL as first class. It adds a `@react-three/fiber/webgpu` entry and the hooks `useUniforms`, `useNodes`, `useLocalNodes` and `useRenderPipeline` (the last replaced `usePostProcessing` in alpha.4).
  - v10 alpha.5 peer dependencies: `three >=0.185.0` and `react >=19.0 <19.3`.
- **@react-three/drei.** 10.7.9 (2026-09-25); 11.0.0-alpha.7 (2026-09-05).
- **postprocessing.** 6.39.5 (2026-09-09); 7.0.0-beta.16 exists. Whether v7 supports WebGPU is **UNVERIFIED**.
- **@types/three.** 0.186.0 (2026-09-11).

---

## 2. What TSL plus compute can do now that WebGL can't

Everything below runs on WebGPURenderer with a real WebGPU backend. The official examples page (`threejs.org/examples/files.json`) lists **230** `webgpu_*` examples.

### Storage buffers and compute-driven particles

The core API is `instancedArray(count, 'vec3')` to allocate, `Fn(() => …)().compute(count)` to build a kernel, and `renderer.compute(node)` to dispatch. Geometry reads the same buffer, so there is no CPU round-trip.

| Example | Scale | What it demonstrates |
|---|---|---|
| `webgpu_compute_particles` | `particleCount = 200000` | A pointer ray hits a plane and triggers a `computeHit` impulse kernel |
| `webgpu_compute_points` | 300,000 2D particles | Repelled by a pointer uniform |
| `webgpu_tsl_compute_attractors_particles` | 2^18 = 262,144 | Multiple attractors |
| `webgpu_compute_birds` | 8,192 boids | The camera ray (`rayOrigin` / `rayDirection` uniforms) scatters the flock |
| `webgpu_compute_particles_snow` | 100k | Depth-texture collision |
| `webgpu_compute_particles_fluid` | 32,768 default, 131,072 max | MLS-MPM fluid |
| `webgpu_compute_cloth` | | Verlet springs |
| `webgpu_compute_geometry` | | "Jelly deformation … move pointer to interact" |
| `webgpu_compute_water` | | "Click and move mouse to disturb water" |
| `webgpu_tsl_vfx_linkedparticles`, `webgpu_tsl_galaxy` | | Visual effects |

- **Scale in practice.**
  - The Utsubo writeup reports about 1M particles simulated live in the Hokusai installation at Expo 2025 Osaka, on WebGPU + three.js.
  - three.js issue #30344 (2025-01-17) reports the compute-particles demo on an iPhone 12 Pro Max at 60 fps from a top view but **20 fps** from a bottom view. The reporter traced it to rendering the particles, not simulating them. At the time the demo rendered 1M; it now defaults to 200k.
  - Takeaway: on phones, **fill and overdraw limit you, not the simulation**.
- **Point-size pitfall.** WebGPU only supports 1-pixel point primitives. Sized particles need `Sprite` + `PointsNodeMaterial` / `SpriteNodeMaterial` (instanced quads), per the `PointsNodeMaterial` doc in `three.webgpu.js`. `webgpu_instance_points` shows the pattern.

### Atomics, workgroup memory and subgroups (WebGPU only)

- **Atomics.** `atomicAdd`, `atomicStore`, `atomicLoad` and `atomicMax`, via `storage(...).toAtomic()`.
  - The fluid example notes that "webgpu only supports int atomics", so it stores floats as fixed-point integers.
- **Workgroup memory.** `workgroupArray` and `workgroupBarrier`; r186 adds atomic workgroup arrays.
- **Subgroups.** `subgroupAdd`, `subgroupSize` and `countTrailingZeros`. See `webgpu_compute_reduce`.
- **Source confirms WebGPU-only.** `three.webgpu.js` 0.186.1 marks `AtomicFunctionNode`, `WorkgroupInfoNode`, `BarrierNode`, `ComputeBuiltinNode` and `StorageTextureNode` as "can only be used with a WebGPU backend".

### GPU sorting

Both sorts live in `three/addons/gpgpu/`.
- **`BitonicSort`** is exact.
- **`CountingSort`** makes a fixed number of passes and is built for "hundreds of thousands to millions" of elements. It also has a `computeCPU` fallback for the WebGL backend.

Uses: transparency, splats, particle depth order, and spatial binning.

### Indirect draw and dispatch

- **`IndirectStorageBufferAttribute`** lets the GPU choose the instance count. In `webgpu_struct_drawindirect`, a 100,000-instance pool is sized by a compute pass.
- **`webgpu_compute_rasterizer`** combines an atomic work-queue counter, an indirect dispatch buffer and `atomicMax` depth to software-rasterize triangles in compute.
- **Community write-up.** The Codrops "False Earth" article (2026-04-21) describes compute frustum culling that appends visible indices with an atomic counter. It says "around 80% of instances never reach the vertex shader".
- **For Lupi.** This is the same design as Lupi's unwired `culling.wgsl`, but three can now own it.

### Readback and GPU picking

The APIs: `renderer.getArrayBufferAsync(attribute, target, offset, count)` with partial reads (r184), `ReadbackBuffer`, and `readRenderTargetPixelsAsync()` (`three.webgpu.js:64886`).

- **Pattern A (inference).** Write an atom-ID MRT attachment, then read one pixel asynchronously.
- **Pattern B (inference).** A compute ray-sphere test over the atom buffer, keeping the nearest hit with `atomicMin` on packed (depth, index).
- I found **no official GPU-picking example** in the 230. Mark this approach UNVERIFIED as a turnkey feature.

### SDF, volumes and ray marching

- **Building blocks.**
  - `RaymarchingBox(steps, cb)` in `three/addons/tsl/utils/Raymarching.js`.
  - `storageTexture3D` (r185), so compute can bake density or SDF volumes.
- **Examples.** `webgpu_volume_cloud` ("3D texture raymarching"), `webgpu_volume_perlin`, `webgpu_volume_fire`, `webgpu_volume_lighting`, `webgpu_tsl_raging_sea`, and `webgpu_caustics`.
- **Depth writes work.** `NodeMaterial.depthNode` "allows to overwrite depth values in the fragment shader" (`three.webgpu.js:21808-21814`). That means Lupi's GLSL impostors, which write `gl_FragDepth`, can be ported to TSL.
  - WGSL has no direct counterpart to GLSL's `layout(depth_greater)` conservative-depth hint, so early-Z behaviour may differ (**UNVERIFIED**).

### Lighting at scale

- **`ClusteredLighting`** (Forward+). `webgpu_lights_clustered` places up to 30×30 = 900 point lights, one per instanced sphere, with a single `renderer.lighting = new ClusteredLighting()`.
- **`DynamicLighting`** (`webgpu_lights_dynamic`) avoids recompiling shaders when lights are added or removed.
- **Global illumination.** `LightProbeGrid` and `VXGI` (r186).

### Other unlocks

- **`BundleGroup`** render bundles; see `webgpu_performance_renderbundle`, which draws 4,000 objects.
- **`BatchedMesh`**; see `webgpu_mesh_batch` (`MAX_GEOMETRY_COUNT = 20000`).
- **Backdrop nodes.** `material.backdropNode` with `viewportSharedTexture()` does per-object screen-space blend, hue and posterize effects (`webgpu_backdrop`).
- **`webgpu_sculpt`**: "Dynamic-topology mesh sculpting".
- **`webgpu_compute_audio`**: audio processed in compute.
- **Inspector** (`three/addons/inspector/Inspector.js`). Set it with `renderer.inspector = new Inspector()` and tag nodes with `.toInspector(name)`. It includes performance and timeline tabs, color-grading modules and a TSL graph editor.

---

## 3. WebGPURenderer's WebGL2 fallback and mobile realities

### How the fallback works

`WebGPURenderer` falls back to a WebGL2 backend automatically; `forceWebGL: true` forces that path. This comes from the threejs.org manual page "WebGPURenderer".

**What degrades or disappears on the fallback.** Items without a tag are verified in source or official docs.
- Compute runs through **transform feedback**, via `DualAttributeData`: "This type of shader is not natively supported in WebGL 2 and thus implemented via Transform Feedback" (`three.webgpu.js` ~line 69639).
  - Simple per-element kernels like `instancedArray` work.
  - Atomics, workgroup and shared memory, barriers, subgroups, storage textures and compute built-ins do **not**.
- Indirect draw and dispatch are unavailable, and dispatch must be a single number. Source: the Utsubo migration checklist; I did not confirm this in three's source.
- `BundleGroup` "can technically be rendered but without any performance improvements" (`three.webgpu.js` ~line 90486).
- Timestamp queries are limited to `EXT_disjoint_timer_query_webgl2` (Utsubo; not confirmed in source).
- `OITPassNode` supports MSAA only on the WebGPU backend (header of `OITPassNode.js`).

**Failures are silent.** The Utsubo guide warns that "a feature that works on WebGPU can still fail on the WebGL 2 fallback".
- Check `renderer.backend.isWebGPUBackend` **after** `await renderer.init()`.
- `renderer.isWebGPURenderer` is true on both backends.
- GPU Studio already does the right thing at `runtime.ts:166-172`.

**Hard migration blockers, on both backends.**
- `ShaderMaterial`, `RawShaderMaterial` and `onBeforeCompile` are not supported (manual, "Migration" section).
- `EffectComposer` and pmndrs `postprocessing` / `@react-three/postprocessing` are not supported (manual; Utsubo).
- The Utsubo guide says drei `Text` breaks because it uses `onBeforeCompile`, and so does `Environment` with children (`WebGLCubeRenderTarget`). This is **UNVERIFIED** against drei 10.7.9.
- For Lupi this covers every impostor material and the whole post stack.

**vgpu `tslExports` nodes are WGSL-only (inference).** They are built on `wgslFn` / `wgsl` includes, according to the vgpu three.js guide, so they cannot transpile to GLSL. Any material using them needs the WebGPU backend, which is one reason GPU Studio refuses the fallback.

**WebGPU is not automatically faster.** In a three.js forum thread (2025-02-05), 20,000 non-instanced meshes ran at about 60 fps on WebGLRenderer and about 15 fps on WebGPURenderer on an M1 Pro.
- Mugen87 blamed per-object `setBindGroup` / `writeBuffer` churn.
- The cure is instancing, `BatchedMesh` or `BundleGroup`. Lupi already instances.

**R3F v9 wiring.** Pass an async `gl` factory that returns an **initialized** `WebGPURenderer`. If you return an uninitialized one, r186 throws "render() called before the backend is initialized" (Utsubo).

### Browser support (gpuweb Implementation-Status wiki, edited 2026-08-13)

| Browser | Platform and version |
|---|---|
| Chrome / Edge | Windows, macOS, ChromeOS: 113+ |
| | Android 12+ on ARM, Qualcomm or Intel GPUs: 121+ |
| | Imagination GPUs on Android 16+: 139+ |
| | Samsung Xclipse: about 154 (planned) |
| | Linux: Intel Gen12+ 144+; NVIDIA on Wayland 147+ |
| | Windows ARM64: behind a flag |
| Firefox | Windows: 141+ |
| | macOS 26 on Apple Silicon: 145+; every macOS version on Apple Silicon: 147+ |
| | Linux, Android, Intel Macs: Nightly only; 2026 rollout planned |
| Safari 26 | macOS, iOS, iPadOS, visionOS: on by default. Shipped 2025-09-15 per the WebKit "Safari 26.0" post |

- Devices on older iOS versions fall back to WebGL2.
- A GitHub issue claims "WebKit 26 replaces WebGL with WebGPU". That is **UNVERIFIED and likely wrong**; the WebKit post only says WebGPU "supersedes" WebGL for new work.

### Device limits

These are the WebGPU spec defaults (W3C Candidate Recommendation Draft, 2026-09-15).
- `maxStorageBufferBindingSize` is **128 MiB** and `maxBufferSize` is **256 MiB**.
- `maxStorageBuffersPerShaderStage` is 8.
- `maxColorAttachmentBytesPerSample` is **32**, which is why the manual stresses packing MRT data: attachments default to RGBA16F, 8 bytes each.

**three requests only the default limits.** `requiredLimits` defaults to `{}` (`three.webgpu.js:87053`). A caller must pass `requiredLimits` to raise them.
- **(inference)** 50M atoms × a 16-byte `vec4` is about 800 MB. That cannot fit in one binding by default, so big structures need chunked buffers, which Lupi's brick and LOD design suits.

### Mobile realities

- **DPR.** Utsubo tip 80 says to cap DPR at 2 and notes that half-resolution post "can roughly double frame rate" when fill-bound. Lupi is already stricter (1.25 on mobile).
- **Upscaling (inference).** The TAAU and FSR1 nodes (r184) let you render below native resolution and upscale.
- **Draw calls.** Utsubo tip 30, quoting Don McCurdy: "<100 draw calls and <100,000 vertices if you can" on mobile.
- **Tiered quality.** vgpu's adaptive-quality guide starts every visitor on the High pipeline (DPR clamped to [1,2]).
  - It downgrades **once** to Low (DPR 1, a third of the ray-march steps, no bloom chain) when detect-gpu, the Battery Status API or presented-frame health signals trouble.
  - It never upgrades on its own, so it cannot oscillate.
  - It pre-compiles Low off-screen before swapping.
- **Shader compile hitches.** "False Earth" reports mobile GPUs stalling during compilation. Useful tools: `compileAsync` (non-blocking since r184) and `compileComputeAsync` (r186).
- **Thermal throttling.** These come from secondary, low-authority sites (abratabia.com) and are directional only:
  - Phones hold peak GPU clocks for about 2–5 minutes, then throttle.
  - Plan for 60–70% of peak.
  - Test for 15 minutes or more.
  - A flagship phone draws about 4–7 W at full GPU load.
  - Lupi's on-demand frame loop (GPU Studio) and `frameloop` pausing (`ViewerCanvas.tsx:67`) already help.

---

## 4. Screen-space effects available as TSL nodes

Import from `three/addons/tsl/display/*`; 48 files ship in 0.186.1. You compose them in `new THREE.RenderPipeline(renderer)` with `pass(scene, camera)` and `mrt({...})`. The defaults below are read from source.

The cost column is **(inference)**. It is relative, based on resolution and sample defaults, not measured in milliseconds.

| Effect | Node / import | Defaults from source | Needs | Cost |
|---|---|---|---|---|
| AO (GTAO) | `ao()` in GTAONode | `resolutionScale 1`, 16 samples, `radius 0.25`; physically based since r185 | depth, normal | High at full res; try 0.5 scale |
| AO (SSAO) | `ssao()` in SSAONode (r186) | `resolutionScale 0.5`, 16 samples; pair with `depthAwareBlur` | depth, normal | Medium |
| Screen-space GI + AO | `ssgi()` in SSGINode | Samples per pixel = slices × steps × 2. Default 1×12 with temporal filtering on (needs TRAA); presets up to 3×16. RG11B10 target | depth, normal, velocity; TRAA | High |
| Voxel GI | `vxgi(depth, normal, scene, camera, 64)` | Voxel cone tracing (r186) | voxelizes the scene | Highest (inference) |
| SSR | `ssr()` in SSRNode | `resolutionScale 1` (can halve), `quality 0.5`, optional denoiser (r185) | normal, metal/rough MRT | High |
| Temporal AA | `traa(color, depth, velocity, camera)` | "MSAA must be disabled when TRAA is in use" | velocity MRT | Medium; history buffers |
| Upscaling | `taau()` + `sharpen()`; `fsr1()` | TAAU (r184), FSR1 (r184) | velocity (TAAU) | Saves cost on phones |
| Cheap AA | `smaa()`, `fxaa()` | FXAA must run in sRGB after `renderOutput()` | | Low |
| Outline | `outline(scene, camera, {selectedObjects…})` | Downsample, edge detection and blur at half res | selection | Low–medium |
| Bloom | `bloom(node)` | `_resolutionScale 0.5`, 5 mips; faster blur in r186; selective via MRT `emissive` or per-material `mrtNode` | | Medium |
| Depth of field | `dof(color, viewZ, focus, focalLength, bokeh)` | "blur runs in half resolution" | viewZ | Medium |
| Motion blur | `motionBlur(beauty, velocity)` | | velocity MRT | Medium |
| Chromatic aberration | `chromaticAberration()` | | | Low |
| Film grain | FilmNode | | | Low |
| RGB shift / dot screen | RGBShiftNode, DotScreenNode | | | Low |
| Looks | Sepia, BleachBypass, `lut3D` | | | Low |
| Stylized | `retroPass` (affine PS1 look); CRT.js `scanlines` / `vignette` / `colorBleeding` / `barrelUV`; `pixelationPass`; `sobel`; `bayerDither` (`tsl/math/Bayer.js`); halftone (example) | | | Low |
| Temporal / transition | `afterImage` (trails), `transition` (wipe between two scene passes), `radialBlur`, `hashBlur`, `gaussianBlur`, `boxBlur` | | | Low–medium |
| Light effects | `godrays()` + `bilateralBlur`, `lensflare`, SSS (screen-space shadows) | | depth | Medium |
| Transparency | `oitPass(scene, camera)` | Weighted-blended OIT; NormalBlending materials only | | Medium |
| Stereo | AnaglyphPassNode, ParallaxBarrierPassNode, Stereo* | | | Low |

**Mapping Lupi's current pmndrs stack to TSL nodes.**
- N8AO becomes `ao()` or `ssao()`.
- Bloom becomes `bloom()`.
- DepthOfField becomes `dof()`.
- ToneMapping becomes `renderer.toneMapping` / `renderOutput()`.
- Vignette becomes CRT.js `vignette`.

**Fallback coverage.** Whether each node runs correctly on the WebGL2 fallback is **UNVERIFIED** node by node. The fullscreen-fragment ones should transpile to GLSL; anything built on storage textures cannot.

**Soft particles.** `three/addons/tsl/utils/SoftParticles.js` fades sprites where they meet geometry (`webgpu_particles_soft`).

---

## 5. What each capability unlocks for a playful molecule and particle viewer

Every idea below is **(inference)**, grounded in the APIs and examples above.

- **Compute particles with a pointer or touch force field**, following the `compute_points` / `compute_particles` hit-kernel pattern.
  - "Stir the molecule": atoms scatter from your finger as dust and spring back to their bonded positions.
  - "Explode and reassemble" when you switch molecules: tween every atom's storage position from the old layout to the new one.
  - GPU Studio's CPU `SnowMotion` (`gpu-studio/snow-motion.ts`) could become a 100k-flake compute snow globe that collides with atom depth, as `compute_particles_snow` does.
- **Boids (8,192 in the birds example).** A school of water molecules swarming around a protein and scattering from the camera ray. Casual visitors get something alive on screen within a second.
- **MLS-MPM fluid with atomics.** "Pour" solvent particles over a molecule, or a tilt-your-phone ball pit of atoms. Keep it at 32k particles on phones.
- **Attractors and galaxy examples.** Idle and ambient modes where the gallery molecule sits inside a swirl of 262k glowing particles.
- **Atomics plus CountingSort for a GPU spatial hash.** Bond inference, collisions and neighbour glow can stay on the GPU every frame. Lupi already does bond detection in raw WGSL (`useBondGpuPipeline.ts`), and three's `CountingSort` provides the binning primitive inside three.
  - Opens up "sticky atoms" play: drag an atom and bonds form and break live.
- **Indirect draw plus compute culling.** Move `culling.wgsl`'s idea into `IndirectStorageBufferAttribute` so the 50M-atom LOD bricks cost the vertex stage only for visible atoms. `webgpu_struct_drawindirect` is the template.
- **GPU picking (compute ray-sphere or an ID MRT with async readback).**
  - Hover highlights and tooltips on up to the 5M-atom interactive ceiling (`deviceCapabilities.ts:40`) without the CPU `SpatialHash3D` (`AtomPicker.tsx:12`).
  - Pair with `outline()` or a bloom pulse on the hovered atom.
- **SDF and volume ray marching (`RaymarchingBox`, `storageTexture3D`).**
  - Electron-density "clouds" and metaball molecular surfaces.
  - A "melt" slider morphing ball-and-stick into a blobby surface.
  - Orbital-style glowing volumes. `volume_cloud` and `volume_fire` show the look.
- **ClusteredLighting (900 lights in the example).** A "firefly mode" where every atom of a small molecule, or chosen elements of a large one, emits real light onto its neighbours. DynamicLighting avoids recompile hitches when lights toggle.
- **SSGI or VXGI.** Coloured light bouncing between neighbouring spheres makes molecules look like physical toys. `webgpu_postprocessing_ssgi_ballpool` is literally interactive spheres with SSGI and touch input (via `@perplexdotgg/bounce` physics). Desktop only.
- **TRAA.** Clean impostor silhouettes without MSAA, which the main viewer runs with off. Use TAAU or FSR1 to render at about 60–70% resolution on phones.
- **Style skins as fun presets.** Retro PS1, CRT, pixel art with outlines, halftone, Bayer dither, Sobel "blueprint", LUT film looks, sepia, chromatic aberration plus grain for a "cinematic" look. Most are one fullscreen pass, so they are cheap enough for mobile.
  - This fits Lupi's existing `studio` / `paper` / `editorial` / `diagram` postprocess presets.
- **Temporal effects.**
  - `afterImage`: comet trails on trajectory playback.
  - `motionBlur`: fast spins.
  - `transition`: dissolve wipes between molecules.
  - `godrays`: a "sunlight through the crystal" hero shot.
- **OIT.** Glassy, translucent atoms and shells that don't pop as you rotate. This matters for the filter-shell layer.
- **Gaussian splats (r186).** Lupi's `/v1/scan/*` photo pipeline could show the user's photographed object as a splat next to "its" molecules.
- **WebXR on WebGPU (r185).** Lupi already ships `@react-three/xr`; a future WebGPU viewer need not give up XR.
- **HTMLTexture.** Real DOM labels or cards rendered onto 3D surfaces. Browser support is **UNVERIFIED** and it is an experimental API.
- **Backdrop nodes.** A "magnifying lens" sphere that inverts, posterizes or hue-shifts what sits behind it: a playful inspection tool.
- **Inspector.** Developer and QA performance timelines plus a TSL graph editor. It could also back an "under the hood" easter egg.

---

## 6. vgpu (Vercel Labs), the library GPU Studio uses

- **Identity.** npm `vgpu` from `github.com/vercel-labs/vgpu` (the `packages/vgpu-api` directory); homepage `vgpu.sh`; MIT.
  - npm description: "TypeScript library for WebGPU: typed shader imports, a tiny gpu-first API, and the same code running in the browser, headless Node, and your test suite."
  - It advertises a fullscreen effect in 25 KB gzipped, with the budget enforced in CI.
- **Versions.**
  - `latest` is **0.5.0** (2026-09-14); `next` is 0.5.0-rc.1.
  - Lupi pins **0.4.0** (2026-09-03). 0.4.1 came out 2026-09-08.
  - Earlier: 0.0.5 (2026-05-26) through 0.3.1 (2026-08-26).
  - Peer dependency: `three >=0.180.0 <0.200.0`, so it works with r186.
- **0.4.0 changes.**
  - Added the three TSL adapter (`tslExports`).
  - Made `frame(gpu, cb)` atomic: it submits on return and cancels on throw.
  - Added the Particle Orbit (with TypeGPU) and adaptive-quality examples.
- **0.4.1** was maintenance only.
- **0.5.0 changes.**
  - Explicit texture shapes and usage, immutable allocations, and mip/region readback.
  - Safer target and texture replacement, destroyed-resource validation, and stale-bundle detection.
  - Vulkan is now the default for Node on Linux.
  - Optional build-time WGSL → Swift/Metal native tooling.
  - The breaking changes from 0.4.x are in `docs/migrations/0.5.0.docs.md`, which I did **not** read, so they are **UNVERIFIED**.
- **Public API (0.5.0 `dist/index.d.ts`).**
  - Functions: `init`, `initFromDevice`, `surface` (with `dpr` as a number or range), `target`, `texture`, `sampler`, `storage`, `uniforms`, `compute`, `draw`, `effect`, `frame` / `frameLoop`, `bundle`, `pingPong` / `pingPongStorage`, `geometry`, `clock`, `timer`, `visibility`.
  - `timer` records GPU pass timings and needs the `timestamp-query` feature.
  - `visibility` provides occlusion queries: core WebGPU, up to 4,096 slots, with results landing 1–2 frames later.
  - `compute` / `draw` support indirect `dispatch` and draws.
- **`initFromDevice(device)`.** It "wraps a device owned by another library … so vgpu can render from the same queue without copying through the CPU". GPU Studio already creates its own `GPUDevice` and passes it to `new WebGPURenderer({ device })` (`runtime.ts:159-161`).
  - **(inference)** One device could therefore drive both three rendering and vgpu compute or effects. This is UNVERIFIED end to end.
- **Tooling.**
  - CLI: `npx vgpu docs|examples|check|mcp`.
  - Hosted read-only MCP at `https://vgpu.sh/api/mcp`, plus `llms.txt`.
  - Guides: performance playbook, shader-debugging (read back internal values instead of judging by eye), and adaptive quality (summarized in §3).

---

## Sources

**Releases and changelogs**
- https://github.com/mrdoob/three.js/releases/tag/r184
- https://github.com/mrdoob/three.js/releases/tag/r185
- https://github.com/mrdoob/three.js/releases/tag/r186
- https://github.com/mrdoob/three.js/pull/32851
- https://github.com/mrdoob/three.js/wiki/Migration-Guide
- https://registry.npmjs.org/three (publish times)
- https://registry.npmjs.org/vgpu, https://registry.npmjs.org/@react-three/fiber, https://registry.npmjs.org/@react-three/drei, https://registry.npmjs.org/postprocessing, https://registry.npmjs.org/@types/three

**three.js docs, examples and source**
- Manual pages: https://threejs.org/manual/#en/webgpurenderer and https://threejs.org/manual/#en/webgpu-postprocessing (content at `/manual/pages/*.html`)
- https://threejs.org/examples/files.json (230 `webgpu_*` examples)
- Examples read: https://threejs.org/examples/webgpu_compute_particles.html, `webgpu_compute_points`, `webgpu_compute_birds`, `webgpu_compute_particles_fluid`, `webgpu_compute_particles_snow`, `webgpu_tsl_compute_attractors_particles`, `webgpu_struct_drawindirect`, `webgpu_compute_rasterizer`, `webgpu_compute_reduce`, `webgpu_compute_sort_bitonic`, `webgpu_instance_points`, `webgpu_mesh_batch`, `webgpu_performance_renderbundle`, `webgpu_lights_clustered`, `webgpu_lights_dynamic`, `webgpu_gaussian_splat`, `webgpu_backdrop`, `webgpu_materials_texture_html`, `webgpu_particles_soft`, `webgpu_postprocessing_{traa,ssgi,ssgi_ballpool,ao,ssr,outline,bloom_selective,dof,motion_blur,ca,retro,pixel,afterimage,transition,godrays,3dlut,sobel}`, `webgpu_upscaling_{taau,fsr1}`, `webgpu_oit`, `webgpu_vxgi`, `webgpu_volume_cloud`, `webgpu_sculpt`, `webgpu_compute_geometry`, `webgpu_compute_water`
- three@0.186.1 source via jsDelivr: https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.webgpu.js, `/examples/jsm/tsl/display/*.js`, `/examples/jsm/objects/GaussianSplat.js`, `/examples/jsm/gpgpu/CountingSort.js`, `/examples/jsm/tsl/utils/Raymarching.js`, `/src/textures/HTMLTexture.js`
- https://github.com/mrdoob/three.js/issues/30344
- https://discourse.threejs.org/t/why-webgpurenderer-performance-significantly-lower-than-webglrenderer/77629

**Industry write-ups**
- https://www.utsubo.com/blog/threejs-2026-what-changed (2026-09-24)
- https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- https://www.utsubo.com/blog/threejs-best-practices-100-tips

**Browser support and spec**
- https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- https://web.dev/blog/webgpu-supported-major-browsers
- https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- https://www.w3.org/TR/webgpu/ (limits)
- https://www.abratabia.com/mobile-browser-performance/battery-and-thermal.php (secondary)

**Community examples (Codrops)**
- https://tympanus.net/codrops/tag/webgpu/
- https://tympanus.net/codrops/2026/04/21/false-earth-from-webgl-limits-to-a-webgpu-driven-world/
- https://tympanus.net/codrops/2026/08/12/creating-an-interactive-3d-cluster-with-three-js-tsl-and-three-start/
- https://tympanus.net/codrops/2026/09/24/custom-shaped-cursor-trail/

**R3F v10**
- https://github.com/pmndrs/react-three-fiber/releases
- https://newreleases.io/project/github/pmndrs/react-three-fiber/release/v10.0.0-alpha.5

**vgpu**
- https://github.com/vercel-labs/vgpu/releases (plus the v0.4.0 and v0.5.0 tags)
- https://vgpu.sh/llms.txt, https://vgpu.sh/sitemap.md
- https://vgpu.sh/docs/guides/adaptive-quality.md, https://vgpu.sh/docs/guides/threejs.md
- The vgpu@0.5.0 npm tarball (`dist/*.d.ts`)

**Lupi code**
- `packages/ui/package.json:30-44`, `apps/web/package.json:19-40`, `pnpm-lock.yaml:2931-2963,7419,7733`
- `packages/ui/src/viewer/ViewerCanvas.tsx:18-84`
- `packages/ui/src/postprocess/ScenePostprocessing.tsx:16,44-91`
- `packages/ui/src/gpu-studio/runtime.ts:1-431`
- `packages/scene/src/AtomsOptimized.tsx:30,437,823`, `packages/scene/src/Bonds.tsx:769`, `packages/scene/src/BillionAtomBlock.tsx:214-222`
- `packages/scene/src/AtomPicker.tsx:12`, `packages/scene/src/useBondGpuPipeline.ts:4`
- `packages/renderer/src/shaders/culling.wgsl:1-20`
- `packages/ui/src/deviceCapabilities.ts:30-114`
