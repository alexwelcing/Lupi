# R3F v10 port: status

The viewer now runs on React Three Fiber v10 alpha (`10.0.0-canary.14007b4`), `@react-three/tsl` at the same canary, drei `11.0.0-alpha.7`, and three `0.186.1`'s `WebGPURenderer`. It uses the WebGPU backend where the browser has an adapter, the WebGL2 backend otherwise, and `?renderer=webgl2` forces the fallback. Owner decisions are in [decisions.md](decisions.md). The work-package plan and the proven spike are in [spike/](spike/).

## What changed for users

- **Renderer.** Atoms and bonds are TSL ray-cast impostors that write per-pixel depth, and their spheres and cylinders intersect cleanly. They were checked against a CPU ray-cast on both backends. Clusters, vector arrows, the billion-atom block, backdrops, the procedural sky, the panorama dome and the filter shell are node materials too. No GLSL remains, and lint now rejects it.
- **Look.**
  - The viewer opens on the home page's dark sage plate (`#101817`), with lime (`#d5ef9c`) for focus rings and pressed chips. CPK stays the default element palette.
  - Post presets run on one TSL render pipeline: AO, bloom, depth of field, tone mapping and vignette. The configured background stays out of tone mapping and vignette, so the plate looks the same under every preset.
  - Ambient occlusion is now three's GTAO, so it may look slightly different from the old N8AO.
- **Labels** are canvas-texture sprites, replacing troika `Text`. The **axes gizmo** is a small SVG overlay in the bottom-right corner, lifted above the phone command deck.
- **Contact shadow.** A Lupi-owned floor shadow replaces drei's, which drew nothing on WebGPU.
- **Removed:**
  - **GPU Studio.** The snowglobe modal is gone; a Look on the new engine can bring it back.
  - **Immersive XR (VR/AR sessions).** iPhone AR via USDZ Quick Look export remains.
  - `r3f-perf` and `leva`.
- **Exports** use the V2 renderer profile. Capture renders into its own render target, so the canvas never flickers. The WebGPU and WebGL2 backends are separate execution classes: the same `specId`, but a different `rendererFingerprint` and `artifactKey`. Exports use the viewer's configured background. See AGENTS.md, "Render artifact V2 truth".
- **Robustness.**
  - A failed or slow environment-HDR download falls back to analytic lighting instead of taking the canvas down.
  - Bonds stay on screen during trajectory playback and never stretch between frames.
  - An MCP export issued right after load waits for the settled viewer.
  - `pnpm dev` works with drei 11.
- **`/scan`** and the action-light buttons keep working on the new three, still on vgpu 0.4.0.

## Known follow-ups

- **Wave 1 (the Buckyball Minute)** shipped on top of this port: the Lupi camera rig, the ink C60 hero, the no-splash relay, display motion and the one Play pill. Its status, tuning points, known limits and wave-2 queue are in [wave1-status.md](wave1-status.md).
- **Exports don't include the post look yet.** The molecule in an export is the raw scene, not tone-mapped or AO'd as it is on screen. This is queued as a separate task.
- **three r187** (due 2026-10-21) fixes a GL program leak on the WebGL2 fallback in long sessions. Bump to it and recheck environment lighting, because PMREMs become cube render targets.
- **fiber canary teardown warning.** If the viewer unmounts while `renderer.init()` is still pending, fiber logs "[R3F] Error while unmounting root", from a null `state.xr`. It's rare, harmless for users, and needs an upstream fix.
- **drei patch.** `patches/@react-three__drei@11.0.0-alpha.7.patch` stops MeshTransmissionMaterial compiling its distortion noise when distortion is 0; without it, SwiftShader's WebGL2 path freezes. Drop it once drei fixes this upstream.
- **Export axes overlay.** The overlay in raster exports stays bottom-left (contract literal `canvas-overlay-v1`), while the on-screen gizmo is now bottom-right.
- **Environment HDRs** are self-hosted since wave 2: `apps/web/public/hdri/` (byte-identical to drei-assets at the pinned revision, so no `specId` moved; CC0, see the NOTICE there). raw.githack.com is only a mirror tried when the self-hosted file fails.
- **Performance** was not a goal of this port. Impostors lose early-Z on both backends, which is accepted, and there is no device data.
