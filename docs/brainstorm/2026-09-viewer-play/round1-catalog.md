# Round 1 idea catalog

All 180 round-1 ideas from nine lenses, deduplicated into 119 canonical ideas (C001–C119) and scored 1–5 by five judges: E engineer (v10 baseline), P play-tester, A art director, Pr product steward, M mobile and accessibility. Tier is the round-1 review verdict (see [round1-review.md](round1-review.md)). Ordered by theme, as clustered.

Tier counts: Champion 19, Folded 25, Killed 6, Parked 22, Rework 17, Strong 30.


## Perf foundation

<a id="c001"></a>
### C001 · Lupi on v10: the TSL toy engine
**Champion** · mean 4 (E5 P3 A4 Pr4 M4) · effort XL · mixed · rides R1-R12 (this is the port)

Treat the mandatory v10 port as the moment to build a toy engine: TSL impostors with a display-offset buffer, MRT post, one mood-uniform set and one GPUDevice, with the WebGL2 backend as the fallback.

- **Summary:** Problem: every fun idea needs offsets, glow and uniform-driven looks, but GLSL impostors and five RAF loops make each a retrofit. Solution: do the port (R1 pins, R2 repack, R3/R4 TSL impostors and bonds, R6 pipeline) with the hooks built in: offset buffer, glow byte, velocity, mood bus. Visitors see parity at first; later toys land as uniforms. Supersedes the v9 bump and the TSL-on-WebGL handler.
- **Tech:** fiber/tsl canary triplet pinned exact; three 0.186.1 (r187 floor); TSL positionNode/depthNode, instancedArray, useBuffers, configureTSL+useUniforms, useRenderPipeline+MRT; scheduler phases; unorm8x4 repack
- **Judges:**
  - E 5/champion: This is the mandatory R1-R12 port done with the hooks built in, which is the cheapest time to add them. The real risk is scope creep: adding velocity, glow, the mood bus and the offset buffer on top of R3's 2.5-3.5 week, no-reference-example impostor port will stretch the parity schedule and muddy the early-Z gate. *Improve:* During R2/R3, land only the offset buffer and the R2 flag byte. Defer positionPrevious velocity and TRAA until the gate spike proves impostor motion vectors, and give each hook its own parity test in the dual CI lanes.
  - P 3/keep: Players won't see anything from this for about 4-5 months of parity work. Its fun value depends entirely on the offset buffer, glow byte and mood bus existing on day one, so that later toys are just uniform tweaks. *Improve:* Make two toys (dandelion burst and tap ripple) the port's acceptance test, so the parity milestone ships with juice and not just parity.
  - A 4/keep: This is the right base for a unified look system, since one mood bus gives art direction one control surface. But "parity at first" hides the real visual risk: the N8AO and vanruesc look is lost, so Studio, Paper, Night and Prism will drift in tone and AO character. *Improve:* Add a look-parity golden set (4 looks x 3 molecules x 2 backends) that gets art-director sign-off before Phase 1 closes. Re-tune AO and tone mapping to match or beat it.
  - Pr 4/keep: The port is mandatory, so the only real decision is whether the hooks go in now. They should: the offset buffer, glow byte, ID MRT and mood bus are what make most of the later toys cheap. The strategic catch is 4-5 months of work visitors can't see, at XL scope risk. *Improve:* Write the hook list into the R2/R3/R4/R6 acceptance criteria (offset buffer zeroed in export, flag byte, ID MRT, mood bus). Make one visible toy, the poke ripple, the demo that shows parity is done.
  - M 4/keep: The port is mandatory, and it is the right moment to add the offset, glow and velocity hooks. But nothing has been measured on a phone: early-Z loss, HalfFloat bandwidth on tile GPUs and the r187-only GL2 leak fix all hit older iPhones hardest, and those iPhones are also the ~13% fallback. *Improve:* Make the gate spike a phone gate. Test an iOS 17/18 iPhone on the GL2 fallback, a mid-range Android and an iPhone 15 in Low Power Mode, with UnsignedByte output, before committing the hook designs.
- **Round-1 ideas merged here:**
  - `R1-r3f-sweep-19` **Lupi on R3F v10 + WebGPU** — Rebuild the viewer as a WebGPU toy engine: TSL impostors, compute-driven display offsets for millions of atoms, MRT post and one shared 'mood' uniform set, with today's WebGL viewer as the fallback.
  - `R1-r3f-sweep-18` **Write It Once in TSL** — Bring GPU Studio's snowglobe atoms to the regular WebGL viewer, and every future effect to both renderers, by writing shaders in TSL and running them on the classic renderer through r184's WebGLNodesHandler.
  - `R1-perf-feel-01` **Upgrade-Only Wins** — Bump to R3F 9.8.1, drei 10.7.9 and one copy of @react-three/postprocessing to pick up free fixes that the other feel ideas depend on.

<a id="c002"></a>
### C002 · Quiet Idle on One Clock
**Champion** · mean 4.2 (E5 P3 A3 Pr5 M5) · effort M · DOM/CPU (ships on v9 today) · rides R7

Playback, springs, DOM effects and the render share one phased scheduler loop, and a molecule nobody touches draws zero frames until the finger lands.

- **Summary:** Problem: five RAFs, overlays a frame behind, and an idle viewer redrawing 60-120 times a second. Solution: v10's scheduler with named phases (input, physics, update, render, capture) and frameloop='demand' by default; controls, springs and store changes call invalidate(), onIdle ends settle work. Visitor: nothing new to see on desktop, just no lag; phones run cooler and the first touch renders in the same frame.
- **Tech:** @pmndrs/scheduler 0.2.0 via fiber v10: register({phase,before,after,fps}), onIdle, frameloop='demand', invalidate(); named phases only (numeric priorities run reversed); ExportManager state machine
- **Judges:**
  - E 5/champion: This is the biggest battery and calm win on the list. It is renderer-agnostic, @pmndrs/scheduler 0.2.0 already works without v10, and it removes five RAF loops. The trap is R7: numeric priorities run in reverse with only a deprecation warning, and ExportManager, playback and gist each need an explicit job, or demand mode silently freezes them. *Improve:* Add a lint rule or wrapper that bans numeric priorities and forces named phases. Then add a CI assertion that an idle viewer with no active jobs commits zero frames.
  - P 3/keep: Zero idle frames keeps phones cool. But a molecule that freezes solid reads as dead, and any wake latency makes the first touch feel sticky. *Improve:* Gate it on a measured first-touch-to-photon check, and pair it with C020's short breathing so the viewer sleeps only after an idle invitation.
  - A 3/keep: It adds nothing you can see in a screenshot, but it fixes a real motion defect: overlays trail the molecule by one frame. The switch to demand rendering can also cause a visible snap on the last frame if springs are cut off before they truly settle. *Improve:* Go to sleep only after an analytic settle threshold under half a pixel, so the final drawn frame is the rest pose rather than a spring cut off early.
  - Pr 5/champion: Demand frames on one loop are the cheapest win for phone battery and session length. It is renderer-agnostic, part of it ships on v9 today, and every 'calm, then play' toy needs it. The main risk is the reversed-priority trap in ExportManager. *Improve:* Ship the v9 slice now: demand frameloop, invalidate() from controls and the store, and ExportManager as a phased state machine. Add a CI gate on idle renders before v10 lands.
  - M 5/champion: This is the biggest battery and thermal win on the list, and scheduler 0.2.0 lets it ship on v9. Demand frames also make reduced motion simple: each action calls invalidate() once and leaves one still frame. *Improve:* Add a CI assertion that an idle viewer renders zero frames. Pause on visibilitychange and on WebGPU device loss. Make every toy declare its settle condition, so no toy quietly runs 'always'.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-02` **Quiet Idle** — Stop redrawing a molecule nobody is touching 60 to 120 times a second, and wake up in the same frame the finger lands.
  - `R1-perf-feel-12` **One Clock** — Put playback, springs, DOM effects and the 3D render on a single phased frame loop, so nothing lags a frame behind anything else.

<a id="c003"></a>
### C003 · One Motion Kernel: same glide at 30, 60 and 120 Hz
**Champion** · mean 4.8 (E5 P4 A5 Pr5 M5) · effort S · DOM/CPU (ships on v9 today) · rides none (R7 phase placement)

Replace per-frame lerps and damping with math/time's exact analytic springs so every drag, fling, focus glide and particle swirl settles in the same wall-clock time on every display.

- **Summary:** Problem: OrbitControls damping, CameraFocus, gist EASE and swirl lerps are per-frame, so settle time varies ~4x between 30 Hz Low Power iPhones and 120 Hz ProMotion, and the gist camera allocates each frame. Solution: one kernel of math/time springs (fromResponse tuning) plus ZO matrices into scratch tuples for controls, focus, UI and particles. Visitor: flicks and fly-tos feel identical on every device.
- **Tech:** math@0.1.0 pinned exact: spring/spring3 damp/update, spring.fromResponse, dampAngle, easing; mat4.lookAt/perspectiveZO/invert into scratch; dt-based OrbitControls damping; runs in a scheduler update phase
- **Judges:**
  - E 5/champion: The math/time springs are verified at 0.1.0 (update, damp, dampAngle, fromResponse), and the analytic integrator is exactly right for 30/60/120 Hz parity. The S effort is understated, though: OrbitControls damping is applied per update() call, so dt-correct damping means owning the controller. *Improve:* Build the kernel as the camera controller that C021 needs, rather than patching OrbitControls. Share one scratch-tuple module and one settle-epsilon helper, since math has no 'settled' helper.
  - P 4/champion: Springs are the core of game feel. The same settle time at 30, 60 and 120 Hz is what makes a flick feel the same on a Low Power iPhone and a ProMotion one, and it ships on v9. There is no overshoot or boing vocabulary yet, because math has no back or elastic easing. *Improve:* Ship a named feel palette (snappy, floaty, and boingy via an underdamped ζ) with a dev-only ?feel tuner, so every toy draws from the same tuned springs.
  - A 5/champion: This is Lupi's motion design system. Equal settle times at 30, 60 and 120 Hz make springs feel designed rather than accidental, and it ships on v9 today. *Improve:* Publish 4-5 named motion tokens (snap, glide, float, wobble, settle) with fixed response and damping, and require every toy, camera move and DOM transition to use them.
  - Pr 5/champion: Small, ships on v9, and removes up to 4x variation in settle time between 30, 60 and 120 Hz displays. Every gesture toy after it gets consistent feel for free. *Improve:* Land it as one Lupi motion module on pinned math@0.1.0, with a unit test for settle time at 30, 60 and 120 Hz and a lint rule that forbids new per-frame lerps.
  - M 5/champion: This directly fixes settle times at iOS Low Power Mode's 30 fps being about 4x slower than on ProMotion. It is size S, ships on v9, and one shared kernel is the natural home for a global reduced-motion switch. *Improve:* Give the kernel a motionScale / reduced-motion mode, so every spring can snap or crossfade from one place. Honour both the OS setting and an in-app toggle.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-03` **One Motion Kernel** — Replace 3 spring styles, 5 frame-rate-dependent lerps and the gist engine's allocating camera with math/time's exact springs and math core's ZO matrices, so motion feels the same at 30, 60 and 120 Hz.
  - `R1-perf-feel-03` **Same Glide on Every Screen** — Make every lerp, damp and spring time-based with math/time, so a flick, a focus fly-to or a particle swirl feels identical at 30, 60 and 120 Hz.
  - `R1-mobile-native-01` **Same Feel at 30, 60 and 120 Hz** — Make every drag, fling and camera glide settle in the same wall-clock time on a Low Power Mode iPhone (30 Hz), a normal phone (60 Hz) and a ProMotion iPhone (120 Hz).

<a id="c004"></a>
### C004 · Measured One-Way Quality Ladder and Fun Budget
**Strong** · mean 3.8 (E4 P3 A3 Pr4 M5) · effort M · mixed · rides R6, R7

Replace user-agent tiering with a short measured calibration and a ladder that steps quality down at most once, keeps phones cool, and spends spare headroom on fun layers.

- **Summary:** Problem: every iPad is 'mobile', weak phones stutter, and tiers flip-flop or cook the device over ten minutes. Solution: calibrate on the first frames, then a one-way ladder (DPR, render scale plus fsr1, half-res AO, atom tier, toy layers as one funBudget) with thermal drift inferred from frame times. Visitor: strong tablets get the full look, weak phones hold a steady 60 or an honest 30, and ripples or snow appear only when affordable.
- **Tech:** drei 11 PerformanceMonitor (runtime-verify) or a hand-rolled frame-time sampler; state.performance.regress; per-job fps; half-res ssao() + fsr1 render scale; UnsignedByte output on mobile; detect-gpu as a prior
- **Judges:**
  - E 4/keep: A measured, one-way ladder is the right shape, and fsr1 plus render scale plus half-res SSAO are all real r186 nodes. But drei 11's PerformanceMonitor is only 'implemented', and inferring thermal drift from frame times is unproven, with zero device data. *Improve:* Start with a hand-rolled frame-time sampler on the scheduler's finish phase that has exactly two rungs (DPR and render scale). Add the funBudget only after C014 has real phone traces.
  - P 3/keep: A steady frame rate protects juice, and 'funBudget' is the right framing. But a stranger never sees a ladder, only stutter or a toy that silently isn't there. *Improve:* Never step quality mid-gesture: step only between gestures, and fade dropped toy layers out instead of letting them pop.
  - A 3/keep: A one-way ladder keeps visuals consistent because quality never flip-flops. But each step down (DPR, AO off) is a visible drop in quality, and a fun budget that shows toys only on some devices makes the product look inconsistent across devices. *Improve:* Write an art-directed look spec for each rung, and change rungs only at rest moments behind a short crossfade, never mid-gesture.
  - Pr 4/keep: A real gain in phone reach: strong tablets get the full look and weak phones stay steady, and the funBudget decides which toys appear. With no device data yet, though, the ladder would be tuned to guesses. *Improve:* Fold in C006 as a rung and C087's calibration. Tune the thresholds only from C014's device-lab data.
  - M 5/champion: Measured calibration instead of user-agent tiers is exactly what phones need. But a frame-time sampler will mistake iOS Low Power Mode's 30 fps rAF cap, and shader-compile hitches during load, for a weak GPU, and a one-way ladder then strands the device on a low tier. *Improve:* Treat a locked 33.3 ms rAF cadence as Low Power Mode rather than slowness. Calibrate only after the compileAsync warm-up, and allow one step back up after sustained headroom.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-15` **Measured, Not Sniffed** — Replace user-agent tiering with a quick measured calibration plus a one-way PerformanceMonitor ladder, so strong tablets get the full look and weak phones never stutter.
  - `R1-mobile-native-02` **Cool Pocket: demand frames and a one-way thermal governor** — An idle viewer that draws zero frames, plus an adaptive ladder that steps quality down once, never oscillates, and keeps a phone at a steady 60 (or an honest 30) for ten minutes instead of cooking it.
  - `R1-r3f-sweep-02` **Fun Budget Governor** — Measure the real frame rate and spend spare frames on fun: a phone gets ripples, snow and bloom only when it can afford them.

<a id="c005"></a>
### C005 · Idle Hygiene Sweep
**Folded into C014** · mean 3.4 (E4 P3 A3 Pr3 M4) · effort S · DOM/CPU (ships on v9 today) · rides none

Remove the per-frame allocations and pointless React renders that show up as random micro-stutters during orbit.

- **Summary:** Problem: per-frame allocations (Frustum arrays, gist camera Float32Arrays, Sets, texture needsUpdate) and needless React commits cause random hitches during orbit, worst on phones. Solution: caller-owned scratch tuples via math core and frame-owned values kept in refs, verified with the allocation timeline and React Profiler. Visitor: orbit stops hitching on desktop and phone. The v10 scheduler jobs must keep the same discipline.
- **Tech:** math@0.1.0 frustum.setFromViewProjectionMatrixNO/intersectsBox3 into scratch; Chrome allocation timeline; React Profiler; scheduler jobs write refs, not state
- **Judges:**
  - E 4/keep: This is cheap, ships on v9, and directly fixes the measured hotspots (the allocating AtomPicker, per-frame BillionAtomBlock uploads, KnowledgeLabelsLayer re-rendering at 20 Hz). It is not visitor-visible as a feature, but it is a prerequisite for demand mode to feel smooth. *Improve:* Fold it into C014's CI gates, with an allocation-per-frame and idle-commit budget, so the hygiene can't rot after the v10 port.
  - P 3/keep: Random micro-hitches during orbit are exactly what makes a spin feel cheap. This is small and ships on v9, but it isn't a toy. *Improve:* Fold it into C003's rollout as one 'feel pass', gated on a hitch count measured during a scripted flick.
  - A 3/keep: Micro-hitches during orbit are the most common reason a render feels cheap. The work is unglamorous, but it buys a lot of perceived polish and ships now. *Improve:* Track a hitch budget (p99 frame time during a scripted orbit) so any loss of polish shows up as a failing number.
  - Pr 3/keep: Cheap, invisible hygiene that removes random micro-stutters. No risk, but low visibility. *Improve:* Enforce it as CI budgets for per-frame allocation and React commits inside C014, so it can't quietly rot.
  - M 4/keep: Cheap, invisible removal of hitches. It matters most in phone Safari, where GC pauses are felt, and it ships today. *Improve:* Turn the allocation and idle-commit findings into C014's CI gates, so the fixes don't rot after the v10 port.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-10` **Idle Hygiene Sweep** — Remove the per-frame allocations and pointless React renders that show up as random micro-stutters during orbit.

<a id="c006"></a>
### C006 · Develop on Release
**Folded into C004** · mean 3 (E3 P2 A3 Pr3 M4) · effort S · [GL2-degraded] · rides R6, R7

Render at reduced resolution while you whip the molecule around, then snap to a crisp full-resolution frame the moment you let go.

- **Summary:** Problem: full-resolution frames with post during fast drags waste fill rate and drop frames on phones. Solution: while the pointer drags, drop the pipeline's render scale to 0.6-0.75 and upscale with fsr1; on release render one crisp full-res frame, then sleep under demand. Visitor: whipping the molecule stays fluid on desktop and phone, and letting go 'develops' a sharp still.
- **Tech:** useRenderPipeline render scale + fsr1() (no speed-up from fsr1 on the GL2 backend); state.performance.regress on control change; frameloop='demand' invalidate on release
- **Judges:**
  - E 3/keep: Sound in principle, but changing the pipeline render scale on pointerdown/up reallocates every pipeline target, which causes the very hitch it is meant to avoid. The brief also notes that fsr1 gives no speed-up on the GL2 backend. *Improve:* Pre-allocate the reduced-scale targets and switch the viewport or scale only through a uniform. Gate it on C004's ladder, so strong devices never soften.
  - P 2/rework: The player is looking at the molecule while dragging, so softening it during the play moment trades away the wrong thing. On the GL2 backend it gains nothing. *Improve:* Engage it only when the frame-time sampler shows frames actually being missed, and never by default on desktop.
  - A 3/keep: The 'develop on release' metaphor fits the photographic brand. But a hard swap to full resolution on release reads as a pop, and on the GL2 backend fsr1 gives no speed-up. *Improve:* Crossfade in the crisp frame over about 120 ms (or accumulate it), and turn on reduced render scale only when measured frame time calls for it.
  - Pr 3/merge: A sensible drop in render scale while dragging, but it is one rung of the quality ladder (C004), not a product. fsr1 also gives no speed-up on the GL2 backend. *Improve:* Make it a C004 rung that switches on only when measured frame times during a drag call for it.
  - M 4/merge: Merge into C004. Lowering render scale during drags targets the real phone limit, fill rate. But the snap to full sharpness on release is a visible pop, resizing targets can hitch, and fsr1 gives no speed-up on GL2. *Improve:* Make it the 'interacting' rung of C004's ladder: reuse preallocated targets, and cross-fade to the crisp frame instead of popping.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-05` **Develop on Release** — Render at reduced resolution while you whip the molecule around, then snap to a crisp full-resolution frame the moment you let go.

<a id="c007"></a>
### C007 · Crisp Edges, Lighter Frames
**Rework** · mean 3.4 (E3 P3 A5 Pr3 M3) · effort M · [GPU+GL2] · rides R3, R6, R9

Give atom impostors analytic edge coverage so silhouettes stop sizzling, and stop paying for MSAA that can't smooth them.

- **Summary:** Problem: impostor silhouettes use discard, so MSAA can't smooth them and edges sizzle while rotating, yet MSAA is still paid for. Solution: analytic edge coverage from the sphere distance (fwidth-based alpha-to-coverage) written into the TSL impostor during R3, then drop MSAA for atoms and use cheap post AA. Visitor: clean silhouettes everywhere and lighter frames on phones. Do it inside R3, not as new GLSL.
- **Tech:** TSL fwidth on the analytic sphere distance in the R3 impostor fragment; material.alphaToCoverage; TSL fxaa/smaa in useRenderPipeline; re-cut V2 export baselines
- **Judges:**
  - E 3/rework: This is internally contradictory. In three 0.186.1, WebGPUPipelineUtils sets alphaToCoverageEnabled only when sampleCount > 1, and the GL2 backend likewise requires currentSamples > 0, so 'use alpha-to-coverage, then drop MSAA' leaves no coverage at all. Analytic alpha without MSAA needs blending and therefore sorting. *Improve:* Keep 4x MSAA plus fwidth-based alpha-to-coverage on desktop, and use FXAA/SMAA on phones. Revisit dropping MSAA only after impostor velocity makes TRAA viable.
  - P 3/merge: Sizzling silhouettes during a spin cheapen the fidget flick, but players won't notice the fix as fun. It belongs inside R3; merge into C001. *Improve:* Fold it into C001's impostor acceptance criteria, measured on a fast flick.
  - A 5/champion: Sizzling discard silhouettes and moire on lattices are the most visible 'cheap renderer' tell at scale and on phones. Analytic coverage fixes this at the source, inside the mandatory R3 port. *Improve:* Validate on the worst case, a million-atom copper lattice mid-orbit at phone DPR. Bias coverage so tiny distant atoms fade out rather than flicker.
  - Pr 3/keep: The silhouette shimmer is a real quality flaw, and fixing it inside R3 is the right timing. It is visual polish, not a growth lever, and it forces a re-cut of the V2 baselines. *Improve:* Make analytic edge coverage an acceptance criterion of the R3 impostor rather than a separate project.
  - M 3/rework: Alpha-to-coverage needs MSAA samples, so 'drop MSAA and use alpha-to-coverage' contradicts itself. Tile GPUs also resolve MSAA on-chip, so the phone saving is smaller than claimed. *Improve:* Pick one: MSAA 2x plus alpha-to-coverage on phones, or no MSAA plus SMAA on desktop. Measure shimmer and cost on a real tile GPU.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-07` **Crisp Edges, Lighter Frames** — Give atom impostors analytic edge coverage, so silhouettes stop sizzling, and stop paying for MSAA that can't smooth them.

<a id="c008"></a>
### C008 · Play Without the Flash
**Folded into C048** · mean 3.6 (E4 P3 A4 Pr3 M4) · effort M · [GPU+GL2] · rides R6

Stop rebuilding the post stack on Play, Pause and Remix, so motion starts instantly and looks melt into each other.

- **Summary:** Problem: Play, Pause and Remix rebuild the EffectComposer (MSAA toggles), causing a visible flash and hitch. Solution: on v10 the post stack is one persistent useRenderPipeline graph whose pass weights are uniforms; Play lowers weights instead of rebuilding, and alternate looks are prewarmed with compileAsync. Visitor: Play starts instantly and Remix looks melt into each other on desktop and phone.
- **Tech:** useRenderPipeline with uniform pass weights (assign uniforms to bloomPass.strength); compileAsync prewarm; math/time spring blends; no composer rebuild
- **Judges:**
  - E 4/keep: The right R6 design principle: bloomPass.strength is verified as a uniform node, and one persistent graph avoids EffectComposer rebuild flashes. However, a pass at weight 0 still runs its mip chain, so 'lower the weights' saves no GPU time. *Improve:* Use uniform weights for blends, but pair them with prewarmed (compileAsync) alternate outputNodes so that Play genuinely drops expensive passes instead of multiplying them by zero.
  - P 3/merge: A flash on Play or Remix kills the juice. The fix (uniform weights, no rebuild) is the same mechanism as the Look Space; merge into C048. *Improve:* Make Remix and Play springs between points in C048's one look space.
  - A 4/merge: The flash on Play and Remix is a craft bug that undercuts every look transition. This idea is the pipeline half of continuous look morphing. *Improve:* Fold into C048, so pass weights live in the same look-space uniforms and every look change is a spring rather than a rebuild.
  - Pr 3/merge: The flash on Play and Remix is real, but the fix follows naturally from a persistent R6 pipeline with uniform pass weights, which is C048's design. Merge into C048. *Improve:* Add 'no composer rebuild on Play or Remix' to C048 as an R6 acceptance test.
  - M 4/merge: Merge into C048. Removing the full-screen flash on every Play/Remix toggle is also a photosensitivity fix, but it is a design rule for R6 rather than a feature of its own. *Improve:* Make it an R6 requirement: one persistent graph with uniform pass weights and compileAsync prewarm, plus a test that no toggle rebuilds the composer.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-08` **Play Without the Flash** — Stop rebuilding the whole post-processing stack on Play, Pause and Remix, so motion starts instantly and looks melt into each other.

<a id="c009"></a>
### C009 · Hover for Free: GPU ID Picking, Magnet Glow and Toy Wheel
**Champion** · mean 4.2 (E5 P4 A4 Pr4 M4) · effort M · [GPU+GL2] · rides R2, R3, R6

An ID render target read one pixel at a time makes hover and scrubbing free up to 5M atoms, powering a magnetic hover glow, a long-press radial toy wheel and off-screen waypoints.

