# R3F v10 alpha line: live status check (2026-09-27)

**Premise.** The owner decided: "Assume we are upgrading to v10 alpha for R3F." This file records the state of that line on 2026-09-27. It is research only; the Lupi repo was not changed.

**How each fact was checked**
- **npm.** I pulled the live `registry.npmjs.org` JSON today. Raw copies are in `research/live/*.json`.
- **GitHub.** The GitHub API and MCP are blocked for pmndrs repos in this session, so GitHub facts come from public pages via WebFetch.
- **Runtime probes.** I installed packages into `research/live/probe-*` and ran two kinds of probe:
  - `node` ESM imports
  - `esbuild` browser bundles
- **Tags.** **(probe)** means I ran it myself. **UNVERIFIED** means I could not confirm it.

**Lupi baseline, from the lock and the code**
- React and react-dom are 19.2.4 (lock, `pnpm-lock.yaml:33`), but the specifiers are loose: `react ^19.0.0` in `apps/web/package.json:26-27` and `packages/ui/package.json:42`. Only `packages/ui` pins react-dom 19.2.4 (`packages/ui/package.json:54`).
- fiber 9.6.1, drei 10.7.7, three 0.184 and vgpu 0.4.0 (`packages/ui/package.json:30-44`, `apps/web/package.json:19-40`).

---

## 1. Dated status table (npm, live 2026-09-27)

