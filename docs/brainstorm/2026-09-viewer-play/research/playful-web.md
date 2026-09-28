# Playful, touch-friendly 3D on the web (2025–2026): a pattern digest for Lupi

Research date: 2026-09-27. Scope: how studios, tutorial authors and pmndrs contributors build 3D pages people want to poke at, especially on phones. The last section ranks which patterns would carry over to atoms, molecules and particles. External claims have a URL. Code claims have a file path and line number. Anything I could not confirm is marked **UNVERIFIED**.

---

## 0. Versions and what Lupi already has

**Ecosystem versions** (from the npm registry `dist-tags`/`time`, fetched 2026-09-27):

| Package | Latest | Date | Lupi lockfile |
|---|---|---|---|
| `@react-three/fiber` | 9.8.1 (latest), 10.0.0-alpha.5 (alpha) | 2026-09-24 / 2026-09-08 | 9.6.1 |
| `@react-three/drei` | 10.7.9 (latest), 11.0.0-alpha.7 | 2026-09-25 / 2026-09-05 | 10.7.7 |
| `three` | 0.186.1 | 2026-09-24 | 0.184.0 |
| `postprocessing` | 6.39.5 (7.0.0-beta.16 on beta) | 2026-09-09 | 6.38.3 |
| `@react-three/postprocessing` | 3.1.3 | 2026-09-27 | 3.0.4 |
| `math` (pmndrs/math) | 0.1.0 | 2026-09-11 | — |
| `@pmndrs/scheduler` | 0.2.0 | 2026-08-24 | — |
| `mediabunny` | 1.60.0 | 2026-09-25 | — (Lupi declares deprecated `mp4-muxer@5.2.2`) |
| `ios-haptics` | 3.2.0 | 2026-09-22 | — |
| `gsap` | 3.15.0 | 2026-04-13 | — |
| `lenis` | 1.3.26 | 2026-08-05 | — |

