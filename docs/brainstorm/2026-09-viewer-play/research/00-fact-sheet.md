# Cross-digest fact sheet: pmndrs `math`, R3F and pmndrs releases, three.js WebGPU, and Lupi hooks

Compiled 2026-09-27 by the completeness critic from the eight digests in this folder. It also includes eight targeted checks against local tarballs, the math git clone, the Lupi repo and the web.

**Source tags**
- **[MATH]** `pmndrs-math.md`
- **[R3F]** `r3f-releases.md`
- **[ECO]** `pmndrs-ecosystem.md`
- **[TJS]** `threejs-webgpu.md`
- **[CORE]** `code-core.md`
- **[FUN]** `code-fun.md`
- **[PLAY]** `playful-web.md`
- **[SCI]** `science-toys.md`
- **[CRIT]** re-verified or corrected by this pass (evidence is in the section at the end)
- **[AGENTS]** `/home/user/Lupi/AGENTS.md`

---

## A. pmndrs `math` (npm `math`)

1. **Identity and status.**
   - `math@0.1.0` was published to npm on 2026-09-11. It is maath rebuilt inside the same repo: the repo was emptied on 2026-08-03 and renamed on 2026-08-17.
   - There has been no stable release since 0.1.0. The current canary is `0.0.0-canary-20260927-98762395`.
   - `maath@0.10.8` is not deprecated. drei 10.7.9, drei 11 alpha and `@react-three/postprocessing` 3.1.3 all still depend on `maath ^0.10.8`.
   - Lupi imports neither `math` nor `maath` directly.
   - Sources: [MATH] [ECO] [CRIT: registry re-read 2026-09-27]

