# Science toys and playful molecular visualization: ideas for Lupi

Research date: 2026-09-27. Scope: playful or beautiful molecular and scientific visualization on the web and elsewhere, what makes each one engaging, the technique behind it, and how it could carry over to Lupi's R3F viewer. That viewer renders up to hundreds of thousands (and up to ~1M) atoms as ray-cast impostors with bonds and trajectories, and it has an opt-in WebGPU GPU Studio.

External claims carry a URL in the Sources list. Code claims cite `file:line`. **UNVERIFIED** marks anything I could not confirm from a primary or near-primary source.

---

## 0. TL;DR

- **Easiest big visual win: an "Illustrative / Goodsell" look.** The recipe is flat "ignore light" color, depth-discontinuity outlines and ambient occlusion. Mol* ships it as a one-click Quick Style. RCSB's Molecule of the Month made it the house style of popular biochemistry ("flat pastel colors, and black outlines"). Lupi already has the two hard parts: depth-correct ray-cast impostors (`packages/scene/src/AtomsOptimized.tsx:1-40`) and N8AO (`packages/ui/src/postprocess/ScenePostprocessing.tsx:16,49-58`). The missing parts are a no-lighting shader branch and one outline post effect.
- **Direct manipulation with a physical answer is the most common trait of the fun toys.** Examples: Schroeder's IMD (drag and connect atoms), PhET (drop atoms and they snap), NanoVer (pull methane through a nanotube), Particle Life (stir with the mouse) and Sandspiel (paint). Lupi's viewer today is mostly look-but-don't-touch. A shader-side, display-only "poke and jiggle" would give 1M atoms a springy response with O(1) CPU cost.
- **Lupi already owns a WebGPU particle engine it has not pointed at molecules.** The scan and search "gist" stage runs 60,000 particles (`packages/ui/src/scan/gist/gistEngine.ts:68`). They swirl, attract onto a surface and settle on `homes` (`packages/ui/src/scan/gist/gistParticles.ts:14-28`). Today it deliberately stops short: "the molecule itself never gets the effect" (`packages/ui/src/switcher/SwitchStage.tsx:1-8`). Letting "candy" particles settle onto sucrose's real atom positions just before the handoff would be a strong reveal.
- **Emergence, sharing and a daily seed carry casual engagement.** Particle Life and Lenia rely on emergence. Sandspiel's upload and remix culture ("There's a healthy remix culture of people making new takes on popular templates") relies on sharing. Chemicle seeds its molecule of the day by date, so everyone gets the same puzzle. Infinite Craft's combine-and-discover loop was Google's #3 most-searched game of 2024.
- **Sound and AR are cheap multipliers, with platform caveats.** Molecule sonification is an active 2026 research topic (Kim & Heller, arXiv 2601.02652; "Singing Materials", ICAD 2026). A browser precedent maps IR 400–4000 cm⁻¹ to 100–8000 Hz. Lupi already has opt-in Web Audio infrastructure (`packages/ui/src/lib/clickSound.ts:1-11`) and a USDZ Quick Look exporter (`packages/ui/src/export/USDZExportPipeline.ts:1-2`). iPhone Safari still lacks WebXR `immersive-ar` in 2026, so Quick Look is the iPhone AR path. iOS web haptics depend on a hack that Apple narrowed in iOS 26.5.
- **The pmndrs `math` 0.1.0 package (npm `math`, published 2026-09-11) fits several toys directly.** I verified these from the tarball: `math/time` `spring3.update(state, target, smoothTime, dampingRatio, delta)`, `math/geometry` `quickhull3(points)`, `math/ik` `fabrik3`, `math/noise` `curl3`/`simplex3d`/`domainWarp3`, and `math/random` `mulberry32`. They cover springy pokes, VSEPR and coordination polyhedra, tug-a-chain, flow-field swirls and seeded daily puzzles. They are CPU helpers for the few objects a person touches. Anything per-atom at scale still belongs in GLSL/WGSL.

---

## 1. Lupi's baseline (what the ideas build on)

| Asset | Where | Why it matters for toys |
|---|---|---|
| Ray-cast sphere impostors that write correct depth; palette textures; per-type radius palette; far-LOD cluster splats | `packages/scene/src/AtomsOptimized.tsx:1-40` | Screen-space outlines and AO work at 1M atoms. Vertex-shader displacement is free per atom. |
| Interpolation target buffer for trajectories | `packages/scene/src/AtomsOptimized.tsx:16,1289` | Built-in "A→B" position lerp that morph transitions can reuse |
| Rim/backlight uniforms | `packages/scene/src/AtomsOptimized.tsx:81-94,709-711` | Already a stylization lever |
| N8AO + Bloom + DOF + Vignette + ToneMapping presets (`paper`/`studio`/`editorial`/`cinematic`/`diagram`) | `packages/ui/src/postprocess/presets.ts:13-18`, `ScenePostprocessing.tsx:16` | An "illustrative" preset slots straight in |
| GPU Studio (vgpu 0.4.0 + three WebGPU node materials). Snowglobe / Studio light / Graphic contours looks. Capped at 5,000 atoms. DPR ≤ 1.5. Device-motion "Shake it" | `docs/gpu-studio-launch.md:9,20,35,49`, `packages/ui/src/gpu-studio/snow-motion.ts:1-60` | Home for heavier WebGPU toys, already uses `DeviceMotionEvent.requestPermission` |
| Gist particle engine (WGSL step + points, 60k particles, swirl/attract/homes/volume) | `packages/ui/src/scan/gist/gistEngine.ts:68`, `gist-step.wgsl:1-20`, `gistParticles.ts:14-28` | Reusable for "atoms fly in", Particle Life and drawing-to-particles |
| XR grab/pinch, two-hand scale, throw physics with floor bounce | `packages/ui/src/xr/XRMoleculeInteraction.tsx:1-25` | Already a physical toy in XR |
| USDZ Quick Look export | `packages/ui/src/export/USDZExportPipeline.ts:1-2`, `ViewerApp.tsx:131` | AR on iPhone today |
| MP4 export via MediaRecorder, **1920×1080, 5 s only** | `packages/ui/src/panels/FigureExportPanel.tsx:56-61,234-236` | No vertical 9:16 or loop-aware export yet |
| Opt-in procedural click sound (Web Audio, off by default) | `packages/ui/src/lib/clickSound.ts:1-11` | Sound infrastructure and the "opt-in" norm already exist |
| Spring hook + physical-modelled sounds | `packages/ui/src/EmojiPlayground.tsx:3-45` | Prior art for springy UI |
| Atom trails for selected atoms | `packages/ui/src/AtomTrails.tsx:1-13` | Motion "memory" visuals |
| Spatial-hash picking | `packages/scene/src/AtomPicker.tsx:1-6`, `SpatialHash.ts:20` | Neighborhood queries for pokes and polyhedra |
| Home hero is a 2D-canvas FCC lattice sample, not the real renderer | `packages/ui/src/landing/MillionAtomPreview.tsx:10-26` | The first touch a visitor gets is not interactive 3D |
| Product honesty contract: student focus, and inferred lines are "not presented as bond topology". GPU Studio labels its snow "an illustrative material, not a particle solver" | `docs/product-reset-2026-09-04.md:1-4,37`; `docs/gpu-studio-launch.md:15,47` | Every toy below needs an honest "illustrative" versus "from your data" label |