The R3F v10 alpha release notes on GitHub (https://github.com/pmndrs/react-three-fiber/releases) describe these changes. The scheduler moves into its own package, `@pmndrs/scheduler`. Several canvases can share one WebGPU renderer. There are new hooks: `useBuffers`, `useGPUStorage`, `useTextures` and `useRenderPipeline`. `useFrame` can run outside `<Canvas>`. alpha.1 added first-class TSL hooks: `useUniforms`, `useNodes` and `useLocalNodes`. The fetch tool garbled the release dates on that page, so I took dates from npm instead.

**What pmndrs/math 0.1.0 actually ships** (I read the published tarball `math-0.1.0.tgz`). The package exports `.`, `./shapes`, `./geometry`, `./time`, `./random`, `./noise`, `./color` and `./ik`.
- `math/time`: `spring`, `spring2`, `spring3`, `spring4` (each has `create`, `update`, `damp`; scalar `spring` also has `dampAngle` and `fromResponse`, which takes a SwiftUI-style response time), plus `easing` (`cubicInOut`, `expoOut`, `quintOut`, `sineInOut` and others). The call is `spring2.update(state, target, smoothTime, dampingRatio, delta)`: a damping ratio below 1 is bouncy, and passing `delta` keeps it independent of refresh rate.
- `math/noise`: `perlin2d/3d`, `simplex2d/3d/4d`, `worley2d/3d`, and the fractal helpers `fbm`, `ridged`, `billow`, `domainWarp2/3`, **`curl2`, `curl3`** (divergence-free flow fields).
- `math/random`: seedable `mulberry32`, `isaac32` and `isaac64` (`create/seed/next/sample`), plus `random.{float,int,bool,sign,choice,vec2,vec3,vec4,quat}`.
- `math/ik`: `fabrik2`, `fabrik3`. `math/geometry`: `quickhull2/3`, `circumcircle`, polygon triangulation and decomposition.
- The official examples (https://github.com/pmndrs/math/tree/main/examples/src) are small playful toys: `example-spring.ts` (a springy tail that chases the pointer, with a Lissajous idle mode), `example-circle-physics.ts` (substepped XPBD grains where the pointer is body 0 with inverse mass 0), `example-flow-field.ts` (2,200 particles on `simplex2d`, seeded by `mulberry32.create(42)`), `example-simplex-4d-looping-noise.ts` (a seamless loop made by circling through two extra noise dimensions) and `example-fabrik-2d-snek.ts`. They render with a package called `gpucat`, which is only a `0.0.0-placeholder-1` on npm, so **its API is UNVERIFIED**. The math functions themselves work with any renderer.

**What Lupi already has for playfulness:**
- DPR caps by device tier: mobile/low 1.25, desktop/high 1.75 (`packages/ui/src/viewer/ViewerCanvas.tsx:19-35`). `frameloop` is `'always'` unless paused (`ViewerCanvas.tsx:67`). No `PerformanceMonitor`, `AdaptiveDpr` or `frameloop="demand"` appears anywhere in `packages/ui/src` or `packages/scene/src`.
- Display-only phone-motion "snow" in GPU Studio. `SnowMotion` is at `packages/ui/src/gpu-studio/snow-motion.ts:2-33`. `enablePhoneSnow`, including the `DeviceMotionEvent.requestPermission()` flow that only runs from a user gesture, is at `snow-motion.ts:43-80`, wired in `GpuStudioLaunch.tsx:89`.
- A procedural Web Audio click, opt-in and off by default: `packages/ui/src/lib/clickSound.ts:1-11, 49-60, 78`.
- Spring helpers and reduced-motion detection: `packages/ui/src/lib/spring.ts:38-77` (`springStep`, `prefersReducedMotion`). There is a press-squash hook (`hooks/usePressSpring.ts`) and a button surface deformation (`action-light/motion.ts`, which reads `prefers-reduced-motion`).
- Canvas video export through `canvas.captureStream(fps)` + `MediaRecorder` (`packages/ui/src/ExportManager.tsx:885-895`). `mp4-muxer` is declared in `packages/ui/package.json:39`, but no import of it exists anywhere in `packages/`, `apps/` or `tools/`.
- Atom trails for selected atoms (`packages/ui/src/AtomTrails.tsx:1-12`), keyframe camera flythroughs with shareable serialization (`packages/ui/src/flythrough.ts:1-13`), and a WGSL particle "gist" stage that swirls particles and settles them onto shapes (`packages/ui/src/scan/gist/GistStage.tsx:1-8`, `gistParticles.ts`).
- No haptics: no `navigator.vibrate` or iOS switch trick anywhere in `packages/ui/src`.

---

## 1. Mobile performance playbook (applies to every pattern)

1. **Cap DPR.** The pmndrs Lusion Connectors demo uses `dpr={[1, 1.5]}` and `gl={{ antialias: false }}` (pmndrs/examples `examples/lusion-connectors/src/App.tsx:67-68`). The TSL morphing-particles README warns that "Fill Rate (drawing pixels) is expensive" with additive particles and recommends clamping DPR on high-DPR phones (https://github.com/chrismaldona2/tsl-morphing-particles). Lupi already caps DPR.
2. **Adapt to measured FPS.** drei `<PerformanceMonitor onIncline onDecline onChange flipflops onFallback>` averages FPS and gives a 0–1 factor. Canvas state exposes `performance: {current, min, max, debounce, regress()}`. Call `regress()` while the user is interacting, then scale DPR or drop effects. `<AdaptiveDpr>` does the DPR part automatically (https://r3f.docs.pmnd.rs/advanced/scaling-performance).
3. **Render on demand when idle.** `frameloop="demand"` plus `invalidate()` saves battery and heat. This matters for toys that sit untouched. A toy needs a frame loop only while something is moving; `usePressSpring.ts` in Lupi already stops itself once it settles.
4. **Use presets per device.** Bruno Simon's folio switches to a lower preset on mobile: "water blur and depth-of-field effects are disabled, and shadow map resolution is reduced". It also relies on instancing, frustum culling, a single palette texture, ETC1S/UASTC textures and Draco (https://www.awwwards.com/brunos-portfolio-case-study.html).
5. **Keep the simulation on the GPU.** WebGL2 uses `GPUComputationRenderer` with ping-pong FBOs (https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/). WebGPU/TSL uses `instancedArray(count,'vec3')`, `Fn(...)().compute(count)` and `renderer.compute(...)` (https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/). The official three.js examples are good references: `webgpu_compute_particles`, `webgpu_compute_particles_fluid`, `webgpu_compute_cloth` and `webgpu_tsl_compute_attractors_particles` (https://threejs.org/examples/).
6. **Expect iOS throttling.** iOS caps `requestAnimationFrame` at 30 fps in Low Power Mode (WebKit bug 168837, https://bugs.webkit.org/show_bug.cgi?id=168837). Safari also throttles rAF inside cross-origin iframes until the user interacts (https://motion.dev/magazine/when-browsers-throttle-requestanimationframe). Low Power Mode is effectively undetectable. Always integrate with real `delta` and clamp it: pmndrs/math's examples clamp `dt` to 0.05, and Lupi's `MAX_STEP` is 1/30 at `lib/spring.ts:45`.
7. **Keep touch and scroll working.** Set `touch-action: none` on the canvas. Ignore touch `pointermove` unless a finger is down (pmndrs/math `example-spring.ts`), so scrolling the page never drags the toy by accident.
8. **Respect reduced motion.** Swap motion for fades rather than removing state changes (https://web.dev/learn/accessibility/motion). Lupi already has `prefersReducedMotion()`.
9. **Watch the GPU budget.** Hector Arellano's 80k-particle WebGPU fluid "can work at 60fps on a MacBook Pro M1 Pro… Put this thing in a MacBook Air and your dreams… will fade". Desktop-class sims need a mobile fallback (https://tympanus.net/codrops/2025/01/29/particles-progress-and-perseverance-a-journey-into-webgpu-fluids/).

---

## 2. Pattern catalog (38 patterns)

Each pattern follows the same format: **What** / **Why it feels good** / **How** / **Mobile** / **Example**.

### A. Pointer and touch physics toys

**1. The cursor as a physics body ("Lusion connectors")**
- **What:** Objects drift toward the center. Your pointer is an invisible collider that shoves them around.
- **Why:** The response is immediate and physical. There are no rules to learn, and every swipe gives a slightly different collision.
- **How:** Rapier with `gravity={[0,0,0]}`. Each body gets `applyImpulse(-position * 0.2)` every frame toward the origin, with `linearDamping={4}`. The pointer is a `kinematicPosition` `RigidBody` with a `BallCollider`, moved through `setNextKinematicTranslation(mouse * viewport / 2)`. `MeshTransmissionMaterial`, N8AO and `easing.dampC` from maath recolor on click (pmndrs/examples `examples/lusion-connectors/src/App.tsx:82-99, 165-215, 234-235`).
- **Mobile:** DPR `[1,1.5]` and antialias off. Rapier runs in WASM on the CPU.
- **Example:** https://pmndrs.github.io/examples/examples/lusion-connectors. Related demos: `object-clump`, `basic-ballpit`, `hi-key-bubbles`.

**2. A spring-follow tail**
- **What:** A chain of beads. The head springs to the cursor and each bead springs to the one ahead.
- **Why:** Overshoot and settle reads as "alive". Whipping it around is instantly satisfying.
- **How:** `spring2.update(chain[0], target, 0.08, 0.45, dt)`, then each link chases the previous one with a smooth time of 0.05 (pmndrs/math `examples/src/example-spring.ts`). Codrops' droplet metaballs uses the same idea with a 15-frame pointer history rendered as `smin`-blended raymarched spheres, using 16 raymarch steps (https://tympanus.net/codrops/2025/06/09/how-to-create-interactive-droplet-like-metaballs-with-three-js-and-glsl/).
- **Mobile:** CPU cost is trivial. Raymarching cost scales with resolution, so render it at half resolution.
- **Example:** https://pmndrs.github.io/math/examples/ (spring), https://tympanus.net/Tutorials/InteractiveBubbleMetaballs

**3. Repel and spring home ("disturb the shape")**
- **What:** Thousands of particles hold a shape. The pointer pushes them away and they flow back.
- **Why:** You can make a mess without breaking anything. It invites scribbling.
- **How:** GPGPU position and velocity textures. Repulsion falls off with distance and scales with mouse speed, and a spring-like force pulls each particle back to its original position. Raycasting uses `three-mesh-bvh`. Dominik Fojcik, Codrops, 2024-12-19 (https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/). The same thing at 1M stars in WebGPU: click-drag applies inverse-square repulsion and particles spring back with damping (Dan Greenheck, 2025-12-08, https://threejsroadmap.com/blog/galaxy-simulation-webgpu-compute-shaders, demo https://dgreenheck.github.io/webgpu-galaxy/).
- **Mobile:** 1–16k particles are fine on phones. 1M needs WebGPU on a desktop-class GPU.

**4. A touch-trail texture that drives everything**
- **What:** The pointer paints a fading trail into a small offscreen texture. Shaders read it to displace particles, warp text or distort images.
- **Why:** It remembers where your finger has been, so a gesture becomes a mark.
- **How:** Bruno Imbrizi's "TouchTexture" draws eased trail points to an offscreen 2D canvas, and the vertex shader displaces by `texture2D(uTouch, puv).r` (https://tympanus.net/codrops/2019/01/17/interactive-particles-with-three-js/). The 2026 version uses a 200×200 `Float32Array` `DataTexture` holding flow in R/G and speed in B, with brush SDF shapes, decay normalized by `delta*60`, `NearestFilter` plus a 3×3 blur on read, and a TSL UV warp (Bautista Berto, 2026-09-24, https://tympanus.net/codrops/2026/09/24/custom-shaped-cursor-trail/, demo https://tympanus.net/Demos/CustomShapedCursorTrail/). Maxime Heckel's halftone post uses a `MouseTrail` FBO ping-pong that stores velocity (https://blog.maximeheckel.com/posts/shades-of-halftone/).
- **Mobile:** Very cheap. A 128–256² texture costs one texture fetch per vertex or fragment.

**5. Cursor-driven fluid (stable fluids)**
- **What:** Dragging stirs colorful ink.
- **Why:** It is hypnotic, every stroke is unique, and it rewards fast flicks.
- **How:** GPU Gems "Fast Fluid Dynamics" as separate passes: advection, divergence, curl/vorticity confinement, pressure Jacobi and gradient subtraction. Pavel Dobryakov's version "works even on mobile" (https://github.com/PavelDoGreat/WebGL-Fluid-Simulation). In R3F, `@funtech-inc/use-shader-fx` (2.0.5) provides a `useFluid` hook (https://github.com/FunTechInc/use-shader-fx). Unseen Studio uses a fluid sim only to offset colors on its cellular Rapier toy (https://tympanus.net/codrops/2025/09/11/when-cells-collide-the-making-of-an-organic-particle-experiment-with-rapier-three-js/).
- **Mobile:** Run the sim at 1/4–1/8 of screen resolution with about 20 pressure iterations. Dye can be higher resolution than velocity.

**6. Metaballs and gooey blending**
- **What:** Blobs merge and pull apart like droplets.
- **Why:** The shapes feel soft and tactile, and merging is satisfying.
- **How:** SDF `smoothMin` in a raymarch (pattern 2), or `smin` of neighboring halftone dots (Maxime, "gooey" halftone variant).
- **Mobile:** Use a fixed, low step count and render at lower resolution.

**7. Soft bodies and jelly**
- **What:** Squishy things that wobble when poked or dropped.
- **Why:** Squash and wobble is the core of "cute" physics.
- **How:** XPBD tetrahedral soft bodies, "simple and unbreakable" (Matthias Müller, Ten Minute Physics #10, https://matthias-research.github.io/pages/tenMinutePhysics/10-softBodies.html). Softbody Tetris ports zalo/TetSim entirely to TSL compute on WebGPURenderer (Niklas Niehus, 2026-03-13, https://www.webgpu.com/showcase/softbody-tetris-webgpu-threejs-jelly-physics/, demo https://holtsetio.com/lab/tetris/). A cheaper version deforms vertices along their normals near the pointer and springs them back in a compute shader: `velocity += (target-current)*spring; velocity *= friction` (Lolo Armdz, 2025-07-22, https://tympanus.net/codrops/2025/07/22/interactive-text-destruction-with-three-js-webgpu-and-tsl/).
- **Mobile:** The per-vertex spring is cheap. Full XPBD on the CPU suits hundreds to low thousands of particles.

**8. Verlet cloth and ropes**
- **What:** Fabric, strings or nets you can grab.
- **Why:** Tugging and releasing gives weight and follow-through.
- **How:** The three.js `webgpu_compute_cloth` example is "a verlet system running in compute shaders". It builds a vertex grid connected by springs and exposes `stiffnessUniform`, `dampeningUniform` and wind (https://threejs.org/examples/#webgpu_compute_cloth). For CPU ropes, Verlet integration plus distance constraints (e.g. https://github.com/RobertoLovece/Rope-Grid).
- **Mobile:** GPU version where WebGPU exists; small CPU chains elsewhere.

**9. An XPBD pile the pointer ploughs through**
- **What:** A self-gravitating clump of grains. Your pointer bulldozes a path and the clump heals behind it.
- **Why:** You get destruction and repair in the same gesture.
- **How:** In pmndrs/math `example-circle-physics.ts`, substepped XPBD (Müller et al. 2020, following Catto's `solve_xpbd.c`) with no walls. Everything falls toward the origin. The pointer is "body 0 with an inverse mass of zero", so it collides like everything else. It uses `mulberry32.create(1337)` for a reproducible sunflower spawn.
- **Mobile:** CPU, fine at hundreds to a few thousand bodies with a spatial hash.

**10. Drag to spin, with inertia and snap-back**
- **What:** Flick an object and it keeps spinning, slows down and optionally springs back to a hero pose.
- **Why:** It borrows the physics of a fidget spinner or a globe.
- **How:** drei `<PresentationControls global snap speed zoom polar azimuth config>` "spin[s] content with spring physics… respecting rotation boundaries" (https://drei.docs.pmnd.rs/controls/presentation-controls). Alternatively, `@use-gesture/react` drag `velocity` projects an end rotation at release, which `api.start()` animates to (https://github.com/pmndrs/react-spring/discussions/1898). Lusion's Oryzo (Site of the Month, April 2026) is a single object that "moves with inertia and weight" (https://www.utsubo.com/blog/best-threejs-websites-2026, https://lusion.co/projects/oryzo_ai/). pmndrs/math `spring.dampAngle` takes the shortest angular path, so it doesn't unwind the long way around.
- **Mobile:** A natural fit for one finger.

**11. Magnetic hover and proximity reveal**
- **What:** Elements lean toward, swell toward, or reveal a different material near the cursor.
- **Why:** The scene looks like it is paying attention to you.
- **How:** In Codrops' "Interactive 3D Cluster" (Francesco Michelini, 2026-08-12), a raycast hit animates a `hoverPointWS` uniform. Faces scale by `distance(positionWS, hoverPointWS).clamp(0,1).smoothstep(0.8,0.2)` on a `BatchedMesh`. Post-processing is Sobel outlines plus `bayerDither`, with GSAP Observer handling the pointer and `three-start` behaviours (Spin, HoverEffect) (https://tympanus.net/codrops/2026/08/12/creating-an-interactive-3d-cluster-with-three-js-tsl-and-three-start/, demo https://tympanus.net/Tutorials/3DCluster/). The 2D counterpart is Codrops' Magnetic Buttons (https://tympanus.net/Development/MagneticButtons/).
- **Mobile:** Hover doesn't exist on touch. Map it to press-and-hold, or to the last touch point with a decay.

**12. IK creatures that follow you**
- **What:** A snake or tentacle whose head chases the pointer, with the body trailing under joint limits.
- **Why:** It gives the toy a character.
- **How:** `fabrik2.forward(snake, head)`, with `fabrik2.addBoneAtBase` growing the tail when it "eats" a pellet (pmndrs/math `example-fabrik-2d-snek.ts`). `fabrik3` exists for 3D.
- **Mobile:** Trivial cost.

### B. Emergent and generative systems

**13. Particle life (asymmetric attraction matrix)**
- **What:** N species with a random attract/repel matrix. Cells, worms and spinners emerge from it.
- **Why:** Endless surprise. Every "randomize" is a new ecosystem.
- **How:** Forces fall off linearly to an interaction radius, and violating Newton's third law is deliberate. A 32×32 spatial bin grid uses atomic counts plus a parallel prefix sum and sorted particles, all in WebGPU compute, for up to 65,536 particles. Rules export as JSON and can be shared through a URL seed (lisyarus, 2025-05-15, https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html). 3D Life Sim adds live audio input, MIDI mapping and presets with "hundreds of thousands of particles" (Aaron Lemke, 2026-08-01, https://3d-life-sim.pages.dev/, https://github.com/kajukabla/3d-life-sim).
- **Mobile:** Around 8–16k particles on WebGPU phones. Use a CPU fallback at around 1–2k.

**14. Curl-noise flow fields**
- **What:** Particles stream along smooth, swirling, divergence-free currents.
- **Why:** The motion looks like smoke or silk and never repeats.
- **How:** FBO simulation with curl-noise advection (Maxime Heckel, https://blog.maximeheckel.com/posts/the-magical-world-of-particles-with-react-three-fiber-and-shaders/; 512² = 262k particles). Three.js Journey's GPGPU Flow Field lesson uses the same approach (https://threejs-journey.com/lessons/gpgpu-flow-field-particles-shaders). For the CPU, pmndrs/math has `curl3(out, sample, x, y, z)` and `curl2`, and `example-flow-field.ts` shows respawning particles with lifetimes. The pmndrs demo `gpgpu-curl-noise-dof` adds depth of field (https://pmndrs.github.io/examples/examples/gpgpu-curl-noise-dof).
- **Mobile:** Around 64k points is comfortable. Keep point size small to limit fill rate.

**15. Strange attractors**
- **What:** Lorenz, Thomas and similar attractors as glowing particle ribbons.
- **Why:** They are beautiful, mathematical and easy to tweak.
- **How:** A compute pass accumulates `dx/dt` into an offset buffer, and the vertex position is spawn + offset (Maxime's field guide). The three.js example `webgpu_tsl_compute_attractors_particles` has draggable attractor gizmos (https://threejs.org/examples/#webgpu_tsl_compute_attractors_particles). The R3F playground version is at https://r3f.maximeheckel.com/attractor.

**16. Boids and flocking**
- **What:** Schools of fish or flocks of birds that scatter from your pointer.
- **Why:** The motion feels alive, and scaring the flock is funny.
- **How:** Separation, alignment and cohesion in compute. See three.js `webgpu_compute_birds` and `webgl_gpgpu_birds` (https://threejs.org/examples/). Martin Laxenaire's portfolio uses boids and particles on his own engine, gpu-curtains (https://www.webgpu.com/showcase/martin-laxenaire-portfolio-webgpu-game-gpu-curtains/).

**17. GPU fluid particles (MLS-MPM / PBF)**
- **What:** Thousands of particles that slosh like liquid when you tilt or poke them.
- **Why:** Liquid in a glass is one of the most satisfying things you can play with.
- **How:** three.js `webgpu_compute_particles_fluid` is an "MLS-MPM particle simulation running in compute shaders", with mouse-ray force uniforms (`mouseRayOriginUniform`, `mouseForceUniform`) (https://threejs.org/examples/#webgpu_compute_particles_fluid). Hector Arellano's Codrops piece uses simplified PBF with curl noise and 80k particles, meshed with GPU marching cubes and voxel-cone AO. Its URL takes `?word=` to change the word that the fluid forms (https://tympanus.net/codrops/2025/01/29/particles-progress-and-perseverance-a-journey-into-webgpu-fluids/). Juan Cazala's "Party" lets you tweak gravity and forces live (https://caza.la/party, https://github.com/cazala/party).
- **Mobile:** Desktop-class. Offer a reduced particle count or a 2D fallback.

**18. Gravity wells and n-body**
- **What:** Tap to drop an attractor. Particles fall into orbits.
- **Why:** Planting a star and watching a galaxy form is a big payoff for one tap.
- **How:** Summed inverse-square forces from a few wells, with softening. The galaxy demo (pattern 3) inverts this to repel. The three.js example is `webgpu_tsl_galaxy`.

### C. Transformations and transitions

**19. Morphing between shapes (GPGPU morph)**
- **What:** Particles swarm from one model or text into another.
- **Why:** The transformation itself is the reward. It is ideal between content states.
- **How:** Surface-sample each mesh to N points with `MeshSurfaceSampler`, bake each into a layer of a `DataArrayTexture`, and blend two layers by a progress uniform in the TSL vertex shader. That covers 16k+ particles and 9+ meshes in about 4.7 MB of VRAM (https://github.com/chrismaldona2/tsl-morphing-particles, demo https://tsl-morphing-particles.vercel.app/). Other versions: Maxime's FBO morphing (https://r3f.maximeheckel.com/fbo-morphing) and Three.js Journey "Particles Morphing Shader" (https://threejs-journey.com/lessons/particles-morphing-shader). Igloo Inc (Abeto, Awwwards Site of the Year) built "our own exporter that converts VDB data into a browser-friendly format". Particles morph into a different model per link, with color tied to velocity and a glow during the morph (https://www.awwwards.com/igloo-inc-case-study.html).
- **Mobile:** Vertex-only morphing costs almost nothing on the CPU. Fill rate is the limit.

**20. Dissolve into dust (gommage)**
- **What:** An object burns away along a noise front, shedding glowing particles and petals.
- **Why:** It is dramatic and makes a great exit or enter transition.
- **How:** `discard` where `noise < uProgress`, draw an edge band in an emissive color, and spawn particles on the band (Jatin Chopra, 2025-02-17, https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/). The WebGPU version uses `MSDFTextNodeMaterial`, InstancedMesh with 100 dust and 400 petal particles, per-instance attributes packed to stay under a vertex-attribute limit, and **MRT selective bloom** via `mrt()` + `bloom()` with a per-material `bloomIntensity` output (Thibault Introvigne, 2026-01-28, https://tympanus.net/codrops/2026/01/28/webgpu-gommage-effect-dissolving-msdf-text-into-dust-and-petals-with-three-js-tsl/).

**21. Explode, implode and shatter**
- **What:** Tap to blow the object apart. Pieces tumble, then reassemble.
- **Why:** You break it with no consequence, and the reassembly is satisfying.
- **How:** Pre-fractured pieces in Rapier (pmndrs `cell-fracture`, https://pmndrs.github.io/examples/examples/cell-fracture). The GPU version (pattern 7) displaces along normals and springs back. For directions, `random.vec3` / `random.quat` from pmndrs/math give uniform outward vectors and tumble rotations from a seed.

**22. Confetti and celebration bursts**
- **What:** A burst of streamers or sparks when you complete something.
- **Why:** A cheap, readable reward signal.
- **How:** pmndrs `confetti` uses meshline particles with maath (https://pmndrs.github.io/examples/examples/confetti). For DOM confetti over the canvas, `canvas-confetti` 1.9.4. Also see pmndrs `sparks-and-effects`.
- **Mobile:** Keep bursts short: under 1 s and a few hundred particles.

**23. A persistent canvas across page transitions**
- **What:** One WebGL/WebGPU scene lives across routes, and DOM elements hand off to GPU elements.
- **Why:** No reload flash, so navigation itself becomes an animation.
- **How:** Codrops, 2026-06-30: a persistent WebGPU scene, DOM tracking and a small framework (https://tympanus.net/codrops/2026/06/30/building-persistent-page-transitions-with-webgpu-and-vanilla-javascript/). R3F v10 alpha's shared WebGPU renderer across several canvases points the same way.

### D. Stylization "looks"

**24. Dither, halftone, ASCII and toon outlines as one-tap looks**
- **What:** A post-process that turns the scene into a print, a Game Boy screen or a comic.
- **Why:** Like an Instagram filter, it invites sharing and people collect the styles.
- **How:** Maxime Heckel's posts on dithering and retro shading (https://blog.maximeheckel.com/posts/the-art-of-dithering-and-retro-shading-web/) and on halftone (CMYK layers at 15/75/0/45°, `fwidth` antialiasing, luma-sized dots, 2026-02-10, https://blog.maximeheckel.com/posts/shades-of-halftone/). The TSL built-ins `sobel(...)` and `bayerDither(...)` appear in the Codrops 3D Cluster. Other references: three.js `webgpu_tsl_halftone` and pmndrs `ascii` (https://pmndrs.github.io/examples/examples/ascii).
- **Mobile:** A single full-screen pass is cheap.

**25. Motion trails, smears and temporal echoes**
- **What:** Motion leaves streaks, so fast moves look fast.
- **Why:** It amplifies the user's own energy back at them.
- **How:** Maxime's "Shading Motion" (2026-08-18) covers frame differencing, temporal decay accumulation, blob tracking, optical-flow arrow fields and velocity-based smear. Motion detection runs at 0.25–0.5 resolution, and separate read and write textures keep it working in Safari (https://blog.maximeheckel.com/posts/shading-motion/). Also drei `<Trail>` and pmndrs `trails` (https://pmndrs.github.io/examples/examples/trails).

**26. Glass, transmission, iridescence and caustics**
- **What:** Jewel-like refractive objects.
- **Why:** They look premium and they react to every rotation.
- **How:** drei `MeshTransmissionMaterial` (`samples`, `resolution`, `chromaticAberration`, `anisotropicBlur`) as used in Lusion Connectors. Garden Anomaly uses `MeshPhysicalNodeMaterial` with transmission, IOR and iridescence. Also pmndrs `caustics` and `diamond-refraction`.
- **Mobile:** Transmission renders the scene twice. Lower `resolution` and `samples`, or drop it under the mobile preset.

**27. Selective bloom and emissive accents**
- **What:** Only the "hot" things glow.
- **Why:** It focuses attention and adds a sense of energy.
- **How:** WebGPU MRT bloom (pattern 20). In the WebGL postprocessing stack, pmndrs `selective-bloom` (https://pmndrs.github.io/examples/examples/selective-bloom).

### E. Device and senses

**28. Gyroscope tilt, parallax and shake**
- **What:** Tilting the phone shifts the scene or sloshes its contents. Shaking stirs it.
- **Why:** Your hand becomes the controller, and it feels a little magical on a phone.
- **How:** Listen to `deviceorientation` (alpha/beta/gamma) or `devicemotion` (acceleration). On iOS 13+ you must call `DeviceOrientationEvent.requestPermission()` or `DeviceMotionEvent.requestPermission()` from a user gesture, over HTTPS (https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static). Feature-detect with `typeof …requestPermission === 'function'`, keep a non-sensor fallback, and low-pass the values. Lupi's `enablePhoneSnow` already follows this UX (`snow-motion.ts:43-80`).
- **Mobile:** A soft pre-prompt ("Tilt to play?") before the OS dialog avoids a dead-end denial. A denial on iOS cannot be re-requested without a reload, per common reports (**UNVERIFIED**).

**29. Haptics**
- **What:** A tick when you grab, snap or collide.
- **Why:** Touch feedback makes virtual objects feel solid.
- **How:**
  - **Android/Chromium:** `navigator.vibrate(ms | pattern)`.
  - **iOS:** Safari has no Vibration API. MDN browser-compat-data issue #29166 (2026-03-03) claims it works; it is untriaged, so **UNVERIFIED**. The workaround is WebKit's native `<input type="checkbox" switch>` (Safari 17.4+ / iOS 18+), which plays a system haptic tick when toggled. Libraries: `ios-haptics` 3.2.0 (`hapticTrigger`, https://github.com/tijnjh/ios-haptics), `web-haptics` 0.0.6 (`useWebHaptics().trigger('success')`, https://github.com/lochie/web-haptics) and `@haptics/react|vanilla|core` (https://haptics-web.vercel.app/).
  - **Important:** "Apple's 26.5 patch closed every programmatic re-tick path. Multi-segment presets fire only their first tick" (haptics-web). "As of iOS 26.5, only a **direct tap** fires the haptic" (https://github.com/m1ckc3s/project-fathom). Current libraries lay a transparent switch/label overlay under the tappable element. The WebKit bug number (309082, from a search snippet) is **UNVERIFIED**.
- **Mobile implication:** On iOS you can have a tick per tap on DOM controls, but not continuous haptics during a drag or haptics from physics collisions. Android can do both.

**30. Procedural sound and satisfying sonification**
- **What:** Clicks, pops, chimes and tones generated in code and tied to interactions.
- **Why:** Sound is rare on the web, so it has outsized impact. Josh Comeau calls it a "secret weapon" (https://www.joshwcomeau.com/react/announcing-use-sound-react-hook/).
- **How:**
  - Garden Anomaly: bubble collisions trigger Web Audio sounds with an **eight-voice cap and rate limiting** so dense collisions don't turn into noise (https://tympanus.net/codrops/2026/08/06/garden-anomaly-a-tiny-webgpu-and-tsl-experiment/, demo https://dasprinzip.com/tinker/day41, code https://github.com/prinzipiell/tsl/tree/main/garden-anomaly).
  - Bruno Simon: spatialized emitters, a car with engine, tire and horn sounds, and CC0 music.
  - Igloo Inc: sound synced to particle motion.
  - Libraries: ZzFX, under 1 KB with 20 parameters and one-line effects (`zzfx` 1.3.2, https://github.com/KilledByAPixel/ZzFX); `use-sound` 5.0.0 (Howler, audio sprites); Tone.js 15.1.22.
  - "Still Night" turns Starry Night into an instrument. SAM segments the painting into five regions, each a Tone.js voice with its own effects, and brightness maps to pitch. The points are placed by Floyd–Steinberg dithering (https://stillnight.joshua-garcia.com, https://github.com/joshuagarcia-git/still-night).
  - Science tie-in: "Musical Molecules" maps IR spectra of HCl, H₂O, NH₃ and acetone into the audible range using NIST vibrational data and an anharmonic model (arXiv 2601.02652, https://arxiv.org/abs/2601.02652).
- **Mobile:** Create or resume the `AudioContext` inside a pointer handler, as Lupi's `clickSound.ts:49-60` already does. Keep sound opt-in or clearly toggleable.

**31. Audio-reactive visuals (music or microphone)**
- **What:** The scene pulses to music or to your voice.
- **Why:** You perform, and the scene responds.
- **How:** `AnalyserNode` FFT bands drive uniforms (pmndrs `audio-analyser`, `simple-audio-analyser`; Codrops "3D Audio Visualizer with Three.js, GSAP & Web Audio API", 2025-06-18, https://tympanus.net/codrops/2025/06/18/coding-a-3d-audio-visualizer-with-three-js-gsap-web-audio-api/). three.js `webgpu_compute_audio` processes audio buffers in compute. 3D Life Sim maps live audio into simulation parameters.

**32. Webcam hand tracking**
- **What:** Pinch the air to grab. Open your hand to explode the particles.
- **Why:** Novel and magical at a trade-show booth.
- **How:** MediaPipe Hand Landmarker (21 landmarks) maps gestures to 3D (Codrops, 2024-10-24, https://tympanus.net/codrops/2024/10/24/creating-a-3d-hand-controller-using-a-webcam-with-mediapipe-and-three-js/). One example has 25k particles re-forming shapes by gesture (https://github.com/FIQTOR/particle-handtracker).
- **Mobile:** Heavy: camera permission, model download and CPU/GPU contention. Best kept to desktop.

### F. Loops, sharing and retention

**33. Idle attract mode**
- **What:** When nobody is touching it, the toy plays with itself, and hands control back the instant you move.
- **Why:** A still hero looks broken. A moving one says "touch me".
- **How:** pmndrs/math `example-spring.ts`: "idle: sweep the head target on a lissajous until the pointer takes over" (`everMoved` flag). For seamless idle loops, `simplex4d` traces a circle through two extra noise dimensions, so the loop closes with "no visible seam" (`example-simplex-4d-looping-noise.ts`). That also makes perfect GIF loops.
- **Mobile:** After N seconds of idle, fall back to a cheap loop or `frameloop="demand"` to save battery.

**34. Seeded, shareable generations**
- **What:** "Randomize", and every result has a URL that reproduces it exactly.
- **Why:** People collect and trade their favorite outputs, and it drives virality.
- **How:** Seed a PRNG from a URL parameter or hash. fxhash injects `$fx.hash` and a seeded `$fx.rand()` (https://docs.fxhash.xyz/creating-on-fxhash/fxhash-api/api-reference). lisyarus shares particle-life rules through URL seeds. "Crystal Words" grows "a structurally unique snowflake from whatever you put into the keyboard", with share buttons (Ming Jyun Hung, https://momentchan.github.io/crystal-words, https://www.webgpu.com/showcase/crystal-words-snowflake-typing-webgl/). pmndrs/math `mulberry32.create(seed)` / `isaac32` give allocation-free, seedable streams.

**35. Capture and share (screenshot, GIF, MP4, native share sheet)**
- **What:** One tap to save a 5-second loop and send it.
- **Why:** The share is the growth loop.
- **How:**
  - Lupi already records with `MediaRecorder` (real-time).
  - Frame-exact, faster-than-real-time export uses WebCodecs `VideoEncoder` + **Mediabunny**. mp4-muxer is "deprecated in favor of Mediabunny, which entirely supersedes it" (https://vanilagy.github.io/mp4-muxer/). One report cites 10–30× faster export than ffmpeg.wasm (https://midee.app/blog/why-i-replaced-ffmpeg-wasm-with-webcodecs).
  - GIFs: `gifenc` (1.0.3; old but small).
  - Sharing: `navigator.canShare({files})` then `navigator.share({files, title})` works on Chrome for Android and Safari (https://web.dev/articles/web-share). Reports of iOS sometimes sharing as text are **UNVERIFIED** as current behavior.

**36. Gamification: achievements, shared counters, leaderboards**
- **What:** Hidden objectives, global counters and daily scores.
- **Why:** Discovery and light social presence make people stay and come back.
- **How:** Bruno Simon's folio has achievements that unlock skins, some "so cryptic you might not even realize". It also has a cookie stand whose counter "is actually a global counter shared by everyone", "whispers" (30 at a time, with country flags, moderated by OpenAI's free moderation model), and a circuit leaderboard that resets daily. The site is multiplayer-lite with shared weather and a day/night cycle (https://www.awwwards.com/brunos-portfolio-case-study.html, code MIT: https://github.com/brunosimon/folio-2025). It uses TSL so it "automatically runs on WebGPU when available". The world is authored in Blender with naming conventions. There are about 78,400 single-triangle grass blades that loop around the camera.

**37. Scroll-driven 3D narrative**
- **What:** Scrolling moves the camera along a story path, with particle and content reveals.
- **Why:** Scroll is the one gesture everyone knows.
- **How:** drei `ScrollControls` (pmndrs `scrollcontrols-gltf`, `gltf-animations-tied-to-scroll`, `tying-canvas-to-scroll-offset`). GSAP ScrollTrigger: GSAP including all plugins has been free since April 2025 (https://gsap.com/blog/3-13/). Lenis smooth scroll (https://github.com/darkroomengineering/lenis). Native CSS scroll-driven animations (`animation-timeline`) landed in Safari 26 (Sep 2025); Firefox stable still has them behind a flag as of 152, per https://cssawwwards.com/blog/css-scroll-driven-animations-guide-2026 (**secondary source**). Utsubo's 2026 roundup says scroll-as-narrative dominated award winners, e.g. Cartier and Shopify Editions (https://www.utsubo.com/blog/best-threejs-websites-2026).

**38. "One verb" mini-games**
- **What:** A single action (hit, drop, stack, flick) with a score.
- **Why:** You understand it instantly, and there are stakes.
- **How:** Utsubo credits the "Lacoste Ace Breaker" branded arcade game with "one verb, instant readability" (**secondary source**). pmndrs has tiny physics games: `pinball-in-70-lines`, `arkanoid-under-60-loc` and `rapier-ping-pong` (https://pmndrs.github.io/examples/). The pmndrs examples gallery was rebuilt from dead CodeSandbox links at https://pmndrs.github.io/examples/ (source monorepo https://github.com/pmndrs/examples). The revival date of about July 2026 comes from a search summary; the announcing tweet returned HTTP 402, so it is **UNVERIFIED**.

---

## 3. Cross-cutting lessons from the case studies

- **UI can live in the canvas when it adds something.** Igloo renders UI in WebGL for shader glitches and SDF text scrambles. Bruno replaces the HTML UI with 3D interactions. For Lupi, keep DOM for accessibility, but small in-canvas feedback (etched labels, rings, snaps) gives the "juice".
- **Surprise is cheap if the base is solid.** Unseen Studio's cellular toy is plain Rapier rigid-body collisions with no custom forces. The organic look comes from post-processing: Kawase blur, a luminance gradient map and a fluid color offset. An orthographic camera keeps the bodies on screen (https://unseen.co/labs/cellular/?gui).
- **Cap everything that can pile up:** audio voices (Garden Anomaly's 8), particle bursts (Gommage's 100/400), whispers (Bruno's 30).
- **Most GPU toys touch the CPU with only "a few uniform writes"** per frame (Mathis Biabiany, lit GPU tubes: ~1,500 instances, one click triggers a shockwave through a shared uniform timer, https://tympanus.net/codrops/2026/09/07/drawing-with-light-an-exploration-of-lit-gpu-tubes-with-tsl-and-webgpu/, demo https://luminhands.netlify.app/).
- **Keep science honest.** Lupi's `SnowMotion` comment, "Display-only inertia. Source atoms never move" (`snow-motion.ts:1`), is the right model. Toy motion goes in a separate display-offset layer so exports and measurements stay truthful.

---

## 4. Patterns that transfer to atoms, molecules and particles, ranked by fun per effort

Effort: **S** is days with existing pieces, **M** is 1–2 weeks, **L** is multi-week or needs new infrastructure. "Path" is where it lives: the WebGL viewer (R3F/drei/postprocessing), GPU Studio (vgpu/TSL/WGSL), or both.

| Rank | Idea (atoms version) | Fun | Effort | Path | Built on |
|---|---|---|---|---|---|
| 1 | **Poke the molecule**: atoms near the finger get pushed and spring home with overshoot (a display-only offset per atom, like SnowMotion). | High | S | Both | Patterns 3, 7, 9. CPU `spring3.update` for ≤10k atoms; for large scenes a compute pass with a rest-position buffer, reading the touch-trail texture (pattern 4). |
| 2 | **Flick to spin** with inertia and snap-back to a hero pose. Pinch zooms. | High | S | Viewer | Pattern 10. drei `PresentationControls`, or math `spring.dampAngle`. Only in a "play" mode, so orbit controls stay intact for science. |
| 3 | **Tap feedback bundle**: atom pick gives a haptic tick (Android `vibrate(8)`, iOS switch overlay on HUD buttons only), an element-pitched click and a spring ring pulse. | High | S | Both | Patterns 29 and 30. `clickSound.ts` exists; `ios-haptics` or `@haptics/vanilla`. Continuous iOS haptics are impossible after 26.5. |
| 4 | **Idle attract mode**: after about 8 s idle, a slow Lissajous camera drift and a "breathing" thermal jiggle, stopping on first input. After a longer idle, render on demand. | Med-High | S | Both | Pattern 33. Math `spring2` + `simplex4d` loop. Also a free perfect-loop GIF source. |
| 5 | **Shake or tilt the phone to heat it up**: jiggle amplitude, wobbly bonds and a color-temperature shift. Tilt sloshes a solvent particle cloud. | High | S-M | Both | Pattern 28. Reuse `enablePhoneSnow` permission UX (`snow-motion.ts:43-80`). |
| 6 | **Molecule-to-molecule morph transitions** in the switcher/gallery: atoms fly along curl-noise paths from caffeine into C60 and settle with a spring. Surplus atoms dissolve (gommage) or pop in. | Very high | M | GPU Studio first, then viewer | Patterns 14, 19, 20. `scan/gist` already morphs particles onto shapes. Math `curl3` for CPU paths at small N. |
| 7 | **"Your name as a crystal"**: seed from text (hash, then `mulberry32`) to generate a lattice or procedural molecule, with a share URL and share card. | High (viral) | M | Viewer | Pattern 34, Crystal Words. Lupi has procedural lattices, flythrough serialization and saved-view slugs. |
| 8 | **Looks bar**: halftone, dither, ASCII, toon-Sobel, blueprint and "risograph" chips; one tap, then share. | High | M | Viewer (postprocessing `Effect`), GPU Studio (TSL `sobel`/`bayerDither`) | Patterns 24 and 27. Note Lupi's V1 raster export excludes interactive postprocess, so looks are an interactive or share-card feature, not deterministic export. |
| 9 | **Five-second loop capture and native share**: a GIF or MP4 of the current toy, with frame-exact export, then the share sheet. | High (growth) | M | Both | Pattern 35. Move from `MediaRecorder` to WebCodecs + Mediabunny (and drop the unused `mp4-muxer` dependency), plus `navigator.share({files})`. |
| 10 | **Play a molecule**: tap bonds or atoms for tones from element properties or real IR modes. Strum across a molecule. | Med-High (novel, educational) | M | Viewer | Pattern 30, "Musical Molecules" and Still Night. `@atlas/nist` data exists in the repo. Tone.js or raw Web Audio; cap voices at 8. |
| 11 | **Magnetic ion cursor**: the finger becomes a charged probe; atoms colored by partial charge lean toward or away from it. Bonds stay rigid while the molecule rotates to face it. | High | M | Both | Pattern 11 plus 1. Proximity `smoothstep` falloff; Rapier or a custom spring solver for rigid-body orientation. |
| 12 | **Jelly molecule**: bonds become XPBD distance constraints, so dragging an atom tugs and wobbles the whole molecule. Release, and it relaxes. | Very high | M | Viewer (≤ a few thousand atoms) | Patterns 7 and 9. Bond topology exists; math supplies vectors and springs; XPBD substeps as in `example-circle-physics.ts`. Label it as a toy, not dynamics. |
| 13 | **Ballpit of atoms**: CPK-colored instanced spheres rain into a bowl, you swipe through them, and they rebuild the molecule on "assemble". | High | M | Viewer | Patterns 1, 21, 22. `@react-three/rapier` InstancedRigidBodies; Lusion-connectors-style center impulse. |
| 14 | **Explode and reassemble** a crystal or protein on double-tap, with confetti sparks when it is back together. | High | M | Both | Patterns 21 and 22. `random.vec3`/`random.quat` seeded; springs home. |
| 15 | **Trajectory smears**: temporal-decay accumulation so MD trajectories leave light-painting trails. | Med-High | S-M | Viewer | Pattern 25. `AtomTrails.tsx` exists for selected atoms; whole-scene decay is a single post pass. |
| 16 | **Particle-life "alchemy"**: pick 3–6 elements; a random (or chemistry-inspired) attraction matrix grows "cells". Seeded and shareable. | Very high | L | GPU Studio | Pattern 13. Binning plus prefix sum in WGSL; 16k on phones. Clearly labeled "not real chemistry". |
| 17 | **Liquid in a flask**: tilt the phone to slosh solvent particles around a solute molecule. | High | L | GPU Studio | Pattern 17. MLS-MPM from `webgpu_compute_particles_fluid`; desktop-first. |
| 18 | **Scroll story landing**: from a salt grain down to the NaCl lattice to the ions, with scroll-scrubbed zooms and morphs. | Med | M-L | Landing | Pattern 37. drei `ScrollControls` or GSAP ScrollTrigger + Lenis. |
| 19 | **Soft achievements and a shared counter**: "Atoms poked by visitors today", secret achievements (find the chiral center, spin at 10 rev/s). | Med | M | Both, plus Worker/D1 | Pattern 36. Edge storage is already in the stack. |
| 20 | **Cursor fluid behind the molecule** (dye stirred by drags, tinted by element colors). | Med | M | Background layer | Pattern 5. Decorative; watch battery. |
| 21 | **Hand-tracking mode** (pinch to rotate, open hand to explode). | Med (novelty) | L | Desktop only | Pattern 32. Last priority. |

**Suggested first slice.** Items 1, 2, 3, 4 and 5 together form a "Play mode" toggle. It reuses existing springs, sound and motion permission, plus a small display-offset buffer. It changes how the viewer feels on a phone without touching the science paths. Items 6, 8 and 9 then turn that play into things people can share.

---

## Sources

**pmndrs and ecosystem**
- https://github.com/pmndrs/math ; https://github.com/pmndrs/math/releases ; https://pmndrs.github.io/math/examples/ ; npm tarball https://registry.npmjs.org/math/-/math-0.1.0.tgz
- pmndrs/math examples: https://github.com/pmndrs/math/tree/main/examples/src (example-spring.ts, example-circle-physics.ts, example-flow-field.ts, example-simplex-4d-looping-noise.ts, example-fabrik-2d-snek.ts)
- https://github.com/pmndrs/react-three-fiber/releases ; https://r3f.docs.pmnd.rs/advanced/scaling-performance
- https://drei.docs.pmnd.rs/controls/presentation-controls ; https://drei.docs.pmnd.rs/gizmos/drag-controls
- https://pmndrs.github.io/examples/ ; https://github.com/pmndrs/examples (examples/lusion-connectors, object-clump, confetti, bouncy-watch, flow-shield, hi-key-bubbles)
- https://github.com/pmndrs/react-spring/discussions/1898
- npm registry metadata: https://registry.npmjs.org/{@react-three/fiber, @react-three/drei, three, postprocessing, @react-three/postprocessing, math, @pmndrs/scheduler, mediabunny, ios-haptics, web-haptics, gsap, lenis, zzfx, use-sound, tone, canvas-confetti, gifenc, three-start, gpucat}

**three.js and TSL**
- https://threejs.org/examples/ (webgpu_compute_particles, webgpu_compute_particles_fluid, webgpu_compute_cloth, webgpu_tsl_vfx_linkedparticles, webgpu_compute_audio, webgpu_tsl_compute_attractors_particles, webgpu_compute_birds, webgpu_tsl_halftone, webgpu_tsl_galaxy); source https://github.com/mrdoob/three.js/tree/dev/examples
- https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/ ; https://blog.maximeheckel.com/posts/shading-motion/ ; https://blog.maximeheckel.com/posts/shades-of-halftone/ ; https://blog.maximeheckel.com/posts/the-art-of-dithering-and-retro-shading-web/ ; https://blog.maximeheckel.com/posts/the-magical-world-of-particles-with-react-three-fiber-and-shaders/ ; https://r3f.maximeheckel.com/fbo-morphing ; https://r3f.maximeheckel.com/attractor
- https://threejs-journey.com/lessons/gpgpu-flow-field-particles-shaders ; https://threejs-journey.com/lessons/particles-morphing-shader ; https://threejs-journey.com/lessons/particles-cursor-animation-shader
- https://threejsroadmap.com/blog/galaxy-simulation-webgpu-compute-shaders ; https://dgreenheck.github.io/webgpu-galaxy/
- https://github.com/chrismaldona2/tsl-morphing-particles

**Codrops**
- https://tympanus.net/codrops/2026/08/12/creating-an-interactive-3d-cluster-with-three-js-tsl-and-three-start/
- https://tympanus.net/codrops/2026/08/06/garden-anomaly-a-tiny-webgpu-and-tsl-experiment/
- https://tympanus.net/codrops/2026/09/24/custom-shaped-cursor-trail/
- https://tympanus.net/codrops/2026/09/07/drawing-with-light-an-exploration-of-lit-gpu-tubes-with-tsl-and-webgpu/
- https://tympanus.net/codrops/2026/09/09/still-from-akira-to-ink-wash-building-a-generative-garden-in-webgpu/
- https://tympanus.net/codrops/2026/06/30/building-persistent-page-transitions-with-webgpu-and-vanilla-javascript/
- https://tympanus.net/codrops/2026/04/13/lusion-where-digital-craft-meets-ambitious-experimentation/
- https://tympanus.net/codrops/2026/01/28/webgpu-gommage-effect-dissolving-msdf-text-into-dust-and-petals-with-three-js-tsl/
- https://tympanus.net/codrops/2025/12/29/2025-a-very-special-year-in-review/
- https://tympanus.net/codrops/2025/09/11/when-cells-collide-the-making-of-an-organic-particle-experiment-with-rapier-three-js/
- https://tympanus.net/codrops/2025/07/22/interactive-text-destruction-with-three-js-webgpu-and-tsl/
- https://tympanus.net/codrops/2025/06/18/coding-a-3d-audio-visualizer-with-three-js-gsap-web-audio-api/
- https://tympanus.net/codrops/2025/06/09/how-to-create-interactive-droplet-like-metaballs-with-three-js-and-glsl/
- https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/
- https://tympanus.net/codrops/2025/01/29/particles-progress-and-perseverance-a-journey-into-webgpu-fluids/
- https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/
- https://tympanus.net/codrops/2024/10/24/creating-a-3d-hand-controller-using-a-webcam-with-mediapipe-and-three-js/
- https://tympanus.net/codrops/2019/01/17/interactive-particles-with-three-js/
- https://tympanus.net/codrops/tag/tsl/ ; https://tympanus.net/Development/MagneticButtons/

**Studios and award sites**
- https://www.awwwards.com/brunos-portfolio-case-study.html ; https://github.com/brunosimon/folio-2025
- https://www.awwwards.com/igloo-inc-case-study.html
- https://lusion.co/projects/oryzo_ai/ ; https://www.utsubo.com/blog/best-threejs-websites-2026
- https://unseen.co/labs/cellular/

**webgpu.com showcase and independent work**
- https://www.webgpu.com/tag/particles/ ; https://www.webgpu.com/showcase/softbody-tetris-webgpu-threejs-jelly-physics/ ; https://www.webgpu.com/showcase/party-webgpu-particle-physics-playground/ ; https://www.webgpu.com/showcase/crystal-words-snowflake-typing-webgl/ ; https://www.webgpu.com/showcase/still-night-playable-starry-night/ ; https://www.webgpu.com/showcase/3d-life-sim-webgpu-artificial-life-visualizer/ ; https://www.webgpu.com/showcase/martin-laxenaire-portfolio-webgpu-game-gpu-curtains/
- https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html
- https://matthias-research.github.io/pages/tenMinutePhysics/10-softBodies.html
- https://github.com/PavelDoGreat/WebGL-Fluid-Simulation ; https://github.com/FunTechInc/use-shader-fx
- https://github.com/FIQTOR/particle-handtracker ; https://github.com/RobertoLovece/Rope-Grid

**Device, audio, capture and scroll**
- https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static
- https://github.com/tijnjh/ios-haptics ; https://github.com/lochie/web-haptics ; https://haptics-web.vercel.app/ ; https://github.com/m1ckc3s/project-fathom ; https://github.com/mdn/browser-compat-data/issues/29166
- https://bugs.webkit.org/show_bug.cgi?id=168837 ; https://motion.dev/magazine/when-browsers-throttle-requestanimationframe
- https://web.dev/learn/accessibility/motion ; https://web.dev/articles/web-share
- https://github.com/KilledByAPixel/ZzFX ; https://www.joshwcomeau.com/react/announcing-use-sound-react-hook/ ; https://arxiv.org/abs/2601.02652 ; https://stillnight.joshua-garcia.com
- https://vanilagy.github.io/mp4-muxer/ ; https://midee.app/blog/why-i-replaced-ffmpeg-wasm-with-webcodecs
- https://docs.fxhash.xyz/creating-on-fxhash/fxhash-api/api-reference
- https://gsap.com/blog/3-13/ ; https://github.com/darkroomengineering/lenis ; https://cssawwwards.com/blog/css-scroll-driven-animations-guide-2026

**Lupi code references**
- `packages/ui/src/viewer/ViewerCanvas.tsx:19-35, 67, 76`
- `packages/ui/src/gpu-studio/snow-motion.ts:1-33, 43-80` ; `packages/ui/src/gpu-studio/GpuStudioLaunch.tsx:89`
- `packages/ui/src/lib/clickSound.ts:1-11, 49-60, 78` ; `packages/ui/src/lib/spring.ts:38-77`
- `packages/ui/src/hooks/usePressSpring.ts` ; `packages/ui/src/action-light/motion.ts`
- `packages/ui/src/ExportManager.tsx:885-895` ; `packages/ui/package.json:39` (mp4-muxer)
- `packages/ui/src/AtomTrails.tsx:1-12` ; `packages/ui/src/flythrough.ts:1-13` ; `packages/ui/src/scan/gist/GistStage.tsx:1-8`
