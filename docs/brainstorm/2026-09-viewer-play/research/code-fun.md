# Lupi experiential and playful surfaces: a code map for the "make it a toy" brainstorm

Scope: read-only survey of `/home/user/Lupi` as of 2026-09-27. File references are `path:line`. Quality ratings are code-read assessments, not visual QA. Anything not verified in code is marked UNVERIFIED.

---

## 0. TL;DR

- **A new visitor's first screen has no motion and no 3D.** `/` mounts `LandingShell`, which deliberately imports no three/R3F (`apps/web/src/main.tsx:25-31`, `packages/ui/src/LandingShell.tsx:8`). A Playwright test asserts zero `<canvas>` elements on the homepage (`tests/ui/student-surface.spec.ts:9`). The home page is a search box, a wall of 48 static thumbnails, 12 lesson cards, and a file drop zone.
- **The playful work that exists sits behind a click, a route, or a feature flag:** the GPU Studio snowglobe (viewer header, WebGPU, 5,000-atom cap, needs a loaded molecule), the `/scan` particle stage (needs `HF_TOKEN` on the edge, or `?demo=`), the "type candy → particles form candy" strip (only inside the viewer's Switch panel), Scene Remix (inside Style), the `?billion-atoms` scale page (hidden), and the `?emoji` tactile lab (hidden and unstyled).
- **The team already has strong primitives:** vgpu 0.4.0 fullscreen effects and compute particles (60k by default, up to 400k), a spring integrator, frame-rate-independent damping and throw physics in XR, analytic WGSL "pocket worlds", procedural math backdrops, and honest "decorative, not a result" labeling.
- **Hand-rolled math appears in at least 8 places**, with at least 3 different spring and damping styles. That is the natural landing zone for a shared math layer.
- **Hard product rules any idea must follow:** keep the landing light (no three/R3F on `/`), label anything decorative or inferred, respect reduced motion and forced colors, ask for sensor permissions only from an explicit gesture, cap DPR, use no external textures in GPU Studio, lazy-load WebGPU with fail-soft fallbacks, and emit only the small, PII-stripped analytics taxonomy.

---

## 1. The first 30 seconds

### 1.1 Routing: what mounts where

`apps/web/src/main.tsx` picks a shell from the URL alone, before importing anything heavy (`main.tsx:21-32`):

| URL | What mounts | Renderer? | Ref |
|---|---|---|---|
| `/` | `LandingShell` → `LandingPage` | **None**. Zero canvases, enforced by test. | `main.tsx:162-176, 256-257`; `tests/ui/student-surface.spec.ts:9` |
| `/scan` | `ScanShell` → `ScanPage` | vgpu canvas lazily, only once a photo or demo is active | `main.tsx:191-201, 250-251`; `ScanShell.tsx:9-13` |
| `/library*` | `LibraryShell` | None | `main.tsx:178-189` |
| `/?sim=<id>`, `?molecule=`, `?load=`, `?s=`, `?fly=`, `/view/<slug>`, `#/mcp`, `#/embed/mobile`, `#/science/<n>` | Full `App` → `ViewerApp` (R3F) | WebGL2 Canvas | `main.tsx:56-71, 248-249` |
| `?emoji` or `#/system/emoji` | `EmojiPlayground` (hidden) | DOM + Canvas2D | `App.tsx:13`; `viewer/viewerRoutes.ts:50-52` |
| `?billion-atoms` | `BillionAtomsPage` (hidden) | Own R3F Canvas | `App.tsx:14`; `BillionAtomsPage.tsx:1-13` |
| `/scenes/1m-copper-lattice`, `/research`, `?view=compare` | "This research workspace has retired" page | None | `main.tsx:38-46, 213-247` |

While the viewer chunk downloads (about 1 MB gzip), the only feedback is a pulsing "Lupi" text splash (`main.tsx:100-128`).

### 1.2 Desktop, first 30 seconds on `/`

`packages/ui/src/landing/LandingPage.tsx:13-49`, in order:

1. **Header** (`landing/SiteHeader.tsx:9-29`): "Lupi — See what things are made of." Nav: Molecules, Library, Scan, How to use, Open a file, plus the account dock.
2. **Hero H1** "Small structures. Big discoveries." and **`MoleculeFinder`** (`landing/MoleculeFinder.tsx:66-215`):
   - An `autoFocus` combobox (`:149`). Local matches appear on the first keystroke; PubChem autocomplete runs after 150 ms (`:24, 79-95`).
   - Enter opens the top hit. Picking a result sets `store.file`, and LandingShell then hands off to the viewer (`LandingShell.tsx:15-31`).
   - This is the fastest path to 3D, but it is a text box.
3. **Scan callout**: "📷 Point your camera at something. Eggs, a leather couch, your coffee: see what it's made of." (`LandingPage.tsx:24-29`).
4. **`MoleculeWall`**: "Or just click one." Shows 48 tiles of 104 gallery entries (`MoleculeWall.tsx:5, 18-78`).
   - Each tile is a 48 px static SVG preview or a gradient letter mark.
   - Hover is CSS only (`student-home.css:693`).
   - A click loads the molecule in place.
5. **`GallerySection`**: "Pick a starting point." 12 curated lesson cards with SVG art, 4 topic filters, a search box, and an observation prompt per card (`GallerySection.tsx:4-93`). It ends with the honesty footnote "These are coordinate models, not photographs…" (`:87-90`).
6. **"In the viewer" tips** (drag, scroll or pinch, Learn, Export), the **Drop zone** for your own files (`DropZoneSection.tsx`), and the footer.

There are no `@keyframes` on the landing at all. The only `animation` rule is the reduced-motion kill switch (`student-home.css:792-796`). Page background is `#020204` (`ViewerApp.tsx:622`).

### 1.3 Phone, first 30 seconds on `/`

The phone gets the same DOM, reflowed; the reset added touch-sized actions and 320 px reflow (`docs/product-reset-2026-09-04.md:34-37`). The scan callout on a phone opens `/scan`, where "Take a photo" uses `capture="environment"` (`scan/ScanPage.tsx:605-608`). With no camera handy, demo links (apple, wood screw, banana, vase, coffee mug) run the particle stage without keys (`ScanPage.tsx:581-595`; `scan/gist/gistClient.ts:145+`).

### 1.4 After the first click: viewer, desktop and phone

- **Canvas and controls**
  - WebGL2 R3F Canvas with `frameloop='always'` (continuous rendering, even when idle), paused only while GPU Studio is open (`viewer/ViewerCanvas.tsx:66-67`).
  - drei `OrbitControls`: damping 0.08, rotate 0.5, no auto-rotate and no turntable (`app/ViewerScene.tsx:731-742`). `autoRotate` appears only in GPU Studio (`gpu-studio/runtime.ts:293, 411`).
  - The molecule arrives static. There is no entrance animation.
- **Chrome**
  - Header: Lupi (home), file name and atom count, Save, **GPU Studio** ("GPU" on phones, with a "New" badge), and Account (`app/AppHeader.tsx:18-69`; `gpu-studio/GpuStudioLaunch.tsx:156-173`).
  - Command deck: **Learn, Style, Data, [Path], Camera, Export, Switch**, with shortcuts 1–7 (`app/ViewerCommandDeck.tsx:14-26`).
  - Panels open in `PanelHost` (`PanelHost.tsx:27-68`). The Cmd/Ctrl+K palette offers "Ask Jev" free-text commands (`ViewerApp.tsx:113-126`; `CommandPalette.tsx:1-7`).
- **One-time guidance**: a gesture hint pill, "Drag to rotate · Pinch to zoom · Tap an atom" on phones, that dismisses after the first canvas touch, once per session (`app/ViewerGestureHint.tsx:3, 20-41, 82-84`).
- **"Clear view" bucket**: a button that stows all chrome for an unobstructed view (`ViewerApp.tsx:778-798`; `global.css:846-852`).
- **Hidden behind panels**
  - Scene looks and Remix (Style).
  - Switch (search plus element chips, and the "particles form the thing" strip).
  - The flythrough camera path editor (Camera).
  - Measurements (Data).
  - GPU Studio (header).
  - XR buttons appear only if `navigator.xr.isSessionSupported` returns true (`xr/XREntryButton.tsx:37-52`).

---

## 2. Inventory of existing playful and interactive features

| # | Feature | Where it lives | Mechanism and math | Polish (code read) |
|---|---|---|---|---|
| 1 | **GPU Studio snowglobe** | Viewer header → modal `<dialog>` | three/webgpu `WebGPURenderer` + `MeshPhysicalNodeMaterial`; `colorNode` = authored WGSL via vgpu `tslExports` | High. Most polished toy. |
| 2 | **Scan particle stage** | `/scan` | vgpu compute (`gist-step.wgsl`) + point render (`gist-points.wgsl`), SDF primitives, photo-inflated SDF volume, SAM3D point homes | High, but gated on keys and photo latency |
| 3 | **"Type a thing, particles form it"** | Viewer Switch panel only | Same `GistStage` + text gist + Jev sculpt loop | Medium-high; buried |
| 4 | **Scan swirl** | `/scan` fallback tier | vgpu fullscreen fragment effect: fbm spiral plus a speck grid | Medium-high |
| 5 | **Action light buttons** | `LupiActionButton` (GPU Studio launch, Remix, "All visual mods") | Spring-deformed CSS vars plus a vgpu optical-ripple shader | High, subtle |
| 6 | **Scene looks + Remix + Undo** | Style panel | Randomized store patch over about 40 presentation keys; 4 named looks | Medium; instant swap, no tween |
| 7 | **Procedural math backdrops** | Style → backgrounds | GLSL skydome plus parametric line fields (Hopf-like torus knots, Fibonacci-sphere cells, moiré planes) | Medium; not interactive |
| 8 | **Filter shell + blob shadow** | Style, Prism look | Shader sphere or cube "snow-globe glass" plus a fake radial shadow that slides against the key light | Medium |
| 9 | **Press springs + click synth** | Viewer controls | Euler–Cromer spring, Web Audio triangle click | Springs polished; sound has no UI toggle |
| 10 | **Atom trails** | Viewer, annotated atoms only | Rolling 60-sample polyline, vertex-colour fade | Low reachability |
| 11 | **Flythrough** | Camera panel | Keyframes (≤5), 6 easings, cubic Bézier with tension | Functional, authoring-heavy |
| 12 | **XR grab/throw** | WebXR immersive only | One/two-hand grab, damped transforms, throw with gravity and bounce, squish pulse | Sophisticated, rarely seen |
| 13 | **Billion-atom block** | `?billion-atoms` (hidden) | Hierarchical brick LOD, impostors, quality picker | Tech demo, honest HUD |
| 14 | **Emoji tactile lab** | `?emoji` (hidden) | Springs, momentum knob, 2D wave equation on Canvas2D, FM audio | Unfinished (see §3) |
| 15 | **Atomize media** | Offline Node tool | Image or QR → atom point-art `.xyz`/`.lammpstrj` | Fun output; no in-browser path |
| 16 | **Native iPhone Room AR** | `apps/mobile` | Viro 2.57.5 + ARKit: plane placement, drag, pinch, rotate, haptics | Source-only; no device receipt |

### 2.1 GPU Studio snowglobe (the best existing toy)

- **Lifecycle** (`gpu-studio/runtime.ts:60-431`)
  - Opt-in and event-rendered: frames draw only on control change, rotation, or snow energy (`:122-148`).
  - DPR capped at 1.5, ACES tone mapping, adapter asked for `high-performance` (`:151-166`).
  - A local 128 px `RoomEnvironment` PMREM, so no HDR fetch (`:189-199`).
  - One `InstancedMesh` per element group (`:229-274`).
  - Controls: Light angle slider (`:282-288`); Atom focus dims the other types to 8% emphasis (`:249-254, 418-423`).
- **Interior shader** (`gpu-studio/atom-surface.wgsl:5-42`)
  - A "refracted miniature world" inside every atom sphere.
  - 28 analytic glitter trajectories per sphere, hashed per instance (`seed = instanceIndex`), blended between a resting "snow bed" and a swirl by `sqrt(energy)`.
  - Refracted view ray, pearlescent rim, `fwidth` anti-aliasing, and a softbox highlight.
  - The `contours` look is decorative sine banding (`:48-53`).
- **Snow motion** (`gpu-studio/snow-motion.ts:1-33`)
  - Display-only inertia: kick adds energy ≤1 with drift clamped to [-1, 1].
  - Energy decays `exp(-0.58·dt)` and drift `exp(-1.8·dt)`; it stops below 0.006, which is the "about 9 s to rest" in `docs/gpu-studio-launch.md:32-34`.
- **Input**
  - Dragging the canvas stirs the snow (`runtime.ts:308-329`).
  - "Shake it" and "Settle snow" buttons.
  - Reduced motion gives one new still composition per press (`runtime.ts:294-302`).
- **Phone motion** (`snow-motion.ts:43-124`)
  - `DeviceMotionEvent.requestPermission()` is called before any `await`, for iOS user activation (`:57-58`).
  - Samples are throttled to 50 ms (`:84`) and ignored below a 1.2 m/s² threshold (`:107`), rotated by screen orientation, with a 5 s no-data fallback (`:72-77`).
  - No storage and no telemetry (`:42`).
- **Limits**: 5,000 atoms (`gpu-studio/snapshot.ts:4, 35-38`). Bonds, annotations and fields are excluded; the modal says so (`docs/gpu-studio-launch.md:9-22`).
- **Assessment**: genuinely delightful and tactile, but four steps deep (open molecule → find "GPU" → Studio → Shake). Phone motion is a nested opt-in. It never appears on the landing page.

### 2.2 Scan and gist particle stage

- **Particle budget**: `pickParticleCount` gives 120k on desktops with 12+ cores and 8+ GB, 30k on phones, low memory or ≤4 cores, and 60k otherwise. `?particles=N` accepts 1k–400k (`scan/gist/gistParticles.ts:30-48`).
- **Device**: requires the `maxStorageBuffersInVertexStage: 1` limit (`:94`).
- **Renderer chain**: particles → swirl → CSS ring. Reduced motion or no `navigator.gpu` goes straight to CSS (`scan/gist/GistStage.tsx:13, 123-159`).
- **Kernel** (`scan/gist/gist-step.wgsl`)
  - Per-particle 64-byte struct: pos, vel, glow, nrm, packed RGBA, home, homed (`:7-21`).
  - SDF library: sphere, ellipsoid, box, cylinder, capsule, cone, torus, lathe, arc, with `smin` blending, an n³ volume grid, and a front-depth map (`:104-253`).
  - Motion: a ring swirl with breathing height (`:293-300`), a spring onto the surface, a weak anchor pull, and shimmer (`:302-347`).
- **Photo behavior**
  - Particles are born as the photo's pixels and carry those colours (`docs/scan-pipeline.md:318-323`).
  - A SAM 3D reconstruction assembles "bottom-up over ~2.5 s", then the camera orbits (`docs/scan-pipeline.md:237-245`).
- **Assessment and gaps**
  - Visually the richest effect in the repo.
  - **No pointer or touch interaction with the particles.** There are no pointer listeners in `GistStage.tsx`, `gistParticles.ts` or `gistEngine.ts`. The camera spins at `TURN_RATE = 0.28` (`ScanPage.tsx:43`), but the user cannot grab, orbit, poke, or scatter the cloud.
  - Needs `HF_TOKEN`, otherwise "not switched on" (`ScanPage.tsx:597-600`).
  - The camera is hand-rolled (`gistEngine.ts:222-262`).

### 2.3 "Type candy, the particles form candy" (`switcher/SwitchStage.tsx:1-128`)

- The query settles after 380 ms and must be ≥3 characters and not a formula or element (`:23-34`).
- It is sent to `/v1/scan/gist` as `{text}`, and the Jev sculpt loop then refines the shape (`:79-97`).
- It collapses for the session if the edge is unconfigured (`:83-86, 116`).
- It is mounted **only** inside `MoleculeSwitcher` in the viewer (`switcher/MoleculeSwitcher.tsx:226`), not in the landing `MoleculeFinder`. The landing search box, the first thing a visitor touches, has no stage.

### 2.4 Action light plus elastic buttons

- **Motion** (`action-light/motion.ts`)
  - Spring k=360, c=21 (`:3`), integrated in ≤1/120 s substeps so a busy scene doesn't slow the spring (`:46-55`).
  - Writes only CSS vars and never the hit area (`:8-10`).
  - Touch doesn't drag the decoration while the user scrolls (`:75-77`).
  - Disabled under reduced motion and forced colors (`:26`).
- **Light** (`action-light/runtime.ts`)
  - One shared vgpu device at `low-power` for all buttons; the last consumer disposes it (`:157-178`).
  - Shader: a Gaussian "lens" at the pointer plus a spectral cosine palette, an expanding ring, and filaments (`action-light.wgsl:1-21`).
  - Each burst stops after 700 ms (`LupiActionButton.tsx:51-61`).
- **Assessment**: exemplary "cost nothing when idle" engineering. Used on only 3 buttons.

### 2.5 Scene looks and Remix

- **Looks**: Studio, Paper, Night and Prism, applied as one-shot store patches (`sceneLooks.ts:3-8, 14-59`).
  - Presentation only. No bloom, DoF, transmission, or animated backdrops (`:11-13`).
  - Scenes of ≥25k atoms use the diagram path with no environment map (`:15, 30-31, 53-54`).
- **Remix** (`sceneRemix.ts:76-134`)
  - Randomizes material, background, lights, colours, filter shell, postprocess, and an optional decorative atom palette.
  - Keeps an 8-deep undo history per file (`StudioControlDeck.tsx:12, 27-35`).
  - The copy reads "Make a little wonder… same science, more personality." (`StudioControlDeck.tsx:45-46`).
  - Reduced motion pauses background motion (`:31`).
- **Gaps**
  - Changes snap instantly, with no interpolation or tween between looks.
  - Uses `Math.random` with no seed, so a remix can't be named or shared as a seed (it can only be shared as a saved view).

### 2.6 Procedural math backdrops (`ProceduralBackground.tsx`)

- **Variants**: manifold-field, hopf-current, harmonic-bloom, reaction-lattice and moire-crystal (`:6-12`; presets at `backgroundPresets.ts:269-318`).
- **Math** (`:98-170`)
  - Parametric torus-knot "Hopf current" strands (`:104-121`).
  - Fibonacci-sphere cells with wobble (`:122-137`).
  - Three-axis moiré planes (`:138-156`).
  - Spherical harmonic bands (`:157-170`).
- **Rendering**: a GLSL gradient skydome follows the camera (`:234-277`), and `ProceduralMathField` rotates slowly (`:279-299`).
- **Gap**: not pointer- or sensor-reactive; time only.

### 2.7 Small visual touches

- **`MoleculeShadow`**: a fake blob on the shell floor that slides opposite the key light (`MoleculeShadow.tsx:1-11, 62-77`).
- **`MoleculeFilterShell`**: haze, cryo, prism and graphite glass (`MoleculeFilterShell.tsx`).
- **`CameraFocus`**: lerps the camera to a clicked atom with fixed per-frame factors 0.14 and 0.07, which is frame-rate *dependent* (`CameraFocus.tsx:6-9`), unlike `grabMath.dampFactor` (`xr/grabMath.ts:177-183`).

### 2.8 Springs and sound

- **`lib/spring.ts`**: Euler–Cromer spring with default k=520, c=20 (ζ≈0.44) and a max step of 1/30 s (`:11-14, 38, 45`).
- **`usePressSpring`**: writes `transform` directly with no React re-render and self-stops (`hooks/usePressSpring.ts:29-39`). Used by viewer controls (`controls.tsx:110, 166, 199, 230`; `studio/primitives.tsx:105, 580, 629`).
- **`lib/clickSound.ts`**: "Opt-in and OFF by default — a scientific tool shouldn't make noise" (`:8-9`).
  - No UI calls `setClickSoundEnabled`; the grep found no callers outside the module. The toggle described in `CONTROLS_RELEASE_NOTES.md` ("Look: … click-sound toggle") is stale.

### 2.9 XR grab, throw and bounce (`xr/XRMoleculeInteraction.tsx`, `xr/grabMath.ts`)

- One-hand rigid grab about the grab point; two-hand translate, rotate and scale.
- Damping via `1-exp(-rate·dt)` (`grabMath.ts:177-205`); angular velocity from a quaternion delta for throw spin (`:207-222`).
- Physics: gravity 6.5 m/s², restitution 0.45, floor friction 0.78, a 1.06 squish pulse (`XRMoleculeInteraction.tsx:56-68`).
- Entry: an ease-in placement 1 m ahead at 0.85 m height (`SpatialAnchor.tsx:17-36`).
- **Only in immersive sessions** (`XRMoleculeInteraction.tsx:79-81, 128, 188`). The 2D viewer (mouse or phone touch) gets none of this throw, spin-inertia or squish feel; it has only OrbitControls damping.

---

## 3. Half-built, hidden and dead-end features

| Item | State | Evidence |
|---|---|---|
| `EmojiPlayground` ("The Lupi Tactile Eoji Lab") | Hidden route `?emoji`. Styling uses 97 Tailwind `className`s but **no Tailwind exists in any package.json or PostCSS config**, so it probably renders mostly unstyled (UNVERIFIED visually). Title typo "Eoji". Pulls **external images** from `lh3.googleusercontent.com` ("Stitch spec sheets"). Creates a **new `AudioContext` per sound**. Its spring calls `setState` every frame. Last touched 2026-07-21. | `EmojiPlayground.tsx:4-42, 45-52, 745-758, 772`; commit `bd1857d` |
| Emoji lab's 2D wave equation (160×160, damping 0.985, pointer excites ripples) | A real, fun ripple toy stranded in the hidden page | `EmojiPlayground.tsx:537-640` |
| `MobileHUD.tsx` (262 lines; tactile toggles, speed slider, FM audio) | **Not imported anywhere.** Only store comments reference it. | grep; `store.ts:487, 1483` |
| `GhostAtoms` (overlay a second structure) | Rendered only when `ghostFile` is set; **`setGhostFile` has no callers** | `GhostAtoms.tsx`; `store.ts:1368`; `ViewerScene.tsx:484` |
| `SceneLandingPage` + `MillionAtomPreview` (Canvas2D FCC lattice with orbit, slice, colour and density modes) | Reachable only at `/scenes/1m-copper-lattice`, which `main.tsx` now retires, so it is **unreachable**. It is also the only animated landing-style preview in the repo, and it is 2D-canvas only. | `main.tsx:40-44`; `ViewerApp.tsx:806-807`; `MillionAtomPreview.tsx:10-101` |
| `BillionAtomsPage` | Hidden `?billion-atoms`; not linked from the UI; own Canvas with DPR [1, 1.5] | `BillionAtomsPage.tsx:83-117` |
| Atom trails | Code comment says "selected & annotated", but only **annotated** atoms are tracked. Annotating needs **Shift+click + `window.prompt`**, so it is effectively unreachable on phones, and trails move only in trajectories. The human annotation surface is listed as P1 recovery. | `ViewerScene.tsx:284-288, 686-692`; `docs/historical-recovery-inventory.md:28` |
| Click-sound synth | Implemented and persisted to localStorage, **no toggle UI** | `lib/clickSound.ts` |
| `@rive-app/react-canvas ^4.28.6` | Declared in `packages/ui` and `apps/web`, **no imports** in source | `packages/ui/package.json:34`; grep |
| Adaptive DPR / performance regression | Recovery doc says "Adaptive DPR … already recovered in `effbc859`". Current viewer uses a **static** `dpr={[1, 1.25 or 1.75]}` with no `PerformanceMonitor`/`AdaptiveDpr`. Status UNVERIFIED/regressed. | `docs/historical-recovery-inventory.md:30`; `ViewerCanvas.tsx:19-35, 76` |
| `nouls` sculpt mode | Tried and rejected as uncalibrated; kept on the route for tuning | `docs/scan-pipeline.md:332-339` |
| Gaussian-splat reconstruction Space | Broken upstream; the points format is ready for splats | `docs/scan-pipeline.md:249-253` |
| "Revolve skips alignment" | A one-line change "waiting on a second such photo" | `docs/scan-pipeline.md:278-281` |
| `apps/remotion-trailer` | Stale "ATLAS" branding and claims ("WEBGPU POWERED", "4x MSAA"); 2D only (no `@remotion/three`); uses `VideoPlaceholder` | `apps/remotion-trailer/README.md:1-40`; `package.json:19-27` |
| `tools/atomize-media.mjs` | Offline only (Node `canvas` + `qrcode`). Outputs a QR code or image as atoms (`public/generated/atomized/lupi-live-qr-atomized.*`, `pulse-grid-atomized.*`, `public/social-qr/*.xyz`). No in-browser "atomize my photo or name". | `tools/atomize-media.mjs:1-38` |
| Retired, do not revive | Comparison Theater, synthetic research panels (RDF/MSD/Voronoi/phonon/GNN "analysis" that computed nothing), and GPU decoration on home | `docs/product-ownership-contract.md:175, 183`; `docs/historical-recovery-inventory.md:55-57`; `docs/product-reset-2026-09-04.md:21` |

---

## 4. Written constraints and principles (every new idea must satisfy these)

### 4.1 Product boundary

- The contract wins over any roadmap. The owned loop is `open/search/upload → inspect → measure/analyze/provenance → save/reopen → export/share` (`docs/product-ownership-contract.md:14-22`).
- Public nav: Explore, Library, How to use, Open a file (`:56`). In-viewer controls: Learn, Style, Data, Camera, Export, Elements/Switch (`:67-69`).
- "Historical UI is recoverable from Git, not retained as hidden production code" (`:82`). By that rule, `EmojiPlayground`, `MobileHUD` and `GhostAtoms` are contract debt.

### 4.2 Honesty and labeling

- "The viewer must distinguish supplied structure/properties from inferred visual convenience and must not promote an inference into evidence" (`product-ownership-contract.md:113-115`).
- Required phrasing precedents:
  - GPU Studio: "decorative sphere shading, not electron density, orbitals, energies, a simulated result" and "illustrative material, not a particle solver or molecular dynamics" (`docs/gpu-studio-launch.md:15-17, 45-47`; `atom-surface.wgsl:5-6`; `snow-motion.ts:1`).
  - NEB smoothing: "geometric morph (not dynamics)" (`science/SciencePathPanel.tsx:997-1012`).
  - Remix: "Molecular data is unchanged" (`StudioControlDeck.tsx:34`).
  - Every model-derived number on `/scan` is labeled "inferred" (`docs/scan-pipeline.md:545-546`; `GistStage.tsx:204-216`).
  - Landing: "coordinate models, not photographs" (`GallerySection.tsx:87-90`).
- A student collection entry needs a coordinate file, an observation prompt, a preview, and content-steward review (`product-ownership-contract.md:78-82`).

### 4.3 Landing weight

- "Do not import Three.js, React Three Fiber, postprocessing, or viewer-native rendering into `LandingShell`" (`docs/ux-redesign-2026.md:61-63`).
- The reset measured the homepage at 3,466 px with 0 canvases, versus 16,551 px with 2 canvases before (`product-reset-2026-09-04.md:74-77`).
- The test enforces 0 canvases (`tests/ui/student-surface.spec.ts:9, 62`).
- Precedent for a light GPU layer on a non-viewer route: `/scan` lazily imports vgpu only when needed (`GistStage.tsx:145`), and action-light never requests an adapter on page load (`action-light/runtime.ts:157-158`).

### 4.4 Reduced motion and forced colors

- Honored in: GPU Studio (`runtime.ts:77, 132, 298, 342`), action light and motion (`motion.ts:26`; `LupiActionButton.tsx:34`), scan (`GistStage.tsx:127-131`; `swirl.ts:12`), `MillionAtomPreview.tsx:23`, press springs (`usePressSpring.ts:87`), Remix (`StudioControlDeck.tsx:31`), and CSS (`student-home.css:792`; `global.css:1262, 1291`).
- The pattern: under reduced motion, give **a new still frame per action** rather than a loop (`runtime.ts:297-298`).

### 4.5 Sensors and permissions

- Request only from an explicit click, before any `await` on iOS.
- Require a secure context.
- Throttle, ignore hidden pages, stop on opt-out, close or failure.
- Give an honest fallback after 5 s.
- Store nothing and send no telemetry.
- Always keep button and drag alternatives. (`docs/gpu-studio-launch.md:53-59`; `snow-motion.ts:42-124`)

### 4.6 Performance and devices

- **DPR caps**
  - Viewer: 1.25 on mobile and low tiers, 1.75 on desktop and high (`ViewerCanvas.tsx:19-24`).
  - GPU Studio: 1.5 (`runtime.ts:162`).
  - Action light: `[1, 1.5]` (`action-light/runtime.ts:181`).
  - Scan: `[1, 2]` (`swirl.ts:91`; `gistParticles.ts:95`).
  - Billion page: `[1, 1.5]` (`BillionAtomsPage.tsx:103`).
- **Mobile postprocess**: SSAO, bloom and DoF off; MSAA ≤2 (`postprocess/presets.ts:128-136`).
- **Mobile quality**: tier 0 uses an analytic environment instead of PMREM for tile GPUs (`deviceCapabilities.ts:57-65`).
- **Atom limits**
  - Global ceiling 50M atoms; picking up to 5M (`deviceCapabilities.ts:30, 40`).
  - GPU Studio 5k; looks treat ≥25k as large; remix ≥20k (`sceneRemix.ts:99`).
- **Idle cost**: event-rendered or self-stopping loops are the norm for decorative layers (`runtime.ts:122-148`; `swirl.ts:75-79`; `LupiActionButton.tsx:51-61`; `usePressSpring.ts:34-36`). The main viewer is the exception: it renders continuously.
- **Bundles**: viewer about 1 MB gzip (`main.tsx:26`). WebGPU is split as `vendor-three-webgpu` (about 175.66 kB gzip) plus vgpu (about 5.89 kB) (`apps/web/vite.config.ts:334`; `docs/gpu-studio-launch.md:142-145`).
- **Assets**: GPU Studio allows no external textures, HDRs or data providers (`docs/gpu-studio-launch.md:22, 189`). Backgrounds are local files under `/backgrounds/` (`backgroundPresets.ts:321-355`).

### 4.7 Lazy WebGPU and fail-soft

- Every WebGPU feature validates one submitted frame inside an error scope before advertising itself (`runtime.ts:385-394`; `swirl.ts:101-111`; `action-light/runtime.ts:193-199`).
- Device loss leads to a closable fallback, "never a false WebGPU-active badge" (`docs/gpu-studio-launch.md:37-39`).
- The regular viewer stays WebGL2 (`:26`).

### 4.8 Analytics

- About 12 funnel events. "AHA" is `molecule_interacted`, fired on the first OrbitControls start per file (`analytics/events.ts:1-16`; `ViewerScene.tsx:743-752`). Scan adds `scan_started/identified/molecule_opened`.
- Props are PII-stripped (`analytics/track.ts:59-66`).
- Scan logs never include the image, hint, subject or molecule names (`docs/scan-pipeline.md:516-521`).
- Success targets: first live structure under 10 s, first rotate or zoom under 20 s (`docs/ux-redesign-2026.md:155-157`).
- **Coverage gap**: no events for delight features (Shake, Remix, looks, GPU Studio open, phone motion). New fun features would need to extend the taxonomy deliberately.

### 4.9 Release truth

- Local checks do not prove deployment. Phone-sensor and WebGPU acceptance on real devices is explicitly unproven (`docs/gpu-studio-launch.md:58-59, 116-120`; `docs/mobile-expo.md:3`).

---

## 5. Mobile specifics

- **Breakpoint**: one query, `(max-width: 640px), (max-height: 500px) and (max-width: 900px)` (`hooks/useMediaQuery.ts:8`).
- **Layout**
  - Deck as a bottom bar (`global.css:1156, 1210-1224`).
  - Style opens a bottom sheet, `--scene-sheet-height: min(360px, 48dvh)`, and the viewport shrinks above it so the molecule stays visible (`global.css:1146-1149`).
  - Other panels: `clamp(240px, 34dvh, 320px)` (`global.css:733, 1303`).
  - Safe-area insets throughout; timeline 64 px plus inset (`ViewerApp.tsx:823`).
- **Gestures**
  - OrbitControls: one-finger rotate, pinch zoom, two-finger pan.
  - Tap an atom to inspect, only when ≤5M atoms (`ViewerApp.tsx:755-758`).
  - GPU Studio: drag stirs the snow; shake with an opt-in motion sensor.
  - Not supported: no double-tap-to-focus, no long-press, no swipe between molecules, no pull-to-remix, no flick-to-spin inertia beyond damping.
- **Sensors**
  - Only `devicemotion`, only in GPU Studio.
  - No `deviceorientation`/gyro parallax, no `navigator.vibrate` haptics, no ambient light anywhere in web (grep).
  - The native app uses `expo-haptics` in 8 files (`apps/mobile/src/...`).
- **Budgets**
  - DPR 1.25; postprocess reduced; scan particles 30k; quality tier 0.
  - `BillionAtomsPage` defaults phones to Low, about 430k impostors (`:26-38`).
- **WebXR**
  - Buttons appear only when `isSessionSupported` (`xr/XREntryButton.tsx:41-52`).
  - iPhone Safari has no `immersive-ar` (general web-platform knowledge, UNVERIFIED here), so iPhone AR goes through the native app's **Room**: Viro and ARKit, plane placement, drag, pinch, two-finger rotate, atom select and measure, occlusion, haptics. Source-implemented, not device-proven (`docs/mobile-expo.md:247-252`).
- **Native shell**: `apps/mobile` is Expo SDK 57 wrapping the web viewer in a WebView (`#/embed/mobile`). Back-swipe is disabled so horizontal drags rotate the molecule (`apps/mobile/README.md:1-21`).

---

## 6. Gaps: where it is a scientific tool rather than a toy, and the biggest delight opportunities

### 6.1 Tool vs toy: where the experience reads as a tool today

1. **No first-screen wonder.** The landing is text, thumbnails and forms, with zero motion, by design. The first moving thing appears only after a click and a roughly 1 MB download, preceded by a text-only splash.
2. **The molecule arrives dead still.** There is no entrance, no idle breathing or turntable, no molecule-to-molecule transition (Switch swaps in place), and no response to cursor proximity.
3. **Touch is utilitarian.** Rotate, zoom, tap to inspect. Nothing responds to *how* you touch: velocity, flick, shake, tilt, or long-press.
4. **The best toys are buried.** Snowglobe: header → modal → button. "Particles form the thing": viewer → Switch. Remix: Style panel. Trails: Shift+click with a prompt dialog. Click sound: no toggle.
5. **Effects are one-way.** The scan particles, procedural backdrops and snowglobe mostly play *at* you. Only the snowglobe accepts drag input, and the particle cloud cannot be touched.
6. **Instant state swaps.** Looks, Remix and colour changes snap with no animated interpolation, which misses the "feel".
7. **Sound and haptics are off or missing on the web.** Sound is synthesized but opt-in with no toggle; the web has no vibration.
8. **Hidden showpieces.** `?billion-atoms` and the atomize-QR assets are delightful "whoa" moments with no entry points.

### 6.2 Opportunity map

Each opportunity is framed as problem → capability → where it plugs in.

| Opportunity | Why (problem) | Existing hook to build on | Constraint to respect |
|---|---|---|---|
| **Landing "living hero"**: a small vgpu particle field or cheap molecule that reacts to cursor or tilt, loaded after first paint | First screen has zero wonder | `MillionAtomPreview` (Canvas2D pattern), `gistParticles` (vgpu, already lazy on `/scan`), `action-light` (shared low-power device) | No three/R3F in `LandingShell`; the zero-canvas test; reduced-motion still frame; product decision to lift the "no GPU decoration" rule (`product-reset:21`) |
| **Finder stage on the landing**: typing "candy" forms candy right under the home search box | The first interaction is a text box | `SwitchStage` + `GistStage` + `/v1/scan/gist {text}` | Same landing-weight rule; hide when edge unconfigured; "inferred" labels |
| **Molecule entrance and transitions**: atoms fly in from a cloud, or morph from the previous molecule on Switch | Molecules pop in dead-still | Gist "assemble bottom-up" wave (`scan-pipeline.md:237-245`); GPU-side interpolation (`scene/interpolation.ts`) | Label "decorative transition, not a reaction"; skip for >N atoms; reduced motion = cut |
| **Flick-to-spin inertia and squish on 2D touch and mouse** | OrbitControls damping feels generic | XR `angularVelocityFromDelta`, `dampQuaternion`, squish pulse (`grabMath.ts:177-222`; `XRMoleculeInteraction.tsx:56-68`) | Must not alter data or camera save semantics; reduced motion = no inertia |
| **Poke the particles**: pointer or touch repels, attracts or scatters the scan cloud, and it re-settles | 60k–120k particles and none are touchable | `gist-step.wgsl` already has spring-to-home and swirl terms; add a pointer uniform | Decorative only; phone budget 30k |
| **Tilt parallax and "shake to remix"** on phones | Phones feel like small desktops | `enablePhoneSnow` permission pattern (`snow-motion.ts`) | Explicit-gesture permission, local only, fallback buttons |
| **Tweened looks and Remix** (animated interpolation over the ~40 presentation keys) and a **seeded remix** ("remix #4821" shareable) | Remix snaps; not shareable as a seed | `REMIX_KEYS` (`sceneRemix.ts:76-87`); injectable `random` param already exists (`:96`) | Presentation keys only; undo stack |
| **Snowglobe-style pocket materials in the main viewer** or as a Remix option | The best shader is quarantined in a modal with a 5k cap | `atom-surface.wgsl` exported via vgpu `tslExports`; three r184 node materials | WebGPU-only today (main viewer is WebGL2); keep the "decorative" label |
| **Pointer- and audio-reactive procedural backdrops** | Backdrops only move with time | `ProceduralBackground` uniforms (`:236-252`) | Background motion paused under reduced motion |
| **Sound and haptics pass**: surface the click toggle, reuse one `AudioContext`, add `navigator.vibrate` on Android for snaps and landings | Tactile work exists but is silent or unreachable | `lib/clickSound.ts`; Emoji FM synth recipes | Off by default ("a scientific tool shouldn't make noise"); no vibrate on iOS web |
| **In-browser "atomize me"**: your name, a QR code or a selfie becomes an atom sculpture you can spin and share | Atomize is Node-only | `tools/atomize-media.mjs`; `/scan` photo prep (`scan/identify.ts`) | Label as "atom art, not a molecule"; no upload needed (on-device) |
| **Surface the showpieces**: "Zoom into a billion atoms" and "Shake a molecule" as playful entry cards | Delight is behind hidden routes | `?billion-atoms`; GPU Studio | Honest HUD already present |
| **Ask-the-library as a game**: "What floats in water?", "Heaviest metal?" on the landing | Property ranking lives only in the Switch panel | `docs/jev-property-ranking.md:7-20` | Jev labels; configured-false fallback |
| **Trails for everyone**: touch-friendly "follow this atom" instead of Shift+prompt | Trails are unreachable on phones | `AtomTrails.tsx`; annotation store | Trajectories only |
| **Perf headroom to spend on fun**: `frameloop="demand"` + `invalidate`, drei `PerformanceMonitor`/`AdaptiveDpr` | Continuous render on idle phones; static DPR | `ViewerCanvas.tsx:67, 76` | Export parity (`ExportManager` controls DPR and frameloop itself, `ExportManager.tsx:455-521`) |

### 6.3 Math duplication inventory (relevant to adopting a shared math library)

| Concern | Implementations today |
|---|---|
| Springs | `lib/spring.ts` (Euler–Cromer, pure, tested); `action-light/motion.ts:3, 46-55` (same integrator, substeps); `EmojiPlayground.tsx:4-42` and `MobileHUD.tsx:5-43` (explicit Euler + setState, duplicated) |
| Exponential damping | `xr/grabMath.ts:177-205` (frame-rate independent); `snow-motion.ts:69-80` (exp decay); `swirl.ts:20, 65-66` (fixed `EASE=0.08` per frame, frame-rate dependent); `CameraFocus.tsx:6-9` (fixed lerp, frame-rate dependent) |
| Easing and curves | `flythrough.ts:9-13, 58-67` (6 easings, cubic Bézier with tension) |
| Matrices and camera | `scan/gist/gistEngine.ts:222-262` (hand-rolled lookAt + WebGPU-depth perspective); elsewhere three.js `Vector3`/`Quaternion` |
| Hashes and noise | `ProceduralBackground.tsx:26-32` (sin-hash); `atom-surface.wgsl:1-3`; `scan-swirl.wgsl:12-39` (hash21, value noise, fbm); `gist-step.wgsl:94-103` (hash13/33) |
| Sampling | Fibonacci sphere (`ProceduralBackground.tsx:123, 153, 166`); SDF primitives and `smin` (`gist-step.wgsl:104-253`) mirrored on CPU (`packages/core/src/gist/`) |

**Installed pmndrs stack** (`pnpm-lock.yaml`):

- `@react-three/fiber` 9.6.1, `@react-three/drei` 10.7.7, `@react-three/xr` 6.6.29.
- `@react-three/postprocessing`: 2.19.1 **and** 3.0.4 both resolved. `apps/web` declares `^2.16.0` while `packages/ui` declares `^3.0.0` (`apps/web/package.json:21`; `packages/ui/package.json:32`).
- `postprocessing` 6.38.3, `three` 0.184.0, `leva` 0.10.1, `vgpu` 0.4.0.
- `maath` 0.10.8 and 0.6.0, only transitive (via drei). No direct `maath` or `math` imports in source.

---

## Sources (file references)

- `apps/web/src/main.tsx:21-71, 100-128, 151-258`
- `packages/ui/src/App.tsx:1-19`; `packages/ui/src/viewer/viewerRoutes.ts:39-64`
- `packages/ui/src/LandingShell.tsx:8-41`; `packages/ui/src/landing/LandingPage.tsx:13-49`; `landing/MoleculeFinder.tsx:24-215`; `landing/MoleculeWall.tsx:5-78`; `landing/GallerySection.tsx:4-93`; `landing/SiteHeader.tsx:9-29`; `landing/SceneLandingPage.tsx:40-135`; `landing/MillionAtomPreview.tsx:10-128`; `landing/DropZoneSection.tsx`; `landing/student-home.css:693, 792-796`
- `packages/ui/src/ViewerApp.tsx:113-126, 609-1025`; `viewer/ViewerCanvas.tsx:19-89`; `app/ViewerScene.tsx:284-288, 460-761`; `app/AppHeader.tsx`; `app/ViewerCommandDeck.tsx:14-26`; `app/ViewerGestureHint.tsx`; `PanelHost.tsx`
- `packages/ui/src/gpu-studio/runtime.ts`, `atom-surface.wgsl`, `snow-motion.ts`, `snapshot.ts:4-39`, `GpuStudioLaunch.tsx:66-173`
- `packages/ui/src/scan/ScanPage.tsx:43, 99-102, 581-608`; `scan/ScanShell.tsx`; `scan/swirl.ts`; `scan/scan-swirl.wgsl`; `scan/gist/GistStage.tsx`; `scan/gist/gistParticles.ts:30-100`; `scan/gist/gist-step.wgsl`; `scan/gist/gistEngine.ts:222-262`; `scan/gist/gistClient.ts:145`
- `packages/ui/src/switcher/SwitchStage.tsx`; `switcher/MoleculeSwitcher.tsx:226`
- `packages/ui/src/action-light/motion.ts`, `runtime.ts`, `action-light.wgsl`; `LupiActionButton.tsx`
- `packages/ui/src/StudioControlDeck.tsx`; `sceneLooks.ts`; `sceneRemix.ts`
- `packages/ui/src/ProceduralBackground.tsx`; `backgroundPresets.ts:255-355`; `MoleculeShadow.tsx`; `MoleculeFilterShell.tsx`; `CameraFocus.tsx:6-9`; `AtomTrails.tsx`; `GhostAtoms.tsx`; `flythrough.ts:1-67`
- `packages/ui/src/lib/spring.ts`; `lib/clickSound.ts`; `hooks/usePressSpring.ts`; `hooks/useMediaQuery.ts:8`
- `packages/ui/src/EmojiPlayground.tsx`; `packages/ui/src/MobileHUD.tsx`; `packages/ui/src/BillionAtomsPage.tsx`
- `packages/ui/src/xr/XRMoleculeInteraction.tsx:1-68, 79-81, 343-396`; `xr/grabMath.ts:1-222`; `xr/XREntryButton.tsx:37-52`; `SpatialAnchor.tsx:17-36`
- `packages/ui/src/deviceCapabilities.ts:30-89`; `postprocess/presets.ts:128-136`; `analytics/events.ts:1-73`; `analytics/track.ts:59-66`
- `apps/web/src/styles/global.css:733-753, 846-852, 1146-1160, 1210-1303`; `apps/web/vite.config.ts:316-345`
- `apps/web/package.json:19-40`; `packages/ui/package.json:23-45`; `pnpm-lock.yaml:2909-2977, 5871, 6047-6053, 6566, 7419, 7733`
- `tests/ui/student-surface.spec.ts:9, 62`
- `tools/atomize-media.mjs:1-38`; `apps/web/public/generated/atomized/*`; `apps/web/public/social-qr/*`
- `apps/remotion-trailer/README.md`, `package.json`; `apps/mobile/README.md:1-21`; `apps/mobile/package.json:34-71`
- Docs: `LUPINE.md`; `docs/product-ownership-contract.md`; `docs/product-reset-2026-09-04.md`; `docs/ux-redesign-2026.md`; `docs/gpu-studio-launch.md`; `docs/scan-pipeline.md`; `docs/jev-property-ranking.md:1-40`; `docs/historical-recovery-inventory.md:18-57`; `docs/mobile-expo.md:3, 244-256`; `MOBILE_VIEWER_RELEASE_NOTES.md`; `CONTROLS_RELEASE_NOTES.md`; `CHANGELOG.md:1-90`
