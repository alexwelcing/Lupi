# The v10 unlock map for Lupi: what becomes cheap or newly possible

Researched 2026-09-27. This is research only; nothing in the repo was changed.

**Premise (owner decision).** "Assume we are upgrading to v10 alpha for R3F." This digest assumes the upgrade is *done*. The baseline:
- `@react-three/fiber` v10 alpha. The latest published alpha is **10.0.0-alpha.5** (npm 2026-09-08). The next alpha moves the TSL hooks to `@react-three/tsl`.
- three `>=0.185`, realistically **0.186.1** (npm `latest`).
- `WebGPURenderer` as the main renderer, with its automatic WebGL2 backend.
- drei **11.0.0-alpha.7**.
- The TSL hooks and the v10 scheduler.

The question is what this makes cheap or newly possible for a fun, fast, beautiful molecule and particle viewer on desktop and phone.

**How to read the tags**
- `[GPU]` works only on the real WebGPU backend.
- `[GPU+GL2]` also works on `WebGPURenderer`'s WebGL2 backend.
- `[GL2-degraded]` runs on WebGL2, but slower or with less.
- `(verbatim …)` means copied from the named source. `(sketch)` means my own untested code written for Lupi.
- **UNVERIFIED** means I could not confirm it. **(inference)** means reasoned from source, not observed at runtime.

**Sources read first-hand for this pass** (beyond the earlier digests `00-fact-sheet.md`, `r3f-releases.md`, `pmndrs-ecosystem.md`, `threejs-webgpu.md`, `code-core.md`):
- `pmndrs/react-three-fiber`, branch `v10` at commit `14007b4` (2026-09-26): a sparse clone of `docs/`.
- `pmndrs/react-three-examples` at `b3fb717` (2026-09-08; pins fiber `10.0.0-alpha.4`, drei `11.0.0-alpha.7`, three `0.185.1`): a sparse clone of `src/`, `AGENTS.md` and `docs/`.
- Tarballs:
  - `@react-three/fiber@10.0.0-alpha.5`: `dist/webgpu/index.d.ts`, `index.mjs`
  - `@react-three/tsl@10.0.0-canary.14007b4`: `dist/index.d.ts`, `readme.md`
  - `@pmndrs/glyph@0.1.0`
  - `@react-three/drei@11.0.0-alpha.7`
- three r186 files:
  - `build/three.webgpu.js` and `build/three.tsl.js` from 0.186.1 via jsDelivr
  - `examples/*.html` and `examples/jsm/**` at tag `r186` via raw.githubusercontent

---

## 0. TL;DR: the unlock map on one page

