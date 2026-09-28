# pmndrs ecosystem survey, 2025-01 to 2026-09: what it means for Lupi's viewer

Research date: 2026-09-27. Method: npm registry metadata (publish times, dist-tags, peer deps), partial git clones of pmndrs repos (commit logs, CHANGELOGs, branch files), raw READMEs, and a few web searches. The GitHub REST API was blocked in this session, so GitHub release-page text was not read directly. Commit and changeset text stand in for it. Anything I could not confirm from a primary source is marked **UNVERIFIED**.

Scope note: this digest covers the ecosystem *around* R3F core and the new `math` library, which are assumed to be covered elsewhere. I summarise R3F v9.7–v10 only where it gates other upgrades.

---

## 0. TL;DR for the brainstorm

1. **The ecosystem has split into two tracks: WebGL (v9 / drei 10 / postprocessing) and WebGPU (R3F v10 alpha / drei 11 alpha / TSL).** Lupi's default viewer sits on the WebGL track. GPU Studio is vanilla `three/webgpu`, and several brand-new pmndrs WebGPU packages can drop into it today.
2. **Four new WebGPU-only packages are the most useful for visuals.** `@pmndrs/upscaler` (FSR1 plus FSR2/3-style temporal upscaling, three ≥0.184, so it fits Lupi now), `@pmndrs/sky` (physical Hillaire sky with earth/mars/titan presets, star field, aerial-perspective haze; three ≥0.185), `denoiser` v2 (OIDN on WebGPU + onnxruntime-web; v2 is not on npm yet), and `@pmndrs/glyph` (MSDF/Slug text through `WebGPURenderer`; three ≥0.185, R3F ≥9.7).
3. **Postprocessing stays WebGL.** `postprocessing` v6.39.5 and the v7 beta branch are both typed to `WebGLRenderer`. On WebGPU, post goes through three's `RenderPipeline` via R3F v10 `useRenderPipeline`. `@react-three/postprocessing` 3.1.x now requires `@react-three/fiber >=9.7.0`, and Lupi resolves 9.6.1.
4. **drei 11 alpha ships `/legacy` and `/webgpu` entries plus a machine-generated port-status file.** Of 144 components, 107 are renderer-agnostic, 27 have WebGPU files, 4 are todo, and 6 won't be ported. `MeshTransmissionMaterial`, `Caustics`, `AccumulativeShadows`, `ContactShadows`, `Sparkles`, `MeshPortalMaterial`, `GradientTexture` and `Trail` have WebGPU versions. `Outlines`, `PointMaterial`, `Splat` and `Text` do not. `Text` is being replaced by `@pmndrs/glyph`.
5. **Packages have moved and been renamed.** `detect-gpu` became `@pmndrs/detect-gpu` v6 (its gfxbench data source stopped updating in Dec 2025). `maath` became `math`: the repo was renamed. `lamina` is archived. react-spring v11 beta deprecates `useTransition` in favour of `usePresence`/`usePresenceList`.
6. **Lupi's dependency tree has upgrade debt.** `apps/web` pins `@react-three/postprocessing ^2.16.0` and `zustand ^4.5.5` while `packages/ui` uses 3.x and 5.x. `r3f-perf` pulls a second drei (9.122.0) and zustand 4. `leva` 0.10.1 pulls zustand 3.7.2.

---

## 1. Lupi's current versions and the upgrade gap

Declared specifiers are from the package.json files. Resolved versions are from `pnpm-lock.yaml`. Latest versions are from the npm registry on 2026-09-27.

| Package | `packages/ui/package.json` | `packages/scene/package.json` | `apps/web/package.json` | Resolved (lock) | Latest stable (date) | Next / prerelease (date) |
|---|---|---|---|---|---|---|
| `@react-three/fiber` | `^9.6.0` (L31) | `^9.6.0` (L27) | `^9.6.1` (L20) | 9.6.1 | 9.8.1 (2026-09-24) | 10.0.0-alpha.5 (2026-09-08) |
| `@react-three/drei` | `^10.0.0` (L30) | `^10.0.0` (L26) | `^10.7.7` (L19) | 10.7.7 | 10.7.9 (2026-09-25) | 11.0.0-alpha.7 (2026-09-05) |
| `@react-three/postprocessing` | `^3.0.0` (L32) | — | `^2.16.0` (L21) | 3.0.4 (ui), **2.19.1 (web)** | 3.1.3 (2026-09-27), needs fiber ≥9.7.0 | — |
| `postprocessing` | `^6.36.0` (L40) | — | `^6.36.0` (L25) | 6.38.3 | 6.39.5 (2026-09-09) | 7.0.0-beta.16 (2026-02-19) |
| `@react-three/xr` | `^6.6.29` (L33) | — | — | 6.6.29 | 6.6.30 (2026-05-29) | no v10 line |
| `leva` | `^0.10.1` (L38) | — | — | 0.10.1 | 0.10.1 (2025-10-31) | headless entry merged but unreleased |
| `zustand` | `^5.0.0` (L45) | — | `^4.5.5` (L29) | 5.0.11 (ui), **4.5.7 (web)** | 5.0.15 (2026-08-13) | — |
| `three` | `^0.184.0` (L43) | `^0.184.0` (L29) | `^0.184.0` (L28) | 0.184.0 | 0.186.1 (2026-09-24) | — |
| `r3f-perf` (not pmndrs) | `^7.2.3` (L41) | — | — | 7.2.3 | 7.2.3 (2024-11-08) | — |
| `@react-three/test-renderer` | `^9.1.0` (L48) | `^9.1.0` (L34) | — | 9.1.0 | 9.1.1 (2026-07-31) | 10.0.0-alpha.5 |
| transitive `detect-gpu` | via drei | | | 5.0.70 | moved to `@pmndrs/detect-gpu` 6.0.24 (2026-09-27) | |
| transitive `maath` | via drei, rpp | | | 0.10.8 | renamed to `math` 0.1.0 (2026-09-11) | maath 1.0.0-canary (2026-08-17) |
| transitive `n8ao` (not pmndrs) | via rpp 3.0.4 | | | 1.10.1 | 2.0.1 (2026-08-10); rpp ≥3.0.5 needs `^2.0.0` | |
| transitive `three-mesh-bvh` | via drei 10 | | | 0.8.3 | 0.9.15; drei 11 uses `^0.9.14` | |

Code-level observations relevant to upgrades:

- **Possible zustand version conflict (UNVERIFIED at runtime; node_modules were not installed here).** `apps/web/vite.config.ts:294` sets `resolve.dedupe: [..., 'zustand']`. Vite resolves deduped packages from the app root, and `apps/web` resolves zustand 4.5.7. `packages/ui` declares `^5.0.0`. `apps/web/src` has no direct `zustand` or `@react-three/postprocessing` imports, so both `apps/web` deps look vestigial.
- **Duplicate trees.** `r3f-perf@7.2.3` depends on `@react-three/drei@9.122.0` and `zustand@4.5.7` (lock snapshot around line 7840). `leva@0.10.1` depends on `zustand@3.7.2`. `r3f-perf` is statically imported at `packages/ui/src/ViewerApp.tsx:98` and only rendered under `import.meta.env.DEV` (L670-671). Whether it is tree-shaken from production is UNVERIFIED.
- **drei surface area used today is small.** `Text` appears in 5 files (`MeasurementLayer.tsx:1`, `xr/XRControlPanel.tsx:3`, `KnowledgeLabelsLayer.tsx:18`, `AnnotationsLayer.tsx:26`, `SpatialAnchor.tsx:7`). `Html` appears in 3 (`KnowledgeLabelsLayer.tsx:18`, `AnnotationsLayer.tsx:26`, `AtomInfoHUD.tsx:12`). `Billboard` is used in 3, `OrbitControls` in 3, `ContactShadows` in 2. Single uses: `GizmoHelper`/`GizmoViewport` (`app/ViewerScene.tsx:2`), `useEnvironment` (`SceneLighting.tsx:19`), `RoundedBox`, `Line`, `Grid`/`Environment` (`Testbed.tsx:3`), and `MeshTransmissionMaterial` (`packages/scene/src/AtomsTransmission.tsx:27`). None of the playful helpers (`PerformanceMonitor`, `Float`, `Sparkles`, `PresentationControls`, `CameraControls`, `Trail`, `Sampler`, `Instances`) are used yet.
- **Postprocessing stack.** `packages/ui/src/postprocess/ScenePostprocessing.tsx:16-17` imports `EffectComposer, N8AO, Bloom, ToneMapping, Vignette, DepthOfField` from `@react-three/postprocessing`, with `mipmapBlur` and luminance threshold/smoothing props on Bloom.
- **Device tiering is heuristic only.** `packages/ui/src/deviceCapabilities.ts:116-136` uses UA, `deviceMemory` and `hardwareConcurrency`. There is no GPU benchmark and no runtime adaptive quality: no `PerformanceMonitor` or `AdaptiveDpr`. DPR is a static range from `viewerDprRange()` (`viewer/ViewerCanvas.tsx:33`).
- **GPU Studio.** `packages/ui/src/gpu-studio/runtime.ts` is vanilla `three/webgpu` (L1-28) with its own `requestAnimationFrame` loop (L124). It builds `new WebGPURenderer({ device, alpha: true, antialias: true })` from an externally supplied `GPUDevice` (L161). There is no post graph yet. This is the natural home for `@pmndrs/upscaler`, `@pmndrs/sky` and `denoiser`, all of which take a renderer or device.

---

## 2. Org-level: new pmndrs repos created 2025-2026

Source: GitHub search `org:pmndrs created:>2025-01-01`, which returned 19 repos. npm data was cross-checked.

| Repo | Created | npm package (latest, date) | What it is |
|---|---|---|---|
| `pmndrs/viverse` | 2025-07-17 | `@react-three/viverse` / `@pmndrs/viverse` 0.2.29 | Toolkit for character-based XR/desktop/mobile web games (`<SimpleCharacter/>`, `BvhPhysicsBody`, `PrototypeBox`) |
| `pmndrs/timeline` | 2025-07-15 | `@react-three/timeline` / `@pmndrs/timeline` 0.3.10 (2026-06-16) | Generator-based composable 3D behaviours (`useRunTimeline`, `action`, `lookAt(…, spring())`) |
| `pmndrs/uikitml` | 2025-07-30 | `@pmndrs/uikitml` 0.1.12 (2025-11-18) | Markup language for uikit 3D UIs |
| `pmndrs/BVHEcctrl` | 2025-04-01 | `bvhecctrl` 0.0.18 (2025-08-14) | three-mesh-bvh character controller (no physics engine) |
| `pmndrs/prai` | 2025-03-20 | — | LLM step-by-step instruction framework (not graphics) |
| `pmndrs/native` | 2025-12-26 | `@react-three/native` not on npm (404) | R3F for React Native, v10 monorepo |
| `pmndrs/org` | 2026-01-22 | — | Charter plus 4 active initiatives: R3F v10, design system, canvas text rendering, interactive math engine |
| `pmndrs/labs` | 2026-03-20 | `@pmndrs/labs` 0.9.0 (2026-09-03) | Statistically sound JS benchmarking (Node-only) |
| `pmndrs/react-three-start` | 2026-05-12 | `@react-three/start` 0.1.7 (2026-05-26) | File-based R3F meta-framework (`*.scene.tsx`, `*.dom.tsx`) |
| `pmndrs/scheduler` | 2026-06-29 | `@pmndrs/scheduler` 0.2.0 (2026-08-24) | Framework-agnostic frame scheduler behind R3F v10 `useFrame`: phases, priorities, per-job FPS, fixed-step physics |
| `pmndrs/sky` | 2026-06-30 | `@pmndrs/sky` 0.3.0 (2026-09-08) | Hillaire atmospheric sky in TSL, WebGPU only |
| `pmndrs/denoiser` (+ `denoiser-weights`) | 2026-07-06 | npm `denoiser` latest is 0.0.11 (2024-07-31); repo `packages/denoiser` is **2.0.0, unpublished** | OIDN U-Nets via onnxruntime-web WebGPU EP plus WGSL pre/post |
| `pmndrs/upscaler` | 2026-07-09 | `@pmndrs/upscaler` 0.2.0 (2026-07-29) | FSR1 + FSR2/3-style temporal upscaler for `WebGPURenderer` in WGSL compute, plus TSL nodes |
| `pmndrs/glyph` | 2026-07-22 | `@pmndrs/glyph` 0.1.0 (2026-09-18) | Typography engine: HarfRust shaping in Wasm, bitmap/MSDF/Slug, R3F/Tres/TypeGPU |
| `pmndrs/react-three-examples` | 2026-07-26 | — | 268 three.js examples rebuilt in R3F v10, WebGPU-first |
| `pmndrs/claude-code-plugin` | 2026-08-09 | — | Claude Code plugin exposing the `pmndrs` docs MCP server (`https://docs.pmnd.rs/api/mcp`) and skills |
| `pmndrs/paris-site`, `pmndrs/design-system` | 2026-08 | — | Workshop site (R3F v10 alpha, Gobelins Paris, 2026-09-08/09) and shared design system |