Versions in the repo: `three ^0.184.0`, `@react-three/fiber ^9.6.x`, `@react-three/drei ^10.7.7`, `@react-three/postprocessing ^3.0.0` (and `^2.16.0` in one package), `postprocessing ^6.36.0`, `@react-three/xr ^6.6.29`, `vgpu 0.4.0`. Current npm: three 0.186.1 (2026-09-24), postprocessing 6.39.5 (2026-09-09; 7.0.0-beta.16 on `beta`), @react-three/postprocessing 3.1.3 (2026-09-27), n8ao 2.0.1 (2026-08-10).

---

## 2. Beautiful molecular rendering: looks worth stealing

### 2.1 Mol* (molstar) — illustrative, cel-shaded and path-traced looks
- **What it does.** The Illustrative Quick Style is "spacefill representation" plus postprocessing Outline (adjustable threshold) plus Occlusion (adjustable bias) plus the **"Ignore Light"** option, "the quickest way to emulate @dsgoodsell's coloring style". The Mesoscale Explorer adds six quick styles: Default, **Cel-shaded** ("removed outlines, increased lighting, and enhanced occlusion"), Illustrative, Shiny, Shiny-Illustrative and Shiny-DOF.
- **Relevant changelog history:**
  - `ignoreLight` parameter: v3.37.0 (2023-06-17)
  - depth of field: v4.3.0 (2024-05-26)
  - `celShaded` geometry parameter and `celSteps`: v4.6.0 (2024-08-28)
  - path-traced SSGI "Illumination mode" with progressive sampling, toggled with the "G" key: v4.7.0 (2024-09-29)
  - bloom on transparent and emissive geometry: v5.11.0 (npm 2026-07-19)
- **Technique.** Screen-space AO from the depth buffer, with radius, bias and color. Outlines come from depth or object-ID edges.
- **For Lupi:** add an `illustrative` postprocess preset:
  - an `uIgnoreLight` branch in the impostor fragment shader (base color × AO)
  - a small custom `postprocessing` Effect doing depth-discontinuity edges (optionally type-ID edges, so element or chain boundaries outline too)
  - existing N8AO at higher intensity
  - a pastel palette texture swap, which is O(1) because colors live in a 256×1 palette (`AtomsOptimized.tsx:36-40`)

  All of it is screen-space, so the cost does not grow with atom count. That suits 1M-atom scenes and mobile.

### 2.2 QuteMol — AO and edge cueing (IEEE VIS Test of Time 2021)
- It combines precomputed AO, GPU impostors and **"edge highlighting with variable thickness edges, thicker where the depth drop is greater"**. It handles up to ~10⁶ atoms in real time.
- **For Lupi:** have the outline Effect scale its width with the depth delta. It is the same pass with nicer results, and it tells near-and-far overlaps apart better than a flat-width outline.

### 2.3 Goodsell's *Illustrate*, CellPAINT, VMD outline shaders
- *Illustrate* (Goodsell, Autin, Olson; Structure 2019) computes outlines from "the local derivative of the z-value using a variety of kernels". Outlines mark molecular contours, subunit boundaries and residue-number differences. Soft cone shadows come from z-depth differences. A web interface exists, and the Fortran is on GitHub (ccsb-scripps/Illustrate).
- **CellPAINT** (Scripps, from 2016) is "digital painting software" with **molecular brushes**. You paint membranes, proteins and DNA into a cellular scene. The web version runs in the browser.
- **Molecular Landscapes** watercolors are on PDB-101 under **CC-BY-4.0**, which makes them licensable as backgrounds or loading art with attribution.
- VMD's GLSL outline tutorial gives Goodsell-like material values: Ambient 0.55, Specular 0.4, Diffuse 1.0, Shininess 1.0.
- **For Lupi:** the Illustrative look (§2.1), plus a "paint with molecules" brush mode (§4.3, idea 15). Goodsell's recognizable style helps the "shareable poster" loop directly.

### 2.4 3Dmol.js, Speck and speck-pbr
- **3Dmol.js** has an "Ambient occlusion view style" (2.3.0, 2024-07-31) and an outline mode with a `maxpixels` option. Latest is 2.5.5 (npm 2026-05-22). The `maxpixels` detail comes from a search snippet of the releases page (**UNVERIFIED** in the docs).
- **Speck** (Rye Terrell; public domain) uses impostors, calls AO "easily Speck's most important feature", and adds depth-aware outlines and DOF. Its Hacker News launch did well because the renders were simply pretty.
- **speck-pbr** (same author; MIT) is "A WebGPU molecular visualizer with GPU path-traced global illumination". It has progressive accumulation, DOF, depth-aware outlines, presets (**Default, Toon, Illustration, Licorice, Newspaper**), XYZ trajectories and video export with camera keyframes. Creation date **UNVERIFIED** (GitHub API not reachable from this session).
- **For Lupi:** speck-pbr shows that a WebGPU path-traced "beauty shot" of molecules works in a browser today. three r184 already ships `webgpu_postprocessing_ssgi` and `webgpu_postprocessing_ssgi_ballpool`, which is a scene of spheres (verified in r184 `examples/files.json`). A "Poster" button in GPU Studio could accumulate a path-traced still while the camera is stationary. Its "Newspaper" preset (halftone) points to cheap stylized presets beyond Goodsell: halftone, risograph, blueprint.

