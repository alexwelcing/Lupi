# @react-three/fiber releases, 9.0 → 10 alpha: research digest for Lupi

Researched 2026-09-27. Scope: every 9.x release, every v10 alpha, the current v10 canary, the standalone `@pmndrs/scheduler`, and the v10 docs on the `v10` branch. For each item I also note what it unlocks for Lupi's WebGL2 main viewer and its separate WebGPU "GPU Studio".

How I checked the facts:
- **Release dates** come from the npm registry `time` field for `@react-three/fiber`. GitHub release-page dates are given too where they differ.
- **API claims** come from the published type declarations and source. I unpacked these tarballs and read them: `fiber-10.0.0-alpha.5`, `fiber-10.0.0-canary.14007b4`, `fiber-9.8.1`, `@react-three/tsl@10.0.0-canary.14007b4`, `@pmndrs/scheduler@0.2.0` and `@react-three/drei@11.0.0-alpha.7`.
- **Verbatim labels.** Code marked "verbatim (tarball)" was copied from the package files. Code marked "via docs fetch" came through a web-fetch summarizer, so it may differ slightly in whitespace.

---

## 0. TL;DR for the brainstorm

- **Stable is 9.8.1** (2026-09-24). Lupi's lockfile resolves 9.6.1 (`pnpm-lock.yaml:2931`). The 9.7 and 9.8 releases are low-risk and bring:
  - react-dom event priorities (9.7.0)
  - React 19.3 support (9.8.0)
  - synchronous root setup that waits on async renderers (9.8.0)
  - full `<Activity>` support (9.8.1)
  - renderer disposal when a root unmounts (9.8.1)
- **v10 is alpha.5** (2026-09-08). A canary from 2026-09-26 already moves every TSL hook out of fiber into a new package, `@react-three/tsl`. The API is still moving week to week.
- **v10's headline features:**
  - WebGPU and TSL as first-class features.
  - A new DAG scheduler (`@pmndrs/scheduler`) with named phases, `before`/`after` ordering, per-job `fps` limits, per-root frameloops, render takeover, and `useFrame` outside `<Canvas>`.
  - Multiple WebGPU canvases sharing one renderer and one GPU device.
  - Visibility events: `onFramed`, `onOccluded`, `onVisible`.
  - Deferred per-frame pointer raycasts and per-pointer state.
  - `userData.interactivePriority`.
  - Drag-and-drop events on 3D objects.
  - Declarative `<Canvas background>`, plus `width`/`height` props.
  - Environment, texture and render-target helpers inside core.