| # | Unlock (v10 + r186) | What becomes cheap or new | Lupi toy it enables | Phone | WebGL2 fallback |
|---|---|---|---|---|---|
| 1 | **GPU-resident atoms**: `useBuffers` + `instancedArray` → `positionNode` | 100k+ atoms get per-atom display motion with **zero CPU copies** after one upload. Poke, jiggle, explode or reassemble, and morph are each a small compute kernel. | "Poke the molecule", thermal wiggle slider, switch-molecule explode and reassemble, curl-noise "melt" | Yes. Simulation is cheap; fill rate is the limit. | `[GL2-degraded]`: simple per-atom kernels run via transform feedback. No atomics or binning. |
| 2 | **One "mood" uniform bus**: `useUniforms` + `Register`/`configureTSL` | One typed uniform set (energy, warmth, pulse, tilt, pointer) drives every material, the post graph and the particles, with no recompiles. It is shared across every canvas that shares the renderer. | One slider or gesture re-moods the whole scene. Tap feedback pulses. Tilt-gravity. | Yes | `[GPU+GL2]` |
| 3 | **`useRenderPipeline` + MRT** | Selective bloom per element via `mrtNode`, `outline()` for hover, TRAA, SSAO/GTAO, DOF, motion blur, `afterImage` trails, `transition()` wipes, and style skins. All are TSL nodes in one graph. | Glowing elements, hover outlines, molecule-switch wipes, comet trails, blueprint and halftone looks | Some: bloom and outline half-res, no GTAO or SSGI | Mostly `[GPU+GL2]` (fullscreen fragment passes). OIT loses MSAA. |
| 4 | **Scheduler**: phases, `before`/`after`, per-job `fps`, per-root `frameloop`, `onIdle`, `useFrame` outside Canvas | One loop for playback, springs, compute sim, labels and DOM overlays. Idle becomes `demand`, which is the battery win. | Attract mode on idle, 20 fps labels, frame-synced DOM meters, deterministic video steps | Yes, and this is the biggest phone win | `[GPU+GL2]` (renderer-agnostic) |
| 5 | **Multi-canvas with one shared renderer** | Many live 3D views on one `GPUDevice`: no context limit and no duplicate shaders. | Live spinning thumbnails in gallery and switcher, picture-in-picture, "vs water" split compare, element legend strip of real lit atoms | Only a few at a time; memory cost is per canvas | **Absent** (inference from three source). Fall back to drei `<View>` or static previews. |
| 6 | **Events**: `onFramed`/`onOccluded`/`onVisible`, per-pointer `pointerMap`, `frameTimedRaycasts`, `interactivePriority`, drag-and-drop onto meshes | Cheap offscreen pausing, GPU occlusion, multi-touch per finger, gizmos that always win, file and element-chip drops | "Find the buried atom", two-finger measure, drop an element onto an atom | Drag-and-drop from a finger is unreliable on phones (§4.5) | onFramed yes. onOccluded **probably yes** via WebGL2 queries (inference). |
| 7 | **Fixed-size output**: `<Canvas width height forceEven>` + `useRenderTarget` in core | Share cards and 1080p or 4K video frames rendered without resizing the live canvas | "Make a share card", "record a 6 s loop" | Yes (offscreen) | `[GPU+GL2]` |
| 8 | **r186 transparency**: `OITPassNode` | Order-independent glass and candy atoms and shells that never pop during rotation | Candy and glass atom skin, translucent filter shell | Probably OK on flagships (UNVERIFIED) | `[GL2-degraded]`: no MSAA |
| 9 | **r185/r186 volumes**: `Storage3DTexture` + `RaymarchingBox` | A compute-baked, animated 3D field raymarched in the fragment stage | Illustrative "electron cloud" or "aura" fog, melt-to-blob surface | Desktop and flagships only | **Absent** (no storage textures). The fallback is a CPU-baked `Data3DTexture`. |
| 10 | **r186 `GaussianSplat`** + `createGaussianSplatGeometry` | Splats from files or generated procedurally from arrays | Show `/scan`'s photographed object as soft splats next to "its" molecules; soft atom halos | Moderate counts | `[GL2-degraded]`: CPU sort |
| 11 | **r185 `ClusteredLighting`** (default `maxLights` 1024) | Hundreds of real point lights | "Firefly mode": selected, hovered or chosen-element atoms emit real light | Desktop | Treat as absent (the example gates on WebGPU) |
| 12 | **r186 `CountingSort` and atomic workgroup arrays** | GPU binning and sort for hundreds of thousands to millions of elements | Particle Life, sticky atoms, GPU neighbour glow, sorted soft sprites | Desktop and flagships | `CountingSort` has `computeCPU`. Atomics are absent. |
| 13 | **Upscaling**: `fsr1()`, `taau()`, `@pmndrs/upscaler` | Render at about 0.6–0.75× and reconstruct | Keeps phones at 60 fps with bloom on | Yes, this is the point | `fsr1` `[GPU+GL2]`. `@pmndrs/upscaler` absent (WGSL). |
| 14 | **`@pmndrs/glyph`**: `Text.breakApart()` (renamed `split()` on main) | MSDF/Slug labels whose glyphs detach into independently transformed copies | Element symbols that shatter into particles and re-form; periodic-table typography toy | Yes | `[GPU+GL2]` (works on `WebGPURenderer`'s WebGL2 backend) |
| 15 | **`@pmndrs/sky`** | Physical sky with Earth, Mars and Titan presets | "Molecules in weather", a time-of-day environment | Moderate | UNVERIFIED |

**The keystone.** Almost every unlock above assumes Lupi's GLSL `RawShaderMaterial` atom and bond impostors have been ported to TSL node materials. Neither `ShaderMaterial` nor `RawShaderMaterial` runs on `WebGPURenderer` on either backend ([TJS] fact 28).
- The port uses `positionNode` or `vertexNode` for the billboard and `depthNode` for the sphere depth, which replaces `gl_FragDepth`. `NodeMaterial.depthNode` exists (`three.webgpu.js:12887`).
- The existing `instancePosition → instanceTargetPosition` lerp by `uProgress` (`packages/scene/src/AtomsOptimized.tsx:342,367`) maps one-to-one onto `mix(a, b, uProgress)` in TSL. Adding `+ offset.element(instanceIndex)` is the entire "display offset" hook.
- WGSL has no `layout(depth_greater)`, so early-Z behaviour may change (UNVERIFIED).

---

## 1. TSL hooks: what they are in v10 and what each unlocks

**Where they live**
- **alpha.5**: `@react-three/fiber/webgpu` exports the hooks. The `react-three-examples` corpus imports them from there (it is on alpha.4).
- **Canary 14007b4 → alpha.6**: the hooks move to **`@react-three/tsl`**, which peers `@react-three/fiber ^10.0.0-alpha.6` (not yet published).

`@react-three/tsl` exports: `useUniforms`, `useUniform`, `useNodes`, `useLocalNodes`, `useBuffers`, `useGPUStorage`, `useRenderPipeline`, `configureTSL`, `createScopedStore` and `rebuildAll*`. Source: `@react-three/tsl@10.0.0-canary.14007b4` `dist/index.d.ts:776`.

**Scope of "shared".** Resources belong to the **renderer**, not the canvas (verbatim, `@react-three/tsl` readme):

> Resources belong to the renderer: a primary canvas, its secondary canvases (`renderer={{ primaryCanvas }}`) and every portal inside them share one set. They live on the primary canvas's `RootState` (`state.uniforms`, `state.nodes`, `state.buffers`, `state.gpuStorage`) … Works under any Canvas that runs the WebGPU renderer

Three consequences:
1. The "shared uniform registry across canvases" holds **only for canvases that share a renderer** (primary plus secondaries).
2. It works on `WebGPURenderer`'s WebGL2 backend as well, because that is still "the WebGPU renderer". `useRenderPipeline` throws only under the legacy `WebGLRenderer` (docs `webgpu/render-pipeline.mdx`, "Error Handling").
3. The stores are **primary-canvas scoped, not per-root**. A component rendered once per canvas must use a distinct scope per canvas, "or the second silently reuses the first's buffers" (react-three-examples `AGENTS.md:409-413`).

### 1.1 `useUniforms` / `useUniform`: one "mood bus" for everything

**API** (verbatim, docs `webgpu/tsl-hooks.mdx`, v10 @14007b4):

```tsx
// Create/update uniforms at root level
const uniforms = useUniforms({ uTime: 0, uColor: '#ff0000' })

// Create/update uniforms in a scope
const uniforms = useUniforms({ uHealth: 100 }, 'player')

// Function syntax for RootState access
const uniforms = useUniforms((state) => ({
  uAspect: state.size.width / state.size.height,
}))

// Read all uniforms / read a scope
const all = useUniforms()
const playerUniforms = useUniforms('player')
```

**Typed app-wide registry**, new in canary / alpha.6 (verbatim, docs `webgpu/typed-uniforms.mdx`):

```ts
// uniforms.ts
import { Color } from 'three/webgpu'
import { configureTSL } from '@react-three/tsl'

export const globalUniforms = { uTime: 0, uColor: new Color('hotpink') }
export const playerUniforms = { uHealth: 1, uTint: new Color('white') }

declare module '@react-three/tsl' {
  interface Register {
    uniforms: typeof globalUniforms
    scopes: { player: typeof playerUniforms }
  }
}

// Create them up front, so the registered types hold before the first frame
configureTSL({ uniforms: globalUniforms, scopes: { player: playerUniforms } })
```

**Two traps from `react-three-examples/AGENTS.md:422-435`.** These cost the porting agents real time:
- "**`useUniforms` takes VALUES, not nodes.** Passing a TSL node (`useUniforms({ tint: color('#f00') })`) throws `Uniform node not implemented` at shader-build time."
- "**A uniform the FRAME LOOP owns must not be a `useUniforms` input.** `useUniforms` reconciles on every React re-render … a value your `useFrame` advances gets SNAPPED BACK the next time anything re-renders the component … For frame-driven state, create a plain three/tsl `uniform()` inside `useNodes`."

**What it unlocks for Lupi.** A single typed `mood` scope read by atoms, bonds, background, particles, bloom strength and DOF. This is how Lupi's `studio`, `paper`, `editorial`, `cinematic` and `diagram` looks could stop being material swaps and become uniform tweens that animate with no shader recompiles. Today "Looks, Remix and camera presets snap instantly" (fact sheet 34).

(sketch) The mood bus, created up front, only ever *read* by components and written by the frame loop, so it avoids the snap-back trap:

```ts
// lupi/tsl/mood.ts  (sketch, untested)
import { Color, Vector2, Vector3 } from 'three/webgpu'
import { configureTSL } from '@react-three/tsl'

export const mood = {
  uEnergy: 0,                             // 0 calm … 1 excited → jiggle amp, bloom, particle speed
  uWarmth: 0.5,                           // palette temperature shift
  uPulse: 0,                              // one-shot tap/success envelope, decays in useFrame
  uTilt: new Vector2(),                   // DeviceMotion gravity (gesture-gated permission)
  uPointer: new Vector3(0, 1e6, 0),       // world-space finger; parked far away when idle
  uLookMix: 0,                            // 0..1 cross-fade between two looks
}
declare module '@react-three/tsl' {
  interface Register { scopes: { mood: typeof mood } }
}
configureTSL({ scopes: { mood } })
```

```tsx
// any material (sketch)
const m = useUniforms('mood')             // read mode: typed, never reconciled
const { colorNode } = useLocalNodes(() => ({
  colorNode: paletteColor.mul(mix(COOL, WARM, m.uWarmth)).add(paletteColor.mul(m.uPulse.mul(0.4))),
}))

// the only writer (sketch): decay the tap pulse and mirror to CSS at 30 fps for DOM chrome
useFrame(({ uniforms, delta }) => {
  const u = uniforms.mood
  u.uPulse.value = Math.max(0, u.uPulse.value - delta * 2.5)
}, { id: 'mood', phase: 'update' })
useFrame(({ uniforms }) => {
  document.documentElement.style.setProperty('--lupi-energy', String(uniforms.mood.uEnergy.value))
}, { phase: 'finish', fps: 30 })
```

- **Does `configureTSL` plus read-only use avoid reconciliation?** I believe so from the docs' wording, since "uniforms that already exist are never replaced". This is (inference); verify.
- **Fallback:** `[GPU+GL2]`.
- **Phone:** free. Uniform writes are tiny.

### 1.2 `useNodes` / `useLocalNodes`: shared shader functions

Verbatim from the docs:

```tsx
// Define shared nodes once, usually near the root
function GlobalNodes() {
  useNodes(() => ({
    wobbleFn: Fn(() => vec3(sin(time), cos(time.mul(1.3)), sin(time.mul(2)))),
  }))
  return null
}

function WobblyMesh() {
  const { colorNode } = useLocalNodes(({ nodes }) => ({
    colorNode: nodes.wobbleFn.mul(0.5).add(0.5),
  }))
  …
}
```

**Rules that matter** (docs, "Build-Time vs Run-Time"):
- A JavaScript `if` runs once at graph build. Use TSL `If()`, `select()` and `Loop()` for anything that must react to a uniform.
- `useLocalNodes` rebuilds only when uniforms, nodes or textures are *added or removed*, never on value changes.

**What it unlocks**
- One library of Lupi TSL building blocks shared by every surface:
  - element palette lookup (the existing 256-entry textures)
  - sphere-impostor depth
  - fresnel rim
  - curl noise
  - "illustrative" dither overlay
- Uniform-driven GPU branching makes "look" variants a `select()` on `uLookMix` instead of separate materials.
- Fast refresh rebuilds nodes, uniforms, buffers and storage atomically (alpha.4 release notes), so look-development in dev keeps state.

**Fallback:** `[GPU+GL2]`, except nodes that use storage textures, atomics or workgroup memory.

### 1.3 `useBuffers` / `useGPUStorage` + `instancedArray` → `positionNode`: GPU-resident atoms

**API** (verbatim, docs `webgpu/compute.mdx`). The docs warn: "**Experimental.** … APIs may change between releases. Pin your version and expect churn."

```tsx
const { positions, velocities } = useBuffers(
  () => ({
    positions: instancedArray(PARTICLE_COUNT, 'vec3'),
    velocities: instancedArray(PARTICLE_COUNT, 'vec3'),
  }),
  'particles',
)
…
const { positionNode } = useLocalNodes(({ buffers }) => ({
  positionNode: buffers.particles.positions.element(instanceIndex),
}))

return (
  <instancedMesh args={[undefined, undefined, PARTICLE_COUNT]}>
    <sphereGeometry args={[0.1, 8, 8]} />
    <meshBasicNodeMaterial positionNode={positionNode} />
  </instancedMesh>
)
```

`instancedArray` also accepts a typed array: "It is also valid to pass a typed array as an argument" (`three.webgpu.js:40769-40773`, 0.186.1). So Lupi's existing `Float32Array` of source positions can be uploaded once with no conversion.

**The production template** is `compute-particles` from react-three-examples: 200k particles and all three dispatch cadences. Verbatim excerpt, `src/examples/compute/compute-particles/Particles.tsx`:

```tsx
const { particlePositions, particleVelocities, particleColors } = useBuffers(
  () => ({
    particlePositions: instancedArray(PARTICLE_COUNT, 'vec3'),
    particleVelocities: instancedArray(PARTICLE_COUNT, 'vec3'),
    particleColors: instancedArray(PARTICLE_COUNT, 'vec3'),
  }),
  'computeParticles',
);
…
      // (3) Hit kernel: apply a randomized radial impulse from the pointer.
      const computeHit = Fn(() => {
        const position = particlePositions.element(instanceIndex);
        const velocity = particleVelocities.element(instanceIndex);
        const dist = position.distance(uClickPos);
        const direction = position.sub(uClickPos).normalize();
        const distArea = float(3).sub(dist).max(0);
        const power = distArea.mul(0.01);
        const relativePower = power.mul(hash(instanceIndex).mul(1.5).add(0.5));

        velocity.addAssign(direction.mul(relativePower));
      })().compute(PARTICLE_COUNT);
…
  // ONCE: seed the buffers after commit. StrictMode may run this effect twice,
  // but the kernel is idempotent.
  useEffect(() => {
    renderer.compute(computeInit);
  }, [renderer, computeInit]);

  // EVERY FRAME: step the simulation before the default render phase draws it.
  useFrame(
    () => {
      renderer.compute(computeUpdate);
    },
    { phase: 'update' },
  );

  // ON DEMAND: ripple away from the pointer. `event.point` is the world-space
  // plane intersection — R3F already did the raycast.
  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (event.buttons !== 0) return;
    uClickPos.value.copy(event.point);
    uClickPos.value.y = -1; // push from below the floor so particles pop upward
    renderer.compute(computeHit);
  };
…
      <sprite count={PARTICLE_COUNT} frustumCulled={false}>
        <spriteNodeMaterial
          positionNode={spritePositionNode}
          …
```

**What becomes cheap for Lupi: "display offsets" on 100k+ atoms.** Today, any per-atom motion beyond the trajectory lerp is a CPU upload. `GhostAtoms`, GPU Studio and `AtomsTransmission` use the slow Object3D-dummy `setMatrixAt` pattern (fact sheet 35). With GPU buffers, source positions upload **once**. Every playful motion then lives in an `offset` buffer that only compute writes and only `positionNode` reads. This honours Lupi's existing rule: "Display-only inertia. Source atoms never move" (fact sheet 39).

(sketch) A Lupi atom-play module. It is untested and uses API shapes from the docs and examples above:

```tsx
// sketch: display-only offsets layered on the existing trajectory lerp
function useAtomPlay(sourceXYZ: Float32Array, targetXYZ: Float32Array, count: number, scope: string) {
  const renderer = useThree((s) => s.renderer)
  // camelCase scope, no dots/dashes: see the WGSL-identifier caveat below
  const { atomBase, atomTarget, atomOffset, atomVel } = useBuffers(() => ({
    atomBase: instancedArray(sourceXYZ, 'vec3'),   // uploaded once; play never writes it
    atomTarget: instancedArray(targetXYZ, 'vec3'), // next trajectory frame (existing uProgress lerp)
    atomOffset: instancedArray(count, 'vec3'),     // DISPLAY-ONLY displacement
    atomVel: instancedArray(count, 'vec3'),
  }), scope)

  const k = useNodes(() => {
    // frame/event-owned → plain uniform() inside useNodes (never useUniforms inputs)
    const uPoke = uniform(new Vector3(0, 1e6, 0)), uPokeGain = uniform(0)
    const uDt = uniform(1 / 120), uK = uniform(90), uC = uniform(12), uJiggle = uniform(0)
    const uProgress = uniform(0)
    const center = Fn(() => mix(atomBase.element(instanceIndex), atomTarget.element(instanceIndex), uProgress))
    const step = Fn(() => {
      const o = atomOffset.element(instanceIndex), v = atomVel.element(instanceIndex)
      const p = center().add(o)
      const d = p.sub(uPoke)
      const fall = float(1).sub(d.length().div(4)).max(0).pow(2)          // finger falloff (Å)
      v.addAssign(d.normalize().mul(fall.mul(uPokeGain)))                  // poke impulse
      v.addAssign(mx_noise_vec3(p.mul(0.7).add(time)).mul(uJiggle))        // illustrative thermal wiggle
      v.addAssign(o.mul(uK.negate()).sub(v.mul(uC)).mul(uDt))              // damped spring back to 0
      o.addAssign(v.mul(uDt))
    })().compute(count)
    return { step, uPoke, uPokeGain, uDt, uK, uC, uJiggle, uProgress,
             centerNode: center().add(atomOffset.element(instanceIndex)) }  // → impostor positionNode
  }, scope)
  return k
}
```

**Morph and "explode and reassemble" on molecule switch** (sketch in prose).
- Keep a `from` buffer and a `to` buffer.
- A kernel moves each atom along a ballistic arc from `from` to `to`, with per-atom delay `hash(instanceIndex)`.
- Atom counts rarely match. Extras spawn from, or collapse into, the centroid of the nearer molecule.
- This replaces "Looks and Remix snap instantly" with a 600 ms choreographed transition, and costs one dispatch per frame.

**Bonds.**
- Lupi's bond impostors carry baked endpoint positions (`instanceStart`/`instanceEnd`, `packages/scene/src/Bonds.tsx:725-730`). The atom pair indices exist only on the CPU (`Bonds.tsx:125-127`).
- For bonds to stay attached while atoms jiggle, the TSL bond port needs a per-instance `uvec2` pair attribute and must read `atomOffset.element(pair.x)` and `atomOffset.element(pair.y)` (inference). The cheap alternative is to fade bonds out during play.

**Other compute hooks worth knowing** (all verified in the react-three-examples corpus or three source):
- **`NodeMaterial.geometryNode`, auto-dispatched compute** (`compute-geometry` header): "Assigning a `ComputeNode` to it makes the renderer auto-dispatch that compute before every draw of the object … zero `useFrame`." This fits demand rendering well: the jiggle simulation advances only on frames that actually draw.
- **`ComputeNode.onInit(({ renderer }) => …)`** (`compute-points` header): a seeding kernel that runs once before the first dispatch, so no separate effect is needed.
- **`renderer.compileComputeAsync(nodes, onProgress)`** (r186; `three.webgpu.js:62776`) pre-builds compute pipelines, avoiding "shader compilation stutter" on the first poke. Pair it with `compileAsync` for materials.
- **`renderer.computeAsync()` only awaits `init()`** and then calls `compute()` (`three.webgpu.js:64653-64657`). It does **not** wait for GPU completion. Use `getArrayBufferAsync` when you actually need results.
- **`positionPrevious` is exported from `three/tsl`** in 0.186.1. `VelocityNode` builds previous clip positions from it (`three.webgpu.js:15593,41736`). A compute-driven offset that also stores `prevOffset` can feed correct motion vectors to TRAA, motion blur or the temporal upscaler (inference; **UNVERIFIED**). Without this, jiggling atoms will ghost under TRAA.

**Cost model** (inference; not measured on devices)
- **Simulation.** One thread per atom, about 10 ALU ops plus 4 storage reads and writes. 1M particles in the Hokusai installation and 200k–300k in three's examples are routine on desktop ([TJS] §2).
- **Phones.** Fill and overdraw limit you, not simulation. An iPhone 12 Pro Max ran at 60→20 fps depending on view angle in three issue #30344.
- **Budgets.**
  - Sized sprites or impostors must be instanced quads, because WebGPU points are 1 px.
  - Keep Lupi's DPR caps.
  - Upscale (§5.9).
- **Memory.** 3 × vec3 buffers × 1M atoms ≈ 36–48 MB (three pads `vec3` storage; exact stride UNVERIFIED). That is fine up to the 128 MiB default binding limit ([TJS] §3). Large scenes need chunking, which Lupi's brick design already does.

**Caveats**
- **Scoped-buffer naming conflicts inside the corpus.** `AGENTS.md:408` says "Scoped stores are safe (alpha.4 sanitises names into valid WGSL identifiers)". But `compute-birds/Birds.tsx:81-85` says a scoped `useBuffers` puts a dot into the WGSL struct name, which is a "runtime shader compile error (fiber bug, UPSTREAM.md B16)", and uses root keys instead. Use camelCase scope names with no dots or dashes (`Birds.tsx:72`: "WGSL-identifier rule: camelCase scope, never kebab-case") until this is checked.
- **StrictMode and GPU-bound objects.** "lazy `useState` is not enough for anything the GPU binds … Put those in `useBuffers`" (`AGENTS.md:630-640`).
- **Silent black-screen failure.** "If a compute example is black in dev but fine in `pnpm build`, look here first": two coexisting kernel and storage sets under StrictMode (`AGENTS.md:620-629`).
- **WebGL2 fallback.** Compute runs through transform feedback. Random-access storage reads in the vertex or fragment stage become "PBO" data textures (`GLSLNodeBuilder.setupPBO`, `three.webgpu.js:67320-67387`; `compute-birds` notes "`setPBO(true)` calls … are a WebGL2-fallback affordance").
  - So the poke, spring and jiggle kernel above is expected to run on the fallback (inference).
  - Atomics, workgroup memory, barriers, storage textures and indirect dispatch do not.
  - Expect lower counts.

### 1.4 Compute dispatch patterns in v10

The house rule from react-three-examples (verbatim, `AGENTS.md:515-525`):

> Kernels are `Fn(() => …)().compute(count)` built once in `useNodes`; storage lives in `useBuffers` (`instancedArray`) / `useGPUStorage` (`StorageTexture`). fiber has no dispatch hook — dispatch via `renderer.compute()` at three cadences:
> - **once** in a `useEffect` (safe: fiber awaits `renderer.init()` before children render; StrictMode double-runs it, so the kernel must be idempotent)
> - **per frame** in `useFrame({ phase: 'update' })` — compute is not a render takeover, never `phase: 'render'`
> - **on demand** from event handlers (pointer → `uniform(Vector3)` → dispatch)

Additions for Lupi:
- **Fixed-step simulation.** Dispatch *N* times inside a `phase: 'physics'` job with an accumulator (§2.4). `@pmndrs/scheduler` 0.2.0 has no fixed step; `fps` + `drop:false` only aligns timestamps (fact sheet 16).
- **Implicit dispatch.** Use `geometryNode` for "simulate only when drawn" (§1.3).
- **Never `await` inside a `phase: 'render'` callback** (`AGENTS.md:377-381`). Kick async readbacks off as a throttled promise, as in `multiple-rendertargets-readback`.

### 1.5 `useRenderPipeline` + MRT: the WebGPU replacement for Lupi's EffectComposer

**API** (verbatim, docs `webgpu/render-pipeline.mdx`):

```tsx
useRenderPipeline(
  // mainCB - configure effect (MRT already set)
  ({ renderPipeline, passes }) => {
    const beauty = passes.scenePass.getTextureNode()
    const vel = passes.scenePass.getTextureNode('velocity')
    renderPipeline.outputNode = motionBlur(beauty, vel.mul(1.0))
  },
  // setupCB - configure MRT BEFORE mainCB runs
  ({ passes }) => {
    passes.scenePass.setMRT(mrt({ output, velocity }))
  },
)
```

Rules from the docs:
- "**One `useRenderPipeline` per app**, near the root."
- "Callbacks do **not** re-run on … HMR." Call `rebuild()`.
- "drive dynamic parameters through uniforms rather than closure values."

The corpus adds (`AGENTS.md:527-595`):
- **Pattern (b).** Construct with defaults, then assign your uniform onto the pass's field: `bloomPass.strength = uniforms.strength`. "**Never pass your uniform as a factory _argument_**", because `dotScreen()` and `rgbShift()` re-wrap it and silently drop writes.
- **Samples.** "TRAA, `ssaaPass`, and anything copying depth need single-sampled targets (`passes.scenePass.options.samples = 0`)." Fiber defaults to MSAA 4×.

**Selective bloom per object via `mrtNode`** (verbatim, `postprocessing/postprocessing-bloom-selective.tsx:54,105-121`):

```tsx
<meshBasicNodeMaterial color={sphere.color} mrtNode={mrt({ bloomIntensity: sphere.uBloomIntensity })} />
…
useRenderPipeline(
  ({ renderPipeline, passes }) => {
    const outputPass = passes.scenePass.getTextureNode();
    const bloomIntensityPass = passes.scenePass.getTextureNode('bloomIntensity');
    const bloomPass = bloom(outputPass.mul(bloomIntensityPass));
    bloomPass.threshold = uniforms.threshold;
    bloomPass.strength = uniforms.strength;
    bloomPass.radius = uniforms.radius;
    renderPipeline.outputColorTransform = false;
    renderPipeline.outputNode = outputPass.add(bloomPass).renderOutput();
  },
  ({ passes }) => {
    passes.scenePass.setMRT(mrt({ output, bloomIntensity: float(0) }));
  },
);
```

Lupi mapping (inference): add a "glow" channel to the existing 256-entry palette texture. Then the atom impostor's `mrtNode = mrt({ bloomIntensity: paletteGlow.add(isHovered).add(m.uPulse) })`. Result: glowing metals, a hovered atom, and the success pulse, all as one texture write or one uniform.

**Hover outline without duplicate meshes** (verbatim, `postprocessing-outline/OutlinePipeline.tsx:48-54`):

```tsx
// The outline node re-reads `selectedObjects` every frame — the pointer handler
// mutates the same array instance, so hover changes need no pipeline touch.
const outlinePass = outline(scene, camera, {
  selectedObjects: selectionRef.current,
  edgeGlow: uEdgeGlow,
  edgeThickness: uEdgeThickness,
});
```

- `outline()` works on **objects**. For a single atom inside one instanced impostor mesh, use the bloom-mask approach or a stencil or ID MRT (inference).
- drei's `Outlines` is broken on WebGPU (drei 11 status "todo", issues #2813 and #2818). Use this node instead.

**TRAA** (verbatim, `postprocessing/postprocessing-traa.tsx:81-95`). This gives clean impostor silhouettes without MSAA; the main viewer runs `antialias:false` today:

```tsx
useRenderPipeline(
  ({ renderPipeline, passes, camera }) => {
    const scenePassColor = passes.scenePass.getTextureNode();
    const scenePassDepth = passes.scenePass.getTextureNode('depth');
    const scenePassVelocity = passes.scenePass.getTextureNode('velocity');
    renderPipeline.outputNode = traa(scenePassColor, scenePassDepth, scenePassVelocity, camera);
  },
  ({ passes }) => {
    passes.scenePass.options.samples = 0;
    passes.scenePass.setMRT(mrt({ output, velocity }));
  },
);
```

**AO** (verbatim from three r186 `webgpu_postprocessing_ao.html:170-179`). It switches between GTAO, which "needs temporal denoise", and the new, cheaper, self-denoised SSAO:

```js
aoPass = ( params.aoType === 'SSAO' )
	? ssao( prePassDepth, prePassNormal, camera ).toInspector( 'SSAO', ( inspectNode ) => inspectNode.r )
	: ao( prePassDepth, prePassNormal, camera ).toInspector( 'GTAO', ( inspectNode ) => inspectNode.r );
…
scenePass.contextNode = builtinAOContext( aoPass.getTextureNode().sample( screenUV ).r );
```

The R3F port builds the prepass with `prePass.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }))` (`postprocessing-ao/AOPipeline.tsx:49-59`).

For impostors (inference), `normalView` would be the **quad** normal. The TSL impostor must supply the sphere normal (via `normalNode`, or by writing the MRT normal explicitly) and correct depth (`depthNode`), or AO and SSGI will shade flat cards.

**Other post nodes that turn into toys.** 48 files ship in `three/addons/tsl/display/` in 0.186.1 ([TJS] §4). Each is one fullscreen pass, and most are phone-affordable:
- `transition(passA, passB, wipeTex, ratio, threshold, useTexture)`: dissolve between the old and new molecule scenes (`postprocessing-transition`).
- `afterImage`: comet trails for trajectory playback and flicks.
- `motionBlur(beauty, velocity)`: fast spins.
- `sobel` or `packNormalToRGB` edge detection: a "blueprint" look for the `diagram` preset.
- `retroPass`, `pixelationPass`, CRT `scanlines`, `bayerDither`, halftone (`tsl-halftone`), `lut3D`, `chromaticAberration`, film grain: Remix skins.
- `godrays`: a "sunlight through the crystal" hero shot.
- `dof(color, viewZ, focus, focalLength, bokeh)` plus tap-to-focus. The WebGL-only `useDepthPicking` has no v10 twin (UNVERIFIED). On WebGPU, a 1-pixel async depth readback is the pattern (`interactive-cubes-gpu`).

**Mapping from today's stack** ([TJS] §4):

| Today | v10 replacement |
|---|---|
| N8AO | `ssao()` (phones and default) or `ao()` + TRAA (desktop) |
| Bloom | `bloom()` with the `mrtNode` mask |
| DepthOfField | `dof()` |
| ToneMapping | `renderer.toneMapping`. AgX and Neutral are available. Beware fiber's ACES default (`AGENTS.md` "Tone-mapping parity trap"). |
| Vignette | CRT `vignette` |

**Fallback.**
- Fullscreen-fragment nodes transpile to GLSL `[GPU+GL2]`.
- `OITPassNode`: "MSAA is only supported with the WebGPU backend".
- `FSR1Node`: on WebGL2, `textureGather` falls back to a GLSL polyfill (`three.webgpu.js:66952`), so there is no speed-up.
- Node-by-node fallback correctness is UNVERIFIED ([TJS] §4).

---

## 2. The scheduler: one loop for everything, and a quiet idle

**Verbatim API** (docs `frame-loop.mdx`, v10 @14007b4):

```tsx
function GameLoop() {
  const { scheduler } = useThree()

  useEffect(() => {
    scheduler.addPhase('ai', { after: 'physics', before: 'update' })
  }, [scheduler])

  // Input first
  useFrame(processInput, { phase: 'input', id: 'input-handler' })

  // Physics at 60fps with catch-up timing
  useFrame(() => physicsWorld.step(1 / 60), { phase: 'physics', fps: 60, drop: false })

  // AI at 20fps, dropping missed intervals
  useFrame(aiSystemUpdate, { phase: 'ai', fps: 20, drop: true })

  // Game state every frame
  useFrame(updateGameState, { phase: 'update', id: 'game-state' })

  // VFX after game state
  useFrame(updateVFX, { after: 'game-state' })

  // HUD overlay after the default render (does not take over rendering)
  useFrame(
    ({ gl }) => {
      gl.autoClear = false
      gl.render(hudScene, hudCamera)
      gl.autoClear = true
    },
    { after: 'render' },
  )

  // Stats last
  useFrame(collectStats, { phase: 'finish' })

  return null
}
```

**Facts that shape design** (all from `frame-loop.mdx` unless noted):
- **One global RAF.** "A single global singleton `Scheduler` drives one `requestAnimationFrame` loop for the **entire application**." It is a cross-bundle singleton via `Symbol.for` and survives HMR.
- **`fps` throttles, it does not sub-step.** "A throttled job runs **at most once per RAF** … It never invokes the callback multiple times in a single frame to 'catch up.'"
- **Render takeover is dynamic.** "When you register **any** `useFrame` job in the `render` phase, the default render is automatically skipped … when your render job unmounts the default render **resumes automatically**."
- **Per-root frameloop.** "The Canvas `frameloop` prop controls that Canvas's scheduler root. Every Canvas keeps its own mode and pending-frame count while sharing one RAF driver." `invalidate()` pending frames are "capped at 60".
- **`onIdle`.** "`onIdle` and `addTail` callbacks fire when the shared driver has no automatic work left. An `always` root keeps the driver active even when every demand root is idle."
- **Outside Canvas.** "`useFrame` does not throw when used outside `<Canvas>` … lazily creates an internal **ambient root** … If a `<Canvas>` mounts later, it **adopts** those jobs."
- **`maxDelta`** caps catch-up after sleep; by default "a root that slept resumes where it left off" ([R3F] §2.1).
- **`useFrame` returns controls.** `pause()`, `resume()`, reactive `isPaused`, `step()`, `stepAll()`, `invalidate()`. `scheduler.pauseJob(id)` works from anywhere.

### 2.1 What it unlocks for Lupi

**One loop instead of five.** Playback, press springs and the vgpu effects each run their own RAF loop today (fact sheet 35), and so do GPU Studio's `requestDraw` (`packages/ui/src/gpu-studio/runtime.ts:124`) and the gist and scan particles. Under v10 all of them become jobs.

Proposed phase map (sketch):

| Phase | Lupi jobs |
|---|---|
| `start` | Canvas-target switch (automatic), `configureTSL` warm-up |
| `input` | Pointer flush (`frameTimedRaycasts`), tilt and DeviceMotion → `mood.uTilt`, `AtomPicker` ray-march (throttled here instead of per `mousemove`) |
| `physics` | Fixed-step accumulator dispatching atom-play kernels (§2.4); trajectory `effectiveFrame` advance |
| `update` | Camera focus springs (`math/time`), `uProgress`, `mood` envelopes, compute for particles and gist |
| `labels` (custom, `after: 'update'`) | `KnowledgeLabelsLayer` / `AnnotationsLayer` at `fps: 20` |
| `render` | Default render, or `useRenderPipeline`. Export takeover as `{ phase: 'render' }`, replacing `ExportManager.tsx:180`'s `}, 2); // Priority 2 execution!` and the `-0.5`/`100` priorities at `:349,:449`. |
| `finish` | Perf HUD, DOM CSS-variable mirror (`fps: 30`), analytics sampling |

**A battery-friendly idle.**
- Today the viewer renders every frame even when idle: `frameloop={paused ? 'never' : 'always'}` at `packages/ui/src/viewer/ViewerCanvas.tsx:67`.
- In v10, run `frameloop="demand"`. `invalidate()` comes from controls, springs, playback and uniform tweens, and `invalidate(n)` keeps a fixed number of frames alive for decays.
- Because each Canvas owns its loop, a 30 fps HUD or thumbnail canvas cannot keep the main one awake (alpha.4 notes).
- With GPU-side simulations, CPU code can't cheaply know when springs have settled. So invalidate for an **analytic settle time**, t ≈ 5/damping seconds after the last impulse, instead of reading back (inference). On WebGPU, a `compute-reduce` style max-energy readback is an option.

**Attract mode.** `scheduler.onIdle(cb)` fires when the demand loop goes idle. After N idle seconds, start a slow orbit or a "breathing" glow as one `always` job. The first pointer event cancels it. Honour reduced motion: show a still frame instead of a loop (fact sheet 39).

**DOM effects on the same clock.** `useFrame` outside `<Canvas>` (the ambient root) can drive `SwitchStage`'s particle "candy", the action-light buttons, and CSS meters from the same RAF. The landing page has zero canvases (fact sheet 38), and the ambient root adds no canvas, so this is compatible (inference).

**Deterministic capture.** `frameloop="never"` + `advance(timestamp)` / `scheduler.stepRoot(id, t)` + fixed `width`/`height` (§4.6) gives frame-exact "breathing molecule" loops for sharing.

### 2.2 Per-job fps caps

| Job | Cap | Why |
|---|---|---|
| Labels / annotations | 20–30 | They re-render about 20×/s idle today (fact sheet 35) |
| Thumbnails (secondary canvases) | 15–30 via `renderer={{ scheduler: { fps } }}` | Throttles only that canvas's default render job (`frame-loop.mdx`, "Ordering Canvas roots") |
| Gist and swirl DOM particles | 30 | Decorative |
| Camera, render, poke simulation | display rate | Feel-critical |

Also: iOS Low Power Mode caps rAF at 30 fps (fact sheet 40). Design springs with frame-rate-independent math such as `math/time`.

### 2.3 What the scheduler does not do

- There is no fixed timestep (fact sheet 16, corrected).
- Numeric priority is a "v9 shim". `useFrame(cb, n>0)` still means takeover, with a deprecation warning.
- Jobs are ordered per root. Cross-canvas order uses `renderer.scheduler.{before, after, order}`.

### 2.4 A fixed-step toy-physics accumulator (sketch)

```tsx
const STEP = 1 / 120
const acc = useRef(0)
useFrame(({ delta }) => {
  acc.current = Math.min(acc.current + delta, 0.1)       // clamp: no spiral of death after a tab sleep
  let n = 0
  while (acc.current >= STEP && n < 4) {                 // ≤4 substeps/frame on phones
    renderer.compute(k.step)                             // k from useAtomPlay (§1.3), uDt = STEP
    acc.current -= STEP; n++
  }
  k.uPokeGain.value = 0                                  // impulses are one-shot; set by the pointer handler
}, { id: 'atomPlay', phase: 'physics' })
```

`maxDelta` already bounds `delta` after sleeps. The clamp is belt-and-braces.

---

## 3. Multi-canvas with one shared renderer: live 3D everywhere

**API** (verbatim, docs `webgpu/multi-canvas.mdx`):

```tsx
<Canvas id="main" renderer>
  <Scene />
</Canvas>

<Canvas renderer={{ primaryCanvas: 'main', scheduler: { after: 'main', fps: 30 } }}>
  <SecondaryScene />
</Canvas>
```

> Each canvas maintains its own scene graph and camera, event handling, and state (its own Zustand store). Secondary canvases share the `WebGPURenderer` instance and its GPU resources/context. … TSL resources (uniforms, nodes, buffers, GPU storage) are shared automatically … R3F automatically manages `CanvasTarget` switching across canvases.

The **HUD / picture-in-picture pattern** draws the primary's scene with another camera (verbatim):

```tsx
useFrame(
  ({ primaryStore, renderer }) => {
    if (!orthoCamera.current) return
    const primaryState = primaryStore.getState()
    renderer.render(primaryState.scene, orthoCamera.current)
  },
  { phase: 'render', after: 'main' },
)
```

**Template.** `scene/multiple-canvas.tsx` in react-three-examples: "Forty small scenes, each its own `<canvas>`, all sharing ONE WebGPU device". Verbatim core:

```tsx
<Canvas
  id={index === 0 ? 'main' : undefined}
  renderer={index === 0 ? true : { primaryCanvas: 'main' }}
  background="#eeeeee"
  camera={{ position: [0, 0, 2], fov: 50, near: 1, far: 10 }}>
```

### 3.1 What it enables for Lupi

- **Live thumbnails in the gallery, switcher and a "molecule wall".**
  - Today these are static images: `gallery/previews.json` (`atomCap: 1200`) and the switcher's `<img src={candidate.image} … loading="lazy">` (`packages/ui/src/switcher/MoleculeSwitcher.tsx:293`).
  - Under v10, the hovered or visible cards swap to a live, slowly turning mini-viewer that reads the same shared atom material and palette. Pipelines are already compiled on the device, so a card goes live without a shader hitch (inference).
- **Picture-in-picture minimap.** The primary's scene through an orthographic top camera, or a zoomed "lens" on the selected atom.
- **Split compare.** "Your molecule vs water", or trajectory frame *t* vs *t+Δ*. Two canvases (or one canvas with `View`), each with its own camera, sharing the mood uniforms so both tween together.
- **Element legend strip.** A real lit atom per element, driven by the same palette texture, with no WebGL context limit to worry about.
- **One device instead of four.** Lupi runs four independent devices today: GPU Studio, action-light, swirl and gist ([R3F] §4). With multi-canvas plus vgpu's `initFromDevice`, they could share the renderer's device (UNVERIFIED end to end, fact sheet open question 8).

### 3.2 Cost model

All of this is (inference) from three and fiber source. **Not measured.**

| Cost | Per secondary canvas | Shared (paid once) |
|---|---|---|
| CPU at mount | A React root, its own zustand store and event manager, `waitForPrimary`, a `CanvasTarget` (`fiber alpha.5 webgpu/index.mjs:14203-14225`) | Renderer init, device |
| GPU memory | A `GPUCanvasContext` configured on the shared device (`three.webgpu.js:87303-87323`): swap-chain textures (about 2–3 × w×h×4 B, browser-managed) + depth (w×h×4 B) + MSAA colour and depth ×samples if `antialias` | Pipelines and shader modules, textures, storage buffers (when shared through the stores) |
| Per frame | One render pass per canvas (plus its own post graph if any; `renderPipeline` is per canvas), draw calls for its scene, one scheduler root | – |

**Worked estimate.**
- Setup: a 160×160 CSS card at DPR 2 is 320×320 = 102k px.
- Without MSAA: about 1.6 MB (3 swap buffers + depth).
- With MSAA 4×: about 4.8 MB.
- 24 live cards: about 40 MB without MSAA, about 115 MB with.
- Draw calls: tiny molecules (≤1.2k atoms) are 2–4 per card. On desktop, the cost is mostly per-pass overhead, trivial at 30 fps.
- On phones, tile-GPU pass load and store and memory pressure dominate, so budget about 6–12 live cards at DPR 1–1.5 with no MSAA.

**Rules**
- **Render only visible cards.** Put each card on `frameloop="demand"` and gate `invalidate` with `onVisible` or an IntersectionObserver. Keep `fps: 15–30`.
- **Fall back to the static preview image** for everything not hovered or in view.
- **The primary must exist before secondaries render** (`waitForPrimary`). The gallery can appear without the viewer mounted. One option is a tiny app-level primary canvas that mounts after the first interaction; the landing page must stay canvas-free. Whether a 1×1 or visually hidden primary works is **UNVERIFIED**.

**Gotchas from the corpus**
- `state.renderer.domElement` is the **primary** canvas on every secondary, so controls must bind to each card's own wrapper div (`multiple-canvas.tsx` header; `AGENTS.md:896-899`).
- Buffers are shared per primary, so give each card its own scope (`AGENTS.md:409-413`).

**WebGL2 fallback: absent** (inference from source).
- Fiber only hard-errors for `primaryCanvas` with the legacy `gl` prop (`dist/index.mjs:14204`).
- But only three's `WebGPUBackend` configures a context per `CanvasTarget` (`three.webgpu.js:87303`). The `WebGLBackend` has a single GL context bound to one canvas.
- The docs say multi-canvas is "WebGPU only".

Fallbacks:
- drei `<View>`: exported from drei 11 `core` and `webgpu`. It scissors many views into one canvas and is renderer-agnostic.
- Keep the static previews.
- Rotate one live card at a time.

---

## 4. Events, visibility, output and core helpers

### 4.1 `onFramed`, `onOccluded`, `onVisible`

Verbatim from docs `scene/visibility.mdx`:

```tsx
<mesh
  onOccluded={(occluded) => {
    console.log(occluded ? 'Object is hidden behind something' : 'Object is visible')
  }}>
```

- These fire on transitions only.
- `onFramed` uses the bounding sphere. With GPU-driven instance positions, set the bounding sphere yourself or set `frustumCulled={false}`. Otherwise three knows nothing about where the instances are (`compute-particles`: "three's culling sphere knows nothing — frustumCulled must be off").
- "When you attach `onOccluded` (or `onVisible`), R3F automatically sets `occlusionTest = true` … adds an invisible internal helper group named `__r3fInternal`". This matters because Lupi code that counts `scene.children` would see it.

**Fallback nuance (inference).**
- Fiber enables occlusion whenever `typeof renderer?.isOccluded === "function"` (`dist/index.mjs:336-344`).
- three's WebGL2 backend implements occlusion queries with `gl.ANY_SAMPLES_PASSED` (`three.webgpu.js:74505-74551`).
- So `onOccluded` likely works on `WebGPURenderer`'s WebGL2 backend too. The docs' "WebGPU only" contrasts it with the legacy `WebGLRenderer`. UNVERIFIED at runtime.

**Toys**
- "Find the buried atom": core atoms chime and glow when rotated into view.
- Pause labels and trails for off-screen annotated atoms.
- Analytics on what users actually look at (PII-free).

Occlusion is per **object**, not per instance, so group atoms into shells or clusters (inference).

### 4.2 Per-pointer state (`pointerMap`): real multi-touch

- The docs say: "In v10 the event system tracks each pointer independently … multi-touch and multiple simultaneous captures are supported" (`API/events.mdx:195`).
- Typings: `pointerMap: Map<number, PointerState>` (`webgpu/index.d.ts:457`).

**Toys**
- Two-finger measure: each finger captures an atom and a live distance label follows.
- "Stretch the bond": the offsets kernel pulls the two captured atoms apart and they spring back on release.

**The catch is gesture arbitration with camera controls.** camera-controls binds DOM listeners and will still orbit. `@react-three/handle` `OrbitHandles` routes through scene events so "grabbing an object doesn't also orbit" ([ECO] §4.5), but its v10 compatibility is **UNVERIFIED**, and `@react-three/xr` "has no v10 branch" (react-three-examples README).

### 4.3 `frameTimedRaycasts` and `updateOnFrame`

Verbatim from `API/events.mdx`:

```tsx
const eventManagerFactory = (state) => ({
  ...events(state),
  // Coalesce pointer-move raycasts to once per frame
  frameTimedRaycasts: true,
  // Whether wheel/scroll events still raycast immediately (default: fire on scroll)
  alwaysFireOnScroll: true,
})
```

- It only takes effect while `frameloop="always"`.
- On 120 Hz touch it removes redundant raycasts.
- `updateOnFrame` re-raycasts when atoms move under a still finger, which matters for jiggle and poke toys (`webgpu/index.d.ts:248-252`).

For 100k+ atoms, Lupi's picking stays custom: the ray-march in `AtomPicker`, or GPU ID picking via `readRenderTargetPixelsAsync` (template `interactive-cubes-gpu`: "a 1x1 pick pass renders the id under the pointer into an integer render target").

### 4.4 `userData.interactivePriority`

Verbatim from `API/events.mdx`:

```jsx
// This handle is hit-tested before anything in front of it
<mesh userData={{ interactivePriority: 10 }} onPointerDown={...} />
```

Measurement handles, the "poke" gizmo and in-scene chips win over atoms, which means fewer mis-taps on phones.

### 4.5 Drag and drop onto 3D objects

Verbatim from `API/events.mdx`:

```jsx
onDrop={(e) => console.log('dropped!', e.nativeEvent.dataTransfer?.files)}
…
<Canvas
  onDragOverMissed={(e) => console.log('Dragging over empty space')}
  onDropMissed={(e) => console.log('Dropped on empty space', e.dataTransfer?.files)}
>
```

**Toys**
- **Desktop:**
  - Drag an element chip (`packages/ui/src/switcher/ElementChips.tsx`) onto an atom: "what if this were O?", as an illustrative recolour or substitution preview.
  - Drop a photo onto the molecule to start `/v1/scan/identify`.
  - Drop an `.xyz` or `.pdb` file onto the canvas.
- **Instanced atoms:** `e.instanceId` identifies the atom under the drop (standard R3F intersection data; inference for impostor meshes, which need a custom `raycast`).

**Phones: unreliable.**
- Search results conflict. One source says Chrome ≥96 on Android ≥7 and iOS ≥15 support drag and drop. Another says "Chrome for Android … do not fire DragEvent from a finger touch" ([testmuai](https://www.testmuai.com/learning-hub/html-drag-and-drop-api-browser-support/), [mobile-drag-drop](https://github.com/timruffles/mobile-drag-drop)). **UNVERIFIED.**
- Plan a pointer-based path: `pointerdown` on the chip → a floating ghost → raycast at `pointerup` through `state.raycaster.setFromCamera(ndc)`. Or "tap chip, then tap atom".

### 4.6 Fixed-size output: share cards and video

Verbatim from `API/canvas.mdx`:

```tsx
// 4K capture (set dpr={1} for exact pixel dimensions)
<Canvas width={3840} height={2160} dpr={1}>
  <Scene />
</Canvas>
```

> `width`/`height` are logical pixels; DPR multiplies as usual. Set `dpr={1}` for exact pixel dimensions. Use `forceEven` to round dimensions down to even numbers for video encoders.

There is also imperative ownership: `setSize(3840, 2160)` … `setSize()` releases back to props.

**What it unlocks**
- **"Make a share card."** An offscreen 1080×1350 secondary canvas, or a `useRenderTarget(1080, 1350)` + `renderer.readRenderTargetPixelsAsync` (`three.webgpu.js:64886`), renders a styled poster with title and element legend without touching the live view.
  - The readback path works on both backends.
  - `preserveDrawingBuffer` has no WebGPU equivalent (fact sheet open question 5).
  - Whether `canvas.toBlob()` on a WebGPU canvas returns the last frame is **UNVERIFIED**.
- **Video.** Today it is `MediaRecorder` at 1080p for 5 s (fact sheet 40). With `frameloop="never"` + `advance(t)` + `forceEven`, each frame can be fed to WebCodecs `new VideoFrame(canvas)` → Mediabunny. `VideoFrame` from a WebGPU canvas on Safari is UNVERIFIED.
- **Export identity.** Moving to `WebGPURenderer` changes the V1 `rendererFingerprint` and `artifactKey` (AGENTS.md "Render artifact V1 truth"). Looks, offsets and post stay non-deterministic "illustrative" layers.

### 4.7 `Environment`, `background`, `useTexture` / `useTextures`, `useRenderTarget` in core

- **`background`** (verbatim, `API/canvas.mdx`): `<Canvas background="sunset" />` / `"#1a1a2e"` / `"/env.hdr"`.
  - The presets fetch HDRs from `https://raw.githack.com/pmndrs/drei-assets/…/hdri/` (`fiber alpha.5 webgpu/index.mjs:1531-1543`). Lupi should self-host, given its "no external textures" rule (fact sheet 39).
- **`useRenderTarget`** returns the right target class for the active renderer (verbatim, `scene/render-targets.mdx`): `const fbo = useRenderTarget(512, 512, { depthBuffer: true, samples: 4 })`. Uses:
  - a "magnifier" lens texture
  - portals
  - a picture-in-picture view on the WebGL2 fallback where multi-canvas is absent
- **`useTextures`** is a ref-counted registry.
- **Camera parenting.** "In v10 R3F calls `scene.add(camera)` when the camera has no parent, so camera children render and follow the camera" (`scene/camera-parenting.mdx`). Uses:
  - a "headlamp" light for flashlight exploration inside big lattices
  - a view-pinned element tile
  - a reticle
  - Caveat: this shifts `scene.children` indices.

---

## 5. three r185 and r186 on `WebGPURenderer`: feature by feature

### 5.1 `GaussianSplat` (r186), including procedural splats

Verbatim header of `examples/jsm/objects/GaussianSplat.js` (r186):

```js
 * Note that this class can only be used with {@link WebGPURenderer}. The
 * `forceWebGL` fallback of {@link WebGPURenderer} is supported, but
 * {@link WebGLRenderer} is not.
 …
 * const splats = new GaussianSplat( geometry );
 * scene.add( splats );
```

- Sorting uses `CountingSort` (`BIN_COUNT = 4096`). On WebGL2 it falls back to `_sortCPU()` (`GaussianSplat.js:412-418`).
- `examples/jsm/utils/GaussianSplatUtils.js:187` exports `createGaussianSplatGeometry( centers, covariances, colors, sphericalHarmonics = {} )`, so **splats can be generated from arrays, not only loaded**.

**Lupi toys**
- `/v1/scan/reconstruct` already returns `lupi.points.v1` coloured points (about 700 kB, AGENTS.md). Render them as soft isotropic splats next to "its" molecules. The photographed thing becomes a fuzzy 3D ghost.
- Soft "aura" splats per atom, illustrative electron fuzz, cheaper than a volume.
- Splat files as backdrops.

**Phones:** moderate counts, with a CPU sort on the WebGL2 fallback.

### 5.2 `OITPassNode` (r186): glass and candy atoms that never pop

Verbatim header of `examples/jsm/tsl/display/OITPassNode.js`:

```js
 * Only transparent materials using `NormalBlending` and no transmission qualify
 * for OIT. All other objects are rendered as usual.
 *
 * MSAA is only supported with the WebGPU backend.
 …
 * const renderPipeline = new THREE.RenderPipeline( renderer );
 * renderPipeline.outputNode = oitPass( scene, camera );
```

The example (`webgpu_oit.html:147-151,167-168`) toggles `renderPipeline.outputNode = ( value === true ) ? scenePassOIT : scenePass; renderPipeline.needsUpdate = true;`.

**Lupi toys**
- A "candy" or "glass" atom skin: translucent, coloured atoms whose overlaps blend correctly at any rotation.
- A translucent filter shell (`MoleculeFilterShell.tsx`) that no longer sorts wrong.
- A "ghost previous frame" overlay.

**Limits**
- `transmission` is excluded (drei `MeshTransmissionMaterial` stays separate).
- Transparent fragments contribute no custom MRT outputs, so glass atoms won't bloom through the `mrtNode` mask (inference).

**Fallback:** `[GL2-degraded]`, no MSAA (`OITPassNode.js:225-229`).

### 5.3 `SSAONode` (r186) vs GTAO

- `ssao()` is "self-denoised so it can skip TRAA and use MSAA for edge anti-aliasing" (`webgpu_postprocessing_ao.html:156`). The default `resolutionScale` is 0.5 ([TJS] §4).
- This is the realistic phone AO. Lupi disables AO on mobile today (fact sheet 33).
- GTAO plus TRAA stays the desktop quality path.
- Both need correct impostor depth and normals (§1.5).

### 5.4 SSGI and VXGI (r186)

- **SSGI** is "literally interactive spheres" in `webgpu_postprocessing_ssgi_ballpool`. It makes a molecule look like a physical toy with colour bleed between neighbouring atoms. Desktop only. It needs a velocity MRT and TRAA ([TJS] §4).
- **VXGI** needs WebGPU: the example checks `WebGPU.isAvailable()`, and `VXGIVolume.js` uses `Storage3DTexture` + `atomicOr`. It has a caveat: "objects should stay static, because geometry changes require a re-voxelization … too expensive for per-frame animation" (`VXGINode.js` header).
  - That fits a static molecule "beauty shot" mode.
  - Impostor quads would voxelize as quads, so VXGI needs a proxy-sphere layer (inference).

### 5.5 `SunLight` with cascaded shadow maps (r186)

Verbatim, `examples/jsm/lights/SunLight.js`:

```js
 * When used with `WebGPURenderer`, the light must be registered with the
 * renderer's node library first:
 * renderer.library.addLight( SunLightNode, SunLight );
```

- Use: crisp contact shadows across very large lattices on a floor, for the big-scene and billion-atom pages.
- Low fun value per unit of effort.
- `PCFSoftShadowMap` was removed in r186 ([TJS] §1).

### 5.6 `ClusteredLighting` (r185): is every atom a light?

Verbatim, `examples/jsm/lighting/ClusteredLighting.js`:

```js
 * const lighting = new ClusteredLighting();
 * renderer.lighting = lighting; // set lighting system
 …
	constructor( maxLights = 1024, tileSize = 32, zSlices = 24, maxLightsPerCluster = 64 ) {
```

- The R3F port installs it in `onCreated`: "It has to be in place before the FIRST render list is built" (`lights-clustered.tsx` header). The corpus also shows it installed from the renderer factory (`AGENTS.md:640-645`).
- **Answer: every atom a light only for small molecules or chosen subsets** (≤1024 real `PointLight` objects, each a CPU `Object3D`).
- "Firefly mode": selected, hovered and one chosen element emit light onto neighbours. Combine with emissive + bloom for the rest.
- The example gates on WebGPU and `ClusteredLightsNode` dispatches compute, so treat it as `[GPU]`.

### 5.7 `storageTexture3D` / `Storage3DTexture` (r185): decorative volumes

Verbatim kernel, `webgpu_compute_texture_3d.html` (r186):

```js
const computeCloud = Fn( ( { storageTexture } ) => {
	…
	const noiseCoord = coord3d.mul( scale.div( 1.5 ) ).add( time );
	const noise = mx_noise_vec3( noiseCoord ).toConst( 'noise' );
	const data = noise.mul( d ).mul( d ).toConst( 'data' );
	textureStore( storageTexture, vec3( x, y, z ), vec4( vec3( data.x ), 1.0 ) );
} );

const storageTexture = new THREE.Storage3DTexture( size, size, size );
```

The R3F port (`compute-texture-3d.tsx`) writes it every frame and reads it "the same frame by a fragment-stage raymarcher" via `texture3D(storageTexture, null, 0)` + `RaymarchingBox`.

**Lupi toys**
- An **illustrative** "electron cloud" or "aura": a 64³ field splatted from atom positions and element radii, animated by noise, raymarched as soft fog.
- A "melt" slider that cross-fades ball-and-stick into a blobby iso-surface.
- Label these as decorative. Real densities come from data, not this.

**Fallback: absent** (storage textures). Use a CPU-baked `Data3DTexture` volume (`volume-cloud` pattern) for a static version.

### 5.8 `textureGather`, `CountingSort`, `compileComputeAsync`, atomic workgroup arrays

- **`textureGather`** (r185) has a WebGPU/WebGL side-by-side example: "Left canvas is using WebGPU Backend, right canvas is WebGL Backend" (`webgpu_texturegather.html`). There is a GLSL polyfill (`three.webgpu.js:66952`).
  - Use: cheaper 4-tap reads in custom blur, depth-aware upsampling and PCF.
  - Low direct fun value.
- **`CountingSort`** (r186), verbatim header:

  ```js
   * It is a good fit for
   * approximate ordering of large element counts (hundreds of thousands to millions) …
   * plain JavaScript function can be supplied to {@link CountingSort#computeCPU} for platforms without
   * compute shader support (e.g. the WebGL backend of {@link WebGPURenderer}).
   …
   * const sort = new CountingSort( count, { binCount: 4096 } );
   * sort.setBinNode( () => { … } );
   * sort.compute( renderer );
  ```

  Uses:
  - Back-to-front sorting of soft sprites.
  - **Spatial binning**: bin = cell id → sorted index list → neighbour loops. This is the GPU uniform grid that Particle Life, "sticky atoms", live bond make-and-break, and neighbour glow need.
  - Lupi already runs WGSL bond detection (`packages/scene/src/useBondGpuPipeline.ts:4`). `CountingSort` is the in-three version of that primitive.
- **Atomic workgroup arrays** (r186, `WorkgroupInfoNode.toAtomic()` at `three.webgpu.js:44806`): local histograms and counters in shared memory (Particle Life per-tile binning). `[GPU]`.
- **`compileComputeAsync`** (r186): pre-warm the play kernels at viewer mount so the first poke doesn't stutter.

### 5.9 Upscaling for phones: `fsr1()`, `taau()`, `@pmndrs/upscaler`

three core (verbatim, `upscaling-fsr1.tsx:79-90`):

```tsx
const { renderPipeline, passes } = useRenderPipeline(({ renderPipeline, passes }) => {
  const fsr1Pass = fsr1(passes.scenePass);
  renderPipeline.outputNode = fsr1Pass;
  return { fsr1Pass };
});
…
useEffect(() => {
  passes.scenePass?.setResolutionScale(resolutionScale);
}, [passes, resolutionScale]);
```

`@pmndrs/upscaler` 0.2.0 (verbatim README):

```ts
post.outputNode = upscaleScene(scene, camera, { quality: QualityMode.Quality });
```

> **WebGPU only.** The passes are hand-written WGSL dispatched straight on the renderer's `GPUDevice` — no TSL, no WebGL fallback.

- **Strategy (inference).** On phones, render at 0.6–0.75× with `fsr1()` everywhere (`[GPU+GL2]`). Use the temporal path (TAAU or `@pmndrs/upscaler`) only on WebGPU desktop.
- **Velocity.** Temporal paths need correct velocity from impostors and GPU offsets (§1.3), which is UNVERIFIED.
- **Combine with runtime tiering.** drei 11 `/webgpu` exports `PerformanceMonitor` and `AdaptiveDpr`: downgrade once, never auto-upgrade (vgpu adaptive-quality guidance, [TJS] §3).

### 5.10 `@pmndrs/sky` 0.3.0

Verbatim README:

```jsx
import { Sky } from '@pmndrs/sky/react'
import { AutoHaze } from '@pmndrs/sky/react/auto-haze'
…
<Sky preset="earth" timeOfDay={14.5}>
  <AutoHaze />
</Sky>
```

- Peers: three ≥0.185, fiber ≥10.0.0-alpha.4.
- **Toys:** "molecules in weather", Mars and Titan skins, time-of-day IBL for GPU Studio beauty shots.
- **Caveats:**
  - `sky.attach(scene)` sets `scene.environment` and `scene.background`, which collides with Lupi's background presets.
  - WebGL2-fallback behaviour is **UNVERIFIED**; the docs site returned 503.

### 5.11 `@pmndrs/glyph` 0.1.0: MSDF labels that break into particles

Verbatim README:

```tsx
import { GlyphProvider, Text, TextGroup, useSlug } from '@pmndrs/glyph/react';

useSlug.preload('/fonts/Inter.font.glb');

<GlyphProvider handle="hud" fontFaces={{ Inter: '/fonts/Inter.font.glb' }}>
  <Text font="Inter">Hello, HUD</Text>
</GlyphProvider>;
```

> Three.js ✅ Stable — WebGPU and WebGL2 through `WebGPURenderer`. Classic `WebGLRenderer` is not supported.

**Break-apart API** (verbatim, the 0.1.0 tarball `dist/three/text.d.ts:120` and `glyphs.d.ts`):

```ts
/** Copies the committed glyphs and optional decorations into independently rendered Three objects. */
breakApart(): readonly [glyphs: Glyphs, decorations: Decorations | undefined];
…
export declare class Glyphs extends THREE.Object3D {
    get count(): number;
    get measurements(): readonly ThreeGlyphMeasurement[];
    setMatrixAt(index: number, matrix: THREE.Matrix4): void;
    setWorldMatrixAt(index: number, matrixWorld: THREE.Matrix4): void;
    …
}
```

On main this is renamed `split()`: "users are required to replace `Text.breakApart()` calls with `Text.split()`" ([pmndrs/glyph#239](https://github.com/pmndrs/glyph/pull/239)).

**Lupi toys**
- Element symbols and molecule names that shatter into glyph shards, and then into particles (spawn the particle system at `measurements` centres), before re-forming.
- A periodic-table typography toy.
- Crisp MSDF labels replacing troika `Text`. drei 11 `Text` is "todo … returns via @pmndrs/glyph" ([ECO] §4.2). Lupi uses `Text` in 5 files.
- Per-glyph matrices are CPU-side, which is fine for tens to hundreds of glyphs.

### 5.12 drei 11 on WebGPU: what's usable

- The `@react-three/drei/webgpu` export list (alpha.7 tarball `webgpu/index.d.ts`) includes: `MeshTransmissionMaterial`, `MeshRefractionMaterial`, `Caustics`, `ContactShadows`, `AccumulativeShadows`, `Sparkles`, `Trail`, `MeshPortalMaterial`, `Float`, `PresentationControls`, `Sampler`, `Instances`, `Html`, `Billboard`, `View`, `Hud`, `PerformanceMonitor`, `AdaptiveDpr`, `SpotLight` (volumetric), `Clouds`, `Inspector` + `useInspectorControls` (three's Inspector wired to v10 phases), and `DiscardNodeMaterial`.
- **Broken or missing on WebGPU:** `Outlines`, `PointMaterial` (renders squares), `Splat`, troika `Text`. `Stars` was removed on the branch after alpha.7 ([ECO] §4.2).
- "Implemented means a file exists, not that it works" (drei migration doc).
- The corpus rule: "drei is renderer-split: import **`@react-three/drei/webgpu`** (or `/core`)" (`AGENTS.md:597+`).

---

## 6. WebGL2-fallback realities, unlock by unlock

**Who lands on the fallback**
- iPhones that can't run iOS 26. Safari 26 turned WebGPU on by default on 2025-09-15; iOS 26's device list excludes the XS and XR generation (UNVERIFIED here).
- Android below 12 and some GPUs: Samsung Xclipse is planned around Chrome 154, and Imagination GPUs need Android 16+ ([TJS] §3).
- Firefox on Android and Linux (Nightly only).
- About 13% of users globally (87% support, Aug 2026).

**Always check `renderer.backend.isWebGPUBackend` after `init()`.** Fiber exposes this as `state.webGPUSupported` (`webgpu/index.mjs:14235-14237`).

| Unlock | On WebGL2 backend | Mitigation |
|---|---|---|
| TSL impostors (`positionNode` + `depthNode`) | Works (GLSL transpile), slower (inference) | Lower quality tier, DPR 1 |
| `useUniforms` / `useNodes` mood bus | Works | – |
| Per-atom compute (poke, jiggle, morph) | Works via transform feedback; storage reads become PBO textures | Lower counts. Hide bonds during play. |
| Atomics, workgroup memory, barriers, subgroups, indirect | **Absent** | Skip Particle Life, GPU binning and the MLS-MPM fluid |
| `Storage3DTexture` volumes, VXGI | **Absent** | CPU-baked `Data3DTexture` (static) |
| `CountingSort`, `GaussianSplat` | CPU sort (`computeCPU` / `_sortCPU`) | Fewer splats |
| `ClusteredLighting` | Treat as absent (the example gates on WebGPU) | ≤4 real lights + emissive + bloom |
| Bloom, outline, DOF, afterImage, transition, sobel, retro, LUT, FXAA/SMAA | Expected to work (fullscreen fragment); UNVERIFIED node by node | – |
| SSAO | Likely works (MRT via drawBuffers); UNVERIFIED | Half-res |
| TRAA / TAAU | Likely works; the TRAA source notes a WebGPU-only resize timing issue, not a WebGL one | – |
| OIT | Works without MSAA | FXAA after |
| `fsr1()` | Works (GLSL `textureGather` polyfill) | – |
| `@pmndrs/upscaler` | **Absent** (WGSL) | `fsr1()` |
| Multi-canvas shared renderer | **Absent** (inference) | drei `<View>`, static previews |
| `onFramed` / frustum | Works | – |
| `onOccluded` / `onVisible` | Likely works (WebGL2 occlusion queries); inference | – |
| Scheduler, DnD, `pointerMap`, fixed-size canvas, `useRenderTarget`, Environment | Work (renderer-agnostic) | – |
| `@pmndrs/glyph` | Works | – |
| `@pmndrs/sky` | UNVERIFIED | Gradient background |
| vgpu WGSL nodes (`tslExports`) | **Absent** (WGSL-only) | GPU Studio already refuses the fallback (`packages/ui/src/gpu-studio/runtime.ts:169`) |
| XR | Stays on the WebGL track. The react-three-examples README: "`@react-three/xr` has no v10 branch, and today even the `webgpu_xr_*` originals swap in a WebGL renderer at session start". | Keep XR on a separate WebGL path |

The Utsubo warning applies throughout: "a feature that works on WebGPU can still fail on the WebGL 2 fallback", and failures are often silent ([TJS] §3). Every unlock needs a fallback smoke test with `renderer={{ forceWebGL: true }}`.

---

## 7. Template shelf: the 20 most reusable examples

**URL patterns**
- Gallery: `https://pmndrs.github.io/react-three-examples/examples/<slug>`
- Source: `https://github.com/pmndrs/react-three-examples/tree/main/src/examples/<category>/<slug>` (paths verified in the clone at `b3fb717`)
- three original: `https://threejs.org/examples/#<name>`

Ranked by reuse value for Lupi's "fun, fast, beautiful".

| # | Example (R3F v10 port → three original) | Lift for Lupi | Backend |
|---|---|---|---|
| 1 | [`compute-particles`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/compute/compute-particles) → [webgpu_compute_particles](https://threejs.org/examples/#webgpu_compute_particles) | GPU state in `useBuffers`, the three dispatch cadences, pointer `event.point` → impulse kernel, 200k `<sprite count>`. The poke and explode skeleton. | GPU, simple kernels GL2 |
| 2 | [`compute-geometry`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/compute/compute-geometry.tsx) → [webgpu_compute_geometry](https://threejs.org/examples/#webgpu_compute_geometry) | `geometryNode` auto-dispatch ("zero `useFrame`"), pointer-to-local-space via `objectWorldMatrix`, Verlet spring-back "jelly". Jiggle that only runs when drawn. | GPU |
| 3 | [`compute-points`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/compute/compute-points.tsx) → [webgpu_compute_points](https://threejs.org/examples/#webgpu_compute_points) | 300k points, `ComputeNode.onInit` seeding, pointer repel, `requiredLimits` via the Canvas `renderer` prop (relevant to the gist engine's limit question) | GPU |
| 4 | [`tsl-compute-attractors-particles`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/tsl/tsl-compute-attractors-particles) → [webgpu_tsl_compute_attractors_particles](https://threejs.org/examples/#webgpu_tsl_compute_attractors_particles) | 262k particles, live `uniformArray` attractors. An attract-mode swirl around the molecule. | GPU |
| 5 | [`tsl-vfx-linkedparticles`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/tsl/tsl-vfx-linkedparticles) → [webgpu_tsl_vfx_linkedparticles](https://threejs.org/examples/#webgpu_tsl_vfx_linkedparticles) | Compute writes **geometry** (ribbons), frame-owned `uniform()` pattern, bloom. "Reaction sparks" and bond ribbons. | GPU |
| 6 | [`compute-birds`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/compute/compute-birds) → [webgpu_compute_birds](https://threejs.org/examples/#webgpu_compute_birds) | 8,192 boids, `vertexNode` takeover reading storage, camera-ray avoidance. A "solvent swarm" that scatters from the finger. | GPU (original has PBO fallback) |
| 7 | [`compute-particles-fluid`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/compute/compute-particles-fluid) → [webgpu_compute_particles_fluid](https://threejs.org/examples/#webgpu_compute_particles_fluid) | MLS-MPM with fixed-point atomics, `useBuffers` for GPU-bound `BufferAttribute`s. "Pour solvent", a tilt ball pit. | **GPU only** |
| 8 | [`compute-texture-3d`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/compute/compute-texture-3d.tsx) → [webgpu_compute_texture_3d](https://threejs.org/examples/#webgpu_compute_texture_3d) | Per-frame `Storage3DTexture` + `RaymarchingBox`. Illustrative electron-cloud fog. | **GPU only** |
| 9 | [`volume-cloud`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/volume/volume-cloud.tsx) → [webgpu_volume_cloud](https://threejs.org/examples/#webgpu_volume_cloud) | CPU-baked `Data3DTexture` raymarch. The static fallback for #8. | GPU+GL2 (inference) |
| 10 | [`instance-sprites`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/geometry/instance-sprites.tsx) / [`tsl-galaxy`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/tsl/tsl-galaxy.tsx) | Sized instanced sprites with `positionNode`/`scaleNode`/`colorNode` and `range()` per-instance randoms (WebGPU points are 1 px). Ambient "electron dust". | GPU+GL2 |
| 11 | [`postprocessing-bloom-selective`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-bloom-selective.tsx) → [webgpu_postprocessing_bloom_selective](https://threejs.org/examples/#webgpu_postprocessing_bloom_selective) | Per-object `mrtNode` bloom mask. Glowing elements, hovered atom, tap pulse. | GPU+GL2 |
| 12 | [`postprocessing-outline`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-outline) → [webgpu_postprocessing_outline](https://threejs.org/examples/#webgpu_postprocessing_outline) | `outline()` with `selectedObjects` mutated in place, pulse via `select`. Hover and selection. | GPU+GL2 |
| 13 | [`postprocessing-traa`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-traa.tsx) + [`upscaling-fsr1`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/upscaling-fsr1.tsx) / [`upscaling-taau`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/upscaling-taau.tsx) | Clean impostor edges without MSAA; render-scale plus upscale on phones | GPU+GL2 (fsr1) |
| 14 | [`postprocessing-ao`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-ao) → [webgpu_postprocessing_ao](https://threejs.org/examples/#webgpu_postprocessing_ao) (r186 adds the SSAO switch) | Prepass normals and velocity MRT, GTAO/SSAO, `builtinAOContext`. The N8AO replacement. | GPU+GL2 (likely) |
| 15 | [`postprocessing-transition`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-transition.tsx) → [webgpu_postprocessing_transition](https://threejs.org/examples/#webgpu_postprocessing_transition) | Two scenes via `createPortal` + `transition()` wipe. Molecule-switch dissolve. | GPU+GL2 |
| 16 | [`backdrop`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/scene/backdrop) → [webgpu_backdrop](https://threejs.org/examples/#webgpu_backdrop) | `backdropNode` + `viewportSharedTexture()` grading. A magnifier or "x-ray lens" blob you drag over the molecule. | GPU+GL2 (likely) |
| 17 | [webgpu_oit](https://threejs.org/examples/#webgpu_oit) (r186; not yet ported, since the corpus is on r185) + [`materials-transmission`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/materials/materials-transmission.tsx) | OIT candy atoms; physical glass for small molecules | OIT GPU+GL2 (no MSAA) |
| 18 | [`multiple-canvas`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/scene/multiple-canvas.tsx) + [`multiple-views`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/camera/multiple-views) | 40 canvases on one device (live thumbnails); a scissor multi-view (the WebGL2-safe split compare) | multi-canvas GPU; views GPU+GL2 |
| 19 | [`interactive-cubes-gpu`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/scene/interactive-cubes-gpu.tsx) → [webgl_interactive_cubes_gpu](https://threejs.org/examples/#webgl_interactive_cubes_gpu) | 1×1 integer-ID pick pass + `readRenderTargetPixelsAsync`, throttled to one in flight. Atom picking up to the 5M interactive ceiling. | GPU+GL2 |
| 20 | [`occlusion`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/camera/occlusion.tsx) + [`lights-clustered`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/lights/lights-clustered) | `occlusionTest` → shading without React re-renders ("find the buried atom"); ~800 real lights ("firefly mode") | occlusion GPU(+GL2?), clustered GPU |

**Honourable mentions**
- [`webgpu_gaussian_splat`](https://threejs.org/examples/#webgpu_gaussian_splat) (r186, not yet ported): scan splats.
- [`postprocessing-afterimage`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-afterimage.tsx): trails.
- [`tsl-halftone`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/tsl/tsl-halftone), [`postprocessing-sobel`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-sobel.tsx), [`postprocessing-retro`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-retro): style skins.
- [`compute-sort-bitonic`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/compute/compute-sort-bitonic) and [`compute-reduce`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/compute/compute-reduce): GPU sort, and a max-energy readback for demand-mode settle detection.
- [`multiple-rendertargets-readback`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/render-targets/multiple-rendertargets-readback.tsx): the async readback discipline for share cards.
- [`postprocessing-ssgi-ballpool`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-ssgi-ballpool): the physical-toy look on desktop.
- [`instancing-morph`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/geometry/instancing-morph.tsx): per-instance `setMorphAt`. This is CPU-baked weights, so it is less useful than a compute lerp for atoms.
- [`scene/molecules`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/scene/molecules.tsx) and [`loaders/loader-pdb`](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/loaders/loader-pdb.tsx) exist, but they render per-atom `<Html>` sprites and meshes. They are useful only for the `PDBLoader` read-without-mutating pattern, not for scale.

---

## 8. What gates the unlocks

These are Lupi prerequisites, in dependency order.

1. **TSL port of the atom and bond impostors.**
   - Use `positionNode` / `depthNode` / sphere `normalNode`, plus palette-texture lookups.
   - Bonds gain a `uvec2` atom-pair attribute (§1.3).
   - This blocks every post, OIT, AO, bloom-mask and GPU-play unlock.
   - It is also where the early-Z question lives: WGSL has no `depth_greater` (UNVERIFIED impact).
2. **Post-stack rebuild in one `useRenderPipeline`** near the root: TRAA or FXAA, bloom mask, `ssao`, `dof`, and style skins as uniform-driven `select()` branches.
3. **Scheduler migration.**
   - `state.clock` → `elapsed` (`packages/ui/src/SelectionMarkers.tsx:99-101`, `packages/scene/src/BillionAtomBlock.tsx:303,356`).
   - Priority numbers → phases (`packages/ui/src/ExportManager.tsx:180,349,449`).
   - `frameloop` → `demand` with `invalidate`.
4. **Export parity.**
   - Readback via `readRenderTargetPixelsAsync` instead of `preserveDrawingBuffer`.
   - A new `rendererFingerprint`.
   - Looks and offsets stay non-deterministic, "illustrative" layers.
5. **Fallback matrix CI.** Run each toy under `renderer={{ forceWebGL: true }}` and fail soft (AGENTS.md: "advertising it only after a validated frame").
6. **API churn pinning.**
   - The TSL hooks' import path changes at alpha.6 (`@react-three/fiber/webgpu` → `@react-three/tsl`). Isolate imports behind one Lupi module.
   - React must stay `<19.3`. Lupi is on 19.2.4.

---

## 9. Open questions and UNVERIFIED items

- `configureTSL` + read-only `useUniforms('mood')` avoiding reconcile snap-back (inference from the docs).
- Motion vectors for compute-displaced instances via `positionPrevious` (exported from `three/tsl`; approach untested). This matters for TRAA, TAAU, `@pmndrs/upscaler` and motion blur.
- Multi-canvas on the WebGL2 backend (inference: absent), and whether a 1×1 or hidden primary canvas works.
- `onOccluded` on the WebGL2 backend (inference: works).
- Per-canvas GPU memory numbers in §3.2 are arithmetic, not measurements. No phone thermal or FPS data exists for Lupi (fact sheet open question 2).
- The scoped `useBuffers` WGSL-name bug (corpus self-contradiction, §1.3).
- HTML5 drag and drop from a finger on iOS and Android.
- `@pmndrs/sky` on the WebGL2 backend; drei 11 WebGPU components at runtime.
- `VideoFrame` and `canvas.toBlob()` from a WebGPU canvas on Safari.
- Whether 9.8.1's full `<Activity>` support is in v10 alpha (not checked).
- iPhone Safari 26.x acceptance of `requiredLimits: { maxStorageBuffersInVertexStage: … }` (`packages/ui/src/scan/gist/gistParticles.ts:94`). The `compute-points` and `compute-birds` templates request the same limit (fact sheet open question 1).

---

## Sources

**R3F v10 (docs at `v10` @ `14007b456c8c`, 2026-09-26)**
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/webgpu/overview.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/webgpu/tsl-hooks.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/webgpu/typed-uniforms.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/webgpu/compute.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/webgpu/render-pipeline.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/webgpu/multi-canvas.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/frame-loop.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/scene/visibility.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/scene/render-targets.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/scene/camera-parenting.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/API/events.mdx
- https://github.com/pmndrs/react-three-fiber/blob/v10/docs/API/canvas.mdx

**npm tarballs**
- https://registry.npmjs.org/@react-three/fiber/-/fiber-10.0.0-alpha.5.tgz (`dist/webgpu/index.d.ts:173-259,457,539,748,1050-1080`; `dist/index.mjs:336-344,14204`; `dist/webgpu/index.mjs:1531-1543,14185-14245`)
- https://registry.npmjs.org/@react-three/tsl/-/tsl-10.0.0-canary.14007b4.tgz (`dist/index.d.ts:438-776`, `readme.md`)
- https://registry.npmjs.org/@pmndrs/glyph (0.1.0 `dist/three/text.d.ts:120`, `dist/three/glyphs.d.ts`)
- https://registry.npmjs.org/@react-three/drei (11.0.0-alpha.7 `webgpu/index.d.ts`, `core/index.d.ts`)
- Registry dist-tags as of 2026-09-27: fiber `alpha` = 10.0.0-alpha.5, `canary` = 10.0.0-canary.14007b4; three `latest` = 0.186.1; drei `alpha` = 11.0.0-alpha.7.

**react-three-examples (`main` @ `b3fb717`, 2026-09-08)**
- https://github.com/pmndrs/react-three-examples (README, `AGENTS.md` §Frame loop / TSL and the store hooks / Compute / Post-processing / React and the ecosystem / Verification)
- The example sources linked in §7
- Gallery: https://pmndrs.github.io/react-three-examples/

**three.js r186**
- https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.webgpu.js (`12887` depthNode; `15593,41736` positionPrevious/velocity; `40769-40773` instancedArray; `44806` workgroup `toAtomic`; `62776` compileComputeAsync; `64653` computeAsync; `64886` readRenderTargetPixelsAsync; `66952` GLSL textureGather polyfill; `67320-67387` PBO; `74505-74551` WebGL occlusion queries; `87303-87323` per-canvas WebGPU context)
- https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.tsl.js (`positionPrevious` export)
- https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/files.json (230 `webgpu_*` examples)
- Examples: [webgpu_oit](https://threejs.org/examples/#webgpu_oit), [webgpu_gaussian_splat](https://threejs.org/examples/#webgpu_gaussian_splat), [webgpu_vxgi](https://threejs.org/examples/#webgpu_vxgi), [webgpu_lights_sunlight](https://threejs.org/examples/#webgpu_lights_sunlight), [webgpu_lights_clustered](https://threejs.org/examples/#webgpu_lights_clustered), [webgpu_compute_texture_3d](https://threejs.org/examples/#webgpu_compute_texture_3d), [webgpu_texturegather](https://threejs.org/examples/#webgpu_texturegather), [webgpu_postprocessing_ao](https://threejs.org/examples/#webgpu_postprocessing_ao), [webgpu_compile_async](https://threejs.org/examples/#webgpu_compile_async)
- Addons (tag r186): `examples/jsm/tsl/display/OITPassNode.js`, `SSAONode.js`, `FSR1Node.js`, `TRAANode.js`, `OutlineNode.js`, `BloomNode.js`; `objects/GaussianSplat.js`; `utils/GaussianSplatUtils.js`; `gpgpu/CountingSort.js`; `lighting/ClusteredLighting.js`; `tsl/lighting/ClusteredLightsNode.js`; `lighting/vxgi/VXGINode.js`; `lighting/vxgi/VXGIVolume.js`; `lights/SunLight.js`; `tsl/utils/Raymarching.js`, all at `https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/jsm/…`

**pmndrs packages**
- https://github.com/pmndrs/upscaler (README)
- https://github.com/pmndrs/sky (README; https://sky.docs.pmnd.rs returned HTTP 503 on 2026-09-27)
- https://github.com/pmndrs/glyph (README), https://github.com/pmndrs/glyph/pull/239 (`breakApart` → `split`)

**Drag and drop on mobile (conflicting; UNVERIFIED)**
- https://www.testmuai.com/learning-hub/html-drag-and-drop-api-browser-support/
- https://github.com/timruffles/mobile-drag-drop
- https://github.com/drag-drop-touch-js/dragdroptouch

**Lupi code**
- `packages/ui/src/viewer/ViewerCanvas.tsx:67`
- `packages/scene/src/AtomsOptimized.tsx:342,367`
- `packages/scene/src/Bonds.tsx:125-127,725-730`
- `packages/ui/src/gpu-studio/runtime.ts:124,169,238`
- `packages/ui/src/scan/gist/gistParticles.ts:94`
- `packages/ui/src/ExportManager.tsx:180,349,449`
- `packages/ui/src/switcher/MoleculeSwitcher.tsx:293`
- `packages/ui/src/switcher/ElementChips.tsx`
- `packages/ui/src/gallery/previews.json` (`atomCap: 1200`)
- `packages/scene/src/useBondGpuPipeline.ts:4`
- `/home/user/Lupi/AGENTS.md` (V1 export truth, scan endpoints)

**Earlier digests in this folder**
- `00-fact-sheet.md`, `r3f-releases.md` [R3F], `pmndrs-ecosystem.md` [ECO], `threejs-webgpu.md` [TJS], `code-core.md` [CORE]
