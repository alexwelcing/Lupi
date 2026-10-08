# GPU Studio (removed)

> **Historical.** GPU Studio was removed by owner decision ("GPU Studio:
> Remove it now", [decisions.md](brainstorm/2026-09-viewer-play/decisions.md)).
> This page records what it was and why it went; only "What stays" describes
> the current app. As of 2026-10-08 the snowglobe Look described at the end
> has not been built.

GPU Studio was removed in the React-Three-Fiber v10 / three r186 port
(September 2026). It will come back as a **Look** in the main viewer rather
than as a separate modal.

## What it was

An opt-in, atoms-only preview behind a **GPU Studio** header button. It
copied the current frame (up to 5,000 atoms), opened a modal dialog with its
own vgpu 0.4.0 device and its own three `WebGPURenderer`, and shaded each
sphere with `atom-surface.wgsl` through `vgpu/three` `tslExports`: the
**Snowglobe**, **Studio light** and **Graphic contours** finishes, with shake,
light angle, atom focus and phone-motion controls. While it was open the
regular viewer paused its render loop and suspended its global shortcuts.

## Why it went

The port moves the regular viewer itself onto `WebGPURenderer` (WebGPU, with
its WebGL2 fallback) and node materials. A second renderer and device beside
the viewer's is no longer the only way to get WebGPU shading, and the modal's
pause/resume handshake with the viewer canvas was a standing source of
lifecycle bugs. Keeping it working through the port would have meant porting
it twice.

## What was removed

- `packages/ui/src/gpu-studio/**` (launch dialog, runtime, snapshot, snow
  motion, `atom-surface.wgsl`, styles and unit tests)
- the header launch button and the viewer's pause/resume and shortcut
  suspension while Studio was open
- `playwright.gpu-studio.config.mjs`, `tests/ui/gpu-studio.spec.ts` and
  `tests/ui/gpu-studio.webgpu.spec.ts`

## What stays

- vgpu 0.4.0 remains a dependency: the `/scan` swirl and gist particles and
  the action-light buttons still create their own small vgpu devices (see
  `docs/scan-pipeline.md` and `packages/ui/src/action-light/`).
- `pnpm test:action-light` runs the action-light shader check on the WebGPU
  software lane (`tools/lib/browser-lanes.mjs`); its config now extends
  `playwright.config.mjs` directly.

## Coming back as a Look

The snowglobe returns as a Look on the main atom layer: a TSL branch of the
atom impostor material with the mood uniforms, and "shake" as a Play verb
driven by a frame job. It will run in the main canvas on both backends, so it
needs `atom-surface.wgsl` ported to a TSL `Fn` (vgpu's `wgslFn` path is
WebGPU-only). The source is in git history before the port's removal commit.