| Package | Newest prerelease or relevant version (date) | Stable `latest` | Peers of the version you'd use | Works with fiber 10? |
|---|---|---|---|---|
| **@react-three/fiber** | `alpha` = **10.0.0-alpha.5** (2026-09-08). Still the newest alpha: **no alpha.6 and no beta**.<br>`canary` = **10.0.0-canary.14007b4** (2026-09-26 14:52Z). | 9.8.1 (2026-09-24) | alpha.5 and the canary both peer `react >=19.0 <19.3`, `react-dom >=19.0 <19.3` (optional) and `three >=0.185.0`.<br>The canary drops the `@monogrid/gainmap-js` dependency, adds a `./extension` export, and is 2.0 MB unpacked against 5.7 MB. | — |
| **@react-three/tsl** (new) | Created 2026-09-26. Eight canaries in one day, the newest `10.0.0-canary.14007b4`. | none | `@react-three/fiber ^10.0.0-alpha.6`, `three >=0.185.0`, `react <19.3`. | alpha.5 does **not** satisfy the peer. fiber canary.14007b4 does (semver: "canary" > "alpha.6"). **Trap:** the `latest` dist-tag points to the **first** canary, `490e4992`, so a plain `npm i @react-three/tsl` installs a stale build. Pin it to the same hash as fiber. **(probe)** It imports cleanly beside fiber canary.14007b4. |
| **@react-three/test-renderer** | `alpha` 10.0.0-alpha.5 (2026-09-08); `canary` 10.0.0-canary.14007b4 (2026-09-26) | 9.1.1 | `fiber >=10.0.0-alpha.0`, `three >=0.185.0`, `react <19.3` | Yes. It has `/legacy` and `/webgpu` entries that must match your fiber import. Lupi uses it in 5 files. |
| **@react-three/eslint-plugin** | 1.0.0-alpha.5 (2026-09-08); canary.14007b4 | 0.1.2 | — | Yes |
| **@react-three/drei** | `alpha` = **11.0.0-alpha.7** (2026-09-05). No release since then; it was built against fiber alpha.4 and three 0.185.1. | 10.7.9 (2026-09-25; peers fiber `^9.0.0`) | `fiber >=10.0.0-0`, `three >=0.185`, `react <19.3` | Yes. drei 10.x does **not** accept fiber 10.<br>**(probe)** alpha.7 imports only core symbols from fiber, and the fiber canary still exports every one of them. |
| **@react-three/xr** | No v10 or WebGPU prerelease; `alpha` is a stale 6.5.1-alpha.2 from 2025. | 6.6.30 (2026-05-29) | `fiber >=8`, `three *` | **Static linking is OK (probe).** pnpm 10 accepts the prerelease against `>=8`. Runtime on `WebGPURenderer` is **UNVERIFIED**, and the repo has no v10 or WebGPU issues or PRs. See risk R7. |
| **@react-three/postprocessing** | none | 3.1.3 (2026-09-27) | `fiber >=9.7.0`, `postprocessing ^6.36.0`, `three >=0.156` | It imports under v10 **(probe)**, but only on the WebGL `/legacy` path. vanruesc `postprocessing` is WebGL-only, and I found no WebGPU plan in either repo. The WebGPU route is three's `RenderPipeline` via `useRenderPipeline` from `@react-three/tsl`. |
| postprocessing (vanruesc) | 7.0.0-beta.16 (peers three `<0.184`) | 6.39.5 (2026-09-09) | three `>=0.168 <0.187` | **It breaks its peer at r187.** |
| **@react-three/rapier** | none | 2.2.0 (2025-11-03) | `fiber ^9.0.4` | **No.** pnpm reports an unmet peer **(probe)**. Lupi doesn't use it. |
| **@react-three/uikit** + @pmndrs/uikit | none | 1.0.76 (2026-09-01) | `fiber >=8` | Peers resolve. But the panel and glyph materials use `onBeforeCompile` (4 files), which is WebGL-only under `WebGPURenderer` (inference). Lupi doesn't use it. |
| **@react-three/handle** + @pmndrs/handle | none | 6.6.30 (2026-05-29) | `fiber >=8`, `three *` | Peers resolve. There is no `onBeforeCompile`. Runtime is UNVERIFIED. |
| **leva** | none | 0.10.1 (2025-10-31) | `react ^18 \|\| ^19`; no R3F dependency | Yes. The v10 guide says `useUniforms` "auto-converts Leva controls". |
| r3f-perf (used by Lupi: `ViewerApp.tsx:98,671`, DEV only) | none | 7.2.3 (2024-11-08) | fiber `>=8`, plus a hard dependency on drei `^9.103` | **No.** It pulls drei 9.122, which peers fiber `^8` and React 18 (unmet, probe), and it is WebGL-oriented. |
| **three** | — | **0.186.1** (2026-09-24) | — | **r187 milestone: due 2026-10-21, 73% (159/216 closed).**<br>`@types/three` is at 0.186.0 (2026-09-11). |
| react / react-dom | — | **19.3.0 (2026-09-09)** | — | **Outside v10's `<19.3`.** v10 React 19.3 support is PR #3935, still open. |
| **vgpu** (Vercel Labs) | 0.5.0-rc.0 and rc.1 (2026-09-10 and 09-11) | **0.5.0 (2026-09-14)**; Lupi pins 0.4.0 | `three >=0.180 <0.200` | Not R3F-bound. See §4. |
| @pmndrs/glyph | canary 0.1.0-canary-5eccfac5 (2026-09-23) | 0.1.0 (2026-09-18) | `fiber >=9.7 <10 \|\| >=10.0.0-alpha.4 <11`, `three >=0.185`, `react <19.3` | Yes. It runs on `WebGPURenderer`, including the GL2 backend. |
| @pmndrs/sky | — | 0.3.0 (2026-09-08) | `fiber >=10.0.0-0`, `three >=0.185` | Yes |
| @pmndrs/scheduler | — | 0.2.0 (2026-08-24) | react `>=18` (optional) | A fiber 10 dependency. It has no fixed timestep. |
| @react-three/native | **not published (404)** | — | — | The v10 guide says `fiber/native` moves here. Lupi's Expo app doesn't use R3F. |
| @react-three/offscreen, @react-three/a11y | 1.0.0-rc.1 (2025); none | 0.0.8 (2023); 3.0.0 (2022) | fiber `>=8` | Unmaintained. No v10 work. |