### 2.5 ChimeraX looks
- `lighting soft` is ambient only, with "ambient shadowing from 64 directions". `lighting full` adds a key light with shadows. Silhouette edges are a separate toggle. It uses 64 shadow directions by default and 16 for very large structures.
- **For Lupi:** it confirms that silhouettes plus multi-directional AO is the "serious but beautiful" default across the field. For a casual visitor, a single **Look** button that cycles Studio → Illustrative → Cel → Neon (bloom) is more fun than sliders.

---

## 3. Simulations and toys that teach by touch

### 3.1 PhET: Build a Molecule, Molecule Shapes, States of Matter
- **Build a Molecule:** "start from atoms and see how many molecules you can build, collect your molecules, and view them in 3D". Its collection boxes act as goals, and it recognizes molecular formulas.
- **Molecule Shapes (VSEPR):** you add bonds and lone pairs, and the shape re-relaxes to minimize repulsion. It renders with three.js (snippet says three r71; **UNVERIFIED** detail).
- **States of Matter:** heat and cool the particles, change the pressure, and watch solid, liquid and gas change.
- **Why engaging:** instant cause and effect, a small set of verbs, and goals (collect them all). It runs on iPads and Chromebooks.
- **For Lupi:** (a) a **heat slider** on any loaded structure. On static structures it adds display-only thermal jitter, labelled illustrative. On real trajectories it maps to the playback of real data. (b) A **VSEPR toy** built on `math` (§6). (c) "Collect" badges for the curated student collection.

### 3.2 Schroeder's Interactive Molecular Dynamics (Weber State; Am. J. Phys. 83, 210, 2015)
- It runs hundreds of Lennard-Jones particles in HTML5/JS. You can **drag atoms**, and "Connect" draws a spring bond between two atoms (spring constant 100 in natural units). The source is human-readable.
- **For Lupi:** it shows a real (not fake) MD toy is cheap for ≤ a few thousand particles in JS. That fits a "sandbox" side mode: drop 500 argon atoms, heat them, watch them condense.

### 3.3 Concord Consortium Next-Generation Molecular Workbench
- Its HTML5 "Lab" interactives are JSON-authored models with buttons, sliders and graphs. Topics include temperature vs. volume, pressure and gas equilibrium.
- **For Lupi:** the JSON-authored interactive pattern maps onto Lupi's "science bundle" data contracts. Toys could be declarative and curated, like the student collection gate.

### 3.4 VSEPR toys on the open web
- Luminous Learner's VSEPR Shape Explorer drives shape with Coulomb repulsion. PhysSandbox has an AXₙEₘ simulator. A three.js blog series covers "basic repulsion".
- **Technique:** electron domains as charges on a sphere, with Thomson-problem relaxation.
- **For Lupi:** see idea 11.

### 3.5 Crystal lattice tools
- The Materials Project Crystal Toolkit lets you view and transform structures, for example substitute or remove species. Crystals@Otterbein offers unit cells, stacking and interstitial holes.
- **For Lupi:** Lupi already generates procedural lattices, including a 953,312-atom FCC (`MillionAtomPreview.tsx:24`). The fun transfers are:
  - **"swap an element and watch it re-color and re-size"**, which is instant because radius and color live in palette textures
  - **coordination polyhedra** (quickhull3), the VESTA-style look that makes crystals beautiful
  - a slice or cleave plane you drag with your finger

---

## 4. Emergent systems: the mesmerizing class

### 4.1 Particle Life (Ventrella "Clusters" → Tom Mohr → WebGPU ports)
- **Rules:** up to ~8 species, and an **asymmetric** attraction matrix A[i][j] ∈ [-1, 1] ("red can chase green while green flees red"). Membranes, cells, "serpents", rotating suns and predator-prey chases emerge.
- **Clusters** (ventrella.com, updated Feb 2025) has named presets (Pollack, gems, alliances, red menace, acrobats, mitosis, planets, stigmergy, …), trails, freeze and "zap".
- **lisyarus WebGPU (2025-05-15):**
  - **65,536 particles** (CPU version topped out at 4,096)
  - binning via count → parallel prefix sum → scatter with atomics, at **~0.1 ms** on a GTX 1060
  - rendered with additive blending into `rgba16float`, ACES tone mapping and blue-noise dither
- **Ethan Willingham** runs "a hundred thousand particles" in WebGPU. You drag to stir and shift-drag to push. It has 5 local save slots and "Auto-morph" through presets with a hidden flow field.
- **For Lupi, "Molecule Life":**
  - Seed the species and colors from the loaded molecule's elements (CPK palette).
  - Pick the matrix by a seeded RNG (`mulberry32`) or a "chemistry-flavoured" heuristic.
  - Run on the gist engine or a new WGSL kernel in `packages/renderer`.
  - Label it honestly as "toy rules inspired by your molecule's elements".
  - Share the seed in the URL so a creature can be sent to a friend.
  - It is WebGPU-only. Mobile availability caveats apply, which is why it would live beside GPU Studio.

### 4.2 Lenia (Bert Wang-Chak Chan, 2018/2019)
- Continuous Game of Life that produces "geometric, metameric, fuzzy, resilient, adaptive" lifeforms. Its original JS/WebGL simulator is at chakazul.github.io/Lenia, and 3D variants exist (Lenia3D with TF.js).
- **For Lupi:** lower transfer, because it is a grid rather than atoms. It fits better as a background or loading-screen texture (fragment shader) than as a viewer feature.

### 4.3 Falling sand: Sandspiel, Sandspiel Studio, The Powder Toy
- **Sandspiel** (Max Bittker, 2018) is Rust/wasm with WebGL. The author passes a typed-array view of wasm memory straight to a WebGL texture, so rendering blocks the CPU "for less than 1 millisecond". What made it engaging was **uploads and a gallery**: "The added dimension of an audience brings so much depth", and "a healthy remix culture".
- **Sandspiel Studio** (Bittker and Lu Wilson) lets people design new elements with blocks.
- **The Powder Toy** (C++/SDL, GPL) has 258 elements as of Feb 2025, heat, pressure and electricity, and thousands of community saves.
- **For Lupi:** the big lesson is **saved creations with remix**. Lupi already has saved views, so letting people remix another person's view ("Remix this look") is the Sandspiel loop. A literal falling-sand mode is off-mission; an element sandbox for kids is a maybe (tier 2).