Related projects that are *not* in the pmndrs org, verified:

- `navcat` 0.4.1 (2026-05-06, navmesh) and `crashcat` 0.0.5 (2026-07-06, pure-JS rigid-body physics with CCD, constraints and sleeping). Both are by pmndrs maintainer Isaac Mason on `github.com/isaac-mason` and depend on `mathcat`.
- `triplex` is pmndrs but older (2023). Its last release commits are from Jan 2026. It is an editor/VS Code tool, not a runtime.

Two pre-2025 repos had notable 2025-2026 activity: `react-three-jolt`, which set up a 1.0.0-alpha on 2026-09-22 requiring R3F ≥10 and three ≥0.185 but is still 0.0.1 on npm, and `ecctrl`, which released v2.0.0 on 2026-06-15 as a "character, vehicle, and custom-gravity controller".

---

## 3. Dated release table (2025-01 to 2026-09)

| Package | Releases in window (selected) | Latest stable | Prerelease | Activity signal |
|---|---|---|---|---|
| `@react-three/drei` | 10.0.0 (2025-02-19, React 19); 10.1.0 (05-29); 10.2.0 (06-11); 10.3.0 (06-15); 10.4.0 (07-01); 10.5.0 (07-08); 10.6.0 (07-23); 10.7.0 (08-16); 10.7.7 (2025-11-13); 10.7.8 (2026-08-05); 10.7.9 (2026-09-25) | 10.7.9 | 11.0.0-alpha.1 (2026-01-14) … alpha.7 (2026-09-05) | very active (v11-working) |
| `postprocessing` | 6.37.0 (2025-03-03); 6.37.6 (07-04); 6.38.0 (2025-11-08); 6.38.3 (2026-02-19); 6.39.0 (2026-03-20); 6.39.5 (2026-09-09) | 6.39.5 (three `>=0.168 <0.187`) | 7.0.0-beta.5 (2025-02-09) … beta.16 (2026-02-19) (three `>=0.179 <0.186`) | active; v7 branch commits through 2026-09-19 |
| `@react-three/postprocessing` | 3.0.0 (2025-02-19); 3.0.4 (2025-02-20); 3.0.5 (2026-08-09); 3.1.0 (2026-08-23); 3.1.3 (2026-09-27) | 3.1.3 | — | revived Aug 2026 |
| `@react-three/xr` / `@pmndrs/xr` / `pointer-events` / `handle` | 6.5.0 (2025-01-20); 6.6.0 (2025-01-30); … 6.6.29 (2026-01-06); 6.6.30 (2026-05-29) | 6.6.30 | — | maintenance |
| `@react-three/uikit` / `@pmndrs/uikit` | 0.8.x (to 2025-06-25); 1.0.30 (2025-09-12) … 1.0.76 (2026-09-01); `uikit-horizon` kit created 2025-09-14 | 1.0.76 | — | active |
| `koota` | 0.2.0 (2025-02-28) … 0.5.0 (2025-07-18) … 0.6.0 (2025-12-16) … 0.6.6 (2026-04-09) | 0.6.6 | canaries to 2026-09-16 | active |
| `zustand` | 5.0.3 (2025-01-07) … 5.0.15 (2026-08-13); 4.5.7 (2025-05-15) | 5.0.15 | — | patch-level |
| `leva` | 0.10.0 (2025-01-22); 0.10.1 (2025-10-31) | 0.10.1 | — | slow; `leva/headless` merged 2025-11-08, unreleased |
| `@react-spring/three` | 10.0.0 (2025-05-14, React 19); 10.1.0 (2026-05-22); 10.1.2 (2026-06-24) | 10.1.2 | 11.0.0-beta.0 (2026-06-21) | active |
| `@use-gesture/react` | none | 10.3.1 (2024-03-21) | — | dormant |
| `@react-three/rapier` | 2.0.0 (2025-03-02); 2.1.0 (2025-04-06); 2.2.0 (2025-11-03, rapier3d-compat 0.19.2, contact/intersection-pair filter hooks) | 2.2.0 (fiber `^9.0.4`) | — | slow |
| `detect-gpu` → `@pmndrs/detect-gpu` | detect-gpu 5.0.64-5.0.70 (to 2025-02-23); `@pmndrs/detect-gpu` 6.0.0 (2026-01-20) … 6.0.24 (2026-09-27, weekly) | 6.0.24 | — | active under new name |
| `@pmndrs/vanilla` (drei-vanilla) | 1.20.x-1.25.0 (2025-09-17): CameraShake, Sparkles, Stars, Trail, Fisheye added | 1.25.0 | — | slow |
| `gltfjsx` | none | 6.5.3 (2024-11-04) | — | dormant |
| `@react-three/offscreen` | 1.0.0-rc.1 (2025-01-30) | 0.0.8 | rc.1 | dormant |
| `@react-three/a11y` | none | 3.0.0 (2022-05-15) | — | dormant (docs only 2026-08) |
| `three-stdlib` | 2.35.3-2.36.0 (2025-04-29); 2.36.1 (2025-11-10) | 2.36.1 | — | maintenance |
| `@react-three/csg` | 3.3.0 (2025-01-11); 4.0.0 (2025-03-02) | 4.0.0 | — | dormant |
| `@react-three/flex` | none | 1.0.1 (2022-12-03) | — | dormant (uikit covers layout) |
| `lamina` | 1.2.0-1.2.2 (2025-06-21) | 1.2.2 | — | **repo archived** |
| `maath` → `math` | maath: only 1.0.0 canaries (2026-08-16/17); `math` 0.1.0 (2026-09-11) | math 0.1.0 | math canaries daily | repo renamed |
| `@react-three/lightmap` | none | 0.0.8 (2022-01-22) | — | dormant |
| `@react-three/gpu-pathtracer` | 0.3.0-0.3.2 (2025-06-22 to 07-07) | 0.3.2 | — | slow |
| `@pmndrs/assets` | none | 1.7.0 (2024-09-25) | — | dormant |
| `@react-three/fiber` (context) | 9.0.0 (2025-02-19) … 9.6.0 (2026-04-13), 9.7.0 (2026-07-31), 9.8.0 (2026-09-22), 9.8.1 (2026-09-24) | 9.8.1 | 10.0.0-alpha.0 (2026-01-14) … alpha.5 (2026-09-08) | very active |
| `@react-three/tsl` (new) | first publish 2026-09-26 (canary only) | — | 10.0.0-canary | brand new |

