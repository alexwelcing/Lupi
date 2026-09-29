# TSL impostor spike: findings

Archived from the port scratchpad on 2026-09-28 (plan-final Appendix A). The
spike was a standalone Vite app that ported Lupi's atom and bond impostors to
TSL on `WebGPURenderer` and checked them against a CPU ray-cast on both
backends. What is kept here:

- `src/`: the spike sources. `renderer.ts` is the reference for
  `packages/ui/src/viewer/createLupiRenderer.ts`, `shading.ts` seeds
  `packages/scene/src/tsl/impostorKit.ts`, and `swizzleShim.ts` became
  `packages/ui/src/viewer/webgpuCompat.ts`.
- `shaders/`: the WGSL and GLSL that three generated for the fixture scene,
  for comparing against `renderer.debug.getShaderAsync` output when a port
  renders wrong (trap G1).
- `shots/results.json`, `shots/extras.json`: the verifier's pixel results.
- `rt/rt.ts`: the render-target readback probe (lead probe L3).
- `dt/dt.tsx`: the fiber canary + drei 11 `/webgpu` probe with the
  `state.gl` gate, phases and the post pipeline (lead probes L4, L5, L7).

The files are reference material only; they are not built, linted or
type-checked with the repo. See `PROBES.md` for the lead probes.

## Spike facts

**Stack:**
- fiber and tsl `10.0.0-canary.14007b4`, three 0.186.1, `@types/three` 0.186.0, React 19.2.4, vite 7.3.6
- Chromium 141.0.7390.37 (`/opt/pw-browsers/chromium-1194`), Playwright 1.59.1
- factory as in D1
- R3F awaited `init()`; `state.webGPUSupported` was true on WebGPU and false on both WebGL2 paths
- the factory ran once under `StrictMode`

**Gotchas:**
- **G1.** A cached node is emitted where it is first built, so a value first computed inside a branch is uninitialized elsewhere. Compute shared values in the `depthNode` prelude (it runs before `colorNode`); `.toVar()` before `select`. Check with `renderer.debug.getShaderAsync`.
- **G2.** `Discard` goes in the prelude, after the hit.
- **G3.** A `select` whose branches share a large expression duplicates it; `.toVar()` it first (the WGSL shrank from 12,969 to 8,241 characters).
- **G4.** Early-Z is lost on both backends: plain `frag_depth`/`gl_FragDepth`, and the `viewZTo*Depth` helpers are not reversed-aware.
- **G5.**
  - A normalized `Uint8×4` attribute plus `round(x*255)` works on both backends.
  - Non-normalized u8/u16 is widened to u32.
  - One attribute aliased under two names works.
- **G6.** three r186 passes `swizzle:'rgba'` to every `createView`, and Chromium 141 with unsafe WebGPU throws a TypeError.
- **G7.** SwiftShader loses the device without `--use-vulkan=swiftshader --enable-features=Vulkan`; the lead found `--use-angle=swiftshader` is also required.
- **G8.** R3F sets ACES after the factory returns; set `NoToneMapping` in `onCreated`.
- **G9.** An own device must request the adapter's features, or three enters compatibility mode and forces `samples = 0`.
- **G10.** `vertexNode` bypasses `positionNode`, stock velocity, `normalView` and fog.
- **G11.** v9 fragment rays are perspective-only; the port corrects orthographic rays.
- **G12.** The v9 bond box uses a left-handed basis (`cross(dir,u)`), so the port uses `cross(u, dir)`.
- **G13.** Type gaps: `.element()`, the nullable `onRenderUpdate` camera, R3F's `OffscreenCanvas` shim.

**v9 features with no TSL equivalent:** conservative depth.

**Untested in the spike and assigned:** `CUBEUV` IBL via `pmremTexture` (WP1a); etch, noise, scratch, clearcoat and presets (WP1a, WP1b).