**GitHub milestones.**
- R3F **v10** is at 87% (74 closed, 11 open). **v10.1** is at 20%. Neither has a due date.
- Tracking issues "Alpha 5." (#3874) and "Beta 1" (#3875) are both open. There is **no published beta ETA**.
- PR #3971 (closed 2026-09-26) publishes the v10 alpha docs under `/next`.

**What is on the `v10` branch but not in alpha.5.** These are the "Unreleased" entries in `CHANGELOG-ALPHA.md`, mostly merged 2026-09-26 in PR #3968:
- The core no longer imports `three`. Each renderer lives in a lazy "support" chunk, and `/legacy` and `/webgpu` become static narrowed aliases.
- The TSL hooks move to `@react-three/tsl`.
- `Register { renderer: 'webgpu' }` typing.
- A typed Canvas `renderer` prop.
- `configureTSL`.
- `registerRootExtension` / `setRenderOverride`.
- `onUpdate` is removed.
- The split gain-map Environment format is removed.
- Secondary canvases now share TSL maps.

---

## 2. Open issues most likely to bite Lupi

| # | Status (2026-09-27) | What it means for Lupi |
|---|---|---|
| **r3f #3921**: `/legacy` import and browser build fail with "does not provide an export named 'MeshBasicNodeMaterial'" | **Open on GitHub, but fixed in the canary (probe).**<br>alpha.5 + three 0.186.1: `import('@react-three/fiber/legacy')` fails, and the esbuild browser bundle fails.<br>canary.14007b4: both pass, as do root and `/webgpu`.<br>The fix is PR #3968 (merged 2026-09-26), which doesn't reference #3921. Draft #3929 was closed. | **Don't pin alpha.5.** Pin the canary, or wait for alpha.6. Once the viewer is on `WebGPURenderer`, `/legacy` matters only for any WebGL-only islands. |
| **r3f #3965**: under the WebGL2 fallback, a multi-canvas **secondary draws into the primary's canvas** | Open (2026-09-26); no fix PR. Cause: three's `WebGLBackend` binds one context per canvas. | Any "one shared renderer, many canvases" idea (thumbnails, HUD, picture-in-picture) is **WebGPU-only**. On fallback devices it silently draws into the wrong canvas. Gate it on `renderer.backend.isWebGPUBackend`. |
| **r3f #3926**: the R3F-created `WebGPURenderer` is not disposed on unmount | Open; fix PR #3974 open (port of #3941, which shipped in 9.8.1). Also PR #3973: tear roots down on commit, not after 500 ms. | Viewer mount and unmount cycles (route changes, GPU Studio toggling `paused`) leak a device or context until alpha.6. |
| **r3f #3958**: DPR goes stale when `devicePixelRatio` changes (moving to another display, browser zoom) | Open (labelled v9 and v10); fix PR #3975 open. | Affects Lupi's static DPR ranges (`viewerDprRange()`, `ViewerCanvas.tsx:62`). |
| **r3f #3782**: a re-render during an async gl factory invokes it twice and corrupts the renderer | Open (2026-07-13). 9.8.0 #3925 addressed StrictMode async roots, but this isn't closed. | Relevant if Lupi passes a custom `renderer` factory, for example to share a `GPUDevice` (§4). |
| **r3f #3931**: negative numeric `useFrame` priorities run in reverse on v10 | PR open (warn + docs). | Lupi has one numeric priority, `useFrame(…, 2)` at `ExportManager.tsx:180`. It relies on v9's "priority > 0 disables default render" semantics (comment at `ExportManager.tsx:68-70`). v10 keeps a deprecation shim, but the semantics must be re-tested. There are no negative priorities (grep). |
| **r3f #3864**: `useRenderPipeline` pass ownership and disposal (RFC, beta) | Open. | Post-stack lifetime rules may still change before beta. |
| **drei #2842**: `Environment` gain-map loading throws on WebGPU (`readRenderTargetPixels`) | Open (2026-09-24). | Lupi uses `Environment` and `useEnvironment`. Use `.hdr`, `.exr` or Ultra-HDR `.jpg` only. |
| **drei #2817 / #2818 / #2843**: stories run real WebGPU and discard 207 validation errors; 4 root exports are wrongly classed as renderer-agnostic; 16 legacy stories run WebGL-only components on WebGPU | Open. | Treat drei 11's "has a webgpu file" as **not** "works". |
| **drei 11 `Text`** | alpha.7 exports `Text` from **`/legacy` only** (probe: absent from `core`, `webgpu` and root). | Lupi imports `Text` in 5 files. On the WebGPU renderer, labels need `@pmndrs/glyph` or a port. |
| **three #34597**: `WebGPURenderer`'s WebGL2 fallback never deletes GL programs, shaders or VAOs (+5 programs, +9 shaders, +6 VAOs per cycle) | Closed. The fix, PR #34610, merged 2026-09-20 with **milestone r187**, so it is **not in 0.186.1**. | Every non-WebGPU device (pre-iOS-26 iPhones, many Firefox and Android configurations) leaks on material or scene churn (Looks, Remix, molecule switch) until r187 (due 2026-10-21). |
| **three #34646**: a geometry's buffers are only freed on its first `dispose()` | Closed 2026-09-24; which release carries the fix is **UNVERIFIED**. | Atom and bond geometry swaps. |
| **three #33821** (material init much slower than WebGL, open) and **#30560** (UBO system has severe performance issues with many render items; High priority, open) | Open. | First-frame and Looks-switch latency. Many-mesh overlays (labels, glyphs, annotations) are slower than on WebGL. |
| **three #34672**: pipeline creation fails, "private address space exceeds 8192 bytes", with `MeshStandardMaterial` and many point lights | Open (2026-09-26). Chrome and Safari on macOS; regression since r180. | Low for impostors, but bites any "every atom is a light" or clustered-light toy that uses standard materials. |

**HMR and SSR.**
- **HMR**
  - The TSL HMR blocker (#3792) is closed.
  - Nodes and uniforms rebuild atomically.
  - `useRenderPipeline` callbacks deliberately do **not** re-run on HMR; you call `rebuild()` (migration guide).
  - The scheduler is a `Symbol.for` singleton, so it survives HMR.
  - Low risk.
- **SSR**
  - Lupi is a Vite SPA. The Worker's `/view/:slug` HTML doesn't render R3F.
  - The new lazy renderer chunks are dynamic imports, which is safe for SSR.
  - Not a concern.

**Safari and iOS**
- Safari 26 ships WebGPU by default; older iOS falls back to WebGL2, which hits #34597 until r187.
- Still-open device questions (**UNVERIFIED**):
  - Does iPhone Safari accept `requiredLimits.maxStorageBuffersInVertexStage` (`gistParticles.ts:94`)?
  - Does `VideoFrame` or `toBlob` work from a WebGPU canvas?
- v10's `forceEven` Canvas prop exists specifically for Safari's odd or fractional canvas sizes.

---

## 3. v10 migration guide: what it actually says

Source: `docs/migration/v10.mdx` on the `v10` branch, fetched today. It already describes the unreleased canary.

- **"Your existing code works."**
  - The default import picks WebGL, or WebGPU with `<Canvas renderer>`.
  - Only the chosen renderer is downloaded.
  - A plain WebGL Canvas on the root entry logs a deprecation warning; the guide says to import from `/legacy`.
- **Dependency floors:** three `>=0.185.0` ("If you are on r181–r184 you cannot install v10") and React `>=19.0 <19.3`.
- **Other breaking changes:**
  - `@react-three/fiber/native` becomes `@react-three/native`, which is not yet on npm.
  - `state.gl` becomes `state.renderer`. `gl` still works with a warning.
  - `state.clock` is removed. Use `{ time, delta, elapsed }`.
  - **Any `{ phase: 'render' }` job takes over rendering.** Numeric priorities are deprecated.
  - Canvas props `legacy`, `linear`, `flat`, `colorSpace` and `toneMapping` are removed; pass them via `gl` or `renderer`.
  - `onUpdate` is removed.
  - `<color attach="background">` is deprecated in favour of `<Canvas background>`.
- **TSL:** the hooks move to `@react-three/tsl` (`useUniforms`, `useUniform`, `useNodes`, `useLocalNodes`, `useBuffers`, `useGPUStorage`, `useRenderPipeline`, `rebuildAll*`). The standalone clear/remove utilities are deleted.
- **Test renderer:** match the entry, using `@react-three/test-renderer/legacy` or `@react-three/test-renderer/webgpu`.
- **FAQ:** "Will my drei/postprocessing code work? Mostly." The guide notes that peer ranges may warn or refuse until ecosystem releases catch up.
- **Lupi touchpoints**
  - `gl` destructured from `useThree` in 10 places: `useXRHands.ts:78`, `XRLightEstimation.tsx:39`, `useEquirectMediaTexture.ts:61`, `SceneLighting.tsx:49,67`, `ExportManager.tsx:219,455`, `AtomPicker.tsx:45`, `AtomsOptimized.tsx:1194`, `Bonds.tsx:768`.
  - `onCreated={({ gl }) => …}` at `ViewerCanvas.tsx:77`.
  - `gl={VIEWER_GL_OPTIONS}` with `preserveDrawingBuffer: true` (`ViewerCanvas.tsx:26-29,75`).
  - `<XR store>` wraps **all** viewer children (`ViewerCanvas.tsx:85`).
  - `useFrame(…, 2)` at `ExportManager.tsx:180`.
  - There are no R3F `onUpdate` props. The one at `FlythroughPanel.tsx:395` is a DOM component prop.

---

## 4. vgpu and sharing a `GPUDevice` with three

- **Versions.**
  - vgpu 0.5.0 (2026-09-14) is `latest`, and it breaks the texture API relative to 0.4.x: explicit `kind`/`size`/`layers`/`usage`, and `Texture.resize()` and the Target/Surface read delegates are removed.
  - Lupi's imports (`effect`, `frame`, `init`, `surface`, `compute`, `draw`, `storage`, `tslExports`) exist in 0.5.0. The only new module is `texture` (tarball diff).
  - Source: https://github.com/vercel-labs/vgpu/releases
- **`initFromDevice(device: GPUDevice): Promise<Gpu>` exists in both 0.4.0 and 0.5.0.** It is at `dist/init-from-device.d.ts:10` in both tarballs.
  - The docblock says: "Wraps a device owned by another library … vgpu never destroys what it did not create … every entry point re-checks the device."
  - `init({ device })` is typed `never`, so adoption goes only through `initFromDevice`.
- **The three side accepts a caller-owned device.** In r186, `WebGPUBackend.js:213-254` uses `parameters.device` when given, `:97,247` handles `requiredLimits`, and `:3271` destroys the device on dispose only if three created it.
  - Lupi's GPU Studio already does the first half: `adapter.requestDevice(…)` then `new WebGPURenderer({ device })` (`packages/ui/src/gpu-studio/runtime.ts:159-161`).
- **The v10 path, by inference and UNVERIFIED at runtime.**
  1. The app requests one device with the **union** of limits. For example, the gist engine's `maxStorageBuffersInVertexStage` (`gistParticles.ts:94`); three requests only defaults.
  2. Pass a renderer factory or instance to `<Canvas renderer>`. v10's `RendererFactory` type is in the canary's `dist/shared/fiber.*.d.ts:22`.
  3. Call `initFromDevice(device)` for the vgpu passes, which share one queue.
- **Caveats.**
  - There is no `GPUDevice` on the WebGL2 fallback. Every vgpu path must stay gated on `renderer.backend.isWebGPUBackend`, as GPU Studio already does (`runtime.ts:169-172`).
  - `tslExports` nodes are WGSL-only.
  - Cross-library texture and buffer hand-off, and ordering between vgpu's and three's submits, have no documented contract.
  - Watch r3f #3782 (a factory invoked twice).

---

## 5. Blocking risks (ranked)

1. **The whole Lupi GLSL stack runs on neither `WebGPURenderer` backend.**
   - What's affected: atom and bond `RawShaderMaterial` impostors (`AtomsOptimized.tsx:1307`, `Bonds.tsx:769`), plus 7 more GLSL or `onBeforeCompile` files; the `EffectComposer` stack (N8AO, Bloom, DOF, ToneMapping, Vignette in `ScenePostprocessing.tsx:16-97`); and r3f-perf.
   - Everything needs a TSL port before "`WebGPURenderer` as the main renderer" can render a molecule. This is the critical path, not R3F itself.
2. **The alpha.5 `/legacy` entry is broken (#3921).**
   - Use the canary (14007b4 is verified to work) or wait for alpha.6.
   - Pin fiber, `@react-three/tsl` and test-renderer to the **same canary hash**. The tsl `latest` dist-tag is a stale canary.
3. **React 19.3.0 is now npm `latest` but outside v10's `<19.3` peer.**
   - Lupi's loose `^19.0.0` specifiers will float to 19.3 on the next lock refresh.
   - Pin `react` and `react-dom` to 19.2.x (a pnpm override) until PR #3935 lands.
4. **XR has no v10 or WebGPU track.**
   - `@react-three/xr` 6.6.30 links and resolves peers, and three r186's WebGPU `XRManager` has the members it touches (`isPresenting`, `enabled`, `getCamera`, `getBinding`).
   - But its pointer ray and cursor use `onBeforeCompile` (inference: they won't shade on `WebGPURenderer`), and there are no pmndrs/xr issues or PRs for WebGPU.
   - Because `<XR>` wraps the entire viewer tree (`ViewerCanvas.tsx:85`), XR must be verified on a headset, or split out, before cut-over.
5. **The WebGL2 fallback is second-class in r186.**
   - The GL resource leak (#34597) is fixed only in r187, due 2026-10-21.
   - Multi-canvas misdraws (#3965).
   - Compute degrades to transform feedback.
   - Plan three 0.187 as the floor for shipping, and treat vanruesc `postprocessing`'s `<0.187` peer as moot once the post stack is TSL.
6. **Export determinism changes.**
   - `preserveDrawingBuffer: true` (`ViewerCanvas.tsx:29`) has no WebGPU equivalent. Readback moves to `readRenderTargetPixelsAsync`.
   - `rendererFingerprint`, `artifactKey` and the V1 raster profile must be re-baselined.
   - The `MediaRecorder` video path depends on the priority-2 `useFrame` semantics (`ExportManager.tsx:68-70,180`), which v10 deprecates.
7. **drei 11 alpha is stale and partly WebGL-only.**
   - The last alpha was 2026-09-05, built against fiber alpha.4 and three 0.185.1.
   - `Text` (5 Lupi files) is `/legacy`-only.
   - Gain-map `Environment` throws on WebGPU (#2842).
   - 207 validation errors are swallowed in its WebGPU story suite (#2817).
   - `MeshTransmissionMaterial`, `ContactShadows` and `Grid` have webgpu files, but runtime is UNVERIFIED.
8. **v10 is still API-unstable with no beta ETA.**
   - The TSL hooks moved packages 18 days after alpha.5.
   - `onUpdate` was removed.
   - `useRenderPipeline` ownership is an open RFC (#3864).
   - The renderer-dispose (#3926) and DPR (#3958) fixes are PRs only.
   - Expect churn at every alpha bump.
9. **Minor.**
   - r3f-perf pulls drei 9 and fiber `^8` peers (dev-only, but it pollutes the install).
   - `@react-three/rapier` is `^9` only.
   - `@react-three/native` is unpublished.
   - pnpm peer tolerance was verified on pnpm 10.33, whereas Lupi declares `pnpm@9.0.0`; pnpm 9 behaviour is **UNVERIFIED**.

---

## Sources

**npm (live 2026-09-27)**
- https://registry.npmjs.org/@react-three%2ffiber
- https://registry.npmjs.org/@react-three%2ftsl
- https://registry.npmjs.org/@react-three%2fdrei
- https://registry.npmjs.org/@react-three%2fxr
- https://registry.npmjs.org/@react-three%2fpostprocessing
- https://registry.npmjs.org/@react-three%2frapier
- https://registry.npmjs.org/@react-three%2fuikit
- https://registry.npmjs.org/@react-three%2fhandle
- https://registry.npmjs.org/@react-three%2ftest-renderer
- https://registry.npmjs.org/leva
- https://registry.npmjs.org/three
- https://registry.npmjs.org/vgpu
- https://registry.npmjs.org/postprocessing
- https://registry.npmjs.org/react
- https://registry.npmjs.org/r3f-perf
- https://registry.npmjs.org/@pmndrs%2fglyph
- https://registry.npmjs.org/@pmndrs%2fsky
- https://registry.npmjs.org/@react-three%2fnative (404)

**R3F**
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/CHANGELOG-ALPHA.md
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/docs/migration/v10.mdx
- https://github.com/pmndrs/react-three-fiber/issues/3921
- https://github.com/pmndrs/react-three-fiber/issues/3965
- https://github.com/pmndrs/react-three-fiber/issues/3926
- https://github.com/pmndrs/react-three-fiber/issues/3875
- https://github.com/pmndrs/react-three-fiber/issues/3874
- https://github.com/pmndrs/react-three-fiber/pull/3968
- https://github.com/pmndrs/react-three-fiber/milestones
- https://github.com/pmndrs/react-three-fiber/pulls (#3931, #3933, #3935, #3971, #3973, #3974, #3975)
- https://github.com/pmndrs/react-three-fiber/issues?q=label%3Av10

**drei**
- https://github.com/pmndrs/drei/releases
- https://github.com/pmndrs/drei/issues?q=v11 (#2811, #2817, #2818, #2842, #2843)

**pmndrs/xr**
- https://github.com/pmndrs/xr/pulls
- https://github.com/pmndrs/xr/issues?q=webgpu

**three.js**
- https://github.com/mrdoob/three.js/milestones
- https://github.com/mrdoob/three.js/issues/34597
- https://github.com/mrdoob/three.js/pull/34610
- https://github.com/mrdoob/three.js/issues/34672
- https://github.com/mrdoob/three.js/issues/33821
- https://github.com/mrdoob/three.js/issues/30560
- https://raw.githubusercontent.com/mrdoob/three.js/r186/src/renderers/webgpu/WebGPUBackend.js

**vgpu**
- https://github.com/vercel-labs/vgpu/releases
- The `vgpu-0.4.0.tgz` and `vgpu-0.5.0.tgz` tarballs

**Secondary: WebGPU post-processing on WebGL-only postprocessing and the RenderPipeline route**
- https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- https://threejsroadmap.com/blog/the-complete-guide-to-threejs-post-processing-in-2026

**Probes**
- Folders: `research/live/probe-a5`, `research/live/probe-canary` and `research/live/probe-pnpm`.
- Stack: three 0.186.1, react 19.2.4, esbuild 0.25, pnpm 10.33.