---

## 4. Per package: what's new and what it unlocks for a fun particle/molecule viewer

### 4.1 drei 10.7.x (WebGL, today)

- **What changed in the window:**
  - React 19 support landed on 2025-02-19.
  - `CameraControls` gained 1:1 event callback props (`onX`, 10.1.0), a custom `impl` subclass (10.3.0) and the camera-controls v3 upgrade (10.5.0/10.6.0).
  - `RoundedBoxGeometry` is now exported (10.2.0).
  - `Fbo` became usable as a ref component (10.4.0).
  - `Center[object]` was added (10.7.0).
  - 10.7.8 (2026-08-05, PR #2759): **MeshTransmissionMaterial fixes backside rendering, sets FBO dimensions, gates rendering on visibility, and optimises its shader.**
  - 10.7.9 (2026-09-25): AccumulativeShadows no longer leaks `scene.environment` into the light map (a three r182+ regression, PR #2833), and SoftShadows keeps working with newer three (PR #2846).
- **What it unlocks:**
  - Upgrading 10.7.7 to 10.7.9 is a low-risk patch. It directly benefits `AtomsTransmission.tsx` ("glass atoms" becomes cheaper, and it can be skipped when offscreen).
  - The unused playful helpers are all available on drei 10 today: `PerformanceMonitor` + `AdaptiveDpr` (auto-degrade on phones), `PresentationControls` (spring-back "turntable" for the landing hero), `Float` (idle bobbing), `Sparkles` (ambient "electron dust"), `Trail` (atom trajectories as light trails), `Sampler`/`useSurfaceSampler` (scatter particles on a molecular surface mesh), `Instances`/`Merged`, `MeshPortalMaterial` (step "inside" a molecule or unit cell), `Caustics` (light through a glass molecule onto a floor), `AccumulativeShadows` + `Environment`/`Lightformer` (studio photo mode), `MarchingCubes` (metaball "blobby" electron-density toy), `ScrollControls` (scroll-driven story mode), `Detailed` (LOD), `Bvh` (fast raycast picking), and `Outlines`.

### 4.2 drei 11 alpha (WebGPU/R3F v10 track)

- **Structure.** The package has these exports: `.`, `./core`, `./legacy` (WebGL, GLSL), `./webgpu` (TSL), `./external`, `./experimental` and `./native`. Peer deps are `@react-three/fiber >=10.0.0-0`, `three >=0.185` and `react >=19.0 <19.3`. It bumps `three-mesh-bvh` to `^0.9.14` and `stats-gl` to `^4.2.3`.
- **The port status is auditable.** `component-status.json` on branch `v11-working` is generated by `scripts/audit-components.js` and totals 144 components: 107 agnostic, 27 implemented (a WebGPU file exists), 4 todo, 6 wont-port. The migration guide warns that "implemented" means only that a file exists under `src/webgpu/`, not that it works.
- **Status of the playful helpers the brief asked about:**

| Helper | drei 11 status | Notes |
|---|---|---|
| MeshTransmissionMaterial, Caustics, AccumulativeShadows, ContactShadows, BakeShadows, SoftShadows | WebGPU implemented | legacy and TSL versions |
| Sparkles, MeshPortalMaterial, GradientTexture, MeshDistortMaterial, MeshWobbleMaterial, Grid, Line, Segments, Wireframe | WebGPU implemented | |
| Trail | legacy + webgpu + experimental | |
| PerformanceMonitor, AdaptiveDpr, Bvh, Instances (incl. Merged), Points, Float, PresentationControls, CameraControls, ScrollControls, Sampler (useSurfaceSampler), Detailed, Stage, Environment, Lightformer, Html, Text3D, Billboard, GizmoHelper, OrbitControls, StatsGl | agnostic | same component works on both renderers |
| MarchingCubes | agnostic (`/experimental`) | |
| Outlines | **todo**: broken on WebGPU (#2813, #2818) | |
| PointMaterial | **todo**: `onBeforeCompile` GLSL, so points silently render as squares on WebGPU | |
| Splat | **todo**: raw GLSL, likely wont-port | |
| Text (troika) | **todo**: vendored troika WebGPU fork removed; "returns via @pmndrs/glyph" (#2658) | |
| Stars | **wont-port**: removed from `/webgpu` 2026-09-26; use `@pmndrs/sky` | |
| Sky | root/core entry is now WebGL-only; import from `/webgpu` to get `SkyMesh` | |
| shaderMaterial, Effects, useBoxProjectedEnv, ShadowAlpha, AsciiRenderer | wont-port | |
| Inspector (new, WebGPU only) | added 2026-09-05 (#2827) | three.js Inspector wired to R3F v10 frame phases, with `useInspectorControls` (a leva-like panel on three's editors) |

- **What it unlocks:** a path to put Lupi's main viewer on WebGPU without losing glass atoms, caustics, contact shadows or sparkles. The risks for Lupi specifically are `Text`, which is used in 5 files and would move to `@pmndrs/glyph`, and `Outlines`/`PointMaterial` if selection glow or point sprites rely on them.

### 4.3 `postprocessing` (vanruesc) v6 and v7

- **v6 in the window:**
  - 6.37.0: `ASCIIEffect` rework.
  - 6.37.6: Bloom `mipmapBlur` now defaults to true, and the luminance threshold/smoothing defaults changed.
  - 6.38.0 (2025-11-08): DepthOfField gained distance-based circle of confusion, plus depth copying, log and **reversed depth** support, and a god-rays fix.
  - 6.38.1-6.38.3: colour-accuracy fixes.
  - 6.39.0 (2026-03-20): `needsDepthBlit` and more robust depth-texture management, with the minimum raised to three r168.
  - 6.39.5 (2026-09-09): "Backport changes from v7" and a multisampling fallback.
- **v7 beta:** a new FrameGraph/RenderPipeline architecture (topological sort, `InOut`, commits through 2026-09-19). New effects/passes on the branch include `HalftoneEffect`, `GeometryPass`, `DepthPickingPass`, `UIPass`, `LensDistortionEffect`, `LUT1D/3D`, `MipmapBlurPass` and `BufferDebugPass`. **Source is still GLSL (`.frag`), and `FrameGraph`, `Pass` and `RenderTaskContext` are typed to `WebGLRenderer`.** One web search result claimed v7 targets `WebGPURenderer`; the branch source contradicts this, so that claim is UNVERIFIED.
- **What it unlocks:** on the WebGL viewer, a cheap 6.38.3 → 6.39.5 bump and reversed-depth support for huge scenes such as the billion-atom page. It is not a WebGPU path. For GPU Studio, use three's TSL `RenderPipeline` nodes: bloom, GTAO, SSGI, SSR, TRAA, DoF and motion blur all exist as `react-three-examples` ports.

### 4.4 `@react-three/postprocessing` 3.0.5-3.1.3 (Aug-Sep 2026)

- **What changed:**
  - The EffectComposer pass lifecycle was rewritten for correctness and cost.
  - New `<EffectGroup>` does explicit grouping with a pass-level enable toggle.
  - EffectComposer gained `mergeMode`, `renderPass` (custom RenderPass factory) and `autoRenderToScreen` props.
  - **New `DepthPicking` component and `useDepthPicking` hook** (#288).
  - `LensFlare` is exposed via ref, and Outline/GodRays warn when `autoClear={false}` is missing.
  - The composer now resizes on pixel-ratio change (2026-09-25).
  - mainUv effects are kept out of passes merged with convolution effects (2026-09-22).
  - Effect components ship for ASCII, Water, Ramp, TiltShift2, LensFlare, Grid, Sepia and more.
- **Peer and dependency changes:** `@react-three/fiber >=9.7.0` (raised in 3.0.5 because R3F 9.7.0 fixed a reconciler dedupe issue), `postprocessing ^6.36.0`, and `n8ao ^2.0.0`.
- **What it unlocks for fun:**
  - `useDepthPicking` gives tap-to-focus depth of field on mobile. Tap an atom and the lens racks focus, without CPU raycasting of millions of atoms.
  - `EffectGroup` enables "look presets" that flip whole effect sets without recreating the composer, which is cheaper mood switching.
  - The ASCII, Halftone (v7) and Water effects are one-tap "remix" filters.
- **Requirements:** Lupi must go to fiber ≥9.7.0 first, and should drop the stale `apps/web` 2.x pin.

### 4.5 `@react-three/xr`, `@pmndrs/pointer-events`, `@react-three/handle` 6.6.x

- **What changed:**
  - `XRLayer` gained depth sorting and `forwardRef`.
  - Handles gained `disabled`/`enabled` options, per-axis disabling, `filter`, and uniform-axis scale handles.
  - Handles now call `invalidate()` so they work with `frameloop="demand"` (2026-04-30), and pointer-cancel now correctly ends drags (#492, 2026-05-29).
  - Agent "skills" were added for react-three/xr (2026-05-27).
- **Screen handles.** `OrbitHandles` and `MapHandles` are drop-in replacements for OrbitControls/MapControls that go through the scene's pointer-event system, so grabbing an object doesn't also orbit the camera. They support damping, rotate/zoom/pan filters per input device, and an external camera `store`. Setup is `<Canvas events={noEvents}><PointerEvents/>…`.
- **What it unlocks:** "grab and fling a molecule" on phone and desktop with one API that also works in AR/VR. You can pinch-scale a single residue with `<Handle>` while the camera stays put.
- **WebGPU:** none. The `react-three-examples` README says "@react-three/xr has no v10 branch" and defers XR until `XRGPUBinding` ships. Treat XR as WebGL-only.

### 4.6 uikit 1.0.x, uikitml, and `@pmndrs/glyph`

- **uikit 1.0.x** (2025-09 onward):
  - Changes include raycasting and perf fixes, direct transform props on the root, `set/resetGlobalProperties`, solid-block fallback for missing glyphs, TTF packages, and a Horizon kit (`@react-three/uikit-horizon`).
  - It is **WebGL-only**: panel and glyph materials patch GLSL through `onBeforeCompile` (`packages/uikit/src/panel/material/create.ts:25-26`, `text/render/instanced-glyph-material.ts:12`).
  - Useful for in-canvas UI in XR, for example a periodic-table wrist menu.
- **`@pmndrs/glyph` 0.1.0** (2026-09-18):
  - Rendering: HarfRust shaping (Wasm, SIMD), bitmap/MSDF/Slug rendering, MSDF outlines and hard shadows, and editorial layout with polygon cut-outs.
  - "Break-apart glyphs" give detached per-glyph copies with independent transforms.
  - It supports icon fonts and has a CLI font baker (`glyph bake … --msdf --slug`).
  - Supports **WebGPU and WebGL2 through `WebGPURenderer`, but not the classic `WebGLRenderer`**. Peer deps are three ≥0.185 and R3F ≥9.7 <10 or ≥10.0.0-alpha.4.
  - What it unlocks: atom labels that explode into letters when tapped, element symbols that flow around a molecule's silhouette, and crisp labels at any zoom level.

### 4.7 The WebGPU-native newcomers: sky, upscaler, denoiser, scheduler

- **`@pmndrs/sky` 0.3.0**
  - A physically based sky with NOAA solar position (`setTimeOfDay`, `setLatitude`, `setDayOfYear`), presets `'earth' | 'mars' | 'titan'`, and a star field.
  - Aerial-perspective haze via `sky.applyHaze(...)` or `<AutoHaze/>`, and `setMirrorBelowHorizon` for a clean HDRI on reflective floors. `sky.attach(scene)` sets both `scene.environment` and `scene.background`.
  - Vanilla `Sky(renderer, …)` works; the React bindings need R3F ≥10.0.0-alpha.4.
  - What it unlocks: "the molecule at sunset on Mars" as a one-slider environment and lighting mood for GPU Studio. Real image-based lighting changes as the sun moves.
- **`@pmndrs/upscaler` 0.2.0**
  - Hand-written WGSL FSR passes. There is a TSL node `upscaleScene(scene, camera, { quality })` for the post graph, a composable `upscale(color, depth, velocity, camera, …)`, `upscaleSpatial(color)`, and an imperative `Upscaler`.
  - The temporal path gives anti-aliasing plus reconstruction from roughly 1/1.5-1/2 resolution.
  - Needs three **≥0.184, which Lupi already has**, and runs on WebGPU only. There are 11 live demos.
  - What it unlocks: high atom counts on phones by rendering at half resolution in GPU Studio. Caveat: whether Lupi's custom-WGSL instanced atom impostors write correct velocity/depth for the temporal path is UNVERIFIED. The spatial FSR1 path needs neither.
- **`denoiser` 2.0.0** (repo; npm still 0.0.11)
  - Runs OIDN U-Nets on the WebGPU execution provider. The README reports 512² in about 14 ms and 1080p in about 104 ms (fp16, M-series).
  - It has a zero-copy path, `Denoiser.create()` then `new WebGPURenderer({ device: denoiser.device })`. Lupi's GPU Studio already constructs its renderer from a supplied device (`runtime.ts:161`).
  - What it unlocks: a progressive "photo mode" (path-traced or accumulated) that looks clean in about a second. Models are hosted separately (0.6-15 MB each).
- **`@pmndrs/scheduler` 0.2.0**
  - One RAF for all roots. Phases run `start → input → physics → update → render → finish`, with `before`/`after` DAG ordering, per-job `fps`, a fixed 1/60 physics phase with `overstep`, and demand and manual stepping. Zero dependencies, with a React `useFrame` entry.
  - It is the engine inside R3F v10.
  - What it unlocks: GPU Studio's hand-rolled RAF (`runtime.ts:124`) and the main Canvas could share one loop. Throttle "ambient" jobs (sparkles at 20 fps) while keeping trajectory playback on a fixed step, which saves battery on mobile.

### 4.8 State, animation and tuning: koota, zustand, leva, react-spring, use-gesture, timeline

- **`koota` 0.6.x (ECS)**
  - Relations gained ordered relations (2025-12-26), `autoDestroy` (which deprecates `autoRemoveTargets`, 2026-01-14), relation filters (2026-04-09) and `QueryResult.readEach` (2026-01-21).
  - React hooks `useHas`, `useTag`, `useTarget` and `useTargets` were added.
  - There is an official agent skill (`npx skills add pmndrs/koota`) and an n-body perf example.
  - What it unlocks: model tapped atoms, "pets", particles and annotations as entities with traits, and query them per frame without React re-renders. It is a fit for a sandbox mode where users spawn and bond atoms.
- **`zustand` 5.0.4-5.0.15:** patch-level only (persist race fixes, devtools improvements, `devtools.cleanup()`). The only action for Lupi is to unify on v5.
- **`leva` 0.10.1:** `leva/headless` (headless hooks) and plugin `RangeSlider` export were merged 2025-11-08, after the last npm release. drei 11's `useInspectorControls` is an alternative on WebGPU.
- **`@react-spring/three` 10.x**
  - React 19 support landed in 10.0.0 (2025-05-14), and `useTransition` gained a `reverse` prop in 10.1.0.
  - The **v11 beta** (2026-06-21) adds `usePresence`/`usePresenceList` (deprecating `useTransition`). It also ships ESM only and removes the `react-spring` umbrella package and the native/konva/zdog targets. `onRest` no longer fires on retarget, and `immediate` now applies to async `to` chains.
  - Lupi doesn't use it today. It would suit enter/exit choreography of atoms, and `usePresenceList` fits "atoms fly in when a molecule loads".
- **`@use-gesture/react` 10.3.1:** no release since 2024-03-21. It still works, but for canvas gestures prefer `@pmndrs/pointer-events` and `handle`.
- **`@react-three/timeline` 0.3.10**
  - Generator-based choreography: `useRunTimeline(async function* () { yield* action({ update: lookAt(camera, target, spring()) }) })`, with parallel and graph timelines and a vanilla mode.
  - The roadmap lists scroll-bound recorded timelines, which are **not yet shipped**.
  - What it unlocks: guided "tours" that fly the camera to the active site, then the bond, then the ring, with no bespoke tween code. It suits an attract loop for idle visitors.

### 4.9 Physics and "toy" controllers: rapier, jolt, ecctrl, viverse, crashcat/navcat

- **`@react-three/rapier` 2.2.0** (2025-11-03): rapier3d-compat 0.19.2 plus `useFilterContactPair` and `useFilterIntersectionPair` hooks. Peer `@react-three/fiber ^9.0.4`, so it is not yet on v10. What it unlocks: "shake the phone and the molecule's atoms rattle as balls in a box", and knock-over or bowling games using atoms.
- **`@react-three/jolt`:** a 1.0.0-alpha rework is in the repo (R3F v10 and three ≥0.185, `InstancedRigidBodies`, `CharacterController`) but is not on npm. UNVERIFIED release date.
- **`ecctrl` 2.0.x** (2026-06 to 09): character, vehicle and **custom-gravity** controllers. Peer deps are drei ≥10.7, fiber ≥9.4, rapier ≥2.2.0, leva ≥0.10.1 and three ≥0.184. What it unlocks: walk a tiny avatar around the surface of C60 with gravity toward the centre, or drive a buggy over a protein.
- **`@react-three/viverse` 0.2.29 and `bvhecctrl` 0.0.18:** BVH-based characters without a physics engine. These are lighter for mobile "explore the lattice" modes.
- **`crashcat` and `navcat` (Isaac Mason, not the pmndrs org):** pure-JS physics and navmesh, tree-shakeable and renderer-agnostic. Not recommended for production yet (0.0.x/0.4.x).

### 4.10 GPU tiering and math

- **`@pmndrs/detect-gpu` 6.x**
  - Changes: SwiftShader is now classed as `BLOCKLISTED`, there is a new `BENCHMARK_FETCH_FAILED` tier type, Apple Silicon desktop Safari gets a conservative tier 3, iOS chipset handling was updated (A17 Pro, A19/M5 mappings), benchmarks can be self-hosted via `benchmarksURL`, and builds are weekly.
  - Caveat: gfxbench stopped updating in Dec 2025.
  - What it unlocks: replace the UA and memory heuristic in `deviceCapabilities.ts:116-136` with GPU-aware defaults, then let drei `PerformanceMonitor` adjust at runtime.
- **`math` (formerly `maath`):** `github.com/pmndrs/maath` and `github.com/pmndrs/math` resolve to the same HEAD (`98762395…`). drei 10/11 and `@react-three/postprocessing` still depend on `maath ^0.10.8`. Details are covered by the math-specific research.

### 4.11 Dormant or legacy packages (don't build on these)

`gltfjsx` (last 2024-11), `@react-three/offscreen` (rc.1 2025-01, repo commits stop 2024-05), `@react-three/a11y` (3.0.0 2022), `@react-three/flex` (2022), `@react-three/lightmap` (2022), `lamina` (archived), `@pmndrs/assets` (2024-09), `r3f-perf` (not pmndrs, 2024-11). Two maintenance-only libraries are also GLSL/WebGL-bound: `drei-vanilla` 1.25.0 (added CameraShake, Sparkles, Stars, Trail and Fisheye in 2025) and `three-stdlib` 2.36.1.

### 4.12 Idea banks and agent tooling

- **`pmndrs/react-three-examples`:** 268 R3F v10 WebGPU-first ports in 17 categories, with a live gallery at `pmndrs.github.io/react-three-examples/examples/<slug>`. Directly remixable for Lupi:
  - particles and compute: `compute-particles-fluid`, `tsl-compute-attractors-particles`, `tsl-vfx-linkedparticles`, `compute-birds` (boids), `compute-cloth`, `compute-sort-bitonic`, `compute-audio`, `instance-points`
  - post and lighting: `postprocessing-ssgi-ballpool`, `postprocessing-traa`, `upscaling-taau`, `postprocessing-transition`, `postprocessing-motion-blur`, `volume-caustics`
  - interaction: `instancing-raycast`, `raycaster-bvh`, `rapier-instancing`
- **`pmndrs/claude-code-plugin`:** adds the `pmndrs` MCP server at `https://docs.pmnd.rs/api/mcp`, which serves R3F, drei and zustand docs plus the example gallery. koota, xr, viverse and math also ship agent skills. This is useful for the agents that operate Lupi.

---

## 5. WebGPU readiness matrix

| Class | Packages |
|---|---|
| **WebGPU-native / WebGPU-only** | `@pmndrs/sky` (WebGPU renderer; React needs R3F ≥10 alpha.4), `@pmndrs/upscaler` (WGSL; three ≥0.184), `denoiser` v2 (WebGPU EP; unpublished), drei 11 `/webgpu` (alpha), `@react-three/tsl` (canary), R3F v10 `/webgpu` (alpha), drei 11 `<Inspector>` |
| **`WebGPURenderer` (WebGPU + WebGL2 backend), not classic `WebGLRenderer`** | `@pmndrs/glyph` |
| **Renderer-agnostic** | zustand, koota, `@pmndrs/scheduler`, `math`, `@react-spring/three`, `@use-gesture/react`, leva (DOM), `@react-three/timeline`, `@pmndrs/pointer-events` (raycast-based), `@react-three/handle` (UNVERIFIED on WebGPU), rapier, jolt, `@react-three/csg` (geometry), `@pmndrs/detect-gpu`, crashcat, navcat, ecctrl/bvhecctrl/viverse (UNVERIFIED on WebGPU), the 107 drei "agnostic" components |
| **WebGL-only** | `postprocessing` v6 **and** v7 beta, `@react-three/postprocessing` 3.x, `@react-three/uikit` (onBeforeCompile), `@react-three/xr` (no v10 line; XR through WebGL), drei `/legacy` materials plus `Outlines`/`PointMaterial`/`Splat`/`Text`/`Stars`, `@pmndrs/vanilla`, `three-stdlib`, `lamina`, `@react-three/gpu-pathtracer`, `@react-three/lightmap`, `r3f-perf` (UNVERIFIED) |

## 6. Deprecations, moves and breaking changes to plan around

- `detect-gpu` moved to **`@pmndrs/detect-gpu`** (6.0.0, 2026-01-20). The old name stops at 5.0.70 (2025-02-23).
- `maath` was renamed to **`math`**: repo renamed, `math` 0.1.0 published 2026-09-11, maath 1.0.0 canaries only.
- `lamina` repo archived. drei 11 marks `shaderMaterial` wont-port; TSL replaces GLSL factories.
- drei 11: `Stars` removed from `/webgpu` (use `@pmndrs/sky`); `Text` moves to `@pmndrs/glyph`; `Sky` from the root entry is WebGL-only; platform-specific materials must be imported from `/legacy` or `/webgpu`; the package is ESM-only (obuild).
- R3F v10: the scheduler moved to `@pmndrs/scheduler`; v10 alpha peers React `>=19.0 <19.3` and three `>=0.185`.
- `@react-three/postprocessing` ≥3.0.5 requires fiber ≥9.7.0 and `n8ao ^2`.
- react-spring v11 (beta): `useTransition` is deprecated in favour of `usePresence`/`usePresenceList`; the package is ESM-only; the `react-spring` umbrella and the native/konva/zdog targets are removed; `onRest`/`immediate` semantics change.
- koota: `autoRemoveTargets` is deprecated in favour of `autoDestroy`.
- postprocessing 6.37.6 changed Bloom defaults (`mipmapBlur` true; new threshold/smoothing). Lupi passes these explicitly (`ScenePostprocessing.tsx` Bloom block), so it is unaffected.

## 7. Problem → solution and capability → problem hooks for the brainstorm

- **Problem: phones melt, or look soft at low DPR.** Solution: `@pmndrs/detect-gpu` v6 for initial tier, then drei `PerformanceMonitor` + `AdaptiveDpr` for runtime tuning. In GPU Studio, add `@pmndrs/upscaler` (spatial FSR1 immediately, temporal later).
- **Problem: "grab" and "orbit" fight each other on touch.** Solution: `OrbitHandles` and `<Handle>` through `@pmndrs/pointer-events`. Scene objects consume the gesture first, and handles now respect `frameloop="demand"`.
- **Problem: tapping one atom among millions is expensive.** Solution: `useDepthPicking` (`@react-three/postprocessing` 3.1) reads depth under the finger. Pair it with DepthOfField autofocus for a "rack focus" moment.
- **Capability: physical sky with a time-of-day slider.** Unlocks "molecules in weather": a sunrise-to-night loop, Mars and Titan skins, and haze that gives depth cues for large lattices.
- **Capability: path-trace + OIDN denoise in the browser.** Unlocks a "Take a beauty shot" button that produces a gallery-grade PNG in about a second (GPU Studio, WebGPU).
- **Capability: break-apart glyph text.** Unlocks labels that shatter or reassemble, element symbols that orbit, and periodic-table typography toys.
- **Capability: generator timelines + scheduler phases.** Unlocks an idle "attract mode" tour, and ambient effects throttled to 20 fps while interaction stays at 60.
- **Capability: custom-gravity controllers + Rapier.** Unlocks "walk on a buckyball", "atom pinball" and "shake to scramble, then watch it relax".
- **Capability: WebGPU compute examples as templates.** Fluid, boids, attractors and linked particles become "electron cloud", "solvent swarm" and "reaction sparks" layers around real molecules.

## 8. Items I could not verify

- Whether Vite `dedupe` actually collapses `packages/ui` onto zustand 4.5.7 (no `node_modules` here).
- Whether r3f-perf ends up in Lupi's production bundle.
- The claim that postprocessing v7 supports `WebGPURenderer`. The v7 branch source is typed to `WebGLRenderer` as of 2026-09-19.
- WebGPU compatibility of `@react-three/handle`, viverse, ecctrl and bvhecctrl. They are architecturally renderer-agnostic but untested.
- Velocity output from Lupi's custom WGSL instanced atoms, which the temporal upscaler needs.
- The `@react-three/jolt` 1.0.0-alpha and `denoiser` 2.0.0 npm release dates. Both are unpublished as of this check.
- The "three r185 `WebGPUPathTracer`" referenced in the denoiser README example. I did not confirm which package provides it.

---

## Sources

- pmndrs org repo list (GitHub search `org:pmndrs`, sorted by updated; `created:>2025-01-01`): https://github.com/pmndrs
- npm registry metadata (versions, publish times, peers): https://registry.npmjs.org/ for each package named above, e.g. https://www.npmjs.com/package/@react-three/drei, https://www.npmjs.com/package/postprocessing, https://www.npmjs.com/package/@react-three/postprocessing, https://www.npmjs.com/package/@pmndrs/detect-gpu, https://www.npmjs.com/package/@pmndrs/sky, https://www.npmjs.com/package/@pmndrs/upscaler, https://www.npmjs.com/package/@pmndrs/glyph, https://www.npmjs.com/package/@pmndrs/scheduler, https://www.npmjs.com/package/math, https://www.npmjs.com/package/koota, https://www.npmjs.com/package/@react-three/timeline, https://www.npmjs.com/package/ecctrl
- drei v11 branch: https://github.com/pmndrs/drei/tree/v11-working (`component-status.json`, `CHANGELOG-ALPHA.md`, `devDocs/MIGRATION_V10_TO_V11.md`); PRs https://github.com/pmndrs/drei/pull/2759, https://github.com/pmndrs/drei/pull/2833, https://github.com/pmndrs/drei/pull/2846; tracker https://github.com/pmndrs/drei/issues/2603
- postprocessing: https://github.com/pmndrs/postprocessing (branches `main`, `v7`); roadmap https://github.com/pmndrs/postprocessing/issues/279
- react-postprocessing: https://github.com/pmndrs/react-postprocessing (master commits 2026-08-05 to 2026-09-27; `package.json`)
- R3F CHANGELOG and v10 branch: https://github.com/pmndrs/react-three-fiber/blob/master/packages/fiber/CHANGELOG.md, https://github.com/pmndrs/react-three-fiber/tree/v10
- xr / handle docs: https://github.com/pmndrs/xr, https://pmndrs.github.io/xr/docs/handles/introduction (`docs/handles/screen-handle-components.md`)
- uikit: https://github.com/pmndrs/uikit (`packages/uikit/src/panel/material/create.ts`)
- glyph: https://github.com/pmndrs/glyph
- sky: https://github.com/pmndrs/sky, https://sky.docs.pmnd.rs
- upscaler: https://github.com/pmndrs/upscaler, https://pmndrs.github.io/upscaler/
- denoiser: https://github.com/pmndrs/denoiser
- scheduler: https://github.com/pmndrs/scheduler
- timeline: https://github.com/pmndrs/timeline, https://pmndrs.github.io/timeline/
- viverse: https://github.com/pmndrs/viverse
- react-three-examples: https://github.com/pmndrs/react-three-examples, https://pmndrs.github.io/react-three-examples/
- react-three-start: https://github.com/pmndrs/react-three-start
- detect-gpu: https://github.com/pmndrs/detect-gpu
- math (ex-maath): https://github.com/pmndrs/math
- koota: https://github.com/pmndrs/koota
- zustand: https://github.com/pmndrs/zustand
- react-spring (v11 changesets): https://github.com/pmndrs/react-spring/tree/main/.changeset
- leva: https://github.com/pmndrs/leva
- rapier: https://github.com/pmndrs/react-three-rapier
- jolt: https://github.com/pmndrs/react-three-jolt
- ecctrl: https://github.com/pmndrs/ecctrl
- drei-vanilla: https://github.com/pmndrs/drei-vanilla
- org initiatives: https://github.com/pmndrs/org/tree/main/initiatives
- claude-code-plugin: https://github.com/pmndrs/claude-code-plugin
- labs: https://github.com/pmndrs/labs
- paris workshop site: https://github.com/pmndrs/paris-site
- crashcat / navcat: https://github.com/isaac-mason/crashcat, https://github.com/isaac-mason/navcat
- WebGPU post migration context: https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- Lupi files: `/home/user/Lupi/packages/ui/package.json`, `/home/user/Lupi/packages/scene/package.json`, `/home/user/Lupi/apps/web/package.json`, `/home/user/Lupi/pnpm-lock.yaml`, `/home/user/Lupi/apps/web/vite.config.ts:294`, `/home/user/Lupi/packages/ui/src/postprocess/ScenePostprocessing.tsx:16-17`, `/home/user/Lupi/packages/scene/src/AtomsTransmission.tsx:27`, `/home/user/Lupi/packages/ui/src/ViewerApp.tsx:98,670-671`, `/home/user/Lupi/packages/ui/src/deviceCapabilities.ts:116-136`, `/home/user/Lupi/packages/ui/src/viewer/ViewerCanvas.tsx:26-34,66-77`, `/home/user/Lupi/packages/ui/src/gpu-studio/runtime.ts:1-28,124,161`, `/home/user/Lupi/packages/ui/src/app/ViewerScene.tsx:2`
