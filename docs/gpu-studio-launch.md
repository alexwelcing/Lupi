# GPU Studio preview

GPU Studio is an opt-in viewer feature using **Vercel Labs vgpu 0.4.0**,
not a remote/virtual GPU service. Open a molecule, then choose **GPU Studio**
in the header (the compact button says **GPU** on phones).

## Product boundary

- Two visual looks: **Studio light** and **Graphic contours**. Both execute
  the authored `atom-surface.wgsl` function through `vgpu/three` `tslExports`
  and Three.js r184 node materials on its WebGPU backend.
- One owned snapshot of the selected source frame; playback pauses. All atoms
  in that frame are included. Bonds, annotations, property fields and other
  regular-viewer layers are intentionally excluded and the UI says so.
- Contours are decorative sphere shading, not electron density, orbitals,
  energies, a simulated result or evidence of material properties. Existing
  element/type semantics determine the color key; opaque type IDs stay opaque.
- This is an atoms-only lighting preview, not an exact saved-view/export
  mode. Save and Export continue to belong to the normal viewer.
- Up to 5,000 fully loaded atoms. Larger, incomplete or invalid frames get an
  explanation and a return action; they are never silently truncated.
- No external textures, new data providers, remote GPU jobs or research UI.

## Loading and lifecycle

The regular viewer remains WebGL2. Only opening GPU Studio imports vgpu and
the separate `vendor-three-webgpu` bundle. The home route mounts no renderer.
The regular canvas stays mounted to preserve its camera, with its render loop
paused while the native modal dialog is open. Global viewer shortcuts are
suspended; Escape and Back return focus to the launch button.

Studio is event-rendered unless the user chooses Rotate. Rotation is off by
default, including with reduced motion. DPR is capped at 1.5. Closing stops
animation, disconnects controls/resize handlers, disposes geometries/materials,
and destroys the owned GPU device. Late asynchronous initialization is canceled
and disposed; startup has a 20-second timeout. Device loss and shader/adapter
failure produce a closable fallback, never a false WebGPU-active badge.

## Refinement pass — September 5, 2026

- Specimen-first layout: the molecule name and canvas lead, with a compact
  three-part control rail. Resizable type-role tokens replace fixed-pixel text;
  the phone layout stacks without horizontal scrolling.
- Locally generated 128px softbox environment, softer physical-material
  highlights and quieter contour spacing. No additional package or HDR fetch.
  The environment render target is owned and disposed with the preview.
- **Light angle** moves the key light and environment rotation. The native
  slider supports keyboard arrows/Home/End and announces degrees. It has a
  scoped focus ring and styling independent of the app's legacy blue sliders.
- **Atom focus** emphasizes one source type while dimming, not hiding, the
  others. Counts come from the copied frame, not a formula lookup. Pressing the
  same type again or **All atoms** restores the full presentation.
- Resizing preserves viewing direction and relative zoom; **Reset view** still
  explicitly refits the camera. Finish, lighting and focus never write back to
  the molecule or regular-viewer state. Rotation remains opt-in.

Implementation follows Three's local
[RoomEnvironment lighting setup](https://threejs.org/docs/pages/RoomEnvironment.html)
using the installed r184 WebGPU PMREM implementation.

Refinement verification: UI TypeScript and production build passed; scoped lint
passed; three focused unit-test files / 12 tests passed, including control
wiring, source-coordinate preservation, truthful missing-frame labels and
cleanup. All six production-browser regression checks passed (1.7 minutes),
covering unsupported WebGPU, 320px text spacing, student navigation and a real
PNG export. In-app browser checks observed real new shader pixels, oxygen
focus, keyboard light changes, reopening, and 390px/1280px layouts. Production
rendering was also checked; only the pre-existing Three.Clock deprecation
warning appeared. The dedicated headless GPU lane remains
adapter-blocked as documented below; its new focus assertions are not claimed
as executed. The preceding candidate's CI audit is confirmed failed on the
existing 19 dependency findings, including six high-severity findings.

## Verification

- Frozen lockfile install, UI TypeScript, production web build: passed.
- Snapshot, launch lifecycle, viewer policy: 3 files / 10 tests passed.
- Vite build configuration: 4 tests passed.
- Scoped lint: passed. The Vite config retains three pre-existing warnings.
- In-app browser: actual WebGPU pixels observed for both looks, desktop and
  390px phone layout. Initial framing/lighting and focus recovery were refined
  through visual and interaction checks.
- Production student regression: all four student-surface checks passed,
  including a downloaded PNG. The two final dedicated fallback tests passed
  in 54.7 seconds: keyboard focus/Escape/reopen and 320px text-spacing reflow.
- Production bundle, connected in-app browser: WebGPU ready and actual pixels
  confirmed for Studio light and Graphic contours. Rotate/Stop and return/reopen
  also worked. This is separate from the dev-server visual checks above.
- Dedicated headless WebGPU lane: **blocked by adapter availability** on this
  Windows host. Both bundled headless/full Chromium and the newer installed
  Chromium failed to obtain an adapter even with explicit software flags.
  Lazy-loading assertions passed before the readiness gate; pixel-difference
  and live device-count assertions did **not** execute and are not claimed passed.
- The additional production audit request returned no result and was canceled.
  This does not supersede or clear the preceding CI audit failure.

Run the normal unsupported-device and reflow checks with:

```sh
pnpm exec playwright test tests/ui/gpu-studio.spec.ts
```

Run actual WGSL execution, pixel-difference, lazy-loading and device-lifecycle
acceptance separately (requires the full Playwright Chromium binary):

```sh
pnpm exec playwright test --config playwright.gpu-studio.config.mjs
```

This explicit lane uses Chromium's software WebGPU adapter. It is shader
execution evidence, not hardware performance proof. The default CI browser
continues to disable WebGPU and verifies the unsupported path; its configuration
has not been silently changed to assume device support.

The observed production optional chunks are about 175.66 kB gzip for Three's
WebGPU backend plus 5.89 kB gzip for the vgpu integration/shader runtime. These
are bundle sizes, not download timing or FPS measurements. The existing large
regular-viewer and XR bundles remain a separate optimization task.

## Release truth

This extends PR #93 on `codex/focused-student-product`. It does not change
`main`, deploy a website, prove a live API or close the production-reset
nonconformities. The preceding PR candidate failed CI's production dependency
audit on existing findings; those gates remain in force. Release still needs
the exact candidate's CI and the owner-authorized deployment/rollback chain.

Implementation references:
[vgpu Three.js guide](https://github.com/vercel-labs/vgpu/blob/main/apps/docs/content/docs/guides/threejs.md),
[Chromium WebGPU test flags](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/web_tests/FlagSpecificConfig),
[Playwright full Chromium headless mode](https://playwright.dev/docs/browsers#chromium-new-headless-mode).