- **v10 is not ready for Lupi's production viewer:**
  - It needs three `>=0.185.0`. Lupi is on 0.184.
  - It needs React `>=19.0 <19.3`.
  - It needs drei 11 alpha, because drei 10 peers `@react-three/fiber ^9.0.0`.
  - The `/legacy` (WebGL-only) entry fails to load in alpha.5 (issue #3921, open).
  - `@react-three/postprocessing` does not run on WebGPURenderer.
- **Usable today, no R3F upgrade needed:** `@pmndrs/scheduler@0.2.0` is standalone, has zero dependencies and doesn't depend on R3F. It could drive GPU Studio's hand-written RAF loop and the vgpu effects right away.

---

## 1. Dated changelog: brainstorm-relevant items

Legend: **Perf** = performance, **Ev** = events/pointer, **Loop** = frameloop/demand, **XR**, **Off** = offscreen, **GPU** = WebGPU.

### 1a. Stable 9.x line

| Version | npm date | Relevant items | Tags |
|---|---|---|---|
| 9.0.0 | 2025-02-19 | React 19 compatibility release.<br>The Canvas `gl` prop can be a callback that returns a Promise, which is how WebGPURenderer is initialised on v9.<br>StrictMode is inherited from react-dom.<br>Suspense side-effects (attach, constructors) no longer re-fire.<br>`ThreeElements['mesh']` types replace the hardcoded `MeshProps` exports. | GPU, Loop |
| 9.0.1–9.0.4 | 2025-02-19/20 | Type fixes: recursive JSX types (#3472) and React runtime type conflicts (#3473). | – |
| 9.1.0 | 2025-03-08 | Meshes are added to the loader graph.<br>Fixes out-of-order children repositioning.<br>Fixes the applyProps set check. | – |
| 9.1.1 / 9.1.2 | 2025-03-31 / 04-06 | rsbuild and React 19.1 `act` removal fixes (#3508); dev-only `act` with a computed key for Webpack (#3513). | – |
| 9.1.3 / 9.1.4 | 2025-06-29 | React Native GLView new-arch crash (#3539); readonly arrays accepted for vector props (#3527). | – |
| 9.2.0 | 2025-07-03 | npm only. There is no GitHub release page (404), so its contents are **UNVERIFIED**. | – |
| 9.3.0 | 2025-07-28 | `flushSync` exported and fixed for the new reconciler; React Native 0.79+ deep imports. | Loop |
| 9.4.0 | 2025-10-13 | Better resolution of dashed prop names (#3576); explicit error in `applyProps`. | – |
| 9.4.1 / 9.4.2 | 2025-11-29 | React DevTools config fix (#3594); Expo SDK 54 workaround. | – |
| 9.5.0 | 2025-12-30 | React 19.2 support, using a bundled reconciler that covers 19.0–19.2. | – |
| 9.6.0 | 2026-04-13 | Uniforms keep stable refs for `ShaderMaterial`. | Perf |
| 9.6.1 | 2026-04-28 | Interactivity state transfers when an instance is swapped (reconstructed via `args`). **This is Lupi's current lock.** | Ev |
| 9.7.0 | 2026-07-31 | Reconciler hardening: keyed reorder sync (#3808), pierced prop reset (#3810), host props sync (#3811), batched reconstruction (#3812).<br>**"feat: Match react-dom event priorities" (#3815):** "Events now use the same priority system as react-dom".<br>**"Support reconciler microtasks" (#3816).**<br>Also: `@react-three/postprocessing@3.1.x` peers `@react-three/fiber >=9.7.0`. | Ev, Perf |
| 9.8.0 | 2026-09-22 | React 19.3 support (#3916); peer range is now `react >=19 <19.4`.<br>**"configure and render roots synchronously" (#3925):** roots are set up synchronously, then wait on the renderer if it is async (for example WebGPURenderer). This fixes StrictMode problems caused by the earlier async support.<br>A root remounted inside the unmount grace period is no longer torn down (#3869). | GPU, Loop |
| **9.8.1** (latest) | 2026-09-24 | "Activity now works completely inside of R3F, even across boundaries with React DOM".<br>A Canvas root stays alive while `<Activity>` hides it (#3943).<br>Activity visibility is bridged into Canvas scenes (#3946), and visibility is preserved across Activity and Suspense hiding (#3944).<br>**The renderer R3F creates is disposed when its root unmounts (#3942).**<br>Canvas rerenders no longer reset runtime settings such as dpr and frameloop (#3945). | Perf, Loop |

Utsubo (2026-09-24) notes that R3F 9.8.0 with three r186 prints two harmless warnings:
- "`THREE.Clock: This module has been deprecated`", which "comes from R3F itself"
- "`PCFSoftShadowMap has been removed`"

### 1b. v10 prereleases

| Version | Date | Relevant items | Tags |
|---|---|---|---|
| 10.0.0-alpha.0 | npm 2026-01-14 | npm only. | – |
| **10.0.0-alpha.1** | npm 2026-01-17 (discussion #3665 is dated Jan 17, 2026) | "A New Era", led by DennisSmolek. Released alongside Drei 11 alpha.<br>Supports both `WebGLRenderer` and `WebGPURenderer`; `state.gl` is renamed to `state.renderer`.<br>New scheduler: `useFrame` works outside `<Canvas/>`.<br>TSL hooks `useUniforms`, `useNodes`, `useLocalNodes`, `usePostProcessing`.<br>"Camera frustum access for in-frame spatial queries".<br>Visibility events: Visible, Framed, Occluded.<br>"Cameras are now part of the scene graph".<br>"Renderer-independent render targets".<br>"The scheduler no longer depends on R3F and can run standalone".<br>Status line: "all features experimental and may be changed, removed or expanded at any time." | GPU, Loop, Ev |
| 10.0.0-alpha.2 | npm 2026-01-20 (GitHub tag added retroactively on 2026-07-25) | `width`/`height` Canvas props and a `setSize()` ownership model.<br>`createScopedStore`, `CreatorState`.<br>HMR for TSL hooks (`hmr` prop).<br>Reader-mode `useNodes`/`useUniforms` update when the store changes. | GPU |
| 10.0.0-canary.* | 2026-01-30 → 2026-09-26 | Automated canaries on the `v10` branch (about 80 builds). | – |
| **10.0.0-alpha.3** | npm 2026-08-07 | **Breaking changes:**<br>• three peer `>=0.185.0`; "r181–r184 incompatible"<br>• `act` is no longer re-exported<br>• removed canvas props `legacy`, `linear`, `flat`, `colorSpace`, `toneMapping`<br>• `usePostProcessing` renamed to `useRenderPipeline`<br>• `useTexture({cache})` defaults to true<br>• the default camera is now a scene child, which shifts `scene.children` indices<br>**Features:**<br>• `userData.interactivePriority`<br>• `useBuffers` and `useGPUStorage` (experimental)<br>• `useTextures` registry<br>• multi-canvas via `renderer={{ primaryCanvas }}`<br>• camera parenting<br>• `forceEven` and `background` Canvas props<br>• `fromRef` and `once`<br>• scheduler moved to `@pmndrs/scheduler`<br>• `useLoader` custom `cacheKey`<br>• v9.7 reconciler hardening ported, including react-dom event priorities and microtasks<br>**Fixes:** `state.frustum` is current during the render phase; pointer events survive `args` reconstruction. | GPU, Ev, Loop |
| **10.0.0-alpha.4** | npm 2026-08-24 (GitHub release page says "August 28"; the pmndrs tweet is from 2026-08-28) | Standalone scheduler repo (`@pmndrs/scheduler@0.2`).<br>"Every Canvas now owns its frameloop, invalidation, and manual stepping. A demand-driven Canvas can no longer interfere with an always-running sibling".<br>Canvas-level `renderer.scheduler` `{before, after, order, fps}`.<br>Multi-canvas shared renderer, which "unlocks HUDs, picture-in-picture views, multi-viewport rendering, and 3D layers separated by regular HTML".<br>`useBuffers`, `useGPUStorage`, `useTextures`; atomic TSL fast refresh; `useRenderPipeline` with MRT.<br>`/webgpu` entry types `useThree`/`useFrame` against WebGPURenderer.<br>Declarative background, env files and presets.<br>Fixed-resolution rendering "and video export".<br>`fromRef()`, `once()`, `userData.interactivePriority`.<br>Suspending under Canvas no longer destroys the renderer root in StrictMode.<br>Multi-canvas resize targeting fixed. | GPU, Loop, Ev, Perf |
| **10.0.0-alpha.5** | 2026-09-08 | "Alpha 5 is a types release."<br>`useUniform(s)` keep three's `UniformNode<TNodeType,TValue>` generics.<br>`Fn(fn,'void')` compute kernels are reachable.<br>`Storage3DTexture` and `StorageArrayTexture` accepted.<br>`raycaster={{ params: { Points: { threshold: 0.2 } } }}` typechecks.<br>A primary `<Canvas id>` owns the renderer's default canvas target (#3905).<br>`resize.debounce` is honoured (#3881).<br>Six-file `.hdr` cube sets load. | GPU, Ev |
| 10.0.0-canary.14007b4 (npm `canary` tag) | 2026-09-26 | **Unreleased, heading for alpha.6:**<br>• TSL hooks (`useUniforms`, `useUniform`, `useNodes`, `useLocalNodes`, `useBuffers`, `useGPUStorage`, `useRenderPipeline`) move to the new package **`@react-three/tsl`**, created 2026-09-26 and peering `@react-three/fiber ^10.0.0-alpha.6`<br>• new three-free `@react-three/fiber/extension` entry (`registerRootExtension`, `setRenderOverride`)<br>• a `Register` interface narrows the renderer type app-wide<br>• the `onUpdate` prop is removed<br>• the split gain-map `<Environment>` format is removed<br>• deprecated standalone TSL utilities are removed<br>I confirmed that the canary `webgpu/index.d.ts` no longer exports `useUniforms`, and the unpacked size fell from 5.7 MB to 2.0 MB. | GPU |

Related package states on 2026-09-27, from npm dist-tags:

| Package | Version(s) | Notes |
|---|---|---|
| `@react-three/drei` | latest 10.7.9 (peers fiber `^9.0.0`); alpha 11.0.0-alpha.7 (2026-09-05; peers fiber `>=10.0.0-0`, three `>=0.185`) | – |
| `@react-three/postprocessing` | latest 3.1.3 (2026-09-27; peers fiber `>=9.7.0`) | – |
| `@react-three/xr` | latest 6.6.30 (2026-05-29; peers fiber `>=8`) | v10 compatibility is **UNVERIFIED** |
| `@react-three/offscreen` | latest 0.0.8 (2023); rc 1.0.0-rc.1 (2025-01-30) | No offscreen/worker work in the 9.x or 10 changelogs. v10 only keeps an `OffscreenCanvas` shim type. |
| `@pmndrs/scheduler` | 0.1.0 (2026-06-29), 0.2.0 (2026-08-24) | – |
| `three` | latest 0.186.1; 0.185.0 was published 2026-06-25 | – |

---

## 2. How v10 works

### 2.1 The scheduler (`@pmndrs/scheduler`, used by `useFrame`)

**Architecture.**
- A single global `Scheduler` drives one `requestAnimationFrame` loop shared by every `<Canvas>`.
- It is a cross-bundle singleton via `Symbol.for`, so it survives HMR (docs: `docs/frame-loop.mdx` on the `v10` branch).
- The package README describes itself as: "A small, **standalone**, framework-agnostic frame scheduler with **phases**, **priorities**, and **per-job FPS throttling**. One RAF loop, any renderer, no framework required." The vanilla core has zero dependencies. `/react` exports `useFrame`.
- Pre-1.0: "the port is ongoing and the API is still settling".

**Phases.** The default order is `start → input → physics → update → render → finish` (`DEFAULT_PHASES` in `dist/index.mjs:4`). You can add your own:

```ts
// verbatim (tarball README)
scheduler.addPhase('ai', { after: 'physics', before: 'update' })

scheduler.register(processInput, { phase: 'input' })
scheduler.register(() => world.step(1 / 60), { phase: 'physics', fps: 60, drop: false })
scheduler.register(updateAI, { phase: 'ai', fps: 20 })
scheduler.register(render, { phase: 'render' })
```

**Job options.** Verbatim from `@pmndrs/scheduler` `dist/index.d.ts`:

```ts
interface UseFrameOptions {
    /** Optional stable id for the job. Auto-generated if not provided */
    id?: string;
    /** Named phase to run in. Default: 'update' */
    phase?: string;
    /** Run before this phase or job id */
    before?: string | string[];
    /** Run after this phase or job id */
    after?: string | string[];
    /** Priority within phase. Higher runs first. Default: 0 */
    priority?: number;
    /** Max frames per second for this job */
    fps?: number;
    /** If true, skip frames when behind. If false, try to catch up. Default: true */
    drop?: boolean;
    /** Enable/disable without unregistering. Default: true */
    enabled?: boolean;
}
```

**Ordering.** Within a phase, jobs run in registration order, and `priority` breaks ties (higher runs first). `before`/`after` accept job ids or phase names, and the scheduler topologically sorts them. The docs say: "Numeric priority from v9 is deprecated for controlling order."

The v9 compatibility shim is still there in v10 alpha.5 (`dist/index.mjs:1154-1170`): `useFrame(cb, n)` with `n > 0` increments `internal.priority` and prints the deprecation "Using useFrame(callback, number) to control render order is deprecated. For custom rendering, use: useFrame(callback, { phase: "render" })".

**Frame state.** `state.clock` (THREE.Clock) is removed. Callbacks get `time` (RAF ms), `delta` (s), `elapsed` (s) and `frame`, merged with RootState. The v10 README example is verbatim `useFrame(({ delta }) => (ref.current.rotation.x += delta))`.

A new root option, `maxDelta`, caps catch-up. By default it is one driver frame: "a root that slept resumes where it left off instead of fast-forwarding… `Infinity` for true wall-clock deltas (v9 `THREE.Clock` behavior)."

**Is there a fixed timestep? No.** I read `shouldRun()` in `dist/index.mjs:367-384`:
- With `fps` set, a job runs at most once per RAF tick, and only when `elapsed >= 1000/fps - 1`.
- `drop: false` only snaps `lastRun` to the fps grid (`lastRun + steps * minInterval`), so the long-run rate stays exact.
- It never calls the job several times in one frame to catch up.

The docs' "catch-up semantics" means timing alignment, not sub-stepping. A real fixed-step accumulator (for a jiggle or MD integrator) still has to be written inside the job.

**Render takeover.** Via docs fetch:

```tsx
useFrame(
  () => {
    effectComposer.render()
  },
  { phase: 'render' },
)
// Built-in render is skipped while this job exists
```

"The check is dynamic; when the render job unmounts, the default render resumes automatically." To add work without taking over, use `{ before: 'render' }` or `{ after: 'render' }`.

**Controls.** `useFrame` returns `{ id, scheduler, rootId, step, stepAll, invalidate, pause, resume, isPaused }`, and `isPaused` is reactive. `scheduler.pauseJob(id)` and `resumeJob(id)` work from anywhere. `enabled` keeps a job registered while skipping it.

**Frameloop modes.** Each root has its own `'always' | 'demand' | 'never'`:
- `invalidate(frames?, stackFrames?)` caps pending frames at 60 per root.
- `advance(timestamp)` steps manually.
- `scheduler.onIdle(cb)` fires when the demand loop goes idle.
- Deprecated globals map as follows: `addEffect` → `{phase:'start'}`, `addAfterEffect` → `{phase:'finish'}`, `addTail` → `scheduler.onIdle`.

**Outside Canvas.** Via docs fetch: "`useFrame` creates a lazy **ambient root** when used outside `<Canvas>`… Callbacks receive timing-only state (`{ time, delta, elapsed, frame }` without gl/scene/camera). When a `<Canvas>` mounts, it adopts these jobs." Outside React, use `import { getScheduler } from '@react-three/fiber'` (or from `@pmndrs/scheduler`).

**Pointer events and the scheduler.** v10's `EventManager` adds (verbatim types):
- `frameTimedRaycasts?: boolean`: "Defer pointer move raycasting to frame start (default: true)". It only takes effect when `frameloop === "always"` (`index.mjs:13319`).
- `updateOnFrame?: boolean`: "Automatically re-raycast every frame to detect hover changes from moving objects/camera (default: false)".
- `flush()`: "Called by scheduler at frame start (input phase)".

### 2.2 TSL / WebGPU hooks

Where they live:
- alpha.5: `@react-three/fiber/webgpu`.
- Canary and next alpha: `@react-three/tsl`.

This is the verbatim README of `@react-three/tsl@10.0.0-canary.14007b4`:

```tsx
import { Canvas, useFrame } from '@react-three/fiber'
import { useUniforms, useNodes } from '@react-three/tsl'
import { positionLocal, normalLocal, sin, time } from 'three/tsl'

function Wobble() {
  const { uAmount } = useUniforms({ uAmount: 0.2 })
  const { offset } = useNodes(() => ({ offset: normalLocal.mul(sin(time).mul(uAmount)) }))

  return (
    <mesh>
      <sphereGeometry />
      <meshStandardNodeMaterial positionNode={positionLocal.add(offset)} />
    </mesh>
  )
}

function Driver() {
  // The resources are on RootState: frame state, useThree and creators all read them.
  useFrame(({ uniforms, elapsed }) => {
    uniforms.uAmount.value = Math.abs(Math.sin(elapsed))
  })
  return null
}

export const App = () => (
  <Canvas renderer>
    <Wobble />
    <Driver />
  </Canvas>
)
```

The same README says: "Resources belong to the renderer: a primary canvas, its secondary canvases (`renderer={{ primaryCanvas }}`) and every portal inside them share one set. They live on the primary canvas's `RootState` (`state.uniforms`, `state.nodes`, `state.buffers`, `state.gpuStorage`)".

What each hook does:
- **`useUniforms`** is a shared, optionally scoped registry. It accepts:
  - an object or a creator `(state) => ({...})`
  - raw numbers, booleans, CSS colour strings, Vector2/3/4, Color, Matrix2/3/4, or TSL nodes
  - it returns `{...nodes, removeUniforms, clearUniforms, rebuildUniforms}`
- **`useUniform(name, value?)`** handles a single uniform.
- **`useNodes`** is for "expensive, reusable work - complex noise/effect functions, shared varyings" (via docs fetch).
- **`useLocalNodes`** is component-local and rebuilds when uniforms, nodes or textures change. Verbatim JSDoc from the alpha.5 typings:

```tsx
// Destructure what you need from state
const { wobble, uTime } = useLocalNodes(({ uniforms, nodes }) => ({
  wobble: sin(uniforms.uTime.mul(2)),
  uTime: uniforms.uTime,  // can return uniforms too
}))

// Or access anything else from RootState
const { scaled } = useLocalNodes(({ camera, nodes }) => ({
  scaled: nodes.basePos.mul(camera.zoom),
}))
```

**`useBuffers` / `useGPUStorage`** (compute, experimental). Verbatim JSDoc:

```tsx
const { positions, velocities } = useBuffers(() => ({
  positions: instancedArray(count, 'vec3'),       // StorageBufferNode
  velocities: new Float32Array(count * 3),        // TypedArray
}), 'particles')
```

```tsx
const { heightMap } = useGPUStorage(() => ({
  heightMap: new StorageTexture(512, 512),
}), 'terrain')
```

`StorageLike` includes `StorageTexture`, `Storage3DTexture` ("volumes, fluid grids"), `StorageArrayTexture`, `Data3DTexture` and TSL storage nodes.

The docs particle example (`docs/webgpu/compute.mdx`, via docs fetch) creates `instancedArray(PARTICLE_COUNT,'vec3')` buffers. It then updates them in a `Fn(() => { ... vel.addAssign(force.mul(0.01)); pos.addAssign(vel) })()` node, which samples a `StorageTexture` force field. Finally it binds `positionNode = buffers.particles.positions.element(instanceIndex)` into `<meshBasicNodeMaterial>` on an `<instancedMesh>`. The docs warn these APIs are "still evolving".

**`useRenderPipeline`** replaced `usePostProcessing` in alpha.3. It wraps three's `RenderPipeline` (called `PostProcessing` before r183). Verbatim JSDoc:

```tsx
// Simple effect
useRenderPipeline(({ renderPipeline, passes }) => {
  renderPipeline.outputNode = bloom(passes.scenePass.getTextureNode())
})

// With MRT setup
useRenderPipeline(
  ({ renderPipeline, passes }) => {
    const beauty = passes.scenePass.getTextureNode().toInspector('Color')
    const vel = passes.scenePass.getTextureNode('velocity')
    renderPipeline.outputNode = motionBlur(beauty, vel)
  },
  ({ passes }) => {
    passes.scenePass.setMRT(mrt({ output, velocity }))
  }
)
```

**HMR.** TSL nodes, uniforms, buffers and storage "rebuild atomically during fast refresh instead of requiring a full reload" (alpha.4). The Canvas `hmr` prop defaults to true in dev.

### 2.3 Multi-canvas (WebGPU only)

Verbatim from the alpha.4 release notes:

```tsx
<Canvas id="main" renderer>
  <MainScene />
</Canvas>

<Canvas
  renderer={{
    primaryCanvas: 'main',
    scheduler: { after: 'main', fps: 30 },
  }}>
  <Hud />
</Canvas>
```

"Each Canvas keeps its own scene, camera, events, and state while sharing the renderer and GPU resources. The scheduler handles target switching, render order, and independent frame rates."

How it works (from source, alpha.5 `index.mjs:14190-14260`):
- A secondary canvas waits for the primary (`waitForPrimary`).
- It wraps its own element in a three `CanvasTarget`.
- It marks both roots `isMultiCanvas`.
- It inherits `webGPUSupported` and `primaryStore`.

Hard errors:
- "The `primaryCanvas` prop for multi-canvas rendering cannot be used with WebGL."
- "Cannot use both gl and renderer props at the same time."

The docs' HUD example draws the primary's scene from a secondary with its own ortho camera: `useFrame(({ primaryStore, renderer }) => renderer.render(primaryStore.getState().scene, cam), { phase: 'render', after: 'main' })`.

### 2.4 "Three essentials moved out of Drei directly into core"

Tweet 2093370902461182190 (2026-08-28, decoded from the snowflake id) says: "R3F v10 has a fresh release in preview! ✧ First-class WebGPU and TSL support ✧ useFrame revamped with a new scheduler ✧ Multi-canvas out of the box ✧ Three essentials moved out of Drei directly into core". The tweet does not name the three.

I compared the exports of 9.8.1 and 10 alpha.5. These are the drei-origin additions to core:
1. **`Environment`** family: `Environment`, `EnvironmentCube`, `EnvironmentMap`, `EnvironmentPortal`, `useEnvironment`, with presets `apartment | city | dawn | forest | lobby | night | park | studio | sunset | warehouse`. There is also the declarative `<Canvas background="city" | "#hex" | "/env.hdr" | {…}>` prop.
2. **`useTexture`** / `Texture`, plus the new ref-counted `useTextures` registry.
3. **`useRenderTarget`**, a renderer-independent drei `useFBO` equivalent. It returns `WebGLRenderTarget` under WebGL and `RenderTarget` under WebGPU (`index.mjs:1494-1519`).

Treat that mapping as **inferred**. drei 11.0.0-alpha.7 also still exports `useFBO`, `useTexture` and `Environment` (`core/index.d.ts:1466,1569,1827`). Drei's v11 migration doc says: "Drei v11 requires R3F v10 — this isn't optional, even for legacy WebGL projects". It splits entries into `/core`, `/external`, `/experimental`, `/legacy`, `/webgpu` and `/native`.

### 2.5 WebGPU Canvas setup and WebGL fallback

**v9 (works today, including 9.8.x).** From the v9 migration guide:

```tsx
<Canvas
  gl={async (props) => {
    const renderer = new THREE.WebGPURenderer(props as any)
    await renderer.init()
    return renderer
  }}>
```

9.8.0's synchronous-root change (#3925) specifically fixes StrictMode races with async renderers.

**v10.** Via docs fetch, `docs/webgpu/overview.mdx`:
- `<Canvas renderer>` (boolean)
- `<Canvas renderer={{ antialias: true, forceWebGL: false }}>`
- `<Canvas renderer={myWebGPURenderer}>`
- or a (possibly async) factory

There are three entries:
- `@react-three/fiber`: the renderer is chosen by the `renderer` prop and "loaded on demand".
- `/legacy`: WebGL only.
- `/webgpu`: WebGPU only, with node materials as JSX.

Source behaviour in alpha.5 (`index.mjs:14190-14247`):
- Without a `renderer` prop, the default entry builds a `WebGLRenderer`. It uses defaults `powerPreference:'high-performance', antialias:true, alpha:true` and warns: "WebGlRenderer usage is deprecated in favor of WebGPU. Import from /legacy directly or upgrade to WebGPU."
- With `renderer`, it builds a `WebGPURenderer`, calls `setSize`/`setPixelRatio` first, then `await renderer.init()`, and sets `state.webGPUSupported = 'isWebGPUBackend' in renderer.backend`.

The WebGL2 fallback itself is three's: `WebGPURenderer` switches to its WebGL2 backend when WebGPU is unavailable and logs "THREE.WebGPURenderer: WebGPU is not available, running under WebGL2 backend." (Utsubo). R3F exposes the result as `state.isLegacy` and `state.webGPUSupported`.

Caveats from Utsubo that matter for WebGPURenderer:
- "`ShaderMaterial`, `RawShaderMaterial`, and `onBeforeCompile` patches don't run on `WebGPURenderer` at all."
- `EffectComposer`/pmndrs postprocessing "don't run on `WebGPURenderer`".
- "`render()` on an uninitialized renderer throws" (r186).
- node materials treat `colorNode` as linear.
- about 87% global WebGPU support (Aug 2026).
- iOS needs 26+: "An iPhone that can't update to iOS 26… runs your app on WebGL 2, so test that path too."

### 2.6 Other v10 additions worth knowing

- **Visibility events** (verbatim types):
  - `onFramed?: (inView: boolean) => void` fires on frustum enter/exit.
  - `onOccluded?: (occluded: boolean) => void` is "WebGPU only, requires occlusionTest=true on object".
  - `onVisible?` combines frustum, occlusion and the `visible` prop.
  - The Canvas `occlusion` prop is "Auto-enabled when any object uses onOccluded or onVisible handlers."
- **`state.frustum`** is auto-updated when `autoUpdateFrustum` is true. `updateFrustum(camera, frustum?)` is exported.
- **Per-pointer state.** `internal.pointerMap: Map<pointerId, {hovered, captured, initialClick, initialHits}>` replaces the global hovered map, so multi-touch hover and capture are tracked per finger.
- **XR pointers.** `events.registerPointer({ ray, type: 'controller'|'hand'|'gaze', handedness })`.
- **Drag and drop on 3D objects.** `onDragOverEnter`, `onDragOver`, `onDragOverLeave`, `onDrop`, `onDropMissed`, and the Canvas `onDragOverMissed`/`onDropMissed`.
- **`userData.interactivePriority`** sorts before distance-based hit ordering (`index.mjs:13087-13099`).
- **Camera in the scene graph.** Camera children (lights, meshes, HUD) render.
- **`width` / `height` / `forceEven`** Canvas props give fixed-resolution output. `forceEven` "fixes Safari rendering issues with odd/fractional sizes".
- **`fromRef(ref, transform?)`** wires sibling refs into props without effects. **`once(...)`** applies a method only on mount.

---

## 3. Breaking changes and migration risks: Lupi on 9.6 → 10 alpha

**Hard blockers:**
1. **three `>=0.185.0`.** Lupi pins `three ^0.184.0` (`packages/ui/package.json:43`, `packages/scene/package.json:29`, `apps/web/package.json:28`), and the lock is `three@0.184.0` (`pnpm-lock.yaml:7419`). The release notes say "Versions r181–r184 incompatible".
2. **The `/legacy` entry is broken in alpha.5.** Issue #3921 (opened 2026-09-16, still open): "The requested module 'three' does not provide an export named 'MeshBasicNodeMaterial'". Lupi's main viewer is WebGL, so it would want `/legacy`.
3. **drei.** Lupi uses drei 10 (`^10.7.7`; `Text`, `Billboard`, `OrbitControls`, `Html`, `ContactShadows`, `Environment`, `useEnvironment`, `MeshTransmissionMaterial`, `GizmoHelper` and more). drei 10 peers fiber `^9.0.0`. Moving means drei 11 alpha, whose component WebGPU status file "is not a claim that the component works."
4. **Postprocessing.** `packages/ui/src/postprocess/ScenePostprocessing.tsx:16` uses `@react-three/postprocessing` (`EffectComposer`, `N8AO`, `Bloom`, `ToneMapping`, `Vignette`, `DepthOfField`). It is WebGL-only, so any WebGPU path has to rebuild these as `useRenderPipeline` / TSL nodes.
5. **The API is still moving.** The TSL hooks change import path in the very next alpha (`@react-three/tsl`). `onUpdate` has been removed in canary. React peer `<19.3`, while 9.8 already allows 19.3.

**Code-level changes Lupi would need:**
- `state.clock` usage becomes `state.elapsed`:
  - `packages/ui/src/SelectionMarkers.tsx:99-101`
  - `packages/scene/src/BillionAtomBlock.tsx:303,356`
- Numeric-priority render takeover: `packages/ui/src/ExportManager.tsx:180` (`}, 2); // Priority 2 execution!`). It becomes `{ phase: 'render' }`. The shim still works in alpha.5 but warns.
- `gl` becomes `renderer`:
  - `onCreated={({ gl }) => configureViewerRenderer(gl)}` (`packages/ui/src/viewer/ViewerCanvas.tsx:77`)
  - `useThree().gl` in `ExportManager.tsx:455` and `packages/scene/src/AtomPicker.tsx:45`
  - `gl` still works with a deprecation warning.
- `<color attach="background">` (`packages/ui/src/BillionAtomsPage.tsx:106`) is deprecated; use `<Canvas background>`.
- The `id` prop gains meaning. `ViewerCanvas.tsx:68` sets `id="lupi-viewer-canvas"`, and under WebGPU that registers a primary canvas. This is harmless under WebGL.
- `preserveDrawingBuffer: true` in `VIEWER_GL_OPTIONS` (`ViewerCanvas.tsx:26-31`) is a WebGL-only concept. Export on WebGPU would need a different readback path. **UNVERIFIED:** I did not research WebGPU readback APIs.
- The default camera is now a scene child, which can break code that indexes `scene.children`. **UNVERIFIED** whether Lupi does this.
- `@react-three/xr ^6.6.29` under v10 is **UNVERIFIED**. Its peer range is `>=8`, but I found no compatibility statement.

**Is v10 usable in production today?** No, not for Lupi's main viewer:
- The docs banner says "**Alpha Release** - v10 is currently in alpha".
- The alpha.1 status line says "all features experimental and may be changed, removed or expanded at any time".
- The compute docs say to pin versions and expect breaks.
- Add to that the hard blockers above.

A June 2026 maintainer reply in #3665 (DennisSmolek) promised "a beta 1 coming right behind" alpha 3. As of 2026-09-27 there is no beta on npm.

It is reasonable for an isolated, pinned experiment:
- a separate route or app, or GPU Studio (already a separate, opt-in, vanilla-three WebGPU surface)
- pinned to `@react-three/fiber@10.0.0-alpha.5` + `three@0.185.x`, or to the canary + `@react-three/tsl`

Caveat: running fiber 9 and fiber 10 in one bundle would need package aliasing. **UNVERIFIED** feasibility. pmndrs/glyph PR #193, "support R3F v9 alongside v10", suggests the ecosystem is dual-targeting.

**Recommended low-risk steps now:**
- Bump to 9.8.1.
- Adopt `@pmndrs/scheduler@0.2.0` standalone where Lupi hand-rolls RAF loops.
- Prototype TSL/compute in GPU Studio using plain three's `RenderPipeline` / `instancedArray`, which is the same machinery `@react-three/tsl` wraps.

---

## 4. What each capability unlocks for Lupi

Current surfaces:
- **Main viewer:** one R3F `<Canvas>` with WebGL2, `frameloop={paused ? 'never' : 'always'}`, `antialias:false`, dpr `[1, 1.25|1.75]` by device tier, wrapped in `<XR>` (`packages/ui/src/viewer/ViewerCanvas.tsx:58-86`).
- **GPU Studio:** vanilla `WebGPURenderer` with its own `GPUDevice`, a manual demand RAF (`requestDraw`/`draw`, `packages/ui/src/gpu-studio/runtime.ts:122-145`), and a hard failure if the backend isn't WebGPU (`:169`).
- **Other WebGPU users:** three more independent vgpu devices (`action-light/runtime.ts:1`, `scan/swirl.ts:2`, `scan/gist/gistParticles.ts:2`).
- **Picking:** custom ray-march over a spatial hash (`packages/scene/src/AtomPicker.tsx:57-120`).

| Capability (version) | Unlocks: problem → solution | Surface |
|---|---|---|
| **Activity support + renderer disposal (9.8.1)** | Leaving the viewer for the gallery or library tears down the scene, and returning recompiles shaders and refetches. Wrapping the viewer in `<Activity mode="hidden">` keeps the Canvas root, scene and GPU state alive, so return is instant. The disposal fix stops leaked renderers when the viewer remounts; Lupi already juggles "live-context slots" (`renderCapability.ts:78`). | Main (9.x, now) |
| **react-dom event priorities (9.7.0)** | Atom clicks and hover now run at discrete/continuous priority like DOM events, so React state updates from 3D taps (info cards, selection chips) feel as snappy as buttons on mobile. | Main (9.x, now) |
| **Sync root config (9.8.0)** | Safe StrictMode + async `gl` WebGPU on v9. You could port GPU Studio to an R3F v9 Canvas with `gl={async…}` today, without the v10 alpha. | Studio (9.x) |
| **Named phases + before/after (v10 / scheduler)** | Replaces fragile priority numbers such as ExportManager's `2`. Proposed pipeline: `input` (gesture/tilt) → `physics` (atom jiggle, springs) → `update` (camera focus, labels) → `render` (composer or custom) → `finish` (perf HUD, analytics). | Both |
| **Per-job `fps` + `drop`** | Mobile battery and heat. Run knowledge labels and annotations (`KnowledgeLabelsLayer.tsx:100`, `AnnotationsLayer.tsx:184`) at 20–30 fps, trails at 30, keep camera and render at display rate. Use `drop:false` for a steady 60 Hz "thermal wiggle" (still add a hand-written sub-step, since there is no built-in fixed step). | Both |
| **Per-root frameloop, `onIdle`, `invalidate(frames)`** | Idle viewer at 60 fps drains phones. Switch to `demand` when the camera is still. `onIdle` triggers an "attract mode" (slow orbit, breathing glow) or saves state after N idle seconds. A sibling HUD canvas can't keep the main one awake. | Main |
| **`useFrame` outside Canvas / standalone scheduler** | DOM effects (the Lupi action-button glow, scan swirl, gist particles, GPU Studio's `requestDraw`) each run their own RAF. One scheduler gives one loop, ordered jobs, a global pause, and frame-synced DOM overlays such as an energy meter or temperature dial. `@pmndrs/scheduler@0.2.0` needs no R3F upgrade. | Studio + DOM (now) |
| **Render takeover + `frameloop='never'` + `stepAll`/`advance(ts)` + `width`/`height` props** | Deterministic, frame-accurate video and GIF export ("breathing molecule" loops for social sharing) at fixed resolution without resizing the live canvas. This replaces ExportManager's `setSize`/`setDpr`/`setFrameloop('always')` juggling (`ExportManager.tsx:455-517,862-863`). | Main |
| **Multi-canvas shared renderer (WebGPU only)** | Many live 3D previews without hitting WebGL context limits: live spinning thumbnails in gallery cards, a picture-in-picture minimap, a "your molecule vs. water" side-by-side, an element-legend strip of real lit atoms, and HUDs at `fps: 30`. One GPU device for all of them, instead of Lupi's current four independent devices. | Studio / future WebGPU viewer |
| **`useUniforms` / `useNodes` (global, scoped TSL)** | One shared "mood" uniform set (temperature, pulse, pointer position, audio level, tilt) that every node material reads: atoms, bonds, background, particles. A single slider or gesture restyles the whole scene with no recompiles; the v10 starter pitches exactly this, noting Leva changes avoid recompilation. Scopes (`'atoms'`, `'bg'`) prevent collisions. HMR speeds up look development. | Studio |
| **`useBuffers` / `useGPUStorage` + compute** | Particle play on phones: atoms "melt" into gas, swirl around the pointer, and snap back to the lattice, all on the GPU. Three's compute example runs 200k particles; an installation ran about 1M (Utsubo). `Storage3DTexture` enables volumetric electron-density or potential fields that particles advect through. Positions bind straight into `positionNode` on `<instancedMesh>`, with no CPU copy. | Studio |
| **`useRenderPipeline` + MRT** | Signature looks on WebGPU: selective bloom on emissive atoms via an emissive MRT, velocity MRT for motion blur on flicks, normal/depth MRT for toon outlines and "blueprint" edges, and `toInspector()` for tuning. This is the WebGPU replacement for Lupi's `EffectComposer`/N8AO/Bloom/DOF stack. | Studio / future |
| **`onFramed` / `onOccluded` / `onVisible`** | Performance: pause per-object animation, labels and trail updates when off-screen. Play: a "find the hidden atom" game where buried core atoms reveal and chime when un-occluded (occlusion is WebGPU only; `onFramed` works on both renderers). | Both |
| **`state.frustum` / `updateFrustum`** | Cheap CPU culling for label, annotation and billboard layers without maintaining a separate frustum. | Main |
| **Deferred raycasts (`frameTimedRaycasts`), `updateOnFrame`, per-pointer `pointerMap`** | On 120 Hz touch screens, pointermove can raycast several times per frame; v10 coalesces this to once per frame. `updateOnFrame` keeps hover correct while atoms or the camera move. Per-pointer state means two fingers can hover or drag two atoms. Lupi's custom `AtomPicker` could run on the scheduler's `input` phase. | Main (v10) |
| **`userData.interactivePriority`** | Gizmos, measurement handles and in-scene UI can win over atoms behind or near them, so fewer mis-taps on mobile. | Both |
| **Drag-and-drop events on 3D objects** | Drag an element card or photo from the DOM straight onto an atom or molecule ("drop oxygen here", "drop a photo to scan"). | Both (v10) |
| **XR pointer registration** | Controllers and hands feed the same event system as mouse and touch, so one interaction code path for desktop, phone and headset. Interop with `@react-three/xr` is **UNVERIFIED**. | Main XR |
| **Camera in scene graph** | Camera-attached content renders: a head-lamp light following the user ("flashlight exploration mode"), a 3D compass or element tile pinned to the view, or a lens or reticle effect. | Both |
| **`<Canvas background>` + core `Environment` presets** | One-tap "mood" chips (studio, sunset, night, city…) for casual users. HDR/env switching works on both renderers without drei. | Both |
| **Renderer-independent `useRenderTarget`** | The same FBO code for WebGL and WebGPU paths: portals, "x-ray lens" circles under the finger, picture-in-picture magnifier. | Both |
| **`fromRef` / `once`** | Less effect boilerplate (for example `spotLight target={fromRef(atomRef)}` for a light that tracks the selected atom). | Both |

---

## Sources

**GitHub releases and discussions**
- https://github.com/pmndrs/react-three-fiber/releases (pages 1–2)
- https://github.com/pmndrs/react-three-fiber/releases/tag/v10.0.0-alpha.1
- https://github.com/pmndrs/react-three-fiber/releases/tag/v10.0.0-alpha.2
- https://github.com/pmndrs/react-three-fiber/releases/tag/v10.0.0-alpha.3 (page failed to load; tag date only)
- https://github.com/pmndrs/react-three-fiber/releases/tag/v10.0.0-alpha.4
- https://github.com/pmndrs/react-three-fiber/releases/tag/v10.0.0-alpha.5
- https://github.com/pmndrs/react-three-fiber/releases/tag/v9.7.0
- https://github.com/pmndrs/react-three-fiber/releases/tag/v9.8.0
- https://github.com/pmndrs/react-three-fiber/releases/tag/v9.8.1
- https://github.com/pmndrs/react-three-fiber/releases/tag/v9.0.0
- https://newreleases.io/project/github/pmndrs/react-three-fiber/release/v10.0.0-alpha.4
- https://newreleases.io/project/github/pmndrs/react-three-fiber/release/v10.0.0-alpha.1
- https://github.com/pmndrs/react-three-fiber/discussions/3665
- https://github.com/pmndrs/react-three-fiber/issues/3921

**v10 docs and changelogs (`v10` branch)**
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/docs/frame-loop.mdx
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/docs/migration/v10.mdx
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/docs/webgpu/overview.mdx
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/docs/webgpu/tsl-hooks.mdx
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/docs/webgpu/compute.mdx
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/docs/webgpu/multi-canvas.mdx
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/docs/API/hooks.mdx
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/packages/fiber/CHANGELOG.md
- https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/CHANGELOG-ALPHA.md
- https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide
- r3f.docs.pmnd.rs root: rendered empty for the fetcher; the v10 docs were read from the GitHub `v10` branch instead.

**npm registry and tarballs**
- https://registry.npmjs.org/@react-three%2ffiber: version times; tarballs 9.8.1, 10.0.0-alpha.5, 10.0.0-canary.14007b4 (`dist/webgpu/index.d.ts`, `dist/index.mjs`, `readme.md`)
- https://registry.npmjs.org/@react-three%2ftsl: 10.0.0-canary.14007b4 tarball (`readme.md`, `dist/index.d.ts`)
- https://registry.npmjs.org/@pmndrs%2fscheduler: 0.2.0 tarball (`README.md`, `dist/index.d.ts`, `dist/index.mjs`, `dist/react.d.ts`); repo https://github.com/pmndrs/scheduler
- https://registry.npmjs.org/@react-three%2fdrei: 10.7.9 and 11.0.0-alpha.7 (tarball `core/`, `legacy/`, `webgpu/` d.ts)
- https://registry.npmjs.org/@react-three%2fpostprocessing
- https://registry.npmjs.org/@react-three%2fxr
- https://registry.npmjs.org/@react-three%2foffscreen
- https://registry.npmjs.org/three
- https://registry.npmjs.org/math

**Other**
- https://github.com/pmndrs/drei/blob/v11-working/devDocs/MIGRATION_V10_TO_V11.md
- https://github.com/R3F-Workshop/v10-starter
- https://x.com/pmndrs/status/2093370902461182190: fetch returned 402; text from search snippet; date decoded from the snowflake id as 2026-08-28
- https://www.utsubo.com/blog/webgpu-threejs-migration-guide (Sep 24, 2026)
- https://react-news.com/webgpu-in-react-why-r3f-v10-actually-matters: **UNVERIFIED**, DNS failure; only a search snippet was seen: "R3F v10 lets you bind compute buffers directly to meshes, enabling million-particle scenes"
- https://github.com/pmndrs/glyph/pull/193 (title only, from search)
- https://gitnation.com/contents/from-websites-to-games-the-future-of-react-three-fiber (2024 talk: DAG scheduler rationale)

**Lupi code references**
- `packages/ui/src/viewer/ViewerCanvas.tsx:26-31,58-86`
- `packages/ui/src/ExportManager.tsx:90,180,455,517,862-863`
- `packages/ui/src/SelectionMarkers.tsx:99-101`
- `packages/scene/src/BillionAtomBlock.tsx:303,356`
- `packages/ui/src/BillionAtomsPage.tsx:100-106`
- `packages/ui/src/postprocess/ScenePostprocessing.tsx:16,44-97,121`
- `packages/scene/src/AtomPicker.tsx:45-120`
- `packages/ui/src/gpu-studio/runtime.ts:122-171`
- `packages/ui/src/action-light/runtime.ts:1`
- `packages/ui/src/scan/swirl.ts:2`
- `packages/ui/src/scan/gist/gistParticles.ts:2`
- `packages/ui/src/KnowledgeLabelsLayer.tsx:100`
- `packages/ui/src/AnnotationsLayer.tsx:184`
- `packages/ui/src/renderCapability.ts:78`
- `packages/ui/package.json:30-43`
- `packages/scene/package.json:26-29`
- `apps/web/package.json:19-28`
- `pnpm-lock.yaml:2909,2931,2956,2963,6566,7419`