### 4.4 Boids
- three r184 includes `webgpu_compute_birds` (mouse disturbs the flock) and `webgl_gpgpu_birds`. Three.js Blocks sells a spatial-grid Boids (WebGPU).
- **For Lupi:** "schools" of water molecules that flee the cursor could play on the landing hero, which today is a non-interactive 2D canvas (`MillionAtomPreview.tsx:10-26`). It is decoration, so label it as such.

---

## 5. Games and engagement mechanics

| Precedent | Mechanic that hooks | Evidence | Lupi translation |
|---|---|---|---|
| **Foldit** | Live score from a physics force field (Rosetta). Legible "bad" markers: **spiky red balls for clashes, red splotches for voids, yellow blobs for exposed hydrophobics**. Verbs: shake, wiggle, rubber bands | Foldit wiki; PMC | An honest **geometry-check overlay**: red spiky markers where interatomic distance < a fraction of summed covalent radii in the user's own file. Fun and true. |
| **Atomas** (Sirnic) | Fuse H+H→He… up the periodic table; "big crunch" when full; 124 atoms to create | App Store / Sirnic | Periodic-table merge mini-game using Lupi's element palette. Tier 2. |
| **Infinite Craft** (Neal Agarwal, 2024-01-31) | Combine two things and an LLM names the result; "first discovery" pride. #3 most-searched game in Google's 2024 Year in Search | Wikipedia | **Molecule craft**: drag molecule A onto B. Jev picks real related molecules or reactions from Lupi's library only, never invented coordinates. |
| **Particle Clicker** (CERN Webfest 2014) | Incremental game that teaches the history of physics | CERN / GitHub | Weak fit; reference only. |
| **Chemicle / Elemendle / Chemdle / Synthordle** | Wordle-style daily puzzle. Chemicle's molecule is **seeded by the day**, so everyone gets the same one | Chemicle page; Chemistry World | **Daily molecule**: silhouette-only (Illustrative outline pass), progressive reveal, guess via search. |
| **RCSB Molecule of the Month** (>300 columns; Goodsell 2000–2024, Janet Iwasa since Jan 2025) | A recurring story with a recognizable art style | PDB-101 | "Molecule of the week" story cards in Lupi's style, built on the curated collection. |

---

## 6. What pmndrs `math` 0.1.0 unlocks for these toys (verified from the npm tarball)

`math` 0.1.0 (npm, 2026-09-11; repo `github.com/pmndrs/math`). Subpath exports: `.`, `./ik`, `./time`, `./color`, `./noise`, `./random`, `./shapes`, `./geometry`. Design: "allocation-free, monomorphic… data-in, data-out functions over caller-owned data". Types are plain arrays. The README install line says `npm install math@canary`.

