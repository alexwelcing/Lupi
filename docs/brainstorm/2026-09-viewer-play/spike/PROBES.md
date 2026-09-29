# Lead probes

Run for the port plan on 2026-09-28 (plan-final §2.2). The probe scripts lived
in the port scratchpad, next to the spike; `rt/rt.ts` and `dt/dt.tsx` in this
folder are the pages they drove.

| ID | What | Result |
|---|---|---|
| L1 | `g7check.mjs`, `g7check2.mjs`: a raw WebGPU page, 3 s, across flag sets | Device lost at frame 1–2 with `--enable-unsafe-webgpu --enable-unsafe-swiftshader` (the harness's lane G), with the gpu-studio config's flags, and when either `--use-angle=swiftshader` or `--enable-features=Vulkan` is missing. **Stable** with `--use-angle=swiftshader --use-vulkan=swiftshader --enable-features=Vulkan` on top of the unsafe pair. WebGL2 stays available in the same browser. The adapter exposes `texture-component-swizzle`. |
| L2 | `g6check.mjs`: spike app `?noshim=1` | Without the shim: `TypeError: Failed to execute 'createView' … 'swizzle'`, 1 frame, nothing rendered. With the shim as a Playwright init script, or in-app: renders, 0 errors. |
| L3 | `rtcheck.mjs` + `spike/rt/rt.ts`: render-target readback, 100×60, on WebGPU, forced WebGL2 and the lane-L fallback | **Opaque:** RGBA8+SRGB RT gives canvas-identical bytes (grey `#808080` → 128); RGBA8+NoColorSpace gives linear (55). **Orientation:** WebGPU readback is top-left origin; WebGL2 (both paths) is bottom-left. **Stride:** WebGPU rows padded to 256 bytes (400 B → 512 B; 800 B → 1024 B for half floats); WebGL2 is tight. **Transparent:** a half-alpha `#ff8000` over clear-0 is stored as sRGB-encoded **premultiplied linear** (`[188,92,0,128]` in RGBA8+SRGB; `[0.5,0.108,0,0.5]` in HalfFloat). Straight output `[255,128,0,128]` needs **linear** un-premultiply. Byte-space division gives 183 instead of 128 in green. HalfFloat readback returns a `Uint16Array` on both backends. |
| L4 | `dtcheck.mjs` + `spike/dt/dt.tsx`: fiber canary + drei 11.0.0-alpha.7 `/webgpu`, three-created device via `requiredLimits` | Renders on both lanes. `state.elapsed` is present and `state.clock` absent. `state.gl` is `null` at `onCreated` in WebGPU mode. |
| L5 | same page | **Without the gate:** `Html` throws `null.domElement`; MTM and ContactShadows throw `null.setRenderTarget` (the whole canvas goes to the error boundary). **With the gate:** `Html`, `Billboard`, `Line`, `OrbitControls` (drag moves the projection), MTM and the canvas-texture label all render on both lanes. `ContactShadows` draws nothing on WebGPU and a misplaced (Y-flipped) shadow on WebGL2. MTM logs Chromium `GL_INVALID_OPERATION … missing fragment shader outputs` **warnings** on WebGL2 but renders. Phases added with `addPhase` run in the planned order; the default render stays on. A factory that throws, and a browser with no GPU at all, both land in an `ErrorBoundary` wrapped around `<Canvas>`. |
| L6 | `videocheck.mjs`: `canvas.captureStream(30)` + `MediaRecorder` for 2 s | webm about 250 KB on both backends; a decoded frame at t=1 s shows the plate (≈`#101817`) and about 11.7k atom pixels |
| L7 | `dt.tsx?post=1`: `useRenderPipeline` with GTAO(depth, reconstructed normals) → bloom → DOF → `renderOutput(ACES, sRGB)` → vignette, `outputColorTransform=false` | Runs on both lanes with 0 console errors. Pixels change against no-post, and the probes are identical across backends. Screenshot: `spike/shots/drei-G-post.png`. |
| L8 | `pnpm9/t/tr.test.tsx`: `@react-three/test-renderer/webgpu` canary under vitest 4.1.5 + jsdom 29.1.1 | Passes. It mounts a mesh with `MeshBasicNodeMaterial`, `userData.lupiUniforms` is readable, a `useFrame({phase:'update'})` job runs, and `useThree(s=>s.renderer)` is the mock `WebGPURenderer`. |

The screenshots (`shots/drei-{G,L}-gate.png`, `drei-G-post.png`, `drei-G-webgpu.png`) were
not archived, to keep this folder small.