- **Summary:** Problem: the CPU picker ray-marches and allocates per mousemove, so hover glow and finger scrubbing are unaffordable on big scenes. Solution: an ID MRT plus one 1-pixel async read per frame (allocation-free grid DDA as fallback). Hover swells the atom and rims its neighbours; long-press opens a radial wheel (Follow, Label, Knife, Box, Poke); off-screen selections get chevrons. Desktop: magnet cursor. Phone: scrub-to-select.
- **Tech:** ID MRT in the R3 impostor + readRenderTargetPixelsAsync (both backends); fallback SpatialHash3D 3D-DDA + hand-written ray-sphere; math polar/spring2 for the wheel; R2 flag byte for hover
- **Judges:**
  - E 5/champion: A GPU ID MRT plus a 1-pixel readRenderTargetPixelsAsync readback exists on both backends (verified in Renderer and in the WebGL fallback's PBO path), and it unlocks hover, poke, tug and hunts. Two caveats: a full-res ID attachment costs bandwidth on tile GPUs every frame, and GL2 readPixels on an R32UI RED_INTEGER target is implementation-defined. The toy wheel and chevrons are scope creep. *Improve:* Pack the ID into RGBA8 (24-bit ID plus the flag byte) for portability. On touch devices, render the ID pass only on tap, as a scissored pass, rather than as a permanent MRT; keep the wheel as a separate item.
  - P 4/keep: Hover swell on desktop is instant 'it notices me' juice, and GPU picking is the backbone of every poke toy. The long-press radial wheel is a good anti-panel, but long-press itself can't be discovered. *Improve:* Add a visible, gently pulsing 'Play' chip on the canvas that opens the same wheel, so visitors find the toys without a hidden gesture.
  - A 4/keep: Free hover makes the molecule feel alive under the cursor. But magnet glow, rim neighbours, a radial wheel and chevrons are four feedback languages at once, which will look busy and unconsidered. *Improve:* Design one restrained hover signature: a thin rim in the key-light colour plus a slight swell of that atom only. Defer the toy wheel until the verbs it would hold exist.
  - Pr 4/keep: High leverage: cheap hover and exact picks up to 5M atoms power the loupe, glow, poke, hunts and games. The toy wheel adds a long-press grammar question that nobody owns yet. *Improve:* Ship the picker as port infrastructure (R3/R6) separately from the toy wheel, and settle long-press once across C024, C031 and C033.
  - M 4/keep: GPU ID picking is a real phone win over the allocating CPU ray-march. But a 1-pixel read is wrong for fingers, hover glow is desktop-only, and the long-press wheel competes with tug, loupe and heat for the same gesture. *Improve:* Read a finger-sized patch around the touch (about 9x9 px) and pick the ID nearest the centre. Settle long-press ownership in one gesture grammar.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-16` **Magnet Cursor, Toy Wheel and Waypoints** — An allocation-free grid DDA picker makes hover cheap enough for a 120 Hz magnetic glow, a long-press polar 'toy wheel' puts Knife/Box/Follow/Label under the thumb, and off-screen selections get game-style waypoint chevrons.
  - `R1-perf-feel-09` **Hover That Costs Nothing** — Rewrite atom picking as a frame-coalesced, allocation-free grid walk, so cursor hover glows and finger scrubbing work even on a million atoms.

<a id="c010"></a>
### C010 · Bonds in a Blink
**Strong** · mean 3.2 (E4 P2 A3 Pr3 M4) · effort S · mixed · rides R4, R12

Bonds arrive with the atoms: a typed-grid worker search on the GL2 path and on-device bond compute on WebGPU.

- **Summary:** Problem: without WebGPU the CPU bond search uses string keys and bonds arrive late. Solution: reuse the typed SpatialHash3D grid in a worker with transferables; on the WebGPU backend, bond compute writes the R4 atom-pair instance buffer on the renderer's own device with no CPU readback. Visitor: bonds appear with the atoms on desktop and phone instead of seconds later.
- **Tech:** SpatialHash3D typed counting sort + worker transferables; v10 bond compute writing R4 uvec2 atom-pair instance buffers on the shared GPUDevice (WebGPU backend)
- **Judges:**
  - E 4/keep: The typed-grid worker is a v9-shippable fix for the string-key Map. On-device bond compute that writes a variable-length instance buffer needs an atomic append counter or a prefix sum, so that half is [GPU] only. *Improve:* Ship the worker path first, and on the GPU path use a fixed max-bonds-per-atom slot layout, so the GL2 transform-feedback path could run it too.
  - P 2/keep: Bonds popping in seconds late looks broken on arrival, but this is a fix, not fun. *Improve:* Tie bond arrival into the entrance animation, with bonds zipping in as the atoms condense, so the latency hides inside the juice.
  - A 3/keep: Bonds popping in seconds after the atoms is a visible arrival glitch. Lower latency helps, but some arrivals will still be late on big scenes. *Improve:* Always grow bonds out from the atom centres over about 250 ms, so any arrival time reads as choreography rather than a pop.
  - Pr 3/keep: Bonds arriving seconds after the atoms is a visible first-impression flaw, and the typed-grid worker half ships on v9. Modest scope and modest payoff. *Improve:* Ship the v9 worker slice now and measure time-to-bonds on the 12 curated molecules.
  - M 4/keep: Bonds arriving with the atoms removes the most visibly 'broken' moment on phones, and the worker path helps GL2 devices, which need it most. *Improve:* Ship the typed-grid worker on v9 now. Keep the WebGPU compute path behind state.webGPUSupported, with the worker as the GL2 default.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-11` **Bonds in a Blink** — Replace the string-keyed CPU bond search with the typed grid Lupi already has, so bonds arrive with the atoms on devices without WebGPU.

<a id="c011"></a>
### C011 · Frames Without the Main-Thread Tax
**Parked** · mean 2.6 (E3 P2 A3 Pr2 M3) · effort L · [GPU+GL2] · rides R3, R7

Unwrap periodic images on the GPU, prepare frames in a worker and double-buffer uploads, so million-atom trajectories play and scrub at display rate.

- **Summary:** Problem: million-atom trajectories unwrap periodic images and upload on the main thread, so playback and scrubbing stutter. Solution: unwrap in the TSL positionNode, decode frames in the worker, and double-buffer uploads with partial range writes into useBuffers storage. Visitor: big MD runs play and scrub at display rate on desktop; phones stay responsive while playing.
- **Tech:** worker transferables; TSL round() unwrap in positionNode; useBuffers partial writes (addUpdateRange equivalent); scheduler physics/update phases
- **Judges:**
  - E 3/keep: Worker decode and double-buffered partial uploads are solid for big MD runs. Unwrapping periodic images per vertex in the positionNode needs a per-atom reference image and must stay consistent with bonds, or bonds will stretch across the cell. *Improve:* Unwrap in the worker, where the molecule graph is known, and keep the GPU side to double-buffered updateRange writes.
  - P 2/park: Smooth scrubbing matters for the thermometer toy, but million-atom trajectories aren't where a curious stranger lands. *Improve:* Scope it to the melt and quench runs that C072 needs.
  - A 3/keep: It adds no new visual, but it removes the stutter that makes large MD trajectories look broken. Motion quality here is data quality. *Improve:* Keep raw frames as the default; offer any smoothing only as a labelled opt-in.
  - Pr 2/park: Serves the MD power user, which is an owned outcome, but not the goal of fun for new visitors. Effort is L. *Improve:* Revisit when usage data shows that trajectory scrubbing stutter matters to real users.
  - M 3/keep: Real value for million-atom MD, but that is a desktop use case. On phones the gain is only 'stays responsive', which matters less to newcomers. *Improve:* State the phone scope: worker decode on every device, GPU unwrap only above a frame-size threshold.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-13` **Frames Without the Main-Thread Tax** — Unwrap periodic images on the GPU, prepare frames in the worker, and double-buffer uploads, so million-atom trajectories play and scrub at display rate.

<a id="c012"></a>
### C012 · Play Before It Loads
**Parked** · mean 2 (E2 P2 A2 Pr2 M2) · effort XL · [GPU+GL2] · rides R3

Stream trajectories keyframes-first, so pressing Play on a huge MD run shows the whole story immediately and sharpens as in-between frames arrive.

- **Summary:** Problem: pressing Play on a huge MD run waits on sequential frames. Solution: a keyframes-first glimbin v3 layout, GPU interpolation between sparse keyframes, and refinement as in-between frames arrive via Range requests and the OPFS cache. Visitor: the whole story plays at once and sharpens; interpolated spans are labelled illustrative.
- **Tech:** HTTP Range, OPFS/LRU cache, worker decode, GPU uProgress interpolation in the TSL positionNode; new glimbin v3 writer in tools/bake-glimbin.mjs plus readers
- **Judges:**
  - E 2/park: XL effort with a new glimbin v3 format, Range/OPFS caching, and GPU interpolation that invents intermediate atom positions. It serves expert MD users, not the newcomer-fun goal, and interpolation needs heavy 'illustrative' labelling. *Improve:* Park it until trajectory load time is shown to be a top complaint, then start with Range-request prefetching of the existing format.
  - P 2/park: Valuable for experts with huge MD runs. A newcomer rarely presses Play on one, and labelling the interpolated spans dilutes the moment. *Improve:* Park it until the trajectory toys (C072, C080) show that players actually hit load waits.
  - A 2/park: Linearly interpolating sparse MD keyframes gives mushy, physically wrong motion on the very first Play, which is the moment that sets trust. A label won't undo that impression. *Improve:* Show keyframes as honest held frames with a progress shimmer while in-between frames stream in, rather than interpolating.
  - Pr 2/park: An XL new file format plus streaming. Interpolated in-between frames mixed into real MD data are an honesty hazard. *Improve:* Only pursue if large-trajectory usage appears, with interpolated spans labelled unmistakably and never exported.
  - M 2/park: Size XL. On cellular it streams large Range requests, and interpolated keyframes look like data, which puts the honesty rule at risk. *Improve:* Honour Save-Data and cap prefetch on metered connections. Draw interpolated spans visibly differently, not just with a label.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-20` **Play Before It Loads** — Stream trajectories keyframes-first, so hitting Play on a huge MD run shows the whole story immediately and sharpens as in-between frames arrive.

<a id="c013"></a>
### C013 · Visibility-Buffer Impostors
**Parked** · mean 2.2 (E3 P1 A3 Pr2 M2) · effort XL · [GPU+GL2] · rides R3, R6

Rasterise atoms as only 'which atom, how deep' into an ID buffer, then shade each pixel once, so premium looks cost about the same at 10k or 5M atoms.

- **Summary:** Problem: fancy looks shade every overlapping impostor fragment and WGSL loses early-Z, so cost scales with atom count. Solution: rasterise atom id plus depth into an integer MRT, then a fullscreen pass re-solves each sphere hit from its id and shades once; picking and outlines come free. Visitor: premium looks at any scale. It is also the fallback if the gate spike finds early-Z loss bad.
- **Tech:** TSL integer MRT (uint attachment), depthNode, instancedArray().element() read in a fullscreen Fn, RenderPipeline pass; GL2 integer MRT via PBO is unverified
- **Judges:**
  - E 3/park: This is the principled fix for early-Z loss and dense beauty. But on the GL2 backend, storage buffers can't be randomly read in a fragment shader (they become vertex attributes), and integer MRT readback is unverified, so the resolve pass needs a position DataTexture there. MSAA also doesn't compose with a visibility buffer. *Improve:* Keep it as the named contingency if the R3 gate spike shows bad early-Z loss, and specify the GL2 resolve through a float DataTexture of positions.
  - P 1/park: Invisible infrastructure that matters only if the gate spike fails. Players see nothing from it. *Improve:* Keep it as the named fallback for the gate spike, not as a roadmap item.
  - A 3/park: It would make premium shading cost the same at any atom count, which is exactly what stunning-at-scale needs. But it is XL, GL2 integer MRT is unverified, and it only matters if the gate spike finds early-Z loss. *Improve:* Keep it as the named contingency for the gate spike. For now, prototype only the ID+depth pass, which C009 and C049 need anyway.
  - Pr 2/park: A contingency architecture in case the gate spike fails. XL, and it gives visitors nothing on its own. *Improve:* Keep it as the documented plan B, triggered only if the gate spike reports bad early-Z loss.
  - M 2/park: Size XL, GL2 integer MRT is unverified, and a visibility buffer adds full-screen store and load bandwidth that tile GPUs pay heavily for. It is only worth it if the gate spike fails on desktop. *Improve:* Keep it as the gate-spike contingency, and measure its bandwidth on a phone before adopting it anywhere.
- **Round-1 ideas merged here:**
  - `R1-looks-19` **Visibility-Buffer Impostors (moonshot)** — Rasterise atoms as nothing but 'which atom, how deep' into an ID buffer, then shade each screen pixel exactly once, so the fanciest looks cost about the same at 10k or 5M atoms, and picking and outlines come for free.


## Tooling

<a id="c014"></a>
### C014 · Device Lab, ?perf HUD and a Perf Contract in CI
**Champion** · mean 4.2 (E5 P3 A3 Pr5 M5) · effort M · DOM/CPU (ships on v9 today) · rides R1, R11

A production-safe perf HUD, a seeded benchmark tour and thermal soak on real phones, and CI gates on the frame-hygiene invariants that silently rot.

- **Summary:** Problem: no real-device FPS or thermal data exists for any Lupi surface, and frame hygiene silently rots. Solution: a ?perf HUD (StatsGl or <Inspector> replacing r3f-perf), a seeded benchmark tour and 10-minute thermal soak on real phones, plus CI gates on idle renders, idle React commits, per-frame allocation, pick cost and bundle budgets, run in both the WebGPU SwiftShader and GL2-fallback lanes.
- **Tech:** three Inspector/StatsGl; WebGPU timestamp-query where granted; EXT_disjoint_timer_query_webgl2; Playwright + CDP; React Profiler; vitest bench; Vite manifest budgets; R11 dual lanes
- **Judges:**
  - E 5/champion: No real-device FPS or thermal data exists for any Lupi surface, so every perf claim in this list is unfalsifiable without this. SwiftShader lanes check correctness, not speed, and WebGPU timestamp queries are rarely granted on phones. *Improve:* Make the gate spike's benchmark tour the first deliverable, run on three named real phones (iOS 26 WebGPU, iOS <26 GL2 fallback, mid-range Android), and treat the CI gates as regressions against those baselines.
  - P 3/keep: No real-device data exists, and game feel can't be tuned without playtests on real phones. The HUD itself isn't fun. *Improve:* Add feel metrics (input-to-photon latency, settle time, hitches per flick) to the CI contract, not just FPS and allocations.
  - A 3/keep: Honest measurement is necessary, but frame-time numbers alone won't catch look regressions across two backends and several quality rungs. *Improve:* Add golden screenshots per look x backend x rung, with perceptual-diff thresholds, to the same CI lanes.
  - Pr 5/champion: Lupi has no real-device FPS or thermal data, so every phone claim in this brainstorm is a guess. A device lab plus a perf contract in CI fits Lupi's release-truth culture and protects every fun layer from regressions. *Improve:* Name 3-5 reference devices and a seeded tour of the 12 curated molecules, and report the results as a release-truth lane.
  - M 5/champion: Through a phone lens this is the prerequisite for everything else. No real-device FPS or thermal data exists, so every perf score in this round is a guess until it does. *Improve:* Put an iOS 17/18 iPhone on the WebGL2 fallback and a Low Power Mode run in the device lab. Add axe checks and reduced-motion snapshots to the same CI lane.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-17` **Device Lab and ?perf HUD** — A production-safe performance HUD plus a seeded benchmark tour and thermal soak, so every change above is judged on real phones rather than hopes.
  - `R1-perf-feel-18` **Perf Contract in CI** — Gate merges on the frame-hygiene invariants that silently rot: idle renders, idle React commits, per-frame allocation, pick cost and bundle budgets.


## Landing

<a id="c015"></a>
### C015 · Pocket Molecules on Home: SVG You Can Spin and Poke
**Champion** · mean 4.2 (E4 P5 A4 Pr4 M4) · effort M · DOM/CPU (ships on v9 today) · rides none (0-canvas rule holds; owner call on motion on /)

The home hero and wall tiles re-project their tiny .xyz into the same SVG circles each frame, so visitors can thumb-spin and poke a real molecule with zero canvases and no three.js.

- **Summary:** Problem: / is text and 48 still thumbnails, so there is nothing to touch, and canvases and three are banned there. Solution: math quaternions re-project 24-74 atoms into inline SVG circles; springs make atoms wobble away from the cursor, flicks coast, a date seed picks the hero. Desktop: hovered tiles turn toward you. Phone: horizontal swipe spins (pan-y keeps scroll). Double-tap opens the viewer at the same angle.
- **Tech:** math@0.1.0 quat.fromMat3/multiply, vec3.transformQuat, spring2/dampAngle, mulberry32 (~1-2 KB gz); plain rAF that stops when springs settle (no fiber or scheduler root on /); inline SVG; keep the 0-canvas test
- **Judges:**
  - E 4/keep: Feasible and tiny: re-projecting 24-74 atoms into SVG circles with verified math quat and spring APIs, respecting zero-canvas and no-three. Depth re-sorting by re-appending DOM nodes every frame, and motion on / (an owner call), are the only concerns. *Improve:* Reorder SVG nodes only when depth order actually changes, and stop the rAF on spring settle and when the hero is off-screen (IntersectionObserver).
  - P 5/champion: The only idea that puts something touchable on / within 5 seconds, with zero canvases. Atoms that wobble when poked and spin that coasts after a flick, on plain SVG, are pure juice. The owner still has to approve motion on the home page. *Improve:* Make the hero react to the very first cursor move or thumb swipe with no instruction, and have double-tap open the viewer in the same pose (C016).
  - A 4/keep: A spinnable real molecule on / is the right first touch and keeps the zero-canvas rule. But SVG circles with fixed radial gradients will look like clip art next to the 3D viewer, and jelly scatter undercuts the editorial tone. *Improve:* Keep each atom's specular highlight fixed to the key-light direction as the molecule turns, and use the viewer's exact palette, so the hero reads as the same specimen. Halve the wobble.
  - Pr 4/keep: The only way to put something touchable on / without breaking the zero-canvas rule, and it reuses the existing source-bound previews. It is a big acquisition lever, but it brings motion back to a home page the reset deliberately calmed, so it needs an owner call. *Improve:* Limit it to one hero plus tiles that lean on hover. Start still, move only on touch, respect reduced motion, and A/B test time-to-first-open.
  - M 4/keep: Zero canvases and ~2 KB of math: it works on every device and says 'you can touch this' before the 1 MB viewer chunk loads. The risk is horizontal swipes fighting page scroll and the iOS edge back-swipe. *Improve:* Use touch-action: pan-y with an edge dead zone. Let focused tiles rotate with arrow keys, and show a static pose under reduced motion.
- **Round-1 ideas merged here:**
  - `R1-first-30s-01` **Jelly Hero: a molecule on the home page you can poke, with zero canvases** — The home hero gets a real molecule drawn as 24–74 inline SVG circles. Atoms wobble away from your cursor, the molecule spins when flicked, and it opens in 3D at the same angle. No canvas, no three.js.
  - `R1-math-sweep-01` **Pocket Spinner Tiles** — The landing wall's static SVG molecules become thumb-spinnable 3D with no canvas: math quaternions re-project the tiny .xyz into the same SVG circles, and a date seed picks today's hero molecule.
  - `R1-r3f-sweep-17` **Tiles That Turn Toward You** — On the home page, hovering or scrolling past a molecule tile brings its little picture to life as a real 3D model that turns toward your cursor, with zero canvases and no three.js.

<a id="c016"></a>
### C016 · No Dead Splash: Intent Prefetch and the Tile That Becomes the Molecule
**Champion** · mean 4.4 (E4 P4 A5 Pr5 M4) · effort M · mixed · rides R3 (inflate), R12 (renderer factory, prewarm)

Start loading the viewer the moment a visitor reaches for a tile, grow that tile's SVG into the splash, let them spin it while the chunk loads, and open 3D in exactly that pose.

- **Summary:** Problem: the ~1 MB viewer chunk, plus v10's mandatory ~176 KB WebGPU vendor chunk, starts loading only on click, behind a dead splash. Solution: hover, touchstart or focus (tiles lean toward the cursor) triggers import() and modulepreload; the tapped SVG FLIPs to full screen, becomes a Canvas2D point spinner after the route change, and the viewer opens at that pose, inflating from flat to 3D. No black frame on desktop or phone.
- **Tech:** dynamic import + modulepreload from the Vite manifest; View Transitions with FLIP fallback; Canvas2D splash after pushState; math quat/spring; compileAsync prewarm; flatten uniform in the TSL positionNode for the inflate
- **Judges:**
  - E 4/keep: Intent prefetch of the 1 MB viewer chunk plus the ~176 KB WebGPU vendor chunk is a pure, cheap win. The FLIP-to-Canvas2D-to-3D inflate is a separate, riskier piece that depends on R3 and on first-frame shader compile time. *Improve:* Ship the pointerdown/hover/focus prefetch plus compileAsync prewarm of the impostor during the splash first, and treat the inflate as a later polish.
  - P 4/champion: The dead splash between a tile tap and the viewer is the worst moment in the funnel. Letting the player keep spinning the same molecule through the load turns the transition itself into a toy. *Improve:* Carry over spin momentum as well as pose, so a flick started on the tile keeps coasting in 3D.
  - A 5/champion: This is the strongest cohesion move in the set. A tapped tile becomes the molecule in the same pose, turning a dead splash into choreography that binds the landing to the viewer. *Improve:* Cut it to two seams (SVG FLIP, then 3D inflate) and art-direct the match frame so pose, palette, scale and light are identical. Drop the Canvas2D middle stage if pose continuity holds without it.
  - Pr 5/champion: The dead splash is the worst gap in the funnel. Intent prefetch ships on v9 with no rule risk, and opening the viewer in the pose the visitor left makes home and viewer feel like one product. *Improve:* Ship prefetch and modulepreload first (S), then the FLIP and Canvas2D spinner after the route change. Track tap-to-first-frame as the metric.
  - M 4/keep: Removing the dead splash is a big phone win. But prefetching ~1.2 MB on touchstart fires on every scroll and burns cellular data. *Improve:* Prefetch on a pointerdown held over 100 ms, or on a tap without scroll, and honour Save-Data. Crossfade instead of FLIP under reduced motion.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-14` **Never a Black Frame** — Start loading the viewer as soon as the visitor reaches for a molecule, grow the tile's SVG into the live molecule, and fade in late layers instead of popping them.
  - `R1-first-30s-02` **Leaning Tiles, Warm Viewer** — Wall tiles lean toward the cursor and squash under a thumb. That same hover or touch counts as molecule intent, so the ~1 MB viewer chunk and the tile's coordinate file start downloading before the click.
  - `R1-first-30s-03` **Tile Lifts Into 3D** — The 48 px thumbnail you tap grows to full screen as the same flat SVG. The real WebGL molecule then appears in exactly that pose and inflates from flat to 3D with a springy overshoot.
  - `R1-mobile-native-12` **Spin It While It Loads** — The moment you tap a molecule on the home page, the loading splash becomes that exact molecule as a lightweight 2D point render you can already spin with your thumb, and the 3D viewer opens in the pose you left it.

<a id="c017"></a>
### C017 · Type It, Watch It Form
**Folded into C030** · mean 2.8 (E3 P3 A4 Pr2 M2) · effort M · mixed · rides R12; disqualified on / as pitched

Type 'sugar' and a particle cloud swirls up, then collapses onto sucrose's real atom positions just before the viewer takes over.

- **Summary:** Problem: search results arrive into a dead page. Pitch: particles swirl beneath the home search box and condense onto the chosen molecule. Under the baseline a live canvas on / is disqualified, so the viable form lives in the viewer: SwitchStage's gist particles move into the main canvas as TSL compute and condense onto the picked molecule. Desktop and phone: type a thing, watch it form.
- **Tech:** vgpu 0.4.0 gistEngine.setHomes today ([GPU]); v10 TSL compute port on the main canvas's device (brief rank 7); spring.damp replaces EASE; requiredLimits maxStorageBuffersInVertexStage (iPhone unverified)
- **Judges:**
  - E 3/merge: As pitched on / it is disqualified. The viable form needs the gist-compute TSL port on the main device, which remains unverified on iPhone (maxStorageBuffersInVertexStage). *Improve:* Merge into C030 as a condensation entrance whose seeded start cloud is the gist particle cloud when available.
  - P 3/merge: 'Type sugar and watch it form' is magical, but it already lives in a panel, and the viewer version depends on unverified iPhone limits and the TSL gist port. Merge into C030. *Improve:* Fold it into C030 so every arrival condenses (O(1) offsets, both backends), with the search text as the trigger.
  - A 4/keep: Particles condensing onto real atom positions is a signature image. But a candy cloud of gist particles slides into generic particle-demo territory unless it resolves onto the atoms crisply and legibly. *Improve:* Use exactly the same stagger, spring and arc as C030's condensation, so search, arrival and scan share one 'condense' motif.
  - Pr 2/merge: Disqualified on / as pitched. The salvage, gist particles in the viewer's Switch panel, is a particle-port task that belongs with C067. *Improve:* Re-scope entirely to the in-viewer SwitchStage on the TSL port, as part of C067.
  - M 2/merge: Merge into C067. As pitched it is disqualified on /, and the viewer version depends on the gist port plus an unverified iPhone storage-buffer limit. *Improve:* Fold it into C067's TSL port of the gist particles in the main canvas, with the CSS/swirl fallback as a first-class path.
- **Round-1 ideas merged here:**
  - `R1-first-30s-17` **Type It, Watch It Form (landing exception)** — Type 'sugar' in the home search box and a particle cloud swirls up beneath it. Pick sucrose and the particles collapse onto sucrose's real atom positions just before the viewer takes over.

<a id="c018"></a>
### C018 · Living Wall, One Canvas
**Killed** · mean 1.4 (E1 P2 A2 Pr1 M1) · effort XL · [GPU] · rides R3, R12; disqualified on /

After the first sign of intent, every visible molecule tile becomes a real lit 3D render from one shared WebGPU canvas, and a tap expands that render into the viewer.

- **Summary:** Problem: the 48-tile wall is static. Pitch: one shared canvas draws each visible tile as a lit 3D molecule; hover spins it and a tap expands that very render into the viewer with no cut. Under the baseline this is disqualified on / (live canvases) and multi-canvas is absent on the GL2 backend. The salvageable slice is live spinning thumbnails in the in-viewer switcher.
- **Tech:** v10 multi-canvas on one renderer (WebGPU only; #3965 misdraws on GL2); drei <View> or static previews as fallback; math springs for rect expansion; optional @pmndrs/upscaler
- **Judges:**
  - E 1/kill: This needs live canvases on / (disqualified) and multi-canvas, which is absent on the WebGL2 backend (#3965), so it fails two hard rules at XL effort. *Improve:* If any of it survives, make it static pre-rendered spinning sprites in the in-viewer switcher, not a live wall.
  - P 2/park: Live tiles are lovely, but they're disqualified on / and WebGPU-only. The slice worth salvaging (spinning switcher thumbnails) is minor fun. *Improve:* Salvage only the live thumbnails in the in-viewer switcher.
  - A 2/park: Visually it is the dream, but it is disqualified on / and runs on WebGPU only. The part worth saving, live switcher thumbnails, is modest. *Improve:* Re-pitch it as live-lit thumbnails in the in-viewer switcher, with static previews on GL2.
  - Pr 1/kill: Live canvases on / are disqualified, multi-canvas doesn't exist on the GL2 backend, and the scope is XL. The only salvage, live switcher thumbnails, is WebGPU-only. *Improve:* Drop it. Use static previews in the in-viewer switcher.
  - M 1/kill: Disqualified on /. Multi-canvas is GPU-only and misdraws on GL2, and 48 live tiles would be the worst thermal load on the list. *Improve:* The only salvageable part, static thumbnails that FLIP into the viewer, is already in C016.
- **Round-1 ideas merged here:**
  - `R1-first-30s-19` **Living Wall, One Canvas (moonshot)** — After the first sign of intent, the molecule wall comes alive: each visible tile is a real lit 3D molecule drawn by one shared WebGPU canvas. Hovering spins a tile, and tapping expands that very render into the viewer with no splash and no cut.

<a id="c019"></a>
### C019 · Ghost Hand Demo
**Strong** · mean 3.8 (E4 P4 A3 Pr4 M4) · effort S · DOM/CPU (ships on v9 today) · rides none (the poke half rides R3)

Instead of a text pill, a translucent hand flicks the real molecule and pokes an atom so it ripples, then vanishes the instant you touch.

- **Summary:** Problem: first-time visitors get a text pill ('Drag to rotate, Pinch to zoom, Tap an atom'). Solution: a translucent hand overlay performs a flick and a poke on the real molecule by driving the same flick and ripple controllers, and vanishes on first touch. Desktop: a cursor ghost. Phone: a thumb ghost. Reduced motion keeps the text pill.
- **Tech:** DOM/SVG overlay; math/time easing + springs (0.1.0 lacks back/elastic easing); drives the flick (camera) and poke (mood-bus ripple) controllers; one invalidate() per scripted step
- **Judges:**
  - E 4/keep: A cheap DOM overlay that drives real controllers, so it teaches the actual gestures. It depends on the flick (C021) and poke (C028) controllers existing, and math 0.1.0 has no back or elastic easing. *Improve:* Script it against the controllers' public API, with one invalidate() per step, so it also serves as an end-to-end smoke test in CI.
  - P 4/keep: Show-don't-tell onboarding that teaches flick and poke without reading, S effort and on v9. Its value depends entirely on there being a juicy poke to demonstrate. *Improve:* Script it to show the single best verb (poke to pluck or ripple) in under 2 s, ending with the molecule still wobbling so the player's first touch continues it.
  - A 3/rework: Showing instead of telling is right, but a translucent hand illustration is a mobile-game cliche that clashes with the editorial styling. *Improve:* Replace the hand with an abstract touch mark (a soft ring with a short motion trail) in the brand colour, driven by the motion tokens.
  - Pr 4/keep: Showing instead of telling, by driving the real controllers, is a strong activation lever, and the flick demo ships on v9. The poke demo has to wait for R3. *Improve:* Ship a flick-only ghost on v9 now and A/B it against the text pill on time-to-first-rotate.
  - M 4/keep: For first-time phone users, showing the gesture beats a text pill, and it is size S and DOM-only. An automated camera flick on arrival is still unrequested motion. *Improve:* Animate the hand, not a big camera spin, and show it once per device. Pair it with a keyboard hint on desktop and a text version for screen readers.
- **Round-1 ideas merged here:**
  - `R1-first-30s-14` **Ghost Hand Demo** — Instead of the text pill 'Drag to rotate · Pinch to zoom · Tap an atom', a translucent hand flicks the real molecule, pokes an atom so it ripples, and vanishes the instant you touch. Show, don't tell.

<a id="c020"></a>
### C020 · Breathe, Dream, Then Sleep
**Rework** · mean 3.6 (E4 P4 A4 Pr3 M3) · effort M · [GPU+GL2] · rides R7 (R3 if the sway moves atoms)

An idle molecule sways gently or plays a short cinematic 'dream' tour, then drops to zero frames until you touch it.

- **Summary:** Problem: a still screen reads as frozen, but continuous rendering cooks phones. Solution: after a few idle seconds a seeded simplex sway (and optionally a short camera dream tour) runs as a budgeted scheduler job; after ~40 s onIdle hands off to demand and the viewer draws nothing. Desktop: a kiosk-worthy screensaver. Phone: a brief sway, then true sleep; any touch wakes it in the same frame.
- **Tech:** scheduler onIdle + per-job fps + frameloop='demand'; math simplex4d, mulberry32, spring.damp; @pmndrs/timeline vanilla for the tour; sway as a mood-bus uniform in positionNode or camera-only
- **Judges:**
  - E 4/keep: The onIdle hand-off to demand is exactly the calmer pattern, and a budgeted sway beats an always-on loop. Moving atoms for the sway, rather than the camera, adds offset-labelling burden for little gain. *Improve:* Keep the sway and dream tour camera-only, on a per-job fps cap (for example 30), and let the atom-level breathe arrive only via the C027 deformer registry.
  - P 4/keep: An idle sway makes the molecule feel alive and invites a touch, which fixes demand mode's frozen screen. The dream tour risks feeling like a screensaver nobody asked for. *Improve:* Drop the camera dream tour. Keep a 2-3 s breathing sway that fades to sleep, and wake with a small startle when touched.
  - A 4/keep: An idle molecule that breathes and then sleeps reads as alive and calm, and a slow dream orbit makes a lovely kiosk moment. Swaying atoms at idle, though, adds motion that isn't data. *Improve:* Keep idle motion camera-only (slow simplex orbital drift plus subtle light breathing), and never displace atoms when nobody asked for it.
  - Pr 3/keep: Battery-safe attract mode, but an atom sway in a learning tool invites 'is this a trajectory?' confusion and needs labelling. A camera-only dream tour avoids that. *Improve:* Keep idle motion camera-only, with no atom sway, so no honesty label is needed. Hand off to sleep via onIdle.
  - M 3/rework: The sleep half is excellent, and it is really C002. The unrequested sway and the 'dream' camera tour are vestibular triggers that need a WCAG 2.2.2 pause control, and idle camera motion drains phone batteries. *Improve:* Drop the camera tour on phones and under reduced motion. Limit the sway to one gentle cycle, then sleep.
- **Round-1 ideas merged here:**
  - `R1-first-30s-15` **Breathe, Then Sleep** — After a few idle seconds the molecule starts a slow, seamless sway with the occasional ripple, so a still screen never looks frozen. After about 40 s the viewer drops to on-demand rendering and costs nothing.
  - `R1-r3f-sweep-03` **Molecule Screensaver** — Leave the viewer alone and it plays a short cinematic 'dream' tour, then truly sleeps (zero frames) until you touch it.


## Camera feel

<a id="c021"></a>
### C021 · Fidget Flick: Spin, Coast, Catch, Click into Detents
**Champion** · mean 4.8 (E5 P5 A4 Pr5 M5) · effort S · DOM/CPU (ships on v9 today) · rides none (R7 for demand frames)

Flick the molecule and it spins like a globe with a live rev/s readout, coasts on an analytic spring, clicks into hero angles, and a tap catches it dead.

- **Summary:** Problem: release velocity is discarded and presets teleport. Solution: coalesced pointer events estimate release velocity; spherical-coordinate springs coast and settle into detents at hero angles; a tap catches it; a two-finger twist rolls and springs upright. Same settle time at 30, 60 and 120 Hz. Desktop: mouse flick. Phone: thumb flick with a rev/s dare. Camera-only, so atoms and export are untouched.
- **Tech:** math@0.1.0 spherical.setFromVec3/toVec3, deltaAngle/wrapAngle, spring.update/dampAngle/fromResponse; getCoalescedEvents (feature-detected); scheduler update job invalidating until settled
- **Judges:**
  - E 5/champion: This is camera-only, ships on v9, and uses verified math APIs (spherical setFromVec3/toVec3, deltaAngle, spring dampAngle). It makes the very first interaction feel good, but it requires replacing OrbitControls, not layering on top of it. *Improve:* Make it the single spherical-spring controller that also absorbs C022's dolly-to-cursor and 1:1 finger tracking, with getCoalescedEvents feature-detected.
  - P 5/champion: It turns the one gesture every stranger makes (drag) into a fidget spinner with coast, catch and detent clicks, plus a rev/s dare. It needs no discovery, is camera-only, and ships on v9. *Improve:* Add a detent tick sound and haptic from C041, plus a personal 'spin record' worth beating and sharing.
  - A 4/keep: A coasting spin that clicks into art-directed hero angles is excellent physical motion and ships on v9. The rev/s readout is a cheap gamification layer on top. *Improve:* Absorb C022's 1:1 tracking, dolly-to-cursor and swing-around presets into one camera-feel package on the math/time kernel, and drop the rev/s dare.
  - Pr 5/champion: Makes the first gesture every visitor tries delightful. It is camera-only, so it has no honesty cost; it is small and ships on v9; and the rev/s dare is a tiny share hook. *Improve:* Fold in C022's dolly-to-cursor and swinging presets, and ship it with C003 as one 'camera feel' release.
  - M 5/champion: Camera-only, size S, ships on v9, and feels identical at 30, 60 and 120 Hz. Flicking is the most natural phone verb, and detents make orientation predictable, which also helps motion-sensitive users. *Improve:* Add keyboard equivalents: arrows flick between detents and Home resets. Add a reduced-motion mode that jumps from detent to detent with a crossfade.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-02` **Fidget Orbit with Detents** — Flick the molecule and it spins like a globe, then clicks into hero angles on an analytic spring that behaves the same on 30 Hz Low-Power iPhones and 120 Hz ProMotion.
  - `R1-first-30s-04` **Globe Flick** — Flick the molecule and it keeps spinning like a globe, coasts to a natural stop or clicks into a hero pose, and shows a tiny rev/s readout that dares you to beat it.
  - `R1-mobile-native-05` **Fidget Spin: fling, catch, twist** — Flick the molecule and it keeps spinning like a fidget spinner, with a live 'rev/s' readout; tap to catch it dead. Twist two fingers to roll the view, and it springs back upright with a wobble when you let go.

<a id="c022"></a>
### C022 · Glued to Your Finger
**Folded into C021** · mean 3.6 (E3 P4 A4 Pr3 M4) · effort M · DOM/CPU (ships on v9 today) · rides R7

Rotation tracks the fingertip 1:1, a flick throws the camera with measured momentum, zoom dives toward the pointer, and presets swing around the molecule instead of teleporting.

- **Summary:** Problem: OrbitControls lags the fingertip, dollies to the centre, and presets jump. Solution: camera-controls-style smoothing with 1:1 tracking, measured flick momentum, dolly-to-cursor, and presets that swing around the molecule on springs; rest and sleep events drive demand frames. Desktop: zoom where the mouse points. Phone: drag feels glued and pinch dives toward the fingers.
- **Tech:** drei 11 CameraControls / camera-controls 3.x (runtime-verify under v10); GizmoHelper replaced per R7; math dampAngle; hand-written velocity estimator; rest/sleep -> invalidate/onIdle
- **Judges:**
  - E 3/merge: This overlaps C021. camera-controls 3.x is renderer-agnostic, but its own smoothing fights custom inertia and detents, and drei 11's wrapper is only runtime-unverified. *Improve:* Merge into C021, taking dolly-to-cursor, 1:1 tracking and rest/sleep → invalidate as requirements for that controller.
  - P 4/merge: 1:1 finger tracking and dolly-to-cursor are big feel wins on trackpads and phones. But this is the same camera-feel package as C021, and it could fight C021's flick springs; merge into C021. *Improve:* Fold it into C021 as one camera controller, so tracking, momentum and detents share one spring model.
  - A 4/merge: Glued 1:1 tracking and presets that swing around the molecule are premium feel. But a second smoothing library (camera-controls) would fight C003's kernel and give two motion signatures. *Improve:* Merge into C021 and build the swing and dolly behaviours on math/time springs rather than camera-controls.
  - Pr 3/merge: Good additions (1:1 tracking, dolly-to-cursor, presets that swing), but they overlap C021 and depend on drei 11 CameraControls, which is unverified under v10. *Improve:* Build these on the C003 kernel inside C021 instead of camera-controls.
  - M 4/merge: Merge into C021. Dolly-to-pointer and 1:1 tracking are right, but it overlaps C021 almost completely and relies on drei 11 CameraControls, which is unverified under v10. *Improve:* Take only dolly-to-pointer and the swing-around presets into C021's camera-feel package, built on math/time.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-04` **Glued to Your Finger** — Rotation tracks the fingertip 1:1, a flick throws the molecule with measured momentum, zoom dives toward the pointer, and presets swing around the molecule instead of teleporting.

<a id="c023"></a>
### C023 · One-Thumb Mode with Rubber-Band Zoom
**Folded into C021** · mean 3.8 (E4 P4 A3 Pr4 M4) · effort S · DOM/CPU (ships on v9 today) · rides none (squash rides R3)

Double-tap an atom to glide to it, double-tap-and-slide to zoom, and zoom limits that stretch and bounce back with a scale card instead of hitting a wall.

- **Summary:** Problem: zoom limits feel like walls and phones need two hands. Solution: double-tap an atom to glide to it, double-tap-and-slide to zoom, and limits that stretch with resistance, squash the molecule slightly against the glass, and spring back with a card ('this is 1.4 nm wide'). Desktop: scroll overscroll. Phone: one thumb on a subway, with an Android tick at the limit.
- **Tech:** math@0.1.0 spring3.damp, spring.update/fromResponse, box3 extents; hand-written overscroll map; squash as a mood-bus scale uniform in positionNode; navigator.vibrate on Android
- **Judges:**
  - E 4/keep: Cheap, camera-side and v9-shippable. Rubber-band limits are a big feel win on phones. Double-tap-to-glide collides with C030's double-tap burst and C021's tap-to-catch. *Improve:* Resolve the gesture grammar first. For example, double-tap on an atom glides, double-tap on empty space bursts, and double-tap-and-slide zooms.
  - P 4/merge: Rubber-band zoom with a '1.4 nm wide' card turns a wall into a juicy bounce with a fact. Its double-tap-to-glide collides with C030's double-tap burst; merge into C021. *Improve:* Put it in C021's camera bundle and settle the double-tap: on an atom it glides, on empty space it bursts.
  - A 3/keep: Rubber-band limits with a scale card are good native motion. Squashing the molecule against the glass distorts the structure for a joke. *Improve:* Keep the camera overscroll and the '1.4 nm wide' card, and drop the molecule squash.
  - Pr 4/keep: Real one-thumb phone ergonomics, and the scale card ('1.4 nm wide') turns a hard stop into a learning moment. Small and ships on v9, but double-tap is also claimed by C030's burst. *Improve:* Settle who owns double-tap in a written gesture map. Ship without the squash, which needs R3, first.
  - M 4/keep: Real one-thumb operation is a big phone win, and double-tap-and-slide zoom follows the Maps convention. Double-tap is also claimed by C030's burst and C039's shatter. *Improve:* Give double-tap to glide and zoom, per platform convention. Announce the scale card through aria-live.
- **Round-1 ideas merged here:**
  - `R1-mobile-native-06` **One-Thumb Mode: double-tap focus, tap-drag zoom, rubber-band edges** — Everything reachable with one thumb on a subway: double-tap an atom to glide to it, double-tap-and-slide to zoom, and zoom limits that stretch like iOS scroll overscroll and snap back with a 'this is 1.4 nm wide' card.
  - `R1-first-30s-10` **Rubber-Band Zoom** — Zoom limits stop feeling like walls. Pinch or scroll past them and the view stretches with resistance, the molecule squashes against the glass, and it all bounces back when you let go.

<a id="c024"></a>
### C024 · Thumb Loupe and Lens Cursor
**Rework** · mean 3.4 (E3 P3 A3 Pr4 M4) · effort M · [GPU+GL2] · rides R3, R6 (ID MRT), R7

Press and hold to get a magnifier bubble above your thumb that snaps to the nearest atom; on desktop, atoms swell under the cursor like a lens is passing over them.

- **Summary:** Problem: fingers cover the atom they aim at, and hover says nothing about what is under the cursor. Solution: press-and-hold opens an iOS-style bubble above the thumb with a 3x crop and a crosshair snapping to the nearest atom; slide to scrub, release to select. Desktop: atoms under the cursor swell as if under a lens and the nearest shows its symbol. Snapping uses GPU ID picking.
- **Tech:** useRenderTarget + setViewOffset crop render only while held; GPU ID pick (1-px async read); lens swell as a radius uniform in the R3 impostor; math spring3.damp; navigator.vibrate snaps
- **Judges:**
  - E 3/rework: A setViewOffset crop render into a render target repeats the full vertex and instance work for every atom while the finger is held (costly at 1M+ atoms on phones). Snapping via the GPU pick is sound. *Improve:* Magnify the already-rendered frame, by sampling the main colour target at 3x around the finger, and keep the lens-swell radius uniform for desktop.
  - P 3/merge: The desktop lens swell is juice; the loupe is a precision utility. Long-press is already contested (toy wheel, tug, lift). Merge into C009. *Improve:* Fold the lens swell into C009's hover, and keep the loupe only for dense lattices.
  - A 3/keep: The loupe is genuinely useful and can look elegant. On desktop, though, the lens swell changes apparent atom radii under the cursor, and radii are data. *Improve:* Design the loupe as a glass bubble with the brand rim around a live 3x crop, and replace the radius swell with a light rim.
  - Pr 4/keep: Fixes a real phone inspection problem, fingers hiding the atom they aim at, and serves the owned 'inspect' outcome. It rides R3 and R6, and long-press is contested. *Improve:* Make the loupe the phone's main precise-select path, give it long-press, and move heat and tug to other gestures.
  - M 4/keep: The loupe solves fat-finger occlusion, which is the most real phone picking problem. The desktop lens swell is a nicety, and the crop render runs only while the finger is held. *Improve:* Make hold-slide-release the default way to select by touch, and announce the atom under the crosshair to screen readers. Share long-press with tug by using a movement threshold.
- **Round-1 ideas merged here:**
  - `R1-mobile-native-04` **Thumb Loupe** — Press and hold anywhere on the molecule and an iOS-style magnifier bubble pops up above your thumb, showing a 3x zoomed crop that snaps a crosshair to the nearest atom; slide to scrub, release to select.
  - `R1-first-30s-09` **Lens Cursor and Thumb Loupe** — Atoms under the cursor swell as if a magnifying glass is passing over them, and the nearest one glows with its symbol. On phones, press-and-hold opens a loupe that floats above your thumb so you can finally hit the atom you meant.

<a id="c025"></a>
### C025 · It Notices You: Cursor Lean and Tilt Window
**Strong** · mean 3.6 (E4 P4 A4 Pr3 M3) · effort S · DOM/CPU (ships on v9 today) · rides none (R5 for dome parallax)

The molecule turns a few degrees toward your cursor like a curious creature; on a phone, one 'Tilt' tap makes the screen a window into a glass box.

- **Summary:** Problem: the arrived molecule is dead still. Solution: on desktop it turns a few degrees toward the cursor; on phones one 'Tilt' tap (iOS permission from the gesture) makes the device a window into a glass box, with parallax against the dome and filter shell. Camera or group only, spring-smoothed, so atoms and export are untouched.
- **Tech:** DeviceOrientation with iOS requestPermission from a gesture; math spring2.damp, spherical; camera/group offset only; dome parallax via <Canvas background> or the R5 dome
- **Judges:**
  - E 4/keep: Trivially cheap: a camera or group offset on a spring, with the iOS permission requested from a gesture. It makes the molecule feel alive without touching source atoms or export. *Improve:* Cap it to a few degrees, and render only on pointer or orientation change under demand, never as an always-on loop.
  - P 4/keep: A molecule that leans toward the cursor gets character in the first second with no instruction. The phone Tilt window hides behind a separate permission tap. *Improve:* Keep the lean subtle and have it yield instantly to a drag. Ask for the tilt permission on the first shake or tilt toy instead of from a separate chip.
  - A 4/keep: A few spring-smoothed degrees of lean toward the cursor, plus gyro parallax against the dome, is the Apple TV icon trick: cheap, premium, and camera-only. *Improve:* Cap the lean at about +/-3 degrees with a response near 0.4 s, and couple dome and filter-shell parallax so depth reads. Pause it during measurement and reading.
  - Pr 3/keep: Charming and camera-only, but leaning toward the cursor moves the molecule while people reach for panels or take measurements. Tilt also needs a permission tap. *Improve:* Lean only while idle and before the first interaction; switch it off during selection and measurement.
  - M 3/keep: The desktop cursor lean is harmless. Gyro parallax is a classic vestibular trigger (iOS turns it off under Reduce Motion) and needs an iOS permission prompt. *Improve:* Keep tilt opt-in, off under reduced motion, limited to a few degrees, and shown by a visible 'sensor on' indicator.
- **Round-1 ideas merged here:**
  - `R1-mobile-native-07` **Tilt Window** — Tap 'Tilt' and your phone becomes a window into a glass box: tilting it shifts the view a few degrees with real parallax against the background dome and the filter-shell glass.
  - `R1-first-30s-12` **It Notices You** — The molecule turns a few degrees toward your cursor like a curious creature. On a phone, after one 'Tilt' tap, it shifts with the device's tilt as if you were looking at it through a window.

<a id="c026"></a>
### C026 · The Molecule Rides the Sheet
**Strong** · mean 4 (E4 P3 A4 Pr4 M5) · effort M · DOM/CPU (ships on v9 today) · rides none (verify with R6)

Bottom sheets glide over a full-bleed canvas while a lens shift keeps the molecule centred in whatever sliver of screen is left, with no resize and no jump.

- **Summary:** Problem: opening the Style sheet resizes the canvas, so the molecule hitches and jumps. Solution: keep a full-bleed canvas; sheets glide over it while a spring-driven setViewOffset shift recentres the molecule in the remaining area. Phone: no resize, no hitch. Desktop side panels use the same shift. Verify that GPU picking and pipeline passes honour the view offset.
- **Tech:** PerspectiveCamera.setViewOffset/clearViewOffset (three r186); math spring.update; getCoalescedEvents; verify ID-pick and useRenderPipeline under view offset
- **Judges:**
  - E 4/keep: Avoiding canvas resizes also avoids reallocating the pipeline's render targets, which is calmer. setViewOffset updates the projection matrix that SSAO/DOF depth reconstruction uses, but the GPU pick coordinates must be remapped. *Improve:* Add a unit test that the pick readback coordinates and the pipeline passes stay correct under a non-zero view offset.
  - P 3/keep: It removes a visible jump when sheets open, which protects feel on phones, but it's polish, not play. *Improve:* Scope it to the panels players actually open mid-play (Style, Remix).
  - A 4/keep: Quiet craft that removes the most visible jump on phones, the canvas-resize hitch when a sheet opens. It makes the app feel native. *Improve:* Drive the view-offset spring from the sheet's own drag progress, so molecule and sheet move as one gesture.
  - Pr 4/keep: Fixes a real phone hitch (the Style sheet resizes the canvas) with v9 tech. Invisible but high-quality polish on the most-used phone flow. *Improve:* Check that ID picking and the pipeline respect setViewOffset, then ship on v9.
  - M 5/champion: Fixes a real shipping phone bug: opening the Style sheet resizes the canvas. A spring-driven view offset avoids the WebGPU reconfigure and stale-DPR paths entirely, and it ships on v9. *Improve:* Apply the same lens shift to visualViewport changes (on-screen keyboard, URL bar), and verify ID picking and pipeline passes under setViewOffset.
- **Round-1 ideas merged here:**
  - `R1-mobile-native-03` **The Molecule Rides the Sheet** — Bottom sheets glide over a full-bleed canvas while a lens shift keeps the molecule centered in whatever sliver of screen is left, with no canvas resize, no hitch and no jump.


## Touch physics

<a id="c027"></a>
### C027 · Deform Stack with an Honesty Contract
**Champion** · mean 4.2 (E5 P3 A4 Pr5 M4) · effort L · [GPU+GL2] · rides R3, R4, R8, R9

One display-offset layer that every deformer writes and that atoms, bonds, labels, trails and the picker all sample, provably zeroed for export.

- **Summary:** Problem: every toy displaces atoms, and without one contract the picker, labels, trails and bonds drift and offsets can leak into export. Solution: base positions uploaded once; deformers (ripples, curl field, knife, twist, IK) write only an offset buffer that every consumer samples, zeroed and excluded from V2 export, with one 'illustrative motion' chip. Visitors never see it; every jelly, tug and burst relies on it.
- **Tech:** R3 positionNode = base + offset (useBuffers); R4 uvec2 bond pairs; deformer registry on the CPU (math core/time/noise); labels via R8 shim; ExportManager excludes offsets
- **Judges:**
  - E 5/champion: This is the contract that makes every deformer toy safe with the picker, bonds, labels and export, and it rides R3/R4. A dense vec3 float offset buffer costs 12 B per atom (60 MB at 5M), and labels still need CPU-side positions. *Improve:* Define deformers as pure closed-form f(base, t, uniforms) with CPU twins, using a sparse stored buffer only for IK or tug. Labels and the picker then evaluate the same function, and velocity comes free from evaluating at t−dt.
  - P 3/merge: The honesty contract is what lets every toy be fearless ('your atoms haven't moved'), but it's plumbing: the same buffer as C001's offset hook. Merge into C001. *Improve:* Fold it into C001, and turn the 'illustrative motion' chip into a one-tap 'put it back' reset.
  - A 4/keep: Without it, poked atoms detach from their bonds and labels and the scene looks broken. One shared offset layer is what makes every toy look right. *Improve:* Design the 'illustrative motion' indicator once, as a small consistent chip with its own enter and exit motion token.
  - Pr 5/champion: This makes the honesty contract structural. Touch toys are safe only if the picker, labels, bonds and trails all sample one offset buffer that export provably zeroes. It is the platform that unlocks C028-C036. *Improve:* Make the 'illustrative motion' chip the Play control too (it lists active deformers and resets them in one tap). Add a CI test that export bytes are identical with deformers active.
  - M 4/keep: Invisible but vital. One offset buffer makes export safety structural and gives a single switch that zeroes all play motion, the cleanest way to implement reduced motion and a 'calm' mode. *Improve:* Put one global 'play motion' toggle and the reduced-motion hook in the contract, not in each toy, and test that picking reads offset positions.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-19` **Deform Stack with an Honesty Contract** — One display-deformation layer that math owns on the CPU. Every deformer (curl field, poke ripples, knife split, dual-quaternion twist, IK puppet, entrance) is sampled identically by atoms, bonds, labels, trails and the picker, and provably zeroed for export.

<a id="c028"></a>
### C028 · Jelly Molecule: Poke Ripples, Shake Wobble, Tilt Sag
**Champion** · mean 4.8 (E5 P5 A4 Pr5 M5) · effort M · [GPU+GL2] · rides R3, R4

Tap and ripples ring through the molecule like a pebble in jelly; shake the phone and it wobbles; tilt and it sags; pluck and the neighbourhood twangs back, even at a million atoms.

- **Summary:** Problem: the molecule never reacts to touch. Solution: a few CPU springs (up to 8 ripple sources, a shake impulse, gravity sag, optional low-res curl breathing field) become mood-bus uniforms or a small 3D texture that the TSL atom and bond positionNodes evaluate in closed form, so CPU cost is O(1). Desktop: click ripples. Phone: tap, shake, tilt. Display-only, labelled, zeroed for export.
- **Tech:** math/time spring.update (analytic impulse response mirrored in TSL); curl3 16^3 into a Data3DTexture; configureTSL + useUniforms; R3 positionNode + R4 bond pairs; DeviceMotion via snow-motion.ts
- **Judges:**
  - E 5/champion: The best fun-per-cost pick: closed-form ripples, shake and sag evaluated in the positionNode are O(1) CPU, uniform-driven, and work on both backends. Bonds must evaluate the same function at both endpoints via R4's pairs. *Improve:* Absorb C029's trail texture and C034's tap shockwave into one 'touch field' deformer with a fixed uniform budget, so the whole family ships as one shader Fn.
  - P 5/champion: 'Touch it and it reacts' is the core toy promise. Ripples, shake-wobble and tilt-sag read instantly and cost O(1) on the CPU. But the member pitch hides it behind a 'Jelly' toggle. *Improve:* Make a wobble the default response to any tap or shake, with no toggle: C073's real modes where they're baked and the jelly ripple everywhere else.
  - A 4/keep: A poke ripple is the strongest first-touch verb. Stacking jelly wobble, shake and tilt sag makes the structure look soft and unscientific. *Improve:* Ship one signature poke ripple tuned crisp (small amplitude, fast decay, about 400 ms), and drop the tilt sag.
  - Pr 5/champion: Tap an atom and it ripples: the clearest first-touch 'aha', at O(1) CPU cost at any scale and on both backends. It can only ship after R3/R4 parity. *Improve:* Make the poke ripple the port's parity-exit demo and pair it with a C041 tick. Add shake and tilt later.
  - M 5/champion: A tap ripple is the most discoverable one-finger fun verb, costs O(1) CPU on both backends and is safe on phones. Shake and tilt need permission prompts and should stay extras. *Improve:* Add a keyboard and switch-access equivalent (Enter on a focused atom ripples it) and a highlight-ring still under reduced motion. Put shake and tilt behind one shared sensor-permission flow.
- **Round-1 ideas merged here:**
  - `R1-mobile-native-11` **Jelly Phone** — Shake your phone and the molecule wobbles like jelly; tilt it and it sags toward the floor; pluck an atom with your thumb and the whole neighborhood twangs back. It works at a million atoms, because the CPU only moves eight numbers.
  - `R1-first-30s-05` **Pebble Poke** — Tap any atom and a damped ripple rings outward through the molecule like a pebble dropped in jelly. Tap fast and up to eight ripples interfere. It works at any atom count for the CPU cost of eight uniforms.
  - `R1-math-sweep-08` **Living Field: Breathe, Poke, Shake** — The CPU computes a 3D displacement field (curl-noise breathing, spring-coupled poke ripples, shake impulses) and uploads it as a 32 KB 3D texture. Atom and bond impostors both sample it, so even 1M-atom scenes wobble like jelly for well under 1 ms of CPU a frame.

<a id="c029"></a>
### C029 · Wake Behind Your Finger (Splash Pond)
**Folded into C028** · mean 3.2 (E4 P3 A3 Pr3 M3) · effort M · [GPU+GL2] · rides R3, R4, R6

Drag a finger across a million-atom crystal and it parts like water behind a boat, taps drop pebbles, and the whole field settles, with zero per-atom CPU work.

- **Summary:** Problem: dragging only rotates, so big crystals feel inert. Solution: a trail or height texture fed by pointer positions is sampled in the atom and bond positionNode, so a drag parts a crystal like water and taps drop pebbles whose waves bob the atoms; optionally the backdrop bends with the waves. Desktop: cursor wake. Phone: finger wake. Zero per-atom CPU; display-only.
- **Tech:** trail texture (Canvas2D or TSL ping-pong useRenderTarget) sampled via texture() in the R3 positionNode; R4 bonds follow; optional backdrop distortion pass in useRenderPipeline
- **Judges:**
  - E 4/merge: A trail texture sampled in the positionNode is a sound vertex texture fetch on both backends, with zero per-atom CPU cost. It is functionally the same deformer slot as C028's ripples. *Improve:* Merge into C028 as that touch field's large-scene mode: a ping-pong height texture when the atom count exceeds the ripple-uniform budget.
  - P 3/merge: Parting a million-atom crystal like water is gorgeous, but drag already means rotate, so it needs a mode, and it only shines on big lattices a stranger rarely opens. Merge into C028. *Improve:* Make it C028's lattice-scale variant, triggered by a two-finger drag.
  - A 3/merge: A finger wake parting a million-atom crystal is striking. But it is a second deformer language for the same verb, and the water metaphor fights 'crystal'. *Improve:* Merge into C028 as the drag variant of the ripple, with the same response and amplitude envelope.
  - Pr 3/merge: Beautiful on big crystals, but a drag that deforms fights drag-to-rotate, and it duplicates C028's field. Merge into C028. *Improve:* Offer it as a Play-mode variant of C028, with rotation moved to two fingers.
  - M 3/merge: Merge into C028. One-finger drag already orbits on phones, so a finger wake collides with the primary gesture, and the ping-pong trail texture renders every frame. *Improve:* Make it a Play-mode drag verb inside C028, settling back to demand frames.
- **Round-1 ideas merged here:**
  - `R1-r3f-sweep-06` **Wake Behind Your Finger** — Drag a finger across a million-atom crystal and it parts like water behind a boat, then settles, with zero per-atom CPU work.
  - `R1-first-30s-16` **Splash Pond** — The space behind the molecule becomes a pond: your cursor leaves a wake, taps drop pebbles, the backdrop bends with the waves, and the atoms bob as each wave passes under them.

<a id="c030"></a>
### C030 · Dandelion Burst and Condensation Entrance
**Champion** · mean 4.6 (E5 P5 A5 Pr4 M4) · effort S · [GPU+GL2] · rides R3, R4

Molecules condense from a seeded gas cloud onto their real positions on load, and a double-tap bursts them like a blown dandelion that swoops back and clicks into place.

- **Summary:** Problem: molecules pop in dead still and there is no whole-molecule toy. Solution: one seeded per-atom offset with a staggered spring return: on load atoms condense from a gas cloud onto their real positions; a double-tap bursts the molecule outward, it hangs, then swoops back bottom-up with a chime. O(1) CPU at 1M atoms. Same on desktop and phone; reduced motion skips it.
- **Tech:** TSL hash of instanceIndex or quantized source position in the R3 positionNode; analytic spring constants mirrored from math/time; mulberry32/random.vec3 seeds; mood-bus progress uniform; R4 bonds follow
- **Judges:**
  - E 5/champion: A seeded hash of instanceIndex plus a spring progress uniform is O(1) at 1M atoms and uniform-only. v9 already interpolates instancePosition→instanceTargetPosition by uProgress for atoms and bonds (verified), so a no-stagger entrance can ship without new GLSL. *Improve:* Ship the v9 slice by uploading a seeded gas cloud as the 'from' frame on the existing uProgress hook, then add the per-atom stagger in the R3 positionNode.
  - P 5/champion: Double-tap to burst plus condense-on-load is the best whole-molecule toy: instantly readable, replayable with new seeds, perfect on C60, and O(1) at 1M atoms. Double-tap needs arbitration with glide and zoom. *Improve:* Add a charge-and-release trigger (hold to heat, C033, then burst), and finish each reassembly with an overshoot click and a chime.
  - A 5/champion: Condensing from a seeded gas onto the real positions is a signature arrival, and the burst is the best whole-molecule toy. It costs O(1) and is pure choreography. *Improve:* Author the stagger (e.g. by distance from the centroid) and the hang and swoop timing as named tokens, skip the chime by default, and make this the house entrance reused across search, scan and switching.
  - Pr 4/keep: The condensation entrance fixes the dead pop-in, and the burst is a delightful whole-molecule toy at O(1) CPU. But an entrance on every load delays returning users, and double-tap is contested. *Improve:* Play the entrance only on the first open per session, cancelled by any touch, and move the burst off double-tap.
  - M 4/keep: Cheap, delightful and O(1) on both backends. But a condensation entrance on every load delays the first view on slow phones, and double-tap is contested. *Improve:* Keep the entrance under 600 ms and play it on first load only. Trigger the burst from a button or a shake instead of a double-tap.
- **Round-1 ideas merged here:**
  - `R1-first-30s-06` **Dandelion Burst** — Double-tap and the molecule bursts outward like a blown dandelion, hangs, then swoops back bottom-up and clicks into place with a chime. The whole-molecule toy costs O(1) on the CPU.
  - `R1-math-sweep-05` **Condensation Entrance** — Molecules stop popping in dead still: atoms condense from a seeded gas cloud onto their real positions, staggered and eased in the impostor shader, with no per-frame CPU even at 1M atoms.

<a id="c031"></a>
### C031 · Tug, Taffy and Chain Puppet
**Strong** · mean 3.6 (E4 P4 A3 Pr4 M3) · effort L · [GPU+GL2] · rides R3, R4, R6 (ID pick)

Grab an atom (or two fingers on two atoms) and pull: bonded neighbours follow like taffy or a rope, a strain meter shows what the pose costs, and letting go twangs it home.

- **Summary:** Problem: you can't touch the structure. Solution: on grab, build a FABRIK chain or hop-distance neighbourhood; the CPU solves up to a few hundred atoms and writes a partial offset range the TSL impostor reads. Two-finger taffy uses per-pointer capture, chains get a Snek mode, and an MMFF94 strain meter makes it chemistry. Desktop: drag. Phone: long-press an atom and pull; release springs back.
- **Tech:** math/ik fabrik3 (setBallJoint, solve), spring3; hand-written ray-sphere/XPBD; v10 pointerMap + interactivePriority; useBuffers partial offset writes; R4 bond pairs; lazy openchemlib ForceFieldMMFF94
- **Judges:**
  - E 4/keep: fabrik3 (setBallJoint, solve) is verified, and partial offset writes for a few hundred atoms are cheap. The effort is in two-pointer capture, the strain meter and the lazily loaded MMFF94. It shows real chemistry, not just jelly. *Improve:* Ship single-pointer tug with hop-distance falloff first, and add taffy and the MMFF94 strain meter as a second step.
  - P 4/keep: Pulling an atom, watching its neighbours follow like taffy, then feeling it twang back is visceral and teaches bonding. But it fights drag-to-rotate and needs long-press on phones. *Improve:* Ship single-atom pluck-and-twang first, add chains later, and use C009's grab highlight so players see what they're holding.
  - A 3/keep: Taffy pulling is great fun, but stretched bonds and dragged neighbourhoods easily read as a rendering bug. The strain meter rescues it scientifically. *Improve:* Make strain visible as intent: bonds thin and brighten as they stretch, so the deformation reads as tension, not a glitch.
  - Pr 4/keep: Pulling atoms is what visitors instinctively try, and the strain meter turns it into chemistry. Scope is L, and MMFF94 adds weight. *Improve:* Ship v1 as a hop-distance tug with spring-back only. Add the strain meter later, labelled 'illustrative pose'.
  - M 3/keep: The strain meter turns play into chemistry. But long-press and two-finger taffy collide with the loupe and pinch zoom, and openchemlib is a heavy lazy load on cellular. *Improve:* Ship one-finger tug inside a Play mode first, with a keyboard nudge (Shift+arrows) on a focused atom, and load MMFF94 only on demand.
- **Round-1 ideas merged here:**
  - `R1-playful-science-06` **Tug-a-Chain with a Strain Meter** — Long-press any atom of a chain molecule and pull. The backbone follows like a rope with bond lengths kept, while a real MMFF94 strain meter shows what your pose costs. Let go and it springs home.
  - `R1-first-30s-07` **Taffy Tug** — Grab an atom and pull. It stretches out like taffy, its bonded neighbours follow by hop distance, and when you let go the group twangs back with a wobble and a 'boing'.
  - `R1-r3f-sweep-04` **Two-Finger Taffy** — Put a finger on two atoms and pull: the molecule stretches like taffy along its bonds, then snaps back. This works because impostor atoms become real R3F event targets.
  - `R1-math-sweep-18` **Chain Puppet: Snek and Tug** — Turn a chain molecule into a puppet. In Snek mode its backbone slithers after your finger with side groups riding along (FABRIK forward pass). In Tug mode you pin one end and pull the other like a rope under cone limits, then it springs home.

<a id="c032"></a>
### C032 · Pick It Up and Toss It
**Parked** · mean 2.6 (E3 P3 A2 Pr2 M3) · effort L · [GPU+GL2] · rides R3, R7

Long-press a small molecule, lift it and fling it: it tumbles, bounces off the screen edges or a glass floor with a squish, then springs home.

- **Summary:** Problem: the molecule never feels like an object. Solution: a Play mode where long-press lifts a small molecule; fling it and it tumbles, bounces off screen edges or a glass floor, squashes on impact via XPBD soft-body offsets, and springs home. Desktop: mouse fling. Phone: throw it at the bezels. Display-only; the pose resets before export.
- **Tech:** hand-written XPBD + fixed-step accumulator in the scheduler physics phase (0.2.0 has no fixed step); math frustum/plane3 edges; spring3.damp home; small-N CPU offset writes via useBuffers; xr/grabMath throw constants
- **Judges:**
  - E 3/rework: Per-atom XPBD soft-body squish is overkill. A thrown molecule is a rigid group transform plus a squash-scale uniform, and hand-written physics without a fixed timestep adds risk. *Improve:* Implement the toss as rigid body dynamics on the group matrix, with an analytic squash-and-stretch uniform on impact, and drop the per-atom XPBD.
  - P 3/park: Throwing a molecule at the bezels is a 10-second giggle, but it competes with flick-to-spin for the same gesture and needs soft-body XPBD. *Improve:* Revisit it as a toy-wheel mode once C021's flick is proven.
  - A 2/park: Squishy molecules bouncing off bezels are cartoon physics that clash with the 'matter under glass' specimen brand, and the idea is L effort. *Improve:* If kept, confine it to a clearly separate Play space with rigid tumbling and no squash.
  - Pr 2/park: Fun object physics, but it has nothing to do with chemistry, the scope is L, and the XPBD soft body is all hand-written. *Improve:* Fold the bounce off the screen edges into C021's flick as a camera-only easter egg.
  - M 3/keep: Throwing a molecule at the bezels is great phone fun. But it needs a mode toggle and hand-written XPBD, and a tumbling object is a vestibular risk. *Improve:* Offer it inside a Play mode with a 'Toss' button equivalent, and settle straight to a still under reduced motion.
- **Round-1 ideas merged here:**
  - `R1-first-30s-08` **Pocket Jelly: throw the molecule at your screen edges** — For small molecules, a Play mode turns the structure into an XPBD soft body you can fling. It tumbles, bounces off the phone's screen edges, squashes on impact and wobbles back into shape.
  - `R1-r3f-sweep-05` **Pick It Up and Toss It** — Long-press the molecule, lift it and fling it: it tumbles, bounces off the glass floor with a squish, then springs home. The XR throw physics, finally for mouse and touch.

<a id="c033"></a>
### C033 · Hold to Heat (Equipartition Jiggle)
**Rework** · mean 3.6 (E4 P4 A4 Pr3 M3) · effort M · [GPU+GL2] · rides R3, R4

Hold on empty space, drag a heat slider or shake the phone, and the molecule trembles with amplitudes that scale like real thermal motion, glowing ember-orange as it heats.

- **Summary:** Problem: static molecules hide that atoms vibrate. Solution: hold on empty space, drag a heat slider or shake: atoms jitter with amplitude scaling like thermal motion (hydrogens most), glow ember-orange, bonds flicker, and a long hold 'melts' into a burst before cooling. Real melting and boiling lines come from property-sheet.json and hand off to real MD toys. Labelled illustrative.
- **Tech:** TSL mx_noise_vec3/hash in the R3 positionNode with amplitude ~ sqrt(T/m); mood-bus uTemp (frame-owned plain uniform()); blackbody emissive; R4 bond pairs; DeviceMotion
- **Judges:**
  - E 4/keep: sqrt(T/m) amplitude jitter in the positionNode is honest-ish, uniform-driven, and works on both backends. mx_noise_vec3 per impostor vertex at 1M atoms is affordable but not free on phones. *Improve:* Use a cheap integer hash lerped between time-quantised keys instead of mx_noise_vec3, and tie the real Tm markers to property-sheet.json as the honesty anchor.
  - P 4/keep: Hold to charge, with escalating tremble and ember glow, is a classic game-feel mechanic with a real science hook (hydrogens jiggle most). Holding on empty space collides with other long-press uses. *Improve:* Make releasing past a threshold trigger C030's burst, so heating pays off.
  - A 4/keep: Blackbody ember glow plus mass-scaled jitter is both beautiful and grounded in real physics. *Improve:* Use a true blackbody ramp blended over the element colour (not an orange tint), and anchor the heat scale to C072's real melting data.
  - Pr 3/rework: Heat is a great intuition, but mixing illustrative jitter with 'amplitudes that scale like real thermal motion' and real melting lines blurs the honesty line. *Improve:* Make it the illustrative on-ramp that hands off to C072's real melt runs ('see real copper melt'), and drop the physical-amplitude claim.
  - M 3/keep: The real melting-point hooks make it science. But 'hold on empty space' is undiscoverable on phones, and flickering bonds with an ember glow risk photosensitive flashing. *Improve:* Lead with a slider (role=slider, aria-valuetext in kelvin), drop the bond flicker, and keep luminance changes well under 3 Hz.
- **Round-1 ideas merged here:**
  - `R1-playful-science-02` **Warm It Up (equipartition jiggle)** — A heat slider, or a shake of the phone, makes any static molecule tremble with amplitudes that scale like real thermal motion, so the hydrogens shiver most. Real melting and boiling lines come from Lupi's handbook sheet.
  - `R1-first-30s-11` **Hold to Heat** — Press and hold on empty space, or shake your phone, and the molecule heats up. Atoms jitter harder and glow ember-orange, bonds flicker, and a long enough hold 'melts' it into a burst before it cools back into shape.

<a id="c034"></a>
### C034 · Tap Shockwave and Dive
**Folded into C042** · mean 2.8 (E3 P3 A2 Pr3 M3) · effort M · [GPU+GL2] · rides R3, R6

Tap an atom and a glassy shockwave ripples out from the exact point you touched; on giant lattices, tap anywhere and the camera dives there.

- **Summary:** Problem: taps on dense lattices give no feedback and the CPU pick is slow. Solution: a GPU ID and depth pick returns the exact surface point; a screen-space TSL shockwave ripples out from it, and on giant lattices the camera dives there on a spring. Post-only, so atoms don't move. Replaces the blocked DepthPicking plus rpp ShockWave pitch. Desktop and phone alike.
- **Tech:** ID/depth MRT + readRenderTargetPixelsAsync (both backends); custom TSL Fn distortion pass in useRenderPipeline; math spring3 camera dive
- **Judges:**
  - E 3/merge: A screen-space distortion pass is cheap and GPU-pick-driven, but it duplicates the poke feedback of C028. The tap-to-dive is really camera behaviour. *Improve:* Merge the shockwave into C028's touch field as its post-only low-tier fallback, and move dive-on-tap into the C021 controller.
  - P 3/merge: A screen-space shockwave is cheap tap feedback, but it duplicates the jelly ripple, and small molecules don't need the dive. Merge into C028. *Improve:* Make it C028's tap feedback for lattices whose atoms are sub-pixel.
  - A 2/merge: A screen-space glass shockwave is a stock shader-demo trope, and it duplicates the poke ripple. The dive-to-point is the useful half. *Improve:* Drop the shockwave and fold tap-to-dive into C023's double-tap glide.
  - Pr 3/merge: A second tap response competing with the poke ripple. Tap-to-dive on giant lattices is a good navigation feature, and it belongs with picking (C009). *Improve:* Keep tap-to-dive for large lattices inside C009 and drop the separate shockwave.
  - M 3/merge: Merge into C028. It duplicates C028's tap feedback, and the dive on giant lattices is a large automated camera move. *Improve:* Move the shockwave into C028, and the dive into C023's double-tap glide with a cap on angular velocity.
- **Round-1 ideas merged here:**
  - `R1-r3f-sweep-01` **Tap Ripple & Dive** — Tap an atom and a glassy shockwave ripples out from the exact point you touched. On giant lattices, tap anywhere and the camera dives there.

<a id="c035"></a>
### C035 · Knife: Swipe to Split
**Strong** · mean 3.8 (E4 P4 A4 Pr4 M3) · effort M · [GPU+GL2] · rides R2, R3, R4, R6

Swipe across the screen and the molecule is sliced along that plane; bonds crossing the cut spark and fade, the halves pop apart on a spring, then heal.

- **Summary:** Problem: interiors are hard to see and slicing isn't playful. Solution: a swipe defines a plane through the view; atoms on each side get opposite offsets on an under-damped spring, bonds crossing the plane spark and fade, then the halves heal. One dot product per vertex, so 1M atoms is fine. Desktop: mouse swipe. Phone: finger swipe with a haptic tick.
- **Tech:** math plane3.fromCoplanarPoints/distanceToPoint, segment2.intersects, spring.update; clip plane on the mood bus read via select() in R3/R4 TSL; sparks via R2 flag byte + bloom
- **Judges:**
  - E 4/keep: One plane uniform and one dot product per vertex work on both backends at any scale, and plane3.fromCoplanarPoints and segment2.intersects are verified. Bond sparks don't need a CPU flag scan. *Improve:* Compute crossing-bond sparks in the bond shader from endpoint signs against the plane uniform (pure uniform), and absorb C096 as a challenge mode.
  - P 4/keep: Fruit-Ninja slicing with sparks, a pop-apart and a heal is extremely juicy and scales to 1M atoms. But a swipe already means rotate, so the knife is mode-gated. *Improve:* Trigger it with a fast two-finger swipe or a knife from the toy wheel, and absorb C096's cleave puzzle as its goal.
  - A 4/keep: Slicing reveals interiors, and the halves popping apart on a spring is satisfying. Sparks and bloom on the cut bonds lean gimmicky. *Improve:* Render the cut face as a clean technical section (flat-capped atoms in element colour), and absorb C096's cleave game.
  - Pr 4/keep: Slicing reveals interiors, which is real structural insight, and the halves heal, so it stays honest. It costs one dot product per vertex and rides R3/R4. *Improve:* Take in C096's cleave challenge as its game mode, and add an Android tick at each atomic layer.
  - M 3/keep: Cheap at 1M atoms and very readable. But a swipe collides with orbit drag, and iOS haptics won't fire on a canvas swipe. *Improve:* Make it a Knife tool chip with keyboard plane presets (X, Y, Z, stepped with the arrows), and limit the spark bloom for photosensitivity.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-09` **Knife: Swipe to Split** — Swipe across the screen and the molecule is sliced along that plane. Bonds crossing the cut spark and fade, the halves pop apart on an under-damped spring, then heal.

<a id="c036"></a>
### C036 · Twist the Ribbon
**Parked** · mean 2.2 (E3 P2 A2 Pr2 M2) · effort M · [GPU+GL2] · rides R3, R4

Grab both ends of a nanotube or graphene ribbon and wring it like a candy wrapper; dual-quaternion blending keeps it fat instead of pinching, and it springs back.

- **Summary:** Problem: nanotubes and ribbons can't be felt. Solution: two grab points drive two dual quaternions, and atoms blend between them by position along the axis (dual-quaternion skinning keeps volume instead of pinching), then spring back on release. Desktop: two drags. Phone: two fingers wring it. Display-only.
- **Tech:** math quat2.fromRotationTranslation/lerp/normalize/dot (sign flip); two dual-quat uniforms blended in the TSL positionNode (hand-ported); v10 pointerMap; spring.update
- **Judges:**
  - E 3/park: Dual-quaternion blending in the positionNode is technically sound, and quat2 fromRotationTranslation, lerp, normalize and dot exist at 0.1.0. But it only applies to nanotubes and ribbons, a narrow slice of the gallery. *Improve:* Revisit as a deformer in the C027 registry once two-pointer capture exists for C031.
  - P 2/park: Wringing a nanotube is cute, but it applies to few structures and needs a two-point grab that phones handle poorly. *Improve:* Revisit only if C031 shows that players actually grab atoms.
  - A 2/park: Pretty on nanotubes, but it is a niche verb for narrow content, and few people will discover two-finger wringing. *Improve:* Fold it into C031's grab system as a two-grab mode on ribbon-like structures.
  - Pr 2/park: Fits only two curated items, and wringing a nanotube like candy misrepresents how real nanotubes deform. The two-finger wring also fights pinch-zoom. *Improve:* Revisit only with a real computed twist trajectory as the payoff.
  - M 2/park: A two-finger wring collides with pinch and rotate, and it only suits nanotubes and ribbons. *Improve:* If it returns, use a one-finger twist handle on the axis.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-14` **Twist the Ribbon** — Grab both ends of a nanotube or graphene ribbon and wring it like a candy wrapper. Dual-quaternion blending keeps it fat instead of pinching, and it springs back when you let go.

<a id="c037"></a>
### C037 · Crystal Sand
**Parked** · mean 2.4 (E2 P3 A3 Pr2 M2) · effort XL · [GPU] · rides R3, R12

Every atom of a real crystal becomes a grain: drag through it like sand, tilt to pour, shake to melt, then let go and it heals back into its true lattice.

- **Summary:** Problem: crystals feel rigid. Pitch: each atom becomes a physical grain; drag a finger through the crystal like sand, tilt the phone to pour it, shake to melt it, and on release every grain springs back to its true lattice site. Needs GPU binning and atomics, so WebGPU only; on the GL2 backend it degrades to the jelly ripple toy. Clearly labelled toy physics.
- **Tech:** TSL compute instancedArray + CountingSort binning + atomics (r186, WebGPU only); spring-to-home in the kernel; DeviceMotion tilt; stated degrade to the jelly toy; render scale + fsr1
- **Judges:**
  - E 2/park: XL effort and [GPU]-only (atomics, CountingSort), with the degrade being another toy entirely. Fill rate at 1M grains on phones is the known limit. *Improve:* Cap it at a tens-of-thousands crystal on WebGPU desktop and revisit after the gate spike and C014 data.
  - P 3/park: Dragging through a crystal like sand is jaw-dropping, but it's XL, WebGPU-only, and only for lattices. *Improve:* Ship C028's lattice wake first, and see whether players drag lattices at all.
  - A 3/park: It could be the most breathtaking image in the set (a million grains healing back into a lattice). But it is XL, [GPU]-only, and far from the core look. *Improve:* Prototype it as a single-crystal hero showpiece after C028 ships and the gate spike reports.
  - Pr 2/park: XL, needs WebGPU for most of it, and has nothing to do with learning; on the GL2 backend it just becomes C028. *Improve:* Revisit after C028 ships and device data shows compute headroom.
  - M 2/park: XL GPU-only compute with atomics. Phones get the jelly toy anyway, and continuous compute plus tilt is a thermal load. *Improve:* Revisit only once C014 has thermal data, with a hard fps cap and auto-sleep.
- **Round-1 ideas merged here:**
  - `R1-first-30s-20` **Crystal Sand (moonshot)** — A WebGPU play mode where every atom of a real structure is a physical grain. Drag a finger through a crystal like sand, tilt the phone to pour it, shake to melt it, then let go and watch it heal back into its true lattice.


## Shape tools

<a id="c038"></a>
### C038 · X-ray Box with a Live Formula
**Strong** · mean 3.4 (E4 P2 A4 Pr4 M3) · effort M · [GPU+GL2] · rides R2, R3, R6

Drop a glass box onto any structure: atoms inside glow while the rest ghost, and the box reads out a live formula as you drag, twist and resize it.

- **Summary:** Problem: seeing and counting what is inside a region of a big structure is hard. Solution: an oriented glass box; atoms inside glow while the rest ghost, and it reads a live formula (C8H10N4O2, 24 atoms) as you drag, twist and resize it. CPU OBB tests with cell rejection stay interactive at millions of atoms; ghosting is a select() on box uniforms. Handles work with mouse and fingers.
- **Tech:** math obb3.containsPoint/intersectsBox3, box3, quat; SpatialHash cell rejection; box uniforms via select() in R3 TSL; R2 flag byte for glow; OIT glass
- **Judges:**
  - E 4/keep: obb3.containsPoint/intersectsBox3 are verified, ghosting is a select() on box uniforms, and CPU counts with cell rejection stay interactive. It is a strong science-plus-play tool with modest effort. *Improve:* Count on the CPU only on handle release (or at 10 Hz while dragging), and keep ghosting purely in-shader so the drag itself stays GPU-only.
  - P 2/park: A useful inspection tool with a nice live formula, but it's a feature with handles, not a toy. *Improve:* If kept, recast it as a goal game: enclose exactly C8H10N4O2.
  - A 4/keep: Ghosting everything outside the box, with a live formula, is a strong and legible focus+context technique that stays interactive at scale. *Improve:* Make the glow and ghost treatment one shared 'focus' style used by selection, knife, lasso and box.
  - Pr 4/keep: A live formula computed from real coordinates is honest measurement dressed as play. It scales to big structures and serves the owned 'analyze' outcome. *Improve:* Ship a v9 slice (box plus formula readout, no ghosting) and store the box in saved views.
  - M 3/keep: The live formula is great and screen-reader friendly. But dragging a 3D oriented box by its handles is notoriously fiddly on a phone. *Improve:* On phones, use a pinch-sized sphere or slab centred on the tapped atom, and announce the formula via aria-live.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-10` **X-ray Box with a Live Formula** — Drop a glass box onto any structure: atoms inside glow while the rest ghost, and the box reads out a live formula (C8H10N4O2 · 24 atoms) as you drag, twist and resize it.

<a id="c039"></a>
### C039 · Gift-Wrap Gem
**Rework** · mean 3 (E3 P3 A3 Pr3 M3) · effort M · [GPU+GL2] · rides R6

Tap 'Wrap' and a faceted glass convex hull shrink-wraps the molecule; a copper lattice shows its crisp cube habit; double-tap shatters the facets and springs them back.

- **Summary:** Problem: overall shape and crystal habit are hard to read. Solution: 'Wrap' computes a convex hull and shrink-wraps it as faceted glass; a copper lattice reveals its cube habit. Double-tap shatters the facets with seeded tumbles that spring back. Hulls for big sets run in a worker. Desktop and phone; glass uses OIT (no MSAA on the GL2 backend).
- **Tech:** math quickhull3 (worker above ~10k points), triangle3, mulberry32/random.quat, spring3, quat.slerp; MeshPhysicalNodeMaterial + oitPass
- **Judges:**
  - E 3/keep: quickhull3 allocates and must run in a worker at scale. The OIT glass pass costs extra targets, and for lattices the hull is simply a box, so the reveal is weak there. *Improve:* Offer it only for molecules and nanoparticles under ~50k atoms, and use an opaque faceted material on phones instead of OIT glass.
  - P 3/park: A glass gem is pretty for a moment and shattering facets is juicy, but it's a button-press look with a shallow loop. *Improve:* Fold the facet shatter into C030's burst as the variant for crystals.
  - A 3/keep: A faceted glass hull revealing crystal habit is a distinctive, jewel-like image. The shatter is gimmick. *Improve:* Drop the shatter, and art-direct the hull as thin-edged glass with subtle refraction so the habit reads instantly.
  - Pr 3/keep: Reading crystal habit from the hull is a real insight, but the shatter is a gimmick, and the glass has no MSAA on the GL2 backend. *Improve:* Drop the shatter, and pair the hull with face and habit labels on the curated diamond and C60.
  - M 3/keep: One-tap Wrap is phone-friendly and teaches crystal habit. But OIT glass is costly on tile GPUs, and the double-tap shatter collides with zoom. *Improve:* Default to an opaque faceted wireframe on phones, and move shatter to a button.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-12` **Gift-Wrap Gem** — Tap 'Wrap' and a faceted glass convex hull shrink-wraps the molecule; a copper lattice gets its crisp cube habit. Double-tap to shatter the facets with seeded tumbles and spring them back.

<a id="c040"></a>
### C040 · Lasso and Cookie-Cutter Nanoparticle Foundry
**Rework** · mean 3.4 (E4 P4 A3 Pr3 M3) · effort L · DOM/CPU (ships on v9 today) · rides none (R2 selection glow)

Draw a lasso to grab atoms with a rubber-band hull, or flip it into a cookie cutter to stamp a real heart-shaped nanoparticle out of a million-atom copper lattice.

- **Summary:** Problem: region selection and custom nanoparticles need expert tools. Solution: draw a lasso to grab atoms while a rubber-band hull hugs the selection, or flip it into a cookie cutter: stamp a heart into a copper lattice and keep a real heart-shaped nanoparticle you can save and export as its own structure (new source coordinates, not offsets). Desktop: mouse draw. Phone: finger draw.
- **Tech:** math polygon2.containsPoint/winding, quickhull2, triangulatePolygon2, decomposePolygon2Quick (never Quality on user strokes); lattice from LATTICE_BASIS; selection glow via R2 flag byte
- **Judges:**
  - E 4/keep: polygon2 containsPoint and winding, plus decomposePolygon2Quick, are verified. Projecting 1M atoms once per lasso is fine in a worker, and the cookie cutter produces a real new structure, so there is no honesty issue. *Improve:* Run the projection and containment test in a worker against the SpatialHash cells, and export the stamped particle through the existing saved-view path.
  - P 4/keep: Drawing a heart and stamping a real heart-shaped copper nanoparticle is a creative, brag-worthy toy that yields a real structure. It's L effort and needs a drawing mode. *Improve:* Offer 3-4 one-tap cookie stamps (heart, star, your initial) before freehand, and send the result straight to C105 stickers.
  - A 3/keep: Stamping a heart-shaped nanoparticle is delightful and produces real structures, but most of its visuals are UI strokes. *Improve:* Animate the stamp: the cutter presses down and the excess lattice falls away, using the condensation tokens in reverse.
  - Pr 3/rework: Lasso select is a genuine inspection tool. The cookie cutter makes idealised, unrelaxed structures and calls them 'real nanoparticles', which overclaims. *Improve:* Ship the lasso first. Save cuts as 'derived, unrelaxed, cut from an ideal lattice', with provenance.
  - M 3/keep: Finger drawing is natural on phones and the result is real new coordinates. But it needs a mode, and there is no keyboard path. *Improve:* Add a Lasso chip that owns one-finger drag, plus shape-preset cutters (sphere, cube, heart) that work from the keyboard.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-17` **Lasso → Cookie-Cutter Nanoparticle Foundry** — Draw a lasso to grab atoms, and a rubber-band hull hugs your selection. Or flip the lasso into a cookie cutter: stamp a heart into a million-atom copper lattice and keep a real heart-shaped nanoparticle you can save and export.


## Sound/haptics

<a id="c041"></a>
### C041 · Plink, Whoosh, Tick: One Sound and Haptics Grammar
**Strong** · mean 3.8 (E4 P4 A3 Pr4 M4) · effort S · DOM/CPU (ships on v9 today) · rides none

One shared vocabulary of sounds and haptic ticks gives every micro-interaction a voice, routed to the best channel each platform actually allows.

- **Summary:** Problem: micro-interactions are silent and haptics differ per platform. Solution: one small vocabulary (tick, detent, thud, buzz, plink, whoosh, boing, chord) shared by every toy: element-pitched plinks, a whoosh rising with flick speed, a boing on tug release. Routed to Android vibrate, iOS DOM-switch ticks (26.5 claim unverified), and expo-haptics in the app shell. Sound is opt-in, 8-voice cap.
- **Tech:** Web Audio (optional ZzFX, under 1 KB) on one shared AudioContext; navigator.vibrate; ios-haptics or @haptics switch overlay; expo-haptics via the WebView bridge; cues fired from scheduler jobs
- **Judges:**
  - E 4/keep: Cheap, DOM-only and shared across toys. iOS haptics via the switch trick are unverified, so the iPhone half may be sound-only. *Improve:* Define the cue vocabulary as an event bus that the toys emit, so haptic backends can be swapped once a device test settles iOS.
  - P 4/champion: Sound and haptics are half of juice, and one shared vocabulary keeps every toy coherent. But opt-in sound and iOS haptic limits leave most players in silence. *Improve:* Play quiet sounds by default after the first user gesture, with a visible corner mute, instead of an opt-in buried in settings.
  - A 3/keep: It isn't visual, but sound synced to motion doubles perceived quality, while cues that miss the motion make springs feel cheaper. *Improve:* Fire cues from the spring kernel's own events (settle, detent crossing, catch) so sound lands on the motion beat.
  - Pr 4/keep: One cheap shared vocabulary gives every toy tactile feedback, and it ships on v9. Reach is limited, though: the iOS haptics claim is unverified and sound is opt-in. *Improve:* Test the iOS 26.5 switch haptics on a real device, then launch the grammar with C021 and C028.
  - M 4/keep: A shared sound vocabulary is a real accessibility channel. But iOS 26.5 patched programmatic switch haptics, so detent, limit and swipe ticks fire only on Android, and iOS Web Audio obeys the silent switch. *Improve:* Design sound-first, with a visual caption for every cue. Promise iOS haptics only on direct DOM taps, and handle the ringer switch explicitly.
- **Round-1 ideas merged here:**
  - `R1-first-30s-13` **Plink, Whoosh, Tick** — One shared sound-and-haptics layer gives every micro-interaction a voice: element-pitched plinks on taps, a whoosh that rises with flick speed, a boing on tug release, a chord when a burst reassembles, and Android buzzes on grabs.
  - `R1-mobile-native-10` **Haptic Grammar** — One small haptics vocabulary (tick, detent, thud, buzz) routed to the best channel each platform actually allows: Android vibrate, the iOS 'switch' tap tick, and real Taptic Engine feedback inside the Lupi app shell.


## Looks

<a id="c042"></a>
### C042 · Pocket Worlds: GPU Studio Becomes a Main-Viewer Look
**Strong** · mean 3.6 (E4 P3 A4 Pr4 M3) · effort L · mixed · rides R3, R5, R6, R12

GPU Studio's snowglobe leaves its modal and becomes a Look in the main viewer on TSL impostors, lifting the 5k cap toward tens of thousands, with sibling worlds (marble, lava lamp, galaxy) you shake.

- **Summary:** Problem: Studio is a separate WebGPU modal with its own device, CPU matrices, a 5k cap and no fallback. Solution: port its snowglobe onto the TSL impostor as a Look in the main canvas; atoms become glass marbles, lava lamps or galaxies; phones render at 0.6-0.75x with fsr1. Desktop: shake with a drag. Phone: shake the device. Scale past tens of thousands waits for the gate spike; unported WGSL stays [GPU].
- **Tech:** TSL Fn/Loop/hash/instanceIndex in the R3 impostor; mood uniforms; port Studio's 54 WGSL lines to TSL (else [GPU]); instancedArray + indirect draws for LOD; fsr1 or @pmndrs/upscaler (WebGPU); snow-motion.ts
- **Judges:**
  - E 4/keep: Folding Studio into the main canvas removes a second device and RAF, which is calmer. The cap lift to tens of thousands is an inference, and the WGSL-to-TSL port is required for GL2 reach. *Improve:* Port the 54 WGSL lines to TSL as part of R5, so the Look is [GPU+GL2] from day one.
  - P 3/merge: Folding Studio into the main canvas is good product plumbing, but the marble, lava and galaxy worlds are looks behind a menu. Merge into C043, whose shake is the real toy. *Improve:* Make shaking the entry point and let the worlds be what the globe turns into.
  - A 4/keep: Folding Studio into the main viewer unifies the product visually and retires a second surface. A menu of marble, lava lamp and galaxy worlds risks kitsch. *Improve:* Ship Studio as one or two art-directed Looks inside C048's look space, not as a novelty-world menu.
  - Pr 4/keep: Folding the GPU Studio modal into the main viewer removes a separate surface and device, which is exactly the reset's simplification, and keeps the snowglobe fun. The sibling worlds are scope creep. *Improve:* Scope v1 to 'Studio becomes a Look' with a stated degrade, and defer marble, lava lamp and galaxy.
  - M 3/keep: Folding Studio into the main canvas removes a second GPU device on phones. But 'tens of thousands' of atoms is unproven, and the unported WGSL stays GPU-only. *Improve:* Port Studio's 54 WGSL lines to TSL so the Look runs on GL2, and render it at 0.6-0.75x via C004's ladder.
- **Round-1 ideas merged here:**
  - `R1-looks-15` **Pocket Worlds** — GPU Studio's snowglobe moves into the main viewer and gains siblings: every atom a glass marble with a ribbon inside, a tiny lava lamp or a spiral galaxy, shaken with a drag or your phone.
  - `R1-perf-feel-19` **Snowglobe for Giants** — Rebuild GPU Studio's atom path to live on the GPU with screen-size LOD and upscaling, so you can shake a whole protein or crystal instead of a 5,000-atom molecule.
  - `R1-mobile-native-20` **Pocket Studio: the WebGPU viewer phones deserve** — On iOS 26 and Android Chrome with WebGPU, make GPU Studio the phone's 'Play' viewer: impostor atoms in WGSL lifting the 5k cap to about 200k, rendered at 0.6x and FSR-upscaled, inside a 100k-flake compute snowglobe you shake with the phone.

<a id="c043"></a>
### C043 · Shake-to-Snow Globe
**Folded into host** · mean 3.2 (E3 P4 A3 Pr3 M3) · effort L · [GL2-degraded] · rides R3, R7, R12

Shake your phone or flick the screen and glitter swirls in a glass globe around the molecule, then settles, piling into little white caps on the atoms where WebGPU allows.

- **Summary:** Problem: shaking the phone does nothing in the main viewer. Solution: shake or flick and glitter swirls in a glass globe around the molecule, then settles; on the WebGPU backend a compute blizzard of 50-150k flakes collides with atom spheres and piles into caps; on the GL2 backend a few thousand sprite flakes swirl without piling. Particles only; atoms untouched. Desktop: flick. Phone: shake.
- **Tech:** TSL compute instancedArray + SpriteNodeMaterial (points are 1 px); collision against atom storage; CPU or transform-feedback sprites on GL2; SnowMotion + enablePhoneSnow; per-job fps; demand once settled
- **Judges:**
  - E 3/merge: Flake-atom collision for 50-150k flakes needs spatial binning ([GPU], atomics), and it overlaps C042's snowglobe. *Improve:* Merge into C042 as its shake interaction: sprite flakes on both backends, with atom piling as a [GPU]-only extra.
  - P 4/keep: 'Shake your phone and glitter swirls' is a physical toy anyone understands, and the existing Studio already proves it. Snow piling into caps is WebGPU-only. *Improve:* Ask for motion permission from a 'Shake me' chip on the first visit, and map a screen flick to the same effect so desktop gets it too.
  - A 3/merge: Snow in a globe is charming but kitsch, and it duplicates the existing Studio snowglobe. *Improve:* Merge into C042 as that Look's shake response.
  - Pr 3/merge: Shake-to-snow is the core toy of Studio's snowglobe; as a separate item it duplicates C042. *Improve:* Build it as C042's shake interaction, with the stated GL2 sprite degrade.
  - M 3/merge: Merge into C042. Shaking is a good phone verb, but compute piling is GPU-only, settling keeps rendering, and bright glitter needs a flash limit. *Improve:* Make it C042's snow mode, with a Shake button, a keyboard key, and a hard settle-then-sleep.
- **Round-1 ideas merged here:**
  - `R1-r3f-sweep-13` **Snow That Piles Up on Atoms** — A real compute snowglobe: 50k–150k flakes blizzard around the molecule when you shake, then settle into little white caps on top of the atoms.
  - `R1-r3f-sweep-08` **Pocket Snowglobe for Every Phone** — Shake your phone or flick the screen and glitter swirls inside a glass globe around the molecule, then drifts down and settles, on plain WebGL.

<a id="c044"></a>
### C044 · Light Painter
**Strong** · mean 3.8 (E4 P3 A5 Pr3 M4) · effort S · DOM/CPU (ships on v9 today) · rides none (mood bus on v10)

Grab the sun: drag to move the key light (the rim swings opposite) and every highlight, rim and shadow glides across the molecule on a spring.

- **Summary:** Problem: lighting is buried in sliders. Solution: grab the sun: drag to move the key light while the rim swings opposite, and every highlight and shadow glides across the molecule on a spring. CPU plus existing light uniforms, so it ships on v9 and moves onto the mood bus on v10. Desktop: drag with a light cursor. Phone: a Light chip, then drag.
- **Tech:** math/time spring.update/dampAngle/fromResponse; math/color lerp in linear light; existing light uniforms -> v10 mood bus (useUniforms); invalidate while springing
- **Judges:**
  - E 4/keep: CPU springs on existing light uniforms ship on v9 and move to the mood bus cleanly. It is cheap, tactile and demand-friendly. *Improve:* Add a single ghost sun gizmo that snaps to hero lighting angles, reusing C021's detent logic.
  - P 3/keep: Grabbing the sun is satisfying direct manipulation and ships on v9, but on phones it hides behind a Light chip and the novelty is short. *Improve:* After a tap on empty backdrop, let the light follow the cursor or finger for a moment, so it's discoverable without a chip.
  - A 5/champion: Grabbing the key light and watching highlights and shadows glide across the molecule makes the brand ('matter and light') tactile, and it ships on v9. *Improve:* Add a visible light-sphere gizmo with snap points for classic setups (Rembrandt, butterfly, rim), and tie a warm-to-cool colour temperature to light elevation.
  - Pr 3/keep: Direct-manipulation lighting replaces buried sliders; small and ships on v9. A modest 'aha'. *Improve:* Put it behind the Style panel's light control, on C003 springs.
  - M 4/keep: Size S, ships on v9, runs on both backends. Grabbing the sun is intuitive, and arrow keys can move it just as well. *Improve:* Let the arrow keys move the light. On phones, give the drag to a Light chip so it doesn't take over orbit.
- **Round-1 ideas merged here:**
  - `R1-looks-01` **Light Painter** — Grab the sun: drag to move the key light (and swing the rim light) and watch every highlight, rim and shadow glide across the molecule on a spring.

<a id="c045"></a>
### C045 · Film Stocks
**Strong** · mean 3.6 (E4 P2 A5 Pr3 M4) · effort S · [GPU+GL2] · rides R6

One-tap tone curves and colour grades (AgX, Khronos Neutral and a few in-house LUT 'films') that make element colours truer or moodier without touching materials.

- **Summary:** Problem: fiber defaults to ACES, which skews element colours, and there are no grades. Solution: one-tap tone curves and colour grades (AgX, Khronos Neutral, a few in-house LUT 'films') in the output pass, cross-faded on a spring, with materials untouched. Cheap for phones. Post-only, so it stays outside deterministic export. Desktop and phone: tap a film chip.
- **Tech:** three r186 AgXToneMapping/NeutralToneMapping, lut3D + LUTCubeLoader, renderOutput(); useRenderPipeline; explicit tone mapping (ACES parity trap); spring.damp on uLutMix
- **Judges:**
  - E 4/keep: AgX, Neutral and lut3D are real in r186 and cost almost nothing. But switching renderer.toneMapping operators rebuilds the output node, so films won't cross-fade as uniforms. *Improve:* Bake each film, including AgX and Neutral curves, into 3D LUTs so switching is just a uLutMix uniform lerp under one output transform.
  - P 2/merge: Tone curves are subtle and read as a settings feature; most players won't see AgX versus Neutral. Merge into C054. *Improve:* Fold two or three named 'films' into C054's swipe skins.
  - A 5/champion: AgX and Neutral fix ACES's hue skew on element colours, and a few curated film grades give Lupi a photographic identity at almost no cost. *Improve:* Make Khronos Neutral the truthful default now on v9 (the installed postprocessing already exports AGX and NEUTRAL), and cap grades at 3-4 named stocks.
  - Pr 3/keep: Moving from ACES to AgX or Neutral makes element colours truer, which is an honesty win. The LUT 'films' are decoration. *Improve:* Make Neutral or AgX the R6 default for correctness, and ship the films only as cheap Looks.
  - M 4/keep: It lives in the output pass only, so it is nearly free on phones, and AgX fixes the ACES skew in element colours. *Improve:* Add accessible 'films': colour-blind-safe and high-contrast grades alongside the moody ones.
- **Round-1 ideas merged here:**
  - `R1-looks-02` **Film Stocks** — One-tap tone curves and colour grades (AgX, Khronos Neutral and a few in-house LUT 'films') that make element colours truer or moodier without touching materials.

<a id="c046"></a>
### C046 · Depth Atmosphere and Focal Slab
**Strong** · mean 3.8 (E5 P2 A5 Pr3 M4) · effort S · [GPU+GL2] · rides R3, R5

Background-matched depth fog, depth desaturation and a draggable focal slab that make million-atom lattices read in 3D at almost no cost.

- **Summary:** Problem: million-atom lattices read flat. Solution: background-matched depth fog, depth desaturation and a draggable focal slab that keeps one depth band crisp and saturated, all from the impostor's hit-point view-z. Nearly free, a good phone default. Desktop: drag the slab. Phone: two-finger vertical drag.
- **Tech:** TSL fog/rangeFogFactor/densityFogFactor and saturation on R3 impostor view-z; mood uniforms via configureTSL; frame-owned slab as a plain uniform() in useNodes; spring.damp
- **Judges:**
  - E 5/keep: Nearly free (view-z from the R3 impostor, TSL fog and saturation), uniform-only, and runs on both backends. It is the cheapest way to make million-atom lattices read in 3D on phones. *Improve:* Make it the default above ~50k atoms, with fog colour taken from the mood bus and the background, and zeroed in V2 export.
  - P 2/merge: Depth fog improves readability almost for free, but the draggable focal slab is a pro control. Merge into C060. *Improve:* Ship the fog as a default and move the slab into C060's photo mode.
  - A 5/champion: Backdrop-matched depth fog and a focal slab are classic aerial perspective, the cheapest way to make million-atom lattices read in depth and look cinematic on phones. *Improve:* Turn subtle depth fog on by default for large scenes and tint it from the backdrop, so it never reads as grey haze.
  - Pr 3/keep: Nearly free depth cues that make big lattices readable; a good, low-risk phone default. *Improve:* Make depth fog the default for large scenes in R3, with the focal slab as an optional control.
  - M 4/keep: Nearly free depth cues make a good phone default. But fog lowers contrast for low-vision users, and a two-finger vertical drag collides with pinch. *Improve:* Make the focal slab a slider, and turn fog off automatically under prefers-contrast: more.
- **Round-1 ideas merged here:**
  - `R1-looks-03` **Depth Atmosphere and Focal Slab** — Background-matched depth fog, depth desaturation and a draggable 'focal slab' that make million-atom lattices read in 3D at almost no cost.

<a id="c047"></a>
### C047 · Hologram
**Parked** · mean 2.4 (E3 P3 A1 Pr2 M3) · effort S · [GPU+GL2] · rides R3, R6

Turn any molecule into a flickering sci-fi hologram with additive fresnel shells, scanlines and interference bands that need no sorting.

- **Summary:** Problem: there is no playful sci-fi look, and translucent looks need sorting. Solution: additive fresnel shells, scanlines, interference bands and slight chromatic aberration, which need no sorting. Blend state isn't a uniform, so it is a separately cached material prewarmed with compileAsync. Cheap on desktop and phone. Illustrative, outside export.
- **Tech:** TSL AdditiveBlending, screenUV/screenSize, hue, hash; chromaticAberration + CRT scanlines/vignette in useRenderPipeline; weights on mood uniforms; compileAsync prewarm
- **Judges:**
  - E 3/keep: Additive, unsorted shells mean depthWrite is off and overdraw is complete. At 100k+ atoms that is a fill-rate bomb on tile GPUs, and the blend state forces a separate material. *Improve:* Cap the atom count or render with a depth prepass so only the front-most shell adds, then apply the scanline and chromatic passes.
  - P 3/merge: Hologram is a fun one-tap look kids will like, but it's one look among many. Merge into C048. *Improve:* Make it a point on C048's pad and a C054 skin.
  - A 1/kill: Scanlines, fresnel shells and chromatic aberration are the most generic sci-fi shader trope. They wash out element colour, and a screenshot would not read as Lupi. *Improve:* If a glowing look is wanted, fold emissive rims into C050's selective highlight instead.
  - Pr 2/park: A cheap sci-fi gimmick that adds to an already large Look catalogue without learning or share value. *Improve:* Offer it only as a Remix-only or seasonal Look.
  - M 3/keep: Cheap and sort-free on phones. But flickering scanlines and chromatic aberration are photosensitivity and comfort risks. *Improve:* Ship without flicker by default, keep scanline motion slow, and switch it off under reduced motion.
- **Round-1 ideas merged here:**
  - `R1-looks-04` **Hologram** — Turn any molecule into a flickering sci-fi hologram, with additive fresnel shells, scanlines and interference bands that need no sorting.

<a id="c048"></a>
### C048 · Look Space and the Look Pad
**Champion** · mean 4.4 (E4 P4 A5 Pr4 M5) · effort M · [GPU+GL2] · rides R3, R6

Every look becomes a point in one uniform space, so switching, remixing or dragging a thumb across a 2D Look Pad morphs the molecule continuously from chrome to clay to toon, with no recompiles.

- **Summary:** Problem: looks snap and recompile, so switching or remixing flashes. Solution: every look is a point in one uniform space (material, light, post and palette weights) read by one uber-impostor through select() and If branches; switching springs between points. A 2D Look Pad lets a thumb morph chrome to clay to toon. Desktop: drag the pad. Phone: thumb pad.
- **Tech:** configureTSL typed Register scopes + read-only useUniforms('look'); frame-owned plain uniform() in useNodes (snap-back trap); scheduler job invalidates until springs settle (onIdle); math spring4/dampAngle
- **Judges:**
  - E 4/keep: 'Uniform, not material' is the right architecture, and it rides R3/R6. But select() evaluates both operands, so an uber-impostor that blends chrome, clay and toon computes every look per fragment, with no early-Z to hide it. *Improve:* Use If() on uniforms (coherent branching) and blend at most two looks at a time, instead of select() over the whole look space.
  - P 4/keep: Dragging a thumb across a pad and watching chrome melt into clay is a real toy, and it fixes snapping looks. As pitched, though, it's still a panel. *Improve:* Put the pad on the canvas as a two-finger drag or a floating orb, so morphing looks is a gesture, not a menu.
  - A 5/champion: One uniform space with springed morphs is the system that turns scattered looks into one recognisable identity, and the Look Pad is a joyful thumb toy. *Improve:* Art-direct the pad's anchor corners and check that the midpoints look good (no muddy chrome-clay blends). Keep looks that need a different blend state, such as additive, out of the continuous space.
  - Pr 4/keep: The uniform look space is the brief's rank-2 platform: Looks morph instead of snapping, with no recompiles, on both backends. The Look Pad is a novel toy. *Improve:* Define the look-space schema so that C062's Remix codes encode positions in it.
  - M 5/champion: Morphing looks without recompiles fixes the Look-switch hitch that phones feel most (slow material init), and it works on both backends. A thumb pad is friendly to one-handed use. *Improve:* Make the pad keyboard- and screen-reader-operable: arrow steps and named anchors such as 'Clay 70%, Chrome 30%'.
- **Round-1 ideas merged here:**
  - `R1-looks-05` **Look Space and the Look Pad** — Every look becomes a point in one uniform space, so switching, remixing or dragging a thumb across a 2D Look Pad morphs the molecule continuously from chrome to clay to toon, with no recompiles.

<a id="c049"></a>
### C049 · Illustrate (Goodsell / QuteMol Look)
**Strong** · mean 4 (E4 P3 A5 Pr4 M4) · effort M · [GPU+GL2] · rides R3, R6

The Molecule-of-the-Month look: flat pastel atoms, ink contours that thicken across depth gaps, and soft ambient occlusion.

- **Summary:** Problem: there is no textbook-illustration look. Solution: the Goodsell / QuteMol style: flat pastel atoms, ink contours that thicken across depth gaps, and soft AO, built from impostor depth and an atom-ID MRT with a custom edge kernel. Desktop and phone (half-res AO). Great for posters and share cards.
- **Tech:** TSL mrt (id/normal), packNormalToRGB, half-res ssao()/ao() + traa(), custom Fn depth/ID edge kernel (textureGather); math/color hsl pastels; GL2 integer MRT unverified
- **Judges:**
  - E 4/keep: Rides R6 and shares the ID MRT with C009. Half-res AO plus ID edges is a well-understood recipe. GL2 integer MRT is unverified, and textureGather needs r185 or later. *Improve:* Use the RGBA8-packed ID from C009 for the edge kernel so it runs unchanged on the GL2 backend.
  - P 3/merge: The Goodsell look is gorgeous and poster-worthy, but it's a look, not play. Merge into C048. *Improve:* Make it a C048 look point and the default for C060 posters.
  - A 5/champion: The Goodsell/QuteMol look is instantly recognisable, honest to the science and poster-grade. It is the strongest candidate for Lupi's signature visual voice. *Improve:* Make it the house style for share cards, daily silhouettes, posters and landing previews, so Lupi is recognisable outside the viewer.
  - Pr 4/keep: The Goodsell illustration look is beloved in education and ideal for posters and share cards. Mol* already has an illustrative style, so the edge has to come from polish. *Improve:* Make it the default style for share cards and posters (C106, C114).
  - M 4/keep: Ink contours give a high-contrast look that helps low-vision users and prints well. GL2 integer MRT is unverified. *Improve:* Use depth-only edges on GL2, and offer this look as the high-contrast accessibility preset.
- **Round-1 ideas merged here:**
  - `R1-looks-06` **Illustrate (Goodsell / QuteMol look)** — The Molecule-of-the-Month look: flat pastel atoms, ink contours that thicken across depth gaps, and soft ambient occlusion, built from impostor depth and an atom-ID buffer.

<a id="c050"></a>
### C050 · Neon Glow
**Strong** · mean 4.2 (E5 P4 A4 Pr4 M4) · effort M · [GPU+GL2] · rides R2, R3, R6

Make any element glow like a neon tube: tap an element chip and every Cu atom lights up, tap one atom and it pulses, and only what you ask for blooms.

- **Summary:** Problem: bloom is all-or-nothing and can't highlight one element. Solution: a per-atom glow flag in R2's free fourth byte plus a palette emissive feed an MRT glow channel, so only what you ask for blooms: tap an element chip and every Cu lights up; tap one atom and it pulses. Desktop and phone (half-res bloom).
- **Tech:** R2 unorm8x4 flag byte; MRT emissive channel via per-material mrtNode; bloom() with uniform strength (bloomPass.strength); GPU ID picking for taps; spring pulses
- **Judges:**
  - E 5/champion: The R2 spare byte plus MRT emissive plus bloom with a uniform strength (verified as a uniform in BloomNode) is the textbook TSL selective-bloom path, and it rides both R2 and R6. The cost is an extra full-res attachment every frame, even when nothing glows. *Improve:* Attach the emissive MRT and the bloom only while a glow flag or chip is active (with a prewarmed graph swap), and run bloom at half resolution on phones.
  - P 4/keep: Per-element neon and a pulsing tapped atom are the visual feedback layer that many toys and games need (Echo, hunts, passport), and it rides R2's free byte. *Improve:* Make tapping an element in the legend light up all its atoms with a plink, as the first element toy.
  - A 4/keep: Per-element selective glow is a powerful highlighting tool. 'Neon' as a look is gimmicky. *Improve:* Reframe it as Highlight: a soft, element-tinted glow with a restrained radius, shared by selection, hunts and Echo.
  - Pr 4/keep: Tap an element chip and every Cu glows: an inspection tool that is also fun. It rides the R2 flag byte and R6 bloom. *Improve:* Wire it into the existing Elements panel as 'highlight', so it serves inspection first.
  - M 4/keep: Tapping an element chip to light up every Cu atom is a real way-finding aid that keyboard users can reach, and half-res bloom fits phones. The pulses must stay slow. *Improve:* Keep pulses under 3 Hz, and add a non-glow outline mode for forced-colors users and devices with bloom off.
- **Round-1 ideas merged here:**
  - `R1-looks-07` **Neon Glow** — Make any element glow like a neon tube: tap an element chip and every Cu atom lights up, tap one atom and it pulses, and only what you ask for blooms.

<a id="c051"></a>
### C051 · Gummy Candy Atoms
**Folded into C048** · mean 3.4 (E4 P3 A4 Pr3 M3) · effort M · [GPU+GL2] · rides R3

Atoms become translucent gummy sweets with exact jelly depth: thick centres glow deep, edges go clear, and a sour sugar sparkle catches the light, scaling to 100k+ atoms.

- **Summary:** Problem: translucent looks don't scale and sort badly. Solution: each atom is a gummy sweet using the exact ray-sphere chord for Beer-Lambert absorption (deep centres, clear rims), back-lit glow, backdrop refraction, and a 'sour' sparkle fixed to each atom. Shaded opaque, so it scales to 100k+ atoms. Desktop and phone.
- **Tech:** hand-written TSL Fn in the R3 impostor fragment (chord = 2*sqrt(disc)); backdropNode + viewportSharedTexture; mx_cell_noise_float in atom-local coordinates
- **Judges:**
  - E 4/keep: The exact chord gives correct absorption, is shaded opaque, and scales. viewportSharedTexture copies once per instanced draw, so 'refraction' only sees what was drawn before the atoms. *Improve:* Drop the backdrop refraction on phones and keep the chord absorption plus atom-local sparkle, which carry the look.
  - P 3/merge: Gummy candy atoms are among the most appealing looks, but on their own they're a style. Merge into C048. *Improve:* Make it a signature C048 look that C028's jiggle plays on.
  - A 4/keep: Gummies that use the exact ray-sphere chord are distinctive and playful, and they scale because they are shaded opaque. The sour sparkle can read as noise at a distance. *Improve:* Fade the sparkle by pixel radius, and tune absorption per element so the candy stays legible as CPK colours.
  - Pr 3/keep: The most kid-appealing look, and it scales because it is shaded opaque, but it is one Look among many. *Improve:* Ship it as one of at most 5 launch Looks, chosen with analytics.
  - M 3/keep: The opaque shading scales, but backdrop refraction adds a full-viewport copy every frame, which tile GPUs pay for. *Improve:* Drop refraction on phones and keep the chord-based absorption.
- **Round-1 ideas merged here:**
  - `R1-looks-08` **Gummy Candy** — Atoms become translucent gummy sweets with exact jelly depth: thick centres glow deep, edges go clear, and a 'sour' sugar sparkle catches the light. The look is opaque, so it scales to 100k+ atoms.

<a id="c052"></a>
### C052 · Gummy Molecule (Melted Jelly Surface)
**Parked** · mean 2.6 (E3 P3 A3 Pr2 M2) · effort M · [GPU+GL2] · rides none (separate mesh; post via R6)

Melt a small molecule into one squishy gummy surface you can poke, casting candy-coloured caustics on the floor.

- **Summary:** Problem: small molecules read as separate balls. Solution: a 'Melt' slider blends molecules up to ~80 atoms into one glossy metaball surface (marching cubes, updated only while melting or poked) with transmission and candy caustics. Desktop: poke the jelly. Phone: sheen material instead of transmission. drei Outlines is dropped (broken in drei 11). A separate mesh, distinct from per-atom gummy.
- **Tech:** renderer-agnostic MarchingCubes (drei 11 /experimental or three addons) re-polygonized on demand; MeshPhysicalNodeMaterial transmission; drei 11 Caustics (runtime-verify); spring
- **Judges:**
  - E 3/keep: Marching cubes for ~80 atoms, re-polygonised on demand, is fine. Transmission plus drei 11 Caustics (runtime-unverified) is the risky and expensive part on phones. *Improve:* Ship it with MeshPhysicalNodeMaterial sheen or clearcoat everywhere, and add transmission and caustics only on WebGPU desktop.
  - P 3/park: A squishy metaball jelly is appealing, but it's a separate mesh, works for small molecules only, and relies on drei 11 Caustics, which is unverified. *Improve:* Let the per-atom gummy look (C051) deliver most of the candy appeal more cheaply.
  - A 3/park: A melted jelly surface with caustics is a gorgeous hero for small molecules. But metaballs imply a molecular surface that isn't a real SES, and drei 11 Caustics has a WebGPU file but is unverified at runtime. *Improve:* If built, derive the surface from vdW radii (SES-like) and present it as a surface, not jelly.
  - Pr 2/park: A separate mesh capped at about 80 atoms, with drei Caustics unverified at runtime. Duplicates C051. *Improve:* Only if a molecular-surface feature is needed for its own sake.
  - M 2/park: CPU marching cubes, transmission and the unverified drei 11 Caustics make it desktop-leaning, all for about 80 atoms. *Improve:* If it ever ships, phones get only the sheen variant.
- **Round-1 ideas merged here:**
  - `R1-r3f-sweep-15` **Gummy Molecule** — Melt a small molecule into squishy gummy candy: the atoms blend into one glossy jelly surface you can poke, casting candy-coloured caustics on the floor.

<a id="c053"></a>
### C053 · Soap Bubble
**Folded into C048** · mean 3.2 (E3 P4 A4 Pr2 M3) · effort M · [GL2-degraded] · rides R3, R6

Atoms as soap bubbles: thin-film colours swirl over each bubble, see-through overlaps never pop wrongly, and tap-to-pop (they re-inflate).

- **Summary:** Problem: glassy looks pop while rotating. Solution: atoms as soap bubbles with thin-film interference colours that swirl slowly, correct see-through overlaps from order-independent transparency, and tap-to-pop with re-inflation. An opaque pearl variant runs fully on both backends. Desktop: OIT with MSAA. GL2 backend: OIT without MSAA plus FXAA.
- **Tech:** MeshPhysicalNodeMaterial iridescenceThicknessNode, mx_noise_vec3; oitPass (r186) toggled in useRenderPipeline; GPU ID pick + spring pop scale
- **Judges:**
  - E 3/keep: iridescenceThicknessNode and OITPassNode exist, but OIT at large atom counts costs heavy overdraw and memory, and GL2 has no MSAA with OIT. *Improve:* Limit the OIT bubble look to under ~20k atoms and make the opaque pearl variant the default above that.
  - P 4/keep: Tap-to-pop bubbles is bubble-wrap compulsion with a clear verb, and the thin-film colours are lovely. OIT is degraded on the GL2 backend. *Improve:* Add a pop sound and a 'pop them all' counter so it becomes a 20-second loop.
  - A 4/keep: Thin-film iridescence with correct OIT overlaps is a natural evolution of the Prism look (iridescenceThicknessNode and OITPassNode both exist in r186). Pop and re-inflate is a charming tap. *Improve:* Position it as the next Prism, with the opaque pearl variant as the default on GL2 and for large scenes.
  - Pr 2/park: A pop-toy gimmick; the OIT has no MSAA on the GL2 backend. *Improve:* Revisit after OIT is proven on the filter shell.
  - M 3/keep: Tap-to-pop is fun. But OIT costs extra render targets on tile GPUs, and GL2 loses MSAA. *Improve:* Make the opaque pearl variant the phone default and keep OIT desktop-only.
- **Round-1 ideas merged here:**
  - `R1-looks-09` **Soap Bubble** — Atoms as soap bubbles: real thin-film interference colours that swirl slowly over each bubble, see-through overlaps that never pop wrongly, and tap-to-pop (they re-inflate).

<a id="c054"></a>
### C054 · Print Shop and Lens Skins
**Rework** · mean 3.4 (E3 P4 A3 Pr3 M4) · effort M · [GPU+GL2] · rides R6

One post graph with uniform-switched skins: comic halftone, risograph, blueprint, manga screen-tone, Retro-PS1, pixel, film and glitter streak, swiped between at a reduced render scale.

- **Summary:** Problem: style variety came from vanruesc blend modes, lost in v10. Solution: one post graph with uniform-switched branches (comic halftone, two-ink risograph, blueprint, manga screen-tone, Retro-PS1, pixel, film, glitter streak), swiped between while rendering at ~0.67x with fsr1. Desktop: swipe or keys. Phone: swipe carousel. Post-only; share-card friendly, outside export.
- **Tech:** TSL sobel, bayerDither, posterize, interleavedGradientNoise, RetroPassNode, PixelationPassNode, film, afterImage; hand-written halftone/riso Fn; select() on a skin uniform; fsr1; useRenderPipeline
- **Judges:**
  - E 3/keep: Good for share cards. But Retro and Pixelation are separate PassNodes that can't be switched through one select() uniform, and a mega-graph with every skin costs every skin. *Improve:* Prebuild each skin's outputNode with compileAsync and swap graphs on the swipe, cross-fading only the two neighbours.
  - P 4/keep: Swiping through comic, risograph, PS1 and pixel skins is the Instagram-filter loop: discoverable, instant, and share-card friendly. *Improve:* Switch skins with a swipe on a dedicated strip (not the canvas, which means rotate), and flash the skin name as it changes.
  - A 3/rework: Riso, halftone and blueprint fit an editorial print brand. PS1, pixel and glitter streak turn it into a grab-bag of stock filters. *Improve:* Cut to three print-native skins (riso, halftone via DotScreen, blueprint) tied to the Poster Studio, and drop the rest.
  - Pr 3/keep: Skins make good share-card material and live in one uniform-switched graph, but they are post-only and add to Look sprawl. *Improve:* Pick 3 skins that serve export (blueprint, halftone, riso) and tie them to C106 and C114.
  - M 4/keep: Post-only skins are cheap and good for sharing, and blueprint and halftone even improve contrast. Film grain and glitter streaks need flash limits. *Improve:* Add keyboard next/previous skin, and switch off animated grain and glitter under reduced motion.
- **Round-1 ideas merged here:**
  - `R1-looks-10` **Print Shop skins** — One-tap print looks (comic halftone, two-ink risograph, blueprint, manga screen-tone) as uniform-switched branches of a single post graph.
  - `R1-r3f-sweep-12` **Studio Lenses at 60 fps** — Give GPU Studio a TSL post graph: swipe between Retro-PS1, Pixel, Blueprint, Halftone, Film and 'Glitter streak' lenses while the scene renders at about 0.67× and FSR upscales it.

<a id="c055"></a>
### C055 · Claymation
**Folded into C048** · mean 3.6 (E4 P3 A4 Pr3 M4) · effort M · [GPU+GL2] · rides R3, R7

Plasticine atoms with thumbprints that stay on each atom, a boiling surface wobble, and a turntable that animates on twos at 12 fps, so it renders less often.

- **Summary:** Problem: nothing in Lupi feels handmade. Solution: plasticine atoms with thumbprints fixed to each atom, a 'boiling' surface wobble, and a turntable that animates on twos at 12 fps. Because the look ticks at 12 fps, it renders less often and saves battery. Desktop and phone.
- **Tech:** TSL mx_noise_vec3/hash/instanceIndex in the R3 impostor; scheduler per-job fps: 12 + frameloop='demand' + invalidate (named phases); math easing.rsqw hold-then-snap turntable
- **Judges:**
  - E 4/keep: Rendering at 12 fps via per-job fps is genuinely calmer, and the look is cheap noise in the impostor. Thumbprints in atom-local space avoid swimming. *Improve:* Tie it to the scheduler as the reference per-job-fps look and measure the battery delta in C014.
  - P 3/merge: Charming and battery-friendly, but one look in a list. Merge into C048. *Improve:* Make it a C048 look and a C054 skin.
  - A 4/keep: Plasticine thumbprints and animating on twos are genuine animation craft and distinctive. Applying 12 fps to user-driven orbit would read as lag. *Improve:* Animate on twos only for the look's own boil and turntable, and keep direct manipulation at display rate.
  - Pr 3/keep: Charming, and genuinely calmer: ticking at 12 fps saves battery. Still, it is another Look. *Improve:* Reuse its on-twos ticking as the default for idle and turntable modes.
  - M 4/keep: Animating on twos at 12 fps is a rare look that actually saves battery on phones. The boiling wobble is continuous motion. *Improve:* Freeze the boil under reduced motion, and let the 12 fps job sleep when the turntable stops.
- **Round-1 ideas merged here:**
  - `R1-looks-11` **Claymation** — Plasticine atoms with thumbprints that stay on each atom, a 'boiling' surface wobble, and a turntable that animates on twos at 12 fps. Charming, and it renders less often.

<a id="c056"></a>
### C056 · Billiard Balls
**Strong** · mean 4 (E4 P3 A4 Pr4 M5) · effort M · [GPU+GL2] · rides R3

Every atom becomes a glossy pool ball with its element symbol printed on a white disc facing you, fading in as you zoom close.

- **Summary:** Problem: element identity needs a legend or label clutter. Solution: every atom becomes a glossy pool ball with its symbol printed on a white disc facing the viewer, fading in only on atoms that are large on screen (pixel-radius LOD). Replaces the etch plumbing in R3. Desktop and phone; a deterministic material, so a V2 export candidate.
- **Tech:** @mapbox/tiny-sdf 2.2.0 atlas; TSL texture()/.load() at the atlas cell, fwidth, smoothstep, pixel-radius LOD in the R3 impostor; no glyph needed
- **Judges:**
  - E 4/keep: The tiny-sdf atlas plus pixel-radius LOD in the R3 impostor is cheap, and it replaces the etch plumbing inside the port. It is readable and fun, especially on phones. *Improve:* Fetch the glyph only above a pixel-radius threshold, via an If on the LOD, so distant atoms pay nothing.
  - P 3/keep: Pool balls whose symbols fade in as you zoom are playful and teach element identity, and they're an export candidate, but they aren't interactive. *Improve:* Add a break shot: double-tap in this look scatters the balls with a clack (C030 with pool sounds).
  - A 4/keep: Symbol decals that fade in by pixel radius solve element identity without a legend and look great. The pool-ball metaphor can feel kitsch. *Improve:* Generalise it to a 'printed symbol' decal usable in any look (Paper especially), with billiards as one skin.
  - Pr 4/keep: Symbols printed on atoms answer 'which atom is which' for students without a legend. The material is deterministic, so it can go into V2 export. Learning and fun in one. *Improve:* Offer it as a Style toggle ('Show element letters') as well as a billiard Look.
  - M 5/champion: Printing element symbols on the atoms gives colour-blind users element identity without colour. It is deterministic and runs on both backends. *Improve:* Make the symbol discs an overlay any Look can switch on, not only the billiard look, with contrast that survives forced colors.
- **Round-1 ideas merged here:**
  - `R1-looks-13` **Billiard Balls (symbols on every atom)** — Every atom becomes a glossy pool ball with its element symbol printed on a white disc facing you, fading in as you zoom close.

<a id="c057"></a>
### C057 · HDR Sparkle and Jewel (Display-P3) Palettes
**Parked** · mean 2.6 (E3 P2 A4 Pr2 M2) · effort M · [GPU] · rides R6, R12

On HDR screens, metal glints, snow glitter and neon cores shine brighter than paper-white, and element colours use the full P3 gamut, falling back to SDR and sRGB.

- **Summary:** Problem: glints, glitter and neon clip at paper-white, and palettes are sRGB-bound. Solution: on HDR-capable WebGPU browsers, extended-range output lets metal glints, snow and neon cores exceed white, and element palettes use Display-P3; SDR and sRGB fallback is automatic, including on the GL2 backend. Desktop HDR monitors and recent phones. Watch HalfFloat bandwidth on tile GPUs.
- **Tech:** three r186 outputType HalfFloatType, ExtendedSRGBColorSpace (addons ColorSpaces); WebGPU context.configure toneMapping mode 'extended'; math colorspace linearSrgbToLinearDisplayP3; feature-detect
- **Judges:**
  - E 3/park: Verified: WebGPUBackend picks 'extended' tone mapping when outputType is HalfFloat, and ExtendedSRGBColorSpace ships in addons. It auto-degrades to SDR, but HalfFloat output costs bandwidth on the tile GPUs that most phones use. *Improve:* Offer it only on desktop WebGPU where HDR is detected, as an opt-in for glints, after C014 shows bandwidth headroom.
  - P 2/park: HDR glints are invisible to most players and show only on some displays. *Improve:* Park it until the looks that need it (neon, snow) exist.
  - A 4/keep: HDR glints and P3 palettes give a real wow on modern screens (extended output is verified in r186 when outputType is HalfFloat). But shared images and SDR screens will look different from the original. *Improve:* Treat SDR as the canonical art-directed look, and use HDR only as headroom for speculars, never for base element colour.
  - Pr 2/park: Mostly WebGPU-only, small reach, and a bandwidth risk on phone GPUs. *Improve:* Revisit once device data exists.
  - M 2/park: It leans on GPU-only paths and HalfFloat bandwidth that tile GPUs pay for, and glints brighter than paper-white can be uncomfortable glare. *Improve:* Enable HDR on desktop monitors only, and never for pulsing or flashing content.
- **Round-1 ideas merged here:**
  - `R1-looks-14` **HDR Sparkle + Jewel (Display-P3) palettes** — On HDR screens, metal glints, snow glitter and neon cores shine brighter than paper-white, and element colours use the full P3 gamut, falling back gracefully to SDR/sRGB.

<a id="c058"></a>
### C058 · Worlds: Sky, Sunset, Night Fireflies and Underwater
**Rework** · mean 2.8 (E3 P3 A3 Pr2 M3) · effort L · mixed · rides R5, R6

Put the molecule somewhere: a physical sky whose sun you drag from dawn to night, element atoms that light up like fireflies after dark, or underwater caustics dancing over every atom.

- **Summary:** Problem: the molecule floats in a void. Solution: a physically based sky whose sun you drag from dawn to night (Earth, Mars, Titan), or underwater caustics over every atom; the sky feeds IBL and the mood uniforms. At night, tap an element and its atoms light up like firefly lamps (clustered lights on WebGPU; up to 4 lights plus bloom on GL2). Desktop and phone.
- **Tech:** @pmndrs/sky 0.3.0 (GL2 behaviour unverified); pmremTexture IBL; densityFogFactor, mx_worley_noise_float caustics, godrays(); ClusteredLighting [GPU] with 4-light + bloom degrade; self-hosted assets
- **Judges:**
  - E 3/rework: @pmndrs/sky is pre-1.0 and GL2-unverified, and dragging the sun re-runs PMREM IBL generation every frame, which is expensive on phones. Clustered lights are [GPU] (with a stated 4-light degrade). *Improve:* Regenerate the PMREM only on drag release (or throttle it through a low-fps scheduler job), and drive the sun colour through the mood bus in between.
  - P 3/park: Dragging the sun from dawn to night and firefly atoms are beautiful, but it's L effort, the sky's GL2 behaviour is unverified, and it's mostly a backdrop. *Improve:* Salvage the firefly tap into C050's element glow.
  - A 3/rework: A draggable sky is cinematic and firefly nights are charming. But sunsets and underwater scenes drift toward kitsch, and the sun duplicates C044. *Improve:* Fold the sky into Light Painter as its IBL and backdrop (sun position = key light), and keep one art-directed dusk environment.
  - Pr 2/park: L effort; @pmndrs/sky is unverified on GL2 and the fireflies need WebGPU. Remix already has worlds. *Improve:* Only port the existing worlds.
  - M 3/rework: Dragging the sun is cheap and joyful. But @pmndrs/sky is unverified on GL2, fireflies are GPU-only, and the animated caustics keep rendering. *Improve:* Ship only the sky with sun drag, controlled by a slider and shown as a still under reduced motion. Defer fireflies and underwater.
- **Round-1 ideas merged here:**
  - `R1-looks-16` **Worlds: sky, sunset and underwater moods that light the molecule** — Put the molecule somewhere: a physically based sky whose sun you drag from dawn to night (Earth, Mars, Titan), or an underwater world with caustic light dancing over every atom.
  - `R1-r3f-sweep-14` **Night in the Globe** — Drag the sun across a physical sky until night falls over the molecule, then tap an element and every one of its atoms lights up like a firefly lamp.

<a id="c059"></a>
### C059 · Electron Fuzz (Clearly Decorative Aura)
**Killed** · mean 1.8 (E2 P2 A2 Pr1 M2) · effort L · mixed · rides R3, R5

A soft, breathing, element-coloured glow around atoms, halos on every device and true volumetric fog on WebGPU, permanently badged 'decorative, not electron density'.

- **Summary:** Problem: there is no soft atmospheric look, and any 'cloud' risks being read as data. Solution: a breathing, element-coloured glow around atoms: additive halos on every device, true volumetric fog raymarched from a 3D storage texture on WebGPU (a CPU-baked Data3DTexture otherwise), permanently badged 'decorative, not electron density'. Desktop and phone.
- **Tech:** TSL mx_noise_vec3 + AdditiveBlending halos; Storage3DTexture/textureStore + RaymarchingBox (WebGPU); CPU-baked Data3DTexture degrade; useGPUStorage
- **Judges:**
  - E 2/park: Additive halos multiply overdraw, volumetric fog is [GPU] storage-texture work, and even with a badge a 'cloud' around atoms risks reading as electron density. *Improve:* Park it; if revisited, make it a low-alpha rim-only fresnel term inside the impostor rather than separate geometry.
  - P 2/park: A decorative aura that has to be badged 'not electron density' will be misread, and it's barely interactive. *Improve:* If kept, make it respond to touch, for example breathing faster when poked.
  - A 2/kill: Any soft cloud around atoms will be read as electron density whatever the badge says, which muddies exactly what Lupi exists to show. *Improve:* If an aura is wanted, allow it only as a selection highlight in C050, never as a look.
  - Pr 1/kill: In a chemistry-education product, a fuzzy element-coloured cloud around atoms will be read as electron density whatever the badge says. That pushes decoration toward looking like evidence. *Improve:* Drop it. Show clouds only for real supplied density data, with provenance.
  - M 2/park: L effort for a decorative aura that risks being read as electron density, and the volumetric path is GPU-only. *Improve:* If kept, ship halos only, with a 'decorative' badge that screen readers announce.
- **Round-1 ideas merged here:**
  - `R1-looks-17` **Electron Fuzz (clearly decorative aura)** — A soft, breathing, element-coloured glow around atoms (halos on every device, true volumetric fog on WebGPU), permanently badged 'decorative, not electron density'.

<a id="c060"></a>
### C060 · Photo Mode: Tap-to-Focus, Tilt-Shift and Progressive Shutter
**Strong** · mean 4 (E4 P4 A5 Pr3 M4) · effort L · [GPU+GL2] · rides R3, R6, R9

A camera mode: tap an atom and the lens racks focus onto it, drag a tilt-shift band for a toy-on-a-table miniature, and press the shutter to accumulate a clean bokeh-rich poster.

- **Summary:** Problem: views look like screenshots, not photos. Solution: a camera mode: tap an atom and the lens racks focus onto it with a springy hunt; drag a tilt-shift band for a miniature with AgX and a contact shadow; press the shutter and jittered frames accumulate into a clean bokeh-rich poster in about a second. Desktop and phone; the output is an illustrative share image.
- **Tech:** TSL dof(), half-res ssao(), optional ssgi() on desktop; mrt; 1-px readRenderTargetPixelsAsync depth for focus (replaces DepthPicking); useRenderTarget accumulation; AgX output; spring.update
- **Judges:**
  - E 4/keep: dof(), half-res ssao() and a 1-pixel async depth read are real replacements for DepthPicking. Accumulation only runs when the camera rests, so it avoids the temporal-on-moving-atoms trap. *Improve:* Use C061's onIdle jittered accumulation as the shutter engine, and hand the result straight to C106/C104 capture.
  - P 4/keep: Photo modes are beloved in games. Tap to rack focus and a tilt-shift miniature are instantly readable, and they produce share images. *Improve:* Put a shutter button directly on the canvas (no mode panel) and route its output to C104 and C105.
  - A 5/champion: Rack focus with a springy hunt, tilt-shift miniatures and a progressive shutter turn views into photographs, which is the 'cinematic archive' brand exactly. *Improve:* Merge C061's tier-1 accumulation into the shutter, so pressing it visibly develops a clean frame that becomes the share card.
  - Pr 3/keep: Photo-grade stills with tap-to-focus are good share material, but the scope is L and it overlaps C061 and C114. *Improve:* Absorb C061's idle accumulation as the shutter, and ship only tap-to-focus plus the shutter.
  - M 4/keep: Tap-to-focus and a one-second shutter make great shareable stills on phones. DOF blur belongs to this mode, not to the default view. *Improve:* Take C061's tier 1 in as the shutter, bound accumulation to N frames, then sleep.
- **Round-1 ideas merged here:**
  - `R1-looks-18` **Macro Photo Mode (tap-to-focus + progressive shutter)** — A camera mode: tap an atom and the lens racks focus onto it with a springy hunt; press the shutter and Lupi accumulates dozens of jittered frames into a clean, bokeh-rich poster in about a second.
  - `R1-r3f-sweep-07` **Tiny World Lens** — One tap turns any molecule into a macro photo of a toy on a tabletop: tilt-shift blur band, AgX colour and a contact shadow. Drag the focus band with your finger.

<a id="c061"></a>
### C061 · Rest-Frame Beauty, up to a Path-Traced Poster
**Folded into C060** · mean 3 (E3 P3 A4 Pr2 M3) · effort L · mixed · rides R6, R7 (tier 2 also R3)

When the camera rests, spend the idle GPU refining the still: jittered, fully-effected frames on every device and, on WebGPU desktops, a path trace that converges into a gallery print.

- **Summary:** Problem: phones never show the studio look, and stills could be far better. Solution: when the camera sleeps (onIdle), a bounded refinement accumulates jittered frames with full-res AO and bloom on both backends; on WebGPU desktops a sphere-specialised path tracer converges soft shadows, colour bleeding and glass. Any touch aborts instantly. Desktop: gallery prints. Phone: crisp studio stills.
- **Tech:** scheduler onIdle; Halton jitter via setViewOffset into a HalfFloat useRenderTarget running average; tier 2 [GPU]: TSL compute grid (CountingSort, atomics), 3D-DDA ray-sphere, StorageTexture, a-trous denoise
- **Judges:**
  - E 3/merge: Tier 1 (Halton jitter accumulation on onIdle, aborted by touch) is excellent and calm. Tier 2, a sphere path tracer with CountingSort grids, is an XL [GPU] project. *Improve:* Merge tier 1 into C060 as the idle refinement, and park the path tracer.
  - P 3/merge: A still that refines itself is quiet magic, but invisible unless someone saves it. Merge into C060. *Improve:* Make it the shutter's 'develop' step in C060.
  - A 4/keep: Spending the idle GPU refining stills gives premium images on every device, and the path-traced tier is a desktop peak. *Improve:* Expose tier 1 through C060's shutter, and keep tier 2 as an opt-in 'gallery print' on WebGPU desktops.
  - Pr 2/merge: Idle refinement complements C060, but the path tracer is XL WebGPU-only beauty with no growth payoff. *Improve:* Keep only the tier-1 accumulation, inside C060.
  - M 3/merge: Merge into C060. Spending the idle GPU on phones contradicts sleep-on-idle unless it is tightly bounded, and the path-traced tier is desktop-only. *Improve:* Fold tier 1 into C060's shutter, and park the path tracer.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-06` **Rest-Frame Beauty Pass** — When the camera rests, spend the idle GPU on a few jittered, fully-effected frames, so phones show the studio look on every still.
  - `R1-looks-20` **Path-Traced Poster (moonshot)** — Stop moving and the molecule quietly path-traces itself (true soft shadows, colour bleeding between atoms, real glass and gummy refraction), converging into a gallery print.

<a id="c062"></a>
### C062 · Remix Codes that Morph (Shake to Roll)
**Champion** · mean 4.4 (E4 P5 A4 Pr5 M4) · effort M · DOM/CPU (ships on v9 today) · rides none (morph via mood bus: R3, R6)

Every Remix gets a short versioned code that reproduces the look on any molecule and device, looks morph over ~600 ms instead of snapping, and on phones you shake to roll.

- **Summary:** Problem: a lucky Remix can't be reproduced or shared, and looks snap. Solution: a versioned seed codec (e.g. r1-K7QD) with a stateless canonical remix order reproduces lights, materials, backdrop and palette on any device; changes morph over ~600 ms in linear light, with a seeded ridged-noise nebula on the dome. Desktop: Remix button and code chip. Phone: shake to roll. Codes paste into links.
- **Tech:** math mulberry32 (integer-exact), random.choice/float; FNV-1a + base32 codec in packages/core with golden tests; spring.update/dampAngle; color.lerp; simplex3d/ridged dome bake in a worker; mood bus on v10
- **Judges:**
  - E 4/keep: An integer-exact mulberry32 codec with golden tests ships on v9, and sceneRemix already accepts an injectable random. Trig-derived values aren't bit-identical across browsers (math #48), but they are visually stable. *Improve:* Keep the codec integer-only and golden-tested in packages/core, and let the ~600 ms morph ride the mood bus on v10.
  - P 5/champion: Shake to roll a new look that morphs instead of snapping, with a code to share: a slot-machine loop that ships on v9. *Improve:* Add occasional rare rolls (holo, gold) with their own sound so rolling again stays compelling, and show the code as a collectible.
  - A 4/keep: Morphing remixes and reproducible codes make play shareable, but random remixes regularly produce ugly combinations. *Improve:* Sample remixes only from C048's curated look manifold, so every roll looks designed.
  - Pr 5/champion: Makes an existing feature, Remix, reproducible and shareable with a codec that ships on v9; the morphs follow later on the mood bus. A strong share loop that stays honest ('same science'). *Improve:* Put the code in saved-view links and share cards, and add golden tests for determinism across browsers.
  - M 4/keep: Remix codes are plain text, so they are shareable and accessible, and the feature ships on v9. Shake-to-roll needs a permission prompt and a button fallback. *Improve:* Make the Remix button the primary control with a keyboard shortcut, and morph as a crossfade under reduced motion.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-07` **Remix Codes that Morph** — Every Remix gets a shareable code that reproduces it on any device. Looks morph over ~600 ms: lights swing, colours fade in linear light, and a seeded ridged-noise nebula paints the dome.
  - `R1-social-creator-01` **Remix Codes** — Every Remix gets a short, versioned code ("r1-K7QD") that reproduces the exact look on any molecule and device, so a lucky roll can be re-rolled back, typed in, or sent.
  - `R1-mobile-native-08` **Shake to Remix #4821** — Shake your phone and the whole scene remixes (lights, materials, backdrop, palette), morphing smoothly into a new look with a shareable seed chip like 'Remix #4821'.

<a id="c063"></a>
### C063 · Paint by Any Name (Party Palette)
**Strong** · mean 3.4 (E4 P3 A3 Pr3 M4) · effort S · DOM/CPU (ships on v9 today) · rides none

'Make carbon hotpink' or 'party mode': any CSS colour recolours an element and the palette can hue-cycle, fixing the hsl()-to-grey bug on the way.

- **Summary:** Problem: element colours can't be customised, and synthesized hsl() colours render grey. Solution: math/color parses any CSS colour ('make carbon hotpink'), 'party mode' hue-cycles the 1 KB palette in HSL, and the hsl()-to-grey bug and sRGB-space colormap lerps get fixed. A palette-texture upload, so no shader change. Desktop and phone.
- **Tech:** math/color fromColorInput (wrap the null return), hsl.offset/lerp, colorspace.srgbToLinear; palette DataTexture upload; mood-bus hue offset on v10
- **Judges:**
  - E 4/keep: The hsl() grey bug is real: synthesised element colours are hsl() strings fed to hexToRgb. The fix is a 1 KB palette upload with fromColorInput (which returns null on bad input). *Improve:* Land the hsl bug fix as its own v9 PR now, and add the party hue-cycle as a mood-bus uniform on v10.
  - P 3/keep: 'Make carbon hotpink' and party mode get an instant laugh from kids and fix a real bug cheaply, but typed commands aren't discoverable. *Improve:* Offer colour swatches you drag onto an atom to recolour its element.
  - A 3/keep: Fixing the hsl-to-grey bug and lerping in linear light is real colour quality. Party hue-cycling destroys what element colour means and looks cheap. *Improve:* Keep custom element colours with a 'custom palette' badge, and drop party hue-cycling.
  - Pr 3/keep: Fixes the hsl-to-grey bug and gives playful recolouring on v9, but party mode can confuse students about CPK conventions. *Improve:* Show a 'custom colours' badge while non-standard colours are active, and reset them on molecule switch.
  - M 4/keep: Size S, ships on v9, and fixes a real bug that renders colours grey. Letting users choose colours helps colour-blind users. Party-mode hue cycling must stay slow. *Improve:* Ship colour-blind-safe presets (Okabe-Ito) through the same path, and cap the cycle speed.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-04` **Paint by Any Name (Party Palette)** — 'Make carbon hotpink' or 'party mode': math/color parses any CSS color and hue-cycles the 1 KB element palette in HSL, fixing the hsl()→grey bug and the sRGB-space colormap lerps on the way.

<a id="c064"></a>
### C064 · Fogged Lens You Can Wipe
**Rework** · mean 3 (E3 P4 A3 Pr2 M3) · effort S · [GPU+GL2] · rides R6

In the Cryo look the view mists over with seeded frost; wipe a clear window with your finger and watch the frost creep back from its cell edges.

- **Summary:** Problem: the Cryo look is static. Solution: the view mists over with seeded Worley frost; wipe a clear window onto the molecule and the frost creeps back from its cell edges. A screen-space pass (the filter shell is BackSide only), post-only. Desktop: wipe with the cursor. Phone: finger wipe.
- **Tech:** math/noise worley2d/fbm/domainWarp2 baked in requestIdleCallback; wipe mask in a ping-pong render target; TSL fullscreen Fn in useRenderPipeline
- **Judges:**
  - E 3/keep: A cheap post pass plus a ping-pong mask, but the frost 'creeping back' is continuous animation that fights demand mode, and the toy only exists inside one look. *Improve:* Run the regrowth as a bounded, low-fps scheduler job that ends via onIdle once the frost is restored.
  - P 4/keep: Fogged glass is a natural affordance (everyone wipes it), and frost creeping back is lovely juice. As pitched, it's trapped inside the Cryo look. *Improve:* Use it as a reveal: a new molecule or the daily mystery arrives behind frost you wipe away (pairs with C088).
  - A 3/keep: Wiping frost with a finger and watching it creep back from Worley cell edges is tactile and beautiful, but it lives inside one look. *Improve:* Make the wipe a general 'breathe on the glass' interaction for any cold look, kept outside all captures.
  - Pr 2/park: A novelty that only works in the Cryo look. *Improve:* Only if Cryo becomes a top Look.
  - M 3/keep: The finger wipe is tactile phone fun. But it exists only in the Cryo look, collides with orbit drag, and ping-pongs render targets while wiping. *Improve:* Add a Wipe chip mode, and a 'clear' button for keyboard users.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-06` **Fogged Lens You Can Wipe** — In the Cryo look the view mists over with seeded Worley frost. Wipe a clear window onto the molecule with your finger and watch the frost creep back from its cell edges.

<a id="c065"></a>
### C065 · Comet Tails
**Strong** · mean 3.4 (E3 P3 A4 Pr4 M3) · effort S · [GPU+GL2] · rides R6

During a trajectory, tap any atom and it paints a glowing, tapering comet tail of where it has really been.

- **Summary:** Problem: in trajectories it is hard to see where an atom has been. Solution: tap an atom during playback and it paints a glowing, tapering tail of its real past positions, unwrapped across periodic boundaries. Real trajectory data, so it's honest. Desktop and phone; a few tails at a time.
- **Tech:** drei 11 Trail (WebGPU version; runtime-verify) or a TSL line strip from frame history; wrapDelta unwrap; GPU ID pick for taps; optional bloom
- **Judges:**
  - E 3/keep: It uses honest trajectory data, but WebGPU has no wide lines, so tapering glowing tails need ribbon geometry. drei 11 Trail is runtime-unverified. *Improve:* Build tails as camera-facing ribbon strips from a small frame-history ring buffer, with no dependency on drei Trail.
  - P 3/keep: Painting comet tails with a tap during playback is honest and pretty, but it only works on trajectories. *Improve:* Auto-attach tails to the fastest atoms when playback starts, so players see them without tapping.
  - A 4/keep: Tapering, glowing tails of real past positions are honest and beautiful, and they make MD motion legible. *Improve:* Taper and fade the tails in linear light using the element colour, and cap the bloom so they read as paths, not lightsabers.
  - Pr 4/keep: Uses real trajectory data, so it is honest, and it fixes a reachability gap: today only annotated atoms get trails, which phones can't reach. drei Trail still needs runtime verification. *Improve:* Ship tap-to-trail on v9 now with the existing AtomTrails, then port it.
  - M 3/keep: Honest, because it draws real trajectory data. But trajectories are niche for newcomers, and drei 11 Trail is unverified. *Improve:* Use the TSL line strip, and select atoms with GPU picking using a finger-sized read.
- **Round-1 ideas merged here:**
  - `R1-r3f-sweep-09` **Comet Tails** — During a trajectory, tap any atom and it paints a glowing, tapering comet tail of where it has really been.

<a id="c066"></a>
### C066 · Matcap Bake
**Strong** · mean 3.5 (E– P2 A4 Pr3 M5) · effort M · [GPU+GL2] · rides R3, R5, R6

Render an expensive look once onto a single sphere, then let millions of atoms and every phone wear it for the price of one texture fetch.

- **Summary:** Problem: expensive looks don't scale to millions of atoms or to phones. Solution: render the look once onto a single lit sphere in a render target, then every atom samples it by its analytic normal, one texture fetch each. It also gives the billion-atom block a look. A strong phone default; desktop gets it at any scale.
- **Tech:** v10 useRenderTarget; pmremTexture IBL for the bake; TSL texture() at a matcap UV from the R3 impostor normal; compileAsync prewarm
- **Judges:**
  - P 2/merge: Matcap baking is an implementation trick for looks at scale, not something a player sees. Merge into C048. *Improve:* Make it C048's path for phones and large scenes.
  - A 4/keep: Baking an expensive look once and sampling it per atom is the smartest route for premium looks to reach phones and billions of atoms. But matcaps lock the lighting to the view. *Improve:* Rebake on every light or look change so Light Painter still works, and composite depth-based AO so contact between atoms isn't lost.
  - Pr 3/keep: An enabler that brings rich looks to phones and huge scenes for one texture fetch per atom. *Improve:* Use it as the phone implementation of the top 3 Looks.
  - M 5/champion: One texture fetch per atom is how premium looks reach phones, the GL2 fallback and million-atom scenes. *Improve:* Wire it into C004's ladder as the automatic phone and large-scene tier for every Look, baked when the Look is switched.
- **Round-1 ideas merged here:**
  - `R1-looks-12` **Matcap Bake** — Render an expensive look once onto a single sphere, then let millions of atoms (and every phone) wear it for the price of one texture fetch.


## Scan/particles

<a id="c067"></a>
### C067 · Touch the Scan Cloud: Poke, Stir, Slosh, Shake
**Strong** · mean 3.6 (E3 P4 A4 Pr4 M3) · effort M · [GPU] · rides R12 (shared device; TSL port would reach GL2, inference)

The 30k-120k particles that form your photographed object become touchable: a finger ploughs through them, taps punch craters, tilting sloshes them, and shaking explodes and reassembles them.

- **Summary:** Problem: /scan's particle reconstruction is look-only. Solution: pointer rays feed the gist compute step: a finger ploughs or stirs, taps punch shockwave craters that reform, tilting sloshes loose particles, shaking explodes them before they reassemble bottom-up, and dragging empty space orbits with inertia. Works on the no-camera demos. Desktop: mouse. Phone: finger plus DeviceMotion.
- **Tech:** vgpu 0.4.0 gist-step.wgsl pointer forces today; v10 TSL compute port on the main canvas device (brief rank 7); math mat4.lookAt/perspectiveZO/invert into scratch; spring.damp/dampAngle; DeviceMotion
- **Judges:**
  - E 3/keep: Pointer forces in gist-step.wgsl are a small change and very fun, but the feature is [GPU]-only via vgpu (it degrades to swirl/CSS), and iPhone acceptance of maxStorageBuffersInVertexStage is unverified. *Improve:* Device-test the iPhone limit first, then add pointer forces to the existing vgpu kernel before any TSL port.
  - P 4/keep: Stirring 60k particles with a finger is a proven web toy, and it makes /scan tactile. It's [GPU]-only and the iPhone limits are unverified. *Improve:* Open the no-camera demo straight into this touch mode, so /scan is fun before anyone grants camera access.
  - A 4/keep: The richest particle effect becomes touchable. Ploughing through and reassembling 100k particles is spectacular on WebGPU. *Improve:* Tune the forces and the reassembly with the shared motion and condensation tokens, so /scan feels like the same product as the viewer.
  - Pr 4/keep: /scan is linked from home, and its particle cloud is the richest effect in the repo with no input at all. Touch turns it into a toy, but today it is WebGPU-only and the iPhone storage-buffer limit is unverified. *Improve:* Test the iPhone limit on a device first, then ship pointer forces in vgpu now.
  - M 3/keep: Touchable scan particles are great phone fun. But today's vgpu path is GPU-only with an unverified iPhone limit, and tilt and shake need permission. *Improve:* Do the TSL compute port so it runs on GL2 and on iPhones without requiredLimits, keeping the CSS fallback.
- **Round-1 ideas merged here:**
  - `R1-mobile-native-16` **Poke, Slosh and Shake the Scan Cloud** — The richest effect in the repo, 30k-120k particles forming your photographed object, becomes touchable: your finger ploughs through it, tilting sloshes it, and shaking explodes it before it reassembles bottom-up.
  - `R1-first-30s-18` **Stir the Scan Cloud** — On /scan and its no-camera demos, your finger finally touches the particles: drag through the reconstructed banana and it smears and reforms, tap for a shockwave, and drag empty space to orbit it.
  - `R1-math-sweep-15` **Poke and Grab the Particle Cloud** — The /scan particle stage finally responds. Drag to spin it with inertia, poke a crater that fizzes back, tilt the phone to slosh the loose particles, all on math's WebGPU (ZO) matrices.

<a id="c068"></a>
### C068 · Doodle to Particles
**Rework** · mean 3.2 (E3 P4 A3 Pr3 M3) · effort M · [GPU] · rides R12

On /scan, draw any shape with your finger and 60k particles swirl into a puffy 3D version of your doodle, with no photo, no HF_TOKEN and no network.

- **Summary:** Problem: /scan needs a camera, HF_TOKEN and network. Solution: draw any shape and 60k particles swirl into a puffy, inflated 3D volume of the doodle, fully on-device, reusing the scan pipeline's volume builder. Desktop: draw with a mouse. Phone: draw with a finger. A no-network demo of the scan magic.
- **Tech:** math polygon2.containsPoint/signedDistance, triangulatePolygon2, curl2/simplex2d; core gist buildVolume/largestComponent/setVolume; vgpu engine today, TSL compute port later
- **Judges:**
  - E 3/keep: Reusing buildVolume with verified polygon2 signedDistance and triangulatePolygon2 is cheap, and it needs no network. It stays [GPU] through vgpu. *Improve:* Give it a CPU-swirl or CSS degrade matching /scan's, so GL2 users still get a doodle result.
  - P 4/keep: Draw anything and watch particles inflate it: instant creative magic with no network, though it drifts away from molecules. *Improve:* End each doodle by collapsing it into a molecule of similar shape, to keep the Lupi tie.
  - A 3/keep: A doodle inflated into a particle volume is a charming no-network demo of the scan magic, though the puffy volume can look blobby. *Improve:* End by resolving the doodle's particles onto a suggested real molecule, which keeps it on message.
  - Pr 3/keep: Makes /scan demoable without camera, network or HF_TOKEN, but the doodle never becomes a molecule, so it is cut off from the product's purpose. *Improve:* End each doodle with a match to a real molecule ('your doodle looks like benzene').
  - M 3/keep: A no-network, draw-with-your-finger demo is native to phones, but it inherits the gist engine's GPU-only path and the iPhone limit risk. *Improve:* Ship it on the TSL port, with a 2D canvas fallback of the inflated doodle.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-11` **Doodle to Particles** — On /scan, draw any shape with your finger and 60k particles swirl into a puffy 3D version of your doodle, with no photo, no HF_TOKEN and no network.

<a id="c069"></a>
### C069 · Made-Of: Your Object Dissolves into Its Molecules
**Rework** · mean 3.2 (E2 P4 A4 Pr4 M2) · effort L · [GPU] · rides R12

After /scan identifies your banana or mug, its particle cloud or soft Gaussian-splat reconstruction peels into streams that settle into the real molecules it is probably made of.

- **Summary:** Problem: /scan names materials, but the leap from object to molecules is a cut. Solution: after identification the object, as the particle cloud or as a soft Gaussian splat on WebGPU, peels into streams that settle into the real molecules it is probably made of, labelled 'probably'. While waiting, swipe to scatter the cloud. Desktop and phone; demo mode works without HF_TOKEN.
- **Tech:** gist engine re-homing (vgpu WGSL, TSL port later); r186 GaussianSplat (WebGPU; CPU sort on GL2) + CountingSort; /v1/scan/identify + reconstruct; vgpu initFromDevice to share the device (unverified)
- **Judges:**
  - E 2/park: GaussianSplat is WebGPU-only in r186, it needs HF_TOKEN and reconstruction latency, and device sharing via initFromDevice is unverified. It is L effort for a demo-mode moment. *Improve:* Park it; if revisited, re-home the existing particle cloud onto molecule positions without splats.
  - P 4/keep: 'Your banana is made of these' is the best narrative payoff in /scan and material to show a friend. It depends on HF_TOKEN, is [GPU], and device sharing is unverified. *Improve:* Make the no-token demo the default showcase, so every visitor sees one object dissolve.
  - A 4/keep: An object dissolving into the molecules it is made of tells the brand story in one shot. It is [GPU]-bound and depends on HF_TOKEN. *Improve:* Land the streams with C030's condensation choreography straight into the real viewer, and design a GL2 path on the swirl fallback.
  - Pr 4/keep: The object-to-molecules payoff is the strategic heart of /scan, but animating the object into molecules makes an inference look like evidence. *Improve:* Show candidates as labelled 'probably contains' choices, and keep the dissolve clearly illustrative, with provenance.
  - M 2/park: GPU-only splats, HF_TOKEN and a long chain of unverified pieces, all for one transition. *Improve:* Prove a plain particle re-home (C067) before any splats.
- **Round-1 ideas merged here:**
  - `R1-playful-science-13` **Made-Of Stream** — After /scan identifies your banana or coffee mug, its particle cloud peels into streams that settle into the real molecules it's (probably) made of. While you wait, you can swipe through the cloud to scatter it.
  - `R1-r3f-sweep-20` **Splat Yourself** — Photograph your coffee mug and watch it appear as a soft, photoreal 3D Gaussian splat, then dissolve grain by grain into the molecules it's made of.

<a id="c070"></a>
### C070 · Atomize Me
**Rework** · mean 3.4 (E4 P4 A3 Pr2 M4) · effort M · DOM/CPU (ships on v9 today) · rides none

Turn a selfie, a doodle, your pet or a QR code into a 3D atom mosaic on-device, then orbit it, sticker it, or share it as a real Lupi view.

- **Summary:** Problem: visitors have no personal way in. Solution: turn a selfie, doodle, pet photo or QR code into a 3D atom mosaic on-device (a browser port of atomize-media), orbit it, sticker it, or share it as a real Lupi view whose QR scans back to Lupi. At 5k atoms or fewer it fits inline-XYZ saved views with no new storage. Desktop and phone.
- **Tech:** browser port of tools/atomize-media.mjs in a Web Worker; OffscreenCanvas; qrcode npm; mulberry32 dither; renders through the normal impostor path
- **Judges:**
  - E 4/keep: A worker port of an existing tool, with OffscreenCanvas, rendering through the normal impostor path and fitting inline-XYZ saved views. It is a personal hook with no new rendering risk. *Improve:* Cap it at 5k atoms and keep all processing on-device, with an explicit 'nothing uploaded' note for selfies.
  - P 4/keep: A selfie as an atom mosaic is personal and very shareable, runs on-device and ships on v9. The camera permission is a hurdle. *Improve:* Offer 'draw something or pick an emoji' before asking for the camera.
  - A 3/keep: A selfie turned into an atom mosaic is personal and shareable, but pixel mosaics are a familiar effect and can look low-fi. *Improve:* Render the mosaics in the Illustrate look with depth relief, so they read as Lupi specimens.
  - Pr 2/park: Viral, but it makes non-molecular atom mosaics saved as 'real Lupi views', spreads content derived from faces, and is off-mission. *Improve:* If ever built, label it 'art made of atoms' and never save it as a structure view.
  - M 4/keep: It runs on-device and renders through the normal impostor path on every device, which makes it a strong personal hook. But selfies in public views are PII. *Improve:* Keep atomized selfies private by default, and let QR codes encode only Lupi URLs.
- **Round-1 ideas merged here:**
  - `R1-social-creator-10` **Atomize Me** — Turn a selfie, a doodle, your pet or a QR code into a 3D atom mosaic on-device, then orbit it, sticker it, or share it as a real Lupi view whose QR actually scans back to Lupi.

<a id="c071"></a>
### C071 · GPU Twins of math/noise with Shared Seeded Tables
**Parked** · mean 2 (E2 P2 A2 Pr2 M2) · effort L · mixed · rides R11, R12

Port simplex, curl and the analytic spring step to TSL and WGSL, fed the same seeded tables math builds on the CPU, so particles can ride a finger-stirred curl wake and CPU tests match the GPU.

- **Summary:** Problem: CPU math noise and GPU particle noise disagree, and gist particles can't follow a finger-stirred field. Solution: TSL (and WGSL for vgpu) ports of simplex, curl and the analytic spring step, fed the same seeded permutation tables math builds on the CPU; 400k particles ride a curl wake you stir with a finger, and CPU tests match GPU readbacks. Foundation for every particle toy.
- **Tech:** math/noise Permutation tables as uniform/storage buffers; TSL Fn ports of simplex3d/4d, curl3, spring step; vgpu WGSL twins; readback tests in the R11 SwiftShader lane
- **Judges:**
  - E 2/park: TSL already ships mx_noise/hash. CPU-GPU bit parity is unattainable with float trig anyway, and the fun layer is outside deterministic export, so parity buys little. *Improve:* Only port curl3 to TSL when a specific particle toy needs it, and test visual equivalence rather than readback equality.
  - P 2/park: Plumbing for particle toys with no moment a player sees directly. *Improve:* Build only the curl-wake piece, and only when C067 needs it.
  - A 2/park: Useful plumbing for CPU/GPU consistency, but it has no visible payoff on its own. *Improve:* Build only the curl and spring twins, and only when a particle toy needs them.
  - Pr 2/park: Premature infrastructure with only one consumer; L effort. *Improve:* Build it only when two particle toys need GPU noise.
  - M 2/park: Useful for parity tests but invisible to users, and needed only once particle toys land. *Improve:* Build only the kernels a shipped toy needs, and test them in the R11 lane.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-20` **GPU Twins of math/noise with Shared Seeded Tables** — Port simplex, curl and the analytic spring step to WGSL and TSL, fed the same seeded permutation tables math builds on the CPU. 400k gist particles can then ride a curl-noise wake you stir with a finger, and CPU tests match the GPU field.


## Science toys

<a id="c072"></a>
### C072 · Honest Thermometer
**Champion** · mean 4.4 (E4 P4 A4 Pr5 M5) · effort S · DOM/CPU (ships on v9 today) · rides none

Turn the frame slider on Lupi's real LAMMPS melt, quench and sinter runs into a draggable thermometer that marks the real melting line and warms atoms to blackbody colour.

- **Summary:** Problem: Lupi's real melt, quench and sinter runs hide behind a frame slider. Solution: the slider becomes a draggable thermometer marking the real melting line; atoms warm to blackbody colour through the palette texture, and a tick fires as you cross Tm. Real data, no invented motion. Ships on v9 today. Desktop: drag. Phone: thumb.
- **Tech:** math spring.update; math/color lerp in linear light + linearToSrgb; hand-written Planck -> CIE -> sRGB LUT (800-2000 K); existing palette-texture upload; trajectory metadata
- **Judges:**
  - E 4/keep: It uses real LAMMPS data, a palette-texture blackbody and v9 shipping, with no invented motion. The palette is per-type, so the colour is global per frame, which is honest. *Improve:* Add a scheduler-free per-frame palette upload only when the temperature bucket changes, rather than every frame.
  - P 4/keep: The frame slider becomes a thermometer with blackbody glow and a tick at the real melting point: honest data turned into a toy, S effort and on v9. *Improve:* Let players drag the thermometer on the scene itself (vertical drag on empty space) instead of a slider.
  - A 4/keep: Real melt and quench data with blackbody colour and a thermometer is honest, gorgeous, and ships on v9. *Improve:* Blend blackbody colour over element colour so atom identity survives, and give the melting-line marker a detent.
  - Pr 5/champion: Turns Lupi's real LAMMPS runs (cu_melt, cuzr_melt, cu_sinter already ship) into a draggable thermometer. Honest, small, ships on v9, and it beats PhET's toy simulations by using real data. *Improve:* Cite the source of Tm, and label the blackbody tint as a temperature colour map, not emission.
  - M 5/champion: Real data, size S, ships on v9. A thermometer slider is naturally operable by keyboard and screen reader. *Improve:* Add aria-valuetext such as '1358 K, melting', and a phase label that doesn't rely on blackbody colour.
- **Round-1 ideas merged here:**
  - `R1-playful-science-01` **Honest Thermometer** — Turn the frame slider on Lupi's real LAMMPS melt, quench and sinter runs into a thermometer you can drag. It marks the real melting line, warms the atoms to their blackbody colour, and ticks when you cross Tm.

<a id="c073"></a>
### C073 · Pluck a Molecule
**Champion** · mean 4.2 (E4 P5 A4 Pr4 M4) · effort M · [GPU+GL2] · rides R3, R4

Tap an atom and the molecule rings along a real computed normal mode while you hear that mode's true frequency lowered exactly 37 octaves.

- **Summary:** Problem: vibrational spectra are abstract. Solution: tap an atom and the molecule rings: it vibrates along a real precomputed GFN2-xTB normal mode (display offsets) while you hear that mode's frequency transposed down exactly 37 octaves, so the chord is its real spectrum. Mode shapes are baked offline. Desktop and phone; sound opt-in.
- **Tech:** offline xtb 6.x normal modes per gallery entry; Web Audio oscillators (8-voice cap); useBuffers mode vectors x uniform amplitude in the R3 positionNode; R4 bonds follow
- **Judges:**
  - E 4/keep: Precomputed xtb mode vectors times an amplitude uniform in the positionNode are cheap and honest, and the 37-octave transposition lands IR modes around audible pitch. The cost is an offline baking pipeline for each gallery entry. *Improve:* Bake modes for 10-20 hero molecules first and store them as a compact per-atom half-float mode buffer.
  - P 5/champion: Tap, and the molecule rings in a real normal mode while you hear its real spectrum: science and juice in one natural verb. It needs offline baking per gallery entry, and sound is opt-in. *Improve:* Make it the default tap response on baked gallery molecules, fall back to C028's ripple elsewhere, and flash one tiny fact about the mode you just heard.
  - A 4/keep: Real normal modes make a ringing molecule both beautiful and true. Motion that is data is the ideal kind of fun. *Improve:* Show the amplitude exaggeration explicitly (an 'xN' chip), and ease modes in and out on the shared kernel.
  - Pr 4/keep: Hearing a molecule's real normal modes is unique and honest. Baking the xtb modes, though, makes Lupi the publisher of computed results, which needs a provenance manifest. *Improve:* Ship for the 12 curated molecules with a versioned modes manifest (method, version, frequency scaling) shown under Learn.
  - M 4/keep: Real normal modes plus sound make an audio-first toy that blind users can also enjoy. Tap is contested by the ripples. *Improve:* List the modes as keyboard-reachable buttons, and settle tap ownership with a Pluck mode or long-press.
- **Round-1 ideas merged here:**
  - `R1-playful-science-03` **Pluck a Molecule** — Tap an atom and the molecule rings. It vibrates along a real computed normal mode while you hear that mode's true frequency lowered exactly 37 octaves, so the molecule's chord is its real spectrum.

<a id="c074"></a>
### C074 · Snap & Build (and the Bond-Snap Speedrun)
**Rework** · mean 3.2 (E3 P4 A3 Pr3 M3) · effort L · [GPU+GL2] · rides R3, R4, R6 (ID pick)

Drag atoms out of the element chips and they magnet-snap onto open bonding spots; fill every valence and Lupi names what you made, or race to snap a burst molecule back together.

- **Summary:** Problem: building molecules needs expert tools. Solution: drag atoms from element chips and they magnet-snap onto open valence sockets with a springy click; when valences fill, Lupi names the result and relaxes it into the real 3D molecule (MMFF94). Speedrun mode bursts a molecule into loose atoms to snap back against your splits. Desktop: drag. Phone: tap-tap placement where drag is unreliable.
- **Tech:** lazy openchemlib 9.25 ForceFieldMMFF94 + ConformerGenerator; math spring3, quat.rotationTo sockets, mulberry32 challenges; v10 pointerMap/interactivePriority; offsets via useBuffers
- **Judges:**
  - E 3/keep: Valence sockets via quat.rotationTo are verified, but it needs a lazily loaded openchemlib MMFF94, and drag-and-drop on touch is unreliable. The UX is hard to get right. *Improve:* Start with tap-tap placement on both platforms and relax only on 'done', not continuously.
  - P 4/keep: Magnet-snapping atoms into sockets with a springy click is LEGO-grade satisfaction, and the speedrun gives a replay loop. It's L effort, and drag is unreliable on phones. *Improve:* Launch the speedrun straight from C030's burst ('snap it back') before building the full builder.
  - A 3/keep: Magnet snapping with springy clicks is satisfying, but always-visible socket markers would clutter the specimen. *Improve:* Show open valence sites as subtle ghost dots only while an atom is being dragged.
  - Pr 3/rework: Building molecules is what students want, but PhET's Build a Molecule already owns it, the scope is L, and the MMFF relaxation is computation that needs labelling. *Improve:* Scope it to tap-tap builds of small molecules that resolve to a real gallery or PubChem entry, and drop the speedrun.
  - M 3/keep: Tap-tap placement is the right call for phones, but the idea is size L with a heavy openchemlib lazy load. *Improve:* Make tap-tap the primary input everywhere, which also makes it keyboard-operable, and run the relaxation only on demand.
- **Round-1 ideas merged here:**
  - `R1-playful-science-04` **Snap & Build** — Drag atoms out of the element chips and they snap onto open bonding spots with a springy magnetic click. When every valence is filled, Lupi names what you made and morphs your build into the real 3D molecule.
  - `R1-games-15` **Build It: Bond-Snap Speedrun** — The molecule bursts into loose atoms. Drag each one back beside a partner and feel it magnet-snap home. Beat your splits, and the finished puzzle is exactly your file.

<a id="c075"></a>
### C075 · VSEPR Balloons
**Parked** · mean 3 (E3 P3 A3 Pr2 M4) · effort M · [GPU+GL2] · rides none

Add bonds and lone pairs to a central atom and watch the electron domains shove each other into tetrahedra and bipyramids like tied balloons.

- **Summary:** Problem: VSEPR geometry is memorised, not felt. Solution: add bonds and lone pairs to a central atom and watch the electron domains shove each other like tied balloons into tetrahedra and bipyramids (Thomson-style repulsion), then check the model angle against a real molecule measured from its coordinates. Fewer than 10 meshes, so any device.
- **Tech:** math quickhull3, vec3, quat, spring3.update, mulberry32/random.vec3; CPU repulsion step; under 10 MeshPhysicalNodeMaterial meshes
- **Judges:**
  - E 3/keep: Fewer than 10 meshes, so it's any-device cheap, and Thomson repulsion on the CPU is trivial. It is a separate mini-scene, with little reuse of the viewer. *Improve:* Render the domains in the main canvas as a Look-free overlay scene under demand, instead of a separate route.
  - P 3/keep: Balloons shoving themselves into tetrahedra is cute and tactile, but it's a classroom lesson more than a toy for strangers. *Improve:* Let players pop a lone-pair balloon and watch the shape snap to a new geometry.
  - A 3/keep: Balloon electron domains are a clear, attractive teaching image, but for a narrow audience. *Improve:* Render the domains as translucent OIT lobes in the same glass language as the filter shell.
  - Pr 2/park: PhET's Molecule Shapes does exactly this, so it adds little differentiation. *Improve:* Fold only the 'compare with the real measured angle' twist into Learn.
  - M 4/keep: Fewer than 10 meshes, so it runs on any device, and add-bond / add-lone-pair buttons make it keyboard-accessible by nature. *Improve:* Announce the geometry name and bond angle via aria-live as the domains settle.
- **Round-1 ideas merged here:**
  - `R1-playful-science-05` **VSEPR Balloons** — Add bonds and lone pairs to a central atom and watch the electron domains shove each other into tetrahedra and bipyramids like tied balloons. Then check the model's angle against a real molecule measured from its coordinates.

<a id="c076"></a>
### C076 · Mirror, Mirror (Chirality)
**Strong** · mean 3.2 (E4 P3 A3 Pr3 M3) · effort M · [GPU+GL2] · rides R3

Pull a mirror twin out of any molecule and try to twist it onto the original, or call 'same' or 'mirror' on two copies: achiral pairs click together, chiral ones never fit.

- **Summary:** Problem: chirality is hard to grasp. Solution: pull a mirror twin out of any molecule and try to rotate it onto the original, or play 'same or mirror?' rounds. Achiral pairs click together via a Horn/Kabsch fit; chiral ones never fit, and a mirror plane sweeps through in the reveal. Desktop: drag each copy. Phone: two thumbs rotate both at once.
- **Tech:** math quat slerp/fromMat3/getAngle, mat3; hand-written Horn/Kabsch (~80 lines); second impostor instance with a mirror-transform uniform; v10 pointerMap + interactivePriority; optional openchemlib CIP
- **Judges:**
  - E 4/keep: Drawing the same buffers twice with a mirror-matrix uniform is cheap, and a Horn/Kabsch fit is about 80 lines. It is great science that plays. *Improve:* Run the fit only on release, and snap achiral pairs with quat.slerp for the 'click'.
  - P 3/keep: The 'hands don't fit' chirality puzzle is clever, but rotating two copies is fiddly on a phone and can frustrate. *Improve:* Lead with the quick 'same or mirror?' guess round and make the fitting attempt optional.
  - A 3/keep: The mirror-plane sweep is a nice visual beat, but the game itself is niche. *Improve:* Make the mirror plane an actual reflective surface in the scene for the reveal.
  - Pr 3/keep: Chirality is a hard, important concept, and the Kabsch click is a satisfying reveal. M effort. *Improve:* Attach it to specific real chiral molecules from the Library, with observation prompts.
  - M 3/keep: A good concept, but rotating two copies with two thumbs is hard on phones and has no keyboard path. *Improve:* Make it turn-based: rotate one copy with a flick or the keys, then tap 'Try fit'.
- **Round-1 ideas merged here:**
  - `R1-playful-science-07` **Mirror, Mirror (chirality challenge)** — Pull a mirror twin out of any molecule and try to twist it onto the original. Achiral molecules click together; chiral ones never fit, just like your hands.
  - `R1-games-09` **Mirror, Mirror** — Two copies of a molecule; one might be its mirror image. Rotate them, swipe 'same' or 'mirror', and in the reveal one slerps onto the other, or a mirror plane sweeps through if they can never match.

<a id="c077"></a>
### C077 · Atom Recycler and Kitchen Alchemy
**Rework** · mean 3.2 (E3 P3 A4 Pr3 M3) · effort L · [GPU+GL2] · rides R2, R3, R4

Pick a real reaction and watch every reactant atom fly to its seat in the products while an atom ledger ticks 'balanced'; unbalance it and the leftovers bounce around glowing red.

- **Summary:** Problem: balanced equations feel like bookkeeping. Solution: pick a real, cited reaction (burning methane, respiration, fermentation, ethanol plus acetyl chloride) and watch every reactant atom fly to its seat in the products as a ledger ticks 'balanced'; unbalance it and leftover atoms bounce glowing red. A recipe book of curated reactions to discover. Desktop and phone.
- **Tech:** curated balanced reactions; hand-written Hungarian atom mapping; math curl3, vec3.hermite paths, spring3, easing; from/to useBuffers + per-atom delay kernel (transform feedback on GL2); R2 glow flag
- **Judges:**
  - E 3/keep: No transform-feedback compute is needed: v9 already interpolates from/to by uProgress, and a per-atom delay attribute makes it closed-form. The work is in curation and Hungarian mapping. *Improve:* Implement the flight as uProgress plus a per-atom delay attribute and a Hermite arc in the positionNode, with no compute pass.
  - P 3/rework: Watching atoms fly to their seats is satisfying but mostly passive, and the 'recipe book to discover' is buried. *Improve:* Make it Little-Alchemy style: drag one molecule onto another to discover real reactions and unlock recipe cards.
  - A 4/keep: Atoms flying to their seats is a choreography showpiece that makes conservation visible. *Improve:* Use the condensation tokens with Hermite arcs, so it moves like every other Lupi transition.
  - Pr 3/rework: The atom ledger is honest bookkeeping, but atoms flying between seats reads as a reaction mechanism, and the contract forbids presenting that as mechanistic evidence. L effort. *Improve:* Label it 'atom bookkeeping, not mechanism' and cite a source for each reaction.
  - M 3/keep: The atom ledger is text and screen-reader friendly, and curated reactions keep it honest. But it is size L, with Hungarian atom mapping and a transform-feedback path on GL2. *Improve:* Start with three or four reactions and precomputed mappings, and use a crossfade under reduced motion.
- **Round-1 ideas merged here:**
  - `R1-playful-science-08` **Atom Recycler** — Pick a real reaction (burning methane, your cells burning glucose, yeast making ethanol) and watch every reactant atom fly to its seat in the products. Unbalance the equation and the leftover atoms bounce around glowing red.
  - `R1-games-18` **Kitchen Alchemy** — Drop ethanol onto acetyl chloride and watch them swirl into ethyl acetate plus HCl, with an atom ledger ticking 'balanced ✓'. Discover a recipe book of real, cited reactions and pathways.

<a id="c078"></a>
### C078 · Grow a Crystal (from a Seed or Your Name)
**Strong** · mean 3.8 (E4 P4 A4 Pr3 M4) · effort M · mixed · rides R3, R7

Plant an atom or type your name and watch a crystal grow atom by atom, from neat textbook habits to branching flakes, identical on every device that opens the link.

- **Summary:** Problem: crystals only ever appear finished. Solution: plant an atom, or type your name as the seed, and watch a crystal grow atom by atom: a kink-site model gives real habits, and a temperature knob turns them rough and branching (DLA-like). The same seed regrows the identical crystal on any device, so a link shares it. Desktop and phone; up to ~3k atoms.
- **Tech:** worker KMC/DLA over SpatialHash neighbours; math mulberry32 (integer-exact) + FNV-1a seeds; replay as a trajectory (v9) or per-atom birth time via useBuffers in the R3 positionNode/radius; demand while growing
- **Judges:**
  - E 4/keep: A worker KMC/DLA replayed via per-atom birth time is cheap on the GPU, and integer-seeded growth reproduces across devices. Capping at ~3k atoms is realistic. *Improve:* Store the birth time in the R2 flag-byte neighbour or a small float attribute, and render growth as a radius-from-birth-time uniform sweep.
  - P 4/keep: Typing your name and watching a crystal grow is personal and mesmerising, and it shares by link because it regrows identically. *Improve:* Give each new atom a tinkle and cap the growth at a satisfying ~10 s.
  - A 4/keep: Crystals growing atom by atom, from textbook habits to DLA branches, are beautiful, and the same seed regrows them anywhere. *Improve:* Add a growth-front glow (the newest atoms bright, cooling to element colour) so time reads at a glance.
  - Pr 3/keep: Seeded, name-based crystals are personal and shareable, but claiming 'real habits' from a toy KMC overclaims. *Improve:* Label it as a growth model, and end on the real crystal structure.
  - M 4/keep: Worker KMC up to ~3k atoms runs everywhere on demand frames, and seeded regrowth makes sharing cheap. *Improve:* Show growth stages as stills under reduced motion, and cap the growth steps on phones.
- **Round-1 ideas merged here:**
  - `R1-social-creator-09` **Name Crystal** — Type your name and watch a one-of-a-kind crystal grow from it, atom by atom and identical on every device. Send the link and your friend's browser regrows exactly the same flake.
  - `R1-playful-science-09` **Crystal Garden** — Plant a single atom and grow the real crystal around it, atom by atom, in the order a textbook kink-site model says crystals grow. A temperature knob turns neat cubes into rough, branching growth.

<a id="c079"></a>
### C079 · Phase Box: Heat Real Argon, Then Any Molecule
**Parked** · mean 3 (E3 P4 A3 Pr2 M3) · effort L · mixed · rides R3, R7

A box of atoms under real Lennard-Jones physics you freeze, melt, boil and stir, extended to hundreds of copies of your own molecule under a published force field.

- **Summary:** Problem: single molecules can't show phases. Solution: a box of argon running real Lennard-Jones physics; drag the thermometer to freeze, melt and boil it, stir with a finger, and save a real trajectory. Crowd Lab extends it to hundreds of rigid copies of your molecule under a published force field, comparing its boiling point with the handbook. Desktop: bigger boxes. Phone: smaller ones.
- **Tech:** CPU worker cell list + fixed-step accumulator in the scheduler physics phase; [GPU] tier: TSL compute + CountingSort binning + atomics for 20-50k atoms or rigid crowds; CPU or precomputed-clip degrade on GL2
- **Judges:**
  - E 3/keep: CPU Lennard-Jones argon at a few thousand atoms in a worker is honest and feasible, but it needs a hand-written fixed-step accumulator (scheduler 0.2.0 has none). The Crowd Lab tier is [GPU]. *Improve:* Ship the CPU argon box only, with its own accumulator in the physics phase, and defer the rigid-crowd GPU tier.
  - P 4/keep: Freezing, melting and boiling real argon by dragging a thermometer and stirring is a PhET-proven loop with honest physics. It's L effort. *Improve:* Ship the argon box with finger stirring first, before Crowd Lab.
  - A 3/keep: Real Lennard-Jones phases are honest, but visually they are plain spheres. *Improve:* Pair it with C033's blackbody heat colour and C046's depth fog so the phases read visually.
  - Pr 2/park: Live MD in the viewer drifts toward research execution, and PhET's States of Matter already owns the argon box. *Improve:* Use real precomputed runs through C072 instead of live simulation.
  - M 3/keep: Real Lennard-Jones physics is great science, but a continuous simulation heats phones. *Improve:* Cap the simulation job's fps on phones, pause it automatically when untouched, and use the thermometer slider as the control.
- **Round-1 ideas merged here:**
  - `R1-playful-science-10` **Argon Box** — A box of argon atoms running real Lennard-Jones physics. Drag the thermometer to freeze a crystal, melt it and boil it, stir it with your finger, and save the result as a real trajectory file.
  - `R1-playful-science-20` **Crowd Lab: melt any molecule** — Fill a box with hundreds of copies of your molecule and heat it. Rigid molecules jostle under a real published van der Waals force field; a scoreboard compares your toy's boiling point with the handbook's, and switching water's charges off shows why hydrogen bonds matter.

<a id="c080"></a>
### C080 · Atom Smasher
**Strong** · mean 3.2 (E3 P4 A3 Pr3 M3) · effort L · [GPU+GL2] · rides R6

Pull back a slingshot and fire a copper nanoparticle into a copper surface at a real precomputed speed; it bounces, sticks or splashes, and a damage report counts displaced atoms.

- **Summary:** Problem: collisions and cascades are invisible. Solution: pull back a slingshot and fire a copper nanoparticle into a copper surface at one of several real precomputed LAMMPS speeds; it bounces, sticks or splashes, and a damage report counts displaced atoms. Plays through existing streaming trajectories, with afterImage trails and bloom on v10. Desktop and phone.
- **Tech:** offline LAMMPS EAM Cu + ZBL runs baked with tools/bake-glimbin.mjs; streaming playback; math spring3 band, polar/vec2 slingshot; useRenderPipeline afterImage + bloom
- **Judges:**
  - E 3/keep: Precomputed LAMMPS runs on the existing streaming playback are honest and rendering-cheap. The cost is content production, and afterImage trails are safe because they aren't velocity-based. *Improve:* Bake three speeds only, and reuse C072's thermometer-style scrubber for the impact timeline.
  - P 4/keep: Pulling back a slingshot and splashing copper is Angry-Birds juice on real data, but a few precomputed speeds limit replays. *Improve:* Add a target per shot (displace about N atoms, or make it stick) so each shot has a goal.
  - A 3/keep: Precomputed LAMMPS splashes are dramatic and honest, but full-frame afterImage smears the science. *Improve:* Use C065-style comet tails on the ejected atoms instead of a full-frame afterImage.
  - Pr 3/keep: Real precomputed collisions are honest and dramatic, and a W cascade run already ships. New LAMMPS runs, though, need a named owner and publisher. *Improve:* Start with the existing sand_w_cascade run as the slingshot payoff before baking new runs.
  - M 3/keep: Precomputed LAMMPS runs keep it honest, but the trajectory downloads cost cellular data and afterImage trails are motion-heavy. *Improve:* Ship one small precomputed impact first, and respect Save-Data.
- **Round-1 ideas merged here:**
  - `R1-playful-science-11` **Atom Smasher** — Pull back a slingshot and fire a copper nanoparticle into a copper surface at one of several real, precomputed speeds. It bounces, sticks or splashes, and a damage report counts the atoms you knocked out of place.

<a id="c081"></a>
### C081 · Molecule Life
**Parked** · mean 2.4 (E3 P3 A2 Pr2 M2) · effort L · [GPU] · rides R12

Your molecule's elements become species in a seeded, stirrable Particle Life ecosystem, loudly labelled toy rules, with one tap back to reality.

- **Summary:** Problem: nothing lets visitors play with emergent behaviour. Solution: the molecule's elements become species in a seeded, shareable Particle Life ecosystem you stir with a finger, loudly labelled as toy rules, with a one-tap 'back to reality' that settles the swarm into the real molecule. WebGPU runs tens of thousands of particles; the GL2 backend degrades to a CPU worker with 1.5-2k.
- **Tech:** TSL compute + r186 CountingSort + atomic workgroup arrays [GPU]; CPU typed-array grid degrade; instanced sprite node material; mulberry32; hsl tints; per-job fps and demand when settled
- **Judges:**
  - E 3/park: Particle Life at tens of thousands needs atomics and binning ([GPU]) with a 1.5-2k CPU degrade. It is fun, but toy rules sit far from Lupi's science core. *Improve:* Revisit after C042/C067 prove main-canvas particles, and start from the CPU degrade as the baseline for both backends.
  - P 3/keep: Particle Life is hypnotic and stirrable, but it's loudly not chemistry, and it's only strong on WebGPU. *Improve:* Make 'back to reality' the climax: every session ends with the swarm collapsing into the real molecule.
  - A 2/park: Particle Life is mesmerising, but it is generic generative art in molecule colours, and 'toy rules' muddy the science. *Improve:* Offer it only as a clearly separate playground, never inside the viewer.
  - Pr 2/park: Arbitrary attraction rules between elements risk teaching wrong chemistry, most of it needs WebGPU, and it is disconnected from the product. *Improve:* Park it.
  - M 2/park: A GPU-only continuous simulation whose GL2 degrade is only 1.5-2k particles, and it heats phones. *Improve:* Revisit only once C014 has thermal data, with fps caps and auto-sleep.
- **Round-1 ideas merged here:**
  - `R1-playful-science-12` **Molecule Life** — Your molecule's elements become species in a Particle Life ecosystem that is seeded, shareable and stirrable by finger. It is loudly labelled as toy rules, with a one-tap 'back to reality' that settles the swarm into the real molecule.

<a id="c082"></a>
### C082 · Powers of Ten, in Atoms
**Rework** · mean 3.6 (E3 P4 A5 Pr3 M3) · effort M · [GPU+GL2] · rides R5, R6, R7

One pinch takes you from a single water molecule to a billion copper atoms, with honest live counters of atoms on screen, width in nanometres, and how many fit across a hair.

- **Summary:** Problem: atomic scale is invisible. Solution: one pinch travels from a single water molecule to a billion copper atoms through cluster splats and LOD tiers, with honest live counters (atoms on screen, width in nm, how many fit across a hair); stage handoffs use transition() wipes. Desktop: scroll. Phone: pinch.
- **Tech:** math frustum culling into scratch; spring.update on log distance; far-LOD cluster splats and BillionAtomBlock (R5 port); useRenderPipeline transition(); demand frameloop
- **Judges:**
  - E 3/rework: A continuous zoom across 6+ orders of magnitude needs camera-relative positions and reverse or log depth for the impostor depthNode, or it will z-fight and jitter. LOD stage handoffs are real work. *Improve:* Make the stages discrete scenes joined by transition() wipes, each with its own near/far, instead of one continuous camera.
  - P 4/keep: One pinch from a water molecule to a billion atoms uses the most natural gesture for awe, with 'how many across a hair' facts. *Improve:* Absorb C095's guess prompt at each stage so the pinch becomes a game.
  - A 5/champion: Scale is a brand pillar, and a continuous pinch from one water molecule to a billion copper atoms is the Powers-of-Ten moment Lupi can own. *Improve:* Replace the transition() wipes with continuous LOD crossfades so the dive feels unbroken, and set the counters as elegant editorial type.
  - Pr 3/keep: Scale is a classic 'aha', with honest counters, but it depends on R5 and edges back toward the retired scale-first framing. *Improve:* Frame it as a learning journey that starts from water, not as a showcase of a billion atoms.
  - M 3/keep: Honest scale counters are wonderful, but one continuous pinch through twelve orders of magnitude is a vestibular stress test. *Improve:* Move in stages (a Next-scale button and keys), with fades under reduced motion.
- **Round-1 ideas merged here:**
  - `R1-playful-science-14` **Powers of Ten, in Atoms** — One pinch takes you from a single water molecule to a billion copper atoms, with live, honest counters: atoms on screen, width in nanometres, and how many fit across a hair.

<a id="c083"></a>
### C083 · Element Personality Cards
**Folded into C094** · mean 3.2 (E3 P3 A3 Pr3 M4) · effort S · DOM/CPU (ships on v9 today) · rides none (R8 optional)

Tap an element chip and a springy card shows its personality from real numbers (greedy, chunky, heavy, aloof), with a little atom that wobbles with a weight you can feel.

- **Summary:** Problem: element data is a dry table. Solution: tap an element chip and a springy card pops up whose 'personality' is its real numbers: greedy (electronegativity), chunky (radius), heavy (mass), aloof (noble gas); its atom wobbles on a mass-scaled spring. DOM only, ships on v9; shatterable glyph symbols later. Desktop and phone.
- **Tech:** math spring2.update with smoothTime ~ sqrt(mass); math/color hsl tints; ELEMENT_DATA; DOM; optional @pmndrs/glyph split() on v10 via the R8 shim
- **Judges:**
  - E 3/keep: A DOM card on v9 with a mass-scaled spring (spring2 verified). It is cheap and charming, with no graphics risk. *Improve:* Link each card's traits to a one-tap filter in the viewer (glow all atoms of that element via C050).
  - P 3/merge: Springy personality cards are charming, but they're DOM cards: a reward rather than a toy. Merge into C094. *Improve:* Make them the stamp and reward in C094's passport.
  - A 3/keep: A wobble scaled by mass is motion that carries meaning, but the cards need real illustration quality or they read as trivia UI. *Improve:* Give the element cards one consistent illustration style tied to the Illustrate look.
  - Pr 3/keep: A cheap DOM card built on real numbers that ships on v9; cute but shallow. *Improve:* Attach it to the Elements panel chips so it appears in context.
  - M 4/keep: Size S, DOM-only, runs everywhere and reads well with a screen reader. *Improve:* Make the card a proper dialog that returns focus when closed, with the wobble static under reduced motion.
- **Round-1 ideas merged here:**
  - `R1-playful-science-15` **Element Personality Cards** — Tap any element chip and a springy card pops up whose 'personality' is its real numbers: greedy (electronegativity), chunky (radius), heavy (mass), aloof (noble gas). Its little atom wobbles with a weight you can feel.

<a id="c084"></a>
### C084 · Sink or Float
**Strong** · mean 3.6 (E3 P4 A3 Pr4 M4) · effort S · DOM/CPU (ships on v9 today) · rides none

Drop any molecule, or two as a guessing game, into a glass of water and see what a lump of the real substance does, from the handbook's measured values.

- **Summary:** Problem: property data is invisible. Solution: drop a molecule, or two as a 'which is denser?' game, into a glass of water and see what a lump of the real substance does: limonene floats, sugar dissolves in swirls, acetyl chloride fizzes because it reacts; models bob to their Archimedes depth before the measured numbers flip up. SVG/DOM on v9; a TSL water plane on v10.
- **Tech:** property-sheet.json + derived facts; math spring2/spring.update (buoyant wobble), easing; SVG + CSS today; v10 water plane as a TSL node material
- **Judges:**
  - E 3/keep: SVG/DOM on real handbook data ships on v9 with no rendering risk, but the v10 TSL water plane adds little. *Improve:* Keep it DOM-only and spend the effort on the measured-value reveal rather than a 3D water plane.
  - P 4/keep: 'Which floats?' is a quick guessing loop on real data with satisfying bobbing and fizz, and it ships on v9. *Improve:* Let the player drag the molecule into the glass instead of pressing a button.
  - A 3/keep: Bobbing to its Archimedes depth is charming and honest motion, but the SVG glass has to be well drawn. *Improve:* Reuse the landing's SVG specimen style for the lump, so it feels like the same world.
  - Pr 4/keep: Makes measured properties physical (limonene floats, acetyl chloride fizzes), ships on v9 as SVG, and rides the existing library facts and Jev property ranking. *Improve:* Cite each property's source on the card, and make 'which is denser?' shareable.
  - M 4/keep: Size S, SVG and DOM on every device, with real handbook data. A guessing game suits phones and assistive tech. *Improve:* Give the result as text (density compared with water), not only as animation.
- **Round-1 ideas merged here:**
  - `R1-playful-science-17` **Sink or Float** — Drop any molecule into a glass of water and see what a lump of the real substance does: limonene floats, sugar dissolves in swirls, acetyl chloride fizzes because it reacts. All straight from Lupi's handbook sheet.
  - `R1-games-08` **Float or Sink** — Two real substances drop into a glass of water. Call which is denser, or which boils hotter, and the models bob to their true Archimedes depth before the measured numbers flip up.

<a id="c085"></a>
### C085 · Sticky Water
**Folded into C031** · mean 3 (E3 P3 A3 Pr3 M3) · effort M · [GPU+GL2] · rides R3, R4

Pull one molecule out of a water cluster and watch its hydrogen bonds stretch like taffy and snap one by one, the reason water boils so late.

- **Summary:** Problem: hydrogen bonding is abstract. Solution: pull one molecule out of a water cluster and watch its hydrogen bonds stretch and snap one by one with a pop, explaining why water boils so late for its size. Rigid per-molecule offsets for up to 64 bodies; H-bonds as dashed guide lines. Desktop: drag. Phone: drag with per-pointer capture.
- **Tech:** SpatialHash H-bond detection; math quat/vec3/spring3.damp; v10 pointerMap; useBuffers partial rigid offsets; TSL dashed lines
- **Judges:**
  - E 3/keep: Rigid offsets for up to 64 bodies plus SpatialHash H-bond detection are cheap. WebGPU has no wide lines, so the dashed guide lines need ribbon or impostor geometry. *Improve:* Draw the H-bonds as dashed bond impostors in the R4 bond shader instead of lines.
  - P 3/merge: Snapping hydrogen bonds one by one is tactile and teaches a real idea, but it's one scene of the tug toy. Merge into C031. *Improve:* Make it C031's water-cluster level.
  - A 3/keep: H-bonds stretching and snapping is a clear visual story, but dashed lines look diagrammatic. *Improve:* Render H-bonds as thin glowing threads that brighten under strain and snap with a small spark.
  - Pr 3/keep: A great 'why water boils so late' concept, but hydrogen bonds are inferred guide lines and must not look like bond topology. *Improve:* Style hydrogen bonds visibly as 'inferred', per the contract, and cite the boiling point.
  - M 3/keep: It teaches hydrogen bonding clearly, but it is a drag-only toy with no keyboard path. *Improve:* Add a 'Pull' button that plays the same extraction.
- **Round-1 ideas merged here:**
  - `R1-playful-science-18` **Sticky Water** — Pull one molecule out of a water cluster and watch its hydrogen bonds stretch like taffy and snap one by one with a pop. That snapping is why water boils so late for such a small molecule.

<a id="c086"></a>
### C086 · Lab-in-a-Tab (GFN2-xTB on Anything)
**Killed** · mean 1.8 (E2 P2 A2 Pr1 M2) · effort XL · DOM/CPU (ships on v9 today) · rides R3

Run real quantum chemistry in a Web Worker so any small molecule a visitor builds, pulls or uploads can be relaxed and 'sung', upgrading labels from illustrative to computed.

- **Summary:** Problem: every toy must say 'illustrative'. Solution: GFN2-xTB in a Web Worker relaxes and computes normal modes for any small molecule a visitor builds, pulls or uploads, upgrading labels to 'computed'. The ~29 MB payload makes it opt-in and desktop-first. It writes real positions, so no offset issue.
- **Tech:** xtb-wasm (GPL-3.0, AGPL-compatible) + openchemlib in a worker pool; optimizer steps into useBuffers atomBase (v10) or uploadFrame (v9)
- **Judges:**
  - E 2/park: A ~29 MB GPL wasm payload, XL effort, and 'writes real positions' must still produce a derived structure, never overwrite the source. *Improve:* Park it; if revisited, frame the output as a new computed structure and load it only on explicit opt-in on desktop.
  - P 2/park: 29 MB of opt-in quantum chemistry is invisible to most players; its value is upgrading labels. *Improve:* Bake results offline for the gallery (as C073 does) instead.
  - A 2/park: It enables honest motion but has no visual payoff of its own, and it carries a ~29 MB payload. *Improve:* Revisit once C073 proves that people want computed motion.
  - Pr 1/kill: GFN2-xTB in the browser is research execution, and 'upgrading labels to computed' promotes viewer computation toward evidence. Both are outside the contract, on a 29 MB opt-in download. *Improve:* Drop it. Precompute data offline with a provenance manifest instead, as in C073.
  - M 2/park: The ~29 MB payload shuts out phones on cellular, and the effort is XL. *Improve:* Keep it opt-in and desktop-only, and only after the illustrative toys prove the demand.
- **Round-1 ideas merged here:**
  - `R1-playful-science-19` **Lab-in-a-Tab (GFN2-xTB on anything)** — Let any small molecule a visitor builds, pulls or uploads be relaxed and 'sung' by real quantum chemistry running in a Web Worker, so every toy can upgrade its label from 'illustrative' to 'computed'.

<a id="c087"></a>
### C087 · Atom Juggler
**Folded into C004** · mean 2.4 (E3 P3 A2 Pr2 M2) · effort M · [GPU+GL2] · rides R5

A 20-second opt-in toy that grows a procedural copper crystal until your device starts to sweat, then tells you how many atoms it held at full speed.

- **Summary:** Problem: 'how much can my device handle?' is a fun question nobody answers. Solution: a 20-second opt-in toy grows a procedural copper crystal until frame times drift, then reports how many atoms it held at full speed as a shareable score; it doubles as anonymous device calibration. Desktop and phone; capped to avoid heat.
- **Tech:** procedural BillionAtomBlock impostor (R5 port) with integer-hash jitter; mulberry32 seed; frame-time sampler shared with the quality ladder; Web Share files
- **Judges:**
  - E 3/keep: Feasible with the R5 billion-block port and C004's sampler, but deliberately stressing the device to 'sweat' conflicts with the phones-stay-cool goal. *Improve:* Stop at the first sustained frame-time drift (not heat), and feed the result into C004 as the device's calibration.
  - P 3/keep: 'My phone held 3.2M atoms' is a brag people share, and it doubles as calibration, but heating the device on purpose is a risk. *Improve:* Cap it at about 10 s and present the score as a shareable card.
  - A 2/park: It is a benchmark dressed up as a toy, and the visual is a growing block. *Improve:* Fold its frame-time sampler silently into C004's calibration.
  - Pr 2/merge: A benchmark-as-game that deliberately heats phones and has nothing to do with chemistry. Its calibration value belongs in C004. *Improve:* Fold the calibration into C004 and C014.
  - M 2/park: Deliberately pushing a phone until it overheats is a thermal anti-pattern, and a device-power score can shame people with low-end phones. *Improve:* Reuse C004's calibration silently instead of turning heat into a game.
- **Round-1 ideas merged here:**
  - `R1-perf-feel-16` **Atom Juggler** — A 20-second opt-in toy that grows a procedural copper crystal until your device starts to sweat, then tells you how many atoms it held at full speed.


## Games

<a id="c088"></a>
### C088 · Lupi Daily: Who's That Molecule?
**Champion** · mean 4.4 (E4 P5 A4 Pr5 M4) · effort S · DOM/CPU (ships on v9 today) · rides none (viewer reveal: R3, R4, R8)

Every visitor gets the same mystery molecule each day as a black silhouette; each wrong guess reveals more until it blooms into full colour with its name, with a spoiler-free result to share.

- **Summary:** Problem: nothing brings visitors back daily. Solution: the same mystery molecule for everyone each day as a black silhouette; each wrong guess reveals more (shading, colour, bonds) until it blooms with its name, plus a streak and a spoiler-free result. Home: a DOM/SVG card (zero canvas). Viewer: an orbitable ink silhouette revealed by mood-bus uniforms. Desktop and phone.
- **Tech:** math mulberry32 + random.choice date seed; offline silhouette SVG/PNG from build-student-previews; CSS brightness(0); v10 mood-bus inkMix/revealRadius in R3/R4 TSL; glyph split() name reveal
- **Judges:**
  - E 4/keep: The home card is a zero-canvas DOM card, and the in-viewer reveal is a trivial mood-bus inkMix once R3 exists. Strong retention for little rendering work. *Improve:* Ship the DOM/SVG daily first on v9 with offline silhouettes, and add the viewer reveal after R3.
  - P 5/champion: The only strong come-back-tomorrow loop: Wordle-shaped, with spoiler-free sharing, and home-safe DOM. The season is short (~72 guessable previews). *Improve:* Reveal the silhouette through wipeable frost (C064) in the viewer, and keep the streak visible on the home card.
  - A 4/keep: An ink silhouette blooming into colour is a great reveal and could be the daily brand moment on home. *Improve:* Render the silhouettes and the reveal in the Illustrate look, so the daily card is recognisably Lupi.
  - Pr 5/champion: A daily, spoiler-free, shareable puzzle is a proven retention loop. It ships on v9 as a zero-canvas home card, teaches molecular shape, and runs on content from the curated library. *Improve:* Have the content steward curate a 60-day queue from the source-bound previews, and make the result card the share unfurl.
  - M 4/keep: Size S and a zero-canvas daily hook on home, but a game played only by silhouette shuts out screen-reader users. *Improve:* Add a ladder of text clues (formula, a property, a use) so it can be played without sight.
- **Round-1 ideas merged here:**
  - `R1-social-creator-02` **Lupi Daily: Who's That Molecule?** — A Wordle-style daily puzzle on the home page: a black silhouette of one real molecule, three guesses with escalating hints, a streak, and a spoiler-free result to paste into the group chat.
  - `R1-games-06` **Daily Silhouette: Who's That Molecule?** — Each day one molecule appears as a black silhouette you can orbit, since turning it is the hint. Each wrong guess reveals more (shading, colour, bonds) until it blooms into full colour with its name.
  - `R1-playful-science-16` **Molecule of the Day** — Every visitor gets the same mystery molecule each day as a silhouette, and each wrong guess reveals more. It works on the zero-canvas homepage using the SVG previews Lupi already ships.

<a id="c089"></a>
### C089 · Molecule Globle
**Folded into C088** · mean 2.8 (E3 P3 A2 Pr2 M4) · effort S · DOM/CPU (ships on v9 today) · rides none

A daily hot-and-cold word game on the home page: name any molecule, and each guess glows warmer the more elements and library tags it shares with today's secret.

- **Summary:** Problem: daily play needs more than one format. Solution: a Globle-style hot-and-cold word game on the home page: name any molecule, and each guess glows warmer the more elements and library tags it shares with today's secret. DOM only, no three on the landing. Desktop and phone.
- **Tech:** math mulberry32/random.choice; math/color hsl.lerp linear-light heat ramp; library-facts.json, property-sheet.json, gallery formulas
- **Judges:**
  - E 3/keep: A DOM word game on existing facts data, cheap and safe, but not very molecular-visual. *Improve:* Reuse C088's daily seed and share format so both games live in one daily surface.
  - P 3/merge: A second daily word game splits the ritual. Merge into C088. *Improve:* Make it C088's hard mode or weekend variant.
  - A 2/park: A DOM word game with little visual identity. *Improve:* Make it an alternate mode of C088's daily card.
  - Pr 2/merge: A second daily format dilutes the ritual. Merge into C088. *Improve:* Use it as C088's hint mechanic.
  - M 4/keep: Guesses are typed text, which makes this one of the most screen-reader-friendly games here, but showing warmth only by colour is not accessible. *Improve:* Show warmth as a number or a word as well as a colour.
- **Round-1 ideas merged here:**
  - `R1-games-05` **Molecule Globle** — A daily hot-and-cold word game on the home page. Name any molecule, and each guess glows warmer the more elements and library tags it shares with today's secret.

<a id="c090"></a>
### C090 · Shadow Match
**Folded into C088** · mean 3.6 (E4 P4 A4 Pr3 M3) · effort M · DOM/CPU (ships on v9 today) · rides none

A molecule hangs in a spotlight; turn it until its shadow matches the target silhouette and it clicks into the exact pose with a spring and a chime.

- **Summary:** Problem: rotating a molecule has no goal. Solution: a molecule hangs in a spotlight; turn it until its wall shadow matches a target silhouette taken from a secret angle (IoU on a 64x64 raster), and it clicks into the exact pose with a spring and chime; share your time as a dare. Desktop: drag. Phone: drag plus a two-finger twist.
- **Tech:** math quat getAngle/slerp, random.quat, mat4.ortho CPU projection; hand-written disc raster + IoU on OffscreenCanvas; spring3; v10 pointerMap; TSL shadow-wall plane or DOM SVG
- **Judges:**
  - E 4/keep: A 64x64 CPU disc raster plus IoU is cheap, and the quat APIs are verified. mat4 has orthoNO/orthoZO, not a plain 'ortho'. It gives rotation a goal. *Improve:* Compute the IoU only at 15 Hz during drag, and snap via quat.slerp on a match.
  - P 4/keep: Turning the rotate gesture everyone already knows into a Shadowmatic-style puzzle, with a spring-and-chime click, is great feel and a shareable dare. *Improve:* Run it as a daily round next to C088 so there's a reason to return.
  - A 4/keep: Turning a molecule until its shadow matches the target is a striking, art-directable image that also teaches 3D projection. *Improve:* Stage it with a single hard spotlight on a textured wall in the Paper look, for a gallery feel.
  - Pr 3/keep: Gives rotation a goal, teaches 3D shape, ships on v9, and makes a shareable dare, but it is niche. *Improve:* Offer it as one of C088's rotating daily formats.
  - M 3/keep: Rotation with a goal is fun, but silhouette matching is purely visual, and a two-finger twist is awkward one-handed. *Improve:* Add keyboard rotation with detents, and a pitch that rises as you get closer.
- **Round-1 ideas merged here:**
  - `R1-games-07` **Shadow Match** — A molecule hangs in a spotlight. Turn it until its shadow on the wall matches the target silhouette, and it clicks into the exact pose with a spring and a chime.
  - `R1-social-creator-08` **Silhouette Match** — A one-verb angle game: you see the molecule's shadow from a secret angle, rotate the real molecule until your shadow matches, snap into place with a satisfying overshoot, and share your time as a dare.

<a id="c091"></a>
### C091 · Find the Atom: Odd Atom Out and Hide-and-Seek Links
**Strong** · mean 3.4 (E3 P4 A3 Pr4 M3) · effort S · DOM/CPU (ships on v9 today) · rides R6 (ID pick on v10)

Timed hunts to tap the right atoms, from both oxygens in caffeine to a dopant in 50k copper, plus friend-made clue links with warmer-colder pulses.

- **Summary:** Problem: exploring has no goal. Solution: timed seeded hunts ('tap both oxygens in caffeine', 'find the dopant in 50k copper', 'find the real vacancy in a nickel MD run'), plus friend-made links: pick an atom, write or generate a clue, and the seeker gets warmer-colder pulses and a brag card ('found in 3 taps, 11 s'). Desktop and phone.
- **Tech:** math mulberry32/random.int, spring pops; targets from frame type arrays; GPU ID picking on v10, tap-only AtomPicker on v9; ?hunt= seed codes; distance-coloured rings
- **Judges:**
  - E 3/keep: Cheap on v9 with tap picking, and much better with GPU ID picking. Friend-made clue links add moderation surface. *Improve:* Launch seeded hunts only (no user text), and add clue links after C107's moderation story exists.
  - P 4/keep: Timed hunts and friend-made warmer-colder links are a proven social loop, as long as taps are fast and forgiving. *Improve:* Lead with friend links ('hide an atom for Sam'), because personal challenges spread better than generic hunts.
  - A 3/keep: Hunts give exploration a goal, but the visuals rest on coloured rings and pulses. *Improve:* Use the Highlight glow (C050) and a sonar-ring motion token instead of distance-coloured rings.
  - Pr 4/keep: Goal-driven exploration on real structures (the real vacancy in a nickel MD run), plus friend-made links, is a strong share loop. Free-text clues carried in URLs are an abuse vector. *Improve:* Replace free-text clues with a preset clue vocabulary (element, neighbour, count, distance).
  - M 3/keep: Timed hunts for atoms in dense structures are frustrating with fingers unless C024's loupe exists. *Improve:* Require C024's loupe on phones, and let an accessibility setting relax the timers.
- **Round-1 ideas merged here:**
  - `R1-games-01` **Odd Atom Out** — A 30-second Where's Waldo for atoms. Tap both oxygens in caffeine, then find the one dopant hidden in a 50,000-atom copper crystal, then the real vacancy in a nickel MD run.
  - `R1-social-creator-07` **Hide-and-Seek Atom Links** — Pick one atom, write a clue ("the only oxygen not in a ring"), and send a link. Your friend taps atoms with warmer/colder pulses until they find it, then gets a card that brags "found in 3 taps, 11 s".

<a id="c092"></a>
### C092 · Peekaboo: Find the Buried Atom
**Folded into C091** · mean 2.8 (E3 P3 A2 Pr3 M3) · effort S · DOM/CPU (ships on v9 today) · rides R7 (onOccluded)

An atom is buried in a cage or a diamond crystal; orbit, zoom and peel elements away until you have a real line of sight, and it chimes the moment it is genuinely visible.

- **Summary:** Problem: 3D occlusion is never a game. Solution: an atom is buried in a cage or diamond crystal; orbit, zoom and hide elements until you have a real line of sight; a sonar ping quickens as you get close and it chimes when genuinely visible. Checks run only on camera change, so it suits demand frames. Desktop and phone.
- **Tech:** v10 onOccluded/onVisible (GL2 via occlusion queries, inference); v9 SpatialHash3D + hand-written ray-sphere; math mulberry32, easing; atom visibility filters
- **Judges:**
  - E 3/rework: onOccluded works on objects, not on single instances inside an instanced impostor mesh, so the buried atom needs its own proxy object or an ID-buffer check. *Improve:* Test visibility by scanning a downsampled ID-buffer region (from C009) for the target's ID on camera rest.
  - P 3/merge: The sonar-ping occlusion hunt is clever, but it's one hunt type. Merge into C091. *Improve:* Make it a C091 level.
  - A 2/merge: A line-of-sight chime is a clever occlusion game, but it is visually thin as a separate feature. *Improve:* Merge into C091 as a hunt variant.
  - Pr 3/keep: Real line of sight is a clever lesson in 3D packing, but onOccluded is WebGPU-only (the GL2 path is inference). *Improve:* Use the CPU ray-sphere check as the canonical test on both backends.
  - M 3/keep: Checking only when the camera changes suits demand frames, and the sonar ping is an audio channel. But onOccluded on GL2 is only an inference. *Improve:* Use the v9 ray-sphere check as the path on every backend.
- **Round-1 ideas merged here:**
  - `R1-games-14` **Peekaboo** — One atom is buried deep in a diamond crystal. Orbit and zoom until you find a line of sight to it; a sonar ping quickens as you get close, and it chimes and lights up when you see it.
  - `R1-r3f-sweep-11` **Hide-and-Seek Atoms** — 'Find the xenon hiding in the cage': rotate, zoom and peel away elements until the buried atom peeks out. It chimes the moment it is genuinely visible.

<a id="c093"></a>
### C093 · Molecule Echo
**Folded into C041** · mean 2.6 (E3 P3 A2 Pr2 M3) · effort S · DOM/CPU (ships on v9 today) · rides R2, R6 (v10 glow)

Simon on a molecule: atoms light up and sing a sequence and you tap it back, with pitch following 1/sqrt(mass) like a weight on a spring.

- **Summary:** Problem: element identity has no sensory hook. Solution: Simon on a molecule: atoms light up and sing a sequence and you tap it back; pitch follows 1/sqrt(mass), so oxygen hums low and hydrogen chirps high. Flashes use the glow byte on v10. Desktop and phone; sound opt-in.
- **Tech:** math mulberry32, spring.update, easing.expoOut; Web Audio (optional ZzFX); ELEMENT_DATA.mass; v10 R2 glow flag + bloom, v9 SelectionMarkers
- **Judges:**
  - E 3/keep: Cheap: Simon on a molecule with glow flashes via the R2 byte on v10 and SelectionMarkers on v9, with sound opt-in. *Improve:* Reuse C041's cue bus for tones so it doesn't add its own AudioContext.
  - P 3/keep: Simon on a molecule is quick and sound-led, but the format is dated, and opt-in sound undercuts it. *Improve:* Fold its mass-pitched tones into C041 and C073, so every tap already sings.
  - A 2/park: Simon on atoms is a generic game skin, and its visuals are just flashes. *Improve:* Reuse it as a C091 hunt variant if the audio layer lands.
  - Pr 2/park: Simon on a molecule is shallow, and sound is opt-in. *Improve:* Fold the mass-to-pitch mapping into C041's element plinks.
  - M 3/keep: A Simon game of light and sound can be played by ear, but flash sequences need a rate limit. *Improve:* Keep flashes well under 3 Hz, and make it playable by audio alone with a keyboard grid.
- **Round-1 ideas merged here:**
  - `R1-games-02` **Molecule Echo** — Simon on a molecule: atoms light up and sing a sequence and you tap it back. Oxygen hums low and hydrogen chirps high, because pitch follows 1/√mass like a weight on a spring.

<a id="c094"></a>
### C094 · Element Passport
**Strong** · mean 3.2 (E3 P4 A2 Pr3 M4) · effort S · DOM/CPU (ships on v9 today) · rides none

Every element you tap in a real structure is stamped into a periodic-table passport, with daily quests that turn the library into a collect-them-all.

- **Summary:** Problem: the library feels like a list. Solution: every element you tap in a real structure is stamped into a periodic-table passport; daily quests ('stamp sulfur: find something that smells') make the library a collect-them-all. localStorage only; a home-safe DOM card. Desktop and phone.
- **Tech:** math spring.update (CSS-var squash), mulberry32 daily quests; library-facts.json, property-sheet.json, ELEMENT_DATA; localStorage
- **Judges:**
  - E 3/keep: localStorage-only and DOM, with no rendering risk. Its value depends on the quests being good. *Improve:* Stamp from real taps via C009 picks, so the passport doubles as an exploration heatmap for analytics (PII-free).
  - P 4/keep: A periodic-table passport gives every tap a collection meta-loop and a reason to explore the library. *Improve:* Also stamp the toys a player discovers (burst, pluck, knife), so the passport teaches what you can do.
  - A 2/park: A retention mechanic with little visual payoff. *Improve:* If built, design the stamps as letterpress-style illustrations in the house print voice.
  - Pr 3/keep: A collect-them-all passport adds retention on v9 with localStorage, but the quests need ongoing content upkeep. *Improve:* Tie stamps to C088's Daily and to the Library facets.
  - M 4/keep: Size S, DOM and localStorage: a collection loop that runs anywhere. *Improve:* Make the passport a keyboard-navigable table with text states.
- **Round-1 ideas merged here:**
  - `R1-games-03` **Element Passport** — Every element you tap in a real structure gets stamped into a periodic-table passport. Daily quests like 'stamp sulfur: find something that smells' turn the library into a collect-them-all.

<a id="c095"></a>
### C095 · Guess the Count
**Folded into C082** · mean 2.6 (E3 P3 A2 Pr2 M3) · effort S · [GPU+GL2] · rides R5

Freeze on a view of the billion-atom copper block and guess how many atoms are on screen; the renderer counts them for real.

- **Summary:** Problem: big numbers mean nothing. Solution: freeze on a view of the billion-atom copper block and guess how many atoms are on screen; the renderer counts them for real via frustum culling and shows how many orders of magnitude you were off. Desktop and phone.
- **Tech:** math frustum.setFromViewProjectionMatrixNO + intersectsBox3 into scratch; BillionAtomBlock ported in R5; easing.expoOut; mulberry32
- **Judges:**
  - E 3/keep: Frustum-box counting of the procedural lattice is analytic and cheap (the math frustum APIs are verified), but 'on screen' includes occluded atoms. *Improve:* Count analytically from the lattice box-frustum overlap, and word it as 'inside the view', not 'visible'.
  - P 3/merge: A one-shot guess with a big reveal is fun exactly once. Merge into C082. *Improve:* Make it the stage prompts in C082's pinch journey.
  - A 2/merge: A one-note scale gag that belongs inside the bigger scale journey. *Improve:* Merge into C082 as a guess prompt at one of its stops.
  - Pr 2/merge: A single beat of C082's powers-of-ten journey. *Improve:* Make it C082's quiz moment.
  - M 3/keep: The reveal is fun, but it needs the billion-atom block to run on phones. *Improve:* Use a smaller lattice on phones, and announce the count as text.
- **Round-1 ideas merged here:**
  - `R1-games-04` **Guess the Count** — Freeze on a view of the billion-atom copper block and guess how many atoms are on screen. The renderer counts them for real, and you see how many orders of magnitude you were off.

<a id="c096"></a>
### C096 · Cleave the Crystal
**Folded into C035** · mean 3 (E3 P3 A3 Pr3 M3) · effort M · [GPU+GL2] · rides R3, R4

Swing a knife plane through a copper crystal until the cut face shows the target pattern, feeling a tick every time you cross an atomic layer.

- **Summary:** Problem: crystal planes are textbook abstractions. Solution: swing a knife plane through a copper crystal until the cut face shows the target pattern, such as the hexagon hidden inside a cube; a haptic tick fires at every atomic layer. The clip plane is a uniform read via select(), so no recompiles. Desktop: drag. Phone: drag with Android ticks.
- **Tech:** math plane3 fromNormalAndPoint/distanceToPoint, spherical, vec3.angle, spring3; mood-bus clip plane via select() in R3/R4 TSL; existing lattice generator; not offered on v9 (would need GLSL)
- **Judges:**
  - E 3/merge: This uses the same plane uniform and select() as C035, with a challenge wrapped around it. *Improve:* Merge into C035 as its 'cleave to target' challenge mode.
  - P 3/merge: Finding the hexagon inside a cube is a neat 'aha', but niche. Merge into C035. *Improve:* Make it C035's puzzle mode.
  - A 3/merge: Finding the hexagon hidden in the cube is a gorgeous reveal, but it is the knife tool with a goal. *Improve:* Merge into C035, rendering the cut face as a technical section.
  - Pr 3/merge: The crystal-plane game is a good mode of C035's knife plane. *Improve:* Ship it as C035's challenge mode.
  - M 3/keep: Discrete atomic layers map naturally to arrow keys, but the per-layer haptic ticks work only on Android. *Improve:* Make keyboard stepping and an audible tick the primary feedback.
- **Round-1 ideas merged here:**
  - `R1-games-10` **Cleave the Crystal** — Swing a knife plane through a copper crystal until the cut face shows the target pattern, such as the hexagon hidden inside a cube. Feel a haptic tick every time you cross an atomic layer.

<a id="c097"></a>
### C097 · Sheepdog
**Parked** · mean 2.8 (E3 P4 A2 Pr2 M3) · effort M · [GPU+GL2] · rides R3, R7

A formula's worth of loose atoms mill about like sheep and your cursor is the dog; herd every atom into the pen and they snap together into caffeine.

- **Summary:** Problem: formulas are abstract. Solution: a formula's worth of loose atoms mill about like sheep and your cursor or finger is the dog; herd every C, H, N and O into the pen and they lift off and snap together into caffeine. Hand-written 2D XPBD for up to 500 atoms. Desktop and phone.
- **Tech:** hand-written substepped XPBD (math circle-physics pattern) + fixed-step accumulator in the scheduler physics phase; simplex2d wander; spring3; CPU writes into the TSL impostor buffer
- **Judges:**
  - E 3/keep: 2D XPBD for 500 atoms on the CPU is cheap, but it needs a hand-written accumulator (no fixed step in scheduler 0.2.0). *Improve:* Share one fixed-step accumulator utility across C097/C099/C100/C102.
  - P 4/keep: Herding atoms like sheep is cute and readable on a phone, and snapping into caffeine is a payoff, but it's a separate game mode. *Improve:* Shape the pen like the target molecule's silhouette, so herding teaches its shape.
  - A 2/park: Cute, but atoms as sheep in 2D XPBD read as a generic browser game. *Improve:* Only in a separate games space.
  - Pr 2/park: Whimsical herding with little chemistry in it; M effort. *Improve:* Park it.
  - M 3/keep: Herding with a finger works well on phones, but continuous 2D XPBD needs fps caps. *Improve:* Cap the physics job, and add keyboard steering.
- **Round-1 ideas merged here:**
  - `R1-games-11` **Sheepdog** — A formula's worth of loose atoms mill about like sheep and your cursor is the dog. Herd every C, H, N and O into the pen, and they lift off and snap together into caffeine.

<a id="c098"></a>
### C098 · Polymer Snek
**Parked** · mean 2.6 (E3 P3 A2 Pr2 M3) · effort M · [GPU+GL2] · rides R3, R4

You're a polyethylene chain slithering through a monomer soup; each ethylene you eat grows your backbone by one real 1.54 Å C-C bond.

- **Summary:** Problem: polymers are hard to picture. Solution: you are a polyethylene chain slithering through a monomer soup; each ethylene you eat grows your backbone by one real 1.54 Å C-C bond; don't bite your own tail. Desktop: mouse steering. Phone: thumb steering.
- **Tech:** math/ik fabrik3 forward/addBoneAtBase/setBallJoint; curl3 soup drift; mulberry32; up to 2k atoms CPU-written to the TSL impostor buffer; bonds via R4 pairs
- **Judges:**
  - E 3/keep: fabrik3 forward and addBoneAtBase are verified, and 2k CPU-written atoms are fine. It is a fun, honest bond length, but a standalone game. *Improve:* Run it in the main canvas as a mode using C027's sparse offset path instead of its own scene.
  - P 3/keep: Snake is instantly understood and the 1.54 Å growth is an honest touch, but it's a generic game with a thin molecular payoff. *Improve:* End each run by folding your polymer into a 3D chain you can spin and share.
  - A 2/park: A snake-game skin with thin visual identity. *Improve:* Reuse its FABRIK chain inside C031 instead.
  - Pr 2/park: A snake game dressed up as a polymer; disconnected from the product. *Improve:* Park it.
  - M 3/keep: Arrow-key steering is natural and the bond lengths are real, but thumb steering on small screens is imprecise. *Improve:* Add a tap-left / tap-right steering mode for one-thumb play.
- **Round-1 ideas merged here:**
  - `R1-games-12` **Polymer Snek** — You're a polyethylene chain slithering through a monomer soup. Each ethylene you eat grows your backbone by one real 1.54 Å C–C bond; don't bite your own tail.

<a id="c099"></a>
### C099 · Periodic Pinball
**Killed** · mean 2 (E2 P2 A1 Pr2 M3) · effort M · [GPU+GL2] · rides R7

Slingshot atoms across a tilting table into the right periodic-group pockets; hydrogen skitters and tungsten rolls like a bowling ball because the masses are real.

- **Summary:** Problem: periodic groups are memorised. Solution: slingshot atoms across a tilting table into the right periodic-group pockets; hydrogen skitters and tungsten rolls like a bowling ball because the masses are real. Desktop: keys or mouse. Phone: DOM flippers with haptic ticks, plus device tilt.
- **Tech:** hand-written 2D XPBD + fixed-step accumulator (scheduler physics phase); math vec2, spring; DeviceOrientation; ios-haptics on DOM flippers, navigator.vibrate
- **Judges:**
  - E 2/park: This is essentially a 2D arcade game with DOM flippers. It rides nothing in the port and uses little of Lupi's renderer. *Improve:* Park it; if revisited, build it on the shared accumulator from C097.
  - P 2/park: Pinball with real masses is a big build for a thin lesson about periodic groups. *Improve:* Park it; C080's slingshot delivers the mass-feel more cheaply.
  - A 1/kill: An arcade pinball skin that shows nothing molecular. It would look like an ad game and dilute the brand. *Improve:* Put the effort into C090 or C082, which carry real spatial meaning.
  - Pr 2/park: Pinball into periodic-group pockets; disconnected from the product. *Improve:* Park it.
  - M 3/keep: DOM flippers are one of the few designs here that actually get iOS switch haptics (they are direct taps), and the masses are real. Tilt needs a permission prompt. *Improve:* Keep tilt optional and the flippers as the primary input.
- **Round-1 ideas merged here:**
  - `R1-games-13` **Periodic Pinball** — Slingshot atoms across a tilting table into the right periodic-group pockets. Hydrogen skitters and tungsten rolls like a bowling ball, because the masses are real.

<a id="c100"></a>
### C100 · Shake the Jar
**Killed** · mean 2 (E2 P3 A2 Pr1 M2) · effort L · [GPU+GL2] · rides R3, R7

C60 is broken into pieces inside the snowglobe; shake your phone to tumble them and watch magnetic edges catch until the buckyball assembles itself.

- **Summary:** Problem: self-assembly is invisible. Solution: C60 is broken into pieces inside the snowglobe; shake the phone to tumble them, let it settle, and watch magnetic edges catch until the buckyball assembles. Fragment physics on the CPU (up to 64 bodies) in the main canvas once Studio folds in as a Look. Desktop: drag to shake.
- **Tech:** CPU rigid bodies + fixed-step accumulator (scheduler physics phase); math quat/vec3/spring3/mulberry32; snow-motion.ts DeviceMotion; Studio-as-a-Look in the main canvas
- **Judges:**
  - E 2/park: It depends on Studio-as-a-Look (C042) plus rigid fragment physics and edge matching, an L effort stacked on an unfinished dependency. *Improve:* Revisit after C042 lands, as a scripted assembly animation before any physics.
  - P 3/merge: Shaking C60 fragments until they self-assemble is a lovely payoff, but it depends on Studio-as-a-Look and is one shake scene. Merge into C043. *Improve:* Make it one of C043's globe scenes.
  - A 2/merge: Magnetic self-assembly is a nice beat, but it depends on Studio becoming a Look. *Improve:* Merge into C042 as that Look's showcase.
  - Pr 1/kill: It shows C60 assembling itself from fragments with magnetic edges, which teaches a wrong mechanism. It is also L effort and depends on C042 shipping first. *Improve:* Drop it.
  - M 2/park: It depends on Studio folding into the main canvas (C042), plus a shake permission and CPU rigid bodies. *Improve:* Revisit after C042 ships, with a Shake button.
- **Round-1 ideas merged here:**
  - `R1-games-16` **Shake the Jar** — C60 is broken into pieces inside the snowglobe. Shake your phone to tumble them, let it settle, and watch magnetic edges catch until the buckyball assembles itself.

<a id="c101"></a>
### C101 · Scan Scavenger Hunt
**Parked** · mean 2.4 (E2 P3 A2 Pr3 M2) · effort L · [GPU] · rides R12

Today's list: something that floats, something with a metal, something sweet; photograph real things, get your hunt card stamped, and watch each object fold into its molecule.

- **Summary:** Problem: /scan is a one-off. Solution: a daily list ('something that floats, something with a metal, something sweet'); photograph real things around you, Lupi stamps the hunt card, and the particles become your object before folding into its molecule. Without HF_TOKEN it's demo-only. Phone-first; desktop via uploads.
- **Tech:** /v1/scan/identify + /v1/scan/gist (HF_TOKEN); gistEngine.setHomes (vgpu) with swirl/CSS fallback, TSL port later; library-facts.json; mulberry32 daily list
- **Judges:**
  - E 2/park: [GPU] vgpu particles plus a hard HF_TOKEN dependency and daily content make it demo-only without the token. *Improve:* Park it until /scan runs reliably with its token in production.
  - P 3/park: A real-world photo hunt is a nice come-back loop, but it's HF_TOKEN-gated and tied to the phone camera. *Improve:* Park it until C069's demo proves that /scan delights.
  - A 2/park: It depends on HF_TOKEN and adds game UI rather than new visuals. *Improve:* Revisit after C069 lands.
  - Pr 3/keep: A real-world daily hunt is a great phone ritual for /scan, but every photo costs HF inference, it needs a cost owner, and the effort is L. *Improve:* Name a cost owner and cap daily scans; launch a demo mode first.
  - M 2/park: GPU-only, needs HF_TOKEN, and uploads camera photos over cellular. Without the token it is demo-only. *Improve:* Start with a library-only version where players pick from the library instead of taking photos.
- **Round-1 ideas merged here:**
  - `R1-games-17` **Scan Scavenger Hunt** — Today's list: something that floats, something with a metal, something sweet. Photograph real things around you; Lupi stamps the hunt card, and the particles become your object before folding into its molecule.

<a id="c102"></a>
### C102 · Nanokart
**Killed** · mean 1.8 (E2 P3 A2 Pr1 M1) · effort XL · [GPU+GL2] · rides R7

Drive a tiny probe over the bumpy van der Waals surface of a nanotube, buckyball or graphene edge, and race friends' ghost replays on seeded tracks.

- **Summary:** Problem: molecular surfaces are never explored at human scale. Solution: drive a tiny probe over the bumpy van der Waals surface of a nanotube, buckyball or graphene edge, with gravity toward the molecule, and race friends' ghost replays on seeded tracks. Desktop: keys or gamepad. Phone: thumbsticks.
- **Tech:** hand-written sphere collision on SpatialHash3D + fixed-step accumulator (scheduler physics phase); math quat slerp/rotationTo, spring3, mulberry32; v10 camera-in-scene-graph headlamp
- **Judges:**
  - E 2/park: XL game work (collision, ghost replays, controls) on hand-written physics, far from the core viewer. *Improve:* Park it; C113's fly-through covers most of the exploration fun at M effort.
  - P 3/park: Driving over a buckyball's bumps is a great fantasy, but it's XL. *Improve:* Prototype only the camera-on-surface view inside C113's fly mode first.
  - A 2/park: Seeing a vdW surface at human scale is a stunning viewpoint, but the idea is XL game work. *Improve:* Salvage the probe-eye camera as a C113 flight mode.
  - Pr 1/park: An XL kart game with no connection to the product's purpose. *Improve:* Park it indefinitely.
  - M 1/kill: Size XL, and first-person driving over bumpy surfaces is the most motion-sickness-inducing idea on the list. *Improve:* If ever, a third-person, fixed-horizon mini-map version.
- **Round-1 ideas merged here:**
  - `R1-games-20` **Nanokart** — Drive a tiny probe over the bumpy van der Waals surface of a carbon nanotube, a buckyball or a graphene edge, with gravity pulling toward the molecule, and race friends' ghost replays on seeded tracks.


## Share

<a id="c103"></a>
### C103 · Perfect Loop Clips to the Share Sheet
**Champion** · mean 4.4 (E5 P4 A4 Pr5 M4) · effort M · [GPU+GL2] · rides R7, R9

Tap 'Make a loop' and get a seamless, frame-exact 9:16 clip of your molecule, rendered frame by frame so even an old phone exports without dropped frames, straight to the share sheet.

- **Summary:** Problem: sharing motion means screen recording with dropped frames. Solution: 'Make a loop' renders a seamless 4-6 s 9:16 clip (turntable, tilted orbit, breathe or flythrough; 4D noise loops exactly), frame-stepped with advance() into a fixed-size target, encoded to MP4 or GIF, and handed to the native share sheet. Desktop: faster than real time. Phone: no dropped frames. Illustrative output.
- **Tech:** fixed-size useRenderTarget + frame-stepped advance(); WebCodecs VideoEncoder via Mediabunny, MediaRecorder fallback; gifenc; math simplex4d loop; Web Share L2 files; WebGPU VideoFrame on Safari unverified
- **Judges:**
  - E 5/champion: Fixed-size output plus frame-stepped advance() on the R7/R9 work gives frame-exact loops no screen recording can match, and it replaces the 5 s MediaRecorder path. VideoFrame from a WebGPU canvas on Safari is unverified. *Improve:* Encode from readRenderTargetPixelsAsync buffers into VideoFrames (Mediabunny/WebCodecs) instead of from the canvas, with MediaRecorder as the last resort.
  - P 4/champion: A seamless 9:16 loop sent to the share sheet is the currency of 'show a friend', and frame-stepping means old phones don't drop frames. Output is illustrative only. *Improve:* Offer 'share what I just did': re-render the last few seconds of the player's own burst or flick, not only scripted turntables.
  - A 4/keep: Frame-exact seamless loops are how Lupi's look travels outside Lupi, and truly seamless, drop-free loops are motion-design gold. *Improve:* Ship three art-directed loop templates with authored camera easing and a branded end frame.
  - Pr 5/champion: Frame-exact 9:16 loops sent to the share sheet are the strongest viral channel here, and they replace the 5-second MediaRecorder export. A v9 slice exists (advance() plus a fixed-size target plus Mediabunny). *Improve:* Ship the v9 slice with an 'illustrative' mark and a Lupi end frame that links back.
  - M 4/keep: Frame-stepped encoding avoids dropped frames on phones and goes straight to the share sheet. VideoFrame from a WebGPU canvas on Safari is unverified. *Improve:* On Safari, fall back to readRenderTargetPixelsAsync into a 2D canvas, and add captions and alt text to exported clips.
- **Round-1 ideas merged here:**
  - `R1-social-creator-05` **Perfect Loop** — Record a seamless, frame-exact 6-second vertical loop (turntable, tilted orbit, breathe, or flythrough) as MP4 or GIF, rendered faster than real time on desktop and without dropped frames on phones, straight into the share sheet.
  - `R1-mobile-native-14` **Vertical Loop Clip to the Share Sheet** — 'Make a clip' renders a perfect 4-second 9:16 seamless loop of your molecule (orbit, wobble and all) and hands the MP4 straight to the native share sheet for Reels, TikTok or Messages.
  - `R1-r3f-sweep-16` **Six-Second Perfect Loop** — Tap 'Make a loop' and get a seamless 1080×1920 clip of your molecule, rendered frame by frame so even an old phone exports a perfect 60 fps, straight to the share sheet.

<a id="c104"></a>
### C104 · Lock Screen Maker
**Folded into C105** · mean 3.4 (E4 P3 A3 Pr3 M4) · effort S · [GPU+GL2] · rides R9

'Make it my wallpaper': a phone-exact, clock-safe lock screen of your molecule with a seeded composition you can shuffle, handed to the share sheet.

- **Summary:** Problem: nothing makes a molecule personal to carry around. Solution: 'Make it my wallpaper' renders the view at the phone's exact resolution, composed below the clock, with a seeded composition you can shuffle, then hands it to the share sheet to save. One offscreen fixed-size render. Phone-first; desktop wallpapers too.
- **Tech:** v10 useRenderTarget or <Canvas width height> fixed-size output + readRenderTargetPixelsAsync; setViewOffset composition; mulberry32 random.quat; Web Share L2
- **Judges:**
  - E 4/keep: One fixed-size offscreen render plus Web Share, cheap after R9. It overlaps C105/C106 on the capture plumbing. *Improve:* Build one shared 'capture service' (fixed-size RT, async readback, share) that C104/C105/C106 all call.
  - P 3/keep: A wallpaper is a personal keepsake at S effort, but it's a one-off. *Improve:* Seed it from the player's Remix code so each wallpaper is theirs.
  - A 3/keep: Clock-safe composition is a designerly touch, but a random shuffle will produce weak layouts. *Improve:* Shuffle among a few designed compositions, not random quaternions.
  - Pr 3/keep: Personal and cheap, but a narrow share use. *Improve:* Make it a preset in the C103/C105 export sheet.
  - M 4/keep: Size S and phone-first: one fixed-size render, then the share sheet. A clean personal hook. *Improve:* Absorb C105 into a single 'Make it mine' share menu.
- **Round-1 ideas merged here:**
  - `R1-social-creator-04` **Lock Screen Maker** — "Make it my wallpaper": a phone-exact, clock-safe lock screen of your molecule, with a seeded composition you can shuffle until it feels like yours.
  - `R1-mobile-native-15` **Lock-Screen Molecule** — 'Make wallpaper' renders your current view at your phone's exact screen resolution, composed so the molecule sits below the clock, and hands it to the share sheet: Save Image, set as wallpaper.

<a id="c105"></a>
### C105 · Sticker Press
**Strong** · mean 3.8 (E4 P4 A3 Pr4 M4) · effort S · [GPU+GL2] · rides R9

One tap turns the molecule at your current angle into a die-cut sticker that pastes straight into chats, plus a vector cut file for a Cricut.

- **Summary:** Problem: molecules can't be pasted into chats. Solution: one tap turns the molecule at the current angle into a die-cut sticker (thick white outline, soft shadow, transparent background) that pastes into iMessage, WhatsApp, Slack or Discord, plus a vector cut file for a Cricut. Phone and desktop.
- **Tech:** fixed-size transparent useRenderTarget + readRenderTargetPixelsAsync; OffscreenCanvas 2D outline dilation; ClipboardItem + Web Share files; math mat4/vec3 SVG projection for the cut file
- **Judges:**
  - E 4/keep: A transparent RT capture plus a 2D outline dilation is cheap, but post passes (bloom, AO) mishandle alpha, so the capture must use a raw pass. *Improve:* Capture stickers from a raw, post-free transparent pass, and apply the outline and shadow in 2D.
  - P 4/keep: One tap to a die-cut sticker you paste into chats is the lightest possible share, and chat stickers spread. *Improve:* Offer the sticker button right after a burst or a lucky Remix roll.
  - A 3/keep: Die-cut stickers are on-trend and shareable, but generic without a house style. *Improve:* Default the sticker to the Illustrate look with an ink outline.
  - Pr 4/keep: Die-cut stickers pasted into chats are a cheap viral channel through messaging apps; S effort. *Improve:* Add a subtle Lupi mark and skip the Cricut file.
  - M 4/merge: Merge into C104. Stickers are a cheap share that feels native on phones, and a PNG ClipboardItem works on iOS Safari. The Cricut cut file is a niche extra. *Improve:* Offer it as an entry in C104's share menu.
- **Round-1 ideas merged here:**
  - `R1-social-creator-03` **Sticker Press** — One tap turns the molecule at your current angle into a die-cut sticker (thick white outline, soft shadow, transparent) that pastes straight into iMessage, WhatsApp, Slack or Discord, plus a vector cut file for a Cricut.

<a id="c106"></a>
### C106 · Real Share Cards
**Champion** · mean 4.2 (E4 P3 A5 Pr5 M4) · effort M · [GPU+GL2] · rides R9

Every Lupi link unfurls with a card of that molecule, its angle, look, name and atom count, instead of the same generic image for everything.

- **Summary:** Problem: every Lupi link unfurls with the same generic og-lupi.png. Solution: each saved view gets a card of its molecule at its angle, look, name and atom count, captured client-side at 1200x630 and uploaded to R2 through an authenticated route, with a Satori/resvg edge fallback. Links in chats and socials look like the thing on desktop and phone.
- **Tech:** v10 useRenderTarget(1200,630) + readRenderTargetPixelsAsync; Worker R2 ASSETS binding with Firebase ID-token check; Satori + precompiled resvg-wasm
- **Judges:**
  - E 4/keep: Per-view cards are a clear growth win. Client capture after R9 plus a Satori edge fallback covers views nobody has captured, but authenticated R2 upload adds Worker surface. *Improve:* Generate the Satori fallback first (renderer-free, ships on v9), and upgrade to client-captured cards after R9.
  - P 3/keep: Real unfurls make shared links tempting. Necessary, but not a toy. *Improve:* Show the player's look or Remix on the card, so the share looks like what they made.
  - A 5/champion: Share cards are the most-seen Lupi visual outside Lupi, and a generic unfurl wastes every link. *Improve:* Design one card template in the Illustrate look with editorial type, and art-direct the crop and pose rules.
  - Pr 5/champion: Every Lupi link currently unfurls with the same og-lupi.png (verified in the Worker). Per-view cards are table stakes for every other share loop. *Improve:* Start with an edge SVG/Satori card rendered from the saved view's coordinates (no client upload, no new storage), then add client captures.
  - M 4/keep: Every link unfurling as its own molecule helps everyone, and it is a chance to add real og:image:alt text. *Improve:* Generate alt text from the name, formula and look alongside each card.
- **Round-1 ideas merged here:**
  - `R1-social-creator-06` **Real Share Cards** — Every Lupi link unfurls with a card of that molecule (its angle, look, name and atom count) instead of the same generic og-lupi.png for everything.

<a id="c107"></a>
### C107 · Remix Chains
**Folded into C062** · mean 2.8 (E3 P3 A2 Pr3 M3) · effort M · DOM/CPU (ships on v9 today) · rides none

Every shared view gets a 'Remix this' button, and remixes remember their parent, so a link page shows the family tree.

- **Summary:** Problem: shared views are dead ends, and VIEW_FORKED is never emitted. Solution: every shared view gets 'Remix this', and remixes remember their parent, so a link page shows the family tree ('caffeine by teal-otter, 23 remixes'). Firestore and Worker share HTML; renderer-agnostic. Desktop and phone.
- **Tech:** Firestore lupiViews parent links + increment counters; Worker share HTML; VIEW_FORKED analytics; remix codes from the seed codec
- **Judges:**
  - E 3/keep: Renderer-agnostic Firestore plumbing that emits the missing VIEW_FORKED event. It is low risk, but it is social infrastructure, not viewer fun. *Improve:* Piggyback it on C062's remix codes so the parent link is just the code lineage.
  - P 3/keep: Remix family trees give shares a second life, but the loop depends on sign-in and a remix culture that doesn't exist yet. *Improve:* Show a remix count on the card to invite 'Remix this'.
  - A 2/park: Social plumbing with little visual payoff. *Improve:* Show the family tree as a small illustrated thumbnail strip.
  - Pr 3/keep: Remix lineage is a social loop, and VIEW_FORKED already exists but is never emitted. It needs a community that doesn't exist yet. *Improve:* Emit VIEW_FORKED and store the parent link first; show family trees only once there is volume.
  - M 3/keep: Renderer-agnostic and useful for growth, but neutral for phones and accessibility. *Improve:* Present family trees as accessible lists.
- **Round-1 ideas merged here:**
  - `R1-social-creator-11` **Remix Chains** — Every shared view gets a "Remix this" button, and remixes remember their parent, so a link page shows the family tree: "caffeine by teal-otter → 23 remixes".

<a id="c108"></a>
### C108 · Shelves
**Parked** · mean 2.6 (E3 P2 A2 Pr3 M3) · effort M · DOM/CPU (ships on v9 today) · rides none

Pin molecules and views onto a named shelf and share the whole shelf as one link with a collage card, for teachers, bloggers and collectors.

- **Summary:** Problem: teachers and bloggers can't share a set of molecules. Solution: pin molecules and views onto a named shelf ('Things in my coffee', 'Smells of a forest') and share the whole shelf as one link with a collage card. Firestore plus Worker share HTML; renderer-agnostic. Desktop and phone.
- **Tech:** Firestore + React UI; Worker share HTML; optional Satori collage card on the edge
- **Judges:**
  - E 3/keep: Firestore plus share HTML is renderer-agnostic and useful for teachers, with no graphics risk. *Improve:* Reuse C106's card pipeline for the collage instead of a new renderer.
  - P 2/park: Curation for teachers, not a toy for a stranger. *Improve:* Park it.
  - A 2/park: A curation feature. The collage card is the only visual element. *Improve:* Reuse C106's card system for the collage.
  - Pr 3/keep: Teachers sharing sets is a real channel, but it is M effort and needs a new Firestore schema. *Improve:* Start with a shelf as a list of saved-view links in a URL, with no new storage.
  - M 3/keep: Useful for teachers, and neutral for phone performance. *Improve:* Add keyboard reordering and a plain-text list view.
- **Round-1 ideas merged here:**
  - `R1-social-creator-12` **Shelves** — Pin molecules and views onto a named shelf ("Things in my coffee", "Smells of a forest") and share the whole shelf as one link with a collage card, made for teachers, bloggers and collectors.

<a id="c109"></a>
### C109 · Tap-to-Wake Embeds and oEmbed
**Strong** · mean 3.6 (E4 P3 A3 Pr4 M4) · effort M · DOM/CPU (ships on v9 today) · rides R7, R9

A copy-paste embed that costs a blog nothing until a reader taps it, then wakes into a live, spinnable Lupi view; oEmbed makes pasted links just work.

- **Summary:** Problem: embedding a 3D viewer costs a blog page weight and battery. Solution: an embed that is a poster card with a play button until tapped, then wakes into a live, spinnable view on demand frames; oEmbed makes pasted Lupi links work in supporting CMSs. Readers on desktop and phone pay nothing until they tap.
- **Tech:** Worker /embed routes + oEmbed JSON; lazy viewer entry; scheduler demand default + onVisible; share-card poster image
- **Judges:**
  - E 4/keep: A poster until tapped, then demand frames: the calmest possible embed. A lazy viewer entry and a Worker route are modest work. *Improve:* Mount the live viewer only on tap plus onVisible, and unmount on scroll-out to avoid the renderer leak (#3926).
  - P 3/keep: Tap-to-wake embeds spread Lupi cheaply, but the wake moment must be juicy. *Improve:* Make the wake a condensation burst (C030), so readers get a payoff for tapping.
  - A 3/keep: Tap-to-wake embeds protect host pages, but the poster-to-live swap can pop. *Improve:* Crossfade the poster into the first live frame at an identical pose.
  - Pr 4/keep: Embeds are how viewers spread (Sketchfab, 3Dmol), and tap-to-wake costs readers nothing until they tap. Blogs and LMSs are acquisition channels. *Improve:* Ship the poster-plus-tap-to-wake embed, using the C106 card as the poster.
  - M 4/keep: Tap-to-wake embeds cost phone readers nothing until they tap, and they fit demand frames. *Improve:* Make the poster a focusable button with alt text, and respect reduced motion when it wakes.
- **Round-1 ideas merged here:**
  - `R1-social-creator-13` **Tap-to-Wake Embeds + oEmbed** — A copy-paste embed that costs a blog nothing until a reader taps it: a poster card with a play button that wakes into a live, spinnable Lupi view. oEmbed means pasting a Lupi link into supporting CMSs just works.

<a id="c110"></a>
### C110 · On My Desk: One-Tap AR and AR Postcards
**Champion** · mean 4.2 (E4 P4 A3 Pr5 M5) · effort M · DOM/CPU (ships on v9 today) · rides R10 (Android WebXR only)

One 'On my desk' button drops the molecule onto your real table at an honest 1 Å = 1 cm scale, and hosted files turn it into a link that opens straight into AR.

- **Summary:** Problem: iPhone Quick Look is built but unwired, and blob URLs can't be shared. Solution: one 'On my desk' button: USDZ Quick Look on iPhone, Scene Viewer or WebXR on Android, at an honest 1 Å = 1 cm with an 'Open in Lupi' banner; hosted files make AR postcard links. Phone-first. Quick Look and Scene Viewer are renderer-agnostic; immersive WebXR stays frozen until R10.
- **Tech:** three USDZExporter (scene-graph, renderer-agnostic); Quick Look fragment params + banner; hosted USDZ/GLB on R2 for Scene Viewer; WebXR path frozen pending R10
- **Judges:**
  - E 4/keep: USDZ Quick Look and Scene Viewer are renderer-agnostic, and the exporter already exists; only immersive WebXR is frozen by R10. Impostors need the existing mesh-export path. *Improve:* Wire the existing USDZ exporter to a Quick Look button now on v9, and host files on R2 for postcards.
  - P 4/keep: The molecule on my desk at 1 Å = 1 cm is a real wow on phones, especially with the iPhone Quick Look path that already exists. *Improve:* Make 'On my desk' one prominent button on phones.
  - A 3/keep: One-tap AR is magic, but USDZ and GLB materials often look plastic in Quick Look. *Improve:* Art-direct PBR materials and a contact shadow for the AR export.
  - Pr 5/champion: iPhone Quick Look is built but never triggered: setIsExportingQuickLook is only ever set to false (verified). So one-tap AR is mostly wiring. It is renderer-agnostic, uses an honest scale, and is a big phone wow. *Improve:* Ship the iPhone button on v9 now; defer hosted AR postcards until R2 has a cost owner.
  - M 5/champion: It wires up iPhone Quick Look, which is already built but has no caller today, so AR needs no WebXR. It is renderer-agnostic, uses an honest scale, and is phone-first. *Improve:* Ship the Quick Look wiring on v9 now, and cap USDZ size for large molecules.
- **Round-1 ideas merged here:**
  - `R1-mobile-native-09` **On My Desk: one-tap AR that already half-exists** — A single 'On my desk' button that drops the molecule onto your real table: USDZ Quick Look on iPhone and WebXR hit-test on Android, at an honest '1 Å = 1 cm' desk scale, with an 'Open in Lupi' banner.
  - `R1-social-creator-14` **AR Postcards** — Send someone a molecule they can put on their kitchen table: a link that opens straight into iPhone AR Quick Look with an "Open in Lupi" button, or Scene Viewer on Android.

<a id="c111"></a>
### C111 · Room Window
**Parked** · mean 2.4 (E3 P3 A2 Pr2 M2) · effort L · [GPU+GL2] · rides R5

One tap turns the viewer background into your phone's camera feed tied to the gyroscope, so the molecule seems to hang in your room, on any phone and with no WebXR.

- **Summary:** Problem: AR needs an export wait, and iPhones lack WebXR. Solution: one tap turns the background into the phone's camera feed and ties the view to the gyroscope, so the molecule seems to hang in the room, with a light estimate from the feed. Works on any phone with no WebXR. Snapshots are interactive only, since video backgrounds fail closed in export.
- **Tech:** getUserMedia -> VideoTexture as <Canvas background>; DeviceOrientation (iOS permission); math quat.fromEuler/slerp, color.luminance light estimate
- **Judges:**
  - E 3/keep: getUserMedia to VideoTexture works on both backends but uploads every camera frame and forces continuous rendering (battery), and snapshots can't be exported. *Improve:* Drop the camera feed to ~15-24 fps via a per-job fps cap, and pause it when the phone is still.
  - P 3/merge: Pseudo-AR over the camera feed is clever, but it duplicates C110 and needs both camera and motion permissions. Merge into C110. *Improve:* Make it C110's fallback where Quick Look and Scene Viewer are missing.
  - A 2/park: A camera-feed background with gyro but no tracking floats and slides. Faux AR looks cheap. *Improve:* Point users to C110's real AR instead.
  - Pr 2/park: Asks for camera permission to deliver pseudo-AR that C110 does better; L effort. *Improve:* Park it.
  - M 2/park: Two iOS permission prompts, camera battery drain and gyro parallax, all to fake an AR view that Quick Look (C110) already gives iPhones. *Improve:* Let C110 cover AR.
- **Round-1 ideas merged here:**
  - `R1-mobile-native-17` **Room Window: instant see-it-in-your-room for every phone** — One tap turns the viewer background into your phone's camera feed and ties the view to the gyroscope, so the molecule seems to hang in your room. It works on iPhones with no WebXR and needs no export wait.

<a id="c112"></a>
### C112 · Director Mode and One-Tap Explainer Reels
**Folded into C103** · mean 3 (E3 P3 A3 Pr3 M3) · effort L · [GPU+GL2] · rides R7, R8, R9

Drop camera moves onto a beat grid and export a frame-exact 9:16 clip, or tap 'Make a reel' for an auto-directed explainer built from real structure features and measured facts.

- **Summary:** Problem: good molecule videos need editing skills. Solution: drop camera moves (orbit, dolly to atom, whip-pan, element roll call, hold) onto a beat grid and preview live, or tap 'Make a reel' for an auto-directed 12 s explainer whose beats come from real structure features and captions from measured facts. Both export frame-exact 9:16 clips. Desktop authoring; phone one-tap.
- **Tech:** @pmndrs/timeline vanilla driven from a scheduler update job; frameloop='never' + advance + fixed-size target; Mediabunny; Jev edge judgments for beat choice; LupiText labels
- **Judges:**
  - E 3/merge: A timeline plus frameloop='never' plus advance() is the same engine as C103, with an authoring UI and Jev judgments on top. *Improve:* Merge into C103 as its authoring layer, shipping the one-tap auto-reel before the beat-grid editor.
  - P 3/merge: Beat-grid directing is a creator feature; one-tap reels are the only part a stranger would use. Merge into C103. *Improve:* Fold 'Make a reel' into C103.
  - A 3/keep: A beat-grid camera director is a real motion-design tool, but auto-directed reels risk looking generic. *Improve:* Build auto-reels only from the designed C103 templates and beats.
  - Pr 3/merge: Auto-directed reels are powerful but L effort, and using Jev to choose beats adds inference to captions. Merge into C103. *Improve:* Make it C103's phase 2, with captions taken only from measured facts.
  - M 3/keep: Auto captions from real facts are an accessibility plus, but whip-pans and rolls are hard on viewers' stomachs, and the effort is L. *Improve:* Fold the one-tap reel into C103, with gentle camera moves and burned-in captions.
- **Round-1 ideas merged here:**
  - `R1-social-creator-15` **Director Mode** — A TikTok-native camera choreographer: drop moves (orbit, dolly to atom, whip-pan, element roll call, hold) onto a beat grid, preview live, and export a frame-exact 9:16 clip that cuts on the beat.
  - `R1-social-creator-19` **Auto-Director: One-Tap Explainer Reels** — Tap "Make a reel" and Lupi directs a 12-second vertical explainer of your molecule: camera beats chosen from real structure features, captions from measured facts, and an optional illustrative soundtrack, ready to post.

<a id="c113"></a>
### C113 · Fly It and Share the Flight
**Strong** · mean 3.2 (E4 P3 A3 Pr3 M3) · effort M · DOM/CPU (ships on v9 today) · rides none

Scribble a loop over the molecule and the camera flies your doodle, or use twin thumbsticks to fly through pores and nanotubes, then share the flight as a replayable link.

- **Summary:** Problem: guided tours are hard to make. Solution: scribble a loop over the molecule and the camera flies your doodle (Hermite-smoothed, quaternion-banked), or turn the phone sideways for twin thumbsticks to fly through zeolite pores, down a nanotube or across a million-atom lattice; either way the flight is shared as a replayable link. Desktop: draw or gamepad. Phone: draw or thumbsticks.
- **Tech:** math vec3.hermite/bezier, quat.sqlerp/rotationTo, spherical, spring2; Pointer Events multi-touch + Gamepad API; hand-written collision; existing flythrough serializer; camera-only
- **Judges:**
  - E 4/keep: Camera-only, and vec3.hermite/bezier and quat.sqlerp/rotationTo are verified. It reuses the existing flythrough serializer and ships on v9. *Improve:* Ship the doodle-path version first and add twin thumbsticks later, since collision inside pores is the hard part.
  - P 3/keep: Scribble a path and fly it is a cute creative toy that ships on v9, but the flight needs a destination to be fun. *Improve:* Let players draw the path directly on the canvas in a fly mode, and send the result to C103.
  - A 3/keep: A doodled flight path with Hermite smoothing and quaternion banking can feel cinematic, but amateur paths can nauseate. *Improve:* Clamp angular velocity and banking with the motion tokens.
  - Pr 3/keep: Draw-a-flight is novel, camera-only, and ships on v9 with the existing flythrough serializer. *Improve:* Share flights through saved-view links and C103's loop export.
  - M 3/keep: Camera-only and ships on v9, but flying through pores is a vestibular risk, and twin thumbsticks need two hands. *Improve:* Add speed caps, fade transitions, and an option to preview the flight as stills.
- **Round-1 ideas merged here:**
  - `R1-math-sweep-13` **Draw-a-Flight Tour** — Scribble a loop-de-loop over the molecule and the camera flies your doodle, smoothed with Hermite splines and banking with quaternion squad. Then share the flight as a link.
  - `R1-mobile-native-18` **Two-Thumb Flight** — Turn your phone sideways and get twin virtual thumbsticks to fly a camera through zeolite pores, down a nanotube, or across a million-atom copper lattice, then share your flight as a replayable path.

<a id="c114"></a>
### C114 · Poster and Print Studio
**Rework** · mean 3 (E3 P2 A4 Pr3 M3) · effort L · [GPU+GL2] · rides R6, R9

Turn any view into a gallery-grade poster with real facts and export a 300 dpi print-ready PDF or a pen-plotter SVG.

- **Summary:** Problem: good views can't become printed objects. Solution: turn any view into a gallery-grade poster (Swiss, blueprint, pastel or risograph layouts with real facts) and export a 300 dpi print-ready PDF or a pen-plotter SVG, from tiled fixed-size renders; Goodsell and outline styles ride the pipeline. Desktop-first.
- **Tech:** tiled useRenderTarget + readRenderTargetPixelsAsync; pdf-lib; mulberry32 layouts; outline/Goodsell styles via TSL sobel or ID edges
- **Judges:**
  - E 3/rework: Tiled renders break screen-space post: SSAO, bloom, DOF and the Goodsell edges produce seams at tile borders without guard bands. *Improve:* Render a single large target up to maxTextureDimension, or tile with overlapping guard bands cropped after post.
  - P 2/merge: A desktop poster studio is a feature for few players. Merge into C060. *Improve:* Make it C060's print output.
  - A 4/keep: Gallery-grade posters fit the editorial and cinematic-archive brand, but the layouts need a designer's hand. *Improve:* Ship two strong layouts (Swiss and riso) in the Illustrate look before adding more.
  - Pr 3/keep: Posters serve teachers and the owned export outcome, but the scope is L and it is desktop-first. *Improve:* Start with the C049 look and a single PDF layout.
  - M 3/keep: Desktop-first, and tiled 300 dpi renders risk the browser tab being killed for memory on phones. *Improve:* Cap tile size on phones, and offer phone-sized posters.
- **Round-1 ideas merged here:**
  - `R1-social-creator-16` **Poster & Print Studio** — Turn any view into a gallery-grade poster (Swiss, blueprint, pastel or risograph layouts with real facts) and export a 300 dpi print-ready PDF or a pen-plotter SVG.

<a id="c115"></a>
### C115 · Co-View Rooms and Pass the Molecule
**Parked** · mean 2.8 (E3 P3 A2 Pr3 M3) · effort XL · [GPU+GL2] · rides none (edge infra)

Share a room code and explore a molecule together: friends' viewpoints orbit as comets, 'Follow' rides the teacher's camera, and you can flick the molecule onto a friend's phone.

- **Summary:** Problem: exploring together means screen sharing. Solution: a 5-letter room code: friends' viewpoints orbit as glowing comets, their taps ripple on atoms, 'Follow' rides the teacher's camera, a teacher can mirror one view onto thirty phones, and friends in a room can flick the molecule from one screen onto another. Durable Objects over WebSockets; only camera state travels.
- **Tech:** Cloudflare Durable Objects + WebSocket Hibernation (new binding); math quat/vec3, spring3 smoothing of remote cameras; TSL basic materials for comets; saved-view slugs
- **Judges:**
  - E 3/park: Rendering cost is trivial because only camera state travels, but Durable Objects plus WebSocket rooms are XL infrastructure outside the v10 story. *Improve:* Park it; if revisited, ship 'Follow the teacher' first as one-way camera broadcast.
  - P 3/park: Flicking a molecule onto a friend's phone is magical and classrooms would love it, but it's XL infrastructure. *Improve:* Start with pass-and-play on one device.
  - A 2/park: XL infrastructure. Friends' cameras as comets are a small visual gain. *Improve:* Revisit after the C109 embeds.
  - Pr 3/park: Teacher 'Follow' is a strong classroom channel, but the scope is XL and it needs a new Durable Objects binding with an operator and cost owner. *Improve:* Start with one-way teacher broadcast only.
  - M 3/keep: Mirroring for classrooms is valuable, but continuously following someone else's camera is a top motion-sickness trigger, and it needs XL edge infrastructure. *Improve:* Let followers 'snap to teacher' with fades instead of riding the teacher's camera continuously.
- **Round-1 ideas merged here:**
  - `R1-social-creator-17` **Co-View Rooms with Follow-Me** — Share a 5-letter room code and explore a molecule together: friends' viewpoints glow as comets orbiting the structure, their taps ripple on atoms, and "Follow" lets you ride along with the teacher's camera.
  - `R1-mobile-native-19` **Pass the Molecule** — Two phones in the same room: flick the molecule off the top of your screen and it drops onto your friend's phone with a bounce and a thud; or mirror a teacher's view onto thirty student phones.

<a id="c116"></a>
### C116 · Atom Stop-Motion Studio
**Parked** · mean 2.8 (E3 P3 A3 Pr2 M3) · effort L · [GPU+GL2] · rides R7, R9

'A Boy and His Atom' for everyone: nudge atoms around a copper surface, snap a frame, repeat, then play your flipbook as a real trajectory and export it as a loop.

- **Summary:** Problem: nobody gets to make 'A Boy and His Atom'. Solution: nudge atoms around a copper surface, snap a frame, repeat, then play the flipbook as a real trajectory and export it as a loop. Edited positions are the user's own new source frames, not display offsets. Desktop: drag. Phone: multi-touch drag.
- **Tech:** math vec2/vec3 snapping; trajectory model for frames; v10 pointerMap multi-touch; Mediabunny loop export via fixed-size frames; about 2k surface atoms + 60 adsorbates
- **Judges:**
  - E 3/keep: User-edited frames are new source frames, so it's honest, and it rides C103's loop export. Multi-touch drag on phones is the risky UX part. *Improve:* Constrain moves to snapped lattice sites (vec2 snapping) so each frame is one tap, not a precise drag.
  - P 3/park: Making your own 'A Boy and His Atom' is creative and honest, but slow to reward. *Improve:* Revisit after C074's snapping exists.
  - A 3/keep: The 'A Boy and His Atom' homage is charming stop-motion craft on real positions. *Improve:* Export with a visible film frame and on-twos timing for character.
  - Pr 2/park: User-authored frames presented as trajectories need provenance, and the scope is L. *Improve:* Park it.
  - M 3/keep: Creative and honest, since edits become new source frames. But multi-touch dragging of small atoms is fiddly on phones. *Improve:* Use tap-to-select plus arrow-key nudges, which work for keyboards and thumbs alike.
- **Round-1 ideas merged here:**
  - `R1-social-creator-18` **Atom Stop-Motion Studio** — "A Boy and His Atom" for everyone: nudge atoms around a copper surface, snap a frame, repeat, then play your flipbook as a real trajectory and export it as a loop.

<a id="c117"></a>
### C117 · The World's Crystal and Atom Garden
**Parked** · mean 2 (E2 P3 A2 Pr1 M2) · effort XL · [GL2-degraded] · rides R3, R5

Every finished puzzle adds an atom to one shared daily crystal, and every name crystal or remix can be planted in a shared garden, each regrowing from a 16-byte seed.

- **Summary:** Problem: sharing is one-to-one, and user text needs moderation. Solution: textless collective creation: every finished puzzle adds one atom to a single shared daily crystal, and every name crystal or remix can be planted in a shared planet-garden, each costing ~16 bytes because it regrows from its seed. Fly to your own atom or plant. Desktop and phone (fewer far dots on the GL2 backend).
- **Tech:** Durable Object or D1 with per-IP-hash rate limits + Turnstile; seeds regrown client-side (mulberry32); BillionAtomBlock brick LOD; useBuffers instances for 100k dots on WebGPU, about 20k on GL2
- **Judges:**
  - E 2/park: XL shared-state infrastructure plus abuse controls (Turnstile, rate limits) for a collective toy, and far-dot LOD at 100k is its own rendering work. *Improve:* Park it until C088's daily loop shows retention worth building a collective layer on.
  - P 3/park: A shared daily crystal is a lovely collective ritual, but it's XL and needs moderation infrastructure. *Improve:* Park it until C088 proves daily return.
  - A 2/park: XL, and its far dots are a thin visual. *Improve:* Revisit after C078 proves seeded growth.
  - Pr 1/park: Needs new collective cloud storage outside the contract's bounds, with XL scope and an abuse surface. *Improve:* Requires an explicit ownership decision before anything else.
  - M 2/park: Size XL, and 100k dots on WebGPU versus ~20k on GL2 splits the experience. *Improve:* Start with the daily crystal only.
- **Round-1 ideas merged here:**
  - `R1-games-19` **The World's Crystal** — Every puzzle anyone finishes today adds one atom to a single shared crystal. By midnight it's hundreds of thousands of atoms, rendered live with the billion-atom engine, and you can fly to your own atom.
  - `R1-social-creator-20` **Atom Garden** — Everyone who grows a name crystal or rolls a remix can plant it in one shared, living garden: a small planet of tens of thousands of visitors' creations, each costing about 16 bytes because every plant regrows from its seed.

<a id="c118"></a>
### C118 · Molecule Reel
**Rework** · mean 4 (E4 P5 A4 Pr3 M4) · effort L · [GPU+GL2] · rides R3, R6

A full-screen vertical feed of the curated collection: swipe up and caffeine's atoms arc through the air and land as the atoms of C60, on one persistent canvas.

- **Summary:** Problem: browsing the collection is a grid of taps. Solution: a full-screen vertical feed where swiping up makes the current molecule's atoms arc through the air and land as the next one's (caffeine into C60), on one persistent canvas with the next file prefetched. Phone-first TikTok-grade flow; desktop via scroll.
- **Tech:** from/to positions in useBuffers with an arc term in the R3 positionNode (uProgress); math mulberry32/random.vec3 arcs; optional curl3 control offsets; next-file prefetch; transition() wipes
- **Judges:**
  - E 4/keep: The from/to morph already exists on v9 (uProgress for atoms and bonds), and the arc term is a small positionNode addition on v10. The real work is N-to-M atom mapping and prefetch. *Improve:* Map atoms by element, then nearest, and fade the unmatched ones via radius, and ship a v9 slice on the existing uProgress hook.
  - P 5/champion: A vertical swipe feed where caffeine's atoms arc into C60 is the 30-second loop: a native gesture with a great transition. It needs owner buy-in because it shifts the product loop. *Improve:* Put double-tap burst and tap-to-pluck on every card, so the feed is a run of toys, not a slideshow.
  - A 4/keep: Atoms arcing from caffeine into C60 is a signature transition, though a TikTok-style feed can feel derivative. *Improve:* Use the arc transition in the ordinary molecule switcher first, on the C030 tokens, and only then build the feed.
  - Pr 3/rework: A phone-first feed over the curated set is strong for mobile browsing, but atoms arcing from caffeine into C60 suggests a chemical transformation that doesn't exist. *Improve:* Use a wipe, or scatter-and-condense labelled 'transition', instead of mapping atoms onto atoms.
  - M 4/keep: A vertical swipe feed on one persistent canvas is native to phones. But swipe-up fights page scroll, pull-to-refresh and Safari's toolbar, and prefetching the next file costs data. *Improve:* Use overscroll-behavior: contain and arrow-key navigation, crossfade under reduced motion, and make the prefetch Save-Data-aware.
- **Round-1 ideas merged here:**
  - `R1-mobile-native-13` **Molecule Reel** — A full-screen vertical feed of the curated collection: swipe up and the atoms of caffeine arc through the air and land as the atoms of C60, one persistent canvas, TikTok-grade flow.

<a id="c119"></a>
### C119 · Molecule Doors
**Parked** · mean 2.25 (E2 P3 A– Pr2 M2) · effort M · [GL2-degraded] · rides R6

Three glowing cards float beside your molecule, each a live window into a related one; tap a card and it swells to fill the screen and you step through.

- **Summary:** Problem: related molecules hide behind search. Solution: three glowing cards float beside the molecule, each a live window into a related one; tap a card and it swells to fill the screen and you step through. Cards render as portals or render-target textures with a transition() wipe; the GL2 backend uses static previews. Desktop and phone (one live portal on phones).
- **Tech:** drei 11 MeshPortalMaterial (WebGPU; runtime-verify) or useRenderTarget cards; useRenderPipeline transition() for the step-through; React <Activity> warm scenes; static previews on GL2
- **Judges:**
  - E 2/park: Each live portal re-renders a scene, MeshPortalMaterial in drei 11 is runtime-unverified, and GL2 falls back to static previews anyway. *Improve:* Use static preview cards with a transition() wipe on step-through, and park the live portals.
  - P 3/keep: Stepping through a glowing door into a related molecule is exploratory delight, but portals are unverified and the GL2 backend gets static cards. *Improve:* Reuse C118's morph as the step-through, and feed related molecules into the reel.
  - Pr 2/park: The portals are unverified at runtime, the GL2 backend gets static previews anyway, and there is no clear source of 'relatedness'. *Improve:* Start with static 'related' cards driven by Library facets.
  - M 2/park: Three live portals add extra scene renders every frame on phones, and MeshPortalMaterial is unverified. *Improve:* Use static preview cards that FLIP into the viewer.
- **Round-1 ideas merged here:**
  - `R1-r3f-sweep-10` **Molecule Doors** — Three glowing cards float beside your molecule, each a live window into a related one. Tap a card and it swells to fill the screen, and you step through.