| API (verified signature) | Toy it enables |
|---|---|
| `math/time` `spring3.update(state, target, smoothTime, dampingRatio, delta)`; `spring3.damp(...)` critically damped ("1 = critically damped (no overshoot), <1 bouncy") | Poke-and-jiggle amplitudes; camera "snap" to picked atom; tug-a-chain spring back to source coordinates |
| `math/geometry` `quickhull3(points: number[]): number[]` (triangle indices; port of three's ConvexHull) | VSEPR electron-domain polyhedra; crystal coordination polyhedra; "shrink-wrap" hull of a molecule |
| `math/ik` `fabrik3` with `JointType.BALL` cone limits / hinges, `solveStructure` | Tug-a-chain: drag one end of a polymer or protein backbone and the chain follows with bond lengths preserved |
| `math/noise` `simplex3d`, `simplex4d`, `curl3(out, sample, x, y, z, eps)` ("divergence-free… particles swirl like a fluid"), `domainWarp3`, `fbm` | Flow fields for "atoms fly in" transitions, Molecule Life hidden fields, looping idle motion (4D noise loops) |
| `math/random` `mulberry32`, `isaac32/64` | Seeded daily puzzle; reproducible generative posters; shareable Particle-Life seeds |
| `math/shapes` `sphere`, `raycast3`, `frustum` | Cheap CPU picking of a handful of interactive objects |

Caveat: these are CPU functions. At hundreds of thousands of atoms, per-atom work must stay in GLSL/WGSL, and `math` handles the few objects a finger touches.

---

## 7. Immersive, AR and tangible

### 7.1 Nanome (Quest + web)
- You reach out and grab, rotate and enlarge, then measure, mutate and dock. Web and Quest users share one live session with cursors and voice.
- **For Lupi:** Lupi's XR already does pinch-grab, two-hand scale and throw with a bouncing floor (`XRMoleculeInteraction.tsx:12-25`). Shared sessions would be the next step (tier 2).

### 7.2 Narupa / NanoVer (Bristol) — interactive MD in XR
- Users tug atoms inside a running physics simulation. Example tasks include "pulling a methane molecule through the centre of a carbon nanotube" and "tying a trefoil knot in a polypeptide".
- NanoVer (arXiv 2606.30678) targets standalone Quest 3/3S.
- **For Lupi:** a display-only "tug" (idea 14) captures the feel without claiming real MD. The honest label is "illustrative pull; snaps back to your data".

### 7.3 moleculARweb, MolecularWebXR, HandMol (Abriata, EPFL; arXiv 2509.04056, 2025-09-04)
- moleculARweb is commodity web AR with printed cube markers (VMK 2.0), or a touch-driven simulated scene (VMK 3.0).
- HandMol adds "real-time molecular mechanics" and "natural language input via a language model".
- **For Lupi:** it proves web-only AR/XR chemistry is viable at school scale. The natural-language control mirrors Lupi's MCP `parseCommand`.

### 7.4 MolAR (Stanford; J. Chem. Phys. 2022-05-28)
- It recognizes **hand-drawn hydrocarbon structures** with deep learning and shows them as 3D AR molecules. It also loads by name or PDB ID and runs cloud quantum chemistry.
- **For Lupi:** direct precedent for Lupi's scan pipeline (photo → molecules). Adding "draw a molecule on paper → scan" is a natural extension (idea 15).

### 7.5 AR on phones
- `<model-viewer>` 4.3.1 (npm 2026-06-04) supports `ar-modes` `webxr` / `scene-viewer` / `quick-look`. If `ios-src` is absent, "the USDZ will instead be auto-generated when the user clicks the AR button on iOS". It also supports `ar-scale="fixed"` and `ar-placement="wall"`.
- An Apple Quick Look link uses `<a rel="ar" href="x.usdz#...">`. Fragment parameters include `callToAction`, `checkoutTitle`, `checkoutSubtitle`, `canonicalWebPageURL` (the share-sheet link) and `custom` HTML banners.
- **Platform status 2026:**
  - Handheld WebXR `immersive-ar` is **not** exposed by iPhone Safari (XRDoctors / TestMu 2026).
  - visionOS Safari supports `immersive-vr` by default, but the AR module is not enabled.
  - One blog claims Safari 18 provides "inline AR sessions backed by ARKit" on iPhone. **UNVERIFIED and likely wrong.**
- **For Lupi:** Lupi already exports USDZ. The quick win is a Quick Look link whose banner says "Open in Lupi", with `canonicalWebPageURL` set to the saved view. Every AR share then leads back to Lupi. Big structures need a baked LOD cap for AR.

### 7.6 Haptics
- **Android Chrome:** `navigator.vibrate` works. Firefox Android removed it (per @haptics docs).
- **iOS Safari has never implemented the Vibration API.** Libraries (`ios-haptics`, `@haptics/react` 2.1.1) toggle a hidden `<input type="checkbox" switch>` (Safari 17.4+).
- Per @haptics docs, **iOS 26.5 patched programmatic triggering**. The surviving path requires a trusted tap directly on an overlay, and fires "single-tick patterns" only. Third-party claims; **UNVERIFIED** by device test.
- So the design is: a tick on tap (select atom, snap bond), no continuous drag rumble on iOS.
- **WebXR:** three r184 has a `webxr_xr_haptics` example (controller pulses).

### 7.7 Tangible models (Olson lab, Scripps)
- 3D-printed models with **embedded magnets to represent hydrogen bonds**, so students "feel" bonds form. Examples include shaking poliovirus pieces in a container until they self-assemble. AR overlays sit on the physical models.
- **For Lupi:** the "feel the snap" moment translates to magnetic snapping when two fragments are dragged close. That is a spring pull plus a haptic tick plus a click sound. **Self-assembly in a shaken jar** is a lovely GPU Studio "shake to assemble" toy, reusing the device motion Lupi already has.

---

## 8. Sound

- **Kim & Heller, "Musical Molecules" (arXiv 2601.02652, 2026-01-06):** IR spectra of HCl, H₂O, NH₃ and acetone mapped to audio with an anharmonic oscillator model and NIST data. They hear "pitch flattening, beating, and the emergence of combination bands". For acetone they "pluck a single mode" to sonify IVR.
- **spectral-synth (MIT; spectral-synth.vercel.app):**
  - maps IR **400–4000 cm⁻¹ → 100–8000 Hz on a log scale**
  - uses additive synthesis with one oscillator per detected peak
  - uses Web Audio, with a live FFT under the spectrum
  - is mobile-optimized
  - Data: ENFSI forensic FTIR library.
- **"Singing Materials" (arXiv 2603.29037; ICAD 2026):** sonifies phonon density of states from the Materials Project, with a Python package built on STRAUSS.
- Others: Ejectamenta "Molecular Sounds" keyboard synth; MIT protein-to-music (2019).
- three r184 ships `webgpu_compute_audio` (GPU-generated audio buffers).
- **For Lupi (idea 6):**
  1. **Tap an atom to pluck it.** The pitch comes from the element, for example scaled from mass or covalent radius. It is illustrative, and it reuses the opt-in click-sound AudioContext.
  2. **"Hear this trajectory".** Velocity autocorrelation → FFT gives a vibrational density of states, which you then play through the spectral-synth log mapping. This one is physically grounded.

  **Honesty caveat:** to resolve a 3000 cm⁻¹ C–H stretch (~90 THz, 11.1 fs period), the frame spacing must be < ~5.6 fs (Nyquist). Most stored trajectories are strided much more coarsely. The feature should detect dt and fall back to "illustrative tones" when the data cannot support a real spectrum.

---

## 9. Art, virality and scale awe

- **Goodsell's style as a brand.** Molecule of the Month images "have become easily recognizable thanks to their non-photorealistic rendering, flat pastel colors, and black outlines". A distinctive, consistent look is itself shareable.
- **Molecular art prints.**
  - Lucy Walker's "Molecularts" draws everyday objects made of their own molecules, for example a bee made of glucose, fructose, gluconic acid and H₂O₂ from honey.
  - Etsy, Redbubble and Fine Art America host hundreds of molecule-print sellers.
  - **For Lupi:** "make a poster": Illustrative look + seeded layout + title + formula, exported as high-res PNG, or **SVG line art for pen plotters**. Circles plus hatching are easy for spheres; hidden-line removal by depth order.
- **A Boy and His Atom** (IBM, 2013-04-30): stop motion made by moving CO molecules with an STM. It was Guinness's smallest stop-motion film, with **26M+ views** as of Feb 2026. It hooked people with a story at an impossible scale. **For Lupi:** "draw with atoms" on a surface, then play as a flipbook.
- **The Inner Life of the Cell** (XVIVO / Harvard, 2006): the **kinesin "walking"** clip became a meme. Drew Berry (WEHI) uses "hues and sound of footsteps to give them personality". **Lesson:** personality and sound make molecules relatable. A trajectory with an audible footstep on each frame event would be a cheap version.
- **Scale journeys.** Scale of the Universe 2 (Huang twins, 2012) and neal.fun "Size of Space" (proton → observable universe by scrolling). Lupi's 953k-atom lattice and far-LOD splats (`AtomsOptimized.tsx:19-21`) could drive a pinch-to-zoom "one water molecule → a grain of salt" journey with live counters.
- **Theodore Gray's "The Elements"** app has 500+ freely rotatable, pinch-zoomable photographed samples. It showed that **a periodic table of touchable objects** beats a periodic table of text. Lupi's `periodic-table/` could show each element's real crystal as a spinning mini-render.
- **TikTok/Instagram.** Search pages ("What an atom looks like", "atom 3D model") show demand for 3D atom visuals. Lupi's export is landscape 1920×1080, 5 s only (`FigureExportPanel.tsx:56-61`). A **9:16 seamless loop** (orbit period = clip length; ping-pong trajectories) with optional sonified audio is the missing piece.

---

## 10. Museums and public installations

- **Exploratorium Cloud Chamber:** a continuous cascade of cosmic-ray trails (roughly 4 of 5 are muons). It is mesmerizing because it is live and never repeats. **For Lupi:** an idle "ambient" mode where trajectories or Molecule Life run forever on a kiosk.
- **Molecular Playground** (UMass Amherst, since 2009): a "way bigger than life size" molecule is projected on a wall. First an IR detector, then a **Kinect**, tracks passers-by, whose motion drives Jmol. Installed at UMass, Springfield Science Museum, St Olaf and OIST. **For Lupi:** a "kiosk mode" (attract loop plus camera or hand gestures). Browser hand tracking (e.g. MediaPipe) was **not researched here, UNVERIFIED**.
- **teamLab "Graffiti Nature":** visitors colour a creature on paper, and it comes to life in a shared ecosystem. **For Lupi:** Lupi's scan and gist particles can already form a photographed subject. Scanning a child's drawing so the particles take its shape, then settle into a related molecule, is the same magic (idea 15).

---

## 11. Mobile molecule apps that feel fun

- **Molecule World** (iPhone, iPad, Mac): rebuilt with iCloud sync and a "Wire Surface" mode.
- **Atomizer AR:** orbitals and electron-density clouds, and "WebXR augmented reality where molecules sit on your desk at real-world scale". Its WebXR use on iPhone is **UNVERIFIED**, given §7.5.
- **MolAR:** markerless AR, recognizes hand drawings.
- **MoleculAR:** QR-printed VSEPR markers.
- **MolView:** one-finger rotate, two-finger scale, and a sketcher "designed for touch devices". The 3D view updates live while you draw.
- **Common thread:** one-finger direct manipulation, AR "put it on the table", and a live link between drawing and 3D. None of them offer springy, playful physics. That gap is Lupi's opportunity.

---

## 12. What actually makes these engaging (distilled)

1. **An immediate physical answer to touch.** Springs, overshoot, sound, a haptic tick (Schroeder IMD, PhET, magnets, Foldit shake).
2. **Emergence from simple rules.** Particle Life, Lenia, falling sand, cloud chamber.
3. **Make, share, remix.** Sandspiel gallery and remix, Powder Toy saves, CellPAINT, Infinite Craft first discoveries.
4. **A shared daily ritual.** Chemicle's date-seeded molecule, Molecule of the Month.
5. **Collection and goals.** PhET collection boxes, Atomas, Infinite Craft.
6. **Scale awe.** Scale of the Universe, A Boy and His Atom, a 1M-atom zoom-out.
7. **Personality and story.** The walking kinesin, Drew Berry's footsteps.
8. **A signature look worth posting.** Goodsell's flat pastels plus black outlines.
9. **Physical presence.** AR on the desk, XR throw, tangible models.

Guardrail specific to Lupi: every playful motion must be labeled **illustrative** unless it comes from the user's data. GPU Studio already sets that precedent (`docs/gpu-studio-launch.md:15,47`), and the student reset forbids implying bond topology from inferred lines (`docs/product-reset-2026-09-04.md:37`).

---

## 13. Ranked: the 15 most transferable ideas

Ranking weighs fit with existing Lupi infrastructure, fun for a first-time visitor on mobile, honesty, and cost at 100k–1M atoms.

1. **Illustrative (Goodsell) look preset.**
   - *Problem:* dense structures read as mush, and screenshots look generic.
   - *Solution:* `uIgnoreLight` branch in the impostor shader, a depth-discontinuity outline Effect with QuteMol-style width ∝ depth drop (optionally type-ID edges), stronger N8AO, and a pastel palette.
   - *Why transferable:* screen-space, O(pixels), works on mobile. Precedents: Mol*, Speck, Molecule of the Month.
2. **Poke and jiggle (display-only springs).**
   - *Problem:* on mobile, touching the molecule does nothing delightful.
   - *Solution:* a uniform array of ~8 recent "pokes" (center, t0, amplitude). The vertex shader displaces each atom by a Gaussian falloff times a damped sine along a per-atom hash direction, so there is zero per-atom CPU work.
   - The bond impostor shader must apply the same function so bonds follow.
   - `math/time` spring3 drives the pokes, with a haptic tick plus a click on tap. Labeled illustrative.
3. **"Atoms fly in" morph transitions, and gist → molecule.**
   - *Problem:* switching molecules is a hard cut.
   - *Solution:* reuse the interpolation target buffer (`AtomsOptimized.tsx:16`) to lerp from a curl-noise cloud (`math/noise` curl3) or from the previous molecule's positions.
   - For search, feed the real atom positions as `homes` to the existing 60k gist particles (`gistParticles.ts:20`), so "candy" settles into sucrose before handing off to the real renderer.
4. **Vertical seamless-loop export (9:16) with optional audio.**
   - *Problem:* export is 1920×1080, 5 s only.
   - *Solution:* 1080×1920, orbit period = clip length, ping-pong trajectories, the Illustrative look, a title card.
   - This feeds TikTok and Reels directly.
5. **AR "on your desk" share loop.**
   - Quick Look `rel="ar"` link on iOS with a `callToAction=Open in Lupi` banner and `canonicalWebPageURL` set to the saved view. Scene Viewer or `model-viewer` with the existing GLB on Android.
   - The USDZ exporter already exists. Add an AR LOD cap.
6. **"Hear it."**
   - Tap-to-pluck element tones (illustrative), plus a trajectory VDOS sonification (VACF → FFT → 400–4000 cm⁻¹ → 100–8000 Hz log map, additive synthesis), gated by frame dt so it is only "real" when the Nyquist limit allows.
   - Opt-in, reusing `clickSound.ts`.
7. **Daily molecule (seeded puzzle).**
   - `mulberry32(dayIndex)` picks from the curated collection. Show the outline-only silhouette (from idea 1), then progressively reveal color, element counts and the name. Guess via the existing search and Jev.
   - Keep the streak in localStorage. Chemicle and Wordle mechanics.
8. **Pinch-to-scale journey.**
   - One water molecule → nanocrystal → the 953k-atom lattice, with live "atoms on screen" and "this is X nanometers" counters.
   - Uses existing far-LOD splats. Precedents: Scale of the Universe, neal.fun Size of Space.
9. **Heat and shake (states of matter).**
   - A temperature slider or phone shake (device motion already wired in `snow-motion.ts`) adds illustrative thermal jitter. A crystal visibly "melts" past a threshold, then settles back.
   - For real trajectories, the slider maps to playback.
   - A real LJ mini-sandbox à la Schroeder is the stretch version, feasible for ≤ a few thousand particles.
10. **Molecule Life (Particle Life seeded by your molecule).**
    - Species and colors come from the molecule's elements. The asymmetric matrix is seeded and shareable, and you stir with a finger.
    - Runs on WebGPU (lisyarus-style binning, 65k particles; or the gist engine). Presets are named like Clusters'.
    - Honest "toy rules" label. Lives beside GPU Studio.
11. **VSEPR and coordination-polyhedra toy.**
    - Drag or add electron domains on a sphere; they relax by Coulomb repulsion (Thomson problem). `math/geometry` quickhull3 draws the translucent polyhedron and bond angles update live.
    - Same code draws VESTA-style coordination polyhedra on real crystals via SpatialHash neighbours. That part is real geometry.
12. **Path-traced "Poster" mode in GPU Studio.**
    - With the camera stationary, accumulate a path-traced or SSGI still. Precedents: speck-pbr (WebGPU), Mol* v4.7 SSGI, three r184 `webgpu_postprocessing_ssgi_ballpool`.
    - Presets like Toon, Illustration and "Newspaper" halftone. High-res PNG and SVG plotter export.
13. **Molecule craft (Infinite Craft, grounded).**
    - Drag molecule A onto B. Jev returns a real, related molecule or reaction from Lupi's library only, with "first discovery" badges.
    - Never generates coordinates, which keeps the honesty contract.
14. **Tug-a-chain.**
    - Pinch or drag one atom of a polymer or protein backbone and the chain follows via `math/ik` fabrik3, with ball-joint cones approximating bond angles and bond lengths preserved. On release it springs back to source coordinates.
    - Works with the existing XR pinch-grab. Precedent: NanoVer knot-tying and nanotube pulling. Illustrative label.
15. **Draw it and watch it become atoms.**
    - A kid draws a creature, or a hydrocarbon, on paper. Scan it; the gist particles take its shape (teamLab Graffiti Nature); then they settle into a related real molecule (MolAR precedent for hand-drawn structure recognition).
    - Extends `/v1/scan/*`. Add "save and share to a gallery" (Sandspiel remix loop).

**Tier 2 (good but narrower):**
- Foldit-style honest geometry-check overlay (spiky red clash markers on too-close atoms in the user's file)
- Boids "schools" of water molecules on the landing hero
- Kiosk or attract mode for classrooms and museums
- Remix-this-view gallery
- Periodic table of spinning element crystals (Theodore Gray)
- Atomas-style fusion mini-game
- Shared XR sessions (Nanome and MolecularWebXR style)
- Lenia or falling-sand backgrounds
- "Shake to self-assemble" (Olson's poliovirus jar) in GPU Studio

---

## Sources

**Lupi code and docs**
- `packages/scene/src/AtomsOptimized.tsx:1-40,81-94,709-711,1289`
- `packages/scene/src/AtomPicker.tsx:1-6`; `packages/scene/src/SpatialHash.ts:20`
- `packages/ui/src/postprocess/presets.ts:13-18`; `packages/ui/src/postprocess/ScenePostprocessing.tsx:16,49-58`
- `packages/ui/src/gpu-studio/snow-motion.ts:1-60`; `docs/gpu-studio-launch.md:9,15,20,35,47,49`
- `packages/ui/src/scan/gist/gistEngine.ts:68`; `gist-step.wgsl:1-20`; `gistParticles.ts:1-28`; `packages/ui/src/switcher/SwitchStage.tsx:1-14`; `packages/ui/src/scan/swirl.ts:1-13`; `packages/ui/src/action-light/runtime.ts:1-15`
- `packages/ui/src/xr/XRMoleculeInteraction.tsx:1-25`
- `packages/ui/src/export/USDZExportPipeline.ts:1-2`; `packages/ui/src/ViewerApp.tsx:131`
- `packages/ui/src/panels/FigureExportPanel.tsx:40-61,234-236`
- `packages/ui/src/lib/clickSound.ts:1-11`; `packages/ui/src/EmojiPlayground.tsx:3-45`; `packages/ui/src/AtomTrails.tsx:1-13`
- `packages/ui/src/landing/MillionAtomPreview.tsx:10-26`
- `docs/product-reset-2026-09-04.md:1-4,37`
- pmndrs `math` 0.1.0 tarball (npm `math`): `README.md`, `dist/src/time/spring3.d.ts`, `dist/src/geometry/quickhull3.d.ts`, `dist/src/ik/fabrik3.d.ts`, `dist/src/noise/fractal.d.ts`

**Rendering**
- https://molstar.org/viewer-docs/tips/illustrative-style/
- https://molstar.org/me-docs/quick-styles/
- https://github.com/molstar/molstar/blob/master/CHANGELOG.md
- https://registry.npmjs.org/molstar (5.11.0, 2026-07-19)
- https://github.com/3dmol/3Dmol.js/releases ; https://registry.npmjs.org/3dmol
- http://vcg.isti.cnr.it/publication/2006/TCM06/ ; https://en.wikipedia.org/wiki/QuteMol
- https://github.com/ccsb-scripps/Illustrate ; https://pubmed.ncbi.nlm.nih.gov/31519398/ ; https://www.rcsb.org/news/5d78f300ea7d0653b99c8812
- https://ccsb.scripps.edu/cellpaint3/ ; https://ccsb.scripps.edu/cellpaint/cellpaint2-documentation
- https://pdb101.rcsb.org/sci-art/goodsell-gallery ; https://www.rcsb.org/news/602eec4b3fed9e549afd7927
- http://www.ks.uiuc.edu/Research/vmd/minitutorials/glsloutline/
- https://github.com/wwwtyro/speck ; https://wwwtyro.github.io/speck/ ; https://github.com/wwwtyro/speck-pbr ; https://wwwtyro.github.io/speck-pbr/
- https://www.cgl.ucsf.edu/chimerax/docs/user/commands/lighting.html
- https://raw.githubusercontent.com/mrdoob/three.js/r184/examples/files.json ; https://threejs.org/examples/webgpu_compute_birds.html
- https://registry.npmjs.org/three ; https://registry.npmjs.org/postprocessing ; https://registry.npmjs.org/@react-three/postprocessing ; https://registry.npmjs.org/n8ao ; https://registry.npmjs.org/math

**Simulations and toys**
- https://phet.colorado.edu/en/simulations/build-a-molecule ; https://phet.colorado.edu/en/simulations/molecule-shapes ; https://github.com/phetsims/molecule-shapes
- https://physics.weber.edu/schroeder/md/ ; https://arxiv.org/abs/1502.06169
- https://mw.concord.org/nextgen/ ; https://lab.concord.org/
- https://luminouslearner.com/science/chemistry/chemistry-tool/vsepr-shape-explorer/ ; https://physandbox.com/chemistry/vsepr-shapes ; https://ojas.smartlylinked.co.uk/en/articles/simulating-simple-molecular-structures-threejs-part-1-basic-repu/
- https://github.com/materialsproject/crystaltoolkit ; https://crystals.symotter.org/viztools/

**Emergent systems**
- https://www.ventrella.com/Clusters/
- https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html
- https://ethanwillingham.com/particle-life.html
- https://github.com/tom-mohr/particle-life-app ; https://particle-life.com/
- https://en.wikipedia.org/wiki/Lenia ; https://github.com/Katielocks/Lenia3D
- https://maxbittker.com/making-sandspiel/ ; https://github.com/MaxBittker/sandspiel ; https://github.com/MaxBittker/sandspiel-studio
- https://github.com/The-Powder-Toy/The-Powder-Toy

**Games and engagement**
- https://foldit.fandom.com/wiki/Clashes ; https://foldit.fandom.com/wiki/Foldit_user_interface/View_Options ; https://pmc.ncbi.nlm.nih.gov/articles/PMC2956414/
- https://sirnic.com/atomas/
- https://en.wikipedia.org/wiki/Infinite_Craft
- https://particle-clicker.web.cern.ch/
- https://wesleyjding.github.io/chemicle/ ; https://elemendle.com/ ; https://www.chemistryworld.com/culture/wordle-meets-the-periodic-table-five-games-to-test-your-chemistry-knowledge/4021918.article
- https://pdb101.rcsb.org/motm/motm-about ; https://pdb101.rcsb.org/news/67643fd491dec3731b1983ed

**Immersive, AR and tangible**
- https://nanome.ai/ ; https://www.meta.com/experiences/nanome/2038368596280231/
- https://arxiv.org/pdf/2606.30678 ; https://pubs.aip.org/aip/jcp/article/150/22/220901/197661/
- https://arxiv.org/abs/2509.04056 ; https://pubmed.ncbi.nlm.nih.gov/38069760/
- https://pubs.aip.org/aip/jcp/article/156/20/204801/2841479/ ; https://www.chemistryworld.com/news/app-creates-floating-3d-molecules-from-hand-drawn-chemical-structures/4014182.article
- https://modelviewer.dev/examples/augmentedreality/ ; https://registry.npmjs.org/@google/model-viewer
- https://www.variant3d.com/blog/using-banners-in-quicklooks ; https://www.createwithswift.com/create-a-web-ar-experience-with-ar-quick-look/
- https://xrdoctors.pro/blog/webxr-on-ios-what-actually-works ; https://www.testmuai.com/learning-hub/webxr-compatible-browsers/ ; https://developer.apple.com/forums/thread/756850
- https://github.com/tijnjh/ios-haptics ; https://haptics.kushagragolash.dev/
- https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent
- https://pubmed.ncbi.nlm.nih.gov/15766549 ; https://files.eric.ed.gov/fulltext/ED567768.pdf

**Sound**
- https://arxiv.org/abs/2601.02652
- https://github.com/zophiezlan/spectral-synth
- https://arxiv.org/abs/2603.29037
- https://ejectamenta.com/online-applications/molecular-sounds/ ; https://news.mit.edu/2019/translating-proteins-music-0626

**Art, virality, scale and museums**
- https://intranet.ch.cam.ac.uk/molecule-art-lucy-walker
- https://en.wikipedia.org/wiki/A_Boy_and_His_Atom
- https://en.wikipedia.org/wiki/The_Inner_Life_of_the_Cell ; https://www.ted.com/talks/drew_berry_animations_of_unseeable_biology ; https://clotmag.com/biomedia/drew-berry-molecular-visual-appeal
- https://htwins.net/scale2/ ; https://en.wikipedia.org/wiki/The_Scale_of_the_Universe
- https://apps.apple.com/us/app/the-elements-by-theodore-gray/id364147847 ; https://periodictable.com/theelements/pages.html
- https://www.tiktok.com/discover/what-an-atom-looks-like
- https://www.exploratorium.edu/exhibits/cloud-chamber
- http://www.molecularplayground.org/HowItWorks.html ; https://en.wikipedia.org/wiki/Molecular_Playground
- https://www.teamlab.art/w/graffitinature/

**Mobile molecule apps**
- https://apps.apple.com/us/app/molecule-world/id863565223
- https://apps.apple.com/us/app/atomizer-ar-quantum-chemistry/id6449015706
- https://apps.apple.com/us/app/molar-augmented-reality/id1559504847
- https://apps.apple.com/us/app/molecular/id1585592102
- https://molview.org/ ; https://github.com/geoffrowland/molview