2. **API style.**
   - Every type is a plain-array tuple (`Vec3 = [x, y, z]`; `Mat4` is column-major with the same layout as three's `elements`).
   - Functions follow `fn(out, ...inputs): out`: aliasing is safe and nothing is allocated.
   - Long-lived state is caller-owned plain data (`Spring {value, velocity}`, PRNG state, noise `Permutation`), so it can be serialized or `structuredClone`d.
   - The package is ESM-only, has zero dependencies and sets `sideEffects: false`.
   - Sources: [MATH]

3. **Entry points.**
   - The published subpaths are `math`, `math/shapes`, `math/geometry`, `math/time`, `math/random`, `math/noise`, `math/color` and `math/ik`.
   - There is **no `math/three`**, even though `skills/math/SKILL.md` documents it. The bridge is PR #50, which is still open: last push 2026-09-07, no reviews, and no changeset.
   - PR #50 claims 1.4–2.7× speedups over vanilla three for instancing, scene-graph propagation, culling and vertex transforms.
   - Sources: [MATH] [CRIT]

4. **Springs (`math/time`).**
   - `spring|spring2|spring3|spring4.update(state, target, smoothTime, dampingRatio, delta)`, plus `.damp` (ζ = 1), `spring.dampAngle` (shortest path) and `spring.fromResponse(r) = r/π`.
   - The integrator is the exact analytic solution, so it is stable at any `dt` with no clamping.
   - It has no `maxSpeed`, no quaternion or colour springs, and no "settled" helper.
   - Benchmark: 100k scalar springs take about 3.8 ms, against about 12 ms for maath `damp`.
   - Easings: sine, cubic, quart, quint, circ and expo in In/Out/InOut forms, plus `rsqw`. There is no back, elastic or bounce.
   - Sources: [MATH] [CRIT: signatures checked at tag `math@0.1.0`]

5. **Noise (`math/noise`, CPU only).**
   - Generators: `perlin2d/3d`, `simplex2d/3d/4d`, and `worley2d/3d` (F1 only).
   - Combinators: `fbm`, `ridged`, `billow`, `domainWarp2/3`, and `curl2/curl3`. `curl3` is divergence-free and costs 12 samples per call.
   - Measured cost: `simplex3d` is about 46 ns per sample and `curl3` about 0.5 µs, so a 4 ms per-frame CPU budget allows roughly 8k curl evaluations.
   - Only the low 16 bits of the seed matter, which gives at most 65,536 distinct fields.
   - There are no WGSL, TSL or GLSL twins of any of this.
   - Sources: [MATH]

6. **Random (`math/random`).**
   - Generators: `mulberry32`, `isaac32` and `isaac64`, each with `create/seed/next/sample`.
   - Helpers: `random.float/int/bool/sign/choice/vec2/vec3/vec4/quat`.
   - `random.inCircle/inSphere` and core `smoothstep/smootherstep` are **canary-only**. They are absent from the 0.1.0 tag and present on main.
   - There are no Fibonacci-sphere or Poisson-disk helpers.
   - Seeded PRNGs are integer-exact, but anything passed through trig is not bit-identical across browsers (issue #48).
   - Sources: [MATH] [CRIT]

7. **Shapes and geometry.**
   - Algorithms: `quickhull3` (flat xyz in, triangle indices out; allocates), `quickhull2`, `triangulatePolygon2`, and polygon decomposition.
   - `polygon2.containsPoint/signedDistance` supports lasso selection.
   - Primitives: `obb3`, `box3`, `plane3`.
   - `frustum`: `setFromViewProjectionMatrixNO/ZO`, `intersectsSphere/Box3`, and `corners`.
   - `raycast3` offers only `intersectsTriangle` and `intersectsBox3`. **There is no ray-sphere test**, and `sphere` has only `create` and `containsPoint`.
   - Sources: [MATH] [CORE] [CRIT]

8. **IK and examples.**
   - `fabrik2`/`fabrik3` support ball and hinge joints, `getBoneRotation`, and `forward`-only "snek" following.
   - The official examples are playful: a spring tail with a Lissajous idle mode, XPBD circle physics where the pointer is body 0 with inverse mass 0, a 2,200-particle `simplex2d` flow field seeded with `mulberry32(42)`, a `simplex4d` seamless loop, and the snek.
   - The examples render with `gpucat`, which is only a placeholder on npm and not usable as a dependency.
   - Sources: [MATH] [PLAY]

9. **Colour (`math/color`).**
   - `Color` is linear-sRGB. `lerp` works in linear light; `luminance` uses Rec. 709.
   - `colorspace` converts to and from Display-P3, and `hsl` handles HSL.
   - CSS, hex and `hsl()` string parsing goes through `color.setFromColorInput` / `fromColorInput`. On unrecognized input these log a warning and return `null`.
   - There is no OKLab or OKLCH.
   - Sources: [MATH] [CRIT]

10. **Performance truths.**
    - Tree-shaking under Rollup (Lupi's production build) is excellent: `vec3.add` + `normalize` is 236 B, and the whole core is 14.4 KB gzipped. Vite's esbuild dev pre-bundling does not shake namespaces.
    - For 10k TRS instances, writing `mat4` straight into `Float32Array` subarray views took 180 µs, against 245 µs for three `compose` and 859–1018 µs for the Object3D-dummy pattern. Copying a plain tuple into a typed array took 607 µs.
    - Feeding one function both plain and typed arrays made it about 5× slower (megamorphic).
    - Frustum culling was roughly at parity with three.
    - Sources: [MATH]

## B. R3F and the scheduler

11. **R3F 9.x is stable.**
    - 9.8.1 is `latest` (2026-09-24). Lupi's lockfile has 9.6.1.
    - 9.7.0 added react-dom event priorities and reconciler microtasks.
    - 9.8.0 added React 19.3 support and synchronous root configuration for async WebGPU renderers.
    - 9.8.1 added full `<Activity>` support, disposes the renderer on unmount, and stops rerenders from resetting `dpr` and `frameloop`.
    - Peers: `react >=19 <19.4`, `three >=0.156`.
    - Sources: [R3F] [CRIT: peers read from the tarball]

12. **`@react-three/postprocessing` ≥3.0.5 requires fiber ≥9.7.0.**
    - Latest is 3.1.3. It depends on `n8ao ^2`.
    - It adds `DepthPicking`/`useDepthPicking` (tap-to-focus without CPU raycasting), `<EffectGroup>`, and `mergeMode`.
    - Lupi resolves two copies: 3.0.4 in `packages/ui` and 2.19.1 in `apps/web`.
    - Sources: [ECO] [R3F] [CRIT]

13. **v10 alpha.5 (2026-09-08).**
    - Peers: three `>=0.185` (raised in alpha.3) and React `>=19.0 <19.3`.
    - The `/legacy` WebGL entry is broken (issue #3921).
    - `usePostProcessing` was renamed `useRenderPipeline` **in alpha.3**.
    - The canary moves the TSL hooks into `@react-three/tsl`, which peers the unpublished `fiber ^10.0.0-alpha.6`.
    - There is no beta.
    - Sources: [R3F] [CRIT]

14. **What v10 adds.**
    - `<Canvas renderer>`: WebGPU, with three's WebGL2 fallback.
    - Multi-canvas with one shared renderer (WebGPU only): `renderer={{ primaryCanvas, scheduler: { after, fps } }}`.
    - Visibility events: `onFramed`, `onOccluded` (WebGPU only) and `onVisible`.
    - Pointer and input:
      - `state.frustum`.
      - A per-pointer `pointerMap` for multi-touch hover and capture.
      - `frameTimedRaycasts`, which coalesces raycasts to one per frame.
      - `userData.interactivePriority`.
      - DOM drag-and-drop onto 3D objects.
    - Camera and output: the camera is now in the scene graph, and `width`/`height`/`forceEven` give fixed-size output.
    - Core now includes `Environment`, `useTexture` and `useRenderTarget`, and `state.clock` is removed.
    - Sources: [R3F]

15. **TSL hooks.**
    - `useUniforms`/`useUniform` form a shared registry across canvases: one "mood" uniform set can drive every material.
    - `useNodes` and `useLocalNodes`.
    - `useBuffers`/`useGPUStorage` for compute: `instancedArray` feeds `positionNode` on an `instancedMesh` with no CPU copy.
    - `useRenderPipeline`, with MRT support.
    - TSL rebuilds atomically on HMR.
    - Sources: [R3F]

16. **`@pmndrs/scheduler@0.2.0` works today without R3F v10.**
    - npm date 2026-08-24; zero dependencies (React is an optional peer); about 14 KB gzipped unminified.
    - One RAF loop. Phases run `start → input → physics → update → render → finish`, and `addPhase` adds more.
    - Job options: `id`, `phase`, `before`, `after`, `priority`, `fps`, `drop` and `enabled`. It also offers demand and manual stepping and `onIdle`.
    - **0.2.0 has no fixed timestep.** `fps` only caps the rate, and `drop: false` only snaps timing to the fps grid.
    - A fixed 1/60 physics phase with `overstep` exists only in the GitHub main README, so it is unreleased.
    - Sources: [R3F] [ECO] [CRIT]

## C. pmndrs ecosystem packages

17. **drei 10.7.9** is a low-risk patch over Lupi's 10.7.7. Its 10.7.8 changes fixed MeshTransmissionMaterial's backside rendering and FBO sizing, gated rendering on visibility, and optimized its shader.
    - Available but unused in Lupi: `PerformanceMonitor`, `AdaptiveDpr`, `PresentationControls`, `Float`, `Sparkles`, `Trail`, `Sampler`, `MeshPortalMaterial`, `Caustics`, `MarchingCubes`, `Outlines`, `Bvh`, `ScrollControls`, `Detailed`.
    - Sources: [ECO] [CORE]

18. **drei 11.0.0-alpha.7.**
    - Peers: fiber ≥10, three ≥0.185, React <19.3.
    - Of 144 components, 107 are renderer-agnostic and 27 have WebGPU files.
    - 4 are still to do: `Outlines`, `PointMaterial`, `Splat` and `Text` (moving to glyph).
    - 6 won't be ported; for example, `Stars` gives way to `@pmndrs/sky`.
    - "Implemented" means only that a file exists, not that it works.
    - Sources: [ECO]

19. **New WebGPU-side pmndrs packages.**

    | Package | What it does | Fits Lupi? |
    |---|---|---|
    | `@pmndrs/upscaler` 0.2.0 | FSR1 plus temporal upscaling | **Yes, for GPU Studio today**: the only one that peers `three >=0.184` |
    | `@pmndrs/sky` 0.3.0 | Hillaire sky with Earth, Mars and Titan presets and stars | No: needs `three >=0.185`; React bindings need R3F v10 |
    | `@pmndrs/glyph` 0.1.0 | MSDF/Slug text and break-apart glyphs | No: needs `three >=0.185`, R3F `>=9.7 <10` or `>=10.0.0-alpha.4`, React <19.3. Runs on `WebGPURenderer` (including its WebGL2 backend) but **not** classic `WebGLRenderer`; also targets TypeGPU and Tres |
    | `denoiser` v2 | OIDN denoising on the WebGPU execution provider | No: unpublished; npm still has 0.0.11 |

    Sources: [ECO] [CRIT: peers read from npm metadata]

20. **vanruesc `postprocessing` is WebGL-only.** That covers v6 and the v7 beta, whose FrameGraph is typed to `WebGLRenderer`.
    - The installed 6.38.3 already exports `ToneMappingMode.AGX` (7) and `NEUTRAL` (8). Lupi uses only ACES and Reinhard.
    - Sources: [ECO] [CORE] [CRIT]

21. **Other pmndrs pieces relevant to toys.**
    - `@pmndrs/detect-gpu` 6.0.24 (renamed; its gfxbench data stopped updating in Dec 2025).
    - `@pmndrs/pointer-events` + `@react-three/handle`: `OrbitHandles`/`Handle` so grabbing an object doesn't also orbit the camera; demand-frameloop aware.
    - `@react-three/timeline` 0.3.10: generator choreography for tours.
    - `koota` 0.6.6: ECS.
    - react-spring v11 beta: `usePresence`/`usePresenceList`.
    - `@react-three/rapier` 2.2.0: peers fiber ^9.
    - `pmndrs/react-three-examples`: 268 R3F v10 WebGPU ports, usable as templates.
    - Sources: [ECO]

22. **XR stays on the WebGL track.** `@react-three/xr` 6.6.30 has no v10 line. three r185 added WebXR on `WebGPURenderer`, but R3F-XR interop with v10 is unverified.
    - Sources: [ECO] [TJS] [R3F]

## D. three.js and WebGPU

23. **Release dates.** r184 (Lupi's pin) 2026-04-16; r185 2026-06-25; r186 2026-09-08, with 0.186.1 as `latest` on 2026-09-24. r187 is unreleased.
    - Sources: [TJS]

24. **r184 `WebGLNodesHandler` puts TSL NodeMaterials on the classic `WebGLRenderer`** via `renderer.setNodesHandler(new WebGLNodesHandler())`. I verified the file in three 0.184.0.
    - Its header lists what it can't do: no MRT, transmission, storage textures, VSM, WebGPU post stack, `compile()`, or shared instanced geometry.
    - It imports from `three/webgpu`, which pulls the WebGPU module into the WebGL bundle.
    - Result: TSL look-development can reach Lupi's main viewer without swapping renderers.
    - Sources: [TJS] [CRIT]

25. **Other r184 capabilities.**
    - `FSR1Node`, `TAAUNode` and `SharpenNode` (verified present).
    - `compileAsync` is truly non-blocking, and TSL compiles 3× faster.
    - `ReadbackBuffer` and partial readback.
    - The `HTMLTexture` class is present, but it depends on Chrome's HTML-in-Canvas origin trial.
    - Sources: [TJS] [CRIT]

26. **r185 and r186.**
    - r185: `storageTexture3D`, `textureGather`, `ClusteredLighting` (the example drives 900 lights), and WebXR on WebGPU.
    - r186: `GaussianSplat` (TSL; `WebGPURenderer` only), `OITPassNode`, `SSAONode`, VXGI, `SunLight` with cascaded shadow maps, `compileComputeAsync`, atomic workgroup arrays, and GPU `CountingSort`.
    - Breaking changes:
      - r185: `positionLocal` → `positionGeometry` (GPU Studio reads `positionLocal`).
      - r186: `PCFSoftShadowMap` removed.
      - r187 (upcoming): PMREMs become cube render targets.
    - Sources: [TJS]

27. **Compute example scale.**

    | Example | Scale |
    |---|---|
    | `compute_particles` | 200k |
    | `compute_points` | 300k |
    | attractors | 262k |
    | birds | 8,192 boids |
    | MLS-MPM fluid | 32k default, 131k max |
    | snow | 100k, with depth collision |

    - On phones, fill rate and overdraw are the limit, not the simulation: an iPhone 12 Pro Max went from 60 to 20 fps depending on view angle.
    - WebGPU points are 1 px only, so sized particles need instanced sprites.
    - Sources: [TJS] [PLAY]

28. **`WebGPURenderer`'s WebGL2 fallback has limits.**
    - Compute runs via transform feedback, so only simple kernels work. There are no atomics, workgroup memory, storage textures or indirect draws.
    - `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` and pmndrs postprocessing run on **neither** backend. Every Lupi impostor material and its whole post stack would need TSL ports.
    - Always check `renderer.backend.isWebGPUBackend` after `init()`.
    - Sources: [TJS] [R3F]

29. **TSL post nodes** (48 files in 0.186.1): `ao`/GTAO, `ssao`, `ssgi`, `ssr`, `traa`, `taau`/`fsr1`, `smaa`/`fxaa`, `outline`, `bloom` (selective via MRT), `dof`, `motionBlur`, `afterImage`, `transition`, `godrays`, `oit`, pixelation, retro, `sobel`, `bayerDither`, `lut3D`, CRT.
    - Lupi mapping: N8AO → `ao`/`ssao`; Bloom → `bloom`; DOF → `dof`.
    - Sources: [TJS]

30. **Browser support.**
    - Chrome/Edge 113+ on desktop; 121+ on Android 12+.
    - Firefox 141+ on Windows and 145/147+ on Apple Silicon Macs.
    - Safari 26 on iOS, macOS and visionOS has WebGPU on by default (since 2025-09-15). Older iOS falls back to WebGL2.
    - About 87% global support (Aug 2026).
    - Default limits: 128 MiB per storage binding and 256 MiB max buffer. three requests only the defaults.
    - Sources: [TJS] [R3F]

## E. Lupi codebase hooks and constraints

31. **Main viewer setup.**
    - R3F 9.6.1 WebGL2 Canvas with `frameloop={paused ? 'never' : 'always'}` (`ViewerCanvas.tsx:67`), so it renders every frame even when idle.
    - Static DPR: [1, 1.25] on mobile, [1, 1.75] on desktop. `antialias: false`, `preserveDrawingBuffer: true`.
    - No `PerformanceMonitor` or `AdaptiveDpr`.
    - React is locked at 19.2.4, inside v10's `<19.3` peer range, and `<Activity>` is available.
    - Sources: [CORE] [FUN] [CRIT]

32. **Atoms and bonds.**
    - Atoms are GLSL `RawShaderMaterial` ray-cast impostors that write `gl_FragDepth` with conservative depth.
    - Colour, radius and material come from 256-entry palette textures, so recolouring, resizing or hiding an element is about a 1 KB upload.
    - The GPU interpolates `instancePosition` → `instanceTargetPosition` by `uProgress`. That hook is reusable for morphs and display-only offsets.
    - Quality tier is capped by count: at most 1 above 400k atoms, 0 above 2M.
    - Bonds are instanced cylinder impostors. Detection runs in a worker or in WebGPU compute, and GPU is forced above 200k atoms.
    - Sources: [CORE] [SCI]

33. **Budgets and limits.**
    - Atoms: 50M global ceiling; picking up to 5M; large-scene path from 50k; transmission up to 20k.
    - GPU Studio: up to 5k.
    - Looks and Remix treat ≥25k (Looks) or ≥20k (Remix) atoms as large.
    - Mobile post: no AO, Bloom or DOF; MSAA ≤2.
    - The installed `@react-three/postprocessing` 3.0.4 `<N8AO>` already forwards `halfRes`, `depthAwareUpsampling` and `quality`, so half-res AO on mobile needs no upgrade.
    - Sources: [CORE] [FUN] [CRIT]

34. **Feel-critical hand-rolled math, the natural landing zone for `math/time`.**
    - Frame-rate-dependent motion:
      - `CameraFocus`: per-frame lerps of 0.14/0.07; frame-rate dependent and allocates clones every frame.
      - `AnomalyTracker`/`XRControlPanel`: linear-in-dt lerps.
      - `gistEngine`: `EASE = 0.06` per frame.
    - Allocating helpers:
      - `lib/spring.ts`: Euler–Cromer, returns a new object each step, `MAX_STEP` 1/30.
      - `flythrough`: easing and Catmull-Rom that allocate per call.
    - Looks, Remix and camera presets snap instantly.
    - Duplication: at least 3 spring styles, 4 uniform grids and 5 copies of the azimuth/elevation → direction code.
    - Sources: [CORE] [FUN] [MATH]

35. **Performance hotspots.**
    - `AtomPicker` ray-marches in 0.5 Å steps and allocates a `Vector3` per step on every `mousemove`, without rAF throttling.
    - `BillionAtomBlock` allocates every frame and uploads 4 textures even when the camera is still.
    - `GhostAtoms`, GPU Studio and `AtomsTransmission` use the Object3D-dummy `setMatrixAt` pattern, the slowest variant in the benchmark.
    - `KnowledgeLabelsLayer` re-renders about 20 times a second while idle (by code reading).
    - CPU bond detection uses a string-key `Map`.
    - Playback, press springs and vgpu effects each run their own RAF loop.
    - Sources: [CORE] [MATH]

36. **Seeding is a drop-in.**
    - Unseeded `Math.random` drives Remix, flythrough tours, `SceneControls`, `randomOmol`, `swirl` and `gist`.
    - `sceneRemix` and `gistEngine` already accept an injectable `random`, so a `mulberry32` seed in the URL makes them reproducible.
    - `AtomsTransmission` already hand-rolls an LCG for export determinism.
    - Sources: [CORE] [FUN]

37. **Existing toys to build on.**
    - **GPU Studio snowglobe:** `WebGPURenderer` + vgpu WGSL via `tslExports`; event-rendered; DeviceMotion "shake" with the iOS permission pattern; 5k-atom cap; refuses the WebGL2 fallback.
    - **`/scan` gist particle engine:** vgpu compute; 30k/60k/120k particles by device, up to 400k; SDF primitives; swirl → attract → homes. It has **no pointer input**.
    - **Action-light buttons:** one shared low-power vgpu device.
    - **XR grab, throw and squish:** immersive sessions only.
    - **Hidden:** `?billion-atoms` and the `?emoji` wave toy.
    - **Unused or unreachable:** `MobileHUD`; `GhostAtoms` (its setter has no callers); the click-sound synth (no toggle in the UI); the `@rive-app/react-canvas` dependency (no imports).
    - Sources: [FUN]

38. **Landing weight.**
    - `/` mounts `LandingShell` with no three.js, no R3F and **zero canvases**, enforced by Playwright.
    - The viewer chunk is about 1 MB gzipped. The WebGPU vendor chunk is about 176 KB gzipped, plus about 6 KB for vgpu.
    - "Type a thing, particles form it" (`SwitchStage`) exists only inside the viewer's Switch panel.
    - The product reset forbade GPU decoration on the home page.
    - Sources: [FUN] [CRIT]

39. **Product and export rules every idea must meet.**
    - Label decorative motion as illustrative. The precedent is "Display-only inertia. Source atoms never move."
    - Under reduced motion, show a new still frame per action instead of a loop.
    - Request sensor permission only from an explicit gesture.
    - Respect the DPR caps, and use no external textures in GPU Studio.
    - Lazy-load WebGPU and fail soft, advertising it only after a validated frame.
    - Analytics are PII-stripped, and there are no delight events yet.
    - The V1 raster export uses the raw scene with no interactive postprocess, and bonds must be hidden. So looks and display offsets are not part of deterministic export.
    - Sources: [FUN] [PLAY] [AGENTS]

40. **Device realities for fun on phones.**
    - iOS Low Power Mode caps rAF at 30 fps.
    - iOS web haptics fire only from a direct tap on a hidden `<input type="checkbox" switch>` since iOS 26.5: no programmatic or continuous haptics. Android `navigator.vibrate` works.
    - DeviceMotion and DeviceOrientation need a gesture-initiated permission.
    - iPhone Safari has no WebXR `immersive-ar`, so USDZ Quick Look (the exporter already exists) is the iPhone AR path.
    - Video export today is `MediaRecorder` at 1920×1080 for 5 s only (`FigureExportPanel.tsx:57-60`). `mp4-muxer` is declared but unused, and Mediabunny supersedes it.
    - Sources: [PLAY] [SCI] [CRIT]

**Where the idea banks live:** `playful-web.md` §2 (38 patterns) and §4 (21 ranked atom translations); `science-toys.md` §13 (15 ranked ideas plus Tier 2); `r3f-releases.md` §4 (capability → problem table); `pmndrs-math.md` §8; `threejs-webgpu.md` §5; `code-fun.md` §6.2 (opportunity map with constraints).

---

## Corrections and open questions

### Corrections (verified in this pass)

1. **Scheduler fixed timestep. [ECO] was wrong, [R3F] was right.**
   - [ECO] says `@pmndrs/scheduler` has "a fixed 1/60 physics phase with `overstep`". npm `latest` is 0.2.0, and its `dist/index.d.ts` and `dist/index.mjs` contain no fixed-step or `overstep` code.
   - The claim comes from the GitHub main README (`scratchpad/research/gh/scheduler.README.md:9,89`), which is unreleased. CHANGELOG-ALPHA doesn't mention it either.
   - Any jiggle or XPBD toy must write its own accumulator.
2. **`useRenderPipeline` rename version. [TJS] said alpha.4; it was alpha.3.**
   - Source: https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/CHANGELOG-ALPHA.md.
   - The alpha.5 typings export only `useRenderPipeline`.
3. **Landing hero. [SCI] was wrong.**
   - [SCI] says the home hero is the 2D-canvas `MillionAtomPreview`. That component is mounted only by `SceneLandingPage`, which is used only on the retired `/scenes/1m-copper-lattice` route (`apps/web/src/main.tsx:38-46`; `packages/ui/src/ViewerApp.tsx:806-807`).
   - `/` has zero canvases (`tests/ui/student-surface.spec.ts:9`). [FUN] is correct.
4. **Atom trails. [PLAY] and [SCI] said "selected atoms".**
   - Only annotated atoms are tracked (`packages/ui/src/app/ViewerScene.tsx:284-288`: `trackedAtomIndices` comes from `visibleAnnotations`).
   - Annotating needs Shift+click plus a prompt, so trails are effectively unreachable on phones.
5. **`math` colour API. [CORE] cited the wrong function.**
   - [CORE] says `color.fromValues` handles HSL strings. `fromValues(r, g, b)` takes numbers only.
   - CSS and `hsl()` string parsing is `color.setFromColorInput` / `fromColorInput` (`pmndrs-math-src/src/color/parse.ts:166,176`).
6. **`math` picking. [SCI] over-claimed.**
   - [SCI] implies `math/shapes` `sphere` and `raycast3` give CPU picking. There is no ray-sphere test in 0.1.0 or on main; `raycast3` covers only triangles and `Box3`.
   - Atom picking needs a hand-written ray-sphere test (for example, a grid DDA with `raycast3.intersectsBox3` for cell rejection).
7. **N8AO `halfRes`. [CORE] had this as UNVERIFIED; it is verified.**
   - It is forwarded in `@react-three/postprocessing` 3.0.4 (Lupi's) and in 3.1.3 (`dist/index.js` N8AO wrapper → `applyProps(effect.configuration, {..., halfRes, depthAwareUpsampling})`).
8. **`WebGLNodesHandler` in r184. Verified, with one new caveat.**
   - Present at `three@0.184.0/examples/jsm/tsl/WebGLNodesHandler.js`, with the limitations header quoted in fact 24.
   - New caveat: it imports `GLSLNodeBuilder` and friends from `three/webgpu`, which costs bundle size in the WebGL viewer.
9. **`HTMLTexture` browser support. [TJS] had this as UNVERIFIED.**
   - The class exists in three 0.184 `three.core.js`. The underlying HTML-in-Canvas API (`layoutsubtree`, `texElementImage2D`, `copyElementImageToTexture`) is a **Chrome origin trial**, from Chrome 148 according to secondary sources.
   - Firefox and Safari have made no commitment. Treat it as a Chromium-only progressive enhancement.
   - Sources: https://developer.chrome.com/blog/html-in-canvas-origin-trial, https://tympanus.net/codrops/2026/05/13/exploring-the-html-in-canvas-proposal/
10. **Peer gates were understated in [ECO].**
    - `@pmndrs/glyph` and `@pmndrs/sky` both need `three >=0.185`, so neither fits Lupi without a three bump. `@pmndrs/upscaler` (`three >=0.184`) is the only new pmndrs WebGPU package that fits today.
    - The `@react-three/tsl` canaries (dist-tags `latest`=`10.0.0-canary.490e4992`, `canary`=`14007b4`) peer `fiber ^10.0.0-alpha.6`, which is not yet published.
11. **React version, which was a coverage gap.**
    - The lock has `react`/`react-dom` 19.2.4 (the Expo app has 19.2.3). That fits R3F v10, drei 11, glyph and tsl (`<19.3`) and gives R3F 9.8.1's `<Activity>` support.
    - Do not bump to React 19.3 while targeting v10 alpha.
12. **`math` status as of today.**
    - No release after 0.1.0. PR #50 (`math/three`) is still open, with its last push on 2026-09-07, no reviews and no changeset. Don't plan on the bridge.
    - Source: https://github.com/pmndrs/math/pull/50
13. **Minor.** [FUN] says both `maath` 0.10.8 and 0.6.0 arrive via drei. The 0.6.0 copy actually arrives via `@react-three/postprocessing` 2.19.1 in `apps/web`, per [MATH].

### Open questions (unresolved; flag before committing to an idea)

1. **Does iPhone Safari 26.x accept the gist engine's `requiredLimits: { maxStorageBuffersInVertexStage: 1 }` (`packages/ui/src/scan/gist/gistParticles.ts:94`)?**
   - Safari Technology Preview 244 (2026-05-21) "Restored `maxStorageBuffersInFragmentStage` and related WebGPU limits", which suggests the stable status has changed over time.
   - Firefox has recognized these limits since 151 but ignores requested values, and the fix is still in progress (Bugzilla 2006720, reopened).
   - If the key is unrecognized, `requestDevice` rejects and the stage falls back to swirl or CSS. **Every "reuse the gist engine on phones" idea needs a real-device check.**
   - Sources: https://webkit.org/blog/17962/release-notes-for-safari-technology-preview-244/, https://bugzilla.mozilla.org/show_bug.cgi?id=2006720
2. **There is no real-device FPS or thermal data for the main viewer or GPU Studio on phones.** The docs say device FPS is unproven. The cost of idle `frameloop='always'` has not been measured.
3. **Will the `math/three` bridge (#50) or the Wasm SIMD path (#51) ship, and will crashcat and navcat move from `mathcat` to `math`?**
4. **Can `@react-three/xr` run under R3F v10?** And can fiber 9 and fiber 10 coexist in one bundle via aliasing? pmndrs/glyph PR #193 dual-targets the two versions, which hints it is possible.
5. **Export parity if the viewer moves to `WebGPURenderer`.**
   - `preserveDrawingBuffer` has no WebGPU equivalent; readback would go through `readRenderTargetPixelsAsync` or `ReadbackBuffer`.
   - The V1 `rendererFingerprint` and `artifactKey` would change.
6. **Do Lupi's custom WGSL/GLSL impostors write the velocity and depth that TRAA, TAAU and the temporal upscaler need?** Also, what replaces `layout(depth_greater)` early-Z in WGSL?
7. **Build hygiene.**
   - Is `r3f-perf`, with its drei 9 and zustand 4, in the production bundle?
   - Does Vite `dedupe` collapse `packages/ui` onto zustand 4.5.7?
8. **vgpu 0.4.0 → 0.5.0 breaking changes (not read), and whether `initFromDevice` can share one `GPUDevice` with three end to end.**
9. **iOS haptics.** The claims about the 26.5 patch come from library authors, not a WebKit primary source, so they need a device test.
   - Sources: https://haptics-web.vercel.app/, https://github.com/m1ckc3s/project-fathom
10. **drei 11 "WebGPU implemented" components are unverified at runtime.** `Outlines`, `PointMaterial` and `Text` are known to be broken or missing on WebGPU.
11. **Coverage gaps no digest addressed:**
    - Accessibility of play modes beyond reduced motion: keyboard equivalents for pokes, flicks and shakes, and screen-reader narration of toy state.
    - Bundle-size budgets for adding the scheduler (about 14 KB gzipped unminified) and `math` subpaths to the viewer chunk versus the landing.
    - Whether analytics should add "delight" events.
